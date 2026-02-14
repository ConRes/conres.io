// @ts-check
/**
 * Worker Pool Entrypoint
 *
 * Worker script for classes/worker-pool.js that uses ColorConverter classes
 * for consistent behavior between main thread and workers.
 *
 * Self-contained in classes/ - no dependencies on services/.
 *
 * @module WorkerPoolEntrypoint
 */

// ============================================================================
// Environment Detection
// ============================================================================

const IS_NODE = typeof process !== 'undefined' && process.versions?.node;

// ============================================================================
// Module Resolution
// ============================================================================

/**
 * Module record for caching dynamic imports.
 * @template T
 * @typedef {{
 *   specifier: string,
 *   location: string,
 *   promise: Promise<T>,
 * }} ModuleRecord
 */

/** @type {Map<string, ModuleRecord<any>>} */
const moduleCache = new Map();

/**
 * Import a module with caching.
 * @template T
 * @param {string} specifier - Module specifier
 * @returns {Promise<T>}
 */
async function importModule(specifier) {
    const cacheKey = specifier.toLowerCase();
    if (moduleCache.has(cacheKey)) {
        return moduleCache.get(cacheKey).promise;
    }

    const location = import.meta.resolve(specifier);
    const promise = import(location);

    moduleCache.set(cacheKey, {
        specifier,
        location,
        promise,
    });

    return promise;
}

// ============================================================================
// Worker Configuration
// ============================================================================

/**
 * Worker configuration from workerData (Node.js only).
 * @type {{ colorEnginePath?: string, workerId?: string, diagnosticsEnabled?: boolean } | null}
 */
let workerConfig = null;

if (IS_NODE) {
    try {
        const { workerData } = await import('worker_threads');
        workerConfig = workerData || null;
    } catch {
        // Not in worker context
    }
}

// ============================================================================
// Lazy Module References
// ============================================================================

/** @type {import('./color-engine-provider.js').ColorEngineProvider | null} */
let colorEngineProvider = null;

/** @type {typeof import('pako') | null} */
let pako = null;

/** @type {typeof import('zlib') | null} */
let zlib = null;

/** @type {string | undefined} */
let engineVersion = undefined;

/** @type {import('./auxiliary-diagnostics-collector.js').AuxiliaryDiagnosticsCollector | null} */
let diagnostics = null;

// ============================================================================
// Shared Profile Cache (sent once via 'shared-config', reused across tasks)
// ============================================================================

/** @type {{ destinationProfile?: ArrayBuffer, intermediateProfiles?: (ArrayBuffer | 'Lab')[], renderingIntent?: string, blackPointCompensation?: boolean, useAdaptiveBPCClamping?: boolean, destinationColorSpace?: string } | null} */
let sharedConfig = null;

// ============================================================================
// Initialization
// ============================================================================

/**
 * Initialize compression library.
 */
async function initCompression() {
    if (pako || zlib) return;

    if (IS_NODE) {
        zlib = await importModule('zlib');
    } else {
        pako = await importModule('../../packages/pako/dist/pako.mjs');
    }
}

/**
 * Initialize ColorEngineProvider.
 */
async function initColorEngineProvider() {
    if (colorEngineProvider?.isReady) return;

    const { ColorEngineProvider, DEFAULT_ENGINE_PATH } = await importModule('./color-engine-provider.js');

    // Determine engine path
    // The colorEnginePath is relative to the experiments directory (e.g., "../../packages/color-engine-2026-01-30")
    // From the classes directory (where this worker runs), that same path works since both are in 2025/
    let enginePath = DEFAULT_ENGINE_PATH;
    if (workerConfig?.colorEnginePath) {
        enginePath = `${workerConfig.colorEnginePath}/src/index.js`;
    }

    colorEngineProvider = new ColorEngineProvider({ enginePath });
    await colorEngineProvider.initialize();

    // Derive engine version from the actually loaded module, not the symlink
    engineVersion = `color-engine-${colorEngineProvider.module.VERSION}`;
}

/**
 * Initialize diagnostics collector.
 * @param {MessagePort} port - Port for sending diagnostics
 * @param {string} workerId - Unique worker identifier
 */
