// @ts-check
/**
 * Traditional PostScript Color Converter
 *
 * Pure Float32 color conversion implementing PostScript's traditional
 * Device-color-space conversion formulas. Used when no ICC profile is
 * available for a Device source color space.
 *
 * PDF-agnostic. Extends `ColorConverter` for a uniform class contract
 * (configuration, diagnostics, policy, readiness). Does not use the
 * color engine — receives the parent's `colorEngineProvider` via
 * constructor options so the base-class initializer resolves
 * immediately without spinning up a separate WASM instance.
 *
 * Composed by `PDFImageColorConverter` and `PDFContentStreamColorConverter`.
 * Never instantiated directly by `worker-pool-entrypoint.js` — loaded
 * transitively inside the worker isolate via those classes' own imports.
 *
 * ## Scope
 *
 * **Input and output are always Float32Array in [0..1].** Bit-depth and
 * endianness resampling is the caller's responsibility — this class does
 * Device color space math and nothing else. The callers (`PDFImageColorConverter`
 * for buffers, `PDFContentStreamColorConverter` for operator tuples) already
 * own bit-depth and byte-order concerns through the shared descriptor
 * semantics provided by `ColorConversionPolicy`.
 *
 * ## Supported conversions
 *
 * | From → To   | Formula                                                                              |
 * | ----------- | ------------------------------------------------------------------------------------ |
 * | CMYK → RGB  | `R = 1 − min(1, C+K);  G = 1 − min(1, M+K);  B = 1 − min(1, Y+K)`                    |
 * | Gray → RGB  | `R = G = B = Gray`                                                                   |
 * | Gray → CMYK | `C = M = Y = 0;  K = 1 − Gray` (K-only)                                              |
 * | RGB → Gray  | NTSC luma: `0.299·R + 0.587·G + 0.114·B`                                             |
 * | CMYK → Gray | CMYK → RGB → NTSC luma (combined)                                                    |
 * | RGB → CMYK  | PostScript default BG/UCR: `K = min(1−R, 1−G, 1−B); C = 1−R−K; M = 1−G−K; Y = 1−B−K` |
 *
 * @module TraditionalPostScriptColorConverter
 * @author Saleh Abdel Motaal <dev@smotaal.io>
 * @ai Claude Opus 4.6 (code generation)
 */

import { ColorConverter } from './color-converter.js';

/**
 * @typedef {'RGB' | 'CMYK' | 'Gray'} DeviceColorType
 */

/**
 * Configuration for TraditionalPostScriptColorConverter.
 *
 * `sourceProfile` / `destinationProfile` from the base configuration are
 * ignored — TPS never consults ICC profiles. They remain in the typedef
 * for interchangeability with the ICC path through a shared contract.
 *
 * @typedef {import('./color-converter.js').ColorConverterConfiguration & {
 *   inputType?: DeviceColorType,
 * }} TraditionalPostScriptColorConverterConfiguration
 */

/**
 * Input for buffer-level conversion.
 *
 * @typedef {{
 *   pixelBuffer: Float32Array,
 *   width?: number,
 *   height?: number,
 *   colorSpace?: DeviceColorType,
 * }} TraditionalPostScriptColorConverterInput
 */

/**
 * Result of buffer-level conversion.
 *
 * @typedef {{
 *   pixelBuffer: Float32Array,
 *   width?: number,
 *   height?: number,
 *   colorSpace: DeviceColorType,
 *   pixelCount: number,
 *   inputChannels: number,
 *   outputChannels: number,
 * }} TraditionalPostScriptColorConverterResult
 */

/**
 * @extends ColorConverter
 */
export class TraditionalPostScriptColorConverter extends ColorConverter {
    /**
     * @param {TraditionalPostScriptColorConverterConfiguration} configuration
     * @param {object} [options]
     * @param {import('./color-engine-provider.js').ColorEngineProvider} [options.colorEngineProvider]
     *        Parent's provider (if available). Passed through to the base class so
     *        `#ready` resolves immediately — TPS itself never uses the provider.
     * @param {string} [options.engineVersion]
     * @param {string} [options.domain]
     */
    constructor(configuration, options = {}) {
        super(configuration, {
            colorEngineProvider: options.colorEngineProvider,
            engineVersion: options.engineVersion,
            domain: options.domain,
        });
    }

    /**
     * @returns {Readonly<TraditionalPostScriptColorConverterConfiguration>}
     */
    get configuration() {
        return /** @type {Readonly<TraditionalPostScriptColorConverterConfiguration>} */ (super.configuration);
    }

    // ========================================================================
    // Buffer-level conversion (image path)
    // ========================================================================

