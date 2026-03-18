# 2026-02-15 Memory Management Progress

## Overview

Memory profiling and optimization for the ConRes PDF Test Form Generator. Tests use Playwright with Chrome DevTools Protocol (CDP) to measure JS heap during generation. The primary issue is that headless Chrome's renderer process crashes (OOM) when processing the Maps asset (346 MB, 7 pages including 16-bit images).

**Test file:** `tests/generator/memory-management.test.js`
**Progress file:** `generator/2026-02-15-MEMORY-MANAGEMENT-PROGRESS.md`

---

## Roadmap

- [x] **Task 1**: Wire up `workers-checkbox` in generator UI `DONE`
- [ ] **Task 2**: Memory management tests and optimization `IN-PROGRESS`
  - [x] Create test file with CDP-based heap profiling
  - [x] `__measureHeapFromCDP` bridge for mid-generation snapshots
  - [x] Skip-by-default via `TESTS_MEMORY=true`
  - [x] Chrome launch: `--max-old-space-size=8192`, `--disable-dev-shm-usage`
  - [x] Crash detection via `page.on('crash')`
  - [x] Fix worker pako resolution (see baseline cleanup)
  - [x] Fix `import.meta.resolve` conditional logic for explicit consumer URLs
  - [x] Fix shared profile stripping safety (conditional `===` check)
  - [x] Audit ArrayBuffer neutering (SAFE — `.buffer.slice()` copies)
  - [x] Fix worker count reporting mismatch (`cpus().length / 2`)
  - [x] Investigate pdf-lib memory internals
  - [x] Investigate worker pool ArrayBuffer lifecycle
  - [x] Trace generator document lifecycle (two-document problem)
  - [x] Design single-document architecture (progressive chain conversion)
  - [x] Restructure `AssetPagePreConverter.convertAll()` for single-document operation
  - [x] Restructure `TestFormPDFDocumentGenerator.#assemblePages()` to work in `assetDocument`
  - [x] Replace pdf-lib `arrayAsString` with O(n) `bytesAsString` (`TextDecoder('latin1')`) — **REGRESSED, fixed in session 10**
  - [x] Add `interConversionDelay` (500ms) between conversion steps for browser responsiveness
  - [x] Add post-processing yields (500ms) before finalization and before `save()`
  - [x] Firefox Maps 8-bit generation successful
  - [x] Investigate pdf-lib `save()` internals and GitHub issues for memory optimization
  - [x] Patch pdf-lib: `buffer.set()` instead of byte-by-byte loop in `PDFStream.copyBytesInto`
  - [x] Patch pdf-lib: Remove `console.trace` from `arrayAsString`
  - [x] Patch generator: Pass `objectsPerTick: 20` to `save()` for browser responsiveness
  - [x] Full 16-bit PDF main-thread conversion memory profile analysis
  - [x] Ranked memory optimization recommendations (9 strategies, most to least effective)
  - [x] Chunked `matchAll` generator for large content streams (Firefox regex limit fix)
  - [x] Streaming content stream rebuild + compression (Firefox OOM fix for `rebuildContentStream` + `#applyContentStreamResult`)
  - [ ] Add worker task concurrency cap to `WorkerPool` (memory-aware deferral)
  - [ ] Run tests and verify they complete without OOM
  - [ ] Analyze results and document baseline memory behavior
- [x] **Task 3**: Separate-chains feature — per-chain PDF output `DONE`
  - [x] Add `separateChains` option to `TestFormPDFDocumentGenerator` constructor
  - [x] Add `onChainOutput` callback to `GenerationCallbacks` typedef
  - [x] Extract `#generateSlugsPDF()` helper (slugs generated once, extracted per chain)
  - [x] Extract `#postProcess()` helper (decalibrate, blending space, output intent, manifest)
  - [x] Extract `#buildMetadataJSON()` helper
  - [x] Implement `#generateSeparateChains()` — per-chain loop: filter manifest, fresh `PDFDocument.load()`, convert, assemble, embed slug subset, post-process, save, callback
  - [x] Branch `generate()` before pre-conversion when `separateChains` is true
  - [x] Update `TestFormGeneratorAppElement` — read checkbox, pass option, implement `onChainOutput` with first-chain debugging guard
  - [x] Add `chains` stage to progress display with conditional stage ranges
- [ ] **Task 4**: Add `perPageConfigurations` to `PDFDocumentColorConverter`

## Current Status

**Focus:** Implemented streaming content stream rebuild + compression pipeline. `rebuildContentStream` now yields string segments via a generator instead of concatenating a single ~213 MB string. `#applyContentStreamResult` encodes segments to Latin-1 bytes in 5 MB chunks and feeds them into pako's streaming Deflate — no intermediate full-size string or Uint8Array. Fixes Firefox OOM during content stream write-back. Next: explicit buffer nulling (recommendation 4) and worker task concurrency cap.
**Last Updated:** 2026-02-15 (session 9)

---

## Architecture: Single-Document Progressive Conversion

### Problem (current two-document approach)

The current implementation creates a second `PDFDocument` (`assembledDocument`) and copies ALL asset pages into it upfront via `copyPages()`. This doubles memory (~35 MB asset + ~35 MB copies = ~700 MB) before any conversion starts.

### Solution (single-document approach)