async function initDiagnostics(port, workerId) {
    try {
        const { AuxiliaryDiagnosticsCollector } = await importModule('./auxiliary-diagnostics-collector.js');
        diagnostics = new AuxiliaryDiagnosticsCollector({
            workerId,
            port,
            enabled: true,
        });
    } catch (e) {
        console.warn('[WorkerPoolEntrypoint] Failed to initialize diagnostics:', /** @type {Error} */ (e).message);
    }
}

// ============================================================================
// Compression Utilities
// ============================================================================

/**
 * Inflate compressed data.
 * @param {Uint8Array} data - Compressed data
 * @returns {Uint8Array} Decompressed data
 */
function inflate(data) {
    if (pako) {
        return new Uint8Array(pako.inflate(data));
    }
    if (zlib) {
        return new Uint8Array(zlib.inflateSync(data));
    }
    throw new Error('No compression library available');
}

/**
 * Deflate data.
 * @param {Uint8Array} data - Uncompressed data
 * @returns {Uint8Array} Compressed data
 */
function deflate(data) {
    if (pako) {
        return new Uint8Array(pako.deflate(data));
    }
    if (zlib) {
        return new Uint8Array(zlib.deflateSync(data));
    }
    throw new Error('No compression library available');
}

// ============================================================================
// Task Handlers
// ============================================================================

/**
 * Process an image task using ImageColorConverter.
 *
 * @param {import('./worker-pool.js').ImageTask & { taskId: number }} task
 * @returns {Promise<import('./worker-pool.js').TaskResult>}
 */
async function processImage(task) {
    await initColorEngineProvider();

    const start = performance.now();

    try {
        const { PDFImageColorConverter } = await importModule('./pdf-image-color-converter.js');

        // Create converter with task configuration, falling back to shared config for profiles
        const converter = new PDFImageColorConverter({
            renderingIntent: task.renderingIntent ?? sharedConfig?.renderingIntent,
            blackPointCompensation: task.blackPointCompensation ?? sharedConfig?.blackPointCompensation,
            useAdaptiveBPCClamping: task.useAdaptiveBPCClamping ?? sharedConfig?.useAdaptiveBPCClamping,
            destinationProfile: task.destinationProfile ?? sharedConfig?.destinationProfile,
            destinationColorSpace: task.destinationColorSpace ?? sharedConfig?.destinationColorSpace,
            inputType: task.colorSpace,
            outputBitsPerComponent: task.outputBitsPerComponent,
            outputEndianness: task.outputEndianness,
            compressOutput: true,
            verbose: task.verbose ?? false,
            intermediateProfiles: task.intermediateProfiles ?? sharedConfig?.intermediateProfiles,
        }, {
            colorEngineProvider,
            engineVersion,
        });

        // Convert using PDFImageColorConverter (handles decompression/compression internally)
        const span = diagnostics?.startSpan('image-convert', {
            width: task.width,
            height: task.height,
            colorSpace: task.colorSpace,
            bitsPerComponent: task.bitsPerComponent,
        });

        try {
            const result = await converter.convertColor({
                streamRef: task.streamRef || 'worker-task',
                streamData: new Uint8Array(task.compressedData || task.pixelBuffer),
                isCompressed: task.isCompressed ?? false,
                width: task.width,
                height: task.height,
                colorSpace: task.colorSpace,
                bitsPerComponent: task.bitsPerComponent,
                inputBitsPerComponent: task.inputBitsPerComponent,
                outputBitsPerComponent: task.outputBitsPerComponent,
                endianness: task.endianness,
                inputEndianness: task.inputEndianness,
                outputEndianness: task.outputEndianness,
                sourceProfile: task.sourceProfile,
            });

            if (span) {
                diagnostics?.updateSpan(span, {
                    pixelCount: result.pixelCount,
                    outputSize: result.streamData.length,
                    isCompressed: result.isCompressed,
                });
            }

            // Don't dispose converter - it shares colorEngineProvider

            return {
                success: true,
                taskId: task.taskId,
                pixelBuffer: result.streamData, // PDFImageColorConverter returns streamData
                pixelCount: result.pixelCount,
                bitsPerComponent: result.bitsPerComponent,
                isCompressed: result.isCompressed,
                duration: performance.now() - start,
            };
        } finally {
            if (span) {
                diagnostics?.endSpan(span);
            }
        }
    } catch (error) {
        console.error('[WorkerPoolEntrypoint] processImage error:', error);
        return {
            success: false,
            taskId: task.taskId,
            error: /** @type {Error} */ (error).message,
            duration: performance.now() - start,
        };
    }
}

