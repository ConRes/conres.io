#!/usr/bin/env node
// @ts-check
import { PDFDocument, PDFRawStream, PDFName, PDFArray } from 'pdf-lib';
import { readFileSync } from 'fs';

const pdfPath = process.argv[2];
if (!pdfPath) {
    console.log('Usage: node debug-colorspace.mjs <pdf-path>');
    process.exit(1);
}

const pdfBytes = readFileSync(pdfPath);
const pdf = await PDFDocument.load(pdfBytes);
const page = pdf.getPage(0);

const resources = pdf.context.lookup(page.node.get(PDFName.of('Resources')));
const xobjects = pdf.context.lookup(resources.get(PDFName.of('XObject')));

for (const [nameObj, ref] of xobjects.entries()) {
    const name = nameObj.asString().replace('/', '');
    const xobject = pdf.context.lookup(ref);
    if (!(xobject instanceof PDFRawStream)) continue;

    const dict = xobject.dict;
    const subtype = dict.get(PDFName.of('Subtype'));
    if (!(subtype instanceof PDFName) || subtype.asString() !== '/Image') continue;

    const csRef = dict.get(PDFName.of('ColorSpace'));
    let csName = 'Unknown';
    const cs = pdf.context.lookup(csRef);
    if (cs instanceof PDFName) {
        csName = cs.asString();
    } else if (cs instanceof PDFArray && cs.size() > 0) {
        const first = cs.get(0);
        if (first instanceof PDFName) {
            csName = first.asString();
            if (csName === '/ICCBased' && cs.size() > 1) {
                const profileRef = cs.get(1);
                const profile = pdf.context.lookup(profileRef);
                if (profile instanceof PDFRawStream) {
                    const n = profile.dict.get(PDFName.of('N'));
                    csName = '/ICCBased(' + (n?.asNumber?.() ?? '?') + ')';
                }
            }
        }
    }
    console.log(name + ': ' + csName);
}
