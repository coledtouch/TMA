/**
 * me.bootstrap (ARCHITECTURE.md §5.1): everything one signed-in parent may see.
 * Money only for verified students of the caller's own household.
 */
import type { Bootstrap, StudentSummary } from '../shared/types';
import { isAdmin } from './access';
import type { Ctx } from './context';
import {
  toActivity,
  toAnnouncement,
  toEvent,
  toFamily,
  toLedgerEntry,
  toPayment,
  toRedemption,
  toStudent,
} from './data';
import { audienceMatches, prefsFor } from './prefs';
import { idKey } from './util';

const MAX_LEDGER = 200;
const MAX_PAYMENTS = 200;
const MAX_REDEMPTIONS = 200;
const MAX_NEWS = 50;

/** Newest first by date text (ISO sorts lexically), then by sheet row. */
function newestFirst<T extends { row: number }>(items: T[], date: (item: T) => string): T[] {
  return items.slice().sort((a, b) => {
    const da = date(a);
    const db = date(b);
    if (da !== db) return da < db ? 1 : -1;
    return b.row - a.row;
  });
}

export function buildBootstrap(ctx: Ctx, email: string): Bootstrap {
  const m = ctx.m;
  const settings = m.settings();
  const admin = isAdmin(ctx, email);
  const family = m.familyForEmail(email);
  const books = m.books();

  const students: StudentSummary[] = [];
  const verified = new Set<string>();
  if (family) {
    for (const s of m.studentsOfFamily(family.id)) {
      const ok = family.status === 'Active' && s.status === 'Active';
      if (ok) verified.add(idKey(s.id));
      students.push({
        student: toStudent(s),
        verified: ok,
        balanceCents: ok ? books.balance(s.id) : 0,
        pendingCents: ok ? books.pending(s.id) : 0,
        availableCents: ok ? books.available(s.id) : 0,
        activities: ok ? books.accounts(s.id) : [],
      });
    }
  }
  const mine = (studentId: string) => verified.has(idKey(studentId));

  const prefs = prefsFor(ctx, email);
  const guardian = family?.guardians.find((g) => g.email === email);

  const announcements = newestFirst(
    m.announcements().filter((a) => a.sent && (admin || audienceMatches(a.audience, prefs))),
    (a) => a.date || a.sentAt || '',
  )
    .slice(0, MAX_NEWS)
    .map(toAnnouncement);

  const events = m
    .events()
    .filter((e) => e.date >= ctx.today && audienceMatches(e.audience, prefs))
    .sort((a, b) => (a.date === b.date ? a.row - b.row : a.date < b.date ? -1 : 1))
    .slice(0, MAX_NEWS)
    .map(toEvent);

  return {
    me: {
      email,
      name: guardian?.name || email.split('@')[0],
      familyId: family ? family.id : null,
      familyStatus: family ? family.status : 'None',
      isAdmin: admin,
    },
    family: family ? toFamily(family) : null,
    students,
    ledger: newestFirst(
      m.ledger().filter((l) => mine(l.studentId)),
      (l) => l.date,
    )
      .slice(0, MAX_LEDGER)
      .map(toLedgerEntry),
    payments: newestFirst(
      m.payments().filter((p) => mine(p.studentId)),
      (p) => p.date,
    )
      .slice(0, MAX_PAYMENTS)
      .map(toPayment),
    redemptions: newestFirst(
      // Requests typed into the sheet may lack a FamilyID; never show another household's request.
      m.redemptions().filter((r) => mine(r.studentId) && (!r.familyId || idKey(r.familyId) === idKey(family?.id))),
      (r) => r.requestedAt,
    )
      .slice(0, MAX_REDEMPTIONS)
      .map(toRedemption),
    announcements,
    events,
    activities: m
      .activities()
      .filter((a) => a.status === 'Open')
      .map(toActivity),
    prefs,
    pushTokens: m.devicesFor(email).length,
    settings: { ...settings.pub, schools: settings.pub.schools.slice(), ensembles: settings.pub.ensembles.slice() },
    serverTime: ctx.now.toISOString(),
  };
}
