/**
 * Board tools → Reports (ARCHITECTURE.md §5.4): read-only tables that
 * admin.report builds fresh from the sheet each time, with filters, a CSV
 * download and a print view. #/reports lists the reports; #/reports?kind=…
 * shows one. Reports run again whenever a filter changes.
 */
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type FocusEvent, type ReactNode, type RefObject } from 'react';
import type {
  ApiParams,
  IsoDate,
  Report,
  ReportCell,
  ReportColumn,
  ReportFilters,
  ReportKind,
  ReportOptions,
} from '../../shared/types';
import { errorMessage } from '../api/client';
import { ConfirmDialog } from '../components/Dialog';
import { CheckboxField, TextField } from '../components/Field';
import { Icon, type IconName } from '../components/Icon';
import { EmptyState, ErrorState, Skeleton, Spinner } from '../components/States';
import { useApp } from '../hooks/app-context';
import { useToast } from '../hooks/toast';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { columnTotals, displayColumns, downloadCsv, extraTotals, formatStamp, reportFileName, reportToCsv } from '../lib/csv';
import { formatCents, parseIsoDate, plural, todayIso } from '../lib/format';
import { href } from '../lib/router';
import '../styles/reports.css';

/** Wait this long after the last filter change before running (typing a date changes it on every digit). */
const FILTER_DELAY_MS = 400;

interface ReportInfo {
  kind: ReportKind;
  title: string;
  /** One plain line for the list. */
  summary: string;
  icon: IconName;
}

/** The reports, in the order the list shows them. Titles match the server's (and the sheet's tabs). */
export const REPORTS: readonly ReportInfo[] = [
  { kind: 'trip-balances', title: 'Trip balances', summary: 'Who still owes what on each trip or activity', icon: 'trips' },
  { kind: 'student-funds', title: 'Student funds', summary: "Each student's activity funds: earned, used and available", icon: 'funds' },
  { kind: 'fundraiser-totals', title: 'Fundraiser totals', summary: 'What each fundraiser and donation brought in', icon: 'heart' },
  { kind: 'fund-activity', title: 'Fund activity', summary: 'Every credit to and charge from activity funds', icon: 'news' },
  { kind: 'payments', title: 'Payments', summary: 'Every check, cash and online payment', icon: 'check' },
  { kind: 'roster', title: 'Roster', summary: "Students with their parents' emails and phone numbers", icon: 'users' },
  { kind: 'open-items', title: 'Open items', summary: 'What is waiting on the treasurer right now', icon: 'bell' },
  { kind: 'app-usage', title: 'App usage', summary: 'How many families use the app and get notifications', icon: 'sparkle' },
];

const INFO = new Map(REPORTS.map((r) => [r.kind, r]));

export function isReportKind(value: string | undefined): value is ReportKind {
  return value !== undefined && INFO.has(value as ReportKind);
}

type FilterName = 'activity' | 'school' | 'ensemble' | 'dates' | 'includePaid';

/** Which filters each report uses (the ReportFilters doc comments; reports.ts FILTERS_FOR). */
export const REPORT_FILTERS: Readonly<Record<ReportKind, readonly FilterName[]>> = {
  'trip-balances': ['activity', 'school', 'ensemble', 'includePaid'],
  'student-funds': ['school', 'ensemble'],
  'fundraiser-totals': ['dates'],
  'fund-activity': ['dates', 'activity'],
  payments: ['dates', 'activity'],
  roster: ['school', 'ensemble'],
  'open-items': [],
  'app-usage': [],
};

/** What the filter controls hold. Blank means "all" (or, for dates, the school year). */
export interface FilterState {
  activityId: string;
  school: string;
  ensemble: string;
  from: IsoDate | '';
  to: IsoDate | '';
  includePaid: boolean;
}

/** The school year (Jul 1 – Jun 30) holding `date`, the server's default range. */
export function schoolYear(date: IsoDate): { from: IsoDate; to: IsoDate } {
  const year = Number(date.slice(0, 4));
  const start = Number(date.slice(5, 7)) >= 7 ? year : year - 1;
  return { from: `${start}-07-01`, to: `${start + 1}-06-30` };
}

export function defaultFilters(today: IsoDate = todayIso()): FilterState {
  return { activityId: '', school: '', ensemble: '', ...schoolYear(today), includePaid: false };
}

