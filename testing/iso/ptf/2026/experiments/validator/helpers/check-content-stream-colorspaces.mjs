#!/usr/bin/env node
// @ts-check
/**
 * Check if content streams reference named color spaces that
 * are missing from page Resources/ColorSpace.
 */

import { readFile } from 'fs/promises';
import { resolve, basename } from 'path';
import {
    PDFDocument, PDFDict, PDFArray, PDFName, PDFRef, PDFRawStream, PDFStream,
    PDFContentStream, decodePDFRawStream,
} from '../../packages/pdf-lib/pdf-lib.esm.js';

const filePath = process.argv[2];
const maxPages = parseInt(process.argv[3] || '3', 10);
if (!filePath) { console.error('Usage: node check-content-stream-colorspaces.mjs <pdf> [maxPages]'); process.exit(1); }

const bytes = await readFile(resolve(filePath));
const doc = await PDFDocument.load(bytes, { updateMetadata: false });
const pages = doc.getPages();

console.log(`FILE: ${basename(filePath)}`);
console.log(`Pages: ${pages.length}, checking first ${Math.min(maxPages, pages.length)}\n`);

// Color space operator regex
const CS_OPS = /\/([\w.]+)\s+(cs|CS)\b/g;
const SCN_WITH_NAME = /\/([\w.]+)\s+(scn|SCN)\b/g;

for (let i = 0; i < Math.min(maxPages, pages.length); i++) {
    const page = pages[i];
    const pageNode = page.node;
    console.log(`--- Page ${i + 1} ---`);

    // Get page ColorSpace resources
    const resources = pageNode.lookup(PDFName.of('Resources'));
    const definedColorSpaces = new Set();
    if (resources instanceof PDFDict) {
        const cs = resources.lookup(PDFName.of('ColorSpace'));
        if (cs instanceof PDFDict) {
            for (const [key] of cs.entries()) {
                const name = key instanceof PDFName ? key.encodedName : String(key);
                definedColorSpaces.add(name);
            }
        }
    }
    console.log(`  Defined ColorSpaces: ${definedColorSpaces.size > 0 ? [...definedColorSpaces].join(', ') : '(none)'}`);

    // Get content streams
    const contentsRaw = pageNode.get(PDFName.of('Contents'));
    const contentRefs = [];
    if (contentsRaw instanceof PDFRef) {
        contentRefs.push(contentsRaw);
    } else if (contentsRaw instanceof PDFArray) {
        for (let j = 0; j < contentsRaw.size(); j++) {
            const item = contentsRaw.get(j);
            if (item instanceof PDFRef) contentRefs.push(item);
        }
    }

    const referencedColorSpaces = new Set();
    const deviceOps = new Set();

    for (const ref of contentRefs) {
        const streamObj = doc.context.lookup(ref);
        if (!streamObj) continue;

        let streamText = '';
        try {
            if (streamObj instanceof PDFRawStream) {
                const decoded = decodePDFRawStream(streamObj);
                const decodedBytes = decoded.decode();
                streamText = new TextDecoder('latin1').decode(decodedBytes);
            }
        } catch (e) {
            console.log(`  Warning: could not decode content stream ${ref.objectNumber}: ${e.message}`);
            continue;
        }

        // Find named color space references (CS/cs operators)
        let match;
        CS_OPS.lastIndex = 0;
        while ((match = CS_OPS.exec(streamText))) {
            referencedColorSpaces.add(match[1]);
        }

        // Find SCN/scn with name (e.g., /CS0 scn)
        SCN_WITH_NAME.lastIndex = 0;
        while ((match = SCN_WITH_NAME.exec(streamText))) {
            referencedColorSpaces.add(match[1]);
        }

        // Find device color operators
        const deviceMatches = streamText.match(/\b(rg|RG|k|K|g|G)\b/g);
        if (deviceMatches) {
            for (const op of deviceMatches) {
                deviceOps.add(op);
            }
        }
    }

    console.log(`  Referenced ColorSpaces: ${referencedColorSpaces.size > 0 ? [...referencedColorSpaces].join(', ') : '(none)'}`);
    console.log(`  Device operators: ${deviceOps.size > 0 ? [...deviceOps].join(', ') : '(none)'}`);

    // Check for mismatches
    const missing = [...referencedColorSpaces].filter(cs => !definedColorSpaces.has(cs));
    if (missing.length > 0) {
        console.log(`  *** MISSING ColorSpaces: ${missing.join(', ')} ***`);
    } else if (referencedColorSpaces.size > 0) {
        console.log(`  All referenced ColorSpaces are defined`);
    }
    console.log();
}
