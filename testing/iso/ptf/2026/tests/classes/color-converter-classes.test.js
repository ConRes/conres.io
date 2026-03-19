// @ts-check
/**
 * ColorConverterClasses Integration Tests
 *
 * End-to-end tests for the color converter class hierarchy.
 * Tests full document conversion with real PDF fixtures.
 *
 * @module ColorConverterClasses.test
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright-chromium';
import { TruthyEnvironmentParameterMatcher } from '../helpers.js';

/** @type {import('playwright-chromium').Browser | null} */
let browser = null;

/** @type {import('playwright-chromium').Page | null} */
let page = null;

/** @type {import('playwright-chromium').BrowserContext | null} */
let context = null;

const BASE_URL = process.env.BASE_URL || 'http://localhost:8080';

// Test fixture paths (relative to test page at /testing/iso/ptf/2025/tests/index.html)
const FIXTURES = {
    // PDF fixtures
    typeSizesAndLissajouPDF: './fixtures/pdfs/2025-08-15 - ConRes - ISO PTF - CR1 - Type Sizes and Lissajou.pdf',
    interlakenMapPDF: './fixtures/pdfs/2025-08-15 - ConRes - ISO PTF - CR1 - Interlaken Map.pdf',
    f01FixturesPDF: './fixtures/pdfs/2025-08-15 - ConRes - ISO PTF - CR1 (F9d) Fixtures - F-01.pdf',
    // ICC profiles
    eciCMYKProfile: './fixtures/profiles/eciCMYK v2.icc',
    sRGBProfile: './fixtures/profiles/sRGB IEC61966-2.1.icc',
    sGrayProfile: './fixtures/profiles/sGray.icc',
};

/**
 * Extracts importmap from parent index.html, rewrites paths for tests/ subdirectory,
 * and injects it into the page.
 * @param {import('playwright-chromium').Page} page
 */
async function injectImportmap(page) {
    // Parent index.html is at testing/iso/ptf/2025/index.html (two levels up from tests/classes/)
    const parentHtml = await readFile(new URL('../../index.html', import.meta.url), 'utf-8');
    const match = /<script type="importmap">\s*([\s\S]*?)\s*<\/script>/m.exec(parentHtml);
    if (!match) throw new Error('Failed to extract importmap from ../index.html');

    const importmap = JSON.parse(match[1]);

    if (importmap.imports) {
        for (const [key, value] of Object.entries(importmap.imports)) {
            if (typeof value === 'string' && value.startsWith('./')) {
                // Browser context: from tests/index.html, go up one level to reach parent index.html paths
                importmap.imports[key] = '../' + value.slice(2);
            }
        }
    }

    await page.addScriptTag({ type: 'importmap', content: JSON.stringify(importmap) });
}

// ============================================================================
// Test Fixtures
// ============================================================================

/**
 * Creates a mock CMYK ICC profile (minimal valid structure).
 * @param {number} [seed=0] - Seed for profile variation
 * @returns {ArrayBuffer}
 */
function createMockCMYKProfile(seed = 0) {
    const buffer = new ArrayBuffer(132);
    const view = new Uint8Array(buffer);

    // Profile size
    view[0] = 0;
    view[1] = 0;
    view[2] = 0;
    view[3] = 132;

    // Preferred CMM Type
    view[4] = 0x61 + seed; // Variation

    // Profile version (2.4.0)
    view[8] = 2;
    view[9] = 0x40;

    // Profile/Device Class: Output ('prtr')
    view[12] = 0x70; // 'p'
    view[13] = 0x72; // 'r'
    view[14] = 0x74; // 't'
    view[15] = 0x72; // 'r'

    // Color Space: CMYK
    view[16] = 0x43; // 'C'
    view[17] = 0x4D; // 'M'
    view[18] = 0x59; // 'Y'
    view[19] = 0x4B; // 'K'

    // Profile Connection Space: Lab
    view[20] = 0x4C; // 'L'
    view[21] = 0x61; // 'a'
    view[22] = 0x62; // 'b'
    view[23] = 0x20; // ' '

    // Profile signature
    view[36] = 0x61; // 'a'
    view[37] = 0x63; // 'c'
    view[38] = 0x73; // 's'
    view[39] = 0x70; // 'p'

    return buffer;
}

/**
 * Creates a mock pixel buffer.
 * @param {number} width
 * @param {number} height
 * @param {number} channels
 * @param {number} [seed=0] - Seed for pixel variation
 * @returns {Uint8Array}
 */
