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
import { argv, exit } from 'node:process';

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
        verbose: false,
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
            const kL = crossMatchRounding ? round(sL, 0) : sL;
            const ka = crossMatchRounding ? round(sa, 0) : sa;
            const kb = crossMatchRounding ? round(sb, 0) : sb;
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
            const kL = crossMatchRounding ? round(sL, 0) : sL;
            const ka = crossMatchRounding ? round(sa, 0) : sa;
            const kb = crossMatchRounding ? round(sb, 0) : sb;
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
 * @returns {ComparisonResult}
 */
function compareTIFFImages(referencePath, samplePath, topCount, crossMatching, crossMatchRounding, verbose) {
    // Load images
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
    writeProgress('Collecting unique colors', 40);
    if (verbose) console.log('Collecting unique colors...');
    const refUniqueColors = collectUniqueColors(refLab, width, height, crossMatching);
    const sampleUniqueColors = collectUniqueColors(sampleLab, width, height, false);

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
        reference: {
            filename: basename(referencePath),
            width: refImage.width,
            height: refImage.height,
            endianness: refImage.endianness,
            bitsPerSample: refImage.tags.bitsPerSample,
            sampleFormat: refImage.tags.sampleFormat,
            compression: refImage.tags.compression,
            photometricInterpretation: refImage.tags.photometricInterpretation,
            samplesPerPixel: refImage.tags.samplesPerPixel,
            rowsPerStrip: refImage.tags.rowsPerStrip,
            stripCount: refImage.tags.stripOffsets.length,
            planarConfiguration: refImage.tags.planarConfiguration,
            profile: refImage.tags.profile,
            uniqueColorCount: refUniqueColors.size,
        },
        sample: {
            filename: basename(samplePath),
            width: sampleImage.width,
            height: sampleImage.height,
            endianness: sampleImage.endianness,
            bitsPerSample: sampleImage.tags.bitsPerSample,
            sampleFormat: sampleImage.tags.sampleFormat,
            compression: sampleImage.tags.compression,
            photometricInterpretation: sampleImage.tags.photometricInterpretation,
            samplesPerPixel: sampleImage.tags.samplesPerPixel,
            rowsPerStrip: sampleImage.tags.rowsPerStrip,
            stripCount: sampleImage.tags.stripOffsets.length,
            planarConfiguration: sampleImage.tags.planarConfiguration,
            profile: sampleImage.tags.profile,
            uniqueColorCount: sampleUniqueColors.size,
        },
        deltaE: {
            min: Math.round(minDeltaE * 1000) / 1000,
            max: Math.round(maxDeltaE * 1000) / 1000,
            mean: Math.round(meanDeltaE * 1000) / 1000,
            median: Math.round(medianDeltaE * 1000) / 1000,
            stdDev: Math.round(stdDevDeltaE * 1000) / 1000,
            histogram,
        },
        topColors: {
            reference: refTopColorsWithMatch,
            sample: sampleTopColorsWithMatch,
        },
        crossMatched: crossMatchedColors,
        variability: variabilityColors,
    };
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
        'Minimum': result.deltaE.min,
        'Maximum': result.deltaE.max,
        'Mean': result.deltaE.mean,
        'Median': result.deltaE.median,
        'Std Dev': result.deltaE.stdDev,
    });
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
    };;
    console.table(Object.fromEntries(Object.entries(result.deltaE.histogram).map(([range, count]) => [rangeArrays[range], {
        Count: count,
        Percentage: round((count / totalPixels) * 100, 2),
    }])));
    console.groupEnd();

    // Top Reference Colors
    console.group(`\nTop ${result.topColors.reference.length} Reference Colors`);
    console.table(Object.fromEntries(result.topColors.reference.map(c => [c.rank, {
        L: round(c.L, 2),
        a: round(c.a, 2),
        b: round(c.b, 2),
        Count: c.count,
        Match: c.match,
    }])));
    console.groupEnd();

    // Top Sample Colors
    console.group(`\nTop ${result.topColors.sample.length} Sample Colors`);
    console.table(Object.fromEntries(result.topColors.sample.map(c => [c.rank, {
        L: round(c.L, 2),
        a: round(c.a, 2),
        b: round(c.b, 2),
        Count: c.count,
        Match: c.match,
    }])));
    console.groupEnd();

    // Cross-Matched Reference Colors
    if (result.crossMatched) {
        console.group(`\nCross-Matched Reference Colors (Delta-E by position)`);
        console.table(Object.fromEntries(result.crossMatched.map(c => [c.rank, {
            L: round(c.L, 2),
            a: round(c.a, 2),
            b: round(c.b, 2),
            Pixels: c.count,
            Overlaps: c.overlaps,
            Variants: c.variants,
            'Mean ΔE': round(c.deltaE.mean, 3),
            ...(extendedStatistics ? { 'Min ΔE': round(c.deltaE.min, 3) } : {}),
            'Max ΔE': round(c.deltaE.max, 3),
            'StdDev': round(c.deltaE.stdDev, 3),
            'Mean ΔEin': round(c.deltaEin.mean, 3),
            ...(extendedStatistics ? { 'Min ΔEin': round(c.deltaEin.min, 3) } : {}),
            'Max ΔEin': round(c.deltaEin.max, 3),
        }])));
        console.groupEnd();
    }

    // Cross-Matched Sample Variability
    if (result.variability && result.variability.length > 0) {
        /**
         * Format a VariabilityColor array for console.table
         * @param {VariabilityColor[]} colors
         */
        const formatVariabilityRow = (colors) => Object.fromEntries(colors.map(c => [c.rank, {
            'Reference Lab': [round(c.reference.L, 2), round(c.reference.a, 2), round(c.reference.b, 2)],
            'Sample Lab': [round(c.sample.L, 2), round(c.sample.a, 2), round(c.sample.b, 2)],
            Pixels: c.pixels,
            Overlaps: c.overlaps,
            Variants: c.variants,
            Coverage: round(c.coverage, 4),
            'Mean ΔE': round(c.deltaE.mean, 3),
            ...(extendedStatistics ? { 'Min ΔE': round(c.deltaE.min, 3) } : {}),
            'Max ΔE': round(c.deltaE.max, 3),
            'StdDev': round(c.deltaE.stdDev, 3),
            'Mean ΔEin': round(c.deltaEin.mean, 3),
            ...(extendedStatistics ? { 'Min ΔEin': round(c.deltaEin.min, 3) } : {}),
            'Max ΔEin': round(c.deltaEin.max, 3),
        }]));

        if (result.variability.length <= 20) {
            console.group(`\nCross-Matched Sample Variability`);
            console.table(formatVariabilityRow(result.variability));
            console.groupEnd();
        } else {
            console.group(`\nCross-Matched Sample Variability (Highest Coverage)`);
            console.table(formatVariabilityRow(result.variability.slice(0, 10)));
            console.groupEnd();

            console.group(`\nCross-Matched Sample Variability (Lowest Coverage)`);
            console.table(formatVariabilityRow(result.variability.slice(-10)));
            console.groupEnd();
        }

        // Overall summary table
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
                Pixels: round(aggregate(c => c.pixels), 0),
                Overlaps: round(aggregate(c => c.overlaps), 0),
                Variants: round(aggregate(c => c.variants), 0),
                Coverage: round(aggregate(c => c.coverage), 4),
                'Mean ΔE': round(aggregate(c => c.deltaE.mean), 3),
                ...(extendedStatistics ? { 'Min ΔE': round(aggregate(c => c.deltaE.min), 3) } : {}),
                'Max ΔE': round(aggregate(c => c.deltaE.max), 3),
                'StdDev': round(aggregate(c => c.deltaE.stdDev), 3),
                'Mean ΔEin': round(aggregate(c => c.deltaEin.mean), 3),
                ...(extendedStatistics ? { 'Min ΔEin': round(aggregate(c => c.deltaEin.min), 3) } : {}),
                'Max ΔEin': round(aggregate(c => c.deltaEin.max), 3),
            }]);

        const summaryRows = Object.fromEntries([
            summaryRow('Mean', meanOf),
            ...(extendedStatistics ? [summaryRow('Min', minOf)] : []),
            summaryRow('Max', maxOf),
        ]);

        console.group(`\nCross-Matched Sample Variability (Overall)`);
        console.table(summaryRows);
        console.groupEnd();
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
    fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
    console.log(`\nResults saved to: ${outputPath}`);
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
        const result = compareTIFFImages(referencePath, samplePath, options.topCount, options.crossMatching, options.crossMatchRounding, options.verbose);

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

main();

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
