#!/usr/bin/env node
// @ts-check
/**
 * Analyze PDF Structure Script
 *
 * Analyzes and compares PDF document structures using pdf-lib. Enumerates objects,
 * resources, images, and content stream operators with sophisticated resource tracking.
 *
 * Key Design Principles:
 * 1. Resources are defined once, used many times - Track resource references across pages
 * 2. Aliases vary across pages - Same resource (PDFRef) can have different names on different pages
 * 3. Reference correlation - Show PDFRef identifiers to correlate reused resources
 * 4. Duplication detection - Distinguish between same/different PDFRef with same/different content
 *
 * IMPORTANT: This script behaves like a standard CLI tool.
 * - All paths are resolved RELATIVE TO CWD
 * - Run from the experiments directory: testing/iso/ptf/2025/experiments/
 */

// =============================================================================
// AGENT RESTRICTIONS - READ BEFORE MODIFYING
// =============================================================================
//
// This script intentionally uses SIMPLE CWD-RELATIVE path resolution.
// DO NOT add any of the following "magic" path resolution patterns.
// See matrix-benchmark.js for detailed explanation.
//
// =============================================================================

import { parseArgs } from 'node:util';
import { readFile, stat } from 'fs/promises';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join, resolve, basename } from 'path';
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

// Script location
const __dirname = dirname(fileURLToPath(import.meta.url));

// ============================================================================
// CLI Argument Parsing
// ============================================================================

const { values, positionals } = parseArgs({
    args: process.argv.slice(2).filter(arg => arg.length > 0),
    allowPositionals: true,
    options: {
        'compare': { type: 'boolean', default: false },
        'view': { type: 'string', default: 'resource-to-page' },
        'page': { type: 'string' },
        'show-images': { type: 'boolean', default: false },
        'show-colorspaces': { type: 'boolean', default: false },
        'show-operators': { type: 'boolean', default: false },
        'show-fonts': { type: 'boolean', default: false },
        'show-xobjects': { type: 'boolean', default: false },
        'show-duplicates': { type: 'boolean', default: false },
        'show-unused': { type: 'boolean', default: false },
        'show-all': { type: 'boolean', default: false },
        'show-bitdepths': { type: 'boolean', default: false },
        'show-masks': { type: 'boolean', default: false },
        'show-placement': { type: 'boolean', default: false },
        'show-endianness': { type: 'boolean', default: false },
        'verbose': { type: 'boolean', short: 'v', default: false },
        'help': { type: 'boolean', short: 'h', default: false },
    }
});

const pdfPaths = positionals;
const compareMode = values['compare'] ?? false;
const viewMode = values['view'] ?? 'resource-to-page';
const targetPage = values['page'] ? parseInt(values['page'], 10) : null;
const showImages = values['show-images'] ?? values['show-all'] ?? false;
const showColorSpaces = values['show-colorspaces'] ?? values['show-all'] ?? false;
const showOperators = values['show-operators'] ?? values['show-all'] ?? false;
const showFonts = values['show-fonts'] ?? values['show-all'] ?? false;
const showXObjects = values['show-xobjects'] ?? values['show-all'] ?? false;
const showDuplicates = values['show-duplicates'] ?? values['show-all'] ?? false;
const showUnused = values['show-unused'] ?? values['show-all'] ?? false;
const showBitdepths = values['show-bitdepths'] ?? false;
const showMasks = values['show-masks'] ?? false;
const showPlacement = values['show-placement'] ?? false;
const showEndianness = values['show-endianness'] ?? false;
const verbose = values['verbose'] ?? false;

// If no specific show flags, default to showing colorspaces and images
const defaultShow = !showImages && !showColorSpaces && !showOperators && !showFonts && !showXObjects;

// ============================================================================
// Help
// ============================================================================

