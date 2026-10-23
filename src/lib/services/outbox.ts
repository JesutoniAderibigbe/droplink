// Outbox: files waiting to be sent, in IndexedDB.
//
// Two kinds of entries:
// - "shared": written by the service worker when the user shares files to
//   DropLink from another app (Android share sheet). The send screen picks
//   them up, even if the user had to sign in first.
// - "pending": a send that couldn't be delivered yet (target offline and too
//   big for the relay). It is resumed automatically when the target shows up
//   in Presence, including after the app is reopened.
//
// IndexedDB stores Blob/File objects by reference to browser-managed storage,
// so large shared videos don't have to be read into memory here.
//
// This module is imported by the service worker: no DOM APIs.

import { del, entries, get, set } from 'idb-keyval';
import { outboxStore } from './kv';

export interface OutboxFile {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  lastModified: number;
  blob: Blob;
}

export interface OutboxEntry {
  id: string;
  kind: 'shared' | 'pending';
  createdAt: number;
  files: OutboxFile[];
  /** pending only */
  targetId?: string;
}

export async function putEntry(entry: OutboxEntry): Promise<void> {
  await set(entry.id, entry, outboxStore);
}

export async function getEntry(id: string): Promise<OutboxEntry | undefined> {
  return get<OutboxEntry>(id, outboxStore);
}

export async function removeEntry(id: string): Promise<void> {
  await del(id, outboxStore);
}

export async function listEntries(kind?: OutboxEntry['kind']): Promise<OutboxEntry[]> {
  const all = (await entries<string, OutboxEntry>(outboxStore)).map(([, e]) => e);
  return all.filter((e) => !kind || e.kind === kind).sort((a, b) => a.createdAt - b.createdAt);
}

/** Combine shared title/text/url into one text item (or null if empty). */
export function sharedText(
  title: string | null,
  text: string | null,
  url: string | null,
): string | null {
  const parts: string[] = [];
  for (const p of [title, text, url]) {
    const v = p?.trim();
    // Apps often repeat the URL inside the text; don't duplicate it.
    if (v && !parts.some((x) => x.includes(v))) parts.push(v);
  }
  return parts.length ? parts.join('\n') : null;
}