    /**
     * Convert a Float32 pixel buffer from one Device color space to another
     * using traditional PostScript math.
     *
     * @param {TraditionalPostScriptColorConverterInput} input
     * @param {import('./color-converter.js').ColorConverterContext} [_context]
     * @returns {Promise<TraditionalPostScriptColorConverterResult>}
     */
    async convertColor(input, _context = {}) {
        await this.ensureReady();

        const config = this.configuration;
        const inputColorSpace = /** @type {DeviceColorType} */ (input.colorSpace ?? config.inputType);
        const outputColorSpace = /** @type {DeviceColorType} */ (config.destinationColorSpace);

        if (!inputColorSpace) {
            throw new Error(
                'TraditionalPostScriptColorConverter: inputColorSpace is required ' +
                '(provide via input.colorSpace or config.inputType)',
            );
        }
        if (!outputColorSpace) {
            throw new Error(
                'TraditionalPostScriptColorConverter: destinationColorSpace is required in configuration',
            );
        }
        if (!(input.pixelBuffer instanceof Float32Array)) {
            throw new Error(
                'TraditionalPostScriptColorConverter: pixelBuffer must be Float32Array ' +
                '(bit-depth resampling is the caller\'s responsibility)',
            );
        }

        const inputChannels = TraditionalPostScriptColorConverter.#channelsOf(inputColorSpace);
        const outputChannels = TraditionalPostScriptColorConverter.#channelsOf(outputColorSpace);
        const pixelCount = Math.floor(input.pixelBuffer.length / inputChannels);

        // Short-circuit identity: source and destination color spaces match.
        // Bulk Float32Array.set is O(N); the per-pixel dispatch below would
        // redundantly invoke a function call per pixel for no numerical change.
        if (inputColorSpace === outputColorSpace) {
            const pixelBuffer = new Float32Array(pixelCount * outputChannels);
            pixelBuffer.set(input.pixelBuffer.subarray(0, pixelCount * inputChannels));
            return {
                pixelBuffer,
                width: input.width,
                height: input.height,
                colorSpace: outputColorSpace,
                pixelCount,
                inputChannels,
                outputChannels,
            };
        }

        const pixelBuffer = new Float32Array(pixelCount * outputChannels);
        const transform = TraditionalPostScriptColorConverter.#getTransform(inputColorSpace, outputColorSpace);
        for (let p = 0; p < pixelCount; p++) {
            transform(input.pixelBuffer, p * inputChannels, pixelBuffer, p * outputChannels);
        }

        return {
            pixelBuffer,
            width: input.width,
            height: input.height,
            colorSpace: outputColorSpace,
            pixelCount,
            inputChannels,
            outputChannels,
        };
    }

    // ========================================================================
    // Tuple-level conversion (content stream operator path)
    // ========================================================================

    /**
     * Convert a single color tuple using PostScript math.
     *
     * Inputs and outputs are Float32 values in [0..1]. Used by the content
     * stream converter for individual `k/K`, `rg/RG`, `g/G` operator operands.
     * Synchronous — no WASM, no buffers.
     *
     * @param {number[] | Float32Array} values
     * @param {{ inputColorSpace: DeviceColorType, outputColorSpace: DeviceColorType }} options
     * @returns {Float32Array}
     */
    convertTuple(values, options) {
        const { inputColorSpace, outputColorSpace } = options;
        const inputChannels = TraditionalPostScriptColorConverter.#channelsOf(inputColorSpace);
        const outputChannels = TraditionalPostScriptColorConverter.#channelsOf(outputColorSpace);

        if (values.length !== inputChannels) {
            throw new Error(
                `TraditionalPostScriptColorConverter: tuple length ${values.length} does not match ` +
                `${inputColorSpace} channel count ${inputChannels}`,
            );
        }

        const input = values instanceof Float32Array ? values : Float32Array.from(values);
        const output = new Float32Array(outputChannels);
        const transform = TraditionalPostScriptColorConverter.#getTransform(inputColorSpace, outputColorSpace);
        transform(input, 0, output, 0);
        return output;
    }

    // ========================================================================
    // Private: transform dispatch
    // ========================================================================

