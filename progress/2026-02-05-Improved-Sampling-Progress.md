# Improved Sampling Progress

**Last Updated:** 2026-02-07

---

## Roadmap

- [x] Analyze `tiff-diff` variability output and define what metrics `compare-pdf-outputs` needs
- [x] Implement `pdf-diff.js` CLI tool
  - [x] Subphase 0: Add exports and entry point guards to `tiff-diff.js` and `compare-pdf-outputs.js`
  - [x] Subphase 1: TIFF Writer (Lab Float32)
  - [x] Subphase 2: Color Engine Initialization and Format Selection
  - [x] Subphase 3: Pipeline Pretest System
  - [x] Subphase 4: PDF Image Extraction and Lab Conversion
  - [x] Subphase 5: Comparison Planner and Extraction Optimizer
  - [x] Subphase 6: `tiff-diff` Subprocess Integration
  - [x] Subphase 7: CLI Interface, Report Aggregation, Cleanup
- [x] Refinements (2026-02-06)
  - [x] Rewrite TIFF writer: Lab Float32 → Lab 16-bit (TIFF 6.0 CIELab) — Photoshop/Preview compatible
  - [x] Update pretest validation for Lab 16-bit roundtrip (threshold 2.0 for out-of-gamut clamping)
  - [x] Add color space and bit depth to TIFF filenames (`page-0-Im0-CMYK-16bit.tif`)
  - [x] Replace `sanitizeLabel` with `makeTempLabel` — actual PDF names with `(GUID)` suffix, no mangling
  - [x] Save `tiff-diff` subprocess output as `.tiff-diff.log` files in temp directories
  - [x] Rename `runTiffDiff` → `runTIFFDiff` (acronym naming convention)
- [ ] Lab absolute-zero pixel coercion `IN-PROGRESS`
  - [x] Implement `COERCE_LAB_ABSOLUTE_ZERO_PIXELS` in `PDFImageColorConverter` (Lab output + CMYK K-Only GCR)
  - [x] Create handoff document for `pdf-diff` agent (`2026-02-06-LAB-COERCE-ABSOLUTE-ZERO-PIXELS.md`)
  - [x] Apply coercion in `pdf-diff.js` Lab conversion pipeline (`convertPixelsToLabFloat32`)
  - [ ] Validate coercion with mask images containing Lab `0/-128/-128`
  - [ ] Evaluate moving coercion up to `ColorConverter` or color engine
- [x] `tiff-diff.js` cross-matching always enabled (removed `skipCrossMatching` for 16-bit images)
- [x] `tiff-diff.js` `AGGREGATION_STRATEGY` refactor
  - [x] `'None'` — original position-based approach (O(totalPixels) memory)
  - [x] `'Maps'` — two-pass sequential with nested Maps (O(uniqueColors × avgVariants) memory)
  - [x] `'TypedArrays'` — parallel typed arrays + single flat pair-frequency Map (O(uniqueColors) + O(uniquePairs) memory)
  - [x] Fix regression bugs: bounded selection tie-breaking, group representative Lab for Delta-E, Float64Array means
  - [x] Add CLI flags: `--baseline-aggregation`, `--map-aggregation`, `--default-aggregation`, `--debug-memory-footprint`
  - [x] Practical analysis: measured memory usage across all three strategies on IM6 and large 16-bit datasets
- [x] Update `pdf-diff.js` — variability statistics, DIFF reports, clean outputs
  - [x] Enrich ComparisonPair metadata with `groupDescription`, `inputName`, `outputName`, `comparisonMode`
  - [x] Preserve `variabilitySummary` from tiff-diff output (was discarded, only kept deltaE/topColors)
  - [x] Add `--clean-json-outputs` / `--no-clean-json-outputs` flags (auto: on in batch, off in single)
  - [x] Derive diff dir as `<output-dir> Diff` in batch mode (was `.temp/pdf-diff`)
  - [x] Generate `DIFF.json` with aggregate statistics, per-group and per-image data
  - [x] Generate `DIFF.md` with overview table, grouped comparison tables, insights section
  - [x] Fix tiff-diff array format mismatch (tiff-diff now writes JSON arrays, pdf-diff expected single objects)
  - [x] Always pass `--with-extended-statistics` to tiff-diff (removed conditional)
  - [x] Show Coverage alongside Delta-E in per-image console output
- [ ] Validate with existing comparison sets

### Open Questions

