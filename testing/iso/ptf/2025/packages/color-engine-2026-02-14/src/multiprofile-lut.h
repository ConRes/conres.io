/**
 * @file multiprofile-lut.h
 * @brief Gray Color Space Workaround for Multiprofile Transforms
 *
 * LittleCMS does not support Gray (PT_GRAY) color space in 3+ profile
 * multiprofile transforms. This module provides a composite LUT-based
 * workaround that:
 * - Detects Gray in 3+ profile chains
 * - Builds internal pipeline using Gray → Lab16 (2-profile, which works)
 * - Samples full pipeline to create single composite CLUT
 * - Returns LUT-based transform (same runtime performance as native multiprofile)
 *
 * @author Saleh Abdel Motaal <dev@smotaal.io>
 * @ai Claude Sonnet 4.5 (initial code generation), Claude Opus 4 (subsequent modifications), Claude Opus 4.6 (pure-black pretest)
 * @date 2026-01-05
 * @license GPL-3.0-or-later
 */

#ifndef MULTIPROFILE_LUT_H
#define MULTIPROFILE_LUT_H

#include "lcms2.h"

/**
 * Flag to enable explicit BPC scaling for multiprofile LUT creation.
 * When set, multiprofile LUT sampling:
 * 1. Uses 32-bit float for intermediate transforms
 * 2. Applies explicit Black Point Compensation scaling in Lab/XYZ space
 *
 * This ensures pure black → pure black mapping that Little-CMS's native
 * BPC doesn't provide for float transforms.
 *
 * Bit 29 - verified unused in Little-CMS (lcms2.h lines 1722-1756)
 */
#define cmsFLAGS_MULTIPROFILE_BLACKPOINT_SCALING 0x20000000

