import { clear, del } from 'idb-keyval';
import { supabase } from '../supabase';
import { keys, kvStore, outboxStore } from './kv';

/** Delete the account on the server, then everything DropLink keeps in this browser. */
export async function deleteAccount(userId: string, deviceId: string | null): Promise<void> {
  const { error } = await supabase.functions.invoke('delete-account', {
    body: { confirm: 'DELETE' },
  });
  if (error) throw error;

  await Promise.allSettled([
    del(keys.identity(userId), kvStore),
    del(keys.settings(userId), kvStore),
    deviceId ? del(keys.received(deviceId), kvStore) : Promise.resolve(),
    del(keys.dirHandle, kvStore),
    clear(outboxStore),
    navigator.serviceWorker?.ready
      .then((r) => r.pushManager.getSubscription())
      .then((s) => s?.unsubscribe()),
  ]);
  // The user no longer exists server side; just drop the local session.
  await supabase.auth.signOut({ scope: 'local' });
}
