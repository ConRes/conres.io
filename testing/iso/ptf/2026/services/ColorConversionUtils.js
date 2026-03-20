// @ts-check
/**
 * Color Conversion Utilities
 *
 * Shared utility functions for color conversion used by both main thread (PDFService)
 * and worker threads (StreamTransformWorker). This ensures consistent conversion
 * logic regardless of where the conversion runs.
 *
 * @module ColorConversionUtils
 */

import {
    TYPE_RGB_8,
    TYPE_RGB_16,
    TYPE_CMYK_8,
    TYPE_GRAY_8,
    TYPE_GRAY_16,
    TYPE_Lab_8,
    TYPE_Lab_16,
    INTENT_PERCEPTUAL,
    INTENT_RELATIVE_COLORIMETRIC,
    INTENT_SATURATION,
    INTENT_ABSOLUTE_COLORIMETRIC,
    INTENT_PRESERVE_K_ONLY_RELATIVE_COLORIMETRIC_GCR,
    cmsFLAGS_BLACKPOINTCOMPENSATION,
} from '../packages/color-engine/src/index.js';

/**
 * @typedef {'RGB' | 'Gray' | 'Lab' | 'CMYK'} ColorType
 */

/**
 * @typedef {{
 *   type: ColorType,
 *   values: number[],
 * }} ColorValue
 */

/**
 * @typedef {{
 *   colorSpaceType?: string,
 *   range?: number[], // Lab range: [amin, amax, bmin, bmax]
 * }} ColorSpaceDefinition
 */

/**
 * Color engine rendering intent constants.
 * Note: PRESERVE_K_ONLY_PERCEPTUAL_GCR (18) and PRESERVE_K_ONLY_SATURATION_GCR (22)
 * are not yet exported from the color engine package.
 */
export const RENDERING_INTENTS = {
    PERCEPTUAL: INTENT_PERCEPTUAL,
    RELATIVE_COLORIMETRIC: INTENT_RELATIVE_COLORIMETRIC,
    SATURATION: INTENT_SATURATION,
    ABSOLUTE_COLORIMETRIC: INTENT_ABSOLUTE_COLORIMETRIC,
    PRESERVE_K_ONLY_PERCEPTUAL_GCR: 18, // TODO: Export from color-engine
    PRESERVE_K_ONLY_RELATIVE_COLORIMETRIC_GCR: INTENT_PRESERVE_K_ONLY_RELATIVE_COLORIMETRIC_GCR,
    PRESERVE_K_ONLY_SATURATION_GCR: 22, // TODO: Export from color-engine
};

/**
 * Rendering intent string to numeric value mapping
 */
export const INTENT_MAP = {
    'perceptual': RENDERING_INTENTS.PERCEPTUAL,
    'relative-colorimetric': RENDERING_INTENTS.RELATIVE_COLORIMETRIC,
    'saturation': RENDERING_INTENTS.SATURATION,
    'absolute-colorimetric': RENDERING_INTENTS.ABSOLUTE_COLORIMETRIC,
    'preserve-k-only-perceptual-gcr': RENDERING_INTENTS.PRESERVE_K_ONLY_PERCEPTUAL_GCR,
    'preserve-k-only-relative-colorimetric-gcr': RENDERING_INTENTS.PRESERVE_K_ONLY_RELATIVE_COLORIMETRIC_GCR,
    'preserve-k-only-saturation-gcr': RENDERING_INTENTS.PRESERVE_K_ONLY_SATURATION_GCR,
};

/**
 * Color engine pixel format constants (from LittleCMS)
 */
export const PIXEL_FORMATS = {
    TYPE_RGB_8,
    TYPE_RGB_16,
    TYPE_CMYK_8,
    TYPE_GRAY_8,
    TYPE_GRAY_16,
    TYPE_Lab_8,
    TYPE_Lab_16,
};

/**
 * Color engine flags
 */
export const ENGINE_FLAGS = {
    BLACKPOINT_COMPENSATION: cmsFLAGS_BLACKPOINTCOMPENSATION,
};

// ============================================================================
// PDF ↔ Color Engine Format Conversion
// ============================================================================

/**
 * Convert PDF RGB color values (0-1) to Color Engine format (0-255)
 * @param {number[]} pdfValues - RGB values in PDF format [r, g, b] (0-1 range)
 * @returns {number[]} RGB values in Color Engine format [r, g, b] (0-255 range)
 */
export function pdfRGBToEngine(pdfValues) {
    return pdfValues.map(v => Math.round(v * 255));
}

/**
 * Convert Color Engine RGB values (0-255) to PDF format (0-1)
 * @param {number[]} engineValues - RGB values in Color Engine format [r, g, b] (0-255 range)
 * @returns {number[]} RGB values in PDF format [r, g, b] (0-1 range)
 */
export function engineRGBToPDF(engineValues) {
    return engineValues.map(v => v / 255);
}

