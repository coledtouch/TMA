/**
 * Reads the (untrusted) email from a session token so the app can find its
 * cached bootstrap before the first network call. The server re-checks the
 * token on every request; nothing here is used for authorization.
 *
 * Token format (ARCHITECTURE.md §4): base64url(JSON{e, v, x}) + "." + hmacHex.
 */
import { getItem, removeItem, setItem, STORAGE_KEYS } from './storage';

function decodeBase64Url(input: string): string | null {
  try {
    let b64 = input.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    const bin = atob(b64);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

export function emailFromToken(token: string | null | undefined): string | null {
  if (!token) return null;
  const payload = token.split('.')[0];
  const json = payload ? decodeBase64Url(payload) : null;
  if (!json) return null;
  try {
    const parsed: unknown = JSON.parse(json);
    const e = (parsed as { e?: unknown } | null)?.e;
    return typeof e === 'string' && e.includes('@') ? e.trim().toLowerCase() : null;
  } catch {
    return null;
  }
}

/** Best guess at who is signed in on this device: token payload, else the last email used to sign in. */
export function sessionEmail(token: string | null): string | null {
  if (!token) return null;
  return emailFromToken(token) ?? getItem(STORAGE_KEYS.email);
}

export function rememberEmail(email: string | null): void {
  if (email) setItem(STORAGE_KEYS.email, email);
  else removeItem(STORAGE_KEYS.email);
}