    /**
     * @param {DeviceColorType} src
     * @param {DeviceColorType} dst
     * @returns {(input: Float32Array, inOffset: number, output: Float32Array, outOffset: number) => void}
     */
    static #getTransform(src, dst) {
        if (src === dst) return TraditionalPostScriptColorConverter.#identity;
        const key = `${src}->${dst}`;
        switch (key) {
            case 'CMYK->RGB':  return TraditionalPostScriptColorConverter.#cmykToRgb;
            case 'Gray->RGB':  return TraditionalPostScriptColorConverter.#grayToRgb;
            case 'Gray->CMYK': return TraditionalPostScriptColorConverter.#grayToCmyk;
            case 'RGB->Gray':  return TraditionalPostScriptColorConverter.#rgbToGray;
            case 'CMYK->Gray': return TraditionalPostScriptColorConverter.#cmykToGray;
            case 'RGB->CMYK':  return TraditionalPostScriptColorConverter.#rgbToCmyk;
            default:
                throw new Error(`TraditionalPostScriptColorConverter: unsupported conversion ${key}`);
        }
    }

    /**
     * Identity transform used only by `convertTuple` (single-tuple path where
     * output.length equals the channel count). The `convertColor` buffer path
     * short-circuits identity via `Float32Array.prototype.set` before reaching
     * this dispatch — do NOT call this in a per-pixel loop over a multi-pixel
     * buffer; the length computation below only makes sense for a single tuple.
     *
     * @param {Float32Array} input   @param {number} inOffset
     * @param {Float32Array} output  @param {number} outOffset
     */
    static #identity(input, inOffset, output, outOffset) {
        const n = output.length - outOffset;
        for (let i = 0; i < n; i++) output[outOffset + i] = input[inOffset + i];
    }

    // ========================================================================
    // Private: per-pixel PostScript math (Float32, [0..1])
    // ========================================================================

    /**
     * `R = 1 − min(1, C + K);  G = 1 − min(1, M + K);  B = 1 − min(1, Y + K)`
     *
     * @param {Float32Array} input   @param {number} inOffset
     * @param {Float32Array} output  @param {number} outOffset
     */
    static #cmykToRgb(input, inOffset, output, outOffset) {
        const c = input[inOffset];
        const m = input[inOffset + 1];
        const y = input[inOffset + 2];
        const k = input[inOffset + 3];
        output[outOffset] = 1 - Math.min(1, c + k);
        output[outOffset + 1] = 1 - Math.min(1, m + k);
        output[outOffset + 2] = 1 - Math.min(1, y + k);
    }

    /**
     * `R = G = B = Gray`
     *
     * @param {Float32Array} input   @param {number} inOffset
     * @param {Float32Array} output  @param {number} outOffset
     */
    static #grayToRgb(input, inOffset, output, outOffset) {
        const g = input[inOffset];
        output[outOffset] = g;
        output[outOffset + 1] = g;
        output[outOffset + 2] = g;
    }

    /**
     * `C = M = Y = 0;  K = 1 − Gray` (K-only black)
     *
     * @param {Float32Array} input   @param {number} inOffset
     * @param {Float32Array} output  @param {number} outOffset
     */
    static #grayToCmyk(input, inOffset, output, outOffset) {
        const g = input[inOffset];
        output[outOffset] = 0;
        output[outOffset + 1] = 0;
        output[outOffset + 2] = 0;
        output[outOffset + 3] = 1 - g;
    }

    /**
     * NTSC luma: `Gray = 0.299·R + 0.587·G + 0.114·B`
     *
     * @param {Float32Array} input   @param {number} inOffset
     * @param {Float32Array} output  @param {number} outOffset
     */
    static #rgbToGray(input, inOffset, output, outOffset) {
        const r = input[inOffset];
        const g = input[inOffset + 1];
        const b = input[inOffset + 2];
        output[outOffset] = 0.299 * r + 0.587 * g + 0.114 * b;
    }

    /**
     * `CMYK → Gray` = CMYK → RGB → NTSC luma (combined into one step).
     *
     * @param {Float32Array} input   @param {number} inOffset
     * @param {Float32Array} output  @param {number} outOffset
     */
    static #cmykToGray(input, inOffset, output, outOffset) {
        const c = input[inOffset];
        const m = input[inOffset + 1];
        const y = input[inOffset + 2];
        const k = input[inOffset + 3];
        const r = 1 - Math.min(1, c + k);
        const g = 1 - Math.min(1, m + k);
        const b = 1 - Math.min(1, y + k);
        output[outOffset] = 0.299 * r + 0.587 * g + 0.114 * b;
    }

    /**
     * PostScript default black generation and undercolor removal:
     *
     * ```
     * C' = 1 − R;  M' = 1 − G;  Y' = 1 − B
     * K  = min(C', M', Y')          (default BG: identity on min complement)
     * C  = C' − K;  M = M' − K;  Y = Y' − K   (default UCR: subtract K)
     * ```
     *
     * Produces K-only black for neutrals (R=G=B) and removes equal CMY
     * wherever all three would overlap. Deterministic, intent-free,
     * matches PostScript Level 2 default transfer functions.
     *
     * @param {Float32Array} input   @param {number} inOffset
     * @param {Float32Array} output  @param {number} outOffset
     */
    static #rgbToCmyk(input, inOffset, output, outOffset) {
        const r = input[inOffset];
        const g = input[inOffset + 1];
        const b = input[inOffset + 2];
        const cPrime = 1 - r;
        const mPrime = 1 - g;
        const yPrime = 1 - b;
        const k = Math.min(cPrime, mPrime, yPrime);
        output[outOffset] = cPrime - k;
        output[outOffset + 1] = mPrime - k;
        output[outOffset + 2] = yPrime - k;
        output[outOffset + 3] = k;
    }

    // ========================================================================
    // Private: channel counts
    // ========================================================================

    /**
     * @param {DeviceColorType} cs
     * @returns {1 | 3 | 4}
     */
    static #channelsOf(cs) {
        switch (cs) {
            case 'Gray': return 1;
            case 'RGB':  return 3;
            case 'CMYK': return 4;
            default:
                throw new Error(`TraditionalPostScriptColorConverter: unsupported color space '${cs}'`);
        }
    }
}
