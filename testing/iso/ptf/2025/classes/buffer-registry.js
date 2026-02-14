// @ts-check
/**
 * Buffer Registry
 *
 * Maps pdf-lib stream references to SharedArrayBuffer views for zero-copy
 * sharing between main thread and workers. Uses WeakMap for automatic
 * cleanup when pdf-lib objects are garbage collected.
 *
 * @module BufferRegistry
 */

import { RENDERING_INTENT_CODE, getRenderingIntentCode } from './color-converter.js';
import { NO_OP_DIAGNOSTICS } from './diagnostics-collector.js';

// ============================================================================
// Feature Detection
// ============================================================================

/**
 * Check if SharedArrayBuffer is available.
 * @type {boolean}
 */
const SUPPORTS_SHARED_ARRAY_BUFFER =
    typeof SharedArrayBuffer !== 'undefined' &&
    typeof Atomics !== 'undefined';

/**
 * Check for cross-origin isolation (required for SharedArrayBuffer in browsers).
 * @type {boolean}
 */
const CROSS_ORIGIN_ISOLATED =
    typeof globalThis.crossOriginIsolated !== 'undefined'
        ? globalThis.crossOriginIsolated
        : true; // Node.js doesn't require cross-origin isolation

/**
 * Final flag for SharedArrayBuffer usage.
 * @type {boolean}
 */
const USE_SHARED_BUFFERS = SUPPORTS_SHARED_ARRAY_BUFFER && CROSS_ORIGIN_ISOLATED;

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Mapping information for a shared buffer.
 * @typedef {{
 *   sharedBuffer: SharedArrayBuffer,
 *   byteOffset: number,
 *   byteLength: number,
 * }} SharedBufferMapping
 */

/**
 * Result of getting a shared view.
 * @typedef {{
 *   view: Uint8Array,
 *   isShared: boolean,
 * }} SharedViewResult
 */

/**
 * A PDF stream object with contents property.
 * @typedef {{
 *   contents: Uint8Array,
 * }} PDFStream
 */

/**
 * Configuration key for color lookup caching.
 * Identifies unique conversion configurations.
 * @typedef {{
 *   destinationProfile: ArrayBuffer | string,
 *   renderingIntent: string,
 *   blackPointCompensation: boolean,
 *   sourceRGBProfile?: ArrayBuffer,
 *   sourceGrayProfile?: ArrayBuffer,
 * }} ColorConversionConfig
 */

/**
 * Pending color entry for batch conversion.
 * @typedef {{
 *   colorSpace: 'RGB' | 'Gray' | 'Lab',
 *   values: number[],
 *   key: string,
 * }} PendingColorEntry
 */

// ============================================================================
// BufferRegistry Class
// ============================================================================

/**
 * Manages SharedArrayBuffer views for pdf-lib stream objects.
 *
 * Features:
 * - WeakMap-based storage allows automatic cleanup when streams are GC'd
 * - SharedArrayBuffer creation for zero-copy worker sharing (when supported)
 * - Fallback to regular Uint8Array when SharedArrayBuffer unavailable
 * - Bulk registration for batch PDF processing
 *
 * @example
 * ```javascript
 * const registry = new BufferRegistry();
 *
 * // Get shared view for a PDF stream
 * const { view, isShared } = registry.getSharedView(pdfStream);
 *
 * // Bulk register multiple streams
 * const views = registry.registerStreams([stream1, stream2, stream3]);
 *
 * // When done
 * registry.dispose();
 * ```
 */
export class BufferRegistry {
    // ========================================
    // Private Fields
    // ========================================

    /**
     * WeakMap: PDFStream → SharedBufferMapping
     * Allows automatic cleanup when pdf-lib objects are garbage collected.
     * @type {WeakMap<object, SharedBufferMapping>}
     */
    #streamMappings = new WeakMap();

    /**
     * FinalizationRegistry for explicit tracking (optional).
     * @type {FinalizationRegistry<SharedArrayBuffer> | null}
     */
    #registry = null;

    /**
     * Track all created SharedArrayBuffers for explicit cleanup and stats.
     * @type {Set<SharedArrayBuffer>}
     */
    #sharedBuffers = new Set();

    /**
     * Total bytes allocated in shared buffers.
     * @type {number}
     */
    #totalBytes = 0;

