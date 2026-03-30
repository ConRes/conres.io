#!/usr/bin/env node
// @ts-check
/**
 * Dump all operators from first few pages' content streams.
 */

import { readFile } from 'fs/promises';
import { resolve, basename } from 'path';
import {
    PDFDocument, PDFDict, PDFArray, PDFName, PDFRef, PDFRawStream,
    decodePDFRawStream,
} from '../../packages/pdf-lib/pdf-lib.esm.js';

const filePath = process.argv[2];
const pageNum = parseInt(process.argv[3] || '1', 10);
if (!filePath) { console.error('Usage: node dump-content-ops.mjs <pdf> [pageNum]'); process.exit(1); }

const bytes = await readFile(resolve(filePath));
const doc = await PDFDocument.load(bytes, { updateMetadata: false });
const pages = doc.getPages();

console.log(`FILE: ${basename(filePath)}`);
console.log(`Total pages: ${pages.length}\n`);

const pageIdx = pageNum - 1;
if (pageIdx >= pages.length) { console.error('Page out of range'); process.exit(1); }

const page = pages[pageIdx];
const pageNode = page.node;

// Dump Resources structure
const resources = pageNode.lookup(PDFName.of('Resources'));
if (resources instanceof PDFDict) {
    console.log(`Page ${pageNum} Resources keys:`);
    for (const [key] of resources.entries()) {
        const name = key instanceof PDFName ? key.encodedName : String(key);
        const val = resources.lookup(key);
        if (val instanceof PDFDict) {
            const subKeys = [];
            for (const [sk] of val.entries()) {
                subKeys.push(sk instanceof PDFName ? sk.encodedName : String(sk));
            }
            console.log(`  /${name}: { ${subKeys.join(', ')} }`);
        } else {
            console.log(`  /${name}: ${val}`);
        }
    }
}

// Get content streams
const contentsRaw = pageNode.get(PDFName.of('Contents'));
const contentRefs = [];
if (contentsRaw instanceof PDFRef) {
    contentRefs.push(contentsRaw);
} else if (contentsRaw instanceof PDFArray) {
    for (let j = 0; j < contentsRaw.size(); j++) {
        const item = contentsRaw.get(j);
        if (item instanceof PDFRef) contentRefs.push(item);
    }
}

console.log(`\nContent streams: ${contentRefs.length}`);

for (const ref of contentRefs) {
    const streamObj = doc.context.lookup(ref);
    if (streamObj instanceof PDFRawStream) {
        try {
            const decoded = decodePDFRawStream(streamObj);
            const text = new TextDecoder('latin1').decode(decoded.decode());
            console.log(`\n--- Content stream ${ref.objectNumber} ${ref.generationNumber} R (${text.length} chars) ---`);
            // Show first 2000 chars
            console.log(text.substring(0, 2000));
            if (text.length > 2000) console.log(`... (${text.length - 2000} more chars)`);
        } catch (e) {
            console.log(`  Could not decode: ${e.message}`);
        }
    }
}
