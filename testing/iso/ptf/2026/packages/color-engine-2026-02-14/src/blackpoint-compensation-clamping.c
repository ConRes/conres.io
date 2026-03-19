/**
 * @file blackpoint-compensation-clamping.c
 * @brief Blackpoint Compensation Boundary Clamping Optimization for Color Transforms
 *
 * SIMD-optimized detection and handling of data-range boundary pixels
 * (minimum/maximum encodable values) during color transformation. When
 * blackpoint compensation clamping is enabled, boundary pixels have
 * deterministic outputs that can be cached and reused.
 *
 * Supports 8-bit, 16-bit, and Float32 input/output formats. SIMD batch
 * detection is gated to 8-bit; all other bit depths use memcmp-based
 * scalar detection that is correct for any encoding.
 *
 * Uses WebAssembly SIMD for vectorized pixel processing when available.
 *
 * @author Saleh Abdel Motaal <dev@smotaal.io>
 * @ai Claude Sonnet 4.5 (initial code generation), Claude Opus 4 (SIMD optimization), Claude Opus 4.6 (bit-depth generalization)
 * @date 2025-12-19
 * @license GPL-3.0-or-later
 */

#include "blackpoint-compensation-clamping.h"
#include <string.h>
#include <stdlib.h>

#ifdef __wasm_simd128__
#include <wasm_simd128.h>
#endif

/* ========================================================================== */
/* Format Helpers                                                             */
/* ========================================================================== */

/**
 * Get bytes per sample from a LittleCMS format constant.
 * Returns 8 for T_BYTES==0 (double), matching LittleCMS convention.
 */
static inline cmsUInt32Number getBytesPerSample(cmsUInt32Number format) {
    cmsUInt32Number bytes = T_BYTES(format);
    return bytes == 0 ? 8 : bytes;
}

/* ========================================================================== */
/* Cache Management                                                           */
/* ========================================================================== */

static BlackpointCompensationClampingCache g_cache[BLACKPOINT_COMPENSATION_CLAMPING_MAX_CACHE];
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
    /* Check if already exists */
    int existing = findCacheEntry(transform);
    if (existing >= 0) return existing;

    /* Find empty slot */
    for (cmsUInt32Number i = 0; i < BLACKPOINT_COMPENSATION_CLAMPING_MAX_CACHE; i++) {
        if (!g_cache[i].isValid) {
            g_cache[i].transform = transform;
            if (i >= g_cacheCount) g_cacheCount = i + 1;
            return (int)i;
        }
    }

    /* Cache full — use LRU eviction (replace first entry) */
    g_cache[0].isValid = FALSE;
    g_cache[0].transform = transform;
    return 0;
}

/* ========================================================================== */
/* Format-Agnostic Boundary Detection                                         */
/* ========================================================================== */

/**
 * Check if a pixel matches the data-range minimum (all-zero bytes).
 * Correct for all bit depths: 8-bit, 16-bit, Float32.
 */
static inline cmsBool isMinimumPixel(const void* pixel, const BlackpointCompensationClampingCache* cache) {
    return memcmp(pixel, cache->minimumInput, cache->inputBytesPerPixel) == 0;
}

/**
 * Check if a pixel matches the data-range maximum.
 * Correct for all bit depths: 8-bit (0xFF), 16-bit (0xFFFF), Float32 (1.0f).
 */
static inline cmsBool isMaximumPixel(const void* pixel, const BlackpointCompensationClampingCache* cache) {
    return memcmp(pixel, cache->maximumInput, cache->inputBytesPerPixel) == 0;
}

/* ========================================================================== */
/* Public API                                                                 */
/* ========================================================================== */

