#!/usr/bin/env node
// @ts-check
/**
 * Inspect Color Engine — Consolidated engine inspection and validation CLI.
 *
 * Modes:
 *   --dump-formats              Dump all format constants and policy mappings
 *   --test-format=<colorspace>  Test format resolution for a color space (Gray, RGB, CMYK, Lab)
 *   --test-sampler              Test 16-bit image sampling path
 *   --smoke-test                Smoke test all color spaces with fresh engine
 *   --noise-test                Engine determinism/noise characterization
 *
 * @module inspect-color-engine
 * @author Saleh Abdel Motaal <dev@smotaal.io>
 * @ai Claude Opus 4.6 (code generation)
 */
import { parseArgs } from 'node:util';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKSPACE_2026 = join(__dirname, '..', '..');
const PROFILES_DIR = join(WORKSPACE_2026, 'tests', 'fixtures', 'profiles');

const { values: options } = parseArgs({
    args: process.argv.slice(2).filter(arg => arg.length > 0),
    allowPositionals: true,
    strict: true,
    options: {
        'dump-formats': { type: 'boolean', default: false },
        'test-format': { type: 'string' },
        'test-sampler': { type: 'boolean', default: false },
        'smoke-test': { type: 'boolean', default: false },
        'noise-test': { type: 'boolean', default: false },
        'help': { type: 'boolean', short: 'h', default: false },
    },
});

if (options['help'] || (!options['dump-formats'] && !options['test-format'] && !options['test-sampler'] && !options['smoke-test'] && !options['noise-test'])) {
    console.log(`
Inspect Color Engine — Consolidated engine inspection and validation CLI.

Usage:
  node inspect-color-engine.js <mode> [options]

Modes:
  --dump-formats              Dump all format constants and policy mappings
  --test-format=<colorspace>  Test format resolution for a color space (Gray, RGB, CMYK, Lab)
  --test-sampler              Test 16-bit image sampling path through PDFImageColorSampler
  --smoke-test                Smoke test all color spaces with fresh engine instances
  --noise-test                Engine determinism/noise characterization (comprehensive)

Options:
  -h, --help                  Show this help message

Examples:
  node inspect-color-engine.js --dump-formats
  node inspect-color-engine.js --test-format=Gray
  node inspect-color-engine.js --smoke-test
`);
    process.exit(options['help'] ? 0 : 1);
}

// ============================================================================
// Shared: load provider and policy
// ============================================================================

async function loadProvider() {
    const { ColorEngineProvider } = await import('../../classes/baseline/color-engine-provider.js');
    const provider = new ColorEngineProvider();
    await provider.initialize();
    return provider;
}

async function loadPolicy() {
    const { ColorConversionPolicy } = await import('../../classes/baseline/color-conversion-policy.js');
    return new ColorConversionPolicy();
}

async function loadProfiles() {
    const [rgb, cmyk, gray] = await Promise.all([
        readFile(join(PROFILES_DIR, 'sRGB IEC61966-2.1.icc')),
        readFile(join(PROFILES_DIR, 'eciCMYK v2.icc')),
        readFile(join(PROFILES_DIR, 'sGray.icc')),
    ]);
    return { rgb, cmyk, gray };
}

// ============================================================================
// Mode: --dump-formats
// ============================================================================

async function dumpFormats() {
    const policy = await loadPolicy();
    const provider = await loadProvider();
    const constants = provider.getConstants();

    console.log('Format constants for 16-bit big-endian input → Lab Float32 output:\n');

    const colorSpaces = ['CMYK', 'RGB', 'Gray', 'Lab'];
    const ENDIAN16_MASK = 0x800;
    const FLOAT_MASK = 0x400000;

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

            const inputHasSE = (inputFormat & ENDIAN16_MASK) !== 0;
            const outputHasFloat = (outputFormat & FLOAT_MASK) !== 0;

            console.log(`  Input format:  0x${inputFormat.toString(16)} (${inputFormat})`);
            console.log(`  Output format: 0x${outputFormat.toString(16)} (${outputFormat})`);
            console.log(`  Input SE flag: ${inputHasSE}`);
            console.log(`  Output FLT flag: ${outputHasFloat}`);

            if (inputHasSE) {
                const formatWithoutSE = inputFormat & ~ENDIAN16_MASK;
                console.log(`  Format after removing SE: 0x${formatWithoutSE.toString(16)} (${formatWithoutSE})`);
            }
        } catch (error) {
            console.log(`  Error: ${/** @type {Error} */ (error).message}`);
        }
        console.log();
    }

    console.log('Reference TYPE_* constants:');
    for (const name of ['TYPE_CMYK_16', 'TYPE_CMYK_16_SE', 'TYPE_RGB_16', 'TYPE_RGB_16_SE', 'TYPE_GRAY_16', 'TYPE_GRAY_16_SE', 'TYPE_Lab_16', 'TYPE_Lab_FLT']) {
        const value = constants[name];
        console.log(`  ${name}: 0x${value.toString(16)} (${value})`);
    }
}

