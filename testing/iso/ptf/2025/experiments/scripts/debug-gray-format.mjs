#!/usr/bin/env node
// @ts-check
/**
 * Debug Gray format to understand why byte-swap workaround fails
 */

import { readFileSync } from 'fs';
import { ColorConversionPolicy } from '../../classes/color-conversion-policy.js';
import { ColorEngineProvider } from '../../classes/color-engine-provider.js';

const PROFILES_DIR = '/Users/daflair/Projects/conres/conres.io/testing/iso/ptf/2025/tests/fixtures/profiles';
const GRAY_PROFILE = readFileSync(`${PROFILES_DIR}/sGray.icc`);

async function main() {
    const policy = new ColorConversionPolicy();
    const provider = new ColorEngineProvider();
    await provider.initialize();
    const engine = provider.engine;
    const constants = provider.getConstants();

    console.log('Debugging Gray format handling:\n');

    // Get the input format
    const inputDescriptor = {
        colorSpace: /** @type {'Gray'} */ ('Gray'),
        bitsPerComponent: /** @type {16} */ (16),
        inputBitsPerComponent: /** @type {16} */ (16),
        endianness: /** @type {'big'} */ ('big'),
    };

    const inputFormat = policy.getInputFormat(inputDescriptor);
    console.log(`Input format: 0x${inputFormat.toString(16)} (${inputFormat})`);
    console.log(`TYPE_GRAY_16: 0x${constants.TYPE_GRAY_16.toString(16)} (${constants.TYPE_GRAY_16})`);
    console.log(`TYPE_GRAY_16_SE: 0x${constants.TYPE_GRAY_16_SE.toString(16)} (${constants.TYPE_GRAY_16_SE})`);

    const ENDIAN16_MASK = 0x800;
    const hasEndianFlag = (inputFormat & ENDIAN16_MASK) !== 0;
    console.log(`\nHas ENDIAN16 flag: ${hasEndianFlag}`);

    // Format after removing SE flag
    const formatWithoutSE = inputFormat & ~ENDIAN16_MASK;
    console.log(`Format after removing SE: 0x${formatWithoutSE.toString(16)} (${formatWithoutSE})`);
    console.log(`Matches TYPE_GRAY_16: ${formatWithoutSE === constants.TYPE_GRAY_16}`);

    // Test transform creation with native format
    console.log('\n--- Testing transform creation ---');

    const grayProfile = engine.openProfileFromMem(GRAY_PROFILE);
    const labProfile = engine.createLab4Profile();

    console.log(`Gray profile handle: ${grayProfile}`);
    console.log(`Lab profile handle: ${labProfile}`);

    // Try with native 16-bit
    const transform1 = engine.createTransform(
        grayProfile,
        constants.TYPE_GRAY_16,
        labProfile,
        constants.TYPE_Lab_FLT,
        constants.INTENT_RELATIVE_COLORIMETRIC,
        constants.cmsFLAGS_BLACKPOINTCOMPENSATION
    );
    console.log(`\nNative 16-bit → Lab FLT: ${transform1 !== 0 ? 'SUCCESS' : 'FAILED'}`);

    // Try with SE 16-bit
    const transform2 = engine.createTransform(
        grayProfile,
        constants.TYPE_GRAY_16_SE,
        labProfile,
        constants.TYPE_Lab_FLT,
        constants.INTENT_RELATIVE_COLORIMETRIC,
        constants.cmsFLAGS_BLACKPOINTCOMPENSATION
    );
    console.log(`SE 16-bit → Lab FLT: ${transform2 !== 0 ? 'SUCCESS' : 'FAILED'}`);

    // Try with computed format without SE
    const transform3 = engine.createTransform(
        grayProfile,
        formatWithoutSE,
        labProfile,
        constants.TYPE_Lab_FLT,
        constants.INTENT_RELATIVE_COLORIMETRIC,
        constants.cmsFLAGS_BLACKPOINTCOMPENSATION
    );
    console.log(`Computed format (0x${formatWithoutSE.toString(16)}) → Lab FLT: ${transform3 !== 0 ? 'SUCCESS' : 'FAILED'}`);

    // Check if the profile is valid
    console.log('\n--- Profile info ---');
    const colorSpaceOfProfile = engine.getProfileColorSpace?.(grayProfile);
    console.log(`Profile color space: ${colorSpaceOfProfile ?? 'N/A (method not available)'}`);
}

main().catch(console.error);