Work entirely in `assetDocument`. Copy only pages that appear in multiple chains. Convert per chain, delete unneeded pages between chains, then assemble layout pages in the same document.

### Step-by-Step Flow

| Step | Class | What |
|------|-------|------|
| 1 | `TestFormPDFDocumentGenerator.generate()` | `PDFDocument.load(assetPDFBuffer)` → `assetDocument` |
| 2 | `AssetPagePreConverter.convertAll()` | Scan layouts, group by chain, identify multi-chain pages |
| 3 | `AssetPagePreConverter.convertAll()` | `assetDocument.copyPages(assetDocument, ...)` — copy only multi-chain pages, append to end |
| 4 | `AssetPagePreConverter.convertAll()` | Create `PDFDocumentColorConverter` for chain A, convert its pages in `assetDocument` |
| 5 | `PDFDocumentColorConverter.convertColor()` | Pages converted via `PDFPageColorConverter` → `PDFImageColorConverter` → `WorkerPool` |
| 6 | `AssetPagePreConverter.convertAll()` | `assetDocument.removePage()` — delete originals no longer needed by remaining chains |
| 7 | | Repeat steps 4-6 for chain B, C, ... |
| 8 | `AssetPagePreConverter.convertAll()` | All asset pages now in output color space. Return page mapping. |
| 9 | `TestFormPDFDocumentGenerator.#assemblePages()` | `assetDocument.embedPage()` + `drawPage()` — assemble layout pages in same document |
| 10 | `TestFormPDFDocumentGenerator.#assemblePages()` | `assetDocument.removePage()` — delete converted asset pages (Form XObjects survive) |

### Memory Timeline (single-document)

| Phase | Document Memory | Conversion Buffers | Total |
|-------|----------------|-------------------|-------|
| After load | ~35 MB | 0 | ~35 MB |
| After multi-chain copies | ~35 MB + copies | 0 | ~380 MB (few copies) |
| During chain A conversion | ~380 MB | per-image | ~380 MB + per-image |
| After chain A + delete originals | ~35 MB (freed originals) | 0 | ~35 MB |
| During page 5 (1 image at a time) | ~35 MB | ~243 MB | ~593 MB |
| During page 5 (3 images parallel) | ~35 MB | ~729 MB | ~1,079 MB |

### Memory Timeline (current two-document)

| Phase | Document Memory | Conversion Buffers | Total |
|-------|----------------|-------------------|-------|
| After load + copy all | ~700 MB | 0 | ~700 MB |
| During page 5 (3 images parallel) | ~700 MB | ~729 MB | ~1,429 MB |

### What Changes Per Class

| Class | Change |
|-------|--------|
| `TestFormPDFDocumentGenerator.#assemblePages()` | Remove `PDFDocument.create()`. Pass `assetDocument` directly. Assembly happens in `assetDocument`. |
| `AssetPagePreConverter.convertAll()` | Self-copy (`doc.copyPages(doc, ...)`) only for multi-chain pages. Convert per chain with deletion between chains. Track which originals are still needed via reference counting. |
| `PDFDocumentColorConverter` | None — already receives `{ pdfDocument }` and works on it |
| `PDFPageColorConverter` | None |
| `PDFImageColorConverter` | None |
| `WorkerPool` | Separate concern — concurrency cap is independent of this restructure |

### Self-Copy Constraint

When calling `assetDocument.copyPages(assetDocument, indices)`, pdf-lib's `PDFObjectCopier` deep-clones via `.slice()`. This produces independent copies even though source and target are the same document. The CRITICAL requirement is that each chain's copies are independent object graphs (the shared `PDFRawStream` bug from session 4) — separate `copyPages` calls per chain group still apply.

---

## Architecture: Separate-Chains Per-Chain PDF Output

### Problem

The Maps asset (346 MB, 7 pages including 16-bit images) requires holding all chains' conversion buffers in memory simultaneously when generating a single output PDF. This causes OOM crashes in Firefox/Chrome.

### Solution

The `Separate Chains` checkbox splits generation into one PDF per layout color space group, processing each sequentially and downloading immediately.

### Separation Key

Group output pages by `page.colorSpace` from `manifest.pages`:

| Group | Suffix | Description |
|-------|--------|-------------|
| sRGB | ` - sRGB` | Pages with `colorSpace: "sRGB"` |
| sGray | ` - sGray` | Pages with `colorSpace: "sGray"` |
| Lab | ` - Lab` | Pages with `colorSpace: "Lab"` |
| SepK | ` - SepK` | Pages with `colorSpace: "SepK"` |

### Per-Chain Loop

```
load manifest → download assets → parse ICC → generate full slugs PDF once
→ for each colorSpace group:
    PDFDocument.load(assetPDFBuffer) → fresh pre-converter → convert → assemble
    → embedPdf(fullSlugsDocument, [originalPageIndices]) → post-process → save
    → onChainOutput(colorSpace, pdfBuffer) → 500ms GC yield
→ download metadata JSON
```

### Key Design Decisions

1. **Slugs generated ONCE** before chain loop (Ghostscript runs once, not per chain)
2. **Full `manifest.assets` array preserved** in filtered manifest (index alignment with PDF pages)
3. **Fresh `PDFDocument.load()` per chain** — each chain gets independent document
4. **Debugging downloads deferred to first chain output** — profile + manifest download before first chain PDF; never fires if no chain completes
5. **Branch before pre-conversion** — separate-chains path skips single-document assembly entirely