/** admin.report params: only the filters `kind` uses, blanks left out. */
export function reportParams(kind: ReportKind, f: FilterState): ApiParams<'admin.report'> {
  const uses = REPORT_FILTERS[kind];
  const filters: ReportFilters = {};
  if (uses.includes('activity') && f.activityId) filters.activityId = f.activityId;
  if (uses.includes('school') && f.school) filters.school = f.school;
  if (uses.includes('ensemble') && f.ensemble) filters.ensemble = f.ensemble;
  if (uses.includes('dates')) {
    if (f.from) filters.from = f.from;
    if (f.to) filters.to = f.to;
  }
  if (uses.includes('includePaid')) filters.includePaid = f.includePaid;
  return Object.keys(filters).length > 0 ? { kind, filters } : { kind };
}

/** The contact details a report holds, for its warnings: phone numbers only in the roster. */
export function contactDetails(report: Report): string {
  const phones = report.columns.some((c) => c.type === 'phone' && report.rows.some((r) => r[c.key] !== null && r[c.key] !== ''));
  return phones ? 'email addresses and phone numbers' : 'email addresses';
}

function badRange(f: { from?: string; to?: string } | undefined): boolean {
  return Boolean(f?.from && f.to && f.from > f.to);
}

/** "Oct 21, 2026". */
export function formatReportDate(value: string): string {
  const d = parseIsoDate(value);
  return d ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : value;
}

