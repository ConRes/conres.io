/**
 * @fileoverview Legacy LUT functions extracted from Transform class
 * These functions maintain the original Transform class behavior for backward compatibility
 */

// @ts-check

import { uint16ArrayToBase64, uint8ArrayToBase64, base64ToUint16Array, base64ToUint8Array, eIntent } from '../def.js';
import {Profile} from '../profile.js';

/**
 * Legacy implementation of getLut method
 * @param {import('../transform.js').Transform} transform - Transform instance
 * @param {number} [precision] - Number of decimal places to round LUT values to
 * @returns Legacy LUT object
 */
export function getLut_legacy(transform, precision) {
    if (!transform.lut || !transform.lut.CLUT) throw new TypeError('Invalid LUT: Missing CLUT');

    /** @type {import('../decode.js').LUT['CLUT']} */
    var CLUT;
    if (!precision && precision !== 0) {
        CLUT = transform.lut.CLUT;
    } else {
        // round, which will make output smaller when saved to JSON
        var p = Math.pow(10, precision);
        CLUT = transform.lut.CLUT.map(function (value) {
            return Math.round(value * p) / p;
        });
    }

    var newLUT = cloneLut_legacy(transform, CLUT);
    newLUT.precision = null;
    newLUT.inputScale = 1;
    newLUT.outputScale = 1;
    return newLUT;
}

/**
 * Legacy implementation of getLut16 method
 * @param {import('../transform.js').Transform} transform - Transform instance
 * @returns Legacy 16-bit LUT object
 */
export function getLut16_legacy(transform) {
    if (!transform.lut || !transform.lut.CLUT) throw new TypeError('Invalid LUT: Missing CLUT');

    // Convert to 16bit
    /** @type {Uint16Array} */
    var CLUT16 = new Uint16Array(transform.lut.CLUT.length);
    for (var i = 0; i < transform.lut.CLUT.length; i++) {
        CLUT16[i] = transform.lut.CLUT[i] * 65535;
    }

    var newLUT = cloneLut_legacy(transform, uint16ArrayToBase64(CLUT16), 'base64');

    // Set the precision to 16bit
    newLUT.precision = 16;
    newLUT.inputScale = 1;
    newLUT.outputScale = 1 / 65535;
    return newLUT;
}

/**
 * Legacy implementation of getLut8 method
 * @param {import('../transform.js').Transform} transform - Transform instance
 * @returns Legacy 8-bit LUT object
 */
export function getLut8_legacy(transform) {
    if (!transform.lut || !transform.lut.CLUT) throw new TypeError('Invalid LUT: Missing CLUT');

    // Convert to 8bit
    var CLUT8 = new Uint8Array(transform.lut.CLUT.length);
    for (var i = 0; i < transform.lut.CLUT.length; i++) {
        CLUT8[i] = Math.round(transform.lut.CLUT[i] * 255);
    }

    var newLUT = cloneLut_legacy(transform, uint8ArrayToBase64(CLUT8), 'base64');

    // Set the precision to 8bit
    newLUT.precision = 8;
    newLUT.inputScale = 1;
    newLUT.outputScale = 1 / 255; // Account for precision
    return newLUT;
}

/**
 * Legacy implementation of setLut method
 * @param {import('../transform.js').Transform} transform - Transform instance
 * @param {Object} lut - LUT object to set
 */
