// @ts-check
/**
 * Legacy PDF Image Color Converter
 *
 * Extends PDFImageColorConverter with legacy engine support:
 * - Consumer-side adaptive BPC clamping (initBPCClamping + doTransformAdaptive)
 * - Lab absolute-zero pixel coercion
 * - Multiprofile chain fallback for engines without createMultiprofileTransform
 *
 * For engines up to 2026-01-30.
 *
 * @module LegacyPDFImageColorConverter
 * @author Saleh Abdel Motaal <dev@smotaal.io>
 * @ai Claude Opus 4.6 (code generation)
 */

import { PDFImageColorConverter } from '../pdf-image-color-converter.js';
import { SHOULD_SWAP_16_FROM_BIG_TO_LITTLE_ENDIAN } from '../color-conversion-policy.js';
import {
    ADAPTIVE_BPC_THRESHOLD,
    isSwapEndianFormat,
    isFloatFormat,
    byteSwap16,
    removeSwapEndianFlag,
    getChannelsForColorSpace,
    getChannelsFromFormat,
    getProfileCacheKey,
    getTransformCacheKey,
} from './legacy-color-converter-helpers.js';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Legacy configuration extends PDFImageColorConverterConfiguration with legacy-only properties.
 *
 * @typedef {import('../pdf-image-color-converter.js').PDFImageColorConverterConfiguration & {
 *   useAdaptiveBPCClamping?: boolean,
 *   coerceLabAbsoluteZeroPixels?: boolean,
 * }} LegacyPDFImageColorConverterConfiguration
 */

// ============================================================================
// LegacyPDFImageColorConverter Class
// ============================================================================

/**
 * Legacy PDF image color converter with consumer-side adaptive BPC and Lab coercion.
 *
 * @extends PDFImageColorConverter
 */
export class LegacyPDFImageColorConverter extends PDFImageColorConverter {
    // ========================================
    // Own Private Fields (caches inaccessible on parent due to #private)
    // ========================================

    /** @type {Map<string, number>} Profile handle cache (cacheKey → WASM handle) */
    #profileHandleCache = new Map();

    /** @type {Map<string, { transform: number, inputFormat: number, outputFormat: number, bpcClampingInitialized: boolean }>} */
    #transformCache = new Map();

    /** @type {Map<string, { transform: number, inputFormat: number, outputFormat: number, bpcClampingInitialized: boolean }>} */
    #multiprofileTransformCache = new Map();

    // ========================================
    // Configuration Access
    // ========================================

    /**
     * @returns {Readonly<LegacyPDFImageColorConverterConfiguration>}
     */
    get configuration() {
        return /** @type {Readonly<LegacyPDFImageColorConverterConfiguration>} */ (super.configuration);
    }

    // ========================================
    // Legacy convertColorsBuffer Override
    // ========================================

