#!/usr/bin/env node
// @ts-check
/**
 * Debug script to show raw stream content around a specific byte position.
 */

import { readFile } from 'node:fs/promises';
import { PDFDocument, PDFName, PDFRef, PDFArray, PDFRawStream } from 'pdf-lib';
import { decodePDFRawStream } from 'pdf-lib';

const PDF_PATH = process.argv[2];
const TARGET_PAGE = parseInt(process.argv[3] || '1', 10);
const TARGET_STREAM = parseInt(process.argv[4] || '1', 10);
const SEARCH_VALUE = process.argv[5] || '0.9825'; // Look for rich black C value

if (!PDF_PATH) {
    console.error('Usage: node debug-raw-bytes.mjs <pdf-path> [page] [stream] [search-value]');
    process.exit(1);
}

async function main() {
    console.log(`=== RAW STREAM SEARCH ===`);
    console.log(`PDF: ${PDF_PATH}`);
    console.log(`Page: ${TARGET_PAGE}, Stream: ${TARGET_STREAM}`);
    console.log(`Searching for: ${SEARCH_VALUE}\n`);

    const pdfBytes = await readFile(PDF_PATH);
    const pdfDoc = await PDFDocument.load(pdfBytes);
    const context = pdfDoc.context;
    const pages = pdfDoc.getPages();

    const pageIdx = TARGET_PAGE - 1;
    const page = pages[pageIdx];
    const pageNode = /** @type {import('pdf-lib').PDFPageLeaf} */ (page.node);

    const contents = pageNode.get(PDFName.of('Contents'));
    /** @type {PDFRef[]} */
    const streamRefs = [];

    if (contents instanceof PDFRef) {
        const resolved = context.lookup(contents);
        if (resolved instanceof PDFArray) {
            for (let i = 0; i < resolved.size(); i++) {
                const ref = resolved.get(i);
                if (ref instanceof PDFRef) streamRefs.push(ref);
            }
        } else {
            streamRefs.push(contents);
        }
    } else if (contents instanceof PDFArray) {
        for (let i = 0; i < contents.size(); i++) {
            const ref = contents.get(i);
            if (ref instanceof PDFRef) streamRefs.push(ref);
        }
    }

    const ref = streamRefs[TARGET_STREAM];
    const stream = context.lookup(ref);
    if (!(stream instanceof PDFRawStream)) {
        console.error('Not a raw stream');
        process.exit(1);
    }

    const decoded = decodePDFRawStream(stream).decode();
    const text = new TextDecoder().decode(decoded);

    console.log(`Stream length: ${text.length} bytes\n`);

    // Search for the value
    let searchPos = 0;
    let found = 0;
    while (true) {
        const idx = text.indexOf(SEARCH_VALUE, searchPos);
        if (idx === -1) break;
        found++;

        // Show context around match
        const start = Math.max(0, idx - 50);
        const end = Math.min(text.length, idx + 100);
        const context = text.substring(start, end).replace(/\n/g, '\\n');

        console.log(`Match ${found} at byte ${idx}:`);
        console.log(`  ...${context}...`);
        console.log('');

        searchPos = idx + 1;
        if (found >= 10) {
            console.log('(showing first 10 matches)');
            break;
        }
    }

    if (found === 0) {
        console.log(`Value "${SEARCH_VALUE}" NOT FOUND in stream.`);

        // Show what values ARE present around the expected position
        // Search for "k" operators
        console.log('\nSearching for CMYK "k" operators...');
        const kRegex = /(\d+\.?\d*)\s+(\d+\.?\d*)\s+(\d+\.?\d*)\s+(\d+\.?\d*)\s+k\b/g;
        let kMatch;
        let kCount = 0;
        while ((kMatch = kRegex.exec(text)) !== null && kCount < 20) {
            const [full, c, m, y, k] = kMatch;
            // Only show non-trivial values
            const cVal = parseFloat(c);
            const mVal = parseFloat(m);
            const yVal = parseFloat(y);
            const kVal = parseFloat(k);
            if (cVal > 0.1 || mVal > 0.1 || yVal > 0.1) {
                console.log(`  Position ${kMatch.index}: ${c} ${m} ${y} ${k} k`);
                kCount++;
            }
        }
        if (kCount === 0) {
            console.log('  No CMYK operators with significant CMY values found.');
        }
    }
}

main().catch(console.error);
