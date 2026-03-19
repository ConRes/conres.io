/**
 * @fileoverview API Wrapper for Little-CMS WASM
 * 
 * This file provides proper JavaScript bindings for Little-CMS functions,
 * handling memory marshaling and type conversions correctly.
 * Based on lcms-wasm approach by mattdesl.
 */

// This code will be injected after the Emscripten-generated module
// It wraps the raw WASM functions with proper type handling

// For large arrays, we need to manually handle memory allocation
Module['openProfileFromMem'] = function(data, length) {
  const ptr = Module._malloc(length);
  Module.HEAPU8.set(new Uint8Array(data), ptr);
  const handle = Module._cmsOpenProfileFromMem(ptr, length);
  Module._free(ptr);
  return handle;
};

Module['openProfileFromFile'] = Module.cwrap('cmsOpenProfileFromFile', 'number', ['string']);
Module['closeProfile'] = Module.cwrap('cmsCloseProfile', 'number', ['number']);
Module['createTransform'] = Module.cwrap('cmsCreateTransform', 'number', ['number', 'number', 'number', 'number', 'number', 'number']);
Module['deleteTransform'] = Module.cwrap('cmsDeleteTransform', null, ['number']);

// For doTransform, handle arrays manually for better control
Module['doTransform'] = function(transform, inputBuffer, outputBuffer, pixelCount) {
  // If buffers are pointers, use directly
  if (typeof inputBuffer === 'number' && typeof outputBuffer === 'number') {
    Module._cmsDoTransform(transform, inputBuffer, outputBuffer, pixelCount);
    return;
  }
  
  // Otherwise, allocate temporary buffers
  const inputIsFloat = inputBuffer instanceof Float32Array || inputBuffer instanceof Float64Array;
  const outputIsFloat = outputBuffer instanceof Float32Array || outputBuffer instanceof Float64Array;

  const inputBytes = inputBuffer.length * inputBuffer.BYTES_PER_ELEMENT;
  const outputBytes = outputBuffer.length * outputBuffer.BYTES_PER_ELEMENT;

  const inputPtr = Module._malloc(inputBytes);
  const outputPtr = Module._malloc(outputBytes);

  if (inputPtr === 0 || outputPtr === 0) {
    if (inputPtr !== 0) Module._free(inputPtr);
    if (outputPtr !== 0) Module._free(outputPtr);
    throw new Error('Failed to allocate memory for color transform');
  }

  try {
    // Copy input to WASM heap (get fresh heap view in case memory grew)
    if (inputIsFloat && inputBuffer instanceof Float64Array) {
      const heapView = Module.HEAPF64;
      for (let i = 0; i < inputBuffer.length; i++) {
        heapView[(inputPtr >> 3) + i] = inputBuffer[i];  // >> 3 for 8-byte alignment
      }
    } else if (inputIsFloat && inputBuffer instanceof Float32Array) {
      const heapView = Module.HEAPF32;
      for (let i = 0; i < inputBuffer.length; i++) {
        heapView[(inputPtr >> 2) + i] = inputBuffer[i];
      }
    } else if (inputBuffer instanceof Uint16Array) {
      const heapView = Module.HEAPU16;
      for (let i = 0; i < inputBuffer.length; i++) {
        heapView[(inputPtr >> 1) + i] = inputBuffer[i];
      }
    } else if (inputBuffer instanceof Uint8Array) {
      const heapView = Module.HEAPU8;
      for (let i = 0; i < inputBuffer.length; i++) {
        heapView[inputPtr + i] = inputBuffer[i];
      }
    }

    // Perform transform
    Module._cmsDoTransform(transform, inputPtr, outputPtr, pixelCount);

    // Copy output from WASM heap (get fresh heap view in case memory grew)
    if (outputIsFloat && outputBuffer instanceof Float64Array) {
      const heapView = Module.HEAPF64;
      for (let i = 0; i < outputBuffer.length; i++) {
        outputBuffer[i] = heapView[(outputPtr >> 3) + i];  // >> 3 for 8-byte alignment
      }
    } else if (outputIsFloat && outputBuffer instanceof Float32Array) {
      const heapView = Module.HEAPF32;
      for (let i = 0; i < outputBuffer.length; i++) {
        outputBuffer[i] = heapView[(outputPtr >> 2) + i];
      }
    } else if (outputBuffer instanceof Uint16Array) {
      const heapView = Module.HEAPU16;
      for (let i = 0; i < outputBuffer.length; i++) {
        outputBuffer[i] = heapView[(outputPtr >> 1) + i];
      }
    } else if (outputBuffer instanceof Uint8Array) {
      const heapView = Module.HEAPU8;
      for (let i = 0; i < outputBuffer.length; i++) {
        outputBuffer[i] = heapView[outputPtr + i];
      }
    }
  } finally {
    Module._free(inputPtr);
    Module._free(outputPtr);
  }
};

