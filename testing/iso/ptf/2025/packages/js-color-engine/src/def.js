/**
 * @fileoverview Core definitions and enumerations for the color engine
 * Contains color types, profile types, rendering intents, and encoding specifications
 * 
 * @license GPL-3.0-or-later
 * @copyright 2019, 2024 Glenn Wilton, O2 Creative Limited
 */

// @ts-check


/**
 * Color type enumeration for different color space representations
 * Used to identify the type of color object and determine appropriate conversion methods
 * @readonly
 * @enum {number}
 */
export const eColourType = {
    /** No color type specified @type {0} */
    None: 0,
    /** XYZ tristimulus color space @type {1} */
    XYZ: 1,
    /** Lab color space (L*a*b*) @type {2} */
    Lab: 2,
    /** LCH color space (Lightness, Chroma, Hue) @type {3} */
    LCH: 3,
    /** Grayscale color space @type {4} */
    Gray: 4,
    /** RGB color space with integer values (0-255) @type {5} */
    RGB: 5,
    /** CMYK color space with integer values (0-255) @type {6} */
    CMYK: 6,
    /** Custom color space @type {7} */
    custom: 7,
    /** RGB color space with floating-point values (0.0-1.0) @type {8} */
    RGBf: 8,
    /** CMYK color space with floating-point values (0.0-1.0) @type {9} */
    CMYKf: 9,
    /** Spectral color representation @type {10} */
    Spectrum: 10,
    /** Grayscale with floating-point values (0.0-1.0) @type {11} */
    Grayf: 11,
    /** Duo-tone color space @type {12} */
    Duo: 12,
    /** Duo-tone with floating-point values @type {13} */
    Duof: 13,
    /** xyY color space @type {14} */
    xyY: 14,
};


// /** @typedef {0} eColourType.None */
// /** @typedef {1} eColourType.XYZ */
// /** @typedef {2} eColourType.Lab */
// /** @typedef {3} eColourType.LCH */
// /** @typedef {4} eColourType.Gray */
// /** @typedef {5} eColourType.RGB */
// /** @typedef {6} eColourType.CMYK */
// /** @typedef {7} eColourType.custom */
// /** @typedef {8} eColourType.RGBf */
// /** @typedef {9} eColourType.CMYKf */
// /** @typedef {10} eColourType.Spectrum */
// /** @typedef {11} eColourType.Grayf */
// /** @typedef {12} eColourType.Duo */
// /** @typedef {13} eColourType.Duof */
// /** @typedef {14} eColourType.xyY */

// /** @typedef {0} eColourType.None */
// /** @typedef {1} eColourType.XYZ */
// /** @typedef {2} eColourType.Lab */
// /** @typedef {3} eColourType.LCH */
// /** @typedef {4} eColourType.Gray */
// /** @typedef {5} eColourType.RGB */
// /** @typedef {6} eColourType.CMYK */
// /** @typedef {7} eColourType.custom */
// /** @typedef {8} eColourType.RGBf */
// /** @typedef {9} eColourType.CMYKf */
// /** @typedef {10} eColourType.Spectrum */
// /** @typedef {11} eColourType.Grayf */
// /** @typedef {12} eColourType.Duo */
// /** @typedef {13} eColourType.Duof */
// /** @typedef {14} eColourType.xyY */
// /** @typedef {typeof eColourType.None | eColourType.XYZ | eColourType.Lab | eColourType.LCH | eColourType.Gray | eColourType.RGB | eColourType.CMYK | eColourType.custom | eColourType.RGBf | eColourType.CMYKf | eColourType.Spectrum | eColourType.Grayf | eColourType.Duo | eColourType.Duof | eColourType.xyY} eColourType */

/**
 * ICC profile type enumeration for different color space profiles
 * Determines the internal structure and transformation methods for ICC profiles
 * @readonly
 * @enum {number}
 */