/**
 * Convert PDF Gray color values (0-1) to Color Engine format (0-255)
 * @param {number[]} pdfValues - Gray values in PDF format [g] (0-1 range)
 * @returns {number[]} Gray values in Color Engine format [g] (0-255 range)
 */
export function pdfGrayToEngine(pdfValues) {
    return pdfValues.map(v => Math.round(v * 255));
}

/**
 * Convert Color Engine Gray values (0-255) to PDF format (0-1)
 * @param {number[]} engineValues - Gray values in Color Engine format [g] (0-255 range)
 * @returns {number[]} Gray values in PDF format [g] (0-1 range)
 */
export function engineGrayToPDF(engineValues) {
    return engineValues.map(v => v / 255);
}

/**
 * Convert PDF CMYK color values (0-1) to Color Engine format (0-255)
 * @param {number[]} pdfValues - CMYK values in PDF format [c, m, y, k] (0-1 range)
 * @returns {number[]} CMYK values in Color Engine format [c, m, y, k] (0-255 range)
 */
export function pdfCMYKToEngine(pdfValues) {
    return pdfValues.map(v => Math.round(v * 255));
}

/**
 * Convert Color Engine CMYK values (0-255) to PDF format (0-1)
 * @param {number[]} engineValues - CMYK values in Color Engine format [c, m, y, k] (0-255 range)
 * @returns {number[]} CMYK values in PDF format [c, m, y, k] (0-1 range)
 */
export function engineCMYKToPDF(engineValues) {
    return engineValues.map(v => v / 255);
}

/**
 * Convert PDF Lab color values to Color Engine 8-bit format
 *
 * PDF Lab encoding:
 * - L*: 0-100
 * - a*, b*: defined by Range array (default [-100, 100])
 *
 * Color Engine TYPE_Lab_8 encoding (8-bit):
 * - L: 0-255 (0=0%, 255=100%)
 * - a: 0-255 (0=-128, 128=0, 255=+127)
 * - b: 0-255 (0=-128, 128=0, 255=+127)
 *
 * @param {number[]} pdfValues - Lab values in PDF format [L, a, b]
 * @param {number[]} [range=[-100, 100, -100, 100]] - Lab range [amin, amax, bmin, bmax]
 * @returns {number[]} Lab values in 8-bit Color Engine format [L, a, b] (0-255)
 */
export function pdfLabToEngine(pdfValues, range = [-100, 100, -100, 100]) {
    const [L, a, b] = pdfValues;
    const [amin, amax, bmin, bmax] = range;

    // Convert L* from 0-100 to 0-255 (8-bit encoding)
    const iccL = Math.round(L * 255 / 100);

    // Convert a* and b* from PDF range to 8-bit (0-255)
    // In 8-bit Lab: 0 → -128, 128 → 0, 255 → +127
    const iccA = Math.round((a - amin) / (amax - amin) * 255);
    const iccB = Math.round((b - bmin) / (bmax - bmin) * 255);

    return [iccL, iccA, iccB];
}

/**
 * Convert Color Engine Lab values to PDF format
 * @param {number[]} engineValues - Lab values in Color Engine format [L, a, b]
 * @param {number[]} [range=[-100, 100, -100, 100]] - Target Lab range [amin, amax, bmin, bmax]
 * @returns {number[]} Lab values in PDF format [L, a, b]
 */
export function engineLabToPDF(engineValues, range = [-100, 100, -100, 100]) {
    const [L, a, b] = engineValues;
    const [amin, amax, bmin, bmax] = range;

    // L* is unchanged
    let pdfL = L;

    // Convert a* and b* from ICC Lab range [-128, +127] to PDF range
    let pdfA = a;
    let pdfB = b;

    if (amin !== -128 || amax !== 127) {
        pdfA = (a + 128) / 255 * (amax - amin) + amin;
    }
    if (bmin !== -128 || bmax !== 127) {
        pdfB = (b + 128) / 255 * (bmax - bmin) + bmin;
    }

    return [pdfL, pdfA, pdfB];
}

// ============================================================================
// Color Type Detection
// ============================================================================

/**
 * Determine the source color type from a content stream color operation
 *
 * @param {object} colorChunk - Color chunk from content stream parsing
 * @param {string} colorChunk.type - Chunk type ('gray', 'rgb', 'cmyk', 'indexed')
 * @param {number[]} [colorChunk.values] - Color values
 * @param {string} [colorChunk.name] - Color space name (for indexed colors)
 * @param {Record<string, ColorSpaceDefinition>} [colorSpaceDefinitions] - Color space definitions from page resources
 * @returns {{ sourceType: 'rgb' | 'gray' | 'lab' | 'cmyk' | null, colorSpaceDef?: ColorSpaceDefinition }} Source type and optional color space definition
 */
