# ConRes Color Engine Integration Guide for PDF Processing

**For:** AI Agents, Claude Code, GitHub Copilot  
**Purpose:** Integration of K-Only GCR color transformations into PDF processing workflows  
**Last Updated:** 2025-12-04

---

## Overview

This document provides implementation guidance for integrating the ConRes Color Engine into PDF processing workflows (e.g., PDFLib.js). The engine provides two implementation options:

1. **JavaScript Prototype** (`js-color-engine`) - Pure JavaScript implementation based on refactored jsColorEngine
2. **WebAssembly Baseline** (`color-engine`) - C implementation using LittleCMS compiled to WebAssembly

Both implementations provide the same core functionality: **K-Only Black Point Compensation with Gray Component Replacement (GCR)**, which converts RGB colors to CMYK with neutral grays using only the K (black) channel.

---

## Quick Start

### Option A: JavaScript Implementation (js-color-engine)

```javascript
import { Transform, Profile, eIntent } from '@conres/js-color-engine';
import { readFile } from 'fs/promises';

// Load CMYK profile
const profileBuffer = await readFile('path/to/cmyk-profile.icc');
const inputProfile = new Profile('*sRGB');
const outputProfile = new Profile();
outputProfile.loadBinary(profileBuffer);

// Create transform with K-Only GCR
const transform = new Transform({
    promoteGrayToCMYKBlack: true,  // Enable K-Only GCR
    buildLUT: true,                 // Pre-build LUT for performance
    useLegacy: false,               // Use refactored implementation
    BPC: true,                      // Enable Black Point Compensation
    dataFormat: 'int8',             // Input/output as 8-bit integers
});

transform.create(inputProfile, outputProfile, eIntent.relative);

// Transform pixel data (RGB → CMYK)
const rgbPixels = new Uint8Array([0, 0, 0, 128, 128, 128, 255, 255, 255]);  // 3 pixels
const cmykPixels = transform.transformArrayViaLUT(rgbPixels);
// Result: Pure black → K=100, Gray → K-only, White → K=0
```

### Option B: WebAssembly Implementation (color-engine / LittleCMS)

```javascript
import * as LittleCMS from '@conres/color-engine';
import { readFile } from 'fs/promises';

// Initialize WASM engine
const engine = await LittleCMS.createEngine();

// Load profiles
const profileBuffer = await readFile('path/to/cmyk-profile.icc');
const srgbProfile = engine.createSRGBProfile();
const cmykProfile = engine.openProfileFromMem(new Uint8Array(profileBuffer));

// Create transform with K-Only GCR intent
const transform = engine.createTransform(
    srgbProfile, LittleCMS.TYPE_RGB_8,
    cmykProfile, LittleCMS.TYPE_CMYK_8,
    LittleCMS.INTENT_PRESERVE_K_ONLY_RELATIVE_COLORIMETRIC_GCR,
    LittleCMS.cmsFLAGS_BLACKPOINTCOMPENSATION
);

// Transform pixel data
const rgbInput = new Uint8Array([0, 0, 0, 128, 128, 128, 255, 255, 255]);
const cmykOutput = new Uint8Array(4 * 3);  // 4 channels × 3 pixels
engine.doTransform(transform, rgbInput, cmykOutput, 3);

// Cleanup
engine.deleteTransform(transform);
engine.closeProfile(cmykProfile);
engine.closeProfile(srgbProfile);
```

---

## Implementation Details

### JavaScript Implementation (js-color-engine)

#### Import Structure

```javascript
import { 
    Transform,           // Main transform class
    Profile,             // ICC profile handler
    eIntent,             // Rendering intent enum
    intent2String,       // Intent to string helper
    LookupTable,         // LUT class (internal use)
    eColourType          // Color type enum
} from '@conres/js-color-engine';
```

#### Transform Configuration Options

| Option                   | Type    | Default   | Description                         |
| ------------------------ | ------- | --------- | ----------------------------------- |
| `promoteGrayToCMYKBlack` | boolean | `false`   | Enable K-Only GCR for neutral grays |
| `buildLUT`               | boolean | `false`   | Pre-build 3D LUT for performance    |
| `useLegacy`              | boolean | `true`    | Use original jsColorEngine behavior |
| `BPC`                    | boolean | `false`   | Enable Black Point Compensation     |
| `dataFormat`             | string  | `'float'` | `'int8'`, `'int16'`, or `'float'`   |
| `precision`              | number  | `33`      | LUT grid resolution (33×33×33)      |

#### Critical Settings for K-Only GCR

```javascript
const transform = new Transform({
    promoteGrayToCMYKBlack: true,   // REQUIRED for K-Only output
    buildLUT: true,                  // REQUIRED for performance
    useLegacy: false,                // REQUIRED for refactored implementation
    BPC: true,                       // RECOMMENDED for consistent shadows
});
```

