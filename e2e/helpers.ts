import { expect, type Browser, type Page } from '@playwright/test';

const MAILPIT = process.env.MAILPIT_URL ?? 'http://127.0.0.1:55324';

async function latestCode(email: string, after: number): Promise<string> {
  for (let i = 0; i < 40; i++) {
    const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`);
    const { messages } = (await res.json()) as { messages: { ID: string; Created: string }[] };
    const fresh = messages.find((m) => new Date(m.Created).getTime() >= after - 2000);
    if (fresh) {
      const msg = (await (await fetch(`${MAILPIT}/api/v1/message/${fresh.ID}`)).json()) as {
        Text: string;
      };
      const m = msg.Text.match(/\b(\d{6})\b/);
      if (m) return m[1];
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`No sign-in email for ${email}`);
}

/** Sign in through the real UI using the emailed 6-digit code. */
export async function signIn(page: Page, email: string): Promise<void> {
  await page.goto('/');
  await page.getByLabel('Email').fill(email);
  let sentAt = Date.now();
  await page.getByRole('button', { name: 'Email me a sign-in link' }).click();
  // Supabase allows one email per address per second; retry if we hit it.
  const codeField = page.getByLabel('Code');
  const tooMany = page.getByText('Too many emails');
  for (let attempt = 0; attempt < 3; attempt++) {
    await expect(codeField.or(tooMany)).toBeVisible();
    if (!(await tooMany.isVisible())) break;
    await page.waitForTimeout(1500);
    sentAt = Date.now();
    await page.getByRole('button', { name: 'Email me a sign-in link' }).click();
  }
  const code = await latestCode(email, sentAt);
  await codeField.fill(code);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByText('This device', { exact: true }).first()).toBeVisible({
    timeout: 20_000,
  });
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
