/**
 * @fileoverview LookupTable class and color transformation processing functions
 * This module provides a comprehensive LUT (Lookup Table) system for color transformations
 * with support for CMYK processing options like "Promote Gray to CMYK Black" and "Preserve CMYK Primaries"
 */

// @ts-check

/**
 * @typedef {Object} LookupTableOptions
 * @property {number} inputChannels - Number of input color channels (1-4)
 * @property {number} outputChannels - Number of output color channels (1-4)
 * @property {number[]} gridPoints - Array of grid points for each dimension
 * @property {Float64Array|Uint8Array|Uint16Array} CLUT - Color lookup table data
 * @property {string} [encoding='number'] - Data encoding type ('number', 'base64')
 * @property {number} [precision=null] - Bit precision (8, 16, or null for float)
 * @property {number} [inputScale=1] - Input scaling factor
 * @property {number} [outputScale=1] - Output scaling factor
 * @property {boolean} [promoteGrayToCMYKBlack=false] - Promote gray values to CMYK black channel
 * @property {string} [interpolation3D='tetrahedral'] - 3D interpolation method
 * @property {string} [interpolation4D='tetrahedral'] - 4D interpolation method
 * @property {string} [interpolation='tetrahedral'] - 3D or 4D interpolation method
 * @property {boolean} [verbose=false] - Enable verbose logging
 */

/**
 * LookupTable class for color transformation data and operations
 * Serves as a data container that can be referenced by Transform instances
 */
export class LookupTable {
    /**
     * Creates a new LookupTable instance
     * @param {LookupTableOptions} options - Configuration options for the lookup table
     */
    constructor(options) {
        this.inputChannels = options.inputChannels || 0;
        this.outputChannels = options.outputChannels || 0;

        // Handle gridPoints as either array or single number
        if (Array.isArray(options.gridPoints)) {
            this.gridPoints = options.gridPoints;
        } else if (typeof options.gridPoints === 'number') {
            // Convert single number to array based on input channels
            const channels = options.inputChannels || 1;
            this.gridPoints = new Array(channels).fill(options.gridPoints);
        } else {
            this.gridPoints = [];
        }

        this.CLUT = options.CLUT || new Float64Array(0);
        this.encoding = options.encoding || 'number';
        this.precision = options.precision || null;
        this.inputScale = options.inputScale || 1;
        this.outputScale = options.outputScale || 1;

        // CMYK processing options
        this.promoteGrayToCMYKBlack = Boolean(options.promoteGrayToCMYKBlack);

        // Interpolation settings
        this.interpolation3D = options.interpolation3D || options.interpolation || 'tetrahedral';
        this.interpolation4D = options.interpolation4D || options.interpolation || 'tetrahedral';

        // Support generic interpolation property for tests/compatibility
        this.interpolation = options.interpolation || 'tetrahedral';

        this.verbose = Boolean(options.verbose);

        // Validate grid points if provided
        if (this.gridPoints.length > 0) {
            for (const points of this.gridPoints) {
                if (points <= 0 || !Number.isInteger(points)) {
                    throw new Error(`Invalid grid points: ${points}. Grid points must be positive integers.`);
                }
            }
        }

        // Validate CLUT size consistency
        if (options.CLUT && this.gridPoints.length > 0 && this.inputChannels && this.outputChannels) {
            const expectedSize = this.gridPoints.reduce((acc, points) => acc * points, 1) * this.outputChannels;
            if (options.CLUT.length !== expectedSize) {
                throw new Error(`CLUT size mismatch: expected ${expectedSize}, got ${options.CLUT.length}`);
            }
        }

        // Calculate grid offsets for fast access
        this.calculateGridOffsets();
    }

    /**
     * Calculate grid offset values for efficient LUT access
     * @private
     */
    calculateGridOffsets() {
        const g = this.gridPoints;
        this.g1 = g[0] || 0;
        this.g2 = this.g1 * (g[1] || 1);
        this.g3 = this.g2 * (g[2] || 1);
        this.go0 = this.outputChannels;
        this.go1 = this.g1 * this.outputChannels;
        this.go2 = this.g2 * this.outputChannels;
        this.go3 = this.g3 * this.outputChannels;
    }

    /**
     * Forward lookup - transforms input color through the LUT
     * @param {number[]} inputColor - Input color values
     * @returns {number[]} Transformed color values
     */
    forwardLookup(inputColor) {
        switch (this.inputChannels) {
            case 1:
                return linearInterp1D(this, inputColor);
            case 2:
                return bilinearInterp2D(this, inputColor);
            case 3:
                if (this.interpolation3D === 'trilinear') {
                    return trilinearInterp3D(this, inputColor);
                }
                return tetrahedralInterp3D(this, inputColor);
            case 4:
                if (this.interpolation4D === 'trilinear') {
                    return trilinearInterp4D(this, inputColor);
                }
                return tetrahedralInterp4D(this, inputColor);
            default:
                throw new Error(`Unsupported input channels: ${this.inputChannels}`);
        }
    }

