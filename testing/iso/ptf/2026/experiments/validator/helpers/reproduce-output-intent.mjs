#!/usr/bin/env node
// @ts-check
/**
 * Reproduce the output intent creation to trace what actually happens.
 */

import { readFile } from 'fs/promises';
import {
    PDFDocument, PDFRawStream, PDFName, PDFString, PDFRef, PDFNumber,
} from '../../packages/pdf-lib/pdf-lib.esm.js';

const acrobatFile = '2025-05-05 - ISO PTF 2x-4x - Canon imagePRESS C10000VP - Acrobat.pdf';
const profileFile = '2025-05-05 - ISO PTF 2x-4x - Canon imagePRESS C10000VP - Output Profile.icc';

console.log('Loading Acrobat PDF...');
const acrobatBytes = await readFile(acrobatFile);
const doc = await PDFDocument.load(acrobatBytes, { updateMetadata: false });

console.log(`Loaded. Largest object number: ${doc.context.largestObjectNumber}`);

// Check existing ICC profile refs
let existingIccRef = null;
const allObjects = doc.context.enumerateIndirectObjects();
for (const [ref, obj] of allObjects) {
    if (obj instanceof PDFRawStream) {
        const n = obj.dict.get(PDFName.of('N'));
        if (n) {
            console.log(`Existing ICC stream: ${ref.objectNumber} ${ref.generationNumber} R, N=${n instanceof PDFNumber ? n.numberValue : n}, size=${obj.contents.length}`);
            existingIccRef = ref;
        }
    }
}

// Load ICC profile
console.log('\nLoading ICC profile...');
const iccProfileBuffer = await readFile(profileFile);
console.log(`ICC profile size: ${iccProfileBuffer.length} bytes`);

// Simulate setOutputIntentForPDFDocument
const iccProfile = new Uint8Array(iccProfileBuffer);

console.log('\nCreating new ICC stream...');
const newStream = doc.context.stream(iccProfile, { Length: iccProfile.length });
console.log(`New stream content size: ${newStream.getContentsSize()}`);
console.log(`New stream dict entries:`);
for (const [k, v] of newStream.dict.entries()) {
    console.log(`  ${k instanceof PDFName ? k.encodedName : k}: ${v instanceof PDFNumber ? v.numberValue : v}`);
}

console.log('\nRegistering new stream...');
const newRef = doc.context.register(newStream);
console.log(`New stream registered at: ${newRef.objectNumber} ${newRef.generationNumber} R`);
console.log(`Largest object number after register: ${doc.context.largestObjectNumber}`);

// Create output intent
const outputIntent = doc.context.obj({
    Type: 'OutputIntent',
    S: 'GTS_PDFX',
    OutputConditionIdentifier: PDFString.of('Canon iPR C10000VP series Coated MGCR v1.2'),
    Info: PDFString.of('Canon iPR C10000VP series Coated MGCR v1.2'),
    DestOutputProfile: newRef,
});
const outputIntentRef = doc.context.register(outputIntent);
doc.catalog.set(PDFName.of('OutputIntents'), doc.context.obj([outputIntentRef]));

// Verify what the catalog says
const outputIntents = doc.catalog.lookup(PDFName.of('OutputIntents'));
const intent = outputIntents.lookup(0);
const destProfileRef = intent.get(PDFName.of('DestOutputProfile'));
console.log(`\nOutputIntent DestOutputProfile ref: ${destProfileRef instanceof PDFRef ? `${destProfileRef.objectNumber} ${destProfileRef.generationNumber} R` : destProfileRef}`);
console.log(`Expected ref: ${newRef.objectNumber} ${newRef.generationNumber} R`);
console.log(`Match: ${destProfileRef === newRef}`);

// Save and reload
console.log('\nSaving...');
const savedBytes = await doc.save({ addDefaultPage: false, updateFieldAppearances: false });
console.log(`Saved PDF: ${savedBytes.length} bytes`);

console.log('\nReloading saved PDF...');
const reloadedDoc = await PDFDocument.load(savedBytes, { updateMetadata: false });

// Check in reloaded doc
const reloadedIntents = reloadedDoc.catalog.lookup(PDFName.of('OutputIntents'));
const reloadedIntent = reloadedIntents.lookup(0);
const reloadedDestRef = reloadedIntent.get(PDFName.of('DestOutputProfile'));
console.log(`Reloaded DestOutputProfile ref: ${reloadedDestRef instanceof PDFRef ? `${reloadedDestRef.objectNumber} ${reloadedDestRef.generationNumber} R` : reloadedDestRef}`);

const reloadedProfile = reloadedDestRef instanceof PDFRef ? reloadedDoc.context.lookup(reloadedDestRef) : null;
if (reloadedProfile instanceof PDFRawStream) {
    console.log('Reloaded profile stream dict:');
    for (const [k, v] of reloadedProfile.dict.entries()) {
        const kStr = k instanceof PDFName ? k.encodedName : String(k);
        let vStr;
        if (v instanceof PDFName) vStr = `/${v.encodedName}`;
        else if (v instanceof PDFNumber) vStr = String(v.numberValue);
        else if (v instanceof PDFRef) vStr = `${v.objectNumber} ${v.generationNumber} R`;
        else vStr = String(v);
        console.log(`  /${kStr}: ${vStr}`);
    }
    console.log(`  Content size: ${reloadedProfile.getContentsSize()} bytes`);
}

// Also check: does the old ICC stream still exist?
console.log('\nAll ICC-like streams in reloaded document:');
const reloadedObjects = reloadedDoc.context.enumerateIndirectObjects();
for (const [ref, obj] of reloadedObjects) {
    if (obj instanceof PDFRawStream) {
        const n = obj.dict.get(PDFName.of('N'));
        const alt = obj.dict.get(PDFName.of('Alternate'));
        const length = obj.dict.get(PDFName.of('Length'));
        if (n || alt || (length instanceof PDFNumber && length.numberValue > 1000000 && !obj.dict.get(PDFName.of('Width')))) {
            console.log(`  ${ref.objectNumber} ${ref.generationNumber} R: size=${obj.getContentsSize()}, N=${n ? (n instanceof PDFNumber ? n.numberValue : n) : 'none'}, Alt=${alt instanceof PDFName ? alt.encodedName : 'none'}`);
        }
    }
}
