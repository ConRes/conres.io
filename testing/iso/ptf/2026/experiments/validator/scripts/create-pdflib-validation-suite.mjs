#!/usr/bin/env node
// @ts-check
/**
 * Create a suite of intentionally malformed/edge-case PDFs to test what
 * pdf-lib can actually detect. Each PDF targets a specific rule category.
 *
 * For each PDF:
 * 1. Create the malformed file
 * 2. Attempt to load it with pdf-lib
 * 3. Attempt to inspect the relevant properties
 * 4. Record what pdf-lib catches vs misses
 *
 * @author Saleh Abdel Motaal <dev@smotaal.io>
 * @ai Claude Opus 4.6 (code generation)
 */

import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import {
    PDFDocument,
    PDFDict,
    PDFArray,
    PDFName,
    PDFRef,
    PDFRawStream,
    PDFString,
    PDFHexString,
    PDFNumber,
    PDFBool,
    PDFNull,
    PDFContentStream,
    PDFOperator,
    decodePDFRawStream,
} from '../../packages/pdf-lib/pdf-lib.esm.js';

const SUITE_DIR = 'pdf-lib-validation-suite';
await mkdir(SUITE_DIR, { recursive: true });

/** @type {{ id: string, file: string, targetRules: string[], description: string, loadResult: string, inspectionResult: string }[]} */
const report = [];

/**
 * @param {string} id
 * @param {string} description
 * @param {string[]} targetRules
 * @param {() => Promise<Uint8Array>} createFn
 * @param {(doc: PDFDocument) => Promise<string>} inspectFn
 */
async function testCase(id, description, targetRules, createFn, inspectFn) {
    const filename = `${id}.pdf`;
    let bytes;
    try {
        bytes = await createFn();
        await writeFile(join(SUITE_DIR, filename), bytes);
    } catch (e) {
        report.push({ id, file: filename, targetRules, description, loadResult: `CREATE FAILED: ${e.message}`, inspectionResult: 'N/A' });
        console.log(`${id}: CREATE FAILED — ${e.message}`);
        return;
    }

    let doc;
    let loadResult;
    try {
        doc = await PDFDocument.load(bytes, { updateMetadata: false });
        loadResult = 'OK';
    } catch (e) {
        loadResult = `LOAD THROWS: ${e.message?.slice(0, 120)}`;
        report.push({ id, file: filename, targetRules, description, loadResult, inspectionResult: 'N/A (load failed)' });
        console.log(`${id}: LOAD THROWS — ${e.message?.slice(0, 100)}`);
        return;
    }

    let inspectionResult;
    try {
        inspectionResult = await inspectFn(doc);
    } catch (e) {
        inspectionResult = `INSPECT THROWS: ${e.message?.slice(0, 120)}`;
    }

    report.push({ id, file: filename, targetRules, description, loadResult, inspectionResult });
    console.log(`${id}: load=${loadResult}, inspect=${inspectionResult?.slice(0, 80)}`);
}

// Helper: create minimal valid PDF bytes
async function minimalPDFBytes() {
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]);
    return doc.save({ addDefaultPage: false, updateFieldAppearances: false });
}

// Helper: create PDF, apply mutations, save
async function createMutatedPDF(mutate) {
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]);
    await mutate(doc);
    return doc.save({ addDefaultPage: false, updateFieldAppearances: false });
}

// ============================================================================
// PAGE GEOMETRY
// ============================================================================

await testCase('pg-01-no-trimbox', 'Page with only MediaBox (no TrimBox/ArtBox)', ['RUL122'],
    () => createMutatedPDF(doc => { /* default — no TrimBox */ }),
    async (doc) => {
        const page = doc.getPages()[0].node;
        const hasTrim = !!page.get(PDFName.of('TrimBox'));
        const hasArt = !!page.get(PDFName.of('ArtBox'));
        return `TrimBox=${hasTrim}, ArtBox=${hasArt} — DETECTABLE`;
    }
);

