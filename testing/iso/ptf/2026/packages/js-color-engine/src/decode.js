/**
 * @fileoverview ICC profile decoding utilities
 * Handles parsing and interpretation of ICC profile binary data structures
 * 
 * @license GPL-3.0-or-later
 * @copyright 2019, 2024 Glenn Wilton, O2 Creative Limited
 */

import { eColourType } from './def.js';

// @ts-check

/**
 * @typedef {object} LUT
 * @property {number} [version]
 * @property {string} [type]
 * @property {'number'|'base64'} [encoding]
 * @property {number?} [precision]
 * @property {number} inputScale
 * @property {number} outputScale
 * @property {number} inputChannels
 * @property {number} outputChannels
 * @property {number} [inputTableEntries]
 * @property {number} [outputTableEntries]
 * @property {number[]} [gridPoints]
 * @property {ReturnType<matrixV4 | matrixV2> | false} [matrix]
 * @property {CurveV2} [inputCurve]
 * @property {CurveV2} [outputCurve]
 * @property {Float64Array | Uint16Array | Uint8Array | false} [CLUT]
 * @property {ReturnType<curves> | false} [aCurves]
 * @property {ReturnType<curves> | false} [bCurves]
 * @property {ReturnType<curves> | false} [mCurves]
 * @property {{sig: 'cvst' | 'matf' | 'clut'}[]} [elements]
 * @property {(import('./profile.js').Profile|import('./transform.js').ProfileObject|import('./def.js').eIntent)[]} [chain]
 * @property {number} g1
 * @property {number} g2
 * @property {number} g3
 * @property {number} [g4]
 * @property {number} go0
 * @property {number} go1
 * @property {number} go2
 * @property {number} [go3]
 */

/**
 * @typedef {object} CurveV2
 * @property {number} channels
 * @property {number} entries
 * @property {Uint8Array | Uint16Array} table
 * @property {Float64Array} tablef
 * @property {number} outputScale
 */

/**
 * @typedef {ReturnType<curve>} CurveV4
 */

/**
 * Reads XYZ number from ICC profile data (12 bytes)
 * @param {Uint8Array} binary - Binary data array
 * @param {number} offset - Byte offset to start reading from
 * @returns {import('./def.js')._cmsXYZ} XYZ object with X, Y, Z properties as floating-point values
 */
export function XYZNumber(binary, offset) {
    var x = s15Fixed16Number(uint32(binary, offset));
    var y = s15Fixed16Number(uint32(binary, offset + 4));
    var z = s15Fixed16Number(uint32(binary, offset + 8));
    return { X: x, Y: y, Z: z, type: eColourType.XYZ };
}

/**
 * Reads ASCII characters from binary data
 * @param {Uint8Array} binary - Binary data array
 * @param {number} offset - Byte offset to start reading from
 * @param {number} length - Number of characters to read
 * @returns {string} Decoded ASCII string
 */
export function chars(binary, offset, length) {
    var str = '';
    for (var i = 0; i < length; i++) {
        str += String.fromCharCode(binary[offset]);
        offset++;
    }
    return str;
}

/**
 * Reads Unicode characters from binary data (16-bit per character)
 * @param {Uint8Array} binary - Binary data array
 * @param {number} offset - Byte offset to start reading from
 * @param {number} length - Number of characters to read
 * @returns {string} Decoded Unicode string
 */
export function unicodeChars(binary, offset, length) {
    var str = '';
    for (var i = 0; i < length; i++) {
        str += String.fromCharCode((binary[offset] << 8) + binary[offset + 1]);
        offset += 2;
    }
    return str;
}

/**
 * Reads an array of bytes from binary data
 * @param {Uint8Array} binary - Binary data array
 * @param {number} offset - Byte offset to start reading from
 * @param {number} length - Number of bytes to read
 * @returns {Array<number>} Array of byte values
 */
export function array(binary, offset, length) {
    var arr = [];
    for (var i = 0; i < length; i++) {
        arr.push(binary[offset]);
        offset++;
    }
    return arr;
}

/**
 * Creates a Uint8Array from a slice of binary data
 * @param {Uint8Array} binary - Binary data array
 * @param {number} offset - Byte offset to start reading from
 * @param {number} length - Number of bytes to read
 * @returns {Uint8Array} New Uint8Array containing the sliced data
 */
export function uInt8Array(binary, offset, length) {
    return new Uint8Array(binary.buffer.slice(offset, offset + length));
}