export function setLut_legacy(transform, lut) {
    transform.lut = lut;

    if (lut.chain.length < 3) {
        throw 'Invalid LUT - chain is too short';
    }

    // if (!lut.chain[0].hasOwnProperty('profile')) {
    if (
        !(lut.chain[0] instanceof Profile)
        && !(
            ['GRAY', '2CLR', '3CLR', 'CMY', 'RGB', '4CLR', 'CMYK'].includes(lut.chain[0]?.header?.colorSpace)
        )
    ) {
        console.log(lut.chain[0]);
        throw 'Invalid LUT - First link is not a profile';
    }

    // if (!lut.chain[lut.chain.length - 2].hasOwnProperty('intent')) {
    if (!Object.values(eIntent).includes(lut.chain[lut.chain.length - 2])) {
        throw 'Invalid LUT - Intent is missing';
    }

    // if (!lut.chain[lut.chain.length - 1].hasOwnProperty('profile')) {
    if (!(lut.chain[lut.chain.length - 1] instanceof Profile)) {
        throw 'Invalid LUT - Last link is not a profile';
    }

    var inputProfile = lut.chain[0];

    // Intent is the second to last one used on output profile
    var intent = lut.chain[lut.chain.length - 2].intent;

    var outputProfile = lut.chain[lut.chain.length - 1];

    transform.chain = lut.chain;

    // Decode if as b64
    if (lut.encoding === 'base64') {
        if (lut.precision === 16) {
            lut.CLUT = base64ToUint16Array(lut.CLUT);
        } else {
            lut.CLUT = base64ToUint8Array(lut.CLUT);
        }
        lut.encoding = 'number';
    }

    transform.create(inputProfile, outputProfile, intent);
}

/**
 * Legacy implementation of cloneLut method
 * @param {import('../transform.js').Transform} transform - Transform instance
 * @param {import('../decode.js').LUT['CLUT'] | string} CLUT - CLUT data
 * @param {string} [encoding] - Encoding type
 * @returns Cloned LUT object
 */
export function cloneLut_legacy(transform, CLUT, encoding) {
    // Copy LUT without CLUT
    return /** @type {import('../decode.js').LUT} */ (JSON.parse(JSON.stringify(transform.lut, function (key, value) {
        if (key === 'CLUT') {
            return CLUT;
        }
        if (key === 'encoding' && encoding !== undefined) {
            return encoding;
        }
        return value;
    })));
}

/**
 * Legacy implementation of create1DDeviceLUT method
 * @param {import('../transform.js').Transform} transform - Transform instance
 * @param {number} outputChannels - Number of output channels
 * @param {number} gridPoints - Number of grid points
 * @returns {Float64Array} 1D device LUT
 */
