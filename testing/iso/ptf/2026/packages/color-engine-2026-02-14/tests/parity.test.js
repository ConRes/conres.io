/**
 * @fileoverview Color-Engine vs Baseline Little-CMS Comparison
 *
 * Runs identical Lab ↔ sRGB transforms through both the baseline Little-CMS
 * (no extensions) and color-engine (with extensions), comparing results.
 * Each combination is a separate test so failures show exactly which
 * configuration diverges and what the actual values are.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
  createEngine as createColorEngine,
  TYPE_Lab_8,
  TYPE_Lab_16,
  TYPE_Lab_FLT,
  TYPE_RGB_8,
  TYPE_RGB_16,
  TYPE_RGB_FLT,
  INTENT_PERCEPTUAL,
  INTENT_RELATIVE_COLORIMETRIC,
  cmsFLAGS_NOCACHE,
  cmsFLAGS_NOOPTIMIZE,
  cmsFLAGS_BLACKPOINTCOMPENSATION,
} from '../src/index.js';
import {
  createEngine as createBaselineEngine,
} from '../../little-cms/src/index.js';

const intents = [
  { name: 'Relative Colorimetric', value: INTENT_RELATIVE_COLORIMETRIC },
  { name: 'Perceptual', value: INTENT_PERCEPTUAL },
];

const flagCombinations = [
  { name: 'none', value: 0 },
  { name: 'NOOPTIMIZE', value: cmsFLAGS_NOOPTIMIZE },
  { name: 'BPC', value: cmsFLAGS_BLACKPOINTCOMPENSATION },
  { name: 'NOOPTIMIZE + BPC', value: cmsFLAGS_NOOPTIMIZE | cmsFLAGS_BLACKPOINTCOMPENSATION },
];

const labFormats = [
  { name: '8-bit', type: TYPE_Lab_8, ArrayType: Uint8Array, neutralBlack: [0, 128, 128], channels: 3 },
  { name: '16-bit', type: TYPE_Lab_16, ArrayType: Uint16Array, neutralBlack: [0, 0x8080, 0x8080], channels: 3 },
  { name: 'Float32', type: TYPE_Lab_FLT, ArrayType: Float32Array, neutralBlack: [0.0, 0.0, 0.0], channels: 3 },
];

const rgbFormats = [
  { name: '8-bit', type: TYPE_RGB_8, ArrayType: Uint8Array, black: [0, 0, 0], channels: 3 },
  { name: '16-bit', type: TYPE_RGB_16, ArrayType: Uint16Array, black: [0, 0, 0], channels: 3 },
  { name: 'Float32', type: TYPE_RGB_FLT, ArrayType: Float32Array, black: [0.0, 0.0, 0.0], channels: 3 },
];

/**
 * Run a single Lab → sRGB transform via createTransform.
 */
function runLabToSRGB(engine, labFmt, rgbFmt, intent, flags) {
  const combinedFlags = cmsFLAGS_NOCACHE | flags;
  const labProfile = engine.createLab4Profile();
  const rgbProfile = engine.createSRGBProfile();
  const xf = engine.createTransform(labProfile, labFmt.type, rgbProfile, rgbFmt.type, intent, combinedFlags);
  const input = new labFmt.ArrayType(labFmt.neutralBlack);
  const output = new rgbFmt.ArrayType(rgbFmt.channels);
  engine.doTransform(xf, input, output, 1);
  engine.deleteTransform(xf);
  engine.closeProfile(labProfile);
  engine.closeProfile(rgbProfile);
  return Array.from(output);
}

/**
 * Run a single sRGB → Lab transform via createTransform.
 */
function runSRGBToLab(engine, rgbFmt, labFmt, intent, flags) {
  const combinedFlags = cmsFLAGS_NOCACHE | flags;
  const rgbProfile = engine.createSRGBProfile();
  const labProfile = engine.createLab4Profile();
  const xf = engine.createTransform(rgbProfile, rgbFmt.type, labProfile, labFmt.type, intent, combinedFlags);
  const input = new rgbFmt.ArrayType(rgbFmt.black);
  const output = new labFmt.ArrayType(labFmt.channels);
  engine.doTransform(xf, input, output, 1);
  engine.deleteTransform(xf);
  engine.closeProfile(rgbProfile);
  engine.closeProfile(labProfile);
  return Array.from(output);
}

/**
 * Run a single Lab → sRGB transform via createMultiprofileTransform.
 */
