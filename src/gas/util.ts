/** Small helpers shared by the Apps Script adapters. */

/** Signed Java bytes (Apps Script's Byte[]) -> lower-case hex. */
export function bytesToHex(bytes: readonly number[]): string {
  let hex = '';
  for (const b of bytes) hex += ((b & 0xff) + 0x100).toString(16).slice(1);
  return hex;
}

/** base64url without padding (JWT style) of a UTF-8 string or raw bytes. */
export function base64UrlEncode(data: string | readonly number[]): string {
  const bytes = typeof data === 'string' ? Utilities.newBlob(data).getBytes() : [...data];
  return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/, '');
}

/** JSON.parse that returns undefined instead of throwing. */
export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Read a nested property path from untrusted JSON. */
export function pick(value: unknown, ...path: Array<string | number>): unknown {
  let current: unknown = value;
  for (const key of path) {
    if (typeof key === 'number') {
      if (!Array.isArray(current)) return undefined;
      current = current[key];
    } else {
      if (!isRecord(current)) return undefined;
      current = current[key];
    }
  }
  return current;
}

export function pickString(value: unknown, ...path: Array<string | number>): string | undefined {
  const found = pick(value, ...path);
  return typeof found === 'string' ? found : undefined;
}

/** Trim to at most `max` characters. */
export function clip(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) : text;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** application/x-www-form-urlencoded body. */
export function formEncode(fields: Record<string, string>): string {
  return Object.keys(fields)
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(fields[k])}`)
    .join('&');
}

/** Error -> loggable object (message + stack), anything else as-is. */
export function describeError(error: unknown): unknown {
  if (error instanceof Error) return { message: error.message, stack: error.stack };
  return error;
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
