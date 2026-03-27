/**
 * @file blackpoint-compensation-clamping.h
 * @brief Blackpoint Compensation Boundary Clamping Optimization for Color Transforms
 *
 * SIMD-optimized detection and handling of data-range boundary pixels
 * (minimum/maximum encodable values) during color transformation. When
 * blackpoint compensation clamping is enabled, boundary pixels have
 * deterministic outputs that can be cached and reused.
 *
 * Supports 8-bit, 16-bit, and Float32 input/output formats.
 *
 * @author Saleh Abdel Motaal <dev@smotaal.io>
 * @ai Claude Sonnet 4.5 (initial code generation), Claude Opus 4 (modifications), Claude Opus 4.6 (bit-depth generalization)
 * @date 2025-12-19
 * @license GPL-3.0-or-later
 */

#ifndef BLACKPOINT_COMPENSATION_CLAMPING_H
#define BLACKPOINT_COMPENSATION_CLAMPING_H

#include "lcms2.h"
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/**
 * Maximum number of cached transforms
 */
#define BLACKPOINT_COMPENSATION_CLAMPING_MAX_CACHE 32

/**
 * Minimum pixel count for adaptive optimization (2 megapixels)
 */
#define BLACKPOINT_COMPENSATION_CLAMPING_MIN_PIXELS 2000000

/**
 * Sample size for boundary detection (256 pixels)
 */
#define BLACKPOINT_COMPENSATION_CLAMPING_SAMPLE_SIZE 256

/**
 * Cached boundary values for a transform.
 *
 * Stores format-aware metadata and pre-computed transform outputs for
 * data-range boundary inputs (all-minimum and all-maximum encodable values).
 * These are DATA-RANGE boundaries, not COLOR boundaries — for CMYK,
 * all-zero means no ink (white paper), not the black point.
 */
typedef struct {
    cmsHTRANSFORM transform;                /**< Transform handle (cache key) */
    cmsUInt32Number inputChannels;           /**< Number of input color channels */
    cmsUInt32Number outputChannels;          /**< Number of output color channels */
    cmsUInt32Number inputBytesPerSample;     /**< 1 (8-bit), 2 (16-bit), 4 (Float32) */
    cmsUInt32Number outputBytesPerSample;    /**< 1 (8-bit), 2 (16-bit), 4 (Float32) */
    cmsUInt32Number inputBytesPerPixel;      /**< inputChannels * inputBytesPerSample */
    cmsUInt32Number outputBytesPerPixel;     /**< outputChannels * outputBytesPerSample */
    cmsBool isFloatInput;                    /**< TRUE if input format is floating-point */
    cmsBool isFloatOutput;                   /**< TRUE if output format is floating-point */
    cmsUInt8Number minimumInput[32];         /**< Pre-computed minimum boundary reference (all-zero) */
    cmsUInt8Number maximumInput[32];         /**< Pre-computed maximum boundary reference (all-max) */
    cmsUInt8Number minimumOutput[32];        /**< Pre-computed transform output for minimum input */
    cmsUInt8Number maximumOutput[32];        /**< Pre-computed transform output for maximum input */
    cmsBool isValid;                         /**< TRUE if this cache entry is initialized */
} BlackpointCompensationClampingCache;

/**
 * Statistics returned from optimized transform
 */
typedef struct {
    cmsUInt32Number transformedCount;  /**< Pixels that went through full transform */
    cmsUInt32Number minimumCount;      /**< Data-range minimum pixels (skipped) */
    cmsUInt32Number maximumCount;      /**< Data-range maximum pixels (skipped) */
    cmsBool optimizationSkipped;       /**< TRUE if fallback to regular transform */
} BlackpointCompensationClampingStats;

/**
 * Initialize blackpoint compensation clamping cache for a transform.
 * Pre-computes output values for data-range minimum and maximum input.
 *
 * @param transform Transform handle
 * @param inputChannels Number of input channels (1, 3, or 4)
 * @param outputChannels Number of output channels (typically 4 for CMYK)
 * @return Cache index on success, -1 on error
 */
int BlackpointCompensationClamping_Init(
    cmsHTRANSFORM transform,
    cmsUInt32Number inputChannels,
    cmsUInt32Number outputChannels
);

/**
 * Clear blackpoint compensation clamping cache for a transform
 *
 * @param transform Transform handle
 */
void BlackpointCompensationClamping_Clear(cmsHTRANSFORM transform);

/**
 * Clear all blackpoint compensation clamping caches
 */
void BlackpointCompensationClamping_ClearAll(void);

/**
 * Perform transform with blackpoint compensation boundary clamping optimization.
 * SIMD-optimized detection of data-range boundary pixels (minimum/maximum).
 * Supports 8-bit, 16-bit, and Float32 input/output formats.
 *
 * @param transform Transform handle
 * @param inputBuffer Input pixel data (any format)
 * @param outputBuffer Output pixel data (any format)
 * @param pixelCount Number of pixels to transform
 * @param stats Output statistics (can be NULL)
 */
void BlackpointCompensationClamping_DoTransform(
    cmsHTRANSFORM transform,
    const void* inputBuffer,
    void* outputBuffer,
    cmsUInt32Number pixelCount,
    BlackpointCompensationClampingStats* stats
);

/**
 * Get pre-computed minimum boundary output values
 *
 * @param transform Transform handle
 * @param output Buffer to receive minimum output values (must be >= outputBytesPerPixel)
 * @return Output bytes per pixel, or 0 if not cached
 */
cmsUInt32Number BlackpointCompensationClamping_GetMinimumOutput(
    cmsHTRANSFORM transform,
    void* output
);

/**
 * Get pre-computed maximum boundary output values
 *
 * @param transform Transform handle
 * @param output Buffer to receive maximum output values (must be >= outputBytesPerPixel)
 * @return Output bytes per pixel, or 0 if not cached
 */
cmsUInt32Number BlackpointCompensationClamping_GetMaximumOutput(
    cmsHTRANSFORM transform,
    void* output
);

/**
 * Register a transform for blackpoint compensation clamping.
 * Derives format metadata from the transform and initializes the cache.
 * Called at createTransform time when the clamping flag is set.
 *
 * @param transform Transform handle
 * @return Cache index on success, -1 on error
 */
int BlackpointCompensationClamping_RegisterTransform(cmsHTRANSFORM transform);

/**
 * Adaptive transform with automatic boundary detection.
 *
 * Samples the first BLACKPOINT_COMPENSATION_CLAMPING_SAMPLE_SIZE pixels to detect if image
 * is 100% boundary (data-range minimum/maximum). Only applies optimization
 * for images >= BLACKPOINT_COMPENSATION_CLAMPING_MIN_PIXELS (2MP) that are detected as pure masks.
 * Supports 8-bit, 16-bit, and Float32 input/output formats.
 *
 * @param transform Transform handle
 * @param inputBuffer Input pixel data (any format)
 * @param outputBuffer Output pixel data (any format)
 * @param pixelCount Number of pixels to transform
 * @param stats Output statistics (can be NULL)
 */
void BlackpointCompensationClamping_DoTransformAdaptive(
    cmsHTRANSFORM transform,
    const void* inputBuffer,
    void* outputBuffer,
    cmsUInt32Number pixelCount,
    BlackpointCompensationClampingStats* stats
);

#ifdef __cplusplus
}
#endif

#endif // BLACKPOINT_COMPENSATION_CLAMPING_H
