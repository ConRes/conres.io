# Cross-Matched Statistics Improvements

Progress document for `tiff-diff.js` cross-matched statistics table improvements.

**Last Updated**: 2026-02-08

---

## Context

The `tiff-diff.js` CLI tool compares two Lab TIFF images pixel-by-pixel using Delta-E 1976. The cross-matched statistics feature groups pixels by their reference Lab color, then analyzes how sample Lab values vary at those positions.

### Key Terminology

| Term | Meaning |
| --- | --- |
| **ΔE** | Delta-E 1976: positional difference between reference Lab and sample Lab at the same pixel |
| **ΔEin** | Delta-E Intrinsic: difference between each sample pixel's Lab and the mean of all sample pixels at that reference color's positions — measures sample self-consistency |
| **Variants** | Number of distinct sample Lab values (after rounding to `CROSS_MATCH_ROUNDING_DECIMALS` decimal places) at a reference color's positions |
| **Overlaps** | Pixel count of the most frequent sample variant at a reference color's positions |
| **Coverage** | Overlaps / Pixels — fraction of pixels that map to the dominant variant |

### Problem Statement

An investigation on 2026-02-08 (prior to this progress document) revealed several issues with the cross-matched statistics output:

1. **`CROSS_MATCH_ROUNDING_DECIMALS` was ignored in the active TypedArrays code path.**
   - The constant was set to `2`, but `collectAllStatsTypedArrays` used `Math.round(sL)` (integer rounding, effectively `decimals = 0`), not `round(sL, CROSS_MATCH_ROUNDING_DECIMALS)`.
   - Root cause: the bit-packing scheme `(kL << 16) | ((ka + 128) << 8) | (kb + 128)` packed L/a/b into 24 bits as integers, structurally unable to represent fractional decimals.

2. **Variants was always 1 in Cross-Matched Reference Colors** because integer rounding collapsed all sample values at large uniform patches to a single key.

3. **Tables were confusing to read side-by-side** — same dataset sorted differently, inconsistent column names, no explanatory footnotes.

4. **Data structures stored rounded values** instead of keeping raw data and rounding only during computation or presentation.

5. **Abbreviated identifiers** made code difficult to read (e.g., `rDomSL`, `rDeMean`, `rVariants`).

### Design Principle

**Do not round the actual data.** Rounding is applied only during:
1. **Computation** — pair-key generation for grouping (using `CROSS_MATCH_ROUNDING_DECIMALS`)
2. **Presentation** — table display formatting (using `LAB_COLUMN_ROUNDING_DECIMALS`, `DELTA_E_COLUMN_ROUNDING_DECIMALS`)

---

## Roadmap

### Phase 1: Fix `CROSS_MATCH_ROUNDING_DECIMALS` Compliance

- [x] Replace `Math.round()` in TypedArrays pair-key packing with `round(value, CROSS_MATCH_ROUNDING_DECIMALS)`
- [x] Replace integer bit-packing with string key scheme that supports fractional decimals
- [x] Remove `rDomSL/rDomSA/rDomSB` — Sample Lab in Variability now uses the mean sample Lab (`meanSampleLabL/A/B`)
- [x] Remove rounding from `variabilitySummary` data, `refTopColorsFormatted`, `sampleTopColorsFormatted`, and global `deltaE` return values
- [x] Rename abbreviated identifiers to explicit names throughout `collectAllStatsTypedArrays`
- [x] Verify Variants increase from 1 with `CROSS_MATCH_ROUNDING_DECIMALS = 2`

### Phase 2: Presentation-Layer Rounding Constants

- [x] Use `LAB_COLUMN_ROUNDING_DECIMALS` in `displayResults` for all Lab column formatting
- [x] Use `DELTA_E_COLUMN_ROUNDING_DECIMALS` in `displayResults` for all Delta-E and StdDev column formatting
- [x] All rounding uses the user's `round()` function exclusively

### Phase 3: Footnote System

- [x] Implement superscript-number suffixes in column headings (e.g., `Lab¹`, `Mean ΔE²`)
- [x] Group same-rounding columns under a single footnote number
- [x] Print footnotes via `console.log` after each applicable table
- [x] Footnote ¹: Lab column rounding
- [x] Footnote ²: Delta-E column rounding
- [x] Footnote ³: Pixels definition
- [x] Footnote ⁴: Match definition
- [x] Footnote ⁵: Overlaps/Variants/Coverage combined explanation

### Phase 4: Combine Top N Tables

- [x] Use "Pixels" instead of "Count" for column name consistency
- [x] Use combined Lab array `[L, a, b]` instead of separate L, a, b columns
- [x] Apply `LAB_COLUMN_ROUNDING_DECIMALS` to Lab values in Top N tables
- [x] Apply footnotes to Top N tables

---

## Identifier Renames

The following abbreviated identifiers were renamed to explicit names:

| Old | New |
| --- | --- |
| `rN` | `referenceUniqueColorCount` |
| `sN` | `sampleUniqueColorCount` |
| `rCap` / `sCap` | `referenceCapacity` / `sampleCapacity` |
| `rLabL/A/B` | `referenceLabL/A/B` |
| `sLabL/A/B` | `sampleLabL/A/B` |
| `rPixels` / `sPixels` | `referencePixelCounts` / `samplePixelCounts` |
| `rMatched` / `sMatched` | `referenceMatched` / `sampleMatched` |
| `rIndex` / `sIndex` | `referenceColorIndex` / `sampleColorIndex` |
| `rDeMean` | `perColorMeanDeltaE` |
| `rDeSum` / `rDeMin` / `rDeMax` | `perColorSumDeltaE` / `perColorMinDeltaE` / `perColorMaxDeltaE` |
| `rSumSqDiff` | `perColorSumSquaredDeltaEDifference` |
| `rDeinSum/Min/Max` | `perColorSumDeltaEIntrinsic` / `perColorMinDeltaEIntrinsic` / `perColorMaxDeltaEIntrinsic` |
| `rSumSL/A/B` | `sampleLabSumL/A/B` |
| `rMeanSL/A/B` | `meanSampleLabL/A/B` |
| `rVariants` | `variantCounts` |
| `rOverlaps` | `overlapCounts` |
| `rDomSL/A/B` | *(removed — replaced by `meanSampleLabL/A/B`)* |

---

## Activity Log

| Date | Activity |
| --- | --- |
| 2026-02-08 | Created progress document from investigation findings |
| 2026-02-08 | Phase 1: Replaced bit-packing with string keys using `round(value, CROSS_MATCH_ROUNDING_DECIMALS)` |
| 2026-02-08 | Phase 1: Removed `rDomSL/A/B`, Sample Lab now uses mean sample Lab values |
| 2026-02-08 | Phase 1: Removed all rounding from data structures (moved to display layer) |
| 2026-02-08 | Phase 1: Renamed all abbreviated identifiers to explicit names |
| 2026-02-08 | Phase 2: Applied `LAB_COLUMN_ROUNDING_DECIMALS` and `DELTA_E_COLUMN_ROUNDING_DECIMALS` in display |
| 2026-02-08 | Phase 3: Implemented footnote system with 5 footnotes (Lab, ΔE, Pixels, Match, Overlaps/Variants/Coverage) |
| 2026-02-08 | Phase 4: Top N tables now use combined Lab arrays, "Pixels" column, and footnotes |
| 2026-02-08 | Fixed "in" → "intrinsic" in ΔEin variable names (was incorrectly "internal") |
| 2026-02-08 | Phase 1: Verified Variants increase from 1 — IM6 fixtures show Variants = 1–4 (Mean 2, Max 4) |
