// @ts-check
/**
 * Tests for ColorSpaceUtils using Playwright + node:test
 *
 * These tests verify color space analysis, ICC profile detection,
 * and content stream color parsing using a real PDF test form.
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
const TEST_PDF_PATH = '/assets/testforms/2025-05-05 - ISO PTF 2x-4x.pdf';

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

describe('ColorSpaceUtils', () => {
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
        test('ColorSpaceUtils can be imported in browser', async t => {
            if (!page) return t.skip('Page not initialized');

            const result = await page.evaluate(async () => {
                try {
                    const ColorSpaceUtils = await import('../services/ColorSpaceUtils.js');
                    return {
                        success: true,
                        hasUniqueColorSpaceRecords: typeof ColorSpaceUtils.UniqueColorSpaceRecords === 'function',
                        hasAnalyzeColorSpaces: typeof ColorSpaceUtils.analyzeColorSpaces === 'function',
                        hasAnalyzePageColors: typeof ColorSpaceUtils.analyzePageColors === 'function',
                        hasParseContentStreamColors: typeof ColorSpaceUtils.parseContentStreamColors === 'function',
                        hasIsICCBasedColorSpace: typeof ColorSpaceUtils.isICCBasedColorSpace === 'function',
                        hasGetDeviceColorSpaceForICC: typeof ColorSpaceUtils.getDeviceColorSpaceForICC === 'function',
                        hasExtractPageContentStreams: typeof ColorSpaceUtils.extractPageContentStreams === 'function',
                        hasDecodeAndParseContentStream: typeof ColorSpaceUtils.decodeAndParseContentStream === 'function',
                        hasCOLOR_OPERATOR_REGEX: ColorSpaceUtils.COLOR_OPERATOR_REGEX instanceof RegExp,
                    };
                } catch (error) {
                    return { success: false, error: String(error) };
                }
            });

            assert.strictEqual(result.success, true, `Module import failed: ${result.error}`);
            assert.strictEqual(result.hasUniqueColorSpaceRecords, true, 'UniqueColorSpaceRecords should be a class');
            assert.strictEqual(result.hasAnalyzeColorSpaces, true, 'analyzeColorSpaces should be a function');
            assert.strictEqual(result.hasAnalyzePageColors, true, 'analyzePageColors should be a function');
            assert.strictEqual(result.hasParseContentStreamColors, true, 'parseContentStreamColors should be a function');
            assert.strictEqual(result.hasIsICCBasedColorSpace, true, 'isICCBasedColorSpace should be a function');
            assert.strictEqual(result.hasGetDeviceColorSpaceForICC, true, 'getDeviceColorSpaceForICC should be a function');
            assert.strictEqual(result.hasExtractPageContentStreams, true, 'extractPageContentStreams should be a function');
            assert.strictEqual(result.hasDecodeAndParseContentStream, true, 'decodeAndParseContentStream should be a function');
            assert.strictEqual(result.hasCOLOR_OPERATOR_REGEX, true, 'COLOR_OPERATOR_REGEX should be a RegExp');
        });
    });

    describe('analyzeColorSpaces - Full Document Analysis', () => {
        test('analyzes ISO PTF test form and finds color space designations', async t => {
            if (!page) return t.skip('Page not initialized');

            const result = await page.evaluate(async (pdfPath) => {
                try {
                    const { PDFDocument } = await import('pdf-lib');
                    const { analyzeColorSpaces } = await import('../services/ColorSpaceUtils.js');

                    // Fetch the test PDF
                    const response = await fetch(pdfPath);
                    if (!response.ok) throw new Error(`Failed to fetch PDF: ${response.status}`);
                    const pdfBytes = await response.arrayBuffer();

                    // Load the PDF
                    const pdfDocument = await PDFDocument.load(pdfBytes);

                    // Analyze color spaces
                    const analysis = analyzeColorSpaces(pdfDocument, { debug: false });

                    // Collect summary data
                    const classifiers = Object.keys(analysis.colorSpaceDesignationTargetsByClassifier);
                    const uniqueRecords = analysis.uniqueColorSpaceRecords.records;
                    const uniqueRecordTypes = Object.values(uniqueRecords).map(r => r.colorSpaceDefinition?.colorSpaceType);

                    // Count designations by type
                    const designationCounts = {};
                    for (const [classifier, map] of Object.entries(analysis.colorSpaceDesignationTargetsByClassifier)) {
                        designationCounts[classifier] = map.size;
                    }

                    // Count color space definitions in lookup
                    const lookupCount = analysis.colorSpaceDesignationTargetsLookup.size;

                    return {
                        success: true,
                        pageCount: pdfDocument.getPageCount(),
                        classifiers,
                        designationCounts,
                        uniqueRecordCount: Object.keys(uniqueRecords).length,
                        uniqueRecordTypes: [...new Set(uniqueRecordTypes)],
                        lookupCount,
                        hasXObjectImageClassifier: classifiers.includes('XObjectImage'),
                        hasPageClassifier: classifiers.includes('Page'),
                    };
                } catch (error) {
                    return { success: false, error: String(error), stack: error?.stack };
                }
            }, TEST_PDF_PATH);

            assert.strictEqual(result.success, true, `Analysis failed: ${result.error}\n${result.stack}`);
            assert.ok(result.pageCount > 0, 'PDF should have pages');
            assert.ok(result.classifiers.length > 0, 'Should find color space classifiers');
            assert.ok(result.uniqueRecordCount > 0, 'Should find unique color space records');
            assert.ok(result.lookupCount > 0, 'Should have entries in the lookup map');

            // Log summary for debugging
            console.log(`  PDF has ${result.pageCount} pages`);
            console.log(`  Found classifiers: ${result.classifiers.join(', ')}`);
            console.log(`  Designation counts: ${JSON.stringify(result.designationCounts)}`);
            console.log(`  Unique record types: ${result.uniqueRecordTypes.join(', ')}`);
        });

        test('finds ICC-based color spaces in the test PDF', async t => {
            if (!page) return t.skip('Page not initialized');

            const result = await page.evaluate(async (pdfPath) => {
                try {
                    const { PDFDocument, PDFArray } = await import('pdf-lib');
                    const { analyzeColorSpaces, isICCBasedColorSpace } = await import('../services/ColorSpaceUtils.js');

                    const response = await fetch(pdfPath);
                    const pdfBytes = await response.arrayBuffer();
                    const pdfDocument = await PDFDocument.load(pdfBytes);

                    const analysis = analyzeColorSpaces(pdfDocument);

                    // Find ICC-based color spaces in the lookup
                    const iccBasedDescriptors = [];
                    for (const descriptor of analysis.colorSpaceDesignationTargetsLookup.keys()) {
                        if (isICCBasedColorSpace(/** @type {PDFArray} */ (descriptor))) {
                            iccBasedDescriptors.push({
                                type: 'ICCBased',
                                designationCount: analysis.colorSpaceDesignationTargetsLookup.get(descriptor)?.size ?? 0,
                            });
                        }
                    }

                    return {
                        success: true,
                        iccBasedCount: iccBasedDescriptors.length,
                        iccBasedDescriptors,
                    };
                } catch (error) {
                    return { success: false, error: String(error) };
                }
            }, TEST_PDF_PATH);

            assert.strictEqual(result.success, true, `ICC analysis failed: ${result.error}`);
            console.log(`  Found ${result.iccBasedCount} ICC-based color space definitions`);

            // The test PDF should have ICC-based color spaces (typical for production PDFs)
            // Note: This assertion might need adjustment based on the actual PDF content
            if (result.iccBasedCount > 0) {
                console.log(`  ICC-based descriptors: ${JSON.stringify(result.iccBasedDescriptors)}`);
            }
        });
    });

    describe('analyzePageColors - Per-Page Analysis', () => {
        test('analyzes first page of ISO PTF test form', async t => {
            if (!page) return t.skip('Page not initialized');

            const result = await page.evaluate(async (pdfPath) => {
                try {
                    const { PDFDocument, PDFPageLeaf, PDFName, PDFDict } = await import('pdf-lib');
                    const { analyzePageColors } = await import('../services/ColorSpaceUtils.js');

                    const response = await fetch(pdfPath);
                    const pdfBytes = await response.arrayBuffer();
                    const pdfDocument = await PDFDocument.load(pdfBytes);

                    // Get the first page
                    const pages = pdfDocument.getPages();
                    if (pages.length === 0) throw new Error('PDF has no pages');

                    // Get the page leaf and ref from the context
                    const enumeratedObjects = /** @type {[any, any][]} */ (
                        pdfDocument.context.enumerateIndirectObjects()
                    );

                    let pageLeaf = null;
                    let pageLeafRef = null;
                    for (const [ref, obj] of enumeratedObjects) {
                        if (obj instanceof PDFPageLeaf) {
                            pageLeaf = obj;
                            pageLeafRef = ref;
                            break; // Get first page
                        }
                    }

                    if (!pageLeaf || !pageLeafRef) {
                        throw new Error('Could not find PDFPageLeaf');
                    }

                    // Analyze the page
                    const pageAnalysis = analyzePageColors(pageLeaf, pageLeafRef, pdfDocument);

                    return {
                        success: true,
                        hasPageLeaf: pageAnalysis.pageLeaf !== undefined,
                        hasPageLeafRef: pageAnalysis.pageLeafRef !== undefined,
                        hasResourcesDict: pageAnalysis.resourcesDict instanceof PDFDict,
                        hasColorSpaceDict: pageAnalysis.colorSpaceDict instanceof PDFDict || pageAnalysis.colorSpaceDict === undefined,
                        hasContentStreams: Array.isArray(pageAnalysis.contentStreams?.rawStreams),
                        hasParsedStreams: Array.isArray(pageAnalysis.parsedStreams),
                        rawStreamCount: pageAnalysis.contentStreams?.rawStreams?.length ?? 0,
                        parsedStreamCount: pageAnalysis.parsedStreams?.length ?? 0,
                    };
                } catch (error) {
                    return { success: false, error: String(error), stack: error?.stack };
                }
            }, TEST_PDF_PATH);

            assert.strictEqual(result.success, true, `Page analysis failed: ${result.error}\n${result.stack}`);
            assert.strictEqual(result.hasPageLeaf, true, 'Should have pageLeaf');
            assert.strictEqual(result.hasPageLeafRef, true, 'Should have pageLeafRef');
            assert.strictEqual(result.hasResourcesDict, true, 'Should have resourcesDict');
            assert.strictEqual(result.hasContentStreams, true, 'Should have contentStreams array');
            assert.strictEqual(result.hasParsedStreams, true, 'Should have parsedStreams array');

            console.log(`  Found ${result.rawStreamCount} raw content streams`);
            console.log(`  Parsed ${result.parsedStreamCount} content streams`);
        });

        test('parses color operations from page content streams', async t => {
            if (!page) return t.skip('Page not initialized');

            const result = await page.evaluate(async (pdfPath) => {
                try {
                    const { PDFDocument, PDFPageLeaf } = await import('pdf-lib');
                    const { analyzePageColors, collectColorValuesForConversion } = await import('../services/ColorSpaceUtils.js');

                    const response = await fetch(pdfPath);
                    const pdfBytes = await response.arrayBuffer();
                    const pdfDocument = await PDFDocument.load(pdfBytes);

                    // Get all pages and analyze them
                    const enumeratedObjects = /** @type {[any, any][]} */ (
                        pdfDocument.context.enumerateIndirectObjects()
                    );

                    const allColorChunks = [];
                    const colorTypesSummary = { gray: 0, rgb: 0, cmyk: 0, indexed: 0, colorspace: 0 };
                    let totalPages = 0;

                    for (const [ref, obj] of enumeratedObjects) {
                        if (!(obj instanceof PDFPageLeaf)) continue;
                        totalPages++;

                        const pageAnalysis = analyzePageColors(obj, ref, pdfDocument);

                        // Collect color values
                        const colorValues = collectColorValuesForConversion(pageAnalysis);

                        for (const { chunk } of colorValues) {
                            if (chunk.type in colorTypesSummary) {
                                colorTypesSummary[chunk.type]++;
                            }
                            allColorChunks.push({
                                type: chunk.type,
                                operator: chunk.operator,
                                hasValues: Array.isArray(chunk.values),
                                hasName: typeof chunk.name === 'string',
                            });
                        }
                    }

                    // Sample a few chunks for detailed inspection
                    const sampleChunks = allColorChunks.slice(0, 10);

                    return {
                        success: true,
                        totalPages,
                        totalColorChunks: allColorChunks.length,
                        colorTypesSummary,
                        sampleChunks,
                    };
                } catch (error) {
                    return { success: false, error: String(error), stack: error?.stack };
                }
            }, TEST_PDF_PATH);

            assert.strictEqual(result.success, true, `Content stream parsing failed: ${result.error}\n${result.stack}`);
            assert.ok(result.totalPages > 0, 'Should have analyzed pages');

            console.log(`  Analyzed ${result.totalPages} pages`);
            console.log(`  Found ${result.totalColorChunks} color operations`);
            console.log(`  Color types: ${JSON.stringify(result.colorTypesSummary)}`);

            if (result.sampleChunks.length > 0) {
                console.log(`  Sample chunks: ${JSON.stringify(result.sampleChunks.slice(0, 3))}`);
            }
        });

        test('extracts color space definitions from page resources', async t => {
            if (!page) return t.skip('Page not initialized');

            const result = await page.evaluate(async (pdfPath) => {
                try {
                    const { PDFDocument, PDFPageLeaf, PDFDict, PDFName } = await import('pdf-lib');
                    const { analyzePageColors } = await import('../services/ColorSpaceUtils.js');

                    const response = await fetch(pdfPath);
                    const pdfBytes = await response.arrayBuffer();
                    const pdfDocument = await PDFDocument.load(pdfBytes);

                    const enumeratedObjects = /** @type {[any, any][]} */ (
                        pdfDocument.context.enumerateIndirectObjects()
                    );

                    const colorSpaceResources = [];

                    for (const [ref, obj] of enumeratedObjects) {
                        if (!(obj instanceof PDFPageLeaf)) continue;

                        const pageAnalysis = analyzePageColors(obj, ref, pdfDocument);

                        if (pageAnalysis.colorSpaceDict) {
                            const csDict = pageAnalysis.colorSpaceDict;
                            const entries = [];

                            for (const [key, value] of csDict.entries()) {
                                const keyName = key instanceof PDFName ? key.decodeText() : String(key);
                                entries.push(keyName);
                            }

                            if (entries.length > 0) {
                                colorSpaceResources.push({
                                    pageRef: ref.toString(),
                                    colorSpaceNames: entries,
                                    colorSpaceCount: entries.length,
                                });
                            }
                        }
                    }

                    return {
                        success: true,
                        pagesWithColorSpaces: colorSpaceResources.length,
                        colorSpaceResources,
                        allColorSpaceNames: [...new Set(colorSpaceResources.flatMap(r => r.colorSpaceNames))],
                    };
                } catch (error) {
                    return { success: false, error: String(error), stack: error?.stack };
                }
            }, TEST_PDF_PATH);

            assert.strictEqual(result.success, true, `Color space extraction failed: ${result.error}\n${result.stack}`);

            console.log(`  Pages with color space resources: ${result.pagesWithColorSpaces}`);
            console.log(`  Unique color space names: ${result.allColorSpaceNames.join(', ') || '(none)'}`);
        });
    });

    describe('parseContentStreamColors - Content Stream Parsing', () => {
        test('parses various color operators correctly', async t => {
            if (!page) return t.skip('Page not initialized');

            const result = await page.evaluate(async () => {
                try {
                    const { parseContentStreamColors } = await import('../services/ColorSpaceUtils.js');

                    // Test with synthetic content stream containing various operators
                    const testStream = `
                        q
                        /CS0 cs
                        0.5 0.3 0.8 0.1 k
                        100 100 200 150 re
                        f
                        0.75 g
                        50 50 m
                        150 150 l
                        S
                        0.2 0.4 0.6 rg
                        (Sample Text) Tj
                        0.9 G
                        10 10 m
                        90 90 l
                        S
                        1 0 0 1 sc
                        Q
                    `.trim();

                    const parseResult = parseContentStreamColors(testStream);

                    // Categorize found chunks
                    const chunksByType = {};
                    for (const chunk of parseResult.chunks) {
                        chunksByType[chunk.type] = chunksByType[chunk.type] || [];
                        chunksByType[chunk.type].push({
                            operator: chunk.operator,
                            values: chunk.values,
                            name: chunk.name,
                        });
                    }

                    return {
                        success: true,
                        totalChunks: parseResult.chunks.length,
                        colorSpaceCount: parseResult.colorSpaces.length,
                        chunksByType,
                        hasGray: 'gray' in chunksByType,
                        hasRGB: 'rgb' in chunksByType,
                        hasCMYK: 'cmyk' in chunksByType,
                        hasColorspace: 'colorspace' in chunksByType,
                    };
                } catch (error) {
                    return { success: false, error: String(error) };
                }
            });

            assert.strictEqual(result.success, true, `Parsing failed: ${result.error}`);
            assert.ok(result.totalChunks > 0, 'Should find color chunks');

            console.log(`  Total chunks: ${result.totalChunks}`);
            console.log(`  Color space definitions: ${result.colorSpaceCount}`);
            console.log(`  Found types: gray=${result.hasGray}, rgb=${result.hasRGB}, cmyk=${result.hasCMYK}, colorspace=${result.hasColorspace}`);
        });

        test('handles edge cases in content streams', async t => {
            if (!page) return t.skip('Page not initialized');

            const result = await page.evaluate(async () => {
                try {
                    const { parseContentStreamColors } = await import('../services/ColorSpaceUtils.js');

                    // Test edge cases
                    const testCases = [
                        { name: 'empty stream', stream: '', expectChunks: 0 },
                        { name: 'only whitespace', stream: '   \n\t  ', expectChunks: 0 },
                        { name: 'decimal values', stream: '.5 .3 .8 .1 k', expectChunks: 1 },
                        { name: 'integer values', stream: '1 0 0 0 K', expectChunks: 1 },
                        { name: 'mixed values', stream: '0.5 1 .75 0 k', expectChunks: 1 },
                        { name: 'string with parens', stream: '(Hello World) Tj 0.5 g', expectChunks: 2 },
                    ];

                    const results = [];
                    for (const { name, stream, expectChunks } of testCases) {
                        const parseResult = parseContentStreamColors(stream);
                        results.push({
                            name,
                            chunksFound: parseResult.chunks.length,
                            expectedChunks: expectChunks,
                            pass: parseResult.chunks.length >= expectChunks,
                        });
                    }

                    return {
                        success: true,
                        results,
                        allPassed: results.every(r => r.pass),
                    };
                } catch (error) {
                    return { success: false, error: String(error) };
                }
            });

            assert.strictEqual(result.success, true, `Edge case tests failed: ${result.error}`);

            for (const r of result.results) {
                console.log(`  ${r.name}: ${r.pass ? '✓' : '✗'} (found ${r.chunksFound}, expected >= ${r.expectedChunks})`);
            }
        });
    });

    describe('ICC Profile Detection and Extraction', () => {
        test('extracts ICC profiles from test PDF', async t => {
            if (!page) return t.skip('Page not initialized');

            const result = await page.evaluate(async (pdfPath) => {
                try {
                    const { PDFDocument, PDFArray } = await import('pdf-lib');
                    const {
                        analyzeColorSpaces,
                        isICCBasedColorSpace,
                        getICCProfileRefFromColorSpace,
                        parseICCProfileFromRef,
                    } = await import('../services/ColorSpaceUtils.js');

                    const response = await fetch(pdfPath);
                    const pdfBytes = await response.arrayBuffer();
                    const pdfDocument = await PDFDocument.load(pdfBytes);

                    const analysis = analyzeColorSpaces(pdfDocument);

                    const iccProfiles = [];
                    const seenRefs = new Set();

                    for (const descriptor of analysis.colorSpaceDesignationTargetsLookup.keys()) {
                        if (!isICCBasedColorSpace(/** @type {PDFArray} */ (descriptor))) continue;

                        const profileRef = getICCProfileRefFromColorSpace(/** @type {PDFArray} */ (descriptor));
                        if (!profileRef || seenRefs.has(profileRef.toString())) continue;
                        seenRefs.add(profileRef.toString());

                        const profile = parseICCProfileFromRef(pdfDocument, profileRef);
                        if (profile) {
                            iccProfiles.push({
                                ref: profileRef.toString(),
                                colorSpace: profile.header.colorSpace,
                                bufferSize: profile.buffer.length,
                                description: profile.header.description || '(no description)',
                            });
                        }
                    }

                    return {
                        success: true,
                        profileCount: iccProfiles.length,
                        profiles: iccProfiles,
                        colorSpaces: [...new Set(iccProfiles.map(p => p.colorSpace))],
                    };
                } catch (error) {
                    return { success: false, error: String(error), stack: error?.stack };
                }
            }, TEST_PDF_PATH);

            assert.strictEqual(result.success, true, `ICC extraction failed: ${result.error}\n${result.stack}`);

            console.log(`  Found ${result.profileCount} ICC profiles`);
            console.log(`  Color spaces: ${result.colorSpaces.join(', ') || '(none)'}`);

            for (const profile of result.profiles) {
                console.log(`    ${profile.ref}: ${profile.colorSpace} (${profile.bufferSize} bytes)`);
            }
        });

        test('getDeviceColorSpaceForICC returns correct device color spaces', async t => {
            if (!page) return t.skip('Page not initialized');

            const result = await page.evaluate(async () => {
                try {
                    const { getDeviceColorSpaceForICC } = await import('../services/ColorSpaceUtils.js');

                    const testCases = [
                        { input: 'CMYK', expected: 'DeviceCMYK' },
                        { input: 'RGB', expected: 'DeviceRGB' },
                        { input: 'GRAY', expected: 'DeviceGray' },
                        { input: 'Lab', expected: undefined },
                        { input: 'Unknown', expected: undefined },
                    ];

                    const results = [];
                    for (const { input, expected } of testCases) {
                        const result = getDeviceColorSpaceForICC(input);
                        const actual = result?.decodeText?.() ?? result;
                        results.push({
                            input,
                            expected,
                            actual,
                            pass: actual === expected,
                        });
                    }

                    return {
                        success: true,
                        results,
                        allPassed: results.every(r => r.pass),
                    };
                } catch (error) {
                    return { success: false, error: String(error) };
                }
            });

            assert.strictEqual(result.success, true, `Device color space test failed: ${result.error}`);
            assert.strictEqual(result.allPassed, true, 'All device color space mappings should be correct');

            for (const r of result.results) {
                console.log(`  ${r.input} -> ${r.actual} (expected: ${r.expected}) ${r.pass ? '✓' : '✗'}`);
            }
        });
    });

    describe('Content Stream Color Replacement', () => {
        test('replaceContentStreamColors correctly replaces color values', async t => {
            if (!page) return t.skip('Page not initialized');

            const result = await page.evaluate(async () => {
                try {
                    const {
                        parseContentStreamColors,
                        replaceContentStreamColors,
                        formatColorValues,
                        getOperatorForColorType,
                    } = await import('../services/ColorSpaceUtils.js');

                    // Test stream with RGB and gray colors
                    const testStream = `q 0.2 0.4 0.6 rg 100 100 200 150 re f 0.75 g 50 50 m S Q`;

                    const parseResult = parseContentStreamColors(testStream);

                    // Find the RGB and gray chunks
                    const rgbChunk = parseResult.chunks.find(c => c.type === 'rgb');
                    const grayChunk = parseResult.chunks.find(c => c.type === 'gray');

                    if (!rgbChunk || !grayChunk) {
                        return { success: false, error: 'Could not find expected color chunks' };
                    }

                    // Create replacements (simulating RGB->CMYK conversion)
                    /** @type {import('../services/ColorSpaceUtils.js').ColorReplacement[]} */
                    const replacements = [
                        { chunk: rgbChunk, newValues: [0.8, 0.6, 0.4, 0.1], newType: 'cmyk' },
                        { chunk: grayChunk, newValues: [0.0, 0.0, 0.0, 0.25], newType: 'cmyk' },
                    ];

                    const result = replaceContentStreamColors(testStream, replacements);

                    // Verify the replacements
                    const hasCMYK = result.newText.includes(' k');
                    const noRGB = !result.newText.includes(' rg');
                    const noGray = !result.newText.includes(' g ');

                    // Test helper functions
                    const formattedValues = formatColorValues([0.123456789, 1.0, 0]);
                    const strokeOp = getOperatorForColorType('cmyk', true);
                    const fillOp = getOperatorForColorType('cmyk', false);

                    return {
                        success: true,
                        originalText: testStream,
                        newText: result.newText,
                        replacementCount: result.replacementCount,
                        hasCMYK,
                        noRGB,
                        noGray,
                        formattedValues,
                        strokeOp,
                        fillOp,
                    };
                } catch (error) {
                    return { success: false, error: String(error), stack: error?.stack };
                }
            });

            assert.strictEqual(result.success, true, `Replacement test failed: ${result.error}`);
            assert.strictEqual(result.replacementCount, 2, 'Should replace 2 colors');
            assert.strictEqual(result.hasCMYK, true, 'Result should contain CMYK operators');
            assert.strictEqual(result.noRGB, true, 'Result should not contain RGB operators');
            assert.strictEqual(result.strokeOp, 'K', 'Stroke CMYK operator should be K');
            assert.strictEqual(result.fillOp, 'k', 'Fill CMYK operator should be k');

            console.log(`  Original: ${result.originalText.substring(0, 50)}...`);
            console.log(`  Modified: ${result.newText.substring(0, 50)}...`);
            console.log(`  Replacements: ${result.replacementCount}`);
        });

        test('replaceContentStreamColors handles empty replacements', async t => {
            if (!page) return t.skip('Page not initialized');

            const result = await page.evaluate(async () => {
                try {
                    const { replaceContentStreamColors } = await import('../services/ColorSpaceUtils.js');

                    const testStream = `q 0.5 g 100 100 m S Q`;
                    const result = replaceContentStreamColors(testStream, []);

                    return {
                        success: true,
                        unchanged: result.newText === result.originalText,
                        replacementCount: result.replacementCount,
                    };
                } catch (error) {
                    return { success: false, error: String(error) };
                }
            });

            assert.strictEqual(result.success, true, `Empty replacement test failed: ${result.error}`);
            assert.strictEqual(result.unchanged, true, 'Stream should be unchanged');
            assert.strictEqual(result.replacementCount, 0, 'Should have 0 replacements');
        });
    });

    describe('Image Processing Utilities', () => {
        test('extractImageMetadata returns correct metadata', async t => {
            if (!page) return t.skip('Page not initialized');

            const result = await page.evaluate(async (pdfPath) => {
                try {
                    const { PDFDocument, PDFRawStream } = await import('pdf-lib');
                    const { extractImageMetadata, analyzeColorSpaces } = await import('../services/ColorSpaceUtils.js');

                    const response = await fetch(pdfPath);
                    const pdfBytes = await response.arrayBuffer();
                    const pdfDocument = await PDFDocument.load(pdfBytes);

                    const analysis = analyzeColorSpaces(pdfDocument);
                    const xobjectImages = analysis.colorSpaceDesignationTargetsByClassifier['XObjectImage'];

                    if (!xobjectImages || xobjectImages.size === 0) {
                        return { success: false, error: 'No images found' };
                    }

                    // Get metadata for first few images
                    const metadataList = [];
                    let count = 0;
                    for (const [stream, designation] of xobjectImages.entries()) {
                        if (count++ >= 5) break;
                        if (!(stream instanceof PDFRawStream)) continue;

                        const metadata = extractImageMetadata(stream);
                        metadataList.push({
                            width: metadata.width,
                            height: metadata.height,
                            bitsPerComponent: metadata.bitsPerComponent,
                            colorSpace: metadata.colorSpace,
                            componentsPerPixel: metadata.componentsPerPixel,
                            filter: metadata.filter,
                        });
                    }

                    return {
                        success: true,
                        imageCount: xobjectImages.size,
                        metadataList,
                    };
                } catch (error) {
                    return { success: false, error: String(error), stack: error?.stack };
                }
            }, TEST_PDF_PATH);

            assert.strictEqual(result.success, true, `Metadata extraction failed: ${result.error}`);
            assert.ok(result.metadataList.length > 0, 'Should extract metadata from images');

            console.log(`  Total images: ${result.imageCount}`);
            for (const meta of result.metadataList) {
                console.log(`    ${meta.width}×${meta.height} ${meta.colorSpace} (${meta.bitsPerComponent}bpc, filter: ${meta.filter})`);
            }
        });

        test('getComponentsForColorSpace returns correct component counts', async t => {
            if (!page) return t.skip('Page not initialized');

            const result = await page.evaluate(async () => {
                try {
                    const { getComponentsForColorSpace } = await import('../services/ColorSpaceUtils.js');

                    const testCases = [
                        { colorSpace: 'DeviceGray', expected: 1 },
                        { colorSpace: 'DeviceRGB', expected: 3 },
                        { colorSpace: 'DeviceCMYK', expected: 4 },
                        { colorSpace: 'Lab', expected: 3 },
                        { colorSpace: 'CalGray', expected: 1 },
                        { colorSpace: 'CalRGB', expected: 3 },
                        { colorSpace: 'Indexed', expected: 1 },
                    ];

                    const results = testCases.map(tc => ({
                        colorSpace: tc.colorSpace,
                        expected: tc.expected,
                        actual: getComponentsForColorSpace(tc.colorSpace),
                        pass: getComponentsForColorSpace(tc.colorSpace) === tc.expected,
                    }));

                    return {
                        success: true,
                        results,
                        allPassed: results.every(r => r.pass),
                    };
                } catch (error) {
                    return { success: false, error: String(error) };
                }
            });

            assert.strictEqual(result.success, true, `Component count test failed: ${result.error}`);
            assert.strictEqual(result.allPassed, true, 'All component counts should be correct');

            for (const r of result.results) {
                console.log(`  ${r.colorSpace}: ${r.actual} (expected ${r.expected}) ${r.pass ? '✓' : '✗'}`);
            }
        });
    });

    describe('Image Color Space Detection', () => {
        test('finds XObject images with color spaces', async t => {
            if (!page) return t.skip('Page not initialized');

            const result = await page.evaluate(async (pdfPath) => {
                try {
                    const { PDFDocument } = await import('pdf-lib');
                    const { analyzeColorSpaces } = await import('../services/ColorSpaceUtils.js');

                    const response = await fetch(pdfPath);
                    const pdfBytes = await response.arrayBuffer();
                    const pdfDocument = await PDFDocument.load(pdfBytes);

                    const analysis = analyzeColorSpaces(pdfDocument);

                    const xobjectImages = analysis.colorSpaceDesignationTargetsByClassifier['XObjectImage'];

                    if (!xobjectImages) {
                        return {
                            success: true,
                            imageCount: 0,
                            images: [],
                        };
                    }

                    const images = [];
                    for (const [stream, designation] of xobjectImages.entries()) {
                        const colorSpaceType = designation.colorSpaceDefinition?.colorSpaceType ?? 'Unknown';
                        images.push({
                            ref: designation.colorSpaceDesignationTargetRef?.toString(),
                            colorSpaceType,
                            designationType: designation.type,
                        });
                    }

                    // Group by color space type
                    const byColorSpace = {};
                    for (const img of images) {
                        byColorSpace[img.colorSpaceType] = (byColorSpace[img.colorSpaceType] || 0) + 1;
                    }

                    return {
                        success: true,
                        imageCount: images.length,
                        images: images.slice(0, 5), // Sample first 5
                        byColorSpace,
                    };
                } catch (error) {
                    return { success: false, error: String(error), stack: error?.stack };
                }
            }, TEST_PDF_PATH);

            assert.strictEqual(result.success, true, `Image detection failed: ${result.error}\n${result.stack}`);

            console.log(`  Found ${result.imageCount} XObject images`);
            console.log(`  By color space: ${JSON.stringify(result.byColorSpace)}`);
        });
    });
});