    /**
     * Reverse lookup - finds input color that produces given output (approximation)
     * @param {number[]} outputColor - Target output color values
     * @returns {number[]} Approximated input color values
     */
    reverseLookup(outputColor) {
        // This is a simplified reverse lookup implementation
        // For production use, consider implementing a more sophisticated algorithm
        throw new Error('Reverse lookup not yet implemented');
    }

    /**
     * Transform an array of colors using the appropriate processing function
     * @param {Uint8Array|Uint16Array|Float32Array|Float64Array} inputArray - Input color array
     * @param {boolean} [inputHasAlpha=false] - Whether input has alpha channel
     * @param {boolean} [outputHasAlpha=false] - Whether output should have alpha channel
     * @param {boolean} [preserveAlpha=false] - Whether to preserve alpha values
     * @param {number} [pixelCount] - Number of pixels to process
     * @returns {Uint8ClampedArray|Uint16Array|Float32Array|Float64Array} Transformed color array
     */
    transformArray(inputArray, inputHasAlpha = false, outputHasAlpha = false, preserveAlpha = false, pixelCount) {
        if (preserveAlpha === undefined) {
            preserveAlpha = outputHasAlpha && inputHasAlpha;
        }

        const inputBytesPerPixel = (inputHasAlpha) ? this.inputChannels + 1 : this.inputChannels;
        const outputBytesPerPixel = (outputHasAlpha) ? this.outputChannels + 1 : this.outputChannels;

        if (pixelCount === undefined) {
            pixelCount = Math.floor(inputArray.length / inputBytesPerPixel);
        }

        const outputArray = this.outputScale === 255 ?
            new Uint8ClampedArray(pixelCount * outputBytesPerPixel) :
            new Uint16Array(pixelCount * outputBytesPerPixel);

        switch (this.inputChannels) {
            case 1:
                return /** @type {Uint8ClampedArray|Uint16Array} */ (linearInterp1DArray_NCh_loop(inputArray, 0, outputArray, 0, pixelCount, this, inputHasAlpha, outputHasAlpha, preserveAlpha));
            case 2:
                return /** @type {Uint8ClampedArray|Uint16Array} */ (bilinearInterp2DArray_NCh_loop(inputArray, 0, outputArray, 0, pixelCount, this, inputHasAlpha, outputHasAlpha, preserveAlpha));
            case 3:
                return /** @type {Uint8ClampedArray|Uint16Array} */ (tetrahedralInterp3DArray_NCh_loop(inputArray, 0, outputArray, 0, pixelCount, this, inputHasAlpha, outputHasAlpha, preserveAlpha));
            case 4:
                return /** @type {Uint8ClampedArray|Uint16Array} */ (tetrahedralInterp4DArray_NCh_loop(inputArray, 0, outputArray, 0, pixelCount, this, inputHasAlpha, outputHasAlpha, preserveAlpha));
            default:
                throw new Error(`Unsupported input channels: ${this.inputChannels}`);
        }
    }
}

// ============================================================================
// LUT Creation Functions
// ============================================================================

/**
 * Create a 1D device LUT for monotone (grayscale) transformations
 * @param {import('./transform.js').Transform} transform - Transform instance with pipeline
 * @param {number} outputChannels - Number of output color channels
 * @param {number} gridPoints - Number of grid points for the lookup table
 * @returns {Float64Array} 1D device lookup table
 */
export function create1DDeviceLUT(transform, outputChannels, gridPoints) {
    const CLUT = new Float64Array(outputChannels * gridPoints);
    const step = 1 / (gridPoints - 1);
    let position = 0;
    let count = 0;

    for (let a = 0; a < gridPoints; a++) {
        const device = transform.forward([a * step]);
        for (let o = 0; o < outputChannels; o++) {
            CLUT[position++] = device[o];
        }
        count++;
    }

    if (transform.verbose) {
        console.log('1D LUT size: %d points @ %d', count, gridPoints);
    }

    return CLUT;
}

/**
 * Create a 2D device LUT for duotone transformations
 * @param {import('./transform.js').Transform} transform - Transform instance with pipeline
 * @param {number} outputChannels - Number of output color channels
 * @param {number} gridPoints - Number of grid points for the lookup table
 * @returns {Float64Array} 2D device lookup table
 */
export function create2DDeviceLUT(transform, outputChannels, gridPoints) {
    const lutsize = gridPoints * gridPoints;
    const CLUT = new Float64Array(outputChannels * lutsize);
    const step = 1 / (gridPoints - 1);
    let position = 0;
    let count = 0;

    for (let a = 0; a < gridPoints; a++) {
        const av = a * step;
        for (let b = 0; b < gridPoints; b++) {
            const device = transform.forward([av, b * step]);
            for (let o = 0; o < outputChannels; o++) {
                CLUT[position++] = device[o];
            }
            count++;
        }
    }

    if (transform.verbose) {
        console.log('2D LUT size: %d points @ %d × %d', count, gridPoints, gridPoints);
    }

    return CLUT;
}

