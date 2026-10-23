// What happens in the UI when something arrives: open the Receive screen,
// show an in-app toast, and, if the app is in the background, a system
// notification (through the service worker, so it works on Android too).

import { describeFiles } from '../core/format';
import { navigate, router } from './router.svelte';
import { onSessionReady } from './session.svelte';
import { toast } from './toasts.svelte';
import { onFileReceived, transfers } from './transfers.svelte';

const announced = new Set<string>();

async function systemNotify(title: string, body: string, tag: string): Promise<void> {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const reg = await navigator.serviceWorker?.getRegistration();
  if (reg)
    await reg.showNotification(title, {
      body,
      tag,
      icon: '/icons/icon-192.png',
      data: { url: '/receive' },
    });
  else new Notification(title, { body, tag });
}

onSessionReady(() => {
  const offReceived = onFileReceived((t, f) => {
    const what = f.saved?.location === 'text' ? 'text' : `“${f.saved?.savedName ?? f.name}”`;
    if (router.route !== 'receive') {
      toast(`Received ${what} from ${t.fromName}`, {
        kind: 'ok',
        action: { label: 'View', href: '/receive' },
      });
    }
    if (document.visibilityState === 'hidden') {
      const done = t.files.filter((x) => x.status === 'done');
      const body =
        done.length > 1
          ? `${done.length} files received`
          : f.saved?.location === 'text'
            ? 'Shared text'
            : (f.saved?.savedName ?? f.name);
      void systemNotify(`From ${t.fromName}`, body, `received-${t.id}`);
    }
  });

  // A new incoming transfer: jump to Receive from Home, otherwise toast.
  const stop = $effect.root(() => {
    $effect(() => {
      for (const t of transfers.incoming) {
        if (announced.has(t.id)) continue;
        announced.add(t.id);
        if (router.route === 'home') navigate('/receive');
        else if (router.route !== 'receive') {
          toast(`${t.fromName} is sending ${describeFiles(t.fileCount, t.totalBytes)}`, {
            action: { label: 'View', href: '/receive' },
          });
        }
      }
    });
  });

  return () => {
    offReceived();
    stop();
    announced.clear();
  };
});
