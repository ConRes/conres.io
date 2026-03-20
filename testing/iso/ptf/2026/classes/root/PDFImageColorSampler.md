# PDFImageColorSampler

## Overview

`PDFImageColorSampler` extends `PDFImageColorConverter` for **analysis use cases only**. It provides pixel sampling and Float32 Lab output for high-precision Delta-E color difference computation.

**Key distinction from `PDFImageColorConverter`:**

| Feature | PDFImageColorConverter | PDFImageColorSampler |
|---------|------------------------|----------------------|
| Purpose | Convert images for PDF output | Sample pixels for analysis |
| Output format | PDF-compatible stream (Uint8Array) | Raw Lab Float32Array |
| Destination | CMYK or RGB | Lab only |
| Can write to PDF | Yes | No |
| Supports sampling | No (full image only) | Yes (pixel indices) |
| Output bit depth | 8 or 16 | 32 (Float32) |

---

## Why This Class Exists

The existing `compare-pdf-outputs.js` CLI uses a workaround:

```javascript
// Current approach: Convert to Lab 8-bit, then manually convert to Float32
const result = await labConverter.convertColorsBuffer(refSampledBuffer, {
    outputColorSpace: 'Lab',
    bitsPerComponent: 8, // Limited to 8-bit Lab
});
// Manual conversion loses precision
refLab = convertLab8ToFloat(result.outputPixels);
```

This approach loses precision because:
1. TYPE_Lab_8 quantizes L to 255 levels (0.39% precision)
2. TYPE_Lab_8 quantizes a/b to 255 levels (0.39% precision)
3. Manual Float32 conversion cannot recover the lost precision

`PDFImageColorSampler` uses `TYPE_Lab_FLT` directly for full floating-point precision.

---

## Installation

The class is located at:
```
testing/iso/ptf/2025/classes/pdf-image-color-sampler.js
```

Import:
```javascript
import { PDFImageColorSampler } from '../classes/pdf-image-color-sampler.js';
```

---

## Quick Start

```javascript
import { PDFImageColorSampler } from '../classes/pdf-image-color-sampler.js';
import { ImageSampler } from './classes/image-sampler.mjs';

// 1. Create pixel sampler for random selection
const imageSampler = new ImageSampler({
    sampling: 'random',
    defaults: { count: 10000, seed: 42 },
});

// 2. Create color sampler for Lab conversion
const colorSampler = new PDFImageColorSampler({
    renderingIntent: 'relative-colorimetric',
    blackPointCompensation: true,
    useAdaptiveBPCClamping: false,
    destinationProfile: 'Lab',           // REQUIRED: Must be 'Lab'
    destinationColorSpace: 'Lab',        // REQUIRED: Must be 'Lab'
    inputType: 'CMYK',                   // Default input type
    compressOutput: false,               // Not applicable
    verbose: false,
});

// 3. Wait for initialization
await colorSampler.ensureReady();

// 4. Sample pixel indices from image dimensions
const sampling = imageSampler.sample(imageWidth, imageHeight);
// sampling.indices = [142, 587, 1203, ...] (sorted for cache-friendly access)

// 5. Extract and convert sampled pixels to Lab Float32
const result = await colorSampler.samplePixels({
    streamRef: imageRef,                 // For logging/diagnostics
    streamData: compressedImageData,     // From pdf-lib decodePDFRawStream()
    isCompressed: true,                  // Whether FlateDecode compressed
    width: 800,
    height: 600,
    colorSpace: 'CMYK',                  // Source color space
    bitsPerComponent: 8,                 // Source bit depth
    sourceProfile: cmykProfileBuffer,    // ICC profile (ArrayBuffer)
    pixelIndices: sampling.indices,      // From ImageSampler
});

// 6. Use Lab values for Delta-E computation
// result.labValues is Float32Array: [L0, a0, b0, L1, a1, b1, ...]
console.log(`Sampled ${result.pixelCount} pixels`);
console.log(`First pixel Lab: L=${result.labValues[0].toFixed(2)}, a=${result.labValues[1].toFixed(2)}, b=${result.labValues[2].toFixed(2)}`);
```

---

## API Reference

### Constructor

```javascript
new PDFImageColorSampler(configuration, options?)
```

#### Configuration (Required)

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `renderingIntent` | `RenderingIntent` | Yes | Rendering intent for color conversion |
| `blackPointCompensation` | `boolean` | Yes | Enable black point compensation |
| `useAdaptiveBPCClamping` | `boolean` | Yes | Enable adaptive BPC clamping (usually `false` for analysis) |
| `destinationProfile` | `'Lab'` | Yes | **Must be `'Lab'`** - built-in D50 Lab profile |
| `destinationColorSpace` | `'Lab'` | Yes | **Must be `'Lab'`** |
| `inputType` | `ColorType` | Yes | Default input color space: `'RGB'`, `'CMYK'`, `'Gray'`, `'Lab'` |
| `compressOutput` | `boolean` | Yes | Always `false` for analysis mode |
| `verbose` | `boolean` | Yes | Enable verbose logging |