int BlackpointCompensationClamping_Init(
    cmsHTRANSFORM transform,
    cmsUInt32Number inputChannels,
    cmsUInt32Number outputChannels
) {
    if (!transform || inputChannels == 0 || inputChannels > 8 ||
        outputChannels == 0 || outputChannels > 8) {
        return -1;
    }

    int cacheIndex = allocateCacheEntry(transform);
    if (cacheIndex < 0) return -1;

    BlackpointCompensationClampingCache* cache = &g_cache[cacheIndex];
    cache->inputChannels = inputChannels;
    cache->outputChannels = outputChannels;

    /* Derive format metadata from the transform */
    cmsUInt32Number inputFormat = cmsGetTransformInputFormat(transform);
    cmsUInt32Number outputFormat = cmsGetTransformOutputFormat(transform);

    cache->inputBytesPerSample = getBytesPerSample(inputFormat);
    cache->outputBytesPerSample = getBytesPerSample(outputFormat);
    cache->inputBytesPerPixel = inputChannels * cache->inputBytesPerSample;
    cache->outputBytesPerPixel = outputChannels * cache->outputBytesPerSample;
    cache->isFloatInput = T_FLOAT(inputFormat);
    cache->isFloatOutput = T_FLOAT(outputFormat);

    /* Validate buffer sizes fit in our 32-byte cache arrays */
    if (cache->inputBytesPerPixel > 32 || cache->outputBytesPerPixel > 32) {
        return -1;
    }

    /*
     * Construct minimumInput: all-zero bytes.
     * This represents the data-range minimum for all encodings:
     * - 8-bit:   0x00 per channel
     * - 16-bit:  0x0000 per channel
     * - Float32: 0x00000000 (0.0f) per channel
     */
    memset(cache->minimumInput, 0, 32);

    /*
     * Construct maximumInput: all channels at maximum encodable value.
     * The byte pattern depends on the encoding.
     */
    memset(cache->maximumInput, 0, 32);

    if (cache->isFloatInput) {
        /* Float32: maximum is 1.0f per channel */
        cmsFloat32Number one = 1.0f;
        for (cmsUInt32Number i = 0; i < inputChannels; i++) {
            memcpy(cache->maximumInput + i * sizeof(cmsFloat32Number), &one, sizeof(cmsFloat32Number));
        }
    } else if (cache->inputBytesPerSample == 2) {
        /* 16-bit: maximum is 0xFFFF per channel */
        cmsUInt16Number maxValue = 0xFFFF;
        for (cmsUInt32Number i = 0; i < inputChannels; i++) {
            memcpy(cache->maximumInput + i * sizeof(cmsUInt16Number), &maxValue, sizeof(cmsUInt16Number));
        }
    } else {
        /* 8-bit: maximum is 0xFF per channel byte */
        memset(cache->maximumInput, 255, cache->inputBytesPerPixel);
    }

    /* Pre-compute minimum output (transform of all-minimum input) */
    memset(cache->minimumOutput, 0, 32);
    cmsDoTransform(transform, cache->minimumInput, cache->minimumOutput, 1);

    /* Pre-compute maximum output (transform of all-maximum input) */
    memset(cache->maximumOutput, 0, 32);
    cmsDoTransform(transform, cache->maximumInput, cache->maximumOutput, 1);

    cache->isValid = TRUE;
    return cacheIndex;
}

int BlackpointCompensationClamping_RegisterTransform(cmsHTRANSFORM transform) {
    if (!transform) return -1;

    cmsUInt32Number inputFormat = cmsGetTransformInputFormat(transform);
    cmsUInt32Number outputFormat = cmsGetTransformOutputFormat(transform);

    cmsUInt32Number inputChannels = T_CHANNELS(inputFormat) + T_EXTRA(inputFormat);
    cmsUInt32Number outputChannels = T_CHANNELS(outputFormat) + T_EXTRA(outputFormat);

    return BlackpointCompensationClamping_Init(transform, inputChannels, outputChannels);
}

void BlackpointCompensationClamping_Clear(cmsHTRANSFORM transform) {
    int cacheIndex = findCacheEntry(transform);
    if (cacheIndex >= 0) {
        g_cache[cacheIndex].isValid = FALSE;
        g_cache[cacheIndex].transform = NULL;
    }
}

void BlackpointCompensationClamping_ClearAll(void) {
    for (cmsUInt32Number i = 0; i < BLACKPOINT_COMPENSATION_CLAMPING_MAX_CACHE; i++) {
        g_cache[i].isValid = FALSE;
        g_cache[i].transform = NULL;
    }
    g_cacheCount = 0;
}

