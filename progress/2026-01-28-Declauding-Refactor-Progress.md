# Declauding Refactor Progress

**Goal**: Create a self-contained, isomorphic `classes/` module by:

1. Eliminating `ColorEngineService` dependency (distribute to `ColorEngine` + `ColorConverter` + Policy classes)
2. Creating `classes/worker-pool.js` and `classes/worker-pool-entrypoint.js`
3. Using `ColorConversionPolicy` for all format decisions (no hardcoded 8-bit)

**Last Updated**: 2026-01-28

**Claude Sessions**:

- `claude --resume f18d7b24-52e0-4578-bcbb-a8dcc0752047`

---

## Roadmap

### Phase 1: Create `classes/color-engine-provider.js` ✅

- [x] Create thin WASM wrapper class (~280 lines)
- [x] **Dynamic import** for version flexibility: `await import(enginePath)`
- [x] Pass-through methods to LittleCMS (no business logic)
- [x] Lifecycle management (initialize, dispose)
- [x] Export LittleCMS constants for external use
- [x] Accept optional `enginePath` in constructor for version selection
- [x] **Unit tests** (`tests/classes/color-engine-provider.test.js`): 11 tests passing
  - [x] `initialize()` creates engine instance
  - [x] `initialize()` is idempotent
  - [x] Throws when accessing engine before initialize
  - [x] `getConstants()` returns LittleCMS constants
  - [x] `createLab4Profile()` creates Lab profile
  - [x] `openProfileFromMem()` opens ICC profile from ArrayBuffer
  - [x] `createTransform()` creates valid transform
  - [x] `transformArray()` converts pixels correctly
  - [x] `dispose()` clears engine state
  - [x] `dispose()` is idempotent
  - [x] Accepts custom `enginePath` option

### Phase 2: Baseline Testing ✅

Establishes baseline verification before refactoring phases 3-9.

- [x] Verify 8-bit conversions work (existing regression)
- [x] Verify worker mode matches main thread output (existing tests)
- [x] Run full test suite: `yarn test` - **278 passing**, 4 unrelated failures
- [x] Real PDF conversion comparison (new vs legacy)
- [x] **Full regression tests** (existing in `tests/classes/color-converter-classes.test.js`):
  - [x] Real PDF conversion with 8-bit images
  - [x] Real PDF conversion with content streams
  - [x] Worker mode vs main thread output comparison
  - [x] K-Only GCR rendering intent
  - [x] Lab image handling (Relative Colorimetric fallback)
- [x] **Import verification**:
  - [x] `classes/` has ONE import from `services/helpers/pdf-lib.js` - compression utility only
  - [x] All legacy tests pass unchanged

**Baseline Results**:

| Test | New Implementation | Legacy Implementation | Notes |
|------|-------------------|----------------------|-------|
| Type Sizes PDF (K-Only) | 1719ms, 11 streams | 964ms, 12914 ops | Different count semantics |
| Output file size | 2,758,495 bytes | 2,758,543 bytes | 48 bytes difference (metadata) |
| Test suite | 278 pass | N/A | 4 unrelated `toCompactText` failures |

**Remaining services/ dependency** (baseline):
- `pdf-page-color-converter.js` imports `compressWithFlateDecode` from `services/helpers/pdf-lib.js`
- This is a pure compression utility (pako/zlib wrapper), NOT legacy business logic

### Phase 3: Enhance `ColorConverter` Base Class ✅

- [x] Add profile cache (`#profileCache`, `#profileHandleCache`)
- [x] Add transform cache (`#transformCache`, `#multiprofileTransformCache`)
- [x] Add `#openProfile(source)` method
- [x] Add `#getOrCreateTransform()` method
- [x] Add `#getOrCreateMultiprofileTransform()` method
- [x] Replace `ColorEngineService` import with `ColorEngineProvider` import
- [x] Accept `ColorEngineColorConversionPolicy` in configuration
- [x] Use policy for format determination in `convertColorsBuffer()`
- [x] Backward compatibility: `colorEngineService` getter and option retained for unmigrated subclasses
- [x] **Unit tests** pass (6 tests in `tests/classes/color-converter.test.js`)
- [x] **All 255 class tests pass** - full backward compatibility verified

### Phase 4: Update `ImageColorConverter` ✅

