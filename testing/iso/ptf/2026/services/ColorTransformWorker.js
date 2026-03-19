// @ts-check
/**
 * Color Transform Worker
 * Isomorphic worker script for parallel color transformations
 * Works in both Node.js (worker_threads) and browser (Web Workers)
 *
 * @module ColorTransformWorker
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

const ENVIRONMENT = detectEnvironment();

// Import color engine based on environment
let ColorEngine, createEngine;
let INTENT_PERCEPTUAL, INTENT_RELATIVE_COLORIMETRIC, INTENT_SATURATION;
let INTENT_ABSOLUTE_COLORIMETRIC, INTENT_PRESERVE_K_ONLY_RELATIVE_COLORIMETRIC_GCR;
let cmsFLAGS_BLACKPOINTCOMPENSATION;
let TYPE_RGB_8, TYPE_CMYK_8, TYPE_GRAY_8, TYPE_Lab_8, TYPE_Lab_16, TYPE_GRAY_16, TYPE_RGB_16, TYPE_CMYK_16;

/** @type {import('../packages/color-engine/src/index.js').ColorEngine | null} */
let colorEngine = null;

/** @type {Map<string, any>} */
const profileHandleCache = new Map();

/** @type {Map<string, any>} */
const transformCache = new Map();

/**
 * Initialize color engine
 */
async function initColorEngine() {
    if (colorEngine) return;

    if (ENVIRONMENT === 'node') {
        // Node.js - dynamic import
        const lcms = await import('../packages/color-engine/src/index.js');
        ColorEngine = lcms.ColorEngine;
        createEngine = lcms.createEngine;
        INTENT_PERCEPTUAL = lcms.INTENT_PERCEPTUAL;
        INTENT_RELATIVE_COLORIMETRIC = lcms.INTENT_RELATIVE_COLORIMETRIC;
        INTENT_SATURATION = lcms.INTENT_SATURATION;
        INTENT_ABSOLUTE_COLORIMETRIC = lcms.INTENT_ABSOLUTE_COLORIMETRIC;
        INTENT_PRESERVE_K_ONLY_RELATIVE_COLORIMETRIC_GCR = lcms.INTENT_PRESERVE_K_ONLY_RELATIVE_COLORIMETRIC_GCR;
        cmsFLAGS_BLACKPOINTCOMPENSATION = lcms.cmsFLAGS_BLACKPOINTCOMPENSATION;
        TYPE_RGB_8 = lcms.TYPE_RGB_8;
        TYPE_CMYK_8 = lcms.TYPE_CMYK_8;
        TYPE_GRAY_8 = lcms.TYPE_GRAY_8;
        TYPE_Lab_8 = lcms.TYPE_Lab_8;
        TYPE_Lab_16 = lcms.TYPE_Lab_16;
        TYPE_GRAY_16 = lcms.TYPE_GRAY_16;
        TYPE_RGB_16 = lcms.TYPE_RGB_16;
        TYPE_CMYK_16 = lcms.TYPE_CMYK_16;
    } else {
        // Browser - importmap resolves this
        const lcms = await import('../packages/color-engine/src/index.js');
        ColorEngine = lcms.ColorEngine;
        createEngine = lcms.createEngine;
        INTENT_PERCEPTUAL = lcms.INTENT_PERCEPTUAL;
        INTENT_RELATIVE_COLORIMETRIC = lcms.INTENT_RELATIVE_COLORIMETRIC;
        INTENT_SATURATION = lcms.INTENT_SATURATION;
        INTENT_ABSOLUTE_COLORIMETRIC = lcms.INTENT_ABSOLUTE_COLORIMETRIC;
        INTENT_PRESERVE_K_ONLY_RELATIVE_COLORIMETRIC_GCR = lcms.INTENT_PRESERVE_K_ONLY_RELATIVE_COLORIMETRIC_GCR;
        cmsFLAGS_BLACKPOINTCOMPENSATION = lcms.cmsFLAGS_BLACKPOINTCOMPENSATION;
        TYPE_RGB_8 = lcms.TYPE_RGB_8;
        TYPE_CMYK_8 = lcms.TYPE_CMYK_8;
        TYPE_GRAY_8 = lcms.TYPE_GRAY_8;
        TYPE_Lab_8 = lcms.TYPE_Lab_8;
        TYPE_Lab_16 = lcms.TYPE_Lab_16;
        TYPE_GRAY_16 = lcms.TYPE_GRAY_16;
        TYPE_RGB_16 = lcms.TYPE_RGB_16;
        TYPE_CMYK_16 = lcms.TYPE_CMYK_16;
    }

    colorEngine = await createEngine();
}

