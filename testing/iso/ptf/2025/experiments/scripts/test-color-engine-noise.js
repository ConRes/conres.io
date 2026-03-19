#!/usr/bin/env node
// @ts-check
/**
 * Color Engine Noise Characterization Script
 *
 * Generates random images, transforms through all profile combinations
 * (Lab, sRGB, sGray, eciCMYK v2) at 8-bit, 16-bit, and 32-bit float,
 * using createMultiprofileTransform. Measures Delta-E 1976 noise,
 * tracks timing, detects between-iteration and within-image variability.
 *
 * Statistics follow the tiff-diff tool methodology:
 * - Global Delta-E (min, max, mean, median, standard deviation)
 * - Histogram by perceptual range
 * - Unique color analysis (input vs output count)
 * - Between-iteration determinism check
 * - Within-image consistency (same input color at different positions)
 *
 * @module test-color-engine-noise
 */

import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  createEngine,
  TYPE_GRAY_8,
  TYPE_GRAY_16,
  TYPE_GRAY_FLT,
  TYPE_RGB_8,
  TYPE_RGB_16,
  TYPE_RGB_FLT,
  TYPE_CMYK_8,
  TYPE_CMYK_16,
  TYPE_CMYK_FLT,
  TYPE_Lab_8,
  TYPE_Lab_16,
  TYPE_Lab_FLT,
  INTENT_RELATIVE_COLORIMETRIC,
  INTENT_PRESERVE_K_ONLY_RELATIVE_COLORIMETRIC_GCR,
  cmsFLAGS_BLACKPOINTCOMPENSATION,
} from '../../packages/color-engine/src/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ============================================================================
// Configuration
// ============================================================================

const PIXEL_COUNT = 10000;
const DUPLICATE_COUNT = 100; // Number of colors duplicated at different positions
const ITERATIONS = 3;
const RNG_SEED = 42;

const PROFILES_DIR = join(__dirname, '../../packages/color-engine/tests/fixtures/profiles');

// ============================================================================
// Seeded Random Number Generator (Mulberry32)
// ============================================================================

/**
 * Create a seeded PRNG (Mulberry32)
 * @param {number} seed
 * @returns {() => number} Returns values in [0, 1)
 */