### Memory Impact

| Phase | Single-Document | Separate-Chains |
|-------|----------------|-----------------|
| Peak during one chain | All chains' buffers | One chain's buffers only |
| Between chains | N/A | ~0 (GC opportunity) |
| During save() | Full output buffer | Chain-only output buffer |

---

## Design: Worker Task Concurrency Cap

Separate from the single-document restructure. Prevents OOM from parallel image conversion.

### Approach

Add a configuration to cap concurrent in-flight worker task memory. When the cap would be exceeded, defer new submissions until active tasks complete.

### Name Candidates

| Name | Notes |
|------|-------|
| `maxConcurrentTaskMemory` | Clear but long |
| `taskMemoryBudget` | Concise, budget metaphor |
| `concurrencyMemoryBudget` | Most precise — limits concurrency based on memory |

### Implementation Points

1. **Estimate task memory** — at submission time: `width * height * channels * bytesPerChannel * OVERHEAD_FACTOR`
2. **Track in-flight memory** — `#inFlightMemory` counter in `WorkerPool`
3. **Gate submissions** — `submitImage()` waits if `#inFlightMemory + estimate > budget`
4. **Replace `Promise.all()`** in `pdf-page-color-converter.js:440` with controlled submission loop

---

## Investigation: pdf-lib Memory Architecture

### Key Findings

| Capability | Available | Notes |
|-----------|-----------|-------|
| `flush()` | Yes | Does NOT release memory — only embeds pending objects |
| `save()` | Yes | Creates new output buffer; input document stays in memory |
| `dispose()` / `release()` | **No** | No explicit memory release mechanism |
| Incremental writes | **No** | Always produces complete PDF |
| Lazy loading | **No** | All objects loaded at parse time |
| Page unloading | **No** | Pages stay in cache indefinitely |
| Cache invalidation | Partial | Manual `.invalidate()` on `Cache` instances |
| `objectsPerTick` | Yes | Yields during serialization only |

### Internal Structure

```
PDFDocument
  └─ PDFContext
       ├─ indirectObjects: Map<PDFRef, PDFObject>  ← ALL objects, never pruned
       ├─ header, trailer, crossRefSections
       └─ enumerateIndirectObjects()               ← iterates all
  └─ pageCache: Cache                              ← computed pages, invalidatable
  └─ pages: PDFPage[]                              ← wrappers around PDFPageLeaf
```

- `PDFRawStream.contents` holds raw bytes (compressed or decompressed)
- Decompression via `decodePDFRawStream()` creates NEW `Uint8Array` on each access (not cached in PDFRawStream)
- `PDFObjectCopier` deep-clones with `.slice()` on stream contents

### Parser Buffer GC-Eligibility

The original input buffer CAN be garbage-collected after `PDFDocument.load()`:

1. `PDFParser` wraps input in `ByteStream` (line 29393: `this.bytes = bytes`)
2. `ByteStream.slice()` creates independent copies for each `PDFRawStream.contents` (line 29432)
3. After `parseDocument()` returns, only `PDFContext` is stored (line 36514)
4. `PDFParser` instance is NOT stored — becomes GC-eligible with its `ByteStream` and original buffer

### `removePage()` Does Not Free Objects

`removePage()` removes pages from the page tree but `PDFContext.indirectObjects` retains all objects. There is no mechanism to evict unreferenced objects from the Map.

---

## Investigation: Worker Pool Memory Lifecycle

### ArrayBuffer Transfer Flow

```
Main Thread                          Worker Thread
─────────────                        ─────────────
prepareWorkerTask()
  ├─ .buffer.slice() on all inputs
  ├─ creates ImageTask
  └─ returns task

submitImage(task)
  ├─ #collectTransferables()
  │   └─ compressedData OR pixelBuffer
  ├─ postMessage(task, [transferables])  ──→  handleMessage(task)
  │   (source ArrayBuffers neutered)          ├─ inflate → transform → compress
  │                                           └─ sendResult(result, [transferables])
  ├─ await result                    ←──  postMessage(result, [pixelBuffer])
  └─ resolve(result)                      (output ArrayBuffer neutered in worker)
```

### No Back-Pressure (current)

| Mechanism | Status |
|-----------|--------|
| Task queue size limit | None — `#taskQueue = []` grows unbounded |
| Concurrent task limit | Only by worker count (pool size) |
| Buffer size tracking | None — `#pendingTasks` stores resolve/reject only |
| Memory monitoring | None — no threshold checks |
| Submission backpressure | None — `Promise.all()` submits all at once |

---

## OOM Crash Analysis

### Crash Timeline

The test processes the Maps asset (`2026-02-14 - ConRes - ISO PTF - CR1 (F9e) Assets - Maps`):

| Page | Content | Behavior |
|------|---------|----------|
| 1-4 | Gray 8-bit images (small) | Completes successfully |
| 5 | 3x RGB 16-bit images (3813x4875 each) | Renderer crashes |
| 6-7 | Additional images | Never reached |

### Per-Image Conversion Memory (3813x4875 RGB 16-bit)

