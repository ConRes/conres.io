#!/usr/bin/env node
// @ts-check
/**
 * Debug script to find all Lab colorspace operators in a PDF.
 */

import { readFile } from 'node:fs/promises';
import { PDFDocument, PDFName, PDFRef, PDFArray, PDFRawStream, PDFDict } from 'pdf-lib';
import { decodePDFRawStream } from 'pdf-lib';
import { COLOR_OPERATOR_REGEX } from '../../classes/pdf-content-stream-color-converter.js';

const PDF_PATH = process.argv[2];

if (!PDF_PATH) {
    console.error('Usage: node debug-find-lab.mjs <pdf-path>');
    process.exit(1);
}

/**
 * Get colorspace definitions from page resources
 * @param {import('pdf-lib').PDFDict} pageDict
 * @param {import('pdf-lib').PDFContext} context
 * @returns {Record<string, {colorSpaceType: string}>}
 */
function extractColorSpaceDefinitions(pageDict, context) {
    const result = {};
    const resources = pageDict.get(PDFName.of('Resources'));
    if (!resources) return result;

    const resourcesDict = resources instanceof PDFRef ? context.lookup(resources) : resources;
    if (!(resourcesDict instanceof PDFDict)) return result;

    const colorSpaceDict = resourcesDict.get(PDFName.of('ColorSpace'));
    if (!colorSpaceDict) return result;

    const csDict = colorSpaceDict instanceof PDFRef ? context.lookup(colorSpaceDict) : colorSpaceDict;
    if (!(csDict instanceof PDFDict)) return result;

    const entries = csDict.entries();
    for (const [name, value] of entries) {
        const csName = name.toString().replace(/^\//, '');
        let colorSpaceType = 'Unknown';

        const resolved = value instanceof PDFRef ? context.lookup(value) : value;
        if (resolved instanceof PDFArray && resolved.size() > 0) {
            const firstElement = resolved.get(0);
            if (firstElement instanceof PDFName) {
                const typeName = firstElement.toString().replace(/^\//, '');
                if (typeName === 'Lab') {
                    colorSpaceType = 'Lab';
                } else if (typeName === 'ICCBased') {
                    colorSpaceType = 'ICCBased'; // Could be RGB, CMYK, Gray
                }
            }
        } else if (resolved instanceof PDFName) {
            colorSpaceType = resolved.toString().replace(/^\//, '');
        }

        result[csName] = { colorSpaceType };
    }

    return result;
}

async function main() {
    console.log(`=== FINDING LAB COLORS IN: ${PDF_PATH} ===\n`);

    const pdfBytes = await readFile(PDF_PATH);
    const pdfDoc = await PDFDocument.load(pdfBytes);
    const context = pdfDoc.context;
    const pages = pdfDoc.getPages();

    for (let pageIdx = 0; pageIdx < pages.length; pageIdx++) {
        const pageNum = pageIdx + 1;
        const page = pages[pageIdx];
        const pageNode = /** @type {import('pdf-lib').PDFPageLeaf} */ (page.node);
        const pageDict = /** @type {PDFDict} */ (pageNode);

        // Get colorspace definitions
        const colorSpaceDefinitions = extractColorSpaceDefinitions(pageDict, context);

        console.log(`\n=== Page ${pageNum} ColorSpace Definitions ===`);
        for (const [name, def] of Object.entries(colorSpaceDefinitions)) {
            console.log(`  ${name}: ${def.colorSpaceType}`);
        }

        // Get content streams
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

        // Track current colorspace
        let currentStrokeCS = undefined;
        let currentFillCS = undefined;

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

                    // Track colorspace from CS/cs
                    if (groups.csOp && groups.name) {
                        const csName = groups.name.replace(/^\//, '');
                        if (groups.csOp === 'CS') {
                            currentStrokeCS = csName;
                        } else {
                            currentFillCS = csName;
                        }
                        continue;
                    }

                    // SCN/scn operators
                    if (groups.n && groups.scOp) {
                        const op = groups.scOp;
                        const values = groups.n.trim();
                        const isStroke = op === 'SC' || op === 'SCN';
                        const csName = isStroke ? currentStrokeCS : currentFillCS;
                        const csDef = csName ? colorSpaceDefinitions[csName] : null;

                        if (csDef?.colorSpaceType === 'Lab') {
                            console.log(`\n>>> LAB COLOR FOUND <<<`);
                            console.log(`  Page: ${pageNum}, Stream: ${streamIdx}, OpIdx: ${opIdx}`);
                            console.log(`  Colorspace: ${csName} (${csDef.colorSpaceType})`);
                            console.log(`  Operator: ${op}`);
                            console.log(`  Values: ${values}`);
                        }
                        opIdx++;
                    }
                    // Other color operators
                    else if ((groups.rgb && groups.rgOp) ||
                             (groups.cmyk && groups.kOp) ||
                             (groups.gray && groups.gOp)) {
                        opIdx++;
                    }
                }
            } catch (e) {
                console.warn(`Failed to decode stream ${pageNum}/${streamIdx}: ${/** @type {Error} */ (e).message}`);
            }
        }
    }
}

main().catch(console.error);
