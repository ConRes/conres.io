#!/usr/bin/env node
// @ts-check
/**
 * Check bit depths of images in PDFs
 */

import { readFileSync } from 'fs';
import { PDFDocument, PDFName, PDFDict, PDFRawStream } from 'pdf-lib';

const FIXTURES_DIR = '/Users/daflair/Projects/conres/conres.io/testing/iso/ptf/2025/tests/fixtures/pdfs';
const OUTPUT_DIR = '/Users/daflair/Projects/conres/conres.io/testing/iso/ptf/2025/experiments/output/2026-02-03-002';

const PDFS = [
    // Original input (what is claimed to be 16-bit reference)
    `${FIXTURES_DIR}/2025-08-15 - ConRes - ISO PTF - CR1 (F9d) Fixtures - F-01.pdf`,
    // Converted output (Main Thread)
    `${OUTPUT_DIR}/2025-08-15 - ConRes - ISO PTF - CR1 (F9d) Fixtures - F-01 (16-bit) - eciCMYK v2 - Relative Colorimetric - Refactored - Main Thread - Color-Engine 2026-01-30 (2026-02-03-002).pdf`,
];

function getColorSpaceInfo(colorSpaceRef, context) {
    const colorSpace = context.lookup(colorSpaceRef);

    if (colorSpace instanceof PDFName) {
        const name = colorSpace.asString();
        return name;
    }

    if (Array.isArray(colorSpace) || (colorSpace && typeof colorSpace.get === 'function')) {
        const arr = colorSpace;
        const csName = arr.get ? arr.get(0) : arr[0];
        const nameStr = csName instanceof PDFName ? csName.asString() : String(csName);
        return nameStr;
    }

    return 'Unknown';
}

async function analyzeImages(pdfPath) {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`PDF: ${pdfPath.split('/').pop()}`);
    console.log(`${'='.repeat(80)}`);

    const pdfData = readFileSync(pdfPath);
    const pdf = await PDFDocument.load(pdfData);
    const pages = pdf.getPages();

    for (let pageIdx = 0; pageIdx < pages.length; pageIdx++) {
        const page = pages[pageIdx].node;
        const resourcesRef = page.get(PDFName.of('Resources'));
        if (!resourcesRef) continue;

        const resources = pdf.context.lookup(resourcesRef);
        if (!(resources instanceof PDFDict)) continue;

        const xobjectRef = resources.get(PDFName.of('XObject'));
        if (!xobjectRef) continue;

        const xobjects = pdf.context.lookup(xobjectRef);
        if (!(xobjects instanceof PDFDict)) continue;

        console.log(`\nPage ${pageIdx + 1}:`);
        console.log(`  Image   Dimensions    BPC  ColorSpace`);
        console.log(`  ${'-'.repeat(50)}`);

        for (const [nameObj, ref] of xobjects.entries()) {
            const name = nameObj instanceof PDFName ? nameObj.asString().replace('/', '') : String(nameObj);
            const xobject = pdf.context.lookup(ref);
            if (!(xobject instanceof PDFRawStream)) continue;

            const dict = xobject.dict;
            const subtype = dict.get(PDFName.of('Subtype'));
            if (!(subtype instanceof PDFName) || subtype.asString() !== '/Image') continue;

            const widthObj = dict.get(PDFName.of('Width'));
            const heightObj = dict.get(PDFName.of('Height'));
            const bpcObj = dict.get(PDFName.of('BitsPerComponent'));

            const width = widthObj && typeof widthObj.asNumber === 'function' ? widthObj.asNumber() : 0;
            const height = heightObj && typeof heightObj.asNumber === 'function' ? heightObj.asNumber() : 0;
            const bpc = bpcObj && typeof bpcObj.asNumber === 'function' ? bpcObj.asNumber() : 'N/A';

            const colorSpaceRef = dict.get(PDFName.of('ColorSpace'));
            const colorSpace = colorSpaceRef ? getColorSpaceInfo(colorSpaceRef, pdf.context) : 'N/A';

            console.log(`  ${name.padEnd(6)} ${(width + '×' + height).padEnd(12)} ${String(bpc).padStart(4)} ${colorSpace}`);
        }
    }
}

async function main() {
    for (const pdfPath of PDFS) {
        await analyzeImages(pdfPath);
    }
}

main().catch(console.error);