/**
 * Create a 3D device LUT for RGB/Lab transformations
 * @param {import('./transform.js').Transform} transform - Transform instance with pipeline
 * @param {number} outputChannels - Number of output color channels
 * @param {number} gridPoints - Number of grid points for the lookup table
 * @param {Object} [options={}] - Additional options for CMYK processing
 * @returns {Float64Array} 3D device lookup table
 */
export function create3DDeviceLUT(transform, outputChannels, gridPoints, options = {}) {
    const lutsize = gridPoints * gridPoints * gridPoints;
    const CLUT = new Float64Array(outputChannels * lutsize);
    const step = 1 / (gridPoints - 1);
    let position = 0;
    let count = 0;

    for (let r = 0; r < gridPoints; r++) {
        const rv = r * step;
        for (let g = 0; g < gridPoints; g++) {
            const gv = g * step;
            for (let b = 0; b < gridPoints; b++) {
                const device = transform.forward([rv, gv, b * step]);

                // Apply CMYK processing options if output is CMYK
                let result = device;
                if (outputChannels === 4) {
                    if (options.promoteGrayToCMYKBlack) {
                        result = applyPromoteGrayToCMYKBlack(result, [rv, gv, b * step]);
                    }
                }

                for (let o = 0; o < outputChannels; o++) {
                    CLUT[position++] = result[o];
                }
                count++;
            }
        }
    }

    if (transform.verbose) {
        console.log('3D LUT size: %d points @ %d × %d × %d', count, gridPoints, gridPoints, gridPoints);
    }

    return CLUT;
}

/**
 * Create a 4D device LUT for CMYK transformations
 * @param {import('./transform.js').Transform} transform - Transform instance with pipeline
 * @param {number} outputChannels - Number of output color channels
 * @param {number} gridPoints - Number of grid points for the lookup table
 * @param {Object} [options={}] - Additional options for CMYK processing
 * @returns {Float64Array} 4D device lookup table
 */
export function create4DDeviceLUT(transform, outputChannels, gridPoints, options = {}) {
    const lutsize = gridPoints * gridPoints * gridPoints * gridPoints;
    const CLUT = new Float64Array(outputChannels * lutsize);
    const step = 1 / (gridPoints - 1);
    let position = 0;
    let count = 0;
    // let input = [0, 0, 0, 0];
    // let result = [0, 0, 0, 0];

    if (transform.promoteGrayToCMYKBlack) {

        for (let c = 0; c < gridPoints; c++) {
            const cv = c * step;
            for (let m = 0; m < gridPoints; m++) {
                const mv = m * step;
                for (let y = 0; y < gridPoints; y++) {
                    const yv = y * step;
                    for (let k = 0; k < gridPoints; k++) {
                        const kv = k * step;
                        const input = [cv, mv, yv, kv];
                        const result = transform.forward(input);

                        // console.log(result);

                        // // Apply CMYK processing options
                        // if (options.promoteGrayToCMYKBlack && outputChannels === 4) {
                        //     result = applyPromoteGrayToCMYKBlack(result, [cv, mv, yv, kv]);
                        // }

                        for (let o = 0; o < outputChannels; o++) {
                            CLUT[position++] = result[o];
                        }
                        count++;
                    }
                }
            }
        }
    } else {
        for (let c = 0; c < gridPoints; c++) {
            const cv = c * step;
            for (let m = 0; m < gridPoints; m++) {
                const mv = m * step;
                for (let y = 0; y < gridPoints; y++) {
                    const yv = y * step;
                    for (let k = 0; k < gridPoints; k++) {
                        const kv = k * step;
                        const result = transform.forward([cv, mv, yv, kv]);

                        // // Apply CMYK processing options
                        // if (options.promoteGrayToCMYKBlack && outputChannels === 4) {
                        //     result = applyPromoteGrayToCMYKBlack(result, [cv, mv, yv, kv]);
                        // }

                        for (let o = 0; o < outputChannels; o++) {
                            CLUT[position++] = result[o];
                        }
                        count++;
                    }
                }
            }
        }
    }
    if (transform.verbose) {
        console.log('4D LUT size: %d points @ %d × %d × %d × %d', count, gridPoints, gridPoints, gridPoints, gridPoints);
    }

    return CLUT;
}

// ============================================================================
// CMYK Processing Functions
// ============================================================================

/**
 * Apply "Promote Gray to CMYK Black" processing
 * @param {number[]} outputColor - Output CMYK color values
 * @param {number[]} inputColor - Input CMYK color values
 * @returns {number[]} Processed CMYK color values
 */
