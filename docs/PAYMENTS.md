# Payments: can TMA take cards with zero fees?

The board asked: **"TMA is a 501(c)(3). Can we take credit and debit card payments through PayPal
with no merchant or card fees?"** This page answers that honestly and explains how the app can
still bring TMA's net cost to $0.

> **Please note.** This is not legal or tax advice. Talk to TMA's CPA about the tax questions.
> Processor fees change. The PayPal figures below come from PayPal's US
> [merchant fees page](https://www.paypal.com/us/webapps/mpp/merchant-fees) ("Last Updated:
> October 1, 2026") and the other sources [listed at the end](#sources). **Check the current rates
> on paypal.com before deciding.**

## The short answer

**No.** PayPal has no product that processes card, debit or PayPal payments **for goods or
services** for free, even for a 501(c)(3). A trip payment is a payment for a service. PayPal's
lowest rate is the **Confirmed Charity rate: 1.99% + $0.49** per US transaction. TMA has to apply
for it, and PayPal has to approve it in advance (with the IRS determination letter and EIN). PayPal
describes its charity rates as "subject to eligibility, application, and pre-approval by PayPal".
Ask PayPal's nonprofit team whether **trip payments** (not just donations) qualify for the charity
rate. The number in [PayPal's nonprofit FAQ](https://www.paypalobjects.com/digitalassets/c/website/marketing/na/us/donations/paypal-for-non-profit-faq.pdf)
is **1-866-365-6319**.

**But TMA can still pay $0 in practice:**

1. **Using activity funds for a trip costs nothing.** It is an entry in TMA's own ledger, so no
   payment processor is involved.
2. **Families can choose to cover the processing fee.** At checkout the app offers *"Add $2.54 to
   cover PayPal's processing fee so 100% goes to Avery's trip"*. On a $100 payment the family pays
   $102.54 and TMA keeps the full $100.
3. **Checks and cash stay free** and are explained in the app under "Other ways to pay".
4. **If the board wants card processing with no fees at all**, Zeffy (not PayPal) is free for US
   nonprofits. A link to a Zeffy form could be offered as an extra way to pay.

## The options compared

| Option | Fee TMA pays | Works for trip payments? | Notes |
| --- | --- | --- | --- |
| **Activity funds** (in the app) | **$0** | Yes | Internal ledger entry, approved by the treasurer. |
| **Check or cash** | **$0** | Yes | Checks to TMA, P.O. Box 420, Plaistow, NH 03865. Bank transfer or Zelle also works if TMA's bank offers it free. |
| **PayPal Checkout, Confirmed Charity rate** | **1.99% + $0.49** | Yes, if PayPal agrees it applies | What the app is set up for (PayPal, Venmo and debit/credit card buttons). Needs PayPal's approval first. |
| PayPal Checkout, standard rate | 3.49% + $0.49 | Yes | What TMA pays until the charity rate is approved. |
| PayPal donation button | 2.89% + $0.49 | No (donations only) | |
| PayPal Advanced Credit and Debit Card, charity rate | 2.19% + a fixed fee | Yes | Card fields built into the page. The app doesn't need this: PayPal's standard buttons already take cards. |
| International cards or accounts | add 1.50% | | Rare for TMA. |
| **PayPal Giving Fund** | **$0** (for TMA and the donor) | **No** | Donations only. Paid out as monthly grants, roughly 15–45 days later. Can't be earmarked for a student. The donor can't receive anything in return. [Source](https://www.paypal.com/us/cshelp/article/what-is-paypal-giving-fund-help1078). Good for **general donations**. |
| Venmo charity profile | 1.9% + $0.10 per donation | No (donations only) | Charged to the charity. Needs a verified PayPal Business account. [Source](https://help.venmo.com/cs/articles/charity-profile-donation-fees-vhel159). |
| PayPal "Friends & Family" | | **No, not allowed** | PayPal's rules don't allow it for paying an organization for goods or services, and the payer loses purchase protection. Don't ask families to use it for trips. |
| Cheddar Up (what TMA uses today for donations) | Basic 3.95% + $0.95; Pro 3.59% + $0.59 per card payment | Yes | More expensive than PayPal's charity rate. [Source](https://www.cheddarup.com/blog/cheddar-up-fees/). |
| **Zeffy** | **$0** | Yes | Not PayPal. A free payment platform for US nonprofits (cards, bank/ACH, Apple Pay and Google Pay), paid for by optional tips that payers add to Zeffy. [Source (written by Zeffy)](https://www.zeffy.com/blog/fundraising-platform-with-no-fees). |

Venmo and card payments made through the app's PayPal buttons are PayPal Checkout transactions.
They are charged at TMA's checkout rate, not the Venmo charity-profile rate. Confirm the exact
rate with PayPal.

## What a payment costs TMA

The fee TMA pays when the family does **not** cover it, rounded to the cent. Processors' own
rounding can differ by a cent.

| How the family pays | $100 | $500 | $1,850 (a full Florida trip) |
| --- | --- | --- | --- |
| Activity funds, check or cash | $0 | $0 | $0 |
| PayPal, Confirmed Charity rate (1.99% + $0.49) | $2.48 | $10.44 | $37.31 |
| PayPal, standard rate (3.49% + $0.49) | $3.98 | $17.94 | $65.06 |
| Venmo charity profile (1.9% + $0.10), donations only | $2.00 | $9.60 | $35.25 |
| Cheddar Up Pro (3.59% + $0.59) | $4.18 | $18.54 | $67.01 |
| Cheddar Up Basic (3.95% + $0.95) | $4.90 | $20.70 | $74.03 |
| Zeffy | $0 (the payer may tip Zeffy) | $0 | $0 |

## How "cover the processing fee" works

When a parent pays online, the app shows a checkbox, **on by default**, that adds just enough
to the payment to cover PayPal's fee. The parent sees the trip payment, the fee contribution and the
total before paying. They can uncheck it.

The app works out the smallest total that still leaves TMA the full amount after PayPal's fee:

> total = (amount + $0.49) ÷ (1 − 1.99%), rounded **up** to the next cent

This is computed in `src/shared/money.ts` (`grossUpCents`) and checked by its unit tests.

| Trip payment | Parent pays with the box checked | Fee contribution | TMA receives |
| --- | --- | --- | --- |
| $100.00 | $102.54 | $2.54 | $100.00 |
| $500.00 | $510.66 | $10.66 | $500.00 |
| $1,850.00 | $1,888.07 | $38.07 | $1,850.00 |

Because the app rounds up, TMA occasionally receives one cent more, never less. Until TMA is
approved for the charity rate, set `FEE_PERCENT` to `3.49` in the sheet's Settings tab. The
totals then become $104.13, $518.59 and $1,917.41.

**Why it's optional (and must stay optional).** A *mandatory* extra charge for paying by card is a
**credit-card surcharge**, and surcharges are restricted. New Hampshire has no surcharge law
([Nickel](https://www.nickel.com/surcharge-laws/new-hampshire)), but the card networks' rules cap
credit-card surcharges (around 3%), require disclosures, and don't allow surcharges on debit or
prepaid cards ([state-by-state overview](https://ebizcharge.com/resources/templates/credit-card-surcharge-laws-by-state/)).
The app's fee contribution is **voluntary** and is **the same whichever way the family pays**
(PayPal balance, Venmo, debit or credit). Keep it that way. The board can make the box start
unchecked by setting `FEE_COVER_DEFAULT` to `FALSE`.

## Recommendations

1. **Apply for PayPal's Confirmed Charity rate**, and ask PayPal's nonprofit team (1-866-365-6319)
   to confirm in writing that it covers trip and activity payments.
2. **Keep the "cover the fee" option on.** Most of the fee is then paid by families who choose to.
3. **Keep promoting activity funds, checks and cash.** They're free, and the app shows them.
4. **For general donations**, consider PayPal Giving Fund ($0 fees, slower payout), or keep Cheddar
   Up if its features are worth its higher fees.
5. **If the board wants $0 card processing**, try Zeffy for one fundraiser first. Zeffy payments
   aren't connected to the app, so the treasurer adds them to the Payments tab by hand (Method `Card`).

## IRS caution: individual student accounts

**Please read this, and talk to TMA's CPA.** Crediting fundraising proceeds to **individual
students' accounts** can create IRS **"private benefit" or "inurement"** problems for a 501(c)(3)
booster club. In *Capital Gymnastics Booster Club v. Commissioner*, T.C. Memo 2013-193, the Tax
Court agreed with the IRS about a booster club that credited fundraising proceeds to the
participating families' accounts. Later IRS letters (for example 202149019 and 202334016) reached
similar conclusions for other booster organizations. The
[Nonprofit Law Blog](https://nonprofitlawblog.com/there-is-no-i-in-team-common-private-benefit-problems-for-booster-clubs/)
summarizes the common problems.

Common safeguards (the app is built around the first four):

* Activity funds can be used **only for TMA-approved music activities** (trips, camps, district
  lessons).
* They **can't be withdrawn as cash**.
* Every use **needs the treasurer's approval**.
* **Unused funds stay with TMA.**
* Adopt a **written policy**, for example: unused funds go to TMA's general fund when a student
  graduates or leaves; taking part in fundraisers is voluntary; **no student is left out of a trip
  because they couldn't fundraise**.
* Donations earmarked for one specific student are generally **not tax-deductible** for the donor
  (see IRS [Publication 526](https://www.irs.gov/publications/p526)). Ask the CPA how TMA should
  accept and acknowledge them.

Trip payments are payments for a service, not donations. Don't describe them as tax-deductible.

## How online payments work (technical)

* **PayPal's own buttons** appear in the app: PayPal, Venmo (on eligible phones) and **Debit or
  Credit Card**. *Pay Later* and *PayPal Credit* are switched off.
* **Card numbers never touch TMA's systems.** They are typed only into PayPal's pages, never into
  the app, the Apps Script server or the spreadsheet. That keeps TMA's card-security (PCI DSS)
  responsibilities to a minimum, comparable to the simplest self-assessment (SAQ A) for merchants
  who fully outsource card handling. Protect TMA's PayPal login with 2-step verification.
* **The server sets the price.** When the parent taps a button, TMA's Apps Script server creates the
  PayPal order. First it checks that the student belongs to the parent's household, that the
  activity allows online payment, and that the amount is between `MIN_PAYMENT` and what's left to
  pay. It also computes the fee contribution itself, so the browser can't change the price.
* **Recorded only when it matches.** After the parent approves in PayPal, the server captures the
  payment. It records a row in **Payments** only when PayPal reports it **COMPLETED** and the amount
  matches exactly: Method `PayPal`, Reference = PayPal transaction ID, Amount, Fee Covered, Gross,
  Payer Email, Status `Completed`. Then it notifies the family (*"Payment received – thank you!"*).
  If the amount doesn't match, nothing is recorded and the board gets a *"Payment needs review"*
  alert. If PayPal is still processing (e.g. an eCheck), the row is recorded as `Pending`. If PayPal
  doesn't confirm either way, the parent is never told "not charged", the board gets the same alert,
  and the app asks again; when that records the payment, the board gets *"Payment recorded"*.
* **No double charges or double records.** The capture uses an idempotency key, and the same
  PayPal transaction is never recorded twice, even if the parent's phone retries.
* **Receipts.** PayPal emails the payer a receipt. The family also gets the app notification and
  sees the payment on the trip. Money lands in TMA's PayPal balance, ready to transfer to the bank.

### Refunds

1. Issue the refund in PayPal (*Activity* → the transaction → *Issue a refund*). PayPal may keep
   part of the original fee on a refund. See the fee page.
2. Record it in the **Payments** tab:
   * **Full refund:** change that row's Status to `Refunded`. It then stops counting as paid.
   * **Partial refund:** add a row with a **negative** Amount, Method `PayPal`, Status `Completed`,
     Reference `Refund of <PayPal transaction ID>`.

To turn online payments off at any time, set `ONLINE_PAYMENTS` to `FALSE` in Settings. Setup
steps are in [SETUP.md → Online payments](SETUP.md#6-online-payments-paypal).

## Sources

* PayPal, *Merchant fees* (US), last updated October 1, 2026: <https://www.paypal.com/us/webapps/mpp/merchant-fees>
* PayPal, *PayPal for Nonprofits FAQ* (PDF): <https://www.paypalobjects.com/digitalassets/c/website/marketing/na/us/donations/paypal-for-non-profit-faq.pdf>
* PayPal, *What is PayPal Giving Fund?*: <https://www.paypal.com/us/cshelp/article/what-is-paypal-giving-fund-help1078>
* Venmo, *Charity profile donation fees*: <https://help.venmo.com/cs/articles/charity-profile-donation-fees-vhel159>
* Cheddar Up, *Cheddar Up fees*: <https://www.cheddarup.com/blog/cheddar-up-fees/>
* Zeffy, *Fundraising platform with no fees* (written by the vendor): <https://www.zeffy.com/blog/fundraising-platform-with-no-fees>
* Nickel, *New Hampshire surcharge laws*: <https://www.nickel.com/surcharge-laws/new-hampshire>
* EBizCharge, *Credit card surcharge laws by state*: <https://ebizcharge.com/resources/templates/credit-card-surcharge-laws-by-state/>
* Nonprofit Law Blog, *There Is No "I" in Team: Common Private Benefit Problems for Booster Clubs*: <https://nonprofitlawblog.com/there-is-no-i-in-team-common-private-benefit-problems-for-booster-clubs/>
* *Capital Gymnastics Booster Club, Inc. v. Commissioner*, T.C. Memo 2013-193; IRS written determinations 202149019 and 202334016.
* IRS, *Publication 526, Charitable Contributions*: <https://www.irs.gov/publications/p526>
