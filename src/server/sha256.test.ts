import { describe, expect, it } from 'vitest';
import { hmacSha256Hex, sha256Hex, utf8Decode, utf8Encode } from './sha256';

describe('sha256Hex', () => {
  it.each([
    ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
    ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
    [
      'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq',
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    ],
    ['The quick brown fox jumps over the lazy dog', 'd7a8fbb307d7809469ca9abcb0082e4f8d5651e46d3cdb762d02d0bf37c9e592'],
  ])('NIST/known vector %#', (input, expected) => {
    expect(sha256Hex(input)).toBe(expected);
  });

  it('handles padding boundaries (55, 56, 64 bytes) and long input', () => {
    expect(sha256Hex('a'.repeat(55))).toBe('9f4390f8d30c2dd92ec9f095b65e2b9ae9b0a925a5258e241c9f1e910f734318');
    expect(sha256Hex('a'.repeat(56))).toBe('b35439a4ac6f0948b6d6f9e3c6af0f5f590ce20f1bde7090ef7970686ec6738a');
    expect(sha256Hex('a'.repeat(64))).toBe('ffe054fe7ae0cb6dc65c3af9b61d5209f439851db43d0ba5997337df154668eb');
    expect(sha256Hex('a'.repeat(64000))).toBe('b79a5f9da7504a0ca606f2b54a81d5e28a8c924df8974416f320501652dcd6be');
  });

  it('hashes UTF-8 bytes (multi-byte and astral characters)', () => {
    expect(sha256Hex('é')).toBe('4a99557e4033c3539de2eb65472017cad5f9557f7a0625a09f1c3f6e2ba69c4c');
    expect(sha256Hex('TMA \u{1F3BA} Timberlane – café')).toBe(
      '3ca4cc05529e9da7dd1b0d5ee6e58a3ebf2ebf5e581c862ea8e2f8e030aa35d3',
    );
  });
});

describe('hmacSha256Hex', () => {
  it('matches RFC 4231 test case 2', () => {
    expect(hmacSha256Hex('Jefe', 'what do ya want for nothing?')).toBe(
      '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843',
    );
  });

  it('hashes keys longer than the block size first', () => {
    expect(hmacSha256Hex('k'.repeat(131), 'Test Using Larger Than Block-Size Key - Hash Key First')).toBe(
      '70e4b005732fa7ff79392aa24fb240159b925dbc9f1398420c0f45e6763dcf14',
    );
  });

  it('uses UTF-8 for key and message (like Utilities.computeHmacSha256Signature)', () => {
    expect(hmacSha256Hex('clé \u{1F511}', 'Grüße → TMA')).toBe(
      'b48fd114e6175fa7edc6461dcdf522cbdfc0a93b0e54ea459745f49edd32db26',
    );
  });

  it('depends on the key', () => {
    expect(hmacSha256Hex('key-1', 'message')).not.toBe(hmacSha256Hex('key-2', 'message'));
  });
});

describe('utf8 codec', () => {
  it('round-trips text including astral characters', () => {
    const text = 'Avery \u{1F3BA} café – 日本';
    expect(utf8Decode(utf8Encode(text))).toBe(text);
  });

  it('replaces lone surrogates and rejects invalid bytes', () => {
    expect(utf8Encode('\ud800')).toEqual([0xef, 0xbf, 0xbd]);
    expect(utf8Decode([0xc3])).toBeNull(); // truncated
    expect(utf8Decode([0xc0, 0x80])).toBeNull(); // overlong
    expect(utf8Decode([0xed, 0xa0, 0x80])).toBeNull(); // surrogate
    expect(utf8Decode([0xff])).toBeNull();
  });
});
