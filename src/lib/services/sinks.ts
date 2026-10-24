// Sink implementations, best first:
//
// 1. FolderSink: streams straight into the folder the user picked
//    (File System Access API). createWritable() writes to a temporary
//    ".crswap" file and swaps it in on close(), so a half-received file never
//    shows up under its real name.
// 2. OpfsDownloadSink: no folder (or no permission right now). Streams to the
//    Origin Private File System, then hands the finished file to a normal
//    browser download. Nothing big has to fit in memory.
// 3. MemoryDownloadSink: last resort (browsers without OPFS writable
//    streams, e.g. older Safari). Collects a Blob, then downloads it.
// Plus TextSink for shared text/URLs, which are shown in the app, not saved.

import { LIMITS, TEXT_ITEM_MIME } from '../config';
import { availableName, sanitizeFileName } from '../core/names';
import type { FileSink, IncomingFileInfo, SavedFile, SinkFactory } from '../core/sink';
import { dirPermission, loadDirHandle } from './downloadDir';

const OPFS_DIR = 'incoming';
/** Private copies (for "Open" in the app) are kept this long… */
export const KEEP_COPY_MS = 7 * 24 * 3600_000;
/** …unless they're this big, in which case they're dropped after an hour. */
const KEEP_COPY_MAX_BYTES = 1024 * 1024 * 1024;

export type SaveMode = 'folder' | 'download';

/** Picks the best available sink for each incoming file. */
export function defaultSinkFactory(): SinkFactory {
  return async (info) => {
    if (info.mimeType === TEXT_ITEM_MIME) return new TextSink();
    if (import.meta.env.DEV && localStorage.getItem('droplink:dev-sink') === 'discard')
      return new DiscardSink();
    const dir = await loadDirHandle();
    if (dir && (await dirPermission(dir)) === 'granted') return FolderSink.create(dir, info);
    if (await supportsOpfsWritable()) return OpfsDownloadSink.create(info);
    return new MemoryDownloadSink(info);
  };
}

export async function currentSaveMode(): Promise<SaveMode> {
  const dir = await loadDirHandle();
  return dir && (await dirPermission(dir)) === 'granted' ? 'folder' : 'download';
}

class FolderSink implements FileSink {
  private constructor(
    private readonly dir: FileSystemDirectoryHandle,
    private readonly name: string,
    private readonly writable: FileSystemWritableFileStream,
    private readonly mimeType: string,
  ) {}

  static async create(dir: FileSystemDirectoryHandle, info: IncomingFileInfo): Promise<FolderSink> {
    const name = await availableName(sanitizeFileName(info.name), async (n) => {
      try {
        await dir.getFileHandle(n);
        return true;
      } catch {
        return false;
      }
    });
    const handle = await dir.getFileHandle(name, { create: true });
    return new FolderSink(dir, name, await handle.createWritable(), info.mimeType);
  }

  async write(data: Uint8Array): Promise<void> {
    await this.writable.write(data as Uint8Array<ArrayBuffer>);
  }

  async close(): Promise<SavedFile> {
    await this.writable.close();
    return { savedName: this.name, location: 'folder', mimeType: this.mimeType };
  }

  async abort(): Promise<void> {
    await this.writable.abort().catch(() => {});
    // getFileHandle(create) made an empty placeholder; remove it.
    await this.dir.removeEntry(this.name).catch(() => {});
  }
}

let opfsWritable: boolean | undefined;
async function supportsOpfsWritable(): Promise<boolean> {
  if (opfsWritable !== undefined) return opfsWritable;
  try {
    const root = await navigator.storage.getDirectory();
    const probe = await root.getFileHandle('.probe', { create: true });
    opfsWritable = typeof probe.createWritable === 'function';
    await root.removeEntry('.probe').catch(() => {});
  } catch {
    opfsWritable = false;
  }
  return opfsWritable;
}

class OpfsDownloadSink implements FileSink {
  private constructor(
    private readonly dir: FileSystemDirectoryHandle,
    private readonly tmpName: string,
    private readonly handle: FileSystemFileHandle,
    private readonly writable: FileSystemWritableFileStream,
    private readonly info: IncomingFileInfo,
  ) {}

