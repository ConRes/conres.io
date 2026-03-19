// @ts-check
/**
 * PDF Image Color Converter
 *
 * Extends ImageColorConverter to handle PDF image XObjects.
 * Manages stream compression/decompression, BitsPerComponent normalization,
 * and worker mode for parallel processing.
 *
 * @module PDFImageColorConverter
 */

import { ImageColorConverter, PIXEL_FORMATS, RENDERING_INTENTS, INTENT_MAP } from './image-color-converter.js';
import { CONTEXT_PREFIX } from '../../services/helpers/runtime.js';

// Coerce Lab absolute-zero pixels (L=0, a=-128, b=-128) to Lab 0/0/0 before transform.
// Photoshop uses 0/-128/-128 in mask images to represent black. Since a=-128, b=-128 are
// at the extreme out-of-gamut boundary, color engines push them into gamut during transforms,
// producing non-black output. This flag enables a temporary workaround: replace with Lab 0/0/0
// (proper black, neutral a/b) before the transform, and restore the original value afterward
// if the output color space is also Lab (to preserve round-trip fidelity for mask images).
const COERCE_LAB_ABSOLUTE_ZERO_PIXELS = true;

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Configuration for PDFImageColorConverter.
 *
 * @typedef {import('./image-color-converter.js').ImageColorConverterConfiguration & {
 *   compressOutput: boolean,
 *   pakoPackageEntrypoint?: string,
 * }} PDFImageColorConverterConfiguration
 */

/**
 * Input data for PDF image conversion.
 *
 * Bit depth parameters:
 * - `bitsPerComponent`: Fallback for both input and output (also accepts 1, 2, 4 for PDF normalization)
 * - `inputBitsPerComponent`: Explicit bit depth for input (overrides bitsPerComponent)
 * - `outputBitsPerComponent`: Explicit bit depth for output (overrides bitsPerComponent)
 *
 * Endianness parameters (conditional on bit depth):
 * - `endianness`: Fallback for both input and output (default: 'big' for >8-bit PDF data)
 * - `inputEndianness`: Explicit endianness for input (overrides endianness)
 * - `outputEndianness`: Explicit endianness for output (overrides endianness)
 *
 * @typedef {{
 *   streamRef: any,
 *   streamData: Uint8Array,
 *   isCompressed: boolean,
 *   width: number,
 *   height: number,
 *   colorSpace: import('./color-converter.js').ColorType,
 *   bitsPerComponent: import('./color-conversion-policy.js').BitDepth | 1 | 2 | 4,
 *   inputBitsPerComponent?: import('./color-conversion-policy.js').BitDepth,
 *   outputBitsPerComponent?: import('./color-conversion-policy.js').BitDepth,
 *   endianness?: import('./color-conversion-policy.js').Endianness,
 *   inputEndianness?: import('./color-conversion-policy.js').Endianness,
 *   outputEndianness?: import('./color-conversion-policy.js').Endianness,
 *   sourceProfile?: ArrayBuffer | 'Lab',
 *   imageDict?: any,
 * }} PDFImageColorConverterInput
 */

/**
 * Result of PDF image conversion.
 *
 * @typedef {{
 *   streamRef: any,
 *   streamData: Uint8Array,
 *   isCompressed: boolean,
 *   width: number,
 *   height: number,
 *   colorSpace: import('./color-converter.js').ColorType,
 *   bitsPerComponent: number,
 *   pixelCount: number,
 * }} PDFImageColorConverterResult
 */

// ============================================================================
// PDFImageColorConverter Class
// ============================================================================

/**
 * Converts PDF image XObjects to destination color space.
 *
 * Extends ImageColorConverter with PDF-specific handling:
 * - FlateDecode compression/decompression
 * - BitsPerComponent normalization (ensures 8-bit output for CMYK)
 * - Lab image handling (automatic intent fallback)
 * - Worker mode support for parallel processing
 *
 * @extends ImageColorConverter
 * @example
 * ```javascript
 * const converter = new PDFImageColorConverter({
 *     renderingIntent: 'preserve-k-only-relative-colorimetric-gcr',
 *     blackPointCompensation: true,
 *     useAdaptiveBPCClamping: true,
 *     destinationProfile: cmykProfileBuffer,
 *     destinationColorSpace: 'CMYK',
 *     inputType: 'RGB',
 *     compressOutput: true,
 *     verbose: false,
 * });
 *
 * const result = await converter.convertColor({
 *     streamRef: imageRef,
 *     streamData: compressedBytes,
 *     isCompressed: true,
 *     width: 800,
 *     height: 600,
 *     colorSpace: 'RGB',
 *     bitsPerComponent: 8,
 * });
 * ```
 */
