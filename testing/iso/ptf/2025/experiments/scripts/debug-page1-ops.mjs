#!/usr/bin/env node
import { PDFDocument, PDFName, PDFRef, PDFArray, decodePDFRawStream } from 'pdf-lib';
import { readFile } from 'fs/promises';

const pdfPath = process.argv[2] || 'output/2026-02-03-023/test-lab-values-v3.pdf';
console.log('Loading PDF:', pdfPath);
const pdfBytes = await readFile(pdfPath);
const pdfDoc = await PDFDocument.load(pdfBytes);

const pages = pdfDoc.getPages();
const page = pages[0];
const pageDict = pdfDoc.context.lookup(page.ref);

// Get Contents
const contents = pageDict.get(PDFName.of('Contents'));
console.log('Contents type:', contents?.constructor?.name);

let contentRefs = [];
if (contents instanceof PDFRef) {
    contentRefs = [contents];
} else if (contents instanceof PDFArray) {
    contentRefs = contents.asArray();
}

console.log('Content streams:', contentRefs.length);

// Check first two streams
for (let i = 0; i < Math.min(1, contentRefs.length); i++) {
    const ref = contentRefs[i];
    console.log('\n=== Stream ' + i + ': ' + ref.toString() + ' ===');

    const stream = pdfDoc.context.lookup(ref);
    const decoded = decodePDFRawStream(stream).decode();
    const text = new TextDecoder().decode(decoded);

    // Show first 2000 chars
    console.log('\n--- First 2000 chars of stream ---');
    console.log(text.substring(0, 2000));
    console.log('\n--- End of preview ---\n');

    // Find all color operations
    const ops = [];

    // Lab scn/SCN with /Lab cs
    const labPattern = /\/Lab\s+(cs|CS)\s+([\d.\-]+)\s+([\d.\-]+)\s+([\d.\-]+)\s+(scn|SCN)/g;
    let match;
    while ((match = labPattern.exec(text)) !== null) {
        ops.push({ type: 'lab', pos: match.index, op: match[0].substring(0, 60) });
    }

    // Device RGB
    const rgbPattern = /([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+(RG|rg)/g;
    while ((match = rgbPattern.exec(text)) !== null) {
        ops.push({ type: 'deviceRGB', pos: match.index, op: match[0] });
    }

    // Device Gray
    const grayPattern = /([\d.]+)\s+(G|g)(?!\S)/g;
    while ((match = grayPattern.exec(text)) !== null) {
        ops.push({ type: 'deviceGray', pos: match.index, op: match[0] });
    }

    // Device CMYK
    const cmykPattern = /([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+(K|k)/g;
    while ((match = cmykPattern.exec(text)) !== null) {
        ops.push({ type: 'deviceCMYK', pos: match.index, op: match[0] });
    }

    // ICCBased SC/SCN/sc/scn (with /CS* prefix)
    const iccPattern = /\/CS\d+\s+(cs|CS)\s+([\d.\-]+(?:\s+[\d.\-]+)*)\s+(sc|SC|scn|SCN)/g;
    while ((match = iccPattern.exec(text)) !== null) {
        ops.push({ type: 'iccBased', pos: match.index, op: match[0].substring(0, 80) });
    }

    // Sort by position
    ops.sort((a, b) => a.pos - b.pos);

    console.log('Total color ops found:', ops.length);

    // Count by type
    const counts = {};
    for (const op of ops) {
        counts[op.type] = (counts[op.type] || 0) + 1;
    }
    console.log('By type:', counts);

    // Show first 20 ops
    console.log('\nFirst 20 operations:');
    for (let j = 0; j < Math.min(20, ops.length); j++) {
        console.log('  ' + ops[j].type + ': ' + ops[j].op);
    }

    // Show all CMYK operations
    const cmykOps = ops.filter(o => o.type === 'deviceCMYK');
    if (cmykOps.length > 0) {
        console.log('\nAll DeviceCMYK operations:');
        for (const op of cmykOps) {
            console.log('  pos ' + op.pos + ': ' + op.op);
        }
    }

    // Look for problematic patterns - scn/SCN not preceded by /Lab cs
    console.log('\n--- Looking for scn/SCN without /Lab cs ---');
    const allScn = [...text.matchAll(/([\d.\-]+)\s+([\d.\-]+)\s+([\d.\-]+)\s+(scn|SCN)/g)];
    let problemCount = 0;
    for (const m of allScn) {
        const before = text.substring(Math.max(0, m.index - 30), m.index);
        if (!before.includes('/Lab cs') && !before.includes('/Lab CS')) {
            if (problemCount < 5) {
                console.log('  At ' + m.index + ': ...' + before + m[0]);
            }
            problemCount++;
        }
    }
    console.log('  Total orphan scn/SCN:', problemCount);

    // Check for any out-of-range Lab values
    console.log('\n--- Checking for out-of-range Lab values ---');
    const labValues = [...text.matchAll(/\/Lab\s+(cs|CS)\s+([\d.\-]+)\s+([\d.\-]+)\s+([\d.\-]+)\s+(scn|SCN)/g)];
    let outOfRange = 0;
    for (const m of labValues) {
        const L = parseFloat(m[2]);
        const a = parseFloat(m[3]);
        const b = parseFloat(m[4]);
        if (L < 0 || L > 100 || a < -128 || a > 127 || b < -128 || b > 127) {
            console.log('  Out of range: L=' + L + ' a=' + a + ' b=' + b);
            outOfRange++;
        }
    }
    console.log('  Total out of range:', outOfRange);

    // Look for double cs/CS operators
    console.log('\n--- Checking for double cs/CS sequences ---');
    const doubleCs = [...text.matchAll(/(\/\w+\s+cs\s+\/\w+\s+cs|\/\w+\s+CS\s+\/\w+\s+CS)/gi)];
    console.log('  Double cs/CS found:', doubleCs.length);
    for (let j = 0; j < Math.min(5, doubleCs.length); j++) {
        console.log('    ' + doubleCs[j][0]);
    }
}
