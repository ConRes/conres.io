# 2026-02-16 Concurrency Progress

## Goal

Investigate and resolve worker/concurrency regressions in `classes/baseline/`. The main thread implementation now works well across Safari, Chrome, and Firefox after recent memory optimization work. Workers are no longer usable in any browser (they were previously at least usable in Safari). The regression was introduced by Claude insisting on "fixing" what was never actually broken.

### Two Distinct Worker Concerns

1. **Bootstrap Worker** (PRIMARY — `2025/generator/`)
   A single dedicated worker that runs the entire generation process off the main thread: `TestFormPDFDocumentGenerator`, `AssetPagePreConverter`, `PDFDocumentColorConverter`(s), and any other blocking functionality. This is what "do not block main thread" means — move the whole generation pipeline into a worker so the UI stays responsive.

2. **Parallel Workers** (SECONDARY — `classes/baseline/` worker pool)
   The existing worker-pool functionality in `PDFDocumentColorConverter` and related classes for parallel image/content-stream conversion. This is the adaptive isomorphic concurrency layer. Lower priority for now — the main thread implementation works.

### Immediate Goal

**Implement and test a working Bootstrap Worker.**

---

## Roadmap

### Bootstrap Worker (PRIMARY)

- [x] **Phase B1: Design Bootstrap Worker architecture**
  - [x] Identify what the Bootstrap Worker runs (generator pipeline, asset pre-conversion, color conversion)
  - [x] Identify module dependencies and import chain from the generator entry point
  - [x] Determine message protocol: main thread ↔ Bootstrap Worker (progress, errors, results)
  - [x] Determine how the generator UI (`TestFormGeneratorAppElement`) communicates with the worker

- [x] **Phase B2: Implement Bootstrap Worker**
  - [x] Change 8 bare specifiers to relative paths (pdf-lib, icc) in import chain
  - [x] Create Bootstrap Worker entrypoint (`generator/bootstrap-worker-entrypoint.js`)
  - [x] Implement message protocol for progress reporting back to the UI
  - [x] Handle PDF output transfer (ArrayBuffer via `postMessage` transferables)
  - [x] Update `TestFormGeneratorAppElement` with `#runInBootstrapWorker()` and `#runOnMainThread()` branches
  - [x] Read new checkbox IDs (`#bootstrap-worker-checkbox`, `#parallel-workers-checkbox`)

- [ ] **Phase B3: Test Bootstrap Worker** `IN-PROGRESS`
  - [ ] Test in Safari, Chrome, Firefox
  - [ ] Verify UI remains responsive during generation
  - [ ] Verify generation output matches main-thread output

### Parallel Workers (SECONDARY — deferred)

- [ ] **Phase P1: Reproduce and characterize parallel worker failures**
  - [ ] Fix error swallowing in `worker-pool.js` (Issue 1) to reveal actual errors
  - [ ] Run browser diagnostic (`experiments/scripts/diagnose-worker-lifecycle.html`)
  - [ ] Document exact error messages in Safari, Chrome, Firefox

- [ ] **Phase P2: Root cause analysis and fix**
  - [ ] Trace the complete worker lifecycle: creation → ready → shared-config → first task → result
  - [ ] Fix any module resolution, WASM loading, or message handling issues
  - [ ] Harden pako fallback, add JSON import fallback if needed

- [ ] **Phase P3: Back-pressure and memory management**
  - [ ] Implement task concurrency cap (current: unbounded `Promise.all()`)
  - [ ] Add memory budget tracking for in-flight worker tasks

- [ ] **Phase P4: Cross-browser validation**
  - [ ] Test Safari, Chrome, Firefox, Node.js

---

## Current Status

**Last Updated:** 2026-02-16

**Focus:** Phase B3 — Test Bootstrap Worker in browsers. Implementation complete, needs browser verification.

---

## Architecture Overview

### Module Dependency Chain (Worker Context)

When a browser Web Worker is created, the following module chain loads:

