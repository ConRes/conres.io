#!/usr/bin/env node
// @ts-check
/**
 * TIFF Diff CLI Tool
 *
 * Compares two Lab TIFF images pixel-by-pixel using Delta-E 1976.
 * Reports unique color counts and top colors with coordinate-based matching.
 *
 * @module tiff-diff
 */

import fs from 'node:fs';
import zlib from 'node:zlib';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { argv, exit } from 'node:process';

/**
 * Controls how cross-matching statistics are aggregated:
 *
 * - `'None'`: Original position-based approach. Stores per-pixel {x, y} positions
 *   for every unique color. Memory: O(totalPixels). OOMs on large 16-bit images.
 *
 * - `'Maps'`: Two-pass sequential approach using nested Maps. Each unique ref color
 *   holds a sampleFreqs Map tracking sample color frequencies. Memory:
 *   O(uniqueColors × avgVariants). Still OOMs when millions of ref colors each
 *   have nested Map objects.
 *
 * - `'TypedArrays'`: Two-pass approach using parallel typed arrays for per-color
 *   accumulators and a single flat Map for (refIndex, sampleColor) pair frequencies.
 *   Eliminates millions of nested Maps and JS objects. Memory: O(uniqueColors) for
 *   typed arrays + O(uniquePairs) for the flat map. Fits in 8 GB for 10M+ pixel images.
 *
 * @type {'None' | 'Maps' | 'TypedArrays'}
 */
const AGGREGATION_STRATEGY = 'TypedArrays';
const CROSS_MATCH_ROUNDING_DECIMALS = 1;
const LAB_COLUMN_ROUNDING_DECIMALS = 2;
const DELTA_E_COLUMN_ROUNDING_DECIMALS = 3;

// ============================================================================
// Progress Reporting
// ============================================================================

/**
 * Write a progress line to stdout (overwrites current line)
 * @param {string} operation
 * @param {number} percent - 0 to 100
 */
function writeProgress(operation, percent) {
    if (!process.stdout.isTTY) return;
    const barWidth = 30;
    const filled = Math.round(barWidth * Math.min(percent, 100) / 100);
    const bar = '\u2588'.repeat(filled) + '\u2591'.repeat(barWidth - filled);
    const percentStr = String(Math.floor(percent)).padStart(3, ' ');
    process.stdout.write('\x1B[?25l'); // Hide cursor
    process.stdout.clearLine(0);
    process.stdout.cursorTo(0);
    process.stdout.write(`${operation.padEnd(35)} ${bar} ${percentStr}%`);
    process.on('exit', () => {
        process.stdout.write('\x1B[?25h'); // Show cursor
    });
}

/**
 * Clear the progress line
 */
function clearProgress() {
    if (!process.stdout.isTTY) return;
    process.stdout.clearLine(0);
    process.stdout.cursorTo(0);
    process.stdout.write('\x1B[?25h'); // Show cursor
}

/**
 * Log heap memory usage to stderr. Only logs when `enabled` is true.
 * @param {string} label - Description of the current stage
 * @param {boolean} enabled - Whether memory logging is active
 */
function logMemory(label, enabled) {
    if (!enabled) return;
    const mem = process.memoryUsage();
    const heapMB = (mem.heapUsed / 1048576).toFixed(1);
    const rssMB = (mem.rss / 1048576).toFixed(1);
    process.stderr.write(`[memory] ${label}: heap=${heapMB} MB, rss=${rssMB} MB\n`);
}

/**
 * Convert raw TIFF Lab pixels to Lab Float32 values per TIFF 6.0 CIELab encoding.
 *
 * TIFF 6.0 CIELab (PhotometricInterpretation = 8):
 * - 8-bit:  L* [0,255] maps to [0,100], a* / b* signed [-128,127]
 * - 16-bit: L* [0,65535] maps to [0,100], a* / b* signed [-32768,32767] / 256
 *
 * @param {ReturnType<typeof readTIFFImage>} tiffImage
 */
function getLabFloat32ArrayFrom(tiffImage) {
    const { tags, rawPixels, colorSpace } = tiffImage;

    if (!rawPixels || colorSpace !== 'Lab')
        throw new Error('TIFF image is not in Lab color space');

    const labFloat32Array = new Float32Array(rawPixels.length);
    const bitsPerSample = tags.bitsPerSample[0];

    if (bitsPerSample === 8) {
        // 8-bit CIELab: L* unsigned [0,255], a*/b* signed [-128,127]
        for (let i = 0; i < rawPixels.length; i += 3) {
            labFloat32Array[i] = rawPixels[i] / 2.55;                        // L*: 0-255 → 0-100
            labFloat32Array[i + 1] = rawPixels[i + 1] > 127
                ? rawPixels[i + 1] - 256 : rawPixels[i + 1];                 // a*: signed byte
            labFloat32Array[i + 2] = rawPixels[i + 2] > 127
                ? rawPixels[i + 2] - 256 : rawPixels[i + 2];                 // b*: signed byte
        }
    } else if (bitsPerSample === 16) {
        // 16-bit CIELab: L* unsigned [0,65535], a*/b* signed [-32768,32767] scaled by 256
        for (let i = 0; i < rawPixels.length; i += 3) {
            labFloat32Array[i] = rawPixels[i] / 655.35;                      // L*: 0-65535 → 0-100
            const rawA = rawPixels[i + 1] > 32767 ? rawPixels[i + 1] - 65536 : rawPixels[i + 1];
            const rawB = rawPixels[i + 2] > 32767 ? rawPixels[i + 2] - 65536 : rawPixels[i + 2];
            labFloat32Array[i + 1] = rawA / 256;                             // a*: signed/256
            labFloat32Array[i + 2] = rawB / 256;                             // b*: signed/256
        }
    } else if (bitsPerSample === 32) {
        // 32-bit float: assume already in Lab* units
        labFloat32Array.set(rawPixels);
    } else {
        throw new Error(`Unsupported BitsPerSample for Lab: ${bitsPerSample}`);
    }

    return labFloat32Array;
}

/**
 * @param {string | URL} filePath
 */
function readTIFFImage(filePath) {
    const buffer = fs.readFileSync(filePath);
    const bufferEndianness = buffer.toString('utf8', 0, 2) === 'II' ? 'little' : 'big';

    /** @type {Record<'readU16' | 'readU32', (offset: number) => number>} */
    const { readU16, readU32 } = bufferEndianness === 'little' ? {
        readU16: offset => buffer.readUInt16LE(offset),
        readU32: offset => buffer.readUInt32LE(offset)
    } : {
        readU16: offset => buffer.readUInt16BE(offset),
        readU32: offset => buffer.readUInt32BE(offset)
    };

    /**
     * Read tag value based on type and count
     * TIFF stores values directly in the 4-byte field if they fit, otherwise as an offset
     * @param {number} tagOffset
     * @param {number} type - TIFF type (1=BYTE, 3=SHORT, 4=LONG)
     * @param {number} count
     * @returns {number}
     */
    const readTagValue = (tagOffset, type, count) => {
        // Type 3 (SHORT) = 2 bytes per value
        if (type === 3 && count === 1) {
            return readU16(tagOffset + 8);
        }
        // Type 4 (LONG) = 4 bytes per value, or fallback
        return readU32(tagOffset + 8);
    };

    /**
     * Read array of LONG values from offset
     * @param {number} offset
     * @param {number} count
     * @returns {number[]}
     */
    const readU32Array = (offset, count) =>
        Array.from({ length: count }, (_, i) => readU32(offset + i * 4));

    const tagsOffset = readU32(4);
    const tagsCount = readU16(tagsOffset);
    /** @type {Record<string, any>} */
    const tags = {};

    for (let i = 0; i < tagsCount; i++) {
        const tagOffset = tagsOffset + 2 + i * 12;
        const tag = readU16(tagOffset);
        const type = readU16(tagOffset + 2);
        const count = readU32(tagOffset + 4);
        const value = readTagValue(tagOffset, type, count);
        const valueOrOffset = readU32(tagOffset + 8);

        switch (tag) {
            case 273: // StripOffsets
                tags.stripOffsets = count === 1 ? [value] : readU32Array(valueOrOffset, count);
                continue;
            case 279: // StripByteCounts
                tags.stripByteCounts = count === 1 ? [value] : readU32Array(valueOrOffset, count);
                continue;
            case 256: tags.width = value; continue;
            case 257: tags.height = value; continue;
            case 259: tags.compression = { 1: 'None', 5: 'LZW', 8: 'ZIP', 32773: 'PackBits' }[value] || value; continue;
            case 262: {
                tags.photometricInterpretation = value;
                tags.colorSpace = { 1: 'Gray', 2: 'RGB', 5: 'CMYK', 8: 'Lab' }[value] || value;
                continue;
            }
            case 277: tags.samplesPerPixel = value; continue;
            case 278: tags.rowsPerStrip = value; continue;
            case 284: tags.planarConfiguration = value; continue;
            case 339: { // SampleFormat
                if (count === 1) {
                    tags.sampleFormat = [readU16(tagOffset + 8)];
                } else if (count === 2) {
                    tags.sampleFormat = [readU16(tagOffset + 8), readU16(tagOffset + 10)];
                } else {
                    tags.sampleFormat = Array.from({ length: count }, (_, j) => readU16(valueOrOffset + (j * 2)));
                }
                continue;
            }
            case 258: { // BitsPerSample Tag
                // If count is 1 (e.g. Grayscale), value is directly in the entry
                if (count === 1) {
                    tags.bitsPerSample = [readU16(tagOffset + 8)];
                } else if (count === 2) {
                    // Two SHORTs fit in the 4-byte field
                    tags.bitsPerSample = [readU16(tagOffset + 8), readU16(tagOffset + 10)];
                } else {
                    // If count > 2 (e.g. RGB/Lab), valueOrOffset is a pointer to an array of SHORTs
                    tags.bitsPerSample = Array.from({ length: count }, (_, j) => readU16(valueOrOffset + (j * 2)));
                }
                continue;
            }
            case 34675: { // ICC Profile
                const profileOffset = valueOrOffset;
                const profileLength = count;
                const profileBuffer = buffer.subarray(profileOffset, profileOffset + profileLength);
                const profileDescriptionOffset = profileBuffer.indexOf('desc');
                if (profileDescriptionOffset !== -1) {
                    // Profiles are always big endian
                    tags.profile = profileBuffer.toString('utf8', profileDescriptionOffset + 12, profileDescriptionOffset + 12 + profileBuffer.readUInt32BE(profileDescriptionOffset + 8) - 1);
                }
                continue;
            }
        }
    }

    // Decompress and concatenate all strips
    const decompressedStrips = [];
    const stripCount = tags.stripOffsets.length;

    for (let s = 0; s < stripCount; s++) {
        const stripOffset = tags.stripOffsets[s];
        const stripLength = tags.stripByteCounts[s];
        const stripData = buffer.subarray(stripOffset, stripOffset + stripLength);

        let decompressed;
        if (tags.compression === 'None') {
            decompressed = stripData;
        } else if (tags.compression === 'LZW') {
            decompressed = decodeTIFFLZW(stripData);
        } else if (tags.compression === 'ZIP') {
            decompressed = zlib.inflateSync(stripData);
        } else {
            throw new Error(`Unsupported compression: ${tags.compression}`);
        }

        decompressedStrips.push(decompressed);
    }

    // Concatenate all strips
    const totalLength = decompressedStrips.reduce((sum, strip) => sum + strip.length, 0);
    const rawBuffer = Buffer.concat(decompressedStrips, totalLength);

    let rawPixels;
    if (tags.bitsPerSample[0] === 8) {
        rawPixels = new Uint8Array(rawBuffer);
    } else if (tags.bitsPerSample[0] === 16) {
        // Handle endianness for 16-bit data
        const pixelCount = rawBuffer.length / 2;
        rawPixels = new Uint16Array(pixelCount);
        if (bufferEndianness === 'big') {
            // Big-endian TIFF: read as big-endian
            for (let i = 0; i < pixelCount; i++) {
                rawPixels[i] = rawBuffer.readUInt16BE(i * 2);
            }
        } else {
            // Little-endian TIFF: read as little-endian
            for (let i = 0; i < pixelCount; i++) {
                rawPixels[i] = rawBuffer.readUInt16LE(i * 2);
            }
        }
    } else if (tags.bitsPerSample[0] === 32) {
        rawPixels = new Float32Array(rawBuffer.buffer, rawBuffer.byteOffset, rawBuffer.length / 4);
    } else {
        rawPixels = null;
    }

    const colorSpace = /** @type { 'RGB'|'Gray'|'Lab'|'CMYK' } */(tags.colorSpace);

    return { colorSpace, rawPixels, width: tags.width, height: tags.height, channels: tags.samplesPerPixel, endianness: bufferEndianness, tags };
}

/**
 * @param {Buffer} inputBuffer
 */
