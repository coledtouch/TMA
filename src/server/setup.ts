/**
 * setup() (ARCHITECTURE.md §8): create/upgrade tabs, write missing Settings
 * keys, create TOKEN_SECRET, and optionally seed the sample data into an
 * empty sheet. Safe to run any number of times.
 */
import { OLD_SETTING_DEFAULTS, SETTING_DEFAULTS, TABLE_ORDER, type SecretName, type SettingKey, type TableName } from '../shared/schema';
import type { SetupReport } from '../shared/types';
import type { Ctx } from './context';
import { sampleData } from './sample-data';
import type { Crypto, SetupOptions } from './services';
import { SETTING_NOTES, settingKey } from './settings';
import { hasOwn, str } from './util';

const SEED_GUARD: readonly TableName[] = ['Families', 'Students', 'Ledger'];

/**
 * A new secret: 64 hex chars from the platform's random UUIDs and digits,
 * mixed through HMAC-SHA256. Used for TOKEN_SECRET here and for the push
 * Worker's PUSH_RELAY_SECRET by the Apps Script setup.
 */
export function generateSecret(c: Crypto, name: SecretName): string {
  const secret = c.hmacSha256Hex(c.uuid(), `${c.uuid()}${c.uuid()}${c.randomDigits(32)}`);
  if (!/^[0-9a-f]{64}$/.test(secret)) throw new Error(`Could not generate ${name}`);
  return secret;
}

/** Text compared the way a person reads it: runs of spaces and line breaks count as one space. */
function sameText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function runSetup(ctx: Ctx, options: SetupOptions = {}): SetupReport {
  const report: SetupReport = { createdTables: [], addedColumns: [], seeded: false, secretsInitialized: [] };

  for (const table of TABLE_ORDER) {
    const result = ctx.db.ensureTable(table);
    if (result.created) report.createdTables.push(table);
    for (const column of result.addedColumns) report.addedColumns.push({ table, column });
  }

  const settingRows = ctx.db.rows('Settings');
  const present = new Set(settingRows.map((r) => settingKey(r.data.Key)));
  const missing = (Object.keys(SETTING_DEFAULTS) as SettingKey[])
    .filter((key) => !present.has(key))
    .map((key) => ({ Key: key, Value: SETTING_DEFAULTS[key], Notes: SETTING_NOTES[key] }));

  // An old default nobody changed gets today's (e.g. the privacy note now mentions the Sign-ins tab).
  const updated: SettingKey[] = [];
  for (const row of settingRows) {
    const key = settingKey(row.data.Key) as SettingKey;
    const olds = hasOwn(OLD_SETTING_DEFAULTS, key) ? OLD_SETTING_DEFAULTS[key] : undefined;
    if (!olds || !olds.some((old) => sameText(old) === sameText(str(row.data.Value)))) continue;
    ctx.db.update('Settings', row.rowNumber, { Value: SETTING_DEFAULTS[key] });
    if (!updated.includes(key)) updated.push(key);
  }
  if (updated.length) report.updatedSettings = updated;

  ctx.db.append('Settings', missing);
  if (missing.length) report.addedSettings = missing.map((row) => row.Key);

  if (!ctx.s.secrets.get('TOKEN_SECRET')) {
    ctx.s.secrets.set('TOKEN_SECRET', generateSecret(ctx.s.crypto, 'TOKEN_SECRET'));
    report.secretsInitialized.push('TOKEN_SECRET');
  }

  if (options.seedSampleData && SEED_GUARD.every((t) => ctx.db.rows(t).length === 0)) {
    const data = sampleData(ctx.now);
    for (const table of TABLE_ORDER) {
      const rows = data[table];
      // Never mix sample rows into a tab the treasurer already filled.
      if (rows && rows.length > 0 && ctx.db.rows(table).length === 0) ctx.db.append(table, rows);
    }
    report.seeded = true;
  }

  ctx.log(
    'setup',
    [
      report.createdTables.length ? `created ${report.createdTables.join(', ')}` : 'tabs ok',
      report.addedColumns.length ? `added ${report.addedColumns.length} column(s)` : '',
      missing.length ? `added ${missing.length} setting(s)` : '',
      updated.length ? `updated ${updated.join(', ')} to the new default` : '',
      report.secretsInitialized.length ? 'created TOKEN_SECRET' : '',
      report.seeded ? 'seeded sample data' : '',
    ]
      .filter((s) => s !== '')
      .join('; '),
  );
  return report;
}
