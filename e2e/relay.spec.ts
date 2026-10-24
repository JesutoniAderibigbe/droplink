import { expect, test, type Page } from '@playwright/test';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { newDevice, uniqueEmail } from './helpers';

const status = JSON.parse(
  ((s) => s.slice(s.indexOf('{')))(
    execSync('supabase status -o json', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }),
  ),
);
const svc = { apikey: status.SERVICE_ROLE_KEY, authorization: `Bearer ${status.SERVICE_ROLE_KEY}` };
const rest = async (path: string) =>
  (await fetch(`${status.API_URL}/rest/v1/${path}`, { headers: svc })).json();
const sql = (q: string) =>
  execSync(`docker exec supabase_db_droplink psql -U postgres -qtAc "${q}"`, {
    encoding: 'utf8',
  }).trim();

async function userId(email: string): Promise<string> {
  const users = await (
    await fetch(`${status.API_URL}/auth/v1/admin/users?per_page=500`, { headers: svc })
  ).json();
  return users.users.find((u: { email: string }) => u.email === email).id;
}

async function storageObjects(uid: string, transferId: string): Promise<number> {
  return Number(
    sql(
      `select count(*) from storage.objects where bucket_id='relay' and name like '${uid}/${transferId}/%'`,
    ),
  );
}

/** Use an OPFS directory as "the chosen download folder" (see receive-folder.spec.ts). */
async function useOpfsFolder(page: Page) {
  await page.evaluate(async () => {
    const dir = await (
      await navigator.storage.getDirectory()
    ).getDirectoryHandle('relay-e2e', { create: true });
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open('droplink-kv');
      open.onsuccess = () => {
        const tx = open.result.transaction('kv', 'readwrite');
        tx.objectStore('kv').put(dir, 'download-dir');
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      };
    });
  });
}

test('relay: Mac fully offline, 50 MB arrives intact later, relay copy deleted', async ({
  browser,
}) => {
  test.setTimeout(5 * 60_000);
  const email = uniqueEmail('m9');
  const phone = await newDevice(browser, email);
  const mac = await newDevice(browser, email);
  await useOpfsFolder(mac);
  const macContext = mac.context();
  await mac.close(); // Mac fully offline: no tab, no presence

  const size = 50 * 1024 * 1024;
  const data = Buffer.alloc(size);
  for (let i = 0; i < size; i += 65536) data.set(crypto.getRandomValues(new Uint8Array(65536)), i);
  const expected = createHash('sha256').update(data).digest('hex');
  const name = 'Quarterly secret plans.mov';

  await phone.goto('/send');
  await expect(phone.getByText(/Offline/).first()).toBeVisible({ timeout: 30_000 });
  const filePath = path.join(mkdtempSync(path.join(tmpdir(), 'droplink-')), name);
  writeFileSync(filePath, data);
  await phone.locator('input[type=file]').setInputFiles(filePath);
  await phone.getByRole('button', { name: /^Send to / }).click();
  await expect(phone.getByText(/Knocking on/)).toBeVisible();
  await expect(phone.getByText('Uploaded securely')).toBeVisible({ timeout: 2 * 60_000 });

  // Server side: relayed, only ciphertext, no names anywhere.
  const uid = await userId(email);
  const [row] = await rest(`transfers?user_id=eq.${uid}&order=created_at.desc&limit=1`);
  expect(row.status).toBe('relayed');
  expect(JSON.stringify(row)).not.toContain('Quarterly');
  expect(await storageObjects(uid, row.id)).toBe(51); // 50 chunks + manifest
  // The manifest is ciphertext: the file name isn't in it.
  const manifest = Buffer.from(
    await (
      await fetch(`${status.API_URL}/storage/v1/object/relay/${uid}/${row.id}/manifest`, {
        headers: svc,
      })
    ).arrayBuffer(),
  );
  expect(manifest.length).toBeGreaterThan(16);
  expect(manifest.includes(Buffer.from('Quarterly'))).toBe(false);
  // And a chunk isn't the plaintext.
  const chunk0 = Buffer.from(
    await (
      await fetch(`${status.API_URL}/storage/v1/object/relay/${uid}/${row.id}/0/0`, {
        headers: svc,
      })
    ).arrayBuffer(),
  );
  expect(chunk0.length).toBe(1024 * 1024 + 16);
  expect(chunk0.subarray(0, 1024).equals(data.subarray(0, 1024))).toBe(false);
  const objectsRows = await rest(
    `relay_objects?transfer_id=eq.${row.id}&select=storage_path,byte_size`,
  );
  expect(
    objectsRows.every((o: { storage_path: string }) => !o.storage_path.includes('Quarterly')),
  ).toBe(true);
  expect(Number(sql(`select relay_bytes from usage_daily where user_id='${uid}'`))).toBeGreaterThan(
    size,
  );

  // Later: open DropLink on the Mac. It finds the relay, decrypts and saves.
  const reopened = await macContext.newPage();
  await reopened.goto('/');
  await expect(reopened.getByText(name).first()).toBeVisible({ timeout: 60_000 });
  await expect
    .poll(async () => (await rest(`transfers?id=eq.${row.id}&select=status`))[0].status, {
      timeout: 30_000,
    })
    .toBe('delivered');

  const saved = await reopened.evaluate(async (fileName) => {
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('relay-e2e');
    const file = await (await dir.getFileHandle(fileName)).getFile();
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()));
    return {
      size: file.size,
      sha: Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join(''),
    };
  }, name);
  expect(saved).toEqual({ size, sha: expected });

  // The relay copy is gone.
  await expect.poll(() => storageObjects(uid, row.id), { timeout: 15_000 }).toBe(0);
  expect(await rest(`relay_objects?transfer_id=eq.${row.id}`)).toEqual([]);
});

