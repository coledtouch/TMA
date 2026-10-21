/**
 * Google Sheet layout. One spreadsheet, one tab per table.
 *
 * Header matching is forgiving: the sheet adapter compares headers after
 * lower-casing and removing everything except letters and digits, and also
 * accepts the listed aliases. So "Student ID", "student_id" and "StudentID"
 * all map to the canonical "StudentID". Column order never matters, and the
 * treasurer may add extra columns of their own (they are ignored).
 *
 * Money columns hold dollars (e.g. 50 or 50.00). Date columns may hold real
 * sheet dates or text like 2026-10-21 / 10/21/2026.
 */

export type TableName =
  | 'Families'
  | 'Students'
  | 'Ledger'
  | 'Activities'
  | 'Enrollments'
  | 'Payments'
  | 'Redemptions'
  | 'Announcements'
  | 'Events'
  | 'Preferences'
  | 'Devices'
  | 'Settings'
  | 'Log'
  | '_Snapshot'
  | '_Sent';

export interface TableDef {
  headers: readonly string[];
  /** canonical header -> other accepted spellings */
  aliases?: Readonly<Record<string, readonly string[]>>;
  /** Maintained by the app; hidden in the sheet. */
  system?: boolean;
  /** One-line purpose, shown in docs and in the sheet's header note. */
  note: string;
}

export const TABLES: Readonly<Record<TableName, TableDef>> = {
  Families: {
    headers: [
      'FamilyID',
      'Parent Name',
      'Email',
      'Phone',
      'Parent 2 Name',
      'Parent 2 Email',
      'Parent 2 Phone',
      'Status',
      'Member',
      'Created',
    ],
    aliases: {
      'Parent Name': ['Parent', 'Guardian', 'Guardian Name', 'Parent 1 Name', 'Name'],
      Email: ['Parent Email', 'Parent 1 Email', 'Guardian Email', 'Email Address'],
      Phone: ['Cell', 'Cell Phone', 'Parent Phone', 'Parent 1 Phone', 'Mobile'],
      'Parent 2 Name': ['Guardian 2', 'Guardian 2 Name', 'Second Parent'],
      'Parent 2 Email': ['Guardian 2 Email', 'Second Email'],
      'Parent 2 Phone': ['Guardian 2 Phone', 'Parent 2 Cell'],
      Member: ['TMA Member', 'Membership'],
    },
    note: 'One row per household. Status: Active (verified), Pending (signed up in the app, needs review), Inactive.',
  },
  Students: {
    headers: [
      'StudentID',
      'FamilyID',
      'First Name',
      'Last Name',
      'Grade',
      'School',
      'Ensembles',
      'Instrument',
      'Status',
    ],
    aliases: {
      'First Name': ['First', 'Student First Name'],
      'Last Name': ['Last', 'Student Last Name'],
      Ensembles: ['Groups', 'Ensemble', 'Programs'],
    },
    note: 'One row per student. Ensembles is a comma-separated list (e.g. "Band, Jazz Band").',
  },
  Ledger: {
    headers: ['Date', 'StudentID', 'Type', 'Description', 'Amount', 'ActivityID', 'Reference', 'Entered By'],
    aliases: { Amount: ['Amount ($)', 'Credit', 'Value'], ActivityID: ['Activity', 'Trip', 'TripID'] },
    note: 'Activity-fund history. + adds to a student\'s funds (fundraiser credit), - spends them. Fill ActivityID when funds are applied to a trip/activity.',
  },
  Activities: {
    headers: [
      'ActivityID',
      'Name',
      'Kind',
      'Description',
      'Schools',
      'Ensembles',
      'Cost',
      'Deposit',
      'Deposit Due',
      'Due Date',
      'Status',
      'Allow Funds',
      'Allow Online Payment',
      'Info URL',
    ],
    aliases: { Kind: ['Type'], Cost: ['Cost Per Student', 'Price'], 'Due Date': ['Final Due', 'Balance Due'] },
    note: 'Trips, camps, lessons. Kind: Trip | Camp | Lessons | Other. Status: Open | Closed. Allow columns: TRUE/FALSE or Y/N.',
  },
  Enrollments: {
    headers: ['StudentID', 'ActivityID', 'Cost', 'Status'],
    aliases: { Cost: ['Cost Override', 'Price'] },
    note: 'Who is going (per the music department). Cost blank = activity default. Status: Going | Waitlist | Withdrawn.',
  },
  Payments: {
    headers: [
      'Date',
      'StudentID',
      'ActivityID',
      'Amount',
      'Fee Covered',
      'Gross',
      'Method',
      'Reference',
      'Payer Email',
      'Status',
    ],
    note: 'Money paid toward an activity (PayPal rows are added by the app; add checks/cash by hand). Amount = credited to the trip.',
  },
  Redemptions: {
    headers: [
      'RequestID',
      'Requested',
      'Email',
      'FamilyID',
      'StudentID',
      'ActivityID',
      'Amount',
      'Note',
      'Status',
      'Decided',
      'Decided By',
      'Admin Note',
      'Notified',
    ],
    note: 'Requests to apply activity funds to a trip. Change Status to Approved/Denied here or in the app; the app posts the Ledger row.',
  },
  Announcements: {
    headers: ['ID', 'Date', 'Title', 'Body', 'Schools', 'Ensembles', 'Link', 'Sent'],
    note: 'News for families. Leave Sent blank and the app sends it on its next run (Schools/Ensembles blank = everyone).',
  },
  Events: {
    headers: ['ID', 'Date', 'Time', 'Title', 'Location', 'Details', 'Schools', 'Ensembles'],
    note: 'Concerts, meetings, deadlines. Families get a reminder the day before.',
  },
  Preferences: {
    headers: ['Email', 'FamilyID', 'Prefs', 'Updated'],
    system: true,
    note: 'Notification choices per parent email (JSON). Managed by the app.',
  },
  Devices: {
    headers: ['Email', 'FamilyID', 'Token', 'User Agent', 'Created', 'Last Seen'],
    system: true,
    note: 'Push-notification device tokens. Managed by the app.',
  },
  Settings: {
    headers: ['Key', 'Value', 'Notes'],
    note: 'App settings (non-secret). Secrets go in Apps Script > Project Settings > Script Properties.',
  },
  Log: {
    headers: ['At', 'Kind', 'Detail'],
    system: true,
    note: 'What the app did (notifications sent, approvals, errors).',
  },
  _Snapshot: {
    headers: ['StudentID', 'Balance', 'Updated'],
    system: true,
    note: 'Last seen balances, used to detect changes and notify families.',
  },
  _Sent: {
    headers: ['Key', 'At'],
    system: true,
    note: 'Idempotency keys for reminders already sent.',
  },
};

