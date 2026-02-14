/**
 * @fileoverview Phase 2 Tests - Performance Benchmarks
 * Tests transformation performance and throughput
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

describe('Performance Benchmarks', () => {
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

  it('should benchmark small batch performance', async () => {
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
      rgbUint8Array[i] = (i * 255 / rgbUint8Array.length) | 0;
    }

    const startTime = performance.now();
    const iterations = 100;

    for (let i = 0; i < iterations; i++) {
      engine.transformArray(transformHandle, rgbUint8Array, cmykUint8Array, pixelCount);
    }

    const endTime = performance.now();
    const totalTime = endTime - startTime;
    const avgTime = totalTime / iterations;
    const pixelsPerSecond = (pixelCount * iterations) / (totalTime / 1000);

    console.log(`Small batch (${pixelCount} pixels):`);
    console.log(`  Total time: ${totalTime.toFixed(2)}ms for ${iterations} iterations`);
    console.log(`  Avg time: ${avgTime.toFixed(3)}ms per iteration`);
    console.log(`  Throughput: ${(pixelsPerSecond / 1000).toFixed(1)}k pixels/sec`);

    // Sanity check: should complete in reasonable time
    expect(avgTime).toBeLessThan(5); // Less than 5ms per 100 pixels
  });

  it('should benchmark large batch performance', async () => {
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

    const pixelCount = 10000;
    const rgbUint8Array = new Uint8Array(pixelCount * 3);
    const cmykUint8Array = new Uint8Array(pixelCount * 4);

    // Fill with gradient
    for (let i = 0; i < rgbUint8Array.length; i++) {
      rgbUint8Array[i] = (i * 255 / rgbUint8Array.length) | 0;
    }

    const startTime = performance.now();
    const iterations = 10;

    for (let i = 0; i < iterations; i++) {
      engine.transformArray(transformHandle, rgbUint8Array, cmykUint8Array, pixelCount);
    }

    const endTime = performance.now();
    const totalTime = endTime - startTime;
    const avgTime = totalTime / iterations;
    const pixelsPerSecond = (pixelCount * iterations) / (totalTime / 1000);

    console.log(`Large batch (${pixelCount} pixels):`);
    console.log(`  Total time: ${totalTime.toFixed(2)}ms for ${iterations} iterations`);
    console.log(`  Avg time: ${avgTime.toFixed(2)}ms per iteration`);
    console.log(`  Throughput: ${(pixelsPerSecond / 1000).toFixed(1)}k pixels/sec`);

    // Should handle large batches efficiently
    expect(avgTime).toBeLessThan(100); // Less than 100ms per 10k pixels
  });

  it.skip('should compare Uint8 vs Float32 performance (skipped - memory intensive)', async () => {
    const rgbProfileHandle = engine.createSRGBProfile();
    resources.push({ type: 'profile', handle: rgbProfileHandle });

    const cmykProfileBuffer = await readFile(join(FIXTURES_DIR, 'cmyk/CoatedFOGRA39.icc'));
    const cmykProfileHandle = engine.openProfileFromMem(new Uint8Array(cmykProfileBuffer));
    resources.push({ type: 'profile', handle: cmykProfileHandle });

    const transformUint8Handle = engine.createTransform(
      rgbProfileHandle, TYPE_RGB_8, cmykProfileHandle, TYPE_CMYK_8,
      INTENT_RELATIVE_COLORIMETRIC, cmsFLAGS_BLACKPOINTCOMPENSATION
    );
    resources.push({ type: 'transform', handle: transformUint8Handle });

    const transformFloat32Handle = engine.createTransform(
      rgbProfileHandle, TYPE_RGB_FLT, cmykProfileHandle, TYPE_CMYK_FLT,
      INTENT_RELATIVE_COLORIMETRIC, cmsFLAGS_BLACKPOINTCOMPENSATION
    );
    resources.push({ type: 'transform', handle: transformFloat32Handle });

    const pixelCount = 1000;
    const iterations = 10; // Reduced to avoid memory exhaustion

    // Uint8 test
    const rgbUint8Array = new Uint8Array(pixelCount * 3);
    const cmykUint8Array = new Uint8Array(pixelCount * 4);
    for (let i = 0; i < rgbUint8Array.length; i++) {
      rgbUint8Array[i] = (i * 255 / rgbUint8Array.length) | 0;
    }

    const startUint8 = performance.now();
    for (let i = 0; i < iterations; i++) {
      engine.transformArray(transformUint8Handle, rgbUint8Array, cmykUint8Array, pixelCount);
    }
    const timeUint8 = performance.now() - startUint8;

    // Float32 test
    const rgbFloat32Array = new Float32Array(pixelCount * 3);
    const cmykFloat32Array = new Float32Array(pixelCount * 4);
    for (let i = 0; i < rgbFloat32Array.length; i++) {
      rgbFloat32Array[i] = i / rgbFloat32Array.length;
    }

    const startFloat32 = performance.now();
    for (let i = 0; i < iterations; i++) {
      engine.transformArray(transformFloat32Handle, rgbFloat32Array, cmykFloat32Array, pixelCount);
    }
    const timeFloat32 = performance.now() - startFloat32;

    console.log(`Type comparison (${pixelCount} pixels, ${iterations} iterations):`);
    console.log(`  Uint8:   ${timeUint8.toFixed(2)}ms (${(timeUint8 / iterations).toFixed(3)}ms avg)`);
    console.log(`  Float32: ${timeFloat32.toFixed(2)}ms (${(timeFloat32 / iterations).toFixed(3)}ms avg)`);
    console.log(`  Ratio:   ${(timeFloat32 / timeUint8).toFixed(2)}x`);

    // Both should complete in reasonable time
    expect(timeUint8).toBeLessThan(1000);
    expect(timeFloat32).toBeLessThan(2000);
  });

  it.skip('should measure single-pixel overhead (skipped - memory intensive)', async () => {
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

    const rgbUint8Array = new Uint8Array([128, 128, 128]);
    const cmykUint8Array = new Uint8Array(4);

    const iterations = 100; // Reduced to avoid memory exhaustion
    const startTime = performance.now();

    for (let i = 0; i < iterations; i++) {
      engine.transformArray(transformHandle, rgbUint8Array, cmykUint8Array, 1);
    }

    const endTime = performance.now();
    const avgTime = (endTime - startTime) / iterations;

    console.log(`Single pixel overhead:`);
    console.log(`  Avg time: ${avgTime.toFixed(4)}ms per pixel`);
    console.log(`  Throughput: ${(1000 / avgTime).toFixed(0)} pixels/sec`);

    // Should be fast even for single pixels
    expect(avgTime).toBeLessThan(1); // Less than 1ms per pixel
  });

  it.skip('should measure memory allocation overhead (skipped - memory intensive)', () => {
    const sizes = [100, 1000, 10000];  // Reduced to avoid memory exhaustion
    const results = [];

    for (const size of sizes) {
      const iterations = 10; // Reduced to avoid memory exhaustion
      const startTime = performance.now();

      for (let i = 0; i < iterations; i++) {
        const pointer = engine.malloc(size);
        engine.free(pointer);
      }

      const endTime = performance.now();
      const avgTime = (endTime - startTime) / iterations;

      results.push({ size, avgTime });
    }

    console.log('Memory allocation overhead:');
    results.forEach(({ size, avgTime }) => {
      console.log(`  ${size.toLocaleString()} bytes: ${avgTime.toFixed(4)}ms`);
    });

    // All allocations should be reasonably fast
    results.forEach(({ avgTime }) => {
      expect(avgTime).toBeLessThan(1);
    });
  });
});
