#!/usr/bin/env node
// @ts-check
/**
 * Compare PDF structural metadata between 2025 and 2026 generator outputs.
 * Focuses on catalog, info dict, cross-reference format, output intent,
 * and other features that may affect compatibility with older Acrobat versions.
 */

import { readFile } from 'fs/promises';
import { resolve, basename } from 'path';
import {
    PDFDocument,
    PDFDict,
    PDFArray,
    PDFName,
    PDFRef,
    PDFStream,
    PDFRawStream,
    PDFString,
    PDFHexString,
    PDFNumber,
    PDFBool,
} from '../../packages/pdf-lib/pdf-lib.esm.js';

const files = process.argv.slice(2).filter(arg => arg.length > 0);

if (files.length === 0) {
    console.error('Usage: node compare-pdf-structure.mjs <pdf1> <pdf2> ...');
    process.exit(1);
}

/**
 * Recursively serialize a PDF object to a readable string (limited depth).
 * @param {*} obj
 * @param {number} depth
 * @returns {string}
 */
function serializePDFObject(obj, depth = 0) {
    if (depth > 4) return '…';
    if (obj === undefined || obj === null) return 'null';
    if (obj instanceof PDFName) return `/${obj.encodedName}`;
    if (obj instanceof PDFRef) return `${obj.objectNumber} ${obj.generationNumber} R`;
    if (obj instanceof PDFString) return `(${obj.value})`;
    if (obj instanceof PDFHexString) return `<${obj.value}>`;
    if (obj instanceof PDFNumber) return String(obj.numberValue);
    if (obj instanceof PDFBool) return String(obj.value);
    if (obj instanceof PDFArray) {
        const items = [];
        for (let i = 0; i < obj.size(); i++) {
            items.push(serializePDFObject(obj.lookup(i), depth + 1));
        }
        return `[${items.join(' ')}]`;
    }
    if (obj instanceof PDFDict) {
        const entries = obj.entries();
        const parts = entries.map(([key, val]) =>
            `${serializePDFObject(key, depth + 1)} ${serializePDFObject(val, depth + 1)}`
        );
        return `<< ${parts.join(' ')} >>`;
    }
    if (obj instanceof PDFStream || obj instanceof PDFRawStream) {
        return `stream(${obj.dict ? serializePDFObject(obj.dict, depth + 1) : '...'})`;
    }
    return String(obj);
}

/**
 * Get all entries from a PDF dictionary, resolving references.
 * @param {PDFDict} dict
 * @param {import('pdf-lib').PDFDocument} doc
 * @returns {Record<string, string>}
 */
function dictEntries(dict, doc) {
    const result = {};
    for (const [key, rawVal] of dict.entries()) {
        const keyName = key instanceof PDFName ? key.encodedName : String(key);
        // Resolve references
        let val = rawVal;
        if (val instanceof PDFRef) {
            val = doc.context.lookup(val);
        }
        result[keyName] = serializePDFObject(val, 0);
    }
    return result;
}

