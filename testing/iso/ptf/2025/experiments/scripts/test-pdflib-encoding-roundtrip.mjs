#!/usr/bin/env node
// @ts-check
/**
 * Test pdf-lib public API encoding roundtrip for content stream bytes.
 *
 * Verifies that arrayAsString + copyStringIntoBuffer produce a lossless
 * roundtrip for all 256 byte values, and compares against the broken
 * TextDecoder/TextEncoder approach.
 *
 * Usage: node test-pdflib-encoding-roundtrip.mjs
 */
import { fileURLToPath } from 'url';
import { argv } from 'process';

if (argv[1] !== fileURLToPath(import.meta.url)) {
    // Not the entry point
    process.exit(0);
}

// Import pdf-lib public API
const { arrayAsString, copyStringIntoBuffer, charFromCode, decodePDFRawStream } = await import('pdf-lib');

// ============================================================
// Test 1: arrayAsString roundtrip for all 256 byte values
// ============================================================
console.log('=== Test 1: arrayAsString identity mapping (all 256 bytes) ===');

const allBytes = new Uint8Array(256);
for (let i = 0; i < 256; i++) allBytes[i] = i;

const asString = arrayAsString(allBytes);

let identityMismatches = 0;
for (let i = 0; i < 256; i++) {
    const codepoint = asString.charCodeAt(i);
    if (codepoint !== i) {
        console.log(`  MISMATCH: byte 0x${i.toString(16).padStart(2, '0')} -> U+${codepoint.toString(16).toUpperCase().padStart(4, '0')}`);
        identityMismatches++;
    }
}
console.log(`  Result: ${identityMismatches === 0 ? 'PASS' : 'FAIL'} (${identityMismatches} mismatches)`);
console.log(`  String length: ${asString.length} (expected 256)`);
console.log('');

// ============================================================
// Test 2: copyStringIntoBuffer roundtrip
// ============================================================
console.log('=== Test 2: copyStringIntoBuffer reverse mapping ===');

const roundtrippedBytes = new Uint8Array(asString.length);
const written = copyStringIntoBuffer(asString, roundtrippedBytes, 0);

let roundtripMismatches = 0;
for (let i = 0; i < 256; i++) {
    if (roundtrippedBytes[i] !== allBytes[i]) {
        console.log(`  MISMATCH at ${i}: input 0x${allBytes[i].toString(16).padStart(2, '0')} -> output 0x${roundtrippedBytes[i].toString(16).padStart(2, '0')}`);
        roundtripMismatches++;
    }
}
console.log(`  Written: ${written} bytes (expected 256)`);
console.log(`  Result: ${roundtripMismatches === 0 ? 'PASS' : 'FAIL'} (${roundtripMismatches} mismatches)`);
console.log('');

// ============================================================
// Test 3: Specific copyright byte 0xA9
// ============================================================
console.log('=== Test 3: Copyright byte 0xA9 roundtrip ===');

const copyrightBytes = new Uint8Array([0x28, 0xA9, 0x20, 0x73, 0x77, 0x69, 0x73, 0x73, 0x74, 0x6F, 0x70, 0x6F, 0x29]);
// This represents: (© swisstopo)

const copyrightString = arrayAsString(copyrightBytes);
console.log(`  Input bytes: [${[...copyrightBytes].map(b => '0x' + b.toString(16).padStart(2, '0')).join(', ')}]`);
console.log(`  As string: "${copyrightString}"`);
console.log(`  Char at index 1: U+${copyrightString.charCodeAt(1).toString(16).toUpperCase().padStart(4, '0')} (expected U+00A9 = ©)`);

const copyrightRoundtrip = new Uint8Array(copyrightString.length);
copyStringIntoBuffer(copyrightString, copyrightRoundtrip, 0);

const copyrightMatch = copyrightBytes.every((b, i) => b === copyrightRoundtrip[i]);
console.log(`  Roundtripped bytes: [${[...copyrightRoundtrip].map(b => '0x' + b.toString(16).padStart(2, '0')).join(', ')}]`);
console.log(`  Result: ${copyrightMatch ? 'PASS' : 'FAIL'} (byte-exact roundtrip)`);
console.log('');

// ============================================================
// Test 4: Compare against broken TextDecoder/TextEncoder
// ============================================================
console.log('=== Test 4: Broken TextDecoder/TextEncoder comparison ===');

const brokenString = new TextDecoder().decode(copyrightBytes);
const brokenBytes = new TextEncoder().encode(brokenString);

console.log(`  TextDecoder result: "${brokenString}"`);
console.log(`  Char at index 1: U+${brokenString.charCodeAt(1).toString(16).toUpperCase().padStart(4, '0')} (expected U+00A9, got ${brokenString.charCodeAt(1) === 0xA9 ? 'CORRECT' : 'WRONG: U+FFFD replacement'})`);
console.log(`  TextEncoder output: [${[...brokenBytes].map(b => '0x' + b.toString(16).padStart(2, '0')).join(', ')}]`);
console.log(`  Input length: ${copyrightBytes.length}, Output length: ${brokenBytes.length} (${brokenBytes.length === copyrightBytes.length ? 'same' : 'DIFFERENT — data corruption'})`);
console.log('');