if (values.help || pdfPaths.length === 0) {
    console.log(`
Analyze PDF Structure Script

Analyzes PDF document structures, tracking resources across pages.

Usage:
  node analyze-pdf-structure.js <pdf> [pdf2] [options]

Arguments:
  <pdf>                     Input PDF path(s) - one for analysis, two for comparison

Options:
  --compare                 Compare two PDFs and show differences
  --view <mode>             Output view mode:
                            - resource-to-page (default): List pages per resource
                            - page-to-resource: List resources per page
                            - tree: Hierarchical resource tree
                            - flat: Simple flat list
  --page <n>                Analyze specific page (1-indexed, default: all)
  --show-images             List images (width, height, BPC, colorSpace, filter, size)
  --show-colorspaces        List ColorSpace resources (ICCBased, Separation, Lab, etc.)
  --show-operators          Count content stream color operators
  --show-fonts              List Font resources
  --show-xobjects           List XObject resources
  --show-duplicates         Analyze and report resource duplication
  --show-unused             List defined but unreferenced resources
  --show-all                Enable all --show-* options
  --show-bitdepths          Show BitsPerComponent summary for all images
  --show-masks              Show SMask, Mask, ImageMask properties per image
  --show-placement          Show CTM and placement context for each image Do operator
  --show-endianness         Show first bytes of 16-bit image data with byte ordering
  --verbose, -v             Show all details including PDFRef identifiers
  --help, -h                Show this help message

Examples:
  # Analyze PDF with default resource-centric view
  node analyze-pdf-structure.js \\
      "../tests/fixtures/pdfs/2025-08-15 - ConRes - ISO PTF - CR1 - Type Sizes and Lissajou.pdf"

  # Page-centric view with all details
  node analyze-pdf-structure.js \\
      "../tests/fixtures/pdfs/source.pdf" \\
      --view page-to-resource \\
      --show-all

  # Compare two PDFs
  node analyze-pdf-structure.js \\
      "../tests/fixtures/pdfs/source.pdf" \\
      "./output/converted.pdf" \\
      --compare

  # Analyze specific page with duplication detection
  node analyze-pdf-structure.js \\
      "../tests/fixtures/pdfs/source.pdf" \\
      --page 4 \\
      --show-duplicates
`);
    process.exit(values.help ? 0 : 1);
}

// ============================================================================
// Path Resolution
// ============================================================================

/**
 * @param {string} userPath
 * @param {string} pathType
 * @returns {string}
 */
function resolvePath(userPath, pathType) {
    const absolutePath = resolve(process.cwd(), userPath);
    if (!existsSync(absolutePath)) {
        throw new Error(`${pathType} not found: ${userPath}\n  Resolved to: ${absolutePath}`);
    }
    return absolutePath;
}

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * @typedef {{
 *   type: string,
 *   colorantName?: string,
 *   alternate?: string,
 *   nComponents?: number,
 *   profileDescription?: string,
 *   whitepoint?: number[],
 * }} ColorSpaceInfo
 */

/**
 * @typedef {{
 *   width: number,
 *   height: number,
 *   bpc: number,
 *   colorSpace: string,
 *   filter: string,
 *   size: number,
 *   hash?: string,
 * }} ImageInfo
 */

/**
 * @typedef {{
 *   ref: string,
 *   info: ColorSpaceInfo | ImageInfo | { type: string },
 *   aliases: Map<number, string[]>,  // pageNum -> alias names
 *   usedOnPages: Set<number>,
 * }} ResourceRecord
 */

/**
 * @typedef {{
 *   colorSpaces: Map<string, ResourceRecord>,
 *   images: Map<string, ResourceRecord>,
 *   fonts: Map<string, ResourceRecord>,
 *   xobjects: Map<string, ResourceRecord>,
 *   operatorCounts: Map<number, Record<string, number>>,
 * }} PDFAnalysis
 */

// ============================================================================
// Resource Extraction
// ============================================================================

/**
 * Extract color space info from array descriptor
 * @param {PDFArray} arr
 * @param {import('pdf-lib').PDFContext} context
 * @returns {ColorSpaceInfo}
 */