export const TABLE_ORDER: readonly TableName[] = [
  'Families',
  'Students',
  'Ledger',
  'Activities',
  'Enrollments',
  'Payments',
  'Redemptions',
  'Announcements',
  'Events',
  'Settings',
  'Preferences',
  'Devices',
  'Log',
  '_Snapshot',
  '_Sent',
];

/** Settings tab keys with defaults. Values are strings as typed in the sheet. */
export const SETTING_DEFAULTS = {
  ORG_NAME: 'Timberlane Music Association',
  SUPPORT_EMAIL: 'timberlanemusictma@gmail.com',
  APP_URL: '',
  ADMIN_EMAILS: '',
  SCHOOLS: 'High School, Middle School, Elementary',
  ENSEMBLES: 'Band, Marching Band, Jazz Band, Orchestra, Chorus, Guitar',
  FEE_PERCENT: '1.99',
  FEE_FIXED: '0.49',
  FEE_COVER_DEFAULT: 'TRUE',
  ONLINE_PAYMENTS: 'FALSE',
  PAYPAL_ENV: 'sandbox',
  PAYPAL_CLIENT_ID: '',
  MIN_PAYMENT: '5.00',
  OTHER_PAYMENT_INSTRUCTIONS:
    'Checks payable to "Timberlane Music Association", P.O. Box 420, Plaistow, NH 03865. Please write the student\'s name and the trip in the memo line.',
  DONATE_URL: 'https://sites.google.com/view/timberlanemusicassociation/donate',
  PRIVACY_NOTE:
    'TMA only stores what it needs to run the program: parent names, emails, an optional cell number, and each student\'s name, grade, school and groups. No addresses, SSNs or card numbers. Card payments are handled by PayPal; TMA never sees card numbers.',
  REMINDER_DAYS: '14, 7, 1',
  EMAIL_ENABLED: 'TRUE',
  SMS_ENABLED: 'FALSE',
  PUSH_RELAY_URL: 'https://tma-push.coleciprari.workers.dev',
  TOKEN_VERSION: '1',
  SESSION_DAYS: '120',
} as const;

export type SettingKey = keyof typeof SETTING_DEFAULTS;

/** Secrets live in Script Properties, never in the sheet. */
export type SecretName =
  | 'TOKEN_SECRET'
  | 'PAYPAL_SECRET'
  /** Shared secret Apps Script uses with the push Worker (created by setup). */
  | 'PUSH_RELAY_SECRET'
  /** Cached VAPID public key fetched from the push Worker (not secret). */
  | 'PUSH_PUBLIC_KEY'
  | 'TWILIO_ACCOUNT_SID'
  | 'TWILIO_AUTH_TOKEN'
  | 'TWILIO_FROM';

/** Normalize a header for matching: lower-case, letters+digits only. */
export function normalizeHeader(h: string): string {
  return String(h).toLowerCase().replace(/[^a-z0-9]/g, '');
}
