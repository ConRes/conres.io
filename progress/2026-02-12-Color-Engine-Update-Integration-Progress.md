# Color Engine 2026-02-14 Integration — Progress

**Date:** 2026-02-12
**Status:** Planning — Verification Complete — Awaiting Review
**Scope:** Integration of `color-engine-2026-02-14` into TFG classes, services, tests, and experiments
**Last Updated:** 2026-02-12 (temporary fix verification completed)

---

## Roadmap

- [x] Codebase exploration — map all affected code paths
- [x] Test suite analysis — run tests, identify failures, document root causes
- [x] Experiment analysis — verify experiment compatibility
- [ ] Plan implementation changes `PENDING-REVIEW`
- [ ] Implement changes
- [ ] Validation — run full test suite and regression comparisons
- [ ] Cleanup — update documentation

---

## 1. Current State

### 1.1 Symlink

The `color-engine` symlink now points to `color-engine-2026-02-14`:

```
testing/iso/ptf/2025/packages/color-engine -> color-engine-2026-02-14
```

### 1.2 Test Suite Status

**ALL tests fail** due to a single blocking import error:

```
file:///…/classes/color-engine-provider.js:96
import { cmsFLAGS_MULTIPROFILE_BPC_SCALING } from '../packages/color-engine/src/constants.js';
         ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
SyntaxError: The requested module '../packages/color-engine/src/constants.js' does not provide an export named 'cmsFLAGS_MULTIPROFILE_BPC_SCALING'
```

**Root cause:** `cmsFLAGS_MULTIPROFILE_BPC_SCALING` was renamed to `cmsFLAGS_MULTIPROFILE_BLACKPOINT_SCALING` in `color-engine-2026-02-14`.

### 1.3 Cascading Impact

Because `color-engine-provider.js` fails to load at import time, ALL downstream code that depends on it fails:

| File                              | Import Chain                                                                                |
| --------------------------------- | ------------------------------------------------------------------------------------------- |
| `color-conversion-policy.js`      | Imports `DEFAULT_ENGINE_VERSION`, `WEB_ASSEMBLY_ENDIANNESS` from `color-engine-provider.js` |
| `color-converter.js`              | Imports `ColorEngineProvider`, `DEFAULT_ENGINE_VERSION` from `color-engine-provider.js`     |
| All converter classes             | Inherit from `ColorConverter` which imports from `color-engine-provider.js`                 |
| All tests in `tests/classes/`     | Import converter classes                                                                    |
| `color-conversion-policy.test.js` | Imports from `color-conversion-policy.js`                                                   |
| `color-engine-provider.test.js`   | Imports `ColorEngineProvider` directly                                                      |

---

## 2. API Changes: Old Engine vs New Engine

### 2.1 Renamed Constants

| Old Name (2026-01-30 and older)     | New Name (2026-02-14)                      | Value        | Consumer Impact                                              |
| ----------------------------------- | ------------------------------------------ | ------------ | ------------------------------------------------------------ |
| `cmsFLAGS_MULTIPROFILE_BPC_SCALING` | `cmsFLAGS_MULTIPROFILE_BLACKPOINT_SCALING` | `0x20000000` | **BLOCKING** — Import fails in `color-engine-provider.js:96` |
| `cmsFLAGS_BPC_CLAMP_OPTIMIZE`       | `cmsFLAGS_BLACKPOINTCOMPENSATION_CLAMPING` | `0x80000000` | No consumer references (only in old engine packages)         |
| `cmsFLAGS_DEBUG_K_ONLY_GCR`         | `cmsFLAGS_DEBUG_COLOR_ENGINE`              | `0x40000000` | No consumer references                                       |

### 2.2 Removed Methods

| Method                                                      | Old Engine               | New Engine  | Consumer Guard                                      |
| ----------------------------------------------------------- | ------------------------ | ----------- | --------------------------------------------------- |
| `initBPCClamping(transform, inputChannels, outputChannels)` | Returns `{black, white}` | **REMOVED** | Feature-detected: `if (engine.initBPCClamping)`     |
| `clearBPCClamping(transform)`                               | Present                  | **REMOVED** | Not referenced by consumers                         |
| `doTransformWithBPCClamp(transform, input, output, count)`  | Returns stats            | **REMOVED** | Not referenced by consumers                         |
| `doTransformAdaptive(transform, input, output, count)`      | Returns stats            | **REMOVED** | Feature-detected: `if (engine.doTransformAdaptive)` |