| Stage | Memory | Notes |
|-------|--------|-------|
| Compressed stream | ~2 MB | FlateDecode data from PDF |
| Inflated pixels | ~55.8 MB | 3813 x 4875 x 3 channels x 2 bytes |
| Byte-swapped input | ~55.8 MB | Native-endian copy for color engine |
| Output CMYK array | ~74.4 MB | 4 channels x 2 bytes per pixel |
| pako compress overhead | ~55 MB | Intermediate during deflate |
| **Per-image peak** | **~243 MB** | All stages overlapping |

---

## pdf-lib Vendored Patches (session 5)

Applied to `packages/pdf-lib/pdf-lib.esm.js`. Upstream backup at `packages/pdf-lib-upstream/pdf-lib.esm.js`.

| Patch | Line | Change | Impact |
|-------|------|--------|--------|
| A: `buffer.set()` for stream copy | 15916 | Replace byte-by-byte loop with `buffer.set(contents, offset)` in `PDFStream.copyBytesInto` | **High** — eliminates millions of individual byte assignments for large image streams during `save()` |
| B: `objectsPerTick: 20` | generator | Pass `objectsPerTick: 20` to `save()` (default: 50) | **Medium** — more frequent event loop yields during serialization, prevents "page unresponsive" in browser |
| C: Remove `console.trace` | 375 | Remove debug instrumentation from `arrayAsString` | **Low** — removes overhead from any remaining internal callers |

### pdf-lib Architectural Limitations (cannot patch)

| Limitation | Description |
|-----------|-------------|
| Dual memory during `save()` | Document model + full output buffer coexist; no streaming serialization |
| `indirectObjects` never pruned | `removePage()` removes from page tree but objects remain in `PDFContext.indirectObjects` Map |
| No `dispose()` / release | No explicit memory release mechanism; GC only |
| No incremental writes | Always produces complete PDF; fork `remdra/pdf-lib-incremental-save` exists |
| No lazy object loading | All objects parsed and held in memory at load time |

### GitHub Issues Referenced

