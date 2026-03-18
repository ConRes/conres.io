# 2026-02-02 Endianness Refactor Progress

**Objective**: Replace hardwired endianness-to-format mappings with dynamic format selection based on runtime WASM endianness detection, ensuring buffer endianness is explicitly described and correctly mapped to LittleCMS TYPE_* constants.

---

## Roadmap

### Phase 1: Dynamic Endianness Refactor ✅

- [x] Document user specifications
- [x] Investigate `FORMAT_LOOKUP` in `color-conversion-policy.js`
- [x] Investigate `#decodeFormat()` logic
- [x] Investigate `PDFImageColorConverter` and `ImageColorConverter`
- [x] Investigate test expectations in `color-conversion-policy.test.js`
- [x] Investigate `StreamTransformWorker.js`
- [x] Document root cause analysis
- [x] Propose fix strategy with centralized endianness detection

**Implementation Tasks (Phase 1)**:

- [x] **1. ColorEngineProvider**: Add `RUNTIME_ENDIANNESS` and `WEB_ASSEMBLY_ENDIANNESS` constants
- [x] **2. ColorConversionPolicy**: Import WASM endianness, add `#wasmEndianness` field
- [x] **3. ColorConversionPolicy**: Add `#needsEndianSwap(bufferEndianness)` predicate (single source of truth)
- [x] **4. ColorConversionPolicy**: Replace hardwired FORMAT_LOOKUP with dynamic `#getMultiByteFormat()`
- [x] **5. ColorConversionPolicy**: Update `#buildFormat()` to use `#needsEndianSwap()`
- [x] **6. PDFImageColorConverter**: Change `'little'` → `'big'` for PDF multi-byte data (line 234, 542)
- [x] **7. Tests**: Update FORMAT_SCENARIOS expectations for multi-byte formats
- [x] **8. Regression**: Verify with existing test suite and 16-bit PDF image tests

### Phase 2: Input/Output Bits Per Component ✅

- [x] Document parameter semantics and validation rules
- [x] Plan centralized validation and late defaulting architecture

**Implementation Tasks (Phase 2)**:

- [x] **1. Add validation method**: Conditional endianness validation in resolver methods
- [x] **2. Update type definitions**: Added `inputBitsPerComponent`, `outputBitsPerComponent`, `inputEndianness`, `outputEndianness` to `PixelFormatDescriptor`
- [x] **3. Update `getInputFormat()`**: Resolves `inputBitsPerComponent ?? bitsPerComponent` and `inputEndianness ?? endianness`
- [x] **4. Update `getOutputFormat()`**: Resolves `outputBitsPerComponent ?? bitsPerComponent` and `outputEndianness ?? endianness`
- [x] **5. Audit propagation**: Added parameters to ALL converter classes (see Activity Log for full list)
- [x] **6. Implement conditional endianness validation**: 8-bit (ignored), 16-bit (required with error), 32-bit (warn if specified)
- [x] **7. Update tests**: Added 20 new tests for all valid/invalid/warning parameter combinations

### Phase 3: PDFImageColorSampler for Analysis ✅

- [x] Review `compare-pdf-outputs.js` CLI to understand integration requirements
- [x] Implement `PDFImageColorSampler extends PDFImageColorConverter`
- [x] Create comprehensive documentation (`PDFImageColorSampler.md`)

**Implementation Tasks (Phase 3)**:

- [x] **1. Create `pdf-image-color-sampler.js`**: New class extending PDFImageColorConverter
- [x] **2. Implement `samplePixels()` method**: Extract and convert sampled pixels to Lab Float32
- [x] **3. Implement `extractAllPixels()` method**: Convenience method for full image conversion
- [x] **4. Block PDF output methods**: Override `convertColor()` and `convertPDFImageColor()` to throw
- [x] **5. Validate Lab configuration**: Constructor enforces destinationProfile='Lab', destinationColorSpace='Lab'
- [x] **6. Add static utility**: `convertLab8ToFloat()` for legacy compatibility
- [x] **7. Create `PDFImageColorSampler.md`**: Comprehensive documentation for other agent integration
- [x] **8. Add PDFImageColorConverter validation**: Throw on Float32 output, warn on contradictory endianness

---

## Current Status

**Phase**: Phase 1, Phase 2, and Phase 3 Complete

**Last Updated**: 2026-02-02

Phase 1 (Dynamic Endianness): All 8 implementation tasks completed.
Phase 2 (Input/Output Bits Per Component): All 7 implementation tasks completed.
Phase 3 (PDFImageColorSampler for Analysis): Implementation complete.

Propagation audit completed — added `inputBitsPerComponent`, `outputBitsPerComponent`, `inputEndianness`, `outputEndianness` to:
- `ImageColorConverterInput` typedef
- `ImageColorConverter.convertColor()` and `prepareWorkerTask()`
- `PDFImageColorConverterInput` typedef
- `PDFImageColorConverter.convertPDFImageColor()` and `prepareWorkerTask()`
- `ImageTask` typedef in `worker-pool.js`
- `worker-pool-entrypoint.js processImage()`

Full test suite: 284 tests pass, 51 skipped, 0 failures.

---

## User Specifications (Authoritative)

### Specification 1: Buffer Endianness is Explicit

When reading a 16-bit image from PDF:
- PDF standard specifies **big-endian** (ISO 32000)
- When using `ImageColorConverter` directly with user-provided images, the endianness specified (either "big" or "little") directly reflects the buffer's actual byte order

Both `PDFImageColorConverter` and `ImageColorConverter` must have explicit endianness that **directly reflects the buffer**.

### Specification 2: inputEndianness and outputEndianness

When an image is passed around across different layers:
- `inputEndianness` and `outputEndianness` default to the value of `endianness` unless otherwise specified
- The endianness describes the **actual byte order of the data buffer**
- PDF data is "big", user-provided data is whatever they specify

### Specification 3: FORMAT_LOOKUP Must Not Assume Hardwired Endianness

The FORMAT_LOOKUP table **must not assume** that:
- `TYPE_*_SE` (Swap Endian) maps to "little"
- `TYPE_*` (no SE) maps to "big" or "native"

This hardwiring is the source of the recurring bug.

### Specification 4: TYPE_*_SE Determination

The WASM runtime is **always little-endian**. The `TYPE_*_SE` flag indicates:

| Buffer Endianness | WASM Runtime | Needs Swap? | Use TYPE_*_SE? |
|-------------------|--------------|-------------|----------------|
| **Big-endian**    | Little       | YES         | **YES** (SE)   |
| **Little-endian** | Little       | NO          | **NO**         |

- `TYPE_*_SE` = "Swap Endian" = buffer is **big-endian**
- `TYPE_*` (no SE) = native = buffer is **little-endian** (same as WASM)

### Specification 5: "native" Should Not Be Used

WASM is **always little-endian**, regardless of JavaScript runtime detection:

