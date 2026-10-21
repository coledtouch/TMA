/**
 * Who is calling and what they may touch. Family membership and admin status
 * are looked up from the sheet on every request (never trusted from the token).
 */
import type { Ctx } from './context';
import type { ActivityRec, FamilyRec, StudentRec } from './data';
import { forbidden, notFound } from './errors';
import { idKey } from './util';

export function isAdmin(ctx: Ctx, email: string): boolean {
  return ctx.m.settings().adminEmails.includes(email);
}

/**
 * The caller's household. `active` additionally requires TMA to have verified it.
 * Inactive households can't do anything in the app.
 */
export function requireFamily(ctx: Ctx, email: string, opts: { active?: boolean } = {}): FamilyRec {
  const family = ctx.m.familyForEmail(email);
  if (!family) return forbidden('Set up your household in the app first.');
  if (family.status === 'Inactive') return forbidden('This household is inactive. Please contact TMA.');
  if (opts.active && family.status !== 'Active') {
    return forbidden("TMA is still verifying your household. You'll get a notification when it's ready.");
  }
  return family;
}

/** A verified (Active) student of the caller's household; NOT_FOUND hides other families' students. */
export function requireOwnStudent(ctx: Ctx, family: FamilyRec, studentId: string): StudentRec {
  const student = ctx.m.studentById(studentId);
  if (!student || student.familyId === null || idKey(student.familyId) !== idKey(family.id) || student.status === 'Inactive') {
    return notFound('Student not found.');
  }
  if (student.status !== 'Active') return forbidden('TMA is still verifying this student.');
  return student;
}

export function requireActivity(ctx: Ctx, activityId: string): ActivityRec {
  return ctx.m.activityById(activityId) ?? notFound('Activity not found.');
}

/** First name of a guardian of the family matching `email`, for messages ("Jordan Thompson asked…"). */
export function guardianName(family: FamilyRec | null, email: string): string {
  const g = family?.guardians.find((x) => x.email === email);
  return g?.name || email.split('@')[0];
}

export function guardianNames(family: FamilyRec): string {
  const names = family.guardians.map((g) => g.name || g.email.split('@')[0]).filter((n) => n !== '');
  return names.join(' & ') || family.id;
}