- [x] Remove hardcoded `COLOR_TYPE_TO_FORMAT` mapping
- [x] Remove fallback profile logic (`COLOR_TYPE_TO_DEFAULT_PROFILE`)
- [x] Use parent's `convertColorsBuffer()` instead of `colorEngineService.convertPixelBuffer()`
- [x] Support `Uint8Array | Uint16Array | Float32Array` buffers (type definitions)
- [x] Pass `bitsPerComponent` and `isBigEndian` through to parent
- [x] Mark legacy constants as `@deprecated` (kept for backward compat)
- [x] **All 255 class tests pass**

### Phase 5: Update `PDFImageColorConverter` ✅

- [x] Pass actual bit depth (8 or 16) to parent's `convertColor()`
- [x] Only normalize non-standard bit depths (1, 2, 4) to 8-bit
- [x] Pass `isBigEndian: true` for PDF's big-endian 16-bit data
- [x] Update type definitions for `sourceProfile` (no fallbacks except Lab)
- [x] Update constructor JSDoc for new options
- [x] Preserve output bit depth in result (not forced 8-bit)
- [x] **All 255 class tests pass**

### Phase 6: Create `classes/worker-pool.js` ✅

- [x] Isomorphic implementation (Node.js `worker_threads` + browser `Web Workers`)
- [x] Task queue with round-robin dispatch (first available worker)
- [x] Diagnostics MessageChannel support (optional)
- [x] No dependencies on `services/` folder
- [x] Support for `image`, `content-stream`, `transform`, and `benchmark` task types
- [ ] **Unit tests** (`tests/classes/worker-pool.test.js`): DEFERRED to Phase 10
  - Tests require worker entrypoint to be fully working

### Phase 7: Create `classes/worker-pool-entrypoint.js` ✅

- [x] `ColorEngineProvider` singleton per worker
- [x] Handle `image` tasks via `ImageColorConverter`
- [x] Handle `content-stream` tasks via `PDFContentStreamColorConverter`
- [x] Handle `transform` tasks for raw pixel buffers
- [x] Same class logic as main thread (uses ColorConverter classes)
- [x] Isomorphic initialization (Node.js + browser)
- [x] Diagnostics support via AuxiliaryDiagnosticsCollector
- [ ] **Integration tests**: DEFERRED to Phase 10
  - Requires real PDF conversion to validate end-to-end

### Phase 8: Update `CompositeColorConverter` ✅

- [x] Change import from `../services/WorkerPool.js` to `./worker-pool.js`
- [x] Update type references in configuration typedef
- [x] Update constructor options type (colorEngineProvider)
- [x] Updated `PDFPageColorConverter` type reference
- [x] API contract preserved (same public interface)
- [x] **All 255 class tests pass** (existing tests still work)
- [x] Verified: Only remaining `services/` import is `compressWithFlateDecode` (pure utility)

### Phase 9: Wire Up Worker Dispatch in `PDFPageColorConverter` ✅

- [x] Dispatch image tasks to worker pool via `workerPool.submitImage()`
- [x] Use `prepareWorkerTask()` for task preparation
- [x] Parallelize images via `Promise.all()` with worker pool
- [x] Content streams remain sequential (color space state tracking)
- [x] Indexed images converted on main thread (lookup table conversion)
- [x] Created `#convertImagesViaWorkers()` method for worker dispatch
- [x] **All 255 class tests pass**
- [ ] **Integration tests** (pending - Phase 10):
  - [ ] Worker mode produces same output as main thread
  - [ ] Images dispatched in parallel
  - [ ] Content streams processed sequentially
  - [ ] `applyWorkerResult()` correctly applies changes

### Phase 10: Verification Testing

Final verification after all refactoring phases (3-9) are complete.

- [ ] Verify 8-bit conversions still work (regression from baseline)
- [ ] Add 16-bit conversion tests (new capability from Phase 4-5)
- [ ] Verify worker mode matches main thread output
- [ ] Run full test suite: `yarn test`
- [ ] Real PDF conversion comparison (new vs legacy)
- [ ] **Full regression tests** (`tests/classes/color-converter-classes.test.js`):
  - [ ] Real PDF conversion with 8-bit images
  - [ ] Real PDF conversion with 16-bit images (new)
  - [ ] Real PDF conversion with content streams
  - [ ] Worker mode vs main thread output comparison
  - [ ] K-Only GCR rendering intent
  - [ ] Lab image handling (Relative Colorimetric fallback)
