# 2026-01-28 DECLAUDING Progress

**Objective:** Remove hardcoded 8-bit coercion from the color conversion pipeline and implement a proper `ColorConversionPolicy` class that determines pixel formats based on actual input data characteristics.

**Last Updated:** 2026-01-28

---

## Problem Summary

The codebase has been systematically "clauded" by forcing all color data to 8-bit in multiple locations, eliminating the carefully exported `TYPE_*` constants from the Color Engine that support:

- 8-bit, 16-bit, and 32-bit floating-point formats
- Big-endian and little-endian variants
- Planar and packed pixel arrangements
- Various channel orderings (RGB, BGR, RGBA, ARGB, etc.)

This defeats the purpose of having a WebAssembly LittleCMS port with advanced bit-depth handling.

---

## Root Cause Analysis

### 1. `ColorEngineService.#getPixelFormat()` — Line 455-463

**Location:** `services/ColorEngineService.js`

```javascript
#getPixelFormat(type) {
    switch (type) {
        case 'CMYK': return LittleCMS.TYPE_CMYK_8;
        case 'RGB': return LittleCMS.TYPE_RGB_8;
        case 'Lab': return LittleCMS.TYPE_Lab_8;
        case 'Gray': return LittleCMS.TYPE_GRAY_8;
        default: throw new Error(`Unsupported color type: ${type}`);
    }
}
```

**Problem:** This method accepts ONLY a color type string and returns ONLY 8-bit format constants. It has:
- No bit depth parameter
- No endianness parameter
- No access to actual input data characteristics

**Called from:**
- `convertColors()` — Line 570-571
- `convertPixelBuffer()` — Line 720-721
- `convertPixelBufferMultiprofile()` — Line 824-825

### 2. `ImageColorConverter` Constants — Line 64-70, 104-109

**Location:** `classes/image-color-converter.js`

```javascript
export const PIXEL_FORMATS = {
    TYPE_RGB_8: 0x40019,
    TYPE_CMYK_8: 0x60021,
    TYPE_GRAY_8: 0x30009,
    TYPE_Lab_8: 0xa0019,
    TYPE_Lab_16: 0xa001a,  // Only 16-bit variant!
};

const COLOR_TYPE_TO_FORMAT = {
    'RGB': PIXEL_FORMATS.TYPE_RGB_8,
    'Gray': PIXEL_FORMATS.TYPE_GRAY_8,
    'Lab': PIXEL_FORMATS.TYPE_Lab_8,
    'CMYK': PIXEL_FORMATS.TYPE_CMYK_8,
};
```

**Problem:** Duplicates format constants (poorly) and hardcodes 8-bit mapping. The Color Engine exports 200+ format constants in `constants.js`.

### 3. `PDFImageColorConverter.#normalizeBitsPerComponent()` — Line 345-404

**Location:** `classes/pdf-image-color-converter.js`

```javascript
#normalizeBitsPerComponent(data, bitsPerComponent, colorSpace, width, height) {
    // ... converts 16-bit, 4-bit, 2-bit, 1-bit all to 8-bit
    if (bitsPerComponent === 16) {
        // 16-bit to 8-bit: divide by 257
        // ...
    }
}
```

**Problem:** Forcibly converts ALL non-8-bit data to 8-bit BEFORE sending to the color engine, losing precision. The color engine CAN handle 16-bit data natively with `TYPE_*_16` formats.

### 4. Output Buffer Allocation in `ColorEngineService`

**Location:** `services/ColorEngineService.js` — Lines 594, 746, 849

```javascript
const outputBuffer = new Uint8Array(pixelCount * outputChannels);
```

**Problem:** Always allocates `Uint8Array` regardless of output format. Should allocate appropriate TypedArray based on output format:
- `Uint8Array` for `TYPE_*_8` formats
- `Uint16Array` for `TYPE_*_16` formats
- `Float32Array` for `TYPE_*_FLT` formats

### 5. Type Definitions

**Location:** `classes/image-color-converter.js` — Line 35

```javascript
@typedef {{
  pixelBuffer: Uint8Array,  // Should support Uint8Array | Uint16Array | Float32Array
  ...
}} ImageColorConverterInput
```

**Problem:** Type definitions restrict to `Uint8Array` only.

### 6. Empty `ColorConversionPolicy` Class

