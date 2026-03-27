#!/usr/bin/env node

// @ts-check


/**** RULES ****

- Use modern JavaScript (ES6+)
- Use async/await for asynchronous operations
- Use equivalent operations for the LittleCMS and JSColorEngine packages independently
- Avoid catch blocks unless necessary; prefer process-level error handling
- Use descriptive variable and function names
- Modularize code into functions for clarity and reuse
- Use console.table for tabular data output
- Maintain consistent code formatting and indentation
- Include JSDoc comments for functions and complex logic

***************/

/**
 * Comprehensive Gray Diagnostic
 *
 * Tests 11 gray levels using the proven k-only-demo.js approach
 * to identify shadow compression patterns.
 *
 * Based on working k-only-demo.js transform setup.
 */

import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import * as LittleCMS from '../packages/color-engine/src/index.js';
import * as JSColorEngine from '../packages/js-color-engine/src/main.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Set REVISION like k-only-demo.js
// JSColorEngine.Profile.REVISION = JSColorEngine.Transform.REVISION = JSColorEngine.Profile.REVISION = 'x16d';

// Profiles to test (keeping it focused)
const PROFILES = [
  'CoatedFOGRA39.icc',
  'UncoatedFOGRA29.icc',
  // Uncomment to test more:
  // 'GRACoL2006_Coated1v2.icc',
  // 'JapanColor2011Coated.icc',
  // 'USWebCoatedSWOP.icc',
];


const DEFAULTS = (({
  useBPC = false,
} = {}) => ({
  useBPC,
  /** @type {Partial<ConstructorParameters<typeof JSColorEngine.Transform>[0]>} */
  jsceTransformOptions: {
    useBPC,
    // _BPCAutoEnable: useBPC ? undefined : false,
    promoteGrayToCMYKBlack: false,
    buildLUT: false,
  },
}))();


/**
 * @param {string } profileName 
 */
async function analyzeProfile(profileName) {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`\nProfile: ${profileName}`);
  console.log('='.repeat(80));

  /** @type {(() => void)[]} */
  const cleanupSteps = [];

  try {

    const profilePath = join(__dirname, `../packages/color-engine/tests/fixtures/profiles/cmyk/${profileName}`);
    const profileBuffer = await readFile(profilePath);

    // Initialize Little-CMS (WASM)
    const lcmsColorEngine = await LittleCMS.createEngine();
    const lcmsRGBProfile = lcmsColorEngine.createSRGBProfile();
    // cleanupSteps.push(() => lcmsColorEngine.destroyProfile(lcmsRGBProfile));
    const lcmsLabProfile = lcmsColorEngine.createLab4Profile();
    // cleanupSteps.push(() => lcmsColorEngine.destroyProfile(lcmsLabProfile));
    const lcmsCMYKProfile = lcmsColorEngine.openProfileFromMem(new Uint8Array(profileBuffer));
    // cleanupSteps.push(() => lcmsColorEngine.destroyProfile(lcmsCMYKProfile));

    const jsceRGBProfile = new JSColorEngine.Profile('*sRGB');
    const jsceLabProfile = new JSColorEngine.Profile('*LabD50');
    const jsceCMYKProfile = new JSColorEngine.Profile(profileBuffer);

    console.log('\n📊 Uint8 (8-bit) Analysis:\n');
    analyzeCurvesU8({ lcmsColorEngine, profileBuffer, lcmsRGBProfile, lcmsLabProfile, lcmsCMYKProfile, jsceRGBProfile, jsceLabProfile, jsceCMYKProfile });

    console.log('\n📊 Uint16 (16-bit) Analysis:\n');
    analyzeCurvesU16({ lcmsColorEngine, profileBuffer, lcmsRGBProfile, lcmsLabProfile, lcmsCMYKProfile, jsceRGBProfile, jsceLabProfile, jsceCMYKProfile });

    // NOTE: Float32 analysis disabled - Little-CMS floating-point Lab transforms have fundamental issues in WASM
    // TYPE_Lab_FLT produces corrupted output and crashes during memory operations
    // TYPE_Lab_DBL fails to create transforms (returns handle=0)
    // See experiments/test-lcms-float32.js for detailed investigation
    // console.log('\n📊 Float32 Analysis:\n');
    // analyzeCurvesF32({ lcmsColorEngine, profileBuffer, lcmsRGBProfile, lcmsLabProfile, lcmsCMYKProfile, jsceRGBProfile, jsceLabProfile, jsceCMYKProfile });

  } finally {
    for (const cleanupStep of cleanupSteps) cleanupStep();
  }
}

