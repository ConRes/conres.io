# 2026-03-27 Scripts Migration Progress

## Last Updated: 2026-03-27

## Current Status: Planning — Awaiting Review

All paths relative to `testing/iso/ptf/`.

---

## Context

Migrating `2025/experiments/scripts/` into a clean `2026/experiments/` toolkit.

- `2026/classes/root/` and `2026/classes/legacy/` deleted — only `2026/classes/baseline/` exists
- `2026/experiments/classes/` already moved (content-stream-parser, delta-e-metrics, etc.)
- `2026/experiments/legacy/convert-pdf-color.js` already moved
- `2026/experiments/scripts/` already has `sync-generator-to-staging.mjs`, `trace-dependencies.mjs`, `test-max-gcr-detection.mjs`

### Target Structure

| Destination                         | Purpose                                                   | Audience     |
| ----------------------------------- | --------------------------------------------------------- | ------------ |
| `2026/experiments/`                 | Primary CLI tools — your go-to PDF toolkit                | You          |
| `2026/experiments/classes/`         | Helper classes for experiments (already moved)            | Shared       |
| `2026/experiments/configurations/`  | Verification matrix configs (already present)             | Shared       |
| `2026/experiments/internal/`        | Agent-facing tools, with README directing agents here     | Agents       |
| `2026/experiments/internal/legacy/` | Legacy procedural implementations (spawned by `--legacy`) | Spawned only |

### Design Principles

1. **Minimize primary surface** — `ls experiments/` should show only tools you actually reach for
2. **Consolidate features, not files** — useful capabilities from dropped scripts become flags on surviving tools
3. **Agents use `internal/`** — agent-facing tools live there with their own README, not cluttering your view
4. **Consistent CLI conventions** — `node:util` `parseArgs`, `allowPositionals: true`, `strict: true`, filtered empty positionals
5. **Descriptive names** — `<verb>-<subject>[-<qualifier>].js`, no opaque names

### Baseline Consolidation

The `-baseline` suffix is a leftover from the `root/` → `baseline/` refactor. Non-baseline variants import from deleted `classes/root/` and are broken. Drop the suffix — baseline IS the tool.

| Current Path                                     | Action                          | Result  |
| ------------------------------------------------ | ------------------------------- | ------- |
| `2026/experiments/convert-pdf-color.js`          | Revert to 2025 (broken)         | Gone    |
| `2026/experiments/convert-pdf-color-baseline.js` | Rename → `convert-pdf-color.js` | Primary |
| `2026/experiments/compare-pdf-color.js`          | Revert to 2025 (broken)         | Gone    |
| `2026/experiments/compare-pdf-color-baseline.js` | Rename → `compare-pdf-color.js` | Primary |
| `2026/experiments/tiff-diff-r1.js`               | Revert to 2025 (superseded)     | Gone    |

---

## Table 1: Leave Behind — Not Moving to 2026

All paths relative to `2025/experiments/scripts/`.

### 1a. Agent One-offs — Should Have Used Existing Tools

| #   | Path                              | Should Have Used                                   | Rationale                             |
| --- | --------------------------------- | -------------------------------------------------- | ------------------------------------- |
| 1   | `debug-colorspace.mjs`            | `analyze-pdf-structure.js --show-colorspaces`      | Same data, worse interface            |
| 2   | `debug-colorspace-defs.mjs`       | `analyze-pdf-structure.js --show-colorspaces`      | Same                                  |
| 3   | `debug-content-stream-output.mjs` | `inspect-content-stream-colors.js`                 | One-off, no reusable interface        |
| 4   | `debug-content-stream-lab.mjs`    | `inspect-content-stream-colors.js`                 | Inline regex duplicates tool's parser |
| 5   | `debug-rgb-colordefs.mjs`         | `analyze-pdf-structure.js --show-colorspaces`      | RGB-only subset                       |
| 6   | `debug-rgb-operators.mjs`         | `inspect-content-stream-colors.js`                 | RGB-only subset                       |
| 7   | `debug-rgb-conversion.mjs`        | `convert-pdf-color.js --verbose`                   | One-off conversion trace              |
| 8   | `debug-gray-conversion.mjs`       | `convert-pdf-color.js --verbose`                   | Same, for Gray                        |
| 9   | `debug-image-conversion.mjs`      | `convert-pdf-color.js --verbose`                   | Same, for single image                |
| 10  | `debug-conversion-trace.mjs`      | `trace-pdf-conversion.js`                          | Duplicates existing tool              |
| 11  | `debug-lab-colorspace.mjs`        | `analyze-pdf-structure.js --show-colorspaces`      | Lab-only subset                       |
| 12  | `debug-find-lab.mjs`              | `inspect-content-stream-colors.js`                 | Lab filter subset                     |
| 13  | `debug-lab-conversion-path.mjs`   | `convert-colors.js --verbose`                      | Traces Lab path through policy        |
| 14  | `debug-lab-precision-loss.mjs`    | `convert-colors.js --verbose`                      | Measures Lab precision                |
| 15  | `debug-rgb-format-path.mjs`       | `inspect-color-engine.js --dump-formats`           | RGB-only subset of format dump        |
| 16  | `debug-rgb-evaluation.mjs`        | `inspect-color-engine.js --dump-formats`           | Same                                  |
| 17  | `debug-operator-drift.mjs`        | `inspect-content-stream-colors.js` on before/after | Operator position comparison          |
| 18  | `debug-position.mjs`              | `inspect-content-stream-colors.js`                 | Operator position trace               |
| 19  | `debug-raw-stream.mjs`            | `inspect-content-stream-colors.js`                 | Raw stream with highlighting          |
| 20  | `debug-lab-16-to-float32.mjs`     | `inspect-color-engine.js --test-sampler`           | 16-bit Lab subset                     |

