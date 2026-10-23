// Writes dist/_headers (Netlify) with a Content-Security-Policy that allows
// only this origin and *your* Supabase project, which netlify.toml can't do
// because it can't read env vars. Runs after `vite build` (npm run build).
//
// Note: CSP has no directive for WebRTC ICE servers (STUN/TURN); those
// connections aren't governed by connect-src, so nothing to add for them.
import { writeFileSync } from 'node:fs';
import { loadEnv } from 'vite';

const mode = process.env.MODE ?? 'production';
const env = { ...loadEnv(mode, process.cwd(), 'VITE_'), ...process.env };
const raw = env.VITE_SUPABASE_URL;
if (!raw) {
  console.error('write-headers: VITE_SUPABASE_URL is not set');
  process.exit(1);
}

let connect = "'self'";
if (raw !== 'same-origin') {
  const u = new URL(raw);
  const wss = `${u.protocol === 'https:' ? 'wss' : 'ws'}://${u.host}`;
  connect += ` ${u.origin} ${wss}`;
}

const csp = [
  "default-src 'self'",
  "script-src 'self'",
  // Svelte sets a few inline style attributes (progress bar widths).
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  `connect-src ${connect}`,
  "worker-src 'self'",
  "manifest-src 'self'",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  'upgrade-insecure-requests',
].join('; ');

writeFileSync('dist/_headers', `/*\n  Content-Security-Policy: ${csp}\n`);
console.log('write-headers: dist/_headers written');
console.log(`  connect-src ${connect}`);
