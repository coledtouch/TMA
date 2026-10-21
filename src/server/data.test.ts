import { describe, expect, it } from 'vitest';
import { createCtx } from './context';
import {
  activityKind,
  enrollmentStatus,
  mapActivity,
  mapAnnouncement,
  mapEvent,
  mapFamily,
  mapLedger,
  mapPayment,
  mapRedemption,
  paymentMethod,
  paymentStatus,
  recordStatus,
  redemptionStatus,
} from './data';
import { createMemoryServices } from './memory';
import { buildSettings } from './settings';
import { computeBooks } from './ledger';

const services = createMemoryServices();
const settings = buildSettings([], services);
const identity = { student: (id: string) => id, activity: (id: string) => id, family: (id: string) => id };
const row = (data: Record<string, unknown>, rowNumber = 5) => ({ rowNumber, data: data as never });

describe('status/kind parsers', () => {
  it('applies the documented blank defaults', () => {
    expect(recordStatus('', 'Active')).toBe('Active');
    expect(enrollmentStatus('')).toBe('Going');
    expect(paymentStatus('')).toBe('Completed');
    expect(redemptionStatus('')).toBe('Pending');
  });

  it('understands what treasurers type', () => {
    expect(recordStatus('inactive', 'Active')).toBe('Inactive');
    expect(recordStatus('PENDING', 'Active')).toBe('Pending');
    expect(enrollmentStatus('Wait list')).toBe('Waitlist');
    expect(enrollmentStatus('withdrew')).toBe('Withdrawn');
    expect(paymentMethod('check #1043')).toBe('Check');
    expect(paymentMethod('Credit card')).toBe('Card');
    expect(paymentMethod('PayPal')).toBe('PayPal');
    expect(paymentMethod('')).toBe('Other');
    expect(paymentStatus('refunded')).toBe('Refunded');
    expect(paymentStatus('bounced')).toBe('Failed');
    expect(redemptionStatus('approve')).toBe('Approved');
    expect(redemptionStatus('Declined')).toBe('Denied');
    expect(redemptionStatus('canceled')).toBe('Cancelled');
    expect(redemptionStatus('whatever')).toBe('Pending');
    expect(activityKind('trips')).toBe('Trip');
    expect(activityKind('Private lesson')).toBe('Lessons');
    expect(activityKind('Fundraiser')).toBe('Other');
    expect(activityKind('Lessons')).toBe('Lessons');
  });
});

describe('row mappers', () => {
  it('maps families: lower-cased emails, guardian slots, defaults', () => {
    const f = mapFamily(row({ FamilyID: 'F0001', 'Parent Name': 'Jordan', Email: ' Parent@Example.COM ', Member: 'x', 'Parent 2 Email': '' }));
    expect(f).toMatchObject({ id: 'F0001', status: 'Active', member: true, guardians: [{ name: 'Jordan', email: 'parent@example.com' }] });
    expect(f?.slots[1]).toEqual({ name: '', email: '' });
    expect(mapFamily(row({ 'Parent Name': 'No ID' }))).toBeNull();
  });

  it('maps ledger rows: skips blank student / zero amount, derives ids, accepts dollars text', () => {
    expect(mapLedger(row({ StudentID: '', Amount: 5 }), identity)).toBeNull();
    expect(mapLedger(row({ StudentID: 'S1', Amount: 0 }), identity)).toBeNull();
    expect(mapLedger(row({ StudentID: 'S1', Amount: '$1,250.50', Date: '10/21/2026' }), identity)).toMatchObject({
      id: 'L5',
      date: '2026-10-21',
      amountCents: 125050,
      type: 'Credit',
    });
    expect(mapLedger(row({ StudentID: 'S1', Amount: '(20)', Reference: 'R-1', ActivityID: 'FL27' }), identity)).toMatchObject({
      id: 'R-1',
      amountCents: -2000,
      type: 'Adjustment',
      activityId: 'FL27',
    });
  });

  it('maps activities with safe URLs and Closed detection', () => {
    const a = mapActivity(
      row({ ActivityID: 'X', Cost: '1,850', 'Due Date': '2027-02-01', Status: 'closed', 'Allow Funds': 'N', 'Info URL': 'javascript:alert(1)' }),
      settings,
    );
    expect(a).toMatchObject({ name: 'X', costCents: 185000, dueDate: '2027-02-01', status: 'Closed', allowFunds: false, allowOnlinePayment: true });
    expect(a?.infoUrl).toBeUndefined();
  });

  it('maps payments with gross fallback', () => {
    expect(mapPayment(row({ StudentID: 'S1', ActivityID: 'A', Amount: 100, 'Fee Covered': 3 }), identity)).toMatchObject({
      id: 'P5',
      grossCents: 10300,
      feeCents: 300,
      status: 'Completed',
      method: 'Other',
    });
  });

  it('treats anything typed in Notified/Sent as done', () => {
    expect(mapRedemption(row({ RequestID: 'R-1', Status: 'Approved', Notified: 'yes' }), identity)?.notifiedAt).toBe('yes');
    const a = mapAnnouncement(row({ Title: 'Hi', Sent: 'x' }), settings);
    expect(a).toMatchObject({ id: 'A5', sent: true, storedId: '' });
    expect(a?.sentAt).toBeUndefined();
    expect(mapAnnouncement(row({ Title: '', Body: '' }), settings)).toBeNull();
  });

  it('maps events with stable derived ids and Sheets time values', () => {
    const e = mapEvent(row({ Date: '2026-11-01', Title: 'Fall Concert!', Time: 0.75, Schools: 'HIGH SCHOOL' }), settings);
    expect(e).toMatchObject({ id: 'E-2026-11-01-fallconcert', time: '6:00 PM', audience: { schools: ['High School'], ensembles: [] } });
    expect(mapEvent(row({ Title: 'No date' }), settings)).toBeNull();
  });
});

