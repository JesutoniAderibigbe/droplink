/// <reference lib="webworker" />
// DropLink service worker (vite-plugin-pwa, injectManifest strategy).
//
// 1. Precaches the app shell so the UI opens offline, and serves index.html
//    for navigations (it's a single-page app with real paths).
// 2. Share target: Android's share sheet POSTs multipart form data to
//    /share-target. There's no server behind that path. We read the files
//    here, store them in the IndexedDB outbox, and redirect (303) to
//    /send?shared=1, where the page picks them up.
// 3. Web Push: show "Toni's Pixel wants to send 3 files, 24 MB", and on click
//    focus an open DropLink window (or open one) at /receive?transfer=<id>.

import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
} from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { LIMITS, TEXT_ITEM_MIME } from './lib/config';
import { putEntry, sharedText, type OutboxFile } from './lib/services/outbox';
import { parsePushPayload, pushNotificationContent } from './lib/core/push';

declare const self: ServiceWorkerGlobalScope;

cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

// Every navigation gets the cached app shell, except Supabase paths that the
// dev server proxies (OAuth/magic-link callbacks pass through /auth/v1).
registerRoute(
  new NavigationRoute(createHandlerBoundToURL('/index.html'), {
    denylist: [/^\/(auth|rest|storage|functions|realtime)\/v1\//],
  }),
);

// --- Share target ------------------------------------------------------------

registerRoute(
  ({ url, request }) => url.pathname === '/share-target' && request.method === 'POST',
  async ({ request }) => {
    try {
      const form = await request.formData();
      const files: OutboxFile[] = [];
      for (const value of form.getAll('files')) {
        if (!(value instanceof File) || files.length >= LIMITS.filesPerTransfer) continue;
        files.push({
          id: crypto.randomUUID(),
          name: value.name || 'shared-file',
          mimeType: value.type || 'application/octet-stream',
          size: value.size,
          lastModified: value.lastModified || Date.now(),
          blob: value,
        });
      }
      const text = sharedText(str(form.get('title')), str(form.get('text')), str(form.get('url')));
      if (text) {
        const blob = new Blob([text.slice(0, LIMITS.textItemBytes)], { type: TEXT_ITEM_MIME });
        files.push({
          id: crypto.randomUUID(),
          name: 'Shared text',
          mimeType: TEXT_ITEM_MIME,
          size: blob.size,
          lastModified: Date.now(),
          blob,
        });
      }
      if (files.length)
        await putEntry({ id: crypto.randomUUID(), kind: 'shared', createdAt: Date.now(), files });
      return Response.redirect('/send?shared=1', 303);
    } catch (e) {
      console.error('[sw] share target failed', e instanceof Error ? e.name : e);
      return Response.redirect('/send?shared=error', 303);
    }
  },
  'POST',
);

function str(v: FormDataEntryValue | null): string | null {
  return typeof v === 'string' ? v : null;
}

// --- Web Push -----------------------------------------------------------------

self.addEventListener('push', (event) => {
  const payload = parsePushPayload(event.data?.text() ?? '');
  if (!payload) return;
  const { title, body } = pushNotificationContent(payload);
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      tag: `transfer-${payload.transferId}`,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      requireInteraction: true,
      data: { url: `/receive?transfer=${payload.transferId}`, transferId: payload.transferId },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = (event.notification.data ?? {}) as { url?: string; transferId?: string };
  const url = data.url && data.url.startsWith('/') ? data.url : '/receive';
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const existing = windows.find((c) => new URL(c.url).origin === self.location.origin);
      if (existing) {
        // Reuse the open window: tell the page which transfer to accept.
        await existing.focus();
        existing.postMessage({ type: 'open-transfer', transferId: data.transferId ?? null, url });
        return;
      }
      await self.clients.openWindow(url);
    })(),
  );
});

// --- Lifecycle ------------------------------------------------------------------

self.addEventListener('install', () => void self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