### 1b. Resolved Bugs, Completed Refactors, Dead Imports

| #   | Path                                      | Group       | Rationale                                             |
| --- | ----------------------------------------- | ----------- | ----------------------------------------------------- |
| 21  | `debug-copyright-bug.mjs`                 | Bug-fix     | Bug fixed, hardcoded                                  |
| 22  | `debug-sourceprofile-bug.js`              | Bug-fix     | Bug fixed                                             |
| 23  | `debug-refactored-conversion.mjs`         | Refactor    | Refactor completed                                    |
| 24  | `debug-parser-compare.mjs`                | Refactor    | Parser consolidated                                   |
| 25  | `debug-page1-ops.mjs`                     | Hardcoded   | Hardcoded to specific page                            |
| 26  | `debug-page3-images.js`                   | Hardcoded   | Hardcoded to specific page                            |
| 27  | `debug-raw-bytes.mjs`                     | One-off     | One-off low-level                                     |
| 28  | `debug-stream-decode.mjs`                 | One-off     | One-off                                               |
| 29  | `debug-stream-ops.mjs`                    | One-off     | Minimal, one-off                                      |
| 30  | `debug-stream-structure.mjs`              | One-off     | One-off                                               |
| 31  | `debug-pixel-diff.mjs`                    | Superseded  | Superseded by `pdf-diff.js` + `tiff-diff.js`          |
| 32  | `test-lab-srgb-roundtrip.js`              | Dead-import | Imports dead `2025/packages/color-engine-2025-12-15/` |
| 33  | `test-pdflib-encoding-browser.mjs`        | One-off     | One-off Playwright test                               |
| 34  | `test-pdflib-encoding-roundtrip.mjs`      | One-off     | Knowledge captured                                    |
| 35  | `test-args.mjs`                           | Throwaway   | Trivial (6 lines)                                     |
| 36  | `generate-verification-matrix copy.mjs`   | Stale-copy  | Replaced by baseline variant                          |
| 37  | `generate-verification-matrix copy 2.mjs` | Stale-copy  | Replaced by baseline variant                          |
| 38  | `generate-verification-matrix.mjs`        | Broken      | Non-baseline, imports deleted `2025/classes/root/`    |

### 1c. Thin Wrappers and Orphans

| #   | Path                             | Group    | Rationale                                  |
| --- | -------------------------------- | -------- | ------------------------------------------ |
| 39  | `run-cmyk-comparison.mjs`        | Runner   | 6-line wrapper — a shell alias, not a tool |
| 40  | `run-cmyk-conversion.mjs`        | Runner   | Same                                       |
| 41  | `run-comparison.mjs`             | Runner   | Same                                       |
| 42  | `run-rgb-conversion.mjs`         | Runner   | Same                                       |
| 43  | `pdf-conversion-worker.js`       | Orphan   | Not imported by anything                   |
| 44  | `test-rgb-16bit-byteswap.mjs`    | Resolved | Issue resolved, knowledge in MEMORY.md     |
| 45  | `verify-byteswap-workaround.mjs` | Resolved | Paired with above, both resolved           |

### 1d. Migration-era Tools — Purpose Served

Built for `root/` → `baseline/` migration. Migration done, `root/` deleted.