/**
 * Process a content-stream task using PDFContentStreamColorConverter.
 *
 * @param {import('./worker-pool.js').ContentStreamTask & { taskId: number }} task
 * @returns {Promise<import('./worker-pool.js').TaskResult>}
 */
async function processContentStream(task) {
    await initColorEngineProvider();

    const start = performance.now();

    try {
        const { PDFContentStreamColorConverter } = await importModule('./pdf-content-stream-color-converter.js');

        // Create converter with task configuration, falling back to shared config for profiles
        const converter = new PDFContentStreamColorConverter({
            renderingIntent: task.renderingIntent ?? sharedConfig?.renderingIntent,
            blackPointCompensation: task.blackPointCompensation ?? sharedConfig?.blackPointCompensation,
            useAdaptiveBPCClamping: false, // Not used for content streams
            destinationProfile: task.destinationProfile ?? sharedConfig?.destinationProfile,
            destinationColorSpace: task.destinationColorSpace ?? sharedConfig?.destinationColorSpace,
            sourceRGBProfile: task.sourceRGBProfile,
            sourceGrayProfile: task.sourceGrayProfile,
            colorSpaceDefinitions: task.colorSpaceDefinitions,
            verbose: task.verbose ?? false,
            intermediateProfiles: task.intermediateProfiles ?? sharedConfig?.intermediateProfiles,
        }, {
            colorEngineProvider,
            engineVersion,
        });

        // Convert using PDFContentStreamColorConverter
        const span = diagnostics?.startSpan('content-stream-convert', {
            streamLength: task.streamText.length,
            colorSpaceCount: task.colorSpaceDefinitions ? Object.keys(task.colorSpaceDefinitions).length : 0,
        });

        try {
            const result = await converter.convertColor({
                streamRef: `worker-task-${task.taskId}`,
                streamText: task.streamText,
                colorSpaceDefinitions: task.colorSpaceDefinitions,
                initialColorSpaceState: task.initialColorSpaceState,
            });

            if (span) {
                diagnostics?.updateSpan(span, {
                    outputLength: result.newText.length,
                    replacementCount: result.replacementCount,
                    colorConversions: result.colorConversions,
                });
            }

            // Don't dispose converter - it shares colorEngineProvider

            return {
                success: true,
                taskId: task.taskId,
                newText: result.newText,
                replacementCount: result.replacementCount,
                finalColorSpaceState: result.finalColorSpaceState,
                duration: performance.now() - start,
            };
        } finally {
            if (span) {
                diagnostics?.endSpan(span);
            }
        }
    } catch (error) {
        return {
            success: false,
            taskId: task.taskId,
            error: /** @type {Error} */ (error).message,
            duration: performance.now() - start,
        };
    }
}

/**
 * Process a transform task (raw pixel buffer).
 *
 * @param {import('./worker-pool.js').TransformTask & { taskId: number }} task
 * @returns {Promise<import('./worker-pool.js').TaskResult>}
 */
async function processTransform(task) {
    await initColorEngineProvider();

    const start = performance.now();

    try {
        if (!colorEngineProvider) {
            throw new Error('ColorEngineProvider not initialized');
        }

        // Open profiles
        const srcHandle = task.sourceProfile === 'Lab'
            ? colorEngineProvider.createLab4Profile()
            : colorEngineProvider.openProfileFromMem(task.sourceProfile);

        const dstHandle = colorEngineProvider.openProfileFromMem(task.destinationProfile);

        // Create transform
        const transform = colorEngineProvider.createTransform(
            srcHandle,
            task.inputFormat,
            dstHandle,
            task.outputFormat,
            task.renderingIntent,
            task.flags
        );

        // Create output buffer
        const outputPixels = new Uint8Array(task.pixelCount * task.outputComponentsPerPixel);

        // Transform
        const span = diagnostics?.startSpan('transform', {
            pixelCount: task.pixelCount,
            inputFormat: task.inputFormat,
            outputFormat: task.outputFormat,
        });

        try {
            colorEngineProvider.transformArray(transform, task.inputArray, outputPixels, task.pixelCount);

            if (span) {
                diagnostics?.updateSpan(span, {
                    outputSize: outputPixels.length,
                });
            }
        } finally {
            if (span) {
                diagnostics?.endSpan(span);
            }
        }

        // Clean up
        colorEngineProvider.deleteTransform(transform);
        colorEngineProvider.closeProfile(srcHandle);
        colorEngineProvider.closeProfile(dstHandle);

        return {
            success: true,
            taskId: task.taskId,
            outputArray: outputPixels,
            duration: performance.now() - start,
        };
    } catch (error) {
        return {
            success: false,
            taskId: task.taskId,
            error: /** @type {Error} */ (error).message,
            duration: performance.now() - start,
        };
    }
}

