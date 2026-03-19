/**
 * @file bpc-clamp.h
 * @brief BPC Boundary Clamping Optimization for Color Transforms
 *
 * SIMD-optimized detection and handling of boundary pixels (pure black/white)
 * during color transformation. When BPC is enabled, boundary pixels have
 * deterministic outputs that can be cached and reused.
 *
 * @author Claude Code
 * @date 2025-12-19
 */

#ifndef BPC_CLAMP_H
#define BPC_CLAMP_H

#include "lcms2.h"
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/**
 * Maximum number of cached transforms
 */
#define BPC_CLAMP_MAX_CACHE 32

/**
 * Minimum pixel count for adaptive optimization (2 megapixels)
 */
#define BPC_CLAMP_MIN_PIXELS 2000000

/**
 * Sample size for boundary detection (256 pixels)
 */
#define BPC_CLAMP_SAMPLE_SIZE 256

/**
 * Cached boundary values for a transform
 */
typedef struct {
    cmsHTRANSFORM transform;     // Transform handle (key)
    cmsUInt32Number inputChannels;
    cmsUInt32Number outputChannels;
    cmsUInt8Number blackOutput[8];  // Pre-computed black output (max 8 channels)
    cmsUInt8Number whiteOutput[8];  // Pre-computed white output (max 8 channels)
    cmsBool isValid;
} BPCClampCache;

/**
 * Statistics returned from optimized transform
 */
typedef struct {
    cmsUInt32Number transformedCount;  // Pixels that went through full transform
    cmsUInt32Number blackCount;        // Pure black pixels (skipped)
    cmsUInt32Number whiteCount;        // Pure white pixels (skipped)
    cmsBool optimizationSkipped;       // True if fallback to regular transform
} BPCClampStats;

/**
 * Initialize BPC clamping cache for a transform
 * Pre-computes output values for pure black and pure white input
 *
 * @param transform Transform handle
 * @param inputChannels Number of input channels (1, 3, or 4)
 * @param outputChannels Number of output channels (typically 4 for CMYK)
 * @return Cache index on success, -1 on error
 */
int BPCClamp_Init(
    cmsHTRANSFORM transform,
    cmsUInt32Number inputChannels,
    cmsUInt32Number outputChannels
);

/**
 * Clear BPC clamping cache for a transform
 *
 * @param transform Transform handle
 */
void BPCClamp_Clear(cmsHTRANSFORM transform);

/**
 * Clear all BPC clamping caches
 */
void BPCClamp_ClearAll(void);

/**
 * Perform transform with BPC boundary clamping optimization
 * SIMD-optimized detection of pure black/white pixels
 *
 * @param transform Transform handle
 * @param inputBuffer Input pixel data (Uint8)
 * @param outputBuffer Output pixel data (Uint8)
 * @param pixelCount Number of pixels to transform
 * @param stats Output statistics (can be NULL)
 */
void BPCClamp_DoTransform(
    cmsHTRANSFORM transform,
    const cmsUInt8Number* inputBuffer,
    cmsUInt8Number* outputBuffer,
    cmsUInt32Number pixelCount,
    BPCClampStats* stats
);

/**
 * Get pre-computed black output values
 *
 * @param transform Transform handle
 * @param output Buffer to receive black output values (must be >= outputChannels)
 * @return Number of channels, or 0 if not cached
 */
cmsUInt32Number BPCClamp_GetBlackOutput(
    cmsHTRANSFORM transform,
    cmsUInt8Number* output
);

/**
 * Get pre-computed white output values
 *
 * @param transform Transform handle
 * @param output Buffer to receive white output values (must be >= outputChannels)
 * @return Number of channels, or 0 if not cached
 */
cmsUInt32Number BPCClamp_GetWhiteOutput(
    cmsHTRANSFORM transform,
    cmsUInt8Number* output
);

/**
 * Adaptive transform with automatic boundary detection
 *
 * Samples the first BPC_CLAMP_SAMPLE_SIZE pixels to detect if image
 * is 100% boundary (pure black/white). Only applies optimization for
 * images >= BPC_CLAMP_MIN_PIXELS (2MP) that are detected as pure masks.
 *
 * @param transform Transform handle
 * @param inputBuffer Input pixel data (Uint8)
 * @param outputBuffer Output pixel data (Uint8)
 * @param pixelCount Number of pixels to transform
 * @param stats Output statistics (can be NULL)
 */
void BPCClamp_DoTransformAdaptive(
    cmsHTRANSFORM transform,
    const cmsUInt8Number* inputBuffer,
    cmsUInt8Number* outputBuffer,
    cmsUInt32Number pixelCount,
    BPCClampStats* stats
);

#ifdef __cplusplus
}
#endif

#endif // BPC_CLAMP_H
