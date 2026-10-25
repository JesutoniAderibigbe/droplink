# DropLink

AirDrop-style file sharing between **your own** devices, and with **people you know** (Android ↔
iPhone ↔ Mac ↔ Windows), as an installable web app (PWA) on Supabase.

- Sign in on your phone and your computer with the same account. They find each other: no pairing.
- Share from any Android app (Gallery, Files, WhatsApp…) → DropLink → your Mac. Or pick or drag
  files in the app on any device.
- If the other device has DropLink open, files go **peer to peer over WebRTC** and never touch the
  server.
- If it doesn't, it gets a **push notification**. Tap it and the transfer starts.
- If there is no direct link within ~10 s, or nobody answers within ~20 s, files up to 100 MB are **end-to-end encrypted** in the browser
  and parked in a relay. They're downloaded the next time DropLink opens there, then deleted
  (and always after 24 h).
- On desktop Chrome or Edge, files stream straight into a folder you picked once.
- **People**: add a friend by QR code, link or email. Once they accept, their phone or computer
  shows up when you send, whatever it runs. Files arrive byte for byte: original quality, never
  compressed.

## In simple terms

Think of DropLink as a private courier between your own phone and computer.

1. **You sign in on both devices with the same account.** That's how they know they belong
   together. There's no pairing and no codes.
2. **The devices keep an eye out for each other.** While DropLink is open, each device tells our
   server "I'm here". That's how your phone knows your Mac is online, like a contact showing as
   "online" in a chat app.
3. **When you send something, the devices talk directly.** The server only introduces them (it
   passes a few small "here's how to reach me" notes back and forth). After that, the file goes
   straight from one device to the other, like handing it across a table. It doesn't go through our
   server, so it's fast and private. On the same Wi-Fi, it goes at Wi-Fi speed.
4. **If they can't reach each other directly**, for example because a network blocks it, the file
   goes through a forwarding server (Cloudflare TURN). It's still scrambled so only your device can
   read it.
5. **If the other device is closed**, it gets a notification: "Your phone is sending you a file". Tap
   it, DropLink opens, and the transfer starts.
6. **If nobody answers**, DropLink locks the file (encrypts it with a key that only your other device
   has) and leaves it in a locked box on the server, a bit like a parcel locker. The next time you
   open DropLink on the other device, it collects the file, unlocks it and the box is emptied. Boxes
   that nobody collects are cleared after 24 hours. The server can't open them.
7. **Where files land**: on a computer, into a folder you choose once (or your Downloads folder). On
   a phone, into Downloads. DropLink tells you exactly where to look.
8. **Sending to someone else** works the same way once you're connected. You show them your QR
   code (or send them a link, or add their email and they accept). From then on their devices
   appear in your Send list next to yours, and yours in theirs. It doesn't matter if one of you has
   an Android phone and the other an iPhone: DropLink runs in the browser on both, and the file is
   copied exactly as it is, so a photo or video keeps its full quality (unlike chat apps that
   shrink them). Only people you've connected with can send to you, and you can remove anyone.

What the server knows: your email and name, your device names, who your contacts are, and that a
transfer happened and how big it was. What it never sees: what's inside your files or what they're called.

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
  `user:{your id}`, and only two accepted contacts can join their shared `pair:{a}:{b}` channel.
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

## System design

Live: **https://droplink-app-m8bs.netlify.app** · Source and CI/CD: this repo (GitHub Actions).

### Components

| Layer              | Technology                                                                                   | Job                                                                                      |
| ------------------ | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Client             | Svelte 5 (runes) + Vite, installable PWA                                                     | UI, WebRTC, encryption, saving files. All file bytes are handled here.                   |
| Service worker     | Workbox (`src/sw.ts`)                                                                        | Offline shell, Android share target, push notifications, notification click.             |
| Identity           | Supabase Auth (email + password, no emails sent)                                             | One account = one set of devices.                                                        |
| Database           | Supabase Postgres + Row Level Security                                                       | Devices, public keys, transfer metadata, quotas. Never file contents or plaintext names. |
| Signaling          | Supabase Realtime (Presence + Broadcast) on private channels `user:{uid}` and `pair:{a}:{b}` | Who's online (mine and my contacts'); WebRTC offer/answer/ICE; `relay-ready` pings.      |
| Direct transport   | WebRTC data channel (STUN + Cloudflare TURN)                                                 | Peer-to-peer file bytes.                                                                 |
| Fallback transport | Supabase Storage bucket `relay`                                                              | End-to-end encrypted chunks when the other device isn't reachable.                       |
| Server logic       | Supabase Edge Functions (Deno)                                                               | `turn-credentials`, `notify-device` (Web Push), `relay-cleanup`, `delete-account`.       |
| Scheduling         | `pg_cron` + `pg_net` + Vault                                                                 | Hourly relay cleanup.                                                                    |
| Hosting            | Netlify (static `dist/` + `_headers` CSP)                                                    | Serves the app. No server code runs there.                                               |

