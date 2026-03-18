#!/usr/bin/env node
// @ts-check
/**
 * Compare Worker vs Main Thread Color Conversion
 *
 * Phase 11.1: Systematic comparison of specific input values through
 * both main thread and worker code paths to identify discrepancies.
 *
 * Purpose: Verify the hypothesis that Gray values are being handled
 * differently between main thread (ColorEngineService with Gray→RGB expansion)
 * and worker (ColorConversionUtils without expansion).
 *
 * TODO: This script has MAGIC PATH RESOLUTION that needs normalization.
 * Run from: testing/iso/ptf/2025/experiments/
 */

// =============================================================================
// AGENT RESTRICTIONS - READ BEFORE MODIFYING
// =============================================================================
//
// TODO: This script needs path normalization to be CWD-relative.
// Currently uses WORKSPACE_ROOT derived from __dirname which is MAGIC.
//
// DO NOT add more magic path resolution patterns.
// If you actively use this script, normalize it first.
//
// =============================================================================

import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import fs from 'fs/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const WORKSPACE_ROOT = resolve(__dirname, '../../../../../..');
const TEMP_DIR = resolve(WORKSPACE_ROOT, '.temp');

// Test input arrays per Phase 11.1 plan
const TEST_INPUTS = {
    gray: [0, 0.25, 0.5, 0.75, 1.0],
    rgb: [
        [0, 0, 0],       // Black
        [0.5, 0.5, 0.5], // 50% gray
        [1, 1, 1],       // White
        [1, 0, 0],       // Red
        [0, 1, 0],       // Green
        [0, 0, 1],       // Blue
    ],
    lab: [
        [0, 0, 0],      // Black
        [50, 0, 0],     // 50% neutral
        [100, 0, 0],    // White
        [50, 50, 0],    // Chromatic (green-ish)
        [50, -50, 0],   // Chromatic (magenta-ish)
    ],
};

// Paths
const SERVICES_PATH = resolve(WORKSPACE_ROOT, 'testing/iso/ptf/2025/services');
const PROFILE_PATH = resolve(WORKSPACE_ROOT, 'testing/iso/ptf/fixtures/profiles/eciCMYK v2.icc');

