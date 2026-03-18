# Declauding Classes: Self-Contained Worker Infrastructure

## Problem Statement

The `classes/` folder (refactored implementation) currently depends on `services/` folder (legacy implementation) for worker functionality:

```javascript
// classes/composite-color-converter.js:104
const { WorkerPool } = await import('../services/WorkerPool.js');
```

This coupling:
- Prevents `classes/` from being a clean, self-contained module
- Ties refactored code to legacy implementation details
- Makes it harder to reason about the class hierarchy in isolation

## Solution

Create self-contained worker infrastructure within `classes/`:

| File | Purpose |
|------|---------|
| `classes/worker-pool.js` | Isomorphic worker pool (Node.js + browser) |
| `classes/worker-pool-entrypoint.js` | Worker script that instantiates ColorConverter classes |

**Key principle**: The worker uses the **same ColorConverter classes** as the main thread. No procedural code duplication.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              classes/ (REFACTORED)                          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Main Thread                           Worker Thread                        │
│  ───────────                           ─────────────                        │
│  PDFDocumentColorConverter             worker-pool-entrypoint.js            │
│    └── PDFPageColorConverter             │                                  │
│          ├── PDFImageColorConverter      ├── ColorEngineService (singleton) │
│          └── PDFContentStreamConverter   ├── PDFImageColorConverter         │
│                                          └── PDFContentStreamConverter      │
│                                                                             │
│  CompositeColorConverter ──────────────► worker-pool.js                     │
│    └── manages worker lifecycle            └── spawns workers               │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                           services/ (LEGACY - UNTOUCHED)                    │
├─────────────────────────────────────────────────────────────────────────────┤
│  PDFService.js ──────────────────────► WorkerPool.js                        │
│                                          └── StreamTransformWorker.js       │
│                                               (procedural code)             │
└─────────────────────────────────────────────────────────────────────────────┘

                    ⬆ NO CROSS-DEPENDENCIES ⬆
          classes/ does NOT import from services/
```

## Task Flow

### Image Task

```
Main Thread                              Worker Thread
───────────                              ─────────────
PDFPageColorConverter
  │
  ├── #extractImageInput(imageData)
  │
  ├── PDFImageColorConverter
  │     .prepareWorkerTask(input)
  │       → { type: 'image', ...serializable data }
  │
  ├── workerPool.submitTask(task) ──────► worker-pool-entrypoint.js
  │                                         │
  │                                         ├── new ColorEngineService()
  │                                         │     (singleton per worker)
  │                                         │
  │                                         ├── new PDFImageColorConverter(config)
  │                                         │
  │                                         ├── converter.convertColor(input)
  │                                         │
  │   ◄──────────────────────────────────── └── return { success, data, ... }
  │
  └── PDFImageColorConverter
        .applyWorkerResult(input, result)
          → updates PDF stream
```

### Content Stream Task

Content streams must be processed **sequentially** because color space state carries across streams on the same page.

```
Main Thread                              Worker Thread
───────────                              ─────────────
PDFPageColorConverter
  │
  ├── for each contentStream (sequential):
  │     │
  │     ├── PDFContentStreamColorConverter
  │     │     .prepareWorkerTask(input, { initialColorSpaceState })
  │     │       → { type: 'content-stream', ...serializable data }
  │     │
  │     ├── workerPool.submitTask(task) ──► worker-pool-entrypoint.js
  │     │                                     │
  │     │                                     ├── new PDFContentStreamColorConverter(config)
  │     │                                     │
  │     │                                     ├── converter.convertColor(input)
  │     │                                     │
  │     │   ◄──────────────────────────────── └── return { success, newText, finalState }
  │     │
  │     └── PDFContentStreamColorConverter
  │           .applyWorkerResult(input, result)
  │             → updates PDF stream
  │             → carry finalColorSpaceState to next stream
  │
```

## File Specifications

### `classes/worker-pool.js`

Clean, isomorphic worker pool:

```javascript
// @ts-check
/**
 * Isomorphic Worker Pool for ColorConverter classes.
 * Works in Node.js (worker_threads) and browser (Web Workers).
 */

export class WorkerPool {
    /** @type {WorkerInfo[]} */
    #workers = [];

    /** @type {number} */
    #workerCount;

    /** @type {string | URL} */
    #entrypointPath;

    /**
     * @param {object} options
     * @param {number} [options.workerCount] - Number of workers (default: auto)
     * @param {string | URL} [options.entrypointPath] - Path to entrypoint script
     * @param {boolean} [options.diagnosticsEnabled] - Enable diagnostics
     */
    constructor(options = {}) { /* ... */ }

    async initialize() { /* ... */ }

    /**
     * Submit a task to the pool.
     * @param {WorkerTask} task
     * @returns {Promise<WorkerResult>}
     */
    async submitTask(task) { /* ... */ }