function runLabToSRGBMultiprofile(engine, labFmt, rgbFmt, intent, flags) {
  const combinedFlags = cmsFLAGS_NOCACHE | flags;
  const labProfile = engine.createLab4Profile();
  const rgbProfile = engine.createSRGBProfile();
  const xf = engine.createMultiprofileTransform([labProfile, rgbProfile], labFmt.type, rgbFmt.type, intent, combinedFlags);
  const input = new labFmt.ArrayType(labFmt.neutralBlack);
  const output = new rgbFmt.ArrayType(rgbFmt.channels);
  engine.doTransform(xf, input, output, 1);
  engine.deleteTransform(xf);
  engine.closeProfile(labProfile);
  engine.closeProfile(rgbProfile);
  return Array.from(output);
}

/**
 * Run a single sRGB → Lab transform via createMultiprofileTransform.
 */
function runSRGBToLabMultiprofile(engine, rgbFmt, labFmt, intent, flags) {
  const combinedFlags = cmsFLAGS_NOCACHE | flags;
  const rgbProfile = engine.createSRGBProfile();
  const labProfile = engine.createLab4Profile();
  const xf = engine.createMultiprofileTransform([rgbProfile, labProfile], rgbFmt.type, labFmt.type, intent, combinedFlags);
  const input = new rgbFmt.ArrayType(rgbFmt.black);
  const output = new labFmt.ArrayType(labFmt.channels);
  engine.doTransform(xf, input, output, 1);
  engine.deleteTransform(xf);
  engine.closeProfile(rgbProfile);
  engine.closeProfile(labProfile);
  return Array.from(output);
}

describe('Color-Engine vs Baseline: Lab ↔ sRGB', () => {
  let baseline;
  let colorEngine;

  beforeAll(async () => {
    baseline = await createBaselineEngine();
    colorEngine = await createColorEngine();
  });

  describe('Lab 0/0/0 → sRGB', () => {
    const labToSRGBTable = {};

    for (const intent of intents) {
      for (const flags of flagCombinations) {
        for (let d = 0; d < labFormats.length; d++) {
          const labFmt = labFormats[d];
          const rgbFmt = rgbFormats[d];
          const key = `${intent.name} (${flags.name}) ${labFmt.name}`;

          it(key, () => {
            const baselineResult = runLabToSRGB(baseline, labFmt, rgbFmt, intent.value, flags.value);
            const colorEngineResult = runLabToSRGB(colorEngine, labFmt, rgbFmt, intent.value, flags.value);

            labToSRGBTable[key] = {
              'Baseline': `[${baselineResult}]`,
              'Color-Engine': `[${colorEngineResult}]`,
            };

            console.log(`Lab → sRGB | ${key} | Baseline: [${baselineResult}] | Color-Engine: [${colorEngineResult}]`);
            expect(colorEngineResult, `Color-Engine should match Baseline for ${key}`).toEqual(baselineResult);
          });
        }
      }
    }

    it('summary table', () => {
      console.log('\n=== Lab 0/0/0 → sRGB: Baseline vs Color-Engine ===');
      console.table(labToSRGBTable);
    });
  });

  describe('sRGB 0/0/0 → Lab', () => {
    const sRGBToLabTable = {};

    for (const intent of intents) {
      for (const flags of flagCombinations) {
        for (let d = 0; d < rgbFormats.length; d++) {
          const rgbFmt = rgbFormats[d];
          const labFmt = labFormats[d];
          const key = `${intent.name} (${flags.name}) ${rgbFmt.name}`;

          it(key, () => {
            const baselineResult = runSRGBToLab(baseline, rgbFmt, labFmt, intent.value, flags.value);
            const colorEngineResult = runSRGBToLab(colorEngine, rgbFmt, labFmt, intent.value, flags.value);

            sRGBToLabTable[key] = {
              'Baseline': `[${baselineResult}]`,
              'Color-Engine': `[${colorEngineResult}]`,
            };

            console.log(`sRGB → Lab | ${key} | Baseline: [${baselineResult}] | Color-Engine: [${colorEngineResult}]`);
            expect(colorEngineResult, `Color-Engine should match Baseline for ${key}`).toEqual(baselineResult);
          });
        }
      }
    }

    it('summary table', () => {
      console.log('\n=== sRGB 0/0/0 → Lab: Baseline vs Color-Engine ===');
      console.table(sRGBToLabTable);
    });
  });
});

