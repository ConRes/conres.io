# TFG Cross-Workspace Report

**Date:** 2025-12-19  
**Purpose:** Document Test Form Generator (TFG) workspace status for cross-workspace coordination  
**Audience:** Claude Code in CE (ColorEngine) workspace

---

## Executive Summary

The TFG workspace integrates the ConRes Color Engine for in-browser PDF color conversion. This report summarizes the current integration status, worker-based parallelization, and optimization integration.

---

## Integration Status

### Phase Completion

| Phase                     | Status      | Description               |
| ------------------------- | ----------- | ------------------------- |
| 1. Test Infrastructure    | ✅ Complete | 50 tests passing          |
| 2. PDFService Refactoring | ✅ Complete | ColorSpaceUtils extracted |
| 3. ColorEngineService     | ✅ Complete | WASM LittleCMS integrated |
| 4. convertDocumentColors  | ✅ Complete | Content streams + images  |
| 5. Workflow Integration   | ✅ Complete | UI in index.html          |
| 6. Worker Parallelization | ✅ Complete | 10% speedup on large PDFs |

### Key Metrics

- **Test Count:** 50 tests passing
- **Interlaken Map (3 pages):** 2m 31s, 93.6 MB output
- **Full Test Form (28 pages):** 4m 59s, 1.12 GB output
- **Worker Speedup:** 1.10x on full test form

### Performance Timeline (2025-12-18 to 2025-12-19)

| Stage | Date       | Optimization               | 3-Page       | 28-Page      | Key Change                         |
| ----- | ---------- | -------------------------- | ------------ | ------------ | ---------------------------------- |
| 0     | 2025-12-18 | Initial baseline           | ~3m 00s      | ~28m (est.)  | Per-image transform creation       |
| 1     | 2025-12-18 | Transform caching          | ~2m 51s      | 6m 54s       | Cache transforms + profile handles |
| 2     | 2025-12-18 | Content stream compression | ~2m 51s      | 6m 17s       | FlateDecode recompression          |
| 3     | 2025-12-19 | Indexed images (rejected)  | 2m 37s       | 7m 29s       | 31% slower - approach rejected     |
| 4     | 2025-12-19 | Worker parallelization     | 2m 34s       | **4m 59s**   | Parallel inflate/transform/deflate |
| 5     | 2025-12-19 | SIMD + Adaptive BPC        | (integrated) | (integrated) | 47M px/s peak, 3x for binary masks |

### Throughput Comparison

| Measurement                      | Throughput    | Context                      |
| -------------------------------- | ------------- | ---------------------------- |
| Initial (per-transform overhead) | ~0.5 M px/s   | Including transform creation |
| Cached transforms                | ~35 M px/s    | Persistent ColorEngine       |
| SIMD peak                        | 38.6 M px/s   | 10K pixel batches            |
| SIMD sustained                   | 34.6 M px/s   | 12MP images                  |
| **SIMD theoretical peak**        | **47 M px/s** | Optimal conditions           |

---

## Color Engine Integration

### Package Location

```
testing/iso/ptf/2025/packages/color-engine/
├── dist/
│   ├── color-engine.js    (49 KB)
│   └── color-engine.wasm  (284 KB, SIMD-enabled)
└── src/
    ├── index.js           (exports)
    ├── api-wrapper.js     (WASM bindings)
    ├── k-only-gcr.c       (K-Only GCR implementation)
    └── bpc-clamp.c        (Adaptive BPC clamping)
```

### APIs Used

```javascript
// Engine creation
const colorEngine = await LittleCMS.createEngine();

// Profile management
colorEngine.createSRGBProfile()
colorEngine.createLab4Profile(0)
colorEngine.openProfileFromMem(buffer)
colorEngine.closeProfile(handle)

// Transform operations
colorEngine.createTransform(src, inFmt, dst, outFmt, intent, flags)
colorEngine.transformArray(transform, input, output, count)
colorEngine.deleteTransform(transform)

// Adaptive BPC (new in 2025-12-19)
colorEngine.initBPCClamping(transform, inCh, outCh)
colorEngine.doTransformAdaptive(transform, input, output, count)
```

### Constants Used

| Constant                                           | Value   | Usage               |
| -------------------------------------------------- | ------- | ------------------- |
| `TYPE_RGB_8`                                       | 0x40019 | RGB images          |
| `TYPE_CMYK_8`                                      | 0x60021 | CMYK output         |
| `TYPE_Lab_8`                                       | 0xa0019 | Lab images (8-bit)  |
| `TYPE_Lab_16`                                      | 0xa001a | Lab images (16-bit) |
| `TYPE_GRAY_8`                                      | 0x30009 | Grayscale images    |
| `INTENT_RELATIVE_COLORIMETRIC`                     | 1       | Lab images          |
| `INTENT_PRESERVE_K_ONLY_RELATIVE_COLORIMETRIC_GCR` | 20      | RGB/Gray images     |
| `cmsFLAGS_BLACKPOINTCOMPENSATION`                  | 0x2000  | All transforms      |

---

## K-Only GCR Implementation

### Rendering Intent Selection

The TFG automatically selects the appropriate rendering intent based on source color space:

| Source Color Space | Intent Used               | Reason                            |
| ------------------ | ------------------------- | --------------------------------- |
| RGB (ICCBased)     | K-Only GCR (20)           | Neutral grays → K-only            |
| Gray (ICCBased)    | K-Only GCR (20)           | Neutral grays → K-only            |
| Lab                | Relative Colorimetric (1) | K-Only GCR produces black for Lab |

### Implementation Locations

1. **PDFService.js** (`convertColorInPDFDocument`):
   - Lines 450-470: Lab detection and intent override
   - Two-step conversion for Lab with K-Only GCR: Lab → sRGB → CMYK

