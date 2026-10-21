# Board FAQ: privacy, security and liability

Plain answers to the questions raised when the app was presented. This is not legal advice. For
anything that matters legally or financially, check with TMA's attorney or CPA.

### "Are we opening ourselves up? Is this a liability? We don't carry insurance."

The app was designed to **add as little risk as possible** to what TMA already does today. TMA
already keeps family names, emails and balances in a Google Sheet in its Gmail account. The app
uses **that same sheet in that same account**. It adds no new database, no new company holding
the data, and **no card numbers** (PayPal handles those). The main thing to protect is the same
as today: **the TMA Google account and who can open the spreadsheet** (see "What should we do?" below).

No system is risk-free. The risk is low because the data is minimal: there's very little in
it that would be valuable to a criminal.

### What information does the app collect?

* **Parents:** name, email, an optional cell number. A second parent is optional.
* **Students:** first and last name, grade, school level, music groups, and optionally instrument.
* **Money:** activity-fund credits and uses, trip costs and payments (amounts and dates).
* **Settings:** each parent's notification choices, and, for each phone where they turned on
  notifications, the browser's notification address (a web address at Apple, Google, Mozilla or
  Microsoft plus two keys). It is not a phone number.

**Not collected:** home addresses, birthdates, Social Security numbers, card or bank numbers,
student emails or phone numbers, photos, grades or any school records.

### Where does it live?

In **TMA's own Google Sheet, in TMA's Google account**. The app's server is a script attached to
that sheet. It runs inside Google and can open **only that one spreadsheet**, not the rest of TMA's
Google Drive. There is no other database. Push notifications pass through a small program TMA runs
on Cloudflare (the "push Worker", see below) and then through Apple's, Google's, Mozilla's or
Microsoft's notification service to the phone. The app's emails go out through the same Worker (see
"Who sends the app's emails?"). Card payments happen entirely on PayPal.

### What does the Cloudflare push Worker store?

Almost nothing, and **no family information**. It keeps exactly two things:

* its own **key pair**, the digital stamp that tells Apple, Google, Mozilla and Microsoft the
  notifications really come from TMA, and
* a **hash** (a scrambled fingerprint that can't be turned back into the original) of the password
  TMA's script uses with it, so it only takes orders from TMA's spreadsheet.

The phones' notification addresses stay in TMA's spreadsheet (the hidden **Devices** tab). For each
notification, the script hands the Worker the message and that one address. The Worker encrypts the
message so that only the receiving phone can read it (Apple, Google and the others see only
scrambled data), passes it on, and forgets it. It keeps no copies, and its logs show only which
notification service answered, never names, addresses or message text.

The app's emails pass through the Worker the same way: the script hands it a few emails at a time
(each to one family), the Worker passes each to Cloudflare's email service and forgets it. Its logs show only counts and error
codes, never addresses or what an email says.

Push runs fine on **Cloudflare's free Workers plan** (up to 100,000 requests a day). The script sends
up to 5 notifications per request, so even a notification to every family uses a tiny fraction of
that. Sending email from `noreply@mytma.org` needs the Workers Paid plan (see the cost question below).

### Who sends the app's emails, and from where?

Every email the app sends (sign-in codes, notifications, announcements and alerts to board members)
comes from **Timberlane Music Association &lt;noreply@mytma.org&gt;**, TMA's own web address, not
from any volunteer's personal email. The push Worker sends them with **Cloudflare Email Sending**, and
Cloudflare signs them so mail providers can tell they really come from `mytma.org`.

* **Replies** go to TMA's support address (the `SUPPORT_EMAIL` setting, normally
  `timberlanemusictma@gmail.com`), so a parent who answers an email reaches TMA.
* **Backup:** if Cloudflare can't send an email for any reason (not set up yet, an outage, a sending
  limit), the script sends that email from the Google account the script runs under instead, so
  sign-in codes always arrive. Those emails show that account's address, which is why the script
  should run under **TMA's own Google account**, not a volunteer's. A setting (`EMAIL_VIA` = `gmail`)
  switches to Google-only sending at any time.
* Only TMA's spreadsheet can ask the Worker to send email. It needs both the push password (kept in
  the script's private settings) and an **email key** that a board member pastes into Cloudflare
  once (SETUP.md, *Email from noreply@mytma.org*, step D). Without access to TMA's Cloudflare
  account, nobody can make the Worker send email, not even while it is being re-linked to a new
  spreadsheet.
* **Cost:** the first 3,000 emails a month are included in the $5 plan; an emailed announcement to
  every family costs well under a dollar on top (see the cost question below).

### Who can see what?

* **A parent** sees only **their own household**. Balances and trips appear only after the
  treasurer has verified the household. Anyone can sign up, but a new sign-up sees nothing
  financial until it's approved.
* **Board members** listed in the sheet's Settings (`ADMIN_EMAILS`) get *Board tools* in the app:
  fund requests, new sign-ups, announcements and an activity log.
* **People who can open the spreadsheet** see everything, just as today. Keep that list short.

### How is it secured?

* **No passwords to steal.** Parents sign in with a one-time 6-digit code sent to their email. It
  expires after 10 minutes, allows 5 tries, and is limited to 5 codes an hour.
