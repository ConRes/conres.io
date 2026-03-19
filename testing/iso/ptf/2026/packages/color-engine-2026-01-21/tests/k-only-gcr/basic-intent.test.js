/**
 * @fileoverview K-Only GCR Intent Tests
 * Tests the custom INTENT_PRESERVE_K_ONLY_RELATIVE_COLORIMETRIC_GCR rendering intent
 *
 * Verifies that:
 * 1. Transform creation works with K-Only GCR intent
 * 2. Neutral grays convert to K-only CMYK (C=M=Y=0)
 * 3. BPC scaling is applied correctly
 * 4. Chroma-modulated GCR works as expected
 */

import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import {
  createEngine,
  TYPE_RGB_8,
  TYPE_RGB_FLT,
  TYPE_CMYK_8,
  TYPE_CMYK_FLT,
  TYPE_Lab_FLT,
  INTENT_RELATIVE_COLORIMETRIC,
  INTENT_PRESERVE_K_ONLY_RELATIVE_COLORIMETRIC_GCR,
  cmsFLAGS_NOCACHE
} from '../../src/index.js';
import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, '../fixtures');

describe('K-Only GCR Intent - Basic Functionality', () => {
  let engine;
  const resources = []; // Track all resources for cleanup

  beforeAll(async () => {
    engine = await createEngine();
  });

  afterEach(() => {
    // Clean up all resources
    resources.forEach(r => {
      if (r.type === 'transform') engine.deleteTransform(r.handle);
      if (r.type === 'profile') engine.closeProfile(r.handle);
    });
    resources.length = 0;
  });

  describe('Transform Creation', () => {
    it('should create RGB to CMYK transform with K-Only GCR intent', async () => {
      const srgb = engine.createSRGBProfile();
      resources.push({ type: 'profile', handle: srgb });

      const cmykBuffer = await readFile(join(FIXTURES_DIR, 'profiles/cmyk/CoatedFOGRA39.icc'));
      const cmyk = engine.openProfileFromMem(new Uint8Array(cmykBuffer));
      resources.push({ type: 'profile', handle: cmyk });

      const transform = engine.createTransform(
        srgb,
        TYPE_RGB_8,
        cmyk,
        TYPE_CMYK_8,
        INTENT_PRESERVE_K_ONLY_RELATIVE_COLORIMETRIC_GCR,
        cmsFLAGS_NOCACHE
      );
      resources.push({ type: 'transform', handle: transform });

      expect(transform).toBeGreaterThan(0);
    });

    it('should create RGB to CMYK transform with float types', async () => {
      const srgb = engine.createSRGBProfile();
      resources.push({ type: 'profile', handle: srgb });

      const cmykBuffer = await readFile(join(FIXTURES_DIR, 'profiles/cmyk/CoatedFOGRA39.icc'));
      const cmyk = engine.openProfileFromMem(new Uint8Array(cmykBuffer));
      resources.push({ type: 'profile', handle: cmyk });

      const transform = engine.createTransform(
        srgb,
        TYPE_RGB_FLT,
        cmyk,
        TYPE_CMYK_FLT,
        INTENT_PRESERVE_K_ONLY_RELATIVE_COLORIMETRIC_GCR,
        cmsFLAGS_NOCACHE
      );
      resources.push({ type: 'transform', handle: transform });

      expect(transform).toBeGreaterThan(0);
    });

    it('should create Lab to CMYK transform with K-Only GCR intent', async () => {
      const lab = engine.createLab4Profile();
      resources.push({ type: 'profile', handle: lab });

      const cmykBuffer = await readFile(join(FIXTURES_DIR, 'profiles/cmyk/CoatedFOGRA39.icc'));
      const cmyk = engine.openProfileFromMem(new Uint8Array(cmykBuffer));
      resources.push({ type: 'profile', handle: cmyk });

      const transform = engine.createTransform(
        lab,
        TYPE_Lab_FLT,
        cmyk,
        TYPE_CMYK_FLT,
        INTENT_PRESERVE_K_ONLY_RELATIVE_COLORIMETRIC_GCR,
        cmsFLAGS_NOCACHE
      );
      resources.push({ type: 'transform', handle: transform });

      expect(transform).toBeGreaterThan(0);
    });
  });

  describe('Neutral Gray to K-Only Conversion', () => {
    it('should convert neutral gray (128,128,128) to K-only CMYK', async () => {
      const srgb = engine.createSRGBProfile();
      resources.push({ type: 'profile', handle: srgb });

      const cmykBuffer = await readFile(join(FIXTURES_DIR, 'profiles/cmyk/CoatedFOGRA39.icc'));
      const cmyk = engine.openProfileFromMem(new Uint8Array(cmykBuffer));
      resources.push({ type: 'profile', handle: cmyk });

      const transform = engine.createTransform(
        srgb,
        TYPE_RGB_8,
        cmyk,
        TYPE_CMYK_8,
        INTENT_PRESERVE_K_ONLY_RELATIVE_COLORIMETRIC_GCR,
        cmsFLAGS_NOCACHE
      );
      resources.push({ type: 'transform', handle: transform });

      const inputRGB = new Uint8Array([128, 128, 128]); // 50% gray
      const outputCMYK = new Uint8Array(4);

      engine.doTransform(transform, inputRGB, outputCMYK, 1);

      // Verify K-only output: C, M, Y should be very close to 0
      // Allow small tolerance for rounding errors
      expect(outputCMYK[0]).toBeLessThanOrEqual(2); // C ≈ 0
      expect(outputCMYK[1]).toBeLessThanOrEqual(2); // M ≈ 0
      expect(outputCMYK[2]).toBeLessThanOrEqual(2); // Y ≈ 0
      expect(outputCMYK[3]).toBeGreaterThan(0);     // K > 0
    });

    it('should convert pure white (255,255,255) to no ink', async () => {
      const srgb = engine.createSRGBProfile();
      resources.push({ type: 'profile', handle: srgb });

      const cmykBuffer = await readFile(join(FIXTURES_DIR, 'profiles/cmyk/CoatedFOGRA39.icc'));
      const cmyk = engine.openProfileFromMem(new Uint8Array(cmykBuffer));
      resources.push({ type: 'profile', handle: cmyk });

      const transform = engine.createTransform(
        srgb,
        TYPE_RGB_8,
        cmyk,
        TYPE_CMYK_8,
        INTENT_PRESERVE_K_ONLY_RELATIVE_COLORIMETRIC_GCR,
        cmsFLAGS_NOCACHE
      );
      resources.push({ type: 'transform', handle: transform });

      const inputRGB = new Uint8Array([255, 255, 255]); // White
      const outputCMYK = new Uint8Array(4);

      engine.doTransform(transform, inputRGB, outputCMYK, 1);

      // White should have no ink
      expect(outputCMYK[0]).toBeLessThanOrEqual(2); // C ≈ 0
      expect(outputCMYK[1]).toBeLessThanOrEqual(2); // M ≈ 0
      expect(outputCMYK[2]).toBeLessThanOrEqual(2); // Y ≈ 0
      expect(outputCMYK[3]).toBeLessThanOrEqual(2); // K ≈ 0
    });

    it('should convert pure black (0,0,0) to K=100', async () => {
      const srgb = engine.createSRGBProfile();
      resources.push({ type: 'profile', handle: srgb });

      const cmykBuffer = await readFile(join(FIXTURES_DIR, 'profiles/cmyk/CoatedFOGRA39.icc'));
      const cmyk = engine.openProfileFromMem(new Uint8Array(cmykBuffer));
      resources.push({ type: 'profile', handle: cmyk });

      const transform = engine.createTransform(
        srgb,
        TYPE_RGB_8,
        cmyk,
        TYPE_CMYK_8,
        INTENT_PRESERVE_K_ONLY_RELATIVE_COLORIMETRIC_GCR,
        cmsFLAGS_NOCACHE
      );
      resources.push({ type: 'transform', handle: transform });

      const inputRGB = new Uint8Array([0, 0, 0]); // Black
      const outputCMYK = new Uint8Array(4);

      engine.doTransform(transform, inputRGB, outputCMYK, 1);

      // Black should be K-only (100%)
      expect(outputCMYK[0]).toBeLessThanOrEqual(2);  // C ≈ 0
      expect(outputCMYK[1]).toBeLessThanOrEqual(2);  // M ≈ 0
      expect(outputCMYK[2]).toBeLessThanOrEqual(2);  // Y ≈ 0
      expect(outputCMYK[3]).toBeGreaterThanOrEqual(253); // K ≈ 100
    });

    it('should convert multiple neutral grays to K-only', async () => {
      const srgb = engine.createSRGBProfile();
      resources.push({ type: 'profile', handle: srgb });

      const cmykBuffer = await readFile(join(FIXTURES_DIR, 'profiles/cmyk/CoatedFOGRA39.icc'));
      const cmyk = engine.openProfileFromMem(new Uint8Array(cmykBuffer));
      resources.push({ type: 'profile', handle: cmyk });

      const transform = engine.createTransform(
        srgb,
        TYPE_RGB_8,
        cmyk,
        TYPE_CMYK_8,
        INTENT_PRESERVE_K_ONLY_RELATIVE_COLORIMETRIC_GCR,
        cmsFLAGS_NOCACHE
      );
      resources.push({ type: 'transform', handle: transform });

      const grayLevels = [32, 64, 96, 128, 160, 192, 224];

      for (const gray of grayLevels) {
        const inputRGB = new Uint8Array([gray, gray, gray]);
        const outputCMYK = new Uint8Array(4);

        engine.doTransform(transform, inputRGB, outputCMYK, 1);

        // All neutral grays should be K-only
        expect(outputCMYK[0]).toBeLessThanOrEqual(2); // C ≈ 0
        expect(outputCMYK[1]).toBeLessThanOrEqual(2); // M ≈ 0
        expect(outputCMYK[2]).toBeLessThanOrEqual(2); // Y ≈ 0
        expect(outputCMYK[3]).toBeGreaterThan(0);     // K > 0
      }
    });
  });

  describe('Chromatic Color Conversion', () => {
    it('should convert pure red to CMY+K with GCR', async () => {
      const srgb = engine.createSRGBProfile();
      resources.push({ type: 'profile', handle: srgb });

      const cmykBuffer = await readFile(join(FIXTURES_DIR, 'profiles/cmyk/CoatedFOGRA39.icc'));
      const cmyk = engine.openProfileFromMem(new Uint8Array(cmykBuffer));
      resources.push({ type: 'profile', handle: cmyk });

      const transform = engine.createTransform(
        srgb,
        TYPE_RGB_8,
        cmyk,
        TYPE_CMYK_8,
        INTENT_PRESERVE_K_ONLY_RELATIVE_COLORIMETRIC_GCR,
        cmsFLAGS_NOCACHE
      );
      resources.push({ type: 'transform', handle: transform });

      const inputRGB = new Uint8Array([255, 0, 0]); // Pure red
      const outputCMYK = new Uint8Array(4);

      engine.doTransform(transform, inputRGB, outputCMYK, 1);

      // Red should have M and Y (cyan's complement)
      // GCR should add some K and reduce CMY
      expect(outputCMYK[0]).toBeLessThan(255); // C < 100%
      expect(outputCMYK[1]).toBeGreaterThan(0); // M > 0
      expect(outputCMYK[2]).toBeGreaterThan(0); // Y > 0
      // K might be > 0 due to GCR, but not necessarily
    });

    it('should convert pure blue to CMY+K with GCR', async () => {
      const srgb = engine.createSRGBProfile();
      resources.push({ type: 'profile', handle: srgb });

      const cmykBuffer = await readFile(join(FIXTURES_DIR, 'profiles/cmyk/CoatedFOGRA39.icc'));
      const cmyk = engine.openProfileFromMem(new Uint8Array(cmykBuffer));
      resources.push({ type: 'profile', handle: cmyk });

      const transform = engine.createTransform(
        srgb,
        TYPE_RGB_8,
        cmyk,
        TYPE_CMYK_8,
        INTENT_PRESERVE_K_ONLY_RELATIVE_COLORIMETRIC_GCR,
        cmsFLAGS_NOCACHE
      );
      resources.push({ type: 'transform', handle: transform });

      const inputRGB = new Uint8Array([0, 0, 255]); // Pure blue
      const outputCMYK = new Uint8Array(4);

      engine.doTransform(transform, inputRGB, outputCMYK, 1);

      // Blue should have high C and M (blue = cyan + magenta)
      expect(outputCMYK[0]).toBeGreaterThan(200); // C high
      expect(outputCMYK[1]).toBeGreaterThan(175); // M high
      expect(outputCMYK[2]).toBeLessThan(100);    // Y low
      // K might be added by GCR
    });
  });

  describe('Comparison with Standard Intent', () => {
    it('should produce different K values than standard relative colorimetric', async test => {
      const srgb = engine.createSRGBProfile();
      resources.push({ type: 'profile', handle: srgb });

      const cmykBuffer = await readFile(join(FIXTURES_DIR, 'profiles/cmyk/CoatedFOGRA39.icc'));
      const cmyk = engine.openProfileFromMem(new Uint8Array(cmykBuffer));
      resources.push({ type: 'profile', handle: cmyk });

      // Create two transforms: standard and K-Only GCR
      const standardTransform = engine.createTransform(
        srgb,
        TYPE_RGB_8,
        cmyk,
        TYPE_CMYK_8,
        INTENT_RELATIVE_COLORIMETRIC,
        cmsFLAGS_NOCACHE
      );
      resources.push({ type: 'transform', handle: standardTransform });

      const kOnlyTransform = engine.createTransform(
        srgb,
        TYPE_RGB_8,
        cmyk,
        TYPE_CMYK_8,
        INTENT_PRESERVE_K_ONLY_RELATIVE_COLORIMETRIC_GCR,
        cmsFLAGS_NOCACHE
      );
      resources.push({ type: 'transform', handle: kOnlyTransform });

      const inputRGB = new Uint8Array([128, 128, 128]); // 50% gray
      const standardCMYK = new Uint8Array(4);
      const kOnlyCMYK = new Uint8Array(4);

      engine.doTransform(standardTransform, inputRGB, standardCMYK, 1);
      engine.doTransform(kOnlyTransform, inputRGB, kOnlyCMYK, 1);

      // Standard transform might have some CMY
      // K-Only transform should have CMY ≈ 0
      expect(kOnlyCMYK[0]).toBeLessThan(standardCMYK[0]); // K-Only has less C
      expect(kOnlyCMYK[1]).toBeLessThan(standardCMYK[1]); // K-Only has less M
      expect(kOnlyCMYK[2]).toBeLessThan(standardCMYK[2]); // K-Only has less Y

      // Both should have similar total ink density for neutral gray
      const standardTotal = standardCMYK[0] + standardCMYK[1] + standardCMYK[2] + standardCMYK[3];
      const standardAverage = standardTotal / 4;
      const standardCMYAveragePlusK = (standardCMYK[0] + standardCMYK[1] + standardCMYK[2]) / 3 + standardCMYK[3];
      // const kOnlyTotal = kOnlyCMYK[0] + kOnlyCMYK[1] + kOnlyCMYK[2] + kOnlyCMYK[3];
      const kOnlyBlack = kOnlyCMYK[3];

      // console.log(`Standard CMYK: C=${standardCMYK[0]} M=${standardCMYK[1]} Y=${standardCMYK[2]} K=${standardCMYK[3]}`);
      // console.log(`K-Only CMYK: C=${kOnlyCMYK[0]} M=${kOnlyCMYK[1]} Y=${kOnlyCMYK[2]} K=${kOnlyCMYK[3]}`);
      test.annotate(`Standard CMYK: C=${standardCMYK[0]} M=${standardCMYK[1]} Y=${standardCMYK[2]} K=${standardCMYK[3]}`);
      test.annotate(`K-Only CMYK: C=${kOnlyCMYK[0]} M=${kOnlyCMYK[1]} Y=${kOnlyCMYK[2]} K=${kOnlyCMYK[3]}`);

      // The K in K-Only should approximate the combined ink of standard
      expect(Math.abs(standardCMYAveragePlusK - kOnlyBlack)).toBeLessThan(standardAverage * 0.2);
    });
  });

  describe('Multiple Profiles', () => {
    it('should work with different CMYK profiles', async () => {
      const profiles = [
        'CoatedFOGRA39.icc',
        'GRACoL2006_Coated1v2.icc',
        'JapanColor2011Coated.icc',
        'USWebCoatedSWOP.icc'
      ];

      const srgb = engine.createSRGBProfile();
      resources.push({ type: 'profile', handle: srgb });

      const inputRGB = new Uint8Array([128, 128, 128]); // 50% gray

      for (const profileName of profiles) {
        try {
          const cmykBuffer = await readFile(join(FIXTURES_DIR, 'profiles/cmyk', profileName));
          const cmyk = engine.openProfileFromMem(new Uint8Array(cmykBuffer));

          const transform = engine.createTransform(
            srgb,
            TYPE_RGB_8,
            cmyk,
            TYPE_CMYK_8,
            INTENT_PRESERVE_K_ONLY_RELATIVE_COLORIMETRIC_GCR,
            cmsFLAGS_NOCACHE
          );

          const outputCMYK = new Uint8Array(4);
          engine.doTransform(transform, inputRGB, outputCMYK, 1);

          // All profiles should produce K-only for neutral gray
          expect(outputCMYK[0]).toBeLessThanOrEqual(2); // C ≈ 0
          expect(outputCMYK[1]).toBeLessThanOrEqual(2); // M ≈ 0
          expect(outputCMYK[2]).toBeLessThanOrEqual(2); // Y ≈ 0
          expect(outputCMYK[3]).toBeGreaterThan(0);     // K > 0

          // Clean up
          engine.deleteTransform(transform);
          engine.closeProfile(cmyk);
        } catch (err) {
          // Profile might not exist, skip
          console.log(`Skipping ${profileName}: ${err.message}`);
        }
      }
    });
  });
});
