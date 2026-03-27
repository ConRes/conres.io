#!/usr/bin/env node
// @ts-check
/**
 * Compare PDF Color Conversion CLI Tool
 *
 * Compares two PDFs (expected vs actual) to identify color conversion differences.
 * Designed for debugging refactored PDF color conversion by comparing against
 * known-good legacy output.
 *
 * Comparison Criteria:
 * - PDF level: byte size, page count, stream count, output intents
 * - Profile streams: compressed/uncompressed size, hash
 * - Images: dimensions, BPC, colorspace, compressed/uncompressed size, pixel sampling
 * - Content streams: compressed/uncompressed size, hash, color operator sampling
 *
 * @module compare-pdf-color
 */

import { readFile, stat } from 'fs/promises';
import { existsSync } from 'fs';
import { createHash } from 'crypto';
import { resolve, basename, dirname } from 'path';
import { fileURLToPath } from 'url';
import { argv, exit } from 'process';
import {
    PDFDocument,
    PDFRawStream,
    PDFDict,
    PDFArray,
    PDFName,
    PDFRef,
    PDFPageLeaf,
    decodePDFRawStream,
} from '../packages/pdf-lib/pdf-lib.esm.js';

// Color Engine imports for Lab 16-bit conversion
import {
    createEngine,
    TYPE_RGB_8,
    TYPE_RGB_16,
    TYPE_CMYK_8,
    TYPE_CMYK_16,
    TYPE_GRAY_8,
    TYPE_GRAY_16,
    TYPE_Lab_8,
    TYPE_Lab_16,
    INTENT_RELATIVE_COLORIMETRIC,
} from '../packages/color-engine/src/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** @type {import('../packages/color-engine/src/index.js').ColorEngine | null} */
let colorEngine = null;

/**
 * Initialize the color engine (lazy initialization)
 * @returns {Promise<import('../packages/color-engine/src/index.js').ColorEngine>}
 */