// ============================================================
// Test 5: String operations preserve non-ASCII through slicing
// ============================================================
console.log('=== Test 5: String.slice preserves non-ASCII bytes ===');

// Simulate a color replacement: replace "0.5 0.3 0.2 k" with "0.1 0.2 0.3 0.4 k"
// in a stream that also contains the copyright string
const testStreamBytes = new Uint8Array([
    // "0.5 0.3 0.2 k\n"
    0x30, 0x2E, 0x35, 0x20, 0x30, 0x2E, 0x33, 0x20, 0x30, 0x2E, 0x32, 0x20, 0x6B, 0x0A,
    // "(\xa9 swisstopo) Tj\n"
    0x28, 0xA9, 0x20, 0x73, 0x77, 0x69, 0x73, 0x73, 0x74, 0x6F, 0x70, 0x6F, 0x29, 0x20, 0x54, 0x6A, 0x0A,
]);

const streamText = arrayAsString(testStreamBytes);
console.log(`  Original stream text length: ${streamText.length}`);
console.log(`  Byte at copyright position (index 15): 0x${testStreamBytes[15].toString(16).padStart(2, '0')}`);
console.log(`  Char at copyright position (index 15): U+${streamText.charCodeAt(15).toString(16).toUpperCase().padStart(4, '0')}`);

// Simulate replacing the color operation at index 0, length 13 ("0.5 0.3 0.2 k")
const replacement = '0.1 0.2 0.3 0.4 k';
const modifiedText = replacement + streamText.slice(13);

console.log(`  Modified stream text length: ${modifiedText.length}`);

// Check copyright byte survived the string operation
const copyrightCharIndex = modifiedText.indexOf('\xa9');
console.log(`  Copyright char (\\xa9) found at index: ${copyrightCharIndex} (expected > 0)`);

// Encode back
const modifiedBytes = new Uint8Array(modifiedText.length);
copyStringIntoBuffer(modifiedText, modifiedBytes, 0);

// Find 0xA9 in the output
const a9Index = modifiedBytes.indexOf(0xA9);
console.log(`  Byte 0xA9 found in output at index: ${a9Index}`);
console.log(`  Result: ${a9Index >= 0 ? 'PASS' : 'FAIL'} (0xA9 preserved through string operation + roundtrip)`);
console.log('');

// ============================================================
// Test 6: Full 256-byte roundtrip through string operations
// ============================================================
console.log('=== Test 6: Full roundtrip with string slice operation ===');

// Create a stream with all 256 bytes, do a slice operation, verify all bytes preserved
const fullStream = new Uint8Array(266);
// "1 0 0 1 k\n" (10 bytes prefix) then all 256 byte values
const prefix = [0x31, 0x20, 0x30, 0x20, 0x30, 0x20, 0x31, 0x20, 0x6B, 0x0A];
for (let i = 0; i < 10; i++) fullStream[i] = prefix[i];
for (let i = 0; i < 256; i++) fullStream[10 + i] = i;

const fullText = arrayAsString(fullStream);
// Replace "1 0 0 1 k" (9 chars) with "0 0 0 0 k" (same length)
const fullModified = '0 0 0 0 k' + fullText.slice(9);

const fullOutput = new Uint8Array(fullModified.length);
copyStringIntoBuffer(fullModified, fullOutput, 0);

let fullMismatches = 0;
// Check the 256-byte payload starting at offset 10
for (let i = 0; i < 256; i++) {
    if (fullOutput[10 + i] !== i) {
        console.log(`  MISMATCH: byte ${i} (0x${i.toString(16).padStart(2, '0')}) -> 0x${fullOutput[10 + i].toString(16).padStart(2, '0')}`);
        fullMismatches++;
    }
}
console.log(`  Result: ${fullMismatches === 0 ? 'PASS' : 'FAIL'} (${fullMismatches} mismatches in 256-byte payload after string slice + roundtrip)`);
console.log('');

// ============================================================
// Test 7: charFromCode individual byte check
// ============================================================
console.log('=== Test 7: charFromCode for specific problem bytes ===');

const problemBytes = [0x80, 0x8D, 0x8F, 0x90, 0x9D, 0xA9, 0xC2, 0xE9, 0xFC, 0xFF];
for (const byte of problemBytes) {
    const char = charFromCode(byte);
    const backToByte = char.charCodeAt(0);
    const match = byte === backToByte;
    console.log(`  0x${byte.toString(16).padStart(2, '0')} -> charFromCode -> charCodeAt(0) = 0x${backToByte.toString(16).padStart(2, '0')} ${match ? 'PASS' : 'FAIL'}`);
}
console.log('');

// ============================================================
// Summary
// ============================================================
const allPassed = identityMismatches === 0 && roundtripMismatches === 0 && copyrightMatch && fullMismatches === 0;
console.log('=== SUMMARY ===');
console.log(`  All tests: ${allPassed ? 'PASSED' : 'SOME FAILED'}`);
console.log('');
console.log('  Recommended fix:');
console.log('    Decode: arrayAsString(bytes)        — import { arrayAsString } from "pdf-lib"');
console.log('    Encode: copyStringIntoBuffer(text, bytes, 0) — import { copyStringIntoBuffer } from "pdf-lib"');

process.exit(allPassed ? 0 : 1);
