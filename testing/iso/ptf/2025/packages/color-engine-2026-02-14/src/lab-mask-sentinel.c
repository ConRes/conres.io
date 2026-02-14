/**
 * @file lab-mask-sentinel.c
 * @brief Lab Mask Sentinel Passthrough and Correction for Color Transforms
 *
 * Implements SIMD-optimized detection and handling of Lab 0/-128/-128
 * (the Lab Mask Sentinel) during doTransform. See lab-mask-sentinel.h for
 * the full description of the problem and approach.
 *
 * Two modes based on outer transform formats:
 *
 * Lab→Lab (both input and output are Lab):
 *   1. PRE:       SIMD scan input for sentinel (NULL) pixels, build flag array
 *   2. TRANSFORM: cmsDoTransform (agnostic — works with any transform type)
 *   3. POST:      Write sentinel (NULL) back at flagged positions in output
 *
 * Lab→non-Lab (only input is Lab):
 *   1. PRE:       Find sentinel (NULL) pixels, rewrite them to Lab 0/0/0 in input
 *   2. TRANSFORM: cmsDoTransform (now sees neutral black, not garbage sentinel)
 *   3. (nothing)
 *
 * Per-transform state is stored in ColorEngineTransformData (the plugin's
 * UserData), which is allocated fresh per-transform by the factory and freed
 * automatically by LittleCMS during cmsDeleteTransform. This eliminates the
 * stale-cache bug that occurred when static caches keyed by transform handle
 * returned wrong format metadata after address reuse.
 *
 * @author Saleh Abdel Motaal <dev@smotaal.io>
 * @ai Claude Opus 4.6 (code generation)
 * @date 2026-02-09
 * @license GPL-3.0-or-later
 */

#include "lab-mask-sentinel.h"
#include "color-engine-plugin.h"
#include "blackpoint-compensation-clamping.h"
#include "lcms2_internal.h"
#include <string.h>
#include <stdlib.h>

#ifdef __wasm_simd128__
#include <wasm_simd128.h>
#endif

/* ========================================================================== */
/* Sentinel Detection                                                         */
/* ========================================================================== */

static inline cmsBool isLabMaskSentinelFloat32(const cmsFloat32Number* pixel) {
    return pixel[0] == 0.0f && pixel[1] == -128.0f && pixel[2] == -128.0f;
}

static inline cmsBool isLabMaskSentinelInteger(
    const cmsUInt8Number* pixel,
    cmsUInt32Number labChannelBytes
) {
    for (cmsUInt32Number i = 0; i < labChannelBytes; i++) {
        if (pixel[i] != 0) return FALSE;
    }
    return TRUE;
}

#ifdef __wasm_simd128__

static cmsUInt8Number detectSentinelBatch_Lab8_SIMD(const cmsUInt8Number* pixels) {
    v128_t p0 = wasm_v128_load32_zero(pixels);
    v128_t p1 = wasm_v128_load32_zero(pixels + 4);
    v128_t p2 = wasm_v128_load32_zero(pixels + 8);

    v128_t zero = wasm_i8x16_splat(0);

    v128_t z0 = wasm_i8x16_eq(p0, zero);
    v128_t z1 = wasm_i8x16_eq(p1, zero);
    v128_t z2 = wasm_i8x16_eq(p2, zero);

    cmsUInt8Number result = 0;

    if ((wasm_i8x16_extract_lane(z0, 0) &
         wasm_i8x16_extract_lane(z0, 1) &
         wasm_i8x16_extract_lane(z0, 2)) == -1)
        result |= 0x01;

    if ((wasm_i8x16_extract_lane(z0, 3) &
         wasm_i8x16_extract_lane(z1, 0) &
         wasm_i8x16_extract_lane(z1, 1)) == -1)
        result |= 0x02;

    if ((wasm_i8x16_extract_lane(z1, 2) &
         wasm_i8x16_extract_lane(z1, 3) &
         wasm_i8x16_extract_lane(z2, 0)) == -1)
        result |= 0x04;

    if ((wasm_i8x16_extract_lane(z2, 1) &
         wasm_i8x16_extract_lane(z2, 2) &
         wasm_i8x16_extract_lane(z2, 3)) == -1)
        result |= 0x08;

    return result;
}

