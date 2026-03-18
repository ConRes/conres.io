# 2026-02-03 Debug Sampling Progress

## Roadmap

- [x] Add `SHOULD_SWAP_16_FROM_BIG_TO_LITTLE_ENDIAN = false` flag to disable byte-swap workaround
- [x] Fix "Lab" profile handling in generate-verification-matrix.mjs
- [x] Add CLI options for output format overrides (`--output-bits`, `--output-endianness`)
- [x] Pass overrides through pipeline: config → CLI → PDFDocumentColorConverter → ColorConverter
- [x] User runs fresh set of originals to verify 16-bit images work without byte-swap
- [x] User tests Lab output configuration
- [x] Fix Lab image ColorSpace (was defaulting to DeviceRGB instead of Lab array)
- [x] Fix 16-bit → 32-bit float transform (byte-swap needed for SE → float, not just SE → SE)
- [x] Research 32-bit BitsPerComponent validity in PDF (ISO 32000-2)
- [ ] Policy decision: How to handle 32-bit output for images (PDF max is 16-bit)
- [ ] Investigate why 32-bit outputBitsPerComponent not propagating to workers
- [ ] Investigate comparison tool (`compare-pdf-outputs.js`) for inconsistent unique color counts

## Current Status

**Focus:** Lab output working for 8-bit and 16-bit; 32-bit requires policy decision (PDF spec limits images to 16-bit max)

**Last Updated:** 2026-02-03

## Current Task: Lab Profile and Overrides Pipeline

### Issue 1: "Lab" profile throws error - FIXED
- **Location:** `generate-verification-matrix.mjs` lines 165-171
- **Cause:** Code tries to resolve "Lab" as a file path, but it's a special identifier
- **Fix:** Added `SPECIAL_PROFILE_IDENTIFIERS = ['Lab']` check to skip file resolution

### Issue 2: Verify overrides pass through pipeline - FIXED
- **Overrides in config:** `outputBitsPerComponent`, `outputEndianness`
- **Pipeline:** generate-verification-matrix → convert-pdf-color.js → PDFDocumentColorConverter → ColorConverter

**Changes made:**
1. `convert-pdf-color.js`: Added `--output-bits=<N>` and `--output-endianness=<big|little>` CLI options
2. `color-converter.js`: Added `outputBitsPerComponent` and `outputEndianness` to `ColorConverterConfiguration` typedef
3. `color-converter.js`: Updated `convertColorsBuffer()` to use config values as defaults
4. `convert-pdf-color.js`: Pass overrides to `PDFDocumentColorConverter` constructor
5. `generate-verification-matrix.mjs`: Pass output.overrides to CLI arguments
6. `generate-verification-matrix.mjs`: Added `SPECIAL_PROFILE_IDENTIFIERS = ['Lab']` at module scope
7. `convert-pdf-color.js`: Added special profile handling - skip file loading for 'Lab', use built-in profile
8. `convert-pdf-color.js`: Skip output intent for special profiles (no ICC file to embed)
9. `pdf-image-color-converter.js`: Fall back to `config.outputBitsPerComponent` and `config.outputEndianness` when not in input

## Problem Statement

The comparison tool reports mathematically impossible results:
- Same reference image shows different unique color counts depending on comparison mode
- Pairs mode Im6: 916/916 unique colors
- Reference mode Im6: 916/885 unique colors

This indicates a bug in the comparison tool logic, not in color conversion.

## Changes Made

### `color-conversion-policy.js`
- Added exported flag: `SHOULD_SWAP_16_FROM_BIG_TO_LITTLE_ENDIAN = false`

### `color-converter.js`
- Imported flag from `color-conversion-policy.js`
- Wrapped byte-swap workaround (lines 493-514) with flag check

### `pdf-image-color-converter.js`
- **32-bit Float endianness fix:** Policy always receives `'little'` for 32-bit output
- Moved `effectiveOutputEndianness` computation before `super.convertColor()` call
- Byte-swap32 applied after conversion only when `effectiveOutputEndianness === 'big'`
- Added warning for unusual `outputEndianness: 'little'` with 32-bit output

## Ruled Out (Not The Issue)

### 1. LittleCMS SE → Float Transform Limitation
- **Theory:** LittleCMS cannot create transforms from TYPE_*_16_SE → TYPE_*_FLT formats
- **Action:** Added byte-swap workaround in `color-converter.js`
- **Result:** User states 16-bit images were never broken; workaround now disabled with flag
- **Status:** Ruled out pending user verification