#### Options (Optional)

| Property | Type | Description |
|----------|------|-------------|
| `colorEngineProvider` | `ColorEngineProvider` | Shared WASM color engine instance |
| `policy` | `ColorConversionPolicy` | Custom conversion policy |
| `engineVersion` | `string` | Color engine version for policy rules |
| `domain` | `string` | Domain context (defaults to `'Analysis'`) |

### Methods

#### `samplePixels(input): Promise<PDFImageColorSamplerResult>`

Extract and convert sampled pixels to Lab Float32.

**Input:**

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `streamRef` | `any` | Yes | Reference for logging (e.g., image name, PDF ref) |
| `streamData` | `Uint8Array` | Yes | Image stream data (compressed or raw) |
| `isCompressed` | `boolean` | Yes | Whether data is FlateDecode compressed |
| `width` | `number` | Yes | Image width in pixels |
| `height` | `number` | Yes | Image height in pixels |
| `colorSpace` | `ColorType` | Yes | Source color space |
| `bitsPerComponent` | `1\|2\|4\|8\|16` | Yes | Source bit depth |
| `sourceProfile` | `ArrayBuffer\|'Lab'` | No | ICC profile data or `'Lab'` for Lab input |
| `pixelIndices` | `number[]` | Yes | Array of pixel indices to sample |

**Output:**

| Property | Type | Description |
|----------|------|-------------|
| `labValues` | `Float32Array` | Lab values: `[L0, a0, b0, L1, a1, b1, ...]` |
| `pixelCount` | `number` | Number of sampled pixels |
| `sampledIndices` | `number[]` | The input pixel indices |
| `width` | `number` | Original image width |
| `height` | `number` | Original image height |
| `originalColorSpace` | `ColorType` | Original color space |

#### `extractAllPixels(input): Promise<PDFImageColorSamplerResult>`

Convert all pixels to Lab Float32 (no sampling).

Same as `samplePixels()` but without the `pixelIndices` parameter.

**Warning:** For large images, this creates large Float32Arrays. Prefer `samplePixels()` with `ImageSampler`.

#### Static: `PDFImageColorSampler.convertLab8ToFloat(lab8Buffer): Float32Array`

Utility to convert legacy 8-bit Lab data to Float32.

```javascript
const lab8 = new Uint8Array([128, 128, 128]); // Mid-gray in Lab 8-bit
const labFloat = PDFImageColorSampler.convertLab8ToFloat(lab8);
// labFloat = Float32Array([50.2, 0, 0]) approximately
```

---

## Integration with compare-pdf-outputs.js

### Before (Current Implementation)

```javascript
// From compare-pdf-outputs.js lines 1166-1194
const extractSampledPixels = (pixelData, channels, indices) => {
    const sampleCount = indices.length;
    const sampledBuffer = new Uint8Array(sampleCount * channels);
    for (let i = 0; i < sampleCount; i++) {
        const srcOffset = indices[i] * channels;
        const dstOffset = i * channels;
        for (let c = 0; c < channels; c++) {
            sampledBuffer[dstOffset + c] = pixelData[srcOffset + c];
        }
    }
    return sampledBuffer;
};

const convertLab8ToFloat = (lab8Buffer) => {
    const pixelCount = lab8Buffer.length / 3;
    const labFloat = new Float32Array(pixelCount * 3);
    for (let i = 0; i < pixelCount; i++) {
        const offset = i * 3;
        labFloat[offset] = (lab8Buffer[offset] / 255) * 100;
        labFloat[offset + 1] = lab8Buffer[offset + 1] - 128;
        labFloat[offset + 2] = lab8Buffer[offset + 2] - 128;
    }
    return labFloat;
};

// Convert reference image sampled pixels to Lab 8-bit
const refColorSpace = mapColorSpace(refImage.colorSpace);
const refSampledBuffer = extractSampledPixels(refImage.pixelData, refImage.channels, sampling.indices);
const refResult = await labConverter.convertColorsBuffer(refSampledBuffer, {
    inputColorSpace: refColorSpace,
    outputColorSpace: 'Lab',
    sourceProfile: refProfile,
    destinationProfile: 'Lab',
    bitsPerComponent: 8,
    endianness: 'native',
});
// Manual conversion loses precision
refLab = convertLab8ToFloat(refResult.outputPixels);
```

### After (Using PDFImageColorSampler)

