#!/usr/bin/env node
// @ts-check
/**
 * Verify that each compatibility test variant has the intended structural differences.
 *
 * @author Saleh Abdel Motaal <dev@smotaal.io>
 * @ai Claude Opus 4.6 (code generation)
 */

import { readFile, readdir } from 'fs/promises';
import { join } from 'path';
import {
    PDFDocument, PDFDict, PDFArray, PDFName, PDFRef, PDFRawStream, PDFNumber,
} from '../../packages/pdf-lib/pdf-lib.esm.js';

const ROOT = '2026-03-29 - Test Form Generator - Tests - Compatibility 1A - Acrobat Legacy';

const folders = (await readdir(ROOT, { withFileTypes: true }))
    .filter(d => d.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name));

for (const folder of folders) {
    const files = await readdir(join(ROOT, folder.name));
    const pdfFile = files.find(f => f.endsWith('.pdf'));
    if (!pdfFile) continue;

    const bytes = await readFile(join(ROOT, folder.name, pdfFile));
    const doc = await PDFDocument.load(bytes, { updateMetadata: false });

    // Check xref format from raw bytes
    const tail = new TextDecoder('latin1').decode(bytes.slice(Math.max(0, bytes.length - 2048)));
    const hasXrefTable = tail.includes('\nxref\n') || tail.includes('\rxref\r') || tail.includes('\nxref\r');
    const xrefFormat = hasXrefTable ? 'traditional table' : 'cross-reference stream';

    // Check page geometry (first page)
    const page = doc.getPages()[0].node;
    const hasTrimBox = !!page.get(PDFName.of('TrimBox'));
    const hasBleedBox = !!page.get(PDFName.of('BleedBox'));
    const hasCropBox = !!page.get(PDFName.of('CropBox'));

    // Check output intent profile attributes
    let profileN = null;
    let profileAlternate = null;
    let profileFilter = null;
    const outputIntents = doc.catalog.lookup(PDFName.of('OutputIntents'));
    if (outputIntents instanceof PDFArray && outputIntents.size() > 0) {
        const intent = outputIntents.lookup(0);
        if (intent instanceof PDFDict) {
            const ref = intent.get(PDFName.of('DestOutputProfile'));
            if (ref instanceof PDFRef) {
                const stream = doc.context.lookup(ref);
                if (stream instanceof PDFRawStream) {
                    const n = stream.dict.get(PDFName.of('N'));
                    profileN = n instanceof PDFNumber ? n.numberValue : null;
                    const alt = stream.dict.get(PDFName.of('Alternate'));
                    profileAlternate = alt instanceof PDFName ? alt.encodedName : null;
                    const filter = stream.dict.get(PDFName.of('Filter'));
                    profileFilter = filter instanceof PDFName ? filter.encodedName : null;
                }
            }
        }
    }

    // Check document ID
    const hasDocID = !!doc.context.trailerInfo.ID;

    console.log(`${folder.name}`);
    console.log(`  xref:      ${xrefFormat}`);
    console.log(`  TrimBox:   ${hasTrimBox}  BleedBox: ${hasBleedBox}  CropBox: ${hasCropBox}`);
    console.log(`  Profile:   N=${profileN ?? 'MISSING'}  Alternate=${profileAlternate ?? 'MISSING'}  Filter=${profileFilter ?? 'MISSING'}`);
    console.log(`  Doc ID:    ${hasDocID}`);
    console.log();
}
