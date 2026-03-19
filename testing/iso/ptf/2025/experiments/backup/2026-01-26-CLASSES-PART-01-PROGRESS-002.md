# Template Method Pattern Removal - PROGRESS

**Last Updated:** 2026-01-26
**Status:** Planning Phase (Refined)

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

## CRITICAL: Correct Refactoring Order

**The refactoring MUST proceed bottom-up (leaf classes first), not top-down.**

Starting with ColorConverter (the base class) would immediately break all subclasses because they call `super.beforeConvertColor()` and `super.afterConvertColor()`.

### Dependency-Safe Order

| Phase | Stage | Class                          | Rationale                                      |
| ----- | ----- | ------------------------------ | ---------------------------------------------- |
| 1     | 1     | PDFImageColorConverter         | Leaf class - no subclasses                     |
| 1     | 2     | PDFContentStreamColorConverter | Leaf class - no subclasses                     |
| 2     | 3     | ImageColorConverter            | Parent of Stage 1 - safe after leaf refactored |
| 2     | 4     | LookupTableColorConverter      | Parent of Stage 2 - safe after leaf refactored |
| 3     | 5     | PDFPageColorConverter          | Coordinator - depends on Stages 1-4            |
| 3     | 6     | PDFDocumentColorConverter      | Top-level coordinator                          |
| 4     | 7     | ColorConverter                 | Base class - change LAST                       |

### Parallelization Options

| Parallel Group | Classes                                                | Can Run Together?           |
| -------------- | ------------------------------------------------------ | --------------------------- |
| Phase 1        | PDFImageColorConverter, PDFContentStreamColorConverter | Yes                         |
| Phase 2        | ImageColorConverter, LookupTableColorConverter         | Yes (after Phase 1)         |
| Phase 3        | PDFPageColorConverter, PDFDocumentColorConverter       | Sequential (6 depends on 5) |
| Phase 4        | ColorConverter                                         | Last only                   |

---

## Template Method Pattern Inventory

### Methods to Remove

| Class                          | Hooks (before/after)                                                         | Template Override                                   | Abstract Methods       |
| ------------------------------ | ---------------------------------------------------------------------------- | --------------------------------------------------- | ---------------------- |
| ColorConverter                 | `beforeConvertColor()` `afterConvertColor()`                                 | `doConvertColor()` throws                           | `doConvertColor()`     |
| ImageColorConverter            | `beforeConvertImageColor()` `afterConvertImageColor()`                       | `doConvertColor()` → `convertImageColor()`          | None                   |
| LookupTableColorConverter      | `beforeConvertLookupTableColor()` `afterConvertLookupTableColor()`           | `doConvertColor()` → `convertLookupTableColor()`    | `convertSingleColor()` |
| PDFContentStreamColorConverter | `beforeConvertPDFContentStreamColor()` `afterConvertPDFContentStreamColor()` | `doConvertColor()` → `convertContentStreamColors()` | None                   |
| PDFImageColorConverter         | `beforeConvertPDFImageColor()` `afterConvertPDFImageColor()`                 | `doConvertColor()` → `convertPDFImageColor()`       | None                   |
| PDFPageColorConverter          | `beforeConvertPDFPageColor()` `afterConvertPDFPageColor()`                   | `doConvertColor()` → actual logic                   | None                   |
| PDFDocumentColorConverter      | `beforeConvertPDFDocumentColor()` `afterConvertPDFDocumentColor()`           | `doConvertColor()` → actual logic                   | None                   |

### Total Counts

| Item                               | Count  |
| ---------------------------------- | ------ |
| Hook methods to remove             | 14     |
| `doConvertColor()` implementations | 7      |
| Abstract methods that throw        | 2      |
| **Total methods to eliminate**     | **23** |

---

## Refactoring Stages (Dependency-Safe Order)

### Stage 1: PDFImageColorConverter (Leaf Class)

