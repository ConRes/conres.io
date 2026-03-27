// @ts-check
/**
 * Delta-E Metrics Class
 *
 * Self-describing metrics class for CIE 1976 Delta-E color difference computation.
 * Implements the self-describing component pattern with static metadata.
 *
 * The coordinator discovers this class by `static metricName` and reads
 * `static metricDefinitions` to understand requirements and defaults.
 *
 * CIE 1976 Delta-E Formula:
 *   ΔE*ab = √[(L₂-L₁)² + (a₂-a₁)² + (b₂-b₁)²]
 *
 * @module delta-e-metrics
 */

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * @typedef {{
 *   L: number,
 *   a: number,
 *   b: number,
 * }} LabColor
 */

/**
 * @typedef {{
 *   name: string,
 *   dimensions: { width: number, height: number },
 *   colorSpace: string,
 * }} ImageReference
 */

/**
 * @typedef {{
 *   type: string,
 *   name: string,
 * }} NormalizedMetricDefinition
 */

/**
 * @typedef {{
 *   formula: 'CIE76',
 *   threshold: number,
 *   metrics: Array<{ type: string, name: string, value: number }>,
 *   sampleCount: number,
 *   samplingMethod: string,
 * }} DeltaEMetricsResult
 */

/**
 * @typedef {{
 *   reference: ImageReference | null,
 *   sample: ImageReference | null,
 *   deltaEValues: number[],
 *   metricsConfig: NormalizedMetricDefinition[],
 *   threshold: number,
 *   samplingMethod: string,
 * }} DeltaEMetricsTransferable
 */

// ============================================================================
// DeltaEMetrics Class
// ============================================================================

export class DeltaEMetrics {
    // ========================================
    // Static Metadata (Self-Describing)
    // ========================================

    /** Discovery key - matches config aspect.type */
    static metricName = 'Delta-E';

    /**
     * Class-owned metadata and defaults.
     * Contains ALL Delta-E specific configuration in one place.
     */
    static metricDefinitions = {
        // What resource type this metric operates on
        resource: /** @type {'Image'} */ ('Image'),

        // Formula identifier
        formula: 'CIE76',

        // Required transformation parameters for Lab conversion
        transform: {
            colorspace: 'Lab',
            intent: 'relative-colorimetric',
            blackPointCompensation: true,
        },

        // Default values for instance parameters
        defaults: {
            threshold: 3.0,
            metrics: ['Average', 'Maximum'],
            sampling: { type: 'random', count: 10000, seed: 42 },
        },

        // Available metrics types this class can compute
        // Keys are the canonical names; aliases map common variations
        metricsTypes: {
            average: { name: 'Average', compute: 'mean' },
            maximum: { name: 'Maximum', compute: 'max' },
            minimum: { name: 'Minimum', compute: 'min' },
            passrate: { name: 'Pass Rate', compute: 'passRate' },
            unique: { name: 'Unique', compute: 'unique' },
            uniquereference: { name: 'Unique (Reference)', compute: 'uniqueReference' },
            uniquesample: { name: 'Unique (Sample)', compute: 'uniqueSample' },
            // Aliases for convenience
            max: { name: 'Maximum', canonical: 'maximum' },
            min: { name: 'Minimum', canonical: 'minimum' },
            avg: { name: 'Average', canonical: 'average' },
            mean: { name: 'Average', canonical: 'average' },
        },

        // Available sampling strategies (for future extensibility)
        samplingTypes: {
            random: { name: 'Random' },
            uniform: { name: 'Uniform' },
            overall: { name: 'Overall' },
        },
    };

    // ========================================
    // Instance State
    // ========================================

    /** @type {ImageReference | null} */
    #referenceImage = null;

    /** @type {ImageReference | null} */
    #sampleImage = null;

    /** @type {number[]} */
    #deltaEValues = [];

    /** @type {Set<string>} Unique Lab colors from reference image (L,a,b as string key) */
    #uniqueReferenceColors = new Set();

