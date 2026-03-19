// @ts-check
/**
 * Profile Selection Service
 * Implements 5-step profile selection algorithm per settings.json
 *
 * Algorithm for selecting source profiles for Device color spaces:
 * 1. Use output intent profile (if preferOutputIntent=true and same color model)
 * 2. Use embedded profile with matching headers (if preferEmbeded=true)
 * 3. Use single embedded profile of same color model (if preferEmbeded=true)
 * 4. Use default profile from profileSearchLocations
 * 5. Throw error or use graceful fallback based on preferGracefulFallback
 *
 * @module ProfileSelectionService
 */

import { ICCService } from './ICCService.js';

/**
 * @typedef {{
 *   preferOutputIntent: boolean,
 *   preferEmbeded: boolean,
 *   preferGracefulFallback: boolean,
 * }} ProfileSelectionPolicy
 */

/**
 * @typedef {{
 *   profileSearchLocations: string[],
 *   defaultSourceProfileForDeviceGray: string,
 *   defaultSourceProfileForDeviceGrayPolicy: ProfileSelectionPolicy,
 *   defaultSourceProfileForDeviceRGB: string,
 *   defaultSourceProfileForDeviceRGBPolicy: ProfileSelectionPolicy,
 *   defaultSourceProfileForDeviceCMYK: string,
 *   defaultSourceProfileForDeviceCMYKPolicy: ProfileSelectionPolicy,
 * }} ColorManagementSettings
 */

/**
 * @typedef {{
 *   outputIntentProfile?: Uint8Array | ArrayBuffer,
 *   embeddedProfiles?: Map<string, Uint8Array | ArrayBuffer>,
 * }} ProfileSelectionContext
 */

/**
 * @typedef {'Gray' | 'RGB' | 'CMYK'} ColorModel
 */

/** Default policy when settings not found */
const DEFAULT_POLICY = {
    preferOutputIntent: true,
    preferEmbeded: true,
    preferGracefulFallback: false,
};

/**
 * Profile Selection Service
 * Central service for selecting ICC profiles based on settings.json configuration
 */
export class ProfileSelectionService {
    /** @type {ColorManagementSettings | null} */
    #settings = null;

    /** @type {Map<string, Uint8Array>} Cache for loaded profile files */
    #profileFileCache = new Map();

    /** @type {string | null} */
    #baseDir = null;

    /** @type {(() => Promise<Uint8Array>) | null} */
    #profileLoader = null;

    /**
     * Creates a new ProfileSelectionService instance
     * @param {object} [options]
     * @param {string} [options.baseDir] - Base directory for resolving profile paths
     * @param {(path: string) => Promise<Uint8Array>} [options.profileLoader] - Custom profile loader function
     */
    constructor(options = {}) {
        this.#baseDir = options.baseDir || null;
        this.#profileLoader = options.profileLoader || null;
    }

    /**
     * Load settings from cascade (testform Settings.json → main settings.json)
     * @param {object} options
     * @param {string} [options.testformPath] - Path to testform folder (optional)
     * @param {string} options.mainSettingsPath - Path to main settings.json
     * @returns {Promise<void>}
     */
    async loadSettings({ testformPath, mainSettingsPath }) {
        // Try testform Settings.json first
        if (testformPath) {
            const testformSettingsPath = `${testformPath}/Settings.json`;
            const testformSettings = await this.#tryLoadSettings(testformSettingsPath);
            if (testformSettings) {
                this.#settings = testformSettings;
                return;
            }
        }

        // Fall back to main settings.json
        const mainSettings = await this.#tryLoadSettings(mainSettingsPath);
        if (mainSettings) {
            this.#settings = mainSettings;
            return;
        }

        console.warn('ProfileSelectionService: No settings found, using defaults');
        this.#settings = null;
    }

    /**
     * Load settings directly from an object (for testing or direct configuration)
     * @param {ColorManagementSettings} settings
     */
    loadSettingsFromObject(settings) {
        this.#settings = settings;
    }

