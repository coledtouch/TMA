/**
 * Small, dependency-free SHA-256 and HMAC-SHA256 over UTF-8 strings.
 *
 * Apps Script uses Utilities.computeHmacSha256Signature instead; this module
 * backs the in-memory services (unit tests and the browser demo) and the
 * base64url helpers' UTF-8 codec. Pure ES2019, no DOM/Node APIs.
 */

const K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

const INITIAL_HASH = [
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
];

const BLOCK_BYTES = 64;

function rotr(x: number, n: number): number {
  return (x >>> n) | (x << (32 - n));
}

/** UTF-8 encode. Lone surrogates become U+FFFD, like TextEncoder. */
export function utf8Encode(text: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < text.length; i++) {
    let c = text.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = i + 1 < text.length ? text.charCodeAt(i + 1) : 0;
      if (next >= 0xdc00 && next <= 0xdfff) {
        c = 0x10000 + ((c - 0xd800) << 10) + (next - 0xdc00);
        i++;
      } else {
        c = 0xfffd;
      }
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      c = 0xfffd;
    }
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 0x3f), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
  }
  return out;
}

/** Strict UTF-8 decode; null when the bytes are not valid UTF-8. */
export function utf8Decode(bytes: ArrayLike<number>): string | null {
  let out = '';
  let i = 0;
  while (i < bytes.length) {
    const b0 = bytes[i];
    let cp: number;
    let extra: number;
    if (b0 < 0x80) {
      cp = b0;
      extra = 0;
    } else if (b0 >= 0xc2 && b0 <= 0xdf) {
      cp = b0 & 0x1f;
      extra = 1;
    } else if (b0 >= 0xe0 && b0 <= 0xef) {
      cp = b0 & 0x0f;
      extra = 2;
    } else if (b0 >= 0xf0 && b0 <= 0xf4) {
      cp = b0 & 0x07;
      extra = 3;
    } else {
      return null;
    }
    if (i + extra >= bytes.length) return null;
    for (let k = 1; k <= extra; k++) {
      const b = bytes[i + k];
      if ((b & 0xc0) !== 0x80) return null;
      cp = (cp << 6) | (b & 0x3f);
    }
    // Reject overlong encodings, surrogates and out-of-range code points.
    if ((extra === 2 && cp < 0x800) || (extra === 3 && (cp < 0x10000 || cp > 0x10ffff))) return null;
    if (cp >= 0xd800 && cp <= 0xdfff) return null;
    out += String.fromCodePoint(cp);
    i += extra + 1;
  }
  return out;
}

/** SHA-256 of raw bytes; returns 32 bytes. */
export function sha256(bytes: ArrayLike<number>): number[] {
  const length = bytes.length;
  const paddedLength = Math.ceil((length + 9) / BLOCK_BYTES) * BLOCK_BYTES;
  const m = new Uint8Array(paddedLength);
  for (let i = 0; i < length; i++) m[i] = bytes[i] & 0xff;
  m[length] = 0x80;
  // Message length in bits as a 64-bit big-endian integer.
  const bitsHigh = Math.floor(length / 0x20000000);
  const bitsLow = (length * 8) >>> 0;
  for (let i = 0; i < 4; i++) {
    m[paddedLength - 8 + i] = (bitsHigh >>> (24 - 8 * i)) & 0xff;
    m[paddedLength - 4 + i] = (bitsLow >>> (24 - 8 * i)) & 0xff;
  }

  const h = INITIAL_HASH.slice();
  const w = new Int32Array(64);
  for (let offset = 0; offset < paddedLength; offset += BLOCK_BYTES) {
    for (let t = 0; t < 16; t++) {
      const j = offset + t * 4;
      w[t] = (m[j] << 24) | (m[j + 1] << 16) | (m[j + 2] << 8) | m[j + 3];
    }
    for (let t = 16; t < 64; t++) {
      const x = w[t - 15];
      const y = w[t - 2];
      const s0 = rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3);
      const s1 = rotr(y, 17) ^ rotr(y, 19) ^ (y >>> 10);
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) | 0;
    }
    let a = h[0];
    let b = h[1];
    let c = h[2];
    let d = h[3];
    let e = h[4];
    let f = h[5];
    let g = h[6];
    let hh = h[7];
    for (let t = 0; t < 64; t++) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + s1 + ch + K[t] + w[t]) | 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (s0 + maj) | 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) | 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) | 0;
    }
    h[0] = (h[0] + a) | 0;
    h[1] = (h[1] + b) | 0;
    h[2] = (h[2] + c) | 0;
    h[3] = (h[3] + d) | 0;
    h[4] = (h[4] + e) | 0;
    h[5] = (h[5] + f) | 0;
    h[6] = (h[6] + g) | 0;
    h[7] = (h[7] + hh) | 0;
  }

  const out: number[] = [];
  for (const word of h) out.push((word >>> 24) & 0xff, (word >>> 16) & 0xff, (word >>> 8) & 0xff, word & 0xff);
  return out;
}

/** HMAC-SHA256 (RFC 2104) of raw bytes; returns 32 bytes. */
export function hmacSha256(key: ArrayLike<number>, message: ArrayLike<number>): number[] {
  let k: number[] = key.length > BLOCK_BYTES ? sha256(key) : Array.prototype.slice.call(key);
  while (k.length < BLOCK_BYTES) k.push(0);
  k = k.slice(0, BLOCK_BYTES);
  const inner: number[] = k.map((b) => b ^ 0x36);
  const outer: number[] = k.map((b) => b ^ 0x5c);
  for (let i = 0; i < message.length; i++) inner.push(message[i] & 0xff);
  return sha256(outer.concat(sha256(inner)));
}

export function toHex(bytes: ArrayLike<number>): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += (bytes[i] & 0xff).toString(16).padStart(2, '0');
  return out;
}

/** Lower-case hex SHA-256 of a UTF-8 string. */
export function sha256Hex(message: string): string {
  return toHex(sha256(utf8Encode(message)));
}

/** Lower-case hex HMAC-SHA256 with UTF-8 key and message (matches Utilities.computeHmacSha256Signature). */
export function hmacSha256Hex(key: string, message: string): string {
  return toHex(hmacSha256(utf8Encode(key), utf8Encode(message)));
}
