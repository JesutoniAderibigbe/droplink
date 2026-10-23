// Web Push subscription for this device. The VAPID public key comes from
// VITE_VAPID_PUBLIC_KEY; the private key lives only in Supabase secrets.

import { supabase } from '../supabase';

const vapidKey = import.meta.env.VITE_VAPID_PUBLIC_KEY;

export function pushSupported(): boolean {
  return (
    !!vapidKey &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

export function pushPermission(): NotificationPermission | 'unsupported' {
  return pushSupported() ? Notification.permission : 'unsupported';
}

function keyBytes(b64url: string): Uint8Array<ArrayBuffer> {
  const b64 =
    b64url.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (b64url.length % 4)) % 4);
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

function sameKey(sub: PushSubscription, key: Uint8Array): boolean {
  const current = sub.options.applicationServerKey;
  if (!current) return false;
  const a = new Uint8Array(current);
  return a.length === key.length && a.every((v, i) => v === key[i]);
}

async function save(deviceId: string, sub: PushSubscription): Promise<void> {
  const json = sub.toJSON();
  const { error } = await supabase.rpc('save_push_subscription', {
    p_device_id: deviceId,
    p_endpoint: json.endpoint,
    p_p256dh: json.keys?.p256dh,
    p_auth: json.keys?.auth,
  });
  if (error) throw error;
}

/** Click handler: ask permission, subscribe, store the subscription. */
export async function enablePush(deviceId: string): Promise<NotificationPermission> {
  const permission = await Notification.requestPermission();
  if (permission === 'granted') await ensureSubscribed(deviceId);
  return permission;
}

/**
 * Called on every start when permission is granted: subscriptions can be
 * rotated by the browser, and the VAPID key may have changed.
 */
export async function ensureSubscribed(deviceId: string): Promise<void> {
  if (!pushSupported() || Notification.permission !== 'granted') return;
  const reg = await navigator.serviceWorker.ready;
  const key = keyBytes(vapidKey);
  let sub = await reg.pushManager.getSubscription();
  if (sub && !sameKey(sub, key)) {
    await sub.unsubscribe();
    sub = null;
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  await save(deviceId, sub);
}

/** Ask the server to push the target device (it decides whether to). */
export async function notifyDevice(transferId: string): Promise<void> {
  const { error } = await supabase.functions.invoke('notify-device', { body: { transferId } });
  if (error) throw error;
}
