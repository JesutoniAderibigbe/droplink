// Reactive transfer state for the UI, backed by the TransferEngine.

import { get, set } from 'idb-keyval';
import type { SendFile } from '../core/sink';
import { keys, kvStore } from '../services/kv';
import * as outbox from '../services/outbox';
import { cleanupTempFiles, defaultSinkFactory } from '../services/sinks';
import { getIceServers } from '../services/ice';
import {
  TransferEngine,
  type EngineDeps,
  type IncomingFileView,
  type IncomingView,
  type OutgoingView,
} from '../services/transferEngine';
import { getSignaling, isOnline, onDeviceJoined } from './presence.svelte';
import { deviceById, deviceLabel, onSessionReady, refreshDevices, session } from './session.svelte';
import { refreshContacts } from './contacts.svelte';

export interface ReceivedItem {
  transferId: string;
  fileId: string;
  name: string;
  savedName: string;
  size: number;
  fromName: string;
  location: 'folder' | 'download' | 'text';
  text?: string;
  at: number;
  checksumOk?: boolean;
  mimeType?: string;
}

export const transfers = $state<{
  outgoing: OutgoingView[];
  incoming: IncomingView[];
  received: ReceivedItem[];
  sent: SentItem[];
}>({ outgoing: [], incoming: [], received: [], sent: [] });

/**
 * Files this device delivered. Kept only on this device: the server never
 * stores file names. Feeds Home's "Recent".
 */
export interface SentItem {
  transferId: string;
  fileId: string;
  name: string;
  mimeType: string;
  size: number;
  toName: string;
  via: 'p2p' | 'relay';
  at: number;
}

type ReceivedListener = (t: IncomingView, f: IncomingFileView, item: ReceivedItem) => void;
const receivedListeners = new Set<ReceivedListener>();
/** Toasts and system notifications subscribe here. */
export function onFileReceived(fn: ReceivedListener): () => void {
  receivedListeners.add(fn);
  return () => receivedListeners.delete(fn);
}

const extraDeps: Partial<Pick<EngineDeps, 'notifyOffline' | 'relay'>> = {};
/** Later milestones plug in push and the relay here. */
export function configureEngine(deps: Partial<Pick<EngineDeps, 'notifyOffline' | 'relay'>>): void {
  Object.assign(extraDeps, deps);
}

let engine: TransferEngine | null = null;
let historyKey: string | null = null;
let sentKey: string | null = null;
const recordedSent = new Set<string>();

/** When a send finishes, remember the delivered files (names stay local). */
function recordSent(v: OutgoingView): void {
  if (!['delivered', 'relayed', 'partial'].includes(v.phase) || recordedSent.has(v.id)) return;
  recordedSent.add(v.id);
  const t = engine?.getOutgoing(v.id);
  const items: SentItem[] = v.files
    .filter((f) => f.status === 'done')
    .map((f) => ({
      transferId: v.id,
      fileId: f.id,
      name: f.name,
      mimeType: t?.files.get(f.id)?.mimeType ?? '',
      size: f.size,
      toName: v.targetName,
      via: v.phase === 'relayed' ? 'relay' : 'p2p',
      at: Date.now(),
    }));
  transfers.sent = [...items, ...transfers.sent].slice(0, HISTORY_LIMIT);
  if (sentKey) void set(sentKey, $state.snapshot(transfers.sent), kvStore);
}

export function upsertIncoming(v: IncomingView): void {
  transfers.incoming = upsert(transfers.incoming, v);
}

/** Add to this device's received history, and tell toasts/notifications. */
export function recordReceivedFile(t: IncomingView, f: IncomingFileView): void {
  const item: ReceivedItem = {
    transferId: t.id,
    fileId: f.id,
    name: f.name,
    savedName: f.saved?.savedName ?? f.name,
    size: f.size,
    fromName: t.fromName,
    location: f.saved?.location ?? 'download',
    text: f.saved?.text,
    at: Date.now(),
    checksumOk: f.checksumOk,
    mimeType: f.saved?.mimeType,
  };
  transfers.received = [item, ...transfers.received].slice(0, HISTORY_LIMIT);
  if (historyKey) void set(historyKey, $state.snapshot(transfers.received), kvStore);
  for (const fn of receivedListeners) fn(t, f, item);
}
export function getEngine(): TransferEngine {
  if (!engine) throw new Error('Transfer engine not started');
  return engine;
}

function upsert<T extends { id: string }>(list: T[], v: T): T[] {
  const i = list.findIndex((x) => x.id === v.id);
  if (i === -1) return [v, ...list];
  const next = list.slice();
  next[i] = v;
  return next;
}

const HISTORY_LIMIT = 200;

