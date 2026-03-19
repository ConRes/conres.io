/**
 * Debug script to trace content stream operators for RGB conversion.
 * Compares source, legacy output, and refactored output.
 */

import { readFile } from 'fs/promises';
import { PDFDocument, PDFRawStream, PDFName, PDFRef, PDFArray } from 'pdf-lib';
import pako from 'pako';

// Color operator regex for all types
const COLOR_OP_REGEX = /([\d.]+(?:\s+[\d.]+)*)?\s*\b(cs|CS|sc|SC|scn|SCN|g|G|rg|RG|k|K)\b/g;
const CS_OP_REGEX = /\/(\w+)\s+(cs|CS)\b/g;

async function analyzeContentStreams(pdfPath, label) {
    console.log(`\n=== ${label} ===`);
    console.log(`Path: ${pdfPath}`);

    const pdfBytes = await readFile(pdfPath);
    const pdf = await PDFDocument.load(pdfBytes);
    const context = pdf.context;

    const page = pdf.getPages()[0];
    const pageDict = page.node.dict;
    const contentsRef = pageDict.get(PDFName.of('Contents'));

    // Collect streams
    let streamRefs = [];
    if (contentsRef instanceof PDFRef) {
        const contents = context.lookup(contentsRef);
        if (contents instanceof PDFArray) {
            streamRefs = contents.asArray().filter(r => r instanceof PDFRef);
        } else {
            streamRefs = [contentsRef];
        }
    } else if (contentsRef instanceof PDFArray) {
        streamRefs = contentsRef.asArray().filter(r => r instanceof PDFRef);
    }

    const results = {
        totalOperations: 0,
        operators: {},
        colorSpaceOps: {},
        sampleOps: [],
    };

    for (let i = 0; i < streamRefs.length; i++) {
        const stream = context.lookup(streamRefs[i]);
        if (!(stream instanceof PDFRawStream)) continue;

        const filter = stream.dict.get(PDFName.of('Filter'));
        const isCompressed = filter?.asString?.() === '/FlateDecode';
        let data = stream.contents;
        if (isCompressed) {
            data = pako.inflate(data);
        }

        const text = new TextDecoder().decode(data);

        // Find color space setting operations
        let csMatch;
        while ((csMatch = CS_OP_REGEX.exec(text)) !== null) {
            const csName = csMatch[1];
            const csOp = csMatch[2];
            const key = `${csOp} /${csName}`;
            results.colorSpaceOps[key] = (results.colorSpaceOps[key] || 0) + 1;
        }

        // Find color operations
        let match;
        while ((match = COLOR_OP_REGEX.exec(text)) !== null) {
            const values = match[1]?.trim() || '';
            const op = match[2];
            results.operators[op] = (results.operators[op] || 0) + 1;
            results.totalOperations++;

            // Sample first 3 of each type
            const typeCount = results.sampleOps.filter(s => s.op === op).length;
            if (typeCount < 3) {
                results.sampleOps.push({ stream: i, op, values });
            }
        }
    }

    console.log(`\nTotal color operations: ${results.totalOperations}`);
    console.log('\nOperator counts:');
    for (const [op, count] of Object.entries(results.operators).sort((a, b) => b[1] - a[1])) {
        console.log(`  ${op}: ${count}`);
    }

    console.log('\nColor space setting operations:');
    for (const [op, count] of Object.entries(results.colorSpaceOps)) {
        console.log(`  ${op}: ${count}`);
    }

    console.log('\nSample operations:');
    for (const sample of results.sampleOps.slice(0, 10)) {
        console.log(`  Stream ${sample.stream}: ${sample.values} ${sample.op}`);
    }

    return results;
}

// Compare source, legacy, and refactored
const sourcePath = process.argv[2] || '../../tests/fixtures/pdfs/2025-08-15 - ConRes - ISO PTF - CR1 (F9d) Fixtures - F-01.pdf';
const legacyPath = process.argv[3] || '../output/2026-01-23-015 - Verification/Legacy - Main Thread - FIPS_WIDE RGB.pdf';
const refactoredPath = process.argv[4] || '../output/2026-01-23-015 - Verification/Refactored - Main Thread - FIPS_WIDE RGB.pdf';

const sourceResults = await analyzeContentStreams(sourcePath, 'SOURCE');
const legacyResults = await analyzeContentStreams(legacyPath, 'LEGACY (RGB)');
const refactoredResults = await analyzeContentStreams(refactoredPath, 'REFACTORED (RGB)');

console.log('\n\n=== COMPARISON SUMMARY ===');
console.log('\nOperator changes:');
const allOps = new Set([
    ...Object.keys(sourceResults.operators),
    ...Object.keys(legacyResults.operators),
    ...Object.keys(refactoredResults.operators),
]);

for (const op of [...allOps].sort()) {
    const src = sourceResults.operators[op] || 0;
    const leg = legacyResults.operators[op] || 0;
    const ref = refactoredResults.operators[op] || 0;
    if (src !== leg || leg !== ref) {
        console.log(`  ${op}: Source=${src}, Legacy=${leg}, Refactored=${ref}`);
    }
}
