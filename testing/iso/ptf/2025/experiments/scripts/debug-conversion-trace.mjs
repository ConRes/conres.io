import { readFile } from 'fs/promises';
import { PDFDocument, PDFRawStream, PDFName, PDFArray, PDFDict, PDFRef, decodePDFRawStream } from 'pdf-lib';
import pako from 'pako';

const pdfPath = process.argv[2] || '$HOME/Projects/conres/conres.io/testing/iso/ptf/2025/tests/fixtures/pdfs/2025-08-15 - ConRes - ISO PTF - CR1 (F9d) Fixtures - F-01.pdf';

const pdfBytes = await readFile(pdfPath.replace('$HOME', process.env.HOME));
const pdf = await PDFDocument.load(pdfBytes);
const context = pdf.context;

console.log('=== Tracing Color Space Definitions ===\n');

// Get first page
const page = pdf.getPages()[0];
const pageDict = page.node.dict;

// Extract color space definitions (mirroring the code in pdf-document-color-converter.js)
function getDecompressedContents(stream) {
    const filter = stream.dict.get(PDFName.of('Filter'));
    const contents = stream.contents;

    if (filter instanceof PDFName && filter.asString() === '/FlateDecode') {
        try {
            return pako.inflate(contents);
        } catch (e) {
            console.log('    Failed to decompress:', e.message);
        }
    }
    return contents;
}