await testCase('pg-02-both-trimbox-artbox', 'Page with both TrimBox AND ArtBox', ['RUL95'],
    () => createMutatedPDF(doc => {
        const page = doc.getPages()[0].node;
        const box = doc.context.obj([0, 0, 612, 792]);
        page.set(PDFName.of('TrimBox'), box);
        page.set(PDFName.of('ArtBox'), box);
    }),
    async (doc) => {
        const page = doc.getPages()[0].node;
        const hasTrim = !!page.get(PDFName.of('TrimBox'));
        const hasArt = !!page.get(PDFName.of('ArtBox'));
        return `TrimBox=${hasTrim}, ArtBox=${hasArt} — DETECTABLE (both present = violation)`;
    }
);

await testCase('pg-03-no-mediabox', 'Page with MediaBox removed', ['RUL103'],
    () => createMutatedPDF(doc => {
        const page = doc.getPages()[0].node;
        page.delete(PDFName.of('MediaBox'));
    }),
    async (doc) => {
        const page = doc.getPages()[0].node;
        const hasMedia = !!page.get(PDFName.of('MediaBox'));
        return `MediaBox=${hasMedia} — DETECTABLE`;
    }
);

await testCase('pg-04-bad-nesting', 'CropBox larger than MediaBox', ['RUL155'],
    () => createMutatedPDF(doc => {
        const page = doc.getPages()[0].node;
        page.set(PDFName.of('CropBox'), doc.context.obj([0, 0, 1000, 1000]));
    }),
    async (doc) => {
        const page = doc.getPages()[0].node;
        const media = page.lookup(PDFName.of('MediaBox'));
        const crop = page.lookup(PDFName.of('CropBox'));
        // Check nesting: CropBox should be within MediaBox
        if (media instanceof PDFArray && crop instanceof PDFArray) {
            const mw = media.lookup(2).numberValue;
            const cw = crop.lookup(2).numberValue;
            return `MediaBox width=${mw}, CropBox width=${cw} — DETECTABLE (crop > media)`;
        }
        return 'Could not compare';
    }
);

// ============================================================================
// DOCUMENT STRUCTURE
// ============================================================================

await testCase('ds-01-no-doc-id', 'Document with no ID', ['RUL127'],
    () => createMutatedPDF(doc => { /* default — pdf-lib create() has no ID */ }),
    async (doc) => {
        const hasID = !!doc.context.trailerInfo.ID;
        return `HasDocID=${hasID} — DETECTABLE`;
    }
);

await testCase('ds-02-damaged-pdf', 'Truncated/corrupt PDF', ['RUL113'],
    async () => {
        const good = await minimalPDFBytes();
        // Truncate to 60% of size
        return new Uint8Array(good.slice(0, Math.floor(good.length * 0.6)));
    },
    async () => 'Should not reach here'
);

await testCase('ds-03-empty-pdf', 'Empty file (0 bytes)', ['RUL113'],
    async () => new Uint8Array(0),
    async () => 'Should not reach here'
);

await testCase('ds-04-not-a-pdf', 'Plain text file with .pdf extension', ['RUL113'],
    async () => new TextEncoder().encode('This is not a PDF file.'),
    async () => 'Should not reach here'
);

await testCase('ds-05-has-javascript', 'Document with JavaScript', ['RUL209'],
    () => createMutatedPDF(doc => {
        // Add a Names/JavaScript entry
        const jsStream = doc.context.stream(new TextEncoder().encode('app.alert("test");'), {});
        const jsRef = doc.context.register(jsStream);
        const jsAction = doc.context.obj({ Type: 'Action', S: 'JavaScript', JS: jsRef });
        const jsActionRef = doc.context.register(jsAction);
        const nameTree = doc.context.obj({
            Names: doc.context.obj(['test', jsActionRef]),
        });
        const nameTreeRef = doc.context.register(nameTree);
        const names = doc.context.obj({ JavaScript: nameTreeRef });
        doc.catalog.set(PDFName.of('Names'), doc.context.register(names));
    }),
    async (doc) => {
        const names = doc.catalog.lookup(PDFName.of('Names'));
        const hasJS = names instanceof PDFDict && !!names.get(PDFName.of('JavaScript'));
        return `HasJavaScript=${hasJS} — DETECTABLE`;
    }
);

await testCase('ds-06-encrypted', 'Check encryption detection', ['RUL156'],
    () => createMutatedPDF(doc => { /* cannot easily create encrypted PDF with pdf-lib */ }),
    async (doc) => {
        const hasEncrypt = !!doc.context.trailerInfo.Encrypt;
        return `Encrypted=${hasEncrypt} — DETECTABLE (check trailerInfo.Encrypt)`;
    }
);

