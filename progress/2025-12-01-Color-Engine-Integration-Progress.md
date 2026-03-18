# Color Engine Integration Progress

**Project:** ConRes PDF Test Form Generator  
**Purpose:** Integrate Color Engine for in-browser color transformation, eliminating Adobe Acrobat dependency  
**Last Updated:** 2026-02-03
**Status:** 🟢 Lab Output Support - Lab color space for content streams and images, 32-bit policy decision pending

---

## Executive Summary

The goal is to integrate the ConRes Color Engine (JavaScript or WebAssembly implementation) into the existing PDF processing workflow to enable direct color transformations without requiring Adobe Acrobat. This involves:

1. Refactoring `PDFService.js` to extract reusable color manipulation code
2. Creating a new `convertColor` method that uses the Color Engine
3. Setting up tests with `playwright-chromium` + `node:test`
4. Updating HTML entrypoints to use the new streamlined workflow

---

## Architecture Overview

### Current Workflow (Adobe Acrobat Required)

```
┌─────────────┐    ┌────────────────┐    ┌──────────────────┐    ┌─────────────┐
│ Download    │ -> │ Manual Acrobat │ -> │ Validate         │ -> │ Generate    │
│ PDF         │    │ Color Convert  │    │ Color-Converted  │    │ Labelled    │
└─────────────┘    └────────────────┘    └──────────────────┘    └─────────────┘
```

### Target Workflow (Color Engine Integrated)

```
┌─────────────┐    ┌──────────────────┐    ┌──────────────────┐    ┌─────────────┐
│ Download    │ -> │ In-Browser       │ -> │ Validate         │ -> │ Generate    │
│ PDF         │    │ Color Transform  │    │ Color-Converted  │    │ Labelled    │
└─────────────┘    └──────────────────┘    └──────────────────┘    └─────────────┘
                   (Color Engine)
```

---

## Key Files

### Primary Files to Modify

| File                                                  | Description                                            | Status           |
| ----------------------------------------------------- | ------------------------------------------------------ | ---------------- |
| `testing/iso/ptf/2025/services/PDFService.js`         | PDF manipulation service with `decalibratePDFDocument` | ✅ Refactored    |
| `testing/iso/ptf/2025/generate.js`                    | Main generator with `TestFormGenerator` class          | 🔴 Needs Update |
| `testing/iso/ptf/2025/index.html`                     | Main HTML entrypoint                                   | 🔴 Needs Update |
| `testing/iso/ptf/2025/experiments/convert-color.html` | Standalone color conversion page                       | 🔴 Needs Update |

### Secondary Files

| File                                                          | Description                  | Status              |
| ------------------------------------------------------------- | ---------------------------- | ------------------- |
| `testing/iso/ptf/2025/services/ICCService.js`                 | ICC profile parsing service  | ✅ Ready            |
| `testing/iso/ptf/2025/services/GhostscriptService.js`         | GhostScript WASM integration | ✅ Ready            |
| `testing/iso/ptf/2025/helpers.js`                             | Utility functions            | ✅ Ready            |
| `testing/iso/ptf/2025/experiments/embed-output-intent.html`   | Output intent embedding page | 🟡 May Need Update |
| `testing/iso/ptf/2025/experiments/decalibrate/decalibrate.js` | Decalibration experiment     | 🟡 Reference Only  |

### New Files Created

| File                                                       | Description                                        | Status              |
| ---------------------------------------------------------- | -------------------------------------------------- | ------------------- |
| `testing/iso/ptf/2025/services/ColorSpaceUtils.js`         | Color space analysis & content stream parsing      | ✅ Complete         |
| `testing/iso/ptf/2025/services/ColorEngineService.js`      | Color Engine abstraction layer (WASM connected)    | ✅ Complete         |
| `testing/iso/ptf/2025/services/helpers/pdf-lib.js`         | pdf-lib utility helpers                            | ✅ Complete         |
| `testing/iso/ptf/2025/services/legacy/LegacyPDFService.js` | Legacy PDFService for parity testing               | ✅ Complete         |
| `testing/iso/ptf/2025/tests/PDFService.test.js`            | Tests for PDFService                               | ✅ 7 Tests Passing  |
| `testing/iso/ptf/2025/tests/ColorSpaceUtils.test.js`       | Tests for ColorSpaceUtils (analyzePageColors, etc) | ✅ 11 Tests Passing |
| `testing/iso/ptf/2025/tests/ColorEngineService.test.js`    | Tests for ColorEngineService & WASM Color Engine   | ✅ 16 Tests Passing |
| `testing/iso/ptf/2025/tests/WorkflowIntegration.test.js`   | Full workflow integration tests                    | ✅ 12 Tests Passing |
| `testing/iso/ptf/2025/tests/playwright.config.js`          | Playwright configuration                           | ✅ Complete         |
| `testing/iso/ptf/2025/tests/run-tests.js`                  | Test runner script                                 | ✅ Complete         |

---

## Task Breakdown

### Phase 1: Test Infrastructure Setup

> <big>✅ COMPLETE</big>
>
> **Priority:** High  
> **Dependencies:** None  
> **Completed:** 2025-12-04

- [x] **1.1** Install `playwright-chromium` as dev dependency
- [x] **1.2** Create `playwright.config.js` for browser-based testing
- [x] **1.3** Create test runner script using `node:test`
- [x] **1.4** Create test fixtures directory with sample PDFs
- [x] **1.5** Write initial smoke tests for existing `PDFService` methods

#### Phase 1: Acceptance Criteria

- [x] Tests can be run with `node --test`
- [x] Playwright can launch Chromium and load test pages
- [x] At least 3 existing `PDFService` methods have passing tests (8 tests passing)

---

### Phase 2: PDFService Refactoring

> <big>✅ COMPLETE</big>
>
> **Priority:** High  
> **Dependencies:** Phase 1  
> **Completed:** 2025-12-04

- [x] **2.1** Extract `UniqueColorSpaceRecords` class to separate file (`ColorSpaceUtils.js`)
- [x] **2.2** Create reusable color space analysis utilities
  - [x] `analyzeColorSpaces(pdfDocument)` - Main analysis function
  - [x] `isICCBasedColorSpace(descriptor)` - Type checker
  - [x] `getDeviceColorSpaceForICC(colorSpace)` - Device space mapper
  - [x] `getICCProfileRefFromColorSpace(descriptor)` - Profile extraction
  - [x] `parseICCProfileFromRef(pdfDocument, ref)` - Profile parsing
  - [x] `replaceICCWithDeviceColorSpaces(pdfDocument, analysis)` - Decalibration
- [x] **2.3** Refactor `decalibratePDFDocument` to use extracted utilities
- [x] **2.4** Add comprehensive JSDoc types for all public methods
- [x] **2.5** Write tests for refactored methods