function decodeTIFFLZW(inputBuffer) {
    /** @type {number[][]} */
    let dictionary = [];
    const resetDictionary = () => {
        dictionary = Array.from({ length: 256 }, (_, i) => [i]);
        dictionary[256] = []; // Clear Code
        dictionary[257] = []; // EOI Code
    };

    resetDictionary();

    let result = [], bitBuffer = 0, bitCount = 0, codeSize = 9, offset = 0;

    const getNextCode = () => {
        while (bitCount < codeSize) {
            if (offset >= inputBuffer.length) return 257; // EOI if out of data
            bitBuffer = (bitBuffer << 8) | inputBuffer[offset++];
            bitCount += 8;
        }
        let code = (bitBuffer >> (bitCount - codeSize)) & ((1 << codeSize) - 1);
        bitCount -= codeSize;
        return code;
    };

    let prevCode = null;
    while (true) {
        let code = getNextCode();
        if (code === 257) break; // End of Information
        if (code === 256) {      // Clear Code
            resetDictionary();
            codeSize = 9;
            prevCode = null;
            continue;
        }

        let entry;

        if (dictionary[code]) {
            entry = dictionary[code];
        } else if (code === dictionary.length && prevCode !== null) {
            entry = dictionary[prevCode].concat(dictionary[prevCode][0]);
        } else {
            throw new Error(`Invalid LZW code: ${code}`);
        }

        result.push(...entry);

        if (prevCode !== null) {
            dictionary.push(dictionary[prevCode].concat(entry[0]));
            // Expand bit size per TIFF spec
            if (dictionary.length === 511) codeSize = 10;
            else if (dictionary.length === 1023) codeSize = 11;
            else if (dictionary.length === 2047) codeSize = 12;
        }
        prevCode = code;
    }
    return Buffer.from(result);
}

// ============================================================================
// Delta-E 1976 Calculation
// ============================================================================

/**
 * Calculate Delta-E 1976 between two Lab colors
 * @param {number} L1
 * @param {number} a1
 * @param {number} b1
 * @param {number} L2
 * @param {number} a2
 * @param {number} b2
 * @returns {number}
 */
function deltaE76(L1, a1, b1, L2, a2, b2) {
    const dL = L1 - L2;
    const da = a1 - a2;
    const db = b1 - b2;
    return Math.sqrt(dL * dL + da * da + db * db);
}

// ============================================================================
// Argument Parsing
// ============================================================================

function printUsage() {
    console.log(`
TIFF Diff CLI Tool

Compares two Lab TIFF images pixel-by-pixel using Delta-E 1976.
Reports unique color counts and top colors with coordinate-based matching.

Usage:
  node tiff-diff.js <reference.tif> <sample.tif> [options]

Arguments:
  <reference.tif>   The reference TIFF image (must be Lab color space)
  <sample.tif>      The sample TIFF image to compare (must be Lab color space)

Options:
  --top=<N>                      Number of top unique colors to display (default: 10)
  --without-cross-matching       Disable cross-matching analysis (enabled by default)
  --without-cross-match-rounding Disable rounding for color grouping
  --with-extended-statistics     Show Min ΔE and Min ΔEin columns
  --baseline-aggregation         Use original position-based aggregation (AGGREGATION_STRATEGY='None')
  --map-aggregation              Use nested-Maps aggregation (AGGREGATION_STRATEGY='Maps')
  --default-aggregation          Use typed-arrays aggregation (default, AGGREGATION_STRATEGY='TypedArrays')
  --debug-memory-footprint       Log heap memory usage at critical stages to stderr
  --verbose, -v                  Show detailed output
  --help, -h                     Show this help message

Output:
  - JSON file saved to <sample.tif>.json with full comparison data
  - Console output with Delta-E statistics, unique color counts, and top colors

Examples:
  node tiff-diff.js reference.tif sample.tif
  node tiff-diff.js reference.tif sample.tif --top=20 --verbose
`);
}

/**
 * @typedef {{
 *   referencePath: string | undefined,
 *   samplePath: string | undefined,
 *   topCount: number,
 *   crossMatching: boolean,
 *   crossMatchRounding: boolean,
 *   extendedStatistics: boolean,
 *   verbose: boolean,
 *   aggregationStrategy: 'None' | 'Maps' | 'TypedArrays',
 *   debugMemoryFootprint: boolean,
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
        topCount: 10,
        crossMatching: true,
        crossMatchRounding: true,
        extendedStatistics: false,
        aggregationStrategy: AGGREGATION_STRATEGY,
        debugMemoryFootprint: false,
        verbose: false,
    };

    for (const arg of args) {
        if (arg === '') continue;

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

        // Cross-matching
        if (arg === '--without-cross-matching') {
            options.crossMatching = false;
            continue;
        }

        // Cross-match rounding
        if (arg === '--without-cross-match-rounding') {
            options.crossMatchRounding = false;
            continue;
        }

        // Extended statistics
        if (arg === '--with-extended-statistics') {
            options.extendedStatistics = true;
            continue;
        }

        // Aggregation strategy (mutually exclusive)
        if (arg === '--baseline-aggregation') {
            options.aggregationStrategy = 'None';
            continue;
        }
        if (arg === '--map-aggregation') {
            options.aggregationStrategy = 'Maps';
            continue;
        }
        if (arg === '--default-aggregation') {
            options.aggregationStrategy = 'TypedArrays';
            continue;
        }

        // Debug memory footprint
        if (arg === '--debug-memory-footprint') {
            options.debugMemoryFootprint = true;
            continue;
        }

        // Top count
        if (arg.startsWith('--top=')) {
            options.topCount = parseInt(arg.split('=')[1], 10);
            continue;
        }

        // Positional arguments
        if (!arg.startsWith('-')) {
            positional.push(arg);
            continue;
        }

        console.error(`Unknown option: ${arg}`);
        exit(1);
    }

    return {
        referencePath: positional[0],
        samplePath: positional[1],
        ...options,
    };
}

// ============================================================================
// Color Key Generation
// ============================================================================

/** @param {number} value @param {number} [decimals=0] */
const round = (value, decimals = 0) => Math.round(value * 10 ** decimals) / 10 ** decimals;

// ============================================================================
// Footnote System
// ============================================================================

const SUPERSCRIPT_DIGITS = ['⁰', '¹', '²', '³', '⁴', '⁵', '⁶', '⁷', '⁸', '⁹'];

/**
 * Convert a number to superscript Unicode digits.
 * @param {number} n
 * @returns {string}
 */
function superscript(n) {
    return String(n).split('').map(d => SUPERSCRIPT_DIGITS[parseInt(d)]).join('');
}

/**
 * Footnote definitions for table column headings.
 * Each footnote is referenced by a superscript number in column headings
 * and printed after the table via console.log.
 */
const FOOTNOTES = {
    labRounding: {
        number: 1,
        text: `Lab values rounded to ${LAB_COLUMN_ROUNDING_DECIMALS} decimal places for display`,
    },
    deltaERounding: {
        number: 2,
        text: `ΔE and StdDev values rounded to ${DELTA_E_COLUMN_ROUNDING_DECIMALS} decimal places for display`,
    },
    pixels: {
        number: 3,
        text: `Pixels: total pixel count where this color appears in the image`,
    },
    match: {
        number: 4,
        text: `Match: whether any sample pixel at this reference color's positions has ΔE < 1`,
    },
    crossMatchGrouping: {
        number: 5,
        text: `Overlaps: pixel count of the most frequent sample variant (grouped by rounding to ${CROSS_MATCH_ROUNDING_DECIMALS} dp). Variants: distinct sample variant groups. Coverage: Overlaps ÷ Pixels`,
    },
};

/**
 * Print footnotes to console.
 * @param  {...{number: number, text: string}} footnotes
 */
function printFootnotes(...footnotes) {
    for (const footnote of footnotes) {
        console.log(`  ${superscript(footnote.number)} ${footnote.text}`);
    }
}

// ============================================================================
// Unique Color Analysis
// ============================================================================

/**
 * @typedef {{
 *   L: number,
 *   a: number,
 *   b: number,
 *   count: number,
 *   positions: Array<{x: number, y: number}>,
 * }} UniqueColor
 */

/**
 * @typedef {{
 *   L: number,
 *   a: number,
 *   b: number,
 *   count: number,
 *   rank: number,
 *   overlaps: number,
 *   variants: number,
 *   deltaE: {
 *     mean: number,
 *     min: number,
 *     max: number,
 *     stdDev: number,
 *   },
 *   deltaEin: {
 *     mean: number,
 *     min: number,
 *     max: number,
 *   },
 * }} CrossMatchedColor
 */

/**
 * @typedef {{
 *   rank: number,
 *   reference: { L: number, a: number, b: number },
 *   sample: { L: number, a: number, b: number },
 *   pixels: number,
 *   overlaps: number,
 *   variants: number,
 *   coverage: number,
 *   deltaE: {
 *     mean: number,
 *     min: number,
 *     max: number,
 *     stdDev: number,
 *   },
 *   deltaEin: {
 *     mean: number,
 *     min: number,
 *     max: number,
 *   },
 * }} VariabilityColor
 */

/**
 * Collect unique Lab colors from a Float32Array
 * @param {Float32Array} labArray
 * @param {number} width
 * @param {number} height
 * @param {boolean} [storeAllPositions=false] - Store all positions (for cross-matching)
 * @returns {Map<string, UniqueColor>}
 */
function collectUniqueColors(labArray, width, height, storeAllPositions = false) {
    /** @type {Map<string, UniqueColor>} */
    const uniqueColors = new Map();
    const maxPositions = storeAllPositions ? Infinity : 100;

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const idx = (y * width + x) * 3;
            const L = labArray[idx];
            const a = labArray[idx + 1];
            const b = labArray[idx + 2];

            // Round to 2 decimal places for grouping
            const key = `${L.toFixed(2)},${a.toFixed(2)},${b.toFixed(2)}`;

            if (uniqueColors.has(key)) {
                const existing = uniqueColors.get(key);
                existing.count++;
                if (existing.positions.length < maxPositions) {
                    existing.positions.push({ x, y });
                }
            } else {
                uniqueColors.set(key, { L, a, b, count: 1, positions: [{ x, y }] });
            }
        }
    }

    return uniqueColors;
}

/**
 * Compute cross-matched Delta-E statistics for each reference color
 * @param {UniqueColor[]} refTopColors - Top reference colors with positions
 * @param {Float32Array} sampleLab - Sample Lab array
 * @param {number} width - Image width
 * @param {boolean} [crossMatchRounding=true] - Round sample values to integers for comparison
 * @returns {CrossMatchedColor[]}
 */
function computeCrossMatchStats(refTopColors, sampleLab, width, crossMatchRounding = true) {
    return refTopColors.map((refColor, idx) => {
        let sum = 0;
        let min = Infinity;
        let max = -Infinity;
        let count = 0;
        let sumSL = 0, sumSa = 0, sumSb = 0;
        /** @type {Map<string, number>} */
        const sampleColorFrequencies = new Map();

        // First pass: Delta-E vs reference, sample frequencies, and sample Lab accumulation
        for (const pos of refColor.positions) {
            const sampleIdx = (pos.y * width + pos.x) * 3;
            const sL = sampleLab[sampleIdx];
            const sa = sampleLab[sampleIdx + 1];
            const sb = sampleLab[sampleIdx + 2];

            const de = deltaE76(refColor.L, refColor.a, refColor.b, sL, sa, sb);
            sum += de;
            if (de < min) min = de;
            if (de > max) max = de;
            count++;

            sumSL += sL;
            sumSa += sa;
            sumSb += sb;

            // Track sample color frequencies at reference positions
            const kL = crossMatchRounding ? round(sL, CROSS_MATCH_ROUNDING_DECIMALS) : sL;
            const ka = crossMatchRounding ? round(sa, CROSS_MATCH_ROUNDING_DECIMALS) : sa;
            const kb = crossMatchRounding ? round(sb, CROSS_MATCH_ROUNDING_DECIMALS) : sb;
            const sampleKey = `${kL},${ka},${kb}`;
            sampleColorFrequencies.set(sampleKey, (sampleColorFrequencies.get(sampleKey) ?? 0) + 1);
        }

        const mean = sum / count;
        const meanSL = sumSL / count;
        const meanSa = sumSa / count;
        const meanSb = sumSb / count;

        // Second pass: standard deviation + ΔEin (sample vs mean sample)
        let sumSquaredDiff = 0;
        let deinSum = 0, deinMin = Infinity, deinMax = -Infinity;
        for (const pos of refColor.positions) {
            const sampleIdx = (pos.y * width + pos.x) * 3;
            const sL = sampleLab[sampleIdx];
            const sa = sampleLab[sampleIdx + 1];
            const sb = sampleLab[sampleIdx + 2];

            const de = deltaE76(refColor.L, refColor.a, refColor.b, sL, sa, sb);
            sumSquaredDiff += (de - mean) ** 2;

            const dein = deltaE76(sL, sa, sb, meanSL, meanSa, meanSb);
            deinSum += dein;
            if (dein < deinMin) deinMin = dein;
            if (dein > deinMax) deinMax = dein;
        }
        const stdDev = Math.sqrt(sumSquaredDiff / count);

        // Overlaps: frequency of the most commonly occurring sample value
        let overlaps = 0;
        for (const frequency of sampleColorFrequencies.values()) {
            if (frequency > overlaps) overlaps = frequency;
        }

        return {
            L: refColor.L,
            a: refColor.a,
            b: refColor.b,
            count: refColor.count,
            rank: idx + 1,
            overlaps,
            variants: sampleColorFrequencies.size,
            deltaE: {
                mean: mean,
                min: min,
                max: max,
                stdDev: stdDev,
            },
            deltaEin: {
                mean: deinSum / count,
                min: deinMin,
                max: deinMax,
            },
        };
    });
}

