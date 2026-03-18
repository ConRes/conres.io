/**
 * Legacy Interpolation Functions
 * 
 * This file contains the original baseline implementations of interpolation methods
 * that were refactored and optimized in the main interpolation.js file.
 * 
 * These implementations are preserved for:
 * - Backward compatibility
 * - Reference and validation
 * - Debugging and testing
 * - Performance comparison with optimized versions
 * 
 * Use the useLegacyInterpolation option in Transform constructor to enable these implementations.
 */

// @ts-check

/**
 * 3D Trilinear interpolation - Legacy implementation
 * 
 * With device LUT's White is one corner and black is the opposite corner, so the
 * data is encoded diagonally across the cube. This means that the tetrahedral
 * interpolation works well in this case and is faster than the trilinear.
 *
 * BUT for the PCS input, the data is encoded vertically from black to white
 * though the middle of the cube. with a/b horizontally and L vertically. This
 * means that in this special case the trilinear interpolation is more accurate.
 *
 * @param {number[]} input
 * @param {import('../decode.js').LUT} lut
 */
export function trilinearInterp3D_NCh_legacy(input, lut) {
    if (!lut?.CLUT) throw new TypeError('Invalid LUT: Missing CLUT');

    // var rx, ry, rz;
    // var x0, x1, y0, y1, z0, z1, px, py, pz, input0, input1, input2;
    // var d000, d001, d010, d011, d100, d101, d110, d111;
    // var dx00, dx01, dx10, dx11, dxy0, dxy1;

    const outputScale = lut.outputScale;
    const outputChannels = lut.outputChannels;
    const gridEnd = (lut.g1 - 1);
    const gridPointsScale = gridEnd * lut.inputScale;
    const CLUT = lut.CLUT;
    const go0 = lut.go0;
    const go1 = lut.go1;
    const go2 = lut.go2;

    const input0 = Math.min(Math.max(input[0], 0), 1);
    const input1 = Math.min(Math.max(input[1], 0), 1);
    const input2 = Math.min(Math.max(input[2], 0), 1);

    // only px needs to be a float
    const px = input0 * gridPointsScale;
    const py = input1 * gridPointsScale;
    const pz = input2 * gridPointsScale;

    let x0 = ~~px; //~~ is the same as Math.floor(px
    let y0 = ~~py;
    let z0 = ~~pz;

    const rx = (px - x0); // get the fractional part
    const ry = (py - y0);
    const rz = (pz - z0);

    let x1 = x0 === gridEnd ? (x0 *= go2) : ((x0 *= go2) + go2);
    let y1 = y0 === gridEnd ? (y0 *= go1) : ((y0 *= go1) + go1);
    let z1 = z0 === gridEnd ? (z0 *= go0) : ((z0 *= go0) + go0);

    /** @type {number[]} */
    const output = new Array(outputChannels);

    for (let c = 0; c < outputChannels; c++) {
        const d000 = CLUT[x0 + y0 + z0];
        const d001 = CLUT[x0 + y0 + z1];
        const d010 = CLUT[x0 + y1 + z0];
        const d011 = CLUT[x0 + y1 + z1];

        const d100 = CLUT[x1 + y0 + z0];
        const d101 = CLUT[x1 + y0 + z1];
        const d110 = CLUT[x1 + y1 + z0];
        const d111 = CLUT[x1 + y1 + z1];

        const dx00 = d000 + (rx * (d100 - d000));
        const dx01 = d001 + (rx * (d101 - d001));
        const dx10 = d010 + (rx * (d110 - d010));
        const dx11 = d011 + (rx * (d111 - d011));

        const dxy0 = dx00 + (ry * (dx10 - dx00));
        const dxy1 = dx01 + (ry * (dx11 - dx01));

        output[c] = (dxy0 + (rz * (dxy1 - dxy0))) * outputScale;

        // To go to the next channel we only need to increment the index by 1
        // so rather than go CLUT(X0 + Y0 + Z0 + c) we just increment the X indexes
        x0++;
        x1++;
    }

    return output;
}

