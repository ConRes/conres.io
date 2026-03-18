#!/usr/bin/env node
/**
 * Verify Comparable Diagnostics
 *
 * Integration test that compares diagnostics output between legacy and refactored
 * pipelines to ensure they produce comparable span hierarchies.
 *
 * Usage:
 *   node verify-comparable-diagnostics.mjs <input.pdf> <output-profile.icc>
 *   node verify-comparable-diagnostics.mjs --help
 *
 * Example:
 *   node verify-comparable-diagnostics.mjs ../../assets/test.pdf ../profiles/ISOcoated_v2_300_eci.icc
 *
 * The script:
 *   1. Runs convert-pdf-color.js with both --legacy and refactored modes
 *   2. Saves diagnostics JSON for both
 *   3. Compares span names at each level (L0-L4)
 *   4. Reports which comparable spans are present/missing
 */

import { spawn } from 'child_process';
import { readFile, writeFile, mkdir, unlink } from 'fs/promises';
import { dirname, join, basename, resolve } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';
import { tmpdir } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const experimentsDir = join(__dirname, '..');

// ============================================================================
// Comparable Span Definitions
// ============================================================================

/**
 * Comparable spans that should exist in both legacy and refactored pipelines.
 * Format: [level, name, description]
 */
const COMPARABLE_SPANS = [
    [0, 'document-conversion', 'Root document conversion span'],
    [1, 'page', 'Per-page processing span'],
    [2, 'image-batch', 'Batch of images on a page'],
    [2, 'stream-batch', 'Batch of content streams on a page'],
    [3, 'image-conversion', 'Individual image conversion (may be nested in image-batch)'],
    [3, 'content-stream', 'Individual content stream conversion (may be nested in stream-batch)'],
    [4, 'wasm-transform', 'WASM color engine transform call'],
    [4, 'color-lookup', 'Color lookup/conversion call'],
];

// ============================================================================
// Command Line Parsing
// ============================================================================

function parseArgs() {
    const args = process.argv.slice(2);

    if (args.includes('--help') || args.includes('-h') || args.length < 2) {
        printUsage();
        process.exit(args.includes('--help') || args.includes('-h') ? 0 : 1);
    }

    return {
        inputPdf: resolve(process.cwd(), args[0]),
        outputProfile: resolve(process.cwd(), args[1]),
        verbose: args.includes('--verbose') || args.includes('-v'),
    };
}

function printUsage() {
    console.log(`
Verify Comparable Diagnostics

Compares diagnostics output between legacy and refactored pipelines.

Usage:
  node verify-comparable-diagnostics.mjs <input.pdf> <output-profile.icc> [options]

Options:
  --verbose, -v    Show detailed span comparison
  --help, -h       Show this help message

Expected Comparable Spans (L0-L4):
  L0: document-conversion  - Root document conversion span
  L1: page                 - Per-page processing span
  L2: image-batch          - Batch of images on a page
  L2: stream-batch         - Batch of content streams on a page
  L3: image-conversion     - Individual image conversion
  L3: content-stream       - Individual content stream
  L4: wasm-transform       - WASM color engine transform
  L4: color-lookup         - Color lookup/conversion

Example:
  node verify-comparable-diagnostics.mjs test.pdf output.icc
`);
}

// ============================================================================
// Conversion Runner
// ============================================================================

/**
 * Run convert-pdf-color.js with diagnostics.
 *
 * @param {object} options
 * @param {string} options.inputPdf
 * @param {string} options.outputProfile
 * @param {string} options.outputPdf
 * @param {string} options.diagnosticsPath
 * @param {boolean} options.legacy
 * @returns {Promise<{ success: boolean, elapsed: number }>}
 */
