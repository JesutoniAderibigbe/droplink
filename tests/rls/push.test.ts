// notify-device end to end, without a real push service: a local HTTPS server
// plays the push service, and we decrypt what it receives (RFC 8291,
// aes128gcm) with the subscription's private key to check the exact
// notification payload.
//
// Needs: `npm run functions:serve` running with VAPID keys, and for the mock's
// self-signed certificate, NODE_TLS_REJECT_UNAUTHORIZED=0 in the functions
// env file plus PUSH_MOCK_CERT / PUSH_MOCK_KEY pointing at a cert/key pair
// (see README "Testing push locally"). Skipped otherwise.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:https';
import { readFileSync } from 'node:fs';
import { addDevice, addTransfer, admin, createUser, deleteUser, type TestUser } from './helpers';

const certPath = process.env.PUSH_MOCK_CERT;
const keyPath = process.env.PUSH_MOCK_KEY;
const PORT = 8443;
const HOST = process.env.PUSH_MOCK_HOST ?? 'host.docker.internal';

const received: { path: string; body: Buffer; headers: Record<string, unknown> }[] = [];
let server: Server;
let a: TestUser;
let b: TestUser;
let phone: string;
let mac: string;
let uaKeys: CryptoKeyPair;
let uaPublic: Uint8Array;
const authSecret = crypto.getRandomValues(new Uint8Array(16));
const b64u = (u: Uint8Array) => Buffer.from(u).toString('base64url');

async function hkdf(
  salt: Uint8Array,
  ikm: Uint8Array,
  info: Uint8Array,
  bytes: number,
): Promise<Uint8Array<ArrayBuffer>> {
  // Copy into ArrayBuffer-backed arrays (Node Buffers may share a pooled buffer).
  const key = await crypto.subtle.importKey('raw', new Uint8Array(ikm), 'HKDF', false, [
    'deriveBits',
  ]);
  return new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(salt), info: new Uint8Array(info) },
      key,
      bytes * 8,
    ),
  );
}

/** RFC 8291 / RFC 8188 aes128gcm decryption, as a browser would do it. */
async function decryptPush(body: Buffer): Promise<string> {
  // Copies, so WebCrypto gets ArrayBuffer-backed views.
  const salt = new Uint8Array(body.subarray(0, 16));
  const idLen = body[20];
  const asPublic = new Uint8Array(body.subarray(21, 21 + idLen));
  const ciphertext = new Uint8Array(body.subarray(21 + idLen));
  const asKey = await crypto.subtle.importKey(
    'raw',
    asPublic,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );
  const ecdh = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'ECDH', public: asKey }, uaKeys.privateKey, 256),
  );
  const enc = new TextEncoder();
  const keyInfo = Buffer.concat([enc.encode('WebPush: info\0'), uaPublic, asPublic]);
  const ikm = await hkdf(authSecret, ecdh, keyInfo, 32);
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
  const padded = new Uint8Array(
    await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, ciphertext),
  );
  let end = padded.length - 1;
  while (end >= 0 && padded[end] === 0) end--;
  expect(padded[end]).toBe(2); // last-record delimiter
  return new TextDecoder().decode(padded.subarray(0, end));
}