function applyPromoteGrayToCMYKBlack(outputColor, inputColor) {
    const [c, m, y, k] = inputColor;

    // Check if input is gray (C = M = Y and K is varying)
    const tolerance = 0.01;
    if (Math.abs(c - m) < tolerance && Math.abs(m - y) < tolerance) {
        // This is a gray color, promote it to black channel
        const grayValue = (c + m + y) / 3;
        const newK = Math.min(1, k + grayValue);
        const reduction = grayValue;

        return [
            Math.max(0, outputColor[0] - reduction),
            Math.max(0, outputColor[1] - reduction),
            Math.max(0, outputColor[2] - reduction),
            Math.min(1, outputColor[3] + reduction)
        ];
    }

    return outputColor;
}

// ============================================================================
// Interpolation Functions for Single Colors
// ============================================================================

/**
 * Linear interpolation for 1D LUTs
 * @param {LookupTable} lut - The lookup table instance
 * @param {number[]} input - Input color values [a]
 * @returns {number[]} Interpolated output color values
 */
export function linearInterp1D(lut, input) {
    const a = input[0] * lut.inputScale;
    const ga = lut.gridPoints[0] - 1;
    const fa = a * ga;
    const ia = Math.floor(fa);
    const wa = fa - ia;

    const outputChannels = lut.outputChannels;
    const result = new Array(outputChannels);

    if (ia >= ga) {
        // Beyond grid, use last values
        const pos = ga * outputChannels;
        for (let o = 0; o < outputChannels; o++) {
            result[o] = lut.CLUT[pos + o] * lut.outputScale;
        }
    } else {
        // Interpolate between two points
        const pos0 = ia * outputChannels;
        const pos1 = (ia + 1) * outputChannels;

        for (let o = 0; o < outputChannels; o++) {
            const v0 = lut.CLUT[pos0 + o];
            const v1 = lut.CLUT[pos1 + o];
            result[o] = (v0 + wa * (v1 - v0)) * lut.outputScale;
        }
    }

    return result;
}

/**
 * Bilinear interpolation for 2D LUTs
 * @param {LookupTable} lut - The lookup table instance
 * @param {number[]} input - Input color values [a, b]
 * @returns {number[]} Interpolated output color values
 */
export function bilinearInterp2D(lut, input) {
    const [a, b] = input.map(v => v * lut.inputScale);
    const [ga, gb] = lut.gridPoints.map(g => g - 1);

    const fa = a * ga;
    const fb = b * gb;
    const ia = Math.max(0, Math.min(ga - 1, Math.floor(fa)));
    const ib = Math.max(0, Math.min(gb - 1, Math.floor(fb)));
    const wa = fa - ia;
    const wb = fb - ib;

    const outputChannels = lut.outputChannels;
    const result = new Array(outputChannels);

    // Calculate positions for the 4 corners
    const pos00 = (ia * lut.g1 + ib) * outputChannels;
    const pos01 = (ia * lut.g1 + ib + 1) * outputChannels;
    const pos10 = ((ia + 1) * lut.g1 + ib) * outputChannels;
    const pos11 = ((ia + 1) * lut.g1 + ib + 1) * outputChannels;

    for (let o = 0; o < outputChannels; o++) {
        const v00 = lut.CLUT[pos00 + o];
        const v01 = lut.CLUT[pos01 + o];
        const v10 = lut.CLUT[pos10 + o];
        const v11 = lut.CLUT[pos11 + o];

        const v0 = v00 + wb * (v01 - v00);
        const v1 = v10 + wb * (v11 - v10);
        result[o] = (v0 + wa * (v1 - v0)) * lut.outputScale;
    }

    return result;
}

/**
 * Trilinear interpolation for 3D LUTs
 * @param {LookupTable} lut - The lookup table instance
 * @param {number[]} input - Input color values [r, g, b]
 * @returns {number[]} Interpolated output color values
 */
