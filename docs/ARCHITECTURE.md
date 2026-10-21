# TMA Family App: Architecture & Behavior Spec

This is the reference for how the app works. It is written for the volunteers who
will maintain it and for contributors adding features. Contracts live in code:

| Contract | File |
| --- | --- |
| Domain + API types | `src/shared/types.ts` |
| Sheet tabs, headers, settings, secrets | `src/shared/schema.ts` |
| Money helpers (cents, fee gross-up) | `src/shared/money.ts` |
| Backend ports (`Services`) + `App` interface | `src/server/services.ts` |

## 1. Goals (from the conversation with TMA's president)

* About 300 families. Today TMA runs on **one Google Sheet + Gmail + Facebook**, with
  everything uploaded by hand. The school cannot share family emails, so families
  must be able to **sign themselves up**.
* **No new spending.** Everything must run on free tiers: TMA's own Google account, GitHub,
  and Cloudflare's free Workers plan (the app's host and push notifications). The one fixed cost is
  the app's web address `mytma.org` (Cloudflare Registrar, about $10–12 a year, renewing every
  October; registered October 2026), which must stay on auto-renew: whoever holds the name controls
  the app's origin. One opt-in exception: email from
  `noreply@mytma.org` uses Cloudflare Email Sending, which needs the Workers Paid plan ($5 a month,
  3,000 emails included). With `EMAIL_VIA = gmail`, or whenever the Worker can't send, email goes
  out with TMA's Gmail for free (§6).
* Families can:
  * see each student's **earmarked activity-fund balance** and history,
  * see **trip/activity costs, what's paid and what's left**,
  * **apply (redeem) activity funds** to a trip; the treasurer approves,
  * **pay the rest online** (PayPal, Venmo, or debit/credit card through PayPal) or by check,
  * **choose which notifications they get** (High School / Middle School / Elementary,
    Band / Marching Band / Jazz Band / Orchestra / Chorus / Guitar, and topics),
  * get **push notifications** (and optionally email or text), for example "You just got $50 added to your TMA funds".
* The treasurer keeps working in **the same spreadsheet**. The app reads it, reconciles
  balances, notices changes and notifies families.
* **Minimal personal data**: parent name, email, optional cell, and each student's name,
  grade, school and groups. No addresses, SSNs or card numbers.

## 2. Components

```
 Parents' phones (PWA)                      TMA's Google account (free)
┌───────────────────────┐   HTTPS POST   ┌───────────────────────────────────────────┐
│ React app (src/web)   │ ─────────────▶ │ Apps Script web app  (apps-script/Code.js)│
│ Service worker (push, │  text/plain    │   = src/gas adapters + src/server core    │
│ offline cache)        │  JSON          │        │ reads/writes                     │
└──────────▲────────────┘                │        ▼                                  │
           │ Web Push                    │ Google Sheet (treasurer's ledger; Devices │
┌──────────┴────────────┐                │   tab = browsers' push subscriptions)     │
│ Browser push services │                │ MailApp (email fallback), time triggers   │
│ (Google, Apple,       │                │ UrlFetchApp → push Worker, PayPal REST,   │
│ Mozilla, Microsoft)   │                │               Twilio (optional, paid)     │
└──────────▲────────────┘                └─────────────────────┬─────────────────────┘
           │ encrypted, VAPID-signed                           │ POST /send (≤ 5 each), /email
┌──────────┴───────────────────────────────────────────────────▼─────────────────────┐
│ tma-push: Cloudflare Worker (workers/push). Stateless Web Push sender: VAPID       │
│ signing + RFC 8291 encryption. Also sends the app's email as noreply@mytma.org     │
│ (Cloudflare Email Sending, Workers Paid). Its KV holds only its VAPID key pair     │
│ and the SHA-256 of the relay secret Apps Script registered (no family data).       │
└────────────────────────────────────────────────────────────────────────────────────┘
           Email Sending ▶ families' inboxes (From noreply@mytma.org, Reply-To SUPPORT_EMAIL)
           PayPal JS SDK buttons in the page ⇄ PayPal (orders created/captured server-side)
```

* **App hosting** (free): `https://mytma.org`, the Cloudflare Worker `tma-app` (`workers/app`) serving
  `dist/` through its static-assets binding, built and published by
  `.github/workflows/deploy-app-cloudflare.yml` with the push Worker's two repository secrets. The
  `mytma.org` registration and zone are in that same Cloudflare account (moving accounts:
  `docs/SETUP.md` §5F). The only build setting is `VITE_API_URL` (the Apps Script `/exec` URL). While it is unset the
  workflow builds against TMA's test spreadsheet (`TEST_API_URL` in the workflow); going live means
  setting it. The run summary names the backend either way. See §9.2.
* **One origin for the live app.** localStorage (session token, cached bootstrap with students' names
  and balances, §10 "Live and demo in one build") is per origin, not per path, and every GitHub Pages
  site of one owner shares `https://<owner>.github.io`. So the live build is served only from
  `mytma.org`: `tma-app` redirects `www.mytma.org` and any `*.workers.dev` address there, and
  `.github/workflows/deploy-pages.yml` publishes a **demo-only** build to GitHub Pages
  (`VITE_API_URL` forced empty, whatever the variable says).
* **Push Worker** (free): `workers/push`, a Cloudflare Worker deployed by
  `.github/workflows/deploy-push-worker.yml`, live at `https://tma-push.coleciprari.workers.dev`
  (Settings `PUSH_RELAY_URL`). Apps Script keeps each browser's push subscription in the Devices tab
  and asks the Worker to deliver. The Worker knows no families. See §9 and §9.1.
