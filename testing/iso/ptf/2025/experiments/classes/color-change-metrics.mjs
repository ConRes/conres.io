// @ts-check
/**
 * Color Change Metrics Class
 *
 * Self-describing metrics class for verifying color changes in PDF content streams.
 * Follows the same pattern as DeltaEMetrics with static metadata and instance state.
 *
 * The coordinator discovers this class by `static metricName` and reads
 * `static metricDefinitions` to understand requirements and defaults.
 *
 * Verification Flow:
 * 1. Set input color specification (what to look for in source PDF)
 * 2. Add expected output specifications for each pair member
 * 3. Add verifications at specific positions (page/stream/operator)
 * 4. Get metrics to see pass/fail counts and details
 *
 * @module color-change-metrics
 */

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Input color specification (what to look for in source PDF).
 * @typedef {{
 *   colorspace: string,
 *   values: number[],
 * }} ColorInputSpec
 */

/**
 * Output color specification (expected output values and tolerances).
 * @typedef {{
 *   colorspace: string,
 *   values: number[],
 *   tolerances: number[],
 * }} ColorOutputSpec
 */

/**
 * Position in PDF content stream.
 * @typedef {{
 *   pageNum: number,
 *   streamIndex: number,
 *   operatorIndex: number,
 * }} ContentPosition
 */

/**
 * Color match from ContentStreamColorExtractor.
 * @typedef {{
 *   pageNum: number,
 *   streamIndex: number,
 *   operatorIndex: number,
 *   operator: string,
 *   colorspace: string,
 *   values: number[],
 *   index: number,
 * }} ColorMatch
 */

/**
 * Single verification result.
 * @typedef {{
 *   position: ContentPosition,
 *   inputMatch: ColorMatch,
 *   outputResults: Record<string, {
 *     match: ColorMatch | null,
 *     expected: ColorOutputSpec,
 *     passed: boolean,
 *     differences?: number[],
 *   }>,
 *   passed: boolean,
 * }} VerificationResult
 */

/**
 * Metrics result.
 * @typedef {{
 *   inputSpec: ColorInputSpec,
 *   outputSpecs: Record<string, ColorOutputSpec>,
 *   passed: number,
 *   failed: number,
 *   total: number,
 *   verifications: VerificationResult[],
 * }} ColorChangeMetricsResult
 */

/**
 * Transferable data for structured clone.
 * @typedef {{
 *   inputSpec: ColorInputSpec | null,
 *   outputSpecs: Array<[string, ColorOutputSpec]>,
 *   verifications: VerificationResult[],
 * }} ColorChangeMetricsTransferable
 */

// ============================================================================
// ColorChangeMetrics Class
// ============================================================================

export class ColorChangeMetrics {
    // ========================================
    // Static Metadata (Self-Describing)
    // ========================================

    /** Discovery key - matches config aspect.type */
    static metricName = 'Color';

    /**
     * Class-owned metadata and defaults.
     * Contains ALL Color change specific configuration in one place.
     */
    static metricDefinitions = {
        // What resource type this metric operates on
        resource: /** @type {'Contents'} */ ('Contents'),

        // Required data for verification
        dataRequirements: {
            input: 'colorspace + values',
            output: 'colorspace + values + tolerances',
        },

        // Default values for instance parameters
        defaults: {
            tolerances: [0, 0, 0, 0], // Per-channel tolerances (CMYK has 4)
        },

        // Available tolerance presets
        toleranceTypes: {
            exact: {
                name: 'Exact Match',
                description: 'Values must match exactly (tolerance 0)',
                tolerances: [0, 0, 0, 0],
            },
            loose: {
                name: 'Loose Match',
                description: 'Allow small variations (1%)',
                tolerances: [0.01, 0.01, 0.01, 0.01],
            },
            permissive: {
                name: 'Permissive Match',
                description: 'Allow larger variations (5%)',
                tolerances: [0.05, 0.05, 0.05, 0.05],
            },
        },

        // Colorspace categories
        colorspaceCategories: {
            device: ['DeviceGray', 'DeviceRGB', 'DeviceCMYK'],
            iccBased: ['ICCBasedGray', 'ICCBasedRGB', 'ICCBasedCMYK'],
            special: ['Lab', 'Separation'],
        },
    };

    // ========================================
    // Instance State
    // ========================================

