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
* **No new spending.** Everything must run on free tiers inside TMA's own Google account.
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
│ offline cache)        │  JSON          │        │ reads/writes                      │
└──────────▲────────────┘                │        ▼                                  │
           │ Web Push                    │ Google Sheet (treasurer's ledger)         │
┌──────────┴────────────┐                │ MailApp (email), time triggers (sync)     │
│ Firebase Cloud        │ ◀───────────── │ UrlFetchApp → FCM HTTP v1, PayPal REST,   │
│ Messaging (free)      │   send         │               Twilio (optional, paid)     │
└───────────────────────┘                └───────────────────────────────────────────┘
           PayPal JS SDK buttons in the page ⇄ PayPal (orders created/captured server-side)
```

* **Static hosting** (free): GitHub Pages (workflow included) or Firebase Hosting.
* **Demo mode**: when `VITE_API_URL` is empty, the browser runs the *same backend core*
  (`src/server`) against an in-memory, localStorage-persisted copy of the sample sheet
  (`src/demo`). PayPal and push are simulated. This is the prototype link for the board.

### Directory layout

```
src/shared/   isomorphic types, schema, money helpers (no runtime deps)
src/server/   backend core: pure synchronous TS; depends only on Services ports
src/gas/      Apps Script adapters + entry points; bundled to apps-script/Code.js
src/demo/     browser wiring of the core with in-memory services (demo mode)
src/web/      React PWA: screens, components, api client, push, install, PayPal UI, sw.ts
apps-script/  Code.js (generated, committed so volunteers can copy/paste), appsscript.json
scripts/      build-gas.mjs, make-icons.mjs
docs/         this spec, SETUP, SHEET, PAYMENTS, BOARD-FAQ
e2e/          Playwright smoke test of demo mode
```

## 3. Sheet ↔ domain mapping rules (src/server/data.ts)

* Headers are matched with `normalizeHeader` and `TABLES[...].aliases`.
* **Booleans**: `TRUE/FALSE`, `Y/N`, `Yes/No`, `x`, `1/0`, real booleans. Blank means the column default.
* **Lists** (Ensembles, Schools): split on `,` `;` `/` or newline, trim, drop empties,
  and match known names case-insensitively, canonicalizing to the Settings spelling.
  Unknown names are kept as typed.
* **Dates**: `Date` objects, `YYYY-MM-DD`, `M/D/YYYY`, `M/D/YY`, or sheet serial numbers.
  Use the calendar date. Avoid timezone drift by reading `Date` cells in the script
  timezone (`America/New_York`): use getFullYear/getMonth/getDate of the Date as returned.
* **Money**: `dollarsToCents`. Writes use `centsToDollars`.
* **Emails**: trim + lower-case. Families match on `Email` or `Parent 2 Email`.
* **Status** blank means `Active` for Families/Students (treasurer rows), `Going` for Enrollments,
  `Open` for Activities, `Completed` for Payments, `Pending` for Redemptions.
* **IDs**: new Family/Student IDs are `F`/`S` + 4-digit zero-padded (max numeric suffix + 1).
  Redemption IDs are `R-` + first 8 hex chars of a uuid. Announcement IDs are `A-` + 8 hex.
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
  * `remaining` = max(0, cost − paidFromFunds − paidDirect).

## 4. Authentication (src/server/auth.ts)

Passwordless email codes. No Google account is required for parents.

1. `auth.requestCode {email}`: validate the format. Rate limit is 5 codes per email per hour
   (cache key `otp-rl:<email>`). Generate a 6-digit code and store
   `hmac(TOKEN_SECRET, email+code)` in cache `otp:<email>` for 10 minutes with
   `attempts=0`. Email it with subject "Your TMA sign-in code: 123456". **Always**
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

Writes run inside `services.withLock`.

| Action | Behavior |
| --- | --- |
| `me.bootstrap` | Build `Bootstrap` for the caller (see §5.1). |
| `household.save` | See §5.2. Returns fresh Bootstrap. |
| `prefs.save` | Sanitize: channel/topic booleans; schools/ensembles must be in Settings lists; `smsPhone` digits only (10–15 digits) or removed. Upsert `Preferences` row for the caller's email. `sms` may only be true when `Settings.SMS_ENABLED` and a phone is set. |
| `push.register` | Token 20–4096 chars. Upsert `Devices` by token: set Email/FamilyID, update Last Seen. Max 10 devices per email; drop the oldest. Returns the device count for the email. |
| `push.unregister` | Delete (blank out) the row with that token if it belongs to the caller. |
| `push.test` | Send "Test notification ✅ / Notifications are working on this device." to the caller's devices (push only). |
| `redemption.request` | Caller's family must be Active, the student Active and in the family, the activity Open and `allowFunds`, enrollment Going. Amount is an integer ≥ 100 (=$1) and ≤ available funds and ≤ (remaining − pending requests for that activity). Append a `Redemptions` row (Pending). Notify admins (§6, admin message). |
| `redemption.cancel` | Only the caller's family's own **Pending** request → Cancelled. |
| `payment.createOrder` | Requires `settings.onlinePaymentsEnabled` and `payments.enabled()` (otherwise `NOT_CONFIGURED`). Same ownership checks; activity `allowOnlinePayment`. `minPayment ≤ amount ≤ remaining`. Fee: `coverFee ? grossUpCents(amount, FEE_PERCENT, FEE_FIXED) : none`. Call `payments.createOrder`. Cache `order:<orderId>` → JSON {email, familyId, studentId, activityId, amountCents, feeCents, grossCents} for 6 h. |
| `payment.captureOrder` | Load the cached order (`NOT_FOUND` if missing/expired) and require the same email. If a Payments row with Reference == captureId or Reference == orderId already exists → return it (idempotent). Call `payments.captureOrder(orderId, 'cap-'+orderId)`. Status COMPLETED **and** grossCents equal to the expected gross → append Payments row {Date today, StudentID, ActivityID, Amount, Fee Covered, Gross, Method 'PayPal', Reference captureId, Payer Email, Status Completed}, log, notify the family (topic `payments`). PENDING → append with Status Pending. Anything else → `PAYMENT_FAILED`. |
| `admin.overview` | Stats, pending redemptions (with names, available, remaining), pending households with up to 3 match candidates per student (§5.3), last 50 Log rows. |
| `admin.decideRedemption` | Pending only (`CONFLICT` otherwise). Approved: re-validate available funds (excluding this request) and remaining; if short → `CONFLICT` with a clear message. Append a Ledger row {Date today, StudentID, Type 'Redemption', Description 'Applied to <activity name>', Amount −x, ActivityID, Reference = request id, Entered By = admin email}. Update the redemption row (Status, Decided, Decided By, Admin Note, Notified=now). Update `_Snapshot` for that student so the sync doesn't double-notify. Notify the family (topic `payments`). Denied: update the row and notify. |
| `admin.reviewHousehold` | approve: Family Status → Active. For each `links` entry: the existing student gets FamilyID=this family and Status Active; the pending student → Status Inactive (and log "merged into"). Remaining pending students of that family → Active. Notify the family: "Your TMA account is verified". reject: Family Status → Inactive, its pending students → Inactive. |
| `admin.announce` | Append an Announcements row (ID, Date today, Title, Body, Schools, Ensembles, Link, Sent=now) and deliver (§6) on the channels the admin ticked, still filtered by each recipient's prefs. |
| `admin.runSync` | Run `syncTick()` and return its report. |

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
  Students omitted from the input are **not** deleted.
* Inactive family → `FORBIDDEN` ("Please contact TMA").

### 5.3 Match candidates

For each Pending student, score Active/treasurer students that are not already in this family:
the last name must match (case-insensitive, letters only). Score = 0.6 for the last-name match + 0.3 if
the first names match exactly (or 0.2 if one is a prefix of the other, e.g. "Alex"/"Alexander") +
0.1 if the grade matches. Keep score ≥ 0.6 and return the top 3 by score, then by balance descending.

## 6. Notifications (src/server/notify.ts)

**Recipients** are emails. A family's recipients are its guardian emails. Each recipient's prefs
(stored or default) decide delivery:

* topic must be enabled (`balance`, `payments`, `reminders`, `announcements`). Admin messages
  and push tests ignore topics.
* audience match (announcements/events only): audience both empty → everyone; prefs both empty →
  receives everything; otherwise, if both audience lists are non-empty the recipient needs a match in each.
  If one audience list is empty, a match on the other suffices.
* channels: push → every device token for that email (if `push.enabled()`); delete tokens that
  return `invalid`. email → if `EMAIL_ENABLED` and `mailer.remainingQuota() > 0`; skip with a log
  when out of quota. sms → if `SMS_ENABLED`, `sms.enabled()`, and prefs.smsPhone.
  Admin-chosen channels further restrict announcements.
* Each delivery batch is logged in `Log` (kind `notify`, detail "topic: title → push n, email n, sms n").
* Email: HTML with a maroon header bar showing the org name, the body paragraphs, a button "Open the TMA app"
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
into `report.errors` so one failure doesn't block the rest:

1. **Sheet-approved redemptions**: for each redemption with Status Approved/Denied and blank
   `Notified`: if Approved and no Ledger row has Reference == id → append the Ledger row (as in
   `admin.decideRedemption`) and update the snapshot for the student. Notify. Set `Notified` = now
   (and Decided if blank).
2. **Balance changes**: compute all verified-or-not student balances. If `_Snapshot` is empty → write
   it and send nothing (first run). Otherwise for each student whose balance differs from the
   snapshot (new students count as previous 0), notify the family (topic `balance`) if the student
   has a family. Then overwrite `_Snapshot`.
3. **Queued announcements**: rows with blank `Sent` whose Date is blank or ≤ today: deliver to all
   matching recipients (all channels allowed), set Sent = now. "All recipients" = all guardian emails
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
Return the `SetupReport`.

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
  `function installTriggers()`, `function sendTestPushToMe()`, `function showTmaStatus()`.
* `doPost(e)`: parse `e.postData.contents`, call `app.handle`, and return
  `ContentService.createTextOutput(JSON.stringify(res)).setMimeType(JSON)`.
* `doGet(e)`: `?action=health` → `{ok:true, data:{version, time}}`. Otherwise a tiny HTML page that links to APP_URL.
* SheetStore: `SpreadsheetApp.getActive()`. The script is **container-bound** (created from the sheet via
  Extensions → Apps Script), so it only ever touches that one spreadsheet. Read with one `getDataRange().getValues()` per table per request (memoize per execution).
  Header row → canonical map via normalizeHeader+aliases. append uses one `setValues` call. Hide `system` tabs.
  Add the header note from `TABLES[t].note` to A1 when creating.
* Cache: `CacheService.getScriptCache()`. Lock: `LockService.getScriptLock().waitLock(20000)`.
* Crypto: `Utilities.computeHmacSha256Signature`, uuid via `Utilities.getUuid()`, digits via uuid
  hex → numbers (rejection sampling).
* Mailer: `MailApp.sendEmail({to, subject, htmlBody, body, name: ORG_NAME})`,
  quota `MailApp.getRemainingDailyQuota()`.
* PayPal gateway: REST v2 via `UrlFetchApp` (`muteHttpExceptions: true`), OAuth client-credentials token
  cached ~8 h in CacheService, base `https://api-m.sandbox.paypal.com` or `https://api-m.paypal.com` per
  PAYPAL_ENV. Create order: intent CAPTURE; one purchase unit with reference_id, custom_id,
  description, items [trip payment, + "Optional processing-fee contribution" when fee>0], amount with breakdown
  item_total; `payment_source.paypal.experience_context` {brand_name, shipping_preference
  NO_SHIPPING, user_action PAY_NOW}. Capture: POST `/v2/checkout/orders/{id}/capture` with header
  `PayPal-Request-Id`. Parse `purchase_units[0].payments.captures[0]`. Enabled when PAYPAL_CLIENT_ID (Settings) and
  PAYPAL_SECRET (Script Properties) are set.
* FCM sender: service-account JSON from Script Properties `FCM_SERVICE_ACCOUNT`; RS256 JWT signed with
  `Utilities.computeRsaSha256Signature`, exchanged at `https://oauth2.googleapis.com/token` for scope
  `https://www.googleapis.com/auth/firebase.messaging`, token cached 50 min. Send one request per token
  using `UrlFetchApp.fetchAll` to `https://fcm.googleapis.com/v1/projects/<project_id>/messages:send` with
  **data-only** messages `{token, data:{title, body, url, tag, topic}, webpush:{headers:{Urgency:'high', TTL:'86400'}}}`.
  404/`UNREGISTERED`/`INVALID_ARGUMENT` on the token → `invalid`.
* Twilio SMS (optional; costs about 1¢ per text): `TWILIO_*` secrets set → enabled. POST form to
  `https://api.twilio.com/2010-04-01/Accounts/<sid>/Messages.json` with basic auth.
* `onOpen()` adds a sheet menu **TMA App**: Run sync now · Send me a test notification · Set up / repair tabs ·
  Install schedules · Status. `installTriggers()` removes old triggers for these handlers and installs
  syncTick every 15 min and dailyTick at 8 AM.
* `appsscript.json`: timeZone `America/New_York`, runtime V8, webapp {executeAs USER_DEPLOYING,
  access ANYONE_ANONYMOUS}, oauthScopes (least privilege): `spreadsheets.currentonly`,
  `script.container.ui`, `script.send_mail`, `script.external_request`, `script.scriptapp`.

## 10. Browser app (src/web)

Mobile-first React 19 app, hash routing, no UI framework. Plain CSS with design tokens.

### Modules and interfaces (other modules code against these)

```ts
// src/web/api/client.ts
export class ApiError extends Error { code: ApiErrorCode }
export interface ApiClient {
  readonly mode: 'demo' | 'live';
  getToken(): string | null;
  setToken(token: string | null): void;      // persists to localStorage 'tma.session'
  call<A extends ApiAction>(action: A, params: ApiParams<A>): Promise<ApiResult<A>>; // throws ApiError
}
export function createLiveClient(apiUrl: string): ApiClient;       // fetch POST text/plain, 30 s timeout
export function createApiClient(): ApiClient;  // VITE_API_URL ? live : demo (lazy import of src/demo)

// src/demo/index.ts
export interface DemoControls {
  addCredit(studentId: string, amountCents: number, description: string): Promise<TickReport>; // ledger row + syncTick
  runDaily(): Promise<TickReport>;
  outbox(): DemoOutboxItem[];          // emails/sms/push the demo "sent", newest first
  reset(): void;                        // restore sample data
}
export interface DemoOutboxItem { at: string; channel: 'push'|'email'|'sms'; to: string; title: string; body: string }
export function createDemoClient(): ApiClient & { demo: DemoControls };
// Demo push: the PushSender fake dispatches window event 'tma:push' (detail: PushMessage) and, when
// Notification.permission === 'granted', shows a real notification through the SW registration.

// src/web/lib/push.ts
export type PushSupport = 'ready' | 'enabled' | 'needs-install' | 'blocked' | 'unsupported' | 'not-configured';
export function getPushSupport(): Promise<PushSupport>;
export function enablePush(api: ApiClient): Promise<{ ok: true } | { ok: false; reason: string }>;
export function disablePush(api: ApiClient): Promise<void>;
export function isIos(): boolean;
export function isStandalone(): boolean;

// src/web/lib/install.ts
export function useInstallPrompt(): { canPrompt: boolean; installed: boolean; showIosHint: boolean; prompt(): Promise<void> };

// src/web/lib/sw-register.ts
export function registerServiceWorker(): void;     // virtual:pwa-register; exposes update banner via event 'tma:sw-update'

// src/web/components/PayPalCheckout.tsx
export function PayPalCheckout(props: {
  api: ApiClient; settings: PublicSettings;
  order: { studentId: string; activityId: string; amountCents: number; coverFee: boolean };
  onPaid(payment: Payment): void; onError(message: string): void;
}): JSX.Element;
```

### Screens (bottom tab bar: Home · Funds · Trips · News · More)

* **Sign in**: TMA banner logo, "Sign in with your email", code step, and a clear note that new families can
  sign up with any email. Demo mode shows a banner with one-tap "Try as a parent" (parent@example.com),
  "Try as the treasurer" (treasurer@example.com) and "Try as a new family" buttons, and auto-fills devCode.
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
  toggles, preview, send), run sync now, recent activity log.