* **Email** (Workers Paid, $5 a month): the same Worker sends every email as
  `Timberlane Music Association <noreply@mytma.org>` through Cloudflare Email Sending; replies go to
  Settings `SUPPORT_EMAIL`. MailApp (TMA's Gmail) is the fallback, and the only route with
  `EMAIL_VIA = gmail`. See §6 "Email delivery".
* **Demo mode**: the browser runs the *same backend core* (`src/server`) against an in-memory,
  localStorage-persisted copy of the sample sheet (`src/demo`). PayPal and push are simulated. A build
  without `VITE_API_URL` is always the demo. A live build opens the demo when the address has `?demo`
  (or someone taps *See a demo with sample data* on the sign-in screen) and keeps it in that browser
  until **Exit demo** (§10 "Live and demo in one build"). So `https://mytma.org/?demo` stays the
  board's prototype link after the site goes live.

### Directory layout

```
src/shared/   isomorphic types, schema, money helpers (no runtime deps)
src/server/   backend core: pure synchronous TS; depends only on Services ports
src/gas/      Apps Script adapters + entry points; bundled to apps-script/Code.js
src/demo/     browser wiring of the core with in-memory services (demo mode)
src/web/      React PWA: screens, components, api client, push, install, PayPal UI, sw.ts
apps-script/  Code.js (generated, committed so volunteers can copy/paste), appsscript.json
workers/push/ Cloudflare Worker that delivers Web Push (own package.json, tests, wrangler.toml)
workers/app/  Cloudflare Worker that serves the built app at https://mytma.org (tests, wrangler.toml)
scripts/      build-gas.mjs, make-icons.mjs
docs/         this spec, SETUP, SHEET, PAYMENTS, BOARD-FAQ
e2e/          Playwright tests (demo, demo inside a live build) and README screenshots
```

## 3. Sheet ↔ domain mapping rules (src/server/data.ts)

* Headers are matched with `normalizeHeader` and `TABLES[...].aliases`.
* **Booleans**: `TRUE/FALSE`, `Y/N`, `Yes/No`, `x`, `1/0`, real booleans. Blank means the column default.
* **Lists** (Ensembles, Schools): split on `,` `;` `/` or newline, trim, drop empties,
  and match known names case-insensitively, canonicalizing to the Settings spelling.
  Unknown names are kept as typed.
* **Dates**: `Date` objects, `YYYY-MM-DD`, `M/D/YYYY`, `M/D/YY`, or sheet serial numbers.
  Use the calendar date: getFullYear/getMonth/getDate of the Date as the store returns it, which is
  in the script time zone (`America/New_York`, from `appsscript.json`). The Apps Script SheetStore
  makes that true even when the **spreadsheet's** time zone (*File → Settings*) differs from the
  script's, for example a file uploaded and converted in UTC. Sheets keeps wall-clock values in the
  spreadsheet's zone, so in that case every `Date` read is rebuilt with the sheet's wall-clock time in
  the script zone (`Utilities.formatDate`, memoized per instant), and every `Date` written gets the
  script zone's wall-clock time in the sheet zone (`Utilities.parseDate`). A typed `10/21/2026` stays
  Oct 21, app timestamps (Last Seen, Sent, Log At) round-trip exactly, and the treasurer sees New York
  times. When the two zones match, nothing is converted.
* **Money**: `dollarsToCents`. Writes use `centsToDollars`.
* **Emails**: trim + lower-case. Families match on `Email` or `Parent 2 Email`.
* **Status** blank means `Active` for Families/Students (treasurer rows), `Going` for Enrollments,
  `Open` for Activities, `Completed` for Payments, `Pending` for Redemptions.
* **IDs**: new Family/Student IDs are `F`/`S` + 4-digit zero-padded, one above the highest ID still
  **referenced anywhere**, not just in Families/Students: StudentIDs in Students, Ledger, Enrollments,
  Payments, Redemptions and `_Snapshot`; FamilyIDs in Families, Students.FamilyID and
  Redemptions.FamilyID. Deleting a family's rows therefore never lets a new sign-up inherit its funds,
  enrollments, payments or requests through a reused ID. Redemption IDs are `R-` + first 8 hex chars of a uuid. Announcement IDs are `A-` + 8 hex.
  Treasurer rows may have any ID text. Students with blank `StudentID` are ignored (logged).
* `Ledger` rows with blank StudentID or zero amount are ignored.
* **Never** store derived values in treasurer tabs except the documented columns
  (Redemptions.Status/Decided/…, Announcements.Sent, Families/Students rows created by sign-up).

### Computations (src/server/ledger.ts)

* `balance(student)` = Σ ledger.amount for that student (all rows, any activity).
* `pending(student)` = Σ amount of `Pending` redemptions for that student.
* `available(student)` = max(0, balance − pending).
* Activity account per **Enrollment** with status `Going` or `Waitlist` (Withdrawn is hidden
  unless something was paid):
  * `paidFromFunds` = −Σ ledger.amount where `activityId` matches.
  * `paidDirect` = Σ payments.amount with status `Completed` for that student+activity.
  * `pendingPayment` = Σ payments.amount with status `Pending` (still clearing, e.g. an eCheck);
    exposed as `ActivityAccount.pendingPaymentCents`.
  * `remaining` = max(0, cost − paidFromFunds − paidDirect − pendingPayment). A payment that is still
    clearing isn't "paid", but reminders, "Left to pay", the `createOrder` limit and the room for fund
    requests never ask for that money again.

## 4. Authentication (src/server/auth.ts)

Passwordless email codes. No Google account is required for parents.

1. `auth.requestCode {email}`: validate the format. Rate limit is 5 codes per email per hour
   (cache key `otp-rl:<email>`). Codes share the day's email quota with notifications, and Apps Script
   can't see who is asking, so for emails TMA hasn't verified (not in `ADMIN_EMAILS`, not a guardian
   of an **Active** household) there are two more limits: Settings `NEW_SIGNUPS_PER_HOUR` (default 30,
   1–500) codes per hour script-wide (`otp-rl:new-emails`), and none once the quota is down to the last
   `KNOWN_EMAIL_CODE_RESERVE` = 40 recipients, which are kept for known emails. Pending households'
   guardians and emails that only have Preferences or Devices rows count as new: anyone can sign in
   and create those, or type any address as a Pending household's second guardian. The code to a new
   email is sent with `mailer.send(msg, {reserve: 40})`, so a mailer whose `remainingQuota()` is a
   relay's allowance keeps the reserve on its backup sender too (Apps Script: Gmail, while the Worker
   can't send) and throws `MailReserveError` instead. Each answers `RATE_LIMITED` ("new sign-ups are
   paused for a while"), logs, and writes one `auth` Log row per hour. Then generate a 6-digit code
   and email it with subject "Your TMA sign-in code: 123456"; only once it is sent, store
   `hmac(TOKEN_SECRET, email+code)` in cache `otp:<email>` for 10 minutes with `attempts=0`. So a
   refused request, or a send that fails, never replaces a code already emailed. **Always**
   respond `{sent:true}` whether or not the email is known; anyone may sign up.
   In `mode==='demo'` also return `devCode` and skip email.
2. `auth.verifyCode {email, code}`: allow at most 5 attempts per issued code. On success, delete
   the code and return a session token.
3. **Session token**: `base64url(JSON{e:email, v:TOKEN_VERSION, x:expiryEpochSeconds}) + "." + hmacHex`.
   Expiry is `SESSION_DAYS` (default 120). Every request re-checks the signature, expiry and
   `v == Settings.TOKEN_VERSION`. Bumping TOKEN_VERSION signs everyone out.
   Family membership and admin status are **looked up on every request** (never trusted from the token).
4. `TOKEN_SECRET` is created by `setup()` (64 random hex chars) if missing. If it is missing at
   request time, answer `NOT_CONFIGURED`.
5. **Admins** are the emails in `Settings.ADMIN_EMAILS` (comma-separated). Admins may also be parents.

## 5. API (src/server/app.ts → router)

Transport: `POST <exec-url>` with `Content-Type: text/plain;charset=utf-8` (avoids a CORS
preflight, which Apps Script cannot answer). The body is `ApiRequest` JSON and the response is `ApiResponse` JSON.
`handle()` never throws. Unknown action → `BAD_REQUEST`. Unexpected exceptions → `INTERNAL`
(logged, message generic). Every action except the two `auth.*` ones requires a valid token
(`UNAUTHORIZED`). `admin.*` requires an admin (`FORBIDDEN`).
Validate every param defensively (types, lengths: names ≤ 80, notes ≤ 500, title ≤ 120, body ≤ 2000).

Writes run inside `services.withLock`. Notifications a write produces are only planned under the lock
and sent after it is released (§6), so slow email, push or SMS calls never keep other writes waiting.

| Action | Behavior |
| --- | --- |
| `me.bootstrap` | Build `Bootstrap` for the caller (see §5.1). |
| `household.save` | See §5.2. Returns fresh Bootstrap. |
| `prefs.save` | Sanitize: channel/topic booleans; schools/ensembles must be in Settings lists; `smsPhone` must be a US/Canada (NANP) number: 10 digits, or 11 starting with 1, with a valid area code and exchange; anything else, including international and premium numbers, is removed (stored prefs are re-sanitized on read). Upsert `Preferences` row for the caller's email. `sms` may only be true when `Settings.SMS_ENABLED` and a phone is set. |
| `push.register` | `token` is the browser's `PushSubscription` as JSON (≤ 4096 chars), checked the way the push Worker checks it (`src/server/push-subscription.ts`): endpoint `https://` on the default port, no credentials, ≤ 2048 chars, host on the Worker's allowlist (§9.1; otherwise `BAD_REQUEST` "This browser's push service isn't supported. Try Chrome, Safari, Firefox or Edge."); `p256dh` a 65-byte P-256 point, `auth` 16 bytes (base64url or base64). Stored as the canonical token `{"endpoint","keys":{"p256dh","auth"}}`: host lower-cased, keys base64url without padding, no `expirationTime`. In `mode==='demo'` only, a `demo-…` token is accepted instead. Anything else (including old-style tokens) → `BAD_REQUEST`. Rate limit 30 per email per hour. Upsert `Devices` **by endpoint**, so a browser that re-subscribes with new keys updates its row: set Email, FamilyID, Token, User Agent, Last Seen. The device moves to whoever signs in on it. Max 10 devices per email; drop the least recently seen. Returns the device count for the email. |
| `push.unregister` | `token` is the stored token or the browser's raw subscription JSON; only its endpoint matters (demo: the `demo-…` token itself). Blank out the **caller's own** rows for that endpoint. Anything unparseable → `BAD_REQUEST`, which the app ignores. |
| `push.test` | Send "Test notification ✅ / Notifications are working on this device." to the caller's devices (push only). |
| `redemption.request` | Caller's family must be Active, the student Active and in the family, the activity Open and `allowFunds`, enrollment Going. Amount is an integer ≥ 100 (=$1) and ≤ available funds and ≤ (remaining − pending requests for that activity). Append a `Redemptions` row (Pending). Notify admins (§6, admin message). |
| `redemption.cancel` | Only the caller's family's own **Pending** request → Cancelled. |
| `payment.createOrder` | Requires `settings.onlinePaymentsEnabled` and `payments.enabled()` (otherwise `NOT_CONFIGURED`). Same ownership checks; activity `allowOnlinePayment`. `minPayment ≤ amount ≤ remaining` (when a payment that is still clearing covers the rest, the message says it is "still being processed"). Fee: `coverFee ? grossUpCents(amount, FEE_PERCENT, FEE_FIXED) : none`. Call `payments.createOrder`. Cache `order:<orderId>` → JSON {email, familyId, studentId, activityId, amountCents, feeCents, grossCents} for 6 h. |
| `payment.captureOrder` | Load the cached order (`NOT_FOUND` if missing/expired) and require the same email. If a Payments row with Reference == captureId or Reference == orderId already exists → return it (idempotent). Before calling PayPal, re-check `remaining` under the write lock (another guardian, a second tab or a clearing payment may have paid meanwhile): an order that would overpay is not captured → `PAYMENT_FAILED` "…paid in the meantime, so this payment was stopped and you were not charged" (skipped after an unconfirmed capture). Call `payments.captureOrder(orderId, 'cap-'+orderId)`. Status COMPLETED **and** grossCents equal to the expected gross → append Payments row {Date today, StudentID, ActivityID, Amount, Fee Covered, Gross, Method 'PayPal', Reference captureId, Payer Email, Status Completed}, log, notify the family (topic `payments`). PENDING → append with Status Pending. DECLINED/FAILED (PayPal definitely took nothing) → `PAYMENT_FAILED`. `UNKNOWN` or a thrown gateway error (network, timeout, 5xx/429, unreadable reply, even after the gateway asked once more with the same `PayPal-Request-Id`) → `INTERNAL` with a message that never says "not charged", a `payment-error` Log row, a "Payment needs review" alert to admins, and the cached order kept and marked unconfirmed so capturing it again records the payment if it went through. The app asks once more by itself before showing "We couldn't confirm your payment". For an order marked unconfirmed, DECLINED/FAILED are treated like UNKNOWN (they are about that attempt only, e.g. PayPal couldn't be reached before capturing), and when it is recorded after all, admins get a "Payment recorded" follow-up (same tag) so nobody adds it again by hand. |
| `admin.overview` | Stats, pending redemptions (with names, available, remaining), pending households with up to 3 match candidates per student (§5.3), last 50 Log rows. Each pending household may carry `warnings`, shown above *Approve*: a pending student whose ID already has Ledger/Enrollments/Payments/Redemptions rows, a non-pending student already linked to a pending household, or Redemptions rows that already carry the household's FamilyID. |
| `admin.decideRedemption` | Pending only (`CONFLICT` otherwise). Approved: if the treasurer already typed a Ledger row with Reference = request id, post nothing more and skip the checks below (one shared check with the sync, so a request is never debited twice). Otherwise re-validate available funds (excluding this request) and remaining; if short → `CONFLICT` with a clear message. Append a Ledger row {Date today, StudentID, Type 'Redemption', Description 'Applied to <activity name>', Amount −x, ActivityID, Reference = request id, Entered By = admin email}. Update the redemption row (Status, Decided, Decided By, Admin Note, Notified=now). Update `_Snapshot` for that student so the sync doesn't double-notify. Notify the family (topic `payments`). Denied: update the row and notify. |
| `admin.reviewHousehold` | approve: Family Status → Active. For each `links` entry: the existing student gets FamilyID=this family and Status Active; the pending student → Status Inactive (and log "merged into"). Remaining pending students of that family → Active. Notify the family: "Your TMA account is verified". reject: Family Status → Inactive, its pending students → Inactive. |
| `admin.announce` | Refuse (`CONFLICT` "already sent N minutes ago") the same title and body sent within the last 15 minutes, so a retry after the app gave up waiting can't send it twice. Append an Announcements row (ID, Date today, Title, Body, Schools, Ensembles, Link, Sent=now) and deliver (§6) on the channels the admin ticked, still filtered by each recipient's prefs. The app waits up to 6 minutes for this and for `admin.runSync` (30 s for everything else). |
| `admin.runSync` | Run `syncTick()` and return its report. |
| `admin.report` | Read-only, no write lock. Validate `kind` and `filters`, build the report from the sheet and return it with the filter choices (`ReportOptions`: activities open first, then by name; Settings schools and groups). See §5.4. |

### 5.1 Bootstrap

* `me`: name from the matching guardian (else the email local-part); familyStatus `None` when no family.
* Students: those whose FamilyID == caller's family and Status != Inactive. `verified` = family Active
  **and** student Active. When not verified, all money fields are 0 and `activities` = [].
* `ledger`/`payments`/`redemptions`: rows for the family's **verified** students only, newest first.
* `announcements`: rows with `Sent` set, matching the caller's prefs audience (§6), newest first, max 50.
  Admins see all. Families with no family record still see "everyone" announcements.
* `events`: date ≥ today, matching prefs, soonest first.
* `activities`: Open activities.
* `prefs`: the stored prefs, or defaults: channels {push:true, email:true, sms:false}, all topics true,
  schools/ensembles = union of their students' (empty if none).
* `settings`: PublicSettings from the Settings tab with defaults. `onlinePaymentsEnabled` =
  `ONLINE_PAYMENTS` true **and** `PAYPAL_CLIENT_ID` set **and** `payments.enabled()`.

### 5.2 household.save (self-service sign-up and profile)

* 1–2 guardians. Name 1–80 chars. Email valid. Phone optional (digits, spaces, `()+-.`, 7–20).
  The caller's email must be one of the guardian emails.
* 0–8 students: first/last name 1–40, grade one of `K,1..12`, school in Settings.SCHOOLS,
  ensembles ⊆ Settings.ENSEMBLES.
* **No family yet**: refuse if any guardian email already belongs to another family (`CONFLICT`:
  "That email is already on a TMA household. Sign in with it or contact TMA."). Create a Family row
  (new ID, Status **Pending**, Member FALSE, Created now). Create Student rows (new IDs, Status **Pending**).
  Notify admins (§6) with "New family signed up: <names> (<n> students). Review in the app.".
* **Existing family** (any status except Inactive): update guardian names/phones. A second guardian
  email may be added or changed. The caller's own email must stay. Students with `id` must belong to
  the family. Update grade/school/ensembles/instrument (names too while the student is Pending; for
  Active students a name change is ignored, and the change is logged for the treasurer).
  Students without `id` are appended as Pending (the family stays Active, and only that student awaits review).
  Students omitted from the input are **not** deleted. Groups on a student's row that aren't in
  Settings.ENSEMBLES (typed by the treasurer, or dropped from the list later) have no checkbox in the
  app, so the form leaves them out and the server keeps them.
* Inactive family → `FORBIDDEN` ("Please contact TMA"). An Inactive (e.g. rejected) household counts
  only for its **first** guardian: someone it listed as second guardian has no household and can sign up
  with their own.
* `leave: true` ("This isn't my household" in the app, shown to a second guardian only): takes the
  caller's email (name, email, phone of the second slot) off the household and saves nothing else;
  `guardians`/`students` are ignored. The first guardian gets `BAD_REQUEST`. The caller can then sign up
  with their own household. Someone may have typed this email as second guardian without asking.

### 5.3 Match candidates

For each Pending student, score Active/treasurer students that are not already in this family:
the last name must match (case-insensitive, letters only). Score = 0.6 for the last-name match + 0.3 if
the first names match exactly (or 0.2 if one is a prefix of the other, e.g. "Alex"/"Alexander") +
0.1 if the grade matches. Keep score ≥ 0.6 and return the top 3 by score, then by balance descending.

### 5.4 Reports (src/server/reports.ts)

Board members get read-only tables computed from the sheet: in the app (*Board tools → Reports*,
`admin.report`, downloadable as CSV) and in the sheet (*TMA App → Reports*). Nothing is stored. Each
report is built fresh from the same `Model` and `Books` the app uses, so its numbers always match what
families and the dashboard see.

* **Cells**: money in integer cents, dates `YYYY-MM-DD`, blanks `null`. `totals` sums the money and number
  columns where a total makes sense. `containsContactInfo` is true for the roster, and for any report
  whose cells hold an email address or phone number (trip balances and payments list parent and payer
  emails; fund activity's *Entered by* is usually a board member's email), so the app can warn before a
  download.
* **Filters**: every filter given is checked, whatever the report: `activityId` must be in Activities,
  `school`/`ensemble` in Settings `SCHOOLS`/`ENSEMBLES` (kept in the Settings spelling), `from`/`to` real
  `YYYY-MM-DD` dates with `from ≤ to`, `includePaid` true or false. Anything else is `BAD_REQUEST` saying
  which. Blank values (`''`, `null`) mean "all". Only the filters the report uses are kept, and
  `report.filters` echoes them with their defaults. Dates default to the **school year** (Jul 1 – Jun 30)
  of today in New York (§3 "Dates"). With only one date given, the other end comes from that date's
  school year.
* **Size**: at most `MAX_REPORT_ROWS` = 5,000 rows. Past that, the first 5,000 in sort order are returned,
  a note says how many there were and how to narrow the report, and the totals still cover every row.
* **Privacy**: admin-only. No push tokens, notification JSON or secrets ever appear. A roster request
  (contact details) adds one Log row, `report` "Roster with contact details (<school, group or all
  students>, N students) viewed by <admin email>", taking the write lock just for that row as auth's
  rate-limit row does; if the lock is busy, only the row is skipped. Other reports log nothing.
* Ledger and Payments rows with no date can't be placed in a date range: they are left out and counted
  in a note.
* A StudentID on two Students rows counts once, as its first row, as everywhere in the app. The
  dashboard's total funds is the Ledger's sum, so a repeated row can't count a balance twice.

| Report | Rows and sort order | Filters | Totals |
| --- | --- | --- | --- |
| `trip-balances` | One per enrollment with status Going, then Waitlist (Withdrawn left out, with a note when one had money paid), by activity name, then student last name, first name, StudentID. Cost, paid from funds, paid directly, **pending** (fund requests + payments still clearing), **left to pay** (`remainingCents`), deposit and its due date, final due date, parent (first guardian), and a status: `Owes`, `Deposit overdue` (deposit date passed and paid + clearing < deposit), `Past due` (final due date passed), `Paid in full`, `Paid (payment clearing)`, `No cost set` or `Waitlist`. | activity (default: **open activities only**), school, group, `includePaid` (default: only rows with something left to pay) | Going rows only |
| `student-funds` | One per Active student (last name, first name): earned (Σ positive Ledger rows), applied (Σ negative rows), balance, pending requests, available, last Ledger date. Unfiltered, a note gives the funds of student IDs not listed (pending, inactive, unknown), so the total matches the dashboard. | school, group | every money column |
| `fundraiser-totals` | Positive Ledger rows in the range grouped by Type + Description (capitals and extra spaces ignored): students credited, total, first and last date. By first date, type, description. | dates | total |
| `fund-activity` | Every Ledger row in the range, oldest first, then sheet order: student, type, description, amount, activity, reference, entered by. | dates, activity | `credits`, `debits`, `net` (keys, not columns) |
| `payments` | Every Payments row in the range, oldest first, then sheet order: amount, fee covered, gross, method, reference, payer email, status. | dates, activity | Completed rows only (a note says so) |
| `roster` | One per Active student (last name, first name): grade, school, groups, instrument, household ID and status, member, both guardians' name, email and phone. | school, group | none |
| `open-items` | Pending fund requests, Pending households, Pending students of verified households, then payments with Status Pending; oldest first within each. Names only, no emails. | none | none |
| `app-usage` | A fixed list of counts: households (all, verified, pending), students, households that used the app (Pending, or a guardian with a Preferences or Devices row), devices, households getting push, email or texts (stored prefs or the defaults, as §6 decides), people with settings but no household. No names. | none | none |

**In the sheet** (`src/gas/reports-sheet.ts`): *TMA App → Reports* has one item per report. Each writes
the report with its default filters to a tab named `Report: <title>` (found by name, capitals ignored,
or added at the end), cleared and rewritten on every run. No other tab is touched, and nothing is
logged (whoever can run the menu can already open Families). Row 1 says "Generated <time> — rebuilt each
time you run it; edit the other tabs, not this one."; row 2 is the bold header; rows 1–2 are frozen.
Money is written in dollars formatted `$#,##0.00`, dates as sheet serial numbers formatted `m/d/yyyy`
(no time zone can shift them), counts `#,##0`. A bold totals row follows, then the description, filters
and notes. Text starting with `=`, `+`, `-`, `@` or `'` gets a leading apostrophe, so Sheets shows it as
typed and never runs it as a formula. The app never reads these tabs: the Store finds its tables by
their exact names (§9), and Set up only creates the tabs in `TABLE_ORDER`.

## 6. Notifications (src/server/notify.ts)

**Recipients** are emails. A family's recipients are its guardian emails. Each recipient's prefs
(stored or default) decide delivery:

* topic must be enabled (`balance`, `payments`, `reminders`, `announcements`). Admin messages
  and push tests ignore topics.
* audience match (announcements/events only): audience both empty → everyone; prefs both empty →
  receives everything; otherwise, if both audience lists are non-empty the recipient needs a match in each.
  If one audience list is empty, a match on the other suffices.
* channels: push → every device token (stored push subscription) for that email (if
  `push.enabled()`); delete tokens that return `invalid` (the browser unsubscribed, or the
  subscription was made with an old Worker key). email → if `EMAIL_ENABLED` and `mailer.remainingQuota()` is above the 20 recipients
  kept back for sign-in codes (`SIGN_IN_EMAIL_RESERVE`; codes and notifications share one quota); skip
  with a log otherwise. Sent with `mailer.sendMany` when the mailer has it (one call for the batch,
  one result per recipient), else `send` one by one; a failed email doesn't use up quota, so the
  next recipients may take its place. Results the mailer marks `quota` (it kept them back for the
  reserve itself, e.g. its Gmail fallback) count as skipped too; once it keeps a whole round back,
  the rest are skipped without asking it again. sms → if `SMS_ENABLED`, `sms.enabled()`, and prefs.smsPhone
  (US/Canada only, §5), and only to guardians of **Active** (TMA-verified) households and to
  `ADMIN_EMAILS`: texts cost TMA money and anyone can sign in and save a number.
  Admin-chosen channels further restrict announcements.
* **When it is sent.** `deliver()` first plans who gets what (reads only). Inside a write (every write
  action, `syncTick`, `dailyTick`; `app.ts` sets `ctx.deliveries`) the plan is queued and
  `flushDeliveries()` sends it after the write lock is released, then takes the lock briefly to drop
  the device tokens the push service rejected (found by token on a fresh read) and write the Log rows.
  It never throws, and queued notices still go out if the action failed afterwards. The counts
  `deliver()` returned are filled in when sent, so `admin.announce`'s `delivered` and the tick reports
  stay right.
* Each delivery batch is logged in `Log` (kind `notify`, detail "topic: title → push n, email n, sms n").

**Email delivery.** Every email (sign-in codes §4, notifications, announcements, admin alerts and the
menu's test) goes through the one `Mailer` port (`remainingQuota()`, `send({to, subject, html,
text})`, and the optional `sendMany(msgs)` for notification batches and `relayStatus()` for the
dashboard); the core doesn't know the route. In Apps Script it is `src/gas/mail.ts` (§9):

1. Settings `EMAIL_VIA` = `cloudflare` (default; anything but `gmail`) **and** the push Worker is
   configured (`PUSH_RELAY_URL` https, `PUSH_RELAY_SECRET` usable) → `POST <PUSH_RELAY_URL>/email`
   with `Authorization: Bearer <PUSH_RELAY_SECRET>`. Each message is `{to, subject, html, text,
   replyTo}` with **one** recipient: subject on one line and at most 300 characters, `replyTo` =
   Settings `SUPPORT_EMAIL` when it is one plain address (else its default). `send()` (sign-in
   codes, the test) posts one message; `sendMany()` (notifications) posts up to 10 per request,
   each request under 200 KB, 5 requests at a time with `UrlFetchApp.fetchAll`, so an announcement
   to every family takes seconds (sent after the write lock is released, see above). The Worker sends From
   `Timberlane Music Association <noreply@mytma.org>` (its own config, never the request), and only
   for the secret pinned by its `EMAIL_KEY` secret (§9.1).
2. `401` → `POST /register` again (at most once per execution, shared with push) and retry once.
3. Anything else that isn't `{status:'ok'}` → log the reason code and send **that** message with
   `MailApp.sendEmail({to, subject, htmlBody, body, name: ORG_NAME, replyTo: SUPPORT_EMAIL})`.
   Sign-in codes therefore always go out. Then, by reason:
   * about one message or recipient (`bad_*`, `no_content`, `content_too_large`,
     `recipient_not_allowed`, `recipient_suppressed`, `delivery_failed`, `invalid_message`, or HTTP
     `400`/`413`) → nothing more; the next email still tries the Worker;
   * a set-up problem (`sender_not_verified`, `account_suspended`, `email_not_configured`,
     `email_key_missing`, `email_key_mismatch`, a `404` from a Worker without `/email`, or a `401`
     that linking again didn't fix) → Gmail for 10 minutes without asking the Worker (CacheService
     `email-worker:paused`);
   * `rate_limited` → Gmail for the rest of the execution;
   * the Worker or Cloudflare failing (no answer, other HTTP statuses, an unreadable answer,
     `send_failed`) 3 times in a row (per request) → Gmail for the rest of the execution and 2
     minutes after it (same cache key), so later executions report Gmail's quota.
4. `remainingQuota()` = 1000 while the Worker route is active (Cloudflare has no per-script daily
   quota), else `MailApp.getRemainingDailyQuota()`. The Gmail fallback of `sendMany()` never goes
   below `SIGN_IN_EMAIL_RESERVE` (those emails come back as failed results marked `quota`), so a
   Worker outage can't spend the reserve on notifications. It reads Gmail's quota before each email
   rather than counting down, because notifications go out after the write lock is released and
   another execution may be sending too. `send()`'s first fallback in an execution always goes:
   that is how sign-in codes go out, and the reserve is theirs. With `{reserve: n}` (a code to a new
   email, §4) any Gmail send first checks that more than `n` are left, else throws
   `MailReserveError`. `sendMany()` starts nothing new after 4 minutes (the rest come back as
   failed), so a big batch ends inside the 6-minute limit.
5. `relayStatus()` → `{from: 'noreply@mytma.org', backupRemaining: <MailApp quota>}` while the
   Worker route is active, so the dashboard shows the Gmail backup's quota rather than 1000.
6. `EMAIL_VIA` = `gmail` → MailApp only; the Worker is never asked.

Logs carry reason codes and HTTP codes only, never addresses, subjects or bodies. In the demo and
tests the mailer is an in-memory recorder.
* Email: HTML with the TMA logo on top when APP_URL is https (`brand/tma-logo-email.png` next to the app
  page APP_URL points at, fixed 120×93 with alt text, so nothing moves when images are blocked), a maroon
  header bar showing the org name, the body paragraphs, a button "Open the TMA app"
  → `APP_URL + url` (button omitted if APP_URL empty), and a footer "You're receiving this because you
  signed up for TMA updates. Change what you get in the app under More → Notifications."
  Always include a plain-text alternative.

**Message copy** (title / body / url):

| When | Title | Body | url |
| --- | --- | --- | --- |
| Funds credited (Δ>0) | `+$50.00 for Avery` | `$50.00 was added to Avery's TMA activity funds. New balance: $325.00.` | `#/funds` |
| Funds reduced, not by the app (Δ<0) | `Avery's activity funds changed` | `−$20.00 adjustment. New balance: $305.00.` | `#/funds` |
| Redemption approved | `Funds applied to Florida 2027` | `$200.00 of Avery's activity funds was applied to Florida 2027. Remaining: $1,050.00.` | `#/trips` |
| Redemption denied | `Funds request not approved` | `Your request to apply $200.00 to Florida 2027 was not approved.` + ` Note: …` | `#/trips` |
| Payment received | `Payment received – thank you!` | `$250.00 toward Florida 2027 for Avery. Remaining: $800.00.` | `#/trips` |
| Payment reminder (N days) | `Florida 2027 payment due in 7 days` | `Avery has $800.00 left to pay by Feb 1. Use activity funds or pay online in the app.` | `#/trips` |
| Event tomorrow | `Tomorrow: Winter Concert` | `7:00 PM at TRHS Auditorium.` (time/location when present, else details) | `#/news` |
| Announcement | its title | its body (first 180 chars for push) | `#/news` |
| Household verified | `You're all set!` | `TMA verified your household. You can now see activity funds and trips.` | `#/` |
| New sign-up (admins) | `New family signed up` | `<names> (<n> students). Review in the app.` | `#/admin` |
| New funds request (admins) | `Funds request: $200.00` | `<parent> asked to apply $200.00 from Avery's funds to Florida 2027.` | `#/admin` |

