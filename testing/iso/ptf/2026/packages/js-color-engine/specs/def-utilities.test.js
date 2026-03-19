/**
 * @fileoverview Test suite for utility functions in def.js
 * Tests mathematical utilities, base64 encoding/decoding, and other shared functions
 */

// @ts-check

import { test, describe } from 'node:test';
import assert from 'node:assert';
import { roundN, uint8ArrayToBase64, uint16ArrayToBase64, base64ToUint8Array, base64ToUint16Array, intent2String, eIntent } from '../src/def.js';

describe('Utility Functions', () => {
    
    describe('roundN', () => {
        test('should round to specified decimal places', () => {
            assert.strictEqual(roundN(3.14159, 2), 3.14);
            assert.strictEqual(roundN(3.14159, 4), 3.1416);
            assert.strictEqual(roundN(3.14159, 0), 3);
        });

        test('should handle negative numbers', () => {
            assert.strictEqual(roundN(-3.14159, 2), -3.14);
            assert.strictEqual(roundN(-3.14159, 0), -3);
        });

        test('should handle zero decimal places', () => {
            assert.strictEqual(roundN(3.7, 0), 4);
            assert.strictEqual(roundN(3.2, 0), 3);
        });

        test('should handle large decimal places', () => {
            assert.strictEqual(roundN(3.14159, 10), 3.14159);
        });

        test('should handle edge cases', () => {
            assert.strictEqual(roundN(0, 2), 0);
            assert.strictEqual(roundN(1, 0), 1);
        });
    });

    describe('Base64 Encoding/Decoding', () => {
        
        describe('uint8ArrayToBase64', () => {
            test('should encode simple array', () => {
                const input = new Uint8Array([72, 101, 108, 108, 111]); // "Hello"
                const result = uint8ArrayToBase64(input);
                assert.strictEqual(result, 'SGVsbG8=');
            });

            test('should handle empty array', () => {
                const input = new Uint8Array([]);
                const result = uint8ArrayToBase64(input);
                assert.strictEqual(result, '');
            });

            test('should handle single byte', () => {
                const input = new Uint8Array([65]); // "A"
                const result = uint8ArrayToBase64(input);
                assert.strictEqual(result, 'QQ==');
            });
        });

        describe('base64ToUint8Array', () => {
            test('should decode simple string', () => {
                const result = base64ToUint8Array('SGVsbG8=');
                const expected = new Uint8Array([72, 101, 108, 108, 111]);
                assert.deepStrictEqual(result, expected);
            });

            test('should handle empty string', () => {
                const result = base64ToUint8Array('');
                const expected = new Uint8Array([]);
                assert.deepStrictEqual(result, expected);
            });

            test('should handle single character', () => {
                const result = base64ToUint8Array('QQ==');
                const expected = new Uint8Array([65]);
                assert.deepStrictEqual(result, expected);
            });
        });

        describe('uint16ArrayToBase64', () => {
            test('should encode 16-bit array', () => {
                const input = new Uint16Array([0x4865, 0x6C6C, 0x6F00]); // "Hello" in 16-bit
                const result = uint16ArrayToBase64(input);
                // Should be a valid base64 string
                assert.strictEqual(typeof result, 'string');
                assert.ok(result.length > 0);
            });

            test('should handle empty array', () => {
                const input = new Uint16Array([]);
                const result = uint16ArrayToBase64(input);
                assert.strictEqual(result, '');
            });

            test('should handle single value', () => {
                const input = new Uint16Array([0x1234]);
                const result = uint16ArrayToBase64(input);
                assert.strictEqual(typeof result, 'string');
                assert.ok(result.length > 0);
            });
        });

        describe('base64ToUint16Array', () => {
            test('should decode to 16-bit array', () => {
                const input = uint16ArrayToBase64(new Uint16Array([0x1234, 0x5678]));
                const result = base64ToUint16Array(input);
                const expected = new Uint16Array([0x1234, 0x5678]);
                assert.deepStrictEqual(result, expected);
            });

            test('should handle empty string', () => {
                const result = base64ToUint16Array('');
                const expected = new Uint16Array([]);
                assert.deepStrictEqual(result, expected);
            });

            test('should be symmetric with encoding', () => {
                const original = new Uint16Array([0x1234, 0x5678, 0x9ABC, 0xDEF0]);
                const encoded = uint16ArrayToBase64(original);
                const decoded = base64ToUint16Array(encoded);
                assert.deepStrictEqual(decoded, original);
            });
        });

        describe('Round-trip encoding/decoding', () => {
            test('uint8Array should survive round-trip', () => {
                const original = new Uint8Array([0, 127, 255, 64, 128, 192]);
                const encoded = uint8ArrayToBase64(original);
                const decoded = base64ToUint8Array(encoded);
                assert.deepStrictEqual(decoded, original);
            });

            test('uint16Array should survive round-trip', () => {
                const original = new Uint16Array([0, 32767, 65535, 16384, 32768, 49152]);
                const encoded = uint16ArrayToBase64(original);
                const decoded = base64ToUint16Array(encoded);
                assert.deepStrictEqual(decoded, original);
            });

            test('should handle large arrays', () => {
                const original = new Uint8Array(1000);
                for (let i = 0; i < 1000; i++) {
                    original[i] = i % 256;
                }
                const encoded = uint8ArrayToBase64(original);
                const decoded = base64ToUint8Array(encoded);
                assert.deepStrictEqual(decoded, original);
            });
        });
    });

    describe('intent2String', () => {
        test('should convert valid intents', () => {
            assert.strictEqual(intent2String(eIntent.perceptual), 'Perceptual');
            assert.strictEqual(intent2String(eIntent.relative), 'Relative');
            assert.strictEqual(intent2String(eIntent.saturation), 'Saturation');
            assert.strictEqual(intent2String(eIntent.absolute), 'Absolute');
        });

        test('should handle invalid intents', () => {
            assert.strictEqual(intent2String(99), 'unknown');
            assert.strictEqual(intent2String(-1), 'unknown');
            assert.strictEqual(intent2String(4), 'unknown');
        });

        test('should handle edge cases', () => {
            assert.strictEqual(intent2String(undefined), 'unknown');
            assert.strictEqual(intent2String(null), 'unknown');
            assert.strictEqual(intent2String(NaN), 'unknown');
        });
    });

    describe('Data Integrity', () => {
        test('should preserve data types in encoding/decoding', () => {
            // Test that TypedArrays maintain their type information through the process
            const uint8Original = new Uint8Array([1, 2, 3, 4, 5]);
            const uint8Encoded = uint8ArrayToBase64(uint8Original);
            const uint8Decoded = base64ToUint8Array(uint8Encoded);
            
            assert.ok(uint8Decoded instanceof Uint8Array);
            assert.deepStrictEqual(uint8Decoded, uint8Original);

            const uint16Original = new Uint16Array([256, 512, 1024, 2048]);
            const uint16Encoded = uint16ArrayToBase64(uint16Original);
            const uint16Decoded = base64ToUint16Array(uint16Encoded);
            
            assert.ok(uint16Decoded instanceof Uint16Array);
            assert.deepStrictEqual(uint16Decoded, uint16Original);
        });

        test('should handle boundary values correctly', () => {
            // Test boundary values for Uint8Array
            const uint8Boundary = new Uint8Array([0, 1, 127, 128, 254, 255]);
            const uint8Result = base64ToUint8Array(uint8ArrayToBase64(uint8Boundary));
            assert.deepStrictEqual(uint8Result, uint8Boundary);

            // Test boundary values for Uint16Array  
            const uint16Boundary = new Uint16Array([0, 1, 32767, 32768, 65534, 65535]);
            const uint16Result = base64ToUint16Array(uint16ArrayToBase64(uint16Boundary));
            assert.deepStrictEqual(uint16Result, uint16Boundary);
        });
    });

    describe('Performance and Memory', () => {
        test('should handle reasonably large arrays efficiently', () => {
            const largeArray = new Uint8Array(10000);
            for (let i = 0; i < 10000; i++) {
                largeArray[i] = i % 256;
            }

            const start = performance.now();
            const encoded = uint8ArrayToBase64(largeArray);
            const decoded = base64ToUint8Array(encoded);
            const end = performance.now();

            // Should complete in reasonable time (less than 1 second)
            assert.ok(end - start < 1000);
            assert.deepStrictEqual(decoded, largeArray);
        });
    });
});