/**
 * Creates a Uint16Array from binary data, handling endianness conversion
 * @param {Uint8Array} binary - Binary data array
 * @param {number} offset - Byte offset to start reading from
 * @param {number} length - Number of 16-bit values to read
 * @returns {Uint16Array} New Uint16Array with proper endianness
 */
export function uInt16Array(binary, offset, length) {
    // Double the length to get the number of bytes
    var bytes = length * 2;

    var u8TempArray = new Uint8Array(binary.buffer.slice(offset, offset + bytes));

    // the data is in littleEndian format so we need to invert the data - Quick and easier than using DataView???
    for (var i = 0; i < bytes; i += 2) {
        var v = u8TempArray[i];
        u8TempArray[i] = u8TempArray[i + 1];
        u8TempArray[i + 1] = v;
    }
    return new Uint16Array(u8TempArray.buffer);
}

/**
 * Reads a 32-bit unsigned integer from binary data (big-endian)
 * @param {Uint8Array} binary - Binary data array
 * @param {number} offset - Byte offset to start reading from
 * @returns {number} 32-bit unsigned integer value
 */
export function uint32(binary, offset) {
    return binary[offset + 3] + (binary[offset + 2] << 8) + (binary[offset + 1] << 16) + (binary[offset] << 24);
}

/**
 * Reads a 16-bit unsigned integer from binary data (big-endian)
 * @param {Uint8Array} binary - Binary data array
 * @param {number} offset - Byte offset to start reading from
 * @returns {number} 16-bit unsigned integer value
 */
export function uint16(binary, offset) {
    return (binary[offset + 1]) + (binary[offset] << 8);
}

/**
 * Reads an 8.8 fixed-point number (1 byte integer + 1 byte fraction)
 * @param {Uint8Array} binary - Binary data array
 * @param {number} pos - Byte position to start reading from
 * @returns {number} Floating-point value
 */
export function u8Fixed8Number(binary, pos) {
    return binary[pos] + (binary[pos + 1] / 256);
}

/**
 * Converts a 32-bit value to s15Fixed16Number format (signed 15.16 fixed-point)
 * @param {number} n - 32-bit integer value
 * @returns {number} Floating-point value in range approximately -32768 to +32767
 */
export function s15Fixed16Number(n) {
    if (n > 0x80000000) {
        return (0x100000000 - n) / -0x10000;
    }
    return n / 0x10000;
}

/**
 * Reads a 32-bit floating-point number from binary data
 * @param {Uint8Array} binary - Binary data array
 * @param {number} offset - Byte offset to start reading from
 * @returns {number} 32-bit floating-point value
 */
export function float32(binary, offset) {
    return new DataView(binary.buffer).getFloat32(offset);
}

/**
 * Reads a 64-bit floating-point number from binary data
 * @param {Uint8Array} binary - Binary data array
 * @param {number} offset - Byte offset to start reading from
 * @returns {number} 64-bit floating-point value
 */
export function float64(binary, offset) {
    return new DataView(binary.buffer).getFloat64(offset);
}

export function s15Array(binary, offset, tagLength) {
    // This type represents an array of generic 4-byte (32-bit) fixed point quantity
    // The number of values is determined from the size of the tag.
    var values = [];
    for (var p = 8; p < tagLength; p += 4) {
        values.push(s15Fixed16Number(uint32(binary, offset + p)));
    }
    return {
        sig: chars(binary, offset, 4), // sf32
        values: values
    };
}

export function XYZType(binary, offset) {
    //var sig = chars(binary, offset, 4);
    return XYZNumber(binary, offset + 8);
}

export function text(binary, offset) {
    var textType = chars(binary, offset, 4);
    switch (textType) {
        case 'desc':
            return _textDescriptionType(binary, offset);
        case 'text':
            return _textType(binary, offset);
        case 'mluc':
            return _multiLocalizedUnicodeText(binary, offset);
        default:
            console.log('Unknown Text Type ' + textType);
            return {
                sig: textType,
                text: '<Unknown Text Type>'
            };
    }
}

