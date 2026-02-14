/**
 * @file bpc-clamp.c
 * @brief BPC Boundary Clamping Optimization for Color Transforms
 *
 * SIMD-optimized detection and handling of boundary pixels (pure black/white)
 * during color transformation. When BPC is enabled, boundary pixels have
 * deterministic outputs that can be cached and reused.
 *
 * Uses WebAssembly SIMD for vectorized pixel processing when available.
 *
 * @author Claude Code
 * @date 2025-12-19
 */

#include "bpc-clamp.h"
#include <string.h>
#include <stdlib.h>

#ifdef __wasm_simd128__
#include <wasm_simd128.h>
#endif

// ============================================================================
// Cache Management
// ============================================================================

static BPCClampCache g_cache[BPC_CLAMP_MAX_CACHE];
static cmsUInt32Number g_cacheCount = 0;

/**
 * Find cache entry for a transform
 */
static int findCacheEntry(cmsHTRANSFORM transform) {
    for (cmsUInt32Number i = 0; i < g_cacheCount; i++) {
        if (g_cache[i].transform == transform && g_cache[i].isValid) {
            return (int)i;
        }
    }
    return -1;
}

/**
 * Find or allocate cache entry
 */
static int allocateCacheEntry(cmsHTRANSFORM transform) {
    // Check if already exists
    int existing = findCacheEntry(transform);
    if (existing >= 0) return existing;

    // Find empty slot
    for (cmsUInt32Number i = 0; i < BPC_CLAMP_MAX_CACHE; i++) {
        if (!g_cache[i].isValid) {
            g_cache[i].transform = transform;
            if (i >= g_cacheCount) g_cacheCount = i + 1;
            return (int)i;
        }
    }

    // Cache full - use LRU eviction (replace first entry)
    g_cache[0].isValid = FALSE;
    g_cache[0].transform = transform;
    return 0;
}

// ============================================================================
// Public API
// ============================================================================

int BPCClamp_Init(
    cmsHTRANSFORM transform,
    cmsUInt32Number inputChannels,
    cmsUInt32Number outputChannels
) {
    if (!transform || inputChannels == 0 || inputChannels > 8 ||
        outputChannels == 0 || outputChannels > 8) {
        return -1;
    }

    int idx = allocateCacheEntry(transform);
    if (idx < 0) return -1;

    BPCClampCache* cache = &g_cache[idx];
    cache->inputChannels = inputChannels;
    cache->outputChannels = outputChannels;

    // Pre-compute black output (all zeros input)
    cmsUInt8Number blackInput[8] = {0, 0, 0, 0, 0, 0, 0, 0};
    cmsDoTransform(transform, blackInput, cache->blackOutput, 1);

    // Pre-compute white output (all 255 input)
    cmsUInt8Number whiteInput[8] = {255, 255, 255, 255, 255, 255, 255, 255};
    cmsDoTransform(transform, whiteInput, cache->whiteOutput, 1);

    cache->isValid = TRUE;
    return idx;
}

void BPCClamp_Clear(cmsHTRANSFORM transform) {
    int idx = findCacheEntry(transform);
    if (idx >= 0) {
        g_cache[idx].isValid = FALSE;
        g_cache[idx].transform = NULL;
    }
}

void BPCClamp_ClearAll(void) {
    for (cmsUInt32Number i = 0; i < BPC_CLAMP_MAX_CACHE; i++) {
        g_cache[i].isValid = FALSE;
        g_cache[i].transform = NULL;
    }
    g_cacheCount = 0;
}

cmsUInt32Number BPCClamp_GetBlackOutput(
    cmsHTRANSFORM transform,
    cmsUInt8Number* output
) {
    int idx = findCacheEntry(transform);
    if (idx < 0) return 0;

    BPCClampCache* cache = &g_cache[idx];
    memcpy(output, cache->blackOutput, cache->outputChannels);
    return cache->outputChannels;
}

cmsUInt32Number BPCClamp_GetWhiteOutput(
    cmsHTRANSFORM transform,
    cmsUInt8Number* output
) {
    int idx = findCacheEntry(transform);
    if (idx < 0) return 0;

    BPCClampCache* cache = &g_cache[idx];
    memcpy(output, cache->whiteOutput, cache->outputChannels);
    return cache->outputChannels;
}

