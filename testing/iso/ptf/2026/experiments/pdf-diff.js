#!/usr/bin/env node
// @ts-check
/**
 * PDF Diff CLI Tool
 *
 * Extracts images from PDFs, converts them to Lab 16-bit TIFFs (TIFF 6.0 CIELab),
 * and delegates pixel-level comparison to tiff-diff.js as a subprocess.
 *
 * Key properties:
 * - Never downsamples images — all pixels are compared exhaustively
 * - Never introduces noise — validated by lazy pretesting of each conversion permutation
 * - Optimizes disk usage via reference counting for temp TIFF cleanup
 *
 * @module pdf-diff
 */

import fs from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import zlib from 'node:zlib';
import { basename, dirname, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { argv, exit, cwd } from 'node:process';
import { spawn } from 'node:child_process';
import { PDFDocument, PDFName, PDFArray, PDFDict, PDFRawStream, PDFRef, PDFPageLeaf, decodePDFRawStream } from '../packages/pdf-lib/pdf-lib.esm.js';

import { readTIFFImage, getLabFloat32ArrayFrom } from './tiff-diff.js';
import {
    readLargeFile,
    extractOutputIntentProfile,
    getColorSpaceInfo,
    extractImagesFromPage,
    findActualPdfPath,
    loadConfiguration,
    processConfigPaths,
    buildPdfPath,
    extractDateSeq,
} from './compare-pdf-outputs.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ============================================================================
// Subphase 1: TIFF Writer (Lab 16-bit, TIFF 6.0 CIELab)
// ============================================================================

/**
 * Encode Lab Float32 values to 16-bit CIELab per TIFF 6.0 spec.
 *
 * L*: 0-100 → 0-65535 (multiply by 655.35)
 * a*: -128..+127 → signed 16-bit (multiply by 256), stored unsigned
 * b*: -128..+127 → signed 16-bit (multiply by 256), stored unsigned
 *
 * @param {Float32Array} labPixels - Lab Float32 pixel data (L, a, b interleaved)
 * @returns {Uint16Array} - 16-bit CIELab encoded pixel data
 */
function encodeLabFloat32ToLab16(labPixels) {
    const u16 = new Uint16Array(labPixels.length);
    for (let i = 0; i < labPixels.length; i += 3) {
        // L*: 0-100 → 0-65535
        u16[i] = Math.max(0, Math.min(65535, Math.round(labPixels[i] * 655.35)));
        // a*: -128..+127 → signed 16-bit * 256, stored as unsigned
        u16[i + 1] = Math.max(0, Math.min(65535, Math.round(labPixels[i + 1] * 256) & 0xFFFF));
        // b*: -128..+127 → signed 16-bit * 256, stored as unsigned
        u16[i + 2] = Math.max(0, Math.min(65535, Math.round(labPixels[i + 2] * 256) & 0xFFFF));
    }
    return u16;
}

/**
 * Write a Lab 16-bit TIFF file (TIFF 6.0 CIELab).
 *
 * Produces a little-endian TIFF with ZIP-compressed 16-bit CIELab pixel data,
 * openable by Photoshop, Preview, and readable by tiff-diff.js.
 *
 * TIFF 6.0 baseline tags included: XResolution, YResolution, ResolutionUnit.
 *
 * @param {string} filePath - Output file path
 * @param {Float32Array} labPixels - Lab pixel data (L, a, b interleaved, Float32)
 * @param {number} width - Image width
 * @param {number} height - Image height
 */
function writeLabTIFF(filePath, labPixels, width, height) {
    const channels = 3;
    const expectedLength = width * height * channels;
    if (labPixels.length !== expectedLength) {
        throw new Error(`Expected ${expectedLength} float values, got ${labPixels.length}`);
    }

    // Encode Lab Float32 → Lab 16-bit CIELab
    const lab16 = encodeLabFloat32ToLab16(labPixels);

    // Compress pixel data with zlib (ZIP/Deflate)
    const pixelBytes = Buffer.from(lab16.buffer, lab16.byteOffset, lab16.byteLength);
    const compressedData = zlib.deflateSync(pixelBytes);

    // TIFF structure layout:
    // Header: 8 bytes
    // IFD: 2 (count) + N*12 (entries) + 4 (next IFD) bytes
    // Tag values that don't fit inline
    // Strip data (compressed pixels)

    const numTags = 14; // ImageWidth, ImageLength, BitsPerSample, Compression,
                        // PhotometricInterpretation, StripOffsets, SamplesPerPixel,
                        // RowsPerStrip, StripByteCounts, XResolution, YResolution,
                        // PlanarConfiguration, ResolutionUnit, SampleFormat
    const ifdSize = 2 + numTags * 12 + 4; // count + entries + next IFD pointer
    const ifdOffset = 8; // right after header

    // Offsets for values that don't fit inline in IFD entries:
    let valuesOffset = ifdOffset + ifdSize;

    // BitsPerSample: [16, 16, 16] — 3 SHORTs = 6 bytes
    const bitsPerSampleOffset = valuesOffset;
    valuesOffset += 6;

    // XResolution: RATIONAL (8 bytes — numerator + denominator as LONGs)
    const xResolutionOffset = valuesOffset;
    valuesOffset += 8;

    // YResolution: RATIONAL (8 bytes)
    const yResolutionOffset = valuesOffset;
    valuesOffset += 8;

    // SampleFormat: [1, 1, 1] — 3 SHORTs = 6 bytes
    const sampleFormatOffset = valuesOffset;
    valuesOffset += 6;

    // Strip data starts after all tag value arrays
    const stripDataOffset = valuesOffset;

    const totalSize = stripDataOffset + compressedData.length;
    const buffer = Buffer.alloc(totalSize);

    // Header (little-endian)
    buffer.write('II', 0, 'ascii');          // Byte order: little-endian
    buffer.writeUInt16LE(42, 2);             // Magic number
    buffer.writeUInt32LE(ifdOffset, 4);      // Offset to first IFD

    // IFD
    let pos = ifdOffset;
    buffer.writeUInt16LE(numTags, pos); pos += 2;

    // Helper to write an IFD entry
    const writeTag = (tag, type, count, value) => {
        buffer.writeUInt16LE(tag, pos);      // Tag
        buffer.writeUInt16LE(type, pos + 2); // Type (3=SHORT, 4=LONG, 5=RATIONAL)
        buffer.writeUInt32LE(count, pos + 4); // Count
        if (type === 3 && count === 1) {
            buffer.writeUInt16LE(value, pos + 8);
            buffer.writeUInt16LE(0, pos + 10);
        } else {
            buffer.writeUInt32LE(value, pos + 8); // Value or offset
        }
        pos += 12;
    };

    // Tags in numeric order (required by TIFF spec)
    writeTag(256, 4, 1, width);                         // ImageWidth (LONG)
    writeTag(257, 4, 1, height);                        // ImageLength (LONG)
    writeTag(258, 3, 3, bitsPerSampleOffset);           // BitsPerSample (SHORT array → offset)
    writeTag(259, 3, 1, 8);                             // Compression: ZIP/Deflate
    writeTag(262, 3, 1, 8);                             // PhotometricInterpretation: CIELab
    writeTag(273, 4, 1, stripDataOffset);               // StripOffsets (single strip)
    writeTag(277, 3, 1, channels);                      // SamplesPerPixel
    writeTag(278, 4, 1, height);                        // RowsPerStrip (all rows in one strip)
    writeTag(279, 4, 1, compressedData.length);         // StripByteCounts
    writeTag(282, 5, 1, xResolutionOffset);             // XResolution (RATIONAL → offset)
    writeTag(283, 5, 1, yResolutionOffset);             // YResolution (RATIONAL → offset)
    writeTag(284, 3, 1, 1);                             // PlanarConfiguration: Chunky
    writeTag(296, 3, 1, 2);                             // ResolutionUnit: inches
    writeTag(339, 3, 3, sampleFormatOffset);            // SampleFormat (SHORT array → offset)

    // Next IFD offset (0 = no more IFDs)
    buffer.writeUInt32LE(0, pos);

    // BitsPerSample values: [16, 16, 16]
    buffer.writeUInt16LE(16, bitsPerSampleOffset);
    buffer.writeUInt16LE(16, bitsPerSampleOffset + 2);
    buffer.writeUInt16LE(16, bitsPerSampleOffset + 4);

    // XResolution: 72/1
    buffer.writeUInt32LE(72, xResolutionOffset);
    buffer.writeUInt32LE(1, xResolutionOffset + 4);

    // YResolution: 72/1
    buffer.writeUInt32LE(72, yResolutionOffset);
    buffer.writeUInt32LE(1, yResolutionOffset + 4);

    // SampleFormat values: [1, 1, 1] (unsigned integer)
    buffer.writeUInt16LE(1, sampleFormatOffset);
    buffer.writeUInt16LE(1, sampleFormatOffset + 2);
    buffer.writeUInt16LE(1, sampleFormatOffset + 4);

    // Compressed strip data
    compressedData.copy(buffer, stripDataOffset);

    fs.writeFileSync(filePath, buffer);
}

// ============================================================================
// Subphase 2: Color Engine Initialization and Format Selection
// ============================================================================

/**
 * Initialize the color engine for a given version.
 *
 * @param {string} engineVersion - e.g., '2026-01-30'
 * @returns {Promise<{ engine: any, module: any }>}
 */
async function initializeColorEngine(engineVersion) {
    const modulePath = `../packages/color-engine-${engineVersion}/src/index.js`;
    const module = await import(modulePath);
    const engine = await module.createEngine();
    return { engine, module };
}

/**
 * Map PDF color space name to engine-compatible category.
 * Follows compare-pdf-outputs.js mapColorSpace() pattern (line 1352).
 *
 * @param {string} pdfColorSpace
 * @returns {'RGB' | 'CMYK' | 'Gray' | 'Lab'}
 */
function mapColorSpace(pdfColorSpace) {
    if (pdfColorSpace === 'DeviceCMYK') return 'CMYK';
    if (pdfColorSpace === 'DeviceRGB') return 'RGB';
    if (pdfColorSpace === 'DeviceGray') return 'Gray';
    if (pdfColorSpace === 'Lab') return 'Lab';
    if (pdfColorSpace.startsWith('ICCBased')) {
        if (pdfColorSpace === 'ICCBasedGray') return 'Gray';
        if (pdfColorSpace === 'ICCBasedRGB') return 'RGB';
        if (pdfColorSpace === 'ICCBasedCMYK') return 'CMYK';
        const match = pdfColorSpace.match(/\((\d+)\)/);
        if (match) {
            const channels = parseInt(match[1], 10);
            if (channels === 1) return 'Gray';
            if (channels === 3) return 'RGB';
            if (channels === 4) return 'CMYK';
        }
    }
    return 'CMYK'; // Default to CMYK for unknown
}

/**
 * Get pixel format info for a color space and bit depth combination.
 *
 * @param {string} colorSpace - Engine-compatible color space ('RGB', 'CMYK', 'Gray', 'Lab')
 * @param {number} bitsPerComponent - 8, 16, or 32
 * @param {any} module - Color engine module (for format constants)
 * @returns {{ format: number | null, channels: number, needsConversion: boolean }}
 */
function getPixelFormatInfo(colorSpace, bitsPerComponent, module) {
    const formatMap = {
        'CMYK': { 8: module.TYPE_CMYK_8, 16: module.TYPE_CMYK_16 },
        'RGB': { 8: module.TYPE_RGB_8, 16: module.TYPE_RGB_16 },
        'Gray': { 8: module.TYPE_GRAY_8, 16: module.TYPE_GRAY_16 },
        'Lab': { 8: module.TYPE_Lab_8, 16: module.TYPE_Lab_16 },
    };

    const channelMap = { 'CMYK': 4, 'RGB': 3, 'Gray': 1, 'Lab': 3 };
    const channels = channelMap[colorSpace] || 4;

    // Lab Float32 — identity, no conversion needed
    if (colorSpace === 'Lab' && bitsPerComponent === 32) {
        return { format: null, channels, needsConversion: false };
    }

    const format = formatMap[colorSpace]?.[bitsPerComponent] ?? null;
    if (format === null) {
        throw new Error(`No format constant for ${colorSpace} ${bitsPerComponent}-bit`);
    }

    return { format, channels, needsConversion: true };
}

/**
 * Create a transform from input format to Lab Float32.
 *
 * @param {any} engine - Color engine instance
 * @param {any} module - Color engine module
 * @param {number} inputFormat - Input pixel format constant
 * @param {ArrayBuffer | Uint8Array | null} iccProfile - ICC profile data (null for sRGB/Gray2 fallback)
 * @param {string} colorSpace - Engine-compatible color space
 * @param {ArrayBuffer | Uint8Array | null} outputIntentProfile - Output Intent ICC profile for Device* fallback
 * @returns {any} - Color engine transform handle
 */
function createToLabFloat32Transform(engine, module, inputFormat, iccProfile, colorSpace, outputIntentProfile) {
    // Create Lab profile
    const labProfile = engine.createLab4Profile(0);

    // Create source profile
    let sourceProfile;
    if (iccProfile) {
        const profileBuffer = iccProfile instanceof ArrayBuffer ? iccProfile : iccProfile.buffer.slice(iccProfile.byteOffset, iccProfile.byteOffset + iccProfile.byteLength);
        sourceProfile = engine.openProfileFromMem(new Uint8Array(profileBuffer));
    } else {
        // Device color space fallback
        switch (colorSpace) {
            case 'RGB':
                sourceProfile = engine.createSRGBProfile();
                break;
            case 'Gray':
                sourceProfile = engine.createGray2Profile();
                break;
            case 'CMYK':
                if (!outputIntentProfile) {
                    throw new Error('DeviceCMYK requires Output Intent profile — no fallback available');
                }
                const cmykBuffer = outputIntentProfile instanceof ArrayBuffer
                    ? outputIntentProfile
                    : outputIntentProfile.buffer.slice(outputIntentProfile.byteOffset, outputIntentProfile.byteOffset + outputIntentProfile.byteLength);
                sourceProfile = engine.openProfileFromMem(new Uint8Array(cmykBuffer));
                break;
            case 'Lab':
                sourceProfile = engine.createLab4Profile(0);
                break;
            default:
                throw new Error(`Cannot create fallback profile for ${colorSpace}`);
        }
    }

    // Create transform: source → Lab Float32
    const intent = module.INTENT_RELATIVE_COLORIMETRIC;
    const flags = module.cmsFLAGS_BLACKPOINTCOMPENSATION;
    return engine.createTransform(sourceProfile, inputFormat, labProfile, module.TYPE_Lab_FLT, intent, flags);
}

// ============================================================================
// Subphase 3: Pipeline Pretest System
// ============================================================================

/**
 * @typedef {{
 *   permutation: string,
 *   maxDeltaE: number,
 *   meanDeltaE: number,
 *   tiffRoundtripExact: boolean,
 *   passed: boolean,
 *   timestamp: string,
 *   engineVersion: string,
 * }} PretestResult
 */

/**
 * Ensure a pretest has been run for a given permutation.
 *
 * @param {Map<string, PretestResult>} cache - In-memory pretest cache
 * @param {string} permutationKey - Cache key
 * @param {any} engine - Color engine instance
 * @param {any} module - Color engine module
 * @param {string} colorSpace - Engine-compatible color space
 * @param {number} bitsPerComponent - 8 or 16
 * @param {ArrayBuffer | Uint8Array | null} iccProfile - ICC profile data
 * @param {ArrayBuffer | Uint8Array | null} outputIntentProfile - Output Intent for Device* fallback
 * @param {string} engineVersion - Color engine version string
 * @param {string} tempDir - Temp directory for TIFF roundtrip test
 * @param {boolean} verbose - Verbose output
 * @returns {Promise<PretestResult>}
 */
async function ensurePretest(cache, permutationKey, engine, module, colorSpace, bitsPerComponent, iccProfile, outputIntentProfile, engineVersion, tempDir, verbose) {
    if (cache.has(permutationKey)) {
        return cache.get(permutationKey);
    }

    const result = await runPipelinePretest(
        permutationKey, engine, module, colorSpace, bitsPerComponent,
        iccProfile, outputIntentProfile, engineVersion, tempDir, verbose
    );
    cache.set(permutationKey, result);
    return result;
}

/**
 * Run a pipeline pretest for a specific conversion permutation.
 *
 * Creates a 10x10 test image with known colors, converts to Lab Float32,
 * writes to Lab 16-bit TIFF, reads back, and verifies Lab 16-bit roundtrip.
 *
 * The roundtrip through Lab 16-bit encoding introduces quantization
 * (Float32 → Lab16 → Float32), so the pretest validates that:
 * 1. The TIFF roundtrip produces values matching the expected Lab16 encode/decode
 * 2. The quantization error (Delta-E) is within acceptable bounds
 *
 * @param {string} permutationKey
 * @param {any} engine
 * @param {any} module
 * @param {string} colorSpace
 * @param {number} bitsPerComponent
 * @param {ArrayBuffer | Uint8Array | null} iccProfile
 * @param {ArrayBuffer | Uint8Array | null} outputIntentProfile
 * @param {string} engineVersion
 * @param {string} tempDir
 * @param {boolean} verbose
 * @returns {Promise<PretestResult>}
 */
async function runPipelinePretest(permutationKey, engine, module, colorSpace, bitsPerComponent, iccProfile, outputIntentProfile, engineVersion, tempDir, verbose) {
    const width = 10;
    const height = 10;
    const pixelCount = width * height;
    const { format, channels, needsConversion } = getPixelFormatInfo(colorSpace, bitsPerComponent, module);

    // Create test image with well-known stable color values
    let testPixels;
    if (bitsPerComponent === 8) {
        testPixels = new Uint8Array(pixelCount * channels);
        for (let i = 0; i < pixelCount; i++) {
            const offset = i * channels;
            const value = Math.round((i / (pixelCount - 1)) * 255);
            for (let c = 0; c < channels; c++) {
                testPixels[offset + c] = value;
            }
        }
    } else if (bitsPerComponent === 16) {
        testPixels = new Uint16Array(pixelCount * channels);
        for (let i = 0; i < pixelCount; i++) {
            const offset = i * channels;
            const value = Math.round((i / (pixelCount - 1)) * 65535);
            for (let c = 0; c < channels; c++) {
                testPixels[offset + c] = value;
            }
        }
    } else {
        // Lab Float32 — identity, no conversion needed; pretest validates Lab16 roundtrip
        const labPixels = new Float32Array(pixelCount * 3);
        for (let i = 0; i < pixelCount; i++) {
            labPixels[i * 3] = (i / (pixelCount - 1)) * 100;     // L*: 0-100
            labPixels[i * 3 + 1] = 0;                             // a*: 0
            labPixels[i * 3 + 2] = 0;                             // b*: 0
        }

        // Write and read back to test Lab 16-bit TIFF roundtrip
        const tiffPath = resolve(tempDir, `pretest-${permutationKey}.tif`);
        await mkdir(dirname(tiffPath), { recursive: true });
        writeLabTIFF(tiffPath, labPixels, width, height);
        const readBack = readTIFFImage(tiffPath);
        const readLabPixels = getLabFloat32ArrayFrom(readBack);

        // Compute expected Lab16 encode/decode roundtrip values locally
        const expectedRoundtrip = new Float32Array(labPixels.length);
        const lab16 = encodeLabFloat32ToLab16(labPixels);
        for (let i = 0; i < labPixels.length; i += 3) {
            expectedRoundtrip[i] = lab16[i] / 655.35;
            const rawA = lab16[i + 1] > 32767 ? lab16[i + 1] - 65536 : lab16[i + 1];
            const rawB = lab16[i + 2] > 32767 ? lab16[i + 2] - 65536 : lab16[i + 2];
            expectedRoundtrip[i + 1] = rawA / 256;
            expectedRoundtrip[i + 2] = rawB / 256;
        }

        // Verify TIFF roundtrip matches expected Lab16 encode/decode
        let tiffRoundtripExact = true;
        for (let i = 0; i < expectedRoundtrip.length; i++) {
            if (Math.abs(expectedRoundtrip[i] - readLabPixels[i]) > 1e-6) {
                tiffRoundtripExact = false;
                break;
            }
        }

        fs.unlinkSync(tiffPath);

        /** @type {PretestResult} */
        const result = {
            permutation: permutationKey,
            maxDeltaE: 0,
            meanDeltaE: 0,
            tiffRoundtripExact,
            passed: tiffRoundtripExact,
            timestamp: new Date().toISOString(),
            engineVersion,
        };

        if (verbose) {
            console.log(`  [PRETEST] ${permutationKey}: Lab16 roundtrip exact=${tiffRoundtripExact} (identity)`);
        }

        return result;
    }

    // Convert test pixels to Lab Float32 via color engine
    if (!needsConversion || format === null) {
        throw new Error(`Unexpected: needsConversion=${needsConversion} for ${permutationKey}`);
    }

    const transform = createToLabFloat32Transform(engine, module, format, iccProfile, colorSpace, outputIntentProfile);
    const outputLabPixels = new Float32Array(pixelCount * 3);
    engine.transformArray(transform, testPixels, outputLabPixels, pixelCount);

    // Write Lab Float32 to Lab 16-bit TIFF and read back (roundtrip test)
    const tiffPath = resolve(tempDir, `pretest-${permutationKey}.tif`);
    await mkdir(dirname(tiffPath), { recursive: true });
    writeLabTIFF(tiffPath, outputLabPixels, width, height);
    const readBack = readTIFFImage(tiffPath);
    const readLabPixels = getLabFloat32ArrayFrom(readBack);

    // Compute expected Lab16 encode/decode roundtrip values locally
    const expectedRoundtrip = new Float32Array(outputLabPixels.length);
    const lab16 = encodeLabFloat32ToLab16(outputLabPixels);
    for (let i = 0; i < outputLabPixels.length; i += 3) {
        expectedRoundtrip[i] = lab16[i] / 655.35;
        const rawA = lab16[i + 1] > 32767 ? lab16[i + 1] - 65536 : lab16[i + 1];
        const rawB = lab16[i + 2] > 32767 ? lab16[i + 2] - 65536 : lab16[i + 2];
        expectedRoundtrip[i + 1] = rawA / 256;
        expectedRoundtrip[i + 2] = rawB / 256;
    }

    // Verify TIFF roundtrip matches expected Lab16 encode/decode
    let tiffRoundtripExact = true;
    let maxDeltaE = 0;
    let totalDeltaE = 0;

    for (let i = 0; i < pixelCount; i++) {
        const offset = i * 3;
        // Check Lab16 roundtrip exactness (TIFF read matches expected encode/decode)
        if (Math.abs(expectedRoundtrip[offset] - readLabPixels[offset]) > 1e-6 ||
            Math.abs(expectedRoundtrip[offset + 1] - readLabPixels[offset + 1]) > 1e-6 ||
            Math.abs(expectedRoundtrip[offset + 2] - readLabPixels[offset + 2]) > 1e-6) {
            tiffRoundtripExact = false;
        }
        // Compute Delta-E between direct engine output and roundtripped (quantization error)
        const dL = outputLabPixels[offset] - readLabPixels[offset];
        const da = outputLabPixels[offset + 1] - readLabPixels[offset + 1];
        const db = outputLabPixels[offset + 2] - readLabPixels[offset + 2];
        const deltaE = Math.sqrt(dL * dL + da * da + db * db);
        maxDeltaE = Math.max(maxDeltaE, deltaE);
        totalDeltaE += deltaE;
    }

    fs.unlinkSync(tiffPath);

    const meanDeltaE = totalDeltaE / pixelCount;
    // Roundtrip must match expected Lab16 encode/decode exactly.
    // Lab16 encoding clamps out-of-gamut values (L* < 0 or > 100, a*/b* outside -128..+127),
    // which produces larger Delta-E for extreme test inputs (e.g., CMYK 400% total ink).
    // Threshold of 2.0 catches real pipeline errors (byte-swap, format mismatch → ΔE >> 10)
    // while allowing Lab16 out-of-gamut clamping artifacts.
    const passed = tiffRoundtripExact && maxDeltaE < 2.0;

    /** @type {PretestResult} */
    const result = {
        permutation: permutationKey,
        maxDeltaE,
        meanDeltaE,
        tiffRoundtripExact,
        passed,
        timestamp: new Date().toISOString(),
        engineVersion,
    };

    if (verbose || !passed) {
        const status = passed ? 'PASS' : 'FAIL';
        console.log(`  [PRETEST] ${permutationKey}: ${status} (roundtrip exact=${tiffRoundtripExact}, maxΔE=${maxDeltaE.toFixed(6)})`);
    }

    return result;
}

// ============================================================================
// Subphase 4: PDF Image Extraction and Lab Conversion
// ============================================================================

/**
 * @typedef {{
 *   name: string,
 *   pageIndex: number,
 *   tiffPath: string,
 *   width: number,
 *   height: number,
 *   colorSpace: string,
 *   bitsPerComponent: number,
 * }} ExtractedImageInfo
 */

/**
 * Convert raw pixel data to Lab Float32.
 *
 * Handles 16-bit big-endian byte-swap (PDF stores 16-bit as big-endian,
 * color engine expects native-endian Uint16Array).
 *
 * @param {Uint8Array} pixelData - Raw pixel data from PDF
 * @param {number} width
 * @param {number} height
 * @param {string} colorSpace - Engine-compatible color space
 * @param {number} bitsPerComponent
 * @param {number} channels
 * @param {number} inputFormat - Color engine format constant
 * @param {any} engine
 * @param {any} module
 * @param {ArrayBuffer | Uint8Array | null} iccProfile
 * @param {ArrayBuffer | Uint8Array | null} outputIntentProfile
 * @returns {Float32Array}
 */
function convertPixelsToLabFloat32(pixelData, width, height, colorSpace, bitsPerComponent, channels, inputFormat, engine, module, iccProfile, outputIntentProfile) {
    const pixelCount = width * height;

    // Lab absolute-zero pixel coercion (see 2026-02-06-LAB-COERCE-ABSOLUTE-ZERO-PIXELS.md):
    // Photoshop uses Lab 0/-128/-128 in mask images for black. This encodes as all-zero bytes
    // in both 8-bit ([0x00,0x00,0x00]) and 16-bit big-endian ([0x00,0x00,0x00,0x00,0x00,0x00]).
    // The out-of-gamut a=-128, b=-128 values get gamut-mapped during transforms, producing
    // non-black output with huge Delta-E. Replace with Lab 0/0/0 before transform, then
    // restore L=0, a=-128, b=-128 in the Float32 output.
    let labAbsoluteZeroPositions = null;
    if (colorSpace === 'Lab') {
        const bytesPerPixel = bitsPerComponent === 16 ? 6 : 3;
        // Lab 0/0/0 (proper black, neutral a/b) encoded as raw bytes:
        // 8-bit:  L=0→0x00, a=0→0x80 (128), b=0→0x80 (128)
        // 16-bit big-endian: L=0→[0x00,0x00], a=0→[0x80,0x00], b=0→[0x80,0x00]
        const replacementBytes = bitsPerComponent === 16
            ? [0x00, 0x00, 0x80, 0x00, 0x80, 0x00]
            : [0x00, 0x80, 0x80];

        for (let offset = 0; offset + bytesPerPixel <= pixelData.length; offset += bytesPerPixel) {
            let isAbsoluteZero = true;
            for (let j = 0; j < bytesPerPixel; j++) {
                if (pixelData[offset + j] !== 0) {
                    isAbsoluteZero = false;
                    break;
                }
            }
            if (isAbsoluteZero) {
                if (!labAbsoluteZeroPositions) labAbsoluteZeroPositions = [];
                labAbsoluteZeroPositions.push(offset / bytesPerPixel);
                for (let j = 0; j < bytesPerPixel; j++) {
                    pixelData[offset + j] = replacementBytes[j];
                }
            }
        }
    }

    let inputBuffer;
    if (bitsPerComponent === 8) {
        inputBuffer = pixelData;
    } else if (bitsPerComponent === 16) {
        // PDF stores 16-bit values as big-endian bytes
        // Color engine TYPE_*_16 expects native-endian (little-endian) Uint16Array
        // Must byte-swap from big-endian to native-endian
        const u16 = new Uint16Array(pixelCount * channels);
        for (let i = 0; i < u16.length; i++) {
            u16[i] = (pixelData[i * 2] << 8) | pixelData[i * 2 + 1];
        }
        inputBuffer = u16;
    } else {
        throw new Error(`Unsupported bitsPerComponent: ${bitsPerComponent}`);
    }

    const transform = createToLabFloat32Transform(engine, module, inputFormat, iccProfile, colorSpace, outputIntentProfile);
    const outputLabPixels = new Float32Array(pixelCount * 3);
    engine.transformArray(transform, inputBuffer, outputLabPixels, pixelCount);

    // Write back Lab 0/-128/-128 at tracked positions in Float32 output
    if (labAbsoluteZeroPositions) {
        for (const pixelIndex of labAbsoluteZeroPositions) {
            const offset = pixelIndex * 3;
            outputLabPixels[offset] = 0;       // L* = 0
            outputLabPixels[offset + 1] = -128; // a* = -128
            outputLabPixels[offset + 2] = -128; // b* = -128
        }
    }

    return outputLabPixels;
}

/**
 * Extract all images from a PDF and write them as Lab Float32 TIFFs.
 *
 * @param {string} pdfPath - Path to PDF file
 * @param {string} tempDir - Temp directory for TIFF output
 * @param {string} pdfLabel - Label for temp subdirectory
 * @param {any} engine - Color engine instance
 * @param {any} module - Color engine module
 * @param {Map<string, PretestResult>} pretestCache - Pretest cache
 * @param {string} engineVersion - Color engine version
 * @param {{ verbose: boolean, skipPretests: boolean }} options
 * @returns {Promise<ExtractedImageInfo[]>}
 */
async function extractPDFImagesToLabTIFF(pdfPath, tempDir, pdfLabel, engine, module, pretestCache, engineVersion, options) {
    const pdfBytes = await readLargeFile(pdfPath);
    const pdfDocument = await PDFDocument.load(pdfBytes);
    const context = pdfDocument.context;

    // Extract Output Intent profile (needed for Device* color spaces)
    const outputIntent = extractOutputIntentProfile(pdfDocument);
    const outputIntentProfile = outputIntent ? outputIntent.profile : null;

    const pdfTempDir = resolve(tempDir, pdfLabel);
    await mkdir(pdfTempDir, { recursive: true });

    const pages = pdfDocument.getPages();
    const extractedImages = [];

    for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
        const page = pages[pageIndex];
        const images = extractImagesFromPage(page.node, context);

        for (const image of images) {
            const colorSpace = mapColorSpace(image.colorSpace);
            const { format, channels, needsConversion } = getPixelFormatInfo(colorSpace, image.bitsPerComponent, module);

            // Run pretest for this permutation (unless skipped)
            if (!options.skipPretests && needsConversion) {
                const pretestKey = `${colorSpace}_${image.bitsPerComponent}_to_Lab_FLT@${engineVersion}`;
                const pretestResult = await ensurePretest(
                    pretestCache, pretestKey, engine, module,
                    colorSpace, image.bitsPerComponent,
                    image.iccProfile || null, outputIntentProfile,
                    engineVersion, tempDir, options.verbose
                );
                if (!pretestResult.passed) {
                    console.warn(`  [WARNING] Pretest failed for ${pretestKey} — proceeding anyway`);
                }
            }

            // Convert to Lab Float32
            let labPixels;
            if (!needsConversion) {
                // Lab Float32 — identity copy
                if (image.bitsPerComponent === 32) {
                    labPixels = new Float32Array(
                        image.pixelData.buffer,
                        image.pixelData.byteOffset,
                        image.pixelData.byteLength / 4
                    );
                } else {
                    throw new Error(`Lab identity only supported for 32-bit, got ${image.bitsPerComponent}-bit`);
                }
            } else {
                labPixels = convertPixelsToLabFloat32(
                    image.pixelData, image.width, image.height,
                    colorSpace, image.bitsPerComponent, channels, format,
                    engine, module, image.iccProfile || null, outputIntentProfile
                );
            }

            // Write Lab 16-bit TIFF (TIFF 6.0 CIELab)
            const tiffName = `page-${pageIndex}-${image.name}-${colorSpace}-${image.bitsPerComponent}bit.tif`;
            const tiffPath = resolve(pdfTempDir, tiffName);
            writeLabTIFF(tiffPath, labPixels, image.width, image.height);

            extractedImages.push({
                name: image.name,
                pageIndex,
                tiffPath,
                width: image.width,
                height: image.height,
                colorSpace: image.colorSpace,
                bitsPerComponent: image.bitsPerComponent,
            });

            // Release pixel buffers
            labPixels = null;

            if (options.verbose) {
                console.log(`    Extracted ${image.name} (${image.colorSpace} ${image.bitsPerComponent}-bit, ${image.width}x${image.height}) → ${tiffName}`);
            }
        }
    }

    return extractedImages;
}