export function create1DDeviceLUT_legacy(transform, outputChannels, gridPoints) {
    const CLUT = new Float64Array(Number(transform.outputProfile?.outputChannels) * gridPoints);
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
 * Legacy implementation of create2DDeviceLUT method
 * @param {import('../transform.js').Transform} transform - Transform instance
 * @param {number} outputChannels - Number of output channels
 * @param {number} gridPoints - Number of grid points
 * @returns {Float64Array} 2D device LUT
 */
export function create2DDeviceLUT_legacy(transform, outputChannels, gridPoints) {
    const lutsize = gridPoints * gridPoints;
    const CLUT = new Float64Array(Number(transform.outputProfile?.outputChannels) * lutsize);
    const step = 1 / (gridPoints - 1);
    let position = 0;
    let count = 0;

    for (let a = 0; a < gridPoints; a++) {
        const av = a * step;
        for (let b = 0; b < gridPoints; b++) {
            var device = transform.forward([av, b * step]);
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
 * Legacy implementation of create3DDeviceLUT method
 * @param {import('../transform.js').Transform} transform - Transform instance
 * @param {number} outputChannels - Number of output channels
 * @param {number} gridPoints - Number of grid points
 * @returns {Float64Array} 3D device LUT
 */
export function create3DDeviceLUT_legacy(transform, outputChannels, gridPoints) {
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
                var device = transform.forward([rv, gv, b * step]);
                for (let o = 0; o < outputChannels; o++) {
                    CLUT[position++] = device[o];
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
 * Legacy implementation of create4DDeviceLUT method
 * @param {import('../transform.js').Transform} transform - Transform instance
 * @param {number} outputChannels - Number of output channels
 * @param {number} gridPoints - Number of grid points
 * @returns {Float64Array} 4D device LUT
 */
export function create4DDeviceLUT_legacy(transform, outputChannels, gridPoints) {
    const lutsize = gridPoints * gridPoints * gridPoints * gridPoints;
    const CLUT = new Float64Array(Number(transform.outputProfile?.outputChannels) * lutsize);
    const step = 1 / (gridPoints - 1);
    const pipeline = transform.pipeline;
    const pipelineLength = pipeline.length;

    let position = 0;
    let count = 0;
    let result = [0, 0, 0, 0];

    for (let c = 0; c < gridPoints; c++) {
        const cv = c * step;
        for (let m = 0; m < gridPoints; m++) {
            const mv = m * step;
            for (let y = 0; y < gridPoints; y++) {
                const yv = y * step;

                for (let k = 0; k < gridPoints; k++) {
                    const kv = k * step;
                    result = [cv, mv, yv, kv];

                    for (let s = 0; s < pipelineLength; s++) {
                        result = pipeline[s].funct.call(transform, result, pipeline[s].stageData, pipeline[s]);
                    }

                    for (let o = 0; o < outputChannels; o++) {
                        CLUT[position++] = result[o];
                    }
                    count++;
                }
            }
        }
    }

    if (transform.verbose) {
        console.log('4D LUT size: %d points @ %d × %d × %d × %d', count, gridPoints, gridPoints, gridPoints, gridPoints);
    }

    return CLUT;
}

/**
 * Legacy implementation of transformArrayViaLUT method
 * @param {import('../transform.js').Transform} transform - Transform instance
 * @param {number[] | Int8Array | Int16Array | Int32Array | Uint8Array | Uint8ClampedArray | Uint16Array| Uint32Array | Float32Array | Float64Array} inputArray - Input array
 * @param {boolean} [inputHasAlpha=false] - Whether input has alpha
 * @param {boolean} [outputHasAlpha=false] - Whether output has alpha
 * @param {boolean} [preserveAlpha] - Whether to preserve alpha
 * @param {number} [pixelCount] - Number of pixels
 */
export function transformArrayViaLUT_legacy(transform, inputArray, inputHasAlpha = false, outputHasAlpha = false, preserveAlpha = outputHasAlpha && inputHasAlpha, pixelCount) {
    var lut = transform.lut;
    if (!lut) {
        throw 'No LUT loaded';
    }

    if (preserveAlpha === undefined) {
        preserveAlpha = outputHasAlpha && inputHasAlpha;
    }

    var inputBytesPerPixel = (inputHasAlpha) ? lut.inputChannels + 1 : lut.inputChannels;
    var outputBytesPerPixel = (outputHasAlpha) ? lut.outputChannels + 1 : lut.outputChannels;

    if (pixelCount === undefined) {
        pixelCount = Math.floor(inputArray.length / inputBytesPerPixel);
    }

    var outputArray = lut.outputScale === 255 ? new Uint8ClampedArray(pixelCount * outputBytesPerPixel) : new Uint16Array(pixelCount * outputBytesPerPixel);
    var inputChannels = lut.inputChannels;
    var outputChannels = lut.outputChannels;

    switch (inputChannels) {
        case 1: // Gray / mono
            linearInterp1DArray_NCh_loop_legacy(transform, inputArray, 0, outputArray, 0, pixelCount, lut, inputHasAlpha, outputHasAlpha, preserveAlpha);
            break;

        case 2: // Duo tones
            bilinearInterp2DArray_NCh_loop_legacy(transform, inputArray, 0, outputArray, 0, pixelCount, lut, inputHasAlpha, outputHasAlpha, preserveAlpha);
            break;

        case 3: // RGB or Lab
            switch (outputChannels) {
                case 3:
                case 4:
                default:
                    tetrahedralInterp3DArray_NCh_loop_legacy(transform, inputArray, 0, outputArray, 0, pixelCount, lut, inputHasAlpha, outputHasAlpha, preserveAlpha);
                    break;
            }
            break;

        case 4: // CMYK
            switch (outputChannels) {
                case 3:
                case 4:
                default:
                    tetrahedralInterp4DArray_NCh_loop_legacy(transform, inputArray, 0, outputArray, 0, pixelCount, lut, inputHasAlpha, outputHasAlpha, preserveAlpha);
                    break;
            }
            break;

        default:
            throw 'Invalid inputChannels ' + inputChannels;
    }

    return outputArray;
}

/**
 * Legacy 1D linear interpolation array processing
 * @param {import('../transform.js').Transform} transform - Transform instance
 * @param {number[] | Int8Array | Int16Array | Int32Array | Uint8Array | Uint8ClampedArray | Uint16Array| Uint32Array | Float32Array | Float64Array} inputArray - Input array
 * @param {number} inputOffset - Input offset
 * @param {number[] | Int8Array | Int16Array | Int32Array | Uint8Array | Uint8ClampedArray | Uint16Array| Uint32Array | Float32Array | Float64Array} outputArray - Output array
 * @param {number} outputOffset - Output offset
 * @param {number} pixelCount - Pixel count
 * @param {Object} lut - LUT object
 * @param {boolean} inputHasAlpha - Input has alpha
 * @param {boolean} outputHasAlpha - Output has alpha
 * @param {boolean} preserveAlpha - Preserve alpha
 * @returns  Output array
 */
export function linearInterp1DArray_NCh_loop_legacy(transform, inputArray, inputOffset, outputArray, outputOffset, pixelCount, lut, inputHasAlpha, outputHasAlpha, preserveAlpha) {
    var temp, o;
    var outputChannels = lut.outputChannels;
    for (var p = 0; p < pixelCount; p++) {
        temp = transform.linearInterp1D_NCh([inputArray[inputOffset++]], lut);
        for (let o = 0; o < outputChannels; o++) {
            outputArray[outputOffset++] = temp[o];
        }
        if (preserveAlpha) {
            outputArray[outputOffset++] = inputArray[inputOffset++];
        } else {
            if (inputHasAlpha) { inputOffset++; }
            if (outputHasAlpha) {
                outputArray[outputOffset++] = 255;
            }
        }
    }
    return outputArray;
}

/**
 * Legacy 2D bilinear interpolation array processing
 * @param {import('../transform.js').Transform} transform - Transform instance
 * @param {number[] | Int8Array | Int16Array | Int32Array | Uint8Array | Uint8ClampedArray | Uint16Array| Uint32Array | Float32Array | Float64Array} inputArray - Input array
 * @param {number} inputOffset - Input offset
 * @param {number[] | Int8Array | Int16Array | Int32Array | Uint8Array | Uint8ClampedArray | Uint16Array| Uint32Array | Float32Array | Float64Array} outputArray - Output array
 * @param {number} outputOffset - Output offset
 * @param {number} pixelCount - Pixel count
 * @param {Object} lut - LUT object
 * @param {boolean} inputHasAlpha - Input has alpha
 * @param {boolean} outputHasAlpha - Output has alpha
 * @param {boolean} preserveAlpha - Preserve alpha
 * @returns  Output array
 */
export function bilinearInterp2DArray_NCh_loop_legacy(transform, inputArray, inputOffset, outputArray, outputOffset, pixelCount, lut, inputHasAlpha, outputHasAlpha, preserveAlpha) {
    var colorIn, temp, o;
    var outputChannels = lut.outputChannels;
    colorIn = new Uint8ClampedArray(2);
    for (var p = 0; p < pixelCount; p++) {
        colorIn[0] = inputArray[inputOffset++];
        colorIn[1] = inputArray[inputOffset++];
        temp = transform.bilinearInterp2D_NCh(colorIn, lut);
        for (let o = 0; o < outputChannels; o++) {
            outputArray[outputOffset++] = temp[o];
        }
        if (preserveAlpha) {
            outputArray[outputOffset++] = inputArray[inputOffset++];
        } else {
            if (inputHasAlpha) { inputOffset++; }
            if (outputHasAlpha) {
                outputArray[outputOffset++] = 255;
            }
        }
    }
    return outputArray;
}

/**
 * Legacy 3D tetrahedral interpolation array processing
 * @param {import('../transform.js').Transform} transform - Transform instance
 * @param {number[] | Int8Array | Int16Array | Int32Array | Uint8Array | Uint8ClampedArray | Uint16Array| Uint32Array | Float32Array | Float64Array} inputArray - Input array
 * @param {number} inputOffset - Input offset
 * @param {number[] | Int8Array | Int16Array | Int32Array | Uint8Array | Uint8ClampedArray | Uint16Array| Uint32Array | Float32Array | Float64Array} outputArray - Output array
 * @param {number} outputOffset - Output offset
 * @param {number} pixelCount - Pixel count
 * @param {Object} lut - LUT object
 * @param {boolean} inputHasAlpha - Input has alpha
 * @param {boolean} outputHasAlpha - Output has alpha
 * @param {boolean} preserveAlpha - Preserve alpha
 * @returns  Output array
 */
export function tetrahedralInterp3DArray_NCh_loop_legacy(transform, inputArray, inputOffset, outputArray, outputOffset, pixelCount, lut, inputHasAlpha, outputHasAlpha, preserveAlpha) {
    var colorIn, temp, o;
    var outputChannels = lut.outputChannels;
    colorIn = new Array(3);  // Use regular array for normalized values
    for (var p = 0; p < pixelCount; p++) {
        // Normalize RGB values from 0-255 to 0-1 range
        colorIn[0] = inputArray[inputOffset++] / 255;
        colorIn[1] = inputArray[inputOffset++] / 255;
        colorIn[2] = inputArray[inputOffset++] / 255;
        temp = transform.tetrahedralInterp3D_NCh(colorIn, lut);
        for (let o = 0; o < outputChannels; o++) {
            // tetrahedralInterp3D_NCh returns values already scaled by outputScale
            // For int8 output, we need to clamp to 0-255 range
            outputArray[outputOffset++] = Math.round(Math.max(0, Math.min(255, temp[o])));
        }
        if (preserveAlpha) {
            outputArray[outputOffset++] = inputArray[inputOffset++];
        } else {
            if (inputHasAlpha) { inputOffset++; }
            if (outputHasAlpha) {
                outputArray[outputOffset++] = 255;
            }
        }
    }
    return outputArray;
}

/**
 * Legacy 4D tetrahedral interpolation array processing
 * @param {import('../transform.js').Transform} transform - Transform instance
 * @param {number[] | Int8Array | Int16Array | Int32Array | Uint8Array | Uint8ClampedArray | Uint16Array| Uint32Array | Float32Array | Float64Array} inputArray - Input array
 * @param {number} inputOffset - Input offset
 * @param {number[] | Int8Array | Int16Array | Int32Array | Uint8Array | Uint8ClampedArray | Uint16Array| Uint32Array | Float32Array | Float64Array} outputArray - Output array
 * @param {number} outputOffset - Output offset
 * @param {number} pixelCount - Pixel count
 * @param {Object} lut - LUT object
 * @param {boolean} inputHasAlpha - Input has alpha
 * @param {boolean} outputHasAlpha - Output has alpha
 * @param {boolean} preserveAlpha - Preserve alpha
 * @returns  Output array
 */
export function tetrahedralInterp4DArray_NCh_loop_legacy(transform, inputArray, inputOffset, outputArray, outputOffset, pixelCount, lut, inputHasAlpha, outputHasAlpha, preserveAlpha) {
    var colorIn, temp, o;
    var outputChannels = lut.outputChannels;
    colorIn = new Uint8ClampedArray(4);
    for (var p = 0; p < pixelCount; p++) {
        colorIn[0] = inputArray[inputOffset++];
        colorIn[1] = inputArray[inputOffset++];
        colorIn[2] = inputArray[inputOffset++];
        colorIn[3] = inputArray[inputOffset++];
        temp = transform.tetrahedralInterp4D_NCh(colorIn, lut);
        for (let o = 0; o < outputChannels; o++) {
            outputArray[outputOffset++] = temp[o];
        }
        if (preserveAlpha) {
            outputArray[outputOffset++] = inputArray[inputOffset++];
        } else {
            if (inputHasAlpha) { inputOffset++; }
            if (outputHasAlpha) {
                outputArray[outputOffset++] = 255;
            }
        }
    }
    return outputArray;
}
