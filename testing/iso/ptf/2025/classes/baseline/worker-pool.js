// @ts-check
/**
 * Isomorphic Worker Pool for parallel color transformations
 *
 * Works in both Node.js (worker_threads) and browser (Web Workers).
 * Self-contained in classes/ - no dependencies on services/.
 *
 * @module WorkerPool
 */

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Runtime environment detection result.
 * @typedef {'node' | 'browser'} RuntimeEnvironment
 */

/**
 * Information about a worker in the pool.
 * @typedef {{
 *   id: number,
 *   worker: Worker | import('worker_threads').Worker,
 *   busy: boolean,
 *   taskCount: number,
 *   diagnosticsPort?: MessagePort,
 * }} WorkerInfo
 */

/**
 * Task types supported by the worker pool.
 * @typedef {'transform' | 'image' | 'content-stream' | 'benchmark'} TaskType
 */

/**
 * Transform task for raw pixel buffer conversion.
 * @typedef {{
 *   type: 'transform',
 *   inputArray: Uint8Array | Uint16Array | Float32Array,
 *   inputFormat: number,
 *   outputFormat: number,
 *   outputComponentsPerPixel: number,
 *   pixelCount: number,
 *   sourceProfile: ArrayBuffer | 'Lab',
 *   destinationProfile: ArrayBuffer,
 *   renderingIntent: number,
 *   flags: number,
 * }} TransformTask
 */

/**
 * Image task for PDFImageColorConverter.
 * Supports both compressed (PDF) and uncompressed pixel data.
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
 * @typedef {{
 *   type: 'image',
 *   pixelBuffer?: ArrayBuffer,
 *   compressedData?: ArrayBuffer,
 *   isCompressed?: boolean,
 *   streamRef?: string,
 *   width: number,
 *   height: number,
 *   colorSpace: import('./color-converter.js').ColorType,
 *   bitsPerComponent: import('./color-conversion-policy.js').BitDepth,
 *   inputBitsPerComponent?: import('./color-conversion-policy.js').BitDepth,
 *   outputBitsPerComponent?: import('./color-conversion-policy.js').BitDepth,
 *   endianness?: import('./color-conversion-policy.js').Endianness,
 *   inputEndianness?: import('./color-conversion-policy.js').Endianness,
 *   outputEndianness?: import('./color-conversion-policy.js').Endianness,
 *   sourceProfile: ArrayBuffer | 'Lab',
 *   destinationProfile: ArrayBuffer,
 *   renderingIntent: import('./color-converter.js').RenderingIntent,
 *   blackPointCompensation: boolean,
 *   useAdaptiveBPCClamping: boolean,
 *   destinationColorSpace: import('./color-converter.js').ColorType,
 *   compressOutput?: boolean,
 *   verbose?: boolean,
 *   intermediateProfiles?: (ArrayBuffer | 'Lab')[],
 * }} ImageTask
 */

/**
 * Content-stream task for PDFContentStreamColorConverter.
 * @typedef {{
 *   type: 'content-stream',
 *   streamText: string,
 *   colorSpaceDefinitions?: Record<string, import('./pdf-content-stream-color-converter.js').ColorSpaceDefinition>,
 *   initialColorSpaceState?: import('./pdf-content-stream-color-converter.js').ColorSpaceState,
 *   sourceRGBProfile?: ArrayBuffer,
 *   sourceGrayProfile?: ArrayBuffer,
 *   destinationProfile: ArrayBuffer,
 *   renderingIntent: import('./color-converter.js').RenderingIntent,
 *   blackPointCompensation: boolean,
 *   destinationColorSpace: import('./color-converter.js').ColorType,
 *   verbose?: boolean,
 *   intermediateProfiles?: (ArrayBuffer | 'Lab')[],
 * }} ContentStreamTask
 */

/**
 * Benchmark task for performance testing.
 * @typedef {{
 *   type: 'benchmark',
 *   iterations: number,
 *   arraySize: number,
 * }} BenchmarkTask
 */

