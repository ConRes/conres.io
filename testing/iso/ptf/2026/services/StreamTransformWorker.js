// @ts-check
/**
 * Stream Transform Worker
 * Handles inflate → color transform → deflate in a single worker
 * Keeps data compressed during transfer to minimize message overhead
 *
 * @module StreamTransformWorker
 */

// Detect environment
const IS_NODE = typeof process !== 'undefined' && process.versions?.node;

/** 
 * @template {{}} Namespace 
 * @template  {string} Specifier
 * @typedef {Record<string, { specifier: Specifier, location: string, promise: Promise<Namespace> }>} ModuleRecord
 */

/** @type {{ [K in string]?: ModuleRecord<any, K> }} */
const moduleRecords = {};


/**
 * @param {string} specifier 
 */
const importModuleRecord = (specifier) => {
    const location = import.meta.resolve(specifier);

    return moduleRecords[location.toLowerCase()] ??= moduleRecords[specifier.toLowerCase()] ??= /** @type {any} */ ({
        specifier,
        location,
        promise: import(location),
    });
};

const modulePromises = {
    /** @type {Promise<typeof import('pako') ?>} */
    pako: IS_NODE ? undefined : importModuleRecord('../packages/pako/dist/pako.mjs').promise,
    /** @type {Promise<typeof import('zlib')> | undefined} */
    zlib: IS_NODE ? importModuleRecord('zlib').promise : undefined,
    /** @type {Promise<import('./ColorConversionUtils.js')>} */
    './ColorConversionUtils.js': importModuleRecord('./ColorConversionUtils.js').promise,
};

// Get workerData for configuration (Node.js only)
/** @type {{ colorEnginePath?: string, workerId?: string, diagnosticsEnabled?: boolean } | null} */
let workerDataConfig = null;
if (IS_NODE) {
    // Dynamically import workerData - this will be available when the worker starts
    try {
        const { workerData } = await import('worker_threads');
        workerDataConfig = workerData || null;
    } catch {
        // Ignore - not in worker context
    }
}

// Diagnostics collector (set when diagnostics port is received)
/** @type {import('../classes/diagnostics/auxiliary-diagnostics-collector.js').AuxiliaryDiagnosticsCollector | null} */
let diagnostics = null;

/** @type {any} */
let pako = null;
/** @type {any} */
let zlib = null;
/** @type {any} */
let colorEngine = null;
/** @type {any} */
let LittleCMS = null;
/** @type {typeof import('./ColorConversionUtils.js') | null} */
let ColorConversionUtils = null;

/** @type {import('../classes/baseline/color-conversion-policy.js').ColorConversionPolicy | null} */
let conversionPolicy = null;

/** @type {Map<string, any>} */
const profileHandleCache = new Map();

/**
 * Initialize diagnostics collector when port is received
 * @param {MessagePort} port - MessagePort for sending diagnostics to main thread
 * @param {string} workerId - Unique worker identifier
 */
async function initDiagnostics(port, workerId) {
    try {
        const { AuxiliaryDiagnosticsCollector } = await import('../classes/diagnostics/auxiliary-diagnostics-collector.js');
        diagnostics = new AuxiliaryDiagnosticsCollector({
            workerId,
            port,
            enabled: true,
        });
    } catch (e) {
        console.warn('[StreamTransformWorker] Failed to initialize diagnostics:', e.message);
    }
}

/** @type {Map<string, {transform: any, bpcClampingInitialized: boolean}>} */
const transformCache = new Map();

/** Threshold for adaptive BPC clamping optimization (2 megapixels) */
const ADAPTIVE_BPC_THRESHOLD = 2 * 1024 * 1024;

/**
 * Initialize compression library
 */
