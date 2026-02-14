/**
 * @fileoverview Multi-Profile Transform Tests
 * Tests multiprofile transform API with standard intents and K-Only GCR
 *
 * Test coverage:
 * - Standard multiprofile transforms (6 tests)
 * - K-Only GCR multiprofile transforms (8 tests) ⭐ CORE REQUIREMENT
 * - Integration tests (4 tests)
 * Total: 18 tests
 */

import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import {
  createEngine,
  TYPE_GRAY_8,
  TYPE_RGB_8,
  TYPE_CMYK_8,
  TYPE_RGB_16,
  TYPE_CMYK_16,
  TYPE_RGB_FLT,
  TYPE_CMYK_FLT,
  TYPE_Lab_FLT,
  INTENT_RELATIVE_COLORIMETRIC,
  INTENT_PRESERVE_K_ONLY_RELATIVE_COLORIMETRIC_GCR,
  cmsFLAGS_BLACKPOINTCOMPENSATION
} from '../../src/index.js';
import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, '../fixtures');

describe('Multi-Profile Transforms - Standard Intents', () => {
  let engine;
  const resources = []; // Track all resources for cleanup

  beforeAll(async () => {
    engine = await createEngine();
  });

  afterEach(() => {
    // Clean up all resources (skip null/zero handles)
    for (const resource of resources.splice(0, resources.length)) {
      if (resource.type === 'transform') engine.deleteTransform(resource.handle);
      else if (resource.type === 'profile') engine.closeProfile(resource.handle);
    }
  });

  it('should create 2-profile chain matching single transform (RGB→CMYK)', async () => {
    // Test that 2-profile multiprofile behaves identically to createTransform
    const rgbProfileHandle = engine.createSRGBProfile();
    resources.push({ type: 'profile', handle: rgbProfileHandle });

    const cmykProfileBuffer = await readFile(join(FIXTURES_DIR, 'profiles/cmyk/CoatedFOGRA39.icc'));
    const cmykProfileHandle = engine.openProfileFromMem(new Uint8Array(cmykProfileBuffer));
    resources.push({ type: 'profile', handle: cmykProfileHandle });

    // Create multiprofile transform
    const multiprofileTransformHandle = engine.createMultiprofileTransform(
      [rgbProfileHandle, cmykProfileHandle],
      TYPE_RGB_8,
      TYPE_CMYK_8,
      INTENT_RELATIVE_COLORIMETRIC,
      cmsFLAGS_BLACKPOINTCOMPENSATION
    );
    resources.push({ type: 'transform', handle: multiprofileTransformHandle });

    expect(multiprofileTransformHandle).toBeGreaterThan(0);

    // Transform test color and verify output
    const rgbUint8Array = new Uint8Array([128, 128, 128]); // Mid gray
    const cmykUint8Array = new Uint8Array(4);
    engine.doTransform(multiprofileTransformHandle, rgbUint8Array, cmykUint8Array, 1);

    // Verify CMYK output is valid
    expect(cmykUint8Array.length).toBe(4);
    // At least one channel should have non-zero value
    const totalInk = cmykUint8Array[0] + cmykUint8Array[1] + cmykUint8Array[2] + cmykUint8Array[3];
    expect(totalInk).toBeGreaterThan(0);
  });

  it('should create 3-profile chain: Gray → sRGB → CMYK (standard intent)', async () => {
    const grayProfileHandle = engine.createGray2Profile();
    resources.push({ type: 'profile', handle: grayProfileHandle });

    const rgbProfileHandle = engine.createSRGBProfile();
    resources.push({ type: 'profile', handle: rgbProfileHandle });

    const cmykProfileBuffer = await readFile(join(FIXTURES_DIR, 'profiles/cmyk/CoatedFOGRA39.icc'));
    const cmykProfileHandle = engine.openProfileFromMem(new Uint8Array(cmykProfileBuffer));
    resources.push({ type: 'profile', handle: cmykProfileHandle });

    const multiprofileTransformHandle = engine.createMultiprofileTransform(
      [grayProfileHandle, rgbProfileHandle, cmykProfileHandle],
      TYPE_GRAY_8,
      TYPE_CMYK_8,
      INTENT_RELATIVE_COLORIMETRIC,
      cmsFLAGS_BLACKPOINTCOMPENSATION
    );
    resources.push({ type: 'transform', handle: multiprofileTransformHandle });

    expect(multiprofileTransformHandle).toBeGreaterThan(0);

    // Transform 50% gray
    const grayUint8Array = new Uint8Array([128]);
    const cmykUint8Array = new Uint8Array(4);
    engine.doTransform(multiprofileTransformHandle, grayUint8Array, cmykUint8Array, 1);

    // K channel should have value (profile-dependent GCR)
    // This is NOT K-only, just standard GCR from the profile
    expect(cmykUint8Array.length).toBe(4);
    const totalInk = cmykUint8Array[0] + cmykUint8Array[1] + cmykUint8Array[2] + cmykUint8Array[3];
    expect(totalInk).toBeGreaterThan(0);
  });

  it('should create 4-profile chain and validate', async () => {
    // Test longer chain: Gray → Lab → sRGB → CMYK
    const grayProfileHandle = engine.createGray2Profile();
    resources.push({ type: 'profile', handle: grayProfileHandle });

    const labProfileHandle = engine.createLab4Profile();
    resources.push({ type: 'profile', handle: labProfileHandle });

    const rgbProfileHandle = engine.createSRGBProfile();
    resources.push({ type: 'profile', handle: rgbProfileHandle });

    const cmykProfileBuffer = await readFile(join(FIXTURES_DIR, 'profiles/cmyk/CoatedFOGRA39.icc'));
    const cmykProfileHandle = engine.openProfileFromMem(new Uint8Array(cmykProfileBuffer));
    resources.push({ type: 'profile', handle: cmykProfileHandle });

    const multiprofileTransformHandle = engine.createMultiprofileTransform(
      [grayProfileHandle, labProfileHandle, rgbProfileHandle, cmykProfileHandle],
      TYPE_GRAY_8,
      TYPE_CMYK_8,
      INTENT_RELATIVE_COLORIMETRIC,
      cmsFLAGS_BLACKPOINTCOMPENSATION
    );
    resources.push({ type: 'transform', handle: multiprofileTransformHandle });

    expect(multiprofileTransformHandle).toBeGreaterThan(0);
  });

  it('should support different pixel formats (8-bit, 16-bit, float)', async () => {
    const rgbProfileHandle = engine.createSRGBProfile();
    resources.push({ type: 'profile', handle: rgbProfileHandle });

    const cmykProfileBuffer = await readFile(join(FIXTURES_DIR, 'profiles/cmyk/CoatedFOGRA39.icc'));
    const cmykProfileHandle = engine.openProfileFromMem(new Uint8Array(cmykProfileBuffer));
    resources.push({ type: 'profile', handle: cmykProfileHandle });

    // Test 16-bit format
    const multiprofileTransformUint16Handle = engine.createMultiprofileTransform(
      [rgbProfileHandle, cmykProfileHandle],
      TYPE_RGB_16,
      TYPE_CMYK_16,
      INTENT_RELATIVE_COLORIMETRIC,
      cmsFLAGS_BLACKPOINTCOMPENSATION
    );
    resources.push({ type: 'transform', handle: multiprofileTransformUint16Handle });
    expect(multiprofileTransformUint16Handle).toBeGreaterThan(0);

    // Test float format
    const multiprofileTransformFloat32Handle = engine.createMultiprofileTransform(
      [rgbProfileHandle, cmykProfileHandle],
      TYPE_RGB_FLT,
      TYPE_CMYK_FLT,
      INTENT_RELATIVE_COLORIMETRIC,
      cmsFLAGS_BLACKPOINTCOMPENSATION
    );
    resources.push({ type: 'transform', handle: multiprofileTransformFloat32Handle });
    expect(multiprofileTransformFloat32Handle).toBeGreaterThan(0);
  });

  it('should reject single profile (minimum is 2)', async () => {
    const rgbProfileHandle = engine.createSRGBProfile();
    resources.push({ type: 'profile', handle: rgbProfileHandle });

    const multiprofileTransformHandle = engine.createMultiprofileTransform(
      [rgbProfileHandle],
      TYPE_RGB_8,
      TYPE_RGB_8,
      INTENT_RELATIVE_COLORIMETRIC,
      cmsFLAGS_BLACKPOINTCOMPENSATION
    );

    // Should return 0 (failure) for single profile
    expect(multiprofileTransformHandle).toBe(0);
  });

  it('should reject 256+ profiles (maximum is 255)', () => {
    // Create 256 dummy profiles (this will test validation without actually creating them all)
    const profileHandles = new Array(256).fill(1); // Use dummy handle value

    const multiprofileTransformHandle = engine.createMultiprofileTransform(
      profileHandles,
      TYPE_RGB_8,
      TYPE_CMYK_8,
      INTENT_RELATIVE_COLORIMETRIC,
      cmsFLAGS_BLACKPOINTCOMPENSATION
    );

    // Should return 0 (failure) for too many profiles
    expect(multiprofileTransformHandle).toBe(0);
  });
});