// ============================================================================
// Subphase 5: Comparison Planner and Extraction Optimizer
// ============================================================================

/**
 * @typedef {{
 *   label: string,
 *   referencePdfPath: string,
 *   referencePdfLabel: string,
 *   samplePdfPath: string,
 *   samplePdfLabel: string,
 *   groupDescription: string,
 *   inputName: string,
 *   outputName: string,
 *   comparisonMode: 'pairs' | 'reference',
 * }} ComparisonPair
 */

/**
 * @typedef {{
 *   pairs: ComparisonPair[],
 *   uniquePdfs: Map<string, { path: string, label: string, referenceCount: number }>,
 * }} ComparisonPlan
 */

/**
 * Build a comparison plan for single mode (two PDFs).
 *
 * @param {string} referencePdfPath
 * @param {string} samplePdfPath
 * @returns {ComparisonPlan}
 */
function buildSingleComparisonPlan(referencePdfPath, samplePdfPath) {
    const refLabel = makeTempLabel(basename(referencePdfPath, '.pdf'));
    const sampleLabel = makeTempLabel(basename(samplePdfPath, '.pdf'));

    const pair = {
        label: `${refLabel} vs ${sampleLabel}`,
        referencePdfPath,
        referencePdfLabel: refLabel,
        samplePdfPath,
        samplePdfLabel: sampleLabel,
        groupDescription: '',
        inputName: '',
        outputName: '',
        comparisonMode: 'pairs',
    };

    const uniquePdfs = new Map();
    uniquePdfs.set(referencePdfPath, { path: referencePdfPath, label: refLabel, referenceCount: 1 });
    if (referencePdfPath !== samplePdfPath) {
        uniquePdfs.set(samplePdfPath, { path: samplePdfPath, label: sampleLabel, referenceCount: 1 });
    }

    return { pairs: [pair], uniquePdfs };
}