async function runConversion({ inputPdf, outputProfile, outputPdf, diagnosticsPath, legacy }) {
    return new Promise((resolve, reject) => {
        const args = [
            'convert-pdf-color.js',
            inputPdf,
            outputProfile,
            outputPdf,
            '--intent=relative-colorimetric',
            '--bpc',
            '--no-workers', // Use main thread for cleaner span comparison
            `--save-diagnostics=${diagnosticsPath}`,
        ];

        if (legacy) {
            args.push('--legacy');
        }

        const startTime = performance.now();

        const proc = spawn('node', args, {
            cwd: experimentsDir,
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        let stderr = '';

        proc.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        proc.on('close', (code) => {
            const elapsed = performance.now() - startTime;
            if (code === 0) {
                resolve({ success: true, elapsed });
            } else {
                console.error(`Conversion failed (${legacy ? 'legacy' : 'refactored'}):`);
                console.error(stderr);
                resolve({ success: false, elapsed });
            }
        });

        proc.on('error', (error) => {
            reject(error);
        });
    });
}

// ============================================================================
// Diagnostics Analysis
// ============================================================================

/**
 * Extract all span names from diagnostics JSON, organized by depth.
 *
 * @param {any[]} nodes - Hatchet-format JSON array
 * @param {number} depth - Current depth
 * @param {Map<number, Set<string>>} spansByLevel - Accumulator
 * @returns {Map<number, Set<string>>}
 */
function extractSpanNames(nodes, depth = 0, spansByLevel = new Map()) {
    if (!spansByLevel.has(depth)) {
        spansByLevel.set(depth, new Set());
    }

    for (const node of nodes) {
        spansByLevel.get(depth).add(node.name);

        if (node.children && node.children.length > 0) {
            extractSpanNames(node.children, depth + 1, spansByLevel);
        }
    }

    return spansByLevel;
}

/**
 * Check if a span name matches any of the comparable span patterns.
 *
 * @param {string} name
 * @returns {{ level: number, comparableName: string } | null}
 */
function matchComparableSpan(name) {
    // Handle event-style names from auxiliary collector workaround
    if (name.startsWith('aux-span-start:')) {
        const innerName = name.replace('aux-span-start:', '');
        return matchComparableSpan(innerName);
    }

    for (const [level, comparableName] of COMPARABLE_SPANS) {
        if (name === comparableName || name.startsWith(comparableName)) {
            return { level, comparableName };
        }
    }
    return null;
}

/**
 * Analyze diagnostics and extract comparable spans.
 *
 * @param {any[]} json - Hatchet-format JSON
 * @returns {{ found: Set<string>, all: Set<string>, byLevel: Map<number, Set<string>> }}
 */
function analyzeDiagnostics(json) {
    const spansByLevel = extractSpanNames(json);
    const found = new Set();
    const all = new Set();

    for (const [level, names] of spansByLevel) {
        for (const name of names) {
            all.add(name);
            const match = matchComparableSpan(name);
            if (match) {
                found.add(match.comparableName);
            }
        }
    }

    return { found, all, byLevel: spansByLevel };
}

// ============================================================================
// Comparison and Reporting
// ============================================================================

/**
 * Compare diagnostics between legacy and refactored pipelines.
 *
 * @param {object} legacy - Legacy analysis
 * @param {object} refactored - Refactored analysis
 * @param {boolean} verbose
 * @returns {{ passed: boolean, issues: string[] }}
 */
function compareDiagnostics(legacy, refactored, verbose) {
    const issues = [];

    // Check which comparable spans are found in each
    const allComparable = new Set(COMPARABLE_SPANS.map(([, name]) => name));

    console.log('\n=== Comparable Span Coverage ===\n');
    console.log('| Span Name          | Level | Legacy | Refactored | Status |');
    console.log('|--------------------|-------|--------|------------|--------|');

    for (const [level, name, description] of COMPARABLE_SPANS) {
        const inLegacy = legacy.found.has(name);
        const inRefactored = refactored.found.has(name);

        let status;
        if (inLegacy && inRefactored) {
            status = 'PASS';
        } else if (!inLegacy && !inRefactored) {
            status = 'N/A';
        } else {
            status = 'DIFF';
            issues.push(`L${level}: ${name} - ${inLegacy ? 'legacy only' : 'refactored only'}`);
        }

        const legacyMark = inLegacy ? 'YES' : 'no';
        const refactoredMark = inRefactored ? 'YES' : 'no';

        console.log(
            `| ${name.padEnd(18)} | L${level}    | ${legacyMark.padEnd(6)} | ${refactoredMark.padEnd(10)} | ${status.padEnd(6)} |`
        );
    }

    if (verbose) {
        console.log('\n=== All Span Names (Legacy) ===\n');
        for (const [level, names] of legacy.byLevel) {
            console.log(`  L${level}: ${[...names].join(', ')}`);
        }

        console.log('\n=== All Span Names (Refactored) ===\n');
        for (const [level, names] of refactored.byLevel) {
            console.log(`  L${level}: ${[...names].join(', ')}`);
        }
    }

    return {
        passed: issues.length === 0,
        issues,
    };
}

// ============================================================================
// Main
// ============================================================================

async function main() {
    const { inputPdf, outputProfile, verbose } = parseArgs();

    // Validate inputs
    if (!existsSync(inputPdf)) {
        console.error(`Input PDF not found: ${inputPdf}`);
        process.exit(1);
    }
    if (!existsSync(outputProfile)) {
        console.error(`Output profile not found: ${outputProfile}`);
        process.exit(1);
    }

    // Create temp directory for outputs
    const tempDir = join(tmpdir(), `diagnostics-compare-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });

    const legacyPdf = join(tempDir, 'legacy-output.pdf');
    const refactoredPdf = join(tempDir, 'refactored-output.pdf');
    const legacyDiagnostics = join(tempDir, 'legacy.diagnostics.json');
    const refactoredDiagnostics = join(tempDir, 'refactored.diagnostics.json');

    console.log('='.repeat(80));
    console.log('Verify Comparable Diagnostics');
    console.log('='.repeat(80));
    console.log(`Input PDF: ${inputPdf}`);
    console.log(`Output Profile: ${outputProfile}`);
    console.log(`Temp Directory: ${tempDir}`);
    console.log('');

    // Run legacy conversion
    console.log('Running legacy conversion...');
    const legacyResult = await runConversion({
        inputPdf,
        outputProfile,
        outputPdf: legacyPdf,
        diagnosticsPath: legacyDiagnostics,
        legacy: true,
    });
    console.log(`  Completed in ${legacyResult.elapsed.toFixed(0)}ms (${legacyResult.success ? 'success' : 'failed'})`);

    if (!legacyResult.success) {
        console.error('Legacy conversion failed');
        process.exit(1);
    }

    // Run refactored conversion
    console.log('Running refactored conversion...');
    const refactoredResult = await runConversion({
        inputPdf,
        outputProfile,
        outputPdf: refactoredPdf,
        diagnosticsPath: refactoredDiagnostics,
        legacy: false,
    });
    console.log(`  Completed in ${refactoredResult.elapsed.toFixed(0)}ms (${refactoredResult.success ? 'success' : 'failed'})`);

    if (!refactoredResult.success) {
        console.error('Refactored conversion failed');
        process.exit(1);
    }

    // Load and analyze diagnostics
    console.log('\nAnalyzing diagnostics...');

    const legacyJson = JSON.parse(await readFile(legacyDiagnostics, 'utf-8'));
    const refactoredJson = JSON.parse(await readFile(refactoredDiagnostics, 'utf-8'));

    const legacyAnalysis = analyzeDiagnostics(legacyJson);
    const refactoredAnalysis = analyzeDiagnostics(refactoredJson);

    console.log(`  Legacy spans: ${legacyAnalysis.all.size} total, ${legacyAnalysis.found.size} comparable`);
    console.log(`  Refactored spans: ${refactoredAnalysis.all.size} total, ${refactoredAnalysis.found.size} comparable`);

    // Compare
    const comparison = compareDiagnostics(legacyAnalysis, refactoredAnalysis, verbose);

    // Summary
    console.log('\n' + '='.repeat(80));
    if (comparison.passed) {
        console.log('RESULT: PASS - All comparable spans present in both pipelines');
    } else {
        console.log('RESULT: DIFFERENCES FOUND');
        console.log('');
        console.log('Issues:');
        for (const issue of comparison.issues) {
            console.log(`  - ${issue}`);
        }
    }
    console.log('='.repeat(80));

    // Cleanup temp files (keep diagnostics for inspection)
    try {
        await unlink(legacyPdf);
        await unlink(refactoredPdf);
    } catch {
        // Ignore cleanup errors
    }

    console.log(`\nDiagnostics saved to: ${tempDir}`);
    process.exit(comparison.passed ? 0 : 1);
}

main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
});
