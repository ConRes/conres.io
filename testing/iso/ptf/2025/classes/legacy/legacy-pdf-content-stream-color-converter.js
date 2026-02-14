// @ts-check
/**
 * Legacy PDF Content Stream Color Converter
 *
 * Extends PDFContentStreamColorConverter with legacy engine support:
 * - Consumer-side adaptive BPC clamping (initBPCClamping + doTransformAdaptive)
 * - Conservative multiprofile condition (only when explicitly required by policy)
 * - Multiprofile chain fallback for engines without createMultiprofileTransform
 *
 * For engines up to 2026-01-30.
 *
 * @module LegacyPDFContentStreamColorConverter
 * @author Saleh Abdel Motaal <dev@smotaal.io>
 * @ai Claude Opus 4.6 (code generation)
 */

import { PDFContentStreamColorConverter } from '../pdf-content-stream-color-converter.js';
import { SHOULD_SWAP_16_FROM_BIG_TO_LITTLE_ENDIAN } from '../color-conversion-policy.js';
import {
    TYPE_RGB_8,
    TYPE_RGB_FLT,
} from '../../packages/color-engine/src/index.js';
import {
    ADAPTIVE_BPC_THRESHOLD,
    FORMAT_FLOAT_MASK,
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
 * Legacy configuration extends PDFContentStreamColorConverterConfiguration
 * with legacy-only properties.
 *
 * @typedef {import('../pdf-content-stream-color-converter.js').PDFContentStreamColorConverterConfiguration & {
 *   useAdaptiveBPCClamping?: boolean,
 * }} LegacyPDFContentStreamColorConverterConfiguration
 */

// ============================================================================
// LegacyPDFContentStreamColorConverter Class
// ============================================================================

/**
 * Legacy PDF content stream color converter with consumer-side adaptive BPC
 * and multiprofile chain fallback.
 *
 * @extends PDFContentStreamColorConverter
 */
export class LegacyPDFContentStreamColorConverter extends PDFContentStreamColorConverter {
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
     * @returns {Readonly<LegacyPDFContentStreamColorConverterConfiguration>}
     */
    get configuration() {
        return /** @type {Readonly<LegacyPDFContentStreamColorConverterConfiguration>} */ (super.configuration);
    }

    // ========================================
    // Legacy convertColorsBuffer Override
    // ========================================

    /**
     * Converts a buffer of color values with legacy engine support.
     *
     * Differences from the base class:
     * - Consumer-side adaptive BPC clamping (initBPCClamping + doTransformAdaptive)
     * - Conservative multiprofile condition: only when policy EXPLICITLY sets
     *   `requiresMultiprofileTransform: true` (fixes 2025-12-19 bug where
     *   `true && undefined !== false` evaluates as truthy)
     * - Chain fallback when createMultiprofileTransform is unavailable
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

        // Handle 16-bit SE → Float limitation
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

        // Create output buffer
        const outputPixels = this.policy.createOutputBuffer(outputFormat, pixelCount, outputChannels);

        // Choose transform method
        // CRITICAL FIX for 2025-12-19: Conservative multiprofile condition.
        // Only take multiprofile path when policy EXPLICITLY sets requiresMultiprofileTransform: true.
        // The base class condition `true && undefined !== false` evaluates truthy when the policy
        // doesn't specify, causing engines without createMultiprofileTransform to fail.
        let bpcStats;
        if (evaluationResult.overrides.requiresMultiprofileTransform === true) {
            // Add multiprofile BPC scaling flag if available
            if (evaluationResult.overrides.multiprofileBlackPointScaling && constants.cmsFLAGS_MULTIPROFILE_BLACKPOINT_SCALING) {
                flags |= constants.cmsFLAGS_MULTIPROFILE_BLACKPOINT_SCALING;
            }

            const intermediateProfiles = /** @type {string[]} */ (evaluationResult.overrides.intermediateProfiles ?? []);
            /** @type {(ArrayBuffer | 'Lab' | 'sRGB')[]} */
            const profiles = [sourceProfile, ...intermediateProfiles, destinationProfile];

            try {
                const cached = this.#getOrCreateMultiprofileTransform(
                    profiles, inputFormat, outputFormat, intentConstant, flags, useAdaptiveBPC,
                );

                if (useAdaptiveBPC && cached.bpcClampingInitialized) {
                    bpcStats = provider.doTransformAdaptive(cached.transform, effectiveInputBuffer, outputPixels, pixelCount);
                } else {
                    provider.transformArray(cached.transform, effectiveInputBuffer, outputPixels, pixelCount);
                }
            } catch {
                // createMultiprofileTransform not available — chain fallback
                if (intermediateProfiles.length > 0) {
                    this.#executeChainFallback(
                        sourceProfile, destinationProfile, inputFormat, outputFormat,
                        effectiveInputBuffer, outputPixels, pixelCount,
                        intentConstant, flags, inputChannels, outputChannels,
                    );
                } else {
                    // No intermediates, use single transform
                    const cached = this.#getOrCreateTransform(
                        sourceProfile, destinationProfile, inputFormat, outputFormat,
                        intentConstant, flags, useAdaptiveBPC,
                    );
                    if (useAdaptiveBPC && cached.bpcClampingInitialized) {
                        bpcStats = provider.doTransformAdaptive(cached.transform, effectiveInputBuffer, outputPixels, pixelCount);
                    } else {
                        provider.transformArray(cached.transform, effectiveInputBuffer, outputPixels, pixelCount);
                    }
                }
            }
        } else {
            // Single transform
            const cached = this.#getOrCreateTransform(
                sourceProfile, destinationProfile, inputFormat, outputFormat,
                intentConstant, flags, useAdaptiveBPC,
            );

            if (useAdaptiveBPC && cached.bpcClampingInitialized) {
                bpcStats = provider.doTransformAdaptive(cached.transform, effectiveInputBuffer, outputPixels, pixelCount);
            } else {
                provider.transformArray(cached.transform, effectiveInputBuffer, outputPixels, pixelCount);
            }
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
    // Chain Fallback for Engines without createMultiprofileTransform
    // ========================================

    /**
     * Executes a chained transform as fallback: source → sRGB → destination.
     *
     * Used when createMultiprofileTransform is unavailable (engine 2025-12-19).
     * Creates two single transforms and executes them sequentially with an
     * intermediate sRGB buffer.
     *
     * @param {import('../color-converter.js').ProfileType} sourceProfile
     * @param {import('../color-converter.js').ProfileType} destinationProfile
     * @param {number} inputFormat
     * @param {number} outputFormat
     * @param {Uint8Array | Uint16Array | Float32Array} inputBuffer
     * @param {Uint8Array | Uint16Array | Float32Array} outputPixels
     * @param {number} pixelCount
     * @param {number} intent
     * @param {number} flags
     * @param {number} inputChannels
     * @param {number} outputChannels
     */
    #executeChainFallback(sourceProfile, destinationProfile, inputFormat, outputFormat, inputBuffer, outputPixels, pixelCount, intent, flags, inputChannels, outputChannels) {
        const provider = this.colorEngineProvider;
        if (!provider) throw new Error('ColorEngineProvider not initialized');

        // Choose intermediate format based on input/output bit depth
        const intermediateFormat = isFloatFormat(inputFormat) || isFloatFormat(outputFormat)
            ? TYPE_RGB_FLT
            : TYPE_RGB_8;

        const intermediateChannels = 3; // sRGB always 3 channels

        // Create intermediate buffer
        const intermediatePixels = isFloatFormat(intermediateFormat)
            ? new Float32Array(pixelCount * intermediateChannels)
            : new Uint8Array(pixelCount * intermediateChannels);

        // Transform 1: source → sRGB
        const cached1 = this.#getOrCreateTransform(
            sourceProfile, 'sRGB', inputFormat, intermediateFormat, intent, flags,
        );
        provider.transformArray(cached1.transform, inputBuffer, intermediatePixels, pixelCount);

        // Transform 2: sRGB → destination
        const cached2 = this.#getOrCreateTransform(
            'sRGB', destinationProfile, intermediateFormat, outputFormat, intent, flags,
        );
        provider.transformArray(cached2.transform, intermediatePixels, outputPixels, pixelCount);
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
     * Gets or creates a cached multiprofile transform.
     * Throws if createMultiprofileTransform is not available (caller handles chain fallback).
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

        // Throws if createMultiprofileTransform is not available
        const intents = new Array(profileSources.length - 1).fill(intent);
        const transform = provider.createMultiprofileTransform(
            profileHandles, inputFormat, outputFormat, intents, flags
        );

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
     * @param {import('../pdf-content-stream-color-converter.js').PDFContentStreamColorConverterInput} input
     * @param {import('../color-converter.js').ColorConverterContext} context
     * @returns {import('../color-converter.js').WorkerTask}
     */
    prepareWorkerTask(input, context) {
        const task = super.prepareWorkerTask(input, context);
        const config = this.configuration;
        task.useAdaptiveBPCClamping = config.useAdaptiveBPCClamping;
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
