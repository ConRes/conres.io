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

**Correctness:** All 12 comparisons PASSED (byte-identical output).

---

## Optimization Plan

All optimizations are organized by risk level. **Implement in order from LOW to HIGH risk.**

### Phase 1: LOW Risk Changes (Expected: 30-40% improvement)

| ID | Change | File(s) | Impact |
|----|--------|---------|--------|
| L1 | Replace Map with Record for color space grouping | `buffer-registry.js`, `pdf-content-stream-color-converter.js` | Faster property access for 3-key groups |
| L2 | Replace Map with Record for caches with string keys | `lookup-table-color-converter.js`, `buffer-registry.js` | Simpler, faster lookups |
| L3 | Cache `#getConversionConfig()` at batch level | `lookup-table-color-converter.js` | Eliminate 2x object creation per color |
| L4 | Use numeric rendering intent constants | `color-converter.js`, `buffer-registry.js`, `pdf-content-stream-color-converter.js` | Faster comparisons than 40-char strings |
| L5 | Pre-compute BufferRegistry config keys | `buffer-registry.js` | Eliminate per-lookup key generation |
| L6 | Add size limits to color caches | `buffer-registry.js`, `lookup-table-color-converter.js` | Prevent unbounded memory growth |

### Phase 2: MEDIUM Risk Changes (Expected: additional 20-30% improvement)

| ID | Change | File(s) | Impact |
|----|--------|---------|--------|
| M1 | Replace `#referenceOverrides` Map with WeakMap | `color-converter.js` | Automatic GC of PDF reference keys |
| M2 | Use WeakRef for ColorEngineService transforms | `ColorEngineService.js` | Allow WASM transforms to be GC'd |
| M3 | Transform warm-up phase at document level | `pdf-document-color-converter.js` | Pre-create all needed transforms |

### Phase 3: HIGH Risk Changes (Expected: additional 30-40% improvement)

| ID | Change | File(s) | Impact |
|----|--------|---------|--------|
| H1 | Page-level color aggregation | New `PageColorAggregator.js`, `pdf-page-color-converter.js` | Match legacy's batching strategy |

---

## Phase 1: LOW Risk Changes (Details)

### L1: Replace Map with Record for Color Space Grouping

**Problem:** Maps are used for grouping colors by space (RGB, Gray, Lab) where there are exactly 3 possible keys.

**Locations:**
- `buffer-registry.js:519` - `const groups = new Map()`
- `pdf-content-stream-color-converter.js:336` - `const groups = new Map()`

**Current:**
```javascript
/** @type {Map<'RGB' | 'Gray' | 'Lab', {...}>} */
const groups = new Map();

let group = groups.get(colorSpace);
if (!group) {
    group = { entries: [], colors: [] };
    groups.set(colorSpace, group);
}

for (const [colorSpace, { entries, colors }] of groups) { ... }
```

**Change to:**
```javascript
/** @type {{RGB?: {...}, Gray?: {...}, Lab?: {...}}} */
const groups = {};

let group = groups[colorSpace];
if (!group) {
    group = { entries: [], colors: [] };
    groups[colorSpace] = group;
}

for (const colorSpace of ['RGB', 'Gray', 'Lab']) {
    const group = groups[colorSpace];
    if (!group) continue;
    ...
}
```

**Why:** Direct property access (`groups.RGB`) is ~30-40% faster than `.get('RGB')`.

---

### L2: Replace Map with Record for String-Keyed Caches

**Problem:** Maps are used where plain objects would be faster and simpler.

**Locations:**

| File | Line | Current | Change to |
|------|------|---------|-----------|
| `lookup-table-color-converter.js` | 106 | `#fallbackLookupTable = new Map()` | `#fallbackLookupTable = {}` |
| `buffer-registry.js` | 154 | `#colorLookupCache = new Map()` | `#colorLookupCache = {}` |
| `buffer-registry.js` | 161 | `#pendingColors = new Map()` | `#pendingColors = {}` |

