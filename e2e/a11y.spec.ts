import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { newDevice, uniqueEmail } from './helpers';

// axe-core on every screen, in light and dark mode, at phone width.
// Screenshots go to test-results/screens for a visual check.
for (const colorScheme of ['light', 'dark'] as const) {
  test(`no accessibility violations (${colorScheme})`, async ({ browser }) => {
    const email = uniqueEmail(`a11y${colorScheme[0]}`);
    const page = await newDevice(browser, email);
    await page.emulateMedia({ colorScheme });
    await page.setViewportSize({ width: 360, height: 780 });
    await newDevice(browser, email); // a second device so lists aren't empty
    // Someone asking to connect, so People has a request to show.
    const friend = await newDevice(browser, uniqueEmail(`a11yf${colorScheme[0]}`));
    await friend.goto('/people');
    await friend.getByLabel('Their email').fill(email);
    await friend.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(friend.getByText(/Request sent/)).toBeVisible();

    const signedOut = await (
      await browser.newContext({ colorScheme, viewport: { width: 360, height: 780 } })
    ).newPage();
    const screens: [string, typeof page][] = [
      ['/', signedOut],
      ['/privacy', signedOut],
      ['/terms', signedOut],
      ['/', page],
      ['/send', page],
      ['/receive', page],
      ['/settings', page],
      ['/people', page],
    ];
    for (const [path, p] of screens) {
      await p.goto(path);
      await p.waitForLoadState('networkidle');
      if (path === '/people') {
        await expect(p.getByText('Wants to connect')).toBeVisible();
        await p.getByRole('button', { name: 'Show my QR code' }).click();
        await expect(p.getByRole('img', { name: 'Your DropLink QR code' })).toBeVisible();
      }
      const name = `${p === signedOut ? 'out' : 'in'}${path.replace(/\//g, '_') || '_home'}`;
      await p.screenshot({
        path: `test-results/screens/${colorScheme}-${name}.png`,
        fullPage: true,
      });
      const results = await new AxeBuilder({ page: p })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
        .analyze();
      const summary = results.violations.map(
        (v) => `${path} ${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`,
      );
      expect(summary, `${colorScheme} ${path}`).toEqual([]);
      // Nothing wider than the screen.
      expect(
        await p.evaluate(() => document.documentElement.scrollWidth),
        `${path} horizontal scroll`,
      ).toBeLessThanOrEqual(360);
    }
  });
}
