/**
 * The Sign-ins tab through the real Apps Script adapters (SheetStore, LockService): a short lock
 * wait, the tab made on first write, exact times whatever the spreadsheet's time zone, and a busy
 * lock that only skips the row.
 */
import * as nodeCrypto from 'node:crypto';
import { createCtx } from '../server/context';
import { recordSignIn, SIGN_IN_LOCK_WAIT_MS } from '../server/sign-ins';
import { TABLES } from '../shared/schema';
import { createGasServices } from './services';
import { FakeSheet, hostTimeZone, installGasFakes, instantIn, uninstallGasFakes, wallClockIn, type GasFakes } from './testing/fakes';

let gas: GasFakes;

beforeEach(() => {
  gas = installGasFakes(nodeCrypto);
  gas.spreadsheet.addSheet(
    FakeSheet.withRows('Families', [
      ['FamilyID', 'Parent Name', 'Email', 'Status'],
      ['F0001', 'Jordan Thompson', 'parent@example.com', 'Active'],
    ]),
  );
});
afterEach(() => uninstallGasFakes());

// A spreadsheet zone ~14 hours from the script's, so a missed conversion changes the calendar day.
const FAR_ZONE = hostTimeZone() === 'Pacific/Kiritimati' ? 'Pacific/Pago_Pago' : 'Pacific/Kiritimati';

function servicesAt(at: Date) {
  const services = createGasServices();
  services.clock = { now: () => new Date(at.getTime()) };
  return services;
}

describe('Sign-ins in the spreadsheet', () => {
  it('makes the hidden tab on the first sign-in, waits briefly for the lock, and round-trips the time exactly', () => {
    gas.spreadsheet.timeZone = FAR_ZONE;
    const at = new Date('2026-10-22T02:30:00.000Z'); // Oct 21, 10:30 PM in New York
    recordSignIn(createCtx(servicesAt(at)), 'parent@example.com');

    const sheet = gas.spreadsheet.getSheetByName('Sign-ins')!;
    expect(sheet.isSheetHidden()).toBe(true);
    expect(sheet.dump()[0]).toEqual([...TABLES['Sign-ins'].headers]);
    expect(gas.lock.calls).toContain(`waitLock ${SIGN_IN_LOCK_WAIT_MS}`);
    expect(gas.lock.held).toBe(false);

    // The sheet shows the script zone's wall clock; the app reads back the same instant.
    const stored = sheet.raw(2, 3) as Date;
    expect(wallClockIn(stored, FAR_ZONE)).toEqual(wallClockIn(at, hostTimeZone()));
    const rec = createCtx(servicesAt(at)).m.signIns().get('parent@example.com');
    expect(rec).toMatchObject({
      familyId: 'F0001',
      firstSignedIn: at.toISOString(),
      lastSignedIn: at.toISOString(),
      lastOpened: at.toISOString(),
      count: 1,
    });

    // A second sign-in updates the same row.
    const next = new Date('2026-10-23T12:00:00.000Z');
    recordSignIn(createCtx(servicesAt(next)), 'parent@example.com');
    expect(sheet.dump()).toHaveLength(2);
    expect(createCtx(servicesAt(next)).m.signIns().get('parent@example.com')).toMatchObject({
      firstSignedIn: at.toISOString(),
      lastSignedIn: next.toISOString(),
      count: 2,
    });
  });

  it('reads a time the treasurer typed in a far-away spreadsheet zone as New York time', () => {
    gas.spreadsheet.timeZone = FAR_ZONE;
    const typed = instantIn({ year: 2026, month: 10, day: 21, hour: 21, minute: 30, second: 0, ms: 0 }, FAR_ZONE);
    gas.spreadsheet.addSheet(
      FakeSheet.withRows('Sign-ins', [
        [...TABLES['Sign-ins'].headers],
        ['parent@example.com', 'F0001', typed, typed, '', 1],
      ]),
    );
    const last = createCtx(servicesAt(new Date())).m.signIns().get('parent@example.com')?.lastSignedIn;
    const local = new Date(last!);
    expect([local.getFullYear(), local.getMonth() + 1, local.getDate(), local.getHours(), local.getMinutes()]).toEqual([2026, 10, 21, 21, 30]);
  });

  it('skips the row, without throwing, when another execution holds the lock', () => {
    gas.lock.busy = true;
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => recordSignIn(createCtx(servicesAt(new Date())), 'parent@example.com')).not.toThrow();
    expect(gas.lock.calls).toEqual([`waitLock ${SIGN_IN_LOCK_WAIT_MS}`]);
    expect(gas.spreadsheet.getSheetByName('Sign-ins')).toBeNull();
    expect(error.mock.calls[0][0]).toBe('Could not note the sign-in (Sign-ins tab); skipped');
    error.mockRestore();

    // CacheService kept it, so the next write once the lock is free counts both sign-ins.
    gas.lock.busy = false;
    recordSignIn(createCtx(servicesAt(new Date())), 'parent@example.com');
    expect(createCtx(servicesAt(new Date())).m.signIns().get('parent@example.com')?.count).toBe(2);
  });
});
