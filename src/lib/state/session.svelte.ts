// Signed-in session: this device's identity and row, and the user's device list.
// Started once per sign-in from Signed.svelte; everything else (presence,
// receiving, push, relay inbox) hangs off `onSessionReady`.

import { defaultDeviceName, detectKind } from '../core/deviceName';
import type { DeviceRow } from '../core/types';
import { humanError } from '../core/errors';
import { PRESENCE } from '../config';
import {
  createIdentity,
  forgetIdentity,
  loadIdentity,
  type DeviceIdentity,
} from '../services/identity';
import * as devicesApi from '../services/devices';
import { signOut } from './auth.svelte';

type Phase = 'idle' | 'starting' | 'ready' | 'error';

export const session = $state<{
  phase: Phase;
  userId: string | null;
  identity: DeviceIdentity | null;
  device: DeviceRow | null;
  devices: DeviceRow[];
  error: string;
}>({ phase: 'idle', userId: null, identity: null, device: null, devices: [], error: '' });

/** Other (non-revoked) devices of this user. */
export function otherDevices(): DeviceRow[] {
  return session.devices.filter((d) => d.id !== session.device?.id);
}

export function deviceById(id: string | null | undefined): DeviceRow | undefined {
  return session.devices.find((d) => d.id === id);
}

const REVOKED_FLAG = 'droplink:revoked';

/** Shown on the landing page after a revoked device is signed out. */
export function consumeRevokedNotice(): boolean {
  const v = sessionStorage.getItem(REVOKED_FLAG) === '1';
  sessionStorage.removeItem(REVOKED_FLAG);
  return v;
}

type ReadyHook = (s: {
  userId: string;
  identity: DeviceIdentity;
  device: DeviceRow;
}) => (() => void) | void;
const readyHooks: ReadyHook[] = [];
let teardowns: (() => void)[] = [];

/** Register something to start when the device is ready (and stop on sign-out). */
export function onSessionReady(hook: ReadyHook): void {
  readyHooks.push(hook);
}

let lastSeenTimer: ReturnType<typeof setInterval> | undefined;

export async function startSession(userId: string): Promise<void> {
  if (session.userId === userId && session.phase !== 'error') return;
  stopSession();
  session.userId = userId;
  session.phase = 'starting';
  session.error = '';
  try {
    const { identity, device } = await ensureDevice(userId);
    if (!device) return; // revoked; already signing out
    session.identity = identity;
    session.device = device;
    await refreshDevices();
    session.phase = 'ready';

    lastSeenTimer = setInterval(() => void heartbeat(), PRESENCE.lastSeenIntervalMs);
    for (const hook of readyHooks) {
      const t = hook({ userId, identity, device });
      if (t) teardowns.push(t);
    }
  } catch (e) {
    console.error('[session] start failed', e);
    session.phase = 'error';
    session.error = humanError(e);
  }
}

export function stopSession(): void {
  clearInterval(lastSeenTimer);
  for (const t of teardowns) t();
  teardowns = [];
  Object.assign(session, {
    phase: 'idle',
    userId: null,
    identity: null,
    device: null,
    devices: [],
    error: '',
  });
}

/**
 * Load or create this browser's identity for this user and make sure the
 * device row exists. Returns device = null if this device was revoked (in
 * which case we sign out, per the spec).
 */
async function ensureDevice(
  userId: string,
): Promise<{ identity: DeviceIdentity; device: DeviceRow | null }> {
  const identity = await loadIdentity(userId);
  if (identity) {
    const row = await devicesApi.fetchDevice(identity.deviceId);
    if (row?.revoked_at) {
      await handleRevoked(userId);
      return { identity, device: null };
    }
    if (row) return { identity, device: row };
    // Row missing (e.g. local DB reset): re-register with the same keys. If the
    // id is somehow taken, start over with a fresh identity below.
    try {
      return { identity, device: await register(userId, identity) };
    } catch {
      // fall through to a fresh identity
    }
  }
  const fresh = await createIdentity(userId);
  return { identity: fresh, device: await register(userId, fresh) };
}

function register(userId: string, identity: DeviceIdentity): Promise<DeviceRow> {
  const hints = { userAgent: navigator.userAgent, maxTouchPoints: navigator.maxTouchPoints };
  return devicesApi.registerDevice({
    id: identity.deviceId,
    userId,
    name: defaultDeviceName(hints),
    kind: detectKind(hints),
    publicJwk: identity.publicJwk,
  });
}

async function handleRevoked(userId: string): Promise<void> {
  await forgetIdentity(userId);
  sessionStorage.setItem(REVOKED_FLAG, '1');
  stopSession();
  await signOut();
}

export async function refreshDevices(): Promise<void> {
  session.devices = await devicesApi.listDevices();
  const me = session.devices.find((d) => d.id === session.device?.id);
  if (me) session.device = me;
}

async function heartbeat(): Promise<void> {
  const id = session.device?.id;
  if (!id || document.visibilityState !== 'visible') return;
  try {
    await devicesApi.touchLastSeen(id);
  } catch (e) {
    if (/revoked/i.test(String((e as Error)?.message)) && session.userId)
      await handleRevoked(session.userId);
  }
}

const renameListeners = new Set<() => void>();
/** Notified after this device is renamed (presence re-announces the name). */
export function onRenamed(fn: () => void): void {
  renameListeners.add(fn);
}

export async function renameDevice(id: string, name: string): Promise<void> {
  await devicesApi.renameDevice(id, name);
  await refreshDevices();
  if (id === session.device?.id) for (const fn of renameListeners) fn();
}

export async function removeDevice(id: string): Promise<void> {
  await devicesApi.revokeDevice(id);
  if (id === session.device?.id && session.userId) {
    await handleRevoked(session.userId);
    return;
  }
  await refreshDevices();
}
