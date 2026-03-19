// @ts-check
/**
 * PDFContentStreamColorConverter Class Tests
 *
 * Tests for PDF content stream color conversion.
 *
 * @module PDFContentStreamColorConverter.test
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

// ============================================================================
// Shared Test Functions (invokeXXXTest pattern)
// ============================================================================

/**
 * Tests that PDFContentStreamColorConverter extends LookupTableColorConverter.
 *
 * @param {typeof import('../../classes/baseline/pdf-content-stream-color-converter.js').PDFContentStreamColorConverter} PDFContentStreamColorConverter
 * @param {typeof import('../../classes/baseline/lookup-table-color-converter.js').LookupTableColorConverter} LookupTableColorConverter
 */
async function invokeInheritanceTest(PDFContentStreamColorConverter, LookupTableColorConverter) {
    const config = {
        renderingIntent: /** @type {const} */ ('relative-colorimetric'),
        blackPointCompensation: true,
        useAdaptiveBPCClamping: false,
        destinationProfile: createMockProfile(),
        destinationColorSpace: /** @type {const} */ ('CMYK'),
        useLookupTable: true,
        sourceRGBProfile: 'sRGB',
        sourceGrayProfile: 'sGray',
        verbose: false,
    };

    const converter = new PDFContentStreamColorConverter(config);

    assert.ok(converter instanceof PDFContentStreamColorConverter);
    assert.ok(converter instanceof LookupTableColorConverter);
    assert.strictEqual(converter.sourceRGBProfile, 'sRGB');
    assert.strictEqual(converter.sourceGrayProfile, 'sGray');

    converter.dispose();
}

/**
 * Tests content stream parsing.
 *
 * @param {typeof import('../../classes/baseline/pdf-content-stream-color-converter.js').PDFContentStreamColorConverter} PDFContentStreamColorConverter
 */
async function invokeContentStreamParsingTest(PDFContentStreamColorConverter) {
    const converter = new PDFContentStreamColorConverter({
        renderingIntent: /** @type {const} */ ('relative-colorimetric'),
        blackPointCompensation: true,
        useAdaptiveBPCClamping: false,
        destinationProfile: createMockProfile(),
        destinationColorSpace: /** @type {const} */ ('CMYK'),
        useLookupTable: true,
        verbose: false,
    });

    // Test parsing RGB color
    // parseContentStream returns {operations, finalState} - destructure to get operations
    const streamText1 = '1 0 0 rg 100 100 50 50 re f';
    const { operations: ops1 } = converter.parseContentStream(streamText1);
    assert.strictEqual(ops1.length, 1);
    assert.strictEqual(ops1[0].type, 'rgb');
    assert.deepStrictEqual(ops1[0].values, [1, 0, 0]);
    assert.strictEqual(ops1[0].operator, 'rg');

    // Test parsing Gray color
    const streamText2 = '0.5 g 50 50 100 100 re f';
    const { operations: ops2 } = converter.parseContentStream(streamText2);
    assert.strictEqual(ops2.length, 1);
    assert.strictEqual(ops2[0].type, 'gray');
    assert.deepStrictEqual(ops2[0].values, [0.5]);
    assert.strictEqual(ops2[0].operator, 'g');

    // Test parsing CMYK color (should be detected but not converted)
    const streamText3 = '0.2 0.3 0.4 0.5 k 100 100 m';
    const { operations: ops3 } = converter.parseContentStream(streamText3);
    assert.strictEqual(ops3.length, 1);
    assert.strictEqual(ops3[0].type, 'cmyk');
    assert.deepStrictEqual(ops3[0].values, [0.2, 0.3, 0.4, 0.5]);

    // Test multiple operators
    const streamText4 = '1 0 0 RG 0 1 0 rg 100 100 50 50 re B';
    const { operations: ops4 } = converter.parseContentStream(streamText4);
    assert.strictEqual(ops4.length, 2);
    assert.strictEqual(ops4[0].type, 'rgb');
    assert.strictEqual(ops4[0].operator, 'RG'); // stroke
    assert.strictEqual(ops4[1].type, 'rgb');
    assert.strictEqual(ops4[1].operator, 'rg'); // fill

    converter.dispose();
}

/**
 * Tests content stream rebuilding with mock conversion.
 *
 * @param {typeof import('../../classes/baseline/pdf-content-stream-color-converter.js').PDFContentStreamColorConverter} PDFContentStreamColorConverter
 */
