import type { DeviceKind } from './types';

export interface UaHints {
  userAgent: string;
  /** navigator.maxTouchPoints, used to tell iPadOS (which claims to be a Mac) apart. */
  maxTouchPoints?: number;
}

export function detectKind({ userAgent: ua, maxTouchPoints = 0 }: UaHints): DeviceKind {
  if (/Android/i.test(ua)) return 'android';
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
  if (/Macintosh|Mac OS X/i.test(ua)) return maxTouchPoints > 1 ? 'ios' : 'mac';
  if (/Windows/i.test(ua)) return 'windows';
  if (/CrOS|Linux|X11/i.test(ua)) return 'linux';
  return 'other';
}

export function detectBrowser(ua: string): string {
  if (/Edg\//.test(ua)) return 'Edge';
  if (/OPR\//.test(ua)) return 'Opera';
  if (/SamsungBrowser/.test(ua)) return 'Samsung Internet';
  if (/Firefox\/|FxiOS/.test(ua)) return 'Firefox';
  if (/Chrome\/|CriOS/.test(ua)) return 'Chrome';
  if (/Safari\//.test(ua)) return 'Safari';
  return 'Browser';
}

/** "Android phone", "Mac (Chrome)", "iPhone (Safari)"… The user can rename it. */
export function defaultDeviceName(hints: UaHints): string {
  const kind = detectKind(hints);
  const browser = detectBrowser(hints.userAgent);
  switch (kind) {
    case 'android':
      return /Mobile/i.test(hints.userAgent) ? 'Android phone' : 'Android tablet';
    case 'ios':
      return /iPhone|iPod/i.test(hints.userAgent) ? `iPhone (${browser})` : `iPad (${browser})`;
    case 'mac':
      return `Mac (${browser})`;
    case 'windows':
      return `Windows PC (${browser})`;
    case 'linux':
      return /CrOS/.test(hints.userAgent) ? 'Chromebook' : `Linux (${browser})`;
    default:
      return `My device (${browser})`;
  }
}

export function sanitizeDeviceName(name: string): string {
  // Strip control characters (DEL included) and collapse whitespace; the DB limit is 60 chars.
  return name
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
}