export function trilinearInterp3D(lut, input) {
    const [r, g, b] = input.map(v => v * lut.inputScale);
    const [gr, gg, gb] = lut.gridPoints.map(g => g - 1);

    const fr = r * gr;
    const fg = g * gg;
    const fb = b * gb;
    const ir = Math.max(0, Math.min(gr - 1, Math.floor(fr)));
    const ig = Math.max(0, Math.min(gg - 1, Math.floor(fg)));
    const ib = Math.max(0, Math.min(gb - 1, Math.floor(fb)));
    const wr = fr - ir;
    const wg = fg - ig;
    const wb = fb - ib;

    const outputChannels = lut.outputChannels;
    const result = new Array(outputChannels);

    // Calculate positions for the 8 corners of the cube
    const pos000 = (ir * lut.g2 + ig * lut.g1 + ib) * outputChannels;
    const pos001 = (ir * lut.g2 + ig * lut.g1 + ib + 1) * outputChannels;
    const pos010 = (ir * lut.g2 + (ig + 1) * lut.g1 + ib) * outputChannels;
    const pos011 = (ir * lut.g2 + (ig + 1) * lut.g1 + ib + 1) * outputChannels;
    const pos100 = ((ir + 1) * lut.g2 + ig * lut.g1 + ib) * outputChannels;
    const pos101 = ((ir + 1) * lut.g2 + ig * lut.g1 + ib + 1) * outputChannels;
    const pos110 = ((ir + 1) * lut.g2 + (ig + 1) * lut.g1 + ib) * outputChannels;
    const pos111 = ((ir + 1) * lut.g2 + (ig + 1) * lut.g1 + ib + 1) * outputChannels;

    for (let o = 0; o < outputChannels; o++) {
        const v000 = lut.CLUT[pos000 + o];
        const v001 = lut.CLUT[pos001 + o];
        const v010 = lut.CLUT[pos010 + o];
        const v011 = lut.CLUT[pos011 + o];
        const v100 = lut.CLUT[pos100 + o];
        const v101 = lut.CLUT[pos101 + o];
        const v110 = lut.CLUT[pos110 + o];
        const v111 = lut.CLUT[pos111 + o];

        const v00 = v000 + wb * (v001 - v000);
        const v01 = v010 + wb * (v011 - v010);
        const v10 = v100 + wb * (v101 - v100);
        const v11 = v110 + wb * (v111 - v110);

        const v0 = v00 + wg * (v01 - v00);
        const v1 = v10 + wg * (v11 - v10);

        result[o] = (v0 + wr * (v1 - v0)) * lut.outputScale;
    }

    return result;
}

/**
 * Tetrahedral interpolation for 3D LUTs (more accurate than trilinear)
 * @param {LookupTable} lut - The lookup table instance
 * @param {number[]} input - Input color values [r, g, b]
 * @returns {number[]} Interpolated output color values
 */
export function tetrahedralInterp3D(lut, input) {
    const [r, g, b] = input.map(v => v * lut.inputScale);
    const [gr, gg, gb] = lut.gridPoints.map(g => g - 1);

    const fr = r * gr;
    const fg = g * gg;
    const fb = b * gb;
    const ir = Math.max(0, Math.min(gr - 1, Math.floor(fr)));
    const ig = Math.max(0, Math.min(gg - 1, Math.floor(fg)));
    const ib = Math.max(0, Math.min(gb - 1, Math.floor(fb)));
    const wr = fr - ir;
    const wg = fg - ig;
    const wb = fb - ib;

    const outputChannels = lut.outputChannels;
    const result = new Array(outputChannels);

    // Base position in the LUT
    const basePos = (ir * lut.g2 + ig * lut.g1 + ib) * outputChannels;

    for (let o = 0; o < outputChannels; o++) {
        let value = lut.CLUT[basePos + o]; // v000

        if (wr >= wg) {
            if (wg >= wb) {
                // wr >= wg >= wb: tetrahedron 1
                value += wr * (lut.CLUT[basePos + lut.go2 + o] - lut.CLUT[basePos + o]); // v100 - v000
                value += wg * (lut.CLUT[basePos + lut.go2 + lut.go1 + o] - lut.CLUT[basePos + lut.go2 + o]); // v110 - v100
                value += wb * (lut.CLUT[basePos + lut.go2 + lut.go1 + lut.go0 + o] - lut.CLUT[basePos + lut.go2 + lut.go1 + o]); // v111 - v110
            } else if (wr >= wb) {
                // wr >= wb >= wg: tetrahedron 2
                value += wr * (lut.CLUT[basePos + lut.go2 + o] - lut.CLUT[basePos + o]); // v100 - v000
                value += wb * (lut.CLUT[basePos + lut.go2 + lut.go0 + o] - lut.CLUT[basePos + lut.go2 + o]); // v101 - v100
                value += wg * (lut.CLUT[basePos + lut.go2 + lut.go1 + lut.go0 + o] - lut.CLUT[basePos + lut.go2 + lut.go0 + o]); // v111 - v101
            } else {
                // wb >= wr >= wg: tetrahedron 3
                value += wb * (lut.CLUT[basePos + lut.go0 + o] - lut.CLUT[basePos + o]); // v001 - v000
                value += wr * (lut.CLUT[basePos + lut.go2 + lut.go0 + o] - lut.CLUT[basePos + lut.go0 + o]); // v101 - v001
                value += wg * (lut.CLUT[basePos + lut.go2 + lut.go1 + lut.go0 + o] - lut.CLUT[basePos + lut.go2 + lut.go0 + o]); // v111 - v101
            }
        } else {
            if (wb >= wg) {
                // wb >= wg >= wr: tetrahedron 4
                value += wb * (lut.CLUT[basePos + lut.go0 + o] - lut.CLUT[basePos + o]); // v001 - v000
                value += wg * (lut.CLUT[basePos + lut.go1 + lut.go0 + o] - lut.CLUT[basePos + lut.go0 + o]); // v011 - v001
                value += wr * (lut.CLUT[basePos + lut.go2 + lut.go1 + lut.go0 + o] - lut.CLUT[basePos + lut.go1 + lut.go0 + o]); // v111 - v011
            } else if (wb >= wr) {
                // wg >= wb >= wr: tetrahedron 5
                value += wg * (lut.CLUT[basePos + lut.go1 + o] - lut.CLUT[basePos + o]); // v010 - v000
                value += wb * (lut.CLUT[basePos + lut.go1 + lut.go0 + o] - lut.CLUT[basePos + lut.go1 + o]); // v011 - v010
                value += wr * (lut.CLUT[basePos + lut.go2 + lut.go1 + lut.go0 + o] - lut.CLUT[basePos + lut.go1 + lut.go0 + o]); // v111 - v011
            } else {
                // wg >= wr >= wb: tetrahedron 6
                value += wg * (lut.CLUT[basePos + lut.go1 + o] - lut.CLUT[basePos + o]); // v010 - v000
                value += wr * (lut.CLUT[basePos + lut.go2 + lut.go1 + o] - lut.CLUT[basePos + lut.go1 + o]); // v110 - v010
                value += wb * (lut.CLUT[basePos + lut.go2 + lut.go1 + lut.go0 + o] - lut.CLUT[basePos + lut.go2 + lut.go1 + o]); // v111 - v110
            }
        }

        result[o] = value * lut.outputScale;
    }

    return result;
}

