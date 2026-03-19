// @ts-check

/**
 * 1D Linear interpolation for monotone (gray) color transformations
 * 
 * @param {number[]} input - Input color values (1 channel)
 * @param {import('./decode.js').LUT} lut - Lookup table structure
 * @returns {number[]} Interpolated output color values
 */
export function linearInterp1D_NCh(input, lut) {
    if (!lut?.CLUT) throw new TypeError('Invalid LUT: Missing CLUT');

    const { outputScale, outputChannels, g1, inputScale, CLUT, go0 } = lut;
    const gridEnd = (g1 - 1);
    const gridPointsScale = gridEnd * inputScale;

    /*
    Not sure if input0 needs to be scaled:
        const input0 = Math.min(Math.max(input[0] * inputScale, 0), 1);
    */
    const input0 = Math.min(Math.max(input[0], 0), 1);
    const px = input0 * gridPointsScale;

    const fpx = ~~px;
    const XF = (px - fpx);

    const X0 = fpx * go0;
    const X1 = (fpx === gridEnd) ? X0 : X0 + go0;

    // let X0, X1;
    // if (fpx === gridEnd) {
    //     X0 = X1 = fpx * go0;
    // } else {
    //     X0 = fpx * go0;
    //     X1 = X0 + go0;
    // }

    /** @type {number[]} */
    const output = new Array(outputChannels);

    for (let o = 0; o < outputChannels; o++) {
        const c0 = CLUT[X0 + o];
        const c1 = CLUT[X1 + o];
        output[o] = (c0 + ((c1 - c0) * XF)) * outputScale;
    }

    return output;
}

// /**
//  * 2D Bilinear interpolation for duotone color transformations
//  * 
//  * @param {number[]} input - Input color values (2 channels)
//  * @param {import('./decode.js').LUT} lut - Lookup table structure  
//  * @returns {number[]} Interpolated output color values
//  */
// export function bilinearInterp2D_NCh(input, lut) {
//     if (!lut?.CLUT) throw new TypeError('Invalid LUT: Missing CLUT');

//     const { outputScale, outputChannels, g1, inputScale, CLUT, go0, go1 } = lut;
//     const gridEnd = (g1 - 1);
//     const gridPointsScale = gridEnd * inputScale;

//     const input0 = Math.min(Math.max(input[0], 0), 1);
//     const input1 = Math.min(Math.max(input[1], 0), 1);

//     // Only px, py need to be floats
//     const px = input0 * gridPointsScale;
//     const py = input1 * gridPointsScale;

//     const X0_index = ~~px;
//     const rx = (px - X0_index);
//     let X0, X1;
//     if (X0_index === gridEnd) {
//         X0 = X1 = X0_index * go1;
//     } else {
//         X0 = X0_index * go1;
//         X1 = X0 + go1;
//     }

//     const Y0_index = ~~py;
//     const ry = (py - Y0_index);
//     let Y0, Y1;
//     if (Y0_index === gridEnd) {
//         Y0 = Y1 = Y0_index * go0;
//     } else {
//         Y0 = Y0_index * go0;
//         Y1 = Y0 + go0;
//     }

//     /** @type {number[]} */
//     const output = new Array(outputChannels);

//     // Block interpolation  
//     const base0 = X0 + Y0;
//     const base1 = X0 + Y1;
//     const base2 = X1 + Y0;
//     const base3 = X1 + Y1;

//     for (let o = 0; o < outputChannels; o++) {
//         const c0 = CLUT[base0 + o];
//         const c1 = CLUT[base1 + o];
//         const c2 = CLUT[base2 + o];
//         const c3 = CLUT[base3 + o];
//         const c02 = (c0 + ((c2 - c0) * rx));
//         output[o] = (c02 + (((c1 + ((c3 - c1) * rx)) - c02) * ry)) * outputScale;
//     }

//     return output;
// }

/**
 * 2D Bilinear interpolation for duotone color transformations
 * 
 * @param {number[]} input - Input color values (2 channels)
 * @param {import('./decode.js').LUT} lut - Lookup table structure  
 * @returns {number[]} Interpolated output color values
 */
export function bilinearInterp2D_NCh(input, lut) {
    if (!lut?.CLUT) throw new TypeError('Invalid LUT: Missing CLUT');

    const gridEnd = (lut.g1 - 1);
    const gridPointsScale = gridEnd * lut.inputScale;

    const px = Math.min(Math.max(input[0], 0), 1) * gridPointsScale;
    const fpx = ~~px;
    const XF = (px - fpx);
    const X0 = fpx * lut.go1;
    const X1 = X0 + (fpx === gridEnd ? 0 : lut.go1);

    const py = Math.min(Math.max(input[1], 0), 1) * gridPointsScale;
    const fpy = ~~py;
    const YF = (py - fpy);
    const Y0 = fpy * lut.go0;
    const Y1 = Y0 + (fpy === gridEnd ? 0 : lut.go0);

    // let Y0, Y1;
    // if (fpy === gridEnd) {
    //     Y0 = Y1 = fpy * go0;
    // } else {
    //     Y0 = fpy * go0;
    //     Y1 = Y0 + go0;
    // }

    /** @type {number[]} */
    const output = new Array(lut.outputChannels);

    // Block interpolation  
    const base0 = X0 + Y0;
    const base1 = X0 + Y1;
    const base2 = X1 + Y0;
    const base3 = X1 + Y1;
    const slice0 = lut.CLUT.subarray(base0, base0 + lut.outputChannels);
    const slice1 = lut.CLUT.subarray(base1, base1 + lut.outputChannels);
    const slice2 = lut.CLUT.subarray(base2, base2 + lut.outputChannels);
    const slice3 = lut.CLUT.subarray(base3, base3 + lut.outputChannels);

    for (let o = 0; o < output.length; o++) {
        const c0 = slice0[o];
        const c1 = slice1[o];
        const c2 = slice2[o];
        const c3 = slice3[o];
        const c02 = (c0 + ((c2 - c0) * XF));
        output[o] = (c02 + (((c1 + ((c3 - c1) * XF)) - c02) * YF)) * lut.outputScale;
    }

    return output;
}

/**
 * 3D Trilinear interpolation - Slow - Tetrahedral is better EXCEPT PVC>Device.
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
 * @param {import('./decode.js').LUT} lut
 */
export function trilinearInterp3D_NCh(input, lut) {
    if (!lut?.CLUT) throw new TypeError('Invalid LUT: Missing CLUT');

    const gridEnd = (lut.g1 - 1);
    const gridPointsScale = gridEnd * lut.inputScale;

    // Pre-calculate the base indices for the CLUT
    //   We need some clipping here
    //   Rather than divide input by 255 then multiply by (lut.g1 - 1)
    //   Just do this once, this means input0 stays an int and
    //   only px needs to be a float
    //   A few optimisations here, i0 is multiplied by go2, which is precalculated grid x outputChannels
    //   Keeping input0 as int means we can just check input0 === 255 rather than input0 >= 1.0 as a float
    //   And rather than i0+1 we can just do i0 + offset to location in lut

    const px = Math.min(1, Math.max(0, input[0])) * gridPointsScale, fpx = ~~px;
    const X0 = fpx * lut.go2, XF = (px - fpx), X1 = X0 + (fpx === gridEnd ? 0 : lut.go2);

    const py = Math.min(1, Math.max(0, input[1])) * gridPointsScale, fpy = ~~py;
    const Y0 = fpy * lut.go1, YF = (py - fpy), Y1 = Y0 + (fpy === gridEnd ? 0 : lut.go1);

    const pz = Math.min(1, Math.max(0, input[2])) * gridPointsScale, fpz = ~~pz;
    const Z0 = fpz * lut.go0, ZF = (pz - fpz), Z1 = Z0 + (fpz === gridEnd ? 0 : lut.go0);

    /** @type {number[]} */
    const output = new Array(lut.outputChannels);

    const base1 = X0 + Y0 + Z0;
    const base2 = X0 + Y0 + Z1;
    const base3 = X0 + Y1 + Z0;
    const base4 = X0 + Y1 + Z1;
    const base5 = X1 + Y0 + Z0;
    const base6 = X1 + Y0 + Z1;
    const base7 = X1 + Y1 + Z0;
    const base8 = X1 + Y1 + Z1;

    let d000, d010, d001, d011, d100, d110, d101, d111, dx00, dx01, dx10, dx11, dxy0, dxy1;

    // To go to the next channel we only need to increment the index by 1
    // so rather than go CLUT(X0 + Y0 + Z0 + c) we just increment the X indexes
    for (let c = 0; c < output.length; c++) {
        /* 1 */ d000 = lut.CLUT[base1 + c];
        /* 2 */ d001 = lut.CLUT[base2 + c];
        /* 3 */ d010 = lut.CLUT[base3 + c];
        /* 4 */ d011 = lut.CLUT[base4 + c];
        /* 5 */ d100 = lut.CLUT[base5 + c];
        /* 6 */ d101 = lut.CLUT[base6 + c];
        /* 7 */ d110 = lut.CLUT[base7 + c];
        /* 8 */ d111 = lut.CLUT[base8 + c];

        dx00 = d000 + (XF * (d100 - d000));
        dx01 = d001 + (XF * (d101 - d001));
        dx10 = d010 + (XF * (d110 - d010));
        dx11 = d011 + (XF * (d111 - d011));

        dxy0 = dx00 + (YF * (dx10 - dx00));
        dxy1 = dx01 + (YF * (dx11 - dx01));

        output[c] = (dxy0 + (ZF * (dxy1 - dxy0))) * lut.outputScale;
    }

    return output;
};

/**
 * Tetrahedral interpolation for 3D color spaces (3 channels).
 * 
 * @param {number[]} input 
 * @param {import('./decode.js').LUT} lut 
 * @returns 
 */