#### Phase 2: Key Methods in PDFService Status

| Method                               | Status        | Notes                                          |
| ------------------------------------ | ------------- | ---------------------------------------------- |
| `attachManifestToPDF`                | ✅ Keep       | Working correctly                              |
| `lookupPDFDocumentAttachementByName` | ✅ Keep       | Working correctly                              |
| `extractManifestFromPDF`             | ✅ Keep       | Working correctly                              |
| `extractICCProfilesFromPDF`          | ✅ Keep       | Needed for color analysis                      |
| `setOutputIntentForPDF`              | ✅ Keep       | Needed for output intent                       |
| `embedSlugsIntoPDF`                  | ✅ Keep       | Working correctly                              |
| `replaceTransarencyBlendingSpace`    | ✅ Keep       | Working as-is                                  |
| `decalibratePDFDocument`             | ✅ Refactored | Now uses ColorSpaceUtils                       |
| `decalibratePDFDocumentLegacy`       | ✅ Preserved  | Original verbose version                       |
| `convertDocumentColors`              | ✅ Added      | Full document color conversion (location only) |
| `dumpPDFInfo`                        | ✅ Keep       | Debugging utility                              |
| ~~`convertColor`~~                   | ❌ Removed    | Redundant delegation to ColorEngineService     |
| ~~`convertColors`~~                  | ❌ Removed    | Redundant delegation to ColorEngineService     |
| ~~`getColorEngine`~~                 | ❌ Removed    | Use ColorEngineService directly                |
| ~~`setColorEngine`~~                 | ❌ Removed    | Use ColorEngineService directly                |

#### Phase 2: Acceptance Criteria

- [x] All existing tests still pass (8/8 tests passing)
- [x] New utility functions have comprehensive types
- [x] `decalibratePDFDocument` behavior unchanged (refactored to use utilities)

---

### Phase 3: ColorEngineService Creation ✅ COMPLETE
>
> **Priority:** High
> **Dependencies:** Phase 2
> **Completed:** 2025-12-16

- [x] **3.1** Create `ColorEngineService.js` abstraction layer
  - [x] Basic structure with `convertColor()`, `convertColors()`, `convertPDFColors()` methods
  - [x] Rendering intent support (perceptual, relative-colorimetric, saturation, absolute-colorimetric, preserve-k-only-relative-colorimetric-gcr)
  - [x] Black point compensation support
  - [x] **Actual WASM Color Engine integration** (LittleCMS via `@conres/color-engine`)
- [x] **3.2** Create profile loading utilities
  - [x] `loadProfile(buffer)` - ICC profile loader
  - [x] Profile caching for efficiency
  - [x] `#getPixelFormat()` - maps color types to LittleCMS pixel formats
  - [x] `#getRenderingIntentConstant()` - maps intent strings to LittleCMS constants
  - [x] `#getColorTypeFromHeader()` - determines output color type from ICC header
- [x] **3.3** Write comprehensive tests for ColorEngineService (16 tests passing)
  - [x] WASM engine initialization tests
  - [x] ICC profile loading tests
  - [x] Color transform creation tests
  - [x] RGB to CMYK conversion tests
  - [x] K-Only intent validation tests
- [x] **3.4** K-Only GCR rendering intent support
  - [x] `INTENT_PRESERVE_K_ONLY_RELATIVE_COLORIMETRIC_GCR` constant (value: 20)
  - [x] Neutral grays convert to K-only output

#### Phase 3: ColorEngineService API Design

```javascript
// Proposed API
class ColorEngineService {
    static async create(options?: { preferJavaScript?: boolean }): Promise<ColorEngineService>;
    
    async initialize(cmykProfileBuffer: ArrayBuffer): Promise<void>;
    
    transformPixels(rgbPixels: Uint8Array, pixelCount: number): Uint8Array;
    
    validateKOnlyOutput(cmykPixels: Uint8Array): ValidationResult;
    
    dispose(): void;
}
```

#### Phase 3: Acceptance Criteria

- ColorEngineService can transform RGB to CMYK with K-Only GCR
- Both JS and WASM backends work identically
- All tests pass with both backends

---

### Phase 4: convertDocumentColors Method Implementation

> <big>🟡 IN PROGRESS</big>
>
> **Priority:** High  
> **Dependencies:** Phase 3  
> **Estimated Effort:** 6-8 hours

- [x] **4.1** Add `convertDocumentColors` static method to `PDFService`
- [x] **4.2** Implement color location discovery
  - [x] `ImageColorLocation` - tracks images with color spaces and ICC profiles
  - [x] `ContentStreamColorLocation` - tracks colors in content streams
  - [x] `ICCProfileLocation` - tracks ICC profile streams with usage info
  - [x] `ColorSpaceDefinitionLocation` - tracks color space definitions for replacement
- [x] **4.3** Content stream parsing utilities in `ColorSpaceUtils.js`
  - [x] `COLOR_OPERATOR_REGEX` - regex for parsing color operators
  - [x] `parseContentStreamColors()` - parses color operators from stream text
  - [x] `extractPageContentStreams()` - extracts content streams from page
  - [x] `decodeAndParseContentStream()` - decodes and parses a stream
  - [x] `analyzePageColors()` - full page color analysis
  - [x] `collectColorValuesForConversion()` - collects colors for batch conversion
- [x] **4.4** Implement actual color conversion using ColorEngineService
- [x] **4.5** Implement content stream color value replacement
- [x] **4.6** Implement image pixel extraction and replacement (8-bit, FlateDecode only)
- [x] **4.7** Handle transparency blending color space replacement (via full workflow integration)
- [x] **4.8** Write comprehensive tests for `convertDocumentColors`

#### Phase 4: convertDocumentColors Method Design

```javascript
// Current API (implemented)
static async convertDocumentColors(
    pdfDocument: PDFDocument,
    options: {
        sourceProfile?: ArrayBuffer | string,
        destinationProfile: ArrayBuffer | string,
        renderingIntent?: RenderingIntent,
        convertImages?: boolean,
        convertContentStreams?: boolean,
        updateBlendingSpace?: boolean,
        verbose?: boolean,
    }
): Promise<DocumentConversionResult>;

// DocumentConversionResult includes:
// - pagesProcessed, totalColorSpaceConversions, totalContentStreamConversions, totalImageConversions
// - pageResults: PageConversionResult[]
// - imageColorLocations: ImageColorLocation[]
// - contentStreamColorLocations: ContentStreamColorLocation[]
// - iccProfileLocations: Map<PDFRef, ICCProfileLocation>
// - colorSpaceDefinitionLocations: Map<PDFArray | PDFName, ColorSpaceDefinitionLocation>
```

#### Phase 4: Acceptance Criteria

