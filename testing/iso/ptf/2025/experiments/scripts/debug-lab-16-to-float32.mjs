#!/usr/bin/env node
// @ts-check
/**
 * Direct test: Lab 16-bit big-endian → Lab Float32 through PDFImageColorSampler
 *
 * This tests the exact path used in compare-pdf-outputs.js for Lab images.
 */

import { PDFImageColorSampler } from '../../classes/pdf-image-color-sampler.js';

async function main() {
    console.log('Testing Lab 16-bit big-endian → Lab Float32 through PDFImageColorSampler\n');

    const sampler = new PDFImageColorSampler({
        destinationProfile: 'Lab',
        destinationColorSpace: 'Lab',
    });

    await sampler.ensureReady();

    // Create Lab 16-bit big-endian test data
    // Lab 16-bit encoding (LittleCMS):
    // L: 0-100 maps to 0-65535
    // a: -128 to 127 maps to 0-65535 (midpoint 32768 = 0)
    // b: -128 to 127 maps to 0-65535 (midpoint 32768 = 0)

    // Test 1: Single known value L=50, a=0, b=0
    // L=50 → (50/100) * 65535 = 32767.5 ≈ 32768 = 0x8000
    // a=0 → ((0+128)/256) * 65535 = 32767.5 ≈ 32768 = 0x8000
    // b=0 → same = 0x8000
    console.log('Test 1: Single pixel L=50, a=0, b=0');

    // Big-endian: high byte first
    const singlePixelBE = new Uint8Array([
        0x80, 0x00,  // L = 0x8000
        0x80, 0x00,  // a = 0x8000
        0x80, 0x00,  // b = 0x8000
    ]);

    const result1 = await sampler.samplePixels({
        streamRef: 'test-single',
        streamData: singlePixelBE,
        isCompressed: false,
        width: 1,
        height: 1,
        colorSpace: 'Lab',
        bitsPerComponent: 16,
        sourceProfile: 'Lab',
        pixelIndices: [0],
    });

    console.log(`  Input (BE bytes): [${Array.from(singlePixelBE).join(', ')}]`);
    console.log(`  Output Lab Float32: L=${result1.labValues[0].toFixed(4)}, a=${result1.labValues[1].toFixed(4)}, b=${result1.labValues[2].toFixed(4)}`);
    console.log(`  Expected: L≈50, a≈0, b≈0`);

    // Test 2: Multiple distinct values to check uniqueness
    console.log('\nTest 2: 1000 random Lab values - uniqueness check');

    const numPixels = 1000;
    const labBE = new Uint8Array(numPixels * 3 * 2);  // 3 channels * 2 bytes each
    const uniqueInputKeys = new Set();

    for (let i = 0; i < numPixels; i++) {
        const L16 = Math.floor(Math.random() * 65536);
        const a16 = Math.floor(Math.random() * 65536);
        const b16 = Math.floor(Math.random() * 65536);

        // Store as big-endian
        const offset = i * 6;
        labBE[offset] = (L16 >> 8) & 0xFF;
        labBE[offset + 1] = L16 & 0xFF;
        labBE[offset + 2] = (a16 >> 8) & 0xFF;
        labBE[offset + 3] = a16 & 0xFF;
        labBE[offset + 4] = (b16 >> 8) & 0xFF;
        labBE[offset + 5] = b16 & 0xFF;

        // Calculate expected Lab float values and track unique keys
        const Lf = (L16 / 65535) * 100;
        const af = ((a16 / 65535) * 256) - 128;
        const bf = ((b16 / 65535) * 256) - 128;
        const key = `${Math.round(Lf * 10)},${Math.round(af * 10)},${Math.round(bf * 10)}`;
        uniqueInputKeys.add(key);
    }

    const allIndices = Array.from({ length: numPixels }, (_, i) => i);

    const result2 = await sampler.samplePixels({
        streamRef: 'test-random',
        streamData: labBE,
        isCompressed: false,
        width: numPixels,
        height: 1,
        colorSpace: 'Lab',
        bitsPerComponent: 16,
        sourceProfile: 'Lab',
        pixelIndices: allIndices,
    });

    // Count unique output Lab values
    const uniqueOutputKeys = new Set();
    for (let i = 0; i < numPixels; i++) {
        const offset = i * 3;
        const L = result2.labValues[offset];
        const a = result2.labValues[offset + 1];
        const b = result2.labValues[offset + 2];
        const key = `${Math.round(L * 10)},${Math.round(a * 10)},${Math.round(b * 10)}`;
        uniqueOutputKeys.add(key);
    }

    console.log(`  Unique input Lab keys (0.1 precision): ${uniqueInputKeys.size}`);
    console.log(`  Unique output Lab keys (0.1 precision): ${uniqueOutputKeys.size}`);
    console.log(`  Difference: ${uniqueInputKeys.size - uniqueOutputKeys.size}`);

    if (uniqueInputKeys.size !== uniqueOutputKeys.size) {
        console.log(`  ⚠️ WARNING: Unique color count changed during conversion!`);

        // Find which keys are missing
        const missingKeys = [...uniqueInputKeys].filter(k => !uniqueOutputKeys.has(k));
        const extraKeys = [...uniqueOutputKeys].filter(k => !uniqueInputKeys.has(k));
        console.log(`  Missing from output: ${missingKeys.length}`);
        console.log(`  Extra in output: ${extraKeys.length}`);

        if (missingKeys.length > 0) {
            console.log(`  First 5 missing: ${missingKeys.slice(0, 5).join(', ')}`);
        }
        if (extraKeys.length > 0) {
            console.log(`  First 5 extra: ${extraKeys.slice(0, 5).join(', ')}`);
        }
    } else {
        console.log(`  ✓ OK: Unique color count preserved`);
    }

    sampler.dispose();
    console.log('\nDone.');
}

main().catch(console.error);
