import { expect, test, type Page } from '@playwright/test';
import { newDevice, uniqueEmail } from './helpers';

// Runs against the production build: `npm run build && npx vite preview`.
test.use({ baseURL: process.env.E2E_PREVIEW_URL ?? 'https://localhost:4173' });

async function waitForServiceWorker(page: Page) {
  // ready = active and precache installed. The first load isn't controlled
  // yet, so reload until fetches go through the SW.
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await expect(async () => {
    if (!(await page.evaluate(() => !!navigator.serviceWorker.controller))) {
      await page.reload();
      throw new Error('not controlled yet');
    }
  }).toPass({ timeout: 20_000 });
}

test('meets Chrome installability criteria', async ({ page }) => {
  await page.goto('/');
  await waitForServiceWorker(page);
  const cdp = await page.context().newCDPSession(page);
  const { installabilityErrors } = (await cdp.send('Page.getInstallabilityErrors')) as {
    installabilityErrors: { errorId: string }[];
  };
  expect(installabilityErrors.map((e) => e.errorId)).toEqual([]);
  const manifest = (await cdp.send('Page.getAppManifest')) as { errors: unknown[] };
  expect(manifest.errors).toEqual([]);
});

test('opens offline from the precached shell', async ({ browser }) => {
  // Playwright's setOffline() also blocks service-worker-handled navigations,
  // so instead run a private preview server and stop it: a real "server gone".
  const { spawn } = await import('node:child_process');
  const port = 4180;
  const server = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort'], {
    stdio: 'ignore',
    detached: true,
  });
  try {
    const page = await (await browser.newContext()).newPage();
    await expect(async () => {
      await page.goto(`https://localhost:${port}/`);
    }).toPass({ timeout: 20_000 });
    await waitForServiceWorker(page);
    process.kill(-server.pid!);
    // Confirm the port is really closed (a TCP connect, not fetch: fetch would
    // also fail on the self-signed certificate and prove nothing).
    const { connect } = await import('node:net');
    const portOpen = () =>
      new Promise<boolean>((resolve) => {
        const sock = connect(port, '127.0.0.1');
        sock.once('connect', () => (sock.destroy(), resolve(true)));
        sock.once('error', () => resolve(false));
      });
    await expect.poll(portOpen, { timeout: 10_000 }).toBe(false);
    await page.goto(`https://localhost:${port}/settings`);
    await expect(page.getByRole('heading', { name: 'DropLink' })).toBeVisible();
  } finally {
    try {
      process.kill(-server.pid!);
    } catch {
      /* already stopped */
    }
  }
});

/** Simulate Android's share sheet: a multipart POST navigation to /share-target. */
async function shareFromAnotherApp(
  page: Page,
  files: { name: string; mimeType: string; buffer: Buffer }[],
  text?: string,
) {
  await page.evaluate((text) => {
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = '/share-target';
    form.enctype = 'multipart/form-data';
    form.innerHTML = `<input type="file" name="files" multiple><input name="text">`;
    (form.querySelector('[name=text]') as HTMLInputElement).value = text ?? '';
    form.id = 'share-form';
    document.body.appendChild(form);
  }, text);
  await page.locator('#share-form input[type=file]').setInputFiles(files);
  await Promise.all([
    page.waitForURL('**/send?shared=1'),
    page.evaluate(() => (document.getElementById('share-form') as HTMLFormElement).submit()),
  ]);
}

test('share target: shared photo + text reach the other device', async ({ browser }) => {
  const email = uniqueEmail('m7');
  const phone = await newDevice(browser, email);
  const mac = await newDevice(browser, email);
  await waitForServiceWorker(phone);
  await mac.goto('/receive');

  const photo = { name: 'IMG_0001.jpg', mimeType: 'image/jpeg', buffer: Buffer.alloc(300_000, 7) };
  await shareFromAnotherApp(phone, [photo], 'https://example.com/look');

  await expect(phone.getByText('IMG_0001.jpg')).toBeVisible();
  await expect(phone.getByText('https://example.com/look')).toBeVisible();
  await phone.getByRole('button', { name: 'Send 2 files' }).click();
  await expect(phone.getByText('Delivered')).toBeVisible({ timeout: 30_000 });

  await expect(mac.getByText('IMG_0001.jpg').first()).toBeVisible();
  await expect(mac.getByText('https://example.com/look').first()).toBeVisible();
  await expect(mac.getByRole('button', { name: 'Copy' })).toBeVisible();

  // One-tap mode: turn on auto-send to the default device, share again.
  await phone.goto('/settings');
  await phone.getByLabel('Default device', { exact: true }).selectOption({ index: 1 });
  await phone.getByLabel('Send to my default device without asking').check();
  // Settings are written to IndexedDB asynchronously; confirm they persisted
  // before leaving the page.
  await phone.waitForTimeout(500);
  await phone.reload();
  await expect(phone.getByLabel('Send to my default device without asking')).toBeChecked({
    timeout: 20_000,
  });
  await phone.goto('/');
  await shareFromAnotherApp(phone, [
    { name: 'second.jpg', mimeType: 'image/jpeg', buffer: Buffer.alloc(1000, 1) },
  ]);
  await expect(phone.getByText('Delivered')).toBeVisible({ timeout: 30_000 });
  await expect(mac.getByText('second.jpg').first()).toBeVisible();
});

test('share while signed out: files wait, then send after sign-in', async ({ browser }) => {
  const email = uniqueEmail('m7o');
  const mac = await newDevice(browser, email);
  await mac.goto('/receive');

  const context = await browser.newContext();
  const phone = await context.newPage();
  await phone.goto('/');
  await waitForServiceWorker(phone);
  await shareFromAnotherApp(phone, [
    { name: 'offline-share.png', mimeType: 'image/png', buffer: Buffer.alloc(5000, 3) },
  ]);
  await expect(phone.getByText('Sign in to send the item you shared')).toBeVisible();

  // Sign in on the same page (keeps /send?shared=1), then send.
  const { signInHere } = await import('./helpers');
  await signInHere(phone, email);
  await expect(phone.getByText('offline-share.png')).toBeVisible();
  await phone.getByRole('button', { name: 'Send 1 file' }).click();
  await expect(phone.getByText('Delivered')).toBeVisible({ timeout: 30_000 });
  await expect(mac.getByText('offline-share.png').first()).toBeVisible();
});
