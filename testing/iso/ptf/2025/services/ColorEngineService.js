// @ts-check
/**
 * Color Engine Service
 * 
 * This service provides color conversion functionality to replace the Adobe Acrobat dependency.
 * It integrates with the ConRes Color Engine for accurate ICC profile-based color transformations.
 * 
 * @module ColorEngineService
 */

import { PDFDocument, PDFName } from "../packages/pdf-lib/pdf-lib.esm.js";
import {
    analyzeColorSpaces,
    isICCBasedColorSpace,
    getICCProfileRefFromColorSpace,
    parseICCProfileFromRef,
    getDeviceColorSpaceForICC,
} from "./ColorSpaceUtils.js";

import { ICCService } from "./ICCService.js";

import * as LittleCMS from '../packages/color-engine/src/index.js';

/**
 * @typedef {'perceptual' | 'relative-colorimetric' | 'saturation' | 'absolute-colorimetric' | 'preserve-k-only-relative-colorimetric-gcr'} RenderingIntent
 */

/**
 * @typedef {{
 *   sourceProfile: string | ArrayBuffer,
 *   destinationProfile: string | ArrayBuffer,
 *   renderingIntent: RenderingIntent,
 *   blackPointCompensation?: boolean,
 *   useAdaptiveBPCClamping?: boolean,
 * }} ColorConversionOptions
 */

/** Threshold for adaptive BPC clamping optimization (2 megapixels) */
const ADAPTIVE_BPC_THRESHOLD = 2 * 1024 * 1024;

/**
 * @typedef {{
 *   type: 'CMYK' | 'RGB' | 'Lab' | 'Gray',
 *   values: number[],
 * }} ColorValue
 */

/**
 * @typedef {{
 *   input: ColorValue,
 *   output: ColorValue,
 *   sourceProfile: string,
 *   destinationProfile: string,
 * }} ColorConversionResult
 */

/**
 * Service for color conversion operations using ICC profiles.
 * This is a stub implementation that will be connected to the ConRes Color Engine.
 */
export class ColorEngineService {
    /** @type {Map<string, ArrayBuffer>} */
    #profileCache = new Map();

    /** @type {Map<string, any>} Cache for opened profile handles */
    #profileHandleCache = new Map();

    /** @type {Map<string, {transform: any, inputFormat: number, outputFormat: number, bpcClampingInitialized?: boolean}>} Cache for transforms */
    #transformCache = new Map();

    /** @type {Map<string, {transform: any, inputFormat: number, outputFormat: number, bpcClampingInitialized?: boolean}>} Cache for multiprofile transforms */
    #multiprofileTransformCache = new Map();

    /** @type {RenderingIntent} */
    #defaultRenderingIntent = 'relative-colorimetric';

    /** @type {boolean} */
    #defaultBlackPointCompensation = true;

    /** @type {boolean} */
    #defaultAdaptiveBPCClamping = true;

    /** @type {LittleCMS.ColorEngine?} */
    #colorEngine = null;

    /** @type {Promise<void>} */
    #colorEngineReady;

    /**
     * Creates a new ColorEngineService instance
     * @param {object} [options]
     * @param {RenderingIntent} [options.defaultRenderingIntent]
     * @param {boolean} [options.defaultBlackPointCompensation]
     * @param {boolean} [options.defaultAdaptiveBPCClamping] - Enable adaptive BPC clamping for large images (default: true)
     * @param {LittleCMS.ColorEngine} [options.colorEngineInstance] - Optional custom Color Engine instance
     */
    constructor(options = {}) {
        if (options.defaultRenderingIntent) {
            this.#defaultRenderingIntent = options.defaultRenderingIntent;
        }
        if (options.defaultBlackPointCompensation !== undefined) {
            this.#defaultBlackPointCompensation = options.defaultBlackPointCompensation;
        }
        if (options.defaultAdaptiveBPCClamping !== undefined) {
            this.#defaultAdaptiveBPCClamping = options.defaultAdaptiveBPCClamping;
        }
        if (options.colorEngineInstance) {
            this.#colorEngine = options.colorEngineInstance;
            this.#colorEngineReady = Promise.resolve();
        } else {
            this.#colorEngineReady = this.#initializeColorEngine();
        }
    }