export function _multiLocalizedUnicodeText(binary, offset) {
    var recordCount = uint32(binary, offset + 8);
    var recordSize = uint32(binary, offset + 12);
    var languages = [];
    var ptr = offset + 16;
    var textEn = '';
    for (var i = 0; i < recordCount; i++) {
        var languageCode = chars(binary, ptr, 2);
        var strLength = uint32(binary, ptr + 4) / 2;
        var strOffset = uint32(binary, ptr + 8);
        var text = unicodeChars(binary, offset + strOffset, strLength);

        // choose the first english text
        if (languageCode === 'en' && textEn === '') {
            textEn = text;
        }

        languages.push({
            languageCode: languageCode,  //language code specified in ISO 639-1
            countryCode: chars(binary, ptr + 2, 2),  //country code specified in ISO 3166-1
            text: text
        });

        ptr += recordSize;
    }

    if (textEn === '') {
        // No english, so just the first entry
        textEn = languages[0].text;
    }

    return {
        sig: chars(binary, offset, 4),
        text: textEn,
        languages: languages
    };

}

export function _textType(binary, offset) {
    return {
        sig: chars(binary, offset, 4),
        text: nts(binary, offset + 8)
    };
}

export function _textDescriptionType(binary, offset) {
    var AsciiLength = uint32(binary, offset + 8);
    return {
        sig: chars(binary, offset, 4),
        text: nts(binary, offset + 12),
        length: AsciiLength
    };
}

export function nts(binary, offset, maxLen) {
    maxLen = maxLen || 1024;
    var str = '';
    for (var i = 0; i < maxLen; i++) {
        if (binary[offset] === 0) {
            return str;
        }
        str += String.fromCharCode(binary[offset]);
        offset++;
    }
    return str;
}

export function matrixV2(binary, offset) {
    var matrix = [];
    for (var i = 0; i < 9; i++) {
        matrix[i] = s15Fixed16Number(uint32(binary, offset));
        offset += 4;
    }
    return matrix;
}

export function matrixV4(binary, offset) {
    var matrix = [];
    for (var i = 0; i < 12; i++) {
        matrix[i] = s15Fixed16Number(uint32(binary, offset));
        offset += 4;
    }
    return matrix;
}

export function viewingConditions(binary, offset) {
    return {
        sig: chars(binary, offset, 4),
        illuminant: XYZNumber(binary, offset + 8),
        surround: XYZNumber(binary, offset + 20),
        measurement: illuminant2Text(uint32(binary, offset + 32))
    };
}

export function measurement(binary, offset) {
    return {
        sig: chars(binary, offset, 4),
        observer: observer2Text(uint32(binary, offset + 8)),
        tristimulus: XYZNumber(binary, offset + 12),
        geometry: geometry2Text(uint32(binary, offset + 24)),
        flare: flare2Text(uint32(binary, offset + 28)),
        illuminant: illuminant2Text(uint32(binary, offset + 32))
    };
}

export function observer2Text(obs) {
    switch (obs) {
        case 1:
            return 'CIE 1931 standard colorimetric observer';
        case 2:
            return 'CIE 1964 standard colorimetric observer';
        default:
            return 'Unknown';
    }
}

export function geometry2Text(geo) {
    switch (geo) {
        case 1:
            return '0°:45° or 45°:0°';
        case 2:
            return '0°:d or d:0°';
        default:
            return 'Unknown';
    }
}

export function flare2Text(flare) {
    return (flare === 0) ? '0 (0 %)' : '1,0 (or 100 %)';
}

export function illuminant2Text(ill) {
    var illText = ['Unknown', 'D50', 'D65', 'D93', 'F2', 'D55', 'A', 'Equi-Power (E)', 'F8'];
    return illText[ill];
}

export function curves(binary, offset, count, useInverseFn) {
    var curves = [];
    var curveOffset = offset;

    for (var i = 0; i < count; i++) {
        var curve = curve(binary, curveOffset, useInverseFn);
        curves.push(curve);
        var byteLength = curve.byteLength;

        if (byteLength === false) {
            // we don't know the length so we can't continue
            break;
        }

        //32 bit aligned
        if (byteLength % 4 !== 0) {
            byteLength += 4 - (byteLength % 4);
        }

        curveOffset += byteLength;
    }
    return curves;
}

/**
 * Creates an inverse curve from the given curve data.
 * @param {ArrayLike<number>} curve 
 * @param {number} numPoints
 */

