# TIFF Diff CLI Progress

**Last Updated:** 2026-02-05

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

## Current Status

**Complete** — The `tiff-diff.js` CLI tool is fully functional.

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

| Term         | Definition                                                                                    |
| ------------ | --------------------------------------------------------------------------------------------- |
| **ΔE**       | Delta-E between reference Lab and sample Lab at each pixel position                           |
| **ΔEin**     | "Internal" Delta-E: each sample pixel vs the mean of all sample pixels for that reference     |
| **Coverage** | Overlaps / Pixels — how much of a reference color maps to a single dominant sample color      |
| **Overlaps** | Count of pixels where the most frequent sample color appears at a reference color's positions |
| **Variants** | Number of distinct sample colors found at a reference color's positions                       |

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

| Option                           | Default  | Description                            |
| -------------------------------- | -------- | -------------------------------------- |
| `--top=<N>`                      | 10       | Number of top unique colors to display |
| `--without-cross-matching`       | enabled  | Disable cross-matching analysis        |
| `--without-cross-match-rounding` | enabled  | Disable rounding for color grouping    |
| `--with-extended-statistics`     | disabled | Show Min ΔE and Min ΔEin columns       |
| `--verbose`, `-v`                | disabled | Show detailed progress output          |
| `--help`, `-h`                   |          | Show help message                      |

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
- JSON file saved to `<sample.tif>.json` with full comparison data

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

| Type                | Purpose                                                             |
| ------------------- | ------------------------------------------------------------------- |
| `UniqueColor`       | L, a, b values with count and pixel positions                       |
| `CrossMatchedColor` | Per-color ΔE and ΔEin stats for top N reference colors              |
| `VariabilityColor`  | Per-color stats with coverage, reference/sample Lab pairs           |
| `ComparisonResult`  | Full output: metadata, deltaE, topColors, crossMatched, variability |
| `ParsedOptions`     | CLI argument parsing result                                         |

### Utility Functions

| Function                    | Purpose                                                                 |
| --------------------------- | ----------------------------------------------------------------------- |
| `round(value, decimals)`    | Numeric rounding: `Math.round(value * 10 ** decimals) / 10 ** decimals` |
| `deltaE76(L1, a1, b1, ...)` | Delta-E 1976 Euclidean distance                                         |
| `writeProgress(op, pct)`    | Animated terminal progress bar with cursor hiding                       |
| `clearProgress()`           | Clear progress line and restore cursor                                  |

### Performance Considerations

- Cross-matching stores all positions for reference colors when enabled
- Statistics computed in single pass where possible (no `Math.min(...largeArray)`)
- ΔEin computed in the same second pass as standard deviation (no extra iteration)
- Large images (10M+ pixels) process in seconds

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

---

## References

- [TIFF 6.0 Specification](https://www.itu.int/itudoc/itu-t/com16/tiff-fx/docs/tiff6.pdf) - CIELab encoding details
- [Delta-E 1976](https://en.wikipedia.org/wiki/Color_difference#CIE76) - Color difference formula