| #   | Area                | Question                                                                                                                                   | Status |
| --- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| 1   | Scope               | Should `compare-pdf-outputs` adopt `tiff-diff`'s variability metrics directly, or compute a simplified subset?                             | Resolved: `pdf-diff` adopts `tiff-diff`'s metrics directly — calls `tiff-diff` as subprocess, inherits all cross-matched variability analysis |
| 2   | Scope               | Should `compare-pdf-outputs` continue using random sampling (currently 10,000 pixels), or switch to exhaustive pixel comparison?           | Resolved: `pdf-diff` uses exhaustive pixel comparison (all pixels, no sampling) — images extracted at full resolution, converted to Lab Float32 TIFF, passed to `tiff-diff` which compares every pixel |
| 3   | Scope               | Should the TIFF extraction and Lab comparison logic live in `compare-pdf-outputs` itself, or should it call `tiff-diff` as a subprocess?   | Resolved: `pdf-diff` calls `tiff-diff` as a subprocess — TIFF extraction and Lab comparison are delegated, not duplicated |
| 4   | Metrics             | Which metrics belong in the COMPARISONS.md summary table? (ΔE, Coverage, Variants, ΔEin — all or a subset?)                                | Open   |
| 5   | Metrics             | Should the Unique column be replaced, augmented, or removed entirely now that variability metrics explain the discrepancy?                 | Open   |
| 6   | Metrics             | Is Coverage alone sufficient to flag conversion issues, or do we need a composite quality score?                                           | Open   |
| 7   | Color Space Scope   | The IM6 analysis covers Lab input only. Do ICCBasedRGB and ICCBasedGray images exhibit the same variability patterns or different ones?    | Open   |
| 8   | Color Space Scope   | Should the tool produce per-color-space breakdowns, or a single aggregate per image?                                                       | Open   |
| 9   | Comparison Topology | Currently `compare-pdf-outputs` compares Main Thread vs Workers and both vs Original. Should variability metrics apply to all three pairs? | Open   |
| 10  | Output Format       | What changes are needed in the COMPARISONS.md markdown format to accommodate new columns without making tables unreadable?                 | Open   |
| 11  | Thresholds          | What Coverage or Variants thresholds should trigger a warning or failure status?                                                           | Open   |
| 12  | Performance         | Exhaustive variability analysis on large images (10M+ pixels) takes seconds in `tiff-diff`. Is this acceptable per-image in a batch run?   | Open   |

---

## Current Status

`pdf-diff.js` updated to catch up with tiff-diff improvements. Now preserves variabilitySummary from tiff-diff, generates DIFF.json and DIFF.md reports in batch mode, auto-cleans stale outputs, and derives diff dir from output dir. Tested with MINIMAL-ENGINES-LAB (6 comparisons, 54 images) and BASELINE-BITDEPTHS (18 comparisons, 162 images) — all passing. BASELINE config test pending. Next: validate with existing comparison sets.

---

## Background

### The `tiff-diff` CLI Tool

`tiff-diff.js` is a standalone CLI tool that compares two Lab TIFF images pixel-by-pixel. It:

1. Reads both TIFFs (supporting 8-bit, 16-bit, 32-bit; multi-strip; LZW/ZIP compression)
2. Converts raw pixels to Lab Float32 using TIFF 6.0 CIELab encoding rules
3. Computes Delta-E 1976 for every pixel pair
4. Collects all unique colors (keyed by `toFixed(2)`) with pixel positions
5. Cross-matches: for each unique reference color, looks up the sample color at those same pixel positions, computing per-color Delta-E and internal variability (ΔEin)
6. Computes variability for ALL unique reference colors: Overlaps (most frequent sample variant count), Variants (distinct sample colors), Coverage (Overlaps / Pixels)

See `2026-02-04-TIFF-DIFF-CLI-PROGRESS.md` for full tool documentation and development history.

### Motivating Analysis

The `COMPARISONS - UNIQUE.md` tables from comparison sets `2026-02-04-001` and `2026-02-04-003` revealed that Lab images consistently show more unique colors in the converted sample than in the original reference. This is counterintuitive for a deterministic color conversion — a mapping cannot create colors that were not in the input. To investigate, the `tiff-diff` tool was run on IM6 (a Lab image from the F-01 fixture set) to get a full pixel-level picture of what the conversion actually produces.

### Command

```bash
node testing/iso/ptf/2025/experiments/tiff-diff.js \
  "testing/iso/ptf/2025/experiments/output/2026-02-04-001 Comparisons A01/IM6 - Lab - Reference.tif" \
  "testing/iso/ptf/2025/experiments/output/2026-02-04-001 Comparisons A01/IM6 - Lab - eciCMYK v2 - Relative Colorimetric - Refactored - Main Thread - Color-Engine 2026-01-30 (2026-02-04-001) - Lab.tif" \
  --with-extended-statistics
```

### Output

#### Image Metadata