static cmsUInt8Number detectSentinelBatch_LabFloat_SIMD(const cmsFloat32Number* pixels) {
    v128_t chunk0 = wasm_v128_load(pixels);
    v128_t chunk1 = wasm_v128_load(pixels + 4);
    v128_t chunk2 = wasm_v128_load(pixels + 8);

    cmsUInt8Number result = 0;

    if (wasm_f32x4_extract_lane(chunk0, 0) == 0.0f &&
        wasm_f32x4_extract_lane(chunk0, 1) == -128.0f &&
        wasm_f32x4_extract_lane(chunk0, 2) == -128.0f)
        result |= 0x01;

    if (wasm_f32x4_extract_lane(chunk0, 3) == 0.0f &&
        wasm_f32x4_extract_lane(chunk1, 0) == -128.0f &&
        wasm_f32x4_extract_lane(chunk1, 1) == -128.0f)
        result |= 0x02;

    if (wasm_f32x4_extract_lane(chunk1, 2) == 0.0f &&
        wasm_f32x4_extract_lane(chunk1, 3) == -128.0f &&
        wasm_f32x4_extract_lane(chunk2, 0) == -128.0f)
        result |= 0x04;

    if (wasm_f32x4_extract_lane(chunk2, 1) == 0.0f &&
        wasm_f32x4_extract_lane(chunk2, 2) == -128.0f &&
        wasm_f32x4_extract_lane(chunk2, 3) == -128.0f)
        result |= 0x08;

    return result;
}

#endif /* __wasm_simd128__ */

/* ========================================================================== */
/* Main Transform                                                             */
/* ========================================================================== */

