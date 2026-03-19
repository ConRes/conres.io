// @ts-check
/**
 * Profile Pool
 *
 * Centralized management of ICC profile buffers with SharedArrayBuffer support
 * for zero-copy sharing between main thread and workers. Provides automatic
 * cleanup via FinalizationRegistry and LRU eviction under memory pressure.
 *
 * @module ProfilePool
 */

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
 * In Node.js, this is always true.
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
 * A profile stored in the pool.
 * @typedef {{
 *   buffer: SharedArrayBuffer | ArrayBuffer,
 *   isShared: boolean,
 *   refCount: number,
 *   profileHandle?: any,
 *   lastAccessed: number,
 *   byteLength: number,
 * }} PooledProfile
 */

/**
 * Configuration options for ProfilePool.
 * @typedef {{
 *   maxProfiles?: number,
 *   maxMemoryBytes?: number,
 * }} ProfilePoolOptions
 */

/**
 * Profile lookup result.
 * @typedef {{
 *   buffer: SharedArrayBuffer | ArrayBuffer,
 *   isShared: boolean,
 * }} ProfileLookupResult
 */

// ============================================================================
// ProfilePool Class
// ============================================================================

/**
 * Manages ICC profile buffers with optional SharedArrayBuffer support.
 *
 * Features:
 * - SharedArrayBuffer for zero-copy worker sharing (when available)
 * - LRU eviction when memory limits are exceeded
 * - FinalizationRegistry for automatic cleanup when consumers are GC'd
 * - Deduplication of concurrent loads for the same profile
 * - FNV-1a hashing for ArrayBuffer key generation
 *
 * @example
 * ```javascript
 * const pool = new ProfilePool({ maxProfiles: 32, maxMemoryBytes: 64 * 1024 * 1024 });
 *
 * // Load a profile (creates SharedArrayBuffer if supported)
 * const { buffer, isShared } = await pool.getProfile('/profiles/cmyk.icc');
 *
 * // Register consumer for automatic cleanup
 * pool.registerConsumer(myConverter, '/profiles/cmyk.icc');
 *
 * // When done
 * pool.dispose();
 * ```
 */
export class ProfilePool {
    // ========================================
    // Private Fields
    // ========================================

    /** @type {Map<string, PooledProfile>} */
    #profiles = new Map();

    /** @type {Map<string, Promise<PooledProfile>>} */
    #pendingLoads = new Map();

    /** @type {FinalizationRegistry<string> | null} */
    #registry = null;

    /** @type {number} */
    #maxProfiles;

    /** @type {number} */
    #maxMemoryBytes;

    /** @type {number} */
    #currentMemoryBytes = 0;

    // ========================================
    // Constructor
    // ========================================

