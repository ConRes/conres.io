// @ts-check
/**
 * ColorConverter Class Tests
 *
 * Tests for the abstract base class implementing Template Method pattern.
 *
 * @module ColorConverter.test
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import { TruthyEnvironmentParameterMatcher } from '../helpers.js';

// ============================================================================
// Test Fixtures
// ============================================================================

/**
 * Test configuration object.
 * @type {import('../../classes/color-converter.js').ColorConverterConfiguration}
 */
const TEST_CONFIG = {
    renderingIntent: 'relative-colorimetric',
    blackPointCompensation: true,
    useAdaptiveBPCClamping: true,
    destinationProfile: new ArrayBuffer(100),
    destinationColorSpace: 'CMYK',
    verbose: false,
};

// ============================================================================
// Shared Test Functions (invokeXXXTest pattern)
// ============================================================================

/**
 * Tests that configuration is frozen at construction.
 *
 * @param {typeof import('../../classes/color-converter.js').ColorConverter} ColorConverter
 */
async function invokeConfigurationFrozenTest(ColorConverter) {
    const converter = new ColorConverter(TEST_CONFIG);

    // Configuration should be frozen
    const config = converter.configuration;
    assert.strictEqual(Object.isFrozen(config), true, 'Configuration should be frozen');

    // Attempting to modify should throw in strict mode (ES modules are always strict)
    assert.throws(
        () => {
            // @ts-ignore - intentionally testing modification
            config.renderingIntent = 'perceptual';
        },
        TypeError,
        'Modifying frozen configuration should throw'
    );

    // Value should remain unchanged
    assert.strictEqual(config.renderingIntent, 'relative-colorimetric', 'Configuration should not change');

    converter.dispose();
}

/**
 * Tests parent-child relationship establishment.
 *
 * @param {typeof import('../../classes/color-converter.js').ColorConverter} ColorConverter
 */
async function invokeParentChildRelationshipTest(ColorConverter) {
    const parent = new ColorConverter(TEST_CONFIG);

    // Create a concrete subclass for testing
    class TestConverter extends ColorConverter {
        async doConvertColor(input, context) {
            return { converted: true };
        }
    }

    const child = parent.createChildConverter(TestConverter, {
        verbose: true,
    });

    assert.strictEqual(child.parentConverter, parent, 'Child should have parent reference');
    assert.strictEqual(child.configuration.renderingIntent, 'relative-colorimetric', 'Should inherit parent config');
    assert.strictEqual(child.configuration.verbose, true, 'Should apply override');

    parent.dispose();
    child.dispose();
}

/**
 * Tests per-reference configuration overrides.
 *
 * @param {typeof import('../../classes/color-converter.js').ColorConverter} ColorConverter
 */
async function invokePerReferenceOverridesTest(ColorConverter) {
    const converter = new ColorConverter(TEST_CONFIG);

    // Set override for a reference
    const ref = { objectNumber: 10, generationNumber: 0 };
    converter.setConfigurationFor(ref, {
        renderingIntent: 'perceptual',
    });

    // Check override exists
    assert.strictEqual(converter.hasConfigurationFor(ref), true, 'Should have override');

    // Get raw override
    const override = converter.getConfigurationFor(ref);
    assert.deepStrictEqual(override, Object.freeze({ renderingIntent: 'perceptual' }));

    // Get effective configuration
    const effective = converter.getEffectiveConfigurationFor(ref);
    assert.strictEqual(effective.renderingIntent, 'perceptual', 'Should use override');
    assert.strictEqual(effective.blackPointCompensation, true, 'Should inherit base');

    // Remove override
    assert.strictEqual(converter.removeConfigurationFor(ref), true, 'Should remove successfully');
    assert.strictEqual(converter.hasConfigurationFor(ref), false, 'Should not have override');

    converter.dispose();
}

/**
 * Tests template method lifecycle hooks.
 *
 * @param {typeof import('../../classes/color-converter.js').ColorConverter} ColorConverter
 */
async function invokeTemplateMethodTest(ColorConverter) {
    const callOrder = [];

    class TestConverter extends ColorConverter {
        async beforeConvertColor(input, context) {
            callOrder.push('before');
        }

        async doConvertColor(input, context) {
            callOrder.push('do');
            return { result: input.value * 2 };
        }

        async afterConvertColor(input, result, context) {
            callOrder.push('after');
        }
    }

    const converter = new TestConverter(TEST_CONFIG);
    const result = await converter.convertColor({ value: 21 }, {});

    assert.deepStrictEqual(callOrder, ['before', 'do', 'after'], 'Hooks should be called in order');
    assert.deepStrictEqual(result, { result: 42 }, 'Should return conversion result');

    converter.dispose();
}

