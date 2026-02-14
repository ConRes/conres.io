/**
 * @fileoverview K-Only GCR Fallback Tests
 *
 * Verifies that profiles which don't require K-Only GCR (Maximum GCR profiles)
 * fall back to Relative Colorimetric, producing byte-exact identical output.
 *
 * Also verifies that standard profiles (e.g. CoatedFOGRA39) do NOT fall back —
 * K-Only GCR produces different output from Relative Colorimetric.
 *
 * @author Saleh Abdel Motaal <dev@smotaal.io>
 * @ai Claude Opus 4.6 (code generation)
 * @license GPL-3.0-or-later
 */

import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import {
  createEngine,
  TYPE_RGB_8,
  TYPE_CMYK_8,
  INTENT_RELATIVE_COLORIMETRIC,
  INTENT_PRESERVE_K_ONLY_RELATIVE_COLORIMETRIC_GCR,
  cmsFLAGS_NOCACHE
} from '../../src/index.js';
import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, '../fixtures');

/**
 * Maximum GCR profiles — these already enforce K-only behavior natively.
 * K-Only GCR should detect this and fall back to Relative Colorimetric.
 */
const MAXIMUM_GCR_PROFILES = [
  'Eurostandard (Coated) Maximum GCR.icc',
  'FOGRA39 (Coated) Maximum GCR.icc',
  'SWOP (Coated) Maximum GCR.icc',
];

/**
 * Test colors — a variety of chromatic and achromatic inputs.
 * Using 8-bit RGB values.
 */
const TEST_COLORS = [
  { name: 'pure red', rgb: [255, 0, 0] },
  { name: 'mid-gray', rgb: [128, 128, 128] },
  { name: '25% gray', rgb: [192, 192, 192] },
  { name: 'pure blue', rgb: [0, 0, 255] },
  { name: 'pure green', rgb: [0, 255, 0] },
];

describe('K-Only GCR Fallback to Relative Colorimetric', () => {
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

  describe('Positive — Maximum GCR profiles produce identical output', () => {
    for (const profileName of MAXIMUM_GCR_PROFILES) {
      it(`should fall back to Relative Colorimetric for ${profileName}`, async () => {
        const rgbProfile = engine.createSRGBProfile();
        resources.push({ type: 'profile', handle: rgbProfile });

        const cmykBuffer = await readFile(join(FIXTURES_DIR, 'profiles/cmyk', profileName));
        const cmykProfile = engine.openProfileFromMem(new Uint8Array(cmykBuffer));
        resources.push({ type: 'profile', handle: cmykProfile });

        // K-Only GCR transform
        const kOnlyTransform = engine.createTransform(
          rgbProfile,
          TYPE_RGB_8,
          cmykProfile,
          TYPE_CMYK_8,
          INTENT_PRESERVE_K_ONLY_RELATIVE_COLORIMETRIC_GCR,
          cmsFLAGS_NOCACHE
        );
        resources.push({ type: 'transform', handle: kOnlyTransform });

        // Relative Colorimetric transform (the expected fallback)
        const relativeTransform = engine.createTransform(
          rgbProfile,
          TYPE_RGB_8,
          cmykProfile,
          TYPE_CMYK_8,
          INTENT_RELATIVE_COLORIMETRIC,
          cmsFLAGS_NOCACHE
        );
        resources.push({ type: 'transform', handle: relativeTransform });

        for (const { name, rgb } of TEST_COLORS) {
          const input = new Uint8Array(rgb);
          const kOnlyOutput = new Uint8Array(4);
          const relativeOutput = new Uint8Array(4);

          engine.doTransform(kOnlyTransform, input, kOnlyOutput, 1);
          engine.doTransform(relativeTransform, input, relativeOutput, 1);

          expect(
            Array.from(kOnlyOutput),
            `${profileName} — ${name}: K-Only GCR should match Relative Colorimetric`
          ).toEqual(Array.from(relativeOutput));
        }
      });
    }
  });

  describe('Negative guard — standard profiles do NOT fall back', () => {
    it('should produce different output for CoatedFOGRA39.icc', async () => {
      const rgbProfile = engine.createSRGBProfile();
      resources.push({ type: 'profile', handle: rgbProfile });

      const cmykBuffer = await readFile(join(FIXTURES_DIR, 'profiles/cmyk/CoatedFOGRA39.icc'));
      const cmykProfile = engine.openProfileFromMem(new Uint8Array(cmykBuffer));
      resources.push({ type: 'profile', handle: cmykProfile });

      // K-Only GCR transform
      const kOnlyTransform = engine.createTransform(
        rgbProfile,
        TYPE_RGB_8,
        cmykProfile,
        TYPE_CMYK_8,
        INTENT_PRESERVE_K_ONLY_RELATIVE_COLORIMETRIC_GCR,
        cmsFLAGS_NOCACHE
      );
      resources.push({ type: 'transform', handle: kOnlyTransform });

      // Relative Colorimetric transform
      const relativeTransform = engine.createTransform(
        rgbProfile,
        TYPE_RGB_8,
        cmykProfile,
        TYPE_CMYK_8,
        INTENT_RELATIVE_COLORIMETRIC,
        cmsFLAGS_NOCACHE
      );
      resources.push({ type: 'transform', handle: relativeTransform });

      // Mid-gray: K-Only GCR enforces K-only neutral, Relative Colorimetric uses CMY+K
      const input = new Uint8Array([128, 128, 128]);
      const kOnlyOutput = new Uint8Array(4);
      const relativeOutput = new Uint8Array(4);

      engine.doTransform(kOnlyTransform, input, kOnlyOutput, 1);
      engine.doTransform(relativeTransform, input, relativeOutput, 1);

      // K-Only GCR should enforce C=M=Y=0 for neutral gray
      const kOnlyCMY = kOnlyOutput[0] + kOnlyOutput[1] + kOnlyOutput[2];
      expect(kOnlyCMY, 'K-Only GCR should produce K-only output for neutral gray').toBe(0);

      // Relative Colorimetric does NOT enforce K-only — CMY should be non-zero
      const relativeCMY = relativeOutput[0] + relativeOutput[1] + relativeOutput[2];
      expect(relativeCMY, 'Relative Colorimetric should produce CMY+K for neutral gray').toBeGreaterThan(0);

      // Therefore they must differ
      expect(
        Array.from(kOnlyOutput),
        'K-Only GCR and Relative Colorimetric should differ for standard profile'
      ).not.toEqual(Array.from(relativeOutput));
    });
  });
});
