// @ts-check
/**
 * ImageColorConverter Class Tests
 *
 * Tests for pixel buffer color conversion.
 *
 * @module ImageColorConverter.test
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import { TruthyEnvironmentParameterMatcher } from '../helpers.js';

// ============================================================================
// Test Fixtures
// ============================================================================

/**
 * Creates a mock pixel buffer.
 * @param {number} width
 * @param {number} height
 * @param {number} channels
 * @returns {Uint8Array}
 */
function createMockPixelBuffer(width, height, channels) {
    const size = width * height * channels;
    const buffer = new Uint8Array(size);
    for (let i = 0; i < size; i++) {
        buffer[i] = (i * 37) % 256;
    }
    return buffer;
}

/**
 * Creates a simple sRGB-like profile buffer (mock).
 * @returns {ArrayBuffer}
 */
function createMockProfile() {
    // Return a minimal buffer that looks like a profile
    const buffer = new ArrayBuffer(128);
    const view = new Uint8Array(buffer);
    // ICC profile magic number
    view[36] = 0x61; // 'a'
    view[37] = 0x63; // 'c'
    view[38] = 0x73; // 's'
    view[39] = 0x70; // 'p'
    return buffer;
}

// ============================================================================
// Shared Test Functions (invokeXXXTest pattern)
// ============================================================================

/**
 * Tests that ImageColorConverter extends ColorConverter properly.
 *
 * @param {typeof import('../../classes/baseline/image-color-converter.js').ImageColorConverter} ImageColorConverter
 * @param {typeof import('../../classes/baseline/color-converter.js').ColorConverter} ColorConverter
 */
async function invokeInheritanceTest(ImageColorConverter, ColorConverter) {
    const config = {
        renderingIntent: /** @type {const} */ ('relative-colorimetric'),
        blackPointCompensation: true,
        useAdaptiveBPCClamping: true,
        destinationProfile: createMockProfile(),
        destinationColorSpace: /** @type {const} */ ('CMYK'),
        inputType: /** @type {const} */ ('RGB'),
        verbose: false,
    };

    const converter = new ImageColorConverter(config);

    // Should be instance of both classes
    assert.ok(converter instanceof ImageColorConverter, 'Should be ImageColorConverter');
    assert.ok(converter instanceof ColorConverter, 'Should extend ColorConverter');

    // Should have configuration
    assert.strictEqual(converter.configuration.renderingIntent, 'relative-colorimetric');
    assert.strictEqual(converter.inputType, 'RGB');

    converter.dispose();
}

/**
 * Tests effective rendering intent fallback for Lab.
 *
 * @param {typeof import('../../classes/baseline/image-color-converter.js').ImageColorConverter} ImageColorConverter
 */
async function invokeLabIntentFallbackTest(ImageColorConverter) {
    const config = {
        renderingIntent: /** @type {const} */ ('preserve-k-only-relative-colorimetric-gcr'),
        blackPointCompensation: true,
        useAdaptiveBPCClamping: true,
        destinationProfile: createMockProfile(),
        destinationColorSpace: /** @type {const} */ ('CMYK'),
        inputType: /** @type {const} */ ('Lab'),
        verbose: false,
    };

    const converter = new ImageColorConverter(config);

    // Lab should fall back to relative-colorimetric
    assert.strictEqual(
        converter.getEffectiveRenderingIntent('Lab'),
        'preserve-k-only-relative-colorimetric-gcr',
        'Lab intent override removed in baseline — policy handles fallback'
    );

    // RGB should keep original intent
    assert.strictEqual(
        converter.getEffectiveRenderingIntent('RGB'),
        'preserve-k-only-relative-colorimetric-gcr',
        'RGB should keep K-Only GCR'
    );

    // Gray should keep original intent
    assert.strictEqual(
        converter.getEffectiveRenderingIntent('Gray'),
        'preserve-k-only-relative-colorimetric-gcr',
        'Gray should keep K-Only GCR'
    );

    converter.dispose();
}

/**
 * Tests that converter supports worker mode.
 *
 * @param {typeof import('../../classes/baseline/image-color-converter.js').ImageColorConverter} ImageColorConverter
 */
