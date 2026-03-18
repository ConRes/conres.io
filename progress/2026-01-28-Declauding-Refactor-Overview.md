# Declauding Refactor: Self-Contained Classes Module

## Problem Statement

The `classes/` folder has two coupling issues with `services/`:

### 1. Worker Infrastructure Coupling

```javascript
// classes/composite-color-converter.js:104
const { WorkerPool } = await import('../services/WorkerPool.js');
```

### 2. ColorEngineService Coupling

```javascript
// classes/color-converter.js:212
const { ColorEngineService } = await import('../services/ColorEngineService.js');
```

Additionally, `ColorEngineService` contains **hardcoded 8-bit format selection**:

```javascript
// services/ColorEngineService.js:455-463
#getPixelFormat(type) {
    switch (type) {
        case 'CMYK': return LittleCMS.TYPE_CMYK_8;  // ❌ Always 8-bit
        case 'RGB': return LittleCMS.TYPE_RGB_8;
        case 'Lab': return LittleCMS.TYPE_Lab_8;
        case 'Gray': return LittleCMS.TYPE_GRAY_8;
    }
}
```

This defeats the purpose of having LittleCMS with 200+ format constants for 8/16/32-bit support.

---

## Solution

Eliminate `ColorEngineService` by distributing its responsibilities:

| Responsibility | Current Location | New Location |
|----------------|------------------|--------------|
| WASM lifecycle | `ColorEngineService` | `classes/color-engine-provider.js` |
| Profile caching | `ColorEngineService` | `ColorConverter` base class |
| Transform caching | `ColorEngineService` | `ColorConverter` base class |
| Format determination | `ColorEngineService` (hardcoded) | `ColorConversionPolicy` (dynamic) |
| Intent mapping | `ColorEngineService` | `ColorEngineColorConversionPolicy` |
| Worker pool | `services/WorkerPool.js` | `classes/worker-pool.js` |

---

## File Specifications

### `classes/color-engine-provider.js`

Thin WASM wrapper with no business logic. **No fallback profiles** - all profiles must be actual ICC data.

