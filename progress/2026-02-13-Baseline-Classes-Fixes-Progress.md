# 2026-02-13 — Baseline Classes Fixes

**Purpose:** Investigate discrepancies in how baseline classes handle `color-engine-2025-12-19` versus `color-engine-2026-01-30`, document root causes, and recommend resolutions.

**Last Updated:** 2026-02-13T08

---

## Roadmap

### Investigation

- [x] Create progress document
- [x] Investigate Issue 1 — K-Only GCR policy handling for engines without `createMultiprofileTransform`
- [x] Investigate Issue 2 — Worker configuration propagation failures
- [x] Investigate Issue 3 — Content stream conversion failure for `color-engine-2025-12-19`
- [x] Create summary table

### Implementation (`classes/baseline/` only)

- [x] Issue 1a — Implement multi-stage fallback in `color-converter.js`
- [x] Issue 1b — Eliminate hardcoded intent overrides in `image-color-converter.js` and `pdf-content-stream-color-converter.js`
- [x] Issue 2 — Pass actual engine version to worker-created converters in `worker-pool-entrypoint.js`
- [x] Issue 3 — Remove hardcoded `requiresMultiprofileTransform: true` from `pdf-content-stream-color-converter.js`

### Profile String Enforcement (`classes/baseline/` only)

- [x] Remove `'sRGB'` from `ProfileType` typedef — only `ArrayBuffer | 'Lab'` allowed
- [x] Update `#openProfile` to throw on any string except `'Lab'`
- [x] Update `#getProfileCacheKey` to throw on any string except `'Lab'`
- [x] Resolve intermediate profile loading gap — policy outputs absolute URLs, `ColorEngineProvider.loadProfile` fetches into `ArrayBuffer`

### Testing and Bug Fixes

- [x] Fix `loadProfile` validation logic — `!rawBuffer || !(response?.ok === true)` falsely throws when `fs.readFile` succeeds (both `color-engine-provider.js` and `profile-pool.js`)
- [x] Add profile handle validation in `#openProfile` — throws if `openProfileFromMem` returns 0
- [x] Add diagnostic context to multi-stage transform errors — logs profile handles, formats, intent, flags
- [x] Fix `#getIntermediateFormat` — was always using Float32, fails for `TYPE_*_16_SE → TYPE_*_FLT` (LittleCMS limitation); now matches bit depth and endianness from stage input format
- [ ] Implement policy serialization — pass `ColorConversionPolicy.rules` from main thread to workers
- [x] Investigate Issue 4 — `outputBitsPerComponent` and `outputEndianness` not propagating to workers
- [x] Fix Issue 4 — Gap 1: `prepareWorkerTask()` config fallback; Gap 2: worker converter config

### Research

- [x] Research how profiles are loaded across the codebase (`classes/`, `services/`)

---

## Decisions

### Issue 1 — Decided Resolution

1. **Multi-stage fallback:** Implement fallback multi-stage transformations using `createTransform()` and `transformArray()` when `createMultiprofileTransform` is unavailable (`undefined`). For each conversion where `requiresMultiprofileTransform: true`:
   - When `intermediateProfiles` is empty — single transformation (source → destination)
   - When `intermediateProfiles` is not empty — two or more transformations (source → intermediate₁ → ... → intermediateₙ → destination)

2. **Eliminate hardcoded intent overrides:** Remove `ImageColorConverter.getEffectiveRenderingIntent()` hardcoded overrides. Policy rules already handle K-Only GCR → Relative Colorimetric fallback for Lab sources and non-CMYK destinations via `k-only-gcr-to-relative-colorimetric-fallback`.

### Issue 2 — Decided Resolution

Derive actual engine version from `colorEngineProvider.module.VERSION` after `initialize()` and pass it as `engineVersion` to worker-created converters.

### Issue 3 — Decided Resolution

Remove hardcoded `requiresMultiprofileTransform: true` from `PDFContentStreamColorConverter.convertBatchUncached()`. Policy rules are the sole authority for determining transform requirements.

---

## Experiment Context

Two debugging configurations were run:

