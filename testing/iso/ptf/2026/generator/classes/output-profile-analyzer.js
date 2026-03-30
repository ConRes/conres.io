// @ts-check
/**
 * OutputProfileAnalyzer — Determines the output ICC profile category.
 *
 * Analyzes an ICC output profile to classify it into a policy-defined
 * profile category. Categories are declared in assembly-policy.json,
 * each with a `profileColorSpace` field that maps ICC color space
 * signatures to categories. When multiple categories share the same
 * `profileColorSpace` (e.g., CMYK and CMYK-MaxGCR), a Maximum GCR
 * test using 32-bit float Lab-to-CMYK transforms disambiguates.
 *
 * Two detection methods are available:
 *
 * - **Lab-based** (explicit): Converts neutral Lab values with Relative
 *   Colorimetric + BPC and checks that CMY channels stay below a threshold.
 *   This directly tests whether the profile maps neutrals to K-only output.
 *
 * - **Intent-based** (comparative): Converts the same neutral Lab values
 *   with both Relative Colorimetric + BPC and K-Only GCR + BPC, then
 *   compares the results. If nearly identical, the profile's built-in GCR
 *   already maximizes K, making the K-Only GCR intent redundant. This
 *   method assumes neither intent is misbehaving.
 *
 * When both methods are enabled and they disagree, an error is thrown.
 *
 * @module OutputProfileAnalyzer
 * @author Saleh Abdel Motaal <dev@smotaal.io>
 * @ai Claude Opus 4.6 (code generation)
 */

import { CONTEXT_PREFIX } from '../../services/helpers/runtime.js';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Profile category identifier.
 * @typedef {'Gray' | 'RGB' | 'CMYK' | 'CMYK-MaxGCR'} ProfileCategory
 */

/**
 * Single Max GCR test result for one Lab test point.
 * @typedef {{
 *   labPoint: number[],
 *   cmykValues: number[],
 *   cmyBelowThreshold: boolean,
 * }} MaxGCRTestPoint
 */

/**
 * Complete profile analysis result.
 * @typedef {{
 *   profileCategory: ProfileCategory,
 *   colorSpace: string,
 *   isMaxGCR: boolean,
 *   testResults: MaxGCRTestPoint[] | null,
 * }} ProfileAnalysisResult
 */

/**
 * Max GCR test configuration (from assembly-policy.json).
 * @typedef {{
 *   labTestPoints: number[][],
 *   renderingIntent: string,
 *   blackPointCompensation: boolean,
 *   cmyThresholdPercent: number,
 *   intentComparisonMaxDeltaPercent: number,
 * }} MaxGCRTestConfiguration
 */

/**
 * Options controlling which detection methods are used.
 *
 * @typedef {{
 *   useLabBasedDetection?: boolean,
 *   useIntentBasedDetection?: boolean,
 * }} MaxGCRDetectionOptions
 */

// ============================================================================
// OutputProfileAnalyzer
// ============================================================================

/**
 * Analyzes an ICC output profile to determine its category for assembly policy.
 *
 * Uses the WASM color engine with 32-bit float transforms for precision:
 * - Lab Float32: L = 0.0..100.0, a = -128.0..127.0, b = -128.0..127.0
 * - CMYK Float32: 0.0..100.0 per channel (percentage)
 */
export class OutputProfileAnalyzer {

