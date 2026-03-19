# 2026-01-26-CLASSES-PART-02-PROGRESS.md

Architectural refactoring for color converter classes - Part 02

---

## User Concerns (from Color-Engine-Integration-User-Notes.md)

1. ~~No "doConvertColor" naming~~ (DONE in PART-01)
2. **No for loops for color conversions iterating arrays one by one** - `color-engine` uses SIMD
3. **LookupTableColorConverter should provide base typed array operations** - subclasses should only handle lookup table generation/application
4. **No throwing for unimplemented methods** - code is "finished"
5. **Clean separation of concerns** - strict responsibilities per class
6. **Options and insights for redundancy** - user decides what to do

---

## Roadmap

- [x] Phase 1: Analysis and Decision Points
- [ ] Phase 2: Move ColorEngineService to ColorConverter base `IN-PROGRESS`
- [ ] Phase 3: Restructure LookupTableColorConverter for SIMD
- [ ] Phase 4: Remove Abstract Throws
- [ ] Phase 5: Verify Separation of Concerns
- [ ] Phase 6: Final Regression Verification

---

## Current Status

**Current Focus:** Phase 2 - Move ColorEngineService to ColorConverter base
**Last Updated:** 2026-01-26

---

## User Decisions (Approved)

| ID    | Decision                              | Chosen Option                                                              |
| ----- | ------------------------------------- | -------------------------------------------------------------------------- |
| 1.2.A | ColorEngineService location           | **A1**: Move to `ColorConverter` base class                                |
| 1.3.A | SIMD batch conversion                 | **B1**: Build TypedArray of unique colors, call engine once                |
| 1.4.A | LookupTableColorConverter restructure | **C1**: Full restructure per expected architecture                         |
| 1.5.A | Abstract throws replacement           | **D1+D2**: Make `convertColor()` concrete, remove `convertSingleColor()`   |

---

## Implementation Plan

### Phase 2: Move ColorEngineService to ColorConverter Base

**Files to modify:**

| File | Action |
| ---- | ------ |
| `color-converter.js` | Add ColorEngineService infrastructure |
| `image-color-converter.js` | Remove duplicated ColorEngineService, use parent's |
| `pdf-content-stream-color-converter.js` | Remove duplicated ColorEngineService, use parent's |

**Step 2.1: Add to `ColorConverter` base class:**

- [ ] Add private fields: `#colorEngineService`, `#ownsColorEngineService`, `#ready`
- [ ] Add `#initialize()` method with dynamic import pattern
- [ ] Add `ensureReady()` public method
- [ ] Add constructor option: `options.colorEngineService` for injection
- [ ] Add `convertColorsBuffer(inputBuffer, outputBuffer, options)` method for SIMD conversion
- [ ] Update `dispose()` to clean up ColorEngineService
- [ ] Remove abstract throw from `convertColor()` - make it concrete for TypedArray conversion

**Step 2.2: Update `ImageColorConverter`:**

- [ ] Remove `#colorEngineService`, `#ownsColorEngineService`, `#ready` fields
- [ ] Remove `#initialize()` method
- [ ] Update `#transformPixels()` to use `this.colorEngineService` from parent
- [ ] Keep `ensureReady()` call but delegate to parent
- [ ] Update `dispose()` - remove ColorEngineService cleanup

**Step 2.3: Update `PDFContentStreamColorConverter`:**

- [ ] Remove `#colorEngineService`, `#ownsColorEngineService`, `#ready` fields
- [ ] Remove `#initialize()` method
- [ ] Update `convertSingleColor()` to use parent's ColorEngineService
- [ ] Keep `ensureReady()` call but delegate to parent
- [ ] Update `dispose()` - remove ColorEngineService cleanup

**Verification:** Run unit tests for all 3 modified classes

---

### Phase 3: Restructure LookupTableColorConverter for SIMD

**Files to modify:**

| File | Action |
| ---- | ------ |
| `lookup-table-color-converter.js` | Restructure for SIMD batch conversion |
| `pdf-content-stream-color-converter.js` | Update to use new lookup table API |

**Step 3.1: Restructure `LookupTableColorConverter`:**

- [ ] Replace `convertSingleColor()` with `buildLookupTable(uniqueColors)` - builds TypedArray, calls parent's `convertColorsBuffer()` once
- [ ] Add `applyLookupTable(lookupTable, inputValues)` - returns converted values from cache
- [ ] Update `convertBatch()` - extract unique colors, build lookup table once, apply to all inputs
- [ ] Remove `convertBatchUncached()` for loop - replaced by single SIMD call
- [ ] Update cache key generation for new structure