### 2. Lab 16-bit → Lab Float32 Precision Loss
- **Theory:** Lab 16-bit to Float32 conversion loses unique colors
- **Action:** Created `debug-lab-16-to-float32.mjs` test script
- **Result:** Test showed 1000 unique input colors → 1000 unique output colors (preserved)
- **Status:** Ruled out - conversion preserves uniqueness

### 3. Node.js Buffer Pooling Issue
- **Theory:** `buffer.buffer.slice(0)` returns wrong data due to Buffer pooling
- **Action:** Fixed in debug scripts using `buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)`
- **Result:** Fixed RGB profile loading in test scripts
- **Status:** Real issue in test scripts, but not the cause of comparison discrepancy

### 4. RGB Transform Creation Failing
- **Theory:** RGB transforms failing while CMYK/Gray/Lab worked
- **Action:** Traced to Buffer pooling issue above
- **Result:** Fixed by proper ArrayBuffer extraction
- **Status:** Ruled out - was a test script issue only

### 5. Multiprofile Transform Configuration
- **Theory:** Missing `requiresMultiprofileTransform: true` or `intermediateProfiles: []`
- **Action:** User clarified this was not the issue
- **Status:** Ruled out

## Debug Scripts Created (Can Be Deleted)

- `experiments/scripts/debug-lab-16-to-float32.mjs`
- `experiments/scripts/debug-lab-precision-loss.mjs`
- `experiments/scripts/debug-sampler-16bit.mjs`
- `experiments/scripts/debug-rgb-evaluation.mjs`

## PDFContentStreamColorConverter Lab Output Support

### Decisions

1. **`#getOutputOperator()`**: ✅ DONE - Use `switch(this.configuration.destinationColorSpace)` instead of `isCMYK`/`else`. Handle all color spaces:
   - CMYK: `K`/`k`
   - RGB: `RG`/`rg`
   - Lab: `SCN`/`scn` (requires color space selection)
   - Gray: `G`/`g`

2. **`rebuildContentStream()`**: ✅ DONE - Option B with state tracking:
   - Accepts `initialColorSpaceState` parameter
   - Tracks `labActiveStroke` / `labActiveFill` state
   - Inserts `/{labName} cs` or `/{labName} CS` only when Lab not already active
   - Returns `{ text, finalColorSpaceState }` instead of just string
   - Uses `this.configuration.labColorSpaceName ?? 'Lab'` for resource name

3. **`getNormalizedLabColorSpaceDescriptor()`**: ✅ DONE - New method on `PDFDocumentColorConverter`:
   - Returns descriptor with everything needed for Lab output
   - Lazy creates/caches D50 Lab color space per document
   - Reuses existing Lab only if whitepoint and range match:
     - WhitePoint: `[0.96422, 1.0, 0.82521]` (D50)
     - Range: `[-128, 127, -128, 127]`
   - Scans all page resources for existing matching Lab
   - Creates new Lab color space array and registers as indirect object if not found

### Remaining Integration Work

- [x] Pass Lab descriptor name through config to `PDFContentStreamColorConverter` (via `labColorSpaceName`)
- [x] Wire up `PDFPageColorConverter` to call `getNormalizedLabColorSpaceDescriptor()` and pass name to content stream config
- [x] Update `PDFPageColorConverter.#applyImageResult()` to use Lab descriptor for Lab output images
- [x] Add Lab color space to page resources when used in content streams
- [ ] Policy decision for 32-bit image output (PDF BitsPerComponent max is 16)

### Resolved: 16-bit → 32-bit Float Transform Limitation

LittleCMS cannot create transforms from TYPE_*_16_SE → TYPE_*_FLT. The workaround in `color-converter.js` byte-swaps input and removes SE flag.

**Fix applied:** Restored proper logic in conditional:
```javascript
const shouldByteSwap = isSwapEndian && (isFloatOutput || SHOULD_SWAP_16_FROM_BIG_TO_LITTLE_ENDIAN);
```
- SE → float: Always byte-swap (LittleCMS limitation)
- SE → SE (16-bit → 16-bit): Controlled by `SHOULD_SWAP_16_FROM_BIG_TO_LITTLE_ENDIAN` flag

### Pending: 32-bit BitsPerComponent Policy Decision

**ISO 32000-2 Findings:**
- Image XObjects: BitsPerComponent "shall be 1, 2, 4, 8, or (in PDF 1.5) 16"
- 32-bit is ONLY valid for shading mesh BitsPerCoordinate (coordinates, not color components)
- JPXDecode (JPEG2000) has decoder-determined bit depth but not native 32-bit float