function createRNG(seed) {
  let state = seed | 0;
  return () => {
    state = (state + 0x6D2B79F5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ============================================================================
// Delta-E 1976
// ============================================================================

/**
 * @param {number} L1
 * @param {number} a1
 * @param {number} b1
 * @param {number} L2
 * @param {number} a2
 * @param {number} b2
 * @returns {number}
 */
function deltaE76(L1, a1, b1, L2, a2, b2) {
  const dL = L1 - L2;
  const da = a1 - a2;
  const db = b1 - b2;
  return Math.sqrt(dL * dL + da * da + db * db);
}

// ============================================================================
// Random Input Generation
// ============================================================================

/**
 * @typedef {'Gray' | 'RGB' | 'CMYK' | 'Lab'} ColorSpaceType
 */

/**
 * Get channel count for a color space
 * @param {ColorSpaceType} colorSpace
 * @returns {number}
 */
function channelsFor(colorSpace) {
  switch (colorSpace) {
    case 'Gray': return 1;
    case 'RGB': return 3;
    case 'CMYK': return 4;
    case 'Lab': return 3;
  }
}

/**
 * Generate random input data with duplicate colors for consistency testing.
 *
 * @param {ColorSpaceType} colorSpace
 * @param {number} pixelCount
 * @param {number} duplicateCount - Number of colors to duplicate at different positions
 * @param {number} seed
 * @returns {{ uint8: Uint8Array, uint16: Uint16Array, float32: Float32Array, duplicateIndices: number[][] }}
 */
function generateRandomInput(colorSpace, pixelCount, duplicateCount, seed) {
  const random = createRNG(seed);
  const channels = channelsFor(colorSpace);
  const totalValues = pixelCount * channels;

  const float32 = new Float32Array(totalValues);

  // Generate unique random colors first
  for (let i = 0; i < totalValues; i++) {
    if (colorSpace === 'Lab') {
      // Lab range: L [0, 100], a [-128, 127], b [-128, 127]
      const channel = i % 3;
      if (channel === 0) {
        float32[i] = random() * 100;
      } else {
        float32[i] = random() * 255 - 128;
      }
    } else if (colorSpace === 'CMYK') {
      // CMYK: TYPE_CMYK_FLT expects [0, 100] (100 = 100% ink coverage)
      float32[i] = random() * 100;
    } else {
      // RGB, Gray: [0, 1] in float
      float32[i] = random();
    }
  }

  // Insert duplicates: copy some colors to other positions
  /** @type {number[][]} */
  const duplicateIndices = [];
  for (let d = 0; d < duplicateCount; d++) {
    const sourcePixel = Math.floor(random() * (pixelCount - duplicateCount));
    const targetPixel = pixelCount - duplicateCount + d;
    const sourceOffset = sourcePixel * channels;
    const targetOffset = targetPixel * channels;
    for (let c = 0; c < channels; c++) {
      float32[targetOffset + c] = float32[sourceOffset + c];
    }
    duplicateIndices.push([sourcePixel, targetPixel]);
  }

  // Convert float32 to uint8 and uint16
  const uint8 = new Uint8Array(totalValues);
  const uint16 = new Uint16Array(totalValues);

  for (let i = 0; i < totalValues; i++) {
    if (colorSpace === 'Lab') {
      const channel = i % 3;
      if (channel === 0) {
        // L: [0, 100] → 8-bit [0, 255], 16-bit [0, 65535]
        uint8[i] = Math.round(float32[i] * 2.55);
        uint16[i] = Math.round(float32[i] * 655.35);
      } else {
        // a/b: [-128, 127] → 8-bit signed as unsigned, 16-bit scaled
        const signed8 = Math.round(float32[i]);
        uint8[i] = signed8 < 0 ? signed8 + 256 : signed8;
        uint16[i] = Math.round(float32[i] * 256) & 0xFFFF;
      }
    } else if (colorSpace === 'CMYK') {
      // CMYK float [0, 100] → 8-bit [0, 255], 16-bit [0, 65535]
      uint8[i] = Math.round((float32[i] / 100) * 255);
      uint16[i] = Math.round((float32[i] / 100) * 65535);
    } else {
      // RGB, Gray: [0, 1] → [0, 255] and [0, 65535]
      uint8[i] = Math.round(float32[i] * 255);
      uint16[i] = Math.round(float32[i] * 65535);
    }
  }

  return { uint8, uint16, float32, duplicateIndices };
}

// ============================================================================
// Statistics
// ============================================================================

/**
 * Count unique colors in a typed array
 * @param {Uint8Array | Uint16Array | Float32Array} data
 * @param {number} channels
 * @param {number} pixelCount
 * @returns {number}
 */
function countUniqueColors(data, channels, pixelCount) {
  const set = new Set();
  for (let i = 0; i < pixelCount; i++) {
    const offset = i * channels;
    let key = '';
    for (let c = 0; c < channels; c++) {
      key += data[offset + c].toString() + ',';
    }
    set.add(key);
  }
  return set.size;
}

/**
 * Check if two typed arrays are byte-identical
 * @param {Uint8Array | Uint16Array | Float32Array} a
 * @param {Uint8Array | Uint16Array | Float32Array} b
 * @returns {{ identical: boolean, diffCount: number, maxDiff: number }}
 */
function compareArrays(a, b) {
  let diffCount = 0;
  let maxDiff = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      diffCount++;
      const diff = Math.abs(a[i] - b[i]);
      if (diff > maxDiff) maxDiff = diff;
    }
  }
  return { identical: diffCount === 0, diffCount, maxDiff };
}

// ============================================================================
// Cross-Matched Sample Variability (following tiff-diff methodology)
// ============================================================================

/**
 * @typedef {{
 *   reference: number[],
 *   sample: number[],
 *   pixels: number,
 *   overlaps: number,
 *   variants: number,
 *   coverage: number,
 *   deltaEin: { mean: number, min: number, max: number },
 * }} VariabilityColor
 */

/**
 * Collect unique input colors with all their pixel positions.
 * Keys are the raw native-format channel values (no rounding for integer formats,
 * 6-decimal rounding for float to handle floating-point identity).
 *
 * @param {Uint8Array | Uint16Array | Float32Array} data
 * @param {number} channels
 * @param {number} pixelCount
 * @returns {Map<string, { values: number[], positions: number[] }>}
 */
function collectInputColors(data, channels, pixelCount) {
  /** @type {Map<string, { values: number[], positions: number[] }>} */
  const colors = new Map();
  const isFloat = data instanceof Float32Array;

  for (let i = 0; i < pixelCount; i++) {
    const offset = i * channels;
    let key = '';
    /** @type {number[]} */
    const values = [];
    for (let c = 0; c < channels; c++) {
      const v = data[offset + c];
      values.push(v);
      key += (isFloat ? v.toFixed(6) : v.toString()) + ',';
    }

    if (colors.has(key)) {
      colors.get(key).positions.push(i);
    } else {
      colors.set(key, { values, positions: [i] });
    }
  }

  return colors;
}

/**
 * Compute cross-matched sample variability for all unique input colors.
 *
 * For each unique input color, looks at all output values at those positions
 * and computes:
 * - Variants: number of distinct output values
 * - Overlaps: frequency of the dominant output value
 * - Coverage: Overlaps / Pixels
 * - ΔEin: Delta-E between each output Lab and the mean output Lab
 *
 * @param {Map<string, { values: number[], positions: number[] }>} inputColors
 * @param {Uint8Array | Uint16Array | Float32Array} output
 * @param {number} outputChannels
 * @param {Float32Array} outputLab - Lab Float32 array for Delta-E computation
 * @returns {{
 *   colors: VariabilityColor[],
 *   summary: {
 *     totalUniqueInputColors: number,
 *     colorsWithVariants: number,
 *     meanVariants: number,
 *     maxVariants: number,
 *     meanCoverage: number,
 *     minCoverage: number,
 *     meanDeltaEin: number,
 *     maxDeltaEin: number,
 *   },
 * }}
 */
function computeVariability(inputColors, output, outputChannels, outputLab) {
  /** @type {VariabilityColor[]} */
  const results = [];
  const isFloat = output instanceof Float32Array;

  for (const [, color] of inputColors) {
    if (color.positions.length < 2) continue; // Need at least 2 occurrences

    /** @type {Map<string, number>} */
    const outputFreqs = new Map();

    // First pass: collect output frequencies and accumulate Lab means
    let sumSL = 0, sumSa = 0, sumSb = 0;

    for (const pos of color.positions) {
      const outOffset = pos * outputChannels;
      let outKey = '';
      for (let c = 0; c < outputChannels; c++) {
        const v = output[outOffset + c];
        outKey += (isFloat ? v.toFixed(6) : v.toString()) + ',';
      }
      outputFreqs.set(outKey, (outputFreqs.get(outKey) ?? 0) + 1);

      const labIdx = pos * 3;
      sumSL += outputLab[labIdx];
      sumSa += outputLab[labIdx + 1];
      sumSb += outputLab[labIdx + 2];
    }

    const posCount = color.positions.length;
    const meanSL = sumSL / posCount;
    const meanSa = sumSa / posCount;
    const meanSb = sumSb / posCount;

    // Second pass: ΔEin (each output Lab vs mean output Lab)
    let deinSum = 0, deinMin = Infinity, deinMax = -Infinity;
    for (const pos of color.positions) {
      const labIdx = pos * 3;
      const dein = deltaE76(
        outputLab[labIdx], outputLab[labIdx + 1], outputLab[labIdx + 2],
        meanSL, meanSa, meanSb
      );
      deinSum += dein;
      if (dein < deinMin) deinMin = dein;
      if (dein > deinMax) deinMax = dein;
    }

    // Find dominant output and overlaps
    let overlaps = 0;
    let dominantKey = '';
    for (const [outKey, freq] of outputFreqs) {
      if (freq > overlaps) { overlaps = freq; dominantKey = outKey; }
    }

    const dominantValues = dominantKey.split(',').filter(s => s).map(Number);

    results.push({
      reference: color.values,
      sample: dominantValues,
      pixels: posCount,
      overlaps,
      variants: outputFreqs.size,
      coverage: overlaps / posCount,
      deltaEin: { mean: deinSum / posCount, min: deinMin, max: deinMax },
    });
  }

  // Sort by coverage (lowest = most splitting = most noise)
  results.sort((a, b) => a.coverage - b.coverage);

  // Summary
  const n = results.length;
  const colorsWithVariants = results.filter(c => c.variants > 1).length;
  const meanVariants = n > 0 ? results.reduce((s, c) => s + c.variants, 0) / n : 0;
  const maxVariants = n > 0 ? Math.max(...results.map(c => c.variants)) : 0;
  const meanCoverage = n > 0 ? results.reduce((s, c) => s + c.coverage, 0) / n : 0;
  const minCoverage = n > 0 ? Math.min(...results.map(c => c.coverage)) : 0;
  const meanDeltaEin = n > 0 ? results.reduce((s, c) => s + c.deltaEin.mean, 0) / n : 0;
  const maxDeltaEin = n > 0 ? Math.max(...results.map(c => c.deltaEin.max)) : 0;

  return {
    colors: results,
    summary: {
      totalUniqueInputColors: inputColors.size,
      colorsWithVariants,
      meanVariants,
      maxVariants,
      meanCoverage,
      minCoverage,
      meanDeltaEin,
      maxDeltaEin,
    },
  };
}

// ============================================================================
// Transform Configuration
// ============================================================================

/**
 * @typedef {{
 *   name: string,
 *   profiles: string[],
 *   inputColorSpace: ColorSpaceType,
 *   outputColorSpace: ColorSpaceType,
 *   intent: number,
 *   flags: number,
 *   bitDepthOverrides?: BitDepthConfig[],
 * }} TransformChainConfig
 */

/** @type {TransformChainConfig[]} */
const TRANSFORM_CHAINS = [
  // 2-profile chains
  {
    name: 'sRGB → eciCMYK v2',
    profiles: ['sRGB', 'eciCMYK_v2'],
    inputColorSpace: 'RGB',
    outputColorSpace: 'CMYK',
    intent: INTENT_RELATIVE_COLORIMETRIC,
    flags: cmsFLAGS_BLACKPOINTCOMPENSATION,
  },
  {
    name: 'sRGB → Lab',
    profiles: ['sRGB', 'Lab'],
    inputColorSpace: 'RGB',
    outputColorSpace: 'Lab',
    intent: INTENT_RELATIVE_COLORIMETRIC,
    flags: 0,
  },
  {
    name: 'Lab → sRGB',
    profiles: ['Lab', 'sRGB'],
    inputColorSpace: 'Lab',
    outputColorSpace: 'RGB',
    intent: INTENT_RELATIVE_COLORIMETRIC,
    flags: 0,
  },
  {
    name: 'Lab → eciCMYK v2',
    profiles: ['Lab', 'eciCMYK_v2'],
    inputColorSpace: 'Lab',
    outputColorSpace: 'CMYK',
    intent: INTENT_RELATIVE_COLORIMETRIC,
    flags: cmsFLAGS_BLACKPOINTCOMPENSATION,
  },
  {
    name: 'eciCMYK v2 → Lab',
    profiles: ['eciCMYK_v2', 'Lab'],
    inputColorSpace: 'CMYK',
    outputColorSpace: 'Lab',
    intent: INTENT_RELATIVE_COLORIMETRIC,
    flags: 0,
  },
  {
    name: 'eciCMYK v2 → sRGB',
    profiles: ['eciCMYK_v2', 'sRGB'],
    inputColorSpace: 'CMYK',
    outputColorSpace: 'RGB',
    intent: INTENT_RELATIVE_COLORIMETRIC,
    flags: 0,
  },
  {
    name: 'sGray → sRGB',
    profiles: ['sGray', 'sRGB'],
    inputColorSpace: 'Gray',
    outputColorSpace: 'RGB',
    intent: INTENT_RELATIVE_COLORIMETRIC,
    flags: 0,
  },
  {
    name: 'sGray → eciCMYK v2',
    profiles: ['sGray', 'eciCMYK_v2'],
    inputColorSpace: 'Gray',
    outputColorSpace: 'CMYK',
    intent: INTENT_RELATIVE_COLORIMETRIC,
    flags: cmsFLAGS_BLACKPOINTCOMPENSATION,
  },

  // 3-profile chains (multiprofile)
  {
    name: 'sGray → sRGB → eciCMYK v2',
    profiles: ['sGray', 'sRGB', 'eciCMYK_v2'],
    inputColorSpace: 'Gray',
    outputColorSpace: 'CMYK',
    intent: INTENT_RELATIVE_COLORIMETRIC,
    flags: cmsFLAGS_BLACKPOINTCOMPENSATION,
  },
  {
    name: 'Lab → sRGB → eciCMYK v2',
    profiles: ['Lab', 'sRGB', 'eciCMYK_v2'],
    inputColorSpace: 'Lab',
    outputColorSpace: 'CMYK',
    intent: INTENT_RELATIVE_COLORIMETRIC,
    flags: cmsFLAGS_BLACKPOINTCOMPENSATION,
  },
  {
    name: 'eciCMYK v2 → Lab → sRGB',
    profiles: ['eciCMYK_v2', 'Lab', 'sRGB'],
    inputColorSpace: 'CMYK',
    outputColorSpace: 'RGB',
    intent: INTENT_RELATIVE_COLORIMETRIC,
    flags: 0,
  },

  // K-Only GCR chains
  {
    name: 'sRGB → eciCMYK v2 (K-Only GCR)',
    profiles: ['sRGB', 'eciCMYK_v2'],
    inputColorSpace: 'RGB',
    outputColorSpace: 'CMYK',
    intent: INTENT_PRESERVE_K_ONLY_RELATIVE_COLORIMETRIC_GCR,
    flags: cmsFLAGS_BLACKPOINTCOMPENSATION,
  },
  {
    name: 'sGray → sRGB → eciCMYK v2 (K-Only GCR)',
    profiles: ['sGray', 'sRGB', 'eciCMYK_v2'],
    inputColorSpace: 'Gray',
    outputColorSpace: 'CMYK',
    intent: INTENT_PRESERVE_K_ONLY_RELATIVE_COLORIMETRIC_GCR,
    flags: cmsFLAGS_BLACKPOINTCOMPENSATION,
  },

  // ──────────────────────────────────────────────────────────────────────────
  // Mixed bit-depth chains (TFG-specific paths from Section 9/16/17)
  //
  // TFG uses mixed input/output bit depths in several paths:
  // - 16-bit BE PDF images → 8-bit CMYK output (most common 16-bit path)
  // - 8-bit images → Float32 Lab output (sampler/analysis path)
  // - 16-bit BE images → Float32 output (workaround path for SE → Float)
  //
  // NOTE: SE (Swap Endian) formats are not tested here because they are
  // constructed by TFG's ColorConversionPolicy, not exported by color-engine.
  // The SE flag tells LittleCMS the buffer byte order differs from WASM native.
  // Testing SE requires constructing TYPE_*_16_SE constants via ENDIAN16_SH(1).
  // ──────────────────────────────────────────────────────────────────────────

  // TFG Path 5: 16-bit RGB → 8-bit CMYK (most common 16-bit image path)
  {
    name: 'sRGB → eciCMYK v2 (16-bit → 8-bit)',
    profiles: ['sRGB', 'eciCMYK_v2'],
    inputColorSpace: 'RGB',
    outputColorSpace: 'CMYK',
    intent: INTENT_RELATIVE_COLORIMETRIC,
    flags: cmsFLAGS_BLACKPOINTCOMPENSATION,
    bitDepthOverrides: [
      {
        label: '16-bit → 8-bit',
        inputFormat: TYPE_RGB_16,
        outputFormat: TYPE_CMYK_8,
        inputArrayConstructor: Uint16Array,
        outputArrayConstructor: Uint8Array,
      },
    ],
  },
  // TFG Path 6: 16-bit RGB → Float32 CMYK (workaround path, sans SE)
  {
    name: 'sRGB → eciCMYK v2 (16-bit → Float32)',
    profiles: ['sRGB', 'eciCMYK_v2'],
    inputColorSpace: 'RGB',
    outputColorSpace: 'CMYK',
    intent: INTENT_RELATIVE_COLORIMETRIC,
    flags: cmsFLAGS_BLACKPOINTCOMPENSATION,
    bitDepthOverrides: [
      {
        label: '16-bit → Float32',
        inputFormat: TYPE_RGB_16,
        outputFormat: TYPE_CMYK_FLT,
        inputArrayConstructor: Uint16Array,
        outputArrayConstructor: Float32Array,
      },
    ],
  },
  // TFG Path 7: 8-bit RGB → Float32 Lab (sampler analysis path)
  {
    name: 'sRGB → Lab (8-bit → Float32)',
    profiles: ['sRGB', 'Lab'],
    inputColorSpace: 'RGB',
    outputColorSpace: 'Lab',
    intent: INTENT_RELATIVE_COLORIMETRIC,
    flags: 0,
    bitDepthOverrides: [
      {
        label: '8-bit → Float32',
        inputFormat: TYPE_RGB_8,
        outputFormat: TYPE_Lab_FLT,
        inputArrayConstructor: Uint8Array,
        outputArrayConstructor: Float32Array,
      },
    ],
  },
  // TFG Path 8: 8-bit Lab → Float32 Lab (sampler identity conversion)
  {
    name: 'Lab → Lab (8-bit → Float32)',
    profiles: ['Lab', 'Lab'],
    inputColorSpace: 'Lab',
    outputColorSpace: 'Lab',
    intent: INTENT_RELATIVE_COLORIMETRIC,
    flags: 0,
    bitDepthOverrides: [
      {
        label: '8-bit → Float32',
        inputFormat: TYPE_Lab_8,
        outputFormat: TYPE_Lab_FLT,
        inputArrayConstructor: Uint8Array,
        outputArrayConstructor: Float32Array,
      },
    ],
  },
  // TFG: 16-bit Gray → 8-bit CMYK (K-Only GCR, multiprofile)
  {
    name: 'sGray → sRGB → eciCMYK v2 (K-Only GCR, 16-bit → 8-bit)',
    profiles: ['sGray', 'sRGB', 'eciCMYK_v2'],
    inputColorSpace: 'Gray',
    outputColorSpace: 'CMYK',
    intent: INTENT_PRESERVE_K_ONLY_RELATIVE_COLORIMETRIC_GCR,
    flags: cmsFLAGS_BLACKPOINTCOMPENSATION,
    bitDepthOverrides: [
      {
        label: '16-bit → 8-bit',
        inputFormat: TYPE_GRAY_16,
        outputFormat: TYPE_CMYK_8,
        inputArrayConstructor: Uint16Array,
        outputArrayConstructor: Uint8Array,
      },
    ],
  },
];

/**
 * @typedef {{
 *   label: string,
 *   inputFormat: number,
 *   outputFormat: number,
 *   inputArrayConstructor: typeof Uint8Array | typeof Uint16Array | typeof Float32Array,
 *   outputArrayConstructor: typeof Uint8Array | typeof Uint16Array | typeof Float32Array,
 * }} BitDepthConfig
 */

/**
 * Get format constants for a color space at each bit depth
 * @param {ColorSpaceType} colorSpace
 * @returns {{ format8: number, format16: number, formatFloat: number }}
 */
function formatsFor(colorSpace) {
  switch (colorSpace) {
    case 'Gray': return { format8: TYPE_GRAY_8, format16: TYPE_GRAY_16, formatFloat: TYPE_GRAY_FLT };
    case 'RGB': return { format8: TYPE_RGB_8, format16: TYPE_RGB_16, formatFloat: TYPE_RGB_FLT };
    case 'CMYK': return { format8: TYPE_CMYK_8, format16: TYPE_CMYK_16, formatFloat: TYPE_CMYK_FLT };
    case 'Lab': return { format8: TYPE_Lab_8, format16: TYPE_Lab_16, formatFloat: TYPE_Lab_FLT };
  }
}

/**
 * Get bit depth configurations for a transform chain
 * @param {TransformChainConfig} chain
 * @returns {BitDepthConfig[]}
 */
function bitDepthsFor(chain) {
  const inputFormats = formatsFor(chain.inputColorSpace);
  const outputFormats = formatsFor(chain.outputColorSpace);
  return [
    {
      label: '8-bit',
      inputFormat: inputFormats.format8,
      outputFormat: outputFormats.format8,
      inputArrayConstructor: Uint8Array,
      outputArrayConstructor: Uint8Array,
    },
    {
      label: '16-bit',
      inputFormat: inputFormats.format16,
      outputFormat: outputFormats.format16,
      inputArrayConstructor: Uint16Array,
      outputArrayConstructor: Uint16Array,
    },
    {
      label: 'Float32',
      inputFormat: inputFormats.formatFloat,
      outputFormat: outputFormats.formatFloat,
      inputArrayConstructor: Float32Array,
      outputArrayConstructor: Float32Array,
    },
  ];
}

// ============================================================================
// Profile Loading
// ============================================================================

/**
 * @typedef {import('../../packages/color-engine/src/index.js').ColorEngine} ColorEngine
 */

/**
 * Load all profiles and return a name → handle map
 * @param {ColorEngine} engine
 * @returns {Promise<Map<string, number>>}
 */
async function loadProfiles(engine) {
  /** @type {Map<string, number>} */
  const profiles = new Map();

  // Built-in profiles
  profiles.set('sRGB', engine.createSRGBProfile());
  profiles.set('Lab', engine.createLab4Profile());
  profiles.set('sGray', engine.createGray2Profile());

  // File-based profiles
  const eciCMYKBuffer = await readFile(join(PROFILES_DIR, 'cmyk/eciCMYK_v2.icc'));
  profiles.set('eciCMYK_v2', engine.openProfileFromMem(new Uint8Array(eciCMYKBuffer)));

  // Verify all loaded
  for (const [name, handle] of profiles) {
    if (handle === 0) {
      throw new Error(`Failed to load profile: ${name}`);
    }
  }

  return profiles;
}

/**
 * Create a Lab Float32 analysis transform for a given profile + format
 * Used to convert input/output to Lab for Delta-E computation with minimal noise
 * @param {ColorEngine} engine
 * @param {number} profileHandle
 * @param {number} inputFormat - The float format for the color space
 * @param {number} labProfileHandle
 * @returns {number}
 */
function createLabAnalysisTransform(engine, profileHandle, inputFormat, labProfileHandle) {
  return engine.createMultiprofileTransform(
    [profileHandle, labProfileHandle],
    inputFormat,
    TYPE_Lab_FLT,
    INTENT_RELATIVE_COLORIMETRIC,
    0
  );
}

// ============================================================================
// Data Promotion (integer → float for analysis transforms)
// ============================================================================

/**
 * Promote typed array data to Float32 for analysis transform input.
 * Reverses the encoding applied during generateRandomInput.
 * @param {Uint8Array | Uint16Array | Float32Array} data
 * @param {ColorSpaceType} colorSpace
 * @param {number} pixelCount
 * @returns {Float32Array}
 */
function promoteToFloat32(data, colorSpace, pixelCount) {
  if (data instanceof Float32Array) return data;

  const channels = channelsFor(colorSpace);
  const float32 = new Float32Array(pixelCount * channels);

  if (colorSpace === 'Lab') {
    if (data instanceof Uint8Array) {
      for (let i = 0; i < pixelCount * channels; i++) {
        const channel = i % 3;
        if (channel === 0) {
          float32[i] = data[i] / 2.55;
        } else {
          float32[i] = data[i] > 127 ? data[i] - 256 : data[i];
        }
      }
    } else if (data instanceof Uint16Array) {
      for (let i = 0; i < pixelCount * channels; i++) {
        const channel = i % 3;
        if (channel === 0) {
          float32[i] = data[i] / 655.35;
        } else {
          const signed = data[i] > 32767 ? data[i] - 65536 : data[i];
          float32[i] = signed / 256;
        }
      }
    }
  } else if (colorSpace === 'CMYK') {
    // CMYK: TYPE_CMYK_FLT expects [0, 100] (100 = 100% ink coverage)
    if (data instanceof Uint8Array) {
      for (let i = 0; i < data.length; i++) {
        float32[i] = (data[i] / 255) * 100;
      }
    } else if (data instanceof Uint16Array) {
      for (let i = 0; i < data.length; i++) {
        float32[i] = (data[i] / 65535) * 100;
      }
    }
  } else {
    // RGB, Gray: [0, maxVal] → [0, 1]
    if (data instanceof Uint8Array) {
      for (let i = 0; i < data.length; i++) {
        float32[i] = data[i] / 255;
      }
    } else if (data instanceof Uint16Array) {
      for (let i = 0; i < data.length; i++) {
        float32[i] = data[i] / 65535;
      }
    }
  }

  return float32;
}

// ============================================================================
// Formatting Helpers
// ============================================================================

/** @param {number} value @param {number} [decimals=3] */
const round = (value, decimals = 3) => Math.round(value * 10 ** decimals) / 10 ** decimals;

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log('\nColor Engine Noise Characterization\n');
  console.log('='.repeat(80));
  console.log(`Pixels: ${PIXEL_COUNT.toLocaleString()} (${DUPLICATE_COUNT} duplicates)`);
  console.log(`Iterations: ${ITERATIONS}`);
  console.log(`RNG seed: ${RNG_SEED}`);
  console.log('='.repeat(80));

  const engine = await createEngine();
  const profiles = await loadProfiles(engine);

  // Load Lab profile handle for analysis transforms
  const labProfile = profiles.get('Lab');

  /** @type {Array<Record<string, any>>} */
  const summaryRows = [];

  for (const chain of TRANSFORM_CHAINS) {
    console.log(`\n${'─'.repeat(80)}`);
    console.log(`Chain: ${chain.name}`);
    console.log(`Profiles: ${chain.profiles.join(' → ')}`);
    console.log(`Intent: ${chain.intent === INTENT_PRESERVE_K_ONLY_RELATIVE_COLORIMETRIC_GCR ? 'K-Only GCR' : 'Relative Colorimetric'}`);
    console.log(`Flags: 0x${chain.flags.toString(16)}`);
    console.log('─'.repeat(80));

    // Resolve profile handles
    const profileHandles = chain.profiles.map(name => {
      const handle = profiles.get(name);
      if (!handle) throw new Error(`Profile not found: ${name}`);
      return handle;
    });

    // Generate input data for this chain's input color space
    const inputData = generateRandomInput(chain.inputColorSpace, PIXEL_COUNT, DUPLICATE_COUNT, RNG_SEED);

    const inputChannels = channelsFor(chain.inputColorSpace);
    const outputChannels = channelsFor(chain.outputColorSpace);

    // Create analysis transforms (float-to-float for minimal noise)
    const inputFormats = formatsFor(chain.inputColorSpace);
    const outputFormats = formatsFor(chain.outputColorSpace);

    const inputToLabTransform = createLabAnalysisTransform(
      engine, profileHandles[0], inputFormats.formatFloat, labProfile
    );
    const outputToLabTransform = createLabAnalysisTransform(
      engine, profileHandles[profileHandles.length - 1], outputFormats.formatFloat, labProfile
    );

    if (inputToLabTransform === 0) {
      console.log('  SKIP: Failed to create input → Lab analysis transform');
      continue;
    }
    if (outputToLabTransform === 0) {
      console.log('  SKIP: Failed to create output → Lab analysis transform');
      engine.deleteTransform(inputToLabTransform);
      continue;
    }

    // Convert input to Lab Float32 reference (once, reused across bit depths)
    const inputLabReference = new Float32Array(PIXEL_COUNT * 3);
    engine.doTransform(inputToLabTransform, inputData.float32, inputLabReference, PIXEL_COUNT);
    engine.deleteTransform(inputToLabTransform);

    const bitDepths = chain.bitDepthOverrides ?? bitDepthsFor(chain);
    for (const bitDepth of bitDepths) {
      console.log(`\n  [${bitDepth.label}]`);

      // Create the transform under test
      const transformHandle = engine.createMultiprofileTransform(
        profileHandles,
        bitDepth.inputFormat,
        bitDepth.outputFormat,
        chain.intent,
        chain.flags
      );

      if (transformHandle === 0) {
        console.log('    SKIP: Failed to create transform');
        continue;
      }

      // Select input data at the appropriate bit depth
      const ArrayConstructor = bitDepth.inputArrayConstructor;
      /** @type {Uint8Array | Uint16Array | Float32Array} */
      let inputBuffer;
      if (ArrayConstructor === Uint8Array) inputBuffer = inputData.uint8;
      else if (ArrayConstructor === Uint16Array) inputBuffer = inputData.uint16;
      else inputBuffer = inputData.float32;

      // Allocate output buffers for iterations
      const OutputConstructor = bitDepth.outputArrayConstructor;
      const outputBuffers = Array.from(
        { length: ITERATIONS },
        () => new OutputConstructor(PIXEL_COUNT * outputChannels)
      );

      // Run transform iterations with timing
      const timings = [];
      for (let iter = 0; iter < ITERATIONS; iter++) {
        const start = performance.now();
        engine.doTransform(transformHandle, inputBuffer, outputBuffers[iter], PIXEL_COUNT);
        timings.push(performance.now() - start);
      }

      // Between-iteration determinism check
      let betweenIterationIdentical = true;
      let betweenIterationMaxDiff = 0;
      for (let iter = 1; iter < ITERATIONS; iter++) {
        const comparison = compareArrays(outputBuffers[0], outputBuffers[iter]);
        if (!comparison.identical) {
          betweenIterationIdentical = false;
          betweenIterationMaxDiff = Math.max(betweenIterationMaxDiff, comparison.maxDiff);
        }
      }

      // Convert output to Lab Float32 for ΔEin computation
      const outputFloat = promoteToFloat32(outputBuffers[0], chain.outputColorSpace, PIXEL_COUNT);
      const outputLabSample = new Float32Array(PIXEL_COUNT * 3);
      engine.doTransform(outputToLabTransform, outputFloat, outputLabSample, PIXEL_COUNT);

      // ================================================================
      // Cross-Matched Sample Variability (PRIMARY metric)
      // ================================================================
      const inputColors = collectInputColors(inputBuffer, inputChannels, PIXEL_COUNT);
      const variability = computeVariability(
        inputColors, outputBuffers[0], outputChannels, outputLabSample
      );

      const v = variability.summary;
      console.log(`    Cross-Matched Sample Variability:`);
      console.log(`      Unique input colors with ≥2 occurrences: ${v.totalUniqueInputColors - (inputColors.size - [...inputColors.values()].filter(c => c.positions.length >= 2).length)}`);
      console.log(`      Colors with Variants > 1: ${v.colorsWithVariants}`);
      console.log(`      Mean Variants: ${round(v.meanVariants, 2)}`);
      console.log(`      Max Variants: ${v.maxVariants}`);
      console.log(`      Mean Coverage: ${round(v.meanCoverage, 4)}`);
      console.log(`      Min Coverage: ${round(v.minCoverage, 4)}`);
      console.log(`      Mean ΔEin: ${round(v.meanDeltaEin)}`);
      console.log(`      Max ΔEin: ${round(v.maxDeltaEin)}`);

      // Show lowest-coverage colors (most splitting)
      if (v.colorsWithVariants > 0) {
        const lowestCoverage = variability.colors.slice(0, Math.min(5, v.colorsWithVariants));
        console.group('      Lowest Coverage Colors:');
        console.table(lowestCoverage.map(c => ({
          Reference: c.reference.join(', '),
          Sample: c.sample.join(', '),
          Pixels: c.pixels,
          Overlaps: c.overlaps,
          Variants: c.variants,
          Coverage: round(c.coverage, 4),
          'Mean ΔEin': round(c.deltaEin.mean),
          'Max ΔEin': round(c.deltaEin.max),
        })));
        console.groupEnd();
      }

      // ================================================================
      // Supporting metrics
      // ================================================================
      const meanTime = timings.reduce((s, t) => s + t, 0) / timings.length;
      const inputUniqueColors = countUniqueColors(inputBuffer, inputChannels, PIXEL_COUNT);
      const outputUniqueColors = countUniqueColors(outputBuffers[0], outputChannels, PIXEL_COUNT);

      console.log(`    Between-iteration: ${betweenIterationIdentical ? 'IDENTICAL' : `DIFFERS (max diff: ${betweenIterationMaxDiff})`}`);
      console.log(`    Unique colors: input ${inputUniqueColors}, output ${outputUniqueColors} (${outputUniqueColors > inputUniqueColors ? '+' : ''}${outputUniqueColors - inputUniqueColors})`);
      console.log(`    Timing: ${round(meanTime, 2)} ms (mean of ${ITERATIONS} iterations)`);

      // Collect summary row (variability-first)
      summaryRows.push({
        Chain: chain.name,
        Depth: bitDepth.label,
        'Variants>1': v.colorsWithVariants,
        'Max Variants': v.maxVariants,
        'Min Coverage': round(v.minCoverage, 4),
        'Mean ΔEin': round(v.meanDeltaEin),
        'Max ΔEin': round(v.maxDeltaEin),
        'Deterministic': betweenIterationIdentical,
        'Unique In': inputUniqueColors,
        'Unique Out': outputUniqueColors,
      });

      engine.deleteTransform(transformHandle);
    }

    engine.deleteTransform(outputToLabTransform);
  }

  // Summary table
  console.log(`\n${'='.repeat(80)}`);
  console.log('SUMMARY');
  console.log('='.repeat(80));
  console.group();
  console.table(Object.fromEntries(summaryRows.map(({Chain, Depth, ...row}) => [`${Chain} [${Depth}]`, row])));
  console.groupEnd();

  // Clean up profiles
  for (const [, handle] of profiles) {
    engine.closeProfile(handle);
  }

  console.log('\nDone.\n');
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