/**
 * Create a temp directory label from a PDF label.
 * Preserves the full label with spaces (matching naming conventions),
 * appends a short GUID suffix in parentheses for uniqueness.
 * @param {string} label
 * @returns {string}
 */
function makeTempLabel(label) {
    const guid = randomUUID().substring(0, 8);
    return `${label} (${guid})`;
}

/**
 * Build a comparison plan from batch configuration.
 *
 * @param {any} config - Parsed configuration
 * @param {URL} configURL - Configuration file URL
 * @param {string} outputDir - Output directory containing converted PDFs
 * @returns {ComparisonPlan}
 */
function buildBatchComparisonPlan(config, configURL, outputDir) {
    const dateSeq = extractDateSeq(outputDir);
    const pairs = [];
    const uniquePdfs = new Map();

    const trackPdf = (path, label) => {
        if (!uniquePdfs.has(path)) {
            uniquePdfs.set(path, { path, label, referenceCount: 0 });
        }
        uniquePdfs.get(path).referenceCount++;
    };

    if (!config.comparisons?.groups) {
        throw new Error('Configuration has no comparisons.groups');
    }

    for (const group of config.comparisons.groups) {
        if (!group.enabled) continue;

        const inputName = group.input;
        const inputDef = config.inputs?.[inputName];
        if (!inputDef) {
            console.warn(`  [WARNING] Input "${inputName}" not found in config`);
            continue;
        }

        // Reference PDF (original input) — used for reference-mode comparisons
        const referencePdfPath = inputDef.pdf;

        for (const outputName of (group.outputs || [])) {
            // Process each pair definition
            for (const pairDef of (group.pairs || [])) {
                const memberNames = Object.keys(pairDef);

                if (memberNames.length === 2) {
                    // Pairs mode: compare the two configurations against each other
                    const configA = pairDef[memberNames[0]];
                    const configB = pairDef[memberNames[1]];

                    const pathA = buildPdfPath(inputName, configA, outputName, outputDir, dateSeq);
                    const pathB = buildPdfPath(inputName, configB, outputName, outputDir, dateSeq);

                    const actualPathA = findActualPdfPath(pathA, outputDir);
                    const actualPathB = findActualPdfPath(pathB, outputDir);

                    if (!actualPathA || !actualPathB) {
                        if (!actualPathA) console.warn(`  [WARNING] PDF not found: ${basename(pathA)}`);
                        if (!actualPathB) console.warn(`  [WARNING] PDF not found: ${basename(pathB)}`);
                        continue;
                    }

                    const labelA = makeTempLabel(`${inputName} - ${outputName} - ${configA} (${dateSeq})`);
                    const labelB = makeTempLabel(`${inputName} - ${outputName} - ${configB} (${dateSeq})`);

                    trackPdf(actualPathA, labelA);
                    trackPdf(actualPathB, labelB);

                    pairs.push({
                        label: `${memberNames[0]} vs ${memberNames[1]}: ${inputName} / ${outputName}`,
                        referencePdfPath: actualPathA,
                        referencePdfLabel: labelA,
                        samplePdfPath: actualPathB,
                        samplePdfLabel: labelB,
                        groupDescription: group.description || '',
                        inputName,
                        outputName,
                        comparisonMode: 'pairs',
                    });
                }
            }

            // Reference mode: compare each configuration against the original input
            for (const aspect of (group.aspects || [])) {
                if (aspect.reference) {
                    for (const pairDef of (group.pairs || [])) {
                        for (const memberName of Object.keys(pairDef)) {
                            const configName = pairDef[memberName];
                            const samplePath = buildPdfPath(inputName, configName, outputName, outputDir, dateSeq);
                            const actualSamplePath = findActualPdfPath(samplePath, outputDir);

                            if (!actualSamplePath) {
                                console.warn(`  [WARNING] PDF not found: ${basename(samplePath)}`);
                                continue;
                            }

                            const refLabel = makeTempLabel(basename(referencePdfPath, '.pdf'));
                            const sampleLabel = makeTempLabel(`${inputName} - ${outputName} - ${configName} (${dateSeq})`);

                            trackPdf(referencePdfPath, refLabel);
                            trackPdf(actualSamplePath, sampleLabel);

                            pairs.push({
                                label: `Reference vs ${memberName}: ${inputName} / ${outputName}`,
                                referencePdfPath,
                                referencePdfLabel: refLabel,
                                samplePdfPath: actualSamplePath,
                                samplePdfLabel: sampleLabel,
                                groupDescription: group.description || '',
                                inputName,
                                outputName,
                                comparisonMode: 'reference',
                            });
                        }
                    }
                }
            }
        }
    }

    return { pairs, uniquePdfs };
}

