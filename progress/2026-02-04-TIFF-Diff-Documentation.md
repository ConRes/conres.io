# TIFF Diff CLI Progress

**Last Updated:** 2026-02-07

## Roadmap

- [x] Implement basic TIFF reading with multi-strip support
- [x] Implement correct TIFF 6.0 CIELab 16-bit encoding
- [x] Implement Delta-E 1976 calculation
- [x] Implement unique color collection and statistics
- [x] Implement cross-matching analysis (Delta-E by position)
- [x] Add `--without-cross-matching` flag
- [x] Clean up code (remove emojis, use arrow functions)
- [x] Add example commands to file
- [x] Improve display: transpose Image Information table, separate filenames, add tag details
- [x] Add Reference Count and Sample Count columns to cross-matched table
- [x] Add Cross-Matched Sample Variability table with Error percentage
- [x] Use native types in display: numbers (not strings), booleans (not symbols), arrays for ranges
- [x] Rename table to "Image Metadata" with Tag column and official TIFF tag names
- [x] Add all processing-relevant TIFF tags: SampleFormat, PhotometricInterpretation, SamplesPerPixel, PlanarConfiguration
- [x] Use `{ width, height }` structures; display `×` (multiply sign) in verbose output
- [x] Use `[number, ...]` arrays for BitsPerSample and SampleFormat
- [x] Separate `VariabilityColor` typedef from `CrossMatchedColor` with distinct properties
- [x] Add variability analysis: find reference colors with lowest/highest coverage from ALL unique colors
- [x] Variability table uses `Reference: { L, a, b }` and `Sample: { L, a, b }` (most frequent variant) objects
- [x] Add CLI progress bar with `process.stdout.clearLine()`/`cursorTo()` for animated status updates
- [x] Add cross-match rounding via `round()` utility (default on, `--without-cross-match-rounding` to disable)
- [x] Add ΔEin (internal Delta-E): sample pixels vs mean sample Lab per reference color
- [x] Add `--with-extended-statistics` opt-in for Min ΔE, Min ΔEin columns
- [x] Add Overall summary table (Mean/Min/Max aggregates across all variability rows)
- [x] Add `collectAllStatsSequential` — two-pass sequential approach with nested Maps (avoids storing pixel positions)
- [x] Remove `skipCrossMatching` heuristic for 16-bit images >2M pixels — cross-matching always enabled
- [x] Refactor aggregation into `AGGREGATION_STRATEGY` constant (`'None'` | `'Maps'` | `'TypedArrays'`)
- [x] Implement `collectAllStatsTypedArrays` — parallel typed arrays + flat pair-frequency Map
- [x] Add `variabilitySummary` to `ComparisonResult` for pre-computed aggregates (avoids materializing 7M+ objects)
- [x] Update `displayResults` to use `variabilitySummary` when available
- [x] Fix regression: bounded selection tie-breaking (Bug 1), group representative Lab for Delta-E (Bug 2), Float64Array means (Bug 3)
- [x] Add CLI flags: `--baseline-aggregation`, `--map-aggregation`, `--default-aggregation`, `--debug-memory-footprint`
- [x] Wire `aggregationStrategy` and `debugMemoryFootprint` through `compareTIFFImages` and collect functions
- [x] Add `logMemory()` helper with `try/finally` for reliable completion logging
- [x] Add empty arg filter (`if (arg === '') continue;`) to `parseArgs`
- [x] Run practical analysis comparing all three strategies on IM6 (10K colors) and large 16-bit (7.5M colors)

## Current Status

`AGGREGATION_STRATEGY = 'TypedArrays'` is the default. Three CLI flags allow strategy selection: `--default-aggregation` (TypedArrays), `--map-aggregation` (Maps), `--baseline-aggregation` (None). Memory debugging via `--debug-memory-footprint` logs heap/RSS to stderr at critical stages using `try/finally`.

Practical analysis complete — TypedArrays handles 7.5M unique colors with cross-matching in 2.8 GB RSS peak; Maps and None OOM on the same dataset at 8 GB.

---

