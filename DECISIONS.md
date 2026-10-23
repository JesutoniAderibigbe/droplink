# Decisions

Ambiguous choices made while building DropLink, with the reasoning. Newest at the bottom.

## Scaffold

- **Project lives in `droplink/`** inside Downloads, because the Downloads folder was not empty.
- **Local Supabase ports are 553xx** (API 55321, DB 55322, Studio 55323, Mailpit 55324) instead of
  the 543xx defaults, because another local Supabase project on this machine already uses those.
- **Supabase is proxied through the Vite dev server.** The browser calls `https://<LAN-IP>:5173/auth/v1`,
  `/rest/v1`, `/realtime/v1`, `/storage/v1`, `/functions/v1`, and Vite forwards to local Supabase.
  This avoids mixed content (HTTPS page to HTTP Supabase) and means the phone needs only one
  trusted certificate. Enabled with `VITE_SUPABASE_URL=same-origin`.
- **HTTPS in dev:** uses mkcert certificates from `./certs` if present, otherwise
  `@vitejs/plugin-basic-ssl` (self-signed). Self-signed is fine on the laptop, but Android Chrome will
  not register a service worker over an untrusted certificate, so phone testing needs mkcert.

## Schema, RLS, quotas

- **Extra columns beyond the spec:** `transfers.relay_params` (ephemeral public key, HKDF salt, IV
  prefix), `transfers.relay_started_at` (for the hourly relay limit), `relay_objects.user_id`
  (simple RLS) and `relay_objects.file_index` (-1 = manifest).
- **Column-level grants.** Clients can update only `devices(name, last_seen_at, revoked_at)`,
  `transfers(status, delivered_at, relay_params)` and `profiles(display_name)`. Ownership, keys,
  expiry and usage counters can't be changed from the client at all.
- **Revoke instead of delete.** Removing a device sets `revoked_at` (permanent; a trigger blocks
  un-revoking) and a trigger deletes its push subscriptions. Rows are hard-deleted only with the account.
- **Transfer state machine in a trigger.** `pending → p2p | relayed | delivered | failed | cancelled`,
  `p2p → pending | delivered | failed | cancelled`, `relayed → delivered | failed | cancelled`.
  `expired` is set only by the service role (cleanup job).
- **How quotas can't be bypassed.** Clients upload straight to Storage, so the bucket's INSERT policy
  requires each object path to be pre-registered in `relay_objects`, and the quota trigger runs on that
  insert. The bucket caps each object at 1 MiB + 1 KiB. Someone could register a small `byte_size` and
  upload a bigger object, but a transfer can only move to `relayed` (and so become downloadable) once a
  trigger confirms every object exists with `size <= byte_size`. Mismatched uploads are never delivered
  and get deleted by cleanup.
- **"20 transfers per hour" applies to relayed transfers**, as listed under the relay limits. P2P
  transfers only count toward a looser 200 rows/hour cap that stops table spam, since direct sends cost
  the server nothing.
- **Quota errors use SQLSTATE `PT429`/`PT413`**, so PostgREST returns HTTP 429/413, and messages
  start with `rate_limited:`, `quota_exceeded:` or `too_large:` so the client can show a human message.
- **Email sign-in sends both a link and a 6-digit code** (custom template). The code lets an installed
  PWA sign in without the link opening in a separate browser, and lets a phone sign in against local
  Supabase, whose links point at `127.0.0.1`.

## Presence and signaling

- **One private channel per user, `user:{uid}`**, used for both Presence and Broadcast. Presence key =
  device id. Broadcast event names are the signal types; every payload carries `{ to, from,
transferId }` and is validated (`core/signal.ts`) before use. Devices ignore messages not addressed
  to them. Since only the owner can join (Realtime Authorization), `from` is trusted to be one of the
  user's own devices, but the receiver still checks it against the device list.
- **Offer/answer/ice carry an `attempt` number** so that, after a reconnect, late messages from an
  older attempt are ignored.
- **Testing gotcha:** a supabase-js client without an auth session pushes the anon key to Realtime
  right after joining, and Realtime then closes the private channel. The app is unaffected (its
  client holds the session). The Node tests use the `accessToken` client option.

## WebRTC transfer engine

- **Protocol additions beyond the spec:** `file-meta` also carries `index`/`total` ("file 2 of 5");
  `ack` carries `chunk` (chunks written to disk = resume point) and `done`; there's a `bye` message
  (all done, or `cancelled`). Binary header = version byte + 16-byte file UUID + uint32 chunk index
  (21 bytes) + up to 64 KB payload.
- **Two flow-control limits, not one.** Besides `bufferedAmount` backpressure (pause above 8 MB,
  resume on `bufferedamountlow` at 1 MB), the sender keeps at most 16 MB unacknowledged. The receiver
  acks only after writing to disk, so a slow disk can't make the receiver buffer the whole file in memory.
- **Resume, not restart, after a drop.** The receiver session outlives connection attempts. After a
  reconnect (new offer, `attempt + 1`, backoff 1-16 s, 5 tries) the sender re-sends `file-meta`
  for the current file and the receiver replies with the chunk count it has on disk. Files finished
  before the drop are confirmed with `ack { done: true }` and skipped. The receiver keeps a partial
  file for 90 s waiting for the sender to come back.
- **Disk reads are 1 MB blocks** split into 64 KB messages, with the next block read while the
  current one sends.
- **Dev checksum uses a small pure-TS incremental SHA-256** (`core/sha256.ts`), because WebCrypto
  `digest()` needs the whole input in memory. It's a dev-build integrity check only and never used for
  security. All real cryptography uses WebCrypto.