| Configuration | Engine | Output |
| --- | --- | --- |
| `2026-02-12-REFACTOR-FIXTURES-DEBUGGING-2025-12-19.json` | `color-engine-2025-12-19` | `output/2026-02-13-003` |
| `2026-02-12-REFACTOR-FIXTURES-DEBUGGING-2026-01-30.json` | `color-engine-2026-01-30` | `output/2026-02-13-004` |

---

## Issue 1 — K-Only GCR Policy Handling for Engines Without `createMultiprofileTransform`

### Observation

With `color-engine-2025-12-19`, K-Only GCR conversions succeed for some source color spaces but fail for others:

| Source Color Space | Destination | Intent | Result |
| --- | --- | --- | --- |
| RGB → CMYK | K-Only GCR | Succeeds | |
| Lab → CMYK | K-Only GCR | Succeeds (falls back to Relative Colorimetric) | |
| Gray → CMYK | K-Only GCR | **Fails** | |

### Root Cause

Three interacting factors determine whether K-Only GCR succeeds or fails on `color-engine-2025-12-19`:

**Factor 1 — Policy rule fires for non-RGB sources:**

The policy `k-only-gcr-legacy-multistage-transform-requirement` (in `color-conversion-rules.json`, lines 36–65) applies to engines `color-engine-2025-12-15` and `color-engine-2025-12-19`. It matches:

- Rendering intent: `preserve-k-only-relative-colorimetric-gcr`
- Source color spaces: `Gray`, `CMYK`, `Lab`
- Destination color spaces: `CMYK`

When matched, it sets:

```json
{
  "requiresMultiprofileTransform": true,
  "intermediateProfiles": ["../../resources/profiles/sRGB v4.icc"]
}
```

**Factor 2 — `createMultiprofileTransform` is unavailable:**

`ColorEngineProvider.createMultiprofileTransform()` (in `baseline/color-engine-provider.js`, line 318–329) checks for the engine method and throws:

```javascript
if (!this.engine.createMultiprofileTransform) {
    throw new Error('createMultiprofileTransform not available in this engine version');
}
```

`color-engine-2025-12-19` does not expose `createMultiprofileTransform`. There is no fallback two-stage transform implementation.

**Factor 3 — Lab is rescued by a hardcoded intent override:**

`ImageColorConverter.getEffectiveRenderingIntent()` (in `baseline/image-color-converter.js`, lines 229–241) unconditionally overrides K-Only GCR to `relative-colorimetric` when the source is `Lab`:

```javascript
if (intent === 'preserve-k-only-relative-colorimetric-gcr') {
    if (colorType === 'Lab' || destCS === 'RGB') {
        return 'relative-colorimetric';
    }
}
```

This intent override happens **before** policy evaluation in `convertColorsBuffer`. With intent changed to `relative-colorimetric`, the legacy multiprofile policy rule no longer matches (it requires `preserve-k-only-relative-colorimetric-gcr`), so `requiresMultiprofileTransform` is never set, and the single-transform path is used instead.

**Factor 4 — RGB bypasses the policy rule entirely:**

The policy rule's `sourceColorSpaces` constraint only includes `Gray`, `CMYK`, and `Lab` — not `RGB`. RGB → CMYK K-Only GCR is natively supported by the engine without multiprofile transforms, so no rule fires and the single transform path succeeds.

### Why Gray → CMYK Fails

Gray is not rescued by the hardcoded intent override (only Lab and RGB destination are). The policy rule fires, sets `requiresMultiprofileTransform: true`, and the code reaches `#getOrCreateMultiprofileTransform()` (in `baseline/color-converter.js`, line 828), which calls `provider.createMultiprofileTransform()` → throws.

### Recommended Resolution

Implement a two-stage fallback in `ColorConverter.#getOrCreateMultiprofileTransform()`:

When `provider.createMultiprofileTransform` is unavailable and intermediate profiles are specified by policy, perform two sequential single-profile transforms:

1. Source → Intermediate (e.g., Gray → sRGB) with Relative Colorimetric
2. Intermediate → Destination (e.g., sRGB → CMYK) with K-Only GCR

