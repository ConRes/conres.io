/**
 * Debug script to trace colorSpaceDefinitions extraction for RGB conversion.
 */

import { readFile } from 'fs/promises';
import { PDFDocument, PDFRawStream, PDFDict, PDFName, PDFRef, PDFArray } from 'pdf-lib';
import pako from 'pako';

const sourcePath = process.argv[2] || '../../tests/fixtures/pdfs/2025-08-15 - ConRes - ISO PTF - CR1 (F9d) Fixtures - F-01.pdf';

console.log('=== Color Space Definitions Extraction ===\n');
console.log(`Source: ${sourcePath}\n`);

const pdfBytes = await readFile(sourcePath);
const pdf = await PDFDocument.load(pdfBytes);
const context = pdf.context;

const page = pdf.getPages()[0];
const pageDict = page.node.dict;

// Extract Resources
const resources = pageDict.get(PDFName.of('Resources'));
if (!resources) {
    console.log('No Resources found');
    process.exit(1);
}

const resourcesDict = resources instanceof PDFRef
    ? context.lookup(resources)
    : resources;

if (!(resourcesDict instanceof PDFDict)) {
    console.log('Resources is not a dictionary');
    process.exit(1);
}

// Get ColorSpace dictionary
const colorSpaceDict = resourcesDict.get(PDFName.of('ColorSpace'));
if (!colorSpaceDict) {
    console.log('No ColorSpace dictionary found');
    process.exit(1);
}

const csDict = colorSpaceDict instanceof PDFRef
    ? context.lookup(colorSpaceDict)
    : colorSpaceDict;

if (!(csDict instanceof PDFDict)) {
    console.log('ColorSpace is not a dictionary');
    process.exit(1);
}

console.log('Color Space Definitions:\n');

function getICCColorSpace(profileData) {
    // ICC profile header: bytes 16-19 contain color space signature
    if (profileData.length < 20) return 'Unknown';
    const cs = String.fromCharCode(
        profileData[16], profileData[17], profileData[18], profileData[19]
    ).trim();
    return cs;
}

function normalizeColorSpaceType(typeName) {
    switch (typeName) {
        case 'Gray':
        case 'DeviceGray':
            return 'sGray';
        case 'RGB':
        case 'DeviceRGB':
            return 'sRGB';
        case 'CMYK':
        case 'DeviceCMYK':
            return 'CMYK';
        case 'Lab':
            return 'Lab';
        default:
            return typeName;
    }
}

const definitions = {};

for (const [key, value] of csDict.entries()) {
    const csName = key.asString().replace(/^\//, '');
    console.log(`\n=== ${csName} ===`);

    let csDescriptor = value;
    if (csDescriptor instanceof PDFRef) {
        csDescriptor = context.lookup(csDescriptor);
    }

    if (csDescriptor instanceof PDFName) {
        const typeName = csDescriptor.asString().replace(/^\//, '');
        console.log(`  Type: PDFName`);
        console.log(`  Name: ${typeName}`);
        console.log(`  Normalized: ${normalizeColorSpaceType(typeName)}`);
        definitions[csName] = { colorSpaceType: normalizeColorSpaceType(typeName) };
    } else if (csDescriptor instanceof PDFArray) {
        console.log(`  Type: PDFArray (size ${csDescriptor.size()})`);
        const csType = csDescriptor.get(0);
        if (csType instanceof PDFName) {
            const typeName = csType.asString().replace(/^\//, '');
            console.log(`  Array[0]: ${typeName}`);

            if (typeName === 'ICCBased' && csDescriptor.size() > 1) {
                const iccRef = csDescriptor.get(1);
                let iccStream;
                if (iccRef instanceof PDFRef) {
                    iccStream = context.lookup(iccRef);
                } else {
                    iccStream = iccRef;
                }

                if (iccStream instanceof PDFRawStream) {
                    const filter = iccStream.dict.get(PDFName.of('Filter'));
                    const isCompressed = filter?.asString?.() === '/FlateDecode';
                    let profileData = iccStream.contents;
                    if (isCompressed) {
                        profileData = pako.inflate(profileData);
                    }

                    const iccColorSpace = getICCColorSpace(profileData);
                    const normalized = normalizeColorSpaceType(iccColorSpace);
                    console.log(`  ICC Color Space: ${iccColorSpace}`);
                    console.log(`  Normalized: ${normalized}`);
                    console.log(`  Will be included in filter: ${['sGray', 'sRGB', 'Lab'].includes(normalized)}`);
                    definitions[csName] = { colorSpaceType: normalized };
                }
            } else if (typeName === 'Lab') {
                console.log(`  Normalized: Lab`);
                console.log(`  Will be included in filter: true`);
                definitions[csName] = { colorSpaceType: 'Lab' };
            } else {
                console.log(`  Normalized: ${normalizeColorSpaceType(typeName)}`);
                definitions[csName] = { colorSpaceType: normalizeColorSpaceType(typeName) };
            }
        }
    }
}

console.log('\n\n=== Summary ===\n');
console.log('Color Space Definitions object:');
console.log(JSON.stringify(definitions, null, 2));

console.log('\nFilter criteria (sGray, sRGB, Lab):');
for (const [name, def] of Object.entries(definitions)) {
    const included = ['sGray', 'sRGB', 'Lab'].includes(def.colorSpaceType);
    console.log(`  ${name}: ${def.colorSpaceType} - ${included ? 'INCLUDED' : 'EXCLUDED'}`);
}