cmsUInt32Number BlackpointCompensationClamping_GetMinimumOutput(
    cmsHTRANSFORM transform,
    void* output
) {
    int cacheIndex = findCacheEntry(transform);
    if (cacheIndex < 0) return 0;

    BlackpointCompensationClampingCache* cache = &g_cache[cacheIndex];
    memcpy(output, cache->minimumOutput, cache->outputBytesPerPixel);
    return cache->outputBytesPerPixel;
}

cmsUInt32Number BlackpointCompensationClamping_GetMaximumOutput(
    cmsHTRANSFORM transform,
    void* output
) {
    int cacheIndex = findCacheEntry(transform);
    if (cacheIndex < 0) return 0;

    BlackpointCompensationClampingCache* cache = &g_cache[cacheIndex];
    memcpy(output, cache->maximumOutput, cache->outputBytesPerPixel);
    return cache->outputBytesPerPixel;
}

/* ========================================================================== */
/* SIMD-Optimized Batch Boundary Detection (8-bit only)                       */
/* ========================================================================== */

#ifdef __wasm_simd128__

/**
 * SIMD-optimized batch boundary detection for 4 RGB pixels at once.
 * Returns a bitmask: bit 0-3 for minimum pixels, bit 4-7 for maximum pixels.
 *
 * Only valid for 8-bit input (inputBytesPerSample == 1).
 */
static cmsUInt8Number detectBoundaryBatch_RGB_SIMD(const cmsUInt8Number* pixels) {
    /* Load 12 bytes (4 RGB pixels) — SIMD works on 16 bytes */
    v128_t p0 = wasm_v128_load32_zero(pixels);      /* R0,G0,B0,R1 */
    v128_t p1 = wasm_v128_load32_zero(pixels + 4);  /* G1,B1,R2,G2 */
    v128_t p2 = wasm_v128_load32_zero(pixels + 8);  /* B2,R3,G3,B3 */

    v128_t zero = wasm_i8x16_splat(0);
    v128_t white = wasm_u8x16_splat(255);

    /* Check for minimum (all-zero) */
    v128_t b0 = wasm_i8x16_eq(p0, zero);
    v128_t b1 = wasm_i8x16_eq(p1, zero);
    v128_t b2 = wasm_i8x16_eq(p2, zero);

    /* Check for maximum (all-255) */
    v128_t w0 = wasm_i8x16_eq(p0, white);
    v128_t w1 = wasm_i8x16_eq(p1, white);
    v128_t w2 = wasm_i8x16_eq(p2, white);

    cmsUInt8Number result = 0;

    /* Pixel 0: bytes 0,1,2 */
    if ((wasm_i8x16_extract_lane(b0, 0) & wasm_i8x16_extract_lane(b0, 1) & wasm_i8x16_extract_lane(b0, 2)) == -1)
        result |= 0x01;
    if ((wasm_i8x16_extract_lane(w0, 0) & wasm_i8x16_extract_lane(w0, 1) & wasm_i8x16_extract_lane(w0, 2)) == -1)
        result |= 0x10;

    /* Pixel 1: bytes 3,4,5 (spans p0 and p1) */
    if ((wasm_i8x16_extract_lane(b0, 3) & wasm_i8x16_extract_lane(b1, 0) & wasm_i8x16_extract_lane(b1, 1)) == -1)
        result |= 0x02;
    if ((wasm_i8x16_extract_lane(w0, 3) & wasm_i8x16_extract_lane(w1, 0) & wasm_i8x16_extract_lane(w1, 1)) == -1)
        result |= 0x20;

    /* Pixel 2: bytes 6,7,8 (spans p1 and p2) */
    if ((wasm_i8x16_extract_lane(b1, 2) & wasm_i8x16_extract_lane(b1, 3) & wasm_i8x16_extract_lane(b2, 0)) == -1)
        result |= 0x04;
    if ((wasm_i8x16_extract_lane(w1, 2) & wasm_i8x16_extract_lane(w1, 3) & wasm_i8x16_extract_lane(w2, 0)) == -1)
        result |= 0x40;

    /* Pixel 3: bytes 9,10,11 */
    if ((wasm_i8x16_extract_lane(b2, 1) & wasm_i8x16_extract_lane(b2, 2) & wasm_i8x16_extract_lane(b2, 3)) == -1)
        result |= 0x08;
    if ((wasm_i8x16_extract_lane(w2, 1) & wasm_i8x16_extract_lane(w2, 2) & wasm_i8x16_extract_lane(w2, 3)) == -1)
        result |= 0x80;

    return result;
}

