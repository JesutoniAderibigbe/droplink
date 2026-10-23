import { expect, type Browser, type Page } from '@playwright/test';

// Accounts created during this run: the first device of an email signs up,
// every later device signs in with the same password.
const created = new Set<string>();
const passwordFor = (email: string) => `pw-${email}-Correct-Horse`;

/** Sign in through the real UI with email + password. */
export async function signIn(page: Page, email: string): Promise<void> {
  await page.goto('/');
  await signInHere(page, email);
  await expect(page.getByRole('link', { name: 'Send files' })).toBeVisible({ timeout: 20_000 });
}

/** Same, on whatever page is showing the sign-in form. */
export async function signInHere(page: Page, email: string): Promise<void> {
  const signUp = !created.has(email);
  if (signUp) await page.getByRole('button', { name: 'Create an account' }).click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(passwordFor(email));
  await page
    .getByRole('button', { name: signUp ? 'Create account' : 'Sign in', exact: true })
    .click();
  // Signed in once the sign-in form is gone and setup has finished.
  await expect(page.getByRole('heading', { name: /^(Sign in|Create your account)$/ })).toHaveCount(
    0,
    {
      timeout: 20_000,
    },
  );
  await expect(page.getByText('Setting up this device…')).toHaveCount(0, { timeout: 20_000 });
  created.add(email);
}

/** A fresh browser context is a fresh "device" (own IndexedDB and keys). */
export async function newDevice(browser: Browser, email: string): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning')
      console.log(`[${email.slice(0, 6)} console] ${m.text()}`);
  });
  await signIn(page, email);
  return page;
}

export function uniqueEmail(label: string): string {
  return `${label}-${Date.now().toString(36)}@droplink.test`;
}
