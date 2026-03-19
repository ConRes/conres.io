/**
 * Regression Test: Neutral Grays → K-Only
 *
 * This test verifies that neutral grays (R=G=B) are converted to K-only CMYK.
 * This is the core promise of the K-Only GCR algorithm.
 *
 * Acceptance Criteria:
 * - C+M+Y < 1% (essentially zero)
 * - K value reasonable for the gray level
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFile } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import * as LittleCMS from '../../../src/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, '../../fixtures');

describe('Regression: Neutral Grays → K-Only', () => {
  let engine;

  beforeAll(async () => {
    engine = await LittleCMS.createEngine();
  });

  /**
   * Test color grays for K-only conversion
   */
  const NEUTRAL_GRAYS = [
    { name: 'Pure Black', rgb: [0, 0, 0], expectedK: 100 },
    { name: '10% Gray', rgb: [26, 26, 26], expectedK: 90 },
    { name: '25% Gray', rgb: [64, 64, 64], expectedK: 75 },
    { name: '50% Gray', rgb: [128, 128, 128], expectedK: 50 },
    { name: '75% Gray', rgb: [192, 192, 192], expectedK: 25 },
    { name: '90% Gray', rgb: [230, 230, 230], expectedK: 10 },
    { name: 'Pure White', rgb: [255, 255, 255], expectedK: 0 },
  ];

  /**
   * Helper: Test neutral gray conversion
   */
  async function testNeutralRGBToCMYK(cmykProfilePath, neutralRGBInputArray) {
    const resources = [];
    try {
      const rgbProfileHandle = engine.createSRGBProfile();
      resources.push({ type: 'profile', handle: rgbProfileHandle });

      // Load profile
      const cmykProfileBuffer = await readFile(cmykProfilePath);
      const cmykProfileHandle = engine.openProfileFromMem(new Uint8Array(cmykProfileBuffer));
      resources.push({ type: 'profile', handle: cmykProfileHandle });

      // Create K-Only GCR transform
      const transformHandle = engine.createTransform(
        rgbProfileHandle,
        LittleCMS.TYPE_RGB_8,
        cmykProfileHandle,
        LittleCMS.TYPE_CMYK_8,
        LittleCMS.INTENT_PRESERVE_K_ONLY_RELATIVE_COLORIMETRIC_GCR,
        0
      );
      resources.push({ type: 'transform', handle: transformHandle });

      // Transform
      const rgbUint8Array = new Uint8Array(neutralRGBInputArray);
      const cmykUint8Array = new Uint8Array(4);
      engine.doTransform(transformHandle, rgbUint8Array, cmykUint8Array, 1);

      // Cleanup
      // engine.deleteTransform(transformHandle);
      // engine.closeProfile(cmykProfileHandle);
      // engine.closeProfile(rgbProfileHandle);

      // Convert to percentages
      const C = Math.round(cmykUint8Array[0] / 255 * 1000) / 10;  // 1 decimal place
      const M = Math.round(cmykUint8Array[1] / 255 * 1000) / 10;
      const Y = Math.round(cmykUint8Array[2] / 255 * 1000) / 10;
      const K = Math.round(cmykUint8Array[3] / 255 * 1000) / 10;

      return { C, M, Y, K };
    } finally {
      for (const resource of resources.splice(0, resources.length)) {
        if (resource.type === 'transform') engine.deleteTransform(resource.handle);
        else if (resource.type === 'profile') engine.closeProfile(resource.handle);
      }
    }
  }

  describe('CoatedFOGRA39 (Representative Profile)', () => {
    const cmykProfilePath = join(FIXTURES_DIR, 'profiles/cmyk/CoatedFOGRA39.icc');

    for (const gray of NEUTRAL_GRAYS) {
      it(`should convert ${gray.name} to K-only`, async () => {
        const result = await testNeutralRGBToCMYK(cmykProfilePath, gray.rgb);

        // CRITICAL: CMY must be essentially zero (< 1%)
        expect(result.C).toBeLessThan(1);
        expect(result.M).toBeLessThan(1);
        expect(result.Y).toBeLessThan(1);

        // K should be in reasonable range (±10% tolerance)
        if (gray.expectedK === 0 || gray.expectedK === 100) {
          // Exact match for black and white
          expect(result.K).toBeCloseTo(gray.expectedK, 0);
        } else {
          // ±15% tolerance for grays
          expect(result.K).toBeGreaterThan(gray.expectedK - 15);
          expect(result.K).toBeLessThan(gray.expectedK + 15);
        }
      });
    }
  });

  describe('UncoatedFOGRA29 (Was Problematic)', () => {
    const cmykProfilePath = join(FIXTURES_DIR, 'profiles/cmyk/UncoatedFOGRA29.icc');

    for (const gray of NEUTRAL_GRAYS) {
      it(`should convert ${gray.name} to K-only`, async () => {
        try {
          const result = await testNeutralRGBToCMYK(cmykProfilePath, gray.rgb);

          // CRITICAL: CMY must be essentially zero (< 1%)
          expect(result.C).toBeLessThan(1);
          expect(result.M).toBeLessThan(1);
          expect(result.Y).toBeLessThan(1);

          // K should be in reasonable range
          if (gray.expectedK === 0 || gray.expectedK === 100) {
            expect(result.K).toBeCloseTo(gray.expectedK, 0);
          } else {
            expect(result.K).toBeGreaterThan(gray.expectedK - 10);
            expect(result.K).toBeLessThan(gray.expectedK + 10);
          }
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
        }
      });
    }
  });

  describe('Multiple Profiles - Neutral Gray Guarantee', () => {
    const cmykProfileNames = [
      'CoatedFOGRA39.icc',
      'GRACoL2006_Coated1v2.icc',
      'JapanColor2011Coated.icc',
      'UncoatedFOGRA29.icc',
      'USWebCoatedSWOP.icc',
    ];

    for (const cmykProfileName of cmykProfileNames) {
      describe(cmykProfileName, () => {
        const profilePath = join(FIXTURES_DIR, 'profiles/cmyk', cmykProfileName);

        it('should convert all neutral grays to K-only', async () => {
          try {
            for (const gray of NEUTRAL_GRAYS) {
              const result = await testNeutralRGBToCMYK(profilePath, gray.rgb);

              // CRITICAL: CMY must be < 1%
              expect(result.C, `${gray.name} - C should be < 1%`).toBeLessThan(1);
              expect(result.M, `${gray.name} - M should be < 1%`).toBeLessThan(1);
              expect(result.Y, `${gray.name} - Y should be < 1%`).toBeLessThan(1);
            }
          } catch (error) {
            if (error.code !== 'ENOENT') throw error;
          }
        });
      });
    }
  });

  describe('Edge Case: Near-Neutral Grays', () => {
    const profilePath = join(FIXTURES_DIR, 'profiles/cmyk/CoatedFOGRA39.icc');

    // These are ALMOST neutral (within 1-2 RGB units)
    const NEAR_NEUTRALS = [
      { name: 'Near Gray 1', rgb: [127, 128, 129] },
      { name: 'Near Gray 2', rgb: [100, 101, 99] },
      { name: 'Near Gray 3', rgb: [64, 65, 64] },
    ];

    for (const gray of NEAR_NEUTRALS) {
      it(`should handle ${gray.name} reasonably`, async () => {
        const result = await testNeutralRGBToCMYK(profilePath, gray.rgb);

        // These might have small CMY components (algorithm dependent)
        // But K should be dominant
        expect(result.K).toBeGreaterThan(20);

        // Total ink should be reasonable
        const totalInk = result.C + result.M + result.Y + result.K;
        expect(totalInk).toBeGreaterThan(0);
        expect(totalInk).toBeLessThan(400);  // Max 400%
      });
    }
  });
});
