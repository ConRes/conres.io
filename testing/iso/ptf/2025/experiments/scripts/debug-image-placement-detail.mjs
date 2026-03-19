#!/usr/bin/env node
// @ts-check
/**
 * Detailed analysis of image placement in content streams.
 *
 * For each image Do operator, extracts the full graphics state context:
 * - CTM (current transformation matrix) from cm operators
 * - Graphics state (gs operator and which ExtGState is active)
 * - Clipping paths (re/W/n sequence)
 * - q/Q nesting depth
 * - Preceding color operators
 * - Blending mode from ExtGState
 *
 * Usage:
 *   node testing/iso/ptf/2025/experiments/scripts/debug-image-placement-detail.mjs [path-to-pdf]
 *
 * @author Saleh Abdel Motaal <dev@smotaal.io>
 * @ai Claude Opus 4.6 (code generation)
 */

import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { inflate } from 'zlib';
import { promisify } from 'util';
import {
    PDFDocument,
    PDFDict,
    PDFName,
    PDFRef,
    PDFRawStream,
    PDFArray,
    PDFNumber,
    PDFBool,
} from 'pdf-lib';

const inflateAsync = promisify(inflate);

const DEFAULT_PDF = 'testing/iso/ptf/2025/tests/fixtures/pdfs/2025-08-15 - ConRes - ISO PTF - CR1 (F9d) Fixtures - F-01.pdf';

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const pdfPath = process.argv.filter(a => a !== '').slice(2)[0] || DEFAULT_PDF;
    await run(pdfPath);
}

