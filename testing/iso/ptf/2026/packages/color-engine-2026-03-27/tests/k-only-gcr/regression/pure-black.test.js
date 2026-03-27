/**
 * Regression Test: Pure Black → K=100
 *
 * This test locks in the critical achievement from Phase 3.5:
 * Pure Black (RGB 0,0,0) must produce K=100 for ALL profiles.
 *
 * This was the breakthrough fix for the double BPC bug.
 * Any regression here is a CRITICAL failure.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFile } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import * as LittleCMS from '../../../src/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, '../../fixtures');

describe('Regression: Pure Black → K=100', () => {
  let engine;

  beforeAll(async () => {
    engine = await LittleCMS.createEngine();
  });

  /**
   * Helper: Test Pure Black conversion
   */
  async function testPureBlack(cmykProfileName, cmykProfilePath) {
    // Load profile
    const resources = [];

    try {
      const rgbProfileHandle = engine.createSRGBProfile();
      resources.push({ type: 'profile', handle: rgbProfileHandle });

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

      // Transform Pure Black
      const rgbUint8Array = new Uint8Array([0, 0, 0]);
      const cmykUint8Array = new Uint8Array(4);
      engine.doTransform(transformHandle, rgbUint8Array, cmykUint8Array, 1);

      // Convert to percentages
      const C = Math.round(cmykUint8Array[0] / 255 * 100);
      const M = Math.round(cmykUint8Array[1] / 255 * 100);
      const Y = Math.round(cmykUint8Array[2] / 255 * 100);
      const K = Math.round(cmykUint8Array[3] / 255 * 100);

      return { C, M, Y, K };
    } finally {
      for (const resource of resources.splice(0, resources.length)) {
        if (resource.type === 'transform') engine.deleteTransform(resource.handle);
        else if (resource.type === 'profile') engine.closeProfile(resource.handle);
      }
    }
  }

  // Representative profiles from WIP commit testing
  const representativeCMYKProfileNames = [
    'CoatedFOGRA39.icc',
    'GRACoL2006_Coated1v2.icc',
    'JapanColor2011Coated.icc',
    'UncoatedFOGRA29.icc',
    'USWebCoatedSWOP.icc',
  ];

  describe('Representative Profiles (Must Pass)', () => {
    for (const cmykProfileName of representativeCMYKProfileNames) {
      it(`should produce K=100 for ${cmykProfileName}`, async () => {
        const cmykProfilePath = join(FIXTURES_DIR, 'profiles/cmyk', cmykProfileName);
        const result = await testPureBlack(cmykProfileName, cmykProfilePath);

        // CRITICAL: K must be 100%
        expect(result.K).toBe(100);

        // CRITICAL: CMY must be 0% (K-only)
        expect(result.C).toBe(0);
        expect(result.M).toBe(0);
        expect(result.Y).toBe(0);
      });
    }
  });

  describe('All Coated Profiles', () => {
    const coatedCMYKProfileNames = [
      'CoatedFOGRA27.icc',
      'CoatedFOGRA39.icc',
      'CoatedGRACoL2006.icc',
      'EuroscaleCoated.icc',
      'GRACoL2006_Coated1v2.icc',
      'ISOcoated_v2_300_eci.icc',
      'ISOcoated_v2_eci.icc',
      'JapanColor2001Coated.icc',
      'JapanColor2002Newspaper.icc',
      'JapanColor2003WebCoated.icc',
      'JapanColor2011Coated.icc',
      'PSO_Coated_300_NPscreen_ISO12647_eci.icc',
      'PSO_Coated_NPscreen_ISO12647_eci.icc',
      'PSO_LWC_Improved_eci.icc',
      'PSO_LWC_Standard_eci.icc',
      'PSO_MFC_Paper_eci.icc',
      'PSO_SNP_Paper_eci.icc',
      'PSO_Uncoated_ISO12647_eci.icc',
      'PSO_Uncoated_NPscreen_ISO12647_eci.icc',
      'SC_paper_eci.icc',
      'USSheetfedCoated.icc',
      'USSheetfedUncoated.icc',
      'USWebCoatedSWOP.icc',
      'USWebUncoated.icc',
      'WebCoatedFOGRA28.icc',
      'WebCoatedSWOP2006Grade3.icc',
      'WebCoatedSWOP2006Grade5.icc',
    ];

    for (const cmykProfileName of coatedCMYKProfileNames) {
      it(`should produce K=100 for ${cmykProfileName}`, async () => {
        const cmykProfilePath = join(FIXTURES_DIR, 'profiles/cmyk', cmykProfileName);

        try {
          const result = await testPureBlack(cmykProfileName, cmykProfilePath);

          // CRITICAL: K must be 100%
          expect(result.K).toBe(100);

          // CRITICAL: CMY must be 0% (K-only)
          expect(result.C).toBe(0);
          expect(result.M).toBe(0);
          expect(result.Y).toBe(0);
        } catch (error) {
          // Profile might not exist - skip
          if (error.code !== 'ENOENT') throw error;
        }
      });
    }
  });

  describe('Uncoated Profiles (Critical - Were Failing)', () => {
    const uncoatedCMYKProfileNames = [
      'UncoatedFOGRA29.icc',
      'PSO_Uncoated_ISO12647_eci.icc',
      'PSO_Uncoated_NPscreen_ISO12647_eci.icc',
      'USSheetfedUncoated.icc',
      'USWebUncoated.icc',
    ];

    for (const cmykProfileName of uncoatedCMYKProfileNames) {
      it(`should produce K=100 for ${cmykProfileName} (was failing before fix)`, async () => {
        const cmykProfilePath = join(FIXTURES_DIR, 'profiles/cmyk', cmykProfileName);

        try {
          const result = await testPureBlack(cmykProfileName, cmykProfilePath);

          // CRITICAL: These profiles were producing K=86-92 before the fix
          // Now they MUST produce K=100
          expect(result.K).toBe(100);

          // CRITICAL: CMY must be 0% (K-only)
          expect(result.C).toBe(0);
          expect(result.M).toBe(0);
          expect(result.Y).toBe(0);
        } catch (error) {
          // Profile might not exist - skip
          if (error.code !== 'ENOENT') throw error;
        }
      });
    }
  });
});
