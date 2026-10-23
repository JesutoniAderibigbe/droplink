import { enablePush, ensureSubscribed, notifyDevice, pushPermission } from '../services/push';
import { onSessionReady, session } from './session.svelte';
import { configureEngine } from './transfers.svelte';

export const push = $state<{ permission: NotificationPermission | 'unsupported' }>({
  permission: pushPermission(),
});

configureEngine({ notifyOffline: ({ transferId }) => notifyDevice(transferId) });

onSessionReady(({ device }) => {
  push.permission = pushPermission();
  ensureSubscribed(device.id).catch((e) =>
    console.warn('[push] subscribe failed', (e as Error)?.message),
  );
});

/** Click handler for the explainer card. */
export async function turnOnNotifications(): Promise<void> {
  if (!session.device) return;
  push.permission = await enablePush(session.device.id);
}
