/**
 * @file multiprofile-lut.c
 * @brief Gray Color Space Workaround for Multiprofile Transforms - Implementation
 *
 * Implements composite LUT-based workaround for LittleCMS Gray limitation.
 *
 * @author Saleh Abdel Motaal <dev@smotaal.io>
 * @ai Claude Sonnet 4.5 (initial code generation), Claude Opus 4 (subsequent modifications), Claude Opus 4.6 (pure-black pretest)
 * @date 2026-01-05
 * @license GPL-3.0-or-later
 */

#include "multiprofile-lut.h"
#include "k-only-gcr.h"
#include "lcms2_internal.h"
#include <stdlib.h>
#include <string.h>

// Forward declaration of LittleCMS internal function (exported via patch 02)
// This function creates a transform from a custom pipeline
_cmsTRANSFORM* AllocEmptyTransform(
    cmsContext ContextID,
    cmsPipeline* lut,
    cmsUInt32Number Intent,
    cmsUInt32Number* InputFormat,
    cmsUInt32Number* OutputFormat,
    cmsUInt32Number* dwFlags
);

// Forward declarations for BPC scaling functions
static cmsFloat64Number ComputeBPCScaleFromLiftedBlack(const cmsCIEXYZ* liftedBlackXYZ);
static void ApplyBlackpointScalingInXYZ(const cmsCIEXYZ* inputXYZ, cmsCIEXYZ* outputXYZ, cmsFloat64Number scale);

/**
 * Creates a Gray → Lab 16-bit transform
 *
 * LittleCMS supports Gray in 2-profile transforms. This function creates
 * a Gray → Lab16 transform used as the first stage in composite LUT building.
 */
cmsHTRANSFORM CreateGrayToLab16Transform(
    cmsContext ContextID,
    cmsHPROFILE hGrayProfile,
    cmsUInt32Number Intent,
    cmsUInt32Number dwFlags
) {
    cmsHPROFILE hLab;
    cmsHTRANSFORM hTransform;

    // Create Lab D50 profile
    hLab = cmsCreateLab4ProfileTHR(ContextID, NULL);
    if (hLab == NULL) return NULL;

    // Create Gray → Lab16 transform (2-profile, works in LittleCMS)
    hTransform = cmsCreateTransformTHR(
        ContextID,
        hGrayProfile, TYPE_GRAY_16,
        hLab, TYPE_Lab_16,
        Intent,
        dwFlags
    );

    // Clean up Lab profile (transform holds its own reference)
    cmsCloseProfile(hLab);

    return hTransform;
}

/**
 * Sampler callback for composite LUT population
 *
 * Called by cmsStageSampleCLut16bit() for each grid point.
 * Chains N transforms sequentially to avoid Gray in 3+ profile chain.
 *
 * Algorithm:
 * - Transform 0: In → buffer[0]
 * - Transform 1: buffer[0] → buffer[1]
 * - ...
 * - Transform N-1: buffer[N-2] → Out
 *
 * Each transform's output becomes the next transform's input.
 */
cmsInt32Number CompositeLUTSampler(
    const cmsUInt16Number In[],
    cmsUInt16Number Out[],
    void* Cargo
) {
    CompositeLUTSamplerCargo* cargo = (CompositeLUTSamplerCargo*)Cargo;
    const cmsUInt16Number* input;
    cmsUInt16Number* output;
    cmsUInt32Number i;

    // Validate cargo
    if (cargo == NULL || cargo->transforms == NULL || cargo->nTransforms == 0) {
        return FALSE;  // Abort sampling
    }

    // Chain transforms sequentially
    input = In;  // Start with input grid coordinates

    for (i = 0; i < cargo->nTransforms; i++) {
        // Last transform outputs to Out, others use intermediate buffers
        output = (i == cargo->nTransforms - 1) ? Out : cargo->buffers[i];

        // Transform current input to output
        cmsDoTransform(cargo->transforms[i], input, output, 1);

        // Chain: this output becomes next input
        input = output;
    }

    // Achromatic coercion for Lab output:
    // Pure black (L=0) and pure white (L=65535) must have neutral a/b (32896)
    // This is a colorimetric truth: achromatic points have zero chroma
    if (cargo->outputColorSpace == cmsSigLabData) {
        if (Out[0] == 0 || Out[0] == 65535) {
            Out[1] = 32896;  // a* neutral in Lab16 encoding
            Out[2] = 32896;  // b* neutral in Lab16 encoding
        }
    }

    return TRUE;  // Continue sampling
}

/**
 * Sampler callback for composite LUT with float intermediate transforms
 *
 * Converts 16-bit grid coordinates to float (0.0-1.0), chains through
 * float transforms, then converts output back to 16-bit.
 *
 * Float encoding:
 * - Device colors (RGB, CMYK, Gray): 0.0-1.0 range
 * - Lab: L=0-100, a/b=-128 to +127
 */
cmsInt32Number CompositeLUTSamplerFloat(
    const cmsUInt16Number In[],
    cmsUInt16Number Out[],
    void* Cargo
) {
    CompositeLUTSamplerFloatCargo* cargo = (CompositeLUTSamplerFloatCargo*)Cargo;
    const cmsFloat32Number* input;
    cmsFloat32Number* output;
    cmsUInt32Number i;
    cmsFloat32Number inputFloat[cmsMAXCHANNELS];

    // Validate cargo
    if (cargo == NULL || cargo->transforms == NULL || cargo->nTransforms == 0) {
        return FALSE;
    }

    // Convert 16-bit input grid coordinates to float
    // Range depends on color space (Little-CMS uses 0-100% for ink spaces)
    if (cargo->inputColorSpace == cmsSigCmykData) {
        // CMYK: 0-65535 → 0-100%
        for (i = 0; i < cargo->inputChannels; i++) {
            inputFloat[i] = (cmsFloat32Number)In[i] * 100.0f / 65535.0f;
        }
    } else if (cargo->inputColorSpace == cmsSigLabData) {
        // Lab: L=0-100, a/b=-128 to +127
        inputFloat[0] = (cmsFloat32Number)In[0] * 100.0f / 65535.0f;
        inputFloat[1] = (cmsFloat32Number)In[1] * 255.0f / 65535.0f - 128.0f;
        inputFloat[2] = (cmsFloat32Number)In[2] * 255.0f / 65535.0f - 128.0f;
    } else {
        // Non-ink device colors (RGB, Gray, XYZ): 0-65535 → 0.0-1.0
        for (i = 0; i < cargo->inputChannels; i++) {
            inputFloat[i] = (cmsFloat32Number)In[i] / 65535.0f;
        }
    }

    input = inputFloat;

    // Chain through float transforms
    for (i = 0; i < cargo->nTransforms; i++) {
        // Last transform outputs to dedicated buffer, others use intermediate buffers
        output = (i == cargo->nTransforms - 1)
            ? cargo->outputBuffer
            : cargo->buffers[i];

        cmsDoTransform(cargo->transforms[i], input, output, 1);
        input = output;
    }

    // Apply BPC scaling at OUTPUT stage (after chain)
    // Convert output → XYZ, apply scaling with flattening, convert XYZ → output
    if (
        // cargo->applyBlackpointScaling && fabs(cargo->blackpointScale - 1.0) > 1e-7 &&
        cargo->outputToXYZ != NULL && cargo->xyzToOutput != NULL
    ) {

        cmsCIEXYZ outputXYZ, scaledXYZ;
        // cmsBool isBlackInput = (In[0] == 0 && In[1] == 0 && In[2] == 0);

        // Convert output to XYZ
        // cmsDoTransform(cargo->outputToSRGB, output, output, 1);
        cmsDoTransform(cargo->outputToXYZ, output, &outputXYZ, 1);
        cmsDoTransform(cargo->xyzToOutput, &outputXYZ, output, 1);

        // if (isBlackInput) fprintf(stderr, "[BPC] Before: RGB=[%.6f,%.6f,%.6f] XYZ=[%.6f,%.6f,%.6f] scale=%.6f\n", output[0], output[1], output[2], outputXYZ.X, outputXYZ.Y, outputXYZ.Z, cargo->blackpointScale);

        // Apply BPC scaling in XYZ space with flattening
        ApplyBlackpointScalingInXYZ(&outputXYZ, &scaledXYZ, cargo->blackpointScale);

        // if (isBlackInput) fprintf(stderr, "[BPC] After XYZ scale: [%.6f,%.6f,%.6f]\n", scaledXYZ.X, scaledXYZ.Y, scaledXYZ.Z);

        // Convert back to output color space
        cmsDoTransform(cargo->xyzToOutput, &scaledXYZ, output, 1);

        // if (isBlackInput) fprintf(stderr, "[BPC] Final RGB: [%.6f,%.6f,%.6f]\n", output[0], output[1], output[2]);
    }

    // Convert float output to 16-bit
    // Note: Little-CMS float formats use 0.0-1.0 for device colors,
    // but Lab uses L=0-100, a/b=-128 to +127
    {
        cmsUInt32Number finalOutputChannels = cargo->outputChannels[cargo->nTransforms - 1];

        if (cargo->outputColorSpace == cmsSigLabData) {
            // Lab float: L=0-100, a/b=-128 to +127
            // Lab16 encoding: L = L* * 65535 / 100, a/b = (value + 128) * 65535 / 255
            cmsFloat32Number L = output[0];
            cmsFloat32Number a = output[1];
            cmsFloat32Number b = output[2];

            // Clamp L to valid range
            if (L < 0.0f) L = 0.0f;
            if (L > 100.0f) L = 100.0f;

            // Clamp a/b to valid range
            if (a < -128.0f) a = -128.0f;
            if (a > 127.0f) a = 127.0f;
            if (b < -128.0f) b = -128.0f;
            if (b > 127.0f) b = 127.0f;

            Out[0] = (cmsUInt16Number)(L * 65535.0f / 100.0f + 0.5f);
            Out[1] = (cmsUInt16Number)((a + 128.0f) * 65535.0f / 255.0f + 0.5f);
            Out[2] = (cmsUInt16Number)((b + 128.0f) * 65535.0f / 255.0f + 0.5f);

            // Achromatic coercion: pure black/white must have neutral a/b
            if (Out[0] == 0 || Out[0] == 65535) {
                Out[1] = 32896;  // a* neutral in Lab16
                Out[2] = 32896;  // b* neutral in Lab16
            }
        } else if (cargo->outputColorSpace == cmsSigCmykData) {
            // CMYK float: Little-CMS uses 0-100% range for "ink space"
            // (see cmspack.c: IsInkSpace() returns true for CMYK)
            for (i = 0; i < finalOutputChannels; i++) {
                cmsFloat32Number v = output[i];
                // Clamp to 0-100% range
                if (v < 0.0f) v = 0.0f;
                if (v > 100.0f) v = 100.0f;
                // Convert 0-100 → 0-65535
                Out[i] = (cmsUInt16Number)(v * 65535.0f / 100.0f + 0.5f);
            }
        } else {
            // Non-ink device colors (RGB, Gray): 0.0-1.0 range
            for (i = 0; i < finalOutputChannels; i++) {
                cmsFloat32Number v = output[i];
                // Clamp to valid range
                if (v < 0.0f) v = 0.0f;
                if (v > 1.0f) v = 1.0f;
                Out[i] = (cmsUInt16Number)(v * 65535.0f + 0.5f);
            }
        }
    }

    return TRUE;
}

