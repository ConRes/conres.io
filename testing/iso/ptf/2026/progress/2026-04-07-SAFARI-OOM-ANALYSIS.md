# Safari OOM Analysis — Supplementary Data (2026-04-07)

This document contains cross-browser memory profiling data and reference links collected during the 2026-04-07 debugging session. It supplements the main progress documents listed below and is not a standalone tracker.

---

## Related Documents

| Document | Coverage |
| --- | --- |
| [2026-03-29-SAFARI-OOM-FIX-PROGRESS.md](2026-03-29-SAFARI-OOM-FIX-PROGRESS.md) | Main OOM investigation: root cause analysis, architecture changes, mitigation results, roadmap |
| [2026-04-06-CONTENT-STREAM-MARKUP-REFACTOR-PROGRESS.md](2026-04-06-CONTENT-STREAM-MARKUP-REFACTOR-PROGRESS.md) | Content stream parser/streaming pipeline, operator ordering bug fix, batching changes |
| [2026-04-05-DEVICE-COLOR-HANDLING-PROGRESS.md](2026-04-05-DEVICE-COLOR-HANDLING-PROGRESS.md) | Device color space handling, default source profiles, granular inclusion/exclusion |

---

## Cross-Browser Memory Profiling Data

Memory sampled at 250ms intervals via `top -stats mem,compress`, matching Activity Monitor.

### WebKit

| Mode                             | Peak Footprint | Renderer Peak | Compressed      | OOM? | Parser |
| -------------------------------- | -------------- | ------------- | --------------- | ---- | ------ |
| Content streams only (streaming) | 17,609 MB      | 16,384 MB     | 14,336 MB (87%) | Yes  | New    |
| Content streams only (legacy)    | 21,711 MB      | ~20,480 MB    | ~15,360 MB      | Yes  | Legacy |
| Images only                      | 20,755 MB      | ~19,456 MB    | —               | Yes  | N/A    |
| Full (both)                      | 18,655 MB      | ~17,408 MB    | ~15,360 MB      | Yes  | New    |

### Chromium (same workload)

| Mode                             | Peak Footprint | Renderer Peak | Compressed  | OOM? | GC Behavior                          |
| -------------------------------- | -------------- | ------------- | ----------- | ---- | ------------------------------------ |
| Content streams only (streaming) | 4,705 MB       | 4,602 MB      | 11 MB (<1%) | No   | Sawtooth — V8 reclaims between pages |
| Full (baseline)                  | ~2,200 MB      | —             | —           | No   | Completes in ~220s                   |

### Cross-Browser Comparison

| Metric                             | Chromium        | WebKit          | Ratio     |
| ---------------------------------- | --------------- | --------------- | --------- |
| Peak memory (content-streams-only) | 4,705 MB        | 17,609 MB       | **3.7x**  |
| Compressed memory                  | 11 MB           | 14,336 MB       | **1303x** |
| GC reclamation                     | Active sawtooth | Monotonic climb | —         |
| Completion                         | Yes             | OOM at ~21 GB   | —         |

The compressed memory ratio is the critical signal: V8 frees the TypedArray buffers, so macOS has nothing to compress. JSC keeps them alive (lazy GC), so macOS compresses them to avoid OOM — but eventually compression cannot keep up.

### Memory Growth Pattern (WebKit)

```
Baseline:  255 MB (3 procs)
Download:  6,138 MB (asset PDF in Networking process: 1,445 MB)
Converting: 10,000 → 15,000 → 18,000 → 21,000 MB (linear climb)
OOM kill:  ~21,700 MB (WebContent process killed, drops to ~200 MB)
```

### Key Observations

- **Parser choice irrelevant**: Legacy regex and streaming tokenizer produce identical memory growth
- **Both images and content streams independently cause OOM**: Each mode alone reaches 17-21 GB
- **Common factor**: 3 concurrent `PDFDocumentColorConverter` subsets, each with its own `ColorEngineProvider` WASM instance
- **WASM memory never shrinks**: Each instance grows to ~877 MB on first large transform (WebAssembly.Memory grows but cannot return pages to the OS)
- **WebKit compresses aggressively**: 80-90% of footprint is compressed memory, indicating macOS is fighting to keep the process alive
- **Worker sub-processes appear in images-only mode**: 5 system `com.apple.WebKit.WebContent` XPC services spawned for parallel image workers