function extractColorSpaceInfo(arr, context) {
    const firstElement = arr.get(0);
    if (!(firstElement instanceof PDFName)) {
        return { type: 'unknown' };
    }

    const type = firstElement.decodeText();
    /** @type {ColorSpaceInfo} */
    const info = { type };

    if (type === 'Separation' && arr.size() >= 2) {
        const colorant = arr.get(1);
        if (colorant instanceof PDFName) {
            info.colorantName = colorant.decodeText();
        }
        if (arr.size() >= 3) {
            const alternate = arr.get(2);
            if (alternate instanceof PDFName) {
                info.alternate = alternate.decodeText();
            } else if (alternate instanceof PDFArray && alternate.size() > 0) {
                const altFirst = alternate.get(0);
                if (altFirst instanceof PDFName) {
                    info.alternate = altFirst.decodeText();
                }
            }
        }
    }

    if (type === 'ICCBased' && arr.size() > 1) {
        const profileRef = arr.get(1);
        const profileStream = profileRef instanceof PDFRef
            ? context.lookup(profileRef)
            : profileRef;
        if (profileStream instanceof PDFRawStream) {
            const nValue = profileStream.dict.get(PDFName.of('N'));
            if (nValue && typeof nValue.asNumber === 'function') {
                info.nComponents = nValue.asNumber();
            }
            try {
                const decoded = decodePDFRawStream(profileStream).decode();
                const descBytes = decoded.slice(128, 500);
                const descStr = new TextDecoder('ascii', { fatal: false }).decode(descBytes);
                const descMatch = descStr.match(/desc.*?([A-Za-z0-9 ._-]{4,})/);
                if (descMatch) {
                    info.profileDescription = descMatch[1].trim();
                }
            } catch (e) {
                // Ignore
            }
        }
    }

    if (type === 'Lab') {
        info.nComponents = 3;
        // Try to extract whitepoint
        if (arr.size() > 1) {
            const dictRef = arr.get(1);
            const dict = dictRef instanceof PDFRef ? context.lookup(dictRef) : dictRef;
            if (dict instanceof PDFDict) {
                const wp = dict.get(PDFName.of('WhitePoint'));
                if (wp instanceof PDFArray) {
                    info.whitepoint = [];
                    for (let i = 0; i < wp.size(); i++) {
                        const val = wp.get(i);
                        if (val && typeof val.asNumber === 'function') {
                            info.whitepoint.push(val.asNumber());
                        }
                    }
                }
            }
        }
    }

    return info;
}

/**
 * Extract image info from stream
 * @param {PDFRawStream} stream
 * @param {import('pdf-lib').PDFContext} context
 * @returns {ImageInfo}
 */
function extractImageInfo(stream, context) {
    const dict = stream.dict;

    const width = dict.get(PDFName.of('Width'))?.asNumber?.() ?? 0;
    const height = dict.get(PDFName.of('Height'))?.asNumber?.() ?? 0;
    const bpc = dict.get(PDFName.of('BitsPerComponent'))?.asNumber?.() ?? 8;

    let colorSpace = 'Unknown';
    const csEntry = dict.get(PDFName.of('ColorSpace'));
    if (csEntry instanceof PDFName) {
        colorSpace = csEntry.decodeText();
    } else if (csEntry instanceof PDFRef) {
        const resolved = context.lookup(csEntry);
        if (resolved instanceof PDFName) {
            colorSpace = resolved.decodeText();
        } else if (resolved instanceof PDFArray && resolved.size() > 0) {
            const first = resolved.get(0);
            if (first instanceof PDFName) {
                colorSpace = first.decodeText();
            }
        }
    } else if (csEntry instanceof PDFArray && csEntry.size() > 0) {
        const first = csEntry.get(0);
        if (first instanceof PDFName) {
            colorSpace = first.decodeText();
        }
    }

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

    const size = stream.contents?.length ?? 0;

    // Mask properties (extracted when --show-masks is active)
    const smaskRef = dict.get(PDFName.of('SMask'));
    const maskEntry = dict.get(PDFName.of('Mask'));
    const imageMaskVal = dict.get(PDFName.of('ImageMask'));
    const hasSMask = smaskRef instanceof PDFRef;
    const hasMask = maskEntry !== undefined;
    const isImageMask = imageMaskVal?.toString() === 'true';

    // Raw contents reference for endianness inspection
    const contents = stream.contents;

    return { width, height, bpc, colorSpace, filter, size, hasSMask, hasMask, isImageMask, smaskRef, contents };
}

/**
 * Analyze a single PDF document
 * @param {PDFDocument} pdfDoc
 * @returns {PDFAnalysis}
 */
