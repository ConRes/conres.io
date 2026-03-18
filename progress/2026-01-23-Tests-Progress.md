# 2026-01-23 - Test Suite Vetting and Refactoring

## Roadmap

### Phase 1: Test Audit (Complete)

- [x] Read all test files to understand what they're testing
- [x] Categorize tests by what they actually verify
- [x] Document what each test claims vs what it actually tests
- [x] Identify tests that provide zero regression protection
- [x] Identify tests that could be converted to meaningful tests

### Phase 2: Test Classification and Recommendations (Complete)

- [x] Classify tests: REMOVE, REPLACE, KEEP, ADD
- [x] Define what real integration tests should verify
- [x] Define fixture requirements (real PDFs, real profiles)
- [x] Create test plan for actual color conversion verification
- [x] Mark tests for removal with `skip: !!'<REASON>'`
- [x] Create snapshots folder structure for regression data

### Phase 3: Test Implementation

- [ ] Create shared real fixture loading utilities
- [ ] Implement actual color conversion tests using Color Engine
- [ ] Implement PDF comparison tests using compare-pdf-color.js
- [ ] Add regression tests for bugs fixed in 2026-01-23-PROGRESS.md

## Current Status

**Focus**: Phase 2 complete - Tests marked for removal, snapshots folder created

**Last Updated**: 2026-01-23T22:00:00Z

## Test Audit Results

### Summary: Current Test Suite is Non-Functional for Regression Detection

| Test File | Tests | What They Claim | What They Actually Test | Regression Value |
| --------- | ----- | --------------- | ----------------------- | ---------------- |
| ColorConverter.test.js | 8 | Base class functionality | Object shape, config frozen, hooks called | NONE |
| ImageColorConverter.test.js | 7 | Pixel buffer color conversion | Object shape, mock conversion hooks | NONE |
| LookupTableColorConverter.test.js | 8 | Lookup table caching | Cache hit/miss counts with mock converter | LOW |
| PDFContentStreamColorConverter.test.js | 8 | Content stream parsing | Parsing only, mock color conversion | LOW |
| PDFImageColorConverter.test.js | 7 | PDF image XObject conversion | Object shape, mock conversion | NONE |
| PDFPageColorConverter.test.js | 9 | Page-level conversion | Config derivation, mock conversion | NONE |
| PDFDocumentColorConverter.test.js | 12 | Document-level orchestration | Config derivation, mock conversion | NONE |
| ProfilePool.test.js | 8 | ICC profile caching | Profile hashing, reference counting | LOW |
| BufferRegistry.test.js | 9 | SharedArrayBuffer mapping | Buffer copying, stats tracking | LOW |
| ColorConverterClasses.test.js | 20 | End-to-end integration | Count comparisons only, no color verification | LOW |

**Total: 96 tests, 0 verify actual color conversion correctness**

### Detailed Analysis by Test File

#### 1. ColorConverter.test.js (8 tests)

**What it claims**: "Tests for the abstract base class implementing Template Method pattern"

**What each test actually does**:

| Test Name | Sanity Check | Regression Value |
| --------- | ------------ | ---------------- |
| configuration is frozen at construction | `Object.isFrozen(config) === true` | NONE - doesn't verify config correctness |
| establishes parent-child relationship | `child.parentConverter === parent` | NONE - object wiring only |
| per-reference configuration overrides | Override map get/set/delete works | NONE - data structure test |
| template method lifecycle hooks | Mocked hooks called in order | NONE - uses mock that returns `{result: input.value * 2}` |
| abstract method throws when not overridden | Throws error string match | NONE - error handling only |
| reference normalization for different types | Map key normalization | NONE - data structure test |
| worker mode defaults | `supportsWorkerMode === false` | NONE - constant check |
| dispose cleans up state | `parentConverter === null` | NONE - cleanup mechanics |

**Problem**: All tests use `new ArrayBuffer(100)` as mock profile. No actual ICC profile, no color engine.

#### 2. ImageColorConverter.test.js (7 tests)

**What it claims**: "Tests for pixel buffer color conversion"

**What each test actually does**:

| Test Name | Sanity Check | Regression Value |
| --------- | ------------ | ---------------- |
| extends ColorConverter properly | `instanceof ImageColorConverter && instanceof ColorConverter` | NONE |
| Lab intent falls back to relative-colorimetric | `getEffectiveRenderingIntent('Lab') === 'relative-colorimetric'` | LOW - logic test only |
| supports worker mode | `supportsWorkerMode === true` | NONE - constant check |
| hooks are called in correct order | Mock doConvertColor returns hardcoded result | NONE |
| configuration getter returns correct type | Config property access | NONE |
| dispose cleans up resources | No exception thrown | NONE |
| constants are exported correctly | `PIXEL_FORMATS.TYPE_RGB_8 === number` | NONE |

**Problem**: `createMockPixelBuffer()` creates synthetic data. `doConvertColor` override returns hardcoded `{pixelBuffer: new Uint8Array(100)}`. No actual pixel conversion.

**Critical Gap**: This is the class that had the **16-bit big-endian bug** and **Gray multiprofile bug** - neither is tested.

#### 3. LookupTableColorConverter.test.js (8 tests)

**What it claims**: "Tests for lookup table color conversion caching"

**What each test actually does**:

| Test Name | Sanity Check | Regression Value |
| --------- | ------------ | ---------------- |
| extends ColorConverter properly | instanceof check | NONE |
| lookup table caching behavior | Cache hit/miss counts with mock `convertSingleColor` returning `[0.1, 0.2, 0.3, 0.4]` | LOW |
| batch conversion with caching | Batch call counts with mock returning `[0.1, 0.2, 0.3, 0.4]` | LOW |
| cache threshold behavior | Threshold triggering logic | LOW |
| clear lookup table | Stats reset to 0 | NONE |
| populate lookup table | Pre-populated values retrievable | LOW |
| hooks are called in correct order | Hook call sequence | NONE |
| abstract method throws | Error message match | NONE |

**Problem**: All conversions return hardcoded `[0.1, 0.2, 0.3, 0.4]` regardless of input. Cache mechanics work, but actual color conversion is never tested.

#### 4. PDFContentStreamColorConverter.test.js (8 tests)

**What it claims**: "Tests for PDF content stream color conversion"

**What each test actually does**:

| Test Name | Sanity Check | Regression Value |
| --------- | ------------ | ---------------- |
| extends LookupTableColorConverter properly | instanceof check | NONE |
| parses content stream color operations | `parseContentStream()` extracts operators and values | MEDIUM - parsing logic |
| rebuilds content stream with converted values | `rebuildContentStream()` with hardcoded CMYK values | LOW |
| hooks are called in correct order | Hook call sequence with mock doConvertColor | NONE |
| prepares worker tasks correctly | Task object shape | NONE |
| supports worker mode | Boolean check | NONE |
| parses decimals starting with dot | `.95` parsed as `0.95` | LOW |
| dispose cleans up resources | No exception | NONE |

**What's actually valuable**: `parseContentStream()` tests verify PDF operator parsing correctly.

**Critical Gap**: No test verifies that RGB values like `1 0 0 rg` convert to correct CMYK values. The rebuild test uses hardcoded `[0.1, 0.9, 0.8, 0.0]` - no actual color engine involved.

**Bug that would be caught**: None of the bugs from 2026-01-23-PROGRESS.md (Lab intent, RGB output format, number formatting).

#### 5. PDFImageColorConverter.test.js (7 tests)

**What it claims**: "Tests for PDF image XObject color conversion"

**What each test actually does**:

| Test Name | Sanity Check | Regression Value |
| --------- | ------------ | ---------------- |
| extends ImageColorConverter properly | instanceof check | NONE |
| Lab images use relative-colorimetric intent | `getEffectiveRenderingIntent('Lab')` | LOW |
| hooks are called in correct order | Mock doConvertColor returns hardcoded result | NONE |
| prepares worker tasks correctly | Task object shape | NONE |
| configuration includes compressOutput | Config property check | NONE |
| dispose cleans up resources | No exception | NONE |
| supports worker mode | Boolean check | NONE |

**Critical Gap**: This class handles the **16-bit big-endian image data** - no test for this.