async function run(pdfPath) {
    console.log(`Loading PDF: ${pdfPath}`);
    const pdfBytes = await readFile(pdfPath);
    const doc = await PDFDocument.load(pdfBytes, { updateMetadata: false });
    const ctx = doc.context;
    const pages = doc.getPages();

    for (let pi = 0; pi < pages.length; pi++) {
        const page = pages[pi];
        const pageDict = ctx.lookup(page.ref);
        if (!(pageDict instanceof PDFDict)) continue;

        console.log(`\n${'═'.repeat(78)}`);
        console.log(`  Page ${pi}`);
        console.log(`${'═'.repeat(78)}`);

        // ── Collect ExtGState details ────────────────────────────────────

        let rd = pageDict.get(PDFName.of('Resources'));
        if (rd instanceof PDFRef) rd = ctx.lookup(rd);
        if (!(rd instanceof PDFDict)) continue;

        /** @type {Map<string, Record<string, string>>} */
        const extGStates = new Map();

        let egd = rd.get(PDFName.of('ExtGState'));
        if (egd instanceof PDFRef) egd = ctx.lookup(egd);
        if (egd instanceof PDFDict) {
            for (const [nameObj, value] of egd.entries()) {
                const gsName = nameObj.asString();
                let gsDict = value;
                if (gsDict instanceof PDFRef) gsDict = ctx.lookup(gsDict);
                if (!(gsDict instanceof PDFDict)) continue;

                /** @type {Record<string, string>} */
                const props = {};
                for (const [k, v] of gsDict.entries()) {
                    props[k.asString()] = v.toString();
                }
                extGStates.set(gsName, props);
            }
        }

        console.log('\n  ExtGState definitions:');
        for (const [name, props] of extGStates) {
            const interesting = Object.entries(props)
                .filter(([k]) => ['/Type', '/BM', '/ca', '/CA', '/SMask', '/AIS', '/OPM', '/op', '/OP'].includes(k))
                .map(([k, v]) => `${k}=${v}`)
                .join('  ');
            console.log(`    ${name}: ${interesting || '(no interesting properties)'}`);
        }

        // ── Collect XObject image info ───────────────────────────────────

        let xd = rd.get(PDFName.of('XObject'));
        if (xd instanceof PDFRef) xd = ctx.lookup(xd);

        /** @type {Map<string, {ref: string, width: number, height: number, cs: string, bpc: number, length: number}>} */
        const imageInfo = new Map();

        if (xd instanceof PDFDict) {
            for (const [nameObj, value] of xd.entries()) {
                if (!(value instanceof PDFRef)) continue;
                const obj = ctx.lookup(value);
                if (!(obj instanceof PDFRawStream)) continue;
                const subtype = obj.dict.get(PDFName.of('Subtype'));
                if (!(subtype instanceof PDFName) || subtype.asString() !== '/Image') continue;

                const w = obj.dict.get(PDFName.of('Width'));
                const h = obj.dict.get(PDFName.of('Height'));
                const bpc = obj.dict.get(PDFName.of('BitsPerComponent'));
                const len = obj.dict.get(PDFName.of('Length'));

                imageInfo.set(nameObj.asString(), {
                    ref: value.toString(),
                    width: w instanceof PDFNumber ? w.asNumber() : 0,
                    height: h instanceof PDFNumber ? h.asNumber() : 0,
                    cs: describeCS(obj.dict.get(PDFName.of('ColorSpace')), ctx),
                    bpc: bpc instanceof PDFNumber ? bpc.asNumber() : 0,
                    length: len instanceof PDFNumber ? len.asNumber() : 0,
                });
            }
        }

        // ── Decode and concatenate content streams ───────────────────────

        const contentsVal = pageDict.get(PDFName.of('Contents'));
        const allText = await decodeContentStreams(contentsVal, ctx);

        // ── Parse content stream and track state at each Do ──────────────

        // Tokenize: find all operators with their operands
        // We track: q/Q depth, cm matrices, gs state, clip rects, color ops
        const lines = allText.split('\n');

        let qDepth = 0;
        /** @type {string[]} */
        const ctmStack = ['identity'];
        /** @type {string[]} */
        const gsStack = ['(none)'];
        /** @type {string[]} */
        const clipStack = ['(none)'];

        let currentCTM = 'identity';
        let currentGS = '(none)';
        let currentClip = '(none)';
        let pendingClip = '';
        let lastColorOp = '';
        let recentOps = [];

        // Simple line-by-line parsing
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;

            recentOps.push(trimmed);
            if (recentOps.length > 20) recentOps.shift();

            // q - save graphics state
            if (trimmed === 'q') {
                qDepth++;
                ctmStack.push(currentCTM);
                gsStack.push(currentGS);
                clipStack.push(currentClip);
                continue;
            }

            // Q - restore graphics state
            if (trimmed === 'Q') {
                qDepth--;
                currentCTM = ctmStack.pop() || 'identity';
                currentGS = gsStack.pop() || '(none)';
                currentClip = clipStack.pop() || '(none)';
                continue;
            }

            // cm - set CTM
            const cmMatch = trimmed.match(/^([\d.\-e+]+)\s+([\d.\-e+]+)\s+([\d.\-e+]+)\s+([\d.\-e+]+)\s+([\d.\-e+]+)\s+([\d.\-e+]+)\s+cm$/);
            if (cmMatch) {
                currentCTM = `[${cmMatch[1]} ${cmMatch[2]} ${cmMatch[3]} ${cmMatch[4]} ${cmMatch[5]} ${cmMatch[6]}]`;
                continue;
            }

            // gs - set graphics state
            const gsMatch = trimmed.match(/^\/([\w]+)\s+gs$/);
            if (gsMatch) {
                currentGS = '/' + gsMatch[1];
                continue;
            }

            // re + W + n - clip path
            const reMatch = trimmed.match(/^([\d.\-e+]+)\s+([\d.\-e+]+)\s+([\d.\-e+]+)\s+([\d.\-e+]+)\s+re$/);
            if (reMatch) {
                pendingClip = `rect(${reMatch[1]}, ${reMatch[2]}, ${reMatch[3]}, ${reMatch[4]})`;
                continue;
            }

            if (trimmed === 'W' || trimmed === 'W*') {
                currentClip = pendingClip || '(path clip)';
                continue;
            }

            // Color operators
            if (/\b(sc|scn|SC|SCN|g|G|rg|RG|k|K|cs|CS)\s*$/.test(trimmed)) {
                lastColorOp = trimmed;
            }

            // Do - paint XObject
            const doMatch = trimmed.match(/^\/([\w]+)\s+Do$/);
            if (doMatch) {
                const imgName = '/' + doMatch[1];
                const info = imageInfo.get(imgName);

                console.log(`\n  ┌─ ${imgName} Do`);
                console.log(`  │  q-depth: ${qDepth}`);
                console.log(`  │  CTM: ${currentCTM}`);
                console.log(`  │  GS: ${currentGS}`);

                // Show ExtGState details for active GS
                if (currentGS !== '(none)' && extGStates.has(currentGS)) {
                    const props = extGStates.get(currentGS);
                    const details = Object.entries(props)
                        .filter(([k]) => ['/BM', '/ca', '/CA', '/SMask', '/AIS', '/OPM', '/op', '/OP'].includes(k))
                        .map(([k, v]) => `${k}=${v}`)
                        .join('  ');
                    if (details) console.log(`  │  GS details: ${details}`);
                }

                console.log(`  │  Clip: ${currentClip}`);

                if (info) {
                    console.log(`  │  Image: ${info.ref}  ${info.width}×${info.height}  BPC=${info.bpc}  CS=${info.cs}  compressed=${(info.length / 1024).toFixed(0)}KB`);
                }

                // Show the last 8 operators before Do
                const contextOps = recentOps.slice(-9, -1);
                console.log(`  │  Preceding ops:`);
                for (const op of contextOps) {
                    console.log(`  │    ${op}`);
                }

                console.log(`  └─`);
            }
        }
    }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * @param {unknown} contentsValue
 * @param {import('pdf-lib').PDFContext} ctx
 * @returns {Promise<string>}
 */
