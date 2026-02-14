/**
 * @file k-only-gcr.c
 * @brief K-Only Black Point Compensation with Gray Component Replacement
 *
 * Full C implementation of K-Only BPC+GCR algorithm
 * Ported from JavaScript prototype in packages/js-color-engine/src/transform.js
 *
 * @author Saleh Abdel Motaal
 * @date 2025-11-19
 * @license GPL-3.0-or-later
 */

// Include Emscripten header for KEEPALIVE annotation
#include <emscripten.h>

// Include internal Little-CMS header for access to internal APIs
#include "lcms2_internal.h"
#include "lcms2_plugin.h"  // For plugin system (cmsPluginRenderingIntent)
#include "k-only-gcr.h"
#include <math.h>
#include <string.h>

// Global debugging flag for K-Only parity investigation (disabled)
#define K_ONLY_PARITY_DEBUGGING 0

// Structure for shadow curve points
typedef struct {
    cmsFloat64Number x;
    cmsFloat64Number y;
} ShadowPoint;

/**
 * Quadratic curve fitting using least squares method
 * Fits y = tx^2 + ux + c to the given points
 * 
 * @param points Array of {x, y} points
 * @param numPoints Number of points
 * @param t Output: quadratic coefficient
 * @param u Output: linear coefficient
 * @param c Output: constant term
 * @return 1 on success, 0 on failure (singular matrix)
 */
static int FitQuadraticCurve(
    const ShadowPoint *points,
    int numPoints,
    cmsFloat64Number *t,
    cmsFloat64Number *u,
    cmsFloat64Number *c)
{
    if (numPoints < 3) return 0;

    // Compute sums for least squares fitting
    cmsFloat64Number sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
    cmsFloat64Number sumX3 = 0, sumX4 = 0, sumX2Y = 0;

    for (int i = 0; i < numPoints; i++) {
        cmsFloat64Number x = points[i].x;
        cmsFloat64Number y = points[i].y;
        cmsFloat64Number x2 = x * x;
        cmsFloat64Number x3 = x2 * x;
        cmsFloat64Number x4 = x3 * x;

        sumX += x;
        sumY += y;
        sumXY += x * y;
        sumX2 += x2;
        sumX3 += x3;
        sumX4 += x4;
        sumX2Y += x2 * y;
    }

    // Build coefficient matrix A and constant vector b
    // A * [t; u; c] = b, where A is:
    // [sumX4  sumX3  sumX2]
    // [sumX3  sumX2  sumX ]
    // [sumX2  sumX   n    ]
    cmsFloat64Number n = (cmsFloat64Number)numPoints;

    // Compute determinant of A using Cramer's rule
    cmsFloat64Number detA = 
        sumX4 * (sumX2 * n - sumX * sumX) -
        sumX3 * (sumX3 * n - sumX * sumX2) +
        sumX2 * (sumX3 * sumX - sumX2 * sumX2);

    if (fabs(detA) < 1e-12) return 0; // Singular matrix

    // Solve using Cramer's rule: replace columns and compute determinants
    cmsFloat64Number detT = 
        sumX2Y * (sumX2 * n - sumX * sumX) -
        sumX3 * (sumXY * n - sumX * sumY) +
        sumX2 * (sumXY * sumX - sumX2 * sumY);

    cmsFloat64Number detU = 
        sumX4 * (sumXY * n - sumX * sumY) -
        sumX2Y * (sumX3 * n - sumX * sumX2) +
        sumX2 * (sumX3 * sumY - sumX2 * sumXY);

    cmsFloat64Number detC = 
        sumX4 * (sumX2 * sumY - sumX * sumXY) -
        sumX3 * (sumX3 * sumY - sumXY * sumX2) +
        sumX2Y * (sumX3 * sumX - sumX2 * sumX2);

    *t = detT / detA;
    *u = detU / detA;
    *c = detC / detA;

    return 1;
}

/**
 * Estimate blackpoint using shadow curve analysis
 * Implements the algorithm from blackpoint-estimation.js (R2 version)
 * 
 * This performs quadratic curve fitting on the shadow section of the L* curve
 * to find where the extrapolated curve would intersect L*=0.
 * 
 * @param hLab2CMYK Transform for Lab → CMYK (with BPC)
 * @param hCMYK2Lab Transform for CMYK → Lab (without BPC)
 * @param intent Rendering intent ("relative" or other)
 * @param estimatedBlackpoint Output: estimated blackpoint Lab
 * @return 1 on success, 0 on failure
 */
static int EstimateBlackpointWithShadowAnalysis(
    cmsHTRANSFORM hLab2CMYK,
    cmsHTRANSFORM hCMYK2Lab,
    const char *intent,
    cmsCIELab *estimatedBlackpoint)
{
    // Step 1: Get L*K (L* at input L*=0) and L*W (L* at input L*=100)
    // This requires round-trip: Lab → CMYK → Lab (the "BT" function in JS)
    cmsFloat64Number lK, lW;
    {
        cmsCIELab inputLab, outputLab;
        cmsFloat64Number cmyk[4];
        inputLab.a = inputLab.b = 0;

        // L*=0 round-trip
        inputLab.L = 0;
        cmsDoTransform(hLab2CMYK, &inputLab, cmyk, 1);
        cmsDoTransform(hCMYK2Lab, cmyk, &outputLab, 1);
        lK = outputLab.L;

        // L*=100 round-trip
        inputLab.L = 100;
        cmsDoTransform(hLab2CMYK, &inputLab, cmyk, 1);
        cmsDoTransform(hCMYK2Lab, cmyk, &outputLab, 1);
        lW = outputLab.L;
    }

    // Validate range
    if (fabs(lW - lK) < 0.001) {
        // Range too small, signal failure
        return 0;
    }

    // Step 2 & 3: Collect shadow section points
    // Shadow range: 0.1 ≤ y < 0.5 for relative, 0.03 ≤ y < 0.25 for others
    cmsFloat64Number shadowMin = (strcmp(intent, "relative") == 0) ? 0.1 : 0.03;
    cmsFloat64Number shadowMax = (strcmp(intent, "relative") == 0) ? 0.5 : 0.25;

    ShadowPoint shadowPoints[101];
    int shadowCount = 0;

    #if K_ONLY_PARITY_DEBUGGING
    fprintf(stderr, "[C Shadow Analysis] Step 1: L*K = %.6f, L*W = %.6f\n", lK, lW);
    fprintf(stderr, "[C Shadow Analysis] Step 2-3: Shadow range %.2f ≤ y < %.2f\n", shadowMin, shadowMax);
    #endif

    for (int inputL = 0; inputL <= 100; inputL++) {
        cmsCIELab inputLab, outputLab;
        cmsFloat64Number cmyk[4];
        inputLab.L = (cmsFloat64Number)inputL;
        inputLab.a = inputLab.b = 0;

        // Round-trip: Lab → CMYK → Lab
        cmsDoTransform(hLab2CMYK, &inputLab, cmyk, 1);
        cmsDoTransform(hCMYK2Lab, cmyk, &outputLab, 1);

        cmsFloat64Number y = (outputLab.L - lK) / (lW - lK);

        #if K_ONLY_PARITY_DEBUGGING
        if (inputL <= 5 || (inputL >= 10 && inputL <= 15) || inputL == 50 || inputL == 100) {
            fprintf(stderr, "[C Shadow Analysis]   L=%d: convertedL=%.6f, y=%.6f%s\n", 
                    inputL, outputLab.L, y, 
                    (y >= shadowMin && y < shadowMax) ? " [IN SHADOW]" : "");
        }
        #endif

        if (y >= shadowMin && y < shadowMax && shadowCount < 101) {
            shadowPoints[shadowCount].x = (cmsFloat64Number)inputL;
            shadowPoints[shadowCount].y = y;
            shadowCount++;
        }
    }

    #if K_ONLY_PARITY_DEBUGGING
    fprintf(stderr, "[C Shadow Analysis] Found %d points in shadow section\n", shadowCount);
    if (shadowCount > 0) {
        fprintf(stderr, "[C Shadow Analysis] First 5 shadow points:\n");
        for (int i = 0; i < shadowCount && i < 5; i++) {
            fprintf(stderr, "    x=%.1f, y=%.6f\n", shadowPoints[i].x, shadowPoints[i].y);
        }
    }
    #endif

    if (shadowCount < 3) {
        // Not enough points, signal failure (caller will use initial estimate)
        return 0;
    }

    // Step 4: Fit quadratic curve
    cmsFloat64Number t, u, c;
    if (!FitQuadraticCurve(shadowPoints, shadowCount, &t, &u, &c)) {
        // Fitting failed, signal failure
        return 0;
    }

    // Step 5: Compute vertex x-coordinate: x = -u / (2t)
    // This matches JS implementation in blackpoint-estimation.js line 511
    if (fabs(t) < 1e-10) {
        #if K_ONLY_PARITY_DEBUGGING
        fprintf(stderr, "[C Shadow Analysis] Step 5: t too small (%.10f), curve is linear\n", t);
        #endif
        // Nearly linear, signal failure
        return 0;
    }

    cmsFloat64Number vertexX = -u / (2.0 * t);

    #if K_ONLY_PARITY_DEBUGGING
    fprintf(stderr, "[C Shadow Analysis] Step 4: Quadratic coefficients: t=%.10f, u=%.10f, c=%.10f\n", t, u, c);
    fprintf(stderr, "[C Shadow Analysis] Step 5: Vertex X = -%.10f / (2 * %.10f) = %.6f\n", u, t, vertexX);
    
    // Show fitted curve evaluation for first few points
    fprintf(stderr, "[C Shadow Analysis] Fitted curve evaluation:\n");
    for (int i = 0; i < shadowCount && i < 5; i++) {
        cmsFloat64Number fittedY = t * shadowPoints[i].x * shadowPoints[i].x + u * shadowPoints[i].x + c;
        fprintf(stderr, "    x=%.1f, actual y=%.6f, fitted y=%.6f, diff=%.6f\n",
                shadowPoints[i].x, shadowPoints[i].y, fittedY, fabs(shadowPoints[i].y - fittedY));
    }
    #endif

    // Clamp to reasonable range (matches JS line 538)
    cmsFloat64Number originalVertexX = vertexX;
    if (vertexX < 0) vertexX = 0;
    if (vertexX > 100) vertexX = 100;

    #if K_ONLY_PARITY_DEBUGGING
    if (originalVertexX != vertexX) {
        fprintf(stderr, "[C Shadow Analysis] Clamped vertex from %.6f to %.6f\n", originalVertexX, vertexX);
    }
    fprintf(stderr, "[C Shadow Analysis] Final blackpoint L* = %.6f\n\n", vertexX);
    #endif

    estimatedBlackpoint->L = vertexX;
    estimatedBlackpoint->a = 0;
    estimatedBlackpoint->b = 0;

    return 1;
}

