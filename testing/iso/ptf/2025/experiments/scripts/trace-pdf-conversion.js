#!/usr/bin/env node
// @ts-check
/**
 * PDF Conversion Trace Script
 *
 * Traces the color conversion process step by step for debugging.
 * Uses the new class-based PDFDocumentColorConverter.
 * Use --legacy flag for the original implementation.
 *
 * @module trace-pdf-conversion
 */
import { argv, exit } from 'process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

const hasLegacyFlag = argv.includes('--legacy');

if (hasLegacyFlag) {
    // Remove --legacy from argv and delegate to legacy implementation
    const filteredArgv = argv.filter(arg => arg !== '--legacy');
    process.argv = filteredArgv;

    // Dynamic import of legacy implementation
    await import(join(__dirname, 'legacy', 'trace-pdf-conversion.js'));
} else {
    // New class-based implementation
    const args = argv.slice(2);

    // Parse arguments
    const pdfPath = args.find(a => a.endsWith('.pdf'));
    const profilePath = args.find(a => a.endsWith('.icc'));
    const outputPath = args.find((a, i) => a.endsWith('.pdf') && i > 0) || 'trace-output.pdf';
    const verbose = true; // Always verbose for tracing

    if (!pdfPath || !profilePath) {
        console.log(`
PDF Conversion Trace Script (Class-Based Implementation)

Usage:
  node trace-pdf-conversion.js <input.pdf> <profile.icc> [output.pdf] [options]

Options:
  --legacy          Use legacy implementation

Examples:
  node trace-pdf-conversion.js document.pdf profile.icc output.pdf
  node trace-pdf-conversion.js document.pdf profile.icc --legacy
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
    console.log(`[TRACE] Loading PDF: ${pdfPath}`);
    const pdfBytes = await readFile(pdfPath);
    const pdfDocument = await PDFDocument.load(pdfBytes, { updateMetadata: false });
    console.log(`[TRACE]   Page count: ${pdfDocument.getPageCount()}`);

    console.log(`[TRACE] Loading ICC profile: ${profilePath}`);
    const profileBytes = await readFile(profilePath);
    const destinationProfile = /** @type {ArrayBuffer} */ (profileBytes.buffer.slice(
        profileBytes.byteOffset,
        profileBytes.byteOffset + profileBytes.byteLength
    ));
    console.log(`[TRACE]   Profile size: ${destinationProfile.byteLength} bytes`);

    // Create converter with tracing hooks
    class TracingDocumentConverter extends PDFDocumentColorConverter {
        /** @type {number} */
        pageIndex = 0;

        /**
         * @override
         * @param {any} input
         * @param {any} context
         */
        async beforeConvertPDFDocumentColor(input, context) {
            console.log(`[TRACE] beforeConvertPDFDocumentColor`);
            console.log(`[TRACE]   Pages to process: ${input.pdfDocument.getPageCount()}`);
            await super.beforeConvertPDFDocumentColor(input, context);
        }

        /**
         * @override
         * @param {any} input
         * @param {any} result
         * @param {any} context
         */
        async afterConvertPDFDocumentColor(input, result, context) {
            console.log(`[TRACE] afterConvertPDFDocumentColor`);
            console.log(`[TRACE]   Total images converted: ${result.imagesConverted}`);
            console.log(`[TRACE]   Total content streams converted: ${result.contentStreamsConverted}`);
            console.log(`[TRACE]   Errors: ${result.errors.length}`);
            await super.afterConvertPDFDocumentColor(input, result, context);
        }
    }

    console.log(`[TRACE] Creating PDFDocumentColorConverter`);
    console.log(`[TRACE]   Rendering intent: preserve-k-only-relative-colorimetric-gcr`);
    console.log(`[TRACE]   Black point compensation: true`);
    console.log(`[TRACE]   Convert images: true`);
    console.log(`[TRACE]   Convert content streams: true`);

    const converter = new TracingDocumentConverter({
        renderingIntent: 'preserve-k-only-relative-colorimetric-gcr',
        blackPointCompensation: true,
        useAdaptiveBPCClamping: true,
        destinationProfile,
        destinationColorSpace: 'CMYK',
        convertImages: true,
        convertContentStreams: true,
        useWorkers: false, // Main thread for tracing
        verbose,
    });

    try {
        console.log(`[TRACE] Waiting for converter initialization...`);
        await converter.ensureReady();
        console.log(`[TRACE] Converter ready`);

        console.log(`[TRACE] Starting conversion...`);
        const startTime = performance.now();
        const result = await converter.convertColor({ pdfDocument }, {});
        const elapsed = performance.now() - startTime;

        console.log(`[TRACE] Conversion complete`);
        console.log(`[TRACE]   Duration: ${elapsed.toFixed(0)}ms`);
        console.log(`[TRACE]   Pages processed: ${result.pagesProcessed}`);
        console.log(`[TRACE]   Images converted: ${result.imagesConverted}`);
        console.log(`[TRACE]   Content streams converted: ${result.contentStreamsConverted}`);

        if (result.errors.length > 0) {
            console.log(`[TRACE]   Errors:`);
            for (const error of result.errors) {
                console.log(`[TRACE]     - ${error}`);
            }
        }

        // Save output
        console.log(`[TRACE] Saving output: ${outputPath}`);
        const outputBytes = await pdfDocument.save();
        await writeFile(outputPath, outputBytes);
        console.log(`[TRACE] Output saved: ${outputPath}`);

    } finally {
        converter.dispose();
        console.log(`[TRACE] Converter disposed`);
    }
}