* **Signed sessions** that expire (120 days by default). Changing one setting (`TOKEN_VERSION`)
  signs everyone out.
* **Every request is checked** against the sheet: who the person is, which household they belong
  to, and whether they're a board member. Nothing is taken on trust from the phone.
* **Least privilege:** the script may only open this spreadsheet, send email as TMA, contact
  PayPal, TMA's push Worker and Twilio, and run its own schedule.
* **PayPal handles all card data.** TMA never sees or stores card numbers.
* **Secrets** (the PayPal key and the push Worker password) are kept out of the spreadsheet, in the
  script's private settings. Together with the email key in Cloudflare, the push Worker password
  lets its holder send email as `noreply@mytma.org`, so if it ever leaks, rotate it and update the
  email key right away (SETUP.md, step 5E).

### What about children's privacy (COPPA)?

COPPA is a federal law about websites and online services **directed to children under 13** that
collect personal information **from those children**. This app is for **parents**. Parents type in
their own students' information, and students don't sign in. Keep it that way: promote the app
to parents, not students, and keep the student information minimal, as it is now.

### What about FERPA?

FERPA governs **schools** and the education records they keep. TMA is a separate nonprofit. Families
give their information to TMA themselves, which is why the app has self sign-up. TMA should **not**
ask the school for student records or contact lists. For trip rosters (who is going), share only
what's needed, and follow the music department's and district's guidance.

### What does it cost?

**$0** to run, plus **$5 a month** for email from `noreply@mytma.org`. Google Sheet, Apps Script,
Gmail, GitHub Pages and push notifications are all free at TMA's size. Sending email from TMA's own
address needs Cloudflare's **Workers Paid** plan: $5 a month, which includes 3,000 emails a month
(more than TMA normally sends), then $0.35 per 1,000. Without it the app emails from TMA's Gmail
instead, for free, but with Google's limit of about 100 emails a day on a free account. Online
card/PayPal payments have per-payment fees, which families can choose to cover. Text messages are
optional and cost about 1¢ each. Details: [PAYMENTS.md](PAYMENTS.md) and the
[README](../README.md#what-it-costs).

### What if the volunteer developer leaves?

Nothing stops working. There are **no servers to maintain**, and the only subscription is
Cloudflare's $5-a-month plan for email from `noreply@mytma.org`. It is a Google Sheet plus a script
inside TMA's account, and a website hosted for free. The code and
step-by-step documentation are in the GitHub repository, so another volunteer can take over.
Occasional updates may be needed if Google, PayPal or Apple change something.

One piece lives outside Google: the **push Worker** on Cloudflare. Make sure TMA can sign in to the
Cloudflare account it runs in, or move it to a TMA-owned account
([SETUP.md, step 5F](SETUP.md#f-moving-the-worker-to-another-cloudflare-account)), and that someone
on the board can see its bill. If the $5 plan lapsed, emails would simply come from TMA's Google
account again instead of `noreply@mytma.org`. If the Worker ever stopped altogether, the app would
keep working and emails would still go out (from TMA's Google account); only phone notifications
would pause.

**To switch it off:** in the spreadsheet open *Extensions → Apps Script* → **Triggers** (delete
the two schedules) and **Deploy → Manage deployments → Archive**. All the data stays in the
spreadsheet, exactly as the treasurer has always kept it.

### A family asks us to delete their information. What do we do?

Delete their rows in **Families** and **Students**, and their email's rows in the hidden
**Preferences** and **Devices** tabs (*View → Hidden sheets*). Keep the **Ledger** and **Payments**
rows for TMA's financial records. They contain only a student ID and amounts. Once the household
and student rows are gone, nobody can see that family's information in the app. There is nothing to
delete on Cloudflare: the push Worker keeps no family information.

### Can families stop emails and notifications?

Yes, at any time, under *More → Notifications*: by topic, by school and group, and by channel
(push, email, text). Every email explains this in its footer. Push can also be turned off on the
phone itself.

### Is it OK to keep individual student fund balances?

Be careful. The IRS has challenged booster clubs that credit fundraising proceeds to individual
students. The app includes common safeguards: funds are only for TMA-approved music activities,
can't be taken as cash, need treasurer approval, and stay with TMA if unused. The board should also
adopt a short written policy. See [PAYMENTS.md → IRS caution](PAYMENTS.md#irs-caution-individual-student-accounts)
and talk to TMA's CPA.

### Should TMA get insurance?

That's the board's call, and this isn't advice. Many small nonprofits buy a **directors & officers
(D&O)** and/or **general liability** policy, often for a few hundred dollars a year. It protects
volunteers whether or not TMA uses this app.

### What should we do to stay safe?

1. Turn on **2-Step Verification** for `timberlanemusictma@gmail.com`, and make sure two board
   members can recover it.
2. **Share the spreadsheet** only with the treasurer and one or two board members, each with their
   own Google account, rather than sharing the password.
3. Keep `ADMIN_EMAILS` current. Remove people when they leave the board.
4. Know who can sign in to the Cloudflare account that runs the push Worker, and keep that list
   short too.
5. Once a year, mark graduated students and departed families `Inactive`, and delete data you no
   longer need.
6. Adopt the written activity-fund policy above.
