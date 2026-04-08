#!/usr/bin/env node
// @ts-check
/**
 * Generates the `color-conversion-matrix.pdf` test fixture.
 *
 * A single comprehensive PDF (~20-30 KB) that exercises all content stream
 * color operators, color space types, graphics state management, string
 * span handling, carry boundary conditions, and image conversion paths.
 *
 * See progress/2026-04-08-TEST-FIXTURES-PLAN.md for the full spec.
 *
 * Usage:
 *   node testing/iso/ptf/2026/tests/fixtures/generate-fixtures.mjs
 *
 * Output:
 *   testing/iso/ptf/2026/tests/fixtures/references/color-conversion-matrix.pdf
 *
 * Idempotent: produces byte-identical output on every run (deterministic
 * compression, fixed CreationDate, no random IDs).
 *
 * @author Saleh Abdel Motaal <dev@smotaal.io>
 * @ai Claude Opus 4.6 (code generation)
 */

import { writeFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REFERENCES_DIR = join(__dirname, 'references');
const PROFILES_DIR = join(__dirname, 'profiles');

// ============================================================================
// PDF-lib imports
// ============================================================================

const {
    PDFDocument,
    PDFRawStream,
    PDFName,
    PDFArray,
    PDFDict,
    PDFRef,
    PDFString,
    PDFHexString,
    PDFNumber,
} = await import(join(__dirname, '..', '..', 'packages', 'pdf-lib', 'pdf-lib.esm.js'));

// ============================================================================
// Compression helper
// ============================================================================

/**
 * Deflate-compress bytes (FlateDecode).
 * @param {Uint8Array} data
 * @returns {Promise<Uint8Array>}
 */
async function deflate(data) {
    const cs = new CompressionStream('deflate');
    const writer = cs.writable.getWriter();
    writer.write(data);
    writer.close();
    const chunks = [];
    const reader = cs.readable.getReader();
    while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        chunks.push(value);
    }
    const total = chunks.reduce((n, c) => n + c.length, 0);
    const result = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) { result.set(c, offset); offset += c.length; }
    return result;
}

/**
 * Encode a string as Latin-1 bytes.
 * @param {string} text
 * @returns {Uint8Array}
 */
function latin1(text) {
    const bytes = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
    return bytes;
}

// ============================================================================
// ICC Profile Loading
// ============================================================================

const sRGBProfileBytes = await readFile(join(PROFILES_DIR, 'sRGB IEC61966-2.1.icc'));
const sGrayProfileBytes = await readFile(join(PROFILES_DIR, 'sGray.icc'));

// ============================================================================
// Build PDF
// ============================================================================

const doc = await PDFDocument.create();
const ctx = doc.context;

// Fixed creation date for idempotent output
doc.setCreationDate(new Date('2026-04-08T00:00:00Z'));
doc.setModificationDate(new Date('2026-04-08T00:00:00Z'));
doc.setProducer('generate-fixtures.mjs (Color Conversion Matrix)');
doc.setTitle('Color Conversion Matrix Test Fixture');

// ── Embed ICC profiles ─────────────────────────────────────────────

// sRGB profile stream
const sRGBStreamDict = ctx.obj({ N: 3, Filter: 'FlateDecode' });
const sRGBCompressed = await deflate(sRGBProfileBytes);
const sRGBStream = PDFRawStream.of(sRGBStreamDict, sRGBCompressed);
const sRGBRef = ctx.register(sRGBStream);

// sGray profile stream
const sGrayStreamDict = ctx.obj({ N: 1, Filter: 'FlateDecode' });
const sGrayCompressed = await deflate(sGrayProfileBytes);
const sGrayStream = PDFRawStream.of(sGrayStreamDict, sGrayCompressed);
const sGrayRef = ctx.register(sGrayStream);

// ── Color space definitions ────────────────────────────────────────

// /CS0 → ICCBased RGB (sRGB)
const cs0Array = ctx.obj([PDFName.of('ICCBased'), sRGBRef]);
const cs0Ref = ctx.register(cs0Array);

// /CS1 → Lab
const cs1Array = ctx.obj([
    PDFName.of('Lab'),
    ctx.obj({
        WhitePoint: [0.9505, 1.0, 1.089],
        Range: [-128, 127, -128, 127],
    }),
]);
const cs1Ref = ctx.register(cs1Array);

// /CS2 → ICCBased Gray (sGray)
const cs2Array = ctx.obj([PDFName.of('ICCBased'), sGrayRef]);
const cs2Ref = ctx.register(cs2Array);

// ── Image XObjects ─────────────────────────────────────────────────

