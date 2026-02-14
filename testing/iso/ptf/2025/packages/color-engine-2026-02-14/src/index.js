// @ts-check
/// <reference types="emscripten" />
/**
 * @fileoverview Color Engine - WebAssembly wrapper for Little-CMS
 * Provides lcms-wasm parity with support for K-Only Blackpoint Compensation + GCR algorithm
 * @module @conres/color-engine
 */

import createColorEngine from '../dist/color-engine.js';
import {
  TYPE_GRAY_8,
  TYPE_GRAY_16,
  TYPE_GRAY_FLT,
  TYPE_RGB_8,
  TYPE_RGB_16,
  TYPE_RGBA_8,
  TYPE_RGB_FLT,
  TYPE_CMYK_8,
  TYPE_CMYK_16,
  TYPE_CMYK_FLT,
  TYPE_Lab_8,
  TYPE_Lab_16,
  TYPE_Lab_FLT,
} from './constants.js';
export * from './constants.js';

/** @typedef {number} PointerType */

/** @type {(instance: ColorEngine) => EmscriptenModule} */
export let getEmscriptenModuleForColorEngineInstance;

/**
 * Color Engine class - wraps Little-CMS WebAssembly module
 */
export class ColorEngine {
  /** @type {EmscriptenModule?} */
  #module = null;

  /** @type {boolean} */
  #ready = false;

  static {
    // Provide access to the WASM module for debugging/investigation
    getEmscriptenModuleForColorEngineInstance = instance => instance.#module;
  }

  constructor() {
    this.#ready = false;
  }

  /**
   * Initialize the WebAssembly module
   * @returns {Promise<void>}
   */
  async init() {
    if (this.#ready) return;

    this.#module = /** @type {EmscriptenModule?} */(await createColorEngine());
    this.#ready = true;
  }

  /**
   * Ensure module is initialized
   */
  #ensureReady() {
    if (!this.#ready || !this.#module) {
      throw new Error('ColorEngine not initialized. Call init() first.');
    }
  }

  /**
   * Allocate memory in WASM heap
   * @param {number} size - Number of bytes to allocate
   * @returns {PointerType} Pointer to allocated memory
   */
  malloc(size) {
    this.#ensureReady();
    return this.#module._malloc(size);
  }

  /**
   * Free memory in WASM heap
   * @param {PointerType} ptr - Pointer to free
   */
  free(ptr) {
    this.#ensureReady();
    this.#module._free(ptr);
  }

  /**
   * Open ICC profile from memory buffer
   * @param {Uint8Array} buffer - ICC profile data
   * @returns {PointerType} Profile handle
   * @note Using cwrap with 'array' type - handles memory marshaling correctly
   */
  openProfileFromMem(buffer) {
    this.#ensureReady();
    return this.#module.openProfileFromMem(buffer, buffer.length);
  }

  /**
   * Close ICC profile
   * @param {PointerType} profile - Profile handle
   */
  closeProfile(profile) {
    this.#ensureReady();
    this.#module.closeProfile(profile);
  }

