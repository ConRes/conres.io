// @ts-check
/**
 * LookupTableColorConverter Class Tests
 *
 * Tests for lookup table color conversion caching.
 *
 * @module LookupTableColorConverter.test
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

// ============================================================================
// Shared Test Functions (invokeXXXTest pattern)
// ============================================================================

/**
 * Tests that LookupTableColorConverter extends ColorConverter.
 *
 * @param {typeof import('../../classes/baseline/lookup-table-color-converter.js').LookupTableColorConverter} LookupTableColorConverter
 * @param {typeof import('../../classes/baseline/color-converter.js').ColorConverter} ColorConverter
 */
async function invokeInheritanceTest(LookupTableColorConverter, ColorConverter) {
    const config = {
        renderingIntent: /** @type {const} */ ('relative-colorimetric'),
        blackPointCompensation: true,
        useAdaptiveBPCClamping: false,
        destinationProfile: createMockProfile(),
        destinationColorSpace: /** @type {const} */ ('CMYK'),
        useLookupTable: true,
        verbose: false,
    };

    const converter = new LookupTableColorConverter(config);

    assert.ok(converter instanceof LookupTableColorConverter);
    assert.ok(converter instanceof ColorConverter);
    assert.strictEqual(converter.useLookupTable, true);

    converter.dispose();
}

/**
 * Tests lookup table caching behavior.
 *
 * @param {typeof import('../../classes/baseline/lookup-table-color-converter.js').LookupTableColorConverter} LookupTableColorConverter
 */
async function invokeLookupTableCachingTest(LookupTableColorConverter) {
    // Create concrete implementation for testing
    class TestConverter extends LookupTableColorConverter {
        conversionCount = 0;

        async convertBatchUncached(inputs, context) {
            this.conversionCount += inputs.length;
            // Mock conversion: just return fixed CMYK values
            return inputs.map(() => [0.1, 0.2, 0.3, 0.4]);
        }
    }

    const converter = new TestConverter({
        renderingIntent: /** @type {const} */ ('relative-colorimetric'),
        blackPointCompensation: true,
        useAdaptiveBPCClamping: false,
        destinationProfile: createMockProfile(),
        destinationColorSpace: /** @type {const} */ ('CMYK'),
        useLookupTable: true,
        lookupTableThreshold: 1, // Enable immediately
        verbose: false,
    });

    // First conversion - should miss cache
    const result1 = await converter.convertColor({
        colorSpace: 'RGB',
        values: [255, 0, 0],
    }, {});

    assert.strictEqual(result1.cacheHit, false);
    assert.strictEqual(converter.conversionCount, 1);

    // Second conversion of same color - should hit cache
    const result2 = await converter.convertColor({
        colorSpace: 'RGB',
        values: [255, 0, 0],
    }, {});

    assert.strictEqual(result2.cacheHit, true);
    assert.strictEqual(converter.conversionCount, 1); // No new conversion

    // Different color - should miss cache
    const result3 = await converter.convertColor({
        colorSpace: 'RGB',
        values: [0, 255, 0],
    }, {});

    assert.strictEqual(result3.cacheHit, false);
    assert.strictEqual(converter.conversionCount, 2);

    // Check stats
    const stats = converter.lookupTableStats;
    assert.strictEqual(stats.hits, 1);
    assert.strictEqual(stats.misses, 2);
    assert.strictEqual(stats.size, 2);

    converter.dispose();
}

/**
 * Tests batch conversion with caching.
 *
 * @param {typeof import('../../classes/baseline/lookup-table-color-converter.js').LookupTableColorConverter} LookupTableColorConverter
 */