| #   | Path                                | Purpose                                                      | Rationale                                |
| --- | ----------------------------------- | ------------------------------------------------------------ | ---------------------------------------- |
| 46  | `benchmark-final.js`                | Benchmark root vs baseline conversion performance            | Migration complete                       |
| 47  | `benchmark-transform-methods.js`    | Benchmark root vs baseline transform methods                 | Same                                     |
| 48  | `benchmark-browser-isomorphic.js`   | Benchmark browser conversion during migration                | Same                                     |
| 49  | `compare-implementations.js`        | Compare root vs baseline output                              | Root deleted, nothing to compare         |
| 50  | `compare-worker-vs-main.js`         | Compare worker vs main thread parity                         | Parity verified                          |
| 51  | `verify-comparable-diagnostics.mjs` | Verify diagnostics between root and baseline                 | Root deleted                             |
| 52  | `verify-implementations.mjs`        | Verify root vs baseline produce identical output             | Root deleted                             |
| 53  | `compare-folders.js`                | Diff output folders during migration                         | General utility but served migration     |
| 54  | `generate-visual-tests.js`          | Generate visual test pages for migration comparison          | Migration complete                       |
| 55  | `test-profile-conversions.js`       | One-off profile roundtrip validation                         | Validation done                          |
| 56  | `baseline-capture.js`               | Capture engine baselines (uses old `ColorEngineService` API) | Old API, needs full rewrite to be useful |

### 1d Note: Reviewed for Absorption — Not Viable

| Dropped Script                   | Considered For                                    | Why Not                                                                                                                                 |
| -------------------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `compare-folders.js`             | `--compare-folders` on `compare-pdf-color.js`     | Only compares file sizes — too narrow for a flag                                                                                        |
| `baseline-capture.js`            | `--capture-baseline` on `inspect-color-engine.js` | Uses old `ColorEngineService` API (`convertColor`, `convertPixelBuffer`) not present in baseline — full rewrite, not import fix. Defer. |
| `benchmark-final.js`             | `internal/legacy/` spawn target                   | Parent tool (`benchmark-pdf-conversion.js`) itself left behind — orphaned                                                               |
| `benchmark-transform-methods.js` | `internal/legacy/` spawn target                   | Same — parent left behind                                                                                                               |

---

## Table 2: Revert — Already in 2026 But Should Not Be

| #   | Current Path                              | Revert To                                 | Rationale                                     |
| --- | ----------------------------------------- | ----------------------------------------- | --------------------------------------------- |
| 1   | `2026/experiments/convert-pdf-color.js`   | `2025/experiments/convert-pdf-color.js`   | Broken — imports deleted `2026/classes/root/` |
| 2   | `2026/experiments/compare-pdf-color.js`   | `2025/experiments/compare-pdf-color.js`   | Broken — imports `pdf-lib` from node_modules  |
| 3   | `2026/experiments/tiff-diff-r1.js`        | `2025/experiments/tiff-diff-r1.js`        | Superseded by `2026/experiments/tiff-diff.js` |
| 4   | `2026/experiments/color-engine-benchmark.js` | `2025/experiments/color-engine-benchmark.js` | Migration-era benchmark, purpose served    |

---

## Table 3: Primary Tools — `2026/experiments/`

Your go-to tools. 9 tool files + README when you `ls experiments/`.

### 3a. Rename in Primary (already in `2026/experiments/`)

| #   | Current Path                                     | Renamed Path                            | Rationale                               |
| --- | ------------------------------------------------ | --------------------------------------- | --------------------------------------- |
| 1   | `2026/experiments/convert-pdf-color-baseline.js` | `2026/experiments/convert-pdf-color.js` | Drop `-baseline` — only working version |
| 2   | `2026/experiments/compare-pdf-color-baseline.js` | `2026/experiments/compare-pdf-color.js` | Same                                    |

### 3b. Rename and Move to Internal (already in `2026/experiments/`)

| #   | Current Path                                          | Moved To                                               | Rationale                                              |
| --- | ----------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------ |
| 3   | `2026/experiments/comprehensive-k-only-diagnostic.js` | `2026/experiments/internal/diagnose-k-only-gcr.js`     | Descriptive name; agent-facing diagnostic              |
| 4   | `2026/experiments/diagnose-worker-content-streams.js` | `2026/experiments/internal/diagnose-worker-streams.js` | Shorter name; agent-facing; needs 2025→2026 path fix   |
| 5   | `2026/experiments/convert-diagnostics-profile.js`     | `2026/experiments/internal/convert-diagnostics-profile.js` | Agent-facing; add flags from consolidation (Table 5) |
| 6   | `2026/experiments/extract-pdf-text.js`                | `2026/experiments/internal/extract-pdf-text.js`        | Agent-facing; fix pdf-lib import                       |
| 7   | `2026/experiments/parse-preflight-report.js`          | `2026/experiments/internal/parse-preflight-report.js`  | Agent-facing                                           |

### 3c. Move from `2025/experiments/scripts/`

| #   | Source Path                                                          | Destination Path                                    | Refactor Needed                          |
| --- | -------------------------------------------------------------------- | --------------------------------------------------- | ---------------------------------------- |
| 8   | `2025/experiments/scripts/generate-verification-matrix-baseline.mjs` | `2026/experiments/generate-verification-matrix.mjs` | `../classes/` → `classes/` (now sibling) |

### 3d. Existing — Unchanged