**Step 3.2: Update `PDFContentStreamColorConverter`:**

- [ ] Remove `convertSingleColor()` implementation
- [ ] Update `convertContentStreamColors()` to:
  1. Parse content stream
  2. Extract unique colors
  3. Call parent's `buildLookupTable()` once
  4. Apply lookup table to all color operations
  5. Rebuild content stream

**Verification:** Run unit tests, run regression matrix

---

### Phase 4: Remove Abstract Throws

**Files to modify:**

| File | Action |
| ---- | ------ |
| `color-converter.js` | Make `convertColor()` concrete |
| `lookup-table-color-converter.js` | Remove `convertSingleColor()` abstract throw |

**Step 4.1: Make `ColorConverter.convertColor()` concrete:**

- [ ] Implement as TypedArray-to-TypedArray conversion using ColorEngineService
- [ ] Accept input with `inputBuffer`, `inputFormat`, `outputFormat` options
- [ ] Call `convertColorsBuffer()` internally

**Step 4.2: Remove abstract throws:**

- [ ] Delete `convertSingleColor()` from `LookupTableColorConverter` (no longer needed after Phase 3)

**Verification:** Run unit tests, ensure no throws remain

---

### Phase 5: Verify Separation of Concerns

**Manual review checklist:**

- [ ] `ColorConverter`: Owns ColorEngineService, provides TypedArray conversion
- [ ] `LookupTableColorConverter`: Only lookup table build/apply/cache
- [ ] `PDFContentStreamColorConverter`: Only parse/extract/rebuild content stream
- [ ] `ImageColorConverter`: Only image format mapping
- [ ] `PDFImageColorConverter`: Only PDF-specific compression/BPC

**Verification:** Code review all classes against proposed responsibilities

---

### Phase 6: Final Regression Verification

- [ ] Run full test suite: `yarn test`
- [ ] Run verification matrix: `node testing/iso/ptf/2025/experiments/scripts/generate-verification-matrix.mjs --config=testing/iso/ptf/2025/experiments/2026-01-26-CLASSES-001.json`
- [ ] Generate `2026-01-26-CLASSES-PART-02-REPORT.md` with summary of changes

---

## Activity Log

### 2026-01-26
- Created PART-02-PROGRESS.md
- Completed full analysis of all 7 classes
- Identified issues against user concerns
- User approved all 4 recommendations (A1, B1, C1, D1+D2)
- Starting Phase 2 implementation

---

## Phase 1: Analysis and Decision Points

### 1.1 Class Hierarchy Overview

```
ColorConverter (base)
├── LookupTableColorConverter
│   └── PDFContentStreamColorConverter
├── ImageColorConverter
│   └── PDFImageColorConverter
├── PDFPageColorConverter
└── PDFDocumentColorConverter
```

Also uses:
- `ProfilePool` (profile caching)
- `BufferRegistry` (buffer management)

---

### 1.2 Issue: ColorEngineService Duplication

**FOUND IN:**

| Class | Lines | Code |
|-------|-------|------|
| `ImageColorConverter` | 172-177 | `#colorEngineService`, `#ownsColorEngineService`, `#ready` |
| `PDFContentStreamColorConverter` | 144-151 | `#colorEngineService`, `#ownsColorEngineService`, `#ready` |

Both classes have identical initialization pattern:

```javascript
// ImageColorConverter.#initialize()
async #initialize() {
    const { ColorEngineService } = await import('../services/ColorEngineService.js');
    this.#colorEngineService = new ColorEngineService();
    this.#ownsColorEngineService = true;
}

// PDFContentStreamColorConverter.#initialize()
async #initialize() {
    const { ColorEngineService } = await import('../services/ColorEngineService.js');
    this.#colorEngineService = new ColorEngineService();
    this.#ownsColorEngineService = true;
}
```

**VIOLATION:** "ALL Classes extending `ColorConverter` directly or indirectly should not replicate behaviours"

**USER HINT:** "ColorConverter is a base class that is responsible for color-engine"

#### Decision Point 1.2.A: Where should ColorEngineService live?

