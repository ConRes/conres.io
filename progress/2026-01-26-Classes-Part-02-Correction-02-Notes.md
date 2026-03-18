# 2026-01-26-CLASSES-PART-02-CORRECTION-02.md

Correction of batch conversion implementation that violated WASM/SIMD batching directive

**Created:** 2026-01-27
**Status:** COMPLETE

---

## Failure Analysis

### What Went Wrong

In the refactored class hierarchy, `PDFContentStreamColorConverter.convertBatchUncached()` was implemented as a loop that called `convertSingleColor()` for each input:

```javascript
// WRONG - What Claude Code implemented
async convertBatchUncached(inputs, context) {
    const results = [];
    for (const input of inputs) {
        const values = await this.convertSingleColor(input, context);  // N individual calls
        results.push(values);
    }
    return results;
}
```

This violated an explicit directive that was placed directly in the code:

```javascript
/// CLAUDE CODE AGENT NEVER PERFORM SINGLE COLOR TRANSFORMS IN JS ALWAYS PASS BATCHES TO COLOR-ENGINE TO TRANSFORM IN WASM/SIMD ///
```

### Root Cause

1. **Hallucination persistence**: Claude Code repeatedly implemented individual color conversion despite:
   - Explicit code comments forbidding it
   - The `convertSingleColor` method being disabled with `throw new Error('Operation not allowed')`
   - Multiple user corrections in previous sessions

2. **Pattern blindness**: The agent followed a familiar "batch = loop over singles" pattern without recognizing that true batch processing requires grouping and single WASM calls

3. **Context loss between sessions**: Previous sessions had identified this as the root cause of 17-21% performance overhead, but the fix was not implemented correctly

### Evidence

**Performance investigation** (previous session) identified the root cause:

| Implementation | Approach | Performance |
|----------------|----------|-------------|
| Legacy `PDFService.convertColorInPDFDocument` | ONE `convertColors([...N colors...])` call per color type | Baseline |
| Refactored `convertBatchUncached` | N × `convertSingleColor()` calls | 17-21% slower |

**Call flow comparison:**

```
LEGACY (correct):
  convertColorInPDFDocument()
    → groupColorsByType()
    → colorEngine.convertColors(rgbColors)     // ONE batch call
    → colorEngine.convertColors(grayColors)    // ONE batch call
    → colorEngine.convertColors(labColors)     // ONE batch call

REFACTORED (wrong):
  buildLookupTable()
    → convertBatchUncached(uniqueColors)
      → for each color:
        → convertSingleColor(color)            // N individual calls
          → colorEngine.convertColor(color)    // N × overhead
```

### Lessons for Future Agents

1. **READ DIRECTIVE COMMENTS** - Code comments starting with `/// CLAUDE CODE AGENT` are explicit instructions
2. **"Batch" means GROUP THEN CALL ONCE** - Not "loop through individuals"
3. **WASM/SIMD optimization requires minimizing JS↔WASM boundary crossings** - Each call has overhead
4. **When a method throws "Operation not allowed"** - Do not call it, find the correct approach
5. **Performance matters** - 17-21% overhead is unacceptable when the fix is straightforward

---

## Correction Goals

After this correction:

1. **No individual color transforms** - `convertSingleColor` method removed entirely
2. **True batch conversion** - Group by colorSpace, one `convertColors()` call per group
3. **Explicit error handling** - Throw if source profiles missing (no silent failures)

---

## Code Changes

### File: `testing/iso/ptf/2025/classes/pdf-content-stream-color-converter.js`

#### Removed: `convertSingleColor` Method (lines 310-370)

The entire method was deleted, including the 60+ lines of commented-out code that Claude kept reverting to.

**Reason:** This method should never exist. All color conversion must go through batch processing.

#### Rewritten: `convertBatchUncached` Method

**Before (WRONG):**
```javascript
async convertBatchUncached(inputs, context) {
    const results = [];
    for (const input of inputs) {
        const values = await this.convertSingleColor(input, context);
        results.push(values);
    }
    return results;
}
```

