// @ts-check
/**
 * Color Converter Base Class
 *
 * Abstract base class for color conversion operations.
 * Provides configuration management and per-reference overrides
 * that subclasses can use for fine-grained control.
 *
 * Uses ColorEngineProvider for WASM color engine access and
 * ColorConversionPolicy for format/transform decisions.
 *
 * @module ColorConverter
 */

import { NO_OP_DIAGNOSTICS } from './diagnostics-collector.js';
import { ColorEngineProvider, DEFAULT_ENGINE_VERSION } from './color-engine-provider.js';
import { ColorConversionPolicy, SHOULD_SWAP_16_FROM_BIG_TO_LITTLE_ENDIAN } from './color-conversion-policy.js';

/// TODO: Follow web conventions for constants on globals like Node.ELEMENT_NODE
//
// ============================================================================
// Rendering Intent Constants
// ============================================================================

/**
 * Numeric rendering intent codes for fast comparison.
 *
 * Using numeric codes instead of string comparison provides ~10x faster
 * comparisons in hot paths (e.g., per color space group processing).
 *
 * Values match LittleCMS intent constants where applicable:
 * - 0-3: Standard ICC intents
 * - 20: Custom K-Only GCR intent
 *
 * @readonly
 * @enum {number}
 */
export const RENDERING_INTENT_CODE = /** @type {const} */ ({
    PERCEPTUAL: 0,
    RELATIVE_COLORIMETRIC: 1,
    SATURATION: 2,
    ABSOLUTE_COLORIMETRIC: 3,
    K_ONLY_GCR: 20,
});

/**
 * Maps string rendering intent to numeric code.
 *
 * @param {RenderingIntent} intent - String rendering intent
 * @returns {number} Numeric intent code
 * @example
 * ```javascript
 * const code = getRenderingIntentCode('preserve-k-only-relative-colorimetric-gcr');
 * // code === 20
 * ```
 */
export function getRenderingIntentCode(intent) {
    switch (intent) {
        case 'perceptual':
            return RENDERING_INTENT_CODE.PERCEPTUAL;
        case 'relative-colorimetric':
            return RENDERING_INTENT_CODE.RELATIVE_COLORIMETRIC;
        case 'saturation':
            return RENDERING_INTENT_CODE.SATURATION;
        case 'absolute-colorimetric':
            return RENDERING_INTENT_CODE.ABSOLUTE_COLORIMETRIC;
        case 'preserve-k-only-relative-colorimetric-gcr':
            return RENDERING_INTENT_CODE.K_ONLY_GCR;
        default:
            return RENDERING_INTENT_CODE.RELATIVE_COLORIMETRIC;
    }
}

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Rendering intent for color conversion.
 * @typedef {'perceptual' | 'relative-colorimetric' | 'saturation' | 'absolute-colorimetric' | 'preserve-k-only-relative-colorimetric-gcr'} RenderingIntent
 */

/**
 * Color types supported for image conversion.
 * @typedef {'RGB' | 'Gray' | 'Lab' | 'CMYK'} ColorType
 */

/**
 * Profile type - ICC profile data as ArrayBuffer, or 'Lab' for the built-in
 * Lab D50 profile. 'Lab' is the only allowed string identifier because it is
 * device-independent and may need whitepoint control in the future.
 *
 * All other profiles (including sRGB) must be provided as ArrayBuffer data
 * loaded by the caller before reaching this layer.
 *
 * @typedef {ArrayBuffer | 'Lab'} ProfileType
 */

/**
 * Base configuration for all color converters.
 *
 * @typedef {{
 *   renderingIntent: RenderingIntent,
 *   blackPointCompensation: boolean,
 *   useAdaptiveBPCClamping: boolean,
 *   destinationProfile: ProfileType,
 *   destinationColorSpace: ColorType,
 *   verbose: boolean,
 *   diagnostics?: import('./diagnostics-collector.js').DiagnosticsCollector,
 *   outputBitsPerComponent?: import('./color-conversion-policy.js').BitDepth,
 *   outputEndianness?: import('./color-conversion-policy.js').Endianness,
 *   intermediateProfiles?: ProfileType[],
 * }} ColorConverterConfiguration
 */

/**
 * Input data for color conversion operations.
 * @typedef {Record<string, any>} ColorConverterInput
 */

/**
 * Context passed through conversion lifecycle.
 * @typedef {Record<string, any>} ColorConverterContext
 */

/**
 * Result of a color conversion operation.
 * @typedef {Record<string, any>} ColorConverterResult
 */

/**
 * Worker task data for parallel processing.
 * @typedef {Record<string, any>} WorkerTask
 */

/**
 * Result from worker thread processing.
 * @typedef {Record<string, any>} WorkerResult
 */

// ============================================================================
// ColorConverter Class
// ============================================================================

/**
 * Abstract base class for color conversion operations.
 *
 * Provides a consistent structure for color conversion operations with:
 * - Immutable configuration frozen at construction
 * - Per-reference overrides for fine-grained control
 * - Parent-child relationships for hierarchical converters
 * - Worker mode support for parallel processing
 *
 * @abstract
 * @example
 * ```javascript
 * class MyConverter extends ColorConverter {
 *     async convert(input) {
 *         // Use convertColorsBuffer for actual conversion
 *         return await this.convertColorsBuffer(input.buffer, {
 *             inputColorSpace: input.colorSpace,
 *             outputColorSpace: this.configuration.destinationColorSpace,
 *             sourceProfile: input.sourceProfile,
 *         });
 *     }
 * }
 *
 * const converter = new MyConverter({
 *     renderingIntent: 'relative-colorimetric',
 *     blackPointCompensation: true,
 *     useAdaptiveBPCClamping: true,
 *     destinationProfile: cmykProfileBuffer,
 *     destinationColorSpace: 'CMYK',
 *     verbose: false,
 * });
 *
 * const result = await converter.convert({ buffer, colorSpace: 'RGB' });
 * ```
 */
export class ColorConverter {
    // ========================================
    // Private Fields
    // ========================================

    /** @type {Readonly<ColorConverterConfiguration>} */
    #configuration;

    /** @type {ColorConverter | null} */
    #parentConverter = null;

    /** @type {Map<string, Partial<ColorConverterConfiguration>>} */
    #referenceOverrides = new Map();

    /** @type {ColorEngineProvider | null} */
    #colorEngineProvider = null;

    /** @type {boolean} */
    #ownsColorEngineProvider = false;

    /** @type {string | undefined} */
    #colorEnginePath;

    /** @type {ColorConversionPolicy} */
    #policy;

    /** @type {Map<string, number>} Profile handle cache (cacheKey → WASM handle) */
    #profileHandleCache = new Map();