Use `formatCents`; use first names only for students in notifications (privacy on lock screens).

## 7. Scheduled work (src/server/sync.ts)

`syncTick()` runs every 15 minutes (Apps Script time trigger). Each step catches its own errors
into `report.errors` so one failure doesn't block the rest. Rules for every step:

* **Settle first.** Sheets saves each cell as it is typed, so a row typed in the sheet (an
  announcement, or an Approved/Denied decision) is acted on only once its content (title, body, date,
  audience, link; or status, admin note, amount, IDs, decided-by) has looked the same for at least
  5 minutes (`SETTLE_MS`; first-seen time in CacheService). Any change restarts the wait. In practice it
  goes out at the first sync after the row stops changing, 15–30 minutes after typing. Future-dated rows
  start settling ahead of time, so they still go out on time. `report.waiting` counts rows still
  settling; the Admin screen and the sheet menu say so.
* **Check the columns.** When a step needs a column the tab doesn't have (renamed header, missing tab:
  the Store's optional `columns(table)`), the step is skipped with a clear error instead of reading
  every row as blank. Needed: Redemptions RequestID, StudentID, ActivityID, Amount, Status, Notified;
  the Ledger tab with StudentID, Amount, Reference to post (the app never creates a fresh Ledger tab);
  Announcements Date, Title, Body, Schools, Ensembles, Sent; Payments, Enrollments and Events for the
  daily reminders. The error repeats every tick until the header is fixed.
