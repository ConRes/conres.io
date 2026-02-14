// @ts-check
/**
 * Lookup Table Color Converter
 *
 * Extends ColorConverter with caching for discrete color values.
 * Optimizes repeated conversions of the same color by storing
 * results in a lookup table.
 *
 * @module LookupTableColorConverter
 */

import { ColorConverter } from './color-converter.js';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Configuration for LookupTableColorConverter.
 *
 * @typedef {import('./color-converter.js').ColorConverterConfiguration & {
 *   useLookupTable: boolean,
 *   lookupTableThreshold?: number,
 *   bufferRegistry?: import('./buffer-registry.js').BufferRegistry,
 *   sourceRGBProfile?: ArrayBuffer,
 *   sourceGrayProfile?: ArrayBuffer,
 * }} LookupTableColorConverterConfiguration
 */

/**
 * Input data for lookup table conversion.
 *
 * @typedef {{
 *   colorSpace: 'RGB' | 'Gray' | 'Lab',
 *   values: number[],
 *   sourceProfile?: ArrayBuffer,
 * }} LookupTableColorConverterInput
 */

/**
 * Result of lookup table conversion.
 *
 * @typedef {{
 *   colorSpace: 'CMYK' | 'RGB',
 *   values: number[],
 *   cacheHit: boolean,
 * }} LookupTableColorConverterResult
 */

// ============================================================================
// Constants
// ============================================================================

/** Default threshold before using lookup table (number of colors). */
const DEFAULT_LOOKUP_THRESHOLD = 10;

// ============================================================================
// LookupTableColorConverter Class
// ============================================================================

/**
 * Converts discrete color values with lookup table caching.
 *
 * Optimizes repeated conversions by caching results keyed by
 * color space and values. Useful for content stream color conversion
 * where the same colors may appear multiple times.
 *
 * @extends ColorConverter
 * @example
 * ```javascript
 * const converter = new LookupTableColorConverter({
 *     renderingIntent: 'relative-colorimetric',
 *     blackPointCompensation: true,
 *     useAdaptiveBPCClamping: false,
 *     destinationProfile: cmykProfileBuffer,
 *     destinationColorSpace: 'CMYK',
 *     useLookupTable: true,
 *     lookupTableThreshold: 5,
 *     verbose: false,
 * });
 *
 * // First call: actual conversion
 * const result1 = await converter.convertColor({ colorSpace: 'RGB', values: [255, 0, 0] });
 *
 * // Second call: cache hit
 * const result2 = await converter.convertColor({ colorSpace: 'RGB', values: [255, 0, 0] });
 * console.log(result2.cacheHit); // true
 * ```
 */
export class LookupTableColorConverter extends ColorConverter {
    // ========================================
    // Private Fields
    // ========================================

    /**
     * Buffer registry for shared color lookup caching.
     * When provided via config, enables cross-instance cache sharing.
     * @type {import('./buffer-registry.js').BufferRegistry | null}
     */
    #bufferRegistry = null;

    /**
     * Fallback lookup table when no BufferRegistry provided.
     * Key format: "colorSpace:v1,v2,v3"
     * @type {Record<string, number[]>}
     */
    #fallbackLookupTable = {};

    /**
     * Maximum entries in fallback lookup table.
     * @type {number}
     */
    #maxFallbackEntries = 10000;

    /**
     * Count of conversions to determine when to enable cache.
     * @type {number}
     */
    #conversionCount = 0;

    /**
     * Statistics for cache hits/misses (used when no BufferRegistry).
     * @type {{hits: number, misses: number}}
     */
    #cacheStats = { hits: 0, misses: 0 };

    /**
     * Cached conversion config for BufferRegistry lookups.
     * @type {import('./buffer-registry.js').ColorConversionConfig | null}
     */
    #cachedConversionConfig = null;

    // ========================================
    // Constructor
    // ========================================

    /**
     * Creates a new LookupTableColorConverter instance.
     *
     * @param {LookupTableColorConverterConfiguration} configuration - Immutable configuration
     * @param {object} [options={}] - Additional options
     * @param {import('../../services/ColorEngineService.js').ColorEngineService} [options.colorEngineService] - Shared service
     */
    constructor(configuration, options = {}) {
        super(configuration, options);
        // Initialize buffer registry from config (may be shared across instances)
        this.#bufferRegistry = configuration.bufferRegistry ?? null;
    }