/**
 * Trilinear interpolation for 4D LUTs
 * @param {LookupTable} lut - The lookup table instance
 * @param {number[]} input - Input color values [c, m, y, k]
 * @returns {number[]} Interpolated output color values
 */
export function trilinearInterp4D(lut, input) {
    // Simplified 4D interpolation - full implementation would be complex
    // This is a placeholder that could be expanded
    throw new Error('Trilinear 4D interpolation not yet implemented');
}

/**
 * Tetrahedral interpolation for 4D LUTs
 * @param {LookupTable} lut - The lookup table instance
 * @param {number[]} input - Input color values [c, m, y, k]
 * @returns {number[]} Interpolated output color values
 */
export function tetrahedralInterp4D(lut, input) {
    // Simplified 4D tetrahedral interpolation
    // This is a placeholder that could be expanded with full 4D tetrahedral logic
    throw new Error('Tetrahedral 4D interpolation not yet implemented');
}

// ============================================================================
// Array Processing Functions
// ============================================================================

/**
 * Process array using 1D linear interpolation
 * @param {number[] | Int8Array | Int16Array | Int32Array | Uint8Array | Uint8ClampedArray | Uint16Array| Uint32Array | Float32Array | Float64Array} inputArray - Input color array
 * @param {number} inputOffset - Starting offset in input array
 * @param {number[] | Int8Array | Int16Array | Int32Array | Uint8Array | Uint8ClampedArray | Uint16Array| Uint32Array | Float32Array | Float64Array} outputArray - Output color array
 * @param {number} outputOffset - Starting offset in output array
 * @param {number} pixelCount - Number of pixels to process
 * @param {LookupTable} lut - Lookup table instance
 * @param {boolean} inputHasAlpha - Whether input has alpha channel
 * @param {boolean} outputHasAlpha - Whether output has alpha channel
 * @param {boolean} preserveAlpha - Whether to preserve alpha values
 * @returns Processed output array
 */
export function linearInterp1DArray_NCh_loop(inputArray, inputOffset, outputArray, outputOffset, pixelCount, lut, inputHasAlpha, outputHasAlpha, preserveAlpha) {
    const inputChannels = lut.inputChannels;
    const outputChannels = lut.outputChannels;
    const inputStep = inputHasAlpha ? inputChannels + 1 : inputChannels;
    const outputStep = outputHasAlpha ? outputChannels + 1 : outputChannels;
    const scale = 1 / 255; // Convert from 8-bit to 0-1 range

    let inPos = inputOffset;
    let outPos = outputOffset;

    for (let i = 0; i < pixelCount; i++) {
        const a = inputArray[inPos] * scale;
        const result = linearInterp1D(lut, [a]);

        for (let o = 0; o < outputChannels; o++) {
            outputArray[outPos + o] = Math.round(result[o] * 255);
        }

        if (outputHasAlpha && inputHasAlpha && preserveAlpha) {
            outputArray[outPos + outputChannels] = inputArray[inPos + inputChannels];
        } else if (outputHasAlpha) {
            outputArray[outPos + outputChannels] = 255;
        }

        inPos += inputStep;
        outPos += outputStep;
    }

    return outputArray;
}

/**
 * Process array using 2D bilinear interpolation
 * @param {number[] | Int8Array | Int16Array | Int32Array | Uint8Array | Uint8ClampedArray | Uint16Array| Uint32Array | Float32Array | Float64Array} inputArray - Input color array
 * @param {number} inputOffset - Starting offset in input array
 * @param {number[] | Int8Array | Int16Array | Int32Array | Uint8Array | Uint8ClampedArray | Uint16Array| Uint32Array | Float32Array | Float64Array} outputArray - Output color array
 * @param {number} outputOffset - Starting offset in output array
 * @param {number} pixelCount - Number of pixels to process
 * @param {LookupTable} lut - Lookup table instance
 * @param {boolean} inputHasAlpha - Whether input has alpha channel
 * @param {boolean} outputHasAlpha - Whether output has alpha channel
 * @param {boolean} preserveAlpha - Whether to preserve alpha values
 * @returns Processed output array
 */