function analyzePDF(pdfDoc) {
    const context = pdfDoc.context;
    const pages = pdfDoc.getPages();

    /** @type {PDFAnalysis} */
    const analysis = {
        colorSpaces: new Map(),
        images: new Map(),
        fonts: new Map(),
        xobjects: new Map(),
        operatorCounts: new Map(),
        _pdfDoc: showPlacement ? pdfDoc : undefined,
    };

    // Analyze each page
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
        if (!(resourcesDict instanceof PDFDict)) continue;

        // ColorSpaces
        const colorSpaceEntry = resourcesDict.get(PDFName.of('ColorSpace'));
        let colorSpaceDict = colorSpaceEntry;
        if (colorSpaceEntry instanceof PDFRef) {
            colorSpaceDict = context.lookup(colorSpaceEntry);
        }
        if (colorSpaceDict instanceof PDFDict) {
            for (const [key, value] of colorSpaceDict.entries()) {
                const alias = key.decodeText();

                // Get the actual ref
                let actualRef = value;
                let refStr = '';
                if (value instanceof PDFRef) {
                    refStr = `${value.objectNumber} ${value.generationNumber} R`;
                    actualRef = context.lookup(value);
                } else {
                    // Inline definition - use alias as pseudo-ref
                    refStr = `inline:${alias}`;
                }

                // Extract info
                let info = { type: 'unknown' };
                if (actualRef instanceof PDFName) {
                    info = { type: actualRef.decodeText() };
                } else if (actualRef instanceof PDFArray) {
                    info = extractColorSpaceInfo(actualRef, context);
                }

                // Add to map
                if (!analysis.colorSpaces.has(refStr)) {
                    analysis.colorSpaces.set(refStr, {
                        ref: refStr,
                        info,
                        aliases: new Map(),
                        usedOnPages: new Set(),
                    });
                }
                const record = analysis.colorSpaces.get(refStr);
                if (!record.aliases.has(pageNum)) {
                    record.aliases.set(pageNum, []);
                }
                record.aliases.get(pageNum).push(alias);
                record.usedOnPages.add(pageNum);
            }
        }

        // XObjects (includes images)
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
                        const info = extractImageInfo(actualRef, context);
                        if (!analysis.images.has(refStr)) {
                            analysis.images.set(refStr, {
                                ref: refStr,
                                info,
                                aliases: new Map(),
                                usedOnPages: new Set(),
                            });
                        }
                        const record = analysis.images.get(refStr);
                        if (!record.aliases.has(pageNum)) {
                            record.aliases.set(pageNum, []);
                        }
                        record.aliases.get(pageNum).push(alias);
                        record.usedOnPages.add(pageNum);
                    } else {
                        // Other XObject (Form, etc.)
                        const typeStr = subtype instanceof PDFName ? subtype.decodeText() : 'unknown';
                        if (!analysis.xobjects.has(refStr)) {
                            analysis.xobjects.set(refStr, {
                                ref: refStr,
                                info: { type: typeStr },
                                aliases: new Map(),
                                usedOnPages: new Set(),
                            });
                        }
                        const record = analysis.xobjects.get(refStr);
                        if (!record.aliases.has(pageNum)) {
                            record.aliases.set(pageNum, []);
                        }
                        record.aliases.get(pageNum).push(alias);
                        record.usedOnPages.add(pageNum);
                    }
                }
            }
        }

        // Fonts
        const fontEntry = resourcesDict.get(PDFName.of('Font'));
        let fontDict = fontEntry;
        if (fontEntry instanceof PDFRef) {
            fontDict = context.lookup(fontEntry);
        }
        if (fontDict instanceof PDFDict) {
            for (const [key, value] of fontDict.entries()) {
                const alias = key.decodeText();

                let refStr = '';
                if (value instanceof PDFRef) {
                    refStr = `${value.objectNumber} ${value.generationNumber} R`;
                } else {
                    refStr = `inline:${alias}`;
                }

                if (!analysis.fonts.has(refStr)) {
                    analysis.fonts.set(refStr, {
                        ref: refStr,
                        info: { type: 'Font' },
                        aliases: new Map(),
                        usedOnPages: new Set(),
                    });
                }
                const record = analysis.fonts.get(refStr);
                if (!record.aliases.has(pageNum)) {
                    record.aliases.set(pageNum, []);
                }
                record.aliases.get(pageNum).push(alias);
                record.usedOnPages.add(pageNum);
            }
        }

        // Content stream operator counts
        if (showOperators || defaultShow) {
            const counts = countOperators(pageNode, context);
            analysis.operatorCounts.set(pageNum, counts);
        }
    }

    return analysis;
}

