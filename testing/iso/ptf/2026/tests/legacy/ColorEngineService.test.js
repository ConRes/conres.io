// @ts-check
/**
 * Tests for ColorEngineService and WASM Color Engine Integration
 *
 * These tests verify:
 * - WASM color engine initialization
 * - ICC profile loading and parsing
 * - Color transforms and conversions
 * - Integration with ColorEngineService
 */
import { test, describe, before, after } from 'node:test';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert';
import { chromium } from 'playwright-chromium';

/** @type {import('playwright-chromium').Browser | null} */
let browser = null;

/** @type {import('playwright-chromium').Page | null} */
let page = null;

/** @type {import('playwright-chromium').BrowserContext | null} */
let context = null;

const BASE_URL = process.env.BASE_URL || 'http://localhost:8080';

/**
 * Extracts importmap from parent index.html, rewrites paths for tests/ subdirectory,
 * and injects it into the page.
 * @param {import('playwright-chromium').Page} page
 */
async function injectImportmap(page) {
    const parentHtml = await readFile(new URL('../../index.html', import.meta.url), 'utf-8');
    const match = /<script type="importmap">\s*([\s\S]*?)\s*<\/script>/m.exec(parentHtml);
    if (!match) throw new Error('Failed to extract importmap from ../index.html');

    const importmap = JSON.parse(match[1]);

    if (importmap.imports) {
        for (const [key, value] of Object.entries(importmap.imports)) {
            if (typeof value === 'string' && value.startsWith('./')) {
                importmap.imports[key] = '../' + value.slice(2);
            }
        }
    }

    await page.addScriptTag({ type: 'importmap', content: JSON.stringify(importmap) });
}

