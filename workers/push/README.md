# tma-push: the push notification Worker

A small [Cloudflare Worker](https://developers.cloudflare.com/workers/) that
sends the TMA Family App's push notifications. It speaks standard Web Push
directly to the browsers' push services (Google FCM for Chrome and Android,
Mozilla for Firefox, Apple for Safari and iPhone home-screen apps, Microsoft
for old Edge):

* [RFC 8030](https://www.rfc-editor.org/rfc/rfc8030) Web Push delivery,
* [RFC 8292](https://www.rfc-editor.org/rfc/rfc8292) VAPID (the Worker signs
  each request with its own P-256 key),
* [RFC 8291](https://www.rfc-editor.org/rfc/rfc8291) `aes128gcm` payload
  encryption (only the subscribed browser can read a notification).

It uses only WebCrypto, no libraries and no Firebase project.

The Worker is **stateless** as far as families are concerned: it does not
know who is subscribed. Apps Script keeps the push subscriptions in the Google
Sheet and hands the Worker up to 10 messages at a time. The only things the
Worker stores (in the `TMA_PUSH` KV namespace) are:

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
{"ok": true, "name": "tma-push", "registered": true, "hasKeys": true}
```

`registered`: a secret has been registered. `hasKeys`: the VAPID key pair exists.

### `GET /vapid-public-key`

```json
{"publicKey": "BNc…"}
```

The VAPID public key: base64url without padding of the 65-byte uncompressed
P-256 point. This is the `applicationServerKey` the web app passes to
`PushManager.subscribe()`. The first call creates the key pair and stores it.

### `POST /register`

Body `{"secret": "<32 to 256 characters>"}`. Trust on first use:

| Situation                                   | Response                                   |
| ------------------------------------------- | ------------------------------------------ |
| No secret registered yet                    | `200 {"registered": true, "first": true}`  |
| Same secret as the one registered           | `200 {"registered": true, "first": false}` |
| A different secret is already registered    | `409 {"error": "already_registered"}`      |
| Not JSON, no `secret`, or wrong length      | `400 {"error": "bad_request"}`             |

Only the SHA-256 of the secret is stored; comparisons are constant-time.

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
| More than 10 messages (or body over 256 KB)   | `413 {"error": "too_many_messages", "max": 10}` (or `"too_large"`) |
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
  (`payload` is not a string), `bad_message` (not an object).

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
and the 10 are sent concurrently.

## How Apps Script uses it

1. **TMA App → Set up** calls `GET /health`, then `POST /register` with a
   long random secret that Apps Script keeps in its Script Properties (see
   [docs/SETUP.md](../../docs/SETUP.md)). The first caller wins; that is why
   the endpoint is safe to leave open.
2. It reads `GET /vapid-public-key` and gives the key to the web app, which
   subscribes with it and saves the subscription (endpoint and keys) to the
   sheet through Apps Script.
3. To notify families, Apps Script reads the subscriptions from the sheet and
   calls `POST /send` in batches of up to 10, with the secret as a bearer
   token. It deletes subscriptions whose result is `invalid` and may retry
   `error` ones later.

## Deployment

[.github/workflows/deploy-push-worker.yml](../../.github/workflows/deploy-push-worker.yml)
runs on every push to `main` (and the PR branch) that touches `workers/push/`,
or by hand from the Actions tab. It runs the tests and typecheck, then
`wrangler deploy` with the Wrangler version pinned in `package-lock.json`, and
prints the Worker URL (`https://tma-push.<subdomain>.workers.dev`) in the run
summary.

One-time setup, in the GitHub repo under *Settings → Secrets and variables →
Actions → Secrets*:

* `CLOUDFLARE_API_TOKEN`: a token made from Cloudflare's *Edit Cloudflare
  Workers* template (*My Profile → API Tokens → Create Token*).
* `CLOUDFLARE_ACCOUNT_ID`: shown on the Cloudflare dashboard under *Workers &
  Pages → Overview*.

Without them the workflow still tests and skips the deploy with a notice. The
KV namespace already exists; its id is in [wrangler.toml](wrangler.toml).

To deploy from a computer instead: `cd workers/push && npm ci && npx wrangler
login && npx wrangler deploy`.

## Free plan

Everything fits Cloudflare's free Workers plan:

* **10 ms CPU per request**: at most 10 messages per `/send`. Encrypting one
  message takes a fraction of a millisecond of WebCrypto work. The VAPID
  private key is imported once per isolate, and the signed VAPID JWT is cached
  per push service for 12 hours (renewed with under an hour left), so most
  requests sign nothing.
* **50 subrequests per request**: 10 messages are 10 fetches.
* **KV: 100,000 reads and 1,000 writes a day**: each isolate caches what it
  read for 5 minutes (a missing key for 10 seconds), so a busy day costs a
  few hundred reads. Writes happen only on first setup.
* **100,000 requests a day**: one `/send` carries 10 notifications.

The logs show only the push service host and status (`push
fcm.googleapis.com 201`), never payloads, secrets or full endpoints.

## Rotating the keys

To replace the VAPID key pair and the shared secret (for example if the
Apps Script project was copied or the secret leaked):

1. In the Cloudflare dashboard, open *Storage & Databases → KV →* the
   `TMA_PUSH` namespace and delete the keys `vapid:v1` and
   `relay:secret-sha256`.
2. Wait about 5 minutes. Running Worker instances cache the old values for
   that long, and KV itself takes up to a minute to forget a deleted key
   everywhere.
3. In the spreadsheet run **TMA App → Set up** again. It registers a secret
   and reads the new public key.

Every existing subscription was made with the old public key, so push
services now answer `403` for them (`invalid`, `vapid_rejected`) and Apps
Script drops them. Families get notifications again once the app has
subscribed them again with the new key.

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
`fetch`.

To run the Worker locally: `cd workers/push && npm ci && npx wrangler dev`
(uses a local, empty KV).

Files:

* `src/index.ts`: routing, `/register` and `/send` auth.
* `src/webpush.ts`: validation, RFC 8291 encryption, the push request and
  status mapping.
* `src/vapid.ts`: key pair creation and storage, ES256 JWT.
* `src/b64.ts`: base64url, UTF-8, hex, SHA-256 helpers.
* `src/env.ts`: binding types and the per-isolate KV cache.
