import { expect, test } from '@playwright/test';
import { newDevice, uniqueEmail } from './helpers';

test('two browsers on one account see each other, and rename works', async ({ browser }) => {
  const email = uniqueEmail('m3');
  const phone = await newDevice(browser, email);
  const mac = await newDevice(browser, email);

  // Each registers itself; the second sees the first immediately, and the
  // first sees the second after a reload (live updates come with presence).
  await phone.reload();
  const myDevices = (p: typeof phone) =>
    p.getByRole('list', { name: 'Your devices' }).getByRole('listitem');
  await expect(myDevices(phone)).toHaveCount(1);
  await expect(myDevices(mac)).toHaveCount(1);

  // Rename the phone in its settings; the Mac sees the new name.
  await phone.goto('/settings');
  await phone.getByLabel('Device name').fill("Toni's Pixel");
  await phone.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(phone.getByText('Saved.')).toBeVisible();
  await mac.reload();
  await expect(mac.getByText("Toni's Pixel")).toBeVisible();

  // Remove the phone from the Mac; the phone is signed out on next load.
  await mac.goto('/settings');
  const row = mac.getByRole('listitem').filter({ hasText: "Toni's Pixel" });
  await row.getByRole('button', { name: 'Remove…' }).click();
  await row.getByRole('button', { name: 'Yes, remove' }).click();
  await expect(mac.getByText("Toni's Pixel")).toHaveCount(0);
  await phone.reload();
  await expect(phone.getByRole('heading', { name: 'Sign in' })).toBeVisible({
    timeout: 15_000,
  });
});
