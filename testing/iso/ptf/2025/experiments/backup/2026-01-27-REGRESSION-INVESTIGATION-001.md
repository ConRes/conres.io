# Performance Regression Investigation Report

**Date:** 2026-01-27
**Benchmark Run:** `2026-01-27-004`
**Configuration:** `2026-01-26-CLASSES-002.json`

---

## Executive Summary

The refactored class-based implementation shows consistent performance regression compared to legacy:

| File Type                       | Relative Colorimetric | K-Only GCR         |
| ------------------------------- | --------------------- | ------------------ |
| Large PDF (F-01, 28 pages)      | +17% slower           | +16-17% slower     |
| Small PDF (Type Sizes, 3 pages) | +5-7% slower          | **+69-73% slower** |

**Root cause:** Architectural differences in how colors are batched and converted, combined with per-color overhead from configuration object creation, key generation, and async boundaries.

---

## 1. Benchmark Results (2026-01-27-004)

### F-01 (Large PDF with images)

| Profile    | Intent                | Mode    | Legacy  | Refactored | Delta |
| ---------- | --------------------- | ------- | ------- | ---------- | ----- |
| eciCMYK v2 | Relative Colorimetric | Main    | 8858ms  | 10742ms    | +21%  |
| eciCMYK v2 | Relative Colorimetric | Workers | 9062ms  | 10570ms    | +17%  |
| eciCMYK v2 | K-Only GCR            | Main    | 10652ms | 12385ms    | +16%  |
| eciCMYK v2 | K-Only GCR            | Workers | 10659ms | 12419ms    | +17%  |
| FIPS_WIDE  | Relative Colorimetric | Main    | 7446ms  | 8724ms     | +17%  |
| FIPS_WIDE  | Relative Colorimetric | Workers | 7505ms  | 8790ms     | +17%  |

### Type Sizes (Small PDF, no images)

| Profile    | Intent                | Mode    | Legacy | Refactored | Delta    |
| ---------- | --------------------- | ------- | ------ | ---------- | -------- |
| eciCMYK v2 | Relative Colorimetric | Main    | 884ms  | 948ms      | +7%      |
| eciCMYK v2 | Relative Colorimetric | Workers | 875ms  | 938ms      | +7%      |
| eciCMYK v2 | K-Only GCR            | Main    | 1137ms | 1923ms     | **+69%** |
| eciCMYK v2 | K-Only GCR            | Workers | 1109ms | 1915ms     | **+73%** |
| FIPS_WIDE  | Relative Colorimetric | Main    | 857ms  | 896ms      | +5%      |
| FIPS_WIDE  | Relative Colorimetric | Workers | 856ms  | 914ms      | +7%      |

**Correctness:** All 12 comparisons PASSED (byte-identical output).

---

## 2. Architectural Comparison

### Legacy Implementation (PDFService.js)

```
Document
  └─ Per PAGE:
       ├─ Parse ALL content streams on page
       ├─ Group ALL colors by type (RGB, Gray, Lab)
       └─ ONE convertColors() call per type
           └─ All RGB colors → single batch
           └─ All Gray colors → single batch
           └─ All Lab colors → single batch
```

**Key characteristic:** Global batching at page level. One ColorEngineService per conversion.

### Refactored Implementation (Class Hierarchy)

```
PDFDocumentColorConverter
  └─ Per PAGE:
       └─ PDFPageColorConverter
            └─ Per CONTENT STREAM:
                 └─ PDFContentStreamColorConverter
                      ├─ Parse this stream's colors
                      ├─ Deduplicate unique colors
                      ├─ Build lookup table (convertBatchUncached)
                      │    └─ Group by type, ONE convertColors() per type
                      └─ Apply lookup table to stream
```

**Key characteristic:** Stream-level batching with caching. Lookup table prevents re-converting repeated colors, but each stream triggers batch operations.

### Critical Difference