**Files:**
- [pdf-image-color-converter.js](../classes/pdf-image-color-converter.js) (lines 170-223)
- [PDFImageColorConverter.test.js](../tests/PDFImageColorConverter.test.js) (lines 129-215)

**Changes:**

| Change                                       | Location     | Before                  | After           |
| -------------------------------------------- | ------------ | ----------------------- | --------------- |
| Remove `beforeConvertPDFImageColor()`        | Line 170-172 | No-op hook              | Delete entirely |
| Remove `afterConvertPDFImageColor()`         | Line 182-184 | No-op hook              | Delete entirely |
| Remove `beforeConvertImageColor()` override  | Line 195-198 | Calls parent + PDF hook | Delete entirely |
| Remove `afterConvertImageColor()` override   | Line 206-209 | Calls PDF hook + parent | Delete entirely |
| Rename `doConvertColor()` → `convertColor()` | Line 221-223 | Delegates               | Direct override |

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

| Test                  | Action | Line Numbers | Reason              |
| --------------------- | ------ | ------------ | ------------------- |
| `invokeHookOrderTest` | Remove | 376-380      | Tests hook ordering |

**Regression Commands:**

```bash
# Before changes
yarn test
node testing/iso/ptf/2025/experiments/scripts/compare-implementations.js \
  "assets/testforms/2025-08-15 - ConRes - ISO PTF - CR1.pdf" \
  "testing/iso/ptf/fixtures/profiles/eciCMYK v2.icc" \
  --output-dir=testing/iso/ptf/2025/experiments/output/2026-01-26-001

# After changes - verify specific class
node --test testing/iso/ptf/2025/tests/PDFImageColorConverter.test.js
```

---

### Stage 2: PDFContentStreamColorConverter (Leaf Class)

**Files:**
- [pdf-content-stream-color-converter.js](../classes/pdf-content-stream-color-converter.js) (lines 237-290)
- [PDFContentStreamColorConverter.test.js](../tests/PDFContentStreamColorConverter.test.js) (lines 174-248)

**Changes:**

| Change                                            | Location     | Before                  | After           |
| ------------------------------------------------- | ------------ | ----------------------- | --------------- |
| Remove `beforeConvertPDFContentStreamColor()`     | Line 237-239 | No-op hook              | Delete entirely |
| Remove `afterConvertPDFContentStreamColor()`      | Line 249-251 | No-op hook              | Delete entirely |
| Remove `beforeConvertLookupTableColor()` override | Line 262-265 | Calls parent + PDF hook | Delete entirely |
| Remove `afterConvertLookupTableColor()` override  | Line 273-276 | Calls PDF hook + parent | Delete entirely |
| Rename `doConvertColor()` → `convertColor()`      | Line 288-290 | Delegates               | Direct override |

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

| Test                  | Action | Line Numbers | Reason              |
| --------------------- | ------ | ------------ | ------------------- |
| `invokeHookOrderTest` | Remove | 397-401      | Tests hook ordering |

**Tests That MUST Pass (Core Functionality):**

| Test                                | Line Numbers | Reason                  |
| ----------------------------------- | ------------ | ----------------------- |
| `invokeContentStreamParsingTest`    | 385-389      | Core parsing logic      |
| `invokeContentStreamRebuildingTest` | 391-395      | Core rebuild logic      |
| `invokeDecimalParsingTest`          | 415-419      | Edge case: `.95` format |

---

### Stage 3: ImageColorConverter (Mid-Tier Class)

**Prerequisite:** Stage 1 must be complete.

**Files:**
- [image-color-converter.js](../classes/image-color-converter.js) (lines 284-339)
- [ImageColorConverter.test.js](../tests/ImageColorConverter.test.js) (lines 167-234)

**Changes:**