export const eProfileType = {
    /** Lab color space profile */
    Lab: 0,
    /** RGB matrix-based profile */
    RGBMatrix: 1,
    /** RGB LUT-based profile */
    RGBLut: 2,
    /** CMYK color space profile */
    CMYK: 3,
    /** Grayscale profile */
    Gray: 4,
    /** Duo-tone profile */
    Duo: 5,
    /** XYZ color space profile */
    XYZ: 6,
};


/**
 * Converts a profile type enum value to human-readable string
 * @param {eProfileType} type - Profile type value from eProfileType enum
 */
export function eProfileTypeToString(type) {
    switch (type) {
        case eProfileType.Lab:
            return 'Lab';
        case eProfileType.RGBMatrix:
            return 'RGB Matrix';
        case eProfileType.RGBLut:
            return 'RGB LUT';
        case eProfileType.CMYK:
            return 'CMYK';
        case eProfileType.Gray:
            return 'Grayscale';
        case eProfileType.Duo:
            return 'Duo-tone';
        case eProfileType.XYZ:
            return 'XYZ';
        default:
            return 'Unknown';
    }
}

/**
 * Rendering intent enumeration for color management transformations
 * Defines how colors should be converted when the source and destination gamuts differ
 * @readonly
 * @enum {number}
 */
export const eIntent = {
    /** Perceptual rendering intent - maintains overall appearance */
    perceptual: 0,
    /** Relative colorimetric rendering intent - maintains color accuracy within gamut */
    relative: 1,
    /** Saturation rendering intent - maintains saturation over accuracy */
    saturation: 2,
    /** Absolute colorimetric rendering intent - maintains absolute color accuracy */
    absolute: 3
};

/**
 * Converts rendering intent enum value to human-readable string
 * @param {number} intent - Rendering intent value from eIntent enum
 * @returns Human-readable intent name or 'unknown' if invalid
 */
export function intent2String(intent) {
    return /** @type {'Perceptual'|'Relative'|'Saturation'|'Absolute'|'unknown'} */ (['Perceptual', 'Relative', 'Saturation', 'Absolute'][intent] || 'unknown');
};

/** @param {eIntent} intent */
export function cgatsIntentString(intent) {
    switch (intent) {
        case eIntent.perceptual:
            return 'Perceptual';
        case eIntent.relative:
            return 'Relative Colorimetric';
        case eIntent.saturation:
            return 'Saturation';
        case eIntent.absolute:
            return 'Absolute Colorimetric';
    }
}


/**
 * Rounds a number to specified decimal places
 * @param {number} n - Number to round
 * @param {number} places - Number of decimal places
 * @returns {number} Rounded number
 */
export function roundN(n, places) {
    var p = Math.pow(10, places);
    return Math.round(n * p) / p;
}

/**
 * Converts a Uint8Array to a base64 string
 * @param {Uint8Array} uint8Array - Input array to convert
 * @returns {string} Base64 encoded string
 */
export function uint8ArrayToBase64(uint8Array) {
    var binaryString = '';

    for (var byte of uint8Array) {
        binaryString += String.fromCharCode(byte);
    }

    return btoa(binaryString);
}

/**
 * Converts a Uint16Array to a base64 string
 * @param {Uint16Array} uint16Array - Input array to convert
 * @returns {string} Base64 encoded string
 */
export function uint16ArrayToBase64(uint16Array) {
    var uint8Array = new Uint8Array(uint16Array.buffer);
    return uint8ArrayToBase64(uint8Array);
}

/**
 * Converts a base64 string to a Uint16Array
 * @param {string} base64String - Base64 encoded string
 * @returns {Uint16Array} Decoded array
 */
export function base64ToUint16Array(base64String) {
    var binaryString = atob(base64String);
    var uint8Array = new Uint8Array(binaryString.length);

    for (var i = 0; i < binaryString.length; i++) {
        uint8Array[i] = binaryString.charCodeAt(i);
    }

    return new Uint16Array(uint8Array.buffer);
}

/**
 * Converts a base64 string to a Uint8Array
 * @param {string} base64String - Base64 encoded string
 * @returns {Uint8Array} Decoded array
 */
