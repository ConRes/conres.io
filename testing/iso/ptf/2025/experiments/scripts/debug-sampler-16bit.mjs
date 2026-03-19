#!/usr/bin/env node
// @ts-check
/**
 * Debug 16-bit big-endian → Lab Float32 through full PDFImageColorSampler path
 *
 * This test verifies that the byte-swap workaround in ColorConverter.convertColorsBuffer()
 * is being applied when going through PDFImageColorSampler.samplePixels().
 */

import { readFileSync } from 'fs';
import { PDFImageColorSampler } from '../../classes/pdf-image-color-sampler.js';

const PROFILES_DIR = '/Users/daflair/Projects/conres/conres.io/testing/iso/ptf/2025/tests/fixtures/profiles';
const RGB_PROFILE = readFileSync(`${PROFILES_DIR}/sRGB IEC61966-2.1.icc`);
const CMYK_PROFILE = readFileSync(`${PROFILES_DIR}/eciCMYK v2.icc`);
const GRAY_PROFILE = readFileSync(`${PROFILES_DIR}/sGray.icc`);

/**
 * Convert a Node.js Buffer to an ArrayBuffer (handles buffer pooling correctly)
 * @param {Buffer} buffer
 * @returns {ArrayBuffer}
 */
function bufferToArrayBuffer(buffer) {
    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

/**
 * Create test data: known 16-bit big-endian values
 */
function createTestBuffer(channels, numPixels = 5) {
    const buffer = new Uint8Array(numPixels * channels * 2);
    for (let p = 0; p < numPixels; p++) {
        for (let c = 0; c < channels; c++) {
            const idx = (p * channels + c) * 2;
            // Value: 0x8000 (midpoint) in big-endian
            buffer[idx] = 0x80;     // high byte
            buffer[idx + 1] = 0x00; // low byte
        }
    }
    return buffer;
}

async function main() {
    console.log('Testing PDFImageColorSampler with 16-bit big-endian input → Lab Float32\n');
    console.log('This tests the byte-swap workaround for LittleCMS SE → Float limitation\n');

    const sampler = new PDFImageColorSampler({
        destinationProfile: 'Lab',
        destinationColorSpace: 'Lab',
    });

    await sampler.ensureReady();
    console.log('PDFImageColorSampler initialized\n');

    const tests = [
        { name: 'RGB', colorSpace: 'RGB', channels: 3, profile: bufferToArrayBuffer(RGB_PROFILE) },
        { name: 'CMYK', colorSpace: 'CMYK', channels: 4, profile: bufferToArrayBuffer(CMYK_PROFILE) },
        { name: 'Gray', colorSpace: 'Gray', channels: 1, profile: bufferToArrayBuffer(GRAY_PROFILE) },
        { name: 'Lab', colorSpace: 'Lab', channels: 3, profile: 'Lab' },
    ];

    for (const test of tests) {
        console.log(`${test.name} 16-bit big-endian → Lab Float32:`);
        try {
            const buffer = createTestBuffer(test.channels);

            const result = await sampler.samplePixels({
                streamRef: `test-${test.name}`,
                streamData: buffer,
                isCompressed: false,
                width: 5,
                height: 1,
                colorSpace: test.colorSpace,
                bitsPerComponent: 16,
                sourceProfile: test.profile,
                pixelIndices: [0, 1, 2, 3, 4],
            });

            // Validate we got Float32Array
            if (!(result.labValues instanceof Float32Array)) {
                console.log(`  ERROR: Expected Float32Array, got ${result.labValues.constructor.name}`);
                continue;
            }

            // Check if Lab values are valid (not corrupted)
            const L = result.labValues[0];
            const a = result.labValues[1];
            const b = result.labValues[2];

            // Valid Lab: L should be 0-100, a and b should be roughly -128 to 127
            const validL = L >= 0 && L <= 100;
            const validA = a >= -130 && a <= 130;
            const validB = b >= -130 && b <= 130;

            if (!validL || !validA || !validB) {
                console.log(`  WARNING: Lab values may be corrupted`);
                console.log(`    L=${L.toFixed(2)} (valid: ${validL})`);
                console.log(`    a=${a.toFixed(2)} (valid: ${validA})`);
                console.log(`    b=${b.toFixed(2)} (valid: ${validB})`);
            } else {
                console.log(`  SUCCESS: L=${L.toFixed(2)}, a=${a.toFixed(2)}, b=${b.toFixed(2)}`);
            }

            // Count unique Lab colors
            const uniqueColors = new Set();
            for (let i = 0; i < result.pixelCount; i++) {
                const offset = i * 3;
                const key = `${Math.round(result.labValues[offset] * 10)},${Math.round(result.labValues[offset + 1] * 10)},${Math.round(result.labValues[offset + 2] * 10)}`;
                uniqueColors.add(key);
            }
            console.log(`  Unique Lab colors: ${uniqueColors.size} (expected: 1 for uniform input)`);

        } catch (error) {
            console.log(`  FAILED: ${error.message}`);
            if (error.stack) {
                console.log(`  Stack: ${error.stack.split('\n').slice(0, 3).join('\n    ')}`);
            }
        }
        console.log('');
    }

    sampler.dispose();
    console.log('Done.');
}

main().catch(console.error);
