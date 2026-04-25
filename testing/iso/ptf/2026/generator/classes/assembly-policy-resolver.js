// @ts-check
/**
 * AssemblyPolicyResolver — Loads assembly policy and resolves generation plans.
 *
 * Reads the declarative assembly-policy.json configuration and resolves
 * a concrete assembly plan based on the output profile analysis and
 * optional user overrides. The plan includes a filtered manifest and
 * one or more generation passes (one per rendering intent).
 *
 * @module AssemblyPolicyResolver
 * @author Saleh Abdel Motaal <dev@smotaal.io>
 * @ai Claude Opus 4.6 (code generation)
 */

import { CONTEXT_PREFIX } from '../../services/helpers/runtime.js';
import { safeDynamicImport } from '../../helpers/imports.js';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * @typedef {import('../../classes/baseline/color-converter.js').RenderingIntent} RenderingIntent
 * @typedef {import('./test-form-pdf-document-generator.js').TestFormManifest} TestFormManifest
 * @typedef {import('./test-form-pdf-document-generator.js').TestFormManifestLayoutEntry} TestFormManifestLayoutEntry
 * @typedef {import('./test-form-pdf-document-generator.js').TestFormManifestPageEntry} TestFormManifestPageEntry
 * @typedef {import('./output-profile-analyzer.js').ProfileCategory} ProfileCategory
 * @typedef {import('./output-profile-analyzer.js').ProfileAnalysisResult} ProfileAnalysisResult
 */

/**
 * A rendering intent pass with associated BPC flag and human-readable label.
 *
 * @typedef {{
 *   renderingIntent: RenderingIntent,
 *   blackPointCompensation: boolean,
 *   label: string,
 *   supportedProfileCategories?: string[],
 * }} IntentPass
 */

/**
 * User overrides for assembly filtering.
 *
 * Uses `string[]` (not `Set`) for `structuredClone` compatibility
 * with the bootstrap worker `postMessage` protocol.
 *
 * @typedef {{
 *   enabledLayoutNames?: string[] | null,
 *   enabledColorSpaceNames?: string[] | null,
 *   renderingIntentOverrides?: IntentPass[] | null,
 * }} AssemblyUserOverrides
 */

/**
 * A single generation pass — one rendering intent applied to a filtered manifest.
 *
 * @typedef {{
 *   intentPass: IntentPass,
 *   manifest: TestFormManifest,
 * }} GenerationPass
 */

/**
 * Complete assembly plan resolved from policy + profile analysis + user overrides.
 *
 * @typedef {{
 *   profileCategory: ProfileCategory,
 *   profileCategoryLabel: string,
 *   generationPasses: GenerationPass[],
 *   multiPDF: boolean,
 * }} AssemblyPlan
 */

/**
 * Profile category definition from assembly-policy.json.
 *
 * @typedef {{
 *   description: string,
 *   profileColorSpace: string,
 *   includedLayoutColorSpaceTypes: string[],
 *   excludedLayoutColorSpaceTypes: string[],
 *   renderingIntentPasses: IntentPass[],
 *   multiPDF: boolean,
 * }} ProfileCategoryDefinition
 */

/**
 * Full assembly policy data loaded from JSON.
 *
 * @typedef {{
 *   profileCategories: Record<string, ProfileCategoryDefinition>,
 *   maxGCRTest: import('./output-profile-analyzer.js').MaxGCRTestConfiguration,
 *   renderingIntentLabels: Record<string, string>,
 *   profileCategoryLabels: Record<string, string>,
 *   availableCustomIntents: IntentPass[],
 * }} AssemblyPolicyData
 */

// ============================================================================
// AssemblyPolicyResolver
// ============================================================================

/**
 * Loads and resolves the declarative assembly policy.
 *
 * Lifecycle:
 *   1. `AssemblyPolicyResolver.load()` — fetches and parses assembly-policy.json
 *   2. `resolver.resolve(profileAnalysis, manifest, overrides?)` — produces an `AssemblyPlan`
 *
 * The resolver never mutates the input manifest. Filtered manifests are new
 * objects sharing the original `assets` and `colorSpaces` references (asset
 * index alignment is critical for `AssetPagePreConverter`).
 */
export class AssemblyPolicyResolver {