This preserves the policy architecture while gracefully handling engines that lack the native multiprofile API.

---

## Issue 2 — Worker Configuration Propagation Failures

### Observation

With `color-engine-2025-12-19`, worker-based conversions fail for FIPS_WIDE_28T-TYPEavg (RGB → RGB with Relative Colorimetric + BPC), while main-thread conversions of eciCMYK v2 Relative Colorimetric succeed.

The experiment used 7 workers, and the failure manifested specifically for the RGB destination profile.

### Root Cause

Two interacting factors cause this failure:

**Factor 1 — `DEFAULT_ENGINE_VERSION` is derived from the symlinked package, not the loaded engine:**

In `baseline/color-engine-provider.js`, lines 93–103:

```javascript
import { VERSION as COLOR_ENGINE_VERSION } from '../../packages/color-engine/src/index.js';
const DEFAULT_ENGINE_VERSION = `color-engine-${COLOR_ENGINE_VERSION}`;
```

This is a static import resolved at module load time. It always reflects whatever version the `packages/color-engine` symlink points to — **regardless of what engine path the worker actually loads**.

**Factor 2 — Workers don't pass `engineVersion` to converters:**

In `baseline/worker-pool-entrypoint.js`, `processImage()` at lines 203–214:

```javascript
const converter = new PDFImageColorConverter({
    renderingIntent: task.renderingIntent,
    blackPointCompensation: task.blackPointCompensation,
    useAdaptiveBPCClamping: task.useAdaptiveBPCClamping,
    destinationProfile: task.destinationProfile,
    destinationColorSpace: task.destinationColorSpace,
    inputType: task.colorSpace,
    compressOutput: true,
    verbose: false,
}, {
    colorEngineProvider,
    // NO engineVersion passed!
    // NO policy passed!
});
```

The converter falls back to `DEFAULT_ENGINE_VERSION` for policy evaluation. If the symlink points to `color-engine-2026-01-30` but the worker loads `color-engine-2025-12-19`, the policy evaluates rules for the wrong engine version.

**The specific failure path for FIPS_WIDE_28T-TYPEavg:**