// ============================================================================
// Subphase 6: tiff-diff Subprocess Integration
// ============================================================================

/**
 * Run tiff-diff.js as a subprocess on two TIFF files.
 *
 * @param {string} referenceTIFF - Path to reference TIFF
 * @param {string} sampleTIFF - Path to sample TIFF
 * @param {{ topCount: number, logPath?: string }} options
 * @returns {Promise<object | null>} - Parsed JSON result from tiff-diff, or null on error
 */
async function runTIFFDiff(referenceTIFF, sampleTIFF, options) {
    const tiffDiffPath = resolve(__dirname, 'tiff-diff.js');

    return new Promise((resolvePromise, reject) => {
        const args = [
            '--max-old-space-size=8192',
            tiffDiffPath,
            referenceTIFF,
            sampleTIFF,
            `--top=${options.topCount}`,
            '--with-extended-statistics',
        ];

        const proc = spawn('node', args, {
            stdio: ['ignore', 'pipe', 'pipe'],
            timeout: 600000,
        });

        // Write tiff-diff subprocess output to a log file next to the sample TIFF.
        // Pattern follows generate-verification-matrix.mjs runConversion():
        // pipe subprocess stdout/stderr to both console and a .tiff-diff.log file.
        const logPath = options.logPath;
        const logStream = logPath ? fs.createWriteStream(logPath, { flags: 'w' }) : null;
        if (logStream) {
            logStream.write(`node ${args.join(' ')}\n\n`);
        }

        let stdout = '';
        let stderr = '';

        proc.stdout.on('data', (data) => {
            stdout += data.toString();
            if (logStream) logStream.write(data);
        });
        proc.stderr.on('data', (data) => {
            stderr += data.toString();
            if (logStream) logStream.write(data);
        });

        proc.on('close', async (code) => {
            if (logStream) logStream.end();

            if (code !== 0) {
                console.error(`  [tiff-diff] Exit code ${code}: ${stderr.trim()}`);
                resolvePromise(null);
                return;
            }

            // tiff-diff writes JSON output to <sampleTIFF>.json as an array
            // (each run appends to the array). Extract the last entry.
            const jsonPath = `${sampleTIFF}.json`;
            try {
                const jsonContent = await readFile(jsonPath, 'utf-8');
                const parsed = JSON.parse(jsonContent);
                const fullResult = Array.isArray(parsed) ? parsed[parsed.length - 1] : parsed;
                // Clean up the JSON file (temp artifact)
                fs.unlinkSync(jsonPath);

                // Extract summary statistics and variabilitySummary. The full
                // crossMatched and variability arrays (thousands of entries per
                // image) remain excluded — too large for multi-image reports.
                // The compact variabilitySummary is kept for aggregate reporting.
                const summary = {
                    reference: {
                        filename: fullResult.reference?.filename,
                        width: fullResult.reference?.width,
                        height: fullResult.reference?.height,
                        uniqueColorCount: fullResult.reference?.uniqueColorCount,
                    },
                    sample: {
                        filename: fullResult.sample?.filename,
                        width: fullResult.sample?.width,
                        height: fullResult.sample?.height,
                        uniqueColorCount: fullResult.sample?.uniqueColorCount,
                    },
                    deltaE: fullResult.deltaE,
                    topColors: fullResult.topColors,
                    variabilitySummary: fullResult.variabilitySummary ?? null,
                };
                resolvePromise(summary);
            } catch (error) {
                console.error(`  [tiff-diff] Failed to read results: ${error.message}`);
                resolvePromise(null);
            }
        });

        proc.on('error', (error) => {
            if (logStream) logStream.end();
            console.error(`  [tiff-diff] Spawn error: ${error.message}`);
            resolvePromise(null);
        });
    });
}

