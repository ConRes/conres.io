# Generator User Flow — PROGRESS

**Created:** 2026-03-30  
**Last Updated:** 2026-03-30  
**Status:** Planning

---

## Context

The generator UI was built as a development interface. Now that the core pipeline works across Chrome, Firefox, and Safari, the UI needs clear user instructions so the team can use it independently — without requiring the developer to answer the same questions repeatedly.

### Critical Requirements

1. Users must use the **most recent test form version** (currently CR1 F10a)
2. Users must use a **calibrated ICC profile specific to their substrate, colorants, device, and printing settings**
3. Users must **submit the docket PDF file digitally** — it contains the ICC profile and all generation metadata

---

## Current Problems

| Problem                                                     | Where                   | Impact                                                               |
| ----------------------------------------------------------- | ----------------------- | -------------------------------------------------------------------- |
| No clear user instructions                                  | Generator UI            | Team asks the developer every time                                   |
| Requirements section says "Latest version of Adobe Acrobat" | Overview → Requirements | Outdated — color engine eliminated this dependency                   |
| Old test form versions are equally prominent in dropdown    | Configuration → Assets  | Users pick wrong version                                             |
| ICC profile instruction is generic                          | Configuration → Output  | Users don't understand it must match their exact printing conditions |
| Generation section says "metadata file must be submitted"   | Generation              | Docket PDF replaced metadata.json — text is stale                    |
| No mention that docket must be sent digitally               | Generation + Docket PDF | Team sends only prints, not the digital file                         |
| No explanation of what QR codes contain or why they matter  | Nowhere                 | Team doesn't understand traceability                                 |
| No explanation of what the docket is for                    | Nowhere                 | Team treats it as optional                                           |
| Docket PDF has no user instructions printed on it           | Docket PDF              | Recipient doesn't know what to do with it                            |

---

## User Flow

### Step 1: Open Generator

1. Navigate to the generator URL
2. Read the brief introduction (2-3 sentences)
3. Optionally open the **Read More** modal for full technical documentation

### Step 2: Select Test Form Version

1. Select the **current version** from the dropdown (defaults to most recent)
2. Old versions are available under a collapsed "Previous Versions" group
3. Clear cache if assets need to be re-downloaded

### Step 3: Select Output Profile

1. Select the calibrated ICC profile file (`.icc` or `.icm`)
2. The profile must be calibrated for the **specific combination** of:
   - Print device (make and model)
   - Colorants (ink set)
   - Substrate (paper/media type)
   - Print settings (resolution, screening, etc.)
3. The generator auto-detects the profile's color space (CMYK, RGB, or Gray) and selects the appropriate assembly plan

### Step 4: Enter Specifications

1. **Device** — the print system make and model
2. **Colorants** — the ink set used
3. **Substrate** — the media type
4. **Settings** — print settings (resolution, screening, etc.)
5. **Email** — participant's email address (embedded in slug QR codes for traceability)

### Step 5: Generate

1. Click **Generate**
2. The generator produces:
   - **Docket PDF** — downloaded first, contains ICC profile + all metadata
   - **Test Form PDF(s)** — the actual pages to print
3. Both files are auto-downloaded

### Step 6: After Generation

1. **Keep the docket PDF** — do not delete it
2. **Submit the docket PDF digitally** to the team alongside the physical prints
3. **Print the test form PDF(s)** using the exact ICC profile and settings specified
4. The docket does NOT need to be printed

---

## Slug QR Code Contents

Each page in the test form has a slug area containing a QR code. The QR code encodes (per `slugs.ps`):

```
<SlugHeader>          — "Slug CR 20250322 - <profileCategory>"
<SlugTitle>           — page title (and variant if present)
<SlugParameters>      — source color space + resolution
<SlugOutputParameters> — rendering intent + output profile name
<SlugFooter>          — participant email + generation timestamp
```

### Purpose

The slug QR code ties each **printed page** back to:

- The specific test form digital file
- The layout and source color space
- The output profile and rendering intent used
- The participant and generation session

This is essential for sorting scanned pages from different round-robin participants.

---

## Asset-Level Barcodes

Assets contain embedded barcodes (QR or PDF417) **independent of the slug QR codes**. These identify the source asset, variant, and version.

### Barcode Details by Asset Type

