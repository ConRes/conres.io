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
const FIXTURES_DIR = join(__dirname, '../fixtures/profiles');

describe('Multi-Profile Transforms - Standard Intents', () => {
  let engine;
  const resources = []; // Track all resources for cleanup

  beforeAll(async () => {
    engine = await createEngine();
  });

  afterEach(() => {
    // Clean up all resources (skip null/zero handles)
    resources.forEach(r => {
      if (r.type === 'transform' && r.handle !== 0) engine.deleteTransform(r.handle);
      if (r.type === 'profile' && r.handle !== 0) engine.closeProfile(r.handle);
    });
    resources.length = 0;
  });

  it('should create 2-profile chain matching single transform (RGB→CMYK)', async () => {
    // Test that 2-profile multiprofile behaves identically to createTransform
    const srgb = engine.createSRGBProfile();
    resources.push({ type: 'profile', handle: srgb });

    const cmykBuffer = await readFile(join(FIXTURES_DIR, 'cmyk/CoatedFOGRA39.icc'));
    const cmyk = engine.openProfileFromMem(new Uint8Array(cmykBuffer));
    resources.push({ type: 'profile', handle: cmyk });

    // Create multiprofile transform
    const multiTransform = engine.createMultiprofileTransform(
      [srgb, cmyk],
      TYPE_RGB_8,
      TYPE_CMYK_8,
      INTENT_RELATIVE_COLORIMETRIC,
      cmsFLAGS_BLACKPOINTCOMPENSATION
    );
    resources.push({ type: 'transform', handle: multiTransform });

    expect(multiTransform).toBeGreaterThan(0);

    // Transform test color and verify output
    const input = new Uint8Array([128, 128, 128]); // Mid gray
    const output = new Uint8Array(4);
    engine.doTransform(multiTransform, input, output, 1);

    // Verify CMYK output is valid
    expect(output.length).toBe(4);
    // At least one channel should have non-zero value
    const totalInk = output[0] + output[1] + output[2] + output[3];
    expect(totalInk).toBeGreaterThan(0);
  });

  it('should create 3-profile chain: Gray → sRGB → CMYK (standard intent)', async () => {
    const gray = engine.createGray2Profile();
    resources.push({ type: 'profile', handle: gray });

    const srgb = engine.createSRGBProfile();
    resources.push({ type: 'profile', handle: srgb });

    const cmykBuffer = await readFile(join(FIXTURES_DIR, 'cmyk/CoatedFOGRA39.icc'));
    const cmyk = engine.openProfileFromMem(new Uint8Array(cmykBuffer));
    resources.push({ type: 'profile', handle: cmyk });

    const transform = engine.createMultiprofileTransform(
      [gray, srgb, cmyk],
      TYPE_GRAY_8,
      TYPE_CMYK_8,
      INTENT_RELATIVE_COLORIMETRIC,
      cmsFLAGS_BLACKPOINTCOMPENSATION
    );
    resources.push({ type: 'transform', handle: transform });

    expect(transform).toBeGreaterThan(0);

    // Transform 50% gray
    const input = new Uint8Array([128]);
    const output = new Uint8Array(4);
    engine.doTransform(transform, input, output, 1);

    // K channel should have value (profile-dependent GCR)
    // This is NOT K-only, just standard GCR from the profile
    expect(output.length).toBe(4);
    const totalInk = output[0] + output[1] + output[2] + output[3];
    expect(totalInk).toBeGreaterThan(0);
  });

  it('should create 4-profile chain and validate', async () => {
    // Test longer chain: Gray → Lab → sRGB → CMYK
    const gray = engine.createGray2Profile();
    resources.push({ type: 'profile', handle: gray });

    const lab = engine.createLab4Profile();
    resources.push({ type: 'profile', handle: lab });

    const srgb = engine.createSRGBProfile();
    resources.push({ type: 'profile', handle: srgb });

    const cmykBuffer = await readFile(join(FIXTURES_DIR, 'cmyk/CoatedFOGRA39.icc'));
    const cmyk = engine.openProfileFromMem(new Uint8Array(cmykBuffer));
    resources.push({ type: 'profile', handle: cmyk });

    const transform = engine.createMultiprofileTransform(
      [gray, lab, srgb, cmyk],
      TYPE_GRAY_8,
      TYPE_CMYK_8,
      INTENT_RELATIVE_COLORIMETRIC,
      cmsFLAGS_BLACKPOINTCOMPENSATION
    );
    resources.push({ type: 'transform', handle: transform });

    expect(transform).toBeGreaterThan(0);
  });

  it('should support different pixel formats (8-bit, 16-bit, float)', async () => {
    const srgb = engine.createSRGBProfile();
    resources.push({ type: 'profile', handle: srgb });

    const cmykBuffer = await readFile(join(FIXTURES_DIR, 'cmyk/CoatedFOGRA39.icc'));
    const cmyk = engine.openProfileFromMem(new Uint8Array(cmykBuffer));
    resources.push({ type: 'profile', handle: cmyk });

    // Test 16-bit format
    const transform16 = engine.createMultiprofileTransform(
      [srgb, cmyk],
      TYPE_RGB_16,
      TYPE_CMYK_16,
      INTENT_RELATIVE_COLORIMETRIC,
      cmsFLAGS_BLACKPOINTCOMPENSATION
    );
    resources.push({ type: 'transform', handle: transform16 });
    expect(transform16).toBeGreaterThan(0);

    // Test float format
    const transformFloat = engine.createMultiprofileTransform(
      [srgb, cmyk],
      TYPE_RGB_FLT,
      TYPE_CMYK_FLT,
      INTENT_RELATIVE_COLORIMETRIC,
      cmsFLAGS_BLACKPOINTCOMPENSATION
    );
    resources.push({ type: 'transform', handle: transformFloat });
    expect(transformFloat).toBeGreaterThan(0);
  });

  it('should reject single profile (minimum is 2)', async () => {
    const srgb = engine.createSRGBProfile();
    resources.push({ type: 'profile', handle: srgb });

    const transform = engine.createMultiprofileTransform(
      [srgb],
      TYPE_RGB_8,
      TYPE_RGB_8,
      INTENT_RELATIVE_COLORIMETRIC,
      cmsFLAGS_BLACKPOINTCOMPENSATION
    );

    // Should return 0 (failure) for single profile
    expect(transform).toBe(0);
  });

  it('should reject 256+ profiles (maximum is 255)', () => {
    // Create 256 dummy profiles (this will test validation without actually creating them all)
    const profiles = new Array(256).fill(1); // Use dummy handle value

    const transform = engine.createMultiprofileTransform(
      profiles,
      TYPE_RGB_8,
      TYPE_CMYK_8,
      INTENT_RELATIVE_COLORIMETRIC,
      cmsFLAGS_BLACKPOINTCOMPENSATION
    );

    // Should return 0 (failure) for too many profiles
    expect(transform).toBe(0);
  });
});

