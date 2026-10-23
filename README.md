# DropLink

AirDrop-style file sharing between **your own** devices, as an installable web app (PWA) on Supabase.

- Sign in on your phone and your computer with the same account. They find each other: no pairing.
- Share from any Android app (Gallery, Files, WhatsApp…) → DropLink → your Mac. Or pick or drag
  files in the app on any device.
- If the other device has DropLink open, files go **peer to peer over WebRTC** and never touch the
  server.
- If it doesn't, it gets a **push notification**. Tap it and the transfer starts.
- If nobody answers within ~20 s, files up to 100 MB are **end-to-end encrypted** in the browser
  and parked in a relay. They're downloaded the next time DropLink opens there, then deleted
  (and always after 24 h).
- On desktop Chrome or Edge, files stream straight into a folder you picked once.

## How it works

```
   Android phone (PWA)                                         Mac (Chrome / Edge / Safari)
 ┌─────────────────────┐   1. presence + signaling     ┌─────────────────────┐
 │ share sheet → SW →  │ ◀──── Supabase Realtime ────▶ │ DropLink tab        │
 │ IndexedDB outbox    │   (private channel user:uid)  │  or nothing open    │
 │ → Send screen       │                               │                     │
 │                     │══ 2. WebRTC data channel ════▶│ → chosen folder     │
 │                     │   (P2P; TURN if needed)       │   (File System      │
 │                     │                               │    Access API)      │
 │                     │── 3. not online? ──▶ Edge Fn ─▶ Web Push ─▶ click ─▶ opens DropLink
 │                     │   notify-device               │                     │
 │                     │── 4. still nothing in 20 s? ──▶ Storage "relay" ───▶│ downloads, decrypts,
 │  encrypt (AES-GCM)  │   E2E-encrypted chunks        │ (ciphertext only)   │ saves, deletes copy
 └─────────────────────┘                               └─────────────────────┘
          Supabase: Auth · Postgres + RLS · Realtime · Storage · Edge Functions · pg_cron
```

- **Postgres** holds metadata only (devices, public keys, transfer counts and sizes, quotas), all
  behind Row Level Security. File names never reach the server in plaintext.
- **Realtime**: Presence says which devices are online; Broadcast carries WebRTC offers, answers
  and ICE candidates, addressed `{ to, from }`. Realtime Authorization means only you can join
  `user:{your id}`.
- **Edge Functions**: `turn-credentials` (Cloudflare TURN), `notify-device` (Web Push),
  `relay-cleanup` (hourly, via pg_cron), `delete-account`.