| #   | Path                                        | Notes                                  |
| --- | ------------------------------------------- | -------------------------------------- |
| 9   | `2026/experiments/analyze-pdf-structure.js` | Add flags from consolidation (Table 5); fix pdf-lib import |
| 10  | `2026/experiments/compare-pdf-outputs.js`   | Fix pdf-lib import                     |
| 11  | `2026/experiments/pdf-diff.js`              | Add flags from consolidation (Table 5); fix pdf-lib import |
| 12  | `2026/experiments/tiff-diff.js`             | No change                              |
| 13  | `2026/experiments/validate-pdf.js`          | Fix pdf-lib import                     |

---

## Table 4: Internal Tools — `2026/experiments/internal/`

Agent-facing tools and legacy spawns. `internal/README.md` directs agents here.

### 4a. Move from `2025/experiments/scripts/` (need refactoring)

All dual-mode tools need `../../classes/` → `../../classes/baseline/` and `--legacy` path → `legacy/`.

| #   | Source Path                                                 | Destination Path                                             | Refactor Needed                               |
| --- | ----------------------------------------------------------- | ------------------------------------------------------------ | --------------------------------------------- |
| 1   | `2025/experiments/scripts/convert-colors.js`                | `2026/experiments/internal/convert-colors.js`                | Imports → `baseline/`, `--legacy` → `legacy/` |
| 2   | `2025/experiments/scripts/inspect-content-stream-colors.js` | `2026/experiments/internal/inspect-content-stream-colors.js` | Same                                          |
| 3   | `2025/experiments/scripts/trace-pdf-conversion.js`          | `2026/experiments/internal/trace-pdf-conversion.js`          | Same                                          |
| 4   | `2025/experiments/scripts/analyze-image-masking.mjs`        | `2026/experiments/internal/analyze-image-masking.mjs`        | None                                          |
| 5   | `2025/experiments/scripts/compare-color-values.js`          | `2026/experiments/internal/compare-color-values.js`          | None                                          |

### 4b. New Consolidated Tools (created in `2026/experiments/internal/`)

#### `2026/experiments/internal/inspect-color-engine.js`

Consolidated color engine inspection and validation. Absorbs 5 scripts + `baseline-capture.js` features.

```
Usage:
  node inspect-color-engine.js <mode> [options]

Modes:
  --dump-formats              Dump all format constants and policy mappings
  --test-format=<colorspace>  Test format resolution (Gray, RGB, CMYK, Lab)
  --test-sampler              Test 16-bit image sampling path
  --smoke-test                Smoke test all color spaces with fresh engine
  --noise-test                Engine determinism/noise characterization
  --capture-baseline          Capture conversion baselines for engine version comparison
```

| #   | Source Path (from `2025/experiments/scripts/`) | Becomes Mode         | Refactor Needed                                                         |
| --- | ---------------------------------------------- | -------------------- | ----------------------------------------------------------------------- |
| 6   | `debug-format-constants.mjs`                   | `--dump-formats`     | `../../classes/` → `../../classes/baseline/`                            |
| 7   | `debug-gray-format.mjs`                        | `--test-format=Gray` | Same                                                                    |
| 8   | `debug-sampler-16bit.mjs`                      | `--test-sampler`     | `../../classes/pdf-image-color-sampler.js` → `baseline/`                |
| 9   | `test-all-colorspaces-fresh.mjs`               | `--smoke-test`       | `../../classes/color-engine-provider.js` → `baseline/`                  |
| 10  | `test-color-engine-noise.js`                   | `--noise-test`       | None (`../../packages/color-engine/`)                                   |
| 11  | `baseline-capture.js`                          | `--capture-baseline` | Full rewrite: `ColorEngineService` → baseline `ColorEngineProvider` API |

#### `2026/experiments/internal/test-experiment-classes.js`

Consolidated test runner for `2026/experiments/classes/`.

```
Usage:
  node test-experiment-classes.js [--suite=<name>] [--verbose]

Suites:
  --suite=all                          Run all suites (default)
  --suite=color-change-metrics         Test ColorChangeMetrics
  --suite=comparison-classes           Test ComparisonsCoordinator + DeltaEMetrics + ImageSampler + ImageLabConverter
  --suite=content-stream-extractor     Test ContentStreamColorExtractor
  --suite=delta-e                      Test Delta-E computation with real PDFs
```

| #   | Source Path (from `2025/experiments/scripts/`) | Becomes Suite              | Path Fix Needed                                          |
| --- | ---------------------------------------------- | -------------------------- | -------------------------------------------------------- |
| 12  | `test-color-change-metrics.mjs`                | `color-change-metrics`     | `../classes/` → `../classes/` (correct from `internal/`) |
| 13  | `test-comparison-classes.mjs`                  | `comparison-classes`       | `./classes/` → `../classes/`                             |
| 14  | `test-comparisons-coordinator.mjs`             | `comparisons-coordinator`  | `../classes/` → `../classes/` (correct)                  |
| 15  | `test-content-stream-color-extractor.mjs`      | `content-stream-extractor` | `../classes/` → `../classes/` (correct)                  |
| 16  | `test-delta-e-computation.mjs`                 | `delta-e`                  | `./classes/` → `../classes/`                             |