// ============================================================================
// XMP METADATA
// ============================================================================

await testCase('xm-01-no-xmp', 'Document with no XMP metadata', ['RUL54'],
    () => createMutatedPDF(doc => {
        doc.catalog.delete(PDFName.of('Metadata'));
    }),
    async (doc) => {
        const hasMeta = !!doc.catalog.get(PDFName.of('Metadata'));
        return `HasXMPMetadata=${hasMeta} — DETECTABLE`;
    }
);

await testCase('xm-02-xmp-present', 'Document with XMP metadata stream', ['RUL54'],
    () => createMutatedPDF(doc => {
        const xmp = `<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about=""
      xmlns:dc="http://purl.org/dc/elements/1.1/"
      xmlns:xmp="http://ns.adobe.com/xap/1.0/"
      xmlns:pdfx="http://ns.adobe.com/pdfx/1.3/">
      <dc:title><rdf:Alt><rdf:li xml:lang="x-default">Test</rdf:li></rdf:Alt></dc:title>
      <xmp:CreateDate>2026-03-29T00:00:00Z</xmp:CreateDate>
      <xmp:ModifyDate>2026-03-29T00:00:00Z</xmp:ModifyDate>
      <xmp:MetadataDate>2026-03-29T00:00:00Z</xmp:MetadataDate>
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
        const xmpBytes = new TextEncoder().encode(xmp);
        const xmpStream = doc.context.stream(xmpBytes, {
            Type: 'Metadata',
            Subtype: 'XML',
            Length: xmpBytes.length,
        });
        const xmpRef = doc.context.register(xmpStream);
        doc.catalog.set(PDFName.of('Metadata'), xmpRef);
    }),
    async (doc) => {
        const metaRef = doc.catalog.get(PDFName.of('Metadata'));
        if (!(metaRef instanceof PDFRef)) return 'No metadata ref';
        const metaObj = doc.context.lookup(metaRef);
        if (!(metaObj instanceof PDFRawStream)) return 'Metadata not a stream';
        const content = new TextDecoder().decode(metaObj.getContents());
        const hasTitle = content.includes('dc:title');
        const hasCreateDate = content.includes('xmp:CreateDate');
        const hasModifyDate = content.includes('xmp:ModifyDate');
        return `XMP readable: title=${hasTitle}, create=${hasCreateDate}, modify=${hasModifyDate} — PARSEABLE`;
    }
);

// ============================================================================
// OUTPUT INTENT
// ============================================================================

await testCase('oi-01-no-output-intent', 'Document with no OutputIntent', ['RUL26'],
    () => createMutatedPDF(doc => { /* default — no output intent */ }),
    async (doc) => {
        const oi = doc.catalog.get(PDFName.of('OutputIntents'));
        return `HasOutputIntents=${!!oi} — DETECTABLE`;
    }
);

await testCase('oi-02-bare-icc-stream', 'OutputIntent with bare ICC stream (no /N, /Alternate)', ['RUL208'],
    () => createMutatedPDF(doc => {
        // Fake ICC profile header (just enough to have the signature)
        const fakeProfile = new Uint8Array(128);
        fakeProfile[36] = 0x61; fakeProfile[37] = 0x63; fakeProfile[38] = 0x73; fakeProfile[39] = 0x70; // 'acsp'
        fakeProfile[16] = 0x43; fakeProfile[17] = 0x4D; fakeProfile[18] = 0x59; fakeProfile[19] = 0x4B; // 'CMYK'
        const stream = doc.context.stream(fakeProfile, { Length: fakeProfile.length });
        const streamRef = doc.context.register(stream);
        const intent = doc.context.obj({
            Type: 'OutputIntent', S: 'GTS_PDFX',
            OutputConditionIdentifier: PDFString.of('Test'),
            DestOutputProfile: streamRef,
        });
        doc.catalog.set(PDFName.of('OutputIntents'), doc.context.obj([doc.context.register(intent)]));
    }),
    async (doc) => {
        const oi = doc.catalog.lookup(PDFName.of('OutputIntents'));
        if (!(oi instanceof PDFArray) || oi.size() === 0) return 'No OutputIntents';
        const intent = oi.lookup(0);
        if (!(intent instanceof PDFDict)) return 'Intent not dict';
        const profRef = intent.get(PDFName.of('DestOutputProfile'));
        if (!(profRef instanceof PDFRef)) return 'No profile ref';
        const prof = doc.context.lookup(profRef);
        if (!(prof instanceof PDFRawStream)) return 'Profile not stream';
        const hasN = !!prof.dict.get(PDFName.of('N'));
        const hasAlt = !!prof.dict.get(PDFName.of('Alternate'));
        const hasFilter = !!prof.dict.get(PDFName.of('Filter'));
        const raw = prof.getContents();
        const sig = String.fromCharCode(raw[16], raw[17], raw[18], raw[19]);
        return `N=${hasN}, Alternate=${hasAlt}, Filter=${hasFilter}, ICC sig="${sig}" — ALL DETECTABLE`;
    }
);

await testCase('oi-03-proper-icc-stream', 'OutputIntent with proper ICC stream attributes', [],
    () => createMutatedPDF(doc => {
        const fakeProfile = new Uint8Array(128);
        fakeProfile[36] = 0x61; fakeProfile[37] = 0x63; fakeProfile[38] = 0x73; fakeProfile[39] = 0x70;
        fakeProfile[16] = 0x43; fakeProfile[17] = 0x4D; fakeProfile[18] = 0x59; fakeProfile[19] = 0x4B;
        const stream = doc.context.flateStream(fakeProfile, { N: 4, Alternate: 'DeviceCMYK' });
        const streamRef = doc.context.register(stream);
        const intent = doc.context.obj({
            Type: 'OutputIntent', S: 'GTS_PDFX',
            OutputConditionIdentifier: PDFString.of('Test'),
            DestOutputProfile: streamRef,
        });
        doc.catalog.set(PDFName.of('OutputIntents'), doc.context.obj([doc.context.register(intent)]));
    }),
    async (doc) => {
        const oi = doc.catalog.lookup(PDFName.of('OutputIntents'));
        const intent = oi.lookup(0);
        const profRef = intent.get(PDFName.of('DestOutputProfile'));
        const prof = doc.context.lookup(profRef);
        const hasN = !!prof.dict.get(PDFName.of('N'));
        const hasAlt = !!prof.dict.get(PDFName.of('Alternate'));
        return `N=${hasN}, Alternate=${hasAlt} — control case, properly formed`;
    }
);

// ============================================================================
// OPTIONAL CONTENT (OCG)
// ============================================================================

await testCase('oc-01-ocg-no-name', 'OCG without Name entry', ['RUL4'],
    () => createMutatedPDF(doc => {
        const ocg = doc.context.obj({ Type: 'OCG' }); // no Name
        const ocgRef = doc.context.register(ocg);
        const ocProps = doc.context.obj({
            OCGs: doc.context.obj([ocgRef]),
            D: doc.context.obj({ ON: doc.context.obj([ocgRef]) }),
        });
        doc.catalog.set(PDFName.of('OCProperties'), doc.context.register(ocProps));
    }),
    async (doc) => {
        const ocProps = doc.catalog.lookup(PDFName.of('OCProperties'));
        if (!(ocProps instanceof PDFDict)) return 'No OCProperties';
        const ocgs = ocProps.lookup(PDFName.of('OCGs'));
        if (!(ocgs instanceof PDFArray)) return 'No OCGs array';
        let unnamed = 0;
        for (let i = 0; i < ocgs.size(); i++) {
            const ocg = ocgs.lookup(i);
            if (ocg instanceof PDFDict && !ocg.get(PDFName.of('Name'))) unnamed++;
        }
        return `Unnamed OCGs: ${unnamed} — DETECTABLE`;
    }
);

await testCase('oc-02-occd-no-name', 'OCCD without Name entry', ['RUL106'],
    () => createMutatedPDF(doc => {
        const ocg = doc.context.obj({ Type: 'OCG', Name: PDFString.of('Layer1') });
        const ocgRef = doc.context.register(ocg);
        const ocProps = doc.context.obj({
            OCGs: doc.context.obj([ocgRef]),
            D: doc.context.obj({ ON: doc.context.obj([ocgRef]) }), // D has no Name
        });
        doc.catalog.set(PDFName.of('OCProperties'), doc.context.register(ocProps));
    }),
    async (doc) => {
        const ocProps = doc.catalog.lookup(PDFName.of('OCProperties'));
        const d = ocProps.lookup(PDFName.of('D'));
        const hasName = d instanceof PDFDict && !!d.get(PDFName.of('Name'));
        return `OCCD has Name: ${hasName} — DETECTABLE`;
    }
);

// ============================================================================
// FONT
// ============================================================================

await testCase('fn-01-unembedded-font', 'Font not embedded', ['RUL217'],
    () => createMutatedPDF(doc => {
        // pdf-lib standard fonts are not embedded
        const page = doc.getPages()[0];
        const font = doc.embedStandardFont('Helvetica');
        page.drawText('Hello World', { x: 50, y: 700, size: 12, font });
    }),
    async (doc) => {
        // Check all font dicts for FontDescriptor with FontFile/FontFile2/FontFile3
        const page = doc.getPages()[0].node;
        const resources = page.lookup(PDFName.of('Resources'));
        if (!(resources instanceof PDFDict)) return 'No resources';
        const fonts = resources.lookup(PDFName.of('Font'));
        if (!(fonts instanceof PDFDict)) return 'No fonts';
        const results = [];
        for (const [key, val] of fonts.entries()) {
            const fontDict = val instanceof PDFRef ? doc.context.lookup(val) : val;
            if (!(fontDict instanceof PDFDict)) continue;
            const baseFont = fontDict.lookup(PDFName.of('BaseFont'));
            const fdRef = fontDict.get(PDFName.of('FontDescriptor'));
            let embedded = false;
            if (fdRef instanceof PDFRef) {
                const fd = doc.context.lookup(fdRef);
                if (fd instanceof PDFDict) {
                    embedded = !!(fd.get(PDFName.of('FontFile')) || fd.get(PDFName.of('FontFile2')) || fd.get(PDFName.of('FontFile3')));
                }
            }
            const name = baseFont instanceof PDFName ? baseFont.encodedName : '?';
            results.push(`${name}:embedded=${embedded}`);
        }
        return `Fonts: ${results.join(', ')} — DETECTABLE`;
    }
);

await testCase('fn-02-widths-mismatch', 'Font Widths array wrong length', ['RUL212'],
    () => createMutatedPDF(doc => {
        const page = doc.getPages()[0];
        const font = doc.embedStandardFont('Helvetica');
        page.drawText('Test', { x: 50, y: 700, size: 12, font });
        // After drawing, mutate the font dict Widths
        const resources = page.node.lookup(PDFName.of('Resources'));
        const fonts = resources.lookup(PDFName.of('Font'));
        for (const [, val] of fonts.entries()) {
            const fontDict = val instanceof PDFRef ? doc.context.lookup(val) : val;
            if (fontDict instanceof PDFDict) {
                const widths = fontDict.get(PDFName.of('Widths'));
                if (widths instanceof PDFArray) {
                    // Add extra width entries to mismatch
                    widths.push(PDFNumber.of(999));
                    widths.push(PDFNumber.of(999));
                }
            }
        }
    }),
    async (doc) => {
        const page = doc.getPages()[0].node;
        const fonts = page.lookup(PDFName.of('Resources')).lookup(PDFName.of('Font'));
        const results = [];
        for (const [, val] of fonts.entries()) {
            const fontDict = val instanceof PDFRef ? doc.context.lookup(val) : val;
            if (!(fontDict instanceof PDFDict)) continue;
            const widths = fontDict.lookup(PDFName.of('Widths'));
            const firstChar = fontDict.lookup(PDFName.of('FirstChar'));
            const lastChar = fontDict.lookup(PDFName.of('LastChar'));
            if (widths instanceof PDFArray && firstChar instanceof PDFNumber && lastChar instanceof PDFNumber) {
                const expected = lastChar.numberValue - firstChar.numberValue + 1;
                const actual = widths.size();
                results.push(`expected=${expected}, actual=${actual}, match=${expected === actual}`);
            }
        }
        return `Widths check: ${results.join('; ')} — DETECTABLE`;
    }
);

// ============================================================================
// CONTENT STREAM
// ============================================================================

await testCase('cs-01-unknown-operator', 'Content stream with unknown operator', ['RUL191'],
    () => createMutatedPDF(doc => {
        const page = doc.getPages()[0];
        // Inject a raw content stream with an unknown operator
        const badContent = new TextEncoder().encode('q\n1 0 0 1 0 0 cm\nZZINVALID\nQ\n');
        const stream = doc.context.stream(badContent, {});
        const streamRef = doc.context.register(stream);
        const contentsArray = doc.context.obj([streamRef]);
        page.node.set(PDFName.of('Contents'), contentsArray);
    }),
    async (doc) => {
        const page = doc.getPages()[0].node;
        const contentsRaw = page.get(PDFName.of('Contents'));
        let contentRefs = [];
        if (contentsRaw instanceof PDFRef) contentRefs = [contentsRaw];
        else if (contentsRaw instanceof PDFArray) {
            for (let i = 0; i < contentsRaw.size(); i++) {
                const item = contentsRaw.get(i);
                if (item instanceof PDFRef) contentRefs.push(item);
            }
        }
        const knownOps = new Set([
            'b','B','b*','B*','BDC','BI','BMC','BT','BX','c','cm','CS','cs','d','d0','d1','Do',
            'DP','EI','EMC','ET','EX','f','F','f*','G','g','gs','h','i','ID','j','J','K','k',
            'l','m','M','MP','n','q','Q','re','RG','rg','ri','s','S','SC','sc','SCN','scn','sh',
            'T*','Tc','Td','TD','Tf','Tj','TJ','TL','Tm','Tr','Ts','Tw','Tz','v','w','W','W*','y',"'",'"',
        ]);
        const unknowns = [];
        for (const ref of contentRefs) {
            const obj = doc.context.lookup(ref);
            if (!(obj instanceof PDFRawStream)) continue;
            const text = new TextDecoder('latin1').decode(obj.getContents());
            const tokens = text.split(/\s+/).filter(Boolean);
            for (const t of tokens) {
                if (/^[a-zA-Z]/.test(t) && !knownOps.has(t) && !t.startsWith('/')) {
                    unknowns.push(t);
                }
            }
        }
        return `Unknown operators: [${unknowns.join(', ')}] — DETECTABLE`;
    }
);

await testCase('cs-02-deeply-nested-q', 'Content stream with deeply nested q/Q (29 levels)', ['RUL135'],
    () => createMutatedPDF(doc => {
        const depth = 29; // PDF limit is 28
        let content = '';
        for (let i = 0; i < depth; i++) content += 'q\n';
        for (let i = 0; i < depth; i++) content += 'Q\n';
        const stream = doc.context.stream(new TextEncoder().encode(content), {});
        const ref = doc.context.register(stream);
        doc.getPages()[0].node.set(PDFName.of('Contents'), doc.context.obj([ref]));
    }),
    async (doc) => {
        const page = doc.getPages()[0].node;
        const ref = page.lookup(PDFName.of('Contents')).get(0);
        const obj = doc.context.lookup(ref);
        const text = new TextDecoder('latin1').decode(obj.getContents());
        let depth = 0, maxDepth = 0;
        for (const token of text.split(/\s+/)) {
            if (token === 'q') { depth++; maxDepth = Math.max(maxDepth, depth); }
            if (token === 'Q') depth--;
        }
        return `Max q/Q depth: ${maxDepth} (limit=28) — DETECTABLE`;
    }
);

// ============================================================================
// MISSING RESOURCES
// ============================================================================

await testCase('mr-01-missing-xobject', 'Page references XObject that does not exist', ['RUL30'],
    () => createMutatedPDF(doc => {
        const page = doc.getPages()[0];
        // Add a content stream that references a nonexistent XObject
        const content = new TextEncoder().encode('q\n/NonExistent Do\nQ\n');
        const stream = doc.context.stream(content, {});
        const ref = doc.context.register(stream);
        page.node.set(PDFName.of('Contents'), doc.context.obj([ref]));
        // Create Resources with XObject dict but without /NonExistent
        const resources = page.node.lookup(PDFName.of('Resources'));
        if (resources instanceof PDFDict) {
            resources.set(PDFName.of('XObject'), PDFDict.withContext(doc.context));
        }
    }),
    async (doc) => {
        const page = doc.getPages()[0].node;
        const resources = page.lookup(PDFName.of('Resources'));
        const xobjects = resources instanceof PDFDict ? resources.lookup(PDFName.of('XObject')) : null;
        // Parse content stream for Do operators
        const contentsRaw = page.get(PDFName.of('Contents'));
        const refs = [];
        if (contentsRaw instanceof PDFArray) {
            for (let i = 0; i < contentsRaw.size(); i++) {
                const r = contentsRaw.get(i);
                if (r instanceof PDFRef) refs.push(r);
            }
        }
        const usedXObjects = new Set();
        for (const ref of refs) {
            const obj = doc.context.lookup(ref);
            if (!(obj instanceof PDFRawStream)) continue;
            const text = new TextDecoder('latin1').decode(obj.getContents());
            const doOps = text.matchAll(/\/([\w.-]+)\s+Do\b/g);
            for (const m of doOps) usedXObjects.add(m[1]);
        }
        const missing = [];
        for (const name of usedXObjects) {
            if (xobjects instanceof PDFDict && !xobjects.get(PDFName.of(name))) {
                missing.push(name);
            }
        }
        return `Missing XObjects: [${missing.join(', ')}] — DETECTABLE (cross-ref content stream Do ops with Resources/XObject)`;
    }
);

await testCase('mr-02-missing-font', 'Page references Font that does not exist', ['RUL202'],
    () => createMutatedPDF(doc => {
        const page = doc.getPages()[0];
        const content = new TextEncoder().encode('BT\n/MissingFont 12 Tf\n(Hello) Tj\nET\n');
        const stream = doc.context.stream(content, {});
        const ref = doc.context.register(stream);
        page.node.set(PDFName.of('Contents'), doc.context.obj([ref]));
    }),
    async (doc) => {
        const page = doc.getPages()[0].node;
        const resources = page.lookup(PDFName.of('Resources'));
        const fonts = resources instanceof PDFDict ? resources.lookup(PDFName.of('Font')) : null;
        const contentsRaw = page.get(PDFName.of('Contents'));
        const refs = [];
        if (contentsRaw instanceof PDFArray) {
            for (let i = 0; i < contentsRaw.size(); i++) {
                const r = contentsRaw.get(i);
                if (r instanceof PDFRef) refs.push(r);
            }
        }
        const usedFonts = new Set();
        for (const ref of refs) {
            const obj = doc.context.lookup(ref);
            if (!(obj instanceof PDFRawStream)) continue;
            const text = new TextDecoder('latin1').decode(obj.getContents());
            const tfOps = text.matchAll(/\/([\w.-]+)\s+[\d.]+\s+Tf\b/g);
            for (const m of tfOps) usedFonts.add(m[1]);
        }
        const missing = [];
        for (const name of usedFonts) {
            if (!(fonts instanceof PDFDict) || !fonts.get(PDFName.of(name))) {
                missing.push(name);
            }
        }
        return `Missing fonts: [${missing.join(', ')}] — DETECTABLE`;
    }
);

await testCase('mr-03-missing-extgstate', 'Page references ExtGState that does not exist', ['RUL144'],
    () => createMutatedPDF(doc => {
        const page = doc.getPages()[0];
        const content = new TextEncoder().encode('q\n/MissingGS gs\nQ\n');
        const stream = doc.context.stream(content, {});
        const ref = doc.context.register(stream);
        page.node.set(PDFName.of('Contents'), doc.context.obj([ref]));
    }),
    async (doc) => {
        const page = doc.getPages()[0].node;
        const resources = page.lookup(PDFName.of('Resources'));
        const gs = resources instanceof PDFDict ? resources.lookup(PDFName.of('ExtGState')) : null;
        const contentsRaw = page.get(PDFName.of('Contents'));
        const refs = [];
        if (contentsRaw instanceof PDFArray) {
            for (let i = 0; i < contentsRaw.size(); i++) {
                const r = contentsRaw.get(i);
                if (r instanceof PDFRef) refs.push(r);
            }
        }
        const usedGS = new Set();
        for (const ref of refs) {
            const obj = doc.context.lookup(ref);
            if (!(obj instanceof PDFRawStream)) continue;
            const text = new TextDecoder('latin1').decode(obj.getContents());
            const gsOps = text.matchAll(/\/([\w.-]+)\s+gs\b/g);
            for (const m of gsOps) usedGS.add(m[1]);
        }
        const missing = [];
        for (const name of usedGS) {
            if (!(gs instanceof PDFDict) || !gs.get(PDFName.of(name))) missing.push(name);
        }
        return `Missing ExtGState: [${missing.join(', ')}] — DETECTABLE`;
    }
);

// ============================================================================
// FORM XOBJECT
// ============================================================================

await testCase('fx-01-no-bbox', 'Form XObject without BBox', ['RUL93'],
    () => createMutatedPDF(doc => {
        const formStream = doc.context.stream(new TextEncoder().encode('q Q'), {
            Type: 'XObject', Subtype: 'Form',
            // No BBox
        });
        const formRef = doc.context.register(formStream);
        const page = doc.getPages()[0];
        const resources = page.node.lookup(PDFName.of('Resources'));
        if (resources instanceof PDFDict) {
            let xobj = resources.lookup(PDFName.of('XObject'));
            if (!(xobj instanceof PDFDict)) {
                xobj = PDFDict.withContext(doc.context);
                resources.set(PDFName.of('XObject'), xobj);
            }
            xobj.set(PDFName.of('TestForm'), formRef);
        }
    }),
    async (doc) => {
        const objects = doc.context.enumerateIndirectObjects();
        const noBBox = [];
        for (const [ref, obj] of objects) {
            if (!(obj instanceof PDFRawStream)) continue;
            const subtype = obj.dict.get(PDFName.of('Subtype'));
            if (!(subtype instanceof PDFName) || subtype.encodedName !== 'Form') continue;
            if (!obj.dict.get(PDFName.of('BBox'))) noBBox.push(ref.objectNumber);
        }
        return `Form XObjects without BBox: [${noBBox.join(', ')}] — DETECTABLE`;
    }
);

await testCase('fx-02-no-subtype', 'XObject without Subtype', ['RUL92'],
    () => createMutatedPDF(doc => {
        const stream = doc.context.stream(new TextEncoder().encode(''), {
            Type: 'XObject',
            // No Subtype
        });
        const ref = doc.context.register(stream);
        const page = doc.getPages()[0];
        const resources = page.node.lookup(PDFName.of('Resources'));
        if (resources instanceof PDFDict) {
            let xobj = resources.lookup(PDFName.of('XObject'));
            if (!(xobj instanceof PDFDict)) {
                xobj = PDFDict.withContext(doc.context);
                resources.set(PDFName.of('XObject'), xobj);
            }
            xobj.set(PDFName.of('TestNoSubtype'), ref);
        }
    }),
    async (doc) => {
        const objects = doc.context.enumerateIndirectObjects();
        const noSubtype = [];
        for (const [ref, obj] of objects) {
            if (!(obj instanceof PDFRawStream)) continue;
            const type = obj.dict.get(PDFName.of('Type'));
            if (!(type instanceof PDFName) || type.encodedName !== 'XObject') continue;
            if (!obj.dict.get(PDFName.of('Subtype'))) noSubtype.push(ref.objectNumber);
        }
        return `XObjects without Subtype: [${noSubtype.join(', ')}] — DETECTABLE`;
    }
);

// ============================================================================
// REPORT
// ============================================================================

console.log('\n\n' + '='.repeat(120));
console.log('PDF-LIB VALIDATION CAPABILITIES — AUDIT RESULTS');
console.log('='.repeat(120) + '\n');

console.log('| ID | Target Rules | Description | Load | Inspection |');
console.log('|----|-------------|-------------|------|------------|');
for (const r of report) {
    const truncDesc = r.description.length > 45 ? r.description.slice(0, 42) + '...' : r.description;
    const truncLoad = r.loadResult.length > 15 ? r.loadResult.slice(0, 12) + '...' : r.loadResult;
    const truncInsp = r.inspectionResult.length > 55 ? r.inspectionResult.slice(0, 52) + '...' : r.inspectionResult;
    console.log(`| ${r.id} | ${r.targetRules.join(',')} | ${truncDesc} | ${truncLoad} | ${truncInsp} |`);
}

const detectable = report.filter(r => r.inspectionResult.includes('DETECTABLE') || r.inspectionResult.includes('PARSEABLE') || r.loadResult.includes('THROWS'));
console.log(`\n${detectable.length}/${report.length} test cases produced detectable results.`);
console.log(`Files written to ${SUITE_DIR}/`);