### 2.3 New Constants (added in 2026-02-14)

| Constant                                        | Value        | Purpose                                                                     |
| ----------------------------------------------- | ------------ | --------------------------------------------------------------------------- |
| `cmsFLAGS_BLACKPOINTCOMPENSATION_CLAMPING`      | `0x80000000` | Pass-through flag for internal BPC clamping (replaces JS-side adaptive BPC) |
| `cmsFLAGS_DEBUG_COLOR_ENGINE`                   | `0x40000000` | Debug flag (replaces K-Only-specific debug flag)                            |
| `INTENT_PRESERVE_K_ONLY_PERCEPTUAL`             | `10`         | K-Only with Perceptual base intent                                          |
| `INTENT_PRESERVE_K_ONLY_RELATIVE_COLORIMETRIC`  | `11`         | K-Only with Relative Colorimetric base intent                               |
| `INTENT_PRESERVE_K_ONLY_SATURATION`             | `12`         | K-Only with Saturation base intent                                          |
| `INTENT_PRESERVE_K_PLANE_PERCEPTUAL`            | `13`         | K-Plane with Perceptual base intent                                         |
| `INTENT_PRESERVE_K_PLANE_RELATIVE_COLORIMETRIC` | `14`         | K-Plane with Relative Colorimetric base intent                              |
| `INTENT_PRESERVE_K_PLANE_SATURATION`            | `15`         | K-Plane with Saturation base intent                                         |
| Expanded standard flags                         | various      | `cmsFLAGS_NOCACHE`, `cmsFLAGS_NOOPTIMIZE`, etc. now in `constants.js`       |

### 2.4 Internal Behavioral Changes

| Feature                    | Old Engine                                                   | New Engine                                                                              |
| -------------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| Lab `0/-128/-128` handling | Consumer must detect and replace before transform            | Internal SIMD pre/post — automatic                                                      |
| BPC clamping               | Consumer calls `initBPCClamping()` + `doTransformAdaptive()` | Pass `cmsFLAGS_BLACKPOINTCOMPENSATION_CLAMPING` flag to `createTransform()` — automatic |

---

## 3. Consumer-Side Code Affected

### 3.1 Blocking Issue — Renamed Constant Import

**File:** `classes/color-engine-provider.js`

| Location | Code                                                                                                                      | Fix Required                                         |
| -------- | ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Line 53  | Typedef: `cmsFLAGS_MULTIPROFILE_BPC_SCALING: number`                                                                      | Rename to `cmsFLAGS_MULTIPROFILE_BLACKPOINT_SCALING` |
| Line 96  | `import { cmsFLAGS_MULTIPROFILE_BPC_SCALING } from '../packages/color-engine/src/constants.js';`                          | Rename import                                        |
| Line 466 | `cmsFLAGS_MULTIPROFILE_BPC_SCALING: this.#module.cmsFLAGS_MULTIPROFILE_BPC_SCALING ?? cmsFLAGS_MULTIPROFILE_BPC_SCALING,` | Rename both references                               |

**File:** `classes/color-converter.js`

| Location | Code                                                                                                           | Fix Required              |
| -------- | -------------------------------------------------------------------------------------------------------------- | ------------------------- |
| Line 564 | `if (evaluationResult.overrides.multiprofileBlackPointScaling && constants.cmsFLAGS_MULTIPROFILE_BPC_SCALING)` | Rename constant reference |
| Line 565 | `flags \|= constants.cmsFLAGS_MULTIPROFILE_BPC_SCALING;`                                                       | Rename constant reference |

**File:** `classes/color-conversion-policy.js`

| Location | Code                                                          | Fix Required   |
| -------- | ------------------------------------------------------------- | -------------- |
| Line 917 | JSDoc comment referencing `cmsFLAGS_MULTIPROFILE_BPC_SCALING` | Update comment |

### 3.2 Removed Methods — Feature-Detected (No Crash, But Dead Code)

**`initBPCClamping` call sites (6 total):**