/**
 * Detects if Gray color space is present in any profile in the chain
 */
cmsBool ContainsGrayProfile(
    const cmsHPROFILE hProfiles[],
    cmsUInt32Number nProfiles
) {
    cmsUInt32Number i;

    for (i = 0; i < nProfiles; i++) {
        cmsColorSpaceSignature colorSpace = cmsGetColorSpace(hProfiles[i]);
        if (colorSpace == cmsSigGrayData) {
            return TRUE;
        }
    }

    return FALSE;
}

/**
 * Determines the number of output channels for a profile
 *
 * @param hProfile  Profile handle
 * @return Number of channels, or 0 on error
 */
static cmsUInt32Number GetProfileChannelCount(cmsHPROFILE hProfile) {
    cmsColorSpaceSignature colorSpace;

    if (hProfile == NULL) return 0;

    colorSpace = cmsGetColorSpace(hProfile);

    switch (colorSpace) {
        case cmsSigGrayData:  return 1;
        case cmsSigRgbData:   return 3;
        case cmsSigCmykData:  return 4;
        case cmsSigLabData:   return 3;
        case cmsSigXYZData:   return 3;
        default:              return cmsChannelsOf(colorSpace);
    }
}

/**
 * Determines the appropriate 16-bit TYPE_* format for a profile
 *
 * @param hProfile  Profile handle
 * @return LittleCMS format constant (TYPE_*_16), or 0 on error
 */
static cmsUInt32Number GetProfile16BitFormat(cmsHPROFILE hProfile) {
    cmsColorSpaceSignature colorSpace;

    if (hProfile == NULL) return 0;

    colorSpace = cmsGetColorSpace(hProfile);

    switch (colorSpace) {
        case cmsSigGrayData:  return TYPE_GRAY_16;
        case cmsSigRgbData:   return TYPE_RGB_16;
        case cmsSigCmykData:  return TYPE_CMYK_16;
        case cmsSigLabData:   return TYPE_Lab_16;
        case cmsSigXYZData:   return TYPE_XYZ_16;
        default:
            // For other color spaces, construct format dynamically
            {
                cmsUInt32Number nChannels = cmsChannelsOf(colorSpace);
                return COLORSPACE_SH(colorSpace) |
                       CHANNELS_SH(nChannels) |
                       BYTES_SH(2);  // 16-bit
            }
    }
}

/**
 * Determines the appropriate float TYPE_* format for a profile
 *
 * Used when cmsFLAGS_MULTIPROFILE_BLACKPOINT_SCALING is set to create transforms
 * that operate in 32-bit float precision during LUT sampling.
 *
 * @param hProfile  Profile handle
 * @return LittleCMS format constant (TYPE_*_FLT), or 0 on error
 */
static cmsUInt32Number GetProfileFloatFormat(cmsHPROFILE hProfile) {
    cmsColorSpaceSignature colorSpace;

    if (hProfile == NULL) return 0;

    colorSpace = cmsGetColorSpace(hProfile);

    switch (colorSpace) {
        case cmsSigGrayData:  return TYPE_GRAY_FLT;   // 4390924
        case cmsSigRgbData:   return TYPE_RGB_FLT;    // 4456476
        case cmsSigCmykData:  return TYPE_CMYK_FLT;   // 4587556
        case cmsSigLabData:   return TYPE_Lab_FLT;    // 4849692
        case cmsSigXYZData:   return TYPE_XYZ_FLT;    // 4784156
        default:
            // For other color spaces, construct format dynamically
            {
                cmsUInt32Number nChannels = cmsChannelsOf(colorSpace);
                return FLOAT_SH(1) |
                       COLORSPACE_SH(colorSpace) |
                       CHANNELS_SH(nChannels) |
                       BYTES_SH(4);  // 4 bytes = float32
            }
    }
}

/**
 * Computes BPC scale factor from the "lifted black" output
 *
 * When Little-CMS transforms pure black with BPC, it produces a non-zero "lifted black".
 * This function computes the scale factor needed to map that lifted black back to pure black.
 *
 * Algorithm (from k-only-gcr.c ApplyKOnlyBlackpointCompensation):
 * 1. Convert lifted black RGB to XYZ
 * 2. Compute Y (luminance) of the lifted black
 * 3. Scale = (1 - Y_liftedBlack) / (1 - Y_sourceBlack)
 *    For source black (pure black), Y_sourceBlack = 0, so scale = 1 - Y_liftedBlack
 *
 * @param liftedBlackXYZ  XYZ of the "lifted black" (what black transforms to)
 * @return Scale factor for BPC correction
 */
static cmsFloat64Number ComputeBPCScaleFromLiftedBlack(
    const cmsCIEXYZ* liftedBlackXYZ
) {
    cmsFloat64Number scale;
    cmsFloat64Number yLiftedBlack = liftedBlackXYZ->Y;

    // Source black Y = 0, so scale = (1 - Y_lifted) / (1 - 0) = 1 - Y_lifted
    scale = 1.0 - yLiftedBlack;

    // Clamp scale to reasonable range
    if (scale < 0.0) scale = 0.0;
    if (scale > 1.0) scale = 1.0;

    // If scale is very close to 1.0, use exactly 1.0
    if (fabs(1.0 - scale) < 1e-7) {
        scale = 1.0;
    }

    return scale;
}

/**
 * Corrects BPC-induced "lifted black" back to true black in XYZ space
 *
 * Little-CMS's BPC produces a "lifted black" instead of true black.
 * This function applies the INVERSE of the BPC formula to correct it:
 *
 * BPC forward:  out = in * scale + (1 - scale)   // maps [0,1] to [offset, 1]
 * BPC inverse:  corrected = (out - offset) / scale  // maps [offset, 1] back to [0, 1]
 *
 * where offset = 1 - scale = Y_liftedBlack
 *
 * @param inputXYZ   Input XYZ values (the "lifted" output from Little-CMS)
 * @param outputXYZ  Output XYZ values (corrected)
 * @param scale      BPC scale factor (1 - Y_liftedBlack)
 */
static void ApplyBlackpointScalingInXYZ(
    const cmsCIEXYZ* inputXYZ,
    cmsCIEXYZ* outputXYZ,
    cmsFloat64Number scale
) {
    cmsFloat64Number offset = 1.0 - scale;

    // outputXYZ->X = inputXYZ->X * scale + offset / 0.956820;
    // outputXYZ->Y = inputXYZ->Y * scale + offset / 1.000000;
    // outputXYZ->Z = inputXYZ->Z * scale + offset / 0.921490;

    const cmsCIEXYZ sRGBWhitePoint = { 0.956820, 1.000000, 0.921490 }; // D65 in XYZ

    outputXYZ->X = inputXYZ->X  * scale + offset * sRGBWhitePoint.X;
    outputXYZ->Y = inputXYZ->Y  * scale + offset * sRGBWhitePoint.Y;
    outputXYZ->Z = inputXYZ->Z  * scale + offset * sRGBWhitePoint.Z;
    // outputXYZ->X = (inputXYZ->X / 0.956820 * scale + offset) * 0.956820;
    // outputXYZ->Y = (inputXYZ->Y / 1.000000 * scale + offset) * 1.000000;
    // outputXYZ->Z = (inputXYZ->Z / 0.921490 * scale + offset) * 0.921490;

    // outputXYZ->X = inputXYZ->X * scale + offset * cmsD50X;
    // outputXYZ->Y = inputXYZ->Y * scale + offset * cmsD50Y;
    // outputXYZ->Z = inputXYZ->Z * scale + offset * cmsD50Z;
    // outputXYZ->X = (inputXYZ->X / cmsD50X * scale + offset) * cmsD50X;
    // outputXYZ->Y = (inputXYZ->Y / cmsD50Y * scale + offset) * cmsD50Y;
    // outputXYZ->Z = (inputXYZ->Z / cmsD50Z * scale + offset) * cmsD50Z;


    // Clamp to valid range (can go negative for values below lifted black)
    // if (outputXYZ->X < 0.0) outputXYZ->X = 0.0;
    // if (outputXYZ->Y < 0.0) outputXYZ->Y = 0.0;
    // if (outputXYZ->Z < 0.0) outputXYZ->Z = 0.0;
    // if (outputXYZ->X > 1.0) outputXYZ->X = 1.0;
    // if (outputXYZ->Y > 1.0) outputXYZ->Y = 1.0;
    // if (outputXYZ->Z > 1.0) outputXYZ->Z = 1.0;
}

