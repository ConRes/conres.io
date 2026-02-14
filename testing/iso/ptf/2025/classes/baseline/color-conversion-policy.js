// @ts-check
/**
 * Color Conversion Policy
 *
 * Flat, rules-driven class for determining color conversion parameters.
 * Centralizes format decisions and engine-specific behavior rules.
 *
 * @module ColorConversionPolicy
 */

import {
    // Format builder functions
    COLORSPACE_SH,
    CHANNELS_SH,
    BYTES_SH,
    ENDIAN16_SH,
    DOSWAP_SH,
    SWAPFIRST_SH,
    EXTRA_SH,
    FLOAT_SH,
    PLANAR_SH,

    // Pixel type constants
    PT_GRAY,
    PT_RGB,
    PT_CMYK,
    PT_Lab,

    // Pre-defined format constants
    TYPE_GRAY_8,
    TYPE_GRAY_16,
    TYPE_GRAY_16_SE,
    TYPE_GRAY_FLT,
    TYPE_GRAYA_8,
    TYPE_GRAYA_16,

    TYPE_RGB_8,
    TYPE_RGB_16,
    TYPE_RGB_16_SE,
    TYPE_RGB_FLT,
    TYPE_BGR_8,
    TYPE_BGR_16,
    TYPE_RGBA_8,
    TYPE_RGBA_16,
    TYPE_ARGB_8,
    TYPE_BGRA_8,

    TYPE_CMYK_8,
    TYPE_CMYK_16,
    TYPE_CMYK_16_SE,
    TYPE_CMYK_FLT,
    TYPE_KYMC_8,
    TYPE_KYMC_16,

    TYPE_Lab_8,
    TYPE_Lab_16,
    TYPE_Lab_FLT,
} from '../../packages/color-engine/src/constants.js';

import { DEFAULT_ENGINE_VERSION, WEB_ASSEMBLY_ENDIANNESS } from './color-engine-provider.js';
import { CONTEXT_PREFIX } from '../../services/helpers/runtime.js';

// Construct SE (Swap Endian) constants for formats not in standard LittleCMS constants
// These are used when buffer endianness differs from WASM endianness (little-endian)
const TYPE_Lab_16_SE = TYPE_Lab_16 | ENDIAN16_SH(1);       // 655386 | 2048 = 657434
const TYPE_GRAYA_16_SE = TYPE_GRAYA_16 | ENDIAN16_SH(1);   // GrayA 16-bit swapped endian
const TYPE_BGR_16_SE = TYPE_BGR_16 | ENDIAN16_SH(1);       // BGR 16-bit swapped endian
const TYPE_RGBA_16_SE = TYPE_RGBA_16 | ENDIAN16_SH(1);     // RGBA 16-bit swapped endian
const TYPE_KYMC_16_SE = TYPE_KYMC_16 | ENDIAN16_SH(1);     // KYMC 16-bit swapped endian

// Re-export format constants for consumers
export {
    TYPE_GRAY_8,
    TYPE_GRAY_16,
    TYPE_GRAY_16_SE,
    TYPE_GRAY_FLT,
    TYPE_GRAYA_8,
    TYPE_GRAYA_16,

    TYPE_RGB_8,
    TYPE_RGB_16,
    TYPE_RGB_16_SE,
    TYPE_RGB_FLT,
    TYPE_BGR_8,
    TYPE_BGR_16,
    TYPE_RGBA_8,
    TYPE_RGBA_16,
    TYPE_ARGB_8,
    TYPE_BGRA_8,

    TYPE_CMYK_8,
    TYPE_CMYK_16,
    TYPE_CMYK_16_SE,
    TYPE_CMYK_FLT,
    TYPE_KYMC_8,
    TYPE_KYMC_16,

    TYPE_Lab_8,
    TYPE_Lab_16,
    TYPE_Lab_FLT,
};

// Also export the constructed SE constants
export { TYPE_Lab_16_SE, TYPE_GRAYA_16_SE, TYPE_BGR_16_SE, TYPE_RGBA_16_SE, TYPE_KYMC_16_SE };

// Debug flag: Disable to verify 16-bit images work without manual byte-swap
export const SHOULD_SWAP_16_FROM_BIG_TO_LITTLE_ENDIAN = false;

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Supported color spaces.
 * @typedef {'Gray' | 'RGB' | 'CMYK' | 'Lab'} ColorSpace
 */

/**
 * Supported bit depths.
 * @typedef {8 | 16 | 32} BitDepth
 */

/**
 * Endianness for 16-bit data.
 * @typedef {'native' | 'big' | 'little'} Endianness
 */

/**
 * Memory layout for pixel data.
 * @typedef {'packed' | 'planar'} Layout
 */

/**
 * Channel ordering for RGB-based formats.
 * @typedef {'RGB' | 'BGR' | 'RGBA' | 'ARGB' | 'BGRA' | 'ABGR'} RGBChannelOrder
 */

/**
 * Channel ordering for CMYK-based formats.
 * @typedef {'CMYK' | 'KYMC' | 'KCMY'} CMYKChannelOrder
 */

/**
 * Channel ordering for grayscale formats.
 * @typedef {'Gray' | 'GrayA' | 'AGray'} GrayChannelOrder
 */

/**
 * Channel ordering for Lab formats.
 * @typedef {'Lab'} LabChannelOrder
 */