/**
 * Calculate K-Only BPC scale factor
 *
 * Compares the luminance (Y) of CMYK(100,100,100,100) vs CMYK(0,0,0,100)
 * to determine how much L* compression is needed for K-Only black preservation.
 *
 * Reference:
 *  - documentation/Porting-to-Little-CMS.md Phase 3
 *  - transform.js create3DDeviceLUT_KOnly() lines 1044-1446 (BPC computation)
 *  - Specifically line 1423: estimatedKOnlyBlackpointCompensationScale calculation
 */
cmsFloat64Number ComputeKOnlyBPCScale(
    cmsContext ContextID,
    cmsHPROFILE hOutputProfile,
    cmsUInt32Number Intent,
    cmsCIELab* outKOnlyBlackpointLab)
{
    cmsHTRANSFORM hLab2CMYK = NULL;
    cmsHTRANSFORM hCMYK2Lab = NULL;
    cmsHPROFILE hLabProfile = NULL;

    cmsCIELab blackLab, kOnlyBlackLab;
    cmsCIELab estimatedBlackpointLab, estimatedKOnlyBlackpointLab;
    cmsCIEXYZ blackXYZ, kOnlyBlackXYZ;
    cmsFloat64Number scale;

    // Create Lab D50 profile for transform
    hLabProfile = cmsCreateLab4ProfileTHR(ContextID, NULL);
    if (!hLabProfile) {
        return 1.0; // Fallback: no scaling
    }

    // Create transforms using RELATIVE_COLORIMETRIC intent
    // (not the passed Intent, which might be our K-Only GCR intent causing recursion)
    cmsUInt32Number internalIntent = INTENT_RELATIVE_COLORIMETRIC;

    // Transforms for non-linearity check (bt = Lab → relativeLab2CMYK → relativeCMYK2Lab → Lab)
    // JS uses userIntentLab2CMYK (=relativeLab2CMYK for relative intent) and relativeCMYK2Lab
    // Both are RELATIVE intent WITH BPC enabled (JS applies BPC via createPipeline_BlackPointCompensation)
    // CONFIRMED via testing: JS with BPC:true creates 8 pipeline stages vs 6 without BPC
    hLab2CMYK = cmsCreateTransformTHR(
        ContextID,
        hLabProfile, TYPE_Lab_DBL,
        hOutputProfile, TYPE_CMYK_DBL,
        INTENT_RELATIVE_COLORIMETRIC,
        cmsFLAGS_NOCACHE | cmsFLAGS_BLACKPOINTCOMPENSATION
    );

    hCMYK2Lab = cmsCreateTransformTHR(
        ContextID,
        hOutputProfile, TYPE_CMYK_DBL,
        hLabProfile, TYPE_Lab_DBL,
        INTENT_RELATIVE_COLORIMETRIC,
        cmsFLAGS_NOCACHE | cmsFLAGS_BLACKPOINTCOMPENSATION
    );

    if (!hLab2CMYK || !hCMYK2Lab) {
        if (hLab2CMYK) cmsDeleteTransform(hLab2CMYK);
        if (hCMYK2Lab) cmsDeleteTransform(hCMYK2Lab);
        cmsCloseProfile(hLabProfile);
        return 1.0; // Fallback: no scaling
    }

    // 1. Estimate blackpoint for standard CMYK(100,100,100,100)
    // Matches JS: calculateDestinationBlackpoint(estimateBlackpoint(...), bt, 'relative')
    {
        cmsCIELab initialBlackpoint;
        cmsFloat64Number cmyk[4];

        // Step 1a: Get initial blackpoint estimate
        // JS passes cmykColor(100, 100, 100, 100) as localBlack to estimateBlackpoint()
        // So localBlack is already CMYK(100,100,100,100), skipping perceptual Lab→CMYK
        // estimatedBlackpointLab = relativeCMYK2LabTransform.forward(localBlack)
        cmyk[0] = cmyk[1] = cmyk[2] = cmyk[3] = 100.0;
        
        #if K_ONLY_PARITY_DEBUGGING
        fprintf(stderr, "[C Initial Blackpoint] Using CMYK(100, 100, 100, 100) as localBlack\n");
        #endif
        
        cmsDoTransform(hCMYK2Lab, cmyk, &initialBlackpoint, 1);
        initialBlackpoint.a = 0.0;
        initialBlackpoint.b = 0.0;

        #if K_ONLY_PARITY_DEBUGGING
        fprintf(stderr, "[C Initial Blackpoint] CMYK(100,100,100,100) → Relative+BPC → Lab(%.6f, %.6f, %.6f)\n", 
                initialBlackpoint.L, initialBlackpoint.a, initialBlackpoint.b);
        #endif

        // Step 1b: Check if curve is non-linear (calculateDestinationBlackpoint logic)
        // If curve is nearly straight, use initialBlackpoint directly
        // Otherwise, apply shadow analysis
        cmsCIELab lab0, lab100, labTest;
        cmsFloat64Number cmykTest[4];
        
        blackLab.L = 0;
        blackLab.a = blackLab.b = 0;
        cmsDoTransform(hLab2CMYK, &blackLab, cmykTest, 1);
        cmsDoTransform(hCMYK2Lab, cmykTest, &lab0, 1);
        
        blackLab.L = 100;
        cmsDoTransform(hLab2CMYK, &blackLab, cmykTest, 1);
        cmsDoTransform(hCMYK2Lab, cmykTest, &lab100, 1);

        cmsFloat64Number lMin = lab0.L;
        cmsFloat64Number lMax = lab100.L;
        cmsFloat64Number threshold = lMin + 0.2 * (lMax - lMin);
        cmsBool needsShadowAnalysis = FALSE;

        #if K_ONLY_PARITY_DEBUGGING
        fprintf(stderr, "[C Non-linearity Check] lMin=%.6f, lMax=%.6f, threshold=%.6f\n", lMin, lMax, threshold);
        #endif

        // Check for non-linearity: if any point has L*BT > (L*Min + 0.2*(L*Max - L*Min)) AND abs(L*BT - L) > 4
        for (int l = 0; l <= 100 && !needsShadowAnalysis; l++) {
            blackLab.L = (cmsFloat64Number)l;
            blackLab.a = blackLab.b = 0;
            cmsDoTransform(hLab2CMYK, &blackLab, cmykTest, 1);
            cmsDoTransform(hCMYK2Lab, cmykTest, &labTest, 1);
            
            cmsFloat64Number diff = fabs(labTest.L - l);
            if (labTest.L > threshold && diff > 4.0) {
                #if K_ONLY_PARITY_DEBUGGING
                fprintf(stderr, "[C Non-linearity Check] Triggered at L=%d: labTest.L=%.6f > %.6f, diff=%.6f > 4.0\n", 
                        l, labTest.L, threshold, diff);
                #endif
                needsShadowAnalysis = TRUE;
            }
        }

        #if K_ONLY_PARITY_DEBUGGING
        fprintf(stderr, "[C Non-linearity Check] Result: %s\n", needsShadowAnalysis ? "SHADOW ANALYSIS" : "DIRECT ESTIMATE");
        #endif

        if (needsShadowAnalysis) {
            // Apply shadow analysis starting from initialBlackpoint
            // Pass initialBlackpoint as the base Lab value for the shadow analysis
            estimatedBlackpointLab = initialBlackpoint; // Start with initial estimate
            if (!EstimateBlackpointWithShadowAnalysis(hLab2CMYK, hCMYK2Lab, "relative", &estimatedBlackpointLab)) {
                // Shadow analysis failed, keep initial estimate
            }
        } else {
            // Curve is nearly straight, use initial estimate
            estimatedBlackpointLab = initialBlackpoint;
        }

        #if K_ONLY_PARITY_DEBUGGING
        fprintf(stderr, "[C ComputeBPCScale] Standard blackpoint Lab: L=%.2f, a=%.2f, b=%.2f%s\n",
                estimatedBlackpointLab.L, estimatedBlackpointLab.a, estimatedBlackpointLab.b,
                needsShadowAnalysis ? " (shadow analysis)" : " (direct estimate)");
        #endif

        // Clamp L* to maximum of 50 (blackpoint sanity check)
        if (estimatedBlackpointLab.L > 50.0) {
            estimatedBlackpointLab.L = 50.0;
        }
        if (estimatedBlackpointLab.L < 0.0) {
            estimatedBlackpointLab.L = 0.0;
        }
    }

    // 2. Estimate K-Only blackpoint for CMYK(0,0,0,100)
    // Direct transform of CMYK(0,0,0,100) → Lab
    // NOTE: Unlike standard blackpoint, K-only blackpoint uses direct transform (matches JS line 1261)
    // JS: destinationKOnlyBlackpointLab = userIntentCMYK2LabTransform.forward(cmykColor(0, 0, 0, 100))
    {
        // TYPE_CMYK_DBL uses 0-100 range (like TYPE_CMYK_FLT)
        cmsFloat64Number kOnlyCMYK[4] = { 0.0, 0.0, 0.0, 100.0 };

        #if K_ONLY_PARITY_DEBUGGING
        fprintf(stderr, "[C ComputeBPCScale] K-Only CMYK input: %.1f, %.1f, %.1f, %.1f\n",
                kOnlyCMYK[0], kOnlyCMYK[1], kOnlyCMYK[2], kOnlyCMYK[3]);
        #endif

        // CMYK(0,0,0,100) → Lab
        cmsDoTransform(hCMYK2Lab, kOnlyCMYK, &estimatedKOnlyBlackpointLab, 1);
        
        #if K_ONLY_PARITY_DEBUGGING
        fprintf(stderr, "[C ComputeBPCScale] K-Only blackpoint Lab (raw from transform): L=%.2f, a=%.2f, b=%.2f\n",
                estimatedKOnlyBlackpointLab.L, estimatedKOnlyBlackpointLab.a, estimatedKOnlyBlackpointLab.b);
        #endif

        // CRITICAL: The JS code uses chromatic K-only blackpoint values in the BPC SCALE calculation (line 1318)
        // BUT we need to understand what happens in the FULL PIPELINE
        // For now, following JS spec exactly: use raw Lab values for XYZ conversion
        // TODO: Investigate why C produces K=77-87 while JS produces K=100 for Pure Black

        // Clamp L* to maximum of 50
        if (estimatedKOnlyBlackpointLab.L > 50.0) {
            estimatedKOnlyBlackpointLab.L = 50.0;
        }
        if (estimatedKOnlyBlackpointLab.L < 0.0) {
            estimatedKOnlyBlackpointLab.L = 0.0;
        }
    }

    // 3. Convert to XYZ to get Y (luminance) values
    cmsLab2XYZ(NULL, &blackXYZ, &estimatedBlackpointLab);
    cmsLab2XYZ(NULL, &kOnlyBlackXYZ, &estimatedKOnlyBlackpointLab);

    #if K_ONLY_PARITY_DEBUGGING
    fprintf(stderr, "\n[C] K-Only BPC Scale Calculation:\n");
    fprintf(stderr, "  K-only blackpoint Lab: L=%.6f, a=%.6f, b=%.6f\n",
            estimatedKOnlyBlackpointLab.L, estimatedKOnlyBlackpointLab.a, estimatedKOnlyBlackpointLab.b);
    fprintf(stderr, "  K-only blackpoint XYZ.Y: %.6f\n", kOnlyBlackXYZ.Y);
    fprintf(stderr, "  Standard blackpoint Lab: L=%.6f, a=%.6f, b=%.6f\n",
            estimatedBlackpointLab.L, estimatedBlackpointLab.a, estimatedBlackpointLab.b);
    fprintf(stderr, "  Standard blackpoint XYZ.Y: %.6f\n", blackXYZ.Y);
    #endif

    // 4. Calculate BPC scale: (1 - Y_KOnly) / (1 - Y_Black)
    // Reference: transform.js line 1423
    {
        cmsFloat64Number yBlack = blackXYZ.Y;
        cmsFloat64Number yKOnly = kOnlyBlackXYZ.Y;

        // Avoid division by zero
        if (fabs(1.0 - yBlack) < 1e-10) {
            scale = 1.0;
        } else {
            scale = (1.0 - yKOnly) / (1.0 - yBlack);
            
            #if K_ONLY_PARITY_DEBUGGING
            fprintf(stderr, "  BPC Scale: (1 - %.6f) / (1 - %.6f) = %.6f\n\n",
                    yKOnly, yBlack, scale);
            #endif

            // Clamp scale to maximum of 1.0 (never expand, only compress)
            if (scale > 1.0) {
                scale = 1.0;
            }

            // If scale is very close to 1.0, set it exactly to 1.0
            // Reference: transform.js lines 1430-1431
            if (fabs(1.0 - scale) < 0.0000001) {
                scale = 1.0;
            }
        }

        // Ensure scale is non-negative
        if (scale < 0.0) {
            scale = 0.0;
        }
    }
    
    // Store K-only blackpoint Lab if requested
    if (outKOnlyBlackpointLab != NULL) {
        *outKOnlyBlackpointLab = estimatedKOnlyBlackpointLab;
    }

    // Cleanup
    cmsDeleteTransform(hLab2CMYK);
    cmsDeleteTransform(hCMYK2Lab);
    cmsCloseProfile(hLabProfile);

    return scale;
}

