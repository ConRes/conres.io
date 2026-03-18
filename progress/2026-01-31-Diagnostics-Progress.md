# Diagnostics "Changes" Feature Progress

**Last Updated:** 2026-01-31

## Objective

Add support for the "changes" feature in `generate-verification-matrix.mjs` to document and verify expected differences between "before" and "after" configurations.

---

## Background

The existing "comparison" feature compares "expected" vs "actual" for regression testing (same output expected):

```json
"comparison": {
    "enabled": true,
    "pairs": [
        { "expected": "Refactored - Main Thread", "actual": "Refactored - Workers" }
    ]
}
```

The new "changes" feature documents **expected differences** between versions:

```json
"changes": {
    "enabled": true,
    "groups": [
        {
            "description": "Multiprofile Black-Point Scaling for RGB profiles in Content Streams",
            "input": "<input-name>",
            "pairs": [
                { "before": "<config-name>", "after": "<config-name>" }
            ],
            "aspects": [
                {
                    "type": "Color",
                    "resource": "Contents",
                    "input": { "colorspace": "ICCBasedRGB", "values": [0, 0, 0] },
                    "before": { "colorspace": "DeviceRGB", "values": [0.03529, 0.03137, 0.03922], "tolerances": [0.001, 0.001, 0.001] },
                    "after": { "colorspace": "DeviceRGB", "values": [0.0052, 0.0000, 0.0042], "tolerances": [0.001, 0.001, 0.001] }
                }
            ]
        }
    ]
}
```

**Key structure notes:**
- `input` has only `colorspace` and `values` (exact match, no tolerances)
- `before` and `after` have `colorspace`, `values`, and `tolerances` (for verification)

---

## Current Understanding

### Differences from "comparison" Feature

| Aspect | "comparison" | "changes" |
| ------ | ------------ | --------- |
| Purpose | Regression testing | Document expected differences |
| Terminology | expected/actual | before/after |
| Expectation | Outputs should be identical | Outputs should differ in specific ways |
| Verification | File-level, image-level | Specific color values in content streams |

### Data Structure Analysis

The "changes" config specifies:
1. **groups**: Array of change documentation groups
2. **description**: Human-readable description of the change
3. **input**: Which input PDF to use
4. **pairs**: Before/after configuration pairs to compare
5. **aspects**: Specific aspects to verify (e.g., Color in Contents)

### Aspect Structure (type: "Color")

- **type**: "Color" (may be other types in future?)
- **resource**: "Contents" (content streams), possibly "Images"?
- **input**: Input color specification (colorspace, values, tolerances)
- **before**: Expected output in "before" configuration
- **after**: Expected output in "after" configuration

---

## User Decisions

### Output Format

New sections in both `SUMMARY.json` and `SUMMARY.md`, honoring any existing flags that affect output behavior (e.g., console-only modes for "comparison").

### Verification Scope