/**
 * Builds a chain of 2-profile transforms for multiprofile chains
 *
 * Strategy: ALWAYS use 2-profile transform pairs [0→1], [1→2], [2→3], etc.
 *
 * Why not use native multiprofile for non-Gray segments?
 * Testing revealed native LittleCMS multiprofile is inconsistent:
 * - `sRGB → sRGB → sRGB` (3 profiles) FAILS
 * - `Gray → sRGB → sRGB → sRGB` (4 profiles) PASSES
 * - `Lab → Lab → Lab` (3 profiles) PASSES
 *
 * To avoid these quirks, we always chain 2-profile transforms, which are
 * guaranteed to work correctly in LittleCMS.
 *
 * @param ContextID      LittleCMS context
 * @param hProfiles      Array of profile handles
 * @param nProfiles      Number of profiles (must be >= 3)
 * @param Intent         Rendering intent
 * @param dwFlags        Transform flags
 * @param cargo          Output: populated cargo structure (caller must free)
 * @return TRUE on success, FALSE on error
 */
static cmsBool BuildChainedTransforms(
    cmsContext ContextID,
    const cmsHPROFILE hProfiles[],
    cmsUInt32Number nProfiles,
    cmsUInt32Number Intent,
    cmsUInt32Number dwFlags,
    CompositeLUTSamplerCargo* cargo
) {
    cmsUInt32Number nTransforms;
    cmsHTRANSFORM* transforms = NULL;
    cmsUInt32Number* outputChannels = NULL;
    cmsUInt16Number** buffers = NULL;
    cmsUInt32Number i;
    cmsBool success = FALSE;

    // Strip clamping flag from intermediate transforms — these are temporary
    // transforms used during LUT construction, not the final returned transform.
    // The clamping flag (0x80000000) is our custom extension, invisible to LittleCMS.
    cmsUInt32Number intermediateFlags = dwFlags & ~0x80000000u;

    // Number of 2-profile transforms needed: nProfiles - 1
    // Example: [A, B, C, D] → [A→B, B→C, C→D] = 3 transforms
    nTransforms = nProfiles - 1;

    // Allocate arrays
    transforms = (cmsHTRANSFORM*)_cmsMalloc(ContextID, sizeof(cmsHTRANSFORM) * nTransforms);
    outputChannels = (cmsUInt32Number*)_cmsMalloc(ContextID, sizeof(cmsUInt32Number) * nTransforms);
    buffers = (cmsUInt16Number**)_cmsMalloc(ContextID, sizeof(cmsUInt16Number*) * nTransforms);

    if (transforms == NULL || outputChannels == NULL || buffers == NULL) {
        cmsSignalError(ContextID, cmsERROR_UNDEFINED, "BuildChainedTransforms: Memory allocation failed");
        goto cleanup;
    }

    // Initialize to NULL for safe cleanup
    for (i = 0; i < nTransforms; i++) {
        transforms[i] = NULL;
        buffers[i] = NULL;
    }

    // Create 2-profile transforms for each adjacent pair
    for (i = 0; i < nTransforms; i++) {
        cmsHPROFILE inputProfile = hProfiles[i];
        cmsHPROFILE outputProfile = hProfiles[i + 1];
        cmsUInt32Number inputFormat = GetProfile16BitFormat(inputProfile);
        cmsUInt32Number outputFormat = GetProfile16BitFormat(outputProfile);

        // Create 2-profile transform (guaranteed to work in LittleCMS)
        transforms[i] = cmsCreateTransformTHR(
            ContextID,
            inputProfile, inputFormat,
            outputProfile, outputFormat,
            Intent, intermediateFlags
        );

        if (transforms[i] == NULL) {
            cmsSignalError(ContextID, cmsERROR_UNDEFINED,
                "BuildChainedTransforms: Failed to create transform %u (%u→%u)",
                (unsigned)i, (unsigned)i, (unsigned)(i + 1));
            goto cleanup;
        }

        // Store output channel count for buffer allocation
        outputChannels[i] = GetProfileChannelCount(outputProfile);
    }

    // Allocate intermediate buffers (nTransforms - 1 buffers needed)
    // Buffer[i] holds output of transform[i] = input to transform[i+1]
    for (i = 0; i < nTransforms - 1; i++) {
        cmsUInt32Number bufferSize = outputChannels[i];
        buffers[i] = (cmsUInt16Number*)_cmsMalloc(ContextID, sizeof(cmsUInt16Number) * bufferSize);
        if (buffers[i] == NULL) {
            cmsSignalError(ContextID, cmsERROR_UNDEFINED,
                "BuildChainedTransforms: Failed to allocate buffer %u", (unsigned)i);
            goto cleanup;
        }
    }

    // Populate cargo structure
    cargo->transforms = transforms;
    cargo->nTransforms = nTransforms;
    cargo->outputChannels = outputChannels;
    cargo->buffers = buffers;

    success = TRUE;

cleanup:
    if (!success) {
        // Clean up on failure
        if (transforms != NULL) {
            for (i = 0; i < nTransforms; i++) {
                if (transforms[i] != NULL) cmsDeleteTransform(transforms[i]);
            }
            _cmsFree(ContextID, transforms);
        }
        if (outputChannels != NULL) _cmsFree(ContextID, outputChannels);
        if (buffers != NULL) {
            for (i = 0; i < nTransforms; i++) {
                if (buffers[i] != NULL) _cmsFree(ContextID, buffers[i]);
            }
            _cmsFree(ContextID, buffers);
        }
    }

    return success;
}

/**
 * Builds a chain of 2-profile FLOAT transforms for multiprofile chains
 *
 * Similar to BuildChainedTransforms but uses TYPE_*_FLT formats for
 * higher precision during LUT sampling. Called when cmsFLAGS_MULTIPROFILE_BLACKPOINT_SCALING
 * is set.
 *
 * Also computes the BPC scale factor for the entire chain (source → destination).
 *
 * @param ContextID      LittleCMS context
 * @param hProfiles      Array of profile handles
 * @param nProfiles      Number of profiles (must be >= 2)
 * @param Intent         Rendering intent
 * @param dwFlags        Transform flags
 * @param cargo          Output: populated float cargo structure (caller must free)
 * @return TRUE on success, FALSE on error
 */
