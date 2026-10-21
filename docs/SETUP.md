# Setting up the TMA Family App

This guide takes you from nothing to a working app for TMA families. It takes **about an hour**,
costs **$0**, and needs no programming, just careful clicking. Do it on a computer, not a phone.

| Step | What you'll do | Time |
| --- | --- | --- |
| [0](#0-before-you-start) | Get ready | 5 min |
| [1](#1-create-the-spreadsheet-and-add-the-script) | Create the spreadsheet and add the script | 10 min |
| [2](#2-fill-in-the-settings-tab) | Fill in the Settings tab | 5 min |
| [3](#3-deploy-the-web-app-the-apps-server) | Deploy the web app (the app's server) | 5 min |
| [4](#4-turn-on-the-schedules) | Turn on the schedules | 2 min |
| [5](#5-push-notifications-firebase) | Push notifications (Firebase) | 10 min |
| [6](#6-online-payments-paypal) | Online payments (PayPal). Optional, can be done later. | 15 min plus PayPal's approval |
| [7](#7-host-the-app-on-github-pages) | Put the app online (GitHub Pages) | 10 min |
| [8](#8-optional-text-messages-twilio) | Text messages (Twilio). Optional, **costs money**. | 20 min plus carrier approval |
| [9](#9-go-live-checklist-and-test-plan) | Go-live checklist and test | 30 min |
| [10](#10-updating-the-app-later) | Updating the app later | |
| [11](#11-troubleshooting) | Troubleshooting | |

**How families sign in.** There are no passwords. A parent types their email, TMA's Gmail sends a
6-digit code ("Your TMA sign-in code: 123456"), and they type it in. Codes expire after 10 minutes.
A sign-in lasts 120 days on that phone. Anyone can sign in with any email and set up their household,
but they see **no money information** until the treasurer verifies the household.

---

## 0. Before you start

* **Use TMA's Google account** (`timberlanemusictma@gmail.com`) for everything: the spreadsheet,
  the script and Firebase. Then nothing depends on one volunteer's personal account.
* **Use a browser window signed in to only that account.** Apps Script gets confused when several
  Google accounts are signed in at once. In Chrome, create a separate profile for TMA (click the
  profile picture at the top right → *Add*), or use a private/incognito window.
* **Turn on 2-Step Verification** for the TMA account (*Google Account → Security*). This account
  will hold family information, so protect it.
* **The code** lives in a GitHub repository (for example `github.com/<owner>/<repo>`). You need two
  files from its `apps-script/` folder: `Code.js` and `appsscript.json`. For step 7 you need to be an
  owner or admin of the repository.

> **Tip: Google Workspace for Nonprofits (optional, free).** As a 501(c)(3), TMA qualifies for
> [Google Workspace for Nonprofits](https://www.google.com/nonprofits/) at no cost. It raises the
> number of emails the app can send from about **100 to about 1,500 recipients a day** (sign-in
> codes count too), and gives TMA email addresses at its own domain. A free Gmail account is
> enough to start. See [Quotas](#quotas) for what the limits mean in practice.

## 1. Create the spreadsheet and add the script

1. Go to **https://sheets.new** while signed in as the TMA account. Click *Untitled spreadsheet*
   at the top left and name it **TMA App**.
2. Click **Extensions → Apps Script**. A new tab opens with a file called `Code.gs`.
3. Click *Untitled project* at the top and rename it **TMA App**.
4. **Paste the code.** In another tab, open `apps-script/Code.js` in the GitHub repository and click
   the **Copy raw file** button (two overlapping squares, top right of the file). Back in Apps
   Script, click inside `Code.gs`, select everything (**Ctrl+A**, or **Cmd+A** on a Mac), and paste
   (**Ctrl+V** / **Cmd+V**) so it replaces what was there. Click the **Save** icon (💾).
   The file is long. That's expected.
5. **Paste the manifest.** In the left sidebar click **Project Settings** (⚙). Tick
   **Show "appsscript.json" manifest file in editor**. Click **Editor** (`< >`) in the sidebar,
   open `appsscript.json`, replace its contents with `apps-script/appsscript.json` from GitHub the
   same way, and **Save**.
6. **Run the setup once.** In the toolbar, pick **setupTma** from the function drop-down and click
   **Run**. Google asks for permission:
   1. *Authorization required* → **Review permissions** → choose the TMA account.
   2. *Google hasn't verified this app* → click **Advanced** → **Go to TMA App (unsafe)**. This
      warning appears for any private script that hasn't been through Google's public review. It
      is TMA's own script running in TMA's own account.
   3. Google lists what the script may do. In plain words: view and change **only this
      spreadsheet** (not the rest of TMA's Drive), show its menu, **send email as TMA**, connect to
      outside services (PayPal, Firebase, Twilio), **run on a schedule**, and see which Google
      account is using it. Click **Allow**.

   The *Execution log* at the bottom should end with *Execution completed*.
7. Go back to the spreadsheet tab and **reload the page**. After a few seconds a **TMA App** menu
   appears next to *Help*, and the tabs Families, Students, Ledger, Activities, Enrollments,
   Payments, Redemptions, Announcements, Events and Settings exist. (A few system tabs are hidden.
   See [SHEET.md](SHEET.md#hidden-system-tabs).)

From now on, **TMA App → Set up / repair tabs** re-creates anything missing (tabs, columns, settings).
It never deletes anything, so it's safe to run whenever you like.

**Want to explore with practice data first?** The easiest way is the online demo (see the
[README](../README.md#try-the-demo)). To practice in a real sheet, do this **right now, while the
sheet is still empty**: *File → Make a copy*, name it **TMA App – practice**, open the copy,
*Extensions → Apps Script*, choose **setupTmaWithSampleData** and **Run** (authorize again). The copy
fills up with made-up families and trips. **Never run setupTmaWithSampleData on the real
spreadsheet.** It only fills tabs that are empty, but there's no reason to risk it.

## 2. Fill in the Settings tab

Open the **Settings** tab. Each row is a **Key**, a **Value** and a **Note**. A blank Value means
"use the default". The full list is in [SHEET.md → Settings](SHEET.md#settings). For now:

| Key | What to enter |
| --- | --- |
| `ADMIN_EMAILS` | The emails of the board members who will approve requests and send announcements, separated by commas, e.g. `treasurer@…, president@…`. **These are the emails they will sign in to the app with.** |
| `SUPPORT_EMAIL` | Where families should send questions (default `timberlanemusictma@gmail.com`). |
| `OTHER_PAYMENT_INSTRUCTIONS` | Check the address and memo instructions. |
| `DONATE_URL` | Check the link opens TMA's donation page. |
| `EMAIL_ENABLED` | Leave `TRUE`, but read [Quotas](#quotas). |

Leave `APP_URL` (step 7) and the PayPal settings (step 6) for later.

**Now bring in your data** (households, students, balances, trips). Follow
[SHEET.md → Importing the existing spreadsheet](SHEET.md#importing-the-existing-spreadsheet).
**Do this before step 4**, so families aren't notified about imported balances.

## 3. Deploy the web app (the app's server)

This gives the script a web address the app talks to.

1. In Apps Script, click the blue **Deploy** button (top right) → **New deployment**.
2. Click the gear (⚙) next to *Select type* → **Web app**.
3. Fill in:
   * **Description:** `TMA app`
   * **Execute as:** **Me** (`timberlanemusictma@gmail.com`)
   * **Who has access:** **Anyone**. (Not "Anyone with Google account". Parents don't need a
     Google account.)
4. Click **Deploy** (authorize again if asked). Copy the **Web app URL**. It looks like
   `https://script.google.com/macros/s/AKfy…/exec`. **This is `VITE_API_URL`.** Keep it handy for
   step 7.
5. Test it: paste the URL into a browser with `?action=health` added to the end. You should see
   something like `{"ok":true,"data":{"version":"0.1.0","time":"…"}}`.

*Is "Anyone" safe?* Yes. The address only answers the app's requests. Every request except signing
in needs a valid, signed sign-in session, and each parent only ever gets their own household's data.

**Updating the deployment later (keeps the same URL).** After you paste new code (step 10):
**Deploy → Manage deployments** → select the active deployment → **Edit** (pencil icon) →
*Version:* **New version** → **Deploy**. Don't use *New deployment* again. That creates a
**different** URL, and the app would keep talking to the old one.

## 4. Turn on the schedules

The app checks the sheet every 15 minutes (new credits, approvals typed into the sheet, queued
announcements) and sends reminders once a day around 8 AM.

1. If you are importing data, finish the import first, including the *Run sync now* step in
   [SHEET.md](SHEET.md#importing-the-existing-spreadsheet).
2. In the spreadsheet: **TMA App → Install schedules** (authorize if asked).
3. Check: **TMA App → Status** should show *Schedules: sync every 15 min ✓, daily reminders ✓*.
   In Apps Script, the **Triggers** page (⏰ in the sidebar) lists `syncTick` (every 15 minutes) and
   `dailyTick` (every day, 8–9 AM).

Running *Install schedules* again is safe: it replaces the old schedules instead of adding more.

## 5. Push notifications (Firebase)

Push notifications go through **Firebase Cloud Messaging**, which is free on Firebase's
no-cost **Spark** plan (no credit card needed). You'll collect three things:

* the **web config** → `VITE_FIREBASE_CONFIG` (public, goes into GitHub in step 7),
* the **Web Push key** → `VITE_FIREBASE_VAPID_KEY` (public, goes into GitHub in step 7),
* a **service-account key** → Script Property `FCM_SERVICE_ACCOUNT` (**secret**, goes into Apps Script).

**A. Create the project**

1. Go to **https://console.firebase.google.com** (signed in as the TMA account).
2. **Create a project** (it may say *Get started by setting up a Firebase project*). Name it
   `TMA Family App`. Google Analytics isn't needed. Turn it off. Click **Create project**.

**B. Register the web app and copy its config**

1. On the project's home page click **+ Add app** → the **Web** icon (`</>`).
2. Nickname: `TMA web`. Leave *Firebase Hosting* unticked (unless you choose Firebase Hosting in
   step 7). Click **Register app**.
3. The page shows code like this:

   ```js
   const firebaseConfig = {
     apiKey: "AIza…",
     authDomain: "tma-family-app.firebaseapp.com",
     projectId: "tma-family-app",
     storageBucket: "tma-family-app.firebasestorage.app",
     messagingSenderId: "123456789012",
     appId: "1:123456789012:web:abc123…"
   };
   ```

4. Turn it into **one line of JSON**: keep only the part from `{` to `}`, put **double quotes**
   around every name, and remove the line breaks:

   ```json
   {"apiKey":"AIza…","authDomain":"tma-family-app.firebaseapp.com","projectId":"tma-family-app","storageBucket":"tma-family-app.firebasestorage.app","messagingSenderId":"123456789012","appId":"1:123456789012:web:abc123…"}
   ```

   **This is `VITE_FIREBASE_CONFIG`.** These values are not secret. Every Firebase website contains
   them. You can find them again later under ⚙ **Project settings → General → Your apps**.

**C. Generate the Web Push key**

1. Click ⚙ (next to *Project Overview*) → **Project settings** → the **Cloud Messaging** tab.
2. Check that **Firebase Cloud Messaging API (V1)** says **Enabled**. If it says Disabled, click
   the ⋮ menu next to it → *Manage API in Google Cloud Console* → **Enable**.
3. Scroll to **Web configuration → Web Push certificates** → **Generate key pair**. Copy the long
   *Key pair* value. **This is `VITE_FIREBASE_VAPID_KEY`** (a public key).

**D. Let the script send notifications (service-account key)**

1. Still in **Project settings**, open the **Service accounts** tab → **Generate new private key** →
   **Generate key**. A `.json` file downloads.
2. Open the file with Notepad (Windows) or TextEdit (Mac). Select everything and copy it. It starts
   with `{ "type": "service_account", "project_id": …`.
3. In Apps Script: **Project Settings** (⚙) → scroll to **Script Properties** → **Add script property**:
   * Property: `FCM_SERVICE_ACCOUNT`
   * Value: paste the whole file contents
   * **Save script properties**.
4. **Delete the downloaded file** and empty the trash/recycle bin.

> ⚠ **Treat this key like a password.** Anyone who has it could send notifications to TMA's
> families. If it ever leaks, delete it in the Google Cloud console (*IAM & Admin → Service
> accounts* → the `firebase-adminsdk` account → *Keys* → delete) and generate a new one.

**E. Check:** **TMA App → Status** shows *Push notifications (Firebase): configured*. Phones
can register only after step 7, when the app is rebuilt with the two `VITE_FIREBASE_…` values.

## 6. Online payments (PayPal)

Optional, and it can be done any time later. Families can always pay by check, and **using
activity funds never involves PayPal**. Before turning this on, the board should read
[PAYMENTS.md](PAYMENTS.md). It answers "can card payments be free?" (short answer: not through
PayPal, but families can choose to cover the fee).

**A. A PayPal Business account (free).** If TMA doesn't have one, sign up at paypal.com for a
**Business** account in TMA's legal name with its EIN, and link TMA's bank account. An existing
personal account can be upgraded to Business.

**B. Apply for PayPal's Confirmed Charity rate** (1.99% + $0.49 instead of 3.49% + $0.49). PayPal
must approve it first. Have the IRS **501(c)(3) determination letter** and the **EIN** ready. Ask
PayPal's nonprofit team whether trip payments (not just donations) qualify. Their number is
1-866-365-6319 (from [PayPal's nonprofit FAQ](https://www.paypalobjects.com/digitalassets/c/website/marketing/na/us/donations/paypal-for-non-profit-faq.pdf)).
**Until TMA is approved, set `FEE_PERCENT` to `3.49`** in Settings so "cover the fee" covers the real fee.

**C. Create the PayPal app (Sandbox first)**

1. Go to **https://developer.paypal.com** → **Log in to Dashboard** with TMA's PayPal Business login.
2. Open **Apps & Credentials**. Make sure the switch at the top says **Sandbox** (test money).
3. **Create App** → App name `TMA Family App`, type **Merchant** → **Create App**.
4. Copy the **Client ID** and the **Secret** (click to show it).

**D. Enter the sandbox credentials**

* Settings tab: `PAYPAL_CLIENT_ID` = the Client ID, `PAYPAL_ENV` = `sandbox`, `ONLINE_PAYMENTS` = `TRUE`.
* Apps Script → Project Settings → Script Properties: add `PAYPAL_SECRET` = the Secret.
* Check with **TMA App → Status**: *PayPal: configured (sandbox); online payments on*.

**E. Test with fake money.** Do this **before families start using the app** (while
`ONLINE_PAYMENTS` is `TRUE` with sandbox keys, everyone sees test-mode PayPal buttons).

1. On developer.paypal.com → **Testing Tools → Sandbox Accounts**, there is a ready-made
   **Personal** (buyer) account. Open its ⋮ menu → *View/Edit account* to see its email and password.
2. In the app, as a verified test household with a trip: **Trips → Pay online**, click the
   **PayPal** button and log in with that sandbox buyer. To test cards, use **Debit or Credit Card**
   with a test number from *Testing Tools → Credit Card Generator*.
3. Check that a row appears in **Payments** (Method `PayPal`, Status `Completed`), the trip's
   remaining amount goes down, and the family gets *"Payment received – thank you!"*.
4. Delete those test rows from **Payments** afterwards. They weren't real money.

**F. Go live**

1. On developer.paypal.com switch the toggle to **Live**, then **Apps & Credentials → Create App**
   (Merchant). Copy the **live** Client ID and Secret.
2. Settings: `PAYPAL_CLIENT_ID` = live Client ID, `PAYPAL_ENV` = `live`, `ONLINE_PAYMENTS` = `TRUE`.
3. Script Properties: replace `PAYPAL_SECRET` with the **live** Secret.
4. Make one small real payment (the minimum is `MIN_PAYMENT`, $5) and refund it in PayPal. Then
   change its Payments row Status to `Refunded`.

To switch online payments off at any time, set `ONLINE_PAYMENTS` to `FALSE`. Families then see the
"Other ways to pay" instructions only.

## 7. Host the app on GitHub Pages

The app itself (what families open) is a set of files that GitHub hosts for free. The repository
includes a workflow (`.github/workflows/deploy-pages.yml`) that builds and publishes it.

GitHub Pages is free for **public** repositories (private ones need a paid GitHub plan). The code
contains no secrets, so a public repository is fine.

1. In the repository on github.com: **Settings → Pages → Build and deployment → Source:
   GitHub Actions**.
2. **Settings → Secrets and variables → Actions → Variables** tab → **New repository variable**,
   three times:

   | Name | Value |
   | --- | --- |
   | `VITE_API_URL` | The Web app URL from step 3 (ends in `/exec`) |
   | `VITE_FIREBASE_CONFIG` | The one-line JSON from step 5B |
   | `VITE_FIREBASE_VAPID_KEY` | The key pair from step 5C |

   Use **Variables**, not *Secrets*. These values are public (they end up in the app's code anyway),
   and the workflow reads them as variables.
3. Open the **Actions** tab → **Deploy to GitHub Pages** → **Run workflow** → branch `main` →
   **Run workflow**. (It also runs by itself whenever something is pushed to `main`.) Wait for the
   green check, about 2–3 minutes.
4. The app is now at **`https://<owner>.github.io/<repo>/`**, for example
   `https://coledtouch.github.io/TMA/`. The address is also shown under *Settings → Pages*.
5. In the spreadsheet's **Settings** tab set `APP_URL` to that address (with the `/` at the end).
6. Open the address on your phone. The sign-in page should **not** show the *Demo* box. If it
   does, the variables weren't picked up: check their names and run the workflow again.

**Whenever you change one of these variables, run the workflow again.** The values are built into
the app.

**Without any variables, the site is the demo.** That's useful as a prototype link for the board.

**Alternative: Firebase Hosting** (also free on the Spark plan; you get `https://<project-id>.web.app`).
This needs Node.js on your computer and a terminal:

```bash
npm ci
# Create a file named .env.production.local with the three lines:
#   VITE_API_URL=…
#   VITE_FIREBASE_CONFIG={"apiKey":"…",…}
#   VITE_FIREBASE_VAPID_KEY=…
npm run build:web
npx firebase-tools login
npx firebase-tools init hosting   # use your existing project; public directory: dist; single-page app: No;
                                  # GitHub deploys: No; don't overwrite dist/index.html
npx firebase-tools deploy --only hosting
```

## 8. Optional: text messages (Twilio)

Push notifications and email are free. **Text messages cost money**: about 1¢ per text, plus a
monthly fee for the phone number. US carriers also require a one-time registration before texts
from a business number are delivered. It can take days to weeks and has small fees. Check current
prices at [twilio.com](https://www.twilio.com/en-us/sms/pricing/us). Most groups don't need texts.

1. Create a Twilio account, add a payment method, buy a phone number that can send SMS, and complete
   the US carrier registration Twilio walks you through.
2. From the Twilio console, copy the **Account SID** and **Auth Token**.
3. Apps Script → Project Settings → Script Properties: add `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`
   and `TWILIO_FROM` (the Twilio number like `+16035550123`, or a Messaging Service SID starting with `MG`).
4. Settings tab: `SMS_ENABLED` = `TRUE`.

Families then see a **Text messages** option with a *Cell number for texts* box under
*More → Notifications*.

## 9. Go-live checklist and test plan

**Checklist**

- [ ] **TMA App → Status** shows: a web app URL, your `APP_URL`, both schedules ✓, `TOKEN_SECRET`
      among the secrets set, push *configured*, PayPal as intended, email *on*.
- [ ] Settings: `ADMIN_EMAILS`, `SUPPORT_EMAIL`, `OTHER_PAYMENT_INSTRUCTIONS` and `DONATE_URL` are
      right, and `FEE_PERCENT` matches TMA's actual PayPal rate.
- [ ] Data imported, and the first *Run sync now* done (see [SHEET.md](SHEET.md#importing-the-existing-spreadsheet)).
- [ ] The app's address opens **without** the Demo box.
- [ ] Only the treasurer and one or two board members can edit the spreadsheet (*Share* button).

**Test plan** (two people, two phones, about 30 minutes)

1. **Sign up.** On phone A, open the app address and sign in with a personal email. The code email
   arrives (check spam). Set up a household with a test student (e.g. "Test Student", grade 9,
   High School, Band).
2. **Verify.** A board member listed in `ADMIN_EMAILS` signs in on phone B and opens
   **More → Board tools → New households** → **Approve**. Phone A gets *"You're all set!"*.
3. **Install and allow notifications** on phone A. iPhone: Safari → **Share** → **Add to Home
   Screen**, open TMA from the Home Screen. Android: tap **Install**. Then **More → Notifications
   → Turn on notifications → Allow**, and **Send a test notification**. It should arrive.
4. **Credit.** The treasurer adds a **Ledger** row for the test student: `+1`, Type `Fundraiser`,
   Description `Test credit`. Within 15 minutes (or right away with **TMA App → Run sync now**)
   phone A gets *"+$1.00 for Test"*, and the Funds tab shows $1.00.
5. **Use funds.** Add a test **Activity** (Cost `10`) and an **Enrollment** for the test student.
   On phone A: **Trips → Use activity funds** → $1 → send. On phone B: approve it in **Board
   tools**. Phone A gets *"Funds applied to …"*, and Ledger has a new `-1` row.
6. **Pay** (if PayPal is set up): make a sandbox payment as in step 6E.
7. **Announce.** In **Board tools → Send an announcement**, send one to *High School* only. Phone
   A gets it. A household with only a Middle School student would not.
8. **Clean up.** Delete the test rows from Ledger, Payments, Redemptions, Enrollments and
   Activities, and mark the test household and student `Inactive`.

**Launching to families.** Share the address by email, on Facebook and on TMA's website, with
four steps: *open the link → Add to Home Screen → sign in with your email and set up your
household → turn on notifications*. On a free Gmail account, **announce in waves** (for example one
grade level per day), because sign-in codes count against the daily email limit. See [Quotas](#quotas).

## 10. Updating the app later

**The app families open (GitHub Pages)** updates by itself whenever new code is pushed to `main`.
Families see *"A new version of the app is ready"* with a **Reload** button.

**The server (Apps Script)** must be updated by hand when `apps-script/Code.js` changes:

1. Open `apps-script/Code.js` on GitHub → **Copy raw file**.
2. Apps Script → `Code.gs` → select all → paste → **Save**. If `apps-script/appsscript.json`
   changed too, update it the same way.
3. **Deploy → Manage deployments** → **Edit** (pencil) → *Version:* **New version** → **Deploy**.
   The URL stays the same.
4. In the spreadsheet: **TMA App → Set up / repair tabs** (adds any new columns or settings).

Do steps 2 and 3 together. The menu and schedules use the saved code right away, but the app keeps
using the previously deployed version until step 3. If Google asks for permissions again, run
**setupTma** once from the editor and allow.

*For developers:* change the TypeScript in `src/`, run `npm run build:gas`, and commit the new
`apps-script/Code.js` with your change. CI fails if you forget.

## 11. Troubleshooting

**Notifications**

* **iPhone/iPad: no "Turn on notifications" button, or no prompt.** Apple only allows web
  notifications for apps **added to the Home Screen** on **iOS/iPadOS 16.4 or later**. Open the app
  in **Safari** (not inside Facebook/Instagram), **Share → Add to Home Screen**, open it from the
  Home Screen, then *More → Notifications*.
* **"Notifications are blocked."** The parent tapped *Don't Allow* once. iPhone: *Settings app →
  Notifications → TMA → Allow Notifications*. Android/computer: the site settings (lock icon next
  to the address) → *Notifications → Allow*.
* **"Phone notifications aren't set up for TMA yet."** The app was built without the
  `VITE_FIREBASE_…` variables. Do step 7 again.
* **The test works but balance notifications don't arrive.** Check that the schedules are installed
  (*TMA App → Status*), that the household **and** the student are `Active`, and that the parent
  hasn't turned off *Activity fund changes* in *More → Notifications*. The very first sync only records
  balances and sends nothing.
* **"Send me a test notification" (sheet menu) finds no phones.** It sends to the Google account
  you're using in the sheet. Sign in to the app with that same email on your phone and turn on
  notifications first.

**Email and sign-in**

* **The code email doesn't arrive.** Check the spam/promotions folder and mark it *Not spam*. Codes
  expire after 10 minutes, and each email can request at most 5 codes per hour.
* **"TMA has reached today's email limit."** The daily Gmail quota is used up (see [Quotas](#quotas)).
  It resets within 24 hours.
* **"The TMA app isn't set up yet."** The `TOKEN_SECRET` script property is missing. Run
  **TMA App → Set up / repair tabs**.

**Apps Script**

* **"Authorization required" or "This app is blocked", or "Sorry, unable to open the file at this
  time."** Use a browser window signed in to only the TMA account. Then run **setupTma** from the
  editor once and allow.
* **"Network problem" or "The TMA server took too long to answer" in the app.** Check that
  `VITE_API_URL` is the **/exec** address from *Deploy → Manage deployments* (not the editor's
  address and not one ending in `/dev`), that *Who has access* is **Anyone**, and that
  `<address>?action=health` answers in a browser. The app sends its requests as plain text on
  purpose. That way the browser doesn't need a "CORS preflight" check, which Apps Script can't
  answer. Google answers through a redirect to `script.googleusercontent.com`, which is normal.
* **A change to the code isn't showing up.** You probably saved but didn't deploy a **New version**
  (step 10).
* **Where to see what happened:** the hidden **Log** tab (*View → Hidden sheets*), *Board tools →
  Recent activity* in the app, and **Executions** in the Apps Script sidebar for errors.
  Google may also email the TMA account a "Summary of failures".
* **Firebase says "Key creation is disabled".** This only happens with Google Workspace accounts that
  block service-account keys. A Workspace admin can allow keys for this one project, or create the
  Firebase project under the free Gmail account instead.

**PayPal**

* **"PayPal authentication failed."** `PAYPAL_CLIENT_ID`, `PAYPAL_ENV` and `PAYPAL_SECRET` don't
  belong together (e.g. a sandbox ID with `live`, or an extra space in the secret).
* **No "Pay online" button.** It needs `ONLINE_PAYMENTS` = `TRUE`, `PAYPAL_CLIENT_ID`, the
  `PAYPAL_SECRET` script property, and *Allow Online Payment* not set to FALSE on that activity.
  Ad blockers can also hide PayPal's buttons.
* **A board member got "Payment needs review".** PayPal reported a different amount than expected,
  so the app didn't record it. Check the payment in PayPal and add it to Payments by hand.
* **A payment shows as Pending.** PayPal hasn't released it yet (e.g. an eCheck). When PayPal shows it
  completed, change the Payments row Status to `Completed`.

**People**

* **A board member leaves.** Remove their email from `ADMIN_EMAILS` (takes effect immediately),
  remove their access to the spreadsheet, and if in doubt change `TOKEN_VERSION` to sign everyone out.
* **A parent changed email address.** Update the email on their Families row. Signing in with the
  new address then opens their household.

## Script Properties (secrets)

Secrets never go in the spreadsheet. They live in **Apps Script → Project Settings (⚙) → Script
Properties** (*Edit script properties* → *Add script property* → **Save script properties**).
Anyone who can edit the spreadsheet can open its script and read these. That's another reason to
keep spreadsheet editors to a minimum.

| Property | Needed for | What it is |
| --- | --- | --- |
| `TOKEN_SECRET` | Always (**created automatically** by setup) | Signs everyone's sign-in sessions. Don't share it. Changing it signs everyone out. If it's ever deleted, *TMA App → Set up / repair tabs* creates a new one. |
| `PAYPAL_SECRET` | Online payments | The PayPal app's Secret, from the same app (sandbox or live) as `PAYPAL_CLIENT_ID`. |
| `FCM_SERVICE_ACCOUNT` | Push notifications | The whole Firebase service-account JSON file (step 5D). |
| `TWILIO_ACCOUNT_SID` | Text messages | From the Twilio console. |
| `TWILIO_AUTH_TOKEN` | Text messages | From the Twilio console. |
| `TWILIO_FROM` | Text messages | The Twilio number (`+16035550123`) or a Messaging Service SID (`MG…`). |

**TMA App → Status** lists which of these are set (names only, never the values).

## Quotas

Google limits how much a free script can do each day. For TMA's size, only **email** matters.

| Limit (per day) | Free Gmail account | Google Workspace (e.g. for Nonprofits) |
| --- | --- | --- |
| Email recipients (sign-in codes **and** notification emails) | about 100 | about 1,500 |
| Total time for scheduled runs | 90 minutes | 6 hours |
| Calls to outside services (push, PayPal) | 20,000 | 100,000 |

The current figures are on Google's [Apps Script quotas](https://developers.google.com/apps-script/guides/services/quotas)
page, and Google changes them from time to time.

**What this means for ~300 families on a free Gmail account.** Push notifications don't count
toward the email limit, so the more families turn on push, the better. The app always keeps the
last **20** emails of each day for sign-in codes: once fewer than 20 remain, notification emails
are skipped (the Log tab says how many), and only sign-in codes are sent. Even so, one announcement
sent **by email** to everyone uses most of the day's quota, leaving room for only about 20
sign-ins. So, until TMA has Google Workspace:

* when sending an announcement to everyone from the app, tick only **Phone notification** (untick
  **Email**), or set `EMAIL_ENABLED` to `FALSE` (sign-in codes are still emailed);
* launch to families in waves of fewer than 100 a day.

The 15-minute sync takes a few seconds per run, far below the scheduled-time limit.