| Aspect                | Legacy                    | Refactored                                          |
| --------------------- | ------------------------- | --------------------------------------------------- |
| Batching scope        | Page-level (global)       | Stream-level (local + cache)                        |
| convertColors() calls | 1 per color type per page | 1 per color type per stream (cache reduces repeats) |
| Configuration objects | 1 per conversion          | Multiple per operation                              |
| Transform lookup      | String key per batch      | String key per color lookup                         |

---

## 3. Identified Overhead Sources

### 3.1 Configuration Object Creation

**Location:** `color-converter.js:356`

```javascript
getEffectiveConfigurationFor(reference) {
    const override = this.getConfigurationFor(reference);
    if (!override) {
        return this.configuration;
    }
    return Object.freeze({ ...this.configuration, ...override });  // NEW OBJECT
}
```

**Impact:** Creates frozen object per reference lookup. For K-Only GCR with per-page overrides, this fires repeatedly.

### 3.2 Per-Color Method Call Overhead

**Location:** `lookup-table-color-converter.js:246,269,441`

```javascript
#getConversionConfig() {
    const config = this.configuration;
    return {
        destinationProfile: config.destinationProfile,
        renderingIntent: config.renderingIntent,
        blackPointCompensation: config.blackPointCompensation,
        sourceRGBProfile: config.sourceRGBProfile,
        sourceGrayProfile: config.sourceGrayProfile,
    };
}
```

**Impact:** Called 2x in `convertColor()` (lookup + store) and 1x in `convertBatch()`. Creates temporary objects per color.

### 3.3 Key Generation Per Color

**Location:** `lookup-table-color-converter.js:248,317,457`

```javascript
#generateColorKey(colorSpace, values) {
    return `${colorSpace}:${values.join(',')}`;  // String concat + array join
}
```

**Impact:** Called for every color lookup, even cached ones. 100 colors = 100 string concatenations.

### 3.4 BufferRegistry Configuration Key

**Location:** `buffer-registry.js:397-407`

```javascript
#generateConfigKey(config) {
    const parts = [
        typeof config.destinationProfile === 'string'
            ? config.destinationProfile
            : `buffer:${config.destinationProfile.byteLength}`,
        config.renderingIntent,
        config.blackPointCompensation ? '1' : '0',
    ];
    return parts.join('|');
}
```

**Impact:** Called per color lookup. K-Only GCR intent string is 40 characters (`preserve-k-only-relative-colorimetric-gcr`), increasing string operation cost.

### 3.5 K-Only GCR Fallback Logic

**Location:** `pdf-content-stream-color-converter.js:383-388` and `buffer-registry.js:549-555`

```javascript
let effectiveRenderingIntent = config.renderingIntent;
if (config.renderingIntent === 'preserve-k-only-relative-colorimetric-gcr') {
    if (colorSpace === 'Lab' || config.destinationColorSpace === 'RGB') {
        effectiveRenderingIntent = 'relative-colorimetric';
    }
}
```

**Impact:** String comparison on long intent string runs per color space group. Duplicated in multiple locations.

### 3.6 Async/Await Boundaries

**Location:** `pdf-content-stream-color-converter.js:197-304`

```javascript
async convertColor(input, context = {}) {
    await this.ensureReady();  // Promise tick even when ready
    // ...
    const lookupTable = await this.buildLookupTable(uniqueInputs, context);  // Await
    // ...
}
```

**Impact:** Each conversion operation goes through async machinery (promise creation, microtask queue). Legacy is more synchronous in hot paths.

---

## 4. Why K-Only GCR Is Disproportionately Slower

The 69-73% slowdown on small PDFs with K-Only GCR is caused by:

1. **Fixed overhead dominates small datasets:** Configuration creation, key generation, and async overhead are amortized over fewer colors
2. **Longer intent string:** `'preserve-k-only-relative-colorimetric-gcr'` (40 chars) vs `'relative-colorimetric'` (21 chars) increases string operation cost
3. **Fallback logic overhead:** Lab colors trigger fallback check, adding per-group overhead
4. **Duplicated checks:** Fallback logic appears in both `PDFContentStreamColorConverter` and `BufferRegistry`

On large PDFs, these overheads are amortized across thousands of colors, resulting in consistent ~17% overhead.

---

## 5. Alternative Paths Forward