describe('Multiprofile Parity: Baseline vs Color-Engine', () => {
  let baseline;
  let colorEngine;

  beforeAll(async () => {
    baseline = await createBaselineEngine();
    colorEngine = await createColorEngine();
  });

  describe('Lab 0/0/0 → sRGB (createMultiprofileTransform)', () => {
    const table = {};

    for (const intent of intents) {
      for (const flags of flagCombinations) {
        for (let d = 0; d < labFormats.length; d++) {
          const labFmt = labFormats[d];
          const rgbFmt = rgbFormats[d];
          const key = `${intent.name} (${flags.name}) ${labFmt.name}`;

          it(key, () => {
            const baselineResult = runLabToSRGBMultiprofile(baseline, labFmt, rgbFmt, intent.value, flags.value);
            const colorEngineResult = runLabToSRGBMultiprofile(colorEngine, labFmt, rgbFmt, intent.value, flags.value);

            table[key] = {
              'Baseline': `[${baselineResult}]`,
              'Color-Engine': `[${colorEngineResult}]`,
              'Match': baselineResult.every((v, i) => v === colorEngineResult[i]) ? 'YES' : 'NO',
            };

            console.log(`Multiprofile Lab → sRGB | ${key} | Baseline: [${baselineResult}] | Color-Engine: [${colorEngineResult}]`);
          });
        }
      }
    }

    it('summary table', () => {
      console.log('\n=== Multiprofile Lab 0/0/0 → sRGB: Baseline vs Color-Engine ===');
      console.table(table);
    });
  });

  describe('sRGB 0/0/0 → Lab (createMultiprofileTransform)', () => {
    const table = {};

    for (const intent of intents) {
      for (const flags of flagCombinations) {
        for (let d = 0; d < rgbFormats.length; d++) {
          const rgbFmt = rgbFormats[d];
          const labFmt = labFormats[d];
          const key = `${intent.name} (${flags.name}) ${rgbFmt.name}`;

          it(key, () => {
            const baselineResult = runSRGBToLabMultiprofile(baseline, rgbFmt, labFmt, intent.value, flags.value);
            const colorEngineResult = runSRGBToLabMultiprofile(colorEngine, rgbFmt, labFmt, intent.value, flags.value);

            table[key] = {
              'Baseline': `[${baselineResult}]`,
              'Color-Engine': `[${colorEngineResult}]`,
              'Match': baselineResult.every((v, i) => v === colorEngineResult[i]) ? 'YES' : 'NO',
            };

            console.log(`Multiprofile sRGB → Lab | ${key} | Baseline: [${baselineResult}] | Color-Engine: [${colorEngineResult}]`);
          });
        }
      }
    }

    it('summary table', () => {
      console.log('\n=== Multiprofile sRGB 0/0/0 → Lab: Baseline vs Color-Engine ===');
      console.table(table);
    });
  });
});

describe('Color-Engine: createTransform vs createMultiprofileTransform', () => {
  let colorEngine;

  beforeAll(async () => {
    colorEngine = await createColorEngine();
  });

  describe('Lab 0/0/0 → sRGB', () => {
    const table = {};

    for (const intent of intents) {
      for (const flags of flagCombinations) {
        for (let d = 0; d < labFormats.length; d++) {
          const labFmt = labFormats[d];
          const rgbFmt = rgbFormats[d];
          const key = `${intent.name} (${flags.name}) ${labFmt.name}`;

          it(key, () => {
            const singleResult = runLabToSRGB(colorEngine, labFmt, rgbFmt, intent.value, flags.value);
            const multiResult = runLabToSRGBMultiprofile(colorEngine, labFmt, rgbFmt, intent.value, flags.value);

            table[key] = {
              'createTransform': `[${singleResult}]`,
              'createMultiprofileTransform': `[${multiResult}]`,
              'Match': singleResult.every((v, i) => v === multiResult[i]) ? 'YES' : 'NO',
            };

            console.log(`CE Lab → sRGB | ${key} | createTransform: [${singleResult}] | createMultiprofileTransform: [${multiResult}]`);
          });
        }
      }
    }

    it('summary table', () => {
      console.log('\n=== Color-Engine Lab 0/0/0 → sRGB: createTransform vs createMultiprofileTransform ===');
      console.table(table);
    });
  });

  describe('sRGB 0/0/0 → Lab', () => {
    const table = {};

    for (const intent of intents) {
      for (const flags of flagCombinations) {
        for (let d = 0; d < rgbFormats.length; d++) {
          const rgbFmt = rgbFormats[d];
          const labFmt = labFormats[d];
          const key = `${intent.name} (${flags.name}) ${rgbFmt.name}`;

          it(key, () => {
            const singleResult = runSRGBToLab(colorEngine, rgbFmt, labFmt, intent.value, flags.value);
            const multiResult = runSRGBToLabMultiprofile(colorEngine, rgbFmt, labFmt, intent.value, flags.value);

            table[key] = {
              'createTransform': `[${singleResult}]`,
              'createMultiprofileTransform': `[${multiResult}]`,
              'Match': singleResult.every((v, i) => v === multiResult[i]) ? 'YES' : 'NO',
            };

            console.log(`CE sRGB → Lab | ${key} | createTransform: [${singleResult}] | createMultiprofileTransform: [${multiResult}]`);
          });
        }
      }
    }

    it('summary table', () => {
      console.log('\n=== Color-Engine sRGB 0/0/0 → Lab: createTransform vs createMultiprofileTransform ===');
      console.table(table);
    });
  });
});
