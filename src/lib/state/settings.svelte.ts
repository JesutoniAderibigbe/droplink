// Per-user, per-browser preferences (IndexedDB).

import { get, set } from 'idb-keyval';
import { keys, kvStore } from '../services/kv';
import { onSessionReady } from './session.svelte';

export interface Settings {
  /** Preselected target in the device picker. Falls back to the last used one. */
  defaultTargetId: string | null;
  /** Share target: send to the default device without showing the picker. */
  autoSend: boolean;
  lastTargetId: string | null;
  /** Use the encrypted relay when the other device doesn't answer (≤ 100 MB). */
  relayEnabled: boolean;
  /** Hide the notifications / install explainer cards once dismissed. */
  dismissedPushCard: boolean;
  dismissedInstallCard: boolean;
}

const defaults: Settings = {
  defaultTargetId: null,
  autoSend: false,
  lastTargetId: null,
  relayEnabled: true,
  dismissedPushCard: false,
  dismissedInstallCard: false,
};

export const settings = $state<Settings & { loaded: boolean }>({ ...defaults, loaded: false });
let userId: string | null = null;

onSessionReady(({ userId: uid }) => {
  userId = uid;
  void get<Partial<Settings>>(keys.settings(uid), kvStore).then((s) => {
    Object.assign(settings, defaults, s ?? {}, { loaded: true });
  });
  return () => {
    userId = null;
    Object.assign(settings, defaults, { loaded: false });
  };
});

export async function updateSettings(patch: Partial<Settings>): Promise<void> {
  Object.assign(settings, patch);
  if (!userId) return;
  const { loaded: _loaded, ...rest } = $state.snapshot(settings);
  await set(keys.settings(userId), rest, kvStore);
}

/** The device to preselect: explicit default, else last used, if still available. */
export function preferredTarget(candidates: string[]): string | null {
  for (const id of [settings.defaultTargetId, settings.lastTargetId])
    if (id && candidates.includes(id)) return id;
  return null;
}