// /Im0: ICCBased RGB, 16-bit, 4×4 pixels
// Diagnostic pixel grid — each pixel chosen for specific conversion paths
const im0Pixels = new Uint8Array([
    // Row 1: primaries + white
    0xFF, 0xFF, 0x00, 0x00, 0x00, 0x00,  // Pure red
    0x00, 0x00, 0xFF, 0xFF, 0x00, 0x00,  // Pure green
    0x00, 0x00, 0x00, 0x00, 0xFF, 0xFF,  // Pure blue
    0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF,  // White
    // Row 2: neutrals (K-Only GCR test)
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00,  // Black
    0x80, 0x00, 0x80, 0x00, 0x80, 0x00,  // 50% gray
    0x40, 0x00, 0x40, 0x00, 0x40, 0x00,  // 25% gray
    0xC0, 0x00, 0xC0, 0x00, 0xC0, 0x00,  // 75% gray
    // Row 3: real-world colors
    0xD4, 0xA0, 0x8C, 0x60, 0x6E, 0x40,  // Skin tone
    0x50, 0x80, 0x90, 0xC0, 0xE0, 0xFF,  // Sky blue
    0x40, 0x80, 0xA0, 0x40, 0x20, 0x00,  // Grass green
    0xFF, 0x00, 0x80, 0x00, 0x20, 0x00,  // Sunset orange
    // Row 4: edge cases
    0x01, 0x00, 0x01, 0x00, 0x01, 0x00,  // Near-black
    0xFE, 0x00, 0xFE, 0x00, 0xFE, 0x00,  // Near-white
    0x00, 0x00, 0xFF, 0xFF, 0xFF, 0xFF,  // Saturated cyan
    0xFF, 0xFF, 0x00, 0x00, 0xFF, 0xFF,  // Saturated magenta
]);

const im0Compressed = await deflate(im0Pixels);
const im0Dict = ctx.obj({
    Type: 'XObject',
    Subtype: 'Image',
    Width: 4,
    Height: 4,
    BitsPerComponent: 16,
    ColorSpace: cs0Ref,
    Filter: 'FlateDecode',
    Length: im0Compressed.length,
});
const im0Stream = PDFRawStream.of(im0Dict, im0Compressed);
const im0Ref = ctx.register(im0Stream);

// /Im1: DeviceGray, 8-bit, 4×4 pixels — grayscale ramp
const im1Pixels = new Uint8Array([
    0, 17, 34, 51, 68, 85, 102, 119, 136, 153, 170, 187, 204, 221, 238, 255,
]);
const im1Compressed = await deflate(im1Pixels);
const im1Dict = ctx.obj({
    Type: 'XObject',
    Subtype: 'Image',
    Width: 4,
    Height: 4,
    BitsPerComponent: 8,
    ColorSpace: 'DeviceGray',
    Filter: 'FlateDecode',
    Length: im1Compressed.length,
});
const im1Stream = PDFRawStream.of(im1Dict, im1Compressed);
const im1Ref = ctx.register(im1Stream);

// ── Page 1: ICCBased RGB + Lab + Device Colors + Graphics State ────

const page1Content = [
    // ICCBased RGB fill
    '/CS0 cs 0.8 0.2 0.1 scn',
    '50 700 100 50 re f',
    // ICCBased RGB stroke
    '/CS0 CS 0.1 0.3 0.9 SCN',
    '50 640 100 50 re S',
    // Graphics state push
    'q',
    // DeviceGray fill
    '0.5 g',
    '50 580 100 50 re f',
    // DeviceRGB fill
    '1 0 0 rg',
    '50 520 100 50 re f',
    // DeviceCMYK fill
    '0 0 0 1 k',
    '50 460 100 50 re f',
    // Graphics state pop — color space must revert to /CS0
    'Q',
    // ICCBased RGB after Q — tests state restoration
    '0.3 0.6 0.9 scn',
    '50 400 100 50 re f',
    // Parenthesized string — must not parse operators inside
    'BT /F1 12 Tf 50 380 Td (The rg color 0 1 0 rg is inside) Tj ET',
    // Nested parens
    'BT /F1 12 Tf 50 360 Td (Nested (0.8 G) parens) Tj ET',
    // Lab fill
    '/CS1 cs 50 -20 40 sc',
    '200 700 100 50 re f',
    // Lab stroke
    '/CS1 CS 90 0 0 SC',
    '200 640 100 50 re S',
    // ICCBasedGray fill
    '/CS2 cs 0.5 scn',
    '200 580 100 50 re f',
    // Draw images
    'q 100 0 0 100 350 600 cm /Im0 Do Q',
    'q 100 0 0 100 350 480 cm /Im1 Do Q',
    // Padding to ensure operators in carry zone (> 400 bytes total)
    '50 300 100 50 re S',
    '50 240 100 50 re S',
    '50 180 100 50 re S',
    '50 120 100 50 re S',
    '50 60 100 50 re S',
    '200 300 100 50 re S',
    '200 240 100 50 re S',
    '200 180 100 50 re S',
    '200 120 100 50 re S',
    '200 60 100 50 re S',
    // SCN near end — tests carry boundary (Bug 4: kn)
    '/CS0 CS 0.7 0.4 0.2 SCN',
    '350 300 100 50 re S',
].join('\n');