static cmsBool BuildChainedTransformsFloat(
    cmsContext ContextID,
    const cmsHPROFILE hProfiles[],
    cmsUInt32Number nProfiles,
    cmsUInt32Number Intent,
    cmsUInt32Number dwFlags,
    CompositeLUTSamplerFloatCargo* cargo
) {
    cmsUInt32Number nTransforms;
    cmsHTRANSFORM* transforms = NULL;
    cmsUInt32Number* outputChannels = NULL;
    cmsFloat32Number** buffers = NULL;
    cmsFloat32Number* outputBuffer = NULL;
    cmsUInt32Number i;
    cmsBool success = FALSE;

    // Strip clamping flag from intermediate transforms — these are temporary
    // transforms used during LUT construction, not the final returned transform.
    cmsUInt32Number intermediateFlags = dwFlags & ~0x80000000u;

    // Number of 2-profile transforms needed: nProfiles - 1
    nTransforms = nProfiles - 1;

    // Allocate arrays
    transforms = (cmsHTRANSFORM*)_cmsMalloc(ContextID, sizeof(cmsHTRANSFORM) * nTransforms);
    outputChannels = (cmsUInt32Number*)_cmsMalloc(ContextID, sizeof(cmsUInt32Number) * nTransforms);
    buffers = (cmsFloat32Number**)_cmsMalloc(ContextID, sizeof(cmsFloat32Number*) * nTransforms);

    if (transforms == NULL || outputChannels == NULL || buffers == NULL) {
        cmsSignalError(ContextID, cmsERROR_UNDEFINED, "BuildChainedTransformsFloat: Memory allocation failed");
        goto cleanup;
    }

    // Initialize to NULL for safe cleanup
    for (i = 0; i < nTransforms; i++) {
        transforms[i] = NULL;
        buffers[i] = NULL;
    }

    // Create 2-profile FLOAT transforms for each adjacent pair
    // Keep BPC flag - we apply correction scaling ON TOP of Little-CMS's BPC
    for (i = 0; i < nTransforms; i++) {
        cmsHPROFILE inputProfile = hProfiles[i];
        cmsHPROFILE outputProfile = hProfiles[i + 1];
        cmsUInt32Number inputFormat = GetProfileFloatFormat(inputProfile);
        cmsUInt32Number outputFormat = GetProfileFloatFormat(outputProfile);

        // Create 2-profile float transform with intermediate flags (clamping stripped)
        transforms[i] = cmsCreateTransformTHR(
            ContextID,
            inputProfile, inputFormat,
            outputProfile, outputFormat,
            Intent, intermediateFlags
        );

        if (transforms[i] == NULL) {
            cmsSignalError(ContextID, cmsERROR_UNDEFINED,
                "BuildChainedTransformsFloat: Failed to create transform %u (%u→%u)",
                (unsigned)i, (unsigned)i, (unsigned)(i + 1));
            goto cleanup;
        }

        // Store output channel count for buffer allocation
        outputChannels[i] = GetProfileChannelCount(outputProfile);
    }

    // Allocate intermediate FLOAT buffers (nTransforms - 1 buffers needed)
    for (i = 0; i < nTransforms - 1; i++) {
        cmsUInt32Number bufferSize = outputChannels[i];
        buffers[i] = (cmsFloat32Number*)_cmsMalloc(ContextID, sizeof(cmsFloat32Number) * bufferSize);
        if (buffers[i] == NULL) {
            cmsSignalError(ContextID, cmsERROR_UNDEFINED,
                "BuildChainedTransformsFloat: Failed to allocate buffer %u", (unsigned)i);
            goto cleanup;
        }
    }

    // Allocate final output buffer
    {
        cmsUInt32Number finalOutputChannels = outputChannels[nTransforms - 1];
        outputBuffer = (cmsFloat32Number*)_cmsMalloc(ContextID, sizeof(cmsFloat32Number) * finalOutputChannels);
        if (outputBuffer == NULL) {
            cmsSignalError(ContextID, cmsERROR_UNDEFINED,
                "BuildChainedTransformsFloat: Failed to allocate output buffer");
            goto cleanup;
        }
    }

    // Populate cargo structure
    cargo->transforms = transforms;
    cargo->nTransforms = nTransforms;
    cargo->outputChannels = outputChannels;
    cargo->buffers = buffers;
    cargo->outputBuffer = outputBuffer;
    cargo->inputToXYZ = NULL;
    cargo->xyzToInput = NULL;
    cargo->outputToSRGB = NULL;
    cargo->outputToXYZ = NULL;
    cargo->xyzToOutput = NULL;
    cargo->blackpointScale = 1.0;
    cargo->applyBlackpointScaling = (dwFlags & cmsFLAGS_BLACKPOINTCOMPENSATION) != 0;

    // Create helper transforms for BPC scaling in XYZ space at OUTPUT stage
    // Only needed for device color spaces (RGB, CMYK) with BPC enabled
    if (cargo->applyBlackpointScaling) {
        cmsHPROFILE hOutputProfile = hProfiles[nProfiles - 1];
        cmsColorSpaceSignature outputCS = cmsGetColorSpace(hOutputProfile);

        if (outputCS == cmsSigRgbData) {
            cmsHPROFILE hXYZProfile = cmsCreateXYZProfileTHR(ContextID);
            cmsHPROFILE hRGBProfile = cmsCreate_sRGBProfileTHR(ContextID);

            cmsUInt32Number dwFlagsApplyBPC = 
                0
                // | cmsFLAGS_NOWHITEONWHITEFIXUP
                // | cmsFLAGS_NONEGATIVES
                // | cmsFLAGS_LOWRESPRECALC
                | cmsFLAGS_HIGHRESPRECALC
                | cmsFLAGS_NOOPTIMIZE
                | cmsFLAGS_NOCACHE
                // | cmsFLAGS_SOFTPROOFING
            ;

            if (hXYZProfile != NULL) {                
                // Output → XYZ transform (relative colorimetric, no BPC)
                cargo->outputToXYZ = cmsCreateTransformTHR(
                    ContextID,
                    // hOutputProfile, GetProfileFloatFormat(hOutputProfile),
                    hRGBProfile, GetProfileFloatFormat(hRGBProfile),
                    hXYZProfile, TYPE_XYZ_DBL,
                    INTENT_RELATIVE_COLORIMETRIC,
                    dwFlagsApplyBPC
                );

                // XYZ → Output transform (relative colorimetric, no BPC)
                cargo->xyzToOutput = cmsCreateTransformTHR(
                    ContextID,
                    hXYZProfile, TYPE_XYZ_DBL,
                    // hOutputProfile, GetProfileFloatFormat(hOutputProfile),
                    hRGBProfile, GetProfileFloatFormat(hRGBProfile),
                    INTENT_RELATIVE_COLORIMETRIC,
                    dwFlagsApplyBPC
                );

                cmsCloseProfile(hXYZProfile);

                // Compute BPC scale by running chain for black input
                // and measuring the "lifted black" in XYZ
                if (cargo->outputToXYZ != NULL) {
                    cmsFloat32Number blackInput[4] = {0.0f, 0.0f, 0.0f, 0.0f};
                    cmsFloat32Number liftedBlack[4];
                    cmsCIEXYZ liftedBlackXYZ;
                    const cmsFloat32Number* inp = blackInput;
                    cmsFloat32Number* outp;

                    // Run the transform chain for black input
                    for (i = 0; i < nTransforms; i++) {
                        outp = (i == nTransforms - 1)
                            ? liftedBlack
                            : buffers[i];
                        cmsDoTransform(transforms[i], inp, outp, 1);
                        inp = outp;
                    }

                    // Pure black pretest: if the chain already maps black to near-pure-black
                    // output, blackpoint scaling is unnecessary. Skip the XYZ round-trip
                    // which adds float precision noise and wastes computation.
                    //
                    // Detection: at least one channel is very near zero (≤ 0.00001),
                    // and ALL channels are below the upper residual threshold (≤ 0.001).
                    {
                        cmsUInt32Number finalOutputChannels = outputChannels[nTransforms - 1];
                        cmsBool allBelowUpperThreshold = TRUE;
                        cmsBool anyNearZero = FALSE;
                        cmsUInt32Number channelIndex;

                        for (channelIndex = 0; channelIndex < finalOutputChannels; channelIndex++) {
                            if (liftedBlack[channelIndex] > 0.001f) allBelowUpperThreshold = FALSE;
                            if (liftedBlack[channelIndex] <= 0.00001f) anyNearZero = TRUE;
                        }

                        if (allBelowUpperThreshold && anyNearZero) {
                            // Chain produces near-pure-black — skip scaling
                            cargo->blackpointScale = 1.0;
                            cargo->applyBlackpointScaling = FALSE;

                            // Clean up helper transforms to prevent XYZ round-trip in sampler
                            if (cargo->outputToXYZ != NULL) {
                                cmsDeleteTransform(cargo->outputToXYZ);
                                cargo->outputToXYZ = NULL;
                            }
                            if (cargo->xyzToOutput != NULL) {
                                cmsDeleteTransform(cargo->xyzToOutput);
                                cargo->xyzToOutput = NULL;
                            }
                        }
                    }

                    // Compute BPC scale — only if pretest did not skip scaling
                    if (cargo->outputToXYZ != NULL) {
                        // Convert lifted black to XYZ
                        // cmsDoTransform(cargo->outputToSRGB, liftedBlack, liftedBlack, 1);
                        cmsDoTransform(cargo->outputToXYZ, liftedBlack, &liftedBlackXYZ, 1);

                        // Compute BPC scale using TWO black points (like k-only-gcr.c):
                        // - blackWeGet: lifted black (what chain produces for black input)
                        // - blackWeWant: output profile's black (output [0,0,0] → XYZ with BPC)
                        {
                            cmsFloat32Number outputBlack[4] = {0.0f, 0.0f, 0.0f, 0.0f};
                            cmsCIEXYZ blackWeWantXYZ;
                            cmsHTRANSFORM outputToXYZWithBPC;
                            cmsHPROFILE hXYZProfile2;

                            // fprintf(stderr, "[Scale Debug] blackWeGet RGB (lifted): [%.6f, %.6f, %.6f]\n", liftedBlack[0], liftedBlack[1], liftedBlack[2]);
                            // fprintf(stderr, "[Scale Debug] blackWeGet XYZ (lifted): [%.6f, %.6f, %.6f]\n", liftedBlackXYZ.X, liftedBlackXYZ.Y, liftedBlackXYZ.Z);

                            // Create new XYZ profile for this transform
                            hXYZProfile2 = cmsCreateXYZProfileTHR(ContextID);
                            if (hXYZProfile2 != NULL) {
                                // Create output → XYZ transform WITHOUT BPC to get blackWeWant
                                // (the output profile's actual black point in XYZ)
                                outputToXYZWithBPC = cmsCreateTransformTHR(
                                    ContextID,
                                    // hOutputProfile, GetProfileFloatFormat(hOutputProfile),
                                    hRGBProfile, GetProfileFloatFormat(hRGBProfile),
                                    hXYZProfile2, TYPE_XYZ_DBL,
                                    INTENT_RELATIVE_COLORIMETRIC,
                                    dwFlagsApplyBPC | cmsFLAGS_BLACKPOINTCOMPENSATION
                                );


                                // cmsCIEXYZ labBlackpointXYZ;
                                // cmsCIELab labBlackpoint = {0.0, 0.0, 0.0};
                                // cmsLab2XYZ(cmsD50_XYZ(), &labBlackpointXYZ, &labBlackpoint);

                                cmsCloseProfile(hXYZProfile2);

                                if (outputToXYZWithBPC != NULL) {
                                    // Get blackWeWant: output [0,0,0] → XYZ (no BPC)
                                    cmsDoTransform(outputToXYZWithBPC, outputBlack, &blackWeWantXYZ, 1);
                                    cmsDeleteTransform(outputToXYZWithBPC);

                                    // fprintf(stderr, "[Scale Debug] blackWeWant RGB (output black): [%.6f, %.6f, %.6f]\n", outputBlack[0], outputBlack[1], outputBlack[2]);
                                    // fprintf(stderr, "[Scale Debug] blackWeWant XYZ (output black, no BPC): [%.6f, %.6f, %.6f]\n", blackWeWantXYZ.X, blackWeWantXYZ.Y, blackWeWantXYZ.Z);

                                    // Compute scale = (1 - yWeWant) / (1 - yWeGet)
                                    {
                                        cmsFloat64Number yWeGet = liftedBlackXYZ.Y; // < 0 ? 0 : liftedBlackXYZ.Y > 1 ? 1 : liftedBlackXYZ.Y;
                                        cmsFloat64Number yWeWant = blackWeWantXYZ.Y; // < 0 ? 0 : blackWeWantXYZ.Y > 1 ? 1 : blackWeWantXYZ.Y;
                                        // cmsFloat64Number yWeWant = labBlackpointXYZ.Y; // < 0 ? 0 : blackWeWantXYZ.Y > 1 ? 1 : blackWeWantXYZ.Y;

                                        cargo->blackpointScale = (1.0 - yWeWant) / (1.0 - yWeGet);

                                        // fprintf(stderr, "[Scale Debug] Scale = (1 - %.6f) / (1 - %.6f) = %.6f\n", yWeWant, yWeGet, cargo->blackpointScale);
                                    }
                                } else {
                                    // Fallback if transform creation fails
                                    cargo->blackpointScale = 1.0;
                                }
                            } else {
                                cargo->blackpointScale = 1.0;
                            }
                        }
                    }
                }
            }
            // cargo->blackpointScale = 1.0;
        }
    }

    success = TRUE;

cleanup:
    if (!success) {
        // Clean up on failure
        if (transforms != NULL) {
            for (i = 0; i < nTransforms; i++) {
                if (transforms[i] != NULL) cmsDeleteTransform(transforms[i]);
            }
            _cmsFree(ContextID, transforms);
        }
        if (outputChannels != NULL) _cmsFree(ContextID, outputChannels);
        if (buffers != NULL) {
            for (i = 0; i < nTransforms - 1; i++) {
                if (buffers[i] != NULL) _cmsFree(ContextID, buffers[i]);
            }
            _cmsFree(ContextID, buffers);
        }
        if (outputBuffer != NULL) _cmsFree(ContextID, outputBuffer);
    }

    return success;
}