export class PDFImageColorConverter extends ImageColorConverter {
    // ========================================
    // Private Fields
    // ========================================

    /** @type {typeof import('pako') | null} */
    #pako = null;

    /** @type {Promise<void>} */
    #pakoReady;

    // ========================================
    // Constructor
    // ========================================

    /**
     * Creates a new PDFImageColorConverter instance.
     *
     * @param {PDFImageColorConverterConfiguration} configuration - Immutable configuration
     * @param {object} [options={}] - Additional options
     * @param {import('./color-engine-provider.js').ColorEngineProvider} [options.colorEngineProvider] - Shared provider
     * @param {import('./color-conversion-policy.js').ColorConversionPolicy} [options.policy] - Custom policy
     * @param {string} [options.engineVersion] - Color engine version for policy rules
     * @param {string} [options.domain='PDF'] - Domain context for policy severity
     * @param {import('../../services/ColorEngineService.js').ColorEngineService} [options.colorEngineService] - Backward compat
     */
    constructor(configuration, options = {}) {
        // PDF domain - affects policy severity
        super(configuration, { ...options, domain: options.domain ?? 'PDF' });
        this.#pakoReady = this.#loadPako();
    }

    // ========================================
    // Initialization
    // ========================================

    /**
     * Loads pako library for compression.
     *
     * Uses the resolved entrypoint from configuration (propagated from
     * PDFDocumentColorConverter, which resolves via import.meta.resolve).
     * Falls back to bare 'pako' specifier if no entrypoint is configured.
     *
     * @returns {Promise<void>}
     */
    async #loadPako() {
        const entrypoint = this.configuration.pakoPackageEntrypoint;
        this.#pako = await import(entrypoint ?? new URL('../../packages/pako/dist/pako.mjs', import.meta.url).href);
    }

    // ========================================
    // Configuration Access
    // ========================================

    /**
     * Gets the configuration as PDFImageColorConverterConfiguration.
     * @returns {Readonly<PDFImageColorConverterConfiguration>}
     */
    get configuration() {
        return /** @type {Readonly<PDFImageColorConverterConfiguration>} */ (super.configuration);
    }

    /**
     * Whether to compress output streams.
     * @returns {boolean}
     */
    get compressOutput() {
        return this.configuration.compressOutput;
    }

    // ========================================
    // Main Conversion Method
    // ========================================

    /**
     * Converts a PDF image XObject to destination color space.
     *
     * @param {PDFImageColorConverterInput} input - PDF image data
     * @param {import('./color-converter.js').ColorConverterContext} [context={}] - Conversion context
     * @returns {Promise<PDFImageColorConverterResult>}
     */
    async convertColor(input, context = {}) {
        return this.convertPDFImageColor(input, context);
    }

    /**
     * Converts a PDF image XObject to destination color space.
     *
     * Supports standard bit depths (8, 16) natively via the color engine.
     * Non-standard PDF bit depths (1, 2, 4) are normalized to 8-bit first.
     *
     * @param {PDFImageColorConverterInput} input - PDF image data
     * @param {import('./color-converter.js').ColorConverterContext} context - Conversion context
     * @returns {Promise<PDFImageColorConverterResult>} Converted image data
     */
    async convertPDFImageColor(input, context) {
        await this.#pakoReady;
        await this.ensureReady();

        const config = this.configuration;
        const { streamRef, streamData, isCompressed, width, height, colorSpace, bitsPerComponent } = input;
        const pixelCount = width * height;

        // Log if verbose
        if (config.verbose) {
            console.log(`${CONTEXT_PREFIX} [PDFImageColorConverter] Converting image ${streamRef}`);
            console.log(`${CONTEXT_PREFIX}   Size: ${width}×${height}, ColorSpace: ${colorSpace}, BPC: ${bitsPerComponent}`);
            console.log(`${CONTEXT_PREFIX}   Compressed: ${isCompressed}, Output compression: ${config.compressOutput}`);
        }

        // Parent span for nested diagnostics (passed from concurrent image processing)
        const parentSpan = context?.parentSpan;

        // Decompress if needed
        let pixelData = streamData;
        if (isCompressed) {
            const decodeSpan = this.diagnostics.startNestedSpan(parentSpan, 'decode', {
                ref: String(streamRef),
                compressedSize: streamData.length,
            });
            try {
                pixelData = this.#decompress(streamData);
                this.diagnostics.updateSpan(decodeSpan, {
                    decompressedSize: pixelData.length,
                });
            } finally {
                this.diagnostics.endSpan(decodeSpan);
            }
        }

        // Coerce Lab absolute-zero pixels (0/-128/-128) before transform
        // These encode as all-zero bytes in both 8-bit and 16-bit big-endian Lab
        /** @type {number[] | null} */
        let labAbsoluteZeroPositions = null;
        /** @type {Uint8Array | null} Precomputed replacement pixel for CMYK K-Only GCR (8-bit) */
        let labAbsoluteZeroReplacementPixel = null;
        if (COERCE_LAB_ABSOLUTE_ZERO_PIXELS && colorSpace === 'Lab') {
            const bytesPerPixel = bitsPerComponent === 16 ? 6 : 3;
            const isLabOutput = config.destinationColorSpace === 'Lab';
            const isCMYKKOnlyGCR = config.destinationColorSpace === 'CMYK'
                && config.renderingIntent === 'preserve-k-only-relative-colorimetric-gcr';
            const needsWriteBack = isLabOutput || isCMYKKOnlyGCR;

            // Lab 0/0/0 (proper black with neutral a/b) encoded as raw bytes:
            // 8-bit:  L=0→0x00, a=0→0x80 (128), b=0→0x80 (128)
            // 16-bit big-endian: L=0→[0x00,0x00], a=0→[0x80,0x00], b=0→[0x80,0x00]
            const replacementBytes = bitsPerComponent === 16
                ? [0x00, 0x00, 0x80, 0x00, 0x80, 0x00]
                : [0x00, 0x80, 0x80];

            let coercedCount = 0;
            for (let offset = 0; offset + bytesPerPixel <= pixelData.length; offset += bytesPerPixel) {
                // Check if all bytes in this pixel are zero (Lab 0/-128/-128)
                let isAbsoluteZero = true;
                for (let j = 0; j < bytesPerPixel; j++) {
                    if (pixelData[offset + j] !== 0) {
                        isAbsoluteZero = false;
                        break;
                    }
                }

                if (isAbsoluteZero) {
                    if (needsWriteBack) {
                        // Track pixel index for write-back after transform
                        if (!labAbsoluteZeroPositions) labAbsoluteZeroPositions = [];
                        labAbsoluteZeroPositions.push(offset / bytesPerPixel);
                    }
                    // Replace with Lab 0/0/0
                    for (let j = 0; j < bytesPerPixel; j++) {
                        pixelData[offset + j] = replacementBytes[j];
                    }
                    coercedCount++;
                }
            }

            if (coercedCount > 0) {
                if (config.verbose) {
                    console.log(`${CONTEXT_PREFIX}   [COERCE] Replaced ${coercedCount} Lab absolute-zero pixels (0/-128/-128 → 0/0/0)`);
                }

                // For CMYK K-Only GCR: compute the profile's Relative Colorimetric black
                // This is the correct black value for the destination profile, determined by
                // an explicit extra transform rather than relying on the main transform's
                // intent fallback logic.
                if (isCMYKKOnlyGCR && labAbsoluteZeroPositions) {
                    const labBlackPixel = new Uint8Array([0, 128, 128]); // Lab 0/0/0 at 8-bit
                    const blackResult = await this.convertColorsBuffer(labBlackPixel, {
                        inputColorSpace: 'Lab',
                        outputColorSpace: 'CMYK',
                        sourceProfile: 'Lab',
                        destinationProfile: config.destinationProfile,
                        renderingIntent: 'relative-colorimetric',
                        blackPointCompensation: config.blackPointCompensation,
                        bitsPerComponent: /** @type {import('./color-conversion-policy.js').BitDepth} */ (8),
                    });
                    labAbsoluteZeroReplacementPixel = blackResult.outputPixels instanceof Uint8Array
                        ? blackResult.outputPixels
                        : new Uint8Array(blackResult.outputPixels.buffer, blackResult.outputPixels.byteOffset, blackResult.outputPixels.byteLength);

                    if (config.verbose) {
                        const [c, m, y, k] = labAbsoluteZeroReplacementPixel;
                        console.log(`${CONTEXT_PREFIX}   [COERCE] Relative Colorimetric black: CMYK(${c}, ${m}, ${y}, ${k}) [8-bit]`);
                    }
                }
            }
        }

        // Determine effective bit depth for color conversion
        // Standard bit depths (8, 16) are passed through to the color engine
        // Non-standard PDF bit depths (1, 2, 4) are normalized to 8-bit first
        let effectiveBitsPerComponent = bitsPerComponent;

        // Extract bit depth and endianness parameters for pass-through
        // PDF stores multi-byte integer values in big-endian format (ISO 32000).
        // Default inputEndianness is 'big' for >8-bit, but allow explicit override.
        // Fall back to configuration values for output format if not specified in input.
        const {
            inputBitsPerComponent,
            outputBitsPerComponent: inputOutputBits,
            endianness,
            inputEndianness = endianness ?? (bitsPerComponent > 8 ? 'big' : 'native'),
            outputEndianness: inputOutputEndianness,
        } = input;
        const outputBitsPerComponent = inputOutputBits ?? this.configuration.outputBitsPerComponent;
        const outputEndianness = inputOutputEndianness ?? this.configuration.outputEndianness;

        const effectiveOutputBits = outputBitsPerComponent ?? bitsPerComponent;

        // Warn if contradictory endianness is specified for multi-byte PDF data
        // PDF standard (ISO 32000) specifies big-endian for all multi-byte integer data
        if (bitsPerComponent > 8) {
            // Check input endianness conflicts
            if (input.inputEndianness !== undefined && input.inputEndianness !== 'big') {
                console.warn(
                    `${CONTEXT_PREFIX} [PDFImageColorConverter] inputEndianness='${input.inputEndianness}' contradicts ` +
                    `PDF standard (ISO 32000) which specifies big-endian for ${bitsPerComponent}-bit data. ` +
                    `Using specified value, but this may produce incorrect results.`
                );
            }
            if (input.endianness !== undefined && input.inputEndianness === undefined && input.endianness !== 'big') {
                console.warn(
                    `${CONTEXT_PREFIX} [PDFImageColorConverter] endianness='${input.endianness}' (used as inputEndianness) contradicts ` +
                    `PDF standard (ISO 32000) which specifies big-endian for ${bitsPerComponent}-bit data. ` +
                    `Using specified value, but this may produce incorrect results.`
                );
            }
        }

        if (bitsPerComponent !== 8 && bitsPerComponent !== 16) {
            // Normalize non-standard bit depths (1, 2, 4) to 8-bit
            /// DEBUGGING ///
            throw new Error('Only 8 and 16 bits per component are supported in this version.');
            const normalizeSpan = this.diagnostics.startNestedSpan(parentSpan, 'normalize-bpc', {
                ref: String(streamRef),
                sourceBPC: bitsPerComponent,
                targetBPC: 8,
            });
            try {
                pixelData = this.#normalizeBitsPerComponent(pixelData, bitsPerComponent, colorSpace, width, height);
                effectiveBitsPerComponent = 8;
                this.diagnostics.updateSpan(normalizeSpan, {
                    outputSize: pixelData.length,
                });
            } finally {
                this.diagnostics.endSpan(normalizeSpan);
            }
        }

        // Create appropriate typed array view for color engine
        // - 8-bit: Uint8Array (direct use of pixelData)
        // - 16-bit: Uint16Array view of pixelData bytes
        //   Values appear "swapped" due to native endian interpretation,
        //   which is correct for TYPE_*_SE format
        /** @type {Uint8Array | Uint16Array} */
        let inputBuffer;
        if (bitsPerComponent === 16) {
            // Create Uint16Array view directly from decompressed bytes
            // Note: ArrayBuffer must be properly aligned - use slice if needed
            if (pixelData.byteOffset % 2 !== 0) {
                // Unaligned - need to copy to aligned buffer
                const aligned = new Uint8Array(pixelData.length);
                aligned.set(pixelData);
                inputBuffer = new Uint16Array(aligned.buffer);
            } else {
                inputBuffer = new Uint16Array(pixelData.buffer, pixelData.byteOffset, pixelData.byteLength / 2);
            }
        } else {
            inputBuffer = pixelData;
        }

        // Determine effective output endianness (PDF defaults to big-endian per ISO 32000)
        // This is used for:
        // 1. Deciding what to pass to policy (32-bit always 'little' since TYPE_*_FLT has no SE)
        // 2. Deciding whether to byte-swap after conversion
        const effectiveOutputEndianness = outputEndianness ?? 'big';

        // Warn if 'little' endianness explicitly requested for 32-bit output (unusual for PDF)
        if (effectiveOutputBits === 32 && outputEndianness === 'little') {
            console.warn(
                `${CONTEXT_PREFIX} [PDFImageColorConverter] outputEndianness='little' specified for 32-bit output. ` +
                `PDF standard (ISO 32000) specifies big-endian. Output will be little-endian as requested.`
            );
        }

        // Convert colors using parent class (call super directly to avoid recursion)
        const transformSpan = this.diagnostics.startNestedSpan(parentSpan, 'transform', {
            ref: String(streamRef),
            colorSpace,
            width,
            height,
            bitsPerComponent: effectiveBitsPerComponent,
        });
        /** @type {import('./image-color-converter.js').ImageColorConverterResult} */
        let imageResult;
        try {
            imageResult = await super.convertColor({
                pixelBuffer: inputBuffer,
                width,
                height,
                colorSpace,
                bitsPerComponent: /** @type {import('./color-conversion-policy.js').BitDepth} */ (effectiveBitsPerComponent),
                inputBitsPerComponent,
                outputBitsPerComponent,
                endianness,
                inputEndianness,
                // For 32-bit: always 'little' (TYPE_*_FLT has no SE variant, byte-swap handled after)
                // For 16-bit: use effectiveOutputEndianness (policy selects TYPE_*_SE as needed)
                outputEndianness: effectiveOutputBits === 32 ? 'little' : effectiveOutputEndianness,
                sourceProfile: input.sourceProfile,
            });
            this.diagnostics.updateSpan(transformSpan, {
                pixels: pixelCount,
                inputSize: inputBuffer.length,
                outputSize: imageResult.pixelBuffer.length,
            });
        } finally {
            this.diagnostics.endSpan(transformSpan);
        }

        // Convert output to Uint8Array for PDF
        /** @type {Uint8Array} */
        let outputData = imageResult.pixelBuffer instanceof Uint8Array
            ? imageResult.pixelBuffer
            : new Uint8Array(imageResult.pixelBuffer.buffer, imageResult.pixelBuffer.byteOffset, imageResult.pixelBuffer.byteLength);

        // Byte-swap 32-bit output to big-endian if requested
        // - 32-bit: LittleCMS TYPE_*_FLT always outputs little-endian (no SE variant)
        // - 16-bit: Policy handles via TYPE_*_SE, no byte-swap needed
        if (effectiveOutputEndianness === 'big' && imageResult.bitsPerComponent === 32) {
            outputData = this.#byteSwap32(outputData);
        }
        // Write back coerced Lab absolute-zero pixels in output
        if (labAbsoluteZeroPositions && labAbsoluteZeroPositions.length > 0) {
            const outputBPC = imageResult.bitsPerComponent;

            if (labAbsoluteZeroReplacementPixel) {
                // CMYK K-Only GCR: write the precomputed Relative Colorimetric black
                // Output is in PDF format (big-endian for >8-bit) at this point
                const outputBytesPerPixel = outputBPC === 16 ? 8 : 4;
                /** @type {number[]} */
                let replacementBytes;
                if (outputBPC === 16) {
                    // Scale 8-bit CMYK to 16-bit big-endian: value * 257 → [high, low]
                    replacementBytes = [];
                    for (let ch = 0; ch < 4; ch++) {
                        const v16 = labAbsoluteZeroReplacementPixel[ch] * 257;
                        replacementBytes.push((v16 >> 8) & 0xFF, v16 & 0xFF);
                    }
                } else {
                    // 8-bit: use directly
                    replacementBytes = [...labAbsoluteZeroReplacementPixel];
                }

                for (const pixelIndex of labAbsoluteZeroPositions) {
                    const outputOffset = pixelIndex * outputBytesPerPixel;
                    for (let j = 0; j < outputBytesPerPixel; j++) {
                        outputData[outputOffset + j] = replacementBytes[j];
                    }
                }
                if (config.verbose) {
                    console.log(`${CONTEXT_PREFIX}   [COERCE] Wrote Relative Colorimetric black at ${labAbsoluteZeroPositions.length} pixel positions`);
                }
            } else {
                // Lab output: write back all zeros (Lab 0/-128/-128)
                const outputBytesPerPixel = outputBPC === 32 ? 12 : (outputBPC === 16 ? 6 : 3);
                for (const pixelIndex of labAbsoluteZeroPositions) {
                    const outputOffset = pixelIndex * outputBytesPerPixel;
                    for (let j = 0; j < outputBytesPerPixel; j++) {
                        outputData[outputOffset + j] = 0;
                    }
                }
                if (config.verbose) {
                    console.log(`${CONTEXT_PREFIX}   [COERCE] Restored ${labAbsoluteZeroPositions.length} Lab absolute-zero pixels in output`);
                }
            }
        }

        let outputCompressed = false;

        if (config.compressOutput && this.#pako) {
            const encodeSpan = this.diagnostics.startNestedSpan(parentSpan, 'encode', {
                ref: String(streamRef),
                uncompressedSize: outputData.length,
            });
            try {
                outputData = this.#compress(outputData);
                outputCompressed = true;
                this.diagnostics.updateSpan(encodeSpan, {
                    compressedSize: outputData.length,
                    ratio: (outputData.length / imageResult.pixelBuffer.length).toFixed(3),
                });
            } finally {
                this.diagnostics.endSpan(encodeSpan);
            }
        }

        return {
            streamRef,
            streamData: outputData,
            isCompressed: outputCompressed,
            width,
            height,
            colorSpace: config.destinationColorSpace,
            bitsPerComponent: imageResult.bitsPerComponent, // Preserve output bit depth
            pixelCount: imageResult.pixelCount,
        };
    }

    // ========================================
    // Compression Utilities
    // ========================================

    /**
     * Decompresses FlateDecode data.
     *
     * @param {Uint8Array} data - Compressed data
     * @returns {Uint8Array} Decompressed data
     */
    #decompress(data) {
        if (!this.#pako) {
            throw new Error('pako not available for decompression');
        }
        try {
            return this.#pako.inflate(data);
        } catch (error) {
            throw new Error(`Failed to decompress image data: ${error}`);
        }
    }

    /**
     * Compresses data with FlateDecode.
     *
     * @param {Uint8Array} data - Uncompressed data
     * @returns {Uint8Array} Compressed data
     */
    #compress(data) {
        if (!this.#pako) {
            throw new Error('pako not available for compression');
        }
        try {
            return this.#pako.deflate(data);
        } catch (error) {
            throw new Error(`Failed to compress image data: ${error}`);
        }
    }

    // ========================================
    // Byte-Swap Utilities
    // ========================================

    /**
     * Byte-swaps 16-bit values from little-endian to big-endian (or vice versa).
     *
     * @param {Uint8Array} buffer - Buffer containing 16-bit values
     * @returns {Uint8Array} New buffer with swapped bytes
     */
    #byteSwap16(buffer) {
        const swapped = new Uint8Array(buffer.length);
        for (let i = 0; i < buffer.length; i += 2) {
            swapped[i] = buffer[i + 1];
            swapped[i + 1] = buffer[i];
        }
        return swapped;
    }

    /**
     * Byte-swaps 32-bit values from little-endian to big-endian (or vice versa).
     *
     * @param {Uint8Array} buffer - Buffer containing 32-bit values
     * @returns {Uint8Array} New buffer with swapped bytes
     */
    #byteSwap32(buffer) {
        const swapped = new Uint8Array(buffer.length);
        for (let i = 0; i < buffer.length; i += 4) {
            swapped[i] = buffer[i + 3];
            swapped[i + 1] = buffer[i + 2];
            swapped[i + 2] = buffer[i + 1];
            swapped[i + 3] = buffer[i];
        }
        return swapped;
    }

    // ========================================
    // BitsPerComponent Normalization
    // ========================================

    /**
     * Normalizes pixel data to 8 bits per component.
     *
     * @param {Uint8Array} data - Original pixel data
     * @param {number} bitsPerComponent - Original bits per component
     * @param {import('./color-converter.js').ColorType} colorSpace - Color space
     * @param {number} width - Image width
     * @param {number} height - Image height
     * @returns {Uint8Array} Normalized 8-bit pixel data
     */
    #normalizeBitsPerComponent(data, bitsPerComponent, colorSpace, width, height) {
        const channels = this.#getChannelCount(colorSpace);
        const pixelCount = width * height;
        const outputData = new Uint8Array(pixelCount * channels);

        if (bitsPerComponent === 16) {
            // 16-bit to 8-bit: divide by 257
            // IMPORTANT: PDF 16-bit data is big-endian, but Uint16Array uses native endian
            // (little-endian on most systems). We must read bytes manually in big-endian order.
            const sampleCount = pixelCount * channels;
            /// This is big-endian
            for (let i = 0; i < sampleCount; i++) {
                const byteOffset = i * 2;
                const high = data[byteOffset];
                const low = data[byteOffset + 1];
                const value16 = (high << 8) | low;
                outputData[i] = Math.round(value16 / 257);
            }

            /// FOR REFERENCE:
            //
            // // Native endian (incorrect for PDF)
            // const input16 = new Uint16Array(data.buffer, data.byteOffset, sampleCount);
            // for (let i = 0; i < sampleCount; i++) {
            //     const value16 = input16[i];
            //     outputData[i] = Math.round(value16 / 257);
            // }
        } else if (bitsPerComponent === 4) {
            // 4-bit to 8-bit: multiply by 17
            let outputIndex = 0;
            for (let i = 0; i < data.length; i++) {
                const byte = data[i];
                outputData[outputIndex++] = ((byte >> 4) & 0x0F) * 17;
                if (outputIndex < outputData.length) {
                    outputData[outputIndex++] = (byte & 0x0F) * 17;
                }
            }
        } else if (bitsPerComponent === 1) {
            // 1-bit to 8-bit: expand each bit
            let outputIndex = 0;
            for (let i = 0; i < data.length && outputIndex < outputData.length; i++) {
                const byte = data[i];
                for (let bit = 7; bit >= 0 && outputIndex < outputData.length; bit--) {
                    outputData[outputIndex++] = ((byte >> bit) & 1) * 255;
                }
            }
        } else if (bitsPerComponent === 2) {
            // 2-bit to 8-bit: multiply by 85
            let outputIndex = 0;
            for (let i = 0; i < data.length; i++) {
                const byte = data[i];
                outputData[outputIndex++] = ((byte >> 6) & 0x03) * 85;
                if (outputIndex < outputData.length) {
                    outputData[outputIndex++] = ((byte >> 4) & 0x03) * 85;
                }
                if (outputIndex < outputData.length) {
                    outputData[outputIndex++] = ((byte >> 2) & 0x03) * 85;
                }
                if (outputIndex < outputData.length) {
                    outputData[outputIndex++] = (byte & 0x03) * 85;
                }
            }
        } else {
            // Unknown BPC, return as-is
            console.warn(`${CONTEXT_PREFIX} [PDFImageColorConverter] Unknown BitsPerComponent: ${bitsPerComponent}`);
            return data;
        }

        return outputData;
    }

    /**
     * Gets the number of channels for a color space.
     *
     * @param {import('./color-converter.js').ColorType} colorSpace
     * @returns {number}
     */
    #getChannelCount(colorSpace) {
        switch (colorSpace) {
            case 'Gray': return 1;
            case 'RGB': return 3;
            case 'Lab': return 3;
            case 'CMYK': return 4;
            default: return 3;
        }
    }

    // ========================================
    // Worker Mode Support
    // ========================================

    /**
     * @override
     * @returns {boolean}
     */
    get supportsWorkerMode() {
        return true;
    }

    /**
     * Prepares a task for worker thread execution.
     *
     * @override
     * @param {PDFImageColorConverterInput} input
     * @param {import('./color-converter.js').ColorConverterContext} context
     * @returns {import('./color-converter.js').WorkerTask}
     */
    prepareWorkerTask(input, context) {
        const config = this.configuration;

        // Helper to safely convert Uint8Array to ArrayBuffer
        // IMPORTANT: .buffer on a view/subarray gives the ENTIRE underlying buffer,
        // not just the viewed portion. We must slice to get just our data.
        const toArrayBuffer = (/** @type {Uint8Array | ArrayBuffer} */ data) => {
            if (data instanceof Uint8Array) {
                // Slice to get exactly our data, not the underlying buffer
                return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
            }
            return data;
        };

        // Prepare source profile for transfer
        let sourceProfile = input.sourceProfile;
        if (sourceProfile instanceof Uint8Array) {
            sourceProfile = toArrayBuffer(sourceProfile);
        }

        // Prepare destination profile for transfer
        let destinationProfile = config.destinationProfile;
        if (destinationProfile instanceof Uint8Array) {
            destinationProfile = toArrayBuffer(destinationProfile);
        }

        // Prepare compressed stream data for transfer
        const compressedData = toArrayBuffer(input.streamData);

        // Default inputEndianness is 'big' for >8-bit PDF data (ISO 32000)
        const defaultInputEndianness = input.bitsPerComponent > 8 ? 'big' : 'native';

        return {
            type: 'image',
            streamRef: String(input.streamRef),
            compressedData: compressedData,
            isCompressed: input.isCompressed,
            width: input.width,
            height: input.height,
            colorSpace: input.colorSpace,
            bitsPerComponent: input.bitsPerComponent,
            inputBitsPerComponent: input.inputBitsPerComponent,
            outputBitsPerComponent: input.outputBitsPerComponent ?? this.configuration.outputBitsPerComponent,
            endianness: input.endianness,
            inputEndianness: input.inputEndianness ?? input.endianness ?? defaultInputEndianness,
            outputEndianness: input.outputEndianness ?? this.configuration.outputEndianness,
            sourceProfile: sourceProfile,
            destinationProfile: destinationProfile,
            destinationColorSpace: config.destinationColorSpace,
            renderingIntent: this.getEffectiveRenderingIntent(input.colorSpace),
            blackPointCompensation: config.blackPointCompensation,
            useAdaptiveBPCClamping: config.useAdaptiveBPCClamping,
            compressOutput: config.compressOutput,
            verbose: config.verbose,
            intermediateProfiles: config.intermediateProfiles?.map(
                profile => profile instanceof Uint8Array ? toArrayBuffer(profile) : profile
            ),
        };
    }

    /**
     * Applies worker result back to the PDF.
     *
     * @override
     * @param {PDFImageColorConverterInput} input
     * @param {import('./color-converter.js').WorkerResult} workerResult
     * @param {import('./color-converter.js').ColorConverterContext} context
     * @returns {Promise<void>}
     */
    async applyWorkerResult(input, workerResult, context) {
        // Store result in context for parent to apply to PDF
        // bitsPerComponent comes from worker result, falling back to configured output or input value
        const outputBitsPerComponent = workerResult.bitsPerComponent
            ?? this.configuration.outputBitsPerComponent
            ?? input.bitsPerComponent
            ?? 8;
        context.workerResult = {
            streamRef: input.streamRef,
            streamData: new Uint8Array(workerResult.data),
            isCompressed: workerResult.isCompressed,
            bitsPerComponent: outputBitsPerComponent,
            colorSpace: this.configuration.destinationColorSpace,
        };
    }
}
