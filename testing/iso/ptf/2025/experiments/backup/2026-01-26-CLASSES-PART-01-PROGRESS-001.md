# Template Method Pattern Removal - PROGRESS

**Last Updated:** 2026-01-26
**Status:** Planning Phase

---

## Overview

This document tracks the refactoring effort to remove the Template Method pattern from all color converter classes. The goal is to eliminate:

1. All `doConvertColor()` methods
2. All `before*/after*` hook methods
3. All abstract methods that throw

---

## Current Class Hierarchy

```
ColorConverter (base)
├── ImageColorConverter
│   └── PDFImageColorConverter
├── LookupTableColorConverter
│   └── PDFContentStreamColorConverter
├── PDFPageColorConverter
└── PDFDocumentColorConverter
```

---

## Template Method Pattern Inventory

### Methods to Remove

| Class | Hooks (before/after) | Template Override | Abstract Methods |
|-------|---------------------|-------------------|------------------|
| ColorConverter | `beforeConvertColor()` `afterConvertColor()` | `doConvertColor()` throws | `doConvertColor()` |
| ImageColorConverter | `beforeConvertImageColor()` `afterConvertImageColor()` | `doConvertColor()` → `convertImageColor()` | None |
| LookupTableColorConverter | `beforeConvertLookupTableColor()` `afterConvertLookupTableColor()` | `doConvertColor()` → `convertLookupTableColor()` | `convertSingleColor()` |
| PDFContentStreamColorConverter | `beforeConvertPDFContentStreamColor()` `afterConvertPDFContentStreamColor()` | `doConvertColor()` → `convertContentStreamColors()` | None |
| PDFImageColorConverter | `beforeConvertPDFImageColor()` `afterConvertPDFImageColor()` | `doConvertColor()` → `convertPDFImageColor()` | None |
| PDFPageColorConverter | `beforeConvertPDFPageColor()` `afterConvertPDFPageColor()` | `doConvertColor()` → actual logic | None |
| PDFDocumentColorConverter | `beforeConvertPDFDocumentColor()` `afterConvertPDFDocumentColor()` | `doConvertColor()` → actual logic | None |

### Total Counts

| Item | Count |
|------|-------|
| Hook methods to remove | 14 |
| `doConvertColor()` implementations | 7 |
| Abstract methods that throw | 2 |
| **Total methods to eliminate** | **23** |

---

## Refactoring Stages

### Stage 1: ColorConverter (Base Class)

**Files:**
- `classes/color-converter.js` (lines 194-243)
- `tests/ColorConverter.test.js` (lines 128-153, 160-170)

**Changes:**

| Change | Location | Before | After |
|--------|----------|--------|-------|
| Remove `convertColor()` template | Line 194-212 | Calls hooks in order | Direct call to subclass method |
| Remove `beforeConvertColor()` | Line 214-216 | No-op hook | Delete entirely |
| Remove `doConvertColor()` | Line 229-231 | Abstract throws | Delete entirely |
| Remove `afterConvertColor()` | Line 243-245 | No-op hook | Delete entirely |

**New Design:**

```javascript
// BEFORE (Template Method)
async convertColor(input, context = {}) {
    await this.beforeConvertColor(input, context);
    const result = await this.doConvertColor(input, context);
    await this.afterConvertColor(input, result, context);
    return result;
}

// AFTER (Direct Override)
async convertColor(input, context = {}) {
    throw new Error('ColorConverter.convertColor() must be overridden');
}
```

**Test Changes:**

| Test | Action | Reason |
|------|--------|--------|
| `invokeTemplateMethodTest` | Remove | Tests hook ordering - no longer applicable |
| `invokeAbstractMethodThrowsTest` | Modify | Update error message expectation |

**Regression Script:**
```bash
node experiments/scripts/compare-implementations.js \
  "../../assets/testforms/2025-08-15 - ConRes - ISO PTF - CR1.pdf" \
  profiles/eciCMYK-v2.icc --output-dir=../output/2026-01-26-001
```

---

### Stage 2: ImageColorConverter

**Files:**
- `classes/image-color-converter.js` (lines 284-339)
- `tests/ImageColorConverter.test.js` (lines 167-234)

**Changes:**