export function tetrahedralInterp3D_3Ch(input, lut) {
    let d0, b0, a0, C0, d1, b1, a1, C1, d2, b2, a2, C2, base;

    // if (lut.promoteGrayToCMYKBlack) console.trace('lut.promoteGrayToCMYKBlack===true');
    if (!lut?.CLUT) throw new TypeError('Invalid LUT: Missing CLUT');

    const output = new Array(3);
    const gridEnd = (lut.g1 - 1);
    const gridPointsScale = gridEnd * lut.inputScale;

    // Pre-calculate the base indices for the CLUT
    const px = Math.min(1, Math.max(0, input[0])) * gridPointsScale, fpx = ~~px;
    const X0 = fpx * lut.go2, XF = (px - fpx), X1 = X0 + (fpx === gridEnd ? 0 : lut.go2);
    const py = Math.min(1, Math.max(0, input[1])) * gridPointsScale, fpy = ~~py;
    const Y0 = fpy * lut.go1, YF = (py - fpy), Y1 = Y0 + (fpy === gridEnd ? 0 : lut.go1);
    const pz = Math.min(1, Math.max(0, input[2])) * gridPointsScale, fpz = ~~pz;
    const Z0 = fpz * lut.go0, ZF = (pz - fpz), Z1 = Z0 + (fpz === gridEnd ? 0 : lut.go0);

    // Starting point in CLUT
    // Note that x0, y0, z0 are all multiplied by the grid offset and the outputChannels
    // So we only need additions rather than n = ((x0 * go2) + (y0 * go1) + z0) * outputChannels
    //
    // Important performance issues noted in Chrome and Firefox, assigning intermediate variables slows things down a lot
    // Just having one long line of code is much faster, I suspect internally all this math is done in registers,
    // as the JIT can see that variables are not used, so it can just do the math and store the result
    // If we were to use intermediate variables forces the compiler to read/write memory and potentially trigger the GC
    // However using a/b below to read only once from the array does appear to be faster, The less memory reads the better
    //
    // Note that baseN is increased after each read from the array to move to the next channel

    if (XF >= YF && YF >= ZF) { // block1
        /* 4 */ d0 = lut.CLUT[base = X1 + Y1 + Z1], d1 = lut.CLUT[++base], d2 = lut.CLUT[++base];
        /* 3 */ b0 = lut.CLUT[base = X1 + Y1 + Z0], b1 = lut.CLUT[++base], b2 = lut.CLUT[++base];
        /* 2 */ a0 = lut.CLUT[base = X1 + Y0 + Z0], a1 = lut.CLUT[++base], a2 = lut.CLUT[++base];
        /* 1 */ C0 = lut.CLUT[base = X0 + Y0 + Z0], C1 = lut.CLUT[++base], C2 = lut.CLUT[++base];

        output[0] = (C0 + ((a0 - C0) * XF) + ((b0 - a0) * YF) + ((d0 - b0) * ZF)) * lut.outputScale;
        output[1] = (C1 + ((a1 - C1) * XF) + ((b1 - a1) * YF) + ((d1 - b1) * ZF)) * lut.outputScale;
        output[2] = (C2 + ((a2 - C2) * XF) + ((b2 - a2) * YF) + ((d2 - b2) * ZF)) * lut.outputScale;
    } else if (XF >= ZF && ZF >= YF) { // block2
        /* 4 */ d0 = lut.CLUT[base = X1 + Y1 + Z1], d1 = lut.CLUT[++base], d2 = lut.CLUT[++base];
        /* 3 */ a0 = lut.CLUT[base = X1 + Y0 + Z1], a1 = lut.CLUT[++base], a2 = lut.CLUT[++base];
        /* 2 */ b0 = lut.CLUT[base = X1 + Y0 + Z0], b1 = lut.CLUT[++base], b2 = lut.CLUT[++base];
        /* 1 */ C0 = lut.CLUT[base = X0 + Y0 + Z0], C1 = lut.CLUT[++base], C2 = lut.CLUT[++base];

        output[0] = (C0 + ((b0 - C0) * XF) + ((d0 - a0) * YF) + ((a0 - b0) * ZF)) * lut.outputScale;
        output[1] = (C1 + ((b1 - C1) * XF) + ((d1 - a1) * YF) + ((a1 - b1) * ZF)) * lut.outputScale;
        output[2] = (C2 + ((b2 - C2) * XF) + ((d2 - a2) * YF) + ((a2 - b2) * ZF)) * lut.outputScale;
    } else if (XF >= YF && ZF >= XF) { // block3
        /* 4 */ d0 = lut.CLUT[base = X1 + Y1 + Z1], d1 = lut.CLUT[++base], d2 = lut.CLUT[++base];
        /* 3 */ a0 = lut.CLUT[base = X1 + Y0 + Z1], a1 = lut.CLUT[++base], a2 = lut.CLUT[++base];
        /* 2 */ b0 = lut.CLUT[base = X0 + Y0 + Z1], b1 = lut.CLUT[++base], b2 = lut.CLUT[++base];
        /* 1 */ C0 = lut.CLUT[base = X0 + Y0 + Z0], C1 = lut.CLUT[++base], C2 = lut.CLUT[++base];

        output[0] = (C0 + ((a0 - b0) * XF) + ((d0 - a0) * YF) + ((b0 - C0) * ZF)) * lut.outputScale;
        output[1] = (C1 + ((a1 - b1) * XF) + ((d1 - a1) * YF) + ((b1 - C1) * ZF)) * lut.outputScale;
        output[2] = (C2 + ((a2 - b2) * XF) + ((d2 - a2) * YF) + ((b2 - C2) * ZF)) * lut.outputScale;
    } else if (YF >= XF && XF >= ZF) { // block4
        /* 4 */ d0 = lut.CLUT[base = X1 + Y1 + Z1], d1 = lut.CLUT[++base], d2 = lut.CLUT[++base];
        /* 3 */ b0 = lut.CLUT[base = X1 + Y1 + Z0], b1 = lut.CLUT[++base], b2 = lut.CLUT[++base];
        /* 2 */ a0 = lut.CLUT[base = X0 + Y1 + Z0], a1 = lut.CLUT[++base], a2 = lut.CLUT[++base];
        /* 1 */ C0 = lut.CLUT[base = X0 + Y0 + Z0], C1 = lut.CLUT[++base], C2 = lut.CLUT[++base];

        output[0] = (C0 + ((b0 - a0) * XF) + ((a0 - C0) * YF) + ((d0 - b0) * ZF)) * lut.outputScale;
        output[1] = (C1 + ((b1 - a1) * XF) + ((a1 - C1) * YF) + ((d1 - b1) * ZF)) * lut.outputScale;
        output[2] = (C2 + ((b2 - a2) * XF) + ((a2 - C2) * YF) + ((d2 - b2) * ZF)) * lut.outputScale;
    } else if (YF >= ZF && ZF >= XF) { // block5
        /* 4 */ d0 = lut.CLUT[base = X1 + Y1 + Z1], d1 = lut.CLUT[++base], d2 = lut.CLUT[++base];
        /* 3 */ a0 = lut.CLUT[base = X0 + Y1 + Z1], a1 = lut.CLUT[++base], a2 = lut.CLUT[++base];
        /* 2 */ b0 = lut.CLUT[base = X0 + Y1 + Z0], b1 = lut.CLUT[++base], b2 = lut.CLUT[++base];
        /* 1 */ C0 = lut.CLUT[base = X0 + Y0 + Z0], C1 = lut.CLUT[++base], C2 = lut.CLUT[++base];

        output[0] = (C0 + ((d0 - a0) * XF) + ((b0 - C0) * YF) + ((a0 - b0) * ZF)) * lut.outputScale;
        output[1] = (C1 + ((d1 - a1) * XF) + ((b1 - C1) * YF) + ((a1 - b1) * ZF)) * lut.outputScale;
        output[2] = (C2 + ((d2 - a2) * XF) + ((b2 - C2) * YF) + ((a2 - b2) * ZF)) * lut.outputScale;
    } else if (ZF >= YF && YF >= XF) { // block6
        /* 4 */ d0 = lut.CLUT[base = X1 + Y1 + Z1], d1 = lut.CLUT[++base], d2 = lut.CLUT[++base];
        /* 3 */ a0 = lut.CLUT[base = X0 + Y1 + Z1], a1 = lut.CLUT[++base], a2 = lut.CLUT[++base];
        /* 2 */ b0 = lut.CLUT[base = X0 + Y0 + Z1], b1 = lut.CLUT[++base], b2 = lut.CLUT[++base];
        /* 1 */ C0 = lut.CLUT[base = X0 + Y0 + Z0], C1 = lut.CLUT[++base], C2 = lut.CLUT[++base];

        output[0] = (C0 + ((d0 - a0) * XF) + ((a0 - b0) * YF) + ((b0 - C0) * ZF)) * lut.outputScale;
        output[1] = (C1 + ((d1 - a1) * XF) + ((a1 - b1) * YF) + ((b1 - C1) * ZF)) * lut.outputScale;
        output[2] = (C2 + ((d2 - a2) * XF) + ((a2 - b2) * YF) + ((b2 - C2) * ZF)) * lut.outputScale;
    } else {
        output[0] = lut.CLUT[base = X0 + Y0 + Z0] * lut.outputScale;
        output[1] = lut.CLUT[++base] * lut.outputScale;
        output[2] = lut.CLUT[++base] * lut.outputScale;
    }

    return output;
};


/**
 * Tetrahedral interpolation for 3D color spaces (4 channels).
 * 
 * @param {number[]} input 
 * @param {import('./decode.js').LUT} lut 
 * @returns 
 */
