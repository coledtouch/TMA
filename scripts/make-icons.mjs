// Generates PWA / Apple touch icons and a trimmed shield logo from the source
// artwork in public/brand. Run with `npm run icons` after replacing the logos.
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';

const SRC = 'public/brand/timberlane-shield-source.webp';
const BG = { r: 255, g: 255, b: 255, alpha: 1 }; // white matches the artwork's own background

mkdirSync('public/icons', { recursive: true });

// Trim the white border around the shield so it can be sized precisely.
const trimmed = await sharp(SRC).trim({ background: '#ffffff', threshold: 20 }).png().toBuffer();
await sharp(trimmed).toFile('public/brand/timberlane-shield.png');

async function icon(size, scale, out) {
  const inner = Math.round(size * scale);
  const shield = await sharp(trimmed)
    .resize({ width: inner, height: inner, fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 }, kernel: 'lanczos3' })
    .png()
    .toBuffer();
  await sharp({ create: { width: size, height: size, channels: 4, background: BG } })
    .composite([{ input: shield, gravity: 'center' }])
    .png()
    .toFile(out);
}

await icon(192, 0.84, 'public/icons/icon-192.png');
await icon(512, 0.84, 'public/icons/icon-512.png');
await icon(512, 0.62, 'public/icons/maskable-512.png'); // keeps the shield inside the 80% safe zone
await icon(180, 0.8, 'public/icons/apple-touch-icon.png');
await icon(64, 0.9, 'public/icons/favicon-64.png');
console.log('icons written to public/icons');
