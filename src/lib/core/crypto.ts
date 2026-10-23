// End-to-end encryption for the relay. WebCrypto only.
//
// Key agreement (per transfer):
//   sender:   ephemeral ECDH P-256 key pair E, random 32-byte salt
//   shared  = ECDH(E.private, target device public key)
//           = ECDH(target device private key, E.public)   <- what the receiver computes
//   key     = HKDF-SHA-256(ikm = shared, salt, info = "droplink-relay-v1:" + transferId) -> AES-GCM-256
// The receiving device's private key never leaves it (non-extractable), and
// the server only sees E.public, the salt and the IV prefix. That's enough to
// identify the transfer, not to decrypt it.
//
// Per chunk: AES-GCM with a 96-bit IV = ivPrefix (4 random bytes) || fileIndex
// (uint32) || chunkIndex (uint32). The key is unique per transfer, so IVs never
// repeat under one key. The AAD binds transferId, fileIndex, chunkIndex and the
// file's chunk count, so the server can't swap, replay or truncate chunks
// without decryption failing.

export const MANIFEST_INDEX = 0xffffffff;
const ECDH = { name: 'ECDH', namedCurve: 'P-256' } as const;

export function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromB64url(s: string): Uint8Array<ArrayBuffer> {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

function publicJwk(jwk: JsonWebKey): JsonWebKey {
  // Only the public coordinates; never pass "d" around.
  return { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y };
}

async function importPublic(jwk: JsonWebKey): Promise<CryptoKey> {
  return crypto.subtle.importKey('jwk', publicJwk(jwk), ECDH, false, []);
}

async function hkdfAesKey(
  shared: ArrayBuffer,
  salt: Uint8Array<ArrayBuffer>,
  transferId: string,
): Promise<CryptoKey> {
  const ikm = await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt,
      info: new TextEncoder().encode(`droplink-relay-v1:${transferId}`),
    },
    ikm,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export interface SenderKeys {
  key: CryptoKey;
  /** Stored on the transfer row (relay_params). */
  params: { v: 1; epk: JsonWebKey; salt: string; ivPrefix: string };
}

/** Sender side: fresh ephemeral key, salt and IV prefix for one transfer. */
export async function senderKeys(
  targetPublicJwk: JsonWebKey,
  transferId: string,
): Promise<SenderKeys> {
  const eph = await crypto.subtle.generateKey(ECDH, true, ['deriveBits']);
  const shared = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: await importPublic(targetPublicJwk) },
    eph.privateKey,
    256,
  );
  const salt = crypto.getRandomValues(new Uint8Array(32));
  const ivPrefix = crypto.getRandomValues(new Uint8Array(4));
  const epk = publicJwk(await crypto.subtle.exportKey('jwk', eph.publicKey));
  return {
    key: await hkdfAesKey(shared, salt, transferId),
    params: { v: 1, epk, salt: b64url(salt), ivPrefix: b64url(ivPrefix) },
  };
}

/** Receiver side: same key from this device's (non-extractable) private key. */
export async function receiverKey(
  devicePrivateKey: CryptoKey,
  params: { epk: JsonWebKey; salt: string },
  transferId: string,
): Promise<CryptoKey> {
  const shared = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: await importPublic(params.epk) },
    devicePrivateKey,
    256,
  );
  return hkdfAesKey(shared, fromB64url(params.salt), transferId);
}

export function chunkIv(
  ivPrefix: Uint8Array,
  fileIndex: number,
  chunkIndex: number,
): Uint8Array<ArrayBuffer> {
  const iv = new Uint8Array(12);
  iv.set(ivPrefix.subarray(0, 4), 0);
  const view = new DataView(iv.buffer);
  view.setUint32(4, fileIndex >>> 0);
  view.setUint32(8, chunkIndex >>> 0);
  return iv;
}

function aad(
  transferId: string,
  fileIndex: number,
  chunkIndex: number,
  chunkCount: number,
): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(`${transferId}|${fileIndex >>> 0}|${chunkIndex}|${chunkCount}`);
}

export interface ChunkPosition {
  transferId: string;
  ivPrefix: Uint8Array;
  fileIndex: number;
  chunkIndex: number;
  chunkCount: number;
}

export async function encryptChunk(
  key: CryptoKey,
  pos: ChunkPosition,
  plaintext: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array<ArrayBuffer>> {
  const ct = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: chunkIv(pos.ivPrefix, pos.fileIndex, pos.chunkIndex),
      additionalData: aad(pos.transferId, pos.fileIndex, pos.chunkIndex, pos.chunkCount),
    },
    key,
    plaintext,
  );
  return new Uint8Array(ct);
}

/** Throws (OperationError) if the key is wrong or anything was tampered with. */
export async function decryptChunk(
  key: CryptoKey,
  pos: ChunkPosition,
  ciphertext: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array<ArrayBuffer>> {
  const pt = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: chunkIv(pos.ivPrefix, pos.fileIndex, pos.chunkIndex),
      additionalData: aad(pos.transferId, pos.fileIndex, pos.chunkIndex, pos.chunkCount),
    },
    key,
    ciphertext,
  );
  return new Uint8Array(pt);
}

// --- Manifest -------------------------------------------------------------------

export interface ManifestFile {
  name: string;
  size: number;
  mimeType: string;
  lastModified: number;
  chunks: number;
}

export interface Manifest {
  v: 1;
  chunkBytes: number;
  files: ManifestFile[];
}

export async function encryptManifest(
  key: CryptoKey,
  transferId: string,
  ivPrefix: Uint8Array,
  m: Manifest,
) {
  const pos = { transferId, ivPrefix, fileIndex: MANIFEST_INDEX, chunkIndex: 0, chunkCount: 1 };
  return encryptChunk(key, pos, new TextEncoder().encode(JSON.stringify(m)));
}

export async function decryptManifest(
  key: CryptoKey,
  transferId: string,
  ivPrefix: Uint8Array,
  ciphertext: Uint8Array<ArrayBuffer>,
): Promise<Manifest> {
  const pos = { transferId, ivPrefix, fileIndex: MANIFEST_INDEX, chunkIndex: 0, chunkCount: 1 };
  const m = JSON.parse(
    new TextDecoder().decode(await decryptChunk(key, pos, ciphertext)),
  ) as Manifest;
  // Authenticated, but still validate shape before trusting numbers.
  if (
    m.v !== 1 ||
    !Array.isArray(m.files) ||
    !Number.isInteger(m.chunkBytes) ||
    m.chunkBytes <= 0
  ) {
    throw new Error('Invalid manifest');
  }
  for (const f of m.files) {
    if (
      typeof f.name !== 'string' ||
      !Number.isInteger(f.size) ||
      f.size < 0 ||
      f.chunks !== Math.ceil(f.size / m.chunkBytes)
    ) {
      throw new Error('Invalid manifest');
    }
  }
  return m;
}