```javascript
// @ts-check
/**
 * Thin wrapper around LittleCMS WASM.
 * Handles engine lifecycle only - no business logic.
 *
 * IMPORTANT: No fallback profiles. All profiles must be actual ICC data (ArrayBuffer).
 * This class does NOT provide createSRGBProfile/createGray2Profile/createLab4Profile
 * because those enable silent fallback behavior that masks missing profile errors.
 *
 * @module ColorEngineProvider
 */

// Re-export constants for external use
export * from '../packages/color-engine/src/constants.js';

/**
 * @typedef {import('../packages/color-engine/src/index.js').ColorEngine} LittleCMSEngine
 */

export class ColorEngineProvider {
    /** @type {LittleCMSEngine | null} */
    #engine = null;

    /** @type {Promise<void>} */
    #ready;

    constructor() {
        this.#ready = this.#initialize();
    }

    async #initialize() {
        const LittleCMS = await import('../packages/color-engine/src/index.js');
        this.#engine = await LittleCMS.createEngine();
    }

    async ensureReady() {
        await this.#ready;
    }

    /** @returns {LittleCMSEngine} */
    get engine() {
        if (!this.#engine) throw new Error('ColorEngineProvider not initialized');
        return this.#engine;
    }

    // ========================================
    // Profile Methods
    // ========================================

    /**
     * Opens a profile from ICC data.
     * @param {Uint8Array} data - ICC profile data (NOT ArrayBuffer - must be Uint8Array)
     * @returns {any} Profile handle
     * @throws {Error} If data is invalid or not provided
     */
    openProfileFromMem(data) {
        if (!(data instanceof Uint8Array)) {
            throw new Error('Profile data must be Uint8Array containing ICC data');
        }
        if (data.length < 128) {
            throw new Error('Invalid ICC profile: too small');
        }
        return this.engine.openProfileFromMem(data);
    }

    /**
     * Closes a profile handle.
     * @param {any} handle - Profile handle from openProfileFromMem
     */
    closeProfile(handle) {
        if (!handle) {
            throw new Error('Invalid profile handle');
        }
        return this.engine.closeProfile(handle);
    }

    /**
     * Creates a Lab profile for Lab colorspace conversion.
     * Lab is NOT an ICCBased colorspace in PDF - it's device-independent
     * and defined by CIE standards, so no embedded ICC profile exists.
     *
     * NOTE: createSRGBProfile and createGray2Profile are intentionally
     * NOT exposed - RGB and Gray must use actual embedded ICC profiles.
     *
     * @returns {any} Lab profile handle
     */
    createLab4Profile() {
        return this.engine.createLab4Profile();
    }

    // ========================================
    // Transform Methods
    // ========================================

    /**
     * Creates a color transform between two profiles.
     * @param {any} srcProfile - Source profile handle
     * @param {number} inputFormat - Input pixel format (TYPE_* constant)
     * @param {any} dstProfile - Destination profile handle
     * @param {number} outputFormat - Output pixel format (TYPE_* constant)
     * @param {number} intent - Rendering intent constant
     * @param {number} flags - Transform flags
     * @returns {any} Transform handle
     * @throws {Error} If transform creation fails
     */
    createTransform(srcProfile, inputFormat, dstProfile, outputFormat, intent, flags) {
        if (!srcProfile || !dstProfile) {
            throw new Error('Source and destination profiles are required');
        }
        const transform = this.engine.createTransform(
            srcProfile, inputFormat, dstProfile, outputFormat, intent, flags
        );
        if (!transform) {
            throw new Error('Failed to create color transform');
        }
        return transform;
    }

    /**
     * Creates a multiprofile transform chaining 2+ profiles.
     * @param {any[]} profiles - Array of profile handles
     * @param {number} inputFormat - Input pixel format
     * @param {number} outputFormat - Output pixel format
     * @param {number} intent - Rendering intent
     * @param {number} flags - Transform flags
     * @returns {any} Transform handle
     * @throws {Error} If transform creation fails
     */
    createMultiprofileTransform(profiles, inputFormat, outputFormat, intent, flags) {
        if (!profiles || profiles.length < 2) {
            throw new Error('Multiprofile transform requires at least 2 profiles');
        }
        for (let i = 0; i < profiles.length; i++) {
            if (!profiles[i]) {
                throw new Error(`Invalid profile at index ${i}`);
            }
        }
        const transform = this.engine.createMultiprofileTransform(
            profiles, inputFormat, outputFormat, intent, flags
        );
        if (!transform) {
            throw new Error('Failed to create multiprofile transform');
        }
        return transform;
    }

    /**
     * Deletes a transform handle.
     * @param {any} handle - Transform handle
     */
    deleteTransform(handle) {
        if (!handle) {
            throw new Error('Invalid transform handle');
        }
        return this.engine.deleteTransform(handle);
    }

    // ========================================
    // Conversion Methods
    // ========================================

    /**
     * Transforms pixel array using a transform.
     * @param {any} transform - Transform handle
     * @param {Uint8Array | Uint16Array | Float32Array} input - Input pixels
     * @param {Uint8Array | Uint16Array | Float32Array} output - Output buffer
     * @param {number} pixelCount - Number of pixels
     */
    transformArray(transform, input, output, pixelCount) {
        if (!transform) {
            throw new Error('Invalid transform handle');
        }
        if (!input || !output) {
            throw new Error('Input and output buffers are required');
        }
        return this.engine.transformArray(transform, input, output, pixelCount);
    }

    /**
     * Transforms with adaptive BPC clamping (for large images).
     * @param {any} transform - Transform handle
     * @param {Uint8Array | Uint16Array | Float32Array} input - Input pixels
     * @param {Uint8Array | Uint16Array | Float32Array} output - Output buffer
     * @param {number} pixelCount - Number of pixels
     * @returns {object} BPC statistics
     * @throws {Error} If doTransformAdaptive is not available
     */
    doTransformAdaptive(transform, input, output, pixelCount) {
        if (!this.engine.doTransformAdaptive) {
            throw new Error('doTransformAdaptive not available in this Color Engine version');
        }
        if (!transform) {
            throw new Error('Invalid transform handle');
        }
        return this.engine.doTransformAdaptive(transform, input, output, pixelCount);
    }

    /**
     * Initializes BPC clamping for a transform.
     * @param {any} transform - Transform handle
     * @param {number} inputChannels - Number of input channels
     * @param {number} outputChannels - Number of output channels
     * @throws {Error} If initBPCClamping is not available
     */
    initBPCClamping(transform, inputChannels, outputChannels) {
        if (!this.engine.initBPCClamping) {
            throw new Error('initBPCClamping not available in this Color Engine version');
        }
        if (!transform) {
            throw new Error('Invalid transform handle');
        }
        return this.engine.initBPCClamping(transform, inputChannels, outputChannels);
    }

    // ========================================
    // Lifecycle
    // ========================================

    dispose() {
        // Note: Individual transforms/profiles should be cleaned by their owners
        this.#engine = null;
    }
}
```

