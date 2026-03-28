/**
 * @fileoverview Lab Mask Sentinel Tests
 *
 * Verifies the three Lab Mask Sentinel handling modes by comparing Color-Engine
 * (with Lab Mask Sentinel handling) against baseline Little-CMS (without).
 *
 * Lab Mask Sentinel Correction (Lab→non-Lab):
 *   Sentinel pixels are rewritten to neutral black (Lab 0/0/0) in the input
 *   buffer before transform. Validated by comparing Color-Engine (corrected)
 *   output against baseline Little-CMS (clipped) output — they must differ,
 *   and corrected output must have neutral-black properties.
 *
 * Lab Mask Sentinel Passthrough (Lab→Lab):
 *   Sentinel pixels are preserved in output after round-trip through transform.
 *
 * Lab Mask Sentinel Clipping (non-Lab input):
 *   No handling needed — non-Lab all-zero encoding IS neutral black.
 *
 * @author Saleh Abdel Motaal <dev@smotaal.io>
 * @ai Claude Opus 4.6 (code generation)
 */

import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import {
  createEngine as createColorEngine,
  TYPE_Lab_8,
  TYPE_Lab_16,
  TYPE_Lab_FLT,
  TYPE_CMYK_8,
  TYPE_CMYK_FLT,
  TYPE_RGB_8,
  TYPE_RGB_FLT,
  INTENT_RELATIVE_COLORIMETRIC,
  INTENT_PRESERVE_K_ONLY_RELATIVE_COLORIMETRIC_GCR,
  cmsFLAGS_NOCACHE
} from '../src/index.js';
import {
  createEngine as createBaselineEngine,
} from '../../little-cms/src/index.js';
import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, 'fixtures');

