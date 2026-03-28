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
const FIXTURES_DIR = join(__dirname, '../fixtures');

describe('Basic Transforms', () => {
  let engine;
  const resources = []; // Track all resources for cleanup

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

  it('should create RGB to CMYK transform', async () => {
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

    expect(transformHandle).toBeGreaterThan(0);
  });

  it('should perform RGB to CMYK color transformation', async () => {
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

    // Transform white (255, 255, 255) RGB to CMYK
    const rgbUint8ArrayPointer = engine.malloc(3);
    const cmykUint8ArrayPointer = engine.malloc(4);

    engine.writeU8(rgbUint8ArrayPointer, 0, 255);  // R
    engine.writeU8(rgbUint8ArrayPointer, 1, 255);  // G
    engine.writeU8(rgbUint8ArrayPointer, 2, 255);  // B

    engine.doTransform(transformHandle, rgbUint8ArrayPointer, cmykUint8ArrayPointer, 1);

    const c = engine.readU8(cmykUint8ArrayPointer, 0);
    const m = engine.readU8(cmykUint8ArrayPointer, 1);
    const y = engine.readU8(cmykUint8ArrayPointer, 2);
    const k = engine.readU8(cmykUint8ArrayPointer, 3);

    // White should map to minimal CMY, low K
    expect(c).toBeLessThan(10);
    expect(m).toBeLessThan(10);
    expect(y).toBeLessThan(10);
    expect(k).toBeLessThan(10);

    engine.free(rgbUint8ArrayPointer);
    engine.free(cmykUint8ArrayPointer);
  });

  it('should transform black RGB to CMYK', async () => {
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

    // Transform black (0, 0, 0) RGB to CMYK
    const rgbUint8ArrayPointer = engine.malloc(3);
    const cmykUint8ArrayPointer = engine.malloc(4);

    engine.writeU8(rgbUint8ArrayPointer, 0, 0);  // R
    engine.writeU8(rgbUint8ArrayPointer, 1, 0);  // G
    engine.writeU8(rgbUint8ArrayPointer, 2, 0);  // B

    engine.doTransform(transformHandle, rgbUint8ArrayPointer, cmykUint8ArrayPointer, 1);

    const c = engine.readU8(cmykUint8ArrayPointer, 0);
    const m = engine.readU8(cmykUint8ArrayPointer, 1);
    const y = engine.readU8(cmykUint8ArrayPointer, 2);
    const k = engine.readU8(cmykUint8ArrayPointer, 3);

    // Black should map to high K
    expect(k).toBeGreaterThan(240);

    engine.free(rgbUint8ArrayPointer);
    engine.free(cmykUint8ArrayPointer);
  });

  it('should delete transform without error', async () => {
    const rgbProfileHandle = engine.createSRGBProfile();
    resources.push({ type: 'profile', handle: rgbProfileHandle });

    const labProfileHandle = engine.createLab4Profile();
    resources.push({ type: 'profile', handle: labProfileHandle });

    const transformHandle = engine.createTransform(
      rgbProfileHandle,
      TYPE_RGB_FLT,
      labProfileHandle,
      TYPE_Lab_FLT,  // Correct: use Lab format for Lab profile
      INTENT_RELATIVE_COLORIMETRIC,
      0
    );

    // Should not throw
    expect(() => engine.deleteTransform(transformHandle)).not.toThrow();
  });
});
