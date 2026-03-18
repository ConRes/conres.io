# Performance Regression Fix Progress

**Date:** 2026-01-27
**Investigation:** `2026-01-27-REGRESSION-INVESTIGATION.md`
**Benchmark Config:** `testing/iso/ptf/2025/experiments/configurations/2026-01-26-CLASSES-002.json`

---

## Coordination Rules

### Subagent Coordination

1. **Sequential execution only** - Never run parallel agents
2. **One task per agent** - Each agent handles a single, focused change
3. **Cross-review required** - After implementation, a separate agent verifies the work
4. **Progress updates** - Update this tracker after each completed task

### Verification Commands

```bash
# Run tests
yarn test

# Run benchmark (ALWAYS use this, never compare-implementations.js)
node testing/iso/ptf/2025/experiments/scripts/generate-verification-matrix.mjs --config=testing/iso/ptf/2025/experiments/configurations/2026-01-26-CLASSES-002.json
```

### Prohibited Paths

- `compare-implementations.js` - DO NOT USE
- `assets/testforms/` - DO NOT USE any path containing this

---

## Roadmap

### Phase 1: LOW Risk Changes

- [x] **L1** Replace Map with Record for color space grouping
- [x] **L2** Replace Map with Record for string-keyed caches
- [x] **L3** Cache `#getConversionConfig()` at batch level
- [x] **L4** Use numeric rendering intent constants
- [x] **L5** Pre-compute BufferRegistry config keys
- [x] **L6** Add size limits to color caches
- [x] **P1-VERIFY** Run tests after Phase 1 (60 passed, 0 failed, 50 skipped)
- [x] **P1-BENCHMARK** Run benchmark after Phase 1 (output: 2026-01-27-005)

### Phase 2: MEDIUM Risk Changes

- [ ] **M1** Replace `#referenceOverrides` Map with WeakMap
- [ ] **M2** Use WeakRef for ColorEngineService transforms
- [ ] **M3** Transform warm-up phase at document level
- [ ] **P2-VERIFY** Run tests after Phase 2
- [ ] **P2-BENCHMARK** Run benchmark after Phase 2

### Phase 3: HIGH Risk Changes

- [ ] **H1** Page-level color aggregation
- [ ] **P3-VERIFY** Run tests after Phase 3
- [ ] **P3-BENCHMARK** Run benchmark after Phase 3

---

## Current Status

**Phase:** 1 (LOW Risk)
**Current Task:** L1 - Replace Map with Record for color space grouping
**Last Updated:** 2026-01-27

---

## Activity Log

### 2026-01-27

- **Investigation complete** - Root cause identified, optimization plan created
- **Progress tracker created** - Ready to begin Phase 1
- **L1 complete** - Map → Record for color space grouping
- **L2 complete** - Map → Record for string-keyed caches
- **L3 complete** - Cache `#getConversionConfig()` at batch level
- **L4 complete** - Numeric rendering intent constants
- **L5 complete** - Pre-compute BufferRegistry config keys with WeakMap
- **L6 complete** - Size limits on color caches (50K buffer-registry, 10K fallback)
- **Phase 1 complete** - Tests: 60 passed, 0 failed. Benchmark: 2026-01-27-005
- **Phase 1 results**: Small file + Relative Colorimetric improved (now 1.5% faster). Large files and K-Only GCR unchanged.
- **Fixed** `--workers=N` argument handling in both new and legacy implementations
- **Added** Worker count confirmation with expected vs actual validation
- **Added** Warning when count differs, error only if workers expected but not used
- **Fixed** Import path issue in legacy/convert-pdf-color.js
- **Fixed** Legacy now properly supports workers via PDFService
- **Fixed** `generate-verification-matrix.mjs` worker count extraction - when config modality is just "Workers" (without number), use optimal worker count instead of defaulting to 0

---

## Phase 1 Details

### L1: Replace Map with Record for Color Space Grouping

**Files:**
- `buffer-registry.js:519` - `const groups = new Map()`
- `pdf-content-stream-color-converter.js:336` - `const groups = new Map()`

**Change:**
```javascript
// FROM:
const groups = new Map();
let group = groups.get(colorSpace);
if (!group) {
    group = { entries: [], colors: [] };
    groups.set(colorSpace, group);
}
for (const [colorSpace, data] of groups) { ... }

// TO:
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

### L2: Replace Map with Record for String-Keyed Caches

**Files:**
- `lookup-table-color-converter.js:106` - `#fallbackLookupTable = new Map()`
- `buffer-registry.js:154` - `#colorLookupCache = new Map()`
- `buffer-registry.js:161` - `#pendingColors = new Map()`

### L3: Cache `#getConversionConfig()` at Batch Level

**File:** `lookup-table-color-converter.js:153-161`

### L4: Use Numeric Rendering Intent Constants

**Files:**
- `color-converter.js` - Add constants
- `buffer-registry.js` - Update comparisons
- `pdf-content-stream-color-converter.js` - Update comparisons

### L5: Pre-compute BufferRegistry Config Keys

**File:** `buffer-registry.js:397-407, 443`

### L6: Add Size Limits to Color Caches

**Files:**
- `buffer-registry.js:154`
- `lookup-table-color-converter.js:106`

---

## Baseline Metrics (Pre-optimization)

### F-01 (Large PDF)

| Profile | Intent | Legacy | Refactored | Delta |
| ------- | ------ | ------ | ---------- | ----- |
| eciCMYK v2 | Relative Colorimetric | 8858ms | 10742ms | +21% |
| eciCMYK v2 | K-Only GCR | 10652ms | 12385ms | +16% |

### Type Sizes (Small PDF)

| Profile | Intent | Legacy | Refactored | Delta |
| ------- | ------ | ------ | ---------- | ----- |
| eciCMYK v2 | Relative Colorimetric | 884ms | 948ms | +7% |
| eciCMYK v2 | K-Only GCR | 1137ms | 1923ms | +69% |

---

## Post-Phase Metrics

### After Phase 1 (2026-01-27-005)

| File | Intent | Legacy | Refactored | Delta | vs Baseline |
| ---- | ------ | ------ | ---------- | ----- | ----------- |
| F-01 | Relative Colorimetric | 9085ms | 11001ms | +21% | No change |
| F-01 | K-Only GCR | 10769ms | 12617ms | +17% | No change |
| Type Sizes | Relative Colorimetric | 920ms | 906ms | **-1.5%** | **+8.5% improved** |
| Type Sizes | K-Only GCR | 1140ms | 1972ms | +73% | -4% worse |

### After Phase 2

| Profile | Intent | Legacy | Refactored | Delta | Improvement |
| ------- | ------ | ------ | ---------- | ----- | ----------- |
| (pending) | | | | | |

### After Phase 3

| Profile | Intent | Legacy | Refactored | Delta | Improvement |
| ------- | ------ | ------ | ---------- | ----- | ----------- |
| (pending) | | | | | |