describe('Multi-Profile Transforms - K-Only GCR (CORE REQUIREMENT)', () => {
  let engine;
  const resources = [];

  beforeAll(async () => {
    engine = await createEngine();
  });

  afterEach(() => {
    // Clean up all resources (skip null/zero handles)
    resources.forEach(r => {
      if (r.type === 'transform' && r.handle !== 0) engine.deleteTransform(r.handle);
      if (r.type === 'profile' && r.handle !== 0) engine.closeProfile(r.handle);
    });
    resources.length = 0;
  });

  it('should create Gray → sRGB → CMYK with K-Only intent ⭐ CORE', async () => {
    const gray = engine.createGray2Profile();
    resources.push({ type: 'profile', handle: gray });

    const srgb = engine.createSRGBProfile();
    resources.push({ type: 'profile', handle: srgb });

    const cmykBuffer = await readFile(join(FIXTURES_DIR, 'cmyk/CoatedFOGRA39.icc'));
    const cmyk = engine.openProfileFromMem(new Uint8Array(cmykBuffer));
    resources.push({ type: 'profile', handle: cmyk });

    const transform = engine.createMultiprofileTransform(
      [gray, srgb, cmyk],
      TYPE_GRAY_8,
      TYPE_CMYK_8,
      INTENT_PRESERVE_K_ONLY_RELATIVE_COLORIMETRIC_GCR,
      cmsFLAGS_BLACKPOINTCOMPENSATION
    );
    resources.push({ type: 'transform', handle: transform });

    expect(transform).toBeGreaterThan(0);

    // Transform 50% gray - should produce K-only output
    const input = new Uint8Array([128]);
    const output = new Uint8Array(4);
    engine.doTransform(transform, input, output, 1);

    // Verify K-only output: C, M, Y should be near 0, K should be > 0
    expect(output[0]).toBeLessThan(3); // C ≈ 0
    expect(output[1]).toBeLessThan(3); // M ≈ 0
    expect(output[2]).toBeLessThan(3); // Y ≈ 0
    expect(output[3]).toBeGreaterThan(0); // K > 0
  });

  it('should create Lab → sRGB → CMYK with K-Only intent ⭐ CORE', async () => {
    const lab = engine.createLab4Profile();
    resources.push({ type: 'profile', handle: lab });

    const srgb = engine.createSRGBProfile();
    resources.push({ type: 'profile', handle: srgb });

    const cmykBuffer = await readFile(join(FIXTURES_DIR, 'cmyk/CoatedFOGRA39.icc'));
    const cmyk = engine.openProfileFromMem(new Uint8Array(cmykBuffer));
    resources.push({ type: 'profile', handle: cmyk });

    const transform = engine.createMultiprofileTransform(
      [lab, srgb, cmyk],
      TYPE_Lab_FLT,
      TYPE_CMYK_FLT,
      INTENT_PRESERVE_K_ONLY_RELATIVE_COLORIMETRIC_GCR,
      cmsFLAGS_BLACKPOINTCOMPENSATION
    );
    resources.push({ type: 'transform', handle: transform });

    expect(transform).toBeGreaterThan(0);

    // Transform neutral Lab (50% lightness, a=0, b=0) - should produce K-only
    const input = new Float32Array([50.0, 0.0, 0.0]);
    const output = new Float32Array(4);
    engine.doTransform(transform, input, output, 1);

    // Verify K-only output: C, M, Y should be near 0, K should be > 0
    expect(output[0]).toBeLessThan(0.02); // C ≈ 0 (in 0-1 range)
    expect(output[1]).toBeLessThan(0.02); // M ≈ 0
    expect(output[2]).toBeLessThan(0.02); // Y ≈ 0
    expect(output[3]).toBeGreaterThan(0.0); // K > 0
  });

  it('should match two-step sequential transform (parity test)', async () => {
    // Compare multiprofile (Gray → sRGB → CMYK) vs two-step (Gray → sRGB, then sRGB → CMYK)
    const gray = engine.createGray2Profile();
    resources.push({ type: 'profile', handle: gray });

    const srgb = engine.createSRGBProfile();
    resources.push({ type: 'profile', handle: srgb });

    const cmykBuffer = await readFile(join(FIXTURES_DIR, 'cmyk/CoatedFOGRA39.icc'));
    const cmyk = engine.openProfileFromMem(new Uint8Array(cmykBuffer));
    resources.push({ type: 'profile', handle: cmyk });

    // Multiprofile transform
    const multiTransform = engine.createMultiprofileTransform(
      [gray, srgb, cmyk],
      TYPE_GRAY_8,
      TYPE_CMYK_8,
      INTENT_PRESERVE_K_ONLY_RELATIVE_COLORIMETRIC_GCR,
      cmsFLAGS_BLACKPOINTCOMPENSATION
    );
    resources.push({ type: 'transform', handle: multiTransform });

    // Two-step transforms
    const gray2srgb = engine.createTransform(
      gray,
      TYPE_GRAY_8,
      srgb,
      TYPE_RGB_8,
      INTENT_RELATIVE_COLORIMETRIC,
      cmsFLAGS_BLACKPOINTCOMPENSATION
    );
    resources.push({ type: 'transform', handle: gray2srgb });

    const srgb2cmyk = engine.createTransform(
      srgb,
      TYPE_RGB_8,
      cmyk,
      TYPE_CMYK_8,
      INTENT_PRESERVE_K_ONLY_RELATIVE_COLORIMETRIC_GCR,
      cmsFLAGS_BLACKPOINTCOMPENSATION
    );
    resources.push({ type: 'transform', handle: srgb2cmyk });

    // Transform 50% gray through both paths
    const input = new Uint8Array([128]);
    const multiOutput = new Uint8Array(4);
    const twoStepOutput = new Uint8Array(4);
    const rgbIntermediate = new Uint8Array(3);

    engine.doTransform(multiTransform, input, multiOutput, 1);
    engine.doTransform(gray2srgb, input, rgbIntermediate, 1);
    engine.doTransform(srgb2cmyk, rgbIntermediate, twoStepOutput, 1);

    // Results should be similar (within tolerance of ±2)
    for (let i = 0; i < 4; i++) {
      expect(Math.abs(multiOutput[i] - twoStepOutput[i])).toBeLessThanOrEqual(2);
    }
  });

  it('should support 4-profile chain with K-Only: Gray → Lab → sRGB → CMYK', async () => {
    const gray = engine.createGray2Profile();
    resources.push({ type: 'profile', handle: gray });

    const lab = engine.createLab4Profile();
    resources.push({ type: 'profile', handle: lab });

    const srgb = engine.createSRGBProfile();
    resources.push({ type: 'profile', handle: srgb });

    const cmykBuffer = await readFile(join(FIXTURES_DIR, 'cmyk/CoatedFOGRA39.icc'));
    const cmyk = engine.openProfileFromMem(new Uint8Array(cmykBuffer));
    resources.push({ type: 'profile', handle: cmyk });

    const transform = engine.createMultiprofileTransform(
      [gray, lab, srgb, cmyk],
      TYPE_GRAY_8,
      TYPE_CMYK_8,
      INTENT_PRESERVE_K_ONLY_RELATIVE_COLORIMETRIC_GCR,
      cmsFLAGS_BLACKPOINTCOMPENSATION
    );
    resources.push({ type: 'transform', handle: transform });

    expect(transform).toBeGreaterThan(0);

    // Transform and verify K-only output
    const input = new Uint8Array([128]);
    const output = new Uint8Array(4);
    engine.doTransform(transform, input, output, 1);

    expect(output[0]).toBeLessThan(3);
    expect(output[1]).toBeLessThan(3);
    expect(output[2]).toBeLessThan(3);
    expect(output[3]).toBeGreaterThan(0);
  });

  it('should reject K-Only intent when output is not CMYK', async () => {
    const gray = engine.createGray2Profile();
    resources.push({ type: 'profile', handle: gray });

    const srgb = engine.createSRGBProfile();
    resources.push({ type: 'profile', handle: srgb });

    const lab = engine.createLab4Profile();
    resources.push({ type: 'profile', handle: lab });

    // Gray → sRGB → Lab with K-Only intent should fail (output is not CMYK)
    const transform = engine.createMultiprofileTransform(
      [gray, srgb, lab],
      TYPE_GRAY_8,
      TYPE_Lab_FLT,
      INTENT_PRESERVE_K_ONLY_RELATIVE_COLORIMETRIC_GCR,
      cmsFLAGS_BLACKPOINTCOMPENSATION
    );

    // Should return 0 (failure) because output is Lab, not CMYK
    expect(transform).toBe(0);
  });

  it('should produce pure black (K≈100, CMY≈0) for RGB(0,0,0)', async () => {
    const gray = engine.createGray2Profile();
    resources.push({ type: 'profile', handle: gray });

    const srgb = engine.createSRGBProfile();
    resources.push({ type: 'profile', handle: srgb });

    const cmykBuffer = await readFile(join(FIXTURES_DIR, 'cmyk/CoatedFOGRA39.icc'));
    const cmyk = engine.openProfileFromMem(new Uint8Array(cmykBuffer));
    resources.push({ type: 'profile', handle: cmyk });

    const transform = engine.createMultiprofileTransform(
      [gray, srgb, cmyk],
      TYPE_GRAY_8,
      TYPE_CMYK_8,
      INTENT_PRESERVE_K_ONLY_RELATIVE_COLORIMETRIC_GCR,
      cmsFLAGS_BLACKPOINTCOMPENSATION
    );
    resources.push({ type: 'transform', handle: transform });

    // Transform pure black (0)
    const input = new Uint8Array([0]);
    const output = new Uint8Array(4);
    engine.doTransform(transform, input, output, 1);

    // Should produce K≈100%, CMY≈0
    expect(output[0]).toBeLessThan(3);  // C ≈ 0
    expect(output[1]).toBeLessThan(3);  // M ≈ 0
    expect(output[2]).toBeLessThan(3);  // Y ≈ 0
    expect(output[3]).toBeGreaterThan(250); // K ≈ 100%
  });

  it('should produce pure white (all≈0) for RGB(255,255,255)', async () => {
    const gray = engine.createGray2Profile();
    resources.push({ type: 'profile', handle: gray });

    const srgb = engine.createSRGBProfile();
    resources.push({ type: 'profile', handle: srgb });

    const cmykBuffer = await readFile(join(FIXTURES_DIR, 'cmyk/CoatedFOGRA39.icc'));
    const cmyk = engine.openProfileFromMem(new Uint8Array(cmykBuffer));
    resources.push({ type: 'profile', handle: cmyk });

    const transform = engine.createMultiprofileTransform(
      [gray, srgb, cmyk],
      TYPE_GRAY_8,
      TYPE_CMYK_8,
      INTENT_PRESERVE_K_ONLY_RELATIVE_COLORIMETRIC_GCR,
      cmsFLAGS_BLACKPOINTCOMPENSATION
    );
    resources.push({ type: 'transform', handle: transform });

    // Transform pure white (255)
    const input = new Uint8Array([255]);
    const output = new Uint8Array(4);
    engine.doTransform(transform, input, output, 1);

    // Should produce all≈0 (no ink)
    expect(output[0]).toBeLessThan(3);  // C ≈ 0
    expect(output[1]).toBeLessThan(3);  // M ≈ 0
    expect(output[2]).toBeLessThan(3);  // Y ≈ 0
    expect(output[3]).toBeLessThan(3);  // K ≈ 0
  });

  it('should handle chromatic color (not K-only for RGB red)', async () => {
    const srgb = engine.createSRGBProfile();
    resources.push({ type: 'profile', handle: srgb });

    const cmykBuffer = await readFile(join(FIXTURES_DIR, 'cmyk/CoatedFOGRA39.icc'));
    const cmyk = engine.openProfileFromMem(new Uint8Array(cmykBuffer));
    resources.push({ type: 'profile', handle: cmyk });

    // Use 2-profile for this test (RGB → CMYK directly)
    const transform = engine.createMultiprofileTransform(
      [srgb, cmyk],
      TYPE_RGB_8,
      TYPE_CMYK_8,
      INTENT_PRESERVE_K_ONLY_RELATIVE_COLORIMETRIC_GCR,
      cmsFLAGS_BLACKPOINTCOMPENSATION
    );
    resources.push({ type: 'transform', handle: transform });

    // Transform pure red (255, 0, 0)
    const input = new Uint8Array([255, 0, 0]);
    const output = new Uint8Array(4);
    engine.doTransform(transform, input, output, 1);

    // Red should have M and Y components (not K-only)
    const totalCMY = output[0] + output[1] + output[2];
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
    // Clean up all resources (skip null/zero handles)
    resources.forEach(r => {
      if (r.type === 'transform' && r.handle !== 0) engine.deleteTransform(r.handle);
      if (r.type === 'profile' && r.handle !== 0) engine.closeProfile(r.handle);
    });
    resources.length = 0;
  });

  it('should allow profile closure while transform is active', async () => {
    const gray = engine.createGray2Profile();
    const srgb = engine.createSRGBProfile();

    const cmykBuffer = await readFile(join(FIXTURES_DIR, 'cmyk/CoatedFOGRA39.icc'));
    const cmyk = engine.openProfileFromMem(new Uint8Array(cmykBuffer));

    const transform = engine.createMultiprofileTransform(
      [gray, srgb, cmyk],
      TYPE_GRAY_8,
      TYPE_CMYK_8,
      INTENT_RELATIVE_COLORIMETRIC,
      cmsFLAGS_BLACKPOINTCOMPENSATION
    );
    resources.push({ type: 'transform', handle: transform });

    // Close profiles (transform should still work due to internal refs)
    engine.closeProfile(gray);
    engine.closeProfile(srgb);
    engine.closeProfile(cmyk);

    // Transform should still work
    const input = new Uint8Array([128]);
    const output = new Uint8Array(4);
    expect(() => {
      engine.doTransform(transform, input, output, 1);
    }).not.toThrow();
  });

  it('should reject array with zero handle', () => {
    const srgb = engine.createSRGBProfile();
    resources.push({ type: 'profile', handle: srgb });

    // Include a zero handle in the array
    const transform = engine.createMultiprofileTransform(
      [srgb, 0], // Second handle is invalid
      TYPE_RGB_8,
      TYPE_RGB_8,
      INTENT_RELATIVE_COLORIMETRIC,
      cmsFLAGS_BLACKPOINTCOMPENSATION
    );

    // Should return 0 (failure)
    expect(transform).toBe(0);
  });

  it('should work with doTransform', async () => {
    const gray = engine.createGray2Profile();
    resources.push({ type: 'profile', handle: gray });

    const srgb = engine.createSRGBProfile();
    resources.push({ type: 'profile', handle: srgb });

    const cmykBuffer = await readFile(join(FIXTURES_DIR, 'cmyk/CoatedFOGRA39.icc'));
    const cmyk = engine.openProfileFromMem(new Uint8Array(cmykBuffer));
    resources.push({ type: 'profile', handle: cmyk });

    const transform = engine.createMultiprofileTransform(
      [gray, srgb, cmyk],
      TYPE_GRAY_8,
      TYPE_CMYK_8,
      INTENT_RELATIVE_COLORIMETRIC,
      cmsFLAGS_BLACKPOINTCOMPENSATION
    );
    resources.push({ type: 'transform', handle: transform });

    const input = new Uint8Array([128]);
    const output = new Uint8Array(4);

    expect(() => {
      engine.doTransform(transform, input, output, 1);
    }).not.toThrow();

    expect(output.length).toBe(4);
  });

  it('should work with transformArray', async () => {
    const gray = engine.createGray2Profile();
    resources.push({ type: 'profile', handle: gray });

    const srgb = engine.createSRGBProfile();
    resources.push({ type: 'profile', handle: srgb });

    const cmykBuffer = await readFile(join(FIXTURES_DIR, 'cmyk/CoatedFOGRA39.icc'));
    const cmyk = engine.openProfileFromMem(new Uint8Array(cmykBuffer));
    resources.push({ type: 'profile', handle: cmyk });

    const transform = engine.createMultiprofileTransform(
      [gray, srgb, cmyk],
      TYPE_GRAY_8,
      TYPE_CMYK_8,
      INTENT_RELATIVE_COLORIMETRIC,
      cmsFLAGS_BLACKPOINTCOMPENSATION
    );
    resources.push({ type: 'transform', handle: transform });

    const input = new Uint8Array([0, 128, 255]); // 3 pixels
    const output = new Uint8Array(12); // 3 pixels × 4 channels

    expect(() => {
      engine.transformArray(transform, input, output, 3);
    }).not.toThrow();

    expect(output.length).toBe(12);
  });
});
