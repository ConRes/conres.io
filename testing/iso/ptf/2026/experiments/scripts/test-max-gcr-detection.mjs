#!/usr/bin/env node
/**
 * Test script for Max GCR profile detection — comparing two methods:
 *
 * Method 1 (current): Lab → CMYK with Relative Colorimetric + BPC,
 *   check if CMY channels are below threshold.
 *
 * Method 2 (alternative): Compare Lab → CMYK results between
 *   Relative Colorimetric + BPC and K-Only GCR + BPC.
 *   If results are nearly identical, the profile has Max GCR built in
 *   (the K-Only intent adds nothing the profile doesn't already do).
 *
 * Usage: node testing/iso/ptf/2026/experiments/scripts/test-max-gcr-detection.mjs
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = new URL('../../', import.meta.url);

const policyURL = new URL('classes/configurations/assembly-policy.json', root);
const policy = JSON.parse(await readFile(fileURLToPath(policyURL), 'utf-8'));
const { labTestPoints, cmyThresholdPercent } = policy.maxGCRTest;

const { ColorEngineProvider } = await import(
    fileURLToPath(new URL('classes/baseline/color-engine-provider.js', root))
);
const { ICCService } = await import(
    fileURLToPath(new URL('services/ICCService.js', root))
);

const profiles = [
    { path: `${process.env.HOME}/Downloads/SWOP (Coated) Maximum GCR.icc`,        expected: 'CMYK-MaxGCR' },
    { path: `${process.env.HOME}/Downloads/Eurostandard (Coated) Maximum GCR.icc`, expected: 'CMYK-MaxGCR' },
    { path: `${process.env.HOME}/Downloads/FOGRA39 (Coated) Maximum GCR.icc`,      expected: 'CMYK-MaxGCR' },
    { path: `${process.env.HOME}/Downloads/eciCMYK v2.icc`,                        expected: 'CMYK' },
];

console.log('Max GCR Detection — Method Comparison (Float32)');
console.log('================================================');
console.log(`Lab test points: ${labTestPoints.length}, CMY threshold: ${cmyThresholdPercent}%\n`);

const provider = new ColorEngineProvider();
await provider.initialize();
const constants = provider.getConstants();

for (const { path, expected } of profiles) {
    let buffer;
    try {
        buffer = (await readFile(path)).buffer;
    } catch {
        console.log(`SKIP: ${path} (not found)\n`);
        continue;
    }

    const header = ICCService.parseICCHeaderFromSource(buffer);
    const name = path.split('/').pop();
    console.log(`Profile: ${name}  (${header.description})`);

    if (header.colorSpace !== 'CMYK') {
        console.log(`  Skipped (${header.colorSpace})\n`);
        continue;
    }

    const labProfile = provider.createLab4Profile();
    const cmykProfile = provider.openProfileFromMem(buffer);

    const bpcFlag = constants.cmsFLAGS_BLACKPOINTCOMPENSATION;

    // Transform A: Relative Colorimetric + BPC
    const transformRelative = provider.createTransform(
        labProfile, constants.TYPE_Lab_FLT,
        cmykProfile, constants.TYPE_CMYK_FLT,
        constants.INTENT_RELATIVE_COLORIMETRIC, bpcFlag,
    );

    // Transform B: K-Only GCR + BPC
    let transformKOnly = null;
    let kOnlyError = null;
    try {
        transformKOnly = provider.createTransform(
            labProfile, constants.TYPE_Lab_FLT,
            cmykProfile, constants.TYPE_CMYK_FLT,
            constants.INTENT_PRESERVE_K_ONLY_RELATIVE_COLORIMETRIC_GCR, bpcFlag,
        );
    } catch (error) {
        kOnlyError = error;
    }

    const inputBuffer = new Float32Array(3);
    const outputRelative = new Float32Array(4);
    const outputKOnly = new Float32Array(4);

    let method1MaxGCR = true;
    let method2MaxGCR = true;
    let method2MaxDelta = 0;

    console.log(`  ${'Lab'.padEnd(16)} ${'Relative Colorimetric'.padEnd(42)} ${'K-Only GCR'.padEnd(42)} ${'Delta'.padEnd(20)}`);
    console.log(`  ${'─'.repeat(16)} ${'─'.repeat(42)} ${'─'.repeat(42)} ${'─'.repeat(20)}`);

    for (const [L, a, b] of labTestPoints) {
        inputBuffer[0] = L;
        inputBuffer[1] = a;
        inputBuffer[2] = b;

        // Relative Colorimetric
        provider.transformArray(transformRelative, inputBuffer, outputRelative, 1);
        const [rC, rM, rY, rK] = outputRelative;

        // Method 1: CMY threshold check
        if (rC > cmyThresholdPercent || rM > cmyThresholdPercent || rY > cmyThresholdPercent) {
            method1MaxGCR = false;
        }

        // K-Only GCR
        let kC = NaN, kM = NaN, kY = NaN, kK = NaN;
        let deltaC = NaN, deltaM = NaN, deltaY = NaN, deltaK = NaN;
        let maxDelta = NaN;

        if (transformKOnly) {
            provider.transformArray(transformKOnly, inputBuffer, outputKOnly, 1);
            [kC, kM, kY, kK] = outputKOnly;

            // Method 2: compare per-channel deltas
            deltaC = Math.abs(rC - kC);
            deltaM = Math.abs(rM - kM);
            deltaY = Math.abs(rY - kY);
            deltaK = Math.abs(rK - kK);
            maxDelta = Math.max(deltaC, deltaM, deltaY, deltaK);
            method2MaxDelta = Math.max(method2MaxDelta, maxDelta);

            // If any channel differs by more than 0.5%, intents disagree
            if (maxDelta > 0.5) method2MaxGCR = false;
        } else {
            method2MaxGCR = false;
        }

        const relStr = `C=${rC.toFixed(2)} M=${rM.toFixed(2)} Y=${rY.toFixed(2)} K=${rK.toFixed(2)}`;
        const kOnlyStr = transformKOnly
            ? `C=${kC.toFixed(2)} M=${kM.toFixed(2)} Y=${kY.toFixed(2)} K=${kK.toFixed(2)}`
            : '(transform failed)';
        const deltaStr = transformKOnly ? `max=${maxDelta.toFixed(4)}` : 'N/A';

        console.log(`  Lab(${String(L).padStart(3)},0,0)  ${relStr.padEnd(42)} ${kOnlyStr.padEnd(42)} ${deltaStr}`);
    }

    provider.deleteTransform(transformRelative);
    if (transformKOnly) provider.deleteTransform(transformKOnly);
    provider.closeProfile(labProfile);
    provider.closeProfile(cmykProfile);

    if (kOnlyError) {
        console.log(`  K-Only GCR transform error: ${kOnlyError}`);
    }

    const cat1 = method1MaxGCR ? 'CMYK-MaxGCR' : 'CMYK';
    const cat2 = method2MaxGCR ? 'CMYK-MaxGCR' : 'CMYK';

    console.log();
    console.log(`  Method 1 (CMY < ${cmyThresholdPercent}%):       ${cat1}  ${cat1 === expected ? '✅' : '❌'}`);
    console.log(`  Method 2 (intent comparison): ${cat2}  (max delta: ${method2MaxDelta.toFixed(4)}%)  ${cat2 === expected ? '✅' : '❌'}`);
    console.log(`  Expected:                     ${expected}`);
    console.log();
}

console.log('Done.');