## Introduction

The `tiff-diff.js` CLI tool compares two Lab TIFF images pixel-by-pixel using Delta-E 1976 color difference. It is designed for verifying color conversion accuracy in the ConRes PDF color conversion pipeline.

### Purpose

When converting PDF colors through different rendering intents or color engines, we need to verify that the output colors match expected values. This tool:

1. Loads reference and sample Lab TIFF images
2. Validates they have matching dimensions and Lab color space
3. Computes pixel-by-pixel Delta-E 1976 differences
4. Reports statistics on unique colors and their distribution
5. Cross-matches reference colors to sample positions for detailed analysis
6. Computes internal variability (ΔEin) measuring sample consistency against its own mean

### Location

```
testing/iso/ptf/2025/experiments/tiff-diff.js
```

### Key Concepts

| Term                     | Definition                                                                                                                       |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| **ΔE**                   | Delta-E between reference Lab and sample Lab at each pixel position                                                              |
| **ΔEin**                 | "Internal" Delta-E: each sample pixel vs the mean of all sample pixels for that reference                                        |
| **Coverage**             | Overlaps / Pixels — how much of a reference color maps to a single dominant sample color                                         |
| **Overlaps**             | Count of pixels where the most frequent sample color appears at a reference color's positions                                    |
| **Variants**             | Number of distinct sample colors found at a reference color's positions                                                          |
| **AGGREGATION_STRATEGY** | Controls cross-matching memory model: `'None'` (positions), `'Maps'` (nested Maps), `'TypedArrays'` (parallel arrays + flat Map) |

### Data vs Display Separation

- Data structures store raw numeric values for JSON serialization
- Formatting (`round()`, `toFixed()`) is applied only in the `console.table()` display layer
- Nested `{ L, a, b }` objects in data are rendered as `[L, a, b]` arrays in tables (because `console.table` renders objects as `[Object]`)

---

## TIFF 6.0 CIELab Encoding

The tool implements correct TIFF 6.0 CIELab encoding per the specification.

### PhotometricInterpretation = 8 (CIELab)

| Component | 8-bit Encoding                     | 16-bit Encoding                       |
| --------- | ---------------------------------- | ------------------------------------- |
| L*        | Unsigned [0, 255] maps to [0, 100] | Unsigned [0, 65535] maps to [0, 100]  |
| a*        | Signed [-128, 127]                 | Signed [-32768, 32767] divided by 256 |
| b*        | Signed [-128, 127]                 | Signed [-32768, 32767] divided by 256 |

### Conversion Formulas (16-bit)

```javascript
L* = rawL / 655.35                    // 0-65535 to 0-100
a* = (rawA > 32767 ? rawA - 65536 : rawA) / 256   // signed / 256
b* = (rawB > 32767 ? rawB - 65536 : rawB) / 256   // signed / 256
```

### Key Insight

For neutral gray (a* = 0, b* = 0), the raw 16-bit values should be 0 (not 32768). This differs from ICC Lab encoding where 32768 represents neutral.

---

## Delta-E 1976 Calculation

Delta-E 1976 is the Euclidean distance in CIE L*a*b* color space:

```
ΔE = √[(L₁* - L₂*)² + (a₁* - a₂*)² + (b₁* - b₂*)²]
```

### Interpretation

| Delta-E | Perception                             |
| ------- | -------------------------------------- |
| 0       | Identical                              |
| 0-1     | Not perceptible by human eye           |
| 1-2     | Perceptible through close observation  |
| 2-5     | Perceptible at a glance                |
| 5-10    | Colors are more similar than different |
| > 10    | Colors are different                   |

---

## Statistics Generated

### Global Delta-E Statistics

For all pixels in the image:

- **Minimum**: Smallest Delta-E value
- **Maximum**: Largest Delta-E value
- **Mean**: Average Delta-E across all pixels
- **Median**: Middle value when sorted
- **Standard Deviation**: Spread of values around the mean

### Delta-E Distribution Histogram

Buckets pixels by Delta-E range:

| Range | Description                 |
| ----- | --------------------------- |
| 0     | Exact matches               |
| 0-1   | Imperceptible differences   |
| 1-2   | Just noticeable differences |
| 2-5   | Noticeable differences      |
| 5-10  | Significant differences     |
| 10+   | Large differences           |

### Unique Color Analysis

For both reference and sample images:

- Count of unique colors (grouped by `toFixed(2)` key)
- Top N colors by pixel count
- Match indicator based on whether similar colors exist at same positions (Delta-E < 1)

### Cross-Matching Analysis (Default)

For each top N unique reference color:

1. Find all pixel positions where that color appears
2. Look up the sample color at each of those positions
3. Compute Delta-E between the reference color and each sample color
4. Track sample color frequencies (with optional rounding to integers)
5. Report statistics:
   - **Mean ΔE**: Average Delta-E for this reference color
   - **Min ΔE**: Best match (opt-in via `--with-extended-statistics`)
   - **Max ΔE**: Worst match
   - **StdDev**: Consistency of the conversion
   - **Mean ΔEin**: Average Delta-E of each sample pixel vs the mean sample Lab
   - **Min ΔEin**: Smallest internal Delta-E (opt-in via `--with-extended-statistics`)
   - **Max ΔEin**: Largest internal Delta-E

### Cross-Matched Sample Variability

Computed for ALL unique reference colors (not just top N):

- Same statistics as cross-matching, plus Coverage (Overlaps/Pixels)
- Sorted from highest to lowest coverage
- Displayed as one table (≤ 20 colors) or two (Highest Coverage top 10, Lowest Coverage bottom 10)
- **Overall summary table**: Mean, Min (opt-in), Max aggregates across all rows

### Cross-Match Rounding

When enabled (default), sample Lab values are rounded to integers via `round(value, 0)` before generating grouping keys. This collapses sample variants that differ by less than 1 Lab unit, reducing the Variants count and increasing Overlaps/Coverage.

Disable with `--without-cross-match-rounding` to use unrounded float values for grouping.

---

## Usage

### Basic Usage

```bash
node testing/iso/ptf/2025/experiments/tiff-diff.js <reference.tif> <sample.tif>
```

### Options

| Option                           | Default     | Description                                                  |
| -------------------------------- | ----------- | ------------------------------------------------------------ |
| `--top=<N>`                      | 10          | Number of top unique colors to display                       |
| `--without-cross-matching`       | enabled     | Disable cross-matching analysis                              |
| `--without-cross-match-rounding` | enabled     | Disable rounding for color grouping                          |
| `--with-extended-statistics`     | disabled    | Show Min ΔE and Min ΔEin columns                             |
| `--default-aggregation`          | TypedArrays | Use typed-arrays aggregation (default)                       |
| `--map-aggregation`              | —           | Use nested-Maps aggregation (OOMs on 7M+ colors)             |
| `--baseline-aggregation`         | —           | Use original position-based aggregation (OOMs on 7M+ colors) |
| `--debug-memory-footprint`       | disabled    | Log heap/RSS usage at critical stages to stderr              |
| `--verbose`, `-v`                | disabled    | Show detailed progress output                                |
| `--help`, `-h`                   |             | Show help message                                            |

### Example Commands

```bash
# Default (with cross-matching and rounding)
node testing/iso/ptf/2025/experiments/tiff-diff.js reference.tif sample.tif

# Without cross-matching (faster)
node testing/iso/ptf/2025/experiments/tiff-diff.js reference.tif sample.tif --without-cross-matching

# With extended statistics (shows Min ΔE and Min ΔEin columns)
node testing/iso/ptf/2025/experiments/tiff-diff.js reference.tif sample.tif --with-extended-statistics

# Without rounding (use raw float values for grouping)
node testing/iso/ptf/2025/experiments/tiff-diff.js reference.tif sample.tif --without-cross-match-rounding

# With verbose output
node testing/iso/ptf/2025/experiments/tiff-diff.js reference.tif sample.tif --verbose
```

### Output