| Asset                            | Barcode Type | Color Space Variants   | Distinguisher                                                                                                 | Notes                                                                                |
| -------------------------------- | ------------ | ---------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| **ConRes 21 (CR21)**             | QR           | sRGB, sGray, Lab, SepK | Per-variant QR with color space, target layout configuration (rows, columns), intended for automated analysis | Robust configuration system in PostScript developed by Franz                         |
| **ConRes 20 (TV25 vs TV75)**     | QR           | sRGB, sGray, Lab       | "sRGB", "sGray", or "Lab" distinguisher                                                                       | Each has its own PostScript-generated source asset                                   |
| **CR21 vs CR20**                 | PDF417       | sRGB, sGray, Lab       | Color space distinguisher                                                                                     | Each has its own PostScript-generated source asset                                   |
| **Interlaken Aerial**            | PDF417       | sRGB, sGray            | Same barcode — same source asset (sGray is grayscale conversion of sRGB)                                      | Single source, color-space-independent code                                          |
| **Interlaken Map (vector)**      | PDF417       | sRGB, sGray            | "color" or "gray" distinguisher                                                                               | Different source assets — separate PostScript files                                  |
| **Vitznau Map (vector contour)** | PDF417       | sRGB, sGray            | "color" or "gray" distinguisher                                                                               | Different source assets — separate PostScript files                                  |
| **London (pictorial)**           | PDF417       | sRGB only              | 2 elements, each with PDF417                                                                                  | Same code regardless of conversion color space                                       |
| **Winter Trees (pictorial)**     | PDF417       | sRGB only              | 4 elements, each with PDF417                                                                                  | Same code regardless of conversion color space                                       |
| **Lake and Cat (pictorial)**     | PDF417       | sRGB only              | 2 elements, each with PDF417                                                                                  | Same code regardless of conversion color space                                       |
| **Type Sizes**                   | PDF417       | sGray, SepK            | 4 elements (Palatino, Palatino Italic, Helvetica, Edwardian Script), each with PDF417                         | Needs revision before round-robin — sGray and SepK variants need distinguisher codes |
| **Lissajou**                     | PDF417       | sGray, SepK            | 2 elements (Frames, Shapes), each with PDF417                                                                 | Needs revision before round-robin — sGray and SepK variants need distinguisher codes |

### Barcode Hierarchy

All asset-level barcodes work **in tandem** with the slug QR code:

1. **Slug QR** → identifies the page, participant, output profile, rendering intent
2. **Asset barcode** → identifies the specific source asset, variant, version

Together, these enable the **TestFormSegmenter** (in development) to automate the segmentation process — splitting scanned pages into individual assessment targets for perceptual psychometrics testing.

---

## Docket PDF Requirements

### Current State

- Generated as a separate PDF with metadata embedded
- Contains ICC profile, generation parameters, page list
- Downloaded automatically before the main test form PDF

### Required Changes

1. Add a **brief explainer section** in the docket's bounding area before the metadata details:
   - What the docket is
   - That it must be **kept and submitted digitally** alongside physical prints
   - That it does **not** need to be printed
2. Contact information: deferred — during dry-runs, participants have direct access to the team. Will address before actual round-robin runs.

---

## Generator UI Changes

### Overview Section

- **Brief introduction** (2-3 sentences) — what the generator does
- **Read More** button → opens modal with full technical documentation covering:
  - Slug QR code contents and purpose
  - Asset-level barcodes and their role
  - How traceability works (slug + asset barcodes → TestFormSegmenter)
  - Color space handling (sRGB, sGray, Lab, SepK)
  - Output profile requirements
  - Docket purpose and handling

### Requirements Section

Replace current content with:

- Calibrated ICC profile for the specific substrate, colorants, device, and printing settings
- Modern web browser (Chrome, Firefox, or Safari)
- Remove "Latest version of Adobe Acrobat"

### Assets Section

- Default to most recent version (already done)
- Collapse previous versions under a less prominent group
- Add visual indicator (badge or label) for the current recommended version

### Output Section

- Emphasize that the ICC profile must match the **exact printing conditions**
- Add helper text explaining what "calibrated" means in this context

### Generation Section

- Replace "metadata file" language with "docket PDF"
- Add clear instruction: "The docket PDF must be submitted digitally to the team alongside your physical prints"
- Add: "The docket contains your ICC profile and all generation parameters — without it, your prints cannot be processed"

---

## Dynamic Field Guidance Design

### Data Sources

| Source                               | Provides                                                               | When Loaded                   |
| ------------------------------------ | ---------------------------------------------------------------------- | ----------------------------- |
| `generator/assets.json`              | Test form entries with dates, version codes, resource paths            | On page load                  |
| `generator/details.json`             | Field-level explanations, parameterized with `{{version}}`, `{{date}}` | On page load                  |
| Selected test form's `manifest.json` | Pages, layouts, color spaces, source bit depth, docket config          | On test form selection change |
| Assembly policy (already loaded)     | Profile categories, rendering intent passes                            | After ICC profile selection   |

### Recommended Defaults (deterministic)

| Field             | Recommended                                                       | How Determined                                                    |
| ----------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------- |
| Test form version | First entry in `assets.json` without `(8-bit)` or `- Maps` suffix | Sort by date descending, exclude variants                         |
| Output bit depth  | 8-bit                                                             | Fixed — 16-bit source → 8-bit output is the standard workflow     |
| Output profile    | CMYK calibrated ICC                                               | From assembly policy; sRGB supported but not the primary use case |
| Gray profiles     | Not yet supported — use sRGB                                      | Temporary; Gray support in progress                               |

### Non-Recommended Highlight Criteria