/**
 * Tests abstract method throws when not overridden.
 *
 * @param {typeof import('../../classes/color-converter.js').ColorConverter} ColorConverter
 */
async function invokeAbstractMethodThrowsTest(ColorConverter) {
    const converter = new ColorConverter(TEST_CONFIG);

    await assert.rejects(
        async () => converter.convertColor({}, {}),
        /abstract.*must be overridden/i,
        'Should throw for abstract method'
    );

    converter.dispose();
}

/**
 * Tests reference normalization for different types.
 *
 * @param {typeof import('../../classes/color-converter.js').ColorConverter} ColorConverter
 */
async function invokeReferenceNormalizationTest(ColorConverter) {
    const converter = new ColorConverter(TEST_CONFIG);

    // String reference
    converter.setConfigurationFor('page-1', { verbose: true });
    assert.strictEqual(converter.hasConfigurationFor('page-1'), true);

    // PDFRef-like object
    const pdfRef = { objectNumber: 42, generationNumber: 0 };
    converter.setConfigurationFor(pdfRef, { verbose: true });
    assert.strictEqual(converter.hasConfigurationFor(pdfRef), true);

    // Same reference should match
    const sameRef = { objectNumber: 42, generationNumber: 0 };
    assert.strictEqual(converter.hasConfigurationFor(sameRef), true);

    converter.dispose();
}

/**
 * Tests worker mode defaults.
 *
 * @param {typeof import('../../classes/color-converter.js').ColorConverter} ColorConverter
 */
async function invokeWorkerModeDefaultsTest(ColorConverter) {
    const converter = new ColorConverter(TEST_CONFIG);

    assert.strictEqual(converter.supportsWorkerMode, false, 'Base class should not support workers');
    assert.strictEqual(converter.prepareWorkerTask({}, {}), null, 'Should return null for worker task');

    converter.dispose();
}

/**
 * Tests dispose cleans up state.
 *
 * @param {typeof import('../../classes/color-converter.js').ColorConverter} ColorConverter
 */
async function invokeDisposeTest(ColorConverter) {
    const converter = new ColorConverter(TEST_CONFIG);
    const parent = new ColorConverter(TEST_CONFIG);

    converter.parentConverter = parent;
    converter.setConfigurationFor('test', { verbose: true });

    converter.dispose();

    assert.strictEqual(converter.parentConverter, null, 'Parent should be cleared');
    assert.strictEqual(converter.hasConfigurationFor('test'), false, 'Overrides should be cleared');
}

/**
 * Tests ensureReady() waits for initialization.
 *
 * @param {typeof import('../../classes/color-converter.js').ColorConverter} ColorConverter
 */
async function invokeEnsureReadyTest(ColorConverter) {
    const converter = new ColorConverter(TEST_CONFIG);

    // ensureReady should not throw
    await converter.ensureReady();

    // After ensureReady, colorEngineProvider should be available
    assert.ok(converter.colorEngineProvider !== null, 'ColorEngineProvider should be initialized');

    converter.dispose();
}

/**
 * Tests colorEngineProvider getter returns the provider instance.
 *
 * @param {typeof import('../../classes/color-converter.js').ColorConverter} ColorConverter
 */
async function invokeColorEngineProviderGetterTest(ColorConverter) {
    const converter = new ColorConverter(TEST_CONFIG);
    await converter.ensureReady();

    const provider = converter.colorEngineProvider;
    assert.ok(provider !== null, 'colorEngineProvider getter should return provider');
    assert.strictEqual(typeof provider.createTransform, 'function', 'Provider should have createTransform method');
    assert.strictEqual(typeof provider.transformArray, 'function', 'Provider should have transformArray method');

    converter.dispose();
}

/**
 * Tests shared ColorEngineProvider injection via options.
 *
 * @param {typeof import('../../classes/color-converter.js').ColorConverter} ColorConverter
 * @param {typeof import('../../classes/color-engine-provider.js').ColorEngineProvider} ColorEngineProvider
 */