export function base64ToUint8Array(base64String) {
    var binaryString = atob(base64String);
    var uint8Array = new Uint8Array(binaryString.length);

    for (var i = 0; i < binaryString.length; i++) {
        uint8Array[i] = binaryString.charCodeAt(i);
    }

    return uint8Array;
}

/**
 * Standard illuminant definitions with XYZ tristimulus values
 * Used for chromatic adaptation and white point calculations
 * @readonly
 */
export const illuminants = {
    /** Standard illuminant A (incandescent tungsten) @type{Illuminant<'a', 1.09850, 1.0, 0.35585>} */
    a: { desc: 'a', Y: 1.0, X: 1.09850, Z: 0.35585 },
    /** Standard illuminant B (noon sunlight) @type{Illuminant<'b', 0.99072, 1.0, 0.85223>} */
    b: { desc: 'b', Y: 1.0, X: 0.99072, Z: 0.85223 },
    /** Standard illuminant C (daylight) @type{Illuminant<'c', 0.98074, 1.0, 1.18232>} */
    c: { desc: 'c', Y: 1.0, X: 0.98074, Z: 1.18232 },
    /** Standard illuminant D50 (horizon daylight) @type{Illuminant<'d50', 0.96422, 1.0, 0.82521>} */
    d50: { desc: 'd50', Y: 1.0, X: 0.96422, Z: 0.82521 },
    /** Standard illuminant D55 (mid-morning daylight) @type{Illuminant<'d55', 0.95682, 1.0, 0.92149>} */
    d55: { desc: 'd55', Y: 1.0, X: 0.95682, Z: 0.92149 },
    /** Standard illuminant D65 (noon daylight) @type{Illuminant<'d65', 0.95047, 1.0, 1.08883>} */
    d65: { desc: 'd65', Y: 1.0, X: 0.95047, Z: 1.08883 },
    /** Standard illuminant D75 (north sky daylight) @type{Illuminant<'d75', 0.94972, 1.0, 1.22638>} */
    d75: { desc: 'd75', Y: 1.0, X: 0.94972, Z: 1.22638 },
    /** Equal energy illuminant @type{Illuminant<'e', 1.00000, 1.0, 1.00000>} */
    e: { desc: 'e', Y: 1.0, X: 1.00000, Z: 1.00000 },
    /** Fluorescent F2 (cool white fluorescent) @type{Illuminant<'f2', 0.99186, 1.0, 0.67393>} */
    f2: { desc: 'f2', Y: 1.0, X: 0.99186, Z: 0.67393 },
    /** Fluorescent F7 (broad-band daylight fluorescent) @type{Illuminant<'f7', 0.95041, 1.0, 1.08747>} */
    f7: { desc: 'f7', Y: 1.0, X: 0.95041, Z: 1.08747 },
    /** Fluorescent F11 (narrow-band white fluorescent) @type{Illuminant<'f11', 1.00962, 1.0, 0.64350>} */
    f11: { desc: 'f11', Y: 1.0, X: 1.00962, Z: 0.64350 }
};

/**
 * Encoding specifications for different data formats and color spaces
 * Defines how color data is represented internally during transformations
 * @readonly
 * @enum {number}
 */
export const encoding = {
    /** Device-dependent color space encoding (0.0 to 1.0) */
    device: 0,
    /** ICC v2 PCS encoding (0.0 to 1.0 based on 16bit where 0xFF00 = 1.0) */
    PCSv2: 1,
    /** ICC v4 PCS encoding (0.0 to 1.0 based on 16bit where 0xFFFF = 1.0) */
    PCSv4: 2,
    /** XYZ Profile Connection Space encoding */
    PCSXYZ: 3,
    /** Lab D50 color space encoding */
    LabD50: 3,
    /** CMS Lab color space encoding */
    cmsLab: 4,
    /** CMS RGB color space encoding */
    cmsRGB: 5,
    /** CMS CMYK color space encoding */
    cmsCMYK: 6,
    /** CMS XYZ color space encoding */
    cmsXYZ: 7
};