/**
 * Description of pixel data characteristics.
 *
 * Bit depth parameters:
 * - `bitsPerComponent`: Fallback for both input and output
 * - `inputBitsPerComponent`: Explicit bit depth for input (overrides bitsPerComponent)
 * - `outputBitsPerComponent`: Explicit bit depth for output (overrides bitsPerComponent)
 *
 * Endianness parameters (conditional on bit depth):
 * - `endianness`: Fallback for both input and output
 * - `inputEndianness`: Explicit endianness for input (overrides endianness)
 * - `outputEndianness`: Explicit endianness for output (overrides endianness)
 *
 * Endianness is only required for 16-bit data. For 8-bit it's ignored,
 * for 32-bit Float it's ignored with a warning if specified.
 *
 * @typedef {{
 *   colorSpace: ColorSpace,
 *   bitsPerComponent?: BitDepth,
 *   inputBitsPerComponent?: BitDepth,
 *   outputBitsPerComponent?: BitDepth,
 *   endianness?: Endianness,
 *   inputEndianness?: Endianness,
 *   outputEndianness?: Endianness,
 *   layout?: Layout,
 *   channelOrder?: RGBChannelOrder | CMYKChannelOrder | GrayChannelOrder | LabChannelOrder,
 *   hasAlpha?: boolean,
 *   alphaFirst?: boolean,
 * }} PixelFormatDescriptor
 */

/**
 * Mapping from format constant to its properties.
 * @typedef {{
 *   colorSpace: ColorSpace,
 *   bitsPerComponent: BitDepth,
 *   channels: number,
 *   bytesPerPixel: number,
 *   endianness: Endianness,
 *   layout: Layout,
 *   isFloat: boolean,
 *   hasAlpha: boolean,
 * }} FormatProperties
 */

/**
 * Rendering intent for color conversion.
 * @typedef {'perceptual' | 'relative-colorimetric' | 'saturation' | 'absolute-colorimetric' | 'preserve-k-only-relative-colorimetric-gcr'} RenderingIntent
 */

/**
 * Conversion descriptor for rule evaluation.
 *
 * @typedef {{
 *   sourceColorSpace: ColorSpace,
 *   destinationColorSpace: ColorSpace,
 *   renderingIntent: RenderingIntent,
 *   blackPointCompensation?: boolean,
 *   sourceProfile?: string | ArrayBuffer,
 *   destinationProfile?: string | ArrayBuffer,
 * }} ConversionDescriptor
 */

/**
 * Rule constraint definition.
 *
 * @typedef {{
 *   renderingIntents?: RenderingIntent[],
 *   sourceColorSpaces?: ColorSpace[],
 *   destinationColorSpaces?: ColorSpace[],
 *   blackPointCompensation?: boolean[],
 *   multiprofileBlackPointScaling?: boolean[],
 * }} RuleConstraints
 */

/**
 * Rule override definition.
 *
 * @typedef {{
 *   renderingIntent?: RenderingIntent,
 *   requiresMultiprofileTransform?: boolean,
 *   intermediateProfiles?: string[],
 *   blackPointCompensation?: boolean,
 *   multiprofileBlackPointScaling?: boolean,
 * }} RuleOverrides
 */

/**
 * Severity definition - can be string or object with domain-specific values.
 *
 * @typedef {'error' | 'warning' | { default: 'error' | 'warning', [domain: string]: 'error' | 'warning' }} RuleSeverity
 */

/**
 * Single rule definition.
 *
 * @typedef {{
 *   description: string,
 *   severity: RuleSeverity,
 *   constraints: RuleConstraints,
 *   overrides: RuleOverrides,
 * }} PolicyRule
 */

/**
 * Engine-specific policy group.
 *
 * @typedef {{
 *   policyId: string,
 *   engines?: string[],
 *   rules: PolicyRule[],
 * }} EnginePolicy
 */

/**
 * Loaded rule with policy context.
 *
 * @typedef {{
 *   policyId: string,
 *   ruleIndex: number,
 *   rule: PolicyRule,
 * }} LoadedPolicyRule
 */

/**
 * Single trace entry for rule evaluation.
 *
 * @typedef {{
 *   policyId: string,
 *   ruleIndex: number,
 *   description: string,
 *   severity: 'error' | 'warning',
 *   appliedOverrides: (keyof RuleOverrides)[],
 * }} RuleTraceEntry
 */

/**
 * Result of rule evaluation.
 *
 * @typedef {{
 *   valid: boolean,
 *   warnings: string[],
 *   errors: string[],
 *   overrides: RuleOverrides,
 *   matchedRules: PolicyRule[],
 *   trace: RuleTraceEntry[],
 * }} EvaluationResult
 */

/**
 * Policy configuration options.
 *
 * @typedef {{
 *   engineVersion?: string,
 *   domain?: string,
 * }} PolicyConfiguration
 */

// ============================================================================
// Rules Data (from POLICY-NOTES.md)
// ============================================================================

/**
 * Color engine policy rules.
 * Order matters - evaluated in sequence.
 *
 * @type {EnginePolicy[]}
 */
