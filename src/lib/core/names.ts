// File names from the network are untrusted. Make them safe to create on any
// OS, and pick a free name when one is taken.

const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;

export function sanitizeFileName(name: string): string {
  let n = name
    .normalize('NFC')
    // Path separators, characters Windows/macOS reject, and control characters.
    // eslint-disable-next-line no-control-regex
    .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, '_')
    .replace(/^[\s.]+|[\s.]+$/g, '')
    .slice(0, 200);
  if (!n || RESERVED.test(n)) n = `file${n ? `_${n}` : ''}`;
  return n;
}

export function splitExt(name: string): [base: string, ext: string] {
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return [name, ''];
  return [name.slice(0, dot), name.slice(dot)];
}

/** "photo.jpg" → "photo (1).jpg" → "photo (2).jpg" … */
export async function availableName(
  name: string,
  exists: (candidate: string) => Promise<boolean>,
): Promise<string> {
  if (!(await exists(name))) return name;
  const [base, ext] = splitExt(name);
  for (let i = 1; i < 10_000; i++) {
    const candidate = `${base} (${i})${ext}`;
    if (!(await exists(candidate))) return candidate;
  }
  return `${base} (${crypto.randomUUID().slice(0, 8)})${ext}`;
}
