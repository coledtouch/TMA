import * as nodeCrypto from 'node:crypto';
import {
  createConsoleLogger,
  createGasCrypto,
  createGasServices,
  createMailAppMailer,
  createScriptCache,
  createScriptLock,
  createScriptSecrets,
  randomDigits,
} from './services';
import { parseFlag, readFlag, readSetting, settingKey } from './settings';
import { FakeSheet, installGasFakes, uninstallGasFakes, type GasFakes } from './testing/fakes';
import { base64UrlEncode, bytesToHex } from './util';

let gas: GasFakes;

beforeEach(() => {
  gas = installGasFakes(nodeCrypto);
});
afterEach(() => uninstallGasFakes());

describe('crypto', () => {
  it('hmacSha256Hex matches node crypto, including UTF-8 input', () => {
    const crypto = createGasCrypto();
    for (const [key, message] of [
      ['secret', 'parent@example.com123456'],
      ['k€y', 'héllo wörld ✅'],
      ['', ''],
    ]) {
      const expected = nodeCrypto.createHmac('sha256', key).update(message, 'utf8').digest('hex');
      expect(crypto.hmacSha256Hex(key, message)).toBe(expected);
    }
  });

  it('bytesToHex converts signed Java bytes', () => {
    expect(bytesToHex([0, 1, 15, 16, 127, -128, -1])).toBe('00010f107f80ff');
  });

  it('base64UrlEncode strips padding and is URL-safe', () => {
    expect(base64UrlEncode('a')).toBe('YQ');
    expect(base64UrlEncode([0xfb, 0xff].map((b) => b - 256))).toBe('-_8');
    expect(base64UrlEncode('{"alg":"RS256"}')).toBe(Buffer.from('{"alg":"RS256"}').toString('base64url'));
  });

  it('uuid is lower-case', () => {
    gas.uuids.push('ABCDEF01-2345-4678-9ABC-DEF012345678');
    expect(createGasCrypto().uuid()).toBe('abcdef01-2345-4678-9abc-def012345678');
  });

  it('randomDigits keeps only nibbles < 10 and skips the version/variant nibbles', () => {
    // Positions 12 ('4') and 16 ('8') must be skipped even though they are digits.
    gas.uuids.push('ffffffff-ffff-4fff-8fff-ffffff123456');
    expect(randomDigits(6)).toBe('123456');
  });

  it('randomDigits draws more UUIDs as needed and returns exactly `length` digits', () => {
    gas.uuids.push('ffffffff-ffff-4fff-8fff-fffffffffff1', 'ffffffff-ffff-4fff-8fff-ffffffffff23');
    expect(randomDigits(3)).toBe('123');
    const many = randomDigits(64);
    expect(many).toMatch(/^\d{64}$/);
  });

  it('randomDigits is roughly uniform', () => {
    const counts = new Array<number>(10).fill(0);
    const s = Array.from({ length: 200 }, () => randomDigits(50)).join('');
    for (const ch of s) counts[Number(ch)] += 1;
    const expected = s.length / 10;
    for (const c of counts) expect(Math.abs(c - expected) / expected).toBeLessThan(0.2);
  });

  it('randomDigits validates the length', () => {
    expect(() => randomDigits(0)).toThrow(RangeError);
    expect(() => randomDigits(1.5)).toThrow(RangeError);
    expect(() => randomDigits(65)).toThrow(RangeError);
  });

  it('randomDigits gives up instead of looping forever on bad UUIDs', () => {
    vi.spyOn(Utilities, 'getUuid').mockReturnValue('not-a-uuid');
    expect(() => randomDigits(6)).toThrow(/unusable/);
  });
});

describe('cache', () => {
  it('round-trips and clamps the TTL to Apps Script limits', () => {
    const cache = createScriptCache();
    cache.put('a', '1', 999999);
    cache.put('b', '2', 0.4);
    cache.put('c', '3', Number.NaN);
    expect(gas.cache.entries.get('a')!.ttl).toBe(21600);
    expect(gas.cache.entries.get('b')!.ttl).toBe(1);
    expect(gas.cache.entries.get('c')!.ttl).toBe(21600);
    expect(cache.get('a')).toBe('1');
    cache.remove('a');
    expect(cache.get('a')).toBeNull();
  });

  it('hashes keys longer than 250 characters', () => {
    const cache = createScriptCache();
    const longKey = `otp:${'x'.repeat(300)}@example.com`;
    cache.put(longKey, 'v', 60);
    const stored = [...gas.cache.entries.keys()][0];
    expect(stored).toBe(`sha256:${nodeCrypto.createHash('sha256').update(longKey).digest('hex')}`);
    expect(cache.get(longKey)).toBe('v');
  });
});