/**
 * Compare extracted images from reference and sample PDFs.
 *
 * @param {ExtractedImageInfo[]} referenceImages
 * @param {ExtractedImageInfo[]} sampleImages
 * @param {string} comparisonLabel
 * @param {{ topCount: number, verbose: boolean }} options
 * @returns {Promise<{ images: object[], unmatched: { reference: string[], sample: string[] }, summary: object }>}
 */
async function compareExtractedImages(referenceImages, sampleImages, comparisonLabel, options) {
    const imageResults = [];
    const unmatchedReference = [];
    const unmatchedSample = [];

    // Build lookup for sample images by (pageIndex, name)
    const sampleMap = new Map();
    for (const img of sampleImages) {
        sampleMap.set(`${img.pageIndex}:${img.name}`, img);
    }

    // Match and compare
    const matchedSampleKeys = new Set();

    for (const refImg of referenceImages) {
        const key = `${refImg.pageIndex}:${refImg.name}`;
        const sampleImg = sampleMap.get(key);

        if (!sampleImg) {
            unmatchedReference.push(`page-${refImg.pageIndex}-${refImg.name}`);
            continue;
        }

        matchedSampleKeys.add(key);

        if (options.verbose) {
            console.log(`    Comparing ${refImg.name} (page ${refImg.pageIndex})...`);
        }

        // Log file next to the sample TIFF: page-0-Im0-CMYK-16bit.tiff-diff.log
        const logPath = sampleImg.tiffPath.replace(/\.tif$/, '.tiff-diff.log');
        const tiffDiffResult = await runTIFFDiff(refImg.tiffPath, sampleImg.tiffPath, { ...options, logPath });

        imageResults.push({
            name: refImg.name,
            pageIndex: refImg.pageIndex,
            referenceColorSpace: refImg.colorSpace,
            sampleColorSpace: sampleImg.colorSpace,
            width: refImg.width,
            height: refImg.height,
            tiffDiffResult,
            error: tiffDiffResult === null ? 'tiff-diff subprocess failed' : null,
        });

        // Print per-image summary
        if (tiffDiffResult) {
            const stats = tiffDiffResult.deltaE;
            if (stats) {
                const vs = tiffDiffResult.variabilitySummary;
                const covStr = vs ? `, Coverage=${vs.mean.Coverage.toFixed(4)}` : '';
                console.log(`    ${refImg.name} (page ${refImg.pageIndex}): Mean ΔE=${stats.mean?.toFixed(3) ?? 'N/A'}, Max ΔE=${stats.max?.toFixed(3) ?? 'N/A'}${covStr}`);
            }
        }
    }

    // Find unmatched sample images
    for (const sampleImg of sampleImages) {
        const key = `${sampleImg.pageIndex}:${sampleImg.name}`;
        if (!matchedSampleKeys.has(key)) {
            unmatchedSample.push(`page-${sampleImg.pageIndex}-${sampleImg.name}`);
        }
    }

    // Compute aggregate summary
    const comparedResults = imageResults.filter(r => r.tiffDiffResult !== null);
    const deltaEValues = comparedResults
        .map(r => r.tiffDiffResult?.deltaE)
        .filter(Boolean);

    const summary = {
        totalImages: referenceImages.length,
        comparedImages: comparedResults.length,
        errorImages: imageResults.filter(r => r.error).length,
        unmatchedImages: unmatchedReference.length + unmatchedSample.length,
        aggregateDeltaE: deltaEValues.length > 0 ? {
            min: Math.min(...deltaEValues.map(d => d.min)),
            max: Math.max(...deltaEValues.map(d => d.max)),
            mean: deltaEValues.reduce((sum, d) => sum + d.mean, 0) / deltaEValues.length,
        } : null,
    };

    return { images: imageResults, unmatched: { reference: unmatchedReference, sample: unmatchedSample }, summary };
}

