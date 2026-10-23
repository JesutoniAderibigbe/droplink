import { expect, test } from '@playwright/test';
import { newDevice, uniqueEmail } from './helpers';

test('online status updates live in both directions', async ({ browser }) => {
  const email = uniqueEmail('m4');
  const phone = await newDevice(browser, email);
  const mac = await newDevice(browser, email);

  const devicesOn = (p: typeof phone) => p.getByRole('list', { name: 'Your devices' });

  // No reloads: the phone learns about the new Mac through presence.
  await expect(devicesOn(phone).getByText('Online', { exact: true })).toBeVisible();
  await expect(devicesOn(mac).getByText('Online', { exact: true })).toBeVisible();

  // Close the Mac; the phone flips it to offline.
  await mac.context().close();
  await expect(devicesOn(phone).getByText('Offline', { exact: true })).toBeVisible({
    timeout: 30_000,
  });
});
