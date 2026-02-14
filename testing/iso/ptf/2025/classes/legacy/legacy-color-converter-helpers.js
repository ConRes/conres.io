// @ts-check
/**
 * Legacy Color Converter Helpers
 *
 * Pure utility functions extracted from ColorConverter for use by legacy
 * subclasses that cannot access #private members on the parent.
 *
 * @module LegacyColorConverterHelpers
 * @author Saleh Abdel Motaal <dev@smotaal.io>
 * @ai Claude Opus 4.6 (code generation)
 */

// ============================================================================
// Format Bit Masks
// ============================================================================

/** ENDIAN16_SH(1) = 1 << 11 = 2048 */
export const FORMAT_ENDIAN16_MASK = 0x800;

/** FLOAT_SH(1) = 1 << 22 = 4194304 */
export const FORMAT_FLOAT_MASK = 0x400000;

/** Threshold for adaptive BPC clamping optimization (2 megapixels) */
export const ADAPTIVE_BPC_THRESHOLD = 2 * 1024 * 1024;

// ============================================================================
// Format Inspection
// ============================================================================

/**
 * Checks if a format has the ENDIAN16 (swap-endian) flag set.
 * @param {number} format - LittleCMS TYPE_* format constant
 * @returns {boolean}
 */
export function isSwapEndianFormat(format) {
    return (format & FORMAT_ENDIAN16_MASK) !== 0;
}

/**
 * Checks if a format is a float format.
 * @param {number} format - LittleCMS TYPE_* format constant
 * @returns {boolean}
 */
export function isFloatFormat(format) {
    return (format & FORMAT_FLOAT_MASK) !== 0;
}

/**
 * Removes the ENDIAN16 (swap-endian) flag from a format constant.
 * @param {number} format - LittleCMS TYPE_* format constant
 * @returns {number} Format without SE flag
 */
export function removeSwapEndianFlag(format) {
    return format & ~FORMAT_ENDIAN16_MASK;
}

// ============================================================================
// Buffer Operations
// ============================================================================

/**
 * Byte-swaps 16-bit values in a Uint8Array (big-endian to little-endian or vice versa).
 *
 * @param {Uint8Array} buffer - Buffer containing 16-bit values
 * @returns {Uint8Array} New buffer with swapped bytes
 */
export function byteSwap16(buffer) {
    const swapped = new Uint8Array(buffer.length);
    for (let i = 0; i < buffer.length; i += 2) {
        swapped[i] = buffer[i + 1];
        swapped[i + 1] = buffer[i];
    }
    return swapped;
}

// ============================================================================
// Channel Utilities
// ============================================================================

/**
 * Gets the number of channels for a color space.
 * @param {import('../color-conversion-policy.js').ColorSpace} colorSpace
 * @returns {number}
 */
export function getChannelsForColorSpace(colorSpace) {
    switch (colorSpace) {
        case 'Gray': return 1;
        case 'RGB': return 3;
        case 'CMYK': return 4;
        case 'Lab': return 3;
        default: throw new Error(`Unknown color space: ${colorSpace}`);
    }
}

/**
 * Gets number of channels from a pixel format constant.
 * @param {number} format - LittleCMS pixel format constant
 * @returns {number}
 */
export function getChannelsFromFormat(format) {
    // Extract channels from format: CHANNELS_SH is at bits 3-6
    return ((format >> 3) & 0xF);
}

// ============================================================================
// Cache Key Generation
// ============================================================================

/**
 * Generates a cache key for a profile source.
 * @param {import('../color-converter.js').ProfileType} source
 * @returns {string}
 */
export function getProfileCacheKey(source) {
    if (source === 'Lab') {
        return 'Lab';
    }
    if (source === 'sRGB') {
        return 'sRGB';
    }
    // For ArrayBuffer, use byteLength and first/last bytes as key
    const view = new Uint8Array(source);
    return `buf:${source.byteLength}:${view[0]}:${view[view.length - 1]}`;
}

/**
 * Generates a cache key for a transform.
 * @param {string} srcKey
 * @param {string} dstKey
 * @param {number} inputFormat
 * @param {number} outputFormat
 * @param {number} intent
 * @param {number} flags
 * @returns {string}
 */
export function getTransformCacheKey(srcKey, dstKey, inputFormat, outputFormat, intent, flags) {
    return `${srcKey}|${dstKey}|${inputFormat}|${outputFormat}|${intent}|${flags}`;
}