  static async create(info: IncomingFileInfo): Promise<OpfsDownloadSink> {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle(OPFS_DIR, { create: true });
    const tmpName = `${Date.now()}-${crypto.randomUUID()}`;
    const handle = await dir.getFileHandle(tmpName, { create: true });
    return new OpfsDownloadSink(dir, tmpName, handle, await handle.createWritable(), info);
  }

  async write(data: Uint8Array): Promise<void> {
    await this.writable.write(data as Uint8Array<ArrayBuffer>);
  }

  async close(): Promise<SavedFile> {
    await this.writable.close();
    const file = await this.handle.getFile(); // disk-backed, not loaded into memory
    const name = sanitizeFileName(this.info.name);
    triggerDownload(
      new File([file], name, { type: this.info.mimeType || 'application/octet-stream' }),
      name,
    );
    // The copy stays in OPFS so the app can open it later (cleanupTempFiles
    // removes it after KEEP_COPY_MS, or after an hour for very large files).
    const keep = file.size <= KEEP_COPY_MAX_BYTES;
    return {
      savedName: name,
      location: 'download',
      mimeType: this.info.mimeType,
      ...(keep ? { copyName: this.tmpName } : {}),
    };
  }

  async abort(): Promise<void> {
    await this.writable.abort().catch(() => {});
    await this.dir.removeEntry(this.tmpName).catch(() => {});
  }
}

class MemoryDownloadSink implements FileSink {
  private parts: Uint8Array[] = [];
  constructor(private readonly info: IncomingFileInfo) {}

  async write(data: Uint8Array): Promise<void> {
    // Copy: the incoming view points into a network buffer.
    this.parts.push(data.slice());
  }

  async close(): Promise<SavedFile> {
    const name = sanitizeFileName(this.info.name);
    const blob = new Blob(this.parts as Uint8Array<ArrayBuffer>[], {
      type: this.info.mimeType || 'application/octet-stream',
    });
    this.parts = [];
    triggerDownload(blob, name);
    return { savedName: name, location: 'download' };
  }

  async abort(): Promise<void> {
    this.parts = [];
  }
}

class TextSink implements FileSink {
  private parts: Uint8Array[] = [];
  private size = 0;

  async write(data: Uint8Array): Promise<void> {
    this.size += data.byteLength;
    if (this.size > LIMITS.textItemBytes) throw new Error('Shared text is too long');
    this.parts.push(data.slice());
  }

  async close(): Promise<SavedFile> {
    const text = new TextDecoder().decode(
      await new Blob(this.parts as Uint8Array<ArrayBuffer>[]).arrayBuffer(),
    );
    return { savedName: 'Shared text', location: 'text', text };
  }

  async abort(): Promise<void> {
    this.parts = [];
  }
}

/** Dev only (localStorage droplink:dev-sink = discard): for big transfer tests. */
class DiscardSink implements FileSink {
  async write(): Promise<void> {}
  async close(): Promise<SavedFile> {
    return { savedName: '(discarded)', location: 'download' };
  }
  async abort(): Promise<void> {}
}

function triggerDownload(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Long enough for the browser to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/**
 * Remove old private copies: after KEEP_COPY_MS, or after an hour for files
 * too big to keep (those were only needed while the download was copied).
 */
export async function cleanupTempFiles(): Promise<void> {
  try {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle(OPFS_DIR, { create: true });
    const now = Date.now();
    for await (const [name, handle] of dir.entries()) {
      const ts = Number(name.split('-')[0]);
      if (!Number.isFinite(ts) || handle.kind !== 'file') {
        await dir.removeEntry(name).catch(() => {});
        continue;
      }
      const size = (await (handle as FileSystemFileHandle).getFile()).size;
      const maxAge = size > KEEP_COPY_MAX_BYTES ? 3600_000 : KEEP_COPY_MS;
      if (now - ts > maxAge) await dir.removeEntry(name).catch(() => {});
    }
  } catch {
    /* OPFS unavailable */
  }
}

/** A kept private copy, or null if it's gone. */
export async function readCopy(copyName: string): Promise<File | null> {
  try {
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle(OPFS_DIR);
    return await (await dir.getFileHandle(copyName)).getFile();
  } catch {
    return null;
  }
}

/** Delete private copies (when history is cleared). */
export async function deleteCopies(names: string[]): Promise<void> {
  try {
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle(OPFS_DIR);
    for (const n of names) await dir.removeEntry(n).catch(() => {});
  } catch {
    /* nothing to delete */
  }
}
