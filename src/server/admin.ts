/**
 * Treasurer/board actions: overview, household review (with linking to the
 * treasurer's existing student records), and announcements.
 */
import type {
  AdminOverview,
  Announcement,
  DeliveryCounts,
  Family,
  NotificationChannel,
  PendingHousehold,
  PendingRedemptionView,
  StudentMatchCandidate,
} from '../shared/types';
import type { Ctx } from './context';
import {
  studentName,
  toAnnouncement,
  toFamily,
  toRedemption,
  toStudent,
  type FamilyRec,
  type StudentRec,
} from './data';
import { badRequest, conflict, notFound } from './errors';
import { announcementNotice, householdVerifiedNotice } from './messages';
import { allRecipients, deliver, notifyFamily } from './notify';
import { CHANNELS } from './prefs';
import type { RowData } from './services';
import { canonical, hex8, idKey, isKnown, joinList, lettersOnly, normalizeGrade } from './util';
import * as v from './validate';

const MAX_CANDIDATES = 3;
const MAX_PENDING_HOUSEHOLDS = 100;
const MAX_PENDING_REDEMPTIONS = 200;
const RECENT_LOG = 50;

// ---------------------------------------------------------------------------
// Match candidates (§5.3)
// ---------------------------------------------------------------------------

/**
 * Treasurer records (Active, not in this household) that may be the same child as a
 * self-registered Pending student. Last name must match (letters only); +0.3 for
 * the same first name (+0.2 when one is a prefix of the other); +0.1 for the same grade.
 */
export function matchCandidates(ctx: Ctx, family: FamilyRec, pending: StudentRec): StudentMatchCandidate[] {
  const last = lettersOnly(pending.lastName);
  if (!last) return [];
  const first = lettersOnly(pending.firstName);
  const grade = normalizeGrade(pending.grade);
  const books = ctx.m.books();
  const out: StudentMatchCandidate[] = [];
  for (const s of ctx.m.students()) {
    if (s.status !== 'Active' || idKey(s.id) === idKey(pending.id)) continue;
    if (s.familyId !== null && idKey(s.familyId) === idKey(family.id)) continue;
    if (lettersOnly(s.lastName) !== last) continue;
    let score = 0.6;
    const otherFirst = lettersOnly(s.firstName);
    if (first && otherFirst === first) score += 0.3;
    else if (first && otherFirst && (otherFirst.startsWith(first) || first.startsWith(otherFirst))) score += 0.2;
    if (grade && normalizeGrade(s.grade) === grade) score += 0.1;
    out.push({
      studentId: s.id,
      name: studentName(s),
      grade: s.grade,
      school: s.school,
      familyId: s.familyId,
      balanceCents: books.balance(s.id),
      score: Math.round(score * 100) / 100,
    });
  }
  return out
    .filter((c) => c.score >= 0.6)
    .sort((a, b) => b.score - a.score || b.balanceCents - a.balanceCents)
    .slice(0, MAX_CANDIDATES);
}

// ---------------------------------------------------------------------------
// admin.overview
// ---------------------------------------------------------------------------

