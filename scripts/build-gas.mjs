// Bundles the Apps Script backend (src/gas/entry.ts + src/server + src/shared)
// into apps-script/Code.js, a single plain script volunteers can paste into
// Extensions → Apps Script. Run with `npm run build:gas`.
//
// Apps Script only sees top-level function declarations, so after the IIFE
// bundle (global `TMA`) we append one wrapper per entry point.
import { build } from 'esbuild';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const entry = resolve(root, 'src/gas/entry.ts');
const outFile = resolve(root, 'apps-script/Code.js');

/** Entry points Apps Script calls by name (web app, triggers, sheet menu). */
const ENTRY_FUNCTIONS = [
  'doGet',
  'doPost',
  'onOpen',
  'syncTick',
  'dailyTick',
  'setupTma',
  'setupTmaWithSampleData',
  'installTriggers',
  'sendTestPushToMe',
  'showTmaStatus',
  // TMA App → Reports (src/gas/reports-sheet.ts SHEET_REPORTS)
  'reportTripBalances',
  'reportStudentFunds',
  'reportFundraiserTotals',
  'reportFundActivity',
  'reportPayments',
  'reportRoster',
  'reportOpenItems',
  'reportAppUsage',
];

const BANNER = '// GENERATED FILE — do not edit. Built from src/ by `npm run build:gas`.';

async function main() {
  const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    format: 'iife',
    globalName: 'TMA',
    target: 'es2019',
    platform: 'neutral',
    mainFields: ['module', 'main'],
    minify: false,
    legalComments: 'none',
    charset: 'utf8',
    banner: { js: BANNER },
    define: { __APP_VERSION__: JSON.stringify(pkg.version) },
    write: false,
    logLevel: 'silent',
  });
  for (const warning of result.warnings) console.warn(`warning: ${warning.text}`);

  const bundle = result.outputFiles[0].text;
  const wrappers = ENTRY_FUNCTIONS.map((name) => `function ${name}(e) {\n  return TMA.${name}(e);\n}`).join('\n\n');
  const code = `${bundle.trimEnd()}\n\n// Apps Script entry points\n${wrappers}\n`;

  verify(code);
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, code);
  console.log(`apps-script/Code.js written (${(code.length / 1024).toFixed(1)} KB, v${pkg.version})`);
}

/**
 * Load the bundle in an empty context (no Apps Script services) to prove that
 * nothing runs at load time and that every wrapper has a real target.
 */
function verify(code) {
  const sandbox = { console };
  vm.createContext(sandbox);
  try {
    vm.runInContext(code, sandbox, { filename: 'Code.js' });
  } catch (error) {
    throw new Error(
      `Loading the bundle failed. Module code must not call Apps Script services at load time ` +
        `(onOpen runs with limited authorization). ${error instanceof Error ? error.message : error}`,
    );
  }
  const missing = ENTRY_FUNCTIONS.filter(
    (name) => typeof sandbox.TMA?.[name] !== 'function' || typeof sandbox[name] !== 'function',
  );
  if (missing.length > 0) throw new Error(`Bundle is missing entry points: ${missing.join(', ')}`);
}

main().catch((error) => {
  if (Array.isArray(error?.errors) && error.errors.length > 0) {
    for (const e of error.errors) {
      const where = e.location ? `${e.location.file}:${e.location.line}:${e.location.column}: ` : '';
      console.error(`error: ${where}${e.text}`);
    }
  } else {
    console.error(error instanceof Error ? error.message : error);
  }
  process.exit(1);
});
