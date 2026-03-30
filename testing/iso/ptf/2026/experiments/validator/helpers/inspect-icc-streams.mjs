#!/usr/bin/env node
// @ts-check
/**
 * Inspect all ICC profile streams in a PDF and compare with the OutputIntent profile.
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
    PDFNumber,
    decodePDFRawStream,
} from '../../packages/pdf-lib/pdf-lib.esm.js';

const files = process.argv.slice(2).filter(arg => arg.length > 0);

if (files.length === 0) {
    console.error('Usage: node inspect-icc-streams.mjs <pdf1> [pdf2] ...');
    process.exit(1);
}

for (const filePath of files) {
    const resolved = resolve(filePath);
    const name = basename(resolved);
    console.log('\n' + '='.repeat(80));
    console.log(`FILE: ${name}`);
    console.log('='.repeat(80));

    const bytes = await readFile(resolved);
    const doc = await PDFDocument.load(bytes, { updateMetadata: false });

    // Find OutputIntent DestOutputProfile ref
    const outputIntents = doc.catalog.lookup(PDFName.of('OutputIntents'));
    let destProfileRef = null;
    let destProfileStream = null;

    if (outputIntents instanceof PDFArray && outputIntents.size() > 0) {
        let intent = outputIntents.lookup(0);
        if (intent instanceof PDFRef) intent = doc.context.lookup(intent);
        if (intent instanceof PDFDict) {
            const rawRef = intent.get(PDFName.of('DestOutputProfile'));
            if (rawRef instanceof PDFRef) {
                destProfileRef = rawRef;
                destProfileStream = doc.context.lookup(rawRef);
            }
        }
    }

    if (destProfileRef) {
        console.log(`\nOutputIntent DestOutputProfile ref: ${destProfileRef.objectNumber} ${destProfileRef.generationNumber} R`);
        if (destProfileStream instanceof PDFRawStream) {
            console.log('  Dict entries:');
            for (const [key, val] of destProfileStream.dict.entries()) {
                const keyStr = key instanceof PDFName ? key.encodedName : String(key);
                let valStr;
                if (val instanceof PDFRef) valStr = `${val.objectNumber} ${val.generationNumber} R`;
                else if (val instanceof PDFName) valStr = `/${val.encodedName}`;
                else if (val instanceof PDFNumber) valStr = String(val.numberValue);
                else valStr = String(val);
                console.log(`    /${keyStr}: ${valStr}`);
            }
            console.log(`  Raw content length: ${destProfileStream.contents.length} bytes`);

            // Decode if FlateDecode
            try {
                const decoded = decodePDFRawStream(destProfileStream);
                console.log(`  Decoded content length: ${decoded.decode().length} bytes`);
            } catch (e) {
                console.log(`  Could not decode: ${e.message}`);
            }
        }
    }

    // Enumerate ALL streams that look like ICC profiles (/N key or large binary data)
    console.log('\n--- All ICC-like streams ---');
    const allObjects = doc.context.enumerateIndirectObjects();
    let iccCount = 0;
    for (const [ref, obj] of allObjects) {
        if (!(obj instanceof PDFRawStream)) continue;
        const dict = obj.dict;

        // Check for /N (number of color components — ICCBased marker)
        const nVal = dict.get(PDFName.of('N'));
        const alternate = dict.get(PDFName.of('Alternate'));
        const filter = dict.get(PDFName.of('Filter'));
        const length = dict.get(PDFName.of('Length'));

        if (nVal || alternate) {
            iccCount++;
            const isDestProfile = destProfileRef && ref.objectNumber === destProfileRef.objectNumber;
            console.log(`  ${ref.objectNumber} ${ref.generationNumber} R ${isDestProfile ? '*** DestOutputProfile ***' : ''}`);
            console.log(`    /N: ${nVal ? (nVal instanceof PDFNumber ? nVal.numberValue : String(nVal)) : 'MISSING'}`);
            console.log(`    /Alternate: ${alternate instanceof PDFName ? `/${alternate.encodedName}` : (alternate ? String(alternate) : 'MISSING')}`);
            console.log(`    /Filter: ${filter instanceof PDFName ? `/${filter.encodedName}` : (filter ? String(filter) : 'MISSING')}`);
            console.log(`    /Length: ${length instanceof PDFNumber ? length.numberValue : (length ? String(length) : 'MISSING')}`);
            console.log(`    Raw bytes: ${obj.contents.length}`);
        }
    }
    if (iccCount === 0) {
        console.log('  No ICC-like streams found (no /N or /Alternate attributes)');
    }

    // Check first page's ColorSpace resources for ICCBased references
    const pages = doc.getPages();
    if (pages.length > 0) {
        const pageNode = pages[0].node;
        const resources = pageNode.lookup(PDFName.of('Resources'));
        if (resources instanceof PDFDict) {
            const colorSpaces = resources.lookup(PDFName.of('ColorSpace'));
            if (colorSpaces instanceof PDFDict) {
                console.log('\n--- First page ColorSpace resources ---');
                for (const [key, rawVal] of colorSpaces.entries()) {
                    const keyStr = key instanceof PDFName ? key.encodedName : String(key);
                    let val = rawVal;
                    if (val instanceof PDFRef) val = doc.context.lookup(val);
                    if (val instanceof PDFArray && val.size() >= 2) {
                        const csType = val.lookup(0);
                        if (csType instanceof PDFName && csType.encodedName === 'ICCBased') {
                            let profileObj = val.get(1);
                            if (profileObj instanceof PDFRef) {
                                const profileRef = profileObj;
                                const profileStream = doc.context.lookup(profileRef);
                                console.log(`  ${keyStr}: [/ICCBased ${profileRef.objectNumber} ${profileRef.generationNumber} R]`);
                                if (profileStream instanceof PDFRawStream) {
                                    const pDict = profileStream.dict;
                                    const pN = pDict.get(PDFName.of('N'));
                                    const pAlt = pDict.get(PDFName.of('Alternate'));
                                    console.log(`    Profile /N: ${pN ? (pN instanceof PDFNumber ? pN.numberValue : String(pN)) : 'MISSING'}`);
                                    console.log(`    Profile /Alternate: ${pAlt instanceof PDFName ? `/${pAlt.encodedName}` : 'MISSING'}`);
                                }
                            }
                        } else {
                            console.log(`  ${keyStr}: ${csType instanceof PDFName ? `/${csType.encodedName}` : String(csType)}`);
                        }
                    } else if (val instanceof PDFName) {
                        console.log(`  ${keyStr}: /${val.encodedName}`);
                    }
                }
            } else {
                console.log('\nFirst page: No ColorSpace resources');
            }
        }
    }
}
