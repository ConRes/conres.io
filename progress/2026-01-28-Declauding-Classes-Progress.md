# Declauding Classes Progress

**Goal**: Decouple the `classes/` folder (refactored implementation) from `services/` folder (legacy implementation). Create self-contained, isomorphic worker infrastructure within `classes/`.

**Last Updated**: 2026-01-28

---

## Roadmap

### Phase 1: Create `classes/worker-pool.js`

- [ ] Create clean worker pool implementation in `classes/worker-pool.js`
- [ ] Isomorphic: Node.js (`worker_threads`) and browser (`Web Workers`)
- [ ] No dependencies on `services/` folder
- [ ] Support diagnostics via MessageChannel (optional)

### Phase 2: Create `classes/worker-pool-entrypoint.js`

- [ ] Create worker entrypoint that instantiates ColorConverter classes
- [ ] Handle `image` tasks via `PDFImageColorConverter`
- [ ] Handle `content-stream` tasks via `PDFContentStreamColorConverter`
- [ ] Worker creates its own `ColorEngineService` instance (singleton per worker)
- [ ] Same class logic as main thread — no code duplication

### Phase 3: Update `CompositeColorConverter`

- [ ] Change import from `../services/WorkerPool.js` to `./worker-pool.js`
- [ ] Update type references to use local worker pool
- [ ] Verify existing API contract is preserved

### Phase 4: Wire Up Worker Dispatch

- [ ] Update `PDFPageColorConverter.convertColor()` to dispatch to workers
- [ ] Use `prepareWorkerTask()` to create serializable tasks
- [ ] Use `applyWorkerResult()` to apply results back to PDF
- [ ] Images can be parallelized; content streams must be sequential

### Phase 5: Testing and Verification

- [ ] Verify worker mode produces identical results to main thread
- [ ] Run existing test suite: `yarn test`
- [ ] Run benchmark comparison with legacy

### Phase 6: Cleanup (Optional)

- [ ] Remove dead `prepareWorkerTask`/`applyWorkerResult` code if unused
- [ ] Document the decoupled architecture

---

## Current Status

**Focus**: Phase 1 - Create `classes/worker-pool.js`

---

## Architecture

```
classes/                          services/ (LEGACY - UNTOUCHED)
─────────────────────────────     ──────────────────────────────
worker-pool.js          ←─────┐   WorkerPool.js
worker-pool-entrypoint.js     │   StreamTransformWorker.js
                              │   WorkerColorConversion.js
composite-color-converter.js ─┘   PDFService.js
  └── imports ./worker-pool.js      └── imports ./WorkerPool.js

NO CROSS-DEPENDENCIES: classes/ does NOT import from services/
```

## Key Constraints

1. **Isomorphic**: Works in Node.js and browser
2. **Self-contained**: `classes/` has no imports from `services/`
3. **Same classes everywhere**: Worker uses same ColorConverter classes as main thread
4. **Legacy untouched**: `services/` continues to work as-is
5. **ColorEngineService per worker**: WASM state cannot be serialized

---

## Activity Log

### 2026-01-28

- Revised goal: Decouple classes from services (not just eliminate duplication)
- Identified coupling point: `composite-color-converter.js:104` imports `../services/WorkerPool.js`
- Plan: Create `classes/worker-pool.js` and `classes/worker-pool-entrypoint.js`
