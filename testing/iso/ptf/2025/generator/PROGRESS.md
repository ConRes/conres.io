# Generator Prototype - PROGRESS

## Overview

Refactor the test form generator to use the new `PDFDocumentColorConverter` (baseline classes) for in-browser color conversion, replacing the previous multi-step workflow that required users to download a pre-assembled PDF and color-convert externally in Adobe Acrobat.

**Entrypoint:** `testing/iso/ptf/2025/generator/index.html`
**Module:** `testing/iso/ptf/2025/generator/generator.js`

### Key Changes from Previous Generator

| Aspect                  | Previous                                        | New                                                        |
| ----------------------- | ----------------------------------------------- | ---------------------------------------------------------- |
| Color conversion        | External (Adobe Acrobat)                        | In-browser (`PDFDocumentColorConverter` from `classes/baseline`) |
| Asset source            | Pre-assembled PDF with `Slugs.json`             | Assets PDF with `manifest.json`                            |
| UI flow                 | Multi-step wizard with stage-based progression  | Single Generate button with validation                     |
| Architecture            | Monolithic `TestFormGenerator` class            | `TestFormPDFDocumentGenerator` + `TestFormGeneratorAppElement` |

### Asset Structure

**Asset PDF:** `testing/iso/ptf/assets/2026-02-14 - ConRes - ISO PTF - CR1 (F9e) Assets.pdf`

**Asset Resources:**

| File             | Purpose                                         |
| ---------------- | ----------------------------------------------- |
| `manifest.json`  | Settings, assets, layouts, and page descriptors |
| `slugs.ps`       | PostScript slug template (QR codes, metadata)   |
| `barcode.ps`     | BWIPP barcode generator for QR codes            |

**Manifest Sections:**

- `settings.colorManagement` — Default source profiles for Device Gray/RGB/CMYK
- `colorSpaces` — Color space definitions mapping names to profiles (new)
- `assets[]` — Individual asset entries with color space (1:1 with asset PDF pages)
- `layouts[]` — Layout definitions composing assets into page layouts
- `pages[]` — Final page sequence with metadata (title, resolution, colorSpace)

**Color Space Map (`manifest.colorSpaces`):**

| Name   | Type     | Profile                               | Notes                          |
| ------ | -------- | ------------------------------------- | ------------------------------ |
| `sRGB` | `RGB`    | `../../profiles/sRGB IEC61966-2.1.icc`| Relative path from manifest    |
| `sGray`| `Gray`   | `../../profiles/sGray.icc`            | Relative path from manifest    |
| `Lab`  | `Lab`    | `"Lab"` (string)                      | Built-in Lab D50 profile       |
| `SepK` | `DeviceN`| (absent)                              | No profile = no pre-conversion |

### New Classes

**`TestFormPDFDocumentGenerator`** — Generation logic (no UI coupling)