    /**
     * Submit multiple tasks.
     * @param {WorkerTask[]} tasks
     * @returns {Promise<WorkerResult[]>}
     */
    async submitAll(tasks) { /* ... */ }

    async terminate() { /* ... */ }
}
```

### `classes/worker-pool-entrypoint.js`

Worker script that uses ColorConverter classes:

```javascript
// @ts-check
/**
 * Worker entrypoint for ColorConverter classes.
 * Instantiates the same classes used on main thread.
 */

import { ColorEngineService } from '../services/ColorEngineService.js';
import { PDFImageColorConverter } from './pdf-image-color-converter.js';
import { PDFContentStreamColorConverter } from './pdf-content-stream-color-converter.js';

// Singleton ColorEngineService per worker
let colorEngineService = null;

async function ensureColorEngine() {
    if (!colorEngineService) {
        colorEngineService = new ColorEngineService();
        await colorEngineService.ensureReady();
    }
    return colorEngineService;
}

async function handleImageTask(task) {
    const service = await ensureColorEngine();

    const converter = new PDFImageColorConverter(
        task.configuration,
        { colorEngineService: service }
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
    const service = await ensureColorEngine();

    const converter = new PDFContentStreamColorConverter(
        task.configuration,
        { colorEngineService: service }
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

// Message handler
async function handleMessage(task) {
    switch (task.type) {
        case 'image':
            return handleImageTask(task);
        case 'content-stream':
            return handleContentStreamTask(task);
        default:
            return { success: false, error: `Unknown task type: ${task.type}` };
    }
}

// Environment detection and setup
const IS_NODE = typeof process !== 'undefined' && process.versions?.node;

if (IS_NODE) {
    const { parentPort } = await import('worker_threads');
    parentPort?.on('message', async (task) => {
        const result = await handleMessage(task);
        parentPort.postMessage(result, result.data ? [result.data] : []);
    });
    parentPort?.postMessage({ type: 'ready' });
} else {
    self.onmessage = async (event) => {
        const result = await handleMessage(event.data);
        self.postMessage(result, result.data ? [result.data] : []);
    };
    self.postMessage({ type: 'ready' });
}
```

## Task Format

### Image Task (to worker)

```javascript
{
    type: 'image',
    taskId: number,
    configuration: {
        renderingIntent: string,
        blackPointCompensation: boolean,
        useAdaptiveBPCClamping: boolean,
        destinationColorSpace: 'CMYK' | 'RGB',
        destinationProfile: ArrayBuffer,  // Transferable
        compressOutput: boolean,
    },
    input: {
        streamRef: string,
        streamData: ArrayBuffer,  // Transferable
        isCompressed: boolean,
        width: number,
        height: number,
        colorSpace: 'RGB' | 'Gray' | 'Lab',
        bitsPerComponent: number,
        sourceProfile: ArrayBuffer | 'sRGB' | 'sGray' | 'Lab',
    }
}
```

### Image Result (from worker)

```javascript
{
    success: boolean,
    taskId: number,
    streamRef: string,
    data: ArrayBuffer,  // Transferable
    isCompressed: boolean,
    colorSpace: 'CMYK' | 'RGB',
    bitsPerComponent: 8,
    error?: string,
}
```

### Content Stream Task (to worker)

```javascript
{
    type: 'content-stream',
    taskId: number,
    configuration: {
        renderingIntent: string,
        blackPointCompensation: boolean,
        destinationColorSpace: 'CMYK' | 'RGB',
        destinationProfile: ArrayBuffer,
        sourceRGBProfile: ArrayBuffer | 'sRGB',
        sourceGrayProfile: ArrayBuffer | 'sGray',
    },
    input: {
        streamRef: string,
        streamText: string,
        colorSpaceDefinitions: object,
        initialColorSpaceState?: { strokeColorSpace?: string, fillColorSpace?: string },
    }
}
```

### Content Stream Result (from worker)

```javascript
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

## Key Constraints

1. **ColorEngineService cannot be serialized** (WASM state)
   - Each worker creates its own singleton instance
   - Transform caching works within each worker's instance

2. **Content streams must be sequential**
   - Color space state carries across streams on same page
   - Cannot parallelize content streams within a page
   - Images CAN be fully parallelized

3. **Configuration IS serializable**
   - Primitives + ArrayBuffer
   - No class instances in task data
   - Profiles as ArrayBuffer (pre-decompressed)

4. **Isomorphic requirements**
   - Node.js: `worker_threads`
   - Browser: `Web Workers`
   - Same entrypoint script works in both

## Verification

1. Run existing test suite: `yarn test`
2. Compare output PDFs between:
   - Main thread only (no workers)
   - Worker mode
   - Legacy `services/` implementation
3. Pixel-by-pixel comparison should show identical results