async function notify(user: TestUser, transferId: string) {
  const res = await fetch(`${process.env.SUPABASE_URL}/functions/v1/notify-device`, {
    method: 'POST',
    headers: {
      apikey: process.env.SUPABASE_ANON_KEY!,
      authorization: `Bearer ${user.accessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ transferId }),
  });
  return { status: res.status, body: await res.json() };
}

describe.skipIf(!certPath || !keyPath)('notify-device', () => {
  beforeAll(async () => {
    server = createServer(
      { cert: readFileSync(certPath!), key: readFileSync(keyPath!) },
      (req, res) => {
        const chunks: Buffer[] = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => {
          received.push({ path: req.url ?? '', body: Buffer.concat(chunks), headers: req.headers });
          res.statusCode = req.url?.startsWith('/gone/') ? 410 : 201;
          res.end();
        });
      },
    );
    await new Promise<void>((r) => server.listen(PORT, '0.0.0.0', r));

    [a, b] = await Promise.all([createUser('pa'), createUser('pb')]);
    phone = await addDevice(a, "Toni's Pixel");
    mac = await addDevice(a, 'MacBook Air');
    uaKeys = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
      'deriveBits',
    ]);
    uaPublic = new Uint8Array(await crypto.subtle.exportKey('raw', uaKeys.publicKey));
    for (const kind of ['ok', 'gone']) {
      const { error } = await a.client.rpc('save_push_subscription', {
        p_device_id: mac,
        p_endpoint: `https://${HOST}:${PORT}/${kind}/${crypto.randomUUID()}`,
        p_p256dh: b64u(uaPublic),
        p_auth: b64u(authSecret),
      });
      if (error) throw error;
    }
  });

  afterAll(async () => {
    server?.close();
    await deleteUser(a);
    await deleteUser(b);
  });

  it('pushes the target, with a payload built from the database', async () => {
    const t = await addTransfer(a, phone, mac, 24 * 1024 * 1024, 3);
    const r = await notify(a, t);
    expect(r).toEqual({ status: 200, body: { sent: 1, removed: 1 } });

    const ok = received.find((m) => m.path.startsWith('/ok/'))!;
    expect(ok.headers['content-encoding']).toBe('aes128gcm');
    expect(String(ok.headers.authorization)).toMatch(/^vapid t=/);
    expect(ok.headers.urgency).toBe('high');
    expect(JSON.parse(await decryptPush(ok.body))).toEqual({
      v: 1,
      type: 'incoming',
      transferId: t,
      fromName: "Toni's Pixel",
      fileCount: 3,
      totalBytes: 24 * 1024 * 1024,
    });
  });

  it('removed the subscription the push service reported as gone (410)', async () => {
    const { data } = await admin.from('push_subscriptions').select('endpoint').eq('device_id', mac);
    expect(data!.map((s) => new URL(s.endpoint).pathname.split('/')[1])).toEqual(['ok']);
  });

  it('sends at most one push per transfer', async () => {
    const t = await addTransfer(a, phone, mac);
    expect((await notify(a, t)).body.sent).toBe(1);
    expect((await notify(a, t)).body).toMatchObject({ sent: 0 });
  });

  it("refuses another account's transfer and unauthenticated callers", async () => {
    const t = await addTransfer(a, phone, mac);
    expect((await notify(b, t)).status).toBe(404);
    const anon = await fetch(`${process.env.SUPABASE_URL}/functions/v1/notify-device`, {
      method: 'POST',
      headers: { apikey: process.env.SUPABASE_ANON_KEY!, 'content-type': 'application/json' },
      body: JSON.stringify({ transferId: t }),
    });
    expect(anon.status).toBe(401);
  });

  it("can't save a subscription for someone else's device", async () => {
    const { error } = await b.client.rpc('save_push_subscription', {
      p_device_id: mac,
      p_endpoint: 'https://evil.example/x',
      p_p256dh: 'x',
      p_auth: 'y',
    });
    expect(error).not.toBeNull();
  });

  it("pushes a contact's device, under the sender's name", async () => {
    const { data: inv } = await a.client.rpc('create_contact_invite');
    const { error: e1 } = await b.client.rpc('accept_contact_invite', { p_token: inv[0].token });
    expect(e1).toBeNull();
    await admin.from('profiles').update({ display_name: 'Ada Lovelace' }).eq('id', a.id);
    const iphone = await addDevice(b, 'iPhone');
    const { error: e2 } = await b.client.rpc('save_push_subscription', {
      p_device_id: iphone,
      p_endpoint: `https://${HOST}:${PORT}/contact/${crypto.randomUUID()}`,
      p_p256dh: b64u(uaPublic),
      p_auth: b64u(authSecret),
    });
    expect(e2).toBeNull();

    const t = await addTransfer(a, phone, iphone, 5000, 2);
    expect(await notify(a, t)).toEqual({ status: 200, body: { sent: 1, removed: 0 } });
    const msg = received.find((m) => m.path.startsWith('/contact/'))!;
    expect(JSON.parse(await decryptPush(msg.body))).toMatchObject({
      transferId: t,
      fromName: 'Ada Lovelace',
      fileCount: 2,
    });
  });
});
