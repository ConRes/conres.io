/**
 * @file color-engine-plugin.c
 * @brief Color Engine Transform Plugin for LittleCMS
 *
 * Full Transform Plugin that manages the entire transform lifecycle in C.
 * Eliminates JavaScript-to-C lifecycle leaks by handling create, execute,
 * and delete hooks natively via the LittleCMS plugin API.
 *
 * The factory fires for every cmsCreateTransform call. It:
 * - Allocates per-transform ColorEngineTransformData as UserData
 * - Initializes Lab Mask Sentinel state (format detection, precomputed values)
 * - Initializes Blackpoint Compensation Clamping state when the flag is set
 *   (format metadata, boundary pre-computation via pipeline evaluation)
 * - Sets the custom transform function and free callback
 *
 * The custom transform function replaces cmsDoTransform's internal dispatch:
 * - Handles Lab Mask Sentinel detection/correction
 * - Delegates to cmsDoTransform for the actual pixel processing
 *   (which re-enters our transform function, but we detect re-entry)
 *
 * Chains with the K-Only GCR intent plugin via the Next pointer.
 *
 * @author Saleh Abdel Motaal <dev@smotaal.io>
 * @ai Claude Opus 4.6 (code generation)
 * @date 2026-02-11
 * @license GPL-3.0-or-later
 */

#include <emscripten.h>

#include "lcms2_internal.h"
#include "lcms2_plugin.h"
#include "color-engine-plugin.h"
#include "blackpoint-compensation-clamping.h"
#include "lab-mask-sentinel.h"
#include <string.h>
#include <stdlib.h>

/* ========================================================================== */
/* Forward Declarations                                                        */
/* ========================================================================== */

static cmsBool ColorEngineTransformFactory(
    _cmsTransform2Fn* xform,
    void** UserData,
    _cmsFreeUserDataFn* FreePrivateDataFn,
    cmsPipeline** Lut,
    cmsUInt32Number* InputFormat,
    cmsUInt32Number* OutputFormat,
    cmsUInt32Number* dwFlags
);

static void ColorEngineDoTransform(
    struct _cmstransform_struct* CMMcargo,
    const void* InputBuffer,
    void* OutputBuffer,
    cmsUInt32Number PixelsPerLine,
    cmsUInt32Number LineCount,
    const cmsStride* Stride
);

static void ColorEngineFreeUserData(
    cmsContext ContextID,
    void* Data
);

/* ========================================================================== */
/* Plugin Package                                                              */
/* ========================================================================== */

/* Import the K-Only GCR intent plugin struct from k-only-gcr.c */
extern cmsPluginRenderingIntent KOnlyGCRIntentPlugin;

/**
 * Transform plugin descriptor.
 * Chained AFTER the intent plugin via KOnlyGCRIntentPlugin.base.Next.
 */
static cmsPluginTransform ColorEngineTransformPlugin = {
    .base = {
        .Magic = cmsPluginMagicNumber,
        .ExpectedVersion = 2080,  /* LittleCMS 2.8 — minimum for _cmsTransform2Factory */
        .Type = cmsPluginTransformSig,
        .Next = NULL
    },
    .factories.xform = ColorEngineTransformFactory
};

/* ========================================================================== */
/* Format Helpers                                                              */
/* ========================================================================== */

static inline cmsBool isLabColorSpace(cmsUInt32Number colorSpace) {
    return colorSpace == PT_Lab || colorSpace == PT_LabV2;
}

static inline cmsUInt32Number getBytesPerSample(cmsUInt32Number format) {
    cmsUInt32Number bytes = T_BYTES(format);
    return bytes == 0 ? 8 : bytes;
}

/* ========================================================================== */
/* Factory                                                                     */
/* ========================================================================== */

/**
 * Transform factory callback invoked by LittleCMS during AllocEmptyTransform.
 *
 * Accepts ALL transforms — Lab Mask Sentinel wraps all transforms because
 * it lazily detects Lab input. Clamping is only initialized when the
 * cmsFLAGS_BLACKPOINTCOMPENSATION_CLAMPING flag (0x80000000) is set.
 *
 * Returns TRUE always (accepts every transform).
 */