#ifdef __cplusplus
extern "C" {
#endif

/**
 * User data passed to composite LUT sampler callback
 * Contains N transforms that are chained sequentially to avoid Gray in 3+ profiles
 *
 * Supports arbitrary chains with Gray at any position(s):
 * - Example 1: Gray → sRGB → CMYK (2 segments)
 * - Example 2: sRGB → Gray → sRGB → CMYK (3 segments)
 * - Example 3: Lab → sRGB → Gray → sRGB → CMYK (4 segments)
 *
 * Each transform's output becomes the next transform's input during sampling.
 */
typedef struct {
    cmsHTRANSFORM* transforms;      // Array of transform handles (N transforms)
    cmsUInt32Number nTransforms;    // Number of transforms in chain
    cmsUInt32Number* outputChannels; // Output channel count for each transform (for buffer sizing)
    cmsUInt16Number** buffers;      // Intermediate buffers (N-1 buffers between transforms)
    cmsColorSpaceSignature outputColorSpace; // Final output color space (for achromatic coercion)
} CompositeLUTSamplerCargo;

/**
 * User data for float intermediate composite LUT sampler with BPC scaling
 * Used when cmsFLAGS_MULTIPROFILE_BLACKPOINT_SCALING is set.
 *
 * Similar to CompositeLUTSamplerCargo but uses float buffers for intermediate
 * values, providing higher precision during LUT sampling.
 *
 * Includes BPC scale factor and helper transforms for explicit black point
 * compensation in XYZ space, ensuring pure black → pure black mapping.
 */
typedef struct {
    cmsHTRANSFORM* transforms;                  // Array of FLOAT transform handles (N transforms)
    cmsUInt32Number nTransforms;                // Number of transforms in chain
    cmsUInt32Number* outputChannels;            // Output channel count per transform
    cmsFloat32Number** buffers;                 // Float intermediate buffers (N-1 buffers)
    cmsFloat32Number* outputBuffer;             // Final output buffer before 16-bit conversion
    cmsColorSpaceSignature inputColorSpace;     // For 16->float conversion range
    cmsColorSpaceSignature outputColorSpace;    // For achromatic coercion and float->16 conversion
    cmsUInt32Number inputChannels;              // Input channel count (for 16->float conversion)
    cmsFloat64Number blackpointScale;           // Blackpoint scale factor computed from lifted black
    cmsBool applyBlackpointScaling;             // Whether to apply explicit Blackpoint scaling
    cmsHTRANSFORM inputToXYZ;                   // Helper: input color space → XYZ (for Blackpoint at input)
    cmsHTRANSFORM xyzToInput;                   // Helper: XYZ → input color space (for Blackpoint at input)
    cmsHTRANSFORM outputToSRGB;                 // Helper: output color space → XYZ (for Blackpoint)
    cmsHTRANSFORM outputToXYZ;                  // Helper: output color space → XYZ (for Blackpoint)
    cmsHTRANSFORM xyzToOutput;                  // Helper: XYZ → output color space (for Blackpoint)
} CompositeLUTSamplerFloatCargo;

/**
 * Creates a Gray → Lab 16-bit transform
 *
 * LittleCMS supports Gray in 2-profile transforms, so we use Gray → Lab16
 * as an intermediate step when building composite LUTs for 3+ profile chains.
 *
 * @param ContextID     LittleCMS context (or NULL for global)
 * @param hGrayProfile  Gray profile handle
 * @param Intent        Rendering intent (PERCEPTUAL, RELATIVE_COLORIMETRIC, etc.)
 * @param dwFlags       Transform flags (cmsFLAGS_BLACKPOINTCOMPENSATION, etc.)
 * @return Transform handle or NULL on error
 *
 * @note Caller must call cmsDeleteTransform() when done
 */
cmsHTRANSFORM CreateGrayToLab16Transform(
    cmsContext ContextID,
    cmsHPROFILE hGrayProfile,
    cmsUInt32Number Intent,
    cmsUInt32Number dwFlags
);

/**
 * Sampler callback for composite LUT population
 *
 * Called by cmsStageSampleCLut16bit() for each grid point. Transforms
 * input coordinates through the internal multiprofile pipeline.
 *
 * @param In     Input grid coordinates (16-bit quantized)
 * @param Out    Output values to write (16-bit)
 * @param Cargo  Pointer to CompositeLUTSamplerCargo structure
 * @return TRUE to continue sampling, FALSE to abort
 */
cmsInt32Number CompositeLUTSampler(
    const cmsUInt16Number In[],
    cmsUInt16Number Out[],
    void* Cargo
);

/**
 * Sampler callback for composite LUT with float intermediate transforms
 *
 * Converts 16-bit grid coordinates to float, chains through float transforms,
 * then converts output back to 16-bit. Provides higher precision for
 * complex multiprofile chains when cmsFLAGS_MULTIPROFILE_BLACKPOINT_SCALING is set.
 *
 * @param In     Input grid coordinates (16-bit quantized)
 * @param Out    Output values to write (16-bit)
 * @param Cargo  Pointer to CompositeLUTSamplerFloatCargo structure
 * @return TRUE to continue sampling, FALSE to abort
 */
cmsInt32Number CompositeLUTSamplerFloat(
    const cmsUInt16Number In[],
    cmsUInt16Number Out[],
    void* Cargo
);

/**
 * Creates a composite LUT-based pipeline for Gray multiprofile chains
 *
 * Workaround for LittleCMS limitation: builds a single LUT by sampling
 * the full multiprofile pipeline with Gray → Lab16 segments.
 *
 * @param ContextID      LittleCMS context (or NULL for global)
 * @param hProfiles      Array of profile handles (must include Gray profile)
 * @param nProfiles      Number of profiles in array (must be >= 3)
 * @param InputFormat    Input color format (determines grid dimensionality)
 * @param OutputFormat   Output color format (determines CLUT output channels)
 * @param Intent         Rendering intent
 * @param dwFlags        Transform flags
 * @return Pipeline with populated CLUT, or NULL on error
 *
 * @note This function is called internally when Gray is detected in 3+ profile chains
 * @note Caller must call cmsPipelineFree() when done
 * @note Returns a pipeline, not a transform - caller creates transform if needed
 */
cmsPipeline* CreateCompositeLUTTransform(
    cmsContext ContextID,
    const cmsHPROFILE hProfiles[],
    cmsUInt32Number nProfiles,
    cmsUInt32Number InputFormat,
    cmsUInt32Number OutputFormat,
    cmsUInt32Number Intent,
    cmsUInt32Number dwFlags
);

/**
 * Detects if Gray color space is present in any profile in the chain
 *
 * @param hProfiles  Array of profile handles
 * @param nProfiles  Number of profiles in array
 * @return TRUE if any profile is Gray, FALSE otherwise
 */
cmsBool ContainsGrayProfile(
    const cmsHPROFILE hProfiles[],
    cmsUInt32Number nProfiles
);

/**
 * Unified multiprofile transform with automatic Gray and K-Only GCR handling
 *
 * Handles ALL multiprofile transform cases:
 * - Standard intents (2-profile and 3+)
 * - Gray workaround (when Gray is in 3+ chain)
 * - K-Only GCR (when intent is INTENT_PRESERVE_K_ONLY_RELATIVE_COLORIMETRIC_GCR and output is CMYK)
 * - K-Only GCR + Gray workaround (when both conditions apply)
 *
 * @param ContextID      LittleCMS context (or NULL for global)
 * @param hProfiles      Array of profile handles
 * @param nProfiles      Number of profiles (2-255)
 * @param InputFormat    Input color format
 * @param OutputFormat   Output color format
 * @param Intent         Rendering intent
 * @param dwFlags        Transform flags
 * @return Transform handle or NULL on error
 *
 * @note Automatically detects Gray in 3+ profiles and uses LUT workaround
 * @note Automatically handles K-Only GCR intent with sRGB intermediate for non-RGB input
 * @note Caller must call cmsDeleteTransform() when done
 */
cmsHTRANSFORM CreateMultiprofileTransform(
    cmsContext ContextID,
    const cmsHPROFILE hProfiles[],
    cmsUInt32Number nProfiles,
    cmsUInt32Number InputFormat,
    cmsUInt32Number OutputFormat,
    cmsUInt32Number Intent,
    cmsUInt32Number dwFlags
);

#ifdef __cplusplus
}
#endif

#endif // MULTIPROFILE_LUT_H
