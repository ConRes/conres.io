# Device Color Handling for PDF/X-4 RGB and Gray Output Intents

**Last Updated:** 2026-04-07  
**Status:** Planning  
**Branch:** `test-form-generator/2026/dev`

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

### 2. Granular `includedColorSpaceTypes` and `excludedColorSpaceTypes`

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

- `RGB` in `includedColorSpaceTypes` includes both `DeviceRGB` and `ICCBasedRGB` **unless** either `DeviceRGB` or `ICCBasedRGB` is also explicitly present in `excludedColorSpaceTypes`
- `DeviceRGB` in `excludedColorSpaceTypes` excludes only `DeviceRGB` even if `RGB` is in `includedColorSpaceTypes`
- If both `RGB` (shorthand) and `DeviceRGB` (explicit) appear in `includedColorSpaceTypes`, `DeviceRGB` takes no additional effect (already covered by `RGB`)
- If both `RGB` (shorthand) and `DeviceRGB` (explicit) appear in `excludedColorSpaceTypes`, same principle applies

### 3. Device Color Conversion Behavior

When a `Device*` color space is included for conversion, the PDF converter class decides the conversion method based on `defaultSourceProfileForDevice*`:

1. **If `defaultSourceProfileForDevice*` is `ArrayBuffer`** — Treat the `Device*` color as `ICCBased*` using the specified profile; invoke non-PDF super class for ICC color conversion
2. **If `defaultSourceProfileForDevice*` is `null`** — Use traditional PostScript math for conversion; non-PDF super class is not invoked
3. **If `defaultSourceProfileForDevice*` is `undefined`** — Skip conversion for that `Device*` color space; non-PDF super class is not invoked (current behavior)

### 4. `DeviceN` Warning

`DeviceN` is distinct from `DeviceRGB`, `DeviceCMYK`, and `DeviceGray`. Specifying `DeviceN` in either `includedColorSpaceTypes` or `excludedColorSpaceTypes` must not affect the handling of `DeviceRGB`, `DeviceCMYK`, or `DeviceGray`. If `DeviceN` is specified and is not supported (which is the current state), a warning must be emitted.

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
  - Add `includedColorSpaceTypes`/`excludedColorSpaceTypes` to `PDFDocumentColorConverterConfiguration`
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
  - Pass resolved `defaultSourceProfileForDevice*` and `includedColorSpaceTypes`/`excludedColorSpaceTypes` to `PDFDocumentColorConverter` construction in `AssetPagePreConverter`

- [ ] **Task 6: Update assembly policy configuration**
  - Update `assembly-policy.json` profile categories to include `DeviceCMYK`/`DeviceGray` in `includedColorSpaceTypes` for RGB output intents
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

**Problem:** For RGB output intents, `DeviceCMYK` images must be converted. `ICCBasedCMYK` images should also be converted. This filter must become configurable using the resolved `includedColorSpaceTypes`/`excludedColorSpaceTypes`.

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

### 6. Assembly policy `includedColorSpaceTypes` current values

**Current assembly policy values:**

| Category    | `includedColorSpaceTypes`           | `excludedColorSpaceTypes` |
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
- `includedColorSpaceTypes`, `excludedColorSpaceTypes` — if content stream workers need to do their own filtering (currently all filtering happens on the main thread before dispatch)

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

| #  | Severity   | File | Issue | Runtime Impact | Tests Catch? |
| -- | ---------- | ---- | ----- | -------------- | ------------ |
| 1  | **Fixed**  | `test-form-pdf-document-generator.js` | `defaultSourceProfileForDevice*` declared as `const` in `generate()` but referenced in 3 other methods — `ReferenceError` | Crashes multi-intent, separate-chains, docket paths | No |
| 2  | **High**   | `pdf-document-color-converter.js` | `defaultSourceProfileForDevice*` flows through config but is never consumed to provide source profiles — DeviceRGB images that pass inclusion filter would crash with "Source ICC profile is required" | Crash on DeviceRGB/DeviceGray image conversion | No |
| 3  | **Medium** | `pdf-content-stream-color-converter.js:493` | `outputChannels` hardcodes 3 for non-CMYK, but Gray output needs 1 — garbled Gray destination output | Wrong color values in Gray output | No |
| 4  | **Medium** | `test-form-pdf-document-generator.js:953` | Separate-chains `AssetPagePreConverter` omits `renderingIntent`/`blackPointCompensation`, defaults to Relative Colorimetric regardless of assembly plan | Wrong rendering intent in separate-chains mode | No |
| 5  | Low        | `pdf-document-color-converter.js` | Duplicate typedef for `defaultSourceProfileForDevice*` in parent and child config | None (redundant types) | N/A |
| 6  | Low        | `pdf-page-color-converter.js` | `defaultSourceProfileForDevice*` declared in typedef but never consumed in file | None (unused plumbing) | N/A |

### Issue Status

- **Issue 1:** Fixed — changed from local `const` to `this.#` instance fields
- **Issue 2:** Not fixed — requires implementing the actual Device color conversion logic in the page converter (using `defaultSourceProfileForDevice*` as source profiles for Device images/streams). This is the remaining core work of the device color plan.
- **Issue 3:** Pre-existing bug, not introduced by this refactor. Needs fix + test.
- **Issue 4:** Pre-existing gap in separate-chains path, not introduced by this refactor. Needs investigation.
- **Issues 5-6:** Low severity, no runtime impact.