---

## Mitigation Attempts and Results

| Approach | Peak Memory | Effect |
| --- | --- | --- |
| Original (500ms delay, 3 WASM instances) | 17-21 GB | OOM — monotonic climb |
| 30s delay between pages | ~5 GB sawtooth | TypedArrays collected, WASM stays |
| GC scare trick (256 MB allocate + null) | ~16 GB | Helps early, overwhelmed later |
| rAF + 500ms (main thread only) | N/A | rAF unavailable in workers |
| Eager converter disposal after each subset | ~16 GB | dispose() does not free WASM |
| Shared ColorEngineProvider (1 WASM instance) | ~15 GB | Lower initial peak, same climb |
| Worker pool termination between chains | No effect on subsets | Pool workers are not main-thread converters |

---

## Outstanding Test Matrix

| Browser  | Mode                          | Workers        | Status                                                                 |
| -------- | ----------------------------- | -------------- | ---------------------------------------------------------------------- |
| Chromium | Content streams only          | No             | Partial — peak 4.7 GB (docket only, worker init timeout on main chain) |
| Chromium | Images only                   | No             | Pending                                                                |
| Chromium | Full                          | No             | Done (baseline) — ~2.2 GB, completes                                   |
| WebKit   | Content streams only (new)    | No             | Done — peak 17.6 GB, OOM                                               |
| WebKit   | Content streams only (legacy) | No             | Done — peak 21.7 GB, OOM                                               |
| WebKit   | Images only                   | No             | Done — peak 20.8 GB, OOM                                               |
| WebKit   | Full                          | No             | Done — peak 18.7 GB, OOM                                               |
| WebKit   | Content streams only          | Yes (parallel) | Pending                                                                |
| WebKit   | Images only                   | Yes (parallel) | Pending                                                                |
| WebKit   | Full                          | Yes (parallel) | Pending                                                                |
| Chromium | Content streams only          | Yes (parallel) | Pending                                                                |
| Chromium | Images only                   | Yes (parallel) | Pending                                                                |
| Chromium | Full                          | Yes (parallel) | Pending                                                                |

All runs use the bootstrap worker (debugging mode). "No workers" means `useWorkers=false` was passed to `TestFormPDFDocumentGenerator`, but the bootstrap worker itself was still active. The 3 concurrent subsets in `AssetPagePreConverter` are separate from the parallel workers — they run as concurrent `PDFDocumentColorConverter` instances within the same bootstrap worker.

---

## postMessage Transfer Audit

All active code paths correctly use transfer lists:

| Path                                       | Direction                                     | Transferables               | Status                       |
| ------------------------------------------ | --------------------------------------------- | --------------------------- | ---------------------------- |
| Main -> Bootstrap Worker                   | `iccProfileBuffer`                            | `[iccProfileCopy]`          | OK                           |
| Bootstrap -> Main                          | `docketPDFBuffer`                             | `[docketPDFBuffer]`         | OK                           |
| Bootstrap -> Main                          | chain `pdfBuffer`                             | `[pdfBuffer]`               | OK                           |
| Bootstrap -> Main                          | final result                                  | `[result.pdfBuffer]`        | OK                           |
| WorkerPool -> Worker (new)                 | `compressedData`, `pixelBuffer`, `inputArray` | `#collectTransferables()`   | OK                           |
| Worker -> WorkerPool (new)                 | `outputArray`, `pixelBuffer`                  | `sendResult()`              | OK                           |
| `StreamTransformWorker` -> Pool            | `compressedResult`                            | `[result.compressedResult]` | OK                           |
| Worker -> Pool (old `ColorTransformWorker`) | result                                        | **Missing**                 | NOT USED in current pipeline |

The old `ColorTransformWorker.js` (in `services/`) is missing transfer lists on return, but the current pipeline uses `worker-pool-entrypoint.js` (in `classes/baseline/`) which handles transfers correctly.

---

## References

### Google AI Mode Research (provided by user)

1. **PDF Color Spaces** — Device, CIE-Based, and Special color space categories, content stream operators, activation patterns
   - Source: https://share.google/aimode/4ZYeAWEVbLSAokCgU