#### Transform Methods

```javascript
// Create transform (call once, reuse for all pixels)
transform.create(inputProfile, outputProfile, eIntent.relative);

// Transform pixel array via pre-built LUT (fastest)
const cmykPixels = transform.transformArrayViaLUT(rgbPixels);

// Transform single color (slower, for debugging)
const cmyk = transform.forward({ R: 0, G: 0, B: 0 });
```

#### Rendering Intents

```javascript
import { eIntent } from '@conres/js-color-engine';

eIntent.perceptual   // 0 - Perceptual rendering
eIntent.relative     // 1 - Relative colorimetric (RECOMMENDED for K-Only)
eIntent.saturation   // 2 - Saturation rendering
eIntent.absolute     // 3 - Absolute colorimetric
```

### WebAssembly Implementation (color-engine / LittleCMS)

#### Import Structure

```javascript
import * as LittleCMS from '@conres/color-engine';
// Or individual exports:
import { 
    createEngine,
    ColorEngine,
    TYPE_RGB_8, TYPE_CMYK_8,
    INTENT_PRESERVE_K_ONLY_RELATIVE_COLORIMETRIC_GCR,
    cmsFLAGS_BLACKPOINTCOMPENSATION
} from '@conres/color-engine';
```

#### Engine Lifecycle

```javascript
// 1. Create and initialize engine (async)
const engine = await LittleCMS.createEngine();

// 2. Create profiles
const srgb = engine.createSRGBProfile();
const cmyk = engine.openProfileFromMem(profileBuffer);

// 3. Create transform
const transform = engine.createTransform(
    srgb, LittleCMS.TYPE_RGB_8,
    cmyk, LittleCMS.TYPE_CMYK_8,
    intent, flags
);

// 4. Transform pixels (can be called many times)
engine.doTransform(transform, input, output, pixelCount);

// 5. Cleanup (IMPORTANT - prevent memory leaks)
engine.deleteTransform(transform);
engine.closeProfile(cmyk);
engine.closeProfile(srgb);
```

#### Pixel Format Constants

```javascript
// Input formats
LittleCMS.TYPE_RGB_8      // 8-bit RGB (3 bytes/pixel)
LittleCMS.TYPE_RGB_16     // 16-bit RGB (6 bytes/pixel)
LittleCMS.TYPE_RGB_FLT    // Float RGB (12 bytes/pixel)

// Output formats
LittleCMS.TYPE_CMYK_8     // 8-bit CMYK (4 bytes/pixel)
LittleCMS.TYPE_CMYK_16    // 16-bit CMYK (8 bytes/pixel)
LittleCMS.TYPE_CMYK_FLT   // Float CMYK (16 bytes/pixel)
```

#### Rendering Intents

```javascript
LittleCMS.INTENT_PERCEPTUAL                               // 0
LittleCMS.INTENT_RELATIVE_COLORIMETRIC                    // 1
LittleCMS.INTENT_SATURATION                               // 2
LittleCMS.INTENT_ABSOLUTE_COLORIMETRIC                    // 3
LittleCMS.INTENT_PRESERVE_K_ONLY_RELATIVE_COLORIMETRIC_GCR // 20 (Custom)
```

#### Transform Flags

```javascript
LittleCMS.cmsFLAGS_BLACKPOINTCOMPENSATION  // Enable BPC (0x2000)
LittleCMS.cmsFLAGS_NOCACHE                 // Disable cache (0x0040)
LittleCMS.cmsFLAGS_NOOPTIMIZE              // Disable optimization (0x0100)
LittleCMS.cmsFLAGS_FORCE_CLUT              // Force CLUT usage (0x0002)
```

---

## PDF Processing Integration Pattern

### Recommended Architecture