    // ----------------------------------------
    // Color Lookup Caching Fields
    // ----------------------------------------

    /**
     * Color lookup cache: configKey → (colorKey → convertedValues).
     * Shared across all converter instances using this registry.
     * @type {Record<string, Record<string, number[]>>}
     */
    #colorLookupCache = {};

    /**
     * Pending colors for batch conversion: configKey → entries.
     * Accumulated by registerColor(), converted by convertPending().
     * @type {Record<string, PendingColorEntry[]>}
     */
    #pendingColors = {};

    /**
     * Statistics for color lookup cache.
     * @type {{hits: number, misses: number, conversions: number}}
     */
    #colorCacheStats = { hits: 0, misses: 0, conversions: 0 };

    /**
     * Cache for config keys to avoid regenerating on every lookup.
     * Uses WeakMap so config objects can be garbage collected.
     * @type {WeakMap<object, string>}
     */
    #configKeyCache = new WeakMap();

    /**
     * Maximum number of color cache entries before eviction.
     * @type {number}
     */
    #maxColorCacheEntries = 50000;

    /**
     * Current count of color cache entries.
     * @type {number}
     */
    #colorCacheEntryCount = 0;

    /**
     * Diagnostics collector for tracking cache operations.
     * @type {import('./diagnostics-collector.js').DiagnosticsCollector | typeof NO_OP_DIAGNOSTICS}
     */
    #diagnostics = NO_OP_DIAGNOSTICS;

    // ========================================
    // Constructor
    // ========================================