// Profile creation helpers
Module['createSRGBProfile'] = Module.cwrap('cmsCreate_sRGBProfile', 'number', []);
Module['createLab4Profile'] = Module.cwrap('cmsCreateLab4Profile', 'number', ['number']);
Module['createXYZProfile'] = Module.cwrap('cmsCreateXYZProfile', 'number', []);

// Register K-Only GCR custom intent plugin
// This must be called once after module initialization
if (Module._RegisterKOnlyGCRIntent) {
  const result = Module._RegisterKOnlyGCRIntent();
  if (!result) {
    console.warn('⚠️  K-Only GCR intent registration failed');
  }
} else {
  console.warn('⚠️  RegisterKOnlyGCRIntent function not found in WASM module');
}

// Expose heap views for advanced users
Module['getHEAP8'] = () => Module.HEAP8;
Module['getHEAPU8'] = () => Module.HEAPU8;
Module['getHEAPF32'] = () => Module.HEAPF32;
Module['getHEAPF64'] = () => Module.HEAPF64;

// Helper to read Float32 array from WASM memory
Module['readFloat32Array'] = (ptr, length) => {
  return new Float32Array(Module.HEAPF32.buffer, ptr, length);
};

// Helper to write Float32 array to WASM memory
Module['writeFloat32Array'] = (ptr, array) => {
  Module.HEAPF32.set(array, ptr >> 2);
};

// Expose constants
Module['INTENT_PERCEPTUAL'] = 0;
Module['INTENT_RELATIVE_COLORIMETRIC'] = 1;
Module['INTENT_SATURATION'] = 2;
Module['INTENT_ABSOLUTE_COLORIMETRIC'] = 3;
Module['INTENT_K_ONLY_GCR'] = 20;

// Pixel format helpers (calculated from lcms2.h macros)
// Format: FLOAT_SH(1) | COLORSPACE_SH(type) | CHANNELS_SH(n) | BYTES_SH(b)
// FLOAT_SH(1) = 1 << 22 = 4194304
// COLORSPACE_SH: PT_GRAY=3, PT_RGB=4, PT_CMYK=6, PT_Lab=10
// Shift: << 16

Module['TYPE_GRAY_8'] = 0x030009;
Module['TYPE_GRAY_16'] = 0x03000a;
Module['TYPE_RGB_8'] = 0x040019;
Module['TYPE_RGB_16'] = 0x04001a;
Module['TYPE_RGB_FLT'] = 4456476;   // FLOAT | RGB | 3ch | 4bytes
Module['TYPE_RGBA_8'] = 0x040099;
Module['TYPE_RGBA_16'] = 0x04009a;
Module['TYPE_RGBA_FLT'] = 0x040094;
Module['TYPE_CMYK_8'] = 393249;     // 0x060021 - PT_CMYK(6) | 4ch | 1byte (FIXED)
Module['TYPE_CMYK_16'] = 393250;    // 0x060022 - PT_CMYK(6) | 4ch | 2bytes (FIXED)
Module['TYPE_CMYK_FLT'] = 4587556;  // FLOAT | CMYK | 4ch | 4bytes
Module['TYPE_Lab_8'] = 655385;  // 0x0A0019 - PT_Lab(10) | 3ch | 1byte (FIXED)
Module['TYPE_Lab_16'] = 655386;  // 0x0A001A - PT_Lab(10) | 3ch | 2bytes (FIXED)
Module['TYPE_Lab_FLT'] = 4849692;   // FLOAT | Lab | 3ch | 4bytes (Float32)
Module['TYPE_Lab_DBL'] = 4849688;   // FLOAT | Lab | 3ch | 0bytes (Float64/double)

// Transform flags
Module['cmsFLAGS_NOCACHE'] = 0x0040;
Module['cmsFLAGS_NOOPTIMIZE'] = 0x0100;
Module['cmsFLAGS_BLACKPOINTCOMPENSATION'] = 0x2000;
Module['cmsFLAGS_BPC_CLAMP_OPTIMIZE'] = 0x80000000;  // New: BPC clamping optimization