export function bilinearInterp2DArray_NCh_loop(inputArray, inputOffset, outputArray, outputOffset, pixelCount, lut, inputHasAlpha, outputHasAlpha, preserveAlpha) {
    const inputChannels = lut.inputChannels;
    const outputChannels = lut.outputChannels;
    const inputStep = inputHasAlpha ? inputChannels + 1 : inputChannels;
    const outputStep = outputHasAlpha ? outputChannels + 1 : outputChannels;
    const scale = 1 / 255;

    let inPos = inputOffset;
    let outPos = outputOffset;

    for (let i = 0; i < pixelCount; i++) {
        const a = inputArray[inPos] * scale;
        const b = inputArray[inPos + 1] * scale;
        const result = bilinearInterp2D(lut, [a, b]);

        for (let o = 0; o < outputChannels; o++) {
            outputArray[outPos + o] = Math.round(result[o] * 255);
        }

        if (outputHasAlpha && inputHasAlpha && preserveAlpha) {
            outputArray[outPos + outputChannels] = inputArray[inPos + inputChannels];
        } else if (outputHasAlpha) {
            outputArray[outPos + outputChannels] = 255;
        }

        inPos += inputStep;
        outPos += outputStep;
    }

    return outputArray;
}

/**
 * Process array using 3D tetrahedral interpolation
 * @param {number[] | Int8Array | Int16Array | Int32Array | Uint8Array | Uint8ClampedArray | Uint16Array| Uint32Array | Float32Array | Float64Array} inputArray - Input color array
 * @param {number} inputOffset - Starting offset in input array
 * @param {number[] | Int8Array | Int16Array | Int32Array | Uint8Array | Uint8ClampedArray | Uint16Array| Uint32Array | Float32Array | Float64Array} outputArray - Output color array
 * @param {number} outputOffset - Starting offset in output array
 * @param {number} pixelCount - Number of pixels to process
 * @param {LookupTable} lut - Lookup table instance
 * @param {boolean} inputHasAlpha - Whether input has alpha channel
 * @param {boolean} outputHasAlpha - Whether output has alpha channel
 * @param {boolean} preserveAlpha - Whether to preserve alpha values
 * @returns Processed output array
 */
export function tetrahedralInterp3DArray_NCh_loop(inputArray, inputOffset, outputArray, outputOffset, pixelCount, lut, inputHasAlpha, outputHasAlpha, preserveAlpha) {
    const inputChannels = lut.inputChannels;
    const outputChannels = lut.outputChannels;
    const inputStep = inputHasAlpha ? inputChannels + 1 : inputChannels;
    const outputStep = outputHasAlpha ? outputChannels + 1 : outputChannels;
    const scale = 1 / 255;

    let inPos = inputOffset;
    let outPos = outputOffset;

    for (let i = 0; i < pixelCount; i++) {
        const r = inputArray[inPos] * scale;
        const g = inputArray[inPos + 1] * scale;
        const b = inputArray[inPos + 2] * scale;
        const result = tetrahedralInterp3D(lut, [r, g, b]);

        for (let o = 0; o < outputChannels; o++) {
            outputArray[outPos + o] = Math.round(result[o] * 255);
        }

        if (outputHasAlpha && inputHasAlpha && preserveAlpha) {
            outputArray[outPos + outputChannels] = inputArray[inPos + inputChannels];
        } else if (outputHasAlpha) {
            outputArray[outPos + outputChannels] = 255;
        }

        inPos += inputStep;
        outPos += outputStep;
    }

    return outputArray;
}

/**
 * Process array using 4D tetrahedral interpolation with CMYK-specific processing
 * @param {number[] | Int8Array | Int16Array | Int32Array | Uint8Array | Uint8ClampedArray | Uint16Array| Uint32Array | Float32Array | Float64Array} inputArray - Input color array
 * @param {number} inputOffset - Starting offset in input array
 * @param {number[] | Int8Array | Int16Array | Int32Array | Uint8Array | Uint8ClampedArray | Uint16Array| Uint32Array | Float32Array | Float64Array} outputArray - Output color array
 * @param {number} outputOffset - Starting offset in output array
 * @param {number} pixelCount - Number of pixels to process
 * @param {LookupTable} lut - Lookup table instance
 * @param {boolean} inputHasAlpha - Whether input has alpha channel
 * @param {boolean} outputHasAlpha - Whether output has alpha channel
 * @param {boolean} preserveAlpha - Whether to preserve alpha values
 * @returns Processed output array
 */