```javascript
class PDFColorTransformer {
    #engine = null;      // For WASM
    #jsTransform = null; // For JavaScript
    #mode = 'wasm';      // 'wasm' or 'javascript'
    
    constructor(options = {}) {
        this.#mode = options.preferJavaScript ? 'javascript' : 'wasm';
    }
    
    async initialize(cmykProfileBuffer) {
        if (this.#mode === 'wasm') {
            await this.#initWasm(cmykProfileBuffer);
        } else {
            await this.#initJavaScript(cmykProfileBuffer);
        }
    }
    
    async #initWasm(profileBuffer) {
        const LittleCMS = await import('@conres/color-engine');
        this.#engine = await LittleCMS.createEngine();
        
        const srgb = this.#engine.createSRGBProfile();
        const cmyk = this.#engine.openProfileFromMem(new Uint8Array(profileBuffer));
        
        this._wasmTransform = this.#engine.createTransform(
            srgb, LittleCMS.TYPE_RGB_8,
            cmyk, LittleCMS.TYPE_CMYK_8,
            LittleCMS.INTENT_PRESERVE_K_ONLY_RELATIVE_COLORIMETRIC_GCR,
            LittleCMS.cmsFLAGS_BLACKPOINTCOMPENSATION
        );
        
        this._srgbProfile = srgb;
        this._cmykProfile = cmyk;
    }
    
    async #initJavaScript(profileBuffer) {
        const { Transform, Profile, eIntent } = await import('@conres/js-color-engine');
        
        const inputProfile = new Profile('*sRGB');
        const outputProfile = new Profile();
        outputProfile.loadBinary(profileBuffer);
        
        this.#jsTransform = new Transform({
            promoteGrayToCMYKBlack: true,
            buildLUT: true,
            useLegacy: false,
            BPC: true,
            dataFormat: 'int8',
        });
        
        this.#jsTransform.create(inputProfile, outputProfile, eIntent.relative);
    }
    
    transformPixels(rgbPixels, pixelCount) {
        if (this.#mode === 'wasm') {
            const output = new Uint8Array(pixelCount * 4);
            this.#engine.doTransform(this._wasmTransform, rgbPixels, output, pixelCount);
            return output;
        } else {
            return this.#jsTransform.transformArrayViaLUT(rgbPixels);
        }
    }
    
    dispose() {
        if (this.#mode === 'wasm' && this.#engine) {
            this.#engine.deleteTransform(this._wasmTransform);
            this.#engine.closeProfile(this._cmykProfile);
            this.#engine.closeProfile(this._srgbProfile);
        }
        this.#engine = null;
        this.#jsTransform = null;
    }
}
```

### Usage in PDF Processing

```javascript
async function processPDFImages(pdfDoc, cmykProfilePath) {
    const profileBuffer = await readFile(cmykProfilePath);
    const transformer = new PDFColorTransformer({ preferJavaScript: false });
    await transformer.initialize(profileBuffer);
    
    try {
        // Process each image in the PDF
        for (const image of pdfDoc.getImages()) {
            if (image.colorSpace === 'RGB') {
                const rgbPixels = image.getPixelData();
                const cmykPixels = transformer.transformPixels(rgbPixels, image.pixelCount);
                
                // Update image with CMYK data
                image.setPixelData(cmykPixels, 'CMYK');
            }
        }
    } finally {
        transformer.dispose();
    }
}
```

---

## K-Only GCR Algorithm Behavior

### What It Does

The K-Only GCR algorithm ensures that **neutral gray RGB values convert to K-only CMYK output**:

| RGB Input        | Standard CMYK   | K-Only GCR CMYK |
| ---------------- | --------------- | --------------- |
| RGB(0,0,0)       | C60 M50 Y50 K90 | C0 M0 Y0 K100   |
| RGB(64,64,64)    | C45 M35 Y35 K75 | C0 M0 Y0 K75    |
| RGB(128,128,128) | C30 M25 Y25 K50 | C0 M0 Y0 K50    |
| RGB(192,192,192) | C15 M10 Y10 K25 | C0 M0 Y0 K25    |
| RGB(255,255,255) | C0 M0 Y0 K0     | C0 M0 Y0 K0     |

### When to Use K-Only GCR

**Recommended Use Cases:**

- Contrast-Resolution analysis requiring pure K grayscale
- Print workflows needing reduced ink consumption
- Documents requiring metameric stability under varying lighting
- Technical printing where neutral stability is critical

**Not Recommended For:**

- Photographic reproduction requiring rich blacks
- Output profiles already using maximum GCR
- Workflows requiring exact ICC intent compliance

### Black Point Compensation (BPC)

**With BPC Enabled (Recommended):**

- Shadow detail is preserved through smooth compression to K-only black
- Prevents clipping of near-black values
- Uses CMYK(0,0,0,100) as reference black instead of CMYK(100,100,100,100)

**Without BPC:**

- May result in shadow clipping
- Deep blacks may not reach full density

---

## Performance Considerations

### Benchmarks (Typical Results)

| Implementation      | Throughput    | Notes                              |
| ------------------- | ------------- | ---------------------------------- |
| WASM (LittleCMS)    | ~15-25 M px/s | After warmup, direct memory access |
| JavaScript (LUT)    | ~8-15 M px/s  | Pre-built 33×33×33 LUT             |
| JavaScript (direct) | ~0.1 M px/s   | Per-pixel calculation (avoid)      |

### Optimization Tips

1. **Always use pre-built LUT** for JavaScript (`buildLUT: true`)
2. **Reuse transform objects** - creation is expensive, transformation is fast
3. **Process in batches** - larger arrays have better throughput
4. **Warmup** - first few transforms may be slower (JIT compilation)