/**
 * Union of all task types.
 * @typedef {TransformTask | ImageTask | ContentStreamTask | BenchmarkTask} WorkerTask
 */

/**
 * Result from a worker task.
 * @typedef {{
 *   success: boolean,
 *   taskId?: number,
 *   outputArray?: Uint8Array | Uint16Array | Float32Array,
 *   pixelBuffer?: Uint8Array | Uint16Array | Float32Array,
 *   newText?: string,
 *   replacementCount?: number,
 *   finalColorSpaceState?: import('./pdf-content-stream-color-converter.js').ColorSpaceState,
 *   error?: string,
 *   duration?: number,
 *   pixelCount?: number,
 *   bitsPerComponent?: import('./color-conversion-policy.js').BitDepth,
 *   isCompressed?: boolean,
 * }} TaskResult
 */

/**
 * Worker pool configuration options.
 * @typedef {{
 *   workerCount?: number,
 *   workerScript?: string | URL,
 *   colorEnginePath?: string,
 *   diagnosticsEnabled?: boolean,
 * }} WorkerPoolOptions
 */

/**
 * Worker pool statistics.
 * @typedef {{
 *   workerCount: number,
 *   busyWorkers: number,
 *   queueLength: number,
 *   totalTasks: number,
 * }} WorkerPoolStats
 */

// ============================================================================
// Environment Detection
// ============================================================================

/**
 * Detect runtime environment.
 * @returns {RuntimeEnvironment}
 */
function detectEnvironment() {
    if (typeof process !== 'undefined' && process.versions?.node) {
        return 'node';
    }
    return 'browser';
}

/** @type {number | null} */
let cachedCpuCount = null;

/**
 * Get estimated optimal worker count based on hardware.
 * Uses half of available CPU cores (minimum 1).
 * @returns {number}
 */
export function getDefaultWorkerCount() {
    const env = detectEnvironment();
    if (env === 'node') {
        if (cachedCpuCount !== null) {
            return Math.max(1, Math.floor(cachedCpuCount / 2));
        }
        // Fallback if not cached yet
        return 4;
    } else {
        // Browser - use navigator.hardwareConcurrency
        return Math.max(1, Math.floor((navigator.hardwareConcurrency || 4) / 2));
    }
}

// Initialize CPU count at module load (Node.js only)
if (typeof process !== 'undefined' && process.versions?.node) {
    import('os').then(os => {
        cachedCpuCount = os.cpus().length;
    }).catch(() => {
        cachedCpuCount = 8;
    });
}

// ============================================================================
// WorkerPool Class
// ============================================================================

/**
 * Isomorphic worker pool for parallel color transformations.
 *
 * Manages a pool of workers for parallel processing of color
 * transformation tasks. Works in both Node.js (worker_threads)
 * and browser (Web Workers) environments.
 *
 * @example
 * ```javascript
 * const pool = new WorkerPool({ workerCount: 4 });
 * await pool.initialize();
 *
 * const result = await pool.submitTransform({
 *     type: 'transform',
 *     inputArray: pixels,
 *     inputFormat: TYPE_RGB_8,
 *     outputFormat: TYPE_CMYK_8,
 *     // ... other options
 * });
 *
 * await pool.terminate();
 * ```
 */
export class WorkerPool {
    /** @type {WorkerInfo[]} */
    #workers = [];

    /** @type {Array<{task: WorkerTask, resolve: Function, reject: Function}>} */
    #taskQueue = [];

    /** @type {Map<number, {resolve: Function, reject: Function}>} */
    #pendingTasks = new Map();

    /** @type {number} */
    #taskIdCounter = 0;

    /** @type {boolean} */
    #initialized = false;

    /** @type {RuntimeEnvironment} */
    #environment;

    /** @type {number} */
    #workerCount;

    /** @type {string | URL} */
    #workerScript;

    /** @type {string | null} */
    #colorEnginePath;

    /** @type {boolean} */
    #diagnosticsEnabled;

    // ========================================
    // Constructor
    // ========================================

