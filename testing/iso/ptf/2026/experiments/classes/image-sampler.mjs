// @ts-check
/**
 * Image Sampler Class
 *
 * Configurable pixel sampling with multiple strategies for image comparison.
 * Supports random, uniform grid, and overall (all pixels) sampling.
 *
 * Design: Receives sampling type definitions from coordinator/metrics class,
 * allowing future extensibility without modifying this class.
 *
 * @module image-sampler
 */

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * @typedef {{
 *   type: string,
 *   name: string,
 *   count?: number,
 *   seed?: number,
 *   interval?: number,
 *   intervals?: [number, number],
 * }} NormalizedSamplingConfig
 */

/**
 * @typedef {{
 *   indices: number[],
 *   method: string,
 *   totalPixels: number,
 *   sampledCount: number,
 * }} SamplingResult
 */

/**
 * @typedef {string | { type: string, name?: string, count?: number, seed?: number, interval?: number, intervals?: [number, number] } | Array<string | object>} SamplingSchema
 */

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_SAMPLING_TYPES = {
    random: { name: 'Random' },
    uniform: { name: 'Uniform' },
    overall: { name: 'Overall' },
};

const DEFAULT_SAMPLING_CONFIG = {
    count: 10000,
    seed: 42,
};

// ============================================================================
// ImageSampler Class
// ============================================================================

export class ImageSampler {
    /** @type {NormalizedSamplingConfig[]} */
    #samplingConfigs;

    /** @type {Record<string, { name: string }>} */
    #samplingTypes;

    /** @type {{ count: number, seed: number }} */
    #defaults;

    /**
     * Create a new ImageSampler.
     *
     * @param {{
     *   sampling?: SamplingSchema,
     *   samplingTypes?: Record<string, { name: string }>,
     *   defaults?: { count?: number, seed?: number },
     * }} [options]
     */
    constructor(options = {}) {
        this.#samplingTypes = options.samplingTypes ?? DEFAULT_SAMPLING_TYPES;
        this.#defaults = {
            count: options.defaults?.count ?? DEFAULT_SAMPLING_CONFIG.count,
            seed: options.defaults?.seed ?? DEFAULT_SAMPLING_CONFIG.seed,
        };