/**
 * String representations of encoding types for debugging and logging
 * Corresponds to the encoding enum values for human-readable output
 * @readonly
 * @type {string[]}
 */
export const encodingStr = [
    'device',
    'PCSv2',
    'PCSv4',
    'PCSXYZ',
    'LabD50',
    'cmsLab',
    'cmsRGB',
    'cmsCMYK',
    'cmsXYZ'
];

/**
 * Maximum value for u1Fixed15Number format used in ICC profiles
 * u1Fixed15Number is a fixed point number format with 1 bit for the integer part
 * and 15 bits for the fractional part, used to represent values in range 0 to 1
 * with precision of 1/32768.
 * 
 * This constant represents the maximum value (1.0) that can be represented
 * in this format, which is 1 + 32767/32768.
 * 
 * @see ICC.1:2022 6.4.3.2
 * @type {number}
 */
export const u1Fixed15NumberMax = 1 + 32767 / 32768;


/**
 * @template {string} Description
 * @template {number} X
 * @template {number} Y
 * @template {number} Z
 * @typedef {_cmsWhitePoint & { desc: Description, X: X,  Y: Y, Z: Z }} Illuminant
 */

// /** @typedef {Illuminant<'a', 1.09850, 1.0, 0.35585>} Illuminant.A */
// /** @typedef {Illuminant<'b', 0.99072, 1.0, 0.85223>} Illuminant.B */
// /** @typedef {Illuminant<'c', 0.98074, 1.0, 1.18232>} Illuminant.C */
// /** @typedef {Illuminant<'d50', 0.96422, 1.0, 0.82521>} Illuminant.D50 */
// /** @typedef {Illuminant<'d55', 0.95682, 1.0, 0.92149>} Illuminant.D55 */
// /** @typedef {Illuminant<'d65', 0.95047, 1.0, 1.08883>} Illuminant.D65 */
// /** @typedef {Illuminant<'d75', 0.94972, 1.0, 1.22638>} Illuminant.D75 */
// /** @typedef {Illuminant<'e', 1.00000, 1.0, 1.00000>} Illuminant.E */
// /** @typedef {Illuminant<'f2', 0.99186, 1.0, 0.67393>} Illuminant.F2 */
// /** @typedef {Illuminant<'f7', 0.95041, 1.0, 1.08747>} Illuminant.F7 */
// /** @typedef {Illuminant<'f11', 1.00962, 1.0, 0.64350>} Illuminant.F11 */

// _cmsXYZ
// _cmsLab
// _cmsLCH
// _cmsGray
// _cmsRGB
// _cmsCMYK
// _cmscustom
// _cmsRGBf
// _cmsCMYKf
// _cmsSpectrum
// _cmsGrayf
// _cmsDuo
// _cmsDuof
// _cmsxyY

// /**
//  * @typedef {object} _cmsWhitePoint
//  * @property {string} desc
//  * @property {number} X
//  * @property {number} Y
//  * @property {number} Z
//  */

// /**
//  * @typedef {object} _cmsCMYK
//  * @property {typeof eColourType.CMYK} type eColourType
//  * @property {number} C 0 - 100
//  * @property {number} M 0 - 100
//  * @property {number} Y 0 - 100
//  * @property {number} K 0 - 100
//  */

// /**
//  * @typedef {object} _cmsCMYKf
//  * @property {typeof eColourType.CMYKf} type eColourType
//  * @property {number} Cf 0.0 - 1.0
//  * @property {number} Mf 0.0 - 1.0
//  * @property {number} Yf 0.0 - 1.0
//  * @property {number} Kf 0.0 - 1.0
//  */

// /**
//  * @typedef {object} _cmsXYZ
//  * @property {typeof eColourType.XYZ} type eColourType
//  * @property {number} X 0 - 1
//  * @property {number} Y 0 - 1
//  * @property {number} Z 0 - 1
//  */

