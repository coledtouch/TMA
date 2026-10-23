/**
 * Who is using the app (ARCHITECTURE.md §4 "Sign-ins"): the Sign-ins tab has one row per email
 * with when it first and last signed in, when it last opened the app, and how many times it
 * signed in. Nothing else: no device, browser, address or code.
 *
 * Both writes are best effort. They wait a short time for the script lock (SIGN_IN_LOCK_WAIT_MS,
 * OPENED_LOCK_WAIT_MS) and are skipped, with a console log only, when it is busy or the write fails,
 * so signing in and opening the app never fail or wait on them for long. A skipped sign-in is kept in
 * the cache for PENDING_SIGN_IN_SECONDS, and the next write for that email adds it. Opening the app is
 * noted at most once every OPENED_EVERY_SECONDS per email (CacheService), so most page loads don't
 * touch the sheet at all.
 */
import { TABLES } from '../shared/schema';
import type { IsoDateTime } from '../shared/types';
import { inWriteLock, type Ctx } from './context';
import { latest, type SignInRec } from './data';
import type { RowData } from './services';
import { errorMessage, isRecord } from './util';

/** Longest wait for the script lock before a sign-in is skipped (about once per 120 days per person). */
export const SIGN_IN_LOCK_WAIT_MS = 5000;
/** Longest wait for the script lock before an opening is skipped. */
export const OPENED_LOCK_WAIT_MS = 1500;
/** Opening the app is noted at most this often per email: 6 hours (CacheService's longest). */
export const OPENED_EVERY_SECONDS = 6 * 3600;
/** After a skipped write, the next opening tries again after this long, not on every page load. */
export const OPENED_RETRY_SECONDS = 600;
/** A skipped sign-in is kept this long for the next write to add: 6 hours (CacheService's longest). */
export const PENDING_SIGN_IN_SECONDS = 6 * 3600;

const COLUMNS = TABLES['Sign-ins'].headers;

type Activity = 'sign-in' | 'open';

/** Cache key that holds back the next "opened the app" write for this email. */
export function openedKey(email: string): string {
  return `opened:${email}`;
}

/** Cache key that keeps sign-ins not written yet for this email (a busy lock or a failed write). */
export function pendingSignInKey(email: string): string {
  return `signin-pending:${email}`;
}

/** Sign-ins not written yet: how many, and the first and last time. */
interface Pending {
  count: number;
  first: IsoDateTime;
  last: IsoDateTime;
}

/** auth.verifyCode succeeded: note the sign-in (and the opening that comes with it). Never throws. */
export function recordSignIn(ctx: Ctx, email: string): void {
  note(ctx, email, 'sign-in');
}

/** me.bootstrap for a signed-in person: note that they opened the app, at most every 6 hours. Never throws. */
export function noteAppOpened(ctx: Ctx, email: string): void {
  try {
    if (ctx.s.cache.get(openedKey(email))) return;
  } catch (err) {
    ctx.s.logger.error('Could not read the cache; app opening not noted', errorMessage(err));
    return;
  }
  note(ctx, email, 'open');
}

function note(ctx: Ctx, email: string, activity: Activity): void {
  let written = false;
  try {
    // The household now (blank if none yet), looked up before the lock so the lock is held only
    // for reading and writing the Sign-ins tab.
    const family = ctx.m.familyForEmail(email);
    const familyId = family ? family.id : '';
    inWriteLock(
      ctx,
      () => {
        // Read under the lock, so two writes at once can't both add the same skipped sign-in.
        const pending = readPending(ctx, email);
        upsert(ctx, email, familyId, activity, pending);
        if (pending) forgetPending(ctx, email);
      },
      { waitMs: activity === 'sign-in' ? SIGN_IN_LOCK_WAIT_MS : OPENED_LOCK_WAIT_MS },
    );
    written = true;
  } catch (err) {
    const what = activity === 'sign-in' ? 'the sign-in' : 'that the app was opened';
    ctx.s.logger.error(`Could not note ${what} (Sign-ins tab); skipped`, errorMessage(err));
    if (activity === 'sign-in') keepPending(ctx, email);
  }
  try {
    ctx.s.cache.put(openedKey(email), '1', written ? OPENED_EVERY_SECONDS : OPENED_RETRY_SECONDS);
  } catch (err) {
    ctx.s.logger.error('Could not write the cache', errorMessage(err));
  }
}

