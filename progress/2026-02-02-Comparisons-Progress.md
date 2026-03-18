# 2026-02-02 Comparisons Implementation Progress

## Current Status: PHASES 5C/5D/5E COMPLETE — READY FOR PHASE 6

**Last Updated**: 2026-02-03

**Completed**:
- Phase 5C: "Unique" metric tracks unique Lab colors (reference/sample separately)
- Phase 5D: Improved SUMMARY.{json,md} with unified overview and Delta-E statistics
- Phase 5E: Nested JSON structure reduces CHANGES.json file size by ~11%
- Fix: ICCBased color spaces now report as `ICCBasedGray`/`ICCBasedRGB`/`ICCBasedCMYK` instead of `ICCBased(1)`/`ICCBased(3)`/`ICCBased(4)`
- All verified with test run 004F (81 comparisons, 39 match, 42 delta, 0 skip, 4060 verifications, 0 failures)

**Critical Limitation**: The >2GB PDF loading error (`File size (2429679102) is greater than 2 GiB`) is a **pdf-lib limitation** that cannot be addressed without switching to a streaming PDF library (e.g., pdf.js with streaming). Phase 5E optimizations address OUTPUT file sizes, not INPUT loading.

---

## EXPLICIT USER INSTRUCTIONS (DO NOT IGNORE)

### CLI Purpose

The CLI (`experiments/compare-pdf-outputs.js`) is for **careful and incremental testing** of the classes implemented in Phases 1-4. It must be **fully functional and tested** BEFORE claiming those phases are complete.

### Test Data Setup

| Item | Path | Notes |
|------|------|-------|
| **Output Directory** | `output/2026-02-02-001/` | **LOCKED** — read-only, do not modify |
| **Original Config** | Identified in `output/2026-02-02-001/SUMMARY.json` | Old conventions (being replaced) |
| **Test Config** | `configurations/2026-02-02-REFACTOR-FIXTURES-K-ONLY-GCR.json` | **USE THIS** — only differs in "comparisons" section |

### Validation Requirement

After implementing the CLI execution logic, **reiterate through Phases 1-4 using 3 separate subagents in sequence (NOT parallel)**:

1. **Subagent 1**: Review progress document + test CLI → provide feedback on mistakes, gaps, cheating
2. **Revise**: Address Subagent 1 feedback
3. **Subagent 2**: Review progress document + test CLI → provide feedback on mistakes, gaps, cheating
4. **Revise**: Address Subagent 2 feedback
5. **Subagent 3**: Review progress document + test CLI → provide feedback on mistakes, gaps, cheating
6. **Revise**: Address Subagent 3 feedback

