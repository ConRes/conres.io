#!/usr/bin/env node
/**
 * Script to run comparison with fixed paths
 */

import { spawn } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const expectedPDF = join(__dirname, '../output/2026-01-23-015 - Verification/Legacy - Main Thread - FIPS_WIDE RGB.pdf');
const actualPDF = join(__dirname, '../output/2026-01-23-016-RGBFixes/Refactored - FIPS_WIDE RGB.pdf');

console.log('Running comparison...');
console.log(`Expected: ${expectedPDF}`);
console.log(`Actual:   ${actualPDF}`);
console.log('');

const proc = spawn('node', [
    join(__dirname, '../compare-pdf-color.js'),
    expectedPDF,
    actualPDF,
], {
    stdio: 'inherit',
    cwd: join(__dirname, '..'),
});

proc.on('close', (code) => {
    process.exit(code);
});