// ============================================================================
// SIMD-Optimized Transform with Boundary Detection
// ============================================================================

#ifdef __wasm_simd128__

/**
 * SIMD version: Process 16 bytes at a time for boundary detection
 * Checks if all bytes in a pixel are 0 (black) or 255 (white)
 */
static inline cmsBool isBlackPixel_SIMD(const cmsUInt8Number* pixel, cmsUInt32Number channels) {
    // For RGB (3 channels), just check individual bytes
    if (channels == 3) {
        return pixel[0] == 0 && pixel[1] == 0 && pixel[2] == 0;
    }
    // For RGBA/CMYK (4 channels), use SIMD comparison
    if (channels == 4) {
        v128_t data = wasm_v128_load32_zero(pixel);
        v128_t zero = wasm_i8x16_splat(0);
        v128_t cmp = wasm_i8x16_eq(data, zero);
        // Check first 4 bytes are all equal to 0
        return (wasm_i8x16_extract_lane(cmp, 0) &
                wasm_i8x16_extract_lane(cmp, 1) &
                wasm_i8x16_extract_lane(cmp, 2) &
                wasm_i8x16_extract_lane(cmp, 3)) == -1;
    }
    // Fallback for other channel counts
    for (cmsUInt32Number i = 0; i < channels; i++) {
        if (pixel[i] != 0) return FALSE;
    }
    return TRUE;
}

static inline cmsBool isWhitePixel_SIMD(const cmsUInt8Number* pixel, cmsUInt32Number channels) {
    if (channels == 3) {
        return pixel[0] == 255 && pixel[1] == 255 && pixel[2] == 255;
    }
    if (channels == 4) {
        v128_t data = wasm_v128_load32_zero(pixel);
        v128_t white = wasm_u8x16_splat(255);
        v128_t cmp = wasm_i8x16_eq(data, white);
        return (wasm_i8x16_extract_lane(cmp, 0) &
                wasm_i8x16_extract_lane(cmp, 1) &
                wasm_i8x16_extract_lane(cmp, 2) &
                wasm_i8x16_extract_lane(cmp, 3)) == -1;
    }
    for (cmsUInt32Number i = 0; i < channels; i++) {
        if (pixel[i] != 255) return FALSE;
    }
    return TRUE;
}

/**
 * SIMD-optimized batch boundary detection for 4 RGB pixels at once
 * Returns a bitmask: bit 0-3 for black pixels, bit 4-7 for white pixels
 */
static cmsUInt8Number detectBoundaryBatch_RGB_SIMD(const cmsUInt8Number* pixels) {
    // Load 12 bytes (4 RGB pixels) - but SIMD works on 16 bytes
    // Load as 3 separate 4-byte loads
    v128_t p0 = wasm_v128_load32_zero(pixels);      // R0,G0,B0,R1
    v128_t p1 = wasm_v128_load32_zero(pixels + 4);  // G1,B1,R2,G2
    v128_t p2 = wasm_v128_load32_zero(pixels + 8);  // B2,R3,G3,B3

    v128_t zero = wasm_i8x16_splat(0);
    v128_t white = wasm_u8x16_splat(255);

    // Check for black
    v128_t b0 = wasm_i8x16_eq(p0, zero);
    v128_t b1 = wasm_i8x16_eq(p1, zero);
    v128_t b2 = wasm_i8x16_eq(p2, zero);

    // Check for white
    v128_t w0 = wasm_i8x16_eq(p0, white);
    v128_t w1 = wasm_i8x16_eq(p1, white);
    v128_t w2 = wasm_i8x16_eq(p2, white);

    cmsUInt8Number result = 0;

    // Pixel 0: bytes 0,1,2
    if ((wasm_i8x16_extract_lane(b0, 0) & wasm_i8x16_extract_lane(b0, 1) & wasm_i8x16_extract_lane(b0, 2)) == -1)
        result |= 0x01;
    if ((wasm_i8x16_extract_lane(w0, 0) & wasm_i8x16_extract_lane(w0, 1) & wasm_i8x16_extract_lane(w0, 2)) == -1)
        result |= 0x10;

    // Pixel 1: bytes 3,4,5 (spans p0 and p1)
    if ((wasm_i8x16_extract_lane(b0, 3) & wasm_i8x16_extract_lane(b1, 0) & wasm_i8x16_extract_lane(b1, 1)) == -1)
        result |= 0x02;
    if ((wasm_i8x16_extract_lane(w0, 3) & wasm_i8x16_extract_lane(w1, 0) & wasm_i8x16_extract_lane(w1, 1)) == -1)
        result |= 0x20;

    // Pixel 2: bytes 6,7,8 (spans p1 and p2)
    if ((wasm_i8x16_extract_lane(b1, 2) & wasm_i8x16_extract_lane(b1, 3) & wasm_i8x16_extract_lane(b2, 0)) == -1)
        result |= 0x04;
    if ((wasm_i8x16_extract_lane(w1, 2) & wasm_i8x16_extract_lane(w1, 3) & wasm_i8x16_extract_lane(w2, 0)) == -1)
        result |= 0x40;

    // Pixel 3: bytes 9,10,11
    if ((wasm_i8x16_extract_lane(b2, 1) & wasm_i8x16_extract_lane(b2, 2) & wasm_i8x16_extract_lane(b2, 3)) == -1)
        result |= 0x08;
    if ((wasm_i8x16_extract_lane(w2, 1) & wasm_i8x16_extract_lane(w2, 2) & wasm_i8x16_extract_lane(w2, 3)) == -1)
        result |= 0x80;

    return result;
}

