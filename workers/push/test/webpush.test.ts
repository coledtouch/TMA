import { describe, expect, it } from 'vitest';
import { b64urlEncode, utf8 } from '../src/b64';
import {
  allowedEndpoint,
  decodeKeys,
  encryptPayload,
  encryptWithKeys,
  mapStatus,
  normalizeTopic,
  normalizeTtl,
  normalizeUrgency,
} from '../src/webpush';
import { b64, decryptAsUserAgent, importEcPrivate, makeUserAgent, type FakeUserAgent } from './helpers';

// RFC 8291 §5 and Appendix A, copied from https://www.rfc-editor.org/rfc/rfc8291.txt
// with the presentation whitespace removed.
const RFC = {
  plaintext: 'When I grow up, I want to be a watermelon',
  plaintextB64: 'V2hlbiBJIGdyb3cgdXAsIEkgd2FudCB0byBiZSBhIHdhdGVybWVsb24',
  asPublic: 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
  asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  uaPublic: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  uaPrivate: 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  authSecret: 'BTBZMqHH6r4Tts7J_aSIgg',
  body:
    'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml' +
    'mlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPT' +
    'pK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
  header86:
    'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml' + 'mlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
};

describe('RFC 8291 Appendix A test vector', () => {
  it('produces the exact body from the RFC example', async () => {
    expect(b64urlEncode(utf8(RFC.plaintext))).toBe(RFC.plaintextB64);
    const asPublic = b64(RFC.asPublic);
    const asPrivate = await importEcPrivate(b64(RFC.asPrivate), asPublic, 'ECDH', ['deriveBits']);
    const body = await encryptWithKeys(
      utf8(RFC.plaintext),
      b64(RFC.uaPublic),
      b64(RFC.authSecret),
      { privateKey: asPrivate, publicKey: asPublic },
      b64(RFC.salt),
    );
    // 86-byte header + 41-byte plaintext + 1 delimiter + 16-byte tag. (The
    // example request in RFC 8291 §5 says Content-Length: 145, but the body it
    // shows decodes to 144 bytes.)
    expect(body.length).toBe(144);
    expect(b64urlEncode(body.subarray(0, 86))).toBe(RFC.header86);
    expect(b64urlEncode(body)).toBe(RFC.body);
  });

  it('the RFC receiver keys decrypt the RFC body (checks the test decrypter)', async () => {
    const uaPublic = b64(RFC.uaPublic);
    const ua: FakeUserAgent = {
      privateKey: await importEcPrivate(b64(RFC.uaPrivate), uaPublic, 'ECDH', ['deriveBits']),
      publicKey: uaPublic,
      authSecret: b64(RFC.authSecret),
      p256dh: RFC.uaPublic,
      auth: RFC.authSecret,
    };
    expect(await decryptAsUserAgent(b64(RFC.body), ua)).toBe(RFC.plaintext);
  });
});

describe('round trip', () => {
  it('a fake browser decrypts what encryptPayload produced', async () => {
    const ua = await makeUserAgent();
    const payload = JSON.stringify({ title: 'Trip deposit due', body: 'Señor Ramírez says hi 🎺', url: '#/trips' });
    const body = await encryptPayload(utf8(payload), ua.publicKey, ua.authSecret);
    expect(body[20]).toBe(65);
    expect(new DataView(body.buffer).getUint32(16)).toBe(4096);
    expect(body.length).toBe(86 + utf8(payload).length + 1 + 16);
    expect(await decryptAsUserAgent(body, ua)).toBe(payload);
  });

  it('uses a fresh ephemeral key and salt for every message', async () => {
    const ua = await makeUserAgent();
    const a = await encryptPayload(utf8('same'), ua.publicKey, ua.authSecret);
    const b = await encryptPayload(utf8('same'), ua.publicKey, ua.authSecret);
    expect(b64urlEncode(a.subarray(0, 16))).not.toBe(b64urlEncode(b.subarray(0, 16)));
    expect(b64urlEncode(a.subarray(21, 86))).not.toBe(b64urlEncode(b.subarray(21, 86)));
    expect(await decryptAsUserAgent(a, ua)).toBe('same');
    expect(await decryptAsUserAgent(b, ua)).toBe('same');
  });

  it('round-trips the largest allowed payload (3000 bytes) and an empty one', async () => {
    const ua = await makeUserAgent();
    for (const payload of ['x'.repeat(3000), '']) {
      const body = await encryptPayload(utf8(payload), ua.publicKey, ua.authSecret);
      expect(await decryptAsUserAgent(body, ua)).toBe(payload);
    }
  });
});

