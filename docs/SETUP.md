# Setting up the TMA Family App

This guide takes you from nothing to a working app for TMA families. It takes **about an hour**,
costs **$0** (plus **$5 a month** if emails should come from `noreply@mytma.org`, see
[Email from noreply@mytma.org](#email-from-noreplymytmaorg)), and needs no programming, just careful
clicking. Do it on a computer, not a phone.

| Step | What you'll do | Time |
| --- | --- | --- |
| [0](#0-before-you-start) | Get ready | 5 min |
| [1](#1-create-the-spreadsheet-and-add-the-script) | Create the spreadsheet and add the script | 10 min |
| [2](#2-fill-in-the-settings-tab) | Fill in the Settings tab | 5 min |
| [3](#3-deploy-the-web-app-the-apps-server) | Deploy the web app (the app's server) | 5 min |
| [4](#4-turn-on-the-schedules) | Turn on the schedules | 2 min |
| [5](#5-push-notifications-cloudflare-free) | Push notifications (Cloudflare, free). Already running: just check it. | 2 min |
| [Email](#email-from-noreplymytmaorg) | Email from `noreply@mytma.org` (Cloudflare Workers Paid, $5/month). Without it, email comes from the Google account. | 15 min |
| [6](#6-online-payments-paypal) | Online payments (PayPal). Optional, can be done later. | 15 min plus PayPal's approval |
| [7](#7-host-the-app-on-github-pages) | Put the app online (GitHub Pages) | 10 min |
| [8](#8-optional-text-messages-twilio) | Text messages (Twilio). Optional, **costs money**. | 20 min plus carrier approval |
| [9](#9-go-live-checklist-and-test-plan) | Go-live checklist and test | 30 min |
| [10](#10-updating-the-app-later) | Updating the app later | |
| [11](#11-troubleshooting) | Troubleshooting | |
| [Test](#test-spreadsheet) | Optional: try the real app with the test spreadsheet first | 15 min |

**How families sign in.** There are no passwords. A parent types their email, the app emails them a
6-digit code ("Your TMA sign-in code: 123456") from `noreply@mytma.org` (or from TMA's Gmail when that
isn't set up), and they type it in. Codes expire after 10 minutes.
A sign-in lasts 120 days on that phone. Anyone can sign in with any email and set up their household,
but they see **no money information** until the treasurer verifies the household.

---

## 0. Before you start

* **Use TMA's Google account** (`timberlanemusictma@gmail.com`) for everything: the spreadsheet
  and the script. Then nothing depends on one volunteer's personal account.
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
      outside services (PayPal, TMA's push Worker, Twilio), **run on a schedule**, and see which
      Google account is using it. Click **Allow**.

   The *Execution log* at the bottom should end with *Execution completed*. Just before that it
   says *Push: linked this sheet to the push Worker* and *Push: saved the Worker's public key*.
   If it shows a ⚠ line about push instead, carry on and see [step 5](#5-push-notifications-cloudflare-free).
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
To try the **real app** (real emails and notifications) on sample data, see
[Test spreadsheet](#test-spreadsheet).

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
| `EMAIL_VIA` | Leave `cloudflare`: emails come from `noreply@mytma.org` once [that is set up](#email-from-noreplymytmaorg), and from this Google account until then. |

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

## 5. Push notifications (Cloudflare, free)

Push notifications are sent by a small program that TMA runs on **Cloudflare's free Workers plan**.
These docs call it the **push Worker**. It **is already running** at
`https://tma-push.coleciprari.workers.dev`, so there is nothing to sign up for or buy.

The push Worker holds **no family information**. The phones' notification addresses stay in TMA's
spreadsheet (the hidden **Devices** tab). For each notification, the script hands the Worker the
message and the phone's address. The Worker locks the message so only that phone can read it and
passes it to Apple, Google, Mozilla or Microsoft, who deliver it.

**A. What setup already did.** The Settings key `PUSH_RELAY_URL` already holds the Worker's address.
When you ran **setupTma** in step 1, the script:

1. made a long random password and saved it as the Script Property `PUSH_RELAY_SECRET`,
2. introduced itself to the Worker with that password. The **first** spreadsheet to do this is the
   only one the Worker takes orders from afterwards,
3. saved the Worker's public key as the Script Property `PUSH_PUBLIC_KEY`. The app gives this key to
   phones when parents turn on notifications.

If the Worker couldn't be reached at that moment, nothing is broken: run **TMA App → Set up / repair
tabs** again later. It's always safe.

**B. Check it.** **TMA App → Status** should include:

```
Push Worker: https://tma-push.coleciprari.workers.dev
Push Worker health: reachable ✓, linked to a sheet ✓, keys ✓
Push public key (PUSH_PUBLIC_KEY): saved ✓
Push notifications: configured
```

You can also open `https://tma-push.coleciprari.workers.dev/health` in any browser. It should show
`"registered":true` and `"hasKeys":true`.

* A ✗, or *not saved yet*: run **TMA App → Set up / repair tabs**, then check Status again.
* *unreachable*: check that `PUSH_RELAY_URL` in the Settings tab is blank or the address above, and
  try again in a few minutes.
* Set up says **"The push Worker is already linked to a different Apps Script secret"**: another
  spreadsheet (for example the [test spreadsheet](#test-spreadsheet)) linked to the Worker first.
  Follow [E](#e-linking-a-different-spreadsheet-or-rotating-the-keys) below.

Nothing about push goes into GitHub. Phones can turn on notifications as soon as the app is online
(step 7).

**C. iPhone and iPad.** Apple only delivers web notifications to apps **added to the Home Screen**, on
**iOS/iPadOS 16.4 or later**. Parents open the app in **Safari**, tap **Share → Add to Home Screen**,
open TMA from the Home Screen, and then turn on notifications under *More → Notifications*. The app
shows these steps on an iPhone. On Android and computers, notifications work in Chrome, Edge, Firefox
and Safari without installing anything.

**D. How the Worker gets deployed** (for whoever maintains the code). The Worker's code is in
`workers/push` ([its README](../workers/push/README.md)). GitHub deploys it with the workflow
`.github/workflows/deploy-push-worker.yml` whenever that folder changes on `main`, or by hand
(**Actions → Deploy push Worker (Cloudflare) → Run workflow**). The workflow needs two repository
secrets (*Settings → Secrets and variables → Actions → **Secrets***), which are **already set up for
TMA**:

* `CLOUDFLARE_API_TOKEN`: a Cloudflare API token made from the *Edit Cloudflare Workers* template.
* `CLOUDFLARE_ACCOUNT_ID`: the ID of the Cloudflare account the Worker runs in.

The Worker stays well inside Cloudflare's free plan: the script sends it at most 5 notifications per
request, and it stores nothing but its own key pair and a scrambled (hashed) copy of the password.

#### E. Linking a different spreadsheet, or rotating the keys

The Worker trusts the first spreadsheet that links to it. Do this when you want **another
spreadsheet** to send the notifications (for example, moving from the test spreadsheet to the real
one), or when the password may have leaked or the Apps Script project was copied. You need access to
the Cloudflare account the Worker runs in.

1. **In every spreadsheet that is linked now**: *Extensions → Apps Script → Project Settings (⚙) →
   Script Properties*, delete `PUSH_RELAY_SECRET` and `PUSH_PUBLIC_KEY`, and **Save script
   properties**. Do this first. A spreadsheet that still has the old password links itself again
   automatically the next time it sends anything through the Worker: a notification **or any
   email**, including a sign-in code that anyone can request from the app.
2. **In Cloudflare** (dash.cloudflare.com): *Storage & Databases → KV* → the `TMA_PUSH` namespace →
   delete the two keys `relay:secret-sha256` and `vapid:v1`.
3. **Wait about 5 minutes.** The Worker remembers the old values for that long.
4. **In the spreadsheet that should send notifications**: **TMA App → Set up / repair tabs**. It makes
   a new password, links it, and the Worker makes a new key pair. Check with **TMA App → Status**
   (see B).
5. **Email key.** In that spreadsheet's **TMA App → Status**, copy the *Email key for Cloudflare*.
   In Cloudflare, replace the Worker secret `EMAIL_KEY` with it (see
   [Email from noreply@mytma.org](#email-from-noreplymytmaorg), step D). Until you do, email goes
   out with Gmail; the old spreadsheet's key keeps working for email until then, so do this right
   away if the password may have leaked.

Phones that had notifications on were set up with the old key, so the Worker now reports them as
expired and the script removes them from the Devices tab. Each of those phones signs up again with the
new key by itself **the next time the app is opened**. If a phone can't, the app shows *Turn on
notifications* again.

#### F. Moving the Worker to another Cloudflare account

For example, to a Cloudflare account that belongs to TMA. Someone comfortable with GitHub should do
this.

1. Create a free Cloudflare account at **https://dash.cloudflare.com/sign-up**. Open
   **Workers & Pages** once and, if asked, choose a `workers.dev` subdomain (it becomes part of the
   Worker's address).
2. *Storage & Databases → KV → Create* a namespace named `TMA_PUSH`. Copy its **ID**.
3. In the GitHub repository, edit `workers/push/wrangler.toml`: under `[[kv_namespaces]]`, replace the
   `id = "…"` value with the new ID. Commit to `main`.
4. In Cloudflare: *My Profile → API Tokens → Create Token* → **Edit Cloudflare Workers** template →
   choose the new account → *Continue to summary* → **Create Token**. Copy the token. Copy the
   **Account ID** too (*Workers & Pages → Overview*, right-hand column).
5. In GitHub: *Settings → Secrets and variables → Actions → Secrets*: update `CLOUDFLARE_API_TOKEN`
   and `CLOUDFLARE_ACCOUNT_ID` with the new values.
6. *Actions → Deploy push Worker (Cloudflare) → Run workflow* (branch `main`). When it finishes, the
   run's summary shows the new address, `https://tma-push.<subdomain>.workers.dev`, and its health check.
7. In the spreadsheet's **Settings** tab, set `PUSH_RELAY_URL` to the new address.
8. In Apps Script → *Project Settings → Script Properties*, delete `PUSH_RELAY_SECRET` and
   `PUSH_PUBLIC_KEY` (they belong to the old Worker). Then **TMA App → Set up / repair tabs**, and
   check **TMA App → Status** shows the new address with ✓s. For email, the new account also needs
   the Workers Paid plan, `mytma.org` onboarded and the `EMAIL_KEY` secret: follow
   [Email from noreply@mytma.org](#email-from-noreplymytmaorg) A to E there.
9. Phones follow the new key by themselves the next time the app is opened, as in E.
10. Once everything works, delete the old Worker in the old account (*Workers & Pages → tma-push →
    Settings → Delete*).

## Email from noreply@mytma.org

Every email the app sends (sign-in codes, notifications, announcements and board alerts) comes from
**Timberlane Music Association &lt;noreply@mytma.org&gt;**. The push Worker sends it with Cloudflare's
**Email Sending** service (part of Cloudflare Email Service). When a family **replies**, the reply goes
to the Settings key `SUPPORT_EMAIL` (default `timberlanemusictma@gmail.com`), not to `noreply@`.

The one exception is the **Gmail fallback**: until this section is done, and whenever the Worker
can't send a message for any reason, the script sends **that message with Gmail** instead, from the
Google account that runs the script (with the same Reply-To). That way sign-in codes always arrive,
but those emails show that account's address. So the script should run under **TMA's own Google
account** (the board's shared one), not someone's personal account. **TMA App → Status** and the
board's dashboard show how many emails the Gmail fallback can still send today.

**What it costs.** Email Sending needs Cloudflare's **Workers Paid** plan on the Cloudflare account
the push Worker runs in: **$5 a month**, which includes **3,000 emails a month**, then **$0.35 per
1,000** more. TMA's sign-in codes and notification emails fit in the included 3,000 in a normal
month; a few emailed announcements to every family add cents, not dollars. Push notifications stay
free. (Check current prices on Cloudflare's
[Email Service pricing](https://developers.cloudflare.com/email-service/platform/pricing/) page.)

**A. Upgrade the Cloudflare account** (dash.cloudflare.com, signed in to the account the push Worker
runs in): *Workers & Pages → Plans* → **Workers Paid** → add a payment method.

**B. Onboard the domain.** `mytma.org` is already on that Cloudflare account (it hosts the app).
*Compute → Email Service → Email Sending → **Onboard Domain*** → choose `mytma.org` → follow the
steps. Cloudflare lists the DNS records that prove the emails really come from `mytma.org` (SPF and
DKIM); since it already runs the domain's DNS, accept its offer to add them. Wait until the domain
shows as verified. This can take a few minutes. Until A and B are both done, Cloudflare only sends
to the account's verified Email Routing addresses, not to families.

**C. Deploy the Worker** with its email setup (only needed once, if it hasn't run since this
feature was added): GitHub → *Actions → Deploy push Worker (Cloudflare) → Run workflow*. The Worker's
`wrangler.toml` already has the email binding (`EMAIL`, allowed to send only from
`noreply@mytma.org`) and the sender name. If that run fails with an error about `send_email` or Email
Sending, finish A and B first and run it again. Until it succeeds, the Worker that's running keeps
sending push notifications, and email keeps going out with Gmail.

**D. Give the Worker this spreadsheet's email key.** The Worker sends email only for the spreadsheet
whose key it holds, so that nobody else can link themselves to the Worker and send email as
`noreply@mytma.org`.

1. In the spreadsheet: **TMA App → Status**. Copy the 64 letters and digits after *Email key for
   Cloudflare (Worker secret EMAIL_KEY)*. (It is a scrambled form of the Worker password, not the
   password itself.) If the line is missing, run **TMA App → Set up / repair tabs** first.
2. In Cloudflare: *Workers & Pages → **tma-push** → Settings → Variables and Secrets → **Add***.
   Type: **Secret**. Variable name: `EMAIL_KEY`. Value: the key you copied. **Deploy**.
   (It must be type *Secret*: a plain variable would be removed by the next deploy from GitHub.)

Do this again whenever the spreadsheet gets a new Worker password: after
[5E](#e-linking-a-different-spreadsheet-or-rotating-the-keys) (another spreadsheet, or rotating the
keys) or [5F](#f-moving-the-worker-to-another-cloudflare-account) (another Cloudflare account).

**E. Check it.** In the spreadsheet: **TMA App → Status**. The Email line should read:

```
Email: on; from noreply@mytma.org through the push Worker (Cloudflare Email Sending ✓, email key ✓); Reply-To timberlanemusictma@gmail.com; Gmail fallback: 100 emails left today
```

Then **TMA App → Send me a test notification**. The dialog says which way the test email went:

* *Email: sent from noreply@mytma.org through the push Worker (Cloudflare Email Sending).* Done.
* *Email: sent with Gmail from this Google account instead of noreply@mytma.org, because …*: the
  reason says what's missing. For example *mytma.org isn't verified for Cloudflare Email Sending
  yet* (finish B, then wait 10 minutes: after that answer the script uses Gmail for 10 minutes
  before asking the Worker again), *Cloudflare only sends to verified addresses* (finish A and B),
  *the push Worker doesn't have its EMAIL_KEY secret yet* or *…isn't this sheet's email key* (do D),
  or *the push Worker has no Email Sending binding* (do C).

The test goes to your own Google address. If that address is one of the account's verified Email
Routing destinations, Cloudflare delivers to it even before A and B are finished, so the test can
pass while families still get Gmail. To be sure, also sign in to the app with an address that is
**not** a verified destination (for example a family member's) and check that the sign-in code comes
from `noreply@mytma.org`.

Also check that the email arrived and didn't land in spam, and that **Reply** goes to `SUPPORT_EMAIL`.

**The `EMAIL_VIA` setting** (Settings tab) chooses the way:

| Value | What happens |
| --- | --- |
| `cloudflare` (default) | Send as `noreply@mytma.org` through the push Worker. If the Worker can't send a message, that message goes out with Gmail instead. |
| `gmail` | Always send from the Google account that runs the script (the way the app worked before). The Worker isn't asked. |

The Worker uses the same password (`PUSH_RELAY_SECRET`) for email as for push, plus the email key
from D. Only the spreadsheet whose key is in `EMAIL_KEY` can send email through the Worker, even
while the Worker is unlinked during [5E](#e-linking-a-different-spreadsheet-or-rotating-the-keys).

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
2. **Settings → Secrets and variables → Actions → Variables** tab → **New repository variable**:

   | Name | Value |
   | --- | --- |
   | `VITE_API_URL` | The Web app URL from step 3 (ends in `/exec`) |

   Use **Variables**, not *Secrets*. This value is public (it ends up in the app's code anyway),
   and the workflow reads it as a variable. Push notifications need no variable: the app gets the
   push Worker's key from the script.
3. Open the **Actions** tab → **Deploy to GitHub Pages** → **Run workflow** → branch `main` →
   **Run workflow**. (It also runs by itself whenever something is pushed to `main`.) Wait for the
   green check, about 2–3 minutes.
4. The app is now at **`https://<owner>.github.io/<repo>/`**, for example
   `https://coledtouch.github.io/TMA/`. The address is also shown under *Settings → Pages*.
5. In the spreadsheet's **Settings** tab set `APP_URL` to that address (with the `/` at the end).
6. Open the address on your phone. The sign-in page should **not** show the *Demo* box (only a
   small *See a demo with sample data* link at the bottom). If it shows the Demo box, the variable
   wasn't picked up: check its name and run the workflow again.

**Whenever you change `VITE_API_URL`, run the workflow again.** The value is built into the app.

**Without the variable, the whole site is the demo.** With it, the demo is still one link away:
**`https://<owner>.github.io/<repo>/?demo`** (for example `https://coledtouch.github.io/TMA/?demo`)
opens the demo with made-up families. That browser stays in the demo, with a strip at the top
saying so, until someone taps **Exit demo**. Demo sign-ins and data are kept apart from the real
app's. Share the `?demo` link with the board as the prototype.

*For developers:* any static host works too. Build with `VITE_API_URL` set (`npm run build:web`) and
upload the `dist/` folder.

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
      and `PUSH_RELAY_SECRET` among the secrets set, the push Worker *reachable ✓, linked to a sheet ✓,
      keys ✓*, push *configured*, PayPal as intended, email *on* and *from noreply@mytma.org through
      the push Worker (Cloudflare Email Sending ✓, email key ✓)* (see [Email](#email-from-noreplymytmaorg)).
- [ ] The push Worker is linked to **this** spreadsheet, not the test one (see
      [Test spreadsheet](#test-spreadsheet)): *Send me a test notification* reaches your phone.
- [ ] Settings: `ADMIN_EMAILS`, `SUPPORT_EMAIL`, `OTHER_PAYMENT_INSTRUCTIONS` and `DONATE_URL` are
      right, and `FEE_PERCENT` matches TMA's actual PayPal rate.
- [ ] Data imported, and the first *Run sync now* done (see [SHEET.md](SHEET.md#importing-the-existing-spreadsheet)).
- [ ] The app's address opens **without** the Demo box, and `VITE_API_URL` is this spreadsheet's
      `/exec` URL (not the test spreadsheet's).
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

**The push Worker (Cloudflare)** updates by itself when its code in `workers/push` changes on
`main` ([step 5D](#5-push-notifications-cloudflare-free)). Nothing to do in the spreadsheet.

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
* **"Phone notifications aren't set up for TMA yet."** The spreadsheet isn't linked to the push
  Worker yet, or `PUSH_RELAY_URL` in Settings isn't an `https://` address. Run **TMA App → Set up /
  repair tabs** and check **TMA App → Status** ([step 5B](#5-push-notifications-cloudflare-free)),
  then close and reopen the app.
* **"This browser's push service isn't supported."** The browser uses a notification service the
  push Worker doesn't deliver to (some privacy-focused browsers do). Use Chrome, Safari, Firefox or
  Edge.
* **Set up says "⚠ … already linked to a different Apps Script secret".** Another spreadsheet (often
  the test one) linked to the push Worker first. Follow
  [step 5E](#e-linking-a-different-spreadsheet-or-rotating-the-keys).
* **Status says "Push Worker health: unreachable".** Check `PUSH_RELAY_URL` in Settings (blank means
  the standard address), and open `<that address>/health` in a browser. If Cloudflare is having a
  problem, notifications resume by themselves once it's fixed; email still works meanwhile.
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
* **Emails come from the Google account instead of `noreply@mytma.org`.** Run **TMA App → Send me a
  test notification**: the Email line says why the Worker didn't send it. See
  [Email from noreply@mytma.org](#email-from-noreplymytmaorg), step E. The **Log** and
  **Executions** show *Worker email failed* with a reason code (never an address).
* **Replies to app emails.** They go to `SUPPORT_EMAIL` (Settings). Check that address is one TMA reads.
* **"TMA has reached today's email limit."** The daily Gmail quota is used up (see [Quotas](#quotas)).
  It resets within 24 hours. With email going through the Worker this only happens when the Worker
  couldn't send for a long stretch.
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

## Test spreadsheet

Before real families use the app, TMA can try the **real app** (real sign-in emails, real phone
notifications) on a **test copy** of the spreadsheet. One already exists in the TMA volunteer's
Google Drive. It holds the made-up sample families plus a test administrator household (its email
is in that copy's `ADMIN_EMAILS`, so it can try *Board tools*). No real family's information is in it.

**Connect it** the same way as the real one:

1. Open the test spreadsheet, signed in to the Google account that owns it, and do
   [step 1](#1-create-the-spreadsheet-and-add-the-script), items 2 to 6: *Extensions → Apps Script*,
   paste `Code.js` and `appsscript.json`, and run **setupTma**. (Not *setupTmaWithSampleData*: the
   sample data is already there.) This also links the test copy to the push Worker.
2. Check its **Settings** tab ([step 2](#2-fill-in-the-settings-tab)): `ADMIN_EMAILS` lists the test
   administrator's email.
3. Deploy it as a web app ([step 3](#3-deploy-the-web-app-the-apps-server)) and copy its `/exec` URL.
4. Optional: **TMA App → Install schedules** ([step 4](#4-turn-on-the-schedules)), so balance
   changes and reminders go out by themselves.
5. In the GitHub repository: *Settings → Secrets and variables → Actions → Variables* → set
   `VITE_API_URL` to that `/exec` URL (create it, or edit it with the pencil icon). Then *Actions →
   Deploy to GitHub Pages → Run workflow* ([step 7](#7-host-the-app-on-github-pages)). Pick the
   branch that holds the app's current code: `main`, or the work-in-progress branch the site is
   published from while that work isn't merged into `main` yet. Changing the variable alone doesn't
   rebuild the site.
6. In the test spreadsheet's Settings, set `APP_URL` to `https://coledtouch.github.io/TMA/`.

Now **`https://coledtouch.github.io/TMA/`** is the real app working on the test spreadsheet, and
**`https://coledtouch.github.io/TMA/?demo`** still opens the demo with made-up families, for anyone
who just wants to look around. While the test copy is linked to the push Worker, sign-in codes and
notification emails come from `noreply@mytma.org` through the Worker, with Reply-To set to the test
copy's `SUPPORT_EMAIL` (see [Email from noreply@mytma.org](#email-from-noreplymytmaorg)). Only when the
Worker can't send one does it come from the Google account that owns the test copy.

**Moving to the real spreadsheet later.** Set up the real spreadsheet (steps 1 to 4), change
`VITE_API_URL` to **its** `/exec` URL and run the Pages workflow again. Testers then have to sign in
again, because their sign-ins belonged to the test copy. The push Worker is still linked to the test
copy, so the real spreadsheet's setup shows *⚠ … already linked to a different Apps Script secret*.
Follow [step 5E](#e-linking-a-different-spreadsheet-or-rotating-the-keys) to link the real
spreadsheet instead. Testers who had notifications on get them again once they have signed in again.

## Script Properties (secrets)

Secrets never go in the spreadsheet. They live in **Apps Script → Project Settings (⚙) → Script
Properties** (*Edit script properties* → *Add script property* → **Save script properties**).
Anyone who can edit the spreadsheet can open its script and read these. That's another reason to
keep spreadsheet editors to a minimum.

| Property | Needed for | What it is |
| --- | --- | --- |
| `TOKEN_SECRET` | Always (**created automatically** by setup) | Signs everyone's sign-in sessions. Don't share it. Changing it signs everyone out. If it's ever deleted, *TMA App → Set up / repair tabs* creates a new one. |
| `PAYPAL_SECRET` | Online payments | The PayPal app's Secret, from the same app (sandbox or live) as `PAYPAL_CLIENT_ID`. |
| `PUSH_RELAY_SECRET` | Push notifications and email from `noreply@mytma.org` (**created automatically** by setup) | The password the script uses with the push Worker (step 5). Don't share it: it also lets the holder send email as `noreply@mytma.org`. To replace it, follow [step 5E](#e-linking-a-different-spreadsheet-or-rotating-the-keys); just deleting it isn't enough. |
| `PUSH_PUBLIC_KEY` | Push notifications (**saved automatically** by setup) | The push Worker's public key, which phones subscribe with. Not secret. If `PUSH_RELAY_URL` changes, delete it and run *Set up / repair tabs*. |
| `TWILIO_ACCOUNT_SID` | Text messages | From the Twilio console. |
| `TWILIO_AUTH_TOKEN` | Text messages | From the Twilio console. |
| `TWILIO_FROM` | Text messages | The Twilio number (`+16035550123`) or a Messaging Service SID (`MG…`). |

**TMA App → Status** lists which of these are set (names only, never the values).

## Quotas

Google limits how much a free script can do each day. For TMA's size, only **email** matters, and
only for emails that go out **with Gmail**: when email goes through the push Worker as
`noreply@mytma.org` ([Email](#email-from-noreplymytmaorg)), Google's email quota is just the fallback.
Cloudflare's own limits apply instead (3,000 emails a month included, then $0.35 per 1,000; the
sending rate grows with the account's history). If Cloudflare says *rate limited*, the script switches
to Gmail for the rest of that run. Notification emails that fall back to Gmail still leave the day's
last 20 Gmail emails for sign-in codes. The board's dashboard shows *Gmail backup emails left today*
while the Worker sends. Everything below about the Gmail quota applies when `EMAIL_VIA` is
`gmail`, before email from `noreply@mytma.org` is set up, or while the Worker can't send.

| Limit (per day) | Free Gmail account | Google Workspace (e.g. for Nonprofits) |
| --- | --- | --- |
| Email recipients (sign-in codes **and** notification emails) | about 100 | about 1,500 |
| Total time for scheduled runs | 90 minutes | 6 hours |
| Calls to outside services (push, PayPal) | 20,000 | 100,000 |

The current figures are on Google's [Apps Script quotas](https://developers.google.com/apps-script/guides/services/quotas)
page, and Google changes them from time to time.

**What this means for ~300 families on a free Gmail account.** Push notifications don't count
toward the email limit, so the more families turn on push, the better. The script hands them to the
push Worker 5 at a time, so even a notification to every family's phones uses only a few hundred of
the daily calls to outside services. (The Worker's own free plan allows 100,000 requests a day.) The app always keeps the
last **20** emails of each day for sign-in codes: once fewer than 20 remain, notification emails
are skipped (the Log tab says how many), and only sign-in codes are sent. Even so, one announcement
sent **by email** to everyone uses most of the day's quota, leaving room for only about 20
sign-ins. So, until TMA has Google Workspace:

* when sending an announcement to everyone from the app, tick only **Phone notification** (untick
  **Email**), or set `EMAIL_ENABLED` to `FALSE` (sign-in codes are still emailed);
* launch to families in waves of fewer than 100 a day.

The 15-minute sync takes a few seconds per run, far below the scheduled-time limit.
