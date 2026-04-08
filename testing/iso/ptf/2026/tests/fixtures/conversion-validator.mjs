// @ts-check
/**
 * Conversion output validator for test fixtures.
 *
 * Validates converted PDF output against expected behavior using:
 * - CRC checksums on pixel regions for fast pass/fail
 * - Operator inventory comparison (count, type, order)
 * - Color value tolerance checks
 *
 * @module conversion-validator
 * @author Saleh Abdel Motaal <dev@smotaal.io>
 * @ai Claude Opus 4.6 (code generation)
 */

import { createHash } from 'node:crypto';

/**
 * @typedef {{
 *   operatorCounts: Record<string, number>,
 *   operators: Array<{ operator: string, values: number[] }>,
 *   passthroughHash: string,
 *   ordering: Array<{ type: 'color' | 'drawing', position: number }>,
 * }} StreamInventory
 *
 * @typedef {{
 *   regionCRCs: Record<string, string>,
 *   passRate: number,
 * }} ImageValidation
 *
 * @typedef {{
 *   pageIndex: number,
 *   streams: StreamInventory[],
 *   images: ImageValidation[],
 * }} PageValidation
 *
 * @typedef {{
 *   pageCount: number,
 *   totalStreamsConverted: number,
 *   totalImagesConverted: number,
 *   errors: string[],
 *   pages: PageValidation[],
 * }} ConversionValidation
 */

/**
 * Extract operator inventory from a decompressed content stream.
 *
 * @param {string} streamText - Decompressed content stream text
 * @returns {StreamInventory}
 */
export function extractStreamInventory(streamText) {
    const colorOpRegex = /(?:[\d.\-]+\s+)*(?:k|K|rg|RG|g|G|scn|SCN|sc|SC|cs|CS)\b/g;
    const drawingOpRegex = /(?:[\d.\-]+\s+)*(?:re|m|l|c|v|y|h)\b/g;

    const operatorCounts = { 'cs/CS': 0, 'sc/SC/scn/SCN': 0, 'g/G': 0, 'rg/RG': 0, 'k/K': 0 };

    /** @type {Array<{ operator: string, values: number[] }>} */
    const operators = [];

    /** @type {Array<{ type: 'color' | 'drawing', position: number }>} */
    const ordering = [];

    // Count and extract color operators
    const colorMatches = [...streamText.matchAll(
        /([\d.\-\s]+?)\s*(cs|CS|scn|SCN|sc|SC|g|G|rg|RG|k|K)\b/g
    )];

    for (const match of colorMatches) {
        const op = match[2];
        const valuesStr = match[1].trim();
        const values = valuesStr ? valuesStr.split(/\s+/).map(Number).filter(v => !isNaN(v)) : [];

        if (op === 'cs' || op === 'CS') operatorCounts['cs/CS']++;
        else if (op === 'sc' || op === 'SC' || op === 'scn' || op === 'SCN') operatorCounts['sc/SC/scn/SCN']++;
        else if (op === 'g' || op === 'G') operatorCounts['g/G']++;
        else if (op === 'rg' || op === 'RG') operatorCounts['rg/RG']++;
        else if (op === 'k' || op === 'K') operatorCounts['k/K']++;

        operators.push({ operator: op, values });
        ordering.push({ type: 'color', position: /** @type {number} */ (match.index) });
    }

    // Track drawing operator positions for ordering checks
    const drawingMatches = [...streamText.matchAll(drawingOpRegex)];
    for (const match of drawingMatches) {
        ordering.push({ type: 'drawing', position: /** @type {number} */ (match.index) });
    }

    ordering.sort((a, b) => a.position - b.position);

    // Hash the non-operator content (passthrough bytes)
    const stripped = streamText.replace(
        /([\d.\-]+\s+)*(?:k|K|rg|RG|g|G|scn|SCN|sc|SC|cs|CS)\b/g, ''
    );
    const passthroughHash = createHash('sha256').update(stripped).digest('hex').slice(0, 16);

    return { operatorCounts, operators, passthroughHash, ordering };
}

/**
 * Validate that color operators appear before their associated drawing operations.
 *
 * @param {StreamInventory} inventory
 * @returns {{ valid: boolean, displacedCount: number }}
 */
export function validateOperatorOrdering(inventory) {
    let displacedCount = 0;
    const drawingPositions = inventory.ordering.filter(o => o.type === 'drawing');

    if (drawingPositions.length === 0) return { valid: true, displacedCount: 0 };

    const lastDrawingPos = drawingPositions[drawingPositions.length - 1].position;
    const colorAfterLastDrawing = inventory.ordering.filter(
        o => o.type === 'color' && o.position > lastDrawingPos
    );

    // Color operators after the last drawing op are displaced
    displacedCount = colorAfterLastDrawing.length;

    return {
        valid: displacedCount === 0,
        displacedCount,
    };
}

/**
 * Compare two sets of operator values with a tolerance.
 *
 * @param {number[]} actual
 * @param {number[]} expected
 * @param {number} tolerance
 * @returns {{ match: boolean, maxDelta: number }}
 */
export function compareValues(actual, expected, tolerance = 0.005) {
    if (actual.length !== expected.length) {
        return { match: false, maxDelta: Infinity };
    }
    let maxDelta = 0;
    for (let i = 0; i < actual.length; i++) {
        const delta = Math.abs(actual[i] - expected[i]);
        if (delta > maxDelta) maxDelta = delta;
    }
    return { match: maxDelta <= tolerance, maxDelta };
}

/**
 * Compute CRC of a pixel region for fast comparison.
 *
 * @param {Uint8Array} pixelData
 * @param {number} offset
 * @param {number} length
 * @returns {string} hex CRC
 */
export function regionCRC(pixelData, offset, length) {
    const slice = pixelData.slice(offset, offset + length);
    return createHash('sha256').update(slice).digest('hex').slice(0, 8);
}

/**
 * Check for the known `kn` invalid operator bug.
 *
 * @param {string} streamText
 * @returns {{ found: boolean, positions: number[] }}
 */
export function checkForInvalidOperators(streamText) {
    const positions = [];
    const regex = /\bkn\b/g;
    let match;
    while ((match = regex.exec(streamText)) !== null) {
        positions.push(match.index);
    }
    return { found: positions.length > 0, positions };
}

/**
 * Round color values for snapshot stability.
 *
 * @param {number[]} values
 * @param {number} decimals
 * @returns {number[]}
 */
export function roundValues(values, decimals = 4) {
    const factor = Math.pow(10, decimals);
    return values.map(v => Math.round(v * factor) / factor);
}
