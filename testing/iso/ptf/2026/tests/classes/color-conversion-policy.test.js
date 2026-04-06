// @ts-check
/**
 * Tests for ColorConversionPolicy
 *
 * Run with: node --test testing/iso/ptf/2025/tests/ColorConversionPolicy.test.js
 */

import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
    ColorConversionPolicy,
    TYPE_GRAY_8,
    TYPE_GRAY_16,
    TYPE_GRAY_16_SE,
    TYPE_GRAY_FLT,
    TYPE_GRAYA_8,
    TYPE_GRAYA_16,
    TYPE_GRAYA_16_SE,
    TYPE_RGB_8,
    TYPE_RGB_16,
    TYPE_RGB_16_SE,
    TYPE_RGB_FLT,
    TYPE_BGR_8,
    TYPE_BGR_16,
    TYPE_BGR_16_SE,
    TYPE_RGBA_8,
    TYPE_RGBA_16,
    TYPE_RGBA_16_SE,
    TYPE_ARGB_8,
    TYPE_BGRA_8,
    TYPE_CMYK_8,
    TYPE_CMYK_16,
    TYPE_CMYK_16_SE,
    TYPE_CMYK_FLT,
    TYPE_KYMC_8,
    TYPE_KYMC_16,
    TYPE_KYMC_16_SE,
    TYPE_Lab_8,
    TYPE_Lab_16,
    TYPE_Lab_16_SE,
    TYPE_Lab_FLT,
} from '../../classes/baseline/color-conversion-policy.js';

// ============================================================================
// Test Data: All Format Scenarios
// ============================================================================

/**
 * Comprehensive test cases for format resolution.
 * Each entry maps an input descriptor to the expected output format.
 *
 * @type {Array<{
 *   inputDescriptor: import('../../classes/baseline/color-conversion-policy.js').PixelFormatDescriptor,
 *   outputDescriptor: import('../../classes/baseline/color-conversion-policy.js').PixelFormatDescriptor,
 *   inputFormat: number,
 *   outputFormat: number,
 *   description: string,
 * }>}
 */
