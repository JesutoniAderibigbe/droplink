import { describe, expect, it } from 'vitest';
import { availableName, sanitizeFileName } from '../../src/lib/core/names';

describe('sanitizeFileName', () => {
  it('removes path traversal and illegal characters', () => {
    expect(sanitizeFileName('../../etc/passwd')).toBe('_.._etc_passwd');
    expect(sanitizeFileName('a:b*c?.txt')).toBe('a_b_c_.txt');
    expect(sanitizeFileName('bad\u0000name.jpg')).toBe('bad_name.jpg');
  });
  it('handles empty, dot-only, and reserved names', () => {
    expect(sanitizeFileName('...')).toBe('file');
    expect(sanitizeFileName('')).toBe('file');
    expect(sanitizeFileName('CON.txt')).toBe('file_CON.txt');
  });
  it('keeps normal names', () => {
    expect(sanitizeFileName('IMG_2024 (copy).HEIC')).toBe('IMG_2024 (copy).HEIC');
    expect(sanitizeFileName('résumé.pdf')).toBe('résumé.pdf');
  });
});

describe('availableName', () => {
  it('adds (1), (2) on collisions, before the extension', async () => {
    const taken = new Set(['photo.jpg', 'photo (1).jpg']);
    expect(await availableName('photo.jpg', async (n) => taken.has(n))).toBe('photo (2).jpg');
    expect(await availableName('new.jpg', async (n) => taken.has(n))).toBe('new.jpg');
  });
  it('handles names without an extension and dotfiles', async () => {
    expect(await availableName('README', async (n) => n === 'README')).toBe('README (1)');
    expect(await availableName('.env', async (n) => n === '.env')).toBe('.env (1)');
    expect(await availableName('a.tar.gz', async (n) => n === 'a.tar.gz')).toBe('a.tar (1).gz');
  });
});