- [ ] **Import verification**:
  - [ ] `classes/` has NO imports from `services/` folder (excluding pure utilities)
  - [ ] All legacy tests pass unchanged
- [ ] **Benchmark comparison**: WAIT FOR USER INSTRUCTIONS
  - [ ] Compare performance with baseline results
  - [ ] Document any regressions or improvements

---

## Current Status

**Phases 1-9 complete. Ready for Phase 10 verification.**

- Phase 1: `classes/color-engine-provider.js` created with 11 passing tests ✅
- Phase 2: Baseline testing complete - 278 tests passing, real PDF conversion verified ✅
- Phase 3: `ColorConverter` enhanced with caching and `ColorEngineProvider` ✅
- Phase 4: `ImageColorConverter` updated for 16-bit support ✅
- Phase 5: `PDFImageColorConverter` updated for 16-bit PDF images ✅
- Phase 6: `classes/worker-pool.js` created (isomorphic worker pool) ✅
- Phase 7: `classes/worker-pool-entrypoint.js` created (uses ColorConverter classes) ✅
- Phase 8: `CompositeColorConverter` and `PDFPageColorConverter` imports updated ✅
- Phase 9: Worker dispatch wired up in `PDFPageColorConverter` ✅

**All 255 class tests pass** after Phases 3-9.

**Next step**:
- Phase 10: Verification testing - **WAIT FOR USER INSTRUCTIONS** for benchmark comparison

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              classes/ (SELF-CONTAINED)                       │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  color-engine-provider.js           color-conversion-policy.js              │
│  ────────────────────────           ──────────────────────────              │
│  • WASM lifecycle only              • Format determination (8/16/32-bit)    │
│  • Pass-through to LittleCMS        • Buffer creation (typed arrays)        │
│  • No business logic                • getInputFormat/getOutputFormat        │
│                                                                             │
│  color-engine-color-conversion-policy.js                                    │
│  ───────────────────────────────────────                                    │
│  • Multiprofile detection                                                   │
│  • K-Only GCR handling                                                      │
│  • Rendering intent mapping                                                 │
│                                                                             │
│  color-converter.js                                                         │
│  ─────────────────                                                          │
│  • Profile cache (handles + buffers)                                        │
│  • Transform cache (single + multiprofile)                                  │
│  • Uses ColorEngineProvider for WASM                                        │
│  • Uses Policy for format decisions                                         │
│                                                                             │
│  worker-pool.js                     worker-pool-entrypoint.js               │
│  ──────────────                     ─────────────────────────               │
│  • Isomorphic (Node + browser)      • ColorEngineProvider per worker        │
│  • Task queue + dispatch            • Instantiates ColorConverter classes   │
│                                                                             │
│  composite-color-converter.js ────► worker-pool.js (local import)           │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                           services/ (LEGACY - UNTOUCHED)                    │
├─────────────────────────────────────────────────────────────────────────────┤
│  ColorEngineService.js              • Hardcoded 8-bit (legacy noise)        │
│  WorkerPool.js                      • Legacy worker pool                    │
│  StreamTransformWorker.js           • Procedural worker code                │
│  PDFService.js                      • Uses legacy services                  │
└─────────────────────────────────────────────────────────────────────────────┘

                         ⬆ NO CROSS-DEPENDENCIES ⬆
                classes/ does NOT import from services/
```

## Key Constraints

1. **Isomorphic**: Works in Node.js and browser
2. **Self-contained**: `classes/` has no imports from `services/`
3. **No hardcoded formats**: All format decisions via `ColorConversionPolicy`
4. **Same classes everywhere**: Worker uses same ColorConverter classes as main thread
5. **Legacy untouched**: `services/` continues to work as-is
6. **ColorEngineProvider per worker**: WASM state cannot be serialized

---

## Anti-Patterns to Avoid (Legacy Flaws)

### 1. NO Fallback Profiles (Except Lab)

**Legacy flaw**: Used `createSRGBProfile()`, `createGray2Profile()` as silent fallbacks when no profile was provided.

**Correct behavior**: Only convert using **actual embedded ICC profiles**. If no profile is available, **fail explicitly** with a clear error message.

**Exception**: Lab is NOT an ICCBased colorspace in PDF - it's device-independent and defined by CIE standards. `createLab4Profile()` is allowed because Lab data never has an embedded ICC profile.

```javascript
// ❌ WRONG (legacy pattern)
if (source === 'sRGB') {
    handle = engine.createSRGBProfile();  // Silent fallback - NO!
}
if (source === 'sGray') {
    handle = engine.createGray2Profile();  // Silent fallback - NO!
}

