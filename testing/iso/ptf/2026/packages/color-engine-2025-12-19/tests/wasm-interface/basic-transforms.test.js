/**
 * @fileoverview Phase 1 Tests - Basic Transforms
 * Tests color transformation creation and execution
 */

import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import {
  createEngine,
  TYPE_RGB_8,
  TYPE_CMYK_8,
  TYPE_RGB_FLT,
  TYPE_Lab_FLT,
  INTENT_RELATIVE_COLORIMETRIC,
  cmsFLAGS_BLACKPOINTCOMPENSATION
} from '../../src/index.js';
import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, '../fixtures/profiles');

describe('Basic Transforms', () => {
  let engine;
  const resources = []; // Track all resources for cleanup

  beforeAll(async () => {
    engine = await createEngine();
  });

  afterEach(() => {
    // Clean up all resources
    resources.forEach(r => {
      if (r.type === 'transform') engine.deleteTransform(r.handle);
      if (r.type === 'profile') engine.closeProfile(r.handle);
    });
    resources.length = 0;
  });

  it('should create RGB to CMYK transform', async () => {
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

    expect(transform).toBeGreaterThan(0);
  });

  it('should perform RGB to CMYK color transformation', async () => {
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

    // Transform white (255, 255, 255) RGB to CMYK
    const inputPtr = engine.malloc(3);
    const outputPtr = engine.malloc(4);

    engine.writeU8(inputPtr, 0, 255);  // R
    engine.writeU8(inputPtr, 1, 255);  // G
    engine.writeU8(inputPtr, 2, 255);  // B

    engine.doTransform(transform, inputPtr, outputPtr, 1);

    const c = engine.readU8(outputPtr, 0);
    const m = engine.readU8(outputPtr, 1);
    const y = engine.readU8(outputPtr, 2);
    const k = engine.readU8(outputPtr, 3);

    // White should map to minimal CMY, low K
    expect(c).toBeLessThan(10);
    expect(m).toBeLessThan(10);
    expect(y).toBeLessThan(10);
    expect(k).toBeLessThan(10);

    engine.free(inputPtr);
    engine.free(outputPtr);
  });

  it('should transform black RGB to CMYK', async () => {
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

    // Transform black (0, 0, 0) RGB to CMYK
    const inputPtr = engine.malloc(3);
    const outputPtr = engine.malloc(4);

    engine.writeU8(inputPtr, 0, 0);  // R
    engine.writeU8(inputPtr, 1, 0);  // G
    engine.writeU8(inputPtr, 2, 0);  // B

    engine.doTransform(transform, inputPtr, outputPtr, 1);

    const c = engine.readU8(outputPtr, 0);
    const m = engine.readU8(outputPtr, 1);
    const y = engine.readU8(outputPtr, 2);
    const k = engine.readU8(outputPtr, 3);

    // Black should map to high K
    expect(k).toBeGreaterThan(240);

    engine.free(inputPtr);
    engine.free(outputPtr);
  });

  it('should delete transform without error', async () => {
    const srgb = engine.createSRGBProfile();
    resources.push({ type: 'profile', handle: srgb });

    const lab = engine.createLab4Profile();
    resources.push({ type: 'profile', handle: lab });

    const transform = engine.createTransform(
      srgb,
      TYPE_RGB_FLT,
      lab,
      TYPE_Lab_FLT,  // Correct: use Lab format for Lab profile
      INTENT_RELATIVE_COLORIMETRIC,
      0
    );

    // Should not throw
    expect(() => engine.deleteTransform(transform)).not.toThrow();
  });
});
