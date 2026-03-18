// @ts-check

import convert from './convert.js';
import { eColourType, eProfileType, eIntent } from './def.js';


/** 
 * Applies black point compensation to a source Lab color.
 * 
 * @param {import('./def.js')._cmsLab} sourceLab
 * @param {number} scale 
 * @param {import('./def.js')._cmsWhitePoint} [destinationWhitepoint]
 * @param {boolean} [debugTrace] Enable BPC transformation tracing for Pure Black
 */
export const applyBlackpointCompensation = (sourceLab, scale, destinationWhitepoint = sourceLab.whitePoint, debugTrace = false) => {
    if (debugTrace && sourceLab.L < 1.0) {
        console.error(`\n[JS BPC Trace] Input Lab: L=${sourceLab.L.toFixed(6)}, a=${sourceLab.a.toFixed(6)}, b=${sourceLab.b.toFixed(6)}`);
        console.error(`[JS BPC Trace] BPC scale: ${scale.toFixed(6)}`);
    }

    const sourceXYZ = convert.Lab2XYZ(sourceLab);
    
    if (debugTrace && sourceLab.L < 1.0) {
        console.error(`[JS BPC Trace] Lab→XYZ: X=${sourceXYZ.X.toFixed(6)}, Y=${sourceXYZ.Y.toFixed(6)}, Z=${sourceXYZ.Z.toFixed(6)}`);
    }

    const sourceFlatXYZ = { ...sourceXYZ, X: sourceXYZ.X / sourceLab.whitePoint.X, Y: sourceXYZ.Y, Z: sourceXYZ.Z / sourceLab.whitePoint.Z };
    
    if (debugTrace && sourceLab.L < 1.0) {
        console.error(`[JS BPC Trace] Flattened source XYZ: X=${sourceFlatXYZ.X.toFixed(6)}, Y=${sourceFlatXYZ.Y.toFixed(6)}, Z=${sourceFlatXYZ.Z.toFixed(6)}`);
    }

    const destinationFlatXYZ = { ...sourceFlatXYZ, X: sourceFlatXYZ.X * scale + (1 - scale), Y: sourceFlatXYZ.Y * scale + (1 - scale), Z: sourceFlatXYZ.Z * scale + (1 - scale) };
    
    if (debugTrace && sourceLab.L < 1.0) {
        console.error(`[JS BPC Trace] Scaled flat XYZ: X=${destinationFlatXYZ.X.toFixed(6)}, Y=${destinationFlatXYZ.Y.toFixed(6)}, Z=${destinationFlatXYZ.Z.toFixed(6)}`);
    }

    const destinationXYZ = { ...destinationFlatXYZ, X: destinationFlatXYZ.X / destinationWhitepoint.X, Y: destinationFlatXYZ.Y, Z: destinationFlatXYZ.Z / destinationWhitepoint.Z };
    
    if (debugTrace && sourceLab.L < 1.0) {
        console.error(`[JS BPC Trace] Final destination XYZ: X=${destinationXYZ.X.toFixed(6)}, Y=${destinationXYZ.Y.toFixed(6)}, Z=${destinationXYZ.Z.toFixed(6)}`);
    }

    const result = convert.XYZ2Lab(destinationXYZ, destinationWhitepoint);
    
    if (debugTrace && sourceLab.L < 1.0) {
        console.error(`[JS BPC Trace] Output Lab: L=${result.L.toFixed(6)}, a=${result.a.toFixed(6)}, b=${result.b.toFixed(6)}\n`);
    }

    return result;
};

/**
 * Converts L* to Y using the CIE standard formula.
 * 
 * @param {number} L
 * @returns {number} Y
 */
export const encodeL = L => L < 0 ? - encodeL(-L) : L > 8 ? ((L + 16) / 116) ** 3 * 0.8 : L * (116 / (8 + 16)) ** 3;

/**
 * Converts Y to L* using the CIE standard formula. 
 * @param {number} Y
 * @returns {number} 
 */
export const decodeL = Y => Y < 0 ? - decodeL(-Y) : 0 >= 0 && Y <= 8 ? Y * (((8 + 16) / 116) ** 3) / 0.8 : Y > 8 ? ((Y + 16) / 116) ** 3 : NaN;


