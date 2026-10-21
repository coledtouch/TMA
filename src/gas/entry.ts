/**
 * Apps Script entry points. scripts/build-gas.mjs bundles this file into
 * apps-script/Code.js as the global `TMA` and appends top-level wrappers
 * (`function doPost(e) { return TMA.doPost(e); }` …) that Apps Script can see.
 *
 * Nothing here runs at load time: onOpen is a simple trigger with limited
 * authorization, so module scope must not touch any Apps Script service.
 */
import { createApp } from '../server/app';
import { canonicalP256Key } from '../server/push-subscription';
import type { App } from '../server/services';
import { generateSecret } from '../server/setup';
import { SETTING_DEFAULTS, type SecretName } from '../shared/schema';
import type { ApiAction, ApiRequest, ApiResponse, SetupReport, TickReport } from '../shared/types';
import { describeWorkerReason, pauseSeconds, replyToAddress, WORKER_EMAIL_FROM } from './mail';
import { paypalEnv } from './paypal';
import type { RelayHealth } from './push-relay';
import { sendSelfTest, type SelfTestReport } from './self-test';
import { createGasServices, type GasServices } from './services';
import { describeError, escapeHtml, isRecord } from './util';

declare const __APP_VERSION__: string | undefined;

/** Injected by the build (package.json version). */
export const VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';

const MENU_TITLE = 'TMA App';
const MAX_BODY_CHARS = 100000;
const MAX_TOKEN_CHARS = 4096;
const SCHEDULED_HANDLERS = ['syncTick', 'dailyTick'];
const SECRET_NAMES: readonly SecretName[] = [
  'TOKEN_SECRET',
  'PAYPAL_SECRET',
  'PUSH_RELAY_SECRET',
  'TWILIO_ACCOUNT_SID',
  'TWILIO_AUTH_TOKEN',
  'TWILIO_FROM',
];

type TextOutput = GoogleAppsScript.Content.TextOutput;
type HtmlOutput = GoogleAppsScript.HTML.HtmlOutput;

function boot(): { services: GasServices; app: App } {
  const services = createGasServices();
  return { services, app: createApp(services) };
}

// ---------------------------------------------------------------------------
// Web app
// ---------------------------------------------------------------------------

/** Validate the transport envelope; the core validates action and params. */
export function parseApiRequest(raw: unknown): { request: ApiRequest } | { error: string } {
  if (typeof raw !== 'string' || raw.trim() === '') return { error: 'Missing request body' };
  if (raw.length > MAX_BODY_CHARS) return { error: 'Request too large' };
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return { error: 'Request body must be JSON' };
  }
  if (!isRecord(body) || typeof body.action !== 'string' || body.action.length > 64) {
    return { error: 'Missing action' };
  }
  const params = body.params ?? {};
  if (!isRecord(params)) return { error: 'params must be an object' };
  const token = body.token ?? null;
  if (token !== null && (typeof token !== 'string' || token.length > MAX_TOKEN_CHARS)) {
    return { error: 'Invalid token' };
  }
  return { request: { action: body.action as ApiAction, params: params as ApiRequest['params'], token } };
}

function json(value: unknown): TextOutput {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}

/** API: POST text/plain JSON ApiRequest -> JSON ApiResponse. Never throws. */
export function doPost(e?: GoogleAppsScript.Events.DoPost): TextOutput {
  const parsed = parseApiRequest(e?.postData?.contents);
  let response: ApiResponse;
  if ('error' in parsed) {
    response = { ok: false, error: { code: 'BAD_REQUEST', message: parsed.error } };
  } else {
    try {
      response = boot().app.handle(parsed.request);
    } catch (error) {
      console.error('doPost failed', describeError(error));
      response = { ok: false, error: { code: 'INTERNAL', message: 'Something went wrong. Please try again.' } };
    }
  }
  return json(response);
}

