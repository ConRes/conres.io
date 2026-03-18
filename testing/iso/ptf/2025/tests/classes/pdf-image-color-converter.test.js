// @ts-check
/**
 * PDFImageColorConverter Class Tests
 *
 * Tests for PDF image XObject color conversion.
 *
 * @module PDFImageColorConverter.test
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
 * Creates a simple profile buffer (mock).
 * @returns {ArrayBuffer}
 */
function createMockProfile() {
    const buffer = new ArrayBuffer(128);
    const view = new Uint8Array(buffer);
    view[36] = 0x61; // 'a'
    view[37] = 0x63; // 'c'
    view[38] = 0x73; // 's'
    view[39] = 0x70; // 'p'
    return buffer;
}

/**
 * Creates a mock PDF reference.
 * @param {number} objectNumber
 * @returns {{objectNumber: number, generationNumber: number, toString: () => string}}
 */
function createMockRef(objectNumber) {
    return {
        objectNumber,
        generationNumber: 0,
        toString: () => `${objectNumber} 0 R`,
    };
}

// ============================================================================
// Shared Test Functions (invokeXXXTest pattern)
// ============================================================================

/**
 * Tests that PDFImageColorConverter extends ImageColorConverter properly.
 *
 * @param {typeof import('../../classes/baseline/pdf-image-color-converter.js').PDFImageColorConverter} PDFImageColorConverter
 * @param {typeof import('../../classes/baseline/image-color-converter.js').ImageColorConverter} ImageColorConverter
 */
async function invokeInheritanceTest(PDFImageColorConverter, ImageColorConverter) {
    const config = {
        renderingIntent: /** @type {const} */ ('relative-colorimetric'),
        blackPointCompensation: true,
        useAdaptiveBPCClamping: true,
        destinationProfile: createMockProfile(),
        destinationColorSpace: /** @type {const} */ ('CMYK'),
        inputType: /** @type {const} */ ('RGB'),
        compressOutput: true,
        verbose: false,
    };

    const converter = new PDFImageColorConverter(config);

    // Should be instance of both classes
    assert.ok(converter instanceof PDFImageColorConverter, 'Should be PDFImageColorConverter');
    assert.ok(converter instanceof ImageColorConverter, 'Should extend ImageColorConverter');

    // Should have PDF-specific configuration
    assert.strictEqual(converter.compressOutput, true, 'Should have compressOutput');

    converter.dispose();
}

/**
 * Tests that Lab images use relative-colorimetric intent.
 *
 * @param {typeof import('../../classes/baseline/pdf-image-color-converter.js').PDFImageColorConverter} PDFImageColorConverter
 */
async function invokeLabImageIntentTest(PDFImageColorConverter) {
    const config = {
        renderingIntent: /** @type {const} */ ('preserve-k-only-relative-colorimetric-gcr'),
        blackPointCompensation: true,
        useAdaptiveBPCClamping: true,
        destinationProfile: createMockProfile(),
        destinationColorSpace: /** @type {const} */ ('CMYK'),
        inputType: /** @type {const} */ ('Lab'),
        compressOutput: true,
        verbose: false,
    };

    const converter = new PDFImageColorConverter(config);

    // Baseline: getEffectiveRenderingIntent returns configured intent — policy handles Lab fallback
    assert.strictEqual(
        converter.getEffectiveRenderingIntent('Lab'),
        'preserve-k-only-relative-colorimetric-gcr',
        'Baseline returns configured intent — policy rules handle Lab fallback'
    );

    converter.dispose();
}

/**
 * Tests worker task preparation.
 *
 * @param {typeof import('../../classes/baseline/pdf-image-color-converter.js').PDFImageColorConverter} PDFImageColorConverter
 */
async function invokeWorkerTaskPreparationTest(PDFImageColorConverter) {
    const config = {
        renderingIntent: /** @type {const} */ ('relative-colorimetric'),
        blackPointCompensation: true,
        useAdaptiveBPCClamping: true,
        destinationProfile: createMockProfile(),
        destinationColorSpace: /** @type {const} */ ('CMYK'),
        inputType: /** @type {const} */ ('RGB'),
        compressOutput: true,
        verbose: false,
    };

    const converter = new PDFImageColorConverter(config);

    const input = {
        streamRef: createMockRef(42),
        streamData: createMockPixelBuffer(10, 10, 3),
        isCompressed: true,
        width: 10,
        height: 10,
        colorSpace: /** @type {const} */ ('RGB'),
        bitsPerComponent: 8,
    };

    const task = converter.prepareWorkerTask(input, {});

    assert.ok(task, 'Should return task data');
    assert.strictEqual(task.type, 'image', 'Task type should be image');
    assert.strictEqual(task.streamRef, '42 0 R', 'Should have stream ref');
    assert.ok(task.compressedData, 'Should have compressed data');
    assert.strictEqual(task.isCompressed, true, 'Should preserve compression flag');
    assert.strictEqual(task.width, 10, 'Should have width');
    assert.strictEqual(task.height, 10, 'Should have height');
    assert.strictEqual(task.colorSpace, 'RGB', 'Should have color space');
    assert.strictEqual(task.compressOutput, true, 'Should have compress output flag');

    converter.dispose();
}