```
worker-pool-entrypoint.js  (dynamic imports only, no static deps)
  ├─ ./color-engine-provider.js  (via importModule)
  │   ├─ ../../packages/color-engine/src/index.js  (STATIC — triggers WASM load)
  │   │   ├─ ../dist/color-engine.js  (Emscripten loader)
  │   │   │   └─ color-engine.wasm  (via fetch + WebAssembly.instantiate)
  │   │   └─ ./constants.js
  │   └─ ../../packages/color-engine/src/constants.js  (STATIC import)
  ├─ ./pdf-image-color-converter.js  (via importModule)
  │   └─ ./image-color-converter.js
  │       ├─ ../../packages/color-engine/src/index.js  (STATIC — constants, deduped)
  │       └─ ./color-converter.js
  │           ├─ ../diagnostics/diagnostics-collector.js
  │           ├─ ./color-engine-provider.js  (already loaded)
  │           └─ ./color-conversion-policy.js
  │               ├─ ../../packages/color-engine/src/constants.js  (STATIC)
  │               ├─ ./color-engine-provider.js  (already loaded)
  │               └─ ../configurations/color-conversion-rules.json  (TOP-LEVEL AWAIT)
  │                   via import() with { with: { type: "json" } }
  ├─ ./pdf-content-stream-color-converter.js  (via importModule)
  │   └─ ./lookup-table-color-converter.js
  │       └─ ./color-converter.js  (already loaded)
  └─ ../diagnostics/auxiliary-diagnostics-collector.js  (via importModule, if diagnostics enabled)
```

**Key observations:**
- All static imports use **relative paths** — no bare specifiers in the static chain
- The color engine WASM loads via `new URL("color-engine.wasm", import.meta.url).href` + `fetch()`
- `packages/color-engine` is a **symlink** to `color-engine-2026-02-14` — web server must follow symlinks
- Pako is loaded separately via `import(sharedConfig?.pakoPackageEntrypoint ?? 'pako')` — the entrypoint URL is resolved on the main thread and broadcast to workers; bare `'pako'` fallback will fail in workers
- `color-conversion-policy.js` uses `import()` with `{ with: { type: "json" } }` (import attributes) — browser support varies; this is a top-level `await` that blocks the entire module chain
- `image-color-converter.js` also statically imports `../../packages/color-engine/src/index.js` (constants only, but triggers full module load including WASM on first encounter)

### Worker Lifecycle

```
Main Thread                              Worker
─────────────────────────────────────────────────────────────
1. new Worker(url, {type:'module'})  →   Module loads
2. setupMessageHandlers(workerInfo)      (top-level code executes)
3. waitForWorkerReady(worker)            self.onmessage = handleMessage
                                    ←   self.postMessage({type:'ready'})
4. Ready resolved
5. broadcastSharedProfiles(config)  →   sharedConfig = {...}
6. submitTask(task)                 →   handleMessage(task)
                                         initColorEngineProvider()
                                         initCompression() (for content-stream)
                                         processImage() / processContentStream()
                                    ←   sendResult(result)
7. handleWorkerResult(result)
```

### Key Files

| File                                    | Role                                             | Lines |
| --------------------------------------- | ------------------------------------------------ | ----- |
| `worker-pool.js`                        | Isomorphic worker pool (Node + browser)          | 824   |
| `worker-pool-entrypoint.js`             | Worker script — message handler, lazy init       | 616   |
| `composite-color-converter.js`          | Base class managing WorkerPool lifecycle         | 204   |
| `pdf-page-color-converter.js`           | Page-level coordinator — image + stream dispatch | 1275  |
| `pdf-document-color-converter.js`       | Document-level orchestrator — profiles, pages    | 1286  |
| `pdf-image-color-converter.js`          | Image conversion with compress/decompress        | ~800  |
| `pdf-content-stream-color-converter.js` | Content stream parse/convert/rebuild             | ~600  |
| `color-engine-provider.js`              | WASM engine lifecycle wrapper                    | ~520  |
| `color-conversion-policy.js`            | Policy-driven format/transform decisions         | ~400  |

### Consumer: Generator (`generator/classes/asset-page-pre-converter.js`)

- Creates shared WorkerPool (limited to **2 workers** for browser memory)
- Groups assets by conversion chain
- One `PDFDocumentColorConverter` per chain, passes shared `workerPool`
- Calls `dispose()` to terminate shared pool after all chains complete