export function tetrahedralInterp4DArray_NCh_loop(inputArray, inputOffset, outputArray, outputOffset, pixelCount, lut, inputHasAlpha, outputHasAlpha, preserveAlpha) {
    const inputChannels = lut.inputChannels;
    const outputChannels = lut.outputChannels;
    const inputStep = inputHasAlpha ? inputChannels + 1 : inputChannels;
    const outputStep = outputHasAlpha ? outputChannels + 1 : outputChannels;
    const scale = 1 / 255;

    let inPos = inputOffset;
    let outPos = outputOffset;

    for (let i = 0; i < pixelCount; i++) {
        const c = inputArray[inPos] * scale;
        const m = inputArray[inPos + 1] * scale;
        const y = inputArray[inPos + 2] * scale;
        const k = inputArray[inPos + 3] * scale;

        // For now, use simplified 4D interpolation
        // In a full implementation, this would use proper 4D tetrahedral interpolation
        let result = [c, m, y, k]; // Placeholder

        // Apply CMYK processing options
        if (lut.promoteGrayToCMYKBlack) {
            result = applyPromoteGrayToCMYKBlack(result, [c, m, y, k]);
        }

        for (let o = 0; o < outputChannels; o++) {
            outputArray[outPos + o] = Math.round(result[o] * 255);
        }

        if (outputHasAlpha && inputHasAlpha && preserveAlpha) {
            outputArray[outPos + outputChannels] = inputArray[inPos + inputChannels];
        } else if (outputHasAlpha) {
            outputArray[outPos + outputChannels] = 255;
        }

        inPos += inputStep;
        outPos += outputStep;
    }

    return outputArray;
}

/**
 * Specialized 3D array processing for 4-channel output with 8-bit precision
 * @template {Uint8Array} [T=Uint8Array]
 * @param {LookupTable} lut - Lookup table instance
 * @param {T} inputArray - Input color array
 * @param {number} inputOffset - Starting offset in input array
 * @param {T} outputArray - Output color array
 * @param {number} outputOffset - Starting offset in output array
 * @param {number} pixelCount - Number of pixels to process
 * @param {boolean} inputHasAlpha - Whether input has alpha channel
 * @param {boolean} outputHasAlpha - Whether output has alpha channel
 * @param {boolean} preserveAlpha - Whether to preserve alpha values
 * @returns {T} Processed output array
 */
export function tetrahedralInterp3DArray_4Ch_loop_8bit(lut, inputArray, inputOffset, outputArray, outputOffset, pixelCount, inputHasAlpha, outputHasAlpha, preserveAlpha) {
    return /** @type {T} */(
        tetrahedralInterp3DArray_NCh_loop(inputArray, inputOffset, outputArray, outputOffset, pixelCount, lut, inputHasAlpha, outputHasAlpha, preserveAlpha)
    );
}

/**
 * Specialized 3D array processing for 4-channel output with 16-bit precision
 * @param {LookupTable} lut - Lookup table instance
 * @param {Uint16Array} inputArray - Input color array
 * @param {number} inputOffset - Starting offset in input array
 * @param {Uint16Array} outputArray - Output color array
 * @param {number} outputOffset - Starting offset in output array
 * @param {number} pixelCount - Number of pixels to process
 * @param {boolean} inputHasAlpha - Whether input has alpha channel
 * @param {boolean} outputHasAlpha - Whether output has alpha channel
 * @param {boolean} preserveAlpha - Whether to preserve alpha values
 * @returns {Uint16Array} Processed output array
 */
export function tetrahedralInterp3DArray_4Ch_loop_16bit(lut, inputArray, inputOffset, outputArray, outputOffset, pixelCount, inputHasAlpha, outputHasAlpha, preserveAlpha) {
    const inputChannels = lut.inputChannels;
    const outputChannels = lut.outputChannels;
    const inputStep = inputHasAlpha ? inputChannels + 1 : inputChannels;
    const outputStep = outputHasAlpha ? outputChannels + 1 : outputChannels;
    const scale = 1 / 65535; // Convert from 16-bit to 0-1 range

    let inPos = inputOffset;
    let outPos = outputOffset;

    for (let i = 0; i < pixelCount; i++) {
        const r = inputArray[inPos] * scale;
        const g = inputArray[inPos + 1] * scale;
        const b = inputArray[inPos + 2] * scale;
        const result = tetrahedralInterp3D(lut, [r, g, b]);

        for (let o = 0; o < outputChannels; o++) {
            outputArray[outPos + o] = Math.round(result[o] * 65535);
        }

        if (outputHasAlpha && inputHasAlpha && preserveAlpha) {
            outputArray[outPos + outputChannels] = inputArray[inPos + inputChannels];
        } else if (outputHasAlpha) {
            outputArray[outPos + outputChannels] = 65535;
        }

        inPos += inputStep;
        outPos += outputStep;
    }

    return outputArray;
}
