#!/usr/bin/env node
// @ts-check
/**
 * Content Stream Color Inspection Script
 *
 * Parses and displays color operations from PDF content streams.
 * Uses the new class-based PDFContentStreamColorConverter.
 * Use --legacy flag for the original implementation.
 *
 * @module inspect-content-stream-colors
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
    await import(join(__dirname, 'legacy', 'inspect-content-stream-colors.js'));
} else {
    // New class-based implementation
    const args = argv.slice(2);

    // Parse arguments
    const pdfPath = args.find(a => a.endsWith('.pdf'));
    const verbose = args.includes('--verbose');

    if (!pdfPath) {
        console.log(`
Content Stream Color Inspection Script (Class-Based Implementation)

Usage:
  node inspect-content-stream-colors.js <input.pdf> [options]

Options:
  --verbose         Enable verbose output
  --legacy          Use legacy implementation

Examples:
  node inspect-content-stream-colors.js document.pdf --verbose
  node inspect-content-stream-colors.js document.pdf --legacy
`);
        exit(1);
    }

    if (!existsSync(pdfPath)) {
        console.error(`Error: PDF not found: ${pdfPath}`);
        exit(1);
    }

    // Load dependencies
    const { PDFDocument, PDFName, PDFArray, PDFRef, PDFRawStream, PDFDict } = await import('pdf-lib');
    const { PDFContentStreamColorConverter } = await import('../../classes/pdf-content-stream-color-converter.js');

    // Load PDF
    const pdfBytes = await readFile(pdfPath);
    const pdfDocument = await PDFDocument.load(pdfBytes, { updateMetadata: false });

    // Create a mock profile for parsing (not used for actual conversion)
    const mockProfile = new ArrayBuffer(132);

    // Create converter
    const converter = new PDFContentStreamColorConverter({
        renderingIntent: 'relative-colorimetric',
        blackPointCompensation: true,
        useAdaptiveBPCClamping: true,
        destinationProfile: mockProfile,
        destinationColorSpace: 'CMYK',
        useLookupTable: true,
        verbose,
    });

    try {
        const pages = pdfDocument.getPages();
        const context = pdfDocument.context;

        console.log(`Inspecting ${pages.length} page(s) in: ${pdfPath}\n`);

        for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
            const page = pages[pageIndex];
            const pageDict = context.lookup(page.ref);

            if (!(pageDict instanceof PDFDict)) continue;

            console.log(`=== Page ${pageIndex + 1} ===`);

            // Get content streams
            const contents = pageDict.get(PDFName.of('Contents'));
            if (!contents) {
                console.log('  No content streams');
                continue;
            }

            const contentRefs = contents instanceof PDFArray
                ? contents.asArray()
                : [contents];

            for (const contentRef of contentRefs) {
                if (!(contentRef instanceof PDFRef)) continue;

                const stream = context.lookup(contentRef);
                if (!(stream instanceof PDFRawStream)) continue;

                console.log(`\n  Content Stream: ${contentRef.toString()}`);

                // Decode stream content
                const streamText = new TextDecoder().decode(stream.contents);

                // Parse colors using the converter's method
                const colors = converter.parseContentStream(streamText);

                if (colors.length === 0) {
                    console.log('    No color operations found');
                } else {
                    console.log(`    Found ${colors.length} color operation(s):`);
                    for (const color of colors.slice(0, 20)) { // Limit to first 20
                        const values = color.values ? color.values.map(v => v.toFixed(3)).join(', ') : '';
                        const operator = color.operator || color.name || '';
                        console.log(`      ${operator}: ${color.type} [${values}]`);
                    }
                    if (colors.length > 20) {
                        console.log(`      ... and ${colors.length - 20} more`);
                    }
                }
            }

            console.log('');
        }

    } finally {
        converter.dispose();
    }
}
