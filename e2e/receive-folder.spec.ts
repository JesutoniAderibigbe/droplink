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
    await phone.getByRole('button', { name: 'Send 1 file' }).click();
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
});