**Why:**
- All keys are strings (no object keys)
- No iteration over full collections (only point lookups)
- Object property access is faster than Map operations
- JSON-serializable for debugging

---

### L3: Cache `#getConversionConfig()` at Batch Level

**Problem:** `#getConversionConfig()` creates a new object on every call. Called 2x per color in `convertColor()`.

**Location:** `lookup-table-color-converter.js:153-161, 246, 269`

**Current:**
```javascript
// Called at line 246 (lookup) and line 269 (store)
const config = this.#getConversionConfig();
```

**Change to:**
```javascript
// Cache at instance level, invalidate when configuration changes
#cachedConversionConfig = null;

#getConversionConfig() {
    if (!this.#cachedConversionConfig) {
        const config = this.configuration;
        this.#cachedConversionConfig = {
            destinationProfile: config.destinationProfile,
            renderingIntent: config.renderingIntent,
            blackPointCompensation: config.blackPointCompensation,
            sourceRGBProfile: config.sourceRGBProfile,
            sourceGrayProfile: config.sourceGrayProfile,
        };
    }
    return this.#cachedConversionConfig;
}
```

**Why:** Configuration is immutable (frozen). Cache once, reuse forever.

---

### L4: Use Numeric Rendering Intent Constants

**Problem:** String comparison on 40-character K-Only GCR intent runs per color space group.

**Locations:**
- `pdf-content-stream-color-converter.js:383-388`
- `buffer-registry.js:549-555`
- Multiple other locations

**Current:**
```javascript
if (config.renderingIntent === 'preserve-k-only-relative-colorimetric-gcr') {
    if (colorSpace === 'Lab') {
        effectiveRenderingIntent = 'relative-colorimetric';
    }
}
```

**Change to:**
```javascript
// In color-converter.js or constants file:
export const INTENT = {
    PERCEPTUAL: 0,
    RELATIVE_COLORIMETRIC: 1,
    SATURATION: 2,
    ABSOLUTE_COLORIMETRIC: 3,
    K_ONLY_GCR: 20,
};

// Then:
if (config.renderingIntentCode === INTENT.K_ONLY_GCR) {
    if (colorSpace === 'Lab') {
        effectiveRenderingIntentCode = INTENT.RELATIVE_COLORIMETRIC;
    }
}
```

**Why:** Integer comparison is ~10x faster than 40-character string comparison.

---

### L5: Pre-compute BufferRegistry Config Keys

**Problem:** `#generateConfigKey()` called on every color lookup.

**Location:** `buffer-registry.js:397-407, 443`

**Current:**
```javascript
lookupColor(config, colorSpace, values) {
    const configKey = this.#generateConfigKey(config);  // Called every time
    ...
}
```

**Change to:**
```javascript
// Add config key caching
#configKeyCache = new WeakMap();  // config object → key string

#getConfigKey(config) {
    let key = this.#configKeyCache.get(config);
    if (!key) {
        key = this.#generateConfigKey(config);
        this.#configKeyCache.set(config, key);
    }
    return key;
}

lookupColor(config, colorSpace, values) {
    const configKey = this.#getConfigKey(config);  // Cached
    ...
}
```

**Why:** Config objects are reused across lookups. Generate key once per unique config.

---

### L6: Add Size Limits to Color Caches

**Problem:** Color caches can grow unbounded, causing memory issues in long-running processes.

**Locations:**
- `buffer-registry.js:154` - `#colorLookupCache`
- `lookup-table-color-converter.js:106` - `#fallbackLookupTable`

**Change:**
```javascript
#maxCacheEntries = 10000;
#cacheEntryCount = 0;

storeColor(config, colorSpace, values, convertedValues) {
    // ... existing store logic ...

    this.#cacheEntryCount++;
    if (this.#cacheEntryCount > this.#maxCacheEntries) {
        this.#evictOldestEntries(1000);  // Evict 10%
    }
}

#evictOldestEntries(count) {
    // FIFO eviction - remove first N entries
    const cache = this.#colorLookupCache[configKey];
    const keys = Object.keys(cache);
    for (let i = 0; i < count && i < keys.length; i++) {
        delete cache[keys[i]];
        this.#cacheEntryCount--;
    }
}
```

