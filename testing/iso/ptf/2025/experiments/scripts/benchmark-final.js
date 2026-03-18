#!/usr/bin/env node
// @ts-check
/**
 * Final Benchmark Script
 *
 * Comprehensive benchmark comparing legacy and new class-based implementations.
 * Use --legacy flag to run only the legacy implementation.
 *
 * @module benchmark-final
 */
import { argv, exit } from 'process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFile } from 'fs/promises';
import { existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

const hasLegacyFlag = argv.includes('--legacy');

if (hasLegacyFlag) {
    // Remove --legacy from argv and delegate to legacy implementation
    const filteredArgv = argv.filter(arg => arg !== '--legacy');
    process.argv = filteredArgv;

    // Dynamic import of legacy implementation
    await import(join(__dirname, 'legacy', 'benchmark-final.js'));
} else {
    // New class-based implementation
    const args = argv.slice(2);

    // Parse arguments
    const pdfPath = args.find(a => a.endsWith('.pdf'));
    const profilePath = args.find(a => a.endsWith('.icc'));
    const iterations = parseInt(args.find(a => a.startsWith('--iterations='))?.split('=')[1] || '5', 10);

    if (!pdfPath || !profilePath) {
        console.log(`
Final Benchmark Script (Class-Based Implementation)

Usage:
  node benchmark-final.js <input.pdf> <profile.icc> [options]

Options:
  --iterations=N    Number of iterations (default: 5)
  --legacy          Use legacy implementation only

Examples:
  node benchmark-final.js document.pdf profile.icc --iterations=10
  node benchmark-final.js document.pdf profile.icc --legacy
`);
        exit(1);
    }

    if (!existsSync(pdfPath)) {
        console.error(`Error: PDF not found: ${pdfPath}`);
        exit(1);
    }
    if (!existsSync(profilePath)) {
        console.error(`Error: ICC profile not found: ${profilePath}`);
        exit(1);
    }

    // Load dependencies
    const { PDFDocument } = await import('pdf-lib');
    const { PDFDocumentColorConverter } = await import('../../classes/pdf-document-color-converter.js');

    // Load input files
    console.log(`Loading PDF: ${pdfPath}`);
    const pdfBytes = await readFile(pdfPath);
    const pdfDocument = await PDFDocument.load(pdfBytes, { updateMetadata: false });

    console.log(`Loading ICC profile: ${profilePath}`);
    const profileBytes = await readFile(profilePath);
    const destinationProfile = /** @type {ArrayBuffer} */ (profileBytes.buffer.slice(
        profileBytes.byteOffset,
        profileBytes.byteOffset + profileBytes.byteLength
    ));

    console.log(`\nFinal Benchmark`);
    console.log(`===============`);
    console.log(`PDF: ${pdfPath} (${pdfDocument.getPageCount()} pages)`);
    console.log(`Profile: ${profilePath}`);
    console.log(`Iterations: ${iterations}`);
    console.log('');

    // Run benchmark
    const times = [];

    for (let i = 0; i < iterations; i++) {
        // Reload PDF for each iteration
        const doc = await PDFDocument.load(pdfBytes, { updateMetadata: false });

        const converter = new PDFDocumentColorConverter({
            renderingIntent: 'preserve-k-only-relative-colorimetric-gcr',
            blackPointCompensation: true,
            useAdaptiveBPCClamping: true,
            destinationProfile,
            destinationColorSpace: 'CMYK',
            convertImages: true,
            convertContentStreams: true,
            useWorkers: false, // Main thread for consistent benchmarking
            verbose: false,
        });

        try {
            await converter.ensureReady();

            const startTime = performance.now();
            const result = await converter.convertColor({ pdfDocument: doc }, {});
            const elapsed = performance.now() - startTime;

            times.push(elapsed);

            console.log(`  Iteration ${i + 1}: ${elapsed.toFixed(0)}ms (images: ${result.imagesConverted}, streams: ${result.contentStreamsConverted})`);
        } finally {
            converter.dispose();
        }
    }

    // Calculate statistics
    const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
    const minTime = Math.min(...times);
    const maxTime = Math.max(...times);
    const stdDev = Math.sqrt(times.reduce((sum, t) => sum + Math.pow(t - avgTime, 2), 0) / times.length);

    console.log('');
    console.log('Results:');
    console.log('─'.repeat(40));
    console.log(`  Average: ${avgTime.toFixed(0)}ms`);
    console.log(`  Min:     ${minTime.toFixed(0)}ms`);
    console.log(`  Max:     ${maxTime.toFixed(0)}ms`);
    console.log(`  StdDev:  ${stdDev.toFixed(0)}ms`);
    console.log('─'.repeat(40));
    console.log('\nBenchmark complete.');
}