// ✅ CORRECT for RGB/Gray/CMYK
if (!sourceProfile || !(sourceProfile instanceof ArrayBuffer)) {
    throw new Error('Source ICC profile is required - no fallback profiles allowed');
}

// ✅ CORRECT for Lab (exception - Lab has no ICC profile in PDF)
if (colorSpace === 'Lab') {
    handle = engine.createLab4Profile();  // OK - Lab is device-independent
}
```

### 2. NO Silent Error Catching

**Legacy flaw**: Caught errors silently, making debugging impossible.

```javascript
// ❌ WRONG (legacy pattern)
try {
    colorEngine.initBPCClamping(transform, inputChannels, outputChannels);
} catch (e) {
    // Silently ignored - impossible to debug
}

// ✅ CORRECT
colorEngine.initBPCClamping(transform, inputChannels, outputChannels);
// Let errors propagate - caller decides how to handle
```

### 3. NO Magic String Identifiers (Except Lab)

**Legacy flaw**: Used magic strings like `'sRGB'`, `'sGray'`, `'Lab'` as profile identifiers that triggered fallback behavior.

**Correct behavior**: Profiles for ICCBased colorspaces (RGB, Gray, CMYK) must be `ArrayBuffer` instances containing actual ICC data. Lab is the only exception.

```javascript
// ❌ WRONG (legacy pattern)
async loadProfile(source) {
    if (source === 'sRGB') return 'sRGB';  // Magic string - NO!
    if (source === 'sGray') return 'sGray';  // Magic string - NO!
}

// ✅ CORRECT
async loadProfile(source, colorSpace) {
    if (colorSpace === 'Lab') {
        return 'Lab';  // OK - Lab is device-independent, no ICC profile
    }
    if (!(source instanceof ArrayBuffer)) {
        throw new Error('Profile must be ArrayBuffer containing ICC data');
    }
    return source;
}
```

---

## Files to Create

| File | Purpose | Lines (est.) |
|------|---------|--------------|
| `classes/color-engine-provider.js` | Thin WASM wrapper | ~80 |
| `classes/worker-pool.js` | Isomorphic worker pool | ~200 |
| `classes/worker-pool-entrypoint.js` | Worker script using classes | ~150 |

## Files to Modify

| File | Changes |
|------|---------|
| `classes/color-converter.js` | Add caching, use policy, use ColorEngineProvider |
| `classes/image-color-converter.js` | Remove hardcoded formats, use policy |
| `classes/pdf-image-color-converter.js` | Remove `#normalizeBitsPerComponent()` |
| `classes/composite-color-converter.js` | Import `./worker-pool.js` |
| `classes/pdf-page-color-converter.js` | Wire up worker dispatch |

## Files NOT Modified (Legacy)

| File | Reason |
|------|--------|
| `services/ColorEngineService.js` | Legacy code, stays as-is |
| `services/WorkerPool.js` | Legacy code, stays as-is |
| `services/StreamTransformWorker.js` | Legacy code, stays as-is |
| `services/PDFService.js` | Uses legacy services |

---

## Completed Work (from prior efforts)

### ColorConversionPolicy (DECLAUDING-POLICY Phase 1) ✅

- `getInputFormat(descriptor)` - Resolves format from descriptor
- `getOutputFormat(descriptor)` - Resolves output format
- `createOutputBuffer(format, pixelCount, channels)` - Creates typed array
- `getBytesPerSample(format)` - Returns 1, 2, or 4
- `getChannels(format)` - Returns channel count
- Supports: 8-bit, 16-bit (big/little endian), 32-bit float

### ColorEngineColorConversionPolicy (DECLAUDING-POLICY Phase 2) ✅

- `determineTransformType(descriptor)` - Single vs multiprofile
- `requiresMultiprofileTransform(descriptor)` - Boolean check
- `getEffectiveRenderingIntent(descriptor)` - After fallbacks
- `getProfileChain(descriptor)` - Complete profile chain
- `getRenderingIntentConstant(intent)` - Maps to LittleCMS constant
- K-Only GCR logic: Gray→CMYK multiprofile, Lab→CMYK fallback

