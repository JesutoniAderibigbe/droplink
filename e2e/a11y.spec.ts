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
    ];
    for (const [path, p] of screens) {
      await p.goto(path);
      await p.waitForLoadState('networkidle');
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
