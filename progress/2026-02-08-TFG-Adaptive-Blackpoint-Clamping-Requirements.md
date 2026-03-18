# TFG: Adaptive Black Point Clamping — Requirements & Migration Plan

**Date:** 2026-02-08  
**Status:** Draft  
**Scope:** Color-engine API surface changes for BPC clamping consolidation  
**References:** `conres.io/testing/iso/ptf/2025/classes/`, `conres.io/testing/iso/ptf/2025/services/`

---

## 1. Background

The current color-engine exposes three overlapping mechanisms for black point compensation clamping:

| Mechanism | Layer | Description |
|---|---|---|
| `doTransformAdaptive()` | JS (consumer) | Wraps `doTransform()` with post-processing clamping using adaptive per-channel thresholds computed from profile black points |
| `doTransformWithBPCClamp()` | JS (consumer) | Wraps `doTransform()` with post-processing clamping using pre-computed or fixed thresholds |
| `cmsFLAGS_BPC_CLAMP_OPTIMIZE` | Engine (WASM) | Engine-internal flag that applies fixed clamping during the transform pipeline — no JS post-processing needed |

All three solve the same problem: preventing BPC overshoot artifacts in shadow regions when `cmsFLAGS_BLACKPOINTCOMPENSATION` is active. The JS-side methods predate the engine flag and are redundant now that the engine supports clamping natively.

**Goal:** Remove `doTransformAdaptive()` and `doTransformWithBPCClamp()` from the engine's public API. Rename `cmsFLAGS_BPC_CLAMP_OPTIMIZE` to `cms_BLACKPOINTCOMPENSATION_CLAMPING` and ensure it covers all current use cases, including the adaptive threshold behavior.

---

## 2. Current Usage in `PDFDocumentColorConverter` Chain

### 2.1 Invocation Chain

```
PDFDocumentColorConverter.convertColor()
  └─ PDFPageColorConverter.convertColor()
       ├─ PDFImageColorConverter.convertColor()
       │    ├─ ImageColorConverter.#convertDirect()
       │    │    └─ doTransformAdaptive()        ← batch pixel buffers
       │    └─ LookupTableColorConverter.convertColor()
       │         └─ doTransformWithBPCClamp()    ← palette entries (≤256)
       └─ PDFContentStreamColorConverter.convertColor()
            └─ ColorConverter.convertColor()
                 ├─ doTransformAdaptive()         ← batch color ops
                 └─ #convertSingleColor()
                      └─ doTransformWithBPCClamp() ← single color value
```

### 2.2 Activation Conditions

Both JS methods are gated by a double opt-in:

```javascript
if (config.blackPointCompensation && config.useAdaptiveBPCClamping) {
    this.initBPCClamping(sourceProfile, destProfile);
    // → doTransformAdaptive() or doTransformWithBPCClamp()
}
```

However, `useAdaptiveBPCClamping` defaults to `true` via the policy system:

```jsonc
// classes/configurations/color-conversion-rules.json → defaults
{
  "blackPointCompensation": true,
  "useAdaptiveBPCClamping": true
}
```

**Effective behavior:** Unless explicitly disabled by the consumer, adaptive BPC clamping is active for all transforms in the `PDFDocumentColorConverter` pipeline.

### 2.3 Mutual Exclusion with Engine Flag

The JS-side methods and the engine flag **never run together**. In `ColorEngineService`:

```javascript
// ColorEngineService.createTransform()
let flags = 0;
if (config.blackPointCompensation) {
    flags |= cmsFLAGS_BLACKPOINTCOMPENSATION;
    if (!config.useAdaptiveBPCClamping) {
        // Engine-side clamping only when JS-side clamping is NOT used
        flags |= cmsFLAGS_BPC_CLAMP_OPTIMIZE;
    }
}
```

This confirms the two paths are alternative implementations of the same behavior.

---

## 3. Detailed Method Analysis

### 3.1 `doTransformAdaptive()`

**Purpose:** Batch pixel-buffer transform with adaptive per-channel clamping.

**Algorithm (pseudocode):**

```javascript
doTransformAdaptive(transform, inputBuf, outputBuf, pixelCount) {
    // Step 1: Run the standard CMS transform
    this.engine.doTransform(transform, inputBuf, outputBuf, pixelCount);

    // Step 2: Post-process — clamp each output channel using
    //         adaptive thresholds from initBPCClamping()
    for (let i = 0; i < pixelCount * outputChannels; i++) {
        const ch = i % outputChannels;
        outputBuf[i] = Math.max(this.bpcClampMin[ch],
                       Math.min(this.bpcClampMax[ch], outputBuf[i]));
    }
}
```

**Call sites:**

| File | Method | Context |
|---|---|---|
| `classes/image-color-converter.js` | `#convertDirect()` | Image pixel buffers (RGB/Gray/Lab → CMYK) |
| `classes/color-converter.js` | `convertColor()` | Content stream color operations (batch path) |

