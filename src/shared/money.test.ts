import { describe, expect, it } from 'vitest';
import {
  centsToDollars,
  dollarsToCents,
  formatCents,
  grossUpCents,
  parseAmountInput,
  processorFeeCents,
} from './money';

describe('dollarsToCents', () => {
  it.each([
    [50, 5000],
    [50.5, 5050],
    [0.1 + 0.2, 30],
    ['1,250.50', 125050],
    ['$25', 2500],
    ['(25.00)', -2500],
    ['-12.34', -1234],
    ['', 0],
    [null, 0],
    ['abc', 0],
    [Number.NaN, 0],
  ])('%s -> %s', (input, expected) => {
    expect(dollarsToCents(input)).toBe(expected);
  });
});

describe('formatCents', () => {
  it('formats with thousands separators and sign', () => {
    expect(formatCents(123456)).toBe('$1,234.56');
    expect(formatCents(-500)).toBe('-$5.00');
    expect(formatCents(5000, { sign: true })).toBe('+$50.00');
    expect(formatCents(0)).toBe('$0.00');
  });
  it('round-trips through dollars', () => {
    expect(centsToDollars(dollarsToCents('19.99'))).toBe(19.99);
  });
});

describe('grossUpCents', () => {
  it('covers the PayPal confirmed-charity fee so the org nets the full amount', () => {
    const { grossCents, feeCents } = grossUpCents(10000, 1.99, 49);
    expect(grossCents).toBe(10254);
    expect(feeCents).toBe(254);
    expect(grossCents - processorFeeCents(grossCents, 1.99, 49)).toBeGreaterThanOrEqual(10000);
  });

  it('is minimal and always nets at least the amount', () => {
    for (let amount = 100; amount <= 300000; amount += 997) {
      for (const [pct, fixed] of [
        [1.99, 49],
        [2.89, 49],
        [3.49, 49],
        [1.9, 10],
      ] as const) {
        const { grossCents } = grossUpCents(amount, pct, fixed);
        expect(grossCents - processorFeeCents(grossCents, pct, fixed)).toBeGreaterThanOrEqual(amount);
        expect(grossCents - 1 - processorFeeCents(grossCents - 1, pct, fixed)).toBeLessThan(amount);
      }
    }
  });

  it('handles zero fee and zero amount', () => {
    expect(grossUpCents(5000, 0, 0)).toEqual({ grossCents: 5000, feeCents: 0 });
    expect(grossUpCents(0, 1.99, 49)).toEqual({ grossCents: 0, feeCents: 0 });
  });
});

describe('parseAmountInput', () => {
  it.each([
    ['125', 12500],
    ['125.5', 12550],
    ['$1,125.50', 112550],
    ['1,250', 125000],
    ['12,345,678.9', 1234567890],
    // A decimal comma (phone keypads in many regions) is never read as a thousands separator.
    ['12,50', 1250],
    ['1,5', 150],
    ['200,00', 20000],
    ['$ 12,5', 1250],
    ['1,2345', null],
    ['1,25.00', null],
    ['1.250,00', null],
    ['12,', null],
    ['0.01', 1],
    ['12.345', null],
    ['-5', null],
    ['abc', null],
    ['', null],
  ])('%s -> %s', (input, expected) => {
    expect(parseAmountInput(input)).toBe(expected);
  });
});
