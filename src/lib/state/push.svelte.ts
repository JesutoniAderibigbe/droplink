import {
  disablePush,
  enablePush,
  ensureSubscribed,
  isSubscribed,
  notifyDevice,
  pushPermission,
} from '../services/push';
import { onSessionReady, session } from './session.svelte';
import { configureEngine } from './transfers.svelte';

export const push = $state<{
  permission: NotificationPermission | 'unsupported';
  subscribed: boolean;
}>({
  permission: pushPermission(),
  subscribed: false,
});

configureEngine({ notifyOffline: ({ transferId }) => notifyDevice(transferId) });

onSessionReady(({ device }) => {
  push.permission = pushPermission();
  ensureSubscribed(device.id)
    .catch((e) => console.warn('[push] subscribe failed', (e as Error)?.message))
    .finally(() => void isSubscribed().then((v) => (push.subscribed = v)));
});

/** Click handler: ask permission and subscribe this device. */
export async function turnOnNotifications(): Promise<void> {
  if (!session.device) return;
  push.permission = await enablePush(session.device.id);
  push.subscribed = await isSubscribed();
}

/** Stop notifications for this device (removes its subscription). */
export async function turnOffNotifications(): Promise<void> {
  await disablePush();
  push.subscribed = false;
}