describe('secrets', () => {
  it('reads Script Properties, trimming and treating blank as missing', () => {
    gas.properties.setProperty('PAYPAL_SECRET', '  s3cret\n');
    gas.properties.setProperty('TWILIO_FROM', '   ');
    const secrets = createScriptSecrets();
    expect(secrets.get('PAYPAL_SECRET')).toBe('s3cret');
    expect(secrets.get('TWILIO_FROM')).toBeNull();
    expect(secrets.get('TOKEN_SECRET')).toBeNull();
    secrets.set('TOKEN_SECRET', 'abc');
    expect(gas.properties.getProperty('TOKEN_SECRET')).toBe('abc');
  });
});

describe('withLock', () => {
  it('waits 20 s, runs hooks, releases even when fn throws', () => {
    const events: string[] = [];
    const withLock = createScriptLock({ onAcquire: () => events.push('acquire'), beforeRelease: () => events.push('flush') });
    expect(withLock(() => 42)).toBe(42);
    expect(() =>
      withLock(() => {
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(gas.lock.calls).toEqual(['waitLock 20000', 'releaseLock', 'waitLock 20000', 'releaseLock']);
    expect(events).toEqual(['acquire', 'flush', 'acquire', 'flush']);
    expect(gas.lock.held).toBe(false);
  });

  it('is re-entrant: nested calls do not wait on the lock again', () => {
    const withLock = createScriptLock({ onAcquire: () => undefined, beforeRelease: () => undefined });
    const result = withLock(() => withLock(() => withLock(() => 'inner')));
    expect(result).toBe('inner');
    expect(gas.lock.calls).toEqual(['waitLock 20000', 'releaseLock']);
  });

  it('propagates a lock timeout without running fn', () => {
    gas.lock.busy = true;
    const fn = vi.fn();
    const withLock = createScriptLock({ onAcquire: () => undefined, beforeRelease: () => undefined });
    expect(() => withLock(fn)).toThrow(/Lock timeout/);
    expect(fn).not.toHaveBeenCalled();
  });
});

describe('mailer and logger', () => {
  it('sends with MailApp using the org name and reports the quota', () => {
    const mailer = createMailAppMailer(() => 'Timberlane Music Association');
    gas.mail.quota = 7;
    expect(mailer.remainingQuota()).toBe(7);
    mailer.send({ to: 'parent@example.com', subject: 'Hi\nthere', html: '<p>x</p>', text: 'x' });
    expect(gas.mail.sent).toEqual([
      { to: 'parent@example.com', subject: 'Hi there', htmlBody: '<p>x</p>', body: 'x', name: 'Timberlane Music Association' },
    ]);
    expect(() => mailer.send({ to: '', subject: 's', html: '', text: '' })).toThrow(/recipient/);
  });

  it('logs through console, flattening errors', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const logger = createConsoleLogger();
    logger.info('hello');
    logger.info('with data', { n: 1 });
    logger.error('failed', new Error('nope'));
    expect(info).toHaveBeenCalledWith('hello');
    expect(info).toHaveBeenCalledWith('with data', { n: 1 });
    expect(error.mock.calls[0][0]).toBe('failed');
    expect(error.mock.calls[0][1]).toMatchObject({ message: 'nope' });
  });
});

describe('settings', () => {
  function settingsSheet(rows: unknown[][]) {
    gas.spreadsheet.addSheet(FakeSheet.withRows('Settings', [['Key', 'Value', 'Notes'], ...(rows as string[][])]));
  }

  it('reads values by key like the core (UPPER_SNAKE, last row wins, blank = default)', () => {
    settingsSheet([
      ['PAYPAL_CLIENT_ID', 'old', ''],
      ['Paypal Client ID', '  AbC123 ', ''],
      ['paypal env', 'live', ''],
      ['ONLINE_PAYMENTS', true, ''],
      ['ORG_NAME', '', ''],
      ['EMAIL_ENABLED', 'maybe', ''],
      ['SMS_ENABLED', 'no', ''],
    ]);
    const store = createGasServices().store;
    expect(readSetting(store, 'PAYPAL_CLIENT_ID')).toBe('AbC123');
    expect(readSetting(store, 'PAYPAL_ENV')).toBe('live');
    expect(readSetting(store, 'ONLINE_PAYMENTS')).toBe('TRUE');
    expect(readSetting(store, 'ORG_NAME')).toBe('Timberlane Music Association');
    expect(readSetting(store, 'MIN_PAYMENT')).toBe('5.00');
    expect(readFlag(store, 'ONLINE_PAYMENTS')).toBe(true);
    expect(readFlag(store, 'EMAIL_ENABLED')).toBe(true); // unrecognized -> default TRUE
    expect(readFlag(store, 'SMS_ENABLED')).toBe(false);
  });

  it('normalizes keys and flags like the core', () => {
    expect(settingKey(' admin emails ')).toBe('ADMIN_EMAILS');
    expect(settingKey('Fee-Percent')).toBe('FEE_PERCENT');
    for (const v of ['TRUE', 'true', 'Y', 'yes', 'x', '1', ' on ', '✓']) expect(parseFlag(v, false)).toBe(true);
    for (const v of ['FALSE', 'n', 'no', '0', 'off']) expect(parseFlag(v, true)).toBe(false);
    expect(parseFlag('', true)).toBe(true);
    expect(parseFlag('maybe', false)).toBe(false);
  });
});

describe('createGasServices', () => {
  it('wires production services; PayPal reads the client id from Settings and the secret from Script Properties', () => {
    gas.spreadsheet.addSheet(FakeSheet.withRows('Settings', [['Key', 'Value'], ['PAYPAL_CLIENT_ID', 'client-1']]));
    const services = createGasServices();
    expect(services.mode).toBe('production');
    expect(services.payments.enabled()).toBe(false);
    gas.properties.setProperty('PAYPAL_SECRET', 'shh');
    expect(services.payments.enabled()).toBe(true);
    expect(services.push.enabled()).toBe(false);
    gas.properties.setProperty('PUSH_RELAY_SECRET', 'd'.repeat(64));
    expect(services.push.enabled()).toBe(true); // Settings PUSH_RELAY_URL defaults to the TMA Worker
    expect(services.push.baseUrl()).toBe('https://tma-push.coleciprari.workers.dev');
    expect(services.sms.enabled()).toBe(false);
    expect(services.clock.now()).toBeInstanceOf(Date);
  });

  it('withLock drops memoized reads (another execution may have written) and flushes before releasing', () => {
    const sheet = gas.spreadsheet.addSheet(FakeSheet.withRows('Students', [['StudentID', 'Grade'], ['S1', 7]]));
    const services = createGasServices();
    expect(services.store.read('Students')[0].data.Grade).toBe(7);
    sheet.write(2, 2, 8); // a concurrent execution's write
    const grade = services.withLock(() => services.store.read('Students')[0].data.Grade);
    expect(grade).toBe(8);
    expect(gas.flushes).toBe(1);
  });

  it('appends from inside withLock do not try to take the lock twice', () => {
    gas.spreadsheet.addSheet(FakeSheet.withRows('Log', [['At', 'Kind', 'Detail']]));
    const services = createGasServices();
    services.withLock(() => services.store.append('Log', [{ Kind: 'x', Detail: 'y' }]));
    services.store.append('Log', [{ Kind: 'z', Detail: 'w' }]);
    expect(gas.lock.calls).toEqual(['waitLock 20000', 'releaseLock', 'waitLock 20000', 'releaseLock']);
    expect(services.store.read('Log').map((r) => r.data.Kind)).toEqual(['x', 'z']);
  });

  it('explains when the script is not bound to a spreadsheet', () => {
    vi.spyOn(SpreadsheetApp, 'getActive').mockReturnValue(null as unknown as GoogleAppsScript.Spreadsheet.Spreadsheet);
    expect(() => createGasServices()).toThrow(/Extensions → Apps Script/);
  });
});