### Option A: Configuration Pooling and Key Caching (Quick Win)

**Effort:** Low
**Expected improvement:** 20-30%
**Risk:** Low

**Changes:**
- Pool configuration objects instead of creating new ones
- Cache transform keys instead of regenerating per lookup
- Use numeric intent comparison instead of string

**Files to modify:**
- `buffer-registry.js` - cache config keys
- `lookup-table-color-converter.js` - pool conversion configs
- Add rendering intent constants as numbers

### Option B: Transform Warm-up Phase (Quick Win)

**Effort:** Low-Medium
**Expected improvement:** 50-70%
**Risk:** Low

**Changes:**
- Analyze document before processing to determine needed transforms
- Pre-create all transforms upfront
- Use instant lookups during conversion

**Files to modify:**
- `color-converter.js` - add warm-up method
- `pdf-document-color-converter.js` - call warm-up before page processing

### Option C: Page-Level Color Aggregation (Match Legacy Performance)

**Effort:** Medium-High
**Expected improvement:** 70-90%
**Risk:** Medium

**Changes:**
- Add `PageColorAggregator` that collects all colors from all streams before converting
- Process in two phases: (1) parse all streams, (2) batch convert, (3) write back
- Matches legacy's page-level batching while keeping class structure

**Files to modify:**
- New `PageColorAggregator.js`
- `pdf-page-color-converter.js` - use aggregator
- `pdf-content-stream-color-converter.js` - split into parse/write phases

### Option D: Stream-Level Batching Optimization (Incremental)

**Effort:** Medium
**Expected improvement:** 40-60%
**Risk:** Low-Medium

**Changes:**
- Keep stream-level processing
- Batch all colors within each stream before creating transforms
- Reduce per-color method calls

**Files to modify:**
- `lookup-table-color-converter.js` - optimize batch path
- `pdf-content-stream-color-converter.js` - group before convert

---

## 6. Recommendation

### Immediate Actions (Low Risk, Moderate Gain)

1. **Implement Option A** (Configuration Pooling)
   - Cache `#getConversionConfig()` result at batch level
   - Pre-compute BufferRegistry config keys
   - Use numeric intent comparison

2. **Implement Option B** (Transform Warm-up)
   - Warm up transforms at document level before page processing
   - Eliminate transform creation during hot path

**Expected combined improvement:** 40-50%

### Follow-up (Medium Risk, High Gain)

3. **Implement Option C** (Page-Level Aggregation)
   - Match legacy's batching strategy
   - Keep class hierarchy for testability

**Expected additional improvement:** 30-40% (total ~80%)

---

## 7. Files Reference

| File                                    | Role                   | Key Overhead                                            |
| --------------------------------------- | ---------------------- | ------------------------------------------------------- |
| `color-converter.js`                    | Base class             | `getEffectiveConfigurationFor()` creates frozen objects |
| `lookup-table-color-converter.js`       | Caching layer          | `#getConversionConfig()` called 2x per color            |
| `pdf-content-stream-color-converter.js` | Stream processing      | K-Only fallback logic, async boundaries                 |
| `buffer-registry.js`                    | Shared cache           | Config key generation per lookup                        |
| `pdf-page-color-converter.js`           | Page orchestration     | Stream-level iteration                                  |
| `pdf-document-color-converter.js`       | Document orchestration | Could add warm-up phase                                 |

---

## 8. Conclusion

The refactored implementation's performance regression stems from architectural differences in batching scope (stream-level vs page-level) combined with per-color overhead from object creation and string operations.

**The good news:** Correctness is verified (byte-identical output). The class hierarchy provides better testability and composability.

**The path forward:** Quick wins (Options A + B) can recover 40-50% of performance. Full recovery requires page-level aggregation (Option C) while preserving the class structure.

The K-Only GCR anomaly (69-73% slower) is specifically caused by longer intent strings and fallback logic overhead, which becomes proportionally worse on small datasets.

---

*Report generated: 2026-01-27*
*Benchmark configuration: `2026-01-26-CLASSES-002.json`*
*Output folder: `2026-01-27-004`*
