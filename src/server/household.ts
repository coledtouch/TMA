/**
 * household.save (ARCHITECTURE.md §5.2): self-service sign-up and profile edits.
 * New households and new students start Pending until TMA reviews them.
 */
import type { Bootstrap, Guardian, HouseholdStudentInput } from '../shared/types';
import { guardianNames } from './access';
import { buildBootstrap } from './bootstrap';
import type { Ctx } from './context';
import { rateLimit } from './context';
import { studentName, type FamilyRec, type StudentRec } from './data';
import { badRequest, conflict, forbidden, notFound } from './errors';
import { newSignupNotice, newStudentsNotice } from './messages';
import { notifyAdmins } from './notify';
import type { RowData } from './services';
import type { AppSettings } from './settings';
import { canonical, cleanText, GRADES, idKey, isKnown, joinList, nextSequentialId, normalizeGrade, uniqueBy } from './util';
import * as v from './validate';

const MAX_GUARDIANS = 2;
const MAX_INPUT_STUDENTS = 8;
/** Cap on non-Inactive students per household, so repeated saves can't grow it without bound. */
const MAX_HOUSEHOLD_STUDENTS = 10;
const PHONE_RE = /^[0-9 ()+\-.]{7,20}$/;

interface GuardianInput extends Guardian {
  /** Whether the phone property was sent at all (absent = keep the stored phone). */
  phoneGiven: boolean;
}

interface StudentInput extends HouseholdStudentInput {
  instrumentGiven: boolean;
}

function parseGuardian(value: unknown, index: number): GuardianInput {
  const label = index === 0 ? 'Guardian' : 'Second guardian';
  const g = v.obj(value, label);
  const out: GuardianInput = {
    name: v.text(g.name, `${label} name`, v.LIMITS.name),
    email: v.email(g.email, `${label} email`),
    phoneGiven: g.phone !== undefined && g.phone !== null,
  };
  const phone = v.optText(g.phone, `${label} phone`, 20);
  if (phone) {
    if (!PHONE_RE.test(phone) || phone.replace(/\D/g, '').length < 7) {
      badRequest(`${label} phone should be a phone number like 603-555-0123.`);
    }
    out.phone = phone;
  }
  return out;
}

function parseStudent(value: unknown, index: number, settings: AppSettings): StudentInput {
  const label = `Student ${index + 1}`;
  const s = v.obj(value, label);
  const grade = normalizeGrade(typeof s.grade === 'string' || typeof s.grade === 'number' ? cleanText(String(s.grade)) : '');
  if (!GRADES.includes(grade)) badRequest(`${label}: choose a grade (K or 1–12).`);
  const school = typeof s.school === 'string' ? cleanText(s.school) : '';
  if (!isKnown(school, settings.pub.schools)) badRequest(`${label}: choose a school from the list.`);
  const ensembles = v.list(s.ensembles, `${label} groups`, settings.pub.ensembles.length || 10).map((e) => {
    if (typeof e !== 'string' || !isKnown(e, settings.pub.ensembles)) badRequest(`${label}: choose groups from the list.`);
    return canonical(cleanText(e as string), settings.pub.ensembles);
  });
  const out: StudentInput = {
    firstName: v.text(s.firstName, `${label} first name`, v.LIMITS.studentName),
    lastName: v.text(s.lastName, `${label} last name`, v.LIMITS.studentName),
    grade,
    school: canonical(school, settings.pub.schools),
    ensembles: uniqueBy(ensembles, (e) => e),
    instrumentGiven: s.instrument !== undefined && s.instrument !== null,
  };
  const instrument = v.optText(s.instrument, `${label} instrument`, v.LIMITS.instrument);
  if (instrument) out.instrument = instrument;
  if (s.id !== undefined && s.id !== null && s.id !== '') out.id = v.id(s.id, `${label} ID`);
  return out;
}

function parseInput(params: v.Params, settings: AppSettings): { guardians: GuardianInput[]; students: StudentInput[] } {
  const guardians = v.list(params.guardians, 'Guardians', MAX_GUARDIANS, 1).map(parseGuardian);
  if (guardians.length === 2 && guardians[0].email === guardians[1].email) {
    badRequest('The two guardians need different email addresses.');
  }
  const students = v.list(params.students, 'Students', MAX_INPUT_STUDENTS).map((s, i) => parseStudent(s, i, settings));
  const ids = students.filter((s) => s.id).map((s) => idKey(s.id));
  if (new Set(ids).size !== ids.length) badRequest('The same student appears twice.');
  return { guardians, students };
}