// /**
//  * @template {_cmsWhitePoint} [WhitePoint=Illuminant.D50]
//  * @property {typeof eColourType.Lab} type eColourType
//  * @property {number} L 0 - 100
//  * @property {number} a -128 - 127
//  * @property {number} b -128 - 127
//  * @property {WhitePoint} [whitePoint=convert.d50] - Reference white point for Lab calculations
//  * @typedef {{type: typeof eColourType.Lab, L: number, a: number, b: number, whitePoint?: WhitePoint}} _cmsLab
//  */

// /** @typedef {_cmsLab<Illuminant.D50>} _cmsLabD50 */
// /**
//  * @typedef {object} _cmsLabD50
//  * @property {number} L 0 - 100
//  * @property {number} a -128 - 127
//  * @property {number} b -128 - 127
//  */

// /**
//  * @typedef {object} _cmsLCH
//  * @property {typeof eColourType.LCH} type eColourType
//  * @property {number} L 0 - 100
//  * @property {number} C 0 - 100
//  * @property {number} H 0 - 360
//  * @property {_cmsWhitePoint} whitePoint
//  */

// /**
//  * @typedef {object} _cmsRGB
//  * @property {typeof eColourType.RGB} type eColourType
//  * @property {number} R 0 - 255
//  * @property {number} G 0 - 255
//  * @property {number} B 0 - 255
//  */

// /**
//  * @typedef {object} _cmsRGBf
//  * @property {typeof eColourType.RGBf} type eColourType
//  * @property {number} Rf 0.0 - 1.0
//  * @property {number} Gf 0.0 - 1.0
//  * @property {number} Bf 0.0 - 1.0
//  */

// /**
//  * @typedef {object} _cmsDuo
//  * @property {typeof eColourType.Duo} type eColourType
//  * @property {number} a 0.0 - 100
//  * @property {number} b 0.0 - 100
//  */

// /**
//  * @typedef {object} _cmsDuof
//  * @property {typeof eColourType.Duof} type eColourType
//  * @property {number} af 0.0 - 1.0
//  * @property {number} bf 0.0 - 1.0
//  */



// /**
//  * @typedef {object} _cmsGray
//  * @property {number} type eColourType
//  * @property {number} G 0.0 - 1.0
//  */

/**
 * @typedef {object} _cmsWhitePoint
 * @property {string} [desc] - White point description (e.g., 'd50', 'd65', 'a')
 * @property {number} X - X tristimulus value (typically around 0.9-1.1)
 * @property {number} Y - Y tristimulus value (typically 1.0)
 * @property {number} Z - Z tristimulus value (typically 0.3-1.3)
 */

/**
 * @typedef {object} _cmsGray
 * @property {typeof eColourType.Gray} [type] - Color type from eColourType.Gray
 * @property {number} G - Grayscale value (0-255)
 */

/**
 * @typedef {object} _cmsGrayf
 * @property {typeof eColourType.Gray} [type] - Color type from eColourType.Gray
 * @property {number} Gf - Grayscale value (0-255)
 */

/**
 * @typedef {object} _cmsDuo
 * @property {typeof eColourType.Duo} [type] - Color type from eColourType.Duo
 * @property {number} a - First color component (0-100)
 * @property {number} b - Second color component (0-100)
 */

/**
 * @typedef {object} _cmsDuof
 * @property {typeof eColourType.Duof} type eColourType
 * @property {number} af 0.0 - 1.0
 * @property {number} bf 0.0 - 1.0
 */

/**
 * @typedef {object} _cmsCMYK
 * @property {typeof eColourType.CMYK} [type] - Color type from eColourType.CMYK
 * @property {number} C - Cyan component (0-100)
 * @property {number} M - Magenta component (0-100)
 * @property {number} Y - Yellow component (0-100)
 * @property {number} K - Black (Key) component (0-100)
 */

/**
 * @typedef {object} _cmsCMYKf
 * @property {typeof eColourType.CMYKf} [type] - Color type from eColourType.CMYKf
 * @property {number} Cf - Cyan component as float (0.0-1.0)
 * @property {number} Mf - Magenta component as float (0.0-1.0)
 * @property {number} Yf - Yellow component as float (0.0-1.0)
 * @property {number} Kf - Black component as float (0.0-1.0)
 */

