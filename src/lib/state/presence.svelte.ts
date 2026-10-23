// Reactive view of which of my devices are online, plus the shared Signaling
// instance used by the transfer engine.

import type { PresenceMeta } from '../core/signal';
import { Signaling } from '../services/signaling';
import { supabase } from '../supabase';
import { deviceById, onRenamed, onSessionReady, refreshDevices, session } from './session.svelte';

export const presence = $state<{
  online: Record<string, PresenceMeta>;
  status: 'connecting' | 'connected' | 'disconnected';
}>({
  online: {},
  status: 'connecting',
});

let signaling: Signaling | null = null;
const joinListeners = new Set<(deviceId: string) => void>();

export function getSignaling(): Signaling {
  if (!signaling) throw new Error('Signaling not started');
  return signaling;
}

export function isOnline(deviceId: string): boolean {
  return deviceId in presence.online;
}

/** Called whenever a device appears in presence (used to resume waiting sends). */
export function onDeviceJoined(fn: (deviceId: string) => void): () => void {
  joinListeners.add(fn);
  return () => joinListeners.delete(fn);
}

onSessionReady(({ userId, device }) => {
  const s = new Signaling(
    supabase,
    userId,
    { deviceId: device.id, name: device.name, kind: device.kind },
    {
      onPresence(online) {
        const before = presence.online;
        presence.online = Object.fromEntries(online);
        for (const id of online.keys()) {
          if (id in before) continue;
          // A device we don't know yet (just registered, or renamed): reload the list.
          if (!deviceById(id) || deviceById(id)?.name !== online.get(id)?.name)
            void refreshDevices();
          for (const fn of joinListeners) fn(id);
        }
      },
      onStatus(status) {
        presence.status = status;
      },
    },
  );
  signaling = s;
  void s.start();
  return () => {
    s.stop();
    if (signaling === s) signaling = null;
    presence.online = {};
  };
});

// Keep our presence payload in sync with renames.
onRenamed(() => {
  if (signaling && session.device) void signaling.updateSelf({ name: session.device.name });
});