### What happens when you press Send

```
 Sender                              Supabase                               Receiver
   │ 1. insert transfers row ───────▶ Postgres (RLS + quota triggers)
   │ 2. is the target in Presence?
   │    yes ──▶ offer/answer/ICE via Realtime Broadcast ──────────────────────▶│
   │ 3. WebRTC data channel ═════════ direct (LAN / internet) or via TURN ════▶│ writes to folder
   │                                                                           │ or Downloads
   │    no ───▶ notify-device Edge Fn ──▶ Web Push ──▶ notification ─ tap ──▶ │ opens DropLink
   │ 4. no direct link (10 s) or nobody answers (20 s):
   │    encrypt in browser ──▶ Storage "relay" (ciphertext only) ──▶ relay-ready ping ─▶│
   │                                                                  download, decrypt,
   │                                                                  save, delete copy
   │ 5. >100 MB and offline: stays in the sender's outbox (IndexedDB) until it can go direct
```

The engine always tries the cheapest, fastest path first and falls back quickly:

1. **Direct, same network** (both "host" ICE candidates): fastest, limited only by Wi-Fi.
2. **Direct over the internet** (STUN "srflx" candidates): limited by the slower internet upload.
3. **Cloudflare TURN** (when NAT blocks direct): same limit, plus the TURN hop.
4. **Encrypted relay** via Supabase Storage (≤ 100 MB, deleted after download or 24 h).
5. **Outbox** for anything else, retried when both devices are online.

The Send and Receive screens show which route was used ("Direct · same network", "Direct · over the
internet", "Via TURN relay server"), read from WebRTC `getStats()`.

### Data channel protocol

- Files are split into 64 KB chunks with a 21-byte binary header (type, file index, chunk index).
- **Backpressure**: the sender pauses when the channel buffer passes 8 MB and resumes below 1 MB, so
  memory stays flat for any file size.
- **Flow control**: the receiver acks every 2 MB; the sender never has more than 16 MB unacked.
- **Resume**: if the connection drops, both sides reconnect (up to 5 attempts) and continue from the
  last acked byte.
- Full wire format: [docs/PROTOCOL.md](docs/PROTOCOL.md).

### Data model (Postgres)

| Table                | Holds                                                                                  |
| -------------------- | -------------------------------------------------------------------------------------- |
| `profiles`           | One row per user (created by trigger on sign-up).                                      |
| `devices`            | Name, platform, public ECDH key, last seen.                                            |
| `push_subscriptions` | Web Push endpoint per device.                                                          |
| `transfers`          | From/to device, file count, total size, status. A trigger enforces the state machine.  |
| `relay_objects`      | Each encrypted object in Storage; Storage policies only allow uploads registered here. |
| `usage_daily`        | Per-user counters for quotas.                                                          |
| `contacts`           | One row per pair of people: pending request or accepted. Changed only through RPCs.    |
| `contact_invites`    | One-time QR/link invites: only a hash of the token, 30-minute expiry.                  |

Quotas are enforced **in the database** by triggers (`limit_transfers_per_hour`,
`limit_relay_bytes_per_day`, …), so a modified client can't bypass them. They fail with `PT429` /
`PT413`, which the app shows as friendly messages.

### Security model

- **RLS everywhere**: every row is scoped to `auth.uid()`; column grants stop clients from editing
  fields like status or sizes directly.
- **Realtime Authorization**: only your own sessions can join `user:{uid}`; only the two people in
  an accepted contact can join `pair:{a}:{b}`. On a pair channel, the app also drops any message
  that claims to come from a device the other person doesn't own.
- **Contacts**: someone can only see your devices, send you files, or join a channel with you after
  you've both agreed (an accepted request, or they opened your one-time QR/link, which expires in
  30 minutes). Requests are rate limited and capped at 50 contacts. A receiver can read and
  download what was sent to them and mark it delivered, nothing more; quotas stay with the sender.
- **End-to-end encryption on the relay**: ECDH P-256 (sender's ephemeral key + receiver's device key)
  → HKDF-SHA-256 → AES-GCM-256 per 1 MiB chunk, unique IV (prefix ‖ file index ‖ chunk index), with
  associated data binding each chunk to its transfer. The server stores only ciphertext; file names
  live in an encrypted manifest.
- **P2P** traffic is encrypted by WebRTC (DTLS), including through TURN.
- **CSP**: `dist/_headers` allows scripts only from the site and network calls only to your Supabase
  project and Cloudflare TURN.
- **Edge Functions** verify the user's JWT in code; the cron function needs a secret from Vault.

### Scaling and cost

- The server never carries P2P bytes, so most transfers cost nothing beyond signaling messages.
- Relay storage is bounded: 100 MB per transfer, 500 MB per user per day, 20 relayed transfers per
  hour, and hourly cleanup deletes anything older than 24 h.
