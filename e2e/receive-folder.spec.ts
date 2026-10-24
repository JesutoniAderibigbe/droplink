import { expect, test } from '@playwright/test';
import { newDevice, uniqueEmail } from './helpers';

// The native folder picker can't be automated, but an OPFS directory is the
// same FileSystemDirectoryHandle type, so we store one as "the chosen folder"
// and exercise the real FolderSink: streaming writes, collisions, contents.
test('saves into the chosen folder with (1) collision names', async ({ browser }) => {
  const email = uniqueEmail('m6');
  const phone = await newDevice(browser, email);
  const mac = await newDevice(browser, email);

  await mac.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle('e2e-folder', { create: true });
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open('droplink-kv');
      open.onsuccess = () => {
        const tx = open.result.transaction('kv', 'readwrite');
        tx.objectStore('kv').put(dir, 'download-dir');
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      };
      open.onerror = () => reject(open.error);
    });
  });
  await mac.goto('/receive');
  await expect(mac.getByText('Saving to')).toBeVisible();

  for (const body of ['first version', 'second version']) {
    await phone.goto('/send');
    await phone
      .locator('input[type=file]')
      .setInputFiles({ name: 'hello.txt', mimeType: 'text/plain', buffer: Buffer.from(body) });
    await phone.getByRole('button', { name: /^Send to / }).click();
    await expect(phone.getByText('Delivered').first()).toBeVisible({ timeout: 30_000 });
  }
  await expect(mac.getByText('hello (1).txt').first()).toBeVisible();

  const files = await mac.evaluate(async () => {
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('e2e-folder');
    const out: Record<string, string> = {};
    for await (const [name, handle] of dir.entries()) {
      if (handle.kind === 'file')
        out[name] = await (await (handle as FileSystemFileHandle).getFile()).text();
    }
    return out;
  });
  expect(files).toEqual({ 'hello.txt': 'first version', 'hello (1).txt': 'second version' });

  // Open reads it back from the chosen folder.
  const [tab] = await Promise.all([
    mac.context().waitForEvent('page'),
    mac
      .getByRole('listitem')
      .filter({ hasText: 'hello (1).txt' })
      .getByRole('button', { name: 'Open' })
      .click(),
  ]);
  await tab.waitForURL(/^blob:/);
  await expect(tab.locator('body')).toHaveText('second version');
});

// Downloads can't be reopened by a web app: the app says where the file is.
test('downloaded files show where to find them', async ({ browser }) => {
  const email = uniqueEmail('where');
  const phone = await newDevice(browser, email);
  const mac = await newDevice(browser, email);
  await mac.goto('/receive');

  await phone.goto('/send');
  await phone
    .locator('input[type=file]')
    .setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: Buffer.alloc(500, 1) });
  await phone.getByRole('button', { name: /^Send to / }).click();
  await expect(phone.getByText('Delivered').first()).toBeVisible({ timeout: 30_000 });

  const row = mac.getByRole('listitem').filter({ hasText: 'photo.png' }).first();
  await expect(row.getByRole('button', { name: 'Open' })).toHaveCount(0);
  await row.getByRole('button', { name: 'Where is it?' }).click();
  const panel = mac.getByRole('region', { name: 'Where to find photo.png' });
  await expect(panel).toContainText('Saved to your Downloads folder as photo.png');
  await expect(panel.getByRole('listitem').first()).toBeVisible();
});