- Console output with formatted tables
- JSON file saved to `<sample.tif>.json` as an **array of comparison results** — each run appends to the array, allowing the same sample to be compared against multiple references. Legacy single-object files are auto-migrated to array format on first append.

### Console Tables

| Table                                      | Always Shown        | Description                             |
| ------------------------------------------ | ------------------- | --------------------------------------- |
| Image Metadata                             | Yes                 | TIFF tags for both images               |
| Delta-E 1976 Statistics                    | Yes                 | Global min/max/mean/median/stdDev       |
| Delta-E Distribution                       | Yes                 | Histogram by range                      |
| Top N Reference Colors                     | Yes                 | Most frequent reference colors          |
| Top N Sample Colors                        | Yes                 | Most frequent sample colors             |
| Cross-Matched Reference Colors             | With cross-matching | Per-color ΔE and ΔEin statistics        |
| Cross-Matched Sample Variability           | With cross-matching | All unique colors sorted by coverage    |
| Cross-Matched Sample Variability (Overall) | With cross-matching | Mean/Min/Max aggregates across all rows |

---

## Implementation Details

### TIFF Reading

- Supports both little-endian (II) and big-endian (MM) TIFFs
- Handles multi-strip TIFFs (concatenates decompressed strips)
- Supports compression: None, LZW, ZIP/Deflate
- Reads 8-bit, 16-bit, and 32-bit float data
- Properly handles endianness for 16-bit pixel data
- Parses and reports RowsPerStrip (tag 278), ICC Profile (tag 34675)

### Key Type Definitions

| Type                | Purpose                                                                                 |
| ------------------- | --------------------------------------------------------------------------------------- |
| `UniqueColor`       | L, a, b values with count and pixel positions                                           |
| `CrossMatchedColor` | Per-color ΔE and ΔEin stats for top N reference colors                                  |
| `VariabilityColor`  | Per-color stats with coverage, reference/sample Lab pairs                               |
| `ComparisonResult`  | Full output: metadata, deltaE, topColors, crossMatched, variability, variabilitySummary |
| `ParsedOptions`     | CLI argument parsing result (includes `aggregationStrategy`, `debugMemoryFootprint`)    |

### Utility Functions

| Function                          | Purpose                                                                               |
| --------------------------------- | ------------------------------------------------------------------------------------- |
| `round(value, decimals)`          | Numeric rounding: `Math.round(value * 10 ** decimals) / 10 ** decimals`               |
| `deltaE76(L1, a1, b1, ...)`       | Delta-E 1976 Euclidean distance                                                       |
| `writeProgress(op, pct)`          | Animated terminal progress bar with cursor hiding                                     |
| `clearProgress()`                 | Clear progress line and restore cursor                                                |
| `logMemory(label, enabled)`       | Log heap/RSS to stderr; no-op when `enabled=false`. Used in `try/finally`             |
| `labToKey(L, a, b)`               | Pack Lab values (2-decimal precision) into a single numeric key                       |
| `collectAllStatsSequential(...)`  | Two-pass cross-matching with nested Maps (`'Maps'` strategy)                          |
| `collectAllStatsTypedArrays(...)` | Two-pass cross-matching with parallel typed arrays (`'TypedArrays'` strategy)         |
| `saveResults(result, samplePath)` | Append result to `<sample.tif>.json` array; auto-migrates legacy single-object format |

### Aggregation Strategies

The `AGGREGATION_STRATEGY` constant (default: `'TypedArrays'`) controls how cross-matching statistics are collected. Three strategies exist, selectable via CLI flags:

| Strategy        | CLI Flag                 | Function                     | Memory Model                                              |
| --------------- | ------------------------ | ---------------------------- | --------------------------------------------------------- |
| `'None'`        | `--baseline-aggregation` | `compareTIFFImages` (inline) | O(totalPixels) — stores `{x, y}` per pixel per color      |
| `'Maps'`        | `--map-aggregation`      | `collectAllStatsSequential`  | O(uniqueColors × avgVariants) — nested `sampleFreqs` Maps |
| `'TypedArrays'` | `--default-aggregation`  | `collectAllStatsTypedArrays` | O(uniqueColors) arrays + O(uniquePairs) flat Map          |