describe('validation helpers', () => {
  it('allows only known push service hosts over https', () => {
    for (const ok of [
      'https://fcm.googleapis.com/fcm/send/abc:def',
      'https://updates.push.services.mozilla.com/wpush/v2/gAAA',
      'https://web.push.apple.com/QH0n',
      'https://api.push.apple.com/x',
      'https://wns2-by3p.notify.windows.com/w/?token=abc',
      'https://FCM.googleapis.com/fcm/send/abc',
    ]) {
      expect(allowedEndpoint(ok), ok).not.toBeNull();
    }
    for (const bad of [
      'http://fcm.googleapis.com/fcm/send/abc',
      'https://fcm.googleapis.com.evil.example/x',
      'https://evilfcm.googleapis.com/x',
      'https://push.apple.com.evil.example/x',
      'https://notify.windows.com/x',
      'https://fcm.googleapis.com:8443/x',
      'https://user:pw@fcm.googleapis.com/x',
      'https://169.254.169.254/latest/meta-data',
      'https://localhost/x',
      'not a url',
      '',
      42,
      undefined,
    ]) {
      expect(allowedEndpoint(bad), String(bad)).toBeNull();
    }
  });

  it('decodes subscription keys, tolerating standard base64 with padding', async () => {
    const ua = await makeUserAgent();
    const std = (s: string) => s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
    expect(decodeKeys({ p256dh: ua.p256dh, auth: ua.auth })).not.toBeNull();
    const decoded = decodeKeys({ p256dh: std(ua.p256dh), auth: std(ua.auth) });
    expect(decoded && b64urlEncode(decoded.uaPublic)).toBe(ua.p256dh);
    expect(decoded && b64urlEncode(decoded.authSecret)).toBe(ua.auth);
    expect(decodeKeys({ p256dh: ua.p256dh.slice(0, -4), auth: ua.auth })).toBeNull(); // short point
    expect(decodeKeys({ p256dh: 'A' + ua.p256dh.slice(1), auth: ua.auth })).toBeNull(); // not 0x04
    expect(decodeKeys({ p256dh: ua.p256dh, auth: ua.auth + 'AAAA' })).toBeNull(); // auth not 16 bytes
    expect(decodeKeys({ p256dh: ua.p256dh, auth: '!!!' })).toBeNull();
    expect(decodeKeys({ p256dh: ua.p256dh })).toBeNull();
    expect(decodeKeys(null)).toBeNull();
  });

  it('rejects over-long keys by length before decoding them', async () => {
    const ua = await makeUserAgent();
    const std = (s: string) => s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
    // The longest accepted forms: padded standard base64 (88 and 24 chars).
    expect(std(ua.p256dh).length).toBe(88);
    expect(std(ua.auth).length).toBe(24);
    expect(decodeKeys({ p256dh: std(ua.p256dh), auth: std(ua.auth) })).not.toBeNull();
    expect(decodeKeys({ p256dh: `${std(ua.p256dh)}=`, auth: ua.auth })).toBeNull();
    expect(decodeKeys({ p256dh: ua.p256dh, auth: `${std(ua.auth)}=` })).toBeNull();

    const start = performance.now();
    expect(decodeKeys({ p256dh: '='.repeat(10_000) + 'A', auth: ua.auth })).toBeNull();
    expect(decodeKeys({ p256dh: ua.p256dh, auth: '='.repeat(10_000) + 'A' })).toBeNull();
    expect(decodeKeys({ p256dh: 'A'.repeat(50_000), auth: ua.auth })).toBeNull();
    expect(performance.now() - start).toBeLessThan(20);
  });

  it('normalizes ttl, urgency and topic', () => {
    expect(normalizeTtl(undefined)).toBe(86400);
    expect(normalizeTtl('60')).toBe(86400);
    expect(normalizeTtl(-5)).toBe(0);
    expect(normalizeTtl(99_999_999)).toBe(2419200);
    expect(normalizeTtl(60.9)).toBe(60);
    expect(normalizeTtl(Number.NaN)).toBe(86400);
    expect(normalizeUrgency(undefined)).toBe('high');
    expect(normalizeUrgency('very-low')).toBe('very-low');
    expect(normalizeUrgency('urgent')).toBe('high');
    expect(normalizeTopic('trip_42-update')).toBe('trip_42-update');
    expect(normalizeTopic('has space')).toBeUndefined();
    expect(normalizeTopic('x'.repeat(33))).toBeUndefined();
    expect(normalizeTopic('')).toBeUndefined();
    expect(normalizeTopic(7)).toBeUndefined();
  });

  it('maps push service statuses', () => {
    expect(mapStatus(201)).toEqual({ status: 'ok', code: 201 });
    expect(mapStatus(200).status).toBe('ok');
    expect(mapStatus(202).status).toBe('ok');
    expect(mapStatus(404)).toEqual({ status: 'invalid', code: 404, reason: 'gone' });
    expect(mapStatus(410)).toEqual({ status: 'invalid', code: 410, reason: 'gone' });
    expect(mapStatus(403)).toEqual({ status: 'invalid', code: 403, reason: 'vapid_rejected' });
    expect(mapStatus(413)).toMatchObject({ status: 'error', code: 413 });
    expect(mapStatus(429)).toMatchObject({ status: 'error', code: 429 });
    expect(mapStatus(503)).toMatchObject({ status: 'error', code: 503 });
    expect(mapStatus(400)).toMatchObject({ status: 'error', code: 400 });
  });
});