| File                                | Lines                              | Context                            |
| ----------------------------------- | ---------------------------------- | ---------------------------------- |
| `classes/color-engine-provider.js`  | 367-374                            | `initBPCClamping()` wrapper method |
| `classes/color-converter.js`        | 777, 808, 844, 890                 | Transform cache initialization     |
| `services/ColorEngineService.js`    | 254-258, 288-292, 333-337, 366-370 | Service transform cache            |
| `services/StreamTransformWorker.js` | 284-292, 304-313                   | Worker transform cache             |

**`doTransformAdaptive` call sites (4 total):**

| File                                | Lines    | Context                                                 |
| ----------------------------------- | -------- | ------------------------------------------------------- |
| `classes/color-engine-provider.js`  | 386-394  | `doTransformAdaptive()` wrapper method                  |
| `classes/color-converter.js`        | 599      | Core transform dispatch                                 |
| `services/ColorEngineService.js`    | 752, 855 | `convertPixelBuffer` / `convertPixelBufferMultiprofile` |
| `services/StreamTransformWorker.js` | 539      | Worker pixel transform                                  |

**With the new engine, ALL these guards evaluate to `false`, so:**
- `initBPCClamping` is never called (guard: `if (engine.initBPCClamping)`)
- `doTransformAdaptive` is never called (guard: `if (engine.doTransformAdaptive)`)
- Code falls through to `transformArray()` — which is correct, BUT `cmsFLAGS_BLACKPOINTCOMPENSATION_CLAMPING` must be set on the transform for BPC clamping to work

### 3.3 Dead Configuration — `useAdaptiveBPCClamping`

With the new engine, `useAdaptiveBPCClamping` becomes meaningless because:
1. The removed methods are feature-detected and skipped
2. BPC clamping is now controlled by the `cmsFLAGS_BLACKPOINTCOMPENSATION_CLAMPING` flag at transform creation time

**Propagation chain (12+ files):**

| File                                            | Role                                                                       |
| ----------------------------------------------- | -------------------------------------------------------------------------- |
| `classes/color-converter.js`                    | Base class: threshold check, dispatch logic (lines 99, 164, 221, 552, 554) |
| `classes/image-color-converter.js`              | Config propagation (line 395 — worker task)                                |
| `classes/lookup-table-color-converter.js`       | Config propagation                                                         |
| `classes/composite-color-converter.js`          | Config propagation to children                                             |
| `classes/pdf-document-color-converter.js`       | Document-level config (lines 113, 260, 309)                                |
| `classes/pdf-page-color-converter.js`           | Page-level config (lines 82, 180, 214)                                     |
| `classes/pdf-image-color-converter.js`          | Image converter config (lines 99, 791)                                     |
| `classes/pdf-content-stream-color-converter.js` | Content stream config (line 128)                                           |
| `classes/pdf-image-color-sampler.js`            | Sampler config                                                             |
| `classes/worker-pool.js`                        | Worker task config (line 85 ImageTask typedef)                             |
| `classes/worker-pool-entrypoint.js`             | Worker-side config (lines 206, 294)                                        |
| `services/ColorEngineService.js`                | Service default (lines 34, 81, 94, 104, 682, 729, 780, 833, 964-974)       |
| `services/StreamTransformWorker.js`             | Worker threshold (line 98, 508)                                            |

### 3.4 Lab Coercion — Redundant With New Engine

**`COERCE_LAB_ABSOLUTE_ZERO_PIXELS` (2 implementations):**

| File                                   | Lines                   | Size       | Purpose                                                                                               |
| -------------------------------------- | ----------------------- | ---------- | ----------------------------------------------------------------------------------------------------- |
| `classes/pdf-image-color-converter.js` | 14-20, 247-322, 469-512 | ~120 lines | Pre-transform detection, replacement, CMYK K-Only GCR black precomputation, post-transform write-back |
| `experiments/pdf-diff.js`              | 595-660                 | ~36 lines  | Pre-transform detection, post-transform write-back (Lab output only)                                  |

With the new engine's internal SIMD Lab handling, this code is **redundant** — the engine handles Lab `0/-128/-128` correctly. However, the existing code won't cause incorrect results; it just does unnecessary work.

### 3.5 `ADAPTIVE_BPC_THRESHOLD` — Dead Constant

Defined in 3 places, all become unused with new engine:

| File                                | Line | Definition                                         |
| ----------------------------------- | ---- | -------------------------------------------------- |
| `classes/color-converter.js`        | 221  | `static #ADAPTIVE_BPC_THRESHOLD = 2 * 1024 * 1024` |
| `services/ColorEngineService.js`    | 39   | `const ADAPTIVE_BPC_THRESHOLD = 2 * 1024 * 1024`   |
| `services/StreamTransformWorker.js` | 98   | `const ADAPTIVE_BPC_THRESHOLD = 2 * 1024 * 1024`   |

### 3.6 `bpcClampingInitialized` — Dead Cache Property

Used in transform cache objects in 3 files:

| File                                | Context                                                      |
| ----------------------------------- | ------------------------------------------------------------ |
| `classes/color-converter.js`        | Lines 202, 205, 758, 778, 802, 809, 826, 845, 885, 891, 598  |
| `services/ColorEngineService.js`    | Lines 68-72, 252-259, 285, 293, 331, 338, 363, 371, 750, 853 |
| `services/StreamTransformWorker.js` | Lines 94-95, 282, 289, 301, 308-309, 537, 539                |

---

## 4. Test File Analysis

### 4.1 Current Test Status

All 16 test files fail due to the cascading import error from `color-engine-provider.js`.

### 4.2 Test Files Referencing `useAdaptiveBPCClamping`

These tests set `useAdaptiveBPCClamping` in configuration objects. For `color-engine-2026-02-14`, this option becomes meaningless but harmless.

| Test File                                    | Lines                                                                                               | Values Used |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------- | ----------- |
| `color-converter.test.js`                    | 25                                                                                                  | `true`      |
| `color-converter-classes.test.js`            | 180, 197, 213, 229, 256, 306, 344, 385, 428, 441, 515, 570, 626, 660, 694, 749, 808, 908, 987, 1068 | mixed       |
| `image-color-converter.test.js`              | 64, 93, 135, 208, 245, 278                                                                          | `true`      |
| `pdf-image-color-converter.test.js`          | 75, 104, 133, 177, 212, 236                                                                         | `true`      |
| `pdf-content-stream-color-converter.test.js` | 59, 87, 139, 227, 261, 296, 317, 345                                                                | `false`     |
| `lookup-table-color-converter.test.js`       | 46, 82, 144, 195, 253, 295, 365, 398                                                                | `false`     |
| `pdf-page-color-converter.test.js`           | 70, 99, 129, 161, 235, 273, 298, 336, 370                                                           | mixed       |
| `pdf-document-color-converter.test.js`       | 83, 116, 149, 175, 213, 247, 279, 352, 387, 420, 454, 481                                           | mixed       |
| `composite-color-converter.test.js`          | 24, 49, 74                                                                                          | `false`     |

### 4.3 Tests Referencing Engine Versions

| Test File                                 | Engine Versions Referenced                           |
| ----------------------------------------- | ---------------------------------------------------- |
| `legacy/EngineVersionParity.test.js`      | `color-engine-2025-12-19`, `color-engine-2026-01-21` |
| `classes/color-conversion-policy.test.js` | `color-engine-2025-12-19`, `color-engine-2026-01-30` |

### 4.4 Tests That Import Color Engine Directly

None of the test files import from `../packages/color-engine/src/index.js` directly — they all use the engine through `ColorEngineProvider`, `ColorConverter`, or `ColorEngineService` abstractions.

The one exception is `legacy/EngineVersionParity.test.js` which imports specific engine packages by path (not the symlink):
- Line 129: `await import('../packages/color-engine-2025-12-19/src/index.js')`
- Line 133: `await import('../packages/color-engine/src/index.js')`

---

## 5. Experiment Script Analysis

### 5.1 Scripts That Support `--color-engine` Flag

| Script                                                 | Flag                    | How Used                                                       |
| ------------------------------------------------------ | ----------------------- | -------------------------------------------------------------- |
| `experiments/convert-pdf-color.js`                     | `--color-engine=<path>` | Passed to `PDFDocumentColorConverter` as `colorEnginePath`     |
| `experiments/scripts/generate-verification-matrix.mjs` | Config `engine` field   | Translates to `--color-engine=packages/color-engine-<version>` |

