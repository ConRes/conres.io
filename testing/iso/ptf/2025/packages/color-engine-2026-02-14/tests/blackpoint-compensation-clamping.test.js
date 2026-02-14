/**
 * @fileoverview Blackpoint Compensation Clamping Parity Tests
 *
 * Validates that the blackpoint compensation clamping optimization produces
 * identical results to baseline Little-CMS for all supported bit depths.
 * The clamping optimization is purely a performance optimization — it must
 * not alter the transform output.
 *
 * Tests boundary pixels (data-range minimum and maximum) and non-boundary
 * pixels (mid-gray, chromatic red) across 8-bit, 16-bit, and Float32.
 *
 * @author Saleh Abdel Motaal <dev@smotaal.io>
 * @ai Claude Opus 4.6 (code generation)
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
  createEngine as createColorEngine,
  TYPE_RGB_8,
  TYPE_RGB_16,
  TYPE_RGB_FLT,
  TYPE_Lab_8,
  TYPE_Lab_16,
  TYPE_Lab_FLT,
  INTENT_RELATIVE_COLORIMETRIC,
  cmsFLAGS_NOCACHE,
  cmsFLAGS_NOOPTIMIZE,
  cmsFLAGS_BLACKPOINTCOMPENSATION,
  cmsFLAGS_BLACKPOINTCOMPENSATION_CLAMPING,
} from '../src/index.js';
import {
  createEngine as createBaselineEngine,
} from '../../little-cms/src/index.js';

const bitDepths = [
  {
    name: '8-bit',
    rgbType: TYPE_RGB_8,
    labType: TYPE_Lab_8,
    RGBArray: Uint8Array,
    LabArray: Uint8Array,
    labChannels: 3,
    pixels: {
      minimum: { rgb: [0, 0, 0], description: 'data-range minimum (black)' },
      maximum: { rgb: [255, 255, 255], description: 'data-range maximum (white)' },
      midGray: { rgb: [128, 128, 128], description: 'mid-gray (non-boundary)' },
      red: { rgb: [255, 0, 0], description: 'chromatic red (non-boundary)' },
    },
  },
  {
    name: '16-bit',
    rgbType: TYPE_RGB_16,
    labType: TYPE_Lab_16,
    RGBArray: Uint16Array,
    LabArray: Uint16Array,
    labChannels: 3,
    pixels: {
      minimum: { rgb: [0, 0, 0], description: 'data-range minimum (black)' },
      maximum: { rgb: [65535, 65535, 65535], description: 'data-range maximum (white)' },
      midGray: { rgb: [32768, 32768, 32768], description: 'mid-gray (non-boundary)' },
      red: { rgb: [65535, 0, 0], description: 'chromatic red (non-boundary)' },
    },
  },
  {
    name: 'Float32',
    rgbType: TYPE_RGB_FLT,
    labType: TYPE_Lab_FLT,
    RGBArray: Float32Array,
    LabArray: Float32Array,
    labChannels: 3,
    pixels: {
      minimum: { rgb: [0.0, 0.0, 0.0], description: 'data-range minimum (black)' },
      maximum: { rgb: [1.0, 1.0, 1.0], description: 'data-range maximum (white)' },
      midGray: { rgb: [0.5, 0.5, 0.5], description: 'mid-gray (non-boundary)' },
      red: { rgb: [1.0, 0.0, 0.0], description: 'chromatic red (non-boundary)' },
    },
  },
];

describe('Blackpoint Compensation Clamping: Parity with Baseline', () => {
  let baseline;
  let colorEngine;

  beforeAll(async () => {
    baseline = await createBaselineEngine();
    colorEngine = await createColorEngine();
  });

  for (const depth of bitDepths) {
    describe(`sRGB → Lab (${depth.name})`, () => {
      for (const [pixelName, pixelData] of Object.entries(depth.pixels)) {
        it(`${pixelName}: ${pixelData.description}`, () => {
          const baseFlags = cmsFLAGS_NOCACHE | cmsFLAGS_NOOPTIMIZE | cmsFLAGS_BLACKPOINTCOMPENSATION;

          /* Baseline: standard Little-CMS transform (no clamping flag) */
          const baselineRGB = baseline.createSRGBProfile();
          const baselineLab = baseline.createLab4Profile();
          const baselineTransform = baseline.createTransform(
            baselineRGB, depth.rgbType, baselineLab, depth.labType,
            INTENT_RELATIVE_COLORIMETRIC, baseFlags
          );
          const baselineInput = new depth.RGBArray(pixelData.rgb);
          const baselineOutput = new depth.LabArray(depth.labChannels);
          baseline.doTransform(baselineTransform, baselineInput, baselineOutput, 1);
          baseline.deleteTransform(baselineTransform);
          baseline.closeProfile(baselineRGB);
          baseline.closeProfile(baselineLab);

          /* Color-Engine: transform with clamping flag (transparent — no explicit init) */
          const engineRGB = colorEngine.createSRGBProfile();
          const engineLab = colorEngine.createLab4Profile();
          const engineTransform = colorEngine.createTransform(
            engineRGB, depth.rgbType, engineLab, depth.labType,
            INTENT_RELATIVE_COLORIMETRIC, baseFlags | cmsFLAGS_BLACKPOINTCOMPENSATION_CLAMPING
          );
          const engineInput = new depth.RGBArray(pixelData.rgb);
          const engineOutput = new depth.LabArray(depth.labChannels);
          colorEngine.doTransform(engineTransform, engineInput, engineOutput, 1);
          colorEngine.deleteTransform(engineTransform);
          colorEngine.closeProfile(engineRGB);
          colorEngine.closeProfile(engineLab);

          const baselineResult = Array.from(baselineOutput);
          const engineResult = Array.from(engineOutput);

          console.log(
            `${depth.name} ${pixelName} | Baseline: [${baselineResult}] | Color-Engine+Clamping: [${engineResult}]`
          );

          expect(
            engineResult,
            `Color-Engine with clamping should match Baseline for ${pixelName} (${depth.name})`
          ).toEqual(baselineResult);
        });
      }
    });
  }
});