/**
 * Compute variability stats for ALL unique reference colors by coverage (Overlaps/Pixel ratio).
 * Returns a single array sorted from highest to lowest coverage.
 * @param {Map<string, UniqueColor>} refUniqueColors
 * @param {Float32Array} sampleLab
 * @param {number} width
 * @param {boolean} [crossMatchRounding=true] - Round sample values to integers for comparison
 * @param {((fraction: number) => void) | null} [onProgress]
 * @returns {VariabilityColor[]}
 */
function computeVariabilityStats(refUniqueColors, sampleLab, width, crossMatchRounding = true, onProgress) {
    /** @type {VariabilityColor[]} */
    const results = [];
    const totalColors = refUniqueColors.size;
    let processed = 0;
    const progressInterval = Math.max(1, Math.ceil(totalColors / 20));

    for (const [, color] of refUniqueColors) {
        /** @type {Map<string, number>} */
        const sampleFreqs = new Map();
        let deSum = 0, deMin = Infinity, deMax = -Infinity;
        let sumSL = 0, sumSa = 0, sumSb = 0;
        const posCount = color.positions.length;

        // First pass: Delta-E vs reference, sample frequencies, sample Lab accumulation
        for (const pos of color.positions) {
            const idx = (pos.y * width + pos.x) * 3;
            const sL = sampleLab[idx], sa = sampleLab[idx + 1], sb = sampleLab[idx + 2];
            const kL = crossMatchRounding ? round(sL, CROSS_MATCH_ROUNDING_DECIMALS) : sL;
            const ka = crossMatchRounding ? round(sa, CROSS_MATCH_ROUNDING_DECIMALS) : sa;
            const kb = crossMatchRounding ? round(sb, CROSS_MATCH_ROUNDING_DECIMALS) : sb;
            const sKey = `${kL},${ka},${kb}`;
            sampleFreqs.set(sKey, (sampleFreqs.get(sKey) ?? 0) + 1);

            const de = deltaE76(color.L, color.a, color.b, sL, sa, sb);
            deSum += de;
            if (de < deMin) deMin = de;
            if (de > deMax) deMax = de;

            sumSL += sL;
            sumSa += sa;
            sumSb += sb;
        }

        const deMean = deSum / posCount;
        const meanSL = sumSL / posCount;
        const meanSa = sumSa / posCount;
        const meanSb = sumSb / posCount;

        // Second pass: standard deviation + ΔEin (sample vs mean sample)
        let sumSqDiff = 0;
        let deinSum = 0, deinMin = Infinity, deinMax = -Infinity;
        for (const pos of color.positions) {
            const idx = (pos.y * width + pos.x) * 3;
            const sL = sampleLab[idx], sa = sampleLab[idx + 1], sb = sampleLab[idx + 2];

            const de = deltaE76(color.L, color.a, color.b, sL, sa, sb);
            sumSqDiff += (de - deMean) ** 2;

            const dein = deltaE76(sL, sa, sb, meanSL, meanSa, meanSb);
            deinSum += dein;
            if (dein < deinMin) deinMin = dein;
            if (dein > deinMax) deinMax = dein;
        }
        const deStdDev = Math.sqrt(sumSqDiff / posCount);

        // Find dominant sample color and overlaps
        let overlaps = 0;
        let dominantKey = '';
        for (const [sKey, freq] of sampleFreqs) {
            if (freq > overlaps) { overlaps = freq; dominantKey = sKey; }
        }

        const [sL, sa, sb] = dominantKey.split(',').map(Number);

        results.push({
            rank: 0, // assigned after sorting
            reference: { L: color.L, a: color.a, b: color.b },
            sample: { L: sL, a: sa, b: sb },
            pixels: color.count,
            overlaps,
            variants: sampleFreqs.size,
            coverage: overlaps / color.count,
            deltaE: { mean: deMean, min: deMin, max: deMax, stdDev: deStdDev },
            deltaEin: { mean: deinSum / posCount, min: deinMin, max: deinMax },
        });

        processed++;
        if (onProgress && processed % progressInterval === 0) {
            onProgress(processed / totalColors);
        }
    }

    // Sort highest to lowest coverage
    results.sort((a, b) => (Math.min(Math.max(b.coverage, 0), 1) - Math.min(Math.max(a.coverage, 0), 1)) || (b.overlaps - a.overlaps) || (b.pixels - a.pixels));

    // Assign ranks
    for (let i = 0; i < results.length; i++) {
        results[i].rank = i + 1;
    }

    return results;
}

/**
 * Get top N unique colors sorted by count
 * @param {Map<string, UniqueColor>} uniqueColors
 * @param {number} topN
 * @returns {UniqueColor[]}
 */
function getTopUniqueColors(uniqueColors, topN) {
    return Array.from(uniqueColors.values())
        .sort((a, b) => b.count - a.count)
        .slice(0, topN);
}

// ============================================================================
// Sequential Nested Map Approach (USE_SEQUENTIAL_NESTED_MAP)
// ============================================================================

/**
 * @typedef {{
 *   L: number, a: number, b: number,
 *   count: number,
 *   sampleFreqs: Map<string, number> | null,
 *   deSum: number, deMin: number, deMax: number,
 *   sumSL: number, sumSa: number, sumSb: number,
 *   deMean: number, meanSL: number, meanSa: number, meanSb: number,
 *   sumSquaredDiff: number,
 *   deinSum: number, deinMin: number, deinMax: number,
 *   matched: boolean,
 * }} RefColorAccumulator
 */

/**
 * Collect all comparison statistics using a two-pass sequential approach.
 *
 * Pass 1: Iterate both pixel arrays. For each pixel, compute Delta-E,
 * accumulate global stats, build unique color maps, and for cross-matching
 * accumulate per-ref-color sample frequencies and Delta-E stats.
 *
 * Pass 2 (cross-matching only): Iterate again to compute stdDev and ΔEin
 * using the mean values computed between passes.
 *
 * Memory: O(uniqueRefColors × avgVariants + uniqueSampleColors) instead of
 * O(totalPixels) for the position-based approach.
 *
 * @param {Float32Array} refLab
 * @param {Float32Array} sampleLab
 * @param {number} width
 * @param {number} height
 * @param {number} topCount
 * @param {boolean} crossMatching
 * @param {boolean} crossMatchRounding
 * @param {boolean} verbose
 * @returns {{
 *   deltaE: { min: number, max: number, mean: number, median: number, stdDev: number, histogram: Record<string, number> },
 *   refUniqueColorCount: number,
 *   sampleUniqueColorCount: number,
 *   topColors: { reference: any[], sample: any[] },
 *   crossMatched: CrossMatchedColor[] | undefined,
 *   variability: VariabilityColor[] | undefined,
 * }}
 */
