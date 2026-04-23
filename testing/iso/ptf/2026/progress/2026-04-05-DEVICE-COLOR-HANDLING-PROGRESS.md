# Device Color Handling for PDF/X-4 RGB and Gray Output Intents

**Last Updated:** 2026-04-22
**Status:** RGB output intent Device color handling complete (A, D, E, F, H, M, N, P, R) — pending CMYK output intent DeviceRGB handling, B (worker payload), C (resolver helper), I/J (audits), K (tests)
**Branch:** `test-form-generator/2026/dev`

---

## Landing Plan (2026-04-16)

Investigation triggered by regressions observed in RGB-output-intent generation:

- **Regression A**: `image-color-converter.js:267` throws "Source ICC profile is required for RGB conversion" when converter encounters a `DeviceRGB` image (no embedded profile, no fallback wired)
- **Regression B**: RGB docket PDF fails Acrobat preflight RUL83 (DeviceGray) and RUL101 (DeviceCMYK) — docket never color-converted, and content-stream converter ignores Device operators even when `convertDevice*` flags are set
- **Regression C**: Full asset RGB output PDF fails same preflight rules — `assembly-policy.json` RGB category does not include `CMYK`, so `DeviceCMYK` images are filtered out before conversion

### What is actually implemented vs. what is not

| Area | Status | Evidence |
| --- | --- | --- |
| `sourcePDFColorSpace` tracking, sentinel removal | ✅ Done | Sentinels gone from `#getImageColorSpaceInfo`; names use PDF color space identifiers |
| `#isColorSpaceIncluded` configuration-driven filter | ✅ Done | Shorthand resolution works for `RGB`/`Gray`/`CMYK`/`Lab` |
| `defaultSourceProfileForDevice*` typedef + config plumbing | ✅ Done | Fields flow generator → document converter → page converter |
| `defaultSourceProfileForDevice*` **consumption** in `#getImageColorSpaceInfo` | ❌ Missing | Device branches return no `sourceProfile` field; Audit Issue 2 |
| Content stream Device operator conversion (`setGray`/`setRGB`/`setCMYK`) | ❌ Missing | `flush()` filters `operation === 'setColor'` only; Device ops counted then passed through |
| PostScript math path for `null` source profile | ❌ Missing | Section 9 marked "Not addressed in plan"; zero code exists |
| Resolver policy consumption (`preferOutputIntent`, `preferEmbeded`, `preferGracefulFallback`) | ❌ Missing | `resolveDefaultSourceProfile()` reads path field only |
| Assembly policy RGB category includes `CMYK` | ❌ Missing | Current: `["RGB","Gray","Lab"]` |
| Docket color conversion for non-CMYK output intents | ❌ Missing | Docket only goes through `decalibrateColorInPDFDocument` + `replaceTransparencyBlendingSpace` |
| Worker task fields for `defaultSourceProfileForDevice*` | ❌ Missing | Not in `ImageTask`/`ContentStreamTask` typedefs |
| Audit Issue 3 — `outputChannels` hardcoded 3 for Gray | ❌ Missing | `pdf-content-stream-color-converter.js:493` |
| Audit Issue 4 — `renderingIntent` default in separate-chains | ❌ Missing | `test-form-pdf-document-generator.js:953` |
| E5 (CMYK OI) and E6 (RGB OI) end-to-end tests | ❌ Missing | No generator integration tests |

### Semantic reconciliation (from user history instructions)

At the **converter** layer:

| Value | Semantics |
| --- | --- |
| `ArrayBuffer` | Invoke non-PDF super class with this ICC profile (ICC transform) |
| `null` | Use traditional PostScript math within PDF conversion classes (super class not invoked) |
| `undefined` | Skip conversion for this Device color space (super class not invoked) |

At the **generator resolver** layer (produces the above from the manifest):

| Manifest value | Policy | Resolver output |
| --- | --- | --- |
| Path string | — | `ArrayBuffer` (fetched from path) |
| `null` | `preferOutputIntent: true` + output intent color space matches Device type | Output intent `ArrayBuffer` |
| `null` | `preferEmbeded: true` + embedded profile available | Embedded `ArrayBuffer` |
| `null` | `preferGracefulFallback: true` + settings.json default exists | Settings.json `ArrayBuffer` |
| `null` | All policies false or no matching profile | `null` (→ PostScript math) |
| absent | — | `undefined` (→ skip conversion) |

### F10a manifest specifics

Manifest sets `defaultSourceProfileForDevice{RGB,CMYK,Gray}: null` with `preferOutputIntent: true`, `preferEmbeded: false`, `preferGracefulFallback: false`.

| Device type | Output intent = RGB | Output intent = CMYK | Output intent = Gray |
| --- | --- | --- | --- |
| `DeviceRGB` | OI color space matches → resolver returns OI ICC → ICC transform (identity-ish) | OI mismatches → PostScript math (RGB→CMYK: throw, black generation unspecified) | OI mismatches → PostScript math (RGB→Gray: luminance) |
| `DeviceCMYK` | OI mismatches → PostScript math (CMYK→RGB: `1 − min(1, C+K)` …) | OI matches → ICC transform (identity-ish) | OI mismatches → PostScript math (CMYK→Gray) |
| `DeviceGray` | OI mismatches → PostScript math (Gray→RGB: R=G=B=g) | OI mismatches → PostScript math (Gray→CMYK: K=1-g) — but PDF/X-4 permits DeviceGray passthrough in CMYK OI, so actually **skip** | OI matches → no conversion needed |

### GhostScript-generated PDFs (docket + slugs) per-OI policy

Docket and slug PDFs both originate from GhostScript and carry Device* content. They must go through the **same** `PDFDocumentColorConverter` pipeline as asset pages — no duplicated or bespoke conversion paths. The composition points (E + F) and `resolveDeviceSourceProfile()` handle them identically to assets.

| GhostScript output | Content | Output intent RGB | Output intent CMYK | Output intent Gray |
| --- | --- | --- | --- | --- |
| Docket | DeviceCMYK text/checkboxes/radio (0/0/0/1), DeviceGray backgrounds | **Convert** (CMYK/Gray → RGB via resolver) | Skip (PDF/X-4 permits DeviceGray in CMYK; DeviceCMYK already compatible) | Skip (DeviceGray already compatible) |
| Slug PDFs | DeviceGray 0.94922 fill, 0.5 frame, 0 labels/QR | **Convert** (Gray → RGB via resolver) | Skip | Skip |

No separate pipeline, no separate dispatcher. Docket and slugs enter the same `convertColor` call surface that asset pages use.

### Clarifications (2026-04-16, revised)

- **Assembly policy is about layouts, not conversion.** `assembly-policy.json` now uses `includedLayoutColorSpaceTypes` / `excludedLayoutColorSpaceTypes` (renamed from `includedColorSpaceTypes`). It gates which **layouts** appear in the assembled PDF, not which color spaces get color-converted. Conversion inclusion is handled elsewhere by per-image/stream PDF color space inspection.
- **One new class, not inline math.** PostScript math lives in a new `TraditionalPostScriptColorConverter` class (sibling to `ColorConverter`), PDF-agnostic, Float32 internally, reusing existing bit-depth/endianness helpers from `color-conversion-policy.js`. The two PDF converter classes compose it. No inline formulas anywhere else.
- **Single resolver, one place.** `resolveDeviceSourceProfile()` is a pure function encoding the conjunction once. Used by both composition points.
- **Worker delegation preserved.** `PDFImageColorConverter` / `PDFContentStreamColorConverter` are dynamically imported in the worker entrypoint. `TraditionalPostScriptColorConverter` is loaded transitively inside the worker isolate via those classes' own imports — never instantiated directly by `worker-pool-entrypoint.js`. Decision + math both execute in the worker.

### The conjunction encoded in `resolveDeviceSourceProfile()`

Condition: flattened settings do NOT resolve to an explicit source profile when ALL of the following hold for a given `X ∈ {RGB, CMYK, Gray}`:

- `defaultSourceProfileForDevice<X> === null`, AND
- `preferOutputIntent !== true` OR output intent color space type ≠ `X`, AND
- `preferEmbeded !== true` OR embedded profiles with color space type `X` (uncompressed bytes) count ≠ 1, AND
- `preferGracefullFallback !== true` OR `X` ∉ `{RGB, Gray}`.

Resolver return values:

- `ArrayBuffer` → route to non-PDF super class for ICC conversion
- `null` → route to `TraditionalPostScriptColorConverter` (when the conjunction's graceful-fallback branch permits; otherwise resolver throws)
- `undefined` → skip (no Device setting configured)

### Composition and delegation (ACU)

| Layer | Role | Thread |
| --- | --- | --- |
| `resolveDeviceSourceProfile()` (new, pure) | Encode conjunction once | Called inside worker |
| `TraditionalPostScriptColorConverter` (new) | Float32 PS math; operates on buffers AND tuples | Worker isolate (transitively loaded) |
| `PDFImageColorConverter.convertPDFImageColor` | Decision point before `super.convertColor`: ICC super OR composed TPS | Worker |
| `PDFContentStreamColorConverter` Device operator handling | Decision point per `k/K`, `rg/RG`, `g/G`: ICC lookup table OR TPS tuple convert | Worker |

### Worker task payload additions (required so workers decide autonomously)

Shared profile fields broadcast via existing `broadcastSharedProfiles` mechanism (not duplicated per-task):

| Field on ImageTask / ContentStreamTask | Purpose |
| --- | --- |
| `pdfColorSpaceType` | Preserves Device* vs ICCBased* distinction (currently lost at `typeToColorSpace` mapping) |
| `defaultSourceProfileForDeviceRGB/CMYK/Gray` | `ArrayBuffer \| null \| undefined` |
| `defaultSourceProfileForDeviceRGB/CMYK/GrayPolicy` | `{ preferOutputIntent, preferEmbeded, preferGracefullFallback }` |
| `outputIntentColorSpaceType` | `'RGB' \| 'CMYK' \| 'Gray'` from ICC header |
| `embeddedProfileInventory` | Count (or refs) of embedded ICC profiles grouped by color space type |

### Work blocks (dependency-ordered) — revised 2026-04-16

| ID | Block | Primary Files | Depends On | Status |
| --- | --- | --- | --- | --- |
| A | Forward `pdfColorSpaceType` through imageInput + worker task | `pdf-document-color-converter.js`, `pdf-page-color-converter.js`, `pdf-image-color-converter.js` | — | ✅ Done |
| B | Worker task payload additions (profiles, policies, OI type, embedded inventory) | `worker-pool.js`, `worker-pool-entrypoint.js`, `pdf-image-color-converter.js` | A | ⏳ Pending |
| C | `resolveDeviceSourceProfile()` helper (pure function) | `classes/baseline/device-source-profile-resolver.js` (new) | — | ⏳ Pending |
| D | `TraditionalPostScriptColorConverter` class (Float32, PDF-agnostic) | `classes/baseline/traditional-postscript-color-converter.js` (new) | — | ✅ Done |
| E | `PDFImageColorConverter` composition point (8/16-bit Device images) | `pdf-image-color-converter.js` | A, D | ✅ Done |
| F | `PDFContentStreamColorConverter` composition point (Device operator tuples) | `pdf-content-stream-color-converter.js` | A, D | ✅ Done |
| H | Route docket AND slugs through unified conversion pipeline (no duplicated paths) | `generator/classes/test-form-pdf-document-generator.js` | E, F | ✅ Done |
| I | Audit Issue 3 — `outputChannels` for Gray output | `pdf-content-stream-color-converter.js:493` | — | ⏳ Pending |
| J | Audit Issue 4 — separate-chains `renderingIntent` | `test-form-pdf-document-generator.js:953` | — | ⏳ Pending |
| K | Tests: TPS unit + resolver + E5/E6 end-to-end | `tests/classes/`, `tests/generator/` | C, D, E, F | ⏳ Pending |
| L | Progress doc final refresh | this file | all prior | 🟡 In Progress |
| P | Override PDF-default DeviceGray state for RGB OI via `pdfX4CompliantOutput` + page prologue | `pdf-content-stream-color-converter.js`, `test-form-pdf-document-generator.js`, full chain | F | ✅ Done (2026-04-22) |
| R | Fix silent error swallowing + deflate format detection in streaming converter | `pdf-content-stream-color-converter.js`, `pdf-page-color-converter.js` | — | ✅ Done (2026-04-22) |
| S | Fix worker buffer transfer detachment (stream contents zeroed by transferable) | `pdf-page-color-converter.js` | — | ✅ Done (2026-04-22) |
| T | CMYK output intent: convert DeviceRGB images and content streams | Same chain as P, TPS `RGB → CMYK` (Block M) | P | ✅ Done (2026-04-22) |
| U | Gray output intent support | Full chain | T | ⏳ Pending |

### Scope decisions

- `DeviceRGB → DeviceCMYK` PostScript math: **throw** (black generation unspecified; not needed for F10a RGB output intent case).
- `preferEmbeded`: disabled in current F10a manifest — implement the gate, defer embedded-profile scan until manifest re-enables it.
- `preferGracefullFallback: false` (current F10a): when no policy resolves a profile, resolver returns `null` and PDF converter routes to `TraditionalPostScriptColorConverter` ONLY for RGB or Gray; throws otherwise (CMYK graceful fallback is not defined).
- Worker isolation: no Device math runs on main thread — all decision + execution happens in worker.

### Out of scope for this document

- Profile-loss regression investigation (separate effort; not tracked here).

---

## Background

PDF/X-4 conformance for CMYK output intents permits `DeviceCMYK` and `DeviceGray` color in content streams and images. However, for RGB output intents, only `DeviceRGB` and `DeviceGray` are permitted. For Gray output intents, only `DeviceGray` is permitted.

The 2026/generator currently supports CMYK and RGB output intents, with planned support for Gray output intents. The current implementation has a hardcoded CMYK exclusion filter (`pdf-document-color-converter.js:559`) and treats all `Device*` colors in content streams as pass-through (`pdf-content-stream-color-converter.js:296-300`). This is insufficient for RGB output intents where `DeviceCMYK` and `DeviceGray` elements must be converted to `DeviceRGB`.

### Current Asset Color Expectations

| Source         | Color Definitions                                                                      | Intent                |
| -------------- | -------------------------------------------------------------------------------------- | --------------------- |
| **Asset PDFs** | Frames, labels, PDF417 codes as `DeviceCMYK=0/0/0/1.0`                                 | K-only black for CMYK |
| **Slugs**      | Light gray fill `DeviceGray=0.94922`, frame `DeviceGray=0.5`, labels/QR `DeviceGray=0` | K-only black/gray     |
| **Dockets**    | Texts, radio buttons, checkboxes as `DeviceCMYK=0/0/0/1.0`                             | K-only black for CMYK |

These Device color usages are intentional for CMYK output intents (K-only black printing). For RGB output intents, they must be converted to `DeviceRGB` equivalents. For Gray output intents, `DeviceCMYK` elements must be converted to `DeviceGray`.

### Ghostscript Precedent

Ghostscript provides relevant options that inform this design:

- **`-dDeviceGrayToK=true/false`** — Controls whether `DeviceGray` maps to pure K in CMYK output (default: true). Uses `gray_to_k.icc` profile. Setting to `false` maps via the `DefaultGrayProfile` to the output device profile instead.
- **`-dUseFastColor=true/false`** — Bypasses ICC color management for `DeviceGray`, `DeviceRGB`, and `DeviceCMYK` source colors, using traditional PostScript 255-minus math for RGB/CMYK conversion with black generation and undercolor removal.

---

## Specification

### 1. Default Source Profiles for Device Color Spaces

The same field name `defaultSourceProfileForDeviceRGB` (and `…CMYK`, `…Gray`) is used consistently across all layers — from JSON configuration files to JavaScript options bags. This is intentional: one name, one meaning, no ambiguity.

**Where each field lives:**

| Layer             | File/Type                                                                       | Field                              | Value Type                             |
| ----------------- | ------------------------------------------------------------------------------- | ---------------------------------- | -------------------------------------- |
| **Manifest JSON** | `manifest.json` → `settings.colorManagement`                                    | `defaultSourceProfileForDeviceRGB` | `string` (relative path) or `null`     |
| **Settings JSON** | `settings.json` → `@conres.io/test-form-generator > settings > colorManagement` | `defaultSourceProfileForDeviceRGB` | `string` (relative path) or `null`     |
| **Generator**     | `AssetPagePreConverter` → resolved before passing to converter                  | `defaultSourceProfileForDeviceRGB` | `ArrayBuffer` or `null` or `undefined` |
| **PDF converter** | `PDFDocumentColorConverterConfiguration` (options bag)                          | `defaultSourceProfileForDeviceRGB` | `ArrayBuffer` or `null` or `undefined` |

The same pattern applies for `defaultSourceProfileForDeviceCMYK` and `defaultSourceProfileForDeviceGray`.

**Semantics:**

| Setting                             | Purpose                                                                 |
| ----------------------------------- | ----------------------------------------------------------------------- |
| `defaultSourceProfileForDeviceRGB`  | ICC profile assumed for `DeviceRGB` when treating it as `ICCBasedRGB`   |
| `defaultSourceProfileForDeviceCMYK` | ICC profile assumed for `DeviceCMYK` when treating it as `ICCBasedCMYK` |
| `defaultSourceProfileForDeviceGray` | ICC profile assumed for `DeviceGray` when treating it as `ICCBasedGray` |

**Value semantics at the converter configuration level:**

- `ArrayBuffer` — Use this ICC profile as the source profile for the corresponding Device color space; invoke the non-PDF super class for ICC color conversion
- `null` — Explicitly "no profile"; use traditional PostScript math for conversion (the non-PDF super class is not invoked)
- `undefined` — Not configured; skip conversion for that Device color space (the non-PDF super class is not invoked)

**Resolution at the generator level (JSON `string` → converter `ArrayBuffer` | `null` | `undefined`):**

- JSON value is a relative path (e.g., `"./resources/profiles/sGray.icc"`) → resolve relative to the JSON file, fetch, return `ArrayBuffer`
- JSON value is `null` → pass through as `null`
- JSON field is absent → pass through as `undefined`

**Policy fields** (`defaultSourceProfileForDeviceRGBPolicy`, etc.) contain `preferOutputIntent`, `preferEmbeded`, and `preferGracefulFallback` booleans that modify the resolution behavior. These are consumed by the generator layer during resolution, not by the converter.

### 2. Granular `includedLayoutColorSpaceTypes` and `excludedLayoutColorSpaceTypes`

Expand the assembly policy and PDF color conversion classes to support granular color space type values:

| Value          | Matches                              | Notes                                           |
| -------------- | ------------------------------------ | ----------------------------------------------- |
| `RGB`          | Both `DeviceRGB` and `ICCBasedRGB`   | Shorthand unless either is explicitly specified |
| `CMYK`         | Both `DeviceCMYK` and `ICCBasedCMYK` | Shorthand unless either is explicitly specified |
| `Gray`         | Both `DeviceGray` and `ICCBasedGray` | Shorthand unless either is explicitly specified |
| `DeviceRGB`    | Only `DeviceRGB`                     | Explicit Device-only                            |
| `DeviceCMYK`   | Only `DeviceCMYK`                    | Explicit Device-only                            |
| `DeviceGray`   | Only `DeviceGray`                    | Explicit Device-only                            |
| `ICCBasedRGB`  | Only `ICCBasedRGB`                   | Explicit ICCBasedonly                           |
| `ICCBasedCMYK` | Only `ICCBasedCMYK`                  | Explicit ICCBasedonly                           |
| `ICCBasedGray` | Only `ICCBasedGray`                  | Explicit ICCBasedonly                           |
| `Lab`          | Lab color spaces                     | Unchanged                                       |
| `DeviceN`      | Only `/DeviceN` operator             | Currently unsupported — warn if specified       |

**Resolution logic for shorthand vs explicit:**

- `RGB` in `includedLayoutColorSpaceTypes` includes both `DeviceRGB` and `ICCBasedRGB` **unless** either `DeviceRGB` or `ICCBasedRGB` is also explicitly present in `excludedLayoutColorSpaceTypes`
- `DeviceRGB` in `excludedLayoutColorSpaceTypes` excludes only `DeviceRGB` even if `RGB` is in `includedLayoutColorSpaceTypes`
- If both `RGB` (shorthand) and `DeviceRGB` (explicit) appear in `includedLayoutColorSpaceTypes`, `DeviceRGB` takes no additional effect (already covered by `RGB`)
- If both `RGB` (shorthand) and `DeviceRGB` (explicit) appear in `excludedLayoutColorSpaceTypes`, same principle applies

### 3. Device Color Conversion Behavior

When a `Device*` color space is included for conversion, the PDF converter class decides the conversion method based on `defaultSourceProfileForDevice*`:

1. **If `defaultSourceProfileForDevice*` is `ArrayBuffer`** — Treat the `Device*` color as `ICCBased*` using the specified profile; invoke non-PDF super class for ICC color conversion
2. **If `defaultSourceProfileForDevice*` is `null`** — Use traditional PostScript math for conversion; non-PDF super class is not invoked
3. **If `defaultSourceProfileForDevice*` is `undefined`** — Skip conversion for that `Device*` color space; non-PDF super class is not invoked (current behavior)

### 4. `DeviceN` Warning

`DeviceN` is distinct from `DeviceRGB`, `DeviceCMYK`, and `DeviceGray`. Specifying `DeviceN` in either `includedLayoutColorSpaceTypes` or `excludedLayoutColorSpaceTypes` must not affect the handling of `DeviceRGB`, `DeviceCMYK`, or `DeviceGray`. If `DeviceN` is specified and is not supported (which is the current state), a warning must be emitted.

---

## Roadmap

Each task addresses specific violations of the separation of concerns between PDF conversion classes and their non-PDF super classes. See `2026-04-06-DECISION-FLOW-ANALYSIS.md` for the full violation analysis.

- [x] **Task 1: Assess architecture and identify violations**
  - Mapped all decision points across both pipelines
  - Identified 6 violations of the PDF/non-PDF layer separation
  - Documented required decision flow

- [ ] **Prerequisite: Testing plan** — see `2026-04-06-TESTING-PROGRESS.md`
  - R1-R4, R7, R8 regression tests must pass before starting Task 2
  - E5 end-to-end (CMYK output intent) must pass before starting Task 5
  - E6 end-to-end (RGB output intent) marked `todo` until Task 8

- [ ] **Prerequisite: Content stream parser refactor** — see `2026-04-06-CONTENT-STREAM-MARKUP-REFACTOR-PROGRESS.md`
  - Eliminates 4-file `COLOR_OPERATOR_REGEX` duplication
  - Renames `type: 'indexed'` → `type: 'setColor'` (resolves naming collision with PDF Indexed color space before Task 2 introduces `sourcePDFColorSpace` `switch` blocks with `case 'Indexed':`)
  - Provides clean event types for Task 4 `switch` blocks: `'deviceGray'`, `'deviceRGB'`, `'deviceCMYK'`, `'setColorSpace'`, `'setColor'`

- [ ] **Task 2: Fix PDF layer — track `sourcePDFColorSpace` properly** (Violations V1, V2, V3)
  - Remove `COLOR_SPACE_TYPES` mapping — PDF classes must track `sourcePDFColorSpace` using PDF color space names (`DeviceRGB`, `ICCBasedRGB`, etc.), not mapped `'RGB'`/`'CMYK'`/`'Gray'`
  - Remove `sourceProfile: 'sRGB'`/`'sGray'` sentinels from `#getImageColorSpaceInfo` — Device color spaces have no profile; `sourceProfile` must be `undefined`
  - Replace `#normalizeColorSpaceType` — return proper PDF color space names (`ICCBasedRGB`, `DeviceGray`, etc.) not legacy profile sentinel strings
  - Update `PDFContentStreamColorConverter` type discriminator comparisons to use PDF color space names
  - The mapping from PDF color space names to non-PDF color models (`'RGB'`, `'CMYK'`, `'Gray'`, `'Lab'`) happens only at the call boundary when the PDF layer invokes the super class
  - All `switch` blocks on `sourcePDFColorSpace` must be exhaustive:
    - Supported: `DeviceRGB`, `DeviceCMYK`, `DeviceGray`, `ICCBasedRGB`, `ICCBasedCMYK`, `ICCBasedGray`, `Lab`, `Indexed`
    - Recognized unsupported (explicit `break` with warning): `Separation`, `DeviceN`, `CalGray`, `CalRGB`, `Pattern`
    - `default`: `throw` — unknown color spaces must not be silently skipped
  - Update tests

- [ ] **Task 3: Fix PDF layer — configurable filtering** (Violation V4)
  - Add `includedLayoutColorSpaceTypes`/`excludedLayoutColorSpaceTypes` to `PDFDocumentColorConverterConfiguration`
  - Replace hardcoded `!type.includes('CMYK')` filter in `#collectPageData` with configuration-driven filtering using `sourcePDFColorSpace`
  - The assembly policy provides these values per profile category; the generator passes them through

- [ ] **Task 4: Fix PDF layer — conversion method selection** (Violation V5)
  - Add `defaultSourceProfileForDeviceRGB`, `defaultSourceProfileForDeviceCMYK`, `defaultSourceProfileForDeviceGray` to PDF converter configuration (these are PDF-layer settings — the non-PDF super classes never see them)
  - PDF layer decides per element based on `sourcePDFColorSpace` + `destinationPDFColorSpace` + `defaultSourceProfileForDevice*`:
    - ICCBased with embedded profile → invoke super class with `sourceProfile: ArrayBuffer`
    - Device with `defaultSourceProfile` `ArrayBuffer` → invoke super class with `sourceProfile: ArrayBuffer`
    - Device with `defaultSourceProfile` `null` → PostScript math in PDF layer (super class not invoked)
    - Device with `defaultSourceProfile` `undefined` → skip (super class not invoked)
    - `sourcePDFColorSpace == destinationPDFColorSpace` → identity (super class not invoked)
  - Content stream converter: route `type='cmyk'` operations through the same decision logic instead of silently dropping them
  - Content stream converter: route `type='rgb'` and `type='gray'` operations through the same decision logic instead of unconditionally skipping

- [ ] **Task 5: Fix generator layer — wire manifest settings** (Violation V6)
  - Read `manifest.settings.colorManagement` in generator
  - Resolve `defaultSourceProfileForDevice*` settings (null, path → ArrayBuffer, or undefined)
  - Resolve `*Policy` settings (preferOutputIntent, preferEmbeded, preferGracefulFallback)
  - Pass resolved `defaultSourceProfileForDevice*` and `includedLayoutColorSpaceTypes`/`excludedLayoutColorSpaceTypes` to `PDFDocumentColorConverter` construction in `AssetPagePreConverter`

- [ ] **Task 6: Update assembly policy configuration**
  - Update `assembly-policy.json` profile categories to include `DeviceCMYK`/`DeviceGray` in `includedLayoutColorSpaceTypes` for RGB output intents
  - Update Gray profile category similarly
  - Verify CMYK categories remain correct
  - `DeviceN` in include/exclude must warn if unsupported

- [ ] **Task 7: Propagation through worker pipeline**
  - Propagate `defaultSourceProfileForDevice*` through `WorkerPool`, `StreamTransformWorker`, and `WorkerPoolEntrypoint`
  - Workers receive resolved profiles — they do not make policy decisions

- [ ] **Task 8: Testing**
  - Test RGB output intent with DeviceCMYK and DeviceGray source elements
  - Test CMYK output intent preserves current behavior
  - Test `null` vs `undefined` vs `ArrayBuffer` defaultSourceProfile semantics
  - Test that super class `#openProfile` never receives a non-`ArrayBuffer`/non-`'Lab'` value
  - Test PostScript math conversion paths (Device with null profile)
  - Test identity pass-through (same source and destination PDF color space)

---

## Testing Protocol

Every task follows this protocol. No exceptions.

1. **Assess existing tests** — identify whether current tests cover the code being changed; document gaps
2. **Add missing regression tests** — before any code changes, add tests that lock in current behavior
3. **Run tests to establish baseline** — all tests must pass (or be explicitly marked skipped with justification)
4. **Make changes**
5. **Run tests** — verify no regressions
6. **If regressions** — fix and repeat from step 5 until clean
7. **Add new tests** for the final changes made

### Initial Baseline (2026-04-06)

```
Tests: 335 total, 284 passed, 51 skipped, 0 failed
```

**Note:** `ProfileSelectionService` has no tests and is never instantiated in the codebase. The `settings.json` change from bare filenames to relative paths (`./resources/profiles/...`) has no effect on any existing code or tests.

---

## Notes on `settings.json` and `profileSearchLocations`

The `defaultSourceProfileForDevice*` values in `settings.json` were previously bare filenames (e.g., `"sGray.icc"`) resolved via `profileSearchLocations: ["tests/fixtures/profiles"]` by `ProfileSelectionService.#loadProfileFromSearchLocations`. They are now relative paths (e.g., `"./resources/profiles/sGray.icc"`), self-resolving relative to the JSON file.

`profileSearchLocations` is used **only** inside `ProfileSelectionService`, which is **never instantiated** in the codebase. `PDFService.convertColorInPDFDocument` receives `profileSelectionService = null` by default. This means the entire `ProfileSelectionService` + `profileSearchLocations` mechanism is dead code in the current pipeline.

The plan wires the manifest and settings `defaultSourceProfileForDevice*` values through the generator layer (Task 5) to the PDF conversion classes, bypassing the legacy `ProfileSelectionService` entirely. The resolution of relative paths to `ArrayBuffer` will happen in the generator layer, following the same pattern used by `ManifestColorSpaceResolver` for manifest color space profiles.

---

## Detailed Analysis

The original gap analysis has been superseded by the violation-anchored analysis. See `2026-04-06-DECISION-FLOW-ANALYSIS.md` for the complete decision flow trace, violation details, current-vs-required flow diagrams, and code-level references.

### 1. `PDFDocumentColorConverter.#collectPageData` (line 559)

**Current:** `if (colorSpaceInfo && !colorSpaceInfo.type.includes('CMYK'))` — hardcoded to skip all CMYK images (both `DeviceCMYK` and `ICCBasedCMYK`).

**Problem:** For RGB output intents, `DeviceCMYK` images must be converted. `ICCBasedCMYK` images should also be converted. This filter must become configurable using the resolved `includedLayoutColorSpaceTypes`/`excludedLayoutColorSpaceTypes`.

**No equivalent filter exists for content streams** — all content streams are collected unconditionally. The filtering happens later in `PDFContentStreamColorConverter.convertColor` (lines 296-313) where Device colors (`type === 'rgb'` or `type === 'gray'`) are separated from ICCBased/Lab colors. `type === 'cmyk'` operations are parsed but never included in either group — they are silently dropped from the conversion pipeline.

### 2. `PDFContentStreamColorConverter.convertColor` filtering (lines 296-313)

**Current filtering logic:**

- `deviceColors` = operations with `type === 'rgb'` or `type === 'gray'` (skipped with a log message)
- `toConvert` = operations with `type === 'indexed'` (i.e., named color spaces via `SC`/`sc`/`SCN`/`scn`) that resolve to `sGray`, `sRGB`, or `Lab`
- `type === 'cmyk'` operations are never added to either set — they are parsed by the regex but ignored

**Required changes:**

- When `DeviceRGB` is included for conversion and `defaultSourceProfileForDeviceRGB` is set, `type === 'rgb'` operations must move from `deviceColors` (skipped) to `toConvert`
- When `DeviceGray` is included for conversion and `defaultSourceProfileForDeviceGray` is set, `type === 'gray'` operations must move similarly
- When `DeviceCMYK` is included for conversion and `defaultSourceProfileForDeviceCMYK` is set, `type === 'cmyk'` operations must be added to `toConvert`
- The `buildLookupTable` and `applyLookupTable` paths must handle these Device color inputs with the appropriate source profile

### 3. `PDFDocumentColorConverter.COLOR_SPACE_TYPES` (line 1261)

**Current mapping:**

```javascript
{
    'DeviceRGB': 'RGB',
    'DeviceGray': 'Gray',
    'DeviceCMYK': 'CMYK',
    'ICCBasedRGB': 'RGB',
    'ICCBasedCMYK': 'CMYK',
    'ICCBasedGray': 'Gray',
    'Lab': 'Lab',
    'Indexed': 'Indexed',
}
```

This maps **both** Device and ICCBased types to the same shorthand. The new granular include/exclude logic needs access to the full type name (e.g., `DeviceCMYK` vs `ICCBasedCMYK`) not just the collapsed shorthand. This mapping is used throughout the converter — the resolution function must be able to test against both the full type and the shorthand.

### 4. `PDFDocumentColorConverter.#normalizeColorSpaceType` (line 707)

**Current:** Maps `Gray`/`DeviceGray` → `sGray`, `RGB`/`DeviceRGB` → `sRGB`, `CMYK`/`DeviceCMYK` → `CMYK`. This is used in `#extractColorSpaceDefinitions` for content stream named color spaces.

**Problem:** This normalization loses the distinction between Device and ICCBased color spaces for content stream color space definitions. For Device color conversion, the content stream converter needs to know whether a named color space resource is actually a Device alias or a real ICCBased profile.

### 5. Existing `sourceRGBProfile` and `sourceGrayProfile` vs new `defaultSourceProfileForDeviceRGB` and `defaultSourceProfileForDeviceGray`

**Current:** `sourceRGBProfile` and `sourceGrayProfile` are already propagated through the converter hierarchy (`PDFDocumentColorConverter` → `PDFPageColorConverter` → `PDFContentStreamColorConverter` → `LookupTableColorConverter` → `BufferRegistry`). They serve as fallback source profiles when an ICCBased color space in the PDF doesn't carry an embedded profile.

**Complication:** The proposed `defaultSourceProfileForDeviceRGB` and `defaultSourceProfileForDeviceGray` have a different semantic purpose — they specify what ICC profile to assume for **Device** color spaces (which by definition have no ICC profile). There are three options:

1. **Reuse existing fields** — Use `sourceRGBProfile` for both purposes (ICCBased fallback and Device color assumption). Simple but conflates two different concepts.
2. **Add new fields** — Add `defaultSourceProfileForDeviceRGB`, `defaultSourceProfileForDeviceCMYK`, `defaultSourceProfileForDeviceGray` as separate fields. Clean separation but adds propagation burden.
3. **Resolve at policy level** — The `ColorConversionPolicy` could resolve `defaultSourceProfileForDevice*` values and inject them into the converter configuration as `sourceRGBProfile`/`sourceGrayProfile`/`sourceCMYKProfile` when Device colors are included. This keeps the converter API surface smaller.

**Recommendation:** Option 2 (add new fields) is cleanest because:

- `sourceRGBProfile` already has a defined meaning ("fallback for ICCBasedRGB without embedded profile") and currently always receives `sRGB v4.icc`
- `defaultSourceProfileForDeviceRGB` has a different meaning ("treat DeviceRGB as if it had this profile")
- In practice, for the test form generator use case, `defaultSourceProfileForDeviceRGB` would likely also be `sRGB v4.icc`, but the semantic distinction matters for future flexibility
- A `sourceCMYKProfile` does not currently exist and would be needed; conflating it with `defaultSourceProfileForDeviceCMYK` would create confusion

### 6. Assembly policy `includedLayoutColorSpaceTypes` current values

**Current assembly policy values:**

| Category    | `includedLayoutColorSpaceTypes`           | `excludedLayoutColorSpaceTypes` |
| ----------- | ----------------------------------- | ------------------------- |
| Gray        | `["Gray", "Lab"]`                   | `["DeviceN"]`             |
| RGB         | `["RGB", "Gray", "Lab"]`            | `["DeviceN"]`             |
| CMYK-MaxGCR | `["RGB", "Gray", "Lab", "DeviceN"]` | `[]`                      |
| CMYK        | `["RGB", "Gray", "Lab", "DeviceN"]` | `[]`                      |

**Observation:** The current shorthand values (`RGB`, `Gray`, `CMYK`, `Lab`) are used at two levels with different semantics:

- In `assembly-policy.json`: filter manifest layouts by color space **type** (which color space test targets to include in the generated PDF)
- In the color conversion pipeline: filter which color spaces in the PDF to **convert**

These two filtering operations are fundamentally different:

- **Manifest filtering** asks: "Which test target color spaces should appear in the output PDF?"
- **Conversion filtering** asks: "Which color spaces in the source PDF should be color-converted?"

Currently, the assembly policy values only feed into manifest filtering (via `AssemblyPolicyResolver.#filterManifestByColorSpaceType`). The conversion pipeline has its own hardcoded logic. The plan proposes using the same value space for both, but they will need separate configuration paths or a clear mapping between them.

### 7. `DeviceCMYK` images: no source profile currently

**Current:** `#getImageColorSpaceInfo` returns `{ type: 'DeviceCMYK', components: 4, inputFormat: TYPE_CMYK_8 }` with **no `sourceProfile`** field. For `DeviceRGB` it returns `sourceProfile: 'sRGB'` and for `DeviceGray` it returns `sourceProfile: 'sGray'`.

**Problem:** To convert `DeviceCMYK` images to RGB, we need a CMYK source profile. This is where `defaultSourceProfileForDeviceCMYK` comes in. Once the sentinel contamination is cleaned up (Task 1b), all three Device types will consistently have `sourceProfile: undefined`, and the `defaultSourceProfileForDevice*` settings will provide the resolution path.

### 8. Content stream `#getOutputOperator` for Device color conversion

**Current:** When converting Device colors (`g`/`G`, `rg`/`RG`, `k`/`K`), the output operator is selected based on `destinationColorSpace`. This already works correctly — converting `DeviceCMYK` to RGB would output `rg`/`RG` operators. However, the rebuild logic in `rebuildContentStream` is only wired for operations in the `toConvert` pipeline (which currently excludes Device colors).

### 9. PostScript math path for `null` default profiles

**Not addressed in plan:** When `defaultSourceProfileForDevice*` is `null`, the specification says to use "traditional PostScript math." This math is straightforward for some conversions:

- `DeviceCMYK` → `DeviceRGB`: `R = 1 - min(1, C + K)`, `G = 1 - min(1, M + K)`, `B = 1 - min(1, Y + K)`
- `DeviceRGB` → `DeviceCMYK`: Requires black generation and undercolor removal decisions
- `DeviceGray` → `DeviceRGB`: `R = G = B = gray_value`
- `DeviceGray` → `DeviceCMYK`: `K = 1 - gray_value`, `C = M = Y = 0`

These are simple enough to implement inline without the color engine, but the plan should note that:

- `DeviceRGB` → `DeviceCMYK` with PostScript math requires a black generation strategy (not specified)
- This path bypasses all color conversion rules and intermediate transform logic

### 10. Color conversion rules `sourceColorSpaces` constraint granularity

**Current:** The `sourceColorSpaces` constraint in `RuleConstraints` uses `ColorSpace` type (`'Gray' | 'RGB' | 'CMYK' | 'Lab'`). This does not distinguish between `DeviceRGB` and `ICCBasedRGB`.

**Problem:** Rules like "K-Only GCR intent only supports CMYK output" use `sourceColorSpaces: ["Gray", "CMYK", "Lab"]` to match all Gray sources regardless of whether they are `DeviceGray` or `ICCBasedGray`. If Device and ICCBased need different rule behavior, the `ConversionDescriptor.sourceColorSpace` field must be extended, or a new `sourceIsDevice: boolean` field added.

**For initial implementation:** This is likely not a blocker because Device colors using a `defaultSourceProfileForDevice*` are effectively being treated as ICCBased (they get an assumed profile). The `sourceColorSpace` passed to rule evaluation would still be `'RGB'`, `'Gray'`, or `'CMYK'` — the rules don't need to know the profile came from a `default*` setting vs an embedded ICC stream. The distinction only matters for the PostScript math path (`null` profile), which bypasses rules entirely.

### 11. Worker pipeline propagation

**Current worker task fields** (from `worker-pool.js` and `worker-pool-entrypoint.js`):

- `sourceRGBProfile`, `sourceGrayProfile` — for content stream conversions
- `destinationProfile`, `intermediateProfiles` — shared via `broadcastSharedProfiles`

**Required additions:**

- `defaultSourceProfileForDeviceCMYK` (or `sourceCMYKProfile`) — for Device CMYK content streams and images
- Possibly `defaultSourceProfileForDeviceRGB`, `defaultSourceProfileForDeviceGray` if they differ from `sourceRGBProfile`, `sourceGrayProfile`
- `includedLayoutColorSpaceTypes`, `excludedLayoutColorSpaceTypes` — if content stream workers need to do their own filtering (currently all filtering happens on the main thread before dispatch)

## Critical: Legacy `'sRGB'`/`'sGray'` Sentinel String Contamination

The baseline `classes/baseline/` layer defines `ProfileType` as `ArrayBuffer | 'Lab'` (`color-converter.js:97`), and `ColorConverter.#openProfile` (line 802-809) explicitly **throws** for any string besides `'Lab'`:

```javascript
throw new Error(
    `Cannot open profile from string "${source}". ` +
    `Only 'Lab' is accepted as a string identifier. ` +
    `All other profiles (including paths and URLs) must be provided as ArrayBuffer.`
);
```

However, `PDFDocumentColorConverter.#getImageColorSpaceInfo` **returns legacy sentinel strings** from the 2025-era `services/` layer:

| Line | Code                                                   | Problem                                              |
| ---- | ------------------------------------------------------ | ---------------------------------------------------- |
| 769  | `sourceProfile: 'sRGB'` for `DeviceRGB`                | Violates `ProfileType`, will throw in `#openProfile` |
| 775  | `sourceProfile: 'sGray'` for `DeviceGray`              | Same                                                 |
| 854  | `sourceProfile: 'sRGB'` for Indexed base `DeviceRGB`   | Same                                                 |
| 858  | `sourceProfile: 'sGray'` for Indexed base `DeviceGray` | Same                                                 |

**How these strings flow to the throw:**

1. **Image path:** `#getImageColorSpaceInfo` → `PDFPageColorConverter.#extractImageInput` (line 802, passes through as-is) → `PDFImageColorConverter.convertColor` (line 434, `sourceProfile: input.sourceProfile`) → `ImageColorConverter.convertColor` (line 264, `input.sourceProfile ?? config.sourceProfile` — `'sRGB'` is truthy, wins) → `convertColorsBuffer` → `#openProfile` → **throws**

2. **Indexed image path:** `#getImageColorSpaceInfo` → `PDFPageColorConverter.#convertIndexedImage` (line 966, `sourceProfile ?? ...` — `'sRGB'` is truthy, wins over `??` fallbacks) → `convertColorsBuffer` → `#openProfile` → **throws**

3. **Content stream path (safe, but misleading):** `#normalizeColorSpaceType` returns `'sRGB'`/`'sGray'` but these are used only as **type discriminators** (line 309: `csType === 'sGray' || csType === 'sRGB'`) to route to `config.sourceRGBProfile`/`config.sourceGrayProfile` (which are `ArrayBuffer`). The strings never reach `#openProfile`. Still, using profile sentinel strings as type discriminators is confusing and must be cleaned up.

**Why this hasn't blown up yet:** The test form PDFs use ICCBased color spaces for images (with embedded ICC profiles), not bare `DeviceRGB`/`DeviceGray`. The hardcoded CMYK filter at line 559 also excludes `DeviceCMYK` images. So the `'sRGB'`/`'sGray'` sentinel strings in `sourceProfile` have never actually reached `#openProfile` in production.

**Origin:** The `services/ColorEngineService` (2025 layer, line 120) declares `BUILTIN_PROFILES = new Set(['sRGB', 'sGray', 'Lab'])` and resolves them to `colorEngine.createSRGBProfile()` / `colorEngine.createGray2Profile()`. The baseline layer was designed to reject this pattern, but the `PDFDocumentColorConverter` (which bridges between PDF parsing and baseline conversion) was written with the legacy conventions.

### Contamination Cleanup (Task 1b)

1. **`PDFDocumentColorConverter.#getImageColorSpaceInfo`** (lines 769, 775, 854, 858): Remove `sourceProfile: 'sRGB'` and `sourceProfile: 'sGray'`. Device color spaces have no profile — `sourceProfile` must be `undefined`. The caller resolves a default profile via configuration.

2. **`PDFDocumentColorConverter.#normalizeColorSpaceType`** (lines 707-722): Replace `'sRGB'` and `'sGray'` return values with type-accurate names that do not masquerade as profile identifiers. Options:
   - Return `'DeviceGray'`, `'DeviceRGB'`, `'CMYK'` (preserving Device distinction)
   - Or return `'Gray'`, `'RGB'`, `'CMYK'` (collapsing Device/ICCBased, but without fake profile names)

3. **`PDFContentStreamColorConverter`** (lines 309, 342, 344): Update type discriminator comparisons from `csType === 'sRGB'`/`csType === 'sGray'` to match the new names from step 2.

4. **`PDFContentStreamColorConverter` JSDoc example** (lines 174-175): Remove `sourceRGBProfile: 'sRGB'` and `sourceGrayProfile: 'sGray'` from code example.

5. **Tests** that assert `'sRGB'`/`'sGray'` as profile values must be updated to use `ArrayBuffer` or `undefined`.

## Violations (anchored to separation of concerns)

The full violation analysis is in `2026-04-06-DECISION-FLOW-ANALYSIS.md`. Summary:

| ID  | Violation                                                                             | Layer     | Task |
| --- | ------------------------------------------------------------------------------------- | --------- | ---- |
| V1  | `COLOR_SPACE_TYPES` collapses PDF color space distinctions prematurely                | PDF       | 2    |
| V2  | `'sRGB'`/`'sGray'` sentinel strings in `sourceProfile` violate `ProfileType`          | PDF       | 2    |
| V3  | `#normalizeColorSpaceType` returns profile sentinels instead of PDF color space names | PDF       | 2    |
| V4  | Hardcoded `!type.includes('CMYK')` image filter instead of configuration-driven       | PDF       | 3    |
| V5  | Content stream converter hardcodes Device color skipping and silently drops CMYK      | PDF       | 4    |
| V6  | Manifest `settings.colorManagement` is declared but never wired to converter classes  | Generator | 5    |

**Anchor principle:** PDF conversion classes know PDF color spaces and make all PDF-specific decisions (include/exclude, conversion method, profile resolution for Device colors). Non-PDF super classes know only color models (`RGB`/`CMYK`/`Gray`/`Lab`) and `ProfileType = ArrayBuffer | 'Lab'`. The boundary between them is where `sourcePDFColorSpace` maps to `inputColorSpace` — and only when the super class is actually invoked.

**The color conversion policy correctly does not include `Device*` or `ICCBased*`** — it operates at the non-PDF super class level where those distinctions do not exist. The manifest's `defaultSourceProfileForDevice*` fields are intentionally handled by the PDF conversion classes, not by the policy.

## Recommended Implementation Order

1. **Task 2** — Fix `sourcePDFColorSpace` tracking and remove sentinels (V1, V2, V3). This is the foundation — everything else depends on proper PDF color space tracking.
2. **Task 3** — Configurable filtering (V4). Straightforward once PDF color space names are tracked properly.
3. **Task 4** — Conversion method selection (V5). The most complex task — PDF layer must decide per-element whether to invoke super class, use PostScript math, or skip.
4. **Task 5** — Wire manifest settings (V6). Generator resolves settings into concrete values for the PDF layer.
5. **Task 6** — Assembly policy updates. Configuration changes.
6. **Task 7** — Worker propagation. Mechanical.
7. **Task 8** — Testing.

---

## Post-Implementation Audit Results (2026-04-07)

### Issues Found

| #   | Severity   | File                                        | Issue                                                                                                                                                                                                  | Runtime Impact                                      | Tests Catch? |
| --- | ---------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------- | ------------ |
| 1   | **Fixed**  | `test-form-pdf-document-generator.js`       | `defaultSourceProfileForDevice*` declared as `const` in `generate()` but referenced in 3 other methods — `ReferenceError`                                                                              | Crashes multi-intent, separate-chains, docket paths | No           |
| 2   | **High**   | `pdf-document-color-converter.js`           | `defaultSourceProfileForDevice*` flows through config but is never consumed to provide source profiles — DeviceRGB images that pass inclusion filter would crash with "Source ICC profile is required" | Crash on DeviceRGB/DeviceGray image conversion      | No           |
| 3   | **Medium** | `pdf-content-stream-color-converter.js:493` | `outputChannels` hardcodes 3 for non-CMYK, but Gray output needs 1 — garbled Gray destination output                                                                                                   | Wrong color values in Gray output                   | No           |
| 4   | **Medium** | `test-form-pdf-document-generator.js:953`   | Separate-chains `AssetPagePreConverter` omits `renderingIntent`/`blackPointCompensation`, defaults to Relative Colorimetric regardless of assembly plan                                                | Wrong rendering intent in separate-chains mode      | No           |
| 5   | Low        | `pdf-document-color-converter.js`           | Duplicate typedef for `defaultSourceProfileForDevice*` in parent and child config                                                                                                                      | None (redundant types)                              | N/A          |
| 6   | Low        | `pdf-page-color-converter.js`               | `defaultSourceProfileForDevice*` declared in typedef but never consumed in file                                                                                                                        | None (unused plumbing)                              | N/A          |

### Issue Status

- **Issue 1:** Fixed — changed from local `const` to `this.#` instance fields
- **Issue 2:** Not fixed — requires implementing the actual Device color conversion logic in the page converter (using `defaultSourceProfileForDevice*` as source profiles for Device images/streams). This is the remaining core work of the device color plan.
- **Issue 3:** Pre-existing bug, not introduced by this refactor. Needs fix + test.
- **Issue 4:** Pre-existing gap in separate-chains path, not introduced by this refactor. Needs investigation.
- **Issues 5-6:** Low severity, no runtime impact.

### Missing Tests That Would Have Caught These

| Test                                                           | Would Catch                                           | Priority     |
| -------------------------------------------------------------- | ----------------------------------------------------- | ------------ |
| **E5: Generator end-to-end with CMYK output intent**           | Issue 1 (ReferenceError in multi-intent/docket paths) | **Critical** |
| **E6: Generator end-to-end with RGB output intent**            | Issue 2 (DeviceRGB crash)                             | **Critical** |
| Content stream conversion with `destinationColorSpace: 'Gray'` | Issue 3 (wrong outputChannels)                        | Medium       |
| Generator with separate-chains strategy + K-Only GCR           | Issue 4 (wrong rendering intent)                      | Medium       |

---

## Follow-Up Items (out of scope for this plan, to be tracked separately)

1. **Indexed color: dedicated PDF fixture testing** — The Indexed image conversion code exists (`#getImageColorSpaceInfo` Indexed parsing, `PDFPageColorConverter.#convertIndexedImage`) but has never been tested with real PDF assets containing Indexed images. Dedicated fixtures will be prepared to exercise all base color space combinations. See `2026-04-06-TESTING-PROGRESS.md` R7.

2. **Verify against PDF Reference 1.7** — The complete PDF color space taxonomy (Device, CIE-based, Special) needs to be verified against `documentation/references/Adobe-PDF-Reference-1.7.pdf` (Chapter 4.5). The `switch` blocks on `sourcePDFColorSpace` in Task 2 must cover all color spaces defined in the spec. The content stream operator set must also be verified against the spec.

3. **Content stream parser refactor** — Promoted from follow-up to prerequisite. See `2026-04-06-CONTENT-STREAM-MARKUP-REFACTOR-PROGRESS.md`. The `type: 'indexed'` naming collision with PDF Indexed color spaces must be resolved before Task 2 introduces `sourcePDFColorSpace` `switch` blocks.

---

## Current Status

**2026-04-16:** Landing plan revised after user feedback. Key design corrections:

- Assembly policy (`includedLayoutColorSpaceTypes`/`excludedLayoutColorSpaceTypes`) is **layout-gating**, not conversion-gating. Removed from scope.
- PostScript math is **not** inline formulas — it's a new `TraditionalPostScriptColorConverter` class, Float32, PDF-agnostic, reusing bit-depth/endianness helpers.
- Decision logic is a single pure `resolveDeviceSourceProfile()` helper, called from both PDF converter composition points (image + content stream). No duplication.
- Workers load the PDF converter classes dynamically; TPS loads transitively. Device decision + math both execute inside the worker isolate — no lazy main-thread work.
- Profile-loss regression is tracked separately and is not part of this document's scope.

See "Work blocks (dependency-ordered) — revised 2026-04-16" table above.

---

## Activity Log

| Date       | Activity                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 2026-04-05 | Created progress document with specification                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 2026-04-05 | Initial gap analysis — identified sentinel contamination and 8 disconnects                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 2026-04-06 | Decision flow analysis — mapped all decision points across both pipelines, identified structural disconnect                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 2026-04-06 | Reframed around separation of concerns — 6 violations identified, roadmap anchored to PDF/non-PDF layer boundary                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 2026-04-06 | Verified `settings.json` change safe (no regressions); established test baseline (284 pass, 0 fail); added testing protocol                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 2026-04-06 | Assessed Indexed/unsupported color spaces; audited content stream parser duplication; added follow-up items                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 2026-04-06 | Content stream parser refactor promoted to prerequisite; created `2026-04-06-CONTENT-STREAM-MARKUP-REFACTOR-PROGRESS.md`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 2026-04-06 | Content stream parser refactor complete — tokenizer + interpreter + bridge layer; 372 tests, 321 pass, 0 fail                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 2026-04-06 | Task 2: Removed `'sRGB'`/`'sGray'` sentinels, `#normalizeColorSpaceType` returns proper PDF color space names                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 2026-04-06 | Task 3: `#isColorSpaceIncluded` replaces hardcoded CMYK filter, shorthand resolution for include/exclude                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 2026-04-06 | Task 4: `defaultSourceProfileForDevice*` fields added to converter + page converter config, propagated                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 2026-04-06 | Task 5: Generator reads manifest `settings.colorManagement`, resolves profiles, passes to all pre-converters                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 2026-04-07 | **Bug found and fixed:** Task 5 had introduced `ReferenceError` in 3 of 4 generator code paths — local `const` variables referenced in separate methods where they were out of scope. Fixed by using `this.#` instance fields. No test caught this because zero generator E5/E6 tests exist.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 2026-04-07 | Post-implementation audit — 6 issues found (see Audit Results below). Added CLAUDE.md rules and memory to prevent performative test claims.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 2026-04-07 | Researched PDF color space taxonomy via Google AI Mode reference (https://share.google/aimode/4ZYeAWEVbLSAokCgU) — covers Device (DeviceGray/RGB/CMYK), CIE-Based (CalGray/CalRGB/Lab/ICCBased), Special (Indexed/Separation/DeviceN/Pattern), and content stream operators for each category. Confirmed UI toggles `convertDeviceRGB`, `convertDeviceCMYK`, `convertDeviceGray` exist in config and flow through the pipeline, but currently only control the early-exit check in `convertColorStreaming` — Device color operators (rg/RG/g/G/k/K) are counted but passed through unchanged. For RGB output intent: DeviceCMYK and DeviceRGB in GhostScript-generated slugs/docket would violate PDF/X-4; DeviceGray is allowed in both CMYK and RGB output intents. PostScript math for Device color conversion (DeviceCMYK→DeviceRGB etc.) still pending. |
| 2026-04-16 | **Design correction** — assembly-policy.json renamed `includedColorSpaceTypes` → `includedLayoutColorSpaceTypes` (layout-gating, not conversion-gating). This doc's earlier "add CMYK to RGB category" item was based on a misread and is removed from scope. Assembly policy is not modified by this work. |
| 2026-04-16 | **Class design** — replaced inline PostScript-math plan with a new `TraditionalPostScriptColorConverter` class (sibling to `ColorConverter`, PDF-agnostic, Float32 internally). Reuses bit-depth/endianness helpers already in `color-conversion-policy.js`. Single math implementation; used by both PDF converter composition points. |
| 2026-04-16 | **Single resolver** — added `resolveDeviceSourceProfile()` as a pure function encoding the conjunction once (default → preferOutputIntent → preferEmbeded → preferGracefullFallback). Returns ArrayBuffer, null, or throws. No duplication across converters. |
| 2026-04-16 | **Worker delegation verified** — `worker-pool-entrypoint.js` dynamically imports `PDFImageColorConverter` (line 213) and `PDFContentStreamColorConverter` (line 306). `TraditionalPostScriptColorConverter` is loaded transitively inside the worker isolate via those classes — never instantiated directly by the worker entrypoint. Decision + math execute entirely in the worker. Task payload expanded to carry `pdfColorSpaceType`, policy fields, output-intent color space type, and embedded profile inventory so workers make the decision autonomously (no main-thread round-trip). |
| 2026-04-16 | **Work blocks revised** — A: forward `pdfColorSpaceType`; B: worker task payload additions; C: resolver helper; D: TPS class; E: `PDFImageColorConverter` composition point; F: `PDFContentStreamColorConverter` composition point; H: docket routing for RGB OI; I/J: pre-existing audit fixes; K: tests; L: final doc refresh. Profile-loss regression tracked separately, out of scope here. |
| 2026-04-16 | **Unified GhostScript output handling** — docket PDF and slug PDFs both go through the same conversion pipeline as asset pages. No docket-specific or slug-specific paths. When output intent is RGB: DeviceCMYK (docket) and DeviceGray (both) resolve via `resolveDeviceSourceProfile()` and dispatch through E/F. Skipped for CMYK and Gray output intents where content is already PDF/X-4 compatible. |
| 2026-04-16 | **Block A landed** — `pdfColorSpaceType` typedef added to `PDFImageColorConverter`; `#extractImageInput` propagates `colorSpaceInfo.type` for both Indexed and non-Indexed branches; worker payload + entrypoint forward the field. Preserves `Device*` vs `ICCBased*` distinction that was being lost at `typeToColorSpace` mapping. |
| 2026-04-16 | **Block D landed** — `TraditionalPostScriptColorConverter` created, extends `ColorConverter`, accepts parent's `colorEngineProvider` via options so `#ready` resolves immediately. Float32Array in → Float32Array out (throws otherwise). Identity short-circuit via `Float32Array.prototype.set` bulk copy. Dispatch table: `CMYK→RGB`, `Gray→RGB`, `Gray→CMYK`, `RGB→Gray`, `CMYK→Gray`, `RGB→CMYK`. Exposes both `convertColor(input, context)` buffer path and `convertTuple(values, options)` synchronous single-tuple path. |
| 2026-04-16 | **Block M landed** — TPS `RGB → CMYK` implemented with PostScript Level 2 default black generation and undercolor removal: `K = min(1 − R, 1 − G, 1 − B); C = 1 − R − K; M = 1 − G − K; Y = 1 − B − K`. Removed the previous throw. PostScript math has no rendering intent and never fails — any Device-to-Device direction always produces a deterministic result. User feedback: "Traditional PostScript math does not have any rendering intent, it should never fail, let alone have contrived blockers without even letting me know." |
| 2026-04-16 | **R2 CMYK OI passes preflight** — `Maps (Decalibrated).pdf` → eciCMYK v2: 16-bit CMYK output verified by user (R2 preflight reports clean). 10× 16-bit `DeviceRGB` images converted via TPS `RGB → CMYK` BG/UCR; 8× 8-bit `DeviceGray` images converted via TPS `Gray → CMYK` K-only. |
| 2026-04-16 | **Block N landed — docket XMP/Producer sync after Block H conversion** — `PDFDocumentColorConverter.convertColor` appends `(Color-Engine <version>)` to `Info.Producer` on every invocation (`pdf-document-color-converter.js:542`). The docket arrives from `#generateDocketPDF` with `Info.Producer` and `XMP.Producer` already aligned by `#postProcessDocument` → `#ensureXMPMetadata`. Running the converter here desynced them — `Info.Producer` gained the suffix, XMP stayed unchanged → preflight `RUL30` "Producer mismatch between Document Info and XMP Metadata". Fix: after `#convertDeviceColorToOutputIntent` call `#ensureXMPMetadata(docketDocument, iccProfileHeader)` before saving to re-align. Main PDF does not need this fix because `#postProcess` → `#ensureXMPMetadata` runs after pre-conversion in that flow. Slug PDFs also do not need it because slugs are embedded as Form XObjects (only pages/streams/resources copy over — Info/XMP are discarded). |
| 2026-04-16 | **R3 RGB OI residual `RUL83` hits root-caused (pre-existing, out of scope)** — 2466 preflight hits for "DeviceGray used but OutputIntent not Gray or CMYK". Graphics-state-aware simulation of source PDF Form XObject `258 0 R` reveals 6304 stroke operators, only 714 preceded by `RG`; the remaining 2465 execute with the **PDF default stroke color space** which is `DeviceGray` per spec (ISO 32000-2 §8.6.1.2). One additional fill hit in Form `252 0 R` where the single fill runs in default `DeviceGray` state. Zero explicit `G`/`cs /DeviceGray` operators in any converted stream — so TPS and the content-stream converter never see a Device-Gray color operation to convert. The fix requires prepending explicit RGB defaults (`0 0 0 rg 0 0 0 RG`) to each converted content stream when output intent is RGB, to override the PDF-default DeviceGray state. |
| 2026-04-16 | **R4 verification (4-way matrix: CMYK 8-bit, CMYK 16-bit, RGB 8-bit, RGB 16-bit × docket + main)** — CMYK-OI 8/16-bit docket + main: 0 preflight hits on all four. RGB-OI 8/16-bit docket: 0 preflight hits (Task N `#ensureXMPMetadata` sync confirmed). RGB-OI 8/16-bit main: still 221 hits each (same root cause — PDF-default DeviceGray state in Forms `252 0 R` + `258 0 R`). Task P implemented in response. |
| 2026-04-16 | **Block P landed (provisionally)** — `PDFContentStreamColorConverter.convertColorStreaming` writes `0 0 0 rg 0 0 0 RG\n` to the compressor BEFORE any stream content when `destinationColorSpace === 'RGB'`. |
| 2026-04-16 | **Block P first attempt deadlocked** — `await compressWriter.write(prologueBytes)` at the function-body level (before `Promise.all`) blocked because the readable side had no consumer yet. Fix: move the write into `processTokens` IIFE so it runs concurrently with the reader started by `Promise.all`. |
| 2026-04-16 | **Block P REVERTED in R5** — even after the deadlock fix, the browser-generated R5 docket showed 6 specific `rg` operators zeroed to `0 0 0 rg` at chunk-aligned positions (every ~98 KB / ~6 DecompressionStream chunks). Direct Node reproduction via `convertColorStreaming` and `PDFDocumentColorConverter` on the R3 docket bytes both produced CORRECT output with no zero-outs. The bug is browser-specific — likely a Firefox CompressionStream/DecompressionStream interaction with the prologue write. Reverted the prologue write from `pdf-content-stream-color-converter.js`; CMYK OI and RGB OI docket remain clean (Task N), but RGB OI main PDFs still show 221 RUL83 hits from the inherited PDF-default `DeviceGray` state in source Forms `252 0 R` and `258 0 R`. Task P needs a different implementation strategy — likely decompress→prepend→recompress at the page-converter apply step, outside any streaming-pipeline interaction. |
| 2026-04-16 | **Block E landed** — `PDFImageColorConverter.convertPDFImageColor` early-routes Device images with no `sourceProfile` to `#convertViaPostScriptMath`. Supports 8-bit and 16-bit input via `DataView.getUint16(i*2, false)` (explicit big-endian per ISO 32000). Output packed big-endian 8-bit or 16-bit. Reuses existing `#decompress`/`#compress` helpers — no bespoke bit/endianness code. |
| 2026-04-16 | **Catastrophic identity-loop bug caught and fixed** — TPS identity function was `O(N²)` (quadrillion iterations on 27M-pixel 16-bit DeviceRGB identity). Generator froze at 5:54. Fixed by short-circuiting identity in `convertColor` with `Float32Array.prototype.set` (bulk O(N) copy). |
| 2026-04-16 | **Block F landed** — `PDFContentStreamColorConverter.flush()` pre-pass extracts Device operators (`setGray`/`setRGB`/`setCMYK`), calls `this.#getTPS().convertTuple(vals, {inputColorSpace, outputColorSpace})`, merges into the existing `conversions` Map so the existing output writer handles both ICC and TPS-converted operators uniformly. Handled `setGray` singular `value` vs `setRGB`/`setCMYK` plural `values`. Fixed pre-existing `#getOutputOperator` bug where `K` was treated as a fill operator instead of a stroke operator. |
| 2026-04-16 | **Content stream early-exit fixed** — `AssetPagePreConverter` defaults `convertDeviceRGB/CMYK/Gray` to `true` via `?? true`, preventing the content-stream converter from short-circuiting before Block F runs. |
| 2026-04-16 | **Block H landed** — Added `#convertDeviceColorToOutputIntent(document, iccProfileBuffer, outputColorSpace)` private helper in `test-form-pdf-document-generator.js` that runs a minimal `PDFDocumentColorConverter` in place when output intent is RGB. Wired after `#generateDocketPDF` (load → convert → save) and before `embedSlugsIntoPDFDocument`. Unified pipeline — no bespoke docket or slug conversion paths. |
| 2026-04-16 | **End-to-end verification (Maps Decalibrated, sRGB OI)** — Playwright MCP generator run produced: Docket content streams contain 3087 `rg` fill + 7 `RG` stroke operators, 0 `k/K/g/G`. Main PDF content streams contain 0 Device operators of any kind. Images: 21× DeviceRGB 8-bit (converted from mix of 10× DeviceRGB 16-bit + 8× DeviceGray 8-bit + 3 GhostScript-generated). No console errors, no flate stream corruption, no warnings. Target asset: `testing/iso/ptf/assets/2026-04-16 - ConRes - ISO PTF - CR1 (F10a) Assets - Maps (Decalibrated).pdf`. |
| 2026-04-22 | **Block S — Worker buffer transfer detachment root-caused and fixed** — `worker-pool.js:562` transfers `compressedContents.buffer` as a transferable, detaching the original `ArrayBuffer` on the sender side. Since `compressedContents` was a direct reference to `stream.contents` (page converter line 625), the original PDF stream data was zeroed for any content stream sent to a pool worker. Fix: `new Uint8Array(streamData.stream.contents)` creates an independent copy whose buffer can be safely transferred. Committed as `c21c7a4`. |
| 2026-04-22 | **Block R — Deflate format detection and empty-output guard** — Content stream converter now detects zlib vs raw deflate format from the CMF/FLG header bytes (`(cmf & 0x0F) === 8 && (cmf * 256 + flg) % 31 === 0`). Handles Adobe Illustrator's 1K window zlib (`0x48` CMF). Always recompresses as zlib for pdf-lib compatibility. Empty-output guard on both worker and non-worker paths prevents applying 0-byte results. |
| 2026-04-22 | **Block P — `pdfX4CompliantOutput` flag wired through full chain** — New `pdfX4CompliantOutput` boolean propagates generator → `AssetPagePreConverter` → `PDFDocumentColorConverter` → `PDFPageColorConverter` → worker task → `PDFContentStreamColorConverter`. When `pdfX4CompliantOutput && destinationColorSpace === 'RGB'`, content stream converter auto-enables `effectiveConvertDeviceGray` and `effectiveConvertDeviceCMYK` via `config.convertDeviceGray ?? (pdfX4CompliantOutput && dest === 'RGB')`. This bypasses the early exit for streams with no named color spaces, allowing TPS to convert all explicit `g`/`G`/`k`/`K` operators to `rg`/`RG`. |
| 2026-04-22 | **Block P — Page-level prologue for default DeviceGray state** — `#addPDFX4Prologue(document)` creates a FlateDecode-compressed stream containing `0 0 0 rg 0 0 0 RG\n` and prepends it to each page's Contents array. Per PDF 1.7 §7.8.2, page Contents are concatenated in order. The prologue overrides the PDF default color space (DeviceGray) with DeviceRGB at the page level. Form XObjects invoked via `Do` inherit this state, eliminating preflight RUL83 hits from paint ops executing in default graphics state. Applied only for RGB output intents. |
| 2026-04-22 | **Block P — Bootstrap worker forwarding fixed** — `bootstrap-worker-entrypoint.js` was not forwarding `experimentalContentStreamConversion` from the worker message to the generator constructor. Fixed by adding `experimentalContentStreamConversion: data.experimentalContentStreamConversion`. |
| 2026-04-22 | **Block P — Sequential subset propagation fixed** — `AssetPagePreConverter` sequential path (line 566, `concurrentSubsets=false`) was missing `experimentalPaintOpInsertion` and `pdfX4CompliantOutput` in the converter construction. Pages 4 and 5 (27.8 MB map content streams) went through the worker with `experimentalPaintOpInsertion=undefined`, causing early exit. Fixed by adding both fields to the sequential path. |
| 2026-04-22 | **Block P — In-stream prologue abandoned** — Injecting `0 0 0 rg 0 0 0 RG` inside each content stream via the streaming converter caused visual artifacts on CR21 (ConRes test chart) pages. The prologue set DeviceRGB state before ICCBased sRGB content, and under non-sRGB output intents (FIPS_WIDE), the DeviceRGB black rendered differently than the expected ICCBased black. The page-level prologue (Contents array prepend) does not cause this issue because Form XObjects with ICCBased color spaces immediately override the inherited state via `cs`/`CS` operators. |
| 2026-04-22 | **Block P — Verification** — Maps (Decalibrated) + FIPS_WIDE RGB, P-31 Interlaken Map layout: 11 content streams converted (8 CR21 + 1 sGray + 2 maps), all 6 Form XObjects show `g=0 G=0` (zero DeviceGray operators). Visual diff: CR21 region 0 diff pixels, map region max delta 35 (compression rounding). 51 FlateDecode streams, 0 failures. Acrobat preflight pending user confirmation. |
| 2026-04-22 | **`convertDevice*` defaults changed** — `AssetPagePreConverter` defaults changed from `?? true` to `?? false`. The `?? true` default forced all content streams through the tokenizer round-trip even when no Device conversion was needed, causing the CMYK regression (missing rings). With `?? false`, streams skip the round-trip unless `convertDevice*` is explicitly set or `pdfX4CompliantOutput` auto-enables it. |
| 2026-04-23 | **Block T — CMYK output intent DeviceRGB conversion** — Added `effectiveConvertDeviceRGB` to content stream converter: `config.convertDeviceRGB ?? (pdfX4CompliantOutput && (dest === 'CMYK' \|\| dest === 'Gray'))`. For CMYK output, TPS converts all `rg`/`RG` operators to `k`/`K` via `RGB → CMYK` PostScript math (Block M). Page-level prologue updated to accept color space parameter: CMYK output uses `0 0 0 1 k 0 0 0 1 K`, RGB output uses `0 0 0 rg 0 0 0 RG`. |
| 2026-04-23 | **Block T — `convertDevice*` defaults changed to `undefined` passthrough** — `AssetPagePreConverter` was defaulting `convertDeviceRGB/CMYK/Gray` to `false` via `?? false`. Since `false ?? fallback` returns `false` (not the fallback), `pdfX4CompliantOutput` auto-enable could never trigger. Changed to pass `undefined` through, allowing the content stream converter's `??` fallback to work correctly. |
| 2026-04-23 | **Block T — Verification** — Maps (Decalibrated) + eciCMYK v2, P-31 Interlaken Map: 11 content streams converted per pass (2 passes: Relative Colorimetric + K-Only GCR). All 6 Form XObjects show zero `rg`/`RG` operators. Form 208 converted from `rg=301 RG=714` to `k=303 K=715`. DeviceGray preserved (permitted in CMYK PDF/X-4). Visual diff: CR21 0 diff, maps max delta 72 (expected TPS color conversion), zero high-contrast artifacts. RGB regression check: zero DeviceGray, zero CR21 artifacts, identical to prior `pdfx4f` result. |