/**
 * Optimised version of tetrahedralInterp3D_Master - Legacy implementation
 * About 70% faster with functions combined
 * @param input
 * @param lut
 * @param K0
 * @returns {number[]}
 */
export function tetrahedralInterp3D_3or4Ch_legacy(input, lut, K0) {
    var rx, ry, rz;
    var inputScale = lut.inputScale;
    var outputScale = lut.outputScale;
    var inputChannels = lut.inputChannels;
    var outputChannels = lut.outputChannels;
    var gridPointsMinus1 = lut.g1 - 1;
    var CLUT = lut.CLUT;
    var g1 = lut.g1;
    var g2 = lut.g2;
    var g3 = lut.g3;

    var c0, c1, c2, c3;
    var X0, X1, Y0, Y1, Z0, Z1, px, py, pz, input0, input1, input2;
    input0 = px = input[0] * inputScale;
    input1 = py = input[1] * inputScale;
    input2 = pz = input[2] * inputScale;

    px = Math.min(Math.max(px, 0.0), 1.0);
    py = Math.min(Math.max(py, 0.0), 1.0);
    pz = Math.min(Math.max(pz, 0.0), 1.0);

    px = px * gridPointsMinus1;
    py = py * gridPointsMinus1;
    pz = pz * gridPointsMinus1;

    X0 = Math.floor(px);
    rx = (px - X0);
    X1 = X0 + (input0 >= 1.0 ? 0.0 : 1.0);

    Y0 = Math.floor(py);
    ry = (py - Y0);
    Y1 = Y0 + (input1 >= 1.0 ? 0.0 : 1.0);

    Z0 = Math.floor(pz);
    rz = (pz - Z0);
    Z1 = Z0 + (input2 >= 1.0 ? 0.0 : 1.0);

    c0 = lookup(X0, Y0, Z0, K0);

    if (rx >= ry && ry >= rz) {
        c1 = sub16lookup(X1, Y0, Z0, K0, c0);
        c2 = sub16Lookup2(X1, Y1, Z0, K0, X1, Y0, Z0, K0);
        c3 = sub16Lookup2(X1, Y1, Z1, K0, X1, Y1, Z0, K0);

    } else if (rx >= rz && rz >= ry) {
        c1 = sub16lookup(X1, Y0, Z0, K0, c0);
        c2 = sub16Lookup2(X1, Y1, Z1, K0, X1, Y0, Z1, K0);
        c3 = sub16Lookup2(X1, Y0, Z1, K0, X1, Y0, Z0, K0);

    } else if (rz >= rx && rx >= ry) {
        c1 = sub16Lookup2(X1, Y0, Z1, K0, X0, Y0, Z1, K0);
        c2 = sub16Lookup2(X1, Y1, Z1, K0, X1, Y0, Z1, K0);
        c3 = sub16lookup(X0, Y0, Z1, K0, c0);

    } else if (ry >= rx && rx >= rz) {
        c1 = sub16Lookup2(X1, Y1, Z0, K0, X0, Y1, Z0, K0);
        c2 = sub16lookup(X0, Y1, Z0, K0, c0);
        c3 = sub16Lookup2(X1, Y1, Z1, K0, X1, Y1, Z0, K0);

    } else if (ry >= rz && rz >= rx) {
        c1 = sub16Lookup2(X1, Y1, Z1, K0, X0, Y1, Z1, K0);
        c2 = sub16lookup(X0, Y1, Z0, K0, c0);
        c3 = sub16Lookup2(X0, Y1, Z1, K0, X0, Y1, Z0, K0);

    } else if (rz >= ry && ry >= rx) {
        c1 = sub16Lookup2(X1, Y1, Z1, K0, X0, Y1, Z1, K0);
        c2 = sub16Lookup2(X0, Y1, Z1, K0, X0, Y0, Z1, K0);
        c3 = sub16lookup(X0, Y0, Z1, K0, c0);

    } else {
        c1 = c2 = c3 = [0, 0, 0, 0];
    }

    if (outputChannels === 3) {
        return [
            (c0[0] + (c1[0] * rx) + (c2[0] * ry) + (c3[0] * rz)) * outputScale,
            (c0[1] + (c1[1] * rx) + (c2[1] * ry) + (c3[1] * rz)) * outputScale,
            (c0[2] + (c1[2] * rx) + (c2[2] * ry) + (c3[2] * rz)) * outputScale,
        ];
    }

    return [
        (c0[0] + (c1[0] * rx) + (c2[0] * ry) + (c3[0] * rz)) * outputScale,
        (c0[1] + (c1[1] * rx) + (c2[1] * ry) + (c3[1] * rz)) * outputScale,
        (c0[2] + (c1[2] * rx) + (c2[2] * ry) + (c3[2] * rz)) * outputScale,
        (c0[3] + (c1[3] * rx) + (c2[3] * ry) + (c3[3] * rz)) * outputScale,
    ];

    function lookup(x, y, z, k) {
        var base;
        if (inputChannels === 3) {
            base = ((x * g2) + (y * g1) + z) * outputChannels;
        } else {
            base = ((k * g3) + (x * g2) + (y * g1) + z) * outputChannels;
        }

        if (outputChannels === 3) {
            return [CLUT[base++], CLUT[base++], CLUT[base]];
        }
        return [CLUT[base++], CLUT[base++], CLUT[base++], CLUT[base]];
    }

    function sub16lookup(x, y, z, k, b) {
        var base, r0, r1, r2, r3;
        if (inputChannels === 3) {
            base = ((x * g2) + (y * g1) + z) * outputChannels;
        } else {
            base = ((k * g3) + (x * g2) + (y * g1) + z) * outputChannels;
        }

        r0 = CLUT[base++] - b[0];
        r1 = CLUT[base++] - b[1];
        r2 = CLUT[base++] - b[2];

        if (outputChannels === 3) {
            return [r0, r1, r2];
        }

        r3 = CLUT[base] - b[3];
        return [r0, r1, r2, r3];
    }

    function sub16Lookup2(x1, y1, z1, k1, x2, y2, z2, k2) {
        var base1, base2;
        var r0, r1, r2, r3;
        if (inputChannels === 3) {
            base1 = ((x1 * g2) + (y1 * g1) + z1) * outputChannels;
            base2 = ((x2 * g2) + (y2 * g1) + z2) * outputChannels;
        } else {
            base1 = ((k1 * g3) + (x1 * g2) + (y1 * g1) + z1) * outputChannels;
            base2 = ((k2 * g3) + (x2 * g2) + (y2 * g1) + z2) * outputChannels;
        }

        r0 = CLUT[base1++] - CLUT[base2++];
        r1 = CLUT[base1++] - CLUT[base2++];
        r2 = CLUT[base1++] - CLUT[base2++];

        if (outputChannels === 3) {
            return [r0, r1, r2];
        }
        r3 = CLUT[base1] - CLUT[base2];
        return [r0, r1, r2, r3];
    }
}

