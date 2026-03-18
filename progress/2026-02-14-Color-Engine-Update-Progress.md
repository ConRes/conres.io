# Color Engine 2026-02-14 Update — Progress

**Date:** 2026-02-09
**Status:** Complete
**Scope:** Migration from current color-engine to `color-engine-2026-02-14`
**Last Updated:** 2026-02-12 (Architectural Rework Phase completed)

---

## Roadmap

- [x] Codebase audit — identify all affected code
- [x] Architecture decision — configuration-based branching with factory pattern
- [x] Implementation plan — file-by-file change list (see plan document)
- [x] Color engine package setup — `color-engine` symlink → `color-engine-2026-02-14`
- [x] Implement changes — execute migration (Phases 1–4)
- [x] Unit tests — all 284 tests pass (51 skipped, 0 failures)
- [x] Regression verification — verification matrix with both engine versions (all 12 conversions passed, all change verifications passed)
- [x] Cleanup — deleted stale `color-converter copy.js` backup

---

## 1. What Changes in `color-engine-2026-02-14`

### 1.1 Lab `0/-128/-128` Handling (Internal SIMD)

The new engine handles Lab `0/-128/-128` (all-zero byte pixels) correctly via internal SIMD pre/post operations. This applies **only when 2-or-more profile chains start from and end in Lab**. This is the default behavior — no consumer-side flag needed.

**Impact:** Eliminates the need for consumer-side `COERCE_LAB_ABSOLUTE_ZERO_PIXELS` workaround.

### 1.2 Blackpoint Compensation Clamping (Internal)

BPC clamping is now handled internally by the engine. The consumer no longer needs to call `initBPCClamping` or use `doTransformAdaptive` / `doTransformWithBPCClamp`.

**Impact:** Eliminates all consumer-side adaptive BPC clamping infrastructure.

### 1.3 API Surface Changes

| Current API                          | New API / Status                      |
| ------------------------------------ | ------------------------------------- |
| `cmsFLAGS_BPC_CLAMP_OPTIMIZE`        | `cms_BLACKPOINTCOMPENSATION_CLAMPING` |
| `BPC_STATS_SIZE`                     | **Removed**                           |
| `initBPCClamping` (function)         | **Removed**                           |
| `clearBPCClamping` (function)        | **Removed**                           |
| `clearAllBPCClamping` (function)     | **Removed**                           |
| `doTransformWithBPCClamp` (function) | **Removed**                           |
| `doTransformAdaptive` (function)     | **Removed**                           |
| `initBPCClamping` (method)           | **Removed**                           |
| `clearBPCClamping` (method)          | **Removed**                           |
| `doTransformWithBPCClamp` (method)   | **Removed**                           |
| `doTransformAdaptive` (method)       | **Removed**                           |

---

## 2. Codebase Audit — Current Usage of Removed APIs

### 2.1 BPC Clamping API Usage

#### `initBPCClamping` — 6 call sites

| File                                | Line(s)                            | Context                                                                           |
| ----------------------------------- | ---------------------------------- | --------------------------------------------------------------------------------- |
| `classes/color-converter.js`        | 777, 808, 844, 890                 | Transform cache: initializes BPC on cached/new single and multiprofile transforms |
| `services/ColorEngineService.js`    | 254-258, 288-292, 333-337, 366-370 | Transform cache: initializes BPC on cached/new single and multiprofile transforms |
| `services/StreamTransformWorker.js` | 284, 288, 308                      | Worker: initializes BPC on cached/new transforms                                  |

#### `doTransformAdaptive` — 4 call sites

| File                                | Line(s)  | Context                                                                     |
| ----------------------------------- | -------- | --------------------------------------------------------------------------- |
| `classes/color-converter.js`        | 599      | Core transform dispatch: adaptive path for large images                     |
| `services/ColorEngineService.js`    | 752, 855 | `convertPixelBuffer` / `convertPixelBufferMultiprofile`: adaptive transform |
| `services/StreamTransformWorker.js` | 539      | Worker: adaptive transform for large images                                 |

