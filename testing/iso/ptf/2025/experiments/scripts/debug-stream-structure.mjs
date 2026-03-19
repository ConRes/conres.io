#!/usr/bin/env node
import { PDFDocument, PDFName, PDFRef, PDFArray, decodePDFRawStream } from 'pdf-lib';
import { readFile } from 'fs/promises';

const pdfPath = process.argv[2] || 'output/2026-02-03-023/test-lab-values-v5.pdf';
console.log('Loading PDF:', pdfPath);
const pdfBytes = await readFile(pdfPath);
const pdfDoc = await PDFDocument.load(pdfBytes);

const pages = pdfDoc.getPages();
const page = pages[0];
const pageDict = pdfDoc.context.lookup(page.ref);

const contents = pageDict.get(PDFName.of('Contents'));
let contentRefs = [];
if (contents instanceof PDFRef) {
    contentRefs = [contents];
} else if (contents instanceof PDFArray) {
    contentRefs = contents.asArray();
}

console.log('Content streams:', contentRefs.length);

// Check stream 1 (86 0 R) which has left side content
for (let i = 1; i < Math.min(2, contentRefs.length); i++) {
    const ref = contentRefs[i];
    console.log('\n=== Stream ' + i + ': ' + ref.toString() + ' ===');

    const stream = pdfDoc.context.lookup(ref);
    const decoded = decodePDFRawStream(stream).decode();
    const text = new TextDecoder().decode(decoded);

    console.log('Stream length:', text.length);

    // Find single-value scn operations and their preceding color space
    console.log('\n--- Single-value scn operations ---');
    const singleScnPattern = /(?:^|[^.\d])([\d.]+)\s+scn/g;
    let singleScns = [];
    let match;
    while ((match = singleScnPattern.exec(text)) !== null && singleScns.length < 10) {
        const pos = match.index;
        // Find preceding color space operation
        const before = text.substring(Math.max(0, pos - 200), pos);
        const csMatch = before.match(/\/(CS\d+|Lab)\s+(cs|CS)/g);
        const lastCs = csMatch ? csMatch[csMatch.length - 1] : 'none found';
        singleScns.push({
            pos,
            value: match[1],
            precedingCs: lastCs,
            context: text.substring(pos, pos + 30),
        });
    }
    console.log('Single-value scn operations:', singleScns);

    // Find rectangles with low x coordinates (left side of page)
    // Pattern: x y width height re
    const rectPattern = /([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+re/g;
    let match;
    let leftRects = [];
    while ((match = rectPattern.exec(text)) !== null) {
        const x = parseFloat(match[1]);
        if (x < 200) {  // Left side of page
            leftRects.push({ x, y: parseFloat(match[2]), pos: match.index });
        }
    }

    if (leftRects.length > 0) {
        console.log('Rectangles on left side (x < 200):', leftRects.length);
        console.log('First 5:', leftRects.slice(0, 5));
    }

    // Check for any malformed operators or unusual patterns
    // Look for scn/SCN with wrong number of operands
    const scnPattern = /((?:[\d.\-]+\s+)+)(scn|SCN)/g;
    let badScn = [];
    while ((match = scnPattern.exec(text)) !== null) {
        const operands = match[1].trim().split(/\s+/);
        // Lab needs 3 operands, Gray needs 1
        if (operands.length !== 1 && operands.length !== 3 && operands.length !== 4) {
            badScn.push({ pos: match.index, operands: operands.length, text: match[0].substring(0, 50) });
        }
    }

    if (badScn.length > 0) {
        console.log('Unusual scn/SCN operand counts:', badScn);
    }

    // Check for incomplete or broken Lab cs sequences
    const labCsPattern = /\/Lab\s+(cs|CS)(\s+|$)/g;
    let brokenLab = [];
    while ((match = labCsPattern.exec(text)) !== null) {
        // Check what follows
        const after = text.substring(match.index + match[0].length, match.index + match[0].length + 50);
        // Should be followed by numbers then scn/SCN
        if (!/^[\d.\-]+\s+[\d.\-]+\s+[\d.\-]+\s+(scn|SCN)/.test(after)) {
            brokenLab.push({ pos: match.index, after: after.substring(0, 30) });
        }
    }

    if (brokenLab.length > 0) {
        console.log('Broken /Lab cs sequences:', brokenLab);
    }
}