| Change                                       | Location     | Before                    | After           |
| -------------------------------------------- | ------------ | ------------------------- | --------------- |
| Remove `beforeConvertImageColor()`           | Line 284-286 | No-op hook                | Delete entirely |
| Remove `afterConvertImageColor()`            | Line 298-300 | No-op hook                | Delete entirely |
| Remove `beforeConvertColor()` override       | Line 311-314 | Calls parent + image hook | Delete entirely |
| Remove `afterConvertColor()` override        | Line 322-325 | Calls image hook + parent | Delete entirely |
| Rename `doConvertColor()` → `convertColor()` | Line 337-339 | Delegates                 | Direct override |

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

| Test                  | Action | Line Numbers | Reason              |
| --------------------- | ------ | ------------ | ------------------- |
| `invokeHookOrderTest` | Remove | 364-368      | Tests hook ordering |

---

### Stage 4: LookupTableColorConverter (Mid-Tier Class)

**Prerequisite:** Stage 2 must be complete.

**Files:**
- [lookup-table-color-converter.js](../classes/lookup-table-color-converter.js) (lines 186-293)
- [LookupTableColorConverter.test.js](../tests/LookupTableColorConverter.test.js) (lines 332-412)

**Changes:**

| Change                                       | Location     | Before                     | After              |
| -------------------------------------------- | ------------ | -------------------------- | ------------------ |
| Remove `beforeConvertLookupTableColor()`     | Line 186-188 | No-op hook                 | Delete entirely    |
| Remove `afterConvertLookupTableColor()`      | Line 198-200 | No-op hook                 | Delete entirely    |
| Remove `beforeConvertColor()` override       | Line 211-214 | Calls parent + lookup hook | Delete entirely    |
| Remove `afterConvertColor()` override        | Line 222-225 | Calls lookup hook + parent | Delete entirely    |
| Rename `doConvertColor()` → `convertColor()` | Line 237-239 | Delegates                  | Direct override    |
| Remove abstract `convertSingleColor()`       | Line 291-293 | Throws error               | **SEE NOTE BELOW** |

**CRITICAL: `convertSingleColor()` Handling**

`convertSingleColor()` is called by `convertBatch()` (line 375) and `convertLookupTableColor()` (line 268). The abstract method MUST remain as a method signature - only remove the `throw` statement.

```javascript
// BEFORE
async convertSingleColor(input, context) {
    throw new Error('LookupTableColorConverter.convertSingleColor() is abstract');
}

// AFTER - Keep method signature, remove throw
async convertSingleColor(input, context) {
    // Subclass must implement
    throw new Error('convertSingleColor() must be implemented by subclass');
}
```

**Test Changes:**

| Test                             | Action | Line Numbers | Reason               |
| -------------------------------- | ------ | ------------ | -------------------- |
| `invokeHookOrderTest`            | Remove | 472-476      | Tests hook ordering  |
| `invokeAbstractMethodThrowsTest` | Remove | 478-482      | Tests abstract throw |

**Tests That MUST Pass (Core Functionality):**

| Test                            | Line Numbers | Reason               |
| ------------------------------- | ------------ | -------------------- |
| `invokeLookupTableCachingTest`  | 442-446      | Core caching logic   |
| `invokeBatchConversionTest`     | 448-452      | Batch cache behavior |
| `invokeCacheThresholdTest`      | 454-458      | Threshold logic      |
| `invokeClearLookupTableTest`    | 460-464      | Clear functionality  |
| `invokePopulateLookupTableTest` | 466-470      | Pre-population       |

---

### Stage 5: PDFPageColorConverter (Coordinator Class)

**Prerequisites:** Stages 1-4 must be complete.

**Files:**
- [pdf-page-color-converter.js](../classes/pdf-page-color-converter.js) (lines 251-432)
- [PDFPageColorConverter.test.js](../tests/PDFPageColorConverter.test.js) (lines 195-262)

**Changes:**

| Change                                       | Location     | Before                   | After           |
| -------------------------------------------- | ------------ | ------------------------ | --------------- |
| Remove `beforeConvertPDFPageColor()`         | Line 251-253 | No-op hook               | Delete entirely |
| Remove `afterConvertPDFPageColor()`          | Line 263-265 | No-op hook               | Delete entirely |
| Remove `beforeConvertColor()` override       | Line 276-279 | Calls parent + page hook | Delete entirely |
| Remove `afterConvertColor()` override        | Line 287-290 | Calls page hook + parent | Delete entirely |
| Rename `doConvertColor()` → `convertColor()` | Line 299     | Contains actual logic    | Keep logic      |

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