const FORMAT_SCENARIOS = [
    // ========================================
    // Grayscale Formats
    // ========================================
    {
        inputDescriptor: { colorSpace: 'Gray', bitsPerComponent: 8 },
        outputDescriptor: { colorSpace: 'CMYK', bitsPerComponent: 8 },
        inputFormat: TYPE_GRAY_8,
        outputFormat: TYPE_CMYK_8,
        description: 'Gray 8-bit → CMYK 8-bit',
    },
    {
        inputDescriptor: { colorSpace: 'Gray', bitsPerComponent: 16, endianness: 'big' },
        outputDescriptor: { colorSpace: 'CMYK', bitsPerComponent: 16, endianness: 'big' },
        inputFormat: TYPE_GRAY_16_SE,
        outputFormat: TYPE_CMYK_16_SE,
        description: 'Gray 16-bit big-endian → CMYK 16-bit big-endian',
    },
    {
        inputDescriptor: { colorSpace: 'Gray', bitsPerComponent: 16, endianness: 'little' },
        outputDescriptor: { colorSpace: 'CMYK', bitsPerComponent: 16, endianness: 'little' },
        inputFormat: TYPE_GRAY_16,
        outputFormat: TYPE_CMYK_16,
        description: 'Gray 16-bit little-endian → CMYK 16-bit little-endian',
    },
    {
        inputDescriptor: { colorSpace: 'Gray', bitsPerComponent: 32 },
        outputDescriptor: { colorSpace: 'CMYK', bitsPerComponent: 32 },
        inputFormat: TYPE_GRAY_FLT,
        outputFormat: TYPE_CMYK_FLT,
        description: 'Gray 32-bit float → CMYK 32-bit float',
    },
    {
        inputDescriptor: { colorSpace: 'Gray', bitsPerComponent: 8, hasAlpha: true },
        outputDescriptor: { colorSpace: 'RGB', bitsPerComponent: 8 },
        inputFormat: TYPE_GRAYA_8,
        outputFormat: TYPE_RGB_8,
        description: 'GrayA 8-bit → RGB 8-bit',
    },
    {
        inputDescriptor: { colorSpace: 'Gray', bitsPerComponent: 16, hasAlpha: true, endianness: 'big' },
        outputDescriptor: { colorSpace: 'RGB', bitsPerComponent: 16, endianness: 'big' },
        inputFormat: TYPE_GRAYA_16_SE,
        outputFormat: TYPE_RGB_16_SE,
        description: 'GrayA 16-bit big-endian → RGB 16-bit big-endian',
    },

    // ========================================
    // RGB Formats
    // ========================================
    {
        inputDescriptor: { colorSpace: 'RGB', bitsPerComponent: 8 },
        outputDescriptor: { colorSpace: 'CMYK', bitsPerComponent: 8 },
        inputFormat: TYPE_RGB_8,
        outputFormat: TYPE_CMYK_8,
        description: 'RGB 8-bit → CMYK 8-bit',
    },
    {
        inputDescriptor: { colorSpace: 'RGB', bitsPerComponent: 16, endianness: 'big' },
        outputDescriptor: { colorSpace: 'CMYK', bitsPerComponent: 16, endianness: 'big' },
        inputFormat: TYPE_RGB_16_SE,
        outputFormat: TYPE_CMYK_16_SE,
        description: 'RGB 16-bit big-endian → CMYK 16-bit big-endian (PDF standard)',
    },
    {
        inputDescriptor: { colorSpace: 'RGB', bitsPerComponent: 16, endianness: 'little' },
        outputDescriptor: { colorSpace: 'CMYK', bitsPerComponent: 16, endianness: 'little' },
        inputFormat: TYPE_RGB_16,
        outputFormat: TYPE_CMYK_16,
        description: 'RGB 16-bit little-endian → CMYK 16-bit little-endian',
    },
    {
        inputDescriptor: { colorSpace: 'RGB', bitsPerComponent: 32 },
        outputDescriptor: { colorSpace: 'CMYK', bitsPerComponent: 32 },
        inputFormat: TYPE_RGB_FLT,
        outputFormat: TYPE_CMYK_FLT,
        description: 'RGB 32-bit float → CMYK 32-bit float',
    },
    {
        inputDescriptor: { colorSpace: 'RGB', bitsPerComponent: 8, channelOrder: 'BGR' },
        outputDescriptor: { colorSpace: 'CMYK', bitsPerComponent: 8 },
        inputFormat: TYPE_BGR_8,
        outputFormat: TYPE_CMYK_8,
        description: 'BGR 8-bit → CMYK 8-bit',
    },
    {
        inputDescriptor: { colorSpace: 'RGB', bitsPerComponent: 16, channelOrder: 'BGR', endianness: 'big' },
        outputDescriptor: { colorSpace: 'CMYK', bitsPerComponent: 16, endianness: 'big' },
        inputFormat: TYPE_BGR_16_SE,
        outputFormat: TYPE_CMYK_16_SE,
        description: 'BGR 16-bit big-endian → CMYK 16-bit big-endian',
    },
    {
        inputDescriptor: { colorSpace: 'RGB', bitsPerComponent: 8, hasAlpha: true },
        outputDescriptor: { colorSpace: 'CMYK', bitsPerComponent: 8 },
        inputFormat: TYPE_RGBA_8,
        outputFormat: TYPE_CMYK_8,
        description: 'RGBA 8-bit → CMYK 8-bit',
    },
    {
        inputDescriptor: { colorSpace: 'RGB', bitsPerComponent: 16, hasAlpha: true, endianness: 'big' },
        outputDescriptor: { colorSpace: 'CMYK', bitsPerComponent: 16, endianness: 'big' },
        inputFormat: TYPE_RGBA_16_SE,
        outputFormat: TYPE_CMYK_16_SE,
        description: 'RGBA 16-bit big-endian → CMYK 16-bit big-endian',
    },
    {
        inputDescriptor: { colorSpace: 'RGB', bitsPerComponent: 8, hasAlpha: true, alphaFirst: true },
        outputDescriptor: { colorSpace: 'CMYK', bitsPerComponent: 8 },
        inputFormat: TYPE_ARGB_8,
        outputFormat: TYPE_CMYK_8,
        description: 'ARGB 8-bit → CMYK 8-bit',
    },
    {
        inputDescriptor: { colorSpace: 'RGB', bitsPerComponent: 8, channelOrder: 'BGRA' },
        outputDescriptor: { colorSpace: 'CMYK', bitsPerComponent: 8 },
        inputFormat: TYPE_BGRA_8,
        outputFormat: TYPE_CMYK_8,
        description: 'BGRA 8-bit → CMYK 8-bit',
    },

    // ========================================
    // CMYK Formats (both directions)
    // ========================================
    {
        inputDescriptor: { colorSpace: 'CMYK', bitsPerComponent: 8 },
        outputDescriptor: { colorSpace: 'CMYK', bitsPerComponent: 8 },
        inputFormat: TYPE_CMYK_8,
        outputFormat: TYPE_CMYK_8,
        description: 'CMYK 8-bit → CMYK 8-bit (profile conversion)',
    },
    {
        inputDescriptor: { colorSpace: 'CMYK', bitsPerComponent: 16, endianness: 'big' },
        outputDescriptor: { colorSpace: 'CMYK', bitsPerComponent: 16, endianness: 'big' },
        inputFormat: TYPE_CMYK_16_SE,
        outputFormat: TYPE_CMYK_16_SE,
        description: 'CMYK 16-bit big-endian → CMYK 16-bit big-endian',
    },
    {
        inputDescriptor: { colorSpace: 'CMYK', bitsPerComponent: 16, endianness: 'little' },
        outputDescriptor: { colorSpace: 'CMYK', bitsPerComponent: 16, endianness: 'little' },
        inputFormat: TYPE_CMYK_16,
        outputFormat: TYPE_CMYK_16,
        description: 'CMYK 16-bit little-endian → CMYK 16-bit little-endian',
    },
    {
        inputDescriptor: { colorSpace: 'CMYK', bitsPerComponent: 32 },
        outputDescriptor: { colorSpace: 'CMYK', bitsPerComponent: 32 },
        inputFormat: TYPE_CMYK_FLT,
        outputFormat: TYPE_CMYK_FLT,
        description: 'CMYK 32-bit float → CMYK 32-bit float',
    },
    {
        inputDescriptor: { colorSpace: 'CMYK', bitsPerComponent: 8, channelOrder: 'KYMC' },
        outputDescriptor: { colorSpace: 'CMYK', bitsPerComponent: 8 },
        inputFormat: TYPE_KYMC_8,
        outputFormat: TYPE_CMYK_8,
        description: 'KYMC 8-bit → CMYK 8-bit',
    },
    {
        inputDescriptor: { colorSpace: 'CMYK', bitsPerComponent: 16, channelOrder: 'KYMC', endianness: 'big' },
        outputDescriptor: { colorSpace: 'CMYK', bitsPerComponent: 16, endianness: 'big' },
        inputFormat: TYPE_KYMC_16_SE,
        outputFormat: TYPE_CMYK_16_SE,
        description: 'KYMC 16-bit big-endian → CMYK 16-bit big-endian',
    },
    {
        inputDescriptor: { colorSpace: 'CMYK', bitsPerComponent: 8 },
        outputDescriptor: { colorSpace: 'RGB', bitsPerComponent: 8 },
        inputFormat: TYPE_CMYK_8,
        outputFormat: TYPE_RGB_8,
        description: 'CMYK 8-bit → RGB 8-bit',
    },
    {
        inputDescriptor: { colorSpace: 'CMYK', bitsPerComponent: 16, endianness: 'big' },
        outputDescriptor: { colorSpace: 'RGB', bitsPerComponent: 16, endianness: 'big' },
        inputFormat: TYPE_CMYK_16_SE,
        outputFormat: TYPE_RGB_16_SE,
        description: 'CMYK 16-bit big-endian → RGB 16-bit big-endian',
    },

    // ========================================
    // Lab Formats
    // ========================================
    {
        inputDescriptor: { colorSpace: 'Lab', bitsPerComponent: 8 },
        outputDescriptor: { colorSpace: 'CMYK', bitsPerComponent: 8 },
        inputFormat: TYPE_Lab_8,
        outputFormat: TYPE_CMYK_8,
        description: 'Lab 8-bit → CMYK 8-bit',
    },
    {
        inputDescriptor: { colorSpace: 'Lab', bitsPerComponent: 16, endianness: 'big' },
        outputDescriptor: { colorSpace: 'CMYK', bitsPerComponent: 16, endianness: 'big' },
        inputFormat: TYPE_Lab_16_SE,
        outputFormat: TYPE_CMYK_16_SE,
        description: 'Lab 16-bit big-endian → CMYK 16-bit big-endian',
    },
    {
        inputDescriptor: { colorSpace: 'Lab', bitsPerComponent: 32 },
        outputDescriptor: { colorSpace: 'CMYK', bitsPerComponent: 32 },
        inputFormat: TYPE_Lab_FLT,
        outputFormat: TYPE_CMYK_FLT,
        description: 'Lab 32-bit float → CMYK 32-bit float',
    },
    {
        inputDescriptor: { colorSpace: 'Lab', bitsPerComponent: 8 },
        outputDescriptor: { colorSpace: 'RGB', bitsPerComponent: 8 },
        inputFormat: TYPE_Lab_8,
        outputFormat: TYPE_RGB_8,
        description: 'Lab 8-bit → RGB 8-bit',
    },
    {
        inputDescriptor: { colorSpace: 'Lab', bitsPerComponent: 16, endianness: 'big' },
        outputDescriptor: { colorSpace: 'RGB', bitsPerComponent: 16, endianness: 'big' },
        inputFormat: TYPE_Lab_16_SE,
        outputFormat: TYPE_RGB_16_SE,
        description: 'Lab 16-bit big-endian → RGB 16-bit big-endian',
    },

    // ========================================
    // Mixed Bit Depth Conversions
    // ========================================
    {
        inputDescriptor: { colorSpace: 'RGB', bitsPerComponent: 16, endianness: 'big' },
        outputDescriptor: { colorSpace: 'CMYK', bitsPerComponent: 8 },
        inputFormat: TYPE_RGB_16_SE,
        outputFormat: TYPE_CMYK_8,
        description: 'RGB 16-bit big-endian → CMYK 8-bit (downscale)',
    },
    {
        inputDescriptor: { colorSpace: 'RGB', bitsPerComponent: 8 },
        outputDescriptor: { colorSpace: 'CMYK', bitsPerComponent: 16, endianness: 'big' },
        inputFormat: TYPE_RGB_8,
        outputFormat: TYPE_CMYK_16_SE,
        description: 'RGB 8-bit → CMYK 16-bit big-endian (upscale)',
    },
    {
        inputDescriptor: { colorSpace: 'Gray', bitsPerComponent: 16, endianness: 'big' },
        outputDescriptor: { colorSpace: 'CMYK', bitsPerComponent: 8 },
        inputFormat: TYPE_GRAY_16_SE,
        outputFormat: TYPE_CMYK_8,
        description: 'Gray 16-bit big-endian → CMYK 8-bit',
    },
];

