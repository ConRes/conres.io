#!/usr/bin/env node
// @ts-check
/**
 * Create structured compatibility test folder for Acrobat legacy testing.
 *
 * Variant design rationale:
 *   - 00: unmodified baseline (confirms the problem)
 *   - 01: traditional xref table (most likely cause of OPENING failure in old Acrobat)
 *   - 02–04: single fixes in isolation, each with xref streams (default pdf-lib format)
 *   - 05: all structural fixes, xref streams
 *   - 06: all structural fixes, traditional xref table
 *
 * What the preflight (PDF/X-4) catches:
 *   - RUL118: Page missing TrimBox/ArtBox → fixed by geometry
 *   - RUL123: Document ID missing → fixed by document ID
 *   - RUL42/RUL54: XMP metadata missing → not fixed (complex, separate effort)
 *   - RUL202: Font not embedded → not fixable with pdf-lib
 *
 * What preflight does NOT catch but may affect old Acrobat:
 *   - Cross-reference stream format (PDF 1.5+ feature)
 *   - ICC profile stream missing /N, /Alternate, /Filter
 *
 * @author Saleh Abdel Motaal <dev@smotaal.io>
 * @ai Claude Opus 4.6 (code generation)
 */

import { readFile, writeFile, mkdir, copyFile, rm } from 'fs/promises';
import { resolve, join } from 'path';
import {
    PDFDocument,
    PDFDict,
    PDFArray,
    PDFName,
    PDFRef,
    PDFRawStream,
    PDFHexString,
} from '../../packages/pdf-lib/pdf-lib.esm.js';

const DOCKET_PATH = '2026-03-30 - ConRes - ISO PTF - CR1 (F10a) Assets - Canon iPR C10000VP series Coated MGCR v1.2 - Docket.pdf';

const TEST_PREFIX = '2026-03-29 - Test Form Generator - Tests - Compatibility 1A';
const ROOT_DIR = `${TEST_PREFIX} - Acrobat Legacy`;

// ============================================================================
// Fix functions
// ============================================================================

/** @param {PDFDocument} doc */
function fixPageGeometry(doc) {
    for (const page of doc.getPages()) {
        const node = page.node;
        const mediaBox = node.lookup(PDFName.of('MediaBox'));
        if (!mediaBox) continue;
        for (const box of ['TrimBox', 'BleedBox', 'CropBox']) {
            if (!node.get(PDFName.of(box))) node.set(PDFName.of(box), mediaBox);
        }
    }
}

/** @param {PDFDocument} doc */
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
        if (profileStream.dict.get(PDFName.of('N'))) continue;

        const rawContents = profileStream.getContents();
        const sig = String.fromCharCode(rawContents[16], rawContents[17], rawContents[18], rawContents[19]);
        let n, alternate;
        switch (sig.trim()) {
            case 'CMYK': n = 4; alternate = 'DeviceCMYK'; break;
            case 'RGB': n = 3; alternate = 'DeviceRGB'; break;
            case 'GRAY': n = 1; alternate = 'DeviceGray'; break;
            default: continue;
        }

        doc.context.assign(profileRef, doc.context.flateStream(rawContents, {
            N: n,
            Alternate: alternate,
        }));
    }
}

/** @param {PDFDocument} doc */
function fixDocumentID(doc) {
    if (doc.context.trailerInfo.ID) return;
    const generateHexId = () => {
        const bytes = new Uint8Array(16);
        for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
        return PDFHexString.of(Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join(''));
    };
    const idArray = PDFArray.withContext(doc.context);
    idArray.push(generateHexId());
    idArray.push(generateHexId());
    doc.context.trailerInfo.ID = doc.context.register(idArray);
}

// ============================================================================
// Variant definitions
// ============================================================================

/**
 * @typedef {{
 *   number: string,
 *   label: string,
 *   bullet: string,
 *   fixes: string[],
 *   traditionalXref: boolean,
 *   isOriginal?: boolean,
 * }} Variant
 */