/**
 * Process a benchmark task.
 *
 * @param {import('./worker-pool.js').BenchmarkTask & { taskId: number }} task
 * @returns {Promise<import('./worker-pool.js').TaskResult>}
 */
async function processBenchmark(task) {
    await initCompression();
    await initColorEngineProvider();

    const start = performance.now();

    try {
        // Simple benchmark: just measure initialization time
        // Real benchmark would test actual conversions

        return {
            success: true,
            taskId: task.taskId,
            duration: performance.now() - start,
        };
    } catch (error) {
        return {
            success: false,
            taskId: task.taskId,
            error: /** @type {Error} */ (error).message,
            duration: performance.now() - start,
        };
    }
}

// ============================================================================
// Message Handler
// ============================================================================

/**
 * Handle incoming message.
 * @param {object} task - Task to process
 */
async function handleMessage(task) {
    // Handle diagnostics port setup
    if (task.type === 'diagnostics-port') {
        await initDiagnostics(task.port, task.workerId);
        return; // No response needed
    }

    // Handle shared profile cache (sent once, reused across tasks)
    if (task.type === 'shared-config') {
        sharedConfig = {
            destinationProfile: task.destinationProfile,
            intermediateProfiles: task.intermediateProfiles,
            renderingIntent: task.renderingIntent,
            blackPointCompensation: task.blackPointCompensation,
            useAdaptiveBPCClamping: task.useAdaptiveBPCClamping,
            destinationColorSpace: task.destinationColorSpace,
        };
        return; // No response needed
    }

    /** @type {import('./worker-pool.js').TaskResult} */
    let result;

    // Wrap task in diagnostic span
    const taskSpan = diagnostics?.startSpan('worker-task', {
        type: task.type,
        taskId: task.taskId,
    });

    try {
        switch (task.type) {
            case 'image':
                result = await processImage(task);
                break;
            case 'content-stream':
                result = await processContentStream(task);
                break;
            case 'transform':
                result = await processTransform(task);
                break;
            case 'benchmark':
                result = await processBenchmark(task);
                break;
            case 'init':
                // Pre-initialize
                await initCompression();
                await initColorEngineProvider();
                result = {
                    success: true,
                    taskId: task.taskId,
                };
                break;
            default:
                result = {
                    success: false,
                    taskId: task.taskId,
                    error: `Unknown task type: ${task.type}`,
                };
        }

        if (taskSpan) {
            diagnostics?.updateSpan(taskSpan, {
                success: result.success ? 1 : 0,
                duration: result.duration || 0,
            });
        }
    } finally {
        if (taskSpan) {
            diagnostics?.endSpan(taskSpan);
        }
    }

    // Send result
    sendResult(result);
}

/**
 * Send result back to main thread.
 * @param {import('./worker-pool.js').TaskResult} result
 */
async function sendResult(result) {
    // Collect transferable buffers for efficient transfer
    const transferables = [];
    if (result.outputArray?.buffer) {
        transferables.push(result.outputArray.buffer);
    }
    if (result.pixelBuffer instanceof Uint8Array && result.pixelBuffer.buffer) {
        transferables.push(result.pixelBuffer.buffer);
    }

    if (IS_NODE) {
        const { parentPort } = await import('worker_threads');
        parentPort?.postMessage(result, transferables);
    } else {
        self.postMessage(result, { transfer: transferables });
    }
}

// ============================================================================
// Worker Setup
// ============================================================================

if (IS_NODE) {
    import('worker_threads').then(({ parentPort }) => {
        parentPort?.on('message', handleMessage);
        parentPort?.postMessage({ type: 'ready' });
    });
} else {
    self.onmessage = (event) => {
        handleMessage(event.data);
    };
    self.postMessage({ type: 'ready' });
}

export {};