### 4c. Legacy Variants — `2026/experiments/internal/legacy/`

Spawned by `--legacy` flag on dual-mode tools. Not invoked directly.

| #   | Source Path                                                        | Destination Path                                                    |
| --- | ------------------------------------------------------------------ | ------------------------------------------------------------------- |
| 17  | `2026/experiments/legacy/convert-pdf-color.js`                     | `2026/experiments/internal/legacy/convert-pdf-color.js`             |
| 18  | `2025/experiments/scripts/legacy/convert-colors.js`                | `2026/experiments/internal/legacy/convert-colors.js`                |
| 19  | `2025/experiments/scripts/legacy/inspect-content-stream-colors.js` | `2026/experiments/internal/legacy/inspect-content-stream-colors.js` |
| 20  | `2025/experiments/scripts/legacy/trace-pdf-conversion.js`          | `2026/experiments/internal/legacy/trace-pdf-conversion.js`          |

Note: `legacy/benchmark-final.js` and `legacy/benchmark-transform-methods.js` are NOT moved — their parent tools are left behind (Table 1d).

### 4d. Miscellaneous Internal

| #   | Source Path                                               | Destination Path                                           | Purpose            |
| --- | --------------------------------------------------------- | ---------------------------------------------------------- | ------------------ |
| 23  | `2025/experiments/scripts/diagnose-worker-lifecycle.html` | `2026/experiments/internal/diagnose-worker-lifecycle.html` | Browser diagnostic |

---

## Table 5: Consolidate Features Into Existing Tools

Useful capabilities from dropped scripts absorbed as flags on surviving tools.

### 5a. New flags on `2026/experiments/analyze-pdf-structure.js`

| #   | Source (from `2025/experiments/scripts/`) | Becomes Flag        | What It Adds                                        |
| --- | ----------------------------------------- | ------------------- | --------------------------------------------------- |
| 1   | `check-pdf-bitdepths.mjs`                 | `--show-bitdepths`  | BitsPerComponent per image                          |
| 2   | `debug-image-masks.mjs`                   | `--show-masks`      | SMask, Mask, ImageMask properties per image         |
| 3   | `debug-image-placement-detail.mjs`        | `--show-placement`  | CTM and placement context for each image Do         |
| 4   | `debug-16bit-endian.mjs`                  | `--show-endianness` | First bytes of 16-bit image data with byte ordering |

### 5b. New flags on `2026/experiments/convert-diagnostics-profile.js`

| #   | Source (from `2025/experiments/scripts/`) | Becomes Flag           | What It Adds                                      |
| --- | ----------------------------------------- | ---------------------- | ------------------------------------------------- |
| 5   | `check-diagnostics-replacements.mjs`      | `--check-replacements` | Verify replacement counts between two diagnostics |
| 6   | `inspect-diagnostics.mjs`                 | `--inspect`            | Pretty-print diagnostics JSON structure           |

### 5c. New flags on `2026/experiments/pdf-diff.js`

| #   | Source (from `2025/experiments/scripts/`) | Becomes Flag | What It Adds                                  |
| --- | ----------------------------------------- | ------------ | --------------------------------------------- |
| 7   | `check-pixel-diff.mjs`                    | `--quick`    | Lightweight pixel diff without Lab conversion |

---

## Table 6: Already in Place

| #   | Path                                                     | Notes         |
| --- | -------------------------------------------------------- | ------------- |
| 1   | `2026/experiments/scripts/sync-generator-to-staging.mjs` | Already moved |
| 2   | `2026/experiments/scripts/test-max-gcr-detection.mjs`    | Already moved |
| 3   | `2026/experiments/scripts/trace-dependencies.mjs`        | Already moved |

---

## Known Issues in Existing `2026/experiments/` Files

Issues found during deep review that must be addressed during or after migration.

### pdf-lib npm vs vendored

Several existing tools use `from 'pdf-lib'` (npm) instead of `from '../packages/pdf-lib/pdf-lib.esm.js'` (vendored). Both work today since pdf-lib is in both locations, but the vendored path is the correct convention for 2026.

| File                                        | Uses npm pdf-lib                    | Fix                |
| ------------------------------------------- | ----------------------------------- | ------------------ |
| `2026/experiments/analyze-pdf-structure.js` | Yes                                 | Change to vendored |
| `2026/experiments/compare-pdf-outputs.js`   | Yes (mixed — also uses `baseline/`) | Change to vendored |
| `2026/experiments/extract-pdf-text.js`      | Yes                                 | Change to vendored |
| `2026/experiments/pdf-diff.js`              | Yes                                 | Change to vendored |
| `2026/experiments/validate-pdf.js`          | Yes                                 | Change to vendored |

