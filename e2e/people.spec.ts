import { expect, test, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { newDevice, uniqueEmail, useOpfsFolder } from './helpers';

// Two different people (two accounts), each on their own device. Everything
// arrives byte for byte: same size, same SHA-256, so photos and videos keep
// their full quality.

function randomFile(name: string, size: number) {
  const data = Buffer.alloc(size);
  for (let i = 0; i < size; i += 65536)
    data.set(crypto.getRandomValues(new Uint8Array(Math.min(65536, size - i))), i);
  const file = path.join(mkdtempSync(path.join(tmpdir(), 'droplink-')), name);
  writeFileSync(file, data);
  return { file, size, sha: createHash('sha256').update(data).digest('hex') };
}

async function savedFile(page: Page, dir: string, name: string) {
  return page.evaluate(
    async ([dir, name]) => {
      const d = await (await navigator.storage.getDirectory()).getDirectoryHandle(dir);
      const file = await (await d.getFileHandle(name)).getFile();
      const digest = new Uint8Array(
        await crypto.subtle.digest('SHA-256', await file.arrayBuffer()),
      );
      return {
        size: file.size,
        sha: Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join(''),
      };
    },
    [dir, name],
  );
}

async function sendFrom(page: Page, file: string) {
  await page.locator('input[type=file]').setInputFiles(file);
  await page.getByRole('button', { name: /^Send to Toni · / }).click();
}

test('QR invite connects two people, and files go both ways intact', async ({ browser }) => {
  test.setTimeout(3 * 60_000);
  const ada = await newDevice(browser, uniqueEmail('p-ada'));
  const bo = await newDevice(browser, uniqueEmail('p-bo'));
  await useOpfsFolder(ada, 'people-ada');
  await useOpfsFolder(bo, 'people-bo');

  // Ada shows her code; Bo opens the link (what scanning the QR does).
  await ada.goto('/people');
  await ada.getByRole('button', { name: 'Show my QR code' }).click();
  await expect(ada.getByRole('img', { name: 'Your DropLink QR code' })).toBeVisible();
  const text = await ada.getByText(/\/add\?invite=[0-9a-f]{36}/).textContent();
  const link = text!.match(/https?:\S+\/add\?invite=[0-9a-f]{36}/)![0];
  expect(new URL(link).pathname).toBe('/add');
  await bo.goto(link);
  await expect(bo.getByText(/are connected/)).toBeVisible();
  await expect(bo).toHaveURL(/\/people$/); // the used code doesn't stay in the address bar
  await expect(ada.getByText('Connected with Toni Tester')).toBeVisible({ timeout: 15_000 });

  // The code works once.
  const carol = await newDevice(browser, uniqueEmail('p-carol'));
  await carol.goto(link);
  await expect(carol.getByText(/expired or was already used/)).toBeVisible();

  // Bo → Ada, directly.
  const photo = randomFile('Lagos-sunset.jpg', 6 * 1024 * 1024 + 123);
  await bo.getByRole('link', { name: 'Send', exact: true }).first().click();
  await expect(bo.getByText('Online').first()).toBeVisible({ timeout: 20_000 });
  await sendFrom(bo, photo.file);
  await expect(bo.getByText('Delivered').first()).toBeVisible({ timeout: 60_000 });
  await expect
    .poll(() => savedFile(ada, 'people-ada', 'Lagos-sunset.jpg').catch(() => null), {
      timeout: 20_000,
    })
    .toEqual({ size: photo.size, sha: photo.sha });

  // Ada → Bo, from her People list.
  const video = randomFile('Launch-demo.mov', 9 * 1024 * 1024 + 7);
  await ada.goto('/people');
  await ada.getByRole('link', { name: 'Send', exact: true }).first().click();
  await sendFrom(ada, video.file);
  await expect(ada.getByText('Delivered').first()).toBeVisible({ timeout: 60_000 });
  await expect
    .poll(() => savedFile(bo, 'people-bo', 'Launch-demo.mov').catch(() => null), {
      timeout: 20_000,
    })
    .toEqual({ size: video.size, sha: video.sha });
  // The receiver sees who it came from.
  await bo.goto('/receive');
  await expect(bo.getByText(/Toni · /).first()).toBeVisible();
});

test('email request, accept, then send while they are offline (encrypted relay)', async ({
  browser,
}) => {
  test.setTimeout(3 * 60_000);
  const cyEmail = uniqueEmail('p-cy');
  const diEmail = uniqueEmail('p-di');
  const cy = await newDevice(browser, cyEmail);
  const di = await newDevice(browser, diEmail);

  await cy.goto('/people');
  await cy.getByLabel('Their email').fill(diEmail);
  await cy.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(cy.getByText(/Request sent/)).toBeVisible();
  await expect(cy.getByText('Waiting for them to accept')).toBeVisible();

  // Not contacts yet: Cy can't pick Di's device.
  await cy.goto('/send');
  await expect(cy.getByRole('button', { name: /^Send to Toni · / })).toHaveCount(0);

  await di.goto('/people');
  await expect(di.getByText('Wants to connect')).toBeVisible();
  await expect(di.getByText(cyEmail)).toBeVisible(); // so Di can check who's asking
  await di.getByRole('button', { name: 'Accept' }).click();
  await expect(di.getByText('Your people')).toBeVisible();
  await expect(di.getByRole('button', { name: /^Remove / })).toBeVisible();

  // Di goes offline.
  await useOpfsFolder(di, 'people-di');
  const diContext = di.context();
  await di.close();

  const doc = randomFile('Boarding-pass.pdf', 3 * 1024 * 1024 + 99);
  await cy.goto('/people');
  await cy.getByRole('link', { name: 'Send', exact: true }).first().click();
  await expect(cy.getByText('Offline · will get a notification').first()).toBeVisible();
  await sendFrom(cy, doc.file);
  await cy.getByRole('button', { name: 'Relay now' }).click();
  await expect(cy.getByText('Uploaded securely')).toBeVisible({ timeout: 60_000 });

  // Di opens DropLink later: it's there, decrypted, byte for byte.
  const reopened = await diContext.newPage();
  await reopened.goto('/');
  await expect(reopened.getByText('Boarding-pass.pdf').first()).toBeVisible({ timeout: 60_000 });
  await expect
    .poll(() => savedFile(reopened, 'people-di', 'Boarding-pass.pdf').catch(() => null), {
      timeout: 20_000,
    })
    .toEqual({ size: doc.size, sha: doc.sha });
});