### UX rules

* Fast first paint: render the cached bootstrap from localStorage (`tma.cache.<email>`) immediately, then refresh.
  Show "Offline: showing info from <time>" when the fetch fails.
* Refresh on focus/visibility change (max once per 60 s) and after every mutation.
* Toasts in an `aria-live="polite"` region. Dialogs are accessible (`role=dialog`, focus trap,
  Esc closes, return focus). Touch targets ≥ 44 px. Inputs ≥ 16 px font (no iOS zoom). Labels on every input.
  Money uses `formatCents`. Never show other families' data.
* Brand: maroon `#5a0f13` primary, near-black `#141010`, cream `#faf7f5` surface, white cards; serif
  headings (Georgia/"Times New Roman") echo the logo; system UI font for body. Light + dark themes via
  tokens on `:root` with `@media (prefers-color-scheme: dark)`. Respect `prefers-reduced-motion`.
  Layout max-width 640px centered, 16px gutters, safe-area insets for the bottom bar.

### Service worker (src/web/sw.ts, vite-plugin-pwa injectManifest)

* `precacheAndRoute(self.__WB_MANIFEST)`; `cleanupOutdatedCaches()`; navigation route → precached `index.html`.
* Runtime: images StaleWhileRevalidate (`tma-images`, max 60). **Never cache API calls** (POST anyway).
* `push`: parse JSON robustly: FCM data message `{data:{title,body,url,tag,topic}}`, `{notification:{…}}`,
  or a plain `PushMessage`. **Always** show a notification (iOS requires it) with icon `icons/icon-192.png`,
  badge, tag, and `data.url`. Fallback title "TMA update".