/**
 * SIMD-optimized batch boundary detection for 4 CMYK/RGBA pixels at once
 */
static cmsUInt8Number detectBoundaryBatch_4CH_SIMD(const cmsUInt8Number* pixels) {
    // Load 16 bytes (4 x 4-channel pixels)
    v128_t data = wasm_v128_load(pixels);
    v128_t zero = wasm_i8x16_splat(0);
    v128_t white = wasm_u8x16_splat(255);

    v128_t isBlack = wasm_i8x16_eq(data, zero);
    v128_t isWhite = wasm_i8x16_eq(data, white);

    cmsUInt8Number result = 0;

    // Pixel 0: lanes 0-3
    if ((wasm_i8x16_extract_lane(isBlack, 0) & wasm_i8x16_extract_lane(isBlack, 1) &
         wasm_i8x16_extract_lane(isBlack, 2) & wasm_i8x16_extract_lane(isBlack, 3)) == -1)
        result |= 0x01;
    if ((wasm_i8x16_extract_lane(isWhite, 0) & wasm_i8x16_extract_lane(isWhite, 1) &
         wasm_i8x16_extract_lane(isWhite, 2) & wasm_i8x16_extract_lane(isWhite, 3)) == -1)
        result |= 0x10;

    // Pixel 1: lanes 4-7
    if ((wasm_i8x16_extract_lane(isBlack, 4) & wasm_i8x16_extract_lane(isBlack, 5) &
         wasm_i8x16_extract_lane(isBlack, 6) & wasm_i8x16_extract_lane(isBlack, 7)) == -1)
        result |= 0x02;
    if ((wasm_i8x16_extract_lane(isWhite, 4) & wasm_i8x16_extract_lane(isWhite, 5) &
         wasm_i8x16_extract_lane(isWhite, 6) & wasm_i8x16_extract_lane(isWhite, 7)) == -1)
        result |= 0x20;

    // Pixel 2: lanes 8-11
    if ((wasm_i8x16_extract_lane(isBlack, 8) & wasm_i8x16_extract_lane(isBlack, 9) &
         wasm_i8x16_extract_lane(isBlack, 10) & wasm_i8x16_extract_lane(isBlack, 11)) == -1)
        result |= 0x04;
    if ((wasm_i8x16_extract_lane(isWhite, 8) & wasm_i8x16_extract_lane(isWhite, 9) &
         wasm_i8x16_extract_lane(isWhite, 10) & wasm_i8x16_extract_lane(isWhite, 11)) == -1)
        result |= 0x40;

    // Pixel 3: lanes 12-15
    if ((wasm_i8x16_extract_lane(isBlack, 12) & wasm_i8x16_extract_lane(isBlack, 13) &
         wasm_i8x16_extract_lane(isBlack, 14) & wasm_i8x16_extract_lane(isBlack, 15)) == -1)
        result |= 0x08;
    if ((wasm_i8x16_extract_lane(isWhite, 12) & wasm_i8x16_extract_lane(isWhite, 13) &
         wasm_i8x16_extract_lane(isWhite, 14) & wasm_i8x16_extract_lane(isWhite, 15)) == -1)
        result |= 0x80;

    return result;
}