- [x] Can convert all RGB/Gray color spaces to CMYK
- [x] K-Only GCR works for neutral grays
- [x] Transparency blending spaces are updated (via full workflow integration)
- [x] Lab output support for content streams and images (8-bit, 16-bit)
- [ ] Lab 32-bit output: Policy decision pending (PDF spec limits images to 16-bit max)
- [ ] Output matches Adobe Acrobat reference conversions (within tolerance)
  - [ ] Analyze Adobe Acrobat reference PDF to identify matching elements
  - [ ] Determine the reasonable tolerances in a `JSON` file with the `- Specs.json` next to the respective reference PDF
  - [ ] Use the tolerances defined in the `<PDF> - Spec.json` files when testing.

---

### Phase 5: Workflow Integration

> <big>🟡 IN PROGRESS</big>
>
> **Priority:** Medium
> **Dependencies:** Phase 4
> **Estimated Effort:** 4-6 hours

- [x] **5.1** Update `TestFormGenerator` stages
  - [x] Add `colorConversionStage` implementation
  - [x] Make Adobe Acrobat step optional/conditional
- [x] **5.2** Update `index.html` UI
  - [x] Add profile upload input
  - [x] Add color conversion progress indicator
  - [x] Add rendering intent selector
  - [x] Added "In-Browser Color Conversion (Beta)" section
- [x] **5.3** Manual Acrobat workflow preserved as fallback
- [ ] **5.4** Update `convert-color.html` standalone page (optional, lower priority)
- [ ] **5.5** Write E2E tests for full workflow (optional, lower priority)

#### Phase 5: Acceptance Criteria

- [x] Users can complete full workflow without Adobe Acrobat
- [x] Manual workflow still available as fallback
- [ ] E2E tests verify complete workflow (optional)

---

### Phase 6: Cleanup and Documentation

> <big>🟡 IN PROGRESS</big>
>
> **Priority:** Low
> **Dependencies:** Phase 5
> **Estimated Effort:** 2-4 hours

- [x] **6.1** Inline documentation (JSDoc) for all new methods
- [x] **6.2** Updated `CLAUDE.md` with autonomous work guidelines
- [x] **6.3** Updated phase tracking and status in this document
- [ ] **6.4** Update `2025-12-01-Color-Engine-API-Reference.md` (optional)
- [ ] **6.5** Create usage examples (optional)
- [ ] **6.6** Update README.md in `testing/iso/ptf/` folder (optional)

#### Phase 6: Acceptance Criteria

- [x] All methods have JSDoc documentation
- [x] CLAUDE.md is up to date
- [x] Progress document reflects current state
- [ ] Usage examples documented (optional)

---

## Performance Summary

**For detailed analysis, see:** [PERFORMANCE-ANALYSIS.md](testing/iso/ptf/2025/experiments/PERFORMANCE-ANALYSIS.md)

### Final Benchmark (2025-12-19-021)

| PDF            | Pages | Baseline | Workers (auto) | Speedup | Output Size |
| -------------- | ----- | -------- | -------------- | ------- | ----------- |
| Interlaken Map | 3     | 2m 56.7s | 2m 50.0s (3w)  | 1.04x   | 93.6 MB     |
| Full Test Form | 28    | 5m 53.7s | 4m 53.2s (7w)  | 1.21x   | 1.12 GB     |

**Worker count:** Auto-detected via `min(floor(cpuCount/2), pageCount)` on 14-core Apple M4 Pro.

### Optimizations Implemented

| Optimization               | Impact                      | Date       |
| -------------------------- | --------------------------- | ---------- |
| Transform/profile caching  | ~15% time reduction         | 2025-12-18 |
| Content stream compression | 75% file size reduction     | 2025-12-18 |
| Worker parallelization     | 21% speedup (large PDFs)    | 2025-12-19 |
| SIMD acceleration          | 47M px/s peak throughput    | 2025-12-19 |
| Adaptive BPC clamping      | 3x speedup for binary masks | 2025-12-19 |
| Isomorphic compatibility   | Node.js = Browser output    | 2025-12-19 |

### Isomorphic Compatibility (2025-12-19-029)

| PDF            | Pages | Node.js  | Browser  | Speedup | Size Match |
| -------------- | ----- | -------- | -------- | ------- | ---------- |
| Interlaken Map | 3     | 2m 57.6s | 2m 33.0s | 1.16x   | **YES**    |
| Full Test Form | 28    | 7m 45.3s | 7m 4.6s  | 1.10x   | **YES**    |

**Verdict:** Code produces identical functional output in both environments. Only PDF trailer metadata differs (timestamps/IDs). Browser is 10-16% faster than Node.js.

---

## Technical Notes

### Color Space Handling in PDF

The current `decalibratePDFDocument` method handles these color space types:

1. **XObjectImageColorSpaceDesignation** - Images embedded in XObject streams
2. **PageColorSpaceDesignation** - Color spaces defined in page resources

Color space definitions found:

- `DeviceRGB`, `DeviceCMYK`, `DeviceGray` - Device color spaces
- `ICCBased` - ICC profile-based color spaces
- `Lab` - CIE Lab color space
- `Separation` - Spot color definitions

### Key Integration Points

1. **Image Pixel Transformation**
   - Extract pixels from `PDFRawStream` with `/Type /XObject /Subtype /Image`
   - Transform using ColorEngineService
   - Replace stream contents

2. **Content Stream Operations**
   - Parse operators: `CS`, `cs`, `SCN`, `scn`, `G`, `g`, `RG`, `rg`, `K`, `k`
   - Transform color values in-stream
   - Update color space references

3. **Transparency Blending**
   - Find page `/Group` dictionaries with `/S /Transparency`
   - Update `/CS` key to target color space

### Testing Strategy

Use `playwright-chromium` for browser-based testing because:

- PDF manipulation happens in browser context
- Color Engine (especially WASM) requires browser APIs
- Can test actual UI workflows

Test categories:

1. **Unit tests** - Individual utility functions
2. **Integration tests** - PDFService methods
3. **E2E tests** - Full generator workflow

---

## Dependencies

### Runtime Dependencies (already present)

- `pdf-lib` - PDF manipulation
- `icc` - ICC profile parsing

### Development Dependencies to Add

- `playwright-chromium` - Browser testing
- `@conres/js-color-engine` - JavaScript color engine (when ready)
- `@conres/color-engine` - WASM color engine (when ready)

---

## Risk Assessment

| Risk                                | Likelihood | Impact | Mitigation                                        |
| ----------------------------------- | ---------- | ------ | ------------------------------------------------- |
| Color accuracy differs from Acrobat | Medium     | High   | Extensive comparison testing with reference files |
| WASM engine not ready               | Medium     | Medium | JavaScript fallback available                     |
| Performance issues with large PDFs  | Low        | Medium | Batch processing, progress indicators             |
| Browser compatibility issues        | Low        | Low    | Use established libraries (pdf-lib, Playwright)   |

