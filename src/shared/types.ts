/**
 * Shared domain + API types for the TMA family app.
 *
 * This file is the contract between the browser app (src/web), the in-browser
 * demo backend (src/demo) and the Google Apps Script backend (src/server +
 * src/gas). Keep it framework-free: no DOM, Node or Apps Script globals.
 *
 * Money is always integer cents (`Cents`) in code. The Google Sheet stores
 * dollars; conversion happens only in the server's sheet mappers.
 * Dates are ISO strings: `YYYY-MM-DD` for calendar dates, full ISO 8601 for
 * timestamps.
 */

export type Cents = number;
export type IsoDate = string; // YYYY-MM-DD
export type IsoDateTime = string; // 2026-10-21T13:45:00.000Z

export type FamilyId = string; // e.g. "F0001"
export type StudentId = string; // e.g. "S0001"
export type ActivityId = string; // e.g. "FL27"

/** Active = verified by TMA, Pending = self-registered awaiting review, Inactive = archived/merged/rejected. */
export type RecordStatus = 'Active' | 'Pending' | 'Inactive';

// ---------------------------------------------------------------------------
// Household
// ---------------------------------------------------------------------------

export interface Guardian {
  name: string;
  email: string; // lower-cased, trimmed
  phone?: string; // cell, optional, digits/dashes as typed
}

export interface Family {
  id: FamilyId;
  guardians: Guardian[]; // 1..2
  status: RecordStatus;
  member: boolean; // current-year TMA member
  createdAt?: IsoDateTime;
}

export interface Student {
  id: StudentId;
  familyId: FamilyId | null; // null = treasurer tracks the student but no household linked yet
  firstName: string;
  lastName: string;
  grade: string; // "3".."12" (string so "K" etc. are possible)
  school: string; // one of PublicSettings.schools
  ensembles: string[]; // subset of PublicSettings.ensembles
  instrument?: string;
  status: RecordStatus;
}

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

/**
 * One row of the treasurer's Ledger tab. Positive amounts add to the
 * student's earmarked activity funds (fundraiser credit, donation, refund);
 * negative amounts spend funds. When `activityId` is set, the amount moves
 * between the funds and that activity: a -200 row with activityId FL27 means
 * "$200 of funds applied to FL27".
 */
export interface LedgerEntry {
  id: string; // Reference if present, otherwise "L<sheet row number>"
  date: IsoDate;
  studentId: StudentId;
  type: string; // Fundraiser | Donation | Credit | Adjustment | Redemption | Refund | ...
  description: string;
  amountCents: Cents;
  activityId?: ActivityId;
  reference?: string;
}

export type ActivityKind = 'Trip' | 'Lessons' | 'Camp' | 'Other';

export interface Activity {
  id: ActivityId;
  name: string;
  description: string;
  kind: ActivityKind;
  ensembles: string[]; // empty = open to all ensembles (informational)
  schools: string[]; // empty = all schools (informational)
  costCents: Cents; // default per-student cost (Enrollment may override)
  dueDate?: IsoDate; // final balance due
  depositCents?: Cents;
  depositDueDate?: IsoDate;
  status: 'Open' | 'Closed';
  allowFunds: boolean; // families may apply activity funds
  allowOnlinePayment: boolean; // families may pay online (PayPal)
  infoUrl?: string;
}

export type EnrollmentStatus = 'Going' | 'Waitlist' | 'Withdrawn';

export interface Enrollment {
  studentId: StudentId;
  activityId: ActivityId;
  costCents: Cents; // resolved: enrollment override or activity default
  status: EnrollmentStatus;
}

/** Computed per (student, activity) enrollment. */
export interface ActivityAccount {
  studentId: StudentId;
  activityId: ActivityId;
  activityName: string;
  kind: ActivityKind;
  enrollmentStatus: EnrollmentStatus;
  costCents: Cents;
  paidFromFundsCents: Cents; // -sum(ledger rows for this activity)
  paidDirectCents: Cents; // sum(completed payments for this activity)
  paidCents: Cents; // paidFromFunds + paidDirect
  pendingRedemptionCents: Cents; // pending fund requests for this activity
  remainingCents: Cents; // max(0, cost - paid)
  dueDate?: IsoDate;
  depositCents?: Cents;
  depositDueDate?: IsoDate;
  allowFunds: boolean;
  allowOnlinePayment: boolean;
  activityOpen: boolean;
}

export type PaymentMethod = 'PayPal' | 'Card' | 'Venmo' | 'Check' | 'Cash' | 'Other';
export type PaymentStatus = 'Completed' | 'Pending' | 'Refunded' | 'Failed';

export interface Payment {
  id: string; // processor capture id / check number / "P<row>"
  date: IsoDate;
  studentId: StudentId;
  activityId: ActivityId;
  amountCents: Cents; // credited toward the activity
  feeCents: Cents; // optional processing-fee contribution the payer added
  grossCents: Cents; // amount + fee actually charged
  method: PaymentMethod;
  payerEmail?: string;
  status: PaymentStatus;
}