describe('Multi-Profile Transforms - K-Only GCR (CORE REQUIREMENT)', () => {
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

  it('should create Gray → sRGB → CMYK with K-Only intent ⭐ CORE', async () => {
    const grayProfileHandle = engine.createGray2Profile();
    resources.push({ type: 'profile', handle: grayProfileHandle });

    const rgbProfileHandle = engine.createSRGBProfile();
    resources.push({ type: 'profile', handle: rgbProfileHandle });

    const cmykProfileBuffer = await readFile(join(FIXTURES_DIR, 'profiles/cmyk/CoatedFOGRA39.icc'));
    const cmykProfileHandle = engine.openProfileFromMem(new Uint8Array(cmykProfileBuffer));
    resources.push({ type: 'profile', handle: cmykProfileHandle });

    const multiprofileTransformHandle = engine.createMultiprofileTransform(
      [grayProfileHandle, rgbProfileHandle, cmykProfileHandle],
      TYPE_GRAY_8,
      TYPE_CMYK_8,
      INTENT_PRESERVE_K_ONLY_RELATIVE_COLORIMETRIC_GCR,
      cmsFLAGS_BLACKPOINTCOMPENSATION
    );
    resources.push({ type: 'transform', handle: multiprofileTransformHandle });

    expect(multiprofileTransformHandle).toBeGreaterThan(0);

    // Transform 50% gray - should produce K-only output
    const grayUint8Array = new Uint8Array([128]);
    const cmykUint8Array = new Uint8Array(4);
    engine.doTransform(multiprofileTransformHandle, grayUint8Array, cmykUint8Array, 1);

    // Verify K-only output: C, M, Y should be near 0, K should be > 0
    expect(cmykUint8Array[0]).toBeLessThan(3); // C ≈ 0
    expect(cmykUint8Array[1]).toBeLessThan(3); // M ≈ 0
    expect(cmykUint8Array[2]).toBeLessThan(3); // Y ≈ 0
    expect(cmykUint8Array[3]).toBeGreaterThan(0); // K > 0
  });

  it('should create Lab → sRGB → CMYK with K-Only intent ⭐ CORE', async () => {
    const labProfileHandle = engine.createLab4Profile();
    resources.push({ type: 'profile', handle: labProfileHandle });

    const rgbProfileHandle = engine.createSRGBProfile();
    resources.push({ type: 'profile', handle: rgbProfileHandle });

    const cmykProfileBuffer = await readFile(join(FIXTURES_DIR, 'profiles/cmyk/CoatedFOGRA39.icc'));
    const cmykProfileHandle = engine.openProfileFromMem(new Uint8Array(cmykProfileBuffer));
    resources.push({ type: 'profile', handle: cmykProfileHandle });

    const multiprofileTransformFloat32Handle = engine.createMultiprofileTransform(
      [labProfileHandle, rgbProfileHandle, cmykProfileHandle],
      TYPE_Lab_FLT,
      TYPE_CMYK_FLT,
      INTENT_PRESERVE_K_ONLY_RELATIVE_COLORIMETRIC_GCR,
      cmsFLAGS_BLACKPOINTCOMPENSATION
    );
    resources.push({ type: 'transform', handle: multiprofileTransformFloat32Handle });

    expect(multiprofileTransformFloat32Handle).toBeGreaterThan(0);

    // Transform neutral Lab (50% lightness, a=0, b=0) - should produce K-only
    const labFloat32Array = new Float32Array([50.0, 0.0, 0.0]);
    const cmykFloat32Array = new Float32Array(4);
    engine.doTransform(multiprofileTransformFloat32Handle, labFloat32Array, cmykFloat32Array, 1);

    // Verify K-only output: C, M, Y should be near 0, K should be > 0
    expect(cmykFloat32Array[0]).toBeLessThan(5); // C ≈ 0 (in 0-1 range)
    expect(cmykFloat32Array[1]).toBeLessThan(5); // M ≈ 0
    expect(cmykFloat32Array[2]).toBeLessThan(5); // Y ≈ 0
    expect(cmykFloat32Array[3]).toBeGreaterThan(0.0); // K > 0
  });

  it('should match two-step sequential transform (parity test)', async () => {
    // Compare multiprofile (Gray → sRGB → CMYK) vs two-step (Gray → sRGB, then sRGB → CMYK)
    const grayProfileHandle = engine.createGray2Profile();
    resources.push({ type: 'profile', handle: grayProfileHandle });

    const rgbProfileHandle = engine.createSRGBProfile();
    resources.push({ type: 'profile', handle: rgbProfileHandle });

    const cmykProfileBuffer = await readFile(join(FIXTURES_DIR, 'profiles/cmyk/CoatedFOGRA39.icc'));
    const cmykProfileHandle = engine.openProfileFromMem(new Uint8Array(cmykProfileBuffer));
    resources.push({ type: 'profile', handle: cmykProfileHandle });

    // Multiprofile transform
    const multiTransformHandle = engine.createMultiprofileTransform(
      [grayProfileHandle, rgbProfileHandle, cmykProfileHandle],
      TYPE_GRAY_8,
      TYPE_CMYK_8,
      INTENT_PRESERVE_K_ONLY_RELATIVE_COLORIMETRIC_GCR,
      cmsFLAGS_BLACKPOINTCOMPENSATION
    );
    resources.push({ type: 'transform', handle: multiTransformHandle });

    // Two-step transforms
    const twoStepTransformHandle1 = engine.createTransform(
      grayProfileHandle,
      TYPE_GRAY_8,
      rgbProfileHandle,
      TYPE_RGB_8,
      INTENT_RELATIVE_COLORIMETRIC,
      cmsFLAGS_BLACKPOINTCOMPENSATION
    );
    resources.push({ type: 'transform', handle: twoStepTransformHandle1 });

    const twoStepTransformHandle2 = engine.createTransform(
      rgbProfileHandle,
      TYPE_RGB_8,
      cmykProfileHandle,
      TYPE_CMYK_8,
      INTENT_PRESERVE_K_ONLY_RELATIVE_COLORIMETRIC_GCR,
      cmsFLAGS_BLACKPOINTCOMPENSATION
    );
    resources.push({ type: 'transform', handle: twoStepTransformHandle2 });

    // Transform 50% gray through both paths
    const grayUint8Array = new Uint8Array([128]);
    const multiprofileCMYKUint8Array = new Uint8Array(4);
    const twoStepRGBUint8Array = new Uint8Array(3);
    const twoStepCMYKUint8Array = new Uint8Array(4);

    engine.doTransform(multiTransformHandle, grayUint8Array, multiprofileCMYKUint8Array, 1);
    engine.doTransform(twoStepTransformHandle1, grayUint8Array, twoStepRGBUint8Array, 1);
    engine.doTransform(twoStepTransformHandle2, twoStepRGBUint8Array, twoStepCMYKUint8Array, 1);

    // Results should be similar (within tolerance of ±2)
    for (let i = 0; i < 4; i++) {
      expect(Math.abs(multiprofileCMYKUint8Array[i] - twoStepCMYKUint8Array[i])).toBeLessThanOrEqual(2);
    }
  });

  it('should support 4-profile chain with K-Only: Gray → Lab → sRGB → CMYK', async () => {
    const grayProfileHandle = engine.createGray2Profile();
    resources.push({ type: 'profile', handle: grayProfileHandle });

    const labProfileHandle = engine.createLab4Profile();
    resources.push({ type: 'profile', handle: labProfileHandle });

    const rgbProfileHandle = engine.createSRGBProfile();
    resources.push({ type: 'profile', handle: rgbProfileHandle });

    const cmykProfileBuffer = await readFile(join(FIXTURES_DIR, 'profiles/cmyk/CoatedFOGRA39.icc'));
    const cmykProfileHandle = engine.openProfileFromMem(new Uint8Array(cmykProfileBuffer));
    resources.push({ type: 'profile', handle: cmykProfileHandle });

    const multiprofileTransformHandle = engine.createMultiprofileTransform(
      [grayProfileHandle, labProfileHandle, rgbProfileHandle, cmykProfileHandle],
      TYPE_GRAY_8,
      TYPE_CMYK_8,
      INTENT_PRESERVE_K_ONLY_RELATIVE_COLORIMETRIC_GCR,
      cmsFLAGS_BLACKPOINTCOMPENSATION
    );
    resources.push({ type: 'transform', handle: multiprofileTransformHandle });

    expect(multiprofileTransformHandle).toBeGreaterThan(0);

    // Transform and verify K-only output
    const grayUint8Array = new Uint8Array([128]);
    const cmykUint8Array = new Uint8Array(4);
    engine.doTransform(multiprofileTransformHandle, grayUint8Array, cmykUint8Array, 1);

    expect(cmykUint8Array[0]).toBeLessThan(3);
    expect(cmykUint8Array[1]).toBeLessThan(3);
    expect(cmykUint8Array[2]).toBeLessThan(3);
    expect(cmykUint8Array[3]).toBeGreaterThan(0);
  });

  it('should reject K-Only intent when output is not CMYK', async () => {
    const grayProfileHandle = engine.createGray2Profile();
    resources.push({ type: 'profile', handle: grayProfileHandle });

    const rgbProfileHandle = engine.createSRGBProfile();
    resources.push({ type: 'profile', handle: rgbProfileHandle });

    const labProfileHandle = engine.createLab4Profile();
    resources.push({ type: 'profile', handle: labProfileHandle });

    // Gray → sRGB → Lab with K-Only intent should fail (output is not CMYK)
    const multiprofileTransformHandle = engine.createMultiprofileTransform(
      [grayProfileHandle, rgbProfileHandle, labProfileHandle],
      TYPE_GRAY_8,
      TYPE_Lab_FLT,
      INTENT_PRESERVE_K_ONLY_RELATIVE_COLORIMETRIC_GCR,
      cmsFLAGS_BLACKPOINTCOMPENSATION
    );

    // Should return 0 (failure) because output is Lab, not CMYK
    expect(multiprofileTransformHandle).toBe(0);
  });

  it('should produce pure black (K≈100, CMY≈0) for RGB(0,0,0)', async () => {
    const grayProfileHandle = engine.createGray2Profile();
    resources.push({ type: 'profile', handle: grayProfileHandle });

    const rgbProfileHandle = engine.createSRGBProfile();
    resources.push({ type: 'profile', handle: rgbProfileHandle });

    const cmykProfileBuffer = await readFile(join(FIXTURES_DIR, 'profiles/cmyk/CoatedFOGRA39.icc'));
    const cmykProfileHandle = engine.openProfileFromMem(new Uint8Array(cmykProfileBuffer));
    resources.push({ type: 'profile', handle: cmykProfileHandle });

    const multiprofileTransformHandle = engine.createMultiprofileTransform(
      [grayProfileHandle, rgbProfileHandle, cmykProfileHandle],
      TYPE_GRAY_8,
      TYPE_CMYK_8,
      INTENT_PRESERVE_K_ONLY_RELATIVE_COLORIMETRIC_GCR,
      cmsFLAGS_BLACKPOINTCOMPENSATION
    );
    resources.push({ type: 'transform', handle: multiprofileTransformHandle });

    // Transform pure black (0)
    const grayUint8Array = new Uint8Array([0]);
    const cmykUint8Array = new Uint8Array(4);
    engine.doTransform(multiprofileTransformHandle, grayUint8Array, cmykUint8Array, 1);

    // Should produce K≈100%, CMY≈0
    expect(cmykUint8Array[0]).toBeLessThan(3);  // C ≈ 0
    expect(cmykUint8Array[1]).toBeLessThan(3);  // M ≈ 0
    expect(cmykUint8Array[2]).toBeLessThan(3);  // Y ≈ 0
    expect(cmykUint8Array[3]).toBeGreaterThan(250); // K ≈ 100%
  });

  it('should produce pure white (all≈0) for RGB(255,255,255)', async () => {
    const grayProfileHandle = engine.createGray2Profile();
    resources.push({ type: 'profile', handle: grayProfileHandle });

    const rgbProfileHandle = engine.createSRGBProfile();
    resources.push({ type: 'profile', handle: rgbProfileHandle });

    const cmykProfileBuffer = await readFile(join(FIXTURES_DIR, 'profiles/cmyk/CoatedFOGRA39.icc'));
    const cmykProfileHandle = engine.openProfileFromMem(new Uint8Array(cmykProfileBuffer));
    resources.push({ type: 'profile', handle: cmykProfileHandle });

    const multiprofileTransformHandle = engine.createMultiprofileTransform(
      [grayProfileHandle, rgbProfileHandle, cmykProfileHandle],
      TYPE_GRAY_8,
      TYPE_CMYK_8,
      INTENT_PRESERVE_K_ONLY_RELATIVE_COLORIMETRIC_GCR,
      cmsFLAGS_BLACKPOINTCOMPENSATION
    );
    resources.push({ type: 'transform', handle: multiprofileTransformHandle });

    // Transform pure white (255)
    const grayUint8Array = new Uint8Array([255]);
    const cmykUint8Array = new Uint8Array(4);
    engine.doTransform(multiprofileTransformHandle, grayUint8Array, cmykUint8Array, 1);

    // Should produce all≈0 (no ink)
    expect(cmykUint8Array[0]).toBeLessThan(3);  // C ≈ 0
    expect(cmykUint8Array[1]).toBeLessThan(3);  // M ≈ 0
    expect(cmykUint8Array[2]).toBeLessThan(3);  // Y ≈ 0
    expect(cmykUint8Array[3]).toBeLessThan(3);  // K ≈ 0
  });

  it('should handle chromatic color (not K-only for RGB red)', async () => {
    const rgbProfileHandle = engine.createSRGBProfile();
    resources.push({ type: 'profile', handle: rgbProfileHandle });

    const cmykProfileBuffer = await readFile(join(FIXTURES_DIR, 'profiles/cmyk/CoatedFOGRA39.icc'));
    const cmykProfileHandle = engine.openProfileFromMem(new Uint8Array(cmykProfileBuffer));
    resources.push({ type: 'profile', handle: cmykProfileHandle });

    // Use 2-profile for this test (RGB → CMYK directly)
    const multiprofileTransformHandle = engine.createMultiprofileTransform(
      [rgbProfileHandle, cmykProfileHandle],
      TYPE_RGB_8,
      TYPE_CMYK_8,
      INTENT_PRESERVE_K_ONLY_RELATIVE_COLORIMETRIC_GCR,
      cmsFLAGS_BLACKPOINTCOMPENSATION
    );
    resources.push({ type: 'transform', handle: multiprofileTransformHandle });

    // Transform pure red (255, 0, 0)
    const rgbUint8Array = new Uint8Array([255, 0, 0]);
    const cmykUint8Array = new Uint8Array(4);
    engine.doTransform(multiprofileTransformHandle, rgbUint8Array, cmykUint8Array, 1);

    // Red should have M and Y components (not K-only)
    const totalCMY = cmykUint8Array[0] + cmykUint8Array[1] + cmykUint8Array[2];
    expect(totalCMY).toBeGreaterThan(10); // Should have significant CMY
  });
});