### Tests ✅

- `ColorConversionPolicy.test.js` - 55 tests passing
- `ColorEngineColorConversionPolicy.test.js` - 37 tests passing

---

## Reference Scripts for Real-World Usage

**IMPORTANT**: When writing tests and verifying implementations, refer to these scripts to understand how the classes are actually used with real PDF fixtures:

| Script | Purpose |
|--------|---------|
| `experiments/convert-pdf-color.js` | Primary CLI for PDF color conversion - shows full usage pattern |
| `experiments/scripts/generate-verification-matrix.mjs` | Regression verification and benchmark - compares legacy vs new |
| `experiments/compare-pdf-color.js` | Compares conversion outputs between implementations |
| `experiments/analyze-pdf-structure.js` | Analyzes PDF document structures for debugging |

**Test Fixtures Location**: `tests/fixtures/`
- `tests/fixtures/pdfs/` - Real PDF files for integration testing
- `tests/fixtures/profiles/` - ICC profiles (eciCMYK, sRGB, sGray)

**Verification Strategy**:
1. Run conversions with legacy implementation (`services/PDFService.js`)
2. Run conversions with new implementation (`classes/`)
3. Compare outputs using `compare-pdf-color.js` or pixel-level diff
4. Use `generate-verification-matrix.mjs` for systematic comparison

---

## Test Organization

All class tests live in `tests/classes/` with lowercase-dash naming:

| Test File | Class Under Test |
|-----------|------------------|
| `buffer-registry.test.js` | BufferRegistry |
| `color-conversion-policy.test.js` | ColorConversionPolicy |
| `color-converter.test.js` | ColorConverter (base) |
| `color-converter-classes.test.js` | Integration tests (full hierarchy) |
| `color-engine-color-conversion-policy.test.js` | ColorEngineColorConversionPolicy |
| `composite-color-converter.test.js` | CompositeColorConverter |
| `diagnostics-collector.test.js` | DiagnosticsCollector |
| `image-color-converter.test.js` | ImageColorConverter |
| `lookup-table-color-converter.test.js` | LookupTableColorConverter |
| `main-auxiliary-diagnostics.test.js` | MainThread ↔ AuxiliaryDiagnostics |
| `pdf-content-stream-color-converter.test.js` | PDFContentStreamColorConverter |
| `pdf-document-color-converter.test.js` | PDFDocumentColorConverter |
| `pdf-image-color-converter.test.js` | PDFImageColorConverter |
| `pdf-page-color-converter.test.js` | PDFPageColorConverter |
| `profile-pool.test.js` | ProfilePool |

**New test files**:
| Test File | Phase | Status |
|-----------|-------|--------|
| `color-engine-provider.test.js` | Phase 1 | ✅ Created (11 tests) |
| `worker-pool.test.js` | Phase 6 | Pending |

---

## Activity Log

### 2026-01-28

- Created combined DECLAUDING-REFACTOR plan
- Merged DECLAUDING-CLASSES and DECLAUDING-POLICY goals
- Identified `ColorEngineService` responsibilities for distribution
- Confirmed viability of eliminating `ColorEngineService` dependency
- Migrated 15 test files to `tests/classes/` using `git mv`
- Updated `run-tests.js` to discover `tests/classes/*.test.js`
- Fixed import paths (Node.js context vs browser context)
- All 267 class tests passing (4 unrelated failures in `ConvertDiagnosticsProfile.test.js`)
- Added detailed unit/integration test requirements to each phase
- Added dynamic import requirement for color engine version flexibility
- **Phase 1 complete**: Created `classes/color-engine-provider.js` (280 lines)
  - Thin WASM wrapper with dynamic import for version flexibility
  - Pass-through profile/transform methods
  - `getConstants()` for accessing TYPE_*, INTENT_*, cmsFLAGS_* constants
  - NO fallback profiles (except Lab) - enforces "real ICC profiles only" policy
  - 11 unit tests passing in `tests/classes/color-engine-provider.test.js`
- **Phase 2 baseline testing complete**:
  - Test suite: 278 tests passing (4 unrelated `toCompactText` failures)
  - Real PDF conversion: Verified with `convert-pdf-color.js` (K-Only GCR)
  - Output comparison: New vs Legacy outputs nearly identical (48 bytes metadata diff)
  - Import verification: Only one services/ import (`compressWithFlateDecode`) - pure utility
