// @ts-check
/**
 * Composite Color Converter
 *
 * Intermediate base class for converters that coordinate multiple child
 * conversion operations. Manages WorkerPool lifecycle with ownership semantics.
 *
 * @module CompositeColorConverter
 */

import { ColorConverter } from './color-converter.js';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Configuration for CompositeColorConverter.
 *
 * @typedef {import('./color-converter.js').ColorConverterConfiguration & {
 *   useWorkers?: boolean,
 *   workerPool?: import('./worker-pool.js').WorkerPool,
 *   colorEnginePath?: string,
 * }} CompositeColorConverterConfiguration
 */

// ============================================================================
// CompositeColorConverter Class
// ============================================================================

/**
 * Base class for converters that coordinate multiple child conversions.
 *
 * Manages WorkerPool lifecycle with ownership semantics:
 * - If `workerPool` is provided in config, uses shared pool (does not own)
 * - If `useWorkers` is true and no pool provided, creates and owns pool
 *
 * Subclasses (PDFDocumentColorConverter, PDFPageColorConverter) inherit
 * WorkerPool management instead of duplicating it.
 *
 * @extends ColorConverter
 * @example
 * ```javascript
 * class PDFPageColorConverter extends CompositeColorConverter {
 *     async convertColor(input, context) {
 *         await this.ensureReady();
 *         const pool = this.workerPool; // Access inherited pool
 *         // ... coordinate child conversions
 *     }
 * }
 * ```
 */
export class CompositeColorConverter extends ColorConverter {
    // ========================================
    // Private Fields
    // ========================================

    /** @type {import('./worker-pool.js').WorkerPool | null} */
    #workerPool = null;

    /** @type {boolean} */
    #ownsWorkerPool = false;

    /** @type {Promise<void>} */
    #compositeReady;

    // ========================================
    // Constructor
    // ========================================

    /**
     * Creates a new CompositeColorConverter instance.
     *
     * @param {CompositeColorConverterConfiguration} configuration - Immutable configuration
     * @param {object} [options={}] - Additional options
     * @param {import('./color-engine-provider.js').ColorEngineProvider} [options.colorEngineProvider] - Shared provider
     */
    constructor(configuration, options = {}) {
        super(configuration, options);
        this.#compositeReady = this.#initializeWorkerPool();
    }

    // ========================================
    // WorkerPool Initialization
    // ========================================

    /**
     * Initializes the WorkerPool if configured.
     * @returns {Promise<void>}
     */
    async #initializeWorkerPool() {
        // Wait for parent initialization first
        await super.ensureReady();

        const config = /** @type {CompositeColorConverterConfiguration} */ (this.configuration);

        if (config.useWorkers) {
            if (config.workerPool) {
                // Use provided pool (from parent converter)
                this.#workerPool = config.workerPool;
                this.#ownsWorkerPool = false;
            } else {
                // Create own pool
                const { WorkerPool } = await import('./worker-pool.js');
                const diagnosticsEnabled = this.diagnostics.enabled;
                this.#workerPool = new WorkerPool({
                    colorEnginePath: config.colorEnginePath,
                    diagnosticsEnabled,
                });
                await this.#workerPool.initialize();
                this.#ownsWorkerPool = true;

                // Register worker diagnostics ports with MainDiagnosticsCollector
                if (diagnosticsEnabled && this.#workerPool.getDiagnosticsPorts) {
                    await this.#registerWorkerDiagnostics();
                }
            }
        }
    }

    /**
     * Registers worker diagnostics ports with MainDiagnosticsCollector.
     * @returns {Promise<void>}
     */
    async #registerWorkerDiagnostics() {
        const diagnostics = this.diagnostics;
        // Check if diagnostics is a MainDiagnosticsCollector (has registerAuxiliary method)
        if (!diagnostics || typeof /** @type {any} */ (diagnostics).registerAuxiliary !== 'function') {
            return;
        }

        const mainDiagnostics = /** @type {import('./main-diagnostics-collector.js').MainDiagnosticsCollector} */ (diagnostics);

        for (const { workerId, port } of this.#workerPool?.getDiagnosticsPorts() ?? []) {
            // Register with current span as parent for worker spans
            mainDiagnostics.registerAuxiliary(workerId, port, mainDiagnostics.currentSpanId);
        }
    }

    /**
     * Ensures the converter is ready for use.
     * Overrides parent to include WorkerPool initialization.
     * @returns {Promise<void>}
     */
    async ensureReady() {
        await super.ensureReady();
        await this.#compositeReady;
    }

    // ========================================
    // WorkerPool Access
    // ========================================

    /**
     * Gets the configuration as CompositeColorConverterConfiguration.
     * @returns {Readonly<CompositeColorConverterConfiguration>}
     */
    get configuration() {
        return /** @type {Readonly<CompositeColorConverterConfiguration>} */ (super.configuration);
    }

    /**
     * Gets the WorkerPool instance.
     * @returns {import('./worker-pool.js').WorkerPool | null}
     */
    get workerPool() {
        return this.#workerPool;
    }

    /**
     * Whether this converter supports worker mode.
     * @returns {boolean}
     */
    get supportsWorkerMode() {
        return this.#workerPool !== null;
    }

    // ========================================
    // Resource Cleanup
    // ========================================

    /**
     * @override
     */
    dispose() {
        // Unregister worker diagnostics ports if we own the pool
        if (this.#ownsWorkerPool && this.#workerPool?.diagnosticsEnabled) {
            const diagnostics = this.diagnostics;
            if (diagnostics && typeof /** @type {any} */ (diagnostics).unregisterAuxiliary === 'function') {
                const mainDiagnostics = /** @type {import('./main-diagnostics-collector.js').MainDiagnosticsCollector} */ (diagnostics);
                for (const { workerId } of this.#workerPool.getDiagnosticsPorts?.() ?? []) {
                    mainDiagnostics.unregisterAuxiliary(workerId);
                }
            }
        }

        if (this.#ownsWorkerPool && this.#workerPool) {
            this.#workerPool.terminate();
        }
        this.#workerPool = null;
        super.dispose();
    }
}