---

## Identified Potential Issues

### Issue 1: Worker Error Swallowed During Initialization

**Location:** `worker-pool.js` lines 373-441

**Problem:** The `#setupMessageHandlers` sets an `onerror` handler that calls `#handleWorkerError`, which only logs the error and calls `#processQueue()`. It does NOT reject the ready promise. If the worker module fails to load (e.g., import error, WASM fetch failure), the `onerror` fires but the ready promise just times out after 10 seconds with a generic "Worker X initialization timeout" message. The real error is lost.

**Impact:** Debugging worker failures is extremely difficult — the actual error (e.g., "Failed to resolve module specifier") is logged to the browser console but not surfaced in the rejection.

**Fix:** Wire the worker's `onerror` into the ready promise rejection.

### Issue 2: Browser Workers Lack `colorEnginePath` Configuration

**Location:** `worker-pool.js` line 349, `worker-pool-entrypoint.js` lines 135-140

**Problem:** Node.js workers receive `workerData` containing `colorEnginePath`. Browser workers receive nothing — the `Worker` constructor doesn't support `workerData`. The entrypoint falls back to `DEFAULT_ENGINE_PATH` (`'../../packages/color-engine/src/index.js'`), which resolves relative to `color-engine-provider.js`.

**Assessment:** This is probably correct for the default case (symlinked `packages/color-engine`), but prevents version-specific color engine paths in browser workers. If the consumer specifies a non-default engine path, it won't reach browser workers.

**Status:** Low severity for current usage. Worth noting for future flexibility.

### Issue 3: No Back-Pressure on Worker Task Submission

**Location:** `pdf-page-color-converter.js` line ~441

**Problem:** `#convertImagesViaWorkers()` uses `Promise.all()` to submit ALL worker image tasks simultaneously. Each task carries compressed pixel data (potentially megabytes per image). With many images on a page, this can exhaust memory before workers finish processing earlier tasks.

**Existing mitigation:** The worker pool's `#processQueue()` only dispatches to available workers, so tasks queue internally. But the `Promise.all()` creates all promises (and allocates all task messages) upfront.

**Impact:** Memory spike during task submission phase. May cause OOM on memory-constrained pages with many images.

### Issue 4: `import.meta.resolve()` May Not Work in All Worker Contexts

**Location:** `worker-pool-entrypoint.js` line 48

**Problem:** `import.meta.resolve()` is used to resolve module specifiers before dynamic `import()`. While this API is supported in modern browsers, its behavior in module-type Web Workers may vary:
- Chrome: Supported since 105
- Firefox: Supported since 106
- Safari: Supported since 16.4

**Assessment:** Should work in current browser versions. BUT if the project needs to support older browsers, this is a compatibility concern.

### Issue 5: Emscripten WASM Loading via `navigator.userAgent` in Workers

**Location:** `packages/color-engine-2026-02-14/dist/color-engine.js` (top of file)

**Problem:** The Emscripten-generated color engine has a `navigator.userAgent` check at module load time that validates browser version. In workers, `navigator.userAgent` is available but the parsing logic includes:
```javascript
var userAgent = typeof navigator !== "undefined" && navigator.userAgent;
if (!userAgent) { return }
```
The early `return` here returns from the IIFE, NOT from the module — this is actually safe. But the version parsing for Safari checks for `Version/` in the UA string, which may differ in worker contexts in some browsers.

**Assessment:** Likely not the issue, but worth verifying.

### Issue 6: Race Condition in `#waitForWorkerReady` (Browser Path)

**Location:** `worker-pool.js` lines 422-438

**Problem:** The ready handler temporarily overrides `browserWorker.onmessage`. The sequence is:
1. `#setupMessageHandlers` sets `onmessage` to result handler
2. `#waitForWorkerReady` saves result handler as `originalHandler`
3. `#waitForWorkerReady` overwrites `onmessage` with ready handler
4. On receiving `{type: 'ready'}`, restores `originalHandler`

If the worker sends 'ready' between steps 1 and 3 (extremely unlikely for module workers due to async loading), the message is caught by the result handler and silently ignored.