**After (CORRECT):**
```javascript
async convertBatchUncached(inputs, context) {
    const service = this.colorEngineService;
    if (!service) {
        throw new Error('ColorEngineService not initialized');
    }

    if (inputs.length === 0) {
        return [];
    }

    const config = this.configuration;

    // Group inputs by colorSpace for efficient batching
    // Each group can be converted in a single WASM call
    const groups = new Map();

    for (let i = 0; i < inputs.length; i++) {
        const { colorSpace, values } = inputs[i];
        let group = groups.get(colorSpace);
        if (!group) {
            group = { indices: [], colors: [] };
            groups.set(colorSpace, group);
        }
        group.indices.push(i);
        group.colors.push({
            type: colorSpace,
            values: this.#pdfToEngine(colorSpace, values),
        });
    }

    // Prepare results array (will be filled out of order)
    const results = new Array(inputs.length);

    // Convert each group with a single batch call
    for (const [colorSpace, { indices, colors }] of groups) {
        // Determine source profile based on color space
        let sourceProfile;
        if (colorSpace === 'RGB') {
            const profile = this.sourceRGBProfile;
            if (!profile) {
                throw new Error('Source RGB profile not configured');
            }
            sourceProfile = profile;
        } else if (colorSpace === 'Lab') {
            sourceProfile = 'Lab';
        } else {
            // Gray
            const profile = this.sourceGrayProfile;
            if (!profile) {
                throw new Error('Source Gray profile not configured');
            }
            sourceProfile = profile;
        }

        // Determine effective rendering intent
        // K-Only GCR doesn't work for Lab or RGB destination
        let effectiveRenderingIntent = config.renderingIntent;
        if (config.renderingIntent === 'preserve-k-only-relative-colorimetric-gcr') {
            if (colorSpace === 'Lab' || config.destinationColorSpace === 'RGB') {
                effectiveRenderingIntent = 'relative-colorimetric';
            }
        }

        // Single batch call for all colors of this type
        const batchResults = await service.convertColors(colors, {
            sourceProfile,
            destinationProfile: config.destinationProfile,
            renderingIntent: effectiveRenderingIntent,
            blackPointCompensation: config.blackPointCompensation,
        });

        // Place results at correct indices and convert to PDF format
        for (let j = 0; j < indices.length; j++) {
            results[indices[j]] = this.#engineToPDF(batchResults[j].output.values);
        }
    }

    return results;
}
```

---

## Performance Impact

| Metric | Before | After |
|--------|--------|-------|
| WASM calls per batch | N (one per color) | 1-3 (one per colorSpace group) |
| Buffer allocations | N | 1-3 |
| JS↔WASM crossings | N | 1-3 |
| Expected overhead | 17-21% | ~0% (matches legacy) |

For a typical content stream with 50 unique colors (40 RGB, 8 Gray, 2 Lab):
- **Before:** 50 WASM calls
- **After:** 3 WASM calls (one RGB batch, one Gray batch, one Lab batch)

---

## Key Design Decisions

### 1. Group by ColorSpace

Colors must be grouped because `ColorEngineService.convertColors()` requires all colors in a batch to have the same type (for buffer packing).

### 2. Track Original Indices

Results must be returned in the same order as inputs. The implementation tracks original indices and reassembles results after batch conversion.

### 3. Explicit Errors for Missing Profiles

```javascript
if (!profile) {
    throw new Error('Source RGB profile not configured');
}
```

**Rationale:** The user explicitly requested "Throw if there is no source profile always — and never fail silently — I need to see errors to know where to look!"

### 4. K-Only GCR Limitation Handling

K-Only GCR rendering intent doesn't work correctly for:
- Lab colors (produces incorrect K=1 output)
- RGB destination (K-Only GCR is CMYK-specific)

The code automatically falls back to Relative Colorimetric for these cases.

---

## Verification Required

### Unit Tests
```bash
yarn test
```

### Matrix Benchmark (Performance Comparison)
```bash
# Run matrix with both legacy and refactored to compare timing
node 2025/experiments/scripts/generate-verification-matrix.mjs \
  --config=testing/iso/ptf/2025/experiments/configurations/2026-01-26-CLASSES-002.json
```

### Grep Verification
```bash
# Confirm convertSingleColor is removed
grep -rn "convertSingleColor" testing/iso/ptf/2025/classes/pdf-content-stream-color-converter.js
# Expected: 0 matches
```

---

## Current Status

**Status:** COMPLETE
**Last Updated:** 2026-01-27

---

## Activity Log

### 2026-01-27 - Correction Complete

- Removed `convertSingleColor` method entirely (was throwing error anyway)
- Rewrote `convertBatchUncached` with true batch conversion:
  - Groups inputs by colorSpace (RGB, Gray, Lab)
  - Makes ONE `service.convertColors()` call per group
  - Maintains original order via index tracking
- Added explicit error throwing for missing source profiles
- Preserved K-Only GCR → Relative Colorimetric fallback for Lab/RGB

### 2026-01-27 - Investigation Complete (Previous Session)

- Identified `convertBatchUncached` loop as root cause of 17-21% performance overhead
- Traced call flow from `buildLookupTable()` through to individual WASM calls
- Compared legacy `PDFService.convertColorInPDFDocument` (correct batching) vs refactored (incorrect looping)
- Documented that transform caching was NOT the issue (working correctly)
