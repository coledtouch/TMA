// Builds every logo and icon file from the official artwork,
// public/brand/tma-music-logo-source.webp (owl, music notes, TIMBERLANE MUSIC,
// drawn on white). Run with `npm run icons` after replacing that file. The
// output only depends on the source, so running it twice gives the same files.
//
//   public/brand/tma-logo-light.webp  sign-in logo for the light theme
//   public/brand/tma-logo-dark.webp   sign-in logo for the dark theme (lighter notes)
//   public/brand/tma-logo-email.png   small logo for the top of emails (PNG: not every mail app shows WebP)
//   public/brand/tma-owl-mark.png     owl face on a white disc, for the app header
//   public/icons/*                    app icons, favicons and the notification badge
//
// Icons use a white background: the artwork was drawn for white, and its black
// outlines and maroon letters would sink into a maroon background.
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';

const SRC = 'public/brand/tma-music-logo-source.webp';
const WHITE = { r: 255, g: 255, b: 255, alpha: 1 };
const CLEAR = { r: 0, g: 0, b: 0, alpha: 0 };
/** Notes and staff lines in the dark theme: the light text colour (--ink in tokens.css). */
const DARK_NOTES = [244, 238, 236];
/** Pixels at least this dark are outlines, letters or the owl; lighter ones may be page or notes. */
const SOLID_BELOW = 110;

mkdirSync('public/brand', { recursive: true });
mkdirSync('public/icons', { recursive: true });

const { data: src, info } = await sharp(SRC).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const W = info.width;
const H = info.height;
const N = W * H;

const lum = new Float32Array(N);
const maroon = new Uint8Array(N);
for (let i = 0; i < N; i += 1) {
  const r = src[i * 3];
  const g = src[i * 3 + 1];
  const b = src[i * 3 + 2];
  lum[i] = 0.299 * r + 0.587 * g + 0.114 * b;
  maroon[i] = r > 70 && r > 2 * g && r > 2 * b ? 1 : 0;
}

/**
 * Labels connected regions (4-neighbour, so a diagonal gap in an outline does
 * not leak) of pixels where `inside(i)` holds. Returns the label per pixel
 * (0 = not inside) and the number of labels.
 */
function label(inside) {
  const labels = new Int32Array(N);
  const stack = new Int32Array(N);
  let count = 0;
  for (let start = 0; start < N; start += 1) {
    if (labels[start] || !inside(start)) continue;
    count += 1;
    labels[start] = count;
    let top = 0;
    stack[top++] = start;
    while (top > 0) {
      const i = stack[--top];
      const x = i % W;
      for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i - W, i + W]) {
        if (j < 0 || j >= N || labels[j] || !inside(j)) continue;
        labels[j] = count;
        stack[top++] = j;
      }
    }
  }
  return { labels, count };
}

const onBorder = (i) => i < W || i >= N - W || i % W === 0 || i % W === W - 1;

// 1. Light regions. The one that reaches the edge of the image is the page,
//    with the grey notes and staff lines on it: those become see-through.
const light = label((i) => lum[i] >= SOLID_BELOW);
const outside = new Uint8Array(light.count + 1);
for (let i = 0; i < N; i += 1) if (onBorder(i) && light.labels[i]) outside[light.labels[i]] = 1;

// 2. Holes: small pure-white regions with no maroon next to them (inside B,
//    R and E, and the gaps between letters) are the page showing through, so
//    they become see-through too. TIMBERLANE's white inline touches maroon,
//    the MUSIC letters are far bigger and the owl's face is light grey, so all
//    of those stay as drawn.
const size = new Int32Array(light.count + 1);
const white = new Int32Array(light.count + 1);
const nearMaroon = new Uint8Array(light.count + 1);
for (let i = 0; i < N; i += 1) {
  const l = light.labels[i];
  if (!l) continue;
  size[l] += 1;
  if (lum[i] >= 250) white[l] += 1;
  const x = i % W;
  for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i - W, i + W]) {
    if (j >= 0 && j < N && maroon[j]) nearMaroon[l] = 1;
  }
}
const clear = new Uint8Array(N); // 1 = page, notes or hole: alpha comes from how dark the pixel is
for (let i = 0; i < N; i += 1) {
  const l = light.labels[i];
  if (!l) continue;
  const hole = !nearMaroon[l] && white[l] >= size[l] / 2 && size[l] < N * 0.002;
  if (outside[l] || hole) clear[i] = 1;
}