    /**
     * Creates a new ProfilePool instance.
     *
     * @param {ProfilePoolOptions} [options={}] - Configuration options
     * @example
     * ```javascript
     * const pool = new ProfilePool({
     *     maxProfiles: 32,           // Max cached profiles (default: 32)
     *     maxMemoryBytes: 67108864,  // Max memory in bytes (default: 64MB)
     * });
     * ```
     */
    constructor(options = {}) {
        this.#maxProfiles = options.maxProfiles ?? 32;
        this.#maxMemoryBytes = options.maxMemoryBytes ?? 64 * 1024 * 1024;

        // Setup automatic cleanup via FinalizationRegistry
        if (typeof FinalizationRegistry !== 'undefined') {
            this.#registry = new FinalizationRegistry((profileKey) => {
                this.#decrementRefCount(profileKey);
            });
        }
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
    // Profile Loading
    // ========================================

    /**
     * Loads or retrieves a cached profile.
     *
     * If the profile is already cached, increments its reference count
     * and updates last accessed time. If not cached, loads the profile
     * and creates a SharedArrayBuffer (if supported).
     *
     * @param {string | ArrayBuffer} source - URL or raw profile data
     * @returns {Promise<ProfileLookupResult>} Profile buffer and shared status
     * @example
     * ```javascript
     * // Load from URL
     * const { buffer, isShared } = await pool.getProfile('/profiles/cmyk.icc');
     *
     * // Load from ArrayBuffer
     * const { buffer, isShared } = await pool.getProfile(rawProfileData);
     * ```
     */
    async getProfile(source) {
        const key = this.#getProfileKey(source);

        // Return cached profile
        if (this.#profiles.has(key)) {
            const profile = this.#profiles.get(key);
            if (profile) {
                profile.lastAccessed = Date.now();
                profile.refCount++;
                return { buffer: profile.buffer, isShared: profile.isShared };
            }
        }

        // Deduplicate concurrent loads
        if (this.#pendingLoads.has(key)) {
            const profile = await this.#pendingLoads.get(key);
            if (profile) {
                profile.refCount++;
                return { buffer: profile.buffer, isShared: profile.isShared };
            }
        }

        // Load new profile
        const loadPromise = this.#loadProfile(source, key);
        this.#pendingLoads.set(key, loadPromise);

        try {
            const profile = await loadPromise;
            return { buffer: profile.buffer, isShared: profile.isShared };
        } finally {
            this.#pendingLoads.delete(key);
        }
    }

    /**
     * Checks if a profile is cached.
     *
     * @param {string | ArrayBuffer} source - URL or raw profile data
     * @returns {boolean} True if profile is cached
     */
    hasProfile(source) {
        const key = this.#getProfileKey(source);
        return this.#profiles.has(key);
    }

    /**
     * Registers a consumer for automatic cleanup.
     *
     * When the consumer object is garbage collected, the profile's
     * reference count is automatically decremented.
     *
     * @param {object} consumer - Object that uses the profile (weak reference target)
     * @param {string | ArrayBuffer} source - Profile source for key lookup
     * @example
     * ```javascript
     * const converter = new MyConverter(config);
     * pool.registerConsumer(converter, config.destinationProfile);
     * // When converter is GC'd, profile refCount decrements automatically
     * ```
     */
    registerConsumer(consumer, source) {
        if (!this.#registry) {
            return; // FinalizationRegistry not available
        }
        const key = this.#getProfileKey(source);
        this.#registry.register(consumer, key);
    }

    /**
     * Explicitly releases a profile reference.
     *
     * Use this when the consumer lifetime is managed manually
     * rather than relying on FinalizationRegistry.
     *
     * @param {string | ArrayBuffer} source - Profile source
     */
    releaseProfile(source) {
        const key = this.#getProfileKey(source);
        this.#decrementRefCount(key);
    }

    // ========================================
    // Internal Loading
    // ========================================

    /**
     * Loads a profile from source and caches it.
     *
     * @param {string | ArrayBuffer} source - URL or raw profile data
     * @param {string} key - Cache key
     * @returns {Promise<PooledProfile>} Loaded profile
     */
    async #loadProfile(source, key) {
        let rawBuffer;

        if (typeof source === 'string') {
            let response = null;
            const sourceURL = new URL(source, import.meta.url)
            const fs = await import('fs/promises').catch(() => null);
            
            if (fs) rawBuffer = await fs?.readFile?.(sourceURL);
            if (!rawBuffer) rawBuffer = await (response = await globalThis?.fetch?.(source)).arrayBuffer?.();
            if (!rawBuffer || (response !== null && !response.ok))  throw new Error(`Failed to load ICC profile from ${source}: ${response?.statusText ?? 'fs/promises not available'}`);
        } else {
            rawBuffer = source;
        }

        // Evict if necessary
        await this.#evictIfNeeded(rawBuffer.byteLength);

        // Create shared buffer if supported
        let buffer;
        let isShared = false;

        if (USE_SHARED_BUFFERS) {
            buffer = new SharedArrayBuffer(rawBuffer.byteLength);
            new Uint8Array(buffer).set(new Uint8Array(rawBuffer));
            isShared = true;
        } else {
            // Clone the buffer to ensure ownership
            buffer = rawBuffer.slice(0);
        }

        /** @type {PooledProfile} */
        const profile = {
            buffer,
            isShared,
            refCount: 1,
            lastAccessed: Date.now(),
            byteLength: buffer.byteLength,
        };

        this.#profiles.set(key, profile);
        this.#currentMemoryBytes += buffer.byteLength;

        return profile;
    }

    // ========================================
    // LRU Eviction
    // ========================================

    /**
     * Evicts profiles if memory limits are exceeded.
     *
     * Uses LRU (Least Recently Used) policy, only evicting profiles
     * with zero reference count.
     *
     * @param {number} additionalBytes - Bytes about to be added
     */
    async #evictIfNeeded(additionalBytes) {
        const targetBytes = this.#maxMemoryBytes - additionalBytes;

        while (
            this.#currentMemoryBytes > targetBytes ||
            this.#profiles.size >= this.#maxProfiles
        ) {
            const lruKey = this.#findLRUProfile();
            if (!lruKey) break;

            const profile = this.#profiles.get(lruKey);
            if (!profile || profile.refCount > 0) break; // Don't evict in-use profiles

            this.#profiles.delete(lruKey);
            this.#currentMemoryBytes -= profile.byteLength;
        }
    }

    /**
     * Finds the least recently used profile with zero references.
     *
     * @returns {string | null} Key of LRU profile or null
     */
    #findLRUProfile() {
        let oldestKey = null;
        let oldestTime = Infinity;

        for (const [key, profile] of this.#profiles) {
            if (profile.refCount === 0 && profile.lastAccessed < oldestTime) {
                oldestTime = profile.lastAccessed;
                oldestKey = key;
            }
        }

        return oldestKey;
    }

    // ========================================
    // Reference Counting
    // ========================================

    /**
     * Decrements reference count for a profile.
     *
     * @param {string} key - Profile cache key
     */
    #decrementRefCount(key) {
        const profile = this.#profiles.get(key);
        if (profile) {
            profile.refCount = Math.max(0, profile.refCount - 1);
        }
    }

    // ========================================
    // Key Generation
    // ========================================

    /**
     * Generates a cache key for a profile source.
     *
     * URLs use the URL as key. ArrayBuffers use an FNV-1a hash.
     *
     * @param {string | ArrayBuffer} source - Profile source
     * @returns {string} Cache key
     */
    #getProfileKey(source) {
        if (typeof source === 'string') {
            return `url:${source}`;
        }
        // For ArrayBuffer: use FNV-1a hash
        return `hash:${this.#hashArrayBuffer(source)}`;
    }

    /**
     * Computes FNV-1a hash of an ArrayBuffer.
     *
     * Returns a collision-resistant string key including buffer length.
     *
     * @param {ArrayBuffer} buffer - Buffer to hash
     * @returns {string} Hash string
     */
    #hashArrayBuffer(buffer) {
        const view = new Uint8Array(buffer);
        let hash = 0x811c9dc5; // FNV-1a offset basis

        for (let i = 0; i < view.length; i++) {
            hash ^= view[i];
            hash = Math.imul(hash, 0x01000193); // FNV-1a prime
        }

        // Include length to reduce collisions
        return `${buffer.byteLength}-${(hash >>> 0).toString(16)}`;
    }

    // ========================================
    // Cleanup
    // ========================================

    /**
     * Releases all resources held by this pool.
     *
     * Clears all cached profiles and pending loads.
     */
    dispose() {
        this.#profiles.clear();
        this.#pendingLoads.clear();
        this.#currentMemoryBytes = 0;
    }

    // ========================================
    // Diagnostics
    // ========================================

    /**
     * Gets current pool statistics.
     *
     * @returns {{
     *   profileCount: number,
     *   memoryBytes: number,
     *   maxMemoryBytes: number,
     *   pendingLoads: number,
     *   supportsSharedBuffers: boolean,
     * }} Pool statistics
     * @example
     * ```javascript
     * console.log(pool.stats);
     * // { profileCount: 5, memoryBytes: 1234567, maxMemoryBytes: 67108864, ... }
     * ```
     */
    get stats() {
        return {
            profileCount: this.#profiles.size,
            memoryBytes: this.#currentMemoryBytes,
            maxMemoryBytes: this.#maxMemoryBytes,
            pendingLoads: this.#pendingLoads.size,
            supportsSharedBuffers: USE_SHARED_BUFFERS,
        };
    }
}
