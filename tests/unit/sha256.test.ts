import { describe, expect, it } from 'vitest';
import { Sha256 } from '../../src/lib/core/sha256';

function randomBytes(n: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i += 65536) crypto.getRandomValues(out.subarray(i, i + 65536));
  return out;
}

async function webcrypto(data: Uint8Array<ArrayBuffer>): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  return Array.from(d, (x) => x.toString(16).padStart(2, '0')).join('');
}

describe('incremental SHA-256', () => {
  it('matches known vectors', () => {
    expect(new Sha256().hex()).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
    expect(new Sha256().update(new TextEncoder().encode('abc')).hex()).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it.each([1, 55, 56, 63, 64, 65, 1000, 200_000])(
    'matches WebCrypto for %i bytes fed in odd pieces',
    async (n) => {
      const data = randomBytes(n);
      const h = new Sha256();
      for (let i = 0; i < n;) {
        const step = 1 + ((i * 7919) % 97);
        h.update(data.subarray(i, i + step));
        i += step;
      }
      expect(h.hex()).toBe(await webcrypto(data));
    },
  );
});
