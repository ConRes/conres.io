// @ts-check
/**
 * Content Stream Color Extractor
 *
 * Extracts color operations from PDF content streams for changes verification.
 * Uses the shared content-stream-parser for consistent operator indexing.
 *
 * Extracted from generate-verification-matrix.mjs for reuse in compare-pdf-outputs.js.
 *
 * @module ContentStreamColorExtractor
 */

import { readFile } from 'fs/promises';
import {
    PDFDocument,
    PDFRawStream,
    PDFArray,
    PDFName,
    PDFRef,
    PDFDict,
    decodePDFRawStream,
} from '../../packages/pdf-lib/pdf-lib.esm.js';

import { parseContentStream, getColorOperations } from './content-stream-parser.mjs';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * A color match found in a content stream.
 * @typedef {{
 *   pageNum: number,
 *   streamIndex: number,
 *   operatorIndex: number,
 *   operator: string,
 *   colorspace: string,
 *   values: number[],
 *   index: number,
 * }} ColorMatch
 */

/**
 * Input color specification (exact match, no tolerances).
 * @typedef {{
 *   colorspace: string,
 *   values: number[],
 * }} ColorInputSpec
 */

/**
 * Color space definition extracted from page resources.
 * @typedef {{
 *   colorSpaceType: string,
 *   range?: number[],
 * }} ColorSpaceDefinition
 */

// ============================================================================
// ContentStreamColorExtractor Class
// ============================================================================

/**
 * Extracts and matches color operations from PDF content streams.
 *
 * Provides static methods for:
 * - Extracting all color operations from a PDF
 * - Finding colors that match a given specification
 * - Extracting colorspace definitions from page resources
 */
export class ContentStreamColorExtractor {
    // ========================================
    // Main Extraction Methods
    // ========================================

    /**
     * Extract all color operations from a PDF's content streams.
     * Uses content-stream-parser for correct positional matching with
     * colorspace state tracking for correct colorspace names.
     *
     * @param {string} pdfPath - Path to PDF file
     * @returns {Promise<ColorMatch[]>} Array of color matches with positions
     */
    static async extractColors(pdfPath) {
        const pdfBytes = await readFile(pdfPath);
        const pdfDoc = await PDFDocument.load(pdfBytes);
        const context = pdfDoc.context;
        const pages = pdfDoc.getPages();

        /** @type {ColorMatch[]} */
        const matches = [];

        for (let pageIdx = 0; pageIdx < pages.length; pageIdx++) {
            const pageNum = pageIdx + 1;
            const page = pages[pageIdx];
            const pageNode = /** @type {import('pdf-lib').PDFPageLeaf} */ (page.node);
            const pageDict = /** @type {PDFDict} */ (pageNode);

            // Extract colorspace definitions from page Resources
            const colorSpaceDefinitions = ContentStreamColorExtractor.extractColorSpaceDefinitions(pageDict, context);

            // Get content streams
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

            // Track colorspace state across streams (PDF graphics state carries over)
            /** @type {import('./content-stream-parser.mjs').ColorSpaceState} */
            let colorSpaceState = {};

            for (let streamIdx = 0; streamIdx < streamRefs.length; streamIdx++) {
                const ref = streamRefs[streamIdx];
                const stream = context.lookup(ref);
                if (!(stream instanceof PDFRawStream)) continue;

                try {
                    const decoded = decodePDFRawStream(stream).decode();
                    const text = new TextDecoder().decode(decoded);

                    // Use the shared parser (same logic as PDFContentStreamColorConverter)
                    const parseResult = parseContentStream(text, colorSpaceState);
                    colorSpaceState = parseResult.finalState;

                    // Get only color-setting operations (not colorspace changes)
                    const colorOps = getColorOperations(parseResult.operations);

                    // Assign operator indices and build matches
                    for (let opIdx = 0; opIdx < colorOps.length; opIdx++) {
                        const op = colorOps[opIdx];

                        // Determine colorspace name for display
                        let colorspace;
                        if (op.type === 'gray') {
                            colorspace = 'DeviceGray';
                        } else if (op.type === 'rgb') {
                            colorspace = 'DeviceRGB';
                        } else if (op.type === 'cmyk') {
                            colorspace = 'DeviceCMYK';
                        } else if (op.type === 'indexed' && op.colorSpaceName) {
                            // Look up actual colorspace type from definitions
                            const csDef = colorSpaceDefinitions[op.colorSpaceName];
                            if (csDef) {
                                colorspace = ContentStreamColorExtractor.getDisplayColorspace(csDef.colorSpaceType);
                            } else {
                                // Fallback: infer from value count
                                const values = op.values ?? [];
                                if (values.length === 1) colorspace = 'ICCBasedGray';
                                else if (values.length === 3) colorspace = 'ICCBasedRGB';
                                else if (values.length === 4) colorspace = 'ICCBasedCMYK';
                                else colorspace = 'Unknown';
                            }
                        } else {
                            colorspace = 'Unknown';
                        }

                        matches.push({
                            pageNum,
                            streamIndex: streamIdx,
                            operatorIndex: opIdx,
                            operator: op.operator,
                            colorspace,
                            values: op.values ?? [],
                            index: op.index,
                        });
                    }
                } catch (e) {
                    console.warn(`Failed to decode content stream on page ${pageNum}, stream ${streamIdx}: ${/** @type {Error} */ (e).message}`);
                }
            }
        }

        return matches;
    }