/**
 * BPC Clamping Optimization - WASM Implementation
 *
 * When Black Point Compensation is enabled, pure black and pure white pixels
 * are guaranteed to map to specific output values. This optimization skips
 * the full transform pipeline for these boundary pixels.
 *
 * The C implementation uses SIMD-optimized boundary detection for maximum
 * performance with large image buffers.
 *
 * For typical document images (masks, text, diagrams), this can provide
 * significant performance improvement.
 */

// Stats structure size: 16 bytes (4 x uint32)
const BPC_STATS_SIZE = 16;

// Metadata cache for transforms (stores channel counts, etc.)
const transformMetadata = new Map();

/**
 * Initialize BPC clamping optimization for a transform (WASM version)
 * Call this once after creating the transform to enable boundary clamping
 * @param {number} transform - Transform handle
 * @param {number} inputChannels - Number of input channels (3 for RGB, 1 for Gray)
 * @param {number} outputChannels - Number of output channels (4 for CMYK)
 * @param {boolean} inputIsFloat - Whether input is float format (currently unused, Uint8 only)
 * @param {boolean} outputIsFloat - Whether output is float format (currently unused, Uint8 only)
 * @returns {{black: Uint8Array, white: Uint8Array}} Pre-computed boundary values
 */
Module['initBPCClamping'] = function(transform, inputChannels, outputChannels, inputIsFloat = false, outputIsFloat = false) {
  // Currently only supports Uint8 format in WASM implementation
  if (inputIsFloat || outputIsFloat) {
    console.warn('BPC clamping WASM version only supports Uint8 format. Falling back for float.');
  }

  // Call WASM init function
  const result = Module._BPCClamp_Init(transform, inputChannels, outputChannels);
  if (result < 0) {
    throw new Error('Failed to initialize BPC clamping');
  }

  // Store metadata for later use
  transformMetadata.set(transform, { inputChannels, outputChannels, inputIsFloat, outputIsFloat });

  // Read the pre-computed boundary values from WASM
  const blackOutput = new Uint8Array(outputChannels);
  const whiteOutput = new Uint8Array(outputChannels);

  const blackPtr = Module._malloc(8);  // Max 8 channels
  const whitePtr = Module._malloc(8);

  try {
    Module._BPCClamp_GetBlackOutput(transform, blackPtr);
    Module._BPCClamp_GetWhiteOutput(transform, whitePtr);

    for (let i = 0; i < outputChannels; i++) {
      blackOutput[i] = Module.HEAPU8[blackPtr + i];
      whiteOutput[i] = Module.HEAPU8[whitePtr + i];
    }
  } finally {
    Module._free(blackPtr);
    Module._free(whitePtr);
  }

  return {
    black: blackOutput,
    white: whiteOutput,
    inputChannels,
    outputChannels,
    inputIsFloat,
    outputIsFloat,
    inputMaxVal: inputIsFloat ? 1.0 : 255,
    outputMaxVal: outputIsFloat ? 1.0 : 255
  };
};

/**
 * Clear BPC clamping cache for a transform
 * Call this when deleting a transform
 * @param {number} transform - Transform handle
 */
Module['clearBPCClamping'] = function(transform) {
  Module._BPCClamp_Clear(transform);
  transformMetadata.delete(transform);
};

/**
 * Clear all BPC clamping caches
 */
Module['clearAllBPCClamping'] = function() {
  Module._BPCClamp_ClearAll();
  transformMetadata.clear();
};

/**
 * Optimized doTransform with BPC boundary clamping (WASM version)
 * Uses SIMD-optimized boundary detection in C for maximum performance
 *
 * @param {number} transform - Transform handle
 * @param {Uint8Array} inputBuffer - Input pixel data (Uint8 only)
 * @param {Uint8Array} outputBuffer - Output pixel data (will be modified)
 * @param {number} pixelCount - Number of pixels
 * @returns {{transformedCount: number, blackCount: number, whiteCount: number, optimizationSkipped: boolean}} Statistics
 */