#### Measured Memory Usage

Measured with `--debug-memory-footprint` on 2026-02-07:

**IM6 Lab 16-bit (10,483,000 pixels, 10,001 unique reference colors):**

| Strategy        | Peak Heap | Peak RSS | Status    |
| --------------- | --------- | -------- | --------- |
| `'TypedArrays'` | 385 MB    | 1.18 GB  | Completes |
| `'Maps'`        | 396 MB    | 1.14 GB  | Completes |
| `'None'`        | 678 MB    | 1.51 GB  | Completes |

**Im0 Lab 16-bit fixture (3812x2750, 10,001 ref × 7,550,715 sample unique colors, cross-matching enabled):**

| Strategy        | Peak Heap | Peak RSS | Status    |
| --------------- | --------- | -------- | --------- |
| `'TypedArrays'` | 534 MB    | 1.68 GB  | Completes |

**Im0 RGB 16-bit (3812x2750, 7,545,931 unique reference colors, cross-matching enabled — from output dir):**

| Strategy        | Peak Heap | Peak RSS | Status               |
| --------------- | --------- | -------- | -------------------- |
| `'TypedArrays'` | 1,046 MB  | 2.82 GB  | Completes            |
| `'Maps'`        | 7,839 MB  | 7.57 GB  | OOM at variability   |
| `'None'`        | 5,150 MB  | 3.17 GB  | OOM at unique colors |

IM6 — small dataset (10,483,000 pixels, 10,001 unique reference colors):

```bash
(
  export REFERENCE=experiments/fixtures/tiff-diff/'IM6 - Lab - Reference.tif';
  export SAMPLE=experiments/fixtures/tiff-diff/'IM6 - Lab - eciCMYK v2 - Relative Colorimetric - Refactored - Main Thread - Color-Engine 2026-01-30 (2026-02-04-001) - Lab.tif';
  cd testing/iso/ptf/2025 && node experiments/tiff-diff.js "$REFERENCE" "$SAMPLE" --default-aggregation --debug-memory-footprint --verbose
)
```

Im0 — large dataset (3812x2750, 7,545,931 unique reference colors):

```bash
(
  export REFERENCE=experiments/fixtures/tiff-diff/'Im0 - Lab - Reference.tif';
  export SAMPLE=experiments/fixtures/tiff-diff/'Im0 - Lab - Lab 16-bit - Relative Colorimetric - Refactored - Main Thread - Color-Engine 2025-12-19 (2026-02-06-008) - Lab.tif';
  cd testing/iso/ptf/2025 && node --max-old-space-size=8192 experiments/tiff-diff.js "$REFERENCE" "$SAMPLE" --default-aggregation --debug-memory-footprint --verbose
)
```

#### `'TypedArrays'` Strategy Details

Uses parallel typed arrays instead of millions of JS objects:

| Array                        | Type         | Purpose                                    |
| ---------------------------- | ------------ | ------------------------------------------ |
| `rLabL`, `rLabA`, `rLabB`    | Float32Array | Reference color Lab values                 |
| `rPixels`                    | Uint32Array  | Pixel count per reference color            |
| `rMatched`                   | Uint8Array   | Whether reference color has a sample match |
| `rDeSum`, `rDeMin`, `rDeMax` | Float64Array | Delta-E accumulators per reference color   |
| `rSumSL`, `rSumSA`, `rSumSB` | Float64Array | Sample Lab sum accumulators (for mean)     |
| `sLabL`, `sLabA`, `sLabB`    | Float32Array | Sample color Lab values                    |
| `sPixels`                    | Uint32Array  | Pixel count per sample color               |
| `sMatched`                   | Uint8Array   | Whether sample color has a reference match |

**Numeric key encoding** — `labToKey(L, a, b)` packs Lab values (2-decimal precision) into a single safe integer:

```javascript
Math.round(L * 100) * 655360000 + (Math.round(a * 100) + 12800) * 25600 + (Math.round(b * 100) + 12800)
```

