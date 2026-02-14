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
Module['openProfileFromMem'] = function (data, length) {
  const ptr = Module._malloc(length);
  Module.HEAPU8.set(new Uint8Array(data), ptr);
  const handle = Module._cmsOpenProfileFromMem(ptr, length);
  Module._free(ptr);
  return handle;
};

Module['closeProfile'] = Module.cwrap('cmsCloseProfile', 'number', ['number']);
const cmsCreateTransformCwrap = Module.cwrap('cmsCreateTransform', 'number', ['number', 'number', 'number', 'number', 'number', 'number']);
Module['createTransform'] = function (inputProfile, inputFormat, outputProfile, outputFormat, renderingIntent, flags) {
  return cmsCreateTransformCwrap(inputProfile, inputFormat, outputProfile, outputFormat, renderingIntent, flags);
};

/**
 * Create multiprofile transform (array marshaling wrapper)
 * Chains multiple ICC profiles in a single transform pipeline for SIMD-optimized conversions.
 *
 * Example use case: Gray → sRGB → CMYK with K-Only GCR intent
 *
 * @param {number[]} profileHandles - Array of profile handles (2-255 profiles)
 * @param {number} inputFormat - Input pixel format (from first profile)
 * @param {number} outputFormat - Output pixel format (to last profile)
 * @param {number} renderingIntent - Rendering intent (applied to all profile pairs)
 * @param {number} flags - Transform flags (cmsFLAGS_*)
 * @returns {number} Transform handle (0 on failure)
 */
Module['createMultiprofileTransform'] = function (
  profileHandles,
  inputFormat,
  outputFormat,
  renderingIntent,
  flags
) {
  const nProfiles = profileHandles.length;

  // Validate count (LittleCMS requirement: 2-255)
  if (nProfiles < 2 || nProfiles > 255) {
    console.error(`Invalid profile count: ${nProfiles}. Expected 2-255.`);
    return 0;
  }

  // Validate handles are non-zero
  for (let i = 0; i < nProfiles; i++) {
    if (profileHandles[i] === 0) {
      console.error(`Invalid profile handle at index ${i}: 0`);
      return 0;
    }
  }

  // Allocate temporary WASM array for profile handles
  // Each handle is a 32-bit pointer (4 bytes)
  const arrayBytes = nProfiles * 4;
  const arrayPtr = Module._malloc(arrayBytes);

  if (arrayPtr === 0) {
    console.error('Failed to allocate memory for profile array');
    return 0;
  }

  try {
    // Copy profile handles to WASM heap
    // Use HEAPU32 for 32-bit unsigned pointers
    const heapView = Module.HEAPU32;
    for (let i = 0; i < nProfiles; i++) {
      heapView[(arrayPtr >> 2) + i] = profileHandles[i];
    }

    // Call unified WASM function that handles:
    // 1. Standard rendering intents (2-profile and 3+)
    // 2. Gray workaround (when Gray is in 3+ chain)
    // 3. K-Only GCR (when renderingIntent is K-Only GCR and output is CMYK)
    // 4. K-Only GCR + Gray workaround (when both conditions apply)
    const transform = Module._CreateMultiprofileTransform(
      0,             // cmsContext ContextID (NULL = global context)
      arrayPtr,      // const cmsHPROFILE hProfiles[]
      nProfiles,     // cmsUInt32Number nProfiles
      inputFormat,   // cmsUInt32Number InputFormat
      outputFormat,  // cmsUInt32Number OutputFormat
      renderingIntent,        // cmsUInt32Number RenderingIntent
      flags          // cmsUInt32Number dwFlags
    );

    return transform;
  } finally {
    // Free temporary array (profile handles themselves stay open)
    Module._free(arrayPtr);
  }
};

Module['deleteTransform'] = function (transform) {
  Module._cmsDeleteTransform(transform);
};

// For doTransform, handle arrays manually for better control
Module['doTransform'] = function (transform, inputBuffer, outputBuffer, pixelCount) {
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

    // Perform transform (plugin handles sentinel detection and boundary clamping)
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

/**
 * Create Gray profile with gamma 2.2 and D50 white point
 * @returns {number} Profile handle
 */
Module['createGray2Profile'] = function () {
  // Build gamma 2.2 tone curve
  const gamma = Module._cmsBuildGamma(0, 2.2);
  if (!gamma) {
    console.error('Failed to create gamma curve');
    return 0;
  }

  // Create gray profile with D50 white point (NULL = use D50)
  const profile = Module._cmsCreateGrayProfile(0, gamma);

  // Free the tone curve (profile makes a copy)
  Module._cmsFreeToneCurve(gamma);

  return profile;
};

console.log('Little-CMS API wrapper initialized');
