# Assessment 2: Broken Implementation Gap Analysis
## Changes Verification in compare-pdf-outputs.js

**Date**: 2026-02-03
**Scope**: Identify all gaps between working and broken implementations
**Purpose**: Determine root causes of zero-match failure

---

## Executive Summary: Root Cause

The implementation **finds 0 matching input colors across all 78 tasks** because it **extracts colors from the wrong PDF**. Specifically:

- **Broken behavior**: Extracts from CONVERTED OUTPUT PDFs (Main Thread output, Workers output)
- **Expected behavior**: Should extract from SOURCE INPUT PDF (original unmodified fixture PDF)
- **Why this fails**: The input spec looks for `ICCBasedGray: [0]`, but converted PDFs contain `DeviceRGB: [0.025, 0.025, 0.025]` — completely different colors due to ICC profile-based conversion

---

## Evidence from Log

From `output/2026-02-02-007 Comparisons 001C.log`, every single task shows the same pattern:

```
Changes Verification Tasks: 78

Group: Main Thread vs Workers
  Input:  2025-08-15 - ConRes - ISO PTF - CR1 (F9d) Fixtures - F-01
  Output: FIPS_WIDE_28T-TYPEavg - Relative Colorimetric
  Aspect: Color (Contents)
  Input Color: ICCBasedGray [0]
  Pair Members:
    Main Thread: ... [EXISTS]
    Workers: ... [EXISTS]

────────────────────────────────────────────────────────────
Processing changes task 1/78: Main Thread vs Workers
────────────────────────────────────────────────────────────
  Extracting colors from: Main Thread
    Found 2067 color operations
  Extracting colors from: Workers
    Found 2067 color operations
  Found 0 matching input colors
  Results: 0 passed, 0 failed out of 0
```

The 2067 count is from the CONVERTED PDFs. The zero matches confirm that input color specifications are never found because the input PDF is never extracted.

---

## Critical Gaps Identified

| # | Gap | Severity | Root Cause | Fix Required |
|---|-----|----------|------------|--------------|
| 1 | Input PDF not extracted | **CRITICAL** | Extracts from wrong PDFs (outputs instead of input) | Add input PDF lookup from config.inputs |
| 2 | Config inputs not accessed | **HIGH** | Missing `config.inputs[task.input].pdf` lookup | Pass config to executeChanges() |
| 3 | No SUMMARY.json output | **HIGH** | Missing summary generator function | Add generateSummaryJson() |
| 4 | Wrong output filename | **MEDIUM** | Uses VERIFICATION instead of CHANGES | Change default basename |
| 5 | JSON structure mismatch | **MEDIUM** | Different top-level keys than working impl | Restructure output format |
| 6 | Markdown format different | **LOW** | Different table column layout | Adjust markdown output |

---

## Detailed Gap Analysis

### Gap 1: Input PDF Not Extracted (CRITICAL)

**Working Implementation Flow**:
```
1. Get input PDF path from config: config.inputs[group.input].pdf
2. Extract ALL colors from input PDF
3. Find colors matching input spec (colorspace + values)
4. For each matched position, verify in output PDFs
```

**Broken Implementation Flow**:
```
1. Extract from OUTPUT PDF 1 (Main Thread converted)
2. Extract from OUTPUT PDF 2 (Workers converted)
3. Try to find InputSpec in OUTPUT colors → 0 matches
   ❌ Because "ICCBasedGray: [0]" doesn't exist in converted PDFs
```

**Code Location**: `executeChanges()` around line 1857-1872

**Current Code**:
```javascript
// Extract colors from each PDF
for (const member of task.pairMembers) {
    const actualPath = findActualPdfPath(member.pdfPath, sourceDir);
    // ...
    const colors = await ContentStreamColorExtractor.extractColors(actualPath);
    pdfColors.set(member.name, colors);
}
```

**Missing Code**:
```javascript
// Should FIRST extract from INPUT PDF
const inputPdfPath = config.inputs[task.input].pdf;
const inputColors = await ContentStreamColorExtractor.extractColors(inputPdfPath);

// THEN find matching positions in input
const inputMatches = ContentStreamColorExtractor.findMatchingColors(inputColors, {
    colorspace: task.aspect.input.colorspace,
    values: task.aspect.input.values,
});
```

### Gap 2: Config Inputs Not Accessible

**Problem**: `executeChanges()` doesn't have access to `config` object to look up input PDF paths.

**Current Signature**:
```javascript
async function executeChanges(tasks, options, configURL)
```

**Required Signature**:
```javascript
async function executeChanges(tasks, options, configURL, config)
```

**Call Site** (in main()):
```javascript
// Current
changesResults = await executeChanges(tasks, options, configURL);

// Required
changesResults = await executeChanges(tasks, options, configURL, config);
```

### Gap 3: No SUMMARY.json Output

**Working Implementation Outputs**:
- `CHANGES.json` — Detailed per-verification results
- `CHANGES.md` — Human-readable tables
- `SUMMARY.json` — High-level pass/fail counts
- `SUMMARY.md` — Human-readable summary