/**
 * 7.1. Estimating the Black Point
 * 
 * @param {import('./profile.js').Profile} profile
 * @param {eIntent} intent
 * @param {Lab2CMYKTransform | Lab2RGBTransform | Lab2GrayTransform | Lab2LabTransform} perceptualLab2DeviceTransform
 * @param {CMYK2LabTransform | RGB2LabTransform | Gray2LabTransform | Lab2LabTransform} relativeDevice2LabTransform
 * @param {Lab2CMYKTransform | Lab2RGBTransform | Lab2GrayTransform | Lab2LabTransform} userIntentLab2DeviceTransform
 * @param {CMYK2LabTransform | RGB2LabTransform | Gray2LabTransform | Lab2LabTransform} userIntentDevice2LabTransform
 * @param {import('./def.js')._cmsCMYK | import('./def.js')._cmsLab | import('./def.js')._cmsGray | import('./def.js')._cmsRGB} [localBlack]
 * @param {boolean|Record<string, boolean>} [debugging=false]
 */
export const estimateBlackpoint = (
    profile,
    intent,
    perceptualLab2DeviceTransform,
    relativeDevice2LabTransform,
    userIntentLab2DeviceTransform,
    userIntentDevice2LabTransform,
    localBlack,
    debugging = false,
) => {
    /** @type {import('./def.js')._cmsLab} */
    let estimatedBlackpointLab;

    switch (profile.type) {
        case eProfileType.CMYK: {
            localBlack ??= /** @type {Lab2CMYKTransform} */ (perceptualLab2DeviceTransform).forward(convert.L(0, 0, 0));
            estimatedBlackpointLab = /** @type {CMYK2LabTransform} */ (relativeDevice2LabTransform).forward(/** @type {import('./def.js')._cmsCMYK} */(localBlack));
            estimatedBlackpointLab.a = estimatedBlackpointLab.b = 0;
            if (debugging) console.log({ localBlack, estimatedBlackpointLab });
            break;
        }
        case eProfileType.RGBLut:
        case eProfileType.RGBMatrix: {
            localBlack ??= convert.RGB(0, 0, 0);
            estimatedBlackpointLab = /** @type {RGB2LabTransform} */ (userIntentDevice2LabTransform).forward(/** @type {import('./def.js')._cmsRGB} */(localBlack));
            if (debugging) console.log({ localBlack, estimatedBlackpointLab });
            break;
        }
        case eProfileType.Lab: {
            localBlack ??= (convert.Lab(0, 0, 0));
            estimatedBlackpointLab = /** @type {Lab2LabTransform} */ (userIntentDevice2LabTransform).forward(/** @type {import('./def.js')._cmsLab} */(localBlack));
            if (debugging) console.log({ localBlack, estimatedBlackpointLab });
            break;
        }
        case eProfileType.Gray: {
            localBlack ??= convert.Gray(0);
            estimatedBlackpointLab = /** @type {Gray2LabTransform} */ (userIntentDevice2LabTransform).forward(/** @type {import('./def.js')._cmsGray} */(localBlack));
            if (debugging) console.log({ localBlack, estimatedBlackpointLab });
            break;
        }
        default:
            throw new Error(`Unsupported profile type for blackpoint estimation: ${profile.type}`);
    }
    estimatedBlackpointLab.L = Math.min(50, estimatedBlackpointLab.L);
    return estimatedBlackpointLab;
};

/**
 * Estimates the destination black point for nearly straight mid-range cases.
 * @param {import('./def.js')._cmsLab} initialLab - The initial Lab color space values.
 * @param {(lab:import('./def.js')._cmsLab ) => import('./def.js')._cmsLab} BT - The function to apply the black point transformation.
 * @param {string} intent - The rendering intent ('relative', 'perceptual', 'saturation')
 * @param {boolean} debug - Whether to output debug information
 */
