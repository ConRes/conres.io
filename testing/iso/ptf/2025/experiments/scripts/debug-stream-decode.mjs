/**
 * Debug script to understand why decodePDFRawStream might fail in browser context
 */

import { readFile } from 'fs/promises';
import { PDFDocument, PDFName, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
    const pdfPath = join(__dirname, '../../tests/fixtures/pdfs/2025-08-15 - ConRes - ISO PTF - CR1 - Type Sizes and Lissajou.pdf');
    const pdfBytes = await readFile(pdfPath);
    const pdf = await PDFDocument.load(pdfBytes);

    console.log('Inspecting content streams in Type Sizes and Lissajou.pdf\n');

    // Find all content streams and check stream 85 0 R specifically
    for (const [ref, obj] of pdf.context.indirectObjects) {
        if (obj instanceof PDFRawStream) {
            const dict = obj.dict;
            const subtype = dict.get(PDFName.of('Subtype'))?.toString();
            const type = dict.get(PDFName.of('Type'))?.toString();

            // Check if this is a content stream (no Type/Subtype usually indicates content stream)
            if (!subtype && !type && ref.objectNumber === 85) {
                console.log(`Stream ${ref.objectNumber} ${ref.generationNumber} R:`);
                console.log('  Filter:', dict.get(PDFName.of('Filter'))?.toString() || '(none)');
                console.log('  DecodeParms:', dict.get(PDFName.of('DecodeParms'))?.toString() || '(none)');
                console.log('  Contents length:', obj.contents?.length);

                try {
                    const decoded = decodePDFRawStream(obj).decode();
                    console.log('  Decoded length:', decoded.length);
                    const text = new TextDecoder().decode(decoded.slice(0, 500));
                    console.log('  First 500 chars:', text.substring(0, 500));
                } catch (e) {
                    console.log('  Decode error:', e.message);
                    console.log('  Stack:', e.stack);
                }
                console.log('');
            }
        }
    }

    // Also list all content streams
    console.log('\nAll potential content streams (no Type/Subtype):');
    let count = 0;
    for (const [ref, obj] of pdf.context.indirectObjects) {
        if (obj instanceof PDFRawStream) {
            const dict = obj.dict;
            const subtype = dict.get(PDFName.of('Subtype'))?.toString();
            const type = dict.get(PDFName.of('Type'))?.toString();

            if (!subtype && !type) {
                const filter = dict.get(PDFName.of('Filter'))?.toString() || '(none)';
                console.log(`  ${ref.objectNumber} 0 R - Filter: ${filter}, Size: ${obj.contents?.length}`);
                count++;
            }
        }
    }
    console.log(`Total: ${count} streams`);
}

main().catch(console.error);