void LabMaskSentinel_DoTransform(
    cmsHTRANSFORM transform,
    const void* inputBuffer,
    void* outputBuffer,
    cmsUInt32Number pixelCount
) {
    /*
     * Get per-transform state from the plugin's UserData.
     *
     * The ColorEngineTransformData is allocated fresh per-transform by
     * the factory (ColorEngineTransformFactory in color-engine-plugin.c),
     * with all format metadata correctly computed. This avoids the stale-
     * cache bug that occurred when static caches were keyed by transform
     * handle (memory address reuse after cmsDeleteTransform + create).
     */
    const ColorEngineTransformData* data =
        (const ColorEngineTransformData*)_cmsGetTransformUserData(
            (struct _cmstransform_struct*)transform);

    if (data == NULL || !data->isLabInput) {
        /* No plugin data or not Lab input — no sentinel handling needed */
        BlackpointCompensationClamping_DoTransformAdaptive(
            transform, inputBuffer, outputBuffer, pixelCount, NULL);
        return;
    }

    if (pixelCount == 0) {
        return;
    }

    /* === PRE-SCAN: detect sentinel pixels, build flag array === */

    cmsUInt8Number* sentinelFlags;
    cmsUInt8Number stackFlags[16384];
    cmsUInt8Number* heapFlags = NULL;

    if (pixelCount <= 16384) {
        sentinelFlags = stackFlags;
    } else {
        heapFlags = (cmsUInt8Number*)malloc(pixelCount);
        if (!heapFlags) {
            BlackpointCompensationClamping_DoTransformAdaptive(
                transform, inputBuffer, outputBuffer, pixelCount, NULL);
            return;
        }
        sentinelFlags = heapFlags;
    }

    cmsUInt32Number sentinelCount = 0;
    const cmsUInt8Number* inBuf = (const cmsUInt8Number*)inputBuffer;
    cmsUInt32Number inStride = data->inputTotalBytes;

    if (data->isFloatInput) {
        const cmsFloat32Number* fBuf = (const cmsFloat32Number*)inputBuffer;
        cmsUInt32Number floatsPerPixel = inStride / sizeof(cmsFloat32Number);

#ifdef __wasm_simd128__
        if (floatsPerPixel == 3) {
            cmsUInt32Number i = 0;
            for (; i + 4 <= pixelCount; i += 4) {
                cmsUInt8Number mask = detectSentinelBatch_LabFloat_SIMD(fBuf + i * 3);
                for (cmsUInt32Number j = 0; j < 4; j++) {
                    if (mask & (1 << j)) {
                        sentinelFlags[i + j] = 1;
                        sentinelCount++;
                    } else {
                        sentinelFlags[i + j] = 0;
                    }
                }
            }
            for (; i < pixelCount; i++) {
                if (isLabMaskSentinelFloat32(fBuf + i * 3)) {
                    sentinelFlags[i] = 1;
                    sentinelCount++;
                } else {
                    sentinelFlags[i] = 0;
                }
            }
        } else
#endif
        {
            for (cmsUInt32Number i = 0; i < pixelCount; i++) {
                if (isLabMaskSentinelFloat32(fBuf + i * floatsPerPixel)) {
                    sentinelFlags[i] = 1;
                    sentinelCount++;
                } else {
                    sentinelFlags[i] = 0;
                }
            }
        }
    } else {
        cmsUInt32Number labBytes = data->inputLabChannelBytes;

#ifdef __wasm_simd128__
        if (labBytes == 3 && inStride == 3) {
            cmsUInt32Number i = 0;
            for (; i + 4 <= pixelCount; i += 4) {
                cmsUInt8Number mask = detectSentinelBatch_Lab8_SIMD(inBuf + i * 3);
                for (cmsUInt32Number j = 0; j < 4; j++) {
                    if (mask & (1 << j)) {
                        sentinelFlags[i + j] = 1;
                        sentinelCount++;
                    } else {
                        sentinelFlags[i + j] = 0;
                    }
                }
            }
            for (; i < pixelCount; i++) {
                if (inBuf[i * 3] == 0 && inBuf[i * 3 + 1] == 0 && inBuf[i * 3 + 2] == 0) {
                    sentinelFlags[i] = 1;
                    sentinelCount++;
                } else {
                    sentinelFlags[i] = 0;
                }
            }
        } else
#endif
        {
            for (cmsUInt32Number i = 0; i < pixelCount; i++) {
                if (isLabMaskSentinelInteger(inBuf + i * inStride, labBytes)) {
                    sentinelFlags[i] = 1;
                    sentinelCount++;
                } else {
                    sentinelFlags[i] = 0;
                }
            }
        }
    }

    /* No sentinels found — just transform */
    if (sentinelCount == 0) {
        BlackpointCompensationClamping_DoTransformAdaptive(
            transform, inputBuffer, outputBuffer, pixelCount, NULL);
        if (heapFlags) free(heapFlags);
        return;
    }

    if (data->isLabOutput) {
        /* ============================================================
         * Lab→Lab: flag sentinels, transform, write sentinel back
         * ============================================================ */

        BlackpointCompensationClamping_DoTransformAdaptive(
            transform, inputBuffer, outputBuffer, pixelCount, NULL);

        /* POST: write sentinel value back at flagged output positions */
        cmsUInt8Number* outBuf = (cmsUInt8Number*)outputBuffer;
        cmsUInt32Number outStride = data->outputTotalBytes;
        cmsUInt32Number colorBytes = data->outputColorBytes;

#ifdef __wasm_simd128__
        cmsUInt32Number i = 0;
        for (; i + 16 <= pixelCount; i += 16) {
            v128_t flags = wasm_v128_load(sentinelFlags + i);
            if (wasm_v128_any_true(flags)) {
                for (cmsUInt32Number j = 0; j < 16; j++) {
                    if (sentinelFlags[i + j]) {
                        memcpy(outBuf + (i + j) * outStride,
                               data->sentinelLabOutput, colorBytes);
                    }
                }
            }
        }
        for (; i < pixelCount; i++) {
            if (sentinelFlags[i]) {
                memcpy(outBuf + i * outStride,
                       data->sentinelLabOutput, colorBytes);
            }
        }
#else
        for (cmsUInt32Number i = 0; i < pixelCount; i++) {
            if (sentinelFlags[i]) {
                memcpy(outBuf + i * outStride,
                       data->sentinelLabOutput, colorBytes);
            }
        }
#endif

    } else {
        /* ============================================================
         * Lab→non-Lab: rewrite sentinels to neutral black, then transform
         * ============================================================ */

        cmsUInt8Number* writableInput = (cmsUInt8Number*)inputBuffer;
        cmsUInt32Number labBytes = data->inputLabChannelBytes;

        for (cmsUInt32Number i = 0; i < pixelCount; i++) {
            if (sentinelFlags[i]) {
                memcpy(writableInput + i * inStride,
                       data->neutralBlackLabInput, labBytes);
            }
        }

        BlackpointCompensationClamping_DoTransformAdaptive(
            transform, inputBuffer, outputBuffer, pixelCount, NULL);
    }

    if (heapFlags) {
        free(heapFlags);
    }
}

/**
 * Clear cached Lab Mask Sentinel state for a specific transform.
 *
 * No-op: per-transform state is now stored in the plugin's UserData
 * (ColorEngineTransformData), which is freed automatically by LittleCMS
 * during cmsDeleteTransform via the FreeUserData callback.
 */
void LabMaskSentinel_Clear(cmsHTRANSFORM transform) {
    (void)transform;
}

/**
 * Clear all cached Lab Mask Sentinel states.
 *
 * No-op: per-transform state is now stored in the plugin's UserData.
 */
void LabMaskSentinel_ClearAll(void) {
    /* No-op */
}
