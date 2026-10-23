import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { signIn, uniqueEmail } from './helpers';

// Runs the production build under the exact CSP that Netlify will serve
// (dist/_headers from scripts/write-headers.mjs) and fails on any violation.
test.use({ baseURL: process.env.E2E_PREVIEW_URL ?? 'https://localhost:4173' });

const csp = readFileSync('dist/_headers', 'utf8').match(/Content-Security-Policy: (.*)/)![1];

// `vite preview` serves dist/_headers' CSP (see vite.config.ts). Playwright
// routes can't be used to inject it: an installed route breaks the proxied
// Realtime WebSocket.
async function withCsp(context: BrowserContext): Promise<Page> {
  await context.addInitScript(() => {
    (window as unknown as { __csp: string[] }).__csp = [];
    document.addEventListener('securitypolicyviolation', (e) =>
      (window as unknown as { __csp: string[] }).__csp.push(
        `${e.violatedDirective} ${e.blockedURI}`,
      ),
    );
  });
  return context.newPage();
}

test('no CSP violations across screens and a transfer', async ({ browser }) => {
  const email = uniqueEmail('csp');
  const phone = await withCsp(await browser.newContext());
  const mac = await withCsp(await browser.newContext());
  await signIn(phone, email);
  const served = await phone.request.get('/');
  expect(served.headers()['content-security-policy']).toBe(csp);
  await signIn(mac, email);
  const violations: string[] = [];
  const collect = async (p: Page) =>
    violations.push(...(await p.evaluate(() => (window as unknown as { __csp: string[] }).__csp)));

  for (const path of ['/settings', '/receive', '/privacy', '/send']) {
    await phone.goto(path);
    await phone.waitForLoadState('networkidle');
    await collect(phone);
  }
  await mac.goto('/receive');
  await expect(phone.getByRole('radio', { name: /Online/ })).toBeVisible({ timeout: 30_000 });
  await phone
    .locator('input[type=file]')
    .setInputFiles({ name: 'csp.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
  await phone.getByRole('button', { name: /^Send to / }).click();
  await expect(phone.getByText('Delivered').first()).toBeVisible({ timeout: 30_000 });
  await collect(phone);
  await collect(mac);
  expect(violations).toEqual([]);

  // Positive control: the policy really is enforced (an inline script is blocked).
  await phone.evaluate(() => {
    const s = document.createElement('script');
    s.textContent = 'window.__inlineRan = true';
    document.body.append(s);
  });
  await expect
    .poll(() => phone.evaluate(() => (window as unknown as { __csp: string[] }).__csp.join()))
    .toContain('script-src');
  expect(
    await phone.evaluate(() => (window as unknown as { __inlineRan?: boolean }).__inlineRan),
  ).toBeUndefined();
});
