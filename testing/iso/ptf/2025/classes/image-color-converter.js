// @ts-check
/**
 * Image Color Converter
 *
 * Extends ColorConverter to handle pixel buffer color conversion.
 * Integrates with ColorEngineService for actual transformation.
 *
 * @module ImageColorConverter
 */

import { ColorConverter } from './color-converter.js';
import {
    TYPE_RGB_8,
    TYPE_CMYK_8,
    TYPE_GRAY_8,
    TYPE_Lab_8,
    TYPE_Lab_16,
    INTENT_PERCEPTUAL,
    INTENT_RELATIVE_COLORIMETRIC,
    INTENT_SATURATION,
    INTENT_ABSOLUTE_COLORIMETRIC,
    INTENT_PRESERVE_K_ONLY_RELATIVE_COLORIMETRIC_GCR,
    cmsFLAGS_BLACKPOINTCOMPENSATION,
} from '../packages/color-engine/src/index.js';

// ============================================================================
// Type Definitions
// ============================================================================


/**
 * Configuration for ImageColorConverter.
 *
 * IMPORTANT: No fallback profiles. All colorspaces except Lab require
 * actual ICC profile data (ArrayBuffer).
 *
 * @typedef {import('./color-converter.js').ColorConverterConfiguration & {
 *   sourceProfile?: ArrayBuffer | 'Lab',
 *   inputType: import('./color-converter.js').ColorType,
 * }} ImageColorConverterConfiguration
 */

/**
 * Input data for image conversion.
 *
 * Bit depth parameters:
 * - `bitsPerComponent`: Fallback for both input and output
 * - `inputBitsPerComponent`: Explicit bit depth for input (overrides bitsPerComponent)
 * - `outputBitsPerComponent`: Explicit bit depth for output (overrides bitsPerComponent)
 *
 * Endianness parameters (conditional on bit depth):
 * - `endianness`: Fallback for both input and output
 * - `inputEndianness`: Explicit endianness for input (overrides endianness)
 * - `outputEndianness`: Explicit endianness for output (overrides endianness)
 *
 * Endianness is required for 16-bit, ignored for 8-bit, warns if specified for 32-bit.
 *
 * @typedef {{
 *   pixelBuffer: Uint8Array | Uint16Array | Float32Array,
 *   width: number,
 *   height: number,
 *   colorSpace?: import('./color-converter.js').ColorType,
 *   bitsPerComponent?: import('./color-conversion-policy.js').BitDepth,
 *   inputBitsPerComponent?: import('./color-conversion-policy.js').BitDepth,
 *   outputBitsPerComponent?: import('./color-conversion-policy.js').BitDepth,
 *   endianness?: import('./color-conversion-policy.js').Endianness,
 *   inputEndianness?: import('./color-conversion-policy.js').Endianness,
 *   outputEndianness?: import('./color-conversion-policy.js').Endianness,
 *   sourceProfile?: ArrayBuffer | 'Lab',
 * }} ImageColorConverterInput
 */

/**
 * Result of image conversion.
 *
 * @typedef {{
 *   pixelBuffer: Uint8Array | Uint16Array | Float32Array,
 *   width: number,
 *   height: number,
 *   colorSpace: import('./color-converter.js').ColorType,
 *   bitsPerComponent: import('./color-conversion-policy.js').BitDepth,
 *   pixelCount: number,
 * }} ImageColorConverterResult
 */

// ============================================================================
// Constants (Legacy - kept for backward compatibility)
// ============================================================================

/**
 * Color engine pixel format constants (from LittleCMS).
 * @deprecated Use ColorConversionPolicy.getInputFormat() / getOutputFormat() instead.
 */
export const PIXEL_FORMATS = {
    TYPE_RGB_8,
    TYPE_CMYK_8,
    TYPE_GRAY_8,
    TYPE_Lab_8,
    TYPE_Lab_16,
};

/**
 * Rendering intent constants.
 * @deprecated Use ColorConversionPolicy.getRenderingIntentConstant() instead.
 */
export const RENDERING_INTENTS = {
    PERCEPTUAL: INTENT_PERCEPTUAL,
    RELATIVE_COLORIMETRIC: INTENT_RELATIVE_COLORIMETRIC,
    SATURATION: INTENT_SATURATION,
    ABSOLUTE_COLORIMETRIC: INTENT_ABSOLUTE_COLORIMETRIC,
    PRESERVE_K_ONLY_RELATIVE_COLORIMETRIC_GCR: INTENT_PRESERVE_K_ONLY_RELATIVE_COLORIMETRIC_GCR,
};

/**
 * Color engine flags.
 * @deprecated Use ColorEngineProvider.getConstants() instead.
 */
export const ENGINE_FLAGS = {
    BLACKPOINT_COMPENSATION: cmsFLAGS_BLACKPOINTCOMPENSATION,
};

