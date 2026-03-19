#!/usr/bin/env node
import { spawn } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const expectedPDF = join(__dirname, '../output/2026-01-23-015 - Verification/Legacy - Main Thread - eciCMYK v2.pdf');
const actualPDF = join(__dirname, '../output/2026-01-23-016-RGBFixes/Refactored - eciCMYK v2.pdf');

console.log('Running CMYK comparison...\n');

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