/**
 * Apply K-Only BPC to Lab values
 *
 * Applies black point compensation by scaling the L* channel based on the
 * difference between CMYK(100,100,100,100) and CMYK(0,0,0,100) blackpoints.
 * The a* and b* channels are preserved to maintain hue and chroma.
 *
 * Reference:
 *  - documentation/Porting-to-Little-CMS.md Phase 4
 *  - transform.js line 1445: applyKOnlyBlackpointCompensation function
 *  - blackpoint-estimation.js lines 14-20: applyBlackpointCompensation implementation
 */
void ApplyKOnlyBPC(
    const cmsCIELab* InputLab,
    cmsCIELab* OutputLab,
    cmsFloat64Number scale,
    cmsBool debugEnabled)
{
    cmsCIEXYZ sourceXYZ, destXYZ;
    cmsCIEXYZ flatSourceXYZ, flatDestXYZ;

    if (debugEnabled && InputLab->L < 1.0) {
        fprintf(stderr, "\n[C BPC Trace] Input Lab: L=%.6f, a=%.6f, b=%.6f\n", 
                InputLab->L, InputLab->a, InputLab->b);
        fprintf(stderr, "[C BPC Trace] BPC scale: %.6f\n", scale);
    }

    // Convert Lab → XYZ (using D50 whitepoint)
    cmsLab2XYZ(NULL, &sourceXYZ, InputLab);

    if (debugEnabled && InputLab->L < 1.0) {
        fprintf(stderr, "[C BPC Trace] Lab→XYZ: X=%.6f, Y=%.6f, Z=%.6f\n",
                sourceXYZ.X, sourceXYZ.Y, sourceXYZ.Z);
    }

    // Flatten XYZ (normalize to whitepoint)
    // JavaScript: sourceFlatXYZ = { X: sourceXYZ.X / whitePoint.X, Y: sourceXYZ.Y, Z: sourceXYZ.Z / whitePoint.Z }
    // For D50 whitepoint (X=0.9642, Y=1.0, Z=0.8249):
    flatSourceXYZ.X = sourceXYZ.X / 0.9642;
    flatSourceXYZ.Y = sourceXYZ.Y / 1.0;
    flatSourceXYZ.Z = sourceXYZ.Z / 0.8249;

    if (debugEnabled && InputLab->L < 1.0) {
        fprintf(stderr, "[C BPC Trace] Flattened source XYZ: X=%.6f, Y=%.6f, Z=%.6f\n",
                flatSourceXYZ.X, flatSourceXYZ.Y, flatSourceXYZ.Z);
    }

    // Apply BPC scaling
    // JavaScript: destinationFlatXYZ = { X: flatXYZ.X * scale + (1 - scale), ... }
    flatDestXYZ.X = flatSourceXYZ.X * scale + (1.0 - scale);
    flatDestXYZ.Y = flatSourceXYZ.Y * scale + (1.0 - scale);
    flatDestXYZ.Z = flatSourceXYZ.Z * scale + (1.0 - scale);

    if (debugEnabled && InputLab->L < 1.0) {
        fprintf(stderr, "[C BPC Trace] Scaled flat XYZ: X=%.6f, Y=%.6f, Z=%.6f\n",
                flatDestXYZ.X, flatDestXYZ.Y, flatDestXYZ.Z);
    }

    // IMPORTANT: Match JavaScript implementation exactly (even though it seems wrong)
    // JavaScript line 18: { ...flatXYZ, X: flatXYZ.X / whitepoint.X, Y: flatXYZ.Y, Z: flatXYZ.Z / whitepoint.Z }
    // This divides X and Z by whitepoint but NOT Y!
    destXYZ.X = flatDestXYZ.X / 0.96422; // Divide, not multiply!
    destXYZ.Y = flatDestXYZ.Y;           // No scaling for Y
    destXYZ.Z = flatDestXYZ.Z / 0.82521; // Divide, not multiply!

    if (debugEnabled && InputLab->L < 1.0) {
        fprintf(stderr, "[C BPC Trace] Final destination XYZ: X=%.6f, Y=%.6f, Z=%.6f\n",
                destXYZ.X, destXYZ.Y, destXYZ.Z);
    }

    // Convert XYZ → Lab
    cmsXYZ2Lab(NULL, OutputLab, &destXYZ);

    if (debugEnabled && InputLab->L < 1.0) {
        fprintf(stderr, "[C BPC Trace] Output Lab: L=%.6f, a=%.6f, b=%.6f\n\n",
                OutputLab->L, OutputLab->a, OutputLab->b);
    }

    // Note: The a* and b* channels are preserved by the XYZ transform
    // since we're only scaling the luminance (Y) component
}