    /** @type {Map<string, { transform: number, inputFormat: number, outputFormat: number, bpcClampingInitialized: boolean }>} */
    #transformCache = new Map();

    /** @type {Map<string, SingleTransformCacheEntry | MultiStageTransformCacheEntry>} */
    #multiprofileTransformCache = new Map();

    /** @type {Promise<void>} */
    #ready;

    /**
     * @deprecated Backward compatibility - lazily created ColorEngineService for unmigrated subclasses.
     * @type {import('../../services/ColorEngineService.js').ColorEngineService | null}
     */
    #legacyColorEngineService = null;

    /** @type {boolean} */
    #ownsLegacyColorEngineService = false;

    /** Threshold for adaptive BPC clamping optimization (2 megapixels) */
    static #ADAPTIVE_BPC_THRESHOLD = 2 * 1024 * 1024;

    /**
     * Format bit masks for detecting format properties.
     * These match LittleCMS TYPE_* format flags.
     */
    static #FORMAT_ENDIAN16_MASK = 0x800;  // ENDIAN16_SH(1) = 1 << 11 = 2048
    static #FORMAT_FLOAT_MASK = 0x400000;  // FLOAT_SH(1) = 1 << 22 = 4194304

    // ========================================
    // Constructor
    // ========================================

    /**
     * Creates a new ColorConverter instance.
     *
     * @param {ColorConverterConfiguration} configuration - Immutable configuration
     * @param {object} [options={}] - Additional options
     * @param {ColorEngineProvider} [options.colorEngineProvider] - Shared ColorEngineProvider
     * @param {ColorConversionPolicy} [options.policy] - Custom conversion policy
     * @param {string} [options.engineVersion] - Color engine version for policy rules (default: from symlinked color-engine)
     * @param {string} [options.colorEnginePath] - Path to color engine package (e.g., "../../packages/color-engine-2026-01-30")
     * @param {string} [options.domain='default'] - Domain context for policy severity
     * @param {import('../../services/ColorEngineService.js').ColorEngineService} [options.colorEngineService] - Shared ColorEngineService (for backward compatibility)
     */
    constructor(configuration, options = {}) {
        this.#configuration = Object.freeze({ ...configuration });
        this.#colorEnginePath = options.colorEnginePath;
        this.#policy = options.policy ?? new ColorConversionPolicy({
            engineVersion: options.engineVersion ?? DEFAULT_ENGINE_VERSION,
            domain: options.domain ?? 'default',
        });

        // Handle legacy colorEngineService option (backward compatibility)
        if (options.colorEngineService) {
            this.#legacyColorEngineService = options.colorEngineService;
            this.#ownsLegacyColorEngineService = false;
        }

        if (options.colorEngineProvider) {
            this.#colorEngineProvider = options.colorEngineProvider;
            this.#ownsColorEngineProvider = false;
            // Skip legacy service initialization — ColorEngineProvider is the
            // replacement API.  The legacy ColorEngineService import chain pulls
            // in services/ColorEngineService.js which statically imports 'pdf-lib'.
            // In Web Workers (no importmap) bare specifiers like 'pdf-lib' cannot
            // resolve, so eagerly loading the legacy service breaks worker mode.
            // No baseline subclass actually calls methods on the legacy service;
            // it is only plumbed through for backward compatibility with code
            // outside baseline/ that may still reference it.
            this.#ready = Promise.resolve();
        } else {
            this.#ready = this.#initialize();
        }
    }

    // ========================================
    // Initialization
    // ========================================

    /**
     * Initializes the ColorEngineProvider and legacy ColorEngineService.
     * @returns {Promise<void>}
     */
    async #initialize() {
        // Build engine path from colorEnginePath if provided
        const enginePath = this.#colorEnginePath
            ? `${this.#colorEnginePath}/src/index.js`
            : undefined;

        this.#colorEngineProvider = new ColorEngineProvider({ enginePath });
        await this.#colorEngineProvider.initialize();
        this.#ownsColorEngineProvider = true;

        // Also initialize legacy service for backward compatibility with unmigrated subclasses
        await this.#initializeLegacyServiceIfNeeded();
    }

    /**
     * Initializes the legacy ColorEngineService if not already provided.
     * @returns {Promise<void>}
     */
    async #initializeLegacyServiceIfNeeded() {
        if (!this.#legacyColorEngineService) {
            try {
                // Dynamic import to avoid requiring services/ when not needed
                const { ColorEngineService } = await import('../../services/ColorEngineService.js');
                // Pass the engine instance from ColorEngineProvider to ensure consistent engine version
                const engineInstance = this.#colorEngineProvider?.engine ?? undefined;
                this.#legacyColorEngineService = new ColorEngineService({
                    colorEngineInstance: engineInstance,
                });
                this.#ownsLegacyColorEngineService = true;
            } catch {
                // ColorEngineService not available (e.g., staging deployment without
                // full services/). No baseline subclass uses the legacy service —
                // it exists only for backward compatibility with non-baseline code.
            }
        }
    }

    /**
     * Ensures the converter is ready for use.
     * @returns {Promise<void>}
     */
    async ensureReady() {
        await this.#ready;
    }

    // ========================================
    // Configuration Access (Getters)
    // ========================================

    /**
     * Gets the immutable configuration for this converter.
     *
     * @returns {Readonly<ColorConverterConfiguration>} Frozen configuration object
     * @example
     * ```javascript
     * const intent = converter.configuration.renderingIntent;
     * ```
     */
    get configuration() {
        return this.#configuration;
    }

    /**
     * Gets the ColorEngineProvider instance.
     * @returns {ColorEngineProvider | null}
     */
    get colorEngineProvider() {
        return this.#colorEngineProvider;
    }

    /**
     * Gets the conversion policy.
     * @returns {ColorConversionPolicy}
     */
    get policy() {
        return this.#policy;
    }

    /**
     * Gets the ColorEngineService instance.
     *
     * @deprecated This getter provides backward compatibility for unmigrated subclasses.
     * Use `colorEngineProvider` and `convertColorsBuffer()` instead.
     * Will be removed once all subclasses are migrated to use ColorEngineProvider.
     *
     * @returns {import('../../services/ColorEngineService.js').ColorEngineService | null}
     */
    get colorEngineService() {
        return this.#legacyColorEngineService;
    }

    /**
     * Gets the DiagnosticsCollector instance.
     *
     * Returns the configured diagnostics collector, or NO_OP_DIAGNOSTICS if none provided.
     * This allows instrumentation code to always call diagnostics methods without null checks.
     *
     * @returns {import('./diagnostics-collector.js').DiagnosticsCollector | import('./diagnostics-collector.js').NoOpDiagnostics}
     */
    get diagnostics() {
        return this.#configuration.diagnostics ?? NO_OP_DIAGNOSTICS;
    }

    /**
     * Gets the parent converter in the hierarchy.
     *
     * @returns {ColorConverter | null} Parent converter or null if root
     */
    get parentConverter() {
        return this.#parentConverter;
    }

    /**
     * Sets the parent converter in the hierarchy.
     *
     * @param {ColorConverter | null} parent - Parent converter or null
     */
    set parentConverter(parent) {
        this.#parentConverter = parent;
    }

    // ========================================
    // Core Conversion Method
    // ========================================

    /**
     * Converts a buffer of color values using SIMD-optimized batch conversion.
     *
     * This is the core TypedArray-to-TypedArray conversion method that all
     * subclasses should use for efficient color conversion.
     *
     * Bit depth parameters:
     * - `bitsPerComponent`: Fallback for both input and output
     * - `inputBitsPerComponent`: Explicit bit depth for input (overrides bitsPerComponent)
     * - `outputBitsPerComponent`: Explicit bit depth for output (overrides bitsPerComponent)
     *
     * Endianness parameters (conditional on bit depth):
     * - `endianness`: Fallback for both input and output
     * - `inputEndianness`: Explicit endianness for input (overrides endianness)
     * - `outputEndianness`: Explicit endianness for output (overrides endianness)
     *
     * Endianness is required for 16-bit, ignored for 8-bit, warns if specified for 32-bit.
     *
     * @param {Uint8Array | Uint16Array | Float32Array} inputBuffer - Input color values
     * @param {object} options - Conversion options
     * @param {import('./color-conversion-policy.js').ColorSpace} options.inputColorSpace - Input color space
     * @param {import('./color-conversion-policy.js').ColorSpace} options.outputColorSpace - Output color space
     * @param {ProfileType} options.sourceProfile - Source ICC profile (ArrayBuffer required except Lab)
     * @param {ProfileType} [options.destinationProfile] - Destination ICC profile (uses config if not provided)
     * @param {RenderingIntent} [options.renderingIntent] - Rendering intent (uses config if not provided)
     * @param {boolean} [options.blackPointCompensation] - Enable BPC (uses config if not provided)
     * @param {import('./color-conversion-policy.js').BitDepth} [options.bitsPerComponent=8] - Bit depth (fallback for input/output)
     * @param {import('./color-conversion-policy.js').BitDepth} [options.inputBitsPerComponent] - Input bit depth (overrides bitsPerComponent)
     * @param {import('./color-conversion-policy.js').BitDepth} [options.outputBitsPerComponent] - Output bit depth (overrides bitsPerComponent)
     * @param {import('./color-conversion-policy.js').Endianness} [options.endianness='big'] - Endianness (fallback for input/output)
     * @param {import('./color-conversion-policy.js').Endianness} [options.inputEndianness] - Input endianness (overrides endianness)
     * @param {import('./color-conversion-policy.js').Endianness} [options.outputEndianness] - Output endianness (overrides endianness)
     * @param {boolean} [options.requiresMultiprofileTransform] - Deprecated: policy determines this. Ignored if passed.
     * @returns {Promise<{ outputPixels: Uint8Array | Uint16Array | Float32Array, pixelCount: number, inputChannels: number, outputChannels: number, bpcStats?: object }>}
     */
    async convertColorsBuffer(inputBuffer, options) {
        await this.#ready;

        const provider = this.#colorEngineProvider;
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
            // bitsPerComponent = 8,
            inputBitsPerComponent,
            outputBitsPerComponent = config.outputBitsPerComponent,
            endianness,
            // endianness = 'big',
            inputEndianness,
            outputEndianness,
        } = options;

        // Validate source profile (NO fallbacks except Lab)
        if (inputColorSpace !== 'Lab' && !(sourceProfile instanceof ArrayBuffer)) {
            throw new Error(`Source ICC profile is required for ${inputColorSpace} - no fallback profiles allowed`);
        }

        // Validate destination profile (NO fallbacks except Lab)
        if (outputColorSpace !== 'Lab' && !(destinationProfile instanceof ArrayBuffer)) {
            throw new Error(`Destination ICC profile is required for ${outputColorSpace} - no fallback profiles allowed`);
        }

        // Build descriptors with all parameters - let policy resolve fallbacks (late defaulting)
        /** @type {import('./color-conversion-policy.js').PixelFormatDescriptor} */
        const inputDescriptor = {
            colorSpace: inputColorSpace,
            bitsPerComponent: /** @type {import('./color-conversion-policy.js').BitDepth} */ (bitsPerComponent),
            inputBitsPerComponent: /** @type {import('./color-conversion-policy.js').BitDepth | undefined} */ (inputBitsPerComponent),
            endianness,
            inputEndianness,
        };

        /** @type {import('./color-conversion-policy.js').PixelFormatDescriptor} */
        const outputDescriptor = {
            colorSpace: outputColorSpace,
            bitsPerComponent: /** @type {import('./color-conversion-policy.js').BitDepth} */ (bitsPerComponent),
            outputBitsPerComponent: /** @type {import('./color-conversion-policy.js').BitDepth | undefined} */ (outputBitsPerComponent),
            endianness,
            outputEndianness,
        };

        /** @type {import('./color-conversion-policy.js').ConversionDescriptor} */
        const conversionDescriptor = {
            sourceColorSpace: inputColorSpace,
            destinationColorSpace: outputColorSpace,
            renderingIntent,
            blackPointCompensation,
            sourceProfile,
            destinationProfile,
        };

        let inputFormat = this.#policy.getInputFormat(inputDescriptor);
        const outputFormat = this.#policy.getOutputFormat(outputDescriptor);
        const evaluationResult = this.#policy.evaluateConversion(conversionDescriptor);

        // ============================================================
        // LittleCMS Workaround: 16-bit SE → Float transforms not supported
        // ============================================================
        // LittleCMS cannot create transforms from 16-bit swap-endian formats
        // (TYPE_*_16_SE) to 32-bit float formats (TYPE_*_FLT). When this
        // combination is detected, we byte-swap the input buffer ourselves
        // and use the native-endian format instead.
        //
        // This is a documented LittleCMS limitation: cmsCreateTransform()
        // returns NULL for these format combinations.
        //
        // Two cases require byte-swap:
        // 1. 16-bit SE → float: ALWAYS (LittleCMS limitation, cannot create transform)
        // 2. 16-bit SE → other: Only if SHOULD_SWAP_16_FROM_BIG_TO_LITTLE_ENDIAN
        // ============================================================
        let effectiveInputBuffer = inputBuffer;
        const isSwapEndian = ColorConverter.#isSwapEndianFormat(inputFormat);
        const isFloatOutput = ColorConverter.#isFloatFormat(outputFormat);
        const shouldByteSwap = isSwapEndian && (isFloatOutput || SHOULD_SWAP_16_FROM_BIG_TO_LITTLE_ENDIAN);
        if (shouldByteSwap) {
            // Need to byte-swap the 16-bit input data
            const bufferToSwap = inputBuffer instanceof Uint8Array
                ? inputBuffer
                : new Uint8Array(inputBuffer.buffer, inputBuffer.byteOffset, inputBuffer.byteLength);
            effectiveInputBuffer = ColorConverter.#byteSwap16(bufferToSwap);
            // Remove the SE flag from the input format (use native endian)
            inputFormat = ColorConverter.#removeSwapEndianFlag(inputFormat);
        }

        // Calculate channels and pixel count
        // For typed arrays: .length is element count, not byte count
        // - Uint8Array: length = bytes, need to divide by bytesPerSample
        // - Uint16Array/Float32Array: length = samples, divide by channels only
        const inputChannels = this.#getChannelsForColorSpace(inputColorSpace);
        const outputChannels = this.#getChannelsForColorSpace(outputColorSpace);
        let pixelCount;
        if (inputBuffer instanceof Uint8Array) {
            const bytesPerSample = this.#policy.getBytesPerSample(inputFormat);
            pixelCount = Math.floor(inputBuffer.length / (inputChannels * bytesPerSample));
        } else {
            // Uint16Array or Float32Array: .length is already sample count
            pixelCount = Math.floor(inputBuffer.length / inputChannels);
        }

        // Get rendering intent and flags
        const effectiveIntent = evaluationResult.overrides.renderingIntent ?? renderingIntent;
        const intentConstant = this.#policy.getRenderingIntentConstant(effectiveIntent);
        const constants = provider.getConstants();
        let flags = blackPointCompensation ? constants.cmsFLAGS_BLACKPOINTCOMPENSATION : 0;

        // Check if adaptive BPC clamping should be used
        const useAdaptiveBPC = config.useAdaptiveBPCClamping &&
            blackPointCompensation &&
            pixelCount >= ColorConverter.#ADAPTIVE_BPC_THRESHOLD;

        // Choose transform method based on config intermediates or policy evaluation
        const configIntermediateProfiles = config.intermediateProfiles;
        const hasConfigIntermediates = configIntermediateProfiles && configIntermediateProfiles.length > 0;
        const useMultiprofile = hasConfigIntermediates
            || evaluationResult.overrides.requiresMultiprofileTransform;

        if (config.verbose) {
            console.log(`[ColorConverter] convertColorsBuffer: ${inputColorSpace} → ${outputColorSpace}, ` +
                `multiprofile=${useMultiprofile} (configIntermediates=${hasConfigIntermediates ? configIntermediateProfiles.length : 0}, ` +
                `policyMultiprofile=${!!evaluationResult.overrides.requiresMultiprofileTransform}), ` +
                `intent=${effectiveIntent}, pixels=${pixelCount}`);
        }

        /** @type {SingleTransformCacheEntry | MultiStageTransformCacheEntry} */
        let cached;
        if (useMultiprofile) {
            // Add multiprofile BPC scaling flag if required by policy
            if (evaluationResult.overrides.multiprofileBlackPointScaling && constants.cmsFLAGS_MULTIPROFILE_BPC_SCALING) {
                flags |= constants.cmsFLAGS_MULTIPROFILE_BPC_SCALING;
            }

            // Config intermediates take precedence over policy intermediates
            const rawIntermediateProfiles = hasConfigIntermediates
                ? configIntermediateProfiles
                : evaluationResult.overrides.intermediateProfiles ?? [];

            // Resolve intermediate profile URLs to ArrayBuffer via ColorEngineProvider
            /** @type {ProfileType[]} */
            const intermediateProfiles = await Promise.all(
                rawIntermediateProfiles.map(async (profile) => {
                    if (typeof profile === 'string' && profile !== 'Lab') {
                        return provider.loadProfile(profile);
                    }
                    return /** @type {ProfileType} */ (profile);
                })
            );
            /** @type {ProfileType[]} */
            const profiles = [sourceProfile, ...intermediateProfiles, destinationProfile];

            if (config.verbose) {
                console.log(`[ColorConverter] Multiprofile chain: ${profiles.length} profiles ` +
                    `[${profiles.map(p => p === 'Lab' ? 'Lab' : `ArrayBuffer(${/** @type {ArrayBuffer} */(p).byteLength})`).join(', ')}]`);
            }

            cached = this.#getOrCreateMultiprofileTransform(
                profiles,
                inputFormat,
                outputFormat,
                intentConstant,
                flags,
                useAdaptiveBPC
            );
        } else {
            // Single transform
            cached = this.#getOrCreateTransform(
                sourceProfile,
                destinationProfile,
                inputFormat,
                outputFormat,
                intentConstant,
                flags,
                useAdaptiveBPC
            );
        }

        // Create output buffer based on bit depth
        const outputPixels = this.#policy.createOutputBuffer(outputFormat, pixelCount, outputChannels);

        // Perform transform
        let bpcStats;
        if (cached.stages) {
            // Multi-stage fallback: execute chain of individual transforms
            this.#executeMultiStageTransform(provider, cached.stages, effectiveInputBuffer, outputPixels, pixelCount);
        } else if (useAdaptiveBPC && cached.bpcClampingInitialized) {
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
    // Profile and Transform Caching
    // ========================================

    /**
     * Gets the number of channels for a color space.
     * @param {import('./color-conversion-policy.js').ColorSpace} colorSpace
     * @returns {number}
     */
    #getChannelsForColorSpace(colorSpace) {
        switch (colorSpace) {
            case 'Gray': return 1;
            case 'RGB': return 3;
            case 'CMYK': return 4;
            case 'Lab': return 3;
            default: throw new Error(`Unknown color space: ${colorSpace}`);
        }
    }

    /**
     * Byte-swaps 16-bit values in a Uint8Array (big-endian to little-endian or vice versa).
     *
     * LittleCMS has a limitation: transforms from 16-bit swap-endian (SE) formats to
     * 32-bit float formats are not supported. This method allows pre-swapping the buffer
     * so we can use the native-endian 16-bit format instead.
     *
     * @param {Uint8Array} buffer - Buffer containing 16-bit values
     * @returns {Uint8Array} New buffer with swapped bytes
     */
    static #byteSwap16(buffer) {
        const swapped = new Uint8Array(buffer.length);
        for (let i = 0; i < buffer.length; i += 2) {
            swapped[i] = buffer[i + 1];
            swapped[i + 1] = buffer[i];
        }
        return swapped;
    }

    /**
     * Checks if a format has the ENDIAN16 (swap-endian) flag set.
     * @param {number} format - LittleCMS TYPE_* format constant
     * @returns {boolean}
     */
    static #isSwapEndianFormat(format) {
        return (format & ColorConverter.#FORMAT_ENDIAN16_MASK) !== 0;
    }

    /**
     * Checks if a format is a float format.
     * @param {number} format - LittleCMS TYPE_* format constant
     * @returns {boolean}
     */
    static #isFloatFormat(format) {
        return (format & ColorConverter.#FORMAT_FLOAT_MASK) !== 0;
    }

    /**
     * Removes the ENDIAN16 (swap-endian) flag from a format constant.
     * @param {number} format - LittleCMS TYPE_* format constant
     * @returns {number} Format without SE flag
     */
    static #removeSwapEndianFlag(format) {
        return format & ~ColorConverter.#FORMAT_ENDIAN16_MASK;
    }

    /**
     * Generates a cache key for a profile source.
     * @param {ProfileType} source
     * @returns {string}
     */
    #getProfileCacheKey(source) {
        if (source === 'Lab') {
            return 'Lab';
        }
        if (typeof source === 'string') {
            throw new Error(
                `Cannot generate cache key for string profile "${source}". ` +
                `Only 'Lab' is accepted as a string identifier. ` +
                `All other profiles must be provided as ArrayBuffer.`
            );
        }
        // For ArrayBuffer, use byteLength and first/last bytes as key
        const view = new Uint8Array(source);
        return `buf:${source.byteLength}:${view[0]}:${view[view.length - 1]}`;
    }

    /**
     * Opens a profile handle from a source.
     *
     * Accepts only:
     * - `ArrayBuffer` — ICC profile data already loaded into memory
     * - `'Lab'` — the built-in Lab D50 profile (the only allowed string
     *   identifier, because Lab is device-independent and may need
     *   whitepoint control in the future)
     *
     * All other profiles (including sRGB, intermediate profiles from policy
     * rules, etc.) must be loaded into ArrayBuffer by the caller before
     * reaching this method. String paths, URLs, or any other string
     * identifiers are not accepted.
     *
     * Uses caching to avoid re-opening the same profile multiple times.
     *
     * @param {ProfileType} source - ArrayBuffer or 'Lab'
     * @returns {number} Profile handle
     */
    #openProfile(source) {
        const provider = this.#colorEngineProvider;
        if (!provider) {
            throw new Error('ColorEngineProvider not initialized');
        }

        // Check cache first
        const cacheKey = this.#getProfileCacheKey(source);
        const cachedHandle = this.#profileHandleCache.get(cacheKey);
        if (cachedHandle !== undefined) {
            return cachedHandle;
        }

        // Create new profile handle
        let handle;
        if (source === 'Lab') {
            // Lab is the only built-in profile — device-independent, no ICC data needed
            handle = provider.createLab4Profile();
        } else if (source instanceof ArrayBuffer) {
            handle = provider.openProfileFromMem(source);
        } else if (typeof source === 'string') {
            // Reject all other strings — profiles must be loaded into ArrayBuffer
            // by the caller before reaching this layer
            throw new Error(
                `Cannot open profile from string "${source}". ` +
                `Only 'Lab' is accepted as a string identifier. ` +
                `All other profiles (including paths and URLs) must be provided as ArrayBuffer.`
            );
        } else {
            throw new Error(
                `Invalid profile source type: ${typeof source}. ` +
                `Expected ArrayBuffer or 'Lab'.`
            );
        }

        // Validate handle (LittleCMS returns 0 for NULL/invalid profiles)
        if (!handle) {
            const sourceDesc = source === 'Lab' ? 'Lab' :
                `ArrayBuffer(${/** @type {ArrayBuffer} */(source).byteLength} bytes)`;
            throw new Error(
                `Failed to open ICC profile: ${sourceDesc}. ` +
                `The color engine returned a null handle (profile may be corrupt or unsupported).`
            );
        }

        // Cache the handle
        this.#profileHandleCache.set(cacheKey, handle);
        return handle;
    }

    /**
     * Generates a cache key for a transform.
     * @param {string} srcKey
     * @param {string} dstKey
     * @param {number} inputFormat
     * @param {number} outputFormat
     * @param {number} intent
     * @param {number} flags
     * @returns {string}
     */
    #getTransformCacheKey(srcKey, dstKey, inputFormat, outputFormat, intent, flags) {
        return `${srcKey}|${dstKey}|${inputFormat}|${outputFormat}|${intent}|${flags}`;
    }

    /**
     * Gets or creates a cached transform.
     *
     * @param {ProfileType} sourceProfileSource
     * @param {ProfileType} destProfileSource
     * @param {number} inputFormat
     * @param {number} outputFormat
     * @param {number} intent
     * @param {number} flags
     * @param {boolean} [initBPCClamping=false]
     * @returns {{ transform: number, inputFormat: number, outputFormat: number, bpcClampingInitialized: boolean }}
     */
    #getOrCreateTransform(sourceProfileSource, destProfileSource, inputFormat, outputFormat, intent, flags, initBPCClamping = false) {
        const provider = this.#colorEngineProvider;
        if (!provider) {
            throw new Error('ColorEngineProvider not initialized');
        }

        const srcKey = this.#getProfileCacheKey(sourceProfileSource);
        const dstKey = this.#getProfileCacheKey(destProfileSource);
        const cacheKey = this.#getTransformCacheKey(srcKey, dstKey, inputFormat, outputFormat, intent, flags);

        // Check cache first
        const existingCached = this.#transformCache.get(cacheKey);
        if (existingCached) {
            // Initialize BPC clamping if requested and not already done
            if (initBPCClamping && !existingCached.bpcClampingInitialized) {
                const inputChannels = this.#getChannelsFromFormat(inputFormat);
                const outputChannels = this.#getChannelsFromFormat(outputFormat);
                if (provider.initBPCClamping(existingCached.transform, inputChannels, outputChannels)) {
                    existingCached.bpcClampingInitialized = true;
                }
            }
            return existingCached;
        }

        // Create new transform
        const sourceProfile = this.#openProfile(sourceProfileSource);
        const destProfile = this.#openProfile(destProfileSource);

        const transform = provider.createTransform(
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
        if (initBPCClamping) {
            const inputChannels = this.#getChannelsFromFormat(inputFormat);
            const outputChannels = this.#getChannelsFromFormat(outputFormat);
            if (provider.initBPCClamping(transform, inputChannels, outputChannels)) {
                cached.bpcClampingInitialized = true;
            }
        }

        this.#transformCache.set(cacheKey, cached);
        return cached;
    }

    /**
     * @typedef {{
     *   transform: number,
     *   inputFormat: number,
     *   outputFormat: number,
     *   bpcClampingInitialized: boolean,
     *   stages?: undefined,
     * }} SingleTransformCacheEntry
     */

    /**
     * @typedef {{
     *   stages: { transform: number, inputFormat: number, outputFormat: number }[],
     *   inputFormat: number,
     *   outputFormat: number,
     *   bpcClampingInitialized: boolean,
     *   transform?: undefined,
     * }} MultiStageTransformCacheEntry
     */

    /**
     * Gets or creates a cached multiprofile transform.
     *
     * When `createMultiprofileTransform` is available on the engine, uses it
     * directly for a single native multiprofile transform.
     *
     * When `createMultiprofileTransform` is unavailable (legacy engines),
     * falls back to a multi-stage chain of individual `createTransform` calls:
     * - If `intermediateProfiles` is empty: single transform (source → destination)
     * - If `intermediateProfiles` is not empty: two or more transforms
     *   (source → intermediate₁ → ... → intermediateₙ → destination)
     *
     * @param {ProfileType[]} profileSources
     * @param {number} inputFormat
     * @param {number} outputFormat
     * @param {number} intent
     * @param {number} flags
     * @param {boolean} [initBPCClamping=false]
     * @returns {SingleTransformCacheEntry | MultiStageTransformCacheEntry}
     */
    #getOrCreateMultiprofileTransform(profileSources, inputFormat, outputFormat, intent, flags, initBPCClamping = false) {
        const provider = this.#colorEngineProvider;
        if (!provider) {
            throw new Error('ColorEngineProvider not initialized');
        }

        // Build cache key from all profile keys
        const profileKeys = profileSources.map(src => this.#getProfileCacheKey(/** @type {ArrayBuffer | 'Lab'} */(src)));
        const cacheKey = `multi:${profileKeys.join('|')}|${inputFormat}|${outputFormat}|${intent}|${flags}`;

        // Check cache first
        const existingCached = this.#multiprofileTransformCache.get(cacheKey);
        if (existingCached) {
            if (initBPCClamping && !existingCached.bpcClampingInitialized && existingCached.transform) {
                const inputChannels = this.#getChannelsFromFormat(inputFormat);
                const outputChannels = this.#getChannelsFromFormat(outputFormat);
                if (provider.initBPCClamping(existingCached.transform, inputChannels, outputChannels)) {
                    existingCached.bpcClampingInitialized = true;
                }
            }
            return existingCached;
        }

        // Open all profiles
        const profileHandles = profileSources.map(src => this.#openProfile(/** @type {ProfileType} */ (src)));

        // Try native multiprofile transform first
        // Check underlying engine (not the provider wrapper) for availability
        if (typeof provider.engine.createMultiprofileTransform === 'function') {
            const transform = provider.createMultiprofileTransform(
                profileHandles,
                inputFormat,
                outputFormat,
                intent,
                flags
            );

            if (!transform) {
                throw new Error('Failed to create multiprofile color transform');
            }

            /** @type {SingleTransformCacheEntry} */
            const cached = { transform, inputFormat, outputFormat, bpcClampingInitialized: false };

            if (initBPCClamping) {
                const inputChannels = this.#getChannelsFromFormat(inputFormat);
                const outputChannels = this.#getChannelsFromFormat(outputFormat);
                if (provider.initBPCClamping(transform, inputChannels, outputChannels)) {
                    cached.bpcClampingInitialized = true;
                }
            }

            this.#multiprofileTransformCache.set(cacheKey, cached);
            return cached;
        }

        // Fallback: multi-stage chain using individual createTransform calls
        // Build stages: [source, ...intermediates, destination] → pairwise transforms
        //
        // Intent routing: intermediate stages use Relative Colorimetric (safe for
        // all color spaces). Only the final stage uses the requested intent (e.g.,
        // K-Only GCR). This mirrors how native createMultiprofileTransform routes
        // intents through the profile chain.
        const relativeColorimetricConstant = this.#policy.getRenderingIntentConstant('relative-colorimetric');

        /** @type {{ transform: number, inputFormat: number, outputFormat: number }[]} */
        const stages = [];

        for (let i = 0; i < profileHandles.length - 1; i++) {
            const isLastStage = (i === profileHandles.length - 2);
            const stageInputFormat = (i === 0) ? inputFormat : stages[i - 1].outputFormat;
            const stageOutputFormat = isLastStage ? outputFormat : this.#getIntermediateFormat(profileSources[i + 1], stageInputFormat);
            const stageIntent = isLastStage ? intent : relativeColorimetricConstant;

            const transform = provider.createTransform(
                profileHandles[i],
                stageInputFormat,
                profileHandles[i + 1],
                stageOutputFormat,
                stageIntent,
                flags
            );

            if (!transform) {
                throw new Error(
                    `Failed to create stage ${i + 1} transform in multi-stage chain: ` +
                    `profiles[${i}]=${profileHandles[i]} (${typeof profileSources[i] === 'string' ? profileSources[i] : 'ArrayBuffer'}), ` +
                    `profiles[${i + 1}]=${profileHandles[i + 1]} (${typeof profileSources[i + 1] === 'string' ? profileSources[i + 1] : 'ArrayBuffer'}), ` +
                    `inputFormat=0x${stageInputFormat.toString(16)}, outputFormat=0x${stageOutputFormat.toString(16)}, ` +
                    `intent=${stageIntent}, flags=0x${flags.toString(16)}`
                );
            }

            stages.push({ transform, inputFormat: stageInputFormat, outputFormat: stageOutputFormat });
        }

        /** @type {MultiStageTransformCacheEntry} */
        const cached = { stages, inputFormat, outputFormat, bpcClampingInitialized: false };
        this.#multiprofileTransformCache.set(cacheKey, cached);
        return cached;
    }

    /**
     * Gets an intermediate format for a profile in a multi-stage chain.
     *
     * Derives the intermediate format from the stage's input format to preserve
     * bit depth and endianness. This avoids the LittleCMS limitation where
     * TYPE_*_16_SE → TYPE_*_FLT transforms are not supported.
     *
     * @param {ProfileType} profileSource - The profile that will receive/produce pixels
     * @param {number} stageInputFormat - The input format for the stage feeding into this intermediate
     * @returns {number} TYPE_* constant for the intermediate format
     */
    #getIntermediateFormat(profileSource, stageInputFormat) {
        // Determine color space for the intermediate profile
        /** @type {import('./color-conversion-policy.js').ColorSpace} */
        let colorSpace;
        if (profileSource === 'Lab') {
            colorSpace = 'Lab';
        } else {
            // For ArrayBuffer ICC profiles, we cannot determine the color space
            // from the buffer alone without parsing the ICC header. Use RGB
            // as default — sRGB and similar RGB profiles are the most common
            // intermediates in multi-stage chains.
            colorSpace = 'RGB';
        }

        // Match bit depth from the stage input format to avoid SE → FLT limitation
        const isFloat = ColorConverter.#isFloatFormat(stageInputFormat);
        const isSE = ColorConverter.#isSwapEndianFormat(stageInputFormat);
        const bytesPerSample = stageInputFormat & 0x7; // T_BYTES field

        if (isFloat) {
            return this.#policy.getStandardFormat(colorSpace, 32);
        } else if (bytesPerSample === 2) {
            // 16-bit: use policy to get the correct 16-bit format (preserves SE if needed)
            const endianness = isSE ? 'big' : 'native';
            return this.#policy.getInputFormat({
                colorSpace,
                bitsPerComponent: 16,
                endianness,
            });
        } else {
            // 8-bit: use standard 8-bit format
            return this.#policy.getStandardFormat(colorSpace, 8);
        }
    }

    /**
     * Executes a multi-stage transform chain with intermediate buffers.
     *
     * Each stage transforms pixels from its input format to its output format.
     * Intermediate buffers are allocated and passed between stages.
     *
     * @param {import('./color-engine-provider.js').ColorEngineProvider} provider
     * @param {{ transform: number, inputFormat: number, outputFormat: number }[]} stages
     * @param {Uint8Array | Uint16Array | Float32Array} inputBuffer
     * @param {Uint8Array | Uint16Array | Float32Array} outputBuffer
     * @param {number} pixelCount
     */
    #executeMultiStageTransform(provider, stages, inputBuffer, outputBuffer, pixelCount) {
        let currentInput = inputBuffer;

        for (let i = 0; i < stages.length; i++) {
            const stage = stages[i];
            const isLastStage = (i === stages.length - 1);
            const currentOutput = isLastStage
                ? outputBuffer
                : this.#policy.createOutputBuffer(stage.outputFormat, pixelCount);

            provider.transformArray(stage.transform, currentInput, currentOutput, pixelCount);
            currentInput = currentOutput;
        }
    }

    /**
     * Gets number of channels from a pixel format constant.
     * @param {number} format - LittleCMS pixel format constant
     * @returns {number}
     */
    #getChannelsFromFormat(format) {
        // Extract channels from format: CHANNELS_SH is at bits 3-6
        return ((format >> 3) & 0xF);
    }

    // ========================================
    // Worker Mode Support
    // ========================================

    /**
     * Indicates whether this converter supports worker mode.
     *
     * Override in subclasses that can run in web workers.
     *
     * @returns {boolean} True if worker mode is supported
     */
    get supportsWorkerMode() {
        return false;
    }

    /**
     * Prepares a task for worker thread execution.
     *
     * Override in subclasses to serialize input for worker transfer.
     *
     * @param {ColorConverterInput} input - Input data
     * @param {ColorConverterContext} context - Conversion context
     * @returns {WorkerTask | null} Serializable task data or null if not supported
     */
    prepareWorkerTask(input, context) {
        return null;
    }

    /**
     * Applies worker result back to the converter.
     *
     * Override in subclasses to deserialize and apply worker output.
     *
     * @param {ColorConverterInput} input - Original input data
     * @param {WorkerResult} workerResult - Result from worker
     * @param {ColorConverterContext} context - Conversion context
     * @returns {Promise<void>}
     */
    async applyWorkerResult(input, workerResult, context) {
        // Default: no-op. Subclasses override for worker result handling.
    }

    // ========================================
    // Per-Reference Configuration Overrides
    // ========================================

    /**
     * Sets configuration override for a specific reference.
     *
     * Overrides are merged with base configuration when processing
     * the specified reference (e.g., specific page or image).
     *
     * @param {any} reference - PDF reference or string key
     * @param {Partial<ColorConverterConfiguration>} configuration - Partial override
     * @example
     * ```javascript
     * // Override settings for a specific page
     * converter.setConfigurationFor(page3Ref, {
     *     renderingIntent: 'perceptual',
     *     convertImages: false,
     * });
     * ```
     */
    setConfigurationFor(reference, configuration) {
        const key = this.#normalizeReference(reference);
        this.#referenceOverrides.set(key, Object.freeze({ ...configuration }));
    }

    /**
     * Gets raw override for a reference (without base merge).
     *
     * @param {any} reference - PDF reference or string key
     * @returns {Readonly<Partial<ColorConverterConfiguration>> | undefined} Override or undefined
     */
    getConfigurationFor(reference) {
        const key = this.#normalizeReference(reference);
        return this.#referenceOverrides.get(key);
    }

    /**
     * Gets effective configuration for a reference (base + override merged).
     *
     * @param {any} reference - PDF reference or string key
     * @returns {Readonly<ColorConverterConfiguration>} Merged configuration
     * @example
     * ```javascript
     * const effectiveConfig = converter.getEffectiveConfigurationFor(imageRef);
     * console.log(effectiveConfig.renderingIntent);
     * ```
     */
    getEffectiveConfigurationFor(reference) {
        const override = this.getConfigurationFor(reference);
        if (!override) {
            return this.configuration;
        }
        return Object.freeze({ ...this.configuration, ...override });
    }

    /**
     * Checks if an override exists for a reference.
     *
     * @param {any} reference - PDF reference or string key
     * @returns {boolean} True if override exists
     */
    hasConfigurationFor(reference) {
        const key = this.#normalizeReference(reference);
        return this.#referenceOverrides.has(key);
    }

    /**
     * Removes override for a reference.
     *
     * @param {any} reference - PDF reference or string key
     * @returns {boolean} True if override was removed
     */
    removeConfigurationFor(reference) {
        const key = this.#normalizeReference(reference);
        return this.#referenceOverrides.delete(key);
    }

    /**
     * Clears all per-reference overrides.
     */
    clearConfigurationOverrides() {
        this.#referenceOverrides.clear();
    }

    // ========================================
    // Parent-Child Relationships
    // ========================================

    /**
     * Creates a child converter with merged configuration.
     *
     * The child converter inherits base configuration, merged with
     * any provided overrides. Parent-child relationship is established.
     *
     * @template {typeof ColorConverter} T
     * @param {T} ConverterClass - Child converter class
     * @param {Partial<ColorConverterConfiguration>} [configOverrides={}] - Configuration overrides
     * @returns {InstanceType<T>} New child converter instance
     * @example
     * ```javascript
     * const pageConverter = documentConverter.createChildConverter(
     *     PDFPageColorConverter,
     *     { convertImages: true }
     * );
     * ```
     */
    createChildConverter(ConverterClass, configOverrides = {}) {
        const childConfig = { ...this.#configuration, ...configOverrides };
        const child = new ConverterClass(childConfig, {
            colorEngineProvider: this.#colorEngineProvider ?? undefined,
            policy: this.#policy,
            colorEngineService: this.#legacyColorEngineService ?? undefined, // Backward compatibility
        });
        child.parentConverter = this;
        return /** @type {InstanceType<T>} */ (child);
    }

    // ========================================
    // Resource Cleanup
    // ========================================

    /**
     * Releases resources held by this converter.
     *
     * Override in subclasses to clean up caches, handles, or pools.
     * Always call `super.dispose()` when overriding.
     *
     * @example
     * ```javascript
     * dispose() {
     *     this.#myCache.clear();
     *     super.dispose();
     * }
     * ```
     */
    dispose() {
        const provider = this.#colorEngineProvider;

        // Clean up cached transforms first (they reference profiles)
        if (provider) {
            for (const cached of this.#transformCache.values()) {
                try {
                    provider.deleteTransform(cached.transform);
                } catch (e) {
                    // Ignore errors during cleanup
                }
            }
            for (const cached of this.#multiprofileTransformCache.values()) {
                try {
                    provider.deleteTransform(cached.transform);
                } catch (e) {
                    // Ignore errors during cleanup
                }
            }

            // Clean up cached profiles
            for (const handle of this.#profileHandleCache.values()) {
                try {
                    provider.closeProfile(handle);
                } catch (e) {
                    // Ignore errors during cleanup
                }
            }
        }

        this.#transformCache.clear();
        this.#multiprofileTransformCache.clear();
        this.#profileHandleCache.clear();

        if (this.#ownsColorEngineProvider && this.#colorEngineProvider) {
            this.#colorEngineProvider.dispose();
            this.#colorEngineProvider = null;
        }

        // Clean up legacy service (backward compatibility)
        if (this.#ownsLegacyColorEngineService && this.#legacyColorEngineService) {
            this.#legacyColorEngineService.dispose();
            this.#legacyColorEngineService = null;
        }

        this.#referenceOverrides.clear();
        this.#parentConverter = null;
    }

    // ========================================
    // Private Helpers
    // ========================================

    /**
     * Normalizes a reference to a consistent string key.
     *
     * Handles both string keys and PDFRef objects.
     *
     * @param {any} reference - PDF reference or string key
     * @returns {string} Normalized key
     */
    #normalizeReference(reference) {
        if (typeof reference === 'string') {
            return reference;
        }
        // Handle PDFRef: use "objectNumber-generationNumber" format
        if (reference && typeof reference.objectNumber === 'number') {
            return `${reference.objectNumber}-${reference.generationNumber ?? 0}`;
        }
        // Fallback: convert to string
        return String(reference);
    }

    /// TODO: Follow web conventions for constants on globals like Node.ELEMENT_NODE
    //
    // static PERCEPTUAL_RENDERING_INTENT_CODE = 0;
    // static RELATIVE_COLORIMETRIC_RENDERING_INTENT_CODE = 1;
    // static SATURATION_RENDERING_INTENT_CODE = 2;
    // static ABSOLUTE_COLORIMETRIC_RENDERING_INTENT_CODE = 3;
    // static K_ONLY_GCR_RENDERING_INTENT_CODE = 20;

    // /**
    //  * @template {string} T
    //  * @param {RenderingIntent|T} intent 
    //  * @returns {number} Numeric intent code
    //  */
    // static renderingIntentCodeFromString(intent) {
    //     switch (/^(?=.*?([-_ ])|)(?:(?<intent>perceptual|saturation)|(?<intent>absolute|^relative)(?:(?:\1|-)colorimetric)?|(?:preserve\1)?(?<intent>k(?:\1|-)only)(?:\1relative(?:(?:\1|-)colorimetric)?)?(?:\1gcr)?)$/i.exec(intent)?.groups?.intent?.toLowerCase()?.replaceAll(/[-_ ]/g, '-') ?? null) {
    //         case 'perceptual':
    //             return ColorConverter.PERCEPTUAL_RENDERING_INTENT_CODE;
    //         case 'relative':
    //             return ColorConverter.RELATIVE_COLORIMETRIC_RENDERING_INTENT_CODE;
    //         case 'saturation':
    //             return ColorConverter.SATURATION_RENDERING_INTENT_CODE;
    //         case 'absolute':
    //             return ColorConverter.ABSOLUTE_COLORIMETRIC_RENDERING_INTENT_CODE;
    //         case 'k-only':
    //             return ColorConverter.K_ONLY_GCR_RENDERING_INTENT_CODE;
    //         default:
    //             return ColorConverter.RELATIVE_COLORIMETRIC_RENDERING_INTENT_CODE;
    //     }    
    // }
}

