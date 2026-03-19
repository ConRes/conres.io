#!/usr/bin/env node
/**
 * Debug script to examine Lab color space in PDF page resources
 */

import { PDFDocument, PDFName, PDFDict, PDFArray, PDFRef } from 'pdf-lib';
import { readFile } from 'fs/promises';

const pdfPath = process.argv[2] || 'output/2026-02-03-021/2025-08-15 - ConRes - ISO PTF - CR1 (F9d) Fixtures - F-01 (16-bit) - Lab (32-bit) - Refactored - Main Thread - Color-Engine 2026-01-30 (2026-02-03-021).pdf';

console.log('Loading PDF:', pdfPath);
const pdfBytes = await readFile(pdfPath);
const pdfDoc = await PDFDocument.load(pdfBytes);

const pages = pdfDoc.getPages();
console.log('Pages:', pages.length);

for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    const pageDict = pdfDoc.context.lookup(page.ref);

    console.log(`\n=== Page ${i + 1} ===`);
    console.log('Page ref:', page.ref.toString());

    // Get Resources
    const resourcesEntry = pageDict.get(PDFName.of('Resources'));
    console.log('Resources entry type:', resourcesEntry?.constructor?.name);

    let resources = resourcesEntry;
    if (resourcesEntry instanceof PDFRef) {
        resources = pdfDoc.context.lookup(resourcesEntry);
        console.log('Resources (resolved) type:', resources?.constructor?.name);
    }

    if (resources instanceof PDFDict) {
        console.log('Resources keys:', Array.from(resources.entries()).map(([k]) => k.toString()));

        // Get ColorSpace
        const colorSpaceEntry = resources.get(PDFName.of('ColorSpace'));
        console.log('\nColorSpace entry type:', colorSpaceEntry?.constructor?.name);

        let colorSpaces = colorSpaceEntry;
        if (colorSpaceEntry instanceof PDFRef) {
            colorSpaces = pdfDoc.context.lookup(colorSpaceEntry);
            console.log('ColorSpace (resolved) type:', colorSpaces?.constructor?.name);
        }

        if (colorSpaces instanceof PDFDict) {
            console.log('ColorSpace keys:', Array.from(colorSpaces.entries()).map(([k]) => k.toString()));

            // Look for Lab
            for (const [key, value] of colorSpaces.entries()) {
                const keyStr = key.toString();
                console.log(`\n  ${keyStr}:`);
                console.log('    Value type:', value?.constructor?.name);

                let csValue = value;
                if (value instanceof PDFRef) {
                    csValue = pdfDoc.context.lookup(value);
                    console.log('    Value (resolved) type:', csValue?.constructor?.name);
                    console.log('    Ref:', value.toString());
                }

                if (csValue instanceof PDFArray) {
                    console.log('    Array length:', csValue.size());
                    const items = csValue.asArray();
                    for (let j = 0; j < items.length; j++) {
                        const item = items[j];
                        console.log(`    [${j}]:`, item?.constructor?.name, '-', item?.toString?.()?.substring(0, 100));

                        // If dict, show its contents
                        if (item instanceof PDFDict) {
                            for (const [dk, dv] of item.entries()) {
                                console.log(`      ${dk.toString()}:`, dv?.toString?.()?.substring(0, 100));
                            }
                        }
                    }
                }
            }
        }
    }

    // Check first content stream for Lab usage
    const contents = pageDict.get(PDFName.of('Contents'));
    if (contents) {
        console.log('\n--- Content stream sample ---');
        let contentRef = contents;
        if (contents instanceof PDFArray) {
            contentRef = contents.get(0);
        }
        if (contentRef instanceof PDFRef) {
            const stream = pdfDoc.context.lookup(contentRef);
            if (stream) {
                // Decompress and show first part
                const { decodePDFRawStream } = await import('pdf-lib');
                try {
                    const decoded = decodePDFRawStream(stream).decode();
                    const text = new TextDecoder().decode(decoded);
                    // Find Lab usage
                    const labMatch = text.match(/\/Lab\s+(cs|CS)/g);
                    console.log('Lab cs/CS occurrences:', labMatch?.length || 0);

                    // Find scn/SCN operations
                    const scnMatch = text.match(/[\d.\-]+\s+[\d.\-]+\s+[\d.\-]+\s+(scn|SCN)/g);
                    console.log('scn/SCN occurrences:', scnMatch?.length || 0);
                    if (scnMatch) {
                        console.log('First 5 scn operations:');
                        for (let i = 0; i < Math.min(5, scnMatch.length); i++) {
                            console.log(`  ${scnMatch[i]}`);
                        }
                    }

                    // Find all /Lab cs occurrences with context
                    console.log('\n--- All /Lab cs occurrences with context ---');
                    let pos = 0;
                    let count = 0;
                    while ((pos = text.indexOf('/Lab', pos)) !== -1 && count < 10) {
                        console.log(`\nOccurrence ${count + 1} at position ${pos}:`);
                        console.log(text.substring(Math.max(0, pos - 50), pos + 80));
                        pos++;
                        count++;
                    }

                    // Also look for scn without preceding /Lab cs
                    console.log('\n--- Checking scn operations ---');
                    const lines = text.split(/[\n\r]+/);
                    let labActive = false;
                    let problemCount = 0;
                    for (let i = 0; i < lines.length && problemCount < 5; i++) {
                        const line = lines[i].trim();
                        if (line.includes('/Lab cs') || line.includes('/Lab CS')) {
                            labActive = true;
                        }
                        if ((line.endsWith(' scn') || line.endsWith(' SCN')) && !labActive) {
                            console.log(`Line ${i}: scn without Lab active: ${line.substring(0, 100)}`);
                            problemCount++;
                        }
                        // Reset on other cs operations
                        if ((line.includes(' cs') || line.includes(' CS')) && !line.includes('/Lab')) {
                            labActive = false;
                        }
                    }
                } catch (e) {
                    console.log('Could not decode stream:', e.message);
                }
            }
        }
    }
}

console.log('\nDone');