#### `useAdaptiveBPCClamping` configuration — propagated through 12+ files

| File                                            | Role                                                     |
| ----------------------------------------------- | -------------------------------------------------------- |
| `classes/color-converter.js`                    | Base class: threshold check, dispatch logic              |
| `classes/image-color-converter.js`              | Propagates to parent                                     |
| `classes/lookup-table-color-converter.js`       | Propagates to parent                                     |
| `classes/composite-color-converter.js`          | Propagates to children                                   |
| `classes/pdf-document-color-converter.js`       | Document-level config                                    |
| `classes/pdf-page-color-converter.js`           | Page-level config, propagates to image/stream converters |
| `classes/pdf-image-color-converter.js`          | Image converter config                                   |
| `classes/pdf-content-stream-color-converter.js` | Content stream converter config                          |
| `classes/pdf-image-color-sampler.js`            | Sampler config                                           |
| `classes/worker-pool.js`                        | Worker task config                                       |
| `classes/worker-pool-entrypoint.js`             | Worker-side config                                       |
| `services/ColorEngineService.js`                | Service-level default                                    |
| `services/StreamTransformWorker.js`             | Worker threshold check                                   |

#### `bpcClampingInitialized` cache property — every transform cache object

| File                                | Context                        |
| ----------------------------------- | ------------------------------ |
| `classes/color-converter.js`        | Transform cache entries        |
| `services/ColorEngineService.js`    | Transform cache entries        |
| `services/StreamTransformWorker.js` | Worker transform cache entries |

#### `ADAPTIVE_BPC_THRESHOLD` (2 megapixel constant) — 3 definitions

| File                                | Line               |
| ----------------------------------- | ------------------ |
| `classes/color-converter.js`        | Static class field |
| `services/ColorEngineService.js`    | Module constant    |
| `services/StreamTransformWorker.js` | Module constant    |

### 2.2 Lab Absolute-Zero Pixel Coercion

#### `COERCE_LAB_ABSOLUTE_ZERO_PIXELS` — 2 implementations

| File                                   | Lines                   | Code Removed                                                                                                            |
| -------------------------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `classes/pdf-image-color-converter.js` | 14-20, 247-322, 469-512 | ~120 lines: pre-transform detection, replacement bytes, CMYK K-Only GCR black precomputation, post-transform write-back |
| `experiments/pdf-diff.js`              | 595-660                 | ~36 lines: pre-transform detection, post-transform write-back (Lab output only)                                         |

### 2.3 `cmsFLAGS_BPC_CLAMP_OPTIMIZE` → `cms_BLACKPOINTCOMPENSATION_CLAMPING` rename

| File                               | Context                                              |
| ---------------------------------- | ---------------------------------------------------- |
| `services/ColorEngineService.js`   | Mutual exclusion logic with `useAdaptiveBPCClamping` |
| `classes/color-engine-provider.js` | May re-export flag constant (check if exposed)       |
| Color engine `constants.js`        | Source of the constant                               |

### 2.4 `ColorEngineProvider` Methods to Remove

| Method                  | Lines   | Replacement                                     |
| ----------------------- | ------- | ----------------------------------------------- |
| `initBPCClamping()`     | 367-374 | Remove entirely                                 |
| `doTransformAdaptive()` | 386-394 | Remove entirely; callers use `transformArray()` |

---

## 3. Architecture Decision: Legacy Isolation Strategy

### 3.1 Goal

Eliminate all color-engine-version-specific complexity from the primary converter classes. All backward compatibility logic for older engines should reside in one place.

### 3.2 Options Evaluated

#### Option A: `LegacyPDFDocumentColorConverter`

Move all code needed only for legacy engine versions into a subclass.

**Architecture:**

```
PDFDocumentColorConverter (clean, engine-agnostic)
LegacyPDFDocumentColorConverter extends PDFDocumentColorConverter (legacy overrides)
```