/** The filters a report applied, in words: "Jul 1, 2026 to Jun 30, 2027 · All activities". */
export function filterSummary(report: Report, options: ReportOptions | null): string {
  const f = report.filters;
  const uses = REPORT_FILTERS[report.kind] ?? [];
  const parts: string[] = [];
  if (uses.includes('dates') && f.from && f.to) parts.push(`${formatReportDate(f.from)} to ${formatReportDate(f.to)}`);
  if (uses.includes('activity')) {
    const name = f.activityId ? (options?.activities.find((a) => a.id === f.activityId)?.name ?? f.activityId) : null;
    parts.push(name ?? (report.kind === 'trip-balances' ? 'Open activities' : 'All activities'));
  }
  if (uses.includes('school')) parts.push(f.school || 'All schools');
  if (uses.includes('ensemble')) parts.push(f.ensemble || 'All groups');
  if (uses.includes('includePaid')) parts.push(f.includePaid ? 'Paid in full included' : 'Paid in full left out');
  return parts.join(' · ');
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export function Reports({ kind }: { kind?: string }) {
  const { data } = useApp();
  if (!data.me.isAdmin) {
    return (
      <div className="screen">
        <div className="screen-head">
          <h1 className="screen-title">Reports</h1>
        </div>
        <div className="card">
          <EmptyState icon="lock" title="For TMA board members">
            Reports are only available to the board members listed in TMA's settings.
          </EmptyState>
        </div>
      </div>
    );
  }
  return <ReportsScreen kind={isReportKind(kind) ? kind : null} />;
}

function ReportsScreen({ kind }: { kind: ReportKind | null }) {
  // Filters and their choices outlive one report, so moving between reports keeps them.
  const [filters, setFilters] = useState<FilterState>(() => defaultFilters());
  const [options, setOptions] = useState<ReportOptions | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  // The list and each report share one route, so the app shell doesn't move focus between them: do it here.
  const shownKind = useRef(kind);
  useEffect(() => {
    if (shownKind.current === kind) return;
    shownKind.current = kind;
    headingRef.current?.focus({ preventScroll: true });
    if (typeof window.scrollTo === 'function') window.scrollTo({ top: 0 });
  }, [kind]);

  if (!kind) return <ReportList headingRef={headingRef} />;
  return (
    <ReportView
      key={kind}
      kind={kind}
      filters={filters}
      onFilters={setFilters}
      options={options}
      onOptions={setOptions}
      headingRef={headingRef}
    />
  );
}

function ReportList({ headingRef }: { headingRef: RefObject<HTMLHeadingElement | null> }) {
  return (
    <div className="screen reports-screen">
      <div className="screen-head">
        <a className="btn btn-link btn-sm back-link" href={href('admin')}>
          <Icon name="back" size={18} /> Board tools
        </a>
        <h1 className="screen-title" ref={headingRef} tabIndex={-1}>
          Reports
        </h1>
        <p className="screen-sub">
          Each report is read from TMA's Google Sheet when you open it, so it always matches the sheet. Download it for a
          spreadsheet or print it.
        </p>
      </div>
      <ul className="card list" aria-label="Reports">
        {REPORTS.map((r) => (
          <li key={r.kind}>
            <a className="list-row" href={href('reports', { kind: r.kind })}>
              <span className="list-icon">
                <Icon name={r.icon} />
              </span>
              <span className="list-main">
                <span className="list-title">{r.title}</span>
                <span className="muted small">{r.summary}</span>
              </span>
              <Icon name="chevron" />
            </a>
          </li>
        ))}
      </ul>
      <p className="muted small">
        Reports only read the sheet; they never change it. Some list families' contact details, so keep downloads and
        printouts private.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// One report
// ---------------------------------------------------------------------------

interface ViewProps {
  kind: ReportKind;
  filters: FilterState;
  onFilters(next: FilterState): void;
  options: ReportOptions | null;
  onOptions(options: ReportOptions): void;
  headingRef: RefObject<HTMLHeadingElement | null>;
}

function ReportView({ kind, filters, onFilters, options, onOptions, headingRef }: ViewProps) {
  const { api, data } = useApp();
  const toast = useToast();
  const info = INFO.get(kind)!;
  const resultsId = useId();
  const resultsRef = useRef<HTMLHeadingElement>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [confirming, setConfirming] = useState(false);

  const paramsKey = JSON.stringify(reportParams(kind, filters));
  const runKey = useDebouncedValue(paramsKey, FILTER_DELAY_MS);

  useEffect(() => {
    const params = JSON.parse(runKey) as ApiParams<'admin.report'>;
    if (badRange(params.filters)) return; // the To field says why
    let current = true;
    setLoading(true);
    setError(null);
    api.call('admin.report', params).then(
      (res) => {
        if (!current) return;
        setReport(res.report);
        onOptions(res.options);
        setLoading(false);
      },
      (err: unknown) => {
        if (!current) return;
        setReport(null); // never leave numbers on screen that don't match the filters
        setError(errorMessage(err));
        setLoading(false);
      },
    );
    return () => {
      current = false;
    };
  }, [api, runKey, attempt, onOptions]);

  // After a report runs, take focus to its results, unless the person has moved on (e.g. to a filter).
  useEffect(() => {
    if (!report) return;
    const active = document.activeElement;
    const idle = !active || active === document.body || active.id === 'main' || active === headingRef.current;
    if (idle) resultsRef.current?.focus();
  }, [report, headingRef]);

  const rerun = useCallback(() => setAttempt((n) => n + 1), []);
  const shown = report; // ReportView is keyed by kind, so this is always this kind's report
  const summary = shown ? filterSummary(shown, options) : '';
  const rows = shown?.rows.length ?? 0;

  function save() {
    if (!shown) return;
    setConfirming(false);
    const fileName = reportFileName(shown.kind, shown.generatedAt);
    try {
      downloadCsv(fileName, reportToCsv(shown, { filters: summary }));
      toast(`Downloaded ${fileName}.`);
    } catch {
      toast("We couldn't make the file. Please try again.", 'error');
    }
  }

  const status = loading
    ? shown
      ? 'Updating the report…'
      : 'Loading the report…'
    : shown
      ? `${shown.title}: ${plural(rows, 'row')}.`
      : '';

  return (
    <div className="screen reports-screen">
      <div className="screen-head">
        <a className="btn btn-link btn-sm back-link no-print" href={href('reports')}>
          <Icon name="back" size={18} /> All reports
        </a>
        <div className="report-heading">
          <div>
            <p className="eyebrow print-only">{data.settings.orgName}</p>
            <h1 className="screen-title" ref={headingRef} tabIndex={-1}>
              {info.title}
            </h1>
            <p className="screen-sub">{info.summary}</p>
          </div>
          <button type="button" className="icon-button no-print" onClick={rerun} aria-label="Run the report again">
            <Icon name="refresh" />
          </button>
        </div>
      </div>

      {REPORT_FILTERS[kind].length > 0 ? (
        <FilterCard kind={kind} filters={filters} onFilters={onFilters} options={options} />
      ) : null}

      <p className="visually-hidden" role="status">
        {status}
      </p>

      <section className="section report-result" aria-labelledby={resultsId} aria-busy={loading || undefined}>
        <h2 id={resultsId} ref={resultsRef} tabIndex={-1} className="section-title no-print">
          Results{' '}
          {shown ? <span className="section-aside">{plural(rows, 'row')}</span> : null}
          {loading && shown ? (
            <span className="section-aside report-updating" aria-hidden="true">
              <Spinner /> Updating…
            </span>
          ) : null}
        </h2>

        {error ? (
          <div className="card">
            <ErrorState message={error} onRetry={rerun} />
          </div>
        ) : null}

        {!shown && loading ? <ReportSkeleton /> : null}

        {shown ? (
          <div className={`report-body${loading ? ' is-updating' : ''}`}>
            <div className="report-about">
              <p>{shown.description}</p>
              <p className="muted small">
                Generated {formatStamp(shown.generatedAt)}
                {summary ? ` · ${summary}` : ''}
              </p>
            </div>

            {rows > 0 ? (
              <div className="report-actions no-print">
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => (shown.containsContactInfo ? setConfirming(true) : save())}
                >
                  <Icon name="download" size={18} /> Download CSV
                </button>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => window.print()}>
                  Print
                </button>
              </div>
            ) : null}

            {shown.containsContactInfo && rows > 0 ? (
              <p className="callout callout-warning small">
                <Icon name="lock" size={16} />
                <span>This report has people's {contactDetails(shown)}. Keep it private.</span>
              </p>
            ) : null}

            {shown.notes && shown.notes.length > 0 ? (
              <ul className="report-notes small" aria-label="Notes">
                {shown.notes.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            ) : null}

            {rows > 0 ? <ReportTable report={shown} /> : <ReportEmpty report={shown} />}
          </div>
        ) : null}
      </section>

      <ConfirmDialog
        open={confirming}
        title="Download contact details?"
        message={<p>This file has people's {shown ? contactDetails(shown) : 'contact details'}. Keep it private.</p>}
        confirmLabel="Download CSV"
        onConfirm={save}
        onCancel={() => setConfirming(false)}
      />
    </div>
  );
}

function ReportSkeleton() {
  return (
    <div className="card" aria-hidden="true">
      <Skeleton width="85%" height={14} />
      <Skeleton width="55%" height={14} />
      <Skeleton width="100%" height={120} className="mt-8" />
    </div>
  );
}

function ReportEmpty({ report }: { report: Report }) {
  let title = 'Nothing to show';
  let text = REPORT_FILTERS[report.kind].length > 0 ? 'Nothing matches these filters. Try other choices above.' : 'There is nothing to list.';
  if (report.kind === 'open-items') {
    title = 'All caught up';
    text = 'Nothing is waiting on the treasurer.';
  } else if (report.kind === 'trip-balances' && !report.filters.includePaid) {
    title = 'Nobody owes anything here';
    text = 'Turn on "Include paid in full" to list everyone.';
  }
  return (
    <div className="card">
      <EmptyState icon={report.kind === 'open-items' ? 'check' : 'info'} title={title}>
        {text}
      </EmptyState>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

function FilterSelect({ label, hint, value, onChange, children }: { label: string; hint?: string; value: string; onChange(value: string): void; children: ReactNode }) {
  const id = useId();
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <select
        id={id}
        className="input select"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-describedby={hint ? `${id}-hint` : undefined}
      >
        {children}
      </select>
      {hint ? (
        <p className="field-hint" id={`${id}-hint`}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

function FilterCard({
  kind,
  filters,
  onFilters,
  options,
}: {
  kind: ReportKind;
  filters: FilterState;
  onFilters(next: FilterState): void;
  options: ReportOptions | null;
}) {
  const { data } = useApp();
  const titleId = useId();
  const uses = REPORT_FILTERS[kind];
  const set = (patch: Partial<FilterState>) => onFilters({ ...filters, ...patch });
  // Until the first report answers, the sheet's schools and groups come from the app's settings.
  const schools = options?.schools ?? data.settings.schools;
  const ensembles = options?.ensembles ?? data.settings.ensembles;
  const activities = options?.activities ?? [];
  const open = activities.filter((a) => a.open);
  const closed = activities.filter((a) => !a.open);
  const year = schoolYear(todayIso());
  const isSchoolYear = filters.from === year.from && filters.to === year.to;
  // "Use this school year" goes away once pressed: its focus moves to the hint that replaces it,
  // so keyboard and screen-reader users don't land on the page itself.
  const datesHintRef = useRef<HTMLParagraphElement>(null);
  const focusDatesHint = useRef(false);
  useLayoutEffect(() => {
    if (isSchoolYear && focusDatesHint.current) datesHintRef.current?.focus();
    focusDatesHint.current = false;
  }, [isSchoolYear]);

  return (
    <form className="card report-filters no-print" aria-labelledby={titleId} onSubmit={(e) => e.preventDefault()}>
      <div>
        <h2 id={titleId} className="card-title card-title-sm">
          Filters
        </h2>
        <p className="field-hint">The report updates when you change these.</p>
      </div>

      {uses.includes('activity') ? (
        <FilterSelect
          label="Activity"
          value={filters.activityId}
          onChange={(activityId) => set({ activityId })}
          hint={kind === 'trip-balances' ? 'Closed activities show only when you pick one.' : undefined}
        >
          <option value="">{kind === 'trip-balances' ? 'All open activities' : 'All activities'}</option>
          {filters.activityId && !activities.some((a) => a.id === filters.activityId) ? (
            <option value={filters.activityId}>{filters.activityId}</option>
          ) : null}
          {open.length > 0 ? (
            <optgroup label="Open">
              {open.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </optgroup>
          ) : null}
          {closed.length > 0 ? (
            <optgroup label="Closed">
              {closed.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </optgroup>
          ) : null}
        </FilterSelect>
      ) : null}

      {uses.includes('school') || uses.includes('ensemble') ? (
        <div className="field-row field-row-wide">
          {uses.includes('school') ? (
            <FilterSelect label="School" value={filters.school} onChange={(school) => set({ school })}>
              <option value="">All schools</option>
              {schools.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </FilterSelect>
          ) : null}
          {uses.includes('ensemble') ? (
            <FilterSelect label="Group" value={filters.ensemble} onChange={(ensemble) => set({ ensemble })}>
              <option value="">All groups</option>
              {ensembles.map((e) => (
                <option key={e} value={e}>
                  {e}
                </option>
              ))}
            </FilterSelect>
          ) : null}
        </div>
      ) : null}

      {uses.includes('dates') ? (
        <fieldset className="fieldset">
          <legend className="field-label">Dates</legend>
          <div className="field-row">
            <TextField label="From" type="date" value={filters.from} max={filters.to || undefined} onChange={(e) => set({ from: e.target.value })} />
            <TextField
              label="To"
              type="date"
              value={filters.to}
              min={filters.from || undefined}
              onChange={(e) => set({ to: e.target.value })}
              error={badRange(filters) ? 'The end date must be on or after the start date.' : null}
            />
          </div>
          <p className="field-hint report-dates-hint" ref={datesHintRef} tabIndex={-1}>
            {isSchoolYear ? 'This school year (July 1 to June 30).' : 'Blank dates use the school year.'}
            {!isSchoolYear ? (
              <button
                type="button"
                className="btn btn-link btn-sm"
                onClick={() => {
                  focusDatesHint.current = true;
                  set(year);
                }}
              >
                Use this school year
              </button>
            ) : null}
          </p>
        </fieldset>
      ) : null}

      {uses.includes('includePaid') ? (
        <CheckboxField
          asSwitch
          label="Include paid in full"
          description="Also list students with nothing left to pay."
          checked={filters.includePaid}
          onChange={(includePaid) => set({ includePaid })}
        />
      ) : null}
    </form>
  );
}

// ---------------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------------

const SIMPLE_EMAIL = /^[^\s@<>()"',;:]+@[^\s@<>()"',;:]+\.[a-z]{2,}$/i;

/** A table with more columns than this may grow past the 640px column of text on wide screens. */
const NARROW_COLUMNS = 3;

/** A text column with a cell longer than this wraps at 11–18rem instead of stretching the table. */
const LONG_TEXT = 32;

function cellClass(c: ReportColumn): string | undefined {
  if (c.type === 'money' || c.type === 'number') return 'num';
  if (c.type === 'date' || c.type === 'phone') return 'nowrap';
  return undefined;
}

/** A cell as people read it: "$1,234.50", "1,024", "Oct 21, 2026", tappable emails and phones. */
export function formatCell(value: ReportCell | undefined, c: ReportColumn): ReactNode {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') {
    if (c.type === 'money') return formatCents(value);
    return value.toLocaleString('en-US');
  }
  if (c.type === 'date') return formatReportDate(value);
  if (c.type === 'email' && SIMPLE_EMAIL.test(value)) return <a href={`mailto:${value}`}>{value}</a>;
  if (c.type === 'phone') {
    const digits = value.replace(/[^\d+]/g, '');
    if (digits.replace(/\D/g, '').length >= 7) return <a href={`tel:${digits}`}>{value}</a>;
  }
  return value;
}

/**
 * Keyboard focus stays clear of the pinned first column. Browsers scroll a focused link into view
 * only when none of it shows (reports.css scroll-padding covers that), so Tab can still leave one
 * mostly under the column or past the right edge: scroll the table just enough to show it.
 */
function revealFocus(e: FocusEvent): void {
  const wrap = e.currentTarget;
  const lead = e.target.closest('tr')?.firstElementChild;
  if (!lead || lead.contains(e.target)) return; // the table itself, or a pinned cell
  const ring = 6; // the focus ring: 2px offset, 3px outline, 1px to spare
  const start = lead.getBoundingClientRect().right + ring;
  const end = wrap.getBoundingClientRect().left + wrap.clientLeft + wrap.clientWidth - ring;
  const r = e.target.getBoundingClientRect();
  if (r.left < start) wrap.scrollLeft -= start - r.left;
  else if (r.right > end) wrap.scrollLeft += Math.min(r.right - end, r.left - start);
}

function ReportTable({ report }: { report: Report }) {
  const captionId = useId();
  const columns = useMemo(() => displayColumns(report.columns), [report.columns]);
  const totals = columnTotals(report);
  const extras = extraTotals(report);
  const hasTotals = Object.keys(totals).length > 0;
  const [first, ...rest] = columns;
  const long = useMemo(
    () =>
      new Set(
        report.columns
          .filter((c) => c.type === 'text' && report.rows.some((r) => String(r[c.key] ?? '').length > LONG_TEXT))
          .map((c) => c.key),
      ),
    [report],
  );
  /** A cell's content, in a wrapper that sets how wide its column may get (see reports.css). */
  const content = (value: ReportCell | undefined, c: ReportColumn, lead = false) => {
    const text = formatCell(value, c);
    if (text === null) return null;
    if (long.has(c.key)) return <span className="cell-wrap">{text}</span>;
    return lead ? <span className="cell-lead">{text}</span> : text;
  };

  return (
    // A labelled, focusable region so keyboard users can scroll the table sideways.
    <div
      className={`report-table-wrap${columns.length > NARROW_COLUMNS ? ' is-wide' : ''}`}
      role="region"
      aria-labelledby={captionId}
      tabIndex={0}
      onFocus={revealFocus}
    >
      <table className="report-table">
        <caption id={captionId} className="visually-hidden">
          {report.title}: {plural(report.rows.length, 'row')}
          {hasTotals || extras.length > 0 ? ', totals at the end' : ''}
        </caption>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col" className={cellClass(c)}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {report.rows.map((row, i) => (
            <tr key={i}>
              <th scope="row" className={cellClass(first)}>
                {content(row[first.key], first, true)}
              </th>
              {rest.map((c) => (
                <td key={c.key} className={cellClass(c)}>
                  {content(row[c.key], c)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {hasTotals || extras.length > 0 ? (
          <tfoot>
            {hasTotals ? (
              <tr>
                <th scope="row">
                  Total
                  {first.key in totals ? <span className="num"> {formatCell(totals[first.key], first)}</span> : null}
                </th>
                {rest.map((c) => (
                  <td key={c.key} className={cellClass(c)}>
                    {c.key in totals ? formatCell(totals[c.key], c) : null}
                  </td>
                ))}
              </tr>
            ) : null}
            {extras.map((x) => (
              <tr key={x.key}>
                <th scope="row">{x.label}</th>
                {rest.map((c) => (
                  <td key={c.key} className={cellClass(c)}>
                    {x.column && c.key === x.column.key ? formatCell(x.value, c) : null}
                  </td>
                ))}
              </tr>
            ))}
          </tfoot>
        ) : null}
      </table>
    </div>
  );
}
