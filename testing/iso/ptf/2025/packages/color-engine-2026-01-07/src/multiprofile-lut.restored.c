/**
 * @file multiprofile-lut.c
 * @brief Gray Color Space Workaround for Multiprofile Transforms - Implementation
 *
 * Implements composite LUT-based workaround for LittleCMS Gray limitation.
 *
 * @author Saleh Abdel Motaal
 * @date 2026-01-05
 * @license GPL-3.0-or-later
 */

#include "multiprofile-lut.h"
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

    return TRUE;  // Continue sampling
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
 * Finds all Gray profile positions in the chain
 *
 * @param hProfiles      Array of profile handles
 * @param nProfiles      Number of profiles
 * @param grayPositions  Output array to store Gray positions (caller must allocate nProfiles size)
 * @param nGrayFound     Output: number of Gray profiles found
 * @return TRUE on success, FALSE on error
 */
static cmsBool FindGrayPositions(
    const cmsHPROFILE hProfiles[],
    cmsUInt32Number nProfiles,
    cmsUInt32Number grayPositions[],
    cmsUInt32Number* nGrayFound
) {
    cmsUInt32Number i;
    cmsUInt32Number count = 0;

    if (hProfiles == NULL || grayPositions == NULL || nGrayFound == NULL) {
        return FALSE;
    }

    for (i = 0; i < nProfiles; i++) {
        cmsColorSpaceSignature colorSpace = cmsGetColorSpace(hProfiles[i]);
        if (colorSpace == cmsSigGrayData) {
            grayPositions[count++] = i;
        }
    }

    *nGrayFound = count;
    return TRUE;
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
 * Builds transform segments for arbitrary multiprofile chains with Gray
 *
 * Strategy:
 * - For each Gray profile, create segments that avoid Gray in 3+ profile chains
 * - Use 2-profile transforms for Gray segments (works in LittleCMS)
 * - Use multiprofile transforms for non-Gray segments
 * - Optimization: Replace Gray → Lab16 → NextProfile with Gray → NextProfile directly
 *
 * @param ContextID      LittleCMS context
 * @param hProfiles      Array of profile handles
 * @param nProfiles      Number of profiles
 * @param Intent         Rendering intent
 * @param dwFlags        Transform flags
 * @param cargo          Output: populated cargo structure (caller must free)
 * @return TRUE on success, FALSE on error
 */
static cmsBool BuildTransformSegments(
    cmsContext ContextID,
    const cmsHPROFILE hProfiles[],
    cmsUInt32Number nProfiles,
    cmsUInt32Number Intent,
    cmsUInt32Number dwFlags,
    CompositeLUTSamplerCargo* cargo
) {
    cmsUInt32Number* grayPositions = NULL;
    cmsUInt32Number nGrayFound = 0;
    cmsUInt32Number lastProcessed = 0;
    cmsUInt32Number maxSegments;
    cmsHTRANSFORM* transforms = NULL;
    cmsUInt32Number* outputChannels = NULL;
    cmsUInt16Number** buffers = NULL;
    cmsUInt32Number nSegments = 0;
    cmsHPROFILE hLab = NULL;
    cmsUInt32Number i, grayIdx;
    cmsBool success = FALSE;

    // Allocate array for Gray positions (worst case: all profiles are Gray)
    grayPositions = (cmsUInt32Number*)_cmsMalloc(ContextID, sizeof(cmsUInt32Number) * nProfiles);
    if (grayPositions == NULL) goto cleanup;

    // Find all Gray profile positions
    if (!FindGrayPositions(hProfiles, nProfiles, grayPositions, &nGrayFound)) {
        goto cleanup;
    }

    if (nGrayFound == 0) {
        // No Gray profiles - should not happen (caller should check)
        cmsSignalError(ContextID, cmsERROR_RANGE, "BuildTransformSegments: No Gray profiles found");
        goto cleanup;
    }

    // Estimate maximum segments needed:
    // - Before each Gray: 1 segment
    // - Each Gray: 1 segment (Gray → Lab16 or Gray → NextProfile)
    // - After last Gray: 1 segment
    // Conservative estimate: 2 * nGrayFound + 2
    maxSegments = 2 * nGrayFound + 2;

    // Allocate arrays for segments
    transforms = (cmsHTRANSFORM*)_cmsMalloc(ContextID, sizeof(cmsHTRANSFORM) * maxSegments);
    outputChannels = (cmsUInt32Number*)_cmsMalloc(ContextID, sizeof(cmsUInt32Number) * maxSegments);
    buffers = (cmsUInt16Number**)_cmsMalloc(ContextID, sizeof(cmsUInt16Number*) * maxSegments);

    if (transforms == NULL || outputChannels == NULL || buffers == NULL) {
        goto cleanup;
    }

    // Initialize buffer pointers to NULL (will allocate later)
    for (i = 0; i < maxSegments; i++) {
        transforms[i] = NULL;
        buffers[i] = NULL;
    }

    // Create Lab profile for Gray → Lab16 segments
    hLab = cmsCreateLab4ProfileTHR(ContextID, NULL);
    if (hLab == NULL) goto cleanup;

    // Build segments by processing each Gray position
    for (grayIdx = 0; grayIdx < nGrayFound; grayIdx++) {
        cmsUInt32Number currentGray = grayPositions[grayIdx];
        cmsHTRANSFORM hSegment;
        cmsUInt32Number segmentOutputChannels;

        // Segment 1: Profiles BEFORE this Gray (if any)
        if (currentGray > lastProcessed) {
            cmsUInt32Number inputFormat = GetProfile16BitFormat(hProfiles[lastProcessed]);
            cmsUInt32Number outputFormat = TYPE_GRAY_16;

            if (currentGray - lastProcessed == 1) {
                // Only one profile before Gray - use 2-profile transform
                hSegment = cmsCreateTransformTHR(
                    ContextID,
                    hProfiles[lastProcessed], inputFormat,
                    hProfiles[currentGray], outputFormat,
                    Intent, dwFlags
                );
            } else {
                // Multiple profiles before Gray - use multiprofile transform
                hSegment = cmsCreateMultiprofileTransformTHR(
                    ContextID,
                    &hProfiles[lastProcessed],
                    currentGray - lastProcessed,
                    inputFormat,
                    outputFormat,
                    Intent, dwFlags
                );
            }

            if (hSegment == NULL) {
                cmsSignalError(ContextID, cmsERROR_UNDEFINED, "BuildTransformSegments: Failed to create pre-Gray segment");
                goto cleanup;
            }

            transforms[nSegments] = hSegment;
            outputChannels[nSegments] = 1;  // Gray output
            nSegments++;
        }

        // Segment 2: The Gray profile itself
        // Optimization: If next profile exists, try Gray → NextProfile directly
        // Otherwise, use Gray → Lab16
        if (currentGray < nProfiles - 1) {
            // Try direct Gray → NextProfile
            cmsUInt32Number nextFormat = GetProfile16BitFormat(hProfiles[currentGray + 1]);

            hSegment = cmsCreateTransformTHR(
                ContextID,
                hProfiles[currentGray], TYPE_GRAY_16,
                hProfiles[currentGray + 1], nextFormat,
                Intent, dwFlags
            );

            if (hSegment != NULL) {
                // Optimization succeeded - skip next profile
                segmentOutputChannels = GetProfileChannelCount(hProfiles[currentGray + 1]);
                lastProcessed = currentGray + 2;
            } else {
                // Optimization failed - use Gray → Lab16
                hSegment = CreateGrayToLab16Transform(ContextID, hProfiles[currentGray], Intent, dwFlags);
                segmentOutputChannels = 3;  // Lab output
                lastProcessed = currentGray + 1;
            }
        } else {
            // Last profile is Gray - use Gray → Lab16
            hSegment = CreateGrayToLab16Transform(ContextID, hProfiles[currentGray], Intent, dwFlags);
            segmentOutputChannels = 3;  // Lab output
            lastProcessed = currentGray + 1;
        }

        if (hSegment == NULL) {
            cmsSignalError(ContextID, cmsERROR_UNDEFINED, "BuildTransformSegments: Failed to create Gray segment");
            goto cleanup;
        }

        transforms[nSegments] = hSegment;
        outputChannels[nSegments] = segmentOutputChannels;
        nSegments++;
    }

    // Segment 3: Remaining profiles after last Gray (if any)
    if (lastProcessed < nProfiles) {
        cmsHPROFILE* remainingProfiles;
        cmsUInt32Number nRemaining = nProfiles - lastProcessed;
        cmsHTRANSFORM hSegment;
        cmsUInt32Number inputFormat, outputFormat;

        // Output format is always the final profile's format
        outputFormat = GetProfile16BitFormat(hProfiles[nProfiles - 1]);

        // If previous segment ended with Lab16, insert Lab as first profile
        cmsBool needsLabPrefix = (nSegments > 0 && outputChannels[nSegments - 1] == 3);

        if (needsLabPrefix) {
            // Allocate array with Lab + remaining profiles
            remainingProfiles = (cmsHPROFILE*)_cmsMalloc(ContextID, sizeof(cmsHPROFILE) * (nRemaining + 1));
            if (remainingProfiles == NULL) goto cleanup;

            remainingProfiles[0] = hLab;
            for (i = 0; i < nRemaining; i++) {
                remainingProfiles[i + 1] = hProfiles[lastProcessed + i];
            }

            hSegment = cmsCreateMultiprofileTransformTHR(
                ContextID,
                remainingProfiles,
                nRemaining + 1,
                TYPE_Lab_16,
                outputFormat,
                Intent, dwFlags
            );

            _cmsFree(ContextID, remainingProfiles);
        } else {
            // No Lab prefix needed - input format is the first remaining profile
            inputFormat = GetProfile16BitFormat(hProfiles[lastProcessed]);

            hSegment = cmsCreateMultiprofileTransformTHR(
                ContextID,
                &hProfiles[lastProcessed],
                nRemaining,
                inputFormat,
                outputFormat,
                Intent, dwFlags
            );
        }

        if (hSegment == NULL) {
            cmsSignalError(ContextID, cmsERROR_UNDEFINED, "BuildTransformSegments: Failed to create post-Gray segment");
            goto cleanup;
        }

        transforms[nSegments] = hSegment;
        outputChannels[nSegments] = GetProfileChannelCount(hProfiles[nProfiles - 1]);
        nSegments++;
    }

    // Allocate intermediate buffers (nSegments - 1 buffers needed)
    for (i = 0; i < nSegments - 1; i++) {
        cmsUInt32Number bufferSize = outputChannels[i];
        buffers[i] = (cmsUInt16Number*)_cmsMalloc(ContextID, sizeof(cmsUInt16Number) * bufferSize);
        if (buffers[i] == NULL) {
            goto cleanup;
        }
    }

    // Populate cargo structure
    cargo->transforms = transforms;
    cargo->nTransforms = nSegments;
    cargo->outputChannels = outputChannels;
    cargo->buffers = buffers;

    success = TRUE;

cleanup:
    if (!success) {
        // Clean up on failure
        if (transforms != NULL) {
            for (i = 0; i < maxSegments; i++) {
                if (transforms[i] != NULL) cmsDeleteTransform(transforms[i]);
            }
            _cmsFree(ContextID, transforms);
        }
        if (outputChannels != NULL) _cmsFree(ContextID, outputChannels);
        if (buffers != NULL) {
            for (i = 0; i < maxSegments; i++) {
                if (buffers[i] != NULL) _cmsFree(ContextID, buffers[i]);
            }
            _cmsFree(ContextID, buffers);
        }
    }

    if (hLab != NULL) cmsCloseProfile(hLab);
    if (grayPositions != NULL) _cmsFree(ContextID, grayPositions);

    return success;
}

/**
 * Creates a composite LUT-based pipeline for Gray multiprofile chains
 *
 * Implementation strategy:
 * 1. Build transform segments using BuildTransformSegments()
 * 2. Determine grid size from input format
 * 3. Allocate empty CLUT stage
 * 4. Sample full pipeline using CompositeLUTSampler callback
 * 5. Build final pipeline with populated CLUT
 * 6. Return pipeline (caller creates transform if needed)
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
    cmsUInt32Number nGridPoints;
    cmsUInt32Number inputChannels, outputChannels;
    cmsColorSpaceSignature inputColorSpace;
    cmsUInt32Number i;
    cmsBool success = FALSE;

    // Validate parameters
    if (hProfiles == NULL || nProfiles < 3) {
        cmsSignalError(ContextID, cmsERROR_RANGE, "CreateCompositeLUTTransform: Invalid parameters");
        return NULL;
    }

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

    // Step 1: Build transform segments using general multi-segment algorithm
    // This handles Gray at ANY position(s) in the chain
    if (!BuildTransformSegments(ContextID, hProfiles, nProfiles, Intent, dwFlags, &cargo)) {
        cmsSignalError(ContextID, cmsERROR_UNDEFINED, "CreateCompositeLUTTransform: Failed to build transform segments");
        goto cleanup;
    }

    // Step 2: Allocate empty CLUT stage
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

    // Step 3: Sample the CLUT using multi-segment cargo
    // The sampler chains all N transforms sequentially
    success = cmsStageSampleCLut16bit(
        clutStage,
        CompositeLUTSampler,
        &cargo,
        0  // dwFlags = 0 (populate mode, not SAMPLER_INSPECT)
    );

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
    // Note: Pipeline contains populated CLUT stage
    // Caller will create transform from this pipeline if needed
    success = TRUE;

cleanup:
    // Clean up cargo (intermediate transforms and buffers)
    // These are always freed - they were only used for sampling
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
 * Wrapper function for multiprofile transforms with Gray workaround
 *
 * This function replaces cmsCreateMultiprofileTransform when Gray is detected in 3+ profiles.
 * It creates a complete transform (not just a pipeline) by using AllocEmptyTransform.
 *
 * @param ContextID      LittleCMS context
 * @param hProfiles      Array of profile handles
 * @param nProfiles      Number of profiles
 * @param InputFormat    Input color format
 * @param OutputFormat   Output color format
 * @param Intent         Rendering intent
 * @param dwFlags        Transform flags
 * @return Transform handle or NULL on error
 */
cmsHTRANSFORM CreateMultiprofileTransformWithGrayWorkaround(
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
    cmsUInt32Number inputFormat16, outputFormat16;
    cmsUInt32Number inputChannels, outputChannels;

    // Validate parameters
    if (hProfiles == NULL || nProfiles < 3) {
        cmsSignalError(ContextID, cmsERROR_RANGE, "CreateMultiprofileTransformWithGrayWorkaround: Invalid parameters");
        return NULL;
    }

    // Check if Gray workaround is needed
    if (!ContainsGrayProfile(hProfiles, nProfiles)) {
        // No Gray - use native multiprofile transform
        return cmsCreateMultiprofileTransformTHR(ContextID, hProfiles, nProfiles, InputFormat, OutputFormat, Intent, dwFlags);
    }

    // Create composite LUT pipeline
    pipeline = CreateCompositeLUTTransform(ContextID, hProfiles, nProfiles, InputFormat, OutputFormat, Intent, dwFlags);
    if (pipeline == NULL) {
        cmsSignalError(ContextID, cmsERROR_UNDEFINED, "CreateMultiprofileTransformWithGrayWorkaround: Failed to create composite LUT");
        return NULL;
    }

    // Convert user formats to 16-bit internal formats for AllocEmptyTransform
    inputChannels = T_CHANNELS(InputFormat);
    outputChannels = T_CHANNELS(OutputFormat);

    inputFormat16 = COLORSPACE_SH(T_COLORSPACE(InputFormat)) |
                    CHANNELS_SH(inputChannels) |
                    BYTES_SH(2);  // 16-bit

    outputFormat16 = COLORSPACE_SH(T_COLORSPACE(OutputFormat)) |
                     CHANNELS_SH(outputChannels) |
                     BYTES_SH(2);  // 16-bit

    // Create transform from pipeline using LittleCMS internal function
    transform = AllocEmptyTransform(ContextID, pipeline, Intent, &inputFormat16, &outputFormat16, &dwFlags);
    if (transform == NULL) {
        cmsSignalError(ContextID, cmsERROR_UNDEFINED, "CreateMultiprofileTransformWithGrayWorkaround: Failed to create transform from pipeline");
        cmsPipelineFree(pipeline);
        return NULL;
    }

    // Set color space information
    transform->EntryColorSpace = cmsGetColorSpace(hProfiles[0]);
    transform->ExitColorSpace = cmsGetColorSpace(hProfiles[nProfiles - 1]);
    transform->RenderingIntent = Intent;

    return (cmsHTRANSFORM)transform;
}