async function main() {
    console.log('='.repeat(80));
    console.log('COMPARE WORKER VS MAIN THREAD COLOR CONVERSION');
    console.log('='.repeat(80));
    console.log(`Workspace: ${WORKSPACE_ROOT}`);
    console.log(`Output: ${TEMP_DIR}/worker-comparison.txt`);
    console.log();

    // Ensure temp directory exists
    await fs.mkdir(TEMP_DIR, { recursive: true });

    // Load color engine
    const LittleCMS = await import(resolve(WORKSPACE_ROOT, 'testing/iso/ptf/2025/packages/color-engine/src/index.js'));
    const colorEngine = await LittleCMS.createEngine();

    // Load ColorConversionUtils (worker path)
    const ColorConversionUtils = await import(resolve(SERVICES_PATH, 'ColorConversionUtils.js'));

    // Load destination profile
    const profileBuffer = await fs.readFile(PROFILE_PATH);
    const destProfile = colorEngine.openProfileFromMem(new Uint8Array(profileBuffer));

    // Constants from ColorConversionUtils
    const {
        PIXEL_FORMATS,
        RENDERING_INTENTS,
        ENGINE_FLAGS,
        pdfGrayToEngine,
        pdfRGBToEngine,
        pdfLabToEngine,
        engineCMYKToPDF,
    } = ColorConversionUtils;

    // Results storage
    const results = {
        timestamp: new Date().toISOString(),
        gray: [],
        rgb: [],
        lab: [],
    };

    console.log('='.repeat(80));
    console.log('TEST 1: GRAY VALUES');
    console.log('='.repeat(80));
    console.log();
    console.log('Hypothesis: Main thread expands Gray→RGB (R=G=B) for K-Only GCR,');
    console.log('            but worker uses Gray directly with TYPE_GRAY_8.');
    console.log();

    // Create profiles for comparison
    const sRGBProfile = colorEngine.createSRGBProfile();
    const sGrayProfile = colorEngine.createGray2Profile();

    // K-Only GCR intent
    const kOnlyIntent = RENDERING_INTENTS.PRESERVE_K_ONLY_RELATIVE_COLORIMETRIC_GCR;
    const flags = ENGINE_FLAGS.BLACKPOINT_COMPENSATION;

    console.log('--- Main Thread Path (Gray→RGB expansion) ---');
    console.log('Uses: sRGB profile, TYPE_RGB_8, Gray value replicated to R=G=B');
    console.log();

    // Create main thread transform (sRGB → CMYK with K-Only GCR)
    const mainTransform = colorEngine.createTransform(
        sRGBProfile,
        PIXEL_FORMATS.TYPE_RGB_8,
        destProfile,
        PIXEL_FORMATS.TYPE_CMYK_8,
        kOnlyIntent,
        flags
    );

    for (const grayValue of TEST_INPUTS.gray) {
        // Main thread path: expand gray to RGB (R=G=B)
        const grayAs255 = Math.round(grayValue * 255);
        const mainInput = new Uint8Array([grayAs255, grayAs255, grayAs255]);
        const mainOutput = new Uint8Array(4);

        colorEngine.transformArray(mainTransform, mainInput, mainOutput, 1);
        const mainCMYK = engineCMYKToPDF(Array.from(mainOutput));

        console.log(`Gray ${grayValue.toFixed(2)} → RGB [${grayAs255}, ${grayAs255}, ${grayAs255}]`);
        console.log(`  Main thread: CMYK [${mainCMYK.map(v => v.toFixed(4)).join(', ')}]`);

        results.gray.push({
            input: grayValue,
            mainThread: {
                method: 'Gray→RGB expansion, sRGB→CMYK',
                rgbInput: [grayAs255, grayAs255, grayAs255],
                cmykOutput: mainCMYK,
            },
        });
    }

    colorEngine.deleteTransform(mainTransform);

    console.log();
    console.log('--- Worker Path (Direct Gray) ---');
    console.log('Uses: createGray2Profile(), TYPE_GRAY_8, single gray channel');
    console.log();

    // Create worker transform (Gray → CMYK with K-Only GCR)
    const workerTransform = colorEngine.createTransform(
        sGrayProfile,
        PIXEL_FORMATS.TYPE_GRAY_8,
        destProfile,
        PIXEL_FORMATS.TYPE_CMYK_8,
        kOnlyIntent,
        flags
    );

    for (let i = 0; i < TEST_INPUTS.gray.length; i++) {
        const grayValue = TEST_INPUTS.gray[i];

        // Worker path: use pdfGrayToEngine (just scales to 255)
        const workerInput = new Uint8Array(pdfGrayToEngine([grayValue]));
        const workerOutput = new Uint8Array(4);

        colorEngine.transformArray(workerTransform, workerInput, workerOutput, 1);
        const workerCMYK = engineCMYKToPDF(Array.from(workerOutput));

        console.log(`Gray ${grayValue.toFixed(2)} → [${workerInput[0]}]`);
        console.log(`  Worker:      CMYK [${workerCMYK.map(v => v.toFixed(4)).join(', ')}]`);

        results.gray[i].workerThread = {
            method: 'Direct Gray, createGray2Profile()→CMYK',
            grayInput: [workerInput[0]],
            cmykOutput: workerCMYK,
        };

        // Compare
        const mainCMYK = results.gray[i].mainThread.cmykOutput;
        const match = mainCMYK.every((v, j) => Math.abs(v - workerCMYK[j]) < 0.01);
        results.gray[i].match = match;

        if (!match) {
            console.log(`  ** MISMATCH! Main: [${mainCMYK.map(v => v.toFixed(4)).join(', ')}]`);
        }
    }

    colorEngine.deleteTransform(workerTransform);

    console.log();
    console.log('--- Fixed Worker Path (Multiprofile Transform) ---');
    console.log('Uses: createMultiprofileTransform([Gray, sRGB, CMYK], TYPE_GRAY_8, TYPE_CMYK_8)');
    console.log();

    // Create FIXED multiprofile transform (Gray → sRGB → CMYK with K-Only GCR)
    if (colorEngine.createMultiprofileTransform) {
        const fixedTransform = colorEngine.createMultiprofileTransform(
            [sGrayProfile, sRGBProfile, destProfile],
            PIXEL_FORMATS.TYPE_GRAY_8,
            PIXEL_FORMATS.TYPE_CMYK_8,
            kOnlyIntent,
            flags
        );

        for (let i = 0; i < TEST_INPUTS.gray.length; i++) {
            const grayValue = TEST_INPUTS.gray[i];

            // Same input as broken path
            const fixedInput = new Uint8Array(pdfGrayToEngine([grayValue]));
            const fixedOutput = new Uint8Array(4);

            colorEngine.transformArray(fixedTransform, fixedInput, fixedOutput, 1);
            const fixedCMYK = engineCMYKToPDF(Array.from(fixedOutput));

            console.log(`Gray ${grayValue.toFixed(2)} → [${fixedInput[0]}]`);
            console.log(`  Fixed:       CMYK [${fixedCMYK.map(v => v.toFixed(4)).join(', ')}]`);

            results.gray[i].fixedWorker = {
                method: 'Multiprofile [Gray, sRGB, CMYK]',
                grayInput: [fixedInput[0]],
                cmykOutput: fixedCMYK,
            };

            // Compare fixed to main thread
            const mainCMYK = results.gray[i].mainThread.cmykOutput;
            const fixedMatch = mainCMYK.every((v, j) => Math.abs(v - fixedCMYK[j]) < 0.01);
            results.gray[i].fixedMatch = fixedMatch;

            if (fixedMatch) {
                console.log(`  ✓ MATCHES main thread!`);
            } else {
                console.log(`  ** STILL MISMATCH! Main: [${mainCMYK.map(v => v.toFixed(4)).join(', ')}]`);
            }
        }

        colorEngine.deleteTransform(fixedTransform);
    } else {
        console.log('createMultiprofileTransform not available in this engine version');
    }

    console.log();
    console.log('='.repeat(80));
    console.log('TEST 2: RGB VALUES');
    console.log('='.repeat(80));
    console.log();

    // RGB transform (same for both - no special handling needed)
    const rgbTransform = colorEngine.createTransform(
        sRGBProfile,
        PIXEL_FORMATS.TYPE_RGB_8,
        destProfile,
        PIXEL_FORMATS.TYPE_CMYK_8,
        kOnlyIntent,
        flags
    );

    for (const [r, g, b] of TEST_INPUTS.rgb) {
        const rgb255 = pdfRGBToEngine([r, g, b]);
        const rgbInput = new Uint8Array(rgb255);
        const rgbOutput = new Uint8Array(4);

        colorEngine.transformArray(rgbTransform, rgbInput, rgbOutput, 1);
        const cmyk = engineCMYKToPDF(Array.from(rgbOutput));

        console.log(`RGB [${r}, ${g}, ${b}] → [${rgb255.join(', ')}]`);
        console.log(`  CMYK: [${cmyk.map(v => v.toFixed(4)).join(', ')}]`);

        results.rgb.push({
            input: [r, g, b],
            rgb255: rgb255,
            cmykOutput: cmyk,
        });
    }

    colorEngine.deleteTransform(rgbTransform);

    console.log();
    console.log('='.repeat(80));
    console.log('TEST 3: LAB VALUES');
    console.log('='.repeat(80));
    console.log();

    const labProfile = colorEngine.createLab4Profile(0);

    // Lab uses Relative Colorimetric + BPC (not K-Only GCR)
    const labTransform = colorEngine.createTransform(
        labProfile,
        PIXEL_FORMATS.TYPE_Lab_8,
        destProfile,
        PIXEL_FORMATS.TYPE_CMYK_8,
        RENDERING_INTENTS.RELATIVE_COLORIMETRIC,
        flags
    );

    for (const [L, a, b] of TEST_INPUTS.lab) {
        const lab8bit = pdfLabToEngine([L, a, b]);
        const labInput = new Uint8Array(lab8bit);
        const labOutput = new Uint8Array(4);

        colorEngine.transformArray(labTransform, labInput, labOutput, 1);
        const cmyk = engineCMYKToPDF(Array.from(labOutput));

        console.log(`Lab [${L}, ${a}, ${b}] → 8-bit [${lab8bit.join(', ')}]`);
        console.log(`  CMYK: [${cmyk.map(v => v.toFixed(4)).join(', ')}]`);

        results.lab.push({
            input: [L, a, b],
            lab8bit: lab8bit,
            cmykOutput: cmyk,
        });
    }

    colorEngine.deleteTransform(labTransform);
    colorEngine.closeProfile(labProfile);

    // Cleanup
    colorEngine.closeProfile(sRGBProfile);
    colorEngine.closeProfile(sGrayProfile);
    colorEngine.closeProfile(destProfile);

    console.log();
    console.log('='.repeat(80));
    console.log('SUMMARY');
    console.log('='.repeat(80));
    console.log();

    // Count mismatches
    const grayMismatches = results.gray.filter(r => !r.match).length;
    const grayFixedMatches = results.gray.filter(r => r.fixedMatch).length;

    console.log(`Gray conversions: ${results.gray.length} total`);
    console.log(`  Broken path (createTransform): ${grayMismatches} mismatches`);
    console.log(`  Fixed path (createMultiprofileTransform): ${grayFixedMatches}/${results.gray.length} matches`);
    console.log(`RGB conversions: ${results.rgb.length} total (reference only)`);
    console.log(`Lab conversions: ${results.lab.length} total (reference only)`);
    console.log();

    if (grayFixedMatches === results.gray.length) {
        console.log('✅ FIX VERIFIED: createMultiprofileTransform produces correct K-Only output!');
        console.log();
        console.log('The multiprofile transform [Gray → sRGB → CMYK] correctly routes');
        console.log('gray values through sRGB before applying K-Only GCR intent.');
    } else if (grayMismatches > 0) {
        console.log('FINDING: Gray conversion differs between main thread and worker!');
        console.log();
        console.log('Root cause:');
        console.log('  - Main thread: Expands Gray→RGB (R=G=B), uses sRGB profile');
        console.log('  - Worker: Uses Gray directly with createGray2Profile()');
        console.log();
        console.log('K-Only GCR is designed for RGB input (neutrals become K-only).');
        console.log('Direct Gray→CMYK does not produce the same K-only output.');
        console.log();
        console.log('Fix: Use createMultiprofileTransform([Gray, sRGB, CMYK], ...) for K-Only GCR');
    } else {
        console.log('All gray conversions match!');
    }

    // Save results to temp file
    const outputPath = resolve(TEMP_DIR, 'worker-comparison.txt');
    const outputJson = resolve(TEMP_DIR, 'worker-comparison.json');

    // Generate text report
    let report = `WORKER VS MAIN THREAD COLOR CONVERSION COMPARISON\n`;
    report += `Generated: ${results.timestamp}\n`;
    report += `${'='.repeat(60)}\n\n`;

    report += `GRAY CONVERSIONS (${grayMismatches} mismatches)\n`;
    report += `${'─'.repeat(60)}\n`;
    for (const r of results.gray) {
        report += `Input: ${r.input.toFixed(2)}\n`;
        report += `  Main: CMYK [${r.mainThread.cmykOutput.map(v => v.toFixed(4)).join(', ')}]\n`;
        report += `  Worker: CMYK [${r.workerThread.cmykOutput.map(v => v.toFixed(4)).join(', ')}]\n`;
        report += `  Match: ${r.match ? 'YES' : 'NO'}\n\n`;
    }

    report += `\nRGB CONVERSIONS (reference)\n`;
    report += `${'─'.repeat(60)}\n`;
    for (const r of results.rgb) {
        report += `Input: [${r.input.join(', ')}] → CMYK [${r.cmykOutput.map(v => v.toFixed(4)).join(', ')}]\n`;
    }

    report += `\nLAB CONVERSIONS (reference)\n`;
    report += `${'─'.repeat(60)}\n`;
    for (const r of results.lab) {
        report += `Input: [${r.input.join(', ')}] → CMYK [${r.cmykOutput.map(v => v.toFixed(4)).join(', ')}]\n`;
    }

    await fs.writeFile(outputPath, report);
    await fs.writeFile(outputJson, JSON.stringify(results, null, 2));

    console.log();
    console.log(`Results saved to:`);
    console.log(`  ${outputPath}`);
    console.log(`  ${outputJson}`);
    console.log();
    console.log('='.repeat(80));
}

main().catch(err => {
    console.error('Error:', err);
    process.exit(1);
});