export const estimateNearlyStraightMidRangeBlackpointR1 = (initialLab, BT, intent = 'relative', debug = false) => {
    /*
    For the remaining cases, i.e., if NearlyStraightMidRange is set to false in Step 3, the BPC algorithm
    estimates the Destination Black Point from the L*-curve of CR=BT(R), which we will refer to as the round-trip curve.
    The round-trip curve normally looks like a nearly constant section at the black point, with a corner and a nearly
    straight line to the white point.

    The algorithm estimates the length of the constant section to estimate the Destination Black Point. The
    problem is that there is often noise in the constant section, and the corner is often rounded. The algorithm
    ignores any "toe" around the black point and estimates exactly where the extrapolated round trip curve would
    intersect the nearly constant black limited area. The algorithm then fits a least squares error quadratic curve
    though the shadow section of the curve, and it uses the point where this curve intersects the L*=0 round trip
    value as the Destination Black Point.

    [Graph Description: L* of input gray ramp R (from 0 .. 100) on the x-axis and L* of converted ramp (from 0 .. 100) on the y-axis, showing an S-Curve]

    The algorithm executes as follows:

        1. Let L*K = L* of converted ramp at input L* = 0, and L*W = L* of converted ramp at input L* = 100.

        2. Let y = (L - L*K) / (L*W - L*K) for L = L*K .. L*W (y varies from 0 .. 1).
            In the above graph, L*K is y = 0, and L*W is y = 1.

        3. Let the shadow section be points on curve such that 0.1 ≤ y < 0.5, for Relative Colorimetric 
            intent, or 0.03 ≤ y < 0.25 for Perceptual or Saturation intents.

        4. Fit a least squares error quadratic curve y = tx**2 + ux + c through the shadow section. For
            points (x, y) in the shadow section, values of x will be the L* of the input gray 
            ramp, and y will be the L* of the converted ramp, scaled to 0 .. 1 (see Step 2.e.ii. above).

        5. Compute the x-coordinate of the vertex of the quadratic curve: x = -u/2t. The vertex of the 
            fitted quadratic curve is an approximation for when the shadow region intersects the constant 
            section (L*K). Use this value, x, as the L* of the Destination Black Point.
    */

    // /**
    //  * Computes the determinant of a 3x3 matrix.
    //  * @param {MatrixArray3x3} matrices - The 3x3 matrix.
    //  * @returns {number} - The determinant of the matrix.
    //  */
    // const determinant = ([a, b, c]) => (
    //     a[0] * (b[1] * c[2] - b[2] * c[1]) -
    //     a[1] * (b[0] * c[2] - b[2] * c[0]) +
    //     a[2] * (b[0] * c[1] - b[1] * c[0])
    // );

    // const replaceColumn = (matrix, column, values) => {
    //     const newMatrix = matrix.map(row => [...row]);
    //     for (let i = 0; i < 3; i++)
    //         newMatrix[i][column] = values[i];
    //     return newMatrix;
    // };

    // /**
    //  * Fits a quadratic curve y = tx^2 + ux + c to the given points using least squares.
    //  * 
    //  * @param {{x: number, y: number}[]} points
    //  */
    // const fitQuadraticCurve = (points) => {
    //     const n = points.length;
    //     if (n < 3) throw new Error("At least 3 points are required");

    //     // Compute the sums
    //     let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumX3 = 0, sumX4 = 0, sumX2Y = 0;

    //     for (const { x, y } of points) {
    //         sumX += x;
    //         sumY += y;
    //         sumXY += x * y;
    //         sumX2 += x * x;
    //         sumX3 += x * x * x;
    //         sumX4 += x * x * x * x;
    //         sumX2Y += x * x * y;
    //     }

    //     // Create coefficient matrix and constants
    //     const A = /** @type {MatrixArray3x3} */([
    //         [sumX4, sumX3, sumX2],
    //         [sumX3, sumX2, sumX],
    //         [sumX2, sumX, n]
    //     ]);

    //     const b = /** @type {VectorArray3} */([sumX2Y, sumXY, sumY]);

    //     // Solve using Cramer's rule
    //     const detA = determinant(A);
    //     if (Math.abs(detA) < 1e-12) throw new Error("Matrix is singular");

    //     const a = determinant(replaceColumn(A, 0, b)) / detA;
    //     const b_coeff = determinant(replaceColumn(A, 1, b)) / detA;
    //     const c = determinant(replaceColumn(A, 2, b)) / detA;

    //     return [a, b_coeff, c];
    // };

    let lK = 0;
    let lW = 0;

    // Step 1
    for (let l = 0; l <= 100; l++) {
        const currentL = BT({ ...initialLab, L: l });
        if (l === 0) {
            lK = currentL.L;
        }
        if (l === 100) {
            lW = currentL.L;
        }
    }

    // Step 2: Find the shadow section (transition region after constant black)
    const shadowSection = [];
    const allPoints = [];
    let constantSectionEnd = -1;

    for (let l = 0; l <= 100; l++) {
        const convertedL = BT({ ...initialLab, L: l }).L;
        const y = (convertedL - lK) / (lW - lK);
        allPoints.push({ x: l, y, convertedL });
    }

    // Find where the constant section ends (where y starts increasing significantly)
    for (let i = 0; i < allPoints.length - 1; i++) {
        if (allPoints[i].y < 0.01 && allPoints[i + 1].y >= 0.01) {
            constantSectionEnd = i;
            break;
        }
    }

    // If we found the end of constant section, take transition points after it
    if (constantSectionEnd >= 0) {
        // Take points in the early transition region (where curve starts rising)
        const startIdx = constantSectionEnd;
        const endIdx = Math.min(startIdx + 20, allPoints.length); // Take up to 20 points

        for (let i = startIdx; i < endIdx; i++) {
            const point = allPoints[i];
            if (point.y >= 0.01 && point.y <= 0.4) {  // Early transition region
                shadowSection.push({ x: point.x, y: point.y });
            }
        }
    }

    // Debug: Show analysis
    if (debug) {
        console.log(`Constant section ends at index ${constantSectionEnd} (L*=${constantSectionEnd >= 0 ? allPoints[constantSectionEnd].x : 'not found'})`);
        console.log(`Transition region points:`, shadowSection.slice(0, 10));
        if (allPoints.length > 0) {
            console.log(`First few points:`, allPoints.slice(0, 15));
        }
    }

    // Debug: Check if we have enough points and reasonable values
    if (debug) {
        console.log(`Shadow section analysis for L*K=${lK}, L*W=${lW}:`);
        console.log(`Found ${shadowSection.length} shadow points:`, shadowSection.slice(0, 5));
    }

    // Ensure we have enough points for quadratic fitting
    if (shadowSection.length < 3) {
        if (debug) {
            console.log('Not enough shadow points for quadratic fitting, returning initial blackpoint');
        }
        return initialLab;
    }

    // Step 4
    const [t, u, c] = fitQuadraticCurve(shadowSection);

    // Debug: Check quadratic coefficients
    if (debug) {
        console.log(`Quadratic coefficients: t=${t}, u=${u}, c=${c}`);
    }

    if (Math.abs(t) < 1e-10) {
        if (debug) console.log("Quadratic coefficient 't' is too small - curve is nearly linear");
        return { ...initialLab, L: lK };
    }

    // Step 5
    const vertexX = -u / (2 * t);

    // Debug: Check vertex calculation
    if (debug) {
        console.log(`Step 5: Vertex X-coordinate: ${vertexX}`);
        console.log(`Vertex calculation: vertexX = ${-u} / (2 * ${t}) = ${vertexX}`);

        // Additional debugging information
        console.log('Shadow section statistics:');
        console.log(`  Input L* range: ${Math.min(...shadowSection.map(p => p.x))} to ${Math.max(...shadowSection.map(p => p.x))}`);
        console.log(`  Y range: ${Math.min(...shadowSection.map(p => p.y))} to ${Math.max(...shadowSection.map(p => p.y))}`);
        console.log(`  Expected vertex range: 0 to ~${Math.max(...shadowSection.map(p => p.x))}`);

        // Check if vertex is reasonable
        if (vertexX < 0 || vertexX > 100) {
            console.log(`Warning: Vertex X (${vertexX}) is outside reasonable range [0, 100]`);
        }

        // Show the fitted curve evaluation at a few points
        console.log('Fitted curve evaluation:');
        for (let i = 0; i < Math.min(5, shadowSection.length); i++) {
            const point = shadowSection[i];
            const fittedY = t * point.x * point.x + u * point.x + c;
            console.log(`  x=${point.x}, actual y=${point.y}, fitted y=${fittedY}, diff=${Math.abs(point.y - fittedY)}`);
        }
    }

    // Sanity check: vertexX should be within reasonable range
    if (!isFinite(vertexX) || vertexX < 0 || vertexX > 100) {
        if (debug) {
            console.log(`Vertex out of range (${vertexX}), returning initial blackpoint`);
        }
        return initialLab;
    }

    return { ...initialLab, L: vertexX };
};