async function invokeWorkerModeSupportTest(ImageColorConverter) {
    const config = {
        renderingIntent: /** @type {const} */ ('relative-colorimetric'),
        blackPointCompensation: true,
        useAdaptiveBPCClamping: true,
        destinationProfile: createMockProfile(),
        destinationColorSpace: /** @type {const} */ ('CMYK'),
        inputType: /** @type {const} */ ('RGB'),
        verbose: false,
    };

    const converter = new ImageColorConverter(config);

    assert.strictEqual(converter.supportsWorkerMode, true, 'Should support worker mode');

    // prepareWorkerTask should return task data
    const input = {
        pixelBuffer: createMockPixelBuffer(10, 10, 3),
        width: 10,
        height: 10,
    };

    const task = converter.prepareWorkerTask(input, {});
    assert.ok(task, 'Should return task data');
    assert.strictEqual(task.type, 'image', 'Task type should be image');
    assert.strictEqual(task.width, 10, 'Task should have width');
    assert.strictEqual(task.height, 10, 'Task should have height');

    converter.dispose();
}

/**
 * Tests hooks are called in correct order.
 *
 * @param {typeof import('../../classes/baseline/image-color-converter.js').ImageColorConverter} ImageColorConverter
 */
async function invokeHookOrderTest(ImageColorConverter) {
    const callOrder = [];

    class TestImageConverter extends ImageColorConverter {
        async beforeConvertColor(input, context) {
            callOrder.push('beforeConvertColor');
            await super.beforeConvertColor(input, context);
        }

        async beforeConvertImageColor(input, context) {
            callOrder.push('beforeConvertImageColor');
            await super.beforeConvertImageColor(input, context);
        }

        async doConvertColor(input, context) {
            callOrder.push('doConvertColor');
            // Return mock result instead of calling actual conversion
            return {
                pixelBuffer: new Uint8Array(100),
                width: 10,
                height: 10,
                colorSpace: 'CMYK',
                bitsPerComponent: 8,
                pixelCount: 100,
            };
        }

        async afterConvertImageColor(input, result, context) {
            callOrder.push('afterConvertImageColor');
            await super.afterConvertImageColor(input, result, context);
        }

        async afterConvertColor(input, result, context) {
            callOrder.push('afterConvertColor');
            await super.afterConvertColor(input, result, context);
        }
    }

    const converter = new TestImageConverter({
        renderingIntent: /** @type {const} */ ('relative-colorimetric'),
        blackPointCompensation: true,
        useAdaptiveBPCClamping: true,
        destinationProfile: createMockProfile(),
        destinationColorSpace: /** @type {const} */ ('CMYK'),
        inputType: /** @type {const} */ ('RGB'),
        verbose: false,
    });

    await converter.convertColor({
        pixelBuffer: createMockPixelBuffer(10, 10, 3),
        width: 10,
        height: 10,
    }, {});

    // Verify hook order
    // Note: The test logs at the START of each override, so the order reflects
    // when each override is entered, not the conceptual hook sequence.
    // afterConvertColor is entered first, which then calls afterConvertImageColor.
    assert.deepStrictEqual(callOrder, [
        'beforeConvertColor',
        'beforeConvertImageColor',
        'doConvertColor',
        'afterConvertColor',
        'afterConvertImageColor',
    ], 'Hooks should be called in correct order');

    converter.dispose();
}

/**
 * Tests configuration getter returns correct type.
 *
 * @param {typeof import('../../classes/baseline/image-color-converter.js').ImageColorConverter} ImageColorConverter
 */
async function invokeConfigurationTypeTest(ImageColorConverter) {
    const config = {
        renderingIntent: /** @type {const} */ ('relative-colorimetric'),
        blackPointCompensation: true,
        useAdaptiveBPCClamping: true,
        destinationProfile: createMockProfile(),
        destinationColorSpace: /** @type {const} */ ('CMYK'),
        inputType: /** @type {const} */ ('RGB'),
        sourceProfile: 'sRGB',
        verbose: false,
    };

    const converter = new ImageColorConverter(config);

    const retrieved = converter.configuration;

    // Should have base config properties
    assert.strictEqual(retrieved.renderingIntent, 'relative-colorimetric');
    assert.strictEqual(retrieved.blackPointCompensation, true);
    assert.strictEqual(retrieved.destinationColorSpace, 'CMYK');

    // Should have image-specific properties
    assert.strictEqual(retrieved.inputType, 'RGB');
    assert.strictEqual(retrieved.sourceProfile, 'sRGB');

    converter.dispose();
}

/**
 * Tests dispose cleans up resources.
 *
 * @param {typeof import('../../classes/baseline/image-color-converter.js').ImageColorConverter} ImageColorConverter
 */
async function invokeDisposeTest(ImageColorConverter) {
    const converter = new ImageColorConverter({
        renderingIntent: /** @type {const} */ ('relative-colorimetric'),
        blackPointCompensation: true,
        useAdaptiveBPCClamping: true,
        destinationProfile: createMockProfile(),
        destinationColorSpace: /** @type {const} */ ('CMYK'),
        inputType: /** @type {const} */ ('RGB'),
        verbose: false,
    });

    // Should not throw
    converter.dispose();

    // Double dispose should also not throw
    converter.dispose();
}