#### 6. PDFPageColorConverter.test.js (9 tests)

**What it claims**: "Tests for page-level color conversion coordination"

**What each test actually does**:

| Test Name | Sanity Check | Regression Value |
| --------- | ------------ | ---------------- |
| extends ColorConverter properly | instanceof check | NONE |
| derives image configuration correctly | Config inheritance | LOW |
| derives content stream configuration correctly | Config inheritance | LOW |
| per-reference configuration overrides work | Override propagation | LOW |
| hooks are called in correct order | Mock doConvertColor returns `{pageRef, imagesConverted: 0}` | NONE |
| supports worker mode | Boolean check | NONE |
| standalone page converter creates own worker pool | Pool creation | LOW |
| page converter uses shared worker pool | Pool sharing | LOW |
| dispose cleans up resources | No exception | NONE |

**Problem**: `doConvertColor` override returns mock result. No actual page conversion occurs.

#### 7. PDFDocumentColorConverter.test.js (12 tests)

**What it claims**: "Tests for document-level color conversion orchestration"

**What each test actually does**:

| Test Name | Sanity Check | Regression Value |
| --------- | ------------ | ---------------- |
| extends ColorConverter properly | instanceof + profilePool/bufferRegistry exist | NONE |
| integrates with ProfilePool | Shared pool reference | LOW |
| owns BufferRegistry | Registry exists | NONE |
| derives page configuration correctly | Config inheritance | LOW |
| page overrides Map works correctly | Map-based override | LOW |
| derives image configuration through document | Config chain | LOW |
| per-image override propagation works | Override chain | LOW |
| hooks are called in correct order | Mock doConvertColor | NONE |
| supports worker mode | Boolean check | NONE |
| worker pool ownership works correctly | Pool termination tracking | LOW |
| dispose cleans up all owned resources | No exception | NONE |
| prepares worker tasks correctly | Task object shape | NONE |

**Problem**: Uses `createMockPDFDocument()` with empty pages. No actual PDF processing.

#### 8. ProfilePool.test.js (8 tests)

**What it claims**: "Tests for ICC profile SharedArrayBuffer management"

**What each test actually does**:

| Test Name | Sanity Check | Regression Value |
| --------- | ------------ | ---------------- |
| loads and caches profiles | Buffer content preserved | LOW |
| manages reference counting | Count tracking | LOW |
| LRU eviction when limits exceeded | Eviction triggering | LOW |
| deduplicates concurrent loads | Same buffer returned | LOW |
| FNV-1a hashing produces consistent keys | Hash deduplication | LOW |
| SharedArrayBuffer feature detection | Boolean availability | NONE |
| dispose clears all state | Stats reset | NONE |
| stats getter returns expected shape | Object shape | NONE |

**What's actually valuable**: These tests verify cache mechanics work. They don't depend on color conversion.

#### 9. BufferRegistry.test.js (9 tests)

**What it claims**: "Tests for pdf-lib stream to SharedArrayBuffer mapping"

**What each test actually does**:

| Test Name | Sanity Check | Regression Value |
| --------- | ------------ | ---------------- |
| gets shared view for stream | View content matches original | LOW |
| caches shared views | Same buffer returned | LOW |
| creates shared buffer from raw data | Content preserved | LOW |
| bulk registers streams | Map size correct | LOW |
| applies converted data back to stream | Contents replaced | LOW |
| SharedArrayBuffer feature detection | Boolean | NONE |
| dispose clears tracking state | Stats reset | NONE |
| stats getter returns expected shape | Object shape | NONE |
| hasMapping returns correct values | Boolean correctness | LOW |

**What's actually valuable**: Buffer management mechanics work. No color conversion dependency.

#### 10. ColorConverterClasses.test.js (20 tests)

**What it claims**: "End-to-end tests for the color converter class hierarchy. Tests full document conversion with real PDF fixtures."

**Node.js tests (13 tests)** - All use mock profiles and mock PDFs:

| Test Name | Sanity Check | Regression Value |
| --------- | ------------ | ---------------- |
| full class hierarchy inheritance chain | instanceof checks | NONE |
| configuration derivation chain | Config inheritance | LOW |
| per-page rendering intent overrides | Override propagation | LOW |
| per-image rendering intent overrides | Override propagation | LOW |
| memory cleanup with ProfilePool and BufferRegistry | Pool/registry existence | NONE |
| shared ProfilePool between converters | Same pool reference | LOW |
| document conversion hook order | Hook call sequence | NONE |
| worker mode support flags | Boolean checks | NONE |
| Lab image handling uses relative-colorimetric | `getEffectiveRenderingIntent('Lab')` | LOW |
| dispose is idempotent | No exception on triple dispose | NONE |
| content stream applyWorkerResult | Context populated | LOW |
| page applyWorkerResult | Context populated | LOW |
| document applyWorkerResult | Context populated | LOW |

**Browser tests (7 tests)** - Use real PDFs but only compare counts:

| Test Name | Sanity Check | Regression Value |
| --------- | ------------ | ---------------- |
| PDF and ICC profile fixtures are accessible | fetch().ok | NONE - availability only |
| RGB PDF to CMYK conversion (content streams only) | `pagesProcessed > 0`, `contentStreamsConverted > 0` | LOW |
| K-Only GCR rendering intent conversion | Count > 0 | LOW |
| full document conversion with images and content streams | Count comparison | LOW |
| Interlaken Map PDF conversion (large image) | Count comparison | LOW (skipped by default) |
| (legacy) PDFService.convertColorInPDFDocument baseline | Count > 0 | LOW |
| (legacy) class hierarchy has no direct legacy equivalent | assert.ok(true) | NONE |

**Critical Problem with Browser Tests**:

The tests explicitly acknowledge: *"The metrics count DIFFERENT things and are NOT directly comparable: legacy.totalContentStreamConversions: Number of color OPERATIONS found in content streams / new.contentStreamsConverted: Number of content STREAM OBJECTS processed"*

This means:
- Legacy finds 12,914 individual color operations
- New processes 11 content stream objects
- Test considers this "passing" because both are > 0

**What's NOT tested**:
1. Actual color values in output PDF
2. Pixel-level comparison of converted images
3. Whether RGB `1 0 0` converts to correct CMYK values
4. Whether the bugs fixed in 2026-01-23-PROGRESS.md would be caught

## Critical Bugs NOT Covered by Tests

These bugs were identified and fixed in the 2026-01-23-PROGRESS.md debugging session:

| Bug | File | Line(s) | Would Tests Catch It? |
| --- | ---- | ------- | --------------------- |
| 16-bit big-endian image data | pdf-image-color-converter.js | 345-356 | NO |
| Gray to CMYK with K-Only GCR requires multiprofile | image-color-converter.js | #transformPixels | NO |
| Lab colors produce K=1 with K-Only GCR | pdf-content-stream-color-converter.js | | NO |
| K-Only GCR doesn't work for RGB destination | pdf-content-stream-color-converter.js | 427-435 | NO |
| RGB output values 0-255 instead of 0-1 | pdf-content-stream-color-converter.js | 678-691 | NO |
| Number formatting (6 decimals, strip trailing zeros) | pdf-content-stream-color-converter.js | | NO |
| Output intent missing | PDFService.js | | NO |

## Recommendations

### Tests to REMOVE (Provide Zero Value)

1. All "extends X properly" instanceof tests
2. All "supports worker mode" boolean checks
3. All "dispose cleans up resources" tests (just verify no exception)
4. All "configuration getter returns correct type" tests
5. All "(legacy) no legacy equivalent exists" placeholder tests
6. "abstract method throws when not overridden" tests

**Estimated removal: ~30 tests**

### Tests to KEEP (Have Some Value)

1. `PDFContentStreamColorConverter` parsing tests - verify PDF operator parsing
2. `ProfilePool` caching mechanics tests - verify cache logic
3. `BufferRegistry` buffer management tests - verify buffer handling
4. `LookupTableColorConverter` cache threshold tests - verify cache logic

**These should be enhanced to use real fixtures where possible**

### Tests to ADD (Critical for Regression Detection)

#### 1. Color Conversion Correctness Tests

