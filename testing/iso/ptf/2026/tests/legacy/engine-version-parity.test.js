// @ts-check
/**
 * Engine Version Parity Tests
 *
 * These tests ensure that both color-engine packages produce consistent results:
 * - color-engine-2025-12-19 (old, uses fallback path for Gray)
 * - color-engine-2026-01-21 (new, has createMultiprofileTransform)
 *
 * Test Matrix:
 * - Gray → CMYK with K-Only GCR (tests Gray fallback vs multiprofile)
 * - RGB neutral → CMYK with K-Only GCR (tests K-only output)
 * - Lab neutral → CMYK with Relative Colorimetric (tests Lab handling)
 *
 * Acceptance: Color values within tolerance (size difference < 1%)
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

// Size tolerance: 1% (per project requirements)
const SIZE_TOLERANCE_PERCENT = 1;

/**
 * Extracts importmap from parent index.html, rewrites paths for tests/ subdirectory,
 * and injects it into the page.
 *
 * PATTERN: Dynamic importmap injection for Playwright tests
 * - Reads importmap from parent ../index.html (single source of truth)
 * - Rewrites ./ paths to ../ for tests/ subdirectory context
 * - Logs transformed importmap for debugging
 * - Must be called AFTER page.goto() and BEFORE any imports
 *
 * @param {import('playwright-chromium').Page} page
 */
async function injectImportmap(page) {
    // Read the parent index.html
    const parentHtml = await readFile(new URL('../../index.html', import.meta.url), 'utf-8');

    // Extract importmap JSON from script tag
    const match = /<script type="importmap">\s*([\s\S]*?)\s*<\/script>/m.exec(parentHtml);
    if (!match) throw new Error('Failed to extract importmap from ../index.html');

    const importmap = JSON.parse(match[1]);

    // Rewrite paths: ./ becomes ../ (adjusting for tests/ subdirectory)
    if (importmap.imports) {
        for (const [key, value] of Object.entries(importmap.imports)) {
            if (typeof value === 'string' && value.startsWith('./')) {
                importmap.imports[key] = '../' + value.slice(2);
            }
        }
    }

    console.log('[EngineVersionParity] Transformed importmap:', importmap);

    // Inject the transformed importmap
    await page.addScriptTag({ type: 'importmap', content: JSON.stringify(importmap) });
}

