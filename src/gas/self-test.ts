/**
 * "Send me a test notification" from the sheet menu. Works without an app
 * session token: it reads the Devices tab for the signed-in Google user's
 * email and calls the push sender (and mailer) directly.
 */
import type { PushMessage } from '../shared/types';
import type { GasServices } from './services';
import { escapeHtml } from './util';

export const TEST_MESSAGE: PushMessage = {
  title: 'Test notification ✅',
  body: 'Notifications are working on this device.',
  url: '#/',
  tag: 'tma-test',
  topic: 'test',
};

export interface SelfTestReport {
  email: string;
  devices: number;
  push: number;
  removed: number;
  emailSent: boolean;
  notes: string[];
}

const BLANK_DEVICE = { Email: '', FamilyID: '', Token: '', 'User Agent': '', Created: '', 'Last Seen': '' };

function normEmail(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function tokenOf(value: unknown): string {
  return value === null || value === undefined ? '' : String(value).trim();
}

export function sendSelfTest(services: GasServices, rawEmail: string): SelfTestReport {
  const email = normEmail(rawEmail);
  const report: SelfTestReport = { email, devices: 0, push: 0, removed: 0, emailSent: false, notes: [] };
  if (!email) {
    report.notes.push('Could not tell which Google account you are signed in with.');
    return report;
  }

  const tokens = [
    ...new Set(
      services.store
        .read('Devices')
        .filter((row) => normEmail(row.data.Email) === email)
        .map((row) => tokenOf(row.data.Token))
        .filter(Boolean),
    ),
  ];
  report.devices = tokens.length;

  if (tokens.length === 0) {
    report.notes.push(`No phones are registered for ${email}. Sign in to the app with this email and turn on notifications (More → Notifications).`);
  } else if (!services.push.enabled()) {
    report.notes.push('Push is not set up: add the FCM_SERVICE_ACCOUNT script property (see docs/SETUP.md).');
  } else {
    const results = services.push.send(tokens, TEST_MESSAGE);
    report.push = results.filter((r) => r === 'ok').length;
    const dead = new Set(tokens.filter((_, i) => results[i] === 'invalid'));
    if (dead.size > 0) {
      // Re-read under the lock: row numbers are only trusted while we hold it.
      services.withLock(() => {
        for (const row of services.store.read('Devices')) {
          if (dead.has(tokenOf(row.data.Token))) {
            services.store.update('Devices', row.rowNumber, BLANK_DEVICE);
            report.removed += 1;
          }
        }
      });
    }
    const failed = results.filter((r) => r === 'error').length;
    if (failed > 0) report.notes.push(`${failed} device(s) could not be reached right now; see Executions for details.`);
  }

  if (!services.flag('EMAIL_ENABLED')) {
    report.notes.push('Email is turned off (Settings EMAIL_ENABLED).');
  } else if (services.mailer.remainingQuota() <= 0) {
    report.notes.push('No emails left in today\'s Google quota.');
  } else {
    const orgName = services.setting('ORG_NAME');
    services.mailer.send({
      to: email,
      subject: `${orgName}: test notification`,
      html: testEmailHtml(orgName),
      text: `${TEST_MESSAGE.title}\n\nEmail from the TMA app is working.\n`,
    });
    report.emailSent = true;
  }

  services.store.append('Log', [
    {
      At: services.clock.now(),
      Kind: 'notify',
      Detail: `test: ${TEST_MESSAGE.title} → push ${report.push}, email ${report.emailSent ? 1 : 0}, sms 0`,
    },
  ]);
  return report;
}

function testEmailHtml(orgName: string): string {
  return [
    '<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;border:1px solid #e6dcdc">',
    `<div style="background:#5a0f13;color:#ffffff;padding:14px 18px;font-family:Georgia,serif;font-size:18px">${escapeHtml(orgName)}</div>`,
    '<div style="padding:18px;color:#141010;font-size:15px;line-height:1.5">',
    `<p style="margin:0 0 12px"><strong>${escapeHtml(TEST_MESSAGE.title)}</strong></p>`,
    '<p style="margin:0">Email from the TMA app is working.</p>',
    '</div></div>',
  ].join('');
}