| Option | Description | Pros | Cons |
|--------|-------------|------|------|
| **A1** | Move to `ColorConverter` base class | Single source of truth; all converters share | All converters get ColorEngine overhead even if unused |
| **A2** | Create intermediate `ColorEngineConverter` class | Only converters needing engine extend it | Adds class to hierarchy |
| **A3** | Inject via configuration (composition) | Flexible; no class hierarchy changes | Lifecycle management complexity |
| **A4** | Keep in `ImageColorConverter`, share to `PDFContentStreamColorConverter` via constructor option | Minimal change | Still duplicates structure |

**MY RECOMMENDATION:** Option A1 or A3

- A1 aligns with user's hint: "ColorConverter is responsible for color-engine"
- A3 is more flexible for testing/composition

**AWAITING USER DECISION**

---

### 1.3 Issue: For Loops Converting One Color at a Time

**FOUND IN:**

| Class | Method | Lines | Issue |
|-------|--------|-------|-------|
| `LookupTableColorConverter` | `convertBatchUncached()` | 332-340 | Iterates `for (const input of inputs)` calling `convertSingleColor` one at a time |
| `LookupTableColorConverter` | `convertLookupTableColor()` | 229 | Calls `convertSingleColor()` for single conversion |

**Problematic Code:**
```javascript
// LookupTableColorConverter lines 332-340
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

**VIOLATION:** "color-engine uses SIMD, giving it one color at a time is unacceptable"

#### Decision Point 1.3.A: How to enable SIMD batch conversion?

| Option | Description | Pros | Cons |
|--------|-------------|------|------|
| **B1** | `LookupTableColorConverter` builds TypedArray of unique colors, calls engine once | SIMD-efficient; single engine call | Requires restructuring |
| **B2** | `PDFContentStreamColorConverter` overrides `convertBatchUncached()` with batch call | Less change | Still leaves bad default in parent |
| **B3** | Replace `convertSingleColor()` with `convertColorsBuffer(inputBuffer, outputBuffer)` | Typed array focus | Signature change across classes |

**MY RECOMMENDATION:** Option B1 or B3

- B1: `LookupTableColorConverter` should pack unique colors into a flat TypedArray, call `colorEngine.transformArray()` once, then unpack results
- B3: Change signature to work with buffers throughout

**AWAITING USER DECISION**

---

### 1.4 Issue: LookupTableColorConverter Architecture

**USER'S VISION:**
> "LookupTableColorConverter was supposed to provide the base operation that handles converting typed arrays, PDFContentStreamColorConverter should have leveraged specialized the base implementation entirely so that any extending class only has the responsibility of generating the lookup tables for input and applying them for the output"

**CURRENT ARCHITECTURE (WRONG):**

```
LookupTableColorConverter
├── convertColor() → convertLookupTableColor()
├── convertLookupTableColor() → convertSingleColor() [throws]
├── convertBatch() → convertBatchUncached() → convertSingleColor() [loop]
└── convertSingleColor() [abstract, throws]

PDFContentStreamColorConverter (extends LookupTableColorConverter)
├── convertColor() → convertContentStreamColors()
├── convertContentStreamColors() → parseContentStream() + convertBatch()
├── convertSingleColor() [implements with ColorEngineService]
└── #colorEngineService [OWNS ColorEngineService - WRONG]
```

**EXPECTED ARCHITECTURE:**

```
ColorConverter (owns ColorEngineService)
├── convertColorsBuffer(inputBuffer, inputFormat, outputBuffer, outputFormat)
└── Configuration, profiles, etc.

LookupTableColorConverter (extends ColorConverter)
├── buildLookupTable(uniqueColors) → calls parent's buffer conversion
├── applyLookupTable(lookupTable, inputValues) → returns converted values
└── Lookup table caching

PDFContentStreamColorConverter (extends LookupTableColorConverter)
├── convertColor() → parseContentStream() + extractUniqueColors() + applyLookupTable()
├── parseContentStream() → extracts operations
├── extractUniqueColors() → returns unique colors for lookup
└── rebuildContentStream() → applies converted colors
```

#### Decision Point 1.4.A: Restructure LookupTableColorConverter?

| Option | Description | Pros | Cons |
|--------|-------------|------|------|
| **C1** | Full restructure per expected architecture | Clean separation; SIMD-efficient | Significant code change |
| **C2** | Keep current structure, just move ColorEngine to base | Less change | Doesn't fix architectural issues |
| **C3** | Deprecate LookupTableColorConverter, merge into PDFContentStreamColorConverter | Simpler hierarchy | Loses reusability |

**MY RECOMMENDATION:** Option C1

- Aligns with user's explicit vision
- Enables proper SIMD usage
- Clean separation of concerns

**AWAITING USER DECISION**

---

### 1.5 Issue: Abstract Methods That Throw

**FOUND IN:**

| Class | Method | Lines |
|-------|--------|-------|
| `ColorConverter` | `convertColor()` | 197-199 |
| `LookupTableColorConverter` | `convertSingleColor()` | 252-254 |

**Problematic Code:**
```javascript
// ColorConverter.convertColor()
async convertColor(input, context = {}) {
    throw new Error('ColorConverter.convertColor() is abstract and must be overridden by subclass');
}

