#!/usr/bin/env node
// @ts-check
/**
 * Create incrementally-fixed variants of the docket PDF
 * to isolate what causes Acrobat CS6.5 compatibility failure.
 *
 * @author Saleh Abdel Motaal <dev@smotaal.io>
 * @ai Claude Opus 4.5 (code generation)
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { resolve, basename } from 'path';
import {
    PDFDocument,
    PDFDict,
    PDFArray,
    PDFName,
    PDFRef,
    PDFRawStream,
    PDFStream,
    PDFString,
    PDFHexString,
    PDFNumber,
} from '../../packages/pdf-lib/pdf-lib.esm.js';

// pako is bundled inside pdf-lib — we use context.flateStream() instead of raw deflate

const DOCKET_PATH = '2026-03-30 - ConRes - ISO PTF - CR1 (F10a) Assets - Canon iPR C10000VP series Coated MGCR v1.2 - Docket.pdf';

const OUTPUT_DIR = 'variants';

/**
 * Fix 1: Add TrimBox, BleedBox, CropBox to all pages (copy from MediaBox).
 * @param {PDFDocument} doc
 */
function fixPageGeometry(doc) {
    const pages = doc.getPages();
    for (const page of pages) {
        const node = page.node;
        const mediaBox = node.lookup(PDFName.of('MediaBox'));
        if (mediaBox) {
            if (!node.get(PDFName.of('TrimBox'))) node.set(PDFName.of('TrimBox'), mediaBox);
            if (!node.get(PDFName.of('BleedBox'))) node.set(PDFName.of('BleedBox'), mediaBox);
            if (!node.get(PDFName.of('CropBox'))) node.set(PDFName.of('CropBox'), mediaBox);
        }
    }
}

/**
 * Fix 2: Fix DestOutputProfile stream attributes (/N, /Alternate, /Filter + compress).
 * @param {PDFDocument} doc
 */
function fixOutputIntentProfile(doc) {
    const outputIntents = doc.catalog.lookup(PDFName.of('OutputIntents'));
    if (!(outputIntents instanceof PDFArray)) return;

    for (let i = 0; i < outputIntents.size(); i++) {
        const intent = outputIntents.lookup(i);
        if (!(intent instanceof PDFDict)) continue;

        const profileRef = intent.get(PDFName.of('DestOutputProfile'));
        if (!(profileRef instanceof PDFRef)) continue;

        const profileStream = doc.context.lookup(profileRef);
        if (!(profileStream instanceof PDFRawStream)) continue;

        const rawContents = profileStream.getContents();
        const dict = profileStream.dict;

        // Check if already has /N — skip if properly formed
        if (dict.get(PDFName.of('N'))) continue;

        // Determine N from ICC profile header (bytes 16-19 = color space signature)
        const colorSpaceSig = String.fromCharCode(rawContents[16], rawContents[17], rawContents[18], rawContents[19]);
        let n, alternate;
        switch (colorSpaceSig.trim()) {
            case 'CMYK': n = 4; alternate = 'DeviceCMYK'; break;
            case 'RGB': n = 3; alternate = 'DeviceRGB'; break;
            case 'GRAY': n = 1; alternate = 'DeviceGray'; break;
            default:
                console.warn(`  Unknown ICC color space signature: "${colorSpaceSig}"`);
                continue;
        }

        // Create new properly-formed stream (flateStream compresses + adds /Filter)
        const newStream = doc.context.flateStream(rawContents, {
            N: n,
            Alternate: alternate,
        });

        // Replace the old stream object in the context
        doc.context.assign(profileRef, newStream);

        const newSize = newStream.getContentsSize();
        console.log(`  Fixed DestOutputProfile: /N ${n}, /Alternate /${alternate}, compressed ${rawContents.length} → ${newSize} bytes`);
    }
}

/**
 * Fix 3: Add Document ID (required by some PDF standards).
 * @param {PDFDocument} doc
 */
