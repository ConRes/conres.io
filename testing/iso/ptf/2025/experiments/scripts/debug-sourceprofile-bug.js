#!/usr/bin/env node
// @ts-check
/**
 * Debug script to trace the sourceProfile undefined bug.
 */
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFile } from 'fs/promises';

// Patch Error to capture stack traces better
Error.stackTraceLimit = 50;

const __dirname = dirname(fileURLToPath(import.meta.url));

const pdfPath = '/Users/daflair/Projects/conres/conres.io/assets/testforms/2025-08-15 - ConRes - ISO PTF - CR1 - Interlaken Map (300 DPI).pdf';
const profilePath = join(__dirname, '../../tests/fixtures/profiles/eciCMYK v2.icc');

console.log('Debug: Loading dependencies...');
const { PDFDocument } = await import('pdf-lib');
const { PDFDocumentColorConverter } = await import('../../classes/pdf-document-color-converter.js');

console.log('Debug: Loading PDF and profile...');
const pdfBytes = await readFile(pdfPath);
const profileBytes = await readFile(profilePath);
const destinationProfile = profileBytes.buffer.slice(
    profileBytes.byteOffset,
    profileBytes.byteOffset + profileBytes.byteLength
);

console.log('Debug: Loading PDF document...');
const pdfDocument = await PDFDocument.load(pdfBytes, { updateMetadata: false });
console.log(`  Pages: ${pdfDocument.getPageCount()}`);

console.log('Debug: Creating converter...');
const converter = new PDFDocumentColorConverter({
    renderingIntent: 'preserve-k-only-relative-colorimetric-gcr',
    blackPointCompensation: true,
    useAdaptiveBPCClamping: true,
    destinationProfile,
    destinationColorSpace: 'CMYK',
    convertImages: true,
    convertContentStreams: true,
    useWorkers: false,
    verbose: true,  // Enable verbose logging
});

try {
    console.log('Debug: Waiting for converter ready...');
    await converter.ensureReady();

    console.log('Debug: Starting conversion...');
    const result = await converter.convertColor({ pdfDocument }, {});

    console.log('\nResult:');
    console.log(`  Pages processed: ${result.pagesProcessed}`);
    console.log(`  Images converted: ${result.imagesConverted}`);
    console.log(`  Content streams converted: ${result.contentStreamsConverted}`);
    console.log(`  Errors: ${result.errors.length}`);

    if (result.errors.length > 0) {
        console.log('\nErrors:');
        for (const error of result.errors) {
            console.log(`  - ${error}`);
        }
    }
} catch (error) {
    console.error('\nUnhandled error:', error);
    console.error('Stack:', error.stack);
} finally {
    converter.dispose();
}