for (const filePath of files) {
    const resolved = resolve(filePath);
    const name = basename(resolved);
    console.log('\n' + '='.repeat(80));
    console.log(`FILE: ${name}`);
    console.log('='.repeat(80));

    const bytes = await readFile(resolved);

    // Check raw header
    const header = new TextDecoder().decode(bytes.slice(0, 20));
    console.log(`\nPDF Header: ${header.split('\n')[0]}`);

    // Check if file uses cross-reference streams or tables
    // Look for "xref" keyword near the end vs just "startxref"
    const tailStr = new TextDecoder('latin1').decode(bytes.slice(Math.max(0, bytes.length - 2048)));
    const hasXrefTable = tailStr.includes('\nxref\n') || tailStr.includes('\rxref\r');
    const hasXrefStream = !hasXrefTable; // If no xref table keyword, it uses xref streams
    console.log(`Cross-reference format: ${hasXrefTable ? 'Traditional xref table' : 'Cross-reference stream (PDF 1.5+)'}`);

    // Check for object streams
    // Search for /Type /ObjStm in the raw bytes
    const rawStr = new TextDecoder('latin1').decode(bytes.slice(0, Math.min(bytes.length, 100000)));
    const hasObjStm = rawStr.includes('/ObjStm') || rawStr.includes('/Type/ObjStm');

    // Load with pdf-lib
    const doc = await PDFDocument.load(bytes, { updateMetadata: false });

    // Catalog
    const catalog = doc.catalog;
    console.log('\n--- Catalog Dictionary ---');
    const catalogEntries = dictEntries(catalog, doc);
    for (const [key, val] of Object.entries(catalogEntries)) {
        console.log(`  /${key}: ${val}`);
    }

    // Check for Extensions
    const extensions = catalog.lookup(PDFName.of('Extensions'));
    if (extensions) {
        console.log('\n--- Extensions Dictionary ---');
        if (extensions instanceof PDFDict) {
            for (const [key, val] of extensions.entries()) {
                const resolved = val instanceof PDFRef ? doc.context.lookup(val) : val;
                console.log(`  ${serializePDFObject(key)}: ${serializePDFObject(resolved, 0)}`);
            }
        }
    }

    // Version from catalog (can override header)
    const catalogVersion = catalog.lookup(PDFName.of('Version'));
    if (catalogVersion) {
        console.log(`\nCatalog /Version: ${serializePDFObject(catalogVersion)}`);
    }

    // Info dictionary
    const trailerDict = doc.context.trailerInfo;
    console.log('\n--- Trailer Info ---');
    if (trailerDict.Info) {
        const info = doc.context.lookup(trailerDict.Info);
        if (info instanceof PDFDict) {
            const infoEntries = dictEntries(info, doc);
            for (const [key, val] of Object.entries(infoEntries)) {
                console.log(`  /${key}: ${val}`);
            }
        }
    }

    // Output Intents
    const outputIntents = catalog.lookup(PDFName.of('OutputIntents'));
    if (outputIntents instanceof PDFArray) {
        console.log(`\n--- Output Intents (${outputIntents.size()}) ---`);
        for (let i = 0; i < outputIntents.size(); i++) {
            let intent = outputIntents.lookup(i);
            if (intent instanceof PDFRef) intent = doc.context.lookup(intent);
            if (intent instanceof PDFDict) {
                const entries = dictEntries(intent, doc);
                for (const [key, val] of Object.entries(entries)) {
                    // Skip the ICC profile stream content, just show dict
                    if (key === 'DestOutputProfile') {
                        const profileRef = intent.get(PDFName.of('DestOutputProfile'));
                        const profileObj = profileRef instanceof PDFRef ? doc.context.lookup(profileRef) : profileRef;
                        if (profileObj instanceof PDFRawStream || profileObj instanceof PDFStream) {
                            const profileDict = profileObj.dict;
                            console.log(`  /${key}: stream(${profileDict ? serializePDFObject(profileDict, 1) : '...'})`);
                            // Check profile length
                            const lengthObj = profileDict?.lookup(PDFName.of('Length'));
                            if (lengthObj) console.log(`    Profile stream length: ${serializePDFObject(lengthObj)}`);
                        } else {
                            console.log(`  /${key}: ${val}`);
                        }
                    } else {
                        console.log(`  /${key}: ${val}`);
                    }
                }
            }
        }
    } else {
        console.log('\nNo Output Intents found');
    }

    // MarkInfo
    const markInfo = catalog.lookup(PDFName.of('MarkInfo'));
    if (markInfo) {
        console.log(`\nMarkInfo: ${serializePDFObject(markInfo, 0)}`);
    }

    // Page count and basic page info
    const pages = doc.getPages();
    console.log(`\nPage count: ${pages.length}`);

    // Check first page's MediaBox and resources
    if (pages.length > 0) {
        const firstPage = pages[0];
        const pageNode = firstPage.node;
        const mediaBox = pageNode.lookup(PDFName.of('MediaBox'));
        console.log(`First page MediaBox: ${serializePDFObject(mediaBox)}`);

        // Check page resources for color spaces
        const resources = pageNode.lookup(PDFName.of('Resources'));
        if (resources instanceof PDFDict) {
            const colorSpaces = resources.lookup(PDFName.of('ColorSpace'));
            if (colorSpaces instanceof PDFDict) {
                console.log('\n--- First Page Color Spaces ---');
                for (const [key, val] of colorSpaces.entries()) {
                    const resolved = val instanceof PDFRef ? doc.context.lookup(val) : val;
                    console.log(`  ${serializePDFObject(key)}: ${serializePDFObject(resolved, 1)}`);
                }
            }

            // Check for ExtGState (transparency, blending)
            const extGState = resources.lookup(PDFName.of('ExtGState'));
            if (extGState instanceof PDFDict) {
                console.log('\n--- First Page ExtGState entries ---');
                for (const [key, val] of extGState.entries()) {
                    const resolved = val instanceof PDFRef ? doc.context.lookup(val) : val;
                    console.log(`  ${serializePDFObject(key)}: ${serializePDFObject(resolved, 1)}`);
                }
            }
        }
    }

    // Object count
    const allIndirectObjects = doc.context.enumerateIndirectObjects();
    let objectCount = 0;
    let streamCount = 0;
    let objStmCount = 0;
    for (const [ref, obj] of allIndirectObjects) {
        objectCount++;
        if (obj instanceof PDFRawStream || obj instanceof PDFStream) {
            streamCount++;
            const dict = obj.dict || (obj instanceof PDFDict ? obj : null);
            if (dict) {
                const type = dict.lookup(PDFName.of('Type'));
                if (type instanceof PDFName && type.encodedName === 'ObjStm') {
                    objStmCount++;
                }
            }
        }
    }
    console.log(`\nTotal indirect objects: ${objectCount}`);
    console.log(`Stream objects: ${streamCount}`);
    console.log(`Object streams (ObjStm): ${objStmCount}`);

    // Check XMP metadata
    const metadata = catalog.lookup(PDFName.of('Metadata'));
    if (metadata instanceof PDFRef) {
        const metaObj = doc.context.lookup(metadata);
        if (metaObj instanceof PDFRawStream || metaObj instanceof PDFStream) {
            try {
                const { decode } = await import('../../packages/pdf-lib/pdf-lib.esm.js');
                // Try to read metadata stream
                const metaDict = metaObj.dict;
                console.log(`\nXMP Metadata stream: ${serializePDFObject(metaDict, 1)}`);
            } catch {
                console.log('\nXMP Metadata: present (stream)');
            }
        }
    }

    // Check for AcroForm
    const acroForm = catalog.lookup(PDFName.of('AcroForm'));
    if (acroForm) {
        console.log(`\nAcroForm: present`);
    }

    // Check file size
    console.log(`\nFile size: ${(bytes.length / 1024 / 1024).toFixed(1)} MB`);
}
