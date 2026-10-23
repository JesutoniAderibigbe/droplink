import { describe, expect, it } from 'vitest';
import { defaultDeviceName, detectKind, sanitizeDeviceName } from '../../src/lib/core/deviceName';

const UA = {
  pixel:
    'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
  macChrome:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  macSafari:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Safari/605.1.15',
  winEdge:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0',
  iphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Mobile/15E148 Safari/604.1',
};

describe('device names', () => {
  it('detects kinds', () => {
    expect(detectKind({ userAgent: UA.pixel })).toBe('android');
    expect(detectKind({ userAgent: UA.macChrome })).toBe('mac');
    expect(detectKind({ userAgent: UA.macSafari, maxTouchPoints: 5 })).toBe('ios'); // iPadOS
    expect(detectKind({ userAgent: UA.winEdge })).toBe('windows');
    expect(detectKind({ userAgent: UA.iphone })).toBe('ios');
  });

  it('builds friendly defaults', () => {
    expect(defaultDeviceName({ userAgent: UA.pixel })).toBe('Android phone');
    expect(defaultDeviceName({ userAgent: UA.macChrome })).toBe('Mac (Chrome)');
    expect(defaultDeviceName({ userAgent: UA.macSafari })).toBe('Mac (Safari)');
    expect(defaultDeviceName({ userAgent: UA.winEdge })).toBe('Windows PC (Edge)');
    expect(defaultDeviceName({ userAgent: UA.iphone })).toBe('iPhone (Safari)');
  });

  it('sanitizes user input', () => {
    expect(sanitizeDeviceName("  Toni's\n  Pixel\u0007 ")).toBe("Toni's Pixel");
    expect(sanitizeDeviceName('x'.repeat(100))).toHaveLength(60);
  });
});
