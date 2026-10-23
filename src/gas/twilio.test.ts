import * as nodeCrypto from 'node:crypto';
import type { Logger } from '../server/services';
import { createScriptSecrets } from './services';
import { installGasFakes, uninstallGasFakes, type GasFakes } from './testing/fakes';
import { createTwilioSender, toE164 } from './twilio';

const SID = `AC${'a'.repeat(32)}`;
let gas: GasFakes;
let logger: Logger & { lines: unknown[][] };

function sender() {
  return createTwilioSender({ secrets: createScriptSecrets(), logger });
}

beforeEach(() => {
  gas = installGasFakes(nodeCrypto);
  gas.properties.setProperty('TWILIO_ACCOUNT_SID', SID);
  gas.properties.setProperty('TWILIO_AUTH_TOKEN', 'auth-token');
  gas.properties.setProperty('TWILIO_FROM', '(603) 555-0199');
  const lines: unknown[][] = [];
  logger = { lines, info: (...a: unknown[]) => lines.push(['info', ...a]), error: (...a: unknown[]) => lines.push(['error', ...a]) };
  gas.fetch.handler = () => ({ code: 201, body: { sid: 'SM1' } });
});
afterEach(() => uninstallGasFakes());

describe('toE164', () => {
  it('normalizes US and international numbers', () => {
    expect(toE164('603-555-0100')).toBe('+16035550100');
    expect(toE164('1 (603) 555-0100')).toBe('+16035550100');
    expect(toE164('+44 20 7946 0958')).toBe('+442079460958');
    expect(toE164('442079460958')).toBe('+442079460958');
    expect(toE164('555-0100')).toBeNull();
    expect(toE164('+1234567890123456')).toBeNull();
    expect(toE164('')).toBeNull();
  });
});

describe('Twilio SmsSender', () => {
  it('is enabled only when all three secrets are set', () => {
    expect(sender().enabled()).toBe(true);
    gas.properties.setProperty('TWILIO_FROM', '');
    expect(sender().enabled()).toBe(false);
    expect(() => sender().send('6035550100', 'hi')).toThrow(/not configured/);
  });

  it('posts a form with basic auth to the Messages endpoint', () => {
    sender().send('603.555.0100', 'TMA: $50.00 was added to Avery\'s funds & more');
    const [req] = gas.fetch.requests;
    expect(req.url).toBe(`https://api.twilio.com/2010-04-01/Accounts/${SID}/Messages.json`);
    expect(req.method).toBe('post');
    expect(req.headers.Authorization).toBe(`Basic ${Buffer.from(`${SID}:auth-token`).toString('base64')}`);
    expect(req.contentType).toBe('application/x-www-form-urlencoded');
    const form = new URLSearchParams(req.payload as string);
    expect(form.get('To')).toBe('+16035550100');
    expect(form.get('From')).toBe('+16035550199');
    expect(form.get('Body')).toBe("TMA: $50.00 was added to Avery's funds & more");
  });

  it('uses a Messaging Service SID when TWILIO_FROM is one', () => {
    const mg = `MG${'b'.repeat(32)}`;
    gas.properties.setProperty('TWILIO_FROM', mg);
    sender().send('6035550100', 'hi');
    const form = new URLSearchParams(gas.fetch.requests[0].payload as string);
    expect(form.get('MessagingServiceSid')).toBe(mg);
    expect(form.has('From')).toBe(false);
  });

  it('throws on API errors and invalid numbers, without logging credentials', () => {
    gas.fetch.handler = () => ({ code: 400, body: { code: 21211, message: 'Invalid To' } });
    expect(() => sender().send('6035550100', 'hi')).toThrow(/Twilio 21211/);
    expect(JSON.stringify(logger.lines)).not.toContain('auth-token');
    expect(() => sender().send('12', 'hi')).toThrow(/Invalid phone/);
  });

  it('clips long messages to 1600 characters', () => {
    sender().send('6035550100', 'x'.repeat(2000));
    expect(new URLSearchParams(gas.fetch.requests[0].payload as string).get('Body')).toHaveLength(1600);
  });
});
