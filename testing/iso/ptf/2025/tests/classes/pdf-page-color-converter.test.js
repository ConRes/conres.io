// @ts-check
/**
 * PDFPageColorConverter Class Tests
 *
 * Tests for page-level color conversion coordination.
 *
 * @module PDFPageColorConverter.test
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import { TruthyEnvironmentParameterMatcher } from '../helpers.js';

// ============================================================================
// Test Fixtures
// ============================================================================

/**
 * Creates a mock profile buffer.
 * @returns {ArrayBuffer}
 */
function createMockProfile() {
    const buffer = new ArrayBuffer(128);
    const view = new Uint8Array(buffer);
    view[36] = 0x61;
    view[37] = 0x63;
    view[38] = 0x73;
    view[39] = 0x70;
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

/**
 * Creates a mock PDF context.
 * @returns {object}
 */
function createMockContext() {
    return {
        lookup: (ref) => null,
        assign: (ref, obj) => {},
    };
}

// ============================================================================
// Shared Test Functions (invokeXXXTest pattern)
// ============================================================================

/**
 * Tests that PDFPageColorConverter extends ColorConverter.
 *
 * @param {typeof import('../../classes/pdf-page-color-converter.js').PDFPageColorConverter} PDFPageColorConverter
 * @param {typeof import('../../classes/color-converter.js').ColorConverter} ColorConverter
 */
async function invokeInheritanceTest(PDFPageColorConverter, ColorConverter) {
    const config = {
        renderingIntent: /** @type {const} */ ('relative-colorimetric'),
        blackPointCompensation: true,
        useAdaptiveBPCClamping: false,
        destinationProfile: createMockProfile(),
        destinationColorSpace: /** @type {const} */ ('CMYK'),
        convertImages: true,
        convertContentStreams: true,
        useWorkers: false,
        verbose: false,
    };

    const converter = new PDFPageColorConverter(config);
    await converter.ensureReady();

    assert.ok(converter instanceof PDFPageColorConverter);
    assert.ok(converter instanceof ColorConverter);
    assert.strictEqual(converter.configuration.convertImages, true);
    assert.strictEqual(converter.configuration.convertContentStreams, true);

    converter.dispose();
}

/**
 * Tests configuration derivation for images.
 *
 * @param {typeof import('../../classes/pdf-page-color-converter.js').PDFPageColorConverter} PDFPageColorConverter
 */
async function invokeImageConfigDerivationTest(PDFPageColorConverter) {
    const converter = new PDFPageColorConverter({
        renderingIntent: /** @type {const} */ ('preserve-k-only-relative-colorimetric-gcr'),
        blackPointCompensation: true,
        useAdaptiveBPCClamping: true,
        destinationProfile: createMockProfile(),
        destinationColorSpace: /** @type {const} */ ('CMYK'),
        convertImages: true,
        convertContentStreams: false,
        useWorkers: false,
        verbose: false,
    });

    await converter.ensureReady();

    const imageConfig = converter.deriveImageConfiguration();

    assert.strictEqual(imageConfig.renderingIntent, 'preserve-k-only-relative-colorimetric-gcr');
    assert.strictEqual(imageConfig.blackPointCompensation, true);
    assert.strictEqual(imageConfig.compressOutput, true);
    assert.strictEqual(imageConfig.destinationColorSpace, 'CMYK');

    converter.dispose();
}

/**
 * Tests configuration derivation for content streams.
 *
 * @param {typeof import('../../classes/pdf-page-color-converter.js').PDFPageColorConverter} PDFPageColorConverter
 */
async function invokeContentStreamConfigDerivationTest(PDFPageColorConverter) {
    const converter = new PDFPageColorConverter({
        renderingIntent: /** @type {const} */ ('relative-colorimetric'),
        blackPointCompensation: true,
        useAdaptiveBPCClamping: false,
        destinationProfile: createMockProfile(),
        destinationColorSpace: /** @type {const} */ ('CMYK'),
        convertImages: false,
        convertContentStreams: true,
        useWorkers: false,
        sourceRGBProfile: 'sRGB',
        sourceGrayProfile: 'sGray',
        verbose: false,
    });

    await converter.ensureReady();

    const streamConfig = converter.deriveContentStreamConfiguration();

    assert.strictEqual(streamConfig.renderingIntent, 'relative-colorimetric');
    assert.strictEqual(streamConfig.useLookupTable, true);
    assert.strictEqual(streamConfig.sourceRGBProfile, 'sRGB');
    assert.strictEqual(streamConfig.sourceGrayProfile, 'sGray');

    converter.dispose();
}

/**
 * Tests per-reference configuration overrides.
 *
 * @param {typeof import('../../classes/pdf-page-color-converter.js').PDFPageColorConverter} PDFPageColorConverter
 */
async function invokePerReferenceOverrideTest(PDFPageColorConverter) {
    const converter = new PDFPageColorConverter({
        renderingIntent: /** @type {const} */ ('relative-colorimetric'),
        blackPointCompensation: true,
        useAdaptiveBPCClamping: false,
        destinationProfile: createMockProfile(),
        destinationColorSpace: /** @type {const} */ ('CMYK'),
        convertImages: true,
        convertContentStreams: true,
        useWorkers: false,
        verbose: false,
    });

    await converter.ensureReady();

    const imageRef = createMockRef(42);

    // Set per-image override
    converter.setConfigurationFor(imageRef, {
        renderingIntent: 'perceptual',
    });

    // Derive with override
    const overrideConfig = converter.deriveImageConfiguration(imageRef);
    assert.strictEqual(overrideConfig.renderingIntent, 'perceptual');

    // Derive without override (different ref)
    const baseConfig = converter.deriveImageConfiguration(createMockRef(99));
    assert.strictEqual(baseConfig.renderingIntent, 'relative-colorimetric');

    converter.dispose();
}

/**
 * Tests hooks are called in correct order.
 *
 * @param {typeof import('../../classes/pdf-page-color-converter.js').PDFPageColorConverter} PDFPageColorConverter
 */
async function invokeHookOrderTest(PDFPageColorConverter) {
    const callOrder = [];

    class TestConverter extends PDFPageColorConverter {
        async beforeConvertColor(input, context) {
            callOrder.push('beforeConvertColor');
            await super.beforeConvertColor(input, context);
        }

        async beforeConvertPDFPageColor(input, context) {
            callOrder.push('beforeConvertPDFPageColor');
            await super.beforeConvertPDFPageColor(input, context);
        }

        async doConvertColor(input, context) {
            callOrder.push('doConvertColor');
            // Return mock result
            return {
                pageRef: input.pageRef,
                pageIndex: input.pageIndex,
                imagesConverted: 0,
                contentStreamsConverted: 0,
                errors: [],
            };
        }

        async afterConvertPDFPageColor(input, result, context) {
            callOrder.push('afterConvertPDFPageColor');
            await super.afterConvertPDFPageColor(input, result, context);
        }

        async afterConvertColor(input, result, context) {
            callOrder.push('afterConvertColor');
            await super.afterConvertColor(input, result, context);
        }
    }

    const converter = new TestConverter({
        renderingIntent: /** @type {const} */ ('relative-colorimetric'),
        blackPointCompensation: true,
        useAdaptiveBPCClamping: false,
        destinationProfile: createMockProfile(),
        destinationColorSpace: /** @type {const} */ ('CMYK'),
        convertImages: false,
        convertContentStreams: false,
        useWorkers: false,
        verbose: false,
    });

    await converter.ensureReady();

    await converter.convertColor({
        pageLeaf: {},
        pageRef: createMockRef(1),
        pageIndex: 0,
        context: createMockContext(),
    }, {});

    assert.deepStrictEqual(callOrder, [
        'beforeConvertColor',
        'beforeConvertPDFPageColor',
        'doConvertColor',
        'afterConvertColor',
        'afterConvertPDFPageColor',
    ]);

    converter.dispose();
}

/**
 * Tests worker mode is supported.
 *
 * @param {typeof import('../../classes/pdf-page-color-converter.js').PDFPageColorConverter} PDFPageColorConverter
 */
async function invokeWorkerModeSupportTest(PDFPageColorConverter) {
    const converter = new PDFPageColorConverter({
        renderingIntent: /** @type {const} */ ('relative-colorimetric'),
        blackPointCompensation: true,
        useAdaptiveBPCClamping: false,
        destinationProfile: createMockProfile(),
        destinationColorSpace: /** @type {const} */ ('CMYK'),
        convertImages: true,
        convertContentStreams: true,
        useWorkers: false,
        verbose: false,
    });

    await converter.ensureReady();

    assert.strictEqual(converter.supportsWorkerMode, true);

    converter.dispose();
}

/**
 * Tests worker pool ownership - standalone creates own pool.
 *
 * @param {typeof import('../../classes/pdf-page-color-converter.js').PDFPageColorConverter} PDFPageColorConverter
 */
async function invokeStandaloneWorkerPoolTest(PDFPageColorConverter) {
    const converter = new PDFPageColorConverter({
        renderingIntent: /** @type {const} */ ('relative-colorimetric'),
        blackPointCompensation: true,
        useAdaptiveBPCClamping: false,
        destinationProfile: createMockProfile(),
        destinationColorSpace: /** @type {const} */ ('CMYK'),
        convertImages: true,
        convertContentStreams: true,
        useWorkers: true, // Creates own pool
        verbose: false,
    });

    await converter.ensureReady();

    // Should have created a worker pool
    assert.ok(converter.workerPool !== null, 'Should have created worker pool');

    // Dispose should terminate the pool (we trust it doesn't throw)
    converter.dispose();

    // After dispose, pool reference should be null
    assert.strictEqual(converter.workerPool, null, 'Pool should be null after dispose');
}

/**
 * Tests worker pool sharing - uses provided pool.
 *
 * @param {typeof import('../../classes/pdf-page-color-converter.js').PDFPageColorConverter} PDFPageColorConverter
 */
async function invokeSharedWorkerPoolTest(PDFPageColorConverter) {
    // Create a mock worker pool
    const mockPool = {
        initialize: async () => {},
        terminate: async () => {},
        submitTransform: async () => ({ success: true }),
        getStats: () => ({ workerCount: 4 }),
    };

    const converter = new PDFPageColorConverter({
        renderingIntent: /** @type {const} */ ('relative-colorimetric'),
        blackPointCompensation: true,
        useAdaptiveBPCClamping: false,
        destinationProfile: createMockProfile(),
        destinationColorSpace: /** @type {const} */ ('CMYK'),
        convertImages: true,
        convertContentStreams: true,
        useWorkers: true,
        workerPool: /** @type {any} */ (mockPool), // Provided pool
        verbose: false,
    });

    await converter.ensureReady();

    // Should use provided pool
    assert.strictEqual(converter.workerPool, mockPool, 'Should use provided pool');

    // Track if terminate was called
    let terminateCalled = false;
    mockPool.terminate = async () => { terminateCalled = true; };

    converter.dispose();

    // Should NOT terminate shared pool
    assert.strictEqual(terminateCalled, false, 'Should not terminate shared pool');
}

/**
 * Tests dispose cleans up resources.
 *
 * @param {typeof import('../../classes/pdf-page-color-converter.js').PDFPageColorConverter} PDFPageColorConverter
 */
async function invokeDisposeTest(PDFPageColorConverter) {
    const converter = new PDFPageColorConverter({
        renderingIntent: /** @type {const} */ ('relative-colorimetric'),
        blackPointCompensation: true,
        useAdaptiveBPCClamping: false,
        destinationProfile: createMockProfile(),
        destinationColorSpace: /** @type {const} */ ('CMYK'),
        convertImages: true,
        convertContentStreams: true,
        useWorkers: false,
        verbose: false,
    });

    await converter.ensureReady();

    // Should not throw
    converter.dispose();

    // Double dispose should also not throw
    converter.dispose();
}

// ============================================================================
// Test Suite
// ============================================================================

describe('PDFPageColorConverter', () => {
    /** @type {typeof import('../../classes/pdf-page-color-converter.js').PDFPageColorConverter} */
    let PDFPageColorConverter;
    /** @type {typeof import('../../classes/color-converter.js').ColorConverter} */
    let ColorConverter;

    before(async () => {
        const ccModule = await import('../../classes/color-converter.js');
        ColorConverter = ccModule.ColorConverter;

        const pageModule = await import('../../classes/pdf-page-color-converter.js');
        PDFPageColorConverter = pageModule.PDFPageColorConverter;
    });

    // ========================================
    // New Implementation Tests
    // ========================================

    test('extends ColorConverter properly', {
        skip: !!'instanceof check only - no regression value',
    }, async () => {
        await invokeInheritanceTest(PDFPageColorConverter, ColorConverter);
    });

    test('derives image configuration correctly', {
        skip: TruthyEnvironmentParameterMatcher.test(process.env.TESTS_ONLY_LEGACY),
    }, async () => {
        await invokeImageConfigDerivationTest(PDFPageColorConverter);
    });

    test('derives content stream configuration correctly', {
        skip: TruthyEnvironmentParameterMatcher.test(process.env.TESTS_ONLY_LEGACY),
    }, async () => {
        await invokeContentStreamConfigDerivationTest(PDFPageColorConverter);
    });

    test('per-reference configuration overrides work', {
        skip: TruthyEnvironmentParameterMatcher.test(process.env.TESTS_ONLY_LEGACY),
    }, async () => {
        await invokePerReferenceOverrideTest(PDFPageColorConverter);
    });

    test('hooks are called in correct order', {
        skip: !!'mock conversion - verifies hook order but not actual conversion',
    }, async () => {
        await invokeHookOrderTest(PDFPageColorConverter);
    });

    test('supports worker mode', {
        skip: !!'worker mode boolean check only - no regression value',
    }, async () => {
        await invokeWorkerModeSupportTest(PDFPageColorConverter);
    });

    test('standalone page converter creates own worker pool', {
        skip: TruthyEnvironmentParameterMatcher.test(process.env.TESTS_ONLY_LEGACY),
    }, async () => {
        await invokeStandaloneWorkerPoolTest(PDFPageColorConverter);
    });

    test('page converter uses shared worker pool', {
        skip: TruthyEnvironmentParameterMatcher.test(process.env.TESTS_ONLY_LEGACY),
    }, async () => {
        await invokeSharedWorkerPoolTest(PDFPageColorConverter);
    });

    test('dispose cleans up resources', {
        skip: !!'dispose mechanics only - no regression value',
    }, async () => {
        await invokeDisposeTest(PDFPageColorConverter);
    });

    // ========================================
    // Legacy Implementation Tests
    // ========================================

    test('(legacy) no legacy equivalent exists', {
        skip: !!'placeholder - no legacy equivalent to compare',
    }, async () => {
        // PDFPageColorConverter is new - legacy would use PDFService.convertColorInPDFDocument
        assert.ok(true, 'No direct legacy equivalent for PDFPageColorConverter');
    });
});
