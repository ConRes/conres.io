/**
 * @file color-engine-plugin.h
 * @brief Color Engine Transform Plugin for LittleCMS
 *
 * Full Transform Plugin (`cmsPluginTransformSig` / 'xfmH') that manages
 * the entire transform lifecycle in C, eliminating JavaScript-to-C lifecycle
 * leaks. Handles:
 *
 * - Lab Mask Sentinel detection and correction (passthrough or neutral black rewrite)
 * - Blackpoint Compensation Boundary Clamping optimization (SIMD, all bit depths)
 * - Cleanup of all per-transform state via _cmsFreeUserDataFn
 *
 * Chains with the existing K-Only GCR intent plugin via the Next pointer.
 *
 * @author Saleh Abdel Motaal <dev@smotaal.io>
 * @ai Claude Opus 4.6 (code generation)
 * @date 2026-02-11
 * @license GPL-3.0-or-later
 */

#ifndef COLOR_ENGINE_PLUGIN_H
#define COLOR_ENGINE_PLUGIN_H

#include "lcms2.h"
#include "lcms2_plugin.h"

#ifdef __cplusplus
extern "C" {
#endif

/**
 * Per-transform user data allocated by the factory and freed by LittleCMS
 * during cmsDeleteTransform. Replaces the static cache arrays in
 * blackpoint-compensation-clamping.c and lab-mask-sentinel.c.
 */
typedef struct {

    /* --- Lab Mask Sentinel state --- */

    cmsUInt8Number neutralBlackLabInput[32]; /**< Lab 0/0/0 in input format encoding */
    cmsUInt8Number sentinelLabOutput[32];    /**< Lab 0/-128/-128 in output format encoding */
    cmsUInt32Number outputColorBytes;        /**< Output color channels x bytes per sample */
    cmsUInt32Number outputTotalBytes;        /**< Output (color + extra) x bytes per sample */
    cmsUInt32Number inputTotalBytes;         /**< Input total bytes per pixel */
    cmsUInt32Number inputLabChannelBytes;    /**< Input Lab channel bytes (3 x bytes per sample) */
    cmsBool isLabInput;                      /**< TRUE if input color space is Lab (V4 or V2) */
    cmsBool isLabOutput;                     /**< TRUE if output color space is Lab (V4 or V2) */
    cmsBool isFloatInput;                    /**< TRUE if input format is floating-point */
    cmsBool isFloatOutput;                   /**< TRUE if output format is floating-point */

    /* --- Pipeline optimization state --- */

    cmsBool pipelineOptimized;               /**< TRUE after lazy _cmsOptimizePipeline call */

    /* --- Blackpoint Compensation Clamping state --- */

    cmsBool clampingEnabled;                 /**< TRUE if clamping flag was set */
    cmsBool clampingRegistered;              /**< TRUE after lazy RegisterTransform call */
    cmsUInt32Number inputChannels;           /**< Number of input color channels */
    cmsUInt32Number outputChannels;          /**< Number of output color channels */
    cmsUInt32Number inputBytesPerSample;     /**< 1 (8-bit), 2 (16-bit), 4 (Float32) */
    cmsUInt32Number outputBytesPerSample;    /**< 1 (8-bit), 2 (16-bit), 4 (Float32) */
    cmsUInt32Number inputBytesPerPixel;      /**< inputChannels * inputBytesPerSample */
    cmsUInt32Number outputBytesPerPixel;     /**< outputChannels * outputBytesPerSample */
    cmsUInt8Number minimumInput[32];         /**< Pre-computed minimum boundary reference (all-zero) */
    cmsUInt8Number maximumInput[32];         /**< Pre-computed maximum boundary reference (all-max) */
    cmsUInt8Number minimumOutput[32];        /**< Pre-computed transform output for minimum input */
    cmsUInt8Number maximumOutput[32];        /**< Pre-computed transform output for maximum input */

} ColorEngineTransformData;

/**
 * Register the Color Engine plugin package.
 *
 * Registers the Full Transform Plugin and the K-Only GCR Intent Plugin
 * as a single chained package via cmsPlugin(). Called automatically from
 * __attribute__((constructor)) before api-wrapper.js executes.
 *
 * @return cmsBool TRUE on success, FALSE on failure
 */
cmsBool ColorEnginePlugin_Register(void);

#ifdef __cplusplus
}
#endif

#endif /* COLOR_ENGINE_PLUGIN_H */