**Current behavior:**
- Content streams: 32-bit float Lab values work (text representation)
- Images (workers): Outputs 16-bit (bug - 32-bit config not propagating)
- Images (main thread): Outputs 32-bit → invalid PDF (BitsPerComponent=32 not valid)

**Options to consider:**
1. Clamp 32-bit to 16-bit for images with warning
2. Error when 32-bit requested for images
3. Separate output bit depth settings for images vs content streams
4. Explore JPEG2000 (JPXDecode) as potential workaround

**Note:** Two separate issues:
1. **Bug:** Workers not receiving 32-bit outputBitsPerComponent (needs investigation)
2. **Policy:** Even if fixed, 32-bit images would be invalid PDFs per ISO 32000

**Decision:** Pending user review

## Activity Log

### 2026-02-03
- Created byte-swap workaround flag, set to `false` to verify 16-bit images work without it
- User correctly identified that the actual problem is in the comparison tool, not color conversion
- Awaiting user verification before investigating `compare-pdf-outputs.js`
- **Fixed 32-bit Float output endianness handling in `pdf-image-color-converter.js`:**
  - Policy always receives `outputEndianness: 'little'` for 32-bit (TYPE_*_FLT has no SE variant)
  - PDFImageColorConverter holds onto original `outputEndianness` request
  - After conversion, byte-swap32 applied only if `effectiveOutputEndianness === 'big'`
  - Added warning if `outputEndianness: 'little'` explicitly requested for 32-bit (unusual for PDF)
- **Implemented Lab color space page resource integration:**
  - Added `getNormalizedLabColorSpaceDescriptor(pageDict, pdfDocument)` to `PDFPageColorConverter`
  - Calls parent document converter's method to get/create Lab color space
  - Adds Lab color space to page's Resources/ColorSpace dictionary if not present
  - Added `pdfDocument` to `PDFPageColorConverterInput` typedef
  - Updated `PDFDocumentColorConverter` to pass `pdfDocument` to page converter
  - Added `labColorSpaceName` to `PDFContentStreamColorConverterInput` typedef
  - Updated `rebuildContentStream()` to accept `labColorSpaceName` parameter
  - Content stream conversions now receive `labColorSpaceName` from page converter
- **Fixed Lab content stream color space bug:**
  - Changed `rebuildContentStream()` to ALWAYS insert `/Lab cs` or `/Lab CS` before scn/SCN operations
  - Previous optimization tried to track Lab active state, but failed because original stream
    has color space operations (e.g., `/CS1 cs`) between our replacements that change the current
    color space without our tracking seeing them
- **Fixed Lab image ColorSpace in `pdf-page-color-converter.js`:**
  - Added `#currentLabDescriptor` field to store Lab color space descriptor for current page
  - Moved Lab descriptor retrieval BEFORE image processing (was after content streams)
  - Updated `#applyImageResult()` to handle Lab output:
    - CMYK → `DeviceCMYK`
    - Lab → descriptor's `ref` or `resource` (the Lab array)
    - RGB → `DeviceRGB` (default)
  - Fixed outdated comment "ensures 8-bit for CMYK" → "Update bits per component from converter result"
- **Fixed hardcoded 8-bit in `pdf-image-color-converter.js`:**
  - `applyWorkerResult()` was hardcoding `bitsPerComponent: 8`
  - Now properly cascades: worker result → configuration → input → default
- **Fixed 16-bit → 32-bit float transform:**
  - User identified that `SHOULD_SWAP_16_FROM_BIG_TO_LITTLE_ENDIAN` was being dropped from conditional
  - Restored proper logic: `shouldByteSwap = isSwapEndian && (isFloatOutput || SHOULD_SWAP_16_FROM_BIG_TO_LITTLE_ENDIAN)`
  - SE → float ALWAYS needs byte-swap (LittleCMS limitation)
- **Researched 32-bit BitsPerComponent in ISO 32000-2:**
  - Image XObjects: "The value shall be 1, 2, 4, 8, or (in PDF 1.5) 16"
  - Shading dictionaries: BitsPerCoordinate allows up to 32 (coordinates only), BitsPerComponent max 16
  - JPXDecode (JPEG2000): Bit depth determined by decoder, but not native 32-bit float
  - **Conclusion:** 32-bit is NOT valid for PDF image BitsPerComponent; max is 16-bit
- **Test results (output 2026-02-03-005):**
  - Lab 8-bit output: Working
  - Lab 16-bit output: Working
  - Lab 32-bit main thread: Error (invalid BitsPerComponent=32)
  - Lab 32-bit workers: Outputs 16-bit instead (bug - 32-bit config not propagating to workers)
- **Policy decision pending:** How to handle 32-bit output request for images
