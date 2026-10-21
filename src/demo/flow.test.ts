// @vitest-environment jsdom
/**
 * The whole demo story at the code level, through the same client the UI uses:
 * a parent asks to use activity funds and pays online, the treasurer approves
 * the request, verifies a new household and posts an announcement, and a new
 * fundraiser credit reaches the parent's phone.
 */
import { grossUpCents } from '../shared/money';
import type { Bootstrap, StudentSummary } from '../shared/types';
import { ApiError } from '../web/api/client';
import { createDemoClient, type DemoClient, type DemoPushDetail } from './index';

const PARENT = 'parent@example.com';
const TREASURER = 'treasurer@example.com';
const ORTIZ = 'ortiz@example.com';

async function signIn(client: DemoClient, email: string): Promise<void> {
  const { sent, devCode } = await client.call('auth.requestCode', { email });
  expect(sent).toBe(true);
  expect(devCode).toMatch(/^\d{6}$/);
  const { token, expiresAt } = await client.call('auth.verifyCode', { email, code: devCode! });
  expect(Date.parse(expiresAt)).toBeGreaterThan(Date.now());
  client.setToken(token);
}

function summary(data: Bootstrap, studentId: string): StudentSummary {
  const found = data.students.find((s) => s.student.id === studentId);
  if (!found) throw new Error(`${studentId} is not in this household`);
  return found;
}

function account(data: Bootstrap, studentId: string, activityId: string) {
  const found = summary(data, studentId).activities.find((a) => a.activityId === activityId);
  if (!found) throw new Error(`${studentId} has no ${activityId} account`);
  return found;
}

let pushes: DemoPushDetail[] = [];
const onPush = (e: Event) => pushes.push((e as CustomEvent<DemoPushDetail>).detail);

beforeEach(() => {
  localStorage.clear();
  delete window.__tmaDemo;
  pushes = [];
  window.addEventListener('tma:push', onPush);
});

afterEach(() => {
  window.removeEventListener('tma:push', onPush);
});