---

## Progress Log

### 2025-12-04

- [x] Initial codebase analysis complete
- [x] Created this tracking document
- [x] Created initial test infrastructure:
  - `testing/iso/ptf/2025/tests/playwright.config.js` - Playwright configuration
  - `testing/iso/ptf/2025/tests/PDFService.test.js` - Test suite (8 tests passing)
  - `testing/iso/ptf/2025/tests/run-tests.js` - Test runner script
  - `testing/iso/ptf/2025/tests/fixtures/` - Test fixtures directory
- [x] Updated `package.json` with test scripts and `playwright-chromium` dependency
- [x] Dependencies installed and tests verified (all 8 tests passing)
- [x] Created `ColorSpaceUtils.js` with extracted utilities:
  - `UniqueColorSpaceRecords` class
  - `analyzeColorSpaces()` function
  - `isICCBasedColorSpace()` helper
  - `getDeviceColorSpaceForICC()` helper
  - `getICCProfileRefFromColorSpace()` helper
  - `parseICCProfileFromRef()` helper
  - `replaceICCWithDeviceColorSpaces()` function
- [x] Refactored `PDFService.js`:
  - Added imports from `ColorSpaceUtils.js`
  - Added imports from `ColorEngineService.js`
  - Refactored `decalibratePDFDocument` to use new utilities
  - Preserved original as `decalibratePDFDocumentLegacy`
  - Added `convertColor()` method
  - Added `convertColors()` method
  - Added `getColorEngine()` singleton accessor
  - Added `setColorEngine()` for custom engine injection
- [x] Created `ColorEngineService.js` (stub implementation):
  - `convertColor()` method
  - `convertColors()` batch method
  - `convertPDFColors()` PDF conversion method
  - `loadProfile()` ICC profile loader
  - Rendering intent support
  - Black point compensation support
- [x] Phase 1 & 2 complete!
- [x] Added content stream parsing utilities to `ColorSpaceUtils.js`:
  - `COLOR_OPERATOR_REGEX` - comprehensive regex for color operators
  - `parseContentStreamColors()` - parses color operators from stream text
  - `extractPageContentStreams()` - extracts content streams from a page
  - `decodeAndParseContentStream()` - decodes and parses a raw stream
  - `analyzePageColors()` - full page color analysis
  - `collectColorValuesForConversion()` - collects colors for batch conversion
- [x] Implemented `convertDocumentColors()` in `PDFService.js`:
  - Added type definitions: `ImageColorLocation`, `ContentStreamColorLocation`, `ICCProfileLocation`, `ColorSpaceDefinitionLocation`
  - Phase 0: Locates all ICC profiles and color space definitions (with usage tracking)
  - Phase 1: Locates all XObject Image colors
  - Phase 2: Locates all content stream colors and page resource color spaces
  - Phase 3: Placeholder for actual color conversion (TODO)
  - Returns comprehensive result with all locations for post-conversion replacement
- [x] All 8 tests still passing

### 2025-12-05

- [x] Created `ColorSpaceUtils.test.js` with comprehensive tests for:
  - Module loading verification
  - `analyzeColorSpaces()` - full document analysis (ICC profiles, designations)
  - `analyzePageColors()` - per-page color analysis
  - `parseContentStreamColors()` - content stream parsing with edge cases
  - `extractPageContentStreams()` - content stream extraction
  - ICC profile detection and extraction
  - `getDeviceColorSpaceForICC()` - device color space mapping
  - XObject image color space detection
- [x] Updated `run-tests.js` to discover all `*.test.js` files using `glob`
- [x] All 19 tests passing (8 PDFService + 11 ColorSpaceUtils)
- [x] Test PDF analysis confirmed:
  - 20 pages with color space resources (CS0, CS1, CS2)
  - 4 ICC profiles found (2 GRAY, 1 RGB, 1 CMYK)
  - 60 XObject images (39 ICCBased, 17 Lab, 4 DeviceGray)
  - 223 color operations in content streams (197 CMYK, 20 gray, 6 RGB)

### 2025-12-16 (Session 2 - Phase 5)

- [x] **Phase 5 Complete - Workflow Integration**
- [x] Updated `generate.js`:
  - Imported `ColorEngineService` and `RenderingIntents`
  - Added `colorConversionStage` option to `TestFormGeneratorOptions`
  - Added `#colorConversionStage` method for in-browser color conversion
  - Supports file input for source PDF and destination ICC profile
  - Supports rendering intent selection including K-Only GCR
  - Shows progress feedback during conversion
  - Downloads converted PDF automatically
- [x] Updated `index.html`:
  - Added new "In-Browser Color Conversion (Beta)" section
  - Includes file inputs for source PDF and ICC profile
  - Rendering intent dropdown with all options
  - Progress bar and status output
  - Marked as beta/experimental feature
- [x] All **50 tests passing**

### 2025-12-16 (Session 2 - Phase 4.6)

- [x] **Phase 4.6 Complete - Image Pixel Conversion**
- [x] Added image processing utilities to `ColorSpaceUtils.js`:
  - `extractImageMetadata()` - extracts width, height, bpc, color space, filter
  - `getComponentsForColorSpace()` - returns component count for color space
  - `extractImagePixels()` - extracts pixels from FlateDecode/uncompressed images
  - `updateImageStream()` - replaces image stream with new pixels and color space
- [x] Implemented image conversion in `convertColorInPDFDocument`:
  - Converts RGB and GRAY ICC-based images to CMYK
  - Uses embedded ICC profile for accurate color transformation
  - Skips JPEG (DCTDecode) and 16-bit images (requires more complex handling)
  - Updates image stream dictionary (removes Filter, sets DeviceCMYK)
- [x] Added 2 new tests for image processing utilities
- [x] All **50 tests passing**

### 2025-12-16 (Session 2)

- [x] **Phase 4.4-4.5 Complete - Content Stream Color Conversion**
- [x] Added content stream color replacement utilities to `ColorSpaceUtils.js`:
  - `replaceContentStreamColors()` - replaces color values in a content stream
  - `formatColorValues()` - formats color values for PDF content streams
  - `getOperatorForColorType()` - gets the correct operator for a color type
  - `encodeContentStreamText()` - encodes content stream text to bytes
  - `isStrokeOperator()` - determines if an operator is stroke (uppercase) or fill
- [x] Updated `parseContentStreamColors()` to correctly track color operation indices
  - Fixed index calculation to point to actual color values, not match start
- [x] Implemented `convertColorInPDFDocument` Phase 3 in `PDFService.js`:
  - Creates ColorEngineService instance with destination profile
  - Converts RGB and Gray colors to CMYK using ICC profile-based transform
  - Handles sRGB/sGray built-in profiles for source colors
  - Groups replacements by page and stream for efficient batch processing
  - Applies replacements to content streams with proper operator changes
  - Updates stream dictionary (removes Filter, updates Length)