function collectAllStatsSequential(refLab, sampleLab, width, height, topCount, crossMatching, crossMatchRounding, verbose, debugMemoryFootprint = false) {
    const pixelCount = width * height;

    try {
        // ---- Pass 1 ----
        logMemory('Maps — before Pass 1', debugMemoryFootprint);
        writeProgress('Pass 1: Collecting statistics', 20);
        if (verbose) console.log('Pass 1: Collecting statistics...');

        const deltaEValues = new Float32Array(pixelCount);
        let deGlobalSum = 0;
        const histogram = { '0': 0, '0-1': 0, '1-2': 0, '2-5': 0, '5-10': 0, '10+': 0 };

        /** @type {Map<string, RefColorAccumulator>} */
        const refColors = new Map();

        /** @type {Map<string, { L: number, a: number, b: number, count: number, matched: boolean }>} */
        const sampleColors = new Map();

        const progressInterval = Math.max(1, Math.ceil(pixelCount / 20));

        for (let i = 0; i < pixelCount; i++) {
            const idx = i * 3;
            const rL = refLab[idx], ra = refLab[idx + 1], rb = refLab[idx + 2];
            const sL = sampleLab[idx], sa = sampleLab[idx + 1], sb = sampleLab[idx + 2];

            // Delta-E
            const de = deltaE76(rL, ra, rb, sL, sa, sb);
            deltaEValues[i] = de;
            deGlobalSum += de;

            // Histogram
            if (de === 0) histogram['0']++;
            else if (de < 1) histogram['0-1']++;
            else if (de < 2) histogram['1-2']++;
            else if (de < 5) histogram['2-5']++;
            else if (de < 10) histogram['5-10']++;
            else histogram['10+']++;

            // Reference unique color
            const refKey = `${rL.toFixed(2)},${ra.toFixed(2)},${rb.toFixed(2)}`;
            let refEntry = refColors.get(refKey);
            if (!refEntry) {
                refEntry = {
                    L: rL, a: ra, b: rb, count: 0,
                    sampleFreqs: crossMatching ? new Map() : null,
                    deSum: 0, deMin: Infinity, deMax: -Infinity,
                    sumSL: 0, sumSa: 0, sumSb: 0,
                    deMean: 0, meanSL: 0, meanSa: 0, meanSb: 0,
                    sumSquaredDiff: 0,
                    deinSum: 0, deinMin: Infinity, deinMax: -Infinity,
                    matched: false,
                };
                refColors.set(refKey, refEntry);
            }
            refEntry.count++;

            if (crossMatching) {
                refEntry.deSum += de;
                if (de < refEntry.deMin) refEntry.deMin = de;
                if (de > refEntry.deMax) refEntry.deMax = de;
                refEntry.sumSL += sL;
                refEntry.sumSa += sa;
                refEntry.sumSb += sb;

                // Sample frequency at ref positions
                const kL = crossMatchRounding ? round(sL, 0) : sL;
                const ka = crossMatchRounding ? round(sa, 0) : sa;
                const kb = crossMatchRounding ? round(sb, 0) : sb;
                const sampleKey = `${kL},${ka},${kb}`;
                refEntry.sampleFreqs.set(sampleKey, (refEntry.sampleFreqs.get(sampleKey) ?? 0) + 1);
            }

            if (de < 1) refEntry.matched = true;

            // Sample unique color
            const sampleKey2 = `${sL.toFixed(2)},${sa.toFixed(2)},${sb.toFixed(2)}`;
            let sampleEntry = sampleColors.get(sampleKey2);
            if (!sampleEntry) {
                sampleEntry = { L: sL, a: sa, b: sb, count: 0, matched: false };
                sampleColors.set(sampleKey2, sampleEntry);
            }
            sampleEntry.count++;
            if (de < 1) sampleEntry.matched = true;

            if (i % progressInterval === 0) {
                writeProgress('Pass 1: Collecting statistics', 20 + (i / pixelCount) * 25);
            }
        }

        // ---- Between passes: compute means ----
        if (crossMatching) {
            for (const entry of refColors.values()) {
                entry.deMean = entry.deSum / entry.count;
                entry.meanSL = entry.sumSL / entry.count;
                entry.meanSa = entry.sumSa / entry.count;
                entry.meanSb = entry.sumSb / entry.count;
            }
        }

        // ---- Pass 2: stdDev and ΔEin (requires means from pass 1) ----
        logMemory(`Maps — after Pass 1 (${refColors.size} ref, ${sampleColors.size} sample colors)`, debugMemoryFootprint);
        if (crossMatching) {
            writeProgress('Pass 2: Computing stdDev and ΔEin', 50);
            if (verbose) console.log('Pass 2: Computing stdDev and ΔEin...');

            for (let i = 0; i < pixelCount; i++) {
                const idx = i * 3;
                const rL = refLab[idx], ra = refLab[idx + 1], rb = refLab[idx + 2];
                const sL = sampleLab[idx], sa = sampleLab[idx + 1], sb = sampleLab[idx + 2];

                const refKey = `${rL.toFixed(2)},${ra.toFixed(2)},${rb.toFixed(2)}`;
                const entry = refColors.get(refKey);

                const de = deltaEValues[i];
                entry.sumSquaredDiff += (de - entry.deMean) ** 2;

                const dein = deltaE76(sL, sa, sb, entry.meanSL, entry.meanSa, entry.meanSb);
                entry.deinSum += dein;
                if (dein < entry.deinMin) entry.deinMin = dein;
                if (dein > entry.deinMax) entry.deinMax = dein;

                if (i % progressInterval === 0) {
                    writeProgress('Pass 2: Computing stdDev and ΔEin', 50 + (i / pixelCount) * 25);
                }
            }
        }

        // ---- Finalize global Delta-E stats ----
        writeProgress('Finalizing statistics', 80);
        if (verbose) console.log('Finalizing statistics...');

        const sortedDeltaE = Float32Array.from(deltaEValues).sort((a, b) => a - b);
        const minDeltaE = sortedDeltaE[0];
        const maxDeltaE = sortedDeltaE[sortedDeltaE.length - 1];
        const medianDeltaE = sortedDeltaE[Math.floor(sortedDeltaE.length / 2)];
        const meanDeltaE = deGlobalSum / pixelCount;

        let sumSquaredDiffGlobal = 0;
        for (let i = 0; i < pixelCount; i++) {
            sumSquaredDiffGlobal += (deltaEValues[i] - meanDeltaE) ** 2;
        }
        const stdDevDeltaE = Math.sqrt(sumSquaredDiffGlobal / pixelCount);

        // ---- Top N colors ----
        writeProgress('Sorting top colors', 85);

        const refTopEntries = Array.from(refColors.values())
            .sort((a, b) => b.count - a.count)
            .slice(0, topCount || refColors.size);

        const sampleTopEntries = Array.from(sampleColors.values())
            .sort((a, b) => b.count - a.count)
            .slice(0, topCount || sampleColors.size);

        const refTopColorsFormatted = refTopEntries.map((c, idx) => ({
            L: Math.round(c.L * 100) / 100,
            a: Math.round(c.a * 100) / 100,
            b: Math.round(c.b * 100) / 100,
            count: c.count,
            rank: idx + 1,
            match: c.matched,
        }));

        const sampleTopColorsFormatted = sampleTopEntries.map((c, idx) => ({
            L: Math.round(c.L * 100) / 100,
            a: Math.round(c.a * 100) / 100,
            b: Math.round(c.b * 100) / 100,
            count: c.count,
            rank: idx + 1,
            match: c.matched,
        }));

        // ---- Cross-matched and variability ----
        logMemory('Maps — after Pass 2, before variability', debugMemoryFootprint);
        /** @type {CrossMatchedColor[] | undefined} */
        let crossMatchedColors;
        /** @type {VariabilityColor[] | undefined} */
        let variabilityColors;

        if (crossMatching) {
            writeProgress('Building cross-match results', 88);

            // Cross-matched: top N ref colors
            crossMatchedColors = refTopEntries.map((c, idx) => {
                const stdDev = Math.sqrt(c.sumSquaredDiff / c.count);
                let overlaps = 0;
                for (const freq of c.sampleFreqs.values()) {
                    if (freq > overlaps) overlaps = freq;
                }
                return {
                    L: c.L, a: c.a, b: c.b,
                    count: c.count,
                    rank: idx + 1,
                    overlaps,
                    variants: c.sampleFreqs.size,
                    deltaE: { mean: c.deMean, min: c.deMin, max: c.deMax, stdDev },
                    deltaEin: {
                        mean: c.deinSum / c.count,
                        min: c.deinMin === Infinity ? 0 : c.deinMin,
                        max: c.deinMax === -Infinity ? 0 : c.deinMax,
                    },
                };
            });

            // Variability: ALL ref colors sorted by coverage
            writeProgress('Building variability results', 90);
            if (verbose) console.log('Building variability results...');

            const allVariability = [];
            for (const c of refColors.values()) {
                let overlaps = 0;
                let dominantKey = '';
                for (const [sKey, freq] of c.sampleFreqs) {
                    if (freq > overlaps) { overlaps = freq; dominantKey = sKey; }
                }
                const [sL, sa, sb] = dominantKey.split(',').map(Number);
                const stdDev = Math.sqrt(c.sumSquaredDiff / c.count);

                allVariability.push({
                    rank: 0,
                    reference: { L: c.L, a: c.a, b: c.b },
                    sample: { L: sL, a: sa, b: sb },
                    pixels: c.count,
                    overlaps,
                    variants: c.sampleFreqs.size,
                    coverage: overlaps / c.count,
                    deltaE: { mean: c.deMean, min: c.deMin, max: c.deMax, stdDev },
                    deltaEin: {
                        mean: c.deinSum / c.count,
                        min: c.deinMin === Infinity ? 0 : c.deinMin,
                        max: c.deinMax === -Infinity ? 0 : c.deinMax,
                    },
                });
            }

            allVariability.sort((a, b) => b.coverage - a.coverage);
            for (let i = 0; i < allVariability.length; i++) {
                allVariability[i].rank = i + 1;
            }
            variabilityColors = allVariability;
        }

        return {
            deltaE: {
                min: minDeltaE,
                max: maxDeltaE,
                mean: meanDeltaE,
                median: medianDeltaE,
                stdDev: stdDevDeltaE,
                histogram,
            },
            refUniqueColorCount: refColors.size,
            sampleUniqueColorCount: sampleColors.size,
            topColors: {
                reference: refTopColorsFormatted,
                sample: sampleTopColorsFormatted,
            },
            crossMatched: crossMatchedColors,
            variability: variabilityColors,
        };
    } finally {
        logMemory('Maps — complete', debugMemoryFootprint);
    }
}

// ============================================================================
// TypedArrays Aggregation Strategy
// ============================================================================

/**
 * Collect all comparison statistics using parallel typed arrays and a single
 * flat pair-frequency Map. Eliminates millions of nested Map objects.
 *
 * Memory model:
 * - Per-ref-color accumulators: parallel typed arrays (~60 bytes/color)
 * - Pair frequencies: single flat Map with numeric keys (~70 bytes/pair)
 * - Per-sample-color: parallel typed arrays (~17 bytes/color)
 * - Flat pair map is freed between Pass 1 and Pass 2
 *
 * @param {Float32Array} refLab
 * @param {Float32Array} sampleLab
 * @param {number} width
 * @param {number} height
 * @param {number} topCount
 * @param {boolean} crossMatching
 * @param {boolean} crossMatchRounding
 * @param {boolean} verbose
 */