/**
 * Frees resources in a CompositeLUTSamplerFloatCargo structure
 */
static void FreeFloatCargo(cmsContext ContextID, CompositeLUTSamplerFloatCargo* cargo) {
    cmsUInt32Number i;

    if (cargo == NULL) return;

    if (cargo->transforms != NULL) {
        for (i = 0; i < cargo->nTransforms; i++) {
            if (cargo->transforms[i] != NULL) {
                cmsDeleteTransform(cargo->transforms[i]);
            }
        }
        _cmsFree(ContextID, cargo->transforms);
    }

    if (cargo->outputChannels != NULL) {
        _cmsFree(ContextID, cargo->outputChannels);
    }

    if (cargo->buffers != NULL) {
        for (i = 0; i < cargo->nTransforms - 1; i++) {
            if (cargo->buffers[i] != NULL) {
                _cmsFree(ContextID, cargo->buffers[i]);
            }
        }
        _cmsFree(ContextID, cargo->buffers);
    }

    if (cargo->outputBuffer != NULL) {
        _cmsFree(ContextID, cargo->outputBuffer);
    }

    // Clean up BPC helper transforms (input stage)
    if (cargo->inputToXYZ != NULL) {
        cmsDeleteTransform(cargo->inputToXYZ);
    }
    if (cargo->xyzToInput != NULL) {
        cmsDeleteTransform(cargo->xyzToInput);
    }

    // Clean up BPC helper transforms (output stage)
    if (cargo->outputToXYZ != NULL) {
        cmsDeleteTransform(cargo->outputToXYZ);
    }
    if (cargo->xyzToOutput != NULL) {
        cmsDeleteTransform(cargo->xyzToOutput);
    }
}

/**
 * Creates a composite LUT-based pipeline for multiprofile chains
 *
 * Implementation strategy:
 * 1. Build chain of 2-profile transforms [0→1], [1→2], [2→3], etc.
 * 2. Determine grid size from input color space
 * 3. Allocate empty CLUT stage
 * 4. Sample through the chain using CompositeLUTSampler callback
 * 5. Build final pipeline with populated CLUT
 * 6. Return pipeline (caller creates transform)
 *
 * This approach avoids native LittleCMS multiprofile entirely, which has
 * inconsistent behavior (e.g., `sRGB → sRGB → sRGB` fails but
 * `Lab → Lab → Lab` passes). Chained 2-profile transforms are reliable.
 */
cmsPipeline* CreateCompositeLUTTransform(
    cmsContext ContextID,
    const cmsHPROFILE hProfiles[],
    cmsUInt32Number nProfiles,
    cmsUInt32Number InputFormat,
    cmsUInt32Number OutputFormat,
    cmsUInt32Number Intent,
    cmsUInt32Number dwFlags
) {
    cmsPipeline* pipeline = NULL;
    cmsStage* clutStage = NULL;
    CompositeLUTSamplerCargo cargo = {0};
    CompositeLUTSamplerFloatCargo floatCargo = {0};
    cmsUInt32Number nGridPoints;
    cmsUInt32Number inputChannels, outputChannels;
    cmsColorSpaceSignature inputColorSpace;
    cmsUInt32Number i;
    cmsBool success = FALSE;
    cmsBool useFloat = FALSE;

    // Validate parameters
    // Accept 2+ profiles (2-profile supported when cmsFLAGS_MULTIPROFILE_BLACKPOINT_SCALING is set)
    if (hProfiles == NULL || nProfiles < 2) {
        cmsSignalError(ContextID, cmsERROR_RANGE, "CreateCompositeLUTTransform: Invalid parameters");
        return NULL;
    }

    // Check for BPC scaling flag (uses float intermediates + explicit BPC)
    useFloat = (dwFlags & cmsFLAGS_MULTIPROFILE_BLACKPOINT_SCALING) != 0;

    // Extract channel counts from formats
    inputChannels = T_CHANNELS(InputFormat);
    outputChannels = T_CHANNELS(OutputFormat);

    if (inputChannels == 0 || outputChannels == 0) {
        cmsSignalError(ContextID, cmsERROR_RANGE, "CreateCompositeLUTTransform: Invalid format");
        return NULL;
    }

    // Get input color space to determine grid size
    inputColorSpace = cmsGetColorSpace(hProfiles[0]);

    // Determine grid points per dimension based on input color space
    nGridPoints = _cmsReasonableGridpointsByColorspace(inputColorSpace, dwFlags);

    // Step 1: Build chain of 2-profile transforms
    // This creates [0→1], [1→2], [2→3], etc. - all guaranteed to work
    if (useFloat) {
        // Use float transforms for higher precision during sampling
        if (!BuildChainedTransformsFloat(ContextID, hProfiles, nProfiles, Intent, dwFlags, &floatCargo)) {
            cmsSignalError(ContextID, cmsERROR_UNDEFINED, "CreateCompositeLUTTransform: Failed to build float chained transforms");
            goto cleanup;
        }
        floatCargo.inputColorSpace = inputColorSpace;
        floatCargo.outputColorSpace = cmsGetColorSpace(hProfiles[nProfiles - 1]);
        floatCargo.inputChannels = inputChannels;
    } else {
        // Use 16-bit transforms (original path)
        if (!BuildChainedTransforms(ContextID, hProfiles, nProfiles, Intent, dwFlags, &cargo)) {
            cmsSignalError(ContextID, cmsERROR_UNDEFINED, "CreateCompositeLUTTransform: Failed to build chained transforms");
            goto cleanup;
        }
        cargo.outputColorSpace = cmsGetColorSpace(hProfiles[nProfiles - 1]);
    }

    // Step 2: Allocate empty CLUT stage (always 16-bit for runtime efficiency)
    clutStage = cmsStageAllocCLut16bit(
        ContextID,
        nGridPoints,
        inputChannels,
        outputChannels,
        NULL  // NULL = create empty, will populate via sampling
    );

    if (clutStage == NULL) {
        cmsSignalError(ContextID, cmsERROR_UNDEFINED, "CreateCompositeLUTTransform: Failed to allocate CLUT stage");
        goto cleanup;
    }

    // Step 3: Sample the CLUT using appropriate sampler
    if (useFloat) {
        // Float intermediate sampler: 16-bit in → float transforms → 16-bit out
        success = cmsStageSampleCLut16bit(
            clutStage,
            CompositeLUTSamplerFloat,
            &floatCargo,
            0
        );
    } else {
        // Original 16-bit sampler
        success = cmsStageSampleCLut16bit(
            clutStage,
            CompositeLUTSampler,
            &cargo,
            0
        );
    }

    if (!success) {
        cmsSignalError(ContextID, cmsERROR_UNDEFINED, "CreateCompositeLUTTransform: CLUT sampling failed");
        goto cleanup;
    }

    // Step 4: Build final pipeline with populated CLUT stage
    pipeline = cmsPipelineAlloc(ContextID, inputChannels, outputChannels);
    if (pipeline == NULL) {
        cmsSignalError(ContextID, cmsERROR_UNDEFINED, "CreateCompositeLUTTransform: Failed to allocate pipeline");
        goto cleanup;
    }

    // Insert CLUT stage into pipeline
    // Note: cmsPipelineInsertStage takes ownership of the stage
    if (!cmsPipelineInsertStage(pipeline, cmsAT_END, clutStage)) {
        cmsSignalError(ContextID, cmsERROR_UNDEFINED, "CreateCompositeLUTTransform: Failed to insert CLUT stage");
        cmsStageFree(clutStage);
        goto cleanup;
    }
    clutStage = NULL;  // Pipeline owns it now

    // Step 5: Success - pipeline is ready to return
    success = TRUE;

cleanup:
    // Clean up cargo (intermediate transforms and buffers)
    if (useFloat) {
        FreeFloatCargo(ContextID, &floatCargo);
    } else {
        if (cargo.transforms != NULL) {
            for (i = 0; i < cargo.nTransforms; i++) {
                if (cargo.transforms[i] != NULL) {
                    cmsDeleteTransform(cargo.transforms[i]);
                }
            }
            _cmsFree(ContextID, cargo.transforms);
        }
        if (cargo.outputChannels != NULL) {
            _cmsFree(ContextID, cargo.outputChannels);
        }
        if (cargo.buffers != NULL) {
            for (i = 0; i < cargo.nTransforms - 1; i++) {
                if (cargo.buffers[i] != NULL) {
                    _cmsFree(ContextID, cargo.buffers[i]);
                }
            }
            _cmsFree(ContextID, cargo.buffers);
        }
    }

    // Clean up pipeline only on failure
    if (!success && pipeline != NULL) {
        cmsPipelineFree(pipeline);
        pipeline = NULL;
    }

    // Clean up CLUT stage only if not transferred to pipeline
    if (clutStage != NULL) {
        cmsStageFree(clutStage);
    }

    // Return pipeline on success, NULL on failure
    return pipeline;
}