Each subagent must have access to `2026-02-02-COMPARISONS-PROGRESS.md` and be instructed to identify:
- Mistakes in implementation
- Gaps in functionality
- Any "cheating" (claiming things work when they don't)
- Missing error handling
- Untested code paths

### Coding Rules (Error Handling)

**These rules are NON-NEGOTIABLE:**

| Rule | Rationale |
|------|-----------|
| **No silent failures** | Errors must be visible, not swallowed |
| **Never `catch` unless intentional** | Catching hides bugs; only catch when you have a specific recovery strategy |
| **Use `try/finally` for cleanup** | Ensures resources are released without swallowing errors |
| **Allow errors to propagate and break** | We WANT errors to surface so we can find and fix them |

**Example patterns:**

```javascript
// WRONG - silent failure
try {
    await riskyOperation();
} catch (e) {
    console.log('Something went wrong');  // Swallowed!
}

// WRONG - catching without intent
try {
    await riskyOperation();
} catch (e) {
    // Now what? Error is lost.
}

// CORRECT - let it propagate
await riskyOperation();  // If it fails, caller sees the error

// CORRECT - cleanup without swallowing
const resource = acquireResource();
try {
    await useResource(resource);
} finally {
    resource.dispose();  // Cleanup happens, but errors still propagate
}

// CORRECT - intentional catch with re-throw
try {
    await riskyOperation();
} catch (e) {
    logger.error('Context for debugging:', e);
    throw e;  // Re-throw so it still propagates
}
```

### What "Fully Functional CLI" Means

1. Load configuration from `configurations/2026-02-02-REFACTOR-FIXTURES-K-ONLY-GCR.json`
2. Parse comparison tasks from the config
3. For each comparison task:
   - Load **all converted PDFs** from `output/2026-02-02-001/`
   - When original input PDF is needed, use path from config `inputs` section
   - Extract images from PDFs
   - Sample pixels using `ImageSampler`
   - Convert to Lab using `ImageLabConverter`
   - Compute Delta-E using `DeltaEMetrics`
   - Output results
4. Generate JSON and/or Markdown output

### PDF Loading Clarification

| PDF Type | Source |
|----------|--------|
| **Converted PDFs** (pair members) | `output/2026-02-02-001/` |
| **Original Input PDF** (if needed) | Path from config `inputs[name].pdf` |

---

## Objective

Implement Delta-E image comparisons for the verification matrix. The previous implementation was badly structured and has been removed. The new implementation must follow a self-describing component pattern with an orchestrating coordinator.

---

## Schema Correction: Delta-E Variants

| Schema Value     | Formula                                  | Status                          |
| ---------------- | ---------------------------------------- | ------------------------------- |
| `"Delta-E"`      | CIE 1976 (Euclidean distance in Lab)     | **Supported**                   |
| `"Delta-E 2000"` | CIE DE2000 (weighted perceptual formula) | TBD (not allowed in schema yet) |

**Note**: Only `"Delta-E"` (1976) is currently allowed in configuration schemas. `"Delta-E 2000"` may be added later.

### CIE 1976 Delta-E Formula

```
ΔE*ab = √[(L₂-L₁)² + (a₂-a₁)² + (b₂-b₁)²]
```

Simple Euclidean distance in CIELAB color space.

---

## Architectural Analysis

### Design Approach: Self-Describing Components with Coordinator Pattern

Following patterns from ESLint (static meta), OpenTelemetry (instrument registration), and the codebase's `ColorConversionPolicy`:

1. **Self-describing metrics classes** — Each class has `static metricName` and `static metricDefinitions` containing its own defaults
2. **ComparisonsCoordinator** — Discovers, registers, consolidates, and propagates definitions
3. **Registry pattern** — Classes register with coordinator; coordinator validates and consolidates
4. **Layered configuration** — Class defaults → Coordinator consolidated → Instance overrides
5. **Serialization contracts** — `toTransferable()` for threads, `toJSON()` for persistence

### Core Principle: Definitions Belong with Their Classes

**Problem with scattered definitions:**
```javascript
// BAD: Defaults scattered in central file
DEFAULT_DEFINITIONS = {
    metrics: { defaults: { formula: 'CIE76', threshold: 3.0 } },  // Delta-E specific!
    conversion: { defaults: { intent: 'relative-colorimetric' } } // Delta-E specific!
}
```

**Solution: Self-contained class definitions:**
```javascript
// GOOD: Class owns its own metadata and defaults
class DeltaEMetrics {
    static metricName = "Delta-E";
    static metricDefinitions = {
        resource: "Image",
        formula: "CIE76",
        transform: {
            colorspace: "Lab",
            intent: "relative-colorimetric",
            blackPointCompensation: true,
        },
        defaults: {
            threshold: 3.0,
            metrics: ["Average", "Maximum"],
        },
    };
}
```

### Architecture Overview

**Finalized Understanding**: ComparisonsCoordinator is an **orchestrator**, not just a registry. It knows the workflow sequence and owns generic concepts.

```
ComparisonsCoordinator (Orchestrator)
├── #registry: Map<metricName, { Class, metricDefinitions }>
├── #consolidatedDefinitions: Object (cached, lazy)
│
├── Construction Phase:
│   ├── new ComparisonsCoordinator({ metrics: [DeltaEMetrics, ...] })
│   ├── Registers, aggregates, validates (throws on violations)
│   └── Post-construction: ready-to-use orchestrator
│
├── Owns Generic Concepts:
│   ├── Sampling types (random, uniform, overall)
│   ├── Metrics schema structure (string, structure, array, mixed)
│   └── Configuration override hierarchy
│
├── Owns Workflow Sequence:
│   ├── propagate — definitions flow from classes to coordinator to instances
│   ├── compute — orchestrate metric computation
│   ├── serialize — toTransferable() for threads, toJSON() for persistence
│   └── deserialize — fromTransferable(), fromJSON()
│
└── For each registered metric class:
    └── MetricsClass (Self-Describing Component)
        ├── static metricName          // Discovery key
        ├── static metricDefinitions   // ALL class-specific defaults
        │   ├── resource, formula, transform
        │   ├── defaults (threshold, metrics, sampling)
        │   ├── metricsTypes, samplingTypes
        │   └── (future: additional generics)
        ├── constructor({ definitions, ...params })
        ├── instance methods...
        ├── toTransferable() / fromTransferable()
        └── toJSON() / fromJSON()
```

### Future Extensibility

Classes will be able to reference/register additional generics beyond the current metricsTypes and samplingTypes. This is designed into the architecture as a planned future enhancement.

### Registration and Discovery Pattern

```javascript
// 1. Classes self-describe via static properties
class DeltaEMetrics {
    static metricName = "Delta-E";
    static metricDefinitions = { ... };
}

// 2. Coordinator registers classes
const coordinator = new ComparisonsCoordinator()
    .register(DeltaEMetrics)
    .register(HistogramMetrics);  // Future extension

// 3. Coordinator consolidates definitions from all classes
const consolidated = coordinator.getConsolidatedDefinitions();
// Result: { "Delta-E": {...}, "Histogram": {...} }

// 4. Create effective configuration with user overrides
const config = coordinator.createConfiguration({
    "Delta-E": { threshold: 2.0 }  // Override default 3.0
});

// 5. Instantiate with propagated definitions
const metrics = coordinator.createMetrics("Delta-E", {
    definitions: consolidated,
    ...instanceParams
});
```

### Schema Flexibility

All schema fields support multiple forms for ergonomic configuration:

| Form                | Example                                         |
| ------------------- | ----------------------------------------------- |
| Single string       | `"Average"`                                     |
| Single structure    | `{ type: "average", name: "Mean" }`             |
| Array of strings    | `["Average", "Maximum", "Minimum"]`             |
| Array of structures | `[{ type: "average" }, { type: "maximum" }]`    |
| Mixed array         | `["Average", { type: "maximum", name: "Max" }]` |

### Configuration Override Hierarchy

Lowest to highest priority:

1. **Class static defaults** — `DeltaEMetrics.metricDefinitions.defaults`
2. **Coordinator consolidated** — Merged from all registered classes
3. **JSON configuration** — User-provided in config file
4. **Constructor parameters** — Instance-specific overrides

### DeltaEMetrics Design (as if extends AbstractMetrics)

| Static Property     | Purpose                           |
| ------------------- | --------------------------------- |
| `metricName`        | Discovery key: `"Delta-E"`        |
| `metricDefinitions` | Class-owned metadata and defaults |

| Instance Responsibility | Method/Property                                         |
| ----------------------- | ------------------------------------------------------- |
| Hold reference info     | `#referenceImage`, `#sampleImage`                       |
| Receive sample pairs    | `addPairs(labPairs)`                                    |
| Perform computation     | `compute()`                                             |
| Generate metrics        | `getMetrics()` → `{ average, max, min, passRate, ... }` |
| Serialize for threads   | `toTransferable()` → structured clone compatible        |
| Revive from transfer    | `static fromTransferable(data)`                         |
| JSON serialization      | `toJSON()` / `static fromJSON(json)`                    |

---

## Current Output Structure

### COMPARISONS.json (from output/2026-02-01-023)

```json
{
  "results": [
    {
      "input": "<input-name>",
      "output": "<output-profile-intent>",
      "expected": "<configuration-a>",
      "actual": "<configuration-b>",
      "data": {
        "images": [
          {
            "name": "Im0",
            "status": "MATCH",           // Binary match only
            "dimensions": "3812×2750",
            "colorSpace": "DeviceCMYK"   // Output colorspace
          }
        ]
      }
    }
  ]
}
```

### COMPARISONS.md (placeholder columns)

| Image | Status | Dimensions | Color Space | ΔE Avg | ΔE Max | Pass Rate |
| ----- | ------ | ---------- | ----------- | ------ | ------ | --------- |
| Im0   | MATCH  | 3812×2750  | DeviceCMYK  | -      | -      | -         |

**Problem**: Delta-E columns exist but are never populated (`-`).

---

## Key Findings

### 1. Previous Delta-E Implementation Removed

The Delta-E code was badly implemented and has been removed. Evidence:
- Output shows placeholder `-` for ΔE columns
- `compare-pdf-color.js` exists but only does binary comparison
- No Delta-E modules exist in `experiments/classes/`

### 2. Required Architecture Pattern

Self-describing components with coordinator pattern in `experiments/classes/`:
- **Self-contained classes** — Each class owns `static metricName` and `static metricDefinitions`
- **ComparisonsCoordinator** — Registers classes, consolidates definitions, propagates to instances
- **No scattered definitions** — Defaults reside with their respective classes
- **Flexible schemas** — Accept string, structure, array, or mixed forms
- **Serialization** — `toTransferable()` for threads, `toJSON()` for persistence
- **Following ESLint/OpenTelemetry patterns** — Static metadata for discovery and validation

### 3. Schema Structure Already Correct

The config schema in `2026-02-02-REFACTOR-FIXTURES-BASELINE.json` already has:
```json
{
  "comparisons": {
    "groups": [{
      "aspects": [{
        "type": "Delta-E",
        "resource": "Image",
        "metrics": ["Average", "Max"],
        "sampling": { "type": "random" },
        "transform": {
          "colorspace": "Lab",
          "intent": "relative-colorimetric",
          "black-point-compensation": true
        }
      }]
    }]
  }
}
```

---

## Proposed Class Structure

### Schema Definitions

#### Metrics Schema

```javascript
/**
 * @typedef {'Average' | 'Maximum' | 'Minimum' | 'PassRate'} MetricType
 */

/**
 * @typedef {{
 *   type: Lowercase<MetricType>,
 *   name?: string,
 *   threshold?: number,
 * }} MetricDefinition
 */

/**
 * @typedef {MetricType | MetricDefinition | (MetricType | MetricDefinition)[]} MetricsSchema
 */

// Examples:
// "Average"
// { type: "average", name: "Mean" }
// ["Average", "Maximum", "Minimum"]
// [{ type: "average", name: "Mean" }, { type: "maximum", name: "Max" }]
// ["Average", { type: "maximum", name: "Max" }]  // Mixed
```

#### Sampling Schema

```javascript
/**
 * @typedef {'Random' | 'Uniform' | 'Overall'} SamplingType
 */

/**
 * @typedef {{
 *   type: Lowercase<SamplingType>,
 *   name?: string,
 *   interval?: number,
 *   intervals?: [number, number],
 *   seed?: number,
 *   count?: number,
 * }} SamplingDefinition
 */

/**
 * @typedef {SamplingType | SamplingDefinition | (SamplingType | SamplingDefinition)[]} SamplingSchema
 */

// Examples:
// "Random"
// { type: "random", name: "Random (20%)", interval: 0.2 }
// ["Random", "Uniform", "Overall"]
// [{ type: "random", interval: 0.2 }, { type: "uniform", intervals: [8, 8] }]
// ["Random", { type: "uniform", name: "Grid (8×8)", intervals: [8, 8] }]  // Mixed
```

---

### experiments/classes/comparisons-coordinator.mjs

**Type**: ES6 class — Registry and coordination

**Purpose**: Register metrics classes, consolidate definitions, create configured instances

```javascript
// @ts-check
/**
 * Comparisons Coordinator
 *
 * Registry for self-describing metrics classes.
 * Consolidates definitions from registered classes and propagates to instances.
 *
 * Patterns used:
 * - Registry Pattern: Central storage for metrics class registration
 * - Strategy Pattern: Each metrics class is a strategy for computation
 * - Composite Configuration: Consolidates defaults from all components
 */

/**
 * @typedef {{
 *   Class: typeof AbstractMetrics,
 *   metricDefinitions: MetricDefinitions,
 * }} RegisteredMetric
 */

/**
 * @typedef {{
 *   resource: 'Image' | 'Contents',
 *   formula?: string,
 *   transform: {
 *     colorspace: string,
 *     intent: string,
 *     blackPointCompensation: boolean,
 *   },
 *   defaults: {
 *     threshold?: number,
 *     metrics?: MetricsSchema,
 *     sampling?: SamplingSchema,
 *   },
 *   metricsTypes?: Record<string, { name: string }>,
 *   samplingTypes?: Record<string, { name: string }>,
 * }} MetricDefinitions
 */

export class ComparisonsCoordinator {
    /** @type {Map<string, RegisteredMetric>} */
    #registry = new Map();

    /** @type {Object | null} */
    #consolidatedDefinitions = null;

    // ========================================
    // Registration
    // ========================================

    /**
     * Register a metrics class by its static metricName.
     * @param {typeof AbstractMetrics} MetricsClass
     * @returns {this}
     */
    register(MetricsClass) {
        const { metricName, metricDefinitions } = MetricsClass;

        if (!metricName) {
            throw new TypeError('Metrics class must have static metricName property');
        }
        if (!metricDefinitions) {
            throw new TypeError('Metrics class must have static metricDefinitions property');
        }

        // Handle duplicate registration (OpenTelemetry pattern: warn but allow)
        if (this.#registry.has(metricName)) {
            console.warn(`Overwriting existing metric: ${metricName}`);
        }

        this.#registry.set(metricName, {
            Class: MetricsClass,
            metricDefinitions: structuredClone(metricDefinitions),
        });

        // Invalidate cache
        this.#consolidatedDefinitions = null;

        return this;
    }

    /**
     * Bulk registration (Jest's expect.extend pattern).
     * @param {...typeof AbstractMetrics} MetricsClasses
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
     * Uses lazy evaluation and caching.
     * @returns {Record<string, MetricDefinitions>}
     */
    getConsolidatedDefinitions() {
        if (this.#consolidatedDefinitions) {
            return this.#consolidatedDefinitions;
        }

        const consolidated = {};

        for (const [metricName, { metricDefinitions }] of this.#registry) {
            consolidated[metricName] = structuredClone(metricDefinitions);
        }

        this.#consolidatedDefinitions = Object.freeze(consolidated);
        return this.#consolidatedDefinitions;
    }

    /**
     * Get definitions for a specific metric.
     * @param {string} metricName
     * @returns {MetricDefinitions | undefined}
     */
    getDefinitions(metricName) {
        return this.#registry.get(metricName)?.metricDefinitions;
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
     * @param {Object} overrides
     * @returns {Object}
     */
    createConfiguration(metricName, overrides = {}) {
        const definitions = this.getDefinitions(metricName);
        if (!definitions) {
            throw new Error(`Unknown metric: ${metricName}`);
        }

        const classDefaults = definitions.defaults ?? {};

        return {
            // Merge class defaults with user overrides
            threshold: overrides.threshold ?? classDefaults.threshold,
            metrics: overrides.metrics ?? classDefaults.metrics,
            sampling: overrides.sampling ?? classDefaults.sampling,
            transform: {
                ...definitions.transform,
                ...overrides.transform,
            },
        };
    }

    // ========================================
    // Instance Creation
    // ========================================

    /**
     * Create a metrics instance with consolidated definitions.
     * @param {string} metricName
     * @param {Object} params - Instance parameters
     * @returns {AbstractMetrics}
     */
    createMetrics(metricName, params = {}) {
        const entry = this.#registry.get(metricName);
        if (!entry) {
            throw new Error(`Unknown metric: ${metricName}`);
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
     * @param {string} metricName
     * @returns {typeof AbstractMetrics | undefined}
     */
    getMetricsClass(metricName) {
        return this.#registry.get(metricName)?.Class;
    }

    /**
     * Get list of registered metric names.
     * @returns {string[]}
     */
    get metricNames() {
        return [...this.#registry.keys()];
    }

    /**
     * Iterate over registered metrics.
     */
    *[Symbol.iterator]() {
        for (const [metricName, entry] of this.#registry) {
            yield { metricName, ...entry };
        }
    }

    // ========================================
    // Serialization
    // ========================================

    /**
     * Export all definitions for serialization.
     * @returns {Object}
     */
    toJSON() {
        return this.getConsolidatedDefinitions();
    }

    /**
     * Create coordinator from serialized definitions.
     * Note: Classes must be re-registered manually.
     * @param {Object} json
     * @returns {ComparisonsCoordinator}
     */
    static fromJSON(json) {
        const coordinator = new ComparisonsCoordinator();
        // Definitions loaded but classes need re-registration
        coordinator.#consolidatedDefinitions = json;
        return coordinator;
    }
}
```

---

### experiments/classes/delta-e-metrics.mjs

**Type**: ES6 instance class (as if extends AbstractMetrics)

**Purpose**: Hold reference/sample info, receive pairs, compute, generate metrics, serialize

**Key Design**: Static `metricDefinitions` contains ALL class-specific defaults — no scattered definitions

```javascript
// @ts-check
/**
 * Delta-E Metrics Class
 *
 * Self-describing metrics class with static metadata.
 * Designed as if it extends AbstractMetrics.
 *
 * The coordinator discovers this class by `static metricName` and
 * reads `static metricDefinitions` to understand requirements and defaults.
 */

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
 *   formula: 'CIE76',
 *   threshold: number,
 *   metrics: Array<{ type: string, name: string, value: number }>,
 *   sampleCount: number,
 *   samplingMethod: string,
 * }} DeltaEMetricsResult
 */

/**
 * @typedef {{
 *   reference: ImageReference,
 *   sample: ImageReference,
 *   deltaEValues: number[],
 *   metricsConfig: NormalizedMetricDefinition[],
 *   threshold: number,
 * }} DeltaEMetricsTransferable
 */

export class DeltaEMetrics {
    // ========================================
    // Static Metadata (Self-Describing)
    // ========================================

    /** Discovery key — matches config aspect.type */
    static metricName = "Delta-E";

    /**
     * Class-owned metadata and defaults.
     * Contains ALL Delta-E specific configuration in one place.
     */
    static metricDefinitions = {
        // What resource type this metric operates on
        resource: "Image",

        // Formula identifier
        formula: "CIE76",

        // Required transformation parameters
        transform: {
            colorspace: "Lab",
            intent: "relative-colorimetric",
            blackPointCompensation: true,
        },

        // Default values for instance parameters
        defaults: {
            threshold: 3.0,
            metrics: ["Average", "Maximum"],
            sampling: { type: "random", count: 10000, seed: 42 },
        },

        // Available metrics types this class can compute
        metricsTypes: {
            average: { name: "Average", compute: "mean" },
            maximum: { name: "Maximum", compute: "max" },
            minimum: { name: "Minimum", compute: "min" },
            passrate: { name: "Pass Rate", compute: "passRate" },
        },

        // Available sampling strategies
        samplingTypes: {
            random: { name: "Random" },
            uniform: { name: "Uniform" },
            overall: { name: "Overall" },
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

    /** @type {NormalizedMetricDefinition[]} */
    #metricsConfig;

    /** @type {number} */
    #threshold;

    /** @type {string} */
    #samplingMethod = 'unknown';

    /**
     * @param {{
     *   definitions?: MetricDefinitions,
     *   metrics?: MetricsSchema,
     *   threshold?: number,
     * }} options
     */
    constructor(options = {}) {
        // Use passed definitions (from coordinator) or fall back to class static
        const defs = options.definitions ?? DeltaEMetrics.metricDefinitions;

        // Threshold from options, else from definitions defaults
        this.#threshold = options.threshold ?? defs.defaults?.threshold ?? 3.0;

        // Normalize metrics schema using class-owned type definitions
        this.#metricsConfig = DeltaEMetrics.#normalizeMetrics(
            options.metrics ?? defs.defaults?.metrics ?? ['Average', 'Maximum'],
            defs.metricsTypes
        );
    }

    // ========================================
    // Static Schema Normalization
    // ========================================

    /**
     * Normalize metrics schema to array of NormalizedMetricDefinition.
     * Uses class-owned metricsTypes for name resolution.
     * @param {MetricsSchema} schema
     * @param {Record<string, { name: string }>} metricsTypes
     * @returns {NormalizedMetricDefinition[]}
     */
    static #normalizeMetrics(schema, metricsTypes) {
        const items = Array.isArray(schema) ? schema : [schema];
        return items.map(item => {
            if (typeof item === 'string') {
                const type = item.toLowerCase();
                return {
                    type,
                    name: metricsTypes[type]?.name ?? item,
                };
            }
            return {
                type: item.type,
                name: item.name ?? metricsTypes[item.type]?.name ?? item.type,
            };
        });
    }

    // ========================================
    // Reference Management
    // ========================================

    /**
     * Set the reference image info.
     * @param {ImageReference} reference
     */
    setReference(reference) {
        this.#referenceImage = reference;
    }

    /**
     * Set the sample image info.
     * @param {ImageReference} sample
     */
    setSample(sample) {
        this.#sampleImage = sample;
    }

    /**
     * Set the sampling method used.
     * @param {string} method
     */
    setSamplingMethod(method) {
        this.#samplingMethod = method;
    }

    // ========================================
    // Pair Processing
    // ========================================

    /**
     * Add Lab color pairs and compute Delta-E for each.
     * @param {Array<[LabColor, LabColor]>} pairs
     */
    addPairs(pairs) {
        for (const [lab1, lab2] of pairs) {
            const dE = DeltaEMetrics.computeDeltaE(lab1, lab2);
            this.#deltaEValues.push(dE);
        }
    }

    /**
     * Add pre-computed Delta-E values directly.
     * @param {number[]} values
     */
    addValues(values) {
        this.#deltaEValues.push(...values);
    }

    /**
     * Compute Delta-E from interleaved Lab pixel arrays at given indices.
     * @param {Float32Array} labPixels1
     * @param {Float32Array} labPixels2
     * @param {number[]} indices
     */
    addFromPixelArrays(labPixels1, labPixels2, indices) {
        for (const i of indices) {
            const offset = i * 3;
            const dL = labPixels2[offset] - labPixels1[offset];
            const da = labPixels2[offset + 1] - labPixels1[offset + 1];
            const db = labPixels2[offset + 2] - labPixels1[offset + 2];
            this.#deltaEValues.push(Math.sqrt(dL * dL + da * da + db * db));
        }
    }

    // ========================================
    // Computation (Static)
    // ========================================

    /**
     * Compute CIE 1976 Delta-E between two Lab colors.
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

    // ========================================
    // Metrics Generation
    // ========================================

    /**
     * Compute and return metrics result.
     * @returns {DeltaEMetricsResult}
     */
    getMetrics() {
        const values = this.#deltaEValues;
        const count = values.length;

        if (count === 0) {
            return {
                formula: 'CIE76',
                threshold: this.#threshold,
                metrics: this.#metricsConfig.map(m => ({ type: m.type, name: m.name, value: 0 })),
                sampleCount: 0,
                samplingMethod: this.#samplingMethod,
            };
        }

        // Compute aggregate values
        let sum = 0, max = -Infinity, min = Infinity, passCount = 0;
        for (const dE of values) {
            sum += dE;
            if (dE > max) max = dE;
            if (dE < min) min = dE;
            if (dE <= this.#threshold) passCount++;
        }

        const computed = {
            average: sum / count,
            maximum: max,
            minimum: min,
            passrate: passCount / count,
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

    // ========================================
    // Serialization
    // ========================================

    /**
     * Create transferable data for structured clone (thread transfer).
     * @returns {DeltaEMetricsTransferable}
     */
    toTransferable() {
        return {
            reference: this.#referenceImage,
            sample: this.#sampleImage,
            deltaEValues: this.#deltaEValues,
            metricsConfig: this.#metricsConfig,
            threshold: this.#threshold,
        };
    }

    /**
     * Revive from transferable data.
     * @param {DeltaEMetricsTransferable} data
     * @param {ComparisonDefinitions} [definitions]
     * @returns {DeltaEMetrics}
     */
    static fromTransferable(data, definitions) {
        const instance = new DeltaEMetrics({
            definitions,
            threshold: data.threshold,
        });
        instance.#referenceImage = data.reference;
        instance.#sampleImage = data.sample;
        instance.#deltaEValues = data.deltaEValues;
        instance.#metricsConfig = data.metricsConfig;
        return instance;
    }

    /**
     * Serialize to JSON-compatible object.
     * @returns {object}
     */
    toJSON() {
        return {
            reference: this.#referenceImage,
            sample: this.#sampleImage,
            result: this.getMetrics(),
        };
    }

    /**
     * Create instance from JSON (for result display, not recomputation).
     * @param {object} json
     * @returns {DeltaEMetricsResult}
     */
    static fromJSON(json) {
        return json.result;
    }
}
```

### experiments/classes/image-sampler.mjs

**Type**: ES6 instance class with sampling strategies

**Purpose**: Configurable pixel sampling for large images

```javascript
// @ts-check
/**
 * Image Sampler Class
 *
 * Configurable pixel sampling with multiple strategies.
 * Receives definitions for default parameters.
 */

import { DEFAULT_DEFINITIONS, normalizeSamplingSchema } from './comparison-definitions.mjs';

/**
 * @typedef {{
 *   indices: number[],
 *   method: string,
 *   totalPixels: number,
 *   sampledCount: number,
 * }} SamplingResult
 */

export class ImageSampler {
    /** @type {SamplingDefinition[]} */
    #samplingConfig;

    /** @type {ComparisonDefinitions} */
    #definitions;

    /**
     * @param {{
     *   definitions?: ComparisonDefinitions,
     *   sampling?: SamplingSchema,
     * }} options
     */
    constructor(options = {}) {
        this.#definitions = options.definitions ?? DEFAULT_DEFINITIONS;
        this.#samplingConfig = normalizeSamplingSchema(
            options.sampling ?? 'Random',
            this.#definitions
        );
    }

    // ========================================
    // Sampling Methods
    // ========================================

    /**
     * Sample pixel indices from an image using configured strategy.
     * Uses first sampling configuration by default.
     * @param {number} width
     * @param {number} height
     * @param {number} [configIndex=0]
     * @returns {SamplingResult}
     */
    sample(width, height, configIndex = 0) {
        const config = this.#samplingConfig[configIndex] ?? this.#samplingConfig[0];
        const totalPixels = width * height;

        let indices;
        switch (config.type) {
            case 'random':
                indices = this.#sampleRandom(totalPixels, config);
                break;
            case 'uniform':
                indices = this.#sampleUniform(width, height, config);
                break;
            case 'overall':
                indices = Array.from({ length: totalPixels }, (_, i) => i);
                break;
            default:
                indices = this.#sampleRandom(totalPixels, config);
        }

        return {
            indices,
            method: config.name,
            totalPixels,
            sampledCount: indices.length,
        };
    }

    /**
     * Get all configured sampling methods.
     * @returns {SamplingDefinition[]}
     */
    getSamplingConfigs() {
        return [...this.#samplingConfig];
    }

    // ========================================
    // Sampling Strategies (Private)
    // ========================================

    /**
     * Random sampling with seed.
     * @param {number} totalPixels
     * @param {SamplingDefinition} config
     * @returns {number[]}
     */
    #sampleRandom(totalPixels, config) {
        const count = config.count ?? this.#definitions.sampling.defaults.count;
        const seed = config.seed ?? this.#definitions.sampling.defaults.seed;

        if (totalPixels <= count) {
            return Array.from({ length: totalPixels }, (_, i) => i);
        }

        // Handle interval-based count (e.g., interval: 0.2 = 20% of pixels)
        const targetCount = config.interval
            ? Math.floor(totalPixels * config.interval)
            : count;

        const random = ImageSampler.#createSeededRandom(seed);
        const indices = new Set();
        while (indices.size < targetCount && indices.size < totalPixels) {
            indices.add(Math.floor(random() * totalPixels));
        }
        return Array.from(indices).sort((a, b) => a - b);
    }

    /**
     * Uniform grid sampling.
     * @param {number} width
     * @param {number} height
     * @param {SamplingDefinition} config
     * @returns {number[]}
     */
    #sampleUniform(width, height, config) {
        const totalPixels = width * height;

        // Use explicit intervals [rows, columns] if provided
        if (config.intervals) {
            const [rowStep, colStep] = config.intervals;
            const indices = [];
            for (let y = 0; y < height; y += rowStep) {
                for (let x = 0; x < width; x += colStep) {
                    indices.push(y * width + x);
                }
            }
            return indices;
        }

        // Otherwise compute step from target count
        const targetCount = config.count ?? this.#definitions.sampling.defaults.count;
        const step = Math.max(1, Math.floor(Math.sqrt(totalPixels / targetCount)));
        const indices = [];
        for (let y = 0; y < height; y += step) {
            for (let x = 0; x < width; x += step) {
                indices.push(y * width + x);
            }
        }
        return indices;
    }

    // ========================================
    // Utilities (Static)
    // ========================================

    /**
     * Seeded pseudo-random number generator (mulberry32).
     * @param {number} seed
     * @returns {() => number}
     */
    static #createSeededRandom(seed) {
        return function() {
            let t = seed += 0×6D2B79F5;
            t = Math.imul(t ^ t >>> 15, t | 1);
            t ^= t + Math.imul(t ^ t >>> 7, t | 61);
            return ((t ^ t >>> 14) >>> 0) / 4294967296;
        };
    }
}
```

### experiments/classes/image-match-metrics.mjs

**Type**: ES6 instance class (self-describing component)

**Purpose**: Pre-checks and binary matching for image comparison. Determines whether images require Delta-E computation or can be classified based on structural and binary comparisons alone.

**Key Design**: Separation of concerns — binary matching is separate from Delta-E computation

```javascript
// @ts-check
/**
 * Image Match Metrics Class
 *
 * Layered comparison approach:
 * 1. Pre-checks: Dimension match, BPC match, color space compatibility
 * 2. Layer 1: Compressed hash comparison
 * 3. Layer 2: Uncompressed hash comparison
 */

export class ImageMatchMetrics {
    // ========================================
    // Static Self-Description
    // ========================================

    static metricName = 'Image-Match';
    static description = 'Image pre-checks and binary matching';

    static metricDefinitions = {
        preChecks: {
            dimensions: { description: 'Width and height must match exactly' },
            bitsPerComponent: { description: 'Bits per component must match' },
            colorSpace: { description: 'Color space must be compatible' },
            channels: { description: 'Number of color channels must match' },
        },
        binaryLayers: {
            compressed: { description: 'Compressed stream bytes identical' },
            uncompressed: { description: 'Decompressed pixel data identical' },
        },
        statuses: {
            MATCH: { description: 'Binary identical (no Delta-E needed)' },
            DELTA: { description: 'Requires Delta-E computation' },
            MISMATCH: { description: 'Structural mismatch (incompatible)' },
            SKIP: { description: 'Cannot compare (missing data)' },
        },
    };

    // ========================================
    // Instance Methods
    // ========================================

    setReference(image) { /* ... */ }
    setSample(image) { /* ... */ }
    compare() { /* returns MatchResult */ }
    get status() { /* ... */ }
    get isBinaryMatch() { /* ... */ }
    get requiresDeltaE() { /* ... */ }
    get pixelCount() { /* ... */ }

    // ========================================
    // Static Factory
    // ========================================

    static compare(reference, sample, options = {}) {
        const metrics = new ImageMatchMetrics(options);
        metrics.setReference(reference);
        metrics.setSample(sample);
        return metrics.compare();
    }
}
```

**ImageDescriptor Type:**
```javascript
/**
 * @typedef {{
 *   name: string,
 *   width: number,
 *   height: number,
 *   colorSpace: string,
 *   bitsPerComponent: number,
 *   channels: number,
 *   compressedData?: Uint8Array,
 *   pixelData?: Uint8Array,
 * }} ImageDescriptor
 */
```

**MatchResult Type:**
```javascript
/**
 * @typedef {{
 *   status: 'MATCH' | 'DELTA' | 'MISMATCH' | 'SKIP',
 *   preChecks: PreCheckResult[],
 *   binaryChecks: BinaryCheckResult[],
 *   matchLayer: 'compressed' | 'uncompressed' | 'none',
 *   pixelCount: number,
 *   skipReason?: string,
 * }} MatchResult
 */
```

---

### experiments/classes/image-lab-converter.mjs

**Type**: ES6 instance class (stateful, conversion layer)

**Purpose**: Convert image pixels to Lab for Delta-E computation

**Dependencies**: Uses `ColorEngineProvider` from production classes

```javascript
// @ts-check
/**
 * Image Lab Converter Class
 *
 * Conversion layer that manages color engine and transform lifecycle.
 * Receives definitions for default conversion parameters.
 */

import { ColorEngineProvider } from '../../../classes/color-engine-provider.js';
import { DEFAULT_DEFINITIONS } from './comparison-definitions.mjs';

/**
 * @typedef {{
 *   width: number,
 *   height: number,
 *   labPixels: Float32Array,
 * }} LabImageData
 */

/**
 * @typedef {{
 *   intent?: 'perceptual' | 'relative-colorimetric' | 'saturation' | 'absolute-colorimetric',
 *   blackPointCompensation?: boolean,
 * }} ConversionOptions
 */

export class ImageLabConverter {
    /** @type {object | null} */
    #engine = null;

    /** @type {object | null} */
    #labProfile = null;

    /** @type {Map<string, object>} */
    #transformCache = new Map();

    /** @type {ComparisonDefinitions} */
    #definitions;

    /** @type {ConversionOptions} */
    #options;

    /**
     * @param {{
     *   definitions?: ComparisonDefinitions,
     *   intent?: string,
     *   blackPointCompensation?: boolean,
     * }} options
     */
    constructor(options = {}) {
        this.#definitions = options.definitions ?? DEFAULT_DEFINITIONS;
        this.#options = {
            intent: options.intent ?? this.#definitions.conversion.defaults.intent,
            blackPointCompensation: options.blackPointCompensation ??
                this.#definitions.conversion.defaults.blackPointCompensation,
        };
    }

    // ========================================
    // Lifecycle
    // ========================================

    /**
     * Initialize the converter (lazy initialization).
     * @returns {Promise<void>}
     */
    async initialize() {
        if (this.#engine) return;
        const provider = new ColorEngineProvider();
        this.#engine = await provider.getEngine();
        this.#labProfile = this.#engine.createLab4Profile(0);
    }

    /**
     * Check if initialized.
     * @returns {boolean}
     */
    get isInitialized() {
        return this.#engine !== null;
    }

    /**
     * Dispose of cached resources.
     */
    dispose() {
        for (const transform of this.#transformCache.values()) {
            // Note: transform cleanup if needed by engine
        }
        this.#transformCache.clear();
        this.#labProfile = null;
        this.#engine = null;
    }

    // ========================================
    // Conversion
    // ========================================

    /**
     * Convert image pixels to Lab.
     * @param {Uint8Array} pixelData
     * @param {number} width
     * @param {number} height
     * @param {ArrayBuffer} sourceProfile
     * @param {string} [cacheKey='default']
     * @returns {LabImageData}
     */
    convert(pixelData, width, height, sourceProfile, cacheKey = 'default') {
        if (!this.#engine) {
            throw new Error('ImageLabConverter not initialized. Call initialize() first.');
        }

        const transform = this.#getOrCreateTransform(sourceProfile, cacheKey);
        const pixelCount = width * height;
        const labPixels = new Float32Array(pixelCount * 3);

        this.#engine.transformArray(transform, pixelData, labPixels, pixelCount);

        return { width, height, labPixels };
    }

    /**
     * Convert pixels at specific indices only.
     * More efficient for sampled comparisons.
     * @param {Uint8Array} pixelData
     * @param {number} width
     * @param {number} height
     * @param {number} channels
     * @param {ArrayBuffer} sourceProfile
     * @param {number[]} indices
     * @param {string} [cacheKey='default']
     * @returns {Float32Array} Lab values at indices (L,a,b interleaved)
     */
    convertAtIndices(pixelData, width, height, channels, sourceProfile, indices, cacheKey = 'default') {
        if (!this.#engine) {
            throw new Error('ImageLabConverter not initialized. Call initialize() first.');
        }

        // Extract only the pixels we need
        const sampledPixels = new Uint8Array(indices.length * channels);
        for (let i = 0; i < indices.length; i++) {
            const srcOffset = indices[i] * channels;
            const dstOffset = i * channels;
            for (let c = 0; c < channels; c++) {
                sampledPixels[dstOffset + c] = pixelData[srcOffset + c];
            }
        }

        const transform = this.#getOrCreateTransform(sourceProfile, cacheKey);
        const labPixels = new Float32Array(indices.length * 3);

        this.#engine.transformArray(transform, sampledPixels, labPixels, indices.length);

        return labPixels;
    }

    // ========================================
    // Transform Management (Private)
    // ========================================

    /**
     * @param {ArrayBuffer} sourceProfile
     * @param {string} cacheKey
     * @returns {object}
     */
    #getOrCreateTransform(sourceProfile, cacheKey) {
        if (this.#transformCache.has(cacheKey)) {
            return this.#transformCache.get(cacheKey);
        }

        const srcProfile = this.#engine.openProfileFromMem(new Uint8Array(sourceProfile));
        const colorSpace = this.#engine.getProfileColorSpace(srcProfile);

        const intentMap = {
            'perceptual': 0,
            'relative-colorimetric': 1,
            'saturation': 2,
            'absolute-colorimetric': 3,
        };
        const intent = intentMap[this.#options.intent] ?? 1;
        const flags = this.#options.blackPointCompensation ? 0×2000 : 0;

        let inputFormat;
        if (colorSpace === 'CMYK') {
            inputFormat = this.#engine.TYPE_CMYK_8;
        } else if (colorSpace === 'RGB') {
            inputFormat = this.#engine.TYPE_RGB_8;
        } else if (colorSpace === 'GRAY') {
            inputFormat = this.#engine.TYPE_GRAY_8;
        } else {
            throw new Error(`Unsupported source colorspace: ${colorSpace}`);
        }

        const transform = this.#engine.createTransform(
            srcProfile,
            inputFormat,
            this.#labProfile,
            this.#engine.TYPE_Lab_FLT,
            intent,
            flags
        );

        this.#transformCache.set(cacheKey, transform);
        return transform;
    }

    // ========================================
    // Configuration Access
    // ========================================

    /**
     * Get current conversion options.
     * @returns {ConversionOptions}
     */
    getOptions() {
        return { ...this.#options };
    }
}
```

---

## Implementation Plan

### Phase 1: ComparisonsCoordinator Class

Create `experiments/classes/comparisons-coordinator.mjs`:
- [ ] `ComparisonsCoordinator` class (registry pattern)
- [ ] `register(MetricsClass)` — Register by static metricName
- [ ] `registerAll(...classes)` — Bulk registration
- [ ] `getConsolidatedDefinitions()` — Lazy cache of all class definitions
- [ ] `getDefinitions(metricName)` — Get specific class definitions
- [ ] `createConfiguration(metricName, overrides)` — Merge defaults with overrides
- [ ] `createMetrics(metricName, params)` — Factory method
- [ ] `toJSON()` / `fromJSON()` — Serialization
- [ ] Unit tests

### Phase 2: DeltaEMetrics Class

Create `experiments/classes/delta-e-metrics.mjs`:
- [ ] `static metricName = "Delta-E"` — Discovery key
- [ ] `static metricDefinitions` — Self-contained class defaults:
  - resource, formula, transform, defaults, metricsTypes, samplingTypes
- [ ] `static #normalizeMetrics()` — Class-owned normalization
- [ ] Constructor with `{ definitions, metrics, threshold }`
- [ ] `setReference()`, `setSample()`, `setSamplingMethod()`
- [ ] `addPairs()`, `addValues()`, `addFromPixelArrays()`
- [ ] Static `computeDeltaE()` — CIE 1976 formula
- [ ] `getMetrics()` — Generate `DeltaEMetricsResult`
- [ ] `toTransferable()` / `fromTransferable()` — Thread transfer
- [ ] `toJSON()` / `fromJSON()` — Serialization
- [ ] Unit tests

### Phase 3: ImageSampler Class

Create `experiments/classes/image-sampler.mjs`:
- [ ] `ImageSampler` instance class
- [ ] Constructor with `{ samplingTypes, sampling }` (receives from coordinator/metrics class)
- [ ] `sample()` — Main sampling method returning `SamplingResult`
- [ ] `getSamplingConfigs()` — Get all configured methods
- [ ] Private `#sampleRandom()` — With interval support
- [ ] Private `#sampleUniform()` — Grid with intervals
- [ ] Static `#createSeededRandom()` — Mulberry32 PRNG
- [ ] Static `#normalizeSampling()` — Schema normalization
- [ ] Unit tests

### Phase 4: ImageLabConverter Class

Create `experiments/classes/image-lab-converter.mjs`:
- [ ] `ImageLabConverter` instance class
- [ ] Constructor with `{ transform }` (receives from coordinator/metrics class)
- [ ] `initialize()` / `dispose()` — Lifecycle
- [ ] `convert()` — Full image conversion
- [ ] `convertAtIndices()` — Sampled pixel conversion (efficient)
- [ ] Private `#getOrCreateTransform()` — Transform caching
- [ ] `getOptions()` — Current configuration
- [ ] Support DeviceCMYK, DeviceRGB, DeviceGray → Lab
- [ ] Integration tests

### Phase 5: Integration

Update `generate-verification-matrix.mjs`:
- [ ] Create `ComparisonsCoordinator` and register `DeltaEMetrics`
- [ ] For each config aspect:
  - [ ] Look up metric class by `aspect.type`
  - [ ] Create configuration: `coordinator.createConfiguration(type, aspect)`
  - [ ] Create instances: `ImageSampler`, `ImageLabConverter`, `DeltaEMetrics`
- [ ] Extract Output Intent profile from converted PDFs
- [ ] Wire layers: sample → convert → compute
- [ ] Populate ΔE columns in COMPARISONS.md
- [ ] Add `deltaE` object to COMPARISONS.json using `metrics.toJSON()`

---

## Expected Output After Implementation

### COMPARISONS.md

| Image | Status | Dimensions | Color Space | ΔE Avg | ΔE Max | Pass Rate |
| ----- | ------ | ---------- | ----------- | ------ | ------ | --------- |
| Im0   | MATCH  | 3812×2750  | DeviceCMYK  | 0.00   | 0.00   | 100%      |
| Im1   | DELTA  | 3812×2750  | DeviceCMYK  | 0.42   | 1.23   | 99.8%     |


### COMPARISONS.json

```json
{
  "images": [
    {
      "name": "Im0",
      "status": "MATCH",
      "dimensions": "3812×2750",
      "colorSpace": "DeviceCMYK",
      "deltaE": {
        "formula": "CIE76",
        "average": 0.00,
        "max": 0.00,
        "min": 0.00,
        "passRate": 1.0,
        "threshold": 3.0,
        "sampledPixels": 10000,
        "sampling": "random"
      }
    }
  ]
}
```

---

## New Script: compare-pdf-outputs.js

**Location**: `experiments/compare-pdf-outputs.js`

**Purpose**: Drop-in replacement for comparison functionality, to be used by `experiments/scripts/generate-verification-matrix.mjs` later.

**Key Conventions**:
1. Shebang: `#!/usr/bin/env node`
2. TypeScript checking: `// @ts-check`
3. Module docstring with `@module` tag
4. Argument parsing following existing patterns
5. Path resolution: Relative paths in JSON files resolved relative to the JSON file itself (ColorConversionPolicy pattern)

### Path Resolution Pattern

Follows the ColorConversionPolicy approach:

```javascript
// Create URL for the JSON file
const configURL = new URL(configPath, `file://${process.cwd()}/`);

// Resolve relative paths within the JSON relative to the JSON file
const resolvedPath = new URL(relativePath, configURL);
```

### Test Data

- **Output Directory**: `output/2026-02-02-001/`
- **Current Config**: `configurations/2026-02-02-REFACTOR-FIXTURES-BASELINE.json`
- **Outdated Config**: `configurations/outdated/2026-01-30-REFACTOR-FIXTURES-BASELINE.json`

---

## Enhanced Configuration Options

### tolerances

Per-metric tolerance thresholds. Determines pass/fail status for each metric.

```json
{
    "aspects": [{
        "type": "Delta-E",
        "tolerances": {
            "Average": 2.0,
            "Max": 5.0
        }
    }]
}
```

**Metric Aliases**: Config keys are mapped to canonical metric names:
- `Maximum` ← `Maximum`, `Max`, `max`, `maximum`
- `Minimum` ← `Minimum`, `Min`, `min`, `minimum`
- `Average` ← `Average`, `Avg`, `avg`, `average`, `Mean`, `mean`

**Output**: Each metric includes `tolerance` and `withinTolerance` fields when tolerances are specified.

### required

Force Delta-E computation even for binary-identical images.

```json
{
    "aspects": [{
        "type": "Delta-E",
        "required": true
    }]
}
```

**Behavior**:
- Without `required`: Binary matches skip Delta-E (report `deltaE: null`)
- With `required: true`: Binary matches still compute Delta-E (useful for validation)

### reference

Compare pair members against original input PDF instead of against each other.

```json
{
    "aspects": [{
        "type": "Delta-E",
        "reference": "2025-08-15 - ConRes - ISO PTF - CR1 (F9d) Fixtures - F-01"
    }]
}
```

**Behavior**:
- Without `reference`: Pairs mode — compare pair member A vs pair member B
- With `reference`: Reference mode — compare each pair member against input PDF

**Use case**: Measure how much each conversion deviates from the original source.

### mode (deprecated in favor of reference)

Explicit mode selection (auto-detected from presence of `reference` field).

```json
{
    "aspects": [{
        "type": "Delta-E",
        "mode": "pairs"  // Explicit pairs mode (default)
    }]
}
```

---

## Implementation Constraints

1. **Only CIE 1976 Delta-E** — Do not implement Delta-E 2000 yet
2. **Self-describing components** — Each metrics class owns `static metricDefinitions`
3. **No scattered definitions** — Defaults belong with their respective classes
4. **Coordinator pattern** — `ComparisonsCoordinator` consolidates and propagates definitions
5. **Support flexible schemas** — String, structure, or array forms for metrics/sampling
6. **Provide serialization** — `toTransferable()`, `toJSON()` for thread transfer and persistence
7. **Use Output Intent profile** — Device* images need destination profile for Lab conversion
8. **Handle missing profiles gracefully** — Skip Delta-E, report as `-`
9. **Never hardwire configuration names**
10. **Respect `enabled` flags** at all levels

---

## Roadmap

- [x] Phase 0: Create `compare-pdf-outputs.js` Scaffold
  - [x] Create `experiments/compare-pdf-outputs.js` with argument parsing
  - [x] Implement JSON config loading with relative path resolution
  - [x] Integrate with existing output directories (matrix configuration support)

- [x] Phase 1: ComparisonsCoordinator Class
  - [x] Create `experiments/classes/comparisons-coordinator.mjs`
  - [x] Implement orchestrator with construction-time registration
  - [x] Implement `getConsolidatedDefinitions()` with lazy caching
  - [x] Implement `createConfiguration()` and `createMetrics()` factory
  - [x] Tests pass

- [x] Phase 2: DeltaEMetrics Class
  - [x] Create `experiments/classes/delta-e-metrics.mjs` with self-describing static properties
  - [x] Implement `static metricDefinitions` with all class defaults
  - [x] Implement `static #normalizeMetrics()` for class-owned normalization
  - [x] Implement instance methods for reference/sample/pair management
  - [x] Implement `getMetrics()` with configurable metrics
  - [x] Implement serialization (`toTransferable()`, `toJSON()`)
  - [x] Tests pass

- [x] Phase 3: ImageSampler Class
  - [x] Create `experiments/classes/image-sampler.mjs` with `ImageSampler` class
  - [x] Constructor receives `samplingTypes` from coordinator/metrics class
  - [x] Implement `sample()` with strategy selection
  - [x] Support random (with interval), uniform (with intervals), overall
  - [x] Tests pass (reproducible with seed)

- [x] Phase 4: ImageLabConverter Class
  - [x] Create `experiments/classes/image-lab-converter.mjs` with `ImageLabConverter` class
  - [x] Constructor receives `transform` from coordinator/metrics class
  - [x] Implement `convert()` and `convertAtIndices()`
  - [x] Implement transform caching
  - [x] Support Gray, RGB, CMYK via channel detection
  - [x] Factory `fromMetricDefinitions()` works
  - [x] Verified with real PDF images via CLI and test script

- [x] Phase 5A: Fully Functional CLI + Validation (Pairs Mode)
  - [x] Implement CLI execution logic in `compare-pdf-outputs.js`:
    - [x] Load converted PDFs from `output/2026-02-02-001/`
    - [x] Handle `# Workers` → `N Workers` filename substitution
    - [x] Extract image XObjects from pages
    - [x] Extract Output Intent profile for Lab conversion
    - [x] Wire: ComparisonsCoordinator → ImageSampler → ImageLabConverter → DeltaEMetrics
    - [x] Binary-match fast path for identical images
    - [x] Output JSON results
    - [x] Output Markdown table
  - [x] Test CLI with `configurations/2026-02-02-REFACTOR-FIXTURES-K-ONLY-GCR.json`
  - [x] Verify against `output/2026-02-02-001/` (read-only)
  - [x] Sequential subagent validation (3 cycles, NOT parallel):
    - [x] Cycle 1: Identified Delta-E path not exercised, metric alias bug, threshold not passed
    - [x] Cycle 2: Verified fixes, identified threshold not passed from config
    - [x] Cycle 3: Final approval - all checks passed
  - [x] **APPROVED** - All validation cycles complete

- [x] Phase 5A+ Enhancements:
  - [x] **ImageMatchMetrics class** — Separate class for pre-checks and binary matching
    - [x] Pre-checks: dimensions, BPC, channels, color space compatibility
    - [x] Binary layers: compressed hash, uncompressed hash
    - [x] Status outcomes: MATCH, DELTA, MISMATCH, SKIP
    - [x] Follows validation rules from `compare-pdf-color.js`
  - [x] **tolerances config** — Per-metric thresholds with alias mapping
    - [x] Config: `tolerances: { "Average": 2.0, "Max": 5.0 }`
    - [x] Aliases: Max→Maximum, Avg→Average, etc.
    - [x] Output: `withinTolerance` boolean per metric
    - [x] Markdown: ✓/✗ indicators in table
  - [x] **required config** — Force Delta-E even for binary matches
    - [x] Config: `required: true`
    - [x] When binary match + required: compute Delta-E anyway
    - [x] Preserves `match.binaryMatch: true` in output

- [x] Phase 5B: Reference Mode — `COMPLETE`
  - [x] **reference config** — Compare pair members against original input PDF
    - [x] Config: `reference: "<input-name>"`
    - [x] Each pair member compared against input PDF (not against each other)
    - [x] Loads original input PDF from `inputs[name].pdf`
  - [x] Update `buildComparisonTasks()` to detect reference mode
  - [x] Update `executeComparisons()` to handle reference comparisons
  - [x] `compareImages()` helper function extracted for code reuse
  - [x] **ICC Profile extraction** — Extract embedded profiles from ICCBased color spaces
    - [x] Updated `getColorSpaceInfo()` to return `iccProfile` field
    - [x] Updated `extractImagesFromPage()` to use `getColorSpaceInfo()` for full color space info
    - [x] Added `iccProfile?: Uint8Array` to `ExtractedImage` typedef
  - [x] **Profile-aware Lab conversion** — Use correct profile for each image
    - [x] ICCBased color spaces: use embedded ICC profile
    - [x] Device* color spaces: use Output Intent profile
    - [x] No fallbacks — fail if profile not available
    - [x] Updated `compareImages()` to pass correct profile to `labConverter.convertAtIndices()`
  - [x] **PDFImageColorSampler Integration** — Use new production class
    - [x] Replace manual `extractSampledPixels()` + `convertColorsBuffer()` + `convertLab8ToFloat()` with `PDFImageColorSampler.samplePixels()`
    - [x] Create single `PDFImageColorSampler` instance, reuse for all images
    - [x] Pass `streamData` (compressed or raw), `isCompressed`, and `pixelIndices` to `samplePixels()`
    - [x] Use `result.labValues` (Float32Array) directly for Delta-E computation
    - [x] Remove redundant helper functions from CLI
  - [x] Test with `output/2026-02-02-007/` baseline
  - [x] Verify CLI produces expected Delta-E output

- [x] Phase 5C: "Unique" Metric Implementation `COMPLETE + CRITICAL FIX`
  - [x] Add `unique` to `DeltaEMetrics.metricDefinitions.metricsTypes`
  - [x] **CRITICAL FIX**: Changed from counting unique delta-E values to counting unique LAB COLORS
  - [x] Implement unique color counting in `DeltaEMetrics.addFromPixelArrays()`
    - Track unique Lab colors separately for reference and sample images
    - Round to 1 decimal place for grouping (avoids floating point noise)
  - [x] Update metric output to report `{ reference: N, sample: M }` object
  - [x] Test 004A: Initial implementation (unique delta-E — incorrect)
  - [x] **CRITICAL FIX** Test 004D: Now tracking unique Lab colors separately
    - MATCH cases: Same unique counts (e.g., 6776/6776, 39/39)
    - DELTA cases: Different counts showing color expansion (e.g., 6327/6776, 255/723)
  - [x] Update CLI table header to "Unique (Ref/Sample)"
  - [x] Update SUMMARY.json to show `totalUniqueColors.reference` and `totalUniqueColors.sample`

- [x] Phase 5D: Improved SUMMARY Output `COMPLETE`
  - [x] Design condensed SUMMARY.json structure:
    - `overview`: quick status (PASS/FAIL) + totals for comparisons/changes
    - `comparisons`: images stats + aggregated Delta-E metrics (avgOfAverages, overallMaximum, totalUnique)
    - `changes`: verification totals
    - Removed verbose `diagnosticsComparisons` (handled separately)
  - [x] Design condensed SUMMARY.md format:
    - Quick status table at top with ✓/✗ indicators
    - Condensed comparison metrics table
    - Link to detailed files (COMPARISONS.md, CHANGES.md)
  - [x] Implement new `generateSummaryJson()` function (unified for both types)
  - [x] Update `generateChangesSummaryMarkdown()` to include quick status table
  - [x] Test 004B: Verified improved SUMMARY.json and SUMMARY.md format
    - Quick status table shows ✓ for both Comparisons and Changes
    - Delta-E aggregates: avgOfAverages=0.20, overallMaximum=141.98, totalUnique=5217

- [x] Phase 5E: Large PDF Support (JSON Structure Optimization) `COMPLETE`
  - [ ] **Staged Processing**: Separate processing of comparisons vs changes (DEFERRED)
    - Note: Current implementation generates all output at end, not staged
    - Can be added later if memory becomes an issue
  - [x] **Nested JSON Structure** for CHANGES.json:
    - Current: flat array with `outputName`, `pairFirstConfig`, etc. repeated per verification
    - New: nested `{ outputs: { [outputName]: { pairs: { [pairKey]: { members, verifications } } } } }`
    - [x] Created `generateChangesJsonOutputNested()` function
    - [x] Added `--nested-format` CLI flag to enable nested output
    - [x] Created `generateChangesMarkdownOutputNested()` for nested Markdown
  - [x] **Eliminate Redundant Fields**:
    - [x] Remove `firstExpected`/`secondExpected` duplication (always identical in pairs mode)
    - [x] Use single `expected` field instead
    - [x] Move `pairFirst*`/`pairSecond*` to `members` at pair level (not repeated per verification)
    - [x] Shortened field names: `pageNum` → `position.page`, `streamIndex` → `position.stream`, etc.
  - [x] **NOTE**: >2GB PDF file loading is a **pdf-lib limitation** (ArrayBuffer 2GB limit)
    - Cannot be addressed without switching to a streaming PDF library
    - The optimizations above reduce OUTPUT file sizes, not INPUT loading
  - [x] Test 004C: `--nested-format` verified — 11% file size reduction (4.7MB → 4.2MB)
  - [x] Test 004D: Final verification with critical fixes

- [ ] Phase 6: Integration with Verification Matrix
  - [ ] Create `ComparisonsCoordinator` and register `DeltaEMetrics`
  - [ ] Update `generate-verification-matrix.mjs`
  - [ ] Wire layers: coordinator → sampler → converter → metrics
  - [ ] Populate ΔE columns and JSON output

---

## Phase 5C/5D/5E Viability Analysis (2026-02-03)

### Request Summary

User requested adding phases before Phase 6 to address:
1. "Unique" metric for counting total unique colors
2. Better concise summaries in SUMMARY.{json,md}
3. Extremely large PDF support (>2GB)

### Viability Assessment

| Proposed Change | Viability | Rationale |
|-----------------|-----------|-----------|
| **Phase 5C: "Unique" Metric** | **HIGH** | Simple addition to DeltaEMetrics — count unique delta-E values or unique input color tuples |
| **Phase 5D: Better SUMMARY** | **HIGH** | Redesign output format — condense diagnostics, add aggregated summaries |
| **Phase 5E: Staged Processing** | **MEDIUM** | Requires refactoring to write files immediately after each task type completes |
| **Phase 5E: Nested JSON** | **HIGH** | Change from flat to nested structure — massive redundancy reduction |
| **Phase 5E: Eliminate Redundancy** | **HIGH** | Remove duplicated `firstExpected`/`secondExpected` fields |
| **>2GB PDF Loading** | **LOW** | **pdf-lib limitation** — ArrayBuffer 2GB limit; requires streaming library |

### CHANGES.json Redundancy Example

**Current Structure** (flat, highly redundant):
```json
{
  "verifications": [
    {
      "outputName": "eciCMYK v2 - Relative Colorimetric",
      "pairFirstName": "Main Thread",
      "pairFirstConfig": "Refactored - Main Thread - Color-Engine 2026-01-30",
      "pairSecondName": "Workers",
      "pairSecondConfig": "Refactored - # Workers - Color-Engine 2026-01-30",
      "firstExpected": [0.025, 0.025, 0.025],
      "secondExpected": [0.025, 0.025, 0.025],
      ...
    },
    // Repeated 4060 times with same outputName, pairFirst*, pairSecond*, etc.
  ]
}
```

**Proposed Structure** (nested, minimal redundancy):
```json
{
  "outputs": {
    "eciCMYK v2 - Relative Colorimetric": {
      "pairs": {
        "Main Thread vs Workers": {
          "first": { "name": "Main Thread", "config": "Refactored - Main Thread - Color-Engine 2026-01-30" },
          "second": { "name": "Workers", "config": "Refactored - # Workers - Color-Engine 2026-01-30" },
          "verifications": [
            {
              "pageNum": 1,
              "streamIndex": 0,
              "operatorIndex": 30,
              "expected": [0.025, 0.025, 0.025],  // Single field, not first/second
              "firstActual": [0.003922, 0, 0.003922],
              "secondActual": [0.003922, 0, 0.003922],
              "passed": true
            }
          ]
        }
      }
    }
  }
}
```

### >2GB PDF Limitation Detail

The error `File size (2429679102) is greater than 2 GiB` occurs because:
- pdf-lib loads entire PDF into an ArrayBuffer
- JavaScript ArrayBuffer has a ~2GB limit in most environments
- The test file `2025-08-15 - ConRes - ISO PTF - CR1.pdf` is 2.26 GB

**Options (all require significant work)**:
1. Switch to pdf.js with streaming support — major library change
2. Use native PDF tools (pdftk, qpdf) for extraction — loses pdf-lib integration
3. Split large PDFs before processing — requires external tooling

**Decision**: Mark as out-of-scope for Phase 5E. Focus on OUTPUT optimization.

---

## Unexpected Decisions Log

Track decisions made during autonomous implementation for user review.

| #   | Decision                                                                            | Rationale                                                                                                                                                                                                                                                                                               |
| --- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Config uses `# Workers` placeholder but actual files have `7 Workers`               | Runtime substitution during conversion. Script currently builds paths with config name as-is. May need pattern matching or config mapping.                                                                                                                                                              |
| 2   | Output directory is `experiments/output/` not `configurations/output/`              | Actual output PDFs are stored relative to experiments folder, not configurations folder.                                                                                                                                                                                                                |
| 3   | File naming pattern: `<input> - <output> - <config> (<date-seq>).pdf`               | Different from initially assumed `<input> - <config> - <output>.pdf`. Discovered by inspecting actual output directory.                                                                                                                                                                                 |
| 4   | ComparisonsCoordinator implements registry+factory, not full orchestrator           | Progress document specified "orchestrator with workflow sequence" but initial implementation focuses on core functionality (registration, consolidation, factory). Orchestration methods (`compute()`) deferred to Phase 5 integration. This is deliberate simplification to get classes working first. |
| 5   | DeltaEMetrics.fromJSON() now returns instance, added extractResult() for raw result | Original fromJSON returned plain object (result only), not class instance. Gap analysis identified this as inconsistent. Fixed to return instance; added extractResult() for display-only use case.                                                                                                     |

---

## Gaps Addressed After Agent Review

Three agents (fill-gaps, Explore, plan-reviewer) reviewed the implementation. Key gaps fixed:

| Gap                                                            | Severity | Fix                                                                  |
| -------------------------------------------------------------- | -------- | -------------------------------------------------------------------- |
| Missing error handling in ImageLabConverter transform creation | Critical | Added try-catch around openProfileFromMem and createTransform        |
| Missing input validation in validateAspects                    | Critical | Added array check, type validation, returns `invalid` array          |
| Inconsistent fromJSON return type                              | Critical | fromJSON now returns instance; added extractResult() for result-only |
| Missing validation in addFromPixelArrays                       | Moderate | Added length check and bounds validation                             |

### Architectural Note

The plan-reviewer identified that ComparisonsCoordinator is documented as "orchestrator" but only implements registry+factory. This is an intentional simplification for Phase 0-4. The workflow orchestration (`compute()` method for end-to-end processing) will be added in Phase 5 integration.

---

## Phase 5B: PDFImageColorSampler for Delta-E

### Key Discovery: PDFImageColorSampler Class

A new class `PDFImageColorSampler` (in `2025/classes/`) extends `PDFImageColorConverter` specifically for analysis use cases. It encapsulates all the complexity of Lab float conversion with pixel sampling.

**See full documentation:** `testing/iso/ptf/2025/classes/PDFImageColorSampler.md`

### What PDFImageColorSampler Provides

| Feature | Description |
|---------|-------------|
| Lab Float32 output | Uses `outputBitsPerComponent: 32` internally for `TYPE_Lab_FLT` |
| Built-in pixel sampling | `samplePixels()` takes `pixelIndices` directly |
| Decompression | Handles FlateDecode via pako |
| Bit depth normalization | Handles 1, 2, 4, 8, 16-bit input |
| Endianness handling | Inherited from parent class |
| Prevents misuse | Throws if you try `convertColor()` (Float32 can't go to PDF) |

### What It Eliminates From CLI

| Redundant Code | Now Handled By |
|----------------|----------------|
| `extractSampledPixels()` function | `samplePixels()` internal method |
| `convertLab8ToFloat()` workaround | Direct Float32 output |
| Endianness determination | Class handles internally |
| Bit depth normalization | `#normalizeBitsPerComponent()` |
| Decompression | `#decompress()` with pako |
| Direct `convertColorsBuffer()` with many params | Single `samplePixels()` call |

### API Usage

```javascript
import { PDFImageColorSampler } from '../classes/pdf-image-color-sampler.js';

// Create sampler (reuse across multiple images)
const labSampler = new PDFImageColorSampler({
    renderingIntent: 'relative-colorimetric',
    blackPointCompensation: true,
    useAdaptiveBPCClamping: false,
    destinationProfile: 'Lab',
    destinationColorSpace: 'Lab',
    inputType: 'CMYK',
    compressOutput: false,
    verbose: false,
});
await labSampler.ensureReady();

// Single call replaces ~50 lines of manual handling
const result = await labSampler.samplePixels({
    streamRef: image.name,
    streamData: image.streamData,       // Compressed or raw
    isCompressed: image.isCompressed,
    width: image.width,
    height: image.height,
    colorSpace: image.colorSpace,       // 'RGB', 'CMYK', 'Gray', 'Lab'
    bitsPerComponent: image.bitsPerComponent,
    sourceProfile: iccProfile,          // ArrayBuffer from ICCBased or Output Intent
    pixelIndices: sampling.indices,     // From ImageSampler
});

// result.labValues is Float32Array ready for Delta-E
```

### Profile Sources (unchanged)

- **ICCBased color spaces**: Extract embedded ICC profile from PDF
- **Device* color spaces**: Use Output Intent profile from converted PDF
- **Lab color space**: Use `'Lab'` sentinel (built-in D50)

---

## Activity Log

| Date       | Activity                                                                                  |
| ---------- | ----------------------------------------------------------------------------------------- |
| 2026-02-02 | Created initial progress document                                                         |
| 2026-02-02 | Revised based on actual JSON schema review                                                |
| 2026-02-02 | Analyzed output/2026-02-01-023 structure                                                  |
| 2026-02-02 | Key finding: Output images use Device* colorspaces, need Output Intent profile            |
| 2026-02-02 | **Correction**: Previous Delta-E implementation was bad and removed                       |
| 2026-02-02 | **Correction**: Must use experiments/classes/ for new implementation              |
| 2026-02-02 | **Correction**: Only "Delta-E" (CIE 1976) allowed, "Delta-E 2000" is TBD                  |
| 2026-02-02 | Initial proposal incorrectly labeled functions as "classes"                               |
| 2026-02-02 | **Architectural revision**: Self-describing components with coordinator pattern           |
| 2026-02-02 | Research: ESLint static meta, OpenTelemetry instrument registration, Jest extend          |
| 2026-02-02 | Research: ColorConversionPolicy, DiagnosticsCollector, BufferRegistry patterns            |
| 2026-02-02 | Key insight: Definitions belong WITH their classes, not scattered in central file         |
| 2026-02-02 | `ComparisonsCoordinator` — Registry, consolidation, factory, propagation                  |
| 2026-02-02 | `DeltaEMetrics.metricDefinitions` — Self-contained class defaults                         |
| 2026-02-02 | Schema flexibility: String, structure, array, or mixed forms supported                    |
| 2026-02-02 | Serialization: `toTransferable()` for threads, `toJSON()` for persistence                 |
| 2026-02-02 | **Finalized architecture**: Coordinator is orchestrator with workflow sequence            |
| 2026-02-02 | **Finalized**: Classes can register additional generics (future extensibility)            |
| 2026-02-02 | Started implementation of `experiments/compare-pdf-outputs.js`                            |
| 2026-02-02 | Phase 0: `compare-pdf-outputs.js` scaffold complete with matrix config support            |
| 2026-02-02 | Phase 1: `ComparisonsCoordinator` class created - registry, consolidation, factory        |
| 2026-02-02 | Phase 2: `DeltaEMetrics` class created - CIE76 computation, serialization                 |
| 2026-02-02 | Phase 3: `ImageSampler` class created - random, uniform, overall sampling                 |
| 2026-02-02 | Phase 4: `ImageLabConverter` class created - ColorEngineProvider integration              |
| 2026-02-02 | All phase 0-4 tests pass (test-comparison-classes.mjs)                                    |
| 2026-02-02 | **Gap review**: 3 agents analyzed implementation (fill-gaps, Explore, plan-reviewer)      |
| 2026-02-02 | Fixed critical gap: Error handling in ImageLabConverter transform creation                |
| 2026-02-02 | Fixed critical gap: Input validation in ComparisonsCoordinator.validateAspects            |
| 2026-02-02 | Fixed critical gap: DeltaEMetrics.fromJSON now returns instance + extractResult()         |
| 2026-02-02 | Fixed moderate gap: Input validation in addFromPixelArrays                                |
| 2026-02-02 | Documented architectural note: Coordinator is registry+factory (orchestration in Phase 5) |
| 2026-02-02 | **USER CORRECTION**: CLI is scaffold only — execution logic not implemented |
| 2026-02-02 | **USER CORRECTION**: Must test with `configurations/2026-02-02-REFACTOR-FIXTURES-K-ONLY-GCR.json` |
| 2026-02-02 | **USER CORRECTION**: Output directory `output/2026-02-02-001/` is locked (read-only) |
| 2026-02-02 | **ROADMAP REVISED**: Inserted Phase 5 (Fully Functional CLI + Validation), offset Phase 5→6 |
| 2026-02-02 | **REQUIREMENT**: 3 separate subagent validations after CLI implementation |
| 2026-02-02 | Implemented CLI execution logic with PDF loading, image extraction, Output Intent extraction |
| 2026-02-02 | Implemented `# Workers` → `N Workers` filename substitution via regex matching |
| 2026-02-02 | Added binary-match fast path for identical images (reports Delta-E=0, sampleCount=0) |
| 2026-02-02 | Fixed metric alias bug: Added `max`, `min`, `avg`, `mean` aliases in DeltaEMetrics |
| 2026-02-02 | CLI tested successfully: 9 images compared, all MATCH (binary identical) |
| 2026-02-02 | **Validation Cycle 1**: Identified Delta-E path not exercised, threshold not passed |
| 2026-02-02 | Created `scripts/test-delta-e-computation.mjs` to exercise non-binary-match path |
| 2026-02-02 | Delta-E test results: Average=45.88, Maximum=136.27, PassRate=7.84% (K-Only vs RelCol) |
| 2026-02-02 | **Validation Cycle 2**: Verified fixes, identified threshold not passed from config |
| 2026-02-02 | Fixed: Now passes `threshold: task.aspect.threshold` to createMetrics() |
| 2026-02-02 | **Validation Cycle 3**: Final approval — all checks passed |
| 2026-02-02 | **PHASE 5A COMPLETE**: CLI fully functional, 3 validation cycles completed |
| 2026-02-02 | **USER CORRECTION**: sampleCount=0 bug — binary-match inside Delta-E is wrong design |
| 2026-02-02 | **Created ImageMatchMetrics class** — Separate class for pre-checks and binary matching |
| 2026-02-02 | Refactored compare-pdf-outputs.js to use ImageMatchMetrics.compare() |
| 2026-02-02 | **Added tolerances config** — Per-metric thresholds with alias mapping |
| 2026-02-02 | **Added required config** — Force Delta-E even for binary matches |
| 2026-02-02 | Updated output structure: separate `match` and `deltaE` objects |
| 2026-02-02 | Markdown output now shows ✓/✗ indicators for tolerance checks |
| 2026-02-02 | Successfully tested with Comparisons 001-007 runs |
| 2026-02-02 | **USER REQUEST**: Add reference mode (compare against original input PDF) |
| 2026-02-02 | Updated progress document to reflect Phase 5A+ enhancements |
| 2026-02-02 | **PHASE 5B START**: Implementing reference mode |
| 2026-02-02 | Updated `AspectConfig` typedef to include `mode`, `reference`, `required`, `tolerances`, `threshold` |
| 2026-02-02 | Updated `ComparisonTask` typedef with `mode` and `referencePdfPath` fields |
| 2026-02-02 | Updated `buildComparisonTasks()` to detect reference mode and load reference PDF path |
| 2026-02-02 | Created `compareImages()` helper function to avoid code duplication |
| 2026-02-02 | Updated `ImageMatchMetrics.#areColorSpacesCompatible()` to handle ICCBased(N) normalization |
| 2026-02-02 | Updated MISMATCH handling to allow reference mode with `required=true` to proceed to Delta-E |
| 2026-02-02 | **LIMITATION DISCOVERED**: Cross-color-model comparison requires different ICC profiles |
| 2026-02-02 | Original images: ICCBased(3) = RGB with embedded profile |
| 2026-02-02 | Converted images: DeviceCMYK = 4 channels with Output Intent profile |
| 2026-02-02 | Delta-E computation requires profile-aware Lab conversion per image |
| 2026-02-02 | **PHASE 5B PARTIAL**: Reference mode implemented but cross-model comparison pending |
| 2026-02-02 | **Implemented ICC profile extraction** — `getColorSpaceInfo()` extracts embedded profiles |
| 2026-02-02 | **Updated `extractImagesFromPage()`** — Now returns `iccProfile` field for ICCBased color spaces |
| 2026-02-02 | **Implemented profile-aware Lab conversion** — Different profiles for ICCBased vs Device* |
| 2026-02-02 | ICCBased images: use embedded ICC profile from color space definition |
| 2026-02-02 | Device* images: use Output Intent profile from converted PDF |
| 2026-02-02 | No fallbacks: fail if profile not available (matches user requirement) |
| 2026-02-02 | **FINDING**: Reviewed `2026-02-02-REFACTOR-ENDIANNESS-PROGRESS.md` for new API parameters |
| 2026-02-02 | **FINDING**: Phase 2 refactor added `inputBitsPerComponent` and `outputBitsPerComponent` to color-conversion-policy.js |
| 2026-02-02 | **FINDING**: `ColorConverter.convertColorsBuffer()` already supports these parameters |
| 2026-02-02 | **FINDING**: Can do N-bit input → 32-bit float Lab output using `outputBitsPerComponent: 32` |
| 2026-02-02 | **DECISION**: Use production `ColorConverter` class instead of custom Lab conversion code |
| 2026-02-02 | **DECISION**: Replace `ImageLabConverter` with `ColorConverter.convertColorsBuffer()` for Lab output |
| 2026-02-02 | **USER CORRECTION**: Do not hardcode `inputBitsPerComponent: 8` — use `image.bitsPerComponent` |
| 2026-02-02 | **USER CORRECTION**: Do not hardcode endianness — derive from bit depth per `PDFImageColorConverter` |
| 2026-02-02 | **USER CORRECTION**: `inputEndianness` only for 16-bit — LittleCMS has no `TYPE_*_FLT_SE` variants |
| 2026-02-02 | **FINDING**: `PDFImageColorConverter:543` — `endianness: bitsPerComponent > 8 ? 'big' : 'native'` |
| 2026-02-02 | **FINDING**: `color-conversion-policy.js:976-980,1006-1011` — warns if endianness specified for 32-bit |
| 2026-02-02 | **DECISION**: Only specify `inputEndianness: 'big'` for 16-bit input; omit for 8-bit and 32-bit output |
| 2026-02-02 | **USER CORRECTION**: Condition must be `=== 16`, not `> 8` — float input would also trigger warning |
| 2026-02-02 | **USER SUGGESTION**: Use `PDFImageColorSampler` instead of direct `convertColorsBuffer()` calls |
| 2026-02-02 | **FINDING**: `PDFImageColorSampler` extends `PDFImageColorConverter` for analysis-only Lab float output |
| 2026-02-02 | **FINDING**: `samplePixels()` encapsulates decompression, bit normalization, sampling, and Lab conversion |
| 2026-02-02 | **DECISION**: Refactor CLI to use `PDFImageColorSampler` — eliminates ~50 lines of manual handling |
| 2026-02-02 | **BASELINE**: New test baseline `output/2026-02-02-007/` created by user |
| 2026-02-03 | **VERIFIED**: PDFImageColorSampler integration working — CLI uses `samplePixels()` for Lab Float32 output |
| 2026-02-03 | **VERIFIED**: Baseline `output/2026-02-02-007/` produces expected results |
| 2026-02-03 | **RESULTS**: 81 images compared — Main Thread vs Workers all MATCH, Reference mode shows DELTA with Delta-E values |
| 2026-02-03 | **FINDING**: Im8 (Lab images) show high max Delta-E (~141.98) due to out-of-gamut colors during conversion |
| 2026-02-03 | **PHASE 5B COMPLETE**: PDFImageColorSampler integration verified |
| 2026-02-03 | **USER REQUEST**: Add phases before Phase 6 for Unique metric, SUMMARY improvements, large PDF support |
| 2026-02-03 | **VIABILITY ANALYSIS**: Unique metric (HIGH), SUMMARY improvements (HIGH), JSON optimization (HIGH), >2GB loading (LOW - pdf-lib limitation) |
| 2026-02-03 | **PHASES ADDED**: 5C (Unique metric), 5D (SUMMARY output), 5E (JSON structure optimization) |
| 2026-02-03 | **CRITICAL NOTE**: >2GB PDF loading requires streaming PDF library replacement - out of scope |
| 2026-02-03 | **AWAITING USER APPROVAL** for new phases before proceeding |
| 2026-02-03 | **PHASE 5C COMPLETE**: Unique metric tracks unique Lab colors separately for reference/sample |
| 2026-02-03 | **CRITICAL FIX**: Changed from counting unique delta-E values to unique Lab color tuples |
| 2026-02-03 | **PHASE 5D COMPLETE**: SUMMARY.{json,md} includes unified overview and Delta-E statistics |
| 2026-02-03 | **PHASE 5E COMPLETE**: Nested JSON structure reduces CHANGES.json file size by ~11% |
| 2026-02-03 | **TEST 004D**: Verified phases 5C/5D/5E — 81 comparisons, 0 skip, 4060 verifications passed |
| 2026-02-03 | **BUG FIX**: ICCBased color spaces reported as `ICCBased(#)` instead of `ICCBasedGray/RGB/CMYK` |
| 2026-02-03 | **ROOT CAUSE**: `getColorSpaceInfo()` used numeric channel count in name |
| 2026-02-03 | **ROOT CAUSE**: `mapColorSpace()` regex only matched old `ICCBased(N)` format |
| 2026-02-03 | **FIX**: Updated `getColorSpaceInfo()` to return `ICCBasedGray`/`ICCBasedRGB`/`ICCBasedCMYK` |
| 2026-02-03 | **FIX**: Updated `mapColorSpace()` to handle both new and legacy ICCBased formats |
| 2026-02-03 | **TEST 004F**: Verified ICCBased naming fix — 81 comparisons, 0 skip, matches 004D exactly |