- [x] Updated `ColorEngineService.js` for built-in profile support:
  - Added `BUILTIN_PROFILES` static set: sRGB, sGray, Lab
  - Added `#openProfile()` helper for opening profiles from sources
  - Added `#getOutputTypeForProfile()` helper for determining output type
  - Gray colors are expanded to RGB (R=G=B) for transform
- [x] Added tests for content stream color replacement (2 new tests)
- [x] All **48 tests passing**

### 2025-12-16 (Session 1)

- [x] **Phase 3 Complete - ColorEngineService connected to WASM Color Engine**
- [x] Created comprehensive test suite:
  - `ColorEngineService.test.js` - 16 tests for WASM color engine integration
  - `WorkflowIntegration.test.js` - 12 tests for full PDF workflow
  - All **46 tests passing**
- [x] Added test fixtures:
  - `fixtures/profiles/eciCMYK v2.icc` - ECI CMYK ICC profile (1.8MB)
  - `fixtures/test forms/` - Reference PDFs converted with Adobe Acrobat (1.3GB each)
  - Metadata JSON with page color space information
- [x] **PDFService cleanup:**
  - Removed redundant methods: `convertColor`, `convertColors`, `getColorEngine`, `setColorEngine`
  - These were just delegations to ColorEngineService - use ColorEngineService directly
  - Fixed JSDoc anti-patterns (inline imports instead of typedef re-exports)
- [x] **ColorEngineService implementation:**
  - Connected to `@conres/color-engine` WASM wrapper (LittleCMS)
  - Implemented `convertColor()` with actual ICC profile-based color transformation
  - Added K-Only GCR rendering intent: `INTENT_PRESERVE_K_ONLY_RELATIVE_COLORIMETRIC_GCR`
  - Proper pixel format handling (TYPE_RGB_8, TYPE_CMYK_8, TYPE_Lab_8, TYPE_GRAY_8)
  - Profile caching for efficiency
  - Proper resource cleanup (closeProfile, deleteTransform)
- [x] **Key test verifications:**
  - WASM engine initializes and creates transforms
  - RGB to CMYK conversion produces correct relative values (red → low C, high M/Y)
  - K-Only intent produces K-only output for neutral grays (CMY sum < 0.15, K > 0.3)
  - Built-in sRGB and Lab profiles work correctly
- [x] Created helper utilities:
  - `services/helpers/pdf-lib.js` - decodeText, lookupMaybe helpers
  - `services/legacy/LegacyPDFService.js` - preserved for parity testing

### 2025-12-16 (Session 3 - Copilot Code Review)

- [x] **Code Review Complete**
- [x] Ran full test suite: **50/50 tests passing**
- [x] Verified all Phase 1-5 implementations against progress document
- [x] Created `COPILOT-CODE-REVIEW-SUMMARY.md` with:
  - Commands reference for development and testing
  - Sequence diagrams for color conversion workflow
  - Key code references with line numbers
  - Implementation status by phase
  - Known issues and TODOs
  - Recommendations for next steps
- [x] Updated this progress document with accurate test counts and status
- [x] Confirmed all services are properly integrated:
  - ColorEngineService: WASM LittleCMS working
  - PDFService.convertColorInPDFDocument: Content streams and images converted
  - ColorSpaceUtils: Full parsing and replacement
  - UI: In-browser conversion fieldset in index.html

### 2025-12-17 (Session 4 - CLI Tools)

- [x] **CLI Tools for Debug/Testing**
- [x] Created `testing/iso/ptf/2025/experiments/convert-pdf-color.js`:
  - Comprehensive argument parsing with rendering intent aliases (k-only, perceptual, relative, saturation, absolute)
  - Black point compensation with truthy/falsey handling
  - Verbosity levels (0=none, 1=limited, 2=moderate, 3=exhaustive)
  - Document structure generation (`--generate-document-structure`) - creates .pdf.md files
  - Image extraction (`--extract-images-only`) - extracts each image as separate PDF
  - Content stream extraction (`--extract-content-streams-only`) - extracts content without images
  - Full conversion mode with stubs for future implementation
- [x] Created `testing/iso/ptf/2025/experiments/validate-pdf.js`:
  - Validates PDF color spaces and structure
  - Reports ICC profiles found
  - Checks output intent
  - Dumps image metadata and content stream colors

### 2025-12-18 (Session 6 - K-Only GCR & Compression)

- [x] **K-Only GCR Rendering Intent Verified**
- [x] Created `test-convert-k-only-gcr.js` - test script using K-Only GCR intent
- [x] Created `analyze-k-only-gcr.js` - analysis script for verifying K-Only output
- [x] **K-Only GCR Results** (output 2025-12-18-017):
  - 76.9% true K-Only (0,0,0,K) colors
  - 13.5% nearly K-Only (CMY ≤ 0.05)
  - 90.4% success rate for neutral colors
  - Comparison with Relative Colorimetric (0.0% K-Only) proves intent is working
- [x] **FlateDecode Compression Implemented**
  - Added `compressWithFlateDecode()` to `ColorSpaceUtils.js`
  - Fixed: Uses zlib format (RFC 1950 with header), not raw deflate
  - File size reduced from 1005 MB to 378 MB (62% reduction)
- [x] **BitsPerComponent Fix**
  - Fixed `updateImageStream()` to accept and set `bitsPerComponent` parameter
  - Required for 16-bit to 8-bit image conversion
- [x] **Lab Color Space Handling**
  - Lab images (3 in test PDF) correctly converted to CMYK
  - Lab content stream colors converted
- [x] All converted PDFs validated in Adobe Acrobat (2025-12-18-014, 2025-12-18-016, 2025-12-18-017)

### 2025-12-18 (Session 7 - K-Only GCR Lab Workaround)

- [x] **K-Only GCR Lab Limitation Identified**
  - K-Only GCR LUT in ColorEngine assumes RGB input, not Lab
  - Lab colors rendered as pure black when using K-Only GCR directly
  - Root cause: `create3DLUTWithKOnlyBlack` only handles RGB inputs
- [x] **Workaround Implemented in PDFService.js**
  - Added two-step conversion for Lab with K-Only GCR:
    1. Lab → sRGB (relative-colorimetric)
    2. sRGB → CMYK (K-Only GCR)
  - Applied to both content stream colors and image pixels
  - Added TODO comments for future ColorEngine fix
- [x] **K-Only GCR Results with Workaround** (output 2025-12-18-018):
  - Page 3 Lab colors now render correctly (no longer pure black)
  - K-Only success rate: 82.6% (vs 90.4% without workaround)
  - Slight CMY values in Lab colors expected from two-step conversion
