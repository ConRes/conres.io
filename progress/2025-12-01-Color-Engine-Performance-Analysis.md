# ColorEngine (CE) Performance Analysis

**Date:** 2025-12-19  
**Context:** Performance optimizations for WebAssembly color transformation engine  

---

## Summary

The ColorEngine (CE) WebAssembly module provides high-performance color transformations for PDF processing. This document details the optimizations implemented and their measured impact.

---

## Implemented Optimizations

### 1. WebAssembly SIMD Support (2025-12-19)

**Status:** ✅ Complete

**Changes:**

- Added `-msimd128` flag to Emscripten compilation in `scripts/build-wasm.sh`
- SIMD is enabled by default, can be disabled with `DISABLE_SIMD=1`
- Compiler auto-vectorizes eligible loops with `-O3 -msimd128`

**Files Modified:**

- [scripts/build-wasm.sh](scripts/build-wasm.sh) - Added SIMD_FLAGS variable

**Build Configuration:**

```bash
# SIMD enabled (default)
yarn build:wasm

# SIMD disabled (for compatibility testing)
DISABLE_SIMD=1 yarn build:wasm
```

**Results:**

| Metric                    | Value                   |
| ------------------------- | ----------------------- |
| SIMD instructions in WASM | 3,454 prefixes detected |
| WASM file size            | 271.5 KB                |
| Peak throughput           | 41-54 M pixels/sec      |

**Benchmark (100K pixels, RGB8 → CMYK8):**

| Transform Type | Throughput (M px/s) | Per-pixel (ns) |
| -------------- | ------------------- | -------------- |
| Relative + BPC | 41.4                | 24.1           |
| K-Only GCR     | 43.1                | 23.2           |

---

### 2. Black Point Clamping Optimization (2025-12-19)

**Status:** ✅ Complete (WASM SIMD Implementation)

**Purpose:** Skip full transform pipeline for boundary pixels (pure black/white) when Black Point Compensation is enabled.

**Files Modified:**

- [packages/color-engine/src/bpc-clamp.h](packages/color-engine/src/bpc-clamp.h) - C header with cache structures
- [packages/color-engine/src/bpc-clamp.c](packages/color-engine/src/bpc-clamp.c) - SIMD-optimized C implementation
- [packages/color-engine/src/api-wrapper.js](packages/color-engine/src/api-wrapper.js) - WASM bindings
- [packages/color-engine/src/index.js](packages/color-engine/src/index.js) - API exports
- [scripts/build-wasm.sh](scripts/build-wasm.sh) - Build script updated for new C file

**New API:**

```javascript
// Initialize clamping (call once per transform)
engine.initBPCClamping(transform, inputChannels, outputChannels, inputIsFloat, outputIsFloat);

// Transform with boundary pixel optimization
const stats = engine.doTransformWithBPCClamp(transform, input, output, pixelCount);
// stats = { transformedCount, blackCount, whiteCount, optimizationSkipped }

// Cleanup
engine.clearBPCClamping(transform);
engine.clearAllBPCClamping();  // Clear all caches
```

**New Flag:**

```javascript
export const cmsFLAGS_BPC_CLAMP_OPTIMIZE = 0x80000000;
```

**WASM SIMD Implementation:**

The C implementation uses WebAssembly SIMD for vectorized boundary detection:

- Batch detection of 4 pixels at once using 128-bit SIMD vectors
- Separate optimized paths for RGB (3-channel) and CMYK/RGBA (4-channel) inputs
- Pre-computed boundary values cached in C-side hash table (max 32 transforms)
- Stats structure returned via shared memory for zero-copy access

**Algorithm:**

1. Pre-compute output values for pure black and pure white pixels (C-side)
2. On transform: SIMD-detect boundary pixels in batched passes (4 pixels/iteration)
3. Write cached values for boundary pixels immediately
4. Track non-boundary pixel indices
5. Transform non-boundary pixels (either individual or batch based on ratio)