/**
 * Black Point Estimation Algorithm Implementation
 * Based on ICC specification for Black Point Compensation
 */

/**
 * Computes the determinant of a 3x3 matrix.
 * @param {MatrixArray3x3} matrix - The 3x3 matrix.
 */
export const determinant = ([a, b, c]) => (
    a[0] * (b[1] * c[2] - b[2] * c[1]) -
    a[1] * (b[0] * c[2] - b[2] * c[0]) +
    a[2] * (b[0] * c[1] - b[1] * c[0])
);

/**
 * Replaces a column in a 3x3 matrix.
 * @param {MatrixArray3x3} matrix - The 3x3 matrix.
 * @param {0 | 1 | 2} column - The column index to replace (0, 1, or 2).
 * @param {VectorArray3} values - The new values for the column.
 */
export const replaceColumn = (matrix, column, values) => {
    const newMatrix = /** @type {MatrixArray3x3} */ (matrix.map(row => [...row]));
    for (let i = 0; i < 3; i++)
        newMatrix[i][column] = values[i];
    return newMatrix;
};

/**
 * Fits a quadratic curve y = tx^2 + ux + c to the given points using least squares.
 * 
 * @param {{x: number, y: number}[]} points
 */
const fitQuadraticCurve = (points) => {
    const n = points.length;
    if (n < 3) throw new Error("At least 3 points are required");

    // Compute the sums
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumX3 = 0, sumX4 = 0, sumX2Y = 0;

    for (const { x, y } of points) {
        sumX += x;
        sumY += y;
        sumXY += x * y;
        sumX2 += x * x;
        sumX3 += x * x * x;
        sumX4 += x * x * x * x;
        sumX2Y += x * x * y;
    }

    // Create coefficient matrix and constants
    const a0 = /** @type {MatrixArray3x3} */([
        [sumX4, sumX3, sumX2],
        [sumX3, sumX2, sumX],
        [sumX2, sumX, n]
    ]);

    const b0 = /** @type {VectorArray3} */([sumX2Y, sumXY, sumY]);

    // Solve using Cramer's rule
    const aDeterminant = determinant(a0);

    if (Math.abs(aDeterminant) < /* Floating point error tolerance for 0 */ 1e-12)
        throw new Error("Matrix is singular");

    const a = determinant(replaceColumn(a0, 0, b0)) / aDeterminant;
    const b = determinant(replaceColumn(a0, 1, b0)) / aDeterminant;
    const c = determinant(replaceColumn(a0, 2, b0)) / aDeterminant;

    return [a, b, c];
};

