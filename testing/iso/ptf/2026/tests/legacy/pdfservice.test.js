// @ts-check
/**
 * Tests for PDFService using Playwright + node:test
 * 
 * These tests run in a browser context via Playwright to ensure
 * PDF manipulation and color engine operations work correctly.
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

    // Inject the transformed importmap
    await page.addScriptTag({ type: 'importmap', content: JSON.stringify(importmap) });
}

describe('PDFService', () => {
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

    describe('ICCService', () => {
        test('ICCService can be imported in browser', async test => {
            if (!page) return test.skip('Page not initialized');

            const result = await page.evaluate(async () => {
                try {
                    const { ICCService } = await import('../services/ICCService.js');
                    return {
                        success: true,
                        hasParseHeader: typeof ICCService.parseICCHeaderFromSource === 'function',
                    };
                } catch (error) {
                    return { success: false, error: String(error) };
                }
            });

            assert.strictEqual(result.success, true, `ICCService import failed: ${result.error}`);
            assert.strictEqual(result.hasParseHeader, true, 'parseICCHeaderFromSource should be a function');
        });
    });

    describe('PDF Document Operations', () => {
        test('can create and load a simple PDF document', async test => {
            if (!page) return test.skip('Page not initialized');

            const result = await page.evaluate(async () => {
                try {
                    const { PDFDocument } = await import('pdf-lib');
                    
                    // Create a simple PDF
                    const pdfDoc = await PDFDocument.create();
                    const page = pdfDoc.addPage([612, 792]); // Letter size
                    page.drawText('Test Document', { x: 50, y: 700, size: 30 });
                    
                    const pdfBytes = await pdfDoc.save();
                    
                    // Reload it
                    const loadedDoc = await PDFDocument.load(pdfBytes);
                    
                    return {
                        success: true,
                        pageCount: loadedDoc.getPageCount(),
                        bytesLength: pdfBytes.length,
                    };
                } catch (error) {
                    return { success: false, error: String(error) };
                }
            });

            assert.strictEqual(result.success, true, `PDF creation failed: ${result.error}`);
            assert.strictEqual(result.pageCount, 1, 'PDF should have 1 page');
            assert.ok(result.bytesLength > 0, 'PDF should have content');
        });

        test('can attach and extract manifest from PDF', async test => {
            if (!page) return test.skip('Page not initialized');

            const result = await page.evaluate(async () => {
                try {
                    const { PDFDocument } = await import('pdf-lib');
                    const { PDFService } = await import('../services/PDFService.js');
                    
                    // Create a simple PDF
                    const pdfDoc = await PDFDocument.create();
                    pdfDoc.addPage([612, 792]);
                    
                    // Create manifest
                    const manifest = {
                        version: '1.0.0',
                        timestamp: new Date().toISOString(),
                        testKey: 'testValue',
                    };
                    const manifestBuffer = new TextEncoder().encode(JSON.stringify(manifest));
                    
                    // Attach manifest
                    await PDFService.attachManifestToPDFDocument(pdfDoc, manifestBuffer, 'test-manifest.json');

                    // Save and reload
                    const pdfBytes = await pdfDoc.save();
                    const reloadedDoc = await PDFDocument.load(pdfBytes);

                    // Extract manifest
                    const extracted = PDFService.extractManifestFromPDFDocument(reloadedDoc, 'test-manifest.json');
                    
                    return {
                        success: true,
                        hasExtracted: extracted !== null,
                        extractedVersion: extracted?.json?.version,
                        extractedTestKey: extracted?.json?.testKey,
                    };
                } catch (error) {
                    return { success: false, error: String(error), stack: error?.stack };
                }
            });

            assert.strictEqual(result.success, true, `Manifest operation failed: ${result.error}`);
            assert.strictEqual(result.hasExtracted, true, 'Should extract manifest');
            assert.strictEqual(result.extractedVersion, '1.0.0', 'Manifest version should match');
            assert.strictEqual(result.extractedTestKey, 'testValue', 'Manifest testKey should match');
        });
    });

    describe('Color Space Analysis', () => {
        test('dumpPDFInfo returns document structure', async test => {
            if (!page) return test.skip('Page not initialized');

            const result = await page.evaluate(async () => {
                try {
                    const { PDFDocument, rgb } = await import('pdf-lib');
                    const { PDFService } = await import('../services/PDFService.js');
                    
                    // Create a PDF with some content
                    const pdfDoc = await PDFDocument.create();
                    const page = pdfDoc.addPage([612, 792]);
                    page.drawText('Test', { x: 50, y: 700, size: 30 });
                    // Use rgb() helper from pdf-lib to create color properly
                    page.drawRectangle({ x: 50, y: 600, width: 100, height: 50, color: rgb(1, 0, 0) });
                    
                    const info = await PDFService.dumpPDFDocumentInfo(pdfDoc);
                    
                    return {
                        success: true,
                        hasNames: 'names' in info,
                        hasResources: 'resources' in info,
                        hasStreams: 'streams' in info,
                        hasObjects: 'objects' in info,
                    };
                } catch (error) {
                    return { success: false, error: String(error) };
                }
            });

            assert.strictEqual(result.success, true, `dumpPDFInfo failed: ${result.error}`);
            assert.strictEqual(result.hasNames, true, 'Info should have names');
            assert.strictEqual(result.hasResources, true, 'Info should have resources');
            assert.strictEqual(result.hasStreams, true, 'Info should have streams');
            assert.strictEqual(result.hasObjects, true, 'Info should have objects');
        });
    });

    describe('convertColorInPDFDocument', () => {
        test('converts content stream colors from test PDF', async test => {
            if (!page) return test.skip('Page not initialized');

            const result = await page.evaluate(async () => {
                try {
                    const { PDFDocument } = await import('pdf-lib');
                    const { PDFService } = await import('../services/PDFService.js');

                    // Load test PDF with color content
                    const pdfResponse = await fetch('./fixtures/pdfs/2025-08-15 - ConRes - ISO PTF - CR1 - Type Sizes and Lissajou.pdf');
                    const pdfBytes = await pdfResponse.arrayBuffer();
                    const pdfDoc = await PDFDocument.load(pdfBytes);

                    // Load eciCMYK v2 profile (path relative to tests/)
                    const profileResponse = await fetch('./fixtures/profiles/eciCMYK v2.icc');
                    const profileBuffer = await profileResponse.arrayBuffer();

                    // Convert colors
                    const stats = await PDFService.convertColorInPDFDocument(pdfDoc, {
                        destinationProfile: profileBuffer,
                        renderingIntent: 'relative-colorimetric',
                        convertImages: false, // Only test content streams
                        convertContentStreams: true,
                        useWorkers: false,
                        verbose: false,
                    });

                    return {
                        success: true,
                        totalContentStreamConversions: stats.totalContentStreamConversions,
                        hasConversions: stats.totalContentStreamConversions > 0,
                    };
                } catch (error) {
                    return { success: false, error: String(error), stack: error?.stack };
                }
            });

            assert.strictEqual(result.success, true, `Color conversion failed: ${result.error}`);
            assert.ok(result.hasConversions, 'Should have content stream conversions');
            assert.ok(result.totalContentStreamConversions > 0, `Expected conversions, got ${result.totalContentStreamConversions}`);
        });

        test('returns stats with zero conversions when options disable conversion', async test => {
            if (!page) return test.skip('Page not initialized');

            const result = await page.evaluate(async () => {
                try {
                    const { PDFDocument, rgb } = await import('pdf-lib');
                    const { PDFService } = await import('../services/PDFService.js');

                    const pdfDoc = await PDFDocument.create();
                    const page = pdfDoc.addPage([612, 792]);
                    page.drawRectangle({ x: 50, y: 700, width: 100, height: 50, color: rgb(1, 0, 0) });

                    const profileResponse = await fetch('./fixtures/profiles/eciCMYK v2.icc');
                    const profileBuffer = await profileResponse.arrayBuffer();

                    // Disable all conversions
                    const stats = await PDFService.convertColorInPDFDocument(pdfDoc, {
                        destinationProfile: profileBuffer,
                        renderingIntent: 'relative-colorimetric',
                        convertImages: false,
                        convertContentStreams: false, // Disabled
                        useWorkers: false,
                    });

                    return {
                        success: true,
                        totalContentStreamConversions: stats.totalContentStreamConversions,
                        totalImageConversions: stats.totalImageConversions,
                    };
                } catch (error) {
                    return { success: false, error: String(error) };
                }
            });

            assert.strictEqual(result.success, true, `Test failed: ${result.error}`);
            assert.strictEqual(result.totalContentStreamConversions, 0, 'Should have zero content stream conversions');
            assert.strictEqual(result.totalImageConversions, 0, 'Should have zero image conversions');
        });

        test('throws error when destinationProfile is missing', async test => {
            if (!page) return test.skip('Page not initialized');

            const result = await page.evaluate(async () => {
                try {
                    const { PDFDocument } = await import('pdf-lib');
                    const { PDFService } = await import('../services/PDFService.js');

                    const pdfDoc = await PDFDocument.create();
                    pdfDoc.addPage([612, 792]);

                    // Try to convert without destinationProfile
                    await PDFService.convertColorInPDFDocument(pdfDoc, {
                        renderingIntent: 'relative-colorimetric',
                    });

                    return { success: true, shouldNotReachHere: true };
                } catch (error) {
                    return {
                        success: true,
                        threwError: true,
                        errorMessage: String(error),
                        isExpectedError: error.message.includes('destinationProfile is required'),
                    };
                }
            });

            assert.strictEqual(result.success, true);
            assert.strictEqual(result.threwError, true, 'Should throw error');
            assert.strictEqual(result.isExpectedError, true, 'Error message should mention destinationProfile');
        });

        test('respects useWorkers=false option', async test => {
            if (!page) return test.skip('Page not initialized');

            const result = await page.evaluate(async () => {
                try {
                    const { PDFDocument } = await import('pdf-lib');
                    const { PDFService } = await import('../services/PDFService.js');

                    // Load test PDF with color content
                    const pdfResponse = await fetch('./fixtures/pdfs/2025-08-15 - ConRes - ISO PTF - CR1 - Type Sizes and Lissajou.pdf');
                    const pdfBytes = await pdfResponse.arrayBuffer();
                    const pdfDoc = await PDFDocument.load(pdfBytes);

                    const profileResponse = await fetch('./fixtures/profiles/eciCMYK v2.icc');
                    const profileBuffer = await profileResponse.arrayBuffer();

                    // Explicitly set useWorkers=false (main thread)
                    const stats = await PDFService.convertColorInPDFDocument(pdfDoc, {
                        destinationProfile: profileBuffer,
                        renderingIntent: 'relative-colorimetric',
                        convertImages: false,
                        convertContentStreams: true,
                        useWorkers: false, // Main thread
                        verbose: false,
                    });

                    return {
                        success: true,
                        hasConversions: stats.totalContentStreamConversions > 0,
                    };
                } catch (error) {
                    return { success: false, error: String(error) };
                }
            });

            assert.strictEqual(result.success, true, `Test failed: ${result.error}`);
            assert.ok(result.hasConversions, 'Should convert colors on main thread');
        });
    });
});

describe('helpers', () => {
    before(async () => {
        // Create fresh browser instance for helpers tests
        browser = await chromium.launch({ headless: true });
        context = await browser.newContext();
        page = await context.newPage();
        await page.goto(`${BASE_URL}/testing/iso/ptf/2025/tests/index.html`);
        await injectImportmap(page);
    });

    after(async () => {
        await context?.close();
        await browser?.close();
    });

    test('Buffer class works correctly', async test => {
        if (!page) return test.skip('Page not initialized');

        const result = await page.evaluate(async () => {
            try {
                const { Buffer } = await import('../helpers.js');
                
                // Test buffer creation and reading
                const data = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07]);
                const buffer = new Buffer(data);
                
                return {
                    success: true,
                    readInt32BE: buffer.readInt32BE(0),
                    readInt16BE: buffer.readInt16BE(0),
                    readUInt8: buffer.readUInt8(0),
                };
            } catch (error) {
                return { success: false, error: String(error) };
            }
        });

        assert.strictEqual(result.success, true, `Buffer test failed: ${result.error}`);
        assert.strictEqual(result.readInt32BE, 0x00010203, 'readInt32BE should work');
        assert.strictEqual(result.readInt16BE, 0x0001, 'readInt16BE should work');
        assert.strictEqual(result.readUInt8, 0x00, 'readUInt8 should work');
    });

    test('PromiseWithResolvers works correctly', async test => {
        if (!page) return test.skip('Page not initialized');

        const result = await page.evaluate(async () => {
            try {
                const { PromiseWithResolvers } = await import('../helpers.js');
                
                const { promise, resolve } = PromiseWithResolvers();
                
                setTimeout(() => resolve('test-value'), 10);
                
                const value = await promise;
                
                return {
                    success: true,
                    value,
                };
            } catch (error) {
                return { success: false, error: String(error) };
            }
        });

        assert.strictEqual(result.success, true, `PromiseWithResolvers test failed: ${result.error}`);
        assert.strictEqual(result.value, 'test-value', 'Promise should resolve with correct value');
    });
});
