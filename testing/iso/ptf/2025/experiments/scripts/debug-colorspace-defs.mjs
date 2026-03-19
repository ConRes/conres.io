import { readFile } from 'fs/promises';
import { PDFDocument, PDFRawStream, PDFName, PDFArray, PDFDict, PDFRef } from 'pdf-lib';
import pako from 'pako';

const pdfPath = process.argv[2] || '../../../tests/fixtures/pdfs/2025-08-15 - ConRes - ISO PTF - CR1 (F9d) Fixtures - F-01.pdf';
const pdfBytes = await readFile(pdfPath);
const pdf = await PDFDocument.load(pdfBytes);
const context = pdf.context;

console.log('Extracting ColorSpace definitions from page Resources\n');

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

for (const [i, page] of pdf.getPages().entries()) {
    console.log(`--- Page ${i + 1} ---`);
    const pageDict = page.node.dict;

    const resources = pageDict.get(PDFName.of('Resources'));
    if (!resources) {
        console.log('  No Resources');
        continue;
    }

    const resourcesDict = resources instanceof PDFRef ? context.lookup(resources) : resources;
    const colorSpaceDict = resourcesDict?.get(PDFName.of('ColorSpace'));
    if (!colorSpaceDict) {
        console.log('  No ColorSpace dict in Resources');
        continue;
    }

    const csDict = colorSpaceDict instanceof PDFRef ? context.lookup(colorSpaceDict) : colorSpaceDict;

    for (const [key, value] of csDict.entries()) {
        const csName = key.asString().replace(/^\//, '');
        let csDescriptor = value instanceof PDFRef ? context.lookup(value) : value;

        console.log(`\n  ${csName}:`);

        if (csDescriptor instanceof PDFArray && csDescriptor.size() > 0) {
            const csType = csDescriptor.get(0);
            const typeName = csType?.asString?.()?.replace(/^\//, '') || 'unknown';
            console.log(`    Type: ${typeName}`);

            if (typeName === 'ICCBased' && csDescriptor.size() > 1) {
                const iccRef = csDescriptor.get(1);
                console.log(`    ICC Ref: ${iccRef}`);

                const iccStream = iccRef instanceof PDFRef ? context.lookup(iccRef) : iccRef;
                if (iccStream instanceof PDFRawStream) {
                    // Decompress if needed
                    const contents = getDecompressedContents(iccStream);

                    if (contents.length >= 20) {
                        const csBytes = contents.slice(16, 20);
                        const iccCS = String.fromCharCode(...csBytes).trim();
                        console.log(`    ICC ColorSpace: ${iccCS}`);
                    }

                    // Check N value in stream dict
                    const nValue = iccStream.dict.get(PDFName.of('N'));
                    console.log(`    N (components): ${nValue}`);
                }
            }
        }
    }
}