/** Distance (in pixels, roughly) from each pixel to the nearest pixel where `mask` is set. */
function distanceTo(mask) {
  const d = new Float32Array(N);
  for (let i = 0; i < N; i += 1) d[i] = mask[i] ? 0 : 1e6;
  const step = (i, j, cost) => {
    if (d[j] + cost < d[i]) d[i] = d[j] + cost;
  };
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const i = y * W + x;
      if (x > 0) step(i, i - 1, 1);
      if (y > 0) step(i, i - W, 1);
      if (x > 0 && y > 0) step(i, i - W - 1, 1.4);
      if (x < W - 1 && y > 0) step(i, i - W + 1, 1.4);
    }
  }
  for (let y = H - 1; y >= 0; y -= 1) {
    for (let x = W - 1; x >= 0; x -= 1) {
      const i = y * W + x;
      if (x < W - 1) step(i, i + 1, 1);
      if (y < H - 1) step(i, i + W, 1);
      if (x < W - 1 && y < H - 1) step(i, i + W + 1, 1.4);
      if (x > 0 && y < H - 1) step(i, i + W - 1, 1.4);
    }
  }
  return d;
}

// 3. How far each page pixel is from the artwork (its anti-aliased rim is
//    near, the notes are far), and each artwork pixel from the page (its own
//    soft edge, which is part white too).
const solid = clear.map((c) => 1 - c);
const fromArt = distanceTo(solid);
const fromPage = distanceTo(clear);

// 4. Only two inks touch the page: black and the maroon of the letters.
let mr = 0;
let mg = 0;
let mb = 0;
let mn = 0;
for (let i = W; i < N - W; i += 1) {
  if (!(maroon[i] && maroon[i - 1] && maroon[i + 1] && maroon[i - W] && maroon[i + W])) continue;
  mr += src[i * 3];
  mg += src[i * 3 + 1];
  mb += src[i * 3 + 2];
  mn += 1;
}
const INKS = [
  [0, 0, 0],
  [mr / mn, mg / mn, mb / mn],
];

const clamp01 = (v) => Math.max(0, Math.min(1, v));

/**
 * Splits a pixel drawn over white into ink colour + alpha: the ink (black or
 * maroon) and amount that, laid over white, best gives the pixel. So a grey
 * note becomes partly see-through black, and an outline's soft edge becomes
 * that outline colour fading out, with no white fringe on a dark background.
 */
function unmix(r, g, b) {
  let best = null;
  for (const ink of INKS) {
    const k = [255 - ink[0], 255 - ink[1], 255 - ink[2]];
    const a = clamp01(((255 - r) * k[0] + (255 - g) * k[1] + (255 - b) * k[2]) / (k[0] ** 2 + k[1] ** 2 + k[2] ** 2));
    const miss = (255 - a * k[0] - r) ** 2 + (255 - a * k[1] - g) ** 2 + (255 - a * k[2] - b) ** 2;
    if (!best || miss < best.miss) best = { ink, a, miss };
  }
  return best;
}

/**
 * One RGBA rendering of the whole artwork: the page and the holes become
 * clear, the notes and every edge that touches the page are unmixed from
 * white, and the rest is kept exactly as drawn.
 *   notes: colour for the notes and staff lines, or null to keep them as drawn
 *   owlOnly: drop the notes and staff lines entirely (small icons)
 */
