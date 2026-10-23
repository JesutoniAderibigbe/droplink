import { describe, expect, it } from 'vitest';
import { parsePushPayload, pushNotificationContent } from '../../src/lib/core/push';
import { sharedText } from '../../src/lib/services/outbox';

const ok = {
  v: 1,
  type: 'incoming',
  transferId: crypto.randomUUID(),
  fromName: "Toni's Pixel",
  fileCount: 3,
  totalBytes: 24 * 1024 * 1024,
};

describe('push payload', () => {
  it('parses and renders the notification text', () => {
    const p = parsePushPayload(JSON.stringify(ok))!;
    expect(pushNotificationContent(p).title).toBe("Toni's Pixel wants to send 3 files, 24.0 MB");
  });
  it('rejects malformed or oversized payloads', () => {
    expect(parsePushPayload('')).toBeNull();
    expect(parsePushPayload('{')).toBeNull();
    expect(parsePushPayload(JSON.stringify({ ...ok, transferId: 'x' }))).toBeNull();
    expect(parsePushPayload(JSON.stringify({ ...ok, fileCount: 0 }))).toBeNull();
    expect(parsePushPayload(JSON.stringify({ ...ok, fromName: 'x'.repeat(3000) }))).toBeNull();
  });
  it('truncates long names', () => {
    expect(
      parsePushPayload(JSON.stringify({ ...ok, fromName: 'x'.repeat(100) }))!.fromName,
    ).toHaveLength(60);
  });
});

describe('sharedText', () => {
  it('joins title, text and url without repeating the url', () => {
    expect(sharedText(null, 'Look at this https://x.test/a', 'https://x.test/a')).toBe(
      'Look at this https://x.test/a',
    );
    expect(sharedText('Title', 'Body', 'https://x.test')).toBe('Title\nBody\nhttps://x.test');
    expect(sharedText(null, '  ', null)).toBeNull();
  });
});