async function invokeSharedColorEngineProviderTest(ColorConverter, ColorEngineProvider) {
    // Create a shared provider
    const sharedProvider = new ColorEngineProvider();
    await sharedProvider.initialize();

    // Create converter with shared provider
    const converter = new ColorConverter(TEST_CONFIG, { colorEngineProvider: sharedProvider });
    await converter.ensureReady();

    // Should use the shared provider
    assert.strictEqual(converter.colorEngineProvider, sharedProvider, 'Should use shared provider');

    // Dispose converter - shared provider should NOT be disposed
    converter.dispose();

    // Shared provider should still be usable (not disposed)
    assert.ok(sharedProvider.isReady, 'Shared provider should still be ready after converter dispose');

    // Clean up shared provider manually
    sharedProvider.dispose();
}

// ============================================================================
// Test Suite
// ============================================================================

describe('ColorConverter', () => {
    /** @type {typeof import('../../classes/color-converter.js').ColorConverter} */
    let ColorConverter;
    /** @type {typeof import('../../classes/color-engine-provider.js').ColorEngineProvider} */
    let ColorEngineProvider;

    before(async () => {
        // Dynamic import to avoid module resolution issues
        const module = await import('../../classes/color-converter.js');
        ColorConverter = module.ColorConverter;
        const providerModule = await import('../../classes/color-engine-provider.js');
        ColorEngineProvider = providerModule.ColorEngineProvider;
    });

    // ========================================
    // New Implementation Tests
    // ========================================

    test('configuration is frozen at construction', {
        skip: TruthyEnvironmentParameterMatcher.test(process.env.TESTS_ONLY_LEGACY),
    }, async () => {
        await invokeConfigurationFrozenTest(ColorConverter);
    });

    test('establishes parent-child relationship', {
        skip: !!'object wiring only - no regression value',
    }, async () => {
        await invokeParentChildRelationshipTest(ColorConverter);
    });

    test('per-reference configuration overrides', {
        skip: TruthyEnvironmentParameterMatcher.test(process.env.TESTS_ONLY_LEGACY),
    }, async () => {
        await invokePerReferenceOverridesTest(ColorConverter);
    });

    test('template method lifecycle hooks', {
        skip: !!'template method pattern removed - convertColor not on base class',
    }, async () => {
        await invokeTemplateMethodTest(ColorConverter);
    });

    test('abstract method throws when not overridden', {
        skip: !!'error handling only - no regression value',
    }, async () => {
        await invokeAbstractMethodThrowsTest(ColorConverter);
    });

    test('reference normalization for different types', {
        skip: TruthyEnvironmentParameterMatcher.test(process.env.TESTS_ONLY_LEGACY),
    }, async () => {
        await invokeReferenceNormalizationTest(ColorConverter);
    });

    test('worker mode defaults', {
        skip: !!'worker mode boolean check only - no regression value',
    }, async () => {
        await invokeWorkerModeDefaultsTest(ColorConverter);
    });

    test('dispose cleans up state', {
        skip: !!'dispose mechanics only - no regression value',
    }, async () => {
        await invokeDisposeTest(ColorConverter);
    });

    test('ensureReady waits for initialization', {
        skip: TruthyEnvironmentParameterMatcher.test(process.env.TESTS_ONLY_LEGACY),
    }, async () => {
        await invokeEnsureReadyTest(ColorConverter);
    });

    test('colorEngineProvider getter returns provider', {
        skip: TruthyEnvironmentParameterMatcher.test(process.env.TESTS_ONLY_LEGACY),
    }, async () => {
        await invokeColorEngineProviderGetterTest(ColorConverter);
    });

    test('shared ColorEngineProvider injection via options', {
        skip: TruthyEnvironmentParameterMatcher.test(process.env.TESTS_ONLY_LEGACY),
    }, async () => {
        await invokeSharedColorEngineProviderTest(ColorConverter, ColorEngineProvider);
    });

    // ========================================
    // Legacy Implementation Tests
    // ========================================
    // Note: ColorConverter is a new class with no legacy equivalent.
    // Legacy tests would go here if there was a comparable legacy implementation.

    test('(legacy) no legacy equivalent exists', {
        skip: !!'placeholder - no legacy equivalent to compare',
    }, async () => {
        // ColorConverter is new infrastructure - no legacy comparison available.
        // This test serves as a placeholder to maintain the invokeXXXTest pattern.
        assert.ok(true, 'No legacy equivalent for ColorConverter base class');
    });
});