// ============================================================================
// Subphase 7: CLI Interface, Report Aggregation, Cleanup
// ============================================================================

/**
 * Remove stale JSON/MD outputs from previous pdf-diff runs.
 *
 * In diff dir: DIFF.json, DIFF.md, *.tif.json files in subdirectories
 * In output dir: pdf-diff-report.json (legacy), *.pdf-diff.json (single-mode)
 * NOT cleaned: pretests.json (reusable), TIFF files, .tiff-diff.log files.
 *
 * @param {string} diffDir - Diff directory (temp dir root)
 * @param {string | null} outputDir - Output directory (batch mode only)
 * @param {boolean} verbose
 */
async function cleanStaleOutputs(diffDir, outputDir, verbose) {
    const filesToClean = [];

    // Diff dir root: DIFF.json, DIFF.md
    for (const name of ['DIFF.json', 'DIFF.md']) {
        const filePath = resolve(diffDir, name);
        if (fs.existsSync(filePath)) filesToClean.push(filePath);
    }

    // Diff dir subdirectories: *.tif.json files (tiff-diff result files)
    if (fs.existsSync(diffDir)) {
        try {
            const entries = fs.readdirSync(diffDir);
            for (const entry of entries) {
                const entryPath = resolve(diffDir, entry);
                try {
                    if (fs.statSync(entryPath).isDirectory()) {
                        const subEntries = fs.readdirSync(entryPath);
                        for (const sub of subEntries) {
                            if (sub.endsWith('.tif.json')) {
                                filesToClean.push(resolve(entryPath, sub));
                            }
                        }
                    }
                } catch { /* skip inaccessible entries */ }
            }
        } catch { /* diff dir not readable */ }
    }

    // Output dir: legacy report and single-mode artifacts
    if (outputDir && fs.existsSync(outputDir)) {
        try {
            const legacyReport = resolve(outputDir, 'pdf-diff-report.json');
            if (fs.existsSync(legacyReport)) filesToClean.push(legacyReport);

            const outputEntries = fs.readdirSync(outputDir);
            for (const entry of outputEntries) {
                if (entry.endsWith('.pdf-diff.json')) {
                    filesToClean.push(resolve(outputDir, entry));
                }
            }
        } catch { /* output dir not readable */ }
    }

    for (const filePath of filesToClean) {
        try {
            fs.unlinkSync(filePath);
            if (verbose) console.log(`  [CLEAN] Removed: ${filePath}`);
        } catch { /* ignore */ }
    }

    if (filesToClean.length > 0) {
        console.log(`Cleaned ${filesToClean.length} stale output file(s)`);
    }
}

// ============================================================================
// DIFF.json and DIFF.md Generation
// ============================================================================

/**
 * Compute aggregate Delta-E and variability statistics across comparison results.
 *
 * @param {object[]} results - Comparison results with images[] containing tiffDiffResult
 * @returns {object | null}
 */
function computeAggregateStatistics(results) {
    const allImages = results.flatMap(r => r.images || [])
        .filter(img => img.tiffDiffResult?.deltaE);

    if (allImages.length === 0) return null;

    const deltaEStats = allImages.map(img => img.tiffDiffResult.deltaE);
    const variabilitySummaries = allImages
        .map(img => img.tiffDiffResult.variabilitySummary)
        .filter(Boolean);

    return {
        deltaE: {
            min: Math.min(...deltaEStats.map(d => d.min)),
            max: Math.max(...deltaEStats.map(d => d.max)),
            mean: deltaEStats.reduce((s, d) => s + d.mean, 0) / deltaEStats.length,
            median: deltaEStats.reduce((s, d) => s + d.median, 0) / deltaEStats.length,
        },
        imagesWithVariability: variabilitySummaries.length,
        variabilitySummary: variabilitySummaries.length > 0 ? {
            totalUniqueReferenceColors: variabilitySummaries.reduce((s, v) => s + v.count, 0),
            averageCoverage: variabilitySummaries.reduce((s, v) => s + v.mean.Coverage, 0) / variabilitySummaries.length,
            averageMeanDeltaE: variabilitySummaries.reduce((s, v) => s + v.mean['Mean ΔE'], 0) / variabilitySummaries.length,
            maxMaxDeltaE: Math.max(...variabilitySummaries.map(v => v.max['Max ΔE'])),
        } : null,
    };
}

/**
 * Format one comparison group for DIFF.json output.
 *
 * @param {{ groupDescription: string, inputName: string, outputName: string, comparisons: object[] }} group
 * @returns {object}
 */
function formatGroupForJSON(group) {
    return {
        groupDescription: group.groupDescription,
        inputName: group.inputName,
        outputName: group.outputName,
        aggregate: computeAggregateStatistics(group.comparisons),
        comparisons: group.comparisons.map(r => ({
            label: r.comparisonLabel,
            comparisonMode: r.comparisonMode,
            referencePDF: basename(r.referencePDF),
            samplePDF: basename(r.samplePDF),
            summary: r.summary,
            images: (r.images || []).map(img => ({
                name: img.name,
                pageIndex: img.pageIndex,
                width: img.width,
                height: img.height,
                referenceColorSpace: img.referenceColorSpace,
                sampleColorSpace: img.sampleColorSpace,
                deltaE: img.tiffDiffResult?.deltaE ?? null,
                variabilitySummary: img.tiffDiffResult?.variabilitySummary ?? null,
                referenceUniqueColorCount: img.tiffDiffResult?.reference?.uniqueColorCount ?? null,
                sampleUniqueColorCount: img.tiffDiffResult?.sample?.uniqueColorCount ?? null,
                error: img.error,
            })),
        })),
    };
}

/**
 * Generate DIFF.json report from all comparison results.
 *
 * @param {object[]} allResults - Array of comparison results with pair metadata
 * @param {object} options - CLI options
 * @param {object[]} pretests - Pretest results
 * @returns {object}
 */
function generateDiffJSON(allResults, options, pretests) {
    // Group results by comparisonMode, then by groupDescription + outputName
    const pairsGroups = new Map();
    const referenceGroups = new Map();

    for (const result of allResults) {
        const target = result.comparisonMode === 'reference'
            ? referenceGroups
            : pairsGroups;
        const groupKey = `${result.groupDescription}|||${result.outputName}`;
        if (!target.has(groupKey)) {
            target.set(groupKey, {
                groupDescription: result.groupDescription,
                inputName: result.inputName,
                outputName: result.outputName,
                comparisons: [],
            });
        }
        target.get(groupKey).comparisons.push(result);
    }

    return {
        version: 1,
        timestamp: new Date().toISOString(),
        engineVersion: options.engineVersion,
        configuration: options.batchConfig ? basename(options.batchConfig) : null,
        overview: {
            totalComparisons: allResults.length,
            totalImagesCompared: allResults.reduce((sum, r) => sum + (r.summary?.comparedImages || 0), 0),
            totalErrors: allResults.reduce((sum, r) => sum + (r.summary?.errorImages || 0), 0),
            aggregateDeltaE: computeAggregateStatistics(allResults),
        },
        pairsComparisons: [...pairsGroups.values()].map(group => formatGroupForJSON(group)),
        referenceComparisons: [...referenceGroups.values()].map(group => formatGroupForJSON(group)),
        pretests: pretests.map(p => ({
            permutation: p.permutation,
            passed: p.passed,
            maxDeltaE: p.maxDeltaE,
            tiffRoundtripExact: p.tiffRoundtripExact,
        })),
    };
}

// ============================================================================
// DIFF.md Generation
// ============================================================================

/**
 * Format a number with locale-aware thousands separators.
 * @param {number | null | undefined} value
 * @returns {string}
 */
function formatNumber(value) {
    if (value == null) return 'N/A';
    return value.toLocaleString();
}

/**
 * Append markdown for one comparison group.
 *
 * @param {string[]} lines
 * @param {object} group - Formatted group from formatGroupForJSON
 */
function appendGroupMarkdown(lines, group) {
    lines.push(`### ${group.groupDescription}: ${group.outputName}`);
    lines.push('');
    lines.push(`**Input**: ${group.inputName}`);
    lines.push('');

    // Per-comparison summary table
    lines.push('| Comparison | Images | Mean ΔE | Max ΔE | Avg Coverage |');
    lines.push('| --- | --- | --- | --- | --- |');

    for (const comp of group.comparisons) {
        const aggDE = comp.summary?.aggregateDeltaE;
        const images = comp.images.filter(img => img.deltaE);
        const imagesWithVar = images.filter(img => img.variabilitySummary);
        const avgCoverage = imagesWithVar.length > 0
            ? imagesWithVar.reduce((s, img) => s + img.variabilitySummary.mean.Coverage, 0) / imagesWithVar.length
            : null;

        const meanStr = aggDE?.mean != null ? aggDE.mean.toFixed(3) : 'N/A';
        const maxStr = aggDE?.max != null ? aggDE.max.toFixed(3) : 'N/A';
        const covStr = avgCoverage != null ? avgCoverage.toFixed(4) : 'N/A';

        lines.push(`| ${comp.label} | ${comp.summary?.comparedImages ?? 0} | ${meanStr} | ${maxStr} | ${covStr} |`);
    }
    lines.push('');

    // Per-image detail for each comparison
    for (const comp of group.comparisons) {
        lines.push(`#### ${comp.label}`);
        lines.push('');
        lines.push('| Page | Image | Size | ΔE (Mean / Max) | Unique (Ref / Sample) | Coverage | Variants (Mean) |');
        lines.push('| --- | --- | --- | --- | --- | --- | --- |');

        for (const img of comp.images) {
            const de = img.deltaE;
            const vs = img.variabilitySummary;
            const deStr = de ? `${de.mean.toFixed(3)} / ${de.max.toFixed(3)}` : 'N/A';
            const uniqueStr = `${formatNumber(img.referenceUniqueColorCount)} / ${formatNumber(img.sampleUniqueColorCount)}`;
            const covStr = vs ? vs.mean.Coverage.toFixed(4) : 'N/A';
            const varStr = vs ? vs.mean.Variants.toFixed(1) : 'N/A';
            lines.push(`| ${img.pageIndex} | ${img.name} | ${img.width}x${img.height} | ${deStr} | ${uniqueStr} | ${covStr} | ${varStr} |`);
        }
        lines.push('');
    }
}

