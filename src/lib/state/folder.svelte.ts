// Download folder status for the UI (desktop Chrome/Edge).
import {
  chooseDirectory,
  dirPermission,
  forgetDirectory,
  loadDirHandle,
  requestDirPermission,
  supportsFolderPicker,
} from '../services/downloadDir';

export const folder = $state<{
  supported: boolean;
  name: string | null;
  permission: 'granted' | 'prompt' | 'denied' | 'none';
}>({ supported: supportsFolderPicker(), name: null, permission: 'none' });

export async function refreshFolder(): Promise<void> {
  const h = await loadDirHandle();
  folder.name = h?.name ?? null;
  folder.permission = h ? await dirPermission(h) : 'none';
}

/** Click handler: pick a folder. */
export async function pickFolder(): Promise<void> {
  try {
    const h = await chooseDirectory();
    folder.name = h.name;
    folder.permission = await dirPermission(h);
  } catch (e) {
    if ((e as Error).name !== 'AbortError') throw e;
  }
}

/** Click handler: re-grant access after a browser restart. */
export async function reallowFolder(): Promise<void> {
  const h = await loadDirHandle();
  if (!h) return;
  folder.permission = await requestDirPermission(h);
}

export async function clearFolder(): Promise<void> {
  await forgetDirectory();
  folder.name = null;
  folder.permission = 'none';
}

if (folder.supported) {
  void refreshFolder();
  // Permission can change while the page is open (site settings, other tabs).
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void refreshFolder();
  });
}