    /**
     * Creates a new WorkerPool.
     *
     * @param {WorkerPoolOptions} [options={}] - Pool configuration
     */
    constructor(options = {}) {
        this.#environment = detectEnvironment();
        this.#workerCount = options.workerCount || getDefaultWorkerCount();
        this.#workerScript = options.workerScript || this.#getDefaultWorkerScript();
        this.#colorEnginePath = options.colorEnginePath || null;
        this.#diagnosticsEnabled = options.diagnosticsEnabled || false;
    }

    // ========================================
    // Initialization
    // ========================================

    /**
     * Get the default worker script path.
     * Uses worker-pool-entrypoint.js which handles image and content-stream tasks.
     * @returns {string}
     */
    #getDefaultWorkerScript() {
        if (this.#environment === 'node') {
            return new URL('./worker-pool-entrypoint.js', import.meta.url).pathname;
        }
        return new URL('./worker-pool-entrypoint.js', import.meta.url).href;
    }

    /**
     * Initialize the worker pool.
     * Creates and initializes all workers.
     * @returns {Promise<void>}
     */
    async initialize() {
        if (this.#initialized) return;

        const workerPromises = [];

        for (let i = 0; i < this.#workerCount; i++) {
            workerPromises.push(this.#createWorker(i));
        }

        this.#workers = await Promise.all(workerPromises);
        this.#initialized = true;
    }

    /**
     * Create a single worker.
     * @param {number} id - Worker ID
     * @returns {Promise<WorkerInfo>}
     */
    async #createWorker(id) {
        /** @type {Worker | import('worker_threads').Worker} */
        let worker;
        /** @type {MessagePort | undefined} */
        let diagnosticsPort;
        /** @type {MessagePort | undefined} */
        let workerDiagnosticsPort;

        // Create MessageChannel for diagnostics if enabled
        if (this.#diagnosticsEnabled) {
            const { port1, port2 } = new MessageChannel();
            diagnosticsPort = port1;      // Main thread port
            workerDiagnosticsPort = port2; // Worker port
        }

        if (this.#environment === 'node') {
            const { Worker } = await import('worker_threads');
            const workerData = {
                colorEnginePath: this.#colorEnginePath,
                workerId: `worker-${id}`,
                diagnosticsEnabled: this.#diagnosticsEnabled,
            };
            worker = new Worker(this.#workerScript, {
                workerData,
            });
        } else {
            worker = new Worker(this.#workerScript, { type: 'module' });
        }

        const workerInfo = {
            id,
            worker,
            busy: false,
            taskCount: 0,
            diagnosticsPort,
        };

        // Set up message handler
        this.#setupMessageHandlers(workerInfo);

        // Wait for worker to be ready
        await this.#waitForWorkerReady(worker, workerDiagnosticsPort, id);

        return workerInfo;
    }

    /**
     * Set up message handlers for a worker.
     * @param {WorkerInfo} workerInfo
     */
    #setupMessageHandlers(workerInfo) {
        if (this.#environment === 'node') {
            const nodeWorker = /** @type {import('worker_threads').Worker} */ (workerInfo.worker);
            nodeWorker.on('message', (result) => {
                this.#handleWorkerResult(workerInfo, result);
            });
            nodeWorker.on('error', (error) => {
                this.#handleWorkerError(workerInfo, error);
            });
        } else {
            const browserWorker = /** @type {Worker} */ (workerInfo.worker);
            browserWorker.onmessage = (event) => {
                this.#handleWorkerResult(workerInfo, event.data);
            };
            browserWorker.onerror = (event) => {
                this.#handleWorkerError(workerInfo, new Error(event.message));
            };
        }
    }

    /**
     * Wait for worker to signal ready and send diagnostics port.
     * @param {Worker | import('worker_threads').Worker} worker
     * @param {MessagePort} [workerDiagnosticsPort]
     * @param {number} workerId
     * @returns {Promise<void>}
     */
    #waitForWorkerReady(worker, workerDiagnosticsPort, workerId) {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error(`Worker ${workerId} initialization timeout`));
            }, 10000);

            if (this.#environment === 'node') {
                const nodeWorker = /** @type {import('worker_threads').Worker} */ (worker);
                const readyHandler = (/** @type {any} */ msg) => {
                    if (msg?.type === 'ready') {
                        clearTimeout(timeout);
                        // Send diagnostics port after ready
                        if (workerDiagnosticsPort) {
                            nodeWorker.postMessage(
                                { type: 'diagnostics-port', port: workerDiagnosticsPort, workerId: `worker-${workerId}` },
                                [workerDiagnosticsPort]
                            );
                        }
                        resolve();
                    }
                };
                nodeWorker.once('message', readyHandler);
            } else {
                const browserWorker = /** @type {Worker} */ (worker);
                const originalHandler = browserWorker.onmessage;
                browserWorker.onmessage = (event) => {
                    if (event.data?.type === 'ready') {
                        clearTimeout(timeout);
                        browserWorker.onmessage = originalHandler;
                        // Send diagnostics port after ready
                        if (workerDiagnosticsPort) {
                            browserWorker.postMessage(
                                { type: 'diagnostics-port', port: workerDiagnosticsPort, workerId: `worker-${workerId}` },
                                [workerDiagnosticsPort]
                            );
                        }
                        resolve();
                    }
                };
            }
        });
    }

    // ========================================
    // Task Handling
    // ========================================

    /**
     * Handle result from a worker.
     * @param {WorkerInfo} workerInfo
     * @param {any} result
     */
    #handleWorkerResult(workerInfo, result) {
        if (result.taskId !== undefined && this.#pendingTasks.has(result.taskId)) {
            const { resolve, reject } = /** @type {{resolve: Function, reject: Function}} */ (
                this.#pendingTasks.get(result.taskId)
            );
            this.#pendingTasks.delete(result.taskId);

            if (result.success) {
                resolve(result);
            } else {
                reject(new Error(result.error || 'Unknown worker error'));
            }
        }

        workerInfo.busy = false;
        this.#processQueue();
    }

    /**
     * Handle error from a worker.
     * @param {WorkerInfo} workerInfo
     * @param {Error} error
     */
    #handleWorkerError(workerInfo, error) {
        console.error(`Worker ${workerInfo.id} error:`, error);
        workerInfo.busy = false;
        this.#processQueue();
    }

    /**
     * Process queued tasks.
     * Dispatches to first available worker.
     */
    #processQueue() {
        if (this.#taskQueue.length === 0) return;

        const availableWorker = this.#workers.find(w => !w.busy);
        if (!availableWorker) return;

        const queuedTask = this.#taskQueue.shift();
        if (queuedTask) {
            this.#executeTask(availableWorker, queuedTask.task, queuedTask.resolve, queuedTask.reject);
        }
    }

    /**
     * Execute a task on a specific worker.
     * @param {WorkerInfo} workerInfo
     * @param {WorkerTask} task
     * @param {Function} resolve
     * @param {Function} reject
     */
    #executeTask(workerInfo, task, resolve, reject) {
        workerInfo.busy = true;
        workerInfo.taskCount++;

        const taskId = this.#taskIdCounter++;
        this.#pendingTasks.set(taskId, { resolve, reject });

        const message = { ...task, taskId };

        // Collect transferable ArrayBuffers for zero-copy transfer.
        // Only transfer per-task data (image pixels) — not shared profiles.
        const transferables = WorkerPool.#collectTransferables(message);

        if (this.#environment === 'node') {
            /** @type {import('worker_threads').Worker} */ (workerInfo.worker).postMessage(message, transferables);
        } else {
            /** @type {Worker} */ (workerInfo.worker).postMessage(message, { transfer: transferables });
        }
    }

    /**
     * Collect transferable ArrayBuffers from a task message.
     *
     * Only transfers per-task pixel data (compressedData, pixelBuffer,
     * inputArray) — NOT shared ICC profiles (sourceProfile, destinationProfile,
     * intermediateProfiles) which are reused across tasks.
     *
     * @param {Record<string, any>} message - Task message
     * @returns {ArrayBuffer[]} Transferable buffers
     */
    static #collectTransferables(message) {
        /** @type {ArrayBuffer[]} */
        const transferables = [];

        // Image task: transfer the pixel/compressed data (unique per task)
        if (message.compressedData instanceof ArrayBuffer) {
            transferables.push(message.compressedData);
        } else if (message.pixelBuffer instanceof ArrayBuffer) {
            transferables.push(message.pixelBuffer);
        }

        // Transform task: transfer the input array buffer (unique per task)
        if (message.inputArray?.buffer instanceof ArrayBuffer) {
            transferables.push(message.inputArray.buffer);
        }

        return transferables;
    }

    // ========================================
    // Shared Profile Management
    // ========================================

    /** @type {boolean} */
    #sharedProfilesSent = false;

    /**
     * Broadcasts shared profiles to all workers. Workers cache these profiles
     * and use them as defaults for subsequent tasks, avoiding per-task cloning
     * of large ArrayBuffers via postMessage.
     *
     * Call this once after initialization, before submitting tasks.
     * Per-task messages can then omit destinationProfile and intermediateProfiles.
     *
     * @param {{
     *   destinationProfile?: ArrayBuffer,
     *   intermediateProfiles?: (ArrayBuffer | 'Lab')[],
     *   renderingIntent?: string,
     *   blackPointCompensation?: boolean,
     *   useAdaptiveBPCClamping?: boolean,
     *   destinationColorSpace?: string,
     * }} sharedConfig - Profiles and settings shared across all tasks
     */
    broadcastSharedProfiles(sharedConfig) {
        if (!this.#initialized || this.#sharedProfilesSent) return;

        const message = { type: 'shared-config', ...sharedConfig };

        for (const workerInfo of this.#workers) {
            if (this.#environment === 'node') {
                /** @type {import('worker_threads').Worker} */ (workerInfo.worker).postMessage(message);
            } else {
                /** @type {Worker} */ (workerInfo.worker).postMessage(message);
            }
        }

        this.#sharedProfilesSent = true;
    }

    /**
     * Whether shared profiles have been broadcast to workers.
     * @returns {boolean}
     */
    get hasSharedProfiles() {
        return this.#sharedProfilesSent;
    }

    // ========================================
    // Public API
    // ========================================

    /**
     * Submit a task to the worker pool.
     *
     * @param {WorkerTask} task - Task to execute
     * @returns {Promise<TaskResult>} Task result
     */
    async submitTask(task) {
        if (!this.#initialized) {
            await this.initialize();
        }

        return new Promise((resolve, reject) => {
            const availableWorker = this.#workers.find(w => !w.busy);

            if (availableWorker) {
                this.#executeTask(availableWorker, task, resolve, reject);
            } else {
                this.#taskQueue.push({ task, resolve, reject });
            }
        });
    }

    /**
     * Submit a transform task (alias for submitTask with type checking).
     *
     * @param {TransformTask} task - Transform task
     * @returns {Promise<TaskResult>}
     */
    async submitTransform(task) {
        return this.submitTask(task);
    }

    /**
     * Submit an image task.
     *
     * @param {ImageTask} task - Image task
     * @returns {Promise<TaskResult>}
     */
    async submitImage(task) {
        return this.submitTask(task);
    }

    /**
     * Submit a content-stream task.
     *
     * @param {ContentStreamTask} task - Content-stream task
     * @returns {Promise<TaskResult>}
     */
    async submitContentStream(task) {
        return this.submitTask(task);
    }

    /**
     * Submit multiple tasks and wait for all to complete.
     *
     * @param {WorkerTask[]} tasks - Tasks to execute
     * @returns {Promise<TaskResult[]>}
     */
    async submitAll(tasks) {
        return Promise.all(tasks.map(task => this.submitTask(task)));
    }

    /**
     * Get worker pool statistics.
     * @returns {WorkerPoolStats}
     */
    getStats() {
        return {
            workerCount: this.#workers.length,
            busyWorkers: this.#workers.filter(w => w.busy).length,
            queueLength: this.#taskQueue.length,
            totalTasks: this.#workers.reduce((sum, w) => sum + w.taskCount, 0),
        };
    }

    /**
     * Whether the pool has been initialized.
     * @returns {boolean}
     */
    get isInitialized() {
        return this.#initialized;
    }

    /**
     * Whether diagnostics collection is enabled.
     * @returns {boolean}
     */
    get diagnosticsEnabled() {
        return this.#diagnosticsEnabled;
    }

    /**
     * Get diagnostics ports for all workers.
     * Use these ports to register with MainDiagnosticsCollector.
     *
     * @returns {Array<{workerId: string, port: MessagePort}>}
     *
     * @example
     * ```javascript
     * const pool = new WorkerPool({ diagnosticsEnabled: true });
     * await pool.initialize();
     *
     * for (const { workerId, port } of pool.getDiagnosticsPorts()) {
     *     mainDiagnostics.registerAuxiliary(workerId, port);
     * }
     * ```
     */
    getDiagnosticsPorts() {
        if (!this.#diagnosticsEnabled) {
            return [];
        }
        return this.#workers
            .filter(w => w.diagnosticsPort)
            .map(w => ({
                workerId: `worker-${w.id}`,
                port: /** @type {MessagePort} */ (w.diagnosticsPort),
            }));
    }

    // ========================================
    // Cleanup
    // ========================================

    /**
     * Terminate all workers and clean up resources.
     * @returns {Promise<void>}
     */
    async terminate() {
        for (const workerInfo of this.#workers) {
            // Close diagnostics port
            if (workerInfo.diagnosticsPort) {
                workerInfo.diagnosticsPort.close();
            }

            // Terminate worker
            if (this.#environment === 'node') {
                await /** @type {import('worker_threads').Worker} */ (workerInfo.worker).terminate();
            } else {
                /** @type {Worker} */ (workerInfo.worker).terminate();
            }
        }

        // Clear state
        this.#workers = [];
        this.#taskQueue = [];
        this.#pendingTasks.clear();
        this.#initialized = false;
    }
}