const COLOR_ENGINE_POLICIES = await (async () => {

    // /**
    //  * Processes a JSON object, transforming relative paths based on a filter function.
    //  * 
    //  * @template T
    //  * @param {T} jsonData - The JSON data to process
    //  * @param {URL} sourceURL - The URL of the source JSON file
    //  * @param {URL} targetURL - The URL of the target module (typically import.meta.url)
    //  * @param {(key: string, value: unknown) => boolean} pathFilter - Filter function that returns true for values containing paths to transform
    //  * @returns {{ processed: T, pathMappings: Record<string, string> }}
    //  */
    // function processJSONPaths(jsonData, sourceURL, targetURL, pathFilter) {
    //     /**
    //      * @param {`/${string}`} from
    //      * @param {`/${string}`} to 
    //      */
    //     const relativePath = (from, to) => /** @type {`${'..'|'.'}/${string}`} */(to.split(/\//g).reduce(
    //         ({ from, relative }, part, index) => ({ from, part, relative: from[index] === part ? (relative && ['..', ...relative, part]) : [...relative || ['..'], part] }),
    //         { from: from.split(/\//g), relative: /** @type {string[]?} */ (null) }
    //     ).relative?.join('/') ?? './');

    //     /** @type {Record<string, string>} */
    //     const pathMappings = {};
    //     const pathGroupings = {};

    //     /** @type {T} */
    //     const processed = JSON.parse(JSON.stringify(jsonData), function (key, value) {
    //         if (pathFilter(key, value)) {
    //             const rawPaths = Array.isArray(value) ? value : [value];
    //             /** @type {string[]} */
    //             const processedPaths = [];

    //             for (const pathSpecifier of rawPaths) {
    //                 if (typeof pathSpecifier !== 'string' || !/^\.{0,2}\//.test(pathSpecifier)) {
    //                     processedPaths.push(pathSpecifier);
    //                 } else {
    //                     const resolvedURL = new URL(pathSpecifier, sourceURL);
    //                     const relativizedPath = relativePath(
    //                             /** @type {`\/${string}`} */(decodeURIComponent(targetURL.pathname)),
    //                             /** @type {`\/${string}`} */(decodeURIComponent(resolvedURL.pathname)),
    //                     );
    //                     processedPaths.push(relativizedPath);
    //                     pathMappings[pathSpecifier] = relativizedPath;
    //                 }
    //             }

    //             return processedPaths;
    //         }

    //         return value;
    //     });

    //     return { processed, pathMappings };
    // };

    const importMetaURL = new URL(import.meta.url);
    const resolvedRulesURL = new URL(import.meta.resolve("../configurations/color-conversion-rules.json"), import.meta.url);

    /// console.dir('/a/b/c/d/e/f/g'.split(/\//g).reduce(({ from, relative }, part, index) => ({ from, part, relative: from[index] === part ? (relative && ['..', ...relative, part]) : [... relative || ['..'], part] }), { from: '/a/b/c/d/e1/f/g'.split(/\//g) }).relative?.join('/') ?? './')

    /**
     * @param {`/${string}`} from
     * @param {`/${string}`} to 
     */
    const relativePath = (from, to) => /** @type {`${'..'|'.'}/${string}`} */(to.split(/\//g).reduce(
        ({ from, relative }, part, index) => ({ from, part, relative: from[index] === part ? (relative && ['..', ...relative, part]) : [...relative || ['..'], part] }),
        { from: from.split(/\//g), relative: /** @type {string[]?} */ (null) }
    ).relative?.join('/') ?? './');

    const importedRules = await fetch(resolvedRulesURL).then(response => response.json());

    /// JSON.parse(JSON.stringify([{1:['a']}]), function(key, value, { source } = {}) { console.log({ context: this, key, value, source}); return value; });

    /** @type {Record<string, { relativeProfilePath: string, resolvedProfileURL: string }>} */
    const resolvedProfilePaths = {};

    /** @type {EnginePolicy[]} */
    const processedRules = JSON.parse(JSON.stringify(importedRules), function (key, value, { source } = /** @type {{ source?: string }} */ ({})) {
        if (key === 'intermediateProfiles' && Array.isArray(value)) {
            /** @type {string[]} */
            const processedIntermediateProfiles = [];

            for (const profileSpecifier of value) {
                if (!/^\.{0,2}\//.test(profileSpecifier)) {
                    processedIntermediateProfiles.push(profileSpecifier);
                } else {
                    // ColorConversionPolicy is responsible for absolute resolution
                    // because it knows the rules file path. The resolved absolute
                    // URL is what gets passed to ColorEngineProvider.loadProfile().
                    const resolvedProfileURL = new URL(profileSpecifier, resolvedRulesURL);

                    // DO NOT REMOVE — Re-relativization of intermediate profile paths
                    //
                    // This computes the relative path from this module's location
                    // to the resolved profile. It is intentionally kept even though
                    // the output currently uses the absolute URL. This re-relativized
                    // path is needed for future use when profile loading is decoupled
                    // from absolute URL resolution.
                    const relativeProfilePath = relativePath(
                        /** @type {`\/${string}`} */(decodeURIComponent(importMetaURL.pathname)),
                        /** @type {`\/${string}`} */(decodeURIComponent(resolvedProfileURL.pathname)),
                    );

                    processedIntermediateProfiles.push(resolvedProfileURL.href);
                    resolvedProfilePaths[profileSpecifier] = {
                        relativeProfilePath,
                        resolvedProfileURL: resolvedProfileURL.href,
                    };
                }
            }

            // DEBUG: Uncomment to trace profile path resolution
            // console.table(value.map((v, i) => [v, processedIntermediateProfiles[i]]));

            return processedIntermediateProfiles;
        }

        return value;
    });

    // DEBUG: Uncomment to trace rule processing
    // console.dir({ importedRules, processedRules, resolvedProfilePaths });

    return processedRules;
})();

// ============================================================================
// Format Lookup Table
// ============================================================================

/**
 * Maps (channelOrder:bitsPerComponent:endianness:layout) to TYPE_* constants.
 *
 * Note: 16-bit formats are NOT in this lookup table. They require dynamic
 * endianness handling via #getMultiByteFormat() because the correct TYPE_*
 * constant depends on comparing buffer endianness against WASM endianness.
 *
 * @type {Record<string, number>}
 */
const FORMAT_LOOKUP = {
    // Grayscale formats (8-bit and 32-bit only)
    'Gray:8:native:packed': TYPE_GRAY_8,
    'Gray:32:native:packed': TYPE_GRAY_FLT,
    'GrayA:8:native:packed': TYPE_GRAYA_8,

    // RGB formats (8-bit and 32-bit only)
    'RGB:8:native:packed': TYPE_RGB_8,
    'RGB:32:native:packed': TYPE_RGB_FLT,
    'BGR:8:native:packed': TYPE_BGR_8,
    'RGBA:8:native:packed': TYPE_RGBA_8,
    'ARGB:8:native:packed': TYPE_ARGB_8,
    'BGRA:8:native:packed': TYPE_BGRA_8,

    // CMYK formats (8-bit and 32-bit only)
    'CMYK:8:native:packed': TYPE_CMYK_8,
    'CMYK:32:native:packed': TYPE_CMYK_FLT,
    'KYMC:8:native:packed': TYPE_KYMC_8,

    // Lab formats (8-bit and 32-bit only)
    'Lab:8:native:packed': TYPE_Lab_8,
    'Lab:32:native:packed': TYPE_Lab_FLT,
};

/**
 * Channel counts for each color space.
 *
 * @type {Record<ColorSpace, number>}
 */
const COLOR_SPACE_CHANNELS = {
    'Gray': 1,
    'RGB': 3,
    'CMYK': 4,
    'Lab': 3,
};

/**
 * Pixel type constants for each color space.
 *
 * @type {Record<ColorSpace, number>}
 */
const COLOR_SPACE_PT = {
    'Gray': PT_GRAY,
    'RGB': PT_RGB,
    'CMYK': PT_CMYK,
    'Lab': PT_Lab,
};

// ============================================================================
// ColorConversionPolicy Class
// ============================================================================

/**
 * Flat, rules-driven policy for determining color conversion parameters.
 *
 * Centralizes format decisions and engine-specific behavior. Uses declarative
 * rules to handle engine version differences and domain-specific severity.
 *
 * @example
 * ```javascript
 * // Default engineVersion is derived from packages/color-engine (symlink)
 * const policy = new ColorConversionPolicy({
 *     domain: 'PDF',
 * });
 *
 * // Get format for 16-bit big-endian RGB (PDF standard)
 * const inputFormat = policy.getInputFormat({
 *     colorSpace: 'RGB',
 *     bitsPerComponent: 16,
 *     endianness: 'big',
 * });
 *
 * // Evaluate conversion rules
 * const result = policy.evaluateConversion({
 *     sourceColorSpace: 'Lab',
 *     destinationColorSpace: 'CMYK',
 *     renderingIntent: 'preserve-k-only-relative-colorimetric-gcr',
 * });
 *
 * if (result.overrides.renderingIntent) {
 *     // Use overridden intent
 * }
 * ```
 */
export class ColorConversionPolicy {
    /** @type {string} */
    #engineVersion;

    /** @type {string} */
    #domain;

    /** @type {LoadedPolicyRule[]} */
    #rules;

    /** @type {'little' | 'big'} */
    #wasmEndianness;

    // ========================================
    // Constructor
    // ========================================

    /**
     * Creates a new ColorConversionPolicy instance.
     *
     * @param {PolicyConfiguration} [configuration]
     */
    constructor(configuration = {}) {
        this.#engineVersion = configuration.engineVersion ?? DEFAULT_ENGINE_VERSION;
        this.#domain = configuration.domain ?? 'default';
        this.#rules = this.#loadRulesForEngine(this.#engineVersion);
        this.#wasmEndianness = WEB_ASSEMBLY_ENDIANNESS;
    }

    /**
     * Gets the WebAssembly memory endianness.
     * @returns {'little' | 'big'}
     */
    get wasmEndianness() {
        return this.#wasmEndianness;
    }

    /**
     * Gets the engine version.
     * @returns {string}
     */
    get engineVersion() {
        return this.#engineVersion;
    }

    /**
     * Gets the domain.
     * @returns {string}
     */
    get domain() {
        return this.#domain;
    }

    // ========================================
    // Rules Loading
    // ========================================

    /**
     * Loads rules applicable to the given engine version.
     *
     * @param {string} engineVersion
     * @returns {LoadedPolicyRule[]}
     */
    #loadRulesForEngine(engineVersion) {
        /** @type {LoadedPolicyRule[]} */
        const applicableRules = [];

        for (const policy of COLOR_ENGINE_POLICIES) {
            if (policy.engines?.includes(engineVersion)) {
                for (let i = 0; i < policy.rules.length; i++) {
                    applicableRules.push({
                        policyId: policy.policyId,
                        ruleIndex: i,
                        rule: policy.rules[i],
                    });
                }
            }
        }

        return applicableRules;
    }

    // ========================================
    // Endianness Handling
    // ========================================

    /**
     * Determines if endian swap is needed for the given buffer endianness.
     *
     * This is the SINGLE SOURCE OF TRUTH for TYPE_*_SE selection.
     * Both #getMultiByteFormat() and #buildFormat() call this method.
     *
     * @param {'big' | 'little'} bufferEndianness - Actual endianness of the buffer
     * @returns {boolean} true if TYPE_*_SE should be used
     */
    #needsEndianSwap(bufferEndianness) {
        return bufferEndianness !== this.#wasmEndianness;
    }

    /**
     * Checks if the bit depth requires multi-byte handling.
     *
     * Supported multi-byte formats:
     * - 16-bit (Uint16) - has SE variants for endian swapping
     * - 32-bit (Float32) - no SE variants, IEEE 754 standard
     *
     * @param {number} bitsPerComponent
     * @returns {boolean} true if multi-byte format
     */
    #isMultiByte(bitsPerComponent) {
        return bitsPerComponent > 8;
    }

    /**
     * Determines the correct multi-byte format based on buffer endianness.
     *
     * Uses #needsEndianSwap() as the single source of truth for SE flag selection.
     *
     * @param {ColorSpace} colorSpace
     * @param {number} bitsPerComponent - Bit depth (16 or 32)
     * @param {'big' | 'little'} bufferEndianness - Actual endianness of the buffer
     * @param {Layout} layout
     * @param {string} [channelOrder] - Channel ordering (e.g., 'RGB', 'BGR', 'CMYK', 'KYMC')
     * @returns {number} TYPE_* constant
     */
    #getMultiByteFormat(colorSpace, bitsPerComponent, bufferEndianness, layout, channelOrder) {
        if (layout !== 'packed') {
            throw new Error(`Only packed layout supported for ${bitsPerComponent}-bit formats`);
        }

        // Use single source of truth for SE flag decision
        const needsSwap = this.#needsEndianSwap(bufferEndianness);

        // Select format based on bit depth and color space
        switch (bitsPerComponent) {
            case 16:
                // Uint16 - has SE variants for endian swapping
                return this.#get16BitFormatConstant(colorSpace, needsSwap, channelOrder);
            case 32:
                // Float32 - no SE variants in LittleCMS, IEEE 754 standard
                return this.#get32BitFormatConstant(colorSpace);
            default:
                throw new Error(`Unsupported multi-byte bit depth: ${bitsPerComponent}`);
        }
    }

    /**
     * Returns the TYPE_* constant for 16-bit formats.
     *
     * @param {ColorSpace} colorSpace
     * @param {boolean} needsSwap - Whether to use SE variant
     * @param {string} [channelOrder] - Channel ordering
     * @returns {number} TYPE_* constant
     */
    #get16BitFormatConstant(colorSpace, needsSwap, channelOrder) {
        // Handle channel order variants
        if (channelOrder === 'BGR') {
            return needsSwap ? TYPE_BGR_16_SE : TYPE_BGR_16;
        }
        if (channelOrder === 'KYMC') {
            return needsSwap ? TYPE_KYMC_16_SE : TYPE_KYMC_16;
        }
        if (channelOrder === 'GrayA') {
            return needsSwap ? TYPE_GRAYA_16_SE : TYPE_GRAYA_16;
        }
        if (channelOrder === 'RGBA') {
            return needsSwap ? TYPE_RGBA_16_SE : TYPE_RGBA_16;
        }

        // Standard color space formats
        switch (colorSpace) {
            case 'Gray':
                return needsSwap ? TYPE_GRAY_16_SE : TYPE_GRAY_16;
            case 'RGB':
                return needsSwap ? TYPE_RGB_16_SE : TYPE_RGB_16;
            case 'CMYK':
                return needsSwap ? TYPE_CMYK_16_SE : TYPE_CMYK_16;
            case 'Lab':
                return needsSwap ? TYPE_Lab_16_SE : TYPE_Lab_16;
            default:
                throw new Error(`Unsupported color space for 16-bit: ${colorSpace}`);
        }
    }

    /**
     * Returns the TYPE_* constant for 32-bit float formats.
     *
     * LittleCMS does not provide SE (Swap Endian) variants for float formats.
     * This is an upstream design decision in LittleCMS:
     * - The endian flag is specifically ENDIAN16_SH (for 16-bit data only)
     * - IEEE 754 floats have standardized representation
     * - Float byte order was not considered a cross-platform concern
     *
     * @param {ColorSpace} colorSpace
     * @returns {number} TYPE_* constant
     */
    #get32BitFormatConstant(colorSpace) {
        switch (colorSpace) {
            case 'Gray':
                return TYPE_GRAY_FLT;
            case 'RGB':
                return TYPE_RGB_FLT;
            case 'CMYK':
                return TYPE_CMYK_FLT;
            case 'Lab':
                return TYPE_Lab_FLT;
            default:
                throw new Error(`Unsupported color space for 32-bit: ${colorSpace}`);
        }
    }

    // ========================================
    // Rule Evaluation
    // ========================================

    /**
     * Evaluates conversion rules and returns results with overrides.
     *
     * @param {ConversionDescriptor} descriptor
     * @returns {EvaluationResult}
     */
    evaluateConversion(descriptor) {
        /** @type {string[]} */
        const warnings = [];
        /** @type {string[]} */
        const errors = [];
        /** @type {PolicyRule[]} */
        const matchedRules = [];
        /** @type {RuleTraceEntry[]} */
        const trace = [];
        /** @type {RuleOverrides} */
        let overrides = {};

        for (const loaded of this.#rules) {
            const { policyId, ruleIndex, rule } = loaded;

            if (this.#ruleMatches(rule, descriptor)) {
                matchedRules.push(rule);

                // Determine severity for this domain
                const severity = this.#getSeverityForDomain(rule.severity);
                const message = this.#formatDescription(rule.description);

                if (severity === 'error') {
                    errors.push(message);
                } else {
                    warnings.push(message);
                }

                // Track which overrides this rule applied
                const appliedOverrides = /** @type {(keyof RuleOverrides)[]} */ (
                    Object.keys(rule.overrides)
                );

                // Add trace entry
                trace.push({
                    policyId,
                    ruleIndex,
                    description: message,
                    severity,
                    appliedOverrides,
                });

                // Merge overrides (later rules override earlier)
                overrides = { ...overrides, ...rule.overrides };
            }
        }

        return {
            valid: errors.length === 0,
            warnings,
            errors,
            overrides,
            matchedRules,
            trace,
        };
    }

    /**
     * Checks if a rule's constraints match the descriptor.
     *
     * @param {PolicyRule} rule
     * @param {ConversionDescriptor} descriptor
     * @returns {boolean}
     */
    #ruleMatches(rule, descriptor) {
        const { constraints } = rule;

        // Check rendering intent
        if (constraints.renderingIntents) {
            if (!constraints.renderingIntents.includes(descriptor.renderingIntent)) {
                return false;
            }
        }

        // Check source color space
        if (constraints.sourceColorSpaces) {
            if (!constraints.sourceColorSpaces.includes(descriptor.sourceColorSpace)) {
                return false;
            }
        }

        // Check destination color space
        if (constraints.destinationColorSpaces) {
            if (!constraints.destinationColorSpaces.includes(descriptor.destinationColorSpace)) {
                return false;
            }
        }

        // Check black point compensation
        if (constraints.blackPointCompensation) {
            const descriptorBPC = descriptor.blackPointCompensation ?? false;
            if (!constraints.blackPointCompensation.includes(descriptorBPC)) {
                return false;
            }
        }

        return true;
    }

    /**
     * Gets the severity for the current domain.
     *
     * @param {RuleSeverity} severity
     * @returns {'error' | 'warning'}
     */
    #getSeverityForDomain(severity) {
        if (typeof severity === 'string') {
            return severity;
        }

        // Object with domain-specific values
        if (this.#domain in severity) {
            return severity[this.#domain];
        }

        return severity.default;
    }

    /**
     * Formats description with template variables.
     *
     * @param {string} description
     * @returns {string}
     */
    #formatDescription(description) {
        return description.replace(/\{\{COLOR_ENGINE_VERSION\}\}/g, this.#engineVersion);
    }

    // ========================================
    // Convenience Methods for Common Queries
    // ========================================

    /**
     * Gets the effective rendering intent after applying rule overrides.
     *
     * @param {ConversionDescriptor} descriptor
     * @returns {RenderingIntent}
     */
    getEffectiveRenderingIntent(descriptor) {
        const result = this.evaluateConversion(descriptor);
        return result.overrides.renderingIntent ?? descriptor.renderingIntent;
    }

    /**
     * Checks if multiprofile transform is required.
     *
     * @param {ConversionDescriptor} descriptor
     * @returns {boolean}
     */
    requiresMultiprofileTransform(descriptor) {
        const result = this.evaluateConversion(descriptor);
        return result.overrides.requiresMultiprofileTransform ?? false;
    }

    /**
     * Gets intermediate profiles if required.
     *
     * @param {ConversionDescriptor} descriptor
     * @returns {string[]}
     */
    getIntermediateProfiles(descriptor) {
        const result = this.evaluateConversion(descriptor);
        return result.overrides.intermediateProfiles ?? [];
    }

    /**
     * Checks if multiprofile black point scaling is required.
     * When true, cmsFLAGS_MULTIPROFILE_BPC_SCALING should be added to transform flags.
     *
     * @param {ConversionDescriptor} descriptor
     * @returns {boolean}
     */
    requiresMultiprofileBlackPointScaling(descriptor) {
        const result = this.evaluateConversion(descriptor);
        return result.overrides.multiprofileBlackPointScaling ?? false;
    }

    // ========================================
    // Format Determination
    // ========================================

    /**
     * Determines the input pixel format constant for the color engine.
     *
     * Resolves `inputBitsPerComponent ?? bitsPerComponent` and
     * `inputEndianness ?? endianness` before format lookup.
     *
     * @param {PixelFormatDescriptor} descriptor - Description of input data
     * @returns {number} TYPE_* constant for input format
     * @throws {Error} If no matching format is found or endianness not specified for 16-bit
     */
    getInputFormat(descriptor) {
        const resolvedDescriptor = this.#resolveInputDescriptor(descriptor);
        return this.#resolveFormat(resolvedDescriptor);
    }

    /**
     * Determines the output pixel format constant for the color engine.
     *
     * Resolves `outputBitsPerComponent ?? bitsPerComponent` and
     * `outputEndianness ?? endianness` before format lookup.
     *
     * @param {PixelFormatDescriptor} descriptor - Description of desired output
     * @returns {number} TYPE_* constant for output format
     * @throws {Error} If no matching format is found or endianness not specified for 16-bit
     */
    getOutputFormat(descriptor) {
        const resolvedDescriptor = this.#resolveOutputDescriptor(descriptor);
        return this.#resolveFormat(resolvedDescriptor);
    }

    /**
     * Resolves input-specific parameters from descriptor.
     *
     * @param {PixelFormatDescriptor} descriptor
     * @returns {PixelFormatDescriptor} Descriptor with resolved input parameters
     */
    #resolveInputDescriptor(descriptor) {
        const bitsPerComponent = descriptor.inputBitsPerComponent ?? descriptor.bitsPerComponent;
        const endianness = descriptor.inputEndianness ?? descriptor.endianness;

        // Validate bitsPerComponent is resolvable
        if (bitsPerComponent === undefined) {
            throw new Error(
                'Cannot determine input bit depth: provide bitsPerComponent or inputBitsPerComponent'
            );
        }

        // Warn if endianness specified for 32-bit (no effect)
        if (bitsPerComponent === 32 && endianness !== undefined) {
            console.warn(
                `${CONTEXT_PREFIX} [ColorConversionPolicy] inputEndianness has no effect on 32-bit float input (no TYPE_*_FLT_SE in LittleCMS)`
            );
        }

        return {
            ...descriptor,
            bitsPerComponent,
            endianness,
        };
    }

    /**
     * Resolves output-specific parameters from descriptor.
     *
     * @param {PixelFormatDescriptor} descriptor
     * @returns {PixelFormatDescriptor} Descriptor with resolved output parameters
     */
    #resolveOutputDescriptor(descriptor) {
        const bitsPerComponent = descriptor.outputBitsPerComponent ?? descriptor.bitsPerComponent;
        const endianness = descriptor.outputEndianness ?? descriptor.endianness;

        // Validate bitsPerComponent is resolvable
        if (bitsPerComponent === undefined) {
            throw new Error(
                'Cannot determine output bit depth: provide bitsPerComponent or outputBitsPerComponent'
            );
        }

        // Warn if endianness specified for 32-bit (no effect)
        if (bitsPerComponent === 32 && endianness !== undefined) {
            console.warn(
                `${CONTEXT_PREFIX} [ColorConversionPolicy] outputEndianness has no effect on 32-bit float output (no TYPE_*_FLT_SE in LittleCMS)`
            );
        }

        return {
            ...descriptor,
            bitsPerComponent,
            endianness,
        };
    }

    /**
     * Resolves a format descriptor to a TYPE_* constant.
     *
     * @param {PixelFormatDescriptor} descriptor
     * @returns {number}
     */
    #resolveFormat(descriptor) {
        const {
            colorSpace,
            bitsPerComponent,
            endianness,
            layout = 'packed',
            channelOrder,
            hasAlpha = false,
            alphaFirst = false,
        } = descriptor;

        // Determine effective channel order
        let effectiveOrder = channelOrder;
        if (!effectiveOrder) {
            if (colorSpace === 'Gray') {
                effectiveOrder = hasAlpha ? 'GrayA' : 'Gray';
            } else if (colorSpace === 'RGB') {
                if (hasAlpha) {
                    effectiveOrder = alphaFirst ? 'ARGB' : 'RGBA';
                } else {
                    effectiveOrder = 'RGB';
                }
            } else if (colorSpace === 'CMYK') {
                effectiveOrder = 'CMYK';
            } else if (colorSpace === 'Lab') {
                effectiveOrder = 'Lab';
            }
        }

        // For multi-byte formats, determine format dynamically based on WASM endianness
        if (this.#isMultiByte(bitsPerComponent)) {
            // Validate supported bit depths first (before endianness check)
            if (bitsPerComponent !== 16 && bitsPerComponent !== 32) {
                throw new Error(`Unsupported bit depth: ${bitsPerComponent}. Supported: 8, 16, 32.`);
            }

            // 32-bit Float formats don't have SE variants - endianness not required
            if (bitsPerComponent === 32) {
                return this.#get32BitFormatConstant(colorSpace);
            }

            // 16-bit formats require explicit endianness for SE flag determination
            if (endianness === undefined || endianness === 'native') {
                throw new Error(`endianness must be 'big' or 'little' for ${bitsPerComponent}-bit data`);
            }
            return this.#getMultiByteFormat(
                colorSpace,
                bitsPerComponent,
                endianness,
                layout,
                effectiveOrder
            );
        }

        // For 8-bit formats, use lookup table (endianness irrelevant)
        const endianKey = 'native';
        const lookupKey = `${effectiveOrder}:${bitsPerComponent}:${endianKey}:${layout}`;

        // Try direct lookup
        const format = FORMAT_LOOKUP[lookupKey];
        if (format !== undefined) {
            return format;
        }

        // Try building format dynamically
        const dynamicFormat = this.#buildFormat(descriptor);
        if (dynamicFormat !== null) {
            return dynamicFormat;
        }

        throw new Error(
            `No matching format for: colorSpace=${colorSpace}, ` +
            `bitsPerComponent=${bitsPerComponent}, endianness=${endianness}, ` +
            `layout=${layout}, channelOrder=${effectiveOrder}`
        );
    }

    /**
     * Builds a format constant dynamically for cases not in lookup table.
     *
     * @param {PixelFormatDescriptor} descriptor
     * @returns {number | null}
     */
    #buildFormat(descriptor) {
        const {
            colorSpace,
            bitsPerComponent,
            endianness,
            layout = 'packed',
            channelOrder,
            hasAlpha = false,
            alphaFirst = false,
        } = descriptor;

        const pt = COLOR_SPACE_PT[colorSpace];
        if (pt === undefined) {
            return null;
        }

        let channels = COLOR_SPACE_CHANNELS[colorSpace];
        if (hasAlpha) {
            channels += 1;
        }

        let bytes;
        let isFloat = false;
        if (bitsPerComponent === 8) {
            bytes = 1;
        } else if (bitsPerComponent === 16) {
            bytes = 2;
        } else if (bitsPerComponent === 32) {
            bytes = 4;
            isFloat = true;
        } else {
            return null;
        }

        // Build format using shift functions
        let format = COLORSPACE_SH(pt) | CHANNELS_SH(channels) | BYTES_SH(bytes);

        if (isFloat) {
            format |= FLOAT_SH(1);
        }

        // For multi-byte integers, set SE flag based on #needsEndianSwap()
        if (this.#isMultiByte(bitsPerComponent) && !isFloat) {
            if (endianness && endianness !== 'native' && this.#needsEndianSwap(endianness)) {
                format |= ENDIAN16_SH(1);
            }
        }

        if (layout === 'planar') {
            format |= PLANAR_SH(1);
        }

        if (hasAlpha) {
            format |= EXTRA_SH(1);
            if (alphaFirst) {
                format |= SWAPFIRST_SH(1);
            }
        }

        // Handle channel swapping for BGR, KYMC, etc.
        if (channelOrder === 'BGR' || channelOrder === 'BGRA' || channelOrder === 'KYMC') {
            format |= DOSWAP_SH(1);
        }

        if (channelOrder === 'ARGB' || channelOrder === 'ABGR') {
            format |= SWAPFIRST_SH(1);
        }

        if (channelOrder === 'BGRA' || channelOrder === 'ABGR') {
            format |= DOSWAP_SH(1) | SWAPFIRST_SH(1);
        }

        return format;
    }

    // ========================================
    // Buffer Management
    // ========================================

    /**
     * Creates appropriate TypedArray for output based on format.
     *
     * @param {number} format - TYPE_* constant
     * @param {number} pixelCount - Number of pixels
     * @param {number} [channelsOverride] - Override channel count (optional)
     * @returns {Uint8Array | Uint16Array | Float32Array}
     * @throws {Error} If format is not recognized
     */
    createOutputBuffer(format, pixelCount, channelsOverride) {
        const props = this.getFormatProperties(format);
        const channels = channelsOverride ?? props.channels;
        const elementCount = pixelCount * channels;

        if (props.isFloat) {
            return new Float32Array(elementCount);
        } else if (props.bitsPerComponent === 16) {
            return new Uint16Array(elementCount);
        } else {
            return new Uint8Array(elementCount);
        }
    }

    /**
     * Creates appropriate TypedArray for input based on format.
     *
     * @param {number} format - TYPE_* constant
     * @param {number} pixelCount - Number of pixels
     * @param {number} [channelsOverride] - Override channel count (optional)
     * @returns {Uint8Array | Uint16Array | Float32Array}
     */
    createInputBuffer(format, pixelCount, channelsOverride) {
        return this.createOutputBuffer(format, pixelCount, channelsOverride);
    }

    // ========================================
    // Format Properties
    // ========================================

    /**
     * Gets bytes per sample (component) for a given format.
     *
     * @param {number} format - TYPE_* constant
     * @returns {1 | 2 | 4}
     */
    getBytesPerSample(format) {
        const props = this.getFormatProperties(format);
        return /** @type {1 | 2 | 4} */ (props.bitsPerComponent / 8);
    }

    /**
     * Gets the number of channels for a format.
     *
     * @param {number} format - TYPE_* constant
     * @returns {number}
     */
    getChannels(format) {
        return this.getFormatProperties(format).channels;
    }

    /**
     * Gets bytes per pixel for a format.
     *
     * @param {number} format - TYPE_* constant
     * @returns {number}
     */
    getBytesPerPixel(format) {
        return this.getFormatProperties(format).bytesPerPixel;
    }

    /**
     * Gets the color space for a format.
     *
     * @param {number} format - TYPE_* constant
     * @returns {ColorSpace}
     */
    getColorSpace(format) {
        return this.getFormatProperties(format).colorSpace;
    }

    /**
     * Gets the bit depth for a format.
     *
     * @param {number} format - TYPE_* constant
     * @returns {BitDepth}
     */
    getBitDepth(format) {
        return this.getFormatProperties(format).bitsPerComponent;
    }

    /**
     * Checks if format uses floating point values.
     *
     * @param {number} format - TYPE_* constant
     * @returns {boolean}
     */
    isFloatFormat(format) {
        return this.getFormatProperties(format).isFloat;
    }

    /**
     * Gets complete properties for a format.
     *
     * @param {number} format - TYPE_* constant
     * @returns {FormatProperties}
     * @throws {Error} If format is not recognized
     */
    getFormatProperties(format) {
        const decoded = this.#decodeFormat(format);
        if (decoded) {
            return decoded;
        }
        throw new Error(`Unknown format constant: ${format} (0x${format.toString(16)})`);
    }

    /**
     * Decodes a format constant to properties.
     *
     * @param {number} format - TYPE_* constant
     * @returns {FormatProperties | null}
     */
    #decodeFormat(format) {
        // Extract bit fields from format constant
        const bytes = format & 0x7;
        const channels = (format >> 3) & 0xF;
        const extra = (format >> 7) & 0x7;
        const endian16 = (format >> 11) & 0x1;
        const planar = (format >> 12) & 0x1;
        const colorSpaceCode = (format >> 16) & 0x1F;
        const isFloat = (format >> 22) & 0x1;

        // Map color space code to name
        let colorSpace;
        switch (colorSpaceCode) {
            case PT_GRAY: colorSpace = 'Gray'; break;
            case PT_RGB: colorSpace = 'RGB'; break;
            case PT_CMYK: colorSpace = 'CMYK'; break;
            case PT_Lab: colorSpace = 'Lab'; break;
            default: return null;
        }

        // Determine bit depth
        let bitsPerComponent;
        if (isFloat) {
            bitsPerComponent = bytes === 4 ? 32 : bytes === 2 ? 16 : 32;
        } else {
            bitsPerComponent = bytes * 8;
        }

        // Determine endianness
        let endianness;
        if (bitsPerComponent === 16) {
            endianness = endian16 === 0 ? 'little' : 'big';
        } else {
            endianness = 'native';
        }

        const totalChannels = channels + extra;
        const bytesPerPixel = totalChannels * bytes;

        return {
            colorSpace: /** @type {ColorSpace} */ (colorSpace),
            bitsPerComponent: /** @type {BitDepth} */ (bitsPerComponent),
            channels: totalChannels,
            bytesPerPixel,
            endianness: /** @type {Endianness} */ (endianness),
            layout: /** @type {Layout} */ (planar === 1 ? 'planar' : 'packed'),
            isFloat: isFloat === 1,
            hasAlpha: extra > 0,
        };
    }

    // ========================================
    // Convenience Methods
    // ========================================

    /**
     * Gets the standard format for a color space and bit depth.
     *
     * @param {ColorSpace} colorSpace
     * @param {BitDepth} bitsPerComponent
     * @param {Endianness} [endianness='big'] - Required for 16-bit, ignored for 8/32-bit
     * @returns {number} TYPE_* constant
     */
    getStandardFormat(colorSpace, bitsPerComponent, endianness = 'big') {
        return this.getInputFormat({
            colorSpace,
            bitsPerComponent,
            endianness,
            layout: 'packed',
        });
    }

    /**
     * Gets appropriate TypedArray constructor for a format.
     *
     * @param {number} format - TYPE_* constant
     * @returns {typeof Uint8Array | typeof Uint16Array | typeof Float32Array}
     */
    getTypedArrayConstructor(format) {
        const props = this.getFormatProperties(format);
        if (props.isFloat) {
            return Float32Array;
        } else if (props.bitsPerComponent === 16) {
            return Uint16Array;
        } else {
            return Uint8Array;
        }
    }

    /**
     * Validates that a buffer matches the expected format.
     *
     * @param {Uint8Array | Uint16Array | Float32Array} buffer
     * @param {number} format
     * @param {number} pixelCount
     * @returns {{ valid: boolean, error?: string }}
     */
    validateBuffer(buffer, format, pixelCount) {
        const props = this.getFormatProperties(format);
        const expectedElements = pixelCount * props.channels;

        // Check buffer type
        const expectedConstructor = this.getTypedArrayConstructor(format);
        if (!(buffer instanceof expectedConstructor)) {
            return {
                valid: false,
                error: `Buffer type mismatch: expected ${expectedConstructor.name}, got ${buffer.constructor.name}`,
            };
        }

        // Check buffer length
        if (buffer.length !== expectedElements) {
            return {
                valid: false,
                error: `Buffer length mismatch: expected ${expectedElements} elements, got ${buffer.length}`,
            };
        }

        return { valid: true };
    }

    // ========================================
    // Rendering Intent Helpers
    // ========================================

    /**
     * Checks if intent is K-Only GCR.
     *
     * @param {RenderingIntent} intent
     * @returns {boolean}
     */
    isKOnlyGCR(intent) {
        return intent === 'preserve-k-only-relative-colorimetric-gcr';
    }

    /**
     * Maps rendering intent string to LittleCMS constant.
     *
     * @param {RenderingIntent} intent
     * @returns {number}
     */
    getRenderingIntentConstant(intent) {
        switch (intent) {
            case 'perceptual':
                return 0;
            case 'relative-colorimetric':
                return 1;
            case 'saturation':
                return 2;
            case 'absolute-colorimetric':
                return 3;
            case 'preserve-k-only-relative-colorimetric-gcr':
                return 20;
            default:
                return 1; // Default to Relative Colorimetric
        }
    }
}