- [x] **Future Work (ColorEngine Workspace)**
  - Fix K-Only GCR LUT creation to support Lab → CMYK directly
  - This is a temporary workaround; proper fix needed in ColorEngine

### 2025-12-18 (Session 8 - Performance & File Size Optimization)

- [x] **Transform and Profile Caching**
  - Added `#transformCache` and `#profileHandleCache` to ColorEngineService
  - Added `dispose()` method for cleanup
  - ~15% performance improvement on full test form

- [x] **Content Stream Compression Fix (CRITICAL)**
  - **Bug:** Content streams were written uncompressed after color replacement
  - **Symptom:** 109 MB input → 378 MB output (3.5x larger)
  - **Fix:** Added FlateDecode compression after color replacement
  - **Result:** 109 MB input → 93.6 MB output (14% smaller)

- [x] **Full Test Form Results** (output 2025-12-18-032):
  - Input: 1.38 GB → Output: 1.12 GB (19% smaller)
  - Conversion time: 6m 16.7s (4.5 pages/min)

- [x] **Orphan Removal**
  - Added `PDFService.removeOrphanedObjects()` for cleanup
  - Removes unreferenced objects after ICC profile changes
  - Minimal impact (4 objects, 468 bytes in test)

- [x] **Code Organization**
  - Moved `compressWithFlateDecode()` to `helpers/pdf-lib.js`
  - Shared utility for image and content stream compression

### 2025-12-19 (Session 9 - Worker Parallelization & SIMD Optimization)

- [x] **Worker-Based Color Conversion**
  - Created `WorkerColorConversion.js` for parallel image processing
  - Created `StreamTransformWorker.js` for inflate → transform → deflate in worker threads
  - Created `WorkerPool.js` for managing worker threads
  - Workers receive compressed streams directly (no main thread decompression)
  - Fixed "Invalid array length" error for large PDFs by using Uint8Array instead of Array.from()
  - Fixed ICC profile decompression (profiles may be FlateDecode compressed in PDF)
  - Fixed BitsPerComponent not being set to 8 for CMYK output
  - Fixed Lab images using wrong rendering intent (K-Only GCR → Relative Colorimetric)

- [x] **Worker Benchmark Results** (output 2025-12-19-021):
  - Interlaken Map (3 pages): Baseline 2m 56.7s, Workers 2m 50.0s (1.04x with 3 workers)
  - Full Test Form (28 pages): Baseline 5m 53.7s, Workers 4m 53.2s (1.21x with 7 workers)
  - File sizes match exactly between baseline and workers
  - Auto-detected worker count: `min(floor(cpuCount/2), pageCount)`

- [x] **SIMD Optimization Integrated**
  - WASM binary already compiled with `-msimd128` for SIMD instructions
  - 3,547 SIMD instructions in compiled WASM binary
  - Peak throughput: 47 million pixels/second

- [x] **Adaptive BPC Clamping Integrated**
  - Added `initBPCClamping()` for transform initialization
  - Added `doTransformAdaptive()` for automatic boundary detection
  - Only applies to images ≥2 megapixels (ADAPTIVE_BPC_THRESHOLD)
  - Samples first 256 pixels to detect binary masks
  - 3x speedup for binary masks, no overhead for photographs
  - Integrated into ColorEngineService as opt-out default (enabled by default)
  - Integrated into StreamTransformWorker for parallel processing

- [x] **ColorEngineService Updates**
  - Added `useAdaptiveBPCClamping` option (default: true)
  - Added `defaultAdaptiveBPCClamping` getter/setter
  - Updated `#getOrCreateTransform()` to initialize BPC clamping
  - Updated `convertPixelBuffer()` to use `doTransformAdaptive()` for large images
  - Returns `bpcStats` with transform/black/white counts

- [x] **All 50 tests passing**

### 2025-12-19 (Session 11 - Separation Passthrough & RGB Output)

- [x] **Separation Color Passthrough for CMYK Output**
  - DeviceCMYK and Separation colors now pass through unchanged when output is CMYK
  - Separation colors with CMYK alternate (e.g., Separation Black → DeviceCMYK) are detected and skipped
  - Prevents unnecessary conversion of colors that are already targeting the output color space
  - Tested with Type Sizes and Lissajou PDF (pages 19-22 with sGray and Separation K)

- [x] **RGB Output Profile Support**
  - Added destination profile color space detection (CMYK vs RGB)
  - K-Only GCR intent automatically falls back to Relative Colorimetric + BPC for RGB output
  - Output color space name and components adapt to destination profile type
  - Content stream replacements use appropriate output type (cmyk/rgb)
  - Image stream updates use correct device color space (DeviceCMYK/DeviceRGB)

- [x] **Code Changes**
  - `PDFService.convertColorInPDFDocument()`:
    - Added `isDestinationCMYK` and `isDestinationRGB` detection
    - Added `effectiveRenderingIntent` for RGB output fallback
    - Added `useBlackPointCompensation` for RGB output with K-Only GCR
    - Separation colors skipped when `colorSpaceType === 'Separation' && isDestinationCMYK`
    - Image/content stream conversion uses `outputColorSpaceName` and `outputComponents`

- [x] **Testing**
  - All 50 existing tests passing
  - Separation passthrough verified with Type Sizes PDF
  - Regression test passed with Interlaken Map PDF
  - Output saved to `2025-12-19-035/`

### 2025-12-19 (Session 12 - Full Workflow & File Size Fix)

- [x] **File Size Regression Fixed**
  - **Root Cause:** `compressImages` default was `false` in `PDFService.convertColorInPDFDocument()`
  - **Symptom:** Output PDFs were 720 MB instead of expected ~97 MB
  - **Fix:** Changed default to `compressImages = true`
  - **Result:** Interlaken Map eciCMYK output back to 94.24 MB (correct size)

- [x] **Full Workflow Integration**
  - Added `--transform-only` option to `convert-pdf-color.js`
  - Default behavior now includes full workflow steps (matching `generate.js`):
    - `replaceTransarencyBlendingSpaceInPDFDocument()` - update transparency blending
    - `setOutputIntentForPDFDocument()` - set output intent with destination profile
  - Use `--transform-only` to skip these steps when only color transform is needed
  - Updated `test-profile-conversions.js` to include full workflow

- [x] **Test Results (output 2025-12-19-043 and 2025-12-19-044)**

  | PDF        | Profile    | Size     | Workflow                        |
  | ---------- | ---------- | -------- | ------------------------------- |
  | Type Sizes | eciCMYK v2 | 2.63 MB  | Full (blending + output intent) |
  | Type Sizes | FIPS RGB   | 1.45 MB  | Full (blending + output intent) |
  | Interlaken | eciCMYK v2 | 95.96 MB | Full (blending + output intent) |
  | Interlaken | FIPS RGB   | 93.97 MB | Full (blending + output intent) |

  All 8 test configurations (2 PDFs × 2 profiles × 2 worker modes) completed successfully.