### 5.2 Scripts That Use Default Engine (No Override)

| Script                                           | Impact                                                                              |
| ------------------------------------------------ | ----------------------------------------------------------------------------------- |
| `experiments/color-engine-benchmark.js`          | Will fail — imports from `color-engine/src/index.js` via `color-engine-provider.js` |
| `experiments/compare-pdf-color.js`               | Will fail — imports from `color-engine/src/index.js`                                |
| `experiments/comprehensive-k-only-diagnostic.js` | Will fail — imports from `color-engine/src/index.js`                                |
| `experiments/pdf-diff.js`                        | Will fail if it uses classes (which import `color-engine-provider.js`)              |
| `experiments/scripts/test-color-engine-noise.js` | Will fail — imports from `color-engine/src/index.js`                                |

### 5.3 `convert-pdf-color.js` With Old Engine

The `--color-engine` flag selects the engine package for `PDFDocumentColorConverter`, but `color-engine-provider.js` has a **static** import at module level (line 96) that always resolves against the symlinked engine. This means even with `--color-engine=packages/color-engine-2026-01-30`, the import of `cmsFLAGS_MULTIPROFILE_BPC_SCALING` from the symlink (pointing to 2026-02-14) **still fails at module load time**.

**Conclusion:** No experiment script can run while the symlink points to `color-engine-2026-02-14`, regardless of `--color-engine` flag usage.

### 5.4 Temporary Fix Verification (2026-02-12)

Applied a single-line temporary fix to `color-engine-provider.js:96`:

```javascript
// Before (fails with new engine):
import { cmsFLAGS_MULTIPROFILE_BPC_SCALING } from '../packages/color-engine/src/constants.js';

// After (import alias — works with new engine):
import { cmsFLAGS_MULTIPROFILE_BLACKPOINT_SCALING as cmsFLAGS_MULTIPROFILE_BPC_SCALING } from '../packages/color-engine/src/constants.js';
```

**Results:**

| Test                                                                                      | Result                           | Details                                       |
| ----------------------------------------------------------------------------------------- | -------------------------------- | --------------------------------------------- |
| `yarn test` (full suite)                                                                  | **284 pass, 0 fail, 51 skipped** | All tests pass with the new engine as default |
| `convert-pdf-color.js` (new engine, default)                                              | **Success**                      | Output: 41,128,130 bytes                      |
| `convert-pdf-color.js` (old engine, `--color-engine=../packages/color-engine-2026-01-30`) | **Success**                      | Output: 41,128,129 bytes                      |

**Key findings:**

1. **Single-line fix unblocks everything** — The renamed constant was the ONLY blocking issue. All 284 tests pass with no other changes.
2. **Backward compatibility works** — The import alias approach allows both old and new engines to coexist. The static import provides the fallback value (0x20000000), and `getConstants()` line 466 uses `this.#module.cmsFLAGS_MULTIPROFILE_BPC_SCALING ?? cmsFLAGS_MULTIPROFILE_BPC_SCALING` which correctly resolves for both engines.
3. **1-byte PDF output difference** — The new engine (41,128,130 bytes) differs by 1 byte from the old engine (41,128,129 bytes) for the same 8-bit test PDF. This needs investigation to determine if it reflects a color conversion difference or a benign serialization difference.
4. **BPC clamping is silently disabled** — With the new engine, `initBPCClamping` is skipped (feature-detected as absent), and `cmsFLAGS_BLACKPOINTCOMPENSATION_CLAMPING` is never set on transforms. The tests still pass because they may not assert on BPC-specific output values.
5. **Lab coercion runs but is redundant** — The pre-transform Lab `0/-128/-128` detection and replacement still executes with the new engine but does unnecessary work (the engine handles it internally).
6. **`--color-engine` path resolution** — The flag requires `../packages/` prefix (relative to `classes/` not CWD), since `ColorEngineProvider` uses `import()` which resolves from the module's own directory. The help text says "CWD-relative" but this is inaccurate.

**Change was reverted** — `git checkout -- testing/iso/ptf/2025/classes/color-engine-provider.js` restored the original file. No staged files were affected.

---

## 6. Backward Compatibility Requirements

### 6.1 Engine Version Selection Mechanisms

The codebase already supports multiple engine versions through these mechanisms:

| Mechanism                                        | Used By                                                    | How                                |
| ------------------------------------------------ | ---------------------------------------------------------- | ---------------------------------- |
| `colorEnginePath` constructor option             | `ColorConverter`, `PDFDocumentColorConverter`              | Dynamic import at runtime          |
| `enginePath` constructor option                  | `ColorEngineProvider`                                      | Dynamic import at initialization   |
| `colorEngineInstance` constructor option         | `ColorEngineService`                                       | Injected engine instance           |
| `colorEnginePath` worker data                    | `WorkerPool`, `worker-pool-entrypoint.js`                  | Passed to workers via `workerData` |
| `--color-engine=<path>` CLI flag                 | `convert-pdf-color.js`, `generate-verification-matrix.mjs` | CLI argument                       |
| `config.engine` JSON field                       | `generate-verification-matrix.mjs` configurations          | JSON config                        |
| `engines` field in `color-conversion-rules.json` | `ColorConversionPolicy`                                    | Rule matching by engine version    |

### 6.2 Static Import Problem

The `ColorEngineProvider` has a **static import** at module level:

```javascript
import { cmsFLAGS_MULTIPROFILE_BPC_SCALING } from '../packages/color-engine/src/constants.js';
```

This import resolves against the **symlinked** engine at module load time, not the dynamically-selected engine. This means:

1. The constant is imported once from whichever engine the symlink points to
2. The fallback in `getConstants()` (line 466) uses `??` to prefer the dynamic module's value
3. The static import acts as a fallback for when the dynamic module doesn't export the constant

**Problem:** When the symlink points to `color-engine-2026-02-14`, this import fails because the constant was renamed. The code **cannot even load** — the `??` fallback never gets a chance to execute.

### 6.3 Test Versioning Requirements

Per the user's instructions:

1. **Tests relevant to both engines** need both `(color-engine-2026-01-30)` and `(color-engine-2026-02-14)` variants
2. **Tests only relevant to old engines** should be rewired to use `color-engine-2026-01-30` instead of `color-engine`
3. **All tests with specific engine versions** must be suffixed with `(color-engine-YYYY-MM-DD)` or `(color-engine-YYYY-MM-DD and older)`

---

## 7. Changes Needed — Comprehensive Inventory

### 7.1 Priority 1: Fix Blocking Import (MUST DO FIRST)

| File                                   | Change                                                                                                                          | Reason                       |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| `classes/color-engine-provider.js:96`  | Rename import: `cmsFLAGS_MULTIPROFILE_BPC_SCALING` → `cmsFLAGS_MULTIPROFILE_BLACKPOINT_SCALING`                                 | Import fails with new engine |
| `classes/color-engine-provider.js:53`  | Rename in typedef: `cmsFLAGS_MULTIPROFILE_BPC_SCALING` → `cmsFLAGS_MULTIPROFILE_BLACKPOINT_SCALING`                             | Type consistency             |
| `classes/color-engine-provider.js:466` | Rename both references in `getConstants()`                                                                                      | Runtime constant name        |
| `classes/color-converter.js:564-565`   | Update constant reference: `constants.cmsFLAGS_MULTIPROFILE_BPC_SCALING` → `constants.cmsFLAGS_MULTIPROFILE_BLACKPOINT_SCALING` | Runtime usage                |

**Backward compatibility note:** The old engine (`color-engine-2026-01-30`) exports `cmsFLAGS_MULTIPROFILE_BPC_SCALING`, NOT `cmsFLAGS_MULTIPROFILE_BLACKPOINT_SCALING`. Simply renaming will break when using the old engine.

**Options:**
1. **Import with alias**: `import { cmsFLAGS_MULTIPROFILE_BLACKPOINT_SCALING as cmsFLAGS_MULTIPROFILE_BPC_SCALING } from ...` — works only for new engine
2. **Dynamic import only**: Remove static import, rely on dynamic module in `getConstants()` — requires refactoring
3. **Compatibility shim**: Import both names with fallback: detect which export exists
4. **Version-conditional import**: Import from version-specific path based on symlink target

**Recommended approach:** Use a try/import pattern or export the constant under both names from a compatibility wrapper.

### 7.2 Priority 2: New Engine BPC Clamping Flag