/**
 * Mapping from rendering intent string to numeric value.
 * @deprecated Use ColorConversionPolicy.getRenderingIntentConstant() instead.
 */
export const INTENT_MAP = {
    'perceptual': RENDERING_INTENTS.PERCEPTUAL,
    'relative-colorimetric': RENDERING_INTENTS.RELATIVE_COLORIMETRIC,
    'saturation': RENDERING_INTENTS.SATURATION,
    'absolute-colorimetric': RENDERING_INTENTS.ABSOLUTE_COLORIMETRIC,
    'preserve-k-only-relative-colorimetric-gcr': RENDERING_INTENTS.PRESERVE_K_ONLY_RELATIVE_COLORIMETRIC_GCR,
};

/**
 * Mapping from color type to channel count.
 */
const COLOR_TYPE_TO_CHANNELS = {
    'RGB': 3,
    'Gray': 1,
    'Lab': 3,
    'CMYK': 4,
};

// ============================================================================
// ImageColorConverter Class
// ============================================================================

/**
 * Converts pixel buffer color data using ICC profiles.
 *
 * Extends ColorConverter and integrates with ColorEngineService
 * for actual transformation.
 *
 * Key features:
 * - Handles RGB, Gray, Lab, and CMYK input types
 * - Lab images automatically use Relative Colorimetric (not K-Only GCR)
 * - Efficient buffer management for large pixel arrays
 *
 * @extends ColorConverter
 * @example
 * ```javascript
 * const converter = new ImageColorConverter({
 *     renderingIntent: 'relative-colorimetric',
 *     blackPointCompensation: true,
 *     destinationProfile: cmykProfileBuffer,
 *     destinationColorSpace: 'CMYK',
 *     inputType: 'RGB',
 *     verbose: false,
 * });
 *
 * const result = await converter.convertColor({
 *     pixelBuffer: rgbPixels,
 *     width: 1920,
 *     height: 1080,
 * });
 * ```
 */
export class ImageColorConverter extends ColorConverter {
    // ========================================
    // Constructor
    // ========================================

    /**
     * Creates a new ImageColorConverter instance.
     *
     * @param {ImageColorConverterConfiguration} configuration - Immutable configuration
     * @param {object} [options={}] - Additional options
     * @param {import('./color-engine-provider.js').ColorEngineProvider} [options.colorEngineProvider] - Shared ColorEngineProvider
     * @param {import('./color-conversion-policy.js').ColorConversionPolicy} [options.policy] - Custom conversion policy
     * @param {string} [options.engineVersion] - Color engine version for policy rules
     * @param {string} [options.domain] - Domain context for policy severity
     * @param {import('../services/ColorEngineService.js').ColorEngineService} [options.colorEngineService] - Shared ColorEngineService (backward compat)
     */
    constructor(configuration, options = {}) {
        super(configuration, options);
    }

    // ========================================
    // Configuration Access
    // ========================================

    /**
     * Gets the configuration as ImageColorConverterConfiguration.
     * @returns {Readonly<ImageColorConverterConfiguration>}
     */
    get configuration() {
        return /** @type {Readonly<ImageColorConverterConfiguration>} */ (super.configuration);
    }

    /**
     * Gets the input color type.
     * @returns {import('./color-converter.js').ColorType}
     */
    get inputType() {
        return this.configuration.inputType;
    }

    /**
     * Gets the effective rendering intent for a given input type.
     * K-Only GCR doesn't work for:
     * - Lab images (produces incorrect K=1 output)
     * - RGB destination (K-Only GCR is CMYK-specific, no K channel in RGB)
     *
     * @param {import('./color-converter.js').ColorType} colorType - Input color type
     * @returns {import('./color-converter.js').RenderingIntent} Effective rendering intent
     */
    getEffectiveRenderingIntent(colorType) {
        const intent = this.configuration.renderingIntent;
        const destCS = this.configuration.destinationColorSpace;

        // K-Only GCR doesn't work for Lab → any, or any → RGB
        if (intent === 'preserve-k-only-relative-colorimetric-gcr') {
            if (colorType === 'Lab' || destCS === 'RGB') {
                return 'relative-colorimetric';
            }
        }

        return intent;
    }

    // ========================================
    // Color Conversion
    // ========================================