**Why it exists:** The engine's `cmsFLAGS_BPC_CLAMP_OPTIMIZE` uses fixed internal thresholds. The adaptive variant probes the actual black points of the source and destination profiles to compute profile-specific thresholds.

### 3.2 `doTransformWithBPCClamp()`

**Purpose:** Single-value or small-buffer transform with pre-computed BPC clamping.

**Algorithm (pseudocode):**

```javascript
doTransformWithBPCClamp(transform, inputBuf, outputBuf, pixelCount, clampParams) {
    // Step 1: Run the standard CMS transform
    this.engine.doTransform(transform, inputBuf, outputBuf, pixelCount);

    // Step 2: Apply fixed clamp thresholds (not adaptive)
    for (let i = 0; i < pixelCount * outputChannels; i++) {
        outputBuf[i] = Math.max(clampParams.min,
                       Math.min(clampParams.max, outputBuf[i]));
    }
}
```

**Call sites:**

| File | Method | Context |
|---|---|---|
| `classes/lookup-table-color-converter.js` | `convertColor()` | Indexed image palette conversion (≤256 entries) |
| `classes/color-converter.js` | `#convertSingleColor()` | Single color value fallback path in content streams |

**Why it exists:** Subset of `doTransformAdaptive` for cases where the overhead of adaptive threshold computation isn't justified (small buffers, single values).

### 3.3 `initBPCClamping()`

**Purpose:** Probes source and destination profile black points to compute adaptive per-channel clamping thresholds.

**Algorithm (pseudocode):**

```javascript
initBPCClamping(sourceProfile, destProfile) {
    const srcBlack = this.engine.detectBlackPoint(sourceProfile);
    const dstBlack = this.engine.detectBlackPoint(destProfile);

    // Compute per-channel min/max thresholds based on actual profile black points
    this.bpcClampMin = dstBlack.map((v, i) => /* profile-specific threshold */);
    this.bpcClampMax = /* ... */;
}
```

**Required by:** `doTransformAdaptive()`. Not needed by `doTransformWithBPCClamp()` (uses passed-in thresholds).

---

## 4. Gap Analysis: Engine Flag vs. JS Methods

| Capability | `cmsFLAGS_BPC_CLAMP_OPTIMIZE` | `doTransformAdaptive` | `doTransformWithBPCClamp` |
|---|---|---|---|
| Prevents BPC overshoot | ✅ | ✅ | ✅ |
| Fixed thresholds | ✅ (hardcoded in engine) | ❌ | ✅ (passed in) |
| Adaptive thresholds (profile-specific) | ❌ | ✅ (via `initBPCClamping`) | ❌ |
| Runs inside engine pipeline | ✅ (zero JS overhead) | ❌ (JS post-processing loop) | ❌ (JS post-processing loop) |
| Works for batch pixel buffers | ✅ | ✅ | ✅ |
| Works for single color values | ✅ | ✅ (overkill) | ✅ |
| Works for palette entries | ✅ | ✅ (overkill) | ✅ |

### Key Gap

The engine flag does **not** perform adaptive black-point probing. If adaptive thresholds are required for correctness, the engine must internalize the `initBPCClamping` logic (i.e., probe source/destination black points and compute per-channel thresholds during `createTransform`).

---

## 5. Requirements for `cms_BLACKPOINTCOMPENSATION_CLAMPING`

### 5.1 Functional Requirements

| ID | Requirement | Priority |
|---|---|---|
| **R1** | When `cms_BLACKPOINTCOMPENSATION_CLAMPING` is set, the engine SHALL clamp output values to prevent BPC overshoot during `doTransform()`. | Must |
| **R2** | Clamping thresholds SHOULD be computed from the actual black points of the source and destination profiles used in the transform, not hardcoded. This replaces the adaptive behavior of `initBPCClamping()`. | Should |
| **R3** | The flag SHALL work with `createTransform()` and `createMultiprofileTransform()`. | Must |
| **R4** | The flag SHALL work correctly for all pixel counts: single values (`pixelCount=1`), small buffers (palettes, ≤256), and large buffers (image data, millions of pixels). | Must |
| **R5** | The flag SHALL be ignored when `cmsFLAGS_BLACKPOINTCOMPENSATION` is not also set. | Must |
| **R6** | The flag SHALL support all output color spaces used in the PDF pipeline: CMYK (`TYPE_CMYK_8`), and future Lab/RGB outputs if needed. | Must |
| **R7** | The engine SHALL NOT require consumers to call any initialization method (like `initBPCClamping`) before using the flag. Threshold computation must be internal. | Must |

### 5.2 API Changes

#### Remove from Public API

```
doTransformAdaptive(transform, inputBuf, outputBuf, pixelCount)
doTransformWithBPCClamp(transform, inputBuf, outputBuf, pixelCount, clampParams)
initBPCClamping(sourceProfile, destProfile)
```

#### Rename

```
cmsFLAGS_BPC_CLAMP_OPTIMIZE  →  cms_BLACKPOINTCOMPENSATION_CLAMPING
```

#### Unchanged