function studentRow(id: string, familyId: string, s: StudentInput): RowData {
  return {
    StudentID: id,
    FamilyID: familyId,
    'First Name': s.firstName,
    'Last Name': s.lastName,
    Grade: s.grade,
    School: s.school,
    Ensembles: joinList(s.ensembles),
    Instrument: s.instrument ?? '',
    Status: 'Pending',
  };
}

/** Another non-Inactive household already lists this email. */
function emailTaken(ctx: Ctx, email: string, exceptFamilyId?: string): boolean {
  return ctx.m
    .familiesWithEmail(email)
    .some((f) => f.status !== 'Inactive' && (exceptFamilyId === undefined || idKey(f.id) !== idKey(exceptFamilyId)));
}

const TAKEN_MESSAGE = 'That email is already on a TMA household. Sign in with it or contact TMA.';

export function saveHousehold(ctx: Ctx, email: string, params: v.Params): Bootstrap {
  rateLimit(ctx, `hh-rl:${email}`, 30, 3600, 'Too many changes in a short time. Please try again later.');
  const settings = ctx.m.settings();
  const input = parseInput(params, settings);
  if (!input.guardians.some((g) => g.email === email)) {
    badRequest('Your own email must be one of the guardians.');
  }
  const family = ctx.m.familyForEmail(email);
  if (!family) createHousehold(ctx, email, input);
  else if (family.status === 'Inactive') forbidden('This household is inactive. Please contact TMA.');
  else updateHousehold(ctx, email, family, input);
  return buildBootstrap(ctx, email);
}

function createHousehold(ctx: Ctx, email: string, input: { guardians: GuardianInput[]; students: StudentInput[] }): void {
  for (const g of input.guardians) if (emailTaken(ctx, g.email)) conflict(TAKEN_MESSAGE);

  const familyId = nextSequentialId('F', ctx.m.families().map((f) => f.id));
  // The person signing up is the first guardian, who may later change the second one.
  const [g1, g2] = input.guardians.slice().sort((a, b) => Number(b.email === email) - Number(a.email === email));
  ctx.db.append('Families', [
    {
      FamilyID: familyId,
      'Parent Name': g1.name,
      Email: g1.email,
      Phone: g1.phone ?? '',
      'Parent 2 Name': g2?.name ?? '',
      'Parent 2 Email': g2?.email ?? '',
      'Parent 2 Phone': g2?.phone ?? '',
      Status: 'Pending',
      Member: false,
      Created: ctx.now,
    },
  ]);

  const ids = newStudentIds(ctx, input.students.length);
  ctx.db.append(
    'Students',
    input.students.map((s, i) => studentRow(ids[i], familyId, s)),
  );

  const names = [g1, g2].filter((g): g is GuardianInput => g !== undefined).map((g) => g.name).join(' & ');
  ctx.log('signup', `${familyId}: ${names} signed up with ${input.students.length} student(s)`);
  notifyAdmins(ctx, newSignupNotice(names, input.students.length, familyId));
}

function newStudentIds(ctx: Ctx, count: number): string[] {
  const existing = ctx.m.students().map((s) => s.id);
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const id = nextSequentialId('S', existing.concat(ids));
    ids.push(id);
  }
  return ids;
}

/** Fit the submitted guardians into the two stored slots (see §5.2). */
function assignGuardians(email: string, family: FamilyRec, guardians: GuardianInput[]): [GuardianInput | null, GuardianInput | null] {
  const [e1, e2] = [family.slots[0].email, family.slots[1].email];
  const byEmail = new Map(guardians.map((g) => [g.email, g] as const));
  if (e1 && !byEmail.has(e1)) {
    badRequest("The first guardian on this household can't be removed in the app. Please contact TMA.");
  }
  let slot1: GuardianInput | null = e1 ? (byEmail.get(e1) ?? null) : null;
  let slot2: GuardianInput | null = e2 && byEmail.has(e2) ? (byEmail.get(e2) ?? null) : null;
  const callerIsFirst = e1 !== '' && email === e1;
  for (const g of guardians) {
    if (g === slot1 || g === slot2) continue;
    if (!slot1) slot1 = g;
    else if (!slot2 && (callerIsFirst || !e2)) slot2 = g;
    else badRequest('Only the first guardian can change the second guardian. Please contact TMA.');
  }
  return [slot1, slot2];
}