With the new engine, BPC clamping is controlled by `cmsFLAGS_BLACKPOINTCOMPENSATION_CLAMPING` flag at transform creation time. The current code does NOT set this flag anywhere. This means:

**Without changes:** BPC clamping is silently disabled with the new engine (the old `initBPCClamping` path is skipped, and no flag is set).

**Required:** When using `color-engine-2026-02-14` and BPC is enabled, `cmsFLAGS_BLACKPOINTCOMPENSATION_CLAMPING` must be added to the transform flags in:

| File                                | Location                                                         | Transform Creation                                   |
| ----------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------- |
| `classes/color-converter.js`        | `#getOrCreateTransform()`, `#getOrCreateMultiprofileTransform()` | `createTransform()`, `createMultiprofileTransform()` |
| `services/ColorEngineService.js`    | `#getOrCreateTransform()`, `#getOrCreateMultiprofileTransform()` | Same                                                 |
| `services/StreamTransformWorker.js` | `getTransform()`                                                 | Same                                                 |

### 7.3 Priority 3: Lab Coercion Cleanup

For the new engine, `COERCE_LAB_ABSOLUTE_ZERO_PIXELS` is redundant. Options:

1. **Leave as-is**: Code works correctly (just does unnecessary work)
2. **Conditionally skip**: Check engine version, skip Lab coercion for `color-engine-2026-02-14`
3. **Remove for new engine, keep for old**: Provider-based approach per the existing progress document

### 7.4 Priority 4: Test Versioning

| Test Category                              | Current State                        | Required Change                                   |
| ------------------------------------------ | ------------------------------------ | ------------------------------------------------- |
| Tests using `useAdaptiveBPCClamping: true` | Meaningless with new engine          | Keep for old engine tests; optional for new       |
| Tests using default engine (symlink)       | All fail                             | Must either fix imports or specify engine version |
| `EngineVersionParity.test.js`              | Tests 2025-12-19 vs 2026-01-21       | Add 2026-02-14 comparisons                        |
| `color-conversion-policy.test.js`          | References `color-engine-2026-01-30` | Add `color-engine-2026-02-14` rules               |

### 7.5 Priority 5: Configuration Cleanup

| Configuration                 | Status                                                     | Action                                                       |
| ----------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------ |
| `color-conversion-rules.json` | Already includes `color-engine-2026-02-14` in engine lists | Verify rules are correct for new engine                      |
| `useAdaptiveBPCClamping`      | Dead with new engine                                       | Can be kept harmlessly or removed from new-engine code paths |
| `ADAPTIVE_BPC_THRESHOLD`      | Dead with new engine                                       | Same — harmless but dead                                     |

---

## 8. Files Affected — Complete Inventory

### 8.1 Classes

| File                                    | Changes Required                                                                                                                                                                                                                                                                   |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `color-engine-provider.js`              | **P1**: Rename `cmsFLAGS_MULTIPROFILE_BPC_SCALING` → `cmsFLAGS_MULTIPROFILE_BLACKPOINT_SCALING` (lines 53, 96, 466). **P2**: Add `cmsFLAGS_BLACKPOINTCOMPENSATION_CLAMPING` to constants. **P3**: Remove or conditionalize `initBPCClamping()` and `doTransformAdaptive()` methods |
| `color-converter.js`                    | **P1**: Rename constant reference (lines 564-565). **P2**: Set BPC clamping flag for new engine. Dead code: `ADAPTIVE_BPC_THRESHOLD`, `bpcClampingInitialized`, adaptive dispatch                                                                                                  |
| `color-conversion-policy.js`            | **P1**: Update JSDoc comment (line 917)                                                                                                                                                                                                                                            |
| `pdf-image-color-converter.js`          | **P3**: Lab coercion (120 lines) is redundant with new engine                                                                                                                                                                                                                      |
| `image-color-converter.js`              | Dead config propagation: `useAdaptiveBPCClamping`                                                                                                                                                                                                                                  |
| `lookup-table-color-converter.js`       | Dead config propagation                                                                                                                                                                                                                                                            |
| `composite-color-converter.js`          | Dead config propagation                                                                                                                                                                                                                                                            |
| `pdf-document-color-converter.js`       | Dead config propagation                                                                                                                                                                                                                                                            |
| `pdf-page-color-converter.js`           | Dead config propagation                                                                                                                                                                                                                                                            |
| `pdf-content-stream-color-converter.js` | Dead config propagation                                                                                                                                                                                                                                                            |
| `pdf-image-color-sampler.js`            | Dead config propagation                                                                                                                                                                                                                                                            |
| `worker-pool.js`                        | Dead config in task typedef                                                                                                                                                                                                                                                        |
| `worker-pool-entrypoint.js`             | Dead config propagation                                                                                                                                                                                                                                                            |