```
doTransform(transform, inputBuf, outputBuf, pixelCount)  — unchanged, clamping is flag-driven
createTransform(...)    — accepts new flag name
createMultiprofileTransform(...)  — accepts new flag name
```

### 5.3 Non-Functional Requirements

| ID | Requirement |
|---|---|
| **NF1** | Engine-side clamping must not introduce measurable latency compared to `doTransform()` without the flag. The current JS post-processing loop iterates every output byte — the engine implementation should be at least as fast (WASM loop vs. JS loop). |
| **NF2** | Memory: No additional buffer allocations. Clamping operates in-place on the output buffer. |
| **NF3** | Threshold computation (if adaptive, per R2) must happen once at `createTransform()` time, not on every `doTransform()` call. |

---

## 6. Migration Plan for `conres.io` Consumers

### 6.1 Files Requiring Changes

| File | Change Required |
|---|---|
| `classes/color-converter.js` | Remove `initBPCClamping()`, `doTransformAdaptive()`, `doTransformWithBPCClamp()` calls. Replace with plain `doTransform()`. |
| `classes/image-color-converter.js` | Remove `doTransformAdaptive()` call in `#convertDirect()`. Replace with plain `doTransform()`. |
| `classes/lookup-table-color-converter.js` | Remove `doTransformWithBPCClamp()` call. Replace with plain `doTransform()`. |
| `classes/composite-color-converter.js` | Remove propagation of `bpcClampMin`/`bpcClampMax` to child converters, if applicable. |
| `services/ColorEngineService.js` | Remove mutual exclusion logic. Always set `cms_BLACKPOINTCOMPENSATION_CLAMPING` when `blackPointCompensation` is `true`. |
| `classes/configurations/color-conversion-rules.json` | `useAdaptiveBPCClamping` key becomes unnecessary — remove or deprecate. |
| `classes/color-conversion-policy.js` | Remove `useAdaptiveBPCClamping` handling from policy resolution. |

### 6.2 Configuration Simplification

**Before (current):**

```javascript
const converter = new PDFDocumentColorConverter({
    destinationProfile: cmykProfile,
    blackPointCompensation: true,           // enables BPC
    useAdaptiveBPCClamping: true,           // selects JS-side clamping path
});
```

**After (post-migration):**

```javascript
const converter = new PDFDocumentColorConverter({
    destinationProfile: cmykProfile,
    blackPointCompensation: true,           // enables BPC + engine-side clamping
    // useAdaptiveBPCClamping removed — engine always handles clamping when BPC is on
});
```

### 6.3 `ColorEngineService.createTransform()` Simplification

**Before:**

```javascript
let flags = 0;
if (config.blackPointCompensation) {
    flags |= cmsFLAGS_BLACKPOINTCOMPENSATION;
    if (!config.useAdaptiveBPCClamping) {
        flags |= cmsFLAGS_BPC_CLAMP_OPTIMIZE;
    }
}
```

**After:**

```javascript
let flags = 0;
if (config.blackPointCompensation) {
    flags |= cmsFLAGS_BLACKPOINTCOMPENSATION;
    flags |= cms_BLACKPOINTCOMPENSATION_CLAMPING;
}
```

---

## 7. Validation Criteria

After migration, the following must produce identical output to the current JS-side adaptive clamping:

| Test Case | Input | Expected |
|---|---|---|
| sRGB image → CMYK with BPC | Deep shadow pixels (R<10, G<10, B<10) | CMYK values clamped — no negative or >100% ink values |
| Gray image → CMYK with BPC | Near-black values (G<5) | K channel clamped to profile-appropriate minimum |
| Lab image → CMYK with BPC | L*<5 values | No inversion or overshoot in CMY channels |
| Indexed image (palette) → CMYK with BPC | Palette with near-black entries | Palette CMYK entries clamped correctly |
| Content stream `rg` op → `k` with BPC | `0.01 0.01 0.01 rg` | Converted CMYK values clamped |
| sRGB → CMYK with BPC disabled | Same inputs | No clamping applied — raw BPC output preserved |

---

## 8. Open Questions

1. **Is adaptive threshold computation (R2) actually necessary?** The fixed thresholds in `cmsFLAGS_BPC_CLAMP_OPTIMIZE` may already be sufficient for all real-world ICC profiles used in PDF workflows. If so, R2 can be downgraded to "Nice-to-have" and the implementation is simpler.

2. **Should `cms_BLACKPOINTCOMPENSATION_CLAMPING` be implied by `cmsFLAGS_BLACKPOINTCOMPENSATION`?** If clamping is always desirable when BPC is active (and the current default configuration confirms this), the flag could be automatically set when BPC is enabled, eliminating the need for a separate flag entirely.

3. **Worker path:** `WorkerColorConversion.js` and `StreamTransformWorker.js` currently receive the `useAdaptiveBPCClamping` config and run the JS-side clamping in the worker thread. After migration, workers would simply pass the flag to the engine — confirm no worker-specific edge cases exist.