/**
 * Estimates the destination black point for nearly straight mid-range cases.
 * @param {import('./def.js')._cmsLab} initialLab - The initial Lab color space values.
 * @param {(lab:import('./def.js')._cmsLab ) => import('./def.js')._cmsLab} BT - The function to apply the black point transformation.
 * @param {string} intent - The rendering intent ('relative', 'perceptual', 'saturation')
 * @param {boolean} debug - Whether to output debug information
 */
export const estimateNearlyStraightMidRangeBlackpointR2 = (initialLab, BT, intent = 'relative', debug = false) => {
    /*
    For the remaining cases, i.e., if NearlyStraightMidRange is set to false in Step 3, the BPC algorithm
    estimates the Destination Black Point from the L*-curve of CR=BT(R), which we will refer to as the round-trip curve.
    The round-trip curve normally looks like a nearly constant section at the black point, with a corner and a nearly
    straight line to the white point.

    The algorithm estimates the length of the constant section to estimate the Destination Black Point. The
    problem is that there is often noise in the constant section, and the corner is often rounded. The algorithm
    ignores any "toe" around the black point and estimates exactly where the extrapolated round trip curve would
    intersect the nearly constant black limited area. The algorithm then fits a least squares error quadratic curve
    though the shadow section of the curve, and it uses the point where this curve intersects the L*=0 round trip
    value as the Destination Black Point.

    [Graph Description: L* of input gray ramp R (from 0 .. 100) on the x-axis and L* of converted ramp (from 0 .. 100) on the y-axis, showing an S-Curve]

    The algorithm executes as follows:

        1. Let L*K = L* of converted ramp at input L* = 0, and L*W = L* of converted ramp at input L* = 100.

        2. Let y = (L - L*K) / (L*W - L*K) for L = L*K .. L*W (y varies from 0 .. 1).
            In the above graph, L*K is y = 0, and L*W is y = 1.

        3. Let the shadow section be points on curve such that 0.1 ≤ y < 0.5, for Relative Colorimetric 
            intent, or 0.03 ≤ y < 0.25 for Perceptual or Saturation intents.

        4. Fit a least squares error quadratic curve y = tx**2 + ux + c through the shadow section. For
            points (x, y) in the shadow section, values of x will be the L* of the input gray 
            ramp, and y will be the L* of the converted ramp, scaled to 0 .. 1 (see Step 2.e.ii. above).

        5. Compute the x-coordinate of the vertex of the quadratic curve: x = -u/2t. The vertex of the 
            fitted quadratic curve is an approximation for when the shadow region intersects the constant 
            section (L*K). Use this value, x, as the L* of the Destination Black Point.
    */

    // Step 1: Get the endpoint values
    const lK = BT({ ...initialLab, L: 0 }).L;
    const lW = BT({ ...initialLab, L: 100 }).L;

    if (debug) {
        console.log(`Step 1: L*K = ${lK}, L*W = ${lW}`);
    }

    // Validate that we have a reasonable range
    if (Math.abs(lW - lK) < 0.001) {
        if (debug) console.log("Warning: L*W and L*K are too close, returning initial estimate");
        return { ...initialLab, L: lK };
    }

    // Step 2 & 3: Collect shadow section points
    const shadowSection = [];
    const allPoints = []; // For debugging

    // Define shadow range based on intent
    const shadowRange = intent === 'relative' ? { min: 0.1, max: 0.5 } : { min: 0.03, max: 0.25 };

    for (let inputL = 0; inputL <= 100; inputL += 1) { // Use 1-unit steps for better precision
        const convertedL = BT({ ...initialLab, L: inputL }).L;
        const y = (convertedL - lK) / (lW - lK);

        allPoints.push({ inputL, convertedL, y });

        if (y >= shadowRange.min && y < shadowRange.max) {
            shadowSection.push({ x: inputL, y });
        }
    }

    if (debug) {
        console.log(`Step 2-3: Found ${shadowSection.length} points in shadow section (${shadowRange.min} ≤ y < ${shadowRange.max})`);
        console.log('First few shadow points:', shadowSection.slice(0, 5));
        console.log('Last few shadow points:', shadowSection.slice(-5));
    }

    // Validate we have enough points for fitting
    if (shadowSection.length < 3) {
        if (debug) console.log("Error: Not enough points in shadow section for quadratic fitting");
        return { ...initialLab, L: lK };
    }

    // Step 4: Fit quadratic curve
    let coefficients;
    try {
        coefficients = fitQuadraticCurve(shadowSection);
    } catch (error) {
        if (debug) console.log("Error fitting quadratic curve:", error.message);
        return { ...initialLab, L: lK };
    }

    const [t, u, c] = coefficients;

    if (debug) {
        console.log(`Step 4: Quadratic coefficients: t=${t}, u=${u}, c=${c}`);
    }

    // Step 5: Compute vertex
    if (Math.abs(t) < 1e-10) {
        if (debug) console.log("Quadratic coefficient 't' is too small - curve is nearly linear");
        return { ...initialLab, L: lK };
    }

    const vertexX = -u / (2 * t);

    if (debug) {
        console.log(`Step 5: Vertex X-coordinate: ${vertexX}`);
        console.log(`Vertex calculation: vertexX = ${-u} / (2 * ${t}) = ${vertexX}`);

        // Additional debugging information
        console.log('Shadow section statistics:');
        console.log(`  Input L* range: ${Math.min(...shadowSection.map(p => p.x))} to ${Math.max(...shadowSection.map(p => p.x))}`);
        console.log(`  Y range: ${Math.min(...shadowSection.map(p => p.y))} to ${Math.max(...shadowSection.map(p => p.y))}`);
        console.log(`  Expected vertex range: 0 to ~${Math.max(...shadowSection.map(p => p.x))}`);

        // Check if vertex is reasonable
        if (vertexX < 0 || vertexX > 100) {
            console.log(`Warning: Vertex X (${vertexX}) is outside reasonable range [0, 100]`);
        }

        // Show the fitted curve evaluation at a few points
        console.log('Fitted curve evaluation:');
        for (let i = 0; i < Math.min(5, shadowSection.length); i++) {
            const point = shadowSection[i];
            const fittedY = t * point.x * point.x + u * point.x + c;
            console.log(`  x=${point.x}, actual y=${point.y}, fitted y=${fittedY}, diff=${Math.abs(point.y - fittedY)}`);
        }
    }

    // Clamp vertex to reasonable range
    const clampedVertexX = Math.max(0, Math.min(100, vertexX));

    if (debug && clampedVertexX !== vertexX) {
        console.log(`Clamped vertex from ${vertexX} to ${clampedVertexX}`);
    }

    return { ...initialLab, L: clampedVertexX };
};



