#!/usr/bin/env node
// @ts-check
/**
 * Debug Lab 16-bit → Lab Float32 precision to understand unique color discrepancy
 *
 * Theory: Lab 16-bit SE → Lab Float32 conversion may be losing precision,
 * causing the original Lab to show fewer unique colors than the CMYK output.
 */

import { ColorEngineProvider } from '../../classes/color-engine-provider.js';
import { ColorConversionPolicy } from '../../classes/color-conversion-policy.js';

async function main() {
    const provider = new ColorEngineProvider();
    await provider.initialize();
    const constants = provider.getConstants();
    const policy = new ColorConversionPolicy();
    const engine = provider.engine;

    console.log('Testing Lab 16-bit → Lab Float32 precision\n');

    // Create Lab 16-bit test data with known values
    // Lab 16-bit encoding: L: 0-100 maps to 0-65535, a/b: -128 to 127 maps to 0-65535 (midpoint = 32768)
    const labProfile = engine.createLab4Profile();

    // Test case 1: Native endian (no byte-swap)
    console.log('Test 1: Lab 16-bit (native endian) → Lab Float32');
    const nativeTransform = engine.createTransform(
        labProfile,
        constants.TYPE_Lab_16,
        labProfile,
        constants.TYPE_Lab_FLT,
        constants.INTENT_RELATIVE_COLORIMETRIC,
        0
    );
    console.log(`  Transform: ${nativeTransform !== 0 ? 'SUCCESS' : 'FAILED'}`);

    if (nativeTransform) {
        // Create test data: L=50, a=0, b=0 (encoded as Lab 16-bit)
        // L=50 → (50/100) * 65535 = 32768 (0x8000)
        // a=0 → ((0+128)/256) * 65535 = 32768 (0x8000)
        // b=0 → ((0+128)/256) * 65535 = 32768 (0x8000)
        const input = new Uint16Array([32768, 32768, 32768]); // L=50, a=0, b=0
        const output = new Float32Array(3);
        engine.doTransform(nativeTransform, input, output, 1);
        console.log(`  Input: L16=${input[0]}, a16=${input[1]}, b16=${input[2]}`);
        console.log(`  Output: L=${output[0].toFixed(4)}, a=${output[1].toFixed(4)}, b=${output[2].toFixed(4)}`);
        console.log(`  Expected: L≈50, a≈0, b≈0`);
        engine.deleteTransform(nativeTransform);
    }

    // Test case 2: Swap-endian (requires byte-swap workaround)
    console.log('\nTest 2: Lab 16-bit (swap-endian via manual byte-swap) → Lab Float32');
    // PDF uses big-endian 16-bit. We simulate this by creating BE data and then swapping it.

    // Create big-endian Lab data: L=50, a=0, b=0
    const beData = new Uint8Array([
        0x80, 0x00,  // L = 0x8000 in big-endian
        0x80, 0x00,  // a = 0x8000 in big-endian
        0x80, 0x00,  // b = 0x8000 in big-endian
    ]);

    // Byte-swap to little-endian (as the workaround does)
    const swapped = new Uint8Array(beData.length);
    for (let i = 0; i < beData.length; i += 2) {
        swapped[i] = beData[i + 1];
        swapped[i + 1] = beData[i];
    }

    // Interpret as Uint16Array
    const swappedU16 = new Uint16Array(swapped.buffer);
    console.log(`  BE input bytes: [${Array.from(beData).join(', ')}]`);
    console.log(`  LE swapped bytes: [${Array.from(swapped).join(', ')}]`);
    console.log(`  Swapped Uint16: [${swappedU16[0]}, ${swappedU16[1]}, ${swappedU16[2]}]`);

    // Use native endian transform (since we already swapped)
    const nativeTransform2 = engine.createTransform(
        labProfile,
        constants.TYPE_Lab_16,
        labProfile,
        constants.TYPE_Lab_FLT,
        constants.INTENT_RELATIVE_COLORIMETRIC,
        0
    );

    if (nativeTransform2) {
        const output2 = new Float32Array(3);
        engine.doTransform(nativeTransform2, swappedU16, output2, 1);
        console.log(`  Output: L=${output2[0].toFixed(4)}, a=${output2[1].toFixed(4)}, b=${output2[2].toFixed(4)}`);
        console.log(`  Expected: L≈50, a≈0, b≈0`);
        engine.deleteTransform(nativeTransform2);
    }

    // Test case 3: Multiple distinct Lab values to check uniqueness
    console.log('\nTest 3: Multiple Lab values → check uniqueness preservation');

    const numTestValues = 1000;
    const inputLabU16 = new Uint16Array(numTestValues * 3);
    const uniqueInputKeys = new Set();

    // Generate random Lab 16-bit values
    for (let i = 0; i < numTestValues; i++) {
        const L = Math.floor(Math.random() * 65536);
        const a = Math.floor(Math.random() * 65536);
        const b = Math.floor(Math.random() * 65536);
        inputLabU16[i * 3] = L;
        inputLabU16[i * 3 + 1] = a;
        inputLabU16[i * 3 + 2] = b;

        // Track unique input (rounded to same precision as output tracking)
        const Lf = (L / 65535) * 100;
        const af = ((a / 65535) * 256) - 128;
        const bf = ((b / 65535) * 256) - 128;
        const key = `${Math.round(Lf * 10)},${Math.round(af * 10)},${Math.round(bf * 10)}`;
        uniqueInputKeys.add(key);
    }

    console.log(`  Generated ${numTestValues} Lab 16-bit values`);
    console.log(`  Unique input Lab keys (0.1 precision): ${uniqueInputKeys.size}`);

    // Convert through engine
    const nativeTransform3 = engine.createTransform(
        labProfile,
        constants.TYPE_Lab_16,
        labProfile,
        constants.TYPE_Lab_FLT,
        constants.INTENT_RELATIVE_COLORIMETRIC,
        0
    );

    if (nativeTransform3) {
        const outputLabF32 = new Float32Array(numTestValues * 3);
        engine.doTransform(nativeTransform3, inputLabU16, outputLabF32, numTestValues);

        const uniqueOutputKeys = new Set();
        for (let i = 0; i < numTestValues; i++) {
            const L = outputLabF32[i * 3];
            const a = outputLabF32[i * 3 + 1];
            const b = outputLabF32[i * 3 + 2];
            const key = `${Math.round(L * 10)},${Math.round(a * 10)},${Math.round(b * 10)}`;
            uniqueOutputKeys.add(key);
        }

        console.log(`  Unique output Lab keys (0.1 precision): ${uniqueOutputKeys.size}`);
        console.log(`  Difference: ${uniqueInputKeys.size - uniqueOutputKeys.size}`);

        if (uniqueInputKeys.size !== uniqueOutputKeys.size) {
            console.log(`  WARNING: Unique color count changed during conversion!`);
        } else {
            console.log(`  OK: Unique color count preserved`);
        }

        engine.deleteTransform(nativeTransform3);
    }

    engine.closeProfile(labProfile);
    console.log('\nDone.');
}

main().catch(console.error);
