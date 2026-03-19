#!/usr/bin/env node
// @ts-check
/**
 * Debug script to compare operator indices between input and output PDFs
 * using the same parser as the verification script.
 */

import { readFile } from 'node:fs/promises';
import { PDFDocument, PDFName, PDFRef, PDFArray, PDFRawStream, PDFDict } from 'pdf-lib';
import { decodePDFRawStream } from 'pdf-lib';
import { parseContentStream, getColorOperations } from './classes/content-stream-parser.mjs';

const INPUT_PATH = process.argv[2];
const OUTPUT_PATH = process.argv[3];
const TARGET_PAGE = parseInt(process.argv[4] || '1', 10);
const TARGET_STREAM = parseInt(process.argv[5] || '1', 10);
const RANGE_START = parseInt(process.argv[6] || '125', 10);
const RANGE_END = parseInt(process.argv[7] || '135', 10);

if (!INPUT_PATH || !OUTPUT_PATH) {
    console.error('Usage: node debug-parser-compare.mjs <input.pdf> <output.pdf> [page] [stream] [range-start] [range-end]');
    process.exit(1);
}

/**
 * Extract color operations from a specific stream using the shared parser
 */
async function extractStreamOps(pdfPath, pageNum, streamIdx) {
    const pdfBytes = await readFile(pdfPath);
    const pdfDoc = await PDFDocument.load(pdfBytes);
    const context = pdfDoc.context;
    const pages = pdfDoc.getPages();

    const pageIdx = pageNum - 1;
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

    // Process streams up to and including target stream to get correct state
    let colorSpaceState = {};
    let targetOps = [];

    for (let idx = 0; idx <= streamIdx && idx < streamRefs.length; idx++) {
        const ref = streamRefs[idx];
        const stream = context.lookup(ref);
        if (!(stream instanceof PDFRawStream)) continue;

        const decoded = decodePDFRawStream(stream).decode();
        const text = new TextDecoder().decode(decoded);

        const parseResult = parseContentStream(text, colorSpaceState);
        colorSpaceState = parseResult.finalState;

        if (idx === streamIdx) {
            targetOps = getColorOperations(parseResult.operations);
        }
    }

    return targetOps;
}

async function main() {
    console.log('=== PARSER COMPARISON ===');
    console.log(`Input: ${INPUT_PATH}`);
    console.log(`Output: ${OUTPUT_PATH}`);
    console.log(`Page: ${TARGET_PAGE}, Stream: ${TARGET_STREAM}, Range: ${RANGE_START}-${RANGE_END}\n`);

    const inputOps = await extractStreamOps(INPUT_PATH, TARGET_PAGE, TARGET_STREAM);
    const outputOps = await extractStreamOps(OUTPUT_PATH, TARGET_PAGE, TARGET_STREAM);

    console.log(`Input total color ops: ${inputOps.length}`);
    console.log(`Output total color ops: ${outputOps.length}\n`);

    console.log('=== INPUT ===');
    console.log('OpIdx | Type     | Operator | ColorSpace    | Values');
    console.log('------|----------|----------|---------------|--------');
    for (let i = RANGE_START; i <= Math.min(RANGE_END, inputOps.length - 1); i++) {
        const op = inputOps[i];
        const values = op.values?.map(v => v.toFixed(4)).join(', ') ?? '';
        console.log(`${String(i).padStart(5)} | ${op.type.padEnd(8)} | ${op.operator.padEnd(8)} | ${(op.colorSpaceName ?? '').padEnd(13)} | ${values}`);
    }

    console.log('\n=== OUTPUT ===');
    console.log('OpIdx | Type     | Operator | ColorSpace    | Values');
    console.log('------|----------|----------|---------------|--------');
    for (let i = RANGE_START; i <= Math.min(RANGE_END, outputOps.length - 1); i++) {
        const op = outputOps[i];
        const values = op.values?.map(v => v.toFixed(4)).join(', ') ?? '';
        console.log(`${String(i).padStart(5)} | ${op.type.padEnd(8)} | ${op.operator.padEnd(8)} | ${(op.colorSpaceName ?? '').padEnd(13)} | ${values}`);
    }

    // Find first mismatch in operator count
    console.log('\n=== ANALYSIS ===');
    if (inputOps.length !== outputOps.length) {
        console.log(`MISMATCH: Input has ${inputOps.length} color ops, Output has ${outputOps.length}`);
        console.log('This will cause operator index drift!');
    } else {
        console.log(`MATCH: Both have ${inputOps.length} color ops`);
    }
}

main().catch(console.error);
