#!/usr/bin/env node
// @ts-check
/**
 * Debug format constants for all color spaces
 */

import { ColorConversionPolicy } from '../../classes/color-conversion-policy.js';
import { ColorEngineProvider } from '../../classes/color-engine-provider.js';

async function main() {
    const policy = new ColorConversionPolicy();
    const provider = new ColorEngineProvider();
    await provider.initialize();
    const constants = provider.getConstants();

    console.log('Format constants for 16-bit big-endian input → Lab Float32 output:\n');

    const colorSpaces = ['CMYK', 'RGB', 'Gray', 'Lab'];

    for (const cs of colorSpaces) {
        console.log(`=== ${cs} ===`);

        const inputDescriptor = {
            colorSpace: /** @type {any} */ (cs),
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

        try {
            const inputFormat = policy.getInputFormat(inputDescriptor);
            const outputFormat = policy.getOutputFormat(outputDescriptor);

            // Check format flags
            const ENDIAN16_MASK = 0x800;
            const FLOAT_MASK = 0x400000;

            const inputHasSE = (inputFormat & ENDIAN16_MASK) !== 0;
            const outputHasFloat = (outputFormat & FLOAT_MASK) !== 0;

            console.log(`  Input format:  0x${inputFormat.toString(16)} (${inputFormat})`);
            console.log(`  Output format: 0x${outputFormat.toString(16)} (${outputFormat})`);
            console.log(`  Input SE flag: ${inputHasSE}`);
            console.log(`  Output FLT flag: ${outputHasFloat}`);
            console.log(`  Would trigger byte-swap workaround: ${inputHasSE && outputHasFloat}`);

            // Check if format without SE flag exists
            if (inputHasSE) {
                const formatWithoutSE = inputFormat & ~ENDIAN16_MASK;
                console.log(`  Format after removing SE: 0x${formatWithoutSE.toString(16)} (${formatWithoutSE})`);
            }
        } catch (error) {
            console.log(`  Error: ${error.message}`);
        }
        console.log();
    }

    // Show reference constants
    console.log('Reference TYPE_* constants:');
    console.log(`  TYPE_CMYK_16: 0x${constants.TYPE_CMYK_16.toString(16)} (${constants.TYPE_CMYK_16})`);
    console.log(`  TYPE_CMYK_16_SE: 0x${constants.TYPE_CMYK_16_SE.toString(16)} (${constants.TYPE_CMYK_16_SE})`);
    console.log(`  TYPE_RGB_16: 0x${constants.TYPE_RGB_16.toString(16)} (${constants.TYPE_RGB_16})`);
    console.log(`  TYPE_RGB_16_SE: 0x${constants.TYPE_RGB_16_SE.toString(16)} (${constants.TYPE_RGB_16_SE})`);
    console.log(`  TYPE_GRAY_16: 0x${constants.TYPE_GRAY_16.toString(16)} (${constants.TYPE_GRAY_16})`);
    console.log(`  TYPE_GRAY_16_SE: 0x${constants.TYPE_GRAY_16_SE.toString(16)} (${constants.TYPE_GRAY_16_SE})`);
    console.log(`  TYPE_Lab_16: 0x${constants.TYPE_Lab_16.toString(16)} (${constants.TYPE_Lab_16})`);
    console.log(`  TYPE_Lab_FLT: 0x${constants.TYPE_Lab_FLT.toString(16)} (${constants.TYPE_Lab_FLT})`);
}

main().catch(console.error);