```javascript
// This detection is IRRELEVANT for WASM:
const RUNTIME_ENDIANNESS = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1 ? 'little' : 'big';
```

For multi-byte data (16-bit, etc.), there are only two meaningful values:
- `'big'` - buffer is big-endian (e.g., PDF)
- `'little'` - buffer is little-endian (e.g., native typed arrays)

Canvas sources are 8-bit, so endianness is irrelevant.

### Specification 6: Multi-Byte Support Must Not Assume 16-Bit Only

The code must not hardwire assumptions that multi-byte data is always 16-bit. The architecture must support:
- 8-bit (single byte, endianness irrelevant)
- 16-bit (current use case)
- Future bit depths as needed

### Specification 7: Separate Input and Output Bits Per Component (Future)

A subsequent refactor will introduce:
- `inputBitsPerComponent` - bit depth of input buffer
- `outputBitsPerComponent` - bit depth of output buffer

These will default to `bitsPerComponent` when not specified, enabling:
- 16-bit input → 8-bit output (precision reduction)
- 8-bit input → 16-bit output (precision expansion)

The current refactor should prepare for this by:
1. Not assuming input and output have same bit depth
2. Using method names and logic that generalize to arbitrary bit depths

---

## Investigation Findings

### Finding 1: FORMAT_LOOKUP Hardwires a Relationship That Must Be Dynamic (ROOT CAUSE)

**File**: `classes/color-conversion-policy.js` lines 417-451

**Current code (HARDWIRED)**:
```javascript
const FORMAT_LOOKUP = {
    // ...
    'Gray:16:big:packed': TYPE_GRAY_16,       // Hardwired: cannot be static
    'Gray:16:little:packed': TYPE_GRAY_16_SE, // Hardwired: cannot be static
    // ...
};
```

**The Problem**: This static mapping assumes a particular relationship between buffer endianness strings and TYPE_* constants. But the correct TYPE_* constant depends on **runtime WASM endianness detection**, not a static table.

**The `#decodeFormat()` method** (lines 1099-1105) correctly decodes TYPE_* constants:
```javascript
if (bitsPerComponent === 16) {
    endianness = endian16 === 0 ? 'little' : 'big';
}
```
- `TYPE_*` (no SE flag, bit 11 = 0) → buffer is little-endian (native to WASM)
- `TYPE_*_SE` (SE flag set, bit 11 = 1) → buffer is big-endian (needs swap on WASM)

**Correct approach**: Remove multi-byte entries from FORMAT_LOOKUP entirely. Use dynamic selection via `#needsEndianSwap()`:
```javascript
const needsSwap = this.#needsEndianSwap(bufferEndianness);
return needsSwap ? TYPE_*_SE : TYPE_*;
```

### Finding 2: PDFImageColorConverter Misrepresents Buffer Endianness (Workaround)

**File**: `classes/pdf-image-color-converter.js` line 234

```javascript
// Endianness for color engine:
// PDF stores multi-byte values in big-endian format (ISO 32000).
// We pass 'little' to trigger TYPE_*_SE (swap-endian) which correctly
// handles big-endian buffer data on little-endian machines.
/** @type {import('./color-conversion-policy.js').Endianness} */
const endianness = bitsPerComponent === 16 ? 'little' : 'native';
```

**Analysis**: The code passes `'little'` for PDF data that is actually big-endian. This is a workaround for the hardwired FORMAT_LOOKUP. The conversion happens to produce correct results, but the **endianness parameter does not describe the actual buffer**.

The paradigm violation:
1. PDF buffer is big-endian (fact)
2. Code passes `'little'` (misrepresentation)
3. FORMAT_LOOKUP's hardwired mapping happens to select the right format
4. Result is correct, but the API contract is violated

**Same issue at line 542** (prepareWorkerTask):
```javascript
endianness: /** @type {import('./color-conversion-policy.js').Endianness} */ (input.bitsPerComponent === 16 ? 'little' : 'native'),
```

**Correct approach**: Pass `'big'` (the truth), and let dynamic format selection via `#needsEndianSwap()` handle it.

### Finding 3: Test Expectations Encode the Hardwired Assumption

**File**: `tests/classes/color-conversion-policy.test.js`

The test expectations in `FORMAT_SCENARIOS` (lines 55-299) encode the hardwired FORMAT_LOOKUP behavior:
- `endianness: 'big'` → `TYPE_*_16` (no SE flag)
- `endianness: 'little'` → `TYPE_*_16_SE` (with SE flag)

**Example (lines 67-79)**:
```javascript
{
    inputDescriptor: { colorSpace: 'Gray', bitsPerComponent: 16, endianness: 'big' },
    inputFormat: TYPE_GRAY_16,  // Encodes hardwired assumption
    description: 'Gray 16-bit big-endian → CMYK 16-bit big-endian',
},
```

**However**, lines 441-449 test `getFormatProperties()` with semantically correct expectations:
```javascript
test('getFormatProperties returns correct endianness', () => {
    // TYPE_*_SE (Swapped Endian) formats swap to big-endian for PDF compatibility
    assert.strictEqual(policy.getFormatProperties(TYPE_RGB_16).endianness, 'little');
    assert.strictEqual(policy.getFormatProperties(TYPE_RGB_16_SE).endianness, 'big');
    // ...
});
```

This confirms that `#decodeFormat()` correctly interprets TYPE_* constants. The tests for FORMAT_SCENARIOS need to be updated to expect dynamic behavior based on `#needsEndianSwap()` and WASM endianness.

### Finding 4: StreamTransformWorker Uses Downgrade Workaround (INFORMATIONAL ONLY)

> **⚠️ LEGACY CODE — DO NOT MODIFY**
>
> This finding is documented for context only. The `services/` directory contains legacy code that should not be touched as part of this refactor.

**File**: `services/StreamTransformWorker.js` lines 404-419

```javascript
/**
 * Convert 16-bit big-endian data to 8-bit by taking high byte
 * This matches PDFService baseline behavior which downgrades 16-bit to 8-bit
 * PDF stores 16-bit values in big-endian (high byte first)
 */
function convert16to8bit(data) {
    const numValues = data.length / 2;
    const result = new Uint8Array(numValues);
    for (let i = 0; i < numValues; i++) {
        // Take high byte (big-endian format)
        result[i] = data[i * 2];
    }
    return result;
}
```

This is a workaround that **loses precision** by converting 16-bit to 8-bit. It handles big-endian correctly by taking the high byte first. This code remains untouched; the `classes/` refactor addresses the root cause in the modern codebase.

### Finding 5: #buildFormat() Also Hardwires the Relationship

**File**: `classes/color-conversion-policy.js` lines 915-917

```javascript
if (bitsPerComponent === 16 && endianness === 'little') {
    format |= ENDIAN16_SH(1);
}
```

**Problem**: This hardwires SE flag selection based on the endianness string, mirroring FORMAT_LOOKUP's assumption. The SE flag should be set based on `#needsEndianSwap(bufferEndianness)`, not a static string comparison.