test('relay cleanup: expired relays are deleted by the hourly job', async ({ browser }) => {
  test.setTimeout(3 * 60_000);
  const email = uniqueEmail('m9x');
  const phone = await newDevice(browser, email);
  const mac = await newDevice(browser, email);
  await mac.context().close();

  await phone.goto('/send');
  await expect(phone.getByText(/Offline/).first()).toBeVisible({ timeout: 30_000 });
  await phone.locator('input[type=file]').setInputFiles({
    name: 'old.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('x'.repeat(3000)),
  });
  await phone.getByRole('button', { name: /^Send to / }).click();
  await expect(phone.getByText('Uploaded securely')).toBeVisible({ timeout: 60_000 });

  const uid = await userId(email);
  const [row] = await rest(`transfers?user_id=eq.${uid}&order=created_at.desc&limit=1`);
  expect(await storageObjects(uid, row.id)).toBe(2);

  // Pretend 24 hours passed, then run what pg_cron runs every hour.
  sql(`update transfers set expires_at = now() - interval '1 minute' where id = '${row.id}'`);
  sql('select private.run_relay_cleanup()');
  await expect.poll(() => storageObjects(uid, row.id), { timeout: 30_000 }).toBe(0);
  await expect
    .poll(async () => (await rest(`transfers?id=eq.${row.id}&select=status`))[0].status)
    .toBe('expired');
});

test('no direct link possible: falls back fast and an open receiver gets it at once', async ({
  browser,
}) => {
  test.setTimeout(3 * 60_000);
  const email = uniqueEmail('m9f');
  const phone = await newDevice(browser, email);
  const mac = await newDevice(browser, email);
  await phone.evaluate(() => localStorage.setItem('droplink:dev-no-p2p', '1'));
  await mac.goto('/receive');

  await phone.goto('/send');
  await expect(phone.getByRole('radio', { name: /Online/ })).toBeVisible({ timeout: 30_000 });
  await phone.locator('input[type=file]').setInputFiles({
    name: 'fallback.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('hello relay'),
  });
  const started = Date.now();
  await phone.getByRole('button', { name: /^Send to / }).click();

  await expect(phone.getByText('Uploaded securely')).toBeVisible({ timeout: 60_000 });
  // The open Mac is pinged (relay-ready) and fetches straight away, not on its 2-minute timer.
  await expect(mac.getByText('fallback.txt').first()).toBeVisible({ timeout: 15_000 });
  const seconds = (Date.now() - started) / 1000;
  console.log(`fallback delivered in ${seconds.toFixed(1)} s`);
  expect(seconds).toBeLessThan(25);
});