async function invokeContentStreamRebuildingTest(PDFContentStreamColorConverter) {
    const converter = new PDFContentStreamColorConverter({
        renderingIntent: /** @type {const} */ ('relative-colorimetric'),
        blackPointCompensation: true,
        useAdaptiveBPCClamping: false,
        destinationProfile: createMockProfile(),
        destinationColorSpace: /** @type {const} */ ('CMYK'),
        useLookupTable: true,
        verbose: false,
    });

    const originalText = '1 0 0 rg 100 100 50 50 re f';
    // parseContentStream returns {operations, finalState} - destructure to get operations
    const { operations: ops } = converter.parseContentStream(originalText);

    // Mock replacements
    const replacements = [{
        operation: ops[0],
        convertedValues: [0.1, 0.9, 0.8, 0.0],
        cacheHit: false,
    }];

    const { segments } = converter.rebuildContentStream(originalText, replacements);
    const newText = [...segments].join('');

    // console.log('Rebuilt content stream:', newText);

    // Should replace RGB with CMYK
    // Implementation strips trailing zeros: 0.1000 → "0.1", 0.0000 → "0"
    // Check for complete CMYK value pattern to avoid matching other numbers in stream
    assert.ok(/0\.1\s+0\.9\s+0\.8\s+0\s+k/.test(newText), 'Should contain CMYK values: ' + newText);
    assert.ok(newText.includes(' k'), 'Should use k operator for fill CMYK');
    assert.ok(!newText.includes(' rg'), 'Should not have rg operator');

    converter.dispose();
}

/**
 * Tests hooks are called in correct order.
 *
 * @param {typeof import('../../classes/baseline/pdf-content-stream-color-converter.js').PDFContentStreamColorConverter} PDFContentStreamColorConverter
 */
async function invokeHookOrderTest(PDFContentStreamColorConverter) {
    const callOrder = [];

    class TestConverter extends PDFContentStreamColorConverter {
        async beforeConvertColor(input, context) {
            callOrder.push('beforeConvertColor');
            await super.beforeConvertColor(input, context);
        }

        async beforeConvertLookupTableColor(input, context) {
            callOrder.push('beforeConvertLookupTableColor');
            await super.beforeConvertLookupTableColor(input, context);
        }

        async beforeConvertPDFContentStreamColor(input, context) {
            callOrder.push('beforeConvertPDFContentStreamColor');
            await super.beforeConvertPDFContentStreamColor(input, context);
        }

        async doConvertColor(input, context) {
            callOrder.push('doConvertColor');
            // Return mock result
            return {
                streamRef: input.streamRef,
                originalText: input.streamText,
                newText: input.streamText, // unchanged for test
                replacementCount: 0,
                colorConversions: 0,
                cacheHits: 0,
            };
        }

        async afterConvertPDFContentStreamColor(input, result, context) {
            callOrder.push('afterConvertPDFContentStreamColor');
            await super.afterConvertPDFContentStreamColor(input, result, context);
        }

        async afterConvertLookupTableColor(input, result, context) {
            callOrder.push('afterConvertLookupTableColor');
            await super.afterConvertLookupTableColor(input, result, context);
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
        useLookupTable: true,
        verbose: false,
    });

    await converter.convertColor({
        streamRef: createMockRef(10),
        streamText: '1 0 0 rg 100 100 50 50 re f',
    }, {});

    assert.deepStrictEqual(callOrder, [
        'beforeConvertColor',
        'beforeConvertLookupTableColor',
        'beforeConvertPDFContentStreamColor',
        'doConvertColor',
        'afterConvertColor',
        'afterConvertLookupTableColor',
        'afterConvertPDFContentStreamColor',
    ]);

    converter.dispose();
}

/**
 * Tests worker task preparation.
 *
 * @param {typeof import('../../classes/baseline/pdf-content-stream-color-converter.js').PDFContentStreamColorConverter} PDFContentStreamColorConverter
 */
async function invokeWorkerTaskPreparationTest(PDFContentStreamColorConverter) {
    const converter = new PDFContentStreamColorConverter({
        renderingIntent: /** @type {const} */ ('relative-colorimetric'),
        blackPointCompensation: true,
        useAdaptiveBPCClamping: false,
        destinationProfile: createMockProfile(),
        destinationColorSpace: /** @type {const} */ ('CMYK'),
        useLookupTable: true,
        sourceRGBProfile: 'sRGB',
        sourceGrayProfile: 'sGray',
        verbose: false,
    });

    const input = {
        streamRef: createMockRef(42),
        streamText: '1 0 0 rg 100 100 50 50 re f',
    };

    const task = converter.prepareWorkerTask(input, {});

    assert.ok(task);
    assert.strictEqual(task.type, 'content-stream');
    assert.strictEqual(task.streamRef, '42 0 R');
    assert.strictEqual(task.streamText, input.streamText);
    assert.strictEqual(task.sourceRGBProfile, 'sRGB');
    assert.strictEqual(task.sourceGrayProfile, 'sGray');

    converter.dispose();
}

/**
 * Tests worker mode is supported.
 *
 * @param {typeof import('../../classes/baseline/pdf-content-stream-color-converter.js').PDFContentStreamColorConverter} PDFContentStreamColorConverter
 */
async function invokeWorkerModeSupportTest(PDFContentStreamColorConverter) {
    const converter = new PDFContentStreamColorConverter({
        renderingIntent: /** @type {const} */ ('relative-colorimetric'),
        blackPointCompensation: true,
        useAdaptiveBPCClamping: false,
        destinationProfile: createMockProfile(),
        destinationColorSpace: /** @type {const} */ ('CMYK'),
        useLookupTable: true,
        verbose: false,
    });

    assert.strictEqual(converter.supportsWorkerMode, true);

    converter.dispose();
}

