import { describe, expect, it } from 'vitest';
import {
  CHUNK_HEADER_BYTES,
  bytesToUuid,
  chunkCount,
  decodeChunk,
  decodeControl,
  encodeChunk,
  encodeControl,
  uuidToBytes,
  type ControlMessage,
} from '../../src/lib/core/protocol';

const id = crypto.randomUUID();

describe('chunk framing', () => {
  it('round-trips header and payload', () => {
    const payload = crypto.getRandomValues(new Uint8Array(65536));
    const frame = encodeChunk(uuidToBytes(id), 123456, payload);
    expect(frame.byteLength).toBe(CHUNK_HEADER_BYTES + 65536);
    const d = decodeChunk(frame, 65536)!;
    expect(d.fileId).toBe(id);
    expect(d.index).toBe(123456);
    expect(d.data).toEqual(payload);
  });

  it('handles the max uint32 chunk index and empty payloads', () => {
    const d = decodeChunk(encodeChunk(uuidToBytes(id), 2 ** 32 - 1, new Uint8Array(0)), 65536)!;
    expect(d.index).toBe(2 ** 32 - 1);
    expect(d.data.byteLength).toBe(0);
  });

  it('rejects short, oversized, or wrong-version frames', () => {
    expect(decodeChunk(new ArrayBuffer(10), 65536)).toBeNull();
    expect(decodeChunk(encodeChunk(uuidToBytes(id), 0, new Uint8Array(65537)), 65536)).toBeNull();
    const bad = encodeChunk(uuidToBytes(id), 0, new Uint8Array(4));
    new DataView(bad).setUint8(0, 9);
    expect(decodeChunk(bad, 65536)).toBeNull();
  });

  it('converts uuids to bytes and back', () => {
    expect(bytesToUuid(uuidToBytes(id))).toBe(id);
  });

  it('counts chunks', () => {
    expect(chunkCount(0, 64)).toBe(0);
    expect(chunkCount(64, 64)).toBe(1);
    expect(chunkCount(65, 64)).toBe(2);
  });
});

describe('control messages', () => {
  const samples: ControlMessage[] = [
    {
      type: 'file-meta',
      id,
      name: 'IMG_0001.jpg',
      size: 3_000_000,
      mimeType: 'image/jpeg',
      lastModified: 1,
      index: 0,
      total: 3,
    },
    { type: 'file-done', id },
    { type: 'file-done', id, sha256: 'a'.repeat(64) },
    { type: 'file-cancel', id },
    { type: 'ack', id, chunk: 42 },
    { type: 'ack', id, chunk: 43, done: true },
    { type: 'error', id, message: 'disk full' },
    { type: 'bye' },
    { type: 'bye', cancelled: true },
  ];

  it.each(samples)('round-trips $type', (msg) => {
    expect(decodeControl(encodeControl(msg))).toEqual(
      msg.type === 'bye' ? { cancelled: false, ...msg } : msg,
    );
  });

  it('rejects junk and invalid fields', () => {
    expect(decodeControl('not json')).toBeNull();
    expect(decodeControl('null')).toBeNull();
    expect(decodeControl(JSON.stringify({ type: 'ack', id: 'x', chunk: 1 }))).toBeNull();
    expect(decodeControl(JSON.stringify({ type: 'ack', id, chunk: -1 }))).toBeNull();
    expect(decodeControl(JSON.stringify({ type: 'nope', id }))).toBeNull();
    expect(
      decodeControl(
        JSON.stringify({
          type: 'file-meta',
          id,
          name: 'x'.repeat(300),
          size: 1,
          mimeType: '',
          lastModified: 0,
          index: 0,
          total: 1,
        }),
      ),
    ).toBeNull();
    expect(
      decodeControl(
        JSON.stringify({
          type: 'file-meta',
          id,
          name: 'a',
          size: 1.5,
          mimeType: '',
          lastModified: 0,
          index: 0,
          total: 1,
        }),
      ),
    ).toBeNull();
    expect(decodeControl(JSON.stringify({ type: 'file-done', id, sha256: 'xyz' }))).toBeNull();
    expect(decodeControl('x'.repeat(5000))).toBeNull();
  });

  it('truncates long error messages', () => {
    const m = decodeControl(JSON.stringify({ type: 'error', id, message: 'e'.repeat(1000) }));
    expect(m && m.type === 'error' && m.message.length).toBe(200);
  });
});
