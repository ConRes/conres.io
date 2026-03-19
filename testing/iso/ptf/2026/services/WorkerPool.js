// @ts-check
/**
 * Isomorphic Worker Pool for parallel color transformations
 * Works in both Node.js (worker_threads) and browser (Web Workers)
 *
 * @module WorkerPool
 */

/**
 * @typedef {{
 *   id: number,
 *   worker: Worker | import('worker_threads').Worker,
 *   busy: boolean,
 *   taskCount: number,
 *   diagnosticsPort?: MessagePort,
 * }} WorkerInfo
 */

/**
 * @typedef {{
 *   type: 'transform',
 *   inputArray: Uint8Array | Float32Array,
 *   inputFormat: number,
 *   outputFormat: number,
 *   outputComponentsPerPixel: number,
 *   pixelCount: number,
 *   sourceProfile: ArrayBuffer | 'sRGB' | 'sGray' | 'Lab',
 *   destinationProfile: ArrayBuffer,
 *   renderingIntent: number,
 *   flags: number,
 * }} TransformTask
 */

/**
 * @typedef {{
 *   type: 'benchmark',
 *   iterations: number,
 *   arraySize: number,
 * }} BenchmarkTask
 */

/**
 * @typedef {{
 *   success: boolean,
 *   outputArray?: Uint8Array | Float32Array,
 *   error?: string,
 *   duration?: number,
 * }} TaskResult
 */

/**
 * Detect runtime environment
 * @returns {'node' | 'browser'}
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
 * Get estimated optimal worker count based on hardware
 * @returns {number}
 */
export function getDefaultWorkerCount() {
    const env = detectEnvironment();
    if (env === 'node') {
        // In Node.js, we've already cached the CPU count at module load
        if (cachedCpuCount !== null) {
            return Math.max(1, Math.floor(cachedCpuCount / 2));
        }
        // Fallback if not cached yet (shouldn't happen after module init)
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
        // Fallback if import fails
        cachedCpuCount = 8;
    });
}

/**
 * Worker Pool for parallel color transformations
 */
export class WorkerPool {
    /** @type {WorkerInfo[]} */
    #workers = [];

    /** @type {Array<{task: TransformTask | BenchmarkTask, resolve: Function, reject: Function}>} */
    #taskQueue = [];

    /** @type {boolean} */
    #initialized = false;

    /** @type {'node' | 'browser'} */
    #environment;

    /** @type {number} */
    #workerCount;

    /** @type {string | URL} */
    #workerScript;

    /** @type {string | null} */
    #colorEnginePath;

    /** @type {boolean} */
    #diagnosticsEnabled;

    /**
     * Create a new WorkerPool
     * @param {object} [options]
     * @param {number} [options.workerCount] - Number of workers (default: auto-detect)
     * @param {string | URL} [options.workerScript] - Path to worker script
     * @param {string} [options.colorEnginePath] - Path to color engine package (e.g., 'packages/color-engine-2026-01-21')
     * @param {boolean} [options.diagnosticsEnabled] - Enable diagnostics collection via MessageChannel
     */
    constructor(options = {}) {
        this.#environment = detectEnvironment();
        this.#workerCount = options.workerCount || getDefaultWorkerCount();
        this.#workerScript = options.workerScript || this.#getDefaultWorkerScript();
        this.#colorEnginePath = options.colorEnginePath || null;
        this.#diagnosticsEnabled = options.diagnosticsEnabled || false;
    }

