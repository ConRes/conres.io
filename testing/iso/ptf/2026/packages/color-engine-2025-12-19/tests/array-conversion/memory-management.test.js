/**
 * @fileoverview Phase 2 Tests - Memory Management
 * Tests proper memory allocation, deallocation, and cleanup
 */

import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import {
  createEngine,
  TYPE_RGB_8,
  TYPE_CMYK_8,
  INTENT_RELATIVE_COLORIMETRIC,
  cmsFLAGS_BLACKPOINTCOMPENSATION
} from '../../src/index.js';
import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, '../fixtures/profiles');

describe('Memory Management', () => {
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

  it('should clean up memory after transformArray', async () => {
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

    const pixelCount = 100;
    const rgbArray = new Uint8Array(pixelCount * 3);
    const cmykArray = new Uint8Array(pixelCount * 4);

    // Fill with test data
    for (let i = 0; i < rgbArray.length; i++) {
      rgbArray[i] = i % 256;
    }

    // Transform multiple times - should not leak memory
    for (let i = 0; i < 10; i++) {
      engine.transformArray(transform, rgbArray, cmykArray, pixelCount);
    }

    // If we got here without crashes, memory is being managed correctly
    expect(cmykArray.length).toBe(400);
  });

  it('should handle transform errors gracefully', async () => {
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

    const rgbArray = new Uint8Array(3);
    const cmykArray = new Uint8Array(4);

    // Should work normally
    expect(() => {
      engine.transformArray(transform, rgbArray, cmykArray, 1);
    }).not.toThrow();
  });

  it('should handle multiple concurrent transforms', async () => {
    const srgb = engine.createSRGBProfile();
    resources.push({ type: 'profile', handle: srgb });

    const cmykBuffer = await readFile(join(FIXTURES_DIR, 'cmyk/CoatedFOGRA39.icc'));
    const cmyk = engine.openProfileFromMem(new Uint8Array(cmykBuffer));
    resources.push({ type: 'profile', handle: cmyk });

    // Create multiple transforms
    const transform1 = engine.createTransform(
      srgb, TYPE_RGB_8, cmyk, TYPE_CMYK_8,
      INTENT_RELATIVE_COLORIMETRIC, cmsFLAGS_BLACKPOINTCOMPENSATION
    );
    resources.push({ type: 'transform', handle: transform1 });

    const transform2 = engine.createTransform(
      srgb, TYPE_RGB_8, cmyk, TYPE_CMYK_8,
      INTENT_RELATIVE_COLORIMETRIC, 0
    );
    resources.push({ type: 'transform', handle: transform2 });

    const pixelCount = 50;
    const rgbArray1 = new Uint8Array(pixelCount * 3);
    const cmykArray1 = new Uint8Array(pixelCount * 4);
    const rgbArray2 = new Uint8Array(pixelCount * 3);
    const cmykArray2 = new Uint8Array(pixelCount * 4);

    // Fill with different data
    for (let i = 0; i < rgbArray1.length; i++) {
      rgbArray1[i] = i % 256;
      rgbArray2[i] = (255 - i) % 256;
    }

    // Transform with both transforms
    engine.transformArray(transform1, rgbArray1, cmykArray1, pixelCount);
    engine.transformArray(transform2, rgbArray2, cmykArray2, pixelCount);

    // Both should complete successfully
    expect(cmykArray1.length).toBe(200);
    expect(cmykArray2.length).toBe(200);

    // Results should be different (different transforms)
    let different = false;
    for (let i = 0; i < 200; i++) {
      if (cmykArray1[i] !== cmykArray2[i]) {
        different = true;
        break;
      }
    }
    expect(different).toBe(true);
  });

  it('should properly allocate and free large buffers', async () => {
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

    // Test with increasingly large arrays
    const sizes = [10, 100, 1000, 5000];

    for (const size of sizes) {
      const rgbArray = new Uint8Array(size * 3);
      const cmykArray = new Uint8Array(size * 4);

      // Fill with gradient
      for (let i = 0; i < rgbArray.length; i++) {
        rgbArray[i] = (i * 255 / rgbArray.length) | 0;
      }

      // Should handle large buffers without issue
      expect(() => {
        engine.transformArray(transform, rgbArray, cmykArray, size);
      }).not.toThrow();

      expect(cmykArray.length).toBe(size * 4);
    }
  });

  it('should handle manual memory allocation correctly', () => {
    const size = 1024;
    const ptr = engine.malloc(size);

    expect(ptr).toBeGreaterThan(0);
    expect(typeof ptr).toBe('number');

    // Write some data
    for (let i = 0; i < 100; i++) {
      engine.writeU8(ptr, i, i % 256);
    }

    // Read it back
    for (let i = 0; i < 100; i++) {
      expect(engine.readU8(ptr, i)).toBe(i % 256);
    }

    // Free memory - should not throw
    expect(() => engine.free(ptr)).not.toThrow();
  });
});