Module['doTransformWithBPCClamp'] = function(transform, inputBuffer, outputBuffer, pixelCount) {
  const metadata = transformMetadata.get(transform);

  // Fall back to regular transform if not initialized or using float format
  if (!metadata || !(inputBuffer instanceof Uint8Array) || !(outputBuffer instanceof Uint8Array)) {
    Module['doTransform'](transform, inputBuffer, outputBuffer, pixelCount);
    return { transformedCount: pixelCount, blackCount: 0, whiteCount: 0, optimizationSkipped: true };
  }

  const inputBytes = inputBuffer.length;
  const outputBytes = outputBuffer.length;

  // Allocate WASM memory
  const inputPtr = Module._malloc(inputBytes);
  const outputPtr = Module._malloc(outputBytes);
  const statsPtr = Module._malloc(BPC_STATS_SIZE);

  if (inputPtr === 0 || outputPtr === 0 || statsPtr === 0) {
    if (inputPtr !== 0) Module._free(inputPtr);
    if (outputPtr !== 0) Module._free(outputPtr);
    if (statsPtr !== 0) Module._free(statsPtr);
    throw new Error('Failed to allocate memory for BPC clamping transform');
  }

  try {
    // Copy input to WASM heap
    Module.HEAPU8.set(inputBuffer, inputPtr);

    // Clear stats memory
    for (let i = 0; i < BPC_STATS_SIZE; i++) {
      Module.HEAPU8[statsPtr + i] = 0;
    }

    // Call WASM BPC clamping transform
    Module._BPCClamp_DoTransform(transform, inputPtr, outputPtr, pixelCount, statsPtr);

    // Copy output from WASM heap
    for (let i = 0; i < outputBytes; i++) {
      outputBuffer[i] = Module.HEAPU8[outputPtr + i];
    }

    // Read stats from WASM (4 x uint32: transformedCount, blackCount, whiteCount, optimizationSkipped)
    const statsView = new Uint32Array(Module.HEAPU8.buffer, statsPtr, 4);
    return {
      transformedCount: statsView[0],
      blackCount: statsView[1],
      whiteCount: statsView[2],
      optimizationSkipped: statsView[3] !== 0
    };
  } finally {
    Module._free(inputPtr);
    Module._free(outputPtr);
    Module._free(statsPtr);
  }
};

/**
 * Adaptive transform with automatic boundary detection
 *
 * Automatically detects if an image is a pure mask (100% boundary pixels)
 * by sampling the first 256 pixels. Only applies BPC clamping optimization
 * for images >= 2MP that are detected as pure masks.
 *
 * This is the recommended API for general use - it automatically routes
 * images to the optimal transform path without caller needing to know
 * the image content.
 *
 * @param {number} transform - Transform handle
 * @param {Uint8Array} inputBuffer - Input pixel data (Uint8 only)
 * @param {Uint8Array} outputBuffer - Output pixel data (will be modified)
 * @param {number} pixelCount - Number of pixels
 * @returns {{transformedCount: number, blackCount: number, whiteCount: number, optimizationSkipped: boolean}} Statistics
 */
Module['doTransformAdaptive'] = function(transform, inputBuffer, outputBuffer, pixelCount) {
  const metadata = transformMetadata.get(transform);

  // Fall back to regular transform if not initialized or using float format
  if (!metadata || !(inputBuffer instanceof Uint8Array) || !(outputBuffer instanceof Uint8Array)) {
    Module['doTransform'](transform, inputBuffer, outputBuffer, pixelCount);
    return { transformedCount: pixelCount, blackCount: 0, whiteCount: 0, optimizationSkipped: true };
  }

  const inputBytes = inputBuffer.length;
  const outputBytes = outputBuffer.length;

  // Allocate WASM memory
  const inputPtr = Module._malloc(inputBytes);
  const outputPtr = Module._malloc(outputBytes);
  const statsPtr = Module._malloc(BPC_STATS_SIZE);

  if (inputPtr === 0 || outputPtr === 0 || statsPtr === 0) {
    if (inputPtr !== 0) Module._free(inputPtr);
    if (outputPtr !== 0) Module._free(outputPtr);
    if (statsPtr !== 0) Module._free(statsPtr);
    throw new Error('Failed to allocate memory for adaptive transform');
  }

  try {
    // Copy input to WASM heap
    Module.HEAPU8.set(inputBuffer, inputPtr);

    // Clear stats memory
    for (let i = 0; i < BPC_STATS_SIZE; i++) {
      Module.HEAPU8[statsPtr + i] = 0;
    }

    // Call WASM adaptive transform
    Module._BPCClamp_DoTransformAdaptive(transform, inputPtr, outputPtr, pixelCount, statsPtr);

    // Copy output from WASM heap
    for (let i = 0; i < outputBytes; i++) {
      outputBuffer[i] = Module.HEAPU8[outputPtr + i];
    }

    // Read stats from WASM
    const statsView = new Uint32Array(Module.HEAPU8.buffer, statsPtr, 4);
    return {
      transformedCount: statsView[0],
      blackCount: statsView[1],
      whiteCount: statsView[2],
      optimizationSkipped: statsView[3] !== 0
    };
  } finally {
    Module._free(inputPtr);
    Module._free(outputPtr);
    Module._free(statsPtr);
  }
};