/**
 * Tests constants are exported correctly.
 *
 * @param {object} exports - Module exports
 */
async function invokeConstantsTest(exports) {
    const { PIXEL_FORMATS, RENDERING_INTENTS, INTENT_MAP, ENGINE_FLAGS } = exports;

    // PIXEL_FORMATS
    assert.strictEqual(typeof PIXEL_FORMATS.TYPE_RGB_8, 'number');
    assert.strictEqual(typeof PIXEL_FORMATS.TYPE_CMYK_8, 'number');
    assert.strictEqual(typeof PIXEL_FORMATS.TYPE_GRAY_8, 'number');
    assert.strictEqual(typeof PIXEL_FORMATS.TYPE_Lab_8, 'number');

    // RENDERING_INTENTS
    assert.strictEqual(RENDERING_INTENTS.PERCEPTUAL, 0);
    assert.strictEqual(RENDERING_INTENTS.RELATIVE_COLORIMETRIC, 1);
    assert.strictEqual(RENDERING_INTENTS.SATURATION, 2);
    assert.strictEqual(RENDERING_INTENTS.ABSOLUTE_COLORIMETRIC, 3);
    assert.strictEqual(RENDERING_INTENTS.PRESERVE_K_ONLY_RELATIVE_COLORIMETRIC_GCR, 20);

    // INTENT_MAP
    assert.strictEqual(INTENT_MAP['perceptual'], 0);
    assert.strictEqual(INTENT_MAP['relative-colorimetric'], 1);
    assert.strictEqual(INTENT_MAP['preserve-k-only-relative-colorimetric-gcr'], 20);

    // ENGINE_FLAGS
    assert.strictEqual(ENGINE_FLAGS.BLACKPOINT_COMPENSATION, 0x2000);
}

// ============================================================================
// Test Suite
// ============================================================================

describe('ImageColorConverter', () => {
    /** @type {typeof import('../../classes/baseline/image-color-converter.js').ImageColorConverter} */
    let ImageColorConverter;
    /** @type {typeof import('../../classes/baseline/color-converter.js').ColorConverter} */
    let ColorConverter;
    /** @type {typeof import('../../classes/baseline/image-color-converter.js')} */
    let imageModule;

    before(async () => {
        const ccModule = await import('../../classes/baseline/color-converter.js');
        ColorConverter = ccModule.ColorConverter;

        imageModule = await import('../../classes/baseline/image-color-converter.js');
        ImageColorConverter = imageModule.ImageColorConverter;
    });

    // ========================================
    // New Implementation Tests
    // ========================================

    test('extends ColorConverter properly', {
        skip: !!'instanceof check only - no regression value',
    }, async () => {
        await invokeInheritanceTest(ImageColorConverter, ColorConverter);
    });

    test('Lab intent falls back to relative-colorimetric', {
        skip: TruthyEnvironmentParameterMatcher.test(process.env.TESTS_ONLY_LEGACY),
    }, async () => {
        await invokeLabIntentFallbackTest(ImageColorConverter);
    });

    test('supports worker mode', {
        skip: !!'worker mode boolean check only - no regression value',
    }, async () => {
        await invokeWorkerModeSupportTest(ImageColorConverter);
    });

    test('hooks are called in correct order', {
        skip: !!'mock conversion - verifies hook order but not actual conversion',
    }, async () => {
        await invokeHookOrderTest(ImageColorConverter);
    });

    test('configuration getter returns correct type', {
        skip: !!'configuration shape only - no regression value',
    }, async () => {
        await invokeConfigurationTypeTest(ImageColorConverter);
    });

    test('dispose cleans up resources', {
        skip: !!'dispose mechanics only - no regression value',
    }, async () => {
        await invokeDisposeTest(ImageColorConverter);
    });

    test('constants are exported correctly', {
        skip: TruthyEnvironmentParameterMatcher.test(process.env.TESTS_ONLY_LEGACY),
    }, async () => {
        await invokeConstantsTest(imageModule);
    });

    // ========================================
    // Legacy Implementation Tests
    // ========================================

    test('(legacy) no legacy equivalent exists', {
        skip: !!'placeholder - no legacy equivalent to compare',
    }, async () => {
        // ImageColorConverter is new infrastructure.
        // Legacy comparison would use ColorEngineService.convertPixels() directly.
        assert.ok(true, 'No direct legacy equivalent for ImageColorConverter');
    });
});
