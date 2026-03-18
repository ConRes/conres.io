// @ts-check
/**
 * ColorEngineProvider - Thin WASM wrapper for LittleCMS color engine
 *
 * Provides lifecycle management and pass-through access to the color engine.
 * Uses dynamic import for version flexibility.
 *
 * IMPORTANT: This class does NOT provide fallback profiles (except Lab).
 * All ICCBased colorspaces (RGB, Gray, CMYK) require actual ICC profile data.
 * Lab is the only exception because it's device-independent (not ICCBased).
 *
 * @module ColorEngineProvider
 */

/**
 * @typedef {import('../../packages/color-engine/src/index.js').ColorEngine} ColorEngine
 */

/**
 * Color engine constants object.
 * @typedef {{
 *   TYPE_GRAY_8: number,
 *   TYPE_RGB_8: number,
 *   TYPE_BGR_8: number,
 *   TYPE_RGBA_8: number,
 *   TYPE_ARGB_8: number,
 *   TYPE_BGRA_8: number,
 *   TYPE_CMYK_8: number,
 *   TYPE_Lab_8: number,
 *   TYPE_GRAY_16: number,
 *   TYPE_GRAY_16_SE: number,
 *   TYPE_RGB_16: number,
 *   TYPE_RGB_16_SE: number,
 *   TYPE_BGR_16: number,
 *   TYPE_BGR_16_SE: number,
 *   TYPE_RGBA_16: number,
 *   TYPE_RGBA_16_SE: number,
 *   TYPE_CMYK_16: number,
 *   TYPE_CMYK_16_SE: number,
 *   TYPE_Lab_16: number,
 *   TYPE_GRAY_FLT: number,
 *   TYPE_RGB_FLT: number,
 *   TYPE_CMYK_FLT: number,
 *   TYPE_Lab_FLT: number,
 *   INTENT_PERCEPTUAL: number,
 *   INTENT_RELATIVE_COLORIMETRIC: number,
 *   INTENT_SATURATION: number,
 *   INTENT_ABSOLUTE_COLORIMETRIC: number,
 *   INTENT_PRESERVE_K_ONLY_RELATIVE_COLORIMETRIC_GCR: number,
 *   cmsFLAGS_BLACKPOINTCOMPENSATION: number,
 *   cmsFLAGS_NOCACHE: number,
 *   cmsFLAGS_NOOPTIMIZE: number,
 *   cmsFLAGS_MULTIPROFILE_BPC_SCALING: number,
 * }} ColorEngineConstants
 */

/**
 * Default engine path (symlink to active version)
 */
const DEFAULT_ENGINE_PATH = '../../packages/color-engine/src/index.js';

// ============================================================================
// Endianness Detection
// ============================================================================

/**
 * JavaScript runtime endianness detection.
 * Tests how multi-byte integers are stored in ArrayBuffer.
 * @type {'little' | 'big'}
 */
const RUNTIME_ENDIANNESS = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1 ? 'little' : 'big';

/**
 * WebAssembly linear memory endianness detection.
 * Tests how multi-byte integers are stored in WASM memory.
 *
 * Note: WASM is always little-endian in practice, but we detect it explicitly to:
 * - Document the assumption in code
 * - Future-proof against hypothetical big-endian WASM runtimes
 * - Make the logic self-documenting and verifiable
 *
 * @type {'little' | 'big'}
 */
const WEB_ASSEMBLY_ENDIANNESS = (() => {
    const memory = new WebAssembly.Memory({ initial: 1 });
    const view32 = new Uint32Array(memory.buffer);
    const view8 = new Uint8Array(memory.buffer);
    view32[0] = 1;
    return view8[0] === 1 ? 'little' : 'big';
})();

// Import VERSION from the symlinked color engine
import { VERSION as COLOR_ENGINE_VERSION } from '../../packages/color-engine/src/index.js';

// Import constants from the constants module (must always come from here, not index.js)
import { cmsFLAGS_MULTIPROFILE_BPC_SCALING } from '../../packages/color-engine/src/constants.js';

/**
 * Default engine version identifier derived from the symlinked color-engine package.
 * Used for policy rule matching.
 * @type {string}
 */
const DEFAULT_ENGINE_VERSION = `color-engine-${COLOR_ENGINE_VERSION}`;

/**
 * Thin wrapper providing lifecycle management for the LittleCMS WASM engine.
 *
 * This class:
 * - Uses dynamic import for version flexibility
 * - Provides pass-through access to ColorEngine methods
 * - Enforces the "no fallback profiles" policy (except Lab)
 * - Re-exports LittleCMS constants
 */
export class ColorEngineProvider {
    // =========================================================================
    // Static Endianness Properties
    // =========================================================================