    /** @type {AssemblyPolicyData} */
    #policyData;

    /**
     * @param {AssemblyPolicyData} policyData - Parsed assembly policy JSON
     */
    constructor(policyData) {
        this.#policyData = policyData;
    }

    /**
     * Loads the assembly policy from the JSON configuration file.
     *
     * @returns {Promise<AssemblyPolicyResolver>}
     */
    static async load() {
        const resolvedURL = new URL(
            import.meta.resolve('../../classes/configurations/assembly-policy.json'),
            import.meta.url,
        );

        const { default: policyData } = await safeDynamicImport(`${resolvedURL}`, { with: { type: 'json' } });

        return new AssemblyPolicyResolver(/** @type {AssemblyPolicyData} */ (policyData));
    }

    /**
     * Gets the raw policy data (for UI population, Max GCR test config, etc.).
     *
     * @returns {AssemblyPolicyData}
     */
    get policyData() {
        return this.#policyData;
    }

    /**
     * Resolves the complete assembly plan from profile analysis and user overrides.
     *
     * Steps:
     *   1. Look up profile category rules
     *   2. Filter manifest by color space type inclusion/exclusion
     *   3. Apply user layout and color space overrides
     *   4. Determine rendering intent passes (policy or user override)
     *   5. Build generation passes (one per intent, each with filtered manifest)
     *
     * @param {ProfileAnalysisResult} profileAnalysis - Output from `OutputProfileAnalyzer`
     * @param {TestFormManifest} manifest - Original full manifest
     * @param {AssemblyUserOverrides} [userOverrides] - Optional user filter overrides
     * @returns {AssemblyPlan}
     */
    resolve(profileAnalysis, manifest, userOverrides) {
        const { profileCategory } = profileAnalysis;
        const categoryDefinition = this.#policyData.profileCategories[profileCategory];

        if (!categoryDefinition) {
            throw new Error(
                `Unknown profile category "${profileCategory}" in assembly policy. ` +
                `Available: ${Object.keys(this.#policyData.profileCategories).join(', ')}`
            );
        }

        const profileCategoryLabel = this.getProfileCategoryLabel(profileCategory);

        // ------------------------------------------------------------------
        // 1. Filter manifest by color space type
        // ------------------------------------------------------------------
        const filteredManifest = AssemblyPolicyResolver.#filterManifestByColorSpaceType(
            manifest,
            categoryDefinition.includedLayoutColorSpaceTypes,
            categoryDefinition.excludedLayoutColorSpaceTypes,
        );