export function tetrahedralInterp3D_4Ch(input, lut) {
    let d0, b0, a0, C0, d1, b1, a1, C1, d2, b2, a2, C2, d3, b3, a3, C3;

    if (!lut?.CLUT) throw new TypeError('Invalid LUT: Missing CLUT');

    const output = new Array(4);
    const gridEnd = (lut.g1 - 1);
    const gridPointsScale = gridEnd * lut.inputScale;

    // Pre-calculate the base indices for the CLUT
    const px = Math.min(1, Math.max(0, input[0])) * gridPointsScale, fpx = ~~px;
    const X0 = fpx * lut.go2, XF = (px - fpx), X1 = X0 + (fpx === gridEnd ? 0 : lut.go2);
    const py = Math.min(1, Math.max(0, input[1])) * gridPointsScale, fpy = ~~py;
    const Y0 = fpy * lut.go1, YF = (py - fpy), Y1 = Y0 + (fpy === gridEnd ? 0 : lut.go1);
    const pz = Math.min(1, Math.max(0, input[2])) * gridPointsScale, fpz = ~~pz;
    const Z0 = fpz * lut.go0, ZF = (pz - fpz), Z1 = (fpz * lut.go0) + (fpz === gridEnd ? 0 : lut.go0);

    // Starting point in CLUT
    // Note that x0, y0, z0 are all multiplied by the grid offset and the outputChannels
    // So we only need additions rather than n = ((x0 * go2) + (y0 * go1) + z0) * outputChannels
    //
    // Important performance issues noted in Chrome and Firefox, assigning intermediate variables slows things down a lot
    // Just having one long line of code is much faster, I suspect internally all this math is done in registers,
    // as the JIT can see that variables are not used, so it can just do the math and store the result
    // If we were to use intermediate variables forces the compiler to read/write memory and potentially trigger the GC
    // However using a/b below to read only once from the array does appear to be faster, The less memory reads the better
    //
    // Note that baseN is increased after each read from the array to move to the next channel

    if (XF >= YF && YF >= ZF) { // block1
        /* 4 */ a0 = lut.CLUT[X1 + Y0 + Z0], a1 = lut.CLUT[X1 + Y0 + Z0 + 1], a2 = lut.CLUT[X1 + Y0 + Z0 + 2], a3 = lut.CLUT[X1 + Y0 + Z0 + 3];
        /* 3 */ b0 = lut.CLUT[X1 + Y1 + Z0], b1 = lut.CLUT[X1 + Y1 + Z0 + 1], b2 = lut.CLUT[X1 + Y1 + Z0 + 2], b3 = lut.CLUT[X1 + Y1 + Z0 + 3];
        /* 2 */ d0 = lut.CLUT[X1 + Y1 + Z1], d1 = lut.CLUT[X1 + Y1 + Z1 + 1], d2 = lut.CLUT[X1 + Y1 + Z1 + 2], d3 = lut.CLUT[X1 + Y1 + Z1 + 3];
        /* 1 */ C0 = lut.CLUT[X0 + Y0 + Z0], C1 = lut.CLUT[X0 + Y0 + Z0 + 1], C2 = lut.CLUT[X0 + Y0 + Z0 + 2], C3 = lut.CLUT[X0 + Y0 + Z0 + 3];

        output[0] = (C0 + ((a0 - C0) * XF) + ((b0 - a0) * YF) + ((d0 - b0) * ZF)) * lut.outputScale;
        output[1] = (C1 + ((a1 - C1) * XF) + ((b1 - a1) * YF) + ((d1 - b1) * ZF)) * lut.outputScale;
        output[2] = (C2 + ((a2 - C2) * XF) + ((b2 - a2) * YF) + ((d2 - b2) * ZF)) * lut.outputScale;
        output[3] = (C3 + ((a3 - C3) * XF) + ((b3 - a3) * YF) + ((d3 - b3) * ZF)) * lut.outputScale;

    } else if (XF >= ZF && ZF >= YF) { // block2
        /* 4 */ b0 = lut.CLUT[X1 + Y0 + Z0], b1 = lut.CLUT[X1 + Y0 + Z0 + 1], b2 = lut.CLUT[X1 + Y0 + Z0 + 2], b3 = lut.CLUT[X1 + Y0 + Z0 + 3];
        /* 3 */ a0 = lut.CLUT[X1 + Y0 + Z1], a1 = lut.CLUT[X1 + Y0 + Z1 + 1], a2 = lut.CLUT[X1 + Y0 + Z1 + 2], a3 = lut.CLUT[X1 + Y0 + Z1 + 3];
        /* 2 */ d0 = lut.CLUT[X1 + Y1 + Z1], d1 = lut.CLUT[X1 + Y1 + Z1 + 1], d2 = lut.CLUT[X1 + Y1 + Z1 + 2], d3 = lut.CLUT[X1 + Y1 + Z1 + 3];
        /* 1 */ C0 = lut.CLUT[X0 + Y0 + Z0], C1 = lut.CLUT[X0 + Y0 + Z0 + 1], C2 = lut.CLUT[X0 + Y0 + Z0 + 2], C3 = lut.CLUT[X0 + Y0 + Z0 + 3];

        output[0] = (C0 + ((b0 - C0) * XF) + ((d0 - a0) * YF) + ((a0 - b0) * ZF)) * lut.outputScale;
        output[1] = (C1 + ((b1 - C1) * XF) + ((d1 - a1) * YF) + ((a1 - b1) * ZF)) * lut.outputScale;
        output[2] = (C2 + ((b2 - C2) * XF) + ((d2 - a2) * YF) + ((a2 - b2) * ZF)) * lut.outputScale;
        output[3] = (C3 + ((b3 - C3) * XF) + ((d3 - a3) * YF) + ((a3 - b3) * ZF)) * lut.outputScale;

    } else if (XF >= YF && ZF >= XF) { // block3
        /* 4 */ b0 = lut.CLUT[X0 + Y0 + Z1], b1 = lut.CLUT[X0 + Y0 + Z1 + 1], b2 = lut.CLUT[X0 + Y0 + Z1 + 2], b3 = lut.CLUT[X0 + Y0 + Z1 + 3];
        /* 3 */ a0 = lut.CLUT[X1 + Y0 + Z1], a1 = lut.CLUT[X1 + Y0 + Z1 + 1], a2 = lut.CLUT[X1 + Y0 + Z1 + 2], a3 = lut.CLUT[X1 + Y0 + Z1 + 3];
        /* 2 */ d0 = lut.CLUT[X1 + Y1 + Z1], d1 = lut.CLUT[X1 + Y1 + Z1 + 1], d2 = lut.CLUT[X1 + Y1 + Z1 + 2], d3 = lut.CLUT[X1 + Y1 + Z1 + 3];
        /* 1 */ C0 = lut.CLUT[X0 + Y0 + Z0], C1 = lut.CLUT[X0 + Y0 + Z0 + 1], C2 = lut.CLUT[X0 + Y0 + Z0 + 2], C3 = lut.CLUT[X0 + Y0 + Z0 + 3];

        output[0] = (C0 + ((a0 - b0) * XF) + ((d0 - a0) * YF) + ((b0 - C0) * ZF)) * lut.outputScale;
        output[1] = (C1 + ((a1 - b1) * XF) + ((d1 - a1) * YF) + ((b1 - C1) * ZF)) * lut.outputScale;
        output[2] = (C2 + ((a2 - b2) * XF) + ((d2 - a2) * YF) + ((b2 - C2) * ZF)) * lut.outputScale;
        output[3] = (C3 + ((a3 - b3) * XF) + ((d3 - a3) * YF) + ((b3 - C3) * ZF)) * lut.outputScale;

    } else if (YF >= XF && XF >= ZF) { // block4
        /* 4 */ a0 = lut.CLUT[X0 + Y1 + Z0], a1 = lut.CLUT[X0 + Y1 + Z0 + 1], a2 = lut.CLUT[X0 + Y1 + Z0 + 2], a3 = lut.CLUT[X0 + Y1 + Z0 + 3];
        /* 3 */ b0 = lut.CLUT[X1 + Y1 + Z0], b1 = lut.CLUT[X1 + Y1 + Z0 + 1], b2 = lut.CLUT[X1 + Y1 + Z0 + 2], b3 = lut.CLUT[X1 + Y1 + Z0 + 3];
        /* 2 */ d0 = lut.CLUT[X1 + Y1 + Z1], d1 = lut.CLUT[X1 + Y1 + Z1 + 1], d2 = lut.CLUT[X1 + Y1 + Z1 + 2], d3 = lut.CLUT[X1 + Y1 + Z1 + 3];
        /* 1 */ C0 = lut.CLUT[X0 + Y0 + Z0], C1 = lut.CLUT[X0 + Y0 + Z0 + 1], C2 = lut.CLUT[X0 + Y0 + Z0 + 2], C3 = lut.CLUT[X0 + Y0 + Z0 + 3];

        output[0] = (C0 + ((b0 - a0) * XF) + ((a0 - C0) * YF) + ((d0 - b0) * ZF)) * lut.outputScale;
        output[1] = (C1 + ((b1 - a1) * XF) + ((a1 - C1) * YF) + ((d1 - b1) * ZF)) * lut.outputScale;
        output[2] = (C2 + ((b2 - a2) * XF) + ((a2 - C2) * YF) + ((d2 - b2) * ZF)) * lut.outputScale;
        output[3] = (C3 + ((b3 - a3) * XF) + ((a3 - C3) * YF) + ((d3 - b3) * ZF)) * lut.outputScale;

    } else if (YF >= ZF && ZF >= XF) { // block5
        /* 4 */ b0 = lut.CLUT[X0 + Y1 + Z0], b1 = lut.CLUT[X0 + Y1 + Z0 + 1], b2 = lut.CLUT[X0 + Y1 + Z0 + 2], b3 = lut.CLUT[X0 + Y1 + Z0 + 3];
        /* 3 */ a0 = lut.CLUT[X0 + Y1 + Z1], a1 = lut.CLUT[X0 + Y1 + Z1 + 1], a2 = lut.CLUT[X0 + Y1 + Z1 + 2], a3 = lut.CLUT[X0 + Y1 + Z1 + 3];
        /* 2 */ d0 = lut.CLUT[X1 + Y1 + Z1], d1 = lut.CLUT[X1 + Y1 + Z1 + 1], d2 = lut.CLUT[X1 + Y1 + Z1 + 2], d3 = lut.CLUT[X1 + Y1 + Z1 + 3];
        /* 1 */ C0 = lut.CLUT[X0 + Y0 + Z0], C1 = lut.CLUT[X0 + Y0 + Z0 + 1], C2 = lut.CLUT[X0 + Y0 + Z0 + 2], C3 = lut.CLUT[X0 + Y0 + Z0 + 3];

        output[0] = (C0 + ((d0 - a0) * XF) + ((b0 - C0) * YF) + ((a0 - b0) * ZF)) * lut.outputScale;
        output[1] = (C1 + ((d1 - a1) * XF) + ((b1 - C1) * YF) + ((a1 - b1) * ZF)) * lut.outputScale;
        output[2] = (C2 + ((d2 - a2) * XF) + ((b2 - C2) * YF) + ((a2 - b2) * ZF)) * lut.outputScale;
        output[3] = (C3 + ((d3 - a3) * XF) + ((b3 - C3) * YF) + ((a3 - b3) * ZF)) * lut.outputScale;

    } else if (ZF >= YF && YF >= XF) { // block6
        /* 4 */ b0 = lut.CLUT[X0 + Y0 + Z1], b1 = lut.CLUT[X0 + Y0 + Z1 + 1], b2 = lut.CLUT[X0 + Y0 + Z1 + 2], b3 = lut.CLUT[X0 + Y0 + Z1 + 3];
        /* 3 */ a0 = lut.CLUT[X0 + Y1 + Z1], a1 = lut.CLUT[X0 + Y1 + Z1 + 1], a2 = lut.CLUT[X0 + Y1 + Z1 + 2], a3 = lut.CLUT[X0 + Y1 + Z1 + 3];
        /* 2 */ d0 = lut.CLUT[X1 + Y1 + Z1], d1 = lut.CLUT[X1 + Y1 + Z1 + 1], d2 = lut.CLUT[X1 + Y1 + Z1 + 2], d3 = lut.CLUT[X1 + Y1 + Z1 + 3];
        /* 1 */ C0 = lut.CLUT[X0 + Y0 + Z0], C1 = lut.CLUT[X0 + Y0 + Z0 + 1], C2 = lut.CLUT[X0 + Y0 + Z0 + 2], C3 = lut.CLUT[X0 + Y0 + Z0 + 3];

        output[0] = (C0 + ((d0 - a0) * XF) + ((a0 - b0) * YF) + ((b0 - C0) * ZF)) * lut.outputScale;
        output[1] = (C1 + ((d1 - a1) * XF) + ((a1 - b1) * YF) + ((b1 - C1) * ZF)) * lut.outputScale;
        output[2] = (C2 + ((d2 - a2) * XF) + ((a2 - b2) * YF) + ((b2 - C2) * ZF)) * lut.outputScale;
        output[3] = (C3 + ((d3 - a3) * XF) + ((a3 - b3) * YF) + ((b3 - C3) * ZF)) * lut.outputScale;

    } else {
        output[0] = lut.CLUT[X0 + Y0 + Z0] * lut.outputScale;
        output[1] = lut.CLUT[X0 + Y0 + Z0 + 1] * lut.outputScale;
        output[2] = lut.CLUT[X0 + Y0 + Z0 + 2] * lut.outputScale;
        output[3] = lut.CLUT[X0 + Y0 + Z0 + 3] * lut.outputScale;
    }

    return output;

};

const sub16lookup = (base, b, CLUT, outputChannels) => outputChannels === 3
    ? [CLUT[base] - b[0], CLUT[base + 1] - b[1], CLUT[base + 2] - b[2]]
    : [CLUT[base] - b[0], CLUT[base + 1] - b[1], CLUT[base + 2] - b[2], CLUT[base + 3] - b[3]];

const sub16Lookup2 = (base1, base2, CLUT, outputChannels) => outputChannels === 3
    ? [CLUT[base1] - CLUT[base2], CLUT[base1 + 1] - CLUT[base2 + 1], CLUT[base1 + 2] - CLUT[base2 + 2]]
    : [CLUT[base1] - CLUT[base2], CLUT[base1 + 1] - CLUT[base2 + 1], CLUT[base1 + 2] - CLUT[base2 + 2], CLUT[base1 + 3] - CLUT[base2 + 3]];

const interpolate3D = (c0, c1, c2, c3, xf, yf, zf, scale) => [
    (c0[0] + (c1[0] * xf) + (c2[0] * yf) + (c3[0] * zf)) * scale,
    (c0[1] + (c1[1] * xf) + (c2[1] * yf) + (c3[1] * zf)) * scale,
    (c0[2] + (c1[2] * xf) + (c2[2] * yf) + (c3[2] * zf)) * scale,
];

const interpolate4D = (c0, c1, c2, c3, xf, yf, zf, scale) => [
    (c0[0] + (c1[0] * xf) + (c2[0] * yf) + (c3[0] * zf)) * scale,
    (c0[1] + (c1[1] * xf) + (c2[1] * yf) + (c3[1] * zf)) * scale,
    (c0[2] + (c1[2] * xf) + (c2[2] * yf) + (c3[2] * zf)) * scale,
    (c0[3] + (c1[3] * xf) + (c2[3] * yf) + (c3[3] * zf)) * scale,
];

/**
 * Optimised version of tetrahedralInterp3D_Master
 * About 70% faster with functions combined
 * @param {number[]} input 
 * @param {import('./decode.js').LUT} lut 
 * @param {number} K0
 * @returns {number[]}
 */
export function tetrahedralInterp3D_3or4Ch(input, lut, K0) {
    if (!lut?.CLUT) throw new TypeError('Invalid LUT: Missing CLUT');

    const { inputScale, outputScale, inputChannels, outputChannels, CLUT, g1, g2, g3 } = lut;
    const gridEnd = g1 - 1;

    const input0 = input[0] * inputScale;
    const px = Math.min(Math.max(input0, 0.0), 1.0) * gridEnd;
    const X0 = ~~px;
    const XF = (px - X0);
    const X1 = X0 + (input0 >= 1.0 ? 0.0 : 1.0);

    const input1 = input[1] * inputScale;
    const py = Math.min(Math.max(input1, 0.0), 1.0) * gridEnd;
    const Y0 = ~~py;
    const YF = (py - Y0);
    const Y1 = Y0 + (input1 >= 1.0 ? 0.0 : 1.0);

    const input2 = input[2] * inputScale;
    const pz = Math.min(Math.max(input2, 0.0), 1.0) * gridEnd;
    const Z0 = ~~pz;
    const ZF = (pz - Z0);
    const Z1 = Z0 + (input2 >= 1.0 ? 0.0 : 1.0);

    const baseFor = inputChannels === 3
        ? (x, y, z) => ((x * g2) + (y * g1) + z) * outputChannels
        : (x, y, z, k) => ((k * g3) + (x * g2) + (y * g1) + z) * outputChannels;

    const lookup = base => CLUT.slice(base, base + outputChannels);

    const C0 = lookup(baseFor(X0, Y0, Z0, K0));

    if (XF >= YF && YF >= ZF) {
        const base1 = baseFor(X1, Y0, Z0, K0);
        const base2 = baseFor(X1, Y1, Z0, K0);
        const base3 = baseFor(X1, Y1, Z1, K0);

        return (outputChannels === 3 ? interpolate3D : interpolate4D)(
            C0,
            sub16lookup(base1, C0, CLUT, outputChannels),
            sub16Lookup2(base2, base1, CLUT, outputChannels),
            sub16Lookup2(base3, base2, CLUT, outputChannels),
            XF, YF, ZF, outputScale,
        );
    } else if (XF >= ZF && ZF >= YF) {
        const base1 = baseFor(X1, Y0, Z0, K0);
        const base2 = baseFor(X1, Y1, Z1, K0);
        const base3 = baseFor(X1, Y0, Z1, K0);

        return (outputChannels === 3 ? interpolate3D : interpolate4D)(
            C0,
            sub16lookup(base1, C0, CLUT, outputChannels),
            sub16Lookup2(base2, base3, CLUT, outputChannels),
            sub16Lookup2(base3, base1, CLUT, outputChannels),
            XF, YF, ZF, outputScale,
        );
    } else if (ZF >= XF && XF >= YF) {
        const base1 = baseFor(X1, Y0, Z1, K0);
        const base2 = baseFor(X0, Y0, Z1, K0);
        const base3 = baseFor(X1, Y1, Z1, K0);

        return (outputChannels === 3 ? interpolate3D : interpolate4D)(
            C0,
            sub16Lookup2(base1, base2, CLUT, outputChannels),
            sub16Lookup2(base3, base1, CLUT, outputChannels),
            sub16lookup(base2, C0, CLUT, outputChannels),
            XF, YF, ZF, outputScale,
        );
    } else if (YF >= XF && XF >= ZF) {
        const base1 = baseFor(X1, Y1, Z0, K0);
        const base2 = baseFor(X0, Y1, Z0, K0);
        const base3 = baseFor(X1, Y1, Z1, K0);

        return (outputChannels === 3 ? interpolate3D : interpolate4D)(
            C0,
            sub16Lookup2(base1, base2, CLUT, outputChannels),
            sub16lookup(base2, C0, CLUT, outputChannels),
            sub16Lookup2(base3, base1, CLUT, outputChannels),
            XF, YF, ZF, outputScale,
        );
    } else if (YF >= ZF && ZF >= XF) {
        const base1 = baseFor(X1, Y1, Z1, K0);
        const base2 = baseFor(X0, Y1, Z1, K0);
        const base3 = baseFor(X0, Y1, Z0, K0);

        return (outputChannels === 3 ? interpolate3D : interpolate4D)(
            C0,
            sub16Lookup2(base1, base2, CLUT, outputChannels),
            sub16lookup(base3, C0, CLUT, outputChannels),
            sub16Lookup2(base2, base3, CLUT, outputChannels),
            XF, YF, ZF, outputScale,
        );
    } else if (ZF >= YF && YF >= XF) {
        const base1 = baseFor(X1, Y1, Z1, K0);
        const base2 = baseFor(X0, Y1, Z1, K0);
        const base3 = baseFor(X0, Y0, Z1, K0);

        return (outputChannels === 3 ? interpolate3D : interpolate4D)(
            C0,
            sub16Lookup2(base1, base2, CLUT, outputChannels),
            sub16Lookup2(base2, base3, CLUT, outputChannels),
            sub16lookup(base3, C0, CLUT, outputChannels),
            XF, YF, ZF, outputScale,
        );
    }

    const cn = [0, 0, 0, 0];

    return (outputChannels === 3 ? interpolate3D : interpolate4D)(C0, cn, cn, cn, XF, YF, ZF, outputScale);

};