**Pros:**

- Clear separation — legacy code is in one class
- Primary classes become clean and simple

**Cons:**

- **Does not achieve the goal.** The BPC clamping and Lab coercion code is spread across the **entire inheritance chain** (ColorConverter → ImageColorConverter → PDFImageColorConverter, and ColorConverter → LookupTableColorConverter → PDFContentStreamColorConverter). A single `LegacyPDFDocumentColorConverter` cannot override behavior in sibling classes like `PDFImageColorConverter` or `PDFContentStreamColorConverter`.
- Would require `LegacyPDFImageColorConverter`, `LegacyPDFContentStreamColorConverter`, etc. — one legacy wrapper per class — defeating the "one place" goal.
- The document converter is a composite that creates child converters. Overriding child creation to use legacy variants adds fragile coupling.

**Verdict: Not viable** as a single-class solution. Would fragment into many legacy classes.

#### Option B: `LegacyColorEngineProvider` / `ColorEngineProvider`

Decouple all classes from engine-specific details by abstracting the color engine behind a provider interface. The provider handles BPC clamping internally — callers never see `initBPCClamping` or `doTransformAdaptive`.

**Architecture:**

```
ColorEngineProvider (interface/contract)
├── ModernColorEngineProvider (color-engine-2026-02-14+: delegates to engine flags)
└── LegacyColorEngineProvider (older engines: implements JS-side BPC clamping)
```

**How it works:**

- `ColorConverter` base class calls `provider.transformPixels(transform, input, output, count, options)` — a single method.
- `ModernColorEngineProvider.transformPixels()` simply calls `engine.transformArray()` — BPC clamping is engine-internal via `cms_BLACKPOINTCOMPENSATION_CLAMPING` flag.
- `LegacyColorEngineProvider.transformPixels()` calls `engine.initBPCClamping()` + `engine.doTransformAdaptive()` when conditions are met, falling back to `engine.transformArray()` otherwise.

**Pros:**

- **All legacy logic in one file.** The `LegacyColorEngineProvider` contains 100% of BPC clamping init/dispatch logic.
- **All converter classes become engine-agnostic.** They never call `initBPCClamping`, `doTransformAdaptive`, or check `bpcClampingInitialized`. They just call `provider.transformPixels()`.
- **Clean separation of concerns.** Converter classes handle PDF structure; providers handle engine API differences.
- `useAdaptiveBPCClamping` config option is absorbed into the provider — converters don't propagate it.
- **Easy to delete later.** When legacy engine support is dropped, delete `LegacyColorEngineProvider` and the provider selection logic. Zero changes to converter classes.

**Cons:**

- Requires changing `ColorConverter`, `ColorEngineService`, and `StreamTransformWorker` to use the provider abstraction instead of direct engine calls.
- The existing `ColorEngineProvider` already exists as a thin wrapper — would need to evolve it or create a parallel hierarchy.
- Transform caching (`bpcClampingInitialized` property on cache entries) would need to move into the provider.
- **Does not address Lab absolute-zero coercion** — that lives in `PDFImageColorConverter` and `pdf-diff.js`, not in the engine provider layer.

**Verdict: Viable for BPC clamping, but incomplete** for Lab coercion.

#### Option C: Provider Strategy with Lab Coercion Hooks (Recommended)

Extend Option B to also handle Lab absolute-zero coercion within the provider layer.

**Architecture:**

```
ColorEngineProvider (base: modern engine, clean API)
├── transformPixels(transform, input, output, count, options)
│   └── calls engine.transformArray() — BPC clamping is engine-internal
├── transformRequiresLabCoercion(colorSpace) → false
│   └── Modern engine handles Lab 0/-128/-128 internally
└── getBlackPointForProfile(profile, intent) → Uint8Array
    └── Used by CMYK K-Only GCR black computation (if still needed)

LegacyColorEngineProvider extends ColorEngineProvider
├── transformPixels(transform, input, output, count, options)
│   └── Implements initBPCClamping + doTransformAdaptive dispatch
├── transformRequiresLabCoercion(colorSpace) → true when colorSpace === 'Lab'
│   └── Legacy engine needs consumer-side Lab coercion
└── getBlackPointForProfile(profile, intent) → Uint8Array
    └── Same as modern (profile-dependent, not engine-dependent)
```

