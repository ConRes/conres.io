# CE Lab K-Only Neutral Fix — TFG Handoff

**Date:** 2026-03-27
**Author:** Saleh Abdel Motaal <dev@smotaal.io>
**AI:** Claude Opus 4.6 (code generation)

---

## The Problem That Was Fixed

Neutral Lab input (a*=0, b*=0) was producing non-neutral CMYK output (CMY residuals 1-8%) when converted through the K-Only GCR pipeline. This affected both content stream colors and image pixels.

## Root Cause

LittleCMS's 16-bit pipeline evaluation path introduces chromaticity errors when evaluating analytical Lab-to-sRGB stages. The float evaluation path does not have this issue.

## CE Fix (Already Applied)

Three changes in the Color Engine:

### 1. Pipeline Concatenation (`multiprofile-lut.c`)

For Lab-to-CMYK K-Only (both 2-profile and 3+ profile paths), replaced the `CompositeLUTSampler` approach (which baked everything into a single CLUT with encoding mismatch artifacts) with **pipeline concatenation**: analytical Lab-to-sRGB pipeline stages (from `_cmsDefaultICCintents`) concatenated with the K-Only sRGB-to-CMYK CLUT (from `BlackPreservingKOnlyGCRIntents`) using `cmsPipelineCat`. The analytical stages preserve Lab neutrality exactly; the K-Only CLUT preserves R=G=B neutrality via tetrahedral interpolation.

### 2. Lab16 Float Promotion (`color-engine-plugin.c`)

For Lab 16-bit input (TYPE_Lab_16, TYPE_Lab_16_SE), the Color Engine Plugin's transform dispatch forces float pipeline evaluation instead of the default 16-bit path. The 16-bit input formatter reads raw bytes (handling endianness/SE), then the plugin converts from Lab16 wire format to pipeline float using V4 scaling (`value / 65280.0f`), and evaluates via `cmsPipelineEvalFloat`. This is activated by the custom flag `cmsFLAGS_LAB16_FLOAT_PROMOTION` (bit 28, value `0x10000000`) which is set internally by `CreateKOnlyGCRMultiprofileTransform`.

### 3. Lazy Optimization Skip

When `cmsFLAGS_LAB16_FLOAT_PROMOTION` is set, the plugin's lazy `_cmsOptimizePipeline` call adds `cmsFLAGS_NOOPTIMIZE` to prevent LittleCMS from merging the concatenated analytical stages back into a single CLUT.

## What This Means for TFG

**No TFG code changes are needed for the fix to work.** The existing TFG pipeline -- policy evaluation triggering `requiresMultiprofileTransform: true` for Lab-to-CMYK K-Only, calling `createMultiprofileTransform([Lab, CMYK])` -- already works correctly with the updated CE build.

**The Lab 16-bit rescaling block that was added and then reverted should stay removed.** The CE engine now handles V4 Lab16 encoding correctly via float promotion. TFG should pass the raw PDF pixel bytes through unchanged with TYPE_Lab_16_SE (or TYPE_Lab_16 after byte-swap). No re-encoding is needed.

**The simplified Lab absolute-zero coercion (removing the K-Only GCR special case) is correct and should be kept.** The old code computed a separate Relative Colorimetric black for Lab absolute-zero pixels in K-Only mode. This is no longer needed because the CE pipeline now handles neutral Lab-to-K-only correctly.

## Lab 16-bit Encoding Context

PDF 2.0 (ISO 32000-2) adopted ICC V4 encoding for 16-bit Lab. Adobe has used V4 encoding since PDF 1.5 (Acrobat 6), even though the specification was not formalized until PDF 2.0. LittleCMS's TYPE_Lab_16 uses V4 encoding where neutral a*=0 maps to raw value 32768 (0x8000). The legacy PDF encoding (a*=0 maps to 32896 = 128 x 257) exists in older spec text but is not used by modern tools.

LittleCMS provides separate types: `TYPE_Lab_16` (V4, PT_Lab) and `TYPE_LabV2_16` (legacy, PT_LabV2). TFG should use `TYPE_Lab_16` / `TYPE_Lab_16_SE` for PDF Lab images, which is what the policy already resolves.

## Test Results

| Input | Before | After |
|---|---|---|
| Lab FLT to CMYK K-Only | 0% K-only | 100% K-only |
| Lab16 V4 (0x8000) to CMYK K-Only | 0% K-only | 100% K-only |
| Lab16 SE + big-endian to CMYK K-Only | 0% K-only | 100% K-only |
| Winterthur 16-bit Lab image (eciCMYK v2) | 0% K-only | 98.6% K-only (1.4% = genuinely non-neutral pixels) |
| Content stream Lab vectors | 0% K-only | 100% K-only |
| sRGB to CMYK K-Only | 100% K-only | 100% K-only (unchanged) |
| Gray to CMYK K-Only | 100% K-only | 100% K-only (unchanged) |
| Full CE test suite | 294 pass | 294 pass |

## Files Changed in CE

- `packages/color-engine/src/multiprofile-lut.c` -- Pipeline concatenation for 2-profile and 3+ profile K-Only Lab paths
- `packages/color-engine/src/multiprofile-lut.h` -- `cmsFLAGS_LAB16_FLOAT_PROMOTION` definition
- `packages/color-engine/src/color-engine-plugin.c` -- Lab16 float promotion in re-entry dispatch + lazy optimization skip

## TFG Files -- Status of Changes

**`color-converter.js`** -- The `evaluateConversionPolicy()` method addition: **keep**. It exposes policy evaluation to subclasses, does not affect conversion path.

**`pdf-image-color-converter.js`** -- Two changes:

1. **Simplified Lab absolute-zero coercion (removing K-Only special case): keep.** CE handles neutral Lab-to-K-only correctly now.
2. **16-bit Lab rescaling block: must stay removed.** This was remapping from PDF encoding (32896) to V4 (32768), but the actual pixel data already uses V4. The rescaling was an over-correction that double-shifted the values.
