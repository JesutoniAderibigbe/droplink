import { describe, expect, it } from 'vitest';
import { parsePresence, parseSignal } from '../../src/lib/core/signal';

const id = () => crypto.randomUUID();
const base = () => ({ to: id(), from: id(), transferId: id() });

describe('parseSignal', () => {
  it('accepts well-formed messages', () => {
    expect(parseSignal('offer', { ...base(), attempt: 0, sdp: 'v=0' })).not.toBeNull();
    expect(parseSignal('ice', { ...base(), attempt: 1, candidate: null })).not.toBeNull();
    expect(
      parseSignal('ice', {
        ...base(),
        attempt: 1,
        candidate: { candidate: 'candidate:1 1 udp', sdpMid: '0', sdpMLineIndex: 0 },
      }),
    ).not.toBeNull();
    expect(
      parseSignal('transfer-request', {
        ...base(),
        fromName: 'Pixel',
        fileCount: 3,
        totalBytes: 24e6,
      }),
    ).not.toBeNull();
    expect(parseSignal('transfer-accept', base())).not.toBeNull();
    expect(parseSignal('transfer-decline', { ...base(), reason: 'busy' })).not.toBeNull();
  });

  it('rejects missing addressing or bad ids', () => {
    expect(parseSignal('transfer-accept', { ...base(), to: 'not-a-uuid' })).toBeNull();
    expect(parseSignal('transfer-accept', { from: id(), transferId: id() })).toBeNull();
    expect(parseSignal('transfer-accept', null)).toBeNull();
  });

  it('rejects oversized or mistyped fields', () => {
    expect(parseSignal('offer', { ...base(), attempt: 0, sdp: 'x'.repeat(70_000) })).toBeNull();
    expect(parseSignal('offer', { ...base(), attempt: -1, sdp: 'v=0' })).toBeNull();
    expect(
      parseSignal('transfer-request', {
        ...base(),
        fromName: 'x'.repeat(61),
        fileCount: 1,
        totalBytes: 1,
      }),
    ).toBeNull();
    expect(
      parseSignal('transfer-request', { ...base(), fromName: 'P', fileCount: 0, totalBytes: 1 }),
    ).toBeNull();
    expect(parseSignal('transfer-decline', { ...base(), reason: 'whatever' })).toBeNull();
    expect(parseSignal('ice', { ...base(), attempt: 0, candidate: { candidate: 5 } })).toBeNull();
  });
});

describe('parsePresence', () => {
  it('validates presence metadata', () => {
    expect(parsePresence({ deviceId: id(), name: 'Mac', kind: 'mac' })).not.toBeNull();
    expect(parsePresence({ deviceId: 'x', name: 'Mac', kind: 'mac' })).toBeNull();
  });
});
