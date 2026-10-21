/**
 * Defensive parameter parsing for API calls. Every helper either returns a
 * clean value or throws BAD_REQUEST with a message a parent can act on.
 */
import { badRequest } from './errors';
import { cleanText, isEmail, isRecord, MAX_AMOUNT_CENTS, normEmail, safeUrl } from './util';

export type Params = Record<string, unknown>;

export const LIMITS = {
  name: 80,
  studentName: 40,
  note: 500,
  title: 120,
  body: 2000,
  id: 64,
  url: 500,
  instrument: 40,
  userAgent: 300,
  token: 4096,
} as const;

export function obj(value: unknown, label: string): Params {
  if (!isRecord(value)) badRequest(`${label} is missing or invalid.`);
  return value as Params;
}

export function list(value: unknown, label: string, max: number, min = 0): unknown[] {
  if (value === undefined || value === null) {
    if (min > 0) badRequest(`${label} is required.`);
    return [];
  }
  if (!Array.isArray(value)) return badRequest(`${label} must be a list.`);
  if (value.length < min) badRequest(`Add at least ${min} ${label.toLowerCase()}.`);
  if (value.length > max) badRequest(`${label}: at most ${max} allowed.`);
  return value;
}

/** Required single-line (or multiline) text, cleaned, within [min, max] characters. */
export function text(value: unknown, label: string, max: number, opts: { min?: number; multiline?: boolean } = {}): string {
  const min = opts.min ?? 1;
  if (value !== undefined && value !== null && typeof value !== 'string') badRequest(`${label} must be text.`);
  const s = typeof value === 'string' ? cleanText(value, opts.multiline) : '';
  if (s.length < min) badRequest(min <= 1 ? `${label} is required.` : `${label} must be at least ${min} characters.`);
  if (s.length > max) badRequest(`${label} must be at most ${max} characters.`);
  return s;
}

/** Optional text: '' when absent or blank. */
export function optText(value: unknown, label: string, max: number, multiline = false): string {
  if (value === undefined || value === null) return '';
  return text(value, label, max, { min: 0, multiline });
}

export function email(value: unknown, label = 'Email'): string {
  if (typeof value !== 'string') return badRequest(`${label} is required.`);
  const e = normEmail(value);
  if (!isEmail(e)) badRequest(`${label} doesn't look like an email address.`);
  return e;
}

/** An ID previously returned by the API (student, activity, request, family). */
export function id(value: unknown, label: string): string {
  if (typeof value !== 'string' && typeof value !== 'number') return badRequest(`${label} is required.`);
  const s = cleanText(String(value));
  if (!s) badRequest(`${label} is required.`);
  if (s.length > LIMITS.id) badRequest(`${label} is too long.`);
  return s;
}

/** Integer cents between min and $100,000. */
export function cents(value: unknown, label: string, min: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return badRequest(`${label} must be a number of cents.`);
  if (!Number.isInteger(value)) badRequest(`${label} must be whole cents.`);
  if (value > MAX_AMOUNT_CENTS) badRequest(`${label} is too large.`);
  if (value < min) badRequest(`${label} is too small.`);
  return value;
}

export function bool(value: unknown, label: string, fallback?: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if ((value === undefined || value === null) && fallback !== undefined) return fallback;
  return badRequest(`${label} must be true or false.`);
}

export function optUrl(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) return undefined;
  const url = safeUrl(value, LIMITS.url);
  if (!url) badRequest(`${label} must be a web address starting with https://`);
  return url;
}

export function oneOf<T extends string>(value: unknown, label: string, allowed: readonly T[]): T {
  if (typeof value === 'string' && (allowed as readonly string[]).includes(value)) return value as T;
  return badRequest(`${label} must be one of: ${allowed.join(', ')}.`);
}
