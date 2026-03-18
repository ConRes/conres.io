# TFG Color Transforms

Comprehensive catalog of all color transformations used in the TestFormGenerator (TFG) classes-based implementation, including the exact class call chains, LittleCMS operations, pixel format constants, and known issues for each permutation of input and output.

**Purpose:** Enable investigation of noise sources by documenting every transformation path from PDF input to color engine output.

**Date:** 2026-02-06

---

## Table of Contents

1. [Class Hierarchy and Responsibilities](#1-class-hierarchy-and-responsibilities)
2. [Transformation Domains](#2-transformation-domains)
3. [Core Transformation Engine: `ColorConverter.convertColorsBuffer()`](#3-core-transformation-engine-colorconverterconvertcolorsbuffer)
4. [Format Selection: `ColorConversionPolicy`](#4-format-selection-colorconversionpolicy)
5. [Image Transformation Pipeline](#5-image-transformation-pipeline)
6. [Content Stream Transformation Pipeline](#6-content-stream-transformation-pipeline)
7. [Analysis Pipeline `PDFImageColorSampler`](#7-analysis-pipeline-pdfimagecolorsampler)
8. [Worker-Based Transformation Pipeline](#8-worker-based-transformation-pipeline)
9. [Complete Permutation Matrix: Image Transforms](#9-complete-permutation-matrix-image-transforms)
10. [Complete Permutation Matrix: Content Stream Transforms](#10-complete-permutation-matrix-content-stream-transforms)
11. [Endianness Handling Reference](#11-endianness-handling-reference)
12. [Known Issues and Workarounds](#12-known-issues-and-workarounds)
13. [Policy Rules and Overrides](#13-policy-rules-and-overrides)
14. [Rendering Intent Behavior by Input Color Space](#14-rendering-intent-behavior-by-input-color-space)
15. [Byte-Level Data Flow Examples](#15-byte-level-data-flow-examples)
16. [Precision Loss Points (Noise Source Reference)](#16-precision-loss-points-noise-source-reference)
17. [PDFImageColorSampler Permutation Matrix](#17-pdfimagecolorsampler-permutation-matrix)

---

## 1. Class Hierarchy and Responsibilities

```
ColorConverter (base)
  Handles: transform creation, transform caching, convertColorsBuffer(),
           16-bit SE → Float workaround, adaptive BPC clamping
  File: classes/color-converter.js

├── ImageColorConverter
│     Handles: pixel buffer conversion, effective rendering intent (K-Only GCR fallback)
│     File: classes/image-color-converter.js
│
│   └── PDFImageColorConverter
│         Handles: FlateDecode decompression/compression, 16-bit Uint16Array view creation,
│                  alignment handling, 32-bit big-endian byte-swap, BPC normalization
│         File: classes/pdf-image-color-converter.js
│
│       └── PDFImageColorSampler
│             Handles: pixel sampling, Float32 Lab output for Delta-E analysis
│             File: classes/pdf-image-color-sampler.js
│
├── LookupTableColorConverter
│     Handles: discrete color caching, batch conversion of unique colors
│     File: classes/lookup-table-color-converter.js
│
│   └── PDFContentStreamColorConverter
│         Handles: content stream parsing, Float32 input/output,
│                  CMYK /100 normalization, color space definition extraction
│         File: classes/pdf-content-stream-color-converter.js
│
└── CompositeColorConverter
      Handles: WorkerPool lifecycle (ownership semantics), worker diagnostics
      File: classes/composite-color-converter.js

    ├── PDFPageColorConverter
    │     Handles: page-level orchestration, image/stream dispatching,
    │              indexed image handling, worker mode coordination
    │     File: classes/pdf-page-color-converter.js
    │
    └── PDFDocumentColorConverter
          Handles: document-level orchestration, page data collection,
                   color space identification, ICC profile extraction
          File: classes/pdf-document-color-converter.js
```

### Supporting Classes

| Class                   | File                                 | Role                                                     |
| ----------------------- | ------------------------------------ | -------------------------------------------------------- |
| `ColorConversionPolicy` | `classes/color-conversion-policy.js` | Format selection, rule evaluation, endianness handling   |
| `ColorEngineProvider`   | `classes/color-engine-provider.js`   | WASM wrapper for LittleCMS, profile management           |
| `BufferRegistry`        | `classes/buffer-registry.js`         | SharedArrayBuffer management, cross-instance color cache |
| `WorkerPool`            | `classes/worker-pool.js`             | Isomorphic worker pool (Node.js / Web Workers)           |
| Worker Entrypoint       | `classes/worker-pool-entrypoint.js`  | Worker script, creates per-worker `ColorEngineProvider`  |

---

## 2. Transformation Domains

The TFG classes perform color transformations in two distinct domains:

### Domain A: Image Pixel Data

- **Source:** PDF image XObjects (streams containing pixel data)
- **Input bit depths:** 8-bit (Uint8Array), 16-bit (Uint16Array via Uint8Array view)
- **Input endianness:** 16-bit data is big-endian per ISO 32000
- **Input color spaces:** RGB, Gray, Lab (from ICCBased or Lab color spaces in PDF)
- **Output color spaces:** CMYK (primary), Lab, RGB
- **Output bit depths:** 8-bit, 16-bit, or 32-bit (Float32)
- **Output endianness:** Big-endian for PDF output (per ISO 32000); 32-bit requires post-conversion byte-swap
- **Call chain:** `PDFDocumentColorConverter` → `PDFPageColorConverter` → `PDFImageColorConverter` → `ImageColorConverter` → `ColorConverter.convertColorsBuffer()`

### Domain B: Content Stream Colors

- **Source:** PDF content stream operators (`SC`/`sc`/`SCN`/`scn`, `RG`/`rg`, `G`/`g`)
- **Input format:** Always Float32Array (32-bit float), values in 0.0-1.0 range
- **Input color spaces:** RGB, Gray, Lab (from ICCBased or Lab color spaces in PDF)
- **Output color spaces:** CMYK (primary), Lab, RGB
- **Output format:** Always Float32Array (32-bit float)
- **CMYK output normalization:** LittleCMS returns 0-100 for CMYK floats; divided by 100 for PDF's 0-1 range
- **Call chain:** `PDFDocumentColorConverter` → `PDFPageColorConverter` → `PDFContentStreamColorConverter` → `LookupTableColorConverter` → `ColorConverter.convertColorsBuffer()`

### Domain C: Analysis (PDFImageColorSampler)

- **Source:** PDF image XObjects (same as Domain A)
- **Input bit depths:** 8-bit or 16-bit
- **Output:** Always Float32 Lab for Delta-E computation
- **NOT written back to PDF** (analysis only)
- **Call chain:** `PDFImageColorSampler.samplePixels()` → `ColorConverter.convertColorsBuffer()`

---

## 3. Core Transformation Engine: `ColorConverter.convertColorsBuffer()`

**File:** `classes/color-converter.js`, lines 431-611

This is the single method through which ALL color transformations ultimately pass. Every class in the hierarchy calls this method (or calls a parent that calls it).

### Step-by-Step Operation

1. **Build Descriptors:** Creates `PixelFormatDescriptor` for input and output, and `ConversionDescriptor` for rule evaluation. Note: `outputBitsPerComponent` has a configuration-level fallback (`config.outputBitsPerComponent`) in addition to the per-call option.
2. **Resolve Formats:** `policy.getInputFormat(inputDescriptor)` → TYPE_*constant; `policy.getOutputFormat(outputDescriptor)` → TYPE_* constant
3. **Evaluate Rules:** `policy.evaluateConversion(conversionDescriptor)` → intent overrides, multiprofile requirements
4. **LittleCMS Workaround (16-bit SE → Float):**
   - Detects: `isSwapEndianFormat(inputFormat) && isFloatFormat(outputFormat)`
   - Action: Manually byte-swaps the input buffer, removes SE flag from input format
   - Also triggers if: `isSwapEndianFormat(inputFormat) && SHOULD_SWAP_16_FROM_BIG_TO_LITTLE_ENDIAN` (currently `false`)
5. **Calculate Pixel Count:** From buffer length, channels, and bytes-per-sample
6. **Resolve Rendering Intent:** From policy overrides or configuration
7. **Create Transform:** Single (`createTransform`) or multiprofile (`createMultiprofileTransform`) based on policy evaluation
8. **Create Output Buffer:** `policy.createOutputBuffer(outputFormat, pixelCount, outputChannels)` → Uint8Array / Uint16Array / Float32Array
9. **Execute Transform:** `provider.transformArray()` or `provider.doTransformAdaptive()` (if adaptive BPC threshold met)
10. **Return:** `{ outputPixels, pixelCount, inputChannels, outputChannels, bpcStats }`

### Transform Creation Details

**Single Transform:**

```
provider.createTransform(sourceProfile, inputFormat, destProfile, outputFormat, intentConstant, flags)
```

**Multiprofile Transform:**

```
profiles = [sourceProfile, ...intermediateProfiles, destinationProfile]
intents = new Array(profiles.length - 1).fill(intentConstant)  // one intent per profile junction
provider.createMultiprofileTransform(profiles, inputFormat, outputFormat, intents, flags)
```

**Transform Caching:** Transforms are cached by a key composed of profile references, format constants, intent, and flags. Cache hits avoid re-creating WASM transforms.

---

## 4. Format Selection: `ColorConversionPolicy`

**File:** `classes/color-conversion-policy.js`

### Format Resolution Logic

For input: `inputBitsPerComponent ?? bitsPerComponent` and `inputEndianness ?? endianness`
For output: `outputBitsPerComponent ?? bitsPerComponent` and `outputEndianness ?? endianness`

### 8-Bit Formats (Endianness Irrelevant)

| Color Space | Channel Order | TYPE_* Constant | Hex Value |
| ----------- | ------------- | --------------- | --------- |
| Gray        | Gray          | `TYPE_GRAY_8`   | `0x30009` |
| RGB         | RGB           | `TYPE_RGB_8`    | `0x40019` |
| CMYK        | CMYK          | `TYPE_CMYK_8`   | `0x60021` |
| Lab         | Lab           | `TYPE_Lab_8`    | `0xa0019` |

### 16-Bit Formats (Endianness Determines SE Flag)

The single source of truth for SE selection is `ColorConversionPolicy.#needsEndianSwap(bufferEndianness)`:

```javascript
#needsEndianSwap(bufferEndianness) {
    return bufferEndianness !== this.#wasmEndianness;
}
```

WASM endianness is always **little-endian** (`WEB_ASSEMBLY_ENDIANNESS = 'little'`).

| Color Space | Buffer Endianness | Needs Swap? | TYPE_* Constant   | Notes        |
| ----------- | ----------------- | ----------- | ----------------- | ------------ |
| Gray        | big               | Yes         | `TYPE_GRAY_16_SE` | PDF standard |
| Gray        | little            | No          | `TYPE_GRAY_16`    | Native WASM  |
| RGB         | big               | Yes         | `TYPE_RGB_16_SE`  | PDF standard |
| RGB         | little            | No          | `TYPE_RGB_16`     | Native WASM  |
| CMYK        | big               | Yes         | `TYPE_CMYK_16_SE` | PDF standard |
| CMYK        | little            | No          | `TYPE_CMYK_16`    | Native WASM  |
| Lab         | big               | Yes         | `TYPE_Lab_16_SE`  | PDF standard |
| Lab         | little            | No          | `TYPE_Lab_16`     | Native WASM  |

**Critical:** The SE (Swap Endian) flag tells LittleCMS that the buffer's byte order differs from the WASM memory's byte order. When SE is set, LittleCMS performs the byte-swap internally during transform. The buffer data remains in its original byte order; the SE flag describes the buffer, not an operation to perform on it.

### 32-Bit Float Formats (No SE Variants)

| Color Space | TYPE_* Constant | Notes                    |
| ----------- | --------------- | ------------------------ |
| Gray        | `TYPE_GRAY_FLT` | IEEE 754, no endian flag |
| RGB         | `TYPE_RGB_FLT`  | IEEE 754, no endian flag |
| CMYK        | `TYPE_CMYK_FLT` | IEEE 754, no endian flag |
| Lab         | `TYPE_Lab_FLT`  | IEEE 754, no endian flag |

LittleCMS does not provide SE variants for 32-bit float formats. The `ENDIAN16_SH` flag is specifically for 16-bit integer data only. This means there is no way to tell LittleCMS "the float input buffer is in big-endian byte order." This limitation is the root cause of the 16-bit SE → Float workaround and the 32-bit big-endian post-conversion byte-swap.

### Constructed SE Constants

The following SE constants are constructed locally in `color-conversion-policy.js` by OR-ing the non-SE 16-bit constants with `ENDIAN16_SH(1)`:

```javascript
const TYPE_Lab_16_SE = TYPE_Lab_16 | ENDIAN16_SH(1);
const TYPE_GRAYA_16_SE = TYPE_GRAYA_16 | ENDIAN16_SH(1);
const TYPE_BGR_16_SE = TYPE_BGR_16 | ENDIAN16_SH(1);
const TYPE_RGBA_16_SE = TYPE_RGBA_16 | ENDIAN16_SH(1);
const TYPE_KYMC_16_SE = TYPE_KYMC_16 | ENDIAN16_SH(1);
```

**Note:** `TYPE_Lab_16_SE` is genuinely absent from the color engine's standard exports. The other four (`TYPE_GRAYA_16_SE`, `TYPE_BGR_16_SE`, `TYPE_RGBA_16_SE`, `TYPE_KYMC_16_SE`) exist in the constants module but are not imported by the policy file; they are instead re-derived locally. The constructed values are identical to the exported ones.

---

## 5. Image Transformation Pipeline

### Full Call Chain

```
PDFDocumentColorConverter.convertColor(pdfDocument)
  → PDFPageColorConverter.convertColor(pageData)
    → PDFImageColorConverter.convertPDFImageColor(input, context)  // or via worker
      → ImageColorConverter.convertColor(input)
        → ColorConverter.convertColorsBuffer(inputBuffer, options)
          → ColorConversionPolicy.getInputFormat(inputDescriptor)
          → ColorConversionPolicy.getOutputFormat(outputDescriptor)
          → ColorConversionPolicy.evaluateConversion(conversionDescriptor)
          → [Optional: byte-swap for 16-bit SE → Float workaround]
          → ColorEngineProvider.createTransform() or createMultiprofileTransform()
          → ColorEngineProvider.transformArray() or doTransformAdaptive()
```

### PDFImageColorConverter Pre-Processing (before calling parent)

**File:** `classes/pdf-image-color-converter.js`, lines 204-412

1. **Decompress** (if FlateDecode): `pako.inflate(streamData)` → raw pixel bytes
2. **Determine effective BPC:** 8-bit or 16-bit pass through; 1/2/4-bit currently throws error
3. **Default endianness:** For >8-bit input, `inputEndianness` defaults to `'big'` (PDF standard, ISO 32000)
4. **Create typed array view for 16-bit:**
   - Check byte alignment: `pixelData.byteOffset % 2 !== 0`
   - If unaligned: copy to new aligned buffer, then create `Uint16Array` view
   - If aligned: create `Uint16Array` view directly from `pixelData.buffer`
   - The underlying byte layout in memory remains big-endian (unchanged by view creation). JavaScript's `Uint16Array` reads values in native (little-endian) order, so numeric values appear "byte-swapped" when accessed via JavaScript. However, LittleCMS operates on the raw bytes in WASM memory (not JavaScript numeric values). The `TYPE_*_SE` flag tells LittleCMS that the raw bytes are in non-native (big-endian) order, and it handles the byte-swap internally during the transform.
5. **Determine output endianness:**
   - For 32-bit output: always passes `outputEndianness: 'little'` to parent (because `TYPE_*_FLT` has no SE)
   - For 16-bit output: passes `effectiveOutputEndianness` (default `'big'`)

### PDFImageColorConverter Post-Processing (after parent returns)

1. **Output buffer type conversion:** Convert to `Uint8Array` view (for PDF stream storage)
2. **32-bit big-endian byte-swap:** If `effectiveOutputEndianness === 'big'` AND `bitsPerComponent === 32`, calls `#byteSwap32(outputData)` to convert from LittleCMS native (little-endian) Float32 to big-endian byte order for PDF
3. **Compress** (if configured): `pako.deflate(outputData)`

### ImageColorConverter Processing

**File:** `classes/image-color-converter.js`, lines 253-321

1. **Determine source profile:** From input or configuration; Lab is the only color space that does not require an explicit ICC profile
2. **Effective rendering intent:** `getEffectiveRenderingIntent(colorType)`:
   - If intent is K-Only GCR AND (`colorType === 'Lab'` OR `destinationColorSpace === 'RGB'`): falls back to Relative Colorimetric
3. **Pass all parameters to `convertColorsBuffer()`:** bitsPerComponent, inputBitsPerComponent, outputBitsPerComponent, endianness, inputEndianness, outputEndianness

---

## 6. Content Stream Transformation Pipeline

### Full Call Chain

```
PDFDocumentColorConverter.convertColor(pdfDocument)
  → PDFPageColorConverter.convertColor(pageData)
    → PDFContentStreamColorConverter.convertColor(input, context)
      → LookupTableColorConverter.buildLookupTable(uniqueInputs, context)
        → PDFContentStreamColorConverter.convertBatchUncached(inputs, context)
          → ColorConverter.convertColorsBuffer(inputBuffer, options)
            → [Same engine path as images, but with Float32 in/out]
```

### Content Stream Pre-Processing

**File:** `classes/pdf-content-stream-color-converter.js`

1. **Parse content stream:** Regex-based parsing extracts color operations with stroke/fill context tracking. Operations are categorized as either `'device'` type (using `RG`/`rg`, `G`/`g`, `K`/`k` operators) or `'indexed'` type (using `SC`/`sc`/`SCN`/`scn` operators with named color space context).
2. **Filter convertible operations:** Only `'indexed'` type operations whose resolved `colorSpaceType` is `'sRGB'`, `'sGray'`, or `'Lab'` are converted. This means:
   - **Converted:** Colors set via `SC`/`sc`/`SCN`/`scn` referencing ICCBased-sRGB, ICCBased-sGray, or Lab color spaces
   - **Skipped:** Device color operators (`RG`/`rg`, `G`/`g`, `K`/`k`) — these have no ICC profile for conversion
   - **Skipped:** `'indexed'` operations referencing DeviceRGB/DeviceCMYK/DeviceGray — no ICC profile
   - Note: The term `'indexed'` here refers to the parser's operation categorization (named color space reference), NOT to PDF Indexed (palette) color spaces.
3. **Group by color space:** RGB, Gray, Lab groups for batch conversion
4. **Build Float32Array input:** `Float32Array.from(colorValues.flat())` — content stream color values are already in 0-1 range (or Lab range)
5. **Effective rendering intent:** `PDFContentStreamColorConverter` has its own `getEffectiveRenderingIntent()` method (identical logic to `ImageColorConverter`), called before `convertColorsBuffer()`. This means for Lab input with K-Only GCR, the class-level check already overrides the intent to Relative Colorimetric before the policy rules are evaluated.

### Content Stream Conversion Parameters

```javascript
await this.convertColorsBuffer(inputBuffer, {
    inputColorSpace: colorSpace,      // 'RGB' | 'Gray' | 'Lab'
    outputColorSpace: config.destinationColorSpace,  // 'CMYK' | 'Lab' | 'RGB'
    sourceProfile,                     // ArrayBuffer (ICCBased) or 'Lab'
    destinationProfile: config.destinationProfile,
    renderingIntent: effectiveIntent,
    blackPointCompensation: config.blackPointCompensation,
    bitsPerComponent: 32,
    inputBitsPerComponent: 32,
    outputBitsPerComponent: 32,
    requiresMultiprofileTransform: true,
});
```

**Key observations:**

- **Always 32-bit Float** for both input and output
- **No endianness parameter:** Endianness is intentionally not specified (a commented-out `// endianness: 'little',` exists in the code, indicating this was a deliberate decision). For 32-bit Float, the policy ignores endianness (Float32 formats have no SE variants).
- **`requiresMultiprofileTransform: true`** is always set by the content stream converter. The policy could theoretically override this to `false` (the condition in `convertColorsBuffer()` checks `evaluationResult.overrides.requiresMultiprofileTransform !== false`), but no current policy rule does so. In practice, content streams always use the multiprofile transform path.
- **Lab → CMYK interaction:** For Lab input with K-Only GCR, `getEffectiveRenderingIntent('Lab')` overrides the intent to Relative Colorimetric before calling `convertColorsBuffer()`. The policy's K-Only GCR multiprofile rule therefore does not fire (its constraint requires K-Only GCR intent). However, the multiprofile path is still taken because the caller sets `requiresMultiprofileTransform: true` and no policy rule explicitly overrides it to `false`. The multiprofile transform uses just two profiles (Lab source, CMYK destination) with Relative Colorimetric intent.

### Content Stream Post-Processing

- **CMYK output:** Each channel value divided by 100 (`result.outputPixels[offset] / 100`) because LittleCMS returns CMYK floats in 0-100 range while PDF uses 0-1. Creates new `Float32Array` per pixel.
- **Non-CMYK output:** Values used directly as `Float32Array` views into the output buffer (no copy, no division). Lab and RGB floats are already in expected ranges. Each result is a view: `new Float32Array(result.outputPixels.buffer, j * outputChannels * 4, outputChannels)`.

---

## 7. Analysis Pipeline `PDFImageColorSampler`

**File:** `classes/pdf-image-color-sampler.js`

### Call Chain

```
PDFImageColorSampler.samplePixels(input)
  → [decompress if compressed]
  → [normalize non-standard BPC (1/2/4) to 8-bit]
  → [extract sampled pixels by index]
  → ColorConverter.convertColorsBuffer(sampledPixelData, {
        inputColorSpace: colorSpace,
        outputColorSpace: 'Lab',
        sourceProfile: sourceProfile ?? 'Lab',
        destinationProfile: 'Lab',
        bitsPerComponent: effectiveBitsPerComponent,  // 8 or 16
        inputBitsPerComponent: effectiveBitsPerComponent,
        outputBitsPerComponent: 32,  // Float32 for high-precision Delta-E
        endianness: effectiveBitsPerComponent === 16 ? 'big' : 'native',
    })
```

### Key Characteristics

- Output is always **Float32 Lab** (`TYPE_Lab_FLT`)
- Destination profile is always `'Lab'` (built-in D50 Lab profile)
- **Cannot write to PDF** — Float32 Lab has no TYPE_Lab_FLT_SE support for big-endian PDF output
- For 16-bit input: triggers the **16-bit SE → Float workaround** in `convertColorsBuffer()` (manual byte-swap + remove SE flag)

---

## 8. Worker-Based Transformation Pipeline

### Architecture

```
PDFPageColorConverter (main thread)
  → WorkerPool.processImage(task) or WorkerPool.processContentStream(task)
    → [task dispatched to worker thread]
    → worker-pool-entrypoint.js
      → processImage(task):
          Creates PDFImageColorConverter with task configuration
          Calls converter.convertPDFImageColor(input, {})
          Returns { streamData, bitsPerComponent, isCompressed }
      → processContentStream(task):
          Creates PDFContentStreamColorConverter with task configuration
          Calls converter.convertColor(input, context)
          Returns { newText }
```

**File:** `classes/worker-pool-entrypoint.js`

### Worker Color Engine Provider

Each worker creates its own `ColorEngineProvider` instance, shared across tasks in the same worker:

```javascript
// In worker entrypoint
let sharedColorEngineProvider = null;
// ... on first task:
sharedColorEngineProvider = new ColorEngineProvider({ colorEnginePath });
await sharedColorEngineProvider.initialize();
```

### Worker Image Task Configuration

The worker receives configuration via structured clone (serialized). `PDFImageColorConverter.prepareWorkerTask()` sends compressed stream data (not raw pixel buffers) to minimize transfer overhead.

**Parameters from `PDFImageColorConverter.prepareWorkerTask()`:**

| Parameter                | Source                                                        |
| ------------------------ | ------------------------------------------------------------- |
| `compressedData`         | ArrayBuffer (FlateDecode-compressed stream data, transferred) |
| `isCompressed`           | Boolean (whether data is compressed)                          |
| `compressOutput`         | Boolean (whether to compress the output)                      |
| `streamRef`              | String (PDF object reference)                                 |
| `width`, `height`        | Image dimensions                                              |
| `colorSpace`             | Input color type                                              |
| `bitsPerComponent`       | Input bit depth                                               |
| `inputBitsPerComponent`  | Explicit input bit depth                                      |
| `outputBitsPerComponent` | Explicit output bit depth                                     |
| `endianness`             | Fallback endianness                                           |
| `inputEndianness`        | Input buffer endianness                                       |
| `outputEndianness`       | Output buffer endianness                                      |
| `sourceProfile`          | ArrayBuffer (ICC profile) or `'Lab'`                          |
| `destinationProfile`     | ArrayBuffer (ICC profile)                                     |
| `renderingIntent`        | Already resolved (effective intent)                           |
| `blackPointCompensation` | Boolean                                                       |
| `useAdaptiveBPCClamping` | Boolean                                                       |
| `destinationColorSpace`  | `'CMYK'` or `'Lab'` or `'RGB'`                                |

**Note:** The parent class `ImageColorConverter.prepareWorkerTask()` sends `pixelBuffer` (an ArrayBuffer of raw pixel data). The worker entrypoint falls back to `task.pixelBuffer` if `task.compressedData` is absent, supporting both paths. In the PDF pipeline, `compressedData` is always used.

The worker creates a `PDFImageColorConverter` from this configuration and performs the same conversion as the main thread path.

---

## 9. Complete Permutation Matrix: Image Transforms

These tables describe the **image pipeline only** (Domain A). Content stream transforms are documented in [Section 10](#10-complete-permutation-matrix-content-stream-transforms) and always use the multiprofile path.

> **Note on `16 | little` rows:** Not all `16 | little` input permutations are listed in every table. PDF data is big-endian per ISO 32000, so `16 | little` input is uncommon. All unlisted `16 | little` permutations follow the same patterns as the corresponding `16 | big` rows but without the SE flag and without the 16-bit SE → Float workaround.

### Legend

- **Input CS**: Input color space
- **Input BPC**: Input bits per component
- **Input Endianness**: Byte order of the input buffer
- **Output CS**: Output color space
- **Output BPC**: Output bits per component
- **Input Format**: LittleCMS TYPE_* constant selected by policy for the input
- **Output Format**: LittleCMS TYPE_* constant selected by policy for the output
- **Transform Type**: Single or Multiprofile
- **Workaround**: Any workaround applied before/after LittleCMS transform
- **Intent Override**: Whether rendering intent is overridden by policy
- **Known Issues**: Any documented issues with this permutation

### RGB Input → CMYK Output

| Input BPC | Input Endianness | Output BPC | Input Format                     | Output Format     | Transform Type | Workaround                                                                                                                    | Notes                                                                       |
| --------- | ---------------- | ---------- | -------------------------------- | ----------------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| 8         | n/a              | 8          | `TYPE_RGB_8`                     | `TYPE_CMYK_8`     | Single         | None                                                                                                                          | Standard path                                                               |
| 8         | n/a              | 16         | `TYPE_RGB_8`                     | `TYPE_CMYK_16_SE` | Single         | None                                                                                                                          | Output SE for big-endian PDF                                                |
| 8         | n/a              | 32         | `TYPE_RGB_8`                     | `TYPE_CMYK_FLT`   | Single         | Post-conversion `#byteSwap32()` for big-endian PDF                                                                            | 32-bit output: LittleCMS outputs little-endian floats                       |
| 16        | big              | 8          | `TYPE_RGB_16_SE`                 | `TYPE_CMYK_8`     | Single         | None                                                                                                                          | SE tells LittleCMS input is big-endian                                      |
| 16        | big              | 16         | `TYPE_RGB_16_SE`                 | `TYPE_CMYK_16_SE` | Single         | None                                                                                                                          | Both SE for big-endian PDF                                                  |
| 16        | big              | 32         | `TYPE_RGB_16_SE` → `TYPE_RGB_16` | `TYPE_CMYK_FLT`   | Single         | **Pre-conversion manual byte-swap** of input buffer + SE flag removal; **post-conversion `#byteSwap32()`** for big-endian PDF | **LittleCMS limitation: cannot create TYPE_**16_SE → TYPE**_FLT transform** |
| 16        | little           | 8          | `TYPE_RGB_16`                    | `TYPE_CMYK_8`     | Single         | None                                                                                                                          | Native WASM endianness                                                      |
| 16        | little           | 16         | `TYPE_RGB_16`                    | `TYPE_CMYK_16`    | Single         | None                                                                                                                          | Both native                                                                 |
| 16        | little           | 32         | `TYPE_RGB_16`                    | `TYPE_CMYK_FLT`   | Single         | Post-conversion `#byteSwap32()` for big-endian PDF                                                                            | No SE issue (input is native)                                               |

### RGB Input → CMYK Output with K-Only GCR

Same format permutations as the table above, but with `renderingIntent: 'preserve-k-only-relative-colorimetric-gcr'` (intent constant 20). **No intent override** — K-Only GCR works directly for RGB → CMYK. **No multiprofile requirement** — the policy rule `k-only-gcr-multiprofile-transform-requirement` only matches non-RGB source color spaces. RGB → CMYK with K-Only GCR uses a **single transform**.

### RGB Input → Lab Output

| Input BPC | Input Endianness | Output BPC | Input Format                     | Output Format    | Transform Type | Workaround                                                                                 | Notes                            |
| --------- | ---------------- | ---------- | -------------------------------- | ---------------- | -------------- | ------------------------------------------------------------------------------------------ | -------------------------------- |
| 8         | n/a              | 8          | `TYPE_RGB_8`                     | `TYPE_Lab_8`     | Single         | None                                                                                       |                                  |
| 8         | n/a              | 16         | `TYPE_RGB_8`                     | `TYPE_Lab_16_SE` | Single         | None                                                                                       | Output SE for big-endian PDF     |
| 8         | n/a              | 32         | `TYPE_RGB_8`                     | `TYPE_Lab_FLT`   | Single         | Post-conversion `#byteSwap32()` for big-endian PDF                                         |                                  |
| 16        | big              | 8          | `TYPE_RGB_16_SE`                 | `TYPE_Lab_8`     | Single         | None                                                                                       |                                  |
| 16        | big              | 16         | `TYPE_RGB_16_SE`                 | `TYPE_Lab_16_SE` | Single         | None                                                                                       | Both SE                          |
| 16        | big              | 32         | `TYPE_RGB_16_SE` → `TYPE_RGB_16` | `TYPE_Lab_FLT`   | Single         | **Pre-conversion manual byte-swap** + SE flag removal; **post-conversion `#byteSwap32()`** | **16-bit SE → Float workaround** |
| 16        | little           | 32         | `TYPE_RGB_16`                    | `TYPE_Lab_FLT`   | Single         | Post-conversion `#byteSwap32()` for big-endian PDF                                         |                                  |

### RGB Input → RGB Output

| Input BPC | Input Endianness | Output BPC | Input Format     | Output Format    | Transform Type         | Notes                                                                 |
| --------- | ---------------- | ---------- | ---------------- | ---------------- | ---------------------- | --------------------------------------------------------------------- |
| 8         | n/a              | 8          | `TYPE_RGB_8`     | `TYPE_RGB_8`     | Single or Multiprofile | Multiprofile with BPC scaling if Relative Colorimetric + BPC (policy) |
| 16        | big              | 16         | `TYPE_RGB_16_SE` | `TYPE_RGB_16_SE` | Single or Multiprofile | Same policy rule as above                                             |

Policy rule `rgb-to-rgb-multiprofile-black-point-scaling-enhancement`: For Relative Colorimetric or K-Only GCR with BPC and RGB destination, forces multiprofile transform with `multiprofileBlackPointScaling: true`.

### Gray Input → CMYK Output

| Input BPC | Input Endianness | Output BPC | Input Format                       | Output Format     | Transform Type | Workaround                                                                                 | Notes                            |
| --------- | ---------------- | ---------- | ---------------------------------- | ----------------- | -------------- | ------------------------------------------------------------------------------------------ | -------------------------------- |
| 8         | n/a              | 8          | `TYPE_GRAY_8`                      | `TYPE_CMYK_8`     | Single         | None                                                                                       |                                  |
| 8         | n/a              | 16         | `TYPE_GRAY_8`                      | `TYPE_CMYK_16_SE` | Single         | None                                                                                       | Output SE for big-endian PDF     |
| 8         | n/a              | 32         | `TYPE_GRAY_8`                      | `TYPE_CMYK_FLT`   | Single         | Post-conversion `#byteSwap32()` for big-endian PDF                                         |                                  |
| 16        | big              | 8          | `TYPE_GRAY_16_SE`                  | `TYPE_CMYK_8`     | Single         | None                                                                                       |                                  |
| 16        | big              | 16         | `TYPE_GRAY_16_SE`                  | `TYPE_CMYK_16_SE` | Single         | None                                                                                       | Both SE for big-endian PDF       |
| 16        | big              | 32         | `TYPE_GRAY_16_SE` → `TYPE_GRAY_16` | `TYPE_CMYK_FLT`   | Single         | **Pre-conversion manual byte-swap** + SE flag removal; **post-conversion `#byteSwap32()`** | **16-bit SE → Float workaround** |
| 16        | little           | 8          | `TYPE_GRAY_16`                     | `TYPE_CMYK_8`     | Single         | None                                                                                       | Native WASM endianness           |
| 16        | little           | 16         | `TYPE_GRAY_16`                     | `TYPE_CMYK_16`    | Single         | None                                                                                       | Both native                      |
| 16        | little           | 32         | `TYPE_GRAY_16`                     | `TYPE_CMYK_FLT`   | Single         | Post-conversion `#byteSwap32()` for big-endian PDF                                         | No SE issue (input is native)    |

### Gray Input → CMYK Output with K-Only GCR

K-Only GCR with Gray input requires using the `createMultiprofileTransform()` API (policy rule `k-only-gcr-multiprofile-transform-requirement`). The same format permutations as the Gray → CMYK table above apply, but the transform creation changes from `createTransform()` to `createMultiprofileTransform()`:

```
profiles = [grayICCProfile, cmykICCProfile]
provider.createMultiprofileTransform(profiles, inputFormat, outputFormat, [20], flags)
```

**Important:** The multiprofile transform here uses the same two profiles (source and destination) — there is no intermediate profile chain. The requirement is specifically for using the `createMultiprofileTransform()` API rather than `createTransform()`. The engine internally handles non-RGB K-Only GCR correctly only through the multiprofile code path, even though the profile list contains just two profiles.

Intent constant 20 (K-Only GCR) is used for the single profile junction in the multiprofile transform. With 2 profiles, there is 1 junction, so the intents array is `[20]` (length 1).

### Gray Input → Lab Output

| Input BPC | Input Endianness | Output BPC | Input Format                       | Output Format    | Transform Type | Workaround                                                                                 | Notes                            |
| --------- | ---------------- | ---------- | ---------------------------------- | ---------------- | -------------- | ------------------------------------------------------------------------------------------ | -------------------------------- |
| 8         | n/a              | 8          | `TYPE_GRAY_8`                      | `TYPE_Lab_8`     | Single         | None                                                                                       |                                  |
| 8         | n/a              | 16         | `TYPE_GRAY_8`                      | `TYPE_Lab_16_SE` | Single         | None                                                                                       | Output SE for big-endian PDF     |
| 8         | n/a              | 32         | `TYPE_GRAY_8`                      | `TYPE_Lab_FLT`   | Single         | Post-conversion `#byteSwap32()` for big-endian PDF                                         |                                  |
| 16        | big              | 8          | `TYPE_GRAY_16_SE`                  | `TYPE_Lab_8`     | Single         | None                                                                                       |                                  |
| 16        | big              | 16         | `TYPE_GRAY_16_SE`                  | `TYPE_Lab_16_SE` | Single         | None                                                                                       | Both SE                          |
| 16        | big              | 32         | `TYPE_GRAY_16_SE` → `TYPE_GRAY_16` | `TYPE_Lab_FLT`   | Single         | **Pre-conversion manual byte-swap** + SE flag removal; **post-conversion `#byteSwap32()`** | **16-bit SE → Float workaround** |

### Gray Input → RGB Output

| Input BPC | Input Endianness | Output BPC | Input Format                       | Output Format    | Transform Type | Workaround                                                                                 | Intent Override                                      | Notes                            |
| --------- | ---------------- | ---------- | ---------------------------------- | ---------------- | -------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------- | -------------------------------- |
| 8         | n/a              | 8          | `TYPE_GRAY_8`                      | `TYPE_RGB_8`     | Single         | None                                                                                       | K-Only GCR → Relative Colorimetric (RGB destination) |                                  |
| 8         | n/a              | 16         | `TYPE_GRAY_8`                      | `TYPE_RGB_16_SE` | Single         | None                                                                                       | K-Only GCR → Relative Colorimetric                   |                                  |
| 8         | n/a              | 32         | `TYPE_GRAY_8`                      | `TYPE_RGB_FLT`   | Single         | Post-conversion `#byteSwap32()` for big-endian PDF                                         | K-Only GCR → Relative Colorimetric                   |                                  |
| 16        | big              | 8          | `TYPE_GRAY_16_SE`                  | `TYPE_RGB_8`     | Single         | None                                                                                       | K-Only GCR → Relative Colorimetric                   |                                  |
| 16        | big              | 32         | `TYPE_GRAY_16_SE` → `TYPE_GRAY_16` | `TYPE_RGB_FLT`   | Single         | **Pre-conversion manual byte-swap** + SE flag removal; **post-conversion `#byteSwap32()`** | K-Only GCR → Relative Colorimetric                   | **16-bit SE → Float workaround** |

### Lab Input → CMYK Output

| Input BPC | Input Endianness | Output BPC | Input Format                     | Output Format     | Transform Type | Intent Override                    | Notes                                                              |
| --------- | ---------------- | ---------- | -------------------------------- | ----------------- | -------------- | ---------------------------------- | ------------------------------------------------------------------ |
| 8         | n/a              | 8          | `TYPE_Lab_8`                     | `TYPE_CMYK_8`     | Single         | K-Only GCR → Relative Colorimetric | Lab does not work with K-Only GCR                                  |
| 8         | n/a              | 16         | `TYPE_Lab_8`                     | `TYPE_CMYK_16_SE` | Single         | K-Only GCR → Relative Colorimetric | Output SE for big-endian PDF                                       |
| 8         | n/a              | 32         | `TYPE_Lab_8`                     | `TYPE_CMYK_FLT`   | Single         | K-Only GCR → Relative Colorimetric | Post-conversion `#byteSwap32()` for big-endian PDF                 |
| 16        | big              | 8          | `TYPE_Lab_16_SE`                 | `TYPE_CMYK_8`     | Single         | K-Only GCR → Relative Colorimetric |                                                                    |
| 16        | big              | 16         | `TYPE_Lab_16_SE`                 | `TYPE_CMYK_16_SE` | Single         | K-Only GCR → Relative Colorimetric |                                                                    |
| 16        | big              | 32         | `TYPE_Lab_16_SE` → `TYPE_Lab_16` | `TYPE_CMYK_FLT`   | Single         | K-Only GCR → Relative Colorimetric | **16-bit SE → Float workaround** + post-conversion `#byteSwap32()` |

**Intent override location:** The class-level check runs first and the policy rule becomes a no-op for this case:

1. `ImageColorConverter.getEffectiveRenderingIntent('Lab')` returns `'relative-colorimetric'` when configured intent is K-Only GCR. This overridden intent is passed to `convertColorsBuffer()`.
2. Policy rule `k-only-gcr-to-relative-colorimetric-fallback` evaluates inside `convertColorsBuffer()`, but since the intent is already `'relative-colorimetric'` (not K-Only GCR), the rule's constraint `renderingIntents: ['preserve-k-only-relative-colorimetric-gcr']` does NOT match. The rule never fires in this case.

In summary: for Lab input with K-Only GCR, only the class-level check is effective. The policy rule exists as a safety net for code paths that might bypass the class-level check (such as direct `convertColorsBuffer()` calls).

### Lab Input → Lab Output (Identity/Profile Conversion)

| Input BPC | Input Endianness | Output BPC | Input Format                     | Output Format    | Transform Type | Notes                                                  |
| --------- | ---------------- | ---------- | -------------------------------- | ---------------- | -------------- | ------------------------------------------------------ |
| 8         | n/a              | 8          | `TYPE_Lab_8`                     | `TYPE_Lab_8`     | Single         | Near-identity; may have LittleCMS PCS round-trip noise |
| 8         | n/a              | 16         | `TYPE_Lab_8`                     | `TYPE_Lab_16_SE` | Single         | Output SE for big-endian PDF                           |
| 8         | n/a              | 32         | `TYPE_Lab_8`                     | `TYPE_Lab_FLT`   | Single         | Analysis use case (PDFImageColorSampler)               |
| 16        | big              | 8          | `TYPE_Lab_16_SE`                 | `TYPE_Lab_8`     | Single         | 16-to-8 truncation                                     |
| 16        | big              | 16         | `TYPE_Lab_16_SE`                 | `TYPE_Lab_16_SE` | Single         | Both SE for big-endian PDF                             |
| 16        | big              | 32         | `TYPE_Lab_16_SE` → `TYPE_Lab_16` | `TYPE_Lab_FLT`   | Single         | **16-bit SE → Float workaround**; Analysis use case    |
| 16        | little           | 32         | `TYPE_Lab_16`                    | `TYPE_Lab_FLT`   | Single         | No SE issue (native endian input)                      |

**Note on Lab → Lab identity:** When both source and destination profiles are the built-in Lab D50 profile (`'Lab'`), LittleCMS still processes through its internal PCS pipeline (Lab → PCS Lab → Lab). This is NOT guaranteed to be a bit-exact identity transform and may introduce floating-point noise at the PCS junction. This is relevant for noise investigation when comparing pre/post conversion Lab values.

### Lab Input → RGB Output

| Input BPC | Input Endianness | Output BPC | Input Format                     | Output Format    | Transform Type | Intent Override                    | Notes                                                   |
| --------- | ---------------- | ---------- | -------------------------------- | ---------------- | -------------- | ---------------------------------- | ------------------------------------------------------- |
| 8         | n/a              | 8          | `TYPE_Lab_8`                     | `TYPE_RGB_8`     | Single         | K-Only GCR → Relative Colorimetric | K-Only GCR overridden for Lab input AND RGB destination |
| 8         | n/a              | 16         | `TYPE_Lab_8`                     | `TYPE_RGB_16_SE` | Single         | K-Only GCR → Relative Colorimetric | Output SE for big-endian PDF                            |
| 8         | n/a              | 32         | `TYPE_Lab_8`                     | `TYPE_RGB_FLT`   | Single         | K-Only GCR → Relative Colorimetric | Post-conversion `#byteSwap32()`                         |
| 16        | big              | 8          | `TYPE_Lab_16_SE`                 | `TYPE_RGB_8`     | Single         | K-Only GCR → Relative Colorimetric |                                                         |
| 16        | big              | 16         | `TYPE_Lab_16_SE`                 | `TYPE_RGB_16_SE` | Single         | K-Only GCR → Relative Colorimetric | Both SE                                                 |
| 16        | big              | 32         | `TYPE_Lab_16_SE` → `TYPE_Lab_16` | `TYPE_RGB_FLT`   | Single         | K-Only GCR → Relative Colorimetric | **16-bit SE → Float workaround** + `#byteSwap32()`      |

### CMYK Input

CMYK images are generally **not converted** in the TFG pipeline because the destination is typically CMYK. However, when the destination color space differs, or for analysis use cases, CMYK input is supported:

| Input BPC | Input Endianness | Output CS | Output BPC | Input Format                       | Output Format     | Workaround                                                                                 | Notes                            |
| --------- | ---------------- | --------- | ---------- | ---------------------------------- | ----------------- | ------------------------------------------------------------------------------------------ | -------------------------------- |
| 8         | n/a              | Lab       | 8          | `TYPE_CMYK_8`                      | `TYPE_Lab_8`      | None                                                                                       | Reverse conversion for analysis  |
| 8         | n/a              | Lab       | 32         | `TYPE_CMYK_8`                      | `TYPE_Lab_FLT`    | Post-conversion `#byteSwap32()` for big-endian PDF                                         | Analysis (PDFImageColorSampler)  |
| 8         | n/a              | RGB       | 8          | `TYPE_CMYK_8`                      | `TYPE_RGB_8`      | None                                                                                       |                                  |
| 8         | n/a              | CMYK      | 8          | `TYPE_CMYK_8`                      | `TYPE_CMYK_8`     | None                                                                                       | Profile-to-profile conversion    |
| 16        | big              | Lab       | 32         | `TYPE_CMYK_16_SE` → `TYPE_CMYK_16` | `TYPE_Lab_FLT`    | **Pre-conversion manual byte-swap** + SE flag removal; **post-conversion `#byteSwap32()`** | **16-bit SE → Float workaround** |
| 16        | big              | CMYK      | 8          | `TYPE_CMYK_16_SE`                  | `TYPE_CMYK_8`     | None                                                                                       | Profile-to-profile conversion    |
| 16        | big              | CMYK      | 16         | `TYPE_CMYK_16_SE`                  | `TYPE_CMYK_16_SE` | None                                                                                       | Both SE for big-endian PDF       |

### Indexed Images

Indexed (palette) images are handled differently by `PDFPageColorConverter.#convertIndexedImage()`:

1. **Palette extracted** from PDF color space definition
2. **Palette converted** using legacy `ColorEngineService.convertColors()` method (not the classes-based `convertColorsBuffer()` pipeline). This is a fundamentally different code path: `convertColors()` takes `ColorValue[]` objects (not TypedArrays) and returns individual results, with different precision characteristics than the TypedArray-based batch conversion.
3. **Pixel indices unchanged** — only the lookup table (palette) is transformed
4. **Always 8-bit** palette entries
5. **Always main thread** — indexed images are not dispatched to workers

---

## 10. Complete Permutation Matrix: Content Stream Transforms

Content streams always use Float32 (32-bit) input and output. No endianness concerns for 32-bit.

**CMYK input is not converted in content streams.** The `convertBatchUncached()` method only iterates over `['RGB', 'Gray', 'Lab']` groups (line 448 of `pdf-content-stream-color-converter.js`). CMYK device colors (`K`/`k` operators) are classified as device colors and skipped entirely.

**Gray destination is not supported.** The output channel calculation (`outputChannels = config.destinationColorSpace === 'CMYK' ? 4 : 3`) hardcodes 4 for CMYK and 3 for everything else. If `destinationColorSpace` were `'Gray'` (1 channel), this would silently produce corrupted output.

### Input → Output Permutations

| Input CS | Output CS | Input Format    | Output Format   | Transform Type | CMYK /100? | Intent Override                                                         |
| -------- | --------- | --------------- | --------------- | -------------- | ---------- | ----------------------------------------------------------------------- |
| RGB      | CMYK      | `TYPE_RGB_FLT`  | `TYPE_CMYK_FLT` | Multiprofile   | Yes        | None (K-Only GCR works for RGB → CMYK)                                  |
| RGB      | Lab       | `TYPE_RGB_FLT`  | `TYPE_Lab_FLT`  | Multiprofile   | No         | None                                                                    |
| RGB      | RGB       | `TYPE_RGB_FLT`  | `TYPE_RGB_FLT`  | Multiprofile   | No         | BPC scaling (policy)                                                    |
| Gray     | CMYK      | `TYPE_GRAY_FLT` | `TYPE_CMYK_FLT` | Multiprofile   | Yes        | K-Only GCR requires `createMultiprofileTransform` (non-RGB input)       |
| Gray     | Lab       | `TYPE_GRAY_FLT` | `TYPE_Lab_FLT`  | Multiprofile   | No         | K-Only GCR → Relative Colorimetric                                      |
| Gray     | RGB       | `TYPE_GRAY_FLT` | `TYPE_RGB_FLT`  | Multiprofile   | No         | K-Only GCR → Relative Colorimetric                                      |
| Lab      | CMYK      | `TYPE_Lab_FLT`  | `TYPE_CMYK_FLT` | Multiprofile   | Yes        | K-Only GCR → Relative Colorimetric                                      |
| Lab      | Lab       | `TYPE_Lab_FLT`  | `TYPE_Lab_FLT`  | Multiprofile   | No         | K-Only GCR → Relative Colorimetric                                      |
| Lab      | RGB       | `TYPE_Lab_FLT`  | `TYPE_RGB_FLT`  | Multiprofile   | No         | K-Only GCR → Relative Colorimetric (both Lab input and RGB destination) |

**Note:** `requiresMultiprofileTransform: true` is **always** set for content stream conversions. The policy may add additional overrides (intermediate profiles, BPC scaling) but the multiprofile path is the default.

### CMYK Output /100 Normalization (Content Streams Only)

LittleCMS `TYPE_CMYK_FLT` output range is 0-100 for each channel. PDF content stream CMYK values use 0-1 range. The division by 100 is performed in `PDFContentStreamColorConverter.convertBatchUncached()`:

**Important:** This /100 normalization applies ONLY to content stream Float32 CMYK output. Image pixel data (Domain A) does NOT perform this normalization — `TYPE_CMYK_8` output is standard 0-255, `TYPE_CMYK_16` is 0-65535, and `TYPE_CMYK_FLT` is 0-100 written directly to the PDF stream (after byte-swap if needed for big-endian).

```javascript
if (config.destinationColorSpace === 'CMYK') {
    for (let j = 0, offset = 0; j < indices.length; j++) {
        results[indices[j]] = new Float32Array([
            result.outputPixels[offset++] / 100, // C
            result.outputPixels[offset++] / 100, // M
            result.outputPixels[offset++] / 100, // Y
            result.outputPixels[offset++] / 100, // K
        ]);
    }
}
```

---

## 11. Endianness Handling Reference

### Fundamental Truths

1. **Endianness describes the byte order of data in a buffer.** It is a property of how multi-byte values are stored in memory.
2. **WASM memory is always little-endian** (on all current platforms). Detected at runtime via `ColorEngineProvider.WEB_ASSEMBLY_ENDIANNESS`.
3. **PDF multi-byte integer data is always big-endian** per ISO 32000.
4. **JavaScript TypedArrays use native (little-endian on current platforms) byte order.** Creating a `Uint16Array` view of big-endian PDF bytes will read the values incorrectly (byte-swapped), but this is expected when using `TYPE_*_SE` formats.
5. **The SE flag in LittleCMS TYPE_* constants tells the engine that the buffer's byte order differs from WASM memory order.** LittleCMS handles the byte-swap internally during the transform.

### Endianness Flow: 16-Bit PDF Image → 8-Bit CMYK Output

```
PDF Stream (big-endian bytes: [0x30, 0x00] = 12288 in big-endian)
  ↓ FlateDecode decompress → Uint8Array: [0x30, 0x00, ...]
  ↓ Create Uint16Array view → values appear as 0x0030 (48) due to little-endian interpretation
  ↓ Pass to LittleCMS with TYPE_RGB_16_SE
  ↓ LittleCMS reads values, applies SE byte-swap internally → interprets as 0x3000 (12288)
  ↓ Converts color using ICC profiles
  ↓ Writes output in TYPE_CMYK_8 format → Uint8Array
```

### Endianness Flow: 16-Bit PDF Image → 32-Bit Float Output (Workaround Path)

```
PDF Stream (big-endian bytes: [0x30, 0x00])
  ↓ FlateDecode decompress → Uint8Array: [0x30, 0x00, ...]
  ↓ Create Uint16Array view → values appear as 0x0030 (48)
  ↓ Policy selects: inputFormat = TYPE_RGB_16_SE, outputFormat = TYPE_RGB_FLT
  ↓ convertColorsBuffer() detects: isSwapEndian(inputFormat) && isFloat(outputFormat)
  ↓ WORKAROUND: Manual byte-swap of input buffer: [0x30, 0x00] → [0x00, 0x30]
  ↓ Uint16Array view now reads 0x3000 (12288) — correct value in native endian
  ↓ Remove SE flag: TYPE_RGB_16_SE → TYPE_RGB_16 (native endian)
  ↓ LittleCMS creates transform: TYPE_RGB_16 → TYPE_RGB_FLT (this works)
  ↓ LittleCMS converts color
  ↓ Output: Float32Array in little-endian (native WASM order)
  ↓ PDFImageColorConverter: #byteSwap32() to big-endian for PDF
```

### Endianness Flow: 16-Bit PDF Image → 16-Bit Output (SE Path)

```
PDF Stream (big-endian bytes)
  ↓ FlateDecode decompress → Uint8Array
  ↓ Create Uint16Array view (values appear byte-swapped in native endian)
  ↓ Pass to LittleCMS with TYPE_RGB_16_SE input
  ↓ LittleCMS handles SE internally
  ↓ Output with TYPE_CMYK_16_SE (big-endian output for PDF)
  ↓ LittleCMS writes output with SE → bytes are in big-endian order
  ↓ No additional byte-swap needed
```

### `SHOULD_SWAP_16_FROM_BIG_TO_LITTLE_ENDIAN`

**File:** `classes/color-conversion-policy.js`, line 106

```javascript
export const SHOULD_SWAP_16_FROM_BIG_TO_LITTLE_ENDIAN = false;
```

This debug flag controls an **additional** byte-swap path in `convertColorsBuffer()`:

```javascript
const shouldByteSwap = isSwapEndian && (isFloatOutput || SHOULD_SWAP_16_FROM_BIG_TO_LITTLE_ENDIAN);
```

When `false` (current): Only byte-swaps for the 16-bit SE → Float case (LittleCMS limitation).
When `true`: Would also byte-swap for 16-bit SE → 16-bit and 16-bit SE → 8-bit cases, replacing the SE flag approach with manual byte-swap.

---

## 12. Known Issues and Workarounds

### Issue 1: LittleCMS Cannot Create 16-bit SE → Float Transforms

**Manifestation:** `cmsCreateTransform()` returns NULL when given a `TYPE_*_16_SE` input format and a `TYPE_*_FLT` output format.

**Root Cause:** LittleCMS internally does not support combining the 16-bit swap-endian flag with float output in its transform pipeline.

**Workaround (in `ColorConverter.convertColorsBuffer()`):**

1. Detect: `isSwapEndianFormat(inputFormat) && isFloatFormat(outputFormat)`
2. Manually byte-swap the input buffer: `ColorConverter.#byteSwap16(bufferToSwap)` — swaps every pair of adjacent bytes
3. Remove SE flag from input format: `ColorConverter.#removeSwapEndianFlag(inputFormat)` — clears the `ENDIAN16_SH(1)` bit
4. Create transform with native-endian input format: `TYPE_*_16` → `TYPE_*_FLT` (this succeeds)

**Affected permutations:** Any 16-bit big-endian input → 32-bit float output:

- `TYPE_RGB_16_SE` → `TYPE_*_FLT`
- `TYPE_GRAY_16_SE` → `TYPE_*_FLT`
- `TYPE_Lab_16_SE` → `TYPE_*_FLT`
- `TYPE_CMYK_16_SE` → `TYPE_*_FLT`

**Potential noise source:** The manual byte-swap creates a new `Uint8Array` buffer. The original `Uint16Array` view becomes stale. If any code path reads from the original view after the swap, it would get incorrect values. However, the current implementation correctly uses `effectiveInputBuffer` after the swap.

### Issue 2: 32-Bit Float Output Has No SE Variant

**Manifestation:** LittleCMS TYPE_*_FLT formats always produce output in the WASM memory's native byte order (little-endian).

**Root Cause:** `ENDIAN16_SH` flag is specifically for 16-bit data. LittleCMS does not provide a float endianness flag.

**Workaround (in `PDFImageColorConverter`):**

1. Pass `outputEndianness: 'little'` to parent for 32-bit output
2. After conversion, if PDF output needs big-endian: `#byteSwap32(outputData)` — swaps every group of 4 bytes
3. This byte-swap is performed on the raw `Uint8Array` view of the output

**Potential noise source:** The 32-bit byte-swap operates on the raw byte level. If the Float32 values contain NaN or denormalized numbers, byte-swapping produces valid but different bit patterns. This should not affect correctly converted color values.

### Issue 3: K-Only GCR Does Not Work for Lab → CMYK

**Manifestation:** LittleCMS produces K=1 (full black) for all Lab input when using K-Only GCR intent (20).

**Workaround:** Two-layer fallback:

1. `ImageColorConverter.getEffectiveRenderingIntent('Lab')` → returns `'relative-colorimetric'`
2. Policy rule `k-only-gcr-to-relative-colorimetric-fallback` → overrides intent to Relative Colorimetric

### Issue 4: K-Only GCR Requires `createMultiprofileTransform` for Non-RGB Input

**Manifestation:** K-Only GCR with `createTransform()` (single transform) only works when input is RGB. Non-RGB inputs (Gray, CMYK, Lab) require `createMultiprofileTransform()`.

**Workaround (engines `2026-01-07` and later):** Policy rule `k-only-gcr-multiprofile-transform-requirement` sets `requiresMultiprofileTransform: true` for non-RGB sources. The multiprofile transform receives the same two profiles (source, destination) — no intermediate profile chain is needed. The requirement is specifically for using the `createMultiprofileTransform()` API call rather than `createTransform()`, even with only two profiles.

### Issue 5: Non-Standard BPC (1, 2, 4) Not Supported for Images

**Current status:** `PDFImageColorConverter` throws an error for non-standard BPC values. The normalization code exists but is behind an unreachable throw statement:

```javascript
if (bitsPerComponent !== 8 && bitsPerComponent !== 16) {
    throw new Error('Only 8 and 16 bits per component are supported in this version.');
    // ... normalization code below is unreachable
}
```

### Issue 6: Indexed Images Use Legacy Path

Indexed (palette) images are converted using `ColorEngineService` (legacy) rather than the classes-based pipeline. This means they do not benefit from policy-based format selection, adaptive BPC clamping, or worker parallelism.

---

## 13. Policy Rules and Overrides

**File:** `classes/configurations/color-conversion-rules.json`

### Active Policies (Engine `2026-01-30`)

#### Policy: `k-only-gcr-to-relative-colorimetric-fallback`

**Engines:** All (including `2026-01-30`)

| Constraint             | Values                                      |
| ---------------------- | ------------------------------------------- |
| renderingIntents       | `preserve-k-only-relative-colorimetric-gcr` |
| destinationColorSpaces | `Gray`, `RGB`, `Lab`                        |

**Override:** `renderingIntent: 'relative-colorimetric'`

**Severity:** `error` (default), `warning` (PDF domain)

**Effect:** When K-Only GCR is requested with a non-CMYK destination, intent is overridden to Relative Colorimetric.

#### Policy: `k-only-gcr-multiprofile-transform-requirement`

**Engines:** `2026-01-07`, `2026-01-21`, `2026-01-30`

| Constraint             | Values                                      |
| ---------------------- | ------------------------------------------- |
| renderingIntents       | `preserve-k-only-relative-colorimetric-gcr` |
| sourceColorSpaces      | `Gray`, `CMYK`, `Lab`                       |
| destinationColorSpaces | `CMYK`                                      |

**Override:** `requiresMultiprofileTransform: true`

**Effect:** For K-Only GCR with non-RGB inputs (Gray, CMYK, Lab) → CMYK, the engine uses `createMultiprofileTransform()` with the source and destination profiles directly (no intermediate sRGB profile needed).

> **Note:** Older engines (`2025-12-15`, `2025-12-19`) had a separate legacy rule (`k-only-gcr-legacy-multistage-transform-requirement`) that injected an intermediate sRGB profile for the same non-RGB → CMYK K-Only GCR case. This legacy rule is not relevant for engine `2026-01-30` and is omitted from this document.

#### Policy: `rgb-to-rgb-multiprofile-black-point-scaling-enhancement`

**Engines:** `2026-01-30`

| Constraint             | Values                                                               |
| ---------------------- | -------------------------------------------------------------------- |
| renderingIntents       | `relative-colorimetric`, `preserve-k-only-relative-colorimetric-gcr` |
| blackPointCompensation | `true`                                                               |
| destinationColorSpaces | `RGB`                                                                |

**Override:** `requiresMultiprofileTransform: true`, `blackPointCompensation: true`, `multiprofileBlackPointScaling: true`

**Effect:** RGB destination with BPC uses multiprofile transform with black-point scaling flag to ensure pure black and pure white are preserved.

---

## 14. Rendering Intent Behavior by Input Color Space

### Summary Table

| Input CS | Output CS | Requested Intent      | Effective Intent      | Override Source                                     |
| -------- | --------- | --------------------- | --------------------- | --------------------------------------------------- |
| RGB      | CMYK      | Relative Colorimetric | Relative Colorimetric | No override                                         |
| RGB      | CMYK      | K-Only GCR            | K-Only GCR            | No override (works directly)                        |
| RGB      | Lab       | Any                   | Same                  | No override                                         |
| RGB      | RGB       | Any                   | Same                  | Multiprofile BPC scaling (policy)                   |
| Gray     | CMYK      | Relative Colorimetric | Relative Colorimetric | No override                                         |
| Gray     | CMYK      | K-Only GCR            | K-Only GCR            | `createMultiprofileTransform` required (policy)     |
| Gray     | RGB       | K-Only GCR            | Relative Colorimetric | Class-level (RGB destination) + Policy (safety net) |
| Gray     | Lab       | K-Only GCR            | Relative Colorimetric | Policy: non-CMYK destination                        |
| Lab      | CMYK      | Relative Colorimetric | Relative Colorimetric | No override                                         |
| Lab      | CMYK      | K-Only GCR            | Relative Colorimetric | Class-level (ImageColorConverter) + Policy          |
| Lab      | RGB       | K-Only GCR            | Relative Colorimetric | Class-level (Lab input) + Policy (RGB destination)  |
| Lab      | Lab       | K-Only GCR            | Relative Colorimetric | Policy: non-CMYK destination                        |

---

## 15. Byte-Level Data Flow Examples

### Example A: 8-bit RGB Image → 8-bit CMYK (Standard Path)

```
1. PDF image XObject: /ColorSpace /DeviceRGB, /BitsPerComponent 8
   Stream bytes: [R0, G0, B0, R1, G1, B1, ...]  (each byte is one component)

2. PDFImageColorConverter.convertPDFImageColor():
   - Decompress if FlateDecode
   - inputBuffer = pixelData (Uint8Array, direct use)
   - bitsPerComponent = 8, no endianness concern
   - Calls super.convertColor({ pixelBuffer: inputBuffer, ... })

3. ImageColorConverter.convertColor():
   - effectiveIntent = getEffectiveRenderingIntent('RGB') → (no override for RGB→CMYK)
   - Calls convertColorsBuffer(inputBuffer, {
       inputColorSpace: 'RGB', outputColorSpace: 'CMYK',
       bitsPerComponent: 8, inputBitsPerComponent: undefined,
       outputBitsPerComponent: undefined, endianness: undefined })

4. ColorConverter.convertColorsBuffer():
   - policy.getInputFormat({colorSpace:'RGB', bitsPerComponent:8}) → TYPE_RGB_8
   - policy.getOutputFormat({colorSpace:'CMYK', bitsPerComponent:8}) → TYPE_CMYK_8
   - No workaround needed (8-bit, no SE)
   - provider.createTransform(srcProfile, TYPE_RGB_8, dstProfile, TYPE_CMYK_8, intent, flags)
   - outputPixels = new Uint8Array(pixelCount * 4)  // 4 channels CMYK
   - provider.transformArray(transform, inputBuffer, outputPixels, pixelCount)

5. Output: Uint8Array [C0, M0, Y0, K0, C1, M1, Y1, K1, ...]
```

### Example B: 16-bit Big-Endian RGB Image → 8-bit CMYK

```
1. PDF image XObject: /ColorSpace [/ICCBased ...], /BitsPerComponent 16
   Stream bytes (big-endian): [Rhi, Rlo, Ghi, Glo, Bhi, Blo, ...]

2. PDFImageColorConverter.convertPDFImageColor():
   - Decompress if FlateDecode → Uint8Array: [Rhi, Rlo, Ghi, Glo, Bhi, Blo, ...]
   - bitsPerComponent = 16
   - inputEndianness defaults to 'big' (>8-bit PDF data)
   - Create Uint16Array view:
     - Check alignment (byteOffset % 2 === 0)
     - inputBuffer = new Uint16Array(pixelData.buffer, offset, length/2)
     - Values appear byte-swapped: Uint16 reads [Rhi,Rlo] as (Rlo<<8|Rhi) in little-endian
   - Calls super.convertColor({
       pixelBuffer: inputBuffer,
       bitsPerComponent: 16,
       inputEndianness: 'big',
       outputBitsPerComponent: 8 })

3. ImageColorConverter.convertColor():
   - Passes through to convertColorsBuffer()

4. ColorConverter.convertColorsBuffer():
   - policy.getInputFormat({colorSpace:'RGB', bitsPerComponent:16, endianness:'big'})
     → #needsEndianSwap('big') returns true (big !== little)
     → TYPE_RGB_16_SE
   - policy.getOutputFormat({colorSpace:'CMYK', bitsPerComponent:8})
     → TYPE_CMYK_8
   - isSwapEndian(TYPE_RGB_16_SE) = true, isFloat(TYPE_CMYK_8) = false
   - shouldByteSwap = false (not float output, SHOULD_SWAP_16_FROM_BIG_TO_LITTLE_ENDIAN = false)
   - provider.createTransform(srcProfile, TYPE_RGB_16_SE, dstProfile, TYPE_CMYK_8, intent, flags)
   - LittleCMS handles SE internally: reads Uint16 values with byte-swap to get correct 16-bit values
   - outputPixels = new Uint8Array(pixelCount * 4)
   - provider.transformArray(transform, inputBuffer, outputPixels, pixelCount)

5. Output: Uint8Array [C0, M0, Y0, K0, ...]
```

### Example C: 16-bit Big-Endian Lab Image → 32-bit Float CMYK (Workaround Path)

```
1. PDF image XObject: /ColorSpace [/Lab ...], /BitsPerComponent 16
   Stream bytes (big-endian): [Lhi, Llo, ahi, alo, bhi, blo, ...]

2. PDFImageColorConverter.convertPDFImageColor():
   - Decompress → Uint8Array
   - Create Uint16Array view (values appear byte-swapped in native endian)
   - effectiveOutputBits = 32
   - outputEndianness: 'little' (for 32-bit, always 'little' passed to parent)
   - effectiveOutputEndianness: 'big' (default, for post-conversion byte-swap)

3. ColorConverter.convertColorsBuffer():
   - inputFormat = TYPE_Lab_16_SE (big-endian input, WASM is little-endian)
   - outputFormat = TYPE_Lab_FLT (32-bit float, no SE variant exists)
   - isSwapEndian(TYPE_Lab_16_SE) = true
   - isFloat(TYPE_Lab_FLT) = true
   - shouldByteSwap = true (16-bit SE → Float: LittleCMS limitation)

   WORKAROUND:
   a. effectiveInputBuffer = #byteSwap16(inputBuffer as Uint8Array)
      [Lhi, Llo, ahi, alo, bhi, blo, ...] → [Llo, Lhi, alo, ahi, blo, bhi, ...]
      Now Uint16Array reads values in native (little) endian correctly
   b. inputFormat = #removeSwapEndianFlag(TYPE_Lab_16_SE) → TYPE_Lab_16
      (SE flag cleared since buffer is now in native endian)
   c. provider.createTransform(labProfile, TYPE_Lab_16, cmykProfile, TYPE_CMYK_FLT, intent, flags)
      (This succeeds — TYPE_Lab_16 → TYPE_CMYK_FLT is supported)
   d. provider.transformArray(transform, effectiveInputBuffer, outputPixels, pixelCount)

4. Output: Float32Array in little-endian (native WASM byte order)
   CMYK values in 0-100 range

5. PDFImageColorConverter post-processing:
   - outputData = new Uint8Array(float32Buffer)
   - effectiveOutputEndianness === 'big' && bitsPerComponent === 32
   - outputData = #byteSwap32(outputData)
     [b0, b1, b2, b3] → [b3, b2, b1, b0] for each 4-byte group
   - Now Float32 bytes are in big-endian order for PDF storage
```

### Example D: Content Stream sRGB → CMYK (Float Path)

```
1. Content stream text: "0.502 0.251 0.753 sc"
   Color space context: /cs0 is ICCBased sRGB

2. PDFContentStreamColorConverter.convertColor():
   - Parse: colorSpace='RGB', values=[0.502, 0.251, 0.753]
   - Build Float32Array: Float32Array.from([0.502, 0.251, 0.753])

3. PDFContentStreamColorConverter.convertBatchUncached():
   - inputBuffer = Float32Array.from([0.502, 0.251, 0.753])
   - convertColorsBuffer(inputBuffer, {
       inputColorSpace: 'RGB', outputColorSpace: 'CMYK',
       bitsPerComponent: 32, inputBitsPerComponent: 32, outputBitsPerComponent: 32,
       requiresMultiprofileTransform: true })

4. ColorConverter.convertColorsBuffer():
   - inputFormat = TYPE_RGB_FLT
   - outputFormat = TYPE_CMYK_FLT
   - No workaround (no SE involved, both float)
   - Multiprofile transform (requiresMultiprofileTransform: true)
   - provider.createMultiprofileTransform(
       [srgbProfile, cmykProfile], TYPE_RGB_FLT, TYPE_CMYK_FLT, intent, flags)
   - outputPixels = new Float32Array(1 * 4)  // 4 channels CMYK
   - provider.transformArray(transform, inputBuffer, outputPixels, 1)

5. Output: Float32Array [C*100, M*100, Y*100, K*100]

6. PDFContentStreamColorConverter.convertBatchUncached() post-processing:
   - Divide by 100: [C/100, M/100, Y/100, K/100]
   - Result: [0.xxx, 0.xxx, 0.xxx, 0.xxx] in PDF 0-1 range

7. Rebuild content stream: "0.xxx 0.xxx 0.xxx 0.xxx k"
```

---

## 16. Precision Loss Points (Noise Source Reference)

This section catalogs every identified point in the transformation pipeline where precision loss or noise introduction can occur. This is the key reference for investigating noise sources.

### Cross-Reference Table

| Precision Loss Point                   | Affected Domain | Affected Permutations              | Magnitude                                      | Location                                      |
| -------------------------------------- | --------------- | ---------------------------------- | ---------------------------------------------- | --------------------------------------------- |
| Lab 8-bit encoding quantization        | Images, Sampler | All Lab 8-bit input                | L*: ~0.392 step, a*/b*: ~1.0 step              | Input stage (PDF data)                        |
| 16-to-8 bit truncation                 | Images          | All 16-bit input → 8-bit output    | 65536 levels → 256 levels                      | LittleCMS internal                            |
| Float64 → Float32 narrowing            | Content streams | All content stream inputs          | ~1e-7 relative error                           | `Float32Array.from(colorValues.flat())`       |
| CMYK Float /100 division               | Content streams | All CMYK content stream output     | ~1e-7 absolute in 0-1 range                    | `convertBatchUncached()` post-processing      |
| CMYK string serialization              | Content streams | All CMYK content stream output     | Depends on decimal places written              | `rebuildContentStream()`                      |
| Manual `#byteSwap16` (new allocation)  | Images, Sampler | All 16-bit big-endian → Float32    | Lossless (byte reordering)                     | `convertColorsBuffer()` workaround            |
| Manual `#byteSwap32` (new allocation)  | Images          | All 32-bit big-endian output       | Lossless (byte reordering)                     | `PDFImageColorConverter` post-processing      |
| LittleCMS Lab → PCS → Lab round-trip   | Images, Sampler | Lab → Lab identity conversions     | Engine-dependent FP noise                      | LittleCMS internal PCS pipeline               |
| Adaptive BPC clamping                  | Images          | All image permutations at >=2MP    | Different from non-adaptive for same values    | `doTransformAdaptive()` vs `transformArray()` |
| Uint16Array SE output interpretation   | Images          | All 16-bit SE output               | Lossless (byte level correct, JS values wrong) | `createOutputBuffer()` returns Uint16Array    |
| Indexed image legacy path              | Images          | All indexed (palette) images       | Different from TypedArray batch path           | `ColorEngineService.convertColors()`          |
| Non-CMYK content stream buffer sharing | Content streams | All non-CMYK content stream output | None (but mutation hazard)                     | `convertBatchUncached()` result views         |

### Detailed Precision Loss Analysis

#### 1. Content Stream Float32 Precision at Input

`Float32Array.from(colorValues.flat())` converts parsed string values through JavaScript's `Number` (Float64) to `Float32`. Example:
- String `"0.502"` → Float64 `0.502` → Float32 `0.5019999742507935`

This is a precision narrowing step at the very beginning of content stream processing.

#### 2. CMYK /100 Division Precision

IEEE 754 `Float32` division by 100 introduces rounding error because 100 is not exactly representable as a reciprocal in binary floating point. Example:
- LittleCMS output: `C = 54.3` (Float32)
- After division: `C / 100 = 0.5430000424385071` (not exactly 0.543)

Combined with string serialization for the PDF content stream, the effective precision is determined by the number of decimal places written.

#### 3. Lab 8-bit Encoding Quantization

Lab 8-bit encoding has inherent quantization limits:
- L: 0-100 mapped to 0-255 (step size ~0.392 L*)
- a/b: -128 to 127 mapped to 0-255 (step size ~1.0 a*/b*)

This quantization limits precision regardless of output bit depth. Even converting 8-bit Lab to Float32 preserves only the 8-bit precision.

#### 4. Adaptive BPC Clamping Bifurcation

The adaptive BPC threshold (`pixelCount >= 2 * 1024 * 1024`, i.e., 2MP) creates a bifurcation point: the same pixel values can produce different output depending on image size. Below 2MP, `transformArray()` is used. At or above 2MP, `doTransformAdaptive()` is used, which modifies pixel values differently (that is its purpose — to handle blackpoint scaling for large images).

This means the same color value in a small image may convert differently than in a large image, even with identical ICC profiles and rendering intent.

#### 5. Non-CMYK Content Stream Output Buffer Sharing

For non-CMYK content stream output, results are `Float32Array` views into the same underlying output buffer (not copies). For CMYK output, each result is a new `Float32Array` (created during the /100 division). This asymmetry means:
- CMYK results are independent (safe to mutate)
- Non-CMYK results share memory (mutation affects other results)

This is not a noise source per se, but a correctness hazard when debugging.

---

## 17. PDFImageColorSampler Permutation Matrix

The analysis pipeline (Section 7) supports these input/output permutations. Output is always Float32 Lab.

**Note:** The sampler passes input data as `Uint8Array` (raw bytes) even for 16-bit data, unlike the image pipeline which creates `Uint16Array` views. This means the pixel count calculation in `convertColorsBuffer()` takes a different code path (`getBytesPerSample` is used for Uint8Array input to determine bytes per sample).

| Input CS | Input BPC | Input Endianness | Input Format                       | Output Format  | Workaround                       | Notes                                        |
| -------- | --------- | ---------------- | ---------------------------------- | -------------- | -------------------------------- | -------------------------------------------- |
| RGB      | 8         | native           | `TYPE_RGB_8`                       | `TYPE_Lab_FLT` | None                             | Standard analysis path                       |
| RGB      | 16        | big              | `TYPE_RGB_16_SE` → `TYPE_RGB_16`   | `TYPE_Lab_FLT` | **16-bit SE → Float workaround** | Manual byte-swap of input                    |
| Gray     | 8         | native           | `TYPE_GRAY_8`                      | `TYPE_Lab_FLT` | None                             |                                              |
| Gray     | 16        | big              | `TYPE_GRAY_16_SE` → `TYPE_GRAY_16` | `TYPE_Lab_FLT` | **16-bit SE → Float workaround** |                                              |
| Lab      | 8         | native           | `TYPE_Lab_8`                       | `TYPE_Lab_FLT` | None                             | Near-identity; PCS round-trip noise possible |
| Lab      | 16        | big              | `TYPE_Lab_16_SE` → `TYPE_Lab_16`   | `TYPE_Lab_FLT` | **16-bit SE → Float workaround** |                                              |
| CMYK     | 8         | native           | `TYPE_CMYK_8`                      | `TYPE_Lab_FLT` | None                             | Reverse conversion for Delta-E               |
| CMYK     | 16        | big              | `TYPE_CMYK_16_SE` → `TYPE_CMYK_16` | `TYPE_Lab_FLT` | **16-bit SE → Float workaround** |                                              |
