/**
 * Debug script to compare Lab color values in content streams.
 * Identifies why Lab vectors output all K=0 or K=100 in refactored pipeline.
 */

import { readFile } from 'fs/promises';
import { PDFDocument, PDFRawStream, PDFName, PDFRef, PDFArray } from 'pdf-lib';
import pako from 'pako';

const legacyPath = process.argv[2] || '../output/2026-01-23-003/2025-08-15 - ConRes - ISO PTF - CR1 (F9d) Fixtures - F-01 - Comparison - Legacy - eciCMYK v2 (2026-01-23-003).pdf';
const refactoredPath = process.argv[3] || '../output/2026-01-23-011/refactored-cmyk.pdf';

console.log('=== Content Stream Lab Color Comparison ===\n');

// Color operator regex
const COLOR_OP_REGEX = /(\d+(?:\.\d+)?(?:\s+\d+(?:\.\d+)?)*)\s+(k|K|rg|RG|g|G|sc|SC|scn|SCN)\b/g;

async function extractContentStreamColors(pdfPath, label) {
    const pdfBytes = await readFile(pdfPath);
    const pdf = await PDFDocument.load(pdfBytes);
    const context = pdf.context;

    const page = pdf.getPages()[0];
    const pageDict = page.node.dict;
    const contentsRef = pageDict.get(PDFName.of('Contents'));

    const colors = [];

    // Handle Contents as array of streams or single stream
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

        // Find all color operations
        let match;
        while ((match = COLOR_OP_REGEX.exec(text)) !== null) {
            const values = match[1].split(/\s+/).map(Number);
            const op = match[2];
            colors.push({
                stream: i,
                operator: op,
                values,
                channelCount: values.length,
            });
        }
    }

    return colors;
}

// Extract colors from both PDFs
console.log(`Legacy: ${legacyPath}`);
console.log(`Refactored: ${refactoredPath}\n`);

const legacyColors = await extractContentStreamColors(legacyPath, 'Legacy');
const refactoredColors = await extractContentStreamColors(refactoredPath, 'Refactored');

// Summary by operator type
const summarize = (colors) => {
    const summary = {};
    for (const c of colors) {
        const key = `${c.operator} (${c.channelCount}ch)`;
        if (!summary[key]) summary[key] = [];
        summary[key].push(c.values);
    }
    return summary;
};

const legacySummary = summarize(legacyColors);
const refactoredSummary = summarize(refactoredColors);

console.log('=== Legacy Color Operations ===');
for (const [op, values] of Object.entries(legacySummary)) {
    console.log(`${op}: ${values.length} operations`);
    // Show first 5 unique values
    const unique = [...new Set(values.map(v => v.join(',')))].slice(0, 5);
    for (const v of unique) {
        console.log(`  [${v}]`);
    }
}

console.log('\n=== Refactored Color Operations ===');
for (const [op, values] of Object.entries(refactoredSummary)) {
    console.log(`${op}: ${values.length} operations`);
    // Show first 5 unique values
    const unique = [...new Set(values.map(v => v.join(',')))].slice(0, 5);
    for (const v of unique) {
        console.log(`  [${v}]`);
    }
}

// Compare CMYK values
console.log('\n=== CMYK Value Comparison (k/K operators) ===');
const legacyK = legacyColors.filter(c => c.operator === 'k' || c.operator === 'K');
const refactoredK = refactoredColors.filter(c => c.operator === 'k' || c.operator === 'K');

console.log(`Legacy: ${legacyK.length} CMYK operations`);
console.log(`Refactored: ${refactoredK.length} CMYK operations`);

// Check for K=0 or K=100 issues
const refactoredKValues = refactoredK.map(c => c.values[3]); // K channel
const kZeroCount = refactoredKValues.filter(k => k === 0).length;
const kFullCount = refactoredKValues.filter(k => k === 1).length;

console.log(`\nRefactored K channel distribution:`);
console.log(`  K=0: ${kZeroCount} (${(kZeroCount / refactoredK.length * 100).toFixed(1)}%)`);
console.log(`  K=1 (100%): ${kFullCount} (${(kFullCount / refactoredK.length * 100).toFixed(1)}%)`);
console.log(`  Other: ${refactoredK.length - kZeroCount - kFullCount}`);

// Show sample differences
console.log('\n=== Sample Differences (first 10) ===');
const minLen = Math.min(legacyK.length, refactoredK.length);
let diffCount = 0;
for (let i = 0; i < minLen && diffCount < 10; i++) {
    const l = legacyK[i].values;
    const r = refactoredK[i].values;
    const diff = l.some((v, j) => Math.abs(v - r[j]) > 0.001);
    if (diff) {
        console.log(`  Op ${i}: Legacy [${l.join(',')}] vs Refactored [${r.join(',')}]`);
        diffCount++;
    }
}
