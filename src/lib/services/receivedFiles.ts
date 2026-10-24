// Getting a received file back so the app can open or share it.
//
// - Saved into the chosen folder: read it through the stored folder handle
//   (asking for permission again if the browser dropped it; this runs from a
//   click, so the prompt is allowed).
// - Saved as a normal download: browsers never let a page read the Downloads
//   folder, so we use the private copy kept in OPFS (see sinks.ts).

import { dirPermission, loadDirHandle, requestDirPermission } from './downloadDir';
import { readCopy } from './sinks';

export interface OpenableItem {
  savedName: string;
  location: 'folder' | 'download' | 'text';
  copyName?: string;
  mimeType?: string;
}

/** Whether "Open" can work for this item at all. */
export function canOpen(item: OpenableItem): boolean {
  return item.location === 'folder' || !!item.copyName;
}

export async function getReceivedFile(item: OpenableItem): Promise<File | null> {
  const type = item.mimeType || guessType(item.savedName);
  if (item.location === 'folder') {
    const dir = await loadDirHandle();
    if (dir) {
      let perm = await dirPermission(dir);
      if (perm === 'prompt') perm = await requestDirPermission(dir);
      if (perm === 'granted') {
        try {
          const f = await (await dir.getFileHandle(item.savedName)).getFile();
          return f.type ? f : new File([f], item.savedName, { type });
        } catch {
          /* moved or deleted: try the copy */
        }
      }
    }
  }
  if (item.copyName) {
    const f = await readCopy(item.copyName);
    if (f) return new File([f], item.savedName, { type, lastModified: f.lastModified });
  }
  return null;
}

export type Viewable = 'image' | 'video' | 'audio' | 'other';

export function viewKind(file: File): Viewable {
  const t = file.type;
  if (t.startsWith('image/') && !/heic|heif/.test(t)) return 'image';
  if (t.startsWith('video/')) return 'video';
  if (t.startsWith('audio/')) return 'audio';
  return 'other';
}

/** PDFs, text and anything else: let the browser show it in a new tab. */
export function openInNewTab(file: File): void {
  const url = URL.createObjectURL(file);
  // No 'noopener': with it window.open always returns null, which would look
  // like a blocked popup. The URL is our own blob, so the opener link is harmless.
  const w = window.open(url, '_blank');
  if (!w) {
    // Popup blocked (some installed-app views): fall back to a download.
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    a.click();
  }
  setTimeout(() => URL.revokeObjectURL(url), 5 * 60_000);
}

export function canShareFiles(): boolean {
  return typeof navigator.canShare === 'function';
}

/** Hand the file to the system share sheet (Gallery, Files, WhatsApp…). */
export async function shareFile(file: File): Promise<'shared' | 'unsupported' | 'cancelled'> {
  if (!navigator.canShare?.({ files: [file] })) return 'unsupported';
  try {
    await navigator.share({ files: [file], title: file.name });
    return 'shared';
  } catch (e) {
    if ((e as Error).name === 'AbortError') return 'cancelled';
    throw e;
  }
}

const EXT_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  heic: 'image/heic',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  m4v: 'video/mp4',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  opus: 'audio/ogg',
  pdf: 'application/pdf',
  txt: 'text/plain',
};
function guessType(name: string): string {
  return EXT_TYPES[(name.split('.').pop() ?? '').toLowerCase()] ?? 'application/octet-stream';
}
