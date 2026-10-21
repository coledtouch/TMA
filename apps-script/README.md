# apps-script/

The TMA app's free backend, ready to paste into the TMA Google Sheet's
**Extensions → Apps Script** project.

| File | What it is |
| --- | --- |
| `Code.js` | **Generated** by `npm run build:gas` from `src/gas` (Apps Script adapters) + `src/server` (backend core) + `src/shared`. Do not edit it by hand; change the TypeScript and rebuild. It is committed so volunteers can copy it without installing anything. |
| `appsscript.json` | The project manifest: New York time zone, V8 runtime, web app settings (runs as the TMA account, open to anyone so parents need no Google login) and the minimal permissions the script asks for. In the Apps Script editor, turn on *Project Settings → Show "appsscript.json"* to paste it. |

Once the code is in, the sheet gets a **TMA App** menu (Run sync now, Send me a
test notification, Set up / repair tabs, Install schedules, Status).

**Set up / repair tabs** also links the sheet to the TMA push Worker (the
Cloudflare Worker in [`workers/push`](../workers/push/README.md) that delivers
push notifications): it creates the `PUSH_RELAY_SECRET` Script Property,
registers it with the Worker at Settings `PUSH_RELAY_URL`, and saves the
Worker's public key as `PUSH_PUBLIC_KEY`. **Status** shows whether that worked.

Step-by-step setup (deploying the web app, Script Properties for PayPal and
Twilio, schedules): see [`docs/SETUP.md`](../docs/SETUP.md).
