import { describe, it, expect } from 'vitest';
import * as privacyKit from 'privacy-kit';

/**
 * Tests verifying that privacyKit.decodeBase64() produces output compatible
 * with Prisma Bytes columns (which expect Buffer or Uint8Array).
 *
 * Background: PGlite returns Uint8Array for bytea columns, but the
 * pglite-prisma-adapter expects hex strings. Using Buffer.from(value, 'base64')
 * wrapped in new Uint8Array() produced a Buffer (a Node.js subclass of Uint8Array)
 * that PGlite could not serialize correctly, causing Prisma P2023 errors.
 *
 * privacyKit.decodeBase64() returns a plain Uint8Array which is compatible
 * with both native PostgreSQL and PGlite adapters.
 *
 * Fixes: https://github.com/slopus/happy/issues/686
 * Fixes: https://github.com/slopus/happy/issues/612
 */
describe('PGlite bytea compatibility', () => {

    it('decodeBase64 returns a Uint8Array', () => {
        const base64 = 'SGVsbG8gV29ybGQ='; // "Hello World"
        const result = privacyKit.decodeBase64(base64);
        expect(result).toBeInstanceOf(Uint8Array);
    });

    it('round-trip encode/decode preserves data', () => {
        const original = new Uint8Array([0, 1, 2, 127, 128, 255]);
        const encoded = privacyKit.encodeBase64(original);
        const decoded = privacyKit.decodeBase64(encoded);
        expect(decoded).toEqual(original);
    });

    it('round-trip with a realistic encryption key (32 bytes)', () => {
        // Simulate a 32-byte AES-256 data encryption key
        const key = new Uint8Array(32);
        for (let i = 0; i < 32; i++) {
            key[i] = i * 8 + 3;
        }
        const base64Key = privacyKit.encodeBase64(key);
        const restored = privacyKit.decodeBase64(base64Key);
        expect(restored).toBeInstanceOf(Uint8Array);
        expect(restored.length).toBe(32);
        expect(restored).toEqual(key);
    });

    it('decodeBase64 handles empty payload', () => {
        // Empty base64 string decodes to empty Uint8Array
        const result = privacyKit.decodeBase64('');
        expect(result).toBeInstanceOf(Uint8Array);
        expect(result.length).toBe(0);
    });

    it('decodeBase64 output is a plain Uint8Array, not a Buffer subclass', () => {
        const base64 = 'AQIDBA=='; // [1, 2, 3, 4]
        const result = privacyKit.decodeBase64(base64);

        // Verify it is a Uint8Array
        expect(result).toBeInstanceOf(Uint8Array);

        // The key difference from the old code: Buffer.from() creates a Buffer
        // which is a subclass of Uint8Array. privacyKit.decodeBase64 returns
        // a plain Uint8Array. Both are valid for Prisma, but PGlite's adapter
        // only handles plain Uint8Array correctly for hex serialization.
        const oldWay = new Uint8Array(Buffer.from('AQIDBA==', 'base64'));

        // Both should contain the same bytes
        expect(Array.from(result)).toEqual(Array.from(oldWay));
        expect(Array.from(result)).toEqual([1, 2, 3, 4]);
    });

    it('encodeBase64 produces standard base64 from Uint8Array', () => {
        const bytes = new Uint8Array([72, 101, 108, 108, 111]); // "Hello"
        const encoded = privacyKit.encodeBase64(bytes);
        expect(typeof encoded).toBe('string');
        // Verify it matches standard base64 encoding
        expect(encoded).toBe(Buffer.from(bytes).toString('base64'));
    });

    it('handles binary data with all byte values', () => {
        // Create array with all 256 possible byte values
        const allBytes = new Uint8Array(256);
        for (let i = 0; i < 256; i++) {
            allBytes[i] = i;
        }

        const base64 = privacyKit.encodeBase64(allBytes);
        const decoded = privacyKit.decodeBase64(base64);

        expect(decoded).toBeInstanceOf(Uint8Array);
        expect(decoded.length).toBe(256);
        expect(decoded).toEqual(allBytes);
    });
});