    /**
     * Try to load settings from a path
     * @param {string} path
     * @returns {Promise<ColorManagementSettings | null>}
     */
    async #tryLoadSettings(path) {
        try {
            const response = await fetch(path);
            if (!response.ok) {
                return null;
            }

            const json = await response.json();

            // Extract colorManagement settings from the wrapper
            const settings = json?.['@conres.io/test-form-generator']?.settings?.colorManagement;
            if (!settings) {
                return null;
            }

            return settings;
        } catch (e) {
            // Settings file not found or invalid - this is normal
            return null;
        }
    }

    /**
     * Get the policy for a color model
     * @param {ColorModel} colorModel
     * @returns {ProfileSelectionPolicy}
     */
    #getPolicy(colorModel) {
        if (!this.#settings) {
            return DEFAULT_POLICY;
        }

        switch (colorModel) {
            case 'Gray':
                return this.#settings.defaultSourceProfileForDeviceGrayPolicy || DEFAULT_POLICY;
            case 'RGB':
                return this.#settings.defaultSourceProfileForDeviceRGBPolicy || DEFAULT_POLICY;
            case 'CMYK':
                return this.#settings.defaultSourceProfileForDeviceCMYKPolicy || DEFAULT_POLICY;
            default:
                return DEFAULT_POLICY;
        }
    }

    /**
     * Get the default profile filename for a color model
     * @param {ColorModel} colorModel
     * @returns {string | null}
     */
    #getDefaultProfileName(colorModel) {
        if (!this.#settings) {
            return null;
        }

        switch (colorModel) {
            case 'Gray':
                return this.#settings.defaultSourceProfileForDeviceGray || null;
            case 'RGB':
                return this.#settings.defaultSourceProfileForDeviceRGB || null;
            case 'CMYK':
                return this.#settings.defaultSourceProfileForDeviceCMYK || null;
            default:
                return null;
        }
    }

    /**
     * Get the color model from an ICC profile
     * @param {Uint8Array | ArrayBuffer} profileBytes
     * @returns {ColorModel | null}
     */
    #getProfileColorModel(profileBytes) {
        try {
            const header = ICCService.parseICCHeaderFromSource(profileBytes);
            switch (header.colorSpace) {
                case 'GRAY':
                    return 'Gray';
                case 'RGB ':
                    return 'RGB';
                case 'CMYK':
                    return 'CMYK';
                default:
                    return null;
            }
        } catch (e) {
            return null;
        }
    }

    /**
     * Load a profile from search locations
     * @param {string} profileName - Filename of the profile (e.g., "sGray.icc")
     * @returns {Promise<Uint8Array | null>}
     */
    async #loadProfileFromSearchLocations(profileName) {
        // Check cache first
        if (this.#profileFileCache.has(profileName)) {
            return this.#profileFileCache.get(profileName) || null;
        }

        const searchLocations = this.#settings?.profileSearchLocations || [];

        for (const location of searchLocations) {
            const path = this.#baseDir
                ? `${this.#baseDir}/${location}/${profileName}`
                : `${location}/${profileName}`;

            try {
                let profileBytes;

                if (this.#profileLoader) {
                    // Use custom loader if provided
                    profileBytes = await this.#profileLoader(path);
                } else {
                    // Default: use fetch
                    const response = await fetch(path);
                    if (!response.ok) {
                        continue;
                    }
                    const buffer = await response.arrayBuffer();
                    profileBytes = new Uint8Array(buffer);
                }

                // Cache and return
                this.#profileFileCache.set(profileName, profileBytes);
                return profileBytes;
            } catch (e) {
                // Profile not found at this location, try next
                continue;
            }
        }

        // Profile not found in any search location
        this.#profileFileCache.set(profileName, null);
        return null;
    }

    /**
     * Select source profile for Device color space elements
     * Implements the 5-step profile selection algorithm
     *
     * @param {ColorModel} colorModel - 'Gray', 'RGB', or 'CMYK'
     * @param {ProfileSelectionContext} [context] - Context with output intent and embedded profiles
     * @returns {Promise<{profile: Uint8Array | null, source: string, fallbackUsed: boolean}>}
     */
    async selectSourceProfile(colorModel, context = {}) {
        const policy = this.#getPolicy(colorModel);
        const defaultProfileName = this.#getDefaultProfileName(colorModel);

        // Step 1: Output intent profile
        if (policy.preferOutputIntent && context.outputIntentProfile) {
            const outputIntentBytes = context.outputIntentProfile instanceof Uint8Array
                ? context.outputIntentProfile
                : new Uint8Array(context.outputIntentProfile);
            const outputIntentModel = this.#getProfileColorModel(outputIntentBytes);

            if (outputIntentModel === colorModel) {
                return {
                    profile: outputIntentBytes,
                    source: 'output-intent',
                    fallbackUsed: false,
                };
            }
        }

        // Step 2 & 3: Embedded profiles
        if (policy.preferEmbeded && context.embeddedProfiles && context.embeddedProfiles.size > 0) {
            const matchingProfiles = [];

            for (const [ref, profileData] of context.embeddedProfiles) {
                const profileBytes = profileData instanceof Uint8Array
                    ? profileData
                    : new Uint8Array(profileData);
                const profileModel = this.#getProfileColorModel(profileBytes);

                if (profileModel === colorModel) {
                    matchingProfiles.push({ ref, bytes: profileBytes });
                }
            }

            // Step 3: Single embedded profile of same color model
            if (matchingProfiles.length === 1) {
                return {
                    profile: matchingProfiles[0].bytes,
                    source: `embedded:${matchingProfiles[0].ref}`,
                    fallbackUsed: false,
                };
            }

            // Step 2: Multiple profiles - would need header matching
            // For now, skip to step 4 if multiple matches
        }

        // Step 4: Default profile from settings
        if (defaultProfileName) {
            const profileBytes = await this.#loadProfileFromSearchLocations(defaultProfileName);
            if (profileBytes) {
                return {
                    profile: profileBytes,
                    source: `settings:${defaultProfileName}`,
                    fallbackUsed: false,
                };
            }
        }

        // Step 5: Error or graceful fallback
        if (!policy.preferGracefulFallback) {
            throw new Error(
                `ProfileSelectionService: No source profile found for Device${colorModel} ` +
                `and preferGracefulFallback=false. Configure a default profile in settings.json ` +
                `or set preferGracefulFallback=true for built-in fallback.`
            );
        }

        // Graceful fallback - return null, caller should use Color Engine built-in profile
        console.warn(
            `ProfileSelectionService: No source profile found for Device${colorModel}, ` +
            `using built-in fallback`
        );

        return {
            profile: null,
            source: 'fallback:builtin',
            fallbackUsed: true,
        };
    }

    /**
     * Get profile search locations from settings
     * @returns {string[]}
     */
    getProfileSearchLocations() {
        return this.#settings?.profileSearchLocations || [];
    }

    /**
     * Check if settings have been loaded
     * @returns {boolean}
     */
    hasSettings() {
        return this.#settings !== null;
    }

    /**
     * Clear profile file cache
     */
    clearCache() {
        this.#profileFileCache.clear();
    }
}