/**
 * Count color operators in content stream
 * @param {PDFPageLeaf} pageNode
 * @param {import('pdf-lib').PDFContext} context
 * @returns {Record<string, number>}
 */
function countOperators(pageNode, context) {
    const counts = {
        'cs/CS': 0,
        'scn/SCN': 0,
        'g/G': 0,
        'rg/RG': 0,
        'k/K': 0,
    };

    const contents = pageNode.get(PDFName.of('Contents'));
    /** @type {PDFRef[]} */
    const streamRefs = [];

    if (contents instanceof PDFRef) {
        streamRefs.push(contents);
    } else if (contents instanceof PDFArray) {
        for (let i = 0; i < contents.size(); i++) {
            const ref = contents.get(i);
            if (ref instanceof PDFRef) {
                streamRefs.push(ref);
            }
        }
    }

    for (const ref of streamRefs) {
        const stream = context.lookup(ref);
        if (!(stream instanceof PDFRawStream)) continue;

        try {
            const decoded = decodePDFRawStream(stream).decode();
            const text = new TextDecoder().decode(decoded);

            counts['cs/CS'] += (text.match(/\b(cs|CS)\b/g) || []).length;
            counts['scn/SCN'] += (text.match(/\b(scn|SCN|sc|SC)\b/g) || []).length;
            counts['g/G'] += (text.match(/\b(g|G)\b/g) || []).length;
            counts['rg/RG'] += (text.match(/\b(rg|RG)\b/g) || []).length;
            counts['k/K'] += (text.match(/\b(k|K)\b/g) || []).length;
        } catch (e) {
            // Ignore
        }
    }

    return counts;
}

// ============================================================================
// Output Formatting
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
 * Format color space info for display
 * @param {ColorSpaceInfo} info
 * @returns {string}
 */
function formatColorSpaceInfo(info) {
    let result = info.type;
    if (info.type === 'Separation' && info.colorantName) {
        result += ` (${info.colorantName})`;
        if (info.alternate) result += ` → ${info.alternate}`;
    } else if (info.type === 'ICCBased') {
        if (info.nComponents) result += ` (${info.nComponents} ch)`;
        if (info.profileDescription) result += ` [${info.profileDescription}]`;
    } else if (info.type === 'Lab') {
        if (info.whitepoint) {
            result += ` (D${info.whitepoint[0] === 0.9642 ? '50' : 'XX'})`;
        }
    }
    return result;
}

/**
 * Format image info for display
 * @param {ImageInfo} info
 * @returns {string}
 */
function formatImageInfo(info) {
    return `${info.width}×${info.height}, ${info.bpc} BPC, ${info.colorSpace}, ${info.filter}, ${formatSize(info.size)}`;
}

/**
 * Print resource-to-page view
 * @param {PDFAnalysis} analysis
 * @param {string} fileName
 * @param {number} pageCount
 */