        // Normalize sampling schema
        this.#samplingConfigs = ImageSampler.#normalizeSampling(
            options.sampling ?? 'random',
            this.#samplingTypes,
            this.#defaults
        );
    }

    // ========================================
    // Static Schema Normalization
    // ========================================

    /**
     * Normalize sampling schema to array of NormalizedSamplingConfig.
     * Supports flexible input: string, object, array, or mixed.
     *
     * @param {SamplingSchema} schema
     * @param {Record<string, { name: string }>} samplingTypes
     * @param {{ count: number, seed: number }} defaults
     * @returns {NormalizedSamplingConfig[]}
     */
    static #normalizeSampling(schema, samplingTypes, defaults) {
        // Handle single value or array
        const items = Array.isArray(schema) ? schema : [schema];

        return items.map(item => {
            if (typeof item === 'string') {
                const type = item.toLowerCase();
                return {
                    type,
                    name: samplingTypes[type]?.name ?? item,
                    count: defaults.count,
                    seed: defaults.seed,
                };
            }

            // Object form
            const type = item.type?.toLowerCase() ?? item.type;
            return {
                type,
                name: item.name ?? samplingTypes[type]?.name ?? type,
                count: item.count ?? defaults.count,
                seed: item.seed ?? defaults.seed,
                interval: item.interval,
                intervals: item.intervals,
            };
        });
    }

    // ========================================
    // Sampling Methods
    // ========================================

    /**
     * Sample pixel indices from an image using configured strategy.
     *
     * @param {number} width - Image width
     * @param {number} height - Image height
     * @param {number} [configIndex=0] - Which sampling config to use
     * @returns {SamplingResult}
     */
    sample(width, height, configIndex = 0) {
        const config = this.#samplingConfigs[configIndex] ?? this.#samplingConfigs[0];
        const totalPixels = width * height;

        let indices;
        switch (config.type) {
            case 'random':
                indices = this.#sampleRandom(totalPixels, config);
                break;
            case 'uniform':
                indices = this.#sampleUniform(width, height, config);
                break;
            case 'overall':
                indices = this.#sampleOverall(totalPixels);
                break;
            default:
                // Unknown type falls back to random
                console.warn(`[ImageSampler] Unknown sampling type "${config.type}", using random`);
                indices = this.#sampleRandom(totalPixels, config);
        }

        return {
            indices,
            method: config.name,
            totalPixels,
            sampledCount: indices.length,
        };
    }

    /**
     * Get all configured sampling methods.
     *
     * @returns {NormalizedSamplingConfig[]}
     */
    getSamplingConfigs() {
        return [...this.#samplingConfigs];
    }

    /**
     * Get count of configured sampling methods.
     *
     * @returns {number}
     */
    get configCount() {
        return this.#samplingConfigs.length;
    }

    // ========================================
    // Sampling Strategies (Private)
    // ========================================

    /**
     * Random sampling with optional interval support.
     *
     * @param {number} totalPixels
     * @param {NormalizedSamplingConfig} config
     * @returns {number[]}
     */
    #sampleRandom(totalPixels, config) {
        // Handle interval-based count (e.g., interval: 0.2 = 20% of pixels)
        const targetCount = config.interval
            ? Math.floor(totalPixels * config.interval)
            : config.count ?? this.#defaults.count;

        // If target is greater than total, return all pixels
        if (targetCount >= totalPixels) {
            return this.#sampleOverall(totalPixels);
        }

        const seed = config.seed ?? this.#defaults.seed;
        const random = ImageSampler.#createSeededRandom(seed);

        // Use Set for deduplication
        const indices = new Set();
        let attempts = 0;
        const maxAttempts = targetCount * 10; // Prevent infinite loop

        while (indices.size < targetCount && attempts < maxAttempts) {
            const index = Math.floor(random() * totalPixels);
            indices.add(index);
            attempts++;
        }

        // Sort for cache-friendly access pattern
        return Array.from(indices).sort((a, b) => a - b);
    }

    /**
     * Uniform grid sampling.
     *
     * @param {number} width
     * @param {number} height
     * @param {NormalizedSamplingConfig} config
     * @returns {number[]}
     */
    #sampleUniform(width, height, config) {
        const totalPixels = width * height;

        // Use explicit intervals [rowStep, colStep] if provided
        if (config.intervals) {
            const [rowStep, colStep] = config.intervals;
            const indices = [];

            for (let y = 0; y < height; y += rowStep) {
                for (let x = 0; x < width; x += colStep) {
                    indices.push(y * width + x);
                }
            }

            return indices;
        }

        // Otherwise compute step from target count
        const targetCount = config.count ?? this.#defaults.count;

        // Compute step to achieve approximately targetCount samples
        const step = Math.max(1, Math.floor(Math.sqrt(totalPixels / targetCount)));

        const indices = [];
        for (let y = 0; y < height; y += step) {
            for (let x = 0; x < width; x += step) {
                indices.push(y * width + x);
            }
        }

        return indices;
    }

    /**
     * Overall sampling - returns all pixel indices.
     *
     * @param {number} totalPixels
     * @returns {number[]}
     */
    #sampleOverall(totalPixels) {
        return Array.from({ length: totalPixels }, (_, i) => i);
    }

    // ========================================
    // Static Utilities
    // ========================================

    /**
     * Create a seeded pseudo-random number generator (mulberry32).
     * Provides reproducible random sequences.
     *
     * @param {number} seed
     * @returns {() => number}
     */
    static #createSeededRandom(seed) {
        return function () {
            let t = (seed += 0x6d2b79f5);
            t = Math.imul(t ^ (t >>> 15), t | 1);
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    /**
     * Create an ImageSampler from a metrics class's metricDefinitions.
     * Convenience factory for use with self-describing metrics.
     *
     * @param {object} metricDefinitions
     * @param {object} [overrides]
     * @returns {ImageSampler}
     */
    static fromMetricDefinitions(metricDefinitions, overrides = {}) {
        return new ImageSampler({
            sampling: overrides.sampling ?? metricDefinitions.defaults?.sampling,
            samplingTypes: metricDefinitions.samplingTypes,
            defaults: {
                count: metricDefinitions.defaults?.sampling?.count,
                seed: metricDefinitions.defaults?.sampling?.seed,
            },
        });
    }

    // ========================================
    // Serialization
    // ========================================

    /**
     * Create transferable data for structured clone.
     *
     * @returns {object}
     */
    toTransferable() {
        return {
            samplingConfigs: this.#samplingConfigs,
            samplingTypes: this.#samplingTypes,
            defaults: this.#defaults,
        };
    }

    /**
     * Revive from transferable data.
     *
     * @param {object} data
     * @returns {ImageSampler}
     */
    static fromTransferable(data) {
        const instance = new ImageSampler({
            samplingTypes: data.samplingTypes,
            defaults: data.defaults,
        });
        instance.#samplingConfigs = data.samplingConfigs;
        return instance;
    }

    /**
     * Create string representation.
     *
     * @returns {string}
     */
    toString() {
        const configs = this.#samplingConfigs.map(c => c.name).join(', ');
        return `ImageSampler(${configs})`;
    }
}