/**
 * SIMD-optimized batch boundary detection for 4 CMYK/RGBA pixels at once.
 *
 * Only valid for 8-bit input (inputBytesPerSample == 1).
 */
static cmsUInt8Number detectBoundaryBatch_4CH_SIMD(const cmsUInt8Number* pixels) {
    /* Load 16 bytes (4 x 4-channel pixels) */
    v128_t data = wasm_v128_load(pixels);
    v128_t zero = wasm_i8x16_splat(0);
    v128_t white = wasm_u8x16_splat(255);

    v128_t isMinimum = wasm_i8x16_eq(data, zero);
    v128_t isMaximum = wasm_i8x16_eq(data, white);

    cmsUInt8Number result = 0;

    /* Pixel 0: lanes 0-3 */
    if ((wasm_i8x16_extract_lane(isMinimum, 0) & wasm_i8x16_extract_lane(isMinimum, 1) &
         wasm_i8x16_extract_lane(isMinimum, 2) & wasm_i8x16_extract_lane(isMinimum, 3)) == -1)
        result |= 0x01;
    if ((wasm_i8x16_extract_lane(isMaximum, 0) & wasm_i8x16_extract_lane(isMaximum, 1) &
         wasm_i8x16_extract_lane(isMaximum, 2) & wasm_i8x16_extract_lane(isMaximum, 3)) == -1)
        result |= 0x10;

    /* Pixel 1: lanes 4-7 */
    if ((wasm_i8x16_extract_lane(isMinimum, 4) & wasm_i8x16_extract_lane(isMinimum, 5) &
         wasm_i8x16_extract_lane(isMinimum, 6) & wasm_i8x16_extract_lane(isMinimum, 7)) == -1)
        result |= 0x02;
    if ((wasm_i8x16_extract_lane(isMaximum, 4) & wasm_i8x16_extract_lane(isMaximum, 5) &
         wasm_i8x16_extract_lane(isMaximum, 6) & wasm_i8x16_extract_lane(isMaximum, 7)) == -1)
        result |= 0x20;

    /* Pixel 2: lanes 8-11 */
    if ((wasm_i8x16_extract_lane(isMinimum, 8) & wasm_i8x16_extract_lane(isMinimum, 9) &
         wasm_i8x16_extract_lane(isMinimum, 10) & wasm_i8x16_extract_lane(isMinimum, 11)) == -1)
        result |= 0x04;
    if ((wasm_i8x16_extract_lane(isMaximum, 8) & wasm_i8x16_extract_lane(isMaximum, 9) &
         wasm_i8x16_extract_lane(isMaximum, 10) & wasm_i8x16_extract_lane(isMaximum, 11)) == -1)
        result |= 0x40;

    /* Pixel 3: lanes 12-15 */
    if ((wasm_i8x16_extract_lane(isMinimum, 12) & wasm_i8x16_extract_lane(isMinimum, 13) &
         wasm_i8x16_extract_lane(isMinimum, 14) & wasm_i8x16_extract_lane(isMinimum, 15)) == -1)
        result |= 0x08;
    if ((wasm_i8x16_extract_lane(isMaximum, 12) & wasm_i8x16_extract_lane(isMaximum, 13) &
         wasm_i8x16_extract_lane(isMaximum, 14) & wasm_i8x16_extract_lane(isMaximum, 15)) == -1)
        result |= 0x80;

    return result;
}

#endif /* __wasm_simd128__ */

/* ========================================================================== */
/* Main Transform Function                                                    */
/* ========================================================================== */