/**
 * Creates a K-Only GCR multiprofile transform
 *
 * Handles K-Only GCR intent for multiprofile chains by:
 * 1. Building front-stage transforms with RELATIVE_COLORIMETRIC + BPC
 * 2. Inserting sRGB intermediate when last profile before CMYK is non-RGB
 * 3. Using KOnlyGCRSampler3D for the final sRGB → CMYK segment
 *
 * Key insight: KOnlyGCRSampler3D only works for RGB input, so we ensure
 * the input to the K-Only sampler is always sRGB.
 *
 * @param ContextID      LittleCMS context
 * @param hProfiles      Array of profile handles
 * @param nProfiles      Number of profiles (must be >= 2)
 * @param InputFormat    Input color format
 * @param OutputFormat   Output color format (must be CMYK)
 * @param dwFlags        Transform flags
 * @return Transform handle or NULL on error
 */
static cmsHTRANSFORM CreateKOnlyGCRMultiprofileTransform(
    cmsContext ContextID,
    const cmsHPROFILE hProfiles[],
    cmsUInt32Number nProfiles,
    cmsUInt32Number InputFormat,
    cmsUInt32Number OutputFormat,
    cmsUInt32Number dwFlags
) {
    cmsHTRANSFORM result = NULL;
    cmsHPROFILE hSRGBProfile = NULL;
    cmsPipeline* frontStagePipeline = NULL;
    cmsPipeline* kOnlyPipeline = NULL;
    cmsPipeline* combinedPipeline = NULL;
    cmsStage* frontStageClut = NULL;
    cmsStage* kOnlyClut = NULL;
    _cmsTRANSFORM* transform = NULL;

    // Strip clamping flag from intermediate transforms — these are temporary
    // transforms used during LUT construction, not the final returned transform.
    cmsUInt32Number intermediateFlags = dwFlags & ~0x80000000u;

    // Validate: output must be CMYK
    cmsColorSpaceSignature outputColorSpace = cmsGetColorSpace(hProfiles[nProfiles - 1]);
    if (outputColorSpace != cmsSigCmykData) {
        return NULL;
    }

    // Determine the color space of the profile feeding into the final CMYK profile
    // For 2-profile: profiles[0] → profiles[1](CMYK)
    // For 3+ profile: profiles[0] → ... → profiles[n-2] → profiles[n-1](CMYK)
    cmsHPROFILE hLastInputProfile = hProfiles[nProfiles - 2];
    cmsColorSpaceSignature lastInputColorSpace = cmsGetColorSpace(hLastInputProfile);
    cmsBool needsSRGBIntermediate = (lastInputColorSpace != cmsSigRgbData);

    // For 2-profile chains
    if (nProfiles == 2) {
        if (!needsSRGBIntermediate) {
            // Input is already RGB, delegate to existing K-Only GCR
            // Note: BlackPreservingKOnlyGCRIntents only handles 2-profile, which is what we have
            cmsUInt32Number intents[2] = { INTENT_PRESERVE_K_ONLY_RELATIVE_COLORIMETRIC_GCR, INTENT_PRESERVE_K_ONLY_RELATIVE_COLORIMETRIC_GCR };
            cmsBool blackpointCompensation[2] = { TRUE, TRUE };
            cmsFloat64Number adaptationStates[2] = { 1.0, 1.0 };

            kOnlyPipeline = BlackPreservingKOnlyGCRIntents(
                ContextID,
                2,
                intents,
                (cmsHPROFILE*)hProfiles,
                blackpointCompensation,
                adaptationStates,
                dwFlags
            );

            if (kOnlyPipeline == NULL) {
                return NULL;
            }

            // Create transform from pipeline
            cmsUInt32Number inputFormatCopy = InputFormat;
            cmsUInt32Number outputFormatCopy = OutputFormat;
            cmsUInt32Number dwFlagsCopy = dwFlags;

            transform = AllocEmptyTransform(
                ContextID,
                kOnlyPipeline,
                INTENT_PRESERVE_K_ONLY_RELATIVE_COLORIMETRIC_GCR,
                &inputFormatCopy,
                &outputFormatCopy,
                &dwFlagsCopy
            );

            if (transform == NULL) {
                cmsPipelineFree(kOnlyPipeline);
                return NULL;
            }

            // Initialize cache
            if (!(dwFlagsCopy & cmsFLAGS_NOCACHE)) {
                memset(&transform->Cache.CacheIn, 0, sizeof(transform->Cache.CacheIn));
                if (transform->Lut != NULL && transform->Lut->Eval16Fn != NULL) {
                    transform->Lut->Eval16Fn(
                        transform->Cache.CacheIn,
                        transform->Cache.CacheOut,
                        transform->Lut->Data
                    );
                }
            }

            return (cmsHTRANSFORM)transform;
        }

        // Input is non-RGB (Gray, Lab, CMYK), insert sRGB intermediate
        // Transform becomes: input → sRGB (RELATIVE_COLORIMETRIC) then sRGB → CMYK (K-Only GCR)
        hSRGBProfile = cmsCreate_sRGBProfileTHR(ContextID);
        if (hSRGBProfile == NULL) {
            return NULL;
        }

        // Build front-stage: input → sRGB (RELATIVE_COLORIMETRIC + BPC)
        cmsHTRANSFORM frontStageTransform = cmsCreateTransformTHR(
            ContextID,
            hProfiles[0], InputFormat,
            hSRGBProfile, TYPE_RGB_16,
            INTENT_RELATIVE_COLORIMETRIC,
            dwFlags | cmsFLAGS_BLACKPOINTCOMPENSATION | cmsFLAGS_NOOPTIMIZE
        );

        if (frontStageTransform == NULL) {
            cmsCloseProfile(hSRGBProfile);
            return NULL;
        }

        // Build K-Only stage: sRGB → CMYK (K-Only GCR)
        cmsHPROFILE kOnlyProfiles[2] = { hSRGBProfile, hProfiles[1] };
        cmsUInt32Number intents[2] = { INTENT_PRESERVE_K_ONLY_RELATIVE_COLORIMETRIC_GCR, INTENT_PRESERVE_K_ONLY_RELATIVE_COLORIMETRIC_GCR };
        cmsBool blackpointCompensation[2] = { TRUE, TRUE };
        cmsFloat64Number adaptationStates[2] = { 1.0, 1.0 };

        kOnlyPipeline = BlackPreservingKOnlyGCRIntents(
            ContextID,
            2,
            intents,
            kOnlyProfiles,
            blackpointCompensation,
            adaptationStates,
            dwFlags
        );

        cmsDeleteTransform(frontStageTransform);

        if (kOnlyPipeline == NULL) {
            cmsCloseProfile(hSRGBProfile);
            return NULL;
        }

        // Sample front-stage + K-Only into combined CLUT
        // Build cargo for front-stage sampling
        cmsUInt32Number inputChannels = T_CHANNELS(InputFormat);
        cmsUInt32Number nGridPoints = _cmsReasonableGridpointsByColorspace(cmsGetColorSpace(hProfiles[0]), dwFlags);

        // Allocate combined CLUT stage
        frontStageClut = cmsStageAllocCLut16bit(
            ContextID,
            nGridPoints,
            inputChannels,
            4,  // CMYK output
            NULL
        );

        if (frontStageClut == NULL) {
            cmsPipelineFree(kOnlyPipeline);
            cmsCloseProfile(hSRGBProfile);
            return NULL;
        }

        // Create front-stage transform for sampling
        frontStageTransform = cmsCreateTransformTHR(
            ContextID,
            hProfiles[0], GetProfile16BitFormat(hProfiles[0]),
            hSRGBProfile, TYPE_RGB_16,
            INTENT_RELATIVE_COLORIMETRIC,
            dwFlags | cmsFLAGS_BLACKPOINTCOMPENSATION | cmsFLAGS_NOOPTIMIZE
        );

        // Create K-Only transform for sampling
        cmsHTRANSFORM kOnlyTransform = cmsCreateTransformTHR(
            ContextID,
            hSRGBProfile, TYPE_RGB_16,
            hProfiles[1], TYPE_CMYK_16,
            INTENT_PRESERVE_K_ONLY_RELATIVE_COLORIMETRIC_GCR,
            intermediateFlags
        );

        if (frontStageTransform == NULL || kOnlyTransform == NULL) {
            if (frontStageTransform) cmsDeleteTransform(frontStageTransform);
            if (kOnlyTransform) cmsDeleteTransform(kOnlyTransform);
            cmsStageFree(frontStageClut);
            cmsPipelineFree(kOnlyPipeline);
            cmsCloseProfile(hSRGBProfile);
            return NULL;
        }

        // Build cargo for combined sampler
        CompositeLUTSamplerCargo cargo = {0};
        cmsHTRANSFORM transforms[2] = { frontStageTransform, kOnlyTransform };
        cmsUInt32Number outputChannelsArray[2] = { 3, 4 };  // RGB, CMYK
        cmsUInt16Number* buffer = (cmsUInt16Number*)_cmsMalloc(ContextID, sizeof(cmsUInt16Number) * 3);

        if (buffer == NULL) {
            cmsDeleteTransform(frontStageTransform);
            cmsDeleteTransform(kOnlyTransform);
            cmsStageFree(frontStageClut);
            cmsPipelineFree(kOnlyPipeline);
            cmsCloseProfile(hSRGBProfile);
            return NULL;
        }

        cargo.transforms = transforms;
        cargo.nTransforms = 2;
        cargo.outputChannels = outputChannelsArray;
        cargo.buffers = &buffer;
        cargo.outputColorSpace = cmsSigCmykData;

        // Sample the combined pipeline
        cmsBool sampleSuccess = cmsStageSampleCLut16bit(
            frontStageClut,
            CompositeLUTSampler,
            &cargo,
            0
        );

        // Cleanup sampling resources
        _cmsFree(ContextID, buffer);
        cmsDeleteTransform(frontStageTransform);
        cmsDeleteTransform(kOnlyTransform);
        cmsPipelineFree(kOnlyPipeline);
        cmsCloseProfile(hSRGBProfile);

        if (!sampleSuccess) {
            cmsStageFree(frontStageClut);
            return NULL;
        }

        // Build final pipeline
        combinedPipeline = cmsPipelineAlloc(ContextID, inputChannels, 4);
        if (combinedPipeline == NULL) {
            cmsStageFree(frontStageClut);
            return NULL;
        }

        cmsPipelineInsertStage(combinedPipeline, cmsAT_END, frontStageClut);

        // Create transform from pipeline
        cmsUInt32Number inputFormatCopy = InputFormat;
        cmsUInt32Number outputFormatCopy = OutputFormat;
        cmsUInt32Number dwFlagsCopy = dwFlags;

        transform = AllocEmptyTransform(
            ContextID,
            combinedPipeline,
            INTENT_PRESERVE_K_ONLY_RELATIVE_COLORIMETRIC_GCR,
            &inputFormatCopy,
            &outputFormatCopy,
            &dwFlagsCopy
        );

        if (transform == NULL) {
            cmsPipelineFree(combinedPipeline);
            return NULL;
        }

        // Initialize cache
        if (!(dwFlagsCopy & cmsFLAGS_NOCACHE)) {
            memset(&transform->Cache.CacheIn, 0, sizeof(transform->Cache.CacheIn));
            if (transform->Lut != NULL && transform->Lut->Eval16Fn != NULL) {
                transform->Lut->Eval16Fn(
                    transform->Cache.CacheIn,
                    transform->Cache.CacheOut,
                    transform->Lut->Data
                );
            }
        }

        return (cmsHTRANSFORM)transform;
    }

    // For 3+ profile chains
    // Strategy:
    // 1. Build front-stage pipeline for profiles [0..n-2] with RELATIVE_COLORIMETRIC + BPC
    // 2. If last profile before CMYK is not RGB, add sRGB intermediate
    // 3. Sample front-stage + K-Only into combined CLUT

    cmsUInt32Number inputChannels = T_CHANNELS(InputFormat);
    cmsUInt32Number nGridPoints = _cmsReasonableGridpointsByColorspace(cmsGetColorSpace(hProfiles[0]), dwFlags);

    // Build front-stage transforms (profiles [0..n-2])
    // Note: We use n-1 profiles for front stage (excluding the final CMYK profile)
    cmsUInt32Number frontStageProfileCount = nProfiles - 1;

    // Allocate arrays for front-stage transforms
    cmsHTRANSFORM* frontStageTransforms = NULL;
    cmsUInt32Number* frontStageOutputChannels = NULL;
    cmsUInt16Number** frontStageBuffers = NULL;
    cmsUInt32Number nFrontTransforms = 0;

    // If we need sRGB intermediate, add one more transform
    cmsBool insertSRGB = needsSRGBIntermediate;
    if (insertSRGB) {
        hSRGBProfile = cmsCreate_sRGBProfileTHR(ContextID);
        if (hSRGBProfile == NULL) {
            return NULL;
        }
    }

    // Calculate total number of transforms needed for front stage
    // Front stage: [0→1], [1→2], ..., [n-3→n-2]
    // If insertSRGB: add [n-2→sRGB]
    nFrontTransforms = frontStageProfileCount - 1;  // n-2 transforms for n-1 profiles
    if (insertSRGB) {
        nFrontTransforms += 1;  // Add one more for [n-2→sRGB]
    }

    // Allocate arrays
    frontStageTransforms = (cmsHTRANSFORM*)_cmsMalloc(ContextID, sizeof(cmsHTRANSFORM) * (nFrontTransforms + 1));
    frontStageOutputChannels = (cmsUInt32Number*)_cmsMalloc(ContextID, sizeof(cmsUInt32Number) * (nFrontTransforms + 1));
    frontStageBuffers = (cmsUInt16Number**)_cmsMalloc(ContextID, sizeof(cmsUInt16Number*) * nFrontTransforms);

    if (frontStageTransforms == NULL || frontStageOutputChannels == NULL || frontStageBuffers == NULL) {
        if (frontStageTransforms) _cmsFree(ContextID, frontStageTransforms);
        if (frontStageOutputChannels) _cmsFree(ContextID, frontStageOutputChannels);
        if (frontStageBuffers) _cmsFree(ContextID, frontStageBuffers);
        if (hSRGBProfile) cmsCloseProfile(hSRGBProfile);
        return NULL;
    }

    // Initialize to NULL for safe cleanup
    for (cmsUInt32Number i = 0; i <= nFrontTransforms; i++) {
        frontStageTransforms[i] = NULL;
    }
    for (cmsUInt32Number i = 0; i < nFrontTransforms; i++) {
        frontStageBuffers[i] = NULL;
    }

    // Create front-stage 2-profile transforms
    cmsUInt32Number transformIdx = 0;
    for (cmsUInt32Number i = 0; i < frontStageProfileCount - 1; i++) {
        cmsHPROFILE inputProfile = hProfiles[i];
        cmsHPROFILE outputProfile = hProfiles[i + 1];
        cmsUInt32Number inputFormat16 = GetProfile16BitFormat(inputProfile);
        cmsUInt32Number outputFormat16 = GetProfile16BitFormat(outputProfile);

        frontStageTransforms[transformIdx] = cmsCreateTransformTHR(
            ContextID,
            inputProfile, inputFormat16,
            outputProfile, outputFormat16,
            INTENT_RELATIVE_COLORIMETRIC,
            intermediateFlags | cmsFLAGS_BLACKPOINTCOMPENSATION
        );

        if (frontStageTransforms[transformIdx] == NULL) {
            goto cleanup_3plus;
        }

        frontStageOutputChannels[transformIdx] = GetProfileChannelCount(outputProfile);
        transformIdx++;
    }

    // Add sRGB intermediate if needed
    if (insertSRGB) {
        cmsHPROFILE lastFrontProfile = hProfiles[frontStageProfileCount - 1];
        cmsUInt32Number lastFormat = GetProfile16BitFormat(lastFrontProfile);

        frontStageTransforms[transformIdx] = cmsCreateTransformTHR(
            ContextID,
            lastFrontProfile, lastFormat,
            hSRGBProfile, TYPE_RGB_16,
            INTENT_RELATIVE_COLORIMETRIC,
            intermediateFlags | cmsFLAGS_BLACKPOINTCOMPENSATION
        );

        if (frontStageTransforms[transformIdx] == NULL) {
            goto cleanup_3plus;
        }

        frontStageOutputChannels[transformIdx] = 3;  // RGB
        transformIdx++;
    }

    // Create K-Only transform: sRGB → CMYK (or RGB → CMYK if no intermediate needed)
    {
        cmsHPROFILE kOnlyInputProfile = insertSRGB ? hSRGBProfile : hProfiles[nProfiles - 2];
        cmsHPROFILE kOnlyOutputProfile = hProfiles[nProfiles - 1];

        frontStageTransforms[transformIdx] = cmsCreateTransformTHR(
            ContextID,
            kOnlyInputProfile, TYPE_RGB_16,
            kOnlyOutputProfile, TYPE_CMYK_16,
            INTENT_PRESERVE_K_ONLY_RELATIVE_COLORIMETRIC_GCR,
            intermediateFlags
        );

        if (frontStageTransforms[transformIdx] == NULL) {
            goto cleanup_3plus;
        }

        frontStageOutputChannels[transformIdx] = 4;  // CMYK
    }

    // Allocate intermediate buffers
    for (cmsUInt32Number i = 0; i < nFrontTransforms; i++) {
        cmsUInt32Number bufferSize = frontStageOutputChannels[i];
        frontStageBuffers[i] = (cmsUInt16Number*)_cmsMalloc(ContextID, sizeof(cmsUInt16Number) * bufferSize);
        if (frontStageBuffers[i] == NULL) {
            goto cleanup_3plus;
        }
    }

    // Allocate combined CLUT stage
    frontStageClut = cmsStageAllocCLut16bit(
        ContextID,
        nGridPoints,
        inputChannels,
        4,  // CMYK output
        NULL
    );

    if (frontStageClut == NULL) {
        goto cleanup_3plus;
    }

    // Build cargo for combined sampler
    {
        CompositeLUTSamplerCargo cargo = {0};
        cargo.transforms = frontStageTransforms;
        cargo.nTransforms = nFrontTransforms + 1;  // front-stage + K-Only
        cargo.outputChannels = frontStageOutputChannels;
        cargo.buffers = frontStageBuffers;
        cargo.outputColorSpace = cmsSigCmykData;

        // Sample the combined pipeline
        cmsBool sampleSuccess = cmsStageSampleCLut16bit(
            frontStageClut,
            CompositeLUTSampler,
            &cargo,
            0
        );

        if (!sampleSuccess) {
            cmsStageFree(frontStageClut);
            goto cleanup_3plus;
        }
    }

    // Build final pipeline
    combinedPipeline = cmsPipelineAlloc(ContextID, inputChannels, 4);
    if (combinedPipeline == NULL) {
        cmsStageFree(frontStageClut);
        goto cleanup_3plus;
    }

    cmsPipelineInsertStage(combinedPipeline, cmsAT_END, frontStageClut);
    frontStageClut = NULL;  // Pipeline owns it now

    // Create transform from pipeline
    {
        cmsUInt32Number inputFormatCopy = InputFormat;
        cmsUInt32Number outputFormatCopy = OutputFormat;
        cmsUInt32Number dwFlagsCopy = dwFlags;

        transform = AllocEmptyTransform(
            ContextID,
            combinedPipeline,
            INTENT_PRESERVE_K_ONLY_RELATIVE_COLORIMETRIC_GCR,
            &inputFormatCopy,
            &outputFormatCopy,
            &dwFlagsCopy
        );

        if (transform == NULL) {
            cmsPipelineFree(combinedPipeline);
            goto cleanup_3plus;
        }

        // Initialize cache
        if (!(dwFlagsCopy & cmsFLAGS_NOCACHE)) {
            memset(&transform->Cache.CacheIn, 0, sizeof(transform->Cache.CacheIn));
            if (transform->Lut != NULL && transform->Lut->Eval16Fn != NULL) {
                transform->Lut->Eval16Fn(
                    transform->Cache.CacheIn,
                    transform->Cache.CacheOut,
                    transform->Lut->Data
                );
            }
        }
    }

    result = (cmsHTRANSFORM)transform;

cleanup_3plus:
    // Cleanup front-stage transforms
    if (frontStageTransforms != NULL) {
        for (cmsUInt32Number i = 0; i <= nFrontTransforms; i++) {
            if (frontStageTransforms[i] != NULL) {
                cmsDeleteTransform(frontStageTransforms[i]);
            }
        }
        _cmsFree(ContextID, frontStageTransforms);
    }
    if (frontStageOutputChannels != NULL) {
        _cmsFree(ContextID, frontStageOutputChannels);
    }
    if (frontStageBuffers != NULL) {
        for (cmsUInt32Number i = 0; i < nFrontTransforms; i++) {
            if (frontStageBuffers[i] != NULL) {
                _cmsFree(ContextID, frontStageBuffers[i]);
            }
        }
        _cmsFree(ContextID, frontStageBuffers);
    }
    if (hSRGBProfile != NULL) {
        cmsCloseProfile(hSRGBProfile);
    }

    return result;
}