/**
 * Generate automated insights from diff data.
 *
 * @param {string[]} lines
 * @param {object} diffJSON - Output from generateDiffJSON()
 */
function appendInsights(lines, diffJSON) {
    const allComparisons = [
        ...diffJSON.pairsComparisons.flatMap(g => g.comparisons),
        ...diffJSON.referenceComparisons.flatMap(g => g.comparisons),
    ];
    const allImages = allComparisons.flatMap(c => c.images).filter(i => i.deltaE);

    if (allImages.length === 0) {
        lines.push('- No images were compared.');
        lines.push('');
        return;
    }

    // Binary-identical images (Max Delta-E = 0)
    const zeroDE = allImages.filter(i => i.deltaE.max === 0);
    if (zeroDE.length > 0) {
        lines.push(`- **${zeroDE.length} image(s)** are binary-identical (Max ΔE = 0)`);
    }

    // High Delta-E images
    const highDeltaE = allImages.filter(i => i.deltaE.max > 5.0);
    if (highDeltaE.length > 0) {
        lines.push(`- **${highDeltaE.length} image(s)** have Max ΔE > 5.0 (investigate potential conversion issues)`);
    } else {
        lines.push('- All images have Max ΔE <= 5.0');
    }

    // Coverage analysis
    const imagesWithVar = allImages.filter(i => i.variabilitySummary);
    const lowCoverage = imagesWithVar.filter(i => i.variabilitySummary.mean.Coverage < 0.9);
    if (lowCoverage.length > 0) {
        lines.push(`- **${lowCoverage.length} image(s)** have average Coverage < 0.9 (high color variability)`);
    } else if (imagesWithVar.length > 0) {
        lines.push('- All images have average Coverage >= 0.9 (good color consistency)');
    }

    // Errors
    const errors = allComparisons.flatMap(c => c.images).filter(i => i.error);
    if (errors.length > 0) {
        lines.push(`- **${errors.length} image(s)** failed comparison (check tiff-diff logs)`);
    }

    lines.push('');
}

/**
 * Generate DIFF.md markdown report from DIFF.json data.
 *
 * @param {object} diffJSON - Output from generateDiffJSON()
 * @returns {string}
 */
function generateDiffMarkdown(diffJSON) {
    const lines = [];

    // Header
    lines.push('# PDF Diff Report');
    lines.push('');
    lines.push(`**Generated**: ${diffJSON.timestamp}`);
    lines.push(`**Color Engine**: ${diffJSON.engineVersion}`);
    if (diffJSON.configuration) {
        lines.push(`**Configuration**: \`${diffJSON.configuration}\``);
    }
    lines.push('');

    // Overview table
    lines.push('## Overview');
    lines.push('');
    const ov = diffJSON.overview;
    lines.push('| Metric | Value |');
    lines.push('| --- | --- |');
    lines.push(`| Total Comparisons | ${ov.totalComparisons} |`);
    lines.push(`| Total Images Compared | ${ov.totalImagesCompared} |`);
    lines.push(`| Total Errors | ${ov.totalErrors} |`);
    if (ov.aggregateDeltaE?.deltaE) {
        const d = ov.aggregateDeltaE.deltaE;
        lines.push(`| Aggregate Mean ΔE | ${d.mean.toFixed(3)} |`);
        lines.push(`| Aggregate Max ΔE | ${d.max.toFixed(3)} |`);
    }
    if (ov.aggregateDeltaE?.variabilitySummary) {
        const v = ov.aggregateDeltaE.variabilitySummary;
        lines.push(`| Average Coverage | ${v.averageCoverage.toFixed(4)} |`);
        lines.push(`| Total Unique Reference Colors | ${formatNumber(v.totalUniqueReferenceColors)} |`);
    }
    lines.push('');

    // Pairs comparisons section
    if (diffJSON.pairsComparisons.length > 0) {
        lines.push('## Pairs Comparisons');
        lines.push('');
        for (const group of diffJSON.pairsComparisons) {
            appendGroupMarkdown(lines, group);
        }
    }

    // Reference comparisons section
    if (diffJSON.referenceComparisons.length > 0) {
        lines.push('## Reference Comparisons');
        lines.push('');
        for (const group of diffJSON.referenceComparisons) {
            appendGroupMarkdown(lines, group);
        }
    }

    // Pretests section
    if (diffJSON.pretests.length > 0) {
        lines.push('## Pretests');
        lines.push('');
        lines.push('| Permutation | Passed | Max ΔE | TIFF Roundtrip Exact |');
        lines.push('| --- | --- | --- | --- |');
        for (const p of diffJSON.pretests) {
            lines.push(`| ${p.permutation} | ${p.passed ? 'Yes' : 'No'} | ${p.maxDeltaE.toFixed(6)} | ${p.tiffRoundtripExact ? 'Yes' : 'No'} |`);
        }
        lines.push('');
    }

    // Automated insights
    lines.push('## Insights');
    lines.push('');
    appendInsights(lines, diffJSON);

    return lines.join('\n');
}

function printUsage() {
    console.log(`PDF Diff CLI Tool

Extracts images from PDFs, converts to Lab Float32 TIFFs,
and delegates pixel-level comparison to tiff-diff.js.

Usage:
  node pdf-diff.js <reference.pdf> <sample.pdf> [options]
  node pdf-diff.js --batch=<config.json> --output-dir=<dir> [options]

Arguments:
  <reference.pdf>   The reference PDF file
  <sample.pdf>      The sample PDF to compare

Options:
  --batch=<path>                 Batch config JSON (same schema as generate-verification-matrix.mjs)
  --output-dir=<dir>             Output directory containing converted PDFs (for batch mode)
  --engine=<version>             Color engine version (default: 2026-01-30)
  --temp-dir=<dir>               Temp/diff directory (batch default: <output-dir> Diff)
  --top=<N>                      Top colors for cross-matching (default: 10)
  --clean-json-outputs           Remove stale JSON/MD outputs before running (default in batch mode)
  --no-clean-json-outputs        Skip stale output cleanup
  --verbose, -v                  Verbose output
  --keep-temp                    Don't delete temp TIFF files
  --skip-pretests                Skip pipeline pretesting (not recommended)
  --help, -h                     Show this help message
`);
}

/**
 * Parse CLI arguments.
 * @param {string[]} args
 */
function parseArgs(args) {
    const options = {
        referencePdf: null,
        samplePdf: null,
        batchConfig: null,
        outputDir: null,
        engineVersion: '2026-01-30',
        tempDir: resolve(cwd(), '.temp/pdf-diff'),
        tempDirExplicit: false,
        topCount: 10,
        cleanJsonOutputs: null,  // null = auto (on in batch, off in single)
        verbose: false,
        keepTemp: false,
        skipPretests: false,
        quick: false,
        help: false,
    };

    const positional = [];

    for (const arg of args) {
        if (arg === '') continue; // Skip empty args from shell line continuations
        if (arg === '--help' || arg === '-h') {
            options.help = true;
        } else if (arg === '--verbose' || arg === '-v') {
            options.verbose = true;
        } else if (arg === '--clean-json-outputs') {
            options.cleanJsonOutputs = true;
        } else if (arg === '--no-clean-json-outputs') {
            options.cleanJsonOutputs = false;
        } else if (arg === '--keep-temp') {
            options.keepTemp = true;
        } else if (arg === '--skip-pretests') {
            options.skipPretests = true;
        } else if (arg === '--quick') {
            options.quick = true;
        } else if (arg.startsWith('--batch=')) {
            options.batchConfig = arg.substring('--batch='.length);
        } else if (arg.startsWith('--output-dir=')) {
            options.outputDir = arg.substring('--output-dir='.length);
        } else if (arg.startsWith('--engine=')) {
            options.engineVersion = arg.substring('--engine='.length);
        } else if (arg.startsWith('--temp-dir=')) {
            options.tempDir = arg.substring('--temp-dir='.length);
            options.tempDirExplicit = true;
        } else if (arg.startsWith('--top=')) {
            options.topCount = parseInt(arg.substring('--top='.length), 10);
        } else if (!arg.startsWith('-')) {
            positional.push(arg);
        }
    }

    if (positional.length >= 2) {
        options.referencePdf = positional[0];
        options.samplePdf = positional[1];
    }

    return options;
}

/**
 * Main entry point.
 */