| Test                  | Action | Line Numbers | Reason              |
| --------------------- | ------ | ------------ | ------------------- |
| `invokeHookOrderTest` | Remove | 434-438      | Tests hook ordering |

**Tests That MUST Pass (Core Functionality):**

| Test                                      | Line Numbers | Reason                   |
| ----------------------------------------- | ------------ | ------------------------ |
| `invokeImageConfigDerivationTest`         | 416-420      | Configuration derivation |
| `invokeContentStreamConfigDerivationTest` | 422-426      | Configuration derivation |
| `invokeStandaloneWorkerPoolTest`          | 446-450      | Worker pool ownership    |
| `invokeSharedWorkerPoolTest`              | 452-456      | Shared pool behavior     |

---

### Stage 6: PDFDocumentColorConverter (Top-Level Coordinator)

**Prerequisites:** Stages 1-5 must be complete.

**Files:**
- [pdf-document-color-converter.js](../classes/pdf-document-color-converter.js) (lines 291-404)
- [PDFDocumentColorConverter.test.js](../tests/PDFDocumentColorConverter.test.js) (lines 312-376)

**Changes:**

| Change                                       | Location     | Before                  | After           |
| -------------------------------------------- | ------------ | ----------------------- | --------------- |
| Remove `beforeConvertPDFDocumentColor()`     | Line 291-293 | No-op hook              | Delete entirely |
| Remove `afterConvertPDFDocumentColor()`      | Line 303-305 | No-op hook              | Delete entirely |
| Remove `beforeConvertColor()` override       | Line 316-319 | Calls parent + doc hook | Delete entirely |
| Remove `afterConvertColor()` override        | Line 327-330 | Calls doc hook + parent | Delete entirely |
| Rename `doConvertColor()` → `convertColor()` | Line 339     | Contains actual logic   | Keep logic      |

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

| Test                  | Action | Line Numbers | Reason              |
| --------------------- | ------ | ------------ | ------------------- |
| `invokeHookOrderTest` | Remove | 571-575      | Tests hook ordering |

**Tests That MUST Pass (Core Functionality):**

| Test                               | Line Numbers | Reason                      |
| ---------------------------------- | ------------ | --------------------------- |
| `invokeProfilePoolIntegrationTest` | 535-539      | ProfilePool sharing         |
| `invokePageConfigDerivationTest`   | 547-551      | Config derivation chain     |
| `invokeWorkerPoolOwnershipTest`    | 583-587      | Shared pool non-termination |

---

### Stage 7: ColorConverter (Base Class)

**Prerequisites:** ALL previous stages must be complete.

**Files:**
- [color-converter.js](../classes/color-converter.js) (lines 194-243)
- [ColorConverter.test.js](../tests/ColorConverter.test.js) (lines 128-170)

**Changes:**

| Change                             | Location     | Before               | After           |
| ---------------------------------- | ------------ | -------------------- | --------------- |
| Simplify `convertColor()` template | Line 194-199 | Calls hooks in order | Single throw    |
| Remove `beforeConvertColor()`      | Line 214-216 | No-op hook           | Delete entirely |
| Remove `doConvertColor()`          | Line 229-231 | Abstract throws      | Delete entirely |
| Remove `afterConvertColor()`       | Line 243-245 | No-op hook           | Delete entirely |

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

| Test                             | Action | Line Numbers | Reason                                |
| -------------------------------- | ------ | ------------ | ------------------------------------- |
| `invokeTemplateMethodTest`       | Remove | 264-268      | Tests hook ordering - no longer valid |
| `invokeAbstractMethodThrowsTest` | Modify | 270-274      | Update error message expectation      |