export function determineSourceColorType(colorChunk, colorSpaceDefinitions) {
    const { type, values, name } = colorChunk;

    // CMYK colors pass through unchanged
    if (type === 'cmyk') {
        return { sourceType: null }; // Passthrough
    }

    // Direct RGB colors
    if (type === 'rgb') {
        return { sourceType: 'rgb' };
    }

    // Direct Gray colors
    if (type === 'gray') {
        return { sourceType: 'gray' };
    }

    // Indexed colors (using named color spaces like /CS1)
    if (type === 'indexed') {
        // Look up the actual color space type from page definitions
        // Note: color space names from content stream have leading '/' (e.g., '/CS1')
        // but definition keys don't have it (e.g., 'CS1'), so strip the prefix
        const colorSpaceName = name?.replace(/^\//, '');
        const colorSpaceDef = colorSpaceName ? colorSpaceDefinitions?.[colorSpaceName] : null;
        const colorSpaceType = colorSpaceDef?.colorSpaceType;

        if (colorSpaceType === 'Lab') {
            return { sourceType: 'lab', colorSpaceDef };
        }

        if (colorSpaceType === 'Separation') {
            /**
             * TODO [separation/spot support]: Implement Separation/spot color conversion.
             * Convert Separation alternate color space based on appropriate profile:
             * - Output intent profile (if available and matching color model)
             * - Default source profile per policy
             * - Lab as device-independent fallback
             * The alternate device color should be converted using the selected profile.
             *
             * Current behavior: Pass through unchanged with warning logged.
             */
            // Separation colors (spot colors) pass through unchanged for now
            // console.warn(`[Separation] Skipping conversion for Separation color space: ${name} (passthrough)`);
            return { sourceType: null };
        }

        if (colorSpaceType === 'ICCBased') {
            // ICCBased colors - determine type by component count
            const componentCount = values?.length ?? 0;
            if (componentCount === 1) {
                return { sourceType: 'gray' };
            }
            if (componentCount === 3) {
                return { sourceType: 'rgb' };
            }
            // Skip 4-component (CMYK) - already in target color space
            return { sourceType: null };
        }

        // Fallback to component count
        const componentCount = values?.length ?? 0;
        if (componentCount === 1) {
            return { sourceType: 'gray' };
        }
        if (componentCount === 3) {
            return { sourceType: 'rgb' };
        }
        // Skip 4-component (CMYK) and others
        return { sourceType: null };
    }

    return { sourceType: null };
}

// ============================================================================
// Content Stream Color Conversion
// ============================================================================

/**
 * Convert PDF color values to Color Engine format based on source type
 *
 * @param {'rgb' | 'gray' | 'lab'} sourceType - Source color type
 * @param {number[]} pdfValues - Color values in PDF format
 * @param {ColorSpaceDefinition} [colorSpaceDef] - Color space definition (for Lab range)
 * @returns {ColorValue} Color value in Color Engine format
 */
export function pdfToEngineColorValue(sourceType, pdfValues, colorSpaceDef) {
    switch (sourceType) {
        case 'rgb':
            return {
                type: 'RGB',
                values: pdfRGBToEngine(pdfValues),
            };
        case 'gray':
            return {
                type: 'Gray',
                values: pdfGrayToEngine(pdfValues), // Convert 0-1 to 0-255 for 8-bit engine
            };
        case 'lab':
            return {
                type: 'Lab',
                values: pdfLabToEngine(pdfValues, colorSpaceDef?.range),
            };
        default:
            throw new Error(`Unsupported source type: ${sourceType}`);
    }
}

/**
 * Convert Color Engine color values to PDF format based on destination type
 *
 * @param {'CMYK' | 'RGB' | 'Gray'} destType - Destination color type
 * @param {number[]} engineValues - Color values in Color Engine format
 * @returns {number[]} Color values in PDF format
 */
export function engineToPDFColorValue(destType, engineValues) {
    switch (destType) {
        case 'CMYK':
            return engineCMYKToPDF(engineValues);
        case 'RGB':
            return engineRGBToPDF(engineValues);
        case 'Gray':
            return engineGrayToPDF(engineValues);
        default:
            throw new Error(`Unsupported destination type: ${destType}`);
    }
}

/**
 * Get the number of components for a color type
 * @param {'RGB' | 'Gray' | 'Lab' | 'CMYK'} colorType
 * @returns {number}
 */
export function getComponentCount(colorType) {
    switch (colorType) {
        case 'Gray':
            return 1;
        case 'RGB':
        case 'Lab':
            return 3;
        case 'CMYK':
            return 4;
        default:
            return 0;
    }
}

/**
 * Get the pixel format constant for a color type
 * @param {'RGB' | 'Gray' | 'Lab' | 'CMYK'} colorType
 * @param {8 | 16} [bitsPerComponent=8]
 * @returns {number}
 */
export function getPixelFormat(colorType, bitsPerComponent = 8) {
    switch (colorType) {
        case 'Gray':
            return PIXEL_FORMATS.TYPE_GRAY_8;
        case 'RGB':
            return PIXEL_FORMATS.TYPE_RGB_8;
        case 'Lab':
            return bitsPerComponent === 16 ? PIXEL_FORMATS.TYPE_Lab_16 : PIXEL_FORMATS.TYPE_Lab_8;
        case 'CMYK':
            return PIXEL_FORMATS.TYPE_CMYK_8;
        default:
            return 0;
    }
}

// ============================================================================
// Batch Color Conversion Helpers
// ============================================================================

/**
 * Prepare colors for batch conversion by grouping by source type
 *
 * @template T
 * @param {Array<{ values?: number[], colorSpaceDef?: ColorSpaceDefinition, sourceType: 'rgb' | 'gray' | 'lab' | null, data: T }>} colorLocations
 * @returns {Map<'rgb' | 'gray' | 'lab', Array<{ values: number[], colorSpaceDef?: ColorSpaceDefinition, data: T }>>}
 */
export function groupColorsBySourceType(colorLocations) {
    /** @type {Map<'rgb' | 'gray' | 'lab', Array<{ values: number[], colorSpaceDef?: ColorSpaceDefinition, data: T }>>} */
    const groups = new Map();

    for (const loc of colorLocations) {
        if (!loc.sourceType || !loc.values || loc.values.length === 0) {
            continue;
        }

        let group = groups.get(loc.sourceType);
        if (!group) {
            group = [];
            groups.set(loc.sourceType, group);
        }
        group.push({
            values: loc.values,
            colorSpaceDef: loc.colorSpaceDef,
            data: loc.data,
        });
    }

    return groups;
}

/**
 * Create a flat array of color values for batch conversion
 *
 * @param {Array<{ values: number[], colorSpaceDef?: ColorSpaceDefinition }>} locations
 * @param {'rgb' | 'gray' | 'lab'} sourceType
 * @returns {Uint8Array} Flat array of color values ready for Color Engine
 */
export function createBatchInputArray(locations, sourceType) {
    const componentsPerColor = sourceType === 'gray' ? 1 : 3;
    const result = new Uint8Array(locations.length * componentsPerColor);

    for (let i = 0; i < locations.length; i++) {
        const loc = locations[i];
        const engineValue = pdfToEngineColorValue(sourceType, loc.values, loc.colorSpaceDef);
        const offset = i * componentsPerColor;

        for (let c = 0; c < componentsPerColor; c++) {
            result[offset + c] = Math.round(engineValue.values[c]);
        }
    }

    return result;
}

/**
 * Extract converted values from batch output array
 *
 * @param {Uint8Array} outputArray - Output from Color Engine
 * @param {number} locationCount - Number of colors converted
 * @param {'CMYK' | 'RGB' | 'Gray'} destType - Destination color type
 * @returns {number[][]} Array of converted color values in PDF format
 */
export function extractBatchOutputValues(outputArray, locationCount, destType) {
    const componentsPerColor = getComponentCount(destType);
    const results = [];

    for (let i = 0; i < locationCount; i++) {
        const offset = i * componentsPerColor;
        const engineValues = [];

        for (let c = 0; c < componentsPerColor; c++) {
            engineValues.push(outputArray[offset + c]);
        }

        results.push(engineToPDFColorValue(destType, engineValues));
    }

    return results;
}

// ============================================================================
// Content Stream Parsing
// ============================================================================

/**
 * @typedef {'G' | 'g' | 'RG' | 'rg' | 'K' | 'k' | 'CS' | 'cs' | 'SC' | 'sc' | 'SCN' | 'scn'} ColorOperator
 */

/**
 * @typedef {{
 *   type: 'head' | 'string' | 'colorspace' | 'gray' | 'rgb' | 'cmyk' | 'indexed',
 *   operator?: ColorOperator,
 *   value?: string,
 *   values?: number[],
 *   name?: string,
 *   raw?: string,
 *   index?: number,
 * }} ContentStreamColorChunk
 */

/**
 * @typedef {{
 *   chunks: ContentStreamColorChunk[],
 *   colorSpaces: Array<{name: string, grayCount: number, rgbCount: number, cmykCount: number, indexedCount: number}>,
 *   text: string,
 * }} ContentStreamParseResult
 */

/**
 * @typedef {{
 *   chunk: ContentStreamColorChunk,
 *   newValues: number[],
 *   newType: 'gray' | 'rgb' | 'cmyk',
 * }} ColorReplacement
 */

/**
 * @typedef {{
 *   originalText: string,
 *   newText: string,
 *   replacementCount: number,
 * }} ContentStreamReplacementResult
 */

/**
 * Regular expression for matching PDF content stream color operators.
 * Matches color space operators (CS/cs), color operators (G/g, RG/rg, K/k, SC/sc, SCN/scn).
 *
 * Note: Uses (?<=[\s\n]|^) lookbehind instead of \b word boundary to correctly match
 * decimal numbers starting with '.' (e.g., ".95" instead of "0.95") which is valid PDF syntax.
 *
 * @type {RegExp}
 */
export const COLOR_OPERATOR_REGEX = /(?<head>[^(]*?)(?:(?:(?<=[\s\n]|^)(?<name>\/\w+)\s+(?<csOp>CS|cs)\b)|(?:(?<=[\s\n]|^)(?<name2>\/\w+)\s+(?<scnOp>SCN|scn)\b)|(?:(?<=[\s\n]|^)(?<gray>(?:\d+\.?\d*|\.\d+))\s+(?<gOp>G|g)\b)|(?:(?<=[\s\n]|^)(?<cmyk>(?:\d+\.?\d*|\.\d+)\s+(?:\d+\.?\d*|\.\d+)\s+(?:\d+\.?\d*|\.\d+)\s+(?:\d+\.?\d*|\.\d+))\s+(?<kOp>K|k)\b)|(?:(?<=[\s\n]|^)(?<rgb>(?:\d+\.?\d*|\.\d+)\s+(?:\d+\.?\d*|\.\d+)\s+(?:\d+\.?\d*|\.\d+))\s+(?<rgOp>RG|rg)\b)|(?:(?<=[\s\n]|^)(?<n>(?:\d+\.?\d*|\.\d+)(?:\s+(?:\d+\.?\d*|\.\d+))*)\s+(?<scOp>SC|sc|SCN|scn)\b)|(?:\((?<string>[^)]*)\))|\s*$)/ug;

/**
 * Parses a PDF content stream to extract color operations.
 * This is a pure function that works with text strings - no pdf-lib dependencies.
 *
 * @param {string} streamText - The decoded content stream text
 * @returns {ContentStreamParseResult}
 */
export function parseContentStreamColors(streamText) {
    /** @type {ContentStreamColorChunk[]} */
    const chunks = [];
    /** @type {Array<{name: string, grayCount: number, rgbCount: number, cmykCount: number, indexedCount: number}>} */
    const colorSpaces = [];
    // Track SEPARATE stroke and fill color space contexts
    // Stroke: set by CS (uppercase), used by SC/SCN (uppercase)
    // Fill: set by cs (lowercase), used by sc/scn (lowercase)
    /** @type {{name: string, grayCount: number, rgbCount: number, cmykCount: number, indexedCount: number} | undefined} */
    let currentStrokeColorSpace;
    /** @type {{name: string, grayCount: number, rgbCount: number, cmykCount: number, indexedCount: number} | undefined} */
    let currentFillColorSpace;

    const matches = Array.from(streamText.matchAll(COLOR_OPERATOR_REGEX));

    for (const match of matches) {
        const {
            head,
            name, name2,
            csOp, scnOp, gOp, kOp, rgOp, scOp,
            gray, cmyk, rgb, n,
            string
        } = match.groups ?? {};

        const matchIndex = match.index ?? 0;
        const headLength = head?.length ?? 0;
        const colorIndex = matchIndex + headLength;
        const fullMatchLength = match[0].length;
        const colorOpLength = fullMatchLength - headLength;

        // Non-color content
        if (head?.trim()) {
            chunks.push({ type: 'head', value: head, raw: head, index: matchIndex });
        }

        // String literal (skip for color processing)
        if (string !== undefined) {
            chunks.push({ type: 'string', value: string, raw: `(${string})`, index: colorIndex });
            continue;
        }

        // Color space operator (CS/cs)
        if (csOp && name) {
            const isStroke = csOp === 'CS';
            chunks.push({
                type: 'colorspace',
                operator: /** @type {ColorOperator} */ (csOp),
                name,
                raw: streamText.slice(colorIndex, colorIndex + colorOpLength),
                index: colorIndex,
            });
            const newColorSpace = {
                name,
                grayCount: 0,
                rgbCount: 0,
                cmykCount: 0,
                indexedCount: 0
            };
            // Update the appropriate context (stroke vs fill)
            if (isStroke) {
                currentStrokeColorSpace = newColorSpace;
            } else {
                currentFillColorSpace = newColorSpace;
            }
            colorSpaces.push(newColorSpace);
            continue;
        }

        // Gray operator (G/g)
        if (gOp && gray !== undefined) {
            const isStroke = gOp === 'G';
            const currentColorSpace = isStroke ? currentStrokeColorSpace : currentFillColorSpace;
            const values = [parseFloat(gray)];
            chunks.push({
                type: 'gray',
                operator: /** @type {ColorOperator} */ (gOp),
                values,
                raw: streamText.slice(colorIndex, colorIndex + colorOpLength),
                index: colorIndex,
            });
            if (currentColorSpace) currentColorSpace.grayCount++;
            continue;
        }

        // RGB operator (RG/rg)
        if (rgOp && rgb) {
            const isStroke = rgOp === 'RG';
            const currentColorSpace = isStroke ? currentStrokeColorSpace : currentFillColorSpace;
            const values = rgb.split(/\s+/).map(parseFloat);
            chunks.push({
                type: 'rgb',
                operator: /** @type {ColorOperator} */ (rgOp),
                values,
                raw: streamText.slice(colorIndex, colorIndex + colorOpLength),
                index: colorIndex,
            });
            if (currentColorSpace) currentColorSpace.rgbCount++;
            continue;
        }

        // CMYK operator (K/k)
        if (kOp && cmyk) {
            const isStroke = kOp === 'K';
            const currentColorSpace = isStroke ? currentStrokeColorSpace : currentFillColorSpace;
            const values = cmyk.split(/\s+/).map(parseFloat);
            chunks.push({
                type: 'cmyk',
                operator: /** @type {ColorOperator} */ (kOp),
                values,
                raw: streamText.slice(colorIndex, colorIndex + colorOpLength),
                index: colorIndex,
            });
            if (currentColorSpace) currentColorSpace.cmykCount++;
            continue;
        }

        // Indexed/Named color operator (SC/sc/SCN/scn)
        if ((scOp || scnOp) && (n || name2)) {
            const operator = /** @type {ColorOperator} */ (scOp || scnOp);
            // Determine if this is a stroke (SC/SCN) or fill (sc/scn) operation
            const isStroke = operator === 'SC' || operator === 'SCN';
            const currentColorSpace = isStroke ? currentStrokeColorSpace : currentFillColorSpace;
            const rawText = streamText.slice(colorIndex, colorIndex + colorOpLength);
            if (name2) {
                // Named color space reference
                chunks.push({
                    type: 'indexed',
                    operator,
                    name: name2,
                    raw: rawText,
                    index: colorIndex,
                });
            } else if (n) {
                // Numeric color values
                const values = n.split(/\s+/).map(parseFloat);
                chunks.push({
                    type: 'indexed',
                    operator,
                    values,
                    raw: rawText,
                    index: colorIndex,
                    // CRITICAL: Use the correct context (stroke vs fill)
                    name: currentColorSpace?.name,
                });
            }
            if (currentColorSpace) currentColorSpace.indexedCount++;
            continue;
        }
    }

    return { chunks, colorSpaces, text: streamText };
}

/**
 * Determines if an operator is a stroke operator (uppercase)
 * @param {string} operator
 * @returns {boolean}
 */
export function isStrokeOperator(operator) {
    return operator === operator.toUpperCase();
}

/**
 * Gets the PDF operator for a color type
 * @param {'gray' | 'rgb' | 'cmyk'} colorType
 * @param {boolean} isStroke
 * @returns {string}
 */
export function getOperatorForColorType(colorType, isStroke) {
    switch (colorType) {
        case 'gray': return isStroke ? 'G' : 'g';
        case 'rgb': return isStroke ? 'RG' : 'rg';
        case 'cmyk': return isStroke ? 'K' : 'k';
        default: throw new Error(`Unknown color type: ${colorType}`);
    }
}

/**
 * Formats color values for PDF content stream
 * @param {number[]} values
 * @returns {string}
 */
export function formatColorValues(values) {
    return values.map(v => {
        const formatted = v.toFixed(6).replace(/\.?0+$/, '');
        return formatted === '' ? '0' : formatted;
    }).join(' ');
}

/**
 * Replaces color operations in a content stream with converted values.
 * This is a pure function that works with text strings - no pdf-lib dependencies.
 *
 * @param {string} originalText - The original content stream text
 * @param {ColorReplacement[]} replacements - Array of color replacements to apply
 * @returns {ContentStreamReplacementResult}
 */
export function replaceContentStreamColors(originalText, replacements) {
    if (replacements.length === 0) {
        return {
            originalText,
            newText: originalText,
            replacementCount: 0,
        };
    }

    // Sort replacements by index in descending order to process from end to start
    const sortedReplacements = [...replacements].sort((a, b) => b.chunk.index - a.chunk.index);

    let newText = originalText;
    let replacementCount = 0;

    for (const replacement of sortedReplacements) {
        const { chunk, newValues, newType } = replacement;

        if (chunk.index === undefined || !chunk.raw) continue;

        const isStroke = isStrokeOperator(chunk.operator ?? '');
        const newOperator = getOperatorForColorType(newType, isStroke);
        const newColorString = `${formatColorValues(newValues)} ${newOperator}`;

        // Replace the original color operation with the new one
        const before = newText.slice(0, chunk.index);
        const after = newText.slice(chunk.index + chunk.raw.length);
        newText = before + newColorString + after;
        replacementCount++;
    }

    return {
        originalText,
        newText,
        replacementCount,
    };
}

// ============================================================================
// Content Stream Color Conversion (for workers)
// ============================================================================

/**
 * Convert colors in a content stream using the provided color engine.
 * This function handles the full flow: parse → convert → replace.
 *
 * @param {string} streamText - Decoded content stream text
 * @param {object} options
 * @param {Record<string, ColorSpaceDefinition>} [options.colorSpaceDefinitions] - Page color space definitions
 * @param {any} options.colorEngine - Color engine instance
 * @param {number} options.renderingIntent - Rendering intent constant
 * @param {number} options.flags - Color engine flags (e.g., BPC)
 * @param {any} options.sourceRGBProfile - Source profile for RGB colors
 * @param {any} options.sourceGrayProfile - Source profile for Gray colors
 * @param {any} options.destinationProfile - Destination profile handle
 * @param {boolean} [options.verbose=false] - Enable verbose logging
 * @returns {Promise<{newText: string, replacementCount: number}>}
 */
export async function convertContentStreamColors(streamText, options) {
    const {
        colorSpaceDefinitions = {},
        colorEngine,
        renderingIntent,
        flags,
        sourceRGBProfile,
        sourceGrayProfile,
        destinationProfile,
        verbose = false,
    } = options;

    // Parse content stream
    const parseResult = parseContentStreamColors(streamText);
    const { chunks } = parseResult;

    // Filter to color chunks that need conversion
    /** @type {Array<{chunk: ContentStreamColorChunk, sourceType: 'rgb' | 'gray' | 'lab', colorSpaceDef?: ColorSpaceDefinition}>} */
    const colorLocations = [];

    for (const chunk of chunks) {
        if (chunk.type === 'head' || chunk.type === 'string' || chunk.type === 'colorspace') {
            continue;
        }

        const { sourceType, colorSpaceDef } = determineSourceColorType(
            { type: chunk.type, values: chunk.values, name: chunk.name },
            colorSpaceDefinitions
        );

        if (sourceType) {
            colorLocations.push({ chunk, sourceType, colorSpaceDef });
        }
    }

    if (colorLocations.length === 0) {
        return { newText: streamText, replacementCount: 0 };
    }

    // Group by source type for batch processing
    const groupedColors = groupColorsBySourceType(
        colorLocations.map(loc => ({
            ...loc,
            values: loc.chunk.values,
            data: loc.chunk,
        }))
    );

    /** @type {Map<ContentStreamColorChunk, number[]>} */
    const convertedValues = new Map();

    // Process each source type
    for (const [sourceType, locations] of groupedColors) {
        if (locations.length === 0) continue;

        // Determine source profile and pixel format
        let sourceProfile;
        let inputFormat;
        let inputComponents;

        if (sourceType === 'rgb') {
            sourceProfile = sourceRGBProfile;
            inputFormat = PIXEL_FORMATS.TYPE_RGB_8;
            inputComponents = 3;
        } else if (sourceType === 'gray') {
            // Special handling for Gray with K-Only GCR intent:
            // Direct Gray → CMYK with K-Only GCR doesn't work (produces all zeros).
            // We must use multiprofile transform [Gray, sRGB, CMYK] or expand Gray → RGB.
            const needsGrayExpansion = renderingIntent === RENDERING_INTENTS.PRESERVE_K_ONLY_RELATIVE_COLORIMETRIC_GCR;

            if (needsGrayExpansion && colorEngine.createMultiprofileTransform) {
                // New engine: use multiprofile transform (Gray → sRGB → CMYK)
                // This is handled below where we create the transform
                sourceProfile = sourceGrayProfile;
                inputFormat = PIXEL_FORMATS.TYPE_GRAY_8;
                inputComponents = 1;
            } else if (needsGrayExpansion) {
                // Old engine fallback: expand Gray → RGB (R=G=B) using sRGB profile
                // This matches what ColorEngineService does on main thread
                sourceProfile = colorEngine.createSRGBProfile();
                inputFormat = PIXEL_FORMATS.TYPE_RGB_8;
                inputComponents = 3;
            } else {
                // Non-K-Only intent: direct Gray → CMYK works fine
                sourceProfile = sourceGrayProfile;
                inputFormat = PIXEL_FORMATS.TYPE_GRAY_8;
                inputComponents = 1;
            }
        } else if (sourceType === 'lab') {
            // Lab uses built-in profile
            sourceProfile = colorEngine.createLab4Profile(0);
            inputFormat = PIXEL_FORMATS.TYPE_Lab_8;
            inputComponents = 3;
        } else {
            continue;
        }

        // Create transform for this source type
        // Lab colors should use Relative Colorimetric (not K-Only GCR)
        const effectiveIntent = sourceType === 'lab' && renderingIntent === RENDERING_INTENTS.PRESERVE_K_ONLY_RELATIVE_COLORIMETRIC_GCR
            ? RENDERING_INTENTS.RELATIVE_COLORIMETRIC
            : renderingIntent;
        const effectiveFlags = sourceType === 'lab'
            ? flags | ENGINE_FLAGS.BLACKPOINT_COMPENSATION
            : flags;

        // Track if we need to clean up an sRGB profile we created
        let createdSRGBProfile = null;

        // Determine if we need multiprofile transform for Gray + K-Only GCR
        const needsGrayMultiprofile = sourceType === 'gray'
            && renderingIntent === RENDERING_INTENTS.PRESERVE_K_ONLY_RELATIVE_COLORIMETRIC_GCR
            && colorEngine.createMultiprofileTransform;

        // Determine if we're using expanded RGB for Gray + K-Only (old engine fallback)
        const usingGrayToRGBExpansion = sourceType === 'gray'
            && renderingIntent === RENDERING_INTENTS.PRESERVE_K_ONLY_RELATIVE_COLORIMETRIC_GCR
            && !colorEngine.createMultiprofileTransform;

        let transform;
        if (needsGrayMultiprofile) {
            // New engine: use multiprofile transform [Gray → sRGB → CMYK]
            createdSRGBProfile = colorEngine.createSRGBProfile();
            transform = colorEngine.createMultiprofileTransform(
                [sourceGrayProfile, createdSRGBProfile, destinationProfile],
                PIXEL_FORMATS.TYPE_GRAY_8,
                PIXEL_FORMATS.TYPE_CMYK_8,
                effectiveIntent,
                effectiveFlags
            );
        } else {
            transform = colorEngine.createTransform(
                sourceProfile,
                inputFormat,
                destinationProfile,
                PIXEL_FORMATS.TYPE_CMYK_8,
                effectiveIntent,
                effectiveFlags
            );
        }

        // Create batch input array
        // For old engine Gray + K-Only fallback, expand Gray → RGB (R=G=B)
        let inputArray;
        if (usingGrayToRGBExpansion) {
            // Expand gray values to RGB: each gray value becomes [g, g, g]
            inputArray = new Uint8Array(locations.length * 3);
            for (let i = 0; i < locations.length; i++) {
                const grayValue = pdfGrayToEngine(locations[i].values)[0];
                inputArray[i * 3] = grayValue;
                inputArray[i * 3 + 1] = grayValue;
                inputArray[i * 3 + 2] = grayValue;
            }
        } else {
            inputArray = createBatchInputArray(locations, needsGrayMultiprofile ? 'gray' : sourceType);
        }
        const outputArray = new Uint8Array(locations.length * 4); // CMYK = 4 components

        // Transform
        colorEngine.transformArray(transform, inputArray, outputArray, locations.length);

        // Extract output values and map back to chunks
        const outputValues = extractBatchOutputValues(outputArray, locations.length, 'CMYK');

        for (let i = 0; i < locations.length; i++) {
            convertedValues.set(locations[i].data, outputValues[i]);
        }

        // Cleanup profiles we created
        if (sourceType === 'lab') {
            colorEngine.closeProfile(sourceProfile);
        }
        if (createdSRGBProfile) {
            colorEngine.closeProfile(createdSRGBProfile);
        }
        // Clean up sRGB profile created for old engine fallback
        if (usingGrayToRGBExpansion && sourceProfile) {
            colorEngine.closeProfile(sourceProfile);
        }
        colorEngine.deleteTransform(transform);
    }

    // Build replacements
    /** @type {ColorReplacement[]} */
    const replacements = [];

    for (const [chunk, newValues] of convertedValues) {
        replacements.push({
            chunk,
            newValues,
            newType: 'cmyk',
        });
    }

    // Apply replacements
    const result = replaceContentStreamColors(streamText, replacements);

    if (verbose) {
        console.log(`Converted ${result.replacementCount} colors in content stream`);
    }

    return {
        newText: result.newText,
        replacementCount: result.replacementCount,
    };
}

export default {
    // Constants
    RENDERING_INTENTS,
    INTENT_MAP,
    PIXEL_FORMATS,
    ENGINE_FLAGS,
    // Format conversion
    pdfRGBToEngine,
    engineRGBToPDF,
    pdfGrayToEngine,
    engineGrayToPDF,
    pdfCMYKToEngine,
    engineCMYKToPDF,
    pdfLabToEngine,
    engineLabToPDF,
    // Type detection
    determineSourceColorType,
    // Color value conversion
    pdfToEngineColorValue,
    engineToPDFColorValue,
    getComponentCount,
    getPixelFormat,
    // Batch helpers
    groupColorsBySourceType,
    createBatchInputArray,
    extractBatchOutputValues,
    // Content stream parsing
    COLOR_OPERATOR_REGEX,
    parseContentStreamColors,
    isStrokeOperator,
    getOperatorForColorType,
    formatColorValues,
    replaceContentStreamColors,
    // Content stream conversion (for workers)
    convertContentStreamColors,
};