// LookupTableColorConverter.convertSingleColor()
async convertSingleColor(input, context) {
    throw new Error('LookupTableColorConverter.convertSingleColor() is abstract and must be overridden');
}
```

**VIOLATION:** "I don't want to see throwing for unimplemented methods since Claude has supposedly finished implementing the code"

#### Decision Point 1.5.A: What should replace abstract throws?

| Option | Description | Pros | Cons |
|--------|-------------|------|------|
| **D1** | Make `ColorConverter.convertColor()` concrete - accepts TypedArray, calls engine | No throws; implements user's vision | Changes base class signature |
| **D2** | Remove `convertSingleColor()` entirely after restructure | Part of C1 restructure | Depends on C1 decision |
| **D3** | Make methods return empty/no-op result instead of throwing | Quick fix | Hides errors, poor practice |

**MY RECOMMENDATION:** Option D1 + D2

- D1: `ColorConverter.convertColor()` should be the concrete typed-array-to-typed-array conversion
- D2: `convertSingleColor()` should not exist after restructure (replaced by lookup table approach)

**AWAITING USER DECISION**

---

### 1.6 Separation of Concerns Analysis

**USER'S REQUIREMENTS:**

| Class | Responsibility |
|-------|----------------|
| `ColorConverter` | All responsibilities that do not belong in extending classes |
| `LookupTableColorConverter` | Lookup table responsibilities |
| `PDFContentStreamColorConverter` | PDF content stream specific lookup operations |
| `ImageColorConverter` | Image responsibilities |
| `PDFImageColorConverter` | PDF-specific image responsibilities |

**CURRENT STATE:**

| Class | Current Responsibilities | Issues |
|-------|--------------------------|--------|
| `ColorConverter` | Configuration, overrides, parent-child | Missing: ColorEngine |
| `LookupTableColorConverter` | Lookup cache, delegates conversion to subclass | Missing: Actual conversion logic |
| `PDFContentStreamColorConverter` | Parsing, conversion, ColorEngine | Too much: Owns ColorEngine |
| `ImageColorConverter` | Pixel conversion, ColorEngine | Could share ColorEngine with parent |
| `PDFImageColorConverter` | PDF compression, BPC normalization | Good - proper specialization |

**PROPOSED STATE (after restructure):**

| Class | Proposed Responsibilities |
|-------|---------------------------|
| `ColorConverter` | Configuration, overrides, ColorEngine, TypedArray conversion |
| `LookupTableColorConverter` | Build lookup table, apply lookup table, cache |
| `PDFContentStreamColorConverter` | Parse content stream, extract unique colors, rebuild stream |
| `ImageColorConverter` | Map image format to buffer, derive profiles |
| `PDFImageColorConverter` | PDF compression, BPC normalization, Filter handling |

---

## Summary of Decision Points

| ID | Issue | Options | Recommendation |
|----|-------|---------|----------------|
| 1.2.A | ColorEngineService location | A1, A2, A3, A4 | A1 (base class) or A3 (composition) |
| 1.3.A | SIMD batch conversion | B1, B2, B3 | B1 or B3 |
| 1.4.A | LookupTableColorConverter restructure | C1, C2, C3 | C1 (full restructure) |
| 1.5.A | Abstract throws replacement | D1, D2, D3 | D1 + D2 |

---

## Next Steps

Once user provides decisions on the above points, I will:

1. Create detailed implementation plan for chosen options
2. Identify files to modify
3. Proceed with implementation in phases
4. Run `generate-verification-matrix.mjs --config=2026-01-26-CLASSES-001.json` after each phase

---

## Regression Testing

After each phase, run:
```bash
node testing/iso/ptf/2025/experiments/scripts/generate-verification-matrix.mjs \
  --config=testing/iso/ptf/2025/experiments/2026-01-26-CLASSES-001.json
```

**DO NOT USE:** `compare-implementations.js` or `assets/testforms/` paths (per user feedback)