function fixDocumentID(doc) {
    const trailerInfo = doc.context.trailerInfo;
    if (!trailerInfo.ID) {
        // Generate two random 16-byte hex strings
        const generateHexId = () => {
            const bytes = new Uint8Array(16);
            for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
            return PDFHexString.of(Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join(''));
        };
        const id1 = generateHexId();
        const id2 = generateHexId();
        const idArray = PDFArray.withContext(doc.context);
        idArray.push(id1);
        idArray.push(id2);
        // Set on the trailer dict directly through the context
        // The trailerInfo doesn't have a direct ID setter, but we can set it
        // on the xref/trailer structure
        trailerInfo.ID = doc.context.register(idArray);
        console.log('  Added Document ID');
    }
}

/**
 * Save variant with useObjectStreams disabled (traditional xref table).
 * This tests whether cross-reference streams are the issue.
 * @param {PDFDocument} doc
 * @returns {Promise<Uint8Array>}
 */
async function saveWithTraditionalXref(doc) {
    return doc.save({
        addDefaultPage: false,
        updateFieldAppearances: false,
        useObjectStreams: false,
    });
}

/**
 * Save variant with useObjectStreams enabled (default, cross-reference streams).
 * @param {PDFDocument} doc
 * @returns {Promise<Uint8Array>}
 */
async function saveWithXrefStreams(doc) {
    return doc.save({
        addDefaultPage: false,
        updateFieldAppearances: false,
    });
}

// ============================================================================
// Main
// ============================================================================

const docketBytes = await readFile(DOCKET_PATH);
await mkdir(OUTPUT_DIR, { recursive: true });

/**
 * @typedef {{ name: string, description: string, fixes: string[], xrefMode: 'stream' | 'table' | 'both' }} VariantSpec
 */

/** @type {VariantSpec[]} */
const variants = [
    {
        name: '00-original',
        description: 'Original docket, unchanged (baseline)',
        fixes: [],
        xrefMode: 'both',
    },
    {
        name: '01-fix-geometry',
        description: 'TrimBox/BleedBox/CropBox set from MediaBox',
        fixes: ['geometry'],
        xrefMode: 'stream',
    },
    {
        name: '02-fix-profile',
        description: 'DestOutputProfile stream gets /N, /Alternate, /Filter FlateDecode',
        fixes: ['profile'],
        xrefMode: 'stream',
    },
    {
        name: '03-fix-geometry-profile',
        description: 'Both geometry and profile fixes',
        fixes: ['geometry', 'profile'],
        xrefMode: 'stream',
    },
    {
        name: '04-fix-all',
        description: 'Geometry + profile + document ID',
        fixes: ['geometry', 'profile', 'documentId'],
        xrefMode: 'stream',
    },
    {
        name: '05-traditional-xref',
        description: 'Original with traditional xref table (no cross-reference streams)',
        fixes: [],
        xrefMode: 'table',
    },
    {
        name: '06-traditional-xref-fix-all',
        description: 'All fixes + traditional xref table',
        fixes: ['geometry', 'profile', 'documentId'],
        xrefMode: 'table',
    },
];

console.log(`Source: ${DOCKET_PATH}`);
console.log(`Output: ${OUTPUT_DIR}/\n`);

for (const variant of variants) {
    const modes = variant.xrefMode === 'both'
        ? [['stream', 'xref-stream'], ['table', 'xref-table']]
        : [[variant.xrefMode, variant.xrefMode === 'table' ? 'xref-table' : 'xref-stream']];

    for (const [mode, suffix] of modes) {
        const doc = await PDFDocument.load(docketBytes, { updateMetadata: false });

        console.log(`${variant.name} (${suffix}): ${variant.description}`);

        for (const fix of variant.fixes) {
            switch (fix) {
                case 'geometry': fixPageGeometry(doc); break;
                case 'profile': fixOutputIntentProfile(doc); break;
                case 'documentId': fixDocumentID(doc); break;
            }
        }

        const savedBytes = mode === 'table'
            ? await saveWithTraditionalXref(doc)
            : await saveWithXrefStreams(doc);

        const filename = `Docket - ${variant.name} (${suffix}).pdf`;
        await writeFile(resolve(OUTPUT_DIR, filename), savedBytes);
        console.log(`  → ${filename} (${(savedBytes.length / 1024).toFixed(0)} KB)\n`);
    }
}

console.log('Done. Have Franz test each variant in Acrobat CS6.5.');
console.log('The first one that opens successfully identifies the fix.');