/**
 * 3D Tetrahedral interpolation for 3D inputs and n Channels output
 * Used for PCS > 1,2 or nColour outputs
 * PCS > 3ch or PCS > 4ch have optimized versions for speed
 * 
 * @param {number[] | Int8Array | Int16Array | Int32Array | Uint8Array | Uint8ClampedArray | Uint16Array| Uint32Array | Float32Array | Float64Array} input - Input color values (3 channels)
 * @param {import('./decode.js').LUT} lut - Lookup table structure
 * @returns {number[]} Interpolated output color values
 */
export function tetrahedralInterp3D_NCh(input, lut) {
    if (!lut?.CLUT) throw new TypeError('Invalid LUT: Missing CLUT');

    const { outputScale, outputChannels, g1, inputScale, CLUT, go0, go1, go2 } = lut;
    const gridEnd = (g1 - 1);
    const gridPointsScale = gridEnd * inputScale;

    const input0 = Math.min(Math.max(input[0], 0), 1);
    const input1 = Math.min(Math.max(input[1], 0), 1);
    const input2 = Math.min(Math.max(input[2], 0), 1);

    // Only px, py, pz need to be floats
    const px = input0 * gridPointsScale;
    const py = input1 * gridPointsScale;
    const pz = input2 * gridPointsScale;

    const X0_index = ~~px; // ~~ is the same as Math.floor(px)
    const rx = (px - X0_index); // get the fractional part
    let X0, X1;
    if (X0_index === gridEnd) {
        X0 = X1 = X0_index * go2; // change to index in array
    } else {
        X0 = X0_index * go2;
        X1 = X0 + go2;
    }

    const Y0_index = ~~py;
    const ry = (py - Y0_index);
    let Y0, Y1;
    if (Y0_index === gridEnd) {
        Y0 = Y1 = Y0_index * go1;
    } else {
        Y0 = Y0_index * go1;
        Y1 = Y0 + go1;
    }

    const Z0_index = ~~pz;
    const rz = (pz - Z0_index);
    let Z0, Z1;
    if (Z0_index === gridEnd) {
        Z0 = Z1 = Z0_index * go0;
    } else {
        Z0 = Z0_index * go0;
        Z1 = Z0 + go0;
    }

    // Starting point
    const base0 = X0 + Y0 + Z0;

    /** @type {number[]} */
    const output = new Array(outputChannels);

    if (rx >= ry && ry >= rz) {
        // block1
        const base1 = X1 + Y0 + Z0;
        const base2 = X1 + Y1 + Z0;
        const base4 = X1 + Y1 + Z1;
        for (let o = 0; o < outputChannels; o++) {
            const a = CLUT[base1 + o];
            const b = CLUT[base2 + o];
            const c = CLUT[base0 + o];
            output[o] = (c + ((a - c) * rx) + ((b - a) * ry) + ((CLUT[base4 + o] - b) * rz)) * outputScale;
        }

    } else if (rx >= rz && rz >= ry) {
        // block2
        const base1 = X1 + Y0 + Z0;
        const base2 = X1 + Y1 + Z1;
        const base3 = X1 + Y0 + Z1;
        for (let o = 0; o < outputChannels; o++) {
            const a = CLUT[base3 + o];
            const b = CLUT[base1 + o];
            const c = CLUT[base0 + o];
            output[o] = (c + ((b - c) * rx) + ((CLUT[base2 + o] - a) * ry) + ((a - b) * rz)) * outputScale;
        }

    } else if (rx >= ry && rz >= rx) {
        // block3
        const base1 = X1 + Y0 + Z1;
        const base2 = X0 + Y0 + Z1;
        const base3 = X1 + Y1 + Z1;
        for (let o = 0; o < outputChannels; o++) {
            const a = CLUT[base1 + o];
            const b = CLUT[base2 + o];
            const c = CLUT[base0 + o];
            output[o] = (c + ((a - b) * rx) + ((CLUT[base3 + o] - a) * ry) + ((b - c) * rz)) * outputScale;
        }

    } else if (ry >= rx && rx >= rz) {
        // block4
        const base1 = X1 + Y1 + Z0;
        const base2 = X0 + Y1 + Z0;
        const base4 = X1 + Y1 + Z1;
        for (let o = 0; o < outputChannels; o++) {
            const a = CLUT[base2 + o];
            const b = CLUT[base1 + o];
            const c = CLUT[base0 + o];
            output[o] = (c + ((b - a) * rx) + ((a - c) * ry) + ((CLUT[base4 + o] - b) * rz)) * outputScale;
        }

    } else if (ry >= rz && rz >= rx) {
        // block5
        const base1 = X1 + Y1 + Z1;
        const base2 = X0 + Y1 + Z1;
        const base3 = X0 + Y1 + Z0;
        for (let o = 0; o < outputChannels; o++) {
            const a = CLUT[base2 + o];
            const b = CLUT[base3 + o];
            const c = CLUT[base0 + o];
            output[o] = (c + ((CLUT[base1 + o] - a) * rx) + ((b - c) * ry) + ((a - b) * rz)) * outputScale;
        }

    } else if (rz >= ry && ry >= rx) {
        // block6
        const base1 = X1 + Y1 + Z1;
        const base2 = X0 + Y1 + Z1;
        const base4 = X0 + Y0 + Z1;
        for (let o = 0; o < outputChannels; o++) {
            const a = CLUT[base2 + o];
            const b = CLUT[base4 + o];
            const c = CLUT[base0 + o];
            output[o] = (c + ((CLUT[base1 + o] - a) * rx) + ((a - b) * ry) + ((b - c) * rz)) * outputScale;
        }

    } else {
        for (let o = 0; o < outputChannels; o++) {
            output[o] = CLUT[base0 + o] * outputScale;
        }
    }

    return output;
}

/**
 * Linear interpolation array processing loop
 * @param {number[] | Int8Array | Int16Array | Int32Array | Uint8Array | Uint8ClampedArray | Uint16Array| Uint32Array | Float32Array | Float64Array} input - Input array
 * @param {number} inputPos - Input position
 * @param {number[] | Int8Array | Int16Array | Int32Array | Uint8Array | Uint8ClampedArray | Uint16Array| Uint32Array | Float32Array | Float64Array} output - Output array  
 * @param {number} outputPos - Output position
 * @param {number} length - Number of pixels to process
 * @param {import('./decode.js').LUT} lut - Lookup table
 * @param {boolean} inputHasAlpha - Whether input has alpha channel
 * @param {boolean} outputHasAlpha - Whether output has alpha channel
 * @param {boolean} preserveAlpha - Whether to preserve alpha values
 */
export function linearInterp1DArray_NCh_loop(input, inputPos, output, outputPos, length, lut, inputHasAlpha, outputHasAlpha, preserveAlpha) {
    var temp, o;
    var outputChannels = lut.outputChannels;
    for (var p = 0; p < length; p++) {
        temp = linearInterp1D_NCh([input[inputPos++]], lut);
        for (let o = 0; o < outputChannels; o++) {
            output[outputPos++] = temp[o];
        }
        if (preserveAlpha) {
            output[outputPos++] = input[inputPos++];
        } else {
            if (inputHasAlpha) { inputPos++; }
            if (outputHasAlpha) {
                output[outputPos++] = 255;
            }
        }
    }
}

/**
 * Tetrahedral interpolation array processing loop
 * @param {number[] | Int8Array | Int16Array | Int32Array | Uint8Array | Uint8ClampedArray | Uint16Array| Uint32Array | Float32Array | Float64Array} input - Input array
 * @param {number} inputPos - Input position
 * @param {number[] | Uint8Array | Uint8ClampedArray} output - Output array  
 * @param {number} outputPos - Output position
 * @param {number} length - Number of pixels to process
 * @param {import('./decode.js').LUT} lut - Lookup table
 * @param {boolean} inputHasAlpha - Whether input has alpha channel
 * @param {boolean} outputHasAlpha - Whether output has alpha channel
 * @param {boolean} preserveAlpha - Whether to preserve alpha values
 */
export function tetrahedralInterp3DArray_NCh_loop(input, inputPos, output, outputPos, length, lut, inputHasAlpha, outputHasAlpha, preserveAlpha) {
    var colorIn, temp, o;
    var outputChannels = lut.outputChannels;
    colorIn = new Uint8ClampedArray(3);
    for (var p = 0; p < length; p++) {
        colorIn[0] = input[inputPos++];
        colorIn[1] = input[inputPos++];
        colorIn[2] = input[inputPos++];
        temp = tetrahedralInterp3D_NCh(colorIn, lut);
        for (let o = 0; o < outputChannels; o++) {
            output[outputPos++] = temp[o];
        }
        if (preserveAlpha) {
            output[outputPos++] = input[inputPos++];
        } else {
            if (inputHasAlpha) { inputPos++; }
            if (outputHasAlpha) {
                output[outputPos++] = 255;
            }
        }
    }
}

/**
 * 4D Tetrahedral interpolation for 3-channel output (e.g., CMYK to RGB)
 * 
 * @param {number[]} input - Input color values (4 channels: K, C, M, Y)
 * @param {import("./decode.js").LUT} lut - Lookup table structure
 * @returns {number[]} Interpolated output color values (3 channels)
 */
