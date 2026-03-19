#!/usr/bin/env node
/**
 * Debug script to trace refactored PDF conversion flow.
 *
 * Tests the exact flow that compare-implementations.js uses.
 */

import { readFile, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Import dependencies
const { PDFDocument } = await import('pdf-lib');
const { PDFDocumentColorConverter } = await import('../../classes/pdf-document-color-converter.js');

// Test PDF
const pdfPath = process.argv[2] || join(__dirname, '../../tests/fixtures/pdfs/2025-08-15 - ConRes - ISO PTF - CR1 (F9d) Fixtures - F-01.pdf');
const profilePath = process.argv[3] || join(__dirname, '../../tests/fixtures/profiles/eciCMYK v2.icc');

console.log('=== Debug Refactored Conversion Flow ===\n');
console.log('PDF:', pdfPath);
console.log('Profile:', profilePath);

// Load resources
const pdfBytes = await readFile(pdfPath);
const profileBytes = await readFile(profilePath);

// Load PDF document
const pdfDocument = await PDFDocument.load(pdfBytes, { updateMetadata: false });

// Create converter with verbose mode
const converter = new PDFDocumentColorConverter({
    renderingIntent: 'preserve-k-only-relative-colorimetric-gcr',
    blackPointCompensation: true,
    useAdaptiveBPCClamping: true,
    destinationProfile: profileBytes.buffer.slice(
        profileBytes.byteOffset,
        profileBytes.byteOffset + profileBytes.byteLength
    ),
    destinationColorSpace: 'CMYK',
    convertImages: true,
    convertContentStreams: true,
    useWorkers: false,
    verbose: true, // Enable verbose logging
});

console.log('\n=== Converting Document ===\n');

try {
    await converter.ensureReady();
    const result = await converter.convertColor({ pdfDocument }, {});

    console.log('\n=== Conversion Result ===');
    console.log('Pages converted:', result.pagesConverted);
    console.log('Images converted:', result.imagesConverted);
    console.log('Content streams converted:', result.contentStreamsConverted);
    console.log('Total color operations:', result.totalColorOperations);

    if (result.errors && result.errors.length > 0) {
        console.log('\nErrors:');
        for (const err of result.errors) {
            console.log('  -', err);
        }
    }

    // Save and write output for inspection
    const outputBytes = await pdfDocument.save();
    const outputPath = join(__dirname, '../output/debug-refactored-output.pdf');
    await writeFile(outputPath, outputBytes);
    console.log('\nOutput written to:', outputPath);

} catch (error) {
    console.error('Conversion failed:', error);
    console.error(error.stack);
}

// Cleanup
converter.dispose();
