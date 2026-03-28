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
const FIXTURES_DIR = join(__dirname, '../fixtures');

describe('Profile Management', () => {
  let engine;
  const resources = [];

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

  it('should create sRGB profile', () => {
    const rgbProfileHandle = engine.createSRGBProfile();
    resources.push({type: 'profile', profile: rgbProfileHandle});

    expect(rgbProfileHandle).toBeGreaterThan(0);
    expect(typeof rgbProfileHandle).toBe('number');
  });

  it('should create Lab profile', () => {
    const labProfileHandle = engine.createLab4Profile();
    resources.push({type: 'profile', profile: labProfileHandle});

    expect(labProfileHandle).toBeGreaterThan(0);
  });

  it('should create XYZ profile', () => {
    const xyzProfileHandle = engine.createXYZProfile();
    resources.push({type: 'profile', profile: xyzProfileHandle});

    expect(xyzProfileHandle).toBeGreaterThan(0);
  });

  it('should open profile from memory buffer', async () => {
    const rgbProfilePath = join(FIXTURES_DIR, 'profiles/rgb/sRGB Color Space Profile.icm');
    const rgbProfileBuffer = await readFile(rgbProfilePath);
    const rgbProfileUint8ArrayBuffer = new Uint8Array(rgbProfileBuffer);

    const profile = engine.openProfileFromMem(rgbProfileUint8ArrayBuffer);
    resources.push({type: 'profile', profile: profile});

    expect(profile).toBeGreaterThan(0);
  });

  it('should open CMYK profile from memory', async () => {
    const cmykProfilePath = join(FIXTURES_DIR, 'profiles/cmyk/CoatedFOGRA39.icc');
    const cmykProfileBuffer = await readFile(cmykProfilePath);
    const cmykProfileUint8ArrayBuffer = new Uint8Array(cmykProfileBuffer);

    const profile = engine.openProfileFromMem(cmykProfileUint8ArrayBuffer);
    resources.push({type: 'profile', profile: profile});

    expect(profile).toBeGreaterThan(0);
  });

  it('should close profile without error', () => {
    const rgbProfileHandle = engine.createSRGBProfile();

    // Should not throw
    expect(() => engine.closeProfile(rgbProfileHandle)).not.toThrow();
  });

  it('should get D50 white point', () => {
    const whitePointD50Pointer = engine.getD50();

    expect(whitePointD50Pointer).toBeGreaterThan(0);
  });
});