// ============================================================================
// Mode: --test-format=<colorspace>
// ============================================================================

async function testFormat(colorSpace) {
    const policy = await loadPolicy();
    const provider = await loadProvider();
    const engine = provider.engine;
    const constants = provider.getConstants();
    const profiles = await loadProfiles();

    console.log(`Debugging ${colorSpace} format handling:\n`);

    const inputDescriptor = {
        colorSpace: /** @type {any} */ (colorSpace),
        bitsPerComponent: /** @type {16} */ (16),
        inputBitsPerComponent: /** @type {16} */ (16),
        endianness: /** @type {'big'} */ ('big'),
    };

    const inputFormat = policy.getInputFormat(inputDescriptor);
    const ENDIAN16_MASK = 0x800;
    const hasEndianFlag = (inputFormat & ENDIAN16_MASK) !== 0;
    const formatWithoutSE = inputFormat & ~ENDIAN16_MASK;

    console.log(`Input format: 0x${inputFormat.toString(16)} (${inputFormat})`);
    console.log(`Has ENDIAN16 flag: ${hasEndianFlag}`);
    console.log(`Format after removing SE: 0x${formatWithoutSE.toString(16)} (${formatWithoutSE})`);

    // Test transform creation
    console.log('\n--- Testing transform creation ---');

    const profileMap = { Gray: profiles.gray, RGB: profiles.rgb, CMYK: profiles.cmyk };
    const profileBuffer = profileMap[colorSpace];
    const sourceProfile = profileBuffer
        ? engine.openProfileFromMem(profileBuffer)
        : colorSpace === 'Lab' ? engine.createLab4Profile() : null;

    if (!sourceProfile) {
        console.log(`  No profile available for ${colorSpace}`);
        return;
    }

    const labProfile = engine.createLab4Profile();

    for (const [label, format] of [['Native 16-bit', formatWithoutSE], ['SE 16-bit', inputFormat]]) {
        const transform = engine.createTransform(
            sourceProfile, format, labProfile, constants.TYPE_Lab_FLT,
            constants.INTENT_RELATIVE_COLORIMETRIC, constants.cmsFLAGS_BLACKPOINTCOMPENSATION,
        );
        console.log(`  ${label} (0x${format.toString(16)}) → Lab FLT: ${transform !== 0 ? 'SUCCESS' : 'FAILED'}`);
    }
}

// ============================================================================
// Mode: --smoke-test
// ============================================================================

async function smokeTest() {
    const provider = await loadProvider();
    const constants = provider.getConstants();
    const profiles = await loadProfiles();

    console.log('Testing 16-bit NATIVE (no SE) → Lab Float32:\n');

    const tests = [
        { name: 'CMYK', profile: profiles.cmyk, inputFormat: constants.TYPE_CMYK_16 },
        { name: 'RGB', profile: profiles.rgb, inputFormat: constants.TYPE_RGB_16 },
        { name: 'Gray', profile: profiles.gray, inputFormat: constants.TYPE_GRAY_16 },
        { name: 'Lab', profile: 'Lab', inputFormat: constants.TYPE_Lab_16 },
    ];

    for (const test of tests) {
        const p = new (await import('../../classes/baseline/color-engine-provider.js')).ColorEngineProvider();
        await p.initialize();
        const engine = p.engine;

        const sourceProfile = test.profile === 'Lab'
            ? engine.createLab4Profile()
            : engine.openProfileFromMem(test.profile);
        const destProfile = engine.createLab4Profile();

        const transform = engine.createTransform(
            sourceProfile, test.inputFormat, destProfile, constants.TYPE_Lab_FLT,
            constants.INTENT_RELATIVE_COLORIMETRIC, constants.cmsFLAGS_BLACKPOINTCOMPENSATION,
        );
        console.log(`  ${test.name}: ${transform !== 0 ? 'SUCCESS' : 'FAILED'}`);
    }

    console.log('\nTesting 16-bit SE (swap-endian) → Lab Float32:\n');

    const testsSE = [
        { name: 'CMYK', profile: profiles.cmyk, inputFormat: constants.TYPE_CMYK_16_SE },
        { name: 'RGB', profile: profiles.rgb, inputFormat: constants.TYPE_RGB_16_SE },
        { name: 'Gray', profile: profiles.gray, inputFormat: constants.TYPE_GRAY_16_SE },
        { name: 'Lab', profile: 'Lab', inputFormat: constants.TYPE_Lab_16 | 0x800 },
    ];

    for (const test of testsSE) {
        const p = new (await import('../../classes/baseline/color-engine-provider.js')).ColorEngineProvider();
        await p.initialize();
        const engine = p.engine;

        const sourceProfile = test.profile === 'Lab'
            ? engine.createLab4Profile()
            : engine.openProfileFromMem(test.profile);
        const destProfile = engine.createLab4Profile();

        const transform = engine.createTransform(
            sourceProfile, test.inputFormat, destProfile, constants.TYPE_Lab_FLT,
            constants.INTENT_RELATIVE_COLORIMETRIC, constants.cmsFLAGS_BLACKPOINTCOMPENSATION,
        );
        console.log(`  ${test.name}: ${transform !== 0 ? 'SUCCESS' : 'FAILED'}`);
    }
}