const page1Bytes = latin1(page1Content);
const page1Compressed = await deflate(page1Bytes);
const page1StreamDict = ctx.obj({ Filter: 'FlateDecode', Length: page1Compressed.length });
const page1Stream = PDFRawStream.of(page1StreamDict, page1Compressed);
const page1StreamRef = ctx.register(page1Stream);

// Page 1 resources
const page1Resources = ctx.obj({
    ColorSpace: ctx.obj({
        CS0: cs0Ref,
        CS1: cs1Ref,
        CS2: cs2Ref,
    }),
    XObject: ctx.obj({
        Im0: im0Ref,
        Im1: im1Ref,
    }),
});

const page1 = doc.addPage([612, 792]);
page1.node.set(PDFName.of('Contents'), page1StreamRef);
page1.node.set(PDFName.of('Resources'), page1Resources);

// ── Page 2: Multi-Stream Color Space Carryover ────────────────────

const page2Stream1Content = [
    '/CS0 cs 0.8 0.2 0.1 scn',
    '50 700 100 50 re f',
    '/CS0 CS 0.4 0.5 0.6 SCN',
    '50 640 100 50 re S',
].join('\n');

const page2Stream2Content = [
    // No cs/CS — must inherit from Stream 1
    '0.3 0.6 0.9 scn',
    '200 700 100 50 re f',
    '0.1 0.2 0.3 SCN',
    '200 640 100 50 re S',
    // State stack with carryover
    'q',
    '0.5 g',
    '200 580 100 50 re f',
    'Q',
    '0.9 0.1 0.1 scn',
    '200 520 100 50 re f',
].join('\n');

const page2Bytes1 = latin1(page2Stream1Content);
const page2Compressed1 = await deflate(page2Bytes1);
const page2StreamDict1 = ctx.obj({ Filter: 'FlateDecode', Length: page2Compressed1.length });
const page2StreamObj1 = PDFRawStream.of(page2StreamDict1, page2Compressed1);
const page2StreamRef1 = ctx.register(page2StreamObj1);

const page2Bytes2 = latin1(page2Stream2Content);
const page2Compressed2 = await deflate(page2Bytes2);
const page2StreamDict2 = ctx.obj({ Filter: 'FlateDecode', Length: page2Compressed2.length });
const page2StreamObj2 = PDFRawStream.of(page2StreamDict2, page2Compressed2);
const page2StreamRef2 = ctx.register(page2StreamObj2);

const page2ContentsArray = ctx.obj([page2StreamRef1, page2StreamRef2]);

const page2Resources = ctx.obj({
    ColorSpace: ctx.obj({
        CS0: cs0Ref,
        CS1: cs1Ref,
        CS2: cs2Ref,
    }),
});

const page2 = doc.addPage([612, 792]);
page2.node.set(PDFName.of('Contents'), page2ContentsArray);
page2.node.set(PDFName.of('Resources'), page2Resources);

// ── Page 3: Device Colors Only ────────────────────────────────────

const page3Content = [
    '0.5 g 50 50 100 100 re f',
    '0.75 G 50 50 100 100 re S',
    '1 0 0 rg 200 50 100 100 re f',
    '0 1 0 RG 200 50 100 100 re S',
    '0 0 0 1 k 350 50 100 100 re f',
    '0.2 0.3 0.4 0.5 K 350 50 100 100 re S',
].join('\n');

const page3Bytes = latin1(page3Content);
const page3Compressed = await deflate(page3Bytes);
const page3StreamDict = ctx.obj({ Filter: 'FlateDecode', Length: page3Compressed.length });
const page3Stream = PDFRawStream.of(page3StreamDict, page3Compressed);
const page3StreamRef = ctx.register(page3Stream);

const page3 = doc.addPage([612, 792]);
page3.node.set(PDFName.of('Contents'), page3StreamRef);
// No ColorSpace resources — Device colors only

// ── Save ────────────────────────────────────────────────────────

const pdfBytes = await doc.save({ addDefaultPage: false, updateFieldAppearances: false });
const outputPath = join(REFERENCES_DIR, 'color-conversion-matrix.pdf');
await writeFile(outputPath, pdfBytes);

console.log(`Generated: ${outputPath}`);
console.log(`  Pages: ${doc.getPages().length}`);
console.log(`  Size: ${pdfBytes.length} bytes`);

// Verify page count
const reloaded = await PDFDocument.load(pdfBytes);
const pageCount = reloaded.getPages().length;
if (pageCount !== 3) {
    console.error(`ERROR: Expected 3 pages, got ${pageCount}`);
    process.exit(1);
}
console.log(`  Verified: ${pageCount} pages`);
