import type { Cents } from './types';

/** Parse a sheet/user dollar value ("50", "$1,250.50", 50.5, "(25.00)") into integer cents. */
export function dollarsToCents(value: unknown): Cents {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') {
    return Number.isFinite(value) ? Math.round(value * 100) : 0;
  }
  let s = String(value).trim();
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/[$,\s]/g, '');
  if (s.startsWith('-')) {
    negative = !negative;
    s = s.slice(1);
  }
  if (!/^\d*(\.\d+)?$/.test(s) || s === '' || s === '.') return 0;
  const cents = Math.round(parseFloat(s) * 100);
  return negative ? -cents : cents;
}

/** Cents -> sheet dollar number (2 decimals). */
export function centsToDollars(cents: Cents): number {
  return Math.round(cents) / 100;
}

/** 12345 -> "$123.45"; -500 -> "-$5.00". */
export function formatCents(cents: Cents, opts: { sign?: boolean } = {}): string {
  const abs = Math.abs(Math.round(cents));
  const dollars = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const body = `$${dollars}.${String(abs % 100).padStart(2, '0')}`;
  if (cents < 0) return `-${body}`;
  if (opts.sign && cents > 0) return `+${body}`;
  return body;
}

/** Processor fee the org pays on a charge of `grossCents` (rounded up to be safe). */
export function processorFeeCents(grossCents: Cents, feePercent: number, feeFixedCents: Cents): Cents {
  if (grossCents <= 0) return 0;
  return Math.ceil((grossCents * feePercent) / 100 - 1e-9) + feeFixedCents;
}

/**
 * Smallest charge such that, after the processor takes its fee, the org still
 * nets at least `amountCents`. Used for the optional "cover the processing
 * fee" add-on so 100% of the intended amount reaches the student's trip.
 */
export function grossUpCents(
  amountCents: Cents,
  feePercent: number,
  feeFixedCents: Cents,
): { grossCents: Cents; feeCents: Cents } {
  if (amountCents <= 0) return { grossCents: 0, feeCents: 0 };
  if (feePercent <= 0 && feeFixedCents <= 0) return { grossCents: amountCents, feeCents: 0 };
  const rate = feePercent / 100;
  let gross = Math.ceil((amountCents + feeFixedCents) / (1 - rate));
  while (gross - processorFeeCents(gross, feePercent, feeFixedCents) < amountCents) gross += 1;
  while (gross - 1 - processorFeeCents(gross - 1, feePercent, feeFixedCents) >= amountCents) gross -= 1;
  return { grossCents: gross, feeCents: gross - amountCents };
}

/**
 * Parse what a parent typed in an amount box ("125", "125.5", "$125.50", "$1,125.50") -> cents, or null
 * when invalid. A comma is a thousands separator only between groups of three digits; a single comma
 * followed by one or two digits (and no point) is a decimal comma, as phone keypads in many regions
 * offer ("12,50" is $12.50, never $1,250). Anything else with a comma is rejected rather than guessed.
 */
export function parseAmountInput(input: string): Cents | null {
  let s = input.trim().replace(/[$\s]/g, '');
  if (/^\d{1,3}(,\d{3})+(\.\d{0,2})?$/.test(s)) s = s.replace(/,/g, '');
  else if (/^\d+,\d{1,2}$/.test(s)) s = s.replace(',', '.');
  if (!/^\d+(\.\d{0,2})?$/.test(s)) return null;
  const cents = Math.round(parseFloat(s) * 100);
  return Number.isFinite(cents) ? cents : null;
}
