// @ts-check
/**
 * Image Lab Converter Class
 *
 * Conversion layer for transforming image pixels to Lab color space
 * for Delta-E computation. Manages color engine lifecycle and transform caching.
 *
 * Uses ColorEngineProvider from production classes for WASM color engine access.
 *
 * @module image-lab-converter
 */

import { ColorEngineProvider } from '../../classes/baseline/color-engine-provider.js';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * @typedef {{
 *   width: number,
 *   height: number,
 *   labPixels: Float32Array,
 * }} LabImageData
 */

/**
 * @typedef {{
 *   intent: 'perceptual' | 'relative-colorimetric' | 'saturation' | 'absolute-colorimetric',
 *   blackPointCompensation: boolean,
 * }} ConversionOptions
 */

/**
 * @typedef {{
 *   sourceProfile: number,
 *   transform: number,
 *   colorSpace: string,
 * }} CachedTransform
 */

// ============================================================================
// Constants
// ============================================================================

const INTENT_MAP = {
    'perceptual': 0,
    'relative-colorimetric': 1,
    'saturation': 2,
    'absolute-colorimetric': 3,
};

const DEFAULT_OPTIONS = {
    intent: /** @type {'relative-colorimetric'} */ ('relative-colorimetric'),
    blackPointCompensation: true,
};

// ============================================================================
// ImageLabConverter Class
// ============================================================================

export class ImageLabConverter {
    /** @type {ColorEngineProvider | null} */
    #provider = null;

    /** @type {number | null} */
    #labProfile = null;

    /** @type {Map<string, CachedTransform>} */
    #transformCache = new Map();

    /** @type {ConversionOptions} */
    #options;

    /** @type {boolean} */
    #initialized = false;