    /** @type {Set<string>} Unique Lab colors from sample image (L,a,b as string key) */
    #uniqueSampleColors = new Set();

    /** @type {NormalizedMetricDefinition[]} */
    #metricsConfig;

    /** @type {number} */
    #threshold;

    /** @type {string} */
    #samplingMethod = 'unknown';

    /**
     * Create a new DeltaEMetrics instance.
     *
     * @param {{
     *   definitions?: typeof DeltaEMetrics.metricDefinitions,
     *   metrics?: import('./comparisons-coordinator.mjs').MetricsSchema,
     *   threshold?: number,
     *   samplingMethod?: string,
     * }} [options]
     */
    constructor(options = {}) {
        // Use passed definitions (from coordinator) or fall back to class static
        const defs = options.definitions ?? DeltaEMetrics.metricDefinitions;

        // Threshold from options, else from definitions defaults
        this.#threshold = options.threshold ?? defs.defaults?.threshold ?? 3.0;

        // Sampling method if provided
        if (options.samplingMethod) {
            this.#samplingMethod = options.samplingMethod;
        }

        // Normalize metrics schema using class-owned type definitions
        this.#metricsConfig = DeltaEMetrics.#normalizeMetrics(
            options.metrics ?? defs.defaults?.metrics ?? ['Average', 'Maximum'],
            defs.metricsTypes ?? DeltaEMetrics.metricDefinitions.metricsTypes
        );
    }

    // ========================================
    // Static Schema Normalization
    // ========================================

    /**
     * Normalize metrics schema to array of NormalizedMetricDefinition.
     * Supports flexible input: string, object, array, or mixed.
     *
     * @param {import('./comparisons-coordinator.mjs').MetricsSchema} schema
     * @param {Record<string, { name: string }>} metricsTypes
     * @returns {NormalizedMetricDefinition[]}
     */
    static #normalizeMetrics(schema, metricsTypes) {
        // Handle single value or array
        const items = Array.isArray(schema) ? schema : [schema];

        return items.map(item => {
            let rawType;
            let customName;

            if (typeof item === 'string') {
                rawType = item.toLowerCase();
            } else {
                rawType = item.type?.toLowerCase() ?? item.type;
                customName = item.name;
            }

            // Resolve aliases to canonical type
            const typeInfo = metricsTypes[rawType];
            const canonicalType = typeInfo?.canonical ?? rawType;

            return {
                type: canonicalType,
                name: customName ?? metricsTypes[canonicalType]?.name ?? typeInfo?.name ?? rawType,
            };
        });
    }

    // ========================================
    // Reference Management
    // ========================================

    /**
     * Set the reference image info.
     *
     * @param {ImageReference} reference
     * @returns {this}
     */
    setReference(reference) {
        this.#referenceImage = reference;
        return this;
    }

    /**
     * Set the sample image info.
     *
     * @param {ImageReference} sample
     * @returns {this}
     */
    setSample(sample) {
        this.#sampleImage = sample;
        return this;
    }

    /**
     * Set the sampling method used.
     *
     * @param {string} method
     * @returns {this}
     */
    setSamplingMethod(method) {
        this.#samplingMethod = method;
        return this;
    }

    /**
     * Get the current threshold.
     *
     * @returns {number}
     */
    get threshold() {
        return this.#threshold;
    }

    /**
     * Get the current sample count.
     *
     * @returns {number}
     */
    get sampleCount() {
        return this.#deltaEValues.length;
    }

    // ========================================
    // Pair Processing
    // ========================================

    /**
     * Add Lab color pairs and compute Delta-E for each.
     *
     * @param {Array<[LabColor, LabColor]>} pairs
     * @returns {this}
     */
    addPairs(pairs) {
        for (const [lab1, lab2] of pairs) {
            const dE = DeltaEMetrics.computeDeltaE(lab1, lab2);
            this.#deltaEValues.push(dE);
        }
        return this;
    }

    /**
     * Add pre-computed Delta-E values directly.
     *
     * @param {number[]} values
     * @returns {this}
     */
    addValues(values) {
        this.#deltaEValues.push(...values);
        return this;
    }

    /**
     * Compute Delta-E from interleaved Lab pixel arrays at given indices.
     * This is the most efficient method for large images.
     * Also tracks unique colors from reference and sample images separately.
     *
     * @param {Float32Array} labPixels1 - Reference Lab pixels (L,a,b interleaved)
     * @param {Float32Array} labPixels2 - Sample Lab pixels (L,a,b interleaved)
     * @param {number[]} indices - Pixel indices to compare
     * @returns {this}
     * @throws {Error} If array lengths don't match
     * @throws {RangeError} If index is out of bounds
     */
    addFromPixelArrays(labPixels1, labPixels2, indices) {
        // Validate array lengths match
        if (labPixels1.length !== labPixels2.length) {
            throw new Error(
                `Lab pixel arrays must have same length (got ${labPixels1.length} vs ${labPixels2.length})`
            );
        }

        const maxPixels = Math.floor(labPixels1.length / 3);

        for (const i of indices) {
            // Validate index is within bounds
            if (i < 0 || i >= maxPixels) {
                throw new RangeError(`Index ${i} out of bounds (valid: 0 to ${maxPixels - 1})`);
            }

            const offset = i * 3;
            const L1 = labPixels1[offset];
            const a1 = labPixels1[offset + 1];
            const b1 = labPixels1[offset + 2];
            const L2 = labPixels2[offset];
            const a2 = labPixels2[offset + 1];
            const b2 = labPixels2[offset + 2];

            // Compute Delta-E
            const dL = L2 - L1;
            const da = a2 - a1;
            const db = b2 - b1;
            this.#deltaEValues.push(Math.sqrt(dL * dL + da * da + db * db));

            // Track unique colors (round to 1 decimal place for grouping to avoid float noise)
            const refKey = `${Math.round(L1 * 10)},${Math.round(a1 * 10)},${Math.round(b1 * 10)}`;
            const sampleKey = `${Math.round(L2 * 10)},${Math.round(a2 * 10)},${Math.round(b2 * 10)}`;
            this.#uniqueReferenceColors.add(refKey);
            this.#uniqueSampleColors.add(sampleKey);
        }
        return this;
    }

    /**
     * Clear all accumulated Delta-E values and unique color sets.
     *
     * @returns {this}
     */
    reset() {
        this.#deltaEValues = [];
        this.#uniqueReferenceColors.clear();
        this.#uniqueSampleColors.clear();
        return this;
    }

    // ========================================
    // Computation (Static)
    // ========================================

    /**
     * Compute CIE 1976 Delta-E between two Lab colors.
     *
     * @param {LabColor} lab1
     * @param {LabColor} lab2
     * @returns {number}
     */
    static computeDeltaE(lab1, lab2) {
        const dL = lab2.L - lab1.L;
        const da = lab2.a - lab1.a;
        const db = lab2.b - lab1.b;
        return Math.sqrt(dL * dL + da * da + db * db);
    }

    /**
     * Compute Delta-E from raw Lab component arrays.
     *
     * @param {number} L1
     * @param {number} a1
     * @param {number} b1
     * @param {number} L2
     * @param {number} a2
     * @param {number} b2
     * @returns {number}
     */
    static computeDeltaERaw(L1, a1, b1, L2, a2, b2) {
        const dL = L2 - L1;
        const da = a2 - a1;
        const db = b2 - b1;
        return Math.sqrt(dL * dL + da * da + db * db);
    }

    // ========================================
    // Metrics Generation
    // ========================================

    /**
     * Compute and return metrics result.
     *
     * @returns {DeltaEMetricsResult}
     */
    getMetrics() {
        const values = this.#deltaEValues;
        const count = values.length;

        // Handle empty case
        if (count === 0) {
            return {
                formula: 'CIE76',
                threshold: this.#threshold,
                metrics: this.#metricsConfig.map(m => ({
                    type: m.type,
                    name: m.name,
                    value: m.type === 'unique' ? { reference: 0, sample: 0 } : 0,
                })),
                sampleCount: 0,
                samplingMethod: this.#samplingMethod,
            };
        }

        // Compute aggregate values in single pass
        let sum = 0;
        let max = -Infinity;
        let min = Infinity;
        let passCount = 0;

        for (const dE of values) {
            sum += dE;
            if (dE > max) max = dE;
            if (dE < min) min = dE;
            if (dE <= this.#threshold) passCount++;
        }

        // Unique counts are from tracked Lab colors (not delta-E values)
        const uniqueReference = this.#uniqueReferenceColors.size;
        const uniqueSample = this.#uniqueSampleColors.size;

        const computed = {
            average: sum / count,
            maximum: max,
            minimum: min,
            passrate: passCount / count,
            // "unique" expands to show both reference and sample counts
            unique: { reference: uniqueReference, sample: uniqueSample },
            uniquereference: uniqueReference,
            uniquesample: uniqueSample,
        };

        return {
            formula: 'CIE76',
            threshold: this.#threshold,
            metrics: this.#metricsConfig.map(m => ({
                type: m.type,
                name: m.name,
                value: computed[m.type] ?? 0,
            })),
            sampleCount: count,
            samplingMethod: this.#samplingMethod,
        };
    }

    /**
     * Get raw Delta-E values array.
     *
     * @returns {number[]}
     */
    getValues() {
        return [...this.#deltaEValues];
    }

    // ========================================
    // Serialization
    // ========================================

    /**
     * Create transferable data for structured clone (thread transfer).
     *
     * @returns {DeltaEMetricsTransferable}
     */
    toTransferable() {
        return {
            reference: this.#referenceImage,
            sample: this.#sampleImage,
            deltaEValues: this.#deltaEValues,
            metricsConfig: this.#metricsConfig,
            threshold: this.#threshold,
            samplingMethod: this.#samplingMethod,
        };
    }

    /**
     * Revive from transferable data.
     *
     * @param {DeltaEMetricsTransferable} data
     * @param {typeof DeltaEMetrics.metricDefinitions} [definitions]
     * @returns {DeltaEMetrics}
     */
    static fromTransferable(data, definitions) {
        const instance = new DeltaEMetrics({
            definitions,
            threshold: data.threshold,
            samplingMethod: data.samplingMethod,
        });

        instance.#referenceImage = data.reference;
        instance.#sampleImage = data.sample;
        instance.#deltaEValues = data.deltaEValues;
        instance.#metricsConfig = data.metricsConfig;

        return instance;
    }

    /**
     * Serialize to JSON-compatible object.
     *
     * @returns {object}
     */
    toJSON() {
        return {
            metricName: DeltaEMetrics.metricName,
            reference: this.#referenceImage,
            sample: this.#sampleImage,
            result: this.getMetrics(),
        };
    }

    /**
     * Extract result from JSON (for display, not recomputation).
     * Use when you only need the metrics result, not the full instance.
     *
     * @param {object} json
     * @returns {DeltaEMetricsResult}
     */
    static extractResult(json) {
        return json.result;
    }

    /**
     * Create an instance from JSON.
     * Note: Cannot restore raw Delta-E values from aggregated result.
     * Use fromTransferable() if you need to preserve raw values.
     *
     * @param {object} json
     * @returns {DeltaEMetrics}
     */
    static fromJSON(json) {
        const instance = new DeltaEMetrics({
            threshold: json.result?.threshold,
        });

        if (json.reference) {
            instance.#referenceImage = json.reference;
        }
        if (json.sample) {
            instance.#sampleImage = json.sample;
        }
        if (json.result?.samplingMethod) {
            instance.#samplingMethod = json.result.samplingMethod;
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
        const parts = metrics.metrics.map(m => `${m.name}: ${m.value.toFixed(2)}`);
        return `DeltaEMetrics(${parts.join(', ')}, n=${metrics.sampleCount})`;
    }
}