async function getColorEngine() {
    if (!colorEngine) {
        colorEngine = await createEngine();
    }
    return colorEngine;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_SAMPLE_RATE = 0.2;

// ============================================================================
// Argument Parsing
// ============================================================================

function printUsage() {
    console.log(`
Compare PDF Color Conversion CLI Tool

Compares two PDFs to identify color conversion differences between expected
(legacy) and actual (refactored) outputs.

Usage:
  node compare-pdf-color.js <expected.pdf> <actual.pdf> [options]

Arguments:
  <expected.pdf>    The expected/reference PDF (e.g., legacy conversion output)
  <actual.pdf>      The actual PDF to compare (e.g., refactored conversion output)

Options:
  --verbose, -v           Show detailed comparison output
  --sample-rate=<rate>    Pixel/value sampling rate for fuzzy comparison (default: 0.2)
  --show-samples          Show individual sample comparisons
  --help, -h              Show this help message

Comparison Summary:
  MATCH    - Values are identical
  SIMILAR  - Values differ but within tolerance or structurally equivalent
  DIFFER   - Values differ significantly (potential bug)

Examples:
  # Compare legacy vs refactored outputs
  node compare-pdf-color.js \\
      "output/2026-01-23-010/fixture - Legacy - eciCMYK v2.pdf" \\
      "output/2026-01-23-010/fixture - Refactored - eciCMYK v2.pdf"

  # With verbose output and sample details
  node compare-pdf-color.js expected.pdf actual.pdf --verbose --show-samples
`);
}

/**
 * @typedef {{
 *   expectedPath: string | undefined,
 *   actualPath: string | undefined,
 *   verbose: boolean,
 *   sampleRate: number,
 *   showSamples: boolean,
 * }} ParsedOptions
 */

/**
 * @param {string[]} args
 * @returns {ParsedOptions}
 */
function parseArgs(args) {
    /** @type {string[]} */
    const positional = [];
    const options = {
        verbose: false,
        sampleRate: DEFAULT_SAMPLE_RATE,
        showSamples: false,
    };

    for (const arg of args) {
        // Help
        if (arg === '--help' || arg === '-h') {
            printUsage();
            exit(0);
        }

        // Verbose
        if (arg === '--verbose' || arg === '-v') {
            options.verbose = true;
            continue;
        }

        // Sample rate
        if (arg.startsWith('--sample-rate=')) {
            options.sampleRate = parseFloat(arg.split('=')[1]) || DEFAULT_SAMPLE_RATE;
            continue;
        }

        // Show samples
        if (arg === '--show-samples') {
            options.showSamples = true;
            continue;
        }

        // Positional arguments
        if (!arg.startsWith('-')) {
            positional.push(arg);
        }
    }

    return {
        expectedPath: positional[0],
        actualPath: positional[1],
        ...options,
    };
}

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * @typedef {'MATCH' | 'SIMILAR' | 'DIFFER'} ComparisonStatus
 */

/**
 * @typedef {{
 *   ref: string,
 *   alias: string,
 *   pageNum: number,
 *   width: number,
 *   height: number,
 *   bpc: number,
 *   colorSpace: string,
 *   filter: string,
 *   compressedSize: number,
 *   uncompressedSize: number,
 *   compressedHash: string,
 *   uncompressedHash: string,
 *   rawPixelData?: Uint8Array,
 *   componentsPerPixel: number,
 *   iccProfile?: Uint8Array,
 * }} ImageAnalysis
 */

/**
 * @typedef {{
 *   ref: string,
 *   pageNum: number,
 *   streamIndex: number,
 *   compressedSize: number,
 *   uncompressedSize: number,
 *   hash: string,
 *   colorOperators: Record<string, number>,
 *   sampleValues?: string[],
 * }} ContentStreamAnalysis
 */

/**
 * @typedef {{
 *   ref: string,
 *   compressedSize: number,
 *   uncompressedSize: number,
 *   hash: string,
 *   nComponents?: number,
 *   colorSpace?: string,
 * }} ProfileStreamAnalysis
 */

/**
 * @typedef {{
 *   fileName: string,
 *   fileSize: number,
 *   pageCount: number,
 *   streamCount: number,
 *   outputIntents: string[],
 *   images: ImageAnalysis[],
 *   contentStreams: ContentStreamAnalysis[],
 *   profiles: ProfileStreamAnalysis[],
 * }} PDFAnalysis
 */

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Format file size
 * @param {number} bytes
 * @returns {string}
 */
function formatSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * Calculate hash of buffer
 * @param {Uint8Array} buffer
 * @returns {string}
 */
function hashBuffer(buffer) {
    return createHash('sha256').update(buffer).digest('hex').slice(0, 16);
}

/**
 * Format comparison status with color
 * @param {ComparisonStatus} status
 * @returns {string}
 */
function formatStatus(status) {
    switch (status) {
        case 'MATCH': return '\x1b[32mMATCH\x1b[0m';
        case 'SIMILAR': return '\x1b[33mSIMILAR\x1b[0m';
        case 'DIFFER': return '\x1b[31mDIFFER\x1b[0m';
    }
}


// ============================================================================
// Lab 16-bit Conversion and ∆E Calculation (Using Color Engine with ICC Profiles)
// ============================================================================

/**
 * Lab 16-bit encoding (LittleCMS convention):
 * - L*: 0-65535 maps to 0.0-100.0 (scale factor: 655.35)
 * - a*: 0-65535 maps to -128.0-127.996 (offset: 128, scale: 256.003906)
 * - b*: 0-65535 maps to -128.0-127.996 (offset: 128, scale: 256.003906)
 */

/**
 * Convert Lab 16-bit to standard Lab for ∆E calculation
 * @param {Uint16Array} lab16 - Lab 16-bit values [L16, a16, b16]
 * @returns {[number, number, number]} Standard Lab values [L, a, b]
 */
function lab16ToLab(lab16) {
    // LittleCMS Lab 16-bit encoding
    const L = (lab16[0] / 65535.0) * 100.0;
    const a = ((lab16[1] / 65535.0) * 256.0) - 128.0;
    const b = ((lab16[2] / 65535.0) * 256.0) - 128.0;
    return [L, a, b];
}

/**
 * Calculate CIE76 ∆E between two Lab colors
 * Formula: ∆E = √((L1-L2)² + (a1-a2)² + (b1-b2)²)
 * @param {[number, number, number]} lab1 - First Lab color [L, a, b]
 * @param {[number, number, number]} lab2 - Second Lab color [L, a, b]
 * @returns {number} ∆E value
 */
function deltaE(lab1, lab2) {
    const dL = lab1[0] - lab2[0];
    const da = lab1[1] - lab2[1];
    const db = lab1[2] - lab2[2];
    return Math.sqrt(dL * dL + da * da + db * db);
}

/**
 * Get the input format constant based on color space and bit depth
 * @param {string} colorSpace - Color space name
 * @param {number} bpc - Bits per component (8 or 16)
 * @returns {number} Color engine TYPE constant
 */
function getInputFormat(colorSpace, bpc) {
    const cs = colorSpace.toLowerCase();
    const is16 = bpc === 16;

    if (cs.includes('gray') || cs.includes('devicegray')) {
        return is16 ? TYPE_GRAY_16 : TYPE_GRAY_8;
    }
    if (cs.includes('cmyk') || cs.includes('devicecmyk')) {
        return is16 ? TYPE_CMYK_16 : TYPE_CMYK_8;
    }
    if (cs.includes('lab')) {
        return is16 ? TYPE_Lab_16 : TYPE_Lab_8;
    }
    // Default: RGB
    return is16 ? TYPE_RGB_16 : TYPE_RGB_8;
}

/**
 * Create a color transform from source profile to Lab 16-bit
 * @param {import('../packages/color-engine/src/index.js').ColorEngine} engine - Color engine instance
 * @param {Uint8Array | null} iccProfile - Source ICC profile data (null for device color spaces)
 * @param {string} colorSpace - Color space name
 * @param {number} bpc - Bits per component
 * @returns {Promise<{transform: number, inputProfile: number, labProfile: number, needsCleanup: boolean}>}
 */
async function createToLabTransform(engine, iccProfile, colorSpace, bpc) {
    const cs = colorSpace.toLowerCase();
    let inputProfile;
    let needsCleanup = false;

    if (iccProfile && iccProfile.length > 0) {
        // Use embedded ICC profile
        inputProfile = engine.openProfileFromMem(iccProfile);
        needsCleanup = true;
    } else if (cs.includes('gray') || cs.includes('devicegray')) {
        // Use built-in Gray profile (gamma 2.2, D50)
        inputProfile = engine.createGray2Profile();
        needsCleanup = true;
    } else if (cs.includes('cmyk') || cs.includes('devicecmyk')) {
        // For DeviceCMYK without profile, we can't convert accurately
        // Return null to indicate fallback needed
        return { transform: 0, inputProfile: 0, labProfile: 0, needsCleanup: false };
    } else {
        // Default: sRGB
        inputProfile = engine.createSRGBProfile();
        needsCleanup = true;
    }

    const labProfile = engine.createLab4Profile(0); // D50 white point
    const inputFormat = getInputFormat(colorSpace, bpc);
    const outputFormat = TYPE_Lab_16;

    const transform = engine.createTransform(
        inputProfile,
        inputFormat,
        labProfile,
        outputFormat,
        INTENT_RELATIVE_COLORIMETRIC,
        0 // No flags needed for Lab conversion
    );

    return { transform, inputProfile, labProfile, needsCleanup };
}

/**
 * Convert pixel buffer to Lab 16-bit using color engine
 * @param {import('../packages/color-engine/src/index.js').ColorEngine} engine - Color engine instance
 * @param {Uint8Array | Uint16Array} pixelData - Source pixel data
 * @param {Uint8Array | null} iccProfile - Source ICC profile
 * @param {string} colorSpace - Color space name
 * @param {number} bpc - Bits per component
 * @param {number} pixelCount - Number of pixels to convert
 * @returns {Promise<Uint16Array>} Lab 16-bit data (3 components per pixel)
 */
async function convertToLab16(engine, pixelData, iccProfile, colorSpace, bpc, pixelCount) {
    const { transform, inputProfile, labProfile, needsCleanup } = await createToLabTransform(
        engine, iccProfile, colorSpace, bpc
    );

    // Allocate output buffer (3 x 16-bit components per pixel)
    const outputData = new Uint16Array(pixelCount * 3);

    if (transform === 0) {
        // Fallback for DeviceCMYK without profile - use simplified conversion
        const cpp = getComponentsPerPixel(colorSpace);
        for (let i = 0; i < pixelCount; i++) {
            const offset = i * cpp;
            // Simple CMYK→Lab approximation
            const c = pixelData[offset] / 255;
            const m = pixelData[offset + 1] / 255;
            const y = pixelData[offset + 2] / 255;
            const k = pixelData[offset + 3] / 255;

            // CMYK to RGB
            const r = 255 * (1 - c) * (1 - k);
            const g = 255 * (1 - m) * (1 - k);
            const b = 255 * (1 - y) * (1 - k);

            // RGB to Lab (simplified D65)
            const toLinear = (v) => {
                v = v / 255;
                return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
            };
            const lr = toLinear(r), lg = toLinear(g), lb = toLinear(b);
            const X = 0.4124564 * lr + 0.3575761 * lg + 0.1804375 * lb;
            const Y = 0.2126729 * lr + 0.7151522 * lg + 0.0721750 * lb;
            const Z = 0.0193339 * lr + 0.1191920 * lg + 0.9503041 * lb;
            const xn = 0.95047, yn = 1.0, zn = 1.08883;
            const f = (t) => t > 0.008856 ? Math.cbrt(t) : (7.787 * t) + (16 / 116);
            const fx = f(X / xn), fy = f(Y / yn), fz = f(Z / zn);
            const L = (116 * fy) - 16;
            const a = 500 * (fx - fy);
            const bVal = 200 * (fy - fz);

            // Convert to 16-bit Lab encoding
            outputData[i * 3] = Math.round(Math.max(0, Math.min(65535, (L / 100.0) * 65535)));
            outputData[i * 3 + 1] = Math.round(Math.max(0, Math.min(65535, ((a + 128) / 256.0) * 65535)));
            outputData[i * 3 + 2] = Math.round(Math.max(0, Math.min(65535, ((bVal + 128) / 256.0) * 65535)));
        }
        return outputData;
    }

    try {
        // Use color engine transform
        engine.doTransform(transform, pixelData, outputData, pixelCount);
    } finally {
        // Clean up
        engine.deleteTransform(transform);
        if (needsCleanup) {
            engine.closeProfile(inputProfile);
        }
        engine.closeProfile(labProfile);
    }

    return outputData;
}

/**
 * Statistical ∆E comparison with random sampling using Lab 16-bit and ICC profiles
 * @param {Uint8Array} expectedData - Expected pixel data
 * @param {Uint8Array} actualData - Actual pixel data
 * @param {number} expectedCpp - Expected components per pixel
 * @param {number} actualCpp - Actual components per pixel
 * @param {string} expectedColorSpace - Expected color space
 * @param {string} actualColorSpace - Actual color space
 * @param {number} expectedBpc - Expected bits per component
 * @param {number} actualBpc - Actual bits per component
 * @param {Uint8Array | undefined} expectedIccProfile - Expected ICC profile
 * @param {Uint8Array | undefined} actualIccProfile - Actual ICC profile
 * @param {number} sampleCount - Number of samples to take
 * @returns {Promise<{avgDeltaE: number, maxDeltaE: number, passRate: number, sampleCount: number}>}
 */
async function calculateDeltaEStats(
    expectedData, actualData,
    expectedCpp, actualCpp,
    expectedColorSpace, actualColorSpace,
    expectedBpc, actualBpc,
    expectedIccProfile, actualIccProfile,
    sampleCount = 1000
) {
    const expectedPixelCount = Math.floor(expectedData.length / expectedCpp);
    const actualPixelCount = Math.floor(actualData.length / actualCpp);

    if (expectedPixelCount === 0 || actualPixelCount === 0) {
        return { avgDeltaE: Infinity, maxDeltaE: Infinity, passRate: 0, sampleCount: 0 };
    }

    // Use minimum pixel count if they differ
    const minPixelCount = Math.min(expectedPixelCount, actualPixelCount);
    const actualSampleCount = Math.min(sampleCount, minPixelCount);

    // Generate random sample indices
    const indices = new Set();
    let seed = 12345; // Deterministic for reproducibility
    const random = () => {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        return seed / 0x7fffffff;
    };
    while (indices.size < actualSampleCount) {
        indices.add(Math.floor(random() * minPixelCount));
    }

    // Extract sample pixels for batch conversion
    const expectedSamples = new Uint8Array(actualSampleCount * expectedCpp);
    const actualSamples = new Uint8Array(actualSampleCount * actualCpp);

    let sampleIdx = 0;
    for (const idx of indices) {
        // Copy expected pixel
        const expOffset = idx * expectedCpp;
        for (let c = 0; c < expectedCpp; c++) {
            expectedSamples[sampleIdx * expectedCpp + c] = expectedData[expOffset + c];
        }
        // Copy actual pixel
        const actOffset = idx * actualCpp;
        for (let c = 0; c < actualCpp; c++) {
            actualSamples[sampleIdx * actualCpp + c] = actualData[actOffset + c];
        }
        sampleIdx++;
    }

    // Convert to Lab 16-bit using color engine with ICC profiles
    const engine = await getColorEngine();

    const expectedLab16 = await convertToLab16(
        engine, expectedSamples, expectedIccProfile ?? null,
        expectedColorSpace, expectedBpc, actualSampleCount
    );
    const actualLab16 = await convertToLab16(
        engine, actualSamples, actualIccProfile ?? null,
        actualColorSpace, actualBpc, actualSampleCount
    );

    // Calculate ∆E statistics
    let totalDeltaE = 0;
    let maxDeltaE = 0;
    let passCount = 0;
    const threshold = 3;

    for (let i = 0; i < actualSampleCount; i++) {
        const expLab = [expectedLab16[i * 3], expectedLab16[i * 3 + 1], expectedLab16[i * 3 + 2]];
        const actLab = [actualLab16[i * 3], actualLab16[i * 3 + 1], actualLab16[i * 3 + 2]];

        // Convert 16-bit to standard Lab for ∆E
        const expLabStd = lab16ToLab(new Uint16Array(expLab));
        const actLabStd = lab16ToLab(new Uint16Array(actLab));

        const dE = deltaE(expLabStd, actLabStd);
        totalDeltaE += dE;
        maxDeltaE = Math.max(maxDeltaE, dE);
        if (dE <= threshold) passCount++;
    }

    return {
        avgDeltaE: totalDeltaE / actualSampleCount,
        maxDeltaE,
        passRate: passCount / actualSampleCount,
        sampleCount: actualSampleCount,
    };
}

// ============================================================================
// PDF Analysis
// ============================================================================

/**
 * Get components per pixel for a color space
 * @param {string} colorSpace
 * @returns {number}
 */
function getComponentsPerPixel(colorSpace) {
    const cs = colorSpace.toLowerCase();
    if (cs.includes('cmyk')) return 4;
    if (cs.includes('rgb')) return 3;
    if (cs.includes('gray')) return 1;
    if (cs.includes('lab')) return 3;
    if (cs.includes('iccbased')) return 3; // Could be 1, 3, or 4 - default to 3
    return 3;
}

/**
 * Analyze a PDF document
 * @param {string} pdfPath
 * @param {number} sampleRate
 * @returns {Promise<PDFAnalysis>}
 */
async function analyzePDF(pdfPath, sampleRate) {
    const pdfBytes = await readFile(pdfPath);
    const fileStats = await stat(pdfPath);
    const pdfDoc = await PDFDocument.load(pdfBytes);
    const context = pdfDoc.context;

    /** @type {PDFAnalysis} */
    const analysis = {
        fileName: basename(pdfPath),
        fileSize: fileStats.size,
        pageCount: pdfDoc.getPageCount(),
        streamCount: 0,
        outputIntents: [],
        images: [],
        contentStreams: [],
        profiles: [],
    };

    // Track profile refs to avoid duplicates
    /** @type {Set<string>} */
    const profileRefs = new Set();

    // Find output intents
    const catalog = pdfDoc.catalog;
    const outputIntents = catalog.get(PDFName.of('OutputIntents'));
    if (outputIntents) {
        const intentsArray = outputIntents instanceof PDFRef
            ? context.lookup(outputIntents)
            : outputIntents;
        if (intentsArray instanceof PDFArray) {
            for (let i = 0; i < intentsArray.size(); i++) {
                const intentRef = intentsArray.get(i);
                const intent = intentRef instanceof PDFRef
                    ? context.lookup(intentRef)
                    : intentRef;
                if (intent instanceof PDFDict) {
                    const subtype = intent.get(PDFName.of('S'));
                    const info = intent.get(PDFName.of('OutputConditionIdentifier'));
                    let intentStr = subtype instanceof PDFName ? subtype.decodeText() : 'unknown';
                    if (info) {
                        const infoStr = 'decodeText' in info ? info.decodeText() : String(info);
                        intentStr += `: ${infoStr}`;
                    }
                    analysis.outputIntents.push(intentStr);

                    // Track profile ref
                    const destProfile = intent.get(PDFName.of('DestOutputProfile'));
                    if (destProfile instanceof PDFRef) {
                        profileRefs.add(`${destProfile.objectNumber} ${destProfile.generationNumber} R`);
                    }
                }
            }
        }
    }

    // Analyze pages
    const pages = pdfDoc.getPages();
    for (let pageIdx = 0; pageIdx < pages.length; pageIdx++) {
        const pageNum = pageIdx + 1;
        const page = pages[pageIdx];
        const pageNode = /** @type {PDFPageLeaf} */ (page.node);

        // Get resources
        const resources = pageNode.get(PDFName.of('Resources'));
        let resourcesDict = resources;
        if (resources instanceof PDFRef) {
            resourcesDict = context.lookup(resources);
        }

        // Analyze images
        if (resourcesDict instanceof PDFDict) {
            const xobjectEntry = resourcesDict.get(PDFName.of('XObject'));
            let xobjectDict = xobjectEntry;
            if (xobjectEntry instanceof PDFRef) {
                xobjectDict = context.lookup(xobjectEntry);
            }
            if (xobjectDict instanceof PDFDict) {
                for (const [key, value] of xobjectDict.entries()) {
                    const alias = key.decodeText();
                    let actualRef = value;
                    let refStr = '';
                    if (value instanceof PDFRef) {
                        refStr = `${value.objectNumber} ${value.generationNumber} R`;
                        actualRef = context.lookup(value);
                    } else {
                        refStr = `inline:${alias}`;
                    }

                    if (actualRef instanceof PDFRawStream) {
                        const subtype = actualRef.dict.get(PDFName.of('Subtype'));
                        if (subtype instanceof PDFName && subtype.decodeText() === 'Image') {
                            analysis.streamCount++;
                            const imageAnalysis = analyzeImage(actualRef, refStr, alias, pageNum, context, sampleRate);
                            analysis.images.push(imageAnalysis);
                        }
                    }
                }
            }

            // Find ICC profiles in ColorSpace resources
            const colorSpaceEntry = resourcesDict.get(PDFName.of('ColorSpace'));
            let colorSpaceDict = colorSpaceEntry;
            if (colorSpaceEntry instanceof PDFRef) {
                colorSpaceDict = context.lookup(colorSpaceEntry);
            }
            if (colorSpaceDict instanceof PDFDict) {
                for (const [, value] of colorSpaceDict.entries()) {
                    let csArray = value;
                    if (value instanceof PDFRef) {
                        csArray = context.lookup(value);
                    }
                    if (csArray instanceof PDFArray && csArray.size() > 1) {
                        const csType = csArray.get(0);
                        if (csType instanceof PDFName && csType.decodeText() === 'ICCBased') {
                            const profileRef = csArray.get(1);
                            if (profileRef instanceof PDFRef) {
                                profileRefs.add(`${profileRef.objectNumber} ${profileRef.generationNumber} R`);
                            }
                        }
                    }
                }
            }
        }

        // Analyze content streams
        const contents = pageNode.get(PDFName.of('Contents'));
        /** @type {PDFRef[]} */
        const streamRefs = [];

        if (contents instanceof PDFRef) {
            const resolved = context.lookup(contents);
            if (resolved instanceof PDFArray) {
                for (let i = 0; i < resolved.size(); i++) {
                    const ref = resolved.get(i);
                    if (ref instanceof PDFRef) streamRefs.push(ref);
                }
            } else {
                streamRefs.push(contents);
            }
        } else if (contents instanceof PDFArray) {
            for (let i = 0; i < contents.size(); i++) {
                const ref = contents.get(i);
                if (ref instanceof PDFRef) streamRefs.push(ref);
            }
        }

        for (let streamIdx = 0; streamIdx < streamRefs.length; streamIdx++) {
            const ref = streamRefs[streamIdx];
            const stream = context.lookup(ref);
            if (stream instanceof PDFRawStream) {
                analysis.streamCount++;
                const refStr = `${ref.objectNumber} ${ref.generationNumber} R`;
                const streamAnalysis = analyzeContentStream(stream, refStr, pageNum, streamIdx);
                analysis.contentStreams.push(streamAnalysis);
            }
        }
    }

    // Analyze profile streams
    for (const refStr of profileRefs) {
        const match = refStr.match(/(\d+) (\d+) R/);
        if (match) {
            const objNum = parseInt(match[1], 10);
            const genNum = parseInt(match[2], 10);
            const ref = PDFRef.of(objNum, genNum);
            const stream = context.lookup(ref);
            if (stream instanceof PDFRawStream) {
                analysis.streamCount++;
                const profileAnalysis = analyzeProfileStream(stream, refStr);
                analysis.profiles.push(profileAnalysis);
            }
        }
    }

    return analysis;
}

/**
 * Extract ICC profile from a color space definition
 * @param {any} csEntry - Color space entry from PDF
 * @param {import('pdf-lib').PDFContext} context - PDF context
 * @returns {{colorSpace: string, iccProfile: Uint8Array | undefined, componentsPerPixel: number}}
 */
function extractColorSpaceInfo(csEntry, context) {
    let colorSpace = 'Unknown';
    let iccProfile = undefined;
    let componentsPerPixel = 3;

    if (csEntry instanceof PDFName) {
        colorSpace = csEntry.decodeText();
        componentsPerPixel = getComponentsPerPixel(colorSpace);
    } else if (csEntry instanceof PDFRef) {
        const resolved = context.lookup(csEntry);
        return extractColorSpaceInfo(resolved, context);
    } else if (csEntry instanceof PDFArray && csEntry.size() > 0) {
        const first = csEntry.get(0);
        if (first instanceof PDFName) {
            colorSpace = first.decodeText();

            // Check for ICCBased color space
            if (colorSpace === 'ICCBased' && csEntry.size() > 1) {
                const profileRef = csEntry.get(1);
                if (profileRef instanceof PDFRef) {
                    const profileStream = context.lookup(profileRef);
                    if (profileStream instanceof PDFRawStream) {
                        try {
                            // Decode the ICC profile stream
                            iccProfile = decodePDFRawStream(profileStream).decode();
                            // Get N (number of components) from the profile stream dict
                            const nValue = profileStream.dict.get(PDFName.of('N'));
                            componentsPerPixel = nValue?.asNumber?.() ?? 3;
                        } catch (e) {
                            console.warn(`Failed to decode ICC profile: ${e.message}`);
                        }
                    }
                }
            } else {
                componentsPerPixel = getComponentsPerPixel(colorSpace);
            }
        }
    }

    return { colorSpace, iccProfile, componentsPerPixel };
}

/**
 * Analyze an image stream with layered hash comparison and ICC profile extraction
 * @param {PDFRawStream} stream
 * @param {string} refStr
 * @param {string} alias
 * @param {number} pageNum
 * @param {import('pdf-lib').PDFContext} context
 * @param {number} sampleRate
 * @returns {ImageAnalysis}
 */
function analyzeImage(stream, refStr, alias, pageNum, context, sampleRate) {
    const dict = stream.dict;

    const width = dict.get(PDFName.of('Width'))?.asNumber?.() ?? 0;
    const height = dict.get(PDFName.of('Height'))?.asNumber?.() ?? 0;
    const bpc = dict.get(PDFName.of('BitsPerComponent'))?.asNumber?.() ?? 8;

    // Extract color space info including ICC profile
    const csEntry = dict.get(PDFName.of('ColorSpace'));
    const { colorSpace, iccProfile, componentsPerPixel } = extractColorSpaceInfo(csEntry, context);

    let filter = 'None';
    const filterEntry = dict.get(PDFName.of('Filter'));
    if (filterEntry instanceof PDFName) {
        filter = filterEntry.decodeText();
    } else if (filterEntry instanceof PDFArray && filterEntry.size() > 0) {
        const filters = [];
        for (let i = 0; i < filterEntry.size(); i++) {
            const f = filterEntry.get(i);
            if (f instanceof PDFName) {
                filters.push(f.decodeText());
            }
        }
        filter = filters.join('+');
    }

    const compressedSize = stream.contents?.length ?? 0;

    // Always compute compressed hash
    const compressedHash = hashBuffer(stream.contents);

    // Increase decode limit for comparison - need full pixel data for ∆E
    // Only decode if compressed size < 50MB
    const MAX_DECODE_SIZE = 50 * 1024 * 1024;

    let uncompressedSize = 0;
    let uncompressedHash = '';
    let rawPixelData = /** @type {Uint8Array | undefined} */ (undefined);

    if (compressedSize < MAX_DECODE_SIZE) {
        try {
            const decoded = decodePDFRawStream(stream).decode();
            uncompressedSize = decoded.length;
            uncompressedHash = hashBuffer(decoded);

            // Store raw pixel data for ∆E comparison
            rawPixelData = decoded;
        } catch (e) {
            uncompressedHash = 'DECODE_ERROR';
        }
    } else {
        // For very large images, estimate uncompressed size
        uncompressedHash = 'NOT_DECODED';
        uncompressedSize = width * height * componentsPerPixel * Math.ceil(bpc / 8);
    }

    return {
        ref: refStr,
        alias,
        pageNum,
        width,
        height,
        bpc,
        colorSpace,
        filter,
        compressedSize,
        uncompressedSize,
        compressedHash,
        uncompressedHash,
        rawPixelData,
        componentsPerPixel,
        iccProfile,
    };
}

/**
 * Analyze a content stream
 * @param {PDFRawStream} stream
 * @param {string} refStr
 * @param {number} pageNum
 * @param {number} streamIndex
 * @returns {ContentStreamAnalysis}
 */
function analyzeContentStream(stream, refStr, pageNum, streamIndex) {
    const compressedSize = stream.contents?.length ?? 0;

    let uncompressedSize = 0;
    let hash = '';
    /** @type {Record<string, number>} */
    const colorOperators = {
        'cs/CS': 0,
        'sc/SC/scn/SCN': 0,
        'g/G': 0,
        'rg/RG': 0,
        'k/K': 0,
    };
    /** @type {string[]} */
    const sampleValues = [];

    try {
        const decoded = decodePDFRawStream(stream).decode();
        uncompressedSize = decoded.length;
        hash = hashBuffer(decoded);

        const text = new TextDecoder().decode(decoded);

        // Count operators
        colorOperators['cs/CS'] = (text.match(/\b(cs|CS)\b/g) || []).length;
        colorOperators['sc/SC/scn/SCN'] = (text.match(/\b(scn|SCN|sc|SC)\b/g) || []).length;
        colorOperators['g/G'] = (text.match(/\b(g|G)\b/g) || []).length;
        colorOperators['rg/RG'] = (text.match(/\b(rg|RG)\b/g) || []).length;
        colorOperators['k/K'] = (text.match(/\b(k|K)\b/g) || []).length;

        // Sample color values (first 20 k/K operations)
        const kMatches = text.matchAll(/([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+[kK]\b/g);
        let count = 0;
        for (const match of kMatches) {
            if (count++ >= 20) break;
            sampleValues.push(`${match[1]} ${match[2]} ${match[3]} ${match[4]} k`);
        }
    } catch (e) {
        hash = 'DECODE_ERROR';
    }

    return {
        ref: refStr,
        pageNum,
        streamIndex,
        compressedSize,
        uncompressedSize,
        hash,
        colorOperators,
        sampleValues,
    };
}

/**
 * Analyze a profile stream
 * @param {PDFRawStream} stream
 * @param {string} refStr
 * @returns {ProfileStreamAnalysis}
 */
function analyzeProfileStream(stream, refStr) {
    const compressedSize = stream.contents?.length ?? 0;

    // Get N from dict
    const nValue = stream.dict.get(PDFName.of('N'));
    const nComponents = nValue && typeof nValue.asNumber === 'function'
        ? nValue.asNumber()
        : undefined;

    let uncompressedSize = 0;
    let hash = '';
    let colorSpace = undefined;

    try {
        const decoded = decodePDFRawStream(stream).decode();
        uncompressedSize = decoded.length;
        hash = hashBuffer(decoded);

        // Extract color space from ICC header (bytes 16-19)
        if (decoded.length >= 20) {
            const csBytes = decoded.slice(16, 20);
            colorSpace = new TextDecoder('ascii').decode(csBytes).trim();
        }
    } catch (e) {
        hash = 'DECODE_ERROR';
    }

    return {
        ref: refStr,
        compressedSize,
        uncompressedSize,
        hash,
        nComponents,
        colorSpace,
    };
}

// ============================================================================
// Comparison
// ============================================================================

/**
 * Compare two PDF analyses with layered image comparison
 * @param {PDFAnalysis} expected
 * @param {PDFAnalysis} actual
 * @param {boolean} verbose
 * @param {boolean} showSamples
 * @returns {Promise<boolean>} true if there are significant differences
 */
async function comparePDFs(expected, actual, verbose, showSamples) {
    console.log('═'.repeat(80));
    console.log('PDF Color Conversion Comparison');
    console.log('═'.repeat(80));
    console.log('');
    console.log(`Expected: ${expected.fileName}`);
    console.log(`Actual:   ${actual.fileName}`);
    console.log('');

    // Track overall status
    let hasIssues = false;

    // ─────────────────────────────────────────────────────────────────────────
    // PDF-level comparison
    // ─────────────────────────────────────────────────────────────────────────
    console.log('─'.repeat(80));
    console.log('PDF Structure');
    console.log('─'.repeat(80));

    // File size
    const sizeDiff = actual.fileSize - expected.fileSize;
    const sizeDiffPercent = ((sizeDiff / expected.fileSize) * 100).toFixed(1);
    const sizeStatus = Math.abs(parseFloat(sizeDiffPercent)) < 10 ? 'SIMILAR' : 'DIFFER';
    console.log(`  File size:      ${formatStatus(sizeStatus === 'SIMILAR' ? 'MATCH' : sizeStatus)}  ${formatSize(expected.fileSize)} → ${formatSize(actual.fileSize)} (${sizeDiff > 0 ? '+' : ''}${sizeDiffPercent}%)`);

    // Page count
    const pageStatus = expected.pageCount === actual.pageCount ? 'MATCH' : 'DIFFER';
    console.log(`  Page count:     ${formatStatus(pageStatus)}  ${expected.pageCount} → ${actual.pageCount}`);
    if (pageStatus === 'DIFFER') hasIssues = true;

    // Stream count
    const streamDiff = Math.abs(actual.streamCount - expected.streamCount);
    const streamStatus = streamDiff === 0 ? 'MATCH' : streamDiff <= 2 ? 'SIMILAR' : 'DIFFER';
    console.log(`  Stream count:   ${formatStatus(streamStatus)}  ${expected.streamCount} → ${actual.streamCount}`);

    // Output intents
    const intentExpected = expected.outputIntents.join(', ') || '(none)';
    const intentActual = actual.outputIntents.join(', ') || '(none)';
    const intentStatus = intentExpected === intentActual ? 'MATCH' : 'DIFFER';
    console.log(`  Output intents: ${formatStatus(intentStatus)}  ${intentExpected}`);
    if (intentStatus === 'DIFFER') {
        console.log(`                          → ${intentActual}`);
    }
    console.log('');

    // ─────────────────────────────────────────────────────────────────────────
    // Profile comparison
    // ─────────────────────────────────────────────────────────────────────────
    console.log('─'.repeat(80));
    console.log('ICC Profiles');
    console.log('─'.repeat(80));

    if (expected.profiles.length === 0 && actual.profiles.length === 0) {
        console.log('  (no profiles found)');
    } else {
        console.log(`  Expected: ${expected.profiles.length} profile(s)`);
        console.log(`  Actual:   ${actual.profiles.length} profile(s)`);

        // Compare by hash
        const expectedHashes = new Set(expected.profiles.map(p => p.hash));
        const actualHashes = new Set(actual.profiles.map(p => p.hash));

        const matching = [...expectedHashes].filter(h => actualHashes.has(h)).length;
        const profileStatus = matching === expected.profiles.length && matching === actual.profiles.length
            ? 'MATCH' : 'SIMILAR';
        console.log(`  Hash match:     ${formatStatus(profileStatus)}  ${matching}/${expected.profiles.length} matching`);

        if (verbose) {
            for (const p of expected.profiles) {
                const actualMatch = actual.profiles.find(ap => ap.hash === p.hash);
                const status = actualMatch ? 'MATCH' : 'DIFFER';
                console.log(`    ${p.ref}: ${formatStatus(status)} ${p.colorSpace || '?'} (${p.nComponents || '?'} ch) ${formatSize(p.uncompressedSize)}`);
            }
        }
    }
    console.log('');

    // ─────────────────────────────────────────────────────────────────────────
    // Image comparison (Layered: compressed hash → uncompressed hash → ∆E)
    // ─────────────────────────────────────────────────────────────────────────
    console.log('─'.repeat(80));
    console.log('Images');
    console.log('─'.repeat(80));

    if (expected.images.length === 0 && actual.images.length === 0) {
        console.log('  (no images)');
    } else {
        console.log(`  Expected: ${expected.images.length} image(s)`);
        console.log(`  Actual:   ${actual.images.length} image(s)`);
        console.log('');

        // Group images by page for comparison
        /** @type {Map<number, ImageAnalysis[]>} */
        const expectedByPage = new Map();
        /** @type {Map<number, ImageAnalysis[]>} */
        const actualByPage = new Map();

        for (const img of expected.images) {
            if (!expectedByPage.has(img.pageNum)) expectedByPage.set(img.pageNum, []);
            expectedByPage.get(img.pageNum)?.push(img);
        }
        for (const img of actual.images) {
            if (!actualByPage.has(img.pageNum)) actualByPage.set(img.pageNum, []);
            actualByPage.get(img.pageNum)?.push(img);
        }

        const allPages = new Set([...expectedByPage.keys(), ...actualByPage.keys()]);
        for (const pageNum of [...allPages].sort((a, b) => a - b)) {
            const expImages = expectedByPage.get(pageNum) || [];
            const actImages = actualByPage.get(pageNum) || [];

            console.log(`  Page ${pageNum}:`);

            // Match by alias or by index
            for (let i = 0; i < Math.max(expImages.length, actImages.length); i++) {
                const exp = expImages[i];
                const act = actImages.find(a => a.alias === exp?.alias) || actImages[i];

                if (!exp) {
                    console.log(`    ${act?.alias || `Image ${i + 1}`}: ${formatStatus('DIFFER')} EXTRA in actual`);
                    hasIssues = true;
                    continue;
                }
                if (!act) {
                    console.log(`    ${exp.alias}: ${formatStatus('DIFFER')} MISSING in actual`);
                    hasIssues = true;
                    continue;
                }

                // Compare dimensions
                const dimMatch = exp.width === act.width && exp.height === act.height;
                const bpcMatch = exp.bpc === act.bpc;

                // Layered comparison
                let contentStatus = /** @type {ComparisonStatus} */ ('DIFFER');
                let contentDetail = '';
                let deltaEStats = null;

                // Layer 1: Compressed hash comparison
                if (exp.compressedHash === act.compressedHash) {
                    contentStatus = 'MATCH';
                    contentDetail = 'identical (compressed hash match)';
                }
                // Layer 2: Uncompressed hash comparison
                else if (exp.uncompressedHash === act.uncompressedHash) {
                    contentStatus = 'MATCH';
                    contentDetail = 'identical (uncompressed hash match, compression differs)';
                }
                // Layer 3: ∆E statistical sampling with Lab 16-bit
                else if (exp.rawPixelData && act.rawPixelData) {
                    try {
                        deltaEStats = await calculateDeltaEStats(
                            exp.rawPixelData, act.rawPixelData,
                            exp.componentsPerPixel, act.componentsPerPixel,
                            exp.colorSpace, act.colorSpace,
                            exp.bpc, act.bpc,
                            exp.iccProfile, act.iccProfile,
                            1000 // Sample 1000 random pixels
                        );

                        if (deltaEStats.avgDeltaE <= 3) {
                            contentStatus = 'MATCH';
                            contentDetail = `∆E avg=${deltaEStats.avgDeltaE.toFixed(2)} max=${deltaEStats.maxDeltaE.toFixed(2)} (${(deltaEStats.passRate * 100).toFixed(0)}% ≤3)`;
                        } else if (deltaEStats.avgDeltaE <= 6) {
                            contentStatus = 'SIMILAR';
                            contentDetail = `∆E avg=${deltaEStats.avgDeltaE.toFixed(2)} max=${deltaEStats.maxDeltaE.toFixed(2)} (${(deltaEStats.passRate * 100).toFixed(0)}% ≤3)`;
                        } else {
                            contentDetail = `∆E avg=${deltaEStats.avgDeltaE.toFixed(2)} max=${deltaEStats.maxDeltaE.toFixed(2)} (${(deltaEStats.passRate * 100).toFixed(0)}% ≤3)`;
                        }
                    } catch (e) {
                        contentDetail = `∆E calculation failed: ${e.message}`;
                    }
                } else {
                    contentDetail = 'hash differs (pixel data not available for ∆E)';
                }

                const overallStatus = dimMatch && bpcMatch && contentStatus !== 'DIFFER'
                    ? contentStatus
                    : 'DIFFER';

                if (overallStatus === 'DIFFER') hasIssues = true;

                const dimStr = `${exp.width}×${exp.height}`;
                const expCS = exp.colorSpace;
                const actCS = act.colorSpace;
                const csChange = expCS !== actCS ? `${expCS}→${actCS}` : expCS;

                console.log(`    ${exp.alias}: ${formatStatus(overallStatus)} ${dimStr} ${csChange} (${contentDetail})`);

                if (verbose || overallStatus === 'DIFFER') {
                    console.log(`      Expected: ${exp.bpc} BPC, ${formatSize(exp.uncompressedSize)}, compressed=${exp.compressedHash}, uncompressed=${exp.uncompressedHash}`);
                    console.log(`      Actual:   ${act.bpc} BPC, ${formatSize(act.uncompressedSize)}, compressed=${act.compressedHash}, uncompressed=${act.uncompressedHash}`);

                    if (deltaEStats && showSamples) {
                        console.log(`      ∆E Statistics: ${deltaEStats.sampleCount} samples, avg=${deltaEStats.avgDeltaE.toFixed(4)}, max=${deltaEStats.maxDeltaE.toFixed(4)}, pass rate=${(deltaEStats.passRate * 100).toFixed(1)}%`);
                    }
                }
            }
        }
    }
    console.log('');

    // ─────────────────────────────────────────────────────────────────────────
    // Content stream comparison
    // ─────────────────────────────────────────────────────────────────────────
    console.log('─'.repeat(80));
    console.log('Content Streams');
    console.log('─'.repeat(80));

    if (expected.contentStreams.length === 0 && actual.contentStreams.length === 0) {
        console.log('  (no content streams)');
    } else {
        console.log(`  Expected: ${expected.contentStreams.length} stream(s)`);
        console.log(`  Actual:   ${actual.contentStreams.length} stream(s)`);
        console.log('');

        // Group by page
        /** @type {Map<number, ContentStreamAnalysis[]>} */
        const expectedByPage = new Map();
        /** @type {Map<number, ContentStreamAnalysis[]>} */
        const actualByPage = new Map();

        for (const cs of expected.contentStreams) {
            if (!expectedByPage.has(cs.pageNum)) expectedByPage.set(cs.pageNum, []);
            expectedByPage.get(cs.pageNum)?.push(cs);
        }
        for (const cs of actual.contentStreams) {
            if (!actualByPage.has(cs.pageNum)) actualByPage.set(cs.pageNum, []);
            actualByPage.get(cs.pageNum)?.push(cs);
        }

        const allPages = new Set([...expectedByPage.keys(), ...actualByPage.keys()]);
        for (const pageNum of [...allPages].sort((a, b) => a - b)) {
            const expStreams = expectedByPage.get(pageNum) || [];
            const actStreams = actualByPage.get(pageNum) || [];

            console.log(`  Page ${pageNum}:`);

            for (let i = 0; i < Math.max(expStreams.length, actStreams.length); i++) {
                const exp = expStreams[i];
                const act = actStreams[i];

                if (!exp || !act) {
                    const status = 'DIFFER';
                    console.log(`    Stream ${i}: ${formatStatus(status)} ${exp ? 'MISSING in actual' : 'EXTRA in actual'}`);
                    hasIssues = true;
                    continue;
                }

                // Compare hash
                let contentStatus = /** @type {ComparisonStatus} */ ('DIFFER');
                let contentDetail = '';

                if (exp.hash === act.hash) {
                    contentStatus = 'MATCH';
                    contentDetail = 'identical';
                } else {
                    // Compare sizes
                    const sizeDiff = Math.abs(exp.uncompressedSize - act.uncompressedSize);
                    const sizePercent = exp.uncompressedSize > 0 ? sizeDiff / exp.uncompressedSize : 1;
                    if (sizePercent < 0.05) {
                        contentStatus = 'SIMILAR';
                        contentDetail = `size ${(sizePercent * 100).toFixed(1)}% diff`;
                    } else {
                        contentDetail = `size ${(sizePercent * 100).toFixed(1)}% diff`;
                    }
                }

                // Compare color operators
                const opDiffs = [];
                for (const [op, expCount] of Object.entries(exp.colorOperators)) {
                    const actCount = act.colorOperators[op] || 0;
                    if (expCount !== actCount) {
                        opDiffs.push(`${op}: ${expCount}→${actCount}`);
                    }
                }

                if (opDiffs.length > 0 && contentStatus === 'MATCH') {
                    contentStatus = 'SIMILAR';
                }

                if (contentStatus === 'DIFFER') hasIssues = true;

                console.log(`    Stream ${i}: ${formatStatus(contentStatus)} ${formatSize(exp.uncompressedSize)}→${formatSize(act.uncompressedSize)} (${contentDetail})`);

                if (opDiffs.length > 0) {
                    console.log(`      Operator diffs: ${opDiffs.join(', ')}`);
                }

                if ((verbose || contentStatus === 'DIFFER') && showSamples) {
                    if (exp.sampleValues && exp.sampleValues.length > 0 && act.sampleValues && act.sampleValues.length > 0) {
                        console.log('      Sample k values (first 5):');
                        for (let j = 0; j < Math.min(5, Math.max(exp.sampleValues.length, act.sampleValues.length)); j++) {
                            const expVal = exp.sampleValues[j] || '-';
                            const actVal = act.sampleValues[j] || '-';
                            const match = expVal === actVal ? '=' : '≠';
                            console.log(`        ${expVal} ${match} ${actVal}`);
                        }
                    }
                }
            }
        }
    }
    console.log('');

    // ─────────────────────────────────────────────────────────────────────────
    // Summary
    // ─────────────────────────────────────────────────────────────────────────
    console.log('═'.repeat(80));
    if (hasIssues) {
        console.log('Result: \x1b[31mDIFFERENCES FOUND\x1b[0m - Review issues above');
    } else {
        console.log('Result: \x1b[32mNO SIGNIFICANT DIFFERENCES\x1b[0m');
    }
    console.log('═'.repeat(80));

    return hasIssues;
}

// ============================================================================
// Main
// ============================================================================

async function main() {
    const args = argv.slice(2);
    const options = parseArgs(args);

    // Validate arguments
    if (!options.expectedPath || !options.actualPath) {
        console.error('Error: Two PDF paths are required.');
        console.error('Usage: node compare-pdf-color.js <expected.pdf> <actual.pdf> [options]');
        console.error('Use --help for more options.');
        exit(1);
    }

    // Resolve paths
    const expectedPath = resolve(process.cwd(), options.expectedPath);
    const actualPath = resolve(process.cwd(), options.actualPath);

    if (!existsSync(expectedPath)) {
        console.error(`Error: Expected PDF not found: ${options.expectedPath}`);
        console.error(`  Resolved to: ${expectedPath}`);
        exit(1);
    }
    if (!existsSync(actualPath)) {
        console.error(`Error: Actual PDF not found: ${options.actualPath}`);
        console.error(`  Resolved to: ${actualPath}`);
        exit(1);
    }

    console.log('Analyzing expected PDF...');
    const expectedAnalysis = await analyzePDF(expectedPath, options.sampleRate);

    console.log('Analyzing actual PDF...');
    const actualAnalysis = await analyzePDF(actualPath, options.sampleRate);

    console.log('');

    const hasIssues = await comparePDFs(expectedAnalysis, actualAnalysis, options.verbose, options.showSamples);

    exit(hasIssues ? 1 : 0);
}

main().catch(error => {
    console.error('Error:', error.message);
    if (process.env.DEBUG) {
        console.error(error.stack);
    }
    exit(1);
});
