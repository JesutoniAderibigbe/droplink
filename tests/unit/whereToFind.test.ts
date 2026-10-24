import { describe, expect, it } from 'vitest';
import { whereToFind } from '../../src/lib/core/whereToFind';

const UA = {
  pixel:
    'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
  iphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Mobile/15E148 Safari/604.1',
  macChrome:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  macSafari:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Safari/605.1.15',
  winEdge:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0',
};

describe('whereToFind', () => {
  it('gives device-specific directions', () => {
    expect(whereToFind({ userAgent: UA.pixel }).steps.join(' ')).toMatch(
      /Files app.*Downloads.*Chrome/,
    );
    expect(whereToFind({ userAgent: UA.iphone }).steps[0]).toMatch(/Files app/);
    expect(whereToFind({ userAgent: UA.macChrome }).steps.join(' ')).toMatch(
      /Finder.*Chrome, press ⌥⌘L/,
    );
    expect(whereToFind({ userAgent: UA.macSafari }).steps[1]).toMatch(/Safari/);
    expect(whereToFind({ userAgent: UA.winEdge }).steps.join(' ')).toMatch(
      /File Explorer.*Edge, press Ctrl \+ J/,
    );
  });
  it('always names the place', () => {
    for (const ua of Object.values(UA))
      expect(whereToFind({ userAgent: ua }).place).toBe('Downloads');
  });
});