function collectAllStatsTypedArrays(refLab, sampleLab, width, height, topCount, crossMatching, crossMatchRounding, verbose, debugMemoryFootprint = false) {
    const pixelCount = width * height;

    try {
        logMemory('TypedArrays — before allocation', debugMemoryFootprint);

        // ---- Numeric key encoding for Lab colors (2 decimal places) ----
        // L*: 0-100 → 0-10000, a*: -128..127 → 0-25599, b*: same
        // Key = Li * 655360000 + ai * 25600 + bi
        // Max ≈ 6.55 × 10^12, within Number.MAX_SAFE_INTEGER
        const labToKey = (L, a, b) =>
            Math.round(L * 100) * 655360000 +
            (Math.round(a * 100) + 12800) * 25600 +
            (Math.round(b * 100) + 12800);

        // ---- Grow helper ----
        const growArray = (arr, newLen) => {
            const n = new arr.constructor(newLen);
            n.set(arr);
            return n;
        };

        // ---- Ref color typed arrays ----
        let referenceCapacity = Math.min(Math.ceil(pixelCount / 2), 4_000_000);
        let referenceUniqueColorCount = 0; // unique ref color count
        const referenceColorIndex = new Map(); // labKey → index
        let referenceLabL = new Float32Array(referenceCapacity);
        let referenceLabA = new Float32Array(referenceCapacity);
        let referenceLabB = new Float32Array(referenceCapacity);
        let referencePixelCounts = new Uint32Array(referenceCapacity);
        let referenceMatched = new Uint8Array(referenceCapacity);
        // Cross-matching accumulators
        let perColorSumDeltaE = crossMatching ? new Float64Array(referenceCapacity) : null;
        let perColorMinDeltaE = crossMatching ? new Float32Array(referenceCapacity) : null;
        let perColorMaxDeltaE = crossMatching ? new Float32Array(referenceCapacity) : null;
        let sampleLabSumL = crossMatching ? new Float64Array(referenceCapacity) : null;
        let sampleLabSumA = crossMatching ? new Float64Array(referenceCapacity) : null;
        let sampleLabSumB = crossMatching ? new Float64Array(referenceCapacity) : null;

        function growRef(newCap) {
            referenceLabL = growArray(referenceLabL, newCap);
            referenceLabA = growArray(referenceLabA, newCap);
            referenceLabB = growArray(referenceLabB, newCap);
            referencePixelCounts = growArray(referencePixelCounts, newCap);
            referenceMatched = growArray(referenceMatched, newCap);
            if (crossMatching) {
                perColorSumDeltaE = growArray(perColorSumDeltaE, newCap);
                perColorMinDeltaE = growArray(perColorMinDeltaE, newCap);
                perColorMaxDeltaE = growArray(perColorMaxDeltaE, newCap);
                sampleLabSumL = growArray(sampleLabSumL, newCap);
                sampleLabSumA = growArray(sampleLabSumA, newCap);
                sampleLabSumB = growArray(sampleLabSumB, newCap);
            }
            referenceCapacity = newCap;
        }

        // ---- Sample color typed arrays ----
        let sampleCapacity = Math.min(Math.ceil(pixelCount / 2), 4_000_000);
        let sampleUniqueColorCount = 0;
        const sampleColorIndex = new Map();
        let sampleLabL = new Float32Array(sampleCapacity);
        let sampleLabA = new Float32Array(sampleCapacity);
        let sampleLabB = new Float32Array(sampleCapacity);
        let samplePixelCounts = new Uint32Array(sampleCapacity);
        let sampleMatched = new Uint8Array(sampleCapacity);

        function growSample(newCap) {
            sampleLabL = growArray(sampleLabL, newCap);
            sampleLabA = growArray(sampleLabA, newCap);
            sampleLabB = growArray(sampleLabB, newCap);
            samplePixelCounts = growArray(samplePixelCounts, newCap);
            sampleMatched = growArray(sampleMatched, newCap);
            sampleCapacity = newCap;
        }

        // ---- Flat pair frequency map ----
        // Single Map instead of millions of nested Maps.
        // String key = "ri|kL,ka,kb" where kL/ka/kb are rounded when crossMatchRounding is on.
        const pairFreqs = crossMatching ? new Map() : null;

        // ---- Global Delta-E ----
        const deltaEValues = new Float32Array(pixelCount);
        let deGlobalSum = 0;
        const histogram = { '0': 0, '0-1': 0, '1-2': 0, '2-5': 0, '5-10': 0, '10+': 0 };
        const progressInterval = Math.max(1, Math.ceil(pixelCount / 20));

        // ════════════════════════════════════════════════════════════════════
        // Pass 1: Collect statistics
        // ════════════════════════════════════════════════════════════════════
        logMemory('TypedArrays — after allocation, before Pass 1', debugMemoryFootprint);
        writeProgress('Pass 1: Collecting statistics', 20);
        if (verbose) console.log('Pass 1: Collecting statistics...');

        for (let i = 0; i < pixelCount; i++) {
            const idx = i * 3;
            const rL = refLab[idx], ra = refLab[idx + 1], rb = refLab[idx + 2];
            const sL = sampleLab[idx], sa = sampleLab[idx + 1], sb = sampleLab[idx + 2];

            const de = deltaE76(rL, ra, rb, sL, sa, sb);
            deltaEValues[i] = de;
            deGlobalSum += de;

            if (de === 0) histogram['0']++;
            else if (de < 1) histogram['0-1']++;
            else if (de < 2) histogram['1-2']++;
            else if (de < 5) histogram['2-5']++;
            else if (de < 10) histogram['5-10']++;
            else histogram['10+']++;

            // Ref color
            const rKey = labToKey(rL, ra, rb);
            let ri = referenceColorIndex.get(rKey);
            if (ri === undefined) {
                ri = referenceUniqueColorCount++;
                if (ri >= referenceCapacity) growRef(Math.ceil(referenceCapacity * 1.5));
                referenceColorIndex.set(rKey, ri);
                referenceLabL[ri] = rL; referenceLabA[ri] = ra; referenceLabB[ri] = rb;
                if (crossMatching) { perColorMinDeltaE[ri] = Infinity; perColorMaxDeltaE[ri] = -Infinity; }
            }
            referencePixelCounts[ri]++;

            if (crossMatching) {
                // Per-group Delta-E uses the group's stored representative Lab (first pixel),
                // NOT the current pixel's raw Lab, to match the original computeVariabilityStats behavior.
                const deCM = deltaE76(referenceLabL[ri], referenceLabA[ri], referenceLabB[ri], sL, sa, sb);
                perColorSumDeltaE[ri] += deCM;
                if (deCM < perColorMinDeltaE[ri]) perColorMinDeltaE[ri] = deCM;
                if (deCM > perColorMaxDeltaE[ri]) perColorMaxDeltaE[ri] = deCM;
                sampleLabSumL[ri] += sL; sampleLabSumA[ri] += sa; sampleLabSumB[ri] += sb;

                {
                    const kL = crossMatchRounding ? round(sL, CROSS_MATCH_ROUNDING_DECIMALS) : sL;
                    const ka = crossMatchRounding ? round(sa, CROSS_MATCH_ROUNDING_DECIMALS) : sa;
                    const kb = crossMatchRounding ? round(sb, CROSS_MATCH_ROUNDING_DECIMALS) : sb;
                    const pairKey = `${ri}|${kL},${ka},${kb}`;
                    pairFreqs.set(pairKey, (pairFreqs.get(pairKey) ?? 0) + 1);
                }
            }

            if (de < 1) referenceMatched[ri] = 1;

            // Sample color
            const sKey = labToKey(sL, sa, sb);
            let si = sampleColorIndex.get(sKey);
            if (si === undefined) {
                si = sampleUniqueColorCount++;
                if (si >= sampleCapacity) growSample(Math.ceil(sampleCapacity * 1.5));
                sampleColorIndex.set(sKey, si);
                sampleLabL[si] = sL; sampleLabA[si] = sa; sampleLabB[si] = sb;
            }
            samplePixelCounts[si]++;
            if (de < 1) sampleMatched[si] = 1;

            if (i % progressInterval === 0) {
                writeProgress('Pass 1: Collecting statistics', 20 + (i / pixelCount) * 25);
            }
        }

        if (verbose) console.log(`Pass 1 complete: ${referenceUniqueColorCount.toLocaleString()} ref colors, ${sampleUniqueColorCount.toLocaleString()} sample colors.`);
        logMemory(`TypedArrays — after Pass 1 (${referenceUniqueColorCount.toLocaleString()} ref, ${sampleUniqueColorCount.toLocaleString()} sample, ${pairFreqs ? pairFreqs.size.toLocaleString() : 0} pairs)`, debugMemoryFootprint);

        // ════════════════════════════════════════════════════════════════════
        // Between passes: means, pair frequencies → variants/overlaps
        // ════════════════════════════════════════════════════════════════════

        let perColorMeanDeltaE, meanSampleLabL, meanSampleLabA, meanSampleLabB;
        let variantCounts, overlapCounts;

        if (crossMatching) {
            writeProgress('Computing means', 48);
            if (verbose) console.log('Computing means...');

            perColorMeanDeltaE = new Float64Array(referenceUniqueColorCount);
            meanSampleLabL = new Float64Array(referenceUniqueColorCount);
            meanSampleLabA = new Float64Array(referenceUniqueColorCount);
            meanSampleLabB = new Float64Array(referenceUniqueColorCount);
            for (let ri = 0; ri < referenceUniqueColorCount; ri++) {
                const c = referencePixelCounts[ri];
                perColorMeanDeltaE[ri] = perColorSumDeltaE[ri] / c;
                meanSampleLabL[ri] = sampleLabSumL[ri] / c;
                meanSampleLabA[ri] = sampleLabSumA[ri] / c;
                meanSampleLabB[ri] = sampleLabSumB[ri] / c;
            }

            // Free pass-1-only accumulators
            perColorSumDeltaE = null; sampleLabSumL = null; sampleLabSumA = null; sampleLabSumB = null;

            writeProgress('Processing pair frequencies', 49);
            if (verbose) console.log(`Processing ${pairFreqs.size.toLocaleString()} pair frequency entries...`);

            variantCounts = new Uint32Array(referenceUniqueColorCount);
            overlapCounts = new Uint32Array(referenceUniqueColorCount);

            for (const [pairKey, count] of pairFreqs) {
                const separator = pairKey.indexOf('|');
                const referenceIndex = parseInt(pairKey.substring(0, separator));
                variantCounts[referenceIndex]++;
                if (count > overlapCounts[referenceIndex]) {
                    overlapCounts[referenceIndex] = count;
                }
            }

            // Free the flat pair map
            pairFreqs.clear();
            if (verbose) console.log('Pair frequencies processed and freed.');
            logMemory('TypedArrays — after pair map freed', debugMemoryFootprint);
        }

        // ════════════════════════════════════════════════════════════════════
        // Pass 2: stdDev and ΔEin
        // ════════════════════════════════════════════════════════════════════

        let perColorSumSquaredDeltaEDifference, perColorSumDeltaEIntrinsic, perColorMinDeltaEIntrinsic, perColorMaxDeltaEIntrinsic;

        if (crossMatching) {
            writeProgress('Pass 2: Computing stdDev and ΔEin', 50);
            if (verbose) console.log('Pass 2: Computing stdDev and ΔEin...');

            perColorSumSquaredDeltaEDifference = new Float64Array(referenceUniqueColorCount);
            perColorSumDeltaEIntrinsic = new Float64Array(referenceUniqueColorCount);
            perColorMinDeltaEIntrinsic = new Float32Array(referenceUniqueColorCount);
            perColorMaxDeltaEIntrinsic = new Float32Array(referenceUniqueColorCount);
            perColorMinDeltaEIntrinsic.fill(Infinity);
            perColorMaxDeltaEIntrinsic.fill(-Infinity);

            for (let i = 0; i < pixelCount; i++) {
                const idx = i * 3;
                const rL = refLab[idx], ra = refLab[idx + 1], rb = refLab[idx + 2];
                const sL = sampleLab[idx], sa = sampleLab[idx + 1], sb = sampleLab[idx + 2];

                const rKey = labToKey(rL, ra, rb);
                const ri = referenceColorIndex.get(rKey);
                // Recompute per-group Delta-E using stored representative Lab (matches Pass 1)
                const deCM = deltaE76(referenceLabL[ri], referenceLabA[ri], referenceLabB[ri], sL, sa, sb);
                perColorSumSquaredDeltaEDifference[ri] += (deCM - perColorMeanDeltaE[ri]) ** 2;

                const dein = deltaE76(sL, sa, sb, meanSampleLabL[ri], meanSampleLabA[ri], meanSampleLabB[ri]);
                perColorSumDeltaEIntrinsic[ri] += dein;
                if (dein < perColorMinDeltaEIntrinsic[ri]) perColorMinDeltaEIntrinsic[ri] = dein;
                if (dein > perColorMaxDeltaEIntrinsic[ri]) perColorMaxDeltaEIntrinsic[ri] = dein;

                if (i % progressInterval === 0) {
                    writeProgress('Pass 2: Computing stdDev and ΔEin', 50 + (i / pixelCount) * 25);
                }
            }
        }

        // ════════════════════════════════════════════════════════════════════
        // Finalize global Delta-E stats
        // ════════════════════════════════════════════════════════════════════
        writeProgress('Finalizing statistics', 80);
        if (verbose) console.log('Finalizing statistics...');

        const sortedDeltaE = Float32Array.from(deltaEValues).sort((a, b) => a - b);
        const minDeltaE = sortedDeltaE[0];
        const maxDeltaE = sortedDeltaE[sortedDeltaE.length - 1];
        const medianDeltaE = sortedDeltaE[Math.floor(sortedDeltaE.length / 2)];
        const meanDeltaE = deGlobalSum / pixelCount;

        let sumSquaredDiffGlobal = 0;
        for (let i = 0; i < pixelCount; i++) {
            sumSquaredDiffGlobal += (deltaEValues[i] - meanDeltaE) ** 2;
        }
        const stdDevDeltaE = Math.sqrt(sumSquaredDiffGlobal / pixelCount);

        // ════════════════════════════════════════════════════════════════════
        // Top N colors
        // ════════════════════════════════════════════════════════════════════
        writeProgress('Sorting top colors', 85);

        const refSortIndices = Array.from({ length: referenceUniqueColorCount }, (_, i) => i);
        refSortIndices.sort((a, b) => referencePixelCounts[b] - referencePixelCounts[a]);
        const refTopIndices = refSortIndices.slice(0, topCount || referenceUniqueColorCount);

        const refTopColorsFormatted = refTopIndices.map((ri, idx) => ({
            L: referenceLabL[ri],
            a: referenceLabA[ri],
            b: referenceLabB[ri],
            count: referencePixelCounts[ri],
            rank: idx + 1,
            match: !!referenceMatched[ri],
        }));

        const sampleSortIndices = Array.from({ length: sampleUniqueColorCount }, (_, i) => i);
        sampleSortIndices.sort((a, b) => samplePixelCounts[b] - samplePixelCounts[a]);
        const sampleTopIndices = sampleSortIndices.slice(0, topCount || sampleUniqueColorCount);

        const sampleTopColorsFormatted = sampleTopIndices.map((si, idx) => ({
            L: sampleLabL[si],
            a: sampleLabA[si],
            b: sampleLabB[si],
            count: samplePixelCounts[si],
            rank: idx + 1,
            match: !!sampleMatched[si],
        }));

        // ════════════════════════════════════════════════════════════════════
        // Cross-matched and variability
        // ════════════════════════════════════════════════════════════════════
        logMemory('TypedArrays — after Pass 2, before variability', debugMemoryFootprint);
        /** @type {CrossMatchedColor[] | undefined} */
        let crossMatchedColors;
        /** @type {VariabilityColor[] | undefined} */
        let variabilityColors;
        /** @type {{ count: number, mean: Record<string, number>, min: Record<string, number>, max: Record<string, number> } | undefined} */
        let variabilitySummary;

        if (crossMatching) {
            writeProgress('Building cross-match results', 88);

            // Cross-matched: top N ref colors
            crossMatchedColors = refTopIndices.map((ri, idx) => {
                const stdDev = Math.sqrt(perColorSumSquaredDeltaEDifference[ri] / referencePixelCounts[ri]);
                return {
                    L: referenceLabL[ri], a: referenceLabA[ri], b: referenceLabB[ri],
                    count: referencePixelCounts[ri],
                    rank: idx + 1,
                    overlaps: overlapCounts[ri],
                    variants: variantCounts[ri],
                    deltaE: { mean: perColorMeanDeltaE[ri], min: perColorMinDeltaE[ri], max: perColorMaxDeltaE[ri], stdDev },
                    deltaEin: {
                        mean: perColorSumDeltaEIntrinsic[ri] / referencePixelCounts[ri],
                        min: perColorMinDeltaEIntrinsic[ri] === Infinity ? 0 : perColorMinDeltaEIntrinsic[ri],
                        max: perColorMaxDeltaEIntrinsic[ri] === -Infinity ? 0 : perColorMaxDeltaEIntrinsic[ri],
                    },
                };
            });

            // Variability: bounded top/bottom selection + summary aggregation
            // Avoids materializing 7M+ VariabilityColor objects
            writeProgress('Building variability results', 90);
            if (verbose) console.log('Building variability results...');

            const VBOUND = 10;

            // Comparator matching the original full-sort order: coverage DESC, overlaps DESC, pixels DESC
            // Returns negative if a should sort before b (= a is "higher ranked" in the variability table)
            const varCmpDesc = (a, b) =>
                (b.coverage - a.coverage) || (b.overlaps - a.overlaps) || (b.pixels - a.pixels);

            /** @type {{ ri: number, coverage: number, overlaps: number, pixels: number }[]} */
            const topByC = []; // highest-ranked entries; sorted ascending by varCmpDesc (worst at [0] for eviction)
            /** @type {{ ri: number, coverage: number, overlaps: number, pixels: number }[]} */
            const botByC = []; // lowest-ranked entries; sorted descending by varCmpDesc (best at [0] for eviction)

            // Summary accumulators
            let smPixels = 0, smOverlaps = 0, smVariants = 0, smCoverage = 0;
            let smDeMean = 0, smDeMin = 0, smDeMax = 0, smDeStdDev = 0;
            let smDeinMean = 0, smDeinMin = 0, smDeinMax = 0;
            let mnPixels = Infinity, mxPixels = -Infinity;
            let mnOverlaps = Infinity, mxOverlaps = -Infinity;
            let mnVariants = Infinity, mxVariants = -Infinity;
            let mnCoverage = Infinity, mxCoverage = -Infinity;
            let mnDeMean = Infinity, mxDeMean = -Infinity;
            let mnDeMin = Infinity, mxDeMin = -Infinity;
            let mnDeMax = Infinity, mxDeMax = -Infinity;
            let mnDeStdDev = Infinity, mxDeStdDev = -Infinity;
            let mnDeinMean = Infinity, mxDeinMean = -Infinity;
            let mnDeinMin = Infinity, mxDeinMin = -Infinity;
            let mnDeinMax = Infinity, mxDeinMax = -Infinity;

            for (let ri = 0; ri < referenceUniqueColorCount; ri++) {
                const pixels = referencePixelCounts[ri];
                const overlaps = overlapCounts[ri];
                const variants = variantCounts[ri];
                const coverage = overlaps / pixels;
                const deMean = perColorMeanDeltaE[ri];
                const deMin = perColorMinDeltaE[ri];
                const deMax = perColorMaxDeltaE[ri];
                const deStdDev = Math.sqrt(perColorSumSquaredDeltaEDifference[ri] / pixels);
                const deinMean = perColorSumDeltaEIntrinsic[ri] / pixels;
                const deinMin = perColorMinDeltaEIntrinsic[ri] === Infinity ? 0 : perColorMinDeltaEIntrinsic[ri];
                const deinMax = perColorMaxDeltaEIntrinsic[ri] === -Infinity ? 0 : perColorMaxDeltaEIntrinsic[ri];

                // Summary accumulators
                smPixels += pixels; smOverlaps += overlaps; smVariants += variants; smCoverage += coverage;
                smDeMean += deMean; smDeMin += deMin; smDeMax += deMax; smDeStdDev += deStdDev;
                smDeinMean += deinMean; smDeinMin += deinMin; smDeinMax += deinMax;
                if (pixels < mnPixels) mnPixels = pixels; if (pixels > mxPixels) mxPixels = pixels;
                if (overlaps < mnOverlaps) mnOverlaps = overlaps; if (overlaps > mxOverlaps) mxOverlaps = overlaps;
                if (variants < mnVariants) mnVariants = variants; if (variants > mxVariants) mxVariants = variants;
                if (coverage < mnCoverage) mnCoverage = coverage; if (coverage > mxCoverage) mxCoverage = coverage;
                if (deMean < mnDeMean) mnDeMean = deMean; if (deMean > mxDeMean) mxDeMean = deMean;
                if (deMin < mnDeMin) mnDeMin = deMin; if (deMin > mxDeMin) mxDeMin = deMin;
                if (deMax < mnDeMax) mnDeMax = deMax; if (deMax > mxDeMax) mxDeMax = deMax;
                if (deStdDev < mnDeStdDev) mnDeStdDev = deStdDev; if (deStdDev > mxDeStdDev) mxDeStdDev = deStdDev;
                if (deinMean < mnDeinMean) mnDeinMean = deinMean; if (deinMean > mxDeinMean) mxDeinMean = deinMean;
                if (deinMin < mnDeinMin) mnDeinMin = deinMin; if (deinMin > mxDeinMin) mxDeinMin = deinMin;
                if (deinMax < mnDeinMax) mnDeinMax = deinMax; if (deinMax > mxDeinMax) mxDeinMax = deinMax;

                // Bounded top/bottom by (coverage DESC, overlaps DESC, pixels DESC)
                const entry = { ri, coverage, overlaps, pixels };

                if (topByC.length < VBOUND) {
                    topByC.push(entry);
                    // Sort ascending by rank so [0] = worst (lowest-ranked) = eviction candidate
                    topByC.sort((a, b) => varCmpDesc(b, a));
                } else if (varCmpDesc(entry, topByC[0]) < 0) {
                    // New entry ranks higher than the worst in the top group
                    topByC[0] = entry;
                    topByC.sort((a, b) => varCmpDesc(b, a));
                }

                if (botByC.length < VBOUND) {
                    botByC.push(entry);
                    // Sort ascending by reverse-rank so [0] = worst (highest-ranked) = eviction candidate
                    botByC.sort((a, b) => varCmpDesc(a, b));
                } else if (varCmpDesc(entry, botByC[0]) > 0) {
                    // New entry ranks lower than the best in the bottom group
                    botByC[0] = entry;
                    botByC.sort((a, b) => varCmpDesc(a, b));
                }
            }

            // Build VariabilityColor objects for top/bottom only
            const buildVariabilityEntry = (ri, rank) => {
                const pixels = referencePixelCounts[ri];
                const stdDev = Math.sqrt(perColorSumSquaredDeltaEDifference[ri] / pixels);
                return {
                    rank,
                    reference: { L: referenceLabL[ri], a: referenceLabA[ri], b: referenceLabB[ri] },
                    sample: { L: meanSampleLabL[ri], a: meanSampleLabA[ri], b: meanSampleLabB[ri] },
                    pixels,
                    overlaps: overlapCounts[ri],
                    variants: variantCounts[ri],
                    coverage: overlapCounts[ri] / pixels,
                    deltaE: { mean: perColorMeanDeltaE[ri], min: perColorMinDeltaE[ri], max: perColorMaxDeltaE[ri], stdDev },
                    deltaEin: {
                        mean: perColorSumDeltaEIntrinsic[ri] / pixels,
                        min: perColorMinDeltaEIntrinsic[ri] === Infinity ? 0 : perColorMinDeltaEIntrinsic[ri],
                        max: perColorMaxDeltaEIntrinsic[ri] === -Infinity ? 0 : perColorMaxDeltaEIntrinsic[ri],
                    },
                };
            };

            // Top entries: sorted by (coverage DESC, overlaps DESC, pixels DESC) — rank 1 = highest
            topByC.sort(varCmpDesc);
            const topEntries = topByC.map((e, idx) => buildVariabilityEntry(e.ri, idx + 1));

            // Bottom entries: sorted by (coverage DESC, overlaps DESC, pixels DESC) — rank N-9..N = lowest
            botByC.sort(varCmpDesc);
            const bottomEntries = botByC.map((e, idx) => buildVariabilityEntry(e.ri, referenceUniqueColorCount - botByC.length + idx + 1));

            // Deduplicate if referenceUniqueColorCount <= 2*VBOUND (top and bottom may overlap)
            if (referenceUniqueColorCount <= VBOUND * 2) {
                const seen = new Set();
                variabilityColors = [];
                for (const e of topEntries) {
                    if (!seen.has(e.rank)) { seen.add(e.rank); variabilityColors.push(e); }
                }
                for (const e of bottomEntries) {
                    if (!seen.has(e.rank)) { seen.add(e.rank); variabilityColors.push(e); }
                }
                variabilityColors.sort((a, b) => b.coverage - a.coverage);
                for (let i = 0; i < variabilityColors.length; i++) variabilityColors[i].rank = i + 1;
            } else {
                variabilityColors = [...topEntries, ...bottomEntries];
            }

            // Summary — store raw unrounded values; rounding applied in display layer only
            variabilitySummary = {
                count: referenceUniqueColorCount,
                mean: {
                    Pixels: smPixels / referenceUniqueColorCount, Overlaps: smOverlaps / referenceUniqueColorCount,
                    Variants: smVariants / referenceUniqueColorCount, Coverage: smCoverage / referenceUniqueColorCount,
                    'Mean ΔE': smDeMean / referenceUniqueColorCount, 'Min ΔE': smDeMin / referenceUniqueColorCount,
                    'Max ΔE': smDeMax / referenceUniqueColorCount, StdDev: smDeStdDev / referenceUniqueColorCount,
                    'Mean ΔEin': smDeinMean / referenceUniqueColorCount, 'Min ΔEin': smDeinMin / referenceUniqueColorCount,
                    'Max ΔEin': smDeinMax / referenceUniqueColorCount,
                },
                min: {
                    Pixels: mnPixels, Overlaps: mnOverlaps, Variants: mnVariants,
                    Coverage: mnCoverage,
                    'Mean ΔE': mnDeMean, 'Min ΔE': mnDeMin,
                    'Max ΔE': mnDeMax, StdDev: mnDeStdDev,
                    'Mean ΔEin': mnDeinMean, 'Min ΔEin': mnDeinMin,
                    'Max ΔEin': mnDeinMax,
                },
                max: {
                    Pixels: mxPixels, Overlaps: mxOverlaps, Variants: mxVariants,
                    Coverage: mxCoverage,
                    'Mean ΔE': mxDeMean, 'Min ΔE': mxDeMin,
                    'Max ΔE': mxDeMax, StdDev: mxDeStdDev,
                    'Mean ΔEin': mxDeinMean, 'Min ΔEin': mxDeinMin,
                    'Max ΔEin': mxDeinMax,
                },
            };
        }

        return {
            deltaE: {
                min: minDeltaE,
                max: maxDeltaE,
                mean: meanDeltaE,
                median: medianDeltaE,
                stdDev: stdDevDeltaE,
                histogram,
            },
            refUniqueColorCount: referenceUniqueColorCount,
            sampleUniqueColorCount: sampleUniqueColorCount,
            topColors: {
                reference: refTopColorsFormatted,
                sample: sampleTopColorsFormatted,
            },
            crossMatched: crossMatchedColors,
            variability: variabilityColors,
            variabilitySummary,
        };
    } finally {
        logMemory('TypedArrays — complete', debugMemoryFootprint);
    }
}

