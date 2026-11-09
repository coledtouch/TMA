/**
 * Balances and activity accounts (ARCHITECTURE.md §3 "Computations").
 *
 *   balance(student)   = Σ ledger amounts for the student (any activity)
 *   pending(student)   = Σ Pending redemption requests
 *   available(student) = max(0, balance − pending)
 *   per enrollment:  paidFromFunds = −Σ ledger amounts for that activity
 *                    paidDirect    = Σ Completed payments for that activity
 *                    pendingPayment = Σ Pending payments for that activity (still clearing)
 *                    remaining     = max(0, cost − paidFromFunds − paidDirect − pendingPayment)
 *
 * A payment still clearing isn't "paid", but it isn't owed again either: counting it in remaining
 * keeps reminders, "left to pay" and the online-payment limit from asking the family to pay twice.
 *
 * IDs are compared case-insensitively (treasurers type them by hand).
 */
import type {
  Activity,
  ActivityAccount,
  Cents,
  Enrollment,
  LedgerEntry,
  Payment,
  RedemptionRequest,
} from '../shared/types';
import { idKey } from './util';

export interface BooksInput {
  ledger: readonly LedgerEntry[];
  payments: readonly Payment[];
  redemptions: readonly RedemptionRequest[];
  enrollments: readonly Enrollment[];
  activities: readonly Activity[];
}

function pairKey(studentId: string, activityId: string): string {
  return `${idKey(studentId)}|${idKey(activityId)}`;
}

function add(map: Map<string, number>, key: string, cents: number): void {
  map.set(key, (map.get(key) ?? 0) + cents);
}

export class Books {
  private readonly balances = new Map<string, Cents>();
  private readonly pendingByStudent = new Map<string, Cents>();
  private readonly pendingByPair = new Map<string, Cents>();
  private readonly fundsByPair = new Map<string, Cents>();
  private readonly directByPair = new Map<string, Cents>();
  private readonly clearingByPair = new Map<string, Cents>();
  /** Last enrollment row wins for a (student, activity) pair; order of first appearance is kept. */
  private readonly enrollmentsByStudent = new Map<string, Map<string, Enrollment>>();
  private readonly activities = new Map<string, Activity>();

  constructor(input: BooksInput) {
    for (const a of input.activities) if (!this.activities.has(idKey(a.id))) this.activities.set(idKey(a.id), a);
    for (const row of input.ledger) {
      if (!row.studentId || !row.amountCents) continue;
      add(this.balances, idKey(row.studentId), row.amountCents);
      if (row.activityId) add(this.fundsByPair, pairKey(row.studentId, row.activityId), -row.amountCents);
    }
    for (const p of input.payments) {
      if (!p.studentId || !p.activityId) continue;
      if (p.status === 'Completed') add(this.directByPair, pairKey(p.studentId, p.activityId), p.amountCents);
      else if (p.status === 'Pending') add(this.clearingByPair, pairKey(p.studentId, p.activityId), p.amountCents);
    }
    for (const r of input.redemptions) {
      if (r.status !== 'Pending' || !r.studentId) continue;
      add(this.pendingByStudent, idKey(r.studentId), r.amountCents);
      if (r.activityId) add(this.pendingByPair, pairKey(r.studentId, r.activityId), r.amountCents);
    }
    for (const e of input.enrollments) {
      const key = idKey(e.studentId);
      let byActivity = this.enrollmentsByStudent.get(key);
      if (!byActivity) {
        byActivity = new Map();
        this.enrollmentsByStudent.set(key, byActivity);
      }
      byActivity.set(idKey(e.activityId), e);
    }
  }

  /** Student keys (idKey) that have ledger rows. */
  ledgerStudentKeys(): string[] {
    return Array.from(this.balances.keys());
  }

  balance(studentId: string): Cents {
    return this.balances.get(idKey(studentId)) ?? 0;
  }

  pending(studentId: string): Cents {
    return this.pendingByStudent.get(idKey(studentId)) ?? 0;
  }

  available(studentId: string): Cents {
    return Math.max(0, this.balance(studentId) - this.pending(studentId));
  }

  pendingFor(studentId: string, activityId: string): Cents {
    return this.pendingByPair.get(pairKey(studentId, activityId)) ?? 0;
  }

  enrollment(studentId: string, activityId: string): Enrollment | null {
    return this.enrollmentsByStudent.get(idKey(studentId))?.get(idKey(activityId)) ?? null;
  }

  /** The account for one enrollment (any status), or null when not enrolled / unknown activity. */
  account(studentId: string, activityId: string): ActivityAccount | null {
    const enrollment = this.enrollment(studentId, activityId);
    return enrollment ? this.toAccount(enrollment) : null;
  }

  /** Accounts shown to the family: Going/Waitlist, plus Withdrawn when something was paid. Open first. */
  accounts(studentId: string): ActivityAccount[] {
    const byActivity = this.enrollmentsByStudent.get(idKey(studentId));
    if (!byActivity) return [];
    const out: ActivityAccount[] = [];
    byActivity.forEach((enrollment) => {
      const account = this.toAccount(enrollment);
      if (!account) return;
      if (account.enrollmentStatus === 'Withdrawn' && account.paidCents <= 0) return;
      out.push(account);
    });
    const open = out.filter((a) => a.activityOpen);
    const closed = out.filter((a) => !a.activityOpen);
    return open.concat(closed);
  }

  private toAccount(enrollment: Enrollment): ActivityAccount | null {
    const activity = this.activities.get(idKey(enrollment.activityId));
    if (!activity) return null;
    const pair = pairKey(enrollment.studentId, activity.id);
    const paidFromFunds = this.fundsByPair.get(pair) ?? 0;
    const paidDirect = this.directByPair.get(pair) ?? 0;
    const paid = paidFromFunds + paidDirect;
    const clearing = Math.max(0, this.clearingByPair.get(pair) ?? 0);
    const account: ActivityAccount = {
      studentId: enrollment.studentId,
      activityId: activity.id,
      activityName: activity.name,
      kind: activity.kind,
      enrollmentStatus: enrollment.status,
      costCents: enrollment.costCents,
      paidFromFundsCents: paidFromFunds,
      paidDirectCents: paidDirect,
      paidCents: paid,
      pendingRedemptionCents: this.pendingByPair.get(pair) ?? 0,
      pendingPaymentCents: clearing,
      remainingCents: Math.max(0, enrollment.costCents - paid - clearing),
      allowFunds: activity.allowFunds,
      allowOnlinePayment: activity.allowOnlinePayment,
      activityOpen: activity.status === 'Open',
    };
    if (activity.dueDate) account.dueDate = activity.dueDate;
    if (activity.depositCents) account.depositCents = activity.depositCents;
    if (activity.depositDueDate) account.depositDueDate = activity.depositDueDate;
    return account;
  }
}

export function computeBooks(input: BooksInput): Books {
  return new Books(input);
}
