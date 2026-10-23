import { expect, test } from '@playwright/test';
import { execSync } from 'node:child_process';
import { newDevice, uniqueEmail } from './helpers';

// Full Chromium (new headless): the stripped headless shell always denies
// notification permission.
test.use({ channel: 'chromium' });

const status = JSON.parse(
  ((s) => s.slice(s.indexOf('{')))(
    execSync('supabase status -o json', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }),
  ),
);

/** Latest transfer addressed to the device named `name` (service role, test only). */
async function latestTransferTo(email: string): Promise<{ id: string; status: string }> {
  const headers = {
    apikey: status.SERVICE_ROLE_KEY,
    authorization: `Bearer ${status.SERVICE_ROLE_KEY}`,
  };
  const users = await (
    await fetch(`${status.API_URL}/auth/v1/admin/users?per_page=200`, { headers })
  ).json();
  const user = users.users.find((u: { email: string }) => u.email === email);
  const rows = await (
    await fetch(
      `${status.API_URL}/rest/v1/transfers?user_id=eq.${user.id}&order=created_at.desc&limit=1`,
      { headers },
    )
  ).json();
  return rows[0];
}

test('target closed: sender waits with a countdown, target opens from the notification link, P2P completes', async ({
  browser,
}) => {
  const email = uniqueEmail('m8');
  const phone = await newDevice(browser, email);
  const mac = await newDevice(browser, email);
  const macName = (await mac.locator('.this-device h1').textContent())!.trim();
  const macContext = mac.context();
  await mac.close(); // DropLink closed on the Mac (its identity stays in the context)

  await phone.goto('/send');
  await expect(phone.getByText('Offline', { exact: true })).toBeVisible({ timeout: 30_000 });
  await phone
    .locator('input[type=file]')
    .setInputFiles({
      name: 'from-phone.jpg',
      mimeType: 'image/jpeg',
      buffer: Buffer.alloc(2_000_000, 9),
    });
  await phone.getByRole('button', { name: 'Send 1 file' }).click();
  await expect(phone.getByText(`Waiting for ${macName}…`)).toBeVisible();
  await expect(phone.getByText(/\d+ s$/)).toBeVisible();

  // What a notification click does: open /receive?transfer=<id>.
  const transfer = await latestTransferTo(email);
  const reopened = await macContext.newPage();
  await reopened.goto(`/receive?transfer=${transfer.id}`);

  await expect(phone.getByText('Delivered')).toBeVisible({ timeout: 30_000 });
  await expect(reopened.getByText('from-phone.jpg').first()).toBeVisible();
  await expect.poll(async () => (await latestTransferTo(email)).status).toBe('delivered');
});

test('service worker shows the push notification text', async ({ browser }) => {
  const email = uniqueEmail('m8sw');
  const page = await newDevice(browser, email);
  await page.context().grantPermissions(['notifications']);
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('ServiceWorker.enable');
  const registrationId = await new Promise<string>((resolve) => {
    cdp.on(
      'ServiceWorker.workerRegistrationUpdated',
      (e: { registrations: { registrationId: string; isDeleted: boolean }[] }) => {
        const r = e.registrations.find((x) => !x.isDeleted);
        if (r) resolve(r.registrationId);
      },
    );
  });
  const transferId = crypto.randomUUID();
  await cdp.send('ServiceWorker.deliverPushMessage', {
    origin: new URL(page.url()).origin,
    registrationId,
    data: JSON.stringify({
      v: 1,
      type: 'incoming',
      transferId,
      fromName: "Toni's Pixel",
      fileCount: 3,
      totalBytes: 25165824,
    }),
  });
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const reg = await navigator.serviceWorker.ready;
        return (await reg.getNotifications()).map((n) => ({
          title: n.title,
          tag: n.tag,
          url: (n.data as { url: string }).url,
        }));
      }),
    )
    .toEqual([
      {
        title: "Toni's Pixel wants to send 3 files, 24.0 MB",
        tag: `transfer-${transferId}`,
        url: `/receive?transfer=${transferId}`,
      },
    ]);
});