    /**
     * Create a new ImageLabConverter.
     *
     * @param {{
     *   intent?: string,
     *   blackPointCompensation?: boolean,
     *   transform?: {
     *     intent?: string,
     *     blackPointCompensation?: boolean,
     *   },
     * }} [options]
     */
    constructor(options = {}) {
        // Support both flat options and nested transform object
        const transform = options.transform ?? {};

        this.#options = {
            intent: /** @type {'perceptual' | 'relative-colorimetric' | 'saturation' | 'absolute-colorimetric'} */ (
                options.intent ?? transform.intent ?? DEFAULT_OPTIONS.intent
            ),
            blackPointCompensation:
                options.blackPointCompensation ?? transform.blackPointCompensation ?? DEFAULT_OPTIONS.blackPointCompensation,
        };
    }

    // ========================================
    // Lifecycle
    // ========================================

    /**
     * Initialize the converter (lazy initialization).
     * Safe to call multiple times.
     *
     * @returns {Promise<void>}
     */
    async initialize() {
        if (this.#initialized) {
            return;
        }

        this.#provider = new ColorEngineProvider();
        await this.#provider.initialize();

        // Create Lab D50 profile for output
        this.#labProfile = this.#provider.createLab4Profile();

        this.#initialized = true;
    }

    /**
     * Check if initialized.
     *
     * @returns {boolean}
     */
    get isInitialized() {
        return this.#initialized;
    }

    /**
     * Dispose of cached resources.
     */
    dispose() {
        // Close all cached transforms and source profiles
        if (this.#provider?.isReady) {
            for (const { sourceProfile, transform } of this.#transformCache.values()) {
                try {
                    this.#provider.engine.deleteTransform(transform);
                    this.#provider.closeProfile(sourceProfile);
                } catch (e) {
                    // Ignore cleanup errors
                }
            }

            if (this.#labProfile !== null) {
                try {
                    this.#provider.closeProfile(this.#labProfile);
                } catch (e) {
                    // Ignore cleanup errors
                }
            }
        }

        this.#transformCache.clear();
        this.#labProfile = null;
        this.#provider = null;
        this.#initialized = false;
    }

    // ========================================
    // Conversion
    // ========================================

    /**
     * Convert entire image pixels to Lab.
     *
     * @param {Uint8Array} pixelData - Input pixel data
     * @param {number} width - Image width
     * @param {number} height - Image height
     * @param {number} channels - Number of channels (1=Gray, 3=RGB, 4=CMYK)
     * @param {ArrayBuffer | Uint8Array} sourceProfile - ICC profile data
     * @param {string} [cacheKey='default'] - Cache key for transform reuse
     * @returns {LabImageData}
     */
    convert(pixelData, width, height, channels, sourceProfile, cacheKey = 'default') {
        this.#ensureReady();

        const transform = this.#getOrCreateTransform(sourceProfile, channels, cacheKey);
        const pixelCount = width * height;

        // Output as Float32 Lab (L: 0-100, a/b: -128 to 127)
        const labPixels = new Float32Array(pixelCount * 3);

        this.#provider.engine.transformArray(transform.transform, pixelData, labPixels, pixelCount);

        return { width, height, labPixels };
    }

    /**
     * Convert pixels at specific indices only.
     * More efficient for sampled comparisons on large images.
     *
     * @param {Uint8Array} pixelData - Full image pixel data
     * @param {number} width - Image width
     * @param {number} height - Image height
     * @param {number} channels - Number of channels
     * @param {ArrayBuffer | Uint8Array | 'Lab'} sourceProfile - ICC profile data or 'Lab' for Lab images
     * @param {number[]} indices - Pixel indices to convert
     * @param {string} [cacheKey='default'] - Cache key for transform reuse
     * @returns {Float32Array} Lab values at indices (L,a,b interleaved)
     */
    convertAtIndices(pixelData, width, height, channels, sourceProfile, indices, cacheKey = 'default') {
        this.#ensureReady();

        const sampleCount = indices.length;

        // Handle Lab images specially - they're already in Lab, just need format conversion
        if (sourceProfile === 'Lab') {
            return this.#convertLabAtIndices(pixelData, channels, indices);
        }

        const transform = this.#getOrCreateTransform(sourceProfile, channels, cacheKey);

        // Extract only the pixels we need
        const sampledPixels = new Uint8Array(sampleCount * channels);
        for (let i = 0; i < sampleCount; i++) {
            const srcOffset = indices[i] * channels;
            const dstOffset = i * channels;
            for (let c = 0; c < channels; c++) {
                sampledPixels[dstOffset + c] = pixelData[srcOffset + c];
            }
        }

        // Output as Float32 Lab
        const labPixels = new Float32Array(sampleCount * 3);

        this.#provider.engine.transformArray(transform.transform, sampledPixels, labPixels, sampleCount);

        return labPixels;
    }

    /**
     * Convert 8-bit Lab pixels to Float32 Lab at specific indices.
     * Uses a Lab→Lab transform via the color engine for proper format conversion.
     *
     * @param {Uint8Array} pixelData - Full image pixel data (Lab 8-bit)
     * @param {number} channels - Should be 3 for Lab
     * @param {number[]} indices - Pixel indices to convert
     * @returns {Float32Array} Lab values at indices (L,a,b interleaved)
     */
    #convertLabAtIndices(pixelData, channels, indices) {
        if (channels !== 3) {
            throw new Error(`Lab images must have 3 channels, got ${channels}`);
        }

        const provider = /** @type {ColorEngineProvider} */ (this.#provider);
        const module = provider.module;
        const sampleCount = indices.length;

        // Get or create Lab→Lab transform (Lab 8-bit to Lab float)
        const cacheKey = 'lab-to-lab:3';
        let transform;

        if (this.#transformCache.has(cacheKey)) {
            const cached = /** @type {CachedTransform} */ (this.#transformCache.get(cacheKey));
            transform = cached.transform;
        } else {
            // Create Lab→Lab transform using the Lab D50 profile for both source and destination
            // TYPE_Lab_8 for input (8-bit Lab), TYPE_Lab_FLT for output (float Lab)
            const labTransform = provider.createTransform(
                /** @type {number} */ (this.#labProfile),
                module.TYPE_Lab_8,
                /** @type {number} */ (this.#labProfile),
                module.TYPE_Lab_FLT,
                0, // INTENT_PERCEPTUAL (doesn't matter for Lab→Lab)
                0  // No flags
            );

            if (!labTransform) {
                throw new Error('Failed to create Lab→Lab transform');
            }

            // Cache the transform (use a dummy source profile since it's the same Lab profile)
            this.#transformCache.set(cacheKey, {
                sourceProfile: /** @type {number} */ (this.#labProfile),
                transform: labTransform,
                colorSpace: 'Lab',
            });
            transform = labTransform;
        }

        // Extract only the pixels we need
        const sampledPixels = new Uint8Array(sampleCount * 3);
        for (let i = 0; i < sampleCount; i++) {
            const srcOffset = indices[i] * 3;
            const dstOffset = i * 3;
            sampledPixels[dstOffset] = pixelData[srcOffset];
            sampledPixels[dstOffset + 1] = pixelData[srcOffset + 1];
            sampledPixels[dstOffset + 2] = pixelData[srcOffset + 2];
        }

        // Output as Float32 Lab
        const labPixels = new Float32Array(sampleCount * 3);
        provider.engine.transformArray(transform, sampledPixels, labPixels, sampleCount);

        return labPixels;
    }

    // ========================================
    // Transform Management (Private)
    // ========================================

    /**
     * @throws {Error} If not initialized
     */
    #ensureReady() {
        if (!this.#initialized || !this.#provider) {
            throw new Error('ImageLabConverter not initialized. Call initialize() first.');
        }
    }

    /**
     * Get or create a transform for the given source profile.
     *
     * @param {ArrayBuffer | Uint8Array} sourceProfileData
     * @param {number} channels
     * @param {string} cacheKey
     * @returns {CachedTransform}
     * @throws {Error} If profile is invalid or transform creation fails
     */
    #getOrCreateTransform(sourceProfileData, channels, cacheKey) {
        const fullKey = `${cacheKey}:${channels}`;

        if (this.#transformCache.has(fullKey)) {
            return /** @type {CachedTransform} */ (this.#transformCache.get(fullKey));
        }

        const provider = /** @type {ColorEngineProvider} */ (this.#provider);
        const module = provider.module;

        // Open source profile with error handling
        const profileData = sourceProfileData instanceof Uint8Array
            ? sourceProfileData
            : new Uint8Array(sourceProfileData);

        let sourceProfile;
        try {
            sourceProfile = provider.openProfileFromMem(profileData);
        } catch (error) {
            throw new Error(`Failed to open source profile for "${cacheKey}": ${error.message}`);
        }

        if (!sourceProfile) {
            throw new Error(`Invalid ICC profile data for "${cacheKey}"`);
        }

        // Determine input format based on channel count
        let inputFormat;
        let colorSpace;

        switch (channels) {
            case 1:
                inputFormat = module.TYPE_GRAY_8;
                colorSpace = 'Gray';
                break;
            case 3:
                inputFormat = module.TYPE_RGB_8;
                colorSpace = 'RGB';
                break;
            case 4:
                inputFormat = module.TYPE_CMYK_8;
                colorSpace = 'CMYK';
                break;
            default:
                throw new Error(`Unsupported channel count: ${channels}`);
        }

        // Build flags
        const intent = INTENT_MAP[this.#options.intent] ?? 1;
        const flags = this.#options.blackPointCompensation
            ? module.cmsFLAGS_BLACKPOINTCOMPENSATION
            : 0;

        // Create transform to Lab float with error handling
        let transform;
        try {
            transform = provider.createTransform(
                sourceProfile,
                inputFormat,
                /** @type {number} */ (this.#labProfile),
                module.TYPE_Lab_FLT,
                intent,
                flags
            );
        } catch (error) {
            // Clean up the source profile on failure
            try {
                provider.closeProfile(sourceProfile);
            } catch (e) {
                // Ignore cleanup errors
            }
            throw new Error(`Failed to create transform for "${cacheKey}" (${colorSpace}→Lab): ${error.message}`);
        }

        if (!transform) {
            try {
                provider.closeProfile(sourceProfile);
            } catch (e) {
                // Ignore cleanup errors
            }
            throw new Error(`Transform creation returned null for "${cacheKey}" (${colorSpace}→Lab)`);
        }

        const cached = { sourceProfile, transform, colorSpace };
        this.#transformCache.set(fullKey, cached);

        return cached;
    }

    // ========================================
    // Configuration Access
    // ========================================

    /**
     * Get current conversion options.
     *
     * @returns {ConversionOptions}
     */
    getOptions() {
        return { ...this.#options };
    }

    /**
     * Get color engine constants (after initialization).
     *
     * @returns {object}
     */
    getConstants() {
        this.#ensureReady();
        return /** @type {ColorEngineProvider} */ (this.#provider).module;
    }

    // ========================================
    // Factory Methods
    // ========================================

    /**
     * Create an ImageLabConverter from a metrics class's metricDefinitions.
     * Convenience factory for use with self-describing metrics.
     *
     * @param {object} metricDefinitions
     * @param {object} [overrides]
     * @returns {ImageLabConverter}
     */
    static fromMetricDefinitions(metricDefinitions, overrides = {}) {
        const transform = {
            ...metricDefinitions.transform,
            ...overrides.transform,
        };

        return new ImageLabConverter({
            intent: transform.intent,
            blackPointCompensation: transform.blackPointCompensation,
        });
    }

    // ========================================
    // Serialization
    // ========================================

    /**
     * Create transferable data (options only - engine not transferable).
     *
     * @returns {object}
     */
    toTransferable() {
        return {
            options: this.#options,
        };
    }

    /**
     * Revive from transferable data.
     * Note: Must call initialize() after revival.
     *
     * @param {object} data
     * @returns {ImageLabConverter}
     */
    static fromTransferable(data) {
        return new ImageLabConverter(data.options);
    }

    /**
     * Create string representation.
     *
     * @returns {string}
     */
    toString() {
        return `ImageLabConverter(intent=${this.#options.intent}, bpc=${this.#options.blackPointCompensation})`;
    }
}
