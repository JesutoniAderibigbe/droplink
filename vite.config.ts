import { defineConfig, loadEnv, type ProxyOptions } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { VitePWA } from 'vite-plugin-pwa';
import basicSsl from '@vitejs/plugin-basic-ssl';
import fs from 'node:fs';
import path from 'node:path';

// HTTPS for the dev server. If you generated a trusted certificate with mkcert
// into ./certs (see README), use it; otherwise fall back to a self-signed cert
// from @vitejs/plugin-basic-ssl. Real phones need the mkcert route for the
// service worker to register (Chrome refuses SWs on untrusted certificates).
const certDir = path.resolve(import.meta.dirname, 'certs');
const mkcertCert = path.join(certDir, 'dev-cert.pem');
const mkcertKey = path.join(certDir, 'dev-key.pem');
const hasMkcert = fs.existsSync(mkcertCert) && fs.existsSync(mkcertKey);

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  // The browser talks to Supabase through the Vite dev server (same origin,
  // HTTPS), so a phone on the LAN never hits plain-HTTP Supabase directly and
  // there is no mixed-content problem. Set VITE_SUPABASE_URL=same-origin to use it.
  const supabaseTarget = env.SUPABASE_PROXY_TARGET || 'http://127.0.0.1:55321';
  const proxyPaths = ['/auth/v1', '/rest/v1', '/storage/v1', '/functions/v1', '/realtime/v1'];
  const proxy: Record<string, ProxyOptions> = Object.fromEntries(
    proxyPaths.map((p) => [
      p,
      { target: supabaseTarget, changeOrigin: true, ws: p === '/realtime/v1' },
    ]),
  );

  return {
    plugins: [
      svelte(),
      ...(hasMkcert ? [] : [basicSsl()]),
      VitePWA({
        strategies: 'injectManifest',
        srcDir: 'src',
        filename: 'sw.ts',
        injectRegister: false,
        registerType: 'autoUpdate',
        injectManifest: {
          globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest}'],
        },
        devOptions: { enabled: true, type: 'module', navigateFallback: 'index.html' },
        includeAssets: ['icons/icon.svg', 'icons/apple-touch-icon.png', 'favicon.png'],
        manifest: {
          id: '/',
          name: 'DropLink',
          short_name: 'DropLink',
          description: 'AirDrop-style file sharing between your own devices.',
          start_url: '/',
          scope: '/',
          display: 'standalone',
          background_color: '#0f1115',
          theme_color: '#2f6bff',
          icons: [
            { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
            {
              src: '/icons/icon-maskable-512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
          share_target: {
            action: '/share-target',
            method: 'POST',
            enctype: 'multipart/form-data',
            params: {
              title: 'title',
              text: 'text',
              url: 'url',
              files: [{ name: 'files', accept: ['*/*'] }],
            },
          },
        },
      }),
    ],
    server: {
      host: true,
      port: 5173,
      strictPort: true,
      https: hasMkcert
        ? { cert: fs.readFileSync(mkcertCert), key: fs.readFileSync(mkcertKey) }
        : undefined,
      proxy,
    },
    preview: { host: true, port: 4173, proxy },
    build: { target: 'es2022', sourcemap: true },
  };
});
