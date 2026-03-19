#!/usr/bin/env node
/**
 * Comprehensive Implementation Verification Script
 *
 * Generates and compares:
 * - Legacy Main Thread (CMYK + RGB profiles)
 * - Refactored Main Thread (CMYK + RGB profiles)
 * - Refactored Worker (CMYK + RGB profiles)
 *
 * Runs compare-pdf-color.js on all legacy vs refactored pairs.
 */

import { spawn } from 'child_process';
import { mkdir, readdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXPERIMENTS_DIR = join(__dirname, '..');
const FIXTURES_DIR = join(__dirname, '..', '..', 'tests', 'fixtures');
const OUTPUT_DIR = join(EXPERIMENTS_DIR, 'output');

// Configuration
const INPUT_PDF = join(FIXTURES_DIR, 'pdfs', '2025-08-15 - ConRes - ISO PTF - CR1 (F9d) Fixtures - F-01.pdf');
const PROFILES = {
    cmyk: {
        path: join(FIXTURES_DIR, 'profiles', 'eciCMYK v2.icc'),
        name: 'eciCMYK v2',
    },
    rgb: {
        path: join(FIXTURES_DIR, 'profiles', 'FIPS_WIDE_28T-TYPEavg.icc'),
        name: 'FIPS_WIDE RGB',
    },
};

/**
 * Run a command and return promise with result
 * @param {string} cmd
 * @param {string[]} args
 * @param {string} [cwd]
 * @returns {Promise<{code: number, stdout: string, stderr: string}>}
 */
function runCommand(cmd, args, cwd) {
    return new Promise((resolve) => {
        const proc = spawn(cmd, args, {
            cwd: cwd || EXPERIMENTS_DIR,
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        let stdout = '';
        let stderr = '';

        proc.stdout.on('data', (data) => { stdout += data; });
        proc.stderr.on('data', (data) => { stderr += data; });

        proc.on('close', (code) => {
            resolve({ code: code ?? 1, stdout, stderr });
        });
    });
}

/**
 * Get next output folder number
 * @returns {Promise<string>}
 */
async function getNextOutputFolder() {
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '-');
    const entries = await readdir(OUTPUT_DIR);
    const pattern = new RegExp(`^${today}-(\\d{3})`);

    let maxNum = 0;
    for (const entry of entries) {
        const match = entry.match(pattern);
        if (match) {
            maxNum = Math.max(maxNum, parseInt(match[1], 10));
        }
    }

    const nextNum = String(maxNum + 1).padStart(3, '0');
    return `${today}-${nextNum} - Verification`;
}

/**
 * Generate a PDF using convert-pdf-color.js
 * @param {object} options
 * @param {string} options.outputPath
 * @param {string} options.profilePath
 * @param {boolean} options.useLegacy
 * @param {boolean} options.useWorkers
 * @param {string} options.label
 */
async function generatePDF(options) {
    const { outputPath, profilePath, useLegacy, useWorkers, label } = options;

    const args = [
        join(EXPERIMENTS_DIR, 'convert-pdf-color.js'),
        INPUT_PDF,
        profilePath,
        outputPath,
        '--verbose',
    ];

    if (useLegacy) {
        args.push('--legacy');
    }
    if (!useWorkers) {
        args.push('--no-workers');
    }

    console.log(`\n>>> Generating: ${label}`);
    const startTime = Date.now();
    const result = await runCommand('node', args);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    if (result.code !== 0) {
        console.log(`  FAILED (${elapsed}s)`);
        console.log('  stderr:', result.stderr.slice(0, 500));
        return false;
    }

    console.log(`  OK (${elapsed}s)`);
    return true;
}

/**
 * Compare two PDFs using compare-pdf-color.js
 * @param {string} expectedPath
 * @param {string} actualPath
 * @param {string} label
 * @returns {Promise<{success: boolean, output: string}>}
 */
async function comparePDFs(expectedPath, actualPath, label) {
    const args = [
        join(EXPERIMENTS_DIR, 'compare-pdf-color.js'),
        expectedPath,
        actualPath,
        '--verbose',
        '--show-samples',
    ];

    console.log(`\n>>> Comparing: ${label}`);
    const result = await runCommand('node', args);

    // Exit code 0 = no significant differences, 1 = differences found
    const success = result.code === 0;
    console.log(`  Result: ${success ? 'NO SIGNIFICANT DIFFERENCES' : 'DIFFERENCES FOUND'}`);

    return { success, output: result.stdout };
}

// Main
async function main() {
    console.log('='.repeat(80));
    console.log('Implementation Verification');
    console.log('='.repeat(80));

    // Check input files exist
    if (!existsSync(INPUT_PDF)) {
        console.error(`Input PDF not found: ${INPUT_PDF}`);
        process.exit(1);
    }
    for (const [key, profile] of Object.entries(PROFILES)) {
        if (!existsSync(profile.path)) {
            console.error(`Profile not found (${key}): ${profile.path}`);
            process.exit(1);
        }
    }

    // Create output folder
    const folderName = await getNextOutputFolder();
    const outputFolder = join(OUTPUT_DIR, folderName);
    await mkdir(outputFolder, { recursive: true });
    console.log(`\nOutput folder: ${folderName}`);

    // Define all outputs to generate
    const outputs = {
        // Legacy Main Thread
        legacyCMYK: {
            path: join(outputFolder, 'Legacy - Main Thread - eciCMYK v2.pdf'),
            profileKey: 'cmyk',
            useLegacy: true,
            useWorkers: false,
            label: 'Legacy Main Thread (CMYK)',
        },
        legacyRGB: {
            path: join(outputFolder, 'Legacy - Main Thread - FIPS_WIDE RGB.pdf'),
            profileKey: 'rgb',
            useLegacy: true,
            useWorkers: false,
            label: 'Legacy Main Thread (RGB)',
        },
        // Refactored Main Thread
        refactoredMainCMYK: {
            path: join(outputFolder, 'Refactored - Main Thread - eciCMYK v2.pdf'),
            profileKey: 'cmyk',
            useLegacy: false,
            useWorkers: false,
            label: 'Refactored Main Thread (CMYK)',
        },
        refactoredMainRGB: {
            path: join(outputFolder, 'Refactored - Main Thread - FIPS_WIDE RGB.pdf'),
            profileKey: 'rgb',
            useLegacy: false,
            useWorkers: false,
            label: 'Refactored Main Thread (RGB)',
        },
        // Refactored Workers
        refactoredWorkersCMYK: {
            path: join(outputFolder, 'Refactored - Workers - eciCMYK v2.pdf'),
            profileKey: 'cmyk',
            useLegacy: false,
            useWorkers: true,
            label: 'Refactored Workers (CMYK)',
        },
        refactoredWorkersRGB: {
            path: join(outputFolder, 'Refactored - Workers - FIPS_WIDE RGB.pdf'),
            profileKey: 'rgb',
            useLegacy: false,
            useWorkers: true,
            label: 'Refactored Workers (RGB)',
        },
    };

    // Generate all outputs
    console.log('\n' + '-'.repeat(80));
    console.log('PHASE 1: Generating Outputs');
    console.log('-'.repeat(80));

    const generateResults = {};
    for (const [key, config] of Object.entries(outputs)) {
        const profile = PROFILES[config.profileKey];
        generateResults[key] = await generatePDF({
            outputPath: config.path,
            profilePath: profile.path,
            useLegacy: config.useLegacy,
            useWorkers: config.useWorkers,
            label: config.label,
        });
    }

    // Check all generated successfully
    const allGenerated = Object.values(generateResults).every(Boolean);
    if (!allGenerated) {
        console.log('\nSome outputs failed to generate. See errors above.');
    }

    // Compare all pairs
    console.log('\n' + '-'.repeat(80));
    console.log('PHASE 2: Comparing Outputs');
    console.log('-'.repeat(80));

    const comparisons = [
        // Legacy vs Refactored Main Thread
        {
            expected: outputs.legacyCMYK.path,
            actual: outputs.refactoredMainCMYK.path,
            label: 'Legacy vs Refactored Main Thread (CMYK)',
            logFile: join(outputFolder, 'comparison-legacy-vs-refactored-main-cmyk.log'),
        },
        {
            expected: outputs.legacyRGB.path,
            actual: outputs.refactoredMainRGB.path,
            label: 'Legacy vs Refactored Main Thread (RGB)',
            logFile: join(outputFolder, 'comparison-legacy-vs-refactored-main-rgb.log'),
        },
        // Legacy vs Refactored Workers
        {
            expected: outputs.legacyCMYK.path,
            actual: outputs.refactoredWorkersCMYK.path,
            label: 'Legacy vs Refactored Workers (CMYK)',
            logFile: join(outputFolder, 'comparison-legacy-vs-refactored-workers-cmyk.log'),
        },
        {
            expected: outputs.legacyRGB.path,
            actual: outputs.refactoredWorkersRGB.path,
            label: 'Legacy vs Refactored Workers (RGB)',
            logFile: join(outputFolder, 'comparison-legacy-vs-refactored-workers-rgb.log'),
        },
        // Refactored Main Thread vs Workers (sanity check)
        {
            expected: outputs.refactoredMainCMYK.path,
            actual: outputs.refactoredWorkersCMYK.path,
            label: 'Refactored Main Thread vs Workers (CMYK)',
            logFile: join(outputFolder, 'comparison-refactored-main-vs-workers-cmyk.log'),
        },
        {
            expected: outputs.refactoredMainRGB.path,
            actual: outputs.refactoredWorkersRGB.path,
            label: 'Refactored Main Thread vs Workers (RGB)',
            logFile: join(outputFolder, 'comparison-refactored-main-vs-workers-rgb.log'),
        },
    ];

    const comparisonResults = [];
    for (const comp of comparisons) {
        if (!existsSync(comp.expected) || !existsSync(comp.actual)) {
            console.log(`\n>>> Skipping: ${comp.label} (missing files)`);
            comparisonResults.push({ label: comp.label, success: null, reason: 'missing files' });
            continue;
        }

        const result = await comparePDFs(comp.expected, comp.actual, comp.label);
        comparisonResults.push({ label: comp.label, success: result.success });

        // Save comparison output to log file
        const { writeFile } = await import('fs/promises');
        await writeFile(comp.logFile, result.output);
    }

    // Summary
    console.log('\n' + '='.repeat(80));
    console.log('SUMMARY');
    console.log('='.repeat(80));

    console.log('\nGeneration Results:');
    for (const [key, success] of Object.entries(generateResults)) {
        const config = outputs[key];
        console.log(`  ${success ? 'OK' : 'FAILED'} - ${config.label}`);
    }

    console.log('\nComparison Results:');
    let hasFailures = false;
    for (const result of comparisonResults) {
        if (result.success === null) {
            console.log(`  SKIP - ${result.label} (${result.reason})`);
        } else if (result.success) {
            console.log(`  PASS - ${result.label}`);
        } else {
            console.log(`  FAIL - ${result.label}`);
            hasFailures = true;
        }
    }

    console.log(`\nOutput folder: ${outputFolder}`);
    console.log('='.repeat(80));

    process.exit(hasFailures ? 1 : 0);
}

main().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
});