- [x] **Files Modified**
  - `PDFService.js` - `compressImages` default fix
  - `convert-pdf-color.js` - `--transform-only` option, full workflow steps
  - `test-profile-conversions.js` - full workflow integration

- [x] **All 50 tests passing**

### 2025-12-19 (Session 10 - Isomorphic Compatibility)

- [x] **Browser Isomorphic Benchmark**
  - Created `benchmark-browser-isomorphic.js` using Playwright Chromium
  - Runs identical color conversion in Node.js and headless browser
  - Compares output file sizes and binary content
  - Uses temp files + HTTP fetch for large data transfer to browser
  - Uses Playwright download API for efficient binary data transfer (avoids Array.from on TypedArrays)

- [x] **Compression Consistency Fix**
  - Fixed `helpers/pdf-lib.js` to use pako in both environments
  - Added fallback path for Node.js: `import('../../packages/pako/dist/pako.mjs')`
  - Previously: Node.js used zlib, browser used pako (different output)
  - Now: Both use pako for identical compression

- [x] **Isomorphic Benchmark Results** (output 2025-12-19-029):
  - Interlaken Map (3 pages): Node.js 2m 57.6s, Browser 2m 33.0s (1.16x faster)
  - Full Test Form (28 pages): Node.js 7m 45.3s, Browser 7m 4.6s (1.10x faster)
  - Size match: YES for both PDFs
  - Binary identical: NO (only PDF trailer differs - timestamps/IDs)
  - **Verdict: ISOMORPHIC COMPATIBILITY VERIFIED for all PDFs**

### 2025-12-17 (Session 5 - PDF Extraction Fix)

- [x] **Fixed Invalid PDF Extraction**
- [x] **Problem Identified**: All extracted PDFs from Session 4 were invalid/damaged because of improper object copying
  - Manual object copying (`copyObjectToDocument`, `copyDictToDocument`, etc.) didn't properly handle PDF object references
  - ICC profiles weren't being copied correctly, resulting in broken color spaces
  - PDFs wouldn't open in Adobe Acrobat or Preview
- [x] **Solution**: Rewrote extraction functions to use pdf-lib's built-in `copyPages()` method
  - `copyPages()` uses internal `PDFObjectCopier` class that properly handles:
    - Cloning page dictionaries with all inheritable attributes
    - Removing parent references to avoid circular references
    - Recursively copying all referenced objects (including ICC profiles)
    - Tracking copied objects to prevent duplicates
  - **New `extractImages()` approach**: Copy full page with `copyPages()`, then modify content stream to only draw specific image
  - **New `extractContentStreams()` approach**: Copy full page with `copyPages()`, then remove Image XObjects from Resources
- [x] Removed broken manual copy functions (`copyObjectToDocument`, `copyDictToDocument`, `copyArrayToDocument`, `copyValueToDocument`)
- [x] **Validation Results**:
  - Interlaken Map PDF: 12 files extracted (9 images + 3 content streams) - ALL PASS
  - CR1 PDF: 108 files extracted (80 images + 28 content streams) - ALL PASS
  - Total: 120 extracted PDF files, all structurally valid
- [x] Output saved to `testing/iso/ptf/2025/experiments/output/2025-12-17-002/`
- [x] **Technical Note**: Files are larger than minimal because `copyPages()` copies all page resources including unused images. This is acceptable for debugging/analysis purposes.

### 2026-02-03 (Session 16 - Lab Output Support & 32-bit Policy Research)

- [x] **Lab Color Space Output Support**
  - Content streams: Lab values work correctly (32-bit float text values)
  - Images: Fixed `#applyImageResult()` in `pdf-page-color-converter.js` to use Lab color space array reference instead of defaulting to DeviceRGB
  - Lab descriptor retrieved before image processing (moved from after content streams)
  - Lab 8-bit and 16-bit output verified working in output folder `2026-02-03-005`

- [x] **Code Fixes Applied**
  - `pdf-page-color-converter.js`:
    - Added `#currentLabDescriptor` field to store Lab color space descriptor
    - Modified `convertColor()` to get Lab descriptor before image/stream processing
    - Updated `#applyImageResult()` to handle Lab output using descriptor's ref or resource
    - Fixed outdated comment "ensures 8-bit for CMYK" → "Update bits per component from converter result"
  - `pdf-image-color-converter.js`:
    - Fixed `applyWorkerResult()` hardcoded `bitsPerComponent: 8` to properly cascade from worker result → configuration → input

- [x] **32-bit Output Research (ISO 32000-2)**
  - **Image XObjects**: BitsPerComponent "shall be 1, 2, 4, 8, or (in PDF 1.5) 16"
  - **Shading dictionaries**: BitsPerCoordinate allows up to 32 (for coordinates only), BitsPerComponent still limited to 16
  - **JPXDecode (JPEG2000)**: Bit depth determined by decoder, but not native 32-bit float
  - **Conclusion**: 32-bit per component is NOT valid for PDF image XObjects; maximum is 16-bit

- [ ] **Policy Decision Pending**
  - For Lab 32-bit output:
    - Content streams: Work fine (text values)
    - Images: Must use 16-bit maximum per PDF spec
  - Options being considered:
    1. Clamp 32-bit to 16-bit for images with warning
    2. Error when 32-bit requested for images
    3. Separate output bit depth settings for images vs content streams
    4. Explore JPEG2000 (JPXDecode) as potential workaround

- [x] **Current Test Results (output 2026-02-03-005)**
  - Lab 8-bit output: Working
  - Lab 16-bit output: Working
  - Lab 32-bit main thread: Error "An error exists on this page" (invalid BitsPerComponent)
  - Lab 32-bit workers: Outputs 16-bit instead (correct constraint enforcement)

### 2026-01-31 (Session 15 - Policy Refactor & Profile Type Enforcement)

- [x] **ColorConversionPolicy Declauding Complete**
  - Flat, rules-driven policy class replaces inheritance hierarchy
  - Deleted `ColorEngineColorConversionPolicy` - logic moved to declarative rules
  - Rules engine supports engine-version-specific overrides
  - Added `evaluateConversion()` method with rule tracing

- [x] **Policy API Changes**
  - `isBigEndian: boolean` → `endianness: 'native' | 'big' | 'little'`
  - `isPlanar: boolean` → `layout: 'packed' | 'planar'`
  - Removed `FORMAT_PROPERTIES` Map (non-deterministic)
  - Converted `FORMAT_LOOKUP` from Map to Record
  - Added `requiresMultiprofileBlackPointScaling()` for `cmsFLAGS_MULTIPROFILE_BPC_SCALING`