**Assessment:** Very low probability due to module worker async loading. But a fragile pattern.

### Issue 7: Static Imports in `color-engine-provider.js` During Worker Load

**Location:** `color-engine-provider.js` lines 93-96

**Problem:** When the entrypoint dynamically imports `./color-engine-provider.js` in the worker, its static imports trigger:
```javascript
import { VERSION as COLOR_ENGINE_VERSION } from '../../packages/color-engine/src/index.js';
import { cmsFLAGS_MULTIPROFILE_BPC_SCALING } from '../../packages/color-engine/src/constants.js';
```
The `index.js` import triggers the Emscripten loader, which:
- Creates WASM memory
- Fetches `color-engine.wasm`
- Instantiates WASM
- Runs constructors

This all happens at MODULE LOAD TIME (top-level await in the Emscripten code). If the WASM fetch fails (e.g., CORS, network, wrong URL), the module load fails and the dynamic `import()` rejects. This rejection propagates up and would prevent the worker from processing ANY task.

**Key question:** Does the WASM URL resolve correctly when loaded from a worker? The URL is `new URL("color-engine.wasm", import.meta.url).href` where `import.meta.url` is the `dist/color-engine.js` URL as served by the web server. This depends on symlink resolution by the web server.

### Issue 8: Potential `import()` Failures Not Surfaced in Task Results

**Location:** `worker-pool-entrypoint.js` lines 211-295, 304-458

