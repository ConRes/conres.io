#!/usr/bin/env node
// @ts-check
/**
 * Debug script to show operators at a specific position in a PDF.
 */

import { readFile } from 'node:fs/promises';
import { PDFDocument, PDFName, PDFRef, PDFArray, PDFRawStream } from 'pdf-lib';
import { decodePDFRawStream } from 'pdf-lib';
import { COLOR_OPERATOR_REGEX } from '../../classes/pdf-content-stream-color-converter.js';

const PDF_PATH = process.argv[2];
const TARGET_PAGE = parseInt(process.argv[3] || '1', 10);
const TARGET_STREAM = parseInt(process.argv[4] || '0', 10);
const TARGET_RANGE_START = parseInt(process.argv[5] || '0', 10);
const TARGET_RANGE_END = parseInt(process.argv[6] || '10', 10);

if (!PDF_PATH) {
    console.error('Usage: node debug-position.mjs <pdf-path> [page] [stream] [range-start] [range-end]');
    process.exit(1);
}

async function main() {
    console.log(`=== OPERATORS AT POSITION ===`);
    console.log(`PDF: ${PDF_PATH}`);
    console.log(`Page: ${TARGET_PAGE}, Stream: ${TARGET_STREAM}, OpIdx: ${TARGET_RANGE_START}-${TARGET_RANGE_END}\n`);

    const pdfBytes = await readFile(PDF_PATH);
    const pdfDoc = await PDFDocument.load(pdfBytes);
    const context = pdfDoc.context;
    const pages = pdfDoc.getPages();

    const pageIdx = TARGET_PAGE - 1;
    if (pageIdx < 0 || pageIdx >= pages.length) {
        console.error(`Page ${TARGET_PAGE} not found (total pages: ${pages.length})`);
        process.exit(1);
    }

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

    console.log(`Total streams: ${streamRefs.length}`);

    if (TARGET_STREAM < 0 || TARGET_STREAM >= streamRefs.length) {
        console.error(`Stream ${TARGET_STREAM} not found (total streams: ${streamRefs.length})`);
        process.exit(1);
    }

    const ref = streamRefs[TARGET_STREAM];
    const stream = context.lookup(ref);
    if (!(stream instanceof PDFRawStream)) {
        console.error(`Stream ${TARGET_STREAM} is not a raw stream`);
        process.exit(1);
    }

    const decoded = decodePDFRawStream(stream).decode();
    const text = new TextDecoder().decode(decoded);

    const regex = new RegExp(COLOR_OPERATOR_REGEX.source, 'ug');
    const regexMatches = Array.from(text.matchAll(regex));

    console.log(`\nOpIdx | Operator | Values`);
    console.log('------|----------|--------');

    let opIdx = 0;
    for (const match of regexMatches) {
        const groups = match.groups ?? {};

        // CS/cs - colorspace setting
        if (groups.csOp && groups.name) {
            if (opIdx >= TARGET_RANGE_START && opIdx <= TARGET_RANGE_END) {
                console.log(`(cs)  | ${groups.csOp.padEnd(8)} | ${groups.name}`);
            }
            continue;
        }

        // Color operators
        let operator = '';
        let values = '';

        if (groups.rgb && groups.rgOp) {
            operator = groups.rgOp;
            values = groups.rgb.trim();
        } else if (groups.cmyk && groups.kOp) {
            operator = groups.kOp;
            values = groups.cmyk.trim();
        } else if (groups.gray && groups.gOp) {
            operator = groups.gOp;
            values = groups.gray.trim();
        } else if (groups.n && groups.scOp) {
            operator = groups.scOp;
            values = groups.n.trim();
        } else if (groups.name2 && groups.scnOp) {
            operator = groups.scnOp + ' (pattern)';
            values = groups.name2;
        }

        if (operator && opIdx >= TARGET_RANGE_START && opIdx <= TARGET_RANGE_END) {
            console.log(`${String(opIdx).padStart(5)} | ${operator.padEnd(8)} | ${values}`);
        }

        if (operator) opIdx++;
    }

    console.log(`\nTotal color operators in stream: ${opIdx}`);
}

main().catch(console.error);