/**
 * Get or create profile handle
 * @param {ArrayBuffer | 'sRGB' | 'sGray' | 'Lab'} profile
 * @returns {any}
 */
function getProfileHandle(profile) {
    const key = typeof profile === 'string' ? profile : `buffer-${profile.byteLength}`;

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
        handle = colorEngine.createGray2Profile();
    } else {
        handle = colorEngine.openProfileFromMem(new Uint8Array(profile));
    }

    profileHandleCache.set(key, handle);
    return handle;
}

/**
 * Get or create transform
 * @param {any} srcHandle
 * @param {number} inputFormat
 * @param {any} dstHandle
 * @param {number} outputFormat
 * @param {number} intent
 * @param {number} flags
 * @returns {any}
 */
function getTransform(srcHandle, inputFormat, dstHandle, outputFormat, intent, flags) {
    const key = `${srcHandle}-${inputFormat}-${dstHandle}-${outputFormat}-${intent}-${flags}`;

    if (transformCache.has(key)) {
        return transformCache.get(key);
    }

    const transform = colorEngine.createTransform(
        srcHandle, inputFormat, dstHandle, outputFormat, intent, flags
    );

    transformCache.set(key, transform);
    return transform;
}

/**
 * Handle transform task
 * @param {object} task
 * @returns {Promise<object>}
 */
async function handleTransform(task) {
    await initColorEngine();

    const start = performance.now();

    try {
        const srcHandle = getProfileHandle(task.sourceProfile);
        const dstHandle = getProfileHandle(task.destinationProfile);

        const transform = getTransform(
            srcHandle,
            task.inputFormat,
            dstHandle,
            task.outputFormat,
            task.renderingIntent,
            task.flags
        );

        // Create output array
        const outputArray = new Uint8Array(task.pixelCount * task.outputComponentsPerPixel);

        // Perform transform
        colorEngine.transformArray(
            transform,
            new Uint8Array(task.inputArray),
            outputArray,
            task.pixelCount
        );

        return {
            success: true,
            taskId: task.taskId,
            outputArray,
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
 * Handle benchmark task
 * @param {object} task
 * @returns {Promise<object>}
 */
async function handleBenchmark(task) {
    await initColorEngine();

    const start = performance.now();

    try {
        // Simple benchmark - just create random transforms
        const srcHandle = colorEngine.createSRGBProfile();
        const dstHandle = colorEngine.createSRGBProfile();

        const transform = colorEngine.createTransform(
            srcHandle, TYPE_RGB_8, dstHandle, TYPE_RGB_8,
            INTENT_RELATIVE_COLORIMETRIC, 0
        );

        // Do some transforms
        const inputArray = new Uint8Array(task.arraySize * 3);
        const outputArray = new Uint8Array(task.arraySize * 3);

        for (let i = 0; i < task.iterations; i++) {
            colorEngine.transformArray(transform, inputArray, outputArray, task.arraySize);
        }

        // Clean up
        colorEngine.deleteTransform(transform);
        colorEngine.closeProfile(srcHandle);
        colorEngine.closeProfile(dstHandle);

        return {
            success: true,
            taskId: task.taskId,
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
    let result;

    switch (task.type) {
        case 'transform':
            result = await handleTransform(task);
            break;
        case 'benchmark':
            result = await handleBenchmark(task);
            break;
        default:
            result = {
                success: false,
                taskId: task.taskId,
                error: `Unknown task type: ${task.type}`,
            };
    }

    // Send result back
    if (ENVIRONMENT === 'node') {
        const { parentPort } = await import('worker_threads');
        parentPort?.postMessage(result);
    } else {
        self.postMessage(result);
    }
}

// Set up message handlers
if (ENVIRONMENT === 'node') {
    import('worker_threads').then(({ parentPort }) => {
        parentPort?.on('message', handleMessage);
        // Signal ready
        parentPort?.postMessage({ type: 'ready' });
    });
} else {
    self.onmessage = (event) => {
        handleMessage(event.data);
    };
    // Signal ready
    self.postMessage({ type: 'ready' });
}