#endif // __wasm_simd128__

// ============================================================================
// Non-SIMD Fallbacks
// ============================================================================

static inline cmsBool isBlackPixel_Scalar(const cmsUInt8Number* pixel, cmsUInt32Number channels) {
    for (cmsUInt32Number i = 0; i < channels; i++) {
        if (pixel[i] != 0) return FALSE;
    }
    return TRUE;
}

static inline cmsBool isWhitePixel_Scalar(const cmsUInt8Number* pixel, cmsUInt32Number channels) {
    for (cmsUInt32Number i = 0; i < channels; i++) {
        if (pixel[i] != 255) return FALSE;
    }
    return TRUE;
}

// ============================================================================
// Main Transform Function
// ============================================================================

void BPCClamp_DoTransform(
    cmsHTRANSFORM transform,
    const cmsUInt8Number* inputBuffer,
    cmsUInt8Number* outputBuffer,
    cmsUInt32Number pixelCount,
    BPCClampStats* stats
) {
    // Initialize stats
    BPCClampStats localStats = {0, 0, 0, FALSE};

    // Find cache entry
    int idx = findCacheEntry(transform);
    if (idx < 0) {
        // No cache - fall back to regular transform
        cmsDoTransform(transform, inputBuffer, outputBuffer, pixelCount);
        localStats.transformedCount = pixelCount;
        localStats.optimizationSkipped = TRUE;
        if (stats) *stats = localStats;
        return;
    }

    BPCClampCache* cache = &g_cache[idx];
    cmsUInt32Number inCh = cache->inputChannels;
    cmsUInt32Number outCh = cache->outputChannels;

    // For mismatched channels, just do regular transform
    if (inCh > 4 || outCh > 4) {
        cmsDoTransform(transform, inputBuffer, outputBuffer, pixelCount);
        localStats.transformedCount = pixelCount;
        localStats.optimizationSkipped = TRUE;
        if (stats) *stats = localStats;
        return;
    }

    // Arrays for tracking which pixels need transform
    // Use stack allocation for reasonable sizes, heap for large
    cmsUInt8Number* needsTransform;
    cmsUInt8Number stackFlags[16384];
    cmsUInt8Number* heapFlags = NULL;

    if (pixelCount <= 16384) {
        needsTransform = stackFlags;
    } else {
        heapFlags = (cmsUInt8Number*)malloc(pixelCount);
        if (!heapFlags) {
            cmsDoTransform(transform, inputBuffer, outputBuffer, pixelCount);
            localStats.transformedCount = pixelCount;
            localStats.optimizationSkipped = TRUE;
            if (stats) *stats = localStats;
            return;
        }
        needsTransform = heapFlags;
    }

    cmsUInt32Number toTransformCount = 0;

    // First pass: detect boundary pixels and write cached values
#ifdef __wasm_simd128__
    if (inCh == 3) {
        // RGB input - process 4 pixels at a time
        cmsUInt32Number i = 0;
        for (; i + 4 <= pixelCount; i += 4) {
            cmsUInt8Number boundaryMask = detectBoundaryBatch_RGB_SIMD(inputBuffer + i * 3);

            for (cmsUInt32Number j = 0; j < 4; j++) {
                cmsUInt32Number pixelIdx = i + j;
                cmsBool isBlack = (boundaryMask & (1 << j)) != 0;
                cmsBool isWhite = (boundaryMask & (0x10 << j)) != 0;

                if (isBlack) {
                    memcpy(outputBuffer + pixelIdx * outCh, cache->blackOutput, outCh);
                    localStats.blackCount++;
                    needsTransform[pixelIdx] = 0;
                } else if (isWhite) {
                    memcpy(outputBuffer + pixelIdx * outCh, cache->whiteOutput, outCh);
                    localStats.whiteCount++;
                    needsTransform[pixelIdx] = 0;
                } else {
                    needsTransform[pixelIdx] = 1;
                    toTransformCount++;
                }
            }
        }
        // Handle remaining pixels
        for (; i < pixelCount; i++) {
            const cmsUInt8Number* pixel = inputBuffer + i * 3;
            if (isBlackPixel_SIMD(pixel, 3)) {
                memcpy(outputBuffer + i * outCh, cache->blackOutput, outCh);
                localStats.blackCount++;
                needsTransform[i] = 0;
            } else if (isWhitePixel_SIMD(pixel, 3)) {
                memcpy(outputBuffer + i * outCh, cache->whiteOutput, outCh);
                localStats.whiteCount++;
                needsTransform[i] = 0;
            } else {
                needsTransform[i] = 1;
                toTransformCount++;
            }
        }
    } else if (inCh == 4) {
        // CMYK/RGBA input - process 4 pixels at a time
        cmsUInt32Number i = 0;
        for (; i + 4 <= pixelCount; i += 4) {
            cmsUInt8Number boundaryMask = detectBoundaryBatch_4CH_SIMD(inputBuffer + i * 4);

            for (cmsUInt32Number j = 0; j < 4; j++) {
                cmsUInt32Number pixelIdx = i + j;
                cmsBool isBlack = (boundaryMask & (1 << j)) != 0;
                cmsBool isWhite = (boundaryMask & (0x10 << j)) != 0;

                if (isBlack) {
                    memcpy(outputBuffer + pixelIdx * outCh, cache->blackOutput, outCh);
                    localStats.blackCount++;
                    needsTransform[pixelIdx] = 0;
                } else if (isWhite) {
                    memcpy(outputBuffer + pixelIdx * outCh, cache->whiteOutput, outCh);
                    localStats.whiteCount++;
                    needsTransform[pixelIdx] = 0;
                } else {
                    needsTransform[pixelIdx] = 1;
                    toTransformCount++;
                }
            }
        }
        // Handle remaining pixels
        for (; i < pixelCount; i++) {
            const cmsUInt8Number* pixel = inputBuffer + i * 4;
            if (isBlackPixel_SIMD(pixel, 4)) {
                memcpy(outputBuffer + i * outCh, cache->blackOutput, outCh);
                localStats.blackCount++;
                needsTransform[i] = 0;
            } else if (isWhitePixel_SIMD(pixel, 4)) {
                memcpy(outputBuffer + i * outCh, cache->whiteOutput, outCh);
                localStats.whiteCount++;
                needsTransform[i] = 0;
            } else {
                needsTransform[i] = 1;
                toTransformCount++;
            }
        }
    } else
#endif
    {
        // Scalar fallback for all channel counts
        for (cmsUInt32Number i = 0; i < pixelCount; i++) {
            const cmsUInt8Number* pixel = inputBuffer + i * inCh;
            if (isBlackPixel_Scalar(pixel, inCh)) {
                memcpy(outputBuffer + i * outCh, cache->blackOutput, outCh);
                localStats.blackCount++;
                needsTransform[i] = 0;
            } else if (isWhitePixel_Scalar(pixel, inCh)) {
                memcpy(outputBuffer + i * outCh, cache->whiteOutput, outCh);
                localStats.whiteCount++;
                needsTransform[i] = 0;
            } else {
                needsTransform[i] = 1;
                toTransformCount++;
            }
        }
    }

    // Second pass: transform non-boundary pixels
    if (toTransformCount > 0) {
        // If most pixels need transform, do it all at once (more efficient)
        if (toTransformCount > pixelCount * 9 / 10) {
            cmsDoTransform(transform, inputBuffer, outputBuffer, pixelCount);
            // Re-apply cached values for boundary pixels
            for (cmsUInt32Number i = 0; i < pixelCount; i++) {
                if (!needsTransform[i]) {
                    const cmsUInt8Number* pixel = inputBuffer + i * inCh;
                    if (isBlackPixel_Scalar(pixel, inCh)) {
                        memcpy(outputBuffer + i * outCh, cache->blackOutput, outCh);
                    } else {
                        memcpy(outputBuffer + i * outCh, cache->whiteOutput, outCh);
                    }
                }
            }
        } else {
            // Transform only non-boundary pixels
            for (cmsUInt32Number i = 0; i < pixelCount; i++) {
                if (needsTransform[i]) {
                    cmsDoTransform(transform,
                                   inputBuffer + i * inCh,
                                   outputBuffer + i * outCh,
                                   1);
                }
            }
        }
        localStats.transformedCount = toTransformCount;
    }

    // Cleanup
    if (heapFlags) {
        free(heapFlags);
    }

    if (stats) *stats = localStats;
}

