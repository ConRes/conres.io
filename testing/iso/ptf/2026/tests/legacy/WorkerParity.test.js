// @ts-check
/**
 * Worker Parity Tests for PDFService
 *
 * These tests ensure that color conversion produces identical results
 * whether executed on the main thread or in worker threads.
 *
 * Test Matrix:
 * - Type Sizes + Lissajou: eciCMYK v2 (K-Only GCR) + FIPS RGB
 * - Interlaken Map: eciCMYK v2 (K-Only GCR) + FIPS RGB
 *
 * Acceptance: Output PDF size difference < 1%
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

    console.log('[WorkerParity] Transformed importmap:', importmap);

    // Inject the transformed importmap
    await page.addScriptTag({ type: 'importmap', content: JSON.stringify(importmap) });
}

/**
 * Compare two PDF byte arrays and return size difference percentage
 * @param {Uint8Array} mainThreadPDF
 * @param {Uint8Array} workerThreadPDF
 * @returns {{sizeMain: number, sizeWorker: number, diffPercent: number}}
 */
function comparePDFSizes(mainThreadPDF, workerThreadPDF) {
    const sizeMain = mainThreadPDF.length;
    const sizeWorker = workerThreadPDF.length;
    const diffPercent = Math.abs(sizeMain - sizeWorker) / sizeMain * 100;

    return { sizeMain, sizeWorker, diffPercent };
}