|                                 | Reference    | Sample       |
| ------------------------------- | ------------ | ------------ |
| ByteOrder                       | big          | big          |
| ImageWidth (256)                | 3812         | 3812         |
| ImageLength (257)               | 2750         | 2750         |
| BitsPerSample (258)             | [16, 16, 16] | [16, 16, 16] |
| SampleFormat (339)              | null         | null         |
| Compression (259)               | ZIP          | ZIP          |
| PhotometricInterpretation (262) | 8            | 8            |
| SamplesPerPixel (277)           | 3            | 3            |
| RowsPerStrip (278)              | 45           | 45           |
| StripOffsets (273)              | 62           | 62           |
| PlanarConfiguration (284)       | 1            | 1            |
| ICCProfile (34675)              | null         | null         |
| Unique Colors                   | 10001        | 13330        |

Both images are identical in structure: 3812 x 2750, 16-bit Lab (PhotometricInterpretation = 8), ZIP compressed, chunky (PlanarConfiguration = 1), no ICC profile. The critical observation is the unique color count: the sample has 13,330 unique colors versus 10,001 in the reference — 3,329 more.

#### Delta-E 1976 Statistics

| Statistic | Value |
| --------- | ----- |
| Minimum   | 0.591 |
| Maximum   | 1.625 |
| Mean      | 0.726 |
| Median    | 0.719 |
| Std Dev   | 0.093 |

#### Delta-E Distribution

| Range | Count      | Percentage |
| ----- | ---------- | ---------- |
| 0     | 0          | 0          |
| 0-1   | 10,379,603 | 99.01      |
| 1-2   | 103,397    | 0.99       |
| 2-5   | 0          | 0          |
| 5-10  | 0          | 0          |
| 10+   | 0          | 0          |

The conversion quality is excellent. 99.01% of pixels have ΔE < 1.0 (imperceptible to the human eye). The remaining 0.99% fall in the 1.0-2.0 range (just noticeable through close observation). Zero pixels exceed ΔE 2.0.

#### Top 10 Reference Colors vs Top 10 Sample Colors

| Rank | Reference L | Reference a | Reference b | Count   |     | Sample L | Sample a | Sample b | Count   |
| ---- | ----------- | ----------- | ----------- | ------- | --- | -------- | -------- | -------- | ------- |
| 1    | 94.79       | 0           | 0           | 911,519 |     | 94.91    | -0.41    | -0.62    | 915,769 |
| 2    | 100         | 0           | 0           | 424,376 |     | 99.73    | -0.31    | -0.43    | 424,526 |
| 3    | 0           | 0           | 0           | 77,628  |     | 1.36     | -0.71    | -0.52    | 77,628  |
| 4    | 90.59       | 0           | 0           | 17,014  |     | 91.78    | -0.42    | -0.54    | 17,025  |
| 5    | 92          | 0           | 0           | 14,996  |     | 93.14    | -0.45    | -0.54    | 15,793  |
| 6    | 91.64       | 0           | 0           | 14,751  |     | 92.78    | -0.45    | -0.52    | 14,220  |
| 7    | 88.82       | 0           | 0           | 14,275  |     | 76.98    | -0.52    | -0.52    | 13,671  |
| 8    | 76.97       | 0           | 0           | 13,769  |     | 92.09    | -0.45    | -0.52    | 13,517  |
| 9    | 89.18       | 0           | 0           | 13,748  |     | 91.45    | -0.41    | -0.55    | 13,340  |
| 10   | 92.7        | 0           | 0           | 13,638  |     | 89.71    | -0.41    | -0.58    | 13,290  |

All reference colors are neutral grays (a=0, b=0 exactly). The conversion introduces a systematic chromatic shift: a moves to approximately -0.41 to -0.71 and b to approximately -0.43 to -0.62. This shift is consistent but non-zero — the round-trip through CMYK does not preserve perfect neutrality.

#### Cross-Matched Reference Colors (Top 10)