export function adminOverview(ctx: Ctx): AdminOverview {
  const m = ctx.m;
  const books = m.books();
  const families = m.families();
  const students = m.students().filter((s) => s.status !== 'Inactive');

  let totalFunds = 0;
  for (const s of m.students()) totalFunds += books.balance(s.id);
  // Funds recorded for IDs that have no Students row still belong to TMA's earmarked total.
  const known = new Set(m.students().map((s) => idKey(s.id)));
  for (const key of books.ledgerStudentKeys()) if (!known.has(key)) totalFunds += books.balance(key);

  let emailQuota = 0;
  let emailRelay: { from: string; backupRemaining: number } | null = null;
  try {
    emailQuota = ctx.s.mailer.remainingQuota();
    emailRelay = ctx.s.mailer.relayStatus?.() ?? null;
  } catch (err) {
    ctx.s.logger.error('remainingQuota failed', err);
  }

  const pendingRedemptions: PendingRedemptionView[] = m
    .redemptions()
    .filter((r) => r.status === 'Pending')
    .sort((a, b) => (a.requestedAt === b.requestedAt ? a.row - b.row : a.requestedAt < b.requestedAt ? -1 : 1))
    .slice(0, MAX_PENDING_REDEMPTIONS)
    .map((r) => {
      const student = m.studentById(r.studentId);
      const activity = m.activityById(r.activityId);
      return {
        ...toRedemption(r),
        studentName: student ? studentName(student) : r.studentId,
        activityName: activity?.name ?? r.activityId,
        availableCents: Math.max(0, books.balance(r.studentId) - (books.pending(r.studentId) - r.amountCents)),
        remainingCents: books.account(r.studentId, r.activityId)?.remainingCents ?? 0,
      };
    });

  const pendingHouseholds: PendingHousehold[] = [];
  for (const f of families) {
    if (f.status === 'Inactive') continue;
    const pendingStudents = m.studentsOfFamily(f.id).filter((s) => s.status === 'Pending');
    if (f.status !== 'Pending' && pendingStudents.length === 0) continue;
    pendingHouseholds.push({
      family: toFamily(f),
      students: pendingStudents.map((s) => ({ student: toStudent(s), candidates: matchCandidates(ctx, f, s) })),
    });
    if (pendingHouseholds.length >= MAX_PENDING_HOUSEHOLDS) break;
  }

  const log = m.logEntries();
  const recentLog = log
    .slice(Math.max(0, log.length - RECENT_LOG))
    .reverse()
    .map((l) => ({ at: l.at, kind: l.kind, detail: l.detail }));

  return {
    stats: {
      families: families.filter((f) => f.status !== 'Inactive').length,
      activeFamilies: families.filter((f) => f.status === 'Active').length,
      pendingFamilies: families.filter((f) => f.status === 'Pending').length,
      students: students.length,
      totalFundsCents: totalFunds,
      pushDevices: m.devices().length,
      emailQuotaRemaining: emailQuota,
      // The Worker's allowance says nothing useful; what matters is how much Gmail can still cover.
      ...(emailRelay ? { emailFrom: emailRelay.from, emailBackupRemaining: emailRelay.backupRemaining } : {}),
    },
    pendingRedemptions,
    pendingHouseholds,
    recentLog,
  };
}

// ---------------------------------------------------------------------------
// admin.reviewHousehold
// ---------------------------------------------------------------------------

interface Link {
  pending: StudentRec;
  existing: StudentRec;
}

/** Fill blank treasurer fields from what the parent entered (never overwrite). */
function fillBlanks(existing: StudentRec, pending: StudentRec): RowData {
  const patch: RowData = {};
  if (!existing.grade && pending.grade) patch.Grade = pending.grade;
  if (!existing.school && pending.school) patch.School = pending.school;
  if (existing.ensembles.length === 0 && pending.ensembles.length > 0) patch.Ensembles = joinList(pending.ensembles);
  if (!existing.instrument && pending.instrument) patch.Instrument = pending.instrument;
  return patch;
}