/**
 * Core GCR sampler function for 3D CLUT (RGB/Lab input)
 *
 * Implements the K-Only BPC + GCR algorithm for 3D CLUT generation.
 * This is called for each grid point during CLUT creation.
 *
 * Reference:
 *  - documentation/Porting-to-Little-CMS.md Phase 5
 *  - transform.js create3DDeviceLUT_KOnly() lines 1866-2223 (main loop)
 */
int KOnlyGCRSampler3D(
    CMSREGISTER const cmsUInt16Number In[],
    CMSREGISTER cmsUInt16Number Out[],
    CMSREGISTER void* Cargo)
{
    static int isNeutralGray = 0;
    static int shouldPrint = 0;

    KOnlyGCRParams* params = (KOnlyGCRParams*)Cargo;

    // Safety check: ensure params is valid
    if (!params || !params->input2lab || !params->lab2cmyk || !params->cmyk2lab) {
        // Return black if params invalid
        Out[0] = Out[1] = Out[2] = Out[3] = 0;
        return FALSE;
    }

    // Constants from JavaScript (lines 1868-1871)
    const cmsFloat64Number K_MAX = 99.5;
    const cmsFloat64Number K_MIN = 0.5;
    const cmsFloat64Number CMY_MAX = 99.5;
    const cmsFloat64Number CMY_MIN = 0.5;
    const cmsFloat64Number NORMALIZED_CHROMA_THRESHOLD = 2.0;

    // Convert 16-bit input to floating point (0.0-1.0 range)
    cmsFloat32Number inputFloat[3];
    inputFloat[0] = (cmsFloat32Number)(In[0] / 65535.0);
    inputFloat[1] = (cmsFloat32Number)(In[1] / 65535.0);
    inputFloat[2] = (cmsFloat32Number)(In[2] / 65535.0);

    // Runtime debugging: Check if this is a test color we want to debug
    int shouldDebug = 0;
    if (params->debugEnabled) {
        int isDebugGray = (fabs(inputFloat[0] - inputFloat[1]) < 0.001 && fabs(inputFloat[1] - inputFloat[2]) < 0.001);
        shouldDebug = isDebugGray && (
            (fabs(inputFloat[0] - 0.000) < 0.001) ||  // Pure black RGB(0,0,0)
            (fabs(inputFloat[0] - 0.250) < 0.005) ||  // Dark gray RGB(64,64,64)
            (fabs(inputFloat[0] - 0.500) < 0.005) ||  // Medium gray RGB(128,128,128)
            (fabs(inputFloat[0] - 0.750) < 0.005)     // Light gray RGB(192,192,192)
        );
        if (shouldDebug) {
            fprintf(stderr, "\n[C-DEBUG] === RGB(%.3f, %.3f, %.3f) ===\n", inputFloat[0], inputFloat[1], inputFloat[2]);
        }
    }

    // Check if this is a neutral gray for debugging
    #if K_ONLY_PARITY_DEBUGGING
    isNeutralGray = (fabs(inputFloat[0] - inputFloat[1]) < 0.001 && fabs(inputFloat[1] - inputFloat[2]) < 0.001);
    // Only print specific values we're interested in: RGB(0, 0.25, 0.5, 0.75)
    shouldPrint = isNeutralGray && (
        (fabs(inputFloat[0] - 0.000) < 0.001) ||  // Pure black
        (fabs(inputFloat[0] - 0.250) < 0.005) ||  // Dark gray (64/255)
        (fabs(inputFloat[0] - 0.500) < 0.005) ||  // Medium gray (128/255)
        (fabs(inputFloat[0] - 0.750) < 0.005)     // Light gray (192/255)
    );
    if (shouldPrint) {
        fprintf(stderr, "\n[C] RGB(%.3f, %.3f, %.3f)\n", inputFloat[0], inputFloat[1], inputFloat[2]);
    }
    #endif

    // Stage 1: Convert input to Lab using input→Lab pipeline
    cmsFloat32Number labFloat[3];
    cmsDoTransform(params->input2lab, inputFloat, labFloat, 1);

    // Convert Float32 Lab to cmsCIELab struct
    cmsCIELab inputLab;
    inputLab.L = (cmsFloat64Number)labFloat[0];
    inputLab.a = (cmsFloat64Number)labFloat[1];
    inputLab.b = (cmsFloat64Number)labFloat[2];

    if (shouldDebug) {
        fprintf(stderr, "[C-DEBUG] Stage 1 - Input Lab: L=%.2f a=%.6f b=%.6f\n", inputLab.L, inputLab.a, inputLab.b);
    }

    #if K_ONLY_PARITY_DEBUGGING
    if (isNeutralGray && shouldPrint) {
        fprintf(stderr, "  inputLab: L=%.2f, a=%.10f, b=%.10f\n", inputLab.L, inputLab.a, inputLab.b);
    }
    #endif

    // Stage 2: Calculate input chroma (line 1898)
    cmsFloat64Number inputChroma = sqrt(inputLab.a * inputLab.a + inputLab.b * inputLab.b);

    if (shouldDebug) {
        fprintf(stderr, "[C-DEBUG] Stage 2 - Input Chroma: %.6f\n", inputChroma);
        fprintf(stderr, "[C-DEBUG] Stage 3 - BPC Scale: %.6f\n", params->kOnlyBpcScale);
    }

    // Stage 3: Apply K-Only BPC to Lab (line 1918)
    cmsCIELab scaledLab;
    ApplyKOnlyBPC(&inputLab, &scaledLab, params->kOnlyBpcScale, params->debugEnabled);

    if (shouldDebug) {
        fprintf(stderr, "[C-DEBUG] Stage 3 - Scaled Lab after BPC: L=%.2f a=%.2f b=%.2f\n", scaledLab.L, scaledLab.a, scaledLab.b);
    }

    #if K_ONLY_PARITY_DEBUGGING
    if (isNeutralGray && shouldPrint) {
        fprintf(stderr, "  scaledLab: L=%.2f, a=%.2f, b=%.2f\n", scaledLab.L, scaledLab.a, scaledLab.b);
    }
    #endif

    // Stage 4: Convert scaled Lab → CMYK (line 1919)
    // Convert cmsCIELab struct to Float32 array
    cmsFloat32Number scaledLabFloat[3];
    scaledLabFloat[0] = (cmsFloat32Number)scaledLab.L;
    scaledLabFloat[1] = (cmsFloat32Number)scaledLab.a;
    scaledLabFloat[2] = (cmsFloat32Number)scaledLab.b;

    cmsFloat32Number scaledCMYKFloat[4];
    cmsDoTransform(params->lab2cmyk, scaledLabFloat, scaledCMYKFloat, 1);

    #if K_ONLY_PARITY_DEBUGGING
    if (isNeutralGray && shouldPrint) {
        fprintf(stderr, "  scaledCMYKFloat (RAW from transform): %.6f, %.6f, %.6f, %.6f\n",
                scaledCMYKFloat[0], scaledCMYKFloat[1], scaledCMYKFloat[2], scaledCMYKFloat[3]);
    }
    #endif

    // Convert Float32 CMYK to double (NO scaling - TYPE_CMYK_FLT already returns 0-100 range)
    cmsFloat64Number scaledCMYK[4];
    scaledCMYK[0] = (cmsFloat64Number)scaledCMYKFloat[0];
    scaledCMYK[1] = (cmsFloat64Number)scaledCMYKFloat[1];
    scaledCMYK[2] = (cmsFloat64Number)scaledCMYKFloat[2];
    scaledCMYK[3] = (cmsFloat64Number)scaledCMYKFloat[3];

    if (shouldDebug) {
        fprintf(stderr, "[C-DEBUG] Stage 4 - Scaled Lab→CMYK: C=%.2f M=%.2f Y=%.2f K=%.2f\n",
                scaledCMYK[0], scaledCMYK[1], scaledCMYK[2], scaledCMYK[3]);
    }

    #if K_ONLY_PARITY_DEBUGGING
    if (isNeutralGray && shouldPrint) {
        fprintf(stderr, "  scaledCMYK (after *100): C=%.2f, M=%.2f, Y=%.2f, K=%.2f\n",
                scaledCMYK[0], scaledCMYK[1], scaledCMYK[2], scaledCMYK[3]);
    }
    #endif

    // Stage 5: Chroma-modulated GCR transformation (lines 1939-1966)

    // Create normalized Lab with BPC-adjusted L* but original a*, b*
    cmsCIELab normalizedLab;
    normalizedLab.L = scaledLab.L;
    normalizedLab.a = inputLab.a;
    normalizedLab.b = inputLab.b;

    // Convert normalized Lab → CMYK
    // Convert cmsCIELab struct to Float32 array
    cmsFloat32Number normalizedLabFloat[3];
    normalizedLabFloat[0] = (cmsFloat32Number)normalizedLab.L;
    normalizedLabFloat[1] = (cmsFloat32Number)normalizedLab.a;
    normalizedLabFloat[2] = (cmsFloat32Number)normalizedLab.b;

    cmsFloat32Number normalizedCMYKFloat[4];
    cmsDoTransform(params->lab2cmyk, normalizedLabFloat, normalizedCMYKFloat, 1);

    // Convert Float32 CMYK to double (NO scaling - TYPE_CMYK_FLT already returns 0-100 range)
    cmsFloat64Number normalizedCMYK[4];
    normalizedCMYK[0] = (cmsFloat64Number)normalizedCMYKFloat[0];
    normalizedCMYK[1] = (cmsFloat64Number)normalizedCMYKFloat[1];
    normalizedCMYK[2] = (cmsFloat64Number)normalizedCMYKFloat[2];
    normalizedCMYK[3] = (cmsFloat64Number)normalizedCMYKFloat[3];

    if (shouldDebug) {
        fprintf(stderr, "[C-DEBUG] Stage 5a - Normalized Lab (BPC L* + original a*b*): L=%.2f a=%.2f b=%.2f\n",
                normalizedLab.L, normalizedLab.a, normalizedLab.b);
        fprintf(stderr, "[C-DEBUG] Stage 5b - Normalized Lab→CMYK: C=%.2f M=%.2f Y=%.2f K=%.2f\n",
                normalizedCMYK[0], normalizedCMYK[1], normalizedCMYK[2], normalizedCMYK[3]);
    }

    #if K_ONLY_PARITY_DEBUGGING
    if (isNeutralGray && shouldPrint) {
        fprintf(stderr, "  normalizedCMYK: C=%.2f, M=%.2f, Y=%.2f, K=%.2f\n",
                normalizedCMYK[0], normalizedCMYK[1], normalizedCMYK[2], normalizedCMYK[3]);
    }
    #endif

    // Calculate normalized chroma
    // For near-neutral colors (inputChroma < 0.5), treat as perfect neutral to avoid floating-point noise
    cmsFloat64Number normalizedChroma = inputChroma < 0.5 ? 0.0 : sqrt(normalizedLab.a * normalizedLab.a + normalizedLab.b * normalizedLab.b);
    
    #if K_ONLY_PARITY_DEBUGGING
    if (isNeutralGray && shouldPrint) {
        fprintf(stderr, "  inputChroma=%.10f, normalizedLab.a=%.10f, normalizedLab.b=%.10f, normalizedChroma=%.10f\n",
                inputChroma, normalizedLab.a, normalizedLab.b, normalizedChroma);
    }
    #endif

    // Calculate chroma factor: max(0, min(1, log1p(chroma) / log1p(5)))
    cmsFloat64Number normalizedChromaFactor = log1p(normalizedChroma) / log1p(5.0);
    if (normalizedChromaFactor < 0.0) normalizedChromaFactor = 0.0;
    if (normalizedChromaFactor > 1.0) normalizedChromaFactor = 1.0;

    // Calculate gray component: min(C, M, Y)
    cmsFloat64Number normalizedGrayComponent = normalizedCMYK[0]; // C
    if (normalizedCMYK[1] < normalizedGrayComponent) normalizedGrayComponent = normalizedCMYK[1]; // M
    if (normalizedCMYK[2] < normalizedGrayComponent) normalizedGrayComponent = normalizedCMYK[2]; // Y

    #if K_ONLY_PARITY_DEBUGGING
    if (isNeutralGray && shouldPrint) {
        fprintf(stderr, "  normalizedChroma: %.2f, chromaFactor: %.6f, grayComponent: %.2f\n",
                normalizedChroma, normalizedChromaFactor, normalizedGrayComponent);
    }
    #endif

    // Apply GCR transformation
    cmsFloat64Number outputCMYK[4];
    outputCMYK[0] = (normalizedCMYK[0] - normalizedGrayComponent) * normalizedChromaFactor; // C
    outputCMYK[1] = (normalizedCMYK[1] - normalizedGrayComponent) * normalizedChromaFactor; // M
    outputCMYK[2] = (normalizedCMYK[2] - normalizedGrayComponent) * normalizedChromaFactor; // Y
    outputCMYK[3] = normalizedCMYK[3] + normalizedGrayComponent / 2.0; // K

    // Clamp to 0-100 range
    for (int i = 0; i < 4; i++) {
        if (outputCMYK[i] < 0.0) outputCMYK[i] = 0.0;
        if (outputCMYK[i] > 100.0) outputCMYK[i] = 100.0;
    }

    if (shouldDebug) {
        fprintf(stderr, "[C-DEBUG] Stage 5c - After GCR transformation: C=%.2f M=%.2f Y=%.2f K=%.2f\n",
                outputCMYK[0], outputCMYK[1], outputCMYK[2], outputCMYK[3]);
    }

    #if K_ONLY_PARITY_DEBUGGING
    if (isNeutralGray && shouldPrint) {
        fprintf(stderr, "  After GCR: C=%.2f, M=%.2f, Y=%.2f, K=%.2f\n",
                outputCMYK[0], outputCMYK[1], outputCMYK[2], outputCMYK[3]);
    }
    #endif

    // Stage 6: Iterative L* matching (lines 1983-1990)
    // Convert CMYK double to Float32 array (NO scaling - TYPE_CMYK_FLT expects 0-100 range)
    cmsFloat32Number outputCMYKFloat[4];
    outputCMYKFloat[0] = (cmsFloat32Number)outputCMYK[0];
    outputCMYKFloat[1] = (cmsFloat32Number)outputCMYK[1];
    outputCMYKFloat[2] = (cmsFloat32Number)outputCMYK[2];
    outputCMYKFloat[3] = (cmsFloat32Number)outputCMYK[3];

    cmsFloat32Number outputLabFloat[3];
    cmsDoTransform(params->cmyk2lab, outputCMYKFloat, outputLabFloat, 1);

    // Convert Float32 Lab to cmsCIELab struct
    cmsCIELab outputLab;
    outputLab.L = (cmsFloat64Number)outputLabFloat[0];
    outputLab.a = (cmsFloat64Number)outputLabFloat[1];
    outputLab.b = (cmsFloat64Number)outputLabFloat[2];

    #if K_ONLY_PARITY_DEBUGGING
    if (isNeutralGray && shouldPrint) {
        fprintf(stderr, "  outputLab (before L* matching): L=%.2f, a=%.2f, b=%.2f\n",
                outputLab.L, outputLab.a, outputLab.b);
    }
    #endif

    cmsFloat64Number targetL = scaledLab.L;
    cmsFloat64Number deltaL = 0.0;
    cmsFloat64Number previousDeltaL = 0.0;
    int iterationCount = 0;
    const int MAX_ITERATIONS = 1000;  // Updated to match JS (transform.js line 948)

    while (iterationCount++ < MAX_ITERATIONS) {
        deltaL = outputLab.L - targetL;

        // Break if within tolerance or not improving
        if (fabs(deltaL) <= 0.125) break;
        if (previousDeltaL != 0.0 && fabs(deltaL) >= fabs(previousDeltaL)) break;

        previousDeltaL = deltaL;

        // Adjust K: if output L* too high (too light), decrease K; if too low (too dark), increase K
        outputCMYK[3] += (outputLab.L > targetL) ? -0.125 : 0.125;

        // Clamp K to valid range
        if (outputCMYK[3] < 0.0) outputCMYK[3] = 0.0;
        if (outputCMYK[3] > 100.0) outputCMYK[3] = 100.0;

        // Recalculate Lab
        // Convert CMYK double to Float32 array (NO scaling - TYPE_CMYK_FLT expects 0-100 range)
        outputCMYKFloat[0] = (cmsFloat32Number)outputCMYK[0];
        outputCMYKFloat[1] = (cmsFloat32Number)outputCMYK[1];
        outputCMYKFloat[2] = (cmsFloat32Number)outputCMYK[2];
        outputCMYKFloat[3] = (cmsFloat32Number)outputCMYK[3];

        cmsDoTransform(params->cmyk2lab, outputCMYKFloat, outputLabFloat, 1);

        // Convert Float32 Lab to cmsCIELab struct
        outputLab.L = (cmsFloat64Number)outputLabFloat[0];
        outputLab.a = (cmsFloat64Number)outputLabFloat[1];
        outputLab.b = (cmsFloat64Number)outputLabFloat[2];
    }

    if (shouldDebug) {
        fprintf(stderr, "[C-DEBUG] Stage 6 - After first L* matching (%d iterations): K=%.2f (outputLab.L=%.2f, targetL=%.2f)\n",
                iterationCount, outputCMYK[3], outputLab.L, targetL);
    }

    #if K_ONLY_PARITY_DEBUGGING
    if (isNeutralGray && shouldPrint) {
        fprintf(stderr, "  After L* matching (%d iters): K=%.2f, outputLab.L=%.2f, targetL=%.2f\n",
                iterationCount, outputCMYK[3], outputLab.L, targetL);
        fprintf(stderr, "  (Before chroma restoration)\n");
    }
    #endif

    // Stage 7: Chroma restoration (lines 2126-2207)
    // Calculate current output chroma
    cmsFloat64Number outputChroma = sqrt(outputLab.a * outputLab.a + outputLab.b * outputLab.b);

    // Only restore chroma if there's a significant difference (> 0.5)
    if (inputChroma > 1.0 && outputChroma > 1.0 && (inputChroma - outputChroma) > 0.5) {
        // Get input CMYK for reference (convert input Lab → CMYK)
        // Convert cmsCIELab struct to Float32 array
        cmsFloat32Number inputLabFloat[3];
        inputLabFloat[0] = (cmsFloat32Number)inputLab.L;
        inputLabFloat[1] = (cmsFloat32Number)inputLab.a;
        inputLabFloat[2] = (cmsFloat32Number)inputLab.b;

        cmsFloat32Number inputCMYKFloat[4];
        cmsDoTransform(params->lab2cmyk, inputLabFloat, inputCMYKFloat, 1);

        // Convert Float32 CMYK to double (NO scaling - TYPE_CMYK_FLT already returns 0-100 range)
        cmsFloat64Number inputCMYK[4];
        inputCMYK[0] = (cmsFloat64Number)inputCMYKFloat[0];
        inputCMYK[1] = (cmsFloat64Number)inputCMYKFloat[1];
        inputCMYK[2] = (cmsFloat64Number)inputCMYKFloat[2];
        inputCMYK[3] = (cmsFloat64Number)inputCMYKFloat[3];

        // Identify primary, secondary colors based on input CMYK
        cmsFloat64Number maxColor = inputCMYK[0]; // Start with C
        int primaryIdx = 0;
        if (inputCMYK[1] > maxColor) { maxColor = inputCMYK[1]; primaryIdx = 1; } // M
        if (inputCMYK[2] > maxColor) { maxColor = inputCMYK[2]; primaryIdx = 2; } // Y

        // Determine secondary color (second highest)
        int secondaryIdx;
        if (primaryIdx == 0) {
            secondaryIdx = (inputCMYK[1] > inputCMYK[2]) ? 1 : 2; // M or Y
        } else if (primaryIdx == 1) {
            secondaryIdx = (inputCMYK[0] > inputCMYK[2]) ? 0 : 2; // C or Y
        } else {
            secondaryIdx = (inputCMYK[0] > inputCMYK[1]) ? 0 : 1; // C or M
        }

        cmsFloat64Number primaryInput = inputCMYK[primaryIdx];
        cmsFloat64Number primaryOutput = outputCMYK[primaryIdx];
        cmsFloat64Number primaryStep = (primaryInput - primaryOutput) / 100.0;

        cmsFloat64Number secondaryInput = inputCMYK[secondaryIdx];
        cmsFloat64Number secondaryOutput = outputCMYK[secondaryIdx];
        cmsFloat64Number secondaryStep = (primaryInput != 0.0) ?
            (primaryStep / primaryInput * secondaryInput) : 0.0;

        // Iteratively increase primary and secondary colors
        cmsFloat64Number optimizedCMYK[4];
        memcpy(optimizedCMYK, outputCMYK, sizeof(outputCMYK));

        cmsCIELab optimizedLab;
        int chromaIterations = 0;
        const int MAX_CHROMA_ITERATIONS = 1000;  // Updated to match JS (transform.js line 949)

        while (chromaIterations++ < MAX_CHROMA_ITERATIONS && primaryStep != 0.0) {
            cmsFloat64Number nextPrimary = optimizedCMYK[primaryIdx] + primaryStep;
            cmsFloat64Number nextSecondary = optimizedCMYK[secondaryIdx] + secondaryStep;

            // Check bounds
            if (nextPrimary > inputCMYK[primaryIdx] || nextPrimary < 0.0 || nextSecondary < 0.0) break;

            optimizedCMYK[primaryIdx] = nextPrimary;
            optimizedCMYK[secondaryIdx] = nextSecondary;

            // Re-evaluate Lab
            // Convert CMYK double to Float32 array (NO scaling - TYPE_CMYK_FLT expects 0-100)
            cmsFloat32Number optimizedCMYKFloat[4];
            optimizedCMYKFloat[0] = (cmsFloat32Number)optimizedCMYK[0];
            optimizedCMYKFloat[1] = (cmsFloat32Number)optimizedCMYK[1];
            optimizedCMYKFloat[2] = (cmsFloat32Number)optimizedCMYK[2];
            optimizedCMYKFloat[3] = (cmsFloat32Number)optimizedCMYK[3];

            cmsFloat32Number optimizedLabFloat[3];
            cmsDoTransform(params->cmyk2lab, optimizedCMYKFloat, optimizedLabFloat, 1);

            // Convert Float32 Lab to cmsCIELab struct
            optimizedLab.L = (cmsFloat64Number)optimizedLabFloat[0];
            optimizedLab.a = (cmsFloat64Number)optimizedLabFloat[1];
            optimizedLab.b = (cmsFloat64Number)optimizedLabFloat[2];

            // Re-adjust K to maintain target L*
            deltaL = 0.0;
            previousDeltaL = 0.0;
            int kAdjustIterations = 0;

            while (kAdjustIterations++ < MAX_ITERATIONS) {
                deltaL = optimizedLab.L - targetL;

                if (fabs(deltaL) <= 0.125) break;
                if (previousDeltaL != 0.0 && fabs(deltaL) >= fabs(previousDeltaL)) break;

                previousDeltaL = deltaL;
                optimizedCMYK[3] += (optimizedLab.L > targetL) ? -0.125 : 0.125;

                if (optimizedCMYK[3] < 0.0) optimizedCMYK[3] = 0.0;
                if (optimizedCMYK[3] > 100.0) optimizedCMYK[3] = 100.0;

                // Re-evaluate Lab
                // Convert CMYK double to Float32 array (NO scaling - TYPE_CMYK_FLT expects 0-100)
                optimizedCMYKFloat[0] = (cmsFloat32Number)optimizedCMYK[0];
                optimizedCMYKFloat[1] = (cmsFloat32Number)optimizedCMYK[1];
                optimizedCMYKFloat[2] = (cmsFloat32Number)optimizedCMYK[2];
                optimizedCMYKFloat[3] = (cmsFloat32Number)optimizedCMYK[3];

                cmsDoTransform(params->cmyk2lab, optimizedCMYKFloat, optimizedLabFloat, 1);

                // Convert Float32 Lab to cmsCIELab struct
                optimizedLab.L = (cmsFloat64Number)optimizedLabFloat[0];
                optimizedLab.a = (cmsFloat64Number)optimizedLabFloat[1];
                optimizedLab.b = (cmsFloat64Number)optimizedLabFloat[2];
            }

            // Update output chroma
            outputChroma = sqrt(optimizedLab.a * optimizedLab.a + optimizedLab.b * optimizedLab.b);

            // Break if chroma restored or stopped improving
            if ((inputChroma - outputChroma) <= 0.5) break;
        }

        // Clamp final values to input limits
        if (optimizedCMYK[primaryIdx] > primaryInput) optimizedCMYK[primaryIdx] = primaryInput;
        if (optimizedCMYK[secondaryIdx] > secondaryInput) optimizedCMYK[secondaryIdx] = secondaryInput;

        memcpy(outputCMYK, optimizedCMYK, sizeof(outputCMYK));
    }

    if (shouldDebug) {
        fprintf(stderr, "[C-DEBUG] Stage 7 - After chroma restoration: K=%.2f (inputChroma=%.2f, outputChroma=%.2f)\n",
                outputCMYK[3], inputChroma, outputChroma);
    }

    #if K_ONLY_PARITY_DEBUGGING
    if (isNeutralGray && shouldPrint) {
        fprintf(stderr, "  After chroma restoration: K=%.2f\n", outputCMYK[3]);
    }
    #endif

    // Final L* matching to ensure target lightness is met (JS line 1691-1696)
    // This uses INVERTED K adjustment logic and includes scaledOutputKOnlyBlackpointLab boundary check
    cmsFloat32Number finalLabFloat[3];
    cmsCIELab finalLab;
    cmsFloat32Number finalCMYKFloat[4];
    finalCMYKFloat[0] = (cmsFloat32Number)outputCMYK[0];
    finalCMYKFloat[1] = (cmsFloat32Number)outputCMYK[1];
    finalCMYKFloat[2] = (cmsFloat32Number)outputCMYK[2];
    finalCMYKFloat[3] = (cmsFloat32Number)outputCMYK[3];
    
    cmsDoTransform(params->cmyk2lab, finalCMYKFloat, finalLabFloat, 1);
    finalLab.L = (cmsFloat64Number)finalLabFloat[0];
    finalLab.a = (cmsFloat64Number)finalLabFloat[1];
    finalLab.b = (cmsFloat64Number)finalLabFloat[2];
    
    int finalMatchIterations = 0;
    cmsFloat64Number finalTargetL = scaledLab.L;
    cmsFloat64Number offsetK = 0.0;
    cmsFloat64Number previousFinalDeltaL = 0.0;
    const int MAX_FINAL_ITERATIONS = 1000;  // Much higher limit since JS has no limit
    
    #if K_ONLY_PARITY_DEBUGGING
    if (isNeutralGray && shouldPrint) {
        fprintf(stderr, "  Before final L* matching: K=%.2f, finalLab.L=%.2f, targetL=%.2f\n",
                outputCMYK[3], finalLab.L, finalTargetL);
        fprintf(stderr, "    Boundary check: finalLab.L (%.2f) >= scaledKOnlyBlackpointLab.L (%.2f) = %s\n",
                finalLab.L, params->scaledKOnlyBlackpointLab.L,
                (finalLab.L >= params->scaledKOnlyBlackpointLab.L) ? "TRUE" : "FALSE");
    }
    #endif
    
    // JS line 1691-1696: Three conditions must ALL be true to continue loop
    // 1. L* difference > tolerance
    // 2. outputLab.L >= scaledOutputKOnlyBlackpointLab.L (don't go past K-only blackpoint)
    // 3. K bounds check with offsetK
    while (fabs(finalLab.L - finalTargetL) > 0.125 
           && finalLab.L >= params->scaledKOnlyBlackpointLab.L  // KEY: boundary check!
           && ((outputCMYK[3] > 0.0 || offsetK > 0.0) && (outputCMYK[3] < 100.0 || offsetK < 0.0))
           && finalMatchIterations++ < MAX_FINAL_ITERATIONS) {
        cmsFloat64Number currentDeltaL = finalLab.L - finalTargetL;
        
        // Check for improvement (similar to first L* matching loop)
        if (previousFinalDeltaL != 0.0 && fabs(currentDeltaL) >= fabs(previousFinalDeltaL)) {
            // Not improving, stop
            break;
        }
        previousFinalDeltaL = currentDeltaL;

        // Adaptive step size to prevent oscillation near target
        // Matches JS implementation (transform.js lines 1781-1783)
        // INVERTED logic: If finalLab.L < finalTargetL (too dark) → DECREASE K (makes it lighter)
        //                  If finalLab.L > finalTargetL (too light) → INCREASE K (makes it darker)
        cmsFloat64Number deltaL = finalTargetL - finalLab.L;
        cmsFloat64Number stepSize = (fabs(deltaL) / 2.0 < 0.125) ? fabs(deltaL) / 2.0 : 0.125;
        cmsFloat64Number kAdjustment = (deltaL > 0.0) ? -stepSize : stepSize;
        offsetK = kAdjustment;
        outputCMYK[3] += offsetK;
        
        finalCMYKFloat[3] = (cmsFloat32Number)outputCMYK[3];
        cmsDoTransform(params->cmyk2lab, finalCMYKFloat, finalLabFloat, 1);
        finalLab.L = (cmsFloat64Number)finalLabFloat[0];
        finalLab.a = (cmsFloat64Number)finalLabFloat[1];  // Update all Lab channels
        finalLab.b = (cmsFloat64Number)finalLabFloat[2];
    }
    
    if (shouldDebug) {
        if (finalMatchIterations > 0) {
            fprintf(stderr, "[C-DEBUG] Stage 8 - After final L* matching (%d iterations): K=%.2f (finalLab.L=%.2f, targetL=%.2f)\n",
                    finalMatchIterations, outputCMYK[3], finalLab.L, finalTargetL);
        } else {
            fprintf(stderr, "[C-DEBUG] Stage 8 - Final L* matching SKIPPED (boundary/convergence conditions not met)\n");
        }
    }

    #if K_ONLY_PARITY_DEBUGGING
    if (isNeutralGray && shouldPrint) {
        if (finalMatchIterations > 0) {
            fprintf(stderr, "  Final L* matching: %d iterations, K=%.2f, finalLab.L=%.2f, targetL=%.2f\n",
                    finalMatchIterations, outputCMYK[3], finalLab.L, finalTargetL);
        } else {
            fprintf(stderr, "  Final L* matching: SKIPPED (conditions not met)\n");
        }
    }
    #endif

    // Stage 8: Final clamping (lines 2214-2217)
    if (outputCMYK[3] >= K_MAX) {
        outputCMYK[3] = 100.0;
        outputCMYK[0] = 0.0;
        outputCMYK[1] = 0.0;
        outputCMYK[2] = 0.0;
    } else if (outputCMYK[3] <= K_MIN) {
        outputCMYK[3] = 0.0;
    }

    for (int i = 0; i < 3; i++) {
        if (outputCMYK[3] >= K_MAX) {
            outputCMYK[i] = 0.0;
        } else if (outputCMYK[i] >= CMY_MAX) {
            outputCMYK[i] = 100.0;
        } else if (outputCMYK[i] <= CMY_MIN) {
            outputCMYK[i] = 0.0;
        }
    }

    // Stage 9: Convert to 16-bit output (line 2219)
    Out[0] = (cmsUInt16Number)((outputCMYK[0] / 100.0) * 65535.0 + 0.5); // C
    Out[1] = (cmsUInt16Number)((outputCMYK[1] / 100.0) * 65535.0 + 0.5); // M
    Out[2] = (cmsUInt16Number)((outputCMYK[2] / 100.0) * 65535.0 + 0.5); // Y
    Out[3] = (cmsUInt16Number)((outputCMYK[3] / 100.0) * 65535.0 + 0.5); // K

    if (shouldDebug) {
        fprintf(stderr, "[C-DEBUG] FINAL OUTPUT: C=%.2f M=%.2f Y=%.2f K=%.2f\n",
                outputCMYK[0], outputCMYK[1], outputCMYK[2], outputCMYK[3]);
        fprintf(stderr, "[C-DEBUG] ===================================\n\n");
    }

    #if K_ONLY_PARITY_DEBUGGING
    if (isNeutralGray && shouldPrint) {
        fprintf(stderr, "  FINAL: C=%.2f, M=%.2f, Y=%.2f, K=%.2f\n",
                outputCMYK[0], outputCMYK[1], outputCMYK[2], outputCMYK[3]);
        fprintf(stderr, "  CLUT values (0-1): %.6f, %.6f, %.6f, %.6f\n\n",
                outputCMYK[0]/100.0, outputCMYK[1]/100.0, outputCMYK[2]/100.0, outputCMYK[3]/100.0);
    }
    #endif

    return TRUE;
}