// ============================================================================
// Main Comparison Logic
// ============================================================================

/**
 * @typedef {{
 *   reference: {
 *     filename: string,
 *     width: number,
 *     height: number,
 *     endianness: string,
 *     bitsPerSample: number[],
 *     sampleFormat: number[] | undefined,
 *     compression: string,
 *     photometricInterpretation: number,
 *     samplesPerPixel: number,
 *     rowsPerStrip: number | undefined,
 *     stripCount: number,
 *     planarConfiguration: number | undefined,
 *     profile: string | undefined,
 *     uniqueColorCount: number,
 *   },
 *   sample: {
 *     filename: string,
 *     width: number,
 *     height: number,
 *     endianness: string,
 *     bitsPerSample: number[],
 *     sampleFormat: number[] | undefined,
 *     compression: string,
 *     photometricInterpretation: number,
 *     samplesPerPixel: number,
 *     rowsPerStrip: number | undefined,
 *     stripCount: number,
 *     planarConfiguration: number | undefined,
 *     profile: string | undefined,
 *     uniqueColorCount: number,
 *   },
 *   deltaE: {
 *     min: number,
 *     max: number,
 *     mean: number,
 *     median: number,
 *     stdDev: number,
 *     histogram: Record<string, number>,
 *   },
 *   topColors: {
 *     reference: Array<{L: number, a: number, b: number, count: number, rank: number, match: boolean}>,
 *     sample: Array<{L: number, a: number, b: number, count: number, rank: number, match: boolean}>,
 *   },
 *   crossMatched?: CrossMatchedColor[],
 *   variability?: VariabilityColor[],
 *   variabilitySummary?: {
 *     count: number,
 *     mean: Record<string, number>,
 *     min: Record<string, number>,
 *     max: Record<string, number>,
 *   },
 * }} ComparisonResult
 */

/**
 * Compare two Lab TIFF images
 * @param {string} referencePath
 * @param {string} samplePath
 * @param {number} topCount
 * @param {boolean} crossMatching
 * @param {boolean} crossMatchRounding
 * @param {boolean} verbose
 * @param {'None' | 'Maps' | 'TypedArrays'} [aggregationStrategy]
 * @param {boolean} [debugMemoryFootprint]
 * @returns {ComparisonResult}
 */