**Pair frequency packing** (when cross-match rounding enabled) — uses bit-shifted integer Lab for 23-bit sample keys:

```javascript
samplePacked = (kL << 16) | ((ka + 128) << 8) | (kb + 128)   // 23 bits
pairKey = refIndex * 8388608 + samplePacked                    // numeric key
```

**Two-pass architecture:**
1. Pass 1: Pixel iteration — collect Delta-E histogram, build ref/sample color indices, accumulate flat pair frequencies
2. Between passes: Compute means, process pair map → variants/overlaps/dominant sample, **free pair map** to reduce peak memory
3. Pass 2: StdDev and ΔEin computation using means from pass 1

**Bounded variability selection:** Instead of materializing all `VariabilityColor` objects, maintains two 10-element bounded arrays (top/bottom by coverage) + running summary aggregates during iteration.

**`variabilitySummary`:** Pre-computed `{ count, mean, min, max }` with per-metric aggregates. When present in `ComparisonResult`, `displayResults` uses this instead of computing from the full `variability` array.

### Performance Considerations

- Cross-matching stores all positions for reference colors when `'None'` strategy is active
- `'TypedArrays'` strategy uses scalar accumulators — no position storage, no nested Maps
- Statistics computed in single pass where possible (no `Math.min(...largeArray)`)
- ΔEin computed in the same second pass as standard deviation (no extra iteration)
- Large images (10M+ pixels) process in seconds with `'TypedArrays'` — 7.5M unique colors in 2.8 GB RSS
- Flat pair-frequency Map freed between passes to reduce peak memory in `'TypedArrays'` strategy
- `Float64Array` for mean/sum accumulators prevents precision loss (vs Float32Array) at +112 MB for 7M colors
- Empty arg filter (`if (arg === '') continue;`) in `parseArgs` handles shell line continuation artifacts
- `try/finally` in collect functions ensures `logMemory('complete')` fires even on error/OOM

### Code Style

- ES Modules with `// @ts-check`
- Top-level functions use `function` keyword
- Inner functions use arrow syntax
- JSDoc type annotations throughout

---

## Activity Log

### 2026-02-04

- **Created** `tiff-diff.js` with basic structure from existing TIFF reading code
- **Implemented** argument parsing following project CLI conventions
- **Fixed** multi-strip TIFF reading (original code only read single strip)
- **Fixed** 16-bit endianness handling for big-endian TIFFs
- **Researched** TIFF 6.0 CIELab encoding specification
- **Fixed** Lab conversion formula for 16-bit signed a*/b* values (divide by 256, not scale from 0-65535)
- **Implemented** Delta-E 1976 calculation
- **Implemented** unique color collection with position tracking
- **Implemented** cross-matching analysis with position-based Delta-E statistics
- **Added** `--without-cross-matching` flag
- **Fixed** stack overflow in statistics by avoiding spread operator on large arrays
- **Cleaned up** code: removed decorative emojis, converted inner functions to arrow syntax
- **Added** example commands as comments at end of file

### 2026-02-05