### `classes/color-converter.js` Additions

Profile and transform caching moved from `ColorEngineService`:

```javascript
// New private fields
/** @type {Map<string, ArrayBuffer>} */
#profileBufferCache = new Map();

/** @type {Map<string, any>} */
#profileHandleCache = new Map();

/** @type {Map<string, CachedTransform>} */
#transformCache = new Map();

/** @type {ColorEngineProvider | null} */
#colorEngineProvider = null;

/** @type {ColorEngineColorConversionPolicy} */
#policy;

// New methods

/**
 * Opens a profile handle, with caching.
 * @param {ArrayBuffer | 'sRGB' | 'sGray' | 'Lab'} source
 * @returns {any} Profile handle
 */
#openProfile(source) {
    const cacheKey = this.#getProfileCacheKey(source);
    if (this.#profileHandleCache.has(cacheKey)) {
        return this.#profileHandleCache.get(cacheKey);
    }

    const engine = this.#colorEngineProvider;
    let handle;

    if (source === 'sRGB') {
        handle = engine.createSRGBProfile();
    } else if (source === 'sGray') {
        handle = engine.createGray2Profile();
    } else if (source === 'Lab') {
        handle = engine.createLab4Profile();
    } else {
        handle = engine.openProfileFromMem(new Uint8Array(source));
    }

    this.#profileHandleCache.set(cacheKey, handle);
    return handle;
}

/**
 * Gets or creates a cached transform.
 * Uses policy for format determination.
 */
#getOrCreateTransform(options) {
    const { sourceProfile, destProfile, inputDescriptor, outputDescriptor, intent, flags } = options;

    // Use policy for format determination (NOT hardcoded)
    const inputFormat = this.#policy.getInputFormat(inputDescriptor);
    const outputFormat = this.#policy.getOutputFormat(outputDescriptor);

    const cacheKey = this.#getTransformCacheKey(sourceProfile, destProfile, inputFormat, outputFormat, intent, flags);

    if (this.#transformCache.has(cacheKey)) {
        return this.#transformCache.get(cacheKey);
    }

    const srcHandle = this.#openProfile(sourceProfile);
    const dstHandle = this.#openProfile(destProfile);

    const transform = this.#colorEngineProvider.createTransform(
        srcHandle, inputFormat, dstHandle, outputFormat, intent, flags
    );

    const cached = { transform, inputFormat, outputFormat };
    this.#transformCache.set(cacheKey, cached);
    return cached;
}
```

### `classes/worker-pool.js`

Isomorphic worker pool:

```javascript
// @ts-check
/**
 * Isomorphic Worker Pool for ColorConverter classes.
 * Works in Node.js (worker_threads) and browser (Web Workers).
 *
 * @module WorkerPool
 */

const IS_NODE = typeof process !== 'undefined' && process.versions?.node;

/**
 * @typedef {{
 *   type: 'image' | 'content-stream',
 *   taskId: number,
 *   configuration: object,
 *   input: object,
 * }} WorkerTask
 */

/**
 * @typedef {{
 *   success: boolean,
 *   taskId: number,
 *   error?: string,
 *   [key: string]: any,
 * }} WorkerResult
 */

export class WorkerPool {
    /** @type {Worker[]} */
    #workers = [];

    /** @type {number} */
    #nextWorker = 0;

    /** @type {number} */
    #taskIdCounter = 0;

    /** @type {Map<number, { resolve: Function, reject: Function }>} */
    #pendingTasks = new Map();

    /** @type {string | URL} */
    #entrypointPath;

    /** @type {number} */
    #workerCount;

    /** @type {boolean} */
    #initialized = false;

    /**
     * @param {object} [options]
     * @param {number} [options.workerCount] - Number of workers (default: navigator.hardwareConcurrency or 4)
     * @param {string | URL} [options.entrypointPath] - Path to worker entrypoint
     */
    constructor(options = {}) {
        this.#workerCount = options.workerCount ?? (
            IS_NODE
                ? (await import('os')).cpus().length
                : (globalThis.navigator?.hardwareConcurrency ?? 4)
        );
        this.#entrypointPath = options.entrypointPath ?? new URL('./worker-pool-entrypoint.js', import.meta.url);
    }

    async initialize() {
        if (this.#initialized) return;

        const workerPromises = [];

        for (let i = 0; i < this.#workerCount; i++) {
            workerPromises.push(this.#createWorker(i));
        }

        this.#workers = await Promise.all(workerPromises);
        this.#initialized = true;
    }

    async #createWorker(index) {
        if (IS_NODE) {
            const { Worker } = await import('worker_threads');
            const worker = new Worker(this.#entrypointPath);

            return new Promise((resolve, reject) => {
                worker.on('message', (msg) => {
                    if (msg.type === 'ready') {
                        resolve(worker);
                    } else {
                        this.#handleWorkerMessage(msg);
                    }
                });
                worker.on('error', reject);
            });
        } else {
            const worker = new Worker(this.#entrypointPath, { type: 'module' });

            return new Promise((resolve, reject) => {
                worker.onmessage = (event) => {
                    if (event.data.type === 'ready') {
                        resolve(worker);
                    } else {
                        this.#handleWorkerMessage(event.data);
                    }
                };
                worker.onerror = reject;
            });
        }
    }

    #handleWorkerMessage(message) {
        const pending = this.#pendingTasks.get(message.taskId);
        if (!pending) return;

        this.#pendingTasks.delete(message.taskId);

        if (message.success) {
            pending.resolve(message);
        } else {
            pending.reject(new Error(message.error ?? 'Worker task failed'));
        }
    }

    /**
     * Submit a task to the pool.
     * @param {WorkerTask} task
     * @returns {Promise<WorkerResult>}
     */
    async submitTask(task) {
        if (!this.#initialized) {
            await this.initialize();
        }

        const taskId = this.#taskIdCounter++;
        const taskWithId = { ...task, taskId };

        return new Promise((resolve, reject) => {
            this.#pendingTasks.set(taskId, { resolve, reject });

            const worker = this.#workers[this.#nextWorker];
            this.#nextWorker = (this.#nextWorker + 1) % this.#workers.length;

            if (IS_NODE) {
                worker.postMessage(taskWithId);
            } else {
                // Collect transferables
                const transferables = [];
                if (task.input?.streamData instanceof ArrayBuffer) {
                    transferables.push(task.input.streamData);
                }
                if (task.configuration?.destinationProfile instanceof ArrayBuffer) {
                    transferables.push(task.configuration.destinationProfile);
                }
                worker.postMessage(taskWithId, transferables);
            }
        });
    }

    /**
     * Submit multiple tasks in parallel.
     * @param {WorkerTask[]} tasks
     * @returns {Promise<WorkerResult[]>}
     */
    async submitAll(tasks) {
        return Promise.all(tasks.map(task => this.submitTask(task)));
    }

    terminate() {
        for (const worker of this.#workers) {
            if (IS_NODE) {
                worker.terminate();
            } else {
                worker.terminate();
            }
        }
        this.#workers = [];
        this.#initialized = false;
        this.#pendingTasks.clear();
    }
}
```