export type RedemptionStatus = 'Pending' | 'Approved' | 'Denied' | 'Cancelled';

export interface RedemptionRequest {
  id: string; // "R-<uuid8>"
  requestedAt: IsoDateTime;
  email: string; // requesting guardian
  familyId: FamilyId;
  studentId: StudentId;
  activityId: ActivityId;
  amountCents: Cents;
  note?: string;
  status: RedemptionStatus;
  decidedAt?: IsoDateTime;
  decidedBy?: string;
  adminNote?: string;
}

// ---------------------------------------------------------------------------
// Communication
// ---------------------------------------------------------------------------

/**
 * Who a message is for. Both lists empty = everyone.
 * One list empty = match on the other list only.
 * Both non-empty = recipient must match a school AND an ensemble.
 */
export interface Audience {
  schools: string[];
  ensembles: string[];
}

export interface Announcement {
  id: string;
  date: IsoDate;
  title: string;
  body: string;
  audience: Audience;
  link?: string;
  sentAt?: IsoDateTime;
}

export interface EventItem {
  id: string;
  date: IsoDate;
  time?: string; // free text, e.g. "7:00 PM"
  title: string;
  location?: string;
  details?: string;
  audience: Audience;
}

export type NotificationTopic = 'balance' | 'payments' | 'reminders' | 'announcements';
export type NotificationChannel = 'push' | 'email' | 'sms';