**Benchmark Results (WASM SIMD, 100K-1M pixels):**

| Boundary % | Regular (ms) | BPC Clamp (ms) | Speedup |
| ---------- | ------------ | -------------- | ------- |
| 0%         | 25.26        | 25.15          | 1.00x   |
| 5%         | 25.30        | 27.26          | 0.93x   |
| 25%        | 23.15        | 33.85          | 0.68x   |
| 50%        | 20.88        | 29.67          | 0.70x   |
| 80%        | 17.84        | 18.86          | 0.95x   |
| 100%       | 16.36        | 11.78          | 1.39x   |

**Analysis:**

Even with WASM SIMD, the BPC clamping optimization only provides speedup at 100% boundary pixels (pure masks). The overhead comes from:

1. **Memory copying**: Input/output must be copied to/from WASM heap
2. **Conditional logic**: Per-pixel branching negates SIMD benefits at partial boundary ratios
3. **Transform speed**: Regular WASM transform is already ~47M px/s, leaving little room for optimization

**When to Use:**

| Scenario             | Use BPC Clamping? | Reason                      |
| -------------------- | ----------------- | --------------------------- |
| Photos (0% boundary) | ❌ No             | No speedup, slight overhead |
| Screenshots (5-25%)  | ❌ No             | Slower than regular         |
| Documents (50% text) | ❌ No             | Still slower                |
| Binary masks (100%)  | ✅ Yes            | 1.39x speedup               |

**Recommended Use Cases:**

- **Binary masks only** (100% black/white pixels)
- Pre-quantized bitmaps
- Separation masks for spot colors

---

## Validation Scripts

| Script                                               | Purpose                                  |
| ---------------------------------------------------- | ---------------------------------------- |
| `experiments/scripts/build-wasm.js`                  | Rebuild WASM module via yarn             |
| `experiments/scripts/test-optimizations.js`          | Validate SIMD and BPC (18 tests)         |
| `experiments/scripts/verify-simd-build.js`           | Verify SIMD in WASM binary               |
| `experiments/scripts/benchmark-bpc-clamping.js`      | Benchmark JS BPC clamping by boundary %  |
| `experiments/scripts/benchmark-wasm-bpc-clamping.js` | Benchmark WASM SIMD BPC clamping         |
| `benchmarks/simd-comparison-benchmark.js`            | Full SIMD/transform benchmark            |
| `benchmarks/quick-benchmark.js`                      | Quick WASM vs js-color-engine comparison |

**Run All Validation:**

```bash
# Build
node experiments/scripts/build-wasm.js

# Test
node experiments/scripts/test-optimizations.js

# Benchmark
node benchmarks/simd-comparison-benchmark.js
```

---

## Performance Characteristics

### Transform Throughput by Intent

| Intent                      | Throughput (M px/s) | Notes               |
| --------------------------- | ------------------- | ------------------- |
| Relative Colorimetric + BPC | 32-41               | Standard transform  |
| K-Only GCR                  | 43-54               | CLUT-based, faster  |
| Perceptual                  | 40-45               | Similar to relative |

### Scaling Behavior

| Pixel Count | Time (ms) | Throughput (M px/s) |
| ----------- | --------- | ------------------- |
| 1,000       | 0.14      | 7.3                 |
| 10,000      | 0.31      | 32.5                |
| 100,000     | 2.41      | 41.4                |
| 1,000,000   | 24.1      | 41.5                |

Throughput stabilizes at ~41 M px/s for large arrays. Small arrays have per-call overhead.

---

## Integration with TFG

The ColorEngine is used by the TestFormGenerator (TFG) workspace for PDF color conversion. Key integration points:

### ColorEngineService Usage