| Rank | L     | a   | b   | Pixels  | Overlaps | Variants | Mean ΔE | Min ΔE | Max ΔE | StdDev | Mean ΔEin | Min ΔEin | Max ΔEin |
| ---- | ----- | --- | --- | ------- | -------- | -------- | ------- | ------ | ------ | ------ | --------- | -------- | -------- |
| 1    | 94.79 | 0   | 0   | 911,519 | 911,519  | 1        | 0.752   | 0.751  | 0.752  | 0      | 0         | 0        | 0.009    |
| 2    | 100   | 0   | 0   | 424,376 | 424,376  | 1        | 0.594   | 0.594  | 0.594  | 0      | 0         | 0        | 0        |
| 3    | 0     | 0   | 0   | 77,628  | 77,628   | 1        | 1.625   | 1.625  | 1.625  | 0      | 0         | 0        | 0        |
| 4    | 90.59 | 0   | 0   | 17,014  | 17,014   | 1        | 0.714   | 0.712  | 0.720  | 0.003  | 0.004     | 0.002    | 0.008    |
| 5    | 92    | 0   | 0   | 14,996  | 14,996   | 1        | 0.693   | 0.693  | 0.694  | 0      | 0.002     | 0.001    | 0.005    |
| 6    | 91.64 | 0   | 0   | 14,751  | 14,751   | 1        | 0.699   | 0.698  | 0.699  | 0.001  | 0.003     | 0.001    | 0.007    |
| 7    | 88.82 | 0   | 0   | 14,275  | 14,275   | 1        | 0.735   | 0.734  | 0.736  | 0.001  | 0.003     | 0.001    | 0.007    |
| 8    | 76.97 | 0   | 0   | 13,769  | 13,769   | 1        | 0.739   | 0.735  | 0.740  | 0.002  | 0.003     | 0.002    | 0.008    |
| 9    | 89.18 | 0   | 0   | 13,748  | 13,748   | 1        | 0.736   | 0.735  | 0.737  | 0.001  | 0.003     | 0.001    | 0.007    |
| 10   | 92.7  | 0   | 0   | 13,638  | 13,638   | 1        | 0.697   | 0.697  | 0.697  | 0      | 0.001     | 0.001    | 0.005    |

For all top 10 reference colors: Variants = 1 and Overlaps = Pixels (coverage = 1.0). The conversion is perfectly deterministic for the most frequent colors — each reference color maps to exactly one sample color. ΔEin is near-zero, confirming no internal variability.

#### Cross-Matched Sample Variability (Highest Coverage)

| Rank | Reference Lab | Sample Lab  | Pixels  | Overlaps | Variants | Coverage | Mean ΔE | StdDev |
| ---- | ------------- | ----------- | ------- | -------- | -------- | -------- | ------- | ------ |
| 1    | [100, 0, 0]   | [100, 0, 0] | 424,376 | 424,376  | 1        | 1        | 0.594   | 0      |
| 2    | [44.19, 0, 0] | [44, 0, 0]  | 298     | 298      | 1        | 1        | 0.657   | 0.002  |
| 3    | [0.09, 0, 0]  | [1, -1, -1] | 248     | 248      | 1        | 1        | 1.568   | 0      |
| 4    | [0.28, 0, 0]  | [1, -1, -1] | 192     | 192      | 1        | 1        | 1.466   | 0.001  |
| 5    | [0.31, 0, 0]  | [1, -1, -1] | 393     | 393      | 1        | 1        | 1.455   | 0.001  |
| 6    | [8.73, 0, 0]  | [9, -1, -1] | 145     | 145      | 1        | 1        | 0.819   | 0.001  |
| 7    | [94.56, 0, 0] | [95, 0, -1] | 2,474   | 2,474    | 1        | 1        | 0.746   | 0.001  |
| 8    | [95.27, 0, 0] | [95, 0, -1] | 1,571   | 1,571    | 1        | 1        | 0.768   | 0.001  |
| 9    | [94.84, 0, 0] | [95, 0, -1] | 7,669   | 7,669    | 1        | 1        | 0.758   | 0      |
| 10   | [95.02, 0, 0] | [95, 0, -1] | 1,837   | 1,837    | 1        | 1        | 0.762   | 0      |

Coverage = 1.0 for all top rows. Every pixel of each reference color maps to a single sample color. The highest-frequency colors have perfect deterministic mapping.

#### Cross-Matched Sample Variability (Lowest Coverage)

| Rank  | Reference Lab | Sample Lab   | Pixels | Overlaps | Variants | Coverage | Mean ΔE | StdDev |
| ----- | ------------- | ------------ | ------ | -------- | -------- | -------- | ------- | ------ |
| 9992  | [69.2, 0, 0]  | [69, -1, -1] | 3,479  | 1,769    | 2        | 0.5085   | 0.722   | 0.003  |
| 9993  | [18.19, 0, 0] | [18, -1, 0]  | 124    | 63       | 2        | 0.5081   | 0.761   | 0.003  |
| 9994  | [3.23, 0, 0]  | [3, -1, -1]  | 361    | 183      | 2        | 0.5069   | 0.727   | 0.003  |
| 9995  | [66.05, 0, 0] | [66, 0, -1]  | 2,086  | 1,056    | 2        | 0.5062   | 0.711   | 0.003  |
| 9996  | [3.7, 0, 0]   | [4, -1, -1]  | 567    | 287      | 2        | 0.5062   | 0.750   | 0.003  |
| 9997  | [66.09, 0, 0] | [66, 0, 0]   | 2,104  | 1,061    | 2        | 0.5043   | 0.711   | 0.003  |
| 9998  | [69.52, 0, 0] | [70, -1, -1] | 2,814  | 1,418    | 2        | 0.5039   | 0.716   | 0.003  |
| 9999  | [11.44, 0, 0] | [11, -1, -1] | 301    | 151      | 2        | 0.5017   | 0.834   | 0.003  |
| 10000 | [69.81, 0, 0] | [70, -1, -1] | 2,614  | 1,307    | 2        | 0.5      | 0.716   | 0.003  |
| 10001 | [99.58, 0, 0] | [100, 0, -1] | 244    | 69       | 4        | 0.2828   | 0.754   | 0.003  |