| Change | Location | Before | After |
|--------|----------|--------|-------|
| Remove `beforeConvertImageColor()` | Line 284-286 | No-op hook | Delete entirely |
| Remove `afterConvertImageColor()` | Line 298-300 | No-op hook | Delete entirely |
| Remove `beforeConvertColor()` override | Line 311-314 | Calls parent + image hook | Delete entirely |
| Remove `afterConvertColor()` override | Line 322-325 | Calls image hook + parent | Delete entirely |
| Rename `doConvertColor()` → `convertColor()` | Line 337-339 | Delegates to convertImageColor | Direct override |

**New Design:**

```javascript
// BEFORE
async doConvertColor(input, context) {
    return this.convertImageColor(input, context);
}

// AFTER
async convertColor(input, context = {}) {
    return this.convertImageColor(input, context);
}
```

**Test Changes:**

| Test | Action | Reason |
|------|--------|--------|
| `invokeHookOrderTest` | Remove | Tests hook ordering - no longer applicable |
| Keep other tests | Modify | Update to not rely on hooks |

---

### Stage 3: LookupTableColorConverter

**Files:**
- `classes/lookup-table-color-converter.js` (lines 186-293)
- `tests/LookupTableColorConverter.test.js` (lines 332-387, 394-412)

**Changes:**

| Change | Location | Before | After |
|--------|----------|--------|-------|
| Remove `beforeConvertLookupTableColor()` | Line 186-188 | No-op hook | Delete entirely |
| Remove `afterConvertLookupTableColor()` | Line 198-200 | No-op hook | Delete entirely |
| Remove `beforeConvertColor()` override | Line 211-214 | Calls parent + lookup hook | Delete entirely |
| Remove `afterConvertColor()` override | Line 222-225 | Calls lookup hook + parent | Delete entirely |
| Rename `doConvertColor()` → `convertColor()` | Line 237-239 | Delegates to convertLookupTableColor | Direct override |
| Remove abstract `convertSingleColor()` | Line 291-293 | Throws error | Delete entirely |

**Critical:** `convertSingleColor()` is called by `convertBatch()`. Subclasses must implement it.

**New Design:**

```javascript
// BEFORE
async convertSingleColor(input, context) {
    throw new Error('LookupTableColorConverter.convertSingleColor() is abstract');
}

// AFTER - Method signature only, no throw
// Subclass PDFContentStreamColorConverter provides the implementation
```

**Test Changes:**

| Test | Action | Reason |
|------|--------|--------|
| `invokeHookOrderTest` | Remove | Tests hook ordering |
| `invokeAbstractMethodThrowsTest` | Remove | Tests abstract throw |

---

### Stage 4: PDFContentStreamColorConverter

**Files:**
- `classes/pdf-content-stream-color-converter.js` (lines 237-290)
- `tests/PDFContentStreamColorConverter.test.js` (lines 174-248)

**Changes:**

| Change | Location | Before | After |
|--------|----------|--------|-------|
| Remove `beforeConvertPDFContentStreamColor()` | Line 237-239 | No-op hook | Delete entirely |
| Remove `afterConvertPDFContentStreamColor()` | Line 249-251 | No-op hook | Delete entirely |
| Remove `beforeConvertLookupTableColor()` override | Line 262-265 | Calls parent + PDF hook | Delete entirely |
| Remove `afterConvertLookupTableColor()` override | Line 273-276 | Calls PDF hook + parent | Delete entirely |
| Rename `doConvertColor()` → `convertColor()` | Line 288-290 | Delegates | Direct override |

**New Design:**

```javascript
// BEFORE
async doConvertColor(input, context) {
    return this.convertContentStreamColors(input, context);
}

// AFTER
async convertColor(input, context = {}) {
    await this.ensureReady();
    return this.convertContentStreamColors(input, context);
}
```

**Test Changes:**

| Test | Action | Reason |
|------|--------|--------|
| `invokeHookOrderTest` | Remove | Tests hook ordering |

---

### Stage 5: PDFImageColorConverter

**Files:**
- `classes/pdf-image-color-converter.js` (lines 170-223)
- `tests/PDFImageColorConverter.test.js` (lines 129-215)

**Changes:**