---

## Affected Files Summary

| File | Lines | Issue | Action |
|------|-------|-------|--------|
| `classes/color-conversion-policy.js` | 417-451 | FORMAT_LOOKUP hardwires multi-byte mappings | **FIX** |
| `classes/color-conversion-policy.js` | 915-917 | #buildFormat() hardwires SE flag logic | **FIX** |
| `classes/pdf-image-color-converter.js` | 234 | Misrepresents buffer endianness (`'little'` for big-endian) | **FIX** |
| `classes/pdf-image-color-converter.js` | 542 | Same issue in prepareWorkerTask | **FIX** |
| `tests/classes/color-conversion-policy.test.js` | 55-299 | FORMAT_SCENARIOS encode hardwired assumptions | **FIX** |
| `services/StreamTransformWorker.js` | 404-419 | 16-bit to 8-bit downgrade workaround | **NO CHANGE (legacy)** |

---

## Proposed Fix Strategy

### Phase 1: Centralize Endianness Detection in ColorEngineProvider

Add `RUNTIME_ENDIANNESS` and `WEB_ASSEMBLY_ENDIANNESS` constants to `ColorEngineProvider`. These are detected at module load time and exported for use by `ColorConversionPolicy`.

### Phase 2: Replace Hardwired FORMAT_LOOKUP with Dynamic Selection

1. **Remove 16-bit entries** from FORMAT_LOOKUP entirely (they cannot be static)
2. **Add `#get16BitFormat()` method** that compares `bufferEndianness !== WEB_ASSEMBLY_ENDIANNESS`
3. **Update `#buildFormat()`** to use the same dynamic logic

### Phase 3: Fix Callers to Describe Buffers Honestly

1. **Fix PDFImageColorConverter**:
   ```javascript
   // BEFORE (misrepresentation):
   const endianness = bitsPerComponent === 16 ? 'little' : 'native';

   // AFTER (truthful):
   const endianness = bitsPerComponent === 16 ? 'big' : 'native';
   ```

2. **Fix ImageColorConverter** if needed (check all endianness usages)

### Phase 4: Update Tests

1. **Update FORMAT_SCENARIOS** to expect dynamic behavior (depends on WASM endianness)
2. **Add explicit regression tests** for 16-bit big-endian PDF images

### Phase 5: Verify with Regression Tests

1. Run existing test suite
2. Test 16-bit PDF image conversion end-to-end
3. Compare output with baseline

---

## Architecture: Centralized Endianness Detection

### Requirement

Endianness detection logic must be **localized to `ColorEngineProvider`**. This class is responsible for:

1. Detecting runtime endianness at initialization
2. Exposing these constants for use by `ColorConversionPolicy`

### Endianness Detection (ColorEngineProvider)

```javascript
// JavaScript runtime endianness (host environment)
const RUNTIME_ENDIANNESS = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1 ? 'little' : 'big';

// WebAssembly memory endianness (WASM linear memory)
const WEB_ASSEMBLY_ENDIANNESS = (memory => (
    new Uint32Array(memory)[0] = 1,
    new Uint8Array(memory)[0] === 1 ? 'little' : 'big'
))(new WebAssembly.Memory({ initial: 1 }).buffer);
```

**Rationale**: Even though WASM is always little-endian in practice, the checks are still required:
- Documents the assumption explicitly in code
- Future-proofs against hypothetical big-endian WASM runtimes
- Makes the logic self-documenting and verifiable

### Format Selection Logic (ColorConversionPolicy)

`ColorConversionPolicy` uses a single predicate method `#needsEndianSwap()` as the source of truth:

```javascript
/**
 * Single source of truth for TYPE_*_SE selection.
 * Called by both #getMultiByteFormat() and #buildFormat().
 */
#needsEndianSwap(bufferEndianness) {
    return bufferEndianness !== this.#wasmEndianness;
}

// In #getMultiByteFormat():
const needsSwap = this.#needsEndianSwap(bufferEndianness);
return needsSwap ? TYPE_*_SE : TYPE_*;

// In #buildFormat():
if (this.#isMultiByte(bitsPerComponent)) {
    if (this.#needsEndianSwap(endianness)) {
        format |= ENDIAN16_SH(1);
    }
}
```

### Parameter Flow

```
User provides:
  └─ bitsPerComponent: 8 | 16 | ...  (current: shared for input/output)
  └─ endianness: 'big' | 'little' | 'native'  (describes actual buffer byte order)
      ├─ inputEndianness: defaults to endianness
      └─ outputEndianness: defaults to endianness

Future (input/output bit depth separation):
  └─ inputBitsPerComponent: defaults to bitsPerComponent
  └─ outputBitsPerComponent: defaults to bitsPerComponent

ColorConversionPolicy receives:
  └─ inputEndianness / outputEndianness (explicit buffer descriptions)
  └─ bitsPerComponent (or future: inputBitsPerComponent / outputBitsPerComponent)

ColorConversionPolicy initializes:
  └─ #wasmEndianness = ColorEngineProvider.WEB_ASSEMBLY_ENDIANNESS

ColorConversionPolicy determines (via #needsEndianSwap):
  └─ needsSwap = (bufferEndianness !== #wasmEndianness)
      └─ true  → TYPE_*_SE (swap bytes)
      └─ false → TYPE_*    (no swap)
```

---

## Technical Details: LittleCMS ENDIAN16 Flag

### How TYPE_* Constants Work

LittleCMS pixel format constants encode endianness in bit 11 (ENDIAN16_SH):

```
Bit 11 = 0: Native to WASM (little-endian) → no byte swap
Bit 11 = 1: Swapped from WASM → byte swap required
```

### Why Float Formats Have No SE Variants

The `ENDIAN16_SH` macro is **specifically designed for 16-bit integer data**. LittleCMS does not provide `TYPE_*_FLT_SE` variants because:

1. **Historical design**: LittleCMS was created when IEEE 754 floats had universal adoption
2. **Macro naming**: `ENDIAN16_SH` explicitly indicates 16-bit scope
3. **Practical concern**: Float endianness wasn't a cross-platform issue in color management

**Source**: `testing/iso/ptf/2025/packages/color-engine/src/constants.js`
- Line 16: `ENDIAN16_SH = (e) => ((e) << 11)` — 16-bit specific
- Lines 200-216: `TYPE_*_FLT` constants exist without any `_SE` variants

### Format Selection Truth Table

| Buffer Endianness | WASM Endianness | Needs Swap? | Use Format   |
|-------------------|-----------------|-------------|--------------|
| `'big'`           | `'little'`      | YES         | `TYPE_*_SE`  |
| `'little'`        | `'little'`      | NO          | `TYPE_*`     |
| `'big'`           | `'big'`         | NO          | `TYPE_*`     |
| `'little'`        | `'big'`         | YES         | `TYPE_*_SE`  |

*Note: Rows 3-4 are hypothetical (WASM is always little-endian in practice)*

### Decoding Examples

