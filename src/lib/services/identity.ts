import { del, get, set } from 'idb-keyval';
import { keys, kvStore } from './kv';

/**
 * A device's identity: a random id and an ECDH P-256 key pair. The private key
 * is generated non-extractable, so even code running on this page can't read
 * its bytes; it can only be used for deriveBits. IndexedDB can store a
 * CryptoKey object as is (structured clone), which keeps that property.
 */
export interface DeviceIdentity {
  deviceId: string;
  privateKey: CryptoKey;
  publicJwk: JsonWebKey;
}

export async function loadIdentity(userId: string): Promise<DeviceIdentity | undefined> {
  return get<DeviceIdentity>(keys.identity(userId), kvStore);
}

export async function createIdentity(userId: string): Promise<DeviceIdentity> {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, [
    'deriveBits',
  ]);
  // The public half of a generated pair is always exportable.
  const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  const identity: DeviceIdentity = {
    deviceId: crypto.randomUUID(),
    privateKey: pair.privateKey,
    publicJwk: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y },
  };
  await set(keys.identity(userId), identity, kvStore);
  return identity;
}

export async function forgetIdentity(userId: string): Promise<void> {
  await del(keys.identity(userId), kvStore);
}
