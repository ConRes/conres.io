#!/usr/bin/env node
// @ts-check
/**
 * Test pdf-lib encoding roundtrip in a BROWSER context via Playwright.
 *
 * This verifies that arrayAsString/copyStringIntoBuffer work identically
 * in the browser as they do in Node.js — critical because the Refactored
 * path (pdf-page-color-converter.js) and Legacy path (ColorSpaceUtils.js)
 * run in the browser.
 *
 * Usage: node test-pdflib-encoding-browser.mjs
 */
import { chromium } from 'playwright-chromium';

const BASE_URL = 'http://localhost:8080';

console.log('Launching Chromium...');
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

try {
    await page.goto(`${BASE_URL}/testing/iso/ptf/2025/index.html`, { waitUntil: 'domcontentloaded', timeout: 10000 });

    const results = await page.evaluate(async () => {
        const { arrayAsString, copyStringIntoBuffer, charFromCode } = await import('pdf-lib');

        const output = [];

        // Test 1: Identity mapping for all 256 bytes
        const allBytes = new Uint8Array(256);
        for (let i = 0; i < 256; i++) allBytes[i] = i;
        const asString = arrayAsString(allBytes);

        let identityMismatches = 0;
        const identityDetails = [];
        for (let i = 0; i < 256; i++) {
            const cp = asString.charCodeAt(i);
            if (cp !== i) {
                identityDetails.push(`byte 0x${i.toString(16).padStart(2, '0')} -> U+${cp.toString(16).toUpperCase().padStart(4, '0')}`);
                identityMismatches++;
            }
        }
        output.push({
            test: 'arrayAsString identity (256 bytes)',
            pass: identityMismatches === 0,
            mismatches: identityMismatches,
            details: identityDetails,
        });

        // Test 2: copyStringIntoBuffer roundtrip
        const roundtripped = new Uint8Array(256);
        const written = copyStringIntoBuffer(asString, roundtripped, 0);

        let rtMismatches = 0;
        for (let i = 0; i < 256; i++) {
            if (roundtripped[i] !== i) rtMismatches++;
        }
        output.push({
            test: 'copyStringIntoBuffer roundtrip (256 bytes)',
            pass: rtMismatches === 0,
            mismatches: rtMismatches,
            written,
        });

        // Test 3: Copyright byte 0xA9
        const copyrightBytes = new Uint8Array([0x28, 0xA9, 0x20, 0x73, 0x77, 0x69, 0x73, 0x73, 0x74, 0x6F, 0x70, 0x6F, 0x29]);
        const copyrightStr = arrayAsString(copyrightBytes);
        const copyrightBack = new Uint8Array(copyrightStr.length);
        copyStringIntoBuffer(copyrightStr, copyrightBack, 0);
        const copyrightExact = copyrightBytes.every((b, i) => b === copyrightBack[i]);
        output.push({
            test: 'Copyright 0xA9 roundtrip',
            pass: copyrightExact,
            charCodeAt1: copyrightStr.charCodeAt(1),
            expected: 0xA9,
        });

        // Test 4: Broken TextDecoder/TextEncoder
        const brokenStr = new TextDecoder().decode(copyrightBytes);
        const brokenBack = new TextEncoder().encode(brokenStr);
        output.push({
            test: 'TextDecoder/TextEncoder (BROKEN baseline)',
            pass: false,  // Expected to fail
            charCodeAt1: brokenStr.charCodeAt(1),
            inputLength: copyrightBytes.length,
            outputLength: brokenBack.length,
            corrupt: brokenStr.charCodeAt(1) === 0xFFFD,
        });

        // Test 5: String slice preserves non-ASCII
        const testStream = new Uint8Array([
            0x30, 0x2E, 0x35, 0x20, 0x30, 0x2E, 0x33, 0x20, 0x30, 0x2E, 0x32, 0x20, 0x6B, 0x0A,
            0x28, 0xA9, 0x20, 0x73, 0x77, 0x69, 0x73, 0x73, 0x74, 0x6F, 0x70, 0x6F, 0x29, 0x20, 0x54, 0x6A, 0x0A,
        ]);
        const streamText = arrayAsString(testStream);
        const modified = '0.1 0.2 0.3 0.4 k' + streamText.slice(13);
        const modBytes = new Uint8Array(modified.length);
        copyStringIntoBuffer(modified, modBytes, 0);
        const a9Found = modBytes.indexOf(0xA9) >= 0;
        output.push({
            test: 'String.slice preserves 0xA9 through roundtrip',
            pass: a9Found,
        });

        // Test 6: charFromCode problem bytes
        const problemBytes = [0x80, 0x8D, 0x8F, 0x90, 0x9D, 0xA9, 0xC2, 0xE9, 0xFC, 0xFF];
        let charMismatches = 0;
        for (const b of problemBytes) {
            if (charFromCode(b).charCodeAt(0) !== b) charMismatches++;
        }
        output.push({
            test: 'charFromCode problem bytes (0x80-0xFF)',
            pass: charMismatches === 0,
            mismatches: charMismatches,
        });

        return output;
    });

    console.log('');
    console.log('=== Browser (Chromium) Results ===');
    console.log('');

    let allPass = true;
    for (const r of results) {
        const status = r.pass ? 'PASS' : 'FAIL';
        console.log(`  [${status}] ${r.test}`);
        if (r.mismatches !== undefined) console.log(`         Mismatches: ${r.mismatches}`);
        if (r.details && r.details.length > 0) {
            for (const d of r.details.slice(0, 10)) console.log(`         ${d}`);
        }
        if (r.charCodeAt1 !== undefined) console.log(`         charCodeAt(1): U+${r.charCodeAt1.toString(16).toUpperCase().padStart(4, '0')}`);
        if (r.corrupt !== undefined) console.log(`         UTF-8 corruption: ${r.corrupt}`);
        if (r.inputLength !== undefined) console.log(`         Length: ${r.inputLength} -> ${r.outputLength}`);
        if (r.test !== 'TextDecoder/TextEncoder (BROKEN baseline)' && !r.pass) allPass = false;
    }

    console.log('');
    console.log(`  Overall: ${allPass ? 'ALL PASSED' : 'SOME FAILED'}`);

    process.exit(allPass ? 0 : 1);

} catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
} finally {
    await browser.close();
}
