// Wire protocol on the "files" RTCDataChannel.
//
// Control messages are JSON strings. File data is sent as binary messages,
// each one a small header followed by up to 64 KB of payload:
//
//   byte 0       protocol version (1)
//   bytes 1..16  file id (UUID as 16 raw bytes)
//   bytes 17..20 chunk index, uint32 big-endian
//   bytes 21..   chunk payload
//
// The channel is ordered and reliable, so chunks arrive in order; the index
// lets the receiver detect bugs and lets the sender resume mid-file after a
// reconnect (see `ack`).

import { LIMITS } from '../config';

export const PROTOCOL_VERSION = 1;
export const CHUNK_HEADER_BYTES = 21;

export interface FileMeta {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  lastModified: number;
  /** Position in the batch, for "file 2 of 5" on the receiver. */
  index: number;
  total: number;
}

export type ControlMessage =
  | ({ type: 'file-meta' } & FileMeta)
  /** Sender: last chunk sent. `sha256` (hex) is only sent in dev builds. */
  | { type: 'file-done'; id: string; sha256?: string }
  /** Either side: stop this file and move on. */
  | { type: 'file-cancel'; id: string }
  /**
   * Receiver: `chunk` = number of chunks written to disk so far (= next index
   * expected). Sent in reply to file-meta (0, or the resume point after a
   * reconnect), every couple of MB, and after file-done with done = true.
   */
  | { type: 'ack'; id: string; chunk: number; done?: boolean }
  | { type: 'error'; id: string; message: string }
  /** Sender: nothing more to send; `cancelled` if the user stopped the transfer. */
  | { type: 'bye'; cancelled?: boolean };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_CONTROL_BYTES = 4096;

export function encodeControl(msg: ControlMessage): string {
  return JSON.stringify(msg);
}

const isInt = (v: unknown, min = 0, max = Number.MAX_SAFE_INTEGER) =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;

/** Parse and validate a control message from the peer; null if malformed. */
export function decodeControl(text: string): ControlMessage | null {
  if (text.length > MAX_CONTROL_BYTES) return null;
  let m: Record<string, unknown>;
  try {
    m = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof m !== 'object' || m === null) return null;
  if (m.type === 'bye') return { type: 'bye', cancelled: m.cancelled === true };
  if (typeof m.id !== 'string' || !UUID.test(m.id)) return null;
  const id = m.id;
  switch (m.type) {
    case 'file-meta': {
      if (
        typeof m.name !== 'string' ||
        m.name.length === 0 ||
        m.name.length > LIMITS.fileNameLength ||
        !isInt(m.size) ||
        typeof m.mimeType !== 'string' ||
        m.mimeType.length > 255 ||
        !isInt(m.lastModified) ||
        !isInt(m.index, 0, LIMITS.filesPerTransfer) ||
        !isInt(m.total, 1, LIMITS.filesPerTransfer)
      )
        return null;
      return {
        type: 'file-meta',
        id,
        name: m.name,
        size: m.size as number,
        mimeType: m.mimeType,
        lastModified: m.lastModified as number,
        index: m.index as number,
        total: m.total as number,
      };
    }
    case 'file-done':
      if (
        m.sha256 !== undefined &&
        !(typeof m.sha256 === 'string' && /^[0-9a-f]{64}$/.test(m.sha256))
      )
        return null;
      return { type: 'file-done', id, ...(m.sha256 ? { sha256: m.sha256 as string } : {}) };
    case 'file-cancel':
      return { type: 'file-cancel', id };
    case 'ack':
      if (!isInt(m.chunk)) return null;
      return {
        type: 'ack',
        id,
        chunk: m.chunk as number,
        ...(m.done === true ? { done: true } : {}),
      };
    case 'error':
      return {
        type: 'error',
        id,
        message: typeof m.message === 'string' ? m.message.slice(0, 200) : 'error',
      };
    default:
      return null;
  }
}

export function uuidToBytes(uuid: string): Uint8Array {
  const hex = uuid.replace(/-/g, '');
  const out = new Uint8Array(16);
  for (let i = 0; i < 16; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function bytesToUuid(b: Uint8Array): string {
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function encodeChunk(fileId: Uint8Array, index: number, payload: Uint8Array): ArrayBuffer {
  const buf = new ArrayBuffer(CHUNK_HEADER_BYTES + payload.byteLength);
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);
  view.setUint8(0, PROTOCOL_VERSION);
  bytes.set(fileId, 1);
  view.setUint32(17, index, false);
  bytes.set(payload, CHUNK_HEADER_BYTES);
  return buf;
}

export interface DecodedChunk {
  fileId: string;
  index: number;
  /** View into the received buffer (no copy). */
  data: Uint8Array;
}

export function decodeChunk(buf: ArrayBuffer, maxPayload: number): DecodedChunk | null {
  if (buf.byteLength < CHUNK_HEADER_BYTES || buf.byteLength > CHUNK_HEADER_BYTES + maxPayload)
    return null;
  const view = new DataView(buf);
  if (view.getUint8(0) !== PROTOCOL_VERSION) return null;
  return {
    fileId: bytesToUuid(new Uint8Array(buf, 1, 16)),
    index: view.getUint32(17, false),
    data: new Uint8Array(buf, CHUNK_HEADER_BYTES),
  };
}

export function chunkCount(size: number, chunkBytes: number): number {
  return Math.ceil(size / chunkBytes);
}
