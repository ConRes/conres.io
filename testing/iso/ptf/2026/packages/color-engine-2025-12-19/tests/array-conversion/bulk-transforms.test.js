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
const FIXTURES_DIR = join(__dirname, '../fixtures/profiles');

describe('Bulk Array Transformations', () => {
  let engine;
  const resources = [];

  beforeAll(async () => {
    engine = await createEngine();
  });

  afterEach(() => {
    resources.forEach(r => {
      if (r.type === 'transform') engine.deleteTransform(r.handle);
      if (r.type === 'profile') engine.closeProfile(r.handle);
    });
    resources.length = 0;
  });

  it('should transform multiple RGB pixels to CMYK', async () => {
    const srgb = engine.createSRGBProfile();
    resources.push({ type: 'profile', handle: srgb });

    const cmykBuffer = await readFile(join(FIXTURES_DIR, 'cmyk/CoatedFOGRA39.icc'));
    const cmyk = engine.openProfileFromMem(new Uint8Array(cmykBuffer));
    resources.push({ type: 'profile', handle: cmyk });

    const transform = engine.createTransform(
      srgb,
      TYPE_RGB_8,
      cmyk,
      TYPE_CMYK_8,
      INTENT_RELATIVE_COLORIMETRIC,
      cmsFLAGS_BLACKPOINTCOMPENSATION
    );
    resources.push({ type: 'transform', handle: transform });

    // Test with 10 pixels: white, black, red, green, blue, cyan, magenta, yellow, gray50, gray25
    const pixelCount = 10;
    const rgbArray = new Uint8Array([
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

    const cmykArray = new Uint8Array(pixelCount * 4);

    // Transform all pixels at once
    engine.transformArray(transform, rgbArray, cmykArray, pixelCount);

    // Verify white transformed correctly (minimal CMY, low K)
    expect(cmykArray[0]).toBeLessThan(10);  // C
    expect(cmykArray[1]).toBeLessThan(10);  // M
    expect(cmykArray[2]).toBeLessThan(10);  // Y
    expect(cmykArray[3]).toBeLessThan(10);  // K

    // Verify black transformed correctly (high K)
    expect(cmykArray[7]).toBeGreaterThan(240); // K for black

    // Verify red has high magenta and yellow
    expect(cmykArray[8]).toBeLessThan(10);     // C for red should be low
    expect(cmykArray[9]).toBeGreaterThan(200); // M for red should be high
  });

  it('should transform using convenience method', async () => {
    const srgb = engine.createSRGBProfile();
    resources.push({ type: 'profile', handle: srgb });

    const cmykBuffer = await readFile(join(FIXTURES_DIR, 'cmyk/CoatedFOGRA39.icc'));
    const cmyk = engine.openProfileFromMem(new Uint8Array(cmykBuffer));
    resources.push({ type: 'profile', handle: cmyk });

    const transform = engine.createTransform(
      srgb,
      TYPE_RGB_8,
      cmyk,
      TYPE_CMYK_8,
      INTENT_RELATIVE_COLORIMETRIC,
      cmsFLAGS_BLACKPOINTCOMPENSATION
    );
    resources.push({ type: 'transform', handle: transform });

    const pixelCount = 3;
    const rgbArray = new Uint8Array([
      255, 255, 255,  // White
      128, 128, 128,  // Gray
      0, 0, 0         // Black
    ]);
    const cmykArray = new Uint8Array(pixelCount * 4);

    // Use convenience method
    engine.transformRGBtoCMYK(transform, rgbArray, cmykArray, pixelCount);

    // Verify transformation worked
    expect(cmykArray.length).toBe(12); // 3 pixels * 4 channels
    expect(cmykArray[11]).toBeGreaterThan(240); // Black K
  });

  it('should handle large arrays efficiently', async () => {
    const srgb = engine.createSRGBProfile();
    resources.push({ type: 'profile', handle: srgb });

    const cmykBuffer = await readFile(join(FIXTURES_DIR, 'cmyk/CoatedFOGRA39.icc'));
    const cmyk = engine.openProfileFromMem(new Uint8Array(cmykBuffer));
    resources.push({ type: 'profile', handle: cmyk });

    const transform = engine.createTransform(
      srgb,
      TYPE_RGB_8,
      cmyk,
      TYPE_CMYK_8,
      INTENT_RELATIVE_COLORIMETRIC,
      cmsFLAGS_BLACKPOINTCOMPENSATION
    );
    resources.push({ type: 'transform', handle: transform });

    // Test with 1000 pixels
    const pixelCount = 1000;
    const rgbArray = new Uint8Array(pixelCount * 3);
    const cmykArray = new Uint8Array(pixelCount * 4);

    // Fill with gradient
    for (let i = 0; i < pixelCount; i++) {
      const value = Math.floor((i / pixelCount) * 255);
      rgbArray[i * 3] = value;
      rgbArray[i * 3 + 1] = value;
      rgbArray[i * 3 + 2] = value;
    }

    const startTime = performance.now();
    engine.transformArray(transform, rgbArray, cmykArray, pixelCount);
    const endTime = performance.now();

    // Verify transformation completed
    expect(cmykArray.length).toBe(4000);

    // Basic performance check (should complete in reasonable time)
    const duration = endTime - startTime;
    expect(duration).toBeLessThan(100); // Should be fast (<100ms)

    // Verify first pixel (black)
    expect(cmykArray[3]).toBeGreaterThan(240);

    // Verify last pixel (white)
    expect(cmykArray[3996]).toBeLessThan(10); // C
    expect(cmykArray[3997]).toBeLessThan(10); // M
    expect(cmykArray[3998]).toBeLessThan(10); // Y
    expect(cmykArray[3999]).toBeLessThan(10); // K
  });

  it('should handle float arrays', async () => {
    const srgb = engine.createSRGBProfile();
    resources.push({ type: 'profile', handle: srgb });

    const cmykBuffer = await readFile(join(FIXTURES_DIR, 'cmyk/CoatedFOGRA39.icc'));
    const cmyk = engine.openProfileFromMem(new Uint8Array(cmykBuffer));
    resources.push({ type: 'profile', handle: cmyk });

    const transform = engine.createTransform(
      srgb,
      TYPE_RGB_FLT,
      cmyk,
      TYPE_CMYK_FLT,
      INTENT_RELATIVE_COLORIMETRIC,
      cmsFLAGS_BLACKPOINTCOMPENSATION
    );
    resources.push({ type: 'transform', handle: transform });

    const pixelCount = 3;
    const rgbArray = new Float32Array([
      1.0, 1.0, 1.0,  // White
      0.5, 0.5, 0.5,  // Gray
      0.0, 0.0, 0.0   // Black
    ]);
    const cmykArray = new Float32Array(pixelCount * 4);

    engine.transformArray(transform, rgbArray, cmykArray, pixelCount);

    // Verify transformation worked with floats
    expect(cmykArray.length).toBe(12);

    // Little-CMS float format uses 0-100 range for CMYK, not 0-1
    // White should have low CMYK values
    expect(cmykArray[0]).toBeLessThan(10);
    expect(cmykArray[1]).toBeLessThan(10);
    expect(cmykArray[2]).toBeLessThan(10);
    expect(cmykArray[3]).toBeLessThan(10);

    // Black should have K > 0 (basic sanity check for as-is functionality)
    expect(cmykArray[11]).toBeGreaterThan(0);
  });
});