export function inverseCurve(curve, numPoints) {
    var step = 1 / (numPoints - 1);
    var inverseCurve = [];
    var a = 0;
    var b = 0;
    var inputLen = curve.length - 1;
    var x1, x2, y1, y2;
    var increasing = curve[0] < curve[inputLen];

    for (var i = 0; i < numPoints; i++) {

        var y = i * step;
        var j = getInterval(y, curve);

        if (j >= 0) {
            x1 = curve[j];
            x2 = curve[j + 1];

            y1 = j / inputLen;
            y2 = (j + 1) / inputLen;

            // curve has collapsed to a point
            if (x1 === x2) {
                inverseCurve.push(increasing ? y2 : y1);
                continue;
            } else {
                a = (y2 - y1) / (x2 - x1);
                b = y2 - a * x2;
            }
        }

        // Clip to 0.0 - 1.0
        var x = Math.min(1.0, Math.max(0.0, (a * y + b)));
        inverseCurve.push(x);
    }

    return inverseCurve;
    function getInterval(y, curve) {
        if (curve.length <= 1) {
            return -1;
        }

        var i;
        if (curve[0] < curve[curve.length - 1]) {
            // increasing overall, but maybe not at local point
            for (let i = 0; i < curve.length - 2; i++) {
                if (y >= curve[i] && y <= curve[i + 1]) {
                    // increasing at local point
                    return i;
                } else {
                    if (curve[i + 1] < curve[i]) {
                        if (y >= curve[i + 1] && y <= curve[i]) {
                            // decreasing at local point
                            return i;
                        }
                    }
                }
            }
        } else {
            // decreasing overall, but maybe not at local point
            for (let i = 0; i < curve.length - 2; i++) {
                if (curve[i] <= curve[i + 1]) {
                    if (y >= curve[i] && y <= curve[i + 1]) {
                        // increasing at local point
                        return i;
                    }
                } else if (curve[i + 1] < curve[i]) {
                    if (y >= curve[i + 1] && y <= curve[i]) {
                        // decreasing at local point
                        return i;
                    }
                }
            }
        }
        return -1;
    }

}

/**
 * Creates a color curve from the given binary data.
 * 
 * @param {Uint8Array} binary 
 * @param {number} [offset] 
 * @param {boolean} [useInverse] 
 * @param {number} [inverseCurveSteps]
 */