/// TODO: Follow web conventions for constants on globals like Node.ELEMENT_NODE
// // ============================================================================
// // Rendering Intent Constants
// // ============================================================================
//
// /**
//  * Numeric rendering intent codes for fast comparison.
//  *
//  * Using numeric codes instead of string comparison provides ~10x faster
//  * comparisons in hot paths (e.g., per color space group processing).
//  *
//  * Values match LittleCMS intent constants where applicable:
//  * - 0-3: Standard ICC intents
//  * - 20: Custom K-Only GCR intent
//  *
//  * @readonly
//  * @enum {number}
//  */
// export const RENDERING_INTENT_CODE = Object.freeze({
//     PERCEPTUAL: ColorConverter.PERCEPTUAL_RENDERING_INTENT_CODE,
//     RELATIVE_COLORIMETRIC: ColorConverter.RELATIVE_COLORIMETRIC_RENDERING_INTENT_CODE,
//     SATURATION: ColorConverter.SATURATION_RENDERING_INTENT_CODE,
//     ABSOLUTE_COLORIMETRIC: ColorConverter.ABSOLUTE_COLORIMETRIC_RENDERING_INTENT_CODE,
//     K_ONLY_GCR: ColorConverter.K_ONLY_GCR_RENDERING_INTENT_CODE,
// });
//
// export const getRenderingIntentCode = ColorConverter.renderingIntentCodeFromString;
