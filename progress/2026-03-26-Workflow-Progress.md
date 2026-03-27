# 2026-03-26 Workflow Progress

## Last Updated: 2026-03-26

## Current Status: Planning

---

## Roadmap

### 1. Docket PDF (replaces metadata.json download)

Replace the metadata.json file download with a single-page "Docket" PDF when specified in manifest.json.

**Manifest schema** (from F10a manifest):

```json
"docket": {
    "colorSpace": "sRGB",
    "assets": [{ "asset": "CR21", "colorSpace": "sRGB" }],
    "bounds": { "x": 407, "y": 33.5, "width": 347, "height": 528, "unit": "points" }
}
```

**Requirements:**

- [x] Only generated when manifest includes `{ docket: { ... } }` — fall back to metadata.json otherwise
- [x] Single-page PDF using the docket asset page from the test form
- [x] Print-friendly representation of fields and options within `docket.bounds` coordinates
- [x] Default to full page with 1 inch margins if no bounds specified
- [x] Embed metadata.json (excluding `color.profile.contents`) as PDF attachment or metadata stream
- [x] Convert docket page to output intent same as rest of PDFs (retains color profile)
- [x] Update both main-thread and bootstrap-worker download paths

**Implementation approach:**

- New class: `DocketPageGenerator` in `generator/classes/`
- Receives metadata JSON, docket config, converted asset page
- Renders field labels + values as text within bounds
- Embeds metadata JSON via `PDFService.attachManifestToPDF()`

### 2. Remove Lab K-Only GCR Special Handling (Task 3)

Now safe because non-Max-GCR CMYK profiles produce separate PDFs per rendering intent, so Lab images will only ever be processed with Relative Colorimetric in those cases.

**Locations to update:**

| File                                                                  | What to Remove                                                            |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `services/PDFService.js` (~lines 865-880)                             | Lab → Relative Colorimetric substitution in content stream color handling |
| `services/PDFService.js` (~lines 1179-1196)                           | Lab image intent substitution                                             |
| `classes/root/pdf-content-stream-color-converter.js` (~lines 207-215) | `getEffectiveRenderingIntent()` Lab override                              |
| `classes/root/stream-transform-worker.js`                             | Lab intent substitution in worker                                         |

- [x] Disabled via `"disabled": true` on `relative-colorimetric-lab-fallback` policy in `color-conversion-rules.json`
- [x] Updated `baseline/color-conversion-policy.js` `#loadRulesForEngine()` to honor `disabled` at policy and rule level
- [ ] Verify with existing tests (`yarn test`)
- [ ] Test with non-Max-GCR CMYK profile to confirm Lab pages render correctly

### 3. Gray Output Profile Support (Task 4)

Add a new `Gray` profile category to the assembly policy system.

**Requirements:**

- [x] Add `Gray` profile category to `assembly-policy.json` (user)
  - `profileColorSpace: "Gray"`, included: `Gray`, `Lab`, excluded: `DeviceN`
  - Same rendering intent as RGB (Relative Colorimetric + BPC)
  - Added `profileColorSpace` field to all existing categories
  - Added `"Gray": "Gray"` to `profileCategoryLabels`
- [x] Make `OutputProfileAnalyzer` policy-driven (replaces hardcoded RGB/CMYK checks)
  - Matches ICC `colorSpace` against `profileColorSpace` fields (case-insensitive)
  - Single match → return immediately; multiple matches → Max GCR test
  - No match → throws with supported list from policy
- [x] Update `ProfileCategoryDefinition` typedef in `AssemblyPolicyResolver`
- [x] Remove hardcoded color space validation in `test-form-pdf-document-generator.js`
- [x] Update UI auto-state preview to use policy-driven analyzer
- [ ] Test with sGray.icc profile

### 4. Specification Input Validation (shared with Interface Progress)

See `progress/2026-03-26-Interface-Progress.md` task 4 for validation details. This section tracks the workflow-side changes:

- [ ] Ensure validation errors prevent generation start
- [ ] Debug mode bypasses required field validation (already exists)

---

## Activity Log

### 2026-03-26

- Created progress document
- Analyzed F10a manifest to understand docket schema
- Mapped all Lab K-Only GCR special handling locations
- Identified assembly-policy.json changes needed for Gray profile support
- Implemented docket PDF generation:
  - Added `#generateDocketPDF()` to test-form-pdf-document-generator.js
  - One page per rendering intent pass, each with converted background asset
  - Metadata text drawn within docket.bounds (labels + values)
  - Footer on each page indicating which intent was used for conversion
  - All selected intents listed in the metadata section
  - Slugs generated and embedded on docket pages
  - Stripped metadata.json (minus ICC profile base64) attached to PDF
  - Post-processed with decalibration + output intent
  - Hooked into all three generation paths (in-place, multi-intent, separate-chains/recombined)
  - Updated UI to download Docket.pdf instead of metadata.json when available
  - Deferred metadata download in onChainOutput to post-generation for proper docket handling
  - Docket runs as litmus test BEFORE main pipeline — failure aborts everything
  - Downloaded via onDocketReady callback before test form PDFs
  - Full ICC profile header, output bit-depth, assembly filter state (vector radios/checkboxes)
  - DeviceCMYK K-only black, line wrapping, no clipping mask issues
  - Shared #downloadGenerationResult for main-thread and worker parity
  - Worker sends docket-ready message with transferable buffer
  - All return paths include docketPDFBuffer
- Disabled Lab K-Only GCR override:
  - Added `"disabled": true` on relative-colorimetric-lab-fallback policy
  - Updated baseline #loadRulesForEngine() to honor disabled at policy and rule level