**Why:** Prevents memory exhaustion during large-scale PDF processing.

---

## Phase 2: MEDIUM Risk Changes (Details)

### M1: Replace `#referenceOverrides` Map with WeakMap

**Problem:** Map keys are PDF references that prevent garbage collection.

**Location:** `color-converter.js:110`

**Current:**
```javascript
#referenceOverrides = new Map();
```

**Change to:**
```javascript
#referenceOverrides = new WeakMap();
```

**Why:**
- Keys are PDFRef objects that should be garbage-collectable
- Automatic cleanup when PDF references are no longer needed
- Prevents memory leaks for long-running PDF processing

**Risk:** WeakMap doesn't support `.size`, `.clear()`, or iteration. Need to verify these aren't used.

---

### M2: Use WeakRef for ColorEngineService Transforms

**Problem:** Transform cache holds strong references to WASM objects.

**Location:** `ColorEngineService.js:69, 72`

**Current:**
```javascript
#transformCache = new Map();
#multiprofileTransformCache = new Map();
```

**Change to:**
```javascript
// Values wrapped in WeakRef
#transformCache = new Map();  // string → { transform: WeakRef, inputFormat, outputFormat }

#getOrCreateTransform(...) {
    let cached = this.#transformCache.get(cacheKey);
    if (cached) {
        const transform = cached.transform.deref?.();
        if (transform) {
            return { transform, inputFormat: cached.inputFormat, outputFormat: cached.outputFormat };
        }
        // WeakRef was GC'd - remove stale entry
        this.#transformCache.delete(cacheKey);
    }

    // Create new transform
    const transform = colorEngine.createTransform(...);
    this.#transformCache.set(cacheKey, {
        transform: new WeakRef(transform),
        inputFormat,
        outputFormat
    });
    return { transform, inputFormat, outputFormat };
}
```

**Why:** Allows WASM transform objects to be garbage collected when not actively in use.

**Risk:** Transforms may need to be recreated if GC'd during conversion. Add null checks.

---

### M3: Transform Warm-up Phase at Document Level

**Problem:** Transforms are created on-demand during conversion, adding latency.

**Location:** `pdf-document-color-converter.js`

**Change:**
```javascript
async warmUpTransforms() {
    // Analyze document to determine needed transforms
    const colorSpaces = await this.analyzeDocumentColorSpaces();
    const neededTransforms = [];

    for (const space of colorSpaces) {
        for (const intent of this.configuration.intents || [this.configuration.renderingIntent]) {
            neededTransforms.push({ source: space, intent });
        }
    }

    // Pre-create all transforms
    const service = this.colorEngineService;
    for (const { source, intent } of neededTransforms) {
        await service.ensureTransform(source, this.configuration.destinationProfile, intent);
    }
}

async convertDocument(pdfDocument) {
    await this.warmUpTransforms();  // Pre-warm
    // ... existing conversion logic ...
}
```

**Why:** Eliminates transform creation latency during hot conversion path.

**Risk:** Requires new method in ColorEngineService. May pre-create unused transforms.

---

## Phase 3: HIGH Risk Changes (Details)

### H1: Page-Level Color Aggregation

**Problem:** Refactored implementation processes streams individually, while legacy batches at page level.

**Current flow:**
```
Per PAGE → Per STREAM → Parse → Convert → Write
```

**Proposed flow:**
```
Per PAGE:
  Phase 1: Parse ALL streams, collect ALL colors
  Phase 2: Batch convert (ONE call per color type for entire page)
  Phase 3: Write converted colors back to ALL streams
```

