// @ts-check
/**
 * PDF Image Color Sampler
 *
 * Extends PDFImageColorConverter for analysis use cases.
 * Provides pixel sampling and Float32 Lab output for Delta-E computation.
 *
 * IMPORTANT: This class is for ANALYSIS ONLY, not PDF output.
 * Float32 Lab output cannot be written back to PDF documents.
 *
 * @module PDFImageColorSampler
 */

import { PDFImageColorConverter } from './pdf-image-color-converter.js';
import { TYPE_Lab_FLT } from './color-conversion-policy.js';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Configuration for PDFImageColorSampler.
 *
 * IMPORTANT: destinationColorSpace must be 'Lab' for analysis mode.
 * destinationProfile must be 'Lab' (built-in D50 Lab profile).
 *
 * @typedef {import('./pdf-image-color-converter.js').PDFImageColorConverterConfiguration & {
 *   outputBitDepth?: 8 | 16 | 32,
 * }} PDFImageColorSamplerConfiguration
 */

/**
 * Input data for sampled pixel extraction.
 *
 * Requires pixel indices from an ImageSampler instance.
 * Only decompresses and extracts the specified pixels, not the entire image.
 *
 * @typedef {{
 *   streamRef: any,
 *   streamData: Uint8Array,
 *   isCompressed: boolean,
 *   width: number,
 *   height: number,
 *   colorSpace: import('./image-color-converter.js').ColorType,
 *   bitsPerComponent: import('./color-conversion-policy.js').BitDepth | 1 | 2 | 4,
 *   sourceProfile?: ArrayBuffer | 'Lab',
 *   pixelIndices: number[],
 * }} PDFImageColorSamplerInput
 */

/**
 * Result of sampled pixel extraction with Lab values.
 *
 * Returns Float32Array of Lab values for high-precision Delta-E.
 * Each pixel has 3 values: L (0-100), a (-128 to 127), b (-128 to 127).
 *
 * @typedef {{
 *   labValues: Float32Array,
 *   pixelCount: number,
 *   sampledIndices: number[],
 *   width: number,
 *   height: number,
 *   originalColorSpace: import('./image-color-converter.js').ColorType,
 * }} PDFImageColorSamplerResult
 */

// ============================================================================
// PDFImageColorSampler Class
// ============================================================================

/**
 * Samples pixels from PDF images and converts to Lab for analysis.
 *
 * This class is designed for color comparison workflows that need:
 * - Pixel sampling (not full image conversion)
 * - Float32 Lab output for precise Delta-E computation
 * - Direct TypedArray output (not PDF-compatible streams)
 *
 * LIMITATIONS:
 * - Output cannot be written to PDF (Float32 has no big-endian support)
 * - destinationColorSpace must be 'Lab'
 * - destinationProfile must be 'Lab'
 *
 * @extends PDFImageColorConverter
 * @example
 * ```javascript
 * import { PDFImageColorSampler } from './classes/pdf-image-color-sampler.js';
 * import { ImageSampler } from '../experiments/classes/image-sampler.mjs';
 *
 * // Create sampler for random pixel selection
 * const imageSampler = new ImageSampler({ sampling: 'random', count: 10000 });
 *
 * // Create color sampler for Lab conversion
 * const colorSampler = new PDFImageColorSampler({
 *     renderingIntent: 'relative-colorimetric',
 *     blackPointCompensation: true,
 *     destinationProfile: 'Lab',
 *     destinationColorSpace: 'Lab',
 *     inputType: 'CMYK',
 *     compressOutput: false, // Not applicable for analysis mode
 *     verbose: false,
 * });
 *
 * // Sample pixel indices
 * const sampling = imageSampler.sample(imageWidth, imageHeight);
 *
 * // Extract and convert sampled pixels to Lab
 * const result = await colorSampler.samplePixels({
 *     streamRef: imageRef,
 *     streamData: compressedImageData,
 *     isCompressed: true,
 *     width: imageWidth,
 *     height: imageHeight,
 *     colorSpace: 'CMYK',
 *     bitsPerComponent: 8,
 *     sourceProfile: cmykProfileBuffer, // From ICCBased or Output Intent
 *     pixelIndices: sampling.indices,
 * });
 *
 * // result.labValues is Float32Array with L, a, b for each pixel
 * // Use with DeltaEMetrics for comparison
 * ```
 */