static cmsBool ColorEngineTransformFactory(
    _cmsTransform2Fn* xform,
    void** UserData,
    _cmsFreeUserDataFn* FreePrivateDataFn,
    cmsPipeline** Lut,
    cmsUInt32Number* InputFormat,
    cmsUInt32Number* OutputFormat,
    cmsUInt32Number* dwFlags
) {
    ColorEngineTransformData* data =
        (ColorEngineTransformData*)calloc(1, sizeof(ColorEngineTransformData));

    if (data == NULL) {
        return FALSE;
    }

    /* --- Initialize Lab Mask Sentinel state --- */

    cmsUInt32Number inputFormat = *InputFormat;
    cmsUInt32Number outputFormat = *OutputFormat;

    cmsUInt32Number inputColorSpace = T_COLORSPACE(inputFormat);
    cmsUInt32Number outputColorSpace = T_COLORSPACE(outputFormat);

    data->isLabInput = isLabColorSpace(inputColorSpace);
    data->isLabOutput = isLabColorSpace(outputColorSpace);
    data->isFloatInput = T_FLOAT(inputFormat);
    data->isFloatOutput = T_FLOAT(outputFormat);

    cmsUInt32Number inputBytesPerSample = getBytesPerSample(inputFormat);
    cmsUInt32Number outputBytesPerSample = getBytesPerSample(outputFormat);

    cmsUInt32Number inputChannels = T_CHANNELS(inputFormat);
    cmsUInt32Number inputExtra = T_EXTRA(inputFormat);
    cmsUInt32Number outputChannels = T_CHANNELS(outputFormat);
    cmsUInt32Number outputExtra = T_EXTRA(outputFormat);

    data->inputTotalBytes = (inputChannels + inputExtra) * inputBytesPerSample;
    data->inputLabChannelBytes = 3 * inputBytesPerSample;
    data->outputColorBytes = outputChannels * outputBytesPerSample;
    data->outputTotalBytes = (outputChannels + outputExtra) * outputBytesPerSample;

    /*
     * Precompute neutralBlackLabInput: Lab 0/0/0 in input format encoding.
     * Used by Lab->non-Lab path to rewrite sentinels in the input buffer.
     */
    memset(data->neutralBlackLabInput, 0, sizeof(data->neutralBlackLabInput));

    if (data->isLabInput) {
        if (data->isFloatInput) {
            /* Float32: [0.0, 0.0, 0.0] — already zero from calloc */
        } else if (inputBytesPerSample == 1) {
            data->neutralBlackLabInput[0] = 0;
            data->neutralBlackLabInput[1] = 128;
            data->neutralBlackLabInput[2] = 128;
        } else if (inputBytesPerSample == 2) {
            cmsUInt16Number* input16 = (cmsUInt16Number*)data->neutralBlackLabInput;
            input16[0] = 0;
            if (inputColorSpace == PT_LabV2) {
                input16[1] = 0x8000;
                input16[2] = 0x8000;
            } else {
                input16[1] = 0x8080;
                input16[2] = 0x8080;
            }
        }
    }

    /*
     * Precompute sentinelLabOutput: Lab 0/-128/-128 in output format encoding.
     * Used by Lab->Lab path to write sentinel back to output after transform.
     */
    memset(data->sentinelLabOutput, 0, sizeof(data->sentinelLabOutput));

    if (data->isLabInput && data->isLabOutput) {
        if (data->isFloatOutput) {
            cmsFloat32Number* floatOutput = (cmsFloat32Number*)data->sentinelLabOutput;
            floatOutput[0] = 0.0f;
            floatOutput[1] = -128.0f;
            floatOutput[2] = -128.0f;
        }
        /* Integer Lab: sentinel is all-zero bytes — already from calloc */
    }

    /* --- Initialize Blackpoint Compensation Clamping state --- */

    data->clampingEnabled = (*dwFlags & 0x80000000) != 0;  /* cmsFLAGS_BLACKPOINTCOMPENSATION_CLAMPING */

    data->inputChannels = inputChannels + inputExtra;
    data->outputChannels = outputChannels + outputExtra;
    data->inputBytesPerSample = inputBytesPerSample;
    data->outputBytesPerSample = outputBytesPerSample;
    data->inputBytesPerPixel = data->inputChannels * inputBytesPerSample;
    data->outputBytesPerPixel = data->outputChannels * outputBytesPerSample;

    if (data->clampingEnabled && *Lut != NULL) {
        /*
         * Construct minimumInput: all-zero bytes.
         * Data-range minimum for all encodings.
         */
        memset(data->minimumInput, 0, 32);

        /*
         * Construct maximumInput: all channels at maximum encodable value.
         */
        memset(data->maximumInput, 0, 32);

        if (data->isFloatInput) {
            /* Float32: maximum is 1.0f per channel */
            cmsFloat32Number one = 1.0f;
            for (cmsUInt32Number i = 0; i < data->inputChannels; i++) {
                memcpy(data->maximumInput + i * sizeof(cmsFloat32Number),
                       &one, sizeof(cmsFloat32Number));
            }
        } else if (inputBytesPerSample == 2) {
            /* 16-bit: maximum is 0xFFFF per channel */
            cmsUInt16Number maxValue = 0xFFFF;
            for (cmsUInt32Number i = 0; i < data->inputChannels; i++) {
                memcpy(data->maximumInput + i * sizeof(cmsUInt16Number),
                       &maxValue, sizeof(cmsUInt16Number));
            }
        } else {
            /* 8-bit: maximum is 0xFF per channel byte */
            memset(data->maximumInput, 255, data->inputBytesPerPixel);
        }

        /*
         * Pre-compute boundary outputs using the pipeline directly.
         *
         * The factory receives the Lut pipeline which is already optimized
         * (cmsxform.c:915). We evaluate it to get boundary outputs.
         *
         * For float pipelines, use cmsPipelineEvalFloat.
         * For integer pipelines, use cmsPipelineEval16.
         * Then pack the result using format knowledge.
         *
         * However: the formatters are NOT available at factory time
         * (cmsxform.c:897-900 — set after factory returns). So we evaluate
         * the pipeline in its internal representation (float or 16-bit)
         * and then construct the output bytes manually.
         *
         * Simpler approach: we store the pipeline pointer and defer boundary
         * pre-computation to the first doTransform call, where the full
         * transform is available. This avoids duplicating the formatter logic.
         *
         * Even simpler: just call cmsDoTransform on the fully-constructed
         * transform after the factory returns. But the factory fires DURING
         * AllocEmptyTransform — the transform is not fully constructed yet.
         *
         * Best approach: register the transform for clamping AFTER factory
         * returns, from the JavaScript wrapper's createTransform. The factory
         * sets clampingEnabled=TRUE and stores format metadata. The JS wrapper
         * calls BlackpointCompensationClamping_RegisterTransform which uses
         * cmsDoTransform on the complete transform.
         *
         * UPDATE: We can actually use the pipeline directly. The pipeline
         * evaluates in its internal representation. For boundary values:
         * - minimumInput in pipeline-internal float: all 0.0
         * - maximumInput in pipeline-internal float: all 1.0
         * (LittleCMS normalizes all integer encodings to 0.0-1.0 internally)
         *
         * Then pack the float result to the output format bytes.
         */

        /* Use pipeline evaluation for boundary pre-computation */
        cmsFloat32Number pipelineInput[cmsMAXCHANNELS];
        cmsFloat32Number pipelineOutput[cmsMAXCHANNELS];

        memset(pipelineInput, 0, sizeof(pipelineInput));
        memset(pipelineOutput, 0, sizeof(pipelineOutput));

        /* Minimum boundary: all channels = 0.0 in pipeline space */
        cmsPipelineEvalFloat(pipelineInput, pipelineOutput, *Lut);

        /* Pack minimum output to format bytes */
        memset(data->minimumOutput, 0, 32);
        if (data->isFloatOutput) {
            for (cmsUInt32Number i = 0; i < data->outputChannels; i++) {
                cmsFloat32Number value = pipelineOutput[i];
                memcpy(data->minimumOutput + i * sizeof(cmsFloat32Number),
                       &value, sizeof(cmsFloat32Number));
            }
        } else if (outputBytesPerSample == 2) {
            cmsUInt16Number* output16 = (cmsUInt16Number*)data->minimumOutput;
            for (cmsUInt32Number i = 0; i < data->outputChannels; i++) {
                /* Pipeline float to 16-bit: clamp to [0,1] then scale to 0xFFFF */
                cmsFloat32Number clamped = pipelineOutput[i];
                if (clamped < 0.0f) clamped = 0.0f;
                if (clamped > 1.0f) clamped = 1.0f;
                output16[i] = (cmsUInt16Number)(clamped * 65535.0f + 0.5f);
            }
        } else {
            /* 8-bit */
            for (cmsUInt32Number i = 0; i < data->outputChannels; i++) {
                cmsFloat32Number clamped = pipelineOutput[i];
                if (clamped < 0.0f) clamped = 0.0f;
                if (clamped > 1.0f) clamped = 1.0f;
                data->minimumOutput[i] = (cmsUInt8Number)(clamped * 255.0f + 0.5f);
            }
        }

        /* Maximum boundary: all channels = 1.0 in pipeline space */
        for (cmsUInt32Number i = 0; i < cmsMAXCHANNELS; i++) {
            pipelineInput[i] = 1.0f;
        }
        memset(pipelineOutput, 0, sizeof(pipelineOutput));
        cmsPipelineEvalFloat(pipelineInput, pipelineOutput, *Lut);

        /* Pack maximum output to format bytes */
        memset(data->maximumOutput, 0, 32);
        if (data->isFloatOutput) {
            for (cmsUInt32Number i = 0; i < data->outputChannels; i++) {
                cmsFloat32Number value = pipelineOutput[i];
                memcpy(data->maximumOutput + i * sizeof(cmsFloat32Number),
                       &value, sizeof(cmsFloat32Number));
            }
        } else if (outputBytesPerSample == 2) {
            cmsUInt16Number* output16 = (cmsUInt16Number*)data->maximumOutput;
            for (cmsUInt32Number i = 0; i < data->outputChannels; i++) {
                cmsFloat32Number clamped = pipelineOutput[i];
                if (clamped < 0.0f) clamped = 0.0f;
                if (clamped > 1.0f) clamped = 1.0f;
                output16[i] = (cmsUInt16Number)(clamped * 65535.0f + 0.5f);
            }
        } else {
            for (cmsUInt32Number i = 0; i < data->outputChannels; i++) {
                cmsFloat32Number clamped = pipelineOutput[i];
                if (clamped < 0.0f) clamped = 0.0f;
                if (clamped > 1.0f) clamped = 1.0f;
                data->maximumOutput[i] = (cmsUInt8Number)(clamped * 255.0f + 0.5f);
            }
        }
    }

    /* Set plugin outputs */
    *xform = ColorEngineDoTransform;
    *UserData = data;
    *FreePrivateDataFn = ColorEngineFreeUserData;

    return TRUE;
}