**Location:** `classes/color-conversion-policy.js`

```javascript
export class ColorConversionPolicy {
}
```

**Problem:** This class should have been implemented to centralize format decisions but was left as an empty stub.

---

## Available `TYPE_*` Constants (Partial List)

From `packages/color-engine-2026-01-30/src/constants.js`:

### Grayscale Formats
| Constant | Value | Description |
|----------|-------|-------------|
| `TYPE_GRAY_8` | 196617 | 8-bit grayscale |
| `TYPE_GRAY_16` | 196618 | 16-bit grayscale |
| `TYPE_GRAY_16_SE` | 198666 | 16-bit grayscale, swapped endian |
| `TYPE_GRAY_FLT` | 4390924 | 32-bit float grayscale |

### RGB Formats
| Constant | Value | Description |
|----------|-------|-------------|
| `TYPE_RGB_8` | 262169 | 8-bit RGB |
| `TYPE_RGB_16` | 262170 | 16-bit RGB |
| `TYPE_RGB_16_SE` | 264218 | 16-bit RGB, swapped endian |
| `TYPE_RGB_FLT` | 4456476 | 32-bit float RGB |
| `TYPE_BGR_8` | 263193 | 8-bit BGR |
| `TYPE_BGR_16` | 263194 | 16-bit BGR |

### CMYK Formats
| Constant | Value | Description |
|----------|-------|-------------|
| `TYPE_CMYK_8` | 393249 | 8-bit CMYK |
| `TYPE_CMYK_16` | 393250 | 16-bit CMYK |
| `TYPE_CMYK_16_SE` | 395298 | 16-bit CMYK, swapped endian |
| `TYPE_CMYK_FLT` | 4587556 | 32-bit float CMYK |

### Lab Formats
| Constant | Value | Description |
|----------|-------|-------------|
| `TYPE_Lab_8` | 655385 | 8-bit Lab |
| `TYPE_Lab_16` | 655386 | 16-bit Lab |
| `TYPE_Lab_FLT` | 4849692 | 32-bit float Lab |

---

## Solution Architecture

### `ColorConversionPolicy` Base Class

```javascript
/**
 * Base class for determining color conversion parameters.
 * Inspects input data characteristics and determines appropriate
 * pixel formats for the color engine.
 */
export class ColorConversionPolicy {
    /**
     * Determines the input pixel format constant for the color engine.
     *
     * @param {object} inputDescriptor - Description of input data
     * @param {string} inputDescriptor.colorSpace - 'RGB' | 'Gray' | 'Lab' | 'CMYK'
     * @param {number} inputDescriptor.bitsPerComponent - 8, 16, or 32
     * @param {boolean} [inputDescriptor.isBigEndian] - Endianness for 16-bit
     * @param {boolean} [inputDescriptor.isPlanar] - Planar vs interleaved
     * @param {string} [inputDescriptor.channelOrder] - 'RGB', 'BGR', 'RGBA', etc.
     * @returns {number} TYPE_* constant for input format
     */
    getInputFormat(inputDescriptor) { ... }

    /**
     * Determines the output pixel format constant for the color engine.
     *
     * @param {object} outputDescriptor - Description of desired output
     * @param {string} outputDescriptor.colorSpace - 'RGB' | 'Gray' | 'Lab' | 'CMYK'
     * @param {number} [outputDescriptor.bitsPerComponent] - 8, 16, or 32
     * @param {boolean} [outputDescriptor.isBigEndian] - Endianness for 16-bit
     * @returns {number} TYPE_* constant for output format
     */
    getOutputFormat(outputDescriptor) { ... }

    /**
     * Creates appropriate TypedArray for output based on format.
     *
     * @param {number} format - TYPE_* constant
     * @param {number} pixelCount - Number of pixels
     * @param {number} channels - Number of channels per pixel
     * @returns {Uint8Array | Uint16Array | Float32Array}
     */
    createOutputBuffer(format, pixelCount, channels) { ... }

    /**
     * Gets bytes per sample for a given format.
     *
     * @param {number} format - TYPE_* constant
     * @returns {1 | 2 | 4}
     */
    getBytesPerSample(format) { ... }
}
```

### `ColorEngineColorConversionPolicy` Subclass