    /**
     * Analyzes an output ICC profile to determine its category.
     *
     * Matches the ICC header's color space against `profileColorSpace` fields
     * in the policy's profile categories (case-insensitive). When a single
     * category matches, it is returned immediately. When multiple categories
     * share the same `profileColorSpace` (e.g., CMYK and CMYK-MaxGCR), a
     * Maximum GCR test disambiguates.
     *
     * @param {ArrayBuffer} profileBuffer - The ICC profile data
     * @param {{ colorSpace: string }} profileHeader - Parsed ICC header (from ICCService)
     * @param {MaxGCRTestConfiguration} maxGCRTestConfiguration - Test parameters from assembly policy
     * @param {Record<string, import('../classes/assembly-policy-resolver.js').ProfileCategoryDefinition>} profileCategories - Profile category definitions from assembly policy
     * @param {MaxGCRDetectionOptions} [detectionOptions] - Which detection methods to use
     * @returns {Promise<ProfileAnalysisResult>}
     */
    static async analyzeProfile(profileBuffer, profileHeader, maxGCRTestConfiguration, profileCategories, detectionOptions) {
        const { colorSpace } = profileHeader;

        // Find all categories whose profileColorSpace matches the ICC color space (case-insensitive)
        const iccColorSpaceUpper = colorSpace.toUpperCase();
        /** @type {[string, import('../classes/assembly-policy-resolver.js').ProfileCategoryDefinition][]} */
        const matchingCategories = Object.entries(profileCategories).filter(
            ([, definition]) => definition.profileColorSpace.toUpperCase() === iccColorSpaceUpper,
        );

        if (matchingCategories.length === 0) {
            const supportedColorSpaces = [...new Set(
                Object.values(profileCategories).map(d => d.profileColorSpace),
            )];
            throw new Error(
                `Unsupported output profile color space: "${colorSpace}". ` +
                `Supported: ${supportedColorSpaces.join(', ')}`
            );
        }

        // Single match — return immediately (no further analysis needed)
        if (matchingCategories.length === 1) {
            const [categoryKey] = matchingCategories[0];
            /** @type {ProfileCategory} */
            const profileCategory = /** @type {ProfileCategory} */ (categoryKey);

            console.log(
                `${CONTEXT_PREFIX} [OutputProfileAnalyzer] Profile category: ${profileCategory}`
            );

            return {
                profileCategory,
                colorSpace,
                isMaxGCR: false,
                testResults: null,
            };
        }

        // Multiple matches (e.g., CMYK / CMYK-MaxGCR) — run Max GCR test to disambiguate
        const { isMaxGCR, testResults } = await OutputProfileAnalyzer.#testMaxGCR(
            profileBuffer,
            maxGCRTestConfiguration,
            detectionOptions,
        );

        /** @type {ProfileCategory} */
        const profileCategory = isMaxGCR ? 'CMYK-MaxGCR' : 'CMYK';

        console.log(
            `${CONTEXT_PREFIX} [OutputProfileAnalyzer] Profile category: ${profileCategory}` +
            ` (Max GCR: ${isMaxGCR})`
        );