export class PDFImageColorSampler extends PDFImageColorConverter {
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
     * Creates a new PDFImageColorSampler instance.
     *
     * IMPORTANT: Configuration must specify Lab output:
     * - destinationProfile: 'Lab'
     * - destinationColorSpace: 'Lab' (Note: parent expects 'CMYK' | 'RGB', we override validation)
     *
     * @param {PDFImageColorSamplerConfiguration} configuration - Immutable configuration
     * @param {object} [options={}] - Additional options
     * @param {import('./color-engine-provider.js').ColorEngineProvider} [options.colorEngineProvider] - Shared provider
     * @param {import('./color-conversion-policy.js').ColorConversionPolicy} [options.policy] - Custom policy
     * @param {string} [options.engineVersion] - Color engine version for policy rules
     * @param {string} [options.domain='Analysis'] - Domain context for policy severity
     */
    constructor(configuration, options = {}) {
        // Validate Lab output configuration
        if (configuration.destinationProfile !== 'Lab') {
            throw new Error(
                'PDFImageColorSampler requires destinationProfile: "Lab". ' +
                'This class is for analysis only, not PDF output.'
            );
        }

        // Allow 'Lab' as destinationColorSpace by casting (parent expects 'CMYK' | 'RGB')
        // This is safe because we override the conversion output handling
        const adjustedConfig = {
            ...configuration,
            destinationColorSpace: /** @type {'CMYK' | 'RGB'} */ ('Lab'),
            compressOutput: false, // Never compress analysis output
        };

        super(adjustedConfig, { ...options, domain: options.domain ?? 'Analysis' });
        this.#pakoReady = this.#loadPako();
    }

    // ========================================
    // Initialization
    // ========================================

