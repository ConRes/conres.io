/**
 * @fileoverview Multiprofile Blackpoint Scaling Conditional Tests
 *
 * Verifies that explicit blackpoint scaling in multiprofile float LUT pipeline:
 * - IS active when output profile produces lifted (non-pure) black
 * - IS skipped when output profile produces near-pure black
 *
 * When `cmsFLAGS_MULTIPROFILE_BLACKPOINT_SCALING` is set with
 * `cmsFLAGS_BLACKPOINTCOMPENSATION`, the float LUT sampler applies an XYZ
 * round-trip with scaling to correct lifted black. When the chain already maps
 * black to pure black, this round-trip is unnecessary and introduces float
 * precision noise.
 *
 * @author Saleh Abdel Motaal <dev@smotaal.io>
 * @ai Claude Opus 4.6 (code generation)
 * @license GPL-3.0-or-later
 */

import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import {
  createEngine,
  TYPE_RGB_8,
  INTENT_RELATIVE_COLORIMETRIC,
  cmsFLAGS_BLACKPOINTCOMPENSATION,
  cmsFLAGS_MULTIPROFILE_BLACKPOINT_SCALING,
} from '../../src/index.js';
import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, '../fixtures');

/**
 * Test colors covering the tonal range.
 */
const TEST_COLORS = [
  { name: 'pure black', rgb: [0, 0, 0] },
  { name: 'near black', rgb: [5, 5, 5] },
  { name: 'dark gray', rgb: [10, 10, 10] },
  { name: 'mid-gray', rgb: [128, 128, 128] },
  { name: 'light gray', rgb: [200, 200, 200] },
];

describe('Multiprofile Blackpoint Scaling Conditional', () => {
  let engine;
  const resources = [];

  beforeAll(async () => {
    engine = await createEngine();
  });

  afterEach(() => {
    for (const resource of resources.splice(0, resources.length)) {
      if (resource.type === 'transform') engine.deleteTransform(resource.handle);
      else if (resource.type === 'profile') engine.closeProfile(resource.handle);
    }
  });

  describe('Scaling active — FIPS output (lifted black)', () => {
    it('should produce different output with BPC vs without BPC for dark colors', async () => {
      const srgbProfile = engine.createSRGBProfile();
      resources.push({ type: 'profile', handle: srgbProfile });

      const fipsBuffer = await readFile(join(FIXTURES_DIR, 'profiles/rgb/FIPS_WIDE_28T-TYPEavg.icc'));
      const fipsProfile = engine.openProfileFromMem(new Uint8Array(fipsBuffer));
      resources.push({ type: 'profile', handle: fipsProfile });

      // With BPC + explicit blackpoint scaling
      const withBlackpointScaling = engine.createMultiprofileTransform(
        [srgbProfile, fipsProfile],
        TYPE_RGB_8,
        TYPE_RGB_8,
        INTENT_RELATIVE_COLORIMETRIC,
        cmsFLAGS_BLACKPOINTCOMPENSATION | cmsFLAGS_MULTIPROFILE_BLACKPOINT_SCALING
      );
      resources.push({ type: 'transform', handle: withBlackpointScaling });

      // Without BPC — float pipeline only, no scaling
      const withoutBlackpointScaling = engine.createMultiprofileTransform(
        [srgbProfile, fipsProfile],
        TYPE_RGB_8,
        TYPE_RGB_8,
        INTENT_RELATIVE_COLORIMETRIC,
        cmsFLAGS_MULTIPROFILE_BLACKPOINT_SCALING
      );
      resources.push({ type: 'transform', handle: withoutBlackpointScaling });

      // At least one dark color should differ — proves scaling IS active
      let anyDifference = false;
      for (const { name, rgb } of TEST_COLORS.filter(c => c.rgb[0] <= 10)) {
        const input = new Uint8Array(rgb);
        const outputScaled = new Uint8Array(3);
        const outputUnscaled = new Uint8Array(3);

        engine.doTransform(withBlackpointScaling, input, outputScaled, 1);
        engine.doTransform(withoutBlackpointScaling, input, outputUnscaled, 1);

        if (
          outputScaled[0] !== outputUnscaled[0] ||
          outputScaled[1] !== outputUnscaled[1] ||
          outputScaled[2] !== outputUnscaled[2]
        ) {
          anyDifference = true;
        }
      }

      expect(
        anyDifference,
        'FIPS output: BPC scaling should produce different dark color output than no BPC'
      ).toBe(true);
    });
  });

  describe('Scaling skipped — sRGB output (pure black)', () => {
    it('should produce identical output with BPC vs without BPC', async () => {
      const srgbProfile = engine.createSRGBProfile();
      resources.push({ type: 'profile', handle: srgbProfile });

      const srgbFileBuffer = await readFile(
        join(FIXTURES_DIR, 'profiles/rgb/sRGB IEC61966-2.1.icc')
      );
      const srgbFileProfile = engine.openProfileFromMem(new Uint8Array(srgbFileBuffer));
      resources.push({ type: 'profile', handle: srgbFileProfile });

      // With BPC + explicit blackpoint scaling — but scaling should be skipped
      // because sRGB output already produces pure black
      const withBlackpointScaling = engine.createMultiprofileTransform(
        [srgbProfile, srgbFileProfile],
        TYPE_RGB_8,
        TYPE_RGB_8,
        INTENT_RELATIVE_COLORIMETRIC,
        cmsFLAGS_BLACKPOINTCOMPENSATION | cmsFLAGS_MULTIPROFILE_BLACKPOINT_SCALING
      );
      resources.push({ type: 'transform', handle: withBlackpointScaling });

      // Without BPC — float pipeline only, no XYZ round-trip
      const withoutBlackpointScaling = engine.createMultiprofileTransform(
        [srgbProfile, srgbFileProfile],
        TYPE_RGB_8,
        TYPE_RGB_8,
        INTENT_RELATIVE_COLORIMETRIC,
        cmsFLAGS_MULTIPROFILE_BLACKPOINT_SCALING
      );
      resources.push({ type: 'transform', handle: withoutBlackpointScaling });

      for (const { name, rgb } of TEST_COLORS) {
        const input = new Uint8Array(rgb);
        const outputScaled = new Uint8Array(3);
        const outputUnscaled = new Uint8Array(3);

        engine.doTransform(withBlackpointScaling, input, outputScaled, 1);
        engine.doTransform(withoutBlackpointScaling, input, outputUnscaled, 1);

        expect(
          Array.from(outputScaled),
          `sRGB output — ${name}: BPC and non-BPC should be identical (scaling skipped)`
        ).toEqual(Array.from(outputUnscaled));
      }
    });
  });
});
