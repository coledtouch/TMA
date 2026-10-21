/** Fictional sample data and a scriptable fake ApiClient for web tests. */
import { vi } from 'vitest';
import type {
  ActivityAccount,
  ApiAction,
  ApiParams,
  ApiResult,
  Bootstrap,
  PublicSettings,
  StudentSummary,
} from '../../shared/types';
import { ApiError, type ApiClient } from '../api/client';
import { toIsoDate } from '../lib/format';

export function daysFromNow(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return toIsoDate(d);
}

export function makeSettings(overrides: Partial<PublicSettings> = {}): PublicSettings {
  return {
    orgName: 'Timberlane Music Association',
    supportEmail: 'timberlanemusictma@gmail.com',
    appUrl: '',
    schools: ['High School', 'Middle School', 'Elementary'],
    ensembles: ['Band', 'Marching Band', 'Jazz Band', 'Orchestra', 'Chorus', 'Guitar'],
    feePercent: 1.99,
    feeFixedCents: 49,
    feeCoverDefault: true,
    onlinePaymentsEnabled: true,
    paypalClientId: 'demo',
    paypalEnv: 'sandbox',
    minPaymentCents: 500,
    otherPaymentInstructions: 'Checks payable to "Timberlane Music Association".\nP.O. Box 420, Plaistow, NH 03865',
    donateUrl: 'https://example.org/donate',
    privacyNote: 'TMA only stores what it needs to run the program.',
    smsEnabled: false,
    ...overrides,
  };
}

export function makeAccount(overrides: Partial<ActivityAccount> = {}): ActivityAccount {
  return {
    studentId: 'S0001',
    activityId: 'FL27',
    activityName: 'Florida 2027',
    kind: 'Trip',
    enrollmentStatus: 'Going',
    costCents: 185000,
    paidFromFundsCents: 20000,
    paidDirectCents: 35000,
    paidCents: 55000,
    pendingRedemptionCents: 0,
    remainingCents: 130000,
    dueDate: daysFromNow(100),
    depositCents: 35000,
    depositDueDate: daysFromNow(25),
    allowFunds: true,
    allowOnlinePayment: true,
    activityOpen: true,
    ...overrides,
  };
}

export function makeStudent(overrides: Partial<StudentSummary> = {}): StudentSummary {
  return {
    student: {
      id: 'S0001',
      familyId: 'F0001',
      firstName: 'Avery',
      lastName: 'Thompson',
      grade: '11',
      school: 'High School',
      ensembles: ['Band', 'Jazz Band'],
      instrument: 'Trumpet',
      status: 'Active',
    },
    verified: true,
    balanceCents: 64000,
    pendingCents: 0,
    availableCents: 64000,
    activities: [makeAccount()],
    ...overrides,
  };
}

export function makeBootstrap(overrides: Partial<Bootstrap> = {}): Bootstrap {
  return {
    me: {
      email: 'parent@example.com',
      name: 'Jordan Thompson',
      familyId: 'F0001',
      familyStatus: 'Active',
      isAdmin: false,
    },
    family: {
      id: 'F0001',
      guardians: [{ name: 'Jordan Thompson', email: 'parent@example.com', phone: '603-555-0101' }],
      status: 'Active',
      member: true,
    },
    students: [
      makeStudent(),
      makeStudent({
        student: {
          id: 'S0002',
          familyId: 'F0001',
          firstName: 'Liam',
          lastName: 'Thompson',
          grade: '7',
          school: 'Middle School',
          ensembles: ['Chorus'],
          status: 'Active',
        },
        balanceCents: 8500,
        pendingCents: 2000,
        availableCents: 6500,
        activities: [],
      }),
    ],
    ledger: [
      {
        id: 'L10',
        date: daysFromNow(-3),
        studentId: 'S0001',
        type: 'Fundraiser',
        description: 'Pizza Night',
        amountCents: 5000,
      },
      {
        id: 'L9',
        date: daysFromNow(-30),
        studentId: 'S0001',
        type: 'Redemption',
        description: 'Applied to Florida 2027',
        amountCents: -20000,
        activityId: 'FL27',
      },
      {
        id: 'L8',
        date: daysFromNow(-40),
        studentId: 'S0002',
        type: 'Fundraiser',
        description: 'Cookie Dough',
        amountCents: 8500,
      },
    ],
    payments: [],
    redemptions: [],
    announcements: [
      {
        id: 'A-1',
        date: daysFromNow(-2),
        title: 'Florida 2027 deposit reminder',
        body: 'Deposits are due soon.',
        audience: { schools: ['High School'], ensembles: [] },
        sentAt: new Date().toISOString(),
      },
    ],
    events: [
      {
        id: 'E1',
        date: daysFromNow(12),
        time: '7:00 PM',
        title: 'TMA monthly meeting',
        location: 'TRHS Library',
        audience: { schools: [], ensembles: [] },
      },
    ],
    activities: [
      {
        id: 'FL27',
        name: 'Florida 2027',
        description: '',
        kind: 'Trip',
        ensembles: [],
        schools: ['High School'],
        costCents: 185000,
        status: 'Open',
        allowFunds: true,
        allowOnlinePayment: true,
      },
    ],
    prefs: {
      channels: { push: true, email: true, sms: false },
      topics: { balance: true, payments: true, reminders: true, announcements: true },
      schools: [],
      ensembles: [],
    },
    pushTokens: 0,
    settings: makeSettings(),
    serverTime: new Date().toISOString(),
    ...overrides,
  };
}

type Handler<A extends ApiAction> = (params: ApiParams<A>) => ApiResult<A> | Promise<ApiResult<A>>;
export type Handlers = { [A in ApiAction]?: Handler<A> };

export interface FakeApi extends ApiClient {
  call: ApiClient['call'] & ReturnType<typeof vi.fn>;
  handlers: Handlers;
}

/** A fake client; unknown actions reject with INTERNAL so tests notice. */
export function fakeApi(handlers: Handlers = {}, mode: 'demo' | 'live' = 'live', token: string | null = 'tok'): FakeApi {
  let current = token;
  const api = {
    mode,
    handlers,
    getToken: () => current,
    setToken: vi.fn((t: string | null) => {
      current = t;
    }),
    call: vi.fn(async (action: ApiAction, params: unknown) => {
      const handler = handlers[action] as ((p: unknown) => unknown) | undefined;
      if (!handler) throw new ApiError('INTERNAL', `No fake handler for ${action}`);
      return handler(params);
    }),
  };
  return api as unknown as FakeApi;
}
