/**
 * Optional SmsSender over Twilio's REST API (about 1¢ per text, so it is off
 * unless all three TWILIO_* Script Properties are set).
 */
import type { Logger, Secrets, SmsSender } from '../server/services';
import { clip, formEncode, parseJson, pick } from './util';

/** Twilio's maximum message length (it splits into segments itself). */
const MAX_SMS_CHARS = 1600;
const MESSAGING_SERVICE_SID = /^MG[0-9a-f]{32}$/i;

export interface TwilioDeps {
  secrets: Secrets;
  logger: Logger;
}

/**
 * E.164 for a typed phone number: 10 digits = US (+1); 11–15 digits (or a
 * leading +) must already include the country code.
 */
export function toE164(raw: string): string | null {
  const text = String(raw ?? '').trim();
  const digits = text.replace(/\D/g, '');
  if (text.startsWith('+')) return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  if (digits.length === 10) return `+1${digits}`;
  return digits.length >= 11 && digits.length <= 15 ? `+${digits}` : null;
}

export function createTwilioSender(deps: TwilioDeps): SmsSender {
  const { secrets, logger } = deps;

  function credentials() {
    const sid = secrets.get('TWILIO_ACCOUNT_SID');
    const token = secrets.get('TWILIO_AUTH_TOKEN');
    const from = secrets.get('TWILIO_FROM');
    return sid && token && from ? { sid, token, from } : null;
  }

  return {
    enabled: () => credentials() !== null,

    send(to: string, body: string): void {
      const creds = credentials();
      if (!creds) throw new Error('Text messages are not configured');
      const phone = toE164(to);
      if (!phone) throw new Error('Invalid phone number for text message');

      const fields: Record<string, string> = { To: phone, Body: clip(String(body ?? ''), MAX_SMS_CHARS) };
      if (MESSAGING_SERVICE_SID.test(creds.from)) fields.MessagingServiceSid = creds.from;
      else fields.From = toE164(creds.from) ?? creds.from;

      const res = UrlFetchApp.fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(creds.sid)}/Messages.json`,
        {
          method: 'post',
          headers: { Authorization: `Basic ${Utilities.base64Encode(`${creds.sid}:${creds.token}`, Utilities.Charset.UTF_8)}` },
          contentType: 'application/x-www-form-urlencoded',
          payload: formEncode(fields),
          muteHttpExceptions: true,
        },
      );
      const code = res.getResponseCode();
      if (code < 200 || code >= 300) {
        const twilioCode = pick(parseJson(res.getContentText()), 'code');
        logger.error('Twilio send failed', { status: code, code: twilioCode });
        throw new Error(`Text message failed (Twilio ${String(twilioCode ?? `HTTP ${code}`)})`);
      }
    },
  };
}