describe('ledger math (§3)', () => {
  const activities = [
    { id: 'FL27', name: 'Florida', description: '', kind: 'Trip' as const, ensembles: [], schools: [], costCents: 100000, status: 'Open' as const, allowFunds: true, allowOnlinePayment: true },
  ];
  const books = computeBooks({
    activities,
    enrollments: [
      { studentId: 'S1', activityId: 'FL27', costCents: 100000, status: 'Going' },
      { studentId: 'S2', activityId: 'fl27', costCents: 100000, status: 'Withdrawn' },
      { studentId: 'S3', activityId: 'FL27', costCents: 100000, status: 'Withdrawn' },
    ],
    ledger: [
      { id: '1', date: '', studentId: 'S1', type: 'Fundraiser', description: '', amountCents: 50000 },
      { id: '2', date: '', studentId: 's1', type: 'Redemption', description: '', amountCents: -20000, activityId: 'FL27' },
      { id: '3', date: '', studentId: 'S3', type: 'Redemption', description: '', amountCents: -1000, activityId: 'FL27' },
    ],
    payments: [
      { id: 'p1', date: '', studentId: 'S1', activityId: 'FL27', amountCents: 30000, feeCents: 0, grossCents: 30000, method: 'Check', status: 'Completed' },
      { id: 'p2', date: '', studentId: 'S1', activityId: 'FL27', amountCents: 99999, feeCents: 0, grossCents: 99999, method: 'PayPal', status: 'Pending' },
    ],
    redemptions: [
      { id: 'R1', requestedAt: '', email: '', familyId: 'F1', studentId: 'S1', activityId: 'FL27', amountCents: 40000, status: 'Pending' },
      { id: 'R2', requestedAt: '', email: '', familyId: 'F1', studentId: 'S1', activityId: 'FL27', amountCents: 5000, status: 'Denied' },
    ],
  });

  it('computes balance, pending, available and the activity account', () => {
    expect(books.balance('S1')).toBe(30000);
    expect(books.pending('S1')).toBe(40000);
    expect(books.available('S1')).toBe(0); // never below 0
    expect(books.accounts('S1')).toEqual([
      expect.objectContaining({ paidFromFundsCents: 20000, paidDirectCents: 30000, paidCents: 50000, pendingRedemptionCents: 40000, remainingCents: 50000 }),
    ]);
  });

  it('hides Withdrawn enrollments unless something was paid', () => {
    expect(books.accounts('S2')).toEqual([]);
    expect(books.accounts('S3')).toHaveLength(1);
  });
});

describe('Model', () => {
  it('parses each tab once per request and rebuilds after writes', () => {
    const s = createMemoryServices({ db: { tables: { Families: [{ FamilyID: 'F1', Email: 'a@example.com' }] } } });
    let reads = 0;
    const read = s.store.read.bind(s.store);
    s.store.read = (t) => {
      reads++;
      return read(t);
    };
    const ctx = createCtx(s);
    ctx.m.families();
    ctx.m.familyForEmail('a@example.com');
    ctx.m.familyById('f1');
    expect(reads).toBe(1);
    ctx.db.update('Families', 2, { Status: 'Pending' });
    expect(ctx.m.familyById('F1')?.status).toBe('Pending');
    expect(reads).toBe(1); // patched in place, no re-read
    ctx.db.append('Families', [{ FamilyID: 'F2', Email: 'b@example.com' }]);
    expect(ctx.m.familyForEmail('b@example.com')?.id).toBe('F2');
    expect(reads).toBe(2);
  });

  it('prefers Active over Pending over Inactive households for an email', () => {
    const s = createMemoryServices({
      db: {
        tables: {
          Families: [
            { FamilyID: 'F1', Email: 'a@example.com', Status: 'Inactive' },
            { FamilyID: 'F2', 'Parent 2 Email': 'A@example.com', Status: 'Pending' },
            { FamilyID: 'F3', Email: 'a@example.com', Status: 'Active' },
          ],
        },
      },
    });
    expect(createCtx(s).m.familyForEmail('a@example.com')?.id).toBe('F3');
  });
});
