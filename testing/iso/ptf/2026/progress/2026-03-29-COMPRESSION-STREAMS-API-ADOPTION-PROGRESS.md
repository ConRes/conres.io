# Compression Streams API Adoption — PROGRESS

**Created:** 2026-03-29  
**Last Updated:** 2026-03-29  
**Status:** Ready for Implementation

---

## Context

The project currently uses vendored pako (`packages/pako/`) for deflate/inflate operations. The Compression Streams API (`CompressionStream` / `DecompressionStream`) is a native browser and Node.js API that provides streaming compression with async iterable support — enabling async generator composition with zero dependencies.

### Why Adopt

- **Streaming by design**: `DecompressionStream.readable` implements `Symbol.asyncIterator` — feeds directly into `for await...of` and composes with async generator pipelines
- **Zero dependency**: Native API, no vendored library needed for new code
- **Memory efficient**: Processes chunks incrementally, never materializes the full decompressed buffer at once
- **Critical for the validator**: The PDF validator's async generator architecture needs streaming inflate/deflate to process 1 GB+ PDFs in bounded memory

### Compatibility

| Environment | Version                     | `deflate-raw` | `Symbol.asyncIterator` on `ReadableStream`                        |
| ----------- | --------------------------- | ------------- | ----------------------------------------------------------------- |
| Node.js     | 21.2.0+ (tested: 24.7.0)    | Yes           | Yes                                                               |
| Chromium    | 80+ (tested: 145)           | Yes           | Yes                                                               |
| Firefox     | 113+ (Franz's minimum: 115) | Yes           | Yes (Firefox 110+)                                                |
| Safari      | 16.4+                       | Yes           | **No** (`Symbol.asyncIterator` not supported on `ReadableStream`) |

**Safari limitation**: `ReadableStream` does not implement `Symbol.asyncIterator` in Safari yet. WebKit's official standards position is **support** ([WebKit/standards-positions#319](https://github.com/WebKit/standards-positions/issues/319), closed 2024-05-06). Implementation is tracked in [WebKit Bug 194379](https://webkit.org/b/194379). Until Safari ships it, workaround: use `reader.read()` loop. This is a temporary gap — no polyfill investment needed.

### Parallel Work

This adoption effort runs **in parallel** with two other efforts on the same branch (`test-form-generator/2026/dev`):

- **PDF Validator Tool** (`2026-03-28-VALIDATE-PDF-PROGRESS.md`) — the validator will be the first consumer of the Compression Streams provider. It uses an async generator architecture for streaming PDF analysis. The validator is currently in design phase.
- **Legacy Acrobat Compatibility** (`2026-03-29-RESOLVE-LEGACY-COMPATIBILITY-PROGRESS.md`) — investigating why 2026/generator PDFs don't open in older Acrobat. Waiting on Franz's test results from the Compatibility 1A suite.

Do NOT modify files related to those efforts. This task is strictly about transitioning compression/decompression from pako to the native Compression Streams API.

---

## Test Suite

### Location

`testing/iso/ptf/2026/experiments/tests/compression-streams-api.test.js`

This is in `experiments/tests/` (not `tests/`) because it is a general-purpose API verification test — not a package test. The `experiments/tests/` directory is for tests that support design and development work across the project (validator, generator, etc.), separate from the package test suite in `tests/` which is run by `yarn test`.

### Running

```bash
cd testing/iso/ptf/2026
node --test experiments/tests/compression-streams-api.test.js
```

### Pattern

The test follows the project's existing `node:test` pattern (see `tests/classes/*.test.js` for reference):

- Uses `describe`, `test`, `before`, `after` from `node:test`
- Uses `assert` from `node:assert`
- Has two `describe` blocks: "Node.js" (runs directly) and "Browser (Chromium)" (runs via Playwright)
- The core test logic is a shared function (`runCompressionStreamTests`) that runs identically in both environments
- For the browser block, the test function is serialized as a string and passed to `page.evaluate`

### Current Tests (8 per environment, 16 total)

| Test                                             | What It Verifies                                 |
| ------------------------------------------------ | ------------------------------------------------ |
| `DecompressionStream('deflate-raw')` constructor | API exists, returns readable/writable            |
| `CompressionStream('deflate-raw')` constructor   | API exists, returns readable/writable            |
| `ReadableStream[Symbol.asyncIterator]`           | Async iterable support on readable               |
| Round-trip (small)                               | Compress → decompress → identical bytes          |
| `yield* ds.readable` pattern                     | Async generator composition works                |
| Chunked input (3 writes)                         | Multiple `.write()` calls produce correct output |
| Large buffer (10 MB)                             | Handles real-world data sizes                    |
| Zero buffer (1 MB — pixel stub)                  | Validates the pixel-stubbing compression ratio   |

### Expanding the Test Suite

When adding tests, follow the same pattern:

1. Add the test logic inside `runCompressionStreamTests()` — this ensures it runs in BOTH environments
2. Add a corresponding `test()` block in BOTH `describe` sections (Node.js and Browser)
3. Match results by `name` from the results array

Tests to consider adding during implementation:

- **pako → Compression Streams interop**: compress with pako, decompress with `DecompressionStream` (and vice versa) to verify wire-format compatibility
- **PDF FlateDecode round-trip**: take a real FlateDecode stream from a PDF, decompress with `DecompressionStream('deflate-raw')`, verify it matches pako's output
- **Streaming back-pressure**: large input with slow consumer to verify the stream doesn't buffer everything
- **Error handling**: corrupt/truncated deflate data, verify the stream errors cleanly
- **`CompressionStreamsProvider` unit tests**: once the provider module exists (Step 4), test `inflateRaw`, `deflateRaw`, `inflateRawToBuffer`, `deflateRawToBuffer`

---

## Scope

### In Scope

1. **New validator code** — uses Compression Streams API exclusively (no pako)
2. **pdf-lib integration** — `context.flateStream()` and `context.stream()` paths that currently use pako's bundled deflate
3. **Generator post-processing** — `setOutputIntentForPDFDocument` ICC profile compression
4. **Content stream encoding** — `createContentStream` and related helpers in `services/ColorSpaceUtils.js`

### Out of Scope (for now)

- Removing pako from `packages/` (existing code may still depend on it)
- Safari async iterable polyfill (not a current target)
- Modifying `classes/baseline/*.js` converter classes (those are used by the generator, change there is higher risk)

---

## Roadmap

- [x] **Step 1** — Verify API availability (Node.js, Chromium, Firefox 115)
- [x] **Step 2** — Test suite: round-trip, chunked, large buffer, yield* pattern
- [x] **Step 3** — Audit current pako usage across the codebase
- [x] **Step 4** — Create compression provider (`helpers/compression.js`)
- [x] **Step 5** — Transition `services/helpers/pdf-lib.js` (compressWithFlateDecode, compressSegmentsWithFlateDecode, decompressWithFlateDecode)
- [x] **Step 6** — Transition `helpers.js` download gzip compression
- [x] **Step 7** — Transition `services/PDFService.js` setOutputIntentForPDFDocument (async + `context.stream()`)
- [x] **Step 8** — Transition `experiments/convert-pdf-color.js` ICC profile compression
- [x] **Step 9** — Transition baseline classes (`pdf-document-color-converter`, `pdf-image-color-converter`, `pdf-image-color-sampler`)
- [x] **Step 10** — Transition worker entrypoints (`worker-pool-entrypoint.js`, `StreamTransformWorker.js`)
- [x] **Step 11** — Remove static pako import from `WorkerColorConversion.js`
- [ ] **Step 12** — Transition remaining experiments
- [ ] **Step 13** — Integration tests against existing test suite
- [ ] **Step 14** — Verify generated PDFs unchanged (binary comparison of structural attributes)

### Step 3 Details: Audit Current Usage

**Audit script:** `experiments/scripts/audit-pako-usage.mjs`

Run: `node experiments/scripts/audit-pako-usage.mjs`

Files scanned: 156 (excluding `packages/`, `reference/`, test for Compression Streams itself).
Total code hits: 181 across 27 files.

#### In-Scope Call Sites (transitionable)

| File                               | Lines   | What                                                                 | How                            | Transition                         |
| ---------------------------------- | ------- | -------------------------------------------------------------------- | ------------------------------ | ---------------------------------- |
| `services/helpers/pdf-lib.js`      | 77-108  | `compressWithFlateDecode()` — single-buffer deflate                  | pako → zlib fallback chain     | `deflateRawToBuffer`               |
| `services/helpers/pdf-lib.js`      | 111-167 | `compressSegmentsWithFlateDecode()` — streaming 5 MB chunked deflate | `new pako.Deflate()` streaming | `deflateRaw` async generator       |
| `services/helpers/pdf-lib.js`      | 170-195 | `decompressWithFlateDecode()` — single-buffer inflate                | pako → zlib fallback chain     | `inflateRawToBuffer`               |
| `experiments/convert-pdf-color.js` | 362-367 | ICC profile compression                                              | `pako.deflate()`               | `deflateRawToBuffer`               |
| `experiments/validator/*.mjs`      | various | `context.flateStream()` for test PDF creation                        | Via pdf-lib bundled pako       | Pre-compress + `context.stream()`  |
| `helpers.js`                       | 366-389 | gzip download compression                                            | `pako.gzip()`                  | Native `CompressionStream('gzip')` |

#### Out of Scope (baseline classes — higher risk, do not modify)

| File                                               | Lines                  | What                                               | How                                  |
| -------------------------------------------------- | ---------------------- | -------------------------------------------------- | ------------------------------------ |
| `classes/baseline/pdf-document-color-converter.js` | 142-203, 744-753, 1086 | Lazy pako load, inflate streams, FlateDecode dicts | `#pako.inflate()`                    |
| `classes/baseline/pdf-image-color-converter.js`    | 126-167, 481-542       | Decompress/compress image streams                  | `#pako.inflate()`, `#pako.deflate()` |
| `classes/baseline/pdf-image-color-sampler.js`      | 132-370                | Decompress images for sampling                     | `#pako.inflate()`                    |
| `classes/baseline/pdf-page-color-converter.js`     | 853, 899               | FlateDecode dict entries only                      | PDFName literal                      |
| `classes/baseline/worker-pool-entrypoint.js`       | 106-215                | inflate/deflate in workers                         | pako (browser) / zlib (Node.js)      |

#### Not Transitionable (FlateDecode literals or legacy code)

| File                                | What                                | Why                                     |
| ----------------------------------- | ----------------------------------- | --------------------------------------- |
| `services/ColorSpaceUtils.js`       | FlateDecode filter check + dict set | PDFName metadata, not compression calls |
| `services/PDFService.js`            | FlateDecode dict set                | PDFName metadata only                   |
| `services/StreamTransformWorker.js` | inflate/deflate in legacy workers   | Legacy worker — pako/zlib dual path     |
| `services/WorkerColorConversion.js` | `pako.inflate()` for ICC profiles   | Legacy service                          |
| `experiments/internal/legacy/*`     | `context.flateStream()`             | Legacy code                             |

#### pdf-lib Bundled Pako

`packages/pdf-lib/pdf-lib.esm.js` bundles its own pako copy. `context.flateStream(data, dict)` (line 16367) calls `pako_1$1.deflate()` internally. Transition strategy: pre-compress data with `deflateRawToBuffer`, then use `context.stream(compressedData, { ...dict, Filter: 'FlateDecode' })` instead.

### Step 4 Details: CompressionStreamsProvider

A thin utility module providing async generator and buffer-based APIs:

```javascript
// Async generator inflate — composable with yield*
async function* inflateRaw(compressedBytes) {
    const ds = new DecompressionStream('deflate-raw');
    const writer = ds.writable.getWriter();
    writer.write(compressedBytes);
    writer.close();
    yield* ds.readable;
}

// Async generator deflate — composable with yield*
async function* deflateRaw(rawBytes) {
    const cs = new CompressionStream('deflate-raw');
    const writer = cs.writable.getWriter();
    writer.write(rawBytes);
    writer.close();
    yield* cs.readable;
}

// Convenience: collect all chunks into a single Uint8Array
async function inflateRawToBuffer(compressedBytes) { ... }
async function deflateRawToBuffer(rawBytes) { ... }
```

**Location resolved:** `helpers/compression.js` — provides all three formats (deflate/zlib, deflate-raw, gzip) as both async generators and buffer convenience functions.

### Step 4 Details: Compression Provider

`helpers/compression.js` exports:

| Function                            | Format                 | Use                             |
| ----------------------------------- | ---------------------- | ------------------------------- |
| `deflate` / `deflateToBuffer`       | zlib (RFC 1950)        | PDF FlateDecode streams         |
| `inflate` / `inflateToBuffer`       | zlib (RFC 1950)        | Reading PDF FlateDecode streams |
| `deflateRaw` / `deflateRawToBuffer` | raw DEFLATE (RFC 1951) | If raw format needed            |
| `inflateRaw` / `inflateRawToBuffer` | raw DEFLATE (RFC 1951) | If raw format needed            |
| `gzip` / `gzipToBuffer`             | gzip (RFC 1952)        | Download compression            |
| `gunzip` / `gunzipToBuffer`         | gzip (RFC 1952)        | If gzip decompression needed    |

**Critical format note:** PDF FlateDecode is zlib format (RFC 1950, `0x78` header), NOT raw deflate. Use `deflate`/`inflate` (not `deflateRaw`/`inflateRaw`) for all PDF stream operations.

**Streaming deadlock note:** When using `CompressionStream`/`DecompressionStream` directly, read and write MUST happen concurrently. Writing all data before reading causes deadlock when the internal buffer fills (backpressure). The `pipeThrough` helper in `compression.js` handles this for single-buffer inputs. For chunked writes (like `compressSegmentsWithFlateDecode`), launch the writer as a detached async task and read concurrently.

### Step 5-8 Details: Transitioning Call Sites

For `context.flateStream(data, dict)` replacement:

- Pre-compress: `const compressed = await deflateToBuffer(data)`
- Create stream: `context.stream(compressed, { ...dict, Filter: 'FlateDecode' })`
- Verified: `context.stream()` exists at pdf-lib.esm.js line 16362

For sync-to-async transitions (e.g., `PDFService.setOutputIntentForPDFDocument`):

- Make the function `async`
- Update ALL callers to `await`

### Step 8-9 Details: Verification

After transitioning, verify that generated PDFs are structurally identical:

1. Run the existing test suite (`yarn test`) — all tests must pass
2. Generate a test form PDF with the transitioned code
3. Compare the output against a reference PDF generated with the old code:
   - Same page count, same page boxes
   - Same output intent profile (decompress both, compare raw bytes)
   - Same content stream operators (decompress both, compare text)
   - File sizes may differ slightly (different deflate implementations produce different compressed output for the same input) — this is expected and acceptable

---

## Activity Log

### 2026-03-29

- Researched Compression Streams API browser and Node.js support
- Confirmed `deflate-raw` available in Node.js 21.2.0+, Chromium 80+, Firefox 113+
- Confirmed `ReadableStream[Symbol.asyncIterator]` in Node.js 24+, Chromium 63+, Firefox 110+
- Created and ran test suite: 16/16 pass (8 Node.js + 8 Chromium)
- Zero-buffer compression ratio confirmed: 1 MB → 1,033 bytes (0.099%)
- Identified Safari limitation: `ReadableStream` lacks `Symbol.asyncIterator`
- Moved test to `experiments/tests/compression-streams-api.test.js` following project `node:test` pattern
- Created `experiments/scripts/audit-pako-usage.mjs` — scans codebase for all pako/zlib/deflate/inflate/FlateDecode/flateStream usage
- Completed Step 3 audit: 181 code hits across 27 files. 6 in-scope transitionable call sites identified, 10 out-of-scope (baseline classes), rest are literals or legacy
- Created `helpers/compression.js` — provider with all three formats (deflate/zlib, deflate-raw, gzip)
- Created `experiments/tests/compression-provider.test.js` — 19 tests (Node.js + Chromium), all pass
- Discovered format mismatch: PDF FlateDecode is zlib (RFC 1950), not raw deflate — provider uses `'deflate'` not `'deflate-raw'`
- Verified bidirectional pako interop (native compress → pako decompress and reverse)
- Transitioned `services/helpers/pdf-lib.js`: compressWithFlateDecode, compressSegmentsWithFlateDecode, decompressWithFlateDecode
- Fixed streaming deadlock in compressSegmentsWithFlateDecode: concurrent read/write pattern
- Transitioned `helpers.js` download gzip: pako.gzip → gzipToBuffer
- Transitioned `services/PDFService.js`: setOutputIntentForPDFDocument made async, context.flateStream → deflateToBuffer + context.stream
- Updated all callers of setOutputIntentForPDFDocument to await (generate.js, test-form-pdf-document-generator.js ×2, experiments/convert-pdf-color.js, WorkflowIntegration.test.js, legacy/convert-pdf-color.js)
- Transitioned `experiments/convert-pdf-color.js` ICC profile compression
- Remaining: baseline classes (pdf-document-color-converter, pdf-image-color-converter, pdf-image-color-sampler), worker entrypoints, WorkerColorConversion.js static import

### 2026-03-30

- Transitioned baseline classes: pdf-document-color-converter (#pako → #compression, #getDecompressedStreamContents async), pdf-image-color-converter (#pako → #compression, #decompress/#compress async), pdf-image-color-sampler (#pako → #compression, #decompress async)
- Transitioned worker-pool-entrypoint.js: pako/zlib dual path → compression provider
- Transitioned StreamTransformWorker.js: pako/zlib → compression provider, inflate/deflate async
- Removed static pako import from WorkerColorConversion.js: replaced with inflateToBuffer, made decompressICCProfile and getImageColorSpaceInfo async
- Steps 9-11 complete. Remaining: experiment transitions, integration tests, PDF verification
