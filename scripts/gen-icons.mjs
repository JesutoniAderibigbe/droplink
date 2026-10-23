// Generates PNG icons from public/icons/icon.svg.
// Usage: npm run icons
import sharp from 'sharp';
import { readFile } from 'node:fs/promises';

const svg = await readFile(new URL('../public/icons/icon.svg', import.meta.url));
const out = (name) => new URL(`../public/icons/${name}`, import.meta.url).pathname;

await sharp(svg).resize(192, 192).png().toFile(out('icon-192.png'));
await sharp(svg).resize(512, 512).png().toFile(out('icon-512.png'));
await sharp(svg).resize(180, 180).png().toFile(out('apple-touch-icon.png'));

// Maskable: the OS may crop to a circle, so keep the artwork inside the
// central 80% "safe zone" on a full-bleed background.
const inner = await sharp(svg).resize(400, 400).png().toBuffer();
await sharp({ create: { width: 512, height: 512, channels: 4, background: '#2f6bff' } })
  .composite([{ input: inner, top: 56, left: 56 }])
  .png()
  .toFile(out('icon-maskable-512.png'));

await sharp(svg)
  .resize(48, 48)
  .png()
  .toFile(new URL('../public/favicon.png', import.meta.url).pathname);
console.log('Icons written to public/icons');
