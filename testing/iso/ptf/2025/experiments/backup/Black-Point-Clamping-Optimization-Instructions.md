# Black Point Clamping Optimization for ColorEngine

**Date:** 2025-12-19  
**Context:** Performance optimization for color transformation arrays with Black Point Compensation

---

## Summary

Implement an opt-in `useBlackPointClampingOptimizations` flag in the ColorEngine's array transformation pipeline. When Black Point Compensation (BPC) is enabled, pixels that are guaranteed to transform to pure black or pure white can skip the full transformation pipeline.

---

## Background

When Black Point Compensation is enabled:

- Pure black input (RGB 0,0,0 or Gray 0) always maps to the destination black point
- Pure white input (RGB 255,255,255 or Gray 255) always maps to the destination white point

For 8-bit images, these are common values:

- Black pixels in masks, text, and line art
- White pixels in backgrounds and masks
- These values often constitute 10-50% of pixels in typical documents

---

## Technical Requirements

### 1. Detection Logic

In `api-wrapper.js` or `doTransform`, add optional pre-pass:

```javascript
// Before transformation, count black/white pixels
function countBoundaryPixels(inputArray, componentsPerPixel, isBlack, isWhite) {
    let blackCount = 0;
    let whiteCount = 0;
    const pixelCount = inputArray.length / componentsPerPixel;

    for (let i = 0; i < pixelCount; i++) {
        const offset = i * componentsPerPixel;
        if (isBlack(inputArray, offset, componentsPerPixel)) blackCount++;
        else if (isWhite(inputArray, offset, componentsPerPixel)) whiteCount++;
    }
    return { blackCount, whiteCount, pixelCount };
}

// For RGB 8-bit
function isBlackRGB8(arr, offset) {
    return arr[offset] === 0 && arr[offset + 1] === 0 && arr[offset + 2] === 0;
}
function isWhiteRGB8(arr, offset) {
    return arr[offset] === 255 && arr[offset + 1] === 255 && arr[offset + 2] === 255;
}

// For Gray 8-bit
function isBlackGray8(arr, offset) { return arr[offset] === 0; }
function isWhiteGray8(arr, offset) { return arr[offset] === 255; }
```

### 2. Optimization Strategy

**Option A: Full Pre-pass (Simple)**

1. Scan input array for black/white pixels, record indices
2. Transform only non-boundary pixels
3. Write pre-computed boundary values directly to output

**Option B: Inline Clamping (Better for WASM)**

1. Modify the C code to check each pixel before LUT lookup
2. If pixel matches boundary condition, write clamped value directly
3. Skip PCS transformation entirely

### 3. Implementation Location

Add to `k-only-gcr.c` (or new file `bpc-optimizations.c`):

```c
// Pre-computed output values for boundary pixels
static cmsCIEXYZ g_blackPointXYZ;
static cmsCIEXYZ g_whitePointXYZ;
static cmsUInt8Number g_blackOutputCMYK[4];
static cmsUInt8Number g_whiteOutputCMYK[4];

// Initialize boundary values from profiles
void InitBPCOptimizations(cmsHPROFILE destProfile, cmsUInt32Number intent) {
    cmsDetectDestinationBlackPoint(&g_blackPointXYZ, destProfile, intent, 0);
    // Convert to output format...
}

// Optimized transform with BPC clamping
void DoTransformWithBPCClamping(
    cmsHTRANSFORM transform,
    const void* inputBuffer,
    void* outputBuffer,
    cmsUInt32Number pixelCount,
    cmsUInt32Number inputFormat,
    cmsUInt32Number outputFormat
) {
    // Implementation with boundary checking
}
```

### 4. API Extension

Add new flag to existing constants:

```javascript
// In index.js
export const cmsFLAGS_BPC_CLAMP_OPTIMIZE = 0x80000000;  // New flag

// Usage
const flags = cmsFLAGS_BLACKPOINTCOMPENSATION | cmsFLAGS_BPC_CLAMP_OPTIMIZE;
```

### 5. Integration Points

The optimization should be:

- **Opt-in only** - Default behavior unchanged
- **Format-aware** - Work with 8-bit and 16-bit formats
- **Measurable** - Return statistics about clamped vs transformed pixels
- **Profile-cached** - Pre-compute boundary output values per profile pair

---

## Expected Performance Gains

For images with high boundary pixel density:

| Image Type    | Boundary % | Expected Speedup |
| ------------- | ---------- | ---------------- |
| Binary masks  | 50-95%     | 40-80%           |
| Text/line art | 30-60%     | 25-50%           |
| Screenshots   | 10-30%     | 8-25%            |
| Photographs   | 1-5%       | 1-4%             |

---

## Validation

After implementation, validate that:

1. Boundary pixels produce identical output to non-optimized path
2. Non-boundary pixels are unchanged
3. Performance improves for high-boundary images
4. No regressions for typical photographic content

---

## Single-Line Prompt for ColorEngine Workspace

```
Implement opt-in Black Point Clamping optimization: when cmsFLAGS_BPC_CLAMP_OPTIMIZE flag is set and BPC is enabled, skip full pipeline for pixels that are pure black (all channels 0) or pure white (all channels max), writing pre-computed boundary values directly to output instead.
```

---

## Files to Modify

1. `k-only-gcr.c` or new `bpc-optimizations.c` - C implementation
2. `api-wrapper.js` - JavaScript wrapper if JS-side optimization
3. `index.js` - Export new flag constant
4. Add tests in `tests/` directory

---

## Notes

- This optimization is most effective for the PDF use case where masks and diagrams are common
- The optimization is independent of K-Only GCR but can be combined
- Consider a JavaScript-only implementation first for rapid iteration, then move to WASM if beneficial