- [x] **Policy Propagation Fix**
  - **Root Cause:** `PDFDocumentColorConverter` was not using `createChildConverter()` to instantiate `PDFPageColorConverter`
  - **Fix:** Changed direct instantiation to `this.createChildConverter(PDFPageColorConverter, pageConfig)`
  - Policy now correctly propagates through the entire converter hierarchy

- [x] **Profile Type Enforcement**
  - Removed all string profile fallbacks (`?? 'sRGB'`, `?? 'sGray'`)
  - Profile types changed from `ArrayBuffer | string` to `ArrayBuffer` only
  - Only exception: `'Lab'` string for `colorEngine.createLab4Profile()`
  - Files fixed: `pdf-content-stream-color-converter.js`, `buffer-registry.js`, `worker-pool-entrypoint.js`, `lookup-table-color-converter.js`, `pdf-page-color-converter.js`, `worker-pool.js`

- [x] **Content Stream Converter Refactor**
  - Refactored `PDFContentStreamColorConverter.convertBatchUncached()` to use inherited `convertColorsBuffer()` method
  - Removed direct `ColorEngineService.convertColors()` bypass
  - Content stream conversions now respect policy rules (multiprofile BPC scaling, etc.)

- [x] **Worker Path Fix**
  - Fixed `worker-pool-entrypoint.js` color engine path construction
  - Was prepending extra `../` to already-relative path

- [x] **241 tests pass, 4 pre-existing failures** (unrelated to policy refactor)

### 2026-01-22 (Session 14 - Color Converter Class Hierarchy Complete)

- [x] **Color Converter Class Hierarchy Complete**
  - New class-based architecture in `testing/iso/ptf/2025/classes/`
  - 96 tests passing across 10 test files

- [x] **Class Files Created**
  - `color-converter.js` - Abstract base class with template method pattern
  - `image-color-converter.js` - Image pixel buffer conversion
  - `lookup-table-color-converter.js` - Cached color lookups for content streams
  - `pdf-content-stream-color-converter.js` - PDF content stream color operations
  - `pdf-document-color-converter.js` - Document-level conversion orchestration
  - `pdf-image-color-converter.js` - PDF image XObject conversion
  - `pdf-page-color-converter.js` - Per-page conversion coordination
  - `profile-pool.js` - ICC profile caching with SharedArrayBuffer support
  - `buffer-registry.js` - PDF stream to SharedArrayBuffer mapping

- [x] **Integration Tests Created**
  - `tests/ColorConverterClasses.test.js` - 11 integration tests covering:
    - Full class hierarchy inheritance chain
    - Configuration derivation (document → page → image)
    - Per-page and per-image rendering intent overrides
    - Memory cleanup with ProfilePool and BufferRegistry
    - Shared ProfilePool between converters
    - Document conversion hook order
    - Worker mode support flags
    - Lab image handling
    - Dispose idempotency

- [x] **Stub Scripts Updated to Use Class-Based Implementation**
  - `experiments/convert-pdf-color.js` - Main CLI tool
  - `experiments/scripts/convert-colors.js` - Batch color conversion
  - `experiments/scripts/inspect-content-stream-colors.js` - Content stream parsing
  - `experiments/scripts/trace-pdf-conversion.js` - Conversion tracing
  - `experiments/scripts/matrix-benchmark.js` - Configuration benchmarks
  - `experiments/scripts/benchmark-final.js` - Comprehensive benchmarks
  - `experiments/scripts/benchmark-transform-methods.js` - Transform method benchmarks
  - All scripts support `--legacy` flag for backward compatibility

- [x] **Parity Verification Script Created**
  - `experiments/scripts/compare-implementations.js` - Compares legacy vs new implementation
  - Reports timing, file size, and content hash differences

### 2026-01-07 (Session 13 - Color Engine 2026-01-07 Feature Integration)

- [x] **New Color Engine Features Integrated**
  - **Feature 1: createMultiprofileTransform** - Chains 2+ ICC profiles in a single transform
  - **Feature 2: Direct Gray/Lab → K-Only CMYK** - Single transform replaces two-step workarounds

- [x] **ColorEngineService.js Updates**
  - Fixed sGray profile stub: `createSRGBProfile()` → `createGray2Profile()` (proper gamma 2.2 gray)
  - Added `#multiprofileTransformCache` for caching multiprofile transforms
  - Added `#getOrCreateMultiprofileTransform(profiles, inputFormat, outputFormat, intent, flags)`
  - Added `convertPixelBufferMultiprofile(inputPixels, options)` public method
  - Updated `dispose()` to clean up multiprofile cache

- [x] **PDFService.js Updates**
  - Replaced Gray ICC → sRGB → CMYK two-step workaround (lines 1051-1102)
  - New approach: `Gray ICC → CMYK (Multi)` using `convertPixelBufferMultiprofile([Gray, CMYK])`
  - Both indexed and direct conversion paths updated

- [x] **Worker Files Updated**
  - `ColorTransformWorker.js`: Fixed sGray stub to use `createGray2Profile()`
  - `StreamTransformWorker.js`: Fixed sGray stub to use `createGray2Profile()`

- [x] **CLI Tool Updates (`convert-pdf-color.js`)**
  - Added `--using-color-engine-package=<path>` option for package version selection
  - Added `--transform-method=<method>` option: `direct` | `multiprofile` (default: multiprofile)
  - Transform method displayed in options output

- [x] **Transform Notation Convention Established**
  - `A → B (Direct)` = `createTransform(A, B)` - 2 profiles
  - `A → B (Multi)` = `createMultiprofileTransform([A, B])` - 2+ profiles
  - `A → B → C (Multi)` = `createMultiprofileTransform([A, B, C])` - 3+ profiles

- [x] **Intentional Exceptions Documented**
  - Lab → CMYK: Always uses Relative Colorimetric + BPC (never K-Only GCR)
  - RGB Output with K-Only GCR: Falls back to Relative Colorimetric + BPC

- [x] **All 50 tests passing**

---

## AI Agent Instructions

When working on this integration:

1. **Always run tests** before and after making changes
2. **Preserve existing behavior** - the current workflow must continue to work
3. **Follow the phase order** - dependencies exist between phases
4. **Update this document** after completing tasks
5. **Add entries to Progress Log** with date and summary

### Quick Reference Commands

```bash
# Install dependencies (when package.json updated)
yarn install

# Run tests (after test infrastructure is set up)
node --test testing/iso/ptf/2025/tests/

# Start local server for manual testing
yarn local

# Run specific test file
node --test testing/iso/ptf/2025/tests/PDFService.test.js
```

### Key Files to Read First

1. `2025-12-01-Color-Engine-API-Reference.md` - Color Engine API reference
2. `testing/iso/ptf/2025/services/PDFService.js` - Current implementation
3. `testing/iso/ptf/2025/generate.js` - Generator workflow
