# 2026-02-03 Changes and Comparisons Unification

## Current Status: PHASE 5 COMPLETE — All Phases Done

**Completed:**
- ✅ Phase 4A: Core data flow fixed — now extracts from INPUT PDF (4060 matches)
- ✅ Phase 4B: Output format fixed — CHANGES.json, CHANGES.md, SUMMARY.json match working format
- ✅ Phase 4C: Optimization — inputPdfPath stored in task object
- ✅ Phase 4D: SUMMARY.md format now matches working output
  - Added aggregated tables with Count column (instead of Op#)
  - Groups separated by (output profile + input colorspace type)
  - Side-by-side pair comparison tables within SUMMARY.md
  - Test output: 003F with 6 groups (1978+1978+27+27+25+25 = 4060 verifications)
- ✅ Phase 4E: `--comparisons-only` mode tested (003G) — only COMPARISONS files generated
- ✅ Phase 4F: Composite output tested (003H) — all 6 files generated correctly
- ✅ Phase 5: Testing and Validation complete
  - `--dry-run` shows both comparison and changes tasks (003I)
  - `--changes-only` generates only CHANGES files (003J: 4060 verifications)
  - `--comparisons-only` generates only COMPARISONS files (003K: 81 images)
  - Full regression test passed (003L: all 6 files, 4060 verifications, 81 images)

**Remaining:**
- None — all phases complete

**Assessment Reports**: See `2026-02-03-CHANGES-PROGRESS-ASSESSMENT-{001,002,003}.md` and `REVIEW-001.md`

**Last Updated**: 2026-02-03

**Objective**: Extract changes verification logic from `generate-verification-matrix.mjs` and integrate into `compare-pdf-outputs.js` using well-designed classes to minimize complexity and eliminate duplication.

---

## Implementation Rules (NON-NEGOTIABLE)

| Rule | Rationale |
|------|-----------|
| **Unit tests are MANDATORY per phase** | Tests must be written and pass BEFORE marking a phase complete |
| **No deferring tests** | "Unit tests (deferred)" is NOT allowed |
| **Test files follow naming convention** | `test-<class-name>.mjs` in `experiments/scripts/` |
| **All tests must pass** | Exit code 0 required before proceeding to next phase |

---

## Background

### Prior Work

| Document | Phase | Status |
|----------|-------|--------|
| `2026-02-01-CHANGES-PROGRESS.md` | Changes verification fixes in `generate-verification-matrix.mjs` | PAUSED |
| `2026-02-02-COMPARISONS-PROGRESS.md` | Delta-E comparisons in `compare-pdf-outputs.js` | COMPLETE |

### Current State

**`generate-verification-matrix.mjs`** — Changes verification (content stream colors):
- `extractColorsFromPDF()` — Extracts color operations from content streams
- `findMatchingInputColors()` — Matches colors by colorspace and values
- `verifyChangeGroup()` — Position-based comparison (input → output1 vs output2)
- Uses `content-stream-parser.mjs` for parsing
- ~400 lines of verification logic

**`compare-pdf-outputs.js`** — Image comparisons (Delta-E):
- Uses self-describing classes from `experiments/classes/`
- `ComparisonsCoordinator` — Registry and factory pattern
- `DeltaEMetrics` — Delta-E computation with serialization
- `ImageMatchMetrics` — Binary pre-checks
- `ImageSampler` — Pixel sampling strategies
- `PDFImageColorSampler` — Lab Float32 conversion

---

## Viability Assessment

### 1. Architectural Compatibility

| Aspect | Changes (current) | Comparisons (current) | Compatible? |
|--------|-------------------|----------------------|-------------|
| **Resource types** | Contents (color ops) | Images (pixel data) | Yes — separate resources |
| **Config structure** | `changes.groups[].aspects[]` | `comparisons.groups[].aspects[]` | Yes — parallel structure |
| **Pair semantics** | Named pair members | Named pair members | Yes — identical |
| **Output format** | Per-position results | Per-image results | Yes — can unify |
| **Matching strategy** | Position-based (page/stream/op#) | Name-based (XObject name) | Compatible |

**Assessment**: High architectural compatibility. Both use groups → pairs → aspects pattern.

### 2. Pattern Analysis

**Common Patterns Identified**:

1. **Self-describing metrics** — Both need `static metricName` and `static metricDefinitions`
2. **Coordinator registration** — Single coordinator can register both Changes and Delta-E metrics
3. **Aspect processing** — Same `type` + `resource` dispatch pattern
4. **Result serialization** — Both need `toJSON()` for output

**Differences**:

| Changes | Comparisons |
|---------|-------------|
| Tolerances per-value | Single threshold |
| Position matching | Sampling-based |
| Exact value comparison | Statistical metrics (avg, max) |
| Content stream parsing | Image decompression + color conversion |

### 3. Proposed Class Architecture

```
ComparisonsCoordinator (extends existing)
├── register(DeltaEMetrics)      — Image Delta-E (existing)
├── register(ColorChangeMetrics) — Content stream changes (NEW)
└── register(...)                — Future metrics

ColorChangeMetrics (NEW - self-describing)
├── static metricName = "Color"
├── static metricDefinitions = {
│   resource: "Contents",
│   defaults: { tolerances: [0, 0, 0, 0] },
│   metricsTypes: { exact: {...}, tolerance: {...} },
│   ...
│ }
├── #inputSpec, #outputSpecs
├── #verifications[]
├── addVerification(inputMatch, outputMatch, spec)
├── getMetrics() → { passed, failed, details[] }
├── toJSON() / fromJSON()
└── toTransferable() / fromTransferable()

ContentStreamColorExtractor (NEW - utility)
├── static async extractColors(pdfPath) → ColorMatch[]
├── static findMatchingColors(colors, spec) → ColorMatch[]
└── Uses existing content-stream-parser.mjs

ImageDeltaEExtractor (NEW - utility, wraps existing)
├── static async extractImages(pdfPath) → ExtractedImage[]
├── static async sampleAndConvert(image, sampler) → LabPixels
└── Wraps PDFImageColorSampler
```

### 4. Configuration Schema Unification

**Current Changes config**:
```json
{
  "changes": {
    "enabled": true,
    "groups": [{
      "description": "...",
      "input": "...",
      "outputs": ["..."],
      "pairs": [{ "Main Thread": "config1", "Workers": "config2" }],
      "aspects": [{
        "type": "Color",
        "resource": "Contents",
        "input": { "colorspace": "ICCBasedGray", "values": [0.0] },
        "Main Thread": { "colorspace": "DeviceCMYK", "values": [...], "tolerances": [...] },
        "Workers": { "colorspace": "DeviceCMYK", "values": [...], "tolerances": [...] }
      }]
    }]
  }
}
```

**Current Comparisons config**:
```json
{
  "comparisons": {
    "enabled": true,
    "groups": [{
      "description": "...",
      "input": "...",
      "outputs": ["..."],
      "pairs": [{ "Main Thread": "config1", "Workers": "config2" }],
      "aspects": [{
        "type": "Delta-E",
        "resource": "Image",
        "metrics": ["Average", "Maximum"],
        "threshold": 3.0,
        "sampling": { "type": "random", "count": 10000 }
      }]
    }]
  }
}
```

**Unified approach**: Both use same group/pair/aspect structure. Aspect `type` determines which metrics class handles it.

### 5. Viability Verdict

| Criterion | Assessment | Notes |
|-----------|------------|-------|
| **Feasibility** | HIGH | Parallel structures, compatible patterns |
| **Effort** | MEDIUM | ~3-4 new classes, refactor coordinator |
| **Risk** | LOW | Changes logic already working, just extracting |
| **Benefit** | HIGH | Single CLI, shared coordinator, no duplication |
| **Breaking changes** | NONE | Config format unchanged |

**VERDICT**: Viable and recommended.

---

## CLI Options

### Execution Flags

| Flag | Description |
|------|-------------|
| `--changes-only` | Only run changes verification (content stream colors), skip comparisons |
| `--comparisons-only` | Only run comparisons (image Delta-E), skip changes |
| `--dry-run` | Show what would be done without executing |

### Usage Examples

```bash
# Run both changes and comparisons (default)
node compare-pdf-outputs.js --config=config.json --source-dir=output/2026-02-02-001

# Run only changes verification
node compare-pdf-outputs.js --config=config.json --source-dir=output/2026-02-02-001 --changes-only

# Run only comparisons (Delta-E)
node compare-pdf-outputs.js --config=config.json --source-dir=output/2026-02-02-001 --comparisons-only

# Dry run to see what would be executed
node compare-pdf-outputs.js --config=config.json --source-dir=output/2026-02-02-001 --dry-run
```

### Flag Behavior

| Config State | No flags | `--changes-only` | `--comparisons-only` |
|--------------|----------|------------------|---------------------|
| Both `changes` and `comparisons` enabled | Run both | Run changes only | Run comparisons only |
| Only `changes` enabled | Run changes | Run changes | Skip (nothing to do) |
| Only `comparisons` enabled | Run comparisons | Skip (nothing to do) | Run comparisons |
| Neither enabled | Skip (nothing to do) | Skip | Skip |

**Note**: The `enabled` flag in config takes precedence. CLI flags filter what's already enabled.

---

## Preliminary Plan

### Phase 1: ContentStreamColorExtractor Class

Create `experiments/classes/content-stream-color-extractor.mjs`:
- [ ] Extract `extractColorsFromPDF()` from `generate-verification-matrix.mjs`
- [ ] Extract `extractColorSpaceDefinitions()`
- [ ] Extract `getDisplayColorspace()` and `normalizeColorSpaceType()`
- [ ] Create static class with clean API:
  - `static async extractColors(pdfPath)` → `ColorMatch[]`
  - `static findMatchingColors(colors, inputSpec)` → `ColorMatch[]`
- [ ] Keep dependency on `content-stream-parser.mjs`
- [ ] Unit tests

### Phase 2: ColorChangeMetrics Class

Create `experiments/classes/color-change-metrics.mjs`:
- [ ] Self-describing with `static metricName = "Color"`
- [ ] `static metricDefinitions` with resource, defaults, tolerances
- [ ] Constructor with `{ definitions, tolerances }`
- [ ] `setInputSpec(spec)` — Set input color specification
- [ ] `addOutputSpec(name, spec)` — Add expected output per pair member
- [ ] `addVerification(position, inputMatch, outputMatches)` — Record verification
- [ ] `getMetrics()` → `{ passed, failed, verifications[] }`
- [ ] `toJSON()` / `fromJSON()` — Serialization
- [ ] Unit tests

### Phase 3: Extend ComparisonsCoordinator

Update `experiments/classes/comparisons-coordinator.mjs`:
- [ ] Support multiple resource types per aspect type
- [ ] Add `getMetricsClass(type, resource)` method
- [ ] Ensure `validateAspects()` handles Color aspects
- [ ] No breaking changes to existing API

### Phase 4: Integrate into compare-pdf-outputs.js

Update `experiments/compare-pdf-outputs.js`:
- [ ] Import `ContentStreamColorExtractor` and `ColorChangeMetrics`
- [ ] Register `ColorChangeMetrics` with coordinator
- [ ] Add CLI flags for selective execution:
  - `--changes-only` — Only run changes verification (skip comparisons)
  - `--comparisons-only` — Only run comparisons (skip changes)
  - `--dry-run` — Show what would be done without executing (already exists, ensure it covers both)
- [ ] Add `processColorAspect()` function:
  - Extract colors from input and output PDFs
  - Match input positions
  - Verify output values at matched positions
  - Use `ColorChangeMetrics` for result tracking
- [ ] Update `executeComparisons()` to dispatch by aspect type
- [ ] Respect `--changes-only` and `--comparisons-only` flags in execution
- [ ] Update output generation for Color results

### Phase 5: Testing and Validation

- [ ] Test CLI flags:
  - [ ] `--dry-run` shows both changes and comparisons tasks
  - [ ] `--changes-only` runs only changes verification
  - [ ] `--comparisons-only` runs only comparisons
  - [ ] No flags runs both
- [ ] Run with `2026-02-02-REFACTOR-FIXTURES-BASELINE.json` (has both comparisons and changes)
- [ ] Verify Changes output matches previous `generate-verification-matrix.mjs` output
- [ ] Verify Comparisons output unchanged
- [ ] Create output folders with logs:
  - `output/YYYY-MM-DD-XXX Changes/` + `.log`
  - `output/YYYY-MM-DD-XXX Comparisons/` + `.log`
  - `output/YYYY-MM-DD-XXX/` + `.log` (both)
- [ ] Update progress document

---

## Class Design Details

### ContentStreamColorExtractor

**Purpose**: Extract and match color operations from PDF content streams.

**Dependencies**:
- `content-stream-parser.mjs` (existing)
- `pdf-lib` for PDF loading

```javascript
// @ts-check
/**
 * Content Stream Color Extractor
 *
 * Extracts color operations from PDF content streams for changes verification.
 * Uses the shared content-stream-parser for consistent operator indexing.
 */

import { parseContentStream, getColorOperations } from './content-stream-parser.mjs';

/**
 * @typedef {{
 *   pageNum: number,
 *   streamIndex: number,
 *   operatorIndex: number,
 *   operator: string,
 *   colorspace: string,
 *   values: number[],
 * }} ColorMatch
 */

/**
 * @typedef {{
 *   colorspace: string,
 *   values: number[],
 * }} ColorInputSpec
 */

export class ContentStreamColorExtractor {
    /**
     * Extract all color operations from a PDF.
     * @param {string} pdfPath
     * @returns {Promise<ColorMatch[]>}
     */
    static async extractColors(pdfPath) { /* ... */ }

    /**
     * Find colors matching an input specification.
     * @param {ColorMatch[]} colors
     * @param {ColorInputSpec} inputSpec
     * @returns {ColorMatch[]}
     */
    static findMatchingColors(colors, inputSpec) { /* ... */ }

    /**
     * Extract colorspace definitions from page resources.
     * @param {PDFDict} pageDict
     * @param {PDFContext} context
     * @returns {Record<string, ColorSpaceDefinition>}
     */
    static extractColorSpaceDefinitions(pageDict, context) { /* ... */ }
}
```

### ColorChangeMetrics

**Purpose**: Self-describing metrics class for content stream color changes.

```javascript
// @ts-check
/**
 * Color Change Metrics Class
 *
 * Self-describing metrics class for verifying color changes in content streams.
 * Follows the same patterns as DeltaEMetrics.
 */

export class ColorChangeMetrics {
    static metricName = "Color";

    static metricDefinitions = {
        resource: "Contents",
        defaults: {
            tolerances: [0, 0, 0, 0],  // Per-channel tolerances
        },
        toleranceTypes: {
            exact: { name: "Exact Match", tolerances: [0, 0, 0, 0] },
            loose: { name: "Loose Match", tolerances: [0.01, 0.01, 0.01, 0.01] },
        },
    };

    #inputSpec = null;
    #outputSpecs = new Map();  // name → ColorOutputSpec
    #verifications = [];

    constructor(options = {}) { /* ... */ }

    setInputSpec(spec) { /* ... */ }
    addOutputSpec(name, spec) { /* ... */ }
    addVerification(position, inputMatch, outputMatches) { /* ... */ }

    getMetrics() {
        return {
            passed: this.#verifications.filter(v => v.passed).length,
            failed: this.#verifications.filter(v => !v.passed).length,
            total: this.#verifications.length,
            verifications: this.#verifications,
        };
    }

    toJSON() { /* ... */ }
    static fromJSON(json) { /* ... */ }
}
```

---

## Migration Strategy

### Current Scope

**This phase**: Extract changes logic into classes and integrate into `compare-pdf-outputs.js` only.

**Out of scope**: Any modifications to `generate-verification-matrix.mjs` — decoupling will be planned in a separate session.

### Approach

1. Create shared classes in `experiments/classes/`
2. Integrate into `compare-pdf-outputs.js`
3. Both scripts can coexist:
   - `generate-verification-matrix.mjs` — Unchanged, continues to work as-is
   - `compare-pdf-outputs.js` — Gains changes verification capability

**Result**: `compare-pdf-outputs.js` becomes the primary verification CLI with both changes and comparisons support. `generate-verification-matrix.mjs` remains available for its original use cases until decoupling is planned separately.

---

## Roadmap

- [x] Phase 1: ContentStreamColorExtractor Class `COMPLETE`
  - [x] Create `experiments/classes/content-stream-color-extractor.mjs`
  - [x] Extract and refactor `extractColorsFromPDF()`
  - [x] Extract helper functions (`extractColorSpaceDefinitions`, `getICCColorSpace`, `normalizeColorSpaceType`, `getDisplayColorspace`, `valuesMatchWithinTolerance`)
  - [x] Unit tests — `test-content-stream-color-extractor.mjs` (36 passed, 0 failed)

- [x] Phase 2: ColorChangeMetrics Class `COMPLETE`
  - [x] Create `experiments/classes/color-change-metrics.mjs`
  - [x] Self-describing static properties (metricName, metricDefinitions)
  - [x] Verification tracking methods (setInputSpec, addOutputSpec, addVerification)
  - [x] Serialization (toJSON, fromJSON, toTransferable, fromTransferable)
  - [x] Unit tests — `test-color-change-metrics.mjs` (57 passed, 0 failed)

- [x] Phase 3: Extend ComparisonsCoordinator `COMPLETE`
  - [x] Support Color aspect type — Already supported (generic design)
  - [x] No breaking changes — Coordinator unchanged, just verified
  - [x] Unit tests — `test-comparisons-coordinator.mjs` (54 passed, 0 failed)

- [x] Phase 4: Integrate into compare-pdf-outputs.js `PARTIAL — CLI AND STRUCTURE COMPLETE`
  - [x] Add CLI flags: `--changes-only`, `--comparisons-only` (--dry-run existed)
  - [x] Import ContentStreamColorExtractor and ColorChangeMetrics
  - [x] Add buildChangesTasks() function
  - [x] Add executeChanges() function for color verification
  - [x] Update main() to respect flags and run both comparisons and changes
  - **Note**: Basic structure complete, but critical data flow bugs identified (see Phase 4A)

- [x] Phase 4A: Fix Core Data Flow `COMPLETE`
  - [x] **Fix 1**: Pass `config` parameter to `executeChanges()` call (~line 2183)
  - [x] **Fix 1**: Update `executeChanges()` signature to accept `config` (~line 1784)
  - [x] **Fix 2**: Extract colors from INPUT PDF first (not OUTPUT PDFs)
    - [x] Get input PDF path: `config.inputs[task.input].pdf`
    - [x] Verify input PDF exists
    - [x] Call `ContentStreamColorExtractor.extractColors(inputPdfPath)`
    - [x] Pass `inputColors` to `findMatchingColors()` instead of first output PDF colors
  - [x] **Test**: Run with `--changes-only` — **4060 verifications found (PASSED: 4060, FAILED: 0)**

- [x] Phase 4B: Fix Output Format `COMPLETE`
  - [x] **Fix 3**: Restructure JSON output to match working implementation
    - [x] Add `configPath`, `outputSuffix`, `enabled`, `passed`, `failed` at root
    - [x] Change `changes[]` to `groups[]` array
    - [x] Add per-verification structure with `firstExpected`, `firstActual`, `firstMatch`, etc.
    - [x] Add `summary` object per group with `totalMatches`, `passedMatches`, `failedMatches`
  - [x] **Fix 4**: Add `generateChangesSummaryJson()` function
    - [x] Create SUMMARY.json with high-level statistics
    - [x] Aggregate verification counts from all groups
  - [x] **Fix 5**: Update Markdown table format
    - [x] Separate Page/Stream/Op# columns
    - [x] Side-by-side pair comparison columns
    - [x] Include colorspace in expected/actual values
    - [x] Use 4 decimal places for values
  - [x] **Output files**: Generate separate CHANGES.json, CHANGES.md, SUMMARY.json
  - [x] **Test**: Output structure matches working format — 4060 verifications, all passed

- [x] Phase 4C: Optimization (Optional) `COMPLETE`
  - [x] **Fix 6**: Store input PDF path in task object during `buildChangesTasks()`
    - [x] Add `inputPdfPath: config.inputs?.[inputName]?.pdf ?? null` to task
    - [x] Update `executeChanges()` to use `task.inputPdfPath` with fallback
  - [x] **Test**: 4060 verifications passed with optimization enabled

- [x] Phase 4D: Generate SUMMARY.md `COMPLETE`
  - [x] Create `generateChangesSummaryMarkdown()` function
  - [x] Include configuration path and output folder
  - [x] Include changes statistics (passed/failed groups, total verifications)
  - [x] Write SUMMARY.md alongside SUMMARY.json
  - [x] **Test**: SUMMARY.md generated — all 4 output files present (CHANGES.json, CHANGES.md, SUMMARY.json, SUMMARY.md)
  - [x] **Fix**: Add aggregated verification tables with Count column to SUMMARY.md
  - [x] **Fix**: Pass `changesJson` to `generateChangesSummaryMarkdown()` for detailed tables
  - [x] **Fix**: Group by (output profile + input colorspace type) matching working format (Task 6 from 2026-02-01)
  - [x] **Test 003F**: 6 groups (1978+1978+27+27+25+25 = 4060 verifications) matching working output structure

- [x] Phase 4E: Test Comparisons-Only Mode `COMPLETE`
  - [x] Run with `--comparisons-only` flag
  - [x] Verify COMPARISONS.json generated correctly
  - [x] Verify COMPARISONS.md generated correctly
  - [x] Verify no CHANGES files generated (only COMPARISONS.json, COMPARISONS.md)
  - [x] **Test 003G**: 6 tasks, 81 images (39 MATCH, 42 DELTA, 0 MISMATCH, 0 SKIP)

- [x] Phase 4F: Test Composite Output (Both Changes and Comparisons) `COMPLETE`
  - [x] Run without `--changes-only` or `--comparisons-only` flags
  - [x] Verify both CHANGES.{json,md} and COMPARISONS.{json,md} generated
  - [x] Generate SUMMARY.json with changes section
  - [x] Generate SUMMARY.md with detailed aggregated tables
  - [x] **Test 003H**: All 6 files generated (CHANGES.json/md, COMPARISONS.json/md, SUMMARY.json/md)
  - [x] **Results**: 81 images (39 MATCH, 42 DELTA), 4060 verifications (all PASSED)

- [x] Phase 5: Testing and Validation `COMPLETE`
  - [x] Test CLI flags (`--changes-only`, `--comparisons-only`, `--dry-run`)
    - [x] **Test 003I**: `--dry-run` shows 6 comparison tasks + 78 changes tasks
    - [x] **Test 003J**: `--changes-only` — 4060 verifications, all passed, only CHANGES files
    - [x] **Test 003K**: `--comparisons-only` — 81 images, only COMPARISONS files
  - [x] Verify Changes output matches previous `generate-verification-matrix.mjs` output:
    - [x] CHANGES.json structure matches (groups, verifications, summary)
    - [x] CHANGES.md table format matches (pair-wise comparison columns)
    - [x] SUMMARY.json contains correct statistics
    - [x] SUMMARY.md contains correct statistics
  - [x] Verify Comparisons output unchanged
  - [x] Full regression test with `2026-02-02-REFACTOR-FIXTURES-BASELINE.json`
    - [x] **Test 003L**: All 6 files generated, 81 images (39 MATCH, 42 DELTA), 4060 verifications (all PASSED)
  - [x] Compare verification counts: 4060 total (1978+1978+27+27+25+25 per colorspace/output grouping)

**Note**: `generate-verification-matrix.mjs` remains unchanged. Decoupling will be planned in a separate session.

---

## TODO List: Course Corrections

### Phase 4A: Core Data Flow Fix (CRITICAL)

**Objective**: Fix the fundamental data flow error — extract from INPUT PDF, not OUTPUT PDFs.

| # | Task | File | Location | Priority |
|---|------|------|----------|----------|
| 1 | Pass `config` to `executeChanges()` call | `compare-pdf-outputs.js` | ~line 2183 | **CRITICAL** |
| 2 | Update `executeChanges()` signature | `compare-pdf-outputs.js` | ~line 1783 | **CRITICAL** |
| 3 | Add input PDF path lookup | `compare-pdf-outputs.js` | In `executeChanges()` | **CRITICAL** |
| 4 | Verify input PDF exists | `compare-pdf-outputs.js` | In `executeChanges()` | **CRITICAL** |
| 5 | Extract colors from INPUT PDF | `compare-pdf-outputs.js` | Before output loop | **CRITICAL** |
| 6 | Pass `inputColors` to `findMatchingColors()` | `compare-pdf-outputs.js` | Color matching | **CRITICAL** |

**Success Criteria**: Running `--changes-only` shows "Found ~1978 matching input colors" instead of 0.

### Phase 4B: Output Format Fix

**Objective**: Match the output format of `generate-verification-matrix.mjs`.

| # | Task | File | Priority |
|---|------|------|----------|
| 7 | Restructure JSON output — add `configPath`, `outputSuffix`, `enabled` at root | `compare-pdf-outputs.js` | HIGH |
| 8 | Restructure JSON output — change `changes[]` to `groups[]` | `compare-pdf-outputs.js` | HIGH |
| 9 | Restructure JSON output — add per-verification detail fields | `compare-pdf-outputs.js` | HIGH |
| 10 | Restructure JSON output — add `summary` per group | `compare-pdf-outputs.js` | HIGH |
| 11 | Create `generateSummaryJson()` function | `compare-pdf-outputs.js` | HIGH |
| 12 | Update markdown table — separate Page/Stream/Op# columns | `compare-pdf-outputs.js` | MEDIUM |
| 13 | Update markdown table — side-by-side pair comparison | `compare-pdf-outputs.js` | MEDIUM |
| 14 | Update markdown table — include colorspace in values | `compare-pdf-outputs.js` | MEDIUM |
| 15 | Generate separate output files: CHANGES.json, CHANGES.md, SUMMARY.json | `compare-pdf-outputs.js` | HIGH |

**Success Criteria**: Output files match structure of `generate-verification-matrix.mjs` output.

### Phase 4C: Optimization (Optional)

| # | Task | File | Priority |
|---|------|------|----------|
| 16 | Store `inputPdfPath` in task object during `buildChangesTasks()` | `compare-pdf-outputs.js` | LOW |

**Rationale**: Avoids redundant config lookup in `executeChanges()`.

### Phase 5: Validation

| # | Task | Priority |
|---|------|----------|
| 17 | Test `--changes-only` flag | HIGH |
| 18 | Test `--comparisons-only` flag | HIGH |
| 19 | Test `--dry-run` flag | HIGH |
| 20 | Compare CHANGES.json structure against working output | HIGH |
| 21 | Compare CHANGES.md format against working output | HIGH |
| 22 | Verify SUMMARY.json contains correct statistics | HIGH |
| 23 | Full regression test with baseline config | HIGH |
| 24 | Verify verification count matches (~1978 per group) | HIGH |

---

## Open Questions

1. **Should we unify changes and comparisons into a single config section?**
   - Current: `changes` and `comparisons` are separate
   - Alternative: Single `verification` section with aspect types determining behavior
   - Recommendation: Keep separate for now, consider unification later

2. **How to handle aspect-specific configuration?**
   - Color aspects need `tolerances` per-value
   - Delta-E aspects need `threshold` and `sampling`
   - Solution: Each metrics class defines its own schema via `metricDefinitions`

3. **Output format unification?**
   - Changes: Per-position verification results
   - Delta-E: Per-image with metrics
   - Solution: Common wrapper with type-specific details

---

## Activity Log

| Date | Activity |
|------|----------|
| 2026-02-03 | Created progress document with viability assessment |
| 2026-02-03 | Analyzed `generate-verification-matrix.mjs` changes logic (~400 lines) |
| 2026-02-03 | Analyzed `compare-pdf-outputs.js` class structure |
| 2026-02-03 | Identified common patterns and differences |
| 2026-02-03 | Drafted preliminary plan with 6 phases |
| 2026-02-03 | Designed `ContentStreamColorExtractor` and `ColorChangeMetrics` classes |
| 2026-02-03 | Verdict: Viable and recommended |
| 2026-02-03 | Added CLI flags requirement: `--changes-only`, `--comparisons-only`, `--dry-run` |
| 2026-02-03 | Removed Phase 5 (deprecate generate-verification-matrix.mjs) — decoupling deferred to separate session |
| 2026-02-03 | **Phase 1 COMPLETE**: Created `content-stream-color-extractor.mjs` with all extraction and matching methods |
| 2026-02-03 | **Phase 1 TESTS**: `test-content-stream-color-extractor.mjs` — 36 passed, 0 failed |
| 2026-02-03 | **Phase 2 COMPLETE**: Created `color-change-metrics.mjs` with self-describing pattern |
| 2026-02-03 | **Phase 2 TESTS**: `test-color-change-metrics.mjs` — 57 passed, 0 failed |
| 2026-02-03 | **Phase 3 COMPLETE**: ComparisonsCoordinator already supports Color (no changes needed) |
| 2026-02-03 | **Phase 3 TESTS**: `test-comparisons-coordinator.mjs` — 54 passed, 0 failed |
| 2026-02-03 | Phase 4 ATTEMPTED: Integrated ColorChangeMetrics into compare-pdf-outputs.js |
| 2026-02-03 | Added CLI flags: --changes-only, --comparisons-only |
| 2026-02-03 | Added buildChangesTasks(), executeChanges() functions |
| 2026-02-03 | Updated main() and output generation for combined results |
| 2026-02-03 | **FAILURE DETECTED**: Testing revealed 0 matches (should be ~1978) |
| 2026-02-03 | **ROOT CAUSE**: executeChanges() extracts from OUTPUT PDFs, not INPUT PDF |
| 2026-02-03 | Created Assessment Reports: ASSESSMENT-001, ASSESSMENT-002, ASSESSMENT-003 |
| 2026-02-03 | Created Review Report: REVIEW-001 with fix specifications |
| 2026-02-03 | Restructured phases: Added Phase 4A (Core Data Flow), Phase 4B (Output Format), Phase 4C (Optional) |
| 2026-02-03 | Created detailed TODO list with 24 tasks for course corrections |
| 2026-02-03 | Phase 4 marked PARTIAL — basic CLI and structure complete |
| 2026-02-03 | Phase 4A marked IN-PROGRESS — beginning core data flow fixes |
| 2026-02-03 | **Phase 4A Fix 1 COMPLETE**: Passed `config` to `executeChanges()` |
| 2026-02-03 | **Phase 4A Fix 2 COMPLETE**: Extract from INPUT PDF first, then OUTPUT PDFs |
| 2026-02-03 | **Phase 4A TEST PASSED**: 4060 verifications found (was 0 before fix) |
| 2026-02-03 | **Phase 4A COMPLETE** |
| 2026-02-03 | **Phase 4B STARTED**: Implementing output format fixes |
| 2026-02-03 | **Phase 4B Fix 3 COMPLETE**: Created `generateChangesJsonOutput()` with working format |
| 2026-02-03 | **Phase 4B Fix 4 COMPLETE**: Created `generateChangesSummaryJson()` for SUMMARY.json |
| 2026-02-03 | **Phase 4B Fix 5 COMPLETE**: Created `generateChangesMarkdownOutput()` with side-by-side tables |
| 2026-02-03 | **Phase 4B OUTPUT FILES**: CHANGES.json, CHANGES.md, SUMMARY.json now generated |
| 2026-02-03 | **Phase 4B TEST PASSED**: Output format matches working `generate-verification-matrix.mjs` |
| 2026-02-03 | **Phase 4B COMPLETE** |
| 2026-02-03 | **Phase 4C Fix 6 COMPLETE**: Added `inputPdfPath` to task in `buildChangesTasks()` |
| 2026-02-03 | **Phase 4C COMPLETE**: Optimization test passed — 4060 verifications |
| 2026-02-03 | **Phase 4D Fix**: Added aggregated tables with Count column to SUMMARY.md |
| 2026-02-03 | **Phase 4D Fix**: Pass `changesJson` to `generateChangesSummaryMarkdown()` |
| 2026-02-03 | **Phase 4D Fix**: Group by (output + input colorspace) matching Task 6 from 2026-02-01 |
| 2026-02-03 | **Phase 4D TEST 003E**: SUMMARY.md had wrong grouping (2030/2030 instead of 1978/1978) |
| 2026-02-03 | **Phase 4D TEST 003F**: Correct grouping — 6 groups (1978+1978+27+27+25+25 = 4060) |
| 2026-02-03 | **Phase 4D COMPLETE**: SUMMARY.md format matches working output/2026-02-02-007/ |
| 2026-02-03 | **Phase 4E COMPLETE**: `--comparisons-only` test passed (003G) |
| 2026-02-03 | **Phase 4F COMPLETE**: Composite output test passed (003H) — all 6 files generated |
| 2026-02-03 | **Phase 5 STARTED**: Testing and Validation |
| 2026-02-03 | **Phase 5 TEST 003I**: `--dry-run` shows 6 comparison tasks + 78 changes tasks |
| 2026-02-03 | **Phase 5 TEST 003J**: `--changes-only` — 4060 verifications, only CHANGES files |
| 2026-02-03 | **Phase 5 TEST 003K**: `--comparisons-only` — 81 images, only COMPARISONS files |
| 2026-02-03 | **Phase 5 TEST 003L**: Full regression — all 6 files, 4060 verifications, 81 images |
| 2026-02-03 | **Phase 5 COMPLETE**: All CLI flags tested, output verified against working reference |
| 2026-02-03 | **ALL PHASES COMPLETE**: Changes verification successfully unified into compare-pdf-outputs.js |
| 2026-02-03 | **Phase 4D TEST 003F**: Correct grouping — 6 groups (1978+1978+27+27+25+25 = 4060) |
| 2026-02-03 | **Phase 4D COMPLETE**: SUMMARY.md format matches working output/2026-02-02-007/ |