export function curve(binary, offset = 0, useInverse = false, inverseCurveSteps = 4096) {
    const type = chars(binary, offset, 4);
    const curveHeaderBytes = 12;
    const curve = {
        use: false,
        count: 0,
        /** @type {Uint16Array | false} */
        data: false,  // uint16 0 - 65535
        /** @type {Float64Array | Float32Array | Float16Array | number[]} */
        dataf: [],  // float 0.0 - 1.0
        gamma: 0,
        inverted: !!useInverse,
        /** @type {boolean} */
        passThrough: false,
        /** @type {function | false} */
        curveFn: false,
        /** @type {number[]|false} */
        params: false,
        /** @type {number | false} */
        byteLength: false,
    };

    switch (type) {
        case 'curv': {
            curve.count = uint32(binary, offset + 8);

            // calculate the length of the curve, adding 20 bytes for the curve header
            curve.byteLength = curveHeaderBytes + (curve.count * 2);

            /*The count value specifies the number of entries in the curve table except as follows:
             when count is 0, then a linear response (slope equal to 1.0) is assumed,
             when count is 1, then the data entry is interpreted as a simple gamma value encoded as a
             u8Fixed8Number. Gamma is interpreted canonically and not as an inverse.
             Otherwise, the 16-bit unsigned integers in the range 0 to 65535 linearly map to curve values in the interval
             [0.0, 1.0].*/
            if (curve.count === 0) {
                curve.gamma = 1.0;
                // curve.passThrough indicates that this curve can be ignored
                curve.passThrough = true;

            } else {
                if (curve.count === 1) {
                    curve.gamma = u8Fixed8Number(binary, offset + 12);
                } else {
                    // flag for use
                    curve.use = true;
                    curve.data = uInt16Array(binary, offset + 12, curve.count);

                    curve.dataf = new Float64Array(curve.count);
                    for (let i = 0; i < curve.data.length; i++) {
                        curve.dataf[i] = curve.data[i] / 65535.0;
                    }

                    if (useInverse) {
                        inverseCurveSteps = inverseCurveSteps || 4096;
                        curve.dataf = inverseCurve(curve.dataf, inverseCurveSteps);
                        curve.count = curve.dataf.length;
                        // for(i = 0; i < curve.dataf.length; i++){
                        //     // Rewrite 16 bit arrays
                        //     curve.data[i] = Math.round(curve.dataf[i] * 65535.0);
                        // }
                    }

                    // get midpoint
                    if (curve.count > 3) {
                        var y = curve.data[curve.count / 2];
                        curve.gamma = 0.0 - Math.log(y / 65535.0) / 0.69315;
                    }

                    if (curve.count === 2) {
                        if (curve.data[0] === 0 && curve.data[1] === 65535) {
                            // curve.passThrough indicates that this curve can be ignored
                            curve.passThrough = true;
                        }
                    }
                }
            }

            break;
        }
        case 'para': {
            // parametricCurveType
            curve.use = true;
            const functionType = uint16(binary, offset + 8);
            // get parameters

            //Table 68 - parametricCurveType function type encoding ICC V4.4 spec
            const functionType2PramCount = [1, 3, 4, 5, 7];
            const pramCount = functionType2PramCount[functionType];

            if (pramCount === undefined) {
                console.log('Unknown parametricCurveType function type ' + functionType);
                break;
            }

            curve.byteLength = curveHeaderBytes + (pramCount * 4);

            /** @type {number[]} */
            curve.params = [];
            for (let i = 0; i < pramCount; i++) {
                // Note that its 32 bit aligned, so i * 4 bytes
                var paramOffset = offset + curveHeaderBytes + (i * 4);
                curve.params.push(s15Fixed16Number(uint32(binary, paramOffset)));
            }

            //
            // Note that the inverse functions are mainly used for inverse matrix gamma tone curves
            // in the LUTS the curves are always as-is, since the luts know the directions
            //

            switch (functionType) {
                case 0:
                    // Just use inline gamma as faster code
                    curve.gamma = curve.params[0];
                    if (curve.gamma === 1.0) {
                        // curve.passThrough indicates that this curve can be ignored
                        curve.passThrough = true;
                    }

                    // if(useInverse){
                    //     curve.curveFn = function(params, y){
                    //         //y = Math.max(0.0, Math.min(1.0, y));
                    //         return Math.pow(y, 1.0 / params[0]);
                    //     }
                    // } else {
                    //     // Gamma
                    //     // X = Y ^ Gamma
                    //     curve.curveFn = function(params, x){
                    //         //x = Math.max(0.0, Math.min(1.0, x));
                    //         return Math.pow(x, params[0]);
                    //     }
                    // }
                    break;
                case 1:
                    if (useInverse) {
                        // X = (Y ^1/g  - b) / a
                        curve.curveFn = function (params, y) {
                            ///y = Math.max(0.0, Math.min(1.0, y));
                            return (Math.pow(y, 1.0 / params[0]) - params[2]) / params[1];
                        };
                    } else {
                        // CIE 122-1966
                        // Y = (aX + b)^Gamma  | X >= -b/a
                        // Y = 0               | else
                        curve.curveFn = function (params, x) {
                            //x = Math.max(0.0, Math.min(1.0, x));
                            var disc = -params[2] / params[1];
                            if (x >= disc) {
                                var e = params[1] * x + params[2];
                                if (e > 0) {
                                    return Math.pow(e, params[0]);
                                }
                                return 0;
                            }
                            return 0;
                        };
                    }
                    break;

                case 2:// IEC 61966‐3
                    if (useInverse) {
                        // X=((Y^1/g-b)/a)    | Y >= (ad+b)^g
                        // X=Y/c              | Y< (ad+b)^g
                        curve.curveFn = function (params, y) {
                            //y = Math.max(0.0, Math.min(1.0, y));
                            var e = params[1] * params[4] + params[2];
                            var disc = 0;
                            if (e >= 0) {
                                disc = Math.pow(e, params[0]);
                            }
                            if (y >= disc) {
                                return (Math.pow(y, 1.0 / params[0]) - params[2]) / params[1];
                            }
                            return y / params[3];
                        };
                    } else {

                        // Y = (aX + b)^Gamma | X >= d
                        // Y = cX             | X < d
                        curve.curveFn = function (params, x) {
                            //x = Math.max(0.0, Math.min(1.0, x));
                            if (x >= params[4]) {
                                var e = params[1] * x + params[2];
                                if (e > 0) {
                                    return Math.pow(e, params[0]);
                                }
                                return 0;
                            }
                            return params[3] * x;
                        };
                    }
                    break;
                case 3: //IEC 61966‐2.1 (sRGB)
                    if (useInverse) {
                        // X=((Y-e)1/g-b)/a   | Y >=(ad+b)^g+e), cd+f
                        // X=(Y-f)/c          | else
                        curve.curveFn = function (params, y) {
                            //y = Math.max(0.0, Math.min(1.0, y));
                            var disc = params[3] * params[4] + params[6];
                            if (y >= disc) {
                                var e = y - params[5];
                                if (e < 0) {
                                    return 0;
                                }
                                return (Math.pow(e, 1.0 / params[0]) - params[2]) / params[1];
                            }
                            return (y - params[6]) / params[3];
                        };
                    } else {
                        // Y = (aX + b)^Gamma + e | X >= d
                        // Y = cX + f             | X < d
                        curve.curveFn = function (params, x) {
                            //x = Math.max(0.0, Math.min(1.0, x));
                            if (x >= params[4]) {
                                var e = params[1] * x + params[2];
                                if (e > 0) {
                                    return Math.pow(e, params[0]) + params[5];
                                }
                                return params[5];
                            }
                            return params[3] * x + params[6];
                        };
                    }
                    break;
                case 4:
                    if (useInverse) {
                        // X=((Y-e)1/g-b)/a   | Y >=(ad+b)^g+e), cd+f
                        // X=(Y-f)/c          | else
                        curve.curveFn = function (params, y) {
                            var disc = params[3] * params[4] + params[6];
                            if (y >= disc) {
                                var e = y - params[5];
                                if (e < 0) {
                                    return 0;
                                }
                                if (params[0] < 0.0001 || params[1] < 0.0001) {
                                    return 0;
                                }
                                return (Math.pow(e, 1.0 / params[0]) - params[2]) / params[1];
                            } else {
                                if (params[3] < 0.0001) {
                                    return 0;
                                }
                                return (y - params[6]) / params[3];
                            }
                        };
                    } else {
                        curve.curveFn = function (params, x) {
                            // Y = (aX + b)^Gamma + e | X >= d
                            // Y = cX + f             | X < d
                            if (x >= params[4]) {

                                var e = params[1] * x + params[2];

                                if (e > 0) {
                                    return Math.pow(e, params[0]) + params[5];
                                }

                                return params[5];
                            }
                            return x * params[3] + params[6];
                        };
                    }
                    break;
                default:
                    throw ('parametricCurveType function type ' + functionType + ' not implemented');
            }
            break;
        }
        default:
            throw ('Unknown CURVE type' + type);
    }
    return curve;
}