/**
 * @param {object} options
 * @param {LittleCMS.ColorEngine} options.lcmsColorEngine
 * @param {Uint8Array} options.profileBuffer
 * @param {import('../packages/color-engine/src/index.js').PointerType} options.lcmsRGBProfile
 * @param {import('../packages/color-engine/src/index.js').PointerType} options.lcmsLabProfile
 * @param {import('../packages/color-engine/src/index.js').PointerType} options.lcmsCMYKProfile
 * @param {JSColorEngine.Profile} options.jsceRGBProfile
 * @param {JSColorEngine.Profile} options.jsceLabProfile
 * @param {JSColorEngine.Profile} options.jsceCMYKProfile
 * 
 */
function analyzeCurvesU8({ lcmsColorEngine, profileBuffer, lcmsRGBProfile, lcmsLabProfile, lcmsCMYKProfile, jsceRGBProfile, jsceLabProfile, jsceCMYKProfile }) {

  /** @type {(() => void)[]} */
  const cleanupSteps = [];

  /** @type {Partial<ConstructorParameters<typeof JSColorEngine.Transform>[0]>} */
  const jsceTransformDefaults = {
    ...DEFAULTS.jsceTransformOptions,
    dataFormat: 'int8',
  };

  try {

    // Going from input (sRGB) to device-independent Lab for reference
    const lcmsRGBABRTransform = lcmsColorEngine.createTransform(
      lcmsRGBProfile,
      LittleCMS.TYPE_RGB_8,
      lcmsLabProfile,
      LittleCMS.TYPE_Lab_8,
      LittleCMS.INTENT_RELATIVE_COLORIMETRIC,
      DEFAULTS.useBPC ? LittleCMS.cmsFLAGS_BLACKPOINTCOMPENSATION : 0,
    );

    cleanupSteps.push(() => lcmsColorEngine.deleteTransform(lcmsRGBABRTransform));

    const jsceRGBABRTransform = new JSColorEngine.Transform({ ...jsceTransformDefaults });

    jsceRGBABRTransform.create(jsceRGBProfile, jsceLabProfile, JSColorEngine.eIntent.relative);
    // jsceRGBABRTransform.useBPC = DEFAULTS.useBPC;

    const lcmsRGBBARTransform = lcmsColorEngine.createTransform(
      lcmsLabProfile,
      LittleCMS.TYPE_Lab_8,
      lcmsRGBProfile,
      LittleCMS.TYPE_RGB_8,
      LittleCMS.INTENT_RELATIVE_COLORIMETRIC,
      DEFAULTS.useBPC ? LittleCMS.cmsFLAGS_BLACKPOINTCOMPENSATION : 0,
    );

    cleanupSteps.push(() => lcmsColorEngine.deleteTransform(lcmsRGBBARTransform));

    const jsceRGBBARTransform = new JSColorEngine.Transform({ ...jsceTransformDefaults });

    jsceRGBBARTransform.create(jsceLabProfile, jsceRGBProfile, JSColorEngine.eIntent.relative);
    // jsceRGBBARTransform.useBPC = DEFAULTS.useBPC;

    const lcmsCMYKABRTransform = lcmsColorEngine.createTransform(
      lcmsCMYKProfile,
      LittleCMS.TYPE_CMYK_8,
      lcmsLabProfile,
      LittleCMS.TYPE_Lab_8,
      LittleCMS.INTENT_RELATIVE_COLORIMETRIC,
      DEFAULTS.useBPC ? LittleCMS.cmsFLAGS_BLACKPOINTCOMPENSATION : 0,
    );

    cleanupSteps.push(() => lcmsColorEngine.deleteTransform(lcmsCMYKABRTransform));

    const jsceCMYKABRTransform = new JSColorEngine.Transform({ ...jsceTransformDefaults });

    jsceCMYKABRTransform.create(jsceCMYKProfile, jsceLabProfile, JSColorEngine.eIntent.relative);
    // jsceCMYKABRTransform.useBPC = DEFAULTS.useBPC;

    const lcmsCMYKBARTransform = lcmsColorEngine.createTransform(
      lcmsLabProfile,
      LittleCMS.TYPE_Lab_8,
      lcmsCMYKProfile,
      LittleCMS.TYPE_CMYK_8,
      LittleCMS.INTENT_RELATIVE_COLORIMETRIC,
      DEFAULTS.useBPC ? LittleCMS.cmsFLAGS_BLACKPOINTCOMPENSATION : 0,
    );

    cleanupSteps.push(() => lcmsColorEngine.deleteTransform(lcmsCMYKBARTransform));

    const jsceCMYKBARTransform = new JSColorEngine.Transform({ ...jsceTransformDefaults });

    jsceCMYKBARTransform.create(jsceLabProfile, jsceCMYKProfile, JSColorEngine.eIntent.relative);
    // jsceCMYKBARTransform.useBPC = DEFAULTS.useBPC;

    /** @type {Record<string, Exclude<any, Object | Function>>} */
    const colorTable = {};

    /** @param {number} scalar */
    const scalarToUint8 = (scalar) => Math.round(scalar * 255);

    /** @param {Uint8Array} lab8 */
    const lab8ToLab = (lab8) => [(lab8[0] / 255) * 100, lab8[1] - 127, lab8[2] - 127];

    /** @param {Uint8Array} lab */
    const lab2Lab8 = (lab) => new Uint8Array([(lab[0] / 100) * 255, lab[1] + 127, lab[2] + 127]);

    /** @param {number} l @param {number} a @param {number} b */
    const labD50Color = (l, a, b) => JSColorEngine.convert.Lab(l, a, b);

    /** @param {Uint8Array} lab8 */
    const lab8ToLabColor = (lab8) => labD50Color(.../** @type {[number, number, number]} */(lab8ToLab(lab8)));

    for (const grayScalar of [0, 0.025, 0.05, 0.1, 0.25, 0.5, 0.75, 0.9, 0.95, 0.975, 1.0]) {
      const grayPercent = grayScalar * 100;
      const grayU8 = scalarToUint8(grayScalar);

      const kScalar = 1 - grayScalar;
      const kPercent = kScalar * 100;
      const kU8 = scalarToUint8(kScalar);

      const cmykABRAU8 = Uint8Array.from([0, 0, 0, kU8]);

      const lcmsCMYKABRBU8 = new Uint8Array(3);
      lcmsColorEngine.doTransform(lcmsCMYKABRTransform, cmykABRAU8, lcmsCMYKABRBU8, 1);
      const lcmsCMYKABRBLab = lab8ToLabColor(lcmsCMYKABRBU8);

      // const jsceCMYKABRBU8 = jsceCMYKABRTransform.transformArray(cmykABRAU8);
      const jsceCMYKABRBU8 = jsceCMYKABRTransform.forward(
        cmykABRAU8
        // {C:0, M:0, Y:0, K:kU8, type: JSColorEngine.eColourType.CMYKf},
      );
      const jsceCMYKABRBLab = lab8ToLabColor(jsceCMYKABRBU8);

      // Lab → RGB/CMYK transforms - use Lab8 arrays directly (not Lab objects)
      const labBARBU8_lcms = Uint8Array.from(lcmsCMYKABRBU8);
      const labBARBU8_jsce = Array.from(jsceCMYKABRBU8); // JSColorEngine with int8 expects plain array

      const lcmsRGBBBARAU8 = new Uint8Array(3);
      lcmsColorEngine.doTransform(lcmsRGBBARTransform, labBARBU8_lcms, lcmsRGBBBARAU8, 1);

      const jsceRGBBBARAArray = jsceRGBBARTransform.forward(labBARBU8_jsce);

      const lcmsCMYKBARAU8 = new Uint8Array(4);
      lcmsColorEngine.doTransform(lcmsCMYKBARTransform, labBARBU8_lcms, lcmsCMYKBARAU8, 1);

      const jsceCMYKBARAArray = jsceCMYKBARTransform.forward(labBARBU8_jsce);

      // console.dir({
      //   cmykABRAU8,
      //   lcmsCMYKABRBU8,
      //   lcmsCMYKABRBLab,
      //   jsceCMYKABRBU8,
      //   jsceCMYKABRBLab,
      //   lcmsRGBBBARAU8,
      //   jsceRGBBBARAU8,
      // }, { compact: true });

      colorTable[`K ${kPercent.toFixed(1)}%`] = {
        'L:lc': Number(lcmsCMYKABRBLab.L.toFixed(1)),
        'L:js': Number(jsceCMYKABRBLab.L.toFixed(1)),
        'a:lc': Number(lcmsCMYKABRBLab.a.toFixed(1)),
        'a:js': Number(jsceCMYKABRBLab.a.toFixed(1)),
        'b:lc': Number(lcmsCMYKABRBLab.b.toFixed(1)),
        'b:js': Number(jsceCMYKABRBLab.b.toFixed(1)),
        'R:lc': lcmsRGBBBARAU8[0],
        'R:js': jsceRGBBBARAArray[0],
        'G:lc': lcmsRGBBBARAU8[1],
        'G:js': jsceRGBBBARAArray[1],
        'B:lc': lcmsRGBBBARAU8[2],
        'B:js': jsceRGBBBARAArray[2],
        'C:lc': lcmsCMYKBARAU8[0],
        'C:js': jsceCMYKBARAArray[0],
        'M:lc': lcmsCMYKBARAU8[1],
        'M:js': jsceCMYKBARAArray[1],
        'Y:lc': lcmsCMYKBARAU8[2],
        'Y:js': jsceCMYKBARAArray[2],
        'K:lc': lcmsCMYKBARAU8[3],
        'K:js': jsceCMYKBARAArray[3],
      };
    }

    console.table(colorTable);

  } finally {
    for (const cleanupStep of cleanupSteps) cleanupStep();
  }
}


