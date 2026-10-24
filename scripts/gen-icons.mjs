// Generates PNG icons from the brand SVGs (logo sheet in the design canvas).
// Usage: npm run icons
//   public/icons/icon.svg           app icon (rounded square)   → 192, 512
//   public/icons/icon-maskable.svg  full bleed, 80% safe zone   → maskable 512, apple-touch 180
//   public/favicon.svg              simplified for tabs         → favicon.png 48
import sharp from 'sharp';
import { readFile } from 'node:fs/promises';

const read = (p) => readFile(new URL(`../public/${p}`, import.meta.url));
const out = (p) => new URL(`../public/${p}`, import.meta.url).pathname;
// Render at high density so edges stay crisp after downscaling.
const render = (svg, size, file) =>
  sharp(svg, { density: 384 }).resize(size, size).png().toFile(out(file));

const icon = await read('icons/icon.svg');
const maskable = await read('icons/icon-maskable.svg');
const favicon = await read('favicon.svg');

await render(icon, 192, 'icons/icon-192.png');
await render(icon, 512, 'icons/icon-512.png');
await render(maskable, 512, 'icons/icon-maskable-512.png');
// iOS rounds the corners itself, so it gets the full-bleed artwork.
await render(maskable, 180, 'icons/apple-touch-icon.png');
await render(favicon, 48, 'favicon.png');
// Android notification badge: drawn as a one-colour silhouette, so use the
// transparent mark rather than the square icon.
await render(await read('icons/mark.svg'), 96, 'icons/badge-96.png');
console.log('Icons written to public/icons and public/favicon.png');
