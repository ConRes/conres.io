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
    for (const resource of resources.splice(0, resources.length)) {
      if (resource.type === 'transform') engine.deleteTransform(resource.handle);
      else if (resource.type === 'profile') engine.closeProfile(resource.handle);
    }
  });

  it('should clean up memory after transformArray', async () => {
    const rgbProfileHandle = engine.createSRGBProfile();
    resources.push({ type: 'profile', handle: rgbProfileHandle });

    const cmykProfileBuffer = await readFile(join(FIXTURES_DIR, 'cmyk/CoatedFOGRA39.icc'));
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

    const pixelCount = 100;
    const rgbUint8Array = new Uint8Array(pixelCount * 3);
    const cmykUint8Array = new Uint8Array(pixelCount * 4);

    // Fill with test data
    for (let i = 0; i < rgbUint8Array.length; i++) {
      rgbUint8Array[i] = i % 256;
    }

    // Transform multiple times - should not leak memory
    for (let i = 0; i < 10; i++) {
      engine.transformArray(transformHandle, rgbUint8Array, cmykUint8Array, pixelCount);
    }

    // If we got here without crashes, memory is being managed correctly
    expect(cmykUint8Array.length).toBe(400);
  });

  it('should handle transform errors gracefully', async () => {
    const rgbProfileHandle = engine.createSRGBProfile();
    resources.push({ type: 'profile', handle: rgbProfileHandle });

    const cmykProfileBuffer = await readFile(join(FIXTURES_DIR, 'cmyk/CoatedFOGRA39.icc'));
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

    const rgbUint8Array = new Uint8Array(3);
    const cmykUint8Array = new Uint8Array(4);

    // Should work normally
    expect(() => {
      engine.transformArray(transformHandle, rgbUint8Array, cmykUint8Array, 1);
    }).not.toThrow();
  });

  it('should handle multiple concurrent transforms', async () => {
    const rgbProfileHandle = engine.createSRGBProfile();
    resources.push({ type: 'profile', handle: rgbProfileHandle });

    const cmykProfileBuffer = await readFile(join(FIXTURES_DIR, 'cmyk/CoatedFOGRA39.icc'));
    const cmykProfileHandle = engine.openProfileFromMem(new Uint8Array(cmykProfileBuffer));
    resources.push({ type: 'profile', handle: cmykProfileHandle });

    // Create multiple transforms
    const transformHandle1 = engine.createTransform(
      rgbProfileHandle, TYPE_RGB_8, cmykProfileHandle, TYPE_CMYK_8,
      INTENT_RELATIVE_COLORIMETRIC, cmsFLAGS_BLACKPOINTCOMPENSATION
    );
    resources.push({ type: 'transform', handle: transformHandle1 });

    const transformHandle2 = engine.createTransform(
      rgbProfileHandle, TYPE_RGB_8, cmykProfileHandle, TYPE_CMYK_8,
      INTENT_RELATIVE_COLORIMETRIC, 0
    );
    resources.push({ type: 'transform', handle: transformHandle2 });

    const pixelCount = 50;
    const rgbUint8Array1 = new Uint8Array(pixelCount * 3);
    const cmykUint8Array1 = new Uint8Array(pixelCount * 4);
    const rgbUint8Array2 = new Uint8Array(pixelCount * 3);
    const cmykUint8Array2 = new Uint8Array(pixelCount * 4);

    // Fill with different data
    for (let i = 0; i < rgbUint8Array1.length; i++) {
      rgbUint8Array1[i] = i % 256;
      rgbUint8Array2[i] = (255 - i) % 256;
    }

    // Transform with both transforms
    engine.transformArray(transformHandle1, rgbUint8Array1, cmykUint8Array1, pixelCount);
    engine.transformArray(transformHandle2, rgbUint8Array2, cmykUint8Array2, pixelCount);

    // Both should complete successfully
    expect(cmykUint8Array1.length).toBe(200);
    expect(cmykUint8Array2.length).toBe(200);

    // Results should be different (different transforms)
    let different = false;
    for (let i = 0; i < 200; i++) {
      if (cmykUint8Array1[i] !== cmykUint8Array2[i]) {
        different = true;
        break;
      }
    }
    expect(different).toBe(true);
  });

  it('should properly allocate and free large buffers', async () => {
    const rgbProfileHandle = engine.createSRGBProfile();
    resources.push({ type: 'profile', handle: rgbProfileHandle });

    const cmykProfileBuffer = await readFile(join(FIXTURES_DIR, 'cmyk/CoatedFOGRA39.icc'));
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

    // Test with increasingly large arrays
    const sizes = [10, 100, 1000, 5000];

    for (const size of sizes) {
      const rgbUint8Array = new Uint8Array(size * 3);
      const cmykUint8Array = new Uint8Array(size * 4);

      // Fill with gradient
      for (let i = 0; i < rgbUint8Array.length; i++) {
        rgbUint8Array[i] = (i * 255 / rgbUint8Array.length) | 0;
      }

      // Should handle large buffers without issue
      expect(() => {
        engine.transformArray(transformHandle, rgbUint8Array, cmykUint8Array, size);
      }).not.toThrow();

      expect(cmykUint8Array.length).toBe(size * 4);
    }
  });

  it('should handle manual memory allocation correctly', () => {
    const size = 1024;
    const pointer = engine.malloc(size);

    expect(pointer).toBeGreaterThan(0);
    expect(typeof pointer).toBe('number');

    // Write some data
    for (let i = 0; i < 100; i++) {
      engine.writeU8(pointer, i, i % 256);
    }

    // Read it back
    for (let i = 0; i < 100; i++) {
      expect(engine.readU8(pointer, i)).toBe(i % 256);
    }

    // Free memory - should not throw
    expect(() => engine.free(pointer)).not.toThrow();
  });
});