    /**
     * Find colors matching an input specification.
     * Matches colors based on the input colorspace type and values.
     *
     * @param {ColorMatch[]} colors - Colors extracted from PDF
     * @param {ColorInputSpec} inputSpec - Input color specification
     * @returns {ColorMatch[]} Matching colors
     */
    static findMatchingColors(colors, inputSpec) {
        const epsilon = 0.0001; // Very small tolerance for floating point comparison

        return colors.filter(color => {
            // Colorspace must match exactly
            if (color.colorspace !== inputSpec.colorspace) {
                return false;
            }

            // Value count must match
            if (color.values.length !== inputSpec.values.length) {
                return false;
            }

            // Values must match within epsilon
            const valuesMatch = color.values.every((v, i) =>
                Math.abs(v - inputSpec.values[i]) < epsilon
            );

            return valuesMatch;
        });
    }

    // ========================================
    // Colorspace Definition Extraction
    // ========================================

    /**
     * Extract colorspace definitions from a page's Resources.
     * Maps colorspace names (CS0, CS1, etc.) to their actual types.
     *
     * @param {PDFDict} pageDict - Page dictionary
     * @param {import('pdf-lib').PDFContext} context - PDF context
     * @returns {Record<string, ColorSpaceDefinition>}
     */
    static extractColorSpaceDefinitions(pageDict, context) {
        /** @type {Record<string, ColorSpaceDefinition>} */
        const definitions = {};

        const resources = pageDict.get(PDFName.of('Resources'));
        if (!resources) return definitions;

        const resourcesDict = resources instanceof PDFRef
            ? context.lookup(resources)
            : resources;
        if (!(resourcesDict instanceof PDFDict)) return definitions;

        const colorSpaceDict = resourcesDict.get(PDFName.of('ColorSpace'));
        if (!colorSpaceDict) return definitions;

        const csDict = colorSpaceDict instanceof PDFRef
            ? context.lookup(colorSpaceDict)
            : colorSpaceDict;
        if (!(csDict instanceof PDFDict)) return definitions;

        for (const [key, value] of csDict.entries()) {
            const csName = key.asString().replace(/^\//, '');

            let csDescriptor = value;
            if (csDescriptor instanceof PDFRef) {
                csDescriptor = context.lookup(csDescriptor);
            }

            if (csDescriptor instanceof PDFName) {
                const typeName = csDescriptor.asString().replace(/^\//, '');
                definitions[csName] = {
                    colorSpaceType: ContentStreamColorExtractor.normalizeColorSpaceType(typeName),
                };
            } else if (csDescriptor instanceof PDFArray && csDescriptor.size() > 0) {
                const csType = csDescriptor.get(0);
                if (csType instanceof PDFName) {
                    const typeName = csType.asString().replace(/^\//, '');
                    /** @type {ColorSpaceDefinition} */
                    const def = { colorSpaceType: typeName };

                    // Handle ICCBased - extract actual color space from ICC profile header
                    if (typeName === 'ICCBased' && csDescriptor.size() > 1) {
                        const iccRef = csDescriptor.get(1);
                        const iccStream = iccRef instanceof PDFRef
                            ? context.lookup(iccRef)
                            : iccRef;

                        if (iccStream instanceof PDFRawStream) {
                            const profileData = /** @type {Uint8Array} */ (decodePDFRawStream(iccStream).decode());
                            const iccColorSpace = ContentStreamColorExtractor.getICCColorSpace(profileData);
                            def.colorSpaceType = ContentStreamColorExtractor.normalizeColorSpaceType(iccColorSpace);
                        }
                    }
                    // Handle Lab color space
                    else if (typeName === 'Lab' && csDescriptor.size() > 1) {
                        def.colorSpaceType = 'Lab';
                        const labDict = csDescriptor.get(1);
                        const labDictResolved = labDict instanceof PDFRef
                            ? context.lookup(labDict)
                            : labDict;

                        if (labDictResolved instanceof PDFDict) {
                            const rangeArray = labDictResolved.get(PDFName.of('Range'));
                            if (rangeArray instanceof PDFArray) {
                                def.range = rangeArray.asArray().map(n => n.asNumber?.() ?? 0);
                            } else {
                                def.range = [-100, 100, -100, 100];
                            }
                        }
                    }
                    // Handle Separation color space
                    else if (typeName === 'Separation') {
                        def.colorSpaceType = 'Separation';
                    }

                    definitions[csName] = def;
                }
            }
        }

        return definitions;
    }

    // ========================================
    // Helper Methods
    // ========================================

    /**
     * Gets the color space from an ICC profile header.
     * @param {Uint8Array} profileData - Decompressed ICC profile data
     * @returns {string} Color space type ('Gray', 'RGB', 'CMYK', or 'Unknown')
     */
    static getICCColorSpace(profileData) {
        if (profileData.length < 20) return 'Unknown';

        // ICC color space is at offset 16, 4 bytes
        const colorSpaceBytes = profileData.slice(16, 20);
        const colorSpace = String.fromCharCode(...colorSpaceBytes).trim();

        switch (colorSpace) {
            case 'GRAY': return 'Gray';
            case 'RGB': return 'RGB';
            case 'CMYK': return 'CMYK';
            case 'Lab': return 'Lab';
            default: return 'Unknown';
        }
    }

    /**
     * Normalizes color space type names for consistent handling.
     * @param {string} typeName - Raw color space type name
     * @returns {string} Normalized type (sGray, sRGB, Lab, CMYK, etc.)
     */
    static normalizeColorSpaceType(typeName) {
        switch (typeName) {
            case 'Gray':
            case 'DeviceGray':
                return 'sGray';
            case 'RGB':
            case 'DeviceRGB':
                return 'sRGB';
            case 'CMYK':
            case 'DeviceCMYK':
                return 'CMYK';
            case 'Lab':
                return 'Lab';
            case 'Separation':
                return 'Separation';
            default:
                return typeName;
        }
    }

    /**
     * Maps colorspace type to user-friendly display name.
     * @param {string} colorSpaceType - Internal colorspace type (sRGB, sGray, Lab, CMYK, Separation)
     * @returns {string} Display colorspace name
     */
    static getDisplayColorspace(colorSpaceType) {
        switch (colorSpaceType) {
            case 'sRGB': return 'ICCBasedRGB';
            case 'sGray': return 'ICCBasedGray';
            case 'CMYK': return 'ICCBasedCMYK';
            case 'Lab': return 'Lab';
            case 'Separation': return 'Separation';
            default: return colorSpaceType || 'Unknown';
        }
    }

    // ========================================
    // Tolerance Matching
    // ========================================

    /**
     * Check if two arrays of values match within tolerances.
     * @param {number[]} actual - Actual values
     * @param {number[]} expected - Expected values
     * @param {number[]} tolerances - Tolerance for each value
     * @returns {boolean}
     */
    static valuesMatchWithinTolerance(actual, expected, tolerances) {
        if (actual.length !== expected.length) return false;
        for (let i = 0; i < actual.length; i++) {
            const tolerance = tolerances[i] ?? 0;
            if (Math.abs(actual[i] - expected[i]) > tolerance) {
                return false;
            }
        }
        return true;
    }
}