| Constant          | Hex Value | Bit 11 | Meaning                          |
|-------------------|-----------|--------|----------------------------------|
| `TYPE_RGB_16`     | `0x40019` | 0      | Native to WASM (little-endian)   |
| `TYPE_RGB_16_SE`  | `0x40819` | 1      | Swapped (big-endian buffer)      |
| `TYPE_CMYK_16`    | `0x60021` | 0      | Native to WASM (little-endian)   |
| `TYPE_CMYK_16_SE` | `0x60821` | 1      | Swapped (big-endian buffer)      |

### The Fix in Plain Terms

**Current (HARDWIRED)**: FORMAT_LOOKUP contains static entries for multi-byte formats, assuming a fixed relationship between endianness strings and TYPE_* constants.

**Correct (DYNAMIC)**: Remove multi-byte entries from FORMAT_LOOKUP. Use `#needsEndianSwap()` as the **single source of truth** to determine the correct TYPE_* constant at runtime:

```javascript
// Single source of truth for TYPE_*_SE selection
#needsEndianSwap(bufferEndianness) {
    return bufferEndianness !== this.#wasmEndianness;
}

// Called by both #getMultiByteFormat() and #buildFormat()
const needsSwap = this.#needsEndianSwap(bufferEndianness);
return needsSwap ? TYPE_*_SE : TYPE_*;
```

---

## Concrete Code Changes

### 1. Add Endianness Detection to ColorEngineProvider

**File**: `classes/color-engine-provider.js`

```javascript
// Add at module level (before class definition)

/**
 * JavaScript runtime endianness detection.
 * Tests how multi-byte integers are stored in ArrayBuffer.
 * @type {'little' | 'big'}
 */
const RUNTIME_ENDIANNESS = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1 ? 'little' : 'big';

/**
 * WebAssembly linear memory endianness detection.
 * Tests how multi-byte integers are stored in WASM memory.
 * @type {'little' | 'big'}
 */
const WEB_ASSEMBLY_ENDIANNESS = (memory => (
    new Uint32Array(memory)[0] = 1,
    new Uint8Array(memory)[0] === 1 ? 'little' : 'big'
))(new WebAssembly.Memory({ initial: 1 }).buffer);

// Export for use by ColorConversionPolicy
export { RUNTIME_ENDIANNESS, WEB_ASSEMBLY_ENDIANNESS };
```

**Also add static getters to the class**:

```javascript
export class ColorEngineProvider {
    /**
     * JavaScript runtime endianness.
     * @returns {'little' | 'big'}
     */
    static get RUNTIME_ENDIANNESS() {
        return RUNTIME_ENDIANNESS;
    }

    /**
     * WebAssembly memory endianness.
     * @returns {'little' | 'big'}
     */
    static get WEB_ASSEMBLY_ENDIANNESS() {
        return WEB_ASSEMBLY_ENDIANNESS;
    }

    // ... rest of class
}
```

### 2. Update ColorConversionPolicy Constructor and Add Predicate

**File**: `classes/color-conversion-policy.js`

```javascript
import { WEB_ASSEMBLY_ENDIANNESS } from './color-engine-provider.js';

export class ColorConversionPolicy {
    /** @type {'little' | 'big'} */
    #wasmEndianness;

    constructor(configuration = {}) {
        // ... existing code ...
        this.#wasmEndianness = WEB_ASSEMBLY_ENDIANNESS;
    }

    /**
     * Gets the WebAssembly memory endianness.
     * @returns {'little' | 'big'}
     */
    get wasmEndianness() {
        return this.#wasmEndianness;
    }

    /**
     * Determines if endian swap is needed for the given buffer endianness.
     *
     * This is the SINGLE SOURCE OF TRUTH for TYPE_*_SE selection.
     * Both #getMultiByteFormat() and #buildFormat() call this method.
     *
     * @param {'big' | 'little'} bufferEndianness - Actual endianness of the buffer
     * @returns {boolean} true if TYPE_*_SE should be used
     */
    #needsEndianSwap(bufferEndianness) {
        return bufferEndianness !== this.#wasmEndianness;
    }
```

### 3. Replace FORMAT_LOOKUP with Dynamic Selection for Multi-Byte

**File**: `classes/color-conversion-policy.js`

Remove the hardwired multi-byte entries from FORMAT_LOOKUP (they cannot be static):

```javascript
// BEFORE: Hardwired multi-byte entries (cannot be static)
const FORMAT_LOOKUP = {
    'Gray:16:big:packed': TYPE_GRAY_16,
    'Gray:16:little:packed': TYPE_GRAY_16_SE,
    // ...
};

// AFTER: Only single-byte formats (endianness irrelevant)
const FORMAT_LOOKUP = {
    // 8-bit formats (endianness irrelevant - single byte)
    'Gray:8:native:packed': TYPE_GRAY_8,
    'RGB:8:native:packed': TYPE_RGB_8,
    'CMYK:8:native:packed': TYPE_CMYK_8,
    'Lab:8:native:packed': TYPE_Lab_8,
    // ... other 8-bit variants ...

    // 32-bit float formats (if needed, handle separately or assume IEEE 754)
    'Gray:32:native:packed': TYPE_GRAY_FLT,
    'RGB:32:native:packed': TYPE_RGB_FLT,
    'CMYK:32:native:packed': TYPE_CMYK_FLT,
    'Lab:32:native:packed': TYPE_Lab_FLT,
};
```

Multi-byte integer formats are handled by `#getMultiByteFormat()` using dynamic endianness comparison.

### 4. Update #resolveFormat() to Use Dynamic Endianness Logic

**File**: `classes/color-conversion-policy.js`