async function initCompression() {
    if (pako || zlib) return;

    if (IS_NODE)
        zlib = modulePromises.zlib ? await modulePromises.zlib : null;
    else
        pako = modulePromises.pako ? await modulePromises.pako : null;

    // try {
    //     if (IS_NODE) {
    //         zlib = await import('zlib');
    //     } else {
    //         // Use relative path for browser context (Web Workers don't inherit importmap)
    //         pako = await import('../packages/pako/dist/pako.mjs');
    //     }
    // } catch (e) {
    //     // Try the other one
    //     try {
    //         if (!IS_NODE) {
    //             zlib = await import('zlib');
    //         } else {
    //             // Fallback to bare specifier (may work with importmap in some contexts)
    //             pako = await import('pako');
    //         }
    //     } catch {
    //         throw new Error('No compression library available');
    //     }
    // }
}

/**
 * Initialize color engine
 * Uses colorEnginePath from workerData if provided, otherwise uses default symlink
 */
async function initColorEngine() {
    if (colorEngine) return;

    // Determine color engine path
    // workerDataConfig.colorEnginePath is relative to workspace root (e.g., 'packages/color-engine-2026-01-21')
    // Default is '../packages/color-engine' (symlink)
    let enginePath;
    if (workerDataConfig?.colorEnginePath) {
        // Custom path - relative to this file's location (services/)
        // workerDataConfig.colorEnginePath is like 'packages/color-engine-2026-01-21'
        // We need to resolve from services/ up to 2025/, then to packages/
        enginePath = `../${workerDataConfig.colorEnginePath}/src/index.js`;
    } else {
        // Default symlink path
        enginePath = '../packages/color-engine/src/index.js';
    }

    if (IS_NODE) {
        LittleCMS = await import(enginePath);
    } else {
        LittleCMS = await import(enginePath);
    }

    colorEngine = await LittleCMS.createEngine();

    // Initialize conversion policy with the loaded engine version
    // Reuses the same policy rules as main-thread converters
    if (!conversionPolicy && LittleCMS.VERSION) {
        const { ColorConversionPolicy } = await import('../classes/baseline/color-conversion-policy.js');
        conversionPolicy = new ColorConversionPolicy({
            engineVersion: `color-engine-${LittleCMS.VERSION}`,
            domain: 'PDF',
        });
    }
}

/**
 * Initialize ColorConversionUtils module
 */
async function initColorConversionUtils() {
    if (ColorConversionUtils) return;
    ColorConversionUtils = await modulePromises['./ColorConversionUtils.js'];
    // ColorConversionUtils = await import('./ColorConversionUtils.js');
}

/**
 * Inflate compressed data
 * @param {Uint8Array} data
 * @returns {Uint8Array}
 */
function inflate(data) {
    if (pako) {
        return new Uint8Array(pako.inflate(data));
    } else if (zlib) {
        return new Uint8Array(zlib.inflateSync(data));
    }
    throw new Error('No compression library');
}

/**
 * Deflate data
 * @param {Uint8Array} data
 * @returns {Uint8Array}
 */
function deflate(data) {
    if (pako) {
        return new Uint8Array(pako.deflate(data));
    } else if (zlib) {
        return new Uint8Array(zlib.deflateSync(data));
    }
    throw new Error('No compression library');
}

/**
 * Get or create profile handle
 * @param {Uint8Array | ArrayBuffer | Array<number> | 'sRGB' | 'sGray' | 'Lab'} profile
 * @returns {any}
 */
function getProfileHandle(profile) {
    // Create cache key
    let key;
    if (typeof profile === 'string') {
        key = profile;
    } else if (profile instanceof Uint8Array) {
        // For Uint8Array, use length and first bytes as hash
        const firstBytes = Array.from(profile.slice(0, 16)).join(',');
        key = `uint8-${profile.length}-${firstBytes}`;
    } else if (Array.isArray(profile)) {
        // For arrays, use length and a simple hash of first bytes
        const firstBytes = profile.slice(0, 16).join(',');
        key = `array-${profile.length}-${firstBytes}`;
    } else if (profile.byteLength !== undefined) {
        key = `buffer-${profile.byteLength}`;
    } else {
        key = `unknown-${JSON.stringify(profile).length}`;
    }

    if (profileHandleCache.has(key)) {
        return profileHandleCache.get(key);
    }

    let handle;
    if (profile === 'sRGB') {
        handle = colorEngine.createSRGBProfile();
    } else if (profile === 'Lab') {
        handle = colorEngine.createLab4Profile(0);
    } else if (profile === 'sGray') {
        // Use gamma 2.2 Gray profile for grayscale
        if (colorEngine.createGray2Profile) {
            handle = colorEngine.createGray2Profile();
        } else {
            // Old engine fallback: Gray will be expanded to RGB before transform,
            // so this code path shouldn't be reached. But if it is, use sRGB as fallback.
            console.warn('createGray2Profile not available, using sRGB as fallback');
            handle = colorEngine.createSRGBProfile();
        }
    } else if (profile instanceof Uint8Array) {
        // Uint8Array can be passed directly
        handle = colorEngine.openProfileFromMem(profile);
    } else if (Array.isArray(profile)) {
        // Convert array of numbers to Uint8Array
        handle = colorEngine.openProfileFromMem(new Uint8Array(profile));
    } else {
        handle = colorEngine.openProfileFromMem(new Uint8Array(profile));
    }

    profileHandleCache.set(key, handle);
    return handle;
}