---

## Refactoring Roadmap

- [ ] **Stage 1: PDFImageColorConverter** `PENDING`
  - [ ] Create backup
  - [ ] Run baseline tests
  - [ ] Remove hooks (lines 170-184, 195-209)
  - [ ] Rename `doConvertColor()` → `convertColor()` (line 221)
  - [ ] Update PDFImageColorConverter.test.js
  - [ ] Run regression tests
  - [ ] Verify no regressions

- [ ] **Stage 2: PDFContentStreamColorConverter** `PENDING`
  - [ ] Remove hooks and template pattern
  - [ ] Update tests
  - [ ] Run regression tests

- [ ] **Stage 3: ImageColorConverter** (after Stage 1)
  - [ ] Remove hooks and template pattern
  - [ ] Update tests
  - [ ] Run regression tests

- [ ] **Stage 4: LookupTableColorConverter** (after Stage 2)
  - [ ] Remove hooks (keep `convertSingleColor()` signature)
  - [ ] Update tests
  - [ ] Run regression tests

- [ ] **Stage 5: PDFPageColorConverter** (after Stages 1-4)
  - [ ] Remove hooks and template pattern
  - [ ] Add `await this.ready()` to `convertColor()`
  - [ ] Update tests
  - [ ] Run regression tests

- [ ] **Stage 6: PDFDocumentColorConverter** (after Stage 5)
  - [ ] Remove hooks and template pattern
  - [ ] Add `await this.ready()` to `convertColor()`
  - [ ] Update tests
  - [ ] Run regression tests

- [ ] **Stage 7: ColorConverter** (after ALL stages)
  - [ ] Remove hooks and template pattern
  - [ ] Update tests
  - [ ] Run final regression tests

---

## Regression Testing Strategy

### Baseline Capture (Run Once Before Starting)

```bash
cd /Users/daflair/Projects/conres/conres.io

# 1. Run all unit tests
yarn test

# 2. Capture hash baseline
node testing/iso/ptf/2025/experiments/scripts/compare-implementations.js \
  "assets/testforms/2025-08-15 - ConRes - ISO PTF - CR1.pdf" \
  "testing/iso/ptf/fixtures/profiles/eciCMYK v2.icc" \
  --output-dir=testing/iso/ptf/2025/experiments/output/2026-01-26-baseline \
  --keep-output
```

### After Each Stage

```bash
# 1. Unit tests for the specific class
node --test testing/iso/ptf/2025/tests/<ClassName>.test.js

# 2. Integration tests
node --test testing/iso/ptf/2025/tests/ColorConverterClasses.test.js

# 3. Comparison (output hash should match baseline)
node testing/iso/ptf/2025/experiments/scripts/compare-implementations.js \
  "assets/testforms/2025-08-15 - ConRes - ISO PTF - CR1.pdf" \
  "testing/iso/ptf/fixtures/profiles/eciCMYK v2.icc" \
  --output-dir=testing/iso/ptf/2025/experiments/output/2026-01-26-stage-N
```

### Final Verification (After All Stages)

```bash
# 1. Complete test suite
yarn test

# 2. Worker parity (CRITICAL)
node testing/iso/ptf/2025/experiments/scripts/compare-worker-vs-main.js

# 3. Full matrix benchmark
node 2025/experiments/scripts/generate-verification-matrix.mjs \
  "assets/testforms/2025-08-15 - ConRes - ISO PTF - CR1.pdf" \
  "testing/iso/ptf/fixtures/profiles/eciCMYK v2.icc" \
  --output-dir=testing/iso/ptf/2025/experiments/output/2026-01-26-final
```

---

## Test File Changes Summary

