// @ts-check
/**
 * Deterministic pixel pattern generators for test fixtures.
 *
 * Creates known pixel data at any resolution for correctness and pressure testing.
 * Same patterns at 4×4 and 2400×2400 — only the resolution changes.
 *
 * @module pattern-generator
 * @author Saleh Abdel Motaal <dev@smotaal.io>
 * @ai Claude Opus 4.6 (code generation)
 */

/**
 * Generate a linear gradient across the red channel.
 * Green and blue are held at 0. Values scale linearly from 0 to max.
 *
 * @param {number} width
 * @param {number} height
 * @param {8 | 16} bitsPerComponent
 * @returns {Uint8Array | Uint16Array}
 */
export function generateRedGradient(width, height, bitsPerComponent = 16) {
    const channels = 3;
    const pixelCount = width * height;
    const max = bitsPerComponent === 16 ? 0xFFFF : 0xFF;
    const buffer = bitsPerComponent === 16
        ? new Uint16Array(pixelCount * channels)
        : new Uint8Array(pixelCount * channels);

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const i = (y * width + x) * channels;
            buffer[i] = Math.round((x / Math.max(1, width - 1)) * max);
            buffer[i + 1] = 0;
            buffer[i + 2] = 0;
        }
    }

    // Return as byte array for PDF embedding
    if (bitsPerComponent === 16) {
        // Big-endian 16-bit for PDF
        const bytes = new Uint8Array(pixelCount * channels * 2);
        for (let i = 0; i < buffer.length; i++) {
            bytes[i * 2] = (buffer[i] >> 8) & 0xFF;
            bytes[i * 2 + 1] = buffer[i] & 0xFF;
        }
        return bytes;
    }
    return /** @type {Uint8Array} */ (buffer);
}

/**
 * Generate a neutral (gray) ramp — all three RGB channels equal.
 * Values ramp from 0 to max across the x-axis, constant across y.
 *
 * @param {number} width
 * @param {number} height
 * @param {8 | 16} bitsPerComponent
 * @returns {Uint8Array}
 */
export function generateNeutralRamp(width, height, bitsPerComponent = 16) {
    const channels = 3;
    const pixelCount = width * height;
    const max = bitsPerComponent === 16 ? 0xFFFF : 0xFF;

    if (bitsPerComponent === 16) {
        const bytes = new Uint8Array(pixelCount * channels * 2);
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const value = Math.round((x / Math.max(1, width - 1)) * max);
                const offset = (y * width + x) * channels * 2;
                for (let c = 0; c < channels; c++) {
                    bytes[offset + c * 2] = (value >> 8) & 0xFF;
                    bytes[offset + c * 2 + 1] = value & 0xFF;
                }
            }
        }
        return bytes;
    }

    const bytes = new Uint8Array(pixelCount * channels);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const value = Math.round((x / Math.max(1, width - 1)) * max);
            const offset = (y * width + x) * channels;
            bytes[offset] = value;
            bytes[offset + 1] = value;
            bytes[offset + 2] = value;
        }
    }
    return bytes;
}

/**
 * Generate a checkerboard pattern alternating between two colors.
 *
 * @param {number} width
 * @param {number} height
 * @param {[number, number, number]} color1 - RGB values (0-255 for 8-bit)
 * @param {[number, number, number]} color2 - RGB values (0-255 for 8-bit)
 * @param {8 | 16} bitsPerComponent
 * @returns {Uint8Array}
 */
export function generateCheckerboard(width, height, color1, color2, bitsPerComponent = 8) {
    const channels = 3;
    const pixelCount = width * height;
    const scale = bitsPerComponent === 16 ? 257 : 1; // 0xFF → 0xFFFF

    if (bitsPerComponent === 16) {
        const bytes = new Uint8Array(pixelCount * channels * 2);
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const color = ((x + y) % 2 === 0) ? color1 : color2;
                const offset = (y * width + x) * channels * 2;
                for (let c = 0; c < channels; c++) {
                    const value = color[c] * scale;
                    bytes[offset + c * 2] = (value >> 8) & 0xFF;
                    bytes[offset + c * 2 + 1] = value & 0xFF;
                }
            }
        }
        return bytes;
    }

    const bytes = new Uint8Array(pixelCount * channels);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const color = ((x + y) % 2 === 0) ? color1 : color2;
            const offset = (y * width + x) * channels;
            bytes[offset] = color[0];
            bytes[offset + 1] = color[1];
            bytes[offset + 2] = color[2];
        }
    }
    return bytes;
}

/**
 * Generate a grayscale ramp for single-channel images.
 *
 * @param {number} width
 * @param {number} height
 * @param {8 | 16} bitsPerComponent
 * @returns {Uint8Array}
 */
export function generateGrayscaleRamp(width, height, bitsPerComponent = 8) {
    const pixelCount = width * height;
    const max = bitsPerComponent === 16 ? 0xFFFF : 0xFF;

    if (bitsPerComponent === 16) {
        const bytes = new Uint8Array(pixelCount * 2);
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const value = Math.round((x / Math.max(1, width - 1)) * max);
                const offset = (y * width + x) * 2;
                bytes[offset] = (value >> 8) & 0xFF;
                bytes[offset + 1] = value & 0xFF;
            }
        }
        return bytes;
    }

    const bytes = new Uint8Array(pixelCount);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            bytes[y * width + x] = Math.round((x / Math.max(1, width - 1)) * max);
        }
    }
    return bytes;
}