/* ========================================================================== */
/* Transform Function                                                          */
/* ========================================================================== */

/**
 * Custom transform function that replaces cmsDoTransform's internal dispatch.
 *
 * Handles:
 * 1. Lab Mask Sentinel detection and correction
 * 2. Delegates to the default LittleCMS pipeline evaluation for pixel processing
 *
 * Note: Blackpoint Compensation Clamping is handled by the existing
 * BlackpointCompensationClamping_DoTransformAdaptive/DoTransform functions
 * which are chained from LabMaskSentinel_DoTransform. With the plugin,
 * we continue to use cmsDoTransform internally for the actual pixel work
 * (which re-enters this function). We detect re-entry via a thread-local
 * flag to avoid infinite recursion.
 *
 * DESIGN NOTE: The simplest correct approach is to use this transform function
 * as the entry point that delegates to LabMaskSentinel_DoTransform, which
 * chains to BlackpointCompensationClamping_DoTransformAdaptive, which chains
 * to cmsDoTransform for the actual pipeline evaluation.
 *
 * However, this creates a recursion issue: cmsDoTransform calls p->xform
 * (which is THIS function). To break the recursion, we use a re-entry guard.
 * On re-entry, we call the default pipeline evaluation directly.
 */

/* Re-entry guard — safe for single-threaded WASM */
static cmsBool g_inColorEngineTransform = FALSE;

