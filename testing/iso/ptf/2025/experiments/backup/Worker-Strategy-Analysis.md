# Worker Strategy Analysis

**Date:** 2025-12-19

---

## Current State (NOT Using Workers)

The benchmark labeled "Parallel" was **misleading**. The current implementation:

1. **Main thread does everything:**
   - Decompresses content streams (inflate)
   - Parses color operators
   - Transforms colors via ColorEngine
   - Recompresses content streams (deflate)
   - Extracts image pixels
   - Transforms image pixels
   - Replaces image data

2. **ParallelColorService created but NOT integrated:**
   - `parallelProcess()` exists but PDFService doesn't use it
   - `WorkerPool.js` created but never instantiated
   - `ColorTransformWorker.js` exists but never loaded

**Result:** Benchmark showed 0.98-1.04x "speedup" because it was sequential.

---

## User's Ideal Strategy

Main thread handles orchestration only. Workers handle compute-heavy operations:

```
Main Thread                    Workers
───────────                    ───────
1. Load PDF
2. Identify pages/streams
3. Send compressed streams ──► Worker 1: inflate → transform → deflate
                              Worker 2: inflate → transform → deflate
                              ...
4. Receive results ◄──────────
5. Update PDF objects
6. Save PDF
```

**Key principles:**

- Don't unpack arrays just to pass them - workers handle packed data
- Workers do: inflate, color transform, deflate
- Main thread does: PDF structure manipulation, object updates

---

## Strategy Comparison

### Strategy A: Current (Sequential Main Thread)

```
Main: inflate → parse → transform → recompress → next stream
```

- **Pros:** Simple, no message passing overhead
- **Cons:** Single-threaded, can't use multiple cores

### Strategy B: Page-Level Workers (Not Yet Implemented)

```
Main: load PDF, distribute pages
Workers: each processes complete page (inflate + transform + deflate)
Main: collect results, save PDF
```

- **Pros:** Minimal coordination, good parallelism
- **Cons:** Workers need full ColorEngine, memory per worker

### Strategy C: Stream-Level Workers (Ideal)

```
Main: identify streams/images, send compressed data
Workers: inflate → transform → deflate, return compressed
Main: update PDF objects with new compressed data
```

- **Pros:** Best granularity, workers handle I/O-heavy operations
- **Cons:** More messages, need to batch efficiently

### Strategy D: Transform-Only Workers

```
Main: inflate, parse, extract colors/pixels
Workers: color transformation only
Main: recompress, update PDF
```

- **Pros:** Workers are stateless (just transforms)
- **Cons:** Main thread still does I/O (inflate/deflate)

---

## Benchmarking Plan

### Modes to Compare

1. **baseline** - Current sequential (no workers)
2. **workers-page** - Strategy B (page-level)
3. **workers-stream** - Strategy C (stream-level with inflate/deflate)
4. **workers-transform** - Strategy D (transform only)

### Configuration

- Default worker count for comparison: **2 workers**
- Run baseline and worker tests in **separate child processes**
- Measure: duration, memory, output correctness

---

## Implementation Priority

1. **Strategy C (workers-stream)** - Most aligned with user's vision
2. Benchmark against baseline
3. Compare with Strategy B if needed
