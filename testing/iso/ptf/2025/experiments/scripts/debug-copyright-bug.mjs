#!/usr/bin/env node
// @ts-check
/**
 * Debug Copyright Symbol Bug
 *
 * Extracts and compares raw content stream bytes from two PDFs
 * to identify encoding corruption around text strings (especially non-ASCII characters).
 *
 * Usage:
 *   node debug-copyright-bug.mjs <pdf-a> <pdf-b>
 *   node debug-copyright-bug.mjs <pdf-a> <pdf-b> --page=3
 *   node debug-copyright-bug.mjs <pdf-a> <pdf-b> --dump-streams
 *   node debug-copyright-bug.mjs <single-pdf> --find-non-ascii
 *
 * Flags:
 *   --page=N           Only inspect page N (1-indexed)
 *   --dump-streams     Dump raw bytes of differing streams to files
 *   --find-non-ascii   Scan for non-ASCII bytes in content streams (single PDF mode)
 *   --show-context=N   Show N bytes of context around differences (default: 40)
 *
 * @module debug-copyright-bug
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { argv, exit } from 'process';
import { fileURLToPath } from 'url';
import { dirname, basename, join } from 'path';
import { inflateSync } from 'zlib';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ============================================================================
// Argument Parsing
// ============================================================================

const args = argv.slice(2).filter(arg => arg !== '');
const pdfPaths = args.filter(a => a.endsWith('.pdf'));
const pageFlag = args.find(a => a.startsWith('--page='));
const pageNumber = pageFlag ? parseInt(pageFlag.split('=')[1], 10) : null;
const dumpStreams = args.includes('--dump-streams');
const findNonASCII = args.includes('--find-non-ascii');
const contextFlag = args.find(a => a.startsWith('--show-context='));
const contextSize = contextFlag ? parseInt(contextFlag.split('=')[1], 10) : 40;

if (pdfPaths.length === 0 || pdfPaths.length > 2) {
    console.log(`
Debug Copyright Symbol Bug

Usage:
  node debug-copyright-bug.mjs <pdf-a> <pdf-b>
  node debug-copyright-bug.mjs <pdf-a> <pdf-b> --page=3
  node debug-copyright-bug.mjs <single-pdf> --find-non-ascii

Flags:
  --page=N           Only inspect page N (1-indexed)
  --dump-streams     Dump raw bytes of differing streams to files
  --find-non-ascii   Scan for non-ASCII bytes in content streams
  --show-context=N   Show N bytes of context around differences (default: 40)
`);
    exit(1);
}

for (const path of pdfPaths) {
    if (!existsSync(path)) {
        console.error(`Error: PDF not found: ${path}`);
        exit(1);
    }
}

// ============================================================================
// PDF Parsing Helpers (lightweight, no pdf-lib dependency)
// ============================================================================

/**
 * Extracts content stream raw bytes from a PDF using pdf-lib.
 *
 * @param {string} pdfPath
 * @param {number | null} targetPage - 1-indexed page number, or null for all pages
 * @returns {Promise<Array<{pageIndex: number, streamIndex: number, rawBytes: Uint8Array, streamRef: string}>>}
 */
async function extractContentStreamBytes(pdfPath, targetPage) {
    const { PDFDocument, PDFName, PDFArray, PDFRef, PDFRawStream, PDFDict, decodePDFRawStream } = await import('pdf-lib');

    const pdfBytes = await readFile(pdfPath);
    const pdfDocument = await PDFDocument.load(pdfBytes, { updateMetadata: false });
    const pages = pdfDocument.getPages();
    const context = pdfDocument.context;

    /** @type {Array<{pageIndex: number, streamIndex: number, rawBytes: Uint8Array, streamRef: string}>} */
    const results = [];

    for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
        if (targetPage !== null && pageIndex !== targetPage - 1) continue;

        const page = pages[pageIndex];
        const pageDict = context.lookup(page.ref);
        if (!(pageDict instanceof PDFDict)) continue;

        const contents = pageDict.get(PDFName.of('Contents'));
        if (!contents) continue;

        const contentRefs = contents instanceof PDFArray
            ? contents.asArray()
            : [contents];

        let streamIndex = 0;
        for (const contentRef of contentRefs) {
            if (!(contentRef instanceof PDFRef)) continue;

            const stream = context.lookup(contentRef);
            if (!(stream instanceof PDFRawStream)) continue;

            // Decompress the stream to get raw bytes
            const rawBytes = /** @type {Uint8Array} */ (decodePDFRawStream(stream).decode());

            results.push({
                pageIndex,
                streamIndex,
                rawBytes,
                streamRef: contentRef.toString(),
            });

            streamIndex++;
        }
    }

    return results;
}