```javascript
#resolveFormat(descriptor) {
    const { colorSpace, bitsPerComponent, endianness, layout = 'packed' } = descriptor;

    // For multi-byte integer formats, determine format dynamically based on WASM endianness
    if (this.#isMultiByte(bitsPerComponent)) {
        if (endianness === undefined || endianness === 'native') {
            throw new Error(`endianness must be 'big' or 'little' for ${bitsPerComponent}-bit data`);
        }
        return this.#getMultiByteFormat(colorSpace, bitsPerComponent, endianness, layout);
    }

    // For 8-bit and float formats, use lookup table (endianness irrelevant)
    // ... existing lookup logic ...
}

/**
 * Checks if the bit depth requires multi-byte handling.
 *
 * Supported multi-byte formats:
 * - 16-bit (Uint16) - has SE variants for endian swapping
 * - 32-bit (Float32) - no SE variants, IEEE 754 standard
 *
 * @param {number} bitsPerComponent
 * @returns {boolean} true if multi-byte format
 */
#isMultiByte(bitsPerComponent) {
    // Anything greater than 8 bits requires multiple bytes
    return bitsPerComponent > 8;
}

/**
 * Determines the correct multi-byte format based on buffer endianness.
 *
 * Uses #needsEndianSwap() as the single source of truth for SE flag selection.
 *
 * @param {ColorSpace} colorSpace
 * @param {number} bitsPerComponent - Bit depth (16 or 32)
 * @param {'big' | 'little'} bufferEndianness - Actual endianness of the buffer
 * @param {Layout} layout
 * @returns {number} TYPE_* constant
 */
#getMultiByteFormat(colorSpace, bitsPerComponent, bufferEndianness, layout) {
    if (layout !== 'packed') {
        throw new Error(`Only packed layout supported for ${bitsPerComponent}-bit formats`);
    }

    // Use single source of truth for SE flag decision
    const needsSwap = this.#needsEndianSwap(bufferEndianness);

    // Select format based on bit depth and color space
    switch (bitsPerComponent) {
        case 16:
            // Uint16 - has SE variants for endian swapping
            return this.#get16BitFormatConstant(colorSpace, needsSwap);
        case 32:
            // Float32 - no SE variants in LittleCMS, IEEE 754 standard
            return this.#get32BitFormatConstant(colorSpace);
        default:
            throw new Error(`Unsupported bit depth: ${bitsPerComponent}`);
    }
}

/**
 * Returns the TYPE_* constant for 32-bit float formats.
 *
 * LittleCMS does not provide SE (Swap Endian) variants for float formats.
 * This is an upstream design decision in LittleCMS:
 * - The endian flag is specifically `ENDIAN16_SH` (for 16-bit data only)
 * - IEEE 754 floats have standardized representation
 * - Float byte order was not considered a cross-platform concern
 *
 * See: testing/iso/ptf/2025/packages/color-engine/src/constants.js
 * - Lines 200-216: TYPE_*_FLT constants exist without SE variants
 * - Line 16: ENDIAN16_SH macro is specifically for 16-bit
 *
 * @param {ColorSpace} colorSpace
 * @returns {number} TYPE_* constant
 */
#get32BitFormatConstant(colorSpace) {
    switch (colorSpace) {
        case 'Gray':
            return TYPE_GRAY_FLT;
        case 'RGB':
            return TYPE_RGB_FLT;
        case 'CMYK':
            return TYPE_CMYK_FLT;
        case 'Lab':
            return TYPE_Lab_FLT;
        default:
            throw new Error(`Unsupported color space for 32-bit: ${colorSpace}`);
    }
}

/**
 * Returns the TYPE_* constant for 16-bit formats.
 *
 * @param {ColorSpace} colorSpace
 * @param {boolean} needsSwap - Whether to use SE variant
 * @returns {number} TYPE_* constant
 */
#get16BitFormatConstant(colorSpace, needsSwap) {
    switch (colorSpace) {
        case 'Gray':
            return needsSwap ? TYPE_GRAY_16_SE : TYPE_GRAY_16;
        case 'RGB':
            return needsSwap ? TYPE_RGB_16_SE : TYPE_RGB_16;
        case 'CMYK':
            return needsSwap ? TYPE_CMYK_16_SE : TYPE_CMYK_16;
        case 'Lab':
            return needsSwap ? TYPE_Lab_16_SE : TYPE_Lab_16;
        default:
            throw new Error(`Unsupported color space for 16-bit: ${colorSpace}`);
    }
}
```

### 5. Update #buildFormat() to Use #needsEndianSwap()

**File**: `classes/color-conversion-policy.js`

```javascript
#buildFormat(descriptor) {
    // ... existing code to build base format ...

    // For multi-byte integers, set SE flag based on #needsEndianSwap()
    if (this.#isMultiByte(bitsPerComponent)) {
        if (this.#needsEndianSwap(endianness)) {
            format |= ENDIAN16_SH(1);
        }
    }

    // ... rest of method ...
}
```

**Key point**: Both `#getMultiByteFormat()` and `#buildFormat()` call `#needsEndianSwap()`, making it the **single source of truth** for TYPE_*_SE selection.

### 6. Fix PDFImageColorConverter to Describe Buffer Honestly

**File**: `classes/pdf-image-color-converter.js`

```javascript
// BEFORE (misrepresents buffer endianness):
const endianness = bitsPerComponent === 16 ? 'little' : 'native';

// AFTER (describes actual buffer byte order):
// PDF multi-byte integer data is big-endian per ISO 32000
const endianness = bitsPerComponent > 8 ? 'big' : 'native';
```

Same fix at line 542 in `prepareWorkerTask()`. PDF multi-byte integer data is big-endian per ISO 32000.

**Note**: Using `bitsPerComponent > 8` instead of `=== 16` prepares for future bit depths.

### 7. Update Test Expectations

**File**: `tests/classes/color-conversion-policy.test.js`

The tests should verify that:
- `'big'` endianness → format with SE flag (when WASM is little-endian)
- `'little'` endianness → format without SE flag (when WASM is little-endian)

```javascript
// Example test update for 16-bit
{
    inputDescriptor: { colorSpace: 'Gray', bitsPerComponent: 16, endianness: 'big' },
    // With WASM being little-endian, big-endian buffer needs swap
    inputFormat: TYPE_GRAY_16_SE,  // Changed from TYPE_GRAY_16
    description: 'Gray 16-bit big-endian → CMYK 16-bit big-endian',
},
```

**Note**: Tests should be structured to accommodate future bit depths. Consider parameterizing tests by bit depth where applicable.

---

## Next Refactor: Input/Output Bits Per Component

### Overview

Introduce `inputBitsPerComponent` and `outputBitsPerComponent` parameters. The `bitsPerComponent` family follows standard fallback semantics, while `endianness` requirements are **conditional** on the resolved bit depth.

### Valid Parameter Combinations for `bitsPerComponent`

| Unprefixed   | Input Variant | Output Variant | Validity    | Behavior                                           |
|--------------|---------------|----------------|-------------|----------------------------------------------------|
| ✓ provided   | ✗ omitted     | ✗ omitted      | **Valid**   | Both input and output use unprefixed value         |
| ✓ provided   | ✓ provided    | ✗ omitted      | **Valid**   | Input uses prefixed, output uses unprefixed        |
| ✓ provided   | ✗ omitted     | ✓ provided     | **Valid**   | Input uses unprefixed, output uses prefixed        |
| ✓ provided   | ✓ provided    | ✓ provided     | **Valid**   | Both use their prefixed values (unprefixed ignored)|
| ✗ omitted    | ✓ provided    | ✓ provided     | **Valid**   | Both use their prefixed values                     |
| ✗ omitted    | ✓ provided    | ✗ omitted      | **Invalid** | Cannot determine output value                      |
| ✗ omitted    | ✗ omitted     | ✓ provided     | **Invalid** | Cannot determine input value                       |
| ✗ omitted    | ✗ omitted     | ✗ omitted      | **Invalid** | Cannot determine any value                         |

**Summary**: Either provide the unprefixed variant (as a default/fallback), or provide BOTH prefixed variants.

### Conditional Endianness Requirements

Endianness requirements depend on the **resolved bit depth** for each direction:

| Bit Depth | Endianness Behavior                                                    |
|-----------|------------------------------------------------------------------------|
| 8-bit     | Not required, silently ignored (single byte)                           |
| 16-bit    | **Required** — error if missing (determines TYPE_*_SE selection)       |
| 32-bit    | Not required, **warn if specified** (no TYPE_*_FLT_SE in LittleCMS)    |

**Validation flow:**

1. Resolve effective bit depths: `inputBits`, `outputBits`
2. For each direction with 16-bit: require endianness (error if missing)
3. For each direction with 32-bit: warn if endianness would apply (has no effect)

### API Examples

```javascript
// Valid: 16-bit both directions, shared endianness
{ bitsPerComponent: 16, endianness: 'big' }

// Valid: 16-bit input, 8-bit output — endianness only needed for input
{ inputBitsPerComponent: 16, outputBitsPerComponent: 8, inputEndianness: 'big' }

// Valid: 8-bit input, 16-bit output — endianness only needed for output
{ inputBitsPerComponent: 8, outputBitsPerComponent: 16, outputEndianness: 'big' }

// Valid: 8-bit both — no endianness needed
{ bitsPerComponent: 8 }

// Valid but WARNS: 16-bit input, 32-bit output with shared endianness
// The endianness applies to input (good) but also implies output (no effect → warn)
{ inputBitsPerComponent: 16, outputBitsPerComponent: 32, endianness: 'big' }
// → WARN: endianness has no effect on 32-bit float output (no TYPE_*_FLT_SE in LittleCMS)

// Correct way for 16-bit → 32-bit: only specify input endianness
{ inputBitsPerComponent: 16, outputBitsPerComponent: 32, inputEndianness: 'big' }

// INVALID: 16-bit without endianness
{ bitsPerComponent: 16 }  // Error: endianness required for 16-bit

// INVALID: missing output bit depth
{ inputBitsPerComponent: 16 }  // Error: cannot determine outputBitsPerComponent
```

### Architecture: Centralized Validation and Late Defaulting

#### Principle 1: Validation is Centralized

Validation of parameter combinations happens in **one place only** — the entry point class that first receives the configuration (e.g., `ColorConversionPolicy` or the top-level converter).

```javascript
// In ColorConversionPolicy or configuration validator
#validateConfiguration(configuration) {
    // Step 1: Validate bitsPerComponent parameters
    const hasUnprefixedBits = configuration.bitsPerComponent !== undefined;
    const hasInputBits = configuration.inputBitsPerComponent !== undefined;
    const hasOutputBits = configuration.outputBitsPerComponent !== undefined;

    if (!hasUnprefixedBits && (!hasInputBits || !hasOutputBits)) {
        throw new Error(
            'bitsPerComponent configuration invalid: provide either bitsPerComponent (for both), ' +
            'or both inputBitsPerComponent and outputBitsPerComponent'
        );
    }

    // Step 2: Resolve effective bit depths
    const inputBits = configuration.inputBitsPerComponent ?? configuration.bitsPerComponent;
    const outputBits = configuration.outputBitsPerComponent ?? configuration.bitsPerComponent;

    // Step 3: Validate endianness conditionally based on bit depth
    const inputEndianness = configuration.inputEndianness ?? configuration.endianness;
    const outputEndianness = configuration.outputEndianness ?? configuration.endianness;

    // 16-bit requires endianness (TYPE_*_SE selection)
    if (inputBits === 16 && inputEndianness === undefined) {
        throw new Error('inputEndianness (or endianness) required for 16-bit input');
    }
    if (outputBits === 16 && outputEndianness === undefined) {
        throw new Error('outputEndianness (or endianness) required for 16-bit output');
    }

    // 32-bit ignores endianness — warn if specified (no TYPE_*_FLT_SE in LittleCMS)
    if (inputBits === 32 && inputEndianness !== undefined) {
        console.warn('inputEndianness has no effect on 32-bit float input (no TYPE_*_FLT_SE in LittleCMS)');
    }
    if (outputBits === 32 && outputEndianness !== undefined) {
        console.warn('outputEndianness has no effect on 32-bit float output (no TYPE_*_FLT_SE in LittleCMS)');
    }

    // 8-bit: endianness silently ignored (single byte, no validation needed)
}
```

#### Principle 2: No Defaulting During Propagation

When parameters propagate through intermediate classes, they are passed **as-is** without applying defaults. This preserves the user's intent and avoids premature resolution.

```javascript
// WRONG: Defaulting during propagation
class IntermediateConverter {
    constructor(configuration) {
        // DON'T DO THIS - loses information about what was explicitly specified
        this.inputBitsPerComponent = configuration.inputBitsPerComponent ?? configuration.bitsPerComponent;
        this.outputBitsPerComponent = configuration.outputBitsPerComponent ?? configuration.bitsPerComponent;
    }
}

// CORRECT: Pass through without modification
class IntermediateConverter {
    constructor(configuration) {
        // Pass configuration through unchanged
        this.configuration = configuration;
    }

    deriveChildConfiguration() {
        // Pass through to child without defaulting
        return { ...this.configuration };
    }
}
```

#### Principle 3: Defaulting at Final Destination Only

Defaults are applied **only at the point of use** — when the value is actually needed for format selection or buffer creation.

```javascript
// In ColorConversionPolicy (final destination for format selection)
getInputFormat(descriptor) {
    // Default applied HERE, at point of use
    const bitsPerComponent = descriptor.inputBitsPerComponent ?? descriptor.bitsPerComponent;
    const endianness = descriptor.inputEndianness ?? descriptor.endianness;
    return this.#resolveFormat({ ...descriptor, bitsPerComponent, endianness });
}

getOutputFormat(descriptor) {
    // Default applied HERE, at point of use
    const bitsPerComponent = descriptor.outputBitsPerComponent ?? descriptor.bitsPerComponent;
    const endianness = descriptor.outputEndianness ?? descriptor.endianness;
    return this.#resolveFormat({ ...descriptor, bitsPerComponent, endianness });
}
```

### Parameter Flow Through Class Hierarchy

```
User Configuration:
  └─ bitsPerComponent?: number          (fallback for both)
  └─ inputBitsPerComponent?: number     (explicit input)
  └─ outputBitsPerComponent?: number    (explicit output)
  └─ endianness?: 'big' | 'little'      (fallback for both)
  └─ inputEndianness?: 'big' | 'little' (explicit input)
  └─ outputEndianness?: 'big' | 'little'(explicit output)

PDFDocumentColorConverter
  ├─ Validates parameter combinations (ONCE)
  └─ Passes configuration unchanged to children

PDFPageColorConverter
  └─ Passes configuration unchanged to children

PDFImageColorConverter / PDFContentStreamColorConverter
  └─ Passes configuration unchanged to ColorConversionPolicy

ColorConversionPolicy
  ├─ getInputFormat(): resolves inputBitsPerComponent ?? bitsPerComponent
  └─ getOutputFormat(): resolves outputBitsPerComponent ?? bitsPerComponent
```