static void ColorEngineDoTransform(
    struct _cmstransform_struct* CMMcargo,
    const void* InputBuffer,
    void* OutputBuffer,
    cmsUInt32Number PixelsPerLine,
    cmsUInt32Number LineCount,
    const cmsStride* Stride
) {
    /* Re-entry guard: if we're already in our transform, do default evaluation */
    if (g_inColorEngineTransform) {
        /* Default pipeline evaluation — same as LittleCMS FloatXFORM/PrecalculatedXFORM */
        cmsUInt32Number inputFormat = CMMcargo->InputFormat;

        if (T_FLOAT(inputFormat)) {
            /* Float path */
            cmsFormatterFloat fromInput, toOutput;
            _cmsGetTransformFormattersFloat(CMMcargo, &fromInput, &toOutput);

            cmsFloat32Number fIn[cmsMAXCHANNELS], fOut[cmsMAXCHANNELS];
            memset(fIn, 0, sizeof(fIn));
            memset(fOut, 0, sizeof(fOut));

            cmsUInt8Number* accum = (cmsUInt8Number*)InputBuffer;
            cmsUInt8Number* output = (cmsUInt8Number*)OutputBuffer;
            size_t strideIn = 0;
            size_t strideOut = 0;

            for (cmsUInt32Number line = 0; line < LineCount; line++) {
                cmsUInt8Number* lineAccum = accum + strideIn;
                cmsUInt8Number* lineOutput = output + strideOut;

                for (cmsUInt32Number pixel = 0; pixel < PixelsPerLine; pixel++) {
                    lineAccum = fromInput(CMMcargo, fIn, lineAccum, Stride->BytesPerPlaneIn);
                    cmsPipelineEvalFloat(fIn, fOut, CMMcargo->Lut);
                    lineOutput = toOutput(CMMcargo, fOut, lineOutput, Stride->BytesPerPlaneOut);
                }

                strideIn += Stride->BytesPerLineIn;
                strideOut += Stride->BytesPerLineOut;
            }
        } else {
            /* 16-bit path */
            cmsFormatter16 fromInput, toOutput;
            _cmsGetTransformFormatters16(CMMcargo, &fromInput, &toOutput);

            cmsUInt16Number wIn[cmsMAXCHANNELS], wOut[cmsMAXCHANNELS];
            memset(wIn, 0, sizeof(wIn));
            memset(wOut, 0, sizeof(wOut));

            cmsUInt8Number* accum = (cmsUInt8Number*)InputBuffer;
            cmsUInt8Number* output = (cmsUInt8Number*)OutputBuffer;
            size_t strideIn = 0;
            size_t strideOut = 0;

            for (cmsUInt32Number line = 0; line < LineCount; line++) {
                cmsUInt8Number* lineAccum = accum + strideIn;
                cmsUInt8Number* lineOutput = output + strideOut;

                for (cmsUInt32Number pixel = 0; pixel < PixelsPerLine; pixel++) {
                    lineAccum = fromInput(CMMcargo, wIn, lineAccum, Stride->BytesPerPlaneIn);
                    CMMcargo->Lut->Eval16Fn(wIn, wOut, CMMcargo->Lut->Data);
                    lineOutput = toOutput(CMMcargo, wOut, lineOutput, Stride->BytesPerPlaneOut);
                }

                strideIn += Stride->BytesPerLineIn;
                strideOut += Stride->BytesPerLineOut;
            }
        }
        return;
    }

    /* First entry — handle sentinel + clamping, then delegate to cmsDoTransform */
    g_inColorEngineTransform = TRUE;

    ColorEngineTransformData* data =
        (ColorEngineTransformData*)_cmsGetTransformUserData(CMMcargo);

    /*
     * Lazy pipeline optimization: the plugin factory returns TRUE before
     * _cmsOptimizePipeline runs (cmsxform.c:909 returns before line 915).
     * Without optimization, the pipeline produces different numerical results
     * (rounding differences, missing white-point fixup). Optimize on first
     * call where we have access to CMMcargo->RenderingIntent.
     *
     * _cmsOptimizePipeline does NOT call cmsDoTransform internally — it
     * evaluates the pipeline directly via cmsPipelineEvalFloat and
     * cmsStageSampleCLut16bit — so no re-entry risk.
     */
    if (data != NULL && !data->pipelineOptimized) {
        cmsUInt32Number inputFormat = CMMcargo->InputFormat;
        cmsUInt32Number outputFormat = CMMcargo->OutputFormat;
        cmsUInt32Number flags = CMMcargo->dwOriginalFlags;

        _cmsOptimizePipeline(
            CMMcargo->ContextID,
            &CMMcargo->Lut,
            CMMcargo->RenderingIntent,
            &inputFormat,
            &outputFormat,
            &flags
        );

        data->pipelineOptimized = TRUE;
    }

    /*
     * Lazy clamping registration: populate the static cache in
     * blackpoint-compensation-clamping.c on first call. RegisterTransform
     * internally calls cmsDoTransform to pre-compute boundary outputs,
     * which re-enters this function — but the re-entry guard is set,
     * so it hits the direct pipeline evaluation path above.
     */
    if (data != NULL && data->clampingEnabled && !data->clampingRegistered) {
        BlackpointCompensationClamping_RegisterTransform((cmsHTRANSFORM)CMMcargo);
        data->clampingRegistered = TRUE;
    }

    /*
     * Call LabMaskSentinel_DoTransform which handles:
     * 1. Lab sentinel detection/correction (if Lab input)
     * 2. Chains to BlackpointCompensationClamping_DoTransformAdaptive
     * 3. Which chains to cmsDoTransform for actual pipeline evaluation
     *    (re-enters this function with g_inColorEngineTransform = TRUE,
     *     hitting the default evaluation path above)
     *
     * For the simple case (PixelsPerLine * LineCount pixels, LineCount=1),
     * cmsDoTransform passes Size=PixelsPerLine, LineCount=1.
     */
    LabMaskSentinel_DoTransform(
        (cmsHTRANSFORM)CMMcargo,
        InputBuffer,
        OutputBuffer,
        PixelsPerLine * LineCount
    );

    g_inColorEngineTransform = FALSE;
}

/* ========================================================================== */
/* Cleanup                                                                     */
/* ========================================================================== */

static void ColorEngineFreeUserData(
    cmsContext ContextID,
    void* Data
) {
    (void)ContextID;  /* Unused */
    if (Data != NULL) {
        free(Data);
    }
}

/* ========================================================================== */
/* Registration                                                                */
/* ========================================================================== */

/**
 * Register the Color Engine plugin package.
 *
 * Chains: KOnlyGCRIntentPlugin -> ColorEngineTransformPlugin
 * Single cmsPlugin() call registers both.
 */
EMSCRIPTEN_KEEPALIVE
cmsBool ColorEnginePlugin_Register(void) {
    /* Chain: intent plugin -> transform plugin */
    KOnlyGCRIntentPlugin.base.Next = (cmsPluginBase*)&ColorEngineTransformPlugin;

    /* Register the entire chain */
    return cmsPlugin(&KOnlyGCRIntentPlugin);
}

/* Auto-register on module load (runs before api-wrapper.js) */
__attribute__((constructor))
static void ColorEnginePlugin_AutoRegister(void) {
    ColorEnginePlugin_Register();
}
