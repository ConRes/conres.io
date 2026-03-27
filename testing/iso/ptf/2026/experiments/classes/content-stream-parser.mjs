// @ts-check
/**
 * Content Stream Parser
 *
 * Minimal parser for PDF content stream color operators.
 * Extracted from PDFContentStreamColorConverter for use in verification scripts.
 *
 * This uses the exact same regex and state tracking as the production class
 * to ensure operator indexing matches between parsing and conversion.
 */

import { COLOR_OPERATOR_REGEX } from '../../services/helpers/pdf-lib.js';

/**
 * @typedef {{
 *   strokeColorSpace?: string,
 *   fillColorSpace?: string,
 * }} ColorSpaceState
 */

/**
 * @typedef {{
 *   type: 'gray' | 'rgb' | 'cmyk' | 'indexed' | 'colorspace',
 *   operator: string,
 *   values?: number[],
 *   colorSpaceName?: string,
 *   name?: string,
 *   index: number,
 *   length: number,
 *   raw: string,
 * }} ParsedColorOperation
 */

/**
 * Parse color operators from a PDF content stream.
 *
 * This function matches the exact parsing logic in PDFContentStreamColorConverter.parseContentStream()
 * to ensure consistent operator indexing between verification and conversion.
 *
 * @param {string} streamText - Content stream text
 * @param {ColorSpaceState} [initialState] - Initial color space state from previous stream
 * @returns {{operations: ParsedColorOperation[], finalState: ColorSpaceState}} Parsed operations and final state
 */
export function parseContentStream(streamText, initialState = {}) {
    /** @type {ParsedColorOperation[]} */
    const operations = [];

    // Track separate stroke/fill color space contexts
    // Stroke: set by CS (uppercase), used by SC/SCN (uppercase)
    // Fill: set by cs (lowercase), used by sc/scn (lowercase)
    /** @type {string | undefined} */
    let currentStrokeColorSpace = initialState.strokeColorSpace;
    /** @type {string | undefined} */
    let currentFillColorSpace = initialState.fillColorSpace;

    const regex = new RegExp(COLOR_OPERATOR_REGEX.source, 'ug');
    const matches = Array.from(streamText.matchAll(regex));

    for (const match of matches) {
        const groups = match.groups ?? {};
        const matchIndex = match.index ?? 0;
        const headLength = groups.head?.length ?? 0;
        const colorIndex = matchIndex + headLength;
        const fullMatchLength = match[0].length;
        const colorOpLength = fullMatchLength - headLength;

        // Color space operator (CS/cs) - sets the context
        if (groups.csOp && groups.name) {
            const isStroke = groups.csOp === 'CS';
            const name = groups.name.replace(/^\//, '');
            if (isStroke) {
                currentStrokeColorSpace = name;
            } else {
                currentFillColorSpace = name;
            }
            operations.push({
                type: 'colorspace',
                operator: groups.csOp,
                name: groups.name,
                index: colorIndex,
                length: colorOpLength,
                raw: match[0].slice(headLength),
            });
            continue;
        }

        // Gray color (G/g)
        if (groups.gray && groups.gOp) {
            operations.push({
                type: 'gray',
                operator: groups.gOp,
                values: [parseFloat(groups.gray)],
                index: colorIndex,
                length: colorOpLength,
                raw: match[0].slice(headLength),
            });
            continue;
        }

        // RGB color (RG/rg)
        if (groups.rgb && groups.rgOp) {
            const rgbValues = groups.rgb.trim().split(/\s+/).map(parseFloat);
            operations.push({
                type: 'rgb',
                operator: groups.rgOp,
                values: rgbValues,
                index: colorIndex,
                length: colorOpLength,
                raw: match[0].slice(headLength),
            });
            continue;
        }

        // CMYK color (K/k)
        if (groups.cmyk && groups.kOp) {
            const cmykValues = groups.cmyk.trim().split(/\s+/).map(parseFloat);
            operations.push({
                type: 'cmyk',
                operator: groups.kOp,
                values: cmykValues,
                index: colorIndex,
                length: colorOpLength,
                raw: match[0].slice(headLength),
            });
            continue;
        }

        // Named color space with SCN/scn (e.g., "/CS0 scn")
        if (groups.scnOp && groups.name2) {
            operations.push({
                type: 'colorspace',
                operator: groups.scnOp,
                name: groups.name2,
                index: colorIndex,
                length: colorOpLength,
                raw: match[0].slice(headLength),
            });
            continue;
        }

        // Numeric color values with SC/sc/SCN/scn
        if (groups.scOp && groups.n) {
            const operator = groups.scOp;
            const isStroke = operator === 'SC' || operator === 'SCN';
            const colorSpaceName = isStroke ? currentStrokeColorSpace : currentFillColorSpace;
            const values = groups.n.trim().split(/\s+/).map(parseFloat);

            operations.push({
                type: 'indexed',
                operator: operator,
                values: values,
                colorSpaceName: colorSpaceName,
                index: colorIndex,
                length: colorOpLength,
                raw: match[0].slice(headLength),
            });
            continue;
        }
    }

    return {
        operations,
        finalState: {
            strokeColorSpace: currentStrokeColorSpace,
            fillColorSpace: currentFillColorSpace,
        },
    };
}

/**
 * Get color operations only (filter out colorspace and other non-color ops).
 *
 * @param {ParsedColorOperation[]} operations - All parsed operations
 * @returns {ParsedColorOperation[]} Only color-setting operations
 */
export function getColorOperations(operations) {
    return operations.filter(op =>
        op.type === 'gray' ||
        op.type === 'rgb' ||
        op.type === 'cmyk' ||
        op.type === 'indexed'
    );
}