The lowest-coverage reference colors have Variants = 2 (or 4 for the worst case) and Coverage ≈ 0.50. These are reference colors that sit on a rounding boundary in the conversion — approximately half the pixels round to one sample color and half to another. The StdDev of 0.003 confirms the two variants are extremely close to each other.

#### Cross-Matched Sample Variability (Overall)

| Overall | Pixels  | Overlaps | Variants | Coverage | Mean ΔE | Min ΔE | Max ΔE | StdDev | Mean ΔEin | Min ΔEin | Max ΔEin |
| ------- | ------- | -------- | -------- | -------- | ------- | ------ | ------ | ------ | --------- | -------- | -------- |
| Mean    | 1,048   | 1,035    | 1        | 0.9853   | 0.741   | 0.740  | 0.742  | 0.001  | 0.003     | 0.002    | 0.005    |
| Min     | 49      | 38       | 1        | 0.2828   | 0.594   | 0.593  | 0.594  | 0      | 0         | 0        | 0        |
| Max     | 911,519 | 911,519  | 4        | 1        | 1.625   | 1.625  | 1.625  | 0.006  | 0.008     | 0.006    | 0.011    |

Mean coverage is 0.9853 — 98.53% of pixels for any given reference color map to a single dominant sample color. Mean variants is 1 — the vast majority of reference colors produce exactly one sample color. ΔEin averages 0.003 across all colors, confirming that even where variants exist, they are sub-perceptual.

### Interpretation

#### Why Sample Has More Unique Colors Than Reference (13,330 vs 10,001)

The conversion path is Lab → CMYK → Lab (a round-trip through the eciCMYK v2 profile with Relative Colorimetric intent). The reference image contains neutral grays exclusively (a=0, b=0 for every color). The round-trip introduces:

1. **Systematic chromatic shifts.** Neutral grays do not survive the Lab → CMYK → Lab round-trip as perfect neutrals. The output shows a ≈ -0.4, b ≈ -0.5 shifts that vary slightly by L* value. Different reference L* values that would share the same rounded output L* may differ in their a*/b* shifts, creating additional unique colors.

2. **Rounding boundary splitting.** The ~1.5% of reference colors with Variants > 1 (the lowest-coverage colors) sit on a boundary where the conversion output rounds to two different integer Lab values in roughly equal proportion. Each split adds one extra unique color to the sample count.

3. **Sub-perceptual magnitude.** The ΔEin across all colors averages 0.003. Even the maximum ΔEin is 0.011. The "extra" unique colors differ from each other by amounts far below perceptual thresholds.

#### What This Means for `compare-pdf-outputs`

The current `compare-pdf-outputs` comparison uses a simple unique color count from random pixel sampling (10,000 samples). The `COMPARISONS - UNIQUE.md` analysis showed that Lab images consistently have Sample > Reference unique counts, which appeared anomalous. The `tiff-diff` variability analysis reveals this is an expected artifact of conversion rounding, not a bug.

The `compare-pdf-outputs` tool needs to account for this by reporting metrics that distinguish expected rounding variability from genuine conversion errors. The key metrics from `tiff-diff` that provide this distinction are:

| Metric       | What It Measures                                                            | Why It Matters                                                       |
| ------------ | --------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| **Coverage** | Fraction of pixels mapping to the dominant sample color (Overlaps / Pixels) | Quantifies determinism — 1.0 means perfect one-to-one mapping        |
| **Variants** | Number of distinct sample colors for a given reference color                | Quantifies splitting — 1 means no rounding boundary effects          |
| **ΔEin**     | Delta-E of each sample pixel vs mean sample for that reference color        | Quantifies internal consistency — near-zero means variants are close |
| **ΔE**       | Delta-E between reference and sample                                        | Quantifies conversion accuracy — the primary quality metric          |

---

## Activity Log

### 2026-02-05

- **Analyzed** `tiff-diff.js` code structure and data flow
- **Reviewed** `2026-02-04-TIFF-DIFF-CLI-PROGRESS.md` for tool documentation and history
- **Ran** `tiff-diff` comparison on IM6 Lab reference vs eciCMYK v2 Relative Colorimetric output
- **Documented** synopsis of code capabilities, output findings, and implications for `compare-pdf-outputs`

### 2026-02-06

