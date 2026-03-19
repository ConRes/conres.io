#!/usr/bin/env node
// @ts-check
/**
 * Debug script to check what images are on each page.
 */
import { readFile } from 'fs/promises';
import { PDFDocument, PDFDict, PDFName, PDFArray, PDFRef, PDFRawStream } from 'pdf-lib';

const pdfPath = '/Users/daflair/Projects/conres/conres.io/assets/testforms/2025-08-15 - ConRes - ISO PTF - CR1 - Interlaken Map (300 DPI).pdf';

console.log('Loading PDF...');
const pdfBytes = await readFile(pdfPath);
const pdfDocument = await PDFDocument.load(pdfBytes, { updateMetadata: false });
const pdfContext = pdfDocument.context;
const pages = pdfDocument.getPages();

console.log(`\nPDF has ${pages.length} pages\n`);

for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
    const page = pages[pageIndex];
    const pageDict = pdfContext.lookup(page.ref);

    console.log(`\n=== Page ${pageIndex + 1} ===`);

    if (!(pageDict instanceof PDFDict)) {
        console.log('  Not a PDFDict!');
        continue;
    }

    // Get Resources
    const resources = pageDict.get(PDFName.of('Resources'));
    if (!resources) {
        console.log('  No Resources');
        continue;
    }

    const resourcesDict = resources instanceof PDFRef
        ? pdfContext.lookup(resources)
        : resources;

    if (!(resourcesDict instanceof PDFDict)) {
        console.log('  Resources not a PDFDict');
        continue;
    }

    // Get XObject
    const xobject = resourcesDict.get(PDFName.of('XObject'));
    if (!xobject) {
        console.log('  No XObject resources');
        continue;
    }

    const xobjectDict = xobject instanceof PDFRef
        ? pdfContext.lookup(xobject)
        : xobject;

    if (!(xobjectDict instanceof PDFDict)) {
        console.log('  XObject not a PDFDict');
        continue;
    }

    console.log('  XObjects:');
    for (const [name, ref] of xobjectDict.entries()) {
        if (ref instanceof PDFRef) {
            const obj = pdfContext.lookup(ref);
            if (obj instanceof PDFRawStream) {
                const subtype = obj.dict.get(PDFName.of('Subtype'));
                if (subtype instanceof PDFName && subtype.asString() === '/Image') {
                    // Get color space
                    const colorSpace = obj.dict.get(PDFName.of('ColorSpace'));
                    let csInfo = '?';

                    if (colorSpace) {
                        let cs = colorSpace;
                        if (cs instanceof PDFRef) {
                            cs = pdfContext.lookup(cs);
                        }

                        if (cs instanceof PDFName) {
                            csInfo = cs.asString();
                        } else if (cs instanceof PDFArray) {
                            const items = cs.asArray();
                            const first = items[0];
                            if (first instanceof PDFName) {
                                csInfo = first.asString();
                                if (csInfo === '/ICCBased' && items[1] instanceof PDFRef) {
                                    const profileStream = pdfContext.lookup(items[1]);
                                    if (profileStream instanceof PDFRawStream) {
                                        const n = profileStream.dict.get(PDFName.of('N'))?.asNumber?.() || 0;
                                        csInfo = `/ICCBased (N=${n})`;
                                    }
                                } else if (csInfo === '/Lab') {
                                    csInfo = '/Lab';
                                } else if (csInfo === '/Indexed') {
                                    // Check base color space of Indexed
                                    let baseCs = items[1];
                                    if (baseCs instanceof PDFRef) {
                                        baseCs = pdfContext.lookup(baseCs);
                                    }
                                    if (baseCs instanceof PDFName) {
                                        csInfo = `/Indexed (base=${baseCs.asString()})`;
                                    } else if (baseCs instanceof PDFArray && baseCs.size() > 0) {
                                        const baseFirst = baseCs.get(0);
                                        if (baseFirst instanceof PDFName) {
                                            csInfo = `/Indexed (base=${baseFirst.asString()})`;
                                        }
                                    }
                                }
                            }
                        }
                    }

                    const width = obj.dict.get(PDFName.of('Width'))?.asNumber?.() || '?';
                    const height = obj.dict.get(PDFName.of('Height'))?.asNumber?.() || '?';

                    console.log(`    ${name.asString()}: ${ref.toString()} - ${width}×${height} - ${csInfo}`);
                }
            }
        }
    }
}

console.log('\n\nChecking ColorSpace Resources...');
for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
    const page = pages[pageIndex];
    const pageDict = pdfContext.lookup(page.ref);

    console.log(`\n=== Page ${pageIndex + 1} ColorSpaces ===`);

    if (!(pageDict instanceof PDFDict)) continue;

    const resources = pageDict.get(PDFName.of('Resources'));
    if (!resources) continue;

    const resourcesDict = resources instanceof PDFRef
        ? pdfContext.lookup(resources)
        : resources;

    if (!(resourcesDict instanceof PDFDict)) continue;

    const colorSpaceDict = resourcesDict.get(PDFName.of('ColorSpace'));
    if (!colorSpaceDict) {
        console.log('  No ColorSpace resources');
        continue;
    }

    const csDict = colorSpaceDict instanceof PDFRef
        ? pdfContext.lookup(colorSpaceDict)
        : colorSpaceDict;

    if (!(csDict instanceof PDFDict)) {
        console.log('  ColorSpace not a PDFDict');
        continue;
    }

    for (const [name, value] of csDict.entries()) {
        let csInfo = '?';
        let csValue = value;
        if (csValue instanceof PDFRef) {
            csValue = pdfContext.lookup(csValue);
        }

        if (csValue instanceof PDFName) {
            csInfo = csValue.asString();
        } else if (csValue instanceof PDFArray && csValue.size() > 0) {
            const first = csValue.get(0);
            if (first instanceof PDFName) {
                csInfo = first.asString();
            }
        }

        console.log(`    ${name.asString()}: ${csInfo}`);
    }
}