```javascript
/**
 * Color Engine specific policy that determines:
 * - Input/output formats based on data characteristics
 * - Whether to use createTransform vs createMultiprofileTransform
 * - Adaptive BPC clamping thresholds
 */
export class ColorEngineColorConversionPolicy extends ColorConversionPolicy {
    /**
     * Determines if multiprofile transform is needed.
     *
     * @param {object} conversionDescriptor
     * @param {string} conversionDescriptor.sourceColorSpace
     * @param {string} conversionDescriptor.destinationColorSpace
     * @param {string} conversionDescriptor.renderingIntent
     * @returns {boolean}
     */
    requiresMultiprofileTransform(conversionDescriptor) { ... }

    /**
     * Gets the intermediate profiles for multiprofile transform.
     *
     * @param {object} conversionDescriptor
     * @returns {string[]} Profile identifiers or buffers
     */
    getIntermediateProfiles(conversionDescriptor) { ... }
}
```

---

## Roadmap

- [ ] **Phase 1: Implement `ColorConversionPolicy` base class**
  - [ ] Define type definitions for input/output descriptors
  - [ ] Implement `getInputFormat()` with bit depth, endianness, channel order support
  - [ ] Implement `getOutputFormat()` with bit depth support
  - [ ] Implement `createOutputBuffer()` for appropriate TypedArray allocation
  - [ ] Implement `getBytesPerSample()` helper
  - [ ] Add format constant imports from color engine

- [ ] **Phase 2: Implement `ColorEngineColorConversionPolicy` subclass**
  - [ ] Implement `requiresMultiprofileTransform()` logic
  - [ ] Implement `getIntermediateProfiles()` for K-Only GCR with Gray input
  - [ ] Add transform caching considerations

- [ ] **Phase 3: Update `ColorEngineService`**
  - [ ] Replace `#getPixelFormat()` with policy-based format selection
  - [ ] Update `convertPixelBuffer()` to use policy for format determination
  - [ ] Update `convertPixelBufferMultiprofile()` to use policy
  - [ ] Update output buffer allocation to use policy's `createOutputBuffer()`
  - [ ] Support `Uint16Array` and `Float32Array` input/output

- [ ] **Phase 4: Update `ImageColorConverter`**
  - [ ] Remove hardcoded `PIXEL_FORMATS` constant
  - [ ] Remove hardcoded `COLOR_TYPE_TO_FORMAT` mapping
  - [ ] Accept `colorConversionPolicy` in configuration
  - [ ] Update type definitions to support `Uint8Array | Uint16Array | Float32Array`
  - [ ] Pass input descriptor to policy for format determination

- [ ] **Phase 5: Update `PDFImageColorConverter`**
  - [ ] Remove `#normalizeBitsPerComponent()` forced conversion
  - [ ] Pass actual bit depth to policy
  - [ ] Handle 16-bit PDF images natively with `TYPE_*_16` formats
  - [ ] Handle endianness (PDF uses big-endian for 16-bit)

- [ ] **Phase 6: Update `ColorConverter` base class**
  - [ ] Add `colorConversionPolicy` field to configuration
  - [ ] Update `convertColorsBuffer()` to use policy

- [ ] **Phase 7: Regression Testing**
  - [ ] Verify 8-bit conversions still work
  - [ ] Add 16-bit conversion tests
  - [ ] Add floating-point conversion tests
  - [ ] Verify PDF 16-bit images convert without precision loss

---

## Current Status

**Phase:** Phases 1 & 2 Complete - Awaiting User Review

**Next Action:** User reviews `ColorConversionPolicy` and `ColorEngineColorConversionPolicy` implementations

---

## Completed Implementations

### Phase 1: `ColorConversionPolicy` Base Class

**File:** `classes/color-conversion-policy.js`

**Features:**
- `getInputFormat(descriptor)` - Resolves input format from descriptor
- `getOutputFormat(descriptor)` - Resolves output format from descriptor
- `createOutputBuffer(format, pixelCount, channels)` - Creates appropriate TypedArray
- `createInputBuffer(format, pixelCount, channels)` - Creates appropriate TypedArray
- `getBytesPerSample(format)` - Returns 1, 2, or 4
- `getChannels(format)` - Returns channel count
- `getBytesPerPixel(format)` - Returns bytes per pixel
- `getColorSpace(format)` - Returns color space name
- `getBitDepth(format)` - Returns 8, 16, or 32
- `isFloatFormat(format)` - Boolean check for float formats
- `isBigEndian(format)` - Boolean check for endianness
- `getFormatProperties(format)` - Returns complete FormatProperties object
- `getStandardFormat(colorSpace, bitDepth)` - Convenience for common cases
- `getTypedArrayConstructor(format)` - Returns Uint8Array/Uint16Array/Float32Array
- `validateBuffer(buffer, format, pixelCount)` - Validates buffer type and size