/**
 * Test the blackpoint estimation with synthetic data
 */
export const testBlackpointEstimation = () => {

    for (const [revision, estimateNearlyStraightMidRangeBlackpoint] of Object.entries({ R1: estimateNearlyStraightMidRangeBlackpointR1, R2: estimateNearlyStraightMidRangeBlackpointR2 })) {
        console.log(`\n\n=== Testing Blackpoint Estimation Function (${revision}) ===\n`);

        // Test 1: Simple synthetic data
        console.group(`\nTest 1: Simple synthetic curve (${revision})`);
        // const mockBT1 = ({ L }) => ({ L: L * 0.8 + 5 }); // Linear transformation: L' = 0.8*L + 5
        const mockBT1 = ({ L }) => convert.Lab(L * 0.8 + 5, 0, 0); // Linear transformation: L' = 0.8*L + 5
        // const initialLab1 = { L: 0, a: 0, b: 0 };
        const initialLab1 = (convert.Lab(0, 0, 0));
        const result1 = estimateNearlyStraightMidRangeBlackpoint(initialLab1, mockBT1, 'relative', true);
        console.log(`Result 1: L* = ${result1.L}`);
        console.groupEnd();

        // Test 2: S-curve like transformation
        console.group(`\nTest 2: S-curve transformation (${revision})`);
        const mockBT2 = ({ L }) => convert.Lab(10 + 80 * (1 / (1 + Math.exp(-0.1 * (L - 50)))), 0, 0); // Sigmoid curve
        const result2 = estimateNearlyStraightMidRangeBlackpoint(initialLab1, mockBT2, 'relative', true);
        console.log(`Result 2: L* = ${result2.L}`);
        console.groupEnd();

        // Test 3: Quadratic transformation
        console.group(`\nTest 3: Quadratic transformation (${revision})`);
        const mockBT3 = ({ L }) => convert.Lab(5 + 0.0085 * L * L, 0, 0); // Quadratic: L' = 5 + 0.0085*L²
        const result3 = estimateNearlyStraightMidRangeBlackpoint(initialLab1, mockBT3, 'relative', true);
        console.log(`Result 3: L* = ${result3.L}`);
        console.groupEnd();
    }

    console.group(`=== Testing Blackpoint Estimation Helper Functions ===\n`);

    // Test 4: Test matrix operations
    console.group('Test 4: Matrix operations');
    const testMatrix = /** @type {MatrixArray3x3} */ ([[1, 2, 3], [4, 5, 6], [7, 8, 9]]);
    console.groupEnd();

    console.group('Test matrix determinant:', determinant(testMatrix));
    const replacedMatrix = replaceColumn(testMatrix, 1, [10, 11, 12]);
    console.log('Matrix with column 1 replaced:', replacedMatrix);
    console.groupEnd();

    // Test 5: Quadratic fitting with known data
    console.group('Test 5: Quadratic fitting');
    const testPoints = [
        { x: 0, y: 2 },   // y = 0.5x² + 0.1x + 2
        { x: 1, y: 2.6 },
        { x: 2, y: 4.2 },
        { x: 3, y: 6.8 },
        { x: 4, y: 10.4 }
    ];
    const [a, b, c] = fitQuadraticCurve(testPoints);
    console.log(`Fitted coefficients: a=${a}, b=${b}, c=${c}`);
    console.log(`Expected: a=0.5, b=0.1, c=2`);
    console.log(`Vertex: x=${-b / (2 * a)}, y=${c - b * b / (4 * a)}\n`);
    console.groupEnd();

    console.groupEnd();

    console.log('\nAll tests completed.');
};

