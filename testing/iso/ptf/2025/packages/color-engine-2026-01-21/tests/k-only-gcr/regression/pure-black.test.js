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
  async function testPureBlack(profileName, profilePath) {
    // Load profile
    const profileBuffer = await readFile(profilePath);
    const srgb = engine.createSRGBProfile();
    const cmyk = engine.openProfileFromMem(new Uint8Array(profileBuffer));

    // Create K-Only GCR transform
    const transform = engine.createTransform(
      srgb,
      LittleCMS.TYPE_RGB_8,
      cmyk,
      LittleCMS.TYPE_CMYK_8,
      LittleCMS.INTENT_PRESERVE_K_ONLY_RELATIVE_COLORIMETRIC_GCR,
      0
    );

    // Transform Pure Black
    const input = new Uint8Array([0, 0, 0]);
    const output = new Uint8Array(4);
    engine.doTransform(transform, input, output, 1);

    // Cleanup
    engine.deleteTransform(transform);
    engine.closeProfile(cmyk);
    engine.closeProfile(srgb);

    // Convert to percentages
    const C = Math.round(output[0] / 255 * 100);
    const M = Math.round(output[1] / 255 * 100);
    const Y = Math.round(output[2] / 255 * 100);
    const K = Math.round(output[3] / 255 * 100);

    return { C, M, Y, K };
  }

  // Representative profiles from WIP commit testing
  const REPRESENTATIVE_PROFILES = [
    'CoatedFOGRA39.icc',
    'GRACoL2006_Coated1v2.icc',
    'JapanColor2011Coated.icc',
    'UncoatedFOGRA29.icc',
    'USWebCoatedSWOP.icc',
  ];

  describe('Representative Profiles (Must Pass)', () => {
    for (const profileName of REPRESENTATIVE_PROFILES) {
      it(`should produce K=100 for ${profileName}`, async () => {
        const profilePath = join(FIXTURES_DIR, 'profiles/cmyk', profileName);
        const result = await testPureBlack(profileName, profilePath);

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
    const COATED_PROFILES = [
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

    for (const profileName of COATED_PROFILES) {
      it(`should produce K=100 for ${profileName}`, async () => {
        const profilePath = join(FIXTURES_DIR, 'profiles/cmyk', profileName);

        try {
          const result = await testPureBlack(profileName, profilePath);

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
    const UNCOATED_PROFILES = [
      'UncoatedFOGRA29.icc',
      'PSO_Uncoated_ISO12647_eci.icc',
      'PSO_Uncoated_NPscreen_ISO12647_eci.icc',
      'USSheetfedUncoated.icc',
      'USWebUncoated.icc',
    ];

    for (const profileName of UNCOATED_PROFILES) {
      it(`should produce K=100 for ${profileName} (was failing before fix)`, async () => {
        const profilePath = join(FIXTURES_DIR, 'profiles/cmyk', profileName);

        try {
          const result = await testPureBlack(profileName, profilePath);

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
