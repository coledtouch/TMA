/**
 * Fictional sample households, trips and history (ARCHITECTURE.md §8), with
 * dates relative to `today` so the demo never goes stale. Rows are what a
 * treasurer would type: dollars as numbers, dates as YYYY-MM-DD text,
 * timestamps as ISO strings (JSON-safe for the demo's localStorage copy).
 *
 * Balances: Avery $640, Liam $85, Maya $410, Ethan $35, Sofia (S0005) $520.
 */
import { SETTING_DEFAULTS, type SettingKey, type TableName } from '../shared/schema';
import type { RowData } from './services';
import { SETTING_NOTES } from './settings';
import { addDays, nyDate, nyLocalToDate, shortDate } from './util';

const TREASURER = 'treasurer@example.com';
const TMA_SITE = 'https://sites.google.com/view/timberlanemusicassociation/home';

export function sampleData(today: Date, opts: { demoSettings?: boolean } = {}): Partial<Record<TableName, RowData[]>> {
  const base = nyDate(today);
  const day = (offset: number): string => addDays(base, offset);
  const at = (offset: number, hour = 12, minute = 0): string => {
    const [y, m, d] = day(offset).split('-').map((n) => parseInt(n, 10));
    return nyLocalToDate(y, m, d, hour, minute).toISOString();
  };

  const credit = (offset: number, studentId: string, type: string, description: string, amount: number): RowData => ({
    Date: day(offset),
    StudentID: studentId,
    Type: type,
    Description: description,
    Amount: amount,
    ActivityID: '',
    Reference: '',
    'Entered By': TREASURER,
  });

  const ledger: RowData[] = [
    credit(-330, 'S0001', 'Fundraiser', 'Poinsettia sale (last year)', 120),
    credit(-330, 'S0003', 'Fundraiser', 'Poinsettia sale (last year)', 90),
    credit(-330, 'S0005', 'Fundraiser', 'Poinsettia sale (last year)', 140),
    credit(-240, 'S0001', 'Fundraiser', 'Cookie Dough fundraiser', 185),
    credit(-240, 'S0002', 'Fundraiser', 'Cookie Dough fundraiser', 55),
    credit(-240, 'S0003', 'Fundraiser', 'Cookie Dough fundraiser', 210),
    credit(-240, 'S0005', 'Fundraiser', 'Cookie Dough fundraiser', 230),
    {
      ...credit(-180, 'S0001', 'Redemption', 'Applied to New York City 2025', -200),
      ActivityID: 'NYC25',
    },
    credit(-150, 'S0001', 'Fundraiser', 'Pizza Night', 60),
    credit(-150, 'S0002', 'Fundraiser', 'Pizza Night', 30),
    credit(-150, 'S0003', 'Fundraiser', 'Pizza Night', 60),
    credit(-90, 'S0001', 'Fundraiser', 'Car Wash', 95),
    credit(-90, 'S0003', 'Fundraiser', 'Car Wash', 95),
    credit(-90, 'S0005', 'Fundraiser', 'Car Wash', 95),
    credit(-75, 'S0003', 'Donation', 'Donation from a family friend (designated)', 250),
    {
      ...credit(-60, 'S0003', 'Redemption', 'Applied to Florida 2027 deposit', -350),
      ActivityID: 'FL27',
    },
    credit(-45, 'S0001', 'Donation', 'Donation from grandparents (designated)', 250),
    credit(-45, 'S0005', 'Donation', 'Donation (designated)', 55),
    credit(-12, 'S0001', 'Fundraiser', 'Poinsettia sale', 130),
    credit(-12, 'S0003', 'Fundraiser', 'Poinsettia sale', 55),
    credit(-12, 'S0004', 'Fundraiser', 'Poinsettia sale', 35),
  ];

  const balances: Record<string, number> = { S0001: 640, S0002: 85, S0003: 410, S0004: 35, S0005: 520, S0006: 0 };

  const data: Partial<Record<TableName, RowData[]>> = {
    Families: [
      {
        FamilyID: 'F0001',
        'Parent Name': 'Jordan Thompson',
        Email: 'parent@example.com',
        Phone: '603-555-0142',
        'Parent 2 Name': 'Casey Thompson',
        'Parent 2 Email': 'casey.thompson@example.com',
        'Parent 2 Phone': '',
        Status: 'Active',
        Member: true,
        Created: at(-400, 19, 5),
      },
      {
        FamilyID: 'F0002',
        'Parent Name': 'Priya Nguyen',
        Email: 'nguyen.family@example.com',
        Phone: '603-555-0187',
        'Parent 2 Name': '',
        'Parent 2 Email': '',
        'Parent 2 Phone': '',
        Status: 'Active',
        Member: true,
        Created: at(-380, 20, 30),
      },
      {
        FamilyID: 'F0003',
        'Parent Name': 'Marcus Ortiz',
        Email: 'ortiz@example.com',
        Phone: '',
        'Parent 2 Name': '',
        'Parent 2 Email': '',
        'Parent 2 Phone': '',
        Status: 'Pending',
        Member: false,
        Created: at(-2, 21, 14),
      },
    ],
    Students: [
      student('S0001', 'F0001', 'Avery', 'Thompson', 11, 'High School', 'Band, Marching Band, Jazz Band', 'Trumpet', 'Active'),
      student('S0002', 'F0001', 'Liam', 'Thompson', 7, 'Middle School', 'Chorus', '', 'Active'),
      student('S0003', 'F0002', 'Maya', 'Nguyen', 10, 'High School', 'Orchestra', 'Violin', 'Active'),
      student('S0004', 'F0002', 'Ethan', 'Nguyen', 5, 'Elementary', 'Orchestra', 'Cello', 'Active'),
      student('S0005', '', 'Sofia', 'Ortiz', 12, 'High School', 'Chorus', '', 'Active'),
      student('S0006', 'F0003', 'Sofia', 'Ortiz', 12, 'High School', 'Chorus', '', 'Pending'),
    ],
    Activities: [
      {
        ActivityID: 'FL27',
        Name: 'Florida 2027 – Disney & Universal',
        Kind: 'Trip',
        Description:
          'Performance trip for High School Band, Jazz Band, Orchestra and Chorus: perform at Disney Springs and take a Universal music workshop.',
        Schools: 'High School',
        Ensembles: 'Band, Marching Band, Jazz Band, Orchestra, Chorus',
        Cost: 1850,
        Deposit: 350,
        'Deposit Due': day(25),
        'Due Date': day(100),
        Status: 'Open',
        'Allow Funds': true,
        'Allow Online Payment': true,
        'Info URL': TMA_SITE,
      },
      {
        ActivityID: 'CAMP27',
        Name: 'Marching Band Camp 2027',
        Kind: 'Camp',
        Description: 'One week of summer band camp before the marching season. Includes meals and the camp T-shirt.',
        Schools: 'High School',
        Ensembles: 'Band, Marching Band',
        Cost: 275,
        Deposit: '',
        'Deposit Due': '',
        'Due Date': day(200),
        Status: 'Open',
        'Allow Funds': true,
        'Allow Online Payment': true,
        'Info URL': '',
      },
      {
        ActivityID: 'LESSONS',
        Name: 'TRSD Private Lessons 2026–27',
        Kind: 'Lessons',
        Description: 'Weekly private lessons with district-approved teachers. Cost is set per student.',
        Schools: '',
        Ensembles: '',
        Cost: '',
        Deposit: '',
        'Deposit Due': '',
        'Due Date': day(14),
        Status: 'Open',
        'Allow Funds': true,
        'Allow Online Payment': false,
        'Info URL': '',
      },
      {
        ActivityID: 'NYC25',
        Name: 'New York City 2025',
        Kind: 'Trip',
        Description: 'Broadway workshop and performance.',
        Schools: 'High School',
        Ensembles: '',
        Cost: 650,
        Deposit: '',
        'Deposit Due': '',
        'Due Date': day(-200),
        Status: 'Closed',
        'Allow Funds': false,
        'Allow Online Payment': false,
        'Info URL': '',
      },
    ],
    Enrollments: [
      { StudentID: 'S0001', ActivityID: 'FL27', Cost: '', Status: 'Going' },
      { StudentID: 'S0001', ActivityID: 'CAMP27', Cost: '', Status: 'Going' },
      { StudentID: 'S0003', ActivityID: 'FL27', Cost: '', Status: 'Going' },
      { StudentID: 'S0003', ActivityID: 'LESSONS', Cost: 360, Status: 'Going' },
      { StudentID: 'S0005', ActivityID: 'FL27', Cost: '', Status: 'Going' },
    ],
    Ledger: ledger,
    Payments: [
      {
        Date: day(-20),
        StudentID: 'S0001',
        ActivityID: 'FL27',
        Amount: 350,
        'Fee Covered': 0,
        Gross: 350,
        Method: 'Check',
        Reference: 'Check #1043 (deposit)',
        'Payer Email': 'parent@example.com',
        Status: 'Completed',
      },
    ],
    Redemptions: [
      {
        RequestID: 'R-7f3a9c21',
        Requested: at(-1, 19, 42),
        Email: 'parent@example.com',
        FamilyID: 'F0001',
        StudentID: 'S0001',
        ActivityID: 'FL27',
        Amount: 200,
        Note: "Please use Avery's Car Wash and Poinsettia credits.",
        Status: 'Pending',
        Decided: '',
        'Decided By': '',
        'Admin Note': '',
        Notified: '',
      },
    ],
    Announcements: [
      {
        ID: 'A-1e7d4b90',
        Date: day(-12),
        Title: 'Poinsettia credits posted',
        Body: "Thank you for a great Poinsettia sale! Each student's share has been added to their activity funds. Check your balance in the app.",
        Schools: '',
        Ensembles: '',
        Link: '',
        Sent: at(-12, 20, 0),
      },
      {
        ID: 'A-5c2f8a14',
        Date: day(-7),
        Title: 'Winter Concert volunteers needed',
        Body: 'We need about 10 parents to help with ushering, the bake table and stage crew at the High School Winter Concert.\n\nReply to this email or sign up at the next TMA meeting. Thank you!',
        Schools: 'High School',
        Ensembles: 'Chorus',
        Link: '',
        Sent: at(-7, 18, 30),
      },
      {
        ID: 'A-3b9e1d07',
        Date: day(-3),
        Title: 'Florida 2027 deposit reminder',
        Body: `The $350 deposit for Florida 2027 is due ${shortDate(day(25))}. You can apply activity funds or pay online in the TMA app, or mail a check.`,
        Schools: 'High School',
        Ensembles: '',
        Link: TMA_SITE,
        Sent: at(-3, 9, 0),
      },
      {
        ID: 'A-9a6c3e52',
        Date: day(5),
        Title: 'Florida 2027 family information night',
        Body: 'Families of students going to Florida 2027: join us in the TRHS Library for the itinerary, packing list and Q&A.',
        Schools: 'High School',
        Ensembles: '',
        Link: '',
        Sent: '',
      },
    ],
    Events: [
      {
        ID: 'EV-JAZZ',
        Date: day(1),
        Time: '7:00 PM',
        Title: 'Jazz Night',
        Location: 'TRHS Cafeteria',
        Details: 'Jazz Band performs with guest musicians. Desserts by TMA volunteers.',
        Schools: '',
        Ensembles: 'Jazz Band',
      },
      {
        ID: 'EV-MEETING',
        Date: day(12),
        Time: '7:00 PM',
        Title: 'TMA monthly meeting',
        Location: 'TRHS Library',
        Details: 'All music families are welcome. Bring your questions about trips and fundraisers.',
        Schools: '',
        Ensembles: '',
      },
      {
        ID: 'EV-MSWC',
        Date: day(48),
        Time: '6:30 PM',
        Title: 'Middle School Winter Concert',
        Location: 'Timberlane Regional Middle School Gym',
        Details: '',
        Schools: 'Middle School',
        Ensembles: '',
      },
      {
        ID: 'EV-HSWC',
        Date: day(50),
        Time: '7:00 PM',
        Title: 'High School Winter Concert',
        Location: 'TRHS Auditorium',
        Details: 'Band, Orchestra and Chorus. Doors open at 6:30 PM.',
        Schools: 'High School',
        Ensembles: '',
      },
    ],
    // Matches the ledger, so the first sync sends nothing and new credits notify right away.
    _Snapshot: Object.keys(balances).map((id) => ({ StudentID: id, Balance: balances[id], Updated: at(-1, 8, 0) })),
  };

  if (opts.demoSettings) {
    const overrides: Partial<Record<SettingKey, string>> = {
      ADMIN_EMAILS: TREASURER,
      ONLINE_PAYMENTS: 'TRUE',
      PAYPAL_CLIENT_ID: 'demo',
      APP_URL: '',
    };
    data.Settings = (Object.keys(SETTING_DEFAULTS) as SettingKey[]).map((key) => ({
      Key: key,
      Value: overrides[key] ?? SETTING_DEFAULTS[key],
      Notes: SETTING_NOTES[key],
    }));
    data.Devices = [
      {
        Email: 'parent@example.com',
        FamilyID: 'F0001',
        Token: 'demo-device-parent',
        'User Agent': 'Demo phone',
        Created: at(-30, 19, 0),
        'Last Seen': at(-1, 7, 30),
      },
    ];
  }
  return data;
}

function student(
  id: string,
  familyId: string,
  first: string,
  last: string,
  grade: number,
  school: string,
  ensembles: string,
  instrument: string,
  status: string,
): RowData {
  return {
    StudentID: id,
    FamilyID: familyId,
    'First Name': first,
    'Last Name': last,
    Grade: grade,
    School: school,
    Ensembles: ensembles,
    Instrument: instrument,
    Status: status,
  };
}