/** @type {Variant[]} */
const variants = [
    {
        number: '00',
        label: 'Original Docket',
        bullet: 'Unmodified docket PDF — confirms the problem exists',
        fixes: [],
        traditionalXref: false,
        isOriginal: true,
    },
    {
        number: '01',
        label: 'Traditional Cross-Reference Table',
        bullet: 'Uses traditional xref table instead of cross-reference streams — tests if the internal file index format is the cause',
        fixes: [],
        traditionalXref: true,
    },
    {
        number: '02',
        label: 'Fix Page Geometry',
        bullet: 'Adds TrimBox, BleedBox, and CropBox to each page (set to the MediaBox values) — tests if missing page boxes are the cause',
        fixes: ['geometry'],
        traditionalXref: false,
    },
    {
        number: '03',
        label: 'Fix Output Intent Profile',
        bullet: 'Adds required ICC profile stream attributes (/N, /Alternate) and applies compression — tests if the bare profile stream is the cause',
        fixes: ['profile'],
        traditionalXref: false,
    },
    {
        number: '04',
        label: 'Fix Document ID',
        bullet: 'Adds the Document ID entry required by PDF standards — tests if missing document ID is the cause',
        fixes: ['documentId'],
        traditionalXref: false,
    },
    {
        number: '05',
        label: 'All Fixes',
        bullet: 'All structural fixes combined (page geometry, output intent profile, document ID) — tests if the combination resolves the problem',
        fixes: ['geometry', 'profile', 'documentId'],
        traditionalXref: false,
    },
    {
        number: '06',
        label: 'All Fixes with Traditional Cross-Reference Table',
        bullet: 'All structural fixes combined with the traditional xref table format — maximum compatibility',
        fixes: ['geometry', 'profile', 'documentId'],
        traditionalXref: true,
    },
];

// ============================================================================
// Generate
// ============================================================================

const docketBytes = await readFile(DOCKET_PATH);

// Clean and recreate
await rm(ROOT_DIR, { recursive: true, force: true });
await mkdir(ROOT_DIR, { recursive: true });

const readmeLines = [];
readmeLines.push(`# ${TEST_PREFIX}`);
readmeLines.push('');
readmeLines.push('## Instructions');
readmeLines.push('');
readmeLines.push('- Open each PDF one at a time, **in numbered order** (00 through 06)');
readmeLines.push('- **Quit and relaunch Acrobat** between each attempt');
readmeLines.push('- For each PDF:');
readmeLines.push('  - Take a full-screen screenshot (Shift + Command + 3) of any **error message**');
readmeLines.push('  - Take a separate screenshot of the **Acrobat window** after opening completes');
readmeLines.push('  - Move the screenshots into that PDF\'s folder');
readmeLines.push('- When done, compress this entire folder and send it back');
readmeLines.push('');
readmeLines.push('## Variants');
readmeLines.push('');

for (const variant of variants) {
    const folderName = `${variant.number} - ${variant.label}`;
    const pdfName = `${TEST_PREFIX} - ${variant.number} - ${variant.label}.pdf`;
    const folderPath = join(ROOT_DIR, folderName);

    await mkdir(folderPath, { recursive: true });

    if (variant.isOriginal) {
        await copyFile(DOCKET_PATH, join(folderPath, pdfName));
    } else {
        const doc = await PDFDocument.load(docketBytes, { updateMetadata: false });
        for (const fix of variant.fixes) {
            switch (fix) {
                case 'geometry': fixPageGeometry(doc); break;
                case 'profile': fixOutputIntentProfile(doc); break;
                case 'documentId': fixDocumentID(doc); break;
            }
        }
        const savedBytes = await doc.save({
            addDefaultPage: false,
            updateFieldAppearances: false,
            useObjectStreams: !variant.traditionalXref,
        });
        await writeFile(join(folderPath, pdfName), savedBytes);
    }

    readmeLines.push(`### ${variant.number} — ${variant.label}`);
    readmeLines.push('');
    readmeLines.push(`- ${variant.bullet}`);
    readmeLines.push('');

    console.log(`${folderName}/  ${pdfName}`);
}

readmeLines.push('---');
readmeLines.push('');
readmeLines.push('## How to Read the Results');
readmeLines.push('');
readmeLines.push('- If **only 01** opens successfully, the cause is the cross-reference stream format');
readmeLines.push('- If **only 02** opens, the cause is the missing page geometry boxes');
readmeLines.push('- If **only 03** opens, the cause is the bare ICC profile stream');
readmeLines.push('- If **only 04** opens, the cause is the missing document ID');
readmeLines.push('- If **only 05 or 06** opens, it requires multiple fixes combined');
readmeLines.push('- If **nothing** opens, the cause is something else entirely');
readmeLines.push('');

await writeFile(join(ROOT_DIR, 'README.md'), readmeLines.join('\n'));

console.log('\nDone.');