| Change | Location | Before | After |
|--------|----------|--------|-------|
| Remove `beforeConvertPDFImageColor()` | Line 170-172 | No-op hook | Delete entirely |
| Remove `afterConvertPDFImageColor()` | Line 182-184 | No-op hook | Delete entirely |
| Remove `beforeConvertImageColor()` override | Line 195-198 | Calls parent + PDF hook | Delete entirely |
| Remove `afterConvertImageColor()` override | Line 206-209 | Calls PDF hook + parent | Delete entirely |
| Rename `doConvertColor()` → `convertColor()` | Line 221-223 | Delegates | Direct override |

**New Design:**

```javascript
// BEFORE
async doConvertColor(input, context) {
    return this.convertPDFImageColor(input, context);
}

// AFTER
async convertColor(input, context = {}) {
    return this.convertPDFImageColor(input, context);
}
```

**Test Changes:**

| Test | Action | Reason |
|------|--------|--------|
| `invokeHookOrderTest` | Remove | Tests hook ordering |

---

### Stage 6: PDFPageColorConverter

**Files:**
- `classes/pdf-page-color-converter.js` (lines 251-432)
- `tests/PDFPageColorConverter.test.js` (lines 195-262)

**Changes:**

| Change | Location | Before | After |
|--------|----------|--------|-------|
| Remove `beforeConvertPDFPageColor()` | Line 251-253 | No-op hook | Delete entirely |
| Remove `afterConvertPDFPageColor()` | Line 263-265 | No-op hook | Delete entirely |
| Remove `beforeConvertColor()` override | Line 276-279 | Calls parent + page hook | Delete entirely |
| Remove `afterConvertColor()` override | Line 287-290 | Calls page hook + parent | Delete entirely |
| Rename `doConvertColor()` → `convertColor()` | Line 299 | Contains actual logic | Keep logic, rename method |

**New Design:**

```javascript
// BEFORE
async doConvertColor(input, context) {
    // ... 130 lines of actual logic ...
}

// AFTER
async convertColor(input, context = {}) {
    await this.ready();
    // ... same logic, moved here ...
}
```

**Test Changes:**

| Test | Action | Reason |
|------|--------|--------|
| `invokeHookOrderTest` | Remove | Tests hook ordering |

---

### Stage 7: PDFDocumentColorConverter

**Files:**
- `classes/pdf-document-color-converter.js` (lines 291-404)
- `tests/PDFDocumentColorConverter.test.js` (lines 312-376)

**Changes:**

| Change | Location | Before | After |
|--------|----------|--------|-------|
| Remove `beforeConvertPDFDocumentColor()` | Line 291-293 | No-op hook | Delete entirely |
| Remove `afterConvertPDFDocumentColor()` | Line 303-305 | No-op hook | Delete entirely |
| Remove `beforeConvertColor()` override | Line 316-319 | Calls parent + doc hook | Delete entirely |
| Remove `afterConvertColor()` override | Line 327-330 | Calls doc hook + parent | Delete entirely |
| Rename `doConvertColor()` → `convertColor()` | Line 339 | Contains actual logic | Keep logic, rename method |

**New Design:**

```javascript
// BEFORE
async doConvertColor(input, context) {
    // ... 65 lines of actual logic ...
}

// AFTER
async convertColor(input, context = {}) {
    await this.ready();
    // ... same logic, moved here ...
}
```

**Test Changes:**

| Test | Action | Reason |
|------|--------|--------|
| `invokeHookOrderTest` | Remove | Tests hook ordering |

---

## Refactoring Roadmap

- [ ] **Stage 1: ColorConverter** `PENDING`
  - [ ] Read and understand current implementation
  - [ ] Run baseline regression tests
  - [ ] Remove template method pattern
  - [ ] Update tests
  - [ ] Run regression tests
  - [ ] Verify no regressions

- [ ] **Stage 2: ImageColorConverter**
  - [ ] Remove hooks and template pattern
  - [ ] Update tests
  - [ ] Run regression tests

- [ ] **Stage 3: LookupTableColorConverter**
  - [ ] Remove hooks and template pattern
  - [ ] Handle abstract method removal
  - [ ] Update tests
  - [ ] Run regression tests