- **Improved** Image Information table: transposed layout (columns = Reference/Sample, rows = attributes)
- **Added** filenames printed separately via `console.log` before the table (filenames are too long for table columns)
- **Added** tag details to Image Information table: Endianness, Compression, Strips, Rows/Strip, ICC Profile
- **Added** RowsPerStrip tag parsing (tag 278) to `readTIFFImage`
- **Added** `endianness` to `readTIFFImage` return value
- **Updated** `ComparisonResult` typedef with new tag detail fields
- **Fixed** example command typo: reference filename corrected from IM3 to IM6
- **Added** `sampleCount` and `error` fields to `CrossMatchedColor` typedef
- **Updated** `computeCrossMatchStats` to track unique sample colors at reference positions and non-matching positions (Delta-E >= 1)
- **Renamed** "Count" to "Reference Count" in cross-matched table, added "Sample Count" column
- **Added** "Cross-Matched Sample Variability" table showing colors with Error > 0, sorted by Error descending
- **Changed** all display tables to use native types: `Number(x.toFixed(n))` instead of string `.toFixed()`, `true`/`false` instead of `'✓'`/`'✗'`, `[low, high]` arrays for histogram ranges, raw numbers instead of `.toLocaleString()`
- **Renamed** "Image Information" to "Image Metadata" with Tag column showing TIFF tag numbers
- **Added** tag parsing for PhotometricInterpretation (raw value), PlanarConfiguration (284), SampleFormat (339)
- **Replaced** "Dimensions" row with separate ImageWidth (256) and ImageLength (257) rows
- **Replaced** "Bits/Sample" string with `[number, ...]` array, removed "Color Space" (redundant with PhotometricInterpretation)
- **Added** metadata rows: SampleFormat (339), PhotometricInterpretation (262), SamplesPerPixel (277), PlanarConfiguration (284)
- **Used** official TIFF 6.0 tag names for all rows: ByteOrder, ImageWidth, ImageLength, BitsPerSample, SampleFormat, Compression, PhotometricInterpretation, SamplesPerPixel, RowsPerStrip, StripOffsets, PlanarConfiguration, ICCProfile
- **Changed** verbose dimension display to use multiply sign `×` instead of lowercase `x`
- **Created** `VariabilityColor` typedef distinct from `CrossMatchedColor`: `reference: { L, a, b }`, `sample: { L, a, b }`, pixels, overlaps, variants, coverage, deltaE
- **Removed** `error` field from `CrossMatchedColor` (variability is now a separate analysis)
- **Added** `computeVariabilityStats` function: iterates ALL unique reference colors, computes coverage (Overlaps/Pixels), sorts highest to lowest, assigns ranks
- **Added** `variability?: VariabilityColor[]` to `ComparisonResult` typedef
- **Updated** `compareTIFFImages` to compute variability via `computeVariabilityStats` with progress callback
- **Added** variability display: single table (≤ 20 rows) or two tables via `slice(0, 10)` and `slice(-10)` for Highest/Lowest Coverage
- **Added** CLI progress bar using `process.stdout.clearLine(0)` and `process.stdout.cursorTo(0)` with `isTTY` guard, cursor hide/show via ANSI escapes
- **Added** progress reporting throughout `compareTIFFImages`: loading (0-10%), converting (15%), Delta-E (20%), unique colors (40%), cross-matching (55%), variability (65-90%), matches (92%), complete (100%)
- **Added** `round(value, decimals)` utility function for numeric rounding (`Math.round(value * 10 ** decimals) / 10 ** decimals`)
- **Added** `--without-cross-match-rounding` CLI argument: default rounds sample Lab to integers for grouping keys; flag uses raw float values
- **Added** `crossMatchRounding` to `ParsedOptions` typedef (default: `true`)
- **Updated** `computeCrossMatchStats` and `computeVariabilityStats` to use `round()` for sample key generation when rounding is enabled
- **Added** `deltaEin` (internal Delta-E) to `CrossMatchedColor` and `VariabilityColor` typedefs: `{ mean, min, max }`
- **Added** ΔEin computation in `computeCrossMatchStats` and `computeVariabilityStats`: accumulates mean sample Lab in first pass, computes Delta-E of each sample pixel vs mean sample in second pass
- **Added** `--with-extended-statistics` CLI argument: shows Min ΔE and Min ΔEin columns (default: hidden)
- **Added** `extendedStatistics` to `ParsedOptions` typedef (default: `false`)
- **Added** Mean ΔEin and Max ΔEin columns to Cross-Matched Reference Colors and Sample Variability tables (always shown)
- **Added** Overall summary table for Cross-Matched Sample Variability: Mean, Min (opt-in), Max aggregates across all variability rows

### 2026-02-07