function updateHousehold(ctx: Ctx, email: string, family: FamilyRec, input: { guardians: GuardianInput[]; students: StudentInput[] }): void {
  // --- validate everything before writing ---
  const [slot1, slot2] = assignGuardians(email, family, input.guardians);
  const storedEmails = new Set([family.slots[0].email, family.slots[1].email].filter((e) => e !== ''));
  for (const g of [slot1, slot2]) {
    if (g && !storedEmails.has(g.email) && emailTaken(ctx, g.email, family.id)) conflict(TAKEN_MESSAGE);
  }

  const current = ctx.m.studentsOfFamily(family.id);
  const updates: Array<{ rec: StudentRec; input: StudentInput }> = [];
  const added: StudentInput[] = [];
  for (const s of input.students) {
    if (!s.id) {
      added.push(s);
      continue;
    }
    const rec = current.find((c) => idKey(c.id) === idKey(s.id));
    if (!rec) notFound("That student isn't part of your household.");
    updates.push({ rec: rec as StudentRec, input: s });
  }
  if (current.length + added.length > MAX_HOUSEHOLD_STUDENTS) {
    badRequest(`A household can have at most ${MAX_HOUSEHOLD_STUDENTS} students. Please contact TMA.`);
  }

  // --- guardians ---
  const slotPatch = (g: GuardianInput | null, stored: Guardian, names: [string, string, string]): RowData => {
    if (!g) return stored.email || stored.name ? { [names[0]]: '', [names[1]]: '', [names[2]]: '' } : {};
    const keepPhone = !g.phoneGiven && g.email === stored.email;
    return { [names[0]]: g.name, [names[1]]: g.email, [names[2]]: keepPhone ? (stored.phone ?? '') : (g.phone ?? '') };
  };
  // slot1 is null only when the stored first email is blank; then leave whatever the treasurer typed.
  const patch: RowData = {
    ...(slot1 ? slotPatch(slot1, family.slots[0], ['Parent Name', 'Email', 'Phone']) : {}),
    ...slotPatch(slot2, family.slots[1], ['Parent 2 Name', 'Parent 2 Email', 'Parent 2 Phone']),
  };
  if (Object.keys(patch).length > 0) ctx.db.update('Families', family.row, patch);
  if (slot2 && slot2.email !== family.slots[1].email) {
    ctx.log('household', `${family.id}: second guardian set to ${slot2.email} by ${email}`);
  } else if (!slot2 && family.slots[1].email) {
    ctx.log('household', `${family.id}: second guardian ${family.slots[1].email} removed by ${email}`);
  }

  // --- existing students ---
  for (const { rec, input: s } of updates) {
    const studentPatch: RowData = {
      Grade: s.grade,
      School: s.school,
      Ensembles: joinList(s.ensembles),
    };
    if (s.instrumentGiven) studentPatch.Instrument = s.instrument ?? '';
    const sameName =
      rec.firstName.toLowerCase() === s.firstName.toLowerCase() && rec.lastName.toLowerCase() === s.lastName.toLowerCase();
    if (rec.status === 'Pending') {
      studentPatch['First Name'] = s.firstName;
      studentPatch['Last Name'] = s.lastName;
    } else if (!sameName) {
      ctx.log('name-change', `${rec.id}: ${studentName(rec)} → ${s.firstName} ${s.lastName} requested by ${email} (not applied)`);
    }
    ctx.db.update('Students', rec.row, studentPatch);
  }

  // --- new students (Pending, reviewed by TMA) ---
  if (added.length > 0) {
    const ids = newStudentIds(ctx, added.length);
    ctx.db.append(
      'Students',
      added.map((s, i) => studentRow(ids[i], family.id, s)),
    );
    const names = added.map((s) => `${s.firstName} ${s.lastName}`);
    ctx.log('signup', `${family.id}: added ${names.join(', ')}`);
    const refreshed = ctx.m.familyById(family.id) ?? family;
    if (family.status === 'Active') notifyAdmins(ctx, newStudentsNotice(guardianNames(refreshed), names, family.id));
  }
}
