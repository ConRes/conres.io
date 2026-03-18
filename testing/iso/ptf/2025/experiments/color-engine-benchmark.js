#!/usr/bin/env node

/**
 * Quick Performance Benchmark
 * Simple, fast comparison of WASM vs js-color-engine
 */

import { readFile } from 'fs/promises';
import { performance } from 'perf_hooks';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

import * as LittleCMS from '../packages/color-engine/src/index.js';
import * as JSColorEngine from '../packages/js-color-engine/src/main.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROFILE_PATH = '../tests/fixtures/profiles/eciCMYK v2.icc';

const jsTransformDefaults = {
    promoteGrayToCMYKBlack: true,
    buildLUT: true,
    useLegacy: false,
    BPC: true,
    // pipelineDebug: true,
    // verbose: true,
    dataFormat: 'int8',
};

const littleCMSTransformFlags = jsTransformDefaults.BPC ? LittleCMS.cmsFLAGS_BLACKPOINTCOMPENSATION : 0;

async function main() {
  console.log('\n🚀 Quick Performance Benchmark\n');
  console.log('═'.repeat(80));

  const profilePath = join(__dirname, PROFILE_PATH);
  const profileBuffer = await readFile(profilePath);

  // Test Pure Black accuracy
  console.log('\n📊 Accuracy Test: Pure Black → K=100\n');

  // WASM
  const engine = await LittleCMS.createEngine();
  const srgb = engine.createSRGBProfile();
  const cmyk = engine.openProfileFromMem(new Uint8Array(profileBuffer));
  const transform = engine.createTransform(
    srgb, LittleCMS.TYPE_RGB_8,
    cmyk, LittleCMS.TYPE_CMYK_8,
    LittleCMS.INTENT_PRESERVE_K_ONLY_RELATIVE_COLORIMETRIC_GCR,
    littleCMSTransformFlags
  );

  const input = new Uint8Array([0, 0, 0]);
  const output = new Uint8Array(4);
  engine.doTransform(transform, input, output, 1);
  const wasmK = Math.round(output[3] / 255 * 100);

  console.log(`  WASM:             K=${wasmK}% ${wasmK === 100 ? '✅' : '❌'}`);

  engine.deleteTransform(transform);
  engine.closeProfile(cmyk);
  engine.closeProfile(srgb);

  // js-color-engine
  const jsInput = new JSColorEngine.Profile('*sRGB');
  const jsOutput = new JSColorEngine.Profile();
  jsOutput.loadBinary(profileBuffer);
  const jsTransform = new JSColorEngine.Transform({ ... jsTransformDefaults });
  jsTransform.create(jsInput, jsOutput, JSColorEngine.eIntent.relative);

  const jsResult = jsTransform.transformArrayViaLUT(new Uint8Array([0, 0, 0]));
  const jsK = Math.round(jsResult[3] / 255 * 100);
  console.log(`  js-color-engine:  K=${jsK}% ${jsK === 100 ? '✅' : '❌'}`);

  // Performance test
  console.log('\n⚡ Performance Test: 10,000 pixels\n');

  // const testPixels = 200000;
  const testPixels = 2880 * 2880; // ~8.3MP
  const iterations = 10;
  const warmupIterations = 2;
  const uniqueInputCount = 3;
  const inputPixels = Array.from({ length: uniqueInputCount }, () => new Uint8Array(testPixels * 3));

  console.log(`  Test size:        ${testPixels.toLocaleString()} pixels`);
  console.log(`  Iterations:       ${iterations}\n`);

  for (let i = 0; i < inputPixels.length; i++)
    for (let j = 0; j < testPixels * 3; j++)
      inputPixels[i][j] = Math.floor(Math.random() * 256);

  console.log(`  Unique inputs:    ${uniqueInputCount}\n`);

  // WASM Performance
  const engine2 = await LittleCMS.createEngine();
  const srgb2 = engine2.createSRGBProfile();
  const cmyk2 = engine2.openProfileFromMem(new Uint8Array(profileBuffer));
  const transform2 = engine2.createTransform(
    srgb2, LittleCMS.TYPE_RGB_8,
    cmyk2, LittleCMS.TYPE_CMYK_8,
    LittleCMS.INTENT_PRESERVE_K_ONLY_RELATIVE_COLORIMETRIC_GCR,
    littleCMSTransformFlags
  );
  const outputPixels = new Uint8Array(testPixels * 4);

  // Warmup
  for (let n = 0; n < warmupIterations; n++)
    for (let i = 0; i < uniqueInputCount; i++)
      engine2.doTransform(transform2, inputPixels[i], outputPixels, testPixels);

  const wasmStart = performance.now();

  for (let i = 0; i < iterations; i++)
    engine2.doTransform(transform2, inputPixels[i % uniqueInputCount], outputPixels, testPixels);

  const wasmTime = performance.now() - wasmStart;
  const wasmThroughput = (testPixels * iterations) / (wasmTime / 1000);

  engine2.deleteTransform(transform2);
  engine2.closeProfile(cmyk2);
  engine2.closeProfile(srgb2);

  console.log(`  WASM (direct):    ${(wasmThroughput / 1000000).toFixed(2)}M px/s`);
  console.log(`                    ${(wasmTime / iterations).toFixed(2)}ms per ${testPixels.toLocaleString()} pixels`);

  // js-color-engine Performance (with LUT)
  const jsInput2 = new JSColorEngine.Profile('*sRGB');
  const jsOutput2 = new JSColorEngine.Profile();
  jsOutput2.loadBinary(profileBuffer);
  const jsTransform2 = new JSColorEngine.Transform({
    ... jsTransformDefaults,
  });
  jsTransform2.create(jsInput2, jsOutput2, JSColorEngine.eIntent.relative);

  // Warmup
  for (let n = 0; n < warmupIterations; n++)
    for (let i = 0; i < uniqueInputCount; i++)
      jsTransform2.transformArrayViaLUT(inputPixels[i]);

  const jsStart = performance.now();
  for (let i = 0; i < iterations; i++)
    jsTransform2.transformArrayViaLUT(inputPixels[i % uniqueInputCount]);

  const jsTime = performance.now() - jsStart;
  const jsThroughput = (testPixels * iterations) / (jsTime / 1000);

  console.log(`  js-color-engine:  ${(jsThroughput / 1000000).toFixed(2)}M px/s`);
  console.log(`                    ${(jsTime / iterations).toFixed(2)}ms per ${testPixels.toLocaleString()} pixels`);

  // Comparison
  console.log('\n📈 Comparison:\n');
  const speedup = wasmThroughput / jsThroughput;
  console.log(`  Speedup:          ${speedup.toFixed(2)}×`);

  if (speedup > 1.5) {
    console.log(`  Verdict:          🎯 js-color-engine is ${speedup.toFixed(1)}× FASTER`);
    console.log(`  Gap to close:     WASM needs ${speedup.toFixed(1)}× improvement`);
  } else if (speedup < 0.7) {
    console.log(`  Verdict:          🚀 WASM is ${(1 / speedup).toFixed(1)}× FASTER`);
  } else {
    console.log(`  Verdict:          ⚖️  Similar performance`);
  }

  console.log('\n' + '═'.repeat(80));
  console.log('\n✅ Quick benchmark complete!\n');
}

main().catch(console.error);