        // ------------------------------------------------------------------
        // 2. Apply user layout name overrides
        // ------------------------------------------------------------------
        const layoutFilteredManifest = userOverrides?.enabledLayoutNames
            ? AssemblyPolicyResolver.#filterManifestByLayoutNames(
                filteredManifest,
                new Set(userOverrides.enabledLayoutNames),
            )
            : filteredManifest;

        // ------------------------------------------------------------------
        // 3. Apply user color space name overrides
        // ------------------------------------------------------------------
        const fullyFilteredManifest = userOverrides?.enabledColorSpaceNames
            ? AssemblyPolicyResolver.#filterManifestByColorSpaceNames(
                layoutFilteredManifest,
                new Set(userOverrides.enabledColorSpaceNames),
            )
            : layoutFilteredManifest;

        // ------------------------------------------------------------------
        // 4. Determine rendering intent passes
        // ------------------------------------------------------------------
        const intentPasses = userOverrides?.renderingIntentOverrides?.length
            ? userOverrides.renderingIntentOverrides
            : categoryDefinition.renderingIntentPasses;

        // ------------------------------------------------------------------
        // 5. Build generation passes
        // ------------------------------------------------------------------
        /** @type {GenerationPass[]} */
        const generationPasses = intentPasses.map(intentPass => ({
            intentPass,
            manifest: fullyFilteredManifest,
        }));

        const multiPDF = generationPasses.length > 1;

        console.log(
            `${CONTEXT_PREFIX} [AssemblyPolicyResolver] Resolved plan:`,
            {
                profileCategory,
                profileCategoryLabel,
                multiPDF,
                passes: generationPasses.length,
                intents: generationPasses.map(p => p.intentPass.label),
                layouts: fullyFilteredManifest.layouts.length,
                pages: fullyFilteredManifest.pages.length,
            },
        );

        return {
            profileCategory,
            profileCategoryLabel,
            generationPasses,
            multiPDF,
        };
    }

    /**
     * Gets the human-readable label for a rendering intent.
     *
     * @param {string} renderingIntent
     * @returns {string}
     */
    getRenderingIntentLabel(renderingIntent) {
        return this.#policyData.renderingIntentLabels[renderingIntent] ?? renderingIntent;
    }

    /**
     * Gets the human-readable label for a profile category.
     *
     * @param {string} profileCategory
     * @returns {string}
     */
    getProfileCategoryLabel(profileCategory) {
        return this.#policyData.profileCategoryLabels[profileCategory] ?? profileCategory;
    }

    // ======================================================================
    // Private: Manifest Filtering
    // ======================================================================

    /**
     * Filters a manifest by color space type inclusion/exclusion rules.
     *
     * Keeps layouts and pages whose `colorSpace` name maps to an included
     * type (via `manifest.colorSpaces[name].type`), and excludes those
     * matching excluded types.
     *
     * The `assets` and `colorSpaces` properties are shared with the
     * original manifest to preserve asset index alignment.
     *
     * @param {TestFormManifest} manifest
     * @param {string[]} includedTypes - Color space types to include (e.g., `['RGB', 'Gray', 'Lab']`)
     * @param {string[]} excludedTypes - Color space types to exclude (e.g., `['DeviceN']`)
     * @returns {TestFormManifest}
     */
    static #filterManifestByColorSpaceType(manifest, includedTypes, excludedTypes) {
        const includedSet = new Set(includedTypes);
        const excludedSet = new Set(excludedTypes);

        /**
         * Tests whether a manifest color space name passes the type filter.
         * @param {string} colorSpaceName
         * @returns {boolean}
         */
        const isColorSpaceIncluded = (colorSpaceName) => {
            const definition = manifest.colorSpaces[colorSpaceName];
            if (!definition) return false;
            const type = definition.type;
            if (excludedSet.has(type)) return false;
            if (includedSet.size > 0 && !includedSet.has(type)) return false;
            return true;
        };

        const filteredLayouts = manifest.layouts.filter(
            layout => isColorSpaceIncluded(layout.colorSpace),
        );

        const filteredPages = manifest.pages.filter(page => {
            const colorSpaceName = page.colorSpace ?? page.metadata?.colorSpace;
            return colorSpaceName ? isColorSpaceIncluded(colorSpaceName) : true;
        });

        return {
            ...manifest,
            layouts: filteredLayouts,
            pages: filteredPages,
        };
    }

    /**
     * Filters a manifest to include only layouts and pages matching enabled layout names.
     *
     * @param {TestFormManifest} manifest
     * @param {Set<string>} enabledLayoutNames
     * @returns {TestFormManifest}
     */
    static #filterManifestByLayoutNames(manifest, enabledLayoutNames) {
        const filteredLayouts = manifest.layouts.filter(
            layout => enabledLayoutNames.has(layout.layout),
        );

        const filteredPages = manifest.pages.filter(page => {
            const layoutName = page.layout ?? page.metadata?.title;
            return layoutName ? enabledLayoutNames.has(layoutName) : true;
        });

        return {
            ...manifest,
            layouts: filteredLayouts,
            pages: filteredPages,
        };
    }

    /**
     * Filters a manifest to include only layouts and pages matching enabled color space names.
     *
     * @param {TestFormManifest} manifest
     * @param {Set<string>} enabledColorSpaceNames
     * @returns {TestFormManifest}
     */
    static #filterManifestByColorSpaceNames(manifest, enabledColorSpaceNames) {
        const filteredLayouts = manifest.layouts.filter(
            layout => enabledColorSpaceNames.has(layout.colorSpace),
        );

        const filteredPages = manifest.pages.filter(page => {
            const colorSpaceName = page.colorSpace ?? page.metadata?.colorSpace;
            return colorSpaceName ? enabledColorSpaceNames.has(colorSpaceName) : true;
        });

        return {
            ...manifest,
            layouts: filteredLayouts,
            pages: filteredPages,
        };
    }
}
