import { describe, expect, it } from 'vitest';
import { humanError } from '../../src/lib/core/errors';

describe('humanError', () => {
  it('maps known server errors to actionable text', () => {
    expect(
      humanError(new Error('For security purposes, you can only request this after 0 seconds.')),
    ).toMatch(/Too many emails/);
    expect(humanError(new Error('Request rate limit reached'))).toMatch(/Too many attempts/);
    expect(humanError({ message: 'quota_exceeded: daily relay quota used up' })).toMatch(/500 MB/);
    expect(humanError({ message: 'rate_limited: too many relayed transfers this hour' })).toMatch(
      /wait/i,
    );
    expect(humanError(new TypeError('Failed to fetch'))).toMatch(/connection/);
  });

  it('never echoes unknown raw messages', () => {
    expect(humanError(new Error('secret token abc123'))).toBe(
      'Something went wrong. Please try again.',
    );
  });
});