/**
 * GCR sampler function for 4D CLUT (CMYK input)
 *
 * STUB: Not implemented
 *
 * TODO: Implement 4D CLUT sampler for CMYK→CMYK transforms
 * Reference: documentation/Porting-to-Little-CMS.md Phase 5
 */
int KOnlyGCRSampler4D(
    CMSREGISTER const cmsUInt16Number In[],
    CMSREGISTER cmsUInt16Number Out[],
    CMSREGISTER void* Cargo)
{
    (void)In;
    (void)Out;
    (void)Cargo;

    // TODO: Implement 4D sampler
    // Similar to 3D but handles CMYK input

    return FALSE;  // Not implemented
}

/**
 * GCR sampler function for 1D CLUT (Gray input)
 *
 * STUB: Not implemented
 *
 * TODO: Implement 1D CLUT sampler for Gray→CMYK transforms
 * Reference: documentation/Porting-to-Little-CMS.md Phase 5
 */
int KOnlyGCRSampler1D(
    CMSREGISTER const cmsUInt16Number In[],
    CMSREGISTER cmsUInt16Number Out[],
    CMSREGISTER void* Cargo)
{
    (void)In;
    (void)Out;
    (void)Cargo;

    // TODO: Implement 1D sampler
    // Direct gray → K mapping with BPC

    return FALSE;  // Not implemented
}

