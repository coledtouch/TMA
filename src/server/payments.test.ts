import { describe, expect, it } from 'vitest';
import { grossUpCents } from '../shared/money';
import { createFakePaymentGateway } from './memory';
import type { CaptureResult, PaymentGateway } from './services';
import { harness, NGUYEN, PARENT, PARENT2, TREASURER } from './test-helpers';
import { addDays } from './util';

describe('payment.createOrder', () => {
  it('creates an order for the exact amount, with the optional fee gross-up', () => {
    const gateway = createFakePaymentGateway();
    const h = harness({ payments: gateway });
    const token = h.signIn(PARENT);
    const plain = h.ok('payment.createOrder', { studentId: 'S0001', activityId: 'FL27', amountCents: 25000, coverFee: false }, token);
    expect(plain).toMatchObject({ amountCents: 25000, feeCents: 0, grossCents: 25000 });

    const covered = h.ok('payment.createOrder', { studentId: 'S0001', activityId: 'FL27', amountCents: 10000, coverFee: true }, token);
    expect(covered).toMatchObject({ amountCents: 10000, feeCents: 254, grossCents: 10254 });
    expect(covered.grossCents).toBe(grossUpCents(10000, 1.99, 49).grossCents);

    const sent = gateway.orders.get(covered.orderId);
    expect(sent).toMatchObject({
      amountCents: 10000,
      feeCents: 254,
      grossCents: 10254,
      referenceId: 'S0001:FL27',
      brandName: 'Timberlane Music Association',
      itemName: 'Florida 2027 – Disney & Universal – Avery T.',
    });
    expect(sent?.customId).toMatch(/^PO-[0-9a-f]{8}$/);
  });

  it('enforces the minimum, the remaining balance and the activity rules', () => {
    const h = harness();
    const token = h.signIn(PARENT);
    const order = (p: Record<string, unknown>) =>
      h.err('payment.createOrder', { studentId: 'S0001', activityId: 'FL27', amountCents: 10000, coverFee: false, ...p }, token);
    expect(order({ amountCents: 499 }).message).toMatch(/smallest online payment is \$5\.00/);
    expect(order({ amountCents: 150001 }).message).toMatch(/more than what's left/);
    expect(order({ amountCents: 12.5 }).code).toBe('BAD_REQUEST');
    expect(order({ coverFee: 'yes' }).code).toBe('BAD_REQUEST');
    expect(order({ studentId: 'S0003' }).code).toBe('NOT_FOUND');
    expect(order({ studentId: 'S0002' }).code).toBe('BAD_REQUEST'); // not going
    const lessons = h.err('payment.createOrder', { studentId: 'S0003', activityId: 'LESSONS', amountCents: 10000, coverFee: false }, h.signIn(NGUYEN));
    expect(lessons.message).toMatch(/can't be paid online/);
  });

  it('allows paying a final balance smaller than the minimum', () => {
    const h = harness();
    h.services.db.tables.Payments?.push({ Date: '2026-10-01', StudentID: 'S0001', ActivityID: 'CAMP27', Amount: 272, Method: 'Check', Status: 'Completed' });
    const token = h.signIn(PARENT);
    expect(h.ok('payment.createOrder', { studentId: 'S0001', activityId: 'CAMP27', amountCents: 300, coverFee: false }, token).grossCents).toBe(300);
    expect(h.err('payment.createOrder', { studentId: 'S0001', activityId: 'CAMP27', amountCents: 200, coverFee: false }, token).code).toBe(
      'BAD_REQUEST',
    );
  });

  it('answers NOT_CONFIGURED when online payments are off', () => {
    const h = harness({ settings: { ONLINE_PAYMENTS: 'FALSE' } });
    expect(
      h.err('payment.createOrder', { studentId: 'S0001', activityId: 'FL27', amountCents: 10000, coverFee: false }, h.signIn(PARENT)).code,
    ).toBe('NOT_CONFIGURED');
  });

  it('reports gateway failures as PAYMENT_FAILED', () => {
    const broken: PaymentGateway = {
      enabled: () => true,
      createOrder: () => {
        throw new Error('HTTP 500');
      },
      captureOrder: () => ({ status: 'FAILED' }),
    };
    const h = harness({ payments: broken });
    expect(
      h.err('payment.createOrder', { studentId: 'S0001', activityId: 'FL27', amountCents: 10000, coverFee: false }, h.signIn(PARENT)).code,
    ).toBe('PAYMENT_FAILED');
  });
});

describe('payment.captureOrder', () => {
  it('records the payment once and notifies the family', () => {
    const h = harness();
    const token = h.signIn(PARENT);
    const { orderId } = h.ok('payment.createOrder', { studentId: 'S0001', activityId: 'FL27', amountCents: 25000, coverFee: true }, token);
    h.clearOutbox();
    const { payment } = h.ok('payment.captureOrder', { orderId }, token);
    const { grossCents, feeCents } = grossUpCents(25000, 1.99, 49);
    expect(payment).toMatchObject({
      date: '2026-10-21',
      studentId: 'S0001',
      activityId: 'FL27',
      amountCents: 25000,
      feeCents,
      grossCents,
      method: 'PayPal',
      status: 'Completed',
      payerEmail: PARENT,
    });
    expect(payment.id).toMatch(/^DEMOCAP-/);
    const row = h.rows('Payments').pop();
    expect(row).toMatchObject({ Amount: 250, 'Fee Covered': feeCents / 100, Gross: grossCents / 100, Method: 'PayPal', Reference: payment.id, Status: 'Completed' });

    const mail = h.services.outbox.mail.filter((m) => m.subject === 'Payment received – thank you!');
    expect(mail.map((m) => m.to).sort()).toEqual([PARENT2, PARENT].sort());
    expect(mail[0].text).toContain('$250.00 toward Florida 2027 – Disney & Universal for Avery. Remaining: $1,250.00.');

    // Idempotent: a retry returns the same payment and adds nothing.
    const again = h.ok('payment.captureOrder', { orderId }, token);
    expect(again.payment.id).toBe(payment.id);
    expect(h.rows('Payments').filter((r) => r.Reference === payment.id)).toHaveLength(1);

    const fl = h.ok('me.bootstrap', {}, token).students[0].activities[0];
    expect(fl).toMatchObject({ paidDirectCents: 60000, remainingCents: 125000 });
  });

  it('only the account that started the order may capture it', () => {
    const h = harness();
    const { orderId } = h.ok('payment.createOrder', { studentId: 'S0001', activityId: 'FL27', amountCents: 25000, coverFee: false }, h.signIn(PARENT));
    expect(h.err('payment.captureOrder', { orderId }, h.signIn(PARENT2)).code).toBe('FORBIDDEN');
    expect(h.err('payment.captureOrder', { orderId }, h.signIn(TREASURER)).code).toBe('FORBIDDEN');
    expect(h.rows('Payments')).toHaveLength(1);
  });

  it('rejects unknown/expired orders and malformed ids', () => {
    const h = harness();
    const token = h.signIn(PARENT);
    expect(h.err('payment.captureOrder', { orderId: 'NOPE-123' }, token).code).toBe('NOT_FOUND');
    expect(h.err('payment.captureOrder', { orderId: '../../etc' }, token).code).toBe('BAD_REQUEST');
    const { orderId } = h.ok('payment.createOrder', { studentId: 'S0001', activityId: 'FL27', amountCents: 25000, coverFee: false }, token);
    h.services.setNow(new Date('2026-10-21T21:00:01.000Z')); // > 6 h later
    expect(h.err('payment.captureOrder', { orderId }, h.signIn(PARENT)).code).toBe('NOT_FOUND');
  });

  it('does not record a capture whose amount differs from the order', () => {
    const fake = createFakePaymentGateway();
    const tampered: PaymentGateway = {
      enabled: () => true,
      createOrder: (input) => fake.createOrder(input),
      captureOrder: (id, req): CaptureResult => ({ ...fake.captureOrder(id, req), grossCents: 100 }),
    };
    const h = harness({ payments: tampered });
    const token = h.signIn(PARENT);
    const { orderId } = h.ok('payment.createOrder', { studentId: 'S0001', activityId: 'FL27', amountCents: 25000, coverFee: false }, token);
    h.clearOutbox();
    expect(h.err('payment.captureOrder', { orderId }, token).code).toBe('PAYMENT_FAILED');
    expect(h.rows('Payments')).toHaveLength(1);
    expect(h.rows('Log').some((r) => r.Kind === 'payment-error')).toBe(true);
    expect(h.services.outbox.mail.find((m) => m.to === TREASURER)?.subject).toBe('Payment needs review');
  });

  it('declined captures fail without recording anything', () => {
    const h = harness({ payments: createFakePaymentGateway({ failCapture: true }) });
    const token = h.signIn(PARENT);
    const { orderId } = h.ok('payment.createOrder', { studentId: 'S0001', activityId: 'FL27', amountCents: 25000, coverFee: false }, token);
    expect(h.err('payment.captureOrder', { orderId }, token).code).toBe('PAYMENT_FAILED');
    expect(h.rows('Payments')).toHaveLength(1);
  });

  it('records PENDING captures as Pending: not paid yet, but not asked for again', () => {
    const fake = createFakePaymentGateway();
    const pending: PaymentGateway = {
      enabled: () => true,
      createOrder: (input) => fake.createOrder(input),
      captureOrder: (id, req): CaptureResult => ({ ...fake.captureOrder(id, req), status: 'PENDING' }),
    };
    const h = harness({ payments: pending });
    const token = h.signIn(PARENT);
    const { orderId } = h.ok('payment.createOrder', { studentId: 'S0001', activityId: 'FL27', amountCents: 150000, coverFee: false }, token);
    expect(h.ok('payment.captureOrder', { orderId }, token).payment.status).toBe('Pending');
    const fl = h.ok('me.bootstrap', {}, token).students[0].activities[0];
    expect(fl).toMatchObject({ paidDirectCents: 35000, pendingPaymentCents: 150000, remainingCents: 0 });
    // While the eCheck clears, nobody can pay the same balance again, and no reminder asks for it.
    expect(h.err('payment.createOrder', { studentId: 'S0001', activityId: 'FL27', amountCents: 150000, coverFee: false }, token).message).toMatch(
      /still being processed/,
    );
    // A week before the due date, the family that paid gets no reminder (a family that didn't, does).
    const weekBefore = new Date(`${addDays(fl.dueDate ?? '', -7)}T14:00:00.000Z`);
    const control = harness();
    control.services.setNow(weekBefore);
    control.app.dailyTick();
    expect(control.services.outbox.mail.filter((m) => m.subject === 'Florida 2027 – Disney & Universal payment due in 7 days').map((m) => m.to)).toContain(PARENT);
    h.services.setNow(weekBefore);
    h.clearOutbox();
    h.app.dailyTick();
    expect(h.services.outbox.mail.filter((m) => m.subject.includes('payment due')).map((m) => m.to)).not.toContain(PARENT);
  });

  it('does not capture an order that would overpay because someone paid in the meantime', () => {
    const gateway = createFakePaymentGateway();
    const h = harness({ payments: gateway });
    const jordan = h.signIn(PARENT);
    const casey = h.signIn(PARENT2);
    // Both guardians open "Pay online" for the full $1,500 left on Florida 2027.
    const first = h.ok('payment.createOrder', { studentId: 'S0001', activityId: 'FL27', amountCents: 150000, coverFee: false }, jordan);
    const second = h.ok('payment.createOrder', { studentId: 'S0001', activityId: 'FL27', amountCents: 150000, coverFee: false }, casey);
    h.ok('payment.captureOrder', { orderId: first.orderId }, jordan);
    let captures = 0;
    const counting = gateway.captureOrder;
    gateway.captureOrder = (id, req) => {
      captures += 1;
      return counting(id, req);
    };
    expect(h.err('payment.captureOrder', { orderId: second.orderId }, casey)).toEqual({
      code: 'PAYMENT_FAILED',
      message: expect.stringMatching(/was paid in the meantime, so this payment was stopped and you were not charged/),
    });
    expect(captures).toBe(0); // PayPal never took the second payment
    expect(h.ok('me.bootstrap', {}, jordan).students[0].activities[0]).toMatchObject({ paidDirectCents: 185000, remainingCents: 0 });
  });

  it('after an unconfirmed capture, a retry asks PayPal again and finds the payment the treasurer recorded', () => {
    const fake = createFakePaymentGateway();
    let lost = true;
    const flaky: PaymentGateway = {
      enabled: () => true,
      createOrder: (input) => fake.createOrder(input),
      captureOrder: (id, req): CaptureResult => {
        const result = fake.captureOrder(id, req); // PayPal takes the money...
        return lost ? { status: 'UNKNOWN' } : result; // ...but the first answer is lost
      },
    };
    const h = harness({ payments: flaky });
    const token = h.signIn(PARENT);
    const { orderId } = h.ok('payment.createOrder', { studentId: 'S0001', activityId: 'FL27', amountCents: 150000, coverFee: false }, token);
    expect(h.err('payment.captureOrder', { orderId }, token).code).toBe('INTERNAL');
    // From the admin alert, the treasurer finds the capture in PayPal and records it by hand.
    const captureId = fake.captureOrder(orderId, `cap-${orderId}`).captureId;
    h.services.db.tables.Payments?.push({ Date: '2026-10-21', StudentID: 'S0001', ActivityID: 'FL27', Amount: 1500, Method: 'PayPal', Reference: captureId, Status: 'Completed' });
    lost = false;
    expect(h.ok('payment.captureOrder', { orderId }, token).payment).toMatchObject({ id: captureId, amountCents: 150000 });
    expect(h.rows('Payments').filter((r) => r.Reference === captureId)).toHaveLength(1);
  });

  it('never tells the payer "not charged" when PayPal did not confirm either way', () => {
    const fake = createFakePaymentGateway();
    let outcome: 'unknown' | 'throw' | 'ok' = 'unknown';
    const flaky: PaymentGateway = {
      enabled: () => true,
      createOrder: (input) => fake.createOrder(input),
      captureOrder: (id, req): CaptureResult => {
        if (outcome === 'throw') throw new Error('Timeout: https://api-m.paypal.com/v2/checkout/orders/x/capture');
        if (outcome === 'unknown') return { status: 'UNKNOWN', message: 'PayPal did not confirm whether the payment went through.' };
        return fake.captureOrder(id, req);
      },
    };
    const h = harness({ payments: flaky });
    const token = h.signIn(PARENT);
    const { orderId } = h.ok('payment.createOrder', { studentId: 'S0001', activityId: 'FL27', amountCents: 25000, coverFee: false }, token);
    h.clearOutbox();
    for (const next of ['unknown', 'throw'] as const) {
      outcome = next;
      const error = h.err('payment.captureOrder', { orderId }, token);
      expect(error.code).not.toBe('PAYMENT_FAILED'); // the app maps anything else to "we couldn't confirm your payment"
      expect(error.message).not.toMatch(/not charged/);
      expect(error.message).toMatch(/couldn't confirm the payment/);
    }
    expect(h.rows('Payments')).toHaveLength(1);
    expect(h.rows('Log').filter((r) => r.Kind === 'payment-error').map((r) => r.Detail)).toEqual([
      expect.stringContaining(`${orderId}: PayPal did not confirm the capture of $250.00`),
      expect.stringContaining(`${orderId}: PayPal did not confirm the capture of $250.00`),
    ]);
    const alerts = h.services.outbox.mail.filter((m) => m.to === TREASURER);
    expect(alerts).toHaveLength(1); // one alert per order, however often the app asks again
    const alert = alerts[0];
    expect(alert?.subject).toBe('Payment needs review');
    expect(alert?.text).toContain(`Look up PayPal order ${orderId}`);

    // The cached order is kept, so capturing again (same PayPal-Request-Id) records it once PayPal answers.
    outcome = 'ok';
    expect(h.ok('payment.captureOrder', { orderId }, token).payment).toMatchObject({ amountCents: 25000, status: 'Completed' });
  });
});
