/**
 * Per-call context: the services, a memoized view of the sheet, a fixed "now"
 * and a buffered Log writer. One Ctx per handle()/tick call.
 */
import type { IsoDate } from '../shared/types';
import { Model } from './data';
import { Db } from './db';
import { ApiError } from './errors';
import type { RowData, Services } from './services';
import { nyDate, truncate } from './util';

export interface Ctx {
  readonly s: Services;
  readonly db: Db;
  readonly m: Model;
  /** Fixed for the whole call. */
  readonly now: Date;
  /** Calendar date of `now` in America/New_York. */
  readonly today: IsoDate;
  /** Queue a Log row; written by flushLog() (inside the write lock). */
  log(kind: string, detail: string): void;
  flushLog(): void;
}

const MAX_LOG_DETAIL = 500;

export function createCtx(services: Services): Ctx {
  const db = new Db(services.store);
  const now = services.clock.now();
  const pending: RowData[] = [];
  return {
    s: services,
    db,
    m: new Model(services, db),
    now,
    today: nyDate(now),
    log(kind, detail) {
      pending.push({ At: now, Kind: kind, Detail: truncate(detail, MAX_LOG_DETAIL) });
    },
    flushLog() {
      if (pending.length === 0) return;
      const rows = pending.splice(0, pending.length);
      try {
        db.append('Log', rows);
      } catch (err) {
        services.logger.error('Could not write Log rows', err);
      }
    },
  };
}

/**
 * Run `fn` holding the script-wide write lock, on fresh data (anything read
 * before the lock may be stale), and write queued Log rows before releasing.
 * Never nest: Ctx-level code that already holds the lock calls helpers directly.
 */
export function inWriteLock<T>(ctx: Ctx, fn: () => T): T {
  return ctx.s.withLock(() => {
    ctx.db.reset();
    try {
      return fn();
    } finally {
      ctx.flushLog();
    }
  });
}

/** Fixed-window limiter in the cache: at most `limit` calls per `windowSeconds` for `key`. */
export function rateLimit(ctx: Ctx, key: string, limit: number, windowSeconds: number, message: string): void {
  const nowMs = ctx.now.getTime();
  let count = 0;
  let resetAt = nowMs + windowSeconds * 1000;
  const raw = ctx.s.cache.get(key);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as { n?: unknown; r?: unknown };
      if (typeof parsed.n === 'number' && typeof parsed.r === 'number' && parsed.r > nowMs) {
        count = parsed.n;
        resetAt = parsed.r;
      }
    } catch {
      // Corrupt entry: start a new window.
    }
  }
  if (count >= limit) throw new ApiError('RATE_LIMITED', message);
  const ttl = Math.max(1, Math.ceil((resetAt - nowMs) / 1000));
  ctx.s.cache.put(key, JSON.stringify({ n: count + 1, r: resetAt }), ttl);
}