async function printResourceToPageView(analysis, fileName, pageCount) {
    console.log(`=== PDF Structure: ${fileName} ===`);
    console.log(`Pages: ${pageCount}`);
    console.log('');

    // ColorSpaces
    if (showColorSpaces || defaultShow) {
        console.log(`ColorSpace Resources (${analysis.colorSpaces.size} unique):`);
        if (analysis.colorSpaces.size === 0) {
            console.log('  (none)');
        } else {
            for (const [refStr, record] of analysis.colorSpaces) {
                const info = /** @type {ColorSpaceInfo} */ (record.info);
                console.log(`  ${verbose ? refStr + ': ' : ''}${formatColorSpaceInfo(info)}`);

                // Print aliases per page
                const pageEntries = Array.from(record.aliases.entries()).sort((a, b) => a[0] - b[0]);
                for (let i = 0; i < pageEntries.length; i++) {
                    const [pageNum, aliases] = pageEntries[i];
                    const connector = i === pageEntries.length - 1 ? '└─' : '├─';
                    const aliasStr = aliases.map(a => '/' + a).join(', ');
                    const reusedNote = record.usedOnPages.size > 1 && i > 0 ? ' ← reused' : '';
                    console.log(`    ${connector} Page ${pageNum}: ${aliasStr}${reusedNote}`);
                }
            }
        }
        console.log('');
    }

    // Bit depth summary
    if (showBitdepths && analysis.images.size > 0) {
        /** @type {Map<number, number>} */
        const bpcCounts = new Map();
        for (const [, record] of analysis.images) {
            const bpc = /** @type {ImageInfo} */ (record.info).bpc;
            bpcCounts.set(bpc, (bpcCounts.get(bpc) ?? 0) + 1);
        }
        console.log('BitsPerComponent Summary:');
        for (const [bpc, count] of [...bpcCounts.entries()].sort((a, b) => a[0] - b[0])) {
            console.log(`  ${bpc} BPC: ${count} image${count !== 1 ? 's' : ''}`);
        }
        console.log('');
    }

    // Images
    if (showImages || defaultShow) {
        console.log(`Images (${analysis.images.size} unique):`);
        if (analysis.images.size === 0) {
            console.log('  (none)');
        } else {
            for (const [refStr, record] of analysis.images) {
                const info = /** @type {ImageInfo} */ (record.info);
                console.log(`  ${verbose ? refStr + ': ' : ''}${formatImageInfo(info)}`);

                // --show-masks: display mask properties
                if (showMasks) {
                    const maskParts = [];
                    if (info.isImageMask) maskParts.push('ImageMask=true');
                    if (info.hasSMask) maskParts.push(`SMask=${info.smaskRef}`);
                    if (info.hasMask) maskParts.push('Mask=present');
                    if (maskParts.length > 0) {
                        console.log(`    [masks] ${maskParts.join(', ')}`);
                    }
                }

                // --show-endianness: show first bytes for 16-bit images
                if (showEndianness && info.bpc === 16 && info.contents) {
                    try {
                        const pako = await import('pako');
                        const raw = info.filter.includes('FlateDecode')
                            ? pako.inflate(info.contents)
                            : info.contents;
                        const preview = Array.from(raw.slice(0, 12)).map(b => b.toString(16).padStart(2, '0')).join(' ');
                        console.log(`    [endianness] First 12 bytes: ${preview} (PDF 16-bit = big-endian)`);
                    } catch { /* skip if decompression fails */ }
                }

                const pageEntries = Array.from(record.aliases.entries()).sort((a, b) => a[0] - b[0]);
                for (let i = 0; i < pageEntries.length; i++) {
                    const [pageNum, aliases] = pageEntries[i];
                    const connector = i === pageEntries.length - 1 ? '└─' : '├─';
                    const aliasStr = aliases.map(a => '/' + a).join(', ');
                    const reusedNote = record.usedOnPages.size > 1 && i > 0 ? ' ← reused' : '';
                    console.log(`    ${connector} Page ${pageNum}: ${aliasStr}${reusedNote}`);
                }
            }
        }
        console.log('');
    }

    // Image placement
    if (showPlacement) {
        console.log('Image Placement (CTM context per Do operator):');
        console.log('  Note: For detailed CTM tracing, use internal/analyze-image-masking.mjs');
        // Parse content streams for Do operators and preceding cm operators
        const pdfDoc = analysis._pdfDoc;
        if (pdfDoc) {
            const pages = pdfDoc.getPages();
            for (let pageIdx = 0; pageIdx < pages.length; pageIdx++) {
                const page = pages[pageIdx];
                const pageDict = pdfDoc.context.lookup(page.ref);
                if (!(pageDict instanceof PDFDict)) continue;
                const contentsEntry = pageDict.get(PDFName.of('Contents'));
                if (!contentsEntry) continue;

                const refs = contentsEntry instanceof PDFArray
                    ? Array.from({ length: contentsEntry.size() }, (_, i) => contentsEntry.get(i))
                    : [contentsEntry];

                for (const ref of refs) {
                    if (!(ref instanceof PDFRef)) continue;
                    const stream = pdfDoc.context.lookup(ref);
                    if (!(stream instanceof PDFRawStream)) continue;
                    const decoded = decodePDFRawStream(stream).decode();
                    const text = typeof decoded === 'string' ? decoded : new TextDecoder('latin1').decode(decoded);

                    // Find Do operators with preceding cm
                    const doPattern = /(?:([0-9.e+-]+\s+[0-9.e+-]+\s+[0-9.e+-]+\s+[0-9.e+-]+\s+[0-9.e+-]+\s+[0-9.e+-]+)\s+cm\s+)?\/(\w+)\s+Do/g;
                    let match;
                    while ((match = doPattern.exec(text)) !== null) {
                        const ctm = match[1] ? `cm [${match[1].trim()}]` : 'no cm';
                        console.log(`  Page ${pageIdx + 1}: /${match[2]} Do (${ctm})`);
                    }
                }
            }
        }
        console.log('');
    }

    // Fonts
    if (showFonts) {
        console.log(`Fonts (${analysis.fonts.size} unique):`);
        if (analysis.fonts.size === 0) {
            console.log('  (none)');
        } else {
            for (const [refStr, record] of analysis.fonts) {
                const pageList = Array.from(record.usedOnPages).sort((a, b) => a - b).join(', ');
                console.log(`  ${verbose ? refStr + ': ' : ''}Used on pages ${pageList}`);
            }
        }
        console.log('');
    }

    // XObjects
    if (showXObjects) {
        console.log(`XObjects (${analysis.xobjects.size} unique):`);
        if (analysis.xobjects.size === 0) {
            console.log('  (none)');
        } else {
            for (const [refStr, record] of analysis.xobjects) {
                const info = record.info;
                const typeStr = 'type' in info ? info.type : 'unknown';
                const pageList = Array.from(record.usedOnPages).sort((a, b) => a - b).join(', ');
                console.log(`  ${verbose ? refStr + ': ' : ''}${typeStr} (pages ${pageList})`);
            }
        }
        console.log('');
    }

    // Operator counts
    if (showOperators || defaultShow) {
        console.log('Color Operators by Page:');
        for (const [pageNum, counts] of Array.from(analysis.operatorCounts.entries()).sort((a, b) => a[0] - b[0])) {
            const parts = Object.entries(counts)
                .filter(([_, v]) => v > 0)
                .map(([k, v]) => `${k}: ${v}`);
            console.log(`  Page ${pageNum}: ${parts.join(', ') || '(none)'}`);
        }
        console.log('');
    }
}

