import { mount } from 'svelte';
import { registerSW } from 'virtual:pwa-register';
import './app.css';
import App from './App.svelte';
import './lib/state/install.svelte';
import { navigate } from './lib/state/router.svelte';

// The service worker gives us the offline shell, the share target and push.
// New versions activate immediately (skipWaiting in sw.ts).
registerSW({ immediate: true });

// A notification was clicked while a DropLink window was already open.
navigator.serviceWorker?.addEventListener('message', (event) => {
  const msg = event.data as { type?: string; url?: string } | null;
  if (msg?.type === 'open-transfer' && typeof msg.url === 'string' && msg.url.startsWith('/'))
    navigate(msg.url);
});

const app = mount(App, { target: document.getElementById('app')! });

export default app;
