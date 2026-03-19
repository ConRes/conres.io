/**
 * @file lab-mask-sentinel.h
 * @brief Lab Mask Sentinel Passthrough and Correction for Color Transforms
 *
 * Detects and corrects Lab 0/-128/-128 (the Lab Mask Sentinel) during color
 * transformation. In unsigned integer Lab encoding, this value encodes to
 * all-zero bytes and is inadvertently gamut-clipped by LittleCMS, producing
 * output approximately 181 deltaE76 from neutral black.
 *
 * The Lab Mask Sentinel value is physically meaningless (zero luminance makes
 * chrominance invisible). This module corrects it transparently during
 * doTransform.
 *
 * Per-transform state is stored in the plugin's ColorEngineTransformData
 * (allocated per-transform by the factory, freed by cmsDeleteTransform).
 *
 * @author Saleh Abdel Motaal <dev@smotaal.io>
 * @ai Claude Opus 4.6 (code generation)
 * @date 2026-02-09
 * @license GPL-3.0-or-later
 *
 * Two modes based on outer transform formats:
 *
 * Lab→Lab (both input and output are Lab):
 *   1. PRE:       SIMD scan input for sentinel (NULL) pixels, build flag array
 *   2. TRANSFORM: cmsDoTransform (agnostic)
 *   3. POST:      Write sentinel (NULL) back at flagged positions in output
 *
 * Lab→non-Lab (only input is Lab):
 *   1. PRE:       Find sentinel (NULL) pixels, rewrite them to Lab 0/0/0 in input
 *   2. TRANSFORM: cmsDoTransform (now sees neutral black, not garbage sentinel)
 *   3. (nothing)
 */

#ifndef LAB_MASK_SENTINEL_H
#define LAB_MASK_SENTINEL_H

#include "lcms2.h"
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/**
 * Perform color transform with Lab Mask Sentinel handling.
 *
 * Wraps cmsDoTransform with transparent sentinel detection and handling:
 *
 * - Lab Mask Sentinel Passthrough (Lab→Lab): sentinel pixels are flagged
 *   before transform, then written back at flagged output positions after
 *   transform. Preserves sentinel through round-trip.
 *
 * - Lab Mask Sentinel Correction (Lab→non-Lab): sentinel pixels are rewritten
 *   to neutral black (Lab 0/0/0) in the input buffer before transform.
 *   cmsDoTransform sees neutral black, not garbage sentinel.
 *
 * - Lab Mask Sentinel Clipping (non-Lab input): calls cmsDoTransform directly
 *   with zero overhead beyond the initial per-transform format check.
 *
 * Per-transform state is read from the plugin's ColorEngineTransformData
 * (allocated by the factory, freed by cmsDeleteTransform).
 *
 * @param transform    Transform handle (created via cmsCreateTransform or similar)
 * @param inputBuffer  Input pixel data
 * @param outputBuffer Output pixel data
 * @param pixelCount   Number of pixels to transform
 */
void LabMaskSentinel_DoTransform(
    cmsHTRANSFORM transform,
    const void* inputBuffer,
    void* outputBuffer,
    cmsUInt32Number pixelCount
);

/**
 * Clear cached Lab Mask Sentinel state for a specific transform.
 * No-op: state is now managed by the plugin's UserData lifecycle.
 *
 * @param transform Transform handle
 */
void LabMaskSentinel_Clear(cmsHTRANSFORM transform);

/**
 * Clear all cached Lab Mask Sentinel states.
 * No-op: state is now managed by the plugin's UserData lifecycle.
 */
void LabMaskSentinel_ClearAll(void);

#ifdef __cplusplus
}
#endif

#endif /* LAB_MASK_SENTINEL_H */
