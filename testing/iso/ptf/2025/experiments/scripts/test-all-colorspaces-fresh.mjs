#!/usr/bin/env node
// @ts-check
/**
 * Test all color spaces with fresh engine instances
 */

import { readFileSync } from 'fs';
import { ColorEngineProvider } from '../../classes/color-engine-provider.js';

const PROFILES_DIR = '/Users/daflair/Projects/conres/conres.io/testing/iso/ptf/2025/tests/fixtures/profiles';
const RGB_PROFILE = readFileSync(`${PROFILES_DIR}/sRGB IEC61966-2.1.icc`);
const CMYK_PROFILE = readFileSync(`${PROFILES_DIR}/eciCMYK v2.icc`);
const GRAY_PROFILE = readFileSync(`${PROFILES_DIR}/sGray.icc`);

async function testTransform(colorSpace, profile, inputFormat, outputFormat) {
    const provider = new ColorEngineProvider();
    await provider.initialize();
    const engine = provider.engine;
    const constants = provider.getConstants();

    // Open profile
    const sourceProfile = profile === 'Lab'
        ? engine.createLab4Profile()
        : engine.openProfileFromMem(profile);
    const destProfile = engine.createLab4Profile();

    const transform = engine.createTransform(
        sourceProfile,
        inputFormat,
        destProfile,
        outputFormat,
        constants.INTENT_RELATIVE_COLORIMETRIC,
        constants.cmsFLAGS_BLACKPOINTCOMPENSATION
    );

    return transform !== 0;
}

async function main() {
    // Get constants from a provider
    const provider = new ColorEngineProvider();
    await provider.initialize();
    const c = provider.getConstants();

    console.log('Testing 16-bit NATIVE (no SE) → Lab Float32:\n');

    const tests = [
        { name: 'CMYK', profile: CMYK_PROFILE, inputFormat: c.TYPE_CMYK_16 },
        { name: 'RGB', profile: RGB_PROFILE, inputFormat: c.TYPE_RGB_16 },
        { name: 'Gray', profile: GRAY_PROFILE, inputFormat: c.TYPE_GRAY_16 },
        { name: 'Lab', profile: 'Lab', inputFormat: c.TYPE_Lab_16 },
    ];

    for (const test of tests) {
        const result = await testTransform(test.name, test.profile, test.inputFormat, c.TYPE_Lab_FLT);
        console.log(`  ${test.name}: ${result ? 'SUCCESS' : 'FAILED'}`);
    }

    console.log('\nTesting 16-bit SE (swap-endian) → Lab Float32:\n');

    const testsSE = [
        { name: 'CMYK', profile: CMYK_PROFILE, inputFormat: c.TYPE_CMYK_16_SE },
        { name: 'RGB', profile: RGB_PROFILE, inputFormat: c.TYPE_RGB_16_SE },
        { name: 'Gray', profile: GRAY_PROFILE, inputFormat: c.TYPE_GRAY_16_SE },
        { name: 'Lab', profile: 'Lab', inputFormat: c.TYPE_Lab_16 | 0x800 }, // TYPE_Lab_16_SE
    ];

    for (const test of testsSE) {
        const result = await testTransform(test.name, test.profile, test.inputFormat, c.TYPE_Lab_FLT);
        console.log(`  ${test.name}: ${result ? 'SUCCESS' : 'FAILED'}`);
    }
}

main().catch(console.error);