function compareTIFFImages(referencePath, samplePath, topCount, crossMatching, crossMatchRounding, verbose, aggregationStrategy = AGGREGATION_STRATEGY, debugMemoryFootprint = false) {
    // Load images
    logMemory(`${aggregationStrategy} — before image loading`, debugMemoryFootprint);
    writeProgress('Loading reference image', 0);
    if (verbose) console.log('Loading reference image...');
    const refImage = readTIFFImage(referencePath);

    writeProgress('Loading sample image', 10);
    if (verbose) console.log('Loading sample image...');
    const sampleImage = readTIFFImage(samplePath);

    // Validate color spaces
    if (refImage.colorSpace !== 'Lab') {
        throw new Error(`Reference image is not Lab color space (found: ${refImage.colorSpace})`);
    }
    if (sampleImage.colorSpace !== 'Lab') {
        throw new Error(`Sample image is not Lab color space (found: ${sampleImage.colorSpace})`);
    }

    // Validate dimensions
    if (refImage.width !== sampleImage.width || refImage.height !== sampleImage.height) {
        throw new Error(`Dimension mismatch: reference ${refImage.width}x${refImage.height} vs sample ${sampleImage.width}x${sampleImage.height}`);
    }

    const width = refImage.width;
    const height = refImage.height;
    const pixelCount = width * height;

    if (verbose) console.log(`Dimensions: ${width}×${height} (${pixelCount.toLocaleString()} pixels)`);

    // Convert to Lab Float32
    writeProgress('Converting to Lab Float32', 15);
    if (verbose) console.log('Converting to Lab Float32...');
    const refLab = getLabFloat32ArrayFrom(refImage);
    const sampleLab = getLabFloat32ArrayFrom(sampleImage);
    logMemory(`${aggregationStrategy} — after Lab Float32 conversion`, debugMemoryFootprint);

    // Build image metadata (common to both approaches)
    const buildImageMetadata = (image, path, uniqueColorCount) => ({
        filename: basename(path),
        width: image.width,
        height: image.height,
        endianness: image.endianness,
        bitsPerSample: image.tags.bitsPerSample,
        sampleFormat: image.tags.sampleFormat,
        compression: image.tags.compression,
        photometricInterpretation: image.tags.photometricInterpretation,
        samplesPerPixel: image.tags.samplesPerPixel,
        rowsPerStrip: image.tags.rowsPerStrip,
        stripCount: image.tags.stripOffsets.length,
        planarConfiguration: image.tags.planarConfiguration,
        profile: image.tags.profile,
        uniqueColorCount,
    });

    if (aggregationStrategy === 'TypedArrays') {
        // Two-pass typed array approach: flat pair map + parallel typed arrays
        const stats = collectAllStatsTypedArrays(refLab, sampleLab, width, height, topCount, crossMatching, crossMatchRounding, verbose, debugMemoryFootprint);

        writeProgress('Done', 100);
        if (verbose) console.log('Done.');

        return {
            reference: buildImageMetadata(refImage, referencePath, stats.refUniqueColorCount),
            sample: buildImageMetadata(sampleImage, samplePath, stats.sampleUniqueColorCount),
            deltaE: stats.deltaE,
            topColors: stats.topColors,
            crossMatched: stats.crossMatched,
            variability: stats.variability,
            variabilitySummary: stats.variabilitySummary,
        };
    }

    if (aggregationStrategy === 'Maps') {
        // Two-pass sequential approach: O(uniqueColors × avgVariants) memory
        const stats = collectAllStatsSequential(refLab, sampleLab, width, height, topCount, crossMatching, crossMatchRounding, verbose, debugMemoryFootprint);

        writeProgress('Done', 100);
        if (verbose) console.log('Done.');

        return {
            reference: buildImageMetadata(refImage, referencePath, stats.refUniqueColorCount),
            sample: buildImageMetadata(sampleImage, samplePath, stats.sampleUniqueColorCount),
            deltaE: stats.deltaE,
            topColors: stats.topColors,
            crossMatched: stats.crossMatched,
            variability: stats.variability,
        };
    }

    // aggregationStrategy === 'None': Original position-based approach
    try {
        logMemory('None — before Delta-E calculation', debugMemoryFootprint);

        // Calculate Delta-E for all pixels
        writeProgress('Calculating Delta-E 1976', 20);
        if (verbose) console.log('Calculating Delta-E 1976...');
        const deltaEValues = new Float32Array(pixelCount);

        for (let i = 0; i < pixelCount; i++) {
            const idx = i * 3;
            deltaEValues[i] = deltaE76(
                refLab[idx], refLab[idx + 1], refLab[idx + 2],
                sampleLab[idx], sampleLab[idx + 1], sampleLab[idx + 2]
            );
        }

        // Delta-E statistics
        const sortedDeltaE = Float32Array.from(deltaEValues).sort((a, b) => a - b);
        const minDeltaE = sortedDeltaE[0];
        const maxDeltaE = sortedDeltaE[sortedDeltaE.length - 1];
        const medianDeltaE = sortedDeltaE[Math.floor(sortedDeltaE.length / 2)];
        const sumDeltaE = deltaEValues.reduce((sum, val) => sum + val, 0);
        const meanDeltaE = sumDeltaE / pixelCount;

        // Standard deviation
        let sumSquaredDiff = 0;
        for (let i = 0; i < pixelCount; i++) {
            const diff = deltaEValues[i] - meanDeltaE;
            sumSquaredDiff += diff * diff;
        }
        const stdDevDeltaE = Math.sqrt(sumSquaredDiff / pixelCount);

        // Delta-E histogram (buckets: 0, 0-1, 1-2, 2-5, 5-10, 10+)
        const histogram = {
            '0': 0,
            '0-1': 0,
            '1-2': 0,
            '2-5': 0,
            '5-10': 0,
            '10+': 0,
        };

        for (let i = 0; i < pixelCount; i++) {
            const de = deltaEValues[i];
            if (de === 0) histogram['0']++;
            else if (de < 1) histogram['0-1']++;
            else if (de < 2) histogram['1-2']++;
            else if (de < 5) histogram['2-5']++;
            else if (de < 10) histogram['5-10']++;
            else histogram['10+']++;
        }

        // Collect unique colors (store all positions if cross-matching enabled)
        logMemory('None — after Delta-E, before unique colors', debugMemoryFootprint);
        writeProgress('Collecting unique colors', 40);
        if (verbose) console.log('Collecting unique colors...');
        const refUniqueColors = collectUniqueColors(refLab, width, height, crossMatching);
        const sampleUniqueColors = collectUniqueColors(sampleLab, width, height, false);
        logMemory(`None — after unique colors (${refUniqueColors.size} ref, ${sampleUniqueColors.size} sample)`, debugMemoryFootprint);

        // Get top unique colors
        const refTopColors = getTopUniqueColors(refUniqueColors, topCount);
        const sampleTopColors = getTopUniqueColors(sampleUniqueColors, topCount);

        // Cross-matching analysis
        /** @type {CrossMatchedColor[] | undefined} */
        let crossMatchedColors;
        /** @type {VariabilityColor[] | undefined} */
        let variabilityColors;
        if (crossMatching) {
            writeProgress('Computing cross-match statistics', 55);
            if (verbose) console.log('Computing cross-match statistics...');
            crossMatchedColors = computeCrossMatchStats(refTopColors, sampleLab, width, crossMatchRounding);

            writeProgress('Computing variability analysis', 65);
            if (verbose) console.log('Computing variability analysis...');
            variabilityColors = computeVariabilityStats(refUniqueColors, sampleLab, width, crossMatchRounding, (fraction) => {
                writeProgress('Computing variability analysis', 65 + fraction * 25);
            });
        }

        // Determine matches by checking if colors appear at same positions
        writeProgress('Determining color matches', 92);
        if (verbose) console.log('Determining color matches...');

        /**
         * Check if a color from reference has a matching color in sample at same positions
         * @param {UniqueColor} refColor
         * @param {Float32Array} targetLab
         * @param {number} imgWidth
         * @returns {boolean}
         */
        const hasMatchingPosition = (refColor, targetLab, imgWidth) => {
            // Check first few positions
            for (const pos of refColor.positions.slice(0, 10)) {
                const idx = (pos.y * imgWidth + pos.x) * 3;
                const sL = targetLab[idx];
                const sa = targetLab[idx + 1];
                const sb = targetLab[idx + 2];

                // Check if Delta-E is small (colors match at this position)
                const de = deltaE76(refColor.L, refColor.a, refColor.b, sL, sa, sb);
                if (de < 1) return true;
            }
            return false;
        };

        const refTopColorsWithMatch = refTopColors.map((color, idx) => ({
            L: Math.round(color.L * 100) / 100,
            a: Math.round(color.a * 100) / 100,
            b: Math.round(color.b * 100) / 100,
            count: color.count,
            rank: idx + 1,
            match: hasMatchingPosition(color, sampleLab, width),
        }));

        const sampleTopColorsWithMatch = sampleTopColors.map((color, idx) => ({
            L: Math.round(color.L * 100) / 100,
            a: Math.round(color.a * 100) / 100,
            b: Math.round(color.b * 100) / 100,
            count: color.count,
            rank: idx + 1,
            match: hasMatchingPosition(color, refLab, width),
        }));

        return {
            reference: buildImageMetadata(refImage, referencePath, refUniqueColors.size),
            sample: buildImageMetadata(sampleImage, samplePath, sampleUniqueColors.size),
            deltaE: {
                min: minDeltaE,
                max: maxDeltaE,
                mean: meanDeltaE,
                median: medianDeltaE,
                stdDev: stdDevDeltaE,
                histogram,
            },
            topColors: {
                reference: refTopColorsWithMatch,
                sample: sampleTopColorsWithMatch,
            },
            crossMatched: crossMatchedColors,
            variability: variabilityColors,
        };
    } finally {
        logMemory('None — complete', debugMemoryFootprint);
    }
}

// ============================================================================
// Output Functions
// ============================================================================

/**
 * Display comparison results using console methods
 * @param {ComparisonResult} result
 * @param {boolean} extendedStatistics
 */
