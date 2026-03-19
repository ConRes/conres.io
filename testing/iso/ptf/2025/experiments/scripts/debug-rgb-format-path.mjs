#!/usr/bin/env node
// @ts-check
/**
 * Debug RGB 16-bit → Lab Float32 conversion - why does RGB fail while others work?
 */

import { readFileSync } from 'fs';
import { ColorEngineProvider } from '../../classes/color-engine-provider.js';
import { ColorConversionPolicy } from '../../classes/color-conversion-policy.js';

const PROFILES_DIR = '/Users/daflair/Projects/conres/conres.io/testing/iso/ptf/2025/tests/fixtures/profiles';
const RGB_PROFILE = readFileSync(`${PROFILES_DIR}/sRGB IEC61966-2.1.icc`);

async function main() {
    const provider = new ColorEngineProvider();
    await provider.initialize();
    const constants = provider.getConstants();
    const policy = new ColorConversionPolicy();
    const engine = provider.engine;

    console.log('Debugging RGB 16-bit big-endian → Lab Float32 conversion path\n');

    // Check format returned by policy
    const inputDescriptor = {
        colorSpace: /** @type {'RGB'} */ ('RGB'),
        bitsPerComponent: /** @type {16} */ (16),
        inputBitsPerComponent: /** @type {16} */ (16),
        endianness: /** @type {'big'} */ ('big'),
    };

    const outputDescriptor = {
        colorSpace: /** @type {'Lab'} */ ('Lab'),
        bitsPerComponent: /** @type {16} */ (16),
        outputBitsPerComponent: /** @type {32} */ (32),
        endianness: /** @type {'big'} */ ('big'),
    };

    const inputFormat = policy.getInputFormat(inputDescriptor);
    const outputFormat = policy.getOutputFormat(outputDescriptor);

    console.log('Format analysis:');
    console.log(`  Input format from policy: 0x${inputFormat.toString(16)} (${inputFormat})`);
    console.log(`  TYPE_RGB_16:              0x${constants.TYPE_RGB_16.toString(16)} (${constants.TYPE_RGB_16})`);
    console.log(`  TYPE_RGB_16_SE:           0x${constants.TYPE_RGB_16_SE.toString(16)} (${constants.TYPE_RGB_16_SE})`);
    console.log(`  Output format:            0x${outputFormat.toString(16)} (${outputFormat})`);
    console.log(`  TYPE_Lab_FLT:             0x${constants.TYPE_Lab_FLT.toString(16)} (${constants.TYPE_Lab_FLT})`);

    const ENDIAN16_MASK = 0x800;
    const FLOAT_MASK = 0x400000;

    const inputHasSE = (inputFormat & ENDIAN16_MASK) !== 0;
    const outputHasFloat = (outputFormat & FLOAT_MASK) !== 0;

    console.log(`\n  Input has SE flag: ${inputHasSE}`);
    console.log(`  Output has Float flag: ${outputHasFloat}`);
    console.log(`  Requires byte-swap workaround: ${inputHasSE && outputHasFloat}`);

    // Check if policy format matches TYPE_RGB_16_SE
    console.log(`\n  Policy format === TYPE_RGB_16_SE: ${inputFormat === constants.TYPE_RGB_16_SE}`);
    console.log(`  Policy format === TYPE_RGB_16: ${inputFormat === constants.TYPE_RGB_16}`);

    // Try to create transforms
    console.log('\n--- Testing transform creation ---\n');

    // Open profiles
    const rgbProfile = engine.openProfileFromMem(RGB_PROFILE);
    const labProfile = engine.createLab4Profile();

    // Test 1: TYPE_RGB_16 → TYPE_Lab_FLT (native)
    const transform1 = engine.createTransform(
        rgbProfile,
        constants.TYPE_RGB_16,
        labProfile,
        constants.TYPE_Lab_FLT,
        constants.INTENT_RELATIVE_COLORIMETRIC,
        0
    );
    console.log(`1. TYPE_RGB_16 → TYPE_Lab_FLT: ${transform1 !== 0 ? 'SUCCESS' : 'FAILED'}`);
    if (transform1) engine.deleteTransform(transform1);

    // Test 2: TYPE_RGB_16_SE → TYPE_Lab_FLT (SE)
    const transform2 = engine.createTransform(
        rgbProfile,
        constants.TYPE_RGB_16_SE,
        labProfile,
        constants.TYPE_Lab_FLT,
        constants.INTENT_RELATIVE_COLORIMETRIC,
        0
    );
    console.log(`2. TYPE_RGB_16_SE → TYPE_Lab_FLT: ${transform2 !== 0 ? 'SUCCESS' : 'FAILED'}`);
    if (transform2) engine.deleteTransform(transform2);

    // Test 3: Policy format → TYPE_Lab_FLT
    const transform3 = engine.createTransform(
        rgbProfile,
        inputFormat,
        labProfile,
        constants.TYPE_Lab_FLT,
        constants.INTENT_RELATIVE_COLORIMETRIC,
        0
    );
    console.log(`3. Policy format (0x${inputFormat.toString(16)}) → TYPE_Lab_FLT: ${transform3 !== 0 ? 'SUCCESS' : 'FAILED'}`);
    if (transform3) engine.deleteTransform(transform3);

    // Test 4: Policy format without SE flag
    if (inputHasSE) {
        const formatWithoutSE = inputFormat & ~ENDIAN16_MASK;
        console.log(`\n  Format without SE: 0x${formatWithoutSE.toString(16)} (${formatWithoutSE})`);
        console.log(`  Format without SE === TYPE_RGB_16: ${formatWithoutSE === constants.TYPE_RGB_16}`);

        const transform4 = engine.createTransform(
            rgbProfile,
            formatWithoutSE,
            labProfile,
            constants.TYPE_Lab_FLT,
            constants.INTENT_RELATIVE_COLORIMETRIC,
            0
        );
        console.log(`4. Policy format without SE (0x${formatWithoutSE.toString(16)}) → TYPE_Lab_FLT: ${transform4 !== 0 ? 'SUCCESS' : 'FAILED'}`);
        if (transform4) engine.deleteTransform(transform4);
    }

    engine.closeProfile(rgbProfile);
    engine.closeProfile(labProfile);
    console.log('\nDone.');
}

main().catch(console.error);
