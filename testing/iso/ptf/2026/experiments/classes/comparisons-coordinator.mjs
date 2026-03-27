// @ts-check
/**
 * Comparisons Coordinator
 *
 * Orchestrator for self-describing metrics classes. Handles registration,
 * definition consolidation, configuration building, and workflow coordination.
 *
 * Design patterns:
 * - Registry Pattern: Central storage for metrics class registration
 * - Strategy Pattern: Each metrics class is a strategy for computation
 * - Composite Configuration: Consolidates defaults from all registered components
 * - Orchestrator: Knows workflow sequence (propagate -> compute -> serialize)
 *
 * @module comparisons-coordinator
 */

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * @typedef {{
 *   resource: 'Image' | 'Contents',
 *   formula?: string,
 *   transform?: {
 *     colorspace: string,
 *     intent: string,
 *     blackPointCompensation: boolean,
 *   },
 *   defaults?: {
 *     threshold?: number,
 *     metrics?: MetricsSchema,
 *     sampling?: SamplingSchema,
 *   },
 *   metricsTypes?: Record<string, { name: string, compute?: string }>,
 *   samplingTypes?: Record<string, { name: string }>,
 * }} MetricDefinitions
 */

/**
 * @typedef {string | { type: string, name?: string, threshold?: number } | Array<string | { type: string, name?: string }>} MetricsSchema
 */

/**
 * @typedef {string | { type: string, name?: string, count?: number, seed?: number, interval?: number, intervals?: [number, number] } | Array<string | object>} SamplingSchema
 */

/**
 * @typedef {{
 *   Class: Function,
 *   metricDefinitions: MetricDefinitions,
 * }} RegisteredMetric
 */

/**
 * Interface that metrics classes must implement.
 * @typedef {{
 *   metricName: string,
 *   metricDefinitions: MetricDefinitions,
 * }} MetricsClassStatic
 */

// ============================================================================
// ComparisonsCoordinator Class
// ============================================================================

export class ComparisonsCoordinator {
    /** @type {Map<string, RegisteredMetric>} */
    #registry = new Map();

    /** @type {Record<string, MetricDefinitions> | null} */
    #consolidatedDefinitions = null;

    /**
     * Create a new ComparisonsCoordinator.
     *
     * @param {{
     *   metrics?: Function[],
     * }} [options]
     */
    constructor(options = {}) {
        // Register metrics classes provided at construction
        if (options.metrics) {
            for (const MetricsClass of options.metrics) {
                this.register(MetricsClass);
            }
        }
    }

    // ========================================
    // Registration
    // ========================================

