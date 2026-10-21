import { describe, expect, it } from 'vitest';
import { SETTING_DEFAULTS, TABLE_ORDER } from '../shared/schema';
import { createApp } from './app';
import { createDeterministicCrypto, createMemoryServices } from './memory';
import { sampleData } from './sample-data';
import { generateSecret } from './setup';
import { harness, PARENT, TEST_NOW } from './test-helpers';

describe('setup()', () => {
  it('creates every tab, writes default settings and a TOKEN_SECRET, idempotently', () => {
    const services = createMemoryServices({ now: TEST_NOW });
    const app = createApp(services);
    const first = app.setup();
    expect(first.createdTables).toEqual([...TABLE_ORDER]);
    expect(first.secretsInitialized).toEqual(['TOKEN_SECRET']);
    expect(first.seeded).toBe(false);
    expect(services.secrets.get('TOKEN_SECRET')).toMatch(/^[0-9a-f]{64}$/);
    const settings = services.db.tables.Settings ?? [];
    expect(settings.map((r) => r.Key)).toEqual(Object.keys(SETTING_DEFAULTS));
    expect(settings.find((r) => r.Key === 'REMINDER_DAYS')).toMatchObject({ Value: '14, 7, 1', Notes: expect.stringContaining('reminders') });
    expect(settings.find((r) => r.Key === 'PUSH_RELAY_URL')).toEqual({
      Key: 'PUSH_RELAY_URL',
      Value: 'https://tma-push.coleciprari.workers.dev',
      Notes: 'Web address of the TMA push Worker on Cloudflare. Leave the default unless TMA moves it.',
    });

    const secret = services.secrets.get('TOKEN_SECRET');
    const second = app.setup();
    expect(second).toEqual({ createdTables: [], addedColumns: [], seeded: false, secretsInitialized: [] });
    expect(services.secrets.get('TOKEN_SECRET')).toBe(secret);
    expect(services.db.tables.Settings).toHaveLength(Object.keys(SETTING_DEFAULTS).length);
  });

  it('generateSecret makes distinct 64-hex secrets', () => {
    const crypto = createDeterministicCrypto('secrets');
    const a = generateSecret(crypto, 'PUSH_RELAY_SECRET');
    const b = generateSecret(crypto, 'PUSH_RELAY_SECRET');
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(b).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(b);
    expect(() => generateSecret({ ...crypto, hmacSha256Hex: () => 'short' }, 'TOKEN_SECRET')).toThrow(/TOKEN_SECRET/);
  });

  it('only adds missing settings and keeps what the treasurer typed', () => {
    const services = createMemoryServices({
      now: TEST_NOW,
      db: { tables: { Settings: [{ Key: 'Admin Emails', Value: 'boss@example.org' }] } },
    });
    createApp(services).setup();
    const settings = services.db.tables.Settings ?? [];
    expect(settings.filter((r) => /admin/i.test(String(r.Key)))).toEqual([{ Key: 'Admin Emails', Value: 'boss@example.org' }]);
    expect(settings).toHaveLength(Object.keys(SETTING_DEFAULTS).length);
  });

  it('seeds the sample data only into an empty sheet', () => {
    const services = createMemoryServices({ now: TEST_NOW });
    const report = createApp(services).setup({ seedSampleData: true });
    expect(report.seeded).toBe(true);
    expect(services.db.tables.Families).toHaveLength(3);
    expect(services.db.tables.Ledger?.length).toBeGreaterThan(10);
    // Production seeding keeps default settings and adds no demo device.
    expect(services.db.tables.Settings?.find((r) => r.Key === 'ADMIN_EMAILS')?.Value).toBe('');
    expect(services.db.tables.Devices).toEqual([]);

    const again = createApp(services).setup({ seedSampleData: true });
    expect(again.seeded).toBe(false);
    expect(services.db.tables.Families).toHaveLength(3);

    const used = createMemoryServices({ now: TEST_NOW, db: { tables: { Families: [{ FamilyID: 'F0001', 'Parent Name': 'Real Parent' }] } } });
    expect(createApp(used).setup({ seedSampleData: true }).seeded).toBe(false);
    expect(used.db.tables.Families).toHaveLength(1);
  });

  it('produces a working app end to end after setup', () => {
    const services = createMemoryServices({ now: TEST_NOW });
    const app = createApp(services);
    app.setup({ seedSampleData: true });
    const res = app.handle({ action: 'auth.requestCode', params: { email: PARENT } });
    expect(res.ok).toBe(true);
    const code = /(\d{6})/.exec(services.outbox.mail[0].subject)?.[1] ?? '';
    const verified = app.handle({ action: 'auth.verifyCode', params: { email: PARENT, code } });
    if (!verified.ok) throw new Error(verified.error.message);
    const token = (verified.data as { token: string }).token;
    const boot = app.handle({ action: 'me.bootstrap', params: {}, token });
    expect(boot.ok && (boot.data as { students: unknown[] }).students).toHaveLength(2);
  });
});

describe('sampleData()', () => {
  it('produces the households, balances and match candidate described in the spec', () => {
    const h = harness();
    const overview = h.ok('admin.overview', {}, h.signIn('treasurer@example.com'));
    expect(overview.pendingHouseholds[0].students[0].candidates[0]).toMatchObject({ studentId: 'S0005', score: 1, balanceCents: 52000 });

    const b = h.ok('me.bootstrap', {}, h.signIn(PARENT));
    expect(b.students.map((s) => s.balanceCents)).toEqual([64000, 8500]);
    const nguyen = h.ok('me.bootstrap', {}, h.signIn('nguyen.family@example.com'));
    expect(nguyen.students.map((s) => [s.student.firstName, s.balanceCents])).toEqual([
      ['Maya', 41000],
      ['Ethan', 3500],
    ]);
    const lessons = nguyen.students[0].activities.find((a) => a.activityId === 'LESSONS');
    expect(lessons).toMatchObject({ costCents: 36000, allowOnlinePayment: false, remainingCents: 36000 });
  });

  it('keeps dates relative to today and stays JSON-safe', () => {
    const data = sampleData(new Date('2027-03-01T15:00:00Z'));
    expect(JSON.parse(JSON.stringify(data))).toEqual(data);
    const fl = data.Activities?.find((a) => a.ActivityID === 'FL27');
    expect(fl?.['Deposit Due']).toBe('2027-03-26');
    expect(fl?.['Due Date']).toBe('2027-06-09');
    expect(data.Events?.find((e) => e.ID === 'EV-JAZZ')?.Date).toBe('2027-03-02');
    expect(data.Settings).toBeUndefined();
    expect(data.Devices).toBeUndefined();

    const demo = sampleData(new Date('2027-03-01T15:00:00Z'), { demoSettings: true });
    const settings = Object.fromEntries((demo.Settings ?? []).map((r) => [r.Key, r.Value]));
    expect(settings).toMatchObject({ ADMIN_EMAILS: 'treasurer@example.com', ONLINE_PAYMENTS: 'TRUE', PAYPAL_CLIENT_ID: 'demo', APP_URL: '' });
    expect(demo.Devices).toEqual([expect.objectContaining({ Email: PARENT, Token: 'demo-device-parent' })]);
  });

  it('uses only fictional example.com/example.org addresses', () => {
    const json = JSON.stringify(sampleData(TEST_NOW, { demoSettings: true }));
    const emails = json.match(/[\w.+-]+@[\w.-]+/g) ?? [];
    for (const e of emails) expect(e).toMatch(/@example\.(com|org)$|^timberlanemusictma@gmail\.com$/);
  });
});