/**
 * Gets number of channels for a pixel format
 * @param {number} format - LittleCMS pixel format constant
 * @returns {number} Number of channels
 */
function getChannelsFromFormat(format) {
    // Extract channels from format: CHANNELS_SH is at bits 3-6
    return ((format >> 3) & 0xF);
}

/**
 * Get or create transform
 * @param {number} srcHandle
 * @param {number} inputFormat
 * @param {number} dstHandle
 * @param {number} outputFormat
 * @param {number} intent
 * @param {number} flags
 * @param {boolean} [initBPCClamping=false] - Initialize BPC clamping for adaptive transform
 * @returns {{transform: any, bpcClampingInitialized: boolean}}
 */
function getTransform(srcHandle, inputFormat, dstHandle, outputFormat, intent, flags, initBPCClamping = false) {
    const key = `${srcHandle}-${inputFormat}-${dstHandle}-${outputFormat}-${intent}-${flags}`;

    if (transformCache.has(key)) {
        const cached = transformCache.get(key);
        // Initialize BPC clamping if requested and not already done
        if (initBPCClamping && !cached.bpcClampingInitialized && colorEngine.initBPCClamping) {
            try {
                const inputChannels = getChannelsFromFormat(inputFormat);
                const outputChannels = getChannelsFromFormat(outputFormat);
                colorEngine.initBPCClamping(cached.transform, inputChannels, outputChannels);
                cached.bpcClampingInitialized = true;
            } catch (e) {
                // BPC clamping initialization failed, continue without it
            }
        }
        return cached;
    }

    const transform = colorEngine.createTransform(
        srcHandle, inputFormat, dstHandle, outputFormat, intent, flags
    );

    const cached = { transform, bpcClampingInitialized: false };

    // Initialize BPC clamping if requested
    if (initBPCClamping && colorEngine.initBPCClamping) {
        try {
            const inputChannels = getChannelsFromFormat(inputFormat);
            const outputChannels = getChannelsFromFormat(outputFormat);
            colorEngine.initBPCClamping(transform, inputChannels, outputChannels);
            cached.bpcClampingInitialized = true;
        } catch (e) {
            // BPC clamping initialization failed, continue without it
        }
    }

    transformCache.set(key, cached);
    return cached;
}

/**
 * Process a content stream: inflate → find colors → transform → deflate
 * @param {object} task
 * @returns {Promise<object>}
 */
