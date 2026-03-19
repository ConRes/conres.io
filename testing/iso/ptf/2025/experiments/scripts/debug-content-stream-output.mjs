import { readFile } from 'fs/promises';
import { PDFDocument, PDFRawStream, PDFName, PDFArray, PDFRef, decodePDFRawStream } from 'pdf-lib';

// Compare content streams between legacy and refactored PDFs
const legacyPath = process.argv[2];
const refactoredPath = process.argv[3];

if (!legacyPath || !refactoredPath) {
    console.log('Usage: node debug-content-stream-output.mjs <legacy.pdf> <refactored.pdf>');
    process.exit(1);
}

async function getContentStreams(pdfPath) {
    const pdfBytes = await readFile(pdfPath);
    const pdf = await PDFDocument.load(pdfBytes);
    const context = pdf.context;
    const streams = [];

    for (const page of pdf.getPages()) {
        const pageDict = page.node.dict;
        const contents = pageDict.get(PDFName.of('Contents'));

        if (!contents) continue;

        // Handle both single stream and array of streams
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
        } else if (contents instanceof PDFArray) {
            for (let i = 0; i < contents.size(); i++) {
                contentRefs.push(contents.get(i));
            }
        }

        for (const ref of contentRefs) {
            const stream = ref instanceof PDFRef ? context.lookup(ref) : ref;

            if (stream instanceof PDFRawStream) {
                try {
                    const decoded = decodePDFRawStream(stream).decode();
                    const text = new TextDecoder().decode(decoded);
                    streams.push({ ref: String(ref), text });
                } catch (e) {
                    streams.push({ ref: String(ref), text: `[DECODE ERROR: ${e.message}]` });
                }
            }
        }
    }

    return streams;
}

console.log('Loading legacy PDF...');
const legacyStreams = await getContentStreams(legacyPath);

console.log('Loading refactored PDF...');
const refactoredStreams = await getContentStreams(refactoredPath);

console.log(`\nLegacy streams: ${legacyStreams.length}`);
console.log(`Refactored streams: ${refactoredStreams.length}`);

// Find color operations in streams
const colorOpRegex = /(\d+\.?\d*(?:\s+\d+\.?\d*)*)\s+(k|K|g|G|rg|RG|sc|SC|scn|SCN)\b/g;

for (let i = 0; i < Math.max(legacyStreams.length, refactoredStreams.length); i++) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Stream ${i}`);
    console.log(`${'='.repeat(60)}`);

    if (legacyStreams[i]) {
        const text = legacyStreams[i].text;
        const ops = [...text.matchAll(colorOpRegex)];
        console.log(`\nLegacy color ops (first 10 of ${ops.length}):`);
        ops.slice(0, 10).forEach(m => console.log(`  ${m[0]}`));
    }

    if (refactoredStreams[i]) {
        const text = refactoredStreams[i].text;
        const ops = [...text.matchAll(colorOpRegex)];
        console.log(`\nRefactored color ops (first 10 of ${ops.length}):`);
        ops.slice(0, 10).forEach(m => console.log(`  ${m[0]}`));

        // Check for syntax issues - look for invalid patterns
        const badPatterns = text.match(/\d+\.\d{5,}\s+[kKgGrRsSc]/g);
        if (badPatterns) {
            console.log(`\n⚠️  Potentially suspicious patterns (too many decimals):`);
            badPatterns.slice(0, 5).forEach(p => console.log(`  ${p}`));
        }
    }
}
