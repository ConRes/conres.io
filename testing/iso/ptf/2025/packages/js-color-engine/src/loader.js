/**
 * @fileoverview Resource loading utilities for profiles, images, and other color-related data
 * Provides cross-platform loading capabilities for browser and Node.js environments
 * 
 * @license GPL-3.0-or-later
 * @copyright 2019, 2024 Glenn Wilton, O2 Creative Limited
 */

// @ts-check

import { Profile } from './profile.js';

/**
 * Resource loader class for handling various data sources
 * Supports loading from files, URLs, base64 data, and binary sources
 */
export class Loader {
    /**
     * Creates a new Loader instance
     */
    constructor() {
        /** Array of managed profiles */
        this.profiles = [];
        
        /** Count of successfully loaded profiles */
        this.loadCount = 0;
        
        /** Count of profiles that failed to load */
        this.errorCount = 0;
    }

    /**
     * Adds a profile to the loader with optional preloading
     * @param {string} url - URL or path to the profile
     * @param {string} [key] - Unique key to identify the profile (defaults to url)
     * @param {boolean} [preload=false] - Whether to preload this profile
     * @returns {Profile} The created Profile instance
     */
    add(url, key, preload) {
        let profile = new Profile();
        this.profiles.push({
            profile: profile,
            url: url,
            preload: preload === true,
            key: (typeof key === 'undefined') ? url : key
        });
        return profile;
    }

    /**
     * Loads a profile by its index in the profiles array
     * @param {number|string} index - Index of the profile to load
     * @returns {Promise<boolean>} Promise resolving to true if loaded successfully
     */
    async loadProfileIndex(index) {
        let profile = this.profiles[index].profile;
        if (profile.loaded) {
            return true;
        }

        if (!profile.loadError) {
            try {
                return await profile.load(this.profiles[index].url);
            } catch (error) {
                return false;
            }
        }

        return false;
    }

    /**
     * Loads all profiles marked for preloading
     * @returns {Promise<void>} Promise that resolves when all preload profiles are processed
     */
    async loadAll() {
        //let toLoadCount = this.profiles.filter(p => p.preload && !p.profile.loaded).length;

        for (let p of this.profiles) {
            if (p.preload && !p.profile.loaded) {
                await p.profile.loadPromise(p.url);
            }
        }

        // check all profiles are loaded
        this.loadCount = 0;
        this.errorCount = 0;
        let preloadCount = 0;
        for (let i = 0; i < this.profiles.length; i++) {
            if (this.profiles[i].preload) {
                preloadCount++;
                let p = this.profiles[i].profile;
                if (p.loadError) {
                    this.errorCount++;
                } else {
                    if (p.loaded) {
                        this.loadCount++;
                    }
                }
            }

        }

        console.log("Loaded " + this.loadCount + " profiles with " + this.errorCount + " errors out of " + preloadCount + " profiles");

    }

    /**
     * Gets a profile by key, loading it if necessary
     * @param {string} key - Unique key identifying the profile
     * @returns {Promise<Profile|null>} Promise resolving to the loaded profile or null if failed
     */
    async get(key) {
        let profile = this.findByKey(key);
        if (profile.loaded) {
            return profile;
        }

        // load the profile
        await this.loadProfileIndex(key);
        if (profile.loaded) {
            return profile;
        }

        // Throw error if profile not found
        throw new Error("Unable to load the profile: " + key + " Error:" + profile.lastError.text);
    }

    findByKey(key) {
        for (let i = 0; i < this.profiles.length; i++) {
            if (this.profiles[i].key === key) {
                return this.profiles[i].profile;
            }
        }
        return false;
    }

    findByURL(url) {
        for (let i = 0; i < this.profiles.length; i++) {
            if (this.profiles[i].url === url) {
                return this.profiles[i].profile;
            }
        }
        return false;
    }
}