/**
 * @param {object} options
 * @param {LittleCMS.ColorEngine} options.lcmsColorEngine
 * @param {Uint8Array} options.profileBuffer
 * @param {import('../packages/color-engine/src/index.js').PointerType} options.lcmsRGBProfile
 * @param {import('../packages/color-engine/src/index.js').PointerType} options.lcmsLabProfile
 * @param {import('../packages/color-engine/src/index.js').PointerType} options.lcmsCMYKProfile
 * @param {JSColorEngine.Profile} options.jsceRGBProfile
 * @param {JSColorEngine.Profile} options.jsceLabProfile
 * @param {JSColorEngine.Profile} options.jsceCMYKProfile
 *
 */
function analyzeCurvesU16({ lcmsColorEngine, profileBuffer, lcmsRGBProfile, lcmsLabProfile, lcmsCMYKProfile, jsceRGBProfile, jsceLabProfile, jsceCMYKProfile }) {

  /** @type {(() => void)[]} */
  const cleanupSteps = [];

  /**
   * @type {Partial<ConstructorParameters<typeof JSColorEngine.Transform>[0]>}
   */
  const jsceTransformDefaults = {
    ...DEFAULTS.jsceTransformOptions,
    dataFormat: 'int16',
  };

  try {

    // Going from input (sRGB) to device-independent Lab for reference
    const lcmsRGBABRTransform = lcmsColorEngine.createTransform(
      lcmsRGBProfile,
      LittleCMS.TYPE_RGB_16,
      lcmsLabProfile,
      LittleCMS.TYPE_Lab_16,
      LittleCMS.INTENT_RELATIVE_COLORIMETRIC,
      DEFAULTS.useBPC ? LittleCMS.cmsFLAGS_BLACKPOINTCOMPENSATION : 0,
    );

    cleanupSteps.push(() => lcmsColorEngine.deleteTransform(lcmsRGBABRTransform));

    const jsceRGBABRTransform = new JSColorEngine.Transform({ ...jsceTransformDefaults });

    jsceRGBABRTransform.create(jsceRGBProfile, jsceLabProfile, JSColorEngine.eIntent.relative);
    // jsceRGBABRTransform.useBPC = DEFAULTS.useBPC;

    const lcmsRGBBARTransform = lcmsColorEngine.createTransform(
      lcmsLabProfile,
      LittleCMS.TYPE_Lab_16,
      lcmsRGBProfile,
      LittleCMS.TYPE_RGB_16,
      LittleCMS.INTENT_RELATIVE_COLORIMETRIC,
      DEFAULTS.useBPC ? LittleCMS.cmsFLAGS_BLACKPOINTCOMPENSATION : 0,
    );

    cleanupSteps.push(() => lcmsColorEngine.deleteTransform(lcmsRGBBARTransform));

    const jsceRGBBARTransform = new JSColorEngine.Transform({ ...jsceTransformDefaults });

    jsceRGBBARTransform.create(jsceLabProfile, jsceRGBProfile, JSColorEngine.eIntent.relative);
    // jsceRGBBARTransform.useBPC = DEFAULTS.useBPC;

    const lcmsCMYKABRTransform = lcmsColorEngine.createTransform(
      lcmsCMYKProfile,
      LittleCMS.TYPE_CMYK_16,
      lcmsLabProfile,
      LittleCMS.TYPE_Lab_16,
      LittleCMS.INTENT_RELATIVE_COLORIMETRIC,
      DEFAULTS.useBPC ? LittleCMS.cmsFLAGS_BLACKPOINTCOMPENSATION : 0,
    );

    cleanupSteps.push(() => lcmsColorEngine.deleteTransform(lcmsCMYKABRTransform));

    const jsceCMYKABRTransform = new JSColorEngine.Transform({ ...jsceTransformDefaults });

    jsceCMYKABRTransform.create(jsceCMYKProfile, jsceLabProfile, JSColorEngine.eIntent.relative);
    // jsceCMYKABRTransform.useBPC = DEFAULTS.useBPC;

    const lcmsCMYKBARTransform = lcmsColorEngine.createTransform(
      lcmsLabProfile,
      LittleCMS.TYPE_Lab_16,
      lcmsCMYKProfile,
      LittleCMS.TYPE_CMYK_16,
      LittleCMS.INTENT_RELATIVE_COLORIMETRIC,
      DEFAULTS.useBPC ? LittleCMS.cmsFLAGS_BLACKPOINTCOMPENSATION : 0,
    );

    cleanupSteps.push(() => lcmsColorEngine.deleteTransform(lcmsCMYKBARTransform));

    const jsceCMYKBARTransform = new JSColorEngine.Transform({ ...jsceTransformDefaults });

    jsceCMYKBARTransform.create(jsceLabProfile, jsceCMYKProfile, JSColorEngine.eIntent.relative);
    // jsceCMYKBARTransform.useBPC = DEFAULTS.useBPC;

    /** @type {Record<string, Exclude<any, Object | Function>>} */
    const colorTable = {};

    /** @param {number} scalar */
    const scalarToUint16 = (scalar) => Math.round(scalar * 65535);

    /**
     * Decode Lab16 (V4 encoding) to Lab float values
     * @param {Uint16Array|number[]} lab16
     */
    const lab16ToLab = (lab16) => [
      lab16[0] / 655.35,              // L: 0-65535 → 0-100
      (lab16[1] / 257.0) - 128.0,     // a: 0-65535 → -128 to +127 (32896 is zero)
      (lab16[2] / 257.0) - 128.0      // b: 0-65535 → -128 to +127 (32896 is zero)
    ];

    /**
     * Encode Lab float values to Lab16 (V4 encoding)
     * @param {number[]} lab
     */
    const labToLab16 = (lab) => [
      Math.round(lab[0] * 655.35),         // L
      Math.round((lab[1] + 128.0) * 257.0), // a
      Math.round((lab[2] + 128.0) * 257.0)  // b
    ];

    /** @param {number} l @param {number} a @param {number} b */
    const labD50Color = (l, a, b) => JSColorEngine.convert.Lab(l, a, b);

    /** @param {Uint16Array|number[]} lab16 */
    const lab16ToLabColor = (lab16) => labD50Color(.../** @type {[number, number, number]} */(lab16ToLab(lab16)));

    for (const grayScalar of [0, 0.025, 0.05, 0.1, 0.25, 0.5, 0.75, 0.9, 0.95, 0.975, 1.0]) {
      const grayPercent = grayScalar * 100;
      const grayU16 = scalarToUint16(grayScalar);

      const kScalar = 1 - grayScalar;
      const kPercent = kScalar * 100;
      const kU16 = scalarToUint16(kScalar);

      // CMYK input (A) - K-only black
      const cmykABRAU16_lcms = Uint16Array.from([0, 0, 0, kU16]); // For LittleCMS
      const cmykABRAU16_jsce = [0, 0, 0, kU16];                   // For JSColorEngine

      // CMYK → Lab transform (A to B, Relative)
      const lcmsCMYKABRBU16 = new Uint16Array(3);
      lcmsColorEngine.doTransform(lcmsCMYKABRTransform, cmykABRAU16_lcms, lcmsCMYKABRBU16, 1);
      const lcmsCMYKABRBLab = lab16ToLab(lcmsCMYKABRBU16);

      const jsceCMYKABRBArray = jsceCMYKABRTransform.forward(cmykABRAU16_jsce); // Returns plain array
      const jsceCMYKABRBLab = lab16ToLab(jsceCMYKABRBArray);

      // Lab → RGB transform (B to A, Relative) - using Lab16 encoded values
      const labBARBU16_lcms = Uint16Array.from(lcmsCMYKABRBU16);
      const labBARBU16_jsce = jsceCMYKABRBArray; // Already a plain array

      const lcmsRGBBBARAU16 = new Uint16Array(3);
      lcmsColorEngine.doTransform(lcmsRGBBARTransform, labBARBU16_lcms, lcmsRGBBBARAU16, 1);

      const jsceRGBBBARAArray = jsceRGBBARTransform.forward(labBARBU16_jsce);

      // Lab → CMYK transform (B to A, Relative) - using Lab16 encoded values
      const lcmsCMYKBARAU16 = new Uint16Array(4);
      lcmsColorEngine.doTransform(lcmsCMYKBARTransform, labBARBU16_lcms, lcmsCMYKBARAU16, 1);

      const jsceCMYKBARAArray = jsceCMYKBARTransform.forward(labBARBU16_jsce);

      colorTable[`K ${kPercent.toFixed(1)}%`] = {
        'L:lc': Number(lcmsCMYKABRBLab[0].toFixed(1)),
        'L:js': Number(jsceCMYKABRBLab[0].toFixed(1)),
        'a:lc': Number(lcmsCMYKABRBLab[1].toFixed(1)),
        'a:js': Number(jsceCMYKABRBLab[1].toFixed(1)),
        'b:lc': Number(lcmsCMYKABRBLab[2].toFixed(1)),
        'b:js': Number(jsceCMYKABRBLab[2].toFixed(1)),
        'R:lc': lcmsRGBBBARAU16[0],
        'R:js': jsceRGBBBARAArray[0],
        'G:lc': lcmsRGBBBARAU16[1],
        'G:js': jsceRGBBBARAArray[1],
        'B:lc': lcmsRGBBBARAU16[2],
        'B:js': jsceRGBBBARAArray[2],
        'C:lc': lcmsCMYKBARAU16[0],
        'C:js': jsceCMYKBARAArray[0],
        'M:lc': lcmsCMYKBARAU16[1],
        'M:js': jsceCMYKBARAArray[1],
        'Y:lc': lcmsCMYKBARAU16[2],
        'Y:js': jsceCMYKBARAArray[2],
        'K:lc': lcmsCMYKBARAU16[3],
        'K:js': jsceCMYKBARAArray[3],
      };
    }

    console.table(colorTable);

  } finally {
    for (const cleanupStep of cleanupSteps) cleanupStep();
  }
}