  /**
   * Create color transform
   * @param {PointerType} inputProfile - Input profile handle
   * @param {number} inputFormat - Input pixel format
   * @param {PointerType} outputProfile - Output profile handle
   * @param {number} outputFormat - Output pixel format
   * @param {number} intent - Rendering intent
   * @param {number} flags - Transform flags
   * @returns {PointerType} Transform handle
   */
  createTransform(inputProfile, inputFormat, outputProfile, outputFormat, intent, flags) {
    this.#ensureReady();
    return this.#module.createTransform(
      inputProfile,
      inputFormat,
      outputProfile,
      outputFormat,
      intent,
      flags
    );
  }

  /**
   * Create multiprofile color transform
   *
   * Chains multiple ICC profiles in a single transform pipeline for SIMD-optimized
   * conversions. This is the unified entry point that handles ALL multiprofile cases:
   *
   * **Features:**
   * - Standard intents (RELATIVE_COLORIMETRIC, PERCEPTUAL, etc.) for any profile chain
   * - Gray workaround: Automatically handles Gray (PT_GRAY) in 3+ profile chains
   *   (LittleCMS natively only supports Gray in 2-profile transforms)
   * - K-Only GCR: When `INTENT_PRESERVE_K_ONLY_RELATIVE_COLORIMETRIC_GCR` is used
   *   with CMYK output, produces K-only output for neutral gray inputs
   *
   * **K-Only GCR Behavior:**
   * - Only applies when output profile is CMYK
   * - For non-RGB input (Gray, Lab, CMYK), automatically inserts sRGB intermediate
   * - Neutral gray inputs produce K-only CMYK output (CMY ≈ 0, K > 0)
   * - Chromatic colors still produce CMY components as needed
   * - Returns 0 (failure) if K-Only intent used with non-CMYK output
   *
   * **Gray Workaround Details:**
   * - LittleCMS limitation: Gray in 3+ profile chains fails natively
   * - This function detects Gray and builds a composite LUT by sampling
   *   chained 2-profile transforms (which do support Gray)
   * - Same runtime performance as native multiprofile after LUT creation
   *
   * @param {PointerType[]} profiles - Array of profile handles (2-255 profiles)
   * @param {number} inputFormat - Input pixel format (e.g., TYPE_GRAY_8, TYPE_RGB_8)
   * @param {number} outputFormat - Output pixel format (e.g., TYPE_CMYK_8)
   * @param {number} intent - Rendering intent. Use INTENT_RELATIVE_COLORIMETRIC for
   *   standard behavior, or INTENT_PRESERVE_K_ONLY_RELATIVE_COLORIMETRIC_GCR for
   *   K-only output on CMYK targets.
   * @param {number} flags - Transform flags (e.g., cmsFLAGS_BLACKPOINTCOMPENSATION)
   * @returns {PointerType} Transform handle (0 on failure)
   * @throws {Error} If module not initialized
   *
   * @example
   * // Standard multiprofile: Gray → sRGB → CMYK
   * const transformHandle = engine.createMultiprofileTransform(
   *   [grayProfileHandle, rgbProfileHandle, cmykProfileHandle],
   *   TYPE_GRAY_8,
   *   TYPE_CMYK_8,
   *   INTENT_RELATIVE_COLORIMETRIC,
   *   cmsFLAGS_BLACKPOINTCOMPENSATION
   * );
   *
   * @example
   * // K-Only GCR: Gray → sRGB → CMYK with K-only output for neutrals
   * const transformHandle = engine.createMultiprofileTransform(
   *   [grayProfileHandle, rgbProfileHandle, cmykProfileHandle],
   *   TYPE_GRAY_8,
   *   TYPE_CMYK_8,
   *   INTENT_PRESERVE_K_ONLY_RELATIVE_COLORIMETRIC_GCR,
   *   cmsFLAGS_BLACKPOINTCOMPENSATION
   * );
   *
   * // Transform 50% gray → CMYK(0, 0, 0, ~158) (K-only!)
   * const input = new Uint8Array([128]);
   * const output = new Uint8Array(4);
   * engine.doTransform(transformHandle, input, output, 1);
   * // output = [0, 0, 0, 158] (C=0, M=0, Y=0, K≈62%)
   *
   * // Clean up
   * engine.deleteTransform(transformHandle);
   */
  createMultiprofileTransform(profiles, inputFormat, outputFormat, intent, flags) {
    this.#ensureReady();

    return this.#module.createMultiprofileTransform(
      profiles,
      inputFormat,
      outputFormat,
      intent,
      flags
    );
  }

  /**
   * Delete color transform
   * @param {PointerType} transform - Transform handle
   */
  deleteTransform(transform) {
    this.#ensureReady();
    this.#module.deleteTransform(transform);
  }

  /**
   * Execute color transform on raw buffers
   * @param {PointerType} transform - Transform handle
   * @param {PointerType|Array|Uint8Array|Uint16Array|Float32Array} inputBuffer - Input color buffer (pointer or array)
   * @param {PointerType|Array|Uint8Array|Uint16Array|Float32Array} outputBuffer - Output color buffer (pointer or array)
   * @param {number} pixelCount - Number of pixels to transform
   */
  doTransform(transform, inputBuffer, outputBuffer, pixelCount) {
    this.#ensureReady();
    this.#module.doTransform(transform, inputBuffer, outputBuffer, pixelCount);
  }

  /**
   * Transform an array of pixels
   * @param {PointerType} transform - Transform handle
   * @param {Array|Uint8Array|Uint16Array|Float32Array} inputArray - Input pixel data
   * @param {Array|Uint8Array|Uint16Array|Float32Array} outputArray - Output pixel data
   * @param {number} pixelCount - Number of pixels to transform
   * @returns {void}
   * @note The wrapped doTransform function handles memory allocation internally
   */
  transformArray(transform, inputArray, outputArray, pixelCount) {
    this.#ensureReady();
    // The api-wrapper's doTransform handles memory management for array inputs
    this.doTransform(transform, inputArray, outputArray, pixelCount);
  }

  /**
   * Transform an array of RGB pixels to CMYK
   * Convenience method for common use case
   * @param {PointerType} transform - Transform handle
   * @param {Array|Uint8Array|Uint16Array|Float32Array} rgbArray - Input RGB data (length = pixelCount * 3)
   * @param {Array|Uint8Array|Uint16Array|Float32Array} cmykArray - Output CMYK data (length = pixelCount * 4)
   * @param {number} pixelCount - Number of pixels
   */
  transformRGBtoCMYK(transform, rgbArray, cmykArray, pixelCount) {
    this.transformArray(transform, rgbArray, cmykArray, pixelCount);
  }

  /**
   * Write bytes to heap at pointer location
   * @param {PointerType} ptr - Pointer location
   * @param {number} offset - Offset from pointer
   * @param {number} value - Byte value to write
   */
  writeU8(ptr, offset, value) {
    this.#ensureReady();
    this.#heap[ptr + offset] = value;
  }

  /**
   * Read byte from heap at pointer location
   * @param {PointerType} ptr - Pointer location
   * @param {number} offset - Offset from pointer
   * @returns {number} Byte value
   */
  readU8(ptr, offset) {
    this.#ensureReady();
    return this.#heap[ptr + offset];
  }

  /**
   * Create sRGB profile
   * @returns {PointerType} Profile handle
   */
  createSRGBProfile() {
    this.#ensureReady();
    return this.#module.createSRGBProfile();
  }

  /**
   * Create Lab profile
   * @param {PointerType} whitePoint - White point (NULL for D50)
   * @returns {PointerType} Profile handle
   */
  createLab4Profile(whitePoint = 0) {
    this.#ensureReady();
    return this.#module.createLab4Profile(whitePoint);
  }

  /**
   * Create XYZ profile
   * @returns {PointerType} Profile handle
   */
  createXYZProfile() {
    this.#ensureReady();
    return this.#module.createXYZProfile();
  }

  /**
   * Create Gray profile with gamma 2.2 and D50 white point
   * @returns {PointerType} Profile handle
   */
  createGray2Profile() {
    this.#ensureReady();
    return this.#module.createGray2Profile();
  }

  /**
   * Get D50 white point
   * @returns {PointerType} Pointer to D50 XYZ values
   */
  getD50() {
    this.#ensureReady();
    // Direct access to constant - no wrapper needed
    return this.#module._cmsD50_XYZ();
  }

  /**
   * Get WASM module HEAPU8 view
   * @returns {Uint8Array}
   */
  get HEAPU8() {
    this.#ensureReady();
    // Emscripten exposes HEAPU8 directly as a Uint8Array view
    return this.#module.HEAPU8 || new Uint8Array(this.#module.HEAP8?.buffer || this.#module.buffer);
  }

  /**
   * Get HEAPF32 view
   * @returns {Float32Array}
   */
  get HEAPF32() {
    this.#ensureReady();
    return this.#module.HEAPF32 || new Float32Array(this.#module.HEAPF32?.buffer || this.#module.buffer);
  }

  /**
   * Get raw heap for direct byte access
   * @returns {Uint8Array}
   */
  get #heap() {
    return this.#module.HEAPU8 || this.#module.HEAP8;
  }

  /**
   * Get value from heap
   * @param {PointerType} ptr - Pointer
   * @param {string} type - Type (i8, i16, i32, float, double)
   * @returns {number}
   */
  getValue(ptr, type) {
    this.#ensureReady();
    return this.#module.getValue(ptr, type);
  }

  /**
   * Set value in heap
   * @param {PointerType} ptr - Pointer
   * @param {number} value - Value to set
   * @param {string} type - Type (i8, i16, i32, float, double)
   */
  setValue(ptr, value, type) {
    this.#ensureReady();
    this.#module.setValue(ptr, value, type);
  }
}

export const TYPES = {
  ['GRAY_8']: TYPE_GRAY_8,
  ['GRAY_16']: TYPE_GRAY_16,
  ['GRAY_FLT']: TYPE_GRAY_FLT,
  ['RGB_8']: TYPE_RGB_8,
  ['RGB_16']: TYPE_RGB_16,
  ['RGBA_8']: TYPE_RGBA_8,
  ['RGB_FLT']: TYPE_RGB_FLT,
  ['CMYK_8']: TYPE_CMYK_8,
  ['CMYK_16']: TYPE_CMYK_16,
  ['CMYK_FLT']: TYPE_CMYK_FLT,
  ['Lab_8']: TYPE_Lab_8,
  ['Lab_16']: TYPE_Lab_16,
  ['Lab_FLT']: TYPE_Lab_FLT,
};

/**
 * Create and initialize a ColorEngine instance
 * @returns {Promise<ColorEngine>}
 */
export async function createEngine() {
  const engine = new ColorEngine();
  await engine.init();
  return engine;
}

export const VERSION = '2026-02-14';

export default { ColorEngine, createEngine };