        return {
            profileCategory,
            colorSpace,
            isMaxGCR,
            testResults,
        };
    }

    /**
     * Tests whether a CMYK profile uses Maximum GCR.
     *
     * All transforms use 32-bit float (`TYPE_Lab_FLT` / `TYPE_CMYK_FLT`).
     *
     * **Lab-based detection** (`useLabBasedDetection`, default `true`):
     *   Converts neutral Lab values with Relative Colorimetric + BPC.
     *   Max GCR if all test points produce C, M, Y <= `cmyThresholdPercent`.
     *
     * **Intent-based detection** (`useIntentBasedDetection`, default `false`):
     *   Converts the same Lab values with both Relative Colorimetric + BPC
     *   and K-Only GCR + BPC. If results are nearly identical (max per-channel
     *   delta <= `intentComparisonMaxDeltaPercent`), the profile's built-in
     *   GCR already maximizes K.
     *
     * When both methods are enabled and they disagree, an error is thrown
     * to surface the inconsistency for investigation.
     *
     * @param {ArrayBuffer} profileBuffer - CMYK ICC profile data
     * @param {MaxGCRTestConfiguration} configuration - Test parameters
     * @param {MaxGCRDetectionOptions} [options]
     * @returns {Promise<{ isMaxGCR: boolean, testResults: MaxGCRTestPoint[] }>}
     */
    static async #testMaxGCR(profileBuffer, configuration, options) {
        const {
            useLabBasedDetection = true,
            useIntentBasedDetection = false,
        } = options ?? {};

        if (!useLabBasedDetection && !useIntentBasedDetection) {
            throw new Error(
                'At least one detection method must be enabled: ' +
                'useLabBasedDetection or useIntentBasedDetection'
            );
        }

        const { ColorEngineProvider } = await import('../../classes/baseline/color-engine-provider.js');

        const provider = new ColorEngineProvider();
        await provider.initialize();

        const constants = provider.getConstants();

        const bpcFlags = configuration.blackPointCompensation
            ? constants.cmsFLAGS_BLACKPOINTCOMPENSATION
            : 0;

        const labProfile = provider.createLab4Profile();
        const cmykProfile = provider.openProfileFromMem(profileBuffer);

        // Transform A: Relative Colorimetric + BPC (needed by both methods)
        /** @type {number} */
        let transformRelative;

        // Transform B: K-Only GCR + BPC (only for intent-based detection)
        /** @type {number | null} */
        let transformKOnly = null;

        try {
            transformRelative = provider.createTransform(
                labProfile,
                constants.TYPE_Lab_FLT,
                cmykProfile,
                constants.TYPE_CMYK_FLT,
                constants.INTENT_RELATIVE_COLORIMETRIC,
                bpcFlags,
            );

            if (useIntentBasedDetection) {
                try {
                    transformKOnly = provider.createTransform(
                        labProfile,
                        constants.TYPE_Lab_FLT,
                        cmykProfile,
                        constants.TYPE_CMYK_FLT,
                        constants.INTENT_PRESERVE_K_ONLY_RELATIVE_COLORIMETRIC_GCR,
                        bpcFlags,
                    );
                } catch (error) {
                    provider.closeProfile(labProfile);
                    provider.closeProfile(cmykProfile);
                    provider.deleteTransform(transformRelative);
                    throw new Error(
                        `Intent-based detection requested but K-Only GCR transform ` +
                        `creation failed: ${error}`
                    );
                }
            }
        } catch (error) {
            provider.closeProfile(labProfile);
            provider.closeProfile(cmykProfile);
            throw error instanceof Error ? error
                : new Error(`Failed to create Lab→CMYK float transform for Max GCR test: ${error}`);
        }

        const {
            labTestPoints,
            cmyThresholdPercent,
            intentComparisonMaxDeltaPercent,
        } = configuration;

        /** @type {MaxGCRTestPoint[]} */
        const testResults = [];

        /** @type {boolean | null} */
        let labBasedResult = null;
        /** @type {boolean | null} */
        let intentBasedResult = null;
        let intentBasedMaxDelta = 0;

        // Track per-method state across all test points
        let labBasedAllPass = true;
        let intentBasedAllPass = true;

        const inputBuffer = new Float32Array(3);
        const outputRelative = new Float32Array(4);
        const outputKOnly = new Float32Array(4);

        for (const labPoint of labTestPoints) {
            const [L, a, b] = labPoint;

            inputBuffer[0] = L;
            inputBuffer[1] = a;
            inputBuffer[2] = b;

            // Always run Relative Colorimetric (needed by both methods)
            provider.transformArray(transformRelative, inputBuffer, outputRelative, 1);

            const C = outputRelative[0];
            const M = outputRelative[1];
            const Y = outputRelative[2];
            const K = outputRelative[3];

            // Lab-based: check CMY threshold
            const cmyBelowThreshold = C <= cmyThresholdPercent
                && M <= cmyThresholdPercent
                && Y <= cmyThresholdPercent;

            if (useLabBasedDetection && !cmyBelowThreshold) {
                labBasedAllPass = false;
            }

            testResults.push({
                labPoint: [L, a, b],
                cmykValues: [C, M, Y, K],
                cmyBelowThreshold,
            });

            // Intent-based: compare against K-Only GCR
            if (transformKOnly) {
                provider.transformArray(transformKOnly, inputBuffer, outputKOnly, 1);

                const maxDelta = Math.max(
                    Math.abs(C - outputKOnly[0]),
                    Math.abs(M - outputKOnly[1]),
                    Math.abs(Y - outputKOnly[2]),
                    Math.abs(K - outputKOnly[3]),
                );

                intentBasedMaxDelta = Math.max(intentBasedMaxDelta, maxDelta);

                if (maxDelta > intentComparisonMaxDeltaPercent) {
                    intentBasedAllPass = false;
                }
            }
        }

        // Clean up engine resources
        provider.deleteTransform(transformRelative);
        if (transformKOnly) provider.deleteTransform(transformKOnly);
        provider.closeProfile(labProfile);
        provider.closeProfile(cmykProfile);

        // Resolve results per enabled method
        if (useLabBasedDetection) labBasedResult = labBasedAllPass;
        if (useIntentBasedDetection) intentBasedResult = intentBasedAllPass;

        // Log results
        const parts = [];
        if (labBasedResult !== null) {
            parts.push(`Lab-based (CMY <= ${cmyThresholdPercent}%): ${labBasedResult ? 'pass' : 'fail'}`);
        }
        if (intentBasedResult !== null) {
            parts.push(
                `intent-based (delta <= ${intentComparisonMaxDeltaPercent}%): ` +
                `${intentBasedResult ? 'pass' : 'fail'} (max delta: ${intentBasedMaxDelta.toFixed(4)}%)`
            );
        }
        console.log(`${CONTEXT_PREFIX} [OutputProfileAnalyzer] Max GCR test: ${parts.join(', ')}`);

        // If both methods are enabled and disagree, throw
        if (labBasedResult !== null && intentBasedResult !== null
            && labBasedResult !== intentBasedResult) {
            throw new Error(
                `Max GCR detection methods disagree: ` +
                `Lab-based = ${labBasedResult}, ` +
                `intent-based = ${intentBasedResult} ` +
                `(max delta: ${intentBasedMaxDelta.toFixed(4)}%). ` +
                `This may indicate a profile or color engine issue ` +
                `that requires investigation.`
            );
        }

        // Use whichever method(s) produced a result
        const isMaxGCR = labBasedResult ?? intentBasedResult ?? false;

        return { isMaxGCR, testResults };
    }
}