| Test File                              | Tests to Remove                                        | Tests to Modify | Line Numbers     |
| -------------------------------------- | ------------------------------------------------------ | --------------- | ---------------- |
| PDFImageColorConverter.test.js         | `invokeHookOrderTest`                                  | None            | 376-380          |
| PDFContentStreamColorConverter.test.js | `invokeHookOrderTest`                                  | None            | 397-401          |
| ImageColorConverter.test.js            | `invokeHookOrderTest`                                  | None            | 364-368          |
| LookupTableColorConverter.test.js      | `invokeHookOrderTest` `invokeAbstractMethodThrowsTest` | None            | 472-482          |
| PDFPageColorConverter.test.js          | `invokeHookOrderTest`                                  | None            | 434-438          |
| PDFDocumentColorConverter.test.js      | `invokeHookOrderTest`                                  | None            | 571-575          |
| ColorConverter.test.js                 | `invokeTemplateMethodTest`                             | Error message   | 264-268, 270-274 |
| ColorConverterClasses.test.js          | `invokeDocumentHookOrderTest`                          | Integration     | 1241-1245        |

**Total Tests to Remove:** 9
**Total Tests to Modify:** 2

---

## Hidden Dependencies to Watch

### Worker Mode Dependencies

| Class                          | Worker Method                   | Risk                                        |
| ------------------------------ | ------------------------------- | ------------------------------------------- |
| PDFImageColorConverter         | `prepareWorkerTask()` (437-462) | Uses `getEffectiveRenderingIntent()`        |
| PDFContentStreamColorConverter | `prepareWorkerTask()` (735-749) | Configuration getters                       |
| PDFPageColorConverter          | `applyWorkerResult()` (867-937) | Context passing: `context.pageWorkerResult` |

### Async Initialization Dependencies

| Class                          | Initialization Pattern             | Risk                                          |
| ------------------------------ | ---------------------------------- | --------------------------------------------- |
| PDFPageColorConverter          | `this.#ready = this.#initialize()` | Must `await this.ready()` in `convertColor()` |
| PDFDocumentColorConverter      | `this.#ready = this.#initialize()` | Must `await this.ready()` in `convertColor()` |
| ImageColorConverter            | `this.#ready = this.#initialize()` | Conditional initialization                    |
| PDFContentStreamColorConverter | `this.#ready = this.#initialize()` | Conditional initialization                    |

### Resource Cleanup Chain

Every `dispose()` method MUST call `super.dispose()` to clear reference overrides.

---

## Rollback Strategy

### Before Each Stage

```bash
# Create backup using MCP tool
mcp__protocol-enforcement__backup_files \
  --files='["testing/iso/ptf/2025/classes/<file>.js", "testing/iso/ptf/2025/tests/<file>.test.js"]' \
  --purpose="pre-stage-N-template-method-removal"
```

### If Stage Fails

```bash
# Restore from backup
mcp__protocol-enforcement__restore_from_backup \
  --backup_id="<backup-id>" \
  --conflict_resolution="overwrite"
```

---

## Risk Assessment

| Risk                             | Likelihood | Impact | Mitigation                           |
| -------------------------------- | ---------- | ------ | ------------------------------------ |
| Breaking subclass calls to super | High       | High   | Bottom-up order (leaf first)         |
| Worker mode regression           | Medium     | High   | Run `compare-worker-vs-main.js`      |
| Async initialization race        | Medium     | High   | Ensure `await this.ready()` added    |
| Missing dispose() super call     | Low        | Medium | Verify each dispose() implementation |
| Integration test failures        | Medium     | Medium | Update tests incrementally           |

---

## Activity Log

### 2026-01-26

- **09:00** - Created initial planning document with 7 stages
- **09:30** - Analyzed all 7 converter classes
- **10:00** - Identified 23 methods to remove
- **10:30** - Documented test changes for each stage
- **11:00** - **CRITICAL FIX**: Reversed refactoring order to bottom-up (leaf first)
- **11:30** - Added dependency analysis from subagent iteration
- **12:00** - Added test coverage gaps from subagent iteration
- **12:30** - Added risk mitigation strategy from subagent iteration
- **13:00** - Plan ready for user review

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
6. **`convertSingleColor()`** - Method signature stays (only `throw` removed)