export function tetrahedralInterp4D_3Ch(input, lut) {
    var X0, X1, Y0, K0,
        Y1, Z0, Z1,
        rx, ry, rz, rk,
        px, py, pz, pk,
        input0, input1, input2, inputK,
        base1, base2, base3, base4,
        c0, c1, c2,
        o0, o1, o2,
        d0, d1, d2,
        a, b,
        interpK;

    var outputScale = lut.outputScale;
    var gridEnd = (lut.g1 - 1);
    var gridPointsScale = gridEnd * lut.inputScale;
    var CLUT = lut.CLUT;
    var go0 = lut.go0;
    var go1 = lut.go1;
    var go2 = lut.go2;
    var go3 = lut.go3;
    var kOffset = go3 - lut.outputChannels + 1; // +1 since we do not do a [base++] for the last CLUT lookup

    inputK = Math.min(1, Math.max(0, input[0])); // K
    input0 = Math.min(1, Math.max(0, input[1])); // C
    input1 = Math.min(1, Math.max(0, input[2])); // M
    input2 = Math.min(1, Math.max(0, input[3])); // Y

    px = input0 * gridPointsScale;
    py = input1 * gridPointsScale;
    pz = input2 * gridPointsScale;
    pk = inputK * gridPointsScale;

    K0 = ~~pk;
    rk = (pk - K0);
    interpK = !(K0 === gridEnd);// K0 and K1 are identical if K0 is the last grid point
    K0 *= go3;
    // No need to calc K1 as we will add kOffset to the base location to get the K1 location

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

    base1 = X0 + Y0 + Z0 + K0;
    c0 = CLUT[base1++];
    c1 = CLUT[base1++];
    c2 = CLUT[base1];

    if (interpK) {
        base1 += kOffset;
        d0 = CLUT[base1++];
        d1 = CLUT[base1++];
        d2 = CLUT[base1];
    }

    var output = new Array(3);

    if (rx >= ry && ry >= rz) {
        // block1
        base1 = X1 + Y0 + Z0 + K0;
        base2 = X1 + Y1 + Z0 + K0;
        //base3 = base1; SAME AS base1
        base4 = X1 + Y1 + Z1 + K0;
        //base5 = base2; SAME as base2

        // Note that baseN is increased after each read from the array to move to the next channel
        a = CLUT[base1++];
        b = CLUT[base2++];
        o0 = (c0 + ((a - c0) * rx) + ((b - a) * ry) + ((CLUT[base4++] - b) * rz));

        a = CLUT[base1++];
        b = CLUT[base2++];
        o1 = (c1 + ((a - c1) * rx) + ((b - a) * ry) + ((CLUT[base4++] - b) * rz));

        a = CLUT[base1];
        b = CLUT[base2];
        o2 = (c2 + ((a - c2) * rx) + ((b - a) * ry) + ((CLUT[base4] - b) * rz));

        if (interpK) {
            base1 += kOffset;
            base2 += kOffset;
            base4 += kOffset;

            a = CLUT[base1++];
            b = CLUT[base2++];
            output[0] = (o0 + (((d0 + ((a - d0) * rx) + ((b - a) * ry) + ((CLUT[base4++] - b) * rz)) - o0) * rk)) * outputScale;

            a = CLUT[base1++];
            b = CLUT[base2++];
            output[1] = (o1 + (((d1 + ((a - d1) * rx) + ((b - a) * ry) + ((CLUT[base4++] - b) * rz)) - o1) * rk)) * outputScale;

            a = CLUT[base1];
            b = CLUT[base2];
            output[2] = (o2 + (((d2 + ((a - d2) * rx) + ((b - a) * ry) + ((CLUT[base4] - b) * rz)) - o2) * rk)) * outputScale;

        } else {
            output[0] = o0 * outputScale;
            output[1] = o1 * outputScale;
            output[2] = o2 * outputScale;
        }

    } else if (rx >= rz && rz >= ry) {
        // block2

        base1 = X1 + Y0 + Z0 + K0;
        base2 = X1 + Y1 + Z1 + K0;
        base3 = X1 + Y0 + Z1 + K0;
        //base4 = base3;
        //base5 = base1;

        a = CLUT[base3++];
        b = CLUT[base1++];
        o0 = c0 + ((b - c0) * rx) + ((CLUT[base2++] - a) * ry) + ((a - b) * rz);

        a = CLUT[base3++];
        b = CLUT[base1++];
        o1 = c1 + ((b - c1) * rx) + ((CLUT[base2++] - a) * ry) + ((a - b) * rz);

        a = CLUT[base3];
        b = CLUT[base1];
        o2 = c2 + ((b - c2) * rx) + ((CLUT[base2] - a) * ry) + ((a - b) * rz);


        if (interpK) {
            base3 += kOffset;
            base1 += kOffset;
            base2 += kOffset;

            a = CLUT[base3++];
            b = CLUT[base1++];
            output[0] = (o0 + (((d0 + ((b - d0) * rx) + ((CLUT[base2++] - a) * ry) + ((a - b) * rz)) - o0) * rk)) * outputScale;

            a = CLUT[base3++];
            b = CLUT[base1++];
            output[1] = (o1 + (((d1 + ((b - d1) * rx) + ((CLUT[base2++] - a) * ry) + ((a - b) * rz)) - o1) * rk)) * outputScale;

            a = CLUT[base3];
            b = CLUT[base1];
            output[2] = (o2 + (((d2 + ((b - d2) * rx) + ((CLUT[base2] - a) * ry) + ((a - b) * rz)) - o2) * rk)) * outputScale;

        } else {
            output[0] = o0 * outputScale;
            output[1] = o1 * outputScale;
            output[2] = o2 * outputScale;
        }

    } else if (rx >= ry && rz >= rx) {
        // block3

        base1 = X1 + Y0 + Z1 + K0;
        base2 = X0 + Y0 + Z1 + K0;
        base3 = X1 + Y1 + Z1 + K0;
        //base4 = base1;
        //base5 = base2;

        a = CLUT[base1++];
        b = CLUT[base2++];
        o0 = c0 + ((a - b) * rx) + ((CLUT[base3++] - a) * ry) + ((b - c0) * rz);

        a = CLUT[base1++];
        b = CLUT[base2++];
        o1 = c1 + ((a - b) * rx) + ((CLUT[base3++] - a) * ry) + ((b - c1) * rz);

        a = CLUT[base1];
        b = CLUT[base2];
        o2 = c2 + ((a - b) * rx) + ((CLUT[base3] - a) * ry) + ((b - c2) * rz);

        if (interpK) {
            base1 += kOffset;
            base2 += kOffset;
            base3 += kOffset;

            a = CLUT[base1++];
            b = CLUT[base2++];
            output[0] = (o0 + (((d0 + ((a - b) * rx) + ((CLUT[base3++] - a) * ry) + ((b - d0) * rz)) - o0) * rk)) * outputScale;

            a = CLUT[base1++];
            b = CLUT[base2++];
            output[1] = (o1 + (((d1 + ((a - b) * rx) + ((CLUT[base3++] - a) * ry) + ((b - d1) * rz)) - o1) * rk)) * outputScale;

            a = CLUT[base1];
            b = CLUT[base2];
            output[2] = (o2 + (((d2 + ((a - b) * rx) + ((CLUT[base3] - a) * ry) + ((b - d2) * rz)) - o2) * rk)) * outputScale;
        } else {
            output[0] = o0 * outputScale;
            output[1] = o1 * outputScale;
            output[2] = o2 * outputScale;
        }

    } else if (ry >= rx && rx >= rz) {
        // block4

        base1 = X1 + Y1 + Z0 + K0;
        base2 = X0 + Y1 + Z0 + K0;
        //base3 = base2;
        base4 = X1 + Y1 + Z1 + K0;
        //base5 = base1;

        a = CLUT[base2++];
        b = CLUT[base1++];
        o0 = c0 + ((b - a) * rx) + ((a - c0) * ry) + ((CLUT[base4++] - b) * rz);

        a = CLUT[base2++];
        b = CLUT[base1++];
        o1 = c1 + ((b - a) * rx) + ((a - c1) * ry) + ((CLUT[base4++] - b) * rz);

        a = CLUT[base2];
        b = CLUT[base1];
        o2 = c2 + ((b - a) * rx) + ((a - c2) * ry) + ((CLUT[base4] - b) * rz);


        if (interpK) {
            base1 += kOffset;
            base2 += kOffset;
            base4 += kOffset;

            a = CLUT[base2++];
            b = CLUT[base1++];
            output[0] = (o0 + (((d0 + ((b - a) * rx) + ((a - d0) * ry) + ((CLUT[base4++] - b) * rz)) - o0) * rk)) * outputScale;

            a = CLUT[base2++];
            b = CLUT[base1++];
            output[1] = (o1 + (((d1 + ((b - a) * rx) + ((a - d1) * ry) + ((CLUT[base4++] - b) * rz)) - o1) * rk)) * outputScale;

            a = CLUT[base2];
            b = CLUT[base1];
            output[2] = (o2 + (((d2 + ((b - a) * rx) + ((a - d2) * ry) + ((CLUT[base4] - b) * rz)) - o2) * rk)) * outputScale;

        } else {
            output[0] = o0 * outputScale;
            output[1] = o1 * outputScale;
            output[2] = o2 * outputScale;
        }

    } else if (ry >= rz && rz >= rx) {
        // block5

        base1 = X1 + Y1 + Z1 + K0;
        base2 = X0 + Y1 + Z1 + K0;
        base3 = X0 + Y1 + Z0 + K0;
        //base4 = base2;
        //base5 = base3;

        a = CLUT[base2++];
        b = CLUT[base3++];
        o0 = c0 + ((CLUT[base1++] - a) * rx) + ((b - c0) * ry) + ((a - b) * rz);

        a = CLUT[base2++];
        b = CLUT[base3++];
        o1 = c1 + ((CLUT[base1++] - a) * rx) + ((b - c1) * ry) + ((a - b) * rz);

        a = CLUT[base2];
        b = CLUT[base3];
        o2 = c2 + ((CLUT[base1] - a) * rx) + ((b - c2) * ry) + ((a - b) * rz);


        if (interpK) {
            base1 += kOffset;
            base2 += kOffset;
            base3 += kOffset;

            a = CLUT[base2++];
            b = CLUT[base3++];
            output[0] = (o0 + (((d0 + ((CLUT[base1++] - a) * rx) + ((b - d0) * ry) + ((a - b) * rz)) - o0) * rk)) * outputScale;

            a = CLUT[base2++];
            b = CLUT[base3++];
            output[1] = (o1 + (((d1 + ((CLUT[base1++] - a) * rx) + ((b - d1) * ry) + ((a - b) * rz)) - o1) * rk)) * outputScale;

            a = CLUT[base2];
            b = CLUT[base3];
            output[2] = (o2 + (((d2 + ((CLUT[base1] - a) * rx) + ((b - d2) * ry) + ((a - b) * rz)) - o2) * rk)) * outputScale;

        } else {
            output[0] = o0 * outputScale;
            output[1] = o1 * outputScale;
            output[2] = o2 * outputScale;
        }

    } else if (rz >= ry && ry >= rx) {
        // block6

        base1 = X1 + Y1 + Z1 + K0;
        base2 = X0 + Y1 + Z1 + K0;
        //base3 = base2;
        base4 = X0 + Y0 + Z1 + K0;
        //base5 = base4;

        a = CLUT[base2++];
        b = CLUT[base4++];
        o0 = c0 + ((CLUT[base1++] - a) * rx) + ((a - b) * ry) + ((b - c0) * rz);

        a = CLUT[base2++];
        b = CLUT[base4++];
        o1 = c1 + ((CLUT[base1++] - a) * rx) + ((a - b) * ry) + ((b - c1) * rz);

        a = CLUT[base2];
        b = CLUT[base4];
        o2 = c2 + ((CLUT[base1] - a) * rx) + ((a - b) * ry) + ((b - c2) * rz);

        if (interpK) {
            base1 += kOffset;
            base2 += kOffset;
            base4 += kOffset;

            a = CLUT[base2++];
            b = CLUT[base4++];
            output[0] = (o0 + (((d0 + ((CLUT[base1++] - a) * rx) + ((a - b) * ry) + ((b - d0) * rz)) - o0) * rk)) * outputScale;

            a = CLUT[base2++];
            b = CLUT[base4++];
            output[1] = (o1 + (((d1 + ((CLUT[base1++] - a) * rx) + ((a - b) * ry) + ((b - d1) * rz)) - o1) * rk)) * outputScale;

            a = CLUT[base2];
            b = CLUT[base4];
            output[2] = (o2 + (((d2 + ((CLUT[base1] - a) * rx) + ((a - b) * ry) + ((b - d2) * rz)) - o2) * rk)) * outputScale;

        } else {
            output[0] = o0 * outputScale;
            output[1] = o1 * outputScale;
            output[2] = o2 * outputScale;
        }

    } else {
        if (interpK) {
            output[0] = c0 + ((d0 - c0) * rk) * outputScale;
            output[1] = c1 + ((d1 - c1) * rk) * outputScale;
            output[2] = c2 + ((d2 - c2) * rk) * outputScale;
        } else {
            output[0] = c0 * outputScale;
            output[1] = c1 * outputScale;
            output[2] = c2 * outputScale;
        }
    }
    return output;
}

/**
 * 4D Tetrahedral interpolation for 4 Channel inputs and 4 Channel outputs
 * Used for CMYK color spaces
 * @param {number[]} input - 4-element array [K, C, M, Y]
 * @param {import('./decode.js').LUT} lut - Lookup table object
 * @returns {number[]} 4-element array of output values
 */