describe('Worker Parity Tests', () => {
    before(async () => {
        console.log('[WorkerParity] before() hook starting...');
        console.log('[WorkerParity] Launching browser...');
        browser = await chromium.launch({ headless: true });
        console.log('[WorkerParity] Browser launched');

        console.log('[WorkerParity] Creating context...');
        context = await browser.newContext();
        console.log('[WorkerParity] Context created');

        console.log('[WorkerParity] Creating page...');
        page = await context.newPage();
        console.log('[WorkerParity] Page created');

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

        console.log(`[WorkerParity] Navigating to ${BASE_URL}/testing/iso/ptf/2025/tests/index.html...`);
        await page.goto(`${BASE_URL}/testing/iso/ptf/2025/tests/index.html`);
        console.log('[WorkerParity] Navigation complete');

        console.log('[WorkerParity] Injecting importmap...');
        await injectImportmap(page);
        console.log('[WorkerParity] Importmap injected');

        console.log('[WorkerParity] before() hook complete');
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
        test('PDFService can be imported in browser', async test => {
            if (!page) return test.skip('Page not initialized');

            // Use relative path from the page's context
            const result = await page.evaluate(async () => {
                try {
                    const { PDFService } = await import('../services/PDFService.js');
                    return {
                        success: true,
                        hasAttachManifest: typeof PDFService.attachManifestToPDFDocument === 'function',
                        hasExtractManifest: typeof PDFService.extractManifestFromPDFDocument === 'function',
                        hasExtractICCProfiles: typeof PDFService.extractICCProfilesFromPDFDocument === 'function',
                        hasSetOutputIntent: typeof PDFService.setOutputIntentForPDFDocument === 'function',
                        hasEmbedSlugs: typeof PDFService.embedSlugsIntoPDFDocument === 'function',
                        hasDecalibrate: typeof PDFService.decalibrateColorInPDFDocument === 'function',
                        hasDumpInfo: typeof PDFService.dumpPDFDocumentInfo === 'function',
                    };
                } catch (error) {
                    return { success: false, error: String(error) };
                }
            });

            assert.strictEqual(result.success, true, `Module import failed: ${result.error}`);
            assert.strictEqual(result.hasAttachManifest, true, 'attachManifestToPDFDocument should be a function');
            assert.strictEqual(result.hasExtractManifest, true, 'extractManifestFromPDFDocument should be a function');
            assert.strictEqual(result.hasExtractICCProfiles, true, 'extractICCProfilesFromPDFDocument should be a function');
            assert.strictEqual(result.hasSetOutputIntent, true, 'setOutputIntentForPDFDocument should be a function');
            assert.strictEqual(result.hasEmbedSlugs, true, 'embedSlugsIntoPDFDocument should be a function');
            assert.strictEqual(result.hasDecalibrate, true, 'decalibrateColorInPDFDocument should be a function');
            assert.strictEqual(result.hasDumpInfo, true, 'dumpPDFDocumentInfo should be a function');
        });

        test('pdf-lib can be imported via importmap', async test => {
            if (!page) return test.skip('Page not initialized');

            const result = await page.evaluate(async () => {
                try {
                    const pdfLib = await import('pdf-lib');
                    return {
                        success: true,
                        hasPDFDocument: typeof pdfLib.PDFDocument !== 'undefined',
                    };
                } catch (error) {
                    return { success: false, error: String(error) };
                }
            });

            assert.strictEqual(result.success, true, `pdf-lib import failed: ${result.error}`);
            assert.strictEqual(result.hasPDFDocument, true, 'PDFDocument should be available');
        });
    });

    describe('Type Sizes and Lissajou (Fast Unit Tests)', () => {
        test('eciCMYK v2 (K-Only GCR): Main vs Worker parity', async test => {
            console.log('[WorkerParity] Test starting: eciCMYK v2 (K-Only GCR)');
            if (!page) return test.skip('Page not initialized');

            console.log('[WorkerParity] Page is initialized, starting test...');

            const result = await page.evaluate(async () => {
                try {
                    console.log('[DEBUG] Loading pdf-lib and PDFService...');
                    const { PDFDocument } = await import('pdf-lib');
                    const { PDFService } = await import('../services/PDFService.js');

                    // Load test PDF
                    console.log('[DEBUG] Fetching test PDF...');
                    const pdfResponse = await fetch('./fixtures/pdfs/2025-08-15 - ConRes - ISO PTF - CR1 (F9d) Fixtures - F-01.pdf');
                    console.log(`[DEBUG] PDF response status: ${pdfResponse.status}`);
                    const pdfBytes = await pdfResponse.arrayBuffer();
                    console.log(`[DEBUG] PDF loaded: ${pdfBytes.byteLength} bytes`);

                    // Load eciCMYK v2 profile
                    console.log('[DEBUG] Fetching ICC profile...');
                    const profileResponse = await fetch('./fixtures/profiles/eciCMYK v2.icc');
                    const profileBuffer = await profileResponse.arrayBuffer();
                    console.log(`[DEBUG] Profile loaded: ${profileBuffer.byteLength} bytes`);

                    // Main thread conversion
                    console.log('[DEBUG] Starting main thread conversion...');
                    const mainDoc = await PDFDocument.load(pdfBytes);

                    // Worker thread conversion
                    console.log('[DEBUG] Starting worker thread conversion...');
                    const workerDoc = await PDFDocument.load(pdfBytes);

                    // PATTERN: Helper function for consistent conversion + logging + error handling
                    // - Wraps PDFService.convertColorInPDFDocument with context-aware logging
                    // - Returns saved PDF bytes (not the document)
                    // - Preserves error cause chain for debugging
                    /**
                     * @param {string} context
                     * @param {import('pdf-lib').PDFDocument} document
                     * @param {Parameters<PDFService['convertColorInPDFDocument']>[1]} options
                     */
                    const convertColorInPDFDocument = async (context, document, options) => {
                        try {
                            await PDFService.convertColorInPDFDocument(document, options);
                            console.log(`[DEBUG] ${context} conversion complete`);
                            const pdfBytes = await document.save();
                            console.log(`[DEBUG] ${context} PDF saved: ${pdfBytes.byteLength} bytes`);
                            return pdfBytes;
                        } catch (error) {
                            throw new Error(`${context} conversion failed: ${error}`, { cause: error });
                        }
                    };

                    const renderingIntent = 'k-only';

                    // PATTERN: Parallel execution with Promise.allSettled
                    // - Both conversions run concurrently (main + worker)
                    // - Promise.allSettled ensures both complete before checking results
                    // - Awaiting the original promises after allSettled gets results or throws
                    const convertColorInPDFDocumentPromises = {
                        main: convertColorInPDFDocument('Main thread', mainDoc, {
                            destinationProfile: profileBuffer,
                            renderingIntent,
                            useWorkers: false,
                            verbose: false,
                        }),
                        worker: convertColorInPDFDocument('Worker thread', workerDoc, {
                            destinationProfile: profileBuffer,
                            renderingIntent,
                            useWorkers: true,
                            verbose: false,
                        }),
                    };

                    await Promise.allSettled([
                        convertColorInPDFDocumentPromises.main,
                        convertColorInPDFDocumentPromises.worker,
                    ]);

                    const mainPDF = await convertColorInPDFDocumentPromises.main;
                    const workerPDF = await convertColorInPDFDocumentPromises.worker;

                    // PATTERN: Return sizes only (not full PDF arrays)
                    // - Avoids memory issues with large PDFs
                    // - Avoids serialization overhead for page.evaluate()
                    // - Size comparison is sufficient for parity verification
                    return {
                        success: true,
                        sizeMain: mainPDF.length,
                        sizeWorker: workerPDF.length,
                    };
                } catch (error) {
                    console.error('[DEBUG] Error:', error);
                    return { success: false, error: String(error), stack: error?.stack };
                }
            });

            console.log('  [DEBUG] Browser evaluation complete');
            assert.strictEqual(result.success, true, `Conversion failed: ${result.error}`);

            // const mainPDF = new Uint8Array(result.mainPDF);
            // const workerPDF = new Uint8Array(result.workerPDF);
            // const { sizeMain, sizeWorker, diffPercent } = comparePDFSizes(mainPDF, workerPDF);

            const { sizeMain, sizeWorker } = /** @type {{sizeMain: number, sizeWorker: number}} */ (result);
            const sizeMainWorkerPercentDifference = Math.abs(sizeMain - sizeWorker) / sizeMain * 100;

            console.log(`  Main thread: ${sizeMain.toLocaleString()} bytes`);
            console.log(`  Worker thread: ${sizeWorker.toLocaleString()} bytes`);
            console.log(`  Difference: ${sizeMainWorkerPercentDifference.toFixed(2)}%`);

            assert.ok(
                sizeMainWorkerPercentDifference < SIZE_TOLERANCE_PERCENT,
                `PDF size difference ${sizeMainWorkerPercentDifference.toFixed(2)}% exceeds tolerance ${SIZE_TOLERANCE_PERCENT}%`
            );
        });

        test('FIPS RGB (Relative Colorimetric): Main vs Worker parity', async test => {
            console.log('[WorkerParity] Test starting: FIPS RGB (Relative Colorimetric)');
            if (!page) return test.skip('Page not initialized');

            console.log('[WorkerParity] Page is initialized, starting test...');

            const result = await page.evaluate(async () => {
                try {
                    console.log('[DEBUG] Loading pdf-lib and PDFService...');
                    const { PDFDocument } = await import('pdf-lib');
                    const { PDFService } = await import('../services/PDFService.js');

                    // Load test PDF
                    console.log('[DEBUG] Fetching test PDF...');
                    const pdfResponse = await fetch('./fixtures/pdfs/2025-08-15 - ConRes - ISO PTF - CR1 (F9d) Fixtures - F-01.pdf');
                    console.log(`[DEBUG] PDF response status: ${pdfResponse.status}`);
                    const pdfBytes = await pdfResponse.arrayBuffer();
                    console.log(`[DEBUG] PDF loaded: ${pdfBytes.byteLength} bytes`);

                    // Load FIPS RGB profile
                    console.log('[DEBUG] Fetching ICC profile...');
                    const profileResponse = await fetch('./fixtures/profiles/FIPS_WIDE_28T-TYPEavg.icc');
                    const profileBuffer = await profileResponse.arrayBuffer();
                    console.log(`[DEBUG] Profile loaded: ${profileBuffer.byteLength} bytes`);

                    // Main thread conversion
                    console.log('[DEBUG] Starting main thread conversion...');
                    const mainDoc = await PDFDocument.load(pdfBytes);

                    // Worker thread conversion
                    console.log('[DEBUG] Starting worker thread conversion...');
                    const workerDoc = await PDFDocument.load(pdfBytes);

                    // PATTERN: Helper function (same as eciCMYK test above)
                    /**
                     * @param {string} context
                     * @param {import('pdf-lib').PDFDocument} document
                     * @param {Parameters<PDFService['convertColorInPDFDocument']>[1]} options
                     */
                    const convertColorInPDFDocument = async (context, document, options) => {
                        try {
                            await PDFService.convertColorInPDFDocument(document, options);
                            console.log(`[DEBUG] ${context} conversion complete`);
                            const pdfBytes = await document.save();
                            console.log(`[DEBUG] ${context} PDF saved: ${pdfBytes.byteLength} bytes`);
                            return pdfBytes;
                        } catch (error) {
                            throw new Error(`${context} conversion failed: ${error}`, { cause: error });
                        }
                    };

                    const renderingIntent = 'relative-colorimetric';

                    // PATTERN: Parallel execution (same as eciCMYK test above)
                    const convertColorInPDFDocumentPromises = {
                        main: convertColorInPDFDocument('Main thread', mainDoc, {
                            destinationProfile: profileBuffer,
                            renderingIntent,
                            useWorkers: false,
                            verbose: false,
                        }),
                        worker: convertColorInPDFDocument('Worker thread', workerDoc, {
                            destinationProfile: profileBuffer,
                            renderingIntent,
                            useWorkers: true,
                            verbose: false,
                        }),
                    };

                    await Promise.allSettled([
                        convertColorInPDFDocumentPromises.main,
                        convertColorInPDFDocumentPromises.worker,
                    ]);

                    const mainPDF = await convertColorInPDFDocumentPromises.main;
                    const workerPDF = await convertColorInPDFDocumentPromises.worker;

                    // PATTERN: Return sizes only (same as eciCMYK test above)
                    return {
                        success: true,
                        sizeMain: mainPDF.length,
                        sizeWorker: workerPDF.length,
                    };
                } catch (error) {
                    console.error('[DEBUG] Error:', error);
                    return { success: false, error: String(error), stack: error?.stack };
                }
            });

            console.log('  [DEBUG] Browser evaluation complete');
            assert.strictEqual(result.success, true, `Conversion failed: ${result.error}`);

            const { sizeMain, sizeWorker } = /** @type {{sizeMain: number, sizeWorker: number}} */ (result);
            const sizeMainWorkerPercentDifference = Math.abs(sizeMain - sizeWorker) / sizeMain * 100;

            // const mainPDF = new Uint8Array(result.mainPDF);
            // const workerPDF = new Uint8Array(result.workerPDF);
            // const { sizeMain, sizeWorker, diffPercent } = comparePDFSizes(mainPDF, workerPDF);

            console.log(`  Main thread: ${sizeMain.toLocaleString()} bytes`);
            console.log(`  Worker thread: ${sizeWorker.toLocaleString()} bytes`);
            console.log(`  Difference: ${sizeMainWorkerPercentDifference.toFixed(2)}%`);

            assert.ok(
                sizeMainWorkerPercentDifference < SIZE_TOLERANCE_PERCENT,
                `PDF size difference ${sizeMainWorkerPercentDifference.toFixed(2)}% exceeds tolerance ${SIZE_TOLERANCE_PERCENT}%`
            );
        });
    });

    // NOTE: Large PDF parity tests (Interlaken Map 114MB) are verified via
    // benchmark comparisons (folders 024 vs 021, 025 vs 022) rather than
    // browser-based unit tests to avoid timeouts and memory issues.
    // See: testing/iso/ptf/2025/experiments/output/2026-01-08-024-comparison.log
    //      testing/iso/ptf/2025/experiments/output/2026-01-08-025-comparison.log
});
