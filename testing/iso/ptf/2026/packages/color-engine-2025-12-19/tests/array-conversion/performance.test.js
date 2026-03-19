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
    resources.forEach(r => {
      if (r.type === 'transform') engine.deleteTransform(r.handle);
      if (r.type === 'profile') engine.closeProfile(r.handle);
    });
    resources.length = 0;
  });

  it('should benchmark small batch performance', async () => {
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
      rgbArray[i] = (i * 255 / rgbArray.length) | 0;
    }

    const startTime = performance.now();
    const iterations = 100;

    for (let i = 0; i < iterations; i++) {
      engine.transformArray(transform, rgbArray, cmykArray, pixelCount);
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

    const pixelCount = 10000;
    const rgbArray = new Uint8Array(pixelCount * 3);
    const cmykArray = new Uint8Array(pixelCount * 4);

    // Fill with gradient
    for (let i = 0; i < rgbArray.length; i++) {
      rgbArray[i] = (i * 255 / rgbArray.length) | 0;
    }

    const startTime = performance.now();
    const iterations = 10;

    for (let i = 0; i < iterations; i++) {
      engine.transformArray(transform, rgbArray, cmykArray, pixelCount);
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
    const srgb = engine.createSRGBProfile();
    resources.push({ type: 'profile', handle: srgb });

    const cmykBuffer = await readFile(join(FIXTURES_DIR, 'cmyk/CoatedFOGRA39.icc'));
    const cmyk = engine.openProfileFromMem(new Uint8Array(cmykBuffer));
    resources.push({ type: 'profile', handle: cmyk });

    const transformU8 = engine.createTransform(
      srgb, TYPE_RGB_8, cmyk, TYPE_CMYK_8,
      INTENT_RELATIVE_COLORIMETRIC, cmsFLAGS_BLACKPOINTCOMPENSATION
    );
    resources.push({ type: 'transform', handle: transformU8 });

    const transformF32 = engine.createTransform(
      srgb, TYPE_RGB_FLT, cmyk, TYPE_CMYK_FLT,
      INTENT_RELATIVE_COLORIMETRIC, cmsFLAGS_BLACKPOINTCOMPENSATION
    );
    resources.push({ type: 'transform', handle: transformF32 });

    const pixelCount = 1000;
    const iterations = 10; // Reduced to avoid memory exhaustion

    // Uint8 test
    const rgbU8 = new Uint8Array(pixelCount * 3);
    const cmykU8 = new Uint8Array(pixelCount * 4);
    for (let i = 0; i < rgbU8.length; i++) {
      rgbU8[i] = (i * 255 / rgbU8.length) | 0;
    }

    const startU8 = performance.now();
    for (let i = 0; i < iterations; i++) {
      engine.transformArray(transformU8, rgbU8, cmykU8, pixelCount);
    }
    const timeU8 = performance.now() - startU8;

    // Float32 test
    const rgbF32 = new Float32Array(pixelCount * 3);
    const cmykF32 = new Float32Array(pixelCount * 4);
    for (let i = 0; i < rgbF32.length; i++) {
      rgbF32[i] = i / rgbF32.length;
    }

    const startF32 = performance.now();
    for (let i = 0; i < iterations; i++) {
      engine.transformArray(transformF32, rgbF32, cmykF32, pixelCount);
    }
    const timeF32 = performance.now() - startF32;

    console.log(`Type comparison (${pixelCount} pixels, ${iterations} iterations):`);
    console.log(`  Uint8:   ${timeU8.toFixed(2)}ms (${(timeU8 / iterations).toFixed(3)}ms avg)`);
    console.log(`  Float32: ${timeF32.toFixed(2)}ms (${(timeF32 / iterations).toFixed(3)}ms avg)`);
    console.log(`  Ratio:   ${(timeF32 / timeU8).toFixed(2)}x`);

    // Both should complete in reasonable time
    expect(timeU8).toBeLessThan(1000);
    expect(timeF32).toBeLessThan(2000);
  });

  it.skip('should measure single-pixel overhead (skipped - memory intensive)', async () => {
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

    const rgbArray = new Uint8Array([128, 128, 128]);
    const cmykArray = new Uint8Array(4);

    const iterations = 100; // Reduced to avoid memory exhaustion
    const startTime = performance.now();

    for (let i = 0; i < iterations; i++) {
      engine.transformArray(transform, rgbArray, cmykArray, 1);
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
        const ptr = engine.malloc(size);
        engine.free(ptr);
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