/**
 * Main pipeline factory function for K-Only BPC+GCR intent
 *
 * This is the entry point called by Little-CMS when the K-Only intent is requested.
 * Creates a complete transformation pipeline with K-Only BPC + GCR.
 *
 * Reference: documentation/Porting-to-Little-CMS.md Phase 6
 */
cmsPipeline* BlackPreservingKOnlyGCRIntents(
    cmsContext ContextID,
    cmsUInt32Number nProfiles,
    cmsUInt32Number TheIntents[],
    cmsHPROFILE hProfiles[],
    cmsBool BPC[],
    cmsFloat64Number AdaptationStates[],
    cmsUInt32Number dwFlags)
{
    // Validate: Must have exactly 2 profiles (input → output)
    if (nProfiles != 2) {
        return NULL;
    }

    cmsHPROFILE hInputProfile = hProfiles[0];
    cmsHPROFILE hOutputProfile = hProfiles[1];
    cmsUInt32Number baseIntent = TheIntents[0];

    // Validate: Output must be CMYK
    cmsColorSpaceSignature outputColorSpace = cmsGetColorSpace(hOutputProfile);
    if (outputColorSpace != cmsSigCmykData) {
        return NULL; // K-Only GCR only works for CMYK output
    }

    // Detect input color space
    cmsColorSpaceSignature inputColorSpace = cmsGetColorSpace(hInputProfile);
    cmsUInt32Number inputChannels = cmsChannelsOf(inputColorSpace);

    // Only support RGB (3), Lab (3), Gray (1) input for now
    if (inputChannels != 1 && inputChannels != 3) {
        return NULL;
    }

    // 1. Create Lab profile for intermediate conversions
    cmsHPROFILE hLabProfile = cmsCreateLab4ProfileTHR(ContextID, NULL);
    if (!hLabProfile) {
        return NULL;
    }

    // 2. Determine input data type based on color space
    cmsUInt32Number inputType;
    if (inputChannels == 1) {
        inputType = TYPE_GRAY_FLT;
    } else if (inputChannels == 3) {
        if (inputColorSpace == cmsSigRgbData) {
            inputType = TYPE_RGB_FLT;
        } else {
            inputType = TYPE_Lab_FLT;
        }
    } else {
        inputType = TYPE_CMYK_FLT;
    }

    // 3. Create high-level transforms for sampler (works for both matrix and LUT profiles)
    // IMPORTANT: Use INTENT_RELATIVE_COLORIMETRIC to avoid circular recursion
    // (baseIntent might be our own K-Only GCR intent)
    cmsUInt32Number internalIntent = INTENT_RELATIVE_COLORIMETRIC;

    // IMPORTANT: Enable BPC on internal transforms to match JavaScript behavior!
    // JS creates transforms with BPC:true (REVISION x16d), which adds BPC stages to pipeline.
    // Both Little-CMS BPC and custom K-Only BPC are applied (this matches JS).
    cmsHTRANSFORM input2lab = cmsCreateTransformTHR(
        ContextID,
        hInputProfile, inputType,
        hLabProfile, TYPE_Lab_FLT,
        internalIntent,
        cmsFLAGS_NOCACHE | cmsFLAGS_BLACKPOINTCOMPENSATION
    );

    // Enable BPC to match JavaScript (transformLab2OutputDevice with BPC:true)
    // Confirmed: JS uses 8 pipeline stages (with BPC) vs 6 (without BPC)
    cmsHTRANSFORM lab2cmyk = cmsCreateTransformTHR(
        ContextID,
        hLabProfile, TYPE_Lab_FLT,
        hOutputProfile, TYPE_CMYK_FLT,
        internalIntent,
        cmsFLAGS_NOCACHE | cmsFLAGS_BLACKPOINTCOMPENSATION
    );

    cmsHTRANSFORM cmyk2lab = cmsCreateTransformTHR(
        ContextID,
        hOutputProfile, TYPE_CMYK_FLT,
        hLabProfile, TYPE_Lab_FLT,
        internalIntent,
        cmsFLAGS_NOCACHE | cmsFLAGS_BLACKPOINTCOMPENSATION
    );

    // Check if all transforms were created successfully
    if (!input2lab || !lab2cmyk || !cmyk2lab) {
        if (input2lab) cmsDeleteTransform(input2lab);
        if (lab2cmyk) cmsDeleteTransform(lab2cmyk);
        if (cmyk2lab) cmsDeleteTransform(cmyk2lab);
        cmsCloseProfile(hLabProfile);
        return NULL;
    }

    // 4. Calculate K-Only BPC scale and get K-only blackpoint
    // Use RELATIVE_COLORIMETRIC intent to avoid recursion
    cmsCIELab kOnlyBlackpointLab;
    cmsFloat64Number kOnlyBpcScale = ComputeKOnlyBPCScale(ContextID, hOutputProfile, INTENT_RELATIVE_COLORIMETRIC, &kOnlyBlackpointLab);
    
    #if K_ONLY_PARITY_DEBUGGING
    fprintf(stderr, "\n[C] K-Only BPC Scale: %.6f\n", kOnlyBpcScale);
    fprintf(stderr, "[C] K-Only Blackpoint Lab: L=%.2f, a=%.2f, b=%.2f\n", 
            kOnlyBlackpointLab.L, kOnlyBlackpointLab.a, kOnlyBlackpointLab.b);
    #endif
    
    // IMPORTANT: Despite the confusing name, scaledOutputKOnlyBlackpointLab in JS (line 1406)
    // actually stores the UNSCALED outputKOnlyBlackLab value!
    // The scaled version is computed on line 1403 but never used in the boundary check.
    // This matches the JS implementation exactly.
    cmsCIELab scaledKOnlyBlackpointLab = kOnlyBlackpointLab;
    
    #if K_ONLY_PARITY_DEBUGGING
    fprintf(stderr, "[C] scaledOutputKOnlyBlackpointLab (unscaled!): L=%.2f, a=%.2f, b=%.2f\n\n", 
            scaledKOnlyBlackpointLab.L, scaledKOnlyBlackpointLab.a, scaledKOnlyBlackpointLab.b);
    #endif

    // 7. Detect maximum GCR (profile already uses maximum K)
    // Transform CMYK(100,100,100,100) → Lab → CMYK and check result
    cmsBool isMaximumGCR = FALSE;
    if (fabs(1.0 - kOnlyBpcScale) < 0.0000001) {
        cmsFloat64Number testCMYK[4] = { 100.0, 100.0, 100.0, 100.0 };
        cmsFloat64Number resultCMYK[4];

        // CMYK → Lab
        // Convert CMYK double to Float32 array and scale from 0-100 to 0-1 range
        cmsFloat32Number testCMYKFloat[4];
        testCMYKFloat[0] = (cmsFloat32Number)(testCMYK[0] / 100.0);
        testCMYKFloat[1] = (cmsFloat32Number)(testCMYK[1] / 100.0);
        testCMYKFloat[2] = (cmsFloat32Number)(testCMYK[2] / 100.0);
        testCMYKFloat[3] = (cmsFloat32Number)(testCMYK[3] / 100.0);

        cmsFloat32Number testLabFloat[3];
        cmsDoTransform(cmyk2lab, testCMYKFloat, testLabFloat, 1);

        // Convert Float32 Lab to cmsCIELab struct
        cmsCIELab testLab;
        testLab.L = (cmsFloat64Number)testLabFloat[0];
        testLab.a = (cmsFloat64Number)testLabFloat[1];
        testLab.b = (cmsFloat64Number)testLabFloat[2];

        // Lab → CMYK
        // Convert cmsCIELab struct to Float32 array
        cmsFloat32Number labForCMYKFloat[3];
        labForCMYKFloat[0] = (cmsFloat32Number)testLab.L;
        labForCMYKFloat[1] = (cmsFloat32Number)testLab.a;
        labForCMYKFloat[2] = (cmsFloat32Number)testLab.b;

        cmsFloat32Number resultCMYKFloat[4];
        cmsDoTransform(lab2cmyk, labForCMYKFloat, resultCMYKFloat, 1);

        // Convert Float32 CMYK to double and scale from 0-1 to 0-100 range
        resultCMYK[0] = (cmsFloat64Number)(resultCMYKFloat[0] * 100.0);
        resultCMYK[1] = (cmsFloat64Number)(resultCMYKFloat[1] * 100.0);
        resultCMYK[2] = (cmsFloat64Number)(resultCMYKFloat[2] * 100.0);
        resultCMYK[3] = (cmsFloat64Number)(resultCMYKFloat[3] * 100.0);

        // Check if C+M+Y ≈ 0 and K ≈ 100
        cmsFloat64Number cmy = resultCMYK[0] + resultCMYK[1] + resultCMYK[2];
        if (cmy < 0.000001 && resultCMYK[3] > 99.99999) {
            isMaximumGCR = TRUE;
        }
    }

    // 5. Set up sampler parameters
    KOnlyGCRParams* params = (KOnlyGCRParams*)_cmsMalloc(ContextID, sizeof(KOnlyGCRParams));
    if (!params) {
        cmsDeleteTransform(input2lab);
        cmsDeleteTransform(lab2cmyk);
        cmsDeleteTransform(cmyk2lab);
        cmsCloseProfile(hLabProfile);
        return NULL;
    }

    params->input2lab = input2lab;
    params->lab2cmyk = lab2cmyk;
    params->cmyk2lab = cmyk2lab;
    params->kOnlyBpcScale = kOnlyBpcScale;
    params->scaledKOnlyBlackpointLab = scaledKOnlyBlackpointLab;
    params->neutralTolerance = 2.0;
    params->isMaximumGCR = isMaximumGCR;
    params->debugEnabled = (dwFlags & cmsFLAGS_DEBUG_K_ONLY_GCR) ? TRUE : FALSE;
    params->inputColorSpace = inputColorSpace;
    params->inputChannels = inputChannels;

    // 9. Create CLUT stage
    cmsStage* clutStage = NULL;
    const cmsUInt32Number gridPoints = 17; // Standard grid size

    if (inputChannels == 1) {
        // 1D LUT for Gray input
        clutStage = cmsStageAllocCLut16bit(ContextID, gridPoints, 1, 4, NULL);
        if (clutStage) {
            cmsStageSampleCLut16bit(clutStage, KOnlyGCRSampler1D, params, 0);
        }
    } else if (inputChannels == 3) {
        // 3D LUT for RGB/Lab input
        clutStage = cmsStageAllocCLut16bit(ContextID, gridPoints, 3, 4, NULL);
        if (clutStage) {
            cmsStageSampleCLut16bit(clutStage, KOnlyGCRSampler3D, params, 0);
        }
    }

    // Cleanup transforms - they're only needed during CLUT sampling, not during actual transforms
    // The sampler functions have already been called by cmsStageSampleCLut16bit above
    cmsDeleteTransform(input2lab);
    cmsDeleteTransform(lab2cmyk);
    cmsDeleteTransform(cmyk2lab);

    // Cleanup temporary resources
    cmsCloseProfile(hLabProfile);

    // Free params structure
    _cmsFree(ContextID, params);

    if (!clutStage) {
        return NULL;
    }

    // 10. Build final pipeline with CLUT
    cmsPipeline* pipeline = cmsPipelineAlloc(ContextID, inputChannels, 4);
    if (!pipeline) {
        cmsStageFree(clutStage);
        return NULL;
    }

    // Insert CLUT stage into pipeline
    cmsPipelineInsertStage(pipeline, cmsAT_END, clutStage);

    // Note: The CLUT stage now contains a baked lookup table
    // The transforms and params used during sampling have been cleaned up

    return pipeline;
}