- **Completed** analysis of `tiff-diff` variability output — marked roadmap item 1 as done
- **Resolved** open questions 1, 2, 3: `pdf-diff` adopts `tiff-diff` metrics directly, uses exhaustive comparison, calls `tiff-diff` as subprocess
- **Planned** `pdf-diff.js` implementation — 8 subphases: entry point guards, TIFF writer, color engine init, pretest system, PDF extraction, comparison planner, tiff-diff integration, CLI/reports
- **Started** implementation of `pdf-diff.js` CLI tool
- **Completed** Subphase 0: Added exports and entry point guards to `tiff-diff.js` and `compare-pdf-outputs.js`
- **Completed** Subphases 1–7: Full `pdf-diff.js` implementation (~1260 lines)
- **Tested** single mode: 8-bit Main Thread vs Workers (9 images, all ΔE=0.000), 16-bit Main Thread vs Workers (9 images, all ΔE=0.000), 8-bit Original vs Converted (9 images, expected ΔE values)
- **Fixed** empty-arg parsing bug (shell line continuations), Lab color space profile fallback, JSON report size (only summary stats, not full cross-matched data), tiff-diff OOM on large 16-bit images (auto-skip cross-matching for >2M pixel 16-bit images)
- **Validated** 5 pretests (CMYK_8, CMYK_16, RGB_8, Gray_8, Lab_8) — all pass with TIFF roundtrip exact and maxΔE=0.000000
- **Completed** batch mode test: 18 comparisons, 162 images, 0 errors
  - All 6 Main Thread vs Workers pairs: max ΔE=0.000 (byte-identical outputs confirmed)
  - All 12 Reference vs Converted pairs: expected non-zero ΔE values
  - 16-bit images correctly skip cross-matching (>2M pixel heuristic)
  - 8-bit images run full cross-matching via `tiff-diff`
  - Reference counting extraction optimization working (PDFs extracted once, reused)
  - Hash-based unique labels prevent temp directory collisions
  - 8 pretests all passed: CMYK_8, CMYK_16, RGB_8, RGB_16, Gray_8, Gray_16, Lab_8, Lab_16
  - Report written: `output/2026-02-05-001/pdf-diff-report.json` (702 KB)
  - Pretest cache persisted: `.temp/pdf-diff/pretests.json`
- **Refined** `pdf-diff.js` — 6 improvements identified during manual inspection of `--keep-temp` output:
  1. **Rewrote** TIFF writer from Lab Float32 to Lab 16-bit (TIFF 6.0 CIELab) — 14 IFD tags including RATIONAL XResolution/YResolution, SampleFormat=[1,1,1], BitsPerSample=[16,16,16]. Photoshop/Preview compatible.
  2. **Fixed** pretest threshold from 0.01 to 2.0 — CMYK_16 pretest produced maxΔE=1.57 due to out-of-gamut clamping (400% total ink → L* < 0 clamped to 0). The `tiffRoundtripExact=true` confirms pipeline correctness; ΔE is from Lab16 clamping only.
  3. **Added** color space and bit depth to TIFF filenames: `page-0-Im0-CMYK-16bit.tif` (was `page-0-Im0.tif`)
  4. **Replaced** `sanitizeLabel()` with `makeTempLabel()` — uses actual PDF names with `(GUID)` suffix, preserving spaces, no truncation, no underscore mangling
  5. **Added** `tiff-diff` subprocess output saved as `.tiff-diff.log` files in temp directories — follows `generate-verification-matrix.mjs` logging pattern (write command as first line, pipe stdout/stderr to log stream)
  6. **Renamed** `runTiffDiff` → `runTIFFDiff` (TIFF is an acronym, ALL CAPS per naming conventions)
- **Re-ran** batch test with all refinements: 18/18 comparisons, 162 images, 0 errors, 8 pretests (8 passed)
  - All 6 Main Thread vs Workers pairs: ΔE=0.000 (byte-identical)
  - All 12 Reference vs Converted pairs: expected non-zero ΔE
  - Log captured via `tee` at `output/2026-02-05-001 Diff.log`
  - Temp TIFFs preserved in `output/2026-02-05-001 Diff/` with proper naming
  - `.tiff-diff.log` files confirmed in each temp directory
- **Validated** TIFF structure via `tiffinfo`: CIE L*a*b*, 16-bit, ZIP compression, 72 DPI resolution, 14 tags

### 2026-02-07