- Collect ALL values in content streams that fall within tolerances of the input values
- Track page and content stream position for each matched sample
- Use the existing regular expression for finding colors (don't duplicate)
- Structure output under subheading with outline: page > content stream > position
- Compare the same matches in input document to respective before/after documents

### Extraction Method

- Parse content streams using existing mechanisms in refactored classes
- Don't reinvent the wheel - use existing regular expressions
- Don't duplicate code

### Feature Interaction

Run both "changes" and "comparison" independently when both are enabled

---

## Existing Mechanisms to Reuse

### From `PDFContentStreamColorConverter` (`classes/pdf-content-stream-color-converter.js`)

- `COLOR_OPERATOR_REGEX` - comprehensive regex for parsing PDF color operators
- `parseContentStream(streamText, initialState)` - parses stream text into `ParsedColorOperation[]`
- `ParsedColorOperation` typedef - contains `type`, `operator`, `values`, `index`, `length`, `colorSpaceName`

### From `compare-pdf-color.js` (`experiments/compare-pdf-color.js`)

- `analyzePDF(pdfPath, sampleRate)` - extracts images, content streams, profiles from PDF
- `analyzeContentStream(stream, refStr, pageNum, streamIndex)` - extracts content stream info
- PDF loading pattern with `pdf-lib` and `decodePDFRawStream`

---

## Implementation Plan

### Phase 1: Add TypeScript Typedefs

Add to `generate-verification-matrix.mjs`:

```javascript
/**
 * Input color specification (exact match, no tolerances).
 * @typedef {{
 *   colorspace: string,
 *   values: number[],
 * }} ColorInputSpec
 */

/**
 * Output color specification (with tolerances for verification).
 * @typedef {{
 *   colorspace: string,
 *   values: number[],
 *   tolerances: number[],
 * }} ColorOutputSpec
 */

/**
 * @typedef {{
 *   type: 'Color',
 *   resource: 'Contents' | 'Images',
 *   input: ColorInputSpec,
 *   before: ColorOutputSpec,
 *   after: ColorOutputSpec,
 * }} ChangeAspect
 */

/**
 * @typedef {{
 *   description: string,
 *   input: string,
 *   pairs: Array<{before: string, after: string}>,
 *   aspects: ChangeAspect[],
 * }} ChangeGroup
 */

/**
 * @typedef {{
 *   pageNum: number,
 *   streamIndex: number,
 *   operatorIndex: number,
 *   operator: string,
 *   inputMatch: { values: number[], colorspace: string },
 *   beforeResult: { values: number[], match: boolean },
 *   afterResult: { values: number[], match: boolean },
 * }} ColorChangeMatch
 */
```

### Phase 2: Content Stream Color Extraction

Create helper function to extract colors matching a specification:

```javascript
async function extractMatchingColors(pdfPath, aspectInput) {
    // 1. Load PDF using same pattern as compare-pdf-color.js
    // 2. For each page's content streams:
    //    a. Decode stream
    //    b. Use COLOR_OPERATOR_REGEX to parse (same as PDFContentStreamColorConverter)
    //    c. Filter operations matching aspectInput.colorspace and within tolerances
    //    d. Record page, stream index, operator index, values
    // 3. Return array of matches with positions
}
```

Import mechanism: Import `COLOR_OPERATOR_REGEX` or duplicate the static regex (it's a const).

### Phase 3: Changes Verification Logic

```javascript
async function verifyChanges(jobs, outputFiles, workerCount) {
    if (!jobs.changes?.enabled) return null;

    const results = [];
    for (const group of jobs.changes.groups) {
        for (const pair of group.pairs) {
            const inputKey = `${group.input}|...|input`;
            const beforeKey = `${group.input}|...|${pair.before}`;
            const afterKey = `${group.input}|...|${pair.after}`;

            // Get input PDF path (original, unconverted)
            const inputPdfPath = jobs.inputs[group.input].pdf;
            const beforePdfPath = outputFiles.get(beforeKey);
            const afterPdfPath = outputFiles.get(afterKey);

            for (const aspect of group.aspects) {
                if (aspect.type === 'Color' && aspect.resource === 'Contents') {
                    // 1. Extract colors from INPUT PDF matching aspect.input
                    // 2. Extract colors from BEFORE PDF at same positions
                    // 3. Extract colors from AFTER PDF at same positions
                    // 4. Compare before values with aspect.before spec
                    // 5. Compare after values with aspect.after spec
                    // 6. Record results
                }
            }
        }
    }
    return results;
}
```

### Phase 4: Output and Reporting

Add to SUMMARY.json:
```json
{
  "changes": {
    "enabled": true,
    "groups": [
      {
        "description": "...",
        "matches": [...],
        "passed": true/false
      }
    ]
  }
}
```

Add to SUMMARY.md:
```markdown
## Changes Verification

### Multiprofile Black-Point Scaling for RGB profiles in Content Streams

| Page | Stream | Position | Input | Before (expected) | Before (actual) | After (expected) | After (actual) | Status |
|------|--------|----------|-------|-------------------|-----------------|------------------|----------------|--------|
| 1    | 0      | 42       | 0,0,0 | 0.035,0.031,0.039 | 0.035,0.031,0.039 | 0.005,0,0.004 | 0.005,0,0.004 | PASS |
```

### Phase 5: Integration

Add to `main()`:
1. After comparison section, add changes verification section
2. Run `verifyChanges()` if `jobs.changes?.enabled`
3. Add results to summary JSON and markdown

---

## Roadmap

- [x] Phase 1: Add TypeScript typedefs for changes config and results
- [x] Phase 2: Create color extraction helper using existing regex
- [x] Phase 3: Implement changes verification logic
- [x] Phase 4: Add output sections to SUMMARY.json and SUMMARY.md
- [x] Phase 5: Integrate with main() flow
- [ ] Phase 6: Test with 2026-01-30-REFACTOR-FIPS-CHANGES.json config
  - [x] Verified script loads config and runs changes verification
  - [x] Verified output sections in SUMMARY.json and SUMMARY.md
  - [ ] Full test (requires generating all 4 PDFs with both engine versions)

---

## Activity Log

| Date       | Activity                                                           |
| ---------- | ------------------------------------------------------------------ |
| 2026-01-31 | Created progress document with initial analysis                    |
| 2026-01-31 | Received user decisions on output format, verification, extraction |
| 2026-01-31 | Analyzed existing mechanisms in PDFContentStreamColorConverter and compare-pdf-color.js |
| 2026-01-31 | Created detailed implementation plan with 6 phases                 |
| 2026-01-31 | Exported COLOR_OPERATOR_REGEX from pdf-content-stream-color-converter.js |
| 2026-01-31 | Implemented changes verification: typedefs, extraction, verification, output |
| 2026-01-31 | Integrated into main() with SUMMARY.json and SUMMARY.md output     |
