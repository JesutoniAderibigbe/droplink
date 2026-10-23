// The download folder chosen with the File System Access API (Chrome/Edge on
// desktop). The handle is stored in IndexedDB so the user picks it once.
//
// Permission model: a stored handle survives restarts, but its permission
// usually doesn't. On later visits queryPermission() returns "prompt", and
// requestPermission() may only be called from a user gesture (a click). So
// the UI shows a one-click "Allow access to <folder>" button when needed.
// Chrome 122+ also offers "Allow on every visit", after which queryPermission()
// returns "granted" right away.

import { del, get, set } from 'idb-keyval';
import { keys, kvStore } from './kv';

type PermissionState = 'granted' | 'prompt' | 'denied';

interface PermissionedHandle extends FileSystemDirectoryHandle {
  queryPermission(desc: { mode: 'readwrite' }): Promise<PermissionState>;
  requestPermission(desc: { mode: 'readwrite' }): Promise<PermissionState>;
}

declare global {
  interface Window {
    showDirectoryPicker?: (opts?: {
      id?: string;
      mode?: 'readwrite';
      startIn?: string;
    }) => Promise<FileSystemDirectoryHandle>;
  }
}

export function supportsFolderPicker(): boolean {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
}

export async function loadDirHandle(): Promise<PermissionedHandle | undefined> {
  return get<PermissionedHandle>(keys.dirHandle, kvStore);
}

/** Must be called from a click handler. */
export async function chooseDirectory(): Promise<PermissionedHandle> {
  const handle = (await window.showDirectoryPicker!({
    id: 'droplink',
    mode: 'readwrite',
    startIn: 'downloads',
  })) as PermissionedHandle;
  await set(keys.dirHandle, handle, kvStore);
  return handle;
}

export async function forgetDirectory(): Promise<void> {
  await del(keys.dirHandle, kvStore);
}

export async function dirPermission(handle: PermissionedHandle): Promise<PermissionState> {
  try {
    return await handle.queryPermission({ mode: 'readwrite' });
  } catch {
    return 'denied';
  }
}

/** Must be called from a click handler. */
export async function requestDirPermission(handle: PermissionedHandle): Promise<PermissionState> {
  try {
    return await handle.requestPermission({ mode: 'readwrite' });
  } catch {
    return 'denied';
  }
}