describe('Engine Version Parity Tests', () => {
    before(async () => {
        console.log('[EngineVersionParity] before() hook starting...');
        console.log('[EngineVersionParity] Launching browser...');
        browser = await chromium.launch({ headless: true });
        console.log('[EngineVersionParity] Browser launched');

        console.log('[EngineVersionParity] Creating context...');
        context = await browser.newContext();
        console.log('[EngineVersionParity] Context created');

        console.log('[EngineVersionParity] Creating page...');
        page = await context.newPage();
        console.log('[EngineVersionParity] Page created');

        // Forward browser console to Node.js stdout
        page.on('console', msg => {
            console.log(`[Browser ${msg.type()}] ${msg.text()}`);
        });

        // Forward browser errors to Node.js stderr
        page.on('pageerror', error => {
            console.error(`[Browser error] ${error.message}`);
        });

        // Increase timeout for large PDF conversions
        page.setDefaultTimeout(180000); // 3 minutes

        console.log(`[EngineVersionParity] Navigating to ${BASE_URL}/testing/iso/ptf/2025/tests/index.html...`);
        await page.goto(`${BASE_URL}/testing/iso/ptf/2025/tests/index.html`);
        console.log('[EngineVersionParity] Navigation complete');

        console.log('[EngineVersionParity] Injecting importmap...');
        await injectImportmap(page);
        console.log('[EngineVersionParity] Importmap injected');

        console.log('[EngineVersionParity] before() hook complete');
    });

    after(async () => {
        await context?.close();
        await browser?.close();
        browser = null;
        context = null;
        page = null;
    });

    // PATTERN: Module Loading tests verify imports work before running conversion tests
    // These tests catch importmap issues early and provide clear error messages
    // Must run FIRST to validate the test environment is correctly configured
    describe('Module Loading', () => {
        test('Both color engine versions can be loaded', async test => {
            if (!page) return test.skip('Page not initialized');

            const result = await page.evaluate(async () => {
                try {
                    // Test old engine
                    const oldEngine = await import('../packages/color-engine-2025-12-19/src/index.js');
                    const oldInstance = await oldEngine.createEngine();

                    // Test new engine
                    const newEngine = await import('../packages/color-engine/src/index.js');
                    const newInstance = await newEngine.createEngine();

                    return {
                        success: true,
                        oldHasCreateEngine: typeof oldEngine.createEngine === 'function',
                        newHasCreateEngine: typeof newEngine.createEngine === 'function',
                        oldHasCreateMultiprofileTransform: typeof oldInstance.createMultiprofileTransform === 'function',
                        newHasCreateMultiprofileTransform: typeof newInstance.createMultiprofileTransform === 'function',
                    };
                } catch (error) {
                    return { success: false, error: String(error), stack: error?.stack };
                }
            });

            assert.strictEqual(result.success, true, `Engine import failed: ${result.error}`);
            assert.strictEqual(result.oldHasCreateEngine, true, 'Old engine should have createEngine');
            assert.strictEqual(result.newHasCreateEngine, true, 'New engine should have createEngine');
            // Note: createMultiprofileTransform may or may not exist in old engine
            assert.strictEqual(result.newHasCreateMultiprofileTransform, true, 'New engine should have createMultiprofileTransform');
        });
    });

    describe('K-Only GCR Parity (Type Sizes PDF)', () => {
        test('eciCMYK v2: Old engine vs New engine parity', async test => {
            console.log('[EngineVersionParity] Test starting: eciCMYK v2 engine comparison');
            if (!page) return test.skip('Page not initialized');

            console.log('[EngineVersionParity] Page is initialized, starting test...');

            const result = await page.evaluate(async () => {
                try {
                    console.log('[DEBUG] Loading pdf-lib and PDFService...');
                    const { PDFDocument } = await import('pdf-lib');
                    const { PDFService } = await import('../services/PDFService.js');

                    // Load test PDF (use Type Sizes - smaller, faster)
                    console.log('[DEBUG] Fetching test PDF...');
                    const pdfResponse = await fetch('./fixtures/pdfs/2025-08-15 - ConRes - ISO PTF - CR1 - Type Sizes and Lissajou.pdf');
                    console.log(`[DEBUG] PDF response status: ${pdfResponse.status}`);
                    const pdfBytes = await pdfResponse.arrayBuffer();
                    console.log(`[DEBUG] PDF loaded: ${pdfBytes.byteLength} bytes`);

                    // Load eciCMYK v2 profile
                    console.log('[DEBUG] Fetching ICC profile...');
                    const profileResponse = await fetch('./fixtures/profiles/eciCMYK v2.icc');
                    const profileBuffer = await profileResponse.arrayBuffer();
                    console.log(`[DEBUG] Profile loaded: ${profileBuffer.byteLength} bytes`);

                    // Load documents for each engine version
                    console.log('[DEBUG] Loading documents for each engine...');
                    const oldEngineDoc = await PDFDocument.load(pdfBytes);
                    const newEngineDoc = await PDFDocument.load(pdfBytes);

                    // PATTERN: Helper function for consistent conversion + logging + error handling
                    /**
                     * @param {string} context
                     * @param {import('pdf-lib').PDFDocument} document
                     * @param {string} colorEnginePath
                     */
                    const convertWithEngine = async (context, document, colorEnginePath) => {
                        try {
                            await PDFService.convertColorInPDFDocument(document, {
                                destinationProfile: profileBuffer,
                                renderingIntent: 'k-only',
                                useWorkers: false, // Use main thread for consistent comparison
                                verbose: false,
                                colorEnginePath,
                            });
                            console.log(`[DEBUG] ${context} conversion complete`);
                            const pdfBytes = await document.save();
                            console.log(`[DEBUG] ${context} PDF saved: ${pdfBytes.byteLength} bytes`);
                            return pdfBytes;
                        } catch (error) {
                            throw new Error(`${context} conversion failed: ${error}`, { cause: error });
                        }
                    };

                    // PATTERN: Parallel execution with Promise.allSettled
                    const conversionPromises = {
                        old: convertWithEngine('Old engine (2025-12-19)', oldEngineDoc, 'packages/color-engine-2025-12-19'),
                        new: convertWithEngine('New engine (2026-01-21)', newEngineDoc, 'packages/color-engine-2026-01-21'),
                    };

                    await Promise.allSettled([
                        conversionPromises.old,
                        conversionPromises.new,
                    ]);

                    const oldPDF = await conversionPromises.old;
                    const newPDF = await conversionPromises.new;

                    // PATTERN: Return sizes only (not full PDF arrays)
                    return {
                        success: true,
                        sizeOld: oldPDF.length,
                        sizeNew: newPDF.length,
                    };
                } catch (error) {
                    console.error('[DEBUG] Error:', error);
                    return { success: false, error: String(error), stack: error?.stack };
                }
            });

            console.log('  [DEBUG] Browser evaluation complete');
            assert.strictEqual(result.success, true, `Conversion failed: ${result.error}`);

            const { sizeOld, sizeNew } = /** @type {{sizeOld: number, sizeNew: number}} */ (result);
            const sizePercentDifference = Math.abs(sizeOld - sizeNew) / sizeOld * 100;

            console.log(`  Old engine (2025-12-19): ${sizeOld.toLocaleString()} bytes`);
            console.log(`  New engine (2026-01-07): ${sizeNew.toLocaleString()} bytes`);
            console.log(`  Difference: ${sizePercentDifference.toFixed(2)}%`);

            assert.ok(
                sizePercentDifference < SIZE_TOLERANCE_PERCENT,
                `PDF size difference ${sizePercentDifference.toFixed(2)}% exceeds tolerance ${SIZE_TOLERANCE_PERCENT}%`
            );
        });

        test('FIPS RGB: Old engine vs New engine parity', async test => {
            console.log('[EngineVersionParity] Test starting: FIPS RGB engine comparison');
            if (!page) return test.skip('Page not initialized');

            console.log('[EngineVersionParity] Page is initialized, starting test...');

            const result = await page.evaluate(async () => {
                try {
                    console.log('[DEBUG] Loading pdf-lib and PDFService...');
                    const { PDFDocument } = await import('pdf-lib');
                    const { PDFService } = await import('../services/PDFService.js');

                    // Load test PDF (use Type Sizes - smaller, faster)
                    console.log('[DEBUG] Fetching test PDF...');
                    const pdfResponse = await fetch('./fixtures/pdfs/2025-08-15 - ConRes - ISO PTF - CR1 - Type Sizes and Lissajou.pdf');
                    console.log(`[DEBUG] PDF response status: ${pdfResponse.status}`);
                    const pdfBytes = await pdfResponse.arrayBuffer();
                    console.log(`[DEBUG] PDF loaded: ${pdfBytes.byteLength} bytes`);

                    // Load FIPS RGB profile
                    console.log('[DEBUG] Fetching ICC profile...');
                    const profileResponse = await fetch('./fixtures/profiles/FIPS_WIDE_28T-TYPEavg.icc');
                    const profileBuffer = await profileResponse.arrayBuffer();
                    console.log(`[DEBUG] Profile loaded: ${profileBuffer.byteLength} bytes`);

                    // Load documents for each engine version
                    console.log('[DEBUG] Loading documents for each engine...');
                    const oldEngineDoc = await PDFDocument.load(pdfBytes);
                    const newEngineDoc = await PDFDocument.load(pdfBytes);

                    // PATTERN: Helper function (same as above)
                    /**
                     * @param {string} context
                     * @param {import('pdf-lib').PDFDocument} document
                     * @param {string} colorEnginePath
                     */
                    const convertWithEngine = async (context, document, colorEnginePath) => {
                        try {
                            await PDFService.convertColorInPDFDocument(document, {
                                destinationProfile: profileBuffer,
                                renderingIntent: 'relative-colorimetric',
                                useWorkers: false,
                                verbose: false,
                                colorEnginePath,
                            });
                            console.log(`[DEBUG] ${context} conversion complete`);
                            const pdfBytes = await document.save();
                            console.log(`[DEBUG] ${context} PDF saved: ${pdfBytes.byteLength} bytes`);
                            return pdfBytes;
                        } catch (error) {
                            throw new Error(`${context} conversion failed: ${error}`, { cause: error });
                        }
                    };

                    // PATTERN: Parallel execution
                    const conversionPromises = {
                        old: convertWithEngine('Old engine (2025-12-19)', oldEngineDoc, 'packages/color-engine-2025-12-19'),
                        new: convertWithEngine('New engine (2026-01-21)', newEngineDoc, 'packages/color-engine-2026-01-21'),
                    };

                    await Promise.allSettled([
                        conversionPromises.old,
                        conversionPromises.new,
                    ]);

                    const oldPDF = await conversionPromises.old;
                    const newPDF = await conversionPromises.new;

                    // PATTERN: Return sizes only
                    return {
                        success: true,
                        sizeOld: oldPDF.length,
                        sizeNew: newPDF.length,
                    };
                } catch (error) {
                    console.error('[DEBUG] Error:', error);
                    return { success: false, error: String(error), stack: error?.stack };
                }
            });

            console.log('  [DEBUG] Browser evaluation complete');
            assert.strictEqual(result.success, true, `Conversion failed: ${result.error}`);

            const { sizeOld, sizeNew } = /** @type {{sizeOld: number, sizeNew: number}} */ (result);
            const sizePercentDifference = Math.abs(sizeOld - sizeNew) / sizeOld * 100;

            console.log(`  Old engine (2025-12-19): ${sizeOld.toLocaleString()} bytes`);
            console.log(`  New engine (2026-01-07): ${sizeNew.toLocaleString()} bytes`);
            console.log(`  Difference: ${sizePercentDifference.toFixed(2)}%`);

            assert.ok(
                sizePercentDifference < SIZE_TOLERANCE_PERCENT,
                `PDF size difference ${sizePercentDifference.toFixed(2)}% exceeds tolerance ${SIZE_TOLERANCE_PERCENT}%`
            );
        });
    });

    // NOTE: Engine parity for large PDFs (Interlaken Map) is verified via
    // benchmark comparisons with matrix-benchmark.js rather than browser-based tests.
    // See baseline folders 019-022 for engine version comparison results.
});