    /**
     * Get default worker script path
     * Uses StreamTransformWorker.js which handles image and content-stream tasks
     * @returns {string}
     */
    #getDefaultWorkerScript() {
        if (this.#environment === 'node') {
            return new URL('./StreamTransformWorker.js', import.meta.url).pathname;
        }
        return new URL('./StreamTransformWorker.js', import.meta.url).href;
    }

    /**
     * Initialize the worker pool
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
     * Create a single worker
     * @param {number} id
     * @returns {Promise<WorkerInfo>}
     */
    async #createWorker(id) {
        /** @type {Worker | import('worker_threads').Worker} */
        let worker;
        /** @type {MessagePort | undefined} */
        let diagnosticsPort;

        // Create MessageChannel for diagnostics if enabled
        /** @type {MessagePort | undefined} */
        let workerDiagnosticsPort;
        if (this.#diagnosticsEnabled) {
            const { port1, port2 } = new MessageChannel();
            diagnosticsPort = port1;      // Main thread port (for MainDiagnosticsCollector)
            workerDiagnosticsPort = port2; // Worker port (for AuxiliaryDiagnosticsCollector)
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
            // Diagnostics port will be sent after worker is ready
        } else {
            worker = new Worker(this.#workerScript, { type: 'module' });
            // Diagnostics port will be sent after worker is ready
        }

        const workerInfo = {
            id,
            worker,
            busy: false,
            taskCount: 0,
            diagnosticsPort,
        };

        // Set up message handler
        if (this.#environment === 'node') {
            /** @type {import('worker_threads').Worker} */ (worker).on('message', (result) => {
                this.#handleWorkerResult(workerInfo, result);
            });
            /** @type {import('worker_threads').Worker} */ (worker).on('error', (error) => {
                this.#handleWorkerError(workerInfo, error);
            });
        } else {
            /** @type {Worker} */ (worker).onmessage = (event) => {
                this.#handleWorkerResult(workerInfo, event.data);
            };
            /** @type {Worker} */ (worker).onerror = (event) => {
                this.#handleWorkerError(workerInfo, new Error(event.message));
            };
        }

        // Wait for worker to be ready, then send diagnostics port if enabled
        await this.#waitForWorkerReady(worker, workerDiagnosticsPort, id);

        return workerInfo;
    }

    /**
     * Wait for worker to signal ready
     * @param {Worker | import('worker_threads').Worker} worker
     * @param {MessagePort} [workerDiagnosticsPort] - Port to send to browser workers
     * @param {number} [workerId] - Worker ID for diagnostics
     * @returns {Promise<void>}
     */
    #waitForWorkerReady(worker, workerDiagnosticsPort, workerId) {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Worker initialization timeout'));
            }, 10000);

            const handler = (/** @type {any} */ data) => {
                const msg = this.#environment === 'node' ? data : data.data;
                if (msg?.type === 'ready') {
                    clearTimeout(timeout);
                    // For browser workers, send diagnostics port after ready
                    if (this.#environment !== 'node' && workerDiagnosticsPort) {
                        /** @type {Worker} */ (worker).postMessage(
                            { type: 'diagnostics-port', port: workerDiagnosticsPort, workerId: `worker-${workerId}` },
                            [workerDiagnosticsPort]
                        );
                    }
                    resolve();
                }
            };

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
                        // For browser workers, send diagnostics port after ready
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

    /** @type {Map<number, {resolve: Function, reject: Function}>} */
    #pendingTasks = new Map();

    /** @type {number} */
    #taskIdCounter = 0;

    /**
     * Handle worker result
     * @param {WorkerInfo} workerInfo
     * @param {any} result
     */
    #handleWorkerResult(workerInfo, result) {
        if (result.taskId !== undefined && this.#pendingTasks.has(result.taskId)) {
            const { resolve, reject } = this.#pendingTasks.get(result.taskId);
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
     * Handle worker error
     * @param {WorkerInfo} workerInfo
     * @param {Error} error
     */
    #handleWorkerError(workerInfo, error) {
        console.error(`Worker ${workerInfo.id} error:`, error);
        workerInfo.busy = false;
        this.#processQueue();
    }

    /**
     * Process queued tasks
     */
    #processQueue() {
        if (this.#taskQueue.length === 0) return;

        const availableWorker = this.#workers.find(w => !w.busy);
        if (!availableWorker) return;

        const { task, resolve, reject } = this.#taskQueue.shift();
        this.#executeTask(availableWorker, task, resolve, reject);
    }

    /**
     * Execute a task on a specific worker
     * @param {WorkerInfo} workerInfo
     * @param {TransformTask | BenchmarkTask} task
     * @param {Function} resolve
     * @param {Function} reject
     */
    #executeTask(workerInfo, task, resolve, reject) {
        workerInfo.busy = true;
        workerInfo.taskCount++;

        const taskId = this.#taskIdCounter++;
        this.#pendingTasks.set(taskId, { resolve, reject });

        const message = { ...task, taskId };

        if (this.#environment === 'node') {
            /** @type {import('worker_threads').Worker} */ (workerInfo.worker).postMessage(message);
        } else {
            // For browser, transfer arrays for better performance
            const transferables = [];
            if (task.type === 'transform' && task.inputArray?.buffer) {
                // Don't transfer - we may need the array later
                // transferables.push(task.inputArray.buffer);
            }
            /** @type {Worker} */ (workerInfo.worker).postMessage(message, transferables);
        }
    }

    /**
     * Submit a color transformation task
     * @param {TransformTask} task
     * @returns {Promise<TaskResult>}
     */
    async submitTransform(task) {
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
     * Submit multiple transform tasks and wait for all to complete
     * @param {TransformTask[]} tasks
     * @returns {Promise<TaskResult[]>}
     */
    async submitAll(tasks) {
        return Promise.all(tasks.map(task => this.submitTransform(task)));
    }

    /**
     * Get worker statistics
     * @returns {{workerCount: number, busyWorkers: number, queueLength: number, totalTasks: number}}
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
     * Whether diagnostics collection is enabled for this pool.
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

    /**
     * Terminate all workers
     */
    async terminate() {
        for (const workerInfo of this.#workers) {
            if (this.#environment === 'node') {
                await /** @type {import('worker_threads').Worker} */ (workerInfo.worker).terminate();
            } else {
                /** @type {Worker} */ (workerInfo.worker).terminate();
            }
        }
        this.#workers = [];
        this.#initialized = false;
    }
}