    /** @type {ColorInputSpec | null} */
    #inputSpec = null;

    /** @type {Map<string, ColorOutputSpec>} */
    #outputSpecs = new Map();

    /** @type {VerificationResult[]} */
    #verifications = [];

    /**
     * Create a new ColorChangeMetrics instance.
     *
     * @param {{
     *   definitions?: typeof ColorChangeMetrics.metricDefinitions,
     *   tolerances?: number[],
     * }} [options]
     */
    constructor(options = {}) {
        // Use passed definitions (from coordinator) or fall back to class static
        // Currently not using definitions in constructor, but kept for consistency
        // with DeltaEMetrics pattern
    }

    // ========================================
    // Specification Management
    // ========================================

    /**
     * Set the input color specification (what to look for in source PDF).
     *
     * @param {ColorInputSpec} spec
     * @returns {this}
     */
    setInputSpec(spec) {
        this.#inputSpec = spec;
        return this;
    }

    /**
     * Get the input specification.
     *
     * @returns {ColorInputSpec | null}
     */
    get inputSpec() {
        return this.#inputSpec;
    }

    /**
     * Add an expected output specification for a pair member.
     *
     * @param {string} name - Pair member name (e.g., "Main Thread", "Workers")
     * @param {ColorOutputSpec} spec - Expected output values and tolerances
     * @returns {this}
     */
    addOutputSpec(name, spec) {
        // Validate tolerance count matches value count
        if (spec.tolerances.length !== spec.values.length) {
            throw new Error(
                `Tolerance count (${spec.tolerances.length}) must match value count (${spec.values.length})`
            );
        }
        this.#outputSpecs.set(name, spec);
        return this;
    }

    /**
     * Get output specifications.
     *
     * @returns {Map<string, ColorOutputSpec>}
     */
    get outputSpecs() {
        return new Map(this.#outputSpecs);
    }

    /**
     * Get output specification for a specific pair member.
     *
     * @param {string} name
     * @returns {ColorOutputSpec | undefined}
     */
    getOutputSpec(name) {
        return this.#outputSpecs.get(name);
    }

    // ========================================
    // Verification Management
    // ========================================

    /**
     * Add a verification result for a specific position.
     *
     * @param {ContentPosition} position - Position in content stream
     * @param {ColorMatch} inputMatch - The input color match at this position
     * @param {Record<string, ColorMatch | null>} outputMatches - Output matches per pair member
     * @returns {this}
     */
    addVerification(position, inputMatch, outputMatches) {
        /** @type {Record<string, VerificationResult['outputResults'][string]>} */
        const outputResults = {};
        let allPassed = true;

        for (const [name, match] of Object.entries(outputMatches)) {
            const expected = this.#outputSpecs.get(name);
            if (!expected) {
                throw new Error(`No output spec defined for pair member "${name}"`);
            }

            if (match === null) {
                // No match found at this position
                outputResults[name] = {
                    match: null,
                    expected,
                    passed: false,
                };
                allPassed = false;
            } else {
                // Check colorspace matches
                if (match.colorspace !== expected.colorspace) {
                    outputResults[name] = {
                        match,
                        expected,
                        passed: false,
                        differences: match.values.map((v, i) => Math.abs(v - expected.values[i])),
                    };
                    allPassed = false;
                } else {
                    // Check values within tolerances
                    const differences = match.values.map((v, i) => Math.abs(v - expected.values[i]));
                    const withinTolerance = differences.every((diff, i) => diff <= expected.tolerances[i]);

                    outputResults[name] = {
                        match,
                        expected,
                        passed: withinTolerance,
                        differences,
                    };

                    if (!withinTolerance) {
                        allPassed = false;
                    }
                }
            }
        }

        this.#verifications.push({
            position,
            inputMatch,
            outputResults,
            passed: allPassed,
        });