**How Lab coercion moves to the provider:**

Currently, `PDFImageColorConverter` has ~120 lines of Lab coercion. With this approach:

1. Before converting, `PDFImageColorConverter` checks `provider.transformRequiresLabCoercion(colorSpace)`.
2. If `true` (legacy), it calls `provider.coerceLabAbsoluteZeroPixels(pixelData, bitsPerComponent)` which returns a coercion context (positions + replacement pixel).
3. After converting, it calls `provider.restoreLabAbsoluteZeroPixels(context, outputBuffer, outputColorSpace)`.
4. If `false` (modern), steps 2-3 are skipped entirely.

The **actual coercion algorithm** moves into `LegacyColorEngineProvider`. The `PDFImageColorConverter` retains only 3 lines of guard logic.

**Pros:**

- **All engine-version-specific logic in one file** — both BPC clamping AND Lab coercion.
- **Converter classes are truly engine-agnostic** — no feature flags, no threshold checks, no coercion loops.
- **Progressive cleanup** — when legacy is dropped, delete one file. Zero changes to converters.
- **`useAdaptiveBPCClamping` disappears from all configs** — absorbed into provider selection.
- **`COERCE_LAB_ABSOLUTE_ZERO_PIXELS` disappears from all converters** — absorbed into provider.

**Cons:**