void BlackpointCompensationClamping_DoTransform(
    cmsHTRANSFORM transform,
    const void* inputBuffer,
    void* outputBuffer,
    cmsUInt32Number pixelCount,
    BlackpointCompensationClampingStats* stats
) {
    /* Initialize stats */
    BlackpointCompensationClampingStats localStats = {0, 0, 0, FALSE};

    /* Find cache entry */
    int cacheIndex = findCacheEntry(transform);
    if (cacheIndex < 0) {
        /* No cache — fall back to regular transform */
        cmsDoTransform(transform, inputBuffer, outputBuffer, pixelCount);
        localStats.transformedCount = pixelCount;
        localStats.optimizationSkipped = TRUE;
        if (stats) *stats = localStats;
        return;
    }

    BlackpointCompensationClampingCache* cache = &g_cache[cacheIndex];

    /* Cast to byte pointers for arithmetic */
    const cmsUInt8Number* inputBufferBytes = (const cmsUInt8Number*)inputBuffer;
    cmsUInt8Number* outputBufferBytes = (cmsUInt8Number*)outputBuffer;

    /* Arrays for tracking which pixels need transform */
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

    /* First pass: detect boundary pixels and write cached values */
#ifdef __wasm_simd128__
    if (cache->inputBytesPerSample == 1 && cache->inputChannels == 3) {
        /* 8-bit RGB input — process 4 pixels at a time via SIMD */
        cmsUInt32Number i = 0;
        for (; i + 4 <= pixelCount; i += 4) {
            cmsUInt8Number boundaryMask = detectBoundaryBatch_RGB_SIMD(inputBufferBytes + i * 3);

            for (cmsUInt32Number j = 0; j < 4; j++) {
                cmsUInt32Number pixelIndex = i + j;
                cmsBool isMinimum = (boundaryMask & (1 << j)) != 0;
                cmsBool isMaximum = (boundaryMask & (0x10 << j)) != 0;

                if (isMinimum) {
                    memcpy(outputBufferBytes + pixelIndex * cache->outputBytesPerPixel, cache->minimumOutput, cache->outputBytesPerPixel);
                    localStats.minimumCount++;
                    needsTransform[pixelIndex] = 0;
                } else if (isMaximum) {
                    memcpy(outputBufferBytes + pixelIndex * cache->outputBytesPerPixel, cache->maximumOutput, cache->outputBytesPerPixel);
                    localStats.maximumCount++;
                    needsTransform[pixelIndex] = 0;
                } else {
                    needsTransform[pixelIndex] = 1;
                    toTransformCount++;
                }
            }
        }
        /* Handle remaining pixels */
        for (; i < pixelCount; i++) {
            const void* pixel = inputBufferBytes + i * 3;
            if (isMinimumPixel(pixel, cache)) {
                memcpy(outputBufferBytes + i * cache->outputBytesPerPixel, cache->minimumOutput, cache->outputBytesPerPixel);
                localStats.minimumCount++;
                needsTransform[i] = 0;
            } else if (isMaximumPixel(pixel, cache)) {
                memcpy(outputBufferBytes + i * cache->outputBytesPerPixel, cache->maximumOutput, cache->outputBytesPerPixel);
                localStats.maximumCount++;
                needsTransform[i] = 0;
            } else {
                needsTransform[i] = 1;
                toTransformCount++;
            }
        }
    } else if (cache->inputBytesPerSample == 1 && cache->inputChannels == 4) {
        /* 8-bit CMYK/RGBA input — process 4 pixels at a time via SIMD */
        cmsUInt32Number i = 0;
        for (; i + 4 <= pixelCount; i += 4) {
            cmsUInt8Number boundaryMask = detectBoundaryBatch_4CH_SIMD(inputBufferBytes + i * 4);

            for (cmsUInt32Number j = 0; j < 4; j++) {
                cmsUInt32Number pixelIndex = i + j;
                cmsBool isMinimum = (boundaryMask & (1 << j)) != 0;
                cmsBool isMaximum = (boundaryMask & (0x10 << j)) != 0;

                if (isMinimum) {
                    memcpy(outputBufferBytes + pixelIndex * cache->outputBytesPerPixel, cache->minimumOutput, cache->outputBytesPerPixel);
                    localStats.minimumCount++;
                    needsTransform[pixelIndex] = 0;
                } else if (isMaximum) {
                    memcpy(outputBufferBytes + pixelIndex * cache->outputBytesPerPixel, cache->maximumOutput, cache->outputBytesPerPixel);
                    localStats.maximumCount++;
                    needsTransform[pixelIndex] = 0;
                } else {
                    needsTransform[pixelIndex] = 1;
                    toTransformCount++;
                }
            }
        }
        /* Handle remaining pixels */
        for (; i < pixelCount; i++) {
            const void* pixel = inputBufferBytes + i * 4;
            if (isMinimumPixel(pixel, cache)) {
                memcpy(outputBufferBytes + i * cache->outputBytesPerPixel, cache->minimumOutput, cache->outputBytesPerPixel);
                localStats.minimumCount++;
                needsTransform[i] = 0;
            } else if (isMaximumPixel(pixel, cache)) {
                memcpy(outputBufferBytes + i * cache->outputBytesPerPixel, cache->maximumOutput, cache->outputBytesPerPixel);
                localStats.maximumCount++;
                needsTransform[i] = 0;
            } else {
                needsTransform[i] = 1;
                toTransformCount++;
            }
        }
    } else
#endif
    {
        /* Scalar fallback for all bit depths and channel counts */
        for (cmsUInt32Number i = 0; i < pixelCount; i++) {
            const void* pixel = inputBufferBytes + i * cache->inputBytesPerPixel;
            if (isMinimumPixel(pixel, cache)) {
                memcpy(outputBufferBytes + i * cache->outputBytesPerPixel, cache->minimumOutput, cache->outputBytesPerPixel);
                localStats.minimumCount++;
                needsTransform[i] = 0;
            } else if (isMaximumPixel(pixel, cache)) {
                memcpy(outputBufferBytes + i * cache->outputBytesPerPixel, cache->maximumOutput, cache->outputBytesPerPixel);
                localStats.maximumCount++;
                needsTransform[i] = 0;
            } else {
                needsTransform[i] = 1;
                toTransformCount++;
            }
        }
    }

    /* Second pass: transform non-boundary pixels */
    if (toTransformCount > 0) {
        /* If most pixels need transform, do it all at once (more efficient) */
        if (toTransformCount > pixelCount * 9 / 10) {
            cmsDoTransform(transform, inputBuffer, outputBuffer, pixelCount);
            /* Re-apply cached values for boundary pixels */
            for (cmsUInt32Number i = 0; i < pixelCount; i++) {
                if (!needsTransform[i]) {
                    const void* pixel = inputBufferBytes + i * cache->inputBytesPerPixel;
                    if (isMinimumPixel(pixel, cache)) {
                        memcpy(outputBufferBytes + i * cache->outputBytesPerPixel, cache->minimumOutput, cache->outputBytesPerPixel);
                    } else {
                        memcpy(outputBufferBytes + i * cache->outputBytesPerPixel, cache->maximumOutput, cache->outputBytesPerPixel);
                    }
                }
            }
        } else {
            /* Transform only non-boundary pixels */
            for (cmsUInt32Number i = 0; i < pixelCount; i++) {
                if (needsTransform[i]) {
                    cmsDoTransform(transform,
                                   inputBufferBytes + i * cache->inputBytesPerPixel,
                                   outputBufferBytes + i * cache->outputBytesPerPixel,
                                   1);
                }
            }
        }
        localStats.transformedCount = toTransformCount;
    }

    /* Cleanup */
    if (heapFlags) {
        free(heapFlags);
    }

    if (stats) *stats = localStats;
}