/**
 * @param {object} options
 * @param {LittleCMS.ColorEngine} options.lcmsColorEngine
 * @param {Uint8Array} options.profileBuffer
 * @param {import('../packages/color-engine/src/index.js').PointerType} options.lcmsRGBProfile
 * @param {import('../packages/color-engine/src/index.js').PointerType} options.lcmsLabProfile
 * @param {import('../packages/color-engine/src/index.js').PointerType} options.lcmsCMYKProfile
 * @param {JSColorEngine.Profile} options.jsceRGBProfile
 * @param {JSColorEngine.Profile} options.jsceLabProfile
 * @param {JSColorEngine.Profile} options.jsceCMYKProfile
 *
 */
function analyzeCurvesF32({ lcmsColorEngine, profileBuffer, lcmsRGBProfile, lcmsLabProfile, lcmsCMYKProfile, jsceRGBProfile, jsceLabProfile, jsceCMYKProfile }) {

  /** @type {(() => void)[]} */
  const cleanupSteps = [];

  /**
   * @type {Partial<ConstructorParameters<typeof JSColorEngine.Transform>[0]>}
   */
  const jsceTransformDefaults = {
    ...DEFAULTS.jsceTransformOptions,
    dataFormat: 'objectFloat',
  };

  try {

    // Going from input (sRGB) to device-independent Lab for reference
    const lcmsRGBABRTransform = lcmsColorEngine.createTransform(
      lcmsRGBProfile,
      LittleCMS.TYPE_RGB_FLT,
      lcmsLabProfile,
      LittleCMS.TYPE_Lab_FLT,
      LittleCMS.INTENT_RELATIVE_COLORIMETRIC,
      DEFAULTS.useBPC ? LittleCMS.cmsFLAGS_BLACKPOINTCOMPENSATION : 0,
    );

    cleanupSteps.push(() => lcmsColorEngine.deleteTransform(lcmsRGBABRTransform));

    const jsceRGBABRTransform = new JSColorEngine.Transform({ ...jsceTransformDefaults });

    jsceRGBABRTransform.create(jsceRGBProfile, jsceLabProfile, JSColorEngine.eIntent.relative);
    // jsceRGBABRTransform.useBPC = DEFAULTS.useBPC;

    const lcmsRGBBARTransform = lcmsColorEngine.createTransform(
      lcmsLabProfile,
      LittleCMS.TYPE_Lab_FLT,
      lcmsRGBProfile,
      LittleCMS.TYPE_RGB_FLT,
      LittleCMS.INTENT_RELATIVE_COLORIMETRIC,
      DEFAULTS.useBPC ? LittleCMS.cmsFLAGS_BLACKPOINTCOMPENSATION : 0,
    );

    cleanupSteps.push(() => lcmsColorEngine.deleteTransform(lcmsRGBBARTransform));

    const jsceRGBBARTransform = new JSColorEngine.Transform({ ...jsceTransformDefaults });

    jsceRGBBARTransform.create(jsceLabProfile, jsceRGBProfile, JSColorEngine.eIntent.relative);
    // jsceRGBBARTransform.useBPC = DEFAULTS.useBPC;

    const lcmsCMYKABRTransform = lcmsColorEngine.createTransform(
      lcmsCMYKProfile,
      LittleCMS.TYPE_CMYK_FLT,
      lcmsLabProfile,
      LittleCMS.TYPE_Lab_FLT,
      LittleCMS.INTENT_RELATIVE_COLORIMETRIC,
      DEFAULTS.useBPC ? LittleCMS.cmsFLAGS_BLACKPOINTCOMPENSATION : 0,
    );

    cleanupSteps.push(() => lcmsColorEngine.deleteTransform(lcmsCMYKABRTransform));

    const jsceCMYKABRTransform = new JSColorEngine.Transform({ ...jsceTransformDefaults });

    jsceCMYKABRTransform.create(jsceCMYKProfile, jsceLabProfile, JSColorEngine.eIntent.relative);
    // jsceCMYKABRTransform.useBPC = DEFAULTS.useBPC;

    const lcmsCMYKBARTransform = lcmsColorEngine.createTransform(
      lcmsLabProfile,
      LittleCMS.TYPE_Lab_FLT,
      lcmsCMYKProfile,
      LittleCMS.TYPE_CMYK_FLT,
      LittleCMS.INTENT_RELATIVE_COLORIMETRIC,
      DEFAULTS.useBPC ? LittleCMS.cmsFLAGS_BLACKPOINTCOMPENSATION : 0,
    );

    cleanupSteps.push(() => lcmsColorEngine.deleteTransform(lcmsCMYKBARTransform));

    const jsceCMYKBARTransform = new JSColorEngine.Transform({ ...jsceTransformDefaults });

    jsceCMYKBARTransform.create(jsceLabProfile, jsceCMYKProfile, JSColorEngine.eIntent.relative);
    // jsceCMYKBARTransform.useBPC = DEFAULTS.useBPC;

    /** @type {Record<string, Exclude<any, Object | Function>>} */
    const colorTable = {};

    /** @param {Float32Array} labF32 */
    const labF32ToLab = (labF32) => [labF32[0], labF32[1], labF32[2]];

    /** @param {number[]} lab */
    const labToLabF32 = (lab) => new Float32Array([lab[0], lab[1], lab[2]]);

    /** @param {number} l @param {number} a @param {number} b */
    const labD50Color = (l, a, b) => JSColorEngine.convert.Lab(l, a, b);

    /** @param {Float32Array} labF32 */
    const labF32ToLabColor = (labF32) => labD50Color(.../** @type {[number, number, number]} */(labF32ToLab(labF32)));

    for (const grayScalar of [0, 0.025, 0.05, 0.1, 0.25, 0.5, 0.75, 0.9, 0.95, 0.975, 1.0]) {
      const grayPercent = grayScalar * 100;
      const grayF32 = grayScalar;

      const kScalar = 1 - grayScalar;
      const kPercent = kScalar * 100;
      const kF32 = kScalar;

      const cmykABRAF32 = Float32Array.from([0, 0, 0, kF32]);

      const lcmsCMYKABRBF32 = new Float32Array(3);
      lcmsColorEngine.doTransform(lcmsCMYKABRTransform, cmykABRAF32, lcmsCMYKABRBF32, 1);
      const lcmsCMYKABRBLab = labF32ToLabColor(lcmsCMYKABRBF32);

      const jsceCMYKABRBF32 = jsceCMYKABRTransform.forward(cmykABRAF32);
      const jsceCMYKABRBLab = labF32ToLabColor(jsceCMYKABRBF32);

      const rgbBARBF32 = Float32Array.from(lcmsCMYKABRBF32);
      const rgbBARBLab = labF32ToLabColor(rgbBARBF32);

      const lcmsRGBBBARAF32 = new Float32Array(3);
      lcmsColorEngine.doTransform(lcmsRGBBARTransform, rgbBARBF32, lcmsRGBBBARAF32, 1);

      const jsceRGBBBARAF32 = Float32Array.from(/** @type {[number, number, number]} */(jsceRGBBARTransform.forward(rgbBARBLab)));

      const cmykABRBF32 = Float32Array.from(lcmsCMYKABRBF32);
      const cmykABRBLab = labF32ToLabColor(cmykABRBF32);

      const lcmsCMYKBARAF32 = new Float32Array(4);
      lcmsColorEngine.doTransform(lcmsCMYKBARTransform, cmykABRBF32, lcmsCMYKBARAF32, 1);

      const jsceCMYKBARAF32 = Float32Array.from(/** @type {[number, number, number, number]} */(jsceCMYKBARTransform.forward(cmykABRBLab)));

      // console.dir({
      //   cmykABRAF32,
      //   lcmsCMYKABRBF32,
      //   lcmsCMYKABRBLab,
      //   jsceCMYKABRBF32,
      //   jsceCMYKABRBLab,
      //   lcmsRGBBBARAF32,
      //   jsceRGBBBARAF32,
      // }, { compact: true });

      colorTable[`K ${kPercent.toFixed(1)}%`] = {
        'L:lc': Number(lcmsCMYKABRBLab.L.toFixed(1)),
        'L:js': Number(jsceCMYKABRBLab.L.toFixed(1)),
        'a:lc': Number(lcmsCMYKABRBLab.a.toFixed(1)),
        'a:js': Number(jsceCMYKABRBLab.a.toFixed(1)),
        'b:lc': Number(lcmsCMYKABRBLab.b.toFixed(1)),
        'b:js': Number(jsceCMYKABRBLab.b.toFixed(1)),
        'R:lc': Number(lcmsRGBBBARAF32[0].toFixed(3)),
        'R:js': Number(jsceRGBBBARAF32[0].toFixed(3)),
        'G:lc': Number(lcmsRGBBBARAF32[1].toFixed(3)),
        'G:js': Number(jsceRGBBBARAF32[1].toFixed(3)),
        'B:lc': Number(lcmsRGBBBARAF32[2].toFixed(3)),
        'B:js': Number(jsceRGBBBARAF32[2].toFixed(3)),
        'C:lc': Number(lcmsCMYKBARAF32[0].toFixed(3)),
        'C:js': Number(jsceCMYKBARAF32[0].toFixed(3)),
        'M:lc': Number(lcmsCMYKBARAF32[1].toFixed(3)),
        'M:js': Number(jsceCMYKBARAF32[1].toFixed(3)),
        'Y:lc': Number(lcmsCMYKBARAF32[2].toFixed(3)),
        'Y:js': Number(jsceCMYKBARAF32[2].toFixed(3)),
        'K:lc': Number(lcmsCMYKBARAF32[3].toFixed(3)),
        'K:js': Number(jsceCMYKBARAF32[3].toFixed(3)),
      };
    }

    console.table(colorTable);

  } finally {
    for (const cleanupStep of cleanupSteps) cleanupStep();
  }
}

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  // Optional: Log the full stack trace if the reason is an Error object
  if (reason instanceof Error) {
    console.error(reason.stack);
  }
  // Optional: Perform graceful shutdown or other error handling
});

async function main() {
  console.log('\n🔬 Comprehensive K-Only Diagnostic');

  for (const profileName of PROFILES) {
    await analyzeProfile(profileName);
  }
}

main()
  // .catch(console.error)
  ;