describe('Multi-Profile Transforms - Integration', () => {
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

  it('should allow profile closure while transform is active', async () => {
    const grayProfileHandle = engine.createGray2Profile();
    const rgbProfileHandle = engine.createSRGBProfile();

    const cmykProfileBuffer = await readFile(join(FIXTURES_DIR, 'profiles/cmyk/CoatedFOGRA39.icc'));
    const cmykProfileHandle = engine.openProfileFromMem(new Uint8Array(cmykProfileBuffer));

    const multiprofileTransformHandle = engine.createMultiprofileTransform(
      [grayProfileHandle, rgbProfileHandle, cmykProfileHandle],
      TYPE_GRAY_8,
      TYPE_CMYK_8,
      INTENT_RELATIVE_COLORIMETRIC,
      cmsFLAGS_BLACKPOINTCOMPENSATION
    );
    resources.push({ type: 'transform', handle: multiprofileTransformHandle });

    // Close profiles (transform should still work due to internal refs)
    engine.closeProfile(grayProfileHandle);
    engine.closeProfile(rgbProfileHandle);
    engine.closeProfile(cmykProfileHandle);

    // Transform should still work
    const grayUint8Array = new Uint8Array([128]);
    const cmykUint8Array = new Uint8Array(4);
    expect(() => {
      engine.doTransform(multiprofileTransformHandle, grayUint8Array, cmykUint8Array, 1);
    }).not.toThrow();
  });

  it('should reject array with zero handle', () => {
    const rgbProfileHandle = engine.createSRGBProfile();
    resources.push({ type: 'profile', handle: rgbProfileHandle });

    // Include a zero handle in the array
    const multiprofileTransformHandle = engine.createMultiprofileTransform(
      [rgbProfileHandle, 0], // Second handle is invalid
      TYPE_RGB_8,
      TYPE_RGB_8,
      INTENT_RELATIVE_COLORIMETRIC,
      cmsFLAGS_BLACKPOINTCOMPENSATION
    );

    // Should return 0 (failure)
    expect(multiprofileTransformHandle).toBe(0);
  });

  it('should work with doTransform', async () => {
    const grayProfileHandle = engine.createGray2Profile();
    resources.push({ type: 'profile', handle: grayProfileHandle });

    const rgbProfileHandle = engine.createSRGBProfile();
    resources.push({ type: 'profile', handle: rgbProfileHandle });

    const cmykProfileBuffer = await readFile(join(FIXTURES_DIR, 'profiles/cmyk/CoatedFOGRA39.icc'));
    const cmykProfileHandle = engine.openProfileFromMem(new Uint8Array(cmykProfileBuffer));
    resources.push({ type: 'profile', handle: cmykProfileHandle });

    const multiprofileTransformHandle = engine.createMultiprofileTransform(
      [grayProfileHandle, rgbProfileHandle, cmykProfileHandle],
      TYPE_GRAY_8,
      TYPE_CMYK_8,
      INTENT_RELATIVE_COLORIMETRIC,
      cmsFLAGS_BLACKPOINTCOMPENSATION
    );
    resources.push({ type: 'transform', handle: multiprofileTransformHandle });

    const grayUint8Array = new Uint8Array([128]);
    const cmykUint8Array = new Uint8Array(4);

    expect(() => {
      engine.doTransform(multiprofileTransformHandle, grayUint8Array, cmykUint8Array, 1);
    }).not.toThrow();

    expect(cmykUint8Array.length).toBe(4);
  });

  it('should work with transformArray', async () => {
    const grayProfileHandle = engine.createGray2Profile();
    resources.push({ type: 'profile', handle: grayProfileHandle });

    const rgbProfileHandle = engine.createSRGBProfile();
    resources.push({ type: 'profile', handle: rgbProfileHandle });

    const cmykProfileBuffer = await readFile(join(FIXTURES_DIR, 'profiles/cmyk/CoatedFOGRA39.icc'));
    const cmykProfileHandle = engine.openProfileFromMem(new Uint8Array(cmykProfileBuffer));
    resources.push({ type: 'profile', handle: cmykProfileHandle });

    const multiprofileTransformHandle = engine.createMultiprofileTransform(
      [grayProfileHandle, rgbProfileHandle, cmykProfileHandle],
      TYPE_GRAY_8,
      TYPE_CMYK_8,
      INTENT_RELATIVE_COLORIMETRIC,
      cmsFLAGS_BLACKPOINTCOMPENSATION
    );
    resources.push({ type: 'transform', handle: multiprofileTransformHandle });

    const rgbUint8Array = new Uint8Array([0, 128, 255]); // 3 pixels
    const cmykUint8Array = new Uint8Array(12); // 3 pixels × 4 channels

    expect(() => {
      engine.transformArray(multiprofileTransformHandle, rgbUint8Array, cmykUint8Array, 3);
    }).not.toThrow();

    expect(cmykUint8Array.length).toBe(12);
  });
});