onSessionReady(({ userId, device }) => {
  void cleanupTempFiles();
  // Fetch STUN/TURN servers now, so pressing Send doesn't wait on it.
  void getIceServers();
  historyKey = keys.received(device.id);
  sentKey = keys.sent(device.id);
  void get<SentItem[]>(keys.sent(device.id), kvStore).then((h) => {
    transfers.sent = h ?? [];
  });
  void get<ReceivedItem[]>(keys.received(device.id), kvStore).then((h) => {
    transfers.received = h ?? [];
  });

  const e = new TransferEngine({
    signaling: getSignaling(),
    userId,
    self: () => session.device!,
    device: deviceById,
    label: deviceLabel,
    refreshDevices: async () => {
      await Promise.all([refreshDevices(), refreshContacts()]);
    },
    isOnline,
    onDeviceJoined,
    sinkFactory: defaultSinkFactory(),
    checksum: import.meta.env.DEV,
    get notifyOffline() {
      return extraDeps.notifyOffline;
    },
    get relay() {
      return extraDeps.relay;
    },
    onOutgoing: (v) => {
      transfers.outgoing = upsert(transfers.outgoing, v);
      void persistOutbox(v);
      recordSent(v);
    },
    onIncoming: upsertIncoming,
    onFileReceived: recordReceivedFile,
  });
  engine = e;
  void resumePending(e);
  if (import.meta.env.DEV) {
    // Dev/test hook: simulate a network drop on every active connection.
    (window as unknown as { __droplink: object }).__droplink = {
      dropConnections: () => e.devDropConnections(),
    };
  }
  return () => {
    e.stop();
    if (engine === e) engine = null;
    transfers.outgoing = [];
    transfers.incoming = [];
    transfers.received = [];
    transfers.sent = [];
  };
});

// --- Outbox: survive reloads while waiting for an offline device ------------

const persisted = new Set<string>();
const TERMINAL = new Set(['delivered', 'relayed', 'partial', 'failed', 'cancelled']);

async function persistOutbox(v: OutgoingView): Promise<void> {
  const key = `pending:${v.id}`;
  if (v.phase === 'queued' && !persisted.has(v.id)) {
    persisted.add(v.id);
    const t = engine?.getOutgoing(v.id);
    if (!t) return;
    const files = t.queue.remaining.map((i) => t.files.get(i.id)!);
    try {
      await outbox.putEntry({
        id: key,
        kind: 'pending',
        createdAt: Date.now(),
        targetId: v.targetId,
        files: files.map((f) => ({
          id: f.id,
          name: f.name,
          mimeType: f.mimeType,
          size: f.size,
          lastModified: f.lastModified,
          blob: f.blob,
        })),
      });
    } catch (e) {
      // Usually out of quota for very large files: it still sends while the app stays open.
      console.warn('[outbox] could not persist pending send', (e as Error).name);
    }
  } else if (TERMINAL.has(v.phase) && persisted.has(v.id)) {
    persisted.delete(v.id);
    await outbox.removeEntry(key);
  }
}

/** Re-start sends that were waiting for an offline device when the app closed. */
async function resumePending(e: TransferEngine): Promise<void> {
  for (const entry of await outbox.listEntries('pending')) {
    const target = entry.targetId ? deviceById(entry.targetId) : undefined;
    await outbox.removeEntry(entry.id);
    if (!target || entry.files.length === 0) continue;
    e.send(target, entry.files);
  }
}

/** Start a send. Returns its createdAt, which identifies its view in transfers.outgoing. */
export function sendFiles(targetId: string, files: SendFile[]): number | null {
  const target = deviceById(targetId);
  if (!target || files.length === 0) return null;
  return getEngine().send(target, files).createdAt;
}

export function relayNow(id: string): void {
  engine?.getOutgoing(id)?.relayNow();
}

export function cancelOutgoing(id: string): void {
  engine?.getOutgoing(id)?.cancel();
}

export function cancelOutgoingFile(id: string, fileId: string): void {
  engine?.getOutgoing(id)?.cancelFile(fileId);
}

export function cancelIncomingFile(transferId: string, fileId: string): void {
  engine?.cancelIncomingFile(transferId, fileId);
}

export async function clearHistory(): Promise<void> {
  transfers.received = [];
  transfers.sent = [];
  if (session.device) {
    await set(keys.received(session.device.id), [], kvStore);
    await set(keys.sent(session.device.id), [], kvStore);
  }
}

/** Wrap browser File objects for sending. */
export function toSendFiles(list: Iterable<File>): SendFile[] {
  return [...list].map((f) => ({
    id: crypto.randomUUID(),
    blob: f,
    name: f.name || 'file',
    size: f.size,
    mimeType: f.type || 'application/octet-stream',
    lastModified: f.lastModified || Date.now(),
  }));
}
