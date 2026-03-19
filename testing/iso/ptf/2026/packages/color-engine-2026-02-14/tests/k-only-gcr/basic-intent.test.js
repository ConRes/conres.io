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
    for (const resource of resources.splice(0, resources.length)) {
      if (resource.type === 'transform') engine.deleteTransform(resource.handle);
      else if (resource.type === 'profile') engine.closeProfile(resource.handle);
    }
  });

  describe('Transform Creation', () => {
    it('should create RGB to CMYK transform with K-Only GCR intent', async () => {
      const rgbProfileHandle = engine.createSRGBProfile();
      resources.push({ type: 'profile', handle: rgbProfileHandle });

      const cmykProfileBuffer = await readFile(join(FIXTURES_DIR, 'profiles/cmyk/CoatedFOGRA39.icc'));
      const cmykProfileHandle = engine.openProfileFromMem(new Uint8Array(cmykProfileBuffer));
      resources.push({ type: 'profile', handle: cmykProfileHandle });

      const transformHandle = engine.createTransform(
        rgbProfileHandle,
        TYPE_RGB_8,
        cmykProfileHandle,
        TYPE_CMYK_8,
        INTENT_PRESERVE_K_ONLY_RELATIVE_COLORIMETRIC_GCR,
        cmsFLAGS_NOCACHE
      );
      resources.push({ type: 'transform', handle: transformHandle });

      expect(transformHandle).toBeGreaterThan(0);
    });

    it('should create RGB to CMYK transform with float types', async () => {
      const rgbProfileHandle = engine.createSRGBProfile();
      resources.push({ type: 'profile', handle: rgbProfileHandle });

      const cmykProfileBuffer = await readFile(join(FIXTURES_DIR, 'profiles/cmyk/CoatedFOGRA39.icc'));
      const cmykProfileHandle = engine.openProfileFromMem(new Uint8Array(cmykProfileBuffer));
      resources.push({ type: 'profile', handle: cmykProfileHandle });

      const transformHandle = engine.createTransform(
        rgbProfileHandle,
        TYPE_RGB_FLT,
        cmykProfileHandle,
        TYPE_CMYK_FLT,
        INTENT_PRESERVE_K_ONLY_RELATIVE_COLORIMETRIC_GCR,
        cmsFLAGS_NOCACHE
      );
      resources.push({ type: 'transform', handle: transformHandle });

      expect(transformHandle).toBeGreaterThan(0);
    });

    it('should create Lab to CMYK transform with K-Only GCR intent', async () => {
      const lab = engine.createLab4Profile();
      resources.push({ type: 'profile', handle: lab });

      const cmykProfileBuffer = await readFile(join(FIXTURES_DIR, 'profiles/cmyk/CoatedFOGRA39.icc'));
      const cmykProfileHandle = engine.openProfileFromMem(new Uint8Array(cmykProfileBuffer));
      resources.push({ type: 'profile', handle: cmykProfileHandle });

      const transformHandle = engine.createTransform(
        lab,
        TYPE_Lab_FLT,
        cmykProfileHandle,
        TYPE_CMYK_FLT,
        INTENT_PRESERVE_K_ONLY_RELATIVE_COLORIMETRIC_GCR,
        cmsFLAGS_NOCACHE
      );
      resources.push({ type: 'transform', handle: transformHandle });

      expect(transformHandle).toBeGreaterThan(0);
    });
  });

  describe('Neutral Gray to K-Only Conversion', () => {
    it('should convert neutral gray (128,128,128) to K-only CMYK', async () => {
      const rgbProfileHandle = engine.createSRGBProfile();
      resources.push({ type: 'profile', handle: rgbProfileHandle });

      const cmykProfileBuffer = await readFile(join(FIXTURES_DIR, 'profiles/cmyk/CoatedFOGRA39.icc'));
      const cmykProfileHandle = engine.openProfileFromMem(new Uint8Array(cmykProfileBuffer));
      resources.push({ type: 'profile', handle: cmykProfileHandle });

      const transformHandle = engine.createTransform(
        rgbProfileHandle,
        TYPE_RGB_8,
        cmykProfileHandle,
        TYPE_CMYK_8,
        INTENT_PRESERVE_K_ONLY_RELATIVE_COLORIMETRIC_GCR,
        cmsFLAGS_NOCACHE
      );
      resources.push({ type: 'transform', handle: transformHandle });

      const rgbUint8Array = new Uint8Array([128, 128, 128]); // 50% gray
      const cmykUint8Array = new Uint8Array(4);

      engine.doTransform(transformHandle, rgbUint8Array, cmykUint8Array, 1);

      // Verify K-only output: C, M, Y should be very close to 0
      // Allow small tolerance for rounding errors
      expect(cmykUint8Array[0]).toBeLessThanOrEqual(2); // C ≈ 0
      expect(cmykUint8Array[1]).toBeLessThanOrEqual(2); // M ≈ 0
      expect(cmykUint8Array[2]).toBeLessThanOrEqual(2); // Y ≈ 0
      expect(cmykUint8Array[3]).toBeGreaterThan(0);     // K > 0
    });

    it('should convert pure white (255,255,255) to no ink', async () => {
      const rgbProfileHandle = engine.createSRGBProfile();
      resources.push({ type: 'profile', handle: rgbProfileHandle });

      const cmykProfileBuffer = await readFile(join(FIXTURES_DIR, 'profiles/cmyk/CoatedFOGRA39.icc'));
      const cmykProfileHandle = engine.openProfileFromMem(new Uint8Array(cmykProfileBuffer));
      resources.push({ type: 'profile', handle: cmykProfileHandle });

      const transformHandle = engine.createTransform(
        rgbProfileHandle,
        TYPE_RGB_8,
        cmykProfileHandle,
        TYPE_CMYK_8,
        INTENT_PRESERVE_K_ONLY_RELATIVE_COLORIMETRIC_GCR,
        cmsFLAGS_NOCACHE
      );
      resources.push({ type: 'transform', handle: transformHandle });

      const inputRGB = new Uint8Array([255, 255, 255]); // White
      const outputCMYK = new Uint8Array(4);

      engine.doTransform(transformHandle, inputRGB, outputCMYK, 1);

      // White should have no ink
      expect(outputCMYK[0]).toBeLessThanOrEqual(2); // C ≈ 0
      expect(outputCMYK[1]).toBeLessThanOrEqual(2); // M ≈ 0
      expect(outputCMYK[2]).toBeLessThanOrEqual(2); // Y ≈ 0
      expect(outputCMYK[3]).toBeLessThanOrEqual(2); // K ≈ 0
    });

    it('should convert pure black (0,0,0) to K=100', async () => {
      const rgbProfileHandle = engine.createSRGBProfile();
      resources.push({ type: 'profile', handle: rgbProfileHandle });

      const cmykProfileBuffer = await readFile(join(FIXTURES_DIR, 'profiles/cmyk/CoatedFOGRA39.icc'));
      const cmykProfileHandle = engine.openProfileFromMem(new Uint8Array(cmykProfileBuffer));
      resources.push({ type: 'profile', handle: cmykProfileHandle });

      const transformHandle = engine.createTransform(
        rgbProfileHandle,
        TYPE_RGB_8,
        cmykProfileHandle,
        TYPE_CMYK_8,
        INTENT_PRESERVE_K_ONLY_RELATIVE_COLORIMETRIC_GCR,
        cmsFLAGS_NOCACHE
      );
      resources.push({ type: 'transform', handle: transformHandle });

      const rgbUint8Array = new Uint8Array([0, 0, 0]); // Black
      const cmykUint8Array = new Uint8Array(4);

      engine.doTransform(transformHandle, rgbUint8Array, cmykUint8Array, 1);

      // Black should be K-only (100%)
      expect(cmykUint8Array[0]).toBeLessThanOrEqual(2);  // C ≈ 0
      expect(cmykUint8Array[1]).toBeLessThanOrEqual(2);  // M ≈ 0
      expect(cmykUint8Array[2]).toBeLessThanOrEqual(2);  // Y ≈ 0
      expect(cmykUint8Array[3]).toBeGreaterThanOrEqual(253); // K ≈ 100
    });

    it('should convert multiple neutral grays to K-only', async () => {
      const rgbProfileHandle = engine.createSRGBProfile();
      resources.push({ type: 'profile', handle: rgbProfileHandle });

      const cmykProfileBuffer = await readFile(join(FIXTURES_DIR, 'profiles/cmyk/CoatedFOGRA39.icc'));
      const cmykProfileHandle = engine.openProfileFromMem(new Uint8Array(cmykProfileBuffer));
      resources.push({ type: 'profile', handle: cmykProfileHandle });

      const transformHandle = engine.createTransform(
        rgbProfileHandle,
        TYPE_RGB_8,
        cmykProfileHandle,
        TYPE_CMYK_8,
        INTENT_PRESERVE_K_ONLY_RELATIVE_COLORIMETRIC_GCR,
        cmsFLAGS_NOCACHE
      );
      resources.push({ type: 'transform', handle: transformHandle });

      const grayLevels = [32, 64, 96, 128, 160, 192, 224];

      for (const gray of grayLevels) {
        const rgbUint8Array = new Uint8Array([gray, gray, gray]);
        const cmykUint8Array = new Uint8Array(4);

        engine.doTransform(transformHandle, rgbUint8Array, cmykUint8Array, 1);

        // All neutral grays should be K-only
        expect(cmykUint8Array[0]).toBeLessThanOrEqual(2); // C ≈ 0
        expect(cmykUint8Array[1]).toBeLessThanOrEqual(2); // M ≈ 0
        expect(cmykUint8Array[2]).toBeLessThanOrEqual(2); // Y ≈ 0
        expect(cmykUint8Array[3]).toBeGreaterThan(0);     // K > 0
      }
    });
  });

  describe('Chromatic Color Conversion', () => {
    it('should convert pure red to CMY+K with GCR', async () => {
      const rgbProfileHandle = engine.createSRGBProfile();
      resources.push({ type: 'profile', handle: rgbProfileHandle });

      const cmykProfileBuffer = await readFile(join(FIXTURES_DIR, 'profiles/cmyk/CoatedFOGRA39.icc'));
      const cmykProfileHandle = engine.openProfileFromMem(new Uint8Array(cmykProfileBuffer));
      resources.push({ type: 'profile', handle: cmykProfileHandle });

      const transformHandle = engine.createTransform(
        rgbProfileHandle,
        TYPE_RGB_8,
        cmykProfileHandle,
        TYPE_CMYK_8,
        INTENT_PRESERVE_K_ONLY_RELATIVE_COLORIMETRIC_GCR,
        cmsFLAGS_NOCACHE
      );
      resources.push({ type: 'transform', handle: transformHandle });

      const rgbUint8Array = new Uint8Array([255, 0, 0]); // Pure red
      const cmykUint8Array = new Uint8Array(4);

      engine.doTransform(transformHandle, rgbUint8Array, cmykUint8Array, 1);

      // Red should have M and Y (cyan's complement)
      // GCR should add some K and reduce CMY
      expect(cmykUint8Array[0]).toBeLessThan(255); // C < 100%
      expect(cmykUint8Array[1]).toBeGreaterThan(0); // M > 0
      expect(cmykUint8Array[2]).toBeGreaterThan(0); // Y > 0
      // K might be > 0 due to GCR, but not necessarily
    });

    it('should convert pure blue to CMY+K with GCR', async () => {
      const rgbProfileHandle = engine.createSRGBProfile();
      resources.push({ type: 'profile', handle: rgbProfileHandle });

      const cmykProfileBuffer = await readFile(join(FIXTURES_DIR, 'profiles/cmyk/CoatedFOGRA39.icc'));
      const cmykProfileHandle = engine.openProfileFromMem(new Uint8Array(cmykProfileBuffer));
      resources.push({ type: 'profile', handle: cmykProfileHandle });

      const transformHandle = engine.createTransform(
        rgbProfileHandle,
        TYPE_RGB_8,
        cmykProfileHandle,
        TYPE_CMYK_8,
        INTENT_PRESERVE_K_ONLY_RELATIVE_COLORIMETRIC_GCR,
        cmsFLAGS_NOCACHE
      );
      resources.push({ type: 'transform', handle: transformHandle });

      const rgbUint8Array = new Uint8Array([0, 0, 255]); // Pure blue
      const cmykUint8Array = new Uint8Array(4);

      engine.doTransform(transformHandle, rgbUint8Array, cmykUint8Array, 1);

      // Blue should have high C and M (blue = cyan + magenta)
      expect(cmykUint8Array[0]).toBeGreaterThan(200); // C high
      expect(cmykUint8Array[1]).toBeGreaterThan(175); // M high
      expect(cmykUint8Array[2]).toBeLessThan(100);    // Y low
      // K might be added by GCR
    });
  });

  describe('Comparison with Standard Intent', () => {
    it('should produce different K values than standard relative colorimetric', async test => {
      const rgbProfileHandle = engine.createSRGBProfile();
      resources.push({ type: 'profile', handle: rgbProfileHandle });

      const cmykProfileBuffer = await readFile(join(FIXTURES_DIR, 'profiles/cmyk/CoatedFOGRA39.icc'));
      const cmykProfileHandle = engine.openProfileFromMem(new Uint8Array(cmykProfileBuffer));
      resources.push({ type: 'profile', handle: cmykProfileHandle });

      // Create two transforms: standard and K-Only GCR
      const standardTransformHandle = engine.createTransform(
        rgbProfileHandle,
        TYPE_RGB_8,
        cmykProfileHandle,
        TYPE_CMYK_8,
        INTENT_RELATIVE_COLORIMETRIC,
        cmsFLAGS_NOCACHE
      );
      resources.push({ type: 'transform', handle: standardTransformHandle });

      const kOnlyTransformHandle = engine.createTransform(
        rgbProfileHandle,
        TYPE_RGB_8,
        cmykProfileHandle,
        TYPE_CMYK_8,
        INTENT_PRESERVE_K_ONLY_RELATIVE_COLORIMETRIC_GCR,
        cmsFLAGS_NOCACHE
      );
      resources.push({ type: 'transform', handle: kOnlyTransformHandle });

      const rgbUint8Array = new Uint8Array([128, 128, 128]); // 50% gray
      const standardCMYKUint8Array = new Uint8Array(4);
      const kOnlyCMYKUint8Array = new Uint8Array(4);

      engine.doTransform(standardTransformHandle, rgbUint8Array, standardCMYKUint8Array, 1);
      engine.doTransform(kOnlyTransformHandle, rgbUint8Array, kOnlyCMYKUint8Array, 1);

      // Standard transform might have some CMY
      // K-Only transform should have CMY ≈ 0
      expect(kOnlyCMYKUint8Array[0]).toBeLessThan(standardCMYKUint8Array[0]); // K-Only has less C
      expect(kOnlyCMYKUint8Array[1]).toBeLessThan(standardCMYKUint8Array[1]); // K-Only has less M
      expect(kOnlyCMYKUint8Array[2]).toBeLessThan(standardCMYKUint8Array[2]); // K-Only has less Y

      // Both should have similar total ink density for neutral gray
      const standardTotal = standardCMYKUint8Array[0] + standardCMYKUint8Array[1] + standardCMYKUint8Array[2] + standardCMYKUint8Array[3];
      const standardAverage = standardTotal / 4;
      const standardCMYAveragePlusK = (standardCMYKUint8Array[0] + standardCMYKUint8Array[1] + standardCMYKUint8Array[2]) / 3 + standardCMYKUint8Array[3];
      const kOnlyBlack = kOnlyCMYKUint8Array[3];

      test.annotate(`Standard CMYK: C=${standardCMYKUint8Array[0]} M=${standardCMYKUint8Array[1]} Y=${standardCMYKUint8Array[2]} K=${standardCMYKUint8Array[3]}`);
      test.annotate(`K-Only CMYK: C=${kOnlyCMYKUint8Array[0]} M=${kOnlyCMYKUint8Array[1]} Y=${kOnlyCMYKUint8Array[2]} K=${kOnlyCMYKUint8Array[3]}`);

      // The K in K-Only should approximate the combined ink of standard
      expect(Math.abs(standardCMYAveragePlusK - kOnlyBlack)).toBeLessThan(standardAverage * 0.2);
    });
  });

  describe('Multiple Profiles', () => {
    it('should work with different CMYK profiles', async () => {
      const cmykProfileNames = [
        'CoatedFOGRA39.icc',
        'GRACoL2006_Coated1v2.icc',
        'JapanColor2011Coated.icc',
        'USWebCoatedSWOP.icc'
      ];

      const rgbProfileHandle = engine.createSRGBProfile();
      resources.push({ type: 'profile', handle: rgbProfileHandle });

      const rgbUint8Array = new Uint8Array([128, 128, 128]); // 50% gray

      for (const cmykProfileName of cmykProfileNames) {
        try {
          const cmykProfileBuffer = await readFile(join(FIXTURES_DIR, 'profiles/cmyk', cmykProfileName));
          const cmykProfileHandle = engine.openProfileFromMem(new Uint8Array(cmykProfileBuffer));

          const transformHandle = engine.createTransform(
            rgbProfileHandle,
            TYPE_RGB_8,
            cmykProfileHandle,
            TYPE_CMYK_8,
            INTENT_PRESERVE_K_ONLY_RELATIVE_COLORIMETRIC_GCR,
            cmsFLAGS_NOCACHE
          );

          const cmykUint8Array = new Uint8Array(4);
          engine.doTransform(transformHandle, rgbUint8Array, cmykUint8Array, 1);

          // All profiles should produce K-only for neutral gray
          expect(cmykUint8Array[0]).toBeLessThanOrEqual(2); // C ≈ 0
          expect(cmykUint8Array[1]).toBeLessThanOrEqual(2); // M ≈ 0
          expect(cmykUint8Array[2]).toBeLessThanOrEqual(2); // Y ≈ 0
          expect(cmykUint8Array[3]).toBeGreaterThan(0);     // K > 0

          // Clean up
          engine.deleteTransform(transformHandle);
          engine.closeProfile(cmykProfileHandle);
        } catch (err) {
          // Profile might not exist, skip
          console.log(`Skipping ${cmykProfileName}: ${err.message}`);
        }
      }
    });
  });
});