- TURN traffic is metered by Cloudflare (free allowance per month, then per GB). It's only used when
  a direct connection is impossible.

### CI/CD

`.github/workflows/ci-cd.yml`, on every push and pull request:

```
checks (lint, types, unit tests, build)
   ├──▶ db-tests (local Supabase: RLS, Storage, Realtime, quotas)
   └──▶ e2e (Playwright, two browser contexts = two devices)
              └──▶ deploy (main only): db push → functions deploy → build → Netlify upload → smoke test
```

Production secrets live in GitHub Actions secrets and Supabase secrets, never in the repo.

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

Create an account with any email and a password (8+ characters). No email is sent: confirmation is off.

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
4. **Sign in with email + password.** Nothing is emailed, so it works the same on the phone.
5. **Google OAuth locally** (optional): set `[auth.external.google] enabled = true` in
   `supabase/config.toml`, export `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID` / `_SECRET`, add
   `http://127.0.0.1:55321/auth/v1/callback` as an authorized redirect URI in Google Cloud, and
   `supabase stop && supabase start`. The callback goes to `127.0.0.1`, so Google sign-in only works on
   the laptop. Use email + password on the phone, or test Google on the deployed site.
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
8. **Auth → Sign In / Providers → Email:** keep it enabled with **Confirm email off**. DropLink signs in
   with email + password and never sends email. To add Google later, enable the Google provider and set
   `VITE_ENABLE_GOOGLE_LOGIN=true` in the GitHub variables, so the button appears.

### 2. Netlify

Normally you don't touch Netlify: the GitHub Actions `deploy` job builds `dist/` and uploads it with
`netlify deploy --no-build` (needs the `NETLIFY_AUTH_TOKEN`, `SUPABASE_ACCESS_TOKEN` and `SUPABASE_DB_PASSWORD`
secrets). To set it up by hand instead:

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

| Symptom                                                          | Fix                                                                                                                                                                                                                                                            |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Service worker doesn't register on the phone / no Install option | The certificate isn't trusted. Use mkcert and install its root CA on the phone.                                                                                                                                                                                |
| "Too many attempts" on sign-in                                   | Supabase rate limits; wait a minute. Locally they're raised in `config.toml`.                                                                                                                                                                                  |
| Devices never show as online                                     | Check that both are signed in to the same account and that `/realtime/v1` is reachable (Network tab, WS). A private channel `CHANNEL_ERROR` means a wrong or expired session. Sign in again.                                                                   |
| Big transfers are slow                                           | Look at the route line while sending. "Direct · same network" is Wi-Fi speed. "Over the internet" or "Via TURN" on the same Wi-Fi means the router isolates devices (guest network / AP isolation): turn it off, or connect the laptop to the phone's hotspot. |
| Transfers stay on "Connecting…" then relay                       | No direct path between the networks. Configure Cloudflare TURN secrets, and check `turn-credentials` returns `turn: true`.                                                                                                                                     |
| No push notifications                                            | Permission granted? Chrome running (Mac)? `VAPID_*` set in both places, keys from the same pair? Function logs show `push failed 403` if the keys don't match.                                                                                                 |
| Files go to Downloads instead of the folder                      | Click "Allow access to <folder>" on Home or Received (permission resets after a restart).                                                                                                                                                                      |
| `supabase start` port errors                                     | Another local project uses the ports; stop it or change the ports in `supabase/config.toml`.                                                                                                                                                                   |
| Weird e2e timeouts on a laptop                                   | The Mac slept. Use `caffeinate -i`.                                                                                                                                                                                                                            |

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
15. **Phone hotspot:** turn on the phone's hotspot, connect the laptop to it, open DropLink on both
    and send a large file. It should go device to device over the hotspot link (fast, and it doesn't use
    mobile data for the file; check `chrome://webrtc-internals` for a "host" candidate pair). The phone
    still needs mobile data for sign-in and signaling.
16. **Android ↔ iPhone, two people:** on the iPhone, sign up in Safari, then Share → Add to Home
    Screen and open DropLink from the Home Screen (iOS only allows notifications for Home Screen web
    apps, iOS 16.4+). On the Android phone (another account), People → Show my QR code → scan it with
    the iPhone's Camera → "connected". Send a full-resolution photo and a 4K video from Android to
    the iPhone, and one back. Check in Files → Downloads (iPhone) and Files → Downloads (Android)
    that sizes match the originals exactly. Then close DropLink on the iPhone and send again: a
    notification arrives; tap it and the file comes through.
17. **Add by email:** one person adds the other's email; the other sees "Wants to connect" (with the
    email) on Home → People → Accept. Remove the contact: the device disappears from Send on both
    sides.
18. **Dark mode + screen reader:** switch the OS to dark mode and check it's readable; try
    VoiceOver / TalkBack on Home and Send.
