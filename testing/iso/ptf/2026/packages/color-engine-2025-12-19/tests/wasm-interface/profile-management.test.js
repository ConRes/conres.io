/**
 * @fileoverview Phase 1 Tests - Profile Management
 * Tests ICC profile creation and management
 */

import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { createEngine } from '../../src/index.js';
import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, '../fixtures/profiles');

describe('Profile Management', () => {
  let engine;
  const profiles = [];

  beforeAll(async () => {
    engine = await createEngine();
  });

  afterEach(() => {
    // Clean up all profiles created during test
    profiles.forEach(p => {
      if (p) engine.closeProfile(p);
    });
    profiles.length = 0;
  });

  it('should create sRGB profile', () => {
    const profile = engine.createSRGBProfile();
    profiles.push(profile);

    expect(profile).toBeGreaterThan(0);
    expect(typeof profile).toBe('number');
  });

  it('should create Lab profile', () => {
    const profile = engine.createLab4Profile();
    profiles.push(profile);

    expect(profile).toBeGreaterThan(0);
  });

  it('should create XYZ profile', () => {
    const profile = engine.createXYZProfile();
    profiles.push(profile);

    expect(profile).toBeGreaterThan(0);
  });

  it('should open profile from memory buffer', async () => {
    const profilePath = join(FIXTURES_DIR, 'rgb/sRGB Color Space Profile.icm');
    const buffer = await readFile(profilePath);
    const uint8Array = new Uint8Array(buffer);

    const profile = engine.openProfileFromMem(uint8Array);
    profiles.push(profile);

    expect(profile).toBeGreaterThan(0);
  });

  it('should open CMYK profile from memory', async () => {
    const profilePath = join(FIXTURES_DIR, 'cmyk/CoatedFOGRA39.icc');
    const buffer = await readFile(profilePath);
    const uint8Array = new Uint8Array(buffer);

    const profile = engine.openProfileFromMem(uint8Array);
    profiles.push(profile);

    expect(profile).toBeGreaterThan(0);
  });

  it('should close profile without error', () => {
    const profile = engine.createSRGBProfile();

    // Should not throw
    expect(() => engine.closeProfile(profile)).not.toThrow();
  });

  it('should get D50 white point', () => {
    const d50Ptr = engine.getD50();

    expect(d50Ptr).toBeGreaterThan(0);
  });
});
