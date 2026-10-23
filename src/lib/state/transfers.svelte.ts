// Reactive transfer state for the UI, backed by the TransferEngine.

import { get, set } from 'idb-keyval';
import type { SendFile } from '../core/sink';
import { keys, kvStore } from '../services/kv';
import { cleanupTempFiles, defaultSinkFactory } from '../services/sinks';
import {
  TransferEngine,
  type EngineDeps,
  type IncomingFileView,
  type IncomingView,
  type OutgoingView,
} from '../services/transferEngine';
import { getSignaling, isOnline, onDeviceJoined } from './presence.svelte';
import { deviceById, onSessionReady, refreshDevices, session } from './session.svelte';

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
}

export const transfers = $state<{
  outgoing: OutgoingView[];
  incoming: IncomingView[];
  received: ReceivedItem[];
}>({ outgoing: [], incoming: [], received: [] });

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
  void get<ReceivedItem[]>(keys.received(device.id), kvStore).then((h) => {
    transfers.received = h ?? [];
  });

  const e = new TransferEngine({
    signaling: getSignaling(),
    userId,
    self: () => session.device!,
    device: deviceById,
    refreshDevices,
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
    },
    onIncoming: (v) => {
      transfers.incoming = upsert(transfers.incoming, v);
    },
    onFileReceived: (t, f) => {
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
      };
      transfers.received = [item, ...transfers.received].slice(0, HISTORY_LIMIT);
      void set(keys.received(device.id), $state.snapshot(transfers.received), kvStore);
      for (const fn of receivedListeners) fn(t, f, item);
    },
  });
  engine = e;
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
  };
});

export function sendFiles(targetId: string, files: SendFile[]): string | null {
  const target = deviceById(targetId);
  if (!target || files.length === 0) return null;
  const t = getEngine().send(target, files);
  return t.id || null;
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
  if (session.device) await set(keys.received(session.device.id), [], kvStore);
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