    // ========================================
    // Buffer Registry Access
    // ========================================

    /**
     * Gets the BufferRegistry if configured.
     * @returns {import('./buffer-registry.js').BufferRegistry | null}
     */
    get bufferRegistry() {
        return this.#bufferRegistry;
    }

    /**
     * Gets the conversion config for BufferRegistry lookups.
     * Cached at instance level since configuration is immutable.
     * @returns {import('./buffer-registry.js').ColorConversionConfig}
     */
    #getConversionConfig() {
        if (!this.#cachedConversionConfig) {
            const config = this.configuration;
            this.#cachedConversionConfig = {
                destinationProfile: config.destinationProfile,
                renderingIntent: config.renderingIntent,
                blackPointCompensation: config.blackPointCompensation,
                sourceRGBProfile: config.sourceRGBProfile,
                sourceGrayProfile: config.sourceGrayProfile,
            };
        }
        return this.#cachedConversionConfig;
    }

    // ========================================
    // Configuration Access
    // ========================================

    /**
     * Gets the configuration as LookupTableColorConverterConfiguration.
     * @returns {Readonly<LookupTableColorConverterConfiguration>}
     */
    get configuration() {
        return /** @type {Readonly<LookupTableColorConverterConfiguration>} */ (super.configuration);
    }

    /**
     * Whether lookup table is enabled.
     * @returns {boolean}
     */
    get useLookupTable() {
        return this.configuration.useLookupTable;
    }

    /**
     * Threshold before using lookup table.
     * @returns {number}
     */
    get lookupTableThreshold() {
        return this.configuration.lookupTableThreshold ?? DEFAULT_LOOKUP_THRESHOLD;
    }

    // ========================================
    // Lookup Table Stats
    // ========================================

    /**
     * Gets lookup table statistics.
     *
     * @returns {{
     *   size: number,
     *   hits: number,
     *   misses: number,
     *   hitRate: number,
     * }}
     */
    get lookupTableStats() {
        if (this.#bufferRegistry) {
            const stats = this.#bufferRegistry.stats.colorCache;
            return {
                size: stats.totalColors,
                hits: stats.hits,
                misses: stats.misses,
                hitRate: stats.hitRate,
            };
        }
        const total = this.#cacheStats.hits + this.#cacheStats.misses;
        return {
            size: Object.keys(this.#fallbackLookupTable).length,
            hits: this.#cacheStats.hits,
            misses: this.#cacheStats.misses,
            hitRate: total > 0 ? this.#cacheStats.hits / total : 0,
        };
    }

    // ========================================
    // Color Conversion
    // ========================================

    /**
     * Converts a color value with lookup table optimization.
     *
     * @param {LookupTableColorConverterInput} input - Color to convert
     * @param {import('./color-converter.js').ColorConverterContext} [context={}] - Conversion context
     * @returns {Promise<LookupTableColorConverterResult>} Converted color
     */
    async convertColor(input, context = {}) {
        await this.ensureReady();
        const { colorSpace, values } = input;

        this.#conversionCount++;

        // Check lookup table if enabled and threshold met
        if (this.useLookupTable && this.#conversionCount >= this.lookupTableThreshold) {
            let cached;
            if (this.#bufferRegistry) {
                cached = this.#bufferRegistry.lookupColor(this.#getConversionConfig(), colorSpace, values);
            } else {
                const key = this.#generateColorKey(colorSpace, values);
                cached = this.#fallbackLookupTable[key];
                if (cached) {
                    this.#cacheStats.hits++;
                }
            }
            if (cached) {
                return {
                    colorSpace: this.configuration.destinationColorSpace,
                    values: cached,
                    cacheHit: true,
                };
            }
        }

        // Perform actual conversion using batch method (single item batch)
        const [convertedValues] = await this.convertBatchUncached([input], context);

        // Cache result if lookup table enabled
        if (this.useLookupTable) {
            if (this.#bufferRegistry) {
                this.#bufferRegistry.storeColor(this.#getConversionConfig(), colorSpace, values, convertedValues);
            } else {
                const key = this.#generateColorKey(colorSpace, values);
                this.#storeFallbackColor(key, convertedValues);
                this.#cacheStats.misses++;
            }
        }

        return {
            colorSpace: this.configuration.destinationColorSpace,
            values: convertedValues,
            cacheHit: false,
        };
    }


    // ========================================
    // Batch Conversion
    // ========================================

    /**
     * Converts multiple colors with lookup table optimization.
     *
     * Separates colors into cached and uncached, processes uncached
     * in batch, then merges results.
     *
     * @param {LookupTableColorConverterInput[]} inputs - Colors to convert
     * @param {import('./color-converter.js').ColorConverterContext} context - Conversion context
     * @returns {Promise<LookupTableColorConverterResult[]>} Converted colors
     */
    async convertBatch(inputs, context) {
        /** @type {LookupTableColorConverterResult[]} */
        const results = new Array(inputs.length);

        /** @type {Array<{index: number, input: LookupTableColorConverterInput}>} */
        const uncached = [];

        const conversionConfig = this.#getConversionConfig();

        // Check cache for each input
        for (let i = 0; i < inputs.length; i++) {
            const input = inputs[i];
            let cached;

            if (this.useLookupTable) {
                if (this.#bufferRegistry) {
                    cached = this.#bufferRegistry.lookupColor(conversionConfig, input.colorSpace, input.values);
                } else {
                    const key = this.#generateColorKey(input.colorSpace, input.values);
                    cached = this.#fallbackLookupTable[key];
                    if (cached) {
                        this.#cacheStats.hits++;
                    }
                }
            }

            if (cached) {
                results[i] = {
                    colorSpace: this.configuration.destinationColorSpace,
                    values: cached,
                    cacheHit: true,
                };
            } else {
                uncached.push({ index: i, input });
            }
        }

        // Process uncached colors
        if (uncached.length > 0) {
            // Subclasses can override convertBatchUncached for optimized batch processing
            const batchResults = await this.convertBatchUncached(
                uncached.map(u => u.input),
                context
            );

            for (let i = 0; i < uncached.length; i++) {
                const { index, input } = uncached[i];
                const convertedValues = batchResults[i];

                // Cache result
                if (this.useLookupTable) {
                    if (this.#bufferRegistry) {
                        this.#bufferRegistry.storeColor(conversionConfig, input.colorSpace, input.values, convertedValues);
                    } else {
                        const key = this.#generateColorKey(input.colorSpace, input.values);
                        this.#storeFallbackColor(key, convertedValues);
                        this.#cacheStats.misses++;
                    }
                }

                results[index] = {
                    colorSpace: this.configuration.destinationColorSpace,
                    values: convertedValues,
                    cacheHit: false,
                };
            }
        }

        return results;
    }

    /**
     * Converts uncached colors in batch (abstract - subclasses must implement).
     *
     * @param {LookupTableColorConverterInput[]} inputs - Uncached colors
     * @param {import('./color-converter.js').ColorConverterContext} context - Conversion context
     * @returns {Promise<number[][]>} Converted color values
     */
    async convertBatchUncached(inputs, context) {
        throw new Error('LookupTableColorConverter.convertBatchUncached() is abstract and must be overridden');
    }

    // ========================================
    // Lookup Table Building
    // ========================================

    /**
     * Builds a lookup table from unique colors using batch conversion.
     *
     * @param {LookupTableColorConverterInput[]} uniqueColors - Unique colors to convert
     * @param {import('./color-converter.js').ColorConverterContext} [context={}] - Conversion context
     * @returns {Promise<Map<string, number[]>>} Lookup table mapping color keys to converted values
     */
    async buildLookupTable(uniqueColors, context = {}) {
        await this.ensureReady();

        if (uniqueColors.length === 0) {
            return new Map();
        }

        const lookupSpan = this.diagnostics.startSpan('build-lookup-table', {
            uniqueColors: uniqueColors.length,
        });

        /** @type {Map<string, number[]>} */
        const lookupTable = new Map();

        try {
            // Convert all unique colors in one batch
            const batchResults = await this.convertBatchUncached(uniqueColors, context);

            // Build lookup table
            const conversionConfig = this.#getConversionConfig();

            for (let i = 0; i < uniqueColors.length; i++) {
                const input = uniqueColors[i];
                const key = this.#generateColorKey(input.colorSpace, input.values);
                const convertedValues = batchResults[i];
                lookupTable.set(key, convertedValues);

                // Also store in shared cache
                if (this.useLookupTable) {
                    if (this.#bufferRegistry) {
                        this.#bufferRegistry.storeColor(conversionConfig, input.colorSpace, input.values, convertedValues);
                    } else {
                        this.#storeFallbackColor(key, convertedValues);
                    }
                }
            }

            this.diagnostics.updateSpan(lookupSpan, {
                tableSize: lookupTable.size,
            });
        } finally {
            this.diagnostics.endSpan(lookupSpan);
        }

        return lookupTable;
    }

    /**
     * Applies a lookup table to get converted color values.
     *
     * @param {Map<string, number[]>} lookupTable - Lookup table from buildLookupTable()
     * @param {LookupTableColorConverterInput} input - Color to look up
     * @returns {number[] | undefined} Converted values or undefined if not found
     */
    applyLookupTable(lookupTable, input) {
        const key = this.#generateColorKey(input.colorSpace, input.values);
        // First check provided lookup table
        const fromProvided = lookupTable.get(key);
        if (fromProvided) {
            return fromProvided;
        }
        // Then check shared cache
        if (this.#bufferRegistry) {
            return this.#bufferRegistry.lookupColor(this.#getConversionConfig(), input.colorSpace, input.values);
        }
        return this.#fallbackLookupTable[key];
    }

    // ========================================
    // Key Generation
    // ========================================

    /**
     * Generates a cache key for a color.
     *
     * @param {string} colorSpace - Color space name
     * @param {number[]} values - Color values
     * @returns {string} Cache key
     */
    #generateColorKey(colorSpace, values) {
        // Key format: "colorSpace:v1,v2,v3"
        return `${colorSpace}:${values.join(',')}`;
    }

    /**
     * Evict oldest fallback lookup entries (FIFO - 10%).
     */
    #evictFallbackEntries() {
        const keys = Object.keys(this.#fallbackLookupTable);
        const evictCount = Math.ceil(this.#maxFallbackEntries * 0.1);
        for (let i = 0; i < evictCount && i < keys.length; i++) {
            delete this.#fallbackLookupTable[keys[i]];
        }
    }

    /**
     * Stores a color in the fallback lookup table with size limit check.
     *
     * @param {string} key - Color key
     * @param {number[]} values - Converted color values
     */
    #storeFallbackColor(key, values) {
        this.#fallbackLookupTable[key] = values;
        if (Object.keys(this.#fallbackLookupTable).length > this.#maxFallbackEntries) {
            this.#evictFallbackEntries();
        }
    }

    // ========================================
    // Cache Management
    // ========================================

    /**
     * Clears the lookup table cache.
     *
     * Note: When using a shared BufferRegistry, this only clears instance-level
     * state. Call bufferRegistry.clearColorCache() to clear the shared cache.
     */
    clearLookupTable() {
        this.#fallbackLookupTable = {};
        this.#cacheStats = { hits: 0, misses: 0 };
        this.#conversionCount = 0;
        // Note: Don't clear bufferRegistry - it may be shared across instances
    }

    /**
     * Pre-populates the lookup table with known conversions.
     *
     * @param {Array<{colorSpace: string, values: number[], converted: number[]}>} entries
     */
    populateLookupTable(entries) {
        const conversionConfig = this.#getConversionConfig();
        for (const entry of entries) {
            const colorSpace = /** @type {'RGB' | 'Gray' | 'Lab'} */ (entry.colorSpace);
            if (this.#bufferRegistry) {
                this.#bufferRegistry.storeColor(conversionConfig, colorSpace, entry.values, entry.converted);
            } else {
                const key = this.#generateColorKey(entry.colorSpace, entry.values);
                this.#storeFallbackColor(key, entry.converted);
            }
        }
    }

    // ========================================
    // Resource Cleanup
    // ========================================

    /**
     * @override
     */
    dispose() {
        this.#fallbackLookupTable = {};
        this.#cachedConversionConfig = null;
        // Note: Don't dispose bufferRegistry - it may be shared across instances
        this.#bufferRegistry = null;
        super.dispose();
    }
}