### `diagnose-worker-content-streams.js` hardcodes 2025 paths

Imports `ColorConversionUtils` from `2025/services/`, pdf-lib from `2025/packages/`, LittleCMS from `2025/packages/` via absolute `WORKSPACE_ROOT` resolution. Also a migration-era worker-vs-main comparison tool. **Decision needed: refactor to 2026 paths or demote to leave-behind.**

---

## Final Inventory

### `2026/experiments/` — Primary Tools (14 files)

| #   | Path                                                | Status           | Source                                                                                                                                      |
| --- | --------------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `2026/experiments/analyze-pdf-structure.js`         | Existing + flags | Add `--show-bitdepths`, `--show-masks`, `--show-placement`, `--show-endianness`; fix pdf-lib import                                         |
| 2   | `2026/experiments/benchmark-color-engine.js`        | Renamed          | From `2026/experiments/color-engine-benchmark.js`                                                                                           |
| 3   | `2026/experiments/compare-pdf-color.js`             | Renamed          | From `-baseline.js`                                                                                                                         |
| 4   | `2026/experiments/compare-pdf-outputs.js`           | Existing         | Fix pdf-lib import                                                                                                                          |
| 5   | `2026/experiments/convert-pdf-color.js`             | Renamed          | From `-baseline.js`                                                                                                                         |
| 6   | `2026/experiments/generate-verification-matrix.mjs` | New              | From `2025/.../generate-verification-matrix-baseline.mjs`                                                                                   |
| 7   | `2026/experiments/pdf-diff.js`                      | Existing + flag  | Add `--quick`; fix pdf-lib import                                                                                                           |
| 8   | `2026/experiments/tiff-diff.js`                     | Existing         | No change                                                                                                                                   |
| 9   | `2026/experiments/validate-pdf.js`                  | Existing         | Fix pdf-lib import                                                                                                                          |
| 10  | `2026/experiments/README.md`                        | **Created**      | Accessible explainer for humans, directs agents and humans to linked sections in internal/README.md for additional available internal tools |

### `2026/experiments/internal/` — Agent and Supporting Tools (9 files)

| #   | Path                                                         | Status           | Source                                                                                 |
| --- | ------------------------------------------------------------ | ---------------- | -------------------------------------------------------------------------------------- |
| 1   | `2026/experiments/internal/analyze-image-masking.mjs`        | New              | From `2025/.../analyze-image-masking.mjs`                                              |
| 2   | `2026/experiments/internal/compare-color-values.js`          | New              | From `2025/.../compare-color-values.js`                                                |
| 3   | `2026/experiments/internal/convert-colors.js`                | New + refactor   | From `2025/.../convert-colors.js`; imports → `baseline/`                               |
| 4   | `2026/experiments/internal/inspect-color-engine.js`          | **Created**      | Consolidates 6 scripts (Table 4b)                                                      |
| 5   | `2026/experiments/internal/inspect-content-stream-colors.js` | New + refactor   | From `2025/.../inspect-content-stream-colors.js`; imports → `baseline/`                |
| 6   | `2026/experiments/internal/test-experiment-classes.js`       | **Created**      | Consolidates 5 scripts (Table 4b)                                                      |
| 7   | `2026/experiments/internal/trace-pdf-conversion.js`          | New + refactor   | From `2025/.../trace-pdf-conversion.js`; imports → `baseline/`                         |
| 8   | `2026/experiments/internal/diagnose-worker-lifecycle.html`   | New              | From `2025/.../diagnose-worker-lifecycle.html`                                         |
| 9   | `2026/experiments/internal/convert-diagnostics-profile.js`   | Existing + flags | Add `--check-replacements`, `--inspect`                                                |
| 10  | `2026/experiments/internal/diagnose-k-only-gcr.js`           | Renamed          | From `comprehensive-k-only-diagnostic.js`                                              |
| 11  | `2026/experiments/internal/diagnose-worker-streams.js`       | Renamed          | From `diagnose-worker-content-streams.js`; **needs 2025→2026 path refactor**           |
| 12  | `2026/experiments/internal/extract-pdf-text.js`              | Existing         | Fix pdf-lib import                                                                     |
| 13  | `2026/experiments/internal/parse-preflight-report.js`        | Existing         | No change                                                                              |
| 14  | `2026/experiments/internal/README.md`                        | **Created**      | Accessible explainer for humans, directs agents and humans to available internal tools |

### `2026/experiments/internal/legacy/` — Legacy Spawns (4 files)