```javascript
// In TFG's ColorEngineService
const engine = await createEngine();

// Standard transform
const transform = engine.createTransform(
  srcProfile, TYPE_RGB_8,
  dstProfile, TYPE_CMYK_8,
  INTENT_PRESERVE_K_ONLY_RELATIVE_COLORIMETRIC_GCR,
  cmsFLAGS_BLACKPOINTCOMPENSATION
);

// For high-boundary content (masks, line art)
engine.initBPCClamping(transform, 3, 4, false, false);
const stats = engine.doTransformWithBPCClamp(transform, pixels, output, pixelCount);
```

### When to Use BPC Clamping

| Image Type               | Use BPC Clamping? | Reason                       |
| ------------------------ | ----------------- | ---------------------------- |
| Photographs              | ❌ No             | Low boundary %, SIMD is fast |
| Screenshots              | ❓ Maybe          | Test with actual content     |
| Binary masks             | ✅ Yes            | 80-100% boundary pixels      |
| Line art                 | ✅ Yes            | High boundary pixel density  |
| Text on white background | ✅ Yes            | White background = boundary  |

---

## Future Optimizations

### Potential Improvements

1. **Explicit SIMD intrinsics in C** - Manual vectorization for critical loops
2. **Batched cmsDoTransform** - Reduce per-call overhead for small arrays
3. **Memory pooling** - Reuse iteration buffers in K-Only GCR algorithm
4. **Direct WASM memory access** - Avoid JS→WASM heap copies for transform data

### Not Recommended

1. **BPC clamping for mixed content** - Only beneficial at 100% boundary pixels
2. **JavaScript-side BPC clamping** - WASM version is marginally faster but both are limited
3. **Indexed image deduplication** - High color diversity negates benefit (see TFG analysis)

---

## Build System

### WASM Compilation Flags

```bash
emcc -O3 -msimd128 \
  -s WASM=1 \
  -s ALLOW_MEMORY_GROWTH=1 \
  -s INITIAL_MEMORY=33554432 \
  -s MAXIMUM_MEMORY=2147483648 \
  -s MODULARIZE=1 \
  -s EXPORT_ES6=1 \
  -s ENVIRONMENT='web,node'
```

### Key Flags

| Flag                  | Value     | Purpose                       |
| --------------------- | --------- | ----------------------------- |
| `-O3`                 | (enabled) | Maximum optimization          |
| `-msimd128`           | (enabled) | WebAssembly SIMD instructions |
| `ALLOW_MEMORY_GROWTH` | 1         | Dynamic heap expansion        |
| `INITIAL_MEMORY`      | 32 MB     | Starting heap size            |
| `MAXIMUM_MEMORY`      | 2 GB      | Maximum heap size             |

---

## Test Results

### Optimization Test Suite (18/18 passing)

```
1. Module Loading Tests
   ✅ Initialize ColorEngine
   ✅ Open CMYK profile
   ✅ Create sRGB profile
   ✅ Create transform with BPC

2. BPC Clamping Optimization Tests
   ✅ Initialize BPC clamping
   ✅ Black input produces consistent output
   ✅ White input produces consistent output
   ✅ doTransformWithBPCClamp handles pure black correctly
   ✅ doTransformWithBPCClamp handles pure white correctly
   ✅ doTransformWithBPCClamp handles mixed content correctly
   ✅ doTransformWithBPCClamp produces same output as regular transform
   ✅ Clear BPC clamping cache

3. K-Only GCR Intent Tests
   ✅ Create K-Only GCR transform
   ✅ K-Only GCR produces K-only output for grays
   ✅ K-Only GCR with BPC clamping initialization

4. Cleanup
   ✅ Clear BPC clamping for K-Only transform
   ✅ Delete transforms
   ✅ Close profiles
```

---

## References

- [Black-Point-Clamping-Optimization-Instructions.md](Black-Point-Clamping-Optimization-Instructions.md) - Original spec from TFG
- [Black-Point-Clamping-Optimization-Report.md](2025-12-01-Blackpoint-Clamping-Report.md) - Results for TFG
- [CLAUDE.md](CLAUDE.md) - AI assistant instructions with script documentation