/**
 * Under the lock, on a fresh read of the tab: update this email's row, or add one. Rows repeating
 * the email are merged into the one kept (SignInRec) and the others blanked, so a duplicate the
 * treasurer pasted is repaired by the next write.
 */
function upsert(ctx: Ctx, email: string, familyId: string, activity: Activity, pending: Pending | null): void {
  const rec = ctx.m.signIns().get(email);
  const now = ctx.now;
  const signedIn = activity === 'sign-in';
  // This sign-in, plus any earlier ones that were skipped (kept in the cache).
  const added = (signedIn ? 1 : 0) + (pending ? pending.count : 0);
  const first = pending ? pending.first : signedIn ? now.toISOString() : undefined;
  const last = signedIn ? now.toISOString() : pending?.last;
  if (!rec) {
    ctx.db.append('Sign-ins', [
      {
        Email: email,
        FamilyID: familyId,
        'First Signed In': when(first),
        'Last Signed In': when(last),
        'Last Opened App': now,
        'Sign-ins': added,
      },
    ]);
    return;
  }
  const duplicates = rec.rows.filter((r) => r !== rec.row);
  // The cache forgot (CacheService may drop entries early) but the sheet already has it.
  if (added === 0 && duplicates.length === 0 && rec.familyId === familyId && recentlyOpened(ctx, rec)) return;

  const patch: RowData = { FamilyID: familyId, 'Last Opened App': now };
  if (added > 0) {
    // A skipped sign-in added later never moves Last Signed In back past one written since.
    patch['Last Signed In'] = signedIn ? now : when(latest(rec.lastSignedIn, last));
    patch['Sign-ins'] = rec.count + added;
    if (!rec.firstSignedIn) patch['First Signed In'] = when(first);
  }
  if (duplicates.length > 0) {
    // Write the merged values, so nothing from the blanked rows is lost.
    patch.Email = email;
    if (patch['First Signed In'] === undefined) patch['First Signed In'] = when(rec.firstSignedIn);
    if (patch['Last Signed In'] === undefined) patch['Last Signed In'] = when(rec.lastSignedIn);
    if (patch['Sign-ins'] === undefined) patch['Sign-ins'] = rec.count;
  }
  ctx.db.update('Sign-ins', rec.row, patch);
  for (const row of duplicates) ctx.db.clear('Sign-ins', row, COLUMNS);
}

function recentlyOpened(ctx: Ctx, rec: SignInRec): boolean {
  const t = rec.lastOpened ? Date.parse(rec.lastOpened) : NaN;
  const age = ctx.now.getTime() - t;
  return age >= 0 && age < OPENED_EVERY_SECONDS * 1000;
}

function when(iso: string | undefined): Date | '' {
  return iso ? new Date(iso) : '';
}

/** The sign-ins kept for this email, or null (none, unreadable, or the cache failed). Never throws. */
function readPending(ctx: Ctx, email: string): Pending | null {
  try {
    const raw = ctx.s.cache.get(pendingSignInKey(email));
    if (!raw) return null;
    const p: unknown = JSON.parse(raw);
    if (
      isRecord(p) &&
      typeof p.count === 'number' &&
      Number.isInteger(p.count) &&
      p.count > 0 &&
      typeof p.first === 'string' &&
      typeof p.last === 'string' &&
      !Number.isNaN(Date.parse(p.first)) &&
      !Number.isNaN(Date.parse(p.last))
    ) {
      return { count: p.count, first: p.first, last: p.last };
    }
  } catch (err) {
    ctx.s.logger.error('Could not read a skipped sign-in from the cache', errorMessage(err));
  }
  return null;
}

/** The sign-in just skipped: keep it (with any kept before) for the next write. Never throws. */
function keepPending(ctx: Ctx, email: string): void {
  const before = readPending(ctx, email);
  const now = ctx.now.toISOString();
  const kept: Pending = { count: (before ? before.count : 0) + 1, first: before ? before.first : now, last: now };
  try {
    ctx.s.cache.put(pendingSignInKey(email), JSON.stringify(kept), PENDING_SIGN_IN_SECONDS);
  } catch (err) {
    ctx.s.logger.error('Could not keep the skipped sign-in in the cache', errorMessage(err));
  }
}

/** The kept sign-ins are in the sheet now. Never throws. */
function forgetPending(ctx: Ctx, email: string): void {
  try {
    ctx.s.cache.remove(pendingSignInKey(email));
  } catch (err) {
    ctx.s.logger.error('Could not clear a skipped sign-in from the cache', errorMessage(err));
  }
}
