// Generate a VAPID key pair for Web Push (ECDSA P-256), printed in the
// base64url formats web-push and PushManager.subscribe() expect.
// Usage: npm run vapid
//   VITE_VAPID_PUBLIC_KEY / VAPID_PUBLIC_KEY = public key (65-byte uncompressed point)
//   VAPID_PRIVATE_KEY                         = private key (32-byte scalar). Keep secret.
const { subtle } = globalThis.crypto;
const pair = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']);
const pub = Buffer.from(await subtle.exportKey('raw', pair.publicKey)).toString('base64url');
const { d } = await subtle.exportKey('jwk', pair.privateKey);
console.log(`VITE_VAPID_PUBLIC_KEY=${pub}`);
console.log(`VAPID_PUBLIC_KEY=${pub}`);
console.log(`VAPID_PRIVATE_KEY=${d}`);