// ============================================================================
// Benchmarking Utility
// ============================================================================

/**
 * Run benchmark to determine optimal worker count.
 *
 * @param {object} [options]
 * @param {number} [options.maxWorkers] - Maximum workers to test
 * @param {number} [options.iterations] - Iterations per worker count
 * @param {number} [options.arraySize] - Array size for benchmark
 * @returns {Promise<{optimalWorkers: number, results: Array<{workers: number, avgTime: number}>}>}
 */
export async function benchmarkOptimalWorkerCount(options = {}) {
    const maxWorkers = options.maxWorkers || getDefaultWorkerCount() * 2;
    const iterations = options.iterations || 10;
    const arraySize = options.arraySize || 10000;

    const results = [];

    console.log(`Benchmarking worker counts from 1 to ${maxWorkers}...`);

    for (let workerCount = 1; workerCount <= maxWorkers; workerCount++) {
        const pool = new WorkerPool({ workerCount });
        await pool.initialize();

        const times = [];

        for (let i = 0; i < iterations; i++) {
            const start = performance.now();

            // Split into chunks for parallel processing
            const chunkSize = Math.ceil(arraySize / workerCount);
            const tasks = [];

            for (let c = 0; c < workerCount; c++) {
                tasks.push({
                    type: /** @type {const} */ ('benchmark'),
                    iterations: 1,
                    arraySize: chunkSize,
                });
            }

            await pool.submitAll(tasks);

            times.push(performance.now() - start);
        }

        await pool.terminate();

        const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
        results.push({ workers: workerCount, avgTime });

        console.log(`  ${workerCount} worker(s): ${avgTime.toFixed(2)}ms avg`);
    }

    // Find optimal (lowest average time)
    const optimal = results.reduce((best, curr) =>
        curr.avgTime < best.avgTime ? curr : best
    );

    console.log(`\nOptimal worker count: ${optimal.workers} (${optimal.avgTime.toFixed(2)}ms)`);

    return {
        optimalWorkers: optimal.workers,
        results,
    };
}

export default WorkerPool;