* **Stamp the right row.** Notices are sent after the lock is released (§6). Before writing `Notified`
  or `Sent`, the tab is read again (`Db.refresh`, the Store's optional `invalidate`) and the stamp goes to
  the row that still holds the same item (same RequestID, or the same announcement content), preferring
  the original row. An item that was deleted or edited meanwhile is left for the next tick. The Ledger
  row is posted before the stamp, so a failure in between can't leave a request Notified without its
  debit.

1. **Sheet-approved redemptions**: for each redemption with Status Approved/Denied and blank
   `Notified`, once settled: if Approved and no Ledger row has Reference == id → append the Ledger row (as in
   `admin.decideRedemption`) and update the snapshot for the student. Notify. Set `Notified` = now
   (and Decided if blank).
2. **Balance changes**: compute all verified-or-not student balances. If `_Snapshot` is empty → write
   it and send nothing (first run). Otherwise for each student whose balance differs from the
   snapshot (new students count as previous 0), notify the family (topic `balance`) if the student
   has a family. Then overwrite `_Snapshot`. If the Ledger has no usable rows but the snapshot has
   non-zero balances (a renamed or emptied tab), refuse and leave `_Snapshot` alone.
3. **Queued announcements**: rows with blank `Sent`, once settled, whose Date is blank or before today,
   or is today and it is 8 AM New York time or later (`ANNOUNCE_FROM_HOUR`; a dated announcement
   shouldn't buzz phones just after midnight): deliver to all matching recipients (all channels
   allowed), set Sent = now. "All recipients" = all guardian emails
   of non-Inactive families **plus** any email in Preferences/Devices (people who signed in but have no family yet).

`dailyTick()` runs once a day around 8 AM:

4. **Payment reminders**: for each activity account with remaining > 0 and a dueDate: for each
   N in REMINDER_DAYS, if dueDate − today == N days → send unless `_Sent` has
   `rem:<studentId>:<activityId>:<N>`. Record the key.
5. **Event reminders**: events whose date is tomorrow → matching recipients (topic `announcements`),
   key `evt:<eventId>`.

## 8. Setup (src/server/setup.ts)

`setup({seedSampleData})`: `ensureTable` for every table in `TABLE_ORDER`. Write missing Settings keys
with their defaults and the `Notes`. Create TOKEN_SECRET if missing. If `seedSampleData` and the Families,
Students and Ledger tables are all empty → write the sample data from `src/server/sample-data.ts`.
Return the `SetupReport`. The Apps Script wrapper (`setupTma`, menu *Set up / repair tabs*) also creates
`PUSH_RELAY_SECRET` and links the push Worker (§9).

### Sample data (also the demo's data), fictional people only

`sampleData(today: Date)` returns rows relative to `today` so the demo never goes stale:
* Families: F0001 Jordan Thompson `parent@example.com` (Active, member); F0002 Priya Nguyen
  `nguyen.family@example.com`; F0003 Marcus Ortiz `ortiz@example.com` (Pending, self-signed-up,
  with a pending student "Sofia Ortiz", who matches treasurer student S0005 Sofia Ortiz).
* Students: S0001 Avery Thompson (11, High School, Band, Marching Band, Jazz Band – trumpet);
  S0002 Liam Thompson (7, Middle School, Chorus); S0003 Maya Nguyen (10, High School, Orchestra – violin);
  S0004 Ethan Nguyen (5, Elementary, Orchestra – cello); S0005 Sofia Ortiz (12, High School, Chorus)
  with no family yet (treasurer-only record, has a balance); S0006 Sofia Ortiz (Pending, F0003).
* Activities: FL27 "Florida 2027 – Disney & Universal" (Trip, $1,850, deposit $350 due in ~25 days,
  final due in ~100 days, HS ensembles, Open, funds+online allowed); CAMP27 "Marching Band Camp 2027"
  (Camp, $275, due ~200 days, Band/Marching Band); LESSONS "TRSD Private Lessons 2026–27" (Lessons,
  cost via Enrollments, funds allowed, online not allowed); NYC25 "New York City 2025" (Trip, Closed).
* Enrollments: S0001 FL27 Going; S0001 CAMP27 Going; S0003 FL27 Going; S0003 LESSONS $360 Going;
  S0005 FL27 Going.
* Ledger: a believable history (Poinsettia sale, Cookie Dough fundraiser, Pizza Night, Car Wash,
  Donation, an earlier Redemption to FL27 deposit) giving Avery ≈ $640, Liam ≈ $85, Maya ≈ $410,
  Ethan ≈ $35, Sofia ≈ $520.
* Payments: S0001 FL27 $350 Check (deposit) Completed.
* Redemptions: one Pending (parent@example.com, S0001 → FL27, $200).
* Announcements (sent): "Florida 2027 deposit reminder", "Winter Concert volunteers needed"
  (HS + Chorus), "Poinsettia credits posted". One unsent row dated in the future.
* Events: HS Winter Concert (+~50 days, 7:00 PM, TRHS Auditorium, High School); MS Winter Concert;
  TMA monthly meeting (+~12 days, 7:00 PM, TRHS Library, everyone); Jazz Night.
* Settings: defaults + `ADMIN_EMAILS = treasurer@example.com`, `ONLINE_PAYMENTS = TRUE`,
  `PAYPAL_CLIENT_ID = demo` (demo only; production keeps defaults).

## 9. Apps Script adapter (src/gas → apps-script/Code.js)

* `scripts/build-gas.mjs` bundles `src/gas/entry.ts` with esbuild (format `iife`, globalName `TMA`,
  target `es2019`, no minify, with a banner comment saying the file is generated) and appends top-level wrappers
  that Apps Script can see: `function doGet(e)`, `function doPost(e)`, `function onOpen()`,
  `function syncTick()`, `function dailyTick()`, `function setupTma()`, `function setupTmaWithSampleData()`,
  `function installTriggers()`, `function sendTestPushToMe()`, `function showTmaStatus()`, and one per
  sheet report (`function reportTripBalances()` … `function reportAppUsage()`, §5.4). A menu item can
  only call a top-level function, so a new report needs its name in this list too.
* `doPost(e)`: parse `e.postData.contents`, call `app.handle`, and return
  `ContentService.createTextOutput(JSON.stringify(res)).setMimeType(JSON)`.
* `doGet(e)`: `?action=health` → `{ok:true, data:{version, time}}`. Otherwise a few lines of plain text pointing to APP_URL. Never an HtmlService page: every page it served would give its visitors `google.script.run`, which calls any top-level function in Code.js as the owner.
* SheetStore: `SpreadsheetApp.getActive()`. The script is **container-bound** (created from the sheet via
  Extensions → Apps Script), so it only ever touches that one spreadsheet. Read with one `getDataRange().getValues()` per table per request (memoize per execution).
  Header row → canonical map via normalizeHeader+aliases. append uses one `setValues` call. Hide `system` tabs.
  Add the header note from `TABLES[t].note` to A1 when creating. Dates are converted between the
  spreadsheet's and the script's time zones when they differ (`SheetTimeZone`, see §3 "Dates"); the
  two zones are looked up once per execution.
* Cache: `CacheService.getScriptCache()`. Lock: `LockService.getScriptLock().waitLock(20000)`.
* Crypto: `Utilities.computeHmacSha256Signature`, uuid via `Utilities.getUuid()`, digits via uuid
  hex → numbers (rejection sampling).
* Mailer (`src/gas/mail.ts`): §6 "Email delivery". Through the push Worker's `POST /email` (via
  the push sender's `authorizedPost` / `authorizedPostAll`, which own the secret and the
  once-per-execution re-register), with `MailApp.sendEmail({to, subject, htmlBody, body, name:
  ORG_NAME, replyTo: SUPPORT_EMAIL})` as the per-message fallback and the only route when
  `EMAIL_VIA = gmail`. It implements `sendMany` and `relayStatus`, and also offers `route()`
  (cloudflare, or gmail and why: `setting`, `no_worker`, `not_linked`, `paused`, `this_run`),
  `lastDelivery()` and `gmailQuota()` for the menu. The push sender's `emailKey()` is the hex
  SHA-256 of `PUSH_RELAY_SECRET`: the value for the Worker's `EMAIL_KEY` secret.
