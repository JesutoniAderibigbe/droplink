import { mount } from 'svelte';
import { registerSW } from 'virtual:pwa-register';
import './app.css';
import App from './App.svelte';
import './lib/state/install.svelte';
import { navigate } from './lib/state/router.svelte';
import { transfers } from './lib/state/transfers.svelte';
import { toast } from './lib/state/toasts.svelte';

// The service worker gives us the offline shell, the share target and push.
// New versions activate immediately (skipWaiting in sw.ts). Long-open tabs
// check for a new version every hour.
registerSW({
  immediate: true,
  onRegisteredSW(_url, registration) {
    if (registration) setInterval(() => void registration.update(), 60 * 60_000);
  },
});

// When a new version takes over, switch to it: reload right away unless a
// transfer is running (a reload would cut it off), in which case offer it.
let hadController = !!navigator.serviceWorker?.controller;
navigator.serviceWorker?.addEventListener('controllerchange', () => {
  if (!hadController) {
    hadController = true; // first install, not an update
    return;
  }
  const busy =
    transfers.outgoing.some(
      (t) => !['delivered', 'relayed', 'partial', 'failed', 'cancelled'].includes(t.phase),
    ) ||
    transfers.incoming.some((t) => ['connecting', 'receiving', 'reconnecting'].includes(t.phase));
  if (!busy) location.reload();
  else
    toast('A new version of DropLink is ready', {
      action: { label: 'Reload', onClick: () => location.reload() },
      ms: 60_000,
    });
});

// A notification was clicked while a DropLink window was already open.
navigator.serviceWorker?.addEventListener('message', (event) => {
  const msg = event.data as { type?: string; url?: string } | null;
  if (msg?.type === 'open-transfer' && typeof msg.url === 'string' && msg.url.startsWith('/'))
    navigate(msg.url);
});

const app = mount(App, { target: document.getElementById('app')! });

export default app;
