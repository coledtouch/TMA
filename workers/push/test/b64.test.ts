import { describe, expect, it } from 'vitest';
import { b64urlDecode, b64urlEncode, concat, constantTimeEqual, sha256Hex, toHex, utf8 } from '../src/b64';

describe('base64url', () => {
  it('matches RFC 4648 test vectors (url alphabet, no padding)', () => {
    const vectors: [string, string][] = [
      ['', ''],
      ['f', 'Zg'],
      ['fo', 'Zm8'],
      ['foo', 'Zm9v'],
      ['foob', 'Zm9vYg'],
      ['fooba', 'Zm9vYmE'],
      ['foobar', 'Zm9vYmFy'],
    ];
    for (const [text, encoded] of vectors) {
      expect(b64urlEncode(utf8(text))).toBe(encoded);
      expect(new TextDecoder().decode(b64urlDecode(encoded)!)).toBe(text);
    }
  });

  it('uses - and _ and decodes both alphabets, with or without padding', () => {
    const bytes = Uint8Array.of(0xfb, 0xff, 0xbf, 0xfe);
    expect(b64urlEncode(bytes)).toBe('-_-__g');
    expect(toHex(b64urlDecode('-_-__g')!)).toBe('fbffbffe');
    expect(toHex(b64urlDecode('+/+//g==')!)).toBe('fbffbffe');
  });

  it('round-trips random bytes of every length mod 3', () => {
    for (let n = 0; n < 70; n++) {
      const bytes = crypto.getRandomValues(new Uint8Array(n));
      expect(toHex(b64urlDecode(b64urlEncode(bytes))!)).toBe(toHex(bytes));
    }
  });

  it('rejects invalid input', () => {
    expect(b64urlDecode('abc!')).toBeNull();
    expect(b64urlDecode('a')).toBeNull();
    expect(b64urlDecode('ab=c')).toBeNull();
    expect(b64urlDecode('é')).toBeNull();
    expect(b64urlDecode('ab cd')).toBeNull();
  });

  it('drops at most two padding characters', () => {
    expect(new TextDecoder().decode(b64urlDecode('Zg==')!)).toBe('f');
    expect(new TextDecoder().decode(b64urlDecode('Zg=')!)).toBe('f');
    expect(new TextDecoder().decode(b64urlDecode('Zm8=')!)).toBe('fo');
    expect(b64urlDecode('Zg===')).toBeNull();
    expect(b64urlDecode('===')).toBeNull();
    expect(toHex(b64urlDecode('==')!)).toBe('');
  });

  it('rejects a long run of "=" in linear time (no regex backtracking)', () => {
    // /=+$/ took ~2 s on this input (quadratic backtracking), which would
    // blow the free plan's 10 ms CPU budget for a whole /send batch.
    const hostile = '='.repeat(50_000) + 'x';
    const start = performance.now();
    expect(b64urlDecode(hostile)).toBeNull();
    expect(b64urlDecode('='.repeat(50_000))).toBeNull();
    expect(performance.now() - start).toBeLessThan(50);
  });
});

describe('byte helpers', () => {
  it('concatenates', () => {
    expect(toHex(concat(Uint8Array.of(1), Uint8Array.of(), Uint8Array.of(2, 3)))).toBe('010203');
  });

  it('hashes to lowercase hex SHA-256', async () => {
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('compares strings', () => {
    expect(constantTimeEqual('abc', 'abc')).toBe(true);
    expect(constantTimeEqual('abc', 'abd')).toBe(false);
    expect(constantTimeEqual('abc', 'ab')).toBe(false);
    expect(constantTimeEqual('', '')).toBe(true);
  });
});