### 8.2 Services

| File                       | Changes Required                                                                                                                                                                            |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ColorEngineService.js`    | **P2**: Set BPC clamping flag for new engine. Dead code: `initBPCClamping` calls, `doTransformAdaptive` calls, `ADAPTIVE_BPC_THRESHOLD`, `bpcClampingInitialized`, `useAdaptiveBPCClamping` |
| `StreamTransformWorker.js` | **P2**: Set BPC clamping flag for new engine. Dead code: same as above                                                                                                                      |

### 8.3 Tests

| File                                            | Changes Required                                    |
| ----------------------------------------------- | --------------------------------------------------- |
| All `tests/classes/*.test.js`                   | Engine version suffixing per test naming convention |
| `tests/legacy/EngineVersionParity.test.js`      | Add `color-engine-2026-02-14` comparisons           |
| `tests/classes/color-conversion-policy.test.js` | Add `color-engine-2026-02-14` rules                 |
| `tests/classes/color-engine-provider.test.js`   | Test new constant names, removed methods            |

### 8.4 Experiments

| File                                    | Changes Required                                  |
| --------------------------------------- | ------------------------------------------------- |
| `experiments/pdf-diff.js`               | Lab coercion (36 lines) redundant with new engine |
| `experiments/convert-pdf-color.js`      | Verify works with both engines                    |
| `experiments/color-engine-benchmark.js` | Verify works with new engine                      |

### 8.5 Configuration

| File                          | Changes Required                                          |
| ----------------------------- | --------------------------------------------------------- |
| `color-conversion-rules.json` | Already includes `color-engine-2026-02-14` — verify rules |

---

## 9. Open Questions for Planning

1. **Backward compatibility strategy for renamed constant**: The static import in `color-engine-provider.js` must work with BOTH old and new engines. What approach should be used?
   - Option A: Dynamic import only (remove static import, use `getConstants()` method exclusively)
   - Option B: Compatibility constant in a shared module that exports both old and new names
   - Option C: Version detection at import time (try new name, fall back to old name)

2. **BPC clamping flag for new engine**: Should `cmsFLAGS_BLACKPOINTCOMPENSATION_CLAMPING` be set **always** when BPC is enabled, or only for certain transform types? The old engine had both engine-internal (`cmsFLAGS_BPC_CLAMP_OPTIMIZE`) and consumer-side adaptive paths.

3. **Lab coercion cleanup timeline**: Should Lab coercion be removed for the new engine in this integration, or deferred to a follow-up task? The existing progress document (`2026-02-14-COLOR-ENGINE-UPDATE-PROGRESS.md`) recommends Option C (Provider Strategy with Lab Coercion Hooks) which is a larger refactor.

4. **Test naming convention**: Should existing tests be renamed with `(color-engine-2026-01-30 and older)` suffix, or should new tests be added with `(color-engine-2026-02-14)` suffix alongside unchanged existing tests?

5. **`useAdaptiveBPCClamping` cleanup**: Remove entirely, or keep as no-op for backward compatibility? If removed, all 12+ files need changes.

---

## Activity Log

| Date       | Activity                                                                                                                                                                                                                                                                                                                                                 |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-02-12 | Created progress document. Completed full codebase exploration. Ran test suite — all fail due to renamed constant import. Identified cascading import failure chain. Mapped all 28+ affected files. Documented API changes, dead code, and backward compatibility requirements.                                                                          |
| 2026-02-12 | Temporary fix verification: Applied import alias fix to `color-engine-provider.js:96`. Ran full test suite — 284 pass, 0 fail. Ran `convert-pdf-color.js` with both new engine (default) and old engine (`--color-engine` flag) — both succeed with 1-byte output difference. Reverted all changes. Updated progress document with Section 5.4 findings. |