// ============================================================================
// Tests
// ============================================================================

describe('ColorConversionPolicy', () => {
    /** @type {ColorConversionPolicy} */
    let policy;

    // Create policy before tests
    policy = new ColorConversionPolicy();

    // ========================================
    // Format Resolution Tests (Comprehensive Loop)
    // ========================================

    describe('format resolution - comprehensive scenarios', () => {
        for (const scenario of FORMAT_SCENARIOS) {
            test(scenario.description, () => {
                const inputFormat = policy.getInputFormat(scenario.inputDescriptor);
                const outputFormat = policy.getOutputFormat(scenario.outputDescriptor);

                assert.strictEqual(
                    inputFormat,
                    scenario.inputFormat,
                    `Input format mismatch for ${scenario.description}: ` +
                    `expected ${scenario.inputFormat} (0x${scenario.inputFormat.toString(16)}), ` +
                    `got ${inputFormat} (0x${inputFormat.toString(16)})`
                );

                assert.strictEqual(
                    outputFormat,
                    scenario.outputFormat,
                    `Output format mismatch for ${scenario.description}: ` +
                    `expected ${scenario.outputFormat} (0x${scenario.outputFormat.toString(16)}), ` +
                    `got ${outputFormat} (0x${outputFormat.toString(16)})`
                );
            });
        }
    });

    // ========================================
    // Buffer Creation Tests
    // ========================================

    describe('buffer creation', () => {
        test('creates Uint8Array for 8-bit formats', () => {
            const buffer = policy.createOutputBuffer(TYPE_RGB_8, 100, 3);
            assert.ok(buffer instanceof Uint8Array);
            assert.strictEqual(buffer.length, 300);
        });

        test('creates Uint16Array for 16-bit formats', () => {
            const buffer = policy.createOutputBuffer(TYPE_RGB_16, 100, 3);
            assert.ok(buffer instanceof Uint16Array);
            assert.strictEqual(buffer.length, 300);
        });

        test('creates Float32Array for 32-bit float formats', () => {
            const buffer = policy.createOutputBuffer(TYPE_RGB_FLT, 100, 3);
            assert.ok(buffer instanceof Float32Array);
            assert.strictEqual(buffer.length, 300);
        });

        test('creates correct buffer for CMYK 8-bit', () => {
            const buffer = policy.createOutputBuffer(TYPE_CMYK_8, 100, 4);
            assert.ok(buffer instanceof Uint8Array);
            assert.strictEqual(buffer.length, 400);
        });

        test('creates correct buffer for CMYK 16-bit', () => {
            const buffer = policy.createOutputBuffer(TYPE_CMYK_16, 100, 4);
            assert.ok(buffer instanceof Uint16Array);
            assert.strictEqual(buffer.length, 400);
        });

        test('creates correct buffer for CMYK float', () => {
            const buffer = policy.createOutputBuffer(TYPE_CMYK_FLT, 100, 4);
            assert.ok(buffer instanceof Float32Array);
            assert.strictEqual(buffer.length, 400);
        });

        test('uses format channels when channelsOverride not provided', () => {
            const buffer = policy.createOutputBuffer(TYPE_CMYK_8, 100);
            assert.ok(buffer instanceof Uint8Array);
            assert.strictEqual(buffer.length, 400); // 100 pixels * 4 channels
        });
    });

    // ========================================
    // Format Properties Tests
    // ========================================

    describe('format properties', () => {
        test('getBytesPerSample returns correct values', () => {
            assert.strictEqual(policy.getBytesPerSample(TYPE_RGB_8), 1);
            assert.strictEqual(policy.getBytesPerSample(TYPE_RGB_16), 2);
            assert.strictEqual(policy.getBytesPerSample(TYPE_RGB_FLT), 4);
            assert.strictEqual(policy.getBytesPerSample(TYPE_CMYK_8), 1);
            assert.strictEqual(policy.getBytesPerSample(TYPE_CMYK_16), 2);
            assert.strictEqual(policy.getBytesPerSample(TYPE_CMYK_FLT), 4);
        });

        test('getChannels returns correct values', () => {
            assert.strictEqual(policy.getChannels(TYPE_GRAY_8), 1);
            assert.strictEqual(policy.getChannels(TYPE_GRAYA_8), 2);
            assert.strictEqual(policy.getChannels(TYPE_RGB_8), 3);
            assert.strictEqual(policy.getChannels(TYPE_RGBA_8), 4);
            assert.strictEqual(policy.getChannels(TYPE_CMYK_8), 4);
            assert.strictEqual(policy.getChannels(TYPE_Lab_8), 3);
        });

        test('getBytesPerPixel returns correct values', () => {
            assert.strictEqual(policy.getBytesPerPixel(TYPE_GRAY_8), 1);
            assert.strictEqual(policy.getBytesPerPixel(TYPE_GRAY_16), 2);
            assert.strictEqual(policy.getBytesPerPixel(TYPE_RGB_8), 3);
            assert.strictEqual(policy.getBytesPerPixel(TYPE_RGB_16), 6);
            assert.strictEqual(policy.getBytesPerPixel(TYPE_CMYK_8), 4);
            assert.strictEqual(policy.getBytesPerPixel(TYPE_CMYK_16), 8);
        });

        test('getColorSpace returns correct values', () => {
            assert.strictEqual(policy.getColorSpace(TYPE_GRAY_8), 'Gray');
            assert.strictEqual(policy.getColorSpace(TYPE_RGB_8), 'RGB');
            assert.strictEqual(policy.getColorSpace(TYPE_CMYK_8), 'CMYK');
            assert.strictEqual(policy.getColorSpace(TYPE_Lab_8), 'Lab');
        });

        test('getBitDepth returns correct values', () => {
            assert.strictEqual(policy.getBitDepth(TYPE_RGB_8), 8);
            assert.strictEqual(policy.getBitDepth(TYPE_RGB_16), 16);
            assert.strictEqual(policy.getBitDepth(TYPE_RGB_FLT), 32);
        });

        test('isFloatFormat returns correct values', () => {
            assert.strictEqual(policy.isFloatFormat(TYPE_RGB_8), false);
            assert.strictEqual(policy.isFloatFormat(TYPE_RGB_16), false);
            assert.strictEqual(policy.isFloatFormat(TYPE_RGB_FLT), true);
            assert.strictEqual(policy.isFloatFormat(TYPE_CMYK_FLT), true);
        });

        test('getFormatProperties returns correct endianness', () => {
            // LittleCMS native byte order is little-endian on modern systems
            // TYPE_*_SE (Swapped Endian) formats swap to big-endian for PDF compatibility
            assert.strictEqual(policy.getFormatProperties(TYPE_RGB_16).endianness, 'little');
            assert.strictEqual(policy.getFormatProperties(TYPE_RGB_16_SE).endianness, 'big');
            assert.strictEqual(policy.getFormatProperties(TYPE_CMYK_16).endianness, 'little');
            assert.strictEqual(policy.getFormatProperties(TYPE_CMYK_16_SE).endianness, 'big');
            assert.strictEqual(policy.getFormatProperties(TYPE_RGB_8).endianness, 'native');
        });
    });

    // ========================================
    // Convenience Method Tests
    // ========================================

    describe('convenience methods', () => {
        test('getStandardFormat returns correct formats', () => {
            // 8-bit: no endianness concerns
            assert.strictEqual(policy.getStandardFormat('Gray', 8), TYPE_GRAY_8);
            assert.strictEqual(policy.getStandardFormat('RGB', 8), TYPE_RGB_8);
            assert.strictEqual(policy.getStandardFormat('CMYK', 8), TYPE_CMYK_8);
            assert.strictEqual(policy.getStandardFormat('Lab', 8), TYPE_Lab_8);

            // 16-bit: default endianness is 'big' (PDF standard), WASM is little-endian
            // so getStandardFormat returns _SE variants for big-endian buffer handling
            assert.strictEqual(policy.getStandardFormat('Gray', 16), TYPE_GRAY_16_SE);
            assert.strictEqual(policy.getStandardFormat('RGB', 16), TYPE_RGB_16_SE);
            assert.strictEqual(policy.getStandardFormat('CMYK', 16), TYPE_CMYK_16_SE);
            assert.strictEqual(policy.getStandardFormat('Lab', 16), TYPE_Lab_16_SE);

            // 32-bit Float: no SE variants, endianness not applicable
            assert.strictEqual(policy.getStandardFormat('Gray', 32), TYPE_GRAY_FLT);
            assert.strictEqual(policy.getStandardFormat('RGB', 32), TYPE_RGB_FLT);
            assert.strictEqual(policy.getStandardFormat('CMYK', 32), TYPE_CMYK_FLT);
            assert.strictEqual(policy.getStandardFormat('Lab', 32), TYPE_Lab_FLT);
        });

        test('getTypedArrayConstructor returns correct constructors', () => {
            assert.strictEqual(policy.getTypedArrayConstructor(TYPE_RGB_8), Uint8Array);
            assert.strictEqual(policy.getTypedArrayConstructor(TYPE_RGB_16), Uint16Array);
            assert.strictEqual(policy.getTypedArrayConstructor(TYPE_RGB_FLT), Float32Array);
        });
    });

    // ========================================
    // Buffer Validation Tests
    // ========================================

    describe('buffer validation', () => {
        test('validates correct buffer type and size', () => {
            const buffer = new Uint8Array(300);
            const result = policy.validateBuffer(buffer, TYPE_RGB_8, 100);
            assert.strictEqual(result.valid, true);
            assert.strictEqual(result.error, undefined);
        });

        test('detects wrong buffer type', () => {
            const buffer = new Uint16Array(300);
            const result = policy.validateBuffer(buffer, TYPE_RGB_8, 100);
            assert.strictEqual(result.valid, false);
            assert.ok(result.error?.includes('Buffer type mismatch'));
        });

        test('detects wrong buffer length', () => {
            const buffer = new Uint8Array(200);
            const result = policy.validateBuffer(buffer, TYPE_RGB_8, 100);
            assert.strictEqual(result.valid, false);
            assert.ok(result.error?.includes('Buffer length mismatch'));
        });

        test('validates 16-bit buffer correctly', () => {
            const buffer = new Uint16Array(300);
            const result = policy.validateBuffer(buffer, TYPE_RGB_16, 100);
            assert.strictEqual(result.valid, true);
        });

        test('validates float buffer correctly', () => {
            const buffer = new Float32Array(400);
            const result = policy.validateBuffer(buffer, TYPE_CMYK_FLT, 100);
            assert.strictEqual(result.valid, true);
        });
    });

    // ========================================
    // Error Handling Tests
    // ========================================

    describe('error handling', () => {
        test('throws on unsupported bit depth', () => {
            assert.throws(
                () => policy.getInputFormat({ colorSpace: 'RGB', bitsPerComponent: /** @type {any} */ (12) }),
                /Unsupported bit depth/
            );
        });

        test('throws on unknown format constant', () => {
            assert.throws(
                () => policy.getFormatProperties(0x12345678),
                /Unknown format constant/
            );
        });
    });

    // ========================================
    // Rule Evaluation Tests
    // ========================================

    describe('rule evaluation', () => {
        test('evaluateConversion returns valid result for standard conversion', () => {
            const result = policy.evaluateConversion({
                sourceColorSpace: 'RGB',
                destinationColorSpace: 'CMYK',
                renderingIntent: 'relative-colorimetric',
            });

            assert.strictEqual(result.valid, true);
            assert.strictEqual(result.errors.length, 0);
            assert.strictEqual(result.warnings.length, 0);
            assert.ok(Array.isArray(result.trace));
        });

        test('K-Only GCR with non-CMYK output triggers renderingIntent override', () => {
            // The k-only-gcr-to-relative-colorimetric-fallback rule applies to
            // engines up to color-engine-2026-02-14 but NOT color-engine-2026-03-27.
            // Use a specific engine version where this rule is active.
            const policyForOlderEngine = new ColorConversionPolicy({
                engineVersion: 'color-engine-2026-02-14',
            });

            const result = policyForOlderEngine.evaluateConversion({
                sourceColorSpace: 'RGB',
                destinationColorSpace: 'RGB',
                renderingIntent: 'preserve-k-only-relative-colorimetric-gcr',
            });

            // Should override to relative-colorimetric
            assert.strictEqual(result.overrides.renderingIntent, 'relative-colorimetric');
            assert.ok(result.warnings.length > 0 || result.errors.length > 0);
        });

        test('getEffectiveRenderingIntent returns overridden intent', () => {
            // Same engine version constraint as above
            const policyForOlderEngine = new ColorConversionPolicy({
                engineVersion: 'color-engine-2026-02-14',
            });

            const effectiveIntent = policyForOlderEngine.getEffectiveRenderingIntent({
                sourceColorSpace: 'RGB',
                destinationColorSpace: 'RGB',
                renderingIntent: 'preserve-k-only-relative-colorimetric-gcr',
            });

            assert.strictEqual(effectiveIntent, 'relative-colorimetric');
        });

        test('getEffectiveRenderingIntent returns original intent when no override', () => {
            const effectiveIntent = policy.getEffectiveRenderingIntent({
                sourceColorSpace: 'RGB',
                destinationColorSpace: 'CMYK',
                renderingIntent: 'relative-colorimetric',
            });

            assert.strictEqual(effectiveIntent, 'relative-colorimetric');
        });

        test('requiresMultiprofileTransform returns true for Gray → CMYK with K-Only GCR', () => {
            const requires = policy.requiresMultiprofileTransform({
                sourceColorSpace: 'Gray',
                destinationColorSpace: 'CMYK',
                renderingIntent: 'preserve-k-only-relative-colorimetric-gcr',
            });

            assert.strictEqual(requires, true);
        });

        test('requiresMultiprofileTransform returns false for RGB → CMYK with K-Only GCR', () => {
            const requires = policy.requiresMultiprofileTransform({
                sourceColorSpace: 'RGB',
                destinationColorSpace: 'CMYK',
                renderingIntent: 'preserve-k-only-relative-colorimetric-gcr',
            });

            assert.strictEqual(requires, false);
        });

        test('getIntermediateProfiles returns profiles for multiprofile transform', () => {
            // Use older engine that requires intermediateProfiles
            const oldPolicy = new ColorConversionPolicy({
                engineVersion: 'color-engine-2025-12-19',
            });

            const profiles = oldPolicy.getIntermediateProfiles({
                sourceColorSpace: 'Gray',
                destinationColorSpace: 'CMYK',
                renderingIntent: 'preserve-k-only-relative-colorimetric-gcr',
            });

            // Profile paths are resolved relative to the module, match by filename pattern
            assert.ok(profiles.some(profile => /\/sRGB\b[^/]+?\.ic[cm]$/.test(profile)));
        });
    });

    // ========================================
    // Multiprofile Black Point Scaling Tests
    // ========================================

    describe('multiprofile black point scaling', () => {
        test('requiresMultiprofileBlackPointScaling returns false when BPC is disabled', () => {
            const newPolicy = new ColorConversionPolicy({
                engineVersion: 'color-engine-2026-01-30',
            });

            const requires = newPolicy.requiresMultiprofileBlackPointScaling({
                sourceColorSpace: 'RGB',
                destinationColorSpace: 'RGB',
                renderingIntent: 'relative-colorimetric',
                blackPointCompensation: false,
            });

            assert.strictEqual(requires, false);
        });

        test('requiresMultiprofileBlackPointScaling returns false when BPC is not specified', () => {
            const newPolicy = new ColorConversionPolicy({
                engineVersion: 'color-engine-2026-01-30',
            });

            const requires = newPolicy.requiresMultiprofileBlackPointScaling({
                sourceColorSpace: 'RGB',
                destinationColorSpace: 'RGB',
                renderingIntent: 'relative-colorimetric',
                // blackPointCompensation not specified - defaults to false
            });

            assert.strictEqual(requires, false);
        });

        test('requiresMultiprofileBlackPointScaling returns false for CMYK destination (even with BPC)', () => {
            const newPolicy = new ColorConversionPolicy({
                engineVersion: 'color-engine-2026-01-30',
            });

            const requires = newPolicy.requiresMultiprofileBlackPointScaling({
                sourceColorSpace: 'RGB',
                destinationColorSpace: 'CMYK',
                renderingIntent: 'relative-colorimetric',
                blackPointCompensation: true,
            });

            // Rule only applies to RGB destination, not CMYK
            assert.strictEqual(requires, false);
        });

        test('requiresMultiprofileBlackPointScaling returns true for RGB destination with BPC enabled', () => {
            const newPolicy = new ColorConversionPolicy({
                engineVersion: 'color-engine-2026-01-30',
            });

            const requires = newPolicy.requiresMultiprofileBlackPointScaling({
                sourceColorSpace: 'RGB',
                destinationColorSpace: 'RGB',
                renderingIntent: 'relative-colorimetric',
                blackPointCompensation: true,
            });

            // Rule triggers: relative-colorimetric + BPC + RGB destination
            assert.strictEqual(requires, true);
        });

        test('requiresMultiprofileBlackPointScaling returns true for K-Only GCR with BPC and RGB destination', () => {
            const newPolicy = new ColorConversionPolicy({
                engineVersion: 'color-engine-2026-01-30',
            });

            const requires = newPolicy.requiresMultiprofileBlackPointScaling({
                sourceColorSpace: 'CMYK',
                destinationColorSpace: 'RGB',
                renderingIntent: 'preserve-k-only-relative-colorimetric-gcr',
                blackPointCompensation: true,
            });

            assert.strictEqual(requires, true);
        });
    });

    // ========================================
    // Rule Tracing Tests
    // ========================================

    describe('rule tracing', () => {
        test('trace is empty for conversions with no matching rules', () => {
            const result = policy.evaluateConversion({
                sourceColorSpace: 'RGB',
                destinationColorSpace: 'CMYK',
                renderingIntent: 'relative-colorimetric',
            });

            assert.ok(Array.isArray(result.trace));
            assert.strictEqual(result.trace.length, 0);
        });

        test('trace contains entries for matched rules', () => {
            const result = policy.evaluateConversion({
                sourceColorSpace: 'Gray',
                destinationColorSpace: 'CMYK',
                renderingIntent: 'preserve-k-only-relative-colorimetric-gcr',
            });

            assert.ok(result.trace.length > 0);

            // Each trace entry should have required fields
            for (const entry of result.trace) {
                assert.ok(typeof entry.policyId === 'string');
                assert.ok(typeof entry.ruleIndex === 'number');
                assert.ok(typeof entry.description === 'string');
                assert.ok(entry.severity === 'error' || entry.severity === 'warning');
                assert.ok(Array.isArray(entry.appliedOverrides));
            }
        });

        test('trace appliedOverrides lists the override keys', () => {
            // The k-only-gcr-to-relative-colorimetric-fallback rule (which overrides
            // renderingIntent) applies to engines up to color-engine-2026-02-14.
            const policyForOlderEngine = new ColorConversionPolicy({
                engineVersion: 'color-engine-2026-02-14',
            });

            const result = policyForOlderEngine.evaluateConversion({
                sourceColorSpace: 'RGB',
                destinationColorSpace: 'RGB',
                renderingIntent: 'preserve-k-only-relative-colorimetric-gcr',
            });

            // Should have a trace entry with renderingIntent override
            const hasRenderingIntentOverride = result.trace.some(
                entry => entry.appliedOverrides.includes('renderingIntent')
            );

            assert.strictEqual(hasRenderingIntentOverride, true);
        });

        test('matchedRules contains the actual PolicyRule objects', () => {
            const result = policy.evaluateConversion({
                sourceColorSpace: 'Gray',
                destinationColorSpace: 'CMYK',
                renderingIntent: 'preserve-k-only-relative-colorimetric-gcr',
            });

            assert.ok(result.matchedRules.length > 0);

            // Each matched rule should have the standard PolicyRule structure
            for (const rule of result.matchedRules) {
                assert.ok(typeof rule.description === 'string');
                assert.ok(rule.constraints !== undefined);
                assert.ok(rule.overrides !== undefined);
            }
        });
    });

    // ========================================
    // Input/Output Parameter Resolution Tests
    // ========================================

    describe('input/output parameter resolution', () => {
        // Test inputBitsPerComponent/outputBitsPerComponent resolution
        describe('bitsPerComponent resolution', () => {
            test('uses bitsPerComponent when inputBitsPerComponent not specified', () => {
                const format = policy.getInputFormat({
                    colorSpace: 'RGB',
                    bitsPerComponent: 8,
                });
                assert.strictEqual(format, TYPE_RGB_8);
            });

            test('uses inputBitsPerComponent when specified (overrides bitsPerComponent)', () => {
                const format = policy.getInputFormat({
                    colorSpace: 'RGB',
                    bitsPerComponent: 16,
                    inputBitsPerComponent: 8,
                    endianness: 'big',
                });
                assert.strictEqual(format, TYPE_RGB_8);
            });

            test('uses outputBitsPerComponent when specified (overrides bitsPerComponent)', () => {
                const format = policy.getOutputFormat({
                    colorSpace: 'CMYK',
                    bitsPerComponent: 16,
                    outputBitsPerComponent: 8,
                    endianness: 'big',
                });
                assert.strictEqual(format, TYPE_CMYK_8);
            });

            test('throws when input bit depth cannot be determined', () => {
                assert.throws(
                    () => policy.getInputFormat({
                        colorSpace: 'RGB',
                        outputBitsPerComponent: 8,
                    }),
                    /Cannot determine input bit depth/
                );
            });

            test('throws when output bit depth cannot be determined', () => {
                assert.throws(
                    () => policy.getOutputFormat({
                        colorSpace: 'RGB',
                        inputBitsPerComponent: 8,
                    }),
                    /Cannot determine output bit depth/
                );
            });
        });

        // Test inputEndianness/outputEndianness resolution
        describe('endianness resolution', () => {
            test('uses endianness when inputEndianness not specified', () => {
                const format = policy.getInputFormat({
                    colorSpace: 'RGB',
                    bitsPerComponent: 16,
                    endianness: 'big',
                });
                // Big-endian buffer on little-endian WASM needs swap → TYPE_*_SE
                assert.strictEqual(format, TYPE_RGB_16_SE);
            });

            test('uses inputEndianness when specified (overrides endianness)', () => {
                const format = policy.getInputFormat({
                    colorSpace: 'RGB',
                    bitsPerComponent: 16,
                    endianness: 'big',
                    inputEndianness: 'little',
                });
                // Little-endian buffer on little-endian WASM → no swap
                assert.strictEqual(format, TYPE_RGB_16);
            });

            test('uses outputEndianness when specified (overrides endianness)', () => {
                const format = policy.getOutputFormat({
                    colorSpace: 'CMYK',
                    bitsPerComponent: 16,
                    endianness: 'little',
                    outputEndianness: 'big',
                });
                // Big-endian buffer → TYPE_*_SE
                assert.strictEqual(format, TYPE_CMYK_16_SE);
            });
        });

        // Test conditional endianness requirements based on bit depth
        describe('conditional endianness validation', () => {
            test('8-bit input ignores endianness (no error when omitted)', () => {
                const format = policy.getInputFormat({
                    colorSpace: 'RGB',
                    bitsPerComponent: 8,
                    // No endianness specified
                });
                assert.strictEqual(format, TYPE_RGB_8);
            });

            test('8-bit output ignores endianness (no error when omitted)', () => {
                const format = policy.getOutputFormat({
                    colorSpace: 'CMYK',
                    bitsPerComponent: 8,
                    // No endianness specified
                });
                assert.strictEqual(format, TYPE_CMYK_8);
            });

            test('16-bit input throws when endianness not specified', () => {
                assert.throws(
                    () => policy.getInputFormat({
                        colorSpace: 'RGB',
                        bitsPerComponent: 16,
                    }),
                    /endianness must be 'big' or 'little'/
                );
            });

            test('16-bit output throws when endianness not specified', () => {
                assert.throws(
                    () => policy.getOutputFormat({
                        colorSpace: 'CMYK',
                        bitsPerComponent: 16,
                    }),
                    /endianness must be 'big' or 'little'/
                );
            });

            test('32-bit input allows omitting endianness (no error)', () => {
                const format = policy.getInputFormat({
                    colorSpace: 'RGB',
                    bitsPerComponent: 32,
                    // No endianness specified - should be fine for float
                });
                assert.strictEqual(format, TYPE_RGB_FLT);
            });

            test('32-bit output allows omitting endianness (no error)', () => {
                const format = policy.getOutputFormat({
                    colorSpace: 'Lab',
                    bitsPerComponent: 32,
                    // No endianness specified - should be fine for float
                });
                assert.strictEqual(format, TYPE_Lab_FLT);
            });

            // Warning tests - capture console.warn output
            test('32-bit input warns when endianness specified', () => {
                const warnings = [];
                const originalWarn = console.warn;
                console.warn = (msg) => warnings.push(msg);

                try {
                    policy.getInputFormat({
                        colorSpace: 'RGB',
                        bitsPerComponent: 32,
                        endianness: 'big',
                    });
                } finally {
                    console.warn = originalWarn;
                }

                assert.strictEqual(warnings.length, 1);
                assert.ok(warnings[0].includes('no effect on 32-bit float input'));
            });

            test('32-bit output warns when endianness specified', () => {
                const warnings = [];
                const originalWarn = console.warn;
                console.warn = (msg) => warnings.push(msg);

                try {
                    policy.getOutputFormat({
                        colorSpace: 'CMYK',
                        bitsPerComponent: 32,
                        endianness: 'little',
                    });
                } finally {
                    console.warn = originalWarn;
                }

                assert.strictEqual(warnings.length, 1);
                assert.ok(warnings[0].includes('no effect on 32-bit float output'));
            });

            test('32-bit input warns when inputEndianness specified specifically', () => {
                const warnings = [];
                const originalWarn = console.warn;
                console.warn = (msg) => warnings.push(msg);

                try {
                    policy.getInputFormat({
                        colorSpace: 'RGB',
                        bitsPerComponent: 32,
                        inputEndianness: 'big',
                    });
                } finally {
                    console.warn = originalWarn;
                }

                assert.strictEqual(warnings.length, 1);
                assert.ok(warnings[0].includes('no effect on 32-bit float input'));
            });
        });

        // Test mixed bit depth scenarios (16-bit input, 8-bit output, etc.)
        describe('mixed bit depth scenarios', () => {
            test('16-bit input with 8-bit output requires inputEndianness only', () => {
                const inputFormat = policy.getInputFormat({
                    colorSpace: 'RGB',
                    inputBitsPerComponent: 16,
                    outputBitsPerComponent: 8,
                    inputEndianness: 'big',
                    // No outputEndianness needed - 8-bit
                });

                const outputFormat = policy.getOutputFormat({
                    colorSpace: 'CMYK',
                    inputBitsPerComponent: 16,
                    outputBitsPerComponent: 8,
                    inputEndianness: 'big',
                    // No outputEndianness needed - 8-bit
                });

                assert.strictEqual(inputFormat, TYPE_RGB_16_SE);
                assert.strictEqual(outputFormat, TYPE_CMYK_8);
            });

            test('8-bit input with 16-bit output requires outputEndianness only', () => {
                const inputFormat = policy.getInputFormat({
                    colorSpace: 'Gray',
                    inputBitsPerComponent: 8,
                    outputBitsPerComponent: 16,
                    outputEndianness: 'big',
                    // No inputEndianness needed - 8-bit
                });

                const outputFormat = policy.getOutputFormat({
                    colorSpace: 'CMYK',
                    inputBitsPerComponent: 8,
                    outputBitsPerComponent: 16,
                    outputEndianness: 'big',
                });

                assert.strictEqual(inputFormat, TYPE_GRAY_8);
                assert.strictEqual(outputFormat, TYPE_CMYK_16_SE);
            });

            test('16-bit input with 32-bit output requires inputEndianness, warns if outputEndianness specified', () => {
                const warnings = [];
                const originalWarn = console.warn;
                console.warn = (msg) => warnings.push(msg);

                try {
                    policy.getInputFormat({
                        colorSpace: 'RGB',
                        inputBitsPerComponent: 16,
                        outputBitsPerComponent: 32,
                        endianness: 'big', // Shared endianness
                    });

                    policy.getOutputFormat({
                        colorSpace: 'Lab',
                        inputBitsPerComponent: 16,
                        outputBitsPerComponent: 32,
                        endianness: 'big', // Shared endianness - warns for 32-bit output
                    });
                } finally {
                    console.warn = originalWarn;
                }

                // Should warn about the 32-bit output
                assert.strictEqual(warnings.length, 1);
                assert.ok(warnings[0].includes('no effect on 32-bit float output'));
            });
        });
    });

    // ========================================
    // Rendering Intent Helper Tests
    // ========================================

    describe('rendering intent helpers', () => {
        test('isKOnlyGCR returns true for K-Only GCR intent', () => {
            assert.strictEqual(policy.isKOnlyGCR('preserve-k-only-relative-colorimetric-gcr'), true);
        });

        test('isKOnlyGCR returns false for other intents', () => {
            assert.strictEqual(policy.isKOnlyGCR('relative-colorimetric'), false);
            assert.strictEqual(policy.isKOnlyGCR('perceptual'), false);
            assert.strictEqual(policy.isKOnlyGCR('saturation'), false);
            assert.strictEqual(policy.isKOnlyGCR('absolute-colorimetric'), false);
        });

        test('getRenderingIntentConstant returns correct values', () => {
            assert.strictEqual(policy.getRenderingIntentConstant('perceptual'), 0);
            assert.strictEqual(policy.getRenderingIntentConstant('relative-colorimetric'), 1);
            assert.strictEqual(policy.getRenderingIntentConstant('saturation'), 2);
            assert.strictEqual(policy.getRenderingIntentConstant('absolute-colorimetric'), 3);
            assert.strictEqual(policy.getRenderingIntentConstant('preserve-k-only-relative-colorimetric-gcr'), 20);
        });
    });
});