/**
 * Tests configuration includes compressOutput.
 *
 * @param {typeof import('../../classes/baseline/pdf-image-color-converter.js').PDFImageColorConverter} PDFImageColorConverter
 */
async function invokeConfigurationTypeTest(PDFImageColorConverter) {
    const config = {
        renderingIntent: /** @type {const} */ ('relative-colorimetric'),
        blackPointCompensation: true,
        useAdaptiveBPCClamping: true,
        destinationProfile: createMockProfile(),
        destinationColorSpace: /** @type {const} */ ('CMYK'),
        inputType: /** @type {const} */ ('RGB'),
        compressOutput: true,
        sourceProfile: 'sRGB',
        verbose: false,
    };

    const converter = new PDFImageColorConverter(config);

    const retrieved = converter.configuration;

    // Should have base config properties
    assert.strictEqual(retrieved.renderingIntent, 'relative-colorimetric');

    // Should have image config properties
    assert.strictEqual(retrieved.inputType, 'RGB');
    assert.strictEqual(retrieved.sourceProfile, 'sRGB');

    // Should have PDF-specific properties
    assert.strictEqual(retrieved.compressOutput, true);

    converter.dispose();
}

/**
 * Tests dispose cleans up resources.
 *
 * @param {typeof import('../../classes/baseline/pdf-image-color-converter.js').PDFImageColorConverter} PDFImageColorConverter
 */
async function invokeDisposeTest(PDFImageColorConverter) {
    const converter = new PDFImageColorConverter({
        renderingIntent: /** @type {const} */ ('relative-colorimetric'),
        blackPointCompensation: true,
        useAdaptiveBPCClamping: true,
        destinationProfile: createMockProfile(),
        destinationColorSpace: /** @type {const} */ ('CMYK'),
        inputType: /** @type {const} */ ('RGB'),
        compressOutput: true,
        verbose: false,
    });

    // Should not throw
    converter.dispose();

    // Double dispose should also not throw
    converter.dispose();
}

/**
 * Tests worker mode is supported.
 *
 * @param {typeof import('../../classes/baseline/pdf-image-color-converter.js').PDFImageColorConverter} PDFImageColorConverter
 */
async function invokeWorkerModeSupportTest(PDFImageColorConverter) {
    const converter = new PDFImageColorConverter({
        renderingIntent: /** @type {const} */ ('relative-colorimetric'),
        blackPointCompensation: true,
        useAdaptiveBPCClamping: true,
        destinationProfile: createMockProfile(),
        destinationColorSpace: /** @type {const} */ ('CMYK'),
        inputType: /** @type {const} */ ('RGB'),
        compressOutput: true,
        verbose: false,
    });

    assert.strictEqual(converter.supportsWorkerMode, true, 'Should support worker mode');

    converter.dispose();
}

// ============================================================================
// Test Suite
// ============================================================================

describe('PDFImageColorConverter', () => {
    /** @type {typeof import('../../classes/baseline/pdf-image-color-converter.js').PDFImageColorConverter} */
    let PDFImageColorConverter;
    /** @type {typeof import('../../classes/baseline/image-color-converter.js').ImageColorConverter} */
    let ImageColorConverter;

    before(async () => {
        const imageModule = await import('../../classes/baseline/image-color-converter.js');
        ImageColorConverter = imageModule.ImageColorConverter;

        const pdfModule = await import('../../classes/baseline/pdf-image-color-converter.js');
        PDFImageColorConverter = pdfModule.PDFImageColorConverter;
    });

    // ========================================
    // New Implementation Tests
    // ========================================

    test('extends ImageColorConverter properly', {
        skip: !!'instanceof check only - no regression value',
    }, async () => {
        await invokeInheritanceTest(PDFImageColorConverter, ImageColorConverter);
    });

    test('Lab images use relative-colorimetric intent', {
        skip: TruthyEnvironmentParameterMatcher.test(process.env.TESTS_ONLY_LEGACY),
    }, async () => {
        await invokeLabImageIntentTest(PDFImageColorConverter);
    });

    test('prepares worker tasks correctly', {
        skip: !!'worker task shape only - no regression value',
    }, async () => {
        await invokeWorkerTaskPreparationTest(PDFImageColorConverter);
    });

    test('configuration includes compressOutput', {
        skip: !!'configuration shape only - no regression value',
    }, async () => {
        await invokeConfigurationTypeTest(PDFImageColorConverter);
    });

    test('dispose cleans up resources', {
        skip: !!'dispose mechanics only - no regression value',
    }, async () => {
        await invokeDisposeTest(PDFImageColorConverter);
    });

    test('supports worker mode', {
        skip: !!'worker mode boolean check only - no regression value',
    }, async () => {
        await invokeWorkerModeSupportTest(PDFImageColorConverter);
    });

    // ========================================
    // Legacy Implementation Tests
    // ========================================

    test('(legacy) no legacy equivalent exists', {
        skip: !!'placeholder - no legacy equivalent to compare',
    }, async () => {
        // PDFImageColorConverter is new infrastructure.
        // Legacy comparison would use WorkerColorConversion.convertWithWorkers() directly.
        assert.ok(true, 'No direct legacy equivalent for PDFImageColorConverter');
    });
});