// ============================================================================
// Mode: --test-sampler
// ============================================================================

async function testSampler() {
    const profiles = await loadProfiles();
    const { PDFImageColorSampler } = await import('../../classes/baseline/pdf-image-color-sampler.js');

    /** @param {Buffer} buffer */
    function bufferToArrayBuffer(buffer) {
        return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    }

    function createTestBuffer(channels, numPixels = 5) {
        const buffer = new Uint8Array(numPixels * channels * 2);
        for (let p = 0; p < numPixels; p++) {
            for (let c = 0; c < channels; c++) {
                const idx = (p * channels + c) * 2;
                buffer[idx] = 0x80;
                buffer[idx + 1] = 0x00;
            }
        }
        return buffer;
    }

    console.log('Testing PDFImageColorSampler with 16-bit big-endian input → Lab Float32\n');

    const sampler = new PDFImageColorSampler({
        destinationProfile: 'Lab',
        destinationColorSpace: 'Lab',
    });
    await sampler.ensureReady();

    const tests = [
        { name: 'RGB', colorSpace: 'RGB', channels: 3, profile: bufferToArrayBuffer(profiles.rgb) },
        { name: 'CMYK', colorSpace: 'CMYK', channels: 4, profile: bufferToArrayBuffer(profiles.cmyk) },
        { name: 'Gray', colorSpace: 'Gray', channels: 1, profile: bufferToArrayBuffer(profiles.gray) },
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

            if (!(result.labValues instanceof Float32Array)) {
                console.log(`  ERROR: Expected Float32Array, got ${result.labValues.constructor.name}`);
                continue;
            }

            const L = result.labValues[0];
            const a = result.labValues[1];
            const b = result.labValues[2];

            const validL = L >= 0 && L <= 100;
            const validA = a >= -130 && a <= 130;
            const validB = b >= -130 && b <= 130;

            if (!validL || !validA || !validB) {
                console.log(`  WARNING: Lab values may be corrupted: L=${L.toFixed(2)}, a=${a.toFixed(2)}, b=${b.toFixed(2)}`);
            } else {
                console.log(`  SUCCESS: L=${L.toFixed(2)}, a=${a.toFixed(2)}, b=${b.toFixed(2)}`);
            }
        } catch (error) {
            console.log(`  FAILED: ${/** @type {Error} */ (error).message}`);
        }
        console.log('');
    }

    sampler.dispose();
}

// ============================================================================
// Mode: --noise-test
// ============================================================================

async function noiseTest() {
    // The noise test is comprehensive (35KB) — delegate to the original script
    // which imports directly from packages/color-engine/
    const noisePath = join(__dirname, '..', '..', '2025', 'experiments', 'scripts', 'test-color-engine-noise.js');
    try {
        await import(noisePath);
    } catch (error) {
        console.error(`Error: Could not load noise test from ${noisePath}`);
        console.error(`  ${/** @type {Error} */ (error).message}`);
        console.error(`\nThe noise test script must be available at:`);
        console.error(`  testing/iso/ptf/2025/experiments/scripts/test-color-engine-noise.js`);
        process.exit(1);
    }
}

// ============================================================================
// Dispatch
// ============================================================================

async function main() {
    if (options['dump-formats']) await dumpFormats();
    else if (options['test-format']) await testFormat(options['test-format']);
    else if (options['test-sampler']) await testSampler();
    else if (options['smoke-test']) await smokeTest();
    else if (options['noise-test']) await noiseTest();
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