```javascript
// Good: Create once, use many times
const transform = new Transform({ buildLUT: true, ... });
transform.create(input, output, intent);

for (const image of images) {
    transform.transformArrayViaLUT(image.pixels);  // Fast
}

// Bad: Creating transform per image
for (const image of images) {
    const t = new Transform({ buildLUT: true, ... });
    t.create(input, output, intent);  // Slow!
    t.transformArrayViaLUT(image.pixels);
}
```

---

## Error Handling

### Common Errors

```javascript
// JavaScript Implementation
try {
    const profile = new Profile();
    profile.loadBinary(invalidBuffer);
} catch (error) {
    // "Invalid ICC profile" or "Profile parsing error"
}

// WASM Implementation
const profile = engine.openProfileFromMem(buffer);
if (!profile) {
    // Profile handle is null - invalid profile
    throw new Error('Failed to load ICC profile');
}
```

### Validation

```javascript
// Verify K-Only output for pure black
function validateKOnlyTransform(transformer) {
    const black = new Uint8Array([0, 0, 0]);
    const result = transformer.transformPixels(black, 1);
    
    const k = Math.round(result[3] / 255 * 100);
    const cmy = result[0] + result[1] + result[2];
    
    if (k !== 100 || cmy > 5) {
        throw new Error(`K-Only validation failed: K=${k}%, CMY=${cmy}`);
    }
    
    return true;
}
```

---

## File Locations

| Component                | Path                                                     |
| ------------------------ | -------------------------------------------------------- |
| JavaScript Engine        | `packages/js-color-engine/src/main.js`                   |
| WASM Engine              | `packages/color-engine/src/index.js`                     |
| Transform Implementation | `packages/js-color-engine/src/transform.js`              |
| Test Profiles            | `packages/js-color-engine/specs/fixtures/profiles/cmyk/` |
| Benchmark Script         | `benchmarks/quick-benchmark.js`                          |
| Validation Scripts       | `experiments/lut-refactor-demonstration.js`              |

---

## Testing Your Integration

### Quick Validation

```javascript
async function validateIntegration() {
    const results = [];
    
    // Test cases: RGB → expected K%
    const testCases = [
        { rgb: [0, 0, 0], expectedK: 100, name: 'Pure Black' },
        { rgb: [128, 128, 128], expectedK: 50, name: '50% Gray', tolerance: 5 },
        { rgb: [255, 255, 255], expectedK: 0, name: 'White' },
    ];
    
    for (const test of testCases) {
        const input = new Uint8Array(test.rgb);
        const output = transformer.transformPixels(input, 1);
        const k = Math.round(output[3] / 255 * 100);
        const tolerance = test.tolerance || 2;
        
        const passed = Math.abs(k - test.expectedK) <= tolerance;
        results.push({
            name: test.name,
            expected: test.expectedK,
            actual: k,
            passed,
        });
    }
    
    return results;
}
```

### Running Demonstration Scripts

```bash
# Full K-Only GCR validation (all profiles)
node experiments/lut-refactor-demonstration.js --forceWithBPC

# BPC-focused validation
node experiments/bpc-refactor-demonstration.js --forceWithBPC

# Performance benchmark
node benchmarks/quick-benchmark.js
```

---

## Troubleshooting

### Issue: Gray values not converting to K-only

**Check:**

1. `promoteGrayToCMYKBlack: true` is set (JavaScript)
2. `INTENT_PRESERVE_K_ONLY_RELATIVE_COLORIMETRIC_GCR` is used (WASM)
3. `useLegacy: false` is set (JavaScript)

### Issue: Pure black not reaching K=100

**Check:**

1. BPC is enabled (`BPC: true` or `cmsFLAGS_BLACKPOINTCOMPENSATION`)
2. Profile supports full K range (some profiles cap at K=95)
3. Using relative colorimetric intent

### Issue: Memory leaks in WASM

**Check:**

1. All profiles closed with `engine.closeProfile()`
2. All transforms deleted with `engine.deleteTransform()`
3. Use try/finally pattern for cleanup

### Issue: Slow performance

**Check:**

1. `buildLUT: true` is set (JavaScript)
2. Transform is created once and reused
3. Processing in batches, not single pixels

---

## Attribution

### K-Only Black Algorithm

- **Algorithm Design & Development:** Saleh Abdel Motaal
- **Project:** ConRes (Contrast-Resolution Analysis)
- **Team:** ConRes project team (5 members)
- **Purpose:** Specialized color transformation for perceptually-correlated Contrast-Resolution analysis

### Underlying Color Management Systems

- **jsColorEngine:** Glenn Wilton (O2 Creative Limited) — JavaScript ICC profile implementation used for prototyping
- **LittleCMS:** Marti Maria — C color management library used for WebAssembly baseline implementation

### Documentation

- **Documentation Assistance:** Claude Code, December 2025
