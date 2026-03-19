#!/usr/bin/env node
// @ts-check
/**
 * Debug Lab 16-bit → Lab Float32 conversion to understand unique color discrepancy
 *
 * Tests whether the Lab → Lab identity conversion is losing colors due to
 * the 16-bit SE → Float limitation in LittleCMS.
 */

import { ColorEngineProvider } from '../../classes/color-engine-provider.js';
import { ColorConversionPolicy } from '../../classes/color-conversion-policy.js';

async function main() {
    const provider = new ColorEngineProvider();
    await provider.initialize();
    const constants = provider.getConstants();
    const policy = new ColorConversionPolicy();

    console.log('Debugging Lab 16-bit big-endian → Lab Float32 conversion path\n');

    // Check what format is returned for Lab 16-bit big-endian input
    const inputDescriptor = {
        colorSpace: /** @type {'Lab'} */ ('Lab'),
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
    console.log(`  Input format:  0x${inputFormat.toString(16)} (${inputFormat})`);
    console.log(`  Output format: 0x${outputFormat.toString(16)} (${outputFormat})`);
    console.log(`  TYPE_Lab_16:   0x${constants.TYPE_Lab_16.toString(16)} (${constants.TYPE_Lab_16})`);
    console.log(`  TYPE_Lab_FLT:  0x${constants.TYPE_Lab_FLT.toString(16)} (${constants.TYPE_Lab_FLT})`);

    const ENDIAN16_MASK = 0x800;
    const FLOAT_MASK = 0x400000;

    const inputHasSE = (inputFormat & ENDIAN16_MASK) !== 0;
    const outputHasFloat = (outputFormat & FLOAT_MASK) !== 0;

    console.log(`\n  Input has SE flag: ${inputHasSE}`);
    console.log(`  Output has Float flag: ${outputHasFloat}`);
    console.log(`  Requires byte-swap workaround: ${inputHasSE && outputHasFloat}`);

    // Try to create the transform directly
    console.log('\n--- Testing direct transform creation ---\n');

    const engine = provider.engine;
    const labProfile = engine.createLab4Profile();

    // Test 1: TYPE_Lab_16 → TYPE_Lab_FLT (native endian)
    const transform1 = engine.createTransform(
        labProfile,
        constants.TYPE_Lab_16,
        labProfile,
        constants.TYPE_Lab_FLT,
        constants.INTENT_RELATIVE_COLORIMETRIC,
        0
    );
    console.log(`1. TYPE_Lab_16 → TYPE_Lab_FLT: ${transform1 !== 0 ? 'SUCCESS' : 'FAILED'}`);
    if (transform1) engine.deleteTransform(transform1);

    // Test 2: TYPE_Lab_16_SE → TYPE_Lab_FLT (swap-endian, no workaround)
    const TYPE_Lab_16_SE = constants.TYPE_Lab_16 | ENDIAN16_MASK;
    const transform2 = engine.createTransform(
        labProfile,
        TYPE_Lab_16_SE,
        labProfile,
        constants.TYPE_Lab_FLT,
        constants.INTENT_RELATIVE_COLORIMETRIC,
        0
    );
    console.log(`2. TYPE_Lab_16_SE → TYPE_Lab_FLT: ${transform2 !== 0 ? 'SUCCESS' : 'FAILED'}`);
    if (transform2) engine.deleteTransform(transform2);

    // Test 3: Use the policy-returned format
    const transform3 = engine.createTransform(
        labProfile,
        inputFormat,
        labProfile,
        outputFormat,
        constants.INTENT_RELATIVE_COLORIMETRIC,
        0
    );
    console.log(`3. Policy format (0x${inputFormat.toString(16)}) → Output format (0x${outputFormat.toString(16)}): ${transform3 !== 0 ? 'SUCCESS' : 'FAILED'}`);
    if (transform3) engine.deleteTransform(transform3);

    // Test 4: What if we remove the SE flag from the policy format?
    if (inputHasSE) {
        const formatWithoutSE = inputFormat & ~ENDIAN16_MASK;
        const transform4 = engine.createTransform(
            labProfile,
            formatWithoutSE,
            labProfile,
            outputFormat,
            constants.INTENT_RELATIVE_COLORIMETRIC,
            0
        );
        console.log(`4. Policy format without SE (0x${formatWithoutSE.toString(16)}) → Output format: ${transform4 !== 0 ? 'SUCCESS' : 'FAILED'}`);
        if (transform4) engine.deleteTransform(transform4);
    }

    engine.closeProfile(labProfile);
    console.log('\nDone.');
}

main().catch(console.error);