async function processContentStream(task) {
    await initCompression();
    await initColorEngine();
    await initColorConversionUtils();

    const start = performance.now();

    try {
        // 1. Inflate compressed stream
        const inflated = task.isCompressed
            ? inflate(new Uint8Array(task.compressedData))
            : new Uint8Array(task.compressedData);

        // 2. Decode to text (ISO 8859-1 identity mapping, not UTF-8)
        let streamText = '';
        for (let i = 0, len = inflated.length; i < len; i++) {
            streamText += String.fromCharCode(inflated[i]);
        }

        // 3. Get or create source profiles
        const sourceRGBProfile = getProfileHandle('sRGB');
        const sourceGrayProfile = getProfileHandle('sGray');
        const destinationProfile = getProfileHandle(
            task.destinationProfile instanceof Uint8Array
                ? task.destinationProfile
                : new Uint8Array(task.destinationProfile)
        );

        // 4. Convert colors in content stream
        const colorLookupSpan = diagnostics?.startSpan('color-lookup', {
            streamLength: streamText.length,
        });

        /** @type {{ newText: string, replacementCount: number }} */
        let contentStreamResult;
        try {
            contentStreamResult = await ColorConversionUtils.convertContentStreamColors(streamText, {
                colorSpaceDefinitions: task.colorSpaceDefinitions || {},
                colorEngine,
                renderingIntent: task.renderingIntent,
                flags: task.flags || 0,
                sourceRGBProfile,
                sourceGrayProfile,
                destinationProfile,
            });

            if (colorLookupSpan) {
                diagnostics?.updateSpan(colorLookupSpan, {
                    replacements: contentStreamResult.replacementCount,
                });
            }
        } finally {
            if (colorLookupSpan) {
                diagnostics?.endSpan(colorLookupSpan);
            }
        }
        const { newText, replacementCount } = contentStreamResult;

        // 5. Encode new text back to bytes (ISO 8859-1 identity mapping, not UTF-8)
        const newBytes = new Uint8Array(newText.length);
        for (let i = 0, len = newText.length; i < len; i++) {
            newBytes[i] = newText.charCodeAt(i);
        }

        // 6. Deflate result
        const result = deflate(newBytes);

        return {
            success: true,
            taskId: task.taskId,
            compressedResult: result.buffer,
            originalSize: newBytes.length,
            compressedSize: result.length,
            replacementCount,
            duration: performance.now() - start,
        };
    } catch (error) {
        return {
            success: false,
            taskId: task.taskId,
            error: error.message,
            duration: performance.now() - start,
        };
    }
}

/**
 * Convert 16-bit big-endian data to 8-bit by taking high byte
 * This matches PDFService baseline behavior which downgrades 16-bit to 8-bit
 * PDF stores 16-bit values in big-endian (high byte first)
 * @param {Uint8Array} data - Input data with 16-bit values (2 bytes per value)
 * @returns {Uint8Array} - 8-bit data (1 byte per value, taken from high byte)
 */
function convert16to8bit(data) {
    const numValues = data.length / 2;
    const result = new Uint8Array(numValues);
    for (let i = 0; i < numValues; i++) {
        // Take high byte (big-endian format)
        result[i] = data[i * 2];
    }
    return result;
}

/**
 * Process an image: inflate → transform pixels → deflate
 * @param {object} task
 * @returns {Promise<object>}
 */