async function decodeContentStreams(contentsValue, ctx) {
    const parts = [];

    if (contentsValue instanceof PDFRef) {
        contentsValue = ctx.lookup(contentsValue);
    }

    if (contentsValue instanceof PDFRawStream) {
        parts.push(await decodeStream(contentsValue));
    } else if (contentsValue instanceof PDFArray) {
        for (let i = 0; i < contentsValue.size(); i++) {
            let item = contentsValue.get(i);
            if (item instanceof PDFRef) item = ctx.lookup(item);
            if (item instanceof PDFRawStream) {
                parts.push(await decodeStream(item));
            }
        }
    }

    return parts.join('\n');
}

/**
 * @param {PDFRawStream} stream
 * @returns {Promise<string>}
 */
async function decodeStream(stream) {
    const filter = stream.dict.get(PDFName.of('Filter'));
    const raw = stream.contents;

    try {
        if (filter?.toString() === '/FlateDecode' || filter?.toString() === '[ /FlateDecode ]') {
            const decoded = await inflateAsync(Buffer.from(raw));
            return new TextDecoder('latin1').decode(decoded);
        }
    } catch {
        // Fall through
    }
    return new TextDecoder('latin1').decode(raw);
}

/**
 * @param {unknown} csValue
 * @param {import('pdf-lib').PDFContext} ctx
 * @returns {string}
 */
function describeCS(csValue, ctx) {
    if (csValue === undefined) return '(none)';
    if (csValue instanceof PDFRef) csValue = ctx.lookup(csValue);
    if (csValue instanceof PDFName) return csValue.asString();
    if (csValue instanceof PDFArray && csValue.size() > 0) {
        const first = csValue.get(0);
        if (first instanceof PDFName) {
            const t = first.asString();
            if (t === '/ICCBased' && csValue.size() > 1) {
                const pr = csValue.get(1);
                if (pr instanceof PDFRef) {
                    const ps = ctx.lookup(pr);
                    if (ps instanceof PDFRawStream) {
                        const n = ps.dict.get(PDFName.of('N'));
                        return `/ICCBased(N=${n instanceof PDFNumber ? n.asNumber() : '?'})`;
                    }
                }
            }
            return t;
        }
    }
    return '?';
}