/**
 * 3D Tetrahedral interpolation for 4 channel output - Legacy implementation
 * @param input
 * @param lut
 * @returns {any[]}
 */
export function tetrahedralInterp3D_4Ch_legacy(input, lut) {
    var rx, ry, rz;
    var X0, X1, Y0, Y1, Z0, Z1, px, py, pz, input0, input1, input2;
    var base1, base2, base3, base4,
        c0, c1, c2, c3, a, b;

    var outputScale = lut.outputScale;
    var gridEnd = (lut.g1 - 1);
    var gridPointsScale = gridEnd * lut.inputScale;
    var CLUT = lut.CLUT;
    var go0 = lut.go0;
    var go1 = lut.go1;
    var go2 = lut.go2;

    input0 = Math.min(1, Math.max(0, input[0]));
    input1 = Math.min(1, Math.max(0, input[1]));
    input2 = Math.min(1, Math.max(0, input[2]));


    // Rather than divide input by 255 then multiply by (lut.g1 - 1)
    // Just do this once, this means input0 stays an int and
    // only px needs to be a float
    px = input0 * gridPointsScale;
    py = input1 * gridPointsScale;
    pz = input2 * gridPointsScale;

    //
    // A few optimisations here, X0 is multiplied by go2, which is precalculated grid x outputChannels
    // Keeping input0 as int means we can just check input0 === 255 rather than input0 >= 1.0 as a float
    // And rather than X0+1 we can just do X0 + offset to location in lut
    X0 = ~~px; //~~ is the same as Math.floor(px)
    rx = (px - X0); // get the fractional part
    if (X0 === gridEnd) {
        X1 = X0 *= go2;// change to index in array
    } else {
        X0 *= go2;
        X1 = X0 + go2;
    }

    Y0 = ~~py;
    ry = (py - Y0);
    if (Y0 === gridEnd) {
        Y1 = Y0 *= go1;
    } else {
        Y0 *= go1;
        Y1 = Y0 + go1;
    }

    Z0 = ~~pz;
    rz = (pz - Z0);
    if (Z0 === gridEnd) {
        Z1 = Z0 *= go0;
    } else {
        Z0 *= go0;
        Z1 = Z0 + go0;
    }

    // Starting point in CLUT
    // Note that X0, Y0, Z0 are all multiplied by the grid offset and the outputChannels
    // So we only need additions rather than n = ((X0 * go2) + (Y0 * go1) + Z0)) * outputChannels
    base1 = X0 + Y0 + Z0;
    c0 = CLUT[base1++];
    c1 = CLUT[base1++];
    c2 = CLUT[base1++];
    c3 = CLUT[base1];

    var output = new Array(4);

    if (rx >= ry && ry >= rz) {
        // block1
        base1 = X1 + Y0 + Z0;
        base2 = X1 + Y1 + Z0;
        //base3 = base1; SAME AS base1
        base4 = X1 + Y1 + Z1;
        //base5 = base2; SAME as base2

        // Important performance issues noted in Chrome and Firefox, assigning intermediate variables slows things down a lot
        // Just having one long line of code is much faster, I suspect internally all this math is done in registers,
        // as the JIT can see that variables are not used, so it can just do the math and store the result
        // If we were to use intermediate variables forces the compiler to read/write memory and potentially trigger the GC
        // However using a/b below to read only once from the array does appear to be faster, The less memory reads the better
        //
        // Note that baseN is increased after each read from the array to move to the next channel
        a = CLUT[base1++];
        b = CLUT[base2++];
        output[0] = (c0 + ((a - c0) * rx) + ((b - a) * ry) + ((CLUT[base4++] - b) * rz)) * outputScale;

        a = CLUT[base1++];
        b = CLUT[base2++];
        output[1] = (c1 + ((a - c1) * rx) + ((b - a) * ry) + ((CLUT[base4++] - b) * rz)) * outputScale;

        a = CLUT[base1++];
        b = CLUT[base2++];
        output[2] = (c2 + ((a - c2) * rx) + ((b - a) * ry) + ((CLUT[base4++] - b) * rz)) * outputScale;

        // Duno if this helps, but no need to increase base1/2/3/4 again as we are done with them
        a = CLUT[base1];
        b = CLUT[base2];
        output[3] = (c3 + ((a - c3) * rx) + ((b - a) * ry) + ((CLUT[base4] - b) * rz)) * outputScale;

    } else if (rx >= rz && rz >= ry) {
        // block2

        base1 = X1 + Y0 + Z0;
        base2 = X1 + Y1 + Z1;
        base3 = X1 + Y0 + Z1;
        //base4 = base3;
        //base5 = base1;

        a = CLUT[base3++];
        b = CLUT[base1++];
        output[0] = (c0 + ((b - c0) * rx) + ((CLUT[base2++] - a) * ry) + ((a - b) * rz)) * outputScale;

        a = CLUT[base3++];
        b = CLUT[base1++];
        output[1] = (c1 + ((b - c1) * rx) + ((CLUT[base2++] - a) * ry) + ((a - b) * rz)) * outputScale;

        a = CLUT[base3++];
        b = CLUT[base1++];
        output[2] = (c2 + ((b - c2) * rx) + ((CLUT[base2++] - a) * ry) + ((a - b) * rz)) * outputScale;

        a = CLUT[base3];
        b = CLUT[base1];
        output[3] = (c3 + ((b - c3) * rx) + ((CLUT[base2] - a) * ry) + ((a - b) * rz)) * outputScale;

    } else if (rx >= ry && rz >= rx) {
        // block3

        base1 = X1 + Y0 + Z1;
        base2 = X0 + Y0 + Z1;
        base3 = X1 + Y1 + Z1;
        //base4 = base1;
        //base5 = base2;

        a = CLUT[base1++];
        b = CLUT[base2++];
        output[0] = (c0 + ((a - b) * rx) + ((CLUT[base3++] - a) * ry) + ((b - c0) * rz)) * outputScale;

        a = CLUT[base1++];
        b = CLUT[base2++];
        output[1] = (c1 + ((a - b) * rx) + ((CLUT[base3++] - a) * ry) + ((b - c1) * rz)) * outputScale;

        a = CLUT[base1++];
        b = CLUT[base2++];
        output[2] = (c2 + ((a - b) * rx) + ((CLUT[base3++] - a) * ry) + ((b - c2) * rz)) * outputScale;

        a = CLUT[base1++];
        b = CLUT[base2++];
        output[3] = (c3 + ((a - b) * rx) + ((CLUT[base3] - a) * ry) + ((b - c3) * rz)) * outputScale;

    } else if (ry >= rx && rx >= rz) {
        // block4

        base1 = X1 + Y1 + Z0;
        base2 = X0 + Y1 + Z0;
        //base3 = base2;
        base4 = X1 + Y1 + Z1;
        //base5 = base1;

        a = CLUT[base2++];
        b = CLUT[base1++];
        output[0] = (c0 + ((b - a) * rx) + ((a - c0) * ry) + ((CLUT[base4++] - b) * rz)) * outputScale;

        a = CLUT[base2++];
        b = CLUT[base1++];
        output[1] = (c1 + ((b - a) * rx) + ((a - c1) * ry) + ((CLUT[base4++] - b) * rz)) * outputScale;

        a = CLUT[base2++];
        b = CLUT[base1++];
        output[2] = (c2 + ((b - a) * rx) + ((a - c2) * ry) + ((CLUT[base4++] - b) * rz)) * outputScale;

        a = CLUT[base2];
        b = CLUT[base1];
        output[3] = (c3 + ((b - a) * rx) + ((a - c3) * ry) + ((CLUT[base4] - b) * rz)) * outputScale;

    } else if (ry >= rz && rz >= rx) {
        // block5

        base1 = X1 + Y1 + Z1;
        base2 = X0 + Y1 + Z1;
        base3 = X0 + Y1 + Z0;
        //base4 = base2;
        //base5 = base3;

        a = CLUT[base2++];
        b = CLUT[base3++];
        output[0] = (c0 + ((CLUT[base1++] - a) * rx) + ((b - c0) * ry) + ((a - b) * rz)) * outputScale;

        a = CLUT[base2++];
        b = CLUT[base3++];
        output[1] = (c1 + ((CLUT[base1++] - a) * rx) + ((b - c1) * ry) + ((a - b) * rz)) * outputScale;

        a = CLUT[base2++];
        b = CLUT[base3++];
        output[2] = (c2 + ((CLUT[base1++] - a) * rx) + ((b - c2) * ry) + ((a - b) * rz)) * outputScale;

        a = CLUT[base2++];
        b = CLUT[base3++];
        output[3] = (c3 + ((CLUT[base1++] - a) * rx) + ((b - c3) * ry) + ((a - b) * rz)) * outputScale;

    } else if (rz >= ry && ry >= rx) {
        // block6

        base1 = X1 + Y1 + Z1;
        base2 = X0 + Y1 + Z1;
        //base3 = base2;
        base4 = X0 + Y0 + Z1;
        //base5 = base4;

        a = CLUT[base2++];
        b = CLUT[base4++];
        output[0] = (c0 + ((CLUT[base1++] - a) * rx) + ((a - b) * ry) + ((b - c0) * rz)) * outputScale;

        a = CLUT[base2++];
        b = CLUT[base4++];
        output[1] = (c1 + ((CLUT[base1++] - a) * rx) + ((a - b) * ry) + ((b - c1) * rz)) * outputScale;

        a = CLUT[base2++];
        b = CLUT[base4++];
        output[2] = (c2 + ((CLUT[base1++] - a) * rx) + ((a - b) * ry) + ((b - c2) * rz)) * outputScale;

        a = CLUT[base2];
        b = CLUT[base4];
        output[3] = (c3 + ((CLUT[base1] - a) * rx) + ((a - b) * ry) + ((b - c3) * rz)) * outputScale;

    } else {
        output[0] = c0 * outputScale;
        output[1] = c1 * outputScale;
        output[2] = c2 * outputScale;
        output[3] = c3 * outputScale;
    }

    return output;
}