describe('Lab Mask Sentinel', () => {
  /** @type {import('../src/index.js').ColorEngine} Color-Engine (with Lab Mask Sentinel handling) */
  let engine;
  /** @type {import('../../little-cms/src/index.js').LittleCMSEngine} Baseline (without — shows Clipping) */
  let baseline;

  const engineResources = [];
  const baselineResources = [];

  beforeAll(async () => {
    engine = await createColorEngine();
    baseline = await createBaselineEngine();
  });

  afterEach(() => {
    for (const r of engineResources.splice(0)) {
      if (!r.handle) continue;
      if (r.type === 'transform') engine.deleteTransform(r.handle);
      else if (r.type === 'profile') engine.closeProfile(r.handle);
    }
    for (const r of baselineResources.splice(0)) {
      if (!r.handle) continue;
      if (r.type === 'transform') baseline.deleteTransform(r.handle);
      else if (r.type === 'profile') baseline.closeProfile(r.handle);
    }
  });

  /**
   * Create parallel Lab→CMYK transforms on both engines (same profiles, format, intent).
   * Returns handles for Color-Engine (with Correction) and baseline (Clipping).
   */
  async function createLabToCmykPair(inputFormat, outputFormat, intent = INTENT_RELATIVE_COLORIMETRIC) {
    const cmykBuffer = await readFile(join(FIXTURES_DIR, 'profiles/cmyk/CoatedFOGRA39.icc'));
    const cmykData = new Uint8Array(cmykBuffer);

    const labProfile = engine.createLab4Profile();
    const cmykProfile = engine.openProfileFromMem(cmykData);
    const transform = engine.createTransform(labProfile, inputFormat, cmykProfile, outputFormat, intent, cmsFLAGS_NOCACHE);
    engineResources.push({ type: 'profile', handle: labProfile }, { type: 'profile', handle: cmykProfile }, { type: 'transform', handle: transform });

    const bLabProfile = baseline.createLab4Profile();
    const bCmykProfile = baseline.openProfileFromMem(cmykData);
    const bTransform = baseline.createTransform(bLabProfile, inputFormat, bCmykProfile, outputFormat, intent, cmsFLAGS_NOCACHE);
    baselineResources.push({ type: 'profile', handle: bLabProfile }, { type: 'profile', handle: bCmykProfile }, { type: 'transform', handle: bTransform });

    return { transform, baselineTransform: bTransform };
  }

  /* ======================================================================== */
  /* Lab Mask Sentinel Correction — Lab to CMYK                               */
  /* ======================================================================== */

  describe('Lab Mask Sentinel Correction — Lab to CMYK', () => {
    it('8-bit Lab → CMYK: corrected output differs from clipped and is near neutral black', async () => {
      const { transform, baselineTransform } = await createLabToCmykPair(TYPE_Lab_8, TYPE_CMYK_8);

      const correctedOutput = new Uint8Array(4);
      const clippedOutput = new Uint8Array(4);

      // Baseline: Lab Mask Sentinel Clipping (gamut-clipped garbage)
      baseline.doTransform(baselineTransform, new Uint8Array([0, 0, 0]), clippedOutput, 1);

      // Color-Engine: Lab Mask Sentinel Correction (neutral black)
      engine.doTransform(transform, new Uint8Array([0, 0, 0]), correctedOutput, 1);

      // Corrected output must differ from clipped output (proves correction happened)
      expect(Array.from(correctedOutput)).not.toEqual(Array.from(clippedOutput));

      // Corrected output must be near neutral black: K-dominant CMYK
      expect(correctedOutput[3]).toBeGreaterThan(200); // K > ~78% (8-bit: 0-255)
    });

    it('16-bit Lab → CMYK: corrected output differs from clipped and is near neutral black', async () => {
      const { transform, baselineTransform } = await createLabToCmykPair(TYPE_Lab_16, TYPE_CMYK_8);

      const correctedOutput = new Uint8Array(4);
      const clippedOutput = new Uint8Array(4);

      // Baseline: Clipping
      baseline.doTransform(baselineTransform, new Uint16Array([0, 0, 0]), clippedOutput, 1);

      // Color-Engine: Correction
      engine.doTransform(transform, new Uint16Array([0, 0, 0]), correctedOutput, 1);

      expect(Array.from(correctedOutput)).not.toEqual(Array.from(clippedOutput));
      expect(correctedOutput[3]).toBeGreaterThan(200);
    });

    it('Float32 Lab → CMYK: corrected output differs from clipped and is near neutral black', async () => {
      const { transform, baselineTransform } = await createLabToCmykPair(TYPE_Lab_FLT, TYPE_CMYK_FLT);

      const correctedOutput = new Float32Array(4);
      const clippedOutput = new Float32Array(4);

      // Baseline: Clipping
      baseline.doTransform(baselineTransform, new Float32Array([0.0, -128.0, -128.0]), clippedOutput, 1);

      // Color-Engine: Correction
      engine.doTransform(transform, new Float32Array([0.0, -128.0, -128.0]), correctedOutput, 1);

      expect(Array.from(correctedOutput)).not.toEqual(Array.from(clippedOutput));

      // Float32 CMYK: 0-100 range. Neutral black is K-dominant but CMY may be
      // non-zero for standard Relative Colorimetric (4-color black is normal).
      // K-only output is only guaranteed for K-Only GCR intent.
      expect(correctedOutput[3]).toBeGreaterThan(80); // K > 80%
    });
  });

  /* ======================================================================== */
  /* Lab Mask Sentinel Correction — Lab to RGB                                */
  /* ======================================================================== */

  describe('Lab Mask Sentinel Correction — Lab to RGB', () => {
    it('8-bit Lab → sRGB: corrected output differs from clipped and is near RGB black', async () => {
      const labProfile = engine.createLab4Profile();
      const rgbProfile = engine.createSRGBProfile();
      const transform = engine.createTransform(labProfile, TYPE_Lab_8, rgbProfile, TYPE_RGB_8, INTENT_RELATIVE_COLORIMETRIC, cmsFLAGS_NOCACHE);
      engineResources.push({ type: 'profile', handle: labProfile }, { type: 'profile', handle: rgbProfile }, { type: 'transform', handle: transform });

      const bLabProfile = baseline.createLab4Profile();
      const bRgbProfile = baseline.createSRGBProfile();
      const bTransform = baseline.createTransform(bLabProfile, TYPE_Lab_8, bRgbProfile, TYPE_RGB_8, INTENT_RELATIVE_COLORIMETRIC, cmsFLAGS_NOCACHE);
      baselineResources.push({ type: 'profile', handle: bLabProfile }, { type: 'profile', handle: bRgbProfile }, { type: 'transform', handle: bTransform });

      const correctedOutput = new Uint8Array(3);
      const clippedOutput = new Uint8Array(3);

      // Baseline: Clipping
      baseline.doTransform(bTransform, new Uint8Array([0, 0, 0]), clippedOutput, 1);

      // Color-Engine: Correction
      engine.doTransform(transform, new Uint8Array([0, 0, 0]), correctedOutput, 1);

      expect(Array.from(correctedOutput)).not.toEqual(Array.from(clippedOutput));

      // Corrected output must be near RGB black
      expect(correctedOutput[0]).toBeLessThanOrEqual(1);
      expect(correctedOutput[1]).toBeLessThanOrEqual(1);
      expect(correctedOutput[2]).toBeLessThanOrEqual(1);
    });
  });

  /* ======================================================================== */
  /* Lab Mask Sentinel Passthrough — Lab to Lab                               */
  /* ======================================================================== */

  describe('Lab Mask Sentinel Passthrough — Lab to Lab', () => {
    it('2-profile Lab → Lab: sentinel preserved as all-zero bytes in output', async () => {
      const labProfile1 = engine.createLab4Profile();
      const labProfile2 = engine.createLab4Profile();
      const transform = engine.createTransform(labProfile1, TYPE_Lab_8, labProfile2, TYPE_Lab_8, INTENT_RELATIVE_COLORIMETRIC, cmsFLAGS_NOCACHE);
      engineResources.push({ type: 'profile', handle: labProfile1 }, { type: 'profile', handle: labProfile2 }, { type: 'transform', handle: transform });

      const labOutput = new Uint8Array(3);
      engine.doTransform(transform, new Uint8Array([0, 0, 0]), labOutput, 1);

      // Passthrough: sentinel preserved (all-zero bytes = Lab 0/-128/-128)
      expect(labOutput[0]).toBe(0);
      expect(labOutput[1]).toBe(0);
      expect(labOutput[2]).toBe(0);
    });

    it('multi-profile Lab → sRGB → Lab: sentinel preserved despite lossy intermediate', async () => {
      const labProfile1 = engine.createLab4Profile();
      const rgbProfile = engine.createSRGBProfile();
      const labProfile2 = engine.createLab4Profile();
      const transform = engine.createMultiprofileTransform(
        [labProfile1, rgbProfile, labProfile2],
        TYPE_Lab_8, TYPE_Lab_8, INTENT_RELATIVE_COLORIMETRIC, cmsFLAGS_NOCACHE
      );
      engineResources.push(
        { type: 'profile', handle: labProfile1 },
        { type: 'profile', handle: rgbProfile },
        { type: 'profile', handle: labProfile2 },
        { type: 'transform', handle: transform }
      );

      const labOutput = new Uint8Array(3);
      engine.doTransform(transform, new Uint8Array([0, 0, 0]), labOutput, 1);

      // Passthrough: sentinel preserved (all-zero bytes = Lab 0/-128/-128)
      // Without Passthrough, Lab→sRGB→Lab round-trip would produce non-zero output
      expect(labOutput[0]).toBe(0);
      expect(labOutput[1]).toBe(0);
      expect(labOutput[2]).toBe(0);
    });
  });

  /* ======================================================================== */
  /* Lab Mask Sentinel Correction — Multi-profile                             */
  /* ======================================================================== */

  describe('Lab Mask Sentinel Correction — Multi-profile', () => {
    it('Lab → sRGB → CMYK: corrected output differs from clipped', async () => {
      const cmykBuffer = await readFile(join(FIXTURES_DIR, 'profiles/cmyk/CoatedFOGRA39.icc'));
      const cmykData = new Uint8Array(cmykBuffer);

      // Color-Engine: 3-profile multiprofile transform (with Correction)
      const labProfile = engine.createLab4Profile();
      const rgbProfile = engine.createSRGBProfile();
      const cmykProfile = engine.openProfileFromMem(cmykData);
      const transform = engine.createMultiprofileTransform(
        [labProfile, rgbProfile, cmykProfile],
        TYPE_Lab_8, TYPE_CMYK_8, INTENT_RELATIVE_COLORIMETRIC, cmsFLAGS_NOCACHE
      );
      engineResources.push(
        { type: 'profile', handle: labProfile },
        { type: 'profile', handle: rgbProfile },
        { type: 'profile', handle: cmykProfile },
        { type: 'transform', handle: transform }
      );

      // Baseline: 2-profile Lab→CMYK (without Correction — shows Clipping)
      // Uses 2-profile because baseline may not support 3-profile multiprofile chains.
      // The sentinel clipping behavior is the same regardless of chain length.
      const bLabProfile = baseline.createLab4Profile();
      const bCmykProfile = baseline.openProfileFromMem(cmykData);
      const bTransform = baseline.createTransform(
        bLabProfile, TYPE_Lab_8, bCmykProfile, TYPE_CMYK_8,
        INTENT_RELATIVE_COLORIMETRIC, cmsFLAGS_NOCACHE
      );
      baselineResources.push(
        { type: 'profile', handle: bLabProfile },
        { type: 'profile', handle: bCmykProfile },
        { type: 'transform', handle: bTransform }
      );

      const correctedOutput = new Uint8Array(4);
      const clippedOutput = new Uint8Array(4);

      // Baseline: Clipping (sentinel gamut-clipped by LittleCMS)
      baseline.doTransform(bTransform, new Uint8Array([0, 0, 0]), clippedOutput, 1);

      // Color-Engine: Correction (sentinel rewritten to neutral black before transform)
      engine.doTransform(transform, new Uint8Array([0, 0, 0]), correctedOutput, 1);

      // Corrected multiprofile output must differ from clipped baseline
      expect(Array.from(correctedOutput)).not.toEqual(Array.from(clippedOutput));
      expect(correctedOutput[3]).toBeGreaterThan(200); // K-dominant
    });
  });

  /* ======================================================================== */
  /* Lab Mask Sentinel Correction — K-Only GCR                                */
  /* ======================================================================== */

  describe('Lab Mask Sentinel Correction — K-Only GCR', () => {
    it('Float32 Lab → CMYK (K-Only GCR): sentinel produces K-only black', async () => {
      // Baseline comparison omitted: baseline does not support K-Only GCR intent.
      // Property-based assertions validate corrected output directly.
      const labProfile = engine.createLab4Profile();
      engineResources.push({ type: 'profile', handle: labProfile });
      const cmykBuffer = await readFile(join(FIXTURES_DIR, 'profiles/cmyk/CoatedFOGRA39.icc'));
      const cmykProfile = engine.openProfileFromMem(new Uint8Array(cmykBuffer));
      engineResources.push({ type: 'profile', handle: cmykProfile });
      const transform = engine.createTransform(
        labProfile, TYPE_Lab_FLT, cmykProfile, TYPE_CMYK_FLT,
        INTENT_PRESERVE_K_ONLY_RELATIVE_COLORIMETRIC_GCR, cmsFLAGS_NOCACHE
      );
      engineResources.push({ type: 'transform', handle: transform });

      const sentinelOutput = new Float32Array(4);
      engine.doTransform(transform, new Float32Array([0.0, -128.0, -128.0]), sentinelOutput, 1);

      // Corrected sentinel must produce K-only black (Float32 CMYK: 0-100 range)
      expect(sentinelOutput[0]).toBeLessThanOrEqual(0.5); // C near 0%
      expect(sentinelOutput[1]).toBeLessThanOrEqual(0.5); // M near 0%
      expect(sentinelOutput[2]).toBeLessThanOrEqual(0.5); // Y near 0%
      expect(sentinelOutput[3]).toBeGreaterThan(90);       // K near 100%
    });
  });

  /* ======================================================================== */
  /* Lab Mask Sentinel Clipping — Non-Lab Control                             */
  /* ======================================================================== */

  describe('Lab Mask Sentinel Clipping — Non-Lab Control', () => {
    it('RGB all-zero input is NOT treated as sentinel (produces normal black output)', async () => {
      const rgbProfile = engine.createSRGBProfile();
      const cmykBuffer = await readFile(join(FIXTURES_DIR, 'profiles/cmyk/CoatedFOGRA39.icc'));
      const cmykProfile = engine.openProfileFromMem(new Uint8Array(cmykBuffer));
      const transform = engine.createTransform(
        rgbProfile, TYPE_RGB_8, cmykProfile, TYPE_CMYK_8,
        INTENT_RELATIVE_COLORIMETRIC, cmsFLAGS_NOCACHE
      );
      engineResources.push(
        { type: 'profile', handle: rgbProfile },
        { type: 'profile', handle: cmykProfile },
        { type: 'transform', handle: transform }
      );

      // RGB [0, 0, 0] IS neutral black (not a sentinel)
      const cmykOutput = new Uint8Array(4);
      engine.doTransform(transform, new Uint8Array([0, 0, 0]), cmykOutput, 1);

      // RGB black should produce substantial ink
      const totalInk = cmykOutput[0] + cmykOutput[1] + cmykOutput[2] + cmykOutput[3];
      expect(totalInk).toBeGreaterThan(200);
    });
  });

  /* ======================================================================== */
  /* Lab Mask Sentinel Correction — Mixed Buffer                              */
  /* ======================================================================== */

  describe('Lab Mask Sentinel Correction — Mixed Buffer', () => {
    it('only sentinel pixels are corrected; non-sentinel pixels unaffected', async () => {
      const { transform, baselineTransform } = await createLabToCmykPair(TYPE_Lab_8, TYPE_CMYK_8);

      // Get clipped sentinel output from baseline (to verify correction differs)
      const clippedSentinelOutput = new Uint8Array(4);
      baseline.doTransform(baselineTransform, new Uint8Array([0, 0, 0]), clippedSentinelOutput, 1);

      // Get expected mid-gray output (Lab ~50/0/0 in 8-bit: [128, 128, 128])
      const expectedMidGrayOutput = new Uint8Array(4);
      engine.doTransform(transform, new Uint8Array([128, 128, 128]), expectedMidGrayOutput, 1);

      // Mixed buffer: 4 pixels — alternating sentinel and mid-gray
      const mixedInput = new Uint8Array([
        0, 0, 0,         // pixel 0: sentinel (Lab 0/-128/-128)
        128, 128, 128,   // pixel 1: mid-gray (Lab ~50/0/0)
        0, 0, 0,         // pixel 2: sentinel
        128, 128, 128    // pixel 3: mid-gray
      ]);
      const mixedOutput = new Uint8Array(16); // 4 pixels × 4 CMYK channels
      engine.doTransform(transform, mixedInput, mixedOutput, 4);

      // Sentinel pixels (0, 2): corrected output must differ from clipped
      expect(Array.from(mixedOutput.subarray(0, 4))).not.toEqual(Array.from(clippedSentinelOutput));
      expect(Array.from(mixedOutput.subarray(8, 12))).not.toEqual(Array.from(clippedSentinelOutput));

      // Sentinel pixels (0, 2): must be K-dominant (near neutral black)
      expect(mixedOutput[3]).toBeGreaterThan(200);
      expect(mixedOutput[11]).toBeGreaterThan(200);

      // Non-sentinel pixels (1, 3): must match individually-transformed mid-gray
      expect(Array.from(mixedOutput.subarray(4, 8))).toEqual(Array.from(expectedMidGrayOutput));
      expect(Array.from(mixedOutput.subarray(12, 16))).toEqual(Array.from(expectedMidGrayOutput));
    });
  });
});