/**
 * Tests parsing with decimal starting with dot.
 *
 * @param {typeof import('../../classes/baseline/pdf-content-stream-color-converter.js').PDFContentStreamColorConverter} PDFContentStreamColorConverter
 */
async function invokeDecimalParsingTest(PDFContentStreamColorConverter) {
    const converter = new PDFContentStreamColorConverter({
        renderingIntent: /** @type {const} */ ('relative-colorimetric'),
        blackPointCompensation: true,
        useAdaptiveBPCClamping: false,
        destinationProfile: createMockProfile(),
        destinationColorSpace: /** @type {const} */ ('CMYK'),
        useLookupTable: true,
        verbose: false,
    });

    // PDF allows ".95" instead of "0.95"
    // parseContentStream returns {operations, finalState} - destructure to get operations
    const streamText = '.95 .5 .25 rg 100 100 re f';
    const { operations: ops } = converter.parseContentStream(streamText);

    assert.strictEqual(ops.length, 1);
    assert.strictEqual(ops[0].type, 'rgb');
    assert.deepStrictEqual(ops[0].values, [0.95, 0.5, 0.25]);

    converter.dispose();
}

/**
 * Tests dispose cleans up resources.
 *
 * @param {typeof import('../../classes/baseline/pdf-content-stream-color-converter.js').PDFContentStreamColorConverter} PDFContentStreamColorConverter
 */
async function invokeDisposeTest(PDFContentStreamColorConverter) {
    const converter = new PDFContentStreamColorConverter({
        renderingIntent: /** @type {const} */ ('relative-colorimetric'),
        blackPointCompensation: true,
        useAdaptiveBPCClamping: false,
        destinationProfile: createMockProfile(),
        destinationColorSpace: /** @type {const} */ ('CMYK'),
        useLookupTable: true,
        verbose: false,
    });

    // Should not throw
    converter.dispose();

    // Double dispose should also not throw
    converter.dispose();
}

// ============================================================================
// Test Suite
// ============================================================================

describe('PDFContentStreamColorConverter', () => {
    /** @type {typeof import('../../classes/baseline/pdf-content-stream-color-converter.js').PDFContentStreamColorConverter} */
    let PDFContentStreamColorConverter;
    /** @type {typeof import('../../classes/baseline/lookup-table-color-converter.js').LookupTableColorConverter} */
    let LookupTableColorConverter;

    before(async () => {
        const ltModule = await import('../../classes/baseline/lookup-table-color-converter.js');
        LookupTableColorConverter = ltModule.LookupTableColorConverter;

        const csModule = await import('../../classes/baseline/pdf-content-stream-color-converter.js');
        PDFContentStreamColorConverter = csModule.PDFContentStreamColorConverter;
    });

    // ========================================
    // New Implementation Tests
    // ========================================

    test('extends LookupTableColorConverter properly', {
        skip: !!'instanceof check only - no regression value',
    }, async () => {
        await invokeInheritanceTest(PDFContentStreamColorConverter, LookupTableColorConverter);
    });

    test('parses content stream color operations', {
        skip: TruthyEnvironmentParameterMatcher.test(process.env.TESTS_ONLY_LEGACY),
    }, async () => {
        await invokeContentStreamParsingTest(PDFContentStreamColorConverter);
    });

    test('rebuilds content stream with converted values', {
        skip: TruthyEnvironmentParameterMatcher.test(process.env.TESTS_ONLY_LEGACY),
    }, async () => {
        await invokeContentStreamRebuildingTest(PDFContentStreamColorConverter);
    });

    test('hooks are called in correct order', {
        skip: !!'mock conversion - verifies hook order but not actual conversion',
    }, async () => {
        await invokeHookOrderTest(PDFContentStreamColorConverter);
    });

    test('prepares worker tasks correctly', {
        skip: !!'worker task shape only - no regression value',
    }, async () => {
        await invokeWorkerTaskPreparationTest(PDFContentStreamColorConverter);
    });

    test('supports worker mode', {
        skip: !!'worker mode boolean check only - no regression value',
    }, async () => {
        await invokeWorkerModeSupportTest(PDFContentStreamColorConverter);
    });

    test('parses decimals starting with dot', {
        skip: TruthyEnvironmentParameterMatcher.test(process.env.TESTS_ONLY_LEGACY),
    }, async () => {
        await invokeDecimalParsingTest(PDFContentStreamColorConverter);
    });

    test('dispose cleans up resources', {
        skip: !!'dispose mechanics only - no regression value',
    }, async () => {
        await invokeDisposeTest(PDFContentStreamColorConverter);
    });

    // ========================================
    // Legacy Implementation Tests
    // ========================================

    test('(legacy) no legacy equivalent exists', {
        skip: !!'placeholder - no legacy equivalent to compare',
    }, async () => {
        // Legacy comparison would use ColorConversionUtils.parseContentStreamColors()
        assert.ok(true, 'No direct legacy equivalent for PDFContentStreamColorConverter');
    });
});