/**
 * Finds non-ASCII bytes in a Uint8Array and reports their positions with context.
 *
 * @param {Uint8Array} bytes
 * @param {number} contextBytes
 * @returns {Array<{offset: number, byte: number, hexByte: string, context: string, textContext: string}>}
 */
function findNonASCIIBytes(bytes, contextBytes = 40) {
    /** @type {Array<{offset: number, byte: number, hexByte: string, context: string, textContext: string}>} */
    const results = [];

    for (let i = 0; i < bytes.length; i++) {
        if (bytes[i] > 127) {
            const start = Math.max(0, i - contextBytes);
            const end = Math.min(bytes.length, i + contextBytes + 1);
            const contextSlice = bytes.slice(start, end);

            // Hex context with the non-ASCII byte highlighted
            const hexParts = [];
            for (let j = start; j < end; j++) {
                const hex = bytes[j].toString(16).padStart(2, '0');
                if (j === i) {
                    hexParts.push(`[${hex}]`);
                } else {
                    hexParts.push(hex);
                }
            }

            // Text context (replace non-printable with dots)
            const textParts = [];
            for (let j = start; j < end; j++) {
                const b = bytes[j];
                if (b >= 32 && b <= 126) {
                    textParts.push(String.fromCharCode(b));
                } else if (j === i) {
                    textParts.push(`[0x${bytes[j].toString(16).padStart(2, '0')}]`);
                } else {
                    textParts.push('.');
                }
            }

            results.push({
                offset: i,
                byte: bytes[i],
                hexByte: bytes[i].toString(16).padStart(2, '0'),
                context: hexParts.join(' '),
                textContext: textParts.join(''),
            });
        }
    }

    return results;
}

/**
 * Compares two byte arrays and returns differences with context.
 *
 * @param {Uint8Array} bytesA
 * @param {Uint8Array} bytesB
 * @param {number} contextBytes
 * @returns {Array<{offsetA: number, offsetB: number, byteA: number, byteB: number, contextA: string, contextB: string, textContextA: string, textContextB: string}>}
 */
function compareBytes(bytesA, bytesB, contextBytes = 40) {
    /** @type {Array<{offsetA: number, offsetB: number, byteA: number, byteB: number, contextA: string, contextB: string, textContextA: string, textContextB: string}>} */
    const diffs = [];

    // Use a simple diff approach: walk both arrays, finding mismatches
    let iA = 0;
    let iB = 0;
    const maxLen = Math.max(bytesA.length, bytesB.length);

    while (iA < bytesA.length && iB < bytesB.length) {
        if (bytesA[iA] !== bytesB[iB]) {
            // Found a difference - capture context
            const startA = Math.max(0, iA - contextBytes);
            const endA = Math.min(bytesA.length, iA + contextBytes + 1);
            const startB = Math.max(0, iB - contextBytes);
            const endB = Math.min(bytesB.length, iB + contextBytes + 1);

            const textContextA = makeTextContext(bytesA, startA, endA, iA);
            const textContextB = makeTextContext(bytesB, startB, endB, iB);

            diffs.push({
                offsetA: iA,
                offsetB: iB,
                byteA: bytesA[iA],
                byteB: bytesB[iB],
                contextA: makeHexContext(bytesA, startA, endA, iA),
                contextB: makeHexContext(bytesB, startB, endB, iB),
                textContextA,
                textContextB,
            });

            // Limit to first 20 diffs to keep output manageable
            if (diffs.length >= 20) break;
        }
        iA++;
        iB++;
    }

    return diffs;
}

/**
 * @param {Uint8Array} bytes
 * @param {number} start
 * @param {number} end
 * @param {number} highlight
 * @returns {string}
 */
function makeHexContext(bytes, start, end, highlight) {
    const parts = [];
    for (let j = start; j < end; j++) {
        const hex = bytes[j].toString(16).padStart(2, '0');
        if (j === highlight) {
            parts.push(`[${hex}]`);
        } else {
            parts.push(hex);
        }
    }
    return parts.join(' ');
}

/**
 * @param {Uint8Array} bytes
 * @param {number} start
 * @param {number} end
 * @param {number} highlight
 * @returns {string}
 */