/**
 * @typedef {object} _cmsXYZ
 * @property {typeof eColourType.XYZ} [type] - Color type from eColourType.XYZ
 * @property {number} X - X tristimulus value (typically 0.0-1.0)
 * @property {number} Y - Y tristimulus value (luminance, typically 0.0-1.0)
 * @property {number} Z - Z tristimulus value (typically 0.0-1.0)
 * @property {_cmsWhitePoint} [whitePoint] - Reference white point
 */

/**
 * @template {_cmsWhitePoint} [WhitePoint=typeof illuminants.D50]
 * @property {typeof eColourType.Lab} [type] eColourType
 * @property {number} L 0 - 100
 * @property {number} a -128 - 127
 * @property {number} b -128 - 127
 * @property {WhitePoint} [whitePoint=convert.d50] - Reference white point for Lab calculations
 * @typedef {{type: typeof eColourType.Lab, L: number, a: number, b: number, whitePoint?: WhitePoint}} _cmsLab
 */

/** @typedef {_cmsLab<typeof illuminants.D50>} _cmsLabD50 */
// /**
//  * @typedef {object} _cmsLabD50
//  * @property {number} L - Lightness component (0.0-100.0)
//  * @property {number} a - Green-red color component (typically -128 to +127)
//  * @property {number} b - Blue-yellow color component (typically -128 to +127)
//  */

/**
 * @typedef {object} _cmsLCH
 * @property {typeof eColourType.LCH} [type] - Color type from eColourType.LCH
 * @property {number} L - Lightness component (0.0-100.0)
 * @property {number} C - Chroma component (0.0+, no upper limit)
 * @property {number} H - Hue angle in degrees (0.0-360.0)
 * @property {_cmsWhitePoint} whitePoint - Reference white point for LCH calculations
 */

/**
 * @typedef {object} _cmsRGB
 * @property {typeof eColourType.RGB} [type] - Color type from eColourType.RGB
 * @property {number} R - Red component (0-255)
 * @property {number} G - Green component (0-255)
 * @property {number} B - Blue component (0-255)
 */

/**
 * @typedef {object} _cmsRGBf
 * @property {typeof eColourType.RGBf} [type] - Color type from eColourType.RGBf
 * @property {number} Rf - Red component as float (0.0-1.0, can extend beyond for out-of-gamut)
 * @property {number} Gf - Green component as float (0.0-1.0, can extend beyond for out-of-gamut)
 * @property {number} Bf - Blue component as float (0.0-1.0, can extend beyond for out-of-gamut)
 */

/**
 * @typedef {object} _cmsxyY
 * @property {typeof eColourType.xyY} [type] - Color type from eColourType.xyY
 * @property {number} x - x chromaticity coordinate (0.0-1.0)
 * @property {number} y - y chromaticity coordinate (0.0-1.0)
 * @property {number} Y - Luminance component (0.0-1.0)
 */

/**
 * Union type for all supported color objects
 * @typedef {(_cmsCMYK | _cmsCMYKf | _cmsRGB | _cmsRGBf | _cmsGray | _cmsGrayf | _cmsLab | _cmsLCH | _cmsXYZ | _cmsxyY | _cmsDuo | _cmsDuof) & { whitePoint?: _cmsWhitePoint }} CMSColorObject
 */

/**
 * @typedef {number[]} _Device Array of n-Channel floats with a range of 0.0 to 1.0
 * @typedef {number[]} _PCS Array of n-Channel 16bit integers data with a range of 0 to 65535
 * @typedef {number[]} _PCSf Array of n-Channel floats of with a range of 0.0 to 1.0
 * @typedef {number} stageEncoding
 **/

/**
 * @typedef {object} _Stage
 * @property {stageEncoding} inputEncoding
 * @property {function} funct
 * @property {stageEncoding} outputEncoding
 * @property {object} stageData
 * @property {string} stageName
 * @property {string} debugFormat
 */