2. **`setTimeout` and Safari GC Behavior** — JSC conservative stack scanning, idle-time GC scheduling, `setTimeout` clears execution stack making unreachable objects collectible, closure leak risks
   - Source: https://share.google/aimode/KmLWR2fuI0tOL4qYn
   - Key finding: "Breaking the Stack: Safari's GC is conservative; it treats anything on the machine stack as a root. Using `setTimeout(() => { ... }, 0)` pushes remaining tasks to the next event loop cycle."
   - References: [WebKit Bug 119049](https://bugs.webkit.org/show_bug.cgi?id=119049), [WebKit Blog: Speedometer 3.0](https://webkit.org/blog/15249/optimizing-webkit-safari-for-speedometer-3-0/), [Apple JSGarbageCollect](https://developer.apple.com/documentation/javascriptcore/jsgarbagecollect%28_:%29)

3. **Safari Float32Array OOM** — Lazy TypedArray collection, Jetsam per-process limits, worker-to-main-thread message duplication, fragmented allocation overhead, buffer pooling and chunked processing recommendations
   - Source: https://share.google/aimode/QRylTT5e4swKKdKFB
   - Key finding: "WebKit has a historical behavior where ArrayBuffers and TypedArrays are not immediately garbage collected even after they become unreachable."
   - References: [WebKit Bug 119049](https://bugs.webkit.org/show_bug.cgi?id=119049), [catchmetrics deep dive](https://www.catchmetrics.io/blog/deep-dive-ram-internals-webkit), [emscripten-core #19374](https://github.com/emscripten-core/emscripten/issues/19374)

4. **`WebAssembly.Memory` Cannot Be Freed Without `worker.terminate()`** — WASM linear memory only grows, backing ArrayBuffer remains at peak, `dispose()` only makes objects eligible for GC but JSC may not collect, `worker.terminate()` is the only reliable mechanism
   - Source: https://share.google/aimode/VcXkHbkR6G25MosLV
   - Key finding: "`worker.terminate()` is the only reliable way to force immediate WASM memory reclamation — it destroys the entire isolate including WASM linear memory."

5. **Activity Monitor Columns via Shell** — `top -l 1 -stats pid,command,mem,rsize,vprvt,mshrd,purg,compress` maps to all Activity Monitor memory columns; `vmmap --summary [PID]` for programmatic footprint
   - Source: https://share.google/aimode/vVcv9EgMx9bMGen9d
   - Key finding: `mem` = total physical footprint (what Activity Monitor shows), `rsize` = RSS, `compress` = VM compressed. Used in our 250ms polling infrastructure.
   - References: [Apple Stack Exchange](https://apple.stackexchange.com/questions/323124/how-can-i-display-activity-monitors-memory-columns-through-terminal), [Apple Activity Monitor docs](https://support.apple.com/en-ca/guide/activity-monitor/actmntr1004/mac)

6. **Safari Nested Worker Support** — Confirmed supported since Safari 15.5, ES modules in nested workers since Safari 16.4, WebGL in nested workers fixed in Safari 26
   - Source: https://share.google/aimode/J4KUthG9wr6F7WYQ0
   - Key finding: "Support for spawning a worker from within another worker was introduced in Safari 15.5." Shared Workers cannot spawn nested workers — only dedicated workers.
   - References: [Can I Use: Worker modules](https://caniuse.com/?search=worker%20module), [WebKit Bug 25212](https://bugs.webkit.org/show_bug.cgi?id=25212), [WebKit Blog: Safari 26.0](https://webkit.org/blog/17333/webkit-features-in-safari-26-0/)
   - **Impact**: Invalidates the planning agent's claim that nested workers are blocked in Safari. Our existing `WorkerPool` spawned from the bootstrap worker already works correctly.

### Other References

- [Google AI: Authorship and AI Attribution](https://share.google/aimode/RDMBetFQfDOdG5yfO) — AI agents are tools, not authors (referenced in `~/.claude/CLAUDE.md`)
- [Adobe PDF Reference 1.7](testing/iso/ptf/2026/documentation/references/Adobe-PDF-Reference-1.7.pdf) — PDF specification for content stream operators, color spaces
