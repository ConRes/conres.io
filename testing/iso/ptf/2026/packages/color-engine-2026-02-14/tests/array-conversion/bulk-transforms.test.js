/**
 * @fileoverview Phase 2 Tests - Bulk Array Transformations
 * Tests transforming multiple pixels efficiently using array methods
 */

import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import {
  createEngine,
  TYPE_RGB_8,
  TYPE_CMYK_8,
  TYPE_RGB_FLT,
  TYPE_CMYK_FLT,
  INTENT_RELATIVE_COLORIMETRIC,
  cmsFLAGS_BLACKPOINTCOMPENSATION
} from '../../src/index.js';
import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, '../fixtures');

describe('Bulk Array Transformations', () => {
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

  it('should transform multiple RGB pixels to CMYK', async () => {
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
      INTENT_RELATIVE_COLORIMETRIC,
      cmsFLAGS_BLACKPOINTCOMPENSATION
    );
    resources.push({ type: 'transform', handle: transformHandle });

    // Test with 10 pixels: white, black, red, green, blue, cyan, magenta, yellow, gray50, gray25
    const pixelCount = 10;
    const rgbUint8Array = new Uint8Array([
      255, 255, 255,  // White
      0, 0, 0,        // Black
      255, 0, 0,      // Red
      0, 255, 0,      // Green
      0, 0, 255,      // Blue
      0, 255, 255,    // Cyan
      255, 0, 255,    // Magenta
      255, 255, 0,    // Yellow
      128, 128, 128,  // Gray 50%
      64, 64, 64      // Gray 25%
    ]);

    const cmykUint8Array = new Uint8Array(pixelCount * 4);

    // Transform all pixels at once
    engine.transformArray(transformHandle, rgbUint8Array, cmykUint8Array, pixelCount);

    // Verify white transformed correctly (minimal CMY, low K)
    expect(cmykUint8Array[0]).toBeLessThan(10);  // C
    expect(cmykUint8Array[1]).toBeLessThan(10);  // M
    expect(cmykUint8Array[2]).toBeLessThan(10);  // Y
    expect(cmykUint8Array[3]).toBeLessThan(10);  // K

    // Verify black transformed correctly (high K)
    expect(cmykUint8Array[7]).toBeGreaterThan(240); // K for black

    // Verify red has high magenta and yellow
    expect(cmykUint8Array[8]).toBeLessThan(10);     // C for red should be low
    expect(cmykUint8Array[9]).toBeGreaterThan(200); // M for red should be high
  });

  it('should transform using convenience method', async () => {
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
      INTENT_RELATIVE_COLORIMETRIC,
      cmsFLAGS_BLACKPOINTCOMPENSATION
    );
    resources.push({ type: 'transform', handle: transformHandle });

    const pixelCount = 3;
    const rgbUint8Array = new Uint8Array([
      255, 255, 255,  // White
      128, 128, 128,  // Gray
      0, 0, 0         // Black
    ]);
    const cmykUint8Array = new Uint8Array(pixelCount * 4);

    // Use convenience method
    engine.transformRGBtoCMYK(transformHandle, rgbUint8Array, cmykUint8Array, pixelCount);

    // Verify transformation worked
    expect(cmykUint8Array.length).toBe(12); // 3 pixels * 4 channels
    expect(cmykUint8Array[11]).toBeGreaterThan(240); // Black K
  });

  it('should handle large arrays efficiently', async () => {
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
      INTENT_RELATIVE_COLORIMETRIC,
      cmsFLAGS_BLACKPOINTCOMPENSATION
    );
    resources.push({ type: 'transform', handle: transformHandle });

    // Test with 1000 pixels
    const pixelCount = 1000;
    const rgbUint8Array = new Uint8Array(pixelCount * 3);
    const cmykUint8Array = new Uint8Array(pixelCount * 4);

    // Fill with gradient
    for (let i = 0; i < pixelCount; i++) {
      const value = Math.floor((i / pixelCount) * 255);
      rgbUint8Array[i * 3] = value;
      rgbUint8Array[i * 3 + 1] = value;
      rgbUint8Array[i * 3 + 2] = value;
    }

    const startTime = performance.now();
    engine.transformArray(transformHandle, rgbUint8Array, cmykUint8Array, pixelCount);
    const endTime = performance.now();

    // Verify transformation completed
    expect(cmykUint8Array.length).toBe(4000);

    // Basic performance check (should complete in reasonable time)
    const duration = endTime - startTime;
    expect(duration).toBeLessThan(100); // Should be fast (<100ms)

    // Verify first pixel (black)
    expect(cmykUint8Array[3]).toBeGreaterThan(240);

    // Verify last pixel (white)
    expect(cmykUint8Array[3996]).toBeLessThan(10); // C
    expect(cmykUint8Array[3997]).toBeLessThan(10); // M
    expect(cmykUint8Array[3998]).toBeLessThan(10); // Y
    expect(cmykUint8Array[3999]).toBeLessThan(10); // K
  });

  it('should handle float arrays', async () => {
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
      INTENT_RELATIVE_COLORIMETRIC,
      cmsFLAGS_BLACKPOINTCOMPENSATION
    );
    resources.push({ type: 'transform', handle: transformHandle });

    const rgbFloat32Array = new Float32Array([
      1.0, 1.0, 1.0,  // White
      0.5, 0.5, 0.5,  // Gray
      0.0, 0.0, 0.0   // Black
    ]);
    const pixelCount = rgbFloat32Array.length / 3;
    const cmykFloat32Array = new Float32Array(pixelCount * 4);

    engine.transformArray(transformHandle, rgbFloat32Array, cmykFloat32Array, pixelCount);

    // Verify transformation worked with floats
    expect(cmykFloat32Array.length).toBe(12);

    // Little-CMS float format uses 0-100 range for CMYK, not 0-1
    // White should have low CMYK values
    expect(cmykFloat32Array[0]).toBeLessThan(10);
    expect(cmykFloat32Array[1]).toBeLessThan(10);
    expect(cmykFloat32Array[2]).toBeLessThan(10);
    expect(cmykFloat32Array[3]).toBeLessThan(10);

    // Black should have K > 0 (basic sanity check for as-is functionality)
    expect(cmykFloat32Array[11]).toBeGreaterThan(0);
  });
});
