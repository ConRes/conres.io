#!/usr/bin/env node
/**
 * Check pixel differences for Im0 and Im6 between legacy and refactored RGB outputs.
 */

import { readFile } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { PDFDocument, PDFRawStream, PDFName, PDFRef, PDFArray } from 'pdf-lib';
import pako from 'pako';

const __dirname = dirname(fileURLToPath(import.meta.url));

const expectedPDF = join(__dirname, '../output/2026-01-23-015 - Verification/Legacy - Main Thread - FIPS_WIDE RGB.pdf');
const actualPDF = join(__dirname, '../output/2026-01-23-016-RGBFixes/Refactored - FIPS_WIDE RGB.pdf');

async function extractImageData(pdfPath, imageName) {
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

        const filter = obj.dict.get(PDFName.of('Filter'));
        const isCompressed = filter?.asString?.() === '/FlateDecode';
        let data = obj.contents;
        if (isCompressed) {
            data = pako.inflate(data);
        }
        return data;
    }
    return null;
}

async function compareImages(imageName) {
    console.log(`\n=== ${imageName} Comparison ===\n`);

    const expectedData = await extractImageData(expectedPDF, imageName);
    const actualData = await extractImageData(actualPDF, imageName);

    if (!expectedData || !actualData) {
        console.log('Could not extract image data');
        return;
    }

    console.log(`Expected size: ${expectedData.length} bytes`);
    console.log(`Actual size:   ${actualData.length} bytes`);

    if (expectedData.length !== actualData.length) {
        console.log('Size mismatch!');
        return;
    }

    // Calculate pixel differences
    let differingPixels = 0;
    let maxDiff = 0;
    let totalDiff = 0;
    const channelsPerPixel = 3; // RGB

    const pixelCount = expectedData.length / channelsPerPixel;
    for (let i = 0; i < pixelCount; i++) {
        const offset = i * channelsPerPixel;
        let pixelDiff = 0;
        for (let c = 0; c < channelsPerPixel; c++) {
            const diff = Math.abs(expectedData[offset + c] - actualData[offset + c]);
            if (diff > 0) {
                pixelDiff = Math.max(pixelDiff, diff);
            }
        }
        if (pixelDiff > 0) {
            differingPixels++;
            maxDiff = Math.max(maxDiff, pixelDiff);
            totalDiff += pixelDiff;
        }
    }

    console.log(`\nDiffering pixels: ${differingPixels}/${pixelCount} (${(differingPixels / pixelCount * 100).toFixed(2)}%)`);
    console.log(`Max difference: ${maxDiff}`);
    if (differingPixels > 0) {
        console.log(`Average difference: ${(totalDiff / differingPixels).toFixed(2)}`);
    }

    // Show sample differences
    console.log('\nSample differences (first 10):');
    let shown = 0;
    for (let i = 0; i < pixelCount && shown < 10; i++) {
        const offset = i * channelsPerPixel;
        const expR = expectedData[offset];
        const expG = expectedData[offset + 1];
        const expB = expectedData[offset + 2];
        const actR = actualData[offset];
        const actG = actualData[offset + 1];
        const actB = actualData[offset + 2];
        if (expR !== actR || expG !== actG || expB !== actB) {
            console.log(`  Pixel ${i}: Expected [${expR},${expG},${expB}] vs Actual [${actR},${actG},${actB}]`);
            shown++;
        }
    }
}

await compareImages('Im0');
await compareImages('Im6');