async function processImage(task) {
    await initCompression();
    await initColorEngine();
    await initColorConversionUtils();

    const start = performance.now();

    try {
        // 1. Inflate compressed image data
        let inflated = task.isCompressed
            ? inflate(new Uint8Array(task.compressedData))
            : new Uint8Array(task.compressedData);

        // 1b. For 16-bit images, convert to 8-bit (matches baseline PDFService behavior)
        // Get constants from ColorConversionUtils (imported from color engine)
        const { PIXEL_FORMATS, RENDERING_INTENTS, ENGINE_FLAGS } = ColorConversionUtils;
        const { TYPE_GRAY_8, TYPE_GRAY_16, TYPE_RGB_8, TYPE_RGB_16, TYPE_Lab_8, TYPE_Lab_16 } = PIXEL_FORMATS;
        const K_ONLY_GCR = RENDERING_INTENTS.PRESERVE_K_ONLY_RELATIVE_COLORIMETRIC_GCR;
        const RELATIVE_COLORIMETRIC = RENDERING_INTENTS.RELATIVE_COLORIMETRIC;
        const BPC_FLAG = ENGINE_FLAGS.BLACKPOINT_COMPENSATION;

        // This takes the high byte of each 16-bit value (big-endian format in PDF)
        let inputFormat = task.inputFormat;
        let isLabImage = false;
        if (task.bitsPerComponent === 16) {
            inflated = convert16to8bit(inflated);
            // Update format to 8-bit version
            if (inputFormat === TYPE_Lab_16) {
                inputFormat = TYPE_Lab_8;
                isLabImage = true;
            }
            else if (inputFormat === TYPE_RGB_16) inputFormat = TYPE_RGB_8;
            else if (inputFormat === TYPE_GRAY_16) inputFormat = TYPE_GRAY_8;
        }

        // Check if source is Lab (8-bit)
        if (inputFormat === TYPE_Lab_8) {
            isLabImage = true;
        }

        // 2. Transform pixels

        // Evaluate conversion policy for rendering intent overrides
        // (e.g., Lab + K-Only GCR → Relative Colorimetric on old engines)
        let renderingIntent = task.renderingIntent;
        let flags = task.flags;
        if (conversionPolicy && isLabImage && renderingIntent === K_ONLY_GCR) {
            const { INTENT_MAP } = ColorConversionUtils;
            // Reverse-lookup the string intent name for policy evaluation
            const intentName = Object.entries(INTENT_MAP).find(([, v]) => v === K_ONLY_GCR)?.[0];
            if (intentName) {
                const evaluation = conversionPolicy.evaluateConversion({
                    sourceColorSpace: 'Lab',
                    destinationColorSpace: task.destinationColorSpace ?? 'CMYK',
                    renderingIntent: /** @type {import('../classes/baseline/color-conversion-policy.js').RenderingIntent} */ (intentName),
                    blackPointCompensation: (flags & BPC_FLAG) !== 0,
                });
                if (evaluation.overrides.renderingIntent) {
                    renderingIntent = INTENT_MAP[evaluation.overrides.renderingIntent] ?? RELATIVE_COLORIMETRIC;
                    flags |= BPC_FLAG;
                }
            }
        }

        // Check if Gray + K-Only GCR + old engine (no createMultiprofileTransform)
        // In this case, we need to expand Gray → RGB (R=G=B) and use sRGB profile
        const isGrayImage = inputFormat === TYPE_GRAY_8;
        const isKOnlyGCR = renderingIntent === K_ONLY_GCR;
        const needsGrayExpansion = isGrayImage && isKOnlyGCR && !colorEngine.createMultiprofileTransform;

        let sourceProfile = task.sourceProfile;
        if (needsGrayExpansion) {
            // Old engine fallback: expand Gray → RGB (R=G=B) and use sRGB profile
            const grayPixels = inflated;
            const rgbPixels = new Uint8Array(task.pixelCount * 3);
            for (let i = 0; i < task.pixelCount; i++) {
                const gray = grayPixels[i];
                rgbPixels[i * 3] = gray;     // R
                rgbPixels[i * 3 + 1] = gray; // G
                rgbPixels[i * 3 + 2] = gray; // B
            }
            inflated = rgbPixels;
            inputFormat = TYPE_RGB_8;
            sourceProfile = 'sRGB';
        }

        // Check if adaptive BPC clamping should be used
        // Only for large images (≥2MP) with BPC enabled
        const useBPC = (flags & BPC_FLAG) !== 0;
        const useAdaptiveBPC = task.pixelCount >= ADAPTIVE_BPC_THRESHOLD &&
            useBPC &&
            colorEngine.doTransformAdaptive;

        const srcHandle = getProfileHandle(sourceProfile);
        const dstHandle = getProfileHandle(task.destinationProfile);

        const cached = getTransform(
            srcHandle,
            inputFormat,
            dstHandle,
            task.outputFormat,
            renderingIntent,
            flags,
            useAdaptiveBPC // Initialize BPC clamping if using adaptive transform
        );

        const outputPixels = new Uint8Array(task.pixelCount * task.outputComponents);

        // Wrap WASM transform in diagnostic span
        const wasmSpan = diagnostics?.startSpan('wasm-transform', {
            pixelCount: task.pixelCount,
            useAdaptiveBPC,
            inputFormat,
            outputFormat: task.outputFormat,
        });

        try {
            // Choose transform method based on settings
            if (useAdaptiveBPC && cached.bpcClampingInitialized) {
                // Use adaptive transform for large images with BPC enabled
                colorEngine.doTransformAdaptive(cached.transform, inflated, outputPixels, task.pixelCount);
            } else {
                // Standard transform
                colorEngine.transformArray(cached.transform, inflated, outputPixels, task.pixelCount);
            }

            if (wasmSpan) {
                diagnostics?.updateSpan(wasmSpan, {
                    pixels: task.pixelCount,
                });
            }
        } finally {
            if (wasmSpan) {
                diagnostics?.endSpan(wasmSpan);
            }
        }

        // 3. Deflate result
        const result = deflate(outputPixels);

        return {
            success: true,
            taskId: task.taskId,
            compressedResult: result.buffer,
            originalSize: outputPixels.length,
            compressedSize: result.length,
            duration: performance.now() - start,
        };
    } catch (error) {
        return {
            success: false,
            taskId: task.taskId,
            error: error.message,
            duration: performance.now() - start,
        };
    }
}

