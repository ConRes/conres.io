import { readFile } from 'fs/promises';
import { PDFDocument, PDFRawStream, PDFName, PDFArray, PDFRef, decodePDFRawStream } from 'pdf-lib';

const pdfPath = process.argv[2];
console.log('Loading PDF:', pdfPath);

const pdfBytes = await readFile(pdfPath);
const pdf = await PDFDocument.load(pdfBytes);
const context = pdf.context;

const page = pdf.getPages()[0];
const pageDict = page.node.dict;
const contents = pageDict.get(PDFName.of('Contents'));

console.log('Contents:', contents);

let contentRefs = [];
if (contents instanceof PDFRef) {
    const resolved = context.lookup(contents);
    console.log('Resolved contents:', resolved?.constructor?.name);
    if (resolved instanceof PDFArray) {
        for (let i = 0; i < resolved.size(); i++) {
            contentRefs.push(resolved.get(i));
        }
    } else if (resolved instanceof PDFRawStream) {
        contentRefs.push(contents);
    }
} else if (contents instanceof PDFArray) {
    for (let i = 0; i < contents.size(); i++) {
        contentRefs.push(contents.get(i));
    }
}

console.log('Content refs:', contentRefs.length);

// Check all streams
for (let idx = 0; idx < contentRefs.length; idx++) {
    const ref = contentRefs[idx];
    const stream = ref instanceof PDFRef ? context.lookup(ref) : ref;
    if (!(stream instanceof PDFRawStream)) continue;

    const decoded = decodePDFRawStream(stream).decode();
    const text = new TextDecoder().decode(decoded);

    console.log(`\n=== Stream ${idx} ===`);
    console.log('First 500 chars:');
    console.log(text.slice(0, 500));

    // Look for CS/cs operators
    const csMatches = text.match(/\/\w+\s+(CS|cs)\b/g);
    console.log('\nCS/cs operators found:', csMatches?.slice(0, 5) || 'NONE');

    // Look for scn/SCN operators
    const scnMatches = text.match(/[\d.\s]+\s+(scn|SCN)\b/g);
    console.log('scn/SCN with values (first 5):', scnMatches?.slice(0, 5) || 'NONE');
}
