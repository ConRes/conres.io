// @ts-check
/**
 * ColorEngineProvider Tests
 *
 * Tests for the thin WASM wrapper class.
 *
 * @module ColorEngineProvider.test
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
    eciCMYKProfile: './fixtures/profiles/eciCMYK v2.icc',
    sRGBProfile: './fixtures/profiles/sRGB IEC61966-2.1.icc',
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
    if (!match) throw new Error('Failed to extract importmap from ../../index.html');

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
// Test Setup
// ============================================================================

describe('ColorEngineProvider', () => {
    before(async () => {
        browser = await chromium.launch({ headless: true });
        context = await browser.newContext();
        page = await context.newPage();

        page.on('console', msg => {
            if (msg.type() === 'error') {
                console.error('Browser console error:', msg.text());
            }
        });

        // Navigate to the test page
        await page.goto(`${BASE_URL}/testing/iso/ptf/2025/tests/index.html`);
        await injectImportmap(page);
    });

    after(async () => {
        await context?.close();
        await browser?.close();
    });

    // ========================================================================
    // Initialization Tests
    // ========================================================================

    test('initialize() creates engine instance', {
        skip: TruthyEnvironmentParameterMatcher.test(process.env.TESTS_ONLY_LEGACY),
    }, async () => {
        const result = await page?.evaluate(async () => {
            const { ColorEngineProvider } = await import('../classes/baseline/color-engine-provider.js');

            const provider = new ColorEngineProvider();
            await provider.initialize();

            const isReady = provider.isReady;
            const hasEngine = provider.engine !== null;

            provider.dispose();

            return { isReady, hasEngine };
        });

        assert.strictEqual(result?.isReady, true, 'Provider should be ready after initialize');
        assert.strictEqual(result?.hasEngine, true, 'Engine should exist after initialize');
    });

    test('initialize() is idempotent', {
        skip: TruthyEnvironmentParameterMatcher.test(process.env.TESTS_ONLY_LEGACY),
    }, async () => {
        const result = await page?.evaluate(async () => {
            const { ColorEngineProvider } = await import('../classes/baseline/color-engine-provider.js');

            const provider = new ColorEngineProvider();

            // Call initialize multiple times
            const promise1 = provider.initialize();
            const promise2 = provider.initialize();
            const promise3 = provider.initialize();

            await Promise.all([promise1, promise2, promise3]);

            const isReady = provider.isReady;
            provider.dispose();

            return { isReady };
        });

        assert.strictEqual(result?.isReady, true, 'Provider should be ready');
    });

    test('throws when accessing engine before initialize', {
        skip: TruthyEnvironmentParameterMatcher.test(process.env.TESTS_ONLY_LEGACY),
    }, async () => {
        const result = await page?.evaluate(async () => {
            const { ColorEngineProvider } = await import('../classes/baseline/color-engine-provider.js');

            const provider = new ColorEngineProvider();

            try {
                const engine = provider.engine;
                return { threw: false };
            } catch (e) {
                return { threw: true, message: /** @type {Error} */ (e).message };
            }
        });

        assert.strictEqual(result?.threw, true, 'Should throw when not initialized');
        assert.ok(result?.message?.includes('not initialized'), 'Error should mention initialization');
    });

    // ========================================================================
    // Constants Tests
    // ========================================================================

    test('getConstants() returns LittleCMS constants', {
        skip: TruthyEnvironmentParameterMatcher.test(process.env.TESTS_ONLY_LEGACY),
    }, async () => {
        const result = await page?.evaluate(async () => {
            const { ColorEngineProvider } = await import('../classes/baseline/color-engine-provider.js');

            const provider = new ColorEngineProvider();
            await provider.initialize();

            const constants = provider.getConstants();

            provider.dispose();

            return {
                hasTypeRGB8: typeof constants.TYPE_RGB_8 === 'number',
                hasTypeCMYK8: typeof constants.TYPE_CMYK_8 === 'number',
                hasIntentRelCol: typeof constants.INTENT_RELATIVE_COLORIMETRIC === 'number',
                hasIntentKOnly: typeof constants.INTENT_PRESERVE_K_ONLY_RELATIVE_COLORIMETRIC_GCR === 'number',
                hasBPCFlag: typeof constants.cmsFLAGS_BLACKPOINTCOMPENSATION === 'number',
                // Verify actual values match known LittleCMS constants
                intentRelColValue: constants.INTENT_RELATIVE_COLORIMETRIC,
                intentKOnlyValue: constants.INTENT_PRESERVE_K_ONLY_RELATIVE_COLORIMETRIC_GCR,
            };
        });

        assert.strictEqual(result?.hasTypeRGB8, true, 'Should have TYPE_RGB_8');
        assert.strictEqual(result?.hasTypeCMYK8, true, 'Should have TYPE_CMYK_8');
        assert.strictEqual(result?.hasIntentRelCol, true, 'Should have INTENT_RELATIVE_COLORIMETRIC');
        assert.strictEqual(result?.hasIntentKOnly, true, 'Should have K-Only GCR intent');
        assert.strictEqual(result?.hasBPCFlag, true, 'Should have BPC flag');
        assert.strictEqual(result?.intentRelColValue, 1, 'INTENT_RELATIVE_COLORIMETRIC should be 1');
        assert.strictEqual(result?.intentKOnlyValue, 20, 'K-Only GCR intent should be 20');
    });

    // ========================================================================
    // Profile Methods Tests
    // ========================================================================

    test('createLab4Profile() creates Lab profile', {
        skip: TruthyEnvironmentParameterMatcher.test(process.env.TESTS_ONLY_LEGACY),
    }, async () => {
        const result = await page?.evaluate(async () => {
            const { ColorEngineProvider } = await import('../classes/baseline/color-engine-provider.js');

            const provider = new ColorEngineProvider();
            await provider.initialize();

            const labProfile = provider.createLab4Profile();
            const isHandle = typeof labProfile === 'number' && labProfile > 0;

            provider.closeProfile(labProfile);
            provider.dispose();

            return { isHandle };
        });

        assert.strictEqual(result?.isHandle, true, 'Should return valid profile handle');
    });

    test('openProfileFromMem() opens ICC profile', {
        skip: TruthyEnvironmentParameterMatcher.test(process.env.TESTS_ONLY_LEGACY),
    }, async () => {
        const profilePath = FIXTURES.sRGBProfile;

        const result = await page?.evaluate(async (path) => {
            const { ColorEngineProvider } = await import('../classes/baseline/color-engine-provider.js');

            // Load profile fixture
            const response = await fetch(path);
            if (!response.ok) {
                return { error: `Failed to fetch profile: ${response.status}` };
            }
            const profileBuffer = await response.arrayBuffer();

            const provider = new ColorEngineProvider();
            await provider.initialize();

            const profileHandle = provider.openProfileFromMem(profileBuffer);
            const isHandle = typeof profileHandle === 'number' && profileHandle > 0;

            provider.closeProfile(profileHandle);
            provider.dispose();

            return { isHandle };
        }, profilePath);

        if (result?.error) {
            assert.fail(result.error);
        }

        assert.strictEqual(result?.isHandle, true, 'Should return valid profile handle');
    });

    // ========================================================================
    // Transform Tests
    // ========================================================================

    test('createTransform() creates valid transform', {
        skip: TruthyEnvironmentParameterMatcher.test(process.env.TESTS_ONLY_LEGACY),
    }, async () => {
        const profilePath = FIXTURES.eciCMYKProfile;

        const result = await page?.evaluate(async (path) => {
            const { ColorEngineProvider } = await import('../classes/baseline/color-engine-provider.js');

            // Load CMYK profile
            const response = await fetch(path);
            if (!response.ok) {
                return { error: `Failed to fetch profile: ${response.status}` };
            }
            const profileBuffer = await response.arrayBuffer();

            const provider = new ColorEngineProvider();
            await provider.initialize();

            const constants = provider.getConstants();

            // Create Lab to CMYK transform
            const labProfile = provider.createLab4Profile();
            const cmykProfile = provider.openProfileFromMem(profileBuffer);

            const transform = provider.createTransform(
                labProfile,
                constants.TYPE_Lab_8,
                cmykProfile,
                constants.TYPE_CMYK_8,
                constants.INTENT_RELATIVE_COLORIMETRIC,
                constants.cmsFLAGS_BLACKPOINTCOMPENSATION
            );

            const isHandle = typeof transform === 'number' && transform > 0;

            provider.deleteTransform(transform);
            provider.closeProfile(labProfile);
            provider.closeProfile(cmykProfile);
            provider.dispose();

            return { isHandle };
        }, profilePath);

        if (result?.error) {
            assert.fail(result.error);
        }

        assert.strictEqual(result?.isHandle, true, 'Should return valid transform handle');
    });

    test('transformArray() converts pixels correctly', {
        skip: TruthyEnvironmentParameterMatcher.test(process.env.TESTS_ONLY_LEGACY),
    }, async () => {
        const profilePath = FIXTURES.eciCMYKProfile;

        const result = await page?.evaluate(async (path) => {
            const { ColorEngineProvider } = await import('../classes/baseline/color-engine-provider.js');

            // Load CMYK profile
            const response = await fetch(path);
            if (!response.ok) {
                return { error: `Failed to fetch profile: ${response.status}` };
            }
            const profileBuffer = await response.arrayBuffer();

            const provider = new ColorEngineProvider();
            await provider.initialize();

            const constants = provider.getConstants();

            // Create Lab to CMYK transform
            const labProfile = provider.createLab4Profile();
            const cmykProfile = provider.openProfileFromMem(profileBuffer);

            const transform = provider.createTransform(
                labProfile,
                constants.TYPE_Lab_8,
                cmykProfile,
                constants.TYPE_CMYK_8,
                constants.INTENT_RELATIVE_COLORIMETRIC,
                constants.cmsFLAGS_BLACKPOINTCOMPENSATION
            );

            // Convert a white pixel (Lab: L=100, a=0, b=0)
            // Lab 8-bit encoding: L*=255, a*=128, b*=128 (for L=100, a=0, b=0)
            const inputPixels = new Uint8Array([255, 128, 128]);
            const outputPixels = new Uint8Array(4); // CMYK output

            provider.transformArray(transform, inputPixels, outputPixels, 1);

            // White in CMYK should be approximately 0,0,0,0
            const isWhite = outputPixels[0] < 5 && outputPixels[1] < 5 &&
                outputPixels[2] < 5 && outputPixels[3] < 5;

            provider.deleteTransform(transform);
            provider.closeProfile(labProfile);
            provider.closeProfile(cmykProfile);
            provider.dispose();

            return {
                isWhite,
                cmyk: Array.from(outputPixels),
            };
        }, profilePath);

        if (result?.error) {
            assert.fail(result.error);
        }

        assert.strictEqual(result?.isWhite, true,
            `White Lab should convert to near-white CMYK, got: [${result?.cmyk?.join(', ')}]`);
    });

    // ========================================================================
    // Dispose Tests
    // ========================================================================

    test('dispose() clears engine state', {
        skip: TruthyEnvironmentParameterMatcher.test(process.env.TESTS_ONLY_LEGACY),
    }, async () => {
        const result = await page?.evaluate(async () => {
            const { ColorEngineProvider } = await import('../classes/baseline/color-engine-provider.js');

            const provider = new ColorEngineProvider();
            await provider.initialize();

            const wasReady = provider.isReady;
            provider.dispose();
            const isReadyAfterDispose = provider.isReady;

            return { wasReady, isReadyAfterDispose };
        });

        assert.strictEqual(result?.wasReady, true, 'Should be ready before dispose');
        assert.strictEqual(result?.isReadyAfterDispose, false, 'Should not be ready after dispose');
    });

    test('dispose() is idempotent', {
        skip: TruthyEnvironmentParameterMatcher.test(process.env.TESTS_ONLY_LEGACY),
    }, async () => {
        const result = await page?.evaluate(async () => {
            const { ColorEngineProvider } = await import('../classes/baseline/color-engine-provider.js');

            const provider = new ColorEngineProvider();
            await provider.initialize();

            // Multiple dispose calls should not throw
            provider.dispose();
            provider.dispose();
            provider.dispose();

            return { success: true };
        });

        assert.strictEqual(result?.success, true, 'Multiple dispose calls should not throw');
    });

    // ========================================================================
    // Custom Engine Path Test
    // ========================================================================

    test('accepts custom enginePath option', {
        skip: TruthyEnvironmentParameterMatcher.test(process.env.TESTS_ONLY_LEGACY),
    }, async () => {
        // This test verifies the constructor accepts enginePath
        // We use the default path since we don't have multiple versions loaded
        const result = await page?.evaluate(async () => {
            const { ColorEngineProvider, DEFAULT_ENGINE_PATH } = await import('../classes/baseline/color-engine-provider.js');

            const provider = new ColorEngineProvider({
                enginePath: DEFAULT_ENGINE_PATH,
            });

            await provider.initialize();
            const isReady = provider.isReady;
            provider.dispose();

            return { isReady };
        });

        assert.strictEqual(result?.isReady, true, 'Should initialize with custom path');
    });

    // ========================================================================
    // Legacy Comparison (placeholder)
    // ========================================================================

    test('(legacy) no legacy equivalent exists', {
        skip: !!'placeholder - no legacy equivalent to compare',
    }, async () => {
        // ColorEngineProvider is new infrastructure - replaces ColorEngineService
        // This test serves as a placeholder to maintain test file patterns
        assert.ok(true, 'No legacy equivalent for ColorEngineProvider');
    });
});