    /**
     * Loads pako library for decompression.
     * @returns {Promise<void>}
     */
    async #loadPako() {
        try {
            this.#pako = await import('pako');
        } catch {
            console.warn('[PDFImageColorSampler] pako not available - compressed images will fail');
        }
    }

    // ========================================
    // Sampled Pixel Extraction
    // ========================================

    /**
     * Extract and convert sampled pixels to Lab Float32.
     *
     * This method:
     * 1. Decompresses the image stream (if compressed)
     * 2. Normalizes bit depth to 8-bit (if non-standard)
     * 3. Extracts only the specified pixel indices
     * 4. Converts to Lab using the source ICC profile
     * 5. Returns Float32Array with Lab values
     *
     * @param {PDFImageColorSamplerInput} input - Image data with pixel indices
     * @returns {Promise<PDFImageColorSamplerResult>} Lab values for sampled pixels
     */
    async samplePixels(input) {
        await this.#pakoReady;
        await this.ensureReady();

        const {
            streamRef,
            streamData,
            isCompressed,
            width,
            height,
            colorSpace,
            bitsPerComponent,
            sourceProfile,
            pixelIndices,
        } = input;

        // Validate input
        if (!pixelIndices || pixelIndices.length === 0) {
            throw new Error('pixelIndices must be a non-empty array');
        }

        const totalPixels = width * height;
        const maxIndex = Math.max(...pixelIndices);
        if (maxIndex >= totalPixels) {
            throw new Error(
                `Invalid pixel index ${maxIndex} - image has ${totalPixels} pixels (${width}×${height})`
            );
        }

        // Decompress if needed
        let pixelData = streamData;
        if (isCompressed) {
            pixelData = this.#decompress(streamData);
        }

        // Get channel count for the color space
        const channels = this.#getChannelCount(colorSpace);

        // Normalize only non-standard bit depths (1, 2, 4) to 8-bit
        // 8-bit and 16-bit are processed at native precision
        let effectiveBitsPerComponent = bitsPerComponent;
        if (bitsPerComponent !== 8 && bitsPerComponent !== 16) {
            pixelData = this.#normalizeBitsPerComponent(
                pixelData,
                bitsPerComponent,
                channels,
                width,
                height
            );
            effectiveBitsPerComponent = 8;
        }

        // Extract only the sampled pixels (handles both 8-bit and 16-bit)
        const sampledPixelData = this.#extractSampledPixels(
            pixelData,
            channels,
            pixelIndices,
            effectiveBitsPerComponent
        );

        // Convert sampled pixels to Lab using parent's convertColorsBuffer
        // Request Float32 output (TYPE_Lab_FLT) for high-precision Delta-E
        const result = await this.convertColorsBuffer(sampledPixelData, {
            inputColorSpace: colorSpace,
            outputColorSpace: 'Lab',
            sourceProfile: sourceProfile ?? 'Lab',
            destinationProfile: 'Lab',
            bitsPerComponent: /** @type {8 | 16} */ (effectiveBitsPerComponent),
            inputBitsPerComponent: /** @type {8 | 16} */ (effectiveBitsPerComponent),
            outputBitsPerComponent: 32, // Float32 output for Lab
            endianness: effectiveBitsPerComponent === 16 ? 'big' : 'native', // PDF 16-bit is big-endian
        });

        // Validate output is Float32Array
        if (!(result.outputPixels instanceof Float32Array)) {
            throw new Error(
                `Expected Float32Array output but got ${result.outputPixels.constructor.name}. ` +
                'Ensure outputBitsPerComponent: 32 is properly handled by ColorConversionPolicy.'
            );
        }

        return {
            labValues: result.outputPixels,
            pixelCount: pixelIndices.length,
            sampledIndices: pixelIndices,
            width,
            height,
            originalColorSpace: colorSpace,
        };
    }

    /**
     * Extract full image and convert to Lab Float32.
     *
     * Convenience method when you need all pixels, not just samples.
     * For large images, prefer samplePixels() with ImageSampler.
     *
     * @param {Omit<PDFImageColorSamplerInput, 'pixelIndices'>} input - Image data
     * @returns {Promise<PDFImageColorSamplerResult>} Lab values for all pixels
     */
    async extractAllPixels(input) {
        const totalPixels = input.width * input.height;
        const allIndices = Array.from({ length: totalPixels }, (_, i) => i);

        return this.samplePixels({
            ...input,
            pixelIndices: allIndices,
        });
    }

    // ========================================
    // Override: Prevent PDF Output Mode
    // ========================================

    /**
     * @override
     * Throws error - PDFImageColorSampler cannot produce PDF-compatible output.
     *
     * @param {import('./pdf-image-color-converter.js').PDFImageColorConverterInput} input
     * @param {import('./color-converter.js').ColorConverterContext} context
     * @returns {Promise<never>}
     */
    async convertColor(input, context) {
        throw new Error(
            'PDFImageColorSampler.convertColor() is not supported. ' +
            'This class is for analysis only - use samplePixels() or extractAllPixels() instead. ' +
            'Float32 Lab output cannot be written to PDF documents (no TYPE_Lab_FLT_SE support).'
        );
    }

    /**
     * @override
     * Throws error - PDFImageColorSampler cannot produce PDF-compatible output.
     *
     * @param {import('./pdf-image-color-converter.js').PDFImageColorConverterInput} input
     * @param {import('./color-converter.js').ColorConverterContext} context
     * @returns {Promise<never>}
     */
    async convertPDFImageColor(input, context) {
        throw new Error(
            'PDFImageColorSampler.convertPDFImageColor() is not supported. ' +
            'This class is for analysis only - use samplePixels() or extractAllPixels() instead. ' +
            'Float32 Lab output cannot be written to PDF documents (no TYPE_Lab_FLT_SE support).'
        );
    }

    // ========================================
    // Private Utilities
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
            throw new Error(`Failed to decompress image data: ${/** @type {Error} */ (error).message}`);
        }
    }

    /**
     * Gets the number of channels for a color space.
     *
     * @param {import('./image-color-converter.js').ColorType} colorSpace
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

    /**
     * Normalizes pixel data from non-standard bit depths (1, 2, 4) to 8 bits per component.
     *
     * Note: 16-bit is NOT normalized - it's processed at native precision.
     *
     * @param {Uint8Array} data - Original pixel data
     * @param {number} bitsPerComponent - Original bits per component (1, 2, or 4)
     * @param {number} channels - Number of channels
     * @param {number} width - Image width
     * @param {number} height - Image height
     * @returns {Uint8Array} Normalized 8-bit pixel data
     */
    #normalizeBitsPerComponent(data, bitsPerComponent, channels, width, height) {
        const pixelCount = width * height;
        const outputData = new Uint8Array(pixelCount * channels);

        if (bitsPerComponent === 4) {
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
            console.warn(`[PDFImageColorSampler] Unknown BitsPerComponent: ${bitsPerComponent}`);
            return data;
        }

        return outputData;
    }

    /**
     * Extracts sampled pixels from the full pixel data.
     *
     * @param {Uint8Array} pixelData - Full image pixel data (raw bytes)
     * @param {number} channels - Number of channels per pixel
     * @param {number[]} indices - Pixel indices to extract
     * @param {number} bitsPerComponent - Bits per component (8 or 16)
     * @returns {Uint8Array} Extracted sampled pixel data
     */
    #extractSampledPixels(pixelData, channels, indices, bitsPerComponent) {
        const sampleCount = indices.length;
        const bytesPerSample = bitsPerComponent / 8;
        const bytesPerPixel = channels * bytesPerSample;
        const sampledBuffer = new Uint8Array(sampleCount * bytesPerPixel);

        for (let i = 0; i < sampleCount; i++) {
            const srcOffset = indices[i] * bytesPerPixel;
            const dstOffset = i * bytesPerPixel;
            for (let b = 0; b < bytesPerPixel; b++) {
                sampledBuffer[dstOffset + b] = pixelData[srcOffset + b];
            }
        }

        return sampledBuffer;
    }

    // ========================================
    // Static Utilities
    // ========================================

    /**
     * Create a Lab Float32Array from 8-bit Lab data.
     *
     * Utility method for converting legacy 8-bit Lab output to Float32.
     * Lab 8-bit encoding: L = 0-255 → 0-100, a/b = 0-255 → -128 to 127
     *
     * @param {Uint8Array} lab8Buffer - 8-bit Lab data
     * @returns {Float32Array} Float32 Lab values
     */
    static convertLab8ToFloat(lab8Buffer) {
        const pixelCount = lab8Buffer.length / 3;
        const labFloat = new Float32Array(pixelCount * 3);

        for (let i = 0; i < pixelCount; i++) {
            const offset = i * 3;
            // L: 0-255 → 0-100
            labFloat[offset] = (lab8Buffer[offset] / 255) * 100;
            // a: 0-255 → -128 to 127 (128 = 0)
            labFloat[offset + 1] = lab8Buffer[offset + 1] - 128;
            // b: 0-255 → -128 to 127 (128 = 0)
            labFloat[offset + 2] = lab8Buffer[offset + 2] - 128;
        }

        return labFloat;
    }

    /**
     * Describe the sampler's capabilities.
     *
     * @returns {string}
     */
    toString() {
        return 'PDFImageColorSampler(Lab Float32 output for Delta-E analysis)';
    }
}