function makeTextContext(bytes, start, end, highlight) {
    const parts = [];
    for (let j = start; j < end; j++) {
        const b = bytes[j];
        if (b >= 32 && b <= 126) {
            if (j === highlight) {
                parts.push(`[${String.fromCharCode(b)}]`);
            } else {
                parts.push(String.fromCharCode(b));
            }
        } else if (j === highlight) {
            parts.push(`[0x${bytes[j].toString(16).padStart(2, '0')}]`);
        } else {
            parts.push('.');
        }
    }
    return parts.join('');
}

/**
 * Checks if a byte sequence looks like it's near a PDF string literal containing non-ASCII.
 *
 * @param {Uint8Array} bytes
 * @param {number} offset
 * @returns {{ inString: boolean, stringStart: number, stringEnd: number, stringContent: string } | null}
 */
function findSurroundingString(bytes, offset) {
    // Look backward for '('
    let stringStart = -1;
    for (let i = offset; i >= Math.max(0, offset - 200); i--) {
        if (bytes[i] === 0x28 /* ( */) {
            // Check it's not escaped
            let backslashCount = 0;
            for (let j = i - 1; j >= 0 && bytes[j] === 0x5C; j--) {
                backslashCount++;
            }
            if (backslashCount % 2 === 0) {
                stringStart = i;
                break;
            }
        }
    }

    if (stringStart === -1) return null;

    // Look forward for ')'
    let stringEnd = -1;
    let depth = 0;
    for (let i = stringStart + 1; i < Math.min(bytes.length, stringStart + 500); i++) {
        if (bytes[i] === 0x28 /* ( */) {
            let backslashCount = 0;
            for (let j = i - 1; j >= 0 && bytes[j] === 0x5C; j--) {
                backslashCount++;
            }
            if (backslashCount % 2 === 0) depth++;
        } else if (bytes[i] === 0x29 /* ) */) {
            let backslashCount = 0;
            for (let j = i - 1; j >= 0 && bytes[j] === 0x5C; j--) {
                backslashCount++;
            }
            if (backslashCount % 2 === 0) {
                if (depth === 0) {
                    stringEnd = i;
                    break;
                }
                depth--;
            }
        }
    }

    if (stringEnd === -1) return null;

    const stringBytes = bytes.slice(stringStart, stringEnd + 1);
    // Convert to display string, showing non-ASCII as hex escapes
    const parts = [];
    for (const b of stringBytes) {
        if (b >= 32 && b <= 126) {
            parts.push(String.fromCharCode(b));
        } else {
            parts.push(`\\x${b.toString(16).padStart(2, '0')}`);
        }
    }

    return {
        inString: true,
        stringStart,
        stringEnd,
        stringContent: parts.join(''),
    };
}

// ============================================================================
// Main
// ============================================================================

