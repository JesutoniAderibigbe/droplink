// Signaling messages exchanged over Supabase Realtime Broadcast on the private
// channel user:{userId}. Every device of the user receives every message, so
// each one is addressed ({ to, from }) and devices ignore what isn't theirs.
// Payloads come from the network: validate shape and size before use.

import type { DeviceKind } from './types';

export const SIGNAL_TYPES = [
  'offer',
  'answer',
  'ice',
  'transfer-request',
  'transfer-accept',
  'transfer-decline',
] as const;
export type SignalType = (typeof SIGNAL_TYPES)[number];

interface Base {
  to: string;
  from: string;
  transferId: string;
}

export interface OfferSignal extends Base {
  /** Increments on every reconnect so stale answers/candidates are dropped. */
  attempt: number;
  sdp: string;
}
export type AnswerSignal = OfferSignal;
export interface IceSignal extends Base {
  attempt: number;
  candidate: RTCIceCandidateInit | null;
}
export interface TransferRequestSignal extends Base {
  fromName: string;
  fileCount: number;
  totalBytes: number;
}
export type TransferAcceptSignal = Base;
export interface TransferDeclineSignal extends Base {
  reason: 'busy' | 'declined' | 'unknown';
}

export interface SignalMap {
  offer: OfferSignal;
  answer: AnswerSignal;
  ice: IceSignal;
  'transfer-request': TransferRequestSignal;
  'transfer-accept': TransferAcceptSignal;
  'transfer-decline': TransferDeclineSignal;
}

export interface PresenceMeta {
  deviceId: string;
  name: string;
  kind: DeviceKind;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_SDP = 64 * 1024;
const MAX_CANDIDATE = 2048;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);
const isInt = (v: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
const isStr = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max;

/** Returns the typed payload, or null if it's malformed. */
export function parseSignal<T extends SignalType>(type: T, raw: unknown): SignalMap[T] | null {
  if (!isObj(raw) || !isUuid(raw.to) || !isUuid(raw.from) || !isUuid(raw.transferId)) return null;
  switch (type) {
    case 'offer':
    case 'answer':
      if (!isInt(raw.attempt, 0, 1000) || !isStr(raw.sdp, MAX_SDP)) return null;
      break;
    case 'ice': {
      if (!isInt(raw.attempt, 0, 1000)) return null;
      const c = raw.candidate;
      if (c !== null) {
        if (!isObj(c) || !isStr(c.candidate, MAX_CANDIDATE)) return null;
        if (c.sdpMid != null && !isStr(c.sdpMid, 64)) return null;
        if (c.sdpMLineIndex != null && !isInt(c.sdpMLineIndex, 0, 64)) return null;
      }
      break;
    }
    case 'transfer-request':
      if (!isStr(raw.fromName, 60) || !isInt(raw.fileCount, 1, 10_000) || !isInt(raw.totalBytes))
        return null;
      break;
    case 'transfer-decline':
      if (!['busy', 'declined', 'unknown'].includes(raw.reason as string)) return null;
      break;
    case 'transfer-accept':
      break;
    default:
      return null;
  }
  return raw as unknown as SignalMap[T];
}

export function parsePresence(raw: unknown): PresenceMeta | null {
  if (!isObj(raw) || !isUuid(raw.deviceId) || !isStr(raw.name, 60) || !isStr(raw.kind, 16))
    return null;
  return { deviceId: raw.deviceId, name: raw.name, kind: raw.kind as DeviceKind };
}
