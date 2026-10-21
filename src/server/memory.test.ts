import { describe, expect, it, vi } from 'vitest';
import { createDeterministicCrypto, createFakePaymentGateway, createMemoryCache, createMemoryServices, createMemoryStore, type MemoryDb } from './memory';

describe('memory store', () => {
  it('behaves like a sheet: stable row numbers from 2, blank rows skipped, patches and overwrites', () => {
    const db: MemoryDb = { tables: {} };
    const onChange = vi.fn();
    const store = createMemoryStore(db, onChange);
    expect(store.read('Families')).toEqual([]);
    expect(store.ensureTable('Families')).toEqual({ created: true, addedColumns: [] });
    expect(store.ensureTable('Families')).toEqual({ created: false, addedColumns: [] });

    store.append('Families', [
      { FamilyID: 'F0001', 'Parent Name': 'A', Bogus: 'ignored' },
      { FamilyID: 'F0002', 'Parent Name': 'B' },
    ]);
    store.update('Families', 2, { FamilyID: '', 'Parent Name': '' }); // blank out the first row
    store.update('Families', 3, { Status: 'Active' });
    expect(store.read('Families')).toEqual([{ rowNumber: 3, data: { FamilyID: 'F0002', 'Parent Name': 'B', Status: 'Active' } }]);
    expect(db.tables.Families?.[0]).toEqual({ FamilyID: '', 'Parent Name': '' });
    expect(() => store.update('Families', 9, { Status: 'x' })).toThrow();

    store.overwrite('_Snapshot', [{ StudentID: 'S1', Balance: 5 }]);
    expect(store.read('_Snapshot')).toEqual([{ rowNumber: 2, data: { StudentID: 'S1', Balance: 5 } }]);
    expect(onChange).toHaveBeenCalledTimes(5); // ensureTable(created), append, 2 updates, overwrite
  });

  it('stores JSON-safe values and maps aliased headers', () => {
    const db: MemoryDb = { tables: { Students: [{ 'Student ID': 'S1', first: 'Avery', Groups: 'Band' }] } };
    const store = createMemoryStore(db);
    expect(store.read('Students')[0].data).toEqual({ StudentID: 'S1', 'First Name': 'Avery', Ensembles: 'Band' });
    store.append('Log', [{ At: new Date('2026-10-21T14:00:00Z'), Kind: 'k', Detail: 'd' }]);
    expect(db.tables.Log?.[0].At).toBe('2026-10-21T14:00:00.000Z');
    // Reads are copies.
    const row = store.read('Log')[0];
    row.data.Kind = 'changed';
    expect(store.read('Log')[0].data.Kind).toBe('k');
  });
});

describe('memory cache', () => {
  it('expires entries with the injected clock and caps TTL at 6 hours', () => {
    let now = 0;
    const cache = createMemoryCache({ now: () => new Date(now) });
    cache.put('a', '1', 10);
    cache.put('b', '2', 999999);
    now = 9999;
    expect(cache.get('a')).toBe('1');
    now = 10000;
    expect(cache.get('a')).toBeNull();
    now = 21600 * 1000 - 1;
    expect(cache.get('b')).toBe('2');
    now = 21600 * 1000;
    expect(cache.get('b')).toBeNull();
    cache.put('c', '3', 60);
    cache.remove('c');
    expect(cache.get('c')).toBeNull();
  });
});

describe('crypto fakes', () => {
  it('is deterministic in test mode and well-formed', () => {
    const a = createDeterministicCrypto();
    const b = createDeterministicCrypto();
    expect(a.randomDigits(6)).toBe(b.randomDigits(6));
    expect(a.randomDigits(12)).toMatch(/^\d{12}$/);
    expect(a.uuid()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(a.uuid()).not.toBe(a.uuid());
  });

  it('uses real randomness in demo mode', () => {
    const s = createMemoryServices({ mode: 'demo' });
    expect(s.crypto.randomDigits(6)).toMatch(/^\d{6}$/);
    expect(s.crypto.uuid()).not.toBe(s.crypto.uuid());
  });
});

describe('memory services', () => {
  it('records mail/push/sms in the outbox and enforces the mail quota', () => {
    const s = createMemoryServices({ mailQuota: 1 });
    s.mailer.send({ to: 'a@example.com', subject: 's', html: 'h', text: 't' });
    expect(s.mailer.remainingQuota()).toBe(0);
    expect(() => s.mailer.send({ to: 'a@example.com', subject: 's', html: 'h', text: 't' })).toThrow();
    expect(s.push.send(['ok-token', 'bad-token'], { title: 't', body: 'b', topic: 'test' })).toEqual(['ok', 'invalid']);
    s.sms.send('6035550100', 'hi');
    expect(s.outbox).toMatchObject({ mail: [{ to: 'a@example.com' }], push: [{ tokens: ['ok-token', 'bad-token'] }], sms: [{ to: '6035550100' }] });
  });

  it('supports a fixed or moving clock', () => {
    const s = createMemoryServices({ now: new Date('2026-10-21T14:00:00Z') });
    expect(s.clock.now().toISOString()).toBe('2026-10-21T14:00:00.000Z');
    s.setNow(new Date('2026-12-25T12:00:00Z'));
    expect(s.clock.now().toISOString()).toBe('2026-12-25T12:00:00.000Z');
    let t = 0;
    const moving = createMemoryServices({ now: () => new Date(t) });
    t = 1000;
    expect(moving.clock.now().getTime()).toBe(1000);
  });

  it('delegates to a custom push sender but still records the outbox', () => {
    const s = createMemoryServices({
      push: { enabled: () => false, publicKey: () => 'custom-key', send: (tokens) => tokens.map(() => 'error' as const) },
    });
    expect(s.push.send(['x'], { title: 't', body: 'b', topic: 'test' })).toEqual(['error']);
    expect(s.outbox.push).toHaveLength(1);
    expect(s.push.enabled()).toBe(false);
    expect(s.push.publicKey()).toBe('custom-key');
  });

  it('reports no push public key unless one is given', () => {
    expect(createMemoryServices().push.publicKey()).toBe('');
    expect(createMemoryServices({ pushPublicKey: 'BKey' }).push.publicKey()).toBe('BKey');
  });
});

describe('fake payment gateway', () => {
  it('captures for the order gross, idempotently per request id', () => {
    const g = createFakePaymentGateway();
    const { orderId } = g.createOrder({ amountCents: 100, feeCents: 5, grossCents: 105, itemName: 'i', description: 'd', referenceId: 'r', customId: 'c', brandName: 'b' });
    const first = g.captureOrder(orderId, `cap-${orderId}`);
    expect(first).toMatchObject({ status: 'COMPLETED', grossCents: 105 });
    expect(g.captureOrder(orderId, `cap-${orderId}`)).toEqual(first);
    expect(g.captureOrder('nope', 'cap-nope').status).toBe('FAILED');
    const declined = createFakePaymentGateway({ failCapture: true });
    const order = declined.createOrder({ amountCents: 1, feeCents: 0, grossCents: 1, itemName: '', description: '', referenceId: '', customId: '', brandName: '' });
    expect(declined.captureOrder(order.orderId, 'x').status).toBe('DECLINED');
  });
});