/**
 * Print page-to-resource view
 * @param {PDFAnalysis} analysis
 * @param {string} fileName
 * @param {number} pageCount
 */
function printPageToResourceView(analysis, fileName, pageCount) {
    console.log(`=== PDF Structure: ${fileName} ===`);
    console.log('');

    for (let pageNum = 1; pageNum <= pageCount; pageNum++) {
        if (targetPage && pageNum !== targetPage) continue;

        console.log(`Page ${pageNum}:`);

        // ColorSpaces for this page
        if (showColorSpaces || defaultShow) {
            console.log('  ColorSpaces:');
            let found = false;
            for (const [refStr, record] of analysis.colorSpaces) {
                if (!record.aliases.has(pageNum)) continue;
                found = true;
                const aliases = record.aliases.get(pageNum) || [];
                const info = /** @type {ColorSpaceInfo} */ (record.info);
                for (const alias of aliases) {
                    const refNote = verbose ? ` → ${refStr}` : '';
                    const reusedNote = record.usedOnPages.size > 1 ? ' ← shared' : '';
                    console.log(`    /${alias}${refNote}: ${formatColorSpaceInfo(info)}${reusedNote}`);
                }
            }
            if (!found) console.log('    (none)');
        }

        // Images for this page
        if (showImages || defaultShow) {
            console.log('  Images:');
            let found = false;
            for (const [refStr, record] of analysis.images) {
                if (!record.aliases.has(pageNum)) continue;
                found = true;
                const aliases = record.aliases.get(pageNum) || [];
                const info = /** @type {ImageInfo} */ (record.info);
                for (const alias of aliases) {
                    const refNote = verbose ? ` → ${refStr}` : '';
                    const reusedNote = record.usedOnPages.size > 1 ? ' ← shared' : '';
                    console.log(`    /${alias}${refNote}: ${formatImageInfo(info)}${reusedNote}`);
                }
            }
            if (!found) console.log('    (none)');
        }

        // Operators for this page
        if (showOperators || defaultShow) {
            const counts = analysis.operatorCounts.get(pageNum);
            if (counts) {
                const parts = Object.entries(counts)
                    .filter(([_, v]) => v > 0)
                    .map(([k, v]) => `${k}: ${v}`);
                console.log(`  Operators: ${parts.join(', ') || '(none)'}`);
            }
        }

        console.log('');
    }
}

