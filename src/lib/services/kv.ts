// IndexedDB stores (idb-keyval). Kept free of DOM APIs because the service
// worker imports the outbox store too.
import { createStore } from 'idb-keyval';

/** Device identity, settings, the saved download folder handle, history. */
export const kvStore = createStore('droplink-kv', 'kv');
/** Files waiting to be sent (written by the share target in the SW). */
export const outboxStore = createStore('droplink-outbox', 'outbox');

export const keys = {
  identity: (userId: string) => `identity:${userId}`,
  settings: (userId: string) => `settings:${userId}`,
  received: (deviceId: string) => `received:${deviceId}`,
  dirHandle: 'download-dir',
} as const;