    /**
     * JavaScript runtime endianness.
     * @returns {'little' | 'big'}
     */
    static get RUNTIME_ENDIANNESS() {
        return RUNTIME_ENDIANNESS;
    }

    /**
     * WebAssembly memory endianness.
     * Used by ColorConversionPolicy to determine if TYPE_*_SE formats are needed.
     * @returns {'little' | 'big'}
     */
    static get WEB_ASSEMBLY_ENDIANNESS() {
        return WEB_ASSEMBLY_ENDIANNESS;
    }

    // =========================================================================
    // Instance Properties
    // =========================================================================

    /** @type {ColorEngine | null} */
    #engine = null;

    /** @type {Promise<void> | null} */
    #initPromise = null;

    /** @type {string} */
    #enginePath;

    /** @type {typeof import('../../packages/color-engine/src/index.js') | null} */
    #module = null;

    /** @type {Map<string, ArrayBuffer>} */
    #profileBufferCache = new Map();

    /**
     * Creates a new ColorEngineProvider instance.
     *
     * @param {object} [options]
     * @param {string} [options.enginePath] - Path to color engine module (for version selection)
     */
    constructor(options = {}) {
        this.#enginePath = options.enginePath || DEFAULT_ENGINE_PATH;
    }

    /**
     * Initializes the WASM color engine.
     * Safe to call multiple times - subsequent calls return the same promise.
     *
     * @returns {Promise<void>}
     */
    async initialize() {
        if (this.#initPromise) {
            return this.#initPromise;
        }

        this.#initPromise = this.#doInitialize();
        return this.#initPromise;
    }

