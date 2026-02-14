// @ts-check
/**
 * ManifestColorSpaceResolver — Resolves and caches ICC profiles from manifest colorSpaces.
 *
 * Parses the manifest `colorSpaces` map and fetches ICC profiles as ArrayBuffer
 * using URL resolution relative to the manifest location. Results are cached
 * to avoid redundant fetches.
 *
 * @module ManifestColorSpaceResolver
 * @author Saleh Abdel Motaal <dev@smotaal.io>
 * @ai Claude Opus 4.6 (code generation)
 */

import { CONTEXT_PREFIX } from '../../services/helpers/runtime.js';

/**
 * @typedef {ArrayBuffer | 'Lab'} ProfileType
 */

/**
 * @typedef {{ type: string, profile?: string }} ColorSpaceEntry
 */

/**
 * Resolves ICC profiles from manifest `colorSpaces` entries.
 *
 * Profile resolution:
 * - Absent `profile` property (e.g., SepK/DeviceN): returns `null` (no conversion)
 * - `profile === "Lab"`: returns the string `'Lab'` (built-in engine profile)
 * - Relative path (e.g., `"../profiles/sRGB IEC61966-2.1.icc"`): resolved via
 *   the caller-provided `resolveProfileURL` function (or `new URL(path, manifestURL)`
 *   as fallback) and fetched as `ArrayBuffer`
 */
export class ManifestColorSpaceResolver {

    /** @type {Record<string, ColorSpaceEntry>} */
    #colorSpaces;

    /** @type {string} */
    #manifestURL;

    /** @type {(profilePath: string) => string} */
    #resolveProfileURL;

    /** @type {Promise<Cache | undefined> | undefined} */
    #cache;

    /** @type {Map<string, Promise<ProfileType | null>>} */
    #profileCache = new Map();

    /**
     * @param {Record<string, ColorSpaceEntry>} colorSpaces - The `colorSpaces` map from the manifest
     * @param {string} manifestURL - Base URL for resolving relative profile paths
     * @param {Promise<Cache | undefined> | undefined} [cache] - Optional browser Cache API instance (promise)
     * @param {(profilePath: string) => string} [resolveProfileURL] - Custom URL resolver for profile paths;
     *   receives the manifest-relative profile path (e.g., `"../profiles/sRGB.icc"`) and returns an absolute URL.
     *   When omitted, falls back to `new URL(profilePath, manifestURL).href`.
     */
    constructor(colorSpaces, manifestURL, cache, resolveProfileURL) {
        this.#colorSpaces = colorSpaces;
        this.#manifestURL = manifestURL;
        this.#resolveProfileURL = resolveProfileURL ?? ((path) => new URL(path, manifestURL).href);
        this.#cache = cache;
    }

    /**
     * Resolves the ICC profile for a named color space.
     *
     * @param {string} colorSpaceName - Key in the manifest `colorSpaces` map (e.g., `'sRGB'`, `'Lab'`, `'SepK'`)
     * @returns {Promise<ProfileType | null>} `ArrayBuffer` for ICC profiles, `'Lab'` for Lab, or `null` for no-profile spaces
     */
    async resolveProfile(colorSpaceName) {
        const cached = this.#profileCache.get(colorSpaceName);
        if (cached !== undefined) return cached;

        const promise = this.#resolveProfileUncached(colorSpaceName);
        this.#profileCache.set(colorSpaceName, promise);
        return promise;
    }

    /**
     * Returns the color space type string for a named color space.
     *
     * @param {string} colorSpaceName - Key in the manifest `colorSpaces` map
     * @returns {string | null} e.g., `'RGB'`, `'Gray'`, `'Lab'`, `'DeviceN'`, or `null` if not found
     */
    getColorSpaceType(colorSpaceName) {
        const entry = this.#colorSpaces[colorSpaceName];
        return entry?.type ?? null;
    }

    /**
     * Internal uncached profile resolution.
     *
     * @param {string} colorSpaceName
     * @returns {Promise<ProfileType | null>}
     */
    async #resolveProfileUncached(colorSpaceName) {
        const entry = this.#colorSpaces[colorSpaceName];

        if (!entry) {
            console.warn(`${CONTEXT_PREFIX} [ManifestColorSpaceResolver] unknown color space "${colorSpaceName}"`);
            return null;
        }

        // No profile property → no conversion (e.g., SepK/DeviceN)
        if (!entry.profile) {
            return null;
        }

        // Built-in Lab profile
        if (entry.profile === 'Lab') {
            return 'Lab';
        }

        // Relative path → resolve via caller-provided resolver and fetch
        const profileURL = this.#resolveProfileURL(entry.profile);
        return this.#fetchProfile(profileURL);
    }

    /**
     * Fetches an ICC profile from a URL, using the Cache API when available.
     *
     * @param {string} url - Absolute URL to the ICC profile
     * @returns {Promise<ArrayBuffer>}
     */
    async #fetchProfile(url) {
        const cache = await this.#cache;

        // Check cache first
        if (cache) {
            const cachedResponse = await cache.match(url);
            if (cachedResponse) {
                return cachedResponse.arrayBuffer();
            }
        }

        // Fetch from network
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Failed to fetch ICC profile: ${url} (HTTP ${response.status})`);
        }

        // Cache the response (no stale entry exists — cache miss already confirmed above)
        if (cache) {
            await cache.put(url, response.clone()).catch(cacheStorageError => {
                console.warn(CONTEXT_PREFIX, cacheStorageError);
            });
        }

        return response.arrayBuffer();
    }
}