**New file: `page-color-aggregator.js`**
```javascript
export class PageColorAggregator {
    #colorsByType = { RGB: [], Gray: [], Lab: [] };
    #locationMap = [];  // Track origin stream/offset for each color

    collectFromStream(streamIndex, colorLocations) {
        for (const loc of colorLocations) {
            this.#colorsByType[loc.colorSpace].push(loc.values);
            this.#locationMap.push({ streamIndex, offset: loc.offset, colorSpace: loc.colorSpace });
        }
    }

    async convertAll(colorEngineService, config) {
        const results = {};
        for (const [type, colors] of Object.entries(this.#colorsByType)) {
            if (colors.length === 0) continue;
            results[type] = await colorEngineService.convertColors(
                colors.map(v => ({ type, values: v })),
                config
            );
        }
        return this.#mapResultsToLocations(results);
    }

    #mapResultsToLocations(results) {
        // Map converted values back to stream/offset locations
        const byStream = {};
        // ... mapping logic ...
        return byStream;
    }
}
```

**Why:** Matches legacy's performance by batching at page level while keeping class structure.

**Risk:**
- Significant refactoring of `pdf-page-color-converter.js`
- Need to split `pdf-content-stream-color-converter.js` into parse/write phases
- More complex data flow

---

## Benchmark Results Reference

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

---

## Architectural Comparison

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

### Critical Difference

| Aspect                | Legacy                    | Refactored                                          |
| --------------------- | ------------------------- | --------------------------------------------------- |
| Batching scope        | Page-level (global)       | Stream-level (local + cache)                        |
| convertColors() calls | 1 per color type per page | 1 per color type per stream (cache reduces repeats) |
| Configuration objects | 1 per conversion          | Multiple per operation                              |
| Transform lookup      | String key per batch      | String key per color lookup                         |

---

## Why K-Only GCR Is Disproportionately Slower

The 69-73% slowdown on small PDFs with K-Only GCR is caused by:

1. **Fixed overhead dominates small datasets:** Configuration creation, key generation, and async overhead are amortized over fewer colors
2. **Longer intent string:** `'preserve-k-only-relative-colorimetric-gcr'` (40 chars) vs `'relative-colorimetric'` (21 chars) increases string operation cost
3. **Fallback logic overhead:** Lab colors trigger fallback check, adding per-group overhead
4. **Duplicated checks:** Fallback logic appears in both `PDFContentStreamColorConverter` and `BufferRegistry`

On large PDFs, these overheads are amortized across thousands of colors, resulting in consistent ~17% overhead.

---

## Files Reference

| File                                    | Role                   | Key Changes Needed |
| --------------------------------------- | ---------------------- | ------------------ |
| `color-converter.js`                    | Base class             | L4 (intent constants), M1 (WeakMap) |
| `lookup-table-color-converter.js`       | Caching layer          | L2 (Record), L3 (cache config), L6 (limits) |
| `pdf-content-stream-color-converter.js` | Stream processing      | L1 (Record), L4 (intent constants) |
| `buffer-registry.js`                    | Shared cache           | L1 (Record), L2 (Record), L5 (key cache), L6 (limits) |
| `pdf-page-color-converter.js`           | Page orchestration     | H1 (aggregator) |
| `pdf-document-color-converter.js`       | Document orchestration | M3 (warm-up) |
| `ColorEngineService.js`                 | WASM color engine      | M2 (WeakRef) |

---

## Expected Improvement Summary

| Phase | Changes | Expected Improvement | Cumulative |
|-------|---------|---------------------|------------|
| Phase 1 (LOW risk) | L1-L6 | 30-40% | 30-40% |
| Phase 2 (MEDIUM risk) | M1-M3 | 20-30% | 50-60% |
| Phase 3 (HIGH risk) | H1 | 30-40% | 70-80% |

**Target:** Match or exceed legacy performance while maintaining class hierarchy benefits (testability, composability, maintainability).

---

*Report updated: 2026-01-27*
*Benchmark configuration: `2026-01-26-CLASSES-002.json`*
*Output folder: `2026-01-27-004`*
