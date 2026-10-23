import { describe, expect, it } from 'vitest';
import {
  MANIFEST_INDEX,
  b64url,
  chunkIv,
  decryptChunk,
  decryptManifest,
  encryptChunk,
  encryptManifest,
  fromB64url,
  receiverKey,
  senderKeys,
  type Manifest,
} from '../../src/lib/core/crypto';

/** A receiving device: non-extractable private key, like identity.ts creates. */
async function device() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, [
    'deriveBits',
  ]);
  const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  return { privateKey: pair.privateKey, publicJwk: jwk };
}

const transferId = crypto.randomUUID();
const bytes = (n: number) => {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i += 65536) crypto.getRandomValues(out.subarray(i, i + 65536));
  return out;
};

describe('relay crypto', () => {
  it('sender and receiver derive the same key (receiver key is non-extractable)', async () => {
    const mac = await device();
    const { key, params } = await senderKeys(mac.publicJwk, transferId);
    const rkey = await receiverKey(mac.privateKey, params, transferId);
    const pos = {
      transferId,
      ivPrefix: fromB64url(params.ivPrefix),
      fileIndex: 0,
      chunkIndex: 0,
      chunkCount: 1,
    };
    const pt = bytes(1024 * 1024);
    const ct = await encryptChunk(key, pos, pt);
    expect(ct.byteLength).toBe(pt.byteLength + 16);
    expect(await decryptChunk(rkey, pos, ct)).toEqual(pt);
    expect(mac.privateKey.extractable).toBe(false);
  });

  it('does not leak the private part of the ephemeral key', async () => {
    const mac = await device();
    const { params } = await senderKeys(mac.publicJwk, transferId);
    expect(Object.keys(params.epk).sort()).toEqual(['crv', 'kty', 'x', 'y']);
  });

  it('another device cannot decrypt', async () => {
    const [mac, other] = [await device(), await device()];
    const { key, params } = await senderKeys(mac.publicJwk, transferId);
    const pos = {
      transferId,
      ivPrefix: fromB64url(params.ivPrefix),
      fileIndex: 0,
      chunkIndex: 0,
      chunkCount: 1,
    };
    const ct = await encryptChunk(key, pos, bytes(100));
    const wrong = await receiverKey(other.privateKey, params, transferId);
    await expect(decryptChunk(wrong, pos, ct)).rejects.toThrow();
  });

  it('detects tampering, chunk swapping, truncation and cross-transfer replay', async () => {
    const mac = await device();
    const { key, params } = await senderKeys(mac.publicJwk, transferId);
    const ivPrefix = fromB64url(params.ivPrefix);
    const pos = (chunkIndex: number, chunkCount = 3, id = transferId) => ({
      transferId: id,
      ivPrefix,
      fileIndex: 0,
      chunkIndex,
      chunkCount,
    });
    const c0 = await encryptChunk(key, pos(0), bytes(100));
    const c1 = await encryptChunk(key, pos(1), bytes(100));

    const flipped = c0.slice();
    flipped[5] ^= 1;
    await expect(decryptChunk(key, pos(0), flipped)).rejects.toThrow();
    await expect(decryptChunk(key, pos(0), c1)).rejects.toThrow(); // swapped
    await expect(decryptChunk(key, pos(1, 2), c1)).rejects.toThrow(); // claims fewer chunks
    await expect(decryptChunk(key, pos(0, 3, crypto.randomUUID()), c0)).rejects.toThrow(); // other transfer
    expect((await decryptChunk(key, pos(1), c1)).byteLength).toBe(100);
  });

  it('IVs are unique per file and chunk and use the random prefix', () => {
    const prefix = new Uint8Array([1, 2, 3, 4]);
    const seen = new Set<string>();
    for (let f = 0; f < 5; f++)
      for (let c = 0; c < 200; c++) seen.add(b64url(chunkIv(prefix, f, c)));
    seen.add(b64url(chunkIv(prefix, MANIFEST_INDEX, 0)));
    expect(seen.size).toBe(1001);
    expect(Array.from(chunkIv(prefix, 0, 0).subarray(0, 4))).toEqual([1, 2, 3, 4]);
  });

  it('round-trips the encrypted manifest and validates it', async () => {
    const mac = await device();
    const { key, params } = await senderKeys(mac.publicJwk, transferId);
    const ivPrefix = fromB64url(params.ivPrefix);
    const m: Manifest = {
      v: 1,
      chunkBytes: 1024 * 1024,
      files: [
        {
          name: 'Résumé (final).pdf',
          size: 3 * 1024 * 1024 + 5,
          mimeType: 'application/pdf',
          lastModified: 1,
          chunks: 4,
        },
      ],
    };
    const ct = await encryptManifest(key, transferId, ivPrefix, m);
    expect(new TextDecoder().decode(ct)).not.toContain('Résumé'); // names are not visible
    expect(
      await decryptManifest(
        await receiverKey(mac.privateKey, params, transferId),
        transferId,
        ivPrefix,
        ct,
      ),
    ).toEqual(m);

    const bad = await encryptManifest(key, transferId, ivPrefix, {
      ...m,
      files: [{ ...m.files[0], chunks: 99 }],
    });
    await expect(decryptManifest(key, transferId, ivPrefix, bad)).rejects.toThrow(
      'Invalid manifest',
    );
  });

  it('base64url round-trips', () => {
    const b = bytes(37);
    expect(fromB64url(b64url(b))).toEqual(b);
  });
});
