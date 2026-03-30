#!/usr/bin/env node
// @ts-check
/**
 * Check Form XObjects in the 2026 output for structural issues.
 */

import { readFile } from 'fs/promises';
import { resolve, basename } from 'path';
import {
    PDFDocument, PDFDict, PDFArray, PDFName, PDFRef, PDFRawStream, PDFStream,
    PDFNumber, decodePDFRawStream,
} from '../../packages/pdf-lib/pdf-lib.esm.js';

const filePath = process.argv[2];
if (!filePath) { console.error('Usage: node check-form-xobjects.mjs <pdf>'); process.exit(1); }

const bytes = await readFile(resolve(filePath));
const doc = await PDFDocument.load(bytes, { updateMetadata: false });
const pages = doc.getPages();

console.log(`FILE: ${basename(filePath)}, ${pages.length} pages\n`);

// Check first page's Form XObjects
const page = pages[0];
const pageNode = page.node;
const resources = pageNode.lookup(PDFName.of('Resources'));
if (!(resources instanceof PDFDict)) { console.log('No resources'); process.exit(0); }

const xObjects = resources.lookup(PDFName.of('XObject'));
if (!(xObjects instanceof PDFDict)) { console.log('No XObjects'); process.exit(0); }

let formCount = 0;
for (const [key, rawVal] of xObjects.entries()) {
    const name = key instanceof PDFName ? key.encodedName : String(key);
    let ref = rawVal;
    if (!(ref instanceof PDFRef)) continue;

    const obj = doc.context.lookup(ref);
    if (!obj) continue;

    const dict = obj instanceof PDFRawStream ? obj.dict : (obj instanceof PDFDict ? obj : null);
    if (!dict) continue;

    const type = dict.lookup(PDFName.of('Type'));
    const subtype = dict.lookup(PDFName.of('Subtype'));

    if (!(subtype instanceof PDFName) || subtype.encodedName !== 'Form') continue;

    formCount++;
    console.log(`Form XObject: ${name} (ref ${ref.objectNumber} ${ref.generationNumber} R)`);

    // Show key dict entries
    for (const [dk, dv] of dict.entries()) {
        const dkStr = dk instanceof PDFName ? dk.encodedName : String(dk);
        if (['Length', 'Filter', 'Type', 'Subtype', 'BBox', 'Matrix', 'Group', 'Resources', 'OC'].includes(dkStr)) {
            let dvStr;
            if (dv instanceof PDFName) dvStr = `/${dv.encodedName}`;
            else if (dv instanceof PDFNumber) dvStr = String(dv.numberValue);
            else if (dv instanceof PDFRef) dvStr = `${dv.objectNumber} ${dv.generationNumber} R`;
            else if (dv instanceof PDFArray) {
                const items = [];
                for (let i = 0; i < dv.size(); i++) {
                    const item = dv.lookup(i);
                    if (item instanceof PDFNumber) items.push(item.numberValue);
                    else items.push(String(item));
                }
                dvStr = `[${items.join(' ')}]`;
            } else if (dv instanceof PDFDict) {
                const subEntries = [];
                for (const [sk, sv] of dv.entries()) {
                    const skStr = sk instanceof PDFName ? sk.encodedName : String(sk);
                    let svStr;
                    if (sv instanceof PDFName) svStr = `/${sv.encodedName}`;
                    else if (sv instanceof PDFRef) svStr = `${sv.objectNumber} ${sv.generationNumber} R`;
                    else svStr = String(sv);
                    subEntries.push(`/${skStr} ${svStr}`);
                }
                dvStr = `<< ${subEntries.join(' ')} >>`;
            } else dvStr = String(dv);
            console.log(`  /${dkStr}: ${dvStr}`);
        }
    }

    // Check the Form XObject's resources for ColorSpace
    const formResources = dict.lookup(PDFName.of('Resources'));
    if (formResources instanceof PDFDict) {
        const formCS = formResources.lookup(PDFName.of('ColorSpace'));
        if (formCS instanceof PDFDict) {
            console.log('  ColorSpaces:');
            for (const [csKey, csVal] of formCS.entries()) {
                const csName = csKey instanceof PDFName ? csKey.encodedName : String(csKey);
                let resolved = csVal;
                if (csVal instanceof PDFRef) resolved = doc.context.lookup(csVal);
                if (resolved instanceof PDFArray) {
                    const csType = resolved.lookup(0);
                    if (csType instanceof PDFName && csType.encodedName === 'ICCBased') {
                        const profileRef = resolved.get(1);
                        if (profileRef instanceof PDFRef) {
                            const profile = doc.context.lookup(profileRef);
                            if (profile instanceof PDFRawStream) {
                                const n = profile.dict.get(PDFName.of('N'));
                                const alt = profile.dict.get(PDFName.of('Alternate'));
                                console.log(`    ${csName}: [/ICCBased ${profileRef.objectNumber} R] N=${n instanceof PDFNumber ? n.numberValue : 'MISSING'} Alternate=${alt instanceof PDFName ? alt.encodedName : 'MISSING'}`);
                            }
                        }
                    } else {
                        console.log(`    ${csName}: [${csType instanceof PDFName ? csType.encodedName : csType} ...]`);
                    }
                } else if (resolved instanceof PDFName) {
                    console.log(`    ${csName}: /${resolved.encodedName}`);
                }
            }
        } else {
            console.log('  No ColorSpaces in Form Resources');
        }

        // Check ExtGState
        const formGS = formResources.lookup(PDFName.of('ExtGState'));
        if (formGS instanceof PDFDict && formGS.entries().length > 0) {
            console.log('  ExtGState entries:');
            for (const [gsKey, gsVal] of formGS.entries()) {
                const gsName = gsKey instanceof PDFName ? gsKey.encodedName : String(gsKey);
                let resolved = gsVal instanceof PDFRef ? doc.context.lookup(gsVal) : gsVal;
                if (resolved instanceof PDFDict) {
                    const entries = [];
                    for (const [ek, ev] of resolved.entries()) {
                        const ekStr = ek instanceof PDFName ? ek.encodedName : String(ek);
                        let evStr;
                        if (ev instanceof PDFName) evStr = `/${ev.encodedName}`;
                        else if (ev instanceof PDFNumber) evStr = String(ev.numberValue);
                        else evStr = String(ev);
                        entries.push(`/${ekStr}=${evStr}`);
                    }
                    console.log(`    ${gsName}: ${entries.join(' ')}`);
                }
            }
        }
    } else {
        console.log('  No Resources on Form XObject');
    }

    // Check for Group dict (transparency group)
    const group = dict.lookup(PDFName.of('Group'));
    if (group instanceof PDFDict) {
        console.log('  Group (transparency):');
        for (const [gk, gv] of group.entries()) {
            const gkStr = gk instanceof PDFName ? gk.encodedName : String(gk);
            let gvStr;
            if (gv instanceof PDFName) gvStr = `/${gv.encodedName}`;
            else if (gv instanceof PDFRef) gvStr = `${gv.objectNumber} ${gv.generationNumber} R`;
            else gvStr = String(gv);
            console.log(`    /${gkStr}: ${gvStr}`);
        }
    }

    // Check OC (Optional Content)
    const oc = dict.get(PDFName.of('OC'));
    if (oc) {
        let resolved = oc instanceof PDFRef ? doc.context.lookup(oc) : oc;
        if (resolved instanceof PDFDict) {
            const ocName = resolved.lookup(PDFName.of('Name'));
            console.log(`  OC (Optional Content): ${ocName}`);
        }
    }

    console.log();
}

// Now compare with 2025 output page 1 structure
console.log(`\nTotal Form XObjects on page 1: ${formCount}`);