/**
 * Benchmark task - measure inflate/transform/deflate performance
 * @param {object} task
 * @returns {Promise<object>}
 */
async function processBenchmark(task) {
    await initCompression();
    await initColorEngine();

    const start = performance.now();
    const results = {
        inflateTime: 0,
        transformTime: 0,
        deflateTime: 0,
    };

    try {
        // Generate test data
        const testData = new Uint8Array(task.dataSize || 100000);
        for (let i = 0; i < testData.length; i++) {
            testData[i] = i % 256;
        }

        // Benchmark deflate
        const deflateStart = performance.now();
        const compressed = deflate(testData);
        results.deflateTime = performance.now() - deflateStart;

        // Benchmark inflate
        const inflateStart = performance.now();
        const inflated = inflate(compressed);
        results.inflateTime = performance.now() - inflateStart;

        // Benchmark transform (if requested)
        if (task.includeTransform) {
            const srcHandle = colorEngine.createSRGBProfile();
            const dstHandle = colorEngine.createSRGBProfile();
            const transform = colorEngine.createTransform(
                srcHandle,
                LittleCMS.TYPE_RGB_8,
                dstHandle,
                LittleCMS.TYPE_RGB_8,
                LittleCMS.INTENT_RELATIVE_COLORIMETRIC,
                0
            );

            const pixels = task.dataSize / 3;
            const input = new Uint8Array(task.dataSize);
            const output = new Uint8Array(task.dataSize);

            const transformStart = performance.now();
            colorEngine.transformArray(transform, input, output, pixels);
            results.transformTime = performance.now() - transformStart;

            colorEngine.deleteTransform(transform);
            colorEngine.closeProfile(srcHandle);
            colorEngine.closeProfile(dstHandle);
        }

        return {
            success: true,
            taskId: task.taskId,
            results,
            duration: performance.now() - start,
        };
    } catch (error) {
        return {
            success: false,
            taskId: task.taskId,
            error: error.message,
            duration: performance.now() - start,
        };
    }
}

/**
 * Handle incoming message
 * @param {object} task
 */
async function handleMessage(task) {
    // Handle diagnostics port setup message
    if (task.type === 'diagnostics-port') {
        await initDiagnostics(task.port, task.workerId);
        return; // No response needed
    }

    let result;

    // Wrap task processing in a diagnostic span
    const taskSpan = diagnostics?.startSpan('worker-task', {
        type: task.type,
        taskId: task.taskId,
    });

    try {
        switch (task.type) {
            case 'content-stream':
                result = await processContentStream(task);
                break;
            case 'image':
                result = await processImage(task);
                break;
            case 'benchmark':
                result = await processBenchmark(task);
                break;
            case 'init':
                // Pre-initialize libraries
                await initCompression();
                await initColorEngine();
                result = { success: true, taskId: task.taskId, type: 'init-complete' };
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
        // End task span
        if (taskSpan) {
            diagnostics?.endSpan(taskSpan);
        }
    }

    // Send result back
    if (IS_NODE) {
        const { parentPort } = await import('worker_threads');
        parentPort?.postMessage(result, result.compressedResult ? [result.compressedResult] : []);
    } else {
        self.postMessage(result, result.compressedResult ? [result.compressedResult] : []);
    }
}

// Set up message handlers
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

export { };