#!/usr/bin/env node
// @ts-check
/**
 * Lab ↔ sRGB roundtrip test for black, white, and 50% gray (8-bit).
 *
 * @module test-lab-srgb-roundtrip
 */

import { fileURLToPath } from 'url';
import { readFile } from 'fs/promises';

import {
    createEngine,
    TYPE_RGB_8,
    TYPE_Lab_8,
    INTENT_RELATIVE_COLORIMETRIC,
    cmsFLAGS_BLACKPOINTCOMPENSATION,
    cmsFLAGS_NOOPTIMIZE,
    cmsFLAGS_NOCACHE
} from '../../packages/color-engine-2025-12-15/src/index.js';

const engine = await createEngine();
const labProfile = engine.createLab4Profile();
const sRGBProfileBuffer = await readFile(fileURLToPath(new URL('../../resources/profiles/sRGB IEC61966-2.1.icc', import.meta.url)));
const sRGBProfile = engine.openProfileFromMem(sRGBProfileBuffer);

// Lab → sRGB
const labTosRGB = engine.createTransform(
    labProfile, TYPE_Lab_8,
    sRGBProfile, TYPE_RGB_8,
    INTENT_RELATIVE_COLORIMETRIC,
    cmsFLAGS_BLACKPOINTCOMPENSATION
);

// sRGB → Lab
const sRGBToLab = engine.createTransform(
    sRGBProfile, TYPE_RGB_8,
    labProfile, TYPE_Lab_8,
    INTENT_RELATIVE_COLORIMETRIC,
    cmsFLAGS_BLACKPOINTCOMPENSATION
);

// ── Test colors ─────────────────────────────────────────────────────────────
// Lab 8-bit encoding: L* 0–100 → 0–255 (L/100*255), a* -128..+127 → 0–255 (+128), b* same
const testColors = [
    { name: 'Black', lab: [0, 128, 128], rgb: [0, 0, 0] },
    { name: 'White', lab: [255, 128, 128], rgb: [255, 255, 255] },
    { name: '50% Gray', lab: [128, 128, 128], rgb: [119, 119, 119] }, // L*≈50.2 → sRGB ~119
];

// ── Lab → sRGB ──────────────────────────────────────────────────────────────
const labTosRGBRows = testColors.map(({ name, lab }) => {
    const input = new Uint8Array(lab);
    const output = new Uint8Array(3);
    engine.transformArray(labTosRGB, input, output, 1);
    return {
        Color: name,
        'Lab In': `[${[...input]}]`,
        'sRGB Out': `[${[...output]}]`,
    };
});

console.log('\n── Lab → sRGB (8-bit) ──');
console.table(labTosRGBRows);

// ── sRGB → Lab ──────────────────────────────────────────────────────────────
const sRGBToLabRows = testColors.map(({ name, rgb }) => {
    const input = new Uint8Array(rgb);
    const output = new Uint8Array(3);
    engine.transformArray(sRGBToLab, input, output, 1);
    return {
        Color: name,
        'sRGB In': `[${[...input]}]`,
        'Lab Out': `[${[...output]}]`,
    };
});

console.log('\n── sRGB → Lab (8-bit) ──');
console.table(sRGBToLabRows);

// ── Roundtrip: Lab → sRGB → Lab ─────────────────────────────────────────────
const roundtripRows = testColors.map(({ name, lab }) => {
    const labIn = new Uint8Array(lab);
    const rgbMid = new Uint8Array(3);
    const labOut = new Uint8Array(3);
    engine.transformArray(labTosRGB, labIn, rgbMid, 1);
    engine.transformArray(sRGBToLab, rgbMid, labOut, 1);
    return {
        Color: name,
        'Lab In': `[${[...labIn]}]`,
        'sRGB Mid': `[${[...rgbMid]}]`,
        'Lab Out': `[${[...labOut]}]`,
        'ΔL': labOut[0] - labIn[0],
        'Δa': labOut[1] - labIn[1],
        'Δb': labOut[2] - labIn[2],
    };
});

console.log('\n── Roundtrip: Lab → sRGB → Lab (8-bit) ──');
console.table(roundtripRows);

// ── Cleanup ─────────────────────────────────────────────────────────────────
engine.deleteTransform(labTosRGB);
engine.deleteTransform(sRGBToLab);
engine.closeProfile(labProfile);
engine.closeProfile(sRGBProfile);