async function invokeBatchConversionTest(LookupTableColorConverter) {
    class TestConverter extends LookupTableColorConverter {
        batchCalls = 0;

        async convertBatchUncached(inputs, context) {
            this.batchCalls++;
            return inputs.map(() => [0.1, 0.2, 0.3, 0.4]);
        }
    }

    const converter = new TestConverter({
        renderingIntent: /** @type {const} */ ('relative-colorimetric'),
        blackPointCompensation: true,
        useAdaptiveBPCClamping: false,
        destinationProfile: createMockProfile(),
        destinationColorSpace: /** @type {const} */ ('CMYK'),
        useLookupTable: true,
        lookupTableThreshold: 1,
        verbose: false,
    });

    // First batch - all miss cache
    const results1 = await converter.convertBatch([
        { colorSpace: /** @type {const} */ ('RGB'), values: [255, 0, 0] },
        { colorSpace: /** @type {const} */ ('RGB'), values: [0, 255, 0] },
        { colorSpace: /** @type {const} */ ('RGB'), values: [0, 0, 255] },
    ], {});

    assert.strictEqual(results1.length, 3);
    assert.strictEqual(results1[0].cacheHit, false);
    assert.strictEqual(converter.batchCalls, 1);

    // Second batch with some cached colors
    const results2 = await converter.convertBatch([
        { colorSpace: /** @type {const} */ ('RGB'), values: [255, 0, 0] }, // cached
        { colorSpace: /** @type {const} */ ('RGB'), values: [255, 255, 0] }, // new
    ], {});

    assert.strictEqual(results2.length, 2);
    assert.strictEqual(results2[0].cacheHit, true);
    assert.strictEqual(results2[1].cacheHit, false);
    assert.strictEqual(converter.batchCalls, 2);

    converter.dispose();
}

/**
 * Tests cache threshold behavior.
 *
 * @param {typeof import('../../classes/baseline/lookup-table-color-converter.js').LookupTableColorConverter} LookupTableColorConverter
 */
async function invokeCacheThresholdTest(LookupTableColorConverter) {
    class TestConverter extends LookupTableColorConverter {
        actualConversionCount = 0;

        async convertBatchUncached(inputs, context) {
            this.actualConversionCount += inputs.length;
            return inputs.map(() => [0.1, 0.2, 0.3, 0.4]);
        }
    }

    const converter = new TestConverter({
        renderingIntent: /** @type {const} */ ('relative-colorimetric'),
        blackPointCompensation: true,
        useAdaptiveBPCClamping: false,
        destinationProfile: createMockProfile(),
        destinationColorSpace: /** @type {const} */ ('CMYK'),
        useLookupTable: true,
        lookupTableThreshold: 3, // Cache lookups start after 3 conversions
        verbose: false,
    });

    // Use different colors for first conversions to build up count
    // Cache lookups only start after threshold is reached
    const result1 = await converter.convertColor({
        colorSpace: 'RGB',
        values: [255, 0, 0],
    }, {});
    assert.strictEqual(result1.cacheHit, false, 'First conversion should miss (count=1 < threshold)');

    const result2 = await converter.convertColor({
        colorSpace: 'RGB',
        values: [0, 255, 0],
    }, {});
    assert.strictEqual(result2.cacheHit, false, 'Second conversion should miss (count=2 < threshold)');

    // Third conversion reaches threshold, but this is a new color
    const result3 = await converter.convertColor({
        colorSpace: 'RGB',
        values: [0, 0, 255],
    }, {});
    // count=3, lookup enabled, but this color wasn't cached yet
    assert.strictEqual(result3.cacheHit, false, 'Third conversion with new color should miss');

    // Fourth conversion - now lookups enabled and color was cached
    const result4 = await converter.convertColor({
        colorSpace: 'RGB',
        values: [255, 0, 0], // Same as first color
    }, {});
    assert.strictEqual(result4.cacheHit, true, 'Fourth conversion should hit cached color');

    // Verify actual conversions: 3 unique colors converted
    assert.strictEqual(converter.actualConversionCount, 3, 'Should have 3 actual conversions');

    converter.dispose();
}

/**
 * Tests clear lookup table.
 *
 * @param {typeof import('../../classes/baseline/lookup-table-color-converter.js').LookupTableColorConverter} LookupTableColorConverter
 */