- **Wired** `collectAllStatsSequential` into `compareTIFFImages` with `USE_SEQUENTIAL_NESTED_MAP` branching — function existed but was not being called
- **Investigated** OOM: Maps strategy still OOMed at 8 GB on RGB-16bit reference vs Lab-8bit converted (7M+ unique colors × nested `sampleFreqs` Maps + full `allVariability` array)
- **Refactored** `USE_SEQUENTIAL_NESTED_MAP = true` → `AGGREGATION_STRATEGY` constant with three strategies: `'None'`, `'Maps'`, `'TypedArrays'`
- **Implemented** `collectAllStatsTypedArrays()` (~350 lines):
  - `labToKey()` numeric key encoding (2-decimal precision, single safe integer)
  - Parallel typed arrays: Float32Array (Lab values), Uint32Array (counts), Float64Array (sum accumulators), Uint8Array (matched flags)
  - Dynamic `growArray()` helpers for resizable typed arrays
  - Flat pair-frequency Map with numeric keys (freed between passes to reduce peak memory)
  - Pass 1: pixel iteration, Delta-E histogram, ref/sample color indices, pair frequencies
  - Between passes: means, variants/overlaps/dominant sample from pair map
  - Pass 2: stdDev and ΔEin using pass-1 means
  - Bounded top/bottom 10 variability selection (avoids materializing 7M+ `VariabilityColor` objects)
  - Pre-computed `variabilitySummary` with mean/min/max aggregates
- **Updated** `compareTIFFImages()` with three-way branching on `AGGREGATION_STRATEGY`
- **Updated** `displayResults()` to use `variabilitySummary` when available (TypedArrays strategy), falling back to computing from full `variability` array (Maps/None strategies)
- **Added** `variabilitySummary` field to `ComparisonResult` typedef
- **Removed** `skipCrossMatching` heuristic — cross-matching always enabled regardless of image size
- **Fixed** regression: Bug 1 — bounded top/bottom selection ignored ties (strict `>` comparison), fixed with `varCmpDesc` multi-key comparator `(coverage DESC, overlaps DESC, pixels DESC)`
- **Fixed** regression: Bug 2 — Delta-E in cross-matching used per-pixel raw ref Lab instead of stored group representative Lab (`rLabL[ri]`, `rLabA[ri]`, `rLabB[ri]`). Fixed in both Pass 1 (accumulation) and Pass 2 (stdDev)
- **Fixed** regression: Bug 3 — `rDeMean`, `rMeanSL`, `rMeanSA`, `rMeanSB` used Float32Array causing precision loss. Changed to Float64Array
- **Fixed** display sort: final sort for `topByC`/`botByC` before building entries used single-key coverage sort instead of full `varCmpDesc`
- **Added** `logMemory(label, enabled)` helper that writes `[memory] label: heap=X MB, rss=Y MB` to stderr
- **Added** `--baseline-aggregation`, `--map-aggregation`, `--default-aggregation` CLI flags (mutually exclusive)
- **Added** `--debug-memory-footprint` CLI flag for memory profiling
- **Added** `aggregationStrategy` and `debugMemoryFootprint` to `ParsedOptions` typedef
- **Updated** `compareTIFFImages` signature to accept `aggregationStrategy` and `debugMemoryFootprint` parameters (replaces module-level `AGGREGATION_STRATEGY` constant for branching)
- **Updated** `collectAllStatsSequential` and `collectAllStatsTypedArrays` signatures with `debugMemoryFootprint` parameter
- **Wrapped** each strategy's body in `try { ... } finally { logMemory('complete') }` for reliable completion logging
- **Added** memory logging at critical stages: before image loading, after Lab Float32 conversion, before/after Pass 1 (with ref/sample/pair counts), after pair map freed, after Pass 2, complete
- **Added** empty arg filter (`if (arg === '') continue;`) to `parseArgs` — prevents shell line continuation artifacts from inserting empty positional args
- **Ran** practical analysis on IM6 (10K colors) and Im0 RGB-16bit (7.5M colors) with all three strategies and `--debug-memory-footprint`

---

## References

- [TIFF 6.0 Specification](https://www.itu.int/itudoc/itu-t/com16/tiff-fx/docs/tiff6.pdf) - CIELab encoding details
- [Delta-E 1976](https://en.wikipedia.org/wiki/Color_difference#CIE76) - Color difference formula
