#!/usr/bin/env node
/**
 * Script to run CMYK conversion with fixed paths
 */

import { spawn } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const inputPDF = join(__dirname, '../../tests/fixtures/pdfs/2025-08-15 - ConRes - ISO PTF - CR1 (F9d) Fixtures - F-01.pdf');
const profilePath = join(__dirname, '../../tests/fixtures/profiles/eciCMYK v2.icc');
const outputPath = join(__dirname, '../output/2026-01-23-016-RGBFixes/Refactored - eciCMYK v2.pdf');

console.log('Running CMYK conversion...');

const proc = spawn('node', [
    join(__dirname, '../convert-pdf-color.js'),
    inputPDF,
    profilePath,
    outputPath,
    '--no-workers',
], {
    stdio: 'inherit',
    cwd: join(__dirname, '..'),
});

proc.on('close', (code) => {
    console.log(`Process exited with code ${code}`);
});