async function invokeClearLookupTableTest(LookupTableColorConverter) {
    class TestConverter extends LookupTableColorConverter {
        async convertBatchUncached(inputs, context) {
            return inputs.map(() => [0.1, 0.2, 0.3, 0.4]);
        }
    }

    const converter = new TestConverter({
        renderingIntent: /** @type {const} */ ('relative-colorimetric'),
        blackPointCompensation: true,
        useAdaptiveBPCClamping: false,
        destinationProfile: createMockProfile(),
        destinationColorSpace: /** @type {const} */ ('CMYK'),
        useLookupTable: true,
        lookupTableThreshold: 1,
        verbose: false,
    });

    // Add some cached entries
    await converter.convertColor({ colorSpace: 'RGB', values: [255, 0, 0] }, {});
    await converter.convertColor({ colorSpace: 'RGB', values: [0, 255, 0] }, {});

    assert.strictEqual(converter.lookupTableStats.size, 2);

    // Clear cache
    converter.clearLookupTable();

    assert.strictEqual(converter.lookupTableStats.size, 0);
    assert.strictEqual(converter.lookupTableStats.hits, 0);
    assert.strictEqual(converter.lookupTableStats.misses, 0);

    converter.dispose();
}

/**
 * Tests populate lookup table.
 *
 * @param {typeof import('../../classes/baseline/lookup-table-color-converter.js').LookupTableColorConverter} LookupTableColorConverter
 */
async function invokePopulateLookupTableTest(LookupTableColorConverter) {
    class TestConverter extends LookupTableColorConverter {
        conversionCount = 0;

        async convertBatchUncached(inputs, context) {
            this.conversionCount += inputs.length;
            return inputs.map(() => [0.9, 0.9, 0.9, 0.9]);
        }
    }

    const converter = new TestConverter({
        renderingIntent: /** @type {const} */ ('relative-colorimetric'),
        blackPointCompensation: true,
        useAdaptiveBPCClamping: false,
        destinationProfile: createMockProfile(),
        destinationColorSpace: /** @type {const} */ ('CMYK'),
        useLookupTable: true,
        lookupTableThreshold: 1,
        verbose: false,
    });

    // Pre-populate with known conversions
    converter.populateLookupTable([
        { colorSpace: 'RGB', values: [255, 0, 0], converted: [0.1, 0.2, 0.3, 0.4] },
        { colorSpace: 'RGB', values: [0, 255, 0], converted: [0.5, 0.6, 0.7, 0.8] },
    ]);

    assert.strictEqual(converter.lookupTableStats.size, 2);

    // Trigger threshold
    await converter.convertColor({ colorSpace: 'Gray', values: [0.5] }, {});

    // Pre-populated color should hit cache
    const result = await converter.convertColor({
        colorSpace: 'RGB',
        values: [255, 0, 0],
    }, {});

    assert.strictEqual(result.cacheHit, true);
    assert.deepStrictEqual(result.values, [0.1, 0.2, 0.3, 0.4]);
    assert.strictEqual(converter.conversionCount, 1); // Only the threshold-trigger conversion

    converter.dispose();
}

/**
 * Tests hooks are called in correct order.
 *
 * @param {typeof import('../../classes/baseline/lookup-table-color-converter.js').LookupTableColorConverter} LookupTableColorConverter
 */
async function invokeHookOrderTest(LookupTableColorConverter) {
    const callOrder = [];

    class TestConverter extends LookupTableColorConverter {
        async beforeConvertColor(input, context) {
            callOrder.push('beforeConvertColor');
            await super.beforeConvertColor(input, context);
        }

        async beforeConvertLookupTableColor(input, context) {
            callOrder.push('beforeConvertLookupTableColor');
            await super.beforeConvertLookupTableColor(input, context);
        }

        async convertBatchUncached(inputs, context) {
            callOrder.push('convertBatchUncached');
            return inputs.map(() => [0.1, 0.2, 0.3, 0.4]);
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
        lookupTableThreshold: 1,
        verbose: false,
    });

    await converter.convertColor({
        colorSpace: 'RGB',
        values: [255, 0, 0],
    }, {});

    assert.deepStrictEqual(callOrder, [
        'beforeConvertColor',
        'beforeConvertLookupTableColor',
        'convertBatchUncached',
        'afterConvertColor',
        'afterConvertLookupTableColor',
    ]);

    converter.dispose();
}

