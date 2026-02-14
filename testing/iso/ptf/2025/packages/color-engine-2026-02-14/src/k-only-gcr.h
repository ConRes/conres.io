/**
 * @file k-only-gcr.h
 * @brief K-Only Black Point Compensation with Gray Component Replacement
 *
 * Custom rendering intent for Little-CMS that implements specialized BPC+GCR:
 * - Uses CMYK(0,0,0,100) as black reference instead of CMYK(100,100,100,100)
 * - Guarantees neutral grays convert to K-only output
 * - Chroma-modulated GCR for optimal ink distribution
 *
 * @author Saleh Abdel Motaal <dev@smotaal.io>
 * @ai Claude Sonnet 4.5 (initial code generation), Claude Opus 4 (subsequent modifications), Claude Opus 4.6 (fallback detection)
 * @date 2025-11-19
 * @license GPL-3.0-or-later
 */

#ifndef K_ONLY_GCR_H
#define K_ONLY_GCR_H

#include "lcms2.h"

#ifdef __cplusplus
extern "C" {
#endif

/**
 * Custom intent constant for K-Only BPC + GCR
 * Value chosen to not conflict with existing Little-CMS intents (0-15)
 */
#define INTENT_PRESERVE_K_ONLY_RELATIVE_COLORIMETRIC_GCR  20

/**
 * Flag to enable K-Only GCR debugging output
 * Outputs intermediate values at each algorithm stage for comparison with JS implementation
 */
#define cmsFLAGS_DEBUG_COLOR_ENGINE  0x40000000

/**
 * Parameters passed to K-Only GCR sampler function
 * Contains all state needed for CLUT generation
 */
typedef struct {
    // High-level transforms for color space conversions
    // NOTE: Using cmsHTRANSFORM instead of cmsPipeline* for compatibility with both matrix and LUT profiles
    cmsHTRANSFORM   input2lab;        // Input (RGB/CMYK/Gray) → Lab D50 transform
    cmsHTRANSFORM   lab2cmyk;         // Lab D50 → Output CMYK transform
    cmsHTRANSFORM   cmyk2lab;         // Output CMYK → Lab D50 transform

    // Computed BPC scale factor
    cmsFloat64Number kOnlyBlackpointCompensationScale;

    // Scaled K-only blackpoint Lab (for final L* matching boundary check)
    // JavaScript equivalent: scaledOutputKOnlyBlackpointLab (transform.js line 1692)
    cmsCIELab scaledKOnlyBlackpointLab;

    // Configuration
    cmsFloat64Number neutralTolerance; // Chroma threshold for neutral detection
    cmsBool          doesNotRequireKOnlyGCR; // Profile natively enforces K-only behavior
    cmsBool          debugEnabled;     // Enable runtime debugging output

    // Input color space info
    cmsColorSpaceSignature inputColorSpace;
    cmsUInt32Number inputChannels;

} KOnlyGCRParams;

/**
 * Calculate K-Only BPC scale factor
 * Compares CMYK(100,100,100,100) vs CMYK(0,0,0,100) luminance
 *
 * @param ContextID Little-CMS context
 * @param hOutputProfile Output CMYK profile
 * @param Intent Base rendering intent to use
 * @param outKOnlyBlackpointLab Output: K-only blackpoint Lab (before scaling)
 * @return Scale factor (0.0-1.0) for L* compression
 */
cmsFloat64Number ComputeKOnlyBlackpointCompensationScale(
    cmsContext ContextID,
    cmsHPROFILE hOutputProfile,
    cmsUInt32Number Intent,
    cmsCIELab* outKOnlyBlackpointLab
);

/**
 * Apply K-Only BPC to Lab values
 * Scales L* channel while preserving a*, b*
 *
 * @param InputLab Source Lab color
 * @param OutputLab Destination Lab color (can be same as InputLab)
 * @param scale BPC scale factor from ComputeKOnlyBlackpointCompensationScale
 * @param debugEnabled Enable debug output for BPC transformation
 */
void ApplyKOnlyBlackpointCompensation(
    const cmsCIELab* InputLab,
    cmsCIELab* OutputLab,
    cmsFloat64Number scale,
    cmsBool debugEnabled
);

/**
 * Core GCR sampler function for 3D CLUT (RGB/Lab input)
 * Called for each grid point during CLUT generation
 *
 * @param In Input values (16-bit, 3 channels)
 * @param Out Output values (16-bit, 4 channels CMYK)
 * @param Cargo Pointer to KOnlyGCRParams structure
 * @return TRUE on success, FALSE on error
 */
int KOnlyGCRSampler3D(
    CMSREGISTER const cmsUInt16Number In[],
    CMSREGISTER cmsUInt16Number Out[],
    CMSREGISTER void* Cargo
);

/**
 * GCR sampler function for 4D CLUT (CMYK input)
 * Handles CMYK→CMYK re-separations
 *
 * @param In Input CMYK values (16-bit, 4 channels)
 * @param Out Output CMYK values (16-bit, 4 channels)
 * @param Cargo Pointer to KOnlyGCRParams structure
 * @return TRUE on success, FALSE on error
 */
int KOnlyGCRSampler4D(
    CMSREGISTER const cmsUInt16Number In[],
    CMSREGISTER cmsUInt16Number Out[],
    CMSREGISTER void* Cargo
);

/**
 * GCR sampler function for 1D CLUT (Gray input)
 * Ensures gray→K-only conversion
 *
 * @param In Input gray value (16-bit, 1 channel)
 * @param Out Output CMYK values (16-bit, 4 channels)
 * @param Cargo Pointer to KOnlyGCRParams structure
 * @return TRUE on success, FALSE on error
 */
int KOnlyGCRSampler1D(
    CMSREGISTER const cmsUInt16Number In[],
    CMSREGISTER cmsUInt16Number Out[],
    CMSREGISTER void* Cargo
);

/**
 * Main pipeline factory function for K-Only BPC+GCR intent
 * This is the entry point registered with Little-CMS's intent system
 *
 * @param ContextID Little-CMS context
 * @param nProfiles Number of profiles in chain
 * @param TheIntents Array of rendering intents
 * @param hProfiles Array of profile handles
 * @param BPC Array of BPC flags
 * @param AdaptationStates Array of chromatic adaptation states
 * @param dwFlags Transformation flags
 * @return cmsPipeline pointer on success, NULL on error
 */
cmsPipeline* BlackPreservingKOnlyGCRIntents(
    cmsContext ContextID,
    cmsUInt32Number nProfiles,
    cmsUInt32Number TheIntents[],
    cmsHPROFILE hProfiles[],
    cmsBool BPC[],
    cmsFloat64Number AdaptationStates[],
    cmsUInt32Number dwFlags
);

#ifdef __cplusplus
}
#endif

#endif // K_ONLY_GCR_H