/**
 * Creates a multiprofile transform with automatic Gray and K-Only GCR workarounds
 *
 * Unified entry point that handles ALL multiprofile transform cases:
 * - Standard intents (2-profile and 3+)
 * - Gray workaround (when Gray is in 3+ chain)
 * - K-Only GCR (when intent is K-Only GCR and output is CMYK)
 * - K-Only GCR + Gray workaround (when both conditions apply)
 *
 * Implementation strategy:
 * - For 2-profile chains: use native transform or K-Only delegate
 * - For 3+ profile chains: build composite CLUT by sampling through chained 2-profile transforms
 *
 * @param ContextID      LittleCMS context
 * @param hProfiles      Array of profile handles
 * @param nProfiles      Number of profiles (2-255)
 * @param InputFormat    Input color format
 * @param OutputFormat   Output color format
 * @param Intent         Rendering intent
 * @param dwFlags        Transform flags
 * @return Transform handle or NULL on error
 */
cmsHTRANSFORM CreateMultiprofileTransform(
    cmsContext ContextID,
    const cmsHPROFILE hProfiles[],
    cmsUInt32Number nProfiles,
    cmsUInt32Number InputFormat,
    cmsUInt32Number OutputFormat,
    cmsUInt32Number Intent,
    cmsUInt32Number dwFlags
) {
    cmsPipeline* pipeline = NULL;
    _cmsTRANSFORM* transform = NULL;
    cmsUInt32Number inputFormatCopy = InputFormat;
    cmsUInt32Number outputFormatCopy = OutputFormat;
    cmsUInt32Number dwFlagsCopy = dwFlags;

    // Validate parameters
    if (hProfiles == NULL || nProfiles < 2) {
        cmsSignalError(ContextID, cmsERROR_RANGE, "CreateMultiprofileTransform: Invalid parameters");
        return NULL;
    }

    // Check for K-Only GCR intent
    // Route to specialized K-Only handler when:
    // 1. Intent is INTENT_PRESERVE_K_ONLY_RELATIVE_COLORIMETRIC_GCR (20)
    // 2. Output profile is CMYK
    if (Intent == INTENT_PRESERVE_K_ONLY_RELATIVE_COLORIMETRIC_GCR) {
        cmsColorSpaceSignature outputColorSpace = cmsGetColorSpace(hProfiles[nProfiles - 1]);
        if (outputColorSpace == cmsSigCmykData) {
            return CreateKOnlyGCRMultiprofileTransform(
                ContextID,
                hProfiles,
                nProfiles,
                InputFormat,
                OutputFormat,
                dwFlags
            );
        }
        // K-Only GCR requested but output is not CMYK - fall through to standard path
        // This will likely fail or produce unexpected results
    }

    // For 2-profile chains without BPC scaling flag, use native transform (always works)
    // When BPC scaling flag is set, use composite LUT path for explicit BPC
    if (nProfiles == 2 && !(dwFlags & cmsFLAGS_MULTIPROFILE_BLACKPOINT_SCALING)) {
        return cmsCreateTransformTHR(ContextID,
            hProfiles[0], InputFormat,
            hProfiles[1], OutputFormat,
            Intent, dwFlags);
    }

    // For 3+ profile chains, OR 2-profile with float flag,
    // build composite CLUT via chained 2-profile transforms
    pipeline = CreateCompositeLUTTransform(
        ContextID,
        hProfiles,
        nProfiles,
        InputFormat,
        OutputFormat,
        Intent,
        dwFlags
    );

    if (pipeline == NULL) {
        // CreateCompositeLUTTransform already signaled error
        return NULL;
    }

    // Create transform from the populated pipeline
    // AllocEmptyTransform is exported via patch 02-export-alloc-empty-transform.patch
    transform = AllocEmptyTransform(
        ContextID,
        pipeline,
        Intent,
        &inputFormatCopy,
        &outputFormatCopy,
        &dwFlagsCopy
    );

    if (transform == NULL) {
        cmsSignalError(ContextID, cmsERROR_UNDEFINED,
            "CreateMultiprofileTransform: AllocEmptyTransform failed");
        cmsPipelineFree(pipeline);
        return NULL;
    }

    // CRITICAL: Initialize the transform cache
    // AllocEmptyTransform does NOT initialize the cache (unlike cmsCreateTransformTHR).
    // Without this, CachedXFORM returns zeros for input=0 because it matches the
    // uninitialized zero cache instead of evaluating the pipeline.
    //
    // This mimics what cmsCreateMultiprofileTransformTHR does in cmsxform.c lines 1262-1275.
    if (!(dwFlagsCopy & cmsFLAGS_NOCACHE)) {
        // Set the initial zero cache
        memset(&transform->Cache.CacheIn, 0, sizeof(transform->Cache.CacheIn));

        // Pre-evaluate the pipeline for input=0 and store in cache
        // This ensures the first call with input=0 returns correct values
        if (transform->Lut != NULL && transform->Lut->Eval16Fn != NULL) {
            transform->Lut->Eval16Fn(
                transform->Cache.CacheIn,
                transform->Cache.CacheOut,
                transform->Lut->Data
            );
        }
    }

    // Note: AllocEmptyTransform takes ownership of the pipeline
    // Return the transform handle
    return (cmsHTRANSFORM)transform;
}