| #   | Path                                                                | Source                                                             |
| --- | ------------------------------------------------------------------- | ------------------------------------------------------------------ |
| 1   | `2026/experiments/internal/legacy/convert-colors.js`                | `2025/experiments/scripts/legacy/convert-colors.js`                |
| 2   | `2026/experiments/internal/legacy/convert-pdf-color.js`             | `2026/experiments/legacy/convert-pdf-color.js`                     |
| 3   | `2026/experiments/internal/legacy/inspect-content-stream-colors.js` | `2025/experiments/scripts/legacy/inspect-content-stream-colors.js` |
| 4   | `2026/experiments/internal/legacy/trace-pdf-conversion.js`          | `2025/experiments/scripts/legacy/trace-pdf-conversion.js`          |

Note: `legacy/benchmark-final.js` and `legacy/benchmark-transform-methods.js` NOT moved — parent tools left behind (Table 1d).

### `2026/experiments/scripts/` — Operational Scripts (3 files, already in place)

| #   | Path                                                     |
| --- | -------------------------------------------------------- |
| 1   | `2026/experiments/scripts/sync-generator-to-staging.mjs` |
| 2   | `2026/experiments/scripts/test-max-gcr-detection.mjs`    |
| 3   | `2026/experiments/scripts/trace-dependencies.mjs`        |

---

## Summary

| Category                             | Input   | Result                                                         |
| ------------------------------------ | ------- | -------------------------------------------------------------- |
| Leave behind (Table 1)               | 56      | Stay in 2025 only                                              |
| Revert to 2025 (Table 2)             | 4       | `git mv` back                                                  |
| Primary tools (Table 3)              | 10      | 5 existing + 2 renamed + 1 moved + 1 README + 1 created       |
| Internal tools (Table 4)             | 24      | 5 moved from 2025 + 5 moved from primary + 2 created + 4 legacy + 1 HTML + 2 README |
| Consolidate into tools (Table 5)     | 7       | 0 new files, 7 new flags on 3 tools (now split primary/internal) |
| Already in scripts (Table 6)         | 3       | Already in place                                               |
| **Total**                            | **104** | **10 primary + 14 internal + 4 legacy + 3 scripts = 31 files** |

When you `ls 2026/experiments/*.{js,mjs}`: **9 tool files + README**.

Additional cleanup during migration: fix `from 'pdf-lib'` → vendored in 5 tools (4 primary, 1 internal).

---

## Phased Execution Plan

Ordered by precedence: reverts → renames → restructure → moves → consolidation → validation.

### Phase 0: Revert broken/obsolete files from 2026 to 2025 (Table 2)

- [ ] `git mv 2026/experiments/convert-pdf-color.js 2025/experiments/convert-pdf-color.js`
- [ ] `git mv 2026/experiments/compare-pdf-color.js 2025/experiments/compare-pdf-color.js`
- [ ] `git mv 2026/experiments/tiff-diff-r1.js 2025/experiments/tiff-diff-r1.js`
- [ ] `git mv 2026/experiments/color-engine-benchmark.js 2025/experiments/color-engine-benchmark.js`

### Phase 1: Rename and restructure in 2026 (Table 3a, 3b)

Primary renames:

- [ ] `git mv 2026/experiments/convert-pdf-color-baseline.js 2026/experiments/convert-pdf-color.js`
- [ ] `git mv 2026/experiments/compare-pdf-color-baseline.js 2026/experiments/compare-pdf-color.js`

Create internal structure and move from primary to internal:

- [ ] Create `2026/experiments/internal/legacy/`
- [ ] `git mv 2026/experiments/comprehensive-k-only-diagnostic.js 2026/experiments/internal/diagnose-k-only-gcr.js`
- [ ] `git mv 2026/experiments/diagnose-worker-content-streams.js 2026/experiments/internal/diagnose-worker-streams.js`
- [ ] `git mv 2026/experiments/convert-diagnostics-profile.js 2026/experiments/internal/convert-diagnostics-profile.js`
- [ ] `git mv 2026/experiments/extract-pdf-text.js 2026/experiments/internal/extract-pdf-text.js`
- [ ] `git mv 2026/experiments/parse-preflight-report.js 2026/experiments/internal/parse-preflight-report.js`

Move legacy spawns to internal:

- [ ] `git mv 2026/experiments/legacy/convert-pdf-color.js 2026/experiments/internal/legacy/convert-pdf-color.js`
- [ ] `git mv 2025/experiments/scripts/legacy/convert-colors.js 2026/experiments/internal/legacy/convert-colors.js`
- [ ] `git mv 2025/experiments/scripts/legacy/inspect-content-stream-colors.js 2026/experiments/internal/legacy/inspect-content-stream-colors.js`
- [ ] `git mv 2025/experiments/scripts/legacy/trace-pdf-conversion.js 2026/experiments/internal/legacy/trace-pdf-conversion.js`
- [ ] `git mv 2025/experiments/scripts/diagnose-worker-lifecycle.html 2026/experiments/internal/diagnose-worker-lifecycle.html`
- [ ] Remove empty `2026/experiments/legacy/`
- [ ] Note: `legacy/benchmark-final.js` and `legacy/benchmark-transform-methods.js` stay in 2025 (parent tools left behind)