async function main() {
    if (findNonASCII && pdfPaths.length === 1) {
        // Single PDF mode: find all non-ASCII bytes in content streams
        console.log(`Scanning for non-ASCII bytes in content streams: ${basename(pdfPaths[0])}\n`);

        const streams = await extractContentStreamBytes(pdfPaths[0], pageNumber);
        console.log(`Found ${streams.length} content stream(s)\n`);

        for (const { pageIndex, streamIndex, rawBytes, streamRef } of streams) {
            const nonASCII = findNonASCIIBytes(rawBytes, contextSize);
            if (nonASCII.length === 0) continue;

            console.log(`Page ${pageIndex + 1}, Stream ${streamIndex} (${streamRef}): ${rawBytes.length} bytes`);
            console.log(`  Found ${nonASCII.length} non-ASCII byte(s):`);

            for (const { offset, byte, hexByte, textContext } of nonASCII) {
                const surrounding = findSurroundingString(rawBytes, offset);
                console.log(`  Offset ${offset}: 0x${hexByte} (${byte})`);
                console.log(`    Text:   ${textContext}`);
                if (surrounding) {
                    console.log(`    String: ${surrounding.stringContent}`);
                }
            }
            console.log('');
        }
        return;
    }

    if (pdfPaths.length === 1 && !findNonASCII) {
        // Single PDF mode without --find-non-ascii: show usage
        console.log('For single PDF mode, use --find-non-ascii flag');
        exit(1);
    }

    // Two PDF comparison mode
    const labelA = basename(pdfPaths[0]);
    const labelB = basename(pdfPaths[1]);
    console.log(`Comparing content streams:`);
    console.log(`  A: ${labelA}`);
    console.log(`  B: ${labelB}`);
    if (pageNumber) console.log(`  Page: ${pageNumber}`);
    console.log('');

    const [streamsA, streamsB] = await Promise.all([
        extractContentStreamBytes(pdfPaths[0], pageNumber),
        extractContentStreamBytes(pdfPaths[1], pageNumber),
    ]);

    console.log(`A: ${streamsA.length} content stream(s)`);
    console.log(`B: ${streamsB.length} content stream(s)`);
    console.log('');

    // Match streams by page and stream index
    const maxStreams = Math.max(streamsA.length, streamsB.length);
    let totalDiffs = 0;

    for (let i = 0; i < maxStreams; i++) {
        const streamA = streamsA[i];
        const streamB = streamsB[i];

        if (!streamA || !streamB) {
            console.log(`Stream ${i}: MISSING in ${!streamA ? 'A' : 'B'}`);
            totalDiffs++;
            continue;
        }

        if (streamA.pageIndex !== streamB.pageIndex || streamA.streamIndex !== streamB.streamIndex) {
            console.log(`Stream ${i}: Page/stream index mismatch: A=page${streamA.pageIndex + 1}/stream${streamA.streamIndex} B=page${streamB.pageIndex + 1}/stream${streamB.streamIndex}`);
            totalDiffs++;
            continue;
        }

        const pageLabel = `Page ${streamA.pageIndex + 1}, Stream ${streamA.streamIndex}`;

        if (streamA.rawBytes.length === streamB.rawBytes.length) {
            // Same length - check if bytes are identical
            let identical = true;
            for (let j = 0; j < streamA.rawBytes.length; j++) {
                if (streamA.rawBytes[j] !== streamB.rawBytes[j]) {
                    identical = false;
                    break;
                }
            }

            if (identical) {
                console.log(`${pageLabel}: IDENTICAL (${streamA.rawBytes.length} bytes)`);
                continue;
            }
        }

        // Streams differ
        totalDiffs++;
        console.log(`${pageLabel}: DIFFERENT`);
        console.log(`  A: ${streamA.rawBytes.length} bytes (${streamA.streamRef})`);
        console.log(`  B: ${streamB.rawBytes.length} bytes (${streamB.streamRef})`);
        console.log(`  Size difference: ${streamB.rawBytes.length - streamA.rawBytes.length} bytes`);

        // Check for non-ASCII bytes in both
        const nonASCII_A = findNonASCIIBytes(streamA.rawBytes, 0);
        const nonASCII_B = findNonASCIIBytes(streamB.rawBytes, 0);
        console.log(`  Non-ASCII bytes: A=${nonASCII_A.length}, B=${nonASCII_B.length}`);

        // Show byte-level diffs
        const diffs = compareBytes(streamA.rawBytes, streamB.rawBytes, contextSize);
        if (diffs.length > 0) {
            console.log(`  First ${Math.min(diffs.length, 20)} byte difference(s):`);
            for (const diff of diffs) {
                console.log(`    Offset A:${diff.offsetA} B:${diff.offsetB}`);
                console.log(`      A byte: 0x${diff.byteA.toString(16).padStart(2, '0')} (${diff.byteA})`);
                console.log(`      B byte: 0x${diff.byteB.toString(16).padStart(2, '0')} (${diff.byteB})`);
                console.log(`      A text: ${diff.textContextA}`);
                console.log(`      B text: ${diff.textContextB}`);

                // Check if diff is near a string literal
                const surroundingA = findSurroundingString(streamA.rawBytes, diff.offsetA);
                const surroundingB = findSurroundingString(streamB.rawBytes, diff.offsetB);
                if (surroundingA) console.log(`      A string: ${surroundingA.stringContent}`);
                if (surroundingB) console.log(`      B string: ${surroundingB.stringContent}`);
            }
        }

        // Dump streams if requested
        if (dumpStreams) {
            const outputDir = join(__dirname, '..', 'output', 'debug-copyright-bug');
            if (!existsSync(outputDir)) await mkdir(outputDir, { recursive: true });

            const prefix = `page${streamA.pageIndex + 1}_stream${streamA.streamIndex}`;
            await writeFile(join(outputDir, `${prefix}_A.bin`), streamA.rawBytes);
            await writeFile(join(outputDir, `${prefix}_B.bin`), streamB.rawBytes);
            // Also dump as text for easy viewing
            await writeFile(join(outputDir, `${prefix}_A.txt`), streamA.rawBytes);
            await writeFile(join(outputDir, `${prefix}_B.txt`), streamB.rawBytes);
            console.log(`  Dumped to: ${outputDir}/${prefix}_*.{bin,txt}`);
        }

        console.log('');
    }

    console.log(`\nSummary: ${totalDiffs} stream(s) with differences out of ${maxStreams} total`);
}

main().catch(err => {
    console.error('Error:', err);
    exit(1);
});