    async #initializeColorEngine() {
        this.#colorEngine = await LittleCMS.createEngine();
    }

    /** @type {Set<string>} */
    static BUILTIN_PROFILES = new Set(['sRGB', 'sGray', 'Lab']);

    /**
     * Loads an ICC profile from a URL, buffer, or built-in identifier
     * @param {string | ArrayBuffer} source - URL, ArrayBuffer, or built-in identifier ('sRGB', 'sGray', 'Lab')
     * @returns {Promise<ArrayBuffer | 'sRGB' | 'sGray' | 'Lab'>}
     */
    async loadProfile(source) {
        if (source instanceof ArrayBuffer) {
            return source;
        }

        // Handle built-in profile identifiers
        if (ColorEngineService.BUILTIN_PROFILES.has(source)) {
            return /** @type {'sRGB' | 'sGray' | 'Lab'} */ (source);
        }

        // Check cache first
        if (this.#profileCache.has(source)) {
            return /** @type {ArrayBuffer} */ (this.#profileCache.get(source));
        }

        // Fetch from URL
        const response = await fetch(source);
        if (!response.ok) {
            throw new Error(`Failed to load ICC profile from ${source}: ${response.statusText}`);
        }

        const buffer = await response.arrayBuffer();
        this.#profileCache.set(source, buffer);
        return buffer;
    }

    /**
     * Generates a cache key for a profile source
     * @param {ArrayBuffer | 'sRGB' | 'sGray' | 'Lab'} source
     * @returns {string}
     */
    #getProfileCacheKey(source) {
        if (typeof source === 'string') {
            return source;
        }
        // For ArrayBuffer, use byteLength and first/last bytes as key
        // This is a simple hash - collisions are unlikely for ICC profiles
        const view = new Uint8Array(source);
        const hash = `buf:${source.byteLength}:${view[0]}:${view[view.length - 1]}`;
        return hash;
    }

    /**
     * Opens a profile handle from a source (buffer or built-in identifier)
     * Uses caching to avoid re-opening the same profile multiple times
     * @param {ArrayBuffer | 'sRGB' | 'sGray' | 'Lab'} source
     * @returns {any} Profile handle
     */
    #openProfile(source) {
        const colorEngine = this.#colorEngine;
        if (!colorEngine) {
            throw new Error('ColorEngine not initialized');
        }

        // Check cache first
        const cacheKey = this.#getProfileCacheKey(source);
        if (this.#profileHandleCache.has(cacheKey)) {
            return this.#profileHandleCache.get(cacheKey);
        }

        // Create new profile handle
        let handle;
        if (source === 'sRGB') {
            handle = colorEngine.createSRGBProfile();
        } else if (source === 'sGray') {
            // Use gamma 2.2 Gray profile for grayscale
            handle = colorEngine.createGray2Profile();
        } else if (source === 'Lab') {
            handle = colorEngine.createLab4Profile();
        } else {
            handle = colorEngine.openProfileFromMem(new Uint8Array(source));
        }

        // Cache the handle
        this.#profileHandleCache.set(cacheKey, handle);
        return handle;
    }

    /**
     * Generates a cache key for a transform
     * @param {string} srcKey - Source profile cache key
     * @param {string} dstKey - Destination profile cache key
     * @param {number} inputFormat - Input pixel format
     * @param {number} outputFormat - Output pixel format
     * @param {number} intent - Rendering intent
     * @param {number} flags - Transform flags
     * @returns {string}
     */
    #getTransformCacheKey(srcKey, dstKey, inputFormat, outputFormat, intent, flags) {
        return `${srcKey}|${dstKey}|${inputFormat}|${outputFormat}|${intent}|${flags}`;
    }

    /**
     * Gets number of channels for a pixel format
     * @param {number} format - LittleCMS pixel format constant
     * @returns {number} Number of channels
     */
    #getChannelsFromFormat(format) {
        // Extract channels from format: CHANNELS_SH is at bits 3-6
        return ((format >> 3) & 0xF);
    }

    /**
     * Gets or creates a cached transform
     * @param {ArrayBuffer | 'sRGB' | 'sGray' | 'Lab'} sourceProfileSource
     * @param {ArrayBuffer | 'sRGB' | 'sGray' | 'Lab'} destProfileSource
     * @param {number} inputFormat
     * @param {number} outputFormat
     * @param {number} intent
     * @param {number} flags
     * @param {boolean} [initBPCClamping=false] - Initialize BPC clamping for this transform
     * @returns {{transform: any, inputFormat: number, outputFormat: number, bpcClampingInitialized?: boolean}}
     */
    #getOrCreateTransform(sourceProfileSource, destProfileSource, inputFormat, outputFormat, intent, flags, initBPCClamping = false) {
        const colorEngine = this.#colorEngine;
        if (!colorEngine) {
            throw new Error('ColorEngine not initialized');
        }

        const srcKey = this.#getProfileCacheKey(sourceProfileSource);
        const dstKey = this.#getProfileCacheKey(destProfileSource);
        const cacheKey = this.#getTransformCacheKey(srcKey, dstKey, inputFormat, outputFormat, intent, flags);

        // Check cache first
        if (this.#transformCache.has(cacheKey)) {
            const cached = this.#transformCache.get(cacheKey);
            // Initialize BPC clamping if requested and not already done
            if (initBPCClamping && !cached.bpcClampingInitialized && colorEngine.initBPCClamping) {
                try {
                    const inputChannels = this.#getChannelsFromFormat(inputFormat);
                    const outputChannels = this.#getChannelsFromFormat(outputFormat);
                    colorEngine.initBPCClamping(cached.transform, inputChannels, outputChannels);
                    cached.bpcClampingInitialized = true;
                } catch (e) {
                    // BPC clamping initialization failed, continue without it
                }
            }
            return cached;
        }

        // Create new transform
        const sourceProfile = this.#openProfile(sourceProfileSource);
        const destProfile = this.#openProfile(destProfileSource);

        const transform = colorEngine.createTransform(
            sourceProfile,
            inputFormat,
            destProfile,
            outputFormat,
            intent,
            flags
        );

        if (!transform) {
            throw new Error('Failed to create color transform');
        }

        // Cache the transform
        const cached = { transform, inputFormat, outputFormat, bpcClampingInitialized: false };

        // Initialize BPC clamping if requested
        if (initBPCClamping && colorEngine.initBPCClamping) {
            try {
                const inputChannels = this.#getChannelsFromFormat(inputFormat);
                const outputChannels = this.#getChannelsFromFormat(outputFormat);
                colorEngine.initBPCClamping(transform, inputChannels, outputChannels);
                cached.bpcClampingInitialized = true;
            } catch (e) {
                // BPC clamping initialization failed, continue without it
            }
        }

        this.#transformCache.set(cacheKey, cached);
        return cached;
    }

    /**
     * Gets or creates a cached multiprofile transform using createMultiprofileTransform.
     * This chains 2+ profiles in a single transform operation.
     *
     * @param {(ArrayBuffer | 'sRGB' | 'sGray' | 'Lab')[]} profileSources - Array of profile sources to chain
     * @param {number} inputFormat - Input pixel format
     * @param {number} outputFormat - Output pixel format
     * @param {number} intent - Rendering intent
     * @param {number} flags - Transform flags
     * @param {boolean} [initBPCClamping=false] - Initialize BPC clamping for this transform
     * @returns {{transform: any, inputFormat: number, outputFormat: number, bpcClampingInitialized?: boolean}}
     */
    #getOrCreateMultiprofileTransform(profileSources, inputFormat, outputFormat, intent, flags, initBPCClamping = false) {
        const colorEngine = this.#colorEngine;
        if (!colorEngine) {
            throw new Error('ColorEngine not initialized');
        }

        if (!colorEngine.createMultiprofileTransform) {
            throw new Error('createMultiprofileTransform not available in this Color Engine version');
        }

        // Build cache key from all profile keys
        const profileKeys = profileSources.map(src => this.#getProfileCacheKey(src));
        const cacheKey = `multi:${profileKeys.join('|')}|${inputFormat}|${outputFormat}|${intent}|${flags}`;

        // Check cache first
        const existingCached = this.#multiprofileTransformCache.get(cacheKey);
        if (existingCached) {
            // Initialize BPC clamping if requested and not already done
            if (initBPCClamping && !existingCached.bpcClampingInitialized && colorEngine.initBPCClamping) {
                try {
                    const inputChannels = this.#getChannelsFromFormat(inputFormat);
                    const outputChannels = this.#getChannelsFromFormat(outputFormat);
                    colorEngine.initBPCClamping(existingCached.transform, inputChannels, outputChannels);
                    existingCached.bpcClampingInitialized = true;
                } catch (e) {
                    // BPC clamping initialization failed, continue without it
                }
            }
            return existingCached;
        }

        // Open all profiles
        const profileHandles = profileSources.map(src => this.#openProfile(src));

        // Create multiprofile transform
        const transform = colorEngine.createMultiprofileTransform(
            profileHandles,
            inputFormat,
            outputFormat,
            intent,
            flags
        );

        if (!transform) {
            throw new Error('Failed to create multiprofile color transform');
        }

        // Cache the transform
        const cached = { transform, inputFormat, outputFormat, bpcClampingInitialized: false };

        // Initialize BPC clamping if requested
        if (initBPCClamping && colorEngine.initBPCClamping) {
            try {
                const inputChannels = this.#getChannelsFromFormat(inputFormat);
                const outputChannels = this.#getChannelsFromFormat(outputFormat);
                colorEngine.initBPCClamping(transform, inputChannels, outputChannels);
                cached.bpcClampingInitialized = true;
            } catch (e) {
                // BPC clamping initialization failed, continue without it
            }
        }

        this.#multiprofileTransformCache.set(cacheKey, cached);
        return cached;
    }

    /**
     * Disposes of all cached resources
     * Call this when done with the ColorEngineService to free WASM memory
     */
    dispose() {
        const colorEngine = this.#colorEngine;
        if (!colorEngine) return;

        // Delete all cached transforms
        for (const cached of this.#transformCache.values()) {
            try {
                colorEngine.deleteTransform(cached.transform);
            } catch (e) {
                // Ignore errors during cleanup
            }
        }
        this.#transformCache.clear();

        // Delete all cached multiprofile transforms
        for (const cached of this.#multiprofileTransformCache.values()) {
            try {
                colorEngine.deleteTransform(cached.transform);
            } catch (e) {
                // Ignore errors during cleanup
            }
        }
        this.#multiprofileTransformCache.clear();

        // Close all cached profile handles
        for (const handle of this.#profileHandleCache.values()) {
            try {
                colorEngine.closeProfile(handle);
            } catch (e) {
                // Ignore errors during cleanup
            }
        }
        this.#profileHandleCache.clear();
    }

    /**
     * Gets the output color type for a profile source
     * @param {ArrayBuffer | 'sRGB' | 'sGray' | 'Lab'} source
     * @returns {'CMYK' | 'RGB' | 'Lab' | 'Gray'}
     */
    #getOutputTypeForProfile(source) {
        if (source === 'sRGB') return 'RGB';
        if (source === 'sGray') return 'Gray';
        if (source === 'Lab') return 'Lab';
        // For ArrayBuffer, parse the header
        const header = ICCService.parseICCHeaderFromSource(new Uint8Array(source));
        return this.#getColorTypeFromHeader(header);
    }

    /**
     * Maps rendering intent string to LittleCMS constant
     * @param {RenderingIntent} intent
     * @returns {number}
     */
    #getRenderingIntentConstant(intent) {
        switch (intent) {
            case 'perceptual': return LittleCMS.INTENT_PERCEPTUAL;
            case 'relative-colorimetric': return LittleCMS.INTENT_RELATIVE_COLORIMETRIC;
            case 'saturation': return LittleCMS.INTENT_SATURATION;
            case 'absolute-colorimetric': return LittleCMS.INTENT_ABSOLUTE_COLORIMETRIC;
            case 'preserve-k-only-relative-colorimetric-gcr': return LittleCMS.INTENT_PRESERVE_K_ONLY_RELATIVE_COLORIMETRIC_GCR;
            default: return LittleCMS.INTENT_RELATIVE_COLORIMETRIC;
        }
    }

    /**
     * Gets pixel format constant for a color type
     * @param {'CMYK' | 'RGB' | 'Lab' | 'Gray'} type
     * @returns {number}
     */
    #getPixelFormat(type) {
        switch (type) {
            case 'CMYK': return LittleCMS.TYPE_CMYK_8;
            case 'RGB': return LittleCMS.TYPE_RGB_8;
            case 'Lab': return LittleCMS.TYPE_Lab_8;
            case 'Gray': return LittleCMS.TYPE_GRAY_8;
            default: throw new Error(`Unsupported color type: ${type}`);
        }
    }

    /**
     * Determines output color type from ICC profile header
     * @param {ReturnType<typeof ICCService.parseICCHeaderFromSource>} header
     * @returns {'CMYK' | 'RGB' | 'Lab' | 'Gray'}
     */
    #getColorTypeFromHeader(header) {
        switch (header.colorSpace) {
            case 'CMYK': return 'CMYK';
            case 'RGB': return 'RGB';
            case 'Lab': return 'Lab';
            case 'GRAY': return 'Gray';
            default: throw new Error(`Unsupported ICC color space: ${header.colorSpace}`);
        }
    }

    /**
     * Converts a single color value from one color space to another.
     * This is a convenience wrapper around convertColors for single-color conversion.
     *
     * @param {ColorValue} color - The color to convert
     * @param {ColorConversionOptions} options - Conversion options
     * @returns {Promise<ColorConversionResult>}
     *
     * @example
     * ```javascript
     * const engine = new ColorEngineService();
     * const result = await engine.convertColor(
     *   { type: 'CMYK', values: [1, 0, 0, 0] },
     *   {
     *     sourceProfile: 'ISOcoated_v2_300_eci.icc',
     *     destinationProfile: 'sRGB.icc',
     *     renderingIntent: 'relative-colorimetric',
     *   }
     * );
     * console.log(result.output); // { type: 'RGB', values: [0, 159, 227] }
     * ```
     */
    async convertColor(color, options) {
        const results = await this.convertColors([color], options);
        return results[0];
    }

    /**
     * Converts multiple colors in batch using a single transform operation.
     * This is the primary color conversion method - all colors are processed
     * in a single doTransform call for maximum efficiency.
     *
     * All colors in the batch must be the same type (RGB, Gray, CMYK, or Lab).
     * Gray colors with sGray source profile are automatically expanded to RGB.
     *
     * @param {ColorValue[]} colors - Array of colors to convert (must all be same type)
     * @param {ColorConversionOptions} options - Conversion options
     * @returns {Promise<ColorConversionResult[]>}
     *
     * @example
     * ```javascript
     * const engine = new ColorEngineService();
     * const results = await engine.convertColors(
     *   [
     *     { type: 'RGB', values: [255, 0, 0] },
     *     { type: 'RGB', values: [0, 255, 0] },
     *     { type: 'RGB', values: [0, 0, 255] },
     *   ],
     *   {
     *     sourceProfile: 'sRGB',
     *     destinationProfile: cmykProfileBuffer,
     *     renderingIntent: 'relative-colorimetric',
     *   }
     * );
     * // Single doTransform call processes all 3 colors
     * ```
     */
    async convertColors(colors, options) {
        if (colors.length === 0) {
            return [];
        }

        await this.#colorEngineReady;

        const colorEngine = this.#colorEngine;
        if (!colorEngine) {
            throw new Error('ColorEngine not initialized');
        }

        // Load profiles (may return built-in identifier strings or ArrayBuffers)
        const sourceProfileSource = await this.loadProfile(options.sourceProfile);
        const destProfileSource = await this.loadProfile(options.destinationProfile);

        // Determine output type from destination profile
        const outputType = this.#getOutputTypeForProfile(destProfileSource);

        // Determine effective input type from first color
        // All colors should be the same type for batch processing
        const firstColor = colors[0];
        let effectiveInputType = firstColor.type;
        let effectiveSourceProfile = sourceProfileSource;
        const expandGray = firstColor.type === 'Gray' && sourceProfileSource === 'sGray';

        if (expandGray) {
            // Gray colors will be expanded to RGB (R=G=B) using sRGB profile
            effectiveInputType = 'RGB';
            effectiveSourceProfile = 'sRGB';
        }

        // Get pixel formats
        const inputFormat = this.#getPixelFormat(effectiveInputType);
        const outputFormat = this.#getPixelFormat(outputType);

        // Get rendering intent and flags
        const intent = this.#getRenderingIntentConstant(options.renderingIntent || this.#defaultRenderingIntent);
        const useBPC = options.blackPointCompensation ?? this.#defaultBlackPointCompensation;
        const flags = useBPC ? LittleCMS.cmsFLAGS_BLACKPOINTCOMPENSATION : 0;

        // Get or create cached transform
        const cached = this.#getOrCreateTransform(
            effectiveSourceProfile,
            destProfileSource,
            inputFormat,
            outputFormat,
            intent,
            flags
        );

        // Calculate buffer sizes
        const inputChannels = effectiveInputType === 'CMYK' ? 4 : effectiveInputType === 'Gray' ? 1 : 3;
        const outputChannels = outputType === 'CMYK' ? 4 : outputType === 'Gray' ? 1 : 3;
        const pixelCount = colors.length;

        // Allocate batch buffers
        const inputBuffer = new Uint8Array(inputChannels * pixelCount);
        const outputBuffer = new Uint8Array(outputChannels * pixelCount);

        // Pack all input colors into the buffer
        for (let i = 0; i < pixelCount; i++) {
            const color = colors[i];
            let effectiveValues = color.values;

            // Handle Gray->RGB expansion
            if (expandGray) {
                const grayValue = color.values[0] ?? 0;
                effectiveValues = [grayValue * 255, grayValue * 255, grayValue * 255];
            }

            const offset = i * inputChannels;
            for (let j = 0; j < inputChannels; j++) {
                const val = effectiveValues[j] ?? 0;
                if (effectiveInputType === 'RGB') {
                    inputBuffer[offset + j] = Math.round(Math.max(0, Math.min(255, val)));
                } else if (effectiveInputType === 'Lab') {
                    // Lab encoding: L* 0-100 -> 0-255, a*/b* -128 to 127 -> 0-255
                    if (j === 0) {
                        inputBuffer[offset + j] = Math.round((val / 100) * 255);
                    } else {
                        inputBuffer[offset + j] = Math.round(val + 128);
                    }
                } else {
                    // CMYK and Gray are typically 0-1
                    inputBuffer[offset + j] = Math.round(val * 255);
                }
            }
        }

        // Execute single batch transform for all colors
        colorEngine.transformArray(cached.transform, inputBuffer, outputBuffer, pixelCount);

        // Unpack results from output buffer
        /** @type {ColorConversionResult[]} */
        const results = [];
        const sourceProfileName = typeof options.sourceProfile === 'string' ? options.sourceProfile : 'buffer';
        const destProfileName = typeof options.destinationProfile === 'string' ? options.destinationProfile : 'buffer';

        for (let i = 0; i < pixelCount; i++) {
            const offset = i * outputChannels;
            /** @type {number[]} */
            const outputValues = [];

            for (let j = 0; j < outputChannels; j++) {
                if (outputType === 'RGB') {
                    outputValues.push(outputBuffer[offset + j]);
                } else if (outputType === 'Lab') {
                    if (j === 0) {
                        outputValues.push((outputBuffer[offset + j] / 255) * 100);
                    } else {
                        outputValues.push(outputBuffer[offset + j] - 128);
                    }
                } else {
                    // CMYK and Gray - convert to 0-1
                    outputValues.push(outputBuffer[offset + j] / 255);
                }
            }

            results.push({
                input: colors[i],
                output: { type: outputType, values: outputValues },
                sourceProfile: sourceProfileName,
                destinationProfile: destProfileName,
            });
        }

        return results;
    }

    /**
     * Converts a raw pixel buffer using a single doTransform call.
     * This is optimized for image conversion where pixels are already in raw byte format.
     *
     * For large images (≥2 megapixels) with BPC enabled, uses adaptive BPC clamping
     * which can significantly speed up processing of binary masks (pure black/white images).
     *
     * @param {Uint8Array} inputPixels - Input pixel data (e.g., RGB: [r,g,b,r,g,b,...] or Gray: [g,g,...])
     * @param {object} options - Conversion options
     * @param {ArrayBuffer | string} options.sourceProfile - Source ICC profile
     * @param {ArrayBuffer | string} options.destinationProfile - Destination ICC profile
     * @param {'RGB' | 'Gray' | 'CMYK' | 'Lab'} options.inputType - Input color type
     * @param {'RGB' | 'Gray' | 'CMYK' | 'Lab'} [options.outputType] - Output color type (auto-detected from dest profile if not specified)
     * @param {RenderingIntent} [options.renderingIntent] - Rendering intent
     * @param {boolean} [options.blackPointCompensation] - Whether to use black point compensation
     * @param {boolean} [options.useAdaptiveBPCClamping] - Use adaptive BPC clamping for large images (default: true)
     * @returns {Promise<{ outputPixels: Uint8Array, pixelCount: number, inputChannels: number, outputChannels: number, bpcStats?: {transformedCount: number, blackCount: number, whiteCount: number, optimizationSkipped: boolean} }>}
     *
     * @example
     * ```javascript
     * const engine = new ColorEngineService();
     * // Convert 1000 RGB pixels to CMYK
     * const rgbPixels = new Uint8Array(1000 * 3); // 3 bytes per RGB pixel
     * const result = await engine.convertPixelBuffer(rgbPixels, {
     *     sourceProfile: sRGBBuffer,
     *     destinationProfile: cmykProfileBuffer,
     *     inputType: 'RGB',
     * });
     * // result.outputPixels has 1000 * 4 bytes (4 bytes per CMYK pixel)
     * ```
     */
    async convertPixelBuffer(inputPixels, options) {
        await this.#colorEngineReady;

        const colorEngine = this.#colorEngine;
        if (!colorEngine) {
            throw new Error('ColorEngine not initialized');
        }

        // Load profiles
        const sourceProfileSource = await this.loadProfile(options.sourceProfile);
        const destProfileSource = await this.loadProfile(options.destinationProfile);

        // Determine types
        const inputType = options.inputType;
        const outputType = options.outputType ?? this.#getOutputTypeForProfile(destProfileSource);

        // Calculate channels
        const inputChannels = inputType === 'CMYK' ? 4 : inputType === 'Gray' ? 1 : 3;
        const outputChannels = outputType === 'CMYK' ? 4 : outputType === 'Gray' ? 1 : 3;
        const pixelCount = Math.floor(inputPixels.length / inputChannels);

        // Get pixel formats
        const inputFormat = this.#getPixelFormat(inputType);
        const outputFormat = this.#getPixelFormat(outputType);

        // Get rendering intent and flags
        const intent = this.#getRenderingIntentConstant(options.renderingIntent || this.#defaultRenderingIntent);
        const useBPC = options.blackPointCompensation ?? this.#defaultBlackPointCompensation;
        const flags = useBPC ? LittleCMS.cmsFLAGS_BLACKPOINTCOMPENSATION : 0;

        // Check if adaptive BPC clamping should be used
        const useAdaptiveBPC = (options.useAdaptiveBPCClamping ?? this.#defaultAdaptiveBPCClamping) &&
            useBPC &&
            pixelCount >= ADAPTIVE_BPC_THRESHOLD &&
            colorEngine.doTransformAdaptive;

        // Get or create cached transform (with BPC clamping initialized if needed)
        const cached = this.#getOrCreateTransform(
            sourceProfileSource,
            destProfileSource,
            inputFormat,
            outputFormat,
            intent,
            flags,
            useAdaptiveBPC // Initialize BPC clamping if we'll use adaptive transform
        );

        // Allocate output buffer
        const outputPixels = new Uint8Array(pixelCount * outputChannels);

        // Choose transform method based on settings
        let bpcStats;
        if (useAdaptiveBPC && cached.bpcClampingInitialized) {
            // Use adaptive transform for large images with BPC enabled
            bpcStats = colorEngine.doTransformAdaptive(cached.transform, inputPixels, outputPixels, pixelCount);
        } else {
            // Standard transform
            colorEngine.transformArray(cached.transform, inputPixels, outputPixels, pixelCount);
        }

        return {
            outputPixels,
            pixelCount,
            inputChannels,
            outputChannels,
            bpcStats,
        };
    }

    /**
     * Converts a raw pixel buffer using a multiprofile transform (chaining 2+ profiles).
     * This is useful when intermediate color spaces are needed in the conversion chain.
     *
     * Transform notation: `<Input> → <Intermediate> → <Output> (Multi)` with K-Only GCR
     *
     * @param {Uint8Array} inputPixels - Input pixel data
     * @param {object} options - Conversion options
     * @param {(ArrayBuffer | string)[]} options.profiles - Array of ICC profiles to chain (source → ... → destination)
     * @param {'RGB' | 'Gray' | 'CMYK' | 'Lab'} options.inputType - Input color type
     * @param {'RGB' | 'Gray' | 'CMYK' | 'Lab'} [options.outputType] - Output color type (auto-detected from last profile if not specified)
     * @param {RenderingIntent} [options.renderingIntent] - Rendering intent
     * @param {boolean} [options.blackPointCompensation] - Whether to use black point compensation
     * @param {boolean} [options.useAdaptiveBPCClamping] - Use adaptive BPC clamping for large images (default: true)
     * @returns {Promise<{ outputPixels: Uint8Array, pixelCount: number, inputChannels: number, outputChannels: number, bpcStats?: {transformedCount: number, blackCount: number, whiteCount: number, optimizationSkipped: boolean} }>}
     *
     * @example
     * ```javascript
     * const engine = new ColorEngineService();
     * // Convert Gray ICC → sRGB → CMYK using multiprofile transform
     * const result = await engine.convertPixelBufferMultiprofile(grayPixels, {
     *     profiles: [grayICCBuffer, 'sRGB', cmykProfileBuffer],
     *     inputType: 'Gray',
     *     renderingIntent: 'preserve-k-only-relative-colorimetric-gcr',
     * });
     * ```
     */
    async convertPixelBufferMultiprofile(inputPixels, options) {
        await this.#colorEngineReady;

        const colorEngine = this.#colorEngine;
        if (!colorEngine) {
            throw new Error('ColorEngine not initialized');
        }

        if (options.profiles.length < 2) {
            throw new Error('Multiprofile transform requires at least 2 profiles');
        }

        // Load all profiles
        /** @type {(ArrayBuffer | 'sRGB' | 'sGray' | 'Lab')[]} */
        const profileSources = [];
        for (const profile of options.profiles) {
            profileSources.push(await this.loadProfile(profile));
        }

        // Determine types
        const inputType = options.inputType;
        const lastProfileSource = profileSources[profileSources.length - 1];
        const outputType = options.outputType ?? this.#getOutputTypeForProfile(lastProfileSource);

        // Calculate channels
        const inputChannels = inputType === 'CMYK' ? 4 : inputType === 'Gray' ? 1 : 3;
        const outputChannels = outputType === 'CMYK' ? 4 : outputType === 'Gray' ? 1 : 3;
        const pixelCount = Math.floor(inputPixels.length / inputChannels);

        // Get pixel formats
        const inputFormat = this.#getPixelFormat(inputType);
        const outputFormat = this.#getPixelFormat(outputType);

        // Get rendering intent and flags
        const intent = this.#getRenderingIntentConstant(options.renderingIntent || this.#defaultRenderingIntent);
        const useBPC = options.blackPointCompensation ?? this.#defaultBlackPointCompensation;
        const flags = useBPC ? LittleCMS.cmsFLAGS_BLACKPOINTCOMPENSATION : 0;

        // Check if adaptive BPC clamping should be used
        const useAdaptiveBPC = (options.useAdaptiveBPCClamping ?? this.#defaultAdaptiveBPCClamping) &&
            useBPC &&
            pixelCount >= ADAPTIVE_BPC_THRESHOLD &&
            colorEngine.doTransformAdaptive;

        // Get or create cached multiprofile transform
        const cached = this.#getOrCreateMultiprofileTransform(
            profileSources,
            inputFormat,
            outputFormat,
            intent,
            flags,
            useAdaptiveBPC
        );

        // Allocate output buffer
        const outputPixels = new Uint8Array(pixelCount * outputChannels);

        // Choose transform method based on settings
        let bpcStats;
        if (useAdaptiveBPC && cached.bpcClampingInitialized) {
            // Use adaptive transform for large images with BPC enabled
            bpcStats = colorEngine.doTransformAdaptive(cached.transform, inputPixels, outputPixels, pixelCount);
        } else {
            // Standard transform
            colorEngine.transformArray(cached.transform, inputPixels, outputPixels, pixelCount);
        }

        return {
            outputPixels,
            pixelCount,
            inputChannels,
            outputChannels,
            bpcStats,
        };
    }

    /**
     * Converts colors within a PDF document from ICC-based to device color spaces.
     * This is similar to decalibratePDFDocument but provides more control over the conversion.
     *
     * @param {PDFDocument} pdfDocument
     * @param {object} [options]
     * @param {string | ArrayBuffer} [options.destinationProfile] - Target profile for conversion
     * @param {RenderingIntent} [options.renderingIntent]
     * @param {boolean} [options.preserveOriginal] - Whether to keep original color space references
     */
    async convertPDFColors(pdfDocument, options = {}) {
        const analysisResult = analyzeColorSpaces(pdfDocument);
        const { colorSpaceDesignationTargetsLookup } = analysisResult;

        let conversions = 0;
        const stats = {
            totalColorSpaces: 0,
            iccBasedColorSpaces: 0,
            convertedColorSpaces: 0,
        };
        // let elements = 0;

        const operations = [];

        for (const [colorSpaceDescriptor, designations] of colorSpaceDesignationTargetsLookup) {
            if (!isICCBasedColorSpace(/** @type {import('pdf-lib').PDFArray} */(colorSpaceDescriptor))) {
                continue;
            }

            // Get ICC profile info
            const profileRef = getICCProfileRefFromColorSpace(/** @type {import('pdf-lib').PDFArray} */(colorSpaceDescriptor));
            if (!profileRef) continue;

            const profile = parseICCProfileFromRef(pdfDocument, profileRef);
            if (!profile) continue;

            // Determine target device color space
            const deviceColorSpace = getDeviceColorSpaceForICC(profile.header.colorSpace);
            if (!deviceColorSpace) continue;

            // Apply conversion to each designation
            for (const designation of designations) {
                // TODO: Actually convert color values, not just replace color spaces
                // For now, this is equivalent to decalibration
                operations.push({
                    colorSpaceDescriptor,
                    designation,
                    targetColorSpace: deviceColorSpace,
                });
                // conversions++;
            }
        }

        return { document: pdfDocument, stats, operations, analysisResult };
    }

    /**
     * Gets the default rendering intent
     * @returns {RenderingIntent}
     */
    get defaultRenderingIntent() {
        return this.#defaultRenderingIntent;
    }

    /**
     * Sets the default rendering intent
     * @param {RenderingIntent} intent
     */
    set defaultRenderingIntent(intent) {
        this.#defaultRenderingIntent = intent;
    }

    /**
     * Gets the default black point compensation setting
     * @returns {boolean}
     */
    get defaultBlackPointCompensation() {
        return this.#defaultBlackPointCompensation;
    }

    /**
     * Sets the default black point compensation setting
     * @param {boolean} value
     */
    set defaultBlackPointCompensation(value) {
        this.#defaultBlackPointCompensation = value;
    }

    /**
     * Gets the default adaptive BPC clamping setting
     * When enabled, large images (≥2MP) with BPC use adaptive clamping
     * which speeds up processing of binary masks (pure black/white images)
     * @returns {boolean}
     */
    get defaultAdaptiveBPCClamping() {
        return this.#defaultAdaptiveBPCClamping;
    }

    /**
     * Sets the default adaptive BPC clamping setting
     * @param {boolean} value
     */
    set defaultAdaptiveBPCClamping(value) {
        this.#defaultAdaptiveBPCClamping = value;
    }
}

/**
 * Rendering intent constants for convenience
 */
export const RenderingIntents = /** @type {const} */ ({
    PERCEPTUAL: /** @type {'perceptual'} */ ('perceptual'),
    RELATIVE_COLORIMETRIC: /** @type {'relative-colorimetric'} */ ('relative-colorimetric'),
    SATURATION: /** @type {'saturation'} */ ('saturation'),
    ABSOLUTE_COLORIMETRIC: /** @type {'absolute-colorimetric'} */ ('absolute-colorimetric'),
    /** K-Only Black Point Compensation with Gray Component Replacement - ensures neutral grays convert to K-only output */
    PRESERVE_K_ONLY_RELATIVE_COLORIMETRIC_GCR: /** @type {'preserve-k-only-relative-colorimetric-gcr'} */ ('preserve-k-only-relative-colorimetric-gcr'),
});
