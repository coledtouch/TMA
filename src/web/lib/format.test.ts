import { describe, expect, it } from 'vitest';
import { makeAccount } from '../test/fixtures';
import {
  accountStatus,
  audienceSummary,
  centsToInput,
  daysUntil,
  duePhrase,
  formatDate,
  gradeLabel,
  maxRedeemableCents,
  nextDue,
  parseIsoDate,
  safeHref,
  toIsoDate,
} from './format';

const NOW = new Date(2026, 9, 21, 9, 30); // Oct 21, 2026 local

function plusDays(days: number): string {
  const d = new Date(NOW);
  d.setDate(d.getDate() + days);
  return toIsoDate(d);
}

describe('dates', () => {
  it('parses calendar dates without timezone drift', () => {
    const d = parseIsoDate('2027-02-01');
    expect(d?.getFullYear()).toBe(2027);
    expect(d?.getMonth()).toBe(1);
    expect(d?.getDate()).toBe(1);
    expect(parseIsoDate('nope')).toBeNull();
  });

  it('formats dates, adding the year only when it differs', () => {
    expect(formatDate('2026-11-05', NOW)).toBe('Nov 5');
    expect(formatDate('2027-02-01', NOW)).toBe('Feb 1, 2027');
    expect(formatDate('', NOW)).toBe('');
  });

  it('counts whole days', () => {
    expect(daysUntil(plusDays(0), NOW)).toBe(0);
    expect(daysUntil(plusDays(7), NOW)).toBe(7);
    expect(daysUntil(plusDays(-2), NOW)).toBe(-2);
  });
});

describe('labels', () => {
  it('formats grades', () => {
    expect(gradeLabel('K')).toBe('Kindergarten');
    expect(gradeLabel('11')).toBe('Grade 11');
  });

  it('summarizes audiences', () => {
    expect(audienceSummary({ schools: [], ensembles: [] })).toBe('Everyone');
    expect(audienceSummary({ schools: ['High School'], ensembles: ['Chorus'] })).toBe('High School, Chorus');
  });

  it('only allows http(s) links', () => {
    expect(safeHref('https://example.org/x')).toBe('https://example.org/x');
    expect(safeHref('javascript:alert(1)')).toBeNull();
    expect(safeHref(undefined)).toBeNull();
  });

  it('formats amounts for inputs', () => {
    expect(centsToInput(105000)).toBe('1050.00');
    expect(centsToInput(1)).toBe('0.01');
    expect(centsToInput(-5)).toBe('0.00');
  });
});

describe('activity accounts', () => {
  it('points at the deposit until it is paid, then the final payment', () => {
    const unpaid = makeAccount({
      paidCents: 0,
      paidDirectCents: 0,
      paidFromFundsCents: 0,
      remainingCents: 185000,
      depositCents: 35000,
      depositDueDate: plusDays(10),
      dueDate: plusDays(100),
    });
    expect(nextDue(unpaid, NOW)).toEqual({ label: 'Deposit', date: plusDays(10), amountCents: 35000, days: 10 });
    expect(accountStatus(unpaid, NOW)).toBe('due-soon');

    const depositPaid = { ...unpaid, paidCents: 35000, remainingCents: 150000 };
    expect(nextDue(depositPaid, NOW)).toMatchObject({ label: 'Final payment', amountCents: 150000, days: 100 });
    expect(accountStatus(depositPaid, NOW)).toBe('open');
  });

  it('reports paid and overdue', () => {
    expect(accountStatus(makeAccount({ remainingCents: 0 }), NOW)).toBe('paid');
    const late = makeAccount({ depositCents: undefined, depositDueDate: undefined, dueDate: plusDays(-3) });
    expect(accountStatus(late, NOW)).toBe('overdue');
    expect(duePhrase(nextDue(late, NOW)!, NOW)).toMatch(/^was due/);
  });

  it('describes due dates in plain words', () => {
    const acc = makeAccount({ depositCents: undefined, depositDueDate: undefined });
    expect(duePhrase(nextDue({ ...acc, dueDate: plusDays(0) }, NOW)!, NOW)).toBe('due today');
    expect(duePhrase(nextDue({ ...acc, dueDate: plusDays(1) }, NOW)!, NOW)).toBe('due tomorrow');
    expect(duePhrase(nextDue({ ...acc, dueDate: plusDays(5) }, NOW)!, NOW)).toBe('due in 5 days');
  });

  it('caps redeemable funds by available funds and what is left after pending requests', () => {
    const acc = makeAccount({ remainingCents: 130000, pendingRedemptionCents: 20000 });
    expect(maxRedeemableCents(acc, 64000)).toBe(64000);
    expect(maxRedeemableCents(acc, 500000)).toBe(110000);
    expect(maxRedeemableCents(makeAccount({ remainingCents: 1000, pendingRedemptionCents: 2000 }), 5000)).toBe(0);
  });
});
