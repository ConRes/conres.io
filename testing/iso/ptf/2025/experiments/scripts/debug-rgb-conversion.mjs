/**
 * Debug script to trace the full RGB conversion process.
 * Shows what operations are parsed, filtered, and converted.
 */

import { readFile, writeFile } from 'fs/promises';
import { PDFDocument } from 'pdf-lib';

const sourcePath = process.argv[2] || '../../tests/fixtures/pdfs/2025-08-15 - ConRes - ISO PTF - CR1 (F9d) Fixtures - F-01.pdf';
const profilePath = process.argv[3] || '../../tests/fixtures/profiles/FIPS_WIDE_28T-TYPEavg.icc';

console.log('=== RGB Conversion Debug ===\n');
console.log(`Source: ${sourcePath}`);
console.log(`Profile: ${profilePath}\n`);

// Load PDF and profile
const pdfBytes = await readFile(sourcePath);
const pdfDocument = await PDFDocument.load(pdfBytes, { updateMetadata: false });

const profileBytes = await readFile(profilePath);
const destinationProfile = profileBytes.buffer.slice(
    profileBytes.byteOffset,
    profileBytes.byteOffset + profileBytes.byteLength
);

// Import classes
const { PDFDocumentColorConverter } = await import('../../classes/pdf-document-color-converter.js');
const { ICCService } = await import('../../services/ICCService.js');

// Detect destination color space
const profileHeader = ICCService.parseICCHeaderFromSource(profileBytes);
const destinationColorSpace = profileHeader.colorSpace === 'RGB' ? 'RGB' : 'CMYK';
console.log(`Destination color space: ${destinationColorSpace}\n`);

// Create converter with custom verbose
const converter = new PDFDocumentColorConverter({
    renderingIntent: 'preserve-k-only-relative-colorimetric-gcr',
    blackPointCompensation: true,
    useAdaptiveBPCClamping: true,
    destinationProfile,
    destinationColorSpace,
    convertImages: false,  // Skip images for this debug
    convertContentStreams: true,
    useWorkers: false,
    verbose: true,
});

await converter.ensureReady();

// Manually extract page input to inspect colorSpaceDefinitions
const page = pdfDocument.getPages()[0];
const context = pdfDocument.context;

// Access private method via wrapper - we'll trace this differently
console.log('=== Page Resources ===\n');

// Get page dict and resources
const pageDict = page.node.dict;
const resources = pageDict.get(/** @type {any} */ ({ asString: () => 'Resources' }));

// Print what we can observe
console.log('Page dict keys:', [...pageDict.entries()].map(([k]) => k.asString()));

// Now do conversion and observe
console.log('\n=== Starting Conversion ===\n');

try {
    const result = await converter.convertColor({ pdfDocument }, {});
    console.log('\n=== Conversion Result ===\n');
    console.log(`Pages processed: ${result.pagesProcessed}`);
    console.log(`Images converted: ${result.imagesConverted}`);
    console.log(`Content streams converted: ${result.contentStreamsConverted}`);
    console.log(`Errors: ${result.errors?.length || 0}`);

    // Show errors
    if (result.errors?.length > 0) {
        console.log('\nErrors:');
        for (const err of result.errors) {
            console.log(`  - ${err}`);
        }
    }

    if (result.pageResults) {
        for (const [pageNum, pageResult] of Object.entries(result.pageResults)) {
            console.log(`\nPage ${pageNum}:`);
            console.log(`  Images: ${pageResult.imageResults?.length || 0}`);
            console.log(`  Content streams: ${pageResult.contentStreamResults?.length || 0}`);
            if (pageResult.contentStreamResults) {
                for (let i = 0; i < pageResult.contentStreamResults.length; i++) {
                    const streamResult = pageResult.contentStreamResults[i];
                    console.log(`  Stream ${i}: replacementCount=${streamResult.replacementCount}, colorConversions=${streamResult.colorConversions}, cacheHits=${streamResult.cacheHits}`);
                }
            }
        }
    }
} catch (error) {
    console.error('Conversion error:', error);
    console.error(error.stack);
}

converter.dispose();
