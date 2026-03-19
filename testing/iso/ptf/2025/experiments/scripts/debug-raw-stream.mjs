#!/usr/bin/env node
// @ts-check
/**
 * Debug script to dump raw regex matches from a PDF content stream.
 * Shows EVERY match to identify what's being counted vs skipped.
 */

import { readFile } from 'node:fs/promises';
import { PDFDocument, PDFName, PDFRef, PDFArray, PDFRawStream } from 'pdf-lib';
import { decodePDFRawStream } from 'pdf-lib';
import { COLOR_OPERATOR_REGEX } from '../../classes/pdf-content-stream-color-converter.js';

const PDF_PATH = process.argv[2];
const TARGET_PAGE = parseInt(process.argv[3] || '1', 10);
const TARGET_STREAM = parseInt(process.argv[4] || '0', 10);
const MAX_MATCHES = parseInt(process.argv[5] || '200', 10);

if (!PDF_PATH) {
    console.error('Usage: node debug-raw-stream.mjs <pdf-path> [page] [stream] [max_matches]');
    process.exit(1);
}

async function main() {
    console.log(`=== RAW REGEX MATCHES ===`);
    console.log(`PDF: ${PDF_PATH}`);
    console.log(`Page: ${TARGET_PAGE}, Stream: ${TARGET_STREAM}\n`);

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
        console.error(`Stream ${TARGET_STREAM} is not a raw stream`);
        process.exit(1);
    }

    const decoded = decodePDFRawStream(stream).decode();
    const text = new TextDecoder().decode(decoded);

    // Show first 2000 chars of raw stream
    console.log('=== RAW STREAM (first 2000 chars) ===');
    console.log(text.substring(0, 2000));
    console.log('\n...\n');

    const regex = new RegExp(COLOR_OPERATOR_REGEX.source, 'ug');
    const regexMatches = Array.from(text.matchAll(regex));

    console.log(`Total regex matches: ${regexMatches.length}\n`);
    console.log('=== ALL REGEX MATCHES ===');
    console.log('Match# | OpIdx | Type | Groups Present | Match Text (first 60 chars)');
    console.log('-------|-------|------|----------------|-----------------------------');

    let opIdx = 0;
    for (let i = 0; i < Math.min(regexMatches.length, MAX_MATCHES); i++) {
        const match = regexMatches[i];
        const groups = match.groups ?? {};

        // Identify what was matched
        const presentGroups = Object.entries(groups)
            .filter(([k, v]) => v !== undefined)
            .map(([k, v]) => `${k}=${String(v).substring(0, 15)}`)
            .join(', ');

        let matchType = 'unknown';
        let counted = false;

        if (groups.csOp && groups.name) {
            matchType = `CS/cs: ${groups.name} ${groups.csOp}`;
            counted = false; // We skip these
        } else if (groups.rgb && groups.rgOp) {
            matchType = `RGB: ${groups.rgb.trim()} ${groups.rgOp}`;
            counted = true;
        } else if (groups.cmyk && groups.kOp) {
            matchType = `CMYK: ${groups.cmyk.trim()} ${groups.kOp}`;
            counted = true;
        } else if (groups.gray && groups.gOp) {
            matchType = `Gray: ${groups.gray} ${groups.gOp}`;
            counted = true;
        } else if (groups.n && groups.scOp) {
            matchType = `SC: ${groups.n.trim()} ${groups.scOp}`;
            counted = true;
        } else if (groups.name2 && groups.scnOp) {
            matchType = `Pattern: ${groups.name2} ${groups.scnOp}`;
            counted = true; // Should this be counted?
        } else if (groups.string !== undefined) {
            matchType = `String: (${groups.string.substring(0, 20)}...)`;
            counted = false;
        } else if (groups.head && !Object.keys(groups).some(k => k !== 'head' && groups[k])) {
            matchType = `Head only: ${groups.head.substring(0, 30).replace(/\n/g, '\\n')}...`;
            counted = false;
        }

        const opIdxStr = counted ? String(opIdx).padStart(5) : '  -  ';
        const matchText = match[0].substring(0, 60).replace(/\n/g, '\\n');

        console.log(`${String(i).padStart(6)} | ${opIdxStr} | ${counted ? 'COUNT' : 'SKIP '} | ${presentGroups.padEnd(25)} | ${matchText}`);

        if (counted) opIdx++;
    }

    console.log(`\nFinal operatorIndex after ${Math.min(regexMatches.length, MAX_MATCHES)} matches: ${opIdx}`);
}

main().catch(console.error);