export function tetrahedralInterp4D_4Ch(input, lut) {
    var X0, X1, Y0, K0,
        Y1, Z0, Z1,
        rx, ry, rz, rk,
        px, py, pz, pk,
        input0, input1, input2, inputK,
        base1, base2, base3, base4,
        c0, c1, c2, c3,
        o0, o1, o2, o3,
        k0, k1, k2, k3,
        a, b,
        interpK;

    var outputScale = lut.outputScale;

    var gridEnd = (lut.g1 - 1);
    var gridPointsScale = gridEnd * lut.inputScale;
    var CLUT = lut.CLUT;
    var go0 = lut.go0;
    var go1 = lut.go1;
    var go2 = lut.go2;
    var go3 = lut.go3;
    var kOffset = go3 - lut.outputChannels + 1; // +1 since we don't do a [base++] for the last CLUT lookup

    // We need some clipping here
    inputK = Math.min(1, Math.max(0, input[0])); // K
    input0 = Math.min(1, Math.max(0, input[1])); // C
    input1 = Math.min(1, Math.max(0, input[2])); // M
    input2 = Math.min(1, Math.max(0, input[3])); // Y

    px = input0 * gridPointsScale;
    py = input1 * gridPointsScale;
    pz = input2 * gridPointsScale;
    pk = inputK * gridPointsScale;

    K0 = ~~pk;
    rk = (pk - K0);
    interpK = !(K0 === gridEnd);// K0 and K1 are identical if K0 is the last grid point
    K0 *= go3;
    // No need to calc K1 as we will add kOffset to the base location to get the K1 location

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

    base1 = X0 + Y0 + Z0 + K0;
    c0 = CLUT[base1++];
    c1 = CLUT[base1++];
    c2 = CLUT[base1++];
    c3 = CLUT[base1];

    if (interpK) {
        base1 += kOffset;
        k0 = CLUT[base1++];
        k1 = CLUT[base1++];
        k2 = CLUT[base1++];
        k3 = CLUT[base1];
    }

    var output = new Array(4);

    if (rx >= ry && ry >= rz) {
        // block1
        base1 = X1 + Y0 + Z0 + K0;
        base2 = X1 + Y1 + Z0 + K0;
        //base3 = base1; SAME AS base1
        base4 = X1 + Y1 + Z1 + K0;
        //base5 = base2; SAME as base2

        // Note that baseN is increased after each read from the array to move to the next channel
        a = CLUT[base1++];
        b = CLUT[base2++];
        o0 = (c0 + ((a - c0) * rx) + ((b - a) * ry) + ((CLUT[base4++] - b) * rz));

        a = CLUT[base1++];
        b = CLUT[base2++];
        o1 = (c1 + ((a - c1) * rx) + ((b - a) * ry) + ((CLUT[base4++] - b) * rz));

        a = CLUT[base1++];
        b = CLUT[base2++];
        o2 = (c2 + ((a - c2) * rx) + ((b - a) * ry) + ((CLUT[base4++] - b) * rz));

        a = CLUT[base1];
        b = CLUT[base2];
        o3 = (c3 + ((a - c3) * rx) + ((b - a) * ry) + ((CLUT[base4] - b) * rz));

        if (interpK) {
            base1 += kOffset;
            base2 += kOffset;
            base4 += kOffset;

            a = CLUT[base1++];
            b = CLUT[base2++];
            //output[outputPos++] = c1 + (( d1 - c1 ) * rk)
            output[0] = (o0 + (((k0 + ((a - k0) * rx) + ((b - a) * ry) + ((CLUT[base4++] - b) * rz)) - o0) * rk)) * outputScale;

            a = CLUT[base1++];
            b = CLUT[base2++];
            output[1] = (o1 + (((k1 + ((a - k1) * rx) + ((b - a) * ry) + ((CLUT[base4++] - b) * rz)) - o1) * rk)) * outputScale;

            a = CLUT[base1++];
            b = CLUT[base2++];
            output[2] = (o2 + (((k2 + ((a - k2) * rx) + ((b - a) * ry) + ((CLUT[base4++] - b) * rz)) - o2) * rk)) * outputScale;

            a = CLUT[base1];
            b = CLUT[base2];
            output[3] = (o3 + (((k3 + ((a - k3) * rx) + ((b - a) * ry) + ((CLUT[base4++] - b) * rz)) - o3) * rk)) * outputScale;
        } else {
            output[0] = o0 * outputScale;
            output[1] = o1 * outputScale;
            output[2] = o2 * outputScale;
            output[3] = o3 * outputScale;
        }

    } else if (rx >= rz && rz >= ry) {
        // block2

        base1 = X1 + Y0 + Z0 + K0;
        base2 = X1 + Y1 + Z1 + K0;
        base3 = X1 + Y0 + Z1 + K0;
        //base4 = base3;
        //base5 = base1;

        a = CLUT[base3++];
        b = CLUT[base1++];
        o0 = c0 + ((b - c0) * rx) + ((CLUT[base2++] - a) * ry) + ((a - b) * rz);

        a = CLUT[base3++];
        b = CLUT[base1++];
        o1 = c1 + ((b - c1) * rx) + ((CLUT[base2++] - a) * ry) + ((a - b) * rz);

        a = CLUT[base3++];
        b = CLUT[base1++];
        o2 = c2 + ((b - c2) * rx) + ((CLUT[base2++] - a) * ry) + ((a - b) * rz);

        a = CLUT[base3];
        b = CLUT[base1];
        o3 = c3 + ((b - c3) * rx) + ((CLUT[base2] - a) * ry) + ((a - b) * rz);

        if (interpK) {
            base3 += kOffset;
            base1 += kOffset;
            base2 += kOffset;

            a = CLUT[base3++];
            b = CLUT[base1++];
            output[0] = (o0 + (((k0 + ((b - k0) * rx) + ((CLUT[base2++] - a) * ry) + ((a - b) * rz)) - o0) * rk)) * outputScale;

            a = CLUT[base3++];
            b = CLUT[base1++];
            output[1] = (o1 + (((k1 + ((b - k1) * rx) + ((CLUT[base2++] - a) * ry) + ((a - b) * rz)) - o1) * rk)) * outputScale;

            a = CLUT[base3++];
            b = CLUT[base1++];
            output[2] = (o2 + (((k2 + ((b - k2) * rx) + ((CLUT[base2++] - a) * ry) + ((a - b) * rz)) - o2) * rk)) * outputScale;

            a = CLUT[base3++];
            b = CLUT[base1++];
            output[3] = (o3 + (((k3 + ((b - k3) * rx) + ((CLUT[base2] - a) * ry) + ((a - b) * rz)) - o3) * rk)) * outputScale;
        } else {
            output[0] = o0 * outputScale;
            output[1] = o1 * outputScale;
            output[2] = o2 * outputScale;
            output[3] = o3 * outputScale;
        }

    } else if (rx >= ry && rz >= rx) {
        // block3

        base1 = X1 + Y0 + Z1 + K0;
        base2 = X0 + Y0 + Z1 + K0;
        base3 = X1 + Y1 + Z1 + K0;
        //base4 = base1;
        //base5 = base2;

        a = CLUT[base1++];
        b = CLUT[base2++];
        o0 = c0 + ((a - b) * rx) + ((CLUT[base3++] - a) * ry) + ((b - c0) * rz);

        a = CLUT[base1++];
        b = CLUT[base2++];
        o1 = c1 + ((a - b) * rx) + ((CLUT[base3++] - a) * ry) + ((b - c1) * rz);

        a = CLUT[base1++];
        b = CLUT[base2++];
        o2 = c2 + ((a - b) * rx) + ((CLUT[base3++] - a) * ry) + ((b - c2) * rz);

        a = CLUT[base1];
        b = CLUT[base2];
        o3 = c3 + ((a - b) * rx) + ((CLUT[base3] - a) * ry) + ((b - c3) * rz);

        if (interpK) {
            base1 += kOffset;
            base2 += kOffset;
            base3 += kOffset;

            a = CLUT[base1++];
            b = CLUT[base2++];
            output[0] = (o0 + (((k0 + ((a - b) * rx) + ((CLUT[base3++] - a) * ry) + ((b - k0) * rz)) - o0) * rk)) * outputScale;

            a = CLUT[base1++];
            b = CLUT[base2++];
            output[1] = (o1 + (((k1 + ((a - b) * rx) + ((CLUT[base3++] - a) * ry) + ((b - k1) * rz)) - o1) * rk)) * outputScale;

            a = CLUT[base1++];
            b = CLUT[base2++];
            output[2] = (o2 + (((k2 + ((a - b) * rx) + ((CLUT[base3++] - a) * ry) + ((b - k2) * rz)) - o2) * rk)) * outputScale;

            a = CLUT[base1];
            b = CLUT[base2];
            output[3] = (o3 + (((k3 + ((a - b) * rx) + ((CLUT[base3] - a) * ry) + ((b - k3) * rz)) - o3) * rk)) * outputScale;
        } else {
            output[0] = o0 * outputScale;
            output[1] = o1 * outputScale;
            output[2] = o2 * outputScale;
            output[3] = o3 * outputScale;
        }

    } else if (ry >= rx && rx >= rz) {
        // block4

        base1 = X1 + Y1 + Z0 + K0;
        base2 = X0 + Y1 + Z0 + K0;
        //base3 = base2;
        base4 = X1 + Y1 + Z1 + K0;
        //base5 = base1;

        a = CLUT[base2++];
        b = CLUT[base1++];
        o0 = c0 + ((b - a) * rx) + ((a - c0) * ry) + ((CLUT[base4++] - b) * rz);

        a = CLUT[base2++];
        b = CLUT[base1++];
        o1 = c1 + ((b - a) * rx) + ((a - c1) * ry) + ((CLUT[base4++] - b) * rz);

        a = CLUT[base2++];
        b = CLUT[base1++];
        o2 = c2 + ((b - a) * rx) + ((a - c2) * ry) + ((CLUT[base4++] - b) * rz);

        a = CLUT[base2];
        b = CLUT[base1];
        o3 = c3 + ((b - a) * rx) + ((a - c3) * ry) + ((CLUT[base4] - b) * rz);

        if (interpK) {
            base1 += kOffset;
            base2 += kOffset;
            base4 += kOffset;

            a = CLUT[base2++];
            b = CLUT[base1++];
            output[0] = (o0 + (((k0 + ((b - a) * rx) + ((a - k0) * ry) + ((CLUT[base4++] - b) * rz)) - o0) * rk)) * outputScale;

            a = CLUT[base2++];
            b = CLUT[base1++];
            output[1] = (o1 + (((k1 + ((b - a) * rx) + ((a - k1) * ry) + ((CLUT[base4++] - b) * rz)) - o1) * rk)) * outputScale;

            a = CLUT[base2++];
            b = CLUT[base1++];
            output[2] = (o2 + (((k2 + ((b - a) * rx) + ((a - k2) * ry) + ((CLUT[base4++] - b) * rz)) - o2) * rk)) * outputScale;

            a = CLUT[base2];
            b = CLUT[base1];
            output[3] = (o3 + (((k3 + ((b - a) * rx) + ((a - k3) * ry) + ((CLUT[base4] - b) * rz)) - o3) * rk)) * outputScale;
        } else {
            output[0] = o0 * outputScale;
            output[1] = o1 * outputScale;
            output[2] = o2 * outputScale;
            output[3] = o3 * outputScale;
        }

    } else if (ry >= rz && rz >= rx) {
        // block5

        base1 = X1 + Y1 + Z1 + K0;
        base2 = X0 + Y1 + Z1 + K0;
        base3 = X0 + Y1 + Z0 + K0;
        //base4 = base2;
        //base5 = base3;

        a = CLUT[base2++];
        b = CLUT[base3++];
        o0 = c0 + ((CLUT[base1++] - a) * rx) + ((b - c0) * ry) + ((a - b) * rz);

        a = CLUT[base2++];
        b = CLUT[base3++];
        o1 = c1 + ((CLUT[base1++] - a) * rx) + ((b - c1) * ry) + ((a - b) * rz);

        a = CLUT[base2++];
        b = CLUT[base3++];
        o2 = c2 + ((CLUT[base1++] - a) * rx) + ((b - c2) * ry) + ((a - b) * rz);

        a = CLUT[base2];
        b = CLUT[base3];
        o3 = c3 + ((CLUT[base1] - a) * rx) + ((b - c3) * ry) + ((a - b) * rz);

        if (interpK) {
            base1 += kOffset;
            base2 += kOffset;
            base3 += kOffset;

            a = CLUT[base2++];
            b = CLUT[base3++];
            output[0] = (o0 + (((k0 + ((CLUT[base1++] - a) * rx) + ((b - k0) * ry) + ((a - b) * rz)) - o0) * rk)) * outputScale;

            a = CLUT[base2++];
            b = CLUT[base3++];
            output[1] = (o1 + (((k1 + ((CLUT[base1++] - a) * rx) + ((b - k1) * ry) + ((a - b) * rz)) - o1) * rk)) * outputScale;

            a = CLUT[base2++];
            b = CLUT[base3++];
            output[2] = (o2 + (((k2 + ((CLUT[base1++] - a) * rx) + ((b - k2) * ry) + ((a - b) * rz)) - o2) * rk)) * outputScale;

            a = CLUT[base2];
            b = CLUT[base3];
            output[3] = (o3 + (((k3 + ((CLUT[base1++] - a) * rx) + ((b - k3) * ry) + ((a - b) * rz)) - o3) * rk)) * outputScale;
        } else {
            output[0] = o0 * outputScale;
            output[1] = o1 * outputScale;
            output[2] = o2 * outputScale;
            output[3] = o3 * outputScale;
        }

    } else if (rz >= ry && ry >= rx) {
        // block6

        base1 = X1 + Y1 + Z1 + K0;
        base2 = X0 + Y1 + Z1 + K0;
        //base3 = base2;
        base4 = X0 + Y0 + Z1 + K0;
        //base5 = base4;

        a = CLUT[base2++];
        b = CLUT[base4++];
        o0 = c0 + ((CLUT[base1++] - a) * rx) + ((a - b) * ry) + ((b - c0) * rz);

        a = CLUT[base2++];
        b = CLUT[base4++];
        o1 = c1 + ((CLUT[base1++] - a) * rx) + ((a - b) * ry) + ((b - c1) * rz);

        a = CLUT[base2++];
        b = CLUT[base4++];
        o2 = c2 + ((CLUT[base1++] - a) * rx) + ((a - b) * ry) + ((b - c2) * rz);

        a = CLUT[base2];
        b = CLUT[base4];
        o3 = c3 + ((CLUT[base1] - a) * rx) + ((a - b) * ry) + ((b - c3) * rz);

        if (interpK) {
            base1 += kOffset;
            base2 += kOffset;
            base4 += kOffset;

            a = CLUT[base2++];
            b = CLUT[base4++];
            output[0] = (o0 + (((k0 + ((CLUT[base1++] - a) * rx) + ((a - b) * ry) + ((b - k0) * rz)) - o0) * rk)) * outputScale;

            a = CLUT[base2++];
            b = CLUT[base4++];
            output[1] = (o1 + (((k1 + ((CLUT[base1++] - a) * rx) + ((a - b) * ry) + ((b - k1) * rz)) - o1) * rk)) * outputScale;

            a = CLUT[base2++];
            b = CLUT[base4++];
            output[2] = (o2 + (((k2 + ((CLUT[base1++] - a) * rx) + ((a - b) * ry) + ((b - k2) * rz)) - o2) * rk)) * outputScale;

            a = CLUT[base2];
            b = CLUT[base4];
            output[3] = (o3 + (((k3 + ((CLUT[base1] - a) * rx) + ((a - b) * ry) + ((b - k3) * rz)) - o3) * rk)) * outputScale;
        } else {
            output[0] = o0 * outputScale;
            output[1] = o1 * outputScale;
            output[2] = o2 * outputScale;
            output[3] = o3 * outputScale;
        }

    } else {
        if (interpK) {
            output[0] = c0 + ((k0 - c0) * rk) * outputScale;
            output[1] = c1 + ((k1 - c1) * rk) * outputScale;
            output[2] = c2 + ((k2 - c2) * rk) * outputScale;
            output[3] = c3 + ((k3 - c3) * rk) * outputScale;
        } else {
            output[0] = c0 * outputScale;
            output[1] = c1 * outputScale;
            output[2] = c2 * outputScale;
            output[3] = c3 * outputScale;
        }
    }
    return output;
}