// Run tests if this file is executed directly
if (typeof process !== 'undefined' && process.argv && process.argv[1] && process.argv[1].includes('blackpoint-estimation.js')) {
    testBlackpointEstimation();
}

/** @typedef {{ [k in keyof import('./transform.js').Transform]: k extends 'forward' ? (cmsLab: import('./def.js')._cmsLab) => import('./def.js')._cmsLab : import('./transform.js').Transform[k]}} Lab2LabTransform */
/** @typedef {{ [k in keyof import('./transform.js').Transform]: k extends 'forward' ? (cmsLab: import('./def.js')._cmsLab) => import('./def.js')._cmsCMYK : import('./transform.js').Transform[k]}} Lab2CMYKTransform */
/** @typedef {{ [k in keyof import('./transform.js').Transform]: k extends 'forward' ? (cmsLab: import('./def.js')._cmsLab) => import('./def.js')._cmsRGB : import('./transform.js').Transform[k]}} Lab2RGBTransform */
/** @typedef {{ [k in keyof import('./transform.js').Transform]: k extends 'forward' ? (cmsLab: import('./def.js')._cmsLab) => import('./def.js')._cmsGray : import('./transform.js').Transform[k]}} Lab2GrayTransform */
/** @typedef {{ [k in keyof import('./transform.js').Transform]: k extends 'forward' ? (cmsCMYK: import('./def.js')._cmsCMYK) => import('./def.js')._cmsLab : import('./transform.js').Transform[k]}} CMYK2LabTransform */
/** @typedef {{ [k in keyof import('./transform.js').Transform]: k extends 'forward' ? (cmsRGB: import('./def.js')._cmsRGB) => import('./def.js')._cmsLab : import('./transform.js').Transform[k]}} RGB2LabTransform */
/** @typedef {{ [k in keyof import('./transform.js').Transform]: k extends 'forward' ? (cmsRGB: import('./def.js')._cmsGray) => import('./def.js')._cmsLab : import('./transform.js').Transform[k]}} Gray2LabTransform */
/** @typedef {{ [k in keyof import('./transform.js').Transform]: k extends 'forward' ? (cmsLab: import('./def.js')._cmsRGB) => import('./def.js')._cmsCMYK : import('./transform.js').Transform[k]}} RGB2CMYKTransform */
/** @typedef {{ [k in keyof import('./transform.js').Transform]: k extends 'forward' ? (cmsCMYK: import('./def.js')._cmsCMYK) => import('./def.js')._cmsRGB : import('./transform.js').Transform[k]}} CMYK2RGBTransform */

/** @typedef {[number,number, number]} VectorArray3 */
/** @typedef {[VectorArray3,VectorArray3,VectorArray3]} MatrixArray3x3 */