function render({ notes = null, owlOnly = false }) {
  const out = Buffer.alloc(N * 4);
  for (let i = 0; i < N; i += 1) {
    let rgb = [src[i * 3], src[i * 3 + 1], src[i * 3 + 2]];
    let a = 1;
    if (clear[i] || (lum[i] < SOLID_BELOW && fromPage[i] <= 2)) {
      const mix = unmix(...rgb);
      // Ignore the faintest specks so the page is fully clear.
      a = clear[i] ? clamp01((mix.a - 0.04) / 0.96) : mix.a;
      if (a < 0.995) rgb = [...mix.ink];
      else a = 1;
      // Beyond an outline's soft edge, a page pixel is a note or staff line.
      const far = clear[i] ? clamp01((fromArt[i] - 2) / 2) : 0;
      if (owlOnly) a *= 1 - far;
      else if (notes) {
        // Unseen page pixels take the notes' colour too: it keeps the WebP smaller.
        const t = a === 0 ? 1 : far;
        rgb = rgb.map((c, k) => c + (notes[k] - c) * t);
      }
    }
    out[i * 4] = Math.round(rgb[0]);
    out[i * 4 + 1] = Math.round(rgb[1]);
    out[i * 4 + 2] = Math.round(rgb[2]);
    out[i * 4 + 3] = Math.round(a * 255);
  }
  return out;
}