/* ========================================================================== */
/* Adaptive Transform with Automatic Detection                                */
/* ========================================================================== */

void BlackpointCompensationClamping_DoTransformAdaptive(
    cmsHTRANSFORM transform,
    const void* inputBuffer,
    void* outputBuffer,
    cmsUInt32Number pixelCount,
    BlackpointCompensationClampingStats* stats
) {
    /* Initialize stats */
    BlackpointCompensationClampingStats localStats = {0, 0, 0, FALSE};

    /* Check minimum size threshold (2MP) */
    if (pixelCount < BLACKPOINT_COMPENSATION_CLAMPING_MIN_PIXELS) {
        /* Too small — just do regular transform */
        cmsDoTransform(transform, inputBuffer, outputBuffer, pixelCount);
        localStats.transformedCount = pixelCount;
        localStats.optimizationSkipped = TRUE;
        if (stats) *stats = localStats;
        return;
    }

    /* Find cache entry */
    int cacheIndex = findCacheEntry(transform);
    if (cacheIndex < 0) {
        /* No cache — fall back to regular transform */
        cmsDoTransform(transform, inputBuffer, outputBuffer, pixelCount);
        localStats.transformedCount = pixelCount;
        localStats.optimizationSkipped = TRUE;
        if (stats) *stats = localStats;
        return;
    }

    BlackpointCompensationClampingCache* cache = &g_cache[cacheIndex];

    /* Cast to byte pointer for arithmetic */
    const cmsUInt8Number* inputBufferBytes = (const cmsUInt8Number*)inputBuffer;

    /* Sample first N pixels to detect if image is 100% boundary */
    cmsUInt32Number sampleSize = (pixelCount < BLACKPOINT_COMPENSATION_CLAMPING_SAMPLE_SIZE) ? pixelCount : BLACKPOINT_COMPENSATION_CLAMPING_SAMPLE_SIZE;
    cmsUInt32Number boundaryCount = 0;

#ifdef __wasm_simd128__
    if (cache->inputBytesPerSample == 1 && cache->inputChannels == 3) {
        /* 8-bit RGB: batch detect 4 pixels at a time */
        cmsUInt32Number i = 0;
        for (; i + 4 <= sampleSize; i += 4) {
            cmsUInt8Number mask = detectBoundaryBatch_RGB_SIMD(inputBufferBytes + i * 3);
            /* Count bits in lower nibble (minimum) and upper nibble (maximum) */
            for (int j = 0; j < 4; j++) {
                if ((mask & (1 << j)) || (mask & (0x10 << j))) boundaryCount++;
            }
        }
        /* Handle remaining */
        for (; i < sampleSize; i++) {
            const void* pixel = inputBufferBytes + i * 3;
            if (isMinimumPixel(pixel, cache) || isMaximumPixel(pixel, cache)) {
                boundaryCount++;
            }
        }
    } else if (cache->inputBytesPerSample == 1 && cache->inputChannels == 4) {
        /* 8-bit CMYK/RGBA: batch detect 4 pixels at a time */
        cmsUInt32Number i = 0;
        for (; i + 4 <= sampleSize; i += 4) {
            cmsUInt8Number mask = detectBoundaryBatch_4CH_SIMD(inputBufferBytes + i * 4);
            for (int j = 0; j < 4; j++) {
                if ((mask & (1 << j)) || (mask & (0x10 << j))) boundaryCount++;
            }
        }
        /* Handle remaining */
        for (; i < sampleSize; i++) {
            const void* pixel = inputBufferBytes + i * 4;
            if (isMinimumPixel(pixel, cache) || isMaximumPixel(pixel, cache)) {
                boundaryCount++;
            }
        }
    } else
#endif
    {
        /* Scalar fallback for all bit depths and channel counts */
        for (cmsUInt32Number i = 0; i < sampleSize; i++) {
            const void* pixel = inputBufferBytes + i * cache->inputBytesPerPixel;
            if (isMinimumPixel(pixel, cache) || isMaximumPixel(pixel, cache)) {
                boundaryCount++;
            }
        }
    }

    /* Decision: only use clamping if sample is 100% boundary */
    if (boundaryCount == sampleSize) {
        /* Detected as pure mask — use full clamping */
        BlackpointCompensationClamping_DoTransform(transform, inputBuffer, outputBuffer, pixelCount, stats);
    } else {
        /* Mixed content — use regular transform (faster) */
        cmsDoTransform(transform, inputBuffer, outputBuffer, pixelCount);
        localStats.transformedCount = pixelCount;
        localStats.optimizationSkipped = TRUE;
        if (stats) *stats = localStats;
    }
}