**Supported Formats:**
- Gray: 8-bit, 16-bit (big/little endian), 32-bit float, with alpha
- RGB: 8-bit, 16-bit (big/little endian), 32-bit float, BGR, RGBA, ARGB, BGRA
- CMYK: 8-bit, 16-bit (big/little endian), 32-bit float, KYMC
- Lab: 8-bit, 16-bit, 32-bit float

### Phase 2: `ColorEngineColorConversionPolicy` Subclass

**File:** `classes/color-engine-color-conversion-policy.js`

**Features:**
- `determineTransformType(descriptor)` - Returns whether multiprofile is needed and why
- `requiresMultiprofileTransform(descriptor)` - Boolean shorthand
- `getEffectiveRenderingIntent(descriptor)` - Returns intent after fallback logic
- `getProfileChain(descriptor)` - Returns complete profile chain including intermediates
- `getIntermediateProfiles(descriptor)` - Returns intermediate profiles only
- `getConversionParameters(options)` - Returns complete conversion parameters
- `getDefaultSourceProfile(colorSpace)` - Returns default profile for color space
- `validateConversion(descriptor)` - Returns validation result with warnings/errors
- `isKOnlyGCR(intent)` - Boolean check for K-Only GCR intent
- `getKOnlyGCRFallbackIntent()` - Returns fallback intent
- `getRenderingIntentConstant(intent)` - Maps intent string to LittleCMS constant

**K-Only GCR Logic:**
- RGB → CMYK: Works directly (single profile)
- Gray → CMYK: Requires multiprofile (Gray → sRGB → CMYK)
- Lab → CMYK: Falls back to Relative Colorimetric (K-Only GCR produces incorrect output)
- Any → RGB: Falls back to Relative Colorimetric (K-Only GCR only for CMYK output)

---

## Test Results

### ColorConversionPolicy Tests

**File:** `tests/ColorConversionPolicy.test.js`
**Run:** `node --test testing/iso/ptf/2025/tests/ColorConversionPolicy.test.js`
**Results:** 55 tests, all passing

Test coverage includes:
- 32 format resolution scenarios (comprehensive loop)
- 7 buffer creation tests
- 7 format properties tests
- 2 convenience method tests
- 5 buffer validation tests
- 2 error handling tests

### ColorEngineColorConversionPolicy Tests

**File:** `tests/ColorEngineColorConversionPolicy.test.js`
**Run:** `node --test testing/iso/ptf/2025/tests/ColorEngineColorConversionPolicy.test.js`
**Results:** 37 tests, all passing

Test coverage includes:
- 15 conversion scenarios (comprehensive loop with inputDescriptor, outputDescriptor, conversionDescriptor)
- 3 determineTransformType tests
- 4 getProfileChain tests
- 4 getDefaultSourceProfile tests
- 5 validateConversion tests
- 3 rendering intent helper tests
- 3 inherited base class method tests

---

## Activity Log

| Date | Activity |
|------|----------|
| 2026-01-28 | Created DECLAUDING progress document |
| 2026-01-28 | Completed root cause analysis |
| 2026-01-28 | Documented all hardcoded 8-bit locations |
| 2026-01-28 | Defined solution architecture for ColorConversionPolicy |
| 2026-01-28 | Implemented `ColorConversionPolicy` base class (Phase 1) |
| 2026-01-28 | Implemented `ColorEngineColorConversionPolicy` subclass (Phase 2) |
| 2026-01-28 | Created comprehensive tests for both classes |
| 2026-01-28 | All 92 tests passing (55 + 37) |

---

## References

- Color Engine constants: `packages/color-engine-2026-01-30/src/constants.js`
- Color Engine tests: `packages/color-engine-2026-01-30/tests/`
- LittleCMS documentation: `upstream/Little-CMS/include/lcms2.h` (lines 700-777)