1. Worker loads `color-engine-2025-12-19` (as specified by the configuration's `colorEnginePath`)
2. Policy evaluates using `DEFAULT_ENGINE_VERSION` = `color-engine-2026-01-30` (from symlink)
3. Rule `rgb-to-rgb-multiprofile-black-point-scaling-enhancement` (lines 98–127 in `color-conversion-rules.json`) matches because:
   - Engine list includes `color-engine-2026-01-30`
   - Rendering intent is `relative-colorimetric` + BPC is `true`
   - Destination color space is `RGB`
4. Policy sets `requiresMultiprofileTransform: true` with `multiprofileBlackPointScaling: true`
5. Worker calls `provider.createMultiprofileTransform()` → throws because actual loaded engine is `color-engine-2025-12-19`

**Why eciCMYK v2 Relative Colorimetric succeeds on main thread:**

Main-thread converters are created with the correct `engineVersion` option (from the configuration), so policy evaluates against `color-engine-2025-12-19`. The `rgb-to-rgb-multiprofile-black-point-scaling-enhancement` rule does not match `color-engine-2025-12-19`, and no multiprofile transform is required. Additionally, CMYK destination doesn't trigger this RGB-specific rule.

### Recommended Resolution

Pass the actual engine version to worker-created converters. Two approaches:

**Approach A — Pass `engineVersion` in the worker task data:**

1. In `composite-color-converter.js`, include the engine version in the worker pool configuration
2. In `worker-pool-entrypoint.js`, pass `engineVersion` when constructing converters:
   ```javascript
   const converter = new PDFImageColorConverter({...}, {
       colorEngineProvider,
       engineVersion: workerConfig.engineVersion,
   });
   ```

**Approach B — Derive version from the actually loaded engine:**

After `colorEngineProvider.initialize()`, read the version from the loaded module:
```javascript
const actualVersion = `color-engine-${colorEngineProvider.module.VERSION}`;
```

Approach B is more robust because it derives the version from the engine that was actually loaded, eliminating any mismatch possibility.

---

## Issue 3 — Content Stream Conversion Failure for `color-engine-2025-12-19`

### Observation

With `color-engine-2025-12-19`, ALL content stream color conversions fail — regardless of source color space, rendering intent, or destination profile. Content streams in `output/2026-02-13-003` are never converted, while `output/2026-02-13-004` (using `color-engine-2026-01-30`) converts them correctly.

### Root Cause

`PDFContentStreamColorConverter.convertBatchUncached()` (in `baseline/pdf-content-stream-color-converter.js`, line 494) **hardcodes** `requiresMultiprofileTransform: true`:

```javascript
const result = await this.convertColorsBuffer(inputBuffer, {
    inputColorSpace: colorSpace,
    outputColorSpace: config.destinationColorSpace,
    sourceProfile,
    destinationProfile: config.destinationProfile,
    renderingIntent: effectiveIntent,
    blackPointCompensation: config.blackPointCompensation,
    bitsPerComponent: 32,
    inputBitsPerComponent: 32,
    outputBitsPerComponent: 32,
    requiresMultiprofileTransform: true,  // ← HARDCODED
});
```

This forces ALL content stream conversions through the multiprofile transform path in `ColorConverter.convertColorsBuffer()` (at `baseline/color-converter.js`, lines 558–561):

```javascript
if (
    requiresMultiprofileTransform
    && evaluationResult.overrides.requiresMultiprofileTransform !== false
    || evaluationResult.overrides.requiresMultiprofileTransform
) {
    // Multiprofile transform path
```

Because `requiresMultiprofileTransform` is `true` from the caller, and the policy doesn't explicitly set `requiresMultiprofileTransform: false`, the condition evaluates to `true` for every content stream conversion.

On `color-engine-2025-12-19`, `provider.createMultiprofileTransform()` always throws → every content stream conversion fails.

On `color-engine-2026-01-30`, `createMultiprofileTransform` is available → content stream conversions succeed.

### Why This Is a Bug

The hardcoded `requiresMultiprofileTransform: true` contradicts the policy-based architecture. Whether a multiprofile transform is needed should be determined by the policy rules based on the conversion descriptor (source color space, destination color space, rendering intent, engine version) — not hardcoded by the caller.

For most content stream conversions (e.g., DeviceCMYK → CMYK Relative Colorimetric, DeviceRGB → CMYK Relative Colorimetric), no multiprofile transform is needed. The single-transform path is correct.

### Recommended Resolution

Remove the hardcoded `requiresMultiprofileTransform: true` from `PDFContentStreamColorConverter.convertBatchUncached()`. Let the policy rules determine transform requirements:

```javascript
const result = await this.convertColorsBuffer(inputBuffer, {
    inputColorSpace: colorSpace,
    outputColorSpace: config.destinationColorSpace,
    sourceProfile,
    destinationProfile: config.destinationProfile,
    renderingIntent: effectiveIntent,
    blackPointCompensation: config.blackPointCompensation,
    bitsPerComponent: 32,
    inputBitsPerComponent: 32,
    outputBitsPerComponent: 32,
    // Removed: requiresMultiprofileTransform: true
    // Policy rules will set this when actually needed
});
```

---

## Summary Table

| Issue | Root Cause | Affected Engine(s) | Affected Conversions | Recommended Resolution |
| --- | --- | --- | --- | --- |
| **1. K-Only GCR + no multiprofile API** | Policy `k-only-gcr-legacy-multistage-transform-requirement` sets `requiresMultiprofileTransform: true`, but `createMultiprofileTransform` is unavailable on legacy engines. No fallback two-stage implementation exists. | `color-engine-2025-12-15`, `color-engine-2025-12-19` | Gray → CMYK K-Only GCR (Lab is rescued by hardcoded intent override; RGB bypasses the policy rule) | Implement two-stage fallback in `ColorConverter.#getOrCreateMultiprofileTransform()`: Source → Intermediate, then Intermediate → Destination when native multiprofile API is unavailable |
| **2. Worker engine version mismatch** | `DEFAULT_ENGINE_VERSION` is derived from the symlinked package, not the engine actually loaded by the worker. Workers don't pass `engineVersion` to converters. Wrong policy rules fire for the wrong engine. | Any engine when symlink differs from worker-loaded engine | Any worker conversion where policy rules differ between symlinked and loaded engine versions (e.g., FIPS_WIDE_28T-TYPEavg RGB with BPC) | Derive actual engine version from the loaded module and pass it to worker-created converters |
| **3. Hardcoded multiprofile in content streams** | `PDFContentStreamColorConverter.convertBatchUncached()` hardcodes `requiresMultiprofileTransform: true` regardless of policy evaluation | `color-engine-2025-12-15`, `color-engine-2025-12-19` (any engine without `createMultiprofileTransform`) | ALL content stream color conversions | Remove hardcoded `requiresMultiprofileTransform: true`; let policy rules determine transform requirements |
| **4. Worker `outputBitsPerComponent`/`outputEndianness` not propagating** | Two gaps: (1) `prepareWorkerTask()` only reads from `input`, missing config fallback; (2) worker converter created without either in config. Known bug since `2026-02-03-DEBUG-SAMPLING-PROGRESS.md` | All engines, all worker-based conversions | Any worker image conversion where config specifies `outputBitsPerComponent` or `outputEndianness` overrides | Gap 1: add `?? this.configuration.*` fallback in `prepareWorkerTask()`; Gap 2: add both to worker converter config |

---

## Activity Log

| Date | Activity |
| --- | --- |
| 2026-02-13 | Created progress document; investigated and documented all three issues with root cause analysis and recommendations |
| 2026-02-13 | Implemented all fixes in `classes/baseline/` — see Changes section below |
| 2026-02-13 | Enforced `'Lab'`-only string profile handling: updated `ProfileType` typedef, `#openProfile`, `#getProfileCacheKey` to reject `'sRGB'` and all non-Lab strings |
| 2026-02-13 | Researched profile loading across codebase — see Profile Loading Research section below |
| 2026-02-13 | Resolved intermediate profile loading: policy outputs absolute URLs, `ColorEngineProvider.loadProfile` loads them, `convertColorsBuffer` resolves before `#openProfile` |
| 2026-02-13 | Fixed `loadProfile` validation logic in both `color-engine-provider.js` and `profile-pool.js` — changed `!rawBuffer \|\| !(response?.ok === true)` to `!rawBuffer \|\| (response !== null && !response.ok)` so fs.readFile success path doesn't falsely throw |
| 2026-02-13 | Added profile handle validation in `#openProfile` and diagnostic context to multi-stage transform errors — revealed root cause: `TYPE_GRAY_16_SE → TYPE_RGB_FLT` (LittleCMS SE → float limitation) |
| 2026-02-13 | Fixed `#getIntermediateFormat` — now derives intermediate format from stage input format (matching bit depth and endianness) instead of always using Float32. For 16-bit SE input, produces 16-bit SE intermediate; for float input, produces float intermediate |
| 2026-02-13 | Investigated Issue 4 — `outputBitsPerComponent`/`outputEndianness` not propagating to workers. Identified two gaps: (1) `prepareWorkerTask()` only reads from input, not config fallback; (2) worker converter created without either in config. Regression analysis across 7 scenarios: all SAFE |
| 2026-02-13 | Fixed Issue 4 — Gap 1: added `?? this.configuration.outputBitsPerComponent` and `?? this.configuration.outputEndianness` fallbacks in `prepareWorkerTask()`; Gap 2: added both to worker converter config in `processImage()` |

---

## Profile Loading Research

### Question

Where and how are ICC profiles loaded into `ArrayBuffer` across the codebase? This determines where intermediate profile loading (for multi-stage transforms) should happen.

### Findings

There are **three distinct profile loading mechanisms** in the codebase:

#### 1. `classes/profile-pool.js` (and `classes/baseline/profile-pool.js`)

**Method:** `#loadProfile(source, key)` at line 277

**Accepts:** `string | ArrayBuffer`

**Loading strategy:**
- `string` → `fetch(source)` → `response.arrayBuffer()`
- `ArrayBuffer` → used directly (cloned or copied to `SharedArrayBuffer`)

**Features:** Reference counting, `SharedArrayBuffer` support for worker transfer, `FinalizationRegistry` for automatic cleanup, LRU eviction.

**Used by:** `getProfile(source)` which is the public API. The `ProfilePool` is instantiated at the document converter level (`PDFDocumentColorConverter`) and shared across page/image/stream converters.

**Isomorphic:** Uses `fetch` — works in browser and Node.js (Node 18+ has global `fetch`).

#### 2. `services/ColorEngineService.js`

**Method:** `loadProfile(source)` at line 127

**Accepts:** `string | ArrayBuffer`

**Loading strategy:**
- `ArrayBuffer` → returned as-is
- `string` matching `BUILTIN_PROFILES` (`'sRGB'`, `'sGray'`, `'Lab'`) → returned as string identifier
- `string` (other) → `fetch(source)` → `response.arrayBuffer()`

**Features:** Simple URL-keyed `Map` cache. Built-in profile identifiers (`'sRGB'`, `'sGray'`, `'Lab'`) are passed through as strings and resolved to engine calls in `#openProfile`.

**Isomorphic:** Uses `fetch`.

#### 3. `services/ProfileSelectionService.js`

**Method:** `#loadProfileFromSearchLocations(profileName)` at line 220

**Accepts:** `string` (filename, e.g., `"sGray.icc"`)

**Loading strategy:**
- Searches through configured `profileSearchLocations` directories
- For each location: `fetch(path)` → `response.arrayBuffer()` → `new Uint8Array(buffer)`
- Optional `#profileLoader` callback for custom loading (e.g., Node.js `fs.readFile`)

**Features:** Multi-directory search, custom loader injection point, `Uint8Array` return type (not `ArrayBuffer`).

**Isomorphic:** Uses `fetch` by default, with `#profileLoader` callback for non-browser environments.

### Comparison

| Aspect | `ProfilePool` (classes/) | `ColorEngineService` (services/) | `ProfileSelectionService` (services/) |
| --- | --- | --- | --- |
| Input | URL or ArrayBuffer | URL, ArrayBuffer, or built-in string | Filename (searched in configured dirs) |
| Output | ArrayBuffer (possibly SharedArrayBuffer) | ArrayBuffer or built-in string | Uint8Array |
| Loading | `fetch` | `fetch` | `fetch` or custom loader |
| Caching | Ref-counted + SharedArrayBuffer | Simple Map | Simple Map |
| Built-in profiles | None | `'sRGB'`, `'sGray'`, `'Lab'` | None |
| Used in workers | Yes (via SharedArrayBuffer) | No | No |

### The Gap (Resolved)

`ColorConversionPolicy` resolves intermediate profile paths relative to the rules JSON file. Previously, these were re-relativized to path strings that no loader could consume. `#openProfile` correctly rejects all strings except `'Lab'`.

### Resolution

**Responsibility split:**

- **`ColorConversionPolicy`** — resolves relative paths from the rules JSON to absolute URLs (`resolvedProfileURL.href`). The policy knows the rules file path, so absolute resolution is its responsibility. The re-relativization code is kept (marked "DO NOT REMOVE") for future use.
- **`ColorEngineProvider.loadProfile`** — loads ICC profile data from absolute URLs into `ArrayBuffer`. Uses reverse strategy: try `fs/promises` first (Node.js), fall back to `fetch` (browser). Caches results by URL.
- **`ColorConverter.convertColorsBuffer`** — after policy evaluation returns `intermediateProfiles` (now absolute URL strings), resolves each through `provider.loadProfile()` before assembling the profiles array for `#getOrCreateMultiprofileTransform`.

---

## Changes (`classes/baseline/` only)

### `color-converter.js`

1. **Removed `requiresMultiprofileTransform` from `convertColorsBuffer` options destructuring** — policy is the sole authority for determining whether multiprofile transforms are needed.

2. **Simplified multiprofile branching condition** — changed from `requiresMultiprofileTransform && overrides !== false || overrides` to `evaluationResult.overrides.requiresMultiprofileTransform` (policy-only).

3. **Implemented multi-stage fallback in `#getOrCreateMultiprofileTransform`:**
   - When `createMultiprofileTransform` is available: uses native multiprofile transform (unchanged)
   - When unavailable: builds a chain of individual `createTransform` calls
   - Intermediate stages use Relative Colorimetric intent; final stage uses the requested intent (e.g., K-Only GCR)
   - Intermediate pixel format: Float32 to avoid precision loss between stages
   - Returns `MultiStageTransformCacheEntry` with `stages` array (vs `SingleTransformCacheEntry` with `transform` handle)

4. **Added `#executeMultiStageTransform` method** — executes a chain of transforms with intermediate buffers between stages.

5. **Replaced `#getIntermediateFormat` method** — originally always used Float32, which fails for `TYPE_*_16_SE → TYPE_*_FLT` (LittleCMS limitation). Now derives intermediate format from the stage's input format: 16-bit SE input → 16-bit SE intermediate, float input → float intermediate, 8-bit input → 8-bit intermediate.

6. **Added profile handle validation in `#openProfile`** — throws with descriptive error if `openProfileFromMem` returns 0 (null handle), instead of silently caching invalid handles.

7. **Added diagnostic context to multi-stage transform errors** — logs profile handles, format hex values, intent, and flags for debugging.

8. **Changed `ProfileType` typedef** — from `ArrayBuffer | 'Lab' | 'sRGB'` to `ArrayBuffer | 'Lab'`. Only `'Lab'` is allowed as a string identifier (for future whitepoint control). All other profiles must be provided as `ArrayBuffer`.

9. **Updated `#openProfile`** — throws on any string except `'Lab'`; throws on non-ArrayBuffer non-string types. Comments explain the rationale.

10. **Updated `#getProfileCacheKey`** — throws on any string except `'Lab'` (previously silently returned `'sRGB'` as a cache key).

### `image-color-converter.js`

1. **Removed hardcoded intent overrides from `getEffectiveRenderingIntent`** — now returns `configuration.renderingIntent` unchanged. Policy rules (`k-only-gcr-to-relative-colorimetric-fallback`) handle intent overrides for Lab source and non-CMYK destinations.

### `pdf-content-stream-color-converter.js`

1. **Removed hardcoded `requiresMultiprofileTransform: true`** from `convertBatchUncached` (was at line 494). Policy rules now determine transform requirements.

2. **Removed hardcoded intent overrides from `getEffectiveRenderingIntent`** — same change as `image-color-converter.js`.

### `color-engine-provider.js`

1. **Fixed `loadProfile` validation logic** — changed `!rawBuffer || !(response?.ok === true)` to `!rawBuffer || (response !== null && !response.ok)`. The original condition falsely threw when `fs.readFile` succeeded because `response` remained `null` and `!(null?.ok === true)` evaluated to `true`.

### `profile-pool.js`

1. **Fixed `#loadProfile` validation logic** — same fix as `color-engine-provider.js`.

### `worker-pool-entrypoint.js`

1. **Added `engineVersion` module variable** — derived from `colorEngineProvider.module.VERSION` after engine initialization.

2. **Passed `engineVersion` to both converter constructors** — `PDFImageColorConverter` (in `processImage`) and `PDFContentStreamColorConverter` (in `processContentStream`) now receive the actual loaded engine version for correct policy evaluation.

3. **Added `outputBitsPerComponent` and `outputEndianness` to worker converter config** — `processImage()` now includes `outputBitsPerComponent: task.outputBitsPerComponent` and `outputEndianness: task.outputEndianness` in the `PDFImageColorConverter` constructor config, so the worker converter can fall back to config values when input doesn't specify them.

### `pdf-image-color-converter.js`

1. **Added config fallback in `prepareWorkerTask()`** — changed `outputBitsPerComponent: input.outputBitsPerComponent` to `input.outputBitsPerComponent ?? this.configuration.outputBitsPerComponent`, and same for `outputEndianness`. Previously, when `input` didn't carry these values (which is always the case — `#extractImageInput` never sets them), the worker task received `undefined`, silently discarding the document-level configuration override.