- [ ] **Stage 4: PDFContentStreamColorConverter**
  - [ ] Remove hooks and template pattern
  - [ ] Update tests
  - [ ] Run regression tests

- [ ] **Stage 5: PDFImageColorConverter**
  - [ ] Remove hooks and template pattern
  - [ ] Update tests
  - [ ] Run regression tests

- [ ] **Stage 6: PDFPageColorConverter**
  - [ ] Remove hooks and template pattern
  - [ ] Update tests
  - [ ] Run regression tests

- [ ] **Stage 7: PDFDocumentColorConverter**
  - [ ] Remove hooks and template pattern
  - [ ] Update tests
  - [ ] Run final regression tests

---

## Regression Testing Strategy

### Before Each Stage

```bash
# Capture baseline
cd testing/iso/ptf/2025/experiments/scripts

# 1. Run unit tests
yarn test

# 2. Run comparison script
node compare-implementations.js \
  "../../assets/testforms/2025-08-15 - ConRes - ISO PTF - CR1.pdf" \
  profiles/eciCMYK-v2.icc \
  --output-dir=../output/2026-01-26-baseline
```

### After Each Stage

```bash
# Verify no regressions
cd testing/iso/ptf/2025/experiments/scripts

# 1. Run unit tests
yarn test

# 2. Run comparison - output should match baseline hash
node compare-implementations.js \
  "../../assets/testforms/2025-08-15 - ConRes - ISO PTF - CR1.pdf" \
  profiles/eciCMYK-v2.icc \
  --output-dir=../output/2026-01-26-stage-N

# 3. Compare hashes
# Expected: Refactored hash should match baseline
```

### Full Regression Suite (After All Stages)

```bash
# Comprehensive verification
node matrix-benchmark.js \
  "../../assets/testforms/2025-08-15 - ConRes - ISO PTF - CR1.pdf" \
  profiles/eciCMYK-v2.icc \
  --output-dir=../output/2026-01-26-final

# Worker parity check
node compare-worker-vs-main.js
```

---

## Test File Changes Summary

| Test File | Tests to Remove | Tests to Modify | New Tests |
|-----------|-----------------|-----------------|-----------|
| ColorConverter.test.js | `invokeTemplateMethodTest` `invokeAbstractMethodThrowsTest` | None | None |
| ImageColorConverter.test.js | `invokeHookOrderTest` | None | None |
| LookupTableColorConverter.test.js | `invokeHookOrderTest` `invokeAbstractMethodThrowsTest` | None | None |
| PDFContentStreamColorConverter.test.js | `invokeHookOrderTest` | None | None |
| PDFImageColorConverter.test.js | `invokeHookOrderTest` | None | None |
| PDFPageColorConverter.test.js | `invokeHookOrderTest` | None | None |
| PDFDocumentColorConverter.test.js | `invokeHookOrderTest` | None | None |
| ColorConverterClasses.test.js | `invokeDocumentHookOrderTest` | Integration tests | None |

**Total Tests to Remove:** 9
**Total Tests to Modify:** ~5 integration tests

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Breaking existing functionality | Medium | High | Run regression tests after each stage |
| Missing hook functionality | Low | Medium | All hooks are no-ops - nothing to miss |
| Integration test failures | Medium | Medium | Update tests incrementally |
| Worker mode regression | Low | High | Run worker parity checks |

---

## Activity Log

### 2026-01-26

- **Initial** - Created planning document with 7 stages
- **Analysis** - Identified 23 methods to remove across 7 classes
- **Test Planning** - Documented test changes for each stage
- **Regression Strategy** - Defined regression testing approach using experiments/scripts

---

## Notes

### Why Remove Template Method Pattern?

1. **Unnecessary complexity** - All hooks are no-ops
2. **`doConvertColor` naming** - Unacceptable naming convention
3. **Abstract methods that throw** - Prefer compile-time checks over runtime errors
4. **Simplification** - Direct overrides are cleaner than template orchestration

### What Stays the Same?

1. **Class hierarchy** - Inheritance structure unchanged
2. **Public API** - `convertColor()` method signature unchanged
3. **Configuration management** - Per-reference overrides remain
4. **Worker support** - `prepareWorkerTask()` and `applyWorkerResult()` remain
5. **Business logic** - All actual conversion code unchanged