    /**
     * Converts pixel buffer from source color space to destination.
     *
     * @param {ImageColorConverterInput} input - Image data to convert
     * @returns {Promise<ImageColorConverterResult>} Converted image data
     */
    async convertColor(input) {
        await this.ensureReady();

        const config = this.configuration;
        const colorType = input.colorSpace || config.inputType;
        const { pixelBuffer, width, height } = input;
        const pixelCount = width * height;

        // Extract bit depth and endianness parameters (pass through for late defaulting)
        const {
            bitsPerComponent = 8,
            inputBitsPerComponent,
            outputBitsPerComponent,
            endianness,
            inputEndianness,
            outputEndianness,
        } = input;

        // Determine source profile (NO FALLBACKS except Lab)
        const sourceProfile = input.sourceProfile ?? config.sourceProfile;

        if (!sourceProfile && colorType !== 'Lab') {
            throw new Error(
                `Source ICC profile is required for ${colorType} conversion - no fallback profiles allowed. ` +
                `Only Lab colorspace is supported without an explicit profile.`
            );
        }

        // Get effective rendering intent (Lab requires fallback from K-Only GCR)
        const effectiveIntent = this.getEffectiveRenderingIntent(colorType);

        // Log if verbose
        if (config.verbose) {
            const effectiveInputBits = inputBitsPerComponent ?? bitsPerComponent;
            console.log(`[ImageColorConverter] Converting ${pixelCount} pixels (${width}×${height})`);
            console.log(`  Input: ${colorType}, Output: ${config.destinationColorSpace}`);
            console.log(`  Intent: ${effectiveIntent} (requested: ${config.renderingIntent})`);
            console.log(`  Input bits: ${effectiveInputBits}, Output bits: ${outputBitsPerComponent ?? bitsPerComponent}`);
        }

        // Use parent's convertColorsBuffer for actual conversion
        // Pass all parameters through - let policy handle late defaulting and validation
        const result = await this.convertColorsBuffer(pixelBuffer, {
            inputColorSpace: colorType,
            outputColorSpace: config.destinationColorSpace,
            sourceProfile: /** @type {ArrayBuffer | 'Lab'} */ (sourceProfile ?? 'Lab'), // Lab is the only allowed "built-in"
            destinationProfile: config.destinationProfile,
            renderingIntent: effectiveIntent,
            blackPointCompensation: config.blackPointCompensation,
            bitsPerComponent: /** @type {import('./color-conversion-policy.js').BitDepth} */ (bitsPerComponent),
            inputBitsPerComponent,
            outputBitsPerComponent,
            endianness,
            inputEndianness,
            outputEndianness,
        });

        // Determine effective output bit depth for result
        const effectiveOutputBits = outputBitsPerComponent ?? bitsPerComponent;

        return {
            pixelBuffer: result.outputPixels,
            width,
            height,
            colorSpace: config.destinationColorSpace,
            bitsPerComponent: /** @type {import('./color-conversion-policy.js').BitDepth} */ (effectiveOutputBits),
            pixelCount: result.pixelCount,
        };
    }

    /**
     * Converts image pixel buffer - alias for convertColor.
     *
     * This method exists for compatibility with subclasses that
     * call convertImageColor explicitly.
     *
     * @param {ImageColorConverterInput} input - Image data to convert
     * @param {import('./color-converter.js').ColorConverterContext} [context={}] - Conversion context (unused)
     * @returns {Promise<ImageColorConverterResult>} Converted image data
     */
    async convertImageColor(input, context = {}) {
        return this.convertColor(input);
    }

    // ========================================
    // Worker Mode Support
    // ========================================

    /**
     * @override
     * @returns {boolean}
     */
    get supportsWorkerMode() {
        return true;
    }

    /**
     * Prepares a task for worker thread execution.
     *
     * @override
     * @param {ImageColorConverterInput} input
     * @param {import('./color-converter.js').ColorConverterContext} context
     * @returns {import('./color-converter.js').WorkerTask}
     */
    prepareWorkerTask(input, context) {
        const config = this.configuration;
        const colorType = input.colorSpace || config.inputType;
        const sourceProfile = input.sourceProfile ?? config.sourceProfile;

        // Validate source profile (NO FALLBACKS except Lab)
        if (!sourceProfile && colorType !== 'Lab') {
            throw new Error(
                `Source ICC profile is required for ${colorType} worker task - no fallback profiles allowed.`
            );
        }

        // Extract bit depth and endianness parameters (pass through for late defaulting in worker)
        const {
            bitsPerComponent = 8,
            inputBitsPerComponent,
            outputBitsPerComponent,
            endianness,
            inputEndianness,
            outputEndianness,
        } = input;

        return {
            type: 'image',
            pixelBuffer: input.pixelBuffer.buffer,
            width: input.width,
            height: input.height,
            colorSpace: colorType,
            bitsPerComponent,
            inputBitsPerComponent,
            outputBitsPerComponent,
            endianness,
            inputEndianness,
            outputEndianness,
            sourceProfile: sourceProfile ?? 'Lab', // Lab is the only allowed "built-in"
            destinationProfile: config.destinationProfile,
            renderingIntent: this.getEffectiveRenderingIntent(colorType),
            blackPointCompensation: config.blackPointCompensation,
            destinationColorSpace: config.destinationColorSpace,
        };
    }

    // ========================================
    // Resource Cleanup
    // ========================================

    /**
     * @override
     */
    dispose() {
        super.dispose();
    }
}