**Problem:** `processImage()` and `processContentStream()` catch errors and return `{ success: false, error: message }`. However, if `importModule()` fails (e.g., module doesn't load), the error is caught and returned. But the error message from a failed `import()` may be opaque (e.g., "TypeError: Failed to fetch dynamically imported module").

**Assessment:** The error handling structure is correct but error messages may not be helpful for diagnosing import failures.

### Issue 9 (Review 1): JSON Import Attributes in `color-conversion-policy.js`

**Location:** `color-conversion-policy.js` line 390

**Problem:** The module uses `import()` with `{ with: { type: "json" } }` to load `../configurations/color-conversion-rules.json`. This is a **top-level `await`** (line 320: `const COLOR_ENGINE_POLICIES = await (async () => { ... })()`) that blocks the entire module from loading. If `{ with: { type: "json" } }` is not supported in a given browser's Web Worker context, the entire module chain fails:
```
color-conversion-policy.js FAILS → color-converter.js FAILS →
image-color-converter.js FAILS → pdf-image-color-converter.js FAILS →
worker entrypoint cannot process ANY image task
```

**Browser support for `import attributes` (`with` keyword):**
- Chrome: Supported since 123 (March 2024)
- Safari: Supported since 17.2 (December 2023)
- Firefox: Supported since 128 (July 2024) — but Firefox ESR 115 does NOT support it

**Key observation:** The main thread uses this same code and works in all browsers — so this import attribute DOES work on the main thread. The question is whether it also works inside Web Workers in the same browsers. Module workers have the same module loading capabilities, so it SHOULD work. This needs verification.

**Assessment:** Unlikely to be the root cause since main thread works, but worth verifying in worker context. CRITICAL if targeting Firefox ESR.

### Issue 10 (Review 1): Pako Entrypoint Regression — Hardcoded Path → Bare Specifier Fallback

**Location:** `worker-pool-entrypoint.js` line 122, `pdf-image-color-converter.js` line 166

**Problem:** The backup version used a hardcoded relative path:
```javascript
// Backup (working):
pako = await importModule('../../packages/pako/dist/pako.mjs');
```
The current version depends on `sharedConfig`:
```javascript
// Current:
pako = await importModule(sharedConfig?.pakoPackageEntrypoint ?? 'pako');
```
And in `pdf-image-color-converter.js`:
```javascript
this.#pako = await import(entrypoint ?? 'pako');
```

If `sharedConfig.pakoPackageEntrypoint` is undefined or not yet set, the fallback `'pako'` is a bare specifier that **cannot resolve** in a Web Worker (no importmap access).

**Sequence analysis:** The main thread broadcasts `shared-config` (containing `pakoPackageEntrypoint`) before any tasks. Message order is preserved in Web Workers (single-threaded). So `sharedConfig` SHOULD be populated by the time `processImage()` runs. However, if `broadcastSharedProfiles()` is not called or `pakoPackageEntrypoint` is omitted, this silently falls back to the broken bare specifier.

**Assessment:** Medium risk. The sequence should be correct, but the fallback to bare `'pako'` is a latent bug that will manifest if the broadcast is ever missed.

---

## Changes Since Last Known Working State

Based on `2026-02-13-BASELINE-CLASSES-FIXES-PROGRESS.md` and `2026-02-15-BASELINE-CLEANUP-PROGRESS.md`:

### Changes from 2026-02-13 (Baseline Classes Fixes)

| Change                         | File                                                       | Description                                     |
| ------------------------------ | ---------------------------------------------------------- | ----------------------------------------------- |
| Multi-stage transform fallback | `image-color-converter.js`                                 | For K-Only GCR without multiprofile API         |
| Engine version derivation      | `worker-pool-entrypoint.js`                                | Changed to `colorEngineProvider.module.VERSION` |
| Removed hardcoded multiprofile | `pdf-content-stream-color-converter.js`                    | `requiresMultiprofileTransform: true` removed   |
| Config fallbacks               | `worker-pool-entrypoint.js`, `pdf-page-color-converter.js` | `outputBitsPerComponent`, `outputEndianness`    |

### Changes from 2026-02-15 (Baseline Cleanup)

| Change                      | File                           | Description                                              |
| --------------------------- | ------------------------------ | -------------------------------------------------------- |
| Pako entrypoint fix         | `worker-pool-entrypoint.js`    | Extract `pakoPackageEntrypoint` from shared-config       |
| Profile stripping safety    | `pdf-page-color-converter.js`  | Conditional `===` check before removing shared profiles  |
| ArrayBuffer neutering audit | `pdf-image-color-converter.js` | `.buffer.slice()` copies before transfer (verified safe) |
| Worker count alignment      | `worker-pool.js`               | `workerCount` default alignment                          |

---

## References

### Progress Documents

| Document                   | Location                                                        |
| -------------------------- | --------------------------------------------------------------- |
| Memory Management Progress | `~/…/generator/2026-02-15-MEMORY-MANAGEMENT-PROGRESS.md`        |
| Generator Progress         | `~/…/generator/PROGRESS.md`                                     |
| Baseline Cleanup Progress  | `~/…/experiments/2026-02-15-BASELINE-CLEANUP-PROGRESS.md`       |
| Baseline Classes Fixes     | `~/…/experiments/2026-02-13-BASELINE-CLASSES-FIXES-PROGRESS.md` |
| Diagnostics Progress       | `~/…/experiments/2026-01-27-DIAGNOSTICS-PROGRESS.md`            |
| Diagnostics Revision Plan  | `~/…/experiments/2026-01-27-DIAGNOSTICS-REVISION-PLAN.md`       |
| Diagnostics Changes        | `~/…/experiments/2026-01-31-DIAGNOSTICS-PROGRESS.md`            |
| Comparisons Progress       | `~/…/experiments/2026-02-02-COMPARISONS-PROGRESS.md`            |
| Image Masks Report         | `~/…/experiments/2026-02-12-PDF-IMAGE-MASKS-REPORT.md`          |

### Historical Plans

| Plan                           | Location                                            |
| ------------------------------ | --------------------------------------------------- |
| Separate-chains feature        | `~/.claude/plans/eager-launching-feigenbaum-001.md` |
| Radio-based strategy selection | `~/.claude/plans/eager-launching-feigenbaum-002.md` |
| Unified worker architecture    | `~/.claude/plans/composed-napping-engelbart.md`     |

### Backup

| Item                        | Location                   |
| --------------------------- | -------------------------- |
| Last known working baseline | `classes/baseline-backup/` |

---

## Key Questions for Decision

1. **Reproduce first or diff first?** ~~Should we reproduce the worker failures in-browser to get exact error messages, or diff against `baseline-backup/` to identify the breaking change?~~
   **RESOLVED (Review 2):** Both done. Diff revealed backup was also broken (bare `'pdf-lib'` specifier). Next step: fix Issue 1 + browser diagnostic to get exact error messages.

2. **Error surfacing priority:** ~~Should we fix error propagation first (Issue 1)?~~
   **RESOLVED (All reviews agree):** YES. Fix Issue 1 first. This is the single most impactful action.

3. **Scope of worker support:**
   **RESOLVED:** Two separate concerns:
   - **Bootstrap Worker** (PRIMARY): A single worker in `2025/generator/` that runs the entire generation pipeline off the main thread. Target: all browsers.
   - **Parallel Workers** (SECONDARY): The existing worker-pool for parallel conversion. Deferred — main thread works fine for now.

4. **Back-pressure strategy:** ~~For Issue 3 (unbounded `Promise.all()`), should we:~~
   **RESOLVED (Review 3):** Defer to Phase 5. Fix worker initialization first. Use semaphore pattern with `workerCount * 2` concurrent tasks when implementing.

5. **Testing approach:** ~~How to test worker functionality?~~
   **RESOLVED (Review 3):** Critical gap identified — no existing tests exercise `useWorkers: true`. Action plan:
   - First: browser diagnostic page (Action 2)
   - Then: Playwright test for worker lifecycle (Action 7)
   - Node.js tests are separate (worker_threads, not Web Workers)

6. **`createMultiprofileTransform` API:** ~~Array of intents vs single intent?~~
   **RESOLVED (Review 3):** Single intent is correct. LittleCMS API takes one `nIntent`. Current code is correct.

---

## Prioritized Action Plan

### Bootstrap Worker (PRIMARY)

| #   | Action                                                  | Location               | Description                                                                                                                                                          |
| --- | ------------------------------------------------------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Audit generator entry point and module dependencies** | `generator/`           | Map what `TestFormPDFDocumentGenerator`, `AssetPagePreConverter`, and related classes import — identify bare specifiers that won't resolve in a worker without importmap |
| 2   | **Design message protocol**                             | `generator/`           | Define main thread ↔ Bootstrap Worker messages: start, progress, error, result (PDF ArrayBuffer), cancel                                                             |
| 3   | **Create Bootstrap Worker entrypoint**                  | `generator/`           | Worker script that imports and runs the generation pipeline, reports progress back to UI                                                                              |
| 4   | **Update UI to use Bootstrap Worker**                   | `generator/elements/`  | `TestFormGeneratorAppElement` launches Bootstrap Worker instead of running generation on main thread                                                                  |
| 5   | **Test in all browsers**                                | `experiments/scripts/` | Verify Bootstrap Worker works in Safari, Chrome, Firefox; UI stays responsive                                                                                        |

### Parallel Workers (SECONDARY — deferred)

| #   | Action                                             | Files                                                       | Description                                                                                                                                               |
| --- | -------------------------------------------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 6   | **Fix Issue 1: Wire `onerror` into ready promise** | `worker-pool.js`                                            | In `#waitForWorkerReady` browser path, surface actual error message instead of 10s timeout                                                                |
| 7   | **Run browser diagnostic**                         | `experiments/scripts/diagnose-worker-lifecycle.html`         | Step-by-step lifecycle test for the parallel worker pool                                                                                                  |
| 8   | **Add JSON import fallback**                       | `color-conversion-policy.js`                                | Wrap `import()` with `{ with: { type: "json" } }` in try/catch, fall back to `fetch()` + `JSON.parse()`                                                  |
| 9   | **Harden pako fallback**                           | `worker-pool-entrypoint.js`, `pdf-image-color-converter.js` | Replace bare `'pako'` fallback with explicit error                                                                                                        |
| 10  | **Implement back-pressure**                        | `pdf-page-color-converter.js`                               | Semaphore with `workerCount * 2` max in-flight tasks                                                                                                      |

---

## Activity Log

| Date       | Activity                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-02-16 | Created progress document. Completed thorough code review of all worker-related files in `classes/baseline/`. Identified 8 potential issues. Documented architecture, module dependency chain, worker lifecycle, and all changes since last working state.                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 2026-02-16 | **Review 1 complete.** Found 2 additional issues: (9) JSON import attributes `{ with: { type: "json" } }` in `color-conversion-policy.js` — browser/worker compat concern, (10) pako bare specifier fallback regression. Updated dependency tree to include `image-color-converter.js` static import from color engine and `color-conversion-policy.js` JSON import. Priority: fix Issue 1 (error swallowing) first to reveal actual failure cause.                                                                                                                                                                                                                                                                             |
| 2026-02-16 | **Review 2 complete (forensic diff).** Key findings: (1) Backup was ALSO broken for workers due to bare `'pdf-lib'` import via legacy `ColorEngineService` init — the current fix skipping legacy init is correct and necessary. (2) If workers still fail, the failure is during TASK EXECUTION (not init), since the worker entrypoint has no static imports and should send 'ready' successfully. (3) `createMultiprofileTransform` API signature changed (intents array → single intent) — needs verification. (4) All modules in worker chain use relative paths — no bare specifiers in static imports. (5) Recommended: fix Issue 1 first, then create browser diagnostic to determine WHERE exactly the failure occurs. |
| 2026-02-16 | **Review 3 complete (investigation plan).** Verified: `createMultiprofileTransform` takes single intent — current code is correct (not a bug). `http-server` follows symlinks with CORS enabled — server is not the issue. **Critical gap: no existing tests exercise workers with `useWorkers: true`**. Produced 10-item prioritized action plan. Top 2 actions: (1) Fix onerror swallowing to reveal real errors, (2) Build browser diagnostic page. Created diagnostic specification for `experiments/scripts/diagnose-worker-lifecycle.html`.                                                                                                                                                                               |
| 2026-02-16 | **Scope clarified by user.** Two separate worker concerns: (1) **Bootstrap Worker** (PRIMARY) — a single worker in `generator/` running the entire generation pipeline off the main thread, (2) **Parallel Workers** (SECONDARY) — existing worker-pool for parallel conversion, deferred. Immediate goal: implement and test a working Bootstrap Worker. Roadmap and action plan restructured accordingly.                                                                                                                                                                                                                                                                                                                      |
| 2026-02-16 | **Bootstrap Worker implemented (Phase B2 complete).** Changed 8 bare specifiers to relative paths in the import chain: `helpers.js`, `services/PDFService.js`, `services/ICCService.js`, `services/ColorSpaceUtils.js`, `generator/classes/test-form-pdf-document-generator.js`, `generator/classes/asset-page-pre-converter.js`, `classes/baseline/pdf-document-color-converter.js`, `classes/baseline/pdf-page-color-converter.js`. Created `generator/bootstrap-worker-entrypoint.js` — module worker that imports and runs `TestFormPDFDocumentGenerator.generate()`, posts progress/result/error messages back. Rewrote `TestFormGeneratorAppElement` with `#runInBootstrapWorker()` (creates module worker, sends inputs via transferable ArrayBuffer, receives progress/result) and `#runOnMainThread()` (preserved existing behavior). Reads new checkbox IDs `#bootstrap-worker-checkbox` and `#parallel-workers-checkbox`. |
| 2026-02-16 | **Bare specifier fixes continued (Phase B3 prep).** Fixed 2 missed bare `'pdf-lib'` imports in `services/ColorEngineService.js` and `services/WorkerColorConversion.js` (also fixed `'pako'` in WorkerColorConversion). Fixed `import.meta.resolve('pako')` in `baseline/pdf-document-color-converter.js:199` → `new URL('../../packages/pako/dist/pako.mjs', import.meta.url).href`. Fixed bare `'pako'` fallbacks in 7 more files: `baseline/pdf-image-color-converter.js:166`, `baseline/pdf-image-color-sampler.js:185`, `baseline/worker-pool-entrypoint.js:122`, `baseline/pdf-page-color-converter.js:992` (dynamic `import('pdf-lib')`), `classes/pdf-document-color-converter.js:216`, `classes/pdf-image-color-converter.js:151`, `classes/pdf-image-color-sampler.js:184`. Verified `services/helpers/pdf-lib.js` already has correct try/catch fallback pattern. Full import chain audit confirms no remaining bare specifiers in the bootstrap worker's dependency tree. |