```javascript
// Example: Verify RGB to CMYK conversion produces correct values
test('RGB red converts to correct CMYK', async () => {
    const converter = new PDFContentStreamColorConverter({
        destinationProfile: await loadRealProfile('eciCMYK v2.icc'),
        // ...
    });

    const result = await converter.convertSingleColor({
        colorSpace: 'RGB',
        values: [1, 0, 0], // Pure red
    }, {});

    // Expected CMYK values from known-good conversion
    assert.closeTo(result.values[0], 0.0, 0.01);  // C
    assert.closeTo(result.values[1], 0.88, 0.02); // M
    assert.closeTo(result.values[2], 0.85, 0.02); // Y
    assert.closeTo(result.values[3], 0.0, 0.01);  // K
});
```

#### 2. Legacy vs Refactored Comparison Tests

```javascript
// Example: Use compare-pdf-color.js to verify output PDF matches legacy
test('refactored output matches legacy for F-01 fixture', async () => {
    const inputPDF = 'fixtures/pdfs/F-01.pdf';
    const profile = 'fixtures/profiles/eciCMYK v2.icc';

    // Generate legacy output
    const legacyPDF = await convertWithLegacy(inputPDF, profile);

    // Generate refactored output
    const refactoredPDF = await convertWithRefactored(inputPDF, profile);

    // Compare using compare-pdf-color.js criteria
    const comparison = await comparePDFs(legacyPDF, refactoredPDF);

    // Content streams should match
    assert.strictEqual(comparison.contentStreams.status, 'MATCH');

    // Images should match (within tolerance for 16-bit rounding)
    for (const image of comparison.images) {
        assert.ok(image.maxDiff <= 20, `Image ${image.name} max diff ${image.maxDiff} > 20`);
    }
});
```

#### 3. Bug Regression Tests

For each bug fixed in 2026-01-23-PROGRESS.md, add a specific test:

```javascript
// Example: Test 16-bit big-endian handling
test('16-bit image data is read as big-endian', async () => {
    const pdfBytes = await loadPDF('fixtures/pdfs/F-01.pdf');
    const converter = new PDFImageColorConverter({...});

    // Im0 in F-01 is 16-bit sRGB
    const im0Data = extractImageData(pdfBytes, 'Im0');

    // First pixel should be interpreted as big-endian
    // Big-endian: [0xAB, 0xCD] = 0xABCD
    // Little-endian (wrong): [0xAB, 0xCD] = 0xCDAB
    const result = await converter.convertColor({
        streamData: im0Data,
        bitsPerComponent: 16,
        colorSpace: 'RGB',
        // ...
    }, {});

    // Verify output matches expected values (not corrupted by endianness)
    // ...
});
```

```javascript
// Example: Test Lab colors don't use K-Only GCR
test('Lab colors use Relative Colorimetric not K-Only GCR', async () => {
    const converter = new PDFContentStreamColorConverter({
        renderingIntent: 'preserve-k-only-relative-colorimetric-gcr',
        destinationProfile: await loadRealProfile('eciCMYK v2.icc'),
        // ...
    });

    // Lab color that would produce K=1 (black) if K-Only GCR used incorrectly
    const result = await converter.convertSingleColor({
        colorSpace: 'Lab',
        values: [50, 0, 0], // Mid-gray in Lab
    }, {});

    // Should NOT be K=1 (that's the bug)
    assert.ok(result.values[3] < 0.5, 'Lab gray should not produce K=1');
});
```

```javascript
// Example: Test Gray to CMYK with K-Only GCR uses multiprofile
test('Gray to CMYK K-Only GCR produces correct K values', async () => {
    const converter = new ImageColorConverter({
        renderingIntent: 'preserve-k-only-relative-colorimetric-gcr',
        destinationProfile: await loadRealProfile('eciCMYK v2.icc'),
        destinationColorSpace: 'CMYK',
        inputType: 'Gray',
        sourceProfile: await loadRealProfile('sGray.icc'),
    });

    // 50% gray should produce K-only output
    const result = await converter.convertColor({
        pixelBuffer: new Uint8Array([128]), // 50% gray
        width: 1,
        height: 1,
    }, {});

    // Should have K value close to 0.5, CMY close to 0
    assert.closeTo(result.pixelBuffer[0], 0, 5);   // C
    assert.closeTo(result.pixelBuffer[1], 0, 5);   // M
    assert.closeTo(result.pixelBuffer[2], 0, 5);   // Y
    assert.closeTo(result.pixelBuffer[3], 128, 10); // K (50%)
});
```