### `classes/worker-pool-entrypoint.js`

Worker script using ColorConverter classes:

```javascript
// @ts-check
/**
 * Worker entrypoint for ColorConverter classes.
 * Instantiates the same classes used on main thread.
 *
 * @module WorkerPoolEntrypoint
 */

import { ColorEngineProvider } from './color-engine-provider.js';
import { ColorEngineColorConversionPolicy } from './color-engine-color-conversion-policy.js';
import { PDFImageColorConverter } from './pdf-image-color-converter.js';
import { PDFContentStreamColorConverter } from './pdf-content-stream-color-converter.js';

// ============================================================================
// Singleton Instances (per worker)
// ============================================================================

/** @type {ColorEngineProvider | null} */
let colorEngineProvider = null;

/** @type {ColorEngineColorConversionPolicy | null} */
let policy = null;

async function ensureInitialized() {
    if (!colorEngineProvider) {
        colorEngineProvider = new ColorEngineProvider();
        await colorEngineProvider.ensureReady();
    }
    if (!policy) {
        policy = new ColorEngineColorConversionPolicy();
    }
    return { colorEngineProvider, policy };
}

// ============================================================================
// Task Handlers
// ============================================================================

async function handleImageTask(task) {
    const { colorEngineProvider, policy } = await ensureInitialized();

    const converter = new PDFImageColorConverter(
        task.configuration,
        { colorEngineProvider, policy }
    );
    await converter.ensureReady();

    try {
        const result = await converter.convertColor(task.input);
        return {
            success: true,
            taskId: task.taskId,
            streamRef: task.input.streamRef,
            data: result.streamData.buffer,
            isCompressed: result.isCompressed,
            colorSpace: result.colorSpace,
            bitsPerComponent: result.bitsPerComponent,
        };
    } finally {
        converter.dispose();
    }
}

async function handleContentStreamTask(task) {
    const { colorEngineProvider, policy } = await ensureInitialized();

    const converter = new PDFContentStreamColorConverter(
        task.configuration,
        { colorEngineProvider, policy }
    );
    await converter.ensureReady();

    try {
        const result = await converter.convertColor(task.input);
        return {
            success: true,
            taskId: task.taskId,
            streamRef: task.input.streamRef,
            newText: result.newText,
            replacementCount: result.replacementCount,
            finalColorSpaceState: result.finalColorSpaceState,
        };
    } finally {
        converter.dispose();
    }
}

async function handleMessage(task) {
    try {
        switch (task.type) {
            case 'image':
                return await handleImageTask(task);
            case 'content-stream':
                return await handleContentStreamTask(task);
            default:
                return { success: false, taskId: task.taskId, error: `Unknown task type: ${task.type}` };
        }
    } catch (error) {
        return {
            success: false,
            taskId: task.taskId,
            error: error.message ?? String(error),
        };
    }
}

// ============================================================================
// Environment Setup
// ============================================================================

const IS_NODE = typeof process !== 'undefined' && process.versions?.node;

if (IS_NODE) {
    const { parentPort } = await import('worker_threads');
    parentPort?.on('message', async (task) => {
        const result = await handleMessage(task);
        const transferables = result.data ? [result.data] : [];
        parentPort.postMessage(result, transferables);
    });
    parentPort?.postMessage({ type: 'ready' });
} else {
    self.onmessage = async (event) => {
        const result = await handleMessage(event.data);
        const transferables = result.data ? [result.data] : [];
        self.postMessage(result, transferables);
    };
    self.postMessage({ type: 'ready' });
}
```

---

## Data Flow

### Main Thread → Worker → Main Thread

