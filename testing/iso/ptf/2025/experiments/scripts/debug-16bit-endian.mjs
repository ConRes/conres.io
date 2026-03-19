/**
 * Debug script to verify 16-bit big-endian handling in PDF images.
 * PDF 16-bit data is big-endian, but Uint16Array uses native (little-endian on most systems).
 */

import { readFile } from 'fs/promises';
import { PDFDocument, PDFRawStream, PDFName, PDFArray, PDFRef } from 'pdf-lib';
import pako from 'pako';

const pdfPath = process.argv[2] || '../../tests/fixtures/pdfs/2025-08-15 - ConRes - ISO PTF - CR1 (F9d) Fixtures - F-01.pdf';

console.log('=== Debug 16-bit Endianness ===\n');

const pdfBytes = await readFile(pdfPath);
const pdf = await PDFDocument.load(pdfBytes);
const context = pdf.context;

const page = pdf.getPages()[0];
const pageDict = page.node.dict;
const resources = pageDict.get(PDFName.of('Resources'));
const resourcesDict = resources instanceof PDFRef ? context.lookup(resources) : resources;
const xobject = resourcesDict?.get(PDFName.of('XObject'));
const xobjectDict = xobject instanceof PDFRef ? context.lookup(xobject) : xobject;

// Find Im0 (16-bit RGB) and Im6 (16-bit Lab)
for (const [name, ref] of xobjectDict.entries()) {
    const imageName = name.asString().replace(/^\//, '');

    // Only check Im0 (16-bit RGB) and Im6 (16-bit Lab)
    if (!['Im0', 'Im6'].includes(imageName)) continue;

    if (!(ref instanceof PDFRef)) continue;
    const obj = context.lookup(ref);
    if (!(obj instanceof PDFRawStream)) continue;

    const dict = obj.dict;
    const bpc = dict.get(PDFName.of('BitsPerComponent'))?.asNumber?.() || 8;
    const width = dict.get(PDFName.of('Width'))?.asNumber?.() || 0;
    const height = dict.get(PDFName.of('Height'))?.asNumber?.() || 0;

    console.log(`\n=== ${imageName} (BPC: ${bpc}) ===`);

    // Get raw data
    const filter = dict.get(PDFName.of('Filter'));
    const isCompressed = filter?.asString?.() === '/FlateDecode';
    const data = isCompressed ? pako.inflate(obj.contents) : obj.contents;

    console.log(`Raw data length: ${data.length} bytes`);
    console.log(`First 12 bytes (hex): ${Array.from(data.slice(0, 12)).map(b => b.toString(16).padStart(2, '0')).join(' ')}`);

    if (bpc === 16) {
        console.log('\n16-bit interpretation:');

        // First pixel: 6 bytes for RGB (3 channels * 2 bytes)
        const channels = imageName === 'Im0' ? 3 : 3; // Both RGB and Lab have 3 channels
        const bytesPerPixel = channels * 2;

        // Big-endian interpretation (correct for PDF)
        console.log('  Big-endian (correct for PDF):');
        for (let i = 0; i < 3; i++) {
            const offset = i * bytesPerPixel;
            const values = [];
            for (let c = 0; c < channels; c++) {
                const high = data[offset + c * 2];
                const low = data[offset + c * 2 + 1];
                const value16 = (high << 8) | low;
                const value8 = Math.round(value16 / 257);
                values.push(`${value16} → ${value8}`);
            }
            console.log(`    Pixel ${i}: [${values.join(', ')}]`);
        }

        // Little-endian interpretation (WRONG - what Uint16Array does)
        console.log('  Little-endian (WRONG - Uint16Array default):');
        const view = new Uint16Array(data.buffer, data.byteOffset, Math.min(6, Math.floor(data.length / 2)));
        for (let i = 0; i < Math.min(3, Math.floor(view.length / channels)); i++) {
            const values = [];
            for (let c = 0; c < channels; c++) {
                const value16 = view[i * channels + c];
                const value8 = Math.round(value16 / 257);
                values.push(`${value16} → ${value8}`);
            }
            console.log(`    Pixel ${i}: [${values.join(', ')}]`);
        }

        // Lab-specific: check value ranges
        if (imageName === 'Im6') {
            console.log('\n  Lab value analysis (big-endian):');
            console.log('  PDF Lab encoding: L*: 0-100 (scaled to 0-65535), a*,b*: -128 to 127 (scaled to 0-65535)');

            const pixelCount = Math.min(5, Math.floor(data.length / bytesPerPixel));
            for (let i = 0; i < pixelCount; i++) {
                const offset = i * bytesPerPixel;
                const L16 = (data[offset] << 8) | data[offset + 1];
                const a16 = (data[offset + 2] << 8) | data[offset + 3];
                const b16 = (data[offset + 4] << 8) | data[offset + 5];

                // Decode to actual L*a*b* values
                const L = (L16 / 65535) * 100;
                const a = ((a16 / 65535) * 255) - 128;
                const b = ((b16 / 65535) * 255) - 128;

                console.log(`    Pixel ${i}: L=${L.toFixed(1)}, a=${a.toFixed(1)}, b=${b.toFixed(1)}`);
            }
        }
    }
}

console.log('\n\n=== Diagnosis ===');
console.log('If big-endian values look reasonable but little-endian looks wrong:');
console.log('  → The #normalizeBitsPerComponent() method needs to read bytes in big-endian order');
console.log('  → Current code uses Uint16Array which is native endian (little on most systems)');
console.log('\nFix: Read pairs of bytes manually: (data[i*2] << 8) | data[i*2 + 1]');
