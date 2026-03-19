#!/usr/bin/env node
// @ts-check
/**
 * Debug script to identify operator index drift between Expected and Actual PDFs.
 * Outputs the first N color operators from each PDF for comparison.
 */

import { readFile } from 'node:fs/promises';
import { PDFDocument, PDFName, PDFRef, PDFArray, PDFRawStream } from 'pdf-lib';
import { decodePDFRawStream } from 'pdf-lib';
import { COLOR_OPERATOR_REGEX } from '../../classes/pdf-content-stream-color-converter.js';

const EXPECTED_PATH = process.argv[2];
const ACTUAL_PATH = process.argv[3];
const MAX_OPERATORS = parseInt(process.argv[4] || '30', 10);

if (!EXPECTED_PATH || !ACTUAL_PATH) {
    console.error('Usage: node debug-operator-drift.mjs <expected.pdf> <actual.pdf> [max_operators]');
    process.exit(1);
}

/**
 * Extract operators with full debug info
 * @param {string} pdfPath
 * @returns {Promise<Array<{pageNum: number, streamIdx: number, opIdx: number, operator: string, values: string, matchIndex: number, fullMatch: string}>>}
 */
async function extractOperators(pdfPath) {
    const pdfBytes = await readFile(pdfPath);
    const pdfDoc = await PDFDocument.load(pdfBytes);
    const context = pdfDoc.context;
    const pages = pdfDoc.getPages();

    /** @type {Array<{pageNum: number, streamIdx: number, opIdx: number, operator: string, values: string, matchIndex: number, fullMatch: string}>} */
    const results = [];

    for (let pageIdx = 0; pageIdx < pages.length; pageIdx++) {
        const pageNum = pageIdx + 1;
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

        for (let streamIdx = 0; streamIdx < streamRefs.length; streamIdx++) {
            const ref = streamRefs[streamIdx];
            const stream = context.lookup(ref);
            if (!(stream instanceof PDFRawStream)) continue;

            try {
                const decoded = decodePDFRawStream(stream).decode();
                const text = new TextDecoder().decode(decoded);

                const regex = new RegExp(COLOR_OPERATOR_REGEX.source, 'ug');
                const regexMatches = Array.from(text.matchAll(regex));

                let opIdx = 0;
                for (const match of regexMatches) {
                    const groups = match.groups ?? {};

                    // CS/cs - colorspace setting (skip count)
                    if (groups.csOp && groups.name) {
                        results.push({
                            pageNum, streamIdx, opIdx: -1, // -1 indicates not counted
                            operator: groups.csOp,
                            values: groups.name,
                            matchIndex: match.index ?? 0,
                            fullMatch: match[0].trim().substring(0, 50)
                        });
                        continue;
                    }

                    // RG/rg - RGB
                    if (groups.rgb && groups.rgOp) {
                        results.push({
                            pageNum, streamIdx, opIdx: opIdx++,
                            operator: groups.rgOp,
                            values: groups.rgb.trim(),
                            matchIndex: match.index ?? 0,
                            fullMatch: match[0].trim().substring(0, 50)
                        });
                    }
                    // K/k - CMYK
                    else if (groups.cmyk && groups.kOp) {
                        results.push({
                            pageNum, streamIdx, opIdx: opIdx++,
                            operator: groups.kOp,
                            values: groups.cmyk.trim(),
                            matchIndex: match.index ?? 0,
                            fullMatch: match[0].trim().substring(0, 50)
                        });
                    }
                    // G/g - Gray
                    else if (groups.gray && groups.gOp) {
                        results.push({
                            pageNum, streamIdx, opIdx: opIdx++,
                            operator: groups.gOp,
                            values: groups.gray.trim(),
                            matchIndex: match.index ?? 0,
                            fullMatch: match[0].trim().substring(0, 50)
                        });
                    }
                    // SC/sc/SCN/scn - ICCBased with values
                    else if (groups.n && groups.scOp) {
                        results.push({
                            pageNum, streamIdx, opIdx: opIdx++,
                            operator: groups.scOp,
                            values: groups.n.trim(),
                            matchIndex: match.index ?? 0,
                            fullMatch: match[0].trim().substring(0, 50)
                        });
                    }
                    // Pattern SCN/scn (name2, scnOp)
                    else if (groups.name2 && groups.scnOp) {
                        results.push({
                            pageNum, streamIdx, opIdx: opIdx++,
                            operator: groups.scnOp + ' (pattern)',
                            values: groups.name2,
                            matchIndex: match.index ?? 0,
                            fullMatch: match[0].trim().substring(0, 50)
                        });
                    }
                }
            } catch (e) {
                console.warn(`Failed to decode stream ${pageNum}/${streamIdx}: ${/** @type {Error} */ (e).message}`);
            }
        }
    }

    return results;
}

async function main() {
    console.log('=== DEBUG OPERATOR DRIFT ===\n');
    console.log(`Expected: ${EXPECTED_PATH}`);
    console.log(`Actual: ${ACTUAL_PATH}`);
    console.log(`Max operators: ${MAX_OPERATORS}\n`);

    const expectedOps = await extractOperators(EXPECTED_PATH);
    const actualOps = await extractOperators(ACTUAL_PATH);

    // Filter to page 1, stream 0 for focused debug
    const expectedFiltered = expectedOps.filter(o => o.pageNum === 1 && o.streamIdx === 0).slice(0, MAX_OPERATORS);
    const actualFiltered = actualOps.filter(o => o.pageNum === 1 && o.streamIdx === 0).slice(0, MAX_OPERATORS);

    console.log('=== EXPECTED (Page 1, Stream 0) ===');
    console.log('OpIdx | Operator | Values');
    console.log('------|----------|--------');
    for (const op of expectedFiltered) {
        const opIdxStr = op.opIdx === -1 ? '(cs)' : String(op.opIdx).padStart(4);
        console.log(`${opIdxStr}  | ${op.operator.padEnd(8)} | ${op.values}`);
    }

    console.log('\n=== ACTUAL (Page 1, Stream 0) ===');
    console.log('OpIdx | Operator | Values');
    console.log('------|----------|--------');
    for (const op of actualFiltered) {
        const opIdxStr = op.opIdx === -1 ? '(cs)' : String(op.opIdx).padStart(4);
        console.log(`${opIdxStr}  | ${op.operator.padEnd(8)} | ${op.values}`);
    }

    // Find first mismatch
    console.log('\n=== FIRST MISMATCH ===');
    const maxLen = Math.max(expectedFiltered.length, actualFiltered.length);
    for (let i = 0; i < maxLen; i++) {
        const exp = expectedFiltered[i];
        const act = actualFiltered[i];
        if (!exp || !act) {
            console.log(`Position ${i}: Missing in ${!exp ? 'Expected' : 'Actual'}`);
            break;
        }
        if (exp.opIdx !== act.opIdx || exp.operator !== act.operator || exp.values !== act.values) {
            console.log(`Position ${i}:`);
            console.log(`  Expected: opIdx=${exp.opIdx} ${exp.operator} ${exp.values}`);
            console.log(`  Actual:   opIdx=${act.opIdx} ${act.operator} ${act.values}`);
            break;
        }
    }
    if (expectedFiltered.length === actualFiltered.length &&
        expectedFiltered.every((exp, i) => {
            const act = actualFiltered[i];
            return exp.opIdx === act.opIdx && exp.operator === act.operator && exp.values === act.values;
        })) {
        console.log('No mismatch found in first ' + MAX_OPERATORS + ' operators');
    }
}

main().catch(console.error);