    /**
     * Converts a buffer of color values with legacy engine support.
     *
     * Adds consumer-side adaptive BPC clamping (initBPCClamping + doTransformAdaptive)
     * and multiprofile chain fallback for engines without createMultiprofileTransform.
     *
     * @override
     * @param {Uint8Array | Uint16Array | Float32Array} inputBuffer
     * @param {object} options
     * @param {import('../color-conversion-policy.js').ColorSpace} options.inputColorSpace
     * @param {import('../color-conversion-policy.js').ColorSpace} options.outputColorSpace
     * @param {import('../color-converter.js').ProfileType} options.sourceProfile
     * @param {import('../color-converter.js').ProfileType} [options.destinationProfile]
     * @param {import('../color-converter.js').RenderingIntent} [options.renderingIntent]
     * @param {boolean} [options.blackPointCompensation]
     * @param {import('../color-conversion-policy.js').BitDepth} [options.bitsPerComponent]
     * @param {import('../color-conversion-policy.js').BitDepth} [options.inputBitsPerComponent]
     * @param {import('../color-conversion-policy.js').BitDepth} [options.outputBitsPerComponent]
     * @param {import('../color-conversion-policy.js').Endianness} [options.endianness]
     * @param {import('../color-conversion-policy.js').Endianness} [options.inputEndianness]
     * @param {import('../color-conversion-policy.js').Endianness} [options.outputEndianness]
     * @param {boolean} [options.requiresMultiprofileTransform]
     * @returns {Promise<{ outputPixels: Uint8Array | Uint16Array | Float32Array, pixelCount: number, inputChannels: number, outputChannels: number, bpcStats?: object }>}
     */
    async convertColorsBuffer(inputBuffer, options) {
        await this.ensureReady();

        const provider = this.colorEngineProvider;
        if (!provider) {
            throw new Error('ColorEngineProvider not initialized');
        }

        const config = this.configuration;
        const {
            inputColorSpace,
            outputColorSpace,
            sourceProfile,
            destinationProfile = config.destinationProfile,
            renderingIntent = config.renderingIntent,
            blackPointCompensation = config.blackPointCompensation,
            bitsPerComponent,
            inputBitsPerComponent,
            outputBitsPerComponent = config.outputBitsPerComponent,
            endianness,
            inputEndianness,
            outputEndianness,
            requiresMultiprofileTransform,
        } = options;

        // Validate source profile (NO fallbacks except Lab)
        if (inputColorSpace !== 'Lab' && !(sourceProfile instanceof ArrayBuffer)) {
            throw new Error(`Source ICC profile is required for ${inputColorSpace} - no fallback profiles allowed`);
        }

        // Validate destination profile (NO fallbacks except Lab)
        if (outputColorSpace !== 'Lab' && !(destinationProfile instanceof ArrayBuffer)) {
            throw new Error(`Destination ICC profile is required for ${outputColorSpace} - no fallback profiles allowed`);
        }

        // Build descriptors
        /** @type {import('../color-conversion-policy.js').PixelFormatDescriptor} */
        const inputDescriptor = {
            colorSpace: inputColorSpace,
            bitsPerComponent: /** @type {import('../color-conversion-policy.js').BitDepth} */ (bitsPerComponent),
            inputBitsPerComponent: /** @type {import('../color-conversion-policy.js').BitDepth | undefined} */ (inputBitsPerComponent),
            endianness,
            inputEndianness,
        };

        /** @type {import('../color-conversion-policy.js').PixelFormatDescriptor} */
        const outputDescriptor = {
            colorSpace: outputColorSpace,
            bitsPerComponent: /** @type {import('../color-conversion-policy.js').BitDepth} */ (bitsPerComponent),
            outputBitsPerComponent: /** @type {import('../color-conversion-policy.js').BitDepth | undefined} */ (outputBitsPerComponent),
            endianness,
            outputEndianness,
        };

        /** @type {import('../color-conversion-policy.js').ConversionDescriptor} */
        const conversionDescriptor = {
            sourceColorSpace: inputColorSpace,
            destinationColorSpace: outputColorSpace,
            renderingIntent,
            blackPointCompensation,
            sourceProfile,
            destinationProfile,
        };

        let inputFormat = this.policy.getInputFormat(inputDescriptor);
        const outputFormat = this.policy.getOutputFormat(outputDescriptor);
        const evaluationResult = this.policy.evaluateConversion(conversionDescriptor);

        // Handle 16-bit SE → Float limitation (same as base class)
        let effectiveInputBuffer = inputBuffer;
        const isSwapEndian = isSwapEndianFormat(inputFormat);
        const isFloatOutput = isFloatFormat(outputFormat);
        const shouldByteSwap = isSwapEndian && (isFloatOutput || SHOULD_SWAP_16_FROM_BIG_TO_LITTLE_ENDIAN);
        if (shouldByteSwap) {
            const bufferToSwap = inputBuffer instanceof Uint8Array
                ? inputBuffer
                : new Uint8Array(inputBuffer.buffer, inputBuffer.byteOffset, inputBuffer.byteLength);
            effectiveInputBuffer = byteSwap16(bufferToSwap);
            inputFormat = removeSwapEndianFlag(inputFormat);
        }

        // Calculate channels and pixel count
        const inputChannels = getChannelsForColorSpace(inputColorSpace);
        const outputChannels = getChannelsForColorSpace(outputColorSpace);
        let pixelCount;
        if (inputBuffer instanceof Uint8Array) {
            const bytesPerSample = this.policy.getBytesPerSample(inputFormat);
            pixelCount = Math.floor(inputBuffer.length / (inputChannels * bytesPerSample));
        } else {
            pixelCount = Math.floor(inputBuffer.length / inputChannels);
        }

        // Get rendering intent and flags
        const effectiveIntent = evaluationResult.overrides.renderingIntent ?? renderingIntent;
        const intentConstant = this.policy.getRenderingIntentConstant(effectiveIntent);
        const constants = provider.getConstants();
        let flags = blackPointCompensation ? constants.cmsFLAGS_BLACKPOINTCOMPENSATION : 0;

        // Engine-side BPC clamping (only when explicitly enabled — false by default for legacy)
        if (config.blackpointCompensationClamping && blackPointCompensation) {
            flags |= constants.cmsFLAGS_BLACKPOINTCOMPENSATION_CLAMPING;
        }

        // Consumer-side adaptive BPC clamping (legacy: initBPCClamping + doTransformAdaptive)
        const useAdaptiveBPC = !config.blackpointCompensationClamping
            && config.useAdaptiveBPCClamping
            && blackPointCompensation
            && pixelCount >= ADAPTIVE_BPC_THRESHOLD;

        // Choose transform method
        let cached;
        if (
            requiresMultiprofileTransform
            && evaluationResult.overrides.requiresMultiprofileTransform !== false
            || evaluationResult.overrides.requiresMultiprofileTransform
        ) {
            // Add multiprofile BPC scaling flag if available
            if (evaluationResult.overrides.multiprofileBlackPointScaling && constants.cmsFLAGS_MULTIPROFILE_BLACKPOINT_SCALING) {
                flags |= constants.cmsFLAGS_MULTIPROFILE_BLACKPOINT_SCALING;
            }

            const intermediateProfiles = /** @type {string[]} */ (evaluationResult.overrides.intermediateProfiles ?? []);
            /** @type {(ArrayBuffer | 'Lab' | 'sRGB')[]} */
            const profiles = [sourceProfile, ...intermediateProfiles, destinationProfile];
            cached = this.#getOrCreateMultiprofileTransform(
                profiles,
                inputFormat,
                outputFormat,
                intentConstant,
                flags,
                useAdaptiveBPC,
            );
        } else {
            cached = this.#getOrCreateTransform(
                sourceProfile,
                destinationProfile,
                inputFormat,
                outputFormat,
                intentConstant,
                flags,
                useAdaptiveBPC,
            );
        }

        // Create output buffer
        const outputPixels = this.policy.createOutputBuffer(outputFormat, pixelCount, outputChannels);

        // Perform transform
        let bpcStats;
        if (useAdaptiveBPC && cached.bpcClampingInitialized) {
            bpcStats = provider.doTransformAdaptive(cached.transform, effectiveInputBuffer, outputPixels, pixelCount);
        } else {
            provider.transformArray(cached.transform, effectiveInputBuffer, outputPixels, pixelCount);
        }

        return {
            outputPixels,
            pixelCount,
            inputChannels,
            outputChannels,
            bpcStats: bpcStats ?? undefined,
        };
    }

    // ========================================
    // Legacy convertPDFImageColor Override
    // ========================================

    /**
     * Converts a PDF image XObject with Lab absolute-zero pixel coercion.
     *
     * @override
     * @param {import('../pdf-image-color-converter.js').PDFImageColorConverterInput} input
     * @param {import('../color-converter.js').ColorConverterContext} context
     * @returns {Promise<import('../pdf-image-color-converter.js').PDFImageColorConverterResult>}
     */
    async convertPDFImageColor(input, context) {
        const config = this.configuration;

        // If Lab coercion is not needed, delegate to parent
        if (!config.coerceLabAbsoluteZeroPixels || input.colorSpace !== 'Lab') {
            return super.convertPDFImageColor(input, context);
        }

        // Lab coercion is needed — we must decompress, coerce, then delegate
        // But we can't intercept mid-conversion in the parent because of #private fields.
        // Instead, we modify the pixel data before passing to parent.
        await this.ensureReady();

        const { streamData, isCompressed, bitsPerComponent, colorSpace } = input;

        // Decompress if needed to access raw pixel data
        let pixelData = streamData;
        if (isCompressed) {
            const pako = await import('pako');
            pixelData = pako.inflate(streamData);
        }

        const bytesPerPixel = bitsPerComponent === 16 ? 6 : 3;
        const isLabOutput = config.destinationColorSpace === 'Lab';
        const isCMYKKOnlyGCR = config.destinationColorSpace === 'CMYK'
            && config.renderingIntent === 'preserve-k-only-relative-colorimetric-gcr';
        const needsWriteBack = isLabOutput || isCMYKKOnlyGCR;

        // Lab 0/0/0 (proper black with neutral a/b) encoded as raw bytes
        const replacementBytes = bitsPerComponent === 16
            ? [0x00, 0x00, 0x80, 0x00, 0x80, 0x00]
            : [0x00, 0x80, 0x80];

        /** @type {number[] | null} */
        let labAbsoluteZeroPositions = null;
        let coercedCount = 0;

        for (let offset = 0; offset + bytesPerPixel <= pixelData.length; offset += bytesPerPixel) {
            let isAbsoluteZero = true;
            for (let j = 0; j < bytesPerPixel; j++) {
                if (pixelData[offset + j] !== 0) {
                    isAbsoluteZero = false;
                    break;
                }
            }

            if (isAbsoluteZero) {
                if (needsWriteBack) {
                    if (!labAbsoluteZeroPositions) labAbsoluteZeroPositions = [];
                    labAbsoluteZeroPositions.push(offset / bytesPerPixel);
                }
                for (let j = 0; j < bytesPerPixel; j++) {
                    pixelData[offset + j] = replacementBytes[j];
                }
                coercedCount++;
            }
        }

        /** @type {Uint8Array | null} */
        let labAbsoluteZeroReplacementPixel = null;

        if (coercedCount > 0) {
            if (config.verbose) {
                console.log(`  [COERCE] Replaced ${coercedCount} Lab absolute-zero pixels (0/-128/-128 → 0/0/0)`);
            }

            // For CMYK K-Only GCR: compute Relative Colorimetric black
            if (isCMYKKOnlyGCR && labAbsoluteZeroPositions) {
                const labBlackPixel = new Uint8Array([0, 128, 128]);
                const blackResult = await this.convertColorsBuffer(labBlackPixel, {
                    inputColorSpace: 'Lab',
                    outputColorSpace: 'CMYK',
                    sourceProfile: 'Lab',
                    destinationProfile: config.destinationProfile,
                    renderingIntent: 'relative-colorimetric',
                    blackPointCompensation: config.blackPointCompensation,
                    bitsPerComponent: /** @type {import('../color-conversion-policy.js').BitDepth} */ (8),
                });
                labAbsoluteZeroReplacementPixel = blackResult.outputPixels instanceof Uint8Array
                    ? blackResult.outputPixels
                    : new Uint8Array(blackResult.outputPixels.buffer, blackResult.outputPixels.byteOffset, blackResult.outputPixels.byteLength);

                if (config.verbose) {
                    const [c, m, y, k] = labAbsoluteZeroReplacementPixel;
                    console.log(`  [COERCE] Relative Colorimetric black: CMYK(${c}, ${m}, ${y}, ${k}) [8-bit]`);
                }
            }
        }

        // Re-compress if the input was compressed (parent expects same format)
        let modifiedStreamData = pixelData;
        let modifiedIsCompressed = false;
        if (isCompressed && coercedCount > 0) {
            const pako = await import('pako');
            modifiedStreamData = pako.deflate(pixelData);
            modifiedIsCompressed = true;
        } else if (isCompressed) {
            // No modifications, use original compressed data
            modifiedStreamData = streamData;
            modifiedIsCompressed = true;
        }

        // Call parent's convertPDFImageColor with modified data
        const result = await super.convertPDFImageColor({
            ...input,
            streamData: modifiedStreamData,
            isCompressed: modifiedIsCompressed,
        }, context);

        // Write back coerced Lab absolute-zero pixels in output
        if (labAbsoluteZeroPositions && labAbsoluteZeroPositions.length > 0) {
            const outputBPC = result.bitsPerComponent;

            // Get the output data (may be compressed)
            let outputData = result.streamData;
            let wasCompressed = result.isCompressed;

            if (wasCompressed) {
                const pako = await import('pako');
                outputData = pako.inflate(outputData);
            }

            if (labAbsoluteZeroReplacementPixel) {
                // CMYK K-Only GCR: write the precomputed Relative Colorimetric black
                const outputBytesPerPixel = outputBPC === 16 ? 8 : 4;
                /** @type {number[]} */
                let outputReplacementBytes;
                if (outputBPC === 16) {
                    outputReplacementBytes = [];
                    for (let ch = 0; ch < 4; ch++) {
                        const v16 = labAbsoluteZeroReplacementPixel[ch] * 257;
                        outputReplacementBytes.push((v16 >> 8) & 0xFF, v16 & 0xFF);
                    }
                } else {
                    outputReplacementBytes = [...labAbsoluteZeroReplacementPixel];
                }

                for (const pixelIndex of labAbsoluteZeroPositions) {
                    const outputOffset = pixelIndex * outputBytesPerPixel;
                    for (let j = 0; j < outputBytesPerPixel; j++) {
                        outputData[outputOffset + j] = outputReplacementBytes[j];
                    }
                }
                if (config.verbose) {
                    console.log(`  [COERCE] Wrote Relative Colorimetric black at ${labAbsoluteZeroPositions.length} pixel positions`);
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
                    console.log(`  [COERCE] Restored ${labAbsoluteZeroPositions.length} Lab absolute-zero pixels in output`);
                }
            }

            // Re-compress if it was compressed
            if (wasCompressed) {
                const pako = await import('pako');
                result.streamData = pako.deflate(outputData);
                result.isCompressed = true;
            } else {
                result.streamData = outputData;
            }
        }

        return result;
    }

    // ========================================
    // Own Profile and Transform Caching
    // ========================================

    /**
     * Opens a profile handle from a source.
     * @param {import('../color-converter.js').ProfileType} source
     * @returns {number}
     */
    #openProfile(source) {
        const provider = this.colorEngineProvider;
        if (!provider) throw new Error('ColorEngineProvider not initialized');

        const cacheKey = getProfileCacheKey(source);
        const cachedHandle = this.#profileHandleCache.get(cacheKey);
        if (cachedHandle !== undefined) return cachedHandle;

        let handle;
        if (source === 'Lab') {
            handle = provider.createLab4Profile();
        } else if (source === 'sRGB') {
            handle = provider.createSRGBProfile();
        } else if (source instanceof ArrayBuffer) {
            handle = provider.openProfileFromMem(source);
        } else {
            throw new Error('Profile must be ArrayBuffer, "Lab", or "sRGB"');
        }

        this.#profileHandleCache.set(cacheKey, handle);
        return handle;
    }

    /**
     * Gets or creates a cached transform with optional BPC clamping.
     *
     * @param {import('../color-converter.js').ProfileType} sourceProfileSource
     * @param {import('../color-converter.js').ProfileType} destProfileSource
     * @param {number} inputFormat
     * @param {number} outputFormat
     * @param {number} intent
     * @param {number} flags
     * @param {boolean} [initBPCClamping=false]
     * @returns {{ transform: number, inputFormat: number, outputFormat: number, bpcClampingInitialized: boolean }}
     */
    #getOrCreateTransform(sourceProfileSource, destProfileSource, inputFormat, outputFormat, intent, flags, initBPCClamping = false) {
        const provider = this.colorEngineProvider;
        if (!provider) throw new Error('ColorEngineProvider not initialized');

        const srcKey = getProfileCacheKey(sourceProfileSource);
        const dstKey = getProfileCacheKey(destProfileSource);
        const cacheKey = getTransformCacheKey(srcKey, dstKey, inputFormat, outputFormat, intent, flags);

        const existingCached = this.#transformCache.get(cacheKey);
        if (existingCached) {
            if (initBPCClamping && !existingCached.bpcClampingInitialized) {
                const inCh = getChannelsFromFormat(inputFormat);
                const outCh = getChannelsFromFormat(outputFormat);
                if (provider.initBPCClamping(existingCached.transform, inCh, outCh)) {
                    existingCached.bpcClampingInitialized = true;
                }
            }
            return existingCached;
        }

        const sourceProfile = this.#openProfile(sourceProfileSource);
        const destProfile = this.#openProfile(destProfileSource);

        const transform = provider.createTransform(
            sourceProfile, inputFormat, destProfile, outputFormat, intent, flags
        );
        if (!transform) throw new Error('Failed to create color transform');

        const cached = { transform, inputFormat, outputFormat, bpcClampingInitialized: false };

        if (initBPCClamping) {
            const inCh = getChannelsFromFormat(inputFormat);
            const outCh = getChannelsFromFormat(outputFormat);
            if (provider.initBPCClamping(transform, inCh, outCh)) {
                cached.bpcClampingInitialized = true;
            }
        }

        this.#transformCache.set(cacheKey, cached);
        return cached;
    }

    /**
     * Gets or creates a cached multiprofile transform with chain fallback.
     *
     * @param {(ArrayBuffer | 'Lab' | 'sRGB')[]} profileSources
     * @param {number} inputFormat
     * @param {number} outputFormat
     * @param {number} intent
     * @param {number} flags
     * @param {boolean} [initBPCClamping=false]
     * @returns {{ transform: number, inputFormat: number, outputFormat: number, bpcClampingInitialized: boolean }}
     */
    #getOrCreateMultiprofileTransform(profileSources, inputFormat, outputFormat, intent, flags, initBPCClamping = false) {
        const provider = this.colorEngineProvider;
        if (!provider) throw new Error('ColorEngineProvider not initialized');

        const profileKeys = profileSources.map(src => getProfileCacheKey(/** @type {ArrayBuffer | 'Lab'} */(src)));
        const cacheKey = `multi:${profileKeys.join('|')}|${inputFormat}|${outputFormat}|${intent}|${flags}`;

        const existingCached = this.#multiprofileTransformCache.get(cacheKey);
        if (existingCached) {
            if (initBPCClamping && !existingCached.bpcClampingInitialized) {
                const inCh = getChannelsFromFormat(inputFormat);
                const outCh = getChannelsFromFormat(outputFormat);
                if (provider.initBPCClamping(existingCached.transform, inCh, outCh)) {
                    existingCached.bpcClampingInitialized = true;
                }
            }
            return existingCached;
        }

        // Open all profiles
        const profileHandles = profileSources.map(src => {
            if (src === 'sRGB') {
                const srcCacheKey = 'sRGB';
                const cachedHandle = this.#profileHandleCache.get(srcCacheKey);
                if (cachedHandle !== undefined) return cachedHandle;
                const handle = provider.engine.createSRGBProfile();
                this.#profileHandleCache.set(srcCacheKey, handle);
                return handle;
            }
            return this.#openProfile(/** @type {ArrayBuffer | 'Lab'} */(src));
        });

        // Try multiprofile transform first
        let transform = null;
        try {
            const intents = new Array(profileSources.length - 1).fill(intent);
            transform = provider.createMultiprofileTransform(
                profileHandles, inputFormat, outputFormat, intents, flags
            );
        } catch {
            // createMultiprofileTransform not available — chain fallback handled by caller
            // (content stream converter has chain fallback; images don't need it)
        }

        if (!transform) {
            throw new Error('Failed to create multiprofile color transform');
        }

        const cached = { transform, inputFormat, outputFormat, bpcClampingInitialized: false };

        if (initBPCClamping) {
            const inCh = getChannelsFromFormat(inputFormat);
            const outCh = getChannelsFromFormat(outputFormat);
            if (provider.initBPCClamping(transform, inCh, outCh)) {
                cached.bpcClampingInitialized = true;
            }
        }

        this.#multiprofileTransformCache.set(cacheKey, cached);
        return cached;
    }

    // ========================================
    // Worker Mode Support
    // ========================================

    /**
     * @override
     * @param {import('../pdf-image-color-converter.js').PDFImageColorConverterInput} input
     * @param {import('../color-converter.js').ColorConverterContext} context
     * @returns {import('../color-converter.js').WorkerTask}
     */
    prepareWorkerTask(input, context) {
        const task = super.prepareWorkerTask(input, context);
        const config = this.configuration;
        // Add legacy-specific configuration
        task.useAdaptiveBPCClamping = config.useAdaptiveBPCClamping;
        task.coerceLabAbsoluteZeroPixels = config.coerceLabAbsoluteZeroPixels;
        return task;
    }

    // ========================================
    // Resource Cleanup
    // ========================================

    /**
     * @override
     */
    dispose() {
        const provider = this.colorEngineProvider;

        if (provider) {
            for (const cached of this.#transformCache.values()) {
                try { provider.deleteTransform(cached.transform); } catch { /* ignore */ }
            }
            for (const cached of this.#multiprofileTransformCache.values()) {
                try { provider.deleteTransform(cached.transform); } catch { /* ignore */ }
            }
            for (const handle of this.#profileHandleCache.values()) {
                try { provider.closeProfile(handle); } catch { /* ignore */ }
            }
        }

        this.#transformCache.clear();
        this.#multiprofileTransformCache.clear();
        this.#profileHandleCache.clear();

        super.dispose();
    }
}