### Missing Tests That Would Have Caught These

| Test | Would Catch | Priority |
| ---- | ----------- | -------- |
| **E5: Generator end-to-end with CMYK output intent** | Issue 1 (ReferenceError in multi-intent/docket paths) | **Critical** |
| **E6: Generator end-to-end with RGB output intent** | Issue 2 (DeviceRGB crash) | **Critical** |
| Content stream conversion with `destinationColorSpace: 'Gray'` | Issue 3 (wrong outputChannels) | Medium |
| Generator with separate-chains strategy + K-Only GCR | Issue 4 (wrong rendering intent) | Medium |

---

## Follow-Up Items (out of scope for this plan, to be tracked separately)

1. **Indexed color: dedicated PDF fixture testing** — The Indexed image conversion code exists (`#getImageColorSpaceInfo` Indexed parsing, `PDFPageColorConverter.#convertIndexedImage`) but has never been tested with real PDF assets containing Indexed images. Dedicated fixtures will be prepared to exercise all base color space combinations. See `2026-04-06-TESTING-PROGRESS.md` R7.

2. **Verify against PDF Reference 1.7** — The complete PDF color space taxonomy (Device, CIE-based, Special) needs to be verified against `documentation/references/Adobe-PDF-Reference-1.7.pdf` (Chapter 4.5). The `switch` blocks on `sourcePDFColorSpace` in Task 2 must cover all color spaces defined in the spec. The content stream operator set must also be verified against the spec.

3. **Content stream parser refactor** — Promoted from follow-up to prerequisite. See `2026-04-06-CONTENT-STREAM-MARKUP-REFACTOR-PROGRESS.md`. The `type: 'indexed'` naming collision with PDF Indexed color spaces must be resolved before Task 2 introduces `sourcePDFColorSpace` `switch` blocks.

---

## Current Status

**Focus:** Tasks 2-5 implemented with critical bug fixed. Tasks 6-8 deferred. Audit completed — 6 issues found, 2 high/medium severity. Generator end-to-end tests still missing (E5/E6).

---

## Activity Log

| Date       | Activity |
| ---------- | -------- |
| 2026-04-05 | Created progress document with specification |
| 2026-04-05 | Initial gap analysis — identified sentinel contamination and 8 disconnects |
| 2026-04-06 | Decision flow analysis — mapped all decision points across both pipelines, identified structural disconnect |
| 2026-04-06 | Reframed around separation of concerns — 6 violations identified, roadmap anchored to PDF/non-PDF layer boundary |
| 2026-04-06 | Verified `settings.json` change safe (no regressions); established test baseline (284 pass, 0 fail); added testing protocol |
| 2026-04-06 | Assessed Indexed/unsupported color spaces; audited content stream parser duplication; added follow-up items |
| 2026-04-06 | Content stream parser refactor promoted to prerequisite; created `2026-04-06-CONTENT-STREAM-MARKUP-REFACTOR-PROGRESS.md` |
| 2026-04-06 | Content stream parser refactor complete — tokenizer + interpreter + bridge layer; 372 tests, 321 pass, 0 fail |
| 2026-04-06 | Task 2: Removed `'sRGB'`/`'sGray'` sentinels, `#normalizeColorSpaceType` returns proper PDF color space names |
| 2026-04-06 | Task 3: `#isColorSpaceIncluded` replaces hardcoded CMYK filter, shorthand resolution for include/exclude |
| 2026-04-06 | Task 4: `defaultSourceProfileForDevice*` fields added to converter + page converter config, propagated |
| 2026-04-06 | Task 5: Generator reads manifest `settings.colorManagement`, resolves profiles, passes to all pre-converters |
| 2026-04-07 | **Bug found and fixed:** Task 5 had introduced `ReferenceError` in 3 of 4 generator code paths — local `const` variables referenced in separate methods where they were out of scope. Fixed by using `this.#` instance fields. No test caught this because zero generator E5/E6 tests exist. |
| 2026-04-07 | Post-implementation audit — 6 issues found (see Audit Results below). Added CLAUDE.md rules and memory to prevent performative test claims. |
| 2026-04-07 | Researched PDF color space taxonomy via Google AI Mode reference (https://share.google/aimode/4ZYeAWEVbLSAokCgU) — covers Device (DeviceGray/RGB/CMYK), CIE-Based (CalGray/CalRGB/Lab/ICCBased), Special (Indexed/Separation/DeviceN/Pattern), and content stream operators for each category. Confirmed UI toggles `convertDeviceRGB`, `convertDeviceCMYK`, `convertDeviceGray` exist in config and flow through the pipeline, but currently only control the early-exit check in `convertColorStreaming` — Device color operators (rg/RG/g/G/k/K) are counted but passed through unchanged. For RGB output intent: DeviceCMYK and DeviceRGB in GhostScript-generated slugs/docket would violate PDF/X-4; DeviceGray is allowed in both CMYK and RGB output intents. PostScript math for Device color conversion (DeviceCMYK→DeviceRGB etc.) still pending. |