```javascript
// Example: Test RGB destination doesn't use K-Only GCR
test('RGB destination uses Relative Colorimetric not K-Only GCR', async () => {
    const converter = new PDFContentStreamColorConverter({
        renderingIntent: 'preserve-k-only-relative-colorimetric-gcr',
        destinationProfile: await loadRealProfile('FIPS_WIDE.icc'), // RGB profile
        destinationColorSpace: 'RGB',
        // ...
    });

    // Effective intent should be relative-colorimetric for RGB destination
    const effectiveIntent = converter.getEffectiveRenderingIntent('RGB');
    assert.strictEqual(effectiveIntent, 'relative-colorimetric');
});
```

## Required Test Fixtures

### Real ICC Profiles (already in fixtures/profiles/)

- `eciCMYK v2.icc` - CMYK destination (primary)
- `FIPS_WIDE.icc` - RGB destination
- `sRGB IEC61966-2.1.icc` - RGB source
- `sGray.icc` - Gray source

### Real PDF Files (already in fixtures/pdfs/)

- `2025-08-15 - ConRes - ISO PTF - CR1 (F9d) Fixtures - F-01.pdf` - Contains all color types
- `2025-08-15 - ConRes - ISO PTF - CR1 - Type Sizes and Lissajou.pdf` - Text/vector heavy
- `2025-08-15 - ConRes - ISO PTF - CR1 - Interlaken Map.pdf` - Large image (optional)

### Known-Good Outputs (need to generate)

Use `experiments/convert-pdf-color.js --legacy` to generate reference outputs:

```bash
node convert-pdf-color.js \
    "fixtures/pdfs/F-01.pdf" \
    "fixtures/profiles/eciCMYK v2.icc" \
    "fixtures/reference/F-01-eciCMYK-RelCol-legacy.pdf" \
    --intent=relative-colorimetric --no-workers --legacy
```

## Activity Log

### 2026-01-23 22:00 - Phase 2 Complete: Tests Marked for Removal

Marked ~45 tests for removal using `skip: !!'<REASON>'` pattern across all 10 test files:

| Test File | Tests Marked Skip | Reason Categories |
| --------- | ----------------- | ----------------- |
| ColorConverter.test.js | 5 | instanceof, error handling, worker mode, dispose, placeholder |
| ImageColorConverter.test.js | 6 | instanceof, worker mode, hook order, config shape, dispose, placeholder |
| LookupTableColorConverter.test.js | 4 | instanceof, hook order, error handling, placeholder |
| PDFContentStreamColorConverter.test.js | 6 | instanceof, hook order, worker task, worker mode, dispose, placeholder |
| PDFImageColorConverter.test.js | 7 | instanceof, hook order, worker task, config shape, dispose, worker mode, placeholder |
| PDFPageColorConverter.test.js | 5 | instanceof, hook order, worker mode, dispose, placeholder |
| PDFDocumentColorConverter.test.js | 7 | instanceof, ownership, hook order, worker mode, dispose, worker task, placeholder |
| ProfilePool.test.js | 1 | placeholder |
| BufferRegistry.test.js | 1 | placeholder |
| ColorConverterClasses.test.js | 8 | instanceof, memory cleanup, hook order, worker mode, dispose, placeholders |

Created `tests/snapshots/` directory with README explaining:
- Purpose: Known-good color conversion outputs for regression detection
- Structure: Organized by color space conversion type
- Format: JSON with metadata, samples, and tolerance values
- Workflow: Generate from legacy, compare against refactored

### 2026-01-23 21:00 - Test Audit Complete

- Read all 10 test files (96 tests total, not counting legacy placeholders)
- Categorized tests by actual verification performed
- Documented that 0 tests verify actual color conversion correctness
- Identified critical bugs that would not be caught by current tests
- Created this progress document with detailed analysis and recommendations