    /**
     * Creates a new BufferRegistry instance.
     *
     * @param {object} [options={}] - Configuration options
     * @param {import('./diagnostics-collector.js').DiagnosticsCollector} [options.diagnostics] - Diagnostics collector
     *
     * @example
     * ```javascript
     * const registry = new BufferRegistry();
     * // Or with diagnostics:
     * const registry = new BufferRegistry({ diagnostics: collector });
     * ```
     */
    constructor(options = {}) {
        this.#diagnostics = options.diagnostics ?? NO_OP_DIAGNOSTICS;

        // Setup FinalizationRegistry for cleanup tracking
        if (typeof FinalizationRegistry !== 'undefined') {
            this.#registry = new FinalizationRegistry((sharedBuffer) => {
                this.#sharedBuffers.delete(sharedBuffer);
            });
        }
    }

    /**
     * Gets the diagnostics collector.
     * @returns {import('./diagnostics-collector.js').DiagnosticsCollector | typeof NO_OP_DIAGNOSTICS}
     */
    get diagnostics() {
        return this.#diagnostics;
    }

    /**
     * Sets the diagnostics collector.
     * @param {import('./diagnostics-collector.js').DiagnosticsCollector | typeof NO_OP_DIAGNOSTICS} value
     */
    set diagnostics(value) {
        this.#diagnostics = value ?? NO_OP_DIAGNOSTICS;
    }

    // ========================================
    // Static Properties
    // ========================================

    /**
     * Whether SharedArrayBuffer is available for zero-copy sharing.
     * @returns {boolean}
     */
    static get supportsSharedBuffers() {
        return USE_SHARED_BUFFERS;
    }

    // ========================================
    // Stream Mapping
    // ========================================

    /**
     * Gets or creates a SharedArrayBuffer view for a PDF stream.
     *
     * If SharedArrayBuffer is available, creates a shared buffer copy
     * that can be efficiently shared with workers. Otherwise, returns
     * the original contents.
     *
     * @param {PDFStream} stream - pdf-lib stream object with contents property
     * @returns {SharedViewResult} View and shared status
     * @example
     * ```javascript
     * const imageStream = pdfDoc.context.lookup(imageRef);
     * const { view, isShared } = registry.getSharedView(imageStream);
     *
     * if (isShared) {
     *     // Can pass view to worker without copying
     *     worker.postMessage({ data: view });
     * }
     * ```
     */
    getSharedView(stream) {
        // Check cache first
        if (this.#streamMappings.has(stream)) {
            const mapping = this.#streamMappings.get(stream);
            if (mapping) {
                return {
                    view: new Uint8Array(mapping.sharedBuffer, mapping.byteOffset, mapping.byteLength),
                    isShared: true,
                };
            }
        }

        // Not supported - return original
        if (!USE_SHARED_BUFFERS) {
            return {
                view: stream.contents,
                isShared: false,
            };
        }

        // Create new shared buffer
        const contents = stream.contents;
        const sharedBuffer = new SharedArrayBuffer(contents.byteLength);
        const sharedView = new Uint8Array(sharedBuffer);
        sharedView.set(contents);

        /** @type {SharedBufferMapping} */
        const mapping = {
            sharedBuffer,
            byteOffset: 0,
            byteLength: contents.byteLength,
        };

        this.#streamMappings.set(stream, mapping);
        this.#sharedBuffers.add(sharedBuffer);
        this.#totalBytes += contents.byteLength;

        // Register for cleanup tracking
        if (this.#registry) {
            this.#registry.register(stream, sharedBuffer);
        }

        return {
            view: sharedView,
            isShared: true,
        };
    }

    /**
     * Creates a shared buffer from raw data (not tied to a stream).
     *
     * Useful for creating shared buffers from arbitrary data.
     *
     * @param {Uint8Array | ArrayBuffer} data - Data to share
     * @returns {SharedViewResult} View and shared status
     * @example
     * ```javascript
     * const { view, isShared } = registry.createSharedBuffer(rawPixelData);
     * ```
     */
    createSharedBuffer(data) {
        const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : data;

        if (!USE_SHARED_BUFFERS) {
            return {
                view: bytes,
                isShared: false,
            };
        }

        const sharedBuffer = new SharedArrayBuffer(bytes.byteLength);
        const sharedView = new Uint8Array(sharedBuffer);
        sharedView.set(bytes);

        this.#sharedBuffers.add(sharedBuffer);
        this.#totalBytes += bytes.byteLength;

        return {
            view: sharedView,
            isShared: true,
        };
    }

    /**
     * Checks if a stream has an existing shared mapping.
     *
     * @param {PDFStream} stream - pdf-lib stream object
     * @returns {boolean} True if mapping exists
     */
    hasMapping(stream) {
        return this.#streamMappings.has(stream);
    }

    // ========================================
    // Bulk Operations
    // ========================================

    /**
     * Pre-registers multiple streams for batch conversion.
     *
     * Creates SharedArrayBuffer views for all streams in a single pass.
     * Useful for preparing an entire PDF document for worker processing.
     *
     * @param {PDFStream[]} streams - Array of pdf-lib stream objects
     * @returns {Map<PDFStream, Uint8Array>} Map of streams to their views
     * @example
     * ```javascript
     * const imageStreams = collectImageXObjects(pdfDoc);
     * const views = registry.registerStreams(imageStreams);
     *
     * for (const [stream, view] of views) {
     *     workerTasks.push({ streamRef, data: view });
     * }
     * ```
     */
    registerStreams(streams) {
        /** @type {Map<PDFStream, Uint8Array>} */
        const views = new Map();

        for (const stream of streams) {
            const { view } = this.getSharedView(stream);
            views.set(stream, view);
        }

        return views;
    }

    /**
     * Applies converted data back to a stream.
     *
     * Replaces the stream's contents with the converted data.
     * Note: This modifies the pdf-lib stream object directly.
     *
     * @param {PDFStream} stream - pdf-lib stream object
     * @param {Uint8Array} convertedData - New stream contents
     */
    applyToStream(stream, convertedData) {
        // pdf-lib streams have a mutable contents property
        // @ts-ignore - contents is writable on PDFRawStream
        stream.contents = convertedData;
    }

    // ========================================
    // Cleanup
    // ========================================

    /**
     * Releases all tracked SharedArrayBuffers.
     *
     * Note: WeakMap entries are automatically cleaned up when
     * stream objects are garbage collected.
     */
    dispose() {
        this.#sharedBuffers.clear();
        this.#totalBytes = 0;
        this.#colorLookupCache = {};
        this.#pendingColors = {};
        this.#colorCacheStats = { hits: 0, misses: 0, conversions: 0 };
        this.#colorCacheEntryCount = 0;
        // WeakMap entries are automatically cleaned up by GC
    }

    // ========================================
    // Color Lookup Caching
    // ========================================

    /**
     * Generates a configuration key for color lookup caching.
     *
     * @param {ColorConversionConfig} config - Conversion configuration
     * @returns {string} Configuration key
     */
    #generateConfigKey(config) {
        // Use a hash of the relevant config properties
        const parts = [
            typeof config.destinationProfile === 'string'
                ? config.destinationProfile
                : `buffer:${config.destinationProfile.byteLength}`,
            config.renderingIntent,
            config.blackPointCompensation ? '1' : '0',
        ];
        return parts.join('|');
    }

    /**
     * Get or generate config key with caching.
     * @param {ColorConversionConfig} config
     * @returns {string}
     */
    #getConfigKey(config) {
        let key = this.#configKeyCache.get(config);
        if (key === undefined) {
            key = this.#generateConfigKey(config);
            this.#configKeyCache.set(config, key);
        }
        return key;
    }

    /**
     * Generates a color key for lookup.
     *
     * @param {'RGB' | 'Gray' | 'Lab'} colorSpace - Color space
     * @param {number[]} values - Color values
     * @returns {string} Color key
     */
    #generateColorKey(colorSpace, values) {
        return `${colorSpace}:${values.join(',')}`;
    }

    /**
     * Checks if a color has already been converted for the given config.
     *
     * @param {ColorConversionConfig} config - Conversion configuration
     * @param {'RGB' | 'Gray' | 'Lab'} colorSpace - Color space
     * @param {number[]} values - Color values
     * @returns {boolean} True if conversion result is cached
     */
    hasColor(config, colorSpace, values) {
        const configKey = this.#getConfigKey(config);
        const colorKey = this.#generateColorKey(colorSpace, values);
        const cache = this.#colorLookupCache[configKey];
        return cache !== undefined && colorKey in cache;
    }

    /**
     * Looks up a previously converted color.
     *
     * @param {ColorConversionConfig} config - Conversion configuration
     * @param {'RGB' | 'Gray' | 'Lab'} colorSpace - Color space
     * @param {number[]} values - Color values
     * @returns {number[] | undefined} Converted values or undefined if not cached
     */
    lookupColor(config, colorSpace, values) {
        const configKey = this.#getConfigKey(config);
        const colorKey = this.#generateColorKey(colorSpace, values);
        const cache = this.#colorLookupCache[configKey];
        const result = cache?.[colorKey];
        if (result) {
            this.#colorCacheStats.hits++;
            this.#diagnostics.incrementCounter('color-cache-hits');
        } else {
            this.#diagnostics.incrementCounter('color-cache-misses');
        }
        return result;
    }

    /**
     * Registers a color for batch conversion.
     *
     * Colors are queued until convertPending() is called.
     * If the color is already cached, it's not queued.
     *
     * @param {ColorConversionConfig} config - Conversion configuration
     * @param {'RGB' | 'Gray' | 'Lab'} colorSpace - Color space
     * @param {number[]} values - Color values
     * @returns {boolean} True if color was queued (not already cached)
     */
    registerColor(config, colorSpace, values) {
        const configKey = this.#getConfigKey(config);
        const colorKey = this.#generateColorKey(colorSpace, values);

        // Check if already cached
        const cache = this.#colorLookupCache[configKey];
        if (cache !== undefined && colorKey in cache) {
            return false;
        }

        // Check if already pending
        let pending = this.#pendingColors[configKey];
        if (!pending) {
            pending = [];
            this.#pendingColors[configKey] = pending;
        }

        // Check for duplicate in pending
        const alreadyPending = pending.some(e => e.key === colorKey);
        if (alreadyPending) {
            return false;
        }

        pending.push({ colorSpace, values, key: colorKey });
        return true;
    }

    /**
     * Converts all pending colors using batch WASM calls.
     *
     * Groups colors by color space and converts each group with a single
     * WASM call for optimal performance.
     *
     * @param {import('../services/ColorEngineService.js').ColorEngineService} colorEngineService - Color engine service
     * @param {ColorConversionConfig} config - Conversion configuration
     * @returns {Promise<number>} Number of colors converted
     */
    async convertPending(colorEngineService, config) {
        const configKey = this.#getConfigKey(config);
        const pending = this.#pendingColors[configKey];

        if (!pending || pending.length === 0) {
            return 0;
        }

        const batchSpan = this.#diagnostics.startSpan('color-batch-convert', {
            pendingCount: pending.length,
        });

        let totalConverted = 0;

        try {
            // Get or create cache for this config
            let cache = this.#colorLookupCache[configKey];
            if (!cache) {
                cache = {};
                this.#colorLookupCache[configKey] = cache;
            }

            // Group pending colors by color space for efficient batching
            /** @type {{RGB?: {entries: PendingColorEntry[], colors: import('../services/ColorEngineService.js').ColorValue[]}, Gray?: {entries: PendingColorEntry[], colors: import('../services/ColorEngineService.js').ColorValue[]}, Lab?: {entries: PendingColorEntry[], colors: import('../services/ColorEngineService.js').ColorValue[]}}} */
            const groups = {};

            for (const entry of pending) {
                let group = groups[entry.colorSpace];
                if (!group) {
                    group = { entries: [], colors: [] };
                    groups[entry.colorSpace] = group;
                }
                group.entries.push(entry);
                group.colors.push({
                    type: entry.colorSpace,
                    values: this.#pdfToEngine(entry.colorSpace, entry.values),
                });
            }

            // Convert each group with a single batch call
            for (const colorSpace of /** @type {const} */ (['RGB', 'Gray', 'Lab'])) {
                const group = groups[colorSpace];
                if (!group) continue;
                const { entries, colors } = group;
                // Determine source profile (must be embedded ICC profile or Lab)
                /** @type {ArrayBuffer | 'Lab'} */
                let sourceProfile;
                if (colorSpace === 'RGB') {
                    if (!config.sourceRGBProfile) {
                        throw new Error('sourceRGBProfile is required for RGB color conversion');
                    }
                    sourceProfile = config.sourceRGBProfile;
                } else if (colorSpace === 'Lab') {
                    sourceProfile = 'Lab';
                } else {
                    if (!config.sourceGrayProfile) {
                        throw new Error('sourceGrayProfile is required for Gray color conversion');
                    }
                    sourceProfile = config.sourceGrayProfile;
                }

                // Determine effective rendering intent (K-Only GCR fallback)
                // Note: Using numeric intent codes for fast comparison (~10x faster
                // than string comparison on 40-character K-Only GCR intent string).
                const intentCode = getRenderingIntentCode(/** @type {import('./color-converter.js').RenderingIntent} */ (config.renderingIntent));
                let effectiveRenderingIntent = config.renderingIntent;
                if (intentCode === RENDERING_INTENT_CODE.K_ONLY_GCR) {
                    if (colorSpace === 'Lab') {
                        effectiveRenderingIntent = 'relative-colorimetric';
                    }
                }

                // Single batch call for all colors of this type
                const batchResults = await colorEngineService.convertColors(colors, {
                    sourceProfile,
                    destinationProfile: config.destinationProfile,
                    renderingIntent: /** @type {import('./color-converter.js').RenderingIntent} */ (effectiveRenderingIntent),
                    blackPointCompensation: config.blackPointCompensation,
                });

                // Store results in cache
                for (let i = 0; i < entries.length; i++) {
                    const convertedValues = this.#engineToPDF(batchResults[i].output.values);
                    cache[entries[i].key] = convertedValues;
                    totalConverted++;
                }
            }

            // Clear pending for this config
            delete this.#pendingColors[configKey];

            this.#colorCacheStats.conversions += totalConverted;
            this.#colorCacheStats.misses += totalConverted;

            this.#diagnostics.updateSpan(batchSpan, {
                converted: totalConverted,
            });
            this.#diagnostics.incrementCounter('color-conversions', totalConverted);
        } finally {
            this.#diagnostics.endSpan(batchSpan);
        }

        return totalConverted;
    }

    /**
     * Stores a converted color directly in the cache.
     *
     * Used when colors are converted through other means (e.g., buildLookupTable).
     *
     * @param {ColorConversionConfig} config - Conversion configuration
     * @param {'RGB' | 'Gray' | 'Lab'} colorSpace - Color space
     * @param {number[]} values - Original color values
     * @param {number[]} convertedValues - Converted color values
     */
    storeColor(config, colorSpace, values, convertedValues) {
        const configKey = this.#getConfigKey(config);
        const colorKey = this.#generateColorKey(colorSpace, values);

        let cache = this.#colorLookupCache[configKey];
        if (!cache) {
            cache = {};
            this.#colorLookupCache[configKey] = cache;
        }

        // Only increment count if this is a new entry
        if (!(colorKey in cache)) {
            this.#colorCacheEntryCount++;
        }
        cache[colorKey] = convertedValues;

        // Check for eviction if limit exceeded
        if (this.#colorCacheEntryCount > this.#maxColorCacheEntries) {
            this.#evictColorCacheEntries();
        }
    }

    /**
     * Evict oldest color cache entries (FIFO - 10% of max).
     */
    #evictColorCacheEntries() {
        const evictCount = Math.ceil(this.#maxColorCacheEntries * 0.1);
        let evicted = 0;

        // Iterate through config keys and their caches
        for (const configKey of Object.keys(this.#colorLookupCache)) {
            const cache = this.#colorLookupCache[configKey];
            const keys = Object.keys(cache);

            for (const key of keys) {
                if (evicted >= evictCount) break;
                delete cache[key];
                evicted++;
                this.#colorCacheEntryCount--;
            }

            // Remove empty config entries
            if (Object.keys(cache).length === 0) {
                delete this.#colorLookupCache[configKey];
            }

            if (evicted >= evictCount) break;
        }
    }

    /**
     * Gets the number of pending colors for a config.
     *
     * @param {ColorConversionConfig} config - Conversion configuration
     * @returns {number} Number of pending colors
     */
    getPendingCount(config) {
        const configKey = this.#getConfigKey(config);
        return this.#pendingColors[configKey]?.length ?? 0;
    }

    /**
     * Clears the color lookup cache.
     */
    clearColorCache() {
        this.#colorLookupCache = {};
        this.#pendingColors = {};
        this.#colorCacheStats = { hits: 0, misses: 0, conversions: 0 };
        this.#colorCacheEntryCount = 0;
    }

    // ----------------------------------------
    // Color Format Conversion Helpers
    // ----------------------------------------

    /**
     * Converts PDF color values to ColorEngineService format.
     *
     * @param {'RGB' | 'Gray' | 'Lab'} colorSpace
     * @param {number[]} values - PDF values (0-1 for RGB/Gray)
     * @returns {number[]} Values in ColorEngineService expected format
     */
    #pdfToEngine(colorSpace, values) {
        if (colorSpace === 'Lab') {
            return values; // Lab values passed as-is
        }
        if (colorSpace === 'Gray') {
            return values; // Gray in 0-1 format
        }
        // RGB: PDF uses 0-1, ColorEngineService expects 0-255
        return values.map(v => Math.round(v * 255));
    }

    /**
     * Converts ColorEngineService output to PDF format.
     *
     * @param {number[]} values - ColorEngineService output values
     * @returns {number[]} PDF values (0-1)
     */
    #engineToPDF(values) {
        // CMYK output: ColorEngineService returns 0-1 already
        return values;
    }

    // ========================================
    // Diagnostics
    // ========================================

    /**
     * Gets current registry statistics.
     *
     * @returns {{
     *   sharedBufferCount: number,
     *   totalBytes: number,
     *   supportsSharedBuffers: boolean,
     *   colorCache: {
     *     configCount: number,
     *     totalColors: number,
     *     hits: number,
     *     misses: number,
     *     conversions: number,
     *     hitRate: number,
     *   },
     * }} Registry statistics
     * @example
     * ```javascript
     * console.log(registry.stats);
     * // { sharedBufferCount: 12, totalBytes: 5234567, supportsSharedBuffers: true, colorCache: {...} }
     * ```
     */
    get stats() {
        // Calculate total cached colors
        let totalColors = 0;
        const configKeys = Object.keys(this.#colorLookupCache);
        for (const configKey of configKeys) {
            totalColors += Object.keys(this.#colorLookupCache[configKey]).length;
        }

        const total = this.#colorCacheStats.hits + this.#colorCacheStats.misses;

        return {
            sharedBufferCount: this.#sharedBuffers.size,
            totalBytes: this.#totalBytes,
            supportsSharedBuffers: USE_SHARED_BUFFERS,
            colorCache: {
                configCount: configKeys.length,
                totalColors,
                hits: this.#colorCacheStats.hits,
                misses: this.#colorCacheStats.misses,
                conversions: this.#colorCacheStats.conversions,
                hitRate: total > 0 ? this.#colorCacheStats.hits / total : 0,
            },
        };
    }
}
