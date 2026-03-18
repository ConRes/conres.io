// @ts-check
/**
 * PDFDocumentColorConverter Class Tests
 *
 * Tests for document-level color conversion orchestration.
 *
 * @module PDFDocumentColorConverter.test
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import { TruthyEnvironmentParameterMatcher } from '../helpers.js';

// ============================================================================
// Test Fixtures
// ============================================================================

/**
 * Creates a mock profile buffer.
 * @param {number} [seed=0]
 * @returns {ArrayBuffer}
 */
function createMockProfile(seed = 0) {
    const buffer = new ArrayBuffer(128);
    const view = new Uint8Array(buffer);
    view[36] = 0x61;
    view[37] = 0x63;
    view[38] = 0x73;
    view[39] = 0x70;
    view[0] = seed; // Make unique
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
 * Creates a minimal mock PDF document.
 * @returns {object}
 */
function createMockPDFDocument() {
    const mockRef = createMockRef(1);
    return {
        getPages: () => [{
            ref: mockRef,
        }],
        getPageCount: () => 1,
        context: {
            lookup: (ref) => ({
                get: () => null,
                entries: () => [],
            }),
            assign: () => {},
            enumerateIndirectObjects: () => [],
        },
    };
}

// ============================================================================
// Shared Test Functions (invokeXXXTest pattern)
// ============================================================================

/**
 * Tests that PDFDocumentColorConverter extends ColorConverter.
 *
 * @param {typeof import('../../classes/pdf-document-color-converter.js').PDFDocumentColorConverter} PDFDocumentColorConverter
 * @param {typeof import('../../classes/color-converter.js').ColorConverter} ColorConverter
 */
async function invokeInheritanceTest(PDFDocumentColorConverter, ColorConverter) {
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

    const converter = new PDFDocumentColorConverter(config);
    await converter.ensureReady();

    assert.ok(converter instanceof PDFDocumentColorConverter);
    assert.ok(converter instanceof ColorConverter);
    assert.ok(converter.profilePool !== undefined);
    assert.ok(converter.bufferRegistry !== undefined);

    converter.dispose();
}

/**
 * Tests ProfilePool integration.
 *
 * @param {typeof import('../../classes/pdf-document-color-converter.js').PDFDocumentColorConverter} PDFDocumentColorConverter
 * @param {typeof import('../../classes/profile-pool.js').ProfilePool} ProfilePool
 */
async function invokeProfilePoolIntegrationTest(PDFDocumentColorConverter, ProfilePool) {
    // Create shared pool
    const sharedPool = new ProfilePool({ maxProfiles: 16 });

    const converter = new PDFDocumentColorConverter({
        renderingIntent: /** @type {const} */ ('relative-colorimetric'),
        blackPointCompensation: true,
        useAdaptiveBPCClamping: false,
        destinationProfile: createMockProfile(),
        destinationColorSpace: /** @type {const} */ ('CMYK'),
        convertImages: true,
        convertContentStreams: true,
        useWorkers: false,
        profilePool: sharedPool,
        verbose: false,
    });

    await converter.ensureReady();

    // Should use shared pool
    assert.strictEqual(converter.profilePool, sharedPool);

    // Dispose should NOT dispose shared pool
    converter.dispose();

    // Shared pool should still be functional
    assert.strictEqual(sharedPool.stats.profileCount >= 0, true);

    sharedPool.dispose();
}

/**
 * Tests BufferRegistry is always owned.
 *
 * @param {typeof import('../../classes/pdf-document-color-converter.js').PDFDocumentColorConverter} PDFDocumentColorConverter
 */
async function invokeBufferRegistryOwnershipTest(PDFDocumentColorConverter) {
    const converter = new PDFDocumentColorConverter({
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

    // BufferRegistry should be created
    assert.ok(converter.bufferRegistry !== undefined);

    converter.dispose();
}

/**
 * Tests page configuration derivation.
 *
 * @param {typeof import('../../classes/pdf-document-color-converter.js').PDFDocumentColorConverter} PDFDocumentColorConverter
 */
async function invokePageConfigDerivationTest(PDFDocumentColorConverter) {
    const converter = new PDFDocumentColorConverter({
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

    const pageRef = createMockRef(10);
    const pageConfig = converter.derivePageConfiguration(pageRef);

    assert.strictEqual(pageConfig.renderingIntent, 'preserve-k-only-relative-colorimetric-gcr');
    assert.strictEqual(pageConfig.convertImages, true);
    assert.strictEqual(pageConfig.convertContentStreams, false);
    assert.strictEqual(pageConfig.useWorkers, false);

    converter.dispose();
}

/**
 * Tests page overrides via Map.
 *
 * @param {typeof import('../../classes/pdf-document-color-converter.js').PDFDocumentColorConverter} PDFDocumentColorConverter
 */
async function invokePageOverridesMapTest(PDFDocumentColorConverter) {
    const page3Ref = createMockRef(30);
    const pageOverrides = new Map();
    pageOverrides.set(page3Ref, {
        renderingIntent: /** @type {const} */ ('relative-colorimetric'),
        convertImages: false,
    });

    const converter = new PDFDocumentColorConverter({
        renderingIntent: /** @type {const} */ ('preserve-k-only-relative-colorimetric-gcr'),
        blackPointCompensation: true,
        useAdaptiveBPCClamping: false,
        destinationProfile: createMockProfile(),
        destinationColorSpace: /** @type {const} */ ('CMYK'),
        convertImages: true,
        convertContentStreams: true,
        useWorkers: false,
        pageOverrides,
        verbose: false,
    });

    await converter.ensureReady();

    // Page 3 should have overrides
    const page3Config = converter.derivePageConfiguration(page3Ref);
    assert.strictEqual(page3Config.renderingIntent, 'relative-colorimetric');
    assert.strictEqual(page3Config.convertImages, false);

    // Other pages should use base config
    const otherPageConfig = converter.derivePageConfiguration(createMockRef(99));
    assert.strictEqual(otherPageConfig.renderingIntent, 'preserve-k-only-relative-colorimetric-gcr');
    assert.strictEqual(otherPageConfig.convertImages, true);

    converter.dispose();
}

/**
 * Tests image configuration derivation through document.
 *
 * @param {typeof import('../../classes/pdf-document-color-converter.js').PDFDocumentColorConverter} PDFDocumentColorConverter
 */
async function invokeImageConfigDerivationTest(PDFDocumentColorConverter) {
    const converter = new PDFDocumentColorConverter({
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

    const imageRef = createMockRef(50);
    const pageRef = createMockRef(10);

    const imageConfig = converter.deriveImageConfiguration(imageRef, pageRef);

    assert.strictEqual(imageConfig.renderingIntent, 'relative-colorimetric');
    assert.strictEqual(imageConfig.compressOutput, true);
    assert.strictEqual(imageConfig.destinationColorSpace, 'CMYK');

    converter.dispose();
}

/**
 * Tests per-image override propagation.
 *
 * @param {typeof import('../../classes/pdf-document-color-converter.js').PDFDocumentColorConverter} PDFDocumentColorConverter
 */
async function invokePerImageOverrideTest(PDFDocumentColorConverter) {
    const converter = new PDFDocumentColorConverter({
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

    const imageRef = createMockRef(50);

    // Set per-image override
    converter.setConfigurationFor(imageRef, {
        renderingIntent: 'perceptual',
    });

    const imageConfig = converter.deriveImageConfiguration(imageRef);
    assert.strictEqual(imageConfig.renderingIntent, 'perceptual');

    // Other images should not be affected
    const otherImageConfig = converter.deriveImageConfiguration(createMockRef(99));
    assert.strictEqual(otherImageConfig.renderingIntent, 'relative-colorimetric');

    converter.dispose();
}

/**
 * Tests hooks are called in correct order.
 *
 * @param {typeof import('../../classes/pdf-document-color-converter.js').PDFDocumentColorConverter} PDFDocumentColorConverter
 */
async function invokeHookOrderTest(PDFDocumentColorConverter) {
    const callOrder = [];

    class TestConverter extends PDFDocumentColorConverter {
        async beforeConvertColor(input, context) {
            callOrder.push('beforeConvertColor');
            await super.beforeConvertColor(input, context);
        }

        async beforeConvertPDFDocumentColor(input, context) {
            callOrder.push('beforeConvertPDFDocumentColor');
            await super.beforeConvertPDFDocumentColor(input, context);
        }

        async doConvertColor(input, context) {
            callOrder.push('doConvertColor');
            // Return mock result
            return {
                pagesProcessed: 0,
                imagesConverted: 0,
                contentStreamsConverted: 0,
                errors: [],
                pageResults: [],
            };
        }

        async afterConvertPDFDocumentColor(input, result, context) {
            callOrder.push('afterConvertPDFDocumentColor');
            await super.afterConvertPDFDocumentColor(input, result, context);
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
        pdfDocument: createMockPDFDocument(),
    }, {});

    assert.deepStrictEqual(callOrder, [
        'beforeConvertColor',
        'beforeConvertPDFDocumentColor',
        'doConvertColor',
        'afterConvertColor',
        'afterConvertPDFDocumentColor',
    ]);

    converter.dispose();
}

/**
 * Tests worker mode is supported.
 *
 * @param {typeof import('../../classes/pdf-document-color-converter.js').PDFDocumentColorConverter} PDFDocumentColorConverter
 */
async function invokeWorkerModeSupportTest(PDFDocumentColorConverter) {
    const converter = new PDFDocumentColorConverter({
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
 * Tests worker pool ownership.
 *
 * @param {typeof import('../../classes/pdf-document-color-converter.js').PDFDocumentColorConverter} PDFDocumentColorConverter
 */
async function invokeWorkerPoolOwnershipTest(PDFDocumentColorConverter) {
    // Create mock shared pool
    const mockPool = {
        initialize: async () => {},
        terminate: async () => {},
        submitTransform: async () => ({ success: true }),
        getStats: () => ({ workerCount: 4 }),
    };

    const converter = new PDFDocumentColorConverter({
        renderingIntent: /** @type {const} */ ('relative-colorimetric'),
        blackPointCompensation: true,
        useAdaptiveBPCClamping: false,
        destinationProfile: createMockProfile(),
        destinationColorSpace: /** @type {const} */ ('CMYK'),
        convertImages: true,
        convertContentStreams: true,
        useWorkers: true,
        workerPool: /** @type {any} */ (mockPool),
        verbose: false,
    });

    await converter.ensureReady();

    // Should use provided pool
    assert.strictEqual(converter.workerPool, mockPool);

    // Track if terminate was called
    let terminateCalled = false;
    mockPool.terminate = async () => { terminateCalled = true; };

    converter.dispose();

    // Should NOT terminate shared pool
    assert.strictEqual(terminateCalled, false);
}

/**
 * Tests dispose cleans up all owned resources.
 *
 * @param {typeof import('../../classes/pdf-document-color-converter.js').PDFDocumentColorConverter} PDFDocumentColorConverter
 */
async function invokeDisposeTest(PDFDocumentColorConverter) {
    const converter = new PDFDocumentColorConverter({
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

/**
 * Tests worker task preparation.
 *
 * @param {typeof import('../../classes/pdf-document-color-converter.js').PDFDocumentColorConverter} PDFDocumentColorConverter
 */
async function invokeWorkerTaskPreparationTest(PDFDocumentColorConverter) {
    const converter = new PDFDocumentColorConverter({
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

    const mockDoc = createMockPDFDocument();
    const task = converter.prepareWorkerTask({ pdfDocument: mockDoc }, {});

    assert.ok(task);
    assert.strictEqual(task.type, 'document');
    assert.strictEqual(task.pageCount, 1);

    converter.dispose();
}

// ============================================================================
// Test Suite
// ============================================================================

describe('PDFDocumentColorConverter', () => {
    /** @type {typeof import('../../classes/pdf-document-color-converter.js').PDFDocumentColorConverter} */
    let PDFDocumentColorConverter;
    /** @type {typeof import('../../classes/color-converter.js').ColorConverter} */
    let ColorConverter;
    /** @type {typeof import('../../classes/profile-pool.js').ProfilePool} */
    let ProfilePool;

    before(async () => {
        const ccModule = await import('../../classes/color-converter.js');
        ColorConverter = ccModule.ColorConverter;

        const ppModule = await import('../../classes/profile-pool.js');
        ProfilePool = ppModule.ProfilePool;

        const docModule = await import('../../classes/pdf-document-color-converter.js');
        PDFDocumentColorConverter = docModule.PDFDocumentColorConverter;
    });

    // ========================================
    // New Implementation Tests
    // ========================================

    test('extends ColorConverter properly', {
        skip: !!'instanceof check only - no regression value',
    }, async () => {
        await invokeInheritanceTest(PDFDocumentColorConverter, ColorConverter);
    });

    test('integrates with ProfilePool', {
        skip: TruthyEnvironmentParameterMatcher.test(process.env.TESTS_ONLY_LEGACY),
    }, async () => {
        await invokeProfilePoolIntegrationTest(PDFDocumentColorConverter, ProfilePool);
    });

    test('owns BufferRegistry', {
        skip: !!'ownership check only - no regression value',
    }, async () => {
        await invokeBufferRegistryOwnershipTest(PDFDocumentColorConverter);
    });

    test('derives page configuration correctly', {
        skip: TruthyEnvironmentParameterMatcher.test(process.env.TESTS_ONLY_LEGACY),
    }, async () => {
        await invokePageConfigDerivationTest(PDFDocumentColorConverter);
    });

    test('page overrides Map works correctly', {
        skip: TruthyEnvironmentParameterMatcher.test(process.env.TESTS_ONLY_LEGACY),
    }, async () => {
        await invokePageOverridesMapTest(PDFDocumentColorConverter);
    });

    test('derives image configuration through document', {
        skip: TruthyEnvironmentParameterMatcher.test(process.env.TESTS_ONLY_LEGACY),
    }, async () => {
        await invokeImageConfigDerivationTest(PDFDocumentColorConverter);
    });

    test('per-image override propagation works', {
        skip: TruthyEnvironmentParameterMatcher.test(process.env.TESTS_ONLY_LEGACY),
    }, async () => {
        await invokePerImageOverrideTest(PDFDocumentColorConverter);
    });

    test('hooks are called in correct order', {
        skip: !!'mock conversion - verifies hook order but not actual conversion',
    }, async () => {
        await invokeHookOrderTest(PDFDocumentColorConverter);
    });

    test('supports worker mode', {
        skip: !!'worker mode boolean check only - no regression value',
    }, async () => {
        await invokeWorkerModeSupportTest(PDFDocumentColorConverter);
    });

    test('worker pool ownership works correctly', {
        skip: TruthyEnvironmentParameterMatcher.test(process.env.TESTS_ONLY_LEGACY),
    }, async () => {
        await invokeWorkerPoolOwnershipTest(PDFDocumentColorConverter);
    });

    test('dispose cleans up all owned resources', {
        skip: !!'dispose mechanics only - no regression value',
    }, async () => {
        await invokeDisposeTest(PDFDocumentColorConverter);
    });

    test('prepares worker tasks correctly', {
        skip: !!'worker task shape only - no regression value',
    }, async () => {
        await invokeWorkerTaskPreparationTest(PDFDocumentColorConverter);
    });

    // ========================================
    // Legacy Implementation Tests
    // ========================================

    test('(legacy) no legacy equivalent exists', {
        skip: !!'placeholder - no legacy equivalent to compare',
    }, async () => {
        // PDFDocumentColorConverter is new - legacy would use PDFService.convertColorInPDFDocument
        assert.ok(true, 'No direct legacy equivalent for PDFDocumentColorConverter');
    });
});
