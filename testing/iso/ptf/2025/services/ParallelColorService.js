// @ts-check
/**
 * Parallel Color Conversion Service
 * Page-level parallelization for PDF color conversion
 *
 * Key insights from benchmarking:
 * - Transform throughput: ~35M pixels/second
 * - ColorEngine init: ~2.5ms per worker
 * - Page-level parallelization is optimal (not image-level)
 *
 * @module ParallelColorService
 */

/**
 * @typedef {{
 *   workerCount?: number,
 *   onProgress?: (progress: {completed: number, total: number, currentPage?: number}) => void,
 * }} ParallelOptions
 */

/**
 * @typedef {{
 *   pageIndex: number,
 *   contentColors?: Array<{operator: string, values: number[], colorSpace: string}>,
 *   images?: Array<{pixels: Uint8Array, width: number, height: number, colorSpace: string, bitsPerComponent: number}>,
 * }} PageColorData
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
 * Get CPU count (cached)
 * @returns {Promise<number>}
 */
async function getCpuCount() {
    if (cachedCpuCount !== null) return cachedCpuCount;

    const env = detectEnvironment();
    if (env === 'node') {
        const os = await import('os');
        cachedCpuCount = os.cpus().length;
    } else {
        cachedCpuCount = navigator.hardwareConcurrency || 4;
    }
    return cachedCpuCount;
}

/**
 * Get recommended worker count based on hardware and workload
 * @param {number} pageCount - Number of pages to process
 * @returns {Promise<number>}
 */
export async function getRecommendedWorkerCount(pageCount) {
    const cpuCount = await getCpuCount();

    // Use at most half the CPUs (leave room for main thread)
    // But no more workers than pages
    const maxWorkers = Math.floor(cpuCount / 2);
    return Math.min(Math.max(1, maxWorkers), pageCount);
}

/**
 * Simple page-level parallel processor
 * Processes pages in parallel using a pool of worker promises
 *
 * @template T
 * @param {T[]} items - Items to process
 * @param {(item: T, index: number) => Promise<any>} processor - Async processor function
 * @param {number} concurrency - Number of concurrent workers
 * @param {(completed: number, total: number) => void} [onProgress] - Progress callback
 * @returns {Promise<any[]>}
 */
export async function parallelProcess(items, processor, concurrency, onProgress) {
    const results = new Array(items.length);
    let nextIndex = 0;
    let completed = 0;

    const worker = async () => {
        while (nextIndex < items.length) {
            const index = nextIndex++;
            const item = items[index];

            try {
                results[index] = await processor(item, index);
            } catch (error) {
                results[index] = { error: error.message };
            }

            completed++;
            if (onProgress) {
                onProgress(completed, items.length);
            }
        }
    };

    // Start concurrent workers
    const workers = Array(Math.min(concurrency, items.length))
        .fill(null)
        .map(() => worker());

    await Promise.all(workers);

    return results;
}

/**
 * Parallel page processor for PDF color conversion
 * Uses page-level parallelization for optimal performance
 */
export class ParallelColorService {
    /** @type {number} */
    #workerCount;

    /** @type {Function | undefined} */
    #onProgress;

    /**
     * Create a new ParallelColorService
     * @param {ParallelOptions} [options]
     */
    constructor(options = {}) {
        this.#workerCount = options.workerCount || getRecommendedWorkerCount(28);
        this.#onProgress = options.onProgress;
    }

    /**
     * Process pages in parallel
     * @template T
     * @param {T[]} pages - Page data to process
     * @param {(page: T, index: number) => Promise<any>} processor - Page processor function
     * @returns {Promise<any[]>}
     */
    async processPages(pages, processor) {
        return parallelProcess(
            pages,
            processor,
            this.#workerCount,
            this.#onProgress ? (completed, total) => {
                this.#onProgress({ completed, total });
            } : undefined
        );
    }

    /**
     * Get worker count
     * @returns {number}
     */
    get workerCount() {
        return this.#workerCount;
    }
}

/**
 * Run a simple benchmark to determine optimal worker count for current environment
 * @param {object} [options]
 * @param {number} [options.testIterations] - Number of test iterations
 * @returns {Promise<{optimalWorkers: number, results: Array<{workers: number, avgTime: number}>}>}
 */
export async function benchmarkOptimalWorkers(options = {}) {
    const iterations = options.testIterations || 3;
    const env = detectEnvironment();

    let maxWorkers;
    if (env === 'node') {
        const os = require('os');
        maxWorkers = Math.min(os.cpus().length, 8);
    } else {
        maxWorkers = Math.min(navigator.hardwareConcurrency || 4, 8);
    }

    console.log(`Benchmarking worker counts from 1 to ${maxWorkers}...`);

    const results = [];

    // Create test workload - simulate 28 pages with random delays
    const simulatePageWork = () => new Promise(resolve => {
        // Simulate ~100ms of work per page
        const delay = 80 + Math.random() * 40;
        setTimeout(resolve, delay);
    });

    const testPages = Array(28).fill(null);

    for (let workers = 1; workers <= maxWorkers; workers++) {
        const times = [];

        for (let i = 0; i < iterations; i++) {
            const start = performance.now();
            await parallelProcess(testPages, simulatePageWork, workers);
            times.push(performance.now() - start);
        }

        const avgTime = times.reduce((a, b) => a + b, 0) / iterations;
        results.push({ workers, avgTime });
        console.log(`  ${workers} worker(s): ${avgTime.toFixed(0)}ms avg`);
    }

    const optimal = results.reduce((best, curr) =>
        curr.avgTime < best.avgTime ? curr : best
    );

    console.log(`\nOptimal worker count: ${optimal.workers} (${optimal.avgTime.toFixed(0)}ms)`);

    return { optimalWorkers: optimal.workers, results };
}

export default ParallelColorService;