export function reviewHousehold(ctx: Ctx, adminEmail: string, params: v.Params): { family: Family } {
  const familyId = v.id(params.familyId, 'Household');
  const decision = v.oneOf(params.decision, 'Decision', ['approve', 'reject'] as const);
  const family = ctx.m.familyById(familyId);
  if (!family) notFound('Household not found.');

  const pending = ctx.m.studentsOfFamily(family.id).filter((s) => s.status === 'Pending');

  if (decision === 'reject') {
    if (family.status === 'Pending') ctx.db.update('Families', family.row, { Status: 'Inactive' });
    for (const s of pending) ctx.db.update('Students', s.row, { Status: 'Inactive' });
    ctx.log(
      'review',
      family.status === 'Pending'
        ? `${family.id} rejected by ${adminEmail}`
        : `${family.id}: ${pending.length} pending student(s) rejected by ${adminEmail}; household stays ${family.status}`,
    );
    return { family: toFamily(ctx.m.familyById(family.id) ?? family) };
  }

  // Validate every link before writing anything.
  const links: Link[] = [];
  const seenPending = new Set<string>();
  const seenExisting = new Set<string>();
  for (const [i, raw] of v.list(params.links, 'Links', 8).entries()) {
    const link = v.obj(raw, `Link ${i + 1}`);
    const pendingId = v.id(link.pendingStudentId, 'Pending student');
    const existingId = v.id(link.existingStudentId, 'Existing student');
    const p = pending.find((s) => idKey(s.id) === idKey(pendingId));
    if (!p) badRequest(`${pendingId} is not a pending student of ${family.id}.`);
    const existing = ctx.m.studentById(existingId);
    if (!existing || existing.status !== 'Active') badRequest(`${existingId} is not an active student record.`);
    if (existing.familyId !== null && idKey(existing.familyId) === idKey(family.id)) {
      badRequest(`${existing.id} is already in this household.`);
    }
    const owner = ctx.m.familyById(existing.familyId);
    if (owner && owner.status !== 'Inactive' && idKey(owner.id) !== idKey(family.id)) {
      conflict(`${existing.id} already belongs to household ${owner.id}. Fix it in the sheet if the student moved.`);
    }
    if (seenPending.has(idKey(p.id)) || seenExisting.has(idKey(existing.id))) badRequest('Each student can be linked once.');
    seenPending.add(idKey(p.id));
    seenExisting.add(idKey(existing.id));
    links.push({ pending: p, existing });
  }

  const changed = family.status !== 'Active' || pending.length > 0;
  if (family.status !== 'Active') ctx.db.update('Families', family.row, { Status: 'Active' });
  for (const { pending: p, existing } of links) {
    ctx.db.update('Students', existing.row, { FamilyID: family.id, Status: 'Active', ...fillBlanks(existing, p) });
    ctx.db.update('Students', p.row, { Status: 'Inactive' });
    ctx.log('review', `${p.id} (${studentName(p)}) merged into ${existing.id} for ${family.id}`);
  }
  for (const s of pending) {
    if (!seenPending.has(idKey(s.id))) ctx.db.update('Students', s.row, { Status: 'Active' });
  }
  ctx.log('review', `${family.id} approved by ${adminEmail}`);

  const updated = ctx.m.familyById(family.id) ?? family;
  if (changed) notifyFamily(ctx, updated, householdVerifiedNotice(family.id));
  return { family: toFamily(updated) };
}

// ---------------------------------------------------------------------------
// admin.announce
// ---------------------------------------------------------------------------

function audienceList(value: unknown, label: string, known: readonly string[]): string[] {
  const out: string[] = [];
  for (const item of v.list(value, label, Math.max(known.length, 1))) {
    if (typeof item !== 'string' || !isKnown(item, known)) badRequest(`${label}: "${String(item)}" is not in Settings.`);
    const name = canonical(item, known);
    if (!out.includes(name)) out.push(name);
  }
  return out;
}

export function newAnnouncementId(ctx: Ctx): string {
  const taken = new Set(ctx.m.announcements().map((a) => idKey(a.id)));
  for (let i = 0; i < 5; i++) {
    const id = `A-${hex8(ctx.s.crypto.uuid())}`;
    if (!taken.has(idKey(id))) return id;
  }
  throw new Error('Could not generate a unique announcement ID');
}

export function announce(ctx: Ctx, adminEmail: string, params: v.Params): { announcement: Announcement; delivered: DeliveryCounts } {
  const settings = ctx.m.settings().pub;
  const title = v.text(params.title, 'Title', v.LIMITS.title);
  const body = v.text(params.body, 'Message', v.LIMITS.body, { multiline: true });
  const audienceIn = v.obj(params.audience ?? {}, 'Audience');
  const audience = {
    schools: audienceList(audienceIn.schools, 'Schools', settings.schools),
    ensembles: audienceList(audienceIn.ensembles, 'Groups', settings.ensembles),
  };
  const channelsIn = v.obj(params.channels, 'Channels');
  const channels = {} as Record<NotificationChannel, boolean>;
  for (const c of CHANNELS) channels[c] = v.bool(channelsIn[c], `Channel ${c}`, false);
  if (!CHANNELS.some((c) => channels[c])) badRequest('Choose at least one way to send it.');
  const link = v.optUrl(params.link, 'Link');

  const id = newAnnouncementId(ctx);
  ctx.db.append('Announcements', [
    {
      ID: id,
      Date: ctx.today,
      Title: title,
      Body: body,
      Schools: joinList(audience.schools),
      Ensembles: joinList(audience.ensembles),
      Link: link ?? '',
      Sent: ctx.now,
    },
  ]);
  ctx.log('announce', `${id} "${title}" by ${adminEmail}`);
  const delivered = deliver(ctx, allRecipients(ctx), announcementNotice({ id, title, body, audience, link }), { channels });

  const saved = ctx.m.announcements().find((a) => a.id === id);
  if (!saved) throw new Error(`Announcement ${id} was not saved`);
  return { announcement: toAnnouncement(saved), delivered };
}