function getICCColorSpace(profileData) {
    if (profileData.length < 20) return 'Unknown';
    const colorSpaceBytes = profileData.slice(16, 20);
    const colorSpace = String.fromCharCode(...colorSpaceBytes).trim();
    switch (colorSpace) {
        case 'GRAY': return 'Gray';
        case 'RGB': return 'RGB';
        case 'CMYK': return 'CMYK';
        case 'Lab': return 'Lab';
        default: return 'Unknown';
    }
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
const resources = pageDict.get(PDFName.of('Resources'));
const resourcesDict = resources instanceof PDFRef ? context.lookup(resources) : resources;
const colorSpaceDict = resourcesDict?.get(PDFName.of('ColorSpace'));
const csDict = colorSpaceDict instanceof PDFRef ? context.lookup(colorSpaceDict) : colorSpaceDict;

console.log('ColorSpace dict entries:');
for (const [key, value] of csDict.entries()) {
    const csName = key.asString().replace(/^\//, '');
    let csDescriptor = value instanceof PDFRef ? context.lookup(value) : value;

    console.log(`\n  ${csName}:`);
    console.log(`    Raw key: ${key.asString()}`);

    if (csDescriptor instanceof PDFArray && csDescriptor.size() > 0) {
        const csType = csDescriptor.get(0);
        const typeName = csType?.asString?.()?.replace(/^\//, '') || 'unknown';
        console.log(`    Type: ${typeName}`);

        const def = { colorSpaceType: typeName };

        if (typeName === 'ICCBased' && csDescriptor.size() > 1) {
            const iccRef = csDescriptor.get(1);
            const iccStream = iccRef instanceof PDFRef ? context.lookup(iccRef) : iccRef;

            if (iccStream instanceof PDFRawStream) {
                const profileData = getDecompressedContents(iccStream);
                const iccColorSpace = getICCColorSpace(profileData);
                def.colorSpaceType = normalizeColorSpaceType(iccColorSpace);
                console.log(`    ICC raw colorspace: ${iccColorSpace}`);
                console.log(`    Normalized colorSpaceType: ${def.colorSpaceType}`);
            }
        }

        definitions[csName] = def;
    }
}

console.log('\n\n=== Final Color Space Definitions ===');
console.log(JSON.stringify(definitions, null, 2));

// Now parse a content stream and show what operations are found
console.log('\n\n=== Parsing Content Stream 0 ===');

const contents = pageDict.get(PDFName.of('Contents'));
let contentRefs = [];
if (contents instanceof PDFRef) {
    const resolved = context.lookup(contents);
    if (resolved instanceof PDFArray) {
        for (let i = 0; i < resolved.size(); i++) {
            contentRefs.push(resolved.get(i));
        }
    } else {
        contentRefs.push(contents);
    }
}

if (contentRefs.length > 0) {
    const firstRef = contentRefs[0];
    const stream = context.lookup(firstRef);
    if (stream instanceof PDFRawStream) {
        const decoded = decodePDFRawStream(stream).decode();
        const streamText = new TextDecoder().decode(decoded);

        // Parse using the same regex
        const COLOR_OPERATOR_REGEX = /(?<head>[^(]*?)(?:(?:(?<=[\s\n]|^)(?<name>\/\w+)\s+(?<csOp>CS|cs)\b)|(?:(?<=[\s\n]|^)(?<name2>\/\w+)\s+(?<scnOp>SCN|scn)\b)|(?:(?<=[\s\n]|^)(?<gray>(?:\d+\.?\d*|\.\d+))\s+(?<gOp>G|g)\b)|(?:(?<=[\s\n]|^)(?<cmyk>(?:\d+\.?\d*|\.\d+)\s+(?:\d+\.?\d*|\.\d+)\s+(?:\d+\.?\d*|\.\d+)\s+(?:\d+\.?\d*|\.\d+))\s+(?<kOp>K|k)\b)|(?:(?<=[\s\n]|^)(?<rgb>(?:\d+\.?\d*|\.\d+)\s+(?:\d+\.?\d*|\.\d+)\s+(?:\d+\.?\d*|\.\d+))\s+(?<rgOp>RG|rg)\b)|(?:(?<=[\s\n]|^)(?<n>(?:\d+\.?\d*|\.\d+)(?:\s+(?:\d+\.?\d*|\.\d+))*)\s+(?<scOp>SC|sc|SCN|scn)\b)|(?:\((?<string>[^)]*)\))|\s*$)/ug;

        let currentStrokeColorSpace;
        let currentFillColorSpace;

        const regex = new RegExp(COLOR_OPERATOR_REGEX.source, 'ug');
        const matches = Array.from(streamText.matchAll(regex));

        let opCount = 0;
        for (const match of matches) {
            const groups = match.groups ?? {};

            // Color space operator (CS/cs)
            if (groups.csOp && groups.name) {
                const isStroke = groups.csOp === 'CS';
                const name = groups.name.replace(/^\//, '');  // Strip leading slash
                if (isStroke) {
                    currentStrokeColorSpace = name;
                } else {
                    currentFillColorSpace = name;
                }
                opCount++;
                if (opCount <= 20) {
                    console.log(`  CS/cs: ${groups.name} ${groups.csOp} -> context: ${name}`);
                }
                continue;
            }

            // Numeric values with scOp
            if (groups.scOp && groups.n) {
                const operator = groups.scOp;
                const isStroke = operator === 'SC' || operator === 'SCN';
                const colorSpaceName = isStroke ? currentStrokeColorSpace : currentFillColorSpace;
                const values = groups.n.trim().split(/\s+/).map(parseFloat);

                opCount++;
                if (opCount <= 20) {
                    const csDef = definitions[colorSpaceName];
                    const csType = csDef?.colorSpaceType;
                    const willConvert = csType === 'sGray' || csType === 'sRGB' || csType === 'Lab';
                    console.log(`  scOp: ${groups.n} ${operator}`);
                    console.log(`       colorSpaceName: "${colorSpaceName}"`);
                    console.log(`       csDef: ${JSON.stringify(csDef)}`);
                    console.log(`       willConvert: ${willConvert}`);
                }
                continue;
            }

            // Gray
            if (groups.gOp && groups.gray !== undefined) {
                opCount++;
                if (opCount <= 20) {
                    console.log(`  Gray: ${groups.gray} ${groups.gOp}`);
                }
            }
        }

        console.log(`\n  Total operations parsed: ${opCount}`);
    }
}