/**
 * PLUGIN REGISTRATION
 *
 * Instead of patching cmscnvrt.c's DefaultIntents array, we use Little-CMS's
 * plugin system (cmsPluginRenderingIntent) to register the intent at runtime.
 *
 * This avoids function pointer table issues in WebAssembly and provides a
 * cleaner architecture that doesn't modify Little-CMS source code.
 */

// Plugin descriptor for K-Only GCR intent
static cmsPluginRenderingIntent KOnlyGCRIntentPlugin = {
    .base = {
        .Magic = cmsPluginMagicNumber,
        .ExpectedVersion = 2090,  // Little-CMS 2.9
        .Type = cmsPluginRenderingIntentSig,
        .Next = NULL
    },
    .Intent = INTENT_PRESERVE_K_ONLY_RELATIVE_COLORIMETRIC_GCR,
    .Link = BlackPreservingKOnlyGCRIntents,
    .Description = "K-Only BPC + GCR (relative colorimetric)"
};

/**
 * Register K-Only GCR intent plugin
 *
 * This function must be called after the WASM module loads and before
 * creating any transforms with the custom intent.
 *
 * @return cmsBool TRUE on success, FALSE on failure
 */
EMSCRIPTEN_KEEPALIVE
cmsBool RegisterKOnlyGCRIntent(void) {
    return cmsPlugin(&KOnlyGCRIntentPlugin);
}