### Endianness Parameter Semantics

The `endianness` parameter family uses the same fallback pattern as `bitsPerComponent`:

| Parameter          | Purpose                              |
|--------------------|--------------------------------------|
| `endianness`       | Fallback for both input and output   |
| `inputEndianness`  | Explicit endianness of input buffer  |
| `outputEndianness` | Explicit endianness of output buffer |

**However**, unlike `bitsPerComponent`, endianness requirements are **conditional on bit depth**:

| Resolved Bit Depth | Endianness Requirement                                    |
|--------------------|-----------------------------------------------------------|
| 8-bit              | Not required (silently ignored)                           |
| 16-bit             | Required — error if not resolvable                        |
| 32-bit             | Not required — warn if specified (no effect on Float32)   |

This means valid configurations include:

- 16-bit input, 8-bit output: only `inputEndianness` (or `endianness`) required
- 8-bit input, 16-bit output: only `outputEndianness` (or `endianness`) required
- 8-bit both: no endianness parameters needed
- 16-bit input, 32-bit output: `inputEndianness` required; warn if `endianness` or `outputEndianness` specified

### Design Decisions from Current Refactor

The completed endianness refactor prepared for this:

1. **`#isMultiByte(bitsPerComponent)`** — Returns `true` for any `bitsPerComponent > 8`; easily extended to handle separate input/output bit depths

2. **`#getMultiByteFormat(colorSpace, bitsPerComponent, endianness, layout)`** — Takes explicit parameters, can be called separately for input and output formats

3. **`#needsEndianSwap(bufferEndianness)`** — Single source of truth; will be called with resolved `inputEndianness` or `outputEndianness`

4. **Centralized WASM endianness** — `WEB_ASSEMBLY_ENDIANNESS` in `ColorEngineProvider` is the reference point

---

## Activity Log

### 2026-02-02

- Created progress document
- Documented user specifications
- Investigated FORMAT_LOOKUP - found hardwired 16-bit mappings (root cause)
- Investigated #decodeFormat() - confirmed logic correctly interprets TYPE_* constants
- Investigated PDFImageColorConverter - found workaround that misrepresents buffer endianness
- Investigated test file - found FORMAT_SCENARIOS encode the hardwired assumptions
- Investigated StreamTransformWorker - found 16-bit to 8-bit downgrade workaround (legacy)
- Documented proposed fix strategy
- Added technical details explaining LittleCMS ENDIAN16 flag
- Added concrete code change examples
- **Updated architecture**: Centralized endianness detection in `ColorEngineProvider`
  - `RUNTIME_ENDIANNESS`: JavaScript runtime endianness
  - `WEB_ASSEMBLY_ENDIANNESS`: WASM memory endianness (always little, but explicitly checked)
- **Updated fix strategy**: Dynamic format selection based on `bufferEndianness !== WEB_ASSEMBLY_ENDIANNESS`
- Removed hardwired FORMAT_LOOKUP entries for multi-byte; replaced with `#getMultiByteFormat()` method
- Created detailed implementation task list
- **Corrected framing**: Removed "inverted" language; the issue is hardwired mappings that should be dynamic, not a static table with wrong values
- Confirmed `classes/` has some dependencies on `services/` (type-only, deprecated compat, utilities)
- **Added `#needsEndianSwap()` predicate** as single source of truth for TYPE_*_SE selection
- **Generalized from 16-bit to multi-byte**: Renamed methods and updated logic to not assume 16-bit only
- **Added Specification 6 & 7**: Multi-byte support and future `inputBitsPerComponent` / `outputBitsPerComponent` preparation
- **Added future refactor section**: Documents how current design prepares for input/output bit depth separation
- **Marked StreamTransformWorker as INFORMATIONAL ONLY**: Legacy code not to be modified
- **Updated `#isMultiByte()`**: Changed from `=== 16` to `> 8` — anything greater than 8 bits is multi-byte
- **Added `#get32BitFormatConstant()`**: Handles Float32 formats (no SE variants, IEEE 754 standard)
- **Supported bit depths**: 8 (Uint8), 16 (Uint16 with SE variants), 32 (Float32, no SE variants)
- **Documented why Float32 lacks SE variants**: Upstream LittleCMS design — `ENDIAN16_SH` is specifically for 16-bit; IEEE 754 floats assumed standardized

### 2026-02-02 (Phase 1 Implementation Complete)

**Task 7 - Test Expectations Updated**:

- Updated FORMAT_SCENARIOS in `color-conversion-policy.test.js` to expect correct format constants
- Big-endian (PDF) → `TYPE_*_SE` (swap needed on little-endian WASM)
- Little-endian → `TYPE_*` (no swap needed)
- Added missing _SE constant imports: `TYPE_Lab_16_SE`, `TYPE_GRAYA_16_SE`, `TYPE_BGR_16_SE`, `TYPE_RGBA_16_SE`, `TYPE_KYMC_16_SE`
- Defined new _SE constants in `color-conversion-policy.js` for formats without pre-existing SE variants

**Task 8 - Regression Testing Passed**:

- All 74 ColorConversionPolicy tests pass
- Full test suite: 264 tests pass, 51 skipped, 0 failures
- Key fixes during testing:
  - Float32 formats now bypass endianness requirement (no SE variants)
  - Unsupported bit depths (e.g., 12-bit) get proper error message
  - `getStandardFormat()` returns _SE for 16-bit (default endianness is 'big' for PDF standard)

**Files Modified**:

- `classes/color-conversion-policy.js`: Added 4 new _SE constants, updated `#get16BitFormatConstant()` to use named constants, added bit depth validation before endianness check
- `tests/classes/color-conversion-policy.test.js`: Added 5 new _SE imports, updated all FORMAT_SCENARIOS for correct expectations

### 2026-02-02 (Phase 2 Implementation Complete)

**Phase 2 - Input/Output Bits Per Component**:

**Type Definition Updates** (`classes/color-conversion-policy.js`):

- Extended `PixelFormatDescriptor` typedef with:
  - `inputBitsPerComponent?: BitDepth` — explicit bit depth for input (overrides bitsPerComponent)
  - `outputBitsPerComponent?: BitDepth` — explicit bit depth for output (overrides bitsPerComponent)
  - `inputEndianness?: Endianness` — explicit endianness for input (overrides endianness)
  - `outputEndianness?: Endianness` — explicit endianness for output (overrides endianness)
- Added JSDoc documentation explaining fallback semantics and conditional endianness validation

**Resolver Methods Added**:

- `#resolveInputDescriptor(descriptor)` — resolves `inputBitsPerComponent ?? bitsPerComponent` and `inputEndianness ?? endianness`
- `#resolveOutputDescriptor(descriptor)` — resolves `outputBitsPerComponent ?? bitsPerComponent` and `outputEndianness ?? endianness`
- `getInputFormat(descriptor)` — uses `#resolveInputDescriptor()` before format lookup
- `getOutputFormat(descriptor)` — uses `#resolveOutputDescriptor()` before format lookup