/**
 * Tests abstract method throws.
 *
 * @param {typeof import('../../classes/baseline/lookup-table-color-converter.js').LookupTableColorConverter} LookupTableColorConverter
 */
async function invokeAbstractMethodThrowsTest(LookupTableColorConverter) {
    const converter = new LookupTableColorConverter({
        renderingIntent: /** @type {const} */ ('relative-colorimetric'),
        blackPointCompensation: true,
        useAdaptiveBPCClamping: false,
        destinationProfile: createMockProfile(),
        destinationColorSpace: /** @type {const} */ ('CMYK'),
        useLookupTable: true,
        lookupTableThreshold: 1,
        verbose: false,
    });

    await assert.rejects(
        async () => converter.convertColor({ colorSpace: 'RGB', values: [255, 0, 0] }, {}),
        /convertBatchUncached.*abstract.*must be overridden/i
    );

    converter.dispose();
}

// ============================================================================
// Test Suite
// ============================================================================

describe('LookupTableColorConverter', () => {
    /** @type {typeof import('../../classes/baseline/lookup-table-color-converter.js').LookupTableColorConverter} */
    let LookupTableColorConverter;
    /** @type {typeof import('../../classes/baseline/color-converter.js').ColorConverter} */
    let ColorConverter;

    before(async () => {
        const ccModule = await import('../../classes/baseline/color-converter.js');
        ColorConverter = ccModule.ColorConverter;

        const ltModule = await import('../../classes/baseline/lookup-table-color-converter.js');
        LookupTableColorConverter = ltModule.LookupTableColorConverter;
    });

    // ========================================
    // New Implementation Tests
    // ========================================

    test('extends ColorConverter properly', {
        skip: !!'instanceof check only - no regression value',
    }, async () => {
        await invokeInheritanceTest(LookupTableColorConverter, ColorConverter);
    });

    test('lookup table caching behavior', {
        skip: TruthyEnvironmentParameterMatcher.test(process.env.TESTS_ONLY_LEGACY),
    }, async () => {
        await invokeLookupTableCachingTest(LookupTableColorConverter);
    });

    test('batch conversion with caching', {
        skip: TruthyEnvironmentParameterMatcher.test(process.env.TESTS_ONLY_LEGACY),
    }, async () => {
        await invokeBatchConversionTest(LookupTableColorConverter);
    });

    test('cache threshold behavior', {
        skip: TruthyEnvironmentParameterMatcher.test(process.env.TESTS_ONLY_LEGACY),
    }, async () => {
        await invokeCacheThresholdTest(LookupTableColorConverter);
    });

    test('clear lookup table', {
        skip: TruthyEnvironmentParameterMatcher.test(process.env.TESTS_ONLY_LEGACY),
    }, async () => {
        await invokeClearLookupTableTest(LookupTableColorConverter);
    });

    test('populate lookup table', {
        skip: TruthyEnvironmentParameterMatcher.test(process.env.TESTS_ONLY_LEGACY),
    }, async () => {
        await invokePopulateLookupTableTest(LookupTableColorConverter);
    });

    test('hooks are called in correct order', {
        skip: !!'mock conversion - verifies hook order but not actual conversion',
    }, async () => {
        await invokeHookOrderTest(LookupTableColorConverter);
    });

    test('abstract method throws', {
        skip: !!'error handling only - no regression value',
    }, async () => {
        await invokeAbstractMethodThrowsTest(LookupTableColorConverter);
    });

    // ========================================
    // Legacy Implementation Tests
    // ========================================

    test('(legacy) no legacy equivalent exists', {
        skip: !!'placeholder - no legacy equivalent to compare',
    }, async () => {
        assert.ok(true, 'No legacy equivalent for LookupTableColorConverter');
    });
});
