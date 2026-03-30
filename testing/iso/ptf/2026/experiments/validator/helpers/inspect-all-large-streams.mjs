#!/usr/bin/env node
// @ts-check
/**
 * Find ALL streams over 100KB to locate the ICC profile created by setOutputIntentForPDFDocument
 */

import { readFile } from 'fs/promises';
import { resolve, basename } from 'path';
import {
    PDFDocument, PDFRawStream, PDFStream, PDFName, PDFNumber, PDFRef,
} from '../../packages/pdf-lib/pdf-lib.esm.js';

const filePath = process.argv[2];
if (!filePath) { console.error('Usage: node inspect-all-large-streams.mjs <pdf>'); process.exit(1); }

const bytes = await readFile(resolve(filePath));
const doc = await PDFDocument.load(bytes, { updateMetadata: false });

console.log(`FILE: ${basename(filePath)}`);
console.log(`Largest object number: ${doc.context.largestObjectNumber}`);

// Find OutputIntent DestOutputProfile ref
const outputIntents = doc.catalog.lookup(PDFName.of('OutputIntents'));
let destProfileRef = null;
if (outputIntents && outputIntents.size?.() > 0) {
    const intent = outputIntents.lookup(0);
    if (intent) {
        const rawRef = intent.get?.(PDFName.of('DestOutputProfile'));
        if (rawRef instanceof PDFRef) destProfileRef = rawRef;
    }
}
if (destProfileRef) {
    console.log(`DestOutputProfile ref: ${destProfileRef.objectNumber} ${destProfileRef.generationNumber} R`);
}

// Enumerate ALL large streams (> 100KB)
console.log('\n--- Streams > 100KB ---');
const allObjects = doc.context.enumerateIndirectObjects();
for (const [ref, obj] of allObjects) {
    if (!(obj instanceof PDFRawStream) && !(obj instanceof PDFStream)) continue;

    let contentSize;
    try { contentSize = obj.getContentsSize(); } catch { continue; }

    if (contentSize < 100000) continue;

    const isDestProfile = destProfileRef && ref.objectNumber === destProfileRef.objectNumber;
    const dict = obj.dict;

    // Get key attributes
    const filter = dict?.get?.(PDFName.of('Filter'));
    const n = dict?.get?.(PDFName.of('N'));
    const alternate = dict?.get?.(PDFName.of('Alternate'));
    const length = dict?.get?.(PDFName.of('Length'));
    const type = dict?.get?.(PDFName.of('Type'));
    const subtype = dict?.get?.(PDFName.of('Subtype'));
    const width = dict?.get?.(PDFName.of('Width'));

    const attrs = [];
    if (type) attrs.push(`Type=${type instanceof PDFName ? type.encodedName : type}`);
    if (subtype) attrs.push(`Subtype=${subtype instanceof PDFName ? subtype.encodedName : subtype}`);
    if (filter) attrs.push(`Filter=${filter instanceof PDFName ? filter.encodedName : filter}`);
    if (n) attrs.push(`N=${n instanceof PDFNumber ? n.numberValue : n}`);
    if (alternate) attrs.push(`Alternate=${alternate instanceof PDFName ? alternate.encodedName : alternate}`);
    if (width) attrs.push(`Width=${width instanceof PDFNumber ? width.numberValue : width}`);
    const lengthVal = length instanceof PDFNumber ? length.numberValue : '?';

    console.log(`  ${ref.objectNumber} ${ref.generationNumber} R: ${contentSize} bytes (Length=${lengthVal}) ${attrs.join(', ')} ${isDestProfile ? '*** DestOutputProfile ***' : ''}`);
}