**Conditional Endianness Validation** (per bit depth):

- **8-bit**: Endianness silently ignored (single byte, no multi-byte handling needed)
- **16-bit**: Endianness required — throws error if not resolvable
- **32-bit**: Endianness has no effect — warns if specified (no TYPE_*_FLT_SE in LittleCMS)

**Test Coverage Added** (`tests/classes/color-conversion-policy.test.js`):

- Added 20 new tests in "input/output parameter resolution" describe block:
  - `bitsPerComponent resolution`: 5 tests for input/output bit depth fallback
  - `endianness resolution`: 3 tests for input/output endianness fallback
  - `conditional endianness validation`: 8 tests for 8-bit (ignored), 16-bit (error), 32-bit (warn)
  - `mixed bit depth scenarios`: 4 tests for asymmetric input/output bit depths

**Propagation Update** (`classes/color-converter.js`):

- Updated `convertColorsBuffer()` method to accept and pass through new parameters:
  - Added `inputBitsPerComponent` and `outputBitsPerComponent` options
  - Removed manual endianness resolution — now passes all parameters to policy for late defaulting
  - Updated JSDoc with comprehensive documentation of parameter semantics
- Principle: Late defaulting — parameters are passed unchanged to policy, which resolves fallbacks at point of use

**Comprehensive Propagation Audit** (2026-02-02):

Initial audit was INCOMPLETE. Full propagation required updating ALL these files:

| File | Updates |
|------|---------|
| `ColorConversionPolicy` | ✅ Already had parameters (Phase 2) |
| `ColorConverter.convertColorsBuffer()` | ✅ Already had parameters (Phase 2) |
| `ImageColorConverterInput` typedef | ❌→✅ Added all 6 parameters |
| `ImageColorConverter.convertColor()` | ❌→✅ Extract and pass through all parameters |
| `ImageColorConverter.prepareWorkerTask()` | ❌→✅ Include all parameters in task |
| `PDFImageColorConverterInput` typedef | ❌→✅ Added all 6 parameters |
| `PDFImageColorConverter.convertPDFImageColor()` | ❌→✅ Extract and pass through all parameters |
| `PDFImageColorConverter.prepareWorkerTask()` | ❌→✅ Include all parameters in task |
| `ImageTask` typedef (worker-pool.js) | ❌→✅ Added all 6 parameters |
| `worker-pool-entrypoint.js processImage()` | ❌→✅ Pass all parameters to converter |

**Parameters added to all applicable classes:**

- `inputBitsPerComponent?: BitDepth`
- `outputBitsPerComponent?: BitDepth`
- `inputEndianness?: Endianness`
- `outputEndianness?: Endianness`

**Key changes:**

- Removed manual endianness validation from `ImageColorConverter.convertColor()` — now uses late defaulting via policy
- PDF default for `inputEndianness` is `'big'` for >8-bit data (ISO 32000)
- All parameters pass through unchanged to `ColorConverter.convertColorsBuffer()` which passes to policy

**Full test suite**: 284 tests pass, 51 skipped, 0 failures

### 2026-02-02 (Phase 3 - PDFImageColorSampler)

**Purpose**: Enable Float32 Lab output for high-precision Delta-E computation in analysis workflows.

**Problem being solved**: The `compare-pdf-outputs.js` CLI was using a workaround:
1. Convert to Lab 8-bit (TYPE_Lab_8)
2. Manually convert Lab 8-bit to Float32 via `convertLab8ToFloat()`

This loses precision because Lab 8-bit quantizes L to 255 levels and a/b to 255 levels.

**Solution**: `PDFImageColorSampler` outputs Lab Float32 directly using TYPE_Lab_FLT.

**Files Created**:

| File | Purpose |
|------|---------|
| `classes/pdf-image-color-sampler.js` | Extends PDFImageColorConverter for analysis use cases |
| `classes/PDFImageColorSampler.md` | Comprehensive documentation for other agent integration |

**Key Design Decisions**:

1. **Analysis-only class**: Cannot produce PDF-compatible output (Float32 has no big-endian support in LittleCMS)
2. **Enforced Lab configuration**: Constructor validates `destinationProfile='Lab'` and `destinationColorSpace='Lab'`
3. **Blocked PDF output methods**: `convertColor()` and `convertPDFImageColor()` throw descriptive errors
4. **`samplePixels()` method**: Takes pixel indices from ImageSampler, returns Float32Array Lab values
5. **`extractAllPixels()` method**: Convenience for full image (use samplePixels() for large images)
6. **Static `convertLab8ToFloat()`**: Legacy compatibility for existing 8-bit Lab data

**Why Float32 Cannot Be Written to PDF**:

1. PDF specification (ISO 32000) requires multi-byte integers in big-endian format
2. LittleCMS TYPE_Lab_FLT outputs little-endian Float32 (WASM is little-endian)
3. No TYPE_Lab_FLT_SE exists in LittleCMS (Float32 has no endian swap variant)
4. Manual byte swapping would corrupt IEEE 754 floating-point representation

**Integration with compare-pdf-outputs.js**:

Before (workaround with precision loss):
```javascript
const result = await labConverter.convertColorsBuffer(refSampledBuffer, {
    outputColorSpace: 'Lab',
    bitsPerComponent: 8, // Limited to 8-bit Lab
});
refLab = convertLab8ToFloat(result.outputPixels); // Manual conversion
```

After (direct Float32 output):
```javascript
const result = await labSampler.samplePixels({
    streamData: refImage.pixelData,
    colorSpace: 'CMYK',
    bitsPerComponent: 8,
    sourceProfile: refProfile,
    pixelIndices: sampling.indices,
    // ... other fields
});
refLab = result.labValues; // Float32Array with full precision
```

**Documentation Contents** (`PDFImageColorSampler.md`):

- Overview with comparison table vs PDFImageColorConverter
- Quick start code example
- Complete API reference with all parameters
- Integration guide for compare-pdf-outputs.js
- ICC profile source guidance (ICCBased, Output Intent, Lab)
- Color space mapping
- Error handling examples
- Performance considerations
- Lab Float32 value ranges
- Technical background on endianness limitations
- Complete example with Delta-E computation

**PDFImageColorConverter Validation Added**:

1. **Float32 output throws error**: When `outputBitsPerComponent` (or `bitsPerComponent`) is 32, throws error explaining that Float32 cannot be written to PDF (no TYPE_*_FLT_SE in LittleCMS). Directs users to `PDFImageColorSampler` for analysis workflows.

2. **Contradictory endianness warning**: When `bitsPerComponent > 8` and `inputEndianness` or `endianness` is not 'big', logs warning that this contradicts ISO 32000 (PDF specification requires big-endian for multi-byte integer data).

**Test Suite**: 94 tests pass in ColorConversionPolicy, 284 tests pass in full suite.
