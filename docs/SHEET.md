# The TMA spreadsheet: treasurer's guide

The app's "database" is one Google Sheet in TMA's Google account. You keep working in it the way
you do today. The app reads it every time a family opens the app, and checks it for changes every
15 minutes so it can notify families.

This guide explains every tab and column, your day-to-day workflow, how to bring over the existing
spreadsheet, and every setting.

**Contents:** [Ground rules](#ground-rules) · [How balances are worked out](#how-balances-are-worked-out) ·
[Everyday workflow](#everyday-workflow) · [The tabs](#the-tabs) · [Settings](#settings) ·
[Hidden system tabs](#hidden-system-tabs) · [Importing the existing spreadsheet](#importing-the-existing-spreadsheet)

---

## Ground rules

* **One row per record, headers in row 1.** Don't merge cells or put notes above the header row.
* **Column order doesn't matter**, and you may add your own extra columns (the app ignores them).
* **Header spelling is forgiving.** Capital letters, spaces and punctuation are ignored, so
  `Student ID`, `student_id` and `StudentID` all work. Some columns also accept other common names
  (listed below as "also accepted").
* **Don't rename the tabs.** The app finds them by name. If a column the 15-minute sync needs is
  missing or renamed beyond recognition, the sync skips that job and the Log tab (and *TMA App → Run
  sync now*) says which column is missing, every run until the header is fixed. It never treats the
  column as blank.
* **Money is in dollars:** `50`, `50.00`, `$1,250.50` all work. A negative can be written `-25` or `(25.00)`.
* **Dates** can be real sheet dates or text like `2026-11-14` or `11/14/2026`. The app reads them
  as typed, even if the spreadsheet's own time zone (*File → Settings*) isn't New York, and the
  times it writes (for example **Sent** or **Created**) show in New York time.
* **Yes/no columns** accept `TRUE`/`FALSE`, `Y`/`N`, `Yes`/`No`, `x`, or `1`/`0`.
* **Lists** (Schools, Ensembles) are separated by commas, e.g. `Band, Jazz Band`. Semicolons, `/`
  and line breaks also work. Names are matched to the spelling in Settings regardless of capitals.
* **IDs** (FamilyID, StudentID, ActivityID) can be any text you like but must be unique. Capitals
  don't matter (`fl27` = `FL27`). **Never change an ID once it is in use**: other tabs refer to it.
  New IDs the app makes for sign-ups are always above every ID still used anywhere in the sheet
  (Ledger, Payments, Enrollments and Redemptions included), so a new student never inherits rows
  left behind by a deleted one.
* If the menu **TMA App** is missing, reload the page. *TMA App → Set up / repair tabs* re-creates
  any missing tab, header or setting. It never deletes or reorders anything, so it is safe to run any time.

## How balances are worked out

Everything is calculated from the rows you enter. Nothing needs a formula.

* **Activity-fund balance** of a student = the total of all that student's rows in **Ledger**.
  Positive rows add money (fundraiser credits, donations). Negative rows spend it.
* A **negative Ledger row with an ActivityID** means *"these funds were applied to that trip"*. It
  lowers the student's balance **and** counts as paid toward the trip.
* **Pending** = requests in **Redemptions** that haven't been decided yet. **Available** (what the
  family can still request) = balance − pending, never below $0.
* For each trip or activity a student is enrolled in (**Enrollments**, status Going or Waitlist):
  * **Cost** = the Enrollments Cost if filled in, otherwise the Activities Cost.
  * **Paid** = funds applied (negative Ledger rows with that ActivityID) + **Completed** rows in
    **Payments** for that student and activity.
  * **Remaining** = cost − paid, never below $0.

Example: Avery's Ledger rows are +120, +185, +60, +95, +130 and −200 (ActivityID `FL27`). Avery's
balance is **$390**. The trip FL27 costs $1,850, a $350 check is recorded in Payments, so FL27 shows **paid $550,
remaining $1,300**.

Families see their money only when **both** the household (Families) and the student (Students)
are **Active**.

## Everyday workflow

| When | What you do | What families get |
| --- | --- | --- |
| A fundraiser is done | Add one **Ledger** row per student: positive Amount, Type `Fundraiser`, a Description families will recognize (e.g. `Poinsettia sale`). | Within about 15 minutes: *"+$50.00 for Avery: $50.00 was added to Avery's TMA activity funds. New balance: $325.00."* |
| The music department says who is going on a trip | Add the trip in **Activities** once, then one **Enrollments** row per student. | The trip appears on their Trips tab with cost, due dates and remaining. If something is still owed, reminders go out 14, 7 and 1 days before the Due Date. |
| A check or cash comes in | Add a **Payments** row: Method `Check` (or `Cash`), the check number in Reference, Status `Completed`. | The trip's "paid" goes up the next time they open the app. |
| A parent asks to use funds for a trip | Approve or deny it in the app (*More → Board tools → Fund requests*), **or** type `Approved`/`Denied` in the **Status** column of **Redemptions**. | A notification: *"Funds applied to Florida 2027"* or *"Funds request not approved"*. |
| A new family signs up in the app | Review it in the app (*More → Board tools → New households*). If you already track their student, pick that record so the history and balance carry over. If the card says *Check the sheet before approving*, fix what it lists first. | *"You're all set! TMA verified your household."* |
| You want to tell families something | Write it in the app (*Board tools → Send an announcement*), or add a row to **Announcements** and leave **Sent** blank. | Push/email to the families whose school, group and topic choices match. |
| A concert or meeting is scheduled | Add a row to **Events**. | It shows under News, and a reminder goes out the day before. |

**Approve fund requests in the app when you can.** The app re-checks that the student still has
enough available funds and that the trip still has that much left to pay. When you type `Approved`
in the sheet, the app trusts you and posts the Ledger row as-is.

You can make the app check the sheet right away with *TMA App → Run sync now*, or in the app with
*Board tools → Sync with the spreadsheet → Run sync now*.

---

## The tabs

The app creates these tabs (*TMA App → Set up / repair tabs*). When it creates a tab, it adds a
short note to cell A1 saying what the tab is for.

### Families

One row per household.

| Column | Meaning | Allowed values / example |
| --- | --- | --- |
| **FamilyID** | Unique household ID. | `F0001`. Households that sign up in the app get the next `F` number automatically. |
| **Parent Name** | First parent/guardian. Also accepted: Parent, Guardian, Guardian Name, Parent 1 Name, Name. | `Jordan Thompson` |
| **Email** | First parent's email. **This is how they sign in.** Also accepted: Parent Email, Parent 1 Email, Guardian Email, Email Address. | `jordan@example.com` (capitals don't matter) |
| **Phone** | Optional cell. Also accepted: Cell, Cell Phone, Parent Phone, Parent 1 Phone, Mobile. | `603-555-0142` |
| **Parent 2 Name** | Optional second guardian. Also accepted: Guardian 2, Guardian 2 Name, Second Parent. | `Casey Thompson` |
| **Parent 2 Email** | Optional. Either parent's email can sign in to the same household. If someone typed it there by mistake, that person can tap *This isn't my household* in the app, which clears the three Parent 2 cells. Also accepted: Guardian 2 Email, Second Email. | `casey@example.com` |
| **Parent 2 Phone** | Optional. Also accepted: Guardian 2 Phone, Parent 2 Cell. | |
| **Status** | `Active` = verified. `Pending` = signed up in the app, waiting for your review. `Inactive` = archived or rejected. **Blank = Active.** | Also understood: Verified/Approved (Active); New/Review (Pending); Archived, Merged, Rejected, Graduated, Left, Closed, Removed (Inactive). |
| **Member** | Paid-up TMA member this year (for your records). Also accepted: TMA Member, Membership. | `TRUE` / `FALSE` |
| **Created** | When the household signed up in the app. Filled in by the app. | |

An email address should appear on only one household. A parent whose email isn't on any household
can still sign in. They will be asked to set up their household.

### Students

One row per student.

| Column | Meaning | Allowed values / example |
| --- | --- | --- |
| **StudentID** | Unique student ID. **Rows without one are ignored.** | `S0001` |
| **FamilyID** | The household this student belongs to. **Blank** = you track the student, but no household is linked yet. You can link one when the parent signs up. | `F0001` |
| **First Name** | Also accepted: First, Student First Name. Notifications use the first name only. | `Avery` |
| **Last Name** | Also accepted: Last, Student Last Name. | `Thompson` |
| **Grade** | `K` or `1` to `12`. `11th` and `Grade 11` also work. | `11` |
| **School** | One of the Settings **SCHOOLS**. | `High School` |
| **Ensembles** | Groups, comma-separated, from the Settings **ENSEMBLES**. Also accepted: Groups, Ensemble, Programs. | `Band, Marching Band, Jazz Band` |
| **Instrument** | Optional. | `Trumpet` |
| **Status** | `Active`, `Pending` (added by a parent in the app, waiting for review) or `Inactive` (graduated, left, merged). **Blank = Active.** | Mark graduates `Inactive` (or `Graduated`). |

### Ledger

The activity-fund history: every credit to and every use of a student's earmarked funds.

| Column | Meaning | Allowed values / example |
| --- | --- | --- |
| **Date** | When it happened. | `2026-11-14` |
| **StudentID** | Whose funds. **Rows with no StudentID, or an Amount of 0 or blank, are ignored.** | `S0001` |
| **Type** | What kind of entry. Any text works. Blank shows as Credit (positive) or Adjustment (negative). | `Fundraiser`, `Donation`, `Credit`, `Adjustment`, `Redemption`, `Refund` |
| **Description** | What families see in their history. | `Poinsettia sale` |
| **Amount** | Dollars. **Positive adds** to the student's funds. **Negative spends** them. Also accepted: Amount ($), Credit, Value. | `130` or `-200` |
| **ActivityID** | Fill this in **only** when funds are applied to (or returned from) a trip or activity. Also accepted: Activity, Trip, TripID. | `FL27` |
| **Reference** | Optional. When the app posts an approved request, it puts the request ID here. | `R-1a2b3c4d` |
| **Entered By** | Who entered it. The app writes the approver's email. | `treasurer@example.com` |

Examples:

| Date | StudentID | Type | Description | Amount | ActivityID | Reference | Entered By |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-11-14 | S0001 | Fundraiser | Poinsettia sale | 130 | | | Pat (treasurer) |
| 2026-12-01 | S0001 | Redemption | Applied to Florida 2027 – Disney & Universal | -200 | FL27 | R-1a2b3c4d | treasurer@example.com |
| 2026-12-03 | S0002 | Adjustment | Correction: Pizza Night counted twice | -30 | | | Pat (treasurer) |
| 2027-03-01 | S0001 | Refund | Florida 2027 cancelled, funds returned | 200 | FL27 | | Pat (treasurer) |

The last row shows how to **give funds back from a trip**: a positive row *with* the ActivityID
raises the balance and lowers what counts as paid on that trip.

Any decrease the app didn't make itself (for example the correction above) sends the family a
short notice, for example *"Liam's activity funds changed. −$30.00 adjustment. New balance: $55.00."*

### Activities

Trips, camps, lessons and anything else families pay toward.

| Column | Meaning | Allowed values / example |
| --- | --- | --- |
| **ActivityID** | Short unique code. | `FL27` |
| **Name** | What families see. | `Florida 2027 – Disney & Universal` |
| **Kind** | Also accepted: Type. Anything else counts as `Other`. | `Trip`, `Camp`, `Lessons`, `Other` |
| **Description** | A sentence or two for families. | |
| **Schools** | Who it's for (informational). Blank = all. | `High School` |
| **Ensembles** | Which groups (informational). Blank = all. | `Band, Jazz Band, Orchestra, Chorus` |
| **Cost** | Default cost per student. Leave blank when it differs per student and set it in Enrollments. Also accepted: Cost Per Student, Price. | `1850` |
| **Deposit** | Optional deposit amount (shown to families). | `350` |
| **Deposit Due** | Optional deposit due date (shown to families). | `2026-11-15` |
| **Due Date** | Final balance due. **Payment reminders** are based on this date. Also accepted: Final Due, Balance Due. | `2027-02-01` |
| **Status** | `Open` or `Closed`. **Blank = Open.** Closed trips stay in history but can't receive activity funds or online payments. | |
| **Allow Funds** | May families apply activity funds? **Blank = TRUE.** | `TRUE` / `FALSE` |
| **Allow Online Payment** | May families pay online? **Blank = TRUE.** (Online payments must also be turned on in Settings.) | `TRUE` / `FALSE` |
| **Info URL** | Optional link to the itinerary or permission slip. | `https://…` |

### Enrollments

Who is going (as the music department tells you). A family only sees the trips their students
are enrolled in.

| Column | Meaning | Allowed values / example |
| --- | --- | --- |
| **StudentID** | The student. | `S0001` |
| **ActivityID** | The trip or activity. | `FL27` |
| **Cost** | This student's cost if different from the activity's (e.g. lessons, a sibling discount). **Blank = the activity's Cost.** Also accepted: Cost Override, Price. | `360` |
| **Status** | `Going`, `Waitlist` or `Withdrawn`. **Blank = Going.** Funds can only be applied while `Going`. Withdrawn trips are hidden from the family unless something was already paid. | |

### Payments

Money paid toward a trip or activity (not activity funds: those are in Ledger). **Online PayPal
payments are added by the app automatically.** You add checks and cash.

| Column | Meaning | Allowed values / example |
| --- | --- | --- |
| **Date** | When it was paid. | `2026-11-20` |
| **StudentID** | Which student it's for. | `S0001` |
| **ActivityID** | Which trip or activity. | `FL27` |
| **Amount** | Credited toward the trip, in dollars. | `350` |
| **Fee Covered** | The optional processing-fee contribution the payer added online. Blank for checks. | `2.54` |
| **Gross** | What the payer was actually charged. Blank = Amount + Fee Covered. | `352.54` |
| **Method** | How it was paid. | `PayPal`, `Card`, `Venmo`, `Check`, `Cash`, `Other` |
| **Reference** | Check number or PayPal transaction ID. | `Check #1043` |
| **Payer Email** | Optional. Filled in by the app for online payments. | |
| **Status** | `Completed`, `Pending`, `Refunded` or `Failed`. **Blank = Completed.** **Only Completed rows count as paid.** | |

* **Pending online payments** (for example a PayPal eCheck) are recorded as `Pending`. When PayPal
  shows the payment completed, change the Status to `Completed`.
* **Refunds:** make the refund in PayPal first. For a **full** refund, change that row's Status to
  `Refunded` (it then stops counting as paid). For a **partial** refund, add a new row with a
  **negative** Amount, Method `PayPal`, Status `Completed`, and a Reference like `Refund of <PayPal ID>`.
  See [PAYMENTS.md](PAYMENTS.md#refunds).
* A bounced check: change its Status to `Failed`.
* **"Payment needs review"**: if PayPal ever reports a different amount than the app expected, the
  app does **not** record the payment. Instead it alerts the board members in `ADMIN_EMAILS` with the
  PayPal transaction ID. Look the payment up in PayPal and add the row by hand.

### Redemptions

Requests from families to apply activity funds to a trip. **The app adds these rows.** You decide them.

| Column | Meaning | Who fills it |
| --- | --- | --- |
| **RequestID** | `R-` plus 8 characters, e.g. `R-1a2b3c4d`. | App |
| **Requested** | When the parent asked. | App |
| **Email** | The parent who asked. | App |
| **FamilyID**, **StudentID**, **ActivityID** | Which household, student and trip. | App |
| **Amount** | Dollars requested. | App |
| **Note** | The parent's note, if any. | App |
| **Status** | `Pending` → change to `Approved` or `Denied`. (`Cancelled` = the parent withdrew it.) **Blank = Pending.** | **You** (or the app's Approve/Deny buttons) |
| **Decided** | When it was decided. | App fills it if blank |
| **Decided By** | Who decided. | App (or you) |
| **Admin Note** | Optional message to the family, included when a request is denied. | You (optional) |
| **Notified** | When the family was told. **Leave this alone.** A blank Notified on an Approved/Denied row is what tells the app to act. | App |

When you type `Approved` here, the app adds the matching **Ledger** row (negative Amount, the
ActivityID, Reference = the RequestID), fills in Decided and Notified, and notifies the family. It
waits until the row has looked the same for about 5 minutes, so it never acts on a half-typed row:
expect it 15 to 30 minutes after your last change to the row. **Don't add that Ledger row yourself.**
(If you already did, make sure its Reference is the RequestID, and the app won't add a second one,
whether you approve in the sheet or in the app.)

### Announcements

News for families.

| Column | Meaning | Example |
| --- | --- | --- |
| **ID** | Optional. Announcements sent from the app get an ID like `A-9f8e7d6c`. | |
| **Date** | Blank = send at the next sync. Today or a future date = send on that day, from 8 AM. | `2026-11-01` |
| **Title** | Short headline. | `Florida 2027 deposit reminder` |
| **Body** | The message. Push notifications show the first 180 characters. | |
| **Schools** | Who it's for. **Blank = everyone.** | `High School` |
| **Ensembles** | Which groups. **Blank = everyone.** | `Chorus` |
| **Link** | Optional web link. | `https://…` |
| **Sent** | **Leave blank.** The app fills in the time when it sends. Clearing it would send the announcement again. | |

An announcement typed here goes out once the row has looked the same for about 5 minutes, at the
next 15-minute sync after that, so finish typing it before you walk away. (Announcements sent from
the app go out at once.)

Who receives it: if both Schools and Ensembles are filled in, a family must match one of each.
If only one is filled in, matching that one is enough. Families who haven't picked any schools or
groups get everything. Each family's topic and channel choices are respected.

### Events

Concerts, meetings and deadlines. They appear under News, and families get a reminder the day
before (in the morning run, about 8 AM).

| Column | Meaning | Example |
| --- | --- | --- |
| **ID** | Optional. | |
| **Date** | Required. | `2026-12-10` |
| **Time** | Free text. | `7:00 PM` |
| **Title** | Required. | `HS Winter Concert` |
| **Location** | | `TRHS Auditorium` |
| **Details** | | `Students arrive 6:15 PM in concert black.` |
| **Schools**, **Ensembles** | Who it's for, as in Announcements. **Blank = everyone.** | `High School` |

---

## Settings

The **Settings** tab has three columns: **Key**, **Value** and **Notes**. Change a **Value** and the
app uses it on the next request. You don't need to redeploy.

* **A blank Value means "use the default"** shown below.
* Keys ignore capitals and spaces (`Admin Emails` = `ADMIN_EMAILS`). If a key appears twice, the
  lower row wins.
* *Set up / repair tabs* adds any missing keys with their defaults and a note.
* **Never put passwords or secret keys here.** Secrets go in Script Properties (see
  [SETUP.md](SETUP.md#script-properties-secrets)).

| Key | Default | What it does |
| --- | --- | --- |
| `ORG_NAME` | Timberlane Music Association | Name shown in the app, in emails and on the PayPal checkout. |
| `SUPPORT_EMAIL` | timberlanemusictma@gmail.com | Where families can email TMA with questions (shown in the app). Also the **Reply-To** of every email the app sends, so replies to `noreply@mytma.org` reach TMA. |
| `APP_URL` | *(blank)* | The app's web address: `https://mytma.org/` (see [SETUP.md step 7](SETUP.md#7-put-the-app-online-at-mytmaorg)). Used for the "Open the TMA app" button in emails. With no address, emails have no button. Never a `github.io` address: that copy is only the demo. |
| `ADMIN_EMAILS` | *(blank)* | Comma-separated emails of board members who get **Board tools** in the app (approve fund requests, verify households, send announcements) and get alerts about new sign-ups and fund requests. They sign in to the app with these emails. |
| `SCHOOLS` | High School, Middle School, Elementary | School levels families can pick. If you rename one, update the Students tab to match. |
| `ENSEMBLES` | Band, Marching Band, Jazz Band, Orchestra, Chorus, Guitar | Groups families can pick. |
| `FEE_PERCENT` | 1.99 | PayPal's percentage fee, used for the optional "cover the processing fee" amount. 1.99 = PayPal's Confirmed Charity rate. **Use 3.49 until TMA is approved for the charity rate.** |
| `FEE_FIXED` | 0.49 | PayPal's fixed fee per payment, in dollars. |
| `FEE_COVER_DEFAULT` | TRUE | `TRUE` = the "cover the processing fee" box starts checked. Families can always uncheck it. |
| `ONLINE_PAYMENTS` | FALSE | `TRUE` shows **Pay online**. It also needs `PAYPAL_CLIENT_ID` here and `PAYPAL_SECRET` in Script Properties. |
| `PAYPAL_ENV` | sandbox | `sandbox` for testing with fake money, `live` for real payments. Must match the PayPal credentials. |
| `PAYPAL_CLIENT_ID` | *(blank)* | The PayPal app's Client ID. This one is public, not secret. |
| `MIN_PAYMENT` | 5.00 | Smallest online payment, in dollars. |
| `OTHER_PAYMENT_INSTRUCTIONS` | Checks payable to "Timberlane Music Association", P.O. Box 420, Plaistow, NH 03865… | Shown to families under "Other ways to pay". |
| `DONATE_URL` | TMA's donate page | Link for the Donate button under *More → Help & contact*. |
| `PRIVACY_NOTE` | TMA only stores what it needs… | Shown in the app under *More → Your privacy*. |
| `REMINDER_DAYS` | 14, 7, 1 | Send payment reminders this many days before an activity's Due Date (only to students with something left to pay). |
| `EMAIL_ENABLED` | TRUE | `FALSE` stops notification emails (push still works). **Sign-in codes are always emailed.** |
| `EMAIL_VIA` | cloudflare | Which way the app's emails go out. `cloudflare` = from **noreply@mytma.org** through TMA's push Worker (Cloudflare Email Sending, see [SETUP.md](SETUP.md#email-from-noreplymytmaorg)); if the Worker can't send one, that email goes out with Gmail instead. `gmail` = always from the Google account that runs the script. |
| `SMS_ENABLED` | FALSE | `TRUE` offers text messages (needs Twilio, which costs about 1¢ per text; see SETUP.md). |
| `PUSH_RELAY_URL` | https://tma-push.coleciprari.workers.dev | Web address of TMA's push Worker on Cloudflare, which delivers phone notifications. **Leave the default** unless TMA moves the Worker. Changing it takes more than this cell: follow [SETUP.md step 5F](SETUP.md#f-moving-to-another-cloudflare-account), which ends with *TMA App → Set up / repair tabs*. Anything that isn't an `https://` address (for example `off`) turns phone notifications off; email still works. |
| `TOKEN_VERSION` | 1 | Change it (e.g. to `2`) to **sign everyone out** of the app, for example after a board member leaves or a phone is lost. Everyone simply signs in again with a new code. |
| `SESSION_DAYS` | 120 | How many days a sign-in lasts (1–400). |

---

## Hidden system tabs

The app keeps a few tabs of its own. They are hidden so they don't get in your way. **Don't edit
them.** You can look at them with *View → Hidden sheets*.

| Tab | What it holds |
| --- | --- |
| **Preferences** | Each parent's notification choices (schools, groups, topics, push/email/text). |
| **Devices** | One row per phone or computer where a parent turned on notifications: the parent's email, household, the browser's **push subscription** (a web address at Apple, Google, Mozilla or Microsoft, plus two keys used to lock each message so that only that browser can read it; not a phone number), the device type and when it was last seen. Rows that the push service reports as expired are removed automatically. |
| **Log** | What the app did: notifications sent, approvals, errors. Board members also see the latest entries in the app under *Board tools → Recent activity*. |
| **_Snapshot** | The last balance the app saw for each student, used to notice changes. |
| **_Sent** | Which reminders were already sent, so nobody gets the same reminder twice. |

**The one exception: bulk changes without notifying families.** The app notifies a family whenever
a student's balance changes. If you ever need to make a large correction or re-import that families
should *not* be pinged about:

1. Make your changes.
2. Right away, show **_Snapshot** (*View → Hidden sheets*) and delete all rows **below the header**.
3. Run *TMA App → Run sync now*. With an empty snapshot the app records the current balances as the
   new starting point and sends nothing.
4. Hide the tab again (right-click its tab → *Hide sheet*).

If the 15-minute run happens to fall between steps 1 and 2, a few families get a notice. That's harmless.

---

## Importing the existing spreadsheet

**Before you start:** make a backup with *File → Make a copy* of the current spreadsheet. We
recommend setting the app up in a **new** spreadsheet (see [SETUP.md](SETUP.md)) and copying data
into it, and keeping the old one as your archive. (The app can also be added to the existing
spreadsheet. Setup only adds tabs and columns that are missing and never deletes anything. But a
fresh sheet is easier to keep tidy.)

**Do the import before you run *TMA App → Install schedules*.** That way no family is notified
about the imported amounts (see step 7).

1. **Families.** Paste one row per household: Parent Name, Email, Phone, the second parent's
   columns if you have them, and Status `Active`. Your existing column names are fine if they are
   in the "also accepted" lists above. Otherwise rename the header to the one shown.
2. **Give every household a FamilyID.** A quick way: in the first data row of FamilyID, type
   `="F"&TEXT(ROW()-1,"0000")`, copy it down the column, then *Edit → Paste special → Values only* so
   the IDs never change. This makes `F0001`, `F0002`, …
3. **Students.** One row per student with StudentID (same trick with `"S"`), the household's FamilyID,
   first and last name, grade, school, groups and Status `Active`. If you only know the student's
   parent's name, look up the FamilyID on the Families tab.
4. **Ledger.** The simplest start is **one opening-balance row per student**: Date = the day you
   switch over, Type `Opening balance`, Description `Balance carried over from the old spreadsheet`,
   Amount = today's balance. Keep the old spreadsheet for the detailed history. (You may paste the
   full history instead. Then check that each student's total matches the old sheet.)
5. **Current trips.** Add each open trip to **Activities**, each participating student to
   **Enrollments**, and every check or payment already received to **Payments** (Status
   `Completed`), so "remaining" is right from day one.
6. **Check your work.** On the Ledger tab, *Insert → Pivot table* (Rows: StudentID, Values: SUM of
   Amount) and compare a few students' totals with the old sheet. Delete the pivot tab afterwards.
   Once the app is online, also sign in as a parent (or ask a friendly family) and compare a few
   balances and trip totals.
7. **Take the starting snapshot.** Run *TMA App → Run sync now* once. On this first run the app
   records every balance and sends nothing (the hidden Log tab notes "First run: saved N balances
   (no notifications)"). **Then** run *TMA App → Install schedules*.

Rows that families create by signing up get IDs like `F0007` and `S0012` automatically (the next
number after the highest one in use). Rows you add by hand may use any unique ID.

If a parent signs up in the app before you've imported their household, nothing is lost. Their
household shows up under *Board tools → New households*. When you approve it, pick your existing
student record from the suggestions so its balance and history carry over.
