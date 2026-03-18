# Generator Workflows — Performance and Correctness Investigation

**Started:** 2026-02-16
**Last Updated:** 2026-02-17
**Status:** Active Investigation

---

## Table of Contents

1. [Parallel Workers — Root Cause and Fix](#1-parallel-workers--root-cause-and-fix)
2. [Content Stream Worker Dispatching — Investigation](#2-content-stream-worker-dispatching--investigation)
3. [PDF Object Cleanup — Orphaned Objects](#3-pdf-object-cleanup--orphaned-objects)
4. [Browser Test Matrix — Crash Patterns](#4-browser-test-matrix--crash-patterns)
5. [Roadmap](#5-roadmap)
6. [Activity Log](#6-activity-log)

---

## 1. Parallel Workers — Root Cause and Fix

### Problem Statement

Parallel Workers with `workerCount: 6` show no significant improvement over `workerCount: 2`. Workers initialize successfully but generation time (~7+ minutes) is unchanged.

### Root Cause

Three compounding issues prevent effective worker utilization:

**Issue 1: Sequential Page Processing (Primary Bottleneck)**

`classes/baseline/pdf-document-color-converter.js:412` processes pages in a strict sequential loop:

```javascript
for (let pageIndex = 0; pageIndex < allPages.length; pageIndex++) {
    if (pageFilter && !pageFilter.has(pageIndex)) continue;
    const pageConverter = this.createChildConverter(PDFPageColorConverter, pageConfig);
    await pageConverter.ensureReady();
    result = await pageConverter.convertColor({...}, context);
    pageConverter.dispose();
}
```

With 1-3 images per page and 6 workers, at most 3 workers are busy while the rest sit idle.

**Issue 2: Content Streams Always Main-Thread**

`classes/baseline/pdf-page-color-converter.js:562-654` processes content streams sequentially on the main thread.

**Issue 3: Worker Feed Starvation**

Sequential pages + parallel-within-page creates "feast or famine" — workers busy for ~200ms then idle for ~550ms (content stream + inter-conversion delay).

### Two Alternatives Evaluated

| Criterion               | Alternative A (Cross-Page Dispatching) | Alternative B (Concurrent Subset Converters) |
| ----------------------- | -------------------------------------- | -------------------------------------------- |
| Changes to `classes/`   | 2 files, ~140 lines                    | 0 (B1) or 2 lines (B2)                       |
| Changes to `generator/` | 0                                      | 1 file, ~60 lines                            |
| Regression risk         | High — core loop rewrite               | Low — consumer-only change                   |
| Worker utilization      | Maximum                                | High (3x page throughput)                    |
| Memory overhead         | Minimal                                | +32 MB (B1) or minimal (B2)                  |
| Ecosystem impact        | All consumers affected                 | Generator-only                               |

### Decision: B1 (Zero Changes to `classes/`)

**Implemented** in `generator/classes/asset-page-pre-converter.js`:

- Split each chain's pages into up to 3 concurrent subsets
- Each subset runs its own `PDFDocumentColorConverter` sharing the same `WorkerPool`
- `Promise.all` runs converters concurrently — workers receive tasks from multiple pages simultaneously
- Falls back to single converter (identical to previous behavior) when workers disabled
- Progress aggregation across concurrent converters via shared counter (safe — JS is single-threaded)
- Helper: `splitIntoSubsets(array, n)` — round-robin distribution

### Upgrade Path: B2 (Shared WASM Engine)

If B1's ~32 MB extra memory (2 additional WASM engines) is problematic:

- 1-line change to `classes/baseline/pdf-document-color-converter.js:161`: add `options = {}` parameter with `...options` spread to `super()` call
- Enables `createChildConverter` pattern — all converters share a single WASM engine
- Backward-compatible — existing callers unaffected

---

## 2. Content Stream Worker Dispatching — Investigation

### Context

A 213 MB content stream (Lab color chart, page 18) is processed on the main thread while all workers sit idle. Threshold idea: dispatch streams estimated above 50 MB uncompressed to workers.

### Infrastructure Assessment

The worker infrastructure is **~90% built**:

| Component                  | File                                        | Status                              |
| -------------------------- | ------------------------------------------- | ----------------------------------- |
| `prepareWorkerTask()`      | `pdf-content-stream-color-converter.js:886` | Exists                              |
| `applyWorkerResult()`      | `pdf-content-stream-color-converter.js:917` | Exists (expects `compressedResult`) |
| `supportsWorkerMode`       | `pdf-content-stream-color-converter.js:874` | Returns `true`                      |
| `processContentStream()`   | `worker-pool-entrypoint.js:323-400`         | Exists (returns `newText` string)   |
| `submitContentStream()`    | `worker-pool.js:663`                        | Exists                              |
| Size-based dispatch branch | `pdf-page-color-converter.js:562-654`       | **Missing** — always main-thread    |

### Gap: Return Format Mismatch

Worker `processContentStream()` materializes result as `newText` (string, line 365-367). But `applyWorkerResult()` expects `compressedResult` (compressed Uint8Array). The worker must encode the rebuilt text to UTF-8 and compress it with FlateDecode before returning.

### Changes Needed (~55 lines across 2 files in `classes/baseline/`)

1. **`worker-pool-entrypoint.js`**: In `processContentStream()`, compress rebuilt text to Uint8Array instead of returning string. Add `compressedResult` to `sendResult()` transferables.
2. **`pdf-page-color-converter.js`**: Add size-based dispatch branch — estimate uncompressed size, if above threshold dispatch to worker pool, otherwise process on main thread.

### Not Yet Implemented — Awaiting Decision

---

## 3. PDF Object Cleanup — Orphaned Objects

### Problem Statement

Separate/recombined chain PDFs are drastically oversized:

| Chain      | Pages  | Size        | Expected Proportion |
| ---------- | ------ | ----------- | ------------------- |
| sRGB       | 8      | 1.84 GB     | 36% of 22 pages     |
| sGray      | 10     | 892.8 MB    | 45% of 22 pages     |
| SepK       | 2      | 1.5 GB      | 9% of 22 pages      |
| Lab        | 2      | 1.5 GB      | 9% of 22 pages      |
| **Sum**    | **22** | **5.73 GB** | —                   |
| Recombined | 22     | 2.14 GB     | —                   |

The sum of chain PDFs (5.73 GB) is **2.7x** the recombined document (2.14 GB). The SepK chain (2 pages, passthrough — no conversion) is 1.5 GB.

### Root Cause: `removePage` Does Not Remove Underlying Objects

**The chain workflow** (`test-form-pdf-document-generator.js`):

1. **Line 660**: Each chain loads the **full** asset PDF: `PDFDocument.load(assetPDFBuffer)` — all 22 pages' objects loaded into `PDFContext.indirectObjects`
2. **`#assemblePages` Phase A**: Converts only this chain's pages (e.g., 8 for sRGB)
3. **Phase B**: Creates layout pages using `embedPage()` + `drawPage()` — Form XObjects reference converted asset streams
4. **Phase C (line 549-551)**: `removePage(i)` for all asset pages — removes from **page tree only**
5. **Save (line 695)**: `assembledDocument.save()` serializes **ALL** indirect objects, including orphaned ones

**pdf-lib's `removePage`** (line 36908 of `pdf-lib.esm.js`) calls `this.catalog.removeLeafNode(index)` — it removes the page from the catalog's page tree but does **NOT** delete the page's underlying objects (image streams, ICC profiles, fonts, resource dictionaries) from `PDFContext.indirectObjects`.

**Consequence:** The sRGB chain (8 pages) carries image streams from all 22 source pages. The 14 non-sRGB pages' resources are orphaned in the context but still serialized on save.

### Existing Cleanup Methods (Never Called)

Two cleanup methods exist in `services/PDFService.js` but are **never called** from any generator workflow:

**`PDFService.removeOrphanedObjects(pdfDocument)`** (line 1725):
- Traverses from document roots (catalog, trailer info)
- Recursively collects all reachable `PDFRef` objects
- Identifies unreachable objects and deletes them from `context`
- Returns `{ removedCount, removedRefs }`
- **In-place** — modifies the existing document

**`PDFService.repackPDFDocument(pdfDocument)`** (line 1691):
- Creates a new empty PDF
- Copies all pages via `copyPages` (only referenced objects transfer)
- Returns the new document
- **Creates new document** — higher memory but guaranteed clean

### Implementation

**Implemented** in `test-form-pdf-document-generator.js` — both in-place and chain paths:

1. `await assembledDocument.flush()` — forces lazy `PDFEmbeddedPage` objects (from `embedPage()`) to finalize their Form XObjects, making asset page content streams truly orphaned
2. `PDFService.removeOrphanedObjects(assembledDocument)` — deletes orphaned objects
3. Clear context's cached push/pop graphics state content stream refs (see Crash Fix below)

### Crash Fix: Stale Push/Pop Graphics State Cache

**Symptom:** `Expected instance of PDFStream, but got instance of undefined` at `PDFPageEmbedder.prototype.decodeContents` during `save()`.

**Root Cause:** pdf-lib's `PDFContext` lazily creates and **caches** shared `q`/`Q` content streams (`pushGraphicsStateContentStreamRef`, `popGraphicsStateContentStreamRef`) at lines 16383-16408. During `flush()`, asset page embeds trigger `normalize()` which creates these streams and inserts their refs into asset pages' Contents arrays. Layout pages (created via `addPage()`) do NOT receive these refs — `normalize()` calls `wrapContentStreams()` but returns false because the new page has no existing Contents array.

After `removeOrphanedObjects()`, the push/pop streams are correctly identified as orphaned (only reachable from removed asset pages, not from layout pages in the page tree) and deleted from `indirectObjects`. But the context's cached refs still hold the stale values. When slug pages are later embedded during `save()` → `flush()`, `normalize()` on the copied slug page calls `getPushGraphicsStateContentStream()` which returns the **stale cached ref**, inserts it into the slug page's Contents array, and `decodeContents()` crashes trying to look up the deleted stream.

**Fix:** Clear the cached refs after `removeOrphanedObjects()`:
```javascript
assembledDocument.context.pushGraphicsStateContentStreamRef = undefined;
assembledDocument.context.popGraphicsStateContentStreamRef = undefined;
```

This causes `getPushGraphicsStateContentStream()` and `getPopGraphicsStateContentStream()` to create fresh streams when slug pages are later normalized during `save()` → `flush()`.

### Impact Assessment

- **Chain PDFs**: Expected to shrink from ~1-1.8 GB per chain to proportional size (~100-400 MB each)
- **Recombined PDF**: Indirect improvement — smaller chain buffers mean less memory during recombination
- **In-place PDF**: Moderate improvement — removes replaced ICC profiles and pre-conversion resources
- **Safety**: `removeOrphanedObjects` traverses from document roots, so Form XObjects and their referenced streams are protected. Only truly unreachable objects are removed.
- **Performance**: The traversal adds time proportional to object count, but saves significant serialization time (fewer objects to write)

### Additional Concern: Recombined Output Size

The recombined PDF (2.14 GB) may also be larger than necessary. When `copyPages` brings chain pages into the target document, shared resources (fonts, ICC profiles) may be duplicated across chains. This is a separate issue from orphaned objects but contributes to final size.

---

## 4. Browser Test Matrix — Crash Patterns

### Test Results (R2 Suffix — Final Runs)

All tests used the full CR1 (F9e) Assets form. Files sorted chronologically by timestamp.

| #   | Browser             | Input BPC | Output BPC | Mode       | Strategy | Thread    | Workers   | Result      | Failure Point                                                                               |
| --- | ------------------- | --------- | ---------- | ---------- | -------- | --------- | --------- | ----------- | ------------------------------------------------------------------------------------------- |
| 1   | Safari              | 8-bit     | 16-bit     | In-Place   | —        | Main      | —         | No download | Blob URL exceeds ~2 GB limit                                                                |
| 2   | Safari              | 8-bit     | 8-bit      | In-Place   | —        | Bootstrap | 4 workers | Crashed     | Silent kill — Web Inspector memory overhead                                                 |
| 3   | Safari              | 8-bit     | 8-bit      | In-Place   | —        | Bootstrap | 6 workers | Crashed     | Silent kill — Web Inspector memory overhead                                                 |
| 4   | Chrome              | 8-bit     | 8-bit      | In-Place   | —        | Bootstrap | 6 workers | Worked      | < 3 minutes                                                                                 |
| 5   | Chrome              | 16-bit    | 16-bit     | In-Place   | —        | Bootstrap | 2 workers | Crashed     | `RangeError: Array buffer allocation failed` in `PDFStreamWriter`                           |
| 6   | Chrome              | 16-bit    | 16-bit     | Recombined | —        | Bootstrap | 2 workers | Crashed     | `RangeError: Array buffer allocation failed` in `PDFParser.tryToParseInvalidIndirectObject` |
| 7   | Safari              | 8-bit     | 16-bit     | Recombined | Chains   | Main      | —         | Worked      | Completed but file too large to download                                                    |
| 8   | Safari (No Console) | 8-bit     | 16-bit     | Recombined | Chains   | Main      | —         | Worked      | 22 pages, 4602ms recombination. Download succeeded.                                         |

### Identified Failure Patterns

#### Pattern 1: Safari + Web Inspector = Silent Process Kill

**Tests 2, 3** — Safari with developer console open crashes during heavy processing.

- **Cause:** Web Inspector adds significant memory overhead (~200-400 MB for instrumentation, breakpoint tracking, and console message buffering). Combined with the ~1.5-2 GB working set for full-form color conversion, total memory exceeds Safari's process limit.
- **Evidence:** Logs truncate mid-conversion with no error message. No exception, no stack trace — the web process is killed by the OS.
- **Fix:** Run production workloads with console closed, or use `"No Console"` Safari configuration.

#### Pattern 2: Chrome 16-bit Output — pdf-lib Serialization Crash

**Tests 5, 6** — Chrome fails when producing 16-bit output PDFs.

- **Cause:** pdf-lib's `PDFWriter`/`PDFStreamWriter` serializes the entire document into a single `ArrayBuffer`. A 22-page 16-bit PDF exceeds 2 GB, hitting V8's `ArrayBuffer` allocation limit.
- **Evidence:** `RangeError: Array buffer allocation failed` at `PDFStreamWriter` (In-Place) or `PDFParser.tryToParseInvalidIndirectObject` via `ByteStream.slice` (Recombined — failure during re-parsing chain buffers).
- **Key insight:** The crash is in pdf-lib's serialization, NOT in color conversion. All color conversion completes successfully.
- **Fix:** Requires either (a) streaming serialization in pdf-lib, (b) reducing output size via orphaned object cleanup, or (c) architectural changes to avoid materializing the entire PDF in memory.

#### Pattern 3: Safari Blob URL Size Limit

**Test 1, 7** — Safari completes generation but the blob URL is too large to download.

- **Cause:** Safari's `URL.createObjectURL()` or the download mechanism has a practical limit around ~2 GB for blob URLs.
- **Evidence:** PDF generates successfully, save completes, but the download link fails or produces a 0-byte file.
- **Fix:** For 16-bit output, use streaming download (e.g., `showSaveFilePicker` File System Access API) or chunk-based delivery.

#### Pattern 4: 16-bit Input + 8-bit Output Works Fine

**Test 4, 8** — 8-bit output PDFs work across browsers.

- **Evidence:** Chrome 8-bit in-place with 6 workers completed in under 3 minutes. Safari "No Console" 16-bit recombined completed and downloaded.
- **Key insight:** The output BPC (not input BPC) determines final PDF size. 8-bit output keeps the document under browser memory/download limits.

### Critical Takeaway

**Orphaned object cleanup (Section 3) directly addresses Patterns 2 and 3.** If chain PDFs shrink from ~1.5 GB to ~200-400 MB each, the recombined 16-bit output may fit within the 2 GB limit. This should be tested before pursuing more complex solutions like streaming serialization.

---

## 5. Roadmap

### Parallel Workers (B1)

- [x] Root cause investigation: identified sequential page loop as primary bottleneck
- [x] Document Alternative A (cross-page image dispatching) and Alternative B (concurrent page-subset converters)
- [x] Decide: B1 (zero changes to `classes/`) — **selected**
- [x] Implement concurrent page-subset dispatching in `asset-page-pre-converter.js`
- [x] Add progress aggregation across concurrent converters
- [ ] Test with debugging enabled to verify worker utilization
- [ ] Benchmark: compare wall time before/after
- [ ] If B1 memory overhead is problematic, upgrade to B2 (1-line constructor change)

### PDF Object Cleanup

- [x] Investigate chain PDF bloat — root cause identified (orphaned objects from `removePage`)
- [x] Confirm `PDFService.removeOrphanedObjects()` exists and is never called
- [x] Add `removeOrphanedObjects()` call after `#assemblePages` in chain workflow
- [x] Add `removeOrphanedObjects()` call after `#assemblePages` in in-place workflow
- [x] Fix crash: clear cached `pushGraphicsStateContentStreamRef`/`popGraphicsStateContentStreamRef` after orphan removal
- [ ] Test: verify chain PDF sizes shrink to proportional values
- [ ] Test: verify recombined 16-bit output fits within browser limits
- [ ] Test: verify no visual regressions (Form XObjects properly preserved)

### Content Stream Worker Dispatching

- [x] Investigation: infrastructure 90% built, gap identified (return format mismatch)
- [ ] Decision: proceed with implementation (changes to 2 files in `classes/baseline/`)

### Browser Compatibility

- [x] Identify 4 failure patterns from test matrix
- [ ] Verify orphaned object cleanup resolves Chrome 16-bit crash (Pattern 2)
- [ ] Investigate streaming download for Safari blob limit (Pattern 3)

---

## 6. Activity Log

| Timestamp  | Activity                                                                                                                                  |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-02-16 | Root cause investigation: identified sequential page loop as primary worker bottleneck                                                    |
| 2026-02-16 | Documented Alternative A (cross-page image dispatching) and Alternative B (concurrent page-subset converters)                             |
| 2026-02-16 | Memory and concurrency safety analysis complete                                                                                           |
| 2026-02-17 | Implemented B1: concurrent page-subset converters in `asset-page-pre-converter.js` (zero changes to `classes/`)                           |
| 2026-02-17 | Investigated content stream worker dispatching — infrastructure 90% built, gap: return format mismatch                                    |
| 2026-02-17 | Analyzed browser test results (R2 runs): identified 4 failure patterns (Safari silent kill, Chrome pdf-lib crash, blob limit, output BPC) |
| 2026-02-17 | Investigated chain PDF bloat — root cause: `removePage` does not remove underlying objects from `PDFContext.indirectObjects`              |
| 2026-02-17 | Confirmed `PDFService.removeOrphanedObjects()` exists (line 1725) but is never called from any generator workflow                         |
| 2026-02-17 | Wired `flush()` + `removeOrphanedObjects()` into both in-place and chain paths in `test-form-pdf-document-generator.js`                  |
| 2026-02-17 | Fixed crash: `removeOrphanedObjects()` deletes shared q/Q content streams cached on context; clear cache after removal                    |