| Issue | Summary |
|-------|---------|
| [#197](https://github.com/Hopding/pdf-lib/issues/197) | OOM with 20k pages — `save()` allocates full buffer |
| [#470](https://github.com/Hopding/pdf-lib/issues/470) | 6 GB for 200 pages — individual `copyPages` loops duplicate shared objects |
| [#639](https://github.com/Hopding/pdf-lib/issues/639) | `embedPage()` decompresses FlateDecode streams (inflates file size 7-10x) |
| [#914](https://github.com/Hopding/pdf-lib/issues/914) | No `destroy()` method requested; closed without implementation |
| [#816](https://github.com/Hopding/pdf-lib/issues/816) / [#1418](https://github.com/Hopding/pdf-lib/issues/1418) | Incremental save — fork available |

---

## Investigation: Full 16-bit PDF Main-Thread Conversion Memory Profile

The complete 16-bit PDF is ~1.5 GB with images ZIP-compressed. The 8-bit PDF is ~75 MB. The map asset alone is ~300 MB compressed. Uncompressing those ZIP streams and holding buffers needlessly creates a ticking bomb of leaks.

### Assumptions

- **Input PDF:** ~1.5 GB (16-bit, FlateDecode compressed)
- **Per-stream copies after parse:** ~1.5 GB total (independent `.slice()` copies — original buffer IS GC-eligible per Parser Buffer GC-Eligibility finding above)
- **Typical image (RGB 16-bit, 3813×4875):** ~2 MB compressed, ~55.8 MB uncompressed, ~74.4 MB as CMYK output
- **Map image (CMYK 16-bit, large):** ~300 MB compressed, ~690 MB uncompressed
- **WASM linear memory:** ~64 MB per ColorEngine instance (grows, never shrinks)
- **Output color space:** CMYK 16-bit

### Memory Profile — Main-Thread Single-Document Conversion

| Stage | Description | Buffers Held | Total Memory |
|-------|-------------|-------------|--------------|
| 0 | `PDFDocument.load(buffer)` — parsing in progress | Original (1.5 GB) + per-stream copies accumulating | ~3.0 GB peak (momentary) |
| 1 | Parse complete, GC reclaims original | Per-stream PDFRawStream copies (~1.5 GB) + PDFContext overhead | ~1.6 GB |
| 2 | `PDFDocumentColorConverter.ensureReady()` — WASM init | Document (1.6 GB) + ColorEngine WASM (~64 MB) + ProfilePool | ~1.7 GB |
| 3 | **Image 1 inflate** (typical RGB 16-bit) | Document + WASM + inflated pixels (55.8 MB) | ~1.76 GB |
| 4 | **Image 1 transform** | Document + WASM + input (55.8 MB) + output (74.4 MB) | ~1.83 GB |
| 5 | **Image 1 deflate** | Document + WASM + input + output + compress overhead (~55 MB) | ~1.89 GB |
| 6 | **Image 1 write-back** — compressed output replaces original stream | Document + WASM (input/output/overhead should be GC-eligible) | ~1.7 GB |
| 7 | **Images 2-15** (small/medium) — sequential, same pattern | Accumulates if GC doesn't run between images | ~1.7–2.2 GB |
| 8 | **Map image inflate** (~300 MB → ~690 MB) | Document + WASM + inflated map (690 MB) | ~2.4 GB |
| 9 | **Map image transform** | Document + WASM + map input (690 MB) + map output (690 MB) | ~3.1 GB |
| 10 | **Map image deflate** | Document + WASM + input + output + compress overhead (~300 MB) | ~3.4 GB |
| 11 | **Map image write-back** | Document + WASM + new compressed map (~300 MB replacing original) | ~2.0 GB |
| 12 | All images done, converter disposed | Document with converted streams (~1.5 GB) + overhead | ~1.6 GB |
| 13 | **`pdfDocument.save()`** — serializes to new `Uint8Array` | Document model (1.6 GB) + output buffer (~1.5 GB) | ~3.1 GB |
| 14 | Save complete, document released | Output buffer only | ~1.5 GB |

### GC-Delayed Worst Case

V8/SpiderMonkey do NOT guarantee GC runs between sequential image conversions. When prior images' transient buffers are not collected:

| Scenario | Peak Memory | Notes |
|----------|-------------|-------|
| **Best case** (GC between every image) | ~3.4 GB | Map deflate peak (stage 10) |
| **Typical** (GC misses 2-3 images) | ~3.8 GB | Prior image buffers linger during map processing |
| **Worst case** (no GC until pressure) | ~4.5 GB+ | All transient buffers from images 2-15 accumulate before map starts |
| **`save()` worst case** (GC-delayed + save) | ~4.5 GB+ | Document model + output buffer + lingering transients |

### Key Observations

1. **`save()` creates a hidden second peak** — the entire document model and serialized output coexist. For a 1.5 GB PDF, this alone is ~3.1 GB.
2. **Transient buffers are the ticking bomb** — each image conversion creates 3-4 large buffers (inflate, transform input, transform output, deflate overhead) that become GC-eligible but may not be collected promptly.
3. **The map image dominates** — its ~690 MB uncompressed size means transient peak during transform is ~1.4 GB for that single image.
4. **WASM linear memory only grows** — `dispose()` drops JS references but cannot reclaim WASM heap pages.
5. **`AssetPagePreConverter` creates separate WASM instances** — each `PDFDocumentColorConverter` (one per chain group) instantiates its own `ColorEngineProvider`. Multiple chains = multiple ~64 MB WASM heaps.
6. **No explicit buffer nulling** — `pdf-image-color-converter.js` does not null local variables after write-back, relying entirely on function scope exit for GC eligibility.

---

## Recommendations: Memory Optimization (Most to Least Effective)

### 1. Separate-Chains Mode — `DONE`

**Impact:** Highest. **Effort:** Done.

Already implemented (Task 3). Each color space group loads a fresh `PDFDocument`, converts only its subset, saves, and releases before the next chain. Eliminates cross-chain memory accumulation entirely. The remaining recommendations target within-chain memory.

### 2. Chunked Inflate-Transform-Deflate Pipeline

**Impact:** Very high — eliminates the 690 MB uncompressed map buffer. **Effort:** High (baseline class change, justified by ecosystem-wide benefit).

Instead of inflating the entire image, transforming, then deflating, process in fixed-size chunks (e.g., 64 KB rows). At any moment, only the current chunk's inflate output, transform output, and deflate input are in memory. The map image's transient peak drops from ~1,680 MB to ~tens of MB.

**Where:** `pdf-image-color-converter.js` — replace the current inflate-all → transform-all → deflate-all pattern with a streaming pipeline.

### 3. Share ColorEngineProvider Across Chain Converters

**Impact:** Medium — saves ~64 MB per additional chain. **Effort:** Low (generator-only change).

`AssetPagePreConverter` currently lets each `PDFDocumentColorConverter` create its own `ColorEngineProvider` → WASM instance. Pass a shared `ColorEngineProvider` via configuration so all chains in a single-document run reuse one WASM instance.

**Where:** `generator/classes/asset-page-pre-converter.js` — create `ColorEngineProvider` once, pass to each converter config.

### 4. Explicit Buffer Nulling After Image Completion

**Impact:** Medium — makes transient buffers GC-eligible immediately instead of waiting for function scope exit. **Effort:** Very low (baseline class change, trivially justified).

After `pdfStream.contents = compressedOutput`, explicitly null the local variables holding the inflated input, transform output, and deflate overhead. This allows GC to reclaim them before the next image starts.

**Where:** `pdf-image-color-converter.js` — add `inflatedPixels = null; outputPixels = null;` after write-back.

### 5. `pdfDocument.save()` Memory Mitigation

**Impact:** High for the save peak (~3.1 GB → could halve). **Effort:** High (requires pdf-lib fork or significant patch).

Options:
- **Streaming serialization** — write to a `WritableStream` instead of accumulating a `Uint8Array`. Requires deep pdf-lib modification.
- **Incremental save** — use the `remdra/pdf-lib-incremental-save` fork. Appends changes only.
- **Pre-save GC yield** — already implemented (500ms yield before `save()`), but cannot guarantee GC.

### 6. Worker Concurrency Cap (Memory-Aware Deferral)

**Impact:** Medium — prevents parallel image submissions from multiplying transient buffers. **Effort:** Medium (baseline class change, already designed above).

The `WorkerPool` currently accepts all submissions immediately. Adding a `concurrencyMemoryBudget` threshold defers new image submissions until active tasks complete and free memory.

**Where:** `worker-pool.js` — add `#inFlightMemory` tracking and gate in `submitImage()`.

### 7. Pre-Flight Memory Estimation and GC Yield

**Impact:** Low-medium — reduces GC-delayed accumulation. **Effort:** Low-medium (baseline class change).

Before processing each image, estimate its transient memory requirement (`width × height × channels × bytesPerChannel × 4`). If the estimate exceeds a threshold, insert a `setTimeout(0)` yield to give GC an opportunity. For the map image, this could trigger a forced GC pause via `performance.measureUserAgentSpecificMemory()` (Chrome only).

**Where:** `pdf-page-color-converter.js` — before `convertPDFImageColor()` call.

### 8. WASM Instance Recycling After Large Images

**Impact:** Low — saves ~64 MB per recycle. **Effort:** Medium (baseline class change).

After processing an image exceeding a size threshold, dispose the current `ColorEngineProvider` and create a fresh one. This releases the grown WASM linear memory and starts with a minimal heap.

**Where:** `composite-color-converter.js` — add threshold check after image conversion.

### 9. pdf-lib Object Pruning After `removePage()`

**Impact:** Low-medium — reclaims orphaned objects. **Effort:** Medium (pdf-lib patch).

`removePage()` leaves objects in `PDFContext.indirectObjects`. A sweep-and-collect pass could identify objects unreachable from any remaining page's resource tree and remove them from the Map.

**Where:** Vendored `pdf-lib.esm.js` — add `pruneUnreferencedObjects()` method to `PDFContext`.

---

## Fix: Chunked Content Stream Regex (Firefox ~128 MB Limit)

### Problem

Firefox's regex engine returns `null` when `matchAll` is called on strings exceeding ~128 MB. One content stream in the 16-bit PDF unpacks to ~213 MB (213,435,426 characters), causing the color operator regex to silently fail — no matches returned, no error thrown. This fix resolved the regex parsing stage; the subsequent rebuild and compression stage required a separate streaming fix (see next section).

### Solution

A `matchAll` generator function in `pdf-content-stream-color-converter.js` that:

1. **Fast path** — strings under 5 MB delegate directly via `yield*` to native `String.prototype.matchAll` (zero overhead for the vast majority of streams)
2. **Chunked path** — splits at the last space before each 5 MB boundary, runs `matchAll` on each chunk, adjusts `match.index` by the chunk's offset, and `yield`s each match
3. **Consumed in `for...of`** — no intermediate array materialization (`Array.from` removed), matches are processed one at a time

### Why Space Boundaries Are Safe

- PDF color operators are whitespace-delimited (`0.5 0.3 0.2 rg`). Splitting at a space never cuts a token.
- Each regex match is self-contained — operands and operator are captured in a single match. No multi-match dependencies.
- The `(?<=[\s\n]|^)` lookbehind in the regex works at chunk boundaries because position 0 of each non-first chunk matches `^`, and the preceding character in the original string is always a space.
- Parser state (`currentStrokeColorSpace`, `currentFillColorSpace`) propagates naturally since the `for...of` loop is the same scope.

### File Changed

| File | Change |
|------|--------|
| `classes/baseline/pdf-content-stream-color-converter.js` | Added `matchAll` generator function. Replaced `Array.from(streamText.matchAll(regex))` + `for (const match of matches)` with `for (const match of matchAll(streamText, regex))`. |

---

## Fix: Streaming Content Stream Rebuild + Compression (Firefox OOM)

> **Combined with the chunked `matchAll` fix above**, these two changes make the entire content stream pipeline streaming — from regex parsing through to compressed output. The ~213 MB content stream is never materialized as a single intermediate string at any stage.

### Problem

After the chunked `matchAll` fix (session 8), Firefox still crashed on the same ~213 MB content stream. The crash occurs AFTER parsing completes — during `rebuildContentStream` and `#applyContentStreamResult`.

**Three OOM pressure points in the old code:**

1. **`rebuildContentStream` string concatenation** — 1021 replacements on a 213 MB string via `result = result.slice(0, index) + replacement + result.slice(index + length)`. Each iteration creates a new ~213 MB string. SpiderMonkey's GC cannot reclaim them mid-loop.
2. **Result retains both `originalText` + `newText`** — 426 MB of live strings simultaneously.
3. **`#applyContentStreamResult`** — `new Uint8Array(213MB)` via `copyStringIntoBuffer`, then `pako.deflate()` creates another ~213 MB of transient buffers.

### Solution

**`rebuildContentStream`** (in `pdf-content-stream-color-converter.js`) now returns a segment generator instead of a concatenated string:

- Insertions are sorted ascending by position
- A `generateSegments()` generator yields unchanged text slices between replacements and the replacement strings themselves
- `totalLength` is computed arithmetically without materializing
- Return type changed: `{ text, finalColorSpaceState }` → `{ segments, totalLength, finalColorSpaceState }`

**Result typedef** updated: `newText: string` → `newTextSegments: Iterable<string> | null` + `newTextLength: number`

**`#applyContentStreamResult`** (in `pdf-page-color-converter.js`) now uses `compressSegmentsWithFlateDecode(segments)`:

- New function in `services/helpers/pdf-lib.js` that encodes segments to Latin-1 in ~5 MB chunks
- Each chunk is fed into pako's streaming `Deflate.push()` — no full-size Uint8Array
- Compressed result replaces stream contents directly

**After applying:** `originalText` and `newTextSegments` are nulled on the result object for immediate GC eligibility.

**Worker entrypoint** materializes segments to a string for structured clone transfer (workers have their own heap, so the OOM is not a concern there).

### Memory Impact

| Metric | Before | After |
|--------|--------|-------|
| Peak during rebuild (213 MB stream, 1021 ops) | ~1+ GB (1021 intermediate strings) | ~segment size (max gap between replacements) |
| Encoding buffer | ~213 MB Uint8Array | ~5 MB chunks |
| Compression overhead | ~213 MB pako internal | Streaming — ~5 MB at a time |
| `result.originalText` after apply | Retained (213 MB) | Nulled |

### Files Changed

| File | Change |
|------|--------|
| `classes/baseline/pdf-content-stream-color-converter.js` | `rebuildContentStream` returns `{ segments, totalLength, finalColorSpaceState }`. `convertColor` result uses `newTextSegments` + `newTextLength` instead of `newText`. |
| `classes/baseline/pdf-page-color-converter.js` | `#applyContentStreamResult` uses `compressSegmentsWithFlateDecode`. Nulls `originalText` and `newTextSegments` after applying. Removed unused `copyStringIntoBuffer` and `compressWithFlateDecode` imports. |
| `services/helpers/pdf-lib.js` | Added `compressSegmentsWithFlateDecode(segments)` — streaming Latin-1 encode + pako Deflate in 5 MB chunks. Node.js fallback uses `Buffer.from(segment, 'latin1')` + `zlib.deflateSync`. |
| `classes/baseline/worker-pool-entrypoint.js` | Materializes `newTextSegments` to string for structured clone transfer. Updated diagnostics to use `newTextLength`. |

---

## Baseline Cleanup (completed, tracked in `2026-02-15-BASELINE-CLEANUP-PROGRESS.md`)

| Fix | Status | Summary |
|-----|--------|---------|
| Fix 1: Pako hardcoded path | Done | `worker-pool-entrypoint.js` — extract `pakoPackageEntrypoint` from shared-config |
| Fix 2: Shared profile stripping | Done | `pdf-page-color-converter.js:421-438` — conditional `===` check |
| Fix 3: ArrayBuffer neutering | Done (SAFE) | `prepareWorkerTask` uses `.buffer.slice()` |
| Fix 4: Worker count mismatch | Done | `convert-pdf-color-baseline.js` — `cpus().length / 2` |

---

## Activity Log

- **2026-02-15 (session 1)**: Created test file with CDP profiling, `__measureHeapFromCDP` bridge, crash detection, Chrome args. Tests crash at page 5 with or without workers.
- **2026-02-15 (session 1)**: Fixed worker pako resolution (`worker-pool-entrypoint.js` missing `pakoPackageEntrypoint` extraction). Fixed `import.meta.resolve` conditional (`pdf-document-color-converter.js`). Verified workers process pages 1-4 successfully.
- **2026-02-15 (session 1)**: Completed baseline cleanup fixes 2-4.
- **2026-02-15 (session 2)**: Investigated pdf-lib internals — no `dispose()`, no page unloading. Original parse buffer IS GC-eligible (parser not stored). Investigated worker pool — no back-pressure, `Promise.all()` submits all images simultaneously.
- **2026-02-15 (session 2)**: Traced generator document lifecycle. Identified two-document problem: `assembledDocument` duplicates all asset streams (~35 MB extra). `assetDocument` reference held throughout conversion but unused after `copyPages()`.
- **2026-02-15 (session 2)**: Designed single-document architecture. Work entirely in `assetDocument`: self-copy only multi-chain pages, convert per chain with progressive deletion, assemble layouts in same document. Eliminates ~35 MB overhead. Changes scoped to `AssetPagePreConverter` and `TestFormPDFDocumentGenerator` — no ecosystem class modifications.
- **2026-02-15 (session 3)**: Restructured `AssetPagePreConverter.convertAll()` — changed signature from `(assetDocument, manifest, targetDocument, onProgress)` to `(document, manifest, onProgress)`. New implementation: passthrough claims originals first, first chain to claim gets original, rest get copies via separate `copyPages` calls per chain. No second document created.
- **2026-02-15 (session 3)**: Restructured `TestFormPDFDocumentGenerator.#assemblePages()` — removed `PDFDocument.create()`, assembly now operates in `assetDocument`. `embedPage()` creates Form XObjects that survive `removePage()`. Asset pages removed at end; layout pages remain. `generate()` caller unchanged — `assembledDocument` variable now points to same object as `assetDocument`.
- **2026-02-15 (session 4)**: Replaced pdf-lib's O(n^2) `arrayAsString` with O(n) `bytesAsString` helper using `TextDecoder('latin1').decode(bytes)`. All 4 consumers in our code updated: `pdf-page-color-converter.js` (baseline + non-baseline + legacy), `ColorSpaceUtils.js`. Added `console.trace` to pdf-lib's `arrayAsString` to detect remaining internal callers.
- **2026-02-15 (session 4)**: Added `interConversionDelay` configuration (500ms) — yields between conversion steps to prevent Chrome/Firefox "page taking too long" warnings. Propagated through full chain: `TestFormPDFDocumentGenerator` → `AssetPagePreConverter` → `PDFDocumentColorConverter` → `PDFPageColorConverter` (between pages, between images in main-thread mode, between content streams).
- **2026-02-15 (session 4)**: Added 500ms post-processing yields in `TestFormPDFDocumentGenerator.generate()` — before post-processing (after GhostScript WASM work) and before `save()` serialization. Firefox needs time for GC after heavy WASM operations.
- **2026-02-15 (session 4)**: **Firefox first win** — Firefox successfully generated the Maps test form (8-bit). Crashed on 16-bit. Last logs show page 14 content stream processing (stream 111 0 R) before crash. Investigating pdf-lib `save()` memory patterns and GitHub issues for optimization opportunities.
- **2026-02-15 (session 5)**: Completed pdf-lib research. Synthesized findings from two research agents (pdf-lib internals exploration + GitHub issues search). Key finding: `PDFStream.copyBytesInto` uses byte-by-byte loop instead of `buffer.set()` for stream content — the single biggest serialization bottleneck for large image PDFs.
- **2026-02-15 (session 5)**: Applied three patches to vendored pdf-lib: (A) `buffer.set()` in `PDFStream.copyBytesInto` replacing byte-by-byte loop, (B) `objectsPerTick: 20` passed to `save()` for browser responsiveness, (C) removed `console.trace` debug instrumentation from `arrayAsString`. Documented all patches and architectural limitations in progress file.
- **2026-02-15 (session 6)**: Implemented separate-chains feature — highest-impact memory optimization. Instead of converting all chains at once, each color space group (sRGB, sGray, Lab, SepK) loads a fresh `PDFDocument`, converts only its subset, saves, and frees memory before the next chain starts. Changes: `test-form-pdf-document-generator.js` (new `#generateSeparateChains()`, `#generateSlugsPDF()`, `#postProcess()`, `#buildMetadataJSON()` methods; `separateChains` constructor option; early branch in `generate()`), `test-form-generator-app-element.js` (read checkbox, pass option, `onChainOutput` callback with first-chain debugging guard, conditional stage ranges). Slugs generated once before chain loop, extracted per chain via `embedPdf(fullSlugsDocument, [originalPageIndex])`.
- **2026-02-15 (session 8)**: Implemented chunked `matchAll` generator in `pdf-content-stream-color-converter.js`. Firefox's regex engine returns null on strings exceeding ~128 MB — one content stream unpacked to ~213 MB (213,435,426 chars). The generator splits at the last space before each 5 MB boundary and yields matches with `index` offset to original string positions. Consumed directly in `for...of` (no `Array.from` materialization). Fast path: strings under 5 MB delegate via `yield*` to native `matchAll`. This fixed the regex parsing stage; Firefox still crashed afterward during rebuild + compression (fixed in session 9).
- **2026-02-15 (session 9)**: Implemented streaming content stream rebuild + compression. Root cause: `rebuildContentStream` performed 1021 string concatenations on a ~213 MB string (each creating a new ~213 MB intermediate), then `#applyContentStreamResult` created a ~213 MB Uint8Array for `copyStringIntoBuffer` + pako compression. Fix: `rebuildContentStream` now yields string segments via generator (no concatenation), new `compressSegmentsWithFlateDecode` encodes segments to Latin-1 in 5 MB chunks fed into pako's streaming Deflate. Result fields nulled after applying for GC. Worker entrypoint materializes segments for transfer. Four files changed: `pdf-content-stream-color-converter.js`, `pdf-page-color-converter.js`, `worker-pool-entrypoint.js`, `services/helpers/pdf-lib.js`.
- **2026-02-15 (session 7)**: Created full 16-bit PDF main-thread conversion memory profile — 14-stage table tracking buffer counts and total memory from `PDFDocument.load()` through `save()`. Key finding: map image (300 MB compressed → 690 MB uncompressed) creates ~3.4 GB transient peak during deflate; `save()` creates a second ~3.1 GB peak. GC-delayed worst case exceeds 4.5 GB. Corrected earlier assumption: original parse buffer IS GC-eligible (per session 2 investigation). Produced 9 ranked recommendations from most to least effective: (1) separate-chains DONE, (2) chunked inflate-transform-deflate pipeline, (3) shared ColorEngineProvider, (4) explicit buffer nulling, (5) save() memory mitigation, (6) worker concurrency cap, (7) pre-flight memory estimation, (8) WASM instance recycling, (9) pdf-lib object pruning.
- **2026-02-16 (session 10)**: **Fixed `bytesAsString` regression** — content stream encoding corruption introduced in session 4. Root cause: `TextDecoder('latin1')` uses Windows-1252 per the WHATWG Encoding Standard, NOT ISO 8859-1. Windows-1252 remaps 27 of 32 bytes in 0x80–0x9F to Unicode codepoints above U+00FF (e.g., byte 0x92 → U+2019). The `charCodeAt()` round-trip then truncates them when stored in a Uint8Array (U+2019 → 0x19). Symptom: "St. Paul's Cathedral" → "St. Paul s Cathedral" (Acrobat reports missing glyphs). Fix: replaced `TextDecoder('latin1').decode(bytes)` with chunked `String.fromCharCode.apply(null, bytes.subarray(...))` which performs the true ISO 8859-1 identity mapping (byte N → U+00NN). Still O(n) — single native call per 8192-byte chunk. Old code commented out with explanation in `services/helpers/pdf-lib.js`.
