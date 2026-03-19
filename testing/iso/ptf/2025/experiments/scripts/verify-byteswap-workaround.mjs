#!/usr/bin/env node
// @ts-check
/**
 * Verify byte-swap workaround works for ALL color spaces through the sampler
 */

import { readFileSync } from 'fs';
import { PDFImageColorSampler } from '../../classes/pdf-image-color-sampler.js';

const PROFILES_DIR = '/Users/daflair/Projects/conres/conres.io/testing/iso/ptf/2025/tests/fixtures/profiles';

async function main() {
    console.log('Testing PDFImageColorSampler with 16-bit big-endian input → Lab Float32 output\n');

    const sampler = new PDFImageColorSampler({
        destinationProfile: 'Lab',
        destinationColorSpace: 'Lab',
    });

    // Create test data: 5 pixels, 16-bit big-endian midpoint value
    const createTestBuffer = (channels) => {
        const buffer = new Uint8Array(5 * channels * 2);
        for (let i = 0; i < 5 * channels; i++) {
            buffer[i * 2] = 0x80;     // high byte
            buffer[i * 2 + 1] = 0x00; // low byte
        }
        return buffer;
    };

    const tests = [
        { name: 'CMYK', colorSpace: 'CMYK', channels: 4, profile: readFileSync(`${PROFILES_DIR}/eciCMYK v2.icc`) },
        { name: 'RGB', colorSpace: 'RGB', channels: 3, profile: readFileSync(`${PROFILES_DIR}/sRGB IEC61966-2.1.icc`) },
        { name: 'Gray', colorSpace: 'Gray', channels: 1, profile: readFileSync(`${PROFILES_DIR}/sGray.icc`) },
        { name: 'Lab', colorSpace: 'Lab', channels: 3, profile: 'Lab' },
    ];

    for (const test of tests) {
        console.log(`${test.name}:`);
        try {
            const buffer = createTestBuffer(test.channels);
            const profileArg = test.profile === 'Lab' ? 'Lab' : test.profile.buffer.slice(0);

            const result = await sampler.samplePixels({
                streamRef: `test-${test.name}`,
                streamData: buffer,
                isCompressed: false,
                width: 5,
                height: 1,
                colorSpace: test.colorSpace,
                bitsPerComponent: 16,
                sourceProfile: profileArg,
                pixelIndices: [0, 1, 2, 3, 4],
            });

            console.log(`  SUCCESS`);
            console.log(`  Lab[0]: L=${result.labValues[0].toFixed(2)}, a=${result.labValues[1].toFixed(2)}, b=${result.labValues[2].toFixed(2)}`);
        } catch (error) {
            console.log(`  FAILED: ${error.message}`);
        }
        console.log();
    }
}

main().catch(console.error);