export interface NotificationPrefs {
  channels: Record<NotificationChannel, boolean>;
  topics: Record<NotificationTopic, boolean>;
  /** Interest lists used to match Audience. Both empty = "everything". */
  schools: string[];
  ensembles: string[];
  smsPhone?: string;
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

/** Non-secret settings the browser may see (from the Settings tab). */
export interface PublicSettings {
  orgName: string;
  supportEmail: string;
  appUrl: string;
  schools: string[];
  ensembles: string[];
  /** Processor fee used for the optional "cover the fee" add-on. */
  feePercent: number; // e.g. 1.99
  feeFixedCents: Cents; // e.g. 49
  feeCoverDefault: boolean;
  onlinePaymentsEnabled: boolean; // true only when PayPal is fully configured
  paypalClientId: string; // public client id ('' when not configured)
  paypalEnv: 'sandbox' | 'live';
  minPaymentCents: Cents;
  otherPaymentInstructions: string; // plain text, newlines allowed
  donateUrl: string;
  privacyNote: string;
  smsEnabled: boolean;
  /**
   * VAPID public key (base64url, uncompressed P-256 point) of the TMA push
   * Worker. Browsers subscribe with it. '' when push is not configured.
   */
  pushPublicKey: string;
}

// ---------------------------------------------------------------------------
// Composite payloads
// ---------------------------------------------------------------------------

export interface StudentSummary {
  student: Student;
  /** False while the household (or this student) is Pending review; money fields are 0 then. */
  verified: boolean;
  balanceCents: Cents; // sum of ledger amounts
  pendingCents: Cents; // sum of Pending redemption requests
  availableCents: Cents; // balance - pending (never below 0)
  activities: ActivityAccount[];
}

export interface Me {
  email: string;
  name: string; // guardian name, or email local-part when unknown
  familyId: FamilyId | null;
  familyStatus: RecordStatus | 'None';
  isAdmin: boolean;
}

export interface Bootstrap {
  me: Me;
  family: Family | null;
  students: StudentSummary[];
  ledger: LedgerEntry[]; // household ledger, newest first (max 200)
  payments: Payment[]; // household payments, newest first
  redemptions: RedemptionRequest[]; // household requests, newest first
  announcements: Announcement[]; // sent announcements matching prefs, newest first (max 50)
  events: EventItem[]; // upcoming (date >= today) matching prefs, soonest first (max 50)
  activities: Activity[]; // open activities (informational catalogue)
  prefs: NotificationPrefs;
  pushTokens: number; // how many push devices this email has registered
  settings: PublicSettings;
  serverTime: IsoDateTime;
}

export interface HouseholdStudentInput {
  id?: StudentId; // present = update an existing student of this family
  firstName: string;
  lastName: string;
  grade: string;
  school: string;
  ensembles: string[];
  instrument?: string;
}

export interface HouseholdInput {
  guardians: Guardian[]; // 1..2; must include the signed-in email
  students: HouseholdStudentInput[]; // 0..8
}

export interface StudentMatchCandidate {
  studentId: StudentId;
  name: string;
  grade: string;
  school: string;
  familyId: FamilyId | null;
  balanceCents: Cents;
  score: number; // 0..1 name similarity
}

export interface PendingHousehold {
  family: Family;
  students: Array<{ student: Student; candidates: StudentMatchCandidate[] }>;
}

export interface PendingRedemptionView extends RedemptionRequest {
  studentName: string;
  activityName: string;
  availableCents: Cents; // student's current available funds (excluding this request)
  remainingCents: Cents; // activity remaining
}

export interface LogEntry {
  at: IsoDateTime;
  kind: string;
  detail: string;
}

export interface AdminStats {
  families: number;
  activeFamilies: number;
  pendingFamilies: number;
  students: number;
  totalFundsCents: Cents;
  pushDevices: number;
  /** Emails the app may still send today (with the push Worker sending, its generous allowance). */
  emailQuotaRemaining: number;
  /** Set when email goes out through the push Worker: its sender, e.g. noreply@mytma.org. */
  emailFrom?: string;
  /** With emailFrom: emails the Gmail backup may still send today. */
  emailBackupRemaining?: number;
}

export interface AdminOverview {
  stats: AdminStats;
  pendingRedemptions: PendingRedemptionView[];
  pendingHouseholds: PendingHousehold[];
  recentLog: LogEntry[]; // newest first, max 50
}

export interface DeliveryCounts {
  push: number;
  email: number;
  sms: number;
}

export interface TickReport {
  ranAt: IsoDateTime;
  balanceChanges: number;
  redemptionsPosted: number;
  announcementsSent: number;
  remindersSent: number;
  notifications: DeliveryCounts;
  errors: string[];
}

export interface SetupReport {
  createdTables: string[];
  addedColumns: Array<{ table: string; column: string }>;
  seeded: boolean;
  secretsInitialized: string[];
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

export interface ApiSpec {
  'auth.requestCode': { params: { email: string }; result: { sent: true; devCode?: string } };
  'auth.verifyCode': {
    params: { email: string; code: string };
    result: { token: string; expiresAt: IsoDateTime };
  };
  'me.bootstrap': { params: Record<string, never>; result: Bootstrap };
  'household.save': { params: HouseholdInput; result: Bootstrap };
  'prefs.save': { params: { prefs: NotificationPrefs }; result: { prefs: NotificationPrefs } };
  'push.register': {
    params: { token: string; userAgent?: string };
    result: { devices: number };
  };
  'push.unregister': { params: { token: string }; result: { devices: number } };
  'push.test': { params: Record<string, never>; result: DeliveryCounts };
  'redemption.request': {
    params: { studentId: StudentId; activityId: ActivityId; amountCents: Cents; note?: string };
    result: { redemption: RedemptionRequest };
  };
  'redemption.cancel': { params: { id: string }; result: { redemption: RedemptionRequest } };
  'payment.createOrder': {
    params: { studentId: StudentId; activityId: ActivityId; amountCents: Cents; coverFee: boolean };
    result: { orderId: string; amountCents: Cents; feeCents: Cents; grossCents: Cents };
  };
  'payment.captureOrder': { params: { orderId: string }; result: { payment: Payment } };
  'admin.overview': { params: Record<string, never>; result: AdminOverview };
  'admin.decideRedemption': {
    params: { id: string; decision: 'Approved' | 'Denied'; adminNote?: string };
    result: { redemption: RedemptionRequest };
  };
  'admin.reviewHousehold': {
    params: {
      familyId: FamilyId;
      decision: 'approve' | 'reject';
      /** Link a pending (self-registered) student to the treasurer's existing record. */
      links?: Array<{ pendingStudentId: StudentId; existingStudentId: StudentId }>;
    };
    result: { family: Family };
  };
  'admin.announce': {
    params: {
      title: string;
      body: string;
      audience: Audience;
      channels: Record<NotificationChannel, boolean>;
      link?: string;
    };
    result: { announcement: Announcement; delivered: DeliveryCounts };
  };
  'admin.runSync': { params: Record<string, never>; result: TickReport };
}

export type ApiAction = keyof ApiSpec;
export type ApiParams<A extends ApiAction> = ApiSpec[A]['params'];
export type ApiResult<A extends ApiAction> = ApiSpec[A]['result'];

export interface ApiRequest<A extends ApiAction = ApiAction> {
  action: A;
  params: ApiParams<A>;
  token?: string | null;
}

export type ApiErrorCode =
  | 'BAD_REQUEST'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'PAYMENT_FAILED'
  | 'NOT_CONFIGURED'
  | 'INTERNAL';

export type ApiResponse<A extends ApiAction = ApiAction> =
  | { ok: true; data: ApiResult<A> }
  | { ok: false; error: { code: ApiErrorCode; message: string } };

export const API_ACTIONS: readonly ApiAction[] = [
  'auth.requestCode',
  'auth.verifyCode',
  'me.bootstrap',
  'household.save',
  'prefs.save',
  'push.register',
  'push.unregister',
  'push.test',
  'redemption.request',
  'redemption.cancel',
  'payment.createOrder',
  'payment.captureOrder',
  'admin.overview',
  'admin.decideRedemption',
  'admin.reviewHousehold',
  'admin.announce',
  'admin.runSync',
] as const;

/** Push/notification payload shared by server senders and the service worker. */
export interface PushMessage {
  title: string;
  body: string;
  url?: string; // in-app hash route to open, e.g. "#/funds"
  tag?: string; // collapses duplicates on the device
  topic: NotificationTopic | 'test' | 'admin';
}