- **Measured (local, two Chromium contexts, dev build with checksums on both sides):** 1 GB in 58 s,
  peak JS heap + ArrayBuffer memory 49 MB on the sender and 41 MB on the receiver. Hashing dominates
  the time; production builds don't hash.

## Desktop receiving

- **Sink order:** chosen folder (if permission is `granted` right now) → OPFS temp file + normal
  download → in-memory Blob + download. OPFS is used even without a folder, so a big file never has
  to fit in memory, and the browser download is handed a disk-backed `File`.
- **No permission prompt mid-transfer.** `requestPermission()` needs a user click, and transfers
  that start from a push notification have none. So if the stored folder needs re-approval we save
  through the download fallback and show a one-click "Allow access to <folder>" button. Chrome's
  "Allow on every visit" option removes even that click.
- **Folder writes use `createWritable()`**, which writes to a `.crswap` temp file and swaps it in on
  close, so partial files never appear under their real name. Cancelled or failed files are removed.
- **Auto-open Receive** when a transfer arrives while on Home; elsewhere, a toast with a "View" link.
  System notifications (via the SW registration) only when the page is hidden.

## PWA and share target

- **Installability is verified with Chrome's own check** (`Page.getInstallabilityErrors` via CDP,
  in `e2e/pwa.spec.ts`), because Lighthouse 12 removed the PWA category. It's the same criteria
  Chrome uses to offer installation.
- **The share target stores files in the IndexedDB outbox and redirects to `/send?shared=1`**, which
  reads every unsent "shared" entry. Shared title/text/URL become one text item (deduplicated, max
  64 KB) with the marker MIME type `application/x-droplink-text`. The receiver shows it with Copy
  (and Open link for a bare URL) instead of saving a file.
- **Signed out while sharing:** the entries stay in the outbox, the sign-in page says items are
  waiting, and signing in with the email code keeps you on `/send?shared=1`.
- **Parked sends persist.** When a send is waiting for an offline device and can't use the relay,
  its files are copied into the outbox and resumed (as a new transfer) the next time the app opens.
  The old row expires through cleanup.
- **Status writes are serialized per transfer**, so a fast transfer can't write `delivered` before `p2p`.
- **Tests and sleep:** long e2e runs use `caffeinate -i`. A Mac sleeping mid-test breaks WebRTC and
  Realtime and shows up as baffling timeouts.

## Web Push

- **`VAPID_PUBLIC_KEY` is also a function secret.** `web-push` needs both halves to sign, so the
  public key appears in both Vite env and Supabase secrets.
- **One push per transfer, enforced in Postgres.** `notify-device` must first claim the transfer via
  `claim_transfer_notification()` (pending, the caller's own, under 10 minutes old, not yet notified),
  so the function can't be used to spam a device. The payload (sender name, count, size) is read
  from the database, not taken from the request.
- **`save_push_subscription()` RPC** moves an endpoint to the newest device row (an endpoint
  identifies a browser profile) and keeps at most 5 subscriptions per device.
- **Push TTL is 120 s.** Past that, the relay has taken over, so a late notification is just noise.
- **Notification click with an open window:** the SW focuses it and posts `open-transfer`; the page
  navigates to `/receive?transfer=<id>`, which sends `transfer-accept` to the waiting sender.
- **Testing:** `npm run test:push` runs `notify-device` against a mock HTTPS push service and
  decrypts the RFC 8291 payload. That proves `npm:web-push` works in the Supabase edge runtime. The SW
  push handler is tested with CDP `ServiceWorker.deliverPushMessage`. Real delivery through
  FCM/APNs/Mozilla, and clicking the notification, are in the manual checklist.

## Encrypted relay

- **Key schedule:** ECDH(ephemeral, target device key) → HKDF-SHA-256 (random 32-byte salt, info
  `droplink-relay-v1:<transferId>`) → AES-GCM-256, unique per transfer. IV = 4-byte random prefix ‖
  fileIndex ‖ chunkIndex. AAD = `transferId|fileIndex|chunkIndex|chunkCount`, so chunks can't be
  reordered, swapped between transfers, or dropped from the end.
- **The manifest is object `{uid}/{transferId}/manifest`** (encrypted with fileIndex `0xFFFFFFFF`).
  It holds names, sizes, types and chunk counts. The `transfers` row only has counts, total size and
  `relay_params` (ephemeral public key, salt, IV prefix).
- **Relay only covers files not yet delivered.** If P2P died partway, the remaining files are
  relayed (the status goes back `p2p → pending` first). The 100 MB check uses the row's total size,
  so a 150 MB transfer whose last 40 MB failed waits in the outbox rather than relaying.
- **Upload/download concurrency is 3 × 1 MiB**; the receiver writes strictly in order through the
  same sinks as P2P, so memory stays at a few MB.
- **A failed relay upload isn't retried through the relay** (`relay_params` is immutable once set);
  the transfer is parked in the outbox and goes P2P when the target appears.
- **Inbox checks:** on start, when the app becomes visible, every 2 minutes, and on
  `/receive?transfer=`. A decryption failure is final (status `failed`, objects deleted); network
  errors retry.
- **Cleanup:** `pg_cron` hourly → `private.run_relay_cleanup()` → marks relay-less expired rows in SQL,
  then calls `relay-cleanup` via `pg_net` with a Vault-stored URL and secret. The function also
  removes relays abandoned for more than 2 h, which covers uploads that lied about sizes.