```
┌────────────────────────────────────────────────────────────────────────────┐
│ Main Thread                                                                │
├────────────────────────────────────────────────────────────────────────────┤
│                                                                            │
│  PDFPageColorConverter                                                     │
│    │                                                                       │
│    ├── Extract image data from PDF                                         │
│    │                                                                       │
│    ├── PDFImageColorConverter.prepareWorkerTask(input)                     │
│    │     → { type: 'image', configuration: {...}, input: {...} }           │
│    │                                                                       │
│    ├── workerPool.submitTask(task) ─────────────────────────────────────┐  │
│    │                                                                    │  │
│    │                                          ┌─────────────────────────┼──┤
│    │                                          │ Worker Thread           │  │
│    │                                          ├─────────────────────────┼──┤
│    │                                          │                         │  │
│    │                                          │  ColorEngineProvider    │  │
│    │                                          │  Policy (singleton)     │  │
│    │                                          │                         │  │
│    │                                          │  new PDFImageColorConverter
│    │                                          │    .convertColor(input) │  │
│    │                                          │                         │  │
│    │                                          │  → { success, data, ...}│  │
│    │                                          │                         │  │
│    │   ◄─────────────────────────────────────────────────────────────────┘  │
│    │                                                                       │
│    └── PDFImageColorConverter.applyWorkerResult(input, result)             │
│          → Update PDF stream with converted data                           │
│                                                                            │
└────────────────────────────────────────────────────────────────────────────┘
```

---

## Task Formats

### Image Task

```javascript
// To worker
{
    type: 'image',
    taskId: number,
    configuration: {
        renderingIntent: RenderingIntent,
        blackPointCompensation: boolean,
        useAdaptiveBPCClamping: boolean,
        destinationColorSpace: 'CMYK' | 'RGB',
        destinationProfile: ArrayBuffer,
        compressOutput: boolean,
    },
    input: {
        streamRef: string,
        streamData: ArrayBuffer,  // Transferable
        isCompressed: boolean,
        width: number,
        height: number,
        colorSpace: 'RGB' | 'Gray' | 'Lab',
        bitsPerComponent: 8 | 16,  // Now supports 16-bit!
        isBigEndian: boolean,      // For 16-bit
        sourceProfile: ArrayBuffer | 'sRGB' | 'sGray' | 'Lab',
    }
}

// From worker
{
    success: boolean,
    taskId: number,
    streamRef: string,
    data: ArrayBuffer,  // Transferable
    isCompressed: boolean,
    colorSpace: 'CMYK' | 'RGB',
    bitsPerComponent: 8 | 16,
    error?: string,
}
```

### Content Stream Task

```javascript
// To worker
{
    type: 'content-stream',
    taskId: number,
    configuration: {
        renderingIntent: RenderingIntent,
        blackPointCompensation: boolean,
        destinationColorSpace: 'CMYK' | 'RGB',
        destinationProfile: ArrayBuffer,
    },
    input: {
        streamRef: string,
        streamText: string,
        colorSpaceDefinitions: object,
        initialColorSpaceState?: { strokeColorSpace?: string, fillColorSpace?: string },
    }
}

// From worker
{
    success: boolean,
    taskId: number,
    streamRef: string,
    newText: string,
    replacementCount: number,
    finalColorSpaceState: { strokeColorSpace?: string, fillColorSpace?: string },
    error?: string,
}
```

---

## Key Constraints

1. **ColorEngineProvider cannot be serialized** (WASM state)
   - Each worker creates its own instance
   - Transform/profile caching works within each worker

2. **Content streams must be sequential**
   - Color space state carries across streams on same page
   - Images CAN be fully parallelized

3. **16-bit support requires policy**
   - `ColorConversionPolicy.getInputFormat({ colorSpace: 'RGB', bitsPerComponent: 16, isBigEndian: true })`
   - Returns `TYPE_RGB_16` or `TYPE_RGB_16_SE` as appropriate

4. **Isomorphic worker code**
   - Node.js: `worker_threads`
   - Browser: `Web Workers`
   - Same entrypoint script works in both

---

## Verification

1. **Unit tests**: Run existing test suite (`yarn test`)
2. **Format tests**: Verify 8-bit, 16-bit, and 32-bit conversions
3. **Worker parity**: Compare worker output to main thread output
4. **Benchmark**: Compare performance to legacy implementation
5. **PDF regression**: Pixel-by-pixel comparison of converted PDFs