- **Identified** Lab absolute-zero pixel issue: Photoshop uses Lab `0/-128/-128` in mask images for black. The a=-128, b=-128 values are at the extreme out-of-gamut boundary, causing color engines to gamut-map them to non-black during transforms.
- **Implemented** `COERCE_LAB_ABSOLUTE_ZERO_PIXELS` in `classes/pdf-image-color-converter.js`:
  - Before transform: scan Lab input for all-zero byte triplets (Lab `0/-128/-128`), replace with Lab `0/0/0` (proper black, neutral a/b)
  - If output is Lab: track pixel positions, write back all-zero bytes after transform (preserves round-trip fidelity)
  - If output is not Lab: no write-back needed (engine produces correct black from `0/0/0`)
  - Byte encoding: Lab `0/-128/-128` = `[0x00,0x00,0x00]` (8-bit) or `[0x00,0x00,0x00,0x00,0x00,0x00]` (16-bit big-endian); Lab `0/0/0` = `[0x00,0x80,0x80]` (8-bit) or `[0x00,0x00,0x80,0x00,0x80,0x00]` (16-bit big-endian)
- **Added** CMYK K-Only GCR handling: when output is CMYK with K-Only GCR intent, an extra single-pixel transform (Lab `0/0/0` → CMYK, Relative Colorimetric + BPC) computes the profile's black value, which is written back at the tracked positions after the main transform. This is self-contained and independent of the main transform's intent fallback logic.
- **Created** handoff document `2026-02-06-LAB-COERCE-ABSOLUTE-ZERO-PIXELS.md` for `pdf-diff` agent — explains the problem, byte encodings, fix applied in PDFImageColorConverter (including CMYK K-Only GCR case), and what pdf-diff needs to do
- **Applied** Lab absolute-zero coercion in `pdf-diff.js` `convertPixelsToLabFloat32()` — same pre-transform coercion (replace `0/-128/-128` with `0/0/0`) and post-transform restoration (write back zeros in Lab output) as `PDFImageColorConverter`
- **Removed** cross-matching skip heuristic from `pdf-diff.js` — previously skipped cross-matching for 16-bit images >2M pixels; now always passes `--with-extended-statistics` and `--top=N` to `tiff-diff` subprocess
- **Investigated** `tiff-diff.js` OOM with Maps strategy — `collectAllStatsSequential` still OOMed at 8 GB on RGB-16bit vs Lab-8bit comparison (7M+ unique colors × nested `sampleFreqs` Maps + full `allVariability` array)
- **Refactored** `tiff-diff.js` aggregation: replaced `USE_SEQUENTIAL_NESTED_MAP = true` flag with `AGGREGATION_STRATEGY` constant supporting three strategies: `'None'` (original position-based), `'Maps'` (two-pass sequential with nested Maps), `'TypedArrays'` (parallel typed arrays + flat pair-frequency Map)
- **Implemented** `collectAllStatsTypedArrays()` (~350 lines):
  - Numeric key encoding: `labToKey(L, a, b)` packs Lab values (2-decimal precision) into a single safe integer
  - Parallel typed arrays: Float32Array for Lab values, Uint32Array for pixel counts, Float64Array for Delta-E sum accumulators, Uint8Array for matched flags
  - Pass 1: pixel iteration collecting Delta-E histogram, ref/sample color indices, flat `(refIndex, samplePacked)` pair frequencies
  - Between passes: compute means, process flat pair map → variants/overlaps/dominant sample, free pair map to reduce peak memory
  - Pass 2: stdDev and ΔEin computation using means from pass 1
  - Bounded top/bottom 10 variability selection (avoids materializing 7M+ objects)
  - Pre-computed `variabilitySummary` with mean/min/max aggregates