export function lut(binary, offset) {
    /** @type {LUT} */
    const lut = {};
    const type = chars(binary, offset, 4);
    const gridPoints = [];

    let nGridPoints;
    let bCurveOffset;
    let matrixOffset;
    let mCurveOffset;
    let cLUTOffset;
    let aCurveOffset;
    let inputTableSize;
    let outputTableSize;
    let lutSize;

    lut.type = type;

    //(matrixV4) ⇒ (1d input tables) ⇒ (multidimensional lookup table) ⇒ (1d output tables).
    // a 3 by 3 matrixV4 (only used when the input color space is XYZ),
    switch (type) {
        case 'mft2': {
            //lut16Type
            lut.precision = 16;
            lut.inputScale = 1;
            lut.outputScale = 1 / 65535;

            const inputChannels = lut.inputChannels = binary[offset + 8];
            const outputChannels = lut.outputChannels = binary[offset + 9];

            nGridPoints = binary[offset + 10];
            for (let i = 0; i < inputChannels; i++) {
                gridPoints.push(nGridPoints);
            }

            lut.gridPoints = gridPoints;
            lut.matrix = matrixV2(binary, offset + 12);

            lut.inputTableEntries = uint16(binary, offset + 48);
            lut.outputTableEntries = uint16(binary, offset + 50);

            var readPos = offset + 52;

            ///////////////////////////////////////////////////////
            // Read input curves
            inputTableSize = lut.inputTableEntries * inputChannels;

            lut.inputCurve = {
                channels: inputChannels,
                entries: uint16(binary, offset + 48),
                table: uInt16Array(binary, readPos, inputTableSize),
                tablef: new Float64Array(inputTableSize),
                outputScale: 1 / 65535
            };

            readPos += (inputTableSize * 2);

            for (let i = 0; i < lut.inputCurve.table.length; i++) {
                lut.inputCurve.tablef[i] = lut.inputCurve.table[i] / 65535.0;
            }

            ///////////////////////////////////////////////////////
            // Read xD Lut Table
            lutSize = Math.pow(lut.gridPoints[0], inputChannels) * outputChannels;
            lut.CLUT = uInt16Array(binary, readPos, lutSize);

            readPos += (lutSize * 2);

            ///////////////////////////////////////////////////////
            // Read output curves
            outputTableSize = lut.outputTableEntries * outputChannels;
            lut.outputCurve = {
                channels: outputChannels,
                entries: uint16(binary, offset + 50),
                table: uInt16Array(binary, readPos, outputTableSize),
                tablef: new Float64Array(outputTableSize),
                outputScale: 1 / 65535
            };

            for (let i = 0; i < lut.outputCurve.table.length; i++) {
                lut.outputCurve.tablef[i] = lut.outputCurve.table[i] / 65535.0;
            }
            break;
        }
        case 'mft1': { //lut16Type
            lut.precision = 8;
            lut.inputScale = 1;
            lut.outputScale = 1 / 255;
            const inputChannels = lut.inputChannels = binary[offset + 8];
            const outputChannels = lut.outputChannels = binary[offset + 9];

            nGridPoints = binary[offset + 10];
            for (let i = 0; i < inputChannels; i++) {
                gridPoints.push(nGridPoints);
            }
            lut.gridPoints = gridPoints;
            lut.matrix = matrixV2(binary, offset + 12);

            lut.inputTableEntries = 256;
            lut.outputTableEntries = 256;

            // Read input curves
            inputTableSize = lut.inputTableEntries * inputChannels;
            lut.inputCurve = {
                channels: inputChannels,
                entries: 256,
                table: uInt8Array(binary, offset + 48, inputTableSize),
                tablef: new Float64Array(inputTableSize),
                outputScale: 1 / 255
            };

            for (let i = 0; i < lut.inputCurve.table.length; i++) {
                lut.inputCurve.tablef[i] = lut.inputCurve.table[i] / 255.0;
            }

            ///////////////////////////////////////////////////////
            // Read xD Lut Table
            lutSize = Math.pow(lut.gridPoints[0], inputChannels) * outputChannels;
            lut.CLUT = uInt8Array(binary, offset + 48 + inputTableSize, lutSize);

            ///////////////////////////////////////////////////////
            // Read output curves
            outputTableSize = lut.outputTableEntries * outputChannels;
            lut.outputCurve = {
                channels: outputChannels,
                entries: 256,
                table: uInt8Array(binary, offset + 48 + inputTableSize + lutSize, outputTableSize),
                tablef: new Float64Array(outputTableSize),
                outputScale: 1 / 255
            };

            for (let i = 0; i < lut.outputCurve.table.length; i++) {
                lut.outputCurve.tablef[i] = lut.outputCurve.table[i] / 255.0;
            }

            break;
        }

        case 'mAB ': {
            //lutAToBType V4
            lut.inputChannels = binary[offset + 8];
            lut.outputChannels = binary[offset + 9];
            bCurveOffset = uint32(binary, offset + 12);
            matrixOffset = uint32(binary, offset + 16);
            mCurveOffset = uint32(binary, offset + 20);
            cLUTOffset = uint32(binary, offset + 24);
            aCurveOffset = uint32(binary, offset + 28);

            lut.bCurves = (bCurveOffset === 0) ? false : curves(binary, offset + bCurveOffset, lut.outputChannels, false);
            lut.matrix = (matrixOffset === 0) ? false : matrixV4(binary, offset + matrixOffset);
            if (cLUTOffset === 0) {
                lut.CLUT = false;
            } else {
                CLUT4(lut, binary, offset + cLUTOffset, lut.inputChannels, lut.outputChannels);
            }
            lut.mCurves = (mCurveOffset === 0) ? false : curves(binary, offset + mCurveOffset, lut.outputChannels, false);
            lut.aCurves = (aCurveOffset === 0) ? false : curves(binary, offset + aCurveOffset, lut.inputChannels, false);
            break;

        }

        case 'mBA ': {
            //lutBToAType V4
            lut.inputChannels = binary[offset + 8];
            lut.outputChannels = binary[offset + 9];
            bCurveOffset = uint32(binary, offset + 12);
            matrixOffset = uint32(binary, offset + 16);
            mCurveOffset = uint32(binary, offset + 20);
            cLUTOffset = uint32(binary, offset + 24);
            aCurveOffset = uint32(binary, offset + 28);

            lut.bCurves = (bCurveOffset === 0) ? false : curves(binary, offset + bCurveOffset, lut.inputChannels, false);
            lut.matrix = (matrixOffset === 0) ? false : matrixV4(binary, offset + matrixOffset);
            if (cLUTOffset === 0) {
                lut.CLUT = false;
            } else {
                CLUT4(lut, binary, offset + cLUTOffset, lut.inputChannels, lut.outputChannels);
            }
            lut.mCurves = (mCurveOffset === 0) ? false : curves(binary, offset + mCurveOffset, lut.inputChannels, false);
            lut.aCurves = (aCurveOffset === 0) ? false : curves(binary, offset + aCurveOffset, lut.outputChannels, false);

            break;
        }
        default:
            console.log('Unsupported LUT Tag ' + type);
    }

    lut.g1 = Number(lut.gridPoints?.[0]);
    lut.g2 = lut.g1 * Number(lut.gridPoints?.[1]);
    lut.g3 = lut.g2 * Number(lut.gridPoints?.[2]);
    lut.g4 = lut.g3 * Number(lut.gridPoints?.[3]);

    lut.go0 = lut.outputChannels;
    lut.go1 = lut.g1 * lut.outputChannels;
    lut.go2 = lut.g2 * lut.outputChannels;
    lut.go3 = lut.g3 * lut.outputChannels;

    return lut;

}

