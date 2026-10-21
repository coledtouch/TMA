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
on Cloudflare's free plan (the "push Worker", see below) and then through Apple's, Google's,
Mozilla's or Microsoft's notification service to the phone. Card payments happen entirely on PayPal.

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

It runs on **Cloudflare's free Workers plan** (up to 100,000 requests a day). The script sends up to
5 notifications per request, so even a notification to every family uses a tiny fraction of that.

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
  script's private settings.

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

**$0** to run: Google Sheet, Apps Script, Gmail, GitHub Pages and the push Worker (Cloudflare's free
Workers plan) are all free at TMA's size. Online card/PayPal payments have per-payment fees, which families can choose
to cover. Text messages are optional and cost about 1¢ each. Details:
[PAYMENTS.md](PAYMENTS.md) and the [README](../README.md#what-it-costs).

### What if the volunteer developer leaves?

Nothing stops working. There are **no servers to maintain** and **no subscriptions**. It is a
Google Sheet plus a script inside TMA's account, and a website hosted for free. The code and
step-by-step documentation are in the GitHub repository, so another volunteer can take over.
Occasional updates may be needed if Google, PayPal or Apple change something.

One piece lives outside Google: the **push Worker** on Cloudflare. Make sure TMA can sign in to the
Cloudflare account it runs in, or move it to a TMA-owned account
([SETUP.md, step 5F](SETUP.md#f-moving-the-worker-to-another-cloudflare-account)). If it ever stopped,
the app would keep working and emails would still go out; only phone notifications would pause.

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