- More refactoring upfront than Option B (Lab coercion methods must be moved).
- `pdf-diff.js` (experiment script) has its own Lab coercion that would need separate handling (it doesn't use `ColorEngineProvider`).
- Provider needs access to color conversion for the CMYK K-Only GCR black precomputation step. This creates a small circular concern (provider uses its own transform to compute a pixel). This is manageable since the precomputation is a single-pixel transform.

**Verdict: Recommended** — achieves the stated goal of eliminating all engine-specific complexity from primary classes.

#### Option D: Feature Detection at the Provider Level

Instead of separate class hierarchies, have a single `ColorEngineProvider` that detects engine capabilities at initialization and adapts its behavior.

**Architecture:**

```
ColorEngineProvider
├── initialize()
│   └── Detects: engine.initBPCClamping? engine.doTransformAdaptive? Lab SIMD?
├── transformPixels(transform, input, output, count, options)
│   ├── If engine has native BPC clamping → engine.transformArray()
│   └── If engine lacks it → initBPCClamping() + doTransformAdaptive()
├── transformRequiresLabCoercion(colorSpace)
│   ├── If engine has Lab SIMD → false
│   └── If engine lacks it → true
└── (all engine-specific branching is internal)
```

**Pros:**

- **Single class** — no inheritance hierarchy for providers.
- **Self-adapting** — works with any engine version without external configuration.
- **Same clean API** for converter classes as Option C.
- Existing `ColorEngineProvider` class can be evolved in-place.

**Cons:**

- Feature detection can be fragile (what if a method exists but doesn't work correctly?).
- Harder to reason about behavior — must inspect engine version to know which path runs.
- Testing is harder — must mock engine capabilities.
- Accumulates dead code paths as old engines are retired.

**Verdict: Viable but less maintainable** than explicit legacy/modern split.

### 3.3 Recommendation

**Option C (Provider Strategy with Lab Coercion Hooks)** is the recommended approach because it:

1. **Achieves the stated goal**: All engine-version-specific code lives in `LegacyColorEngineProvider`.
2. **Keeps converter classes clean**: No BPC flags, no Lab coercion, no threshold checks.
3. **Is easy to delete**: Drop one file when legacy support ends.
4. **Handles both concerns**: BPC clamping AND Lab coercion, not just one.

Option D (feature detection) is a reasonable alternative if maintaining two provider classes feels like too much overhead, but Option C is more explicit and easier to audit.

---

## 4. Affected Files — Complete Inventory

### 4.1 Classes (primary converter chain)

| File                                            | Changes Required                                                                                                                                                                                                                                                                                   |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `classes/color-engine-provider.js`              | Evolve into modern provider; remove `initBPCClamping()` and `doTransformAdaptive()` methods; add `transformPixels()`, `transformRequiresLabCoercion()`, Lab coercion helpers                                                                                                                       |
| `classes/color-converter.js`                    | Remove: `ADAPTIVE_BPC_THRESHOLD`, `bpcClampingInitialized` cache property, adaptive BPC dispatch in `convertColorsBuffer()`, `initBPCClamping` calls in `#getOrCreateTransform()` / `#getOrCreateMultiprofileTransform()`; Replace dual-path transform execution with `provider.transformPixels()` |
| `classes/image-color-converter.js`              | Remove: `useAdaptiveBPCClamping` config propagation                                                                                                                                                                                                                                                |
| `classes/lookup-table-color-converter.js`       | Remove: `useAdaptiveBPCClamping` config propagation                                                                                                                                                                                                                                                |
| `classes/composite-color-converter.js`          | Remove: `useAdaptiveBPCClamping` config propagation to children                                                                                                                                                                                                                                    |
| `classes/pdf-document-color-converter.js`       | Remove: `useAdaptiveBPCClamping` config propagation                                                                                                                                                                                                                                                |
| `classes/pdf-page-color-converter.js`           | Remove: `useAdaptiveBPCClamping` config propagation to image/stream converters                                                                                                                                                                                                                     |
| `classes/pdf-image-color-converter.js`          | Remove: `COERCE_LAB_ABSOLUTE_ZERO_PIXELS` flag, ~120 lines Lab coercion logic, `useAdaptiveBPCClamping` config; Add: 3-line provider guard for Lab coercion                                                                                                                                        |
| `classes/pdf-content-stream-color-converter.js` | Remove: `useAdaptiveBPCClamping` config propagation                                                                                                                                                                                                                                                |
| `classes/pdf-image-color-sampler.js`            | Remove: `useAdaptiveBPCClamping` config                                                                                                                                                                                                                                                            |
| `classes/worker-pool.js`                        | Remove: `useAdaptiveBPCClamping` from task config                                                                                                                                                                                                                                                  |
| `classes/worker-pool-entrypoint.js`             | Remove: `useAdaptiveBPCClamping` from task config                                                                                                                                                                                                                                                  |
| `classes/buffer-registry.js`                    | No direct BPC changes needed (uses `ColorEngineService` for conversions)                                                                                                                                                                                                                           |
| `classes/profile-pool.js`                       | No changes needed                                                                                                                                                                                                                                                                                  |

### 4.2 Services

| File                                | Changes Required                                                                                                                                                                                                                                                                                                                       |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `services/ColorEngineService.js`    | Remove: `initBPCClamping` calls, `doTransformAdaptive` calls, `ADAPTIVE_BPC_THRESHOLD`, `bpcClampingInitialized`, `useAdaptiveBPCClamping` default/config/getter/setter, mutual exclusion flag logic; Rename: `cmsFLAGS_BPC_CLAMP_OPTIMIZE` → `cms_BLACKPOINTCOMPENSATION_CLAMPING`; Simplify: always set clamping flag when BPC is on |
| `services/StreamTransformWorker.js` | Remove: `ADAPTIVE_BPC_THRESHOLD`, `initBPCClamping` calls, `doTransformAdaptive` calls, `bpcClampingInitialized`, adaptive BPC decision logic; Simplify: always use `engine.transformArray()`                                                                                                                                          |

### 4.3 Experiments / Tools (developer-owned — change only when instructed)

| File                                 | Changes Required                         |
| ------------------------------------ | ---------------------------------------- |
| `experiments/pdf-diff.js`            | Remove: Lab coercion logic (~36 lines)   |
| `experiments/convert-pdf-color.js`   | Check for `useAdaptiveBPCClamping` usage |
| `experiments/compare-pdf-outputs.js` | Check for `useAdaptiveBPCClamping` usage |

### 4.4 Configuration

| File                                                 | Changes Required                           |
| ---------------------------------------------------- | ------------------------------------------ |
| `classes/configurations/color-conversion-rules.json` | Remove `useAdaptiveBPCClamping` if present |

### 4.5 Tests

| File                                                       | Changes Required                         |
| ---------------------------------------------------------- | ---------------------------------------- |
| `tests/classes/color-converter.test.js`                    | Remove adaptive BPC test cases           |
| `tests/classes/color-converter-classes.test.js`            | Remove adaptive BPC test cases           |
| `tests/classes/image-color-converter.test.js`              | Remove adaptive BPC config tests         |
| `tests/classes/lookup-table-color-converter.test.js`       | Remove adaptive BPC config tests         |
| `tests/classes/composite-color-converter.test.js`          | Remove adaptive BPC config tests         |
| `tests/classes/pdf-document-color-converter.test.js`       | Remove adaptive BPC config tests         |
| `tests/classes/pdf-page-color-converter.test.js`           | Remove adaptive BPC config tests         |
| `tests/classes/pdf-image-color-converter.test.js`          | Remove adaptive BPC + Lab coercion tests |
| `tests/classes/pdf-content-stream-color-converter.test.js` | Remove adaptive BPC config tests         |

### 4.6 Documentation

| File                                                      | Changes Required                                                                           |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `classes/documentation/ColorConverter.md`                 | Remove BPC clamping sections                                                               |
| `classes/documentation/ImageColorConverter.md`            | Remove BPC clamping sections                                                               |
| `classes/documentation/LookupTableColorConverter.md`      | Remove BPC clamping sections                                                               |
| `classes/documentation/PDFDocumentColorConverter.md`      | Remove BPC config                                                                          |
| `classes/documentation/PDFPageColorConverter.md`          | Remove BPC config propagation                                                              |
| `classes/documentation/PDFImageColorConverter.md`         | Remove BPC + Lab coercion sections                                                         |
| `classes/documentation/PDFContentStreamColorConverter.md` | Remove BPC config                                                                          |
| `classes/documentation/PDFImageColorSampler.md`           | Remove BPC config                                                                          |
| `classes/documentation/WorkerPool.md`                     | Remove BPC task config                                                                     |
| `CLAUDE.md` (project root)                                | Update Color Engine API section, remove `initBPCClamping`/`doTransformAdaptive` references |
| `2025-12-01-Color-Engine-Integration-Progress.md`                    | Update with new engine version info                                                        |

### 4.7 New Files

| File                                      | Purpose                                                            |
| ----------------------------------------- | ------------------------------------------------------------------ |
| `classes/legacy-color-engine-provider.js` | All legacy engine compatibility code (BPC clamping + Lab coercion) |

---

## 5. Open Questions

1. **Lab `0/-128/-128` SIMD scope:** The description says "only when 2-or-more profile chains start from and end in Lab." Does this cover the main use case (Lab source image → CMYK output via single createTransform)? Or does it only apply to multiprofile chains? If the latter, consumer-side coercion may still be needed for Lab → CMYK single-profile transforms.

2. **K-Only GCR black for Lab:** Currently, when Lab images with all-zero pixels are converted to CMYK with K-Only GCR intent, the code precomputes a Relative Colorimetric black pixel. Does the new engine's Lab handling make this unnecessary? Or does K-Only GCR still produce incorrect output for Lab `0/-128/-128`?

3. **`pdf-diff.js` Lab coercion:** This is a developer-owned experiment script that has its own Lab coercion implementation. It does not use `ColorEngineProvider`. Should it be updated to use the provider, or should it retain independent logic? (It only does Lab → Lab Float32 output.)

4. **`cms_BLACKPOINTCOMPENSATION_CLAMPING` flag behavior:** Should this flag always be set when `cmsFLAGS_BLACKPOINTCOMPENSATION` is set? Or should it remain a separate opt-in? (See Section 8, Q2 in the BPC requirements document.)

5. **Worker path validation:** `StreamTransformWorker.js` currently does its own BPC clamping independently of `ColorConverter`. After migration, workers will use plain `engine.transformArray()` with the flag. Need to verify worker results match main-thread results.

6. **Backward compatibility testing:** What is the validation strategy? Run the full verification matrix with both old and new engine, compare outputs pixel-for-pixel?

---

## Activity Log

| Date       | Activity                                                                                                                                                      |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-02-09 | Created progress document. Completed full codebase audit. Evaluated 4 architecture options. Recommended Option C (Provider Strategy with Lab Coercion Hooks). |
| 2026-02-12 | **Architectural Rework (Legacy/Non-Legacy Separation).** Phase A: Cleaned base classes — removed `useAdaptiveBPCClamping` from typedef, removed `#ADAPTIVE_BPC_THRESHOLD`, removed consumer-side adaptive BPC logic from `convertColorsBuffer()`, simplified transform caching. Removed `coerceLabAbsoluteZeroPixels` from `PDFImageColorConverter`. Removed legacy config propagation from `PDFPageColorConverter`, `PDFDocumentColorConverter`. Added `workerScript` config to `CompositeColorConverter`. Phase B: Created full Legacy class hierarchy in `classes/legacy/`: `legacy-color-converter-helpers.js` (shared utilities), `legacy-pdf-image-color-converter.js` (Lab coercion + consumer-side BPC), `legacy-pdf-content-stream-color-converter.js` (conservative multiprofile + chain fallback), `legacy-pdf-page-color-converter.js` (full duplication creating Legacy children), `legacy-worker-pool-entrypoint.js` (worker script using Legacy classes), `legacy-pdf-document-color-converter.js` (overrides convertColor, duplicates PDF parsing helpers, sets legacy workerScript). Phase C: Updated factory — non-legacy path no longer sets `coerceLabAbsoluteZeroPixels`, legacy path sets `useAdaptiveBPCClamping: true` default. Phase E: All 284 tests pass (51 skipped, 0 failures). |
| 2026-02-12 | Implemented integration plan (Phases 1–6). Architecture: configuration-based branching (not full provider refactoring). Changes: (1) `color-engine-provider.js` — renamed `cmsFLAGS_MULTIPROFILE_BPC_SCALING` → `cmsFLAGS_MULTIPROFILE_BLACKPOINT_SCALING`, added `cmsFLAGS_BLACKPOINTCOMPENSATION_CLAMPING` constant, added `parseVersionNumber()` and `isColorEngineSupported()` static methods. (2) `color-converter.js` — added `blackpointCompensationClamping` config property, engine-side BPC clamping via flag when enabled, consumer-side adaptive BPC only when disabled. (3) `pdf-image-color-converter.js` — added `coerceLabAbsoluteZeroPixels` config property, replaced module constant with configuration check. (4) `pdf-document-color-converter.js` — added `isColorEngineSupported()` and constructor version validation via `new.target`. (5) Created `legacy/legacy-pdf-document-color-converter.js` for engines ≤ 2026-01-30. (6) Created `create-document-color-converter.js` factory. (7) Updated `convert-pdf-color.js` to use factory. (8) All 284 tests pass. (9) Deleted stale `color-converter copy.js`. Regression verification: new engine (output/2026-02-12-004) — 6/6 conversions, 6/6 changes PASS. Legacy engine (output/2026-02-12-005) — 6/6 conversions, 6/6 changes PASS. Legacy engine correctly uses consumer-side adaptive BPC clamping and Lab absolute-zero pixel coercion (6383 pixels replaced in Lab K-Only GCR conversion). |