/**
 * 4D Tetrahedral interpolation for N output channels (general case)
 * @param {number[]} input
 * @param {import('./decode.js').LUT} lut
 * @returns {number[]}
 */
export function tetrahedralInterp4D_NCh(input, lut) {
    var X0, X1, Y0, K0,
        Y1, Z0, Z1,
        rx, ry, rz, rk,
        px, py, pz, pk,
        input0, input1, input2, inputK,
        base0, base1, base2, base3, base4,
        a, b, c, d, o,
        interpK;

    var outputScale = lut.outputScale;
    var gridEnd = (lut.g1 - 1);
    var gridPointsScale = gridEnd * lut.inputScale;
    var outputChannels = lut.outputChannels;
    var CLUT = lut.CLUT;
    var go0 = lut.go0;
    var go1 = lut.go1;
    var go2 = lut.go2;
    var go3 = lut.go3;
    var kOffset = go3 - lut.outputChannels;

    inputK = Math.min(1, Math.max(0, input[0])); // K
    input0 = Math.min(1, Math.max(0, input[1])); // C
    input1 = Math.min(1, Math.max(0, input[2])); // M
    input2 = Math.min(1, Math.max(0, input[3])); // Y

    px = input0 * gridPointsScale;
    py = input1 * gridPointsScale;
    pz = input2 * gridPointsScale;
    pk = inputK * gridPointsScale;

    K0 = ~~pk;
    rk = (pk - K0);
    interpK = !(K0 === gridEnd);// K0 and K1 are identical if K0 is the last grid point
    K0 *= go3;
    // No need to calc K1 as we will add kOffset to the base location to get the K1 location

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

    var outputScaleK0 = (interpK) ? 1 : outputScale;

    base0 = X0 + Y0 + Z0 + K0;

    var output = new Array(outputChannels);

    if (rx >= ry && ry >= rz) {
        // block1
        base1 = X1 + Y0 + Z0 + K0;
        base2 = X1 + Y1 + Z0 + K0;
        base4 = X1 + Y1 + Z1 + K0;

        // Read in K0, If K1 is needed outputScaleK0 = 1, else outputScaleK0 = outputScale
        for (let o = 0; o < outputChannels; o++) {
            a = CLUT[base1++];
            b = CLUT[base2++];
            c = CLUT[base0++];
            output[o] = (c + ((a - c) * rx) + ((b - a) * ry) + ((CLUT[base4++] - b) * rz)) * outputScaleK0;
        }

        // Only interpolate K1 if needed, K1 is the next n items in the LUT
        if (interpK) {
            base0 += kOffset;
            base1 += kOffset;
            base2 += kOffset;
            base4 += kOffset;
            for (let o = 0; o < outputChannels; o++) {
                a = CLUT[base1++];
                b = CLUT[base2++];
                c = CLUT[base0++];
                d = output[o]; // get the output from the previous loop to interpolate
                output[o] = (d + (((c + ((a - c) * rx) + ((b - a) * ry) + ((CLUT[base4++] - b) * rz)) - d) * rk)) * outputScale;
            }
        }

    } else if (rx >= rz && rz >= ry) {
        // block2

        base1 = X1 + Y0 + Z0 + K0;
        base2 = X1 + Y1 + Z1 + K0;
        base3 = X1 + Y0 + Z1 + K0;
        for (let o = 0; o < outputChannels; o++) {
            a = CLUT[base3++];
            b = CLUT[base1++];
            c = CLUT[base0++];
            output[o] = (c + ((b - c) * rx) + ((CLUT[base2++] - a) * ry) + ((a - b) * rz)) * outputScaleK0;
        }

        if (interpK) {
            base0 += kOffset;
            base1 += kOffset;
            base2 += kOffset;
            base3 += kOffset;
            for (let o = 0; o < outputChannels; o++) {
                a = CLUT[base3++];
                b = CLUT[base1++];
                c = CLUT[base0++];
                d = output[o];
                output[o] = (d + (((c + ((b - c) * rx) + ((CLUT[base2++] - a) * ry) + ((a - b) * rz)) - d) * rk)) * outputScale;
            }
        }

    } else if (rx >= ry && rz >= rx) {
        // block3

        base1 = X1 + Y0 + Z1 + K0;
        base2 = X0 + Y0 + Z1 + K0;
        base3 = X1 + Y1 + Z1 + K0;
        for (let o = 0; o < outputChannels; o++) {
            a = CLUT[base1++];
            b = CLUT[base2++];
            c = CLUT[base0++];
            output[o] = (c + ((a - b) * rx) + ((CLUT[base3++] - a) * ry) + ((b - c) * rz)) * outputScaleK0;
        }

        if (interpK) {
            base0 += kOffset;
            base1 += kOffset;
            base2 += kOffset;
            base3 += kOffset;

            for (let o = 0; o < outputChannels; o++) {
                a = CLUT[base1++];
                b = CLUT[base2++];
                c = CLUT[base0++];
                d = output[o];
                output[o] = (d + (((c + ((a - b) * rx) + ((CLUT[base3++] - a) * ry) + ((b - c) * rz)) - d) * rk)) * outputScale;
            }
        }

    } else if (ry >= rx && rx >= rz) {
        // block4

        base1 = X1 + Y1 + Z0 + K0;
        base2 = X0 + Y1 + Z0 + K0;
        base4 = X1 + Y1 + Z1 + K0;
        for (let o = 0; o < outputChannels; o++) {
            a = CLUT[base2++];
            b = CLUT[base1++];
            c = CLUT[base0++];
            output[o] = (c + ((b - a) * rx) + ((a - c) * ry) + ((CLUT[base4++] - b) * rz)) * outputScaleK0;
        }

        if (interpK) {
            base0 += kOffset;
            base1 += kOffset;
            base2 += kOffset;
            base4 += kOffset;
            for (let o = 0; o < outputChannels; o++) {
                a = CLUT[base2++];
                b = CLUT[base1++];
                c = CLUT[base0++];
                d = output[o];
                output[o] = (d + (((c + ((b - a) * rx) + ((a - c) * ry) + ((CLUT[base4++] - b) * rz)) - d) * rk)) * outputScale;
            }
        }

    } else if (ry >= rz && rz >= rx) {
        // block5

        base1 = X1 + Y1 + Z1 + K0;
        base2 = X0 + Y1 + Z1 + K0;
        base3 = X0 + Y1 + Z0 + K0;
        for (let o = 0; o < outputChannels; o++) {
            a = CLUT[base2++];
            b = CLUT[base3++];
            c = CLUT[base0++];
            output[o] = (c + ((CLUT[base1++] - a) * rx) + ((b - c) * ry) + ((a - b) * rz)) * outputScaleK0;
        }

        if (interpK) {
            base0 += kOffset;
            base1 += kOffset;
            base2 += kOffset;
            base3 += kOffset;
            for (let o = 0; o < outputChannels; o++) {
                a = CLUT[base2++];
                b = CLUT[base3++];
                c = CLUT[base0++];
                d = output[o];
                output[o] = (d + (((c + ((CLUT[base1++] - a) * rx) + ((b - c) * ry) + ((a - b) * rz)) - d) * rk)) * outputScale;
            }
        }

    } else if (rz >= ry && ry >= rx) {
        // block6

        base1 = X1 + Y1 + Z1 + K0;
        base2 = X0 + Y1 + Z1 + K0;
        base4 = X0 + Y0 + Z1 + K0;

        for (let o = 0; o < outputChannels; o++) {
            a = CLUT[base2++];
            b = CLUT[base4++];
            c = CLUT[base0++];
            output[o] = (c + ((CLUT[base1++] - a) * rx) + ((a - b) * ry) + ((b - c) * rz)) * outputScaleK0;
        }

        if (interpK) {
            base0 += kOffset;
            base1 += kOffset;
            base2 += kOffset;
            base4 += kOffset;
            for (let o = 0; o < outputChannels; o++) {
                a = CLUT[base2++];
                b = CLUT[base4++];
                c = CLUT[base0++];
                d = output[o];
                output[o] = (d + (((c + ((CLUT[base1++] - a) * rx) + ((a - b) * ry) + ((b - c) * rz)) - d) * rk)) * outputScale;
            }
        }

    } else {
        if (interpK) {
            for (let o = 0; o < outputChannels; o++) {
                output[o] = CLUT[base0++];
            }
            base0 += kOffset;
            for (let o = 0; o < outputChannels; o++) {
                c = CLUT[base0++];
                output[o] = (c + ((output[o] - c) * rk)) * outputScale;
            }
        } else {
            for (let o = 0; o < outputChannels; o++) {
                output[o] = CLUT[base0++] * outputScale;
            }
        }
    }

    return output;
}

/**
 * 4D Trilinear interpolation - Slow - Tetrahedral is better
 * @param {number[]} input
 * @param {import('./decode.js').LUT} lut
 * @returns {number[]}
 */
