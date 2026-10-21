// Byte helpers: base64url (RFC 4648 §5), UTF-8, hex and concatenation.
import type { Bytes } from './env';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

const LOOKUP = (() => {
  const table = new Int16Array(128).fill(-1);
  for (let i = 0; i < ALPHABET.length; i++) table[ALPHABET.charCodeAt(i)] = i;
  // Standard base64 maps onto the same values.
  table['+'.charCodeAt(0)] = 62;
  table['/'.charCodeAt(0)] = 63;
  return table;
})();

/** Encodes bytes as base64url without padding. */
export function b64urlEncode(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!;
    out += ALPHABET[(n >> 18) & 63]! + ALPHABET[(n >> 12) & 63]! + ALPHABET[(n >> 6) & 63]! + ALPHABET[n & 63]!;
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = bytes[i]! << 16;
    out += ALPHABET[(n >> 18) & 63]! + ALPHABET[(n >> 12) & 63]!;
  } else if (rest === 2) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8);
    out += ALPHABET[(n >> 18) & 63]! + ALPHABET[(n >> 12) & 63]! + ALPHABET[(n >> 6) & 63]!;
  }
  return out;
}

/**
 * Decodes base64url. Also accepts standard base64 ("+", "/") and trailing
 * "=" padding, since browsers and libraries disagree on which they emit.
 * Returns null for anything else (bad characters, impossible length).
 */
export function b64urlDecode(input: string): Bytes | null {
  const s = input.replace(/=+$/, '');
  if (s.length % 4 === 1) return null;
  const out = new Uint8Array(Math.floor((s.length * 3) / 4));
  let buffer = 0;
  let bits = 0;
  let o = 0;
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    const v = code < 128 ? LOOKUP[code]! : -1;
    if (v < 0) return null;
    buffer = ((buffer << 6) | v) & 0xffffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (buffer >> bits) & 0xff;
    }
  }
  return out;
}

/** base64url of a UTF-8 string (used for JWT segments). */
export function b64urlEncodeText(text: string): string {
  return b64urlEncode(utf8(text));
}

const encoder = new TextEncoder();

/** UTF-8 bytes of a string. */
export function utf8(text: string): Bytes {
  return encoder.encode(text) as Bytes;
}

/** Concatenates byte arrays. */
export function concat(...parts: Uint8Array[]): Bytes {
  let length = 0;
  for (const p of parts) length += p.length;
  const out = new Uint8Array(length);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

/** Lowercase hex of bytes. */
export function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

/** Compares two strings without an early exit on the first difference. */
export function constantTimeEqual(a: string, b: string): boolean {
  // The length of a SHA-256 hex digest is public, so leaking it is fine.
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Lowercase hex SHA-256 of a UTF-8 string. */
export async function sha256Hex(text: string): Promise<string> {
  return toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', utf8(text))));
}