**Broken Implementation Outputs**:
- `VERIFICATION.json` — Combined structure
- `VERIFICATION.md` — Combined markdown

**Missing Function**: `generateSummaryJson(changesResults)` to create summary statistics.

### Gap 4: Wrong Output Filename

**Current Code** (around line 2211):
```javascript
let outputBasename = 'VERIFICATION';
if (runComparisons && !runChanges) {
    outputBasename = 'COMPARISONS';
} else if (runChanges && !runComparisons) {
    outputBasename = 'CHANGES';
}
```

**Issue**: Default is 'VERIFICATION' when both run. For changes-only, it correctly uses 'CHANGES', but should also output separate files when both run.

### Gap 5: JSON Structure Mismatch

**Working CHANGES.json Structure**:
```javascript
{
  configPath: "...",
  outputSuffix: "2026-02-02-007",
  enabled: true,
  passed: 6,
  failed: 0,
  groups: [
    {
      description: "...",
      verifications: [...],
      passed: true,
      summary: { totalMatches, passedMatches, failedMatches }
    }
  ]
}
```

**Broken Implementation Structure**:
```javascript
{
  generated: "...",
  changes: [
    {
      group: "...",
      result: { passed, failed, total, verifications }
    }
  ]
}
```

**Key Differences**:
- Top-level `passed`/`failed` counts at root level
- `outputSuffix` field for directory identification
- Different nesting of verifications
- Summary statistics at group level

### Gap 6: Markdown Format Different

**Working CHANGES.md Columns**:
```
| Page | Stream | Op# | Input | [Pair1] Expected | Actual | Status | [Pair2] Expected | Actual | Status |
```

**Broken Implementation Columns**:
```
| Position | Status | Member | Colorspace | Values | Expected | Differences |
```

**Issues**:
- Different column layout
- Missing Page/Stream/Op separation
- Different status display format
- Missing pair-wise comparison layout

---

## Architectural Error Diagram

```
WORKING IMPLEMENTATION:
┌─────────────┐     ┌──────────────────────┐     ┌────────────────────┐
│ INPUT PDF   │ ──→ │ Extract Colors       │ ──→ │ Find Input Matches │
│ (Original)  │     │ (ICCBasedGray:[0])   │     │ (positions list)   │
└─────────────┘     └──────────────────────┘     └─────────┬──────────┘
                                                           │
                    ┌──────────────────────┐               │
                    │ OUTPUT PDF 1         │               │
                    │ (Main Thread)        │ ◄─────────────┤
                    └──────────────────────┘               │ Lookup same
                    ┌──────────────────────┐               │ positions
                    │ OUTPUT PDF 2         │               │
                    │ (Workers)            │ ◄─────────────┘
                    └──────────────────────┘


BROKEN IMPLEMENTATION:
┌─────────────┐
│ INPUT PDF   │     NEVER EXTRACTED! ❌
│ (Original)  │
└─────────────┘

┌──────────────────────┐     ┌────────────────────┐
│ OUTPUT PDF 1         │ ──→ │ Find Input Matches │ ──→ 0 matches!
│ (Has DeviceRGB,      │     │ Looking for        │     ICCBasedGray
│  not ICCBasedGray!)  │     │ ICCBasedGray:[0]   │     doesn't exist
└──────────────────────┘     └────────────────────┘     in output PDFs
```

---

## Components That Are Correct

- ✅ **ContentStreamColorExtractor.extractColors()**: Correctly extracts and normalizes colorspaces
- ✅ **ContentStreamColorExtractor.findMatchingColors()**: Correct matching logic with epsilon tolerance
- ✅ **ColorChangeMetrics**: Correctly records verifications
- ✅ **Output spec access**: Correctly accesses `task.aspect[member.name]`
- ✅ **Position matching logic**: Correct tuple comparison, just operating on wrong data

---

## Testing the Fixes

**Before Fix**:
```
Total verifications: 0
  PASSED: 0
  FAILED: 0
```

**After Fix** (expected):
```
Total verifications: >0 (depending on input PDF contents)
  PASSED: (actual pass count)
  FAILED: (actual fail count)
```

The working implementation found 1978 verifications per group, so similar counts should be expected after fix.

---

## Conclusion

This is not a complex algorithmic bug or subtle edge case — it's an **architectural oversight** where the entire input extraction pipeline was bypassed. The position-based matching strategy (which is the core of the working implementation) is **already correctly implemented** in ContentStreamColorExtractor. It just needs to be applied to the correct PDF (the input, not the outputs).

**Root Cause**: The `executeChanges()` function never extracts colors from the source/input PDF. It only extracts from the converted output PDFs, which have completely different colorspaces and values.

**Fix Priority**:
1. Add input PDF extraction (CRITICAL)
2. Pass config to executeChanges() (required for #1)
3. Fix output file structure (HIGH)
4. Fix JSON format (MEDIUM)
5. Fix Markdown format (LOW)