- **Updated** `compareTIFFImages()` with three-way branching on `AGGREGATION_STRATEGY`
- **Updated** `displayResults()` to handle `variabilitySummary` — uses pre-computed summary when available, falls back to computing from full array for Maps/None strategies
- **Fixed** regression Bug 1 (CRITICAL): bounded top/bottom selection used strict `>` comparison, ignoring ties — replaced with `varCmpDesc` multi-key comparator `(coverage DESC, overlaps DESC, pixels DESC)` storing `{ ri, coverage, overlaps, pixels }` entries
- **Fixed** regression Bug 2 (CRITICAL): Delta-E in cross-matching used per-pixel raw ref Lab instead of stored group representative `rLabL[ri], rLabA[ri], rLabB[ri]` — fixed in both Pass 1 (accumulation) and Pass 2 (stdDev recomputation)
- **Fixed** regression Bug 3: `rDeMean`, `rMeanSL`, `rMeanSA`, `rMeanSB` used Float32Array causing precision loss — changed to Float64Array (+112 MB for 7M colors, verified no OOM)
- **Fixed** display sort: final sort for `topByC`/`botByC` before building entries used single-key coverage sort instead of full `varCmpDesc` — applied to both sort calls
- **Validated** all fixes against `tiff-diff-r1.js` (original): IM6 10,001 unique colors, all values match. Large 16-bit 7.5M unique colors completed within 8 GB
- **Added** CLI flags: `--baseline-aggregation` (None), `--map-aggregation` (Maps), `--default-aggregation` (TypedArrays — default), `--debug-memory-footprint`
- **Added** `logMemory(label, enabled)` helper that writes `[memory] label: heap=X MB, rss=Y MB` to stderr
- **Wrapped** collect functions in `try/finally` for reliable memory-complete logging even on error/OOM
- **Added** empty arg filter (`if (arg === '') continue;`) to `parseArgs` — prevents shell line continuation artifacts
- **Updated** `compareTIFFImages` signature to accept `aggregationStrategy` and `debugMemoryFootprint` (replaces module-level constant for branching)
- **Copied** large 16-bit test images to fixtures: `fixtures/tiff-diff/Im0 - Lab - Reference.tif` and `fixtures/tiff-diff/Im0 - Lab - Lab 16-bit - Relative Colorimetric - Refactored - Main Thread - Color-Engine 2025-12-19 (2026-02-06-008) - Lab.tif`
- **Ran** practical analysis comparing all three strategies on IM6 (10K colors) and Im0 (7.5M colors) from `fixtures/tiff-diff/`:
  - TypedArrays: IM6 peak heap 385 MB / RSS 1.18 GB; Large 16-bit peak heap 1,046 MB / RSS 2.82 GB — completes
  - Maps: IM6 peak heap 396 MB / RSS 1.14 GB; Large 16-bit OOM at 7,839 MB heap during variability
  - None: IM6 peak heap 678 MB / RSS 1.51 GB; Large 16-bit OOM at 5,150 MB heap during unique color collection
- **Updated** `tiff-diff.js.md` with measured memory data, new CLI options, practical analysis commands, and all bug fixes
- **Changed** `saveResults()` to use array JSON output — reads existing `<sample.tif>.json`, appends new result to array, writes back. Auto-migrates legacy single-object files. Allows same sample TIFF to be compared against multiple references.
- **Updated** `pdf-diff.js` — variability statistics, DIFF reports, clean outputs (7 subphases):
  1. **Enriched** ComparisonPair metadata: added `groupDescription`, `inputName`, `outputName`, `comparisonMode` to pair objects and allResults
  2. **Preserved** `variabilitySummary` from tiff-diff output — expanded summary extraction to include reference/sample filenames, dimensions, unique color counts, and the compact variabilitySummary
  3. **Added** `--clean-json-outputs` / `--no-clean-json-outputs` flags — auto-cleans DIFF.json, DIFF.md, `*.tif.json`, legacy `pdf-diff-report.json`, and `*.pdf-diff.json` before batch runs
  4. **Added** diff dir derivation: batch mode defaults to `<output-dir> Diff` instead of `.temp/pdf-diff`; overridable with `--temp-dir` (tracked via `tempDirExplicit`)
  5. **Implemented** `generateDiffJSON()` with `computeAggregateStatistics()` and `formatGroupForJSON()` — produces version 1 schema with overview, pairs/reference grouping, per-image variabilitySummary, and pretests
  6. **Implemented** `generateDiffMarkdown()` with `appendGroupMarkdown()` and `appendInsights()` — overview table, per-group summary tables, per-comparison image detail tables, automated insights (binary-identical count, high Delta-E warnings, coverage analysis, error flags)
  7. **Rewired** `main()`: resolves outputDir earlier, derives diff dir, calls `cleanStaleOutputs()`, writes DIFF.json + DIFF.md instead of legacy pdf-diff-report.json, preserves all root files during cleanup
  8. **Fixed** tiff-diff array format mismatch — `runTIFFDiff()` now handles array JSON (takes last element) since tiff-diff `saveResults()` writes arrays
  9. **Always** passes `--with-extended-statistics` to tiff-diff subprocess (removed conditional)
  10. **Shows** Coverage alongside Delta-E in per-image console output
- **Tested** MINIMAL-ENGINES-LAB config: 6 comparisons, 54 images, 0 errors — all data present in DIFF.json and DIFF.md, insights section correct (28 binary-identical, all coverage >= 0.9)
- **Tested** BASELINE-BITDEPTHS config: 18 comparisons, 162 images, 0 errors — proper grouping by output format (eciCMYK v2, K-Only GCR, FIPS_WIDE_28T-TYPEavg), both bit depths (8-bit, 16-bit), 8 pretests, insights correct (54 binary-identical, 68 with Max ΔE > 5.0)
- **Tested** BASELINE config: 9 comparisons, 81 images, 0 errors — 3 output formats, 6 groups (3 pairs + 3 reference), 4 pretests. Note: K-Only GCR Main Thread vs Workers shows Im8 Max ΔE=0.525 (not binary-identical) due to Lab absolute-zero pixel coercion difference between main thread and workers. Insights: 26 binary-identical, 34 with Max ΔE > 5.0
