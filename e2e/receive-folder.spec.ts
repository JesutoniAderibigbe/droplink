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

// "Open" works for both places a file can land.
test('received downloads open from the app (photo viewer, PDF in a tab)', async ({ browser }) => {
  const email = uniqueEmail('open');
  const phone = await newDevice(browser, email);
  const mac = await newDevice(browser, email);
  await mac.goto('/receive');

  // 1. No folder chosen: the file goes to Downloads and a private copy is kept.
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==',
    'base64',
  );
  await phone.goto('/send');
  await phone
    .locator('input[type=file]')
    .setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: png });
  await phone.getByRole('button', { name: /^Send to / }).click();
  await expect(phone.getByText('Delivered').first()).toBeVisible({ timeout: 30_000 });
  const row = mac.getByRole('listitem').filter({ hasText: 'photo.png' });
  await row.getByRole('button', { name: 'Open' }).click();
  const viewer = mac.getByRole('dialog', { name: 'photo.png' });
  await expect(viewer.getByRole('img', { name: 'photo.png' })).toBeVisible();
  await expect
    .poll(() => viewer.getByRole('img').evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBe(1);
  await mac.keyboard.press('Escape');
  await expect(viewer).toHaveCount(0);

  // 2. A PDF opens in a new tab with the right bytes.
  await phone.getByRole('button', { name: 'Send more' }).click();
  await phone.locator('input[type=file]').setInputFiles({
    name: 'notes.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4\n% DropLink test\n'),
  });
  await phone.getByRole('button', { name: /^Send to / }).click();
  await expect(phone.getByText('Delivered').first()).toBeVisible({ timeout: 30_000 });
  const [tab] = await Promise.all([
    mac.context().waitForEvent('page'),
    mac
      .getByRole('listitem')
      .filter({ hasText: 'notes.pdf' })
      .getByRole('button', { name: 'Open' })
      .click(),
  ]);
  // Headless Chromium has no PDF viewer, so just check a tab opened (the
  // text-file case in the folder test checks the bytes shown in a tab).
  expect(tab).toBeTruthy();
  await tab.close();
});
