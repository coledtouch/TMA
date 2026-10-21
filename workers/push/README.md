# tma-push: the push notification Worker

A small [Cloudflare Worker](https://developers.cloudflare.com/workers/) that
sends the TMA Family App's push notifications. It is live at
**https://tma-push.coleciprari.workers.dev** (the default of the TMA
spreadsheet's Settings key `PUSH_RELAY_URL`). It speaks standard Web Push
directly to the browsers' push services (Google for Chrome, Edge and Android,
Mozilla for Firefox, Apple for Safari and iPhone home-screen apps, Microsoft
for old Edge):

* [RFC 8030](https://www.rfc-editor.org/rfc/rfc8030) Web Push delivery,
* [RFC 8292](https://www.rfc-editor.org/rfc/rfc8292) VAPID (the Worker signs
  each request with its own P-256 key),
* [RFC 8291](https://www.rfc-editor.org/rfc/rfc8291) `aes128gcm` payload
  encryption (only the subscribed browser can read a notification).

It uses only WebCrypto: no libraries, no Google Cloud project and no
service-account key.

It also sends **the app's email** (sign-in codes, notifications,
announcements, board alerts) as **Timberlane Music Association
&lt;noreply@mytma.org&gt;**, through Cloudflare Email Service's
[Email Sending](https://developers.cloudflare.com/email-service/api/send-emails/workers-api/)
binding: `POST /email` below. Email Sending is in public beta and needs the
**Workers Paid** plan and `mytma.org` onboarded (see
[docs/SETUP.md, Email from noreply@mytma.org](../../docs/SETUP.md#email-from-noreplymytmaorg)).
Only the spreadsheet whose key is in the Worker secret **`EMAIL_KEY`** can
send email (see `POST /email`). Apps Script falls back to Gmail for any email
the Worker can't send.

The Worker is **stateless** as far as families are concerned: it does not
know who is subscribed. Apps Script keeps the push subscriptions in the Google
Sheet (the hidden Devices tab) and hands the Worker 5 messages per request
(it accepts up to 10). The only things the Worker stores (in the `TMA_PUSH`
KV namespace) are:

| KV key                | Value                                                                 |
| --------------------- | --------------------------------------------------------------------- |
| `vapid:v1`            | JSON `{"publicKey", "privateJwk", "createdAt"}`: the VAPID key pair, made on first use |
| `relay:secret-sha256` | lowercase hex SHA-256 of the shared secret Apps Script registered     |

## Endpoints

All responses are JSON (`Content-Type: application/json`, `Cache-Control:
no-store`). There are no CORS headers: only Apps Script (server to server)
calls this. Unknown paths give `404 {"error":"not_found"}`, a wrong method on
a known path gives `405 {"error":"method_not_allowed"}`.

### `GET /health`

```json
{"ok": true, "name": "tma-push", "registered": true, "hasKeys": true, "email": true, "emailKey": true}
```

`registered`: a secret has been registered. `hasKeys`: the VAPID key pair exists.
`email`: the Email Sending binding `EMAIL` is configured (it says nothing about
whether `mytma.org` is verified yet; a send answers `sender_not_verified` then).
`emailKey`: the Worker secret `EMAIL_KEY` is set (not whose key it is, and
never the key itself).

### `GET /vapid-public-key`

```json
{"publicKey": "BNc…"}
```

The VAPID public key: base64url without padding of the 65-byte uncompressed
P-256 point. This is the `applicationServerKey` the web app passes to
`PushManager.subscribe()`. The first call creates the key pair and stores it.
This is the only endpoint that creates keys: `/send` never does (see
`no_keys` below).

### `POST /register`

Body `{"secret": "<32 to 256 characters>"}`. Trust on first use:

| Situation                                   | Response                                   |
| ------------------------------------------- | ------------------------------------------ |
| No secret registered yet                    | `200 {"registered": true, "first": true}`  |
| Same secret as the one registered           | `200 {"registered": true, "first": false}` |
| A different secret is already registered    | `409 {"error": "already_registered"}`      |
| Not JSON, no `secret`, or wrong length      | `400 {"error": "bad_request"}`             |
| Body over 4 KB                              | `413 {"error": "too_large"}`               |

Only the SHA-256 of the secret is stored; comparisons are constant-time.

Trust on first use means that whenever no secret is registered (before the
first Set up, during a key rotation, or if the KV namespace is emptied),
whoever calls `/register` first gets `/send`. That can only reach push
subscriptions the caller already has, and the real spreadsheet notices
(Set up answers `409`). It does **not** give email: `/email` also needs the
`EMAIL_KEY` secret, which only someone with access to the Cloudflare account
can set.

### `POST /send`

Header `Authorization: Bearer <secret>`, body:

```json
{
  "messages": [
    {
      "subscription": {"endpoint": "https://fcm.googleapis.com/fcm/send/…", "keys": {"p256dh": "…", "auth": "…"}},
      "payload": "{\"title\":\"Trip deposit due\",\"body\":\"…\",\"url\":\"#/trips\"}",
      "ttl": 86400,
      "urgency": "high",
      "topic": "trip-42"
    }
  ]
}
```

| Situation                                     | Response                         |
| --------------------------------------------- | -------------------------------- |
| No secret registered, missing or wrong secret | `401 {"error": "unauthorized"}`  |
| Not JSON, or `messages` is not an array       | `400 {"error": "bad_request"}`   |
| More than 10 messages (or body over 256 KB of UTF-8) | `413 {"error": "too_many_messages", "max": 10}` (or `"too_large"`) |
| Otherwise                                     | `200 {"results": [...]}`         |

`results` has exactly one entry per message, in the same order:
`{"status": "ok" | "invalid" | "error", "code"?: <push service HTTP status>, "reason"?: string}`.

* **`ok`**: the push service accepted it (HTTP 200, 201 or 202).
* **`invalid`**: this subscription will never work again. **Apps Script
  should delete it.** Reasons: `gone` (404/410: the browser unsubscribed),
  `vapid_rejected` (403: subscribed with a different VAPID key, e.g. after a
  key rotation), `endpoint_not_allowed` (not an https URL on a known push
  service), `bad_keys` (`p256dh` is not a 65-byte P-256 point or `auth` is
  not 16 bytes).
* **`error`**: this attempt failed; the subscription may be fine. Reasons:
  `payload_too_large` (over 3000 bytes of UTF-8, or the push service said
  413), `rate_limited` (429), `push_service_error` (5xx), `unexpected_status`
  (any other status), `network` (no answer within 15 s), `bad_payload`
  (`payload` is not a string), `bad_message` (not an object), `internal`
  (an unexpected failure in the Worker), `no_keys` (no VAPID key pair is
  stored yet, or KV briefly reads it as missing: every message in the batch
  gets this and nothing is sent. Apps Script then calls `GET
  /vapid-public-key`, which creates the pair, and retries once. Never delete
  subscriptions for it).

Request bodies are read as a stream and abandoned as soon as they pass the
cap (4 KB for `/register`, 256 KB for `/send`), with or without a
`Content-Length` header.

Per message:

* `payload`: a string, at most **3000 bytes** of UTF-8. The service worker in
  the app receives it as `event.data.text()`.
* `ttl`: seconds the push service keeps the message for an offline device.
  Default 86400 (1 day), clamped to 0 – 2419200 (28 days).
* `urgency`: `very-low`, `low`, `normal` or `high` (default `high`).
* `topic`: optional; `[A-Za-z0-9_-]{1,32}`. A newer message with the same
  topic replaces an undelivered older one. Anything else is ignored.
* Endpoint allowlist (SSRF guard): `https://` on the default port, host
  `fcm.googleapis.com`, `updates.push.services.mozilla.com`,
  `web.push.apple.com`, or ending in `.push.apple.com` or
  `.notify.windows.com`. Anything else is answered `invalid` without any
  request being made.

Each message is encrypted with a fresh ephemeral ECDH key and random salt,
and all the messages of one request are sent concurrently.

### `POST /email`

`Authorization: Bearer <secret>`, where the secret's SHA-256 (lowercase hex)
must equal the Worker secret **`EMAIL_KEY`**. That pin is what keeps a
claimed Worker (see `/register`) from sending email as `noreply@mytma.org`.
`EMAIL_KEY` is set by hand in Cloudflare (*Workers & Pages → tma-push →
Settings → Variables and Secrets*, type **Secret**) or with `npx wrangler
secret put EMAIL_KEY`; the spreadsheet's **TMA App → Status** shows the value
as *Email key for Cloudflare*. It is never in `wrangler.toml`, and deploys
keep it. Body:

```json
{
  "messages": [
    {
      "to": "parent@example.com",
      "subject": "Your TMA sign-in code: 123456",
      "html": "<!doctype html>…",
      "text": "Your sign-in code…",
      "replyTo": "timberlanemusictma@gmail.com"
    }
  ]
}
```

| Situation                                        | Response                                   |
| ------------------------------------------------ | ------------------------------------------ |
| Missing secret, or neither the `EMAIL_KEY` one nor the registered one | `401 {"error": "unauthorized"}` |
| The `EMAIL` binding isn't configured             | `503 {"error": "email_not_configured"}`    |
| `EMAIL_KEY` isn't set (or isn't 64 hex characters) | `503 {"error": "email_key_missing"}`     |
| The registered secret, but `EMAIL_KEY` is another one (e.g. after rotating the keys) | `403 {"error": "email_key_mismatch"}` |
| Not JSON, `messages` not an array, or empty      | `400 {"error": "bad_request"}`             |
| More than 10 messages (or body over 256 KB)      | `413 {"error": "too_many_messages", "max": 10}` (or `"too_large"`) |
| Otherwise                                        | `200 {"results": [...]}`                   |

Nothing is sent in any of the error cases. The secret pinned by `EMAIL_KEY`
works even while the KV namespace has no registration (or another one), so
email keeps working through a key rotation until `EMAIL_KEY` is changed.

`results` has one entry per message, in the same order:
`{"status": "ok", "messageId": "…"}` or `{"status": "error", "reason": "…", "code"?: "E_…"}`.
Messages are sent one after the other; one failure doesn't stop the rest.

* **The sender is never taken from the request.** Every email is from
  `EMAIL_FROM` / `EMAIL_FROM_NAME` (`[vars]` in [wrangler.toml](wrangler.toml):
  `noreply@mytma.org`, `Timberlane Music Association`), and the binding itself
  may only send from `noreply@mytma.org` (`allowed_sender_addresses`). Fields
  like `from`, `cc`, `bcc`, `headers` or `attachments` in a message are
  ignored.
* **Exactly one recipient per message**, so families never see each other's
  addresses.
* Checked before anything is sent (answered `error` with this `reason`, and
  nothing is sent for that message):
  * `bad_to` / `bad_reply_to`: not one plain address (`name@domain.tld`, at
    most 254 characters): no display names, angle brackets, lists, spaces or
    line breaks. `replyTo` is optional.
  * `bad_subject`: not 1 to 300 characters, blank, or contains a line break
    or other control character (so a value can't add headers).
  * `no_content` (neither `html` nor `text`), `bad_content` (not a string),
    `content_too_large` (`html` over 200 KB or `text` over 100 KB of UTF-8),
    `bad_message` (not an object).
* What Cloudflare answered (its error code is passed on as `code`; the error
  message, which can quote the email, never is). About the domain or the
  account, so every email will fail the same way:
  * `sender_not_verified`: `E_SENDER_NOT_VERIFIED` or
    `E_SENDER_DOMAIN_NOT_AVAILABLE`, `mytma.org` isn't onboarded/verified for
    Email Sending yet.
  * `account_suspended`: `E_ACCOUNT_SUSPENDED`, Cloudflare paused Email
    Sending for the account.
  * `rate_limited`: `E_RATE_LIMIT_EXCEEDED` or `E_DAILY_LIMIT_EXCEEDED`.

  About this one message or recipient, so the next one may well go out:
  * `recipient_not_allowed`: a recipient/destination "not allowed" or "not
    verified" code such as `E_RECIPIENT_NOT_ALLOWED` (before the domain is
    onboarded, Cloudflare only sends to verified addresses).
  * `recipient_suppressed`: `E_RECIPIENT_SUPPRESSED`, the address is on the
    suppression list (an earlier hard bounce or complaint).
  * `delivery_failed`: `E_DELIVERY_FAILED`, the recipient's server refused it.
  * `invalid_message`: `E_VALIDATION_ERROR`, `E_FIELD_MISSING`,
    `E_TOO_MANY_RECIPIENTS`, `E_TOO_MANY_ATTACHMENTS` or an `E_HEADER…` code;
    `content_too_large` also covers `E_CONTENT_TOO_LARGE`.

  And `send_failed`: anything else (for example `E_INTERNAL_SERVER_ERROR`, or
  a code this Worker doesn't know).

The log line for a request is counts and codes only, e.g.
`email ok 1 error 1 rate_limited:E_RATE_LIMIT_EXCEEDED`: never addresses,
subjects or bodies.

## How Apps Script uses it

The Apps Script side is `src/gas/push-relay.ts` (the sender) and
`linkPushWorker` in `src/gas/entry.ts` (setup). It finds the Worker at the
spreadsheet's Settings key `PUSH_RELAY_URL` (blank means the default above;
anything that isn't an `https://` address turns push off) and keeps two
Script Properties:

| Script Property     | What it is                                                              |
| ------------------- | ----------------------------------------------------------------------- |
| `PUSH_RELAY_SECRET` | The shared secret: 64 random hex characters, created by Set up          |
| `PUSH_PUBLIC_KEY`   | The Worker's VAPID public key, saved by Set up (not secret)             |

1. **Set up** (`setupTma`, or **TMA App → Set up / repair tabs**) creates
   `PUSH_RELAY_SECRET` if it is missing, then calls `POST /register` with it
   (the first caller wins: acceptable for push, see `/register`; email also
   needs `EMAIL_KEY`) and `GET /vapid-public-key`, and saves the key as
   `PUSH_PUBLIC_KEY`. A
   `409`, an unreachable Worker or a bad `PUSH_RELAY_URL` only adds a ⚠ line
   to the setup message; setup itself never fails because of the Worker.
2. `me.bootstrap` gives the saved key to the web app as
   `settings.pushPublicKey`. The browser subscribes with it and sends the
   subscription to Apps Script (`push.register`), which checks it the same
   way the Worker does (same endpoint allowlist and key sizes) and stores
   `{"endpoint", "keys": {"p256dh", "auth"}}` in the Devices tab.
3. To notify families, Apps Script reads the subscriptions and calls
   `POST /send` with **5 messages per request** and up to 20 requests in
   parallel (`UrlFetchApp.fetchAll`), with the secret as a bearer token. The
   payload is the JSON `{title, body, url, tag, topic}`, kept under 3000
   bytes; `ttl` is 86400; `urgency` is `normal` for reminders and
   announcements and `high` otherwise; `topic` is the notification's tag
   reduced to `[A-Za-z0-9_-]{1,32}`. It
   deletes the Devices rows whose result is `invalid` and keeps `error` ones
   (the next notification tries them again).
4. Self-repair, at most once per Apps Script execution: a `401` makes it
   `POST /register` again and retry (the Worker forgot the secret, e.g. its
   KV was cleared); `no_keys` makes it `GET /vapid-public-key`, save the key
   and retry.
5. **TMA App → Status** shows `GET /health` (reachable, `registered`,
   `hasKeys`, `email`, `emailKey`), whether `PUSH_PUBLIC_KEY` is saved,
   whether push is configured, and *Email key for Cloudflare*: the SHA-256 of
   `PUSH_RELAY_SECRET`, the value for `EMAIL_KEY` (it can't be turned back
   into the secret). `registered` only means *some* secret is registered, not
   necessarily this sheet's.

Apps Script logs carry counts, HTTP codes and these reason codes only, never
the secret, payloads or endpoints.

**Email** (`src/gas/mail.ts`, the app's `Mailer`): with the spreadsheet's
Settings key `EMAIL_VIA` = `cloudflare` (the default) and the sheet linked,
a sign-in code (or the test email) is one `POST /email` with one message, and
notifications and announcements go out in batches: **10 messages per request,
5 requests in parallel** (`UrlFetchApp.fetchAll`), each request under 200 KB.
Every message has one recipient and `replyTo` = Settings `SUPPORT_EMAIL`. A
`401` links the sheet again once per execution (shared with push) and
retries. Any other failure sends **that** email with Gmail (`MailApp`, same
Reply-To, sender name `ORG_NAME`) instead, and then:

* a reason about one message or recipient (the list above, or a `400`/`413`):
  nothing more; the next email still tries the Worker;
* `sender_not_verified`, `account_suspended`, `email_not_configured`,
  `email_key_missing`, `email_key_mismatch`, a `404` (a Worker older than
  `/email`) or an unfixable `401`: Gmail for the next **10 minutes** without
  asking the Worker (CacheService);
* `rate_limited`: Gmail for the rest of that execution;
* the Worker or Cloudflare failing (no answer, HTTP 5xx, an unreadable answer,
  `send_failed`) **3 times in a row**: Gmail for the rest of that execution
  and the next **2 minutes**.

For notifications the Gmail fallback keeps the day's last 20 Gmail emails for
sign-in codes, and a batch stops starting new requests after 4 minutes so it
ends inside Apps Script's 6-minute limit. `EMAIL_VIA` = `gmail` never calls
`/email`. **TMA App → Status** shows the route, `/health`'s `email` and
`emailKey`, and the email key; **Send me a test notification** says which way
its test email went.

## Deployment

[.github/workflows/deploy-push-worker.yml](../../.github/workflows/deploy-push-worker.yml)
runs on every push to `main` (and the PR branch) that touches `workers/push/`,
or by hand from the Actions tab. It runs the tests and typecheck, then
`wrangler deploy` with the Wrangler version pinned in `package-lock.json`, and
prints the Worker URL (`https://tma-push.<subdomain>.workers.dev`) in the run
summary.

One-time setup (**already done for TMA**), in the GitHub repo under
*Settings → Secrets and variables → Actions → Secrets*:

* `CLOUDFLARE_API_TOKEN`: a token made from Cloudflare's *Edit Cloudflare
  Workers* template (*My Profile → API Tokens → Create Token*).
* `CLOUDFLARE_ACCOUNT_ID`: shown on the Cloudflare dashboard under *Workers &
  Pages → Overview*.

Without them the workflow still tests and skips the deploy with a notice. The
KV namespace already exists; its id is in [wrangler.toml](wrangler.toml).

To deploy from a computer instead: `cd workers/push && npm ci && npx wrangler
login && npx wrangler deploy`.

Deploying new code keeps the KV contents and the `EMAIL_KEY` secret, so the
link with Apps Script, the key pair and email survive every deploy. To move the Worker to another Cloudflare
account (together with the app's Worker `tma-app` and the `mytma.org` domain:
new repository secrets first, then the new KV namespace id in `wrangler.toml`,
`PUSH_RELAY_URL`, then Set up), follow
[docs/SETUP.md, step 5F](../../docs/SETUP.md#f-moving-to-another-cloudflare-account).

## Plan and limits

**Email** needs the **Workers Paid** plan ($5 a month: 3,000 emails a month
included, then $0.35 per 1,000), `mytma.org` onboarded under *Compute →
Email Service → Email Sending*, and the `EMAIL_KEY` secret. Limits per email: 50 recipients (the Worker
uses 1), subject 998 characters (the Worker allows 300), 5 MiB in all. The
`[[send_email]]` binding is in [wrangler.toml](wrangler.toml); if a deploy
fails because the account can't use Email Sending yet, finish the onboarding
and deploy again. The Worker that's running keeps working meanwhile.

**Push** fits Cloudflare's free Workers plan (and costs nothing extra on Workers Paid):

* **10 ms CPU per request**: at most 10 messages per `/send`, and Apps Script
  sends 5, to stay well inside the budget. Encrypting one message takes a
  fraction of a millisecond of WebCrypto work. The VAPID
  private key is imported once per isolate, and the signed VAPID JWT is cached
  per push service for 12 hours (renewed with under an hour left), so most
  requests sign nothing. A batch that misses the cache signs once per push
  service, not once per message. Subscription keys longer than their padded
  base64 form are rejected before decoding, so one bad row in the sheet cannot
  use up a batch's CPU.
* **50 subrequests per request**: 10 messages are at most 10 fetches.
* **KV: 100,000 reads and 1,000 writes a day**: each isolate caches what it
  read for 5 minutes (a missing key for 10 seconds), so a busy day costs a
  few hundred reads. Writes happen only on first setup.
* **100,000 requests a day**: each `/send` from Apps Script carries up to 5
  notifications. A notification to every device of ~300 families takes a few
  hundred requests at most.

The logs show only the push service host and status (`push
fcm.googleapis.com 201`), never payloads, secrets or full endpoints.

## Rotating the keys

To replace the VAPID key pair and the shared secret (for example if the
Apps Script project was copied, the secret leaked, or another spreadsheet
should send the notifications, such as the real one after the test copy):

1. In **every** Apps Script project that is linked now (*Project Settings →
   Script Properties*), delete `PUSH_RELAY_SECRET` and `PUSH_PUBLIC_KEY`.
   Do this first: Apps Script re-registers its secret by itself when `/send`
   answers `401`, so a project that keeps the old secret would link it again
   with its next notification.
2. In the Cloudflare dashboard, open *Storage & Databases → KV →* the
   `TMA_PUSH` namespace and delete the keys `vapid:v1` and
   `relay:secret-sha256`.
3. Wait about 5 minutes. Running Worker instances cache the old values for
   that long, and KV itself takes up to a minute to forget a deleted key
   everywhere.
4. In the spreadsheet that should send notifications run **TMA App → Set up
   / repair tabs**. It creates a new secret, registers it, and reads the new
   public key, which creates the new pair. Until then, `/send` answers `401`
   (no secret) or `error` / `no_keys` per message (no key pair). It never
   creates a key pair itself. Check with **TMA App → Status**, or
   `GET /health` (`"registered": true, "hasKeys": true`).

Every existing subscription was made with the old public key, so push
services now answer `403` for them (`invalid`, `vapid_rejected`) and Apps
Script drops them. Each phone that had notifications on subscribes again with
the new key the next time the app is opened (the app compares its
subscription with `settings.pushPublicKey`); if it can't, the app offers
*Turn on notifications* again.

After changing `PUSH_RELAY_URL` (a different Worker), delete
`PUSH_PUBLIC_KEY` and run Set up again: the saved key is not tied to the URL.

## Development

From the repo root (the tests use the root `vitest` and `typescript`; Node
22's `crypto.subtle` is the same WebCrypto API the Worker runs on):

```sh
npx vitest run --config workers/push/vitest.config.ts
npx tsc -p workers/push/tsconfig.json
```

The tests check the RFC 8291 Appendix A vector byte for byte, decrypt real
output with an independent receiver implementation, verify the VAPID JWT
signature, and drive every endpoint against an in-memory KV with a mocked
`fetch` and a fake `EMAIL` binding (header-injection attempts, the fixed
sender, error-code mapping, logs without addresses).

To run the Worker locally: `cd workers/push && npm ci && npx wrangler dev`
(uses a local, empty KV).

Files:

* `src/index.ts`: routing, `/register`, and the bearer-secret check for `/send` and `/email`.
* `src/email.ts`: `/email` validation, the fixed sender, sending through the
  `EMAIL` binding and error-code mapping.
* `src/webpush.ts`: validation, RFC 8291 encryption, the push request and
  status mapping.
* `src/vapid.ts`: key pair creation and storage, ES256 JWT.
* `src/b64.ts`: base64url, UTF-8, hex, SHA-256 helpers.
* `src/env.ts`: binding types (KV, `EMAIL`) and the per-isolate KV cache.
