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
    expect(humanError(new Error('Invalid login credentials'))).toBe('Wrong email or password.');
    expect(humanError(new Error('account_exists_or_unconfirmed'))).toMatch(/Sign in instead/);
    expect(humanError(new Error('Password should be at least 8 characters.'))).toMatch(
      /longer password/,
    );
  });

  it('never echoes unknown raw messages', () => {
    expect(humanError(new Error('secret token abc123'))).toBe(
      'Something went wrong. Please try again.',
    );
  });
});