/**
 * 3D Tetrahedral interpolation for 3 channel output - Legacy implementation
 * @param input
 * @param lut
 * @returns {any[]}
 */
export function tetrahedralInterp3D_3Ch_legacy(input, lut) {
    var rx, ry, rz,
        X0, X1, Y0,
        Y1, Z0, Z1,
        px, py, pz,
        input0, input1, input2;
    var base1, base2, base3, base4,
        c0, c1, c2, a, b;

    var outputScale = lut.outputScale;
    var gridEnd = (lut.g1 - 1);
    var gridPointsScale = gridEnd * lut.inputScale;
    var CLUT = lut.CLUT;
    var go0 = lut.go0;
    var go1 = lut.go1;
    var go2 = lut.go2;

    // We need some clipping here
    input0 = Math.min(1, Math.max(0, input[0]));
    input1 = Math.min(1, Math.max(0, input[1]));
    input2 = Math.min(1, Math.max(0, input[2]));

    // No clipping checks for speed needed for clamped arrays

    // Rather than divide input by 255 then multiply by (lut.g1 - 1)
    // Just do this once, this means input0 stays an int and
    // only px needs to be a float
    px = input0 * gridPointsScale;
    py = input1 * gridPointsScale;
    pz = input2 * gridPointsScale;

    //
    // A few optimisations here, X0 is multiplied by go2, which is precalculated grid x outputChannels
    // Keeping input0 as int means we can just check input0 === 255 rather than input0 >= 1.0 as a float
    // And rather than X0+1 we can just do X0 + offset to location in lut
    X0 = ~~px; //~~ is the same as Math.floor(px)
    rx = (px - X0); // get the fractional part
    if (X0 === gridEnd) {
        X1 = X0 *= go2;
    } else {
        X0 *= go2;
        X1 = X0 + go2;
    }

    Y0 = ~~py;
    ry = (py - Y0);
    if (Y0 === gridEnd) {
        Y1 = Y0 *= go1;
    } else {
        Y0 *= go1;
        Y1 = Y0 + go1;
    }

    Z0 = ~~pz;
    rz = (pz - Z0);
    if (Z0 === gridEnd) {
        Z1 = Z0 *= go0;
    } else {
        Z0 *= go0;
        Z1 = Z0 + go0;
    }

    // Starting point in CLUT
    // Note that X0, Y0, Z0 are all multiplied by the grid offset and the outputChannels
    // So we only need additions rather than n = ((X0 * go2) + (Y0 * go1) + Z0)) * outputChannels
    base1 = X0 + Y0 + Z0;
    c0 = CLUT[base1++];
    c1 = CLUT[base1++];
    c2 = CLUT[base1];

    var output = new Array(3);

    if (rx >= ry && ry >= rz) {
        // block1
        base1 = X1 + Y0 + Z0;
        base2 = X1 + Y1 + Z0;
        //base3 = base1; SAME AS base1
        base4 = X1 + Y1 + Z1;
        //base5 = base2; SAME as base2

        // Important performance issues noted in Chrome and Firefox, assigning intermediate variables slows things down a lot
        // Just having one long line of code is much faster, I suspect internally all this math is done in registers,
        // as the JIT can see that variables are not used, so it can just do the math and store the result
        // If we were to use intermediate variables forces the compiler to read/write memory and potentially trigger the GC
        // However using a/b below to read only once from the array does appear to be faster, The less memory reads the better
        //
        // Note that baseN is increased after each read from the array to move to the next channel
        a = CLUT[base1++];
        b = CLUT[base2++];
        output[0] = (c0 + ((a - c0) * rx) + ((b - a) * ry) + ((CLUT[base4++] - b) * rz)) * outputScale;

        a = CLUT[base1++];
        b = CLUT[base2++];
        output[1] = (c1 + ((a - c1) * rx) + ((b - a) * ry) + ((CLUT[base4++] - b) * rz)) * outputScale;

        a = CLUT[base1];
        b = CLUT[base2];
        output[2] = (c2 + ((a - c2) * rx) + ((b - a) * ry) + ((CLUT[base4] - b) * rz)) * outputScale;


    } else if (rx >= rz && rz >= ry) {
        // block2

        base1 = X1 + Y0 + Z0;
        base2 = X1 + Y1 + Z1;
        base3 = X1 + Y0 + Z1;
        //base4 = base3;
        //base5 = base1;

        a = CLUT[base3++];
        b = CLUT[base1++];
        output[0] = (c0 + ((b - c0) * rx) + ((CLUT[base2++] - a) * ry) + ((a - b) * rz)) * outputScale;

        a = CLUT[base3++];
        b = CLUT[base1++];
        output[1] = (c1 + ((b - c1) * rx) + ((CLUT[base2++] - a) * ry) + ((a - b) * rz)) * outputScale;

        a = CLUT[base3];
        b = CLUT[base1];
        output[2] = (c2 + ((b - c2) * rx) + ((CLUT[base2] - a) * ry) + ((a - b) * rz)) * outputScale;



    } else if (rx >= ry && rz >= rx) {
        // block3

        base1 = X1 + Y0 + Z1;
        base2 = X0 + Y0 + Z1;
        base3 = X1 + Y1 + Z1;
        //base4 = base1;
        //base5 = base2;

        a = CLUT[base1++];
        b = CLUT[base2++];
        output[0] = (c0 + ((a - b) * rx) + ((CLUT[base3++] - a) * ry) + ((b - c0) * rz)) * outputScale;

        a = CLUT[base1++];
        b = CLUT[base2++];
        output[1] = (c1 + ((a - b) * rx) + ((CLUT[base3++] - a) * ry) + ((b - c1) * rz)) * outputScale;

        a = CLUT[base1];
        b = CLUT[base2];
        output[2] = (c2 + ((a - b) * rx) + ((CLUT[base3] - a) * ry) + ((b - c2) * rz)) * outputScale;



    } else if (ry >= rx && rx >= rz) {
        // block4

        base1 = X1 + Y1 + Z0;
        base2 = X0 + Y1 + Z0;
        //base3 = base2;
        base4 = X1 + Y1 + Z1;
        //base5 = base1;

        a = CLUT[base2++];
        b = CLUT[base1++];
        output[0] = (c0 + ((b - a) * rx) + ((a - c0) * ry) + ((CLUT[base4++] - b) * rz)) * outputScale;

        a = CLUT[base2++];
        b = CLUT[base1++];
        output[1] = (c1 + ((b - a) * rx) + ((a - c1) * ry) + ((CLUT[base4++] - b) * rz)) * outputScale;

        a = CLUT[base2];
        b = CLUT[base1];
        output[2] = (c2 + ((b - a) * rx) + ((a - c2) * ry) + ((CLUT[base4] - b) * rz)) * outputScale;


    } else if (ry >= rz && rz >= rx) {
        // block5

        base1 = X1 + Y1 + Z1;
        base2 = X0 + Y1 + Z1;
        base3 = X0 + Y1 + Z0;
        //base4 = base2;
        //base5 = base3;

        a = CLUT[base2++];
        b = CLUT[base3++];
        output[0] = (c0 + ((CLUT[base1++] - a) * rx) + ((b - c0) * ry) + ((a - b) * rz)) * outputScale;

        a = CLUT[base2++];
        b = CLUT[base3++];
        output[1] = (c1 + ((CLUT[base1++] - a) * rx) + ((b - c1) * ry) + ((a - b) * rz)) * outputScale;

        a = CLUT[base2];
        b = CLUT[base3];
        output[2] = (c2 + ((CLUT[base1] - a) * rx) + ((b - c2) * ry) + ((a - b) * rz)) * outputScale;


    } else if (rz >= ry && ry >= rx) {
        // block6

        base1 = X1 + Y1 + Z1;
        base2 = X0 + Y1 + Z1;
        //base3 = base2;
        base4 = X0 + Y0 + Z1;
        //base5 = base4;

        a = CLUT[base2++];
        b = CLUT[base4++];
        output[0] = (c0 + ((CLUT[base1++] - a) * rx) + ((a - b) * ry) + ((b - c0) * rz)) * outputScale;

        a = CLUT[base2++];
        b = CLUT[base4++];
        output[1] = (c1 + ((CLUT[base1++] - a) * rx) + ((a - b) * ry) + ((b - c1) * rz)) * outputScale;

        a = CLUT[base2];
        b = CLUT[base4];
        output[2] = (c2 + ((CLUT[base1] - a) * rx) + ((a - b) * ry) + ((b - c2) * rz)) * outputScale;

    } else {
        output[0] = c0 * outputScale;
        output[1] = c1 * outputScale;
        output[2] = c2 * outputScale;
    }

    return output;
}

/**
 * Linear interpolation for 1D inputs - Legacy implementation (placeholder)
 * For now, this delegates to the optimized version as there's no specific legacy implementation
 * @param {number[]} input
 * @param {import('../decode.js').LUT} lut
 */
export function linearInterp1D_NCh_legacy(input, lut) {
    // TODO: Add actual legacy implementation when needed
    // For now, this would be the same as the optimized version
    throw new Error('Legacy linearInterp1D_NCh implementation not yet extracted');
}

/**
 * Bilinear interpolation for 2D inputs - Legacy implementation (placeholder)
 * For now, this delegates to the optimized version as there's no specific legacy implementation
 * @param {number[]} input
 * @param {import('../decode.js').LUT} lut
 */
export function bilinearInterp2D_NCh_legacy(input, lut) {
    // TODO: Add actual legacy implementation when needed
    // For now, this would be the same as the optimized version
    throw new Error('Legacy bilinearInterp2D_NCh implementation not yet extracted');
}