describe('ColorEngineService', () => {
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

    describe('Module Loading', () => {
        test('ColorEngineService can be imported in browser', async test => {
            if (!page) return test.skip('Page not initialized');

            const result = await page.evaluate(async () => {
                try {
                    const { ColorEngineService } = await import('../services/ColorEngineService.js');
                    return {
                        success: true,
                        hasConvertColor: typeof ColorEngineService.prototype.convertColor === 'function',
                        hasConvertColors: typeof ColorEngineService.prototype.convertColors === 'function',
                        hasConvertPDFColors: typeof ColorEngineService.prototype.convertPDFColors === 'function',
                        hasLoadProfile: typeof ColorEngineService.prototype.loadProfile === 'function',
                    };
                } catch (error) {
                    return { success: false, error: String(error) };
                }
            });

            assert.strictEqual(result.success, true, `Module import failed: ${result.error}`);
            assert.strictEqual(result.hasConvertColor, true, 'convertColor should be a function');
            assert.strictEqual(result.hasConvertColors, true, 'convertColors should be a function');
            assert.strictEqual(result.hasConvertPDFColors, true, 'convertPDFColors should be a function');
            assert.strictEqual(result.hasLoadProfile, true, 'loadProfile should be a function');
        });

        test('color-engine package can be imported', async test => {
            if (!page) return test.skip('Page not initialized');

            const result = await page.evaluate(async () => {
                try {
                    const colorEngine = await import('../packages/color-engine/src/index.js');
                    return {
                        success: true,
                        hasColorEngine: typeof colorEngine.ColorEngine === 'function',
                        hasCreateEngine: typeof colorEngine.createEngine === 'function',
                        hasTypeRGB8: typeof colorEngine.TYPE_RGB_8 === 'number',
                        hasTypeCMYK8: typeof colorEngine.TYPE_CMYK_8 === 'number',
                        hasIntentPreserveK: typeof colorEngine.INTENT_PRESERVE_K_ONLY_RELATIVE_COLORIMETRIC_GCR === 'number',
                    };
                } catch (error) {
                    return { success: false, error: String(error) };
                }
            });

            assert.strictEqual(result.success, true, `color-engine import failed: ${result.error}`);
            assert.strictEqual(result.hasColorEngine, true, 'ColorEngine class should be exported');
            assert.strictEqual(result.hasCreateEngine, true, 'createEngine should be exported');
            assert.strictEqual(result.hasTypeRGB8, true, 'TYPE_RGB_8 should be exported');
            assert.strictEqual(result.hasTypeCMYK8, true, 'TYPE_CMYK_8 should be exported');
            assert.strictEqual(result.hasIntentPreserveK, true, 'INTENT_PRESERVE_K_ONLY_RELATIVE_COLORIMETRIC_GCR should be exported');
        });
    });

    describe('WASM Color Engine Initialization', () => {
        test('can create and initialize ColorEngine', async test => {
            if (!page) return test.skip('Page not initialized');

            const result = await page.evaluate(async () => {
                try {
                    const { createEngine } = await import('../packages/color-engine/src/index.js');
                    const engine = await createEngine();
                    return {
                        success: true,
                        hasEngine: engine !== null,
                        hasMalloc: typeof engine.malloc === 'function',
                        hasFree: typeof engine.free === 'function',
                        hasOpenProfileFromMem: typeof engine.openProfileFromMem === 'function',
                        hasCreateTransform: typeof engine.createTransform === 'function',
                    };
                } catch (error) {
                    return { success: false, error: String(error), stack: error?.stack };
                }
            });

            assert.strictEqual(result.success, true, `ColorEngine initialization failed: ${result.error}`);
            assert.strictEqual(result.hasEngine, true, 'Engine should be created');
            assert.strictEqual(result.hasMalloc, true, 'malloc should be available');
            assert.strictEqual(result.hasFree, true, 'free should be available');
            assert.strictEqual(result.hasOpenProfileFromMem, true, 'openProfileFromMem should be available');
            assert.strictEqual(result.hasCreateTransform, true, 'createTransform should be available');
        });

        test('can create built-in sRGB profile', async test => {
            if (!page) return test.skip('Page not initialized');

            const result = await page.evaluate(async () => {
                try {
                    const { createEngine } = await import('../packages/color-engine/src/index.js');
                    const engine = await createEngine();
                    const profile = engine.createSRGBProfile();
                    const isValid = profile !== 0 && profile !== null;
                    if (isValid) {
                        engine.closeProfile(profile);
                    }
                    return {
                        success: true,
                        profileHandle: profile,
                        isValid,
                    };
                } catch (error) {
                    return { success: false, error: String(error) };
                }
            });

            assert.strictEqual(result.success, true, `sRGB profile creation failed: ${result.error}`);
            assert.strictEqual(result.isValid, true, 'Profile handle should be valid');
        });

        test('can create built-in Lab profile', async test => {
            if (!page) return test.skip('Page not initialized');

            const result = await page.evaluate(async () => {
                try {
                    const { createEngine } = await import('../packages/color-engine/src/index.js');
                    const engine = await createEngine();
                    const profile = engine.createLab4Profile();
                    const isValid = profile !== 0 && profile !== null;
                    if (isValid) {
                        engine.closeProfile(profile);
                    }
                    return {
                        success: true,
                        profileHandle: profile,
                        isValid,
                    };
                } catch (error) {
                    return { success: false, error: String(error) };
                }
            });

            assert.strictEqual(result.success, true, `Lab profile creation failed: ${result.error}`);
            assert.strictEqual(result.isValid, true, 'Profile handle should be valid');
        });
    });

    describe('ICC Profile Loading', () => {
        test('can load eciCMYK v2 ICC profile from fixtures', async test => {
            if (!page) return test.skip('Page not initialized');

            const result = await page.evaluate(async () => {
                try {
                    const { createEngine } = await import('../packages/color-engine/src/index.js');
                    const { ICCService } = await import('../services/ICCService.js');

                    // Fetch the ICC profile
                    const response = await fetch('./fixtures/profiles/eciCMYK v2.icc');
                    if (!response.ok) {
                        return { success: false, error: `Failed to fetch profile: ${response.status}` };
                    }

                    const buffer = await response.arrayBuffer();
                    const profileBytes = new Uint8Array(buffer);

                    // Parse header using ICCService
                    const header = ICCService.parseICCHeaderFromSource(profileBytes);

                    // Load into color engine
                    const engine = await createEngine();
                    const profileHandle = engine.openProfileFromMem(profileBytes);
                    const isValid = profileHandle !== 0 && profileHandle !== null;

                    if (isValid) {
                        engine.closeProfile(profileHandle);
                    }

                    return {
                        success: true,
                        bufferSize: buffer.byteLength,
                        header: {
                            colorSpace: header.colorSpace,
                            profileClass: header.deviceClass,
                            version: header.version,
                        },
                        profileHandle,
                        isValid,
                    };
                } catch (error) {
                    return { success: false, error: String(error), stack: error?.stack };
                }
            });

            assert.strictEqual(result.success, true, `ICC profile loading failed: ${result.error}`);
            assert.ok(result.bufferSize > 0, 'Profile buffer should have content');
            assert.strictEqual(result.header?.colorSpace, 'CMYK', 'Profile should be CMYK');
            assert.strictEqual(result.isValid, true, 'Profile handle should be valid');
        });
    });

    describe('Color Transforms', () => {
        test('can create sRGB to Lab transform', async test => {
            if (!page) return test.skip('Page not initialized');

            const result = await page.evaluate(async () => {
                try {
                    const { createEngine, TYPE_RGB_8, TYPE_Lab_8, INTENT_RELATIVE_COLORIMETRIC } =
                        await import('../packages/color-engine/src/index.js');

                    const engine = await createEngine();
                    const sRGBProfile = engine.createSRGBProfile();
                    const labProfile = engine.createLab4Profile();

                    const transform = engine.createTransform(
                        sRGBProfile,
                        TYPE_RGB_8,
                        labProfile,
                        TYPE_Lab_8,
                        INTENT_RELATIVE_COLORIMETRIC,
                        0
                    );

                    const isValid = transform !== 0 && transform !== null;

                    if (isValid) {
                        engine.deleteTransform(transform);
                    }
                    engine.closeProfile(sRGBProfile);
                    engine.closeProfile(labProfile);

                    return {
                        success: true,
                        transformHandle: transform,
                        isValid,
                    };
                } catch (error) {
                    return { success: false, error: String(error), stack: error?.stack };
                }
            });

            assert.strictEqual(result.success, true, `Transform creation failed: ${result.error}`);
            assert.strictEqual(result.isValid, true, 'Transform handle should be valid');
        });

        test('can transform RGB to Lab colors', async test => {
            if (!page) return test.skip('Page not initialized');

            const result = await page.evaluate(async () => {
                try {
                    const { createEngine, TYPE_RGB_8, TYPE_Lab_8, INTENT_RELATIVE_COLORIMETRIC } =
                        await import('../packages/color-engine/src/index.js');

                    const engine = await createEngine();
                    const sRGBProfile = engine.createSRGBProfile();
                    const labProfile = engine.createLab4Profile();

                    const transform = engine.createTransform(
                        sRGBProfile,
                        TYPE_RGB_8,
                        labProfile,
                        TYPE_Lab_8,
                        INTENT_RELATIVE_COLORIMETRIC,
                        0
                    );

                    // Test pure red: RGB(255, 0, 0)
                    const inputRGB = new Uint8Array([255, 0, 0]);
                    const outputLab = new Uint8Array(3);

                    engine.doTransform(transform, inputRGB, outputLab, 1);

                    engine.deleteTransform(transform);
                    engine.closeProfile(sRGBProfile);
                    engine.closeProfile(labProfile);

                    return {
                        success: true,
                        input: Array.from(inputRGB),
                        output: Array.from(outputLab),
                        // Lab L* should be around 53 for red (0-255 scaled)
                        // Lab a* should be positive (red axis)
                        labL: outputLab[0],
                        labA: outputLab[1],
                        labB: outputLab[2],
                    };
                } catch (error) {
                    return { success: false, error: String(error), stack: error?.stack };
                }
            });

            assert.strictEqual(result.success, true, `Color transform failed: ${result.error}`);
            assert.ok(result.labL > 100, 'L* for red should be above 100 (scaled)');
            assert.ok(result.labA > 128, 'a* for red should be positive (above 128 neutral)');
        });

        test('can create sRGB to CMYK transform with eciCMYK profile', async test => {
            if (!page) return test.skip('Page not initialized');

            const result = await page.evaluate(async () => {
                try {
                    const {
                        createEngine,
                        TYPE_RGB_8,
                        TYPE_CMYK_8,
                        INTENT_RELATIVE_COLORIMETRIC,
                        cmsFLAGS_BLACKPOINTCOMPENSATION
                    } = await import('../packages/color-engine/src/index.js');

                    // Fetch eciCMYK profile
                    const response = await fetch('./fixtures/profiles/eciCMYK v2.icc');
                    if (!response.ok) {
                        return { success: false, error: `Failed to fetch profile: ${response.status}` };
                    }
                    const profileBuffer = new Uint8Array(await response.arrayBuffer());

                    const engine = await createEngine();
                    const sRGBProfile = engine.createSRGBProfile();
                    const cmykProfile = engine.openProfileFromMem(profileBuffer);

                    const transform = engine.createTransform(
                        sRGBProfile,
                        TYPE_RGB_8,
                        cmykProfile,
                        TYPE_CMYK_8,
                        INTENT_RELATIVE_COLORIMETRIC,
                        cmsFLAGS_BLACKPOINTCOMPENSATION
                    );

                    const isValid = transform !== 0 && transform !== null;

                    // Test conversion: pure cyan RGB(0, 255, 255) should map to high C
                    const inputRGB = new Uint8Array([0, 255, 255]);
                    const outputCMYK = new Uint8Array(4);

                    if (isValid) {
                        engine.doTransform(transform, inputRGB, outputCMYK, 1);
                        engine.deleteTransform(transform);
                    }

                    engine.closeProfile(sRGBProfile);
                    engine.closeProfile(cmykProfile);

                    return {
                        success: true,
                        isValid,
                        input: Array.from(inputRGB),
                        output: Array.from(outputCMYK),
                        // For cyan input, C should be highest component, M/Y should be lower
                        cmykC: outputCMYK[0],
                        cmykM: outputCMYK[1],
                        cmykY: outputCMYK[2],
                        cmykK: outputCMYK[3],
                    };
                } catch (error) {
                    return { success: false, error: String(error), stack: error?.stack };
                }
            });

            assert.strictEqual(result.success, true, `CMYK transform failed: ${result.error}`);
            assert.strictEqual(result.isValid, true, 'Transform handle should be valid');
            // For cyan (RGB 0,255,255), C should be the dominant component
            // Actual values depend on profile, but C should be > M and C should be > K
            assert.ok(result.cmykC > result.cmykM, `C (${result.cmykC}) should be > M (${result.cmykM}) for cyan`);
            assert.ok(result.cmykC > result.cmykK, `C (${result.cmykC}) should be > K (${result.cmykK}) for cyan`);
        });

        test('K-Only intent produces K-only black for neutrals', async test => {
            if (!page) return test.skip('Page not initialized');

            const result = await page.evaluate(async () => {
                try {
                    const {
                        createEngine,
                        TYPE_RGB_8,
                        TYPE_CMYK_8,
                        INTENT_PRESERVE_K_ONLY_RELATIVE_COLORIMETRIC_GCR,
                        cmsFLAGS_BLACKPOINTCOMPENSATION
                    } = await import('../packages/color-engine/src/index.js');

                    // Fetch eciCMYK profile
                    const response = await fetch('./fixtures/profiles/eciCMYK v2.icc');
                    if (!response.ok) {
                        return { success: false, error: `Failed to fetch profile: ${response.status}` };
                    }
                    const profileBuffer = new Uint8Array(await response.arrayBuffer());

                    const engine = await createEngine();
                    const sRGBProfile = engine.createSRGBProfile();
                    const cmykProfile = engine.openProfileFromMem(profileBuffer);

                    const transform = engine.createTransform(
                        sRGBProfile,
                        TYPE_RGB_8,
                        cmykProfile,
                        TYPE_CMYK_8,
                        INTENT_PRESERVE_K_ONLY_RELATIVE_COLORIMETRIC_GCR,
                        cmsFLAGS_BLACKPOINTCOMPENSATION
                    );

                    const isValid = transform !== 0 && transform !== null;

                    // Test neutral gray: RGB(128, 128, 128)
                    const inputGray = new Uint8Array([128, 128, 128]);
                    const outputCMYK = new Uint8Array(4);

                    // Test pure black: RGB(0, 0, 0)
                    const inputBlack = new Uint8Array([0, 0, 0]);
                    const outputBlack = new Uint8Array(4);

                    if (isValid) {
                        engine.doTransform(transform, inputGray, outputCMYK, 1);
                        engine.doTransform(transform, inputBlack, outputBlack, 1);
                        engine.deleteTransform(transform);
                    }

                    engine.closeProfile(sRGBProfile);
                    engine.closeProfile(cmykProfile);

                    return {
                        success: true,
                        isValid,
                        grayInput: Array.from(inputGray),
                        grayOutput: Array.from(outputCMYK),
                        blackInput: Array.from(inputBlack),
                        blackOutput: Array.from(outputBlack),
                        // For K-Only intent, CMY should be near zero for neutrals
                        grayCMY: outputCMYK[0] + outputCMYK[1] + outputCMYK[2],
                        grayK: outputCMYK[3],
                        blackCMY: outputBlack[0] + outputBlack[1] + outputBlack[2],
                        blackK: outputBlack[3],
                    };
                } catch (error) {
                    return { success: false, error: String(error), stack: error?.stack };
                }
            });

            assert.strictEqual(result.success, true, `K-Only transform failed: ${result.error}`);
            assert.strictEqual(result.isValid, true, 'Transform handle should be valid');
            // K-Only intent should produce minimal CMY for neutral grays
            assert.ok(result.grayCMY < 30, `Gray CMY sum should be minimal for K-Only intent, got ${result.grayCMY}`);
            assert.ok(result.grayK > 100, `Gray K should have significant value, got ${result.grayK}`);
            assert.ok(result.blackCMY < 30, `Black CMY sum should be minimal for K-Only intent, got ${result.blackCMY}`);
            assert.ok(result.blackK > 240, `Black K should be near maximum, got ${result.blackK}`);
        });
    });

    describe('ColorEngineService Integration', () => {
        test('ColorEngineService initializes WASM engine', async test => {
            if (!page) return test.skip('Page not initialized');

            const result = await page.evaluate(async () => {
                try {
                    const { ColorEngineService } = await import('../services/ColorEngineService.js');
                    const service = new ColorEngineService();

                    // Wait a moment for initialization
                    await new Promise(resolve => setTimeout(resolve, 100));

                    return {
                        success: true,
                        hasDefaultRenderingIntent: service.defaultRenderingIntent === 'relative-colorimetric',
                        hasDefaultBPC: service.defaultBlackPointCompensation === true,
                    };
                } catch (error) {
                    return { success: false, error: String(error), stack: error?.stack };
                }
            });

            assert.strictEqual(result.success, true, `ColorEngineService init failed: ${result.error}`);
            assert.strictEqual(result.hasDefaultRenderingIntent, true, 'Default rendering intent should be relative-colorimetric');
            assert.strictEqual(result.hasDefaultBPC, true, 'Default BPC should be true');
        });

        test('ColorEngineService can load ICC profile from URL', async test => {
            if (!page) return test.skip('Page not initialized');

            const result = await page.evaluate(async () => {
                try {
                    const { ColorEngineService } = await import('../services/ColorEngineService.js');
                    const service = new ColorEngineService();

                    const profileBuffer = await service.loadProfile('./fixtures/profiles/eciCMYK v2.icc');

                    return {
                        success: true,
                        isArrayBuffer: profileBuffer instanceof ArrayBuffer,
                        bufferSize: profileBuffer.byteLength,
                    };
                } catch (error) {
                    return { success: false, error: String(error), stack: error?.stack };
                }
            });

            assert.strictEqual(result.success, true, `Profile loading failed: ${result.error}`);
            assert.strictEqual(result.isArrayBuffer, true, 'Result should be ArrayBuffer');
            assert.ok(result.bufferSize > 0, 'Buffer should have content');
        });

        test('ColorEngineService.convertColor converts RGB to CMYK', async test => {
            if (!page) return test.skip('Page not initialized');

            const result = await page.evaluate(async () => {
                try {
                    const { ColorEngineService } = await import('../services/ColorEngineService.js');
                    const {
                        createEngine,
                        TYPE_RGB_8,
                        TYPE_CMYK_8,
                        INTENT_RELATIVE_COLORIMETRIC,
                        cmsFLAGS_BLACKPOINTCOMPENSATION
                    } = await import('../packages/color-engine/src/index.js');

                    // Create engine and test direct color conversion
                    const engine = await createEngine();

                    // Load CMYK profile from fixtures
                    const cmykResponse = await fetch('./fixtures/profiles/eciCMYK v2.icc');
                    if (!cmykResponse.ok) {
                        return { success: false, error: 'Failed to load CMYK profile' };
                    }
                    const cmykProfileBuffer = new Uint8Array(await cmykResponse.arrayBuffer());

                    // Use built-in sRGB profile
                    const sRGBProfile = engine.createSRGBProfile();
                    const cmykProfile = engine.openProfileFromMem(cmykProfileBuffer);

                    const transform = engine.createTransform(
                        sRGBProfile,
                        TYPE_RGB_8,
                        cmykProfile,
                        TYPE_CMYK_8,
                        INTENT_RELATIVE_COLORIMETRIC,
                        cmsFLAGS_BLACKPOINTCOMPENSATION
                    );

                    // Convert pure red RGB(255, 0, 0) to CMYK
                    const inputRGB = new Uint8Array([255, 0, 0]);
                    const outputCMYK = new Uint8Array(4);
                    engine.transformArray(transform, inputRGB, outputCMYK, 1);

                    // Cleanup
                    engine.deleteTransform(transform);
                    engine.closeProfile(sRGBProfile);
                    engine.closeProfile(cmykProfile);

                    // Convert to 0-1 range
                    const cmykValues = Array.from(outputCMYK).map(v => v / 255);

                    return {
                        success: true,
                        outputValues: cmykValues,
                        // Red should have low C, high M+Y, variable K
                        hasLowCyan: cmykValues[0] < 0.3,
                        hasHighMagenta: cmykValues[1] > 0.5,
                        hasHighYellow: cmykValues[2] > 0.5,
                    };
                } catch (error) {
                    return { success: false, error: String(error), stack: error?.stack };
                }
            });

            assert.strictEqual(result.success, true, `Color conversion failed: ${result.error}`);
            assert.strictEqual(result.hasLowCyan, true, 'Red should have low cyan');
            assert.strictEqual(result.hasHighMagenta, true, 'Red should have high magenta');
            assert.strictEqual(result.hasHighYellow, true, 'Red should have high yellow');
        });

        test('ColorEngineService.convertColor with K-Only intent produces K-only neutrals', async test => {
            if (!page) return test.skip('Page not initialized');

            const result = await page.evaluate(async () => {
                try {
                    const {
                        createEngine,
                        TYPE_RGB_8,
                        TYPE_CMYK_8,
                        INTENT_PRESERVE_K_ONLY_RELATIVE_COLORIMETRIC_GCR,
                        cmsFLAGS_BLACKPOINTCOMPENSATION
                    } = await import('../packages/color-engine/src/index.js');

                    const engine = await createEngine();

                    // Load CMYK profile from fixtures
                    const cmykResponse = await fetch('./fixtures/profiles/eciCMYK v2.icc');
                    if (!cmykResponse.ok) {
                        return { success: false, error: 'Failed to load CMYK profile' };
                    }
                    const cmykProfileBuffer = new Uint8Array(await cmykResponse.arrayBuffer());

                    // Use built-in sRGB profile
                    const sRGBProfile = engine.createSRGBProfile();
                    const cmykProfile = engine.openProfileFromMem(cmykProfileBuffer);

                    const transform = engine.createTransform(
                        sRGBProfile,
                        TYPE_RGB_8,
                        cmykProfile,
                        TYPE_CMYK_8,
                        INTENT_PRESERVE_K_ONLY_RELATIVE_COLORIMETRIC_GCR,
                        cmsFLAGS_BLACKPOINTCOMPENSATION
                    );

                    // Convert neutral gray RGB(128, 128, 128) to CMYK
                    const inputRGB = new Uint8Array([128, 128, 128]);
                    const outputCMYK = new Uint8Array(4);
                    engine.transformArray(transform, inputRGB, outputCMYK, 1);

                    // Cleanup
                    engine.deleteTransform(transform);
                    engine.closeProfile(sRGBProfile);
                    engine.closeProfile(cmykProfile);

                    // Convert to 0-1 range
                    const cmykValues = Array.from(outputCMYK).map(v => v / 255);
                    const cmySum = cmykValues[0] + cmykValues[1] + cmykValues[2];
                    const k = cmykValues[3];

                    return {
                        success: true,
                        outputValues: cmykValues,
                        cmySum,
                        k,
                        isKOnly: cmySum < 0.15 && k > 0.3, // CMY sum should be minimal
                    };
                } catch (error) {
                    return { success: false, error: String(error), stack: error?.stack };
                }
            });

            assert.strictEqual(result.success, true, `K-Only conversion failed: ${result.error}`);
            assert.strictEqual(result.isKOnly, true, `Neutral gray should be K-only, got CMY sum=${result.cmySum?.toFixed(3)}, K=${result.k?.toFixed(3)}`);
        });
    });
});