// ============================================================================
// Adaptive Transform with Automatic Detection
// ============================================================================

void BPCClamp_DoTransformAdaptive(
    cmsHTRANSFORM transform,
    const cmsUInt8Number* inputBuffer,
    cmsUInt8Number* outputBuffer,
    cmsUInt32Number pixelCount,
    BPCClampStats* stats
) {
    // Initialize stats
    BPCClampStats localStats = {0, 0, 0, FALSE};

    // Check minimum size threshold (2MP)
    if (pixelCount < BPC_CLAMP_MIN_PIXELS) {
        // Too small - just do regular transform
        cmsDoTransform(transform, inputBuffer, outputBuffer, pixelCount);
        localStats.transformedCount = pixelCount;
        localStats.optimizationSkipped = TRUE;
        if (stats) *stats = localStats;
        return;
    }

    // Find cache entry
    int idx = findCacheEntry(transform);
    if (idx < 0) {
        // No cache - fall back to regular transform
        cmsDoTransform(transform, inputBuffer, outputBuffer, pixelCount);
        localStats.transformedCount = pixelCount;
        localStats.optimizationSkipped = TRUE;
        if (stats) *stats = localStats;
        return;
    }

    BPCClampCache* cache = &g_cache[idx];
    cmsUInt32Number inCh = cache->inputChannels;

    // Sample first N pixels to detect if image is 100% boundary
    cmsUInt32Number sampleSize = (pixelCount < BPC_CLAMP_SAMPLE_SIZE) ? pixelCount : BPC_CLAMP_SAMPLE_SIZE;
    cmsUInt32Number boundaryCount = 0;

#ifdef __wasm_simd128__
    if (inCh == 3) {
        // RGB: batch detect 4 pixels at a time
        cmsUInt32Number i = 0;
        for (; i + 4 <= sampleSize; i += 4) {
            cmsUInt8Number mask = detectBoundaryBatch_RGB_SIMD(inputBuffer + i * 3);
            // Count bits in lower nibble (black) and upper nibble (white)
            for (int j = 0; j < 4; j++) {
                if ((mask & (1 << j)) || (mask & (0x10 << j))) boundaryCount++;
            }
        }
        // Handle remaining
        for (; i < sampleSize; i++) {
            const cmsUInt8Number* pixel = inputBuffer + i * 3;
            if (isBlackPixel_SIMD(pixel, 3) || isWhitePixel_SIMD(pixel, 3)) {
                boundaryCount++;
            }
        }
    } else if (inCh == 4) {
        // CMYK/RGBA: batch detect 4 pixels at a time
        cmsUInt32Number i = 0;
        for (; i + 4 <= sampleSize; i += 4) {
            cmsUInt8Number mask = detectBoundaryBatch_4CH_SIMD(inputBuffer + i * 4);
            for (int j = 0; j < 4; j++) {
                if ((mask & (1 << j)) || (mask & (0x10 << j))) boundaryCount++;
            }
        }
        // Handle remaining
        for (; i < sampleSize; i++) {
            const cmsUInt8Number* pixel = inputBuffer + i * 4;
            if (isBlackPixel_SIMD(pixel, 4) || isWhitePixel_SIMD(pixel, 4)) {
                boundaryCount++;
            }
        }
    } else
#endif
    {
        // Scalar fallback
        for (cmsUInt32Number i = 0; i < sampleSize; i++) {
            const cmsUInt8Number* pixel = inputBuffer + i * inCh;
            if (isBlackPixel_Scalar(pixel, inCh) || isWhitePixel_Scalar(pixel, inCh)) {
                boundaryCount++;
            }
        }
    }

    // Decision: only use BPC clamping if sample is 100% boundary
    if (boundaryCount == sampleSize) {
        // Detected as pure mask - use full BPC clamping
        BPCClamp_DoTransform(transform, inputBuffer, outputBuffer, pixelCount, stats);
    } else {
        // Mixed content - use regular transform (faster)
        cmsDoTransform(transform, inputBuffer, outputBuffer, pixelCount);
        localStats.transformedCount = pixelCount;
        localStats.optimizationSkipped = TRUE;
        if (stats) *stats = localStats;
    }
}
