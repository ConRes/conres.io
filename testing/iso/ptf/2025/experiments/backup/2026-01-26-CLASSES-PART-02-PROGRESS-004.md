# 2026-01-26-CLASSES-PART-02-PROGRESS.md

Architectural refactoring for color converter classes - Part 02

**Last Updated:** 2026-01-26
**Status:** Planning Phase (Ready for Implementation)

---

## ⚠️ CRITICAL INSIGHTS FOR AGENT

**Read these points BEFORE proceeding. Missing any will cause failures.**

### 1. Execution Order is Non-Negotiable

**DO:** Phase 2 → Phase 3 → Phase 4 → Phase 5 (base class first, then leaf classes)

**DON'T:** Jump to any stage out of order

See: [CRITICAL: Correct Refactoring Order](#critical-correct-refactoring-order)

---

### 2. Stash Before Every Change

**BEFORE** making ANY edit, run the git stash command for that stage:

```bash
git stash push -m "2026-01-26-phase-X-stage-Y-ClassName" -- <files>
```

See: [Rollback Strategy > Stash Inventory](#stash-inventory)

---

### 3. Hidden Dependency: `convertSingleColor()` Chain

`convertSingleColor()` is called by TWO places:

- `LookupTableColorConverter.convertLookupTableColor()` line 229
- `PDFContentStreamColorConverter` overrides it

**Phase 4 Stage 7** cannot run until BOTH callers are updated. See: [Hidden Dependencies to Watch](#hidden-dependencies-to-watch)

---

### 4. Async Initialization Chain Must Be Unbroken

| Class                          | Current                  | After Refactor                                            |
| ------------------------------ | ------------------------ | --------------------------------------------------------- |
| ColorConverter                 | N/A                      | `this.#ready = this.#initialize()`, owns `ensureReady()`  |
| ImageColorConverter            | Owns `#ready`            | DELETE `#ready`, DELETE `ensureReady()` (inherits parent) |
| LookupTableColorConverter      | `ensureReady()` is no-op | **DELETE `ensureReady()`** (inherits parent via Stage 2.5)|
| PDFContentStreamColorConverter | Owns `#ready`            | DELETE `#ready`, DELETE `ensureReady()` (inherits parent) |

**Principle:** A no-op that only calls `super.method()` should NOT exist - JavaScript inheritance handles it.

**Class hierarchy (after refactor - only base has `ensureReady()`):**

```
ColorConverter (base) ← owns #ready, #initialize(), ensureReady(), #colorEngineService
  ├── ImageColorConverter ← inherits ensureReady() (no override)
  ├── LookupTableColorConverter ← inherits ensureReady() (no override)
  │     └── PDFContentStreamColorConverter ← inherits ensureReady() (no override)
  └── CompositeColorConverter ← owns #workerPool, workerPool getter (Phase 5)
        ├── PDFPageColorConverter ← inherits workerPool (no override)
        └── PDFDocumentColorConverter ← inherits workerPool (no override)
```

---

### 5. Verification After Every Stage

**Classes are tightly coupled - run ALL tests after EVERY stage:**

```bash
yarn test
```

**DO NOT proceed to next stage if ANY test fails.**

---

### 6. Forbidden Commands (User Feedback)

**DO NOT USE:**

- `compare-implementations.js`
- Any path containing `assets/testforms/`

**USE INSTEAD:**

```bash
node testing/iso/ptf/2025/experiments/scripts/generate-verification-matrix.mjs \
  --config=testing/iso/ptf/2025/experiments/configurations/2026-01-26-CLASSES-001.json
```

---

### 7. Private Field Access Pattern

**BEFORE (leaf class):**
```javascript
const service = this.#colorEngineService;
```

**AFTER (must use getter from parent):**
```javascript
const service = this.colorEngineService;
```

This change appears at:

- ImageColorConverter line 368
- PDFContentStreamColorConverter line 357

---

### 8. Phase Completion Checkpoints

| Phase            | Checkpoint Command                                                                                            |
| ---------------- | ------------------------------------------------------------------------------------------------------------- |
| Phase 2 complete | `grep -n "#colorEngineService" testing/iso/ptf/2025/classes/*.js` → Only in `color-converter.js`              |
| Phase 4 complete | `grep -n "throw new Error.*abstract" testing/iso/ptf/2025/classes/*.js` → No results                          |
| Phase 5 complete | `grep -n "#workerPool" testing/iso/ptf/2025/classes/*.js` → Only in `composite-color-converter.js`            |

---

### 9. Phase 5: CompositeColorConverter is a NEW FILE

**Stage 8 creates a new file** - no stash needed. Stages 9-10 modify existing files.

```
ColorConverter (base)
  └── CompositeColorConverter (NEW in Phase 5) ← owns #workerPool
        ├── PDFPageColorConverter ← remove #workerPool, extend new base
        └── PDFDocumentColorConverter ← remove #workerPool, extend new base
```

---

## Overview

This document tracks the architectural refactoring to:

1. Move ColorEngineService from leaf classes to `ColorConverter` base class
2. Restructure `LookupTableColorConverter` for SIMD batch conversion
3. Remove for loops that iterate arrays one color at a time
4. Remove abstract methods that throw
5. Introduce `CompositeColorConverter` intermediate class for WorkerPool management

---

## User Concerns (from Color-Engine-Integration-User-Notes.md)

| # | Concern | Status |
|---|---------|--------|
| 1 | ~~No "doConvertColor" naming~~ | ✅ DONE in PART-01 |
| 2 | No for loops for color conversions iterating arrays one by one | 🔄 This document |
| 3 | LookupTableColorConverter should provide base typed array operations | 🔄 This document |
| 4 | No throwing for unimplemented methods | 🔄 This document |
| 5 | Clean separation of concerns | 🔄 This document |
| 6 | Options and insights for redundancy | ✅ Analysis complete |

---

## Roadmap

- [x] Phase 1: Analysis and Decision Points
- [ ] Phase 2: Move ColorEngineService to ColorConverter base `PENDING`
- [ ] Phase 3: Restructure LookupTableColorConverter for SIMD `PENDING`
- [ ] Phase 4: Remove Abstract Throws `PENDING`
- [ ] Phase 5: Introduce CompositeColorConverter for WorkerPool `PENDING`
- [ ] Phase 6: Verify Separation of Concerns `PENDING`
- [ ] Phase 7: Final Regression Verification `PENDING`

---

## Current Status

**Current Focus:** Phase 4 Stage 7 - Completed (LookupTableColorConverter remove convertSingleColor)
**Last Updated:** 2026-01-26 (Phase 4 Stage 7 complete)

---

## User Decisions (Approved)

| ID | Decision | Chosen Option |
|----|----------|---------------|
| 1.2.A | ColorEngineService location | **A1**: Move to `ColorConverter` base class |
| 1.3.A | SIMD batch conversion | **B1**: Build TypedArray of unique colors, call engine once |
| 1.4.A | LookupTableColorConverter restructure | **C1**: Full restructure per expected architecture |
| 1.5.A | Abstract throws replacement | **D1+D2**: Make `convertColor()` concrete, remove `convertSingleColor()` |

---

## CRITICAL: Correct Refactoring Order

**The refactoring MUST proceed top-down (base class first), then leaf classes.**

Moving ColorEngineService to the base class first allows subclasses to use `this.colorEngineService` getter.

### Phase-Safe Order

| Phase | Stage | Class                          | Rationale                                                    |
| ----- | ----- | ------------------------------ | ------------------------------------------------------------ |
| 2     | 1     | ColorConverter                 | Add ColorEngineService infrastructure to base                |
| 2     | 2     | ImageColorConverter            | Remove duplicate ColorEngineService, use parent's            |
| 2     | 2.5   | LookupTableColorConverter      | **DELETE `ensureReady()` no-op** (inherits from parent)      |
| 2     | 3     | PDFContentStreamColorConverter | Remove duplicate ColorEngineService, use parent's            |
| 3     | 4     | LookupTableColorConverter      | Add SIMD batch conversion methods                            |
| 3     | 5     | PDFContentStreamColorConverter | Update to use new lookup table API                           |
| 4     | 6     | ColorConverter                 | Make `convertColor()` concrete                               |
| 4     | 7     | LookupTableColorConverter      | Remove `convertSingleColor()`                                |
| 5     | 8     | CompositeColorConverter        | **CREATE** new intermediate class with WorkerPool management |
| 5     | 9     | PDFPageColorConverter          | Remove duplicate WorkerPool, extend CompositeColorConverter  |
| 5     | 10    | PDFDocumentColorConverter      | Remove duplicate WorkerPool, extend CompositeColorConverter  |

### Parallelization Options

| Parallel Group      | Classes                                                     | Can Run Together?                   |
| ------------------- | ----------------------------------------------------------- | ----------------------------------- |
| Phase 2, Stage 2    | ImageColorConverter                                         | Yes (after Stage 1)                 |
| Phase 2, Stage 2.5  | LookupTableColorConverter                                   | Yes (after Stage 1, parallel to 2)  |
| Phase 2, Stage 3    | PDFContentStreamColorConverter                              | **After Stage 2.5** (inheritance)   |
| Phase 3, Stage 4-5  | LookupTableColorConverter, PDFContentStreamColorConverter   | Sequential (5 depends on 4)         |
| Phase 4, Stage 6-7  | ColorConverter, LookupTableColorConverter                   | Sequential                          |
| Phase 5, Stage 9-10 | PDFPageColorConverter, PDFDocumentColorConverter            | **After Stage 8** (new base class)  |

---

## Phase 2: Move ColorEngineService to ColorConverter Base

### Total Counts

| Item | Count |
|------|-------|
| Private fields to add to ColorConverter | 3 |
| Private fields to remove from subclasses | 6 (3 each) |
| Methods to add to ColorConverter | 3 |
| Methods to remove from subclasses | 2 |
| Methods to update in subclasses | 4 |
| **Total changes** | **18** |

---

### Stage 1: ColorConverter (Base Class)

**File:** [color-converter.js](../classes/color-converter.js) (404 lines)
**Test:** [ColorConverter.test.js](../tests/ColorConverter.test.js)

#### Changes

| Change | Location | Before | After |
|--------|----------|--------|-------|
| Add `#colorEngineService` field | After line 111 | N/A | New field |
| Add `#ownsColorEngineService` field | After line 111 | N/A | New field |
| Add `#ready` field | After line 111 | N/A | New field |
| Update constructor signature | Line 135 | `constructor(configuration)` | `constructor(configuration, options = {})` |
| Add constructor initialization | Line 136-137 | Single line | Multi-line with options handling |
| Add `#initialize()` method | After line 137 | N/A | New method |
| Add `ensureReady()` method | After line 137 | N/A | New method |
| Add `colorEngineService` getter | After line 154 | N/A | New getter |
| Add `convertColorsBuffer()` method | After line 199 | N/A | New method |
| Update `dispose()` | Line 375-378 | Clears overrides only | Also disposes ColorEngineService |

#### New Code: Private Fields (add after line 111)

```javascript
    /** @type {import('../services/ColorEngineService.js').ColorEngineService | null} */
    #colorEngineService = null;

    /** @type {boolean} */
    #ownsColorEngineService = false;

    /** @type {Promise<void>} */
    #ready;
```

#### New Code: Constructor (replace lines 135-137)

**BEFORE:**
```javascript
    constructor(configuration) {
        this.#configuration = Object.freeze({ ...configuration });
    }
```

**AFTER:**
```javascript
    /**
     * Creates a new ColorConverter instance.
     *
     * @param {ColorConverterConfiguration} configuration - Immutable configuration
     * @param {object} [options={}] - Additional options
     * @param {import('../services/ColorEngineService.js').ColorEngineService} [options.colorEngineService] - Shared ColorEngineService
     */
    constructor(configuration, options = {}) {
        this.#configuration = Object.freeze({ ...configuration });

        if (options.colorEngineService) {
            this.#colorEngineService = options.colorEngineService;
            this.#ownsColorEngineService = false;
            this.#ready = Promise.resolve();
        } else {
            this.#ready = this.#initialize();
        }
    }
```

#### New Code: Initialization Methods (add after constructor)

```javascript
    // ========================================
    // Initialization
    // ========================================

    /**
     * Initializes the ColorEngineService.
     * @returns {Promise<void>}
     */
    async #initialize() {
        // Dynamic import to avoid circular dependencies
        const { ColorEngineService } = await import('../services/ColorEngineService.js');
        this.#colorEngineService = new ColorEngineService();
        this.#ownsColorEngineService = true;
    }

    /**
     * Ensures the converter is ready for use.
     * @returns {Promise<void>}
     */
    async ensureReady() {
        await this.#ready;
    }
```

#### New Code: ColorEngineService Getter (add after `configuration` getter)

```javascript
    /**
     * Gets the ColorEngineService instance.
     * @returns {import('../services/ColorEngineService.js').ColorEngineService | null}
     */
    get colorEngineService() {
        return this.#colorEngineService;
    }
```

#### New Code: `convertColorsBuffer()` Method (add after `convertColor()`)

```javascript
    /**
     * Converts a buffer of color values using SIMD-optimized batch conversion.
     *
     * This is the core TypedArray-to-TypedArray conversion method that all
     * subclasses should use for efficient color conversion.
     *
     * @param {Uint8Array} inputBuffer - Input color values
     * @param {object} options - Conversion options
     * @param {string} options.inputColorSpace - Input color space ('RGB' | 'Gray' | 'Lab' | 'CMYK')
     * @param {string} options.outputColorSpace - Output color space ('RGB' | 'CMYK')
     * @param {ArrayBuffer | string} options.sourceProfile - Source ICC profile
     * @param {ArrayBuffer | string} [options.destinationProfile] - Destination ICC profile (uses config if not provided)
     * @param {import('./color-converter.js').RenderingIntent} [options.renderingIntent] - Rendering intent (uses config if not provided)
     * @param {boolean} [options.blackPointCompensation] - Enable BPC (uses config if not provided)
     * @returns {Promise<Uint8Array>} Converted color buffer
     */
    async convertColorsBuffer(inputBuffer, options) {
        await this.#ready;

        const service = this.#colorEngineService;
        if (!service) {
            throw new Error('ColorEngineService not initialized');
        }

        const config = this.configuration;
        const {
            inputColorSpace,
            outputColorSpace,
            sourceProfile,
            destinationProfile = config.destinationProfile,
            renderingIntent = config.renderingIntent,
            blackPointCompensation = config.blackPointCompensation,
        } = options;

        const result = await service.convertPixelBuffer(inputBuffer, {
            sourceProfile,
            destinationProfile,
            inputType: inputColorSpace,
            outputType: outputColorSpace,
            renderingIntent,
            blackPointCompensation,
            useAdaptiveBPCClamping: config.useAdaptiveBPCClamping,
        });

        return result.outputPixels;
    }
```

#### Updated Code: `dispose()` (replace lines 375-378)

**BEFORE:**
```javascript
    dispose() {
        this.#referenceOverrides.clear();
        this.#parentConverter = null;
    }
```

**AFTER:**
```javascript
    dispose() {
        if (this.#ownsColorEngineService && this.#colorEngineService) {
            this.#colorEngineService.dispose();
            this.#colorEngineService = null;
        }
        this.#referenceOverrides.clear();
        this.#parentConverter = null;
    }
```

#### Test Changes

| Test | Action | Line Numbers | Reason |
|------|--------|--------------|--------|
| `invokeEnsureReadyTest` | Add | N/A | Test new `ensureReady()` method |
| `invokeConvertColorsBufferTest` | Add | N/A | Test new buffer conversion |
| `invokeColorEngineServiceGetterTest` | Add | N/A | Test getter returns service |
| `invokeSharedColorEngineServiceTest` | Add | N/A | Test injection via options |

#### Verification Commands

```bash
# Before changes
git stash push -m "2026-01-26-phase-2-stage-1-ColorConverter" -- \
  testing/iso/ptf/2025/classes/color-converter.js \
  testing/iso/ptf/2025/tests/ColorConverter.test.js

# After changes - run ALL tests (classes are tightly coupled)
yarn test
```

---

### Stage 2: ImageColorConverter

**File:** [image-color-converter.js](../classes/image-color-converter.js) (473 lines)
**Test:** [ImageColorConverter.test.js](../tests/ImageColorConverter.test.js)

#### Changes

| Change | Location | Before | After |
|--------|----------|--------|-------|
| Remove `#colorEngineService` field | Lines 172-173 | Field declaration | Delete |
| Remove `#ownsColorEngineService` field | Lines 175-176 | Field declaration | Delete |
| Remove `#ready` field | Lines 178-179 | Field declaration | Delete |
| Update constructor | Lines 192-202 | Conditional initialization | Remove ColorEngineService handling |
| Remove `#initialize()` method | Lines 212-217 | Full method | Delete |
| **Delete `ensureReady()` method** | Lines 220-225 | Overridden method | Delete (inherit from parent) |
| Update `#transformPixels()` | Line 368 | `this.#colorEngineService` | `this.colorEngineService` |
| Update `dispose()` | Lines 465-471 | ColorEngineService cleanup | Remove cleanup, keep `super.dispose()` |

#### Code to Remove: Private Fields (delete lines 172-179)

**DELETE:**
```javascript
    /** @type {import('../services/ColorEngineService.js').ColorEngineService | null} */
    #colorEngineService = null;

    /** @type {boolean} */
    #ownsColorEngineService = false;

    /** @type {Promise<void>} */
    #ready;
```

#### Updated Code: Constructor (replace lines 192-202)

**BEFORE:**
```javascript
    constructor(configuration, options = {}) {
        super(configuration);

        if (options.colorEngineService) {
            this.#colorEngineService = options.colorEngineService;
            this.#ownsColorEngineService = false;
            this.#ready = Promise.resolve();
        } else {
            this.#ready = this.#initialize();
        }
    }
```

**AFTER:**
```javascript
    /**
     * Creates a new ImageColorConverter instance.
     *
     * @param {ImageColorConverterConfiguration} configuration - Immutable configuration
     * @param {object} [options={}] - Additional options
     * @param {import('../services/ColorEngineService.js').ColorEngineService} [options.colorEngineService] - Shared ColorEngineService
     */
    constructor(configuration, options = {}) {
        super(configuration, options);
    }
```

#### Code to Remove: `#initialize()` Method (delete lines 212-217)

**DELETE:**
```javascript
    async #initialize() {
        // Dynamic import to avoid circular dependencies
        const { ColorEngineService } = await import('../services/ColorEngineService.js');
        this.#colorEngineService = new ColorEngineService();
        this.#ownsColorEngineService = true;
    }
```

#### Code to Delete: `ensureReady()` (delete lines 220-225)

**DELETE entire method (inherit from parent instead):**
```javascript
    /**
     * Ensures the converter is ready for use.
     * @returns {Promise<void>}
     */
    async ensureReady() {
        await this.#ready;
    }
```

#### Updated Code: `#transformPixels()` (update line 368)

**BEFORE (line 368):**
```javascript
        const service = this.#colorEngineService;
```

**AFTER:**
```javascript
        const service = this.colorEngineService;
```

#### Updated Code: `dispose()` (replace lines 465-471)

**BEFORE:**
```javascript
    dispose() {
        if (this.#ownsColorEngineService && this.#colorEngineService) {
            this.#colorEngineService.dispose();
            this.#colorEngineService = null;
        }
        super.dispose();
    }
```

**AFTER:**
```javascript
    /**
     * @override
     */
    dispose() {
        super.dispose();
    }
```

#### Test Changes

| Test | Action | Line Numbers | Reason |
|------|--------|--------------|--------|
| `invokeSharedColorEngineServiceTest` | Update | TBD | Test inherits from parent |
| `invokeEnsureReadyTest` | Update | TBD | Test delegates to parent |

#### Verification Commands

```bash
# Before changes
git stash push -m "2026-01-26-phase-2-stage-2-ImageColorConverter" -- \
  testing/iso/ptf/2025/classes/image-color-converter.js \
  testing/iso/ptf/2025/tests/ImageColorConverter.test.js

# After changes - run ALL tests (classes are tightly coupled)
yarn test
```

---

### Stage 2.5: LookupTableColorConverter (ensureReady removal)

**File:** [lookup-table-color-converter.js](../classes/lookup-table-color-converter.js) (395 lines)
**Test:** [LookupTableColorConverter.test.js](../tests/LookupTableColorConverter.test.js)

**Rationale:** LookupTableColorConverter has a no-op `ensureReady()` that breaks the initialization chain. Deleting it allows PDFContentStreamColorConverter to inherit directly from ColorConverter's `ensureReady()`.

#### Changes

| Change                           | Location      | Before       | After                        |
| -------------------------------- | ------------- | ------------ | ---------------------------- |
| **Delete `ensureReady()` no-op** | Lines 191-200 | Empty method | Delete (inherit from parent) |

#### Code to Delete: `ensureReady()` (delete lines 191-200)

**DELETE entire method:**
```javascript
    /**
     * Ensures the converter is ready for use.
     *
     * Override in subclasses to perform async initialization.
     *
     * @returns {Promise<void>}
     */
    async ensureReady() {
        // Default: no-op. Subclasses override for initialization.
    }
```

#### Verification Commands

```bash
# Before changes
git stash push -m "2026-01-26-phase-2-stage-2.5-LookupTableColorConverter-ensureReady" -- \
  testing/iso/ptf/2025/classes/lookup-table-color-converter.js \
  testing/iso/ptf/2025/tests/LookupTableColorConverter.test.js

# After changes - run ALL tests (classes are tightly coupled)
yarn test
```

---

### Stage 3: PDFContentStreamColorConverter

**File:** [pdf-content-stream-color-converter.js](../classes/pdf-content-stream-color-converter.js) (758 lines)
**Test:** [PDFContentStreamColorConverter.test.js](../tests/PDFContentStreamColorConverter.test.js)

#### Changes

| Change | Location | Before | After |
|--------|----------|--------|-------|
| Remove `#colorEngineService` field | Lines 144-145 | Field declaration | Delete |
| Remove `#ownsColorEngineService` field | Lines 147-148 | Field declaration | Delete |
| Remove `#ready` field | Lines 150-151 | Field declaration | Delete |
| Update constructor | Lines 164-174 | Conditional initialization | Remove ColorEngineService handling |
| Remove `#initialize()` method | Lines 184-188 | Full method | Delete |
| **Delete `ensureReady()` method** | Lines 191-196 | Overridden method | Delete (inherit from parent) |
| Update `convertSingleColor()` | Line 357 | `this.#colorEngineService` | `this.colorEngineService` |
| Update `dispose()` | Lines 750-756 | ColorEngineService cleanup | Remove cleanup, keep `super.dispose()` |

#### Code to Remove: Private Fields (delete lines 144-151)

**DELETE:**
```javascript
    /** @type {import('../services/ColorEngineService.js').ColorEngineService | null} */
    #colorEngineService = null;

    /** @type {boolean} */
    #ownsColorEngineService = false;

    /** @type {Promise<void>} */
    #ready;
```

#### Updated Code: Constructor (replace lines 164-174)

**BEFORE:**
```javascript
    constructor(configuration, options = {}) {
        super(configuration);

        if (options.colorEngineService) {
            this.#colorEngineService = options.colorEngineService;
            this.#ownsColorEngineService = false;
            this.#ready = Promise.resolve();
        } else {
            this.#ready = this.#initialize();
        }
    }
```

**AFTER:**
```javascript
    /**
     * Creates a new PDFContentStreamColorConverter instance.
     *
     * @param {PDFContentStreamColorConverterConfiguration} configuration - Immutable configuration
     * @param {object} [options={}] - Additional options
     * @param {import('../services/ColorEngineService.js').ColorEngineService} [options.colorEngineService] - Shared service
     */
    constructor(configuration, options = {}) {
        super(configuration, options);
    }
```

#### Code to Remove: `#initialize()` Method (delete lines 184-188)

**DELETE:**
```javascript
    async #initialize() {
        const { ColorEngineService } = await import('../services/ColorEngineService.js');
        this.#colorEngineService = new ColorEngineService();
        this.#ownsColorEngineService = true;
    }
```

#### Code to Delete: `ensureReady()` (delete lines 191-196)

**DELETE entire method (inherit from parent instead):**
```javascript
    /**
     * @override
     */
    async ensureReady() {
        await this.#ready;
    }
```

#### Updated Code: `convertSingleColor()` (update line 357)

**BEFORE (line 357):**
```javascript
        const service = this.#colorEngineService;
```

**AFTER:**
```javascript
        const service = this.colorEngineService;
```

#### Updated Code: `dispose()` (replace lines 750-756)

**BEFORE:**
```javascript
    dispose() {
        if (this.#ownsColorEngineService && this.#colorEngineService) {
            this.#colorEngineService.dispose();
            this.#colorEngineService = null;
        }
        super.dispose();
    }
```

**AFTER:**
```javascript
    /**
     * @override
     */
    dispose() {
        super.dispose();
    }
```

#### Test Changes

| Test | Action | Line Numbers | Reason |
|------|--------|--------------|--------|
| `invokeSharedColorEngineServiceTest` | Update | TBD | Test inherits from parent via LookupTable |
| `invokeEnsureReadyTest` | Update | TBD | Test delegates to parent |

#### Verification Commands

```bash
# Before changes
git stash push -m "2026-01-26-phase-2-stage-3-PDFContentStreamColorConverter" -- \
  testing/iso/ptf/2025/classes/pdf-content-stream-color-converter.js \
  testing/iso/ptf/2025/tests/PDFContentStreamColorConverter.test.js

# After changes - run ALL tests (classes are tightly coupled)
yarn test
```

---

### Phase 2 Verification

After completing all 3 stages:

```bash
# Run full test suite
yarn test

# Run verification matrix
node testing/iso/ptf/2025/experiments/scripts/generate-verification-matrix.mjs \
  --config=testing/iso/ptf/2025/experiments/configurations/2026-01-26-CLASSES-001.json
```

---

## Phase 3: Restructure LookupTableColorConverter for SIMD

### Total Counts

| Item | Count |
|------|-------|
| Methods to add to LookupTableColorConverter | 2 |
| Methods to update in LookupTableColorConverter | 2 |
| Methods to update in PDFContentStreamColorConverter | 1 |
| **Total changes** | **5** |

---

### Stage 4: LookupTableColorConverter

**File:** [lookup-table-color-converter.js](../classes/lookup-table-color-converter.js) (395 lines)
**Test:** [LookupTableColorConverter.test.js](../tests/LookupTableColorConverter.test.js)

#### Changes

| Change | Location | Before | After |
|--------|----------|--------|-------|
| Add `buildLookupTable()` method | After line 243 | N/A | New method |
| Add `applyLookupTable()` method | After line 243 | N/A | New method |
| Update `convertBatchUncached()` | Lines 332-340 | For loop calling `convertSingleColor` | Single SIMD call to parent's `convertColorsBuffer()` |
| Keep `convertSingleColor()` for now | Lines 252-254 | Abstract throw | Keep for backward compatibility (remove in Phase 4) |

#### Problematic Code to Replace: `convertBatchUncached()` (lines 332-340)

**BEFORE:**
```javascript
    async convertBatchUncached(inputs, context) {
        // Default: convert one at a time
        const results = [];
        for (const input of inputs) {
            const values = await this.convertSingleColor(input, context);
            results.push(values);
        }
        return results;
    }
```

**AFTER:**
```javascript
    /**
     * Converts uncached colors in batch using SIMD-optimized buffer conversion.
     *
     * @param {LookupTableColorConverterInput[]} inputs - Uncached colors
     * @param {import('./color-converter.js').ColorConverterContext} context - Conversion context
     * @returns {Promise<number[][]>} Converted color values
     */
    async convertBatchUncached(inputs, context) {
        if (inputs.length === 0) {
            return [];
        }

        // Group inputs by color space for efficient batch processing
        const byColorSpace = new Map();
        for (let i = 0; i < inputs.length; i++) {
            const input = inputs[i];
            const key = input.colorSpace;
            if (!byColorSpace.has(key)) {
                byColorSpace.set(key, []);
            }
            byColorSpace.get(key).push({ index: i, input });
        }

        // Process each color space group with single SIMD call
        const results = new Array(inputs.length);

        for (const [colorSpace, group] of byColorSpace) {
            const converted = await this.#convertColorSpaceGroup(colorSpace, group, context);
            for (let i = 0; i < group.length; i++) {
                results[group[i].index] = converted[i];
            }
        }

        return results;
    }

    /**
     * Converts a group of colors with the same color space.
     *
     * @param {'RGB' | 'Gray' | 'Lab'} colorSpace
     * @param {Array<{index: number, input: LookupTableColorConverterInput}>} group
     * @param {import('./color-converter.js').ColorConverterContext} context
     * @returns {Promise<number[][]>}
     */
    async #convertColorSpaceGroup(colorSpace, group, context) {
        const config = this.configuration;
        const inputChannels = colorSpace === 'Gray' ? 1 : 3;
        const outputChannels = config.destinationColorSpace === 'CMYK' ? 4 : 3;

        // Pack all colors into a single TypedArray
        const inputBuffer = new Uint8Array(group.length * inputChannels);
        for (let i = 0; i < group.length; i++) {
            const values = group[i].input.values;
            for (let c = 0; c < inputChannels; c++) {
                // Convert from 0-1 to 0-255 for RGB, keep as-is for Gray
                inputBuffer[i * inputChannels + c] = colorSpace === 'RGB'
                    ? Math.round(values[c] * 255)
                    : Math.round(values[c] * 255);
            }
        }

        // Determine source profile
        const sourceProfile = colorSpace === 'RGB' ? 'sRGB'
            : colorSpace === 'Lab' ? 'Lab'
            : 'sGray';

        // Single SIMD call to parent's convertColorsBuffer
        const outputBuffer = await this.convertColorsBuffer(inputBuffer, {
            inputColorSpace: colorSpace,
            outputColorSpace: config.destinationColorSpace,
            sourceProfile,
        });

        // Unpack results
        const results = [];
        for (let i = 0; i < group.length; i++) {
            const values = [];
            for (let c = 0; c < outputChannels; c++) {
                // Convert from 0-255 back to 0-1 for PDF
                values.push(outputBuffer[i * outputChannels + c] / 255);
            }
            results.push(values);
        }

        return results;
    }
```

#### New Code: `buildLookupTable()` Method

```javascript
    /**
     * Builds a lookup table from unique colors using SIMD batch conversion.
     *
     * @param {LookupTableColorConverterInput[]} uniqueColors - Unique colors to convert
     * @param {import('./color-converter.js').ColorConverterContext} [context={}] - Conversion context
     * @returns {Promise<Map<string, number[]>>} Lookup table mapping color keys to converted values
     */
    async buildLookupTable(uniqueColors, context = {}) {
        await this.ensureReady();

        if (uniqueColors.length === 0) {
            return new Map();
        }

        // Convert all unique colors in one batch
        const batchResults = await this.convertBatchUncached(uniqueColors, context);

        // Build lookup table
        const lookupTable = new Map();
        for (let i = 0; i < uniqueColors.length; i++) {
            const input = uniqueColors[i];
            const key = this.#generateColorKey(input.colorSpace, input.values);
            lookupTable.set(key, batchResults[i]);
        }

        // Optionally merge into instance cache
        if (this.useLookupTable) {
            for (const [key, values] of lookupTable) {
                this.#lookupTable.set(key, values);
            }
        }

        return lookupTable;
    }
```

#### New Code: `applyLookupTable()` Method

```javascript
    /**
     * Applies a lookup table to get converted color values.
     *
     * @param {Map<string, number[]>} lookupTable - Lookup table from buildLookupTable()
     * @param {LookupTableColorConverterInput} input - Color to look up
     * @returns {number[] | undefined} Converted values or undefined if not found
     */
    applyLookupTable(lookupTable, input) {
        const key = this.#generateColorKey(input.colorSpace, input.values);
        return lookupTable.get(key) ?? this.#lookupTable.get(key);
    }
```

#### Test Changes

| Test | Action | Line Numbers | Reason |
|------|--------|--------------|--------|
| `invokeBuildLookupTableTest` | Add | N/A | Test new SIMD batch method |
| `invokeApplyLookupTableTest` | Add | N/A | Test lookup application |
| `invokeSIMDBatchConversionTest` | Add | N/A | Test SIMD is used for batch |

#### Verification Commands

```bash
# Before changes
git stash push -m "2026-01-26-phase-3-stage-4-LookupTableColorConverter" -- \
  testing/iso/ptf/2025/classes/lookup-table-color-converter.js \
  testing/iso/ptf/2025/tests/LookupTableColorConverter.test.js

# After changes - run ALL tests (classes are tightly coupled)
yarn test
```

---

### Stage 5: PDFContentStreamColorConverter (Update for New Lookup Table API)

**File:** [pdf-content-stream-color-converter.js](../classes/pdf-content-stream-color-converter.js)

#### Changes

| Change | Location | Before | After |
|--------|----------|--------|-------|
| Update `convertContentStreamColors()` | Lines 249-342 | Uses `convertBatch()` | Use `buildLookupTable()` + `applyLookupTable()` |

#### Updated Code: `convertContentStreamColors()` (update lines 296-319)

**BEFORE:**
```javascript
        // Convert colors using lookup table
        const lookupInputs = toConvert.map(op => {
            // ... mapping logic ...
        });

        const lookupResults = await this.convertBatch(lookupInputs, context);
```

**AFTER:**
```javascript
        // Extract unique colors for efficient batch conversion
        const lookupInputs = toConvert.map(op => {
            // ... mapping logic unchanged ...
        });

        // Build lookup table with single SIMD batch call
        const uniqueInputs = this.#deduplicateInputs(lookupInputs);
        const lookupTable = await this.buildLookupTable(uniqueInputs, context);

        // Apply lookup table to all operations
        const lookupResults = lookupInputs.map(input => {
            const converted = this.applyLookupTable(lookupTable, input);
            return {
                colorSpace: this.configuration.destinationColorSpace,
                values: converted ?? [],
                cacheHit: this.#lookupTable.has(this.#generateColorKey(input.colorSpace, input.values)),
            };
        });
```

#### New Helper Method to Add

```javascript
    /**
     * Deduplicates color inputs for efficient batch conversion.
     *
     * @param {import('./lookup-table-color-converter.js').LookupTableColorConverterInput[]} inputs
     * @returns {import('./lookup-table-color-converter.js').LookupTableColorConverterInput[]}
     */
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

#### Verification Commands

```bash
# Before changes
git stash push -m "2026-01-26-phase-3-stage-5-PDFContentStreamColorConverter-lookup" -- \
  testing/iso/ptf/2025/classes/pdf-content-stream-color-converter.js \
  testing/iso/ptf/2025/tests/PDFContentStreamColorConverter.test.js

# After changes - run ALL tests (classes are tightly coupled)
yarn test
```

---

### Phase 3 Verification

```bash
# Run full test suite
yarn test

# Run verification matrix
node testing/iso/ptf/2025/experiments/scripts/generate-verification-matrix.mjs \
  --config=testing/iso/ptf/2025/experiments/configurations/2026-01-26-CLASSES-001.json
```

---

## Phase 4: Remove Abstract Throws

### Total Counts

| Item | Count |
|------|-------|
| Abstract throws to remove | 2 |
| Methods to make concrete | 1 |
| **Total changes** | **3** |

---

### Stage 6: ColorConverter - Make `convertColor()` Concrete

**File:** [color-converter.js](../classes/color-converter.js)

#### Changes

| Change | Location | Before | After |
|--------|----------|--------|-------|
| Make `convertColor()` concrete | Lines 197-199 | Throws error | Calls `convertColorsBuffer()` |

#### Updated Code: `convertColor()` (replace lines 197-199)

**BEFORE:**
```javascript
    async convertColor(input, context = {}) {
        throw new Error('ColorConverter.convertColor() is abstract and must be overridden by subclass');
    }
```

**AFTER:**
```javascript
    /**
     * Performs color conversion on the input data.
     *
     * Base implementation converts a buffer of colors using ColorEngineService.
     * Subclasses may override for specialized behavior.
     *
     * @param {ColorConverterInput} input - Data to convert (must include inputBuffer, inputColorSpace)
     * @param {ColorConverterContext} [context={}] - Optional conversion context
     * @returns {Promise<ColorConverterResult>} Conversion result
     */
    async convertColor(input, context = {}) {
        await this.ensureReady();

        const { inputBuffer, inputColorSpace, outputColorSpace } = input;
        const config = this.configuration;

        if (!inputBuffer || !inputColorSpace) {
            throw new Error('ColorConverter.convertColor() requires inputBuffer and inputColorSpace');
        }

        const outputBuffer = await this.convertColorsBuffer(inputBuffer, {
            inputColorSpace,
            outputColorSpace: outputColorSpace ?? config.destinationColorSpace,
            sourceProfile: input.sourceProfile ?? 'sRGB',
        });

        return {
            outputBuffer,
            outputColorSpace: outputColorSpace ?? config.destinationColorSpace,
        };
    }
```

#### Test Changes

| Test | Action | Line Numbers | Reason |
|------|--------|--------------|--------|
| `invokeAbstractMethodThrowsTest` | Remove | TBD | No longer throws |
| `invokeConcreteConvertColorTest` | Add | N/A | Test concrete implementation |

#### Verification Commands

```bash
# Before changes
git stash push -m "2026-01-26-phase-4-stage-6-ColorConverter-concrete" -- \
  testing/iso/ptf/2025/classes/color-converter.js \
  testing/iso/ptf/2025/tests/ColorConverter.test.js

# After changes - run ALL tests (classes are tightly coupled)
yarn test
```

---

### Stage 7: LookupTableColorConverter - Remove `convertSingleColor()`

**File:** [lookup-table-color-converter.js](../classes/lookup-table-color-converter.js)

#### Changes

| Change | Location | Before | After |
|--------|----------|--------|-------|
| Remove `convertSingleColor()` | Lines 252-254 | Abstract throw | Delete method |
| Update `convertLookupTableColor()` | Line 229 | Calls `convertSingleColor()` | Use `buildLookupTable()` for single color |

#### Code to Remove: `convertSingleColor()` (delete lines 245-254)

**DELETE:**
```javascript
    /**
     * Converts a single color value (abstract - subclasses must implement).
     *
     * @param {LookupTableColorConverterInput} input - Color to convert
     * @param {import('./color-converter.js').ColorConverterContext} context - Conversion context
     * @returns {Promise<number[]>} Converted color values
     */
    async convertSingleColor(input, context) {
        throw new Error('LookupTableColorConverter.convertSingleColor() is abstract and must be overridden');
    }
```

#### Updated Code: `convertLookupTableColor()` (update line 229)

**BEFORE:**
```javascript
        // Perform actual conversion
        const convertedValues = await this.convertSingleColor(input, context);
```

**AFTER:**
```javascript
        // Perform actual conversion using batch method (single item batch)
        const [convertedValues] = await this.convertBatchUncached([input], context);
```

#### Test Changes

| Test | Action | Line Numbers | Reason |
|------|--------|--------------|--------|
| `invokeAbstractMethodThrowsTest` | Remove | TBD | Method removed |
| `invokeConvertSingleColorTest` | Remove | TBD | Method no longer exists |

#### Verification Commands

```bash
# Before changes
git stash push -m "2026-01-26-phase-4-stage-7-LookupTableColorConverter-remove-single" -- \
  testing/iso/ptf/2025/classes/lookup-table-color-converter.js \
  testing/iso/ptf/2025/tests/LookupTableColorConverter.test.js

# After changes - run ALL tests (classes are tightly coupled)
yarn test
```

---

### Phase 4 Verification

```bash
# Run full test suite
yarn test

# Verify no throws remain
grep -rn "throw new Error.*abstract" testing/iso/ptf/2025/classes/
# Expected: No results
```

---

## Phase 5: Introduce CompositeColorConverter

### Rationale

`PDFDocumentColorConverter` and `PDFPageColorConverter` both have **identical** WorkerPool management code:

| Duplicated Code           | PDFDocumentColorConverter | PDFPageColorConverter |
| ------------------------- | ------------------------- | --------------------- |
| `#workerPool` field       | Lines 77-78               | Lines 82-83           |
| `#ownsWorkerPool` field   | Lines 83-84               | Lines 85-86           |
| `workerPool` getter       | Lines 188-189             | Lines 162-163         |
| Initialization logic      | Lines 131-144             | Lines 114-128         |
| Dispose cleanup           | Lines 974-977             | Lines 910-913         |

This is the **same pattern** we're fixing for ColorEngineService in Phase 2.

### Solution: CompositeColorConverter

Create an intermediate base class that:

- Inherits from `ColorConverter`
- Owns WorkerPool lifecycle management
- Provides `workerPool` getter for subclasses
- Follows the same ownership pattern (own vs. shared)

### Total Counts

| Item | Count |
|------|-------|
| New file to create | 1 (`composite-color-converter.js`) |
| Private fields to add to CompositeColorConverter | 2 |
| Methods to add to CompositeColorConverter | 2 |
| Private fields to remove from subclasses | 4 (2 each) |
| Methods to update in subclasses | 4 (2 each) |
| **Total changes** | **13** |

---

### Stage 8: CompositeColorConverter (New File)

**File:** [composite-color-converter.js](../classes/composite-color-converter.js) (NEW)
**Test:** [CompositeColorConverter.test.js](../tests/CompositeColorConverter.test.js) (NEW)

#### New File Content

```javascript
// @ts-check
/**
 * Composite Color Converter
 *
 * Intermediate base class for converters that coordinate multiple child
 * conversion operations. Manages WorkerPool lifecycle with ownership semantics.
 *
 * @module CompositeColorConverter
 */

import { ColorConverter } from './color-converter.js';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Configuration for CompositeColorConverter.
 *
 * @typedef {import('./color-converter.js').ColorConverterConfiguration & {
 *   useWorkers?: boolean,
 *   workerPool?: import('../services/WorkerPool.js').WorkerPool,
 *   colorEnginePath?: string,
 * }} CompositeColorConverterConfiguration
 */

// ============================================================================
// CompositeColorConverter Class
// ============================================================================

/**
 * Base class for converters that coordinate multiple child conversions.
 *
 * Manages WorkerPool lifecycle with ownership semantics:
 * - If `workerPool` is provided in config, uses shared pool (does not own)
 * - If `useWorkers` is true and no pool provided, creates and owns pool
 *
 * Subclasses (PDFDocumentColorConverter, PDFPageColorConverter) inherit
 * WorkerPool management instead of duplicating it.
 *
 * @extends ColorConverter
 * @example
 * ```javascript
 * class PDFPageColorConverter extends CompositeColorConverter {
 *     async convertColor(input, context) {
 *         await this.ensureReady();
 *         const pool = this.workerPool; // Access inherited pool
 *         // ... coordinate child conversions
 *     }
 * }
 * ```
 */
export class CompositeColorConverter extends ColorConverter {
    // ========================================
    // Private Fields
    // ========================================

    /** @type {import('../services/WorkerPool.js').WorkerPool | null} */
    #workerPool = null;

    /** @type {boolean} */
    #ownsWorkerPool = false;

    /** @type {Promise<void>} */
    #compositeReady;

    // ========================================
    // Constructor
    // ========================================

    /**
     * Creates a new CompositeColorConverter instance.
     *
     * @param {CompositeColorConverterConfiguration} configuration - Immutable configuration
     * @param {object} [options={}] - Additional options
     * @param {import('../services/ColorEngineService.js').ColorEngineService} [options.colorEngineService] - Shared service
     */
    constructor(configuration, options = {}) {
        super(configuration, options);
        this.#compositeReady = this.#initializeWorkerPool();
    }

    // ========================================
    // WorkerPool Initialization
    // ========================================

    /**
     * Initializes the WorkerPool if configured.
     * @returns {Promise<void>}
     */
    async #initializeWorkerPool() {
        // Wait for parent initialization first
        await super.ensureReady();

        const config = /** @type {CompositeColorConverterConfiguration} */ (this.configuration);

        if (config.useWorkers) {
            if (config.workerPool) {
                // Use provided pool (from parent converter)
                this.#workerPool = config.workerPool;
                this.#ownsWorkerPool = false;
            } else {
                // Create own pool
                const { WorkerPool } = await import('../services/WorkerPool.js');
                this.#workerPool = new WorkerPool({
                    colorEnginePath: config.colorEnginePath,
                });
                await this.#workerPool.initialize();
                this.#ownsWorkerPool = true;
            }
        }
    }

    /**
     * Ensures the converter is ready for use.
     * Overrides parent to include WorkerPool initialization.
     * @returns {Promise<void>}
     */
    async ensureReady() {
        await this.#compositeReady;
    }

    // ========================================
    // WorkerPool Access
    // ========================================

    /**
     * Gets the configuration as CompositeColorConverterConfiguration.
     * @returns {Readonly<CompositeColorConverterConfiguration>}
     */
    get configuration() {
        return /** @type {Readonly<CompositeColorConverterConfiguration>} */ (super.configuration);
    }

    /**
     * Gets the WorkerPool instance.
     * @returns {import('../services/WorkerPool.js').WorkerPool | null}
     */
    get workerPool() {
        return this.#workerPool;
    }

    /**
     * Whether this converter supports worker mode.
     * @returns {boolean}
     */
    get supportsWorkerMode() {
        return this.#workerPool !== null;
    }

    // ========================================
    // Resource Cleanup
    // ========================================

    /**
     * @override
     */
    dispose() {
        if (this.#ownsWorkerPool && this.#workerPool) {
            this.#workerPool.terminate();
        }
        this.#workerPool = null;
        super.dispose();
    }
}
```

#### Test File Content

```javascript
import { test, describe, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { chromium } from 'playwright-chromium';

describe('CompositeColorConverter', () => {
    let browser, page;

    before(async () => {
        browser = await chromium.launch({ headless: true });
        page = await browser.newPage();
        await page.goto(`${process.env.BASE_URL || 'http://localhost:8080'}/testing/iso/ptf/2025/index.html`);
    });

    after(async () => {
        await browser?.close();
    });

    test('creates WorkerPool when useWorkers is true', async () => {
        const result = await page.evaluate(async () => {
            const { CompositeColorConverter } = await import('./classes/composite-color-converter.js');
            const converter = new CompositeColorConverter({
                renderingIntent: 'relative-colorimetric',
                blackPointCompensation: true,
                useAdaptiveBPCClamping: false,
                destinationProfile: 'sRGB',
                destinationColorSpace: 'RGB',
                verbose: false,
                useWorkers: true,
            });
            await converter.ensureReady();
            const hasPool = converter.workerPool !== null;
            converter.dispose();
            return hasPool;
        });
        assert.strictEqual(result, true);
    });

    test('uses shared WorkerPool when provided', async () => {
        const result = await page.evaluate(async () => {
            const { CompositeColorConverter } = await import('./classes/composite-color-converter.js');
            const { WorkerPool } = await import('./services/WorkerPool.js');

            const sharedPool = new WorkerPool({});
            await sharedPool.initialize();

            const converter = new CompositeColorConverter({
                renderingIntent: 'relative-colorimetric',
                blackPointCompensation: true,
                useAdaptiveBPCClamping: false,
                destinationProfile: 'sRGB',
                destinationColorSpace: 'RGB',
                verbose: false,
                useWorkers: true,
                workerPool: sharedPool,
            });
            await converter.ensureReady();
            const samePool = converter.workerPool === sharedPool;
            converter.dispose();
            // Shared pool should still be usable
            const poolStillWorks = sharedPool !== null;
            sharedPool.terminate();
            return { samePool, poolStillWorks };
        });
        assert.strictEqual(result.samePool, true);
        assert.strictEqual(result.poolStillWorks, true);
    });

    test('does not create WorkerPool when useWorkers is false', async () => {
        const result = await page.evaluate(async () => {
            const { CompositeColorConverter } = await import('./classes/composite-color-converter.js');
            const converter = new CompositeColorConverter({
                renderingIntent: 'relative-colorimetric',
                blackPointCompensation: true,
                useAdaptiveBPCClamping: false,
                destinationProfile: 'sRGB',
                destinationColorSpace: 'RGB',
                verbose: false,
                useWorkers: false,
            });
            await converter.ensureReady();
            const hasPool = converter.workerPool !== null;
            converter.dispose();
            return hasPool;
        });
        assert.strictEqual(result, false);
    });
});
```

#### Verification Commands

```bash
# Before changes (no stash needed - new file)

# After creating file - run ALL tests
yarn test
```

---

### Stage 9: PDFPageColorConverter

**File:** [pdf-page-color-converter.js](../classes/pdf-page-color-converter.js)
**Test:** [PDFPageColorConverter.test.js](../tests/PDFPageColorConverter.test.js)

#### Changes

| Change                                        | Location       | Before                       | After                                  |
| --------------------------------------------- | -------------- | ---------------------------- | -------------------------------------- |
| Update import                                 | Line 6         | `import { ColorConverter }`  | `import { CompositeColorConverter }`   |
| Update extends                                | Line 81        | `extends ColorConverter`     | `extends CompositeColorConverter`      |
| Remove `#workerPool` field                    | Lines 82-83    | Field declaration            | Delete                                 |
| Remove `#ownsWorkerPool` field                | Lines 85-86    | Field declaration            | Delete                                 |
| Update constructor                            | Lines 102-105  | Calls `super(configuration)` | Calls `super(configuration, options)`  |
| Remove WorkerPool init from `#initialize()`   | Lines 114-128  | WorkerPool setup             | Delete WorkerPool code                 |
| Remove `workerPool` getter                    | Lines 162-163  | Getter method                | Delete (inherit from parent)           |
| Remove `supportsWorkerMode` getter            | Lines 169      | Returns true                 | Delete (inherit from parent)           |
| Update `dispose()`                            | Lines 910-913  | WorkerPool cleanup           | Remove cleanup, keep `super.dispose()` |

#### Code to Update: Import (line 6)

**BEFORE:**
```javascript
import { ColorConverter } from './color-converter.js';
```

**AFTER:**
```javascript
import { CompositeColorConverter } from './composite-color-converter.js';
```

#### Code to Update: Class Declaration (line 81)

**BEFORE:**
```javascript
export class PDFPageColorConverter extends ColorConverter {
```

**AFTER:**
```javascript
export class PDFPageColorConverter extends CompositeColorConverter {
```

#### Code to Remove: Private Fields (delete lines 82-86)

**DELETE:**
```javascript
    /** @type {import('../services/WorkerPool.js').WorkerPool | null} */
    #workerPool = null;

    /** @type {boolean} */
    #ownsWorkerPool = false;
```

#### Code to Update: `#initialize()` (remove lines 114-128)

**BEFORE:**
```javascript
    async #initialize() {
        const config = /** @type {PDFPageColorConverterConfiguration} */ (this.configuration);

        if (config.useWorkers) {
            if (config.workerPool) {
                // Use provided pool (from PDFDocumentColorConverter)
                this.#workerPool = config.workerPool;
                this.#ownsWorkerPool = false;
            } else {
                // Create own pool (standalone usage)
                const { WorkerPool } = await import('../services/WorkerPool.js');
                this.#workerPool = new WorkerPool({
                    colorEnginePath: config.colorEnginePath,
                });
                await this.#workerPool.initialize();
                this.#ownsWorkerPool = true;
            }
        }

        // Create child converters
        this.#imageConverter = this.createChildConverter(PDFImageColorConverter, {
            ...this.deriveImageConfiguration(),
        });
        // ...
    }
```

**AFTER:**
```javascript
    async #initialize() {
        // WorkerPool handled by CompositeColorConverter parent

        // Create child converters
        this.#imageConverter = this.createChildConverter(PDFImageColorConverter, {
            ...this.deriveImageConfiguration(),
        });
        // ...
    }
```

#### Code to Remove: Getters (delete lines 162-169)

**DELETE:**
```javascript
    /**
     * @returns {import('../services/WorkerPool.js').WorkerPool | null}
     */
    get workerPool() {
        return this.#workerPool;
    }

    get supportsWorkerMode() {
        return this.#workerPool !== null;
    }
```

#### Code to Update: `dispose()` (remove lines 910-913)

**BEFORE:**
```javascript
    dispose() {
        // ... child converter cleanup ...

        if (this.#ownsWorkerPool && this.#workerPool) {
            this.#workerPool.terminate();
        }
        this.#workerPool = null;

        super.dispose();
    }
```

**AFTER:**
```javascript
    dispose() {
        // ... child converter cleanup ...

        // WorkerPool cleanup handled by CompositeColorConverter parent
        super.dispose();
    }
```

#### Verification Commands

```bash
# Before changes
git stash push -m "2026-01-26-phase-5-stage-9-PDFPageColorConverter" -- \
  testing/iso/ptf/2025/classes/pdf-page-color-converter.js \
  testing/iso/ptf/2025/tests/PDFPageColorConverter.test.js

# After changes - run ALL tests
yarn test
```

---

### Stage 10: PDFDocumentColorConverter

**File:** [pdf-document-color-converter.js](../classes/pdf-document-color-converter.js)
**Test:** [PDFDocumentColorConverter.test.js](../tests/PDFDocumentColorConverter.test.js)

#### Changes

| Change                                        | Location       | Before                       | After                                  |
| --------------------------------------------- | -------------- | ---------------------------- | -------------------------------------- |
| Update import                                 | Line 6         | `import { ColorConverter }`  | `import { CompositeColorConverter }`   |
| Update extends                                | Line 70        | `extends ColorConverter`     | `extends CompositeColorConverter`      |
| Remove `#workerPool` field                    | Lines 77-78    | Field declaration            | Delete                                 |
| Remove `#ownsWorkerPool` field                | Lines 83-84    | Field declaration            | Delete                                 |
| Update constructor                            | Lines 97-100   | Calls `super(configuration)` | Calls `super(configuration, options)`  |
| Remove WorkerPool init from `#initialize()`   | Lines 131-144  | WorkerPool setup             | Delete WorkerPool code                 |
| Remove `workerPool` getter                    | Lines 188-189  | Getter method                | Delete (inherit from parent)           |
| Remove `supportsWorkerMode` getter            | Lines 195      | Returns true                 | Delete (inherit from parent)           |
| Update `dispose()`                            | Lines 974-977  | WorkerPool cleanup           | Remove cleanup, keep `super.dispose()` |

#### Code to Update: Import (line 6)

**BEFORE:**
```javascript
import { ColorConverter } from './color-converter.js';
```

**AFTER:**
```javascript
import { CompositeColorConverter } from './composite-color-converter.js';
```

#### Code to Update: Class Declaration (line 70)

**BEFORE:**
```javascript
export class PDFDocumentColorConverter extends ColorConverter {
```

**AFTER:**
```javascript
export class PDFDocumentColorConverter extends CompositeColorConverter {
```

#### Code to Remove: Private Fields (delete lines 77-84)

**DELETE:**
```javascript
    /** @type {import('../services/WorkerPool.js').WorkerPool | null} */
    #workerPool = null;

    /** @type {boolean} */
    #ownsWorkerPool = false;
```

#### Code to Update: `#initialize()` (remove lines 131-144)

**BEFORE:**
```javascript
        // WorkerPool setup (own or shared)
        if (config.useWorkers) {
            if (config.workerPool) {
                this.#workerPool = config.workerPool;
                this.#ownsWorkerPool = false;
            } else {
                const { WorkerPool } = await import('../services/WorkerPool.js');
                this.#workerPool = new WorkerPool({
                    colorEnginePath: config.colorEnginePath,
                });
                await this.#workerPool.initialize();
                this.#ownsWorkerPool = true;
            }
        }
```

**AFTER:**
```javascript
        // WorkerPool handled by CompositeColorConverter parent
```

#### Code to Remove: Getters (delete lines 188-195)

**DELETE:**
```javascript
    /**
     * @returns {import('../services/WorkerPool.js').WorkerPool | null}
     */
    get workerPool() {
        return this.#workerPool;
    }

    get supportsWorkerMode() {
        return this.#workerPool !== null;
    }
```

#### Code to Update: `dispose()` (remove lines 974-977)

**BEFORE:**
```javascript
        if (this.#ownsWorkerPool && this.#workerPool) {
            this.#workerPool.terminate();
        }
        this.#workerPool = null;
```

**AFTER:**

```javascript
        // WorkerPool cleanup handled by CompositeColorConverter parent
```

#### Verification Commands

```bash
# Before changes
git stash push -m "2026-01-26-phase-5-stage-10-PDFDocumentColorConverter" -- \
  testing/iso/ptf/2025/classes/pdf-document-color-converter.js \
  testing/iso/ptf/2025/tests/PDFDocumentColorConverter.test.js

# After changes - run ALL tests
yarn test
```

---

### Phase 5 Verification

After completing all 3 stages:

```bash
# Run full test suite
yarn test

# Verify WorkerPool only in CompositeColorConverter
grep -n "#workerPool" testing/iso/ptf/2025/classes/*.js
# Expected: Only in composite-color-converter.js

# Verify inheritance
grep -n "extends CompositeColorConverter" testing/iso/ptf/2025/classes/*.js
# Expected: PDFPageColorConverter, PDFDocumentColorConverter
```

---

## Phase 6: Verify Separation of Concerns

### Manual Review Checklist

| Class | Expected Responsibility | Verification |
|-------|-------------------------|--------------|
| `ColorConverter` | Owns ColorEngineService, provides TypedArray conversion via `convertColorsBuffer()` | [ ] Verified |
| `LookupTableColorConverter` | Only lookup table build/apply/cache operations | [ ] Verified |
| `PDFContentStreamColorConverter` | Only parse/extract/rebuild content stream | [ ] Verified |
| `ImageColorConverter` | Only image format mapping and profile derivation | [ ] Verified |
| `PDFImageColorConverter` | Only PDF-specific compression/BPC handling | [ ] Verified |

### Verification Commands

```bash
# Verify ColorEngineService only in ColorConverter
grep -n "#colorEngineService" testing/iso/ptf/2025/classes/*.js
# Expected: Only in color-converter.js

# Verify no for loops in batch conversion
grep -n "for.*convertSingleColor" testing/iso/ptf/2025/classes/*.js
# Expected: No results

# Verify no abstract throws
grep -n "throw new Error.*abstract" testing/iso/ptf/2025/classes/*.js
# Expected: No results
```

---

## Phase 7: Final Regression Verification

### Verification Matrix

```bash
cd ~/Projects/conres/conres.io

# Run full test suite
yarn test

# Run verification matrix
node testing/iso/ptf/2025/experiments/scripts/generate-verification-matrix.mjs \
  --config=testing/iso/ptf/2025/experiments/configurations/2026-01-26-CLASSES-001.json
```

### Pass Conditions

| Check | Pass Condition |
|-------|----------------|
| Unit tests | All tests pass |
| Verification matrix | Exit code 0 |
| All 12 comparisons | Legacy vs Refactored identical |
| SUMMARY.md | Shows "Status: ALL COMPARISONS PASSED" |
| Performance | Within ±5% of baseline |

### Report Generation

Generate `2026-01-26-CLASSES-PART-02-REPORT.md` with:

1. Summary of all changes made
2. Test results
3. Performance comparison
4. Verification matrix results

---

## Rollback Strategy

### Stash Inventory

| Phase | Stage | Stash Message                                                        | Files                                                                             |
| ----- | ----- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| 2     | 1     | `2026-01-26-phase-2-stage-1-ColorConverter`                          | `color-converter.js`, `ColorConverter.test.js`                                    |
| 2     | 2     | `2026-01-26-phase-2-stage-2-ImageColorConverter`                     | `image-color-converter.js`, `ImageColorConverter.test.js`                         |
| 2     | 2.5   | `2026-01-26-phase-2-stage-2.5-LookupTableColorConverter-ensureReady` | `lookup-table-color-converter.js`, `LookupTableColorConverter.test.js`            |
| 2     | 3     | `2026-01-26-phase-2-stage-3-PDFContentStreamColorConverter`          | `pdf-content-stream-color-converter.js`, `PDFContentStreamColorConverter.test.js` |
| 3     | 4     | `2026-01-26-phase-3-stage-4-LookupTableColorConverter`               | `lookup-table-color-converter.js`, `LookupTableColorConverter.test.js`            |
| 3     | 5     | `2026-01-26-phase-3-stage-5-PDFContentStreamColorConverter-lookup`   | `pdf-content-stream-color-converter.js`, `PDFContentStreamColorConverter.test.js` |
| 4     | 6     | `2026-01-26-phase-4-stage-6-ColorConverter-concrete`                 | `color-converter.js`, `ColorConverter.test.js`                                    |
| 4     | 7     | `2026-01-26-phase-4-stage-7-LookupTableColorConverter-remove-single` | `lookup-table-color-converter.js`, `LookupTableColorConverter.test.js`            |
| 5     | 8     | N/A (new file)                                                       | `composite-color-converter.js`, `CompositeColorConverter.test.js` (NEW)           |
| 5     | 9     | `2026-01-26-phase-5-stage-9-PDFPageColorConverter`                   | `pdf-page-color-converter.js`, `PDFPageColorConverter.test.js`                    |
| 5     | 10    | `2026-01-26-phase-5-stage-10-PDFDocumentColorConverter`              | `pdf-document-color-converter.js`, `PDFDocumentColorConverter.test.js`            |

### Rollback Commands Template

```bash
# ROLLBACK (if stage fails)
git stash apply "stash^{/STASH_MESSAGE}"
git diff <file>
git stash drop "stash^{/STASH_MESSAGE}"

# CLEANUP (after stage succeeds)
git stash drop "stash^{/STASH_MESSAGE}"
```

### Final Stash Verification

```bash
# After all stages complete, verify no stashes remain
git stash list | grep "2026-01-26-phase"
# Expected: No results
```

---

## Hidden Dependencies to Watch

### LookupTableColorConverter Dependencies

| Method | Called By | Risk |
|--------|-----------|------|
| `convertSingleColor()` | `convertLookupTableColor()` (line 229) | Must update to use batch before removing |
| `convertSingleColor()` | `PDFContentStreamColorConverter.convertSingleColor()` (overrides) | Subclass must update first |
| `convertBatchUncached()` | `convertBatch()` (line 297) | SIMD change affects all batch conversions |

### ColorEngineService Dependencies

| Class | Method | Uses ColorEngineService |
|-------|--------|------------------------|
| `ImageColorConverter` | `#transformPixels()` (line 368) | Yes - update to use getter |
| `PDFContentStreamColorConverter` | `convertSingleColor()` (line 357) | Yes - update to use getter |

### Async Initialization Chain

| Class | Pattern | Risk |
|-------|---------|------|
| `ColorConverter` | `this.#ready = this.#initialize()` | Base must initialize first |
| `LookupTableColorConverter` | `ensureReady()` is no-op | Must delegate to parent |
| `ImageColorConverter` | Currently owns `#ready` | Must remove and delegate |
| `PDFContentStreamColorConverter` | Currently owns `#ready` | Must remove and delegate |

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Breaking `convertSingleColor()` callers | High | High | Update all callers before removing method |
| SIMD batch conversion produces different results | Medium | High | Compare pixel-by-pixel with original |
| ColorEngineService initialization race | Medium | High | Ensure `ensureReady()` chain works |
| Missing `super.dispose()` call | Low | Medium | Verify each dispose() implementation |
| Test failures from removed methods | Medium | Medium | Update tests in same commit as code |

---

## Activity Log

### 2026-01-26 (Phase 4 Stage 7 - LookupTableColorConverter)

- **Completed Stage 7**: Removed `convertSingleColor()` abstract method from `LookupTableColorConverter`
- Updated `convertLookupTableColor()` to use `convertBatchUncached([input], context)` instead of `convertSingleColor()`
- Made `convertBatchUncached()` abstract (throws error) since it can no longer delegate to `convertSingleColor()`
- Added missing `buildLookupTable()` and `applyLookupTable()` methods (required by `PDFContentStreamColorConverter`)
- Added `convertBatchUncached()` override to `PDFContentStreamColorConverter` (calls `convertSingleColor()` internally)
- Updated all tests in `LookupTableColorConverter.test.js` to override `convertBatchUncached()` instead of `convertSingleColor()`
- All 105 tests pass (58 pass, 47 skipped)

### 2026-01-26

- Created PART-02-PROGRESS.md
- Completed full analysis of all 7 classes
- Identified issues against user concerns
- User approved all 4 recommendations (A1, B1, C1, D1+D2)
- Rewrote PROGRESS with PART-01 level of explicitness
- Added exact line numbers for all changes
- Added before/after code snippets
- Added rollback strategy with stash commands
- Added hidden dependencies analysis
- Added risk assessment table
- Added Critical Insights section at top for agent guidance
- Updated verification commands to use `yarn test` (run ALL tests)
- Confirmed `ensureReady()` no-ops should be DELETED (not updated to call super)
- Added Stage 2.5 for LookupTableColorConverter `ensureReady()` removal
- Identified WorkerPool duplication in PDFDocumentColorConverter and PDFPageColorConverter
- Added Phase 5: CompositeColorConverter (new intermediate class for WorkerPool management)
- Added Stages 8, 9, 10 for Phase 5 implementation
- Renumbered old Phase 5 → Phase 6, old Phase 6 → Phase 7

---

## Regression Testing

After each phase, run:

```bash
node testing/iso/ptf/2025/experiments/scripts/generate-verification-matrix.mjs \
  --config=testing/iso/ptf/2025/experiments/configurations/2026-01-26-CLASSES-001.json
```

**DO NOT USE:** `compare-implementations.js` or `assets/testforms/` paths (per user feedback)