* `notificationclick`: close; focus an existing client and `postMessage({type:'navigate', url})`, or
  `clients.openWindow(scope + url)`.
* `message` `{type:'SKIP_WAITING'}` → `skipWaiting()`.

### Push enablement (src/web/lib/push.ts)

* Live mode needs `VITE_FIREBASE_CONFIG` + `VITE_FIREBASE_VAPID_KEY`; otherwise `not-configured`.
* iOS/iPadOS Safari not in standalone → `needs-install` (Web Push only works from a Home Screen app on iOS 16.4+).
* `enablePush`: `Notification.requestPermission()` (must be called from a click) → wait for SW ready →
  dynamic `import('firebase/app')`/`import('firebase/messaging')` → `getToken(messaging, {vapidKey,
  serviceWorkerRegistration})` → `push.register` → store token in localStorage `tma.pushToken`.
  On every app start with permission granted, refresh the token and re-register if it changed.
* Demo mode: permission + register a fake token `demo-<uuid>`; notifications come from the demo PushSender.

## 11. Testing

* `src/shared`, `src/server`: Vitest, node environment, using `createMemoryServices()` from
  `src/server/memory.ts` (MemoryStore, fake cache with injectable clock, deterministic crypto, outbox
  recorders for mail/sms/push, a fake PaymentGateway).
* `src/gas`: Vitest with hand-written mocks of SpreadsheetApp/Utilities/UrlFetchApp/etc. (headers, aliasing,
  JWT shape, PayPal request bodies, FCM payloads).
* `src/web`: Vitest + Testing Library in jsdom (`// @vitest-environment jsdom` docblock).
* `e2e/`: Playwright against `vite preview` in demo mode at a 390×844 viewport: sign in as a parent, see
  balances, request funds, pay online (demo), sign in as treasurer, approve, check the balance notification.