async function main() {
    const options = parseArgs(argv.slice(2));

    if (options.help) {
        printUsage();
        exit(0);
    }

    if (options.quick) {
        console.error('Error: --quick mode (lightweight pixel diff without Lab conversion) is not yet implemented.');
        console.error('       Use the full pipeline for now, or see internal/compare-color-values.js for direct value comparison.');
        exit(1);
    }

    const isBatchMode = !!options.batchConfig;
    const isSingleMode = !!options.referencePdf && !!options.samplePdf;

    if (!isBatchMode && !isSingleMode) {
        console.error('Error: Provide either <reference.pdf> <sample.pdf> or --batch=<config.json> --output-dir=<dir>');
        printUsage();
        exit(1);
    }

    // Resolve output dir for batch mode
    let resolvedOutputDir = null;
    if (isBatchMode) {
        if (!options.outputDir) {
            console.error('Error: --output-dir is required in batch mode');
            exit(1);
        }
        resolvedOutputDir = isAbsolute(options.outputDir) ? options.outputDir : resolve(cwd(), options.outputDir);

        // Derive default diff dir: <output-dir> Diff
        if (!options.tempDirExplicit) {
            options.tempDir = `${resolvedOutputDir} Diff`;
        }
    }

    console.log(`PDF Diff — Color Engine ${options.engineVersion}`);
    console.log(`Diff directory: ${options.tempDir}`);
    console.log('');

    // Clean stale outputs before running
    const shouldClean = options.cleanJsonOutputs ?? isBatchMode;
    if (shouldClean) {
        await cleanStaleOutputs(options.tempDir, resolvedOutputDir, options.verbose);
        console.log('');
    }

    // Initialize color engine
    console.log('Initializing color engine...');
    const { engine, module } = await initializeColorEngine(options.engineVersion);
    console.log('Color engine ready.');
    console.log('');

    // Build comparison plan
    let plan;
    if (isSingleMode) {
        const refPath = isAbsolute(options.referencePdf) ? options.referencePdf : resolve(cwd(), options.referencePdf);
        const samplePath = isAbsolute(options.samplePdf) ? options.samplePdf : resolve(cwd(), options.samplePdf);
        plan = buildSingleComparisonPlan(refPath, samplePath);
    } else {
        const { config, configURL } = await loadConfiguration(options.batchConfig);
        plan = buildBatchComparisonPlan(config, configURL, resolvedOutputDir);
    }

    console.log(`Comparison plan: ${plan.pairs.length} pairs, ${plan.uniquePdfs.size} unique PDFs`);
    console.log('');

    // Pretest cache
    const pretestCache = new Map();

    // Load pretests from file if it exists
    const pretestsJsonPath = resolve(options.tempDir, 'pretests.json');
    try {
        if (fs.existsSync(pretestsJsonPath)) {
            const cached = JSON.parse(fs.readFileSync(pretestsJsonPath, 'utf-8'));
            for (const [key, value] of Object.entries(cached)) {
                if (value.engineVersion === options.engineVersion) {
                    pretestCache.set(key, value);
                }
            }
            if (pretestCache.size > 0) {
                console.log(`Loaded ${pretestCache.size} cached pretests for engine ${options.engineVersion}`);
            }
        }
    } catch { /* ignore */ }

    // Extraction cache: pdfPath → ExtractedImageInfo[]
    const extractionCache = new Map();

    // Execute comparisons with reference counting
    const allResults = [];

    for (let i = 0; i < plan.pairs.length; i++) {
        const pair = plan.pairs[i];
        console.log(`[${i + 1}/${plan.pairs.length}] ${pair.label}`);

        // Extract reference PDF if not already cached
        if (!extractionCache.has(pair.referencePdfPath)) {
            console.log(`  Extracting reference: ${basename(pair.referencePdfPath)}`);
            const refImages = await extractPDFImagesToLabTIFF(
                pair.referencePdfPath, options.tempDir, pair.referencePdfLabel,
                engine, module, pretestCache, options.engineVersion,
                { verbose: options.verbose, skipPretests: options.skipPretests }
            );
            extractionCache.set(pair.referencePdfPath, refImages);
            console.log(`  Extracted ${refImages.length} images from reference`);
        }

        // Extract sample PDF if not already cached
        if (!extractionCache.has(pair.samplePdfPath)) {
            console.log(`  Extracting sample: ${basename(pair.samplePdfPath)}`);
            const sampleImages = await extractPDFImagesToLabTIFF(
                pair.samplePdfPath, options.tempDir, pair.samplePdfLabel,
                engine, module, pretestCache, options.engineVersion,
                { verbose: options.verbose, skipPretests: options.skipPretests }
            );
            extractionCache.set(pair.samplePdfPath, sampleImages);
            console.log(`  Extracted ${sampleImages.length} images from sample`);
        }

        // Compare
        console.log('  Comparing images...');
        const result = await compareExtractedImages(
            extractionCache.get(pair.referencePdfPath),
            extractionCache.get(pair.samplePdfPath),
            pair.label,
            { topCount: options.topCount, verbose: options.verbose }
        );

        allResults.push({
            comparisonLabel: pair.label,
            groupDescription: pair.groupDescription,
            inputName: pair.inputName,
            outputName: pair.outputName,
            comparisonMode: pair.comparisonMode,
            referencePDF: pair.referencePdfPath,
            samplePDF: pair.samplePdfPath,
            ...result,
        });

        // Decrement reference counts and clean up if possible
        for (const pdfPath of [pair.referencePdfPath, pair.samplePdfPath]) {
            const pdfInfo = plan.uniquePdfs.get(pdfPath);
            if (pdfInfo) {
                pdfInfo.referenceCount--;
                if (pdfInfo.referenceCount <= 0 && !options.keepTemp) {
                    // Clean up temp TIFFs for this PDF
                    const pdfTempDir = resolve(options.tempDir, pdfInfo.label);
                    try {
                        await rm(pdfTempDir, { recursive: true, force: true });
                        extractionCache.delete(pdfPath);
                        if (options.verbose) {
                            console.log(`  Cleaned up temp TIFFs: ${pdfInfo.label}`);
                        }
                    } catch { /* ignore */ }
                }
            }
        }

        console.log(`  Summary: ${result.summary.comparedImages} images compared, ` +
            `${result.summary.errorImages} errors, ` +
            `${result.summary.unmatchedImages} unmatched`);
        if (result.summary.aggregateDeltaE) {
            const agg = result.summary.aggregateDeltaE;
            console.log(`  Aggregate ΔE: min=${agg.min.toFixed(3)}, max=${agg.max.toFixed(3)}, mean=${agg.mean.toFixed(3)}`);
        }
        console.log('');
    }

    // Save pretests to cache file
    try {
        await mkdir(options.tempDir, { recursive: true });
        const pretestsObj = Object.fromEntries(pretestCache);
        await writeFile(pretestsJsonPath, JSON.stringify(pretestsObj, null, 2));
    } catch { /* ignore */ }

    // Write reports
    if (isBatchMode) {
        // Generate DIFF.json and DIFF.md in the diff directory
        const diffJSON = generateDiffJSON(allResults, options, [...pretestCache.values()]);

        await mkdir(options.tempDir, { recursive: true });

        const diffJsonPath = resolve(options.tempDir, 'DIFF.json');
        await writeFile(diffJsonPath, JSON.stringify(diffJSON, null, 2));
        console.log(`DIFF.json written to: ${diffJsonPath}`);

        const diffMd = generateDiffMarkdown(diffJSON);
        const diffMdPath = resolve(options.tempDir, 'DIFF.md');
        await writeFile(diffMdPath, diffMd);
        console.log(`DIFF.md written to: ${diffMdPath}`);
    } else {
        // Single mode: write report next to sample PDF
        const report = {
            timestamp: new Date().toISOString(),
            engineVersion: options.engineVersion,
            pretests: [...pretestCache.values()],
            comparisons: allResults,
        };
        const reportPath = `${options.samplePdf}.pdf-diff.json`;
        await writeFile(reportPath, JSON.stringify(report, null, 2));
        console.log(`Report written to: ${reportPath}`);
    }

    // Cleanup temp directory (preserve pretests.json, DIFF.json, DIFF.md)
    if (!options.keepTemp) {
        // Only remove image subdirectories, keep files at root
        try {
            const entries = fs.readdirSync(options.tempDir);
            for (const entry of entries) {
                const entryPath = resolve(options.tempDir, entry);
                try {
                    if (fs.statSync(entryPath).isDirectory()) {
                        await rm(entryPath, { recursive: true, force: true });
                    }
                } catch { /* skip inaccessible entries */ }
            }
        } catch { /* ignore */ }
    }

    // Print final summary
    console.log('\n=== Final Summary ===');
    console.log(`Comparisons: ${allResults.length}`);
    let totalCompared = 0;
    let totalErrors = 0;
    for (const r of allResults) {
        totalCompared += r.summary.comparedImages;
        totalErrors += r.summary.errorImages;
    }
    console.log(`Images compared: ${totalCompared}`);
    console.log(`Errors: ${totalErrors}`);
    console.log(`Pretests: ${pretestCache.size} (${[...pretestCache.values()].filter(p => p.passed).length} passed)`);
}

// Entry point guard — only execute CLI when run directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    main().catch(error => {
        console.error(`Fatal error: ${error.message}`);
        if (error.stack) console.error(error.stack);
        exit(1);
    });
}

export { writeLabTIFF, convertPixelsToLabFloat32, mapColorSpace, getPixelFormatInfo };
