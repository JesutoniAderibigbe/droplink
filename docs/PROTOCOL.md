# DropLink protocol reference

What another client (for example the planned native macOS menu-bar app) needs to speak DropLink
with no schema changes. The web app's implementation is the reference: file paths are in brackets.

## Identity

- Sign in with Supabase Auth (same project, same users).
- Generate an ECDH **P-256** key pair and keep the private key on the device (the Keychain on macOS).
- Insert a `devices` row: `id` (client-generated UUID), `user_id`, `name` (1–60 chars),
  `kind` (`mac` | `windows` | `linux` | `android` | `ios` | `other`), `public_key` (JWK with only
  `kty`, `crv`, `x`, `y`). [`services/identity.ts`, `services/devices.ts`]
- Update `last_seen_at` about once a minute while running. If an update fails with
  `device is revoked`, delete local keys and sign out.

## Presence and signaling (Supabase Realtime)

- Private channel `user:{auth.uid()}` (`config.private = true`, presence key = device id) for
  your own devices, plus one `pair:{a}:{b}` channel per accepted contact (`a` < `b` are the two
  user ids, lowercase; same config) carrying the same events between your devices and theirs.
  On a pair channel, drop messages whose `from` isn't one of the contact's devices, and only count
  the contact's devices in its presence. Route each message to the channel of whoever owns `to`.
  [`services/signaling.ts`]
- Contacts are managed with the RPCs `my_contacts`, `request_contact(p_email)`,
  `respond_contact(p_other, p_accept)`, `remove_contact(p_other)`, `create_contact_invite()` and
  `accept_contact_invite(p_token)`; invite links are `/add?invite={token}`. A contact's devices
  are readable from `devices` (filter by `user_id`).
- Track presence `{ deviceId, name, kind }`.
- Broadcast events `offer`, `answer`, `ice`, `transfer-request`, `transfer-accept`,
  `transfer-decline`. Every payload has `{ to, from, transferId }` (UUIDs); ignore messages where
  `to` isn't you. Shapes and limits: [`core/signal.ts`].
  - `transfer-request { fromName, fileCount, totalBytes }` → reply `transfer-accept`.
  - `offer`/`answer { attempt, sdp }`, `ice { attempt, candidate | null }`. A higher `attempt`
    replaces the previous connection (reconnect).
- ICE servers: POST `functions/v1/turn-credentials` with the user JWT → `{ iceServers, ttl }`.

## Data channel `files` (ordered, reliable)

Sender = offerer. Text messages are JSON; binary messages are chunks. [`core/protocol.ts`]

| Direction | Message                                                                           |
| --------- | --------------------------------------------------------------------------------- |
| S→R       | `file-meta { id, name, size, mimeType, lastModified, index, total }`              |
| R→S       | `ack { id, chunk }`: chunks already written (0 = new file, >0 = resume from here) |
| S→R       | binary: `u8 version=1` ‖ 16-byte file UUID ‖ `u32be chunkIndex` ‖ ≤ 64 KB payload |
| R→S       | `ack { id, chunk }` every ~2 MB written (sender keeps ≤ 16 MB unacked)            |
| S→R       | `file-done { id, sha256? }`                                                       |
| R→S       | `ack { id, chunk, done: true }` once the file is closed on disk                   |
| either    | `file-cancel { id }`, `error { id, message }`                                     |
| S→R       | `bye { cancelled? }`                                                              |

Sender backpressure: pause when `bufferedAmount > 8 MB`, resume on `bufferedamountlow` (1 MB).

## Push

Save subscriptions with RPC `save_push_subscription(p_device_id, p_endpoint, p_p256dh, p_auth)`.
Senders call `functions/v1/notify-device { transferId }`. Payload received:
`{ v: 1, type: 'incoming', transferId, fromName, fileCount, totalBytes }`. A native app could use
APNs instead and keep the same transfer flow.

## Relay (end-to-end encrypted) [`core/crypto.ts`, `services/relay.ts`]

1. Sender: `update transfers set relay_params = { v: 1, epk, salt, ivPrefix }` (base64url).
2. `shared = ECDH(ephemeral, target public key)`;
   `key = HKDF-SHA-256(shared, salt, info = "droplink-relay-v1:" + transferId)` → AES-GCM-256.
3. Objects in bucket `relay`, each registered in `relay_objects` **before** upload:
   - `{uid}/{transferId}/manifest`: `fileIndex = 0xFFFFFFFF`, `chunkIndex 0`, `chunkCount 1`.
     JSON `{ v: 1, chunkBytes: 1048576, files: [{ name, size, mimeType, lastModified, chunks }] }`.
   - `{uid}/{transferId}/{fileIndex}/{chunkIndex}`: 1 MiB plaintext chunks.
   - IV = `ivPrefix(4) ‖ u32be fileIndex ‖ u32be chunkIndex`;
     AAD = UTF-8 `"{transferId}|{fileIndex}|{chunkIndex}|{chunkCount}"`.
4. Set `status = 'relayed'` (the server verifies the uploads).
5. Receiver: list `transfers` with `to_device_id = me and status = 'relayed'`, derive the key with its
   private key, decrypt the manifest and then the chunks in order, set `status = 'delivered'`, then delete
   the objects and `relay_objects` rows.

Limits are enforced in Postgres: 100 MB per transfer, 500 MB per user per day, 20 relayed transfers
per hour, objects ≤ 1 MiB + 1 KiB.
