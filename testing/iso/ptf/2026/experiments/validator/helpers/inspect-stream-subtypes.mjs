#!/usr/bin/env node
// @ts-check
/**
 * Enumerate all stream subtypes and their sizes in a PDF.
 *
 * @author Saleh Abdel Motaal <dev@smotaal.io>
 * @ai Claude Opus 4.6 (code generation)
 */

import { readFile } from 'fs/promises';
import { PDFDocument, PDFRawStream, PDFStream, PDFName, PDFNumber } from '../../packages/pdf-lib/pdf-lib.esm.js';

const pdfPath = process.argv[2];
if (!pdfPath) { console.error('Usage: node inspect-stream-subtypes.mjs <pdf>'); process.exit(1); }

const bytes = await readFile(pdfPath);
const doc = await PDFDocument.load(bytes, { updateMetadata: false });

/** @type {Map<string, { count: number, totalBytes: number }>} */
const categories = new Map();

const objects = doc.context.enumerateIndirectObjects();
let totalStreams = 0;

for (const [ref, obj] of objects) {
    if (!(obj instanceof PDFRawStream) && !(obj instanceof PDFStream)) continue;
    totalStreams++;

    const dict = obj.dict;
    const type = dict?.get?.(PDFName.of('Type'));
    const subtype = dict?.get?.(PDFName.of('Subtype'));
    const width = dict?.get?.(PDFName.of('Width'));
    const height = dict?.get?.(PDFName.of('Height'));

    let category;
    if (subtype instanceof PDFName && subtype.encodedName === 'Image') {
        category = 'Image';
    } else if (subtype instanceof PDFName && subtype.encodedName === 'Form') {
        category = 'Form XObject';
    } else if (type instanceof PDFName && type.encodedName === 'Metadata') {
        category = 'Metadata';
    } else if (type instanceof PDFName && type.encodedName === 'XRef') {
        category = 'XRef stream';
    } else if (type instanceof PDFName && type.encodedName === 'ObjStm') {
        category = 'Object stream';
    } else if (dict?.get?.(PDFName.of('N')) && !type) {
        category = 'ICC profile';
    } else if (width instanceof PDFNumber && height instanceof PDFNumber) {
        category = 'Image (no Subtype)';
    } else {
        // Check if it looks like a content stream (no Type/Subtype, has Filter)
        const filter = dict?.get?.(PDFName.of('Filter'));
        const hasType = !!type || !!subtype;
        category = hasType
            ? `${type instanceof PDFName ? type.encodedName : ''}/${subtype instanceof PDFName ? subtype.encodedName : ''}`
            : (filter ? 'Content/Other stream' : 'Raw stream');
    }

    let contentSize;
    try { contentSize = obj.getContentsSize(); } catch { contentSize = 0; }

    if (!categories.has(category)) categories.set(category, { count: 0, totalBytes: 0 });
    const entry = categories.get(category);
    entry.count++;
    entry.totalBytes += contentSize;
}

const MB = 1024 * 1024;
console.log(`Total streams: ${totalStreams}\n`);
console.log(`${'Category'.padEnd(25)} ${'Count'.padStart(6)} ${'Total Size'.padStart(12)} ${'Avg Size'.padStart(12)}`);
console.log('-'.repeat(60));

for (const [cat, info] of [...categories.entries()].sort((a, b) => b[1].totalBytes - a[1].totalBytes)) {
    const total = info.totalBytes >= MB ? `${(info.totalBytes / MB).toFixed(1)} MB` : `${(info.totalBytes / 1024).toFixed(1)} KB`;
    const avg = info.count > 0 ? (info.totalBytes / info.count >= MB ? `${(info.totalBytes / info.count / MB).toFixed(1)} MB` : `${(info.totalBytes / info.count / 1024).toFixed(1)} KB`) : '0';
    console.log(`${cat.padEnd(25)} ${String(info.count).padStart(6)} ${total.padStart(12)} ${avg.padStart(12)}`);
}