/** `?action=health` for monitoring; otherwise a small page pointing people to the app. */
export function doGet(e?: GoogleAppsScript.Events.DoGet): TextOutput | HtmlOutput {
  if (e?.parameter?.action === 'health') {
    return json({ ok: true, data: { version: VERSION, time: new Date().toISOString() } });
  }
  let orgName: string = SETTING_DEFAULTS.ORG_NAME;
  let appUrl = '';
  try {
    const services = createGasServices();
    orgName = services.setting('ORG_NAME');
    appUrl = services.setting('APP_URL');
  } catch (error) {
    console.error('doGet could not read Settings', describeError(error));
  }
  return HtmlService.createHtmlOutput(landingPage(orgName, appUrl))
    .setTitle(orgName)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

export function landingPage(orgName: string, appUrl: string): string {
  const name = escapeHtml(orgName);
  const link = /^https?:\/\/[^\s"'<>]+$/i.test(appUrl)
    ? `<p><a href="${escapeHtml(appUrl)}" target="_top" style="display:inline-block;background:#5a0f13;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none">Open the TMA app</a></p>`
    : '<p>Ask TMA for the app link.</p>';
  return [
    '<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;margin:40px auto;padding:0 16px;color:#141010">',
    `<h1 style="font-family:Georgia,'Times New Roman',serif;color:#5a0f13;font-size:24px">${name}</h1>`,
    '<p>This address is the TMA app\'s server. Families use the app instead:</p>',
    link,
    '</div>',
  ].join('');
}

// ---------------------------------------------------------------------------
// Sheet menu + scheduled work
// ---------------------------------------------------------------------------

/** Simple trigger: adds the TMA App menu to the sheet. */
export function onOpen(): void {
  SpreadsheetApp.getUi()
    .createMenu(MENU_TITLE)
    .addItem('Run sync now', 'syncTick')
    .addItem('Send me a test notification', 'sendTestPushToMe')
    .addItem('Set up / repair tabs', 'setupTma')
    .addItem('Install schedules', 'installTriggers')
    .addItem('Status', 'showTmaStatus')
    .addToUi();
}

/** Every 15 minutes (time trigger), or "Run sync now" from the menu (no event object). */
export function syncTick(e?: GoogleAppsScript.Events.TimeDriven): TickReport {
  const { services, app } = boot();
  const report = app.syncTick();
  if (report.errors.length > 0) services.logger.error('syncTick finished with errors', report.errors);
  if (!e) toast(`Sync finished. ${summarizeTick(report)}`);
  return report;
}

/** Once a day around 8 AM: payment and event reminders. */
export function dailyTick(e?: GoogleAppsScript.Events.TimeDriven): TickReport {
  const { services, app } = boot();
  const report = app.dailyTick();
  if (report.errors.length > 0) services.logger.error('dailyTick finished with errors', report.errors);
  if (!e) toast(`Daily reminders finished. ${summarizeTick(report)}`);
  return report;
}

export function setupTma(): SetupReport {
  return runSetup(false);
}

/** Like setupTma, and fills empty tabs with the fictional demo households. */
export function setupTmaWithSampleData(): SetupReport {
  return runSetup(true);
}

function runSetup(seedSampleData: boolean): SetupReport {
  const { services, app } = boot();
  const report = services.withLock(() => {
    const result = app.setup({ seedSampleData });
    if (services.secrets.get('PUSH_RELAY_SECRET')) return result;
    services.secrets.set('PUSH_RELAY_SECRET', generateSecret(services.crypto, 'PUSH_RELAY_SECRET'));
    return { ...result, secretsInitialized: [...result.secretsInitialized, 'PUSH_RELAY_SECRET'] };
  });
  // Network calls run outside the lock.
  const push = linkPushWorker(services);
  services.logger.info('setup', { ...report, push });
  const lines = [
    report.createdTables.length ? `Created tabs: ${report.createdTables.join(', ')}` : 'All tabs were already there.',
    report.addedColumns.length
      ? `Added columns: ${report.addedColumns.map((c) => `${c.table} › ${c.column}`).join(', ')}`
      : 'No columns were missing.',
    report.seeded ? 'Filled the empty tabs with sample (fictional) data.' : '',
    report.secretsInitialized.length ? `Created secrets: ${report.secretsInitialized.join(', ')}` : '',
    ...push,
  ].filter(Boolean);
  const next = 'Next: Deploy → New deployment → Web app, then TMA App → Install schedules.';
  alert('TMA App set up', `${lines.join('\n')}\n\n${next}`);
  return report;
}

/**
 * Link this sheet to the push Worker (POST /register with PUSH_RELAY_SECRET,
 * trust on first use) and save the Worker's public key, which browsers
 * subscribe with. Never throws: an unreachable Worker only means no push
 * notifications until Set up runs again. Returns lines for the setup dialog.
 */
export function linkPushWorker(services: GasServices): string[] {
  const push = services.push;
  const base = push.baseUrl();
  if (!base) return ['⚠ Push notifications are off: Settings PUSH_RELAY_URL is not an https:// address.'];
  const lines: string[] = [];
  try {
    const { first } = push.register();
    lines.push(first ? `Push: linked this sheet to the push Worker (${base}).` : `Push: this sheet is linked to the push Worker (${base}).`);
  } catch (error) {
    return [`⚠ Push: ${errorMessage(error)} Phones won't get notifications until Set up links the push Worker; run it again later.`];
  }
  try {
    push.refreshPublicKey();
    lines.push("Push: saved the Worker's public key (Script Property PUSH_PUBLIC_KEY).");
  } catch (error) {
    lines.push(`⚠ Push: could not get the Worker's public key. ${errorMessage(error)} Run Set up again later.`);
  }
  return lines;
}

/** Replace this project's syncTick/dailyTick triggers with fresh ones. */
export function installTriggers(): { removed: number; created: number } {
  let removed = 0;
  for (const trigger of ScriptApp.getProjectTriggers()) {
    if (SCHEDULED_HANDLERS.includes(trigger.getHandlerFunction())) {
      ScriptApp.deleteTrigger(trigger);
      removed += 1;
    }
  }
  ScriptApp.newTrigger('syncTick').timeBased().everyMinutes(15).create();
  ScriptApp.newTrigger('dailyTick').timeBased().everyDays(1).atHour(8).create();
  alert('Schedules installed', 'Sync runs every 15 minutes and reminders go out daily around 8 AM.');
  return { removed, created: SCHEDULED_HANDLERS.length };
}

/** Menu: push + email test to the signed-in Google user's own devices. */
export function sendTestPushToMe(): SelfTestReport {
  const report = sendSelfTest(createGasServices(), activeUserEmail());
  const lines = report.email ? [`Sent to ${report.email}:`] : [];
  if (report.devices > 0) {
    lines.push(`Push: delivered to ${report.push} of ${report.devices} device(s).`);
    if (report.removed > 0) lines.push(`Removed ${report.removed} expired device(s).`);
  }
  lines.push(`Email: ${testEmailLine(report)}`, ...report.notes);
  alert('Test notification', lines.join('\n'));
  return report;
}

/** Which way the test email went: through the push Worker as noreply@mytma.org, or with Gmail (and why). */
function testEmailLine(report: SelfTestReport): string {
  if (!report.emailSent) return 'not sent.';
  if (report.emailVia === 'cloudflare') return `sent from ${WORKER_EMAIL_FROM} through the push Worker (Cloudflare Email Sending).`;
  if (!report.emailWorkerReason) return 'sent with Gmail from this Google account (Settings EMAIL_VIA is gmail).';
  const code = report.emailWorkerCode ? `, ${report.emailWorkerCode}` : '';
  return `sent with Gmail from this Google account instead of ${WORKER_EMAIL_FROM}, because ${describeWorkerReason(report.emailWorkerReason)}${code}.`;
}

/** Menu: configuration overview. Lists secret *names* only, never values. */
export function showTmaStatus(): string {
  const services = createGasServices();
  const handlers = safely(() => ScriptApp.getProjectTriggers().map((t) => t.getHandlerFunction()), [] as string[]);
  const present = SECRET_NAMES.filter((name) => services.secrets.get(name) !== null);
  const missing = SECRET_NAMES.filter((name) => !present.includes(name));
  const yes = (on: boolean) => (on ? 'on' : 'off');
  // One GET /health for both push and email.
  const health = services.push.baseUrl() ? services.push.health() : null;

  const lines = [
    // ScriptApp.getService().getUrl() reports the editor's test deployment, not the
    // live one, so point to where the real /exec URL is listed instead.
    'Web app URL: Deploy → Manage deployments → Web app (the URL ending in /exec)',
    `App link (Settings APP_URL): ${services.setting('APP_URL') || 'not set'}`,
    `Schedules: sync every 15 min ${handlers.includes('syncTick') ? '✓' : '✗'}, daily reminders ${handlers.includes('dailyTick') ? '✓' : '✗'}${
      SCHEDULED_HANDLERS.every((h) => handlers.includes(h)) ? '' : ' (TMA App → Install schedules)'
    }`,
    `Secrets set: ${present.join(', ') || 'none'}`,
    `Secrets not set: ${missing.join(', ') || 'none'}`,
    `PayPal: ${services.payments.enabled() ? `configured (${paypalEnv(services.setting('PAYPAL_ENV'))})` : 'not configured'}; online payments ${yes(services.flag('ONLINE_PAYMENTS'))}`,
    ...pushStatus(services, health),
    `Text messages (Twilio): ${services.sms.enabled() ? 'configured' : 'not configured'}; SMS setting ${yes(services.flag('SMS_ENABLED'))}`,
    ...emailStatus(services, health),
    `Version: ${VERSION}`,
  ];
  if (!present.includes('TOKEN_SECRET')) lines.push('', 'TOKEN_SECRET is missing: run TMA App → Set up / repair tabs.');
  const text = lines.join('\n');
  alert('TMA App status', text);
  return text;
}

/** Status lines for the push Worker. Never prints PUSH_RELAY_SECRET. */
function pushStatus(services: GasServices, health: RelayHealth | null): string[] {
  const push = services.push;
  const base = push.baseUrl();
  if (!base || !health) return ['Push Worker: not set (Settings PUSH_RELAY_URL must be an https:// address); push notifications off'];
  const setUp = ' (TMA App → Set up / repair tabs)';
  const healthLine = health.reachable
    ? `Push Worker health: reachable ✓, linked to a sheet ${health.registered ? '✓' : `✗${setUp}`}, keys ${health.hasKeys ? '✓' : `✗${setUp}`}`
    : `Push Worker health: unreachable (${health.httpCode ? `HTTP ${health.httpCode}` : health.error || 'no answer'})`;
  const keySaved = canonicalP256Key(services.secrets.get('PUSH_PUBLIC_KEY')) !== null;
  return [
    `Push Worker: ${base}`,
    healthLine,
    `Push public key (PUSH_PUBLIC_KEY): ${keySaved ? 'saved ✓' : `not saved yet${setUp}`}`,
    `Push notifications: ${push.enabled() ? 'configured' : `not configured${setUp}`}`,
  ];
}

/**
 * The "Email:" status lines: on/off, the route (noreply@mytma.org through the
 * push Worker, and whether the Worker has Email Sending and its email key; or
 * Gmail, and why), the Reply-To address, Gmail's quota left (the fallback),
 * and the email key to paste into Cloudflare (the Worker secret EMAIL_KEY).
 */
function emailStatus(services: GasServices, health: RelayHealth | null): string[] {
  const on = services.flag('EMAIL_ENABLED') ? 'on' : 'notifications off (sign-in codes are still emailed)';
  const route = safely(() => services.mailer.route(), null);
  const quota = safely(() => services.mailer.gmailQuota(), 0);
  const replyTo = `Reply-To ${replyToAddress(services.setting('SUPPORT_EMAIL'))}`;
  // The SHA-256 of PUSH_RELAY_SECRET, not the secret: it can't be turned back into it.
  const key = route && !(route.via === 'gmail' && route.reason === 'setting') ? safely(() => services.push.emailKey(), null) : null;
  const keyLine = key ? [`Email key for Cloudflare (Worker secret EMAIL_KEY): ${key}`] : [];
  if (route?.via === 'cloudflare') {
    let worker = '';
    if (health && !health.reachable) worker = '; Worker unreachable right now, so Gmail sends meanwhile';
    else if (health?.email && health.emailKey) worker = ' (Cloudflare Email Sending ✓, email key ✓)';
    else if (health?.email) worker = ' (Cloudflare Email Sending ✓, email key ✗: add the Worker secret EMAIL_KEY below, so Gmail sends meanwhile; see docs/SETUP.md)';
    else if (health) worker = ' (Cloudflare Email Sending ✗: not set up on the Worker yet, so Gmail sends meanwhile; see docs/SETUP.md)';
    return [`Email: ${on}; from ${route.from} through the push Worker${worker}; ${replyTo}; Gmail fallback: ${quota} emails left today`, ...keyLine];
  }
  let why = 'Settings EMAIL_VIA is gmail';
  if (route && route.reason !== 'setting') {
    const reason = route.detail ?? route.reason;
    why = describeWorkerReason(reason);
    if (route.reason === 'paused') why += ` (Gmail for up to ${pauseSeconds(reason) / 60} minutes, then the Worker is tried again)`;
  }
  return [`Email: ${on}; with Gmail from this Google account, because ${why}; ${replyTo}; ${quota} emails left today`, ...keyLine];
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function summarizeTick(report: TickReport): string {
  const n = report.notifications;
  const parts = [
    `Balance changes: ${report.balanceChanges}`,
    `fund requests posted: ${report.redemptionsPosted}`,
    `announcements: ${report.announcementsSent}`,
    `reminders: ${report.remindersSent}`,
    `sent push ${n.push}, email ${n.email}, sms ${n.sms}`,
  ];
  if (report.errors.length > 0) parts.push(`${report.errors.length} error(s), see Log`);
  return `${parts.join(' · ')}.`;
}

function activeUserEmail(): string {
  return safely(() => Session.getActiveUser().getEmail(), '');
}

function safely<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

/** Dialog when run from the sheet; just a log line from triggers or the API. */
function alert(title: string, message: string): void {
  try {
    const ui = SpreadsheetApp.getUi();
    ui.alert(title, message, ui.ButtonSet.OK);
  } catch {
    console.info(`${title}: ${message}`);
  }
}

function toast(message: string): void {
  try {
    SpreadsheetApp.getActive().toast(message, MENU_TITLE, 10);
  } catch {
    console.info(message);
  }
}