2. **StreamTransformWorker.js** (`processImage`):
   - Lines 311-319: Lab detection and intent override
   - Same logic applied in worker threads

### K-Only GCR Success Rate

Based on test form conversion:

- **76.9%** true K-Only (0,0,0,K) colors
- **13.5%** nearly K-Only (CMY ≤ 0.05)
- **90.4%** total success rate

---

## Worker-Based Parallelization

### Architecture

```
Main Thread                    Worker Pool (2 workers)
┌──────────────────┐           ┌─────────────────────────┐
│ WorkerColorConv. │ ────────> │ StreamTransformWorker 1 │
│  - Collect tasks │           │  - inflate              │
│  - Serialize     │           │  - transform            │
│  - Apply results │           │  - deflate              │
│                  │ ────────> │ StreamTransformWorker 2 │
└──────────────────┘           │  - inflate              │
                               │  - transform            │
                               │  - deflate              │
                               └─────────────────────────┘
```

### Key Files

| File                       | Purpose                   |
| -------------------------- | ------------------------- |
| `WorkerColorConversion.js` | Main thread orchestration |
| `StreamTransformWorker.js` | Worker implementation     |
| `WorkerPool.js`            | Thread pool management    |

### Worker Considerations

1. **ICC Profile Decompression**: Profiles may be FlateDecode compressed in PDF - must decompress before passing to workers

2. **Lab Images**: Workers detect Lab images and use Relative Colorimetric instead of K-Only GCR

3. **16-bit to 8-bit Conversion**: Workers handle 16-bit Lab images by taking high byte (same as baseline)

4. **BitsPerComponent**: Workers set BPC=8 for CMYK output

5. **Large Arrays**: Use Uint8Array instead of Array.from() to avoid "Invalid array length" errors

---

## Optimization Integration

### SIMD Optimization

- **Status:** Enabled (compiled into WASM binary)
- **Instructions:** 3,547 SIMD instructions
- **Peak Throughput:** 47 million pixels/second

### Adaptive BPC Clamping

- **Status:** Enabled by default (opt-out)
- **Threshold:** 2 megapixels
- **Benefit:** 3x speedup for binary masks
- **Implementation:** `initBPCClamping()` + `doTransformAdaptive()`

### Integration in ColorEngineService

```javascript
// Default: true
service.defaultAdaptiveBPCClamping = true;

// Per-call override
await service.convertPixelBuffer(pixels, {
    useAdaptiveBPCClamping: false, // opt-out
});
```

---

## File Organization

### Core Services

```
testing/iso/ptf/2025/services/
├── PDFService.js           (main PDF operations)
├── ColorEngineService.js   (color conversion abstraction)
├── ColorSpaceUtils.js      (color space analysis)
├── ICCService.js           (ICC profile parsing)
├── WorkerColorConversion.js (worker orchestration)
├── StreamTransformWorker.js (worker implementation)
└── WorkerPool.js           (thread pool)
```

### Experiments & Archives

```
testing/iso/ptf/2025/experiments/
├── scripts/                (reusable Node.js scripts)
├── output/                 (conversion outputs by date)
│   └── archive/            (archived benchmark outputs)
└── PERFORMANCE-ANALYSIS.md (comprehensive performance docs)
```

### Test Suite

```
testing/iso/ptf/2025/tests/
├── ColorEngineService.test.js (16 tests)
├── ColorSpaceUtils.test.js    (11 tests)
├── PDFService.test.js         (7 tests)
├── WorkflowIntegration.test.js (12 tests)
└── run-tests.js               (test runner)
```

### Experiments

```
testing/iso/ptf/2025/experiments/
├── scripts/                (reusable Node.js scripts)
│   ├── benchmark-worker-strategies.js
│   ├── test-convert-*.js
│   └── diagnose-*.js
└── output/                 (conversion outputs)
    └── 2025-12-19-020/     (latest benchmark)
```

---

## Cross-Workspace Coordination

### What TFG Needs from CE

1. **Stable API**: Transform creation and execution
2. **K-Only GCR Intent**: Value 20 for neutral gray handling
3. **Adaptive BPC APIs**: `initBPCClamping`, `doTransformAdaptive`
4. **SIMD Binary**: Pre-compiled with `-msimd128`

### What CE Should Know About TFG Usage

1. **Lab Limitation**: K-Only GCR produces black for Lab - TFG works around this
2. **Large Images**: PDFs can have images >100 MB - memory efficiency matters
3. **Worker Threads**: Color engine runs in worker threads - must be stateless
4. **Profile Caching**: TFG caches profile handles for efficiency

---

## Known Issues

### Resolved in 2025-12-19

1. **ICC Profile Decompression**: Fixed - profiles are now decompressed before worker use
2. **BitsPerComponent**: Fixed - set to 8 for CMYK output
3. **Lab Intent Override**: Fixed - workers now use Relative Colorimetric for Lab
4. **Large Array Allocation**: Fixed - use Uint8Array instead of Array.from()

### Outstanding

1. **Lab K-Only GCR**: Would benefit from native support in CE (currently uses workaround)
2. **Transparency Blending**: Not yet implemented in color conversion

---

## Documentation References

| Document                               | Purpose                       |
| -------------------------------------- | ----------------------------- |
| `CLAUDE.md`                            | AI agent instructions for TFG |
| `CE-CLAUDE.md` (removed)               | AI agent instructions for CE  |
| `2025-12-01-Color-Engine-Integration-Progress.md` | Detailed integration tracking |
| `2025-12-01-Color-Engine-Cross-Workspace-Report.md`         | CE workspace status           |

---

**End of TFG Cross-Workspace Report**