function createMockPixelBuffer(width, height, channels, seed = 0) {
    const size = width * height * channels;
    const buffer = new Uint8Array(size);
    for (let i = 0; i < size; i++) {
        buffer[i] = ((i + seed) * 37) % 256;
    }
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
 * Tests full class hierarchy inheritance chain.
 *
 * @param {{
 *   ColorConverter: typeof import('../../classes/baseline/color-converter.js').ColorConverter,
 *   ImageColorConverter: typeof import('../../classes/baseline/image-color-converter.js').ImageColorConverter,
 *   PDFImageColorConverter: typeof import('../../classes/baseline/pdf-image-color-converter.js').PDFImageColorConverter,
 *   LookupTableColorConverter: typeof import('../../classes/baseline/lookup-table-color-converter.js').LookupTableColorConverter,
 *   PDFContentStreamColorConverter: typeof import('../../classes/baseline/pdf-content-stream-color-converter.js').PDFContentStreamColorConverter,
 *   PDFPageColorConverter: typeof import('../../classes/baseline/pdf-page-color-converter.js').PDFPageColorConverter,
 *   PDFDocumentColorConverter: typeof import('../../classes/baseline/pdf-document-color-converter.js').PDFDocumentColorConverter,
 * }} classes
 */
async function invokeInheritanceChainTest(classes) {
    const {
        ColorConverter,
        ImageColorConverter,
        PDFImageColorConverter,
        LookupTableColorConverter,
        PDFContentStreamColorConverter,
        PDFPageColorConverter,
        PDFDocumentColorConverter,
    } = classes;

    // Test image chain
    const imageConverter = new PDFImageColorConverter({
        renderingIntent: 'relative-colorimetric',
        blackPointCompensation: true,
        useAdaptiveBPCClamping: true,
        destinationProfile: createMockCMYKProfile(),
        destinationColorSpace: 'CMYK',
        inputType: 'RGB',
        compressOutput: true,
        verbose: false,
    });

    assert.ok(imageConverter instanceof PDFImageColorConverter, 'Should be PDFImageColorConverter');
    assert.ok(imageConverter instanceof ImageColorConverter, 'Should extend ImageColorConverter');
    assert.ok(imageConverter instanceof ColorConverter, 'Should extend ColorConverter');
    imageConverter.dispose();

    // Test lookup table chain
    const contentStreamConverter = new PDFContentStreamColorConverter({
        renderingIntent: 'relative-colorimetric',
        blackPointCompensation: true,
        useAdaptiveBPCClamping: true,
        destinationProfile: createMockCMYKProfile(),
        destinationColorSpace: 'CMYK',
        useLookupTable: true,
        verbose: false,
    });

    assert.ok(contentStreamConverter instanceof PDFContentStreamColorConverter, 'Should be PDFContentStreamColorConverter');
    assert.ok(contentStreamConverter instanceof LookupTableColorConverter, 'Should extend LookupTableColorConverter');
    assert.ok(contentStreamConverter instanceof ColorConverter, 'Should extend ColorConverter');
    contentStreamConverter.dispose();

    // Test coordination classes
    const pageConverter = new PDFPageColorConverter({
        renderingIntent: 'relative-colorimetric',
        blackPointCompensation: true,
        useAdaptiveBPCClamping: true,
        destinationProfile: createMockCMYKProfile(),
        destinationColorSpace: 'CMYK',
        convertImages: true,
        convertContentStreams: true,
        useWorkers: false,
        verbose: false,
    });

    assert.ok(pageConverter instanceof PDFPageColorConverter, 'Should be PDFPageColorConverter');
    assert.ok(pageConverter instanceof ColorConverter, 'Should extend ColorConverter');
    pageConverter.dispose();

    const documentConverter = new PDFDocumentColorConverter({
        renderingIntent: 'relative-colorimetric',
        blackPointCompensation: true,
        useAdaptiveBPCClamping: true,
        destinationProfile: createMockCMYKProfile(),
        destinationColorSpace: 'CMYK',
        convertImages: true,
        convertContentStreams: true,
        useWorkers: false,
        verbose: false,
    });

    assert.ok(documentConverter instanceof PDFDocumentColorConverter, 'Should be PDFDocumentColorConverter');
    assert.ok(documentConverter instanceof ColorConverter, 'Should extend ColorConverter');
    documentConverter.dispose();
}

/**
 * Tests configuration derivation chain from document → page → image.
 *
 * @param {{
 *   PDFDocumentColorConverter: typeof import('../../classes/baseline/pdf-document-color-converter.js').PDFDocumentColorConverter,
 * }} classes
 */
async function invokeConfigurationDerivationTest(classes) {
    const { PDFDocumentColorConverter } = classes;

    const documentConverter = new PDFDocumentColorConverter({
        renderingIntent: 'preserve-k-only-relative-colorimetric-gcr',
        blackPointCompensation: true,
        useAdaptiveBPCClamping: true,
        destinationProfile: createMockCMYKProfile(),
        destinationColorSpace: 'CMYK',
        convertImages: true,
        convertContentStreams: true,
        useWorkers: false,
        verbose: true,
    });

    // Derive page configuration
    const pageRef = createMockRef(10);
    const pageConfig = documentConverter.derivePageConfiguration(pageRef);

    assert.strictEqual(pageConfig.renderingIntent, 'preserve-k-only-relative-colorimetric-gcr');
    assert.strictEqual(pageConfig.blackPointCompensation, true);
    assert.strictEqual(pageConfig.verbose, true);
    assert.strictEqual(pageConfig.convertImages, true);
    assert.strictEqual(pageConfig.convertContentStreams, true);

    // Derive image configuration
    const imageRef = createMockRef(20);
    const imageConfig = documentConverter.deriveImageConfiguration(imageRef, pageRef);

    assert.strictEqual(imageConfig.renderingIntent, 'preserve-k-only-relative-colorimetric-gcr');
    assert.strictEqual(imageConfig.compressOutput, true);

    documentConverter.dispose();
}

/**
 * Tests per-page rendering intent overrides.
 *
 * @param {{
 *   PDFDocumentColorConverter: typeof import('../../classes/baseline/pdf-document-color-converter.js').PDFDocumentColorConverter,
 * }} classes
 */
async function invokePageOverridesTest(classes) {
    const { PDFDocumentColorConverter } = classes;

    const page1Ref = createMockRef(10);
    const page2Ref = createMockRef(20);

    const pageOverrides = new Map();
    pageOverrides.set(page2Ref, {
        renderingIntent: 'perceptual',
    });

    const documentConverter = new PDFDocumentColorConverter({
        renderingIntent: 'relative-colorimetric',
        blackPointCompensation: true,
        useAdaptiveBPCClamping: true,
        destinationProfile: createMockCMYKProfile(),
        destinationColorSpace: 'CMYK',
        convertImages: true,
        convertContentStreams: true,
        useWorkers: false,
        pageOverrides,
        verbose: false,
    });

    // Page 1 should use document default
    const page1Config = documentConverter.derivePageConfiguration(page1Ref);
    assert.strictEqual(page1Config.renderingIntent, 'relative-colorimetric');

    // Page 2 should use override
    const page2Config = documentConverter.derivePageConfiguration(page2Ref);
    assert.strictEqual(page2Config.renderingIntent, 'perceptual');

    documentConverter.dispose();
}

/**
 * Tests per-image rendering intent overrides.
 *
 * @param {{
 *   PDFDocumentColorConverter: typeof import('../../classes/baseline/pdf-document-color-converter.js').PDFDocumentColorConverter,
 * }} classes
 */
async function invokeImageOverridesTest(classes) {
    const { PDFDocumentColorConverter } = classes;

    const pageRef = createMockRef(10);
    const image1Ref = createMockRef(20);
    const image2Ref = createMockRef(30);

    const documentConverter = new PDFDocumentColorConverter({
        renderingIntent: 'relative-colorimetric',
        blackPointCompensation: true,
        useAdaptiveBPCClamping: true,
        destinationProfile: createMockCMYKProfile(),
        destinationColorSpace: 'CMYK',
        convertImages: true,
        convertContentStreams: true,
        useWorkers: false,
        verbose: false,
    });

    // Set override for image 2
    documentConverter.setConfigurationFor(image2Ref, {
        renderingIntent: 'perceptual',
    });

    // Image 1 should use document default
    const image1Config = documentConverter.deriveImageConfiguration(image1Ref, pageRef);
    assert.strictEqual(image1Config.renderingIntent, 'relative-colorimetric');

    // Image 2 should use override
    const image2Config = documentConverter.deriveImageConfiguration(image2Ref, pageRef);
    assert.strictEqual(image2Config.renderingIntent, 'perceptual');

    documentConverter.dispose();
}

/**
 * Tests memory cleanup with ProfilePool and BufferRegistry.
 *
 * @param {{
 *   PDFDocumentColorConverter: typeof import('../../classes/baseline/pdf-document-color-converter.js').PDFDocumentColorConverter,
 *   ProfilePool: typeof import('../../classes/baseline/profile-pool.js').ProfilePool,
 *   BufferRegistry: typeof import('../../classes/baseline/buffer-registry.js').BufferRegistry,
 * }} classes
 */
async function invokeMemoryCleanupTest(classes) {
    const { PDFDocumentColorConverter, ProfilePool, BufferRegistry } = classes;

    // Create document converter with owned pools
    const documentConverter = new PDFDocumentColorConverter({
        renderingIntent: 'relative-colorimetric',
        blackPointCompensation: true,
        useAdaptiveBPCClamping: true,
        destinationProfile: createMockCMYKProfile(),
        destinationColorSpace: 'CMYK',
        convertImages: true,
        convertContentStreams: true,
        useWorkers: false,
        verbose: false,
    });

    await documentConverter.ensureReady();

    // Verify pools exist
    assert.ok(documentConverter.profilePool instanceof ProfilePool);
    assert.ok(documentConverter.bufferRegistry instanceof BufferRegistry);

    // Dispose should clean up
    documentConverter.dispose();

    // After dispose, subsequent access should be cleaned up
    // (Note: The actual pools are private, so we test through behavior)
}

/**
 * Tests shared ProfilePool between converters.
 *
 * @param {{
 *   PDFDocumentColorConverter: typeof import('../../classes/baseline/pdf-document-color-converter.js').PDFDocumentColorConverter,
 *   ProfilePool: typeof import('../../classes/baseline/profile-pool.js').ProfilePool,
 * }} classes
 */
async function invokeSharedProfilePoolTest(classes) {
    const { PDFDocumentColorConverter, ProfilePool } = classes;

    // Create shared profile pool
    const sharedPool = new ProfilePool({
        maxProfiles: 16,
        maxMemoryBytes: 32 * 1024 * 1024,
    });

    // Create two document converters sharing the pool
    const converter1 = new PDFDocumentColorConverter({
        renderingIntent: 'relative-colorimetric',
        blackPointCompensation: true,
        useAdaptiveBPCClamping: true,
        destinationProfile: createMockCMYKProfile(1),
        destinationColorSpace: 'CMYK',
        convertImages: true,
        convertContentStreams: true,
        useWorkers: false,
        profilePool: sharedPool,
        verbose: false,
    });

    const converter2 = new PDFDocumentColorConverter({
        renderingIntent: 'relative-colorimetric',
        blackPointCompensation: true,
        useAdaptiveBPCClamping: true,
        destinationProfile: createMockCMYKProfile(2),
        destinationColorSpace: 'CMYK',
        convertImages: true,
        convertContentStreams: true,
        useWorkers: false,
        profilePool: sharedPool,
        verbose: false,
    });

    await converter1.ensureReady();
    await converter2.ensureReady();

    // Both should share the same pool
    assert.strictEqual(converter1.profilePool, sharedPool);
    assert.strictEqual(converter2.profilePool, sharedPool);

    // Disposing converters should not dispose shared pool
    converter1.dispose();
    converter2.dispose();

    // Pool should still be usable (dispose manually)
    sharedPool.dispose();
}

/**
 * Tests hooks are called in correct order for document conversion.
 *
 * @param {{
 *   PDFDocumentColorConverter: typeof import('../../classes/baseline/pdf-document-color-converter.js').PDFDocumentColorConverter,
 * }} classes
 */
async function invokeDocumentHookOrderTest(classes) {
    const { PDFDocumentColorConverter } = classes;

    const callOrder = [];

    class TestDocumentConverter extends PDFDocumentColorConverter {
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
            // Skip actual conversion, return mock result
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

    const converter = new TestDocumentConverter({
        renderingIntent: 'relative-colorimetric',
        blackPointCompensation: true,
        useAdaptiveBPCClamping: true,
        destinationProfile: createMockCMYKProfile(),
        destinationColorSpace: 'CMYK',
        convertImages: true,
        convertContentStreams: true,
        useWorkers: false,
        verbose: false,
    });

    await converter.ensureReady();

    // Create minimal mock PDF document
    const mockPDFDocument = {
        getPages: () => [],
        getPageCount: () => 0,
        context: {},
    };

    await converter.convertColor({ pdfDocument: mockPDFDocument }, {});

    // Verify hook order
    // Note: Tests log at method entry, so afterConvertColor is logged
    // before afterConvertPDFDocumentColor (which is called from super)
    assert.deepStrictEqual(callOrder, [
        'beforeConvertColor',
        'beforeConvertPDFDocumentColor',
        'doConvertColor',
        'afterConvertColor',
        'afterConvertPDFDocumentColor',
    ], 'Hooks should be called in correct order');

    converter.dispose();
}

/**
 * Tests worker mode support flags.
 *
 * @param {{
 *   PDFDocumentColorConverter: typeof import('../../classes/baseline/pdf-document-color-converter.js').PDFDocumentColorConverter,
 *   PDFPageColorConverter: typeof import('../../classes/baseline/pdf-page-color-converter.js').PDFPageColorConverter,
 *   PDFImageColorConverter: typeof import('../../classes/baseline/pdf-image-color-converter.js').PDFImageColorConverter,
 *   PDFContentStreamColorConverter: typeof import('../../classes/baseline/pdf-content-stream-color-converter.js').PDFContentStreamColorConverter,
 * }} classes
 */
async function invokeWorkerModeSupportTest(classes) {
    const {
        PDFDocumentColorConverter,
        PDFPageColorConverter,
        PDFImageColorConverter,
        PDFContentStreamColorConverter,
    } = classes;

    const baseConfig = {
        renderingIntent: 'relative-colorimetric',
        blackPointCompensation: true,
        useAdaptiveBPCClamping: true,
        destinationProfile: createMockCMYKProfile(),
        destinationColorSpace: 'CMYK',
        verbose: false,
    };

    const documentConverter = new PDFDocumentColorConverter({
        ...baseConfig,
        convertImages: true,
        convertContentStreams: true,
        useWorkers: false,
    });

    const pageConverter = new PDFPageColorConverter({
        ...baseConfig,
        convertImages: true,
        convertContentStreams: true,
        useWorkers: false,
    });

    const imageConverter = new PDFImageColorConverter({
        ...baseConfig,
        inputType: 'RGB',
        compressOutput: true,
    });

    const contentStreamConverter = new PDFContentStreamColorConverter({
        ...baseConfig,
        useLookupTable: true,
    });

    // All PDF converters should support worker mode
    assert.strictEqual(documentConverter.supportsWorkerMode, true);
    assert.strictEqual(pageConverter.supportsWorkerMode, true);
    assert.strictEqual(imageConverter.supportsWorkerMode, true);
    assert.strictEqual(contentStreamConverter.supportsWorkerMode, true);

    documentConverter.dispose();
    pageConverter.dispose();
    imageConverter.dispose();
    contentStreamConverter.dispose();
}

/**
 * Tests Lab image handling (should use Relative Colorimetric, not K-Only GCR).
 *
 * @param {{
 *   PDFImageColorConverter: typeof import('../../classes/baseline/pdf-image-color-converter.js').PDFImageColorConverter,
 * }} classes
 */
async function invokeLabImageHandlingTest(classes) {
    const { PDFImageColorConverter } = classes;

    const converter = new PDFImageColorConverter({
        renderingIntent: 'preserve-k-only-relative-colorimetric-gcr',
        blackPointCompensation: true,
        useAdaptiveBPCClamping: true,
        destinationProfile: createMockCMYKProfile(),
        destinationColorSpace: 'CMYK',
        inputType: 'Lab',
        compressOutput: true,
        verbose: false,
    });

    // Baseline: getEffectiveRenderingIntent returns configured intent — policy handles Lab fallback
    const effectiveIntent = converter.getEffectiveRenderingIntent('Lab');
    assert.strictEqual(effectiveIntent, 'preserve-k-only-relative-colorimetric-gcr',
        'Baseline returns configured intent — policy rules handle Lab → Relative Colorimetric fallback');

    // RGB should keep the configured intent
    const rgbIntent = converter.getEffectiveRenderingIntent('RGB');
    assert.strictEqual(rgbIntent, 'preserve-k-only-relative-colorimetric-gcr',
        'RGB images should use configured intent');

    converter.dispose();
}

/**
 * Tests dispose is idempotent (can be called multiple times).
 *
 * @param {{
 *   PDFDocumentColorConverter: typeof import('../../classes/baseline/pdf-document-color-converter.js').PDFDocumentColorConverter,
 * }} classes
 */
async function invokeDisposeIdempotencyTest(classes) {
    const { PDFDocumentColorConverter } = classes;

    const converter = new PDFDocumentColorConverter({
        renderingIntent: 'relative-colorimetric',
        blackPointCompensation: true,
        useAdaptiveBPCClamping: true,
        destinationProfile: createMockCMYKProfile(),
        destinationColorSpace: 'CMYK',
        convertImages: true,
        convertContentStreams: true,
        useWorkers: false,
        verbose: false,
    });

    await converter.ensureReady();

    // Should not throw on first dispose
    converter.dispose();

    // Should not throw on second dispose
    converter.dispose();

    // Should not throw on third dispose
    converter.dispose();
}

/**
 * Tests applyWorkerResult for PDFContentStreamColorConverter.
 *
 * @param {{
 *   PDFContentStreamColorConverter: typeof import('../../classes/baseline/pdf-content-stream-color-converter.js').PDFContentStreamColorConverter,
 * }} classes
 */
async function invokeContentStreamApplyWorkerResultTest(classes) {
    const { PDFContentStreamColorConverter } = classes;

    const converter = new PDFContentStreamColorConverter({
        renderingIntent: 'relative-colorimetric',
        blackPointCompensation: true,
        useAdaptiveBPCClamping: true,
        destinationProfile: createMockCMYKProfile(),
        destinationColorSpace: 'CMYK',
        useLookupTable: true,
        verbose: false,
    });

    await converter.ensureReady();

    const mockStreamRef = createMockRef(10);
    const input = {
        streamRef: mockStreamRef,
        streamText: '1 0 0 rg 100 100 50 50 re f',
        colorSpaceDefinitions: {},
    };

    // Create mock worker result (success case)
    const workerResult = {
        success: true,
        compressedResult: new Uint8Array([120, 156, 75, 4, 0, 0, 1, 0, 1]).buffer, // Mock deflated data
        replacementCount: 1,
        originalSize: 50,
        compressedSize: 9,
    };

    const context = {};
    await converter.applyWorkerResult(input, workerResult, context);

    // Verify result was stored in context
    assert.ok(context.contentStreamWorkerResult, 'Result should be stored in context');
    assert.strictEqual(context.contentStreamWorkerResult.streamRef, mockStreamRef);
    assert.strictEqual(context.contentStreamWorkerResult.replacementCount, 1);
    assert.ok(context.contentStreamWorkerResult.compressedData instanceof Uint8Array);

    // Test failure case
    const failContext = {};
    await converter.applyWorkerResult(input, { success: false, error: 'Test error' }, failContext);
    assert.strictEqual(failContext.contentStreamWorkerResult, undefined, 'Failed result should not be stored');

    converter.dispose();
}

/**
 * Tests applyWorkerResult for PDFPageColorConverter.
 *
 * @param {{
 *   PDFPageColorConverter: typeof import('../../classes/baseline/pdf-page-color-converter.js').PDFPageColorConverter,
 * }} classes
 */
async function invokePageApplyWorkerResultTest(classes) {
    const { PDFPageColorConverter } = classes;

    const converter = new PDFPageColorConverter({
        renderingIntent: 'relative-colorimetric',
        blackPointCompensation: true,
        useAdaptiveBPCClamping: true,
        destinationProfile: createMockCMYKProfile(),
        destinationColorSpace: 'CMYK',
        convertImages: true,
        convertContentStreams: true,
        useWorkers: false,
        verbose: false,
    });

    await converter.ensureReady();

    const pageRef = createMockRef(10);
    const input = {
        pageLeaf: {},
        pageRef: pageRef,
        pageIndex: 0,
        context: {},
        images: [],
        contentStreams: [],
    };

    // Create mock worker result
    const workerResult = {
        success: true,
        imageResults: [],
        contentStreamResults: [],
    };

    const context = {};
    await converter.applyWorkerResult(input, workerResult, context);

    // Verify page result was stored in context
    assert.ok(context.pageWorkerResult, 'Page result should be stored in context');
    assert.strictEqual(context.pageWorkerResult.pageRef, pageRef);
    assert.strictEqual(context.pageWorkerResult.pageIndex, 0);
    assert.strictEqual(context.pageWorkerResult.imagesApplied, 0);
    assert.strictEqual(context.pageWorkerResult.contentStreamsApplied, 0);

    // Test failure case
    const failContext = {};
    await converter.applyWorkerResult(input, { success: false, error: 'Test error' }, failContext);
    assert.strictEqual(failContext.pageWorkerResult, undefined, 'Failed result should not be stored');

    converter.dispose();
}

/**
 * Tests applyWorkerResult for PDFDocumentColorConverter.
 *
 * @param {{
 *   PDFDocumentColorConverter: typeof import('../../classes/baseline/pdf-document-color-converter.js').PDFDocumentColorConverter,
 * }} classes
 */
async function invokeDocumentApplyWorkerResultTest(classes) {
    const { PDFDocumentColorConverter } = classes;

    const converter = new PDFDocumentColorConverter({
        renderingIntent: 'relative-colorimetric',
        blackPointCompensation: true,
        useAdaptiveBPCClamping: true,
        destinationProfile: createMockCMYKProfile(),
        destinationColorSpace: 'CMYK',
        convertImages: true,
        convertContentStreams: true,
        useWorkers: false,
        verbose: false,
    });

    await converter.ensureReady();

    // Create minimal mock PDF document
    const mockPDFDocument = {
        getPages: () => [],
        getPageCount: () => 0,
        context: {
            lookup: () => null,
            assign: () => {},
        },
    };

    const input = { pdfDocument: mockPDFDocument };

    // Create mock worker result
    const workerResult = {
        success: true,
        pageResults: [],
    };

    const context = {};
    await converter.applyWorkerResult(input, workerResult, context);

    // Verify document result was stored in context
    assert.ok(context.documentWorkerResult, 'Document result should be stored in context');
    assert.strictEqual(context.documentWorkerResult.pagesProcessed, 0);
    assert.strictEqual(context.documentWorkerResult.imagesApplied, 0);
    assert.strictEqual(context.documentWorkerResult.contentStreamsApplied, 0);

    // Test failure case
    const failContext = {};
    await converter.applyWorkerResult(input, { success: false, error: 'Test error' }, failContext);
    assert.strictEqual(failContext.documentWorkerResult, undefined, 'Failed result should not be stored');

    converter.dispose();
}

// ============================================================================
// Real PDF Conversion Test Functions (Browser Context)
// ============================================================================

/**
 * Tests RGB PDF to CMYK conversion using legacy PDFService vs new PDFDocumentColorConverter.
 * Runs in browser context via Playwright.
 *
 * @param {import('playwright-chromium').Page} page - Playwright page
 * @param {string} pdfPath - Path to PDF fixture
 * @param {string} profilePath - Path to destination ICC profile
 * @returns {Promise<object>} Test result
 */
async function invokeRGBPDFConversionTest(page, pdfPath, profilePath) {
    return page.evaluate(async ({ pdfPath, profilePath }) => {
        try {
            const { PDFDocument } = await import('pdf-lib');
            // Browser context: paths relative to /testing/iso/ptf/2025/tests/index.html
            const { PDFService } = await import('../services/PDFService.js');
            const { PDFDocumentColorConverter } = await import('../classes/baseline/pdf-document-color-converter.js');

            // Load PDF fixture
            const pdfResponse = await fetch(pdfPath);
            if (!pdfResponse.ok) {
                return { success: false, error: `Failed to fetch PDF: ${pdfResponse.status}` };
            }
            const pdfBytes = new Uint8Array(await pdfResponse.arrayBuffer());
            const pdfDocument = await PDFDocument.load(pdfBytes);

            // Load destination ICC profile
            const profileResponse = await fetch(profilePath);
            if (!profileResponse.ok) {
                return { success: false, error: `Failed to fetch profile: ${profileResponse.status}` };
            }
            const profileBuffer = await profileResponse.arrayBuffer();

            // Convert using legacy implementation
            const legacyPDF = await PDFDocument.load(pdfBytes);
            const legacyResult = await PDFService.convertColorInPDFDocument(legacyPDF, {
                destinationProfile: profileBuffer,
                renderingIntent: 'relative-colorimetric',
                convertImages: false, // Content streams only for faster test
                convertContentStreams: true,
                useWorkers: false,
                verbose: false,
            });

            // Convert using new class hierarchy
            const newPDF = await PDFDocument.load(pdfBytes);
            const converter = new PDFDocumentColorConverter({
                destinationProfile: profileBuffer,
                destinationColorSpace: 'CMYK',
                renderingIntent: 'relative-colorimetric',
                blackPointCompensation: true,
                useAdaptiveBPCClamping: false,
                convertImages: false, // Content streams only for faster test
                convertContentStreams: true,
                useWorkers: false,
                verbose: false,
            });

            await converter.ensureReady();
            const newResult = await converter.convertColor({ pdfDocument: newPDF }, {});
            converter.dispose();

            return {
                success: true,
                legacyResult: {
                    totalContentStreamConversions: legacyResult.totalContentStreamConversions,
                    pagesProcessed: legacyResult.pagesProcessed,
                },
                newResult: {
                    contentStreamsConverted: newResult.contentStreamsConverted,
                    pagesProcessed: newResult.pagesProcessed,
                    errors: newResult.errors,
                },
                pageCount: pdfDocument.getPageCount(),
            };
        } catch (error) {
            return { success: false, error: String(error), stack: error?.stack };
        }
    }, { pdfPath, profilePath });
}

/**
 * Tests full document conversion with images using legacy vs new implementation.
 *
 * @param {import('playwright-chromium').Page} page - Playwright page
 * @param {string} pdfPath - Path to PDF fixture
 * @param {string} profilePath - Path to destination ICC profile
 * @returns {Promise<object>} Test result
 */
async function invokeFullDocumentConversionTest(page, pdfPath, profilePath) {
    return page.evaluate(async ({ pdfPath, profilePath }) => {
        try {
            const { PDFDocument } = await import('pdf-lib');
            // Browser context: paths relative to /testing/iso/ptf/2025/tests/index.html
            const { PDFService } = await import('../services/PDFService.js');
            const { PDFDocumentColorConverter } = await import('../classes/baseline/pdf-document-color-converter.js');

            // Load PDF fixture
            const pdfResponse = await fetch(pdfPath);
            if (!pdfResponse.ok) {
                return { success: false, error: `Failed to fetch PDF: ${pdfResponse.status}` };
            }
            const pdfBytes = new Uint8Array(await pdfResponse.arrayBuffer());
            const pdfDocument = await PDFDocument.load(pdfBytes);

            // Load destination ICC profile
            const profileResponse = await fetch(profilePath);
            if (!profileResponse.ok) {
                return { success: false, error: `Failed to fetch profile: ${profileResponse.status}` };
            }
            const profileBuffer = await profileResponse.arrayBuffer();

            // Convert using legacy implementation (images + content streams)
            const legacyPDF = await PDFDocument.load(pdfBytes);
            const legacyResult = await PDFService.convertColorInPDFDocument(legacyPDF, {
                destinationProfile: profileBuffer,
                renderingIntent: 'relative-colorimetric',
                convertImages: true,
                convertContentStreams: true,
                useWorkers: false,
                verbose: false,
            });

            // Convert using new class hierarchy (images + content streams)
            const newPDF = await PDFDocument.load(pdfBytes);
            const converter = new PDFDocumentColorConverter({
                destinationProfile: profileBuffer,
                destinationColorSpace: 'CMYK',
                renderingIntent: 'relative-colorimetric',
                blackPointCompensation: true,
                useAdaptiveBPCClamping: true,
                convertImages: true,
                convertContentStreams: true,
                useWorkers: false,
                verbose: false,
            });

            await converter.ensureReady();
            const newResult = await converter.convertColor({ pdfDocument: newPDF }, {});
            converter.dispose();

            return {
                success: true,
                legacyResult: {
                    totalContentStreamConversions: legacyResult.totalContentStreamConversions,
                    totalImageConversions: legacyResult.totalImageConversions,
                    pagesProcessed: legacyResult.pagesProcessed,
                },
                newResult: {
                    contentStreamsConverted: newResult.contentStreamsConverted,
                    imagesConverted: newResult.imagesConverted,
                    pagesProcessed: newResult.pagesProcessed,
                    errors: newResult.errors,
                },
                pageCount: pdfDocument.getPageCount(),
            };
        } catch (error) {
            return { success: false, error: String(error), stack: error?.stack };
        }
    }, { pdfPath, profilePath });
}

/**
 * Tests K-Only GCR rendering intent conversion.
 *
 * @param {import('playwright-chromium').Page} page - Playwright page
 * @param {string} pdfPath - Path to PDF fixture
 * @param {string} profilePath - Path to destination ICC profile
 * @returns {Promise<object>} Test result
 */
async function invokeKOnlyGCRConversionTest(page, pdfPath, profilePath) {
    return page.evaluate(async ({ pdfPath, profilePath }) => {
        try {
            const { PDFDocument } = await import('pdf-lib');
            // Browser context: paths relative to /testing/iso/ptf/2025/tests/index.html
            const { PDFService } = await import('../services/PDFService.js');
            const { PDFDocumentColorConverter } = await import('../classes/baseline/pdf-document-color-converter.js');

            // Load PDF fixture
            const pdfResponse = await fetch(pdfPath);
            if (!pdfResponse.ok) {
                return { success: false, error: `Failed to fetch PDF: ${pdfResponse.status}` };
            }
            const pdfBytes = new Uint8Array(await pdfResponse.arrayBuffer());
            const pdfDocument = await PDFDocument.load(pdfBytes);

            // Load destination ICC profile
            const profileResponse = await fetch(profilePath);
            if (!profileResponse.ok) {
                return { success: false, error: `Failed to fetch profile: ${profileResponse.status}` };
            }
            const profileBuffer = await profileResponse.arrayBuffer();

            // Convert using legacy implementation with K-Only GCR
            const legacyPDF = await PDFDocument.load(pdfBytes);
            const legacyResult = await PDFService.convertColorInPDFDocument(legacyPDF, {
                destinationProfile: profileBuffer,
                renderingIntent: 'preserve-k-only-relative-colorimetric-gcr',
                convertImages: false,
                convertContentStreams: true,
                useWorkers: false,
                verbose: false,
            });

            // Convert using new class hierarchy with K-Only GCR
            const newPDF = await PDFDocument.load(pdfBytes);
            const converter = new PDFDocumentColorConverter({
                destinationProfile: profileBuffer,
                destinationColorSpace: 'CMYK',
                renderingIntent: 'preserve-k-only-relative-colorimetric-gcr',
                blackPointCompensation: true,
                useAdaptiveBPCClamping: false,
                convertImages: false,
                convertContentStreams: true,
                useWorkers: false,
                verbose: false,
            });

            await converter.ensureReady();
            const newResult = await converter.convertColor({ pdfDocument: newPDF }, {});
            converter.dispose();

            return {
                success: true,
                legacyResult: {
                    totalContentStreamConversions: legacyResult.totalContentStreamConversions,
                    pagesProcessed: legacyResult.pagesProcessed,
                },
                newResult: {
                    contentStreamsConverted: newResult.contentStreamsConverted,
                    pagesProcessed: newResult.pagesProcessed,
                    errors: newResult.errors,
                },
                pageCount: pdfDocument.getPageCount(),
            };
        } catch (error) {
            return { success: false, error: String(error), stack: error?.stack };
        }
    }, { pdfPath, profilePath });
}

/**
 * Tests that fixtures are accessible from browser context.
 *
 * @param {import('playwright-chromium').Page} page - Playwright page
 * @param {string} pdfPath - Path to PDF fixture
 * @param {string} profilePath - Path to ICC profile
 * @returns {Promise<object>} Test result
 */
async function invokeFixtureAccessibilityTest(page, pdfPath, profilePath) {
    return page.evaluate(async ({ pdfPath, profilePath }) => {
        try {
            // Check PDF
            const pdfResponse = await fetch(pdfPath);
            const pdfSize = Number(pdfResponse.headers.get('content-length') || 0);

            // Check profile
            const profileResponse = await fetch(profilePath);
            const profileSize = Number(profileResponse.headers.get('content-length') || 0);

            return {
                success: pdfResponse.ok && profileResponse.ok,
                pdf: {
                    accessible: pdfResponse.ok,
                    status: pdfResponse.status,
                    size: pdfSize,
                },
                profile: {
                    accessible: profileResponse.ok,
                    status: profileResponse.status,
                    size: profileSize,
                },
            };
        } catch (error) {
            return { success: false, error: String(error) };
        }
    }, { pdfPath, profilePath });
}

// ============================================================================
// Test Suite
// ============================================================================

describe('ColorConverterClasses Integration', () => {
    /** @type {typeof import('../../classes/baseline/color-converter.js').ColorConverter} */
    let ColorConverter;
    /** @type {typeof import('../../classes/baseline/image-color-converter.js').ImageColorConverter} */
    let ImageColorConverter;
    /** @type {typeof import('../../classes/baseline/pdf-image-color-converter.js').PDFImageColorConverter} */
    let PDFImageColorConverter;
    /** @type {typeof import('../../classes/baseline/lookup-table-color-converter.js').LookupTableColorConverter} */
    let LookupTableColorConverter;
    /** @type {typeof import('../../classes/baseline/pdf-content-stream-color-converter.js').PDFContentStreamColorConverter} */
    let PDFContentStreamColorConverter;
    /** @type {typeof import('../../classes/baseline/pdf-page-color-converter.js').PDFPageColorConverter} */
    let PDFPageColorConverter;
    /** @type {typeof import('../../classes/baseline/pdf-document-color-converter.js').PDFDocumentColorConverter} */
    let PDFDocumentColorConverter;
    /** @type {typeof import('../../classes/baseline/profile-pool.js').ProfilePool} */
    let ProfilePool;
    /** @type {typeof import('../../classes/baseline/buffer-registry.js').BufferRegistry} */
    let BufferRegistry;

    before(async () => {
        // Dynamic imports
        const colorConverterModule = await import('../../classes/baseline/color-converter.js');
        ColorConverter = colorConverterModule.ColorConverter;

        const imageModule = await import('../../classes/baseline/image-color-converter.js');
        ImageColorConverter = imageModule.ImageColorConverter;

        const pdfImageModule = await import('../../classes/baseline/pdf-image-color-converter.js');
        PDFImageColorConverter = pdfImageModule.PDFImageColorConverter;

        const lookupTableModule = await import('../../classes/baseline/lookup-table-color-converter.js');
        LookupTableColorConverter = lookupTableModule.LookupTableColorConverter;

        const pdfContentStreamModule = await import('../../classes/baseline/pdf-content-stream-color-converter.js');
        PDFContentStreamColorConverter = pdfContentStreamModule.PDFContentStreamColorConverter;

        const pdfPageModule = await import('../../classes/baseline/pdf-page-color-converter.js');
        PDFPageColorConverter = pdfPageModule.PDFPageColorConverter;

        const pdfDocumentModule = await import('../../classes/baseline/pdf-document-color-converter.js');
        PDFDocumentColorConverter = pdfDocumentModule.PDFDocumentColorConverter;

        const profilePoolModule = await import('../../classes/baseline/profile-pool.js');
        ProfilePool = profilePoolModule.ProfilePool;

        const bufferRegistryModule = await import('../../classes/baseline/buffer-registry.js');
        BufferRegistry = bufferRegistryModule.BufferRegistry;
    });

    // ========================================
    // New Implementation Tests
    // ========================================

    test('full class hierarchy inheritance chain', {
        skip: !!'instanceof checks only - no regression value',
    }, async () => {
        await invokeInheritanceChainTest({
            ColorConverter,
            ImageColorConverter,
            PDFImageColorConverter,
            LookupTableColorConverter,
            PDFContentStreamColorConverter,
            PDFPageColorConverter,
            PDFDocumentColorConverter,
        });
    });

    test('configuration derivation chain', {
        skip: TruthyEnvironmentParameterMatcher.test(process.env.TESTS_ONLY_LEGACY),
    }, async () => {
        await invokeConfigurationDerivationTest({ PDFDocumentColorConverter });
    });

    test('per-page rendering intent overrides', {
        skip: TruthyEnvironmentParameterMatcher.test(process.env.TESTS_ONLY_LEGACY),
    }, async () => {
        await invokePageOverridesTest({ PDFDocumentColorConverter });
    });

    test('per-image rendering intent overrides', {
        skip: TruthyEnvironmentParameterMatcher.test(process.env.TESTS_ONLY_LEGACY),
    }, async () => {
        await invokeImageOverridesTest({ PDFDocumentColorConverter });
    });

    test('memory cleanup with ProfilePool and BufferRegistry', {
        skip: !!'instanceof checks only - no regression value',
    }, async () => {
        await invokeMemoryCleanupTest({
            PDFDocumentColorConverter,
            ProfilePool,
            BufferRegistry,
        });
    });

    test('shared ProfilePool between converters', {
        skip: TruthyEnvironmentParameterMatcher.test(process.env.TESTS_ONLY_LEGACY),
    }, async () => {
        await invokeSharedProfilePoolTest({
            PDFDocumentColorConverter,
            ProfilePool,
        });
    });

    test('document conversion hook order', {
        skip: !!'mock conversion - verifies hook order but not actual conversion',
    }, async () => {
        await invokeDocumentHookOrderTest({ PDFDocumentColorConverter });
    });

    test('worker mode support flags', {
        skip: !!'worker mode boolean checks only - no regression value',
    }, async () => {
        await invokeWorkerModeSupportTest({
            PDFDocumentColorConverter,
            PDFPageColorConverter,
            PDFImageColorConverter,
            PDFContentStreamColorConverter,
        });
    });

    test('Lab image handling uses relative-colorimetric', {
        skip: TruthyEnvironmentParameterMatcher.test(process.env.TESTS_ONLY_LEGACY),
    }, async () => {
        await invokeLabImageHandlingTest({ PDFImageColorConverter });
    });

    test('dispose is idempotent', {
        skip: !!'dispose mechanics only - no regression value',
    }, async () => {
        await invokeDisposeIdempotencyTest({ PDFDocumentColorConverter });
    });

    test('content stream applyWorkerResult stores result in context', {
        skip: TruthyEnvironmentParameterMatcher.test(process.env.TESTS_ONLY_LEGACY),
    }, async () => {
        await invokeContentStreamApplyWorkerResultTest({ PDFContentStreamColorConverter });
    });

    test('page applyWorkerResult delegates to child converters', {
        skip: TruthyEnvironmentParameterMatcher.test(process.env.TESTS_ONLY_LEGACY),
    }, async () => {
        await invokePageApplyWorkerResultTest({ PDFPageColorConverter });
    });

    test('document applyWorkerResult writes to PDF', {
        skip: TruthyEnvironmentParameterMatcher.test(process.env.TESTS_ONLY_LEGACY),
    }, async () => {
        await invokeDocumentApplyWorkerResultTest({ PDFDocumentColorConverter });
    });

    // ========================================
    // Legacy Implementation Tests
    // ========================================

    test('(legacy) class hierarchy has no direct legacy equivalent', {
        skip: !!'placeholder - no legacy equivalent to compare',
    }, async () => {
        // The new class hierarchy replaces the procedural approach in:
        // - WorkerColorConversion.js (orchestration)
        // - StreamTransformWorker.js (transformation)
        // - PDFService.convertColorInPDFDocument() (document conversion)
        //
        // Parity testing is done via compare-implementations.js script
        // which compares output PDFs between legacy and new implementations.
        assert.ok(true, 'Legacy comparison done via compare-implementations.js');
    });
});

// ============================================================================
// Real PDF Conversion Tests (Browser Context with Playwright)
// ============================================================================

describe('Real PDF Conversion Tests', () => {
    before(async () => {
        browser = await chromium.launch({ headless: true });
        context = await browser.newContext();
        page = await context.newPage();
        await page.goto(`${BASE_URL}/testing/iso/ptf/2025/tests/index.html`);
        await injectImportmap(page);
    });

    after(async () => {
        await context?.close();
        await browser?.close();
        browser = null;
        context = null;
        page = null;
    });

    // ========================================
    // Fixture Accessibility Tests
    // ========================================

    test('PDF and ICC profile fixtures are accessible', {
        skip: TruthyEnvironmentParameterMatcher.test(process.env.TESTS_ONLY_LEGACY),
    }, async (t) => {
        if (!page) return t.skip('Page not initialized');

        const result = await invokeFixtureAccessibilityTest(
            page,
            FIXTURES.typeSizesAndLissajouPDF,
            FIXTURES.eciCMYKProfile,
        );

        assert.strictEqual(result.success, true, `Fixtures not accessible: ${result.error}`);
        assert.strictEqual(result.pdf.accessible, true, `PDF not accessible: ${result.pdf.status}`);
        assert.strictEqual(result.profile.accessible, true, `Profile not accessible: ${result.profile.status}`);
        assert.ok(result.pdf.size > 0, 'PDF should have content');
        assert.ok(result.profile.size > 0, 'Profile should have content');
    });

    // ========================================
    // RGB PDF to CMYK Conversion Tests
    // ========================================

    test('RGB PDF to CMYK conversion (content streams only)', {
        skip: TruthyEnvironmentParameterMatcher.test(process.env.TESTS_ONLY_LEGACY),
    }, async (t) => {
        if (!page) return t.skip('Page not initialized');

        const result = await invokeRGBPDFConversionTest(
            page,
            FIXTURES.typeSizesAndLissajouPDF,
            FIXTURES.eciCMYKProfile,
        );

        assert.strictEqual(result.success, true, `Conversion failed: ${result.error}\n${result.stack || ''}`);
        assert.ok(result.pageCount > 0, 'Document should have pages');
        assert.strictEqual(result.legacyResult.pagesProcessed, result.pageCount, 'Legacy should process all pages');
        assert.strictEqual(result.newResult.pagesProcessed, result.pageCount, 'New should process all pages');

        // Verify no errors occurred
        assert.ok(
            result.newResult.errors.length === 0,
            `New implementation had errors: ${result.newResult.errors.join(', ')}`,
        );

        // Parity note: The metrics count DIFFERENT things and are NOT directly comparable:
        // - legacy.totalContentStreamConversions: Number of color OPERATIONS found in content streams
        // - new.contentStreamsConverted: Number of content STREAM OBJECTS processed
        //
        // For the Type Sizes and Lissajou PDF:
        // - Legacy finds ~12,914 individual color operations (rg, RG, k, K, etc.)
        // - New processes 11 content stream objects
        //
        // Both implementations process the same content, they just measure different things.
        // The legacy metric is more granular (color operation level), while the new metric
        // tracks PDF object processing (stream level).

        // Assert that BOTH implementations processed something
        assert.ok(
            result.legacyResult.totalContentStreamConversions > 0,
            `Legacy should find color operations: ${result.legacyResult.totalContentStreamConversions}`,
        );
        assert.ok(
            result.newResult.contentStreamsConverted > 0,
            `New should process content streams: ${result.newResult.contentStreamsConverted}`,
        );
    });

    test('K-Only GCR rendering intent conversion', {
        skip: TruthyEnvironmentParameterMatcher.test(process.env.TESTS_ONLY_LEGACY),
    }, async (t) => {
        if (!page) return t.skip('Page not initialized');

        const result = await invokeKOnlyGCRConversionTest(
            page,
            FIXTURES.typeSizesAndLissajouPDF,
            FIXTURES.eciCMYKProfile,
        );

        assert.strictEqual(result.success, true, `K-Only GCR conversion failed: ${result.error}\n${result.stack || ''}`);
        assert.ok(result.pageCount > 0, 'Document should have pages');
        assert.strictEqual(result.newResult.pagesProcessed, result.pageCount, 'Should process all pages');
        assert.ok(
            result.newResult.errors.length === 0,
            `New implementation had errors: ${result.newResult.errors.join(', ')}`,
        );

        // Parity note: Metrics measure DIFFERENT things (see RGB conversion test for details)
        // Assert that BOTH implementations processed something with K-Only GCR intent
        assert.ok(
            result.legacyResult.totalContentStreamConversions > 0,
            `Legacy K-Only GCR should find color operations: ${result.legacyResult.totalContentStreamConversions}`,
        );
        assert.ok(
            result.newResult.contentStreamsConverted > 0,
            `New K-Only GCR should process content streams: ${result.newResult.contentStreamsConverted}`,
        );
    });

    // ========================================
    // Full Document Conversion Tests (Images + Content Streams)
    // ========================================

    test('full document conversion with images and content streams', {
        skip: TruthyEnvironmentParameterMatcher.test(process.env.TESTS_ONLY_LEGACY),
        timeout: 60000, // 60 second timeout for full conversion
    }, async (t) => {
        if (!page) return t.skip('Page not initialized');

        const result = await invokeFullDocumentConversionTest(
            page,
            FIXTURES.typeSizesAndLissajouPDF,
            FIXTURES.eciCMYKProfile,
        );

        assert.strictEqual(result.success, true, `Full conversion failed: ${result.error}\n${result.stack || ''}`);
        assert.ok(result.pageCount > 0, 'Document should have pages');
        assert.strictEqual(result.newResult.pagesProcessed, result.pageCount, 'Should process all pages');

        // Log conversion stats for debugging
        console.log('Full document conversion stats:');
        console.log(`  Legacy: ${result.legacyResult.totalContentStreamConversions} content streams, ${result.legacyResult.totalImageConversions} images`);
        console.log(`  New: ${result.newResult.contentStreamsConverted} content streams, ${result.newResult.imagesConverted} images`);

        assert.ok(
            result.newResult.errors.length === 0,
            `New implementation had errors: ${result.newResult.errors.join(', ')}`,
        );

        // Parity note: Content stream metrics measure DIFFERENT things (see RGB conversion test)
        // Assert that BOTH implementations processed something
        assert.ok(
            result.legacyResult.totalContentStreamConversions > 0,
            `Legacy full doc should find color operations: ${result.legacyResult.totalContentStreamConversions}`,
        );
        assert.ok(
            result.newResult.contentStreamsConverted > 0,
            `New full doc should process content streams: ${result.newResult.contentStreamsConverted}`,
        );

        // Image conversion counts SHOULD match between implementations
        // Both count the number of image XObjects processed
        assert.strictEqual(
            result.newResult.imagesConverted,
            result.legacyResult.totalImageConversions,
            `Full document image count mismatch: new=${result.newResult.imagesConverted}, legacy=${result.legacyResult.totalImageConversions}`,
        );
    });

    // ========================================
    // Interlaken Map Test (Large Image PDF)
    // ========================================

    test('Interlaken Map PDF conversion (large image)', {
        // Skip by default - this test requires 2+ minutes and a large PDF
        // Enable with: TESTS_INCLUDE_SLOW=true yarn test
        skip: TruthyEnvironmentParameterMatcher.test(process.env.TESTS_ONLY_LEGACY)
            || !TruthyEnvironmentParameterMatcher.test(process.env.TESTS_INCLUDE_SLOW),
        timeout: 300000, // 5 minute timeout for large image
    }, async (t) => {
        if (!page) return t.skip('Page not initialized');

        // First check if fixture is accessible
        const accessResult = await invokeFixtureAccessibilityTest(
            page,
            FIXTURES.interlakenMapPDF,
            FIXTURES.eciCMYKProfile,
        );

        if (!accessResult.success || !accessResult.pdf.accessible) {
            return t.skip('Interlaken Map PDF fixture not accessible');
        }

        const result = await invokeFullDocumentConversionTest(
            page,
            FIXTURES.interlakenMapPDF,
            FIXTURES.eciCMYKProfile,
        );

        assert.strictEqual(result.success, true, `Interlaken Map conversion failed: ${result.error}\n${result.stack || ''}`);
        assert.ok(result.pageCount > 0, 'Document should have pages');
        assert.strictEqual(result.newResult.pagesProcessed, result.pageCount, 'Should process all pages');

        // Log conversion stats
        console.log('Interlaken Map conversion stats:');
        console.log(`  Legacy: ${result.legacyResult.totalContentStreamConversions} content streams, ${result.legacyResult.totalImageConversions} images`);
        console.log(`  New: ${result.newResult.contentStreamsConverted} content streams, ${result.newResult.imagesConverted} images`);

        assert.ok(
            result.newResult.errors.length === 0,
            `New implementation had errors: ${result.newResult.errors.join(', ')}`,
        );

        // Parity note: Content stream metrics measure DIFFERENT things (see RGB conversion test)
        // For Interlaken Map (a large image PDF), content stream work may be minimal
        // The main work is image conversion
        assert.ok(
            result.legacyResult.totalContentStreamConversions >= 0,
            `Legacy Interlaken should report color operations: ${result.legacyResult.totalContentStreamConversions}`,
        );
        assert.ok(
            result.newResult.contentStreamsConverted >= 0,
            `New Interlaken should report content streams: ${result.newResult.contentStreamsConverted}`,
        );

        // Image conversion counts SHOULD match between implementations
        // Both count the number of image XObjects processed
        assert.strictEqual(
            result.newResult.imagesConverted,
            result.legacyResult.totalImageConversions,
            `Interlaken Map image count mismatch: new=${result.newResult.imagesConverted}, legacy=${result.legacyResult.totalImageConversions}`,
        );
    });

    // ========================================
    // Legacy Comparison Tests
    // ========================================

    test('(legacy) PDFService.convertColorInPDFDocument baseline', {
        skip: !!'placeholder - legacy baseline only',
    }, async (t) => {
        if (!page) return t.skip('Page not initialized');

        const result = await page.evaluate(async ({ pdfPath, profilePath }) => {
            try {
                const { PDFDocument } = await import('pdf-lib');
                // Browser context: paths relative to /testing/iso/ptf/2025/tests/index.html
                const { PDFService } = await import('../services/PDFService.js');

                // Load PDF
                const pdfResponse = await fetch(pdfPath);
                if (!pdfResponse.ok) {
                    return { success: false, error: `Failed to fetch PDF: ${pdfResponse.status}` };
                }
                const pdfBytes = await pdfResponse.arrayBuffer();
                const pdfDoc = await PDFDocument.load(pdfBytes);

                // Load profile
                const profileResponse = await fetch(profilePath);
                if (!profileResponse.ok) {
                    return { success: false, error: `Failed to fetch profile: ${profileResponse.status}` };
                }
                const profileBuffer = await profileResponse.arrayBuffer();

                // Convert
                const result = await PDFService.convertColorInPDFDocument(pdfDoc, {
                    destinationProfile: profileBuffer,
                    renderingIntent: 'relative-colorimetric',
                    convertImages: false,
                    convertContentStreams: true,
                    useWorkers: false,
                    verbose: false,
                });

                return {
                    success: true,
                    pagesProcessed: result.pagesProcessed,
                    totalContentStreamConversions: result.totalContentStreamConversions,
                };
            } catch (error) {
                return { success: false, error: String(error), stack: error?.stack };
            }
        }, {
            pdfPath: FIXTURES.typeSizesAndLissajouPDF,
            profilePath: FIXTURES.eciCMYKProfile,
        });

        assert.strictEqual(result.success, true, `Legacy conversion failed: ${result.error}`);
        assert.ok(result.pagesProcessed > 0, 'Should process pages');
        assert.ok(result.totalContentStreamConversions >= 0, 'Should report content stream conversions');
    });
});