/** Bounding box of pixels with real alpha, optionally only above row `maxY`. */
function bbox(rgba, maxY = H) {
  let x0 = W;
  let y0 = H;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < maxY; y += 1) {
    for (let x = 0; x < W; x += 1) {
      if (rgba[(y * W + x) * 4 + 3] < 8) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return { left: x0, top: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
}

const raw = { raw: { width: W, height: H, channels: 4 } };
const lightArt = render({});
const darkArt = render({ notes: DARK_NOTES });
const owlArt = render({ owlOnly: true });

// The whole logo, cropped to the artwork with a small even margin.
const box = bbox(lightArt);
const pad = Math.round(box.width * 0.01);
const crop = {
  left: Math.max(0, box.left - pad),
  top: Math.max(0, box.top - pad),
  width: Math.min(W, box.left + box.width + pad) - Math.max(0, box.left - pad),
  height: Math.min(H, box.top + box.height + pad) - Math.max(0, box.top - pad),
};
const logo = (art) => sharp(art, raw).extract(crop).png().toBuffer();
const logoLight = await logo(lightArt);
const logoDark = await logo(darkArt);

// The owl: everything above the gap over TIMBERLANE. Find the first row that
// is mostly maroon, then go up past the letters' black outline to a row with
// only page and notes in it.
let owlBottom = H;
for (let y = 0; y < H && owlBottom === H; y += 1) {
  let count = 0;
  for (let x = 0; x < W; x += 1) count += maroon[y * W + x];
  if (count > W * 0.05) owlBottom = y;
}
const hasArt = (y) => {
  for (let x = 0; x < W; x += 1) if (!clear[y * W + x]) return true;
  return false;
};
while (owlBottom > 0 && hasArt(owlBottom)) owlBottom -= 1;
const owl = await sharp(owlArt, raw).extract(bbox(owlArt, owlBottom)).png().toBuffer();

/** 256-colour PNGs: a third of the size, and they look the same. */
const PNG = { compressionLevel: 9, palette: true, quality: 95, effort: 10 };
const LOGO_WIDTH = 800; // sign-in shows it 240 CSS px wide, so this is sharp at 3x
const webp = { quality: 85, alphaQuality: 95, effort: 6, smartSubsample: true };
await sharp(logoLight).resize({ width: LOGO_WIDTH, kernel: 'lanczos3' }).webp(webp).toFile('public/brand/tma-logo-light.webp');
await sharp(logoDark).resize({ width: LOGO_WIDTH, kernel: 'lanczos3' }).webp(webp).toFile('public/brand/tma-logo-dark.webp');
// Emails show it at 120 x 93 (src/server/email.ts); twice that keeps it sharp on phones.
await sharp(logoLight)
  .resize({ width: 240, height: 186, fit: 'contain', background: CLEAR, kernel: 'lanczos3' })
  .png(PNG)
  .toFile('public/brand/tma-logo-email.png');

/** `art` scaled to fit `scale` of a `size` square, centred on `background` (then moved down `drop` of the size). */
async function square(art, size, scale, background, out, drop = 0) {
  const inner = Math.round(size * scale);
  const fitted = await sharp(art)
    .resize({ width: inner, height: inner, fit: 'contain', background: CLEAR, kernel: 'lanczos3' })
    .png()
    .toBuffer();
  const edge = Math.round((size - inner) / 2);
  const img = sharp({ create: { width: size, height: size, channels: 4, background } }).composite([
    { input: fitted, left: edge, top: edge + Math.round(size * drop) },
  ]);
  return out ? img.png(PNG).toFile(out) : img.png().toBuffer();
}

/** Keeps only a circle (or rounded square, `radius` < size / 2) of a square image. */
async function mask(input, size, radius, out) {
  const shape = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${radius}" fill="#fff"/></svg>`,
  );
  await sharp(input)
    .composite([{ input: shape, blend: 'dest-in' }])
    .png(PNG)
    .toFile(out);
}

// App icons: the whole logo on white. Android masks "maskable" icons to a
// circle or squircle, so there it fits inside the middle 80% (the safe zone):
// the logo's corners stay within a circle of 40% of the icon size.
const safe = 0.8 / Math.hypot(1, crop.height / crop.width);
await square(logoLight, 192, 0.9, WHITE, 'public/icons/icon-192.png');
await square(logoLight, 512, 0.9, WHITE, 'public/icons/icon-512.png');
await square(logoLight, 512, safe, WHITE, 'public/icons/maskable-512.png');
await sharp(await square(logoLight, 180, 0.86, WHITE))
  .flatten({ background: '#ffffff' }) // iOS shows transparency as black
  .removeAlpha()
  .png(PNG)
  .toFile('public/icons/apple-touch-icon.png');

// Favicons: the whole logo is unreadable at tab size, so just the owl, on a
// white rounded tile that shows up on light and dark tab bars.
await mask(await square(owl, 64, 0.92, WHITE), 64, 12, 'public/icons/favicon-64.png');
await mask(await square(owl, 32, 0.94, WHITE), 32, 6, 'public/icons/favicon-32.png');

// App header: the owl on a white disc, readable on the maroon (light) and
// near-black (dark) header bars. A little low, so the brow tips clear the rim.
await mask(await square(owl, 128, 0.84, WHITE, null, 0.03), 128, 64, 'public/brand/tma-owl-mark.png');

/**
 * Notification badge (Android status bar). Android draws badges from the alpha
 * channel only, so this is a white owl on transparency: the black of the owl
 * (outline, brows, eyes, beak) is opaque and its light face is cut out.
 */
async function badge(size, out) {
  const inner = Math.round(size * 0.92);
  const { data, info: fit } = await sharp(owl)
    .resize({ width: inner, height: inner, fit: 'contain', background: CLEAR, kernel: 'lanczos3' })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const pixels = fit.width * fit.height;
  const rgba = Buffer.alloc(pixels * 4, 255);
  for (let i = 0; i < pixels; i += 1) {
    const l = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
    // Smooth ramp: luminance <= 80 fully opaque, >= 200 fully transparent.
    const ink = clamp01((200 - l) / 120);
    rgba[i * 4 + 3] = Math.round(ink * data[i * 4 + 3]);
  }
  const owlBadge = await sharp(rgba, { raw: { width: fit.width, height: fit.height, channels: 4 } }).png().toBuffer();
  await sharp({ create: { width: size, height: size, channels: 4, background: CLEAR } })
    .composite([{ input: owlBadge, gravity: 'center' }])
    .png(PNG)
    .toFile(out);
}

await badge(96, 'public/icons/badge-96.png');
console.log('logo written to public/brand, icons to public/icons');