    /**
     * Register a metrics class by its static metricName.
     *
     * @param {Function & MetricsClassStatic} MetricsClass
     * @returns {this}
     * @throws {TypeError} If class lacks required static properties
     */
    register(MetricsClass) {
        const { metricName, metricDefinitions } = MetricsClass;

        if (!metricName || typeof metricName !== 'string') {
            throw new TypeError(
                `Metrics class must have static metricName property (got ${typeof metricName})`
            );
        }

        if (!metricDefinitions || typeof metricDefinitions !== 'object') {
            throw new TypeError(
                `Metrics class "${metricName}" must have static metricDefinitions property`
            );
        }

        // Validate required fields in metricDefinitions
        if (!metricDefinitions.resource) {
            throw new TypeError(
                `Metrics class "${metricName}" metricDefinitions must have 'resource' field`
            );
        }

        // Handle duplicate registration (warn but allow - OpenTelemetry pattern)
        if (this.#registry.has(metricName)) {
            console.warn(`[ComparisonsCoordinator] Overwriting existing metric: ${metricName}`);
        }

        this.#registry.set(metricName, {
            Class: MetricsClass,
            metricDefinitions: structuredClone(metricDefinitions),
        });

        // Invalidate consolidated cache
        this.#consolidatedDefinitions = null;

        return this;
    }

    /**
     * Bulk registration (Jest's expect.extend pattern).
     *
     * @param {...Function} MetricsClasses
     * @returns {this}
     */
    registerAll(...MetricsClasses) {
        for (const MetricsClass of MetricsClasses) {
            this.register(MetricsClass);
        }
        return this;
    }

    // ========================================
    // Definition Consolidation
    // ========================================

    /**
     * Get consolidated definitions from all registered metrics.
     * Uses lazy evaluation with caching.
     *
     * @returns {Record<string, MetricDefinitions>}
     */
    getConsolidatedDefinitions() {
        if (this.#consolidatedDefinitions) {
            return this.#consolidatedDefinitions;
        }

        /** @type {Record<string, MetricDefinitions>} */
        const consolidated = {};

        for (const [metricName, { metricDefinitions }] of this.#registry) {
            consolidated[metricName] = structuredClone(metricDefinitions);
        }

        this.#consolidatedDefinitions = Object.freeze(consolidated);
        return this.#consolidatedDefinitions;
    }

    /**
     * Get definitions for a specific metric.
     *
     * @param {string} metricName
     * @returns {MetricDefinitions | undefined}
     */
    getDefinitions(metricName) {
        const entry = this.#registry.get(metricName);
        return entry ? structuredClone(entry.metricDefinitions) : undefined;
    }

    // ========================================
    // Configuration Building
    // ========================================

    /**
     * Create effective configuration by merging:
     * 1. Class static defaults (from metricDefinitions.defaults)
     * 2. User-provided overrides
     *
     * @param {string} metricName
     * @param {object} [overrides]
     * @returns {object}
     * @throws {Error} If metric is not registered
     */
    createConfiguration(metricName, overrides = {}) {
        const definitions = this.getDefinitions(metricName);
        if (!definitions) {
            throw new Error(`Unknown metric: "${metricName}". Registered: [${this.metricNames.join(', ')}]`);
        }

        const classDefaults = definitions.defaults ?? {};

        return {
            // Core properties from definitions
            resource: definitions.resource,
            formula: definitions.formula,

            // Merge class defaults with user overrides
            threshold: overrides.threshold ?? classDefaults.threshold,
            metrics: overrides.metrics ?? classDefaults.metrics,
            sampling: overrides.sampling ?? classDefaults.sampling,

            // Transform settings (deep merge)
            transform: {
                ...definitions.transform,
                ...overrides.transform,
            },
        };
    }

    // ========================================
    // Instance Creation (Factory)
    // ========================================

    /**
     * Create a metrics instance with consolidated definitions propagated.
     *
     * @param {string} metricName
     * @param {object} [params] - Instance parameters
     * @returns {object}
     * @throws {Error} If metric is not registered
     */
    createMetrics(metricName, params = {}) {
        const entry = this.#registry.get(metricName);
        if (!entry) {
            throw new Error(`Unknown metric: "${metricName}". Registered: [${this.metricNames.join(', ')}]`);
        }

        const { Class, metricDefinitions } = entry;

        // Propagate definitions to instance
        return new Class({
            definitions: metricDefinitions,
            ...params,
        });
    }

    // ========================================
    // Discovery
    // ========================================

    /**
     * Find metrics class by name.
     *
     * @param {string} metricName
     * @returns {Function | undefined}
     */
    getMetricsClass(metricName) {
        return this.#registry.get(metricName)?.Class;
    }

    /**
     * Get list of registered metric names.
     *
     * @returns {string[]}
     */
    get metricNames() {
        return [...this.#registry.keys()];
    }

    /**
     * Check if a metric is registered.
     *
     * @param {string} metricName
     * @returns {boolean}
     */
    hasMetric(metricName) {
        return this.#registry.has(metricName);
    }

    /**
     * Get count of registered metrics.
     *
     * @returns {number}
     */
    get size() {
        return this.#registry.size;
    }

    /**
     * Iterate over registered metrics.
     *
     * @yields {{ metricName: string, Class: Function, metricDefinitions: MetricDefinitions }}
     */
    *[Symbol.iterator]() {
        for (const [metricName, entry] of this.#registry) {
            yield { metricName, ...entry };
        }
    }

    // ========================================
    // Workflow Orchestration
    // ========================================

    /**
     * Validate that all required metrics for an aspect are registered.
     *
     * @param {Array<{ type: string }>} aspects
     * @returns {{ valid: boolean, missing: string[], invalid: Array<unknown> }}
     */
    validateAspects(aspects) {
        if (!Array.isArray(aspects)) {
            throw new TypeError('aspects must be an array');
        }

        const missing = [];
        const invalid = [];

        for (const aspect of aspects) {
            // Validate aspect structure
            if (!aspect || typeof aspect !== 'object') {
                invalid.push(aspect);
                continue;
            }
            if (!aspect.type || typeof aspect.type !== 'string') {
                invalid.push(aspect);
                continue;
            }

            // Check if metric is registered
            if (!this.hasMetric(aspect.type)) {
                missing.push(aspect.type);
            }
        }

        return {
            valid: missing.length === 0 && invalid.length === 0,
            missing,
            invalid,
        };
    }

    /**
     * Get supported resource types across all registered metrics.
     *
     * @returns {Set<string>}
     */
    getSupportedResources() {
        const resources = new Set();
        for (const { metricDefinitions } of this.#registry.values()) {
            resources.add(metricDefinitions.resource);
        }
        return resources;
    }

    // ========================================
    // Serialization
    // ========================================

    /**
     * Export all definitions for serialization.
     *
     * @returns {Record<string, MetricDefinitions>}
     */
    toJSON() {
        return this.getConsolidatedDefinitions();
    }

    /**
     * Create string representation.
     *
     * @returns {string}
     */
    toString() {
        return `ComparisonsCoordinator(${this.metricNames.join(', ')})`;
    }
}
