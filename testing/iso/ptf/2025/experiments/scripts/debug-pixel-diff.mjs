/**
 * Debug script to compare pixel values between legacy and refactored PDFs.
 * Identifies specific differences in image data.
 */

import { readFile } from 'fs/promises';
import { PDFDocument, PDFRawStream, PDFName, PDFRef } from 'pdf-lib';
import pako from 'pako';

const legacyPath = process.argv[2];
const refactoredPath = process.argv[3];
const imageName = process.argv[4] || 'Im0';

if (!legacyPath || !refactoredPath) {
    console.log('Usage: node debug-pixel-diff.mjs <legacy.pdf> <refactored.pdf> [imageName]');
    console.log('Example: node debug-pixel-diff.mjs legacy.pdf refactored.pdf Im0');
    process.exit(1);
}

console.log(`=== Pixel Comparison for ${imageName} ===\n`);

async function getImageData(pdfPath, imageName) {
    const pdfBytes = await readFile(pdfPath);
    const pdf = await PDFDocument.load(pdfBytes);
    const context = pdf.context;

    const page = pdf.getPages()[0];
    const pageDict = page.node.dict;
    const resources = pageDict.get(PDFName.of('Resources'));
    const resourcesDict = resources instanceof PDFRef ? context.lookup(resources) : resources;
    const xobject = resourcesDict?.get(PDFName.of('XObject'));
    const xobjectDict = xobject instanceof PDFRef ? context.lookup(xobject) : xobject;

    for (const [name, ref] of xobjectDict.entries()) {
        if (name.asString().replace(/^\//, '') !== imageName) continue;

        const obj = context.lookup(ref);
        if (!(obj instanceof PDFRawStream)) continue;

        const dict = obj.dict;
        const width = dict.get(PDFName.of('Width'))?.asNumber?.() || 0;
        const height = dict.get(PDFName.of('Height'))?.asNumber?.() || 0;
        const bpc = dict.get(PDFName.of('BitsPerComponent'))?.asNumber?.() || 8;
        const filter = dict.get(PDFName.of('Filter'));
        const colorSpace = dict.get(PDFName.of('ColorSpace'));

        let csName = colorSpace?.asString?.() || 'unknown';
        if (colorSpace instanceof PDFRef) {
            csName = context.lookup(colorSpace)?.constructor?.name || 'ref';
        }

        const isCompressed = filter?.asString?.() === '/FlateDecode';
        let data = obj.contents;
        if (isCompressed) {
            data = pako.inflate(data);
        }

        return {
            width,
            height,
            bpc,
            colorSpace: csName,
            data,
            channels: 4, // Assuming CMYK output
        };
    }

    return null;
}

const legacy = await getImageData(legacyPath, imageName);
const refactored = await getImageData(refactoredPath, imageName);

if (!legacy || !refactored) {
    console.log('Could not find image in one or both PDFs');
    process.exit(1);
}

console.log(`Legacy: ${legacy.width}×${legacy.height}, BPC ${legacy.bpc}, ${legacy.data.length} bytes`);
console.log(`Refactored: ${refactored.width}×${refactored.height}, BPC ${refactored.bpc}, ${refactored.data.length} bytes`);

if (legacy.data.length !== refactored.data.length) {
    console.log('\n⚠️  Data length differs!');
}

// Compare pixel by pixel
const channels = 4; // CMYK
const pixelCount = legacy.width * legacy.height;
let totalDiff = 0;
let maxDiff = 0;
let diffCount = 0;
let sampleDiffs = [];

for (let i = 0; i < pixelCount && i * channels < legacy.data.length; i++) {
    const offset = i * channels;
    let pixelDiff = 0;
    const legacyPixel = [];
    const refactoredPixel = [];

    for (let c = 0; c < channels; c++) {
        const lVal = legacy.data[offset + c];
        const rVal = refactored.data[offset + c];
        const diff = Math.abs(lVal - rVal);
        pixelDiff += diff;
        legacyPixel.push(lVal);
        refactoredPixel.push(rVal);
    }

    if (pixelDiff > 0) {
        diffCount++;
        totalDiff += pixelDiff;
        if (pixelDiff > maxDiff) {
            maxDiff = pixelDiff;
        }
        if (sampleDiffs.length < 10) {
            sampleDiffs.push({
                index: i,
                x: i % legacy.width,
                y: Math.floor(i / legacy.width),
                legacy: legacyPixel,
                refactored: refactoredPixel,
                diff: pixelDiff,
            });
        }
    }
}

console.log(`\n=== Comparison Results ===`);
console.log(`Total pixels: ${pixelCount}`);
console.log(`Differing pixels: ${diffCount} (${(diffCount / pixelCount * 100).toFixed(2)}%)`);
console.log(`Max pixel diff: ${maxDiff}`);
console.log(`Avg diff (differing only): ${diffCount > 0 ? (totalDiff / diffCount).toFixed(2) : 0}`);

if (sampleDiffs.length > 0) {
    console.log(`\n=== Sample Differences (first 10) ===`);
    for (const diff of sampleDiffs) {
        console.log(`  Pixel ${diff.index} (${diff.x}, ${diff.y}):`);
        console.log(`    Legacy:     C=${diff.legacy[0]} M=${diff.legacy[1]} Y=${diff.legacy[2]} K=${diff.legacy[3]}`);
        console.log(`    Refactored: C=${diff.refactored[0]} M=${diff.refactored[1]} Y=${diff.refactored[2]} K=${diff.refactored[3]}`);
        console.log(`    Total diff: ${diff.diff}`);
    }
}

// Sample from various positions
console.log(`\n=== Position Samples ===`);
const positions = [
    { name: 'Top-left', x: 0, y: 0 },
    { name: 'Top-right', x: legacy.width - 1, y: 0 },
    { name: 'Center', x: Math.floor(legacy.width / 2), y: Math.floor(legacy.height / 2) },
    { name: 'Bottom-left', x: 0, y: legacy.height - 1 },
    { name: 'Bottom-right', x: legacy.width - 1, y: legacy.height - 1 },
];

for (const pos of positions) {
    const idx = pos.y * legacy.width + pos.x;
    const offset = idx * channels;
    const lPixel = Array.from(legacy.data.slice(offset, offset + channels));
    const rPixel = Array.from(refactored.data.slice(offset, offset + channels));
    const diff = lPixel.map((v, i) => Math.abs(v - rPixel[i])).reduce((a, b) => a + b, 0);

    console.log(`  ${pos.name} (${pos.x}, ${pos.y}):`);
    console.log(`    Legacy:     [${lPixel.join(', ')}]`);
    console.log(`    Refactored: [${rPixel.join(', ')}]`);
    console.log(`    Diff: ${diff}`);
}