* PayPal gateway: REST v2 via `UrlFetchApp` (`muteHttpExceptions: true`), OAuth client-credentials token
  cached ~8 h in CacheService, base `https://api-m.sandbox.paypal.com` or `https://api-m.paypal.com` per
  PAYPAL_ENV. Create order: intent CAPTURE; one purchase unit with reference_id, custom_id,
  description, items [trip payment, + "Optional processing-fee contribution" when fee>0], amount with breakdown
  item_total; `application_context` {brand_name, shipping_preference NO_SHIPPING, user_action PAY_NOW}
  and **no** `payment_source` (the payer chooses PayPal, Venmo or a card on the buttons after the order
  exists, so a fixed `payment_source.paypal` could contradict the button they press). Capture: POST `/v2/checkout/orders/{id}/capture` with header
  `PayPal-Request-Id`. Parse `purchase_units[0].payments.captures[0]`. Enabled when PAYPAL_CLIENT_ID (Settings) and
  PAYPAL_SECRET (Script Properties) are set.
* **Push relay sender** (`src/gas/push-relay.ts`): the `PushSender`, over the push Worker (§9.1).
  * Worker address: Settings `PUSH_RELAY_URL` (blank = the default
    `https://tma-push.coleciprari.workers.dev`). A value that isn't an `https://` address (e.g. `off`)
    switches push off.
  * Script Properties: `PUSH_RELAY_SECRET`, the shared secret (64 hex chars from `generateSecret`,
    created by Set up; it must be 32–256 characters with no control characters), and
    `PUSH_PUBLIC_KEY`, the Worker's VAPID public key (not secret; saved so page loads don't call the Worker).
  * `enabled()` = a valid URL **and** a valid secret. `publicKey()` = `PUSH_PUBLIC_KEY` when it is a
    valid P-256 key, else GET `/vapid-public-key`, validate and save it; a failed lookup is cached for
    5 minutes so page loads don't wait on an unreachable Worker. `buildSettings` exposes it as
    `PublicSettings.pushPublicKey`: `''` when push is off, and it never throws.
  * `send(tokens, message)`: tokens that aren't subscriptions (demo tokens, rows typed by hand) are
    `invalid` without any request. Payload = JSON `{title, body, url, tag, topic}`, at most 3000 bytes
    of UTF-8 (a long body is shortened with "…", the other fields are clipped). `ttl` 86400; `urgency`
    `normal` for reminders and announcements, `high` otherwise; `topic` = the tag sanitized to
    `[A-Za-z0-9_-]{1,32}`, so a newer push with the same tag replaces an undelivered one.
    **5 messages per `/send` request** (the Worker accepts 10, but its free plan gives each request
    about 10 ms of CPU), up to 20 requests per `UrlFetchApp.fetchAll`, header
    `Authorization: Bearer <PUSH_RELAY_SECRET>`. Results map back one to one; every message of a failed
    request is `error`.
  * Recovery, at most once per execution each: `401` → POST `/register` again (the Worker forgot this
    sheet, e.g. its KV was cleared) and retry; `no_keys` (a `503`, or as the Worker actually answers, a
    `200` whose every result is `no_keys`) → GET `/vapid-public-key` (which creates the pair), save
    `PUSH_PUBLIC_KEY`, retry. Subscriptions are never deleted for either.
  * Logs carry counts, HTTP codes and the Worker's reason codes only: never endpoints, payloads or the
    secret (error text is scrubbed of it).
* **Set up links the push Worker** (`linkPushWorker` in `src/gas/entry.ts`, run by `setupTma`,
  `setupTmaWithSampleData` and *Set up / repair tabs*): under the script lock, create `PUSH_RELAY_SECRET`
  if missing; then, outside the lock, POST `/register` with it (trust on first use) and GET
  `/vapid-public-key` → `PUSH_PUBLIC_KEY`. Each step is reported in the dialog and the log. A `409
  already_registered` ("The push Worker is already linked to a different Apps Script secret…"), an
  unreachable Worker or a non-https `PUSH_RELAY_URL` only adds a ⚠ line: setup never fails because of
  the Worker. After changing `PUSH_RELAY_URL`, run Set up again: the saved key belongs to the old Worker.