        return this;
    }

    /**
     * Clear all verifications.
     *
     * @returns {this}
     */
    reset() {
        this.#verifications = [];
        return this;
    }

    /**
     * Get verification count.
     *
     * @returns {number}
     */
    get verificationCount() {
        return this.#verifications.length;
    }

    // ========================================
    // Static Utility Methods
    // ========================================

    /**
     * Check if values match within tolerances.
     *
     * @param {number[]} actual - Actual values
     * @param {number[]} expected - Expected values
     * @param {number[]} tolerances - Per-channel tolerances
     * @returns {boolean}
     */
    static valuesMatchWithinTolerance(actual, expected, tolerances) {
        if (actual.length !== expected.length) return false;
        for (let i = 0; i < actual.length; i++) {
            const tolerance = tolerances[i] ?? 0;
            if (Math.abs(actual[i] - expected[i]) > tolerance) {
                return false;
            }
        }
        return true;
    }

    /**
     * Create position key for indexing.
     *
     * @param {ContentPosition} position
     * @returns {string}
     */
    static positionKey(position) {
        return `${position.pageNum}:${position.streamIndex}:${position.operatorIndex}`;
    }

    /**
     * Parse position key back to ContentPosition.
     *
     * @param {string} key
     * @returns {ContentPosition}
     */
    static parsePositionKey(key) {
        const [pageNum, streamIndex, operatorIndex] = key.split(':').map(Number);
        return { pageNum, streamIndex, operatorIndex };
    }

    // ========================================
    // Metrics Generation
    // ========================================

    /**
     * Compute and return metrics result.
     *
     * @returns {ColorChangeMetricsResult}
     */
    getMetrics() {
        const passed = this.#verifications.filter(v => v.passed).length;
        const failed = this.#verifications.filter(v => !v.passed).length;

        return {
            inputSpec: this.#inputSpec ?? { colorspace: '', values: [] },
            outputSpecs: Object.fromEntries(this.#outputSpecs),
            passed,
            failed,
            total: this.#verifications.length,
            verifications: this.#verifications,
        };
    }

    /**
     * Get passed verification count.
     *
     * @returns {number}
     */
    get passedCount() {
        return this.#verifications.filter(v => v.passed).length;
    }

    /**
     * Get failed verification count.
     *
     * @returns {number}
     */
    get failedCount() {
        return this.#verifications.filter(v => !v.passed).length;
    }

    /**
     * Get pass rate (0-1).
     *
     * @returns {number}
     */
    get passRate() {
        if (this.#verifications.length === 0) return 1;
        return this.passedCount / this.#verifications.length;
    }

    // ========================================
    // Serialization
    // ========================================

    /**
     * Create transferable data for structured clone (thread transfer).
     *
     * @returns {ColorChangeMetricsTransferable}
     */
    toTransferable() {
        return {
            inputSpec: this.#inputSpec,
            outputSpecs: Array.from(this.#outputSpecs.entries()),
            verifications: this.#verifications,
        };
    }

    /**
     * Revive from transferable data.
     *
     * @param {ColorChangeMetricsTransferable} data
     * @returns {ColorChangeMetrics}
     */
    static fromTransferable(data) {
        const instance = new ColorChangeMetrics();

        if (data.inputSpec) {
            instance.#inputSpec = data.inputSpec;
        }

        for (const [name, spec] of data.outputSpecs) {
            instance.#outputSpecs.set(name, spec);
        }

        instance.#verifications = data.verifications;

        return instance;
    }

    /**
     * Serialize to JSON-compatible object.
     *
     * @returns {object}
     */
    toJSON() {
        return {
            metricName: ColorChangeMetrics.metricName,
            inputSpec: this.#inputSpec,
            outputSpecs: Object.fromEntries(this.#outputSpecs),
            result: this.getMetrics(),
        };
    }

    /**
     * Extract result from JSON (for display, not recomputation).
     *
     * @param {object} json
     * @returns {ColorChangeMetricsResult}
     */
    static extractResult(json) {
        return json.result;
    }

    /**
     * Create an instance from JSON.
     *
     * @param {object} json
     * @returns {ColorChangeMetrics}
     */
    static fromJSON(json) {
        const instance = new ColorChangeMetrics();

        if (json.inputSpec) {
            instance.#inputSpec = json.inputSpec;
        }

        if (json.outputSpecs) {
            for (const [name, spec] of Object.entries(json.outputSpecs)) {
                instance.#outputSpecs.set(name, /** @type {ColorOutputSpec} */ (spec));
            }
        }

        if (json.result?.verifications) {
            instance.#verifications = json.result.verifications;
        }

        return instance;
    }

    /**
     * Create string representation.
     *
     * @returns {string}
     */
    toString() {
        const metrics = this.getMetrics();
        return `ColorChangeMetrics(passed: ${metrics.passed}, failed: ${metrics.failed}, total: ${metrics.total})`;
    }
}
