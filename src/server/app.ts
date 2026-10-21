/**
 * The backend core's entry point (ARCHITECTURE.md §5): createApp(services)
 * returns the App used by Apps Script (src/gas) and the browser demo (src/demo).
 */
import type { ApiAction, ApiRequest, ApiResponse, SetupReport, TickReport } from '../shared/types';
import { isAdmin } from './access';
import { adminOverview, announce, reviewHousehold } from './admin';
import { authenticate, requestCode, verifyCode } from './auth';
import { buildBootstrap } from './bootstrap';
import { createCtx, inWriteLock, type Ctx } from './context';
import { ApiError, badRequest, fail, forbidden } from './errors';
import { saveHousehold } from './household';
import { addCounts, flushDeliveries } from './notify';
import { registerDevice, savePrefs, testPush, unregisterDevice } from './me';
import { captureOrder, createOrder } from './payments';
import { cancelRedemption, decideRedemption, requestRedemption } from './redemptions';
import type { App, Services, SetupOptions } from './services';
import { runSetup } from './setup';
import { emptyReport, runDaily, runSync } from './sync';
import { errorMessage, hasOwn, isRecord } from './util';
import type { Params } from './validate';

type PublicAction = 'auth.requestCode' | 'auth.verifyCode';
type PrivateAction = Exclude<ApiAction, PublicAction>;

interface Route {
  /** Requires an email listed in Settings.ADMIN_EMAILS. */
  admin?: boolean;
  /** Writes to the sheet: runs under the script lock on fresh data. */
  write?: boolean;
  /** Returns a TickReport: add what was delivered after the lock to its counts. */
  tick?: boolean;
  run(ctx: Ctx, email: string, params: Params): unknown;
}

const PUBLIC_ROUTES: Record<PublicAction, (ctx: Ctx, params: Params) => unknown> = {
  'auth.requestCode': requestCode,
  'auth.verifyCode': verifyCode,
};

const ROUTES: Record<PrivateAction, Route> = {
  'me.bootstrap': { run: (ctx, email) => buildBootstrap(ctx, email) },
  'household.save': { write: true, run: saveHousehold },
  'prefs.save': { write: true, run: savePrefs },
  'push.register': { write: true, run: registerDevice },
  'push.unregister': { write: true, run: unregisterDevice },
  'push.test': { write: true, run: (ctx, email) => testPush(ctx, email) },
  'redemption.request': { write: true, run: requestRedemption },
  'redemption.cancel': { write: true, run: cancelRedemption },
  'payment.createOrder': { run: createOrder },
  'payment.captureOrder': { write: true, run: captureOrder },
  'admin.overview': { admin: true, run: (ctx) => adminOverview(ctx) },
  'admin.decideRedemption': { admin: true, write: true, run: decideRedemption },
  'admin.reviewHousehold': { admin: true, write: true, run: reviewHousehold },
  'admin.announce': { admin: true, write: true, run: announce },
  'admin.runSync': { admin: true, write: true, tick: true, run: (ctx) => runSync(ctx) },
  // Placeholder until src/server/reports.ts lands.
  'admin.report': { admin: true, run: () => fail('NOT_CONFIGURED', 'Reports are not available yet.') },
};

const GENERIC_ERROR = 'Something went wrong. Please try again.';

function dispatch(services: Services, request: unknown): unknown {
  if (!isRecord(request) || typeof request.action !== 'string') badRequest('Invalid request.');
  const req = request as Record<string, unknown>;
  const action = req.action as string;
  const params = req.params === undefined || req.params === null ? {} : req.params;
  if (!isRecord(params)) badRequest('Invalid request parameters.');
  const p = params as Params;

  if (hasOwn(PUBLIC_ROUTES, action)) {
    return PUBLIC_ROUTES[action as PublicAction](createCtx(services), p);
  }
  if (!hasOwn(ROUTES, action)) badRequest('Unknown action.');
  const route = ROUTES[action as PrivateAction];

  const ctx = createCtx(services);
  const email = authenticate(ctx, req.token);
  if (route.admin && !isAdmin(ctx, email)) forbidden('Only TMA board members can do that.');
  if (!route.write) return route.run(ctx, email, p);
  // Sheet writes hold the script lock; notifications go out after it is released (also when the
  // action failed after queuing some, e.g. an admin alert about a payment).
  ctx.deliveries = [];
  let result: unknown;
  try {
    result = inWriteLock(ctx, () => route.run(ctx, email, p));
  } finally {
    const sent = flushDeliveries(ctx);
    if (route.tick && result) addCounts((result as TickReport).notifications, sent);
  }
  return result;
}

export function createApp(services: Services): App {
  return {
    handle(request: ApiRequest): ApiResponse {
      try {
        return { ok: true, data: dispatch(services, request) } as ApiResponse;
      } catch (err) {
        if (err instanceof ApiError) return { ok: false, error: { code: err.code, message: err.message } };
        const action = isRecord(request) && typeof request.action === 'string' ? request.action.slice(0, 64) : '?';
        try {
          services.logger.error(`Unhandled error in ${action}: ${errorMessage(err)}`, err);
        } catch {
          // Logging must never turn into a thrown error.
        }
        return { ok: false, error: { code: 'INTERNAL', message: GENERIC_ERROR } };
      }
    },

    syncTick(): TickReport {
      return tick(services, runSync);
    },

    dailyTick(): TickReport {
      return tick(services, runDaily);
    },

    setup(options?: SetupOptions): SetupReport {
      const ctx = createCtx(services);
      return inWriteLock(ctx, () => runSetup(ctx, options ?? {}));
    },
  };
}

/**
 * A scheduled run: read and write the sheet under the script lock (a few seconds), then send the
 * notifications it queued with the lock released, so families' writes (a PayPal capture, saving
 * settings) never wait behind hundreds of emails and pushes.
 */
function tick(services: Services, run: (ctx: Ctx) => TickReport): TickReport {
  let ctx: Ctx | null = null;
  try {
    ctx = createCtx(services);
    const c = ctx;
    c.deliveries = [];
    let report: TickReport | undefined;
    try {
      report = inWriteLock(c, () => run(c));
    } finally {
      const sent = flushDeliveries(c);
      if (report) addCounts(report.notifications, sent);
    }
    return report;
  } catch (err) {
    services.logger.error('Scheduled run failed', errorMessage(err));
    const report = emptyReport(ctx ? ctx.now : new Date());
    report.errors.push(errorMessage(err));
    return report;
  }
}
