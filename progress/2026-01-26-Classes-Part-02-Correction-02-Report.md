# 2026-01-26-CLASSES-PART-02-CORRECTION-02 Report

**Created:** 2026-01-27
**Status:** COMPLETE

This report documents the changes made during PART-02-CORRECTION-02, evaluates plan adherence, consolidates benchmark data across all runs, and provides a code review identifying remaining performance inefficiencies.

---

## Table of Contents

1. [Summary of Changes](#1-summary-of-changes)
2. [Plan Adherence Evaluation](#2-plan-adherence-evaluation)
3. [Consolidated Benchmark Tables](#3-consolidated-benchmark-tables)
4. [Code Review: Remaining Inefficiencies](#4-code-review-remaining-inefficiencies)

---

## 1. Summary of Changes

### 1.1 Problem Statement

The refactored class hierarchy introduced a performance regression where `PDFContentStreamColorConverter.convertBatchUncached()` called `convertSingleColor()` in a loop, resulting in N individual WASM calls instead of batched conversion.

**Violation detected:**

```javascript
// WRONG - What was implemented
async convertBatchUncached(inputs, context) {
    const results = [];
    for (const input of inputs) {
        const values = await this.convertSingleColor(input, context);  // N individual calls
        results.push(values);
    }
    return results;
}
```

This violated an explicit code directive:

```javascript
/// CLAUDE CODE AGENT NEVER PERFORM SINGLE COLOR TRANSFORMS IN JS ALWAYS PASS BATCHES TO COLOR-ENGINE TO TRANSFORM IN WASM/SIMD ///
```

### 1.2 Changes Made

#### Removed: `convertSingleColor` Method

The entire method (~60 lines) was deleted from `pdf-content-stream-color-converter.js`. This method should never have existed as all color conversion must go through batch processing.

#### Rewritten: `convertBatchUncached` Method

**Location:** [pdf-content-stream-color-converter.js:321-405](testing/iso/ptf/2025/classes/pdf-content-stream-color-converter.js#L321-L405)

**Implementation:**

```javascript
async convertBatchUncached(inputs, context) {
    const service = this.colorEngineService;
    if (!service) throw new Error('ColorEngineService not initialized');
    if (inputs.length === 0) return [];

    const config = this.configuration;

    // Group inputs by colorSpace for efficient batching
    const groups = new Map();
    for (let i = 0; i < inputs.length; i++) {
        const { colorSpace, values } = inputs[i];
        let group = groups.get(colorSpace);
        if (!group) {
            group = { indices: [], colors: [] };
            groups.set(colorSpace, group);
        }
        group.indices.push(i);
        group.colors.push({
            type: colorSpace,
            values: this.#pdfToEngine(colorSpace, values),
        });
    }

    const results = new Array(inputs.length);

    // Convert each group with a single batch call
    for (const [colorSpace, { indices, colors }] of groups) {
        // Determine source profile and effective rendering intent...
        const batchResults = await service.convertColors(colors, {...});
        for (let j = 0; j < indices.length; j++) {
            results[indices[j]] = this.#engineToPDF(batchResults[j].output.values);
        }
    }
    return results;
}
```

**Key improvements:**

1. Groups colors by colorSpace (RGB, Gray, Lab)
2. Makes ONE `service.convertColors()` call per group
3. Maintains original order via index tracking
4. Explicit error throwing for missing source profiles
5. K-Only GCR → Relative Colorimetric fallback for Lab/RGB

### 1.3 Expected vs Actual Impact

| Metric | Before | After (Expected) | After (Actual) |
|--------|--------|------------------|----------------|
| WASM calls per batch | N (one per color) | 1-3 (one per group) | 1-3 per stream |
| Expected overhead | 17-21% | ~0% | **19-68%** |

The fix reduced WASM calls per content stream batch, but **did not achieve parity with Legacy**. See Section 4 for analysis.

---

## 2. Plan Adherence Evaluation

### 2.1 PART-02-CORRECTION-02 Plan

The plan specified:

| Planned Item | Status | Notes |
|--------------|--------|-------|
| Remove `convertSingleColor` method | ✅ Complete | Method fully removed |
| Rewrite `convertBatchUncached` with grouping | ✅ Complete | Groups by colorSpace |
| ONE `convertColors()` call per group | ✅ Complete | Implemented correctly |
| Explicit errors for missing profiles | ✅ Complete | Throws descriptive errors |
| K-Only GCR fallback for Lab/RGB | ✅ Complete | Falls back to Relative Colorimetric |

### 2.2 What the Agent Got Right

1. **Removed the loop-over-singles anti-pattern** - The N × `convertSingleColor()` loop was replaced with proper batching
2. **Correct grouping logic** - Colors are grouped by colorSpace before batch conversion
3. **Index tracking** - Results are correctly reordered to match input order
4. **Error handling** - Explicit errors for missing source profiles

### 2.3 What the Agent Got Wrong

1. **Failed to recognize scope of batching** - Legacy batches across ALL content streams in the document; Refactored batches per content stream only

2. **Incomplete performance analysis** - The fix addressed the immediate loop problem but did not analyze the architectural difference in batching scope

3. **Overconfident prediction** - The document stated "Expected overhead: ~0% (matches legacy)" without verification

### 2.4 Repeated Failures

This is the **third correction** for the same fundamental issue:

| Correction | Issue | Resolution |
|------------|-------|------------|
| PART-02 | Initial implementation with N × loop | Identified problem |
| PART-02-CORRECTION | BPC not enabled correctly | Fixed BPC configuration |
| PART-02-CORRECTION-02 | Still using N × loop | Rewrote with grouping |

The agent repeatedly implemented the "batch = loop over singles" anti-pattern despite:
- Explicit directive comments in code
- User corrections in multiple sessions
- The `convertSingleColor` method being disabled with `throw new Error`

---

## 3. Consolidated Benchmark Tables

### 3.1 Test Matrix Comparisons Pass/Fail

| Run | Date | Comparisons Passed | Notes |
|-----|------|-------------------|-------|
| 2026-01-26-001 | 2026-01-26 | 6/12 (50%) | Baseline |
| 2026-01-26-002 | 2026-01-26 | 6/12 (50%) | After PART-01 |
| 2026-01-26-003 | 2026-01-26 | 6/12 (50%) | Before PART-02 |
| 2026-01-26-005 | 2026-01-26 | 6/12 (50%) | After PART-02 |
| 2026-01-26-013 | 2026-01-26 | 12/12 (100%) | After PART-02-CORRECTION (BPC enabled) |
| **2026-01-27-001** | **2026-01-27** | **12/12 (100%)** | **After PART-02-CORRECTION-02** |

### 3.2 Timing Comparison: 2026-01-27-001 (Latest Run)

#### F-01 Document (Large - 38 pages)

| Test | Legacy | Refactored | Overhead |
|------|--------|------------|----------|
| eciCMYK Rel Col (Main Thread) | 8,723 ms | 10,582 ms | **+21.3%** |
| eciCMYK Rel Col (7 Workers) | 8,805 ms | 10,495 ms | **+19.2%** |
| K-Only GCR (Main Thread) | 10,527 ms | 12,487 ms | **+18.6%** |
| K-Only GCR (7 Workers) | 10,639 ms | 12,583 ms | **+18.3%** |
| FIPS_WIDE Rel Col (Main Thread) | 7,436 ms | 8,861 ms | **+19.2%** |
| FIPS_WIDE Rel Col (7 Workers) | 7,497 ms | 8,694 ms | **+16.0%** |

#### Type Sizes Document (Small - 2 pages)

| Test | Legacy | Refactored | Overhead |
|------|--------|------------|----------|
| eciCMYK Rel Col (Main Thread) | 887 ms | 957 ms | **+7.9%** |
| eciCMYK Rel Col (7 Workers) | 888 ms | 954 ms | **+7.4%** |
| K-Only GCR (Main Thread) | 1,135 ms | 1,911 ms | **+68.4%** |
| K-Only GCR (7 Workers) | 1,131 ms | 1,980 ms | **+75.1%** |
| FIPS_WIDE Rel Col (Main Thread) | 855 ms | 892 ms | **+4.3%** |
| FIPS_WIDE Rel Col (7 Workers) | 883 ms | 936 ms | **+6.0%** |

### 3.3 Summary Statistics

| Metric | Value |
|--------|-------|
| Minimum overhead | +4.3% (Type Sizes, FIPS_WIDE, Main Thread) |
| Maximum overhead | +75.1% (Type Sizes, K-Only GCR, 7 Workers) |
| Average overhead (F-01) | +18.8% |
| Average overhead (Type Sizes) | +28.2% |
| Average overhead (K-Only GCR) | **+45.1%** |
| Average overhead (Relative Colorimetric) | +12.5% |

### 3.4 Key Observations

1. **K-Only GCR has 2-4× higher overhead** than Relative Colorimetric
2. **Workers do not reduce overhead** - overhead persists regardless of worker count
3. **Smaller documents have higher variance** - Type Sizes shows 4-75% range
4. **Correctness achieved** - All 12/12 comparisons pass (byte-identical output)

---

## 4. Code Review: Remaining Inefficiencies

### 4.1 Root Cause: Batching Scope Mismatch

**Legacy Implementation** ([PDFService.js:599-896](testing/iso/ptf/2025/services/PDFService.js#L599-L896)):

```
DOCUMENT LEVEL BATCHING:
  1. Analyze ALL pages
  2. Collect ALL contentStreamColorLocations across entire document
  3. Group ALL locations by sourceType (rgb, gray, lab)
  4. Call colorEngine.convertColors() ONCE per sourceType
     → Total WASM calls: 3 (RGB + Gray + Lab)
```

**Refactored Implementation** ([pdf-content-stream-color-converter.js](testing/iso/ptf/2025/classes/pdf-content-stream-color-converter.js)):

```
STREAM LEVEL BATCHING:
  1. For each page:
     2. For each content stream:
        3. Parse stream to get color operations
        4. Call buildLookupTable(uniqueInputs)
        5. convertBatchUncached() groups and converts
           → WASM calls: 1-3 per stream
```

**Impact calculation:**

For a document with 38 pages, ~2 content streams per page (76 streams):
- **Legacy**: 3 WASM calls total
- **Refactored**: Up to 228 WASM calls (3 × 76)

### 4.2 Lookup Table Not Shared Across Streams

The `LookupTableColorConverter` maintains an instance-level lookup table:

```javascript
// lookup-table-color-converter.js
class LookupTableColorConverter {
    #lookupTable = new Map();  // Instance field - not shared
}
```

If each `PDFContentStreamColorConverter` is a new instance per stream, the lookup table starts empty for each stream, causing colors to be re-converted even if they appeared in previous streams.

**Expected behavior:** Colors converted in stream 1 should be cached for stream 2.
**Actual behavior:** Each stream starts with an empty cache.

### 4.3 K-Only GCR Transform Overhead

The **+45% average overhead for K-Only GCR** (vs +12.5% for Relative Colorimetric) suggests:

1. K-Only GCR transforms are more expensive to create/apply
2. The per-stream batching multiplies this cost more significantly
3. Transform caching may not be effective for K-Only GCR

**Legacy** creates ONE K-Only GCR transform and reuses it for ALL colors in the document.
**Refactored** may be creating new transforms per stream.

### 4.4 Architectural Inefficiency: Class Hierarchy Overhead

The refactored class hierarchy introduces call stack depth:

```
Legacy:
  PDFService.convertColorInPDFDocument()
    → colorEngine.convertColors()

Refactored:
  PDFDocumentColorConverter.convertDocument()
    → PDFPageColorConverter.convertPage()
      → PDFContentStreamColorConverter.processContentStream()
        → LookupTableColorConverter.buildLookupTable()
          → convertBatchUncached()
            → colorEngineService.convertColors()
```

Each layer adds:
- Method call overhead
- Object allocations (new instances)
- Map/Array operations

### 4.5 Specific Code Issues

#### Issue 1: Deduplication Runs Per Stream

```javascript
// pdf-content-stream-color-converter.js
#deduplicateInputs(inputs) {
    const seen = new Set();
    const unique = [];
    for (const input of inputs) {
        const key = `${input.colorSpace}:${input.values.join(',')}`;
        if (!seen.has(key)) {
            seen.add(key);
            unique.push(input);
        }
    }
    return unique;
}
```

This deduplication happens per stream instead of document-wide, missing optimization opportunities.

#### Issue 2: Multiple Map/Array Operations

```javascript
// convertBatchUncached groups colors:
const groups = new Map();
for (let i = 0; i < inputs.length; i++) { ... }

// Then iterates groups:
for (const [colorSpace, { indices, colors }] of groups) { ... }

// Then reassembles results:
for (let j = 0; j < indices.length; j++) {
    results[indices[j]] = ...;
}
```

Legacy does this ONCE for the entire document. Refactored does it per stream.

#### Issue 3: PDF ↔ Engine Format Conversion Per Color

```javascript
group.colors.push({
    type: colorSpace,
    values: this.#pdfToEngine(colorSpace, values),  // Called per color
});

results[indices[j]] = this.#engineToPDF(batchResults[j].output.values);  // Called per color
```

These format conversions happen for EVERY color in EVERY stream, even if the same color was already converted in a previous stream.

### 4.6 Summary of Remaining Inefficiencies

| Issue | Impact | Legacy Approach |
|-------|--------|-----------------|
| Per-stream batching instead of document-wide | High | Batches entire document |
| Lookup table not shared across streams | High | N/A (no lookup table) |
| K-Only GCR transform recreation | Medium | Single transform reused |
| Deduplication per stream | Low-Medium | Document-wide unique colors |
| Multiple iterations per stream | Low | Single pass |
| Format conversion per color | Low | Batch format conversion |

---

## 5. Recommendations

### 5.1 To Match Legacy Performance

1. **Batch at document level** - Collect ALL content stream colors first, then convert in single batch per colorSpace
2. **Share lookup table** - Use a document-wide lookup table instance passed to all streams
3. **Cache transforms** - Ensure ColorEngineService transform caching works across streams

### 5.2 To Exceed Legacy Performance

1. **Precompute unique colors** - Build document-wide unique color set before conversion
2. **Parallel stream processing** - Process multiple streams concurrently with shared cache
3. **Profile-specific optimization** - Optimize K-Only GCR path separately

---

## 6. Conclusion

PART-02-CORRECTION-02 successfully fixed the immediate "loop over singles" anti-pattern, achieving correct output (12/12 comparisons pass). However, the refactored implementation still shows **19-68% performance overhead** compared to Legacy.

The root cause is architectural: **Refactored batches per content stream while Legacy batches per document**. This fundamental difference was not addressed by the correction.

Future work should focus on document-level batching and shared lookup tables to achieve performance parity.

---

**Files Referenced:**

- [pdf-content-stream-color-converter.js](testing/iso/ptf/2025/classes/pdf-content-stream-color-converter.js) - Refactored implementation
- [lookup-table-color-converter.js](testing/iso/ptf/2025/classes/lookup-table-color-converter.js) - Base class with lookup table
- [PDFService.js](testing/iso/ptf/2025/services/PDFService.js) - Legacy implementation
- [SUMMARY.json](testing/iso/ptf/2025/experiments/output/2026-01-27-001/SUMMARY.json) - Latest benchmark results
