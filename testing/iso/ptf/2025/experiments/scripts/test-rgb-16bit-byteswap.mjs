#!/usr/bin/env node
// @ts-check
/**
 * Test if byte-swap workaround works for RGB 16-bit as well as CMYK 16-bit
 */

import { readFileSync } from 'fs';
import { PDFImageColorSampler } from '../../classes/pdf-image-color-sampler.js';

const PROFILES_DIR = '/Users/daflair/Projects/conres/conres.io/testing/iso/ptf/2025/tests/fixtures/profiles';
const RGB_PROFILE = readFileSync(`${PROFILES_DIR}/sRGB IEC61966-2.1.icc`);
const CMYK_PROFILE = readFileSync(`${PROFILES_DIR}/eciCMYK v2.icc`);
const GRAY_PROFILE = readFileSync(`${PROFILES_DIR}/sGray.icc`);

async function main() {
    console.log('Initializing sampler...\n');
    const sampler = new PDFImageColorSampler({
        destinationProfile: 'Lab',
        destinationColorSpace: 'Lab',
    });

    // Create test data: 5 pixels, 16-bit big-endian, value 0x8000 (midpoint)
    const createTestBuffer = (channels) => {
        const buffer = new Uint8Array(5 * channels * 2);
        for (let i = 0; i < 5 * channels; i++) {
            buffer[i * 2] = 0x80;     // high byte
            buffer[i * 2 + 1] = 0x00; // low byte
        }
        return buffer;
    };

    // Test RGB 16-bit big-endian → Lab Float32
    console.log('Test 1: RGB 16-bit big-endian → Lab Float32');
    try {
        const rgbBuffer = createTestBuffer(3);
        const result = await sampler.samplePixels({
            streamRef: 'test-rgb',
            streamData: rgbBuffer,
            isCompressed: false,
            width: 5,
            height: 1,
            colorSpace: 'RGB',
            bitsPerComponent: 16,
            sourceProfile: RGB_PROFILE.buffer.slice(0),
            pixelIndices: [0, 1, 2, 3, 4],
        });
        console.log('  SUCCESS');
        console.log(`  Lab[0]: L=${result.labValues[0].toFixed(2)}, a=${result.labValues[1].toFixed(2)}, b=${result.labValues[2].toFixed(2)}`);
    } catch (error) {
        console.log('  FAILED:', error.message);
    }

    // Test CMYK 16-bit big-endian → Lab Float32
    console.log('\nTest 2: CMYK 16-bit big-endian → Lab Float32');
    try {
        const cmykBuffer = createTestBuffer(4);
        const result = await sampler.samplePixels({
            streamRef: 'test-cmyk',
            streamData: cmykBuffer,
            isCompressed: false,
            width: 5,
            height: 1,
            colorSpace: 'CMYK',
            bitsPerComponent: 16,
            sourceProfile: CMYK_PROFILE.buffer.slice(0),
            pixelIndices: [0, 1, 2, 3, 4],
        });
        console.log('  SUCCESS');
        console.log(`  Lab[0]: L=${result.labValues[0].toFixed(2)}, a=${result.labValues[1].toFixed(2)}, b=${result.labValues[2].toFixed(2)}`);
    } catch (error) {
        console.log('  FAILED:', error.message);
    }

    // Test Gray 16-bit big-endian → Lab Float32
    console.log('\nTest 3: Gray 16-bit big-endian → Lab Float32');
    try {
        const grayBuffer = createTestBuffer(1);
        const result = await sampler.samplePixels({
            streamRef: 'test-gray',
            streamData: grayBuffer,
            isCompressed: false,
            width: 5,
            height: 1,
            colorSpace: 'Gray',
            bitsPerComponent: 16,
            sourceProfile: GRAY_PROFILE.buffer.slice(0),
            pixelIndices: [0, 1, 2, 3, 4],
        });
        console.log('  SUCCESS');
        console.log(`  Lab[0]: L=${result.labValues[0].toFixed(2)}, a=${result.labValues[1].toFixed(2)}, b=${result.labValues[2].toFixed(2)}`);
    } catch (error) {
        console.log('  FAILED:', error.message);
    }

    // Test Lab 16-bit big-endian → Lab Float32 (identity, but still needs format conversion)
    console.log('\nTest 4: Lab 16-bit big-endian → Lab Float32');
    try {
        // Lab encoding: L=0-100 mapped to 0-65535, a/b=-128 to 127 mapped to 0-65535
        // For L=50, a=0, b=0: L=32768 (0x8000), a=32768 (0x8000), b=32768 (0x8000)
        const labBuffer = createTestBuffer(3);
        const result = await sampler.samplePixels({
            streamRef: 'test-lab',
            streamData: labBuffer,
            isCompressed: false,
            width: 5,
            height: 1,
            colorSpace: 'Lab',
            bitsPerComponent: 16,
            sourceProfile: 'Lab',  // Lab uses built-in profile
            pixelIndices: [0, 1, 2, 3, 4],
        });
        console.log('  SUCCESS');
        console.log(`  Lab[0]: L=${result.labValues[0].toFixed(2)}, a=${result.labValues[1].toFixed(2)}, b=${result.labValues[2].toFixed(2)}`);
    } catch (error) {
        console.log('  FAILED:', error.message);
    }
}

main().catch(console.error);