### Phase 2: Move primary tool from 2025 (Table 3c)

- [ ] `git mv 2025/experiments/scripts/generate-verification-matrix-baseline.mjs 2026/experiments/generate-verification-matrix.mjs`
- [ ] Update `../classes/` → `classes/` (now sibling to `classes/`)
- [ ] Verify loads with `--help`

### Phase 3: Move and refactor internal tools from 2025 (Table 4a)

- [ ] `git mv 2025/experiments/scripts/convert-colors.js 2026/experiments/internal/convert-colors.js`
- [ ] `git mv 2025/experiments/scripts/inspect-content-stream-colors.js 2026/experiments/internal/inspect-content-stream-colors.js`
- [ ] `git mv 2025/experiments/scripts/trace-pdf-conversion.js 2026/experiments/internal/trace-pdf-conversion.js`
- [ ] `git mv 2025/experiments/scripts/analyze-image-masking.mjs 2026/experiments/internal/analyze-image-masking.mjs`
- [ ] `git mv 2025/experiments/scripts/compare-color-values.js 2026/experiments/internal/compare-color-values.js`
- [ ] Update `../../classes/<file>.js` → `../../classes/baseline/<file>.js` in dual-mode tools
- [ ] Update `--legacy` dynamic import path to `legacy/` (relative to `internal/`)
- [ ] Verify each loads with `--help` and `--legacy`

### Phase 4: Create consolidated internal tools (Table 4b)

- [ ] Create `2026/experiments/internal/inspect-color-engine.js` with 6 modes
- [ ] Create `2026/experiments/internal/test-experiment-classes.js` with 5 suites
- [ ] Verify all modes/suites run

### Phase 5: Consolidate features into tools (Table 5) and fix imports

Primary tools:

- [ ] Add `--show-bitdepths`, `--show-masks`, `--show-placement`, `--show-endianness` to `2026/experiments/analyze-pdf-structure.js`
- [ ] Add `--quick` to `2026/experiments/pdf-diff.js`
- [ ] Fix `from 'pdf-lib'` → vendored in: `analyze-pdf-structure.js`, `compare-pdf-outputs.js`, `pdf-diff.js`, `validate-pdf.js`

Internal tools:

- [ ] Add `--check-replacements`, `--inspect` to `2026/experiments/internal/convert-diagnostics-profile.js`
- [ ] Fix `from 'pdf-lib'` → vendored in: `internal/extract-pdf-text.js`
- [ ] Fix `2025/` hardcoded paths in `internal/diagnose-worker-streams.js` → 2026 equivalents
- [ ] Verify new flags and fixed imports work

### Phase 6: Create READMEs

- [ ] Create `2026/experiments/README.md` — accessible explainer, links to `internal/README.md`
- [ ] Create `2026/experiments/internal/README.md` — table of internal tools with purpose and usage

### Phase 7: Final validation

- [ ] Run each primary tool with `--help` — confirm 9 tools load
- [ ] Run `2026/experiments/generate-verification-matrix.mjs` end-to-end with a config
- [ ] Run `2026/experiments/internal/convert-colors.js` with and without `--legacy`
- [ ] Run `2026/experiments/internal/inspect-color-engine.js --smoke-test`
- [ ] Run `2026/experiments/internal/test-experiment-classes.js --suite=all`
- [ ] Final `ls`: confirm `2026/experiments/*.{js,mjs}` shows exactly 9 tool files + README
- [ ] Update any remaining hardcoded `2025` paths to `2026`

---

## Activity Log

### 2026-03-27

- Created progress document
- Inventoried all 83 scripts in `2025/experiments/scripts/` + 16 files already in `2026/experiments/`
- Classified 104 total items across 6 tables
- Identified 56 scripts to leave behind:
  - 20 agent one-offs that should have used existing tools
  - 18 resolved bugs, completed refactors, dead imports, stale copies
  - 11 migration-era tools whose purpose is served (including 4 not viable for absorption)
  - 7 thin wrappers and orphans
  - 11 migration-era tools whose purpose is served
- Identified 3 files to revert from 2026 to 2025
- Consolidated `-baseline` suffix: baseline IS the tool, drop the qualifier
- Reduced primary tool surface from 32 to 14 by moving agent-facing tools to `internal/`
- Designed consolidation:
  - 8 features → flags on 4 existing primary tools
  - 11 scripts → 2 new consolidated internal tools
- Designed `internal/` with README for agent discovery
- Applied descriptive renaming throughout
- Defined 8-phase execution plan: reverts → renames → restructure → moves → consolidation → validation
- Second review: found 5 primary tools using npm pdf-lib instead of vendored, `diagnose-worker-content-streams.js` hardcodes 2025 paths, orphaned benchmark legacy entries removed, `compare-folders.js` and `baseline-capture.js` not viable for absorption