- Loads and caches the asset PDF
- Parses the manifest
- Pre-converts each asset page to the output color space (with optional intermediate layout profile)
- Assembles pages from pre-converted assets (embed once, draw many)
- Generates slugs via `GhostscriptService`
- Post-processes: decalibrate, set output intent (user's ICC), embed slugs

**`ManifestColorSpaceResolver`** — Profile resolution from manifest colorSpaces

- Resolves relative ICC profile paths via `new URL(path, manifestURL)`
- Fetches and caches profiles using browser Cache API
- Returns `'Lab'` string for Lab (built-in engine profile)
- Returns `null` for DeviceN/SepK (no conversion)

**`AssetPagePreConverter`** — Per-asset page pre-conversion with caching

- Extracts individual pages from asset PDF into single-page PDFs
- Converts via `PDFDocumentColorConverter` with `intermediateProfiles` config
- Caches by `(assetIndex, layoutColorSpace)` — convert once, reuse many
- SepK passthrough (no conversion)

**`TestFormGeneratorAppElement`** — Custom element (`<test-form-generator-app>`)

- Binds to form elements in shadow DOM
- Validates form fields (ICC profile required, fields filled unless debugging)
- Reports progress via progress bars
- Delegates generation to `TestFormPDFDocumentGenerator`
- Handles file downloads (PDF + metadata JSON)

---

## Roadmap

- [x] Create PROGRESS.md `DONE`
- [x] Fix importmap paths in `index.html` (resolve `./packages/` to `../packages/`) `DONE`
- [x] Implement `TestFormPDFDocumentGenerator` class `DONE`
  - [x] Asset PDF loading and caching (with fetch progress)
  - [x] Manifest loading and parsing
  - [x] Color conversion via `PDFDocumentColorConverter` (baseline)
  - [x] Slug generation via `GhostscriptService`
  - [x] PDF assembly (decalibrate, output intent, embed slugs)
  - [x] Metadata JSON generation
- [x] Implement `TestFormGeneratorAppElement` class `DONE`
  - [x] Custom element registration
  - [x] Form validation (ICC profile, required fields, debugging bypass)
  - [x] Progress reporting (download + generation)
  - [x] Generate button handler
  - [x] File download triggers (PDF, metadata JSON, debug files)
- [x] Wire up `generator.js` entry point `DONE`
- [x] Wire up bit depth radio buttons (`outputBitsPerComponent`) `DONE`
- [x] Implement Clear Cache button `DONE`
- [x] Fix `embedPDF` → `embedPdf` in `PDFService.js` `DONE`
- [x] Fix case-insensitive colorSpace matching in layout lookup `DONE`
- [x] Fix debugging defaults to match `generate.js` `DONE`
- [x] HEAD-based cache freshness checking (matching `generate.js` pattern) `DONE`
- [x] Fix output intent to always use the user's destination ICC profile `DONE`
- [x] Pre-convert mismatched asset pages before assembly (multiprofile transforms) `DONE`
  - [x] Investigate baseline multiprofile transform usage
  - [x] Amend baseline `ColorConverterConfiguration` with `intermediateProfiles`
  - [x] Amend `convertColorsBuffer` to use config intermediates (precedence over policy)
  - [x] Create `ManifestColorSpaceResolver` class (profile resolution from manifest)
  - [x] Create `AssetPagePreConverter` class (per-asset pre-conversion with caching)
  - [x] Refactor `generate()` and `#assemblePages` for pre-conversion workflow
  - [x] Cache converted assets (convert once, embed once, draw many)
- [x] Extract additional classes from `TestFormPDFDocumentGenerator` `DONE`
  - [x] `ManifestColorSpaceResolver` — Profile resolution from manifest colorSpaces
  - [x] `AssetPagePreConverter` — Per-asset page pre-conversion with caching
- [x] Batch pre-conversion with page-selective converter `DONE`
  - [x] Add `pages?: number[]` to `PDFDocumentColorConverterConfiguration`
  - [x] Filter page loop in `convertColor()` using Set-based lookup
  - [x] Rewrite `AssetPagePreConverter` for batch in-place conversion
  - [x] Group by conversion chain, one converter per chain
  - [x] `embedPage` from same document for output assembly
  - [x] Remove asset pages after assembly
- [x] Fix worker importmap issues (bare specifiers fail in Web Workers) `DONE`
  - [x] Skip legacy `ColorEngineService` initialization when `colorEngineProvider` is supplied (avoids `pdf-lib` import in worker)
  - [x] Add pako relative-path fallback in `PDFImageColorConverter.#loadPako()`
- [x] Per-page progress reporting during color conversion `DONE`
  - [x] Add `onPageConverted` callback to `PDFDocumentColorConverter.convertColor()` context
  - [x] Thread per-page progress from `AssetPagePreConverter` → generator → UI
  - [x] Full `await` chain ensures `requestAnimationFrame` yields propagate to browser
- [x] Remove hardcoded pako path from baseline classes `DONE`
  - [x] Resolve pako via `import.meta.resolve()` in `CompositeColorConverter`
  - [x] Pass resolved entrypoint through `WorkerPool` → `worker-pool-entrypoint.js` → `PDFImageColorConverter`
  - [x] Remove hardcoded `../../packages/pako/dist/pako.mjs` fallback from all baseline files
- [x] Create staging sync and dependency tracing tools `DONE`
  - [x] `sync-generator-to-staging.mjs` — safe file sync with parent-commit protection
  - [x] `trace-dependencies.mjs` — runtime dependency graph tracing via tsc
  - [x] `--runtime-only` flag to exclude JSDoc type-only imports
  - [x] `--workspaceRoot` flag for cross-repo comparison
- [x] Sync development changes to staging `DONE`
  - [x] Traced runtime dependency graph (36 project files)
  - [x] Identified safe sync groups: generator (5), assets (9), classes (7)
  - [x] Confirmed packages and services already present in staging
  - [x] Synced 20 files (1 symlink skipped — already correct in staging)
- [x] Create `STAGING.md` deployment sync documentation `DONE`
- [ ] Browser testing and verification `IN-PROGRESS`
- [x] Fix `bytesAsString` content stream encoding regression `DONE`

---

## Current Status

**Phase:** Fixed `bytesAsString` regression (TextDecoder Windows-1252 corruption), browser verification continuing
**Last Updated:** 2026-02-16 (session 10)

---

## Activity Log

### 2026-02-14

- Created PROGRESS.md with roadmap
- Analyzed existing `generator.js` (old multi-stage `TestFormGenerator`)
- Analyzed new `index.html` UI structure
- Analyzed `manifest.json` asset/layout/page descriptors
- Analyzed `slugs.ps` PostScript template
- Analyzed baseline `PDFDocumentColorConverter` API and usage pattern
- Analyzed service APIs: `PDFService`, `GhostscriptService`, `ICCService`, `ColorEngineService`
- Fixed importmap paths in `index.html` (`./packages/` to `../packages/`)
- Rewrote `generator.js` with two new classes:
  - `TestFormPDFDocumentGenerator` — Generation logic (asset loading, page assembly, color conversion, slug generation, post-processing)
  - `TestFormGeneratorAppElement` — Custom element (`<test-form-generator-app>`) with form validation, progress reporting, file downloads
- Fixed diagnostics: removed invalid `blackpointCompensationClamping` property from converter configuration
- Fixed diagnostics: suppressed unused `stage` parameter warning in progress callback
- Split `generator.js` into separate files: `classes/test-form-pdf-document-generator.js`, `elements/test-form-generator-app-element.js`, thin entry point
- Removed eager try/catch wrappers (raw error propagation for prototyping)
- Fixed naming: no underscore prefixes, no single-letter variables, no abbreviations
- Fixed `embedPDF` → `embedPdf` (pdf-lib uses camelCase)
- Fixed case-insensitive colorSpace matching in layout lookup (manifest has `"LAB"` vs `"Lab"`)
- Fixed debugging defaults to match `generate.js` (`'a device'`, `'some colorants'`, etc.)
- Implemented HEAD-based cache freshness checking (matching `generate.js` pattern)
- Implemented Clear Cache button (`caches.delete('conres-testforms')`)
- Wired up bit depth radio buttons (`outputBitsPerComponent: 8 | 16 | undefined`)

### 2026-02-14 (session 2)

#### Investigation: Multiprofile Transforms in Baseline Classes

**How multiprofile transforms work:**

1. `ColorConversionPolicy` evaluates conversion descriptors against rules in `color-conversion-rules.json`
2. Rules can set `requiresMultiprofileTransform: true` with optional `intermediateProfiles`
3. `ColorConverter.convertColorsBuffer()` builds profile chain: `[sourceProfile, ...intermediateProfiles, destinationProfile]`
4. `ColorConverter.#getOrCreateMultiprofileTransform()` uses `ColorEngineProvider.createMultiprofileTransform()` (native) or falls back to multi-stage individual transforms
5. `createChildConverter()` (`color-converter.js:1242`) propagates parent config via spread: `{ ...this.#configuration, ...configOverrides }` — this is how `outputBitsPerComponent` and other config flows through the hierarchy

**Profile chain for existing policy rules:**

- K-Only GCR with Gray/CMYK/Lab input → multiprofile: `[source, sRGB intermediate, destination]`
- RGB to RGB with BPC → multiprofile with `cmsFLAGS_MULTIPROFILE_BPC_SCALING`
- Lab input with K-Only GCR → falls back to Relative Colorimetric (no multiprofile)

**How `convert-pdf-color-baseline.js` uses it:**

- Passes `outputBitsPerComponent` directly to `PDFDocumentColorConverter` constructor (line 780)
- Multiprofile behavior is policy-driven — the CLI tool doesn't configure it explicitly
- The policy rules + `convertColorsBuffer` handle intermediate profiles automatically

#### Investigation: Output Intent Issue

**Finding:** The output intent in the generator may reference a SOURCE ICC profile (sRGB/sGray from asset pages) instead of the user's DESTINATION ICC profile.

- `extractICCProfilesFromPDFDocument()` extracts profiles from PDF color space definitions
- After `PDFDocumentColorConverter.convertColor()`, the embedded ICC profiles may still be source profiles
- The fallback `new Uint8Array(iccProfileBuffer)` IS the correct destination profile
- But if `iccProfileReference` is found (a source profile ref), it takes precedence — WRONG

**Fix:** Always use the user's destination ICC profile bytes for the output intent.

#### Enhancement: Pre-Convert Mismatched Asset Pages

**Problem:** Currently, the asset PDF contains separate pages for every colorSpace variant (sRGB, sGray, Lab). This is bandwidth-heavy — large images are duplicated in multiple color spaces.

**Solution:** Only download sRGB source pages. Pre-convert to sGray/Lab in-browser before assembly.

**Manifest `colorSpaces` map:** Provides profile paths for each color space. Profiles resolved via `new URL(relativeProfileSpecifier, resolvedManifestURL)` for isomorphism.

- `profile == null` (absent): no intermediate conversion needed (e.g., SepK)
- `profile === "Lab"`: built-in Lab profile string (passed directly to color engine)
- `profile === "../../profiles/..."`: relative path to ICC profile (load via fetch/cache)

**Key constraint:** "Only ever convert an asset to the same different colorSpace once and use it many" — cache converted results keyed by `(assetIndex, targetColorSpace)`.

**All conversions must use `createMultiprofileTransform`** regardless of whether intermediate profiles are needed.

### 2026-02-14 (session 3)

#### Output Intent Fix

- Removed `extractICCProfilesFromPDFDocument` lookup from post-processing
- Output intent now always uses `new Uint8Array(iccProfileBuffer)` (the user's destination profile)
- Previously, extracted source ICC profiles (sRGB/sGray) could override the destination profile

#### Baseline `ColorConverterConfiguration` Amendment

- Added `intermediateProfiles?: ProfileType[]` to `ColorConverterConfiguration` typedef (`color-converter.js:112`)
- Amended `convertColorsBuffer` to check for config intermediates before policy evaluation
- Config intermediates take precedence over policy-driven intermediates
- When no `intermediateProfiles` in config, existing policy-driven behavior is unchanged (same code path)
- Propagation through `createChildConverter` spread is automatic (`{ ...this.#configuration, ...configOverrides }`)

#### New Classes Created

**`ManifestColorSpaceResolver`** (`generator/classes/manifest-color-space-resolver.js`)
- Resolves ICC profiles from manifest `colorSpaces` map entries
- Uses `new URL(profilePath, manifestURL)` for relative path resolution (isomorphic)
- Caches resolved profiles (avoids redundant fetches)
- Profile types: `ArrayBuffer` (ICC files), `'Lab'` (built-in), `null` (SepK/DeviceN)

**`AssetPagePreConverter`** (`generator/classes/asset-page-pre-converter.js`)
- Orchestrates per-asset page color conversion before PDF assembly
- Matching colorSpaces: source → output (no intermediates)
- Non-matching colorSpaces: source → layout → output (intermediateProfiles = [layoutProfile])
- SepK: passthrough (no conversion, no profile)
- Caches converted PDFDocuments by `"assetIndex|layoutColorSpace"`
- Lazy-loads `PDFDocumentColorConverter` class

#### Generator Refactoring

- Removed post-assembly `PDFDocumentColorConverter` call (the old single-pass conversion)
- Added `ManifestColorSpaceResolver` and `AssetPagePreConverter` imports
- Added `colorSpaces` to `TestFormManifest` typedef
- Updated workflow: resolve profiles → create pre-converter → assemble (with pre-conversion) → slugs → post-process
- `#assemblePages` now accepts `preConverter` parameter
- Embed-once pattern: each unique `(assetIndex, layoutColorSpace)` is converted once, embedded once via `embedPdf`, and reused via `drawPage` across all occurrences

### 2026-02-14 (session 4)

#### Batch Pre-Conversion with Page-Selective Converter

Replaced the single-page-extraction approach with a batch, in-place conversion architecture. All asset pages live in ONE `PDFDocument` — no more extracting individual pages into separate documents.

#### `PDFDocumentColorConverter` — Page-Selective Conversion

- Added `pages?: number[]` to `PDFDocumentColorConverterConfiguration` typedef
- `convertColor()` filters the page loop using a `Set` for O(1) lookup
- Pages not in the set are skipped entirely (no conversion, no diagnostics)
- Diagnostics `pageCount` reflects the filtered count, not total document pages

#### `AssetPagePreConverter` — Complete Rewrite

- **Old approach**: Extract each asset page into a separate single-page `PDFDocument`, convert individually, cache by `(assetIndex, layoutColorSpace)`
- **New approach**: Copy all needed asset pages into the target document, group by conversion chain, run one `PDFDocumentColorConverter` per chain
- New `convertAll(assetDocument, manifest, targetDocument, onProgress)` method replaces `convertAssetPage()`
- Returns `Map<string, number>` mapping `"assetIndex|layoutColorSpace"` to page index in target document

**Conversion chain grouping:**

| Chain Key | Description | `intermediateProfiles` |
|-----------|-------------|----------------------|
| `direct` | Asset colorSpace matches layout colorSpace | `[]` (empty) |
| `intermediate:sGray` | Asset needs sGray intermediate | `[sGrayProfile]` |
| `intermediate:Lab` | Asset needs Lab intermediate | `['Lab']` |
| passthrough | SepK/DeviceN assets | N/A (no conversion) |

**Processing order:** Passthrough pages first (no conversion needed), then chain groups sequentially. Each converter uses `useWorkers: true` for parallel pixel processing within its chain.

#### `TestFormPDFDocumentGenerator` — Assembly Rewrite

- `#assemblePages` now works in three phases:
  1. **Copy + Convert**: `preConverter.convertAll()` copies asset pages into assembled document and converts in-place
  2. **Assemble**: `embedPage` from same document creates Form XObjects, `drawPage` places them on output pages
  3. **Cleanup**: `removePage` in descending index order removes asset pages (Form XObjects survive because they retain references to content streams and resources independently of the page tree)
- Embedded page cache keyed by target page index (convert once, embed once, draw many)
- Progress reporting: 0–60% conversion, 60–95% assembly, 95–100% cleanup

### 2026-02-14 (session 5)

#### Shared PDFRawStream Fix in `AssetPagePreConverter`

**Root cause:** A single `copyPages` call with duplicate source page indices causes pdf-lib's internal `ObjectCopier` to cache and reuse target objects. When the same source page appears in multiple conversion chains (e.g., asset 3 for both `3|sRGB` and `3|sGray`), the copies share the SAME `PDFRawStream` objects. When one chain converts a stream in-place (`stream.contents = result.streamData` in `PDFPageColorConverter.#applyImageResult`), the other chain sees already-converted data instead of the original.

**Fix:** Split the single `copyPages` call into per-chain-group calls via a `copyBatch` helper function. Each chain group gets a separate `copyPages` invocation, producing truly independent object graphs:

- Passthrough pages (SepK) copied first in one batch
- Each conversion chain group copied separately
- Each batch calls `targetDocument.copyPages(assetDocument, indices)` independently
- Fixed `allTuples.length` → `allTupleCount` (computed from groups + passthrough)

#### Memory Optimization: Shared Profile Broadcasting

Addressed 30+ GB memory spikes caused by structured cloning of large ICC profile `ArrayBuffer`s (1–5 MB each) for every worker task.

**Three-component solution:**

1. **`WorkerPool.broadcastSharedProfiles()`** (`worker-pool.js`): Sends shared config (destination profile, intermediate profiles, rendering intent, BPC flags) to all workers once via `postMessage`. New `hasSharedProfiles` getter tracks broadcast state.

2. **`PDFDocumentColorConverter.#initialize()`** (`pdf-document-color-converter.js`): Calls `workerPool.broadcastSharedProfiles()` after pool setup, sending profiles before any task dispatch.

3. **`PDFPageColorConverter.#convertImages()`** (`pdf-page-color-converter.js`): Strips `destinationProfile` and `intermediateProfiles` from per-task messages when `workerPool.hasSharedProfiles` is true. Workers fall back to broadcasted values.

4. **`worker-pool-entrypoint.js`**: Module-level `sharedConfig` variable caches broadcasted profiles. Both `processImage()` and `processContentStream()` use `task.field ?? sharedConfig?.field` fallback pattern for profile fields.

#### Prior Session Fixes Confirmed Working

The following fixes from the prior compacted session were confirmed working independently via the verification matrix (`generate-verification-matrix-baseline.mjs` with `2026-02-12-REFACTOR-FIXTURES-EXTENDED-8-BIT.json`):

- **Intents array → single integer** (`color-converter.js`): `createMultiprofileTransform` receives `intent` directly instead of `new Array(n).fill(intent)` which WASM coerced to NaN → 0 (Perceptual)
- **Indexed image multiprofile bypass** (`pdf-image-color-converter.js`): `#convertIndexedImage()` now uses `this.convertColorsBuffer()` (respects `intermediateProfiles` + policy) instead of legacy `colorEngineService.convertColors()`
- **Config propagation in derive methods** (`pdf-page-color-converter.js`, `pdf-document-color-converter.js`): `intermediateProfiles`, `outputBitsPerComponent`, `outputEndianness` explicitly listed in `derivePageConfiguration()`, `deriveImageConfiguration()`, and `deriveContentStreamConfiguration()`
- **Progress UI** (`test-form-generator-app-element.js`): Stage-based progress with overall percentage, elapsed time, and sub-stage details

### 2026-02-15 (session 6)

#### Hardcoded Pako Path Removal (Baseline Classes)

Removed hardcoded `../../packages/pako/dist/pako.mjs` fallback from baseline classes. Pako is now resolved via `import.meta.resolve()` in the main thread (`CompositeColorConverter`) and passed as a resolved URL through the configuration chain:

- `CompositeColorConverter` → resolves `pakoPackageEntrypoint` via `import.meta.resolve()`
- `WorkerPool` → accepts and stores `pakoPackageEntrypoint`, passes to `workerData`
- `worker-pool-entrypoint.js` → uses `workerConfig?.pakoPackageEntrypoint ?? 'pako'`
- `PDFImageColorConverter` → uses `configuration.pakoPackageEntrypoint`
- `PDFDocumentColorConverter` / `PDFPageColorConverter` → propagate through `derivePageConfiguration()` / `deriveImageConfiguration()`

No try/catch — if resolution or import fails, the error propagates so the cause is visible.

#### Staging Sync Tools

Created two tools for safe deployment to `conres.io-staging`:

1. **`sync-generator-to-staging.mjs`** — Copies files with parent-commit protection (PROTECTED files are never auto-synced). Classifies operations as NEW, CHANGED, UNCHANGED, PROTECTED, or EXTRA.

2. **`trace-dependencies.mjs`** — Traces runtime dependency graph via `tsc --explainFiles`. Key features:
   - `--runtime-only` — Strips comments from source files and removes edges where the import specifier only appears in JSDoc comments (type-only imports)
   - `--workspaceRoot=PATH` — Compare dependency graphs between repos
   - `--tree` — Top-down hierarchy from entry points with cycle detection

#### Dependency Analysis Results

Runtime dependency trace from `generator/generator.js` (with `--runtime-only`): 36 project files.

Key findings:
- `services/ColorEngineService.js` references from baseline classes are **type-only** (9 JSDoc `@type`/`@param` annotations across 6 files) — zero runtime effect
- The generator's only `services/` dependencies are `PDFService`, `ICCService`, `GhostscriptService` — all PROTECTED (already in staging)
- The `packages/` group contains 518 files across all versioned color-engine directories — none referenced by the generator (it uses the `color-engine` symlink)

#### Staging Sync Execution

Cross-referenced dependency trace with sync dry-run. Synced 20 files across 3 groups:

| Group | Files Synced | Notes |
|-------|-------------|-------|
| `generator` | 5 | 1 NEW (`assets.json`), 4 CHANGED |
| `assets` | 8 | All NEW (F9e asset PDFs, manifests). Symlink skipped (real folder already in staging) |
| `classes` | 7 | All CHANGED (6 baseline + 1 non-baseline `color-conversion-policy.js`) |

Groups deliberately skipped:
- `packages` — All 3 runtime dependencies (`color-engine`, `pako`, `ghostscript-wasm`) already present in staging with identical content
- `services` — All 3 imported services are PROTECTED (in parent commit)

#### Documentation

Created `STAGING.md` at workspace root with complete instructions for the staging sync workflow, including tool usage, standard procedure, and which groups to sync.

### 2026-02-16 (session 10)

#### Fixed `bytesAsString` Content Stream Encoding Regression

**Root cause:** `TextDecoder('latin1')` uses Windows-1252 per the WHATWG Encoding Standard, NOT ISO 8859-1. The label `"latin1"` (along with `"iso-8859-1"`, `"ascii"`, and all related aliases) maps to the Windows-1252 codec in every browser and Node.js. There is no `TextDecoder` label that provides true ISO 8859-1.

**Impact:** Windows-1252 remaps 27 of 32 bytes in 0x80–0x9F to Unicode codepoints above U+00FF. The `charCodeAt()` round-trip then truncates them when stored in a `Uint8Array` (only the lowest 8 bits are kept). Affected characters include curly quotes (0x91–0x94), em/en dashes (0x96–0x97), bullet (0x95), euro sign (0x80), and trademark (0x99).

**Symptom:** "St. Paul's Cathedral" → "St. Paul s Cathedral" — byte 0x92 (right single quotation mark in WinAnsiEncoding) was decoded as U+2019, then re-encoded as 0x19 (truncation of 8217 & 0xFF). Acrobat reports missing glyphs for the corrupted byte.

**Introduced in:** Session 4 (2026-02-15), when pdf-lib's O(n^2) `arrayAsString` was replaced with `TextDecoder('latin1').decode(bytes)` for memory optimization.

**Fix:** Replaced `TextDecoder('latin1').decode(bytes)` with chunked `String.fromCharCode.apply(null, bytes.subarray(...))` in `services/helpers/pdf-lib.js`. `String.fromCharCode(byte)` performs the true ISO 8859-1 identity mapping (byte N → U+00NN). Chunked in 8192-byte batches to stay within engine argument-count limits. Still O(n), zero intermediate string allocations per chunk. Old code commented out with full explanation.

**Files changed:** `services/helpers/pdf-lib.js` — `bytesAsString()` function.