    /**
     * Internal initialization logic.
     * @returns {Promise<void>}
     */
    async #doInitialize() {
        // Dynamic import for version flexibility
        // console.trace(`Loading color engine from ${this.#enginePath}...`);
        this.#module = await import(this.#enginePath);
        this.#engine = await this.#module.createEngine();
    }

    /**
     * Ensures the engine is initialized before use.
     * @throws {Error} If engine is not initialized
     */
    #ensureReady() {
        if (!this.#engine) {
            throw new Error('ColorEngineProvider not initialized. Call initialize() first.');
        }
    }

    /**
     * Gets the underlying ColorEngine instance.
     * @returns {ColorEngine}
     * @throws {Error} If not initialized
     */
    get engine() {
        this.#ensureReady();
        return /** @type {ColorEngine} */ (this.#engine);
    }

    /**
     * Gets the loaded module (for constant access).
     * @returns {typeof import('../../packages/color-engine/src/index.js')}
     * @throws {Error} If not initialized
     */
    get module() {
        if (!this.#module) {
            throw new Error('ColorEngineProvider not initialized. Call initialize() first.');
        }
        return this.#module;
    }

    /**
     * Whether the engine is initialized and ready.
     * @returns {boolean}
     */
    get isReady() {
        return this.#engine !== null;
    }

    // =========================================================================
    // Profile Methods
    // =========================================================================

    /**
     * Opens an ICC profile from memory buffer.
     *
     * @param {ArrayBuffer | Uint8Array} buffer - ICC profile data
     * @returns {number} Profile handle
     * @throws {Error} If buffer is not valid ICC profile data
     */
    openProfileFromMem(buffer) {
        this.#ensureReady();
        const data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
        return this.engine.openProfileFromMem(data);
    }

    /**
     * Creates a Lab D50 profile.
     *
     * Lab is device-independent and not an ICCBased colorspace in PDF,
     * so it never has an embedded ICC profile.
     *
     * @returns {number} Profile handle
     */
    createLab4Profile() {
        this.#ensureReady();
        return this.engine.createLab4Profile();
    }

    /**
     * Creates an sRGB profile.
     *
     * sRGB is the standard RGB working space used as an intermediate
     * for multiprofile transforms (e.g., Gray → sRGB → CMYK for K-Only GCR).
     *
     * @returns {number} Profile handle
     */
    createSRGBProfile() {
        this.#ensureReady();
        return this.engine.createSRGBProfile();
    }

    /**
     * Closes a profile handle.
     *
     * @param {number} handle - Profile handle to close
     */
    closeProfile(handle) {
        this.#ensureReady();
        this.engine.closeProfile(handle);
    }

    /**
     * Loads an ICC profile from a URL into an ArrayBuffer.
     *
     * Accepts an absolute URL string (as resolved by ColorConversionPolicy)
     * or an ArrayBuffer (returned as-is). Results are cached by URL.
     *
     * @param {string | ArrayBuffer} source - Absolute URL or raw profile data
     * @returns {Promise<ArrayBuffer>} Loaded profile buffer
     */
    async loadProfile(source) {
        if (source instanceof ArrayBuffer) {
            return source;
        }

        // Check cache
        if (this.#profileBufferCache.has(source)) {
            return /** @type {ArrayBuffer} */ (this.#profileBufferCache.get(source));
        }

        let rawBuffer;
        let response = null;
        const sourceURL = new URL(source);
        const fs = await import('fs/promises').catch(() => null);

        if (fs) rawBuffer = await fs?.readFile?.(sourceURL);
        if (!rawBuffer) rawBuffer = await (response = await globalThis?.fetch?.(source)).arrayBuffer?.();
        if (!rawBuffer || (response !== null && !response.ok)) throw new Error(`Failed to load ICC profile from ${source}: ${response?.statusText ?? 'fs/promises not available'}`);

        // Ensure ArrayBuffer (Node.js fs.readFile returns Buffer)
        const buffer = rawBuffer instanceof ArrayBuffer
            ? rawBuffer
            : rawBuffer.buffer.slice(rawBuffer.byteOffset, rawBuffer.byteOffset + rawBuffer.byteLength);

        this.#profileBufferCache.set(source, buffer);
        return buffer;
    }

    // =========================================================================
    // Transform Methods
    // =========================================================================

    /**
     * Creates a color transform between two profiles.
     *
     * @param {number} inputProfile - Input profile handle
     * @param {number} inputFormat - Input pixel format (TYPE_* constant)
     * @param {number} outputProfile - Output profile handle
     * @param {number} outputFormat - Output pixel format (TYPE_* constant)
     * @param {number} intent - Rendering intent (INTENT_* constant)
     * @param {number} flags - Transform flags (cmsFLAGS_* constants)
     * @returns {number} Transform handle
     */
    createTransform(inputProfile, inputFormat, outputProfile, outputFormat, intent, flags) {
        this.#ensureReady();
        return this.engine.createTransform(
            inputProfile,
            inputFormat,
            outputProfile,
            outputFormat,
            intent,
            flags
        );
    }

    /**
     * Creates a multiprofile transform (for Gray -> sRGB -> CMYK chains).
     *
     * @param {number[]} profiles - Array of profile handles
     * @param {number} inputFormat - Input pixel format
     * @param {number} outputFormat - Output pixel format
     * @param {number} intent - Rendering intent (applied to all profile pairs)
     * @param {number} flags - Transform flags
     * @returns {number} Transform handle
     */
    createMultiprofileTransform(profiles, inputFormat, outputFormat, intent, flags) {
        this.#ensureReady();
        if (!this.engine.createMultiprofileTransform) {
            throw new Error('createMultiprofileTransform not available in this engine version');
        }
        return this.engine.createMultiprofileTransform(
            profiles,
            inputFormat,
            outputFormat,
            intent,
            flags
        );
    }

    /**
     * Deletes a transform handle.
     *
     * @param {number} transform - Transform handle to delete
     */
    deleteTransform(transform) {
        this.#ensureReady();
        this.engine.deleteTransform(transform);
    }

    // =========================================================================
    // Pixel Transformation Methods
    // =========================================================================

    /**
     * Transforms an array of pixels.
     *
     * @param {number} transform - Transform handle
     * @param {Uint8Array | Uint16Array | Float32Array} inputBuffer - Input pixel data
     * @param {Uint8Array | Uint16Array | Float32Array} outputBuffer - Output pixel data
     * @param {number} pixelCount - Number of pixels to transform
     */
    transformArray(transform, inputBuffer, outputBuffer, pixelCount) {
        this.#ensureReady();
        this.engine.transformArray(transform, inputBuffer, outputBuffer, pixelCount);
    }

    /**
     * Initializes BPC clamping optimization for a transform.
     * Optional - only available in engines with adaptive BPC support.
     *
     * @param {number} transform - Transform handle
     * @param {number} inputChannels - Number of input channels
     * @param {number} outputChannels - Number of output channels
     * @returns {boolean} Whether initialization succeeded
     */
    initBPCClamping(transform, inputChannels, outputChannels) {
        this.#ensureReady();
        if (!this.engine.initBPCClamping) {
            return false;
        }
        this.engine.initBPCClamping(transform, inputChannels, outputChannels);
        return true;
    }

    /**
     * Transforms pixels with adaptive BPC clamping.
     * Optional - only available in engines with adaptive BPC support.
     *
     * @param {number} transform - Transform handle
     * @param {Uint8Array | Uint16Array | Float32Array} inputBuffer - Input pixel data
     * @param {Uint8Array | Uint16Array | Float32Array} outputBuffer - Output pixel data
     * @param {number} pixelCount - Number of pixels to transform
     * @returns {object | null} BPC statistics, or null if not available
     */
    doTransformAdaptive(transform, inputBuffer, outputBuffer, pixelCount) {
        this.#ensureReady();
        if (!this.engine.doTransformAdaptive) {
            // Fall back to regular transform
            this.engine.transformArray(transform, inputBuffer, outputBuffer, pixelCount);
            return null;
        }
        return this.engine.doTransformAdaptive(transform, inputBuffer, outputBuffer, pixelCount);
    }

    // =========================================================================
    // Lifecycle
    // =========================================================================

    /**
     * Disposes of the color engine and releases resources.
     */
    dispose() {
        this.#engine = null;
        this.#module = null;
        this.#initPromise = null;
    }

    // =========================================================================
    // Constants (accessed via module after initialization)
    // =========================================================================

    /**
     * Gets all exported constants from the color engine module.
     * Must be called after initialize().
     *
     * @returns {ColorEngineConstants} Object containing all TYPE_*, INTENT_*, and cmsFLAGS_* constants
     */
    getConstants() {
        if (!this.#module) {
            throw new Error('ColorEngineProvider not initialized. Call initialize() first.');
        }

        // Extract relevant constants from the module
        return {
            // Pixel formats - 8-bit
            TYPE_GRAY_8: this.#module.TYPE_GRAY_8,
            TYPE_RGB_8: this.#module.TYPE_RGB_8,
            TYPE_BGR_8: this.#module.TYPE_BGR_8,
            TYPE_RGBA_8: this.#module.TYPE_RGBA_8,
            TYPE_ARGB_8: this.#module.TYPE_ARGB_8,
            TYPE_BGRA_8: this.#module.TYPE_BGRA_8,
            TYPE_CMYK_8: this.#module.TYPE_CMYK_8,
            TYPE_Lab_8: this.#module.TYPE_Lab_8,

            // Pixel formats - 16-bit
            TYPE_GRAY_16: this.#module.TYPE_GRAY_16,
            TYPE_GRAY_16_SE: this.#module.TYPE_GRAY_16_SE,
            TYPE_RGB_16: this.#module.TYPE_RGB_16,
            TYPE_RGB_16_SE: this.#module.TYPE_RGB_16_SE,
            TYPE_BGR_16: this.#module.TYPE_BGR_16,
            TYPE_BGR_16_SE: this.#module.TYPE_BGR_16_SE,
            TYPE_RGBA_16: this.#module.TYPE_RGBA_16,
            TYPE_RGBA_16_SE: this.#module.TYPE_RGBA_16_SE,
            TYPE_CMYK_16: this.#module.TYPE_CMYK_16,
            TYPE_CMYK_16_SE: this.#module.TYPE_CMYK_16_SE,
            TYPE_Lab_16: this.#module.TYPE_Lab_16,

            // Pixel formats - float
            TYPE_GRAY_FLT: this.#module.TYPE_GRAY_FLT,
            TYPE_RGB_FLT: this.#module.TYPE_RGB_FLT,
            TYPE_CMYK_FLT: this.#module.TYPE_CMYK_FLT,
            TYPE_Lab_FLT: this.#module.TYPE_Lab_FLT,

            // Rendering intents
            INTENT_PERCEPTUAL: this.#module.INTENT_PERCEPTUAL,
            INTENT_RELATIVE_COLORIMETRIC: this.#module.INTENT_RELATIVE_COLORIMETRIC,
            INTENT_SATURATION: this.#module.INTENT_SATURATION,
            INTENT_ABSOLUTE_COLORIMETRIC: this.#module.INTENT_ABSOLUTE_COLORIMETRIC,
            INTENT_PRESERVE_K_ONLY_RELATIVE_COLORIMETRIC_GCR: this.#module.INTENT_PRESERVE_K_ONLY_RELATIVE_COLORIMETRIC_GCR,

            // Flags
            cmsFLAGS_BLACKPOINTCOMPENSATION: this.#module.cmsFLAGS_BLACKPOINTCOMPENSATION,
            cmsFLAGS_NOCACHE: this.#module.cmsFLAGS_NOCACHE,
            cmsFLAGS_NOOPTIMIZE: this.#module.cmsFLAGS_NOOPTIMIZE,
            cmsFLAGS_MULTIPROFILE_BPC_SCALING: this.#module.cmsFLAGS_MULTIPROFILE_BPC_SCALING ?? cmsFLAGS_MULTIPROFILE_BPC_SCALING,
        };
    }
}

// Re-export default engine path and version for consumers who need it
export { DEFAULT_ENGINE_PATH, DEFAULT_ENGINE_VERSION };

// Export endianness constants for use by ColorConversionPolicy
export { RUNTIME_ENDIANNESS, WEB_ASSEMBLY_ENDIANNESS };