describe('demo flow: parent → treasurer → notification', () => {
  it('runs the board walkthrough end to end', async () => {
    const client = createDemoClient({ latencyMs: [0, 0] });

    // --- Parent ---------------------------------------------------------------
    await signIn(client, PARENT);
    let home = await client.call('me.bootstrap', {});
    expect(home.me).toMatchObject({ email: PARENT, familyId: 'F0001', familyStatus: 'Active', isAdmin: false });
    const avery = summary(home, 'S0001');
    expect(avery.verified).toBe(true);
    expect(avery.availableCents).toBeGreaterThan(0);
    expect(avery.availableCents).toBe(44_000); // $640 balance − $200 pending
    const florida = account(home, 'S0001', 'FL27');
    expect(florida).toMatchObject({ costCents: 185_000, paidDirectCents: 35_000, remainingCents: 150_000 });
    expect(florida.pendingRedemptionCents).toBe(20_000);

    // Ask to apply $100 of Avery's funds to Florida.
    const { redemption } = await client.call('redemption.request', {
      studentId: 'S0001',
      activityId: 'FL27',
      amountCents: 10_000,
      note: 'Cookie dough money, please',
    });
    expect(redemption).toMatchObject({ status: 'Pending', amountCents: 10_000, email: PARENT, familyId: 'F0001' });
    home = await client.call('me.bootstrap', {});
    expect(summary(home, 'S0001').availableCents).toBe(34_000);
    expect(account(home, 'S0001', 'FL27').pendingRedemptionCents).toBe(30_000);

    // More than is available is refused with a parent-readable message.
    const tooMuch = await client
      .call('redemption.request', { studentId: 'S0001', activityId: 'FL27', amountCents: 100_000 })
      .catch((e: unknown) => e);
    expect(tooMuch).toBeInstanceOf(ApiError);
    expect((tooMuch as ApiError).code).toBe('BAD_REQUEST');

    // Pay $250 online and cover the processing fee.
    const fee = grossUpCents(25_000, home.settings.feePercent, home.settings.feeFixedCents);
    const order = await client.call('payment.createOrder', {
      studentId: 'S0001',
      activityId: 'FL27',
      amountCents: 25_000,
      coverFee: true,
    });
    expect(order.orderId).toMatch(/^DEMO-/);
    expect(order).toMatchObject({ amountCents: 25_000, feeCents: fee.feeCents, grossCents: fee.grossCents });
    expect(order.feeCents).toBeGreaterThan(0);
    const { payment } = await client.call('payment.captureOrder', { orderId: order.orderId });
    expect(payment).toMatchObject({
      studentId: 'S0001',
      activityId: 'FL27',
      amountCents: 25_000,
      feeCents: fee.feeCents,
      grossCents: fee.grossCents,
      method: 'PayPal',
      status: 'Completed',
    });
    // Capturing twice (e.g. a retried tap) records the payment once.
    const again = await client.call('payment.captureOrder', { orderId: order.orderId });
    expect(again.payment.id).toBe(payment.id);
    home = await client.call('me.bootstrap', {});
    expect(account(home, 'S0001', 'FL27').remainingCents).toBe(125_000);
    expect(home.payments.filter((p) => p.method === 'PayPal')).toHaveLength(1);
    expect(pushes.some((p) => p.to === PARENT && p.message.title.startsWith('Payment received'))).toBe(true);

    // The parent can't reach the treasurer's screens.
    const forbidden = await client.call('admin.overview', {}).catch((e: unknown) => e);
    expect((forbidden as ApiError).code).toBe('FORBIDDEN');

    // --- Treasurer ------------------------------------------------------------
    await signIn(client, TREASURER);
    const overview = await client.call('admin.overview', {});
    expect(overview.stats.pendingFamilies).toBeGreaterThanOrEqual(1);
    const requests = overview.pendingRedemptions;
    expect(requests.map((r) => r.amountCents).sort((a, b) => a - b)).toEqual([10_000, 20_000]);
    const mine = requests.find((r) => r.id === redemption.id);
    expect(mine).toMatchObject({ studentName: expect.stringContaining('Avery'), activityName: expect.stringContaining('Florida') });

    const ortiz = overview.pendingHouseholds.find((h) => h.family.id === 'F0003');
    expect(ortiz).toBeDefined();
    expect(ortiz!.family.guardians[0]).toMatchObject({ name: 'Marcus Ortiz', email: ORTIZ });
    const sofia = ortiz!.students.find((s) => s.student.firstName === 'Sofia');
    expect(sofia?.student).toMatchObject({ id: 'S0006', status: 'Pending' });
    const candidate = sofia!.candidates[0];
    expect(candidate).toMatchObject({ studentId: 'S0005', familyId: null, balanceCents: 52_000 });
    expect(candidate.score).toBeGreaterThanOrEqual(0.9);

    // Approve the parent's request: funds move to Florida and the parent hears about it.
    pushes = [];
    const decided = await client.call('admin.decideRedemption', { id: redemption.id, decision: 'Approved' });
    expect(decided.redemption).toMatchObject({ status: 'Approved', decidedBy: TREASURER });
    expect(pushes.find((p) => p.to === PARENT)?.message).toMatchObject({
      title: expect.stringContaining('Funds applied to Florida 2027'),
      url: '#/trips',
    });
    const twice = await client.call('admin.decideRedemption', { id: redemption.id, decision: 'Approved' }).catch((e: unknown) => e);
    expect((twice as ApiError).code).toBe('CONFLICT');

    // Verify the Ortiz household, linking Sofia to the treasurer's existing record.
    const reviewed = await client.call('admin.reviewHousehold', {
      familyId: 'F0003',
      decision: 'approve',
      links: [{ pendingStudentId: 'S0006', existingStudentId: candidate.studentId }],
    });
    expect(reviewed.family).toMatchObject({ id: 'F0003', status: 'Active' });
    const after = await client.call('admin.overview', {});
    expect(after.pendingHouseholds.some((h) => h.family.id === 'F0003')).toBe(false);
    expect(after.pendingRedemptions.map((r) => r.amountCents)).toEqual([20_000]);

    // Announce to High School families.
    const announced = await client.call('admin.announce', {
      title: 'Florida 2027 itinerary posted',
      body: 'The day-by-day itinerary is on the TMA website.',
      audience: { schools: ['High School'], ensembles: [] },
      channels: { push: true, email: true, sms: false },
    });
    expect(announced.announcement).toMatchObject({
      title: 'Florida 2027 itinerary posted',
      audience: { schools: ['High School'], ensembles: [] },
    });
    expect(announced.announcement.sentAt).toBeTruthy();
    expect(announced.delivered.push).toBeGreaterThanOrEqual(1);
    expect(announced.delivered.sms).toBe(0);

    // --- Back on the parent's phone ------------------------------------------
    pushes = [];
    const demo = client.demo;
    const report = await demo.addCredit('S0001', 5_000, 'Car Wash');
    expect(report.balanceChanges).toBe(1);
    expect(report.errors).toEqual([]);
    const credit = pushes.find((p) => p.to === PARENT);
    expect(credit?.message).toMatchObject({ title: '+$50.00 for Avery', topic: 'balance', url: '#/funds' });
    expect(credit?.message.body).toContain("$50.00 was added to Avery's TMA activity funds");
    expect(demo.outbox().some((o) => o.channel === 'email' && o.to === PARENT && o.title === '+$50.00 for Avery')).toBe(true);

    await signIn(client, PARENT);
    home = await client.call('me.bootstrap', {});
    // $640 − $100 approved + $50 credit, minus the $200 still pending.
    expect(summary(home, 'S0001')).toMatchObject({ balanceCents: 59_000, pendingCents: 20_000, availableCents: 39_000 });
    expect(account(home, 'S0001', 'FL27')).toMatchObject({ paidFromFundsCents: 10_000, remainingCents: 115_000 });
    expect(home.announcements[0].title).toBe('Florida 2027 itinerary posted');
    expect(home.ledger[0]).toMatchObject({ description: 'Car Wash', amountCents: 5_000 });

    // The verified Ortiz family now sees Sofia's existing funds, and only their own student.
    await signIn(client, ORTIZ);
    const ortizHome = await client.call('me.bootstrap', {});
    expect(ortizHome.me.familyStatus).toBe('Active');
    expect(ortizHome.students.map((s) => s.student.id)).toEqual(['S0005']);
    expect(summary(ortizHome, 'S0005')).toMatchObject({ verified: true, balanceCents: 52_000 });
    expect(ortizHome.payments).toEqual([]);
    expect(ortizHome.redemptions).toEqual([]);
  });

  it('lets a brand-new family sign up and wait for review without seeing anyone else’s money', async () => {
    const client = createDemoClient({ latencyMs: [0, 0] });
    const email = 'new.family1234@example.com';
    await signIn(client, email);
    let data = await client.call('me.bootstrap', {});
    expect(data.me).toMatchObject({ familyStatus: 'None', familyId: null });
    expect(data.students).toEqual([]);

    data = await client.call('household.save', {
      guardians: [{ name: 'Robin Avery', email }],
      students: [{ firstName: 'Avery', lastName: 'Thompson', grade: '11', school: 'High School', ensembles: ['Band'] }],
    });
    expect(data.me.familyStatus).toBe('Pending');
    const pending = data.students[0];
    expect(pending.verified).toBe(false);
    expect(pending).toMatchObject({ balanceCents: 0, availableCents: 0, activities: [] });
    expect(data.ledger).toEqual([]);

    // Pending families can't spend funds.
    const refused = await client
      .call('redemption.request', { studentId: pending.student.id, activityId: 'FL27', amountCents: 1_000 })
      .catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(ApiError);
    expect(['FORBIDDEN', 'BAD_REQUEST']).toContain((refused as ApiError).code);
  });
});
