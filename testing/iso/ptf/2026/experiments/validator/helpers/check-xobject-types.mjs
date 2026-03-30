#!/usr/bin/env node
// @ts-check
import { readFile } from 'fs/promises';
import { resolve, basename } from 'path';
import {
    PDFDocument, PDFDict, PDFArray, PDFName, PDFRef, PDFRawStream, PDFStream,
    PDFNumber, PDFContentStream, decodePDFRawStream,
} from '../../packages/pdf-lib/pdf-lib.esm.js';

const filePath = process.argv[2];
const bytes = await readFile(resolve(filePath));
const doc = await PDFDocument.load(bytes, { updateMetadata: false });
const pages = doc.getPages();

// Check page 1 XObjects in detail
const page = pages[0];
const resources = page.node.lookup(PDFName.of('Resources'));
const xObjects = resources.lookup(PDFName.of('XObject'));

console.log(`Page 1 XObject entries:`);
for (const [key, rawVal] of xObjects.entries()) {
    const name = key instanceof PDFName ? key.encodedName : String(key);
    console.log(`\n  ${name}:`);
    console.log(`    Raw value type: ${rawVal?.constructor?.name}`);

    let ref = rawVal;
    let obj = rawVal;
    if (rawVal instanceof PDFRef) {
        console.log(`    Ref: ${rawVal.objectNumber} ${rawVal.generationNumber} R`);
        obj = doc.context.lookup(rawVal);
    }

    console.log(`    Resolved type: ${obj?.constructor?.name}`);

    // Check if it's a stream
    const isStream = obj instanceof PDFRawStream || obj instanceof PDFStream;
    console.log(`    Is stream: ${isStream}`);

    if (isStream) {
        const dict = obj.dict;
        console.log(`    Dict entries:`);
        for (const [dk, dv] of dict.entries()) {
            const dkStr = dk instanceof PDFName ? dk.encodedName : String(dk);
            let dvStr;
            if (dv instanceof PDFName) dvStr = `/${dv.encodedName}`;
            else if (dv instanceof PDFNumber) dvStr = String(dv.numberValue);
            else if (dv instanceof PDFRef) dvStr = `${dv.objectNumber} ${dv.generationNumber} R`;
            else if (dv instanceof PDFArray) {
                const items = [];
                for (let i = 0; i < Math.min(dv.size(), 6); i++) {
                    const item = dv.lookup(i);
                    if (item instanceof PDFNumber) items.push(item.numberValue);
                    else if (item instanceof PDFName) items.push(`/${item.encodedName}`);
                    else items.push(String(item));
                }
                dvStr = `[${items.join(' ')}]`;
            } else if (dv instanceof PDFDict) {
                const subKeys = [];
                for (const [sk] of dv.entries()) {
                    subKeys.push(sk instanceof PDFName ? `/${sk.encodedName}` : String(sk));
                }
                dvStr = `<< ${subKeys.join(' ')} >>`;
            } else dvStr = String(dv);
            console.log(`      /${dkStr}: ${dvStr}`);
        }

        // Check content size
        try {
            console.log(`    Content size: ${obj.getContentsSize()} bytes`);
        } catch {}

        // For Form XObjects, check the embedded content stream
        const subtype = dict.lookup(PDFName.of('Subtype'));
        if (subtype instanceof PDFName && subtype.encodedName === 'Form') {
            // Decode the content and show first 500 chars
            try {
                let contentText;
                if (obj instanceof PDFRawStream) {
                    const decoded = decodePDFRawStream(obj);
                    contentText = new TextDecoder('latin1').decode(decoded.decode());
                } else if (obj instanceof PDFContentStream) {
                    contentText = '[PDFContentStream]';
                }
                if (contentText) {
                    console.log(`    Content preview (first 500 chars):`);
                    console.log(contentText.substring(0, 500));
                }
            } catch (e) {
                console.log(`    Could not decode: ${e.message}`);
            }
        }
    }
}