```javascript
import { PDFImageColorSampler } from '../classes/pdf-image-color-sampler.js';

// Create sampler (reuse across multiple images)
const labSampler = new PDFImageColorSampler({
    renderingIntent: 'relative-colorimetric',
    blackPointCompensation: true,
    useAdaptiveBPCClamping: false,
    destinationProfile: 'Lab',
    destinationColorSpace: 'Lab',
    inputType: 'CMYK',
    compressOutput: false,
    verbose: false,
});
await labSampler.ensureReady();

// Convert reference image sampled pixels to Lab Float32 (single call)
const refResult = await labSampler.samplePixels({
    streamRef: refImage.name,
    streamData: refImage.pixelData,     // Already decompressed by extractImagesFromPage
    isCompressed: false,
    width: refImage.width,
    height: refImage.height,
    colorSpace: mapColorSpace(refImage.colorSpace),
    bitsPerComponent: refImage.bitsPerComponent,
    sourceProfile: refProfile,
    pixelIndices: sampling.indices,
});
// refResult.labValues is Float32Array with full precision
refLab = refResult.labValues;
```

---

## ICC Profile Sources

For Lab conversion, you need the source ICC profile. Here's how to get it from PDF images:

### 1. ICCBased Color Space (Embedded Profile)

```javascript
// From compare-pdf-outputs.js getColorSpaceInfo()
function getColorSpaceInfo(colorSpaceObj, context) {
    if (colorSpaceObj instanceof PDFArray) {
        const firstElement = colorSpaceObj.get(0);
        if (firstElement instanceof PDFName && firstElement.asString() === '/ICCBased') {
            const profileRef = colorSpaceObj.get(1);
            const profile = context.lookup(profileRef);
            if (profile instanceof PDFRawStream) {
                const decodedProfile = decodePDFRawStream(profile);
                const profileData = decodedProfile.decode();
                return {
                    name: 'ICCBased',
                    iccProfile: new Uint8Array(profileData),  // Use this!
                    channels: profile.dict.get(PDFName.of('N')).asNumber(),
                };
            }
        }
    }
    // ...
}
```

### 2. Device* Color Space (Use Output Intent)

```javascript
// From compare-pdf-outputs.js extractOutputIntentProfile()
function extractOutputIntentProfile(pdfDocument) {
    const catalog = pdfDocument.catalog;
    const outputIntentsRef = catalog.get(PDFName.of('OutputIntents'));
    // ... extract DestOutputProfile stream ...
    return {
        profile: decodedProfileData,    // Use this for Device* images!
        description: 'Profile Name',
    };
}

// Usage
const outputIntent = extractOutputIntentProfile(pdfDocument);
const sourceProfile = image.iccProfile ?? outputIntent.profile;
```

### 3. Lab Color Space (No Profile Needed)

```javascript
// Lab is device-independent - use 'Lab' sentinel
const sourceProfile = image.colorSpace === 'Lab' ? 'Lab' : image.iccProfile;
```

---

## Color Space Mapping

PDF color space names need to be mapped to `ColorType`:

```javascript
function mapColorSpace(pdfColorSpace) {
    if (pdfColorSpace === 'DeviceCMYK') return 'CMYK';
    if (pdfColorSpace === 'DeviceRGB') return 'RGB';
    if (pdfColorSpace === 'DeviceGray') return 'Gray';
    if (pdfColorSpace === 'Lab') return 'Lab';
    if (pdfColorSpace.startsWith('ICCBased')) {
        // Extract channel count from ICCBased(N)
        const match = pdfColorSpace.match(/\((\d+)\)/);
        if (match) {
            const channels = parseInt(match[1], 10);
            if (channels === 1) return 'Gray';
            if (channels === 3) return 'RGB';
            if (channels === 4) return 'CMYK';
        }
    }
    return 'CMYK'; // Default for unknown
}
```

---

## Error Handling

### Calling PDF Output Methods

```javascript
// These will throw - PDFImageColorSampler is analysis-only
await sampler.convertColor(input);        // throws Error
await sampler.convertPDFImageColor(input); // throws Error
```

Error message:
```
PDFImageColorSampler.convertColor() is not supported.
This class is for analysis only - use samplePixels() or extractAllPixels() instead.
Float32 Lab output cannot be written to PDF documents (no TYPE_Lab_FLT_SE support).
```

### Invalid Configuration

```javascript
// This will throw - must use Lab destination
new PDFImageColorSampler({
    destinationProfile: cmykProfile,  // Wrong!
    destinationColorSpace: 'CMYK',    // Wrong!
    // ...
});
```

Error message:
```
PDFImageColorSampler requires destinationProfile: "Lab".
This class is for analysis only, not PDF output.
```

### Invalid Pixel Indices

```javascript
await sampler.samplePixels({
    width: 100,
    height: 100,           // totalPixels = 10000
    pixelIndices: [15000], // Invalid!
    // ...
});
```