| Field             | Condition                                         | Highlight Message                                                                                                                          |
| ----------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Test form version | Not the recommended (most recent non-8-bit) entry | "A newer version is available: {{recommended}}. Using older versions may produce results that are not comparable with other participants." |
| Test form version | 8-bit variant selected                            | "The 8-bit variant is for systems that cannot process 16-bit source data. Use the standard version unless you have a specific reason."     |
| Output bit depth  | 16-bit selected                                   | "16-bit output is only needed if your RIP and workflow specifically require it. Most printing systems use 8-bit."                          |
| Output bit depth  | "Same as Source" selected                         | "This will produce 16-bit output from 16-bit sources. Only use this if your workflow requires matching source bit depth."                  |
| Output profile    | Gray ICC detected                                 | "Gray output profiles are not yet fully supported. Use an sRGB profile for now — Gray support is in development."                          |

### Manifest-Derived Guidance (shown on test form selection)

| Detail               | Source                                 | Display                                                 |
| -------------------- | -------------------------------------- | ------------------------------------------------------- |
| Number of pages      | `manifest.pages.length`                | "This test form has {{n}} pages"                        |
| Color spaces present | Unique `manifest.layouts[].colorSpace` | "Source color spaces: sRGB, sGray, Lab, SepK"           |
| Source bit depth     | From asset PDF filename or manifest    | "Source bit depth: 16-bit" or "Source bit depth: 8-bit" |
| Barcode types        | `manifest.assets[].barcodes`           | Summarized in Read More modal                           |

### Persistence and Version Detection

- `localStorage` key: `conres-testform-generator-state` (existing)
- Persisted state gains a new field: `recommendedAtSave` — the recommended test form name at the time the state was last saved
- On load:
  1. Determine current recommended test form (from `assets.json`)
  2. Compare `recommendedAtSave` against current recommended
  3. If they differ (meaning a new version was published since last use):
     - Clear **only** the persisted `test-form-version` field (keep other fields like specifications and email)
     - Default the dropdown to the new recommended version
     - Highlight the test form field to indicate a new version is available
  4. If they match: restore the persisted `test-form-version` as normal (even if the user deliberately chose an older version last time)
- On save: always store `recommendedAtSave` alongside the current selections
- Version comparison: identity check on the full entry name string (not date extraction — avoids parsing edge cases)

### `details.json` Structure

```json
{
  "fields": {
    "testFormVersion": {
      "recommended": "Use the most recent version for compatibility with other participants.",
      "nonRecommended": "A newer version is available: {{recommended}}. Older versions may not be comparable.",
      "eightBit": "The 8-bit variant is for systems that cannot process 16-bit source data.",
      "maps": "The Maps variant includes only the map assets — use the standard version for the full test form."
    },
    "outputProfile": {
      "default": "Select the ICC profile calibrated for your exact device, colorants, substrate, and print settings.",
      "cmyk": "CMYK profile detected: {{description}}.",
      "rgb": "RGB profile detected: {{description}}. The test form will be converted to this RGB color space.",
      "gray": "Gray profiles are not yet fully supported. Use an sRGB output profile for now."
    },
    "outputBitDepth": {
      "8-bit": "Standard precision — suitable for most printing systems.",
      "16-bit": "Higher precision — use only if your RIP and workflow require 16-bit data.",
      "auto": "Matches the source asset bit depth ({{sourceBitDepth}} for this test form)."
    }
  },
  "docket": {
    "explainer": "This docket contains the ICC profile and all parameters used to generate your test form. Keep this file and submit it digitally alongside your physical prints. Do not print the docket."
  }
}
```

---

## Roadmap

- [x] **Step 1** — Create `generator/details.json` with field guidance content
- [x] **Step 2** — Add recommended version detection and persistence clearing to `test-form-generator-app-element.js`
- [x] **Step 3** — Add dynamic field guidance display (contextual `<small>` elements under each field)
- [x] **Step 4** — All text/styling driven by `details.json` entries (`text`, `warn`, `highlight`)
- [x] **Step 5** — Update Overview, Requirements, and Generation section text in `index.html` (all from `details.json`)
- [ ] **Step 6** — Add docket explainer to the docket PDF generation
- [ ] **Step 7** — Write the detailed technical documentation content (for the Read More modal) `IN-PROGRESS`
- [ ] **Step 8** — Implement the Read More modal `IN-PROGRESS`
- [ ] **Step 9** — Review with Cowork for completeness and accessibility
- [ ] **Step 10** — Test the full user flow in all three browsers

---

## Activity Log

### 2026-03-30

- Audited current generator UI (index.html) and identified 9 problems
- Documented complete user flow (6 steps with sub-steps)
- Documented slug QR code contents (from slugs.ps and GhostscriptService.processSlugTemplate)
- Documented asset-level barcodes for all 23 assets (from manifest.json)
- Documented barcode hierarchy and relationship to TestFormSegmenter
- Created progress document for Cowork input