export function trilinearInterp4D_3or4Ch(input, lut) {
    var K0, K1, inputK, pk, rk;
    inputK = pk = Math.max(0.0, Math.min(1.0, input[0] * lut.inputScale));

    pk = pk * (lut.g1 - 1);
    K0 = Math.floor(pk);
    rk = pk - K0;
    K1 = (inputK >= 1.0) ? K0 : K0 + 1;

    var cmyInput = [input[1], input[2], input[3]];

    // Note that K0 and K1 are the offsets into the lut for the 4D case
    var output1 = trilinearInterp3D_3or4Ch(cmyInput, lut, K0);
    if (rk === 0) {
        return output1;
    } // edge case

    var output2 = trilinearInterp3D_3or4Ch(cmyInput, lut, K1);

    // interpolate two results
    // Note that trilinearInterp3D already applies the output scale
    if (lut.outputChannels === 3) {
        return [
            output1[0] + (output2[0] - output1[0]) * rk,
            output1[1] + (output2[1] - output1[1]) * rk,
            output1[2] + (output2[2] - output1[2]) * rk,
        ];
    }

    output1[0] = output1[0] + (output2[0] - output1[0]) * rk;
    output1[1] = output1[1] + (output2[1] - output1[1]) * rk;
    output1[2] = output1[2] + (output2[2] - output1[2]) * rk;
    output1[3] = output1[3] + (output2[3] - output1[3]) * rk;
    return output1;
}

/**
 * Optimized trilinear interpolation for 3D inputs and 3 or 4 channel outputs
 * @param {number[]} input
 * @param {import('./decode.js').LUT} lut
 * @param {number} k0 - K dimension offset (optional, defaults to 0)
 * @returns {number[]}
 */
export function trilinearInterp3D_3or4Ch(input, lut, k0) {
    k0 = (k0 === undefined) ? 0 : k0;

    if (!lut?.gridPoints) throw new TypeError('Invalid LUT: Missing gridPoints');
    if (!lut?.CLUT) throw new TypeError('Invalid LUT: Missing CLUT');

    const inputChannels = lut.inputChannels;
    const outputChannels = lut.outputChannels;
    const inputScale = lut.inputScale;
    const outputScale = lut.outputScale;
    const gridPoints = lut.gridPoints[0];
    const clut = lut.CLUT;

    const g1 = gridPoints;
    const g2 = gridPoints * g1; // g^2
    const g3 = gridPoints * g2; // g^3

    const px = Math.min(Math.max(input[0] * inputScale, 0.0), 1.0) * (gridPoints - 1);
    const py = Math.min(Math.max(input[1] * inputScale, 0.0), 1.0) * (gridPoints - 1);
    const pz = Math.min(Math.max(input[2] * inputScale, 0.0), 1.0) * (gridPoints - 1);

    const x0 = Math.floor(px);
    const y0 = Math.floor(py);
    const z0 = Math.floor(pz);

    const fx = px - x0;
    const fy = py - y0;
    const fz = pz - z0;

    const x1 = x0 + (input[0] >= 1.0 ? 0.0 : 1.0);
    const y1 = y0 + (input[1] >= 1.0 ? 0.0 : 1.0);
    const z1 = z0 + (input[2] >= 1.0 ? 0.0 : 1.0);

    //lookup
    const d000 = lookup(x0, y0, z0, k0, clut, inputChannels, outputChannels);
    const d001 = lookup(x0, y0, z1, k0, clut, inputChannels, outputChannels);
    const d010 = lookup(x0, y1, z0, k0, clut, inputChannels, outputChannels);
    const d011 = lookup(x0, y1, z1, k0, clut, inputChannels, outputChannels);

    const d100 = lookup(x1, y0, z0, k0, clut, inputChannels, outputChannels);
    const d101 = lookup(x1, y0, z1, k0, clut, inputChannels, outputChannels);
    const d110 = lookup(x1, y1, z0, k0, clut, inputChannels, outputChannels);
    const d111 = lookup(x1, y1, z1, k0, clut, inputChannels, outputChannels);

    const dx00 = lerp(fx, d000, d100);
    const dx01 = lerp(fx, d001, d101);
    const dx10 = lerp(fx, d010, d110);
    const dx11 = lerp(fx, d011, d111);

    const dxy0 = lerp(fy, dx00, dx10);
    const dxy1 = lerp(fy, dx01, dx11);

    const dxyz = lerp(fz, dxy0, dxy1);

    if (outputChannels === 3) {
        return [
            dxyz[0] *= outputScale,
            dxyz[1] *= outputScale,
            dxyz[2] *= outputScale
        ];
    }

    return [
        dxyz[0] *= outputScale,
        dxyz[1] *= outputScale,
        dxyz[2] *= outputScale,
        dxyz[3] *= outputScale
    ];

    /**
     * Linear interpolation.
     * 
     * @param {number} frac 
     * @param {number[]} low 
     * @param {number[]} high 
     */
    function lerp(frac, low, high) {
        if (outputChannels === 3) {
            return [
                low[0] + (frac * (high[0] - low[0])),
                low[1] + (frac * (high[1] - low[1])),
                low[2] + (frac * (high[2] - low[2]))
            ];
        }

        return [
            low[0] + (frac * (high[0] - low[0])),
            low[1] + (frac * (high[1] - low[1])),
            low[2] + (frac * (high[2] - low[2])),
            low[3] + (frac * (high[3] - low[3]))
        ];
    }

    /**
     * Lookup in the CLUT.
     *
     * @param {number} x
     * @param {number} y
     * @param {number} z
     * @param {number} k
     * @param {Exclude<import('./decode.js').LUT['CLUT'], undefined | false>} clut 
     * @param {number} inputChannels 
     * @param {number} outputChannels
     */
    function lookup(x, y, z, k, clut, inputChannels, outputChannels) {

        var base;
        if (inputChannels === 3) {
            base = ((x * g2) + (y * g1) + z) * outputChannels;
        } else {
            base = ((k * g3) + (x * g2) + (y * g1) + z) * outputChannels;
        }

        if (outputChannels === 3) {
            return [clut[base], clut[base + 1], clut[base + 2]];
        }
        return [clut[base], clut[base + 1], clut[base + 2], clut[base + 3]];
    }
}

/**
 * tetrahedralInterp3D_Master
 * Initialize the tetrahedral interpolation - Master implementation
 * @param {number[]} input - Input color values
 * @param {import('./decode.js').LUT} lut - Lookup table structure  
 * @param {number} K0 - Offset for 4D interpolation
 * @returns {number[]} Interpolated output color values
 */
export function tetrahedralInterp3D_Master(input, lut, K0) {
    var inputChannels = lut.inputChannels;
    var outputChannels = lut.outputChannels;
    var gridPoints = lut.gridPoints[0];
    var CLUT = lut.CLUT;
    var rx, ry, rz;

    var g1 = gridPoints;
    var g2 = gridPoints * g1; // g^2
    var g3 = gridPoints * g2; // g^3

    var output;
    if (lut.outputChannels === 3) {
        output = [0.0, 0.0, 0.0];
    } else {
        output = [0.0, 0.0, 0.0, 0.0];
    }
    var c0, c1, c2, c3;
    var X0, X1, Y0, Y1, Z0, Z1, px, py, pz, input0, input1, input2;
    input0 = px = input[0] * lut.inputScale;
    input1 = py = input[1] * lut.inputScale;
    input2 = pz = input[2] * lut.inputScale;

    px = Math.min(Math.max(px, 0.0), 1.0);
    py = Math.min(Math.max(py, 0.0), 1.0);
    pz = Math.min(Math.max(pz, 0.0), 1.0);

    px = px * (gridPoints - 1);
    py = py * (gridPoints - 1);
    pz = pz * (gridPoints - 1);

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

    //console.log('X0='+X0+' Y0='+Y0+' Z0='+Z0+' K0='+K0);
    //console.log(c0);
    if (rx >= ry && ry >= rz) {
        //1
        c1 = sub16(lookup(X1, Y0, Z0, K0), c0);
        c2 = sub16(lookup(X1, Y1, Z0, K0), lookup(X1, Y0, Z0, K0));
        c3 = sub16(lookup(X1, Y1, Z1, K0), lookup(X1, Y1, Z0, K0));
    } else if (rx >= rz && rz >= ry) {
        //2
        c1 = sub16(lookup(X1, Y0, Z0, K0), c0);
        c2 = sub16(lookup(X1, Y1, Z1, K0), lookup(X1, Y0, Z1, K0));
        c3 = sub16(lookup(X1, Y0, Z1, K0), lookup(X1, Y0, Z0, K0));
    } else if (rz >= rx && rx >= ry) {
        //3
        c1 = sub16(lookup(X1, Y0, Z1, K0), lookup(X0, Y0, Z1, K0));
        c2 = sub16(lookup(X1, Y1, Z1, K0), lookup(X1, Y0, Z1, K0));
        c3 = sub16(lookup(X0, Y0, Z1, K0), c0);
    } else if (ry >= rx && rx >= rz) {
        //4
        c1 = sub16(lookup(X1, Y1, Z0, K0), lookup(X0, Y1, Z0, K0));
        c2 = sub16(lookup(X0, Y1, Z0, K0), c0);
        c3 = sub16(lookup(X1, Y1, Z1, K0), lookup(X1, Y1, Z0, K0));
    } else if (ry >= rz && rz >= rx) {
        //5
        c1 = sub16(lookup(X1, Y1, Z1, K0), lookup(X0, Y1, Z1, K0));
        c2 = sub16(lookup(X0, Y1, Z0, K0), c0);
        c3 = sub16(lookup(X0, Y1, Z1, K0), lookup(X0, Y1, Z0, K0));
    } else if (rz >= ry && ry >= rx) {
        //6
        c1 = sub16(lookup(X1, Y1, Z1, K0), lookup(X0, Y1, Z1, K0));
        c2 = sub16(lookup(X0, Y1, Z1, K0), lookup(X0, Y0, Z1, K0));
        c3 = sub16(lookup(X0, Y0, Z1, K0), c0);
    } else {
        c1 = c2 = c3 = [0, 0, 0, 0];
    }

    output[0] = (c0[0] + (c1[0] * rx) + (c2[0] * ry) + (c3[0] * rz)) * lut.outputScale;
    output[1] = (c0[1] + (c1[1] * rx) + (c2[1] * ry) + (c3[1] * rz)) * lut.outputScale;
    output[2] = (c0[2] + (c1[2] * rx) + (c2[2] * ry) + (c3[2] * rz)) * lut.outputScale;
    if (lut.outputChannels === 3) {
        return output;
    }
    output[3] = (c0[3] + (c1[3] * rx) + (c2[3] * ry) + (c3[3] * rz)) * lut.outputScale;
    return output;

    function lookup(x, y, z, k) {
        var base;
        if (inputChannels === 3) {
            base = ((x * g2) + (y * g1) + z) * outputChannels;
        } else {
            base = ((k * g3) + (x * g2) + (y * g1) + z) * outputChannels;
        }

        if (lut.outputChannels === 3) {
            return [CLUT[base], CLUT[base + 1], CLUT[base + 2]];
        }
        return [CLUT[base], CLUT[base + 1], CLUT[base + 2], CLUT[base + 3]];
    }

    function sub16(a, b) {
        var r = [];
        r[0] = a[0] - b[0];
        r[1] = a[1] - b[1];
        r[2] = a[2] - b[2];
        if (lut.outputChannels === 3) {
            return r;
        }
        r[3] = a[3] - b[3];
        return r;
    }
}

/**
 * tetrahedralInterp4D_3or4Ch_Master
 * 4D tetrahedral interpolation master implementation
 * For more than 3 inputs (i.e., CMYK) evaluate two 3-dimensional interpolations 
 * and then linearly interpolate between them.
 * @param {number[]} input - Input color values (4 channels)
 * @param {import('./decode.js').LUT} lut - Lookup table structure
 * @returns {number[]} Interpolated output color values
 */
export function tetrahedralInterp4D_3or4Ch_Master(input, lut) {
    var K0, K1, inputK, pk, rk;
    inputK = pk = Math.max(0.0, Math.min(1.0, input[0] * lut.inputScale));

    pk = pk * (lut.g1 - 1);
    K0 = Math.floor(pk);
    rk = pk - K0;
    K1 = (inputK >= 1.0) ? K0 : K0 + 1;

    var cmyInput = [input[1], input[2], input[3]];

    var output1 = tetrahedralInterp3D_Master(cmyInput, lut, K0);
    // Such a small edge case where k===n/g1 perhaps faster without checking
    if (rk === 0) {
        return output1;
    }
    var output2 = tetrahedralInterp3D_Master(cmyInput, lut, K1);

    // interpolate two results
    // Note that tetrahedralInterp3D already applies the output scale
    output1[0] = output1[0] + ((output2[0] - output1[0]) * rk);
    output1[1] = output1[1] + ((output2[1] - output1[1]) * rk);
    output1[2] = output1[2] + ((output2[2] - output1[2]) * rk);
    if (lut.outputChannels === 3) {
        return output1;
    }
    output1[3] = output1[3] + ((output2[3] - output1[3]) * rk);
    return output1;
}