// ============================================================================
// Main
// ============================================================================

async function main() {
    if (pdfPaths.length < 1) {
        throw new Error('At least one PDF path is required');
    }

    const resolvedPath1 = resolvePath(pdfPaths[0], 'PDF');
    const pdfBytes1 = await readFile(resolvedPath1);
    const pdfDoc1 = await PDFDocument.load(pdfBytes1);
    const fileName1 = basename(resolvedPath1);

    const fileStats = await stat(resolvedPath1);
    console.log('═'.repeat(80));
    console.log(`File: ${fileName1}`);
    console.log(`Size: ${formatSize(fileStats.size)}`);
    console.log(`Pages: ${pdfDoc1.getPageCount()}`);
    console.log('═'.repeat(80));
    console.log('');

    const analysis1 = analyzePDF(pdfDoc1);

    // Output based on view mode
    if (viewMode === 'page-to-resource') {
        printPageToResourceView(analysis1, fileName1, pdfDoc1.getPageCount());
    } else {
        await printResourceToPageView(analysis1, fileName1, pdfDoc1.getPageCount());
    }

    // Duplication analysis
    if (showDuplicates) {
        console.log('─'.repeat(80));
        console.log('Duplication Analysis');
        console.log('─'.repeat(80));
        console.log('');

        // Check for duplicate images by size and dimensions
        const imageSizeMap = new Map();
        for (const [refStr, record] of analysis1.images) {
            const info = /** @type {ImageInfo} */ (record.info);
            const key = `${info.width}×${info.height}×${info.bpc}×${info.size}`;
            if (!imageSizeMap.has(key)) {
                imageSizeMap.set(key, []);
            }
            imageSizeMap.get(key).push(refStr);
        }

        let duplicatesFound = false;
        for (const [key, refs] of imageSizeMap) {
            if (refs.length > 1) {
                duplicatesFound = true;
                console.log(`Potential duplicate images (${key}):`);
                for (const refStr of refs) {
                    console.log(`  ${refStr}`);
                }
            }
        }

        if (!duplicatesFound) {
            console.log('No duplicate resources detected.');
        }
        console.log('');
    }

    // Comparison mode
    if (compareMode && pdfPaths.length >= 2) {
        const resolvedPath2 = resolvePath(pdfPaths[1], 'PDF');
        const pdfBytes2 = await readFile(resolvedPath2);
        const pdfDoc2 = await PDFDocument.load(pdfBytes2);
        const fileName2 = basename(resolvedPath2);

        const fileStats2 = await stat(resolvedPath2);

        console.log('═'.repeat(80));
        console.log('Comparison');
        console.log('═'.repeat(80));
        console.log('');
        console.log(`File 1: ${fileName1} (${formatSize(fileStats.size)}, ${pdfDoc1.getPageCount()} pages)`);
        console.log(`File 2: ${fileName2} (${formatSize(fileStats2.size)}, ${pdfDoc2.getPageCount()} pages)`);
        console.log('');

        const analysis2 = analyzePDF(pdfDoc2);

        // Compare colorspaces
        console.log('ColorSpace differences:');
        const cs1Count = analysis1.colorSpaces.size;
        const cs2Count = analysis2.colorSpaces.size;
        console.log(`  File 1: ${cs1Count} unique color spaces`);
        console.log(`  File 2: ${cs2Count} unique color spaces`);
        console.log('');

        // Compare images
        console.log('Image differences:');
        const img1Count = analysis1.images.size;
        const img2Count = analysis2.images.size;
        console.log(`  File 1: ${img1Count} unique images`);
        console.log(`  File 2: ${img2Count} unique images`);
        console.log('');
    }

    console.log('Done.');
}

main().catch(err => {
    console.error('Error:', err.message);
    if (verbose) {
        console.error(err.stack);
    }
    process.exit(1);
});