- **Relay crypto**: ECDH P-256 (ephemeral key + receiving device's key) → HKDF-SHA-256 →
  AES-GCM-256 per 1 MiB chunk, plus an encrypted manifest for names and sizes. WebCrypto only.

The wire formats are documented in [docs/PROTOCOL.md](docs/PROTOCOL.md) so the planned native macOS
helper can join without schema changes. Design decisions are in [DECISIONS.md](DECISIONS.md).

```
src/
  lib/core/       pure logic, unit tested: protocol framing, flow control, queue, crypto, names, push payload
  lib/services/   side effects: signaling, WebRTC peer, sender/receiver engines, relay, sinks, push, outbox
  lib/state/      Svelte 5 rune state modules the components subscribe to
  screens/, components/
  sw.ts           service worker: precache, share target, push, notification click
supabase/
  migrations/     schema + RLS, Realtime Authorization, push RPCs, pg_cron
  functions/      turn-credentials, notify-device, relay-cleanup, delete-account
tests/unit/       Vitest (pure logic)       tests/rls/   against local Supabase
e2e/              Playwright: two browser contexts = two devices
```

## Local development

**Prerequisites:** Node 22+, Docker Desktop, [Supabase CLI](https://supabase.com/docs/guides/cli) 2.x.

```bash
npm install
npm run db:start                  # local Supabase (ports 553xx, see below)
cp .env.example .env.local        # then fill in VITE_SUPABASE_ANON_KEY from `supabase status`
npm run vapid                     # VAPID keys for Web Push
```

Put the VAPID output in **both** places: `VITE_VAPID_PUBLIC_KEY` in `.env.local`, and
`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `CRON_SECRET=local-dev-cron-secret` in
`supabase/functions/.env` (it must match `supabase/seed.sql`). Then:

```bash
npm run functions:serve           # terminal 1: Edge Functions
npm run dev                       # terminal 2: https://localhost:5173 and https://<LAN-IP>:5173
```

Sign in with an email: the code and link arrive in **Mailpit** at http://127.0.0.1:55324.

Local ports are 553xx instead of Supabase's 543xx defaults (another project here used those):
API 55321, DB 55322, Studio 55323, Mailpit 55324.

### Scripts

| Command                             | What it does                                                                                                                       |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `npm run dev` / `build` / `preview` | Vite dev server (HTTPS, LAN) / production build + `_headers` / serve the build (with the production CSP)                           |
| `npm test`                          | Unit tests (framing, protocol, backpressure, queue, crypto, SHA-256, names, push payload…)                                         |
| `npm run test:rls`                  | RLS, Storage, Realtime Authorization, quota and delete-account tests against local Supabase (needs `functions:serve`)              |
| `npm run test:push`                 | `notify-device` against a mock HTTPS push service; decrypts the RFC 8291 payload                                                   |
| `npm run test:e2e`                  | Playwright: two devices, P2P, resume, folder saving, share target, push flow, relay, CSP, axe a11y. `E2E_BIG=1` adds the 1 GB test |
| `npm run lint`                      | ESLint + Prettier check + svelte-check + tsc                                                                                       |
| `npm run db:reset`                  | Recreate the local DB from migrations + seed                                                                                       |
| `npm run functions:serve`           | Serve Edge Functions with `supabase/functions/.env`                                                                                |
| `npm run icons` / `npm run vapid`   | Regenerate PNG icons from the SVG / make VAPID keys                                                                                |

e2e tests expect `npm run dev` (dev tests) and `npm run build && npm run preview` (PWA/CSP tests)
to be running. On a laptop, run long suites with `caffeinate -i npm run test:e2e`: if the Mac
sleeps mid-test, WebRTC and Realtime die and you get confusing timeouts.

### Testing on a real phone

The phone must reach the dev server over **trusted** HTTPS. Android Chrome refuses to register a
service worker (needed for install, share target and push) over a self-signed certificate.

1. **Trusted certificate with mkcert** (recommended):
   ```bash
   brew install mkcert && mkcert -install
   mkdir -p certs && mkcert -cert-file certs/dev-cert.pem -key-file certs/dev-key.pem \
     localhost 127.0.0.1 $(ipconfig getifaddr en0)
   ```
   Vite uses `certs/` automatically when it exists. Copy `$(mkcert -CAROOT)/rootCA.pem` to the phone
   and install it: Android Settings → Security → Encryption & credentials → Install a certificate →
   **CA certificate**. Chrome on Android trusts user-installed CAs.
   _Without mkcert_, `@vitejs/plugin-basic-ssl` gives a self-signed certificate. Fine on the laptop
   (click through the warning), but on the phone the service worker won't register.
2. Phone and Mac on the same Wi-Fi. Open `https://<Mac LAN IP>:5173` (printed by `npm run dev`).
3. **How the phone reaches local Supabase:** it doesn't, directly. With `VITE_SUPABASE_URL=same-origin`
   the Vite server proxies `/auth/v1`, `/rest/v1`, `/realtime/v1`, `/storage/v1` and `/functions/v1`
   to local Supabase, so the phone only needs the one HTTPS origin. (Alternatively put
   `http://<LAN-IP>:55321` in `VITE_SUPABASE_URL`, but then an HTTPS page calls HTTP, which is mixed
   content and gets blocked.)
4. **Sign in with the email code** on the phone. Local magic links point at `127.0.0.1`, which is
   the phone itself. LAN redirect URLs (`https://192.168.*.*:5173/**`, `10.*`, `172.*`) are already
   allowed in `supabase/config.toml`.
5. **Google OAuth locally** (optional): set `[auth.external.google] enabled = true` in
   `supabase/config.toml`, export `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID` / `_SECRET`, add
   `http://127.0.0.1:55321/auth/v1/callback` as an authorized redirect URI in Google Cloud, and
   `supabase stop && supabase start`. The callback goes to `127.0.0.1`, so Google sign-in only works on
   the laptop. Use email codes on the phone, or test Google on the deployed site.
6. Install: Chrome menu → **Install app** (or the in-app Install button). The share target only
   appears once installed.

## Deploy

### 1. Supabase

1. Create a project at [supabase.com](https://supabase.com) and note the project ref.
2. Link and push the schema (tables, RLS, the `relay` bucket and its policies, Realtime
   Authorization, `pg_cron` + `pg_net` and the hourly job are all migrations):
   ```bash
   supabase login
   supabase link --project-ref <ref>
   supabase db push
   ```
   If `db push` complains about `pg_cron`/`pg_net`, enable both under Database → Extensions and push
   again.
3. Point the cron job at your function (SQL editor), using a long random secret:
   ```sql
   select vault.create_secret('https://<ref>.supabase.co/functions/v1/relay-cleanup', 'droplink_cleanup_url');
   select vault.create_secret('<openssl rand -hex 32>', 'droplink_cron_secret');
   ```
4. Secrets (use the same CRON_SECRET; never commit this file):
   ```bash
   supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:you@yourdomain.com \
     CLOUDFLARE_TURN_KEY_ID=... CLOUDFLARE_TURN_API_TOKEN=... \
     CRON_SECRET=<same as vault> ALLOWED_ORIGINS=https://<your-site>.netlify.app
   ```
   Cloudflare TURN: dash.cloudflare.com → Realtime → TURN Server → Create → copy the Key ID and API token.
5. Deploy the functions (they verify the JWT themselves; `verify_jwt = false` comes from `config.toml`):
   ```bash
   supabase functions deploy turn-credentials notify-device relay-cleanup delete-account
   ```
6. **Auth → URL Configuration:** Site URL `https://<your-site>.netlify.app`; Redirect URLs
   `https://<your-site>.netlify.app/**`.
7. **Auth → Providers → Google:** enable it, with a Google Cloud OAuth client whose authorized
   redirect URI is `https://<ref>.supabase.co/auth/v1/callback`.
8. **Auth → Email Templates → Magic Link:** include `{{ .Token }}` so emails carry the 6-digit code
   as well as the link (copy `supabase/templates/magic_link.html`, or `supabase config push`). Set up
   **custom SMTP** (Auth → SMTP): the built-in sender is heavily rate-limited and isn't meant for a
   public app.

### 2. Netlify

1. New site from this repo. Build command and publish dir come from `netlify.toml`.
2. Environment variables: `VITE_SUPABASE_URL=https://<ref>.supabase.co`,
   `VITE_SUPABASE_ANON_KEY=<anon or publishable key>`, `VITE_VAPID_PUBLIC_KEY=<public key>`.
3. Deploy. The build writes `dist/_headers` with a CSP allowing only the site and your Supabase
   project. `sw.js`, the manifest and `index.html` are served `no-cache`; hashed assets are immutable.

## Push on macOS

- **Chrome** delivers Web Push whenever Chrome is running, even with no DropLink window open (and even
  with no windows at all). If you fully quit Chrome, pushes wait until it's started again. Allow
  notifications for Chrome in macOS System Settings → Notifications.
- **Safari**: add DropLink to the Dock (Safari → File → **Add to Dock**). The Dock web app has its own
  notification permission and gets pushes while it isn't running.
- Firefox supports push while it's running too, but has no folder picker, so files go to Downloads.

## Known limitations

- **A PWA can't receive and save files with zero clicks while it's closed.** A push notification gets
  it to one click. True AirDrop-style silent receiving needs a native desktop helper: planned as
  phase 2 (likely a Flutter macOS menu-bar app on this same backend; see
  [docs/PROTOCOL.md](docs/PROTOCOL.md)).
- Push on the Mac requires Chrome to be running, or the Safari Dock web app.
- The relay is capped (100 MB per transfer, 500 MB per day, 20 relayed transfers per hour) and
  expires after 24 hours. Bigger offline sends wait in the sender's outbox and only go out while
  DropLink is open on the sender.
- The share target needs the PWA installed through Chrome on Android. iOS has no Web Share Target.
- Best desktop experience is Chrome or Edge (folder picker, streaming to disk). Safari and Firefox
  fall back to normal downloads. Large files still stream through private browser storage rather than
  memory where the browser supports it.
- After a browser restart, Chrome may need one click ("Allow access to <folder>") before saving into
  the folder again. Choose "Allow on every visit" to avoid it. Until then, files go to Downloads.
- Some strict networks (symmetric NAT on both ends, some mobile carriers) need TURN. Without
  Cloudflare TURN configured, those transfers fall back to the relay (≤ 100 MB) or the outbox.
- Shared text/URLs are capped at 64 KB.

## Troubleshooting

| Symptom                                                          | Fix                                                                                                                                                                                          |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Service worker doesn't register on the phone / no Install option | The certificate isn't trusted. Use mkcert and install its root CA on the phone.                                                                                                              |
| Phone sign-in link opens `127.0.0.1`                             | Expected locally. Type the 6-digit code from the email instead.                                                                                                                              |
| "Too many attempts" on sign-in                                   | Supabase rate limits; wait a minute. Locally they're raised in `config.toml`.                                                                                                                |
| Devices never show as online                                     | Check that both are signed in to the same account and that `/realtime/v1` is reachable (Network tab, WS). A private channel `CHANNEL_ERROR` means a wrong or expired session. Sign in again. |
| Transfers stay on "Connecting…" then relay                       | No direct path between the networks. Configure Cloudflare TURN secrets, and check `turn-credentials` returns `turn: true`.                                                                   |
| No push notifications                                            | Permission granted? Chrome running (Mac)? `VAPID_*` set in both places, keys from the same pair? Function logs show `push failed 403` if the keys don't match.                               |
| Files go to Downloads instead of the folder                      | Click "Allow access to <folder>" on Home or Received (permission resets after a restart).                                                                                                    |
| `supabase start` port errors                                     | Another local project uses the ports; stop it or change the ports in `supabase/config.toml`.                                                                                                 |
| Weird e2e timeouts on a laptop                                   | The Mac slept. Use `caffeinate -i`.                                                                                                                                                          |

## What has been verified, and how

Automated, against the local stack:

- RLS on every table, Storage, and Realtime: user B can't read, change or inject into anything of
  user A's; anon sees nothing; quota bypasses are rejected (`npm run test:rls`).
- Two browser contexts: devices see each other, rename and revoke work, presence goes online and
  offline live.
- 1 GB P2P transfer: SHA-256 matches `shasum` of the source, peak memory about 49 MB (sender) and
  41 MB (receiver). Mid-transfer connection drop: resumes from the last acknowledged chunk.
- Folder saving with `(1)` collisions; share target (files + text), auto-send, sharing while signed
  out; Chrome installability; offline launch; production CSP with zero violations.
- Push: `notify-device` → mock push service → decrypted payload; SW shows the notification; the
  closed-target flow (wait → open from notification link → P2P).
- Relay: Mac offline, 50 MB encrypted (no names on the server), arrives intact later, copy deleted;
  hourly cleanup expires old relays; delete account removes everything. axe-core finds no WCAG AA
  issues on any screen in light or dark mode.

**Not** verified by me: anything that needs real devices or real push services. That's the list below.

## Manual test checklist (real devices)

Setup: Android phone with Chrome; Mac with Chrome; both on the deployed site (or the LAN dev server
with mkcert), signed in with the same account.

1. **Install + share target:** install DropLink on Android. In Gallery, share a photo → DropLink
   appears in the share sheet → the Send screen shows the photo with the Mac preselected → Send →
   it arrives on the Mac.
2. **Shared text/URL:** share a link from Chrome → it appears on the Mac under Received with Copy and
   Open link.
3. **One-tap mode:** Settings → pick the Mac as default → enable "Send to my default device without
   asking" → share a photo → it sends without the picker.
4. **Folder on the Mac:** Home → Choose download folder → pick a folder → send a file → it's in that
   folder. Send a file with the same name → you get `name (1).ext`.
5. **Folder after restart:** quit and reopen Chrome → open DropLink → "Allow access to <folder>"
   appears (unless you chose "Allow on every visit") → click it → the next file lands in the folder.
6. **Notifications on the Mac:** Home → Turn on notifications → allow. Close every DropLink tab, but
   keep Chrome running. Send from the phone → the notification "<phone> wants to send 1 file, …"
   appears → click it → DropLink opens and the transfer completes.
7. **Notifications on Android:** the same in reverse (allow notifications in the installed app).
8. **Relay:** quit Chrome on the Mac completely. Send a 50 MB file from the phone → after about
   20 s: "Uploaded securely" → close DropLink on the phone → later open DropLink on the Mac → the file
   arrives.
9. **Too big for the relay:** with the Mac offline, send more than 100 MB → it says it'll send when
   the Mac is online → open DropLink on the Mac while the phone app is open → it sends P2P.
10. **Different networks:** phone on mobile data, Mac on Wi-Fi → send a file → should go P2P (via
    TURN if needed). Check `chrome://webrtc-internals` for a "relay" candidate pair.
11. **Big file on the phone:** share a 1–2 GB video → the phone stays responsive, and the progress
    bar moves smoothly on both ends.
12. **Safari:** on the Mac, Safari → Add to Dock → allow notifications → quit it → send from the
    phone → a notification appears → click it → the file downloads.
13. **Remove device:** on the Mac, Settings → remove the phone → open DropLink on the phone → it's
    signed out with a "removed" message.
14. **Delete account** (use a throwaway account): Settings → type DELETE → you're signed out;
    signing in again starts fresh.
15. **Dark mode + screen reader:** switch the OS to dark mode and check it's readable; try
    VoiceOver / TalkBack on Home and Send.