/**
 * Run benchmark to determine optimal worker count
 * @param {object} [options]
 * @param {number} [options.maxWorkers] - Maximum workers to test
 * @param {number} [options.iterations] - Iterations per worker count
 * @param {number} [options.arraySize] - Array size for benchmark
 * @returns {Promise<{optimalWorkers: number, results: Array<{workers: number, avgTime: number}>}>}
 */
export async function benchmarkOptimalWorkerCount(options = {}) {
    const maxWorkers = options.maxWorkers || getDefaultWorkerCount() * 2;
    const iterations = options.iterations || 10;
    const arraySize = options.arraySize || 10000; // 10K pixels

    const results = [];

    console.log(`Benchmarking worker counts from 1 to ${maxWorkers}...`);

    for (let workerCount = 1; workerCount <= maxWorkers; workerCount++) {
        const pool = new WorkerPool({ workerCount });
        await pool.initialize();

        const times = [];

        for (let i = 0; i < iterations; i++) {
            // Create random input array
            const inputArray = new Uint8Array(arraySize * 3); // RGB
            for (let j = 0; j < inputArray.length; j++) {
                inputArray[j] = Math.floor(Math.random() * 256);
            }

            const start = performance.now();

            // Split into chunks for parallel processing
            const chunkSize = Math.ceil(arraySize / workerCount);
            const tasks = [];

            for (let c = 0; c < workerCount; c++) {
                const startIdx = c * chunkSize * 3;
                const endIdx = Math.min(startIdx + chunkSize * 3, inputArray.length);
                const chunk = inputArray.slice(startIdx, endIdx);

                tasks.push({
                    type: /** @type {const} */ ('benchmark'),
                    iterations: 1,
                    arraySize: chunk.length / 3,
                });
            }

            await pool.submitAll(/** @type {any} */ (tasks));

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