export function CLUT4(lut, binary, offset, inputChannels, outputChannels) {
    var gridPoints = [];
    var precision = binary[offset + 16];

    // get the gridpoints
    for (var i = 0; i < inputChannels; i++) {
        gridPoints.push(binary[offset + i]);
    }

    // calc the length
    var lutLength = gridPoints[0];
    for (let i = 1; i < inputChannels; i++) {
        lutLength *= gridPoints[i];
    }

    if (precision === 1) {
        lut.CLUT = uInt8Array(binary, offset + 20, lutLength * outputChannels);
        lut.inputScale = 1;
        lut.outputScale = 1 / 255;
    } else {
        lut.CLUT = uInt16Array(binary, offset + 20, lutLength * outputChannels);
        lut.inputScale = 1;
        lut.outputScale = 1 / 65535;
    }

    // update the data
    lut.precision = precision * 8;  // 8 or 16 bit
    lut.gridPoints = gridPoints;
}


/**
 * MultiProcess Elements are mainly for Film use and not supported at this time
 *
 * https://www.color.org/whitepapers/ICC_White_Paper28-MultiProcessingElements.pdf
 *
 * From the whitepaper "CMM Support for Multi Processing Element Tag type is optional.
 * This means that MPE based tag support is NOT guaranteed to be provided an implemented
 * by CMMs in general! Additionally, all required tags must be present and valid."
 *
 * In Otherwords don't need to use them as standard TAGs for AtoB and BtoA are
 * provided and can be used instead.
 *
 * @param binary - Binary data array
 * @param offset - Byte offset to start reading from
 * @returns Multi-process element object with elements array, input channels, and output channels
 */
export function multiProcessElement(binary, offset) {
    var elements = [];
    var inputChannels = uint16(binary, offset + 8);
    var outputChannels = uint16(binary, offset + 10);
    var elementCount = uint32(binary, offset + 12);

    var elementOffsets = [];
    for (var i = 0; i < elementCount; i++) {
        elementOffsets.push({
            offset: uint32(binary, offset + 16 + (i * 4)),
            size: uint32(binary, offset + 16 + (i * 4) + 4)
        });
    }

    for (let i = 0; i < elementCount; i++) {
        var elementOffset = offset + elementOffsets[i].offset;
        var sig = chars(binary, elementOffset, 4);
        switch (sig) {
            case 'cvst':
                // Curves Not supported at this time
                elements.push({
                    sig: sig
                });
                break;
            case 'matf':
                // Matrix Not supported at this time
                elements.push({
                    sig: sig,
                });
                break;
            case 'clut':
                // CLUT Not supported at this time
                elements.push({
                    sig: sig,
                });
                break;

            case 'bACS':
            case 'eACS':
                break;
            default:
                console.log('Unknown MultiProcess Element ' + sig);
        }
    }
    return { inputChannels, outputChannels, elements };
}