function displayResults(result, extendedStatistics) {
    const labDp = LAB_COLUMN_ROUNDING_DECIMALS;
    const deDp = DELTA_E_COLUMN_ROUNDING_DECIMALS;
    const fn = FOOTNOTES;

    console.log('\n');
    console.log('═'.repeat(80));
    console.log('TIFF DIFF COMPARISON RESULTS');
    console.log('═'.repeat(80));

    // Filenames (printed separately — they can be very long)
    console.log(`\nReference: ${result.reference.filename}`);
    console.log(`Sample:    ${result.sample.filename}`);

    // Image Metadata (transposed: rows = TIFF tags, columns = Reference/Sample)
    const ref = result.reference;
    const sam = result.sample;
    console.group('\nImage Metadata');
    console.table({
        'ByteOrder': { Reference: ref.endianness, Sample: sam.endianness },
        'ImageWidth (256)': { Reference: ref.width, Sample: sam.width },
        'ImageLength (257)': { Reference: ref.height, Sample: sam.height },
        'BitsPerSample (258)': { Reference: ref.bitsPerSample, Sample: sam.bitsPerSample },
        'SampleFormat (339)': { Reference: ref.sampleFormat ?? null, Sample: sam.sampleFormat ?? null },
        'Compression (259)': { Reference: ref.compression, Sample: sam.compression },
        'PhotometricInterpretation (262)': { Reference: ref.photometricInterpretation, Sample: sam.photometricInterpretation },
        'SamplesPerPixel (277)': { Reference: ref.samplesPerPixel, Sample: sam.samplesPerPixel },
        'RowsPerStrip (278)': { Reference: ref.rowsPerStrip ?? null, Sample: sam.rowsPerStrip ?? null },
        'StripOffsets (273)': { Reference: ref.stripCount, Sample: sam.stripCount },
        'PlanarConfiguration (284)': { Reference: ref.planarConfiguration ?? null, Sample: sam.planarConfiguration ?? null },
        'ICCProfile (34675)': { Reference: ref.profile ?? null, Sample: sam.profile ?? null },
        'Unique Colors': { Reference: ref.uniqueColorCount, Sample: sam.uniqueColorCount },
    });
    console.groupEnd();

    // Delta-E Statistics
    console.group('\nDelta-E 1976 Statistics');
    console.table({
        'Minimum': round(result.deltaE.min, deDp),
        'Maximum': round(result.deltaE.max, deDp),
        'Mean': round(result.deltaE.mean, deDp),
        'Median': round(result.deltaE.median, deDp),
        'Std Dev': round(result.deltaE.stdDev, deDp),
    });
    printFootnotes(fn.deltaERounding);
    console.groupEnd();

    // Delta-E Histogram
    console.group('\nDelta-E Distribution');
    const totalPixels = Object.values(result.deltaE.histogram).reduce((a, b) => a + b, 0);
    /** @type {Record<string, [number, number]>} */
    const rangeArrays = {
        '0': [0, 0],
        '0-1': [0, 1],
        '1-2': [1, 2],
        '2-5': [2, 5],
        '5-10': [5, 10],
        '10+': [10, Infinity],
    };
    console.table(Object.fromEntries(Object.entries(result.deltaE.histogram).map(([range, count]) => [rangeArrays[range], {
        Count: count,
        Percentage: round((count / totalPixels) * 100, 2),
    }])));
    console.groupEnd();

    // Top Reference Colors
    console.group(`\nTop ${result.topColors.reference.length} Reference Colors`);
    console.table(Object.fromEntries(result.topColors.reference.map(c => [c.rank, {
        [`Lab${superscript(fn.labRounding.number)}`]: [round(c.L, labDp), round(c.a, labDp), round(c.b, labDp)],
        [`Pixels${superscript(fn.pixels.number)}`]: c.count,
        [`Match${superscript(fn.match.number)}`]: c.match,
    }])));
    printFootnotes(fn.labRounding, fn.pixels, fn.match);
    console.groupEnd();

    // Top Sample Colors
    console.group(`\nTop ${result.topColors.sample.length} Sample Colors`);
    console.table(Object.fromEntries(result.topColors.sample.map(c => [c.rank, {
        [`Lab${superscript(fn.labRounding.number)}`]: [round(c.L, labDp), round(c.a, labDp), round(c.b, labDp)],
        [`Pixels${superscript(fn.pixels.number)}`]: c.count,
        [`Match${superscript(fn.match.number)}`]: c.match,
    }])));
    printFootnotes(fn.labRounding, fn.pixels, fn.match);
    console.groupEnd();

    // Cross-Matched Reference Colors
    if (result.crossMatched) {
        console.group(`\nCross-Matched Reference Colors (Delta-E by position)`);
        console.table(Object.fromEntries(result.crossMatched.map(c => [c.rank, {
            [`Lab${superscript(fn.labRounding.number)}`]: [round(c.L, labDp), round(c.a, labDp), round(c.b, labDp)],
            [`Pixels${superscript(fn.pixels.number)}`]: c.count,
            [`Overlaps${superscript(fn.crossMatchGrouping.number)}`]: c.overlaps,
            [`Variants${superscript(fn.crossMatchGrouping.number)}`]: c.variants,
            [`Mean ΔE${superscript(fn.deltaERounding.number)}`]: round(c.deltaE.mean, deDp),
            ...(extendedStatistics ? { [`Min ΔE${superscript(fn.deltaERounding.number)}`]: round(c.deltaE.min, deDp) } : {}),
            [`Max ΔE${superscript(fn.deltaERounding.number)}`]: round(c.deltaE.max, deDp),
            [`StdDev${superscript(fn.deltaERounding.number)}`]: round(c.deltaE.stdDev, deDp),
            [`Mean ΔEin${superscript(fn.deltaERounding.number)}`]: round(c.deltaEin.mean, deDp),
            ...(extendedStatistics ? { [`Min ΔEin${superscript(fn.deltaERounding.number)}`]: round(c.deltaEin.min, deDp) } : {}),
            [`Max ΔEin${superscript(fn.deltaERounding.number)}`]: round(c.deltaEin.max, deDp),
        }])));
        printFootnotes(fn.labRounding, fn.deltaERounding, fn.pixels, fn.crossMatchGrouping);
        console.groupEnd();
    }

    // Cross-Matched Sample Variability
    if (result.variability && result.variability.length > 0) {
        /**
         * Format a VariabilityColor array for console.table
         * @param {VariabilityColor[]} colors
         */
        const formatVariabilityRow = (colors) => Object.fromEntries(colors.map(c => [c.rank, {
            [`Reference Lab${superscript(fn.labRounding.number)}`]: [round(c.reference.L, labDp), round(c.reference.a, labDp), round(c.reference.b, labDp)],
            [`Sample Lab${superscript(fn.labRounding.number)}`]: [round(c.sample.L, labDp), round(c.sample.a, labDp), round(c.sample.b, labDp)],
            [`Pixels${superscript(fn.pixels.number)}`]: c.pixels,
            [`Overlaps${superscript(fn.crossMatchGrouping.number)}`]: c.overlaps,
            [`Variants${superscript(fn.crossMatchGrouping.number)}`]: c.variants,
            Coverage: round(c.coverage, 4),
            [`Mean ΔE${superscript(fn.deltaERounding.number)}`]: round(c.deltaE.mean, deDp),
            ...(extendedStatistics ? { [`Min ΔE${superscript(fn.deltaERounding.number)}`]: round(c.deltaE.min, deDp) } : {}),
            [`Max ΔE${superscript(fn.deltaERounding.number)}`]: round(c.deltaE.max, deDp),
            [`StdDev${superscript(fn.deltaERounding.number)}`]: round(c.deltaE.stdDev, deDp),
            [`Mean ΔEin${superscript(fn.deltaERounding.number)}`]: round(c.deltaEin.mean, deDp),
            ...(extendedStatistics ? { [`Min ΔEin${superscript(fn.deltaERounding.number)}`]: round(c.deltaEin.min, deDp) } : {}),
            [`Max ΔEin${superscript(fn.deltaERounding.number)}`]: round(c.deltaEin.max, deDp),
        }]));

        // Use variabilitySummary.count (TypedArrays) or array length (Maps/None)
        // to determine whether to split into top/bottom sections
        const totalVariabilityCount = result.variabilitySummary?.count ?? result.variability.length;

        if (totalVariabilityCount <= 20) {
            console.group(`\nCross-Matched Sample Variability`);
            console.table(formatVariabilityRow(result.variability));
            printFootnotes(fn.labRounding, fn.deltaERounding, fn.pixels, fn.crossMatchGrouping);
            console.groupEnd();
        } else {
            console.group(`\nCross-Matched Sample Variability (Highest Coverage)`);
            console.table(formatVariabilityRow(result.variability.slice(0, 10)));
            printFootnotes(fn.labRounding, fn.deltaERounding, fn.pixels, fn.crossMatchGrouping);
            console.groupEnd();

            console.group(`\nCross-Matched Sample Variability (Lowest Coverage)`);
            console.table(formatVariabilityRow(result.variability.slice(-10)));
            printFootnotes(fn.labRounding, fn.deltaERounding, fn.pixels, fn.crossMatchGrouping);
            console.groupEnd();
        }

        // Overall summary table — apply presentation rounding here
        /**
         * Round a summary row's values for display
         * @param {Record<string, number>} row
         * @returns {Record<string, number>}
         */
        const roundSummaryRow = (row) => ({
            [`Pixels${superscript(fn.pixels.number)}`]: round(row.Pixels, 0),
            [`Overlaps${superscript(fn.crossMatchGrouping.number)}`]: round(row.Overlaps, 0),
            [`Variants${superscript(fn.crossMatchGrouping.number)}`]: round(row.Variants, 0),
            Coverage: round(row.Coverage, 4),
            [`Mean ΔE${superscript(fn.deltaERounding.number)}`]: round(row['Mean ΔE'], deDp),
            ...(extendedStatistics ? { [`Min ΔE${superscript(fn.deltaERounding.number)}`]: round(row['Min ΔE'], deDp) } : {}),
            [`Max ΔE${superscript(fn.deltaERounding.number)}`]: round(row['Max ΔE'], deDp),
            [`StdDev${superscript(fn.deltaERounding.number)}`]: round(row.StdDev, deDp),
            [`Mean ΔEin${superscript(fn.deltaERounding.number)}`]: round(row['Mean ΔEin'], deDp),
            ...(extendedStatistics ? { [`Min ΔEin${superscript(fn.deltaERounding.number)}`]: round(row['Min ΔEin'], deDp) } : {}),
            [`Max ΔEin${superscript(fn.deltaERounding.number)}`]: round(row['Max ΔEin'], deDp),
        });

        if (result.variabilitySummary) {
            // Pre-computed summary from TypedArrays strategy
            const vs = result.variabilitySummary;
            const summaryRows = Object.fromEntries([
                ['Mean', roundSummaryRow(vs.mean)],
                ...(extendedStatistics ? [['Min', roundSummaryRow(vs.min)]] : []),
                ['Max', roundSummaryRow(vs.max)],
            ]);

            console.group(`\nCross-Matched Sample Variability (Overall — ${vs.count.toLocaleString()} unique ref colors)`);
            console.table(summaryRows);
            printFootnotes(fn.deltaERounding, fn.pixels, fn.crossMatchGrouping);
            console.groupEnd();
        } else {
            // Compute from full array (Maps/None strategies)
            const all = result.variability;
            const n = all.length;

            /** @param {(c: VariabilityColor) => number} accessor */
            const meanOf = (accessor) => all.reduce((s, c) => s + accessor(c), 0) / n;
            /** @param {(c: VariabilityColor) => number} accessor */
            const minOf = (accessor) => all.reduce((m, c) => Math.min(m, accessor(c)), Infinity);
            /** @param {(c: VariabilityColor) => number} accessor */
            const maxOf = (accessor) => all.reduce((m, c) => Math.max(m, accessor(c)), -Infinity);

            /**
             * @param {string} label
             * @param {(accessor: (c: VariabilityColor) => number) => number} aggregate
             */
            const summaryRow = (label, aggregate) => ([
                label,
                {
                    [`Pixels${superscript(fn.pixels.number)}`]: round(aggregate(c => c.pixels), 0),
                    [`Overlaps${superscript(fn.crossMatchGrouping.number)}`]: round(aggregate(c => c.overlaps), 0),
                    [`Variants${superscript(fn.crossMatchGrouping.number)}`]: round(aggregate(c => c.variants), 0),
                    Coverage: round(aggregate(c => c.coverage), 4),
                    [`Mean ΔE${superscript(fn.deltaERounding.number)}`]: round(aggregate(c => c.deltaE.mean), deDp),
                    ...(extendedStatistics ? { [`Min ΔE${superscript(fn.deltaERounding.number)}`]: round(aggregate(c => c.deltaE.min), deDp) } : {}),
                    [`Max ΔE${superscript(fn.deltaERounding.number)}`]: round(aggregate(c => c.deltaE.max), deDp),
                    [`StdDev${superscript(fn.deltaERounding.number)}`]: round(aggregate(c => c.deltaE.stdDev), deDp),
                    [`Mean ΔEin${superscript(fn.deltaERounding.number)}`]: round(aggregate(c => c.deltaEin.mean), deDp),
                    ...(extendedStatistics ? { [`Min ΔEin${superscript(fn.deltaERounding.number)}`]: round(aggregate(c => c.deltaEin.min), deDp) } : {}),
                    [`Max ΔEin${superscript(fn.deltaERounding.number)}`]: round(aggregate(c => c.deltaEin.max), deDp),
                }]);

            const summaryRows = Object.fromEntries([
                summaryRow('Mean', meanOf),
                ...(extendedStatistics ? [summaryRow('Min', minOf)] : []),
                summaryRow('Max', maxOf),
            ]);

            console.group(`\nCross-Matched Sample Variability (Overall)`);
            console.table(summaryRows);
            printFootnotes(fn.deltaERounding, fn.pixels, fn.crossMatchGrouping);
            console.groupEnd();
        }
    }

    console.log('\n' + '═'.repeat(80));
}

/**
 * Save results to JSON file
 * @param {ComparisonResult} result
 * @param {string} samplePath
 */
function saveResults(result, samplePath) {
    const outputPath = samplePath + '.json';

    // Read existing results (array or legacy single object)
    let results = [];
    if (fs.existsSync(outputPath)) {
        try {
            const existing = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
            if (Array.isArray(existing)) {
                results = existing;
            } else if (existing && typeof existing === 'object') {
                // Migrate legacy single-object format to array
                results = [existing];
            }
        } catch {
            // Corrupted file — start fresh
        }
    }

    results.push(result);
    fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
    console.log(`\nResults saved to: ${outputPath} (${results.length} comparison${results.length > 1 ? 's' : ''})`);
}

// ============================================================================
// Main Entry Point
// ============================================================================

async function main() {
    const args = argv.slice(2);
    const options = parseArgs(args);

    // Validate required arguments
    if (!options.referencePath || !options.samplePath) {
        console.error('Error: Both reference and sample TIFF paths are required.\n');
        printUsage();
        exit(1);
    }

    // Resolve paths
    const referencePath = resolve(options.referencePath);
    const samplePath = resolve(options.samplePath);

    // Validate file existence
    if (!fs.existsSync(referencePath)) {
        console.error(`Error: Reference file not found: ${referencePath}`);
        exit(1);
    }
    if (!fs.existsSync(samplePath)) {
        console.error(`Error: Sample file not found: ${samplePath}`);
        exit(1);
    }

    try {
        // Run comparison
        const result = compareTIFFImages(referencePath, samplePath, options.topCount, options.crossMatching, options.crossMatchRounding, options.verbose, options.aggregationStrategy, options.debugMemoryFootprint);

        // Clear progress line before display output
        writeProgress('Complete', 100);
        clearProgress();

        // Display results
        displayResults(result, options.extendedStatistics);

        // Save results
        saveResults(result, samplePath);

    } catch (error) {
        console.error(`Error: ${error.message}`);
        if (options.verbose) {
            console.error(error.stack);
        }
        exit(1);
    }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    main();
}

export { readTIFFImage, getLabFloat32ArrayFrom, decodeTIFFLZW };

// ============================================================================
// Example Commands
// ============================================================================
//
// # Default (with cross-matching)
// node testing/iso/ptf/2025/experiments/tiff-diff.js "testing/iso/ptf/2025/experiments/output/2026-02-04-001 Comparisons A01/IM6 - Lab - Reference.tif" "testing/iso/ptf/2025/experiments/output/2026-02-04-001 Comparisons A01/IM6 - Lab - eciCMYK v2 - Relative Colorimetric - Refactored - Main Thread - Color-Engine 2026-01-30 (2026-02-04-001) - Lab.tif"
//
// # Without cross-matching
// node testing/iso/ptf/2025/experiments/tiff-diff.js "testing/iso/ptf/2025/experiments/output/2026-02-04-001 Comparisons A01/IM6 - Lab - Reference.tif" "testing/iso/ptf/2025/experiments/output/2026-02-04-001 Comparisons A01/IM6 - Lab - eciCMYK v2 - Relative Colorimetric - Refactored - Main Thread - Color-Engine 2026-01-30 (2026-02-04-001) - Lab.tif" --without-cross-matching
//
// # With verbose output
// node testing/iso/ptf/2025/experiments/tiff-diff.js "testing/iso/ptf/2025/experiments/output/2026-02-04-001 Comparisons A01/IM6 - Lab - Reference.tif" "testing/iso/ptf/2025/experiments/output/2026-02-04-001 Comparisons A01/IM6 - Lab - eciCMYK v2 - Relative Colorimetric - Refactored - Main Thread - Color-Engine 2026-01-30 (2026-02-04-001) - Lab.tif" --verbose
//
// # Show help
// node testing/iso/ptf/2025/experiments/tiff-diff.js --help