* **Status** prints the Worker URL, its `/health` (reachable, linked to a sheet, keys), whether
  `PUSH_PUBLIC_KEY` is saved, and whether push is configured. Secrets are listed by name only.
  "Linked to a sheet" means *some* secret is registered with the Worker, not necessarily this sheet's.
  Its **Email** line shows the route (`from noreply@mytma.org through the push Worker` with
  `/health`'s `email` and `emailKey` as Cloudflare Email Sending ✓/✗ and email key ✓/✗, or
  `with Gmail … because …`), the Reply-To and MailApp's quota left (the fallback), followed by
  *Email key for Cloudflare (Worker secret EMAIL_KEY): <hex>* (the SHA-256, never the secret) unless
  `EMAIL_VIA = gmail`. One `/health` request serves both. **Send me a test
  notification** sends its test email through the same Mailer and says which route delivered it
  (and, for Gmail, the Worker's reason).
* Twilio SMS (optional; costs about 1¢ per text): `TWILIO_*` secrets set → enabled. POST form to
  `https://api.twilio.com/2010-04-01/Accounts/<sid>/Messages.json` with basic auth.
* `onOpen()` adds a sheet menu **TMA App**: Run sync now · Reports ▸ (one item per report, §5.4) · Send me a
  test notification · Set up / repair tabs · Install schedules · Status. `installTriggers()` removes old triggers for these handlers and installs
  syncTick every 15 min and dailyTick at 8 AM.
* An HtmlService page served by this script could call any top-level function in Code.js
  (`google.script.run`), as the owner, for anyone who opens the `/exec` address. `doGet` therefore
  serves plain text (no such page exists), and as a second guard the menu items check who is running
  them first, and do nothing otherwise. The reports, Status and the test notification need the spreadsheet's UI
  (`SpreadsheetApp.getUi()`, which a web request never has). Set up and Install schedules, also run from
  the script editor, need the UI or a signed-in user (`Session.getActiveUser().getEmail()`, blank for a
  web-app visitor under Execute as: Me). The reports and Status return nothing: their output stays in
  the sheet or the dialog (Status shows the email key).
* `appsscript.json`: timeZone `America/New_York`, runtime V8, webapp {executeAs USER_DEPLOYING,
  access ANYONE_ANONYMOUS}, oauthScopes (least privilege): `spreadsheets.currentonly`,
  `script.container.ui`, `script.send_mail`, `script.external_request` (PayPal, the push Worker,
  Twilio), `script.scriptapp`, and `userinfo.email` (the menu's "Send me a test notification" needs
  `Session.getActiveUser().getEmail()`).

### 9.1 Push Worker (workers/push, Cloudflare)

A stateless Web Push sender, and the app's email sender, on Cloudflare Workers. Push is written with WebCrypto only: RFC 8030
delivery, RFC 8292 VAPID (its own P-256 key; the ES256 JWT is cached per push service for 12 hours) and
RFC 8291 `aes128gcm` encryption, so only the subscribed browser can read a notification. Push used to
go through Firebase Cloud Messaging; this Worker replaced it so TMA needs no Firebase project and no
service-account key. The full reference is `workers/push/README.md`.

| Endpoint | Answer |
| --- | --- |
| `GET /health` | `{ok:true, name:'tma-push', registered, hasKeys, email, emailKey}` (`email`: the Email Sending binding is configured; `emailKey`: the `EMAIL_KEY` secret is set) |
| `GET /vapid-public-key` | `{publicKey}`: base64url of the 65-byte uncompressed P-256 point. Creates the key pair on first use; no other endpoint creates keys. |
| `POST /register` `{secret}` (32–256 chars) | `200 {registered:true, first}` the first time, or again with the same secret. `409 {error:'already_registered'}` for any other secret (trust on first use: it grants `/send` only, never `/email`). `400` bad body, `413` over 4 KB. |
| `POST /send`, header `Authorization: Bearer <secret>`, body `{messages:[{subscription:{endpoint, keys:{p256dh, auth}}, payload, ttl?, urgency?, topic?}]}` | `200 {results:[{status:'ok'\|'invalid'\|'error', code?, reason?}]}`, one per message in the same order. `401 {error:'unauthorized'}` (no secret registered, missing or wrong). `400`. `413` for more than 10 messages or over 256 KB. With no key pair yet, `200` with every result `{status:'error', reason:'no_keys'}` and nothing sent. |
| `POST /email`, bearer secret whose SHA-256 is the Worker secret `EMAIL_KEY`, body `{messages:[{to, subject, html?, text?, replyTo?}]}` (1–10) | `200 {results:[{status:'ok', messageId} \| {status:'error', reason, code?}]}` in the same order. `401` for a secret that is neither the pinned nor the registered one; `503 {error:'email_not_configured'}` without the `EMAIL` binding; `503 {error:'email_key_missing'}` without `EMAIL_KEY`; `403 {error:'email_key_mismatch'}` for the registered secret when `EMAIL_KEY` is another; `400` bad body or empty list; `413` over 10 messages or 256 KB. |

* `invalid` (Apps Script deletes the Devices row): `gone` (404/410), `vapid_rejected` (403, e.g. made
  with an old key), `endpoint_not_allowed`, `bad_keys`. `error` (kept; may work next time):
  `payload_too_large`, `rate_limited`, `push_service_error`, `unexpected_status`, `network` (no answer in
  15 s), `bad_payload`, `bad_message`, `internal`, `no_keys`.
* Per message: `payload` a string of at most 3000 bytes of UTF-8; `ttl` default 86400, clamped to
  0–2419200; `urgency` `very-low`, `low`, `normal` or `high` (default `high`); `topic`
  `[A-Za-z0-9_-]{1,32}`.
* `/email`: From is `EMAIL_FROM` / `EMAIL_FROM_NAME` (wrangler.toml `[vars]`: `noreply@mytma.org`,
  `Timberlane Music Association`), never the request; the `[[send_email]]` binding `EMAIL` may only
  send from `noreply@mytma.org`. One plain recipient per message; `to`/`replyTo` plain addresses
  (no display names, lists or CR/LF, ≤ 254 chars), subject 1–300 chars without control characters,
  `html` ≤ 200 KB, `text` ≤ 100 KB, at least one of them: otherwise that message is `error` with
  `bad_to`, `bad_reply_to`, `bad_subject`, `no_content`, `bad_content`, `content_too_large` or
  `bad_message` and is not sent. Cloudflare's thrown codes map to `sender_not_verified`
  (`E_SENDER_NOT_VERIFIED`, `E_SENDER_DOMAIN_NOT_AVAILABLE`), `account_suspended`
  (`E_ACCOUNT_SUSPENDED`), `rate_limited` (`E_RATE_LIMIT_EXCEEDED`, `E_DAILY_LIMIT_EXCEEDED`),
  `recipient_not_allowed` (a recipient/destination not allowed/verified code), `recipient_suppressed`
  (`E_RECIPIENT_SUPPRESSED`), `delivery_failed` (`E_DELIVERY_FAILED`), `content_too_large`
  (`E_CONTENT_TOO_LARGE`), `invalid_message` (`E_VALIDATION_ERROR`, `E_FIELD_MISSING`,
  `E_TOO_MANY_*`, `E_HEADER*`) and `send_failed` (anything else), with the code in `code` and never
  the error message. Messages are sent one after another; the log line is counts and codes only.
* `EMAIL_KEY` closes the trust-on-first-use window for email: whenever no secret is registered
  (first setup, the 5E rotation, lost KV) anyone may claim `/send`, but `/email` only answers the
  secret pinned by a value that only someone with access to the Cloudflare account can set. It is a
  Worker secret (dashboard or `wrangler secret put`), never in `wrangler.toml`, and survives deploys.
* Endpoint allowlist (an SSRF guard): `https://` on the default port, host `fcm.googleapis.com` (Chrome,
  Edge, Android), `updates.push.services.mozilla.com` (Firefox), `web.push.apple.com` (Safari and
  iPhone/iPad Home Screen apps), or a host ending in `.push.apple.com` or `.notify.windows.com`. The same
  list is copied in `src/server/push-subscription.ts` and `src/web/lib/push.ts`: **change all three together**
  (`src/web/lib/push-contract.test.ts` fails when they disagree).
* KV namespace `TMA_PUSH` holds only `vapid:v1` (the key pair) and `relay:secret-sha256` (hex SHA-256
  of the registered secret, compared in constant time). No subscriptions, payloads or family data are
  stored. Logs show only the push service host and status.
* **Plans**: email needs **Workers Paid** ($5 a month: 3,000 emails included, then $0.35 per 1,000)
  and `mytma.org` onboarded for Email Sending, plus the `EMAIL_KEY` secret; push alone fits the free plan.
* **Free-plan limits** (push): about 10 ms of CPU per request (hence at most 5 messages per request from Apps
  Script), 50 subrequests per request (10 messages are 10 fetches), 100,000 requests a day, and KV
  100,000 reads and 1,000 writes a day (each Worker instance caches what it read for 5 minutes; writes
  happen only at setup). One notification to every device costs one `/send` request per 5 devices.
* Deployed by `.github/workflows/deploy-push-worker.yml` (Worker tests, typecheck, `wrangler deploy`)
  on pushes that touch `workers/push/`, or by hand, with the repository secrets `CLOUDFLARE_API_TOKEN`
  and `CLOUDFLARE_ACCOUNT_ID`. Rotating keys and moving to another Cloudflare account:
  `docs/SETUP.md` §5 and `workers/push/README.md`.

### 9.2 App Worker (workers/app, Cloudflare)

The front door for `https://mytma.org`: `wrangler.toml` binds the custom domains `mytma.org` and
`www.mytma.org`, serves `../../dist` as static assets with `run_worker_first = true` and
`not_found_handling = "single-page-application"`, and sets `workers_dev = false` and
`preview_urls = false` (no second origin). `src/index.ts` (`handle`):

* `www.mytma.org` or any `*.workers.dev` host → 301 to `https://mytma.org` with the same path and query.
* Every response gets HSTS, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
  `Referrer-Policy` and `Permissions-Policy`.
* `Cache-Control: no-cache` for `/`, `*.html`, `sw.js`, `*.webmanifest` and `registerSW.js`, so a
  release reaches phones promptly; `public, max-age=31536000, immutable` for a successful
  `/assets/*` answer (Vite fingerprints those files).
* A `/assets/*` request that the assets binding answers with HTML (its SPA fallback for a missing
  file, status 200) becomes a plain-text **404 with `Cache-Control: no-store`**, so a page from an
  older release asking for a replaced chunk never gets HTML cached for a year under a script's URL.
* It reads and stores no family data.
* Deployed by `.github/workflows/deploy-app-cloudflare.yml` (the Worker's tests and typecheck,
  `npm run build:web`, `wrangler deploy --config workers/app/wrangler.toml` with the pinned Wrangler
  from `workers/push`, then a check of `https://mytma.org`) on pushes that touch the app's code or
  `workers/app/`, or by hand. Changing `VITE_API_URL` starts no workflow, so it must be run by hand
  afterwards (`docs/SETUP.md` §7).

## 10. Browser app (src/web)

Mobile-first React 19 app, hash routing, no UI framework. Plain CSS with design tokens.

### Modules and interfaces (other modules code against these)

```ts
// src/web/api/client.ts
export class ApiError extends Error { code: ApiErrorCode }
export interface ApiClient {
  readonly mode: 'demo' | 'live';
  getToken(): string | null;
  setToken(token: string | null): void;      // persists to this mode's key: 'tma.session' or 'tma.demo.session'
  call<A extends ApiAction>(action: A, params: ApiParams<A>): Promise<ApiResult<A>>; // throws ApiError
}
export function createLiveClient(apiUrl: string): ApiClient;       // fetch POST text/plain, 30 s timeout
export function createApiClient(mode?: AppMode): ApiClient;  // mode 'live' and VITE_API_URL set ? live
                                                             // : demo (lazy import of src/demo)
// The demo client is created on first use, so createApiClient() returns ApiClient & { loadDemo(): Promise<DemoControls> }
// in demo mode; UI code reaches the controls through getDemoControls(api) (null in live mode).
export function getDemoControls(api: ApiClient): Promise<DemoControls | null>;
export function withAuthGuard<T extends ApiClient>(api: T, onUnauthorized: () => void): T; // UNAUTHORIZED → sign out

// src/demo/index.ts
export interface DemoControls {
  addCredit(studentId: string, amountCents: number, description: string): Promise<TickReport>; // ledger row + syncTick
  runDaily(): Promise<TickReport>;
  outbox(): DemoOutboxItem[];          // emails/sms/push the demo "sent", newest first
  reset(): void;                        // restore sample data
}
export interface DemoOutboxItem { at: string; channel: 'push'|'email'|'sms'; to: string; title: string; body: string }
export function createDemoClient(options?: { latencyMs?: [number, number]; now?: () => Date; exposeGlobal?: boolean }):
  ApiClient & { demo: DemoControls };   // also sets window.__tmaDemo = DemoControls (e2e)
// Demo push: the PushSender fake dispatches window event 'tma:push' (detail: PushMessage) and, when
// Notification.permission === 'granted', shows a real notification through the SW registration.

// src/web/lib/push.ts  (publicKey = settings.pushPublicKey from me.bootstrap)
export type PushSupport = 'ready' | 'enabled' | 'needs-install' | 'blocked' | 'unsupported' | 'not-configured';
export function getPushSupport(options?: { mode?: 'demo' | 'live'; publicKey?: string }): Promise<PushSupport>;
  // mode defaults to lib/mode.ts; live without a valid key → 'not-configured'; demo: always ready/enabled
export function enablePush(api: ApiClient, publicKey?: string): Promise<{ ok: true } | { ok: false; reason: string }>;
export function disablePush(api: ApiClient): Promise<void>;
export function refreshPushRegistration(api: ApiClient, publicKey?: string): Promise<void>; // never throws
export function canonicalToken(subscription: unknown): string | null; // what push.register stores
export function isIos(): boolean;
export function isStandalone(): boolean;

// src/web/lib/mode.ts  (see "Live and demo in one build")
export type AppMode = 'demo' | 'live';
export function initAppMode(): AppMode;       // once in main.tsx: storage migration + "?demo" switch
export function currentAppMode(): AppMode;
export function canExitDemo(mode?: AppMode): boolean;   // the demo, on a build that has a live backend
export function enterDemo(): void;            // remembers 'tma.mode' = 'demo' and reloads
export function exitDemo(): void;             // forgets it and reloads
export function liveApiUrl(): string;         // VITE_API_URL ('' = demo-only build)
export function hasLiveBackend(): boolean;

// src/web/lib/storage.ts
export function storageKeys(mode: AppMode): { session; email; cachePrefix; dismissedPrefix; push };

// src/web/lib/install.ts
export function useInstallPrompt(): {
  canPrompt: boolean; installed: boolean; showIosHint: boolean; prompt(): Promise<void>;
  inAppBrowser: boolean;  // Facebook/Instagram/etc. in-app browser: suggest opening in Safari/Chrome
};

// src/web/lib/sw-register.ts
export function registerServiceWorker(mode?: AppMode): void; // virtual:pwa-register; window events:
  // 'tma:sw-update' (update banner), and in live mode only 'tma:push' and 'tma:pushsubscriptionchange'

// src/web/components/PayPalCheckout.tsx
export function PayPalCheckout(props: {
  api: ApiClient; settings: PublicSettings;
  order: { studentId: string; activityId: string; amountCents: number; coverFee: boolean };
  onPaid(payment: Payment): void; onError(message: string): void;
}): JSX.Element;
```

### Screens (bottom tab bar: Home · Funds · Trips · News · More)

* **Sign in**: the TMA logo (owl over music notes, TIMBERLANE MUSIC; lighter notes in dark mode), "Sign in with your email", code step, and a clear note that new families can
  sign up with any email. Demo mode shows a banner with one-tap "Try as a parent" (parent@example.com),
  "Try as the treasurer" (treasurer@example.com) and "Try as a new family" buttons, and auto-fills devCode.
  A live build adds a "See a demo with sample data" link; while a live build runs the demo, the demo
  banner has **Exit demo**, and signed-in screens show a slim strip ("Demo with made-up families.
  Nothing here is real.") with its own Exit demo button. A demo-only build shows neither.
* **Home**: greeting; notification/installation nudges (dismissible); per-student cards (name, grade, school,
  ensemble chips, **available funds** big number, pending note); "Coming up" (next payments due, next events);
  latest 3 announcements. Pending/None family → a card explaining verification, or "Set up your household".
* **Funds**: per-student balance header (segmented control when >1 student) + history list (date,
  description, ±amount, activity tag). Explainer: "Activity funds are earmarked for TMA music activities
  (trips, camps, TRSD lessons). They can't be withdrawn as cash."
* **Trips**: activity accounts per student: progress bar paid/cost, remaining, due dates (deposit/final),
  pending requests. Actions: **Use activity funds** (sheet/dialog: amount input prefilled with
  min(available, remaining − pending); validation; note; submit → toast + refresh) and **Pay online**
  (amount input, "Add $X.XX so TMA receives the full amount" checkbox using grossUpCents with live total,
  PayPalCheckout, "Other ways to pay" text). Cancel a pending request.
* **News**: announcements + upcoming events (date badges), audience chips.
* **More**: Household (edit/sign-up form: guardians, students with school select + ensemble checkboxes),
  Notifications (push enable button with state machine and iOS "Add to Home Screen first" steps, test button;
  channel toggles; topic toggles; school/ensemble interest checkboxes; SMS phone if enabled), Install app,
  Privacy note, Help/contact (support email, donate link), Sign out, app version. Demo: "Demo controls" card
  (simulate a fundraiser credit for a student → shows the notification; view outbox; reset).
* **Admin** (visible when isAdmin; reachable from More and Home): stats tiles, pending fund requests
  (approve/deny with optional note), new households (approve, link to the existing student record via a
  candidate radio list, reject), compose announcement (title, body, link, audience checkboxes, channel
  toggles, preview, send), run sync now, recent activity log, and a **Reports** card.
* **Reports** (`#/reports`, admins only; §5.4): a list of the 8 reports, then one report per address
  (`#/reports?kind=trip-balances`), so Back works. Only the filters the report uses are shown (activity,
  school, group, from/to dates starting at this school year, "Include paid in full"); the report runs again
  400 ms after a filter changes, and an end date before the start date is explained, not sent. Results: the
  description, the generated time, the filters in words, the notes, and a table whose student column (else
  the first) comes first and stays in view while it scrolls sideways; totals at the bottom (fund activity:
  Credits, Debits, Net). On wide screens a table with more than 3 columns may grow past the 640 px column.
  **Download CSV** (`src/web/lib/csv.ts`): `tma-<kind>-<date>.csv`, UTF-8 with a byte-order mark, CRLF, the
  same columns in the same order as the table, money as plain dollars, dates `YYYY-MM-DD`, then the totals,
  title, description, generated time, filters and notes. Text starting with `=`, `+`, `-`, `@`, a tab or a
  carriage return gets a leading apostrophe. When `containsContactInfo`, the screen says so and the download
  asks first ("This file has people's email addresses …. Keep it private."). **Print** shows only the report,
  landscape, header row repeated on each page.

### UX rules

* Fast first paint: render the cached bootstrap from localStorage (`tma.cache.<email>`, or
  `tma.demo.cache.<email>` in the demo) immediately, then refresh.
  Show "Offline: showing info from <time>" when the fetch fails.
* Refresh on focus/visibility change (max once per 60 s) and after every mutation.
* Toasts in an `aria-live="polite"` region. Dialogs are accessible (`role=dialog`, focus trap,
  Esc closes, return focus). Touch targets ≥ 44 px. Inputs ≥ 16 px font (no iOS zoom). Labels on every input.
  Money uses `formatCents`. Never show other families' data.
* Brand: maroon `#5a0f13` primary, near-black `#141010`, cream `#faf7f5` surface, white cards; serif
  headings (Georgia/"Times New Roman") echo the logo; system UI font for body. Light + dark themes via
  tokens on `:root` with `@media (prefers-color-scheme: dark)`. Respect `prefers-reduced-motion`.
  Layout max-width 640px centered, 16px gutters, safe-area insets for the bottom bar.
* Logo and icons: all made by `npm run icons` (scripts/make-icons.mjs) from the official artwork
  `public/brand/tma-music-logo-source.webp`. The sign-in logo is transparent (`brand/tma-logo-light.webp`,
  `brand/tma-logo-dark.webp`), the header shows the owl on a white disc (`brand/tma-owl-mark.png`), app
  icons show the whole logo on white, and the favicons (32, 64) and notification badge show just the owl.

### Service worker (src/web/sw.ts, vite-plugin-pwa injectManifest)

* `precacheAndRoute(self.__WB_MANIFEST)`; `cleanupOutdatedCaches()`; navigation route → precached `index.html`.
  The precache leaves out the two brand files the app never shows (the logo source and the email logo).
* Runtime: images StaleWhileRevalidate (`tma-images`, max 60). **Never cache API calls** (POST anyway).
* `push`: the payload is the JSON `PushMessage` Apps Script sent through the Worker
  (`{title, body, url, tag, topic}`); plain text becomes the body. Parse robustly. **Always** show a
  notification (iOS requires it) with icon `icons/icon-192.png`, badge `icons/badge-96.png` (transparent
  owl silhouette; Android uses only its alpha), tag, and `data.url`. Fallback title "TMA update". Also post
  `{type:'push', message}` to open app windows (in-app banner and refresh).
* `pushsubscriptionchange` (mostly Firefox, when the push service expires or replaces a subscription):
  post `{type:'pushsubscriptionchange'}` to open app windows. Subscribing again needs the server's key
  and registering needs the parent's sign-in, so the page does it (`refreshPushRegistration`).
* Messages go only to windows **inside the app's scope**: on GitHub Pages other sites of the same owner
  share the origin and must not see families' messages.
* `notificationclick`: close; focus an existing client and `postMessage({type:'navigate', url})`, or
  `clients.openWindow(scope + url)`.
* `message` `{type:'SKIP_WAITING'}` → `skipWaiting()`.

### Push enablement (src/web/lib/push.ts)

* Live mode uses the **standard Push API**, no SDK and no build setting. The key to subscribe with is the
  Worker's VAPID public key, which the server sends as `settings.pushPublicKey` in `me.bootstrap`. Empty
  or not a 65-byte P-256 point → `not-configured` ("Phone notifications aren't set up for TMA yet").
* iOS/iPadOS Safari not in standalone → `needs-install` (Web Push only works from a Home Screen app on
  iOS/iPadOS 16.4+). No service worker, `Notification` or `PushManager` → `unsupported`. Permission
  denied → `blocked`. Granted, and this device has a live push record → `enabled`. Otherwise `ready`.
* `enablePush(api, key)`: `Notification.requestPermission()` first (it must run in the tap, before any
  other await, for Safari) → wait for the service worker (15 s) → `pushManager.getSubscription()`; a
  subscription made with a different key, or with none, is unsubscribed (push services would refuse it,
  and the browser won't subscribe with a new key while it exists) → `pushManager.subscribe({userVisibleOnly:
  true, applicationServerKey})` → `canonicalToken` (a push service outside the Worker's allowlist is
  unsubscribed and answered with the `unsupported` message) → `push.register` → save the record
  `{token, key, email, at}` in localStorage `tma.push` (`email` = the account that registered it, from
  the session token). A record made by a different account doesn't count as on: that account sees
  `ready`, not `enabled`. Records saved before `email` existed behave as before. The previous token is unregistered (best effort) only
  when its endpoint differs; with the same endpoint that would delete the row just registered.
* `refreshPushRegistration(api, key)` runs from `App.tsx` once the bootstrap is loaded, again whenever
  `pushPublicKey` changes, and on the `tma:pushsubscriptionchange` window event. It acts only when the
  parent turned push on here, permission is `granted` and a session exists. It subscribes again when the
  subscription is missing or was made with another key (**key rotation**: after the Worker's keys are
  replaced, each phone follows the new key the next time the app is opened), and re-registers when the
  token or key changed or the last registration is over 7 days old (keeps Last Seen fresh). If a new
  subscription can't be made, it clears the record so the screen offers *Turn on notifications* again.
  A record another account left behind (e.g. its session expired without signing out) is turned off:
  the browser is unsubscribed and the record cleared, without registering the new account, so that
  account's Devices row is dropped as gone at the next send. It never turns push on by itself.
* Races: enable, disable and refresh each bump a counter. A refresh that was overtaken stops before
  changing anything, and takes its registration back out only if push was turned off meanwhile.
* `disablePush`: `push.unregister` (an expired session still clears the device) → unsubscribe the
  browser → clear the record. *Turn off notifications* throws on failure and keeps everything so the
  parent can retry. Sign-out calls `disablePush(api, { signingOut: true })`, waiting at most 4 s: it
  sends `push.unregister` at once (while the session token still exists) and, without waiting for it,
  unsubscribes the browser and clears the record, ignoring any failure. So even offline, or when the
  tab closes, the browser is unsubscribed; the push service then answers 404/410 and Apps Script deletes
  the row.
* Demo mode: permission (for real pop-ups) + register a fake token `demo-<uuid>`, recorded in
  `tma.demo.push`; notifications come from the demo PushSender. The demo never touches the browser's
  real push subscription, which belongs to the live app.

### Live and demo in one build (src/web/lib/mode.ts)

* A build without `VITE_API_URL` is always the demo and never saves a mode.
* On a live build, `?demo` or `?demo=1` sets localStorage `tma.mode` = `demo`, then is removed from the
  address (the `#/route` is kept); `?demo=0` switches back. If storage can't be written, the switch
  stays in the address instead. *See a demo with sample data* (`enterDemo`) and **Exit demo**
  (`exitDemo`) do the same. Switching always reloads, so nothing in memory crosses modes.
* Per-person state is kept under separate keys per mode (`storageKeys`), so trying the demo never mixes
  a demo sign-in, cached data or push registration with the real ones:

  | What | Live | Demo |
  | --- | --- | --- |
  | Session token | `tma.session` | `tma.demo.session` |
  | Last email used | `tma.email` | `tma.demo.email` |
  | Cached bootstrap | `tma.cache.<email>` | `tma.demo.cache.<email>` |
  | Dismissed nudges | `tma.dismissed.<id>` | `tma.demo.dismissed.<id>` |
  | Push registration | `tma.push` | `tma.demo.push` |

  Shared: `tma.mode`, `tma.storage` (layout version) and the demo's database `tma.demo.db.v1`. Each
  client persists and clears only its own session key, so `UNAUTHORIZED` in one mode never signs the
  other out.
* One-time migration (`tma.storage` = `2`): if this browser has run the demo (`tma.demo.db.v1` exists),
  the older un-prefixed session, email, cache and dismissed keys move to the demo keys, and a `demo-…`
  `tma.pushToken` becomes the demo push record. The old `tma.pushToken` and `tma.pushToken.at` are
  always removed. Without this, board members who used the old demo link would briefly see sample data
  in the live app.
* While a live build runs the demo, the page ignores real `push` and `pushsubscriptionchange` messages
  from the service worker (system notifications still show, and tapping one still navigates).

## 11. Testing

* `src/shared`, `src/server`: Vitest, node environment, using `createMemoryServices()` from
  `src/server/memory.ts` (MemoryStore, fake cache with injectable clock, deterministic crypto, outbox
  recorders for mail/sms/push, a fake PaymentGateway).
* `src/gas`: Vitest with hand-written mocks of SpreadsheetApp/Utilities/UrlFetchApp/Session/etc. (headers,
  aliasing, date conversion between a far-away spreadsheet zone and the script zone, which must pass
  whatever the machine's own time zone is, PayPal request bodies, push Worker requests: 5-message batches, payload limits, 401 re-registration and
  `no_keys` recovery). `src/gas/bundle.test.ts` checks the generated `apps-script/Code.js` itself (plain
  script, no service calls at load time, every entry point) and drives it end to end against those fakes,
  including setup linking the Worker, `push.register` and a sync push; it is skipped until
  `npm run build:gas` has run. `src/gas/reports-sheet.test.ts` checks the report tabs: layout, number
  formats, formula-looking text kept as text, no other tab touched, and Set up and the sync leaving them alone.
* `src/server/reports.test.ts`: every report against the sample data with hand-computed numbers, each
  status and filter, validation messages, admin-only, the row cap and the roster's Log row.
* `workers/push`: its own Vitest config (`workers/push/vitest.config.ts`), run by `npm test` after the
  app's tests, by `npm run test:worker` alone, and by the Worker's deploy workflow; `npm run typecheck`
  includes `workers/push/tsconfig.json`. It checks the RFC 8291 Appendix A vector
  byte for byte, decrypts real output with an independent receiver, verifies the VAPID JWT signature,
  and drives every endpoint against an in-memory KV with a mocked `fetch`.
* `workers/app`: its own Vitest config (`workers/app/vitest.config.ts`), run by `npm test` and by the
  app's deploy workflow; `npm run typecheck` includes `workers/app/tsconfig.json`. `index.test.ts`
  drives `handle` with a fake assets binding (redirects, headers, caching, the SPA fallback for a
  missing asset). `hosting.test.ts` checks the hosting setup itself: the Pages workflow builds only
  the demo, the mytma.org workflow has no built-in backend, `wrangler.toml` has no workers.dev
  address, and the docs point families and `APP_URL` at `https://mytma.org/`.
* `src/demo/flow.test.ts`: the board walkthrough through the demo client (parent requests funds and pays,
  treasurer approves and verifies a household, announces, posts a credit → `tma:push` to the parent).
* `src/web`: Vitest + Testing Library in jsdom (`// @vitest-environment jsdom` docblock).
* `e2e/` (Playwright, 390×844 viewport, `npm run e2e` after `npm run build:web`):
  * `demo.spec.ts` against `vite preview` of `dist/` (demo build): sign in as a parent, see balances,
    request funds, pay online (demo), sign in as treasurer, approve, check the balance notification.
  * `live-demo.spec.ts` against a live build that `playwright.config.ts` makes in `dist-live/` with
    `VITE_API_URL=https://example.invalid/exec`: the live sign-in, `?demo` (address tidied, route kept,
    remembered across a reload), the demo strip, **Exit demo**, *See a demo with sample data*, `?demo=0`,
    separate `tma.session` / `tma.demo.session`, and no request ever reaching the backend address.
  * `screenshots.spec.ts` (`npm run screenshots`, not part of `npm run e2e`): the README images in
    `docs/screenshots/`, light theme plus a dark Home.
