// Reactive view of which devices are online (mine and my contacts'), plus the
// shared SignalHub used by the transfer engine.

import type { PresenceMeta } from '../core/signal';
import { SignalHub } from '../services/signaling';
import { supabase } from '../supabase';
import { onContactsChanged, requestContactsRefresh } from './contacts.svelte';
import { deviceById, onRenamed, onSessionReady, refreshDevices, session } from './session.svelte';

export const presence = $state<{
  online: Record<string, PresenceMeta>;
  status: 'connecting' | 'connected' | 'disconnected';
}>({
  online: {},
  status: 'connecting',
});

let hub: SignalHub | null = null;
const joinListeners = new Set<(deviceId: string) => void>();

export function getSignaling(): SignalHub {
  if (!hub) throw new Error('Signaling not started');
  return hub;
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
  const h = new SignalHub({
    supabase,
    userId,
    self: { deviceId: device.id, name: device.name, kind: device.kind },
    ownerOf: (id) => deviceById(id)?.user_id,
    onPresence(online) {
      const before = presence.online;
      presence.online = Object.fromEntries(online);
      for (const [id, meta] of online) {
        if (id in before) continue;
        // A device we don't know yet (just registered, or renamed): reload.
        const known = deviceById(id);
        if (!known || known.name !== meta.name) {
          if (!known || known.user_id === session.userId) void refreshDevices();
          else requestContactsRefresh();
        }
        for (const fn of joinListeners) fn(id);
      }
    },
    onStatus(status) {
      presence.status = status;
    },
    onUnknownDevice: () => requestContactsRefresh(),
  });
  hub = h;
  const off = onContactsChanged((ids) => h.setContacts(ids));
  h.setContacts(Object.keys(session.contactNames));
  void h.start();
  return () => {
    off();
    h.stop();
    if (hub === h) hub = null;
    presence.online = {};
  };
});

// Keep our presence payload in sync with renames.
onRenamed(() => {
  if (hub && session.device) void hub.updateSelf({ name: session.device.name });
});
