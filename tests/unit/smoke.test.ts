import { describe, it, expect } from 'vitest';

describe('test runner', () => {
  it('has WebCrypto', () => {
    expect(globalThis.crypto.subtle).toBeDefined();
  });
});