Error message:
```
Invalid pixel index 15000 - image has 10000 pixels (100×100)
```

---

## Performance Considerations

1. **Reuse the sampler instance** across multiple images (same configuration)
2. **Use ImageSampler** for consistent sampling across reference and sample images
3. **Sort pixel indices** for cache-friendly memory access (ImageSampler does this)
4. **Avoid extractAllPixels()** for large images (>2MP) - use sampling instead

```javascript
// Good: Reuse sampler
const sampler = new PDFImageColorSampler(config);
await sampler.ensureReady();

for (const image of images) {
    const result = await sampler.samplePixels({ ...image, pixelIndices });
}

// Cleanup when done
sampler.dispose();
```

---

## Lab Float32 Value Ranges

The output `labValues` Float32Array contains:

| Channel | Range | Unit |
|---------|-------|------|
| L* | 0 to 100 | Lightness |
| a* | -128 to +127 | Green to Red |
| b* | -128 to +127 | Blue to Yellow |

These match the CIE L*a*b* (D50) color space used by ICC profiles.

---

## Complete Example: Delta-E Comparison

```javascript
import { PDFImageColorSampler } from '../classes/pdf-image-color-sampler.js';
import { ImageSampler } from './classes/image-sampler.mjs';
import { DeltaEMetrics } from './classes/delta-e-metrics.mjs';

// Setup
const imageSampler = new ImageSampler({ sampling: 'random', defaults: { count: 10000 } });
const colorSampler = new PDFImageColorSampler({
    renderingIntent: 'relative-colorimetric',
    blackPointCompensation: true,
    useAdaptiveBPCClamping: false,
    destinationProfile: 'Lab',
    destinationColorSpace: 'Lab',
    inputType: 'CMYK',
    compressOutput: false,
    verbose: false,
});
await colorSampler.ensureReady();

// Sample same indices for both images
const sampling = imageSampler.sample(width, height);

// Convert reference image
const refResult = await colorSampler.samplePixels({
    streamRef: 'reference',
    streamData: refImageData,
    isCompressed: false,
    width, height,
    colorSpace: 'CMYK',
    bitsPerComponent: 8,
    sourceProfile: refProfile,
    pixelIndices: sampling.indices,
});

// Convert sample image
const sampleResult = await colorSampler.samplePixels({
    streamRef: 'sample',
    streamData: sampleImageData,
    isCompressed: false,
    width, height,
    colorSpace: 'CMYK',
    bitsPerComponent: 8,
    sourceProfile: sampleProfile,
    pixelIndices: sampling.indices,
});

// Compute Delta-E
const metrics = new DeltaEMetrics({ metrics: ['Average', 'Maximum'] });
metrics.addFromPixelArrays(
    refResult.labValues,
    sampleResult.labValues,
    Array.from({ length: sampling.indices.length }, (_, i) => i)
);

const result = metrics.getMetrics();
console.log(`Average Delta-E: ${result.metrics.find(m => m.type === 'average').value.toFixed(4)}`);
console.log(`Maximum Delta-E: ${result.metrics.find(m => m.type === 'maximum').value.toFixed(4)}`);

// Cleanup
colorSampler.dispose();
```

---

## Technical Background

### Why Float32 Cannot Be Written to PDF

1. **PDF specification (ISO 32000)** requires multi-byte integers in big-endian format
2. **LittleCMS TYPE_Lab_FLT** outputs little-endian Float32 (WASM is little-endian)
3. **No TYPE_Lab_FLT_SE exists** in LittleCMS (Float32 has no endian swap variant)
4. **Manual byte swapping would corrupt** IEEE 754 floating-point representation

Therefore, Float32 Lab output is restricted to analysis use cases where the data stays in memory.

### ENDIAN16_SH Flag

For 16-bit formats, LittleCMS provides the `ENDIAN16_SH` flag:
- `TYPE_Lab_16`: Native endian (little-endian on WASM)
- `TYPE_Lab_16_SE`: Swapped endian (big-endian for PDF)

But for Float32:
- `TYPE_Lab_FLT`: Native endian only
- No `TYPE_Lab_FLT_SE` equivalent

---

## Related Files

| File | Purpose |
|------|---------|
| `classes/pdf-image-color-sampler.js` | This class |
| `classes/pdf-image-color-converter.js` | Parent class (PDF output) |
| `classes/image-color-converter.js` | Grandparent class |
| `classes/color-converter.js` | Base class with `convertColorsBuffer()` |
| `classes/color-conversion-policy.js` | Format selection rules |
| `experiments/classes/image-sampler.mjs` | Pixel sampling strategies |
| `experiments/classes/delta-e-metrics.mjs` | Delta-E computation |
| `experiments/compare-pdf-outputs.js` | CLI tool using these classes |
