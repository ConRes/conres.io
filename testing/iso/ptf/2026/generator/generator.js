// @ts-check
/**
 * Test Form Generator — Entry point.
 *
 * Registers the custom element and exports the bootstrap function
 * for initializing the generator with resolved asset configurations.
 *
 * @module generator
 * @author Saleh Abdel Motaal <dev@smotaal.io>
 * @ai Claude Opus 4.6 (code generation)
 */

import { TestFormGeneratorAppElement } from './elements/test-form-generator-app-element.js';

customElements.define('test-form-generator-app', TestFormGeneratorAppElement);

/**
 * @typedef {object} AssetEntry
 * @property {string} name - Display name matching the select option value
 * @property {{ assets: string, manifest: string }} resources - Relative resource URLs
 */

/**
 * @typedef {object} ResolvedAssetEntry
 * @property {string} name - Display name matching the select option value
 * @property {{ assets: string, manifest: string }} resources - Absolute resource URLs
 */

/**
 * Bootstraps the generator application with resolved asset configurations.
 *
 * Resolves relative resource URLs from assets.json to absolute URLs
 * (relative to this module's location) and passes the configuration
 * to the `<test-form-generator-app>` custom element.
 *
 * @param {object} options
 * @param {{ assets: AssetEntry[] }} options.assets - Parsed assets.json data
 */
export function bootstrap({ assets }) {
    const element = /** @type {TestFormGeneratorAppElement | null} */ (
        document.querySelector('test-form-generator-app')
    );
    if (!element) throw new Error('Missing <test-form-generator-app> element');

    // Resolve relative resource URLs to absolute URLs relative to this module
    /** @type {ResolvedAssetEntry[]} */
    const resolvedAssets = assets.assets.map((entry) => ({
        name: entry.name,
        resources: {
            assets: new URL(entry.resources.assets, import.meta.url).href,
            manifest: new URL(entry.resources.manifest, import.meta.url).href,
        },
    }));

    element.configure({ assets: resolvedAssets });
}
