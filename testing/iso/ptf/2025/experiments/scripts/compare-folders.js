#!/usr/bin/env node
// @ts-check
/**
 * Compare PDF sizes between baseline and new benchmark folders
 *
 * IMPORTANT: All paths are resolved relative to CWD.
 * Run from: testing/iso/ptf/2025/experiments/
 *
 * Usage:
 *   node scripts/compare-folders.js output/2026-01-08-008 output/2026-01-08-010
 */

// =============================================================================
// AGENT RESTRICTIONS - READ BEFORE MODIFYING
// =============================================================================
//
// This script uses CWD-RELATIVE path resolution.
// Paths passed as arguments are resolved relative to process.cwd().
//
// DO NOT add magic path resolution patterns.
// If paths don't work, you're running from the wrong directory.
//
// =============================================================================

import { parseArgs } from 'node:util';
import { readdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';

// ============================================================================
// CLI Argument Parsing (Node.js parseArgs)
// ============================================================================

const { values: options, positionals } = parseArgs({
    // Filter out empty strings that may come from shell argument parsing edge cases
    args: process.argv.slice(2).filter(arg => arg.length > 0),
    allowPositionals: true,
    options: {
        'help': { type: 'boolean', short: 'h', default: false },
    }
});

function normalizeFilename(filename) {
    // Remove (YYYY-MM-DD-XXX) pattern for comparison
    return filename.replace(/\s*\(\d{4}-\d{2}-\d{2}-\d+\)/, '');
}

async function getPDFs(dir) {
    const files = await readdir(dir);
    const pdfs = {};

    for (const file of files) {
        if (!file.endsWith('.pdf')) continue;
        const normalized = normalizeFilename(file);
        const fullPath = join(dir, file);
        const stats = await stat(fullPath);
        pdfs[normalized] = { path: fullPath, size: stats.size };
    }

    return pdfs;
}

async function compareFolders(baselineDir, newDir) {
    console.log('Compare PDF Sizes');
    console.log('=================');
    console.log(`CWD: ${process.cwd()}`);
    console.log('');
    console.log(`Baseline: ${baselineDir}`);
    console.log(`New:      ${newDir}`);
    console.log('');

    const baselinePDFs = await getPDFs(baselineDir);
    const newPDFs = await getPDFs(newDir);

    let allPass = true;
    let total = 0;
    let exactMatch = 0;
    let minorDiff = 0;

    const names = Object.keys(baselinePDFs).sort();

    for (const name of names) {
        if (!(name in newPDFs)) {
            console.log(`MISSING: ${name}`);
            allPass = false;
            continue;
        }

        const baselineSize = baselinePDFs[name].size;
        const newSize = newPDFs[name].size;
        const diff = newSize - baselineSize;
        const diffAbs = Math.abs(diff);
        const diffPercent = (diffAbs / baselineSize) * 100;

        let status;
        if (diffAbs === 0) {
            status = 'OK';
            exactMatch++;
        } else if (diffPercent < 0.01) {
            status = 'OK';
            minorDiff++;
        } else if (diffPercent < 1.0) {
            status = 'WARN';
        } else {
            status = 'FAIL';
            allPass = false;
        }

        const sign = diff >= 0 ? '+' : '';
        console.log(`[${status.padEnd(4)}] ${baselineSize.toLocaleString().padStart(12)} -> ${newSize.toLocaleString().padStart(12)} (${sign}${diff.toString().padStart(8)} bytes, ${diffPercent.toFixed(3).padStart(6)}%) ${name}`);
        total++;
    }

    console.log('');
    console.log('='.repeat(80));
    if (allPass) {
        console.log(`NO REGRESSIONS: ${total} PDFs compared`);
        console.log(`  - ${exactMatch} exact matches`);
        console.log(`  - ${minorDiff} with < 0.01% difference`);
    } else {
        console.log('REGRESSIONS FOUND');
    }
    console.log('='.repeat(80));

    return allPass ? 0 : 1;
}

// Show help or validate arguments
if (options['help'] || positionals.length !== 2) {
    console.log(`
Usage:
  node scripts/compare-folders.js <baseline-dir> <new-dir>

Example (from experiments/):
  node scripts/compare-folders.js output/2026-01-08-008 output/2026-01-08-010

Options:
  -h, --help  Show this help message
`);
    process.exit(options['help'] ? 0 : 1);
}

const [baselineArg, newArg] = positionals;

// Resolve paths relative to CWD
const baselineDir = resolve(process.cwd(), baselineArg);
const newDir = resolve(process.cwd(), newArg);

compareFolders(baselineDir, newDir).then(code => process.exit(code));
