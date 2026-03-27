#!/usr/bin/env node
// @ts-check
/**
 * Comprehensive PDF image masking analysis.
 *
 * For every image painted via Do, identifies ALL masking mechanisms:
 *   1. Image dictionary masks: /SMask, /Mask, /ImageMask, /SMaskInData
 *   2. Graphics state masks: ExtGState /SMask active via gs operator
 *   3. Vector clipping path masks: path + W/W* + n before Do
 *   4. Text clipping path masks: Tr mode >= 4 within BT...ET
 *   5. Rectangular clips: re + W/W* + n
 *
 * Tracks full q/Q graphics state stack with CTM, accumulated clips, and GS.
 *
 * Usage:
 *   node testing/iso/ptf/2025/experiments/scripts/analyze-image-masking.mjs [path-to-pdf]
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
} from '../../packages/pdf-lib/pdf-lib.esm.js';

const inflateAsync = promisify(inflate);

const DEFAULT_PDF = 'testing/iso/ptf/2025/tests/fixtures/pdfs/2025-08-15 - ConRes - ISO PTF - CR1 (F9d) Fixtures - F-01.pdf';

// ── Graphics state frame ─────────────────────────────────────────────────────

/**
 * @typedef {{
 *   type: 'vector' | 'rect' | 'text',
 *   description: string,
 *   excerpt: string,
 *   pathSegments?: number,
 *   subpaths?: number,
 * }} ClipEntry
 */

class GStateFrame {
    ctm = 'identity';
    gsName = '(none)';
    /** @type {ClipEntry[]} */
    clips = [];
    textRenderMode = 0;

    clone() {
        const copy = new GStateFrame();
        copy.ctm = this.ctm;
        copy.gsName = this.gsName;
        copy.clips = [...this.clips];
        copy.textRenderMode = this.textRenderMode;
        return copy;
    }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function run(pdfPath) {
    console.log(`Loading PDF: ${pdfPath}`);
    const pdfBytes = await readFile(pdfPath);
    const doc = await PDFDocument.load(pdfBytes, { updateMetadata: false });
    const ctx = doc.context;
    const pages = doc.getPages();

    console.log(`PDF has ${pages.length} page(s)\n`);

    /** @type {Map<number, object[]>} page index → image masking results */
    const allResults = new Map();

    for (let pi = 0; pi < pages.length; pi++) {
        const page = pages[pi];
        const pageDict = ctx.lookup(page.ref);
        if (!(pageDict instanceof PDFDict)) continue;

        console.log(`${'═'.repeat(78)}`);
        console.log(`  Page ${pi}`);
        console.log(`${'═'.repeat(78)}`);

        const rd = resolveDict(pageDict.get(PDFName.of('Resources')), ctx);
        if (!rd) { console.log('  (no Resources)\n'); continue; }

        // ── 1. Collect ExtGState definitions ─────────────────────────────

        /** @type {Map<string, {smask: string, bm: string, ca: string, CA: string, props: Record<string,string>}>} */
        const extGStates = new Map();
        const egd = resolveDict(rd.get(PDFName.of('ExtGState')), ctx);
        if (egd) {
            for (const [nameObj, value] of egd.entries()) {
                const gsDict = resolveDict(value, ctx);
                if (!gsDict) continue;
                /** @type {Record<string, string>} */
                const props = {};
                for (const [k, v] of gsDict.entries()) props[k.asString()] = v.toString();
                extGStates.set(nameObj.asString(), {
                    smask: props['/SMask'] || '(absent)',
                    bm: props['/BM'] || '(absent)',
                    ca: props['/ca'] || '(absent)',
                    CA: props['/CA'] || '(absent)',
                    props,
                });
            }
        }

        // ── 2. Collect image XObject info with mask properties ───────────

        const xd = resolveDict(rd.get(PDFName.of('XObject')), ctx);

        /** @type {Map<string, object>} image name → info */
        const imageInfo = new Map();
        /** @type {Map<string, string>} ref string → image name */
        const refToName = new Map();

        if (xd) {
            for (const [nameObj, value] of xd.entries()) {
                if (!(value instanceof PDFRef)) continue;
                const obj = ctx.lookup(value);
                if (!(obj instanceof PDFRawStream)) continue;
                const subtype = obj.dict.get(PDFName.of('Subtype'));
                if (!(subtype instanceof PDFName) || subtype.asString() !== '/Image') continue;

                const name = nameObj.asString();
                refToName.set(value.toString(), name);

                const w = getNumber(obj.dict, 'Width');
                const h = getNumber(obj.dict, 'Height');
                const bpc = getNumber(obj.dict, 'BitsPerComponent');
                const cs = describeCS(obj.dict.get(PDFName.of('ColorSpace')), ctx);
                const len = getNumber(obj.dict, 'Length');

                // Mask-related dictionary entries
                const dictMasks = [];

                const smaskVal = obj.dict.get(PDFName.of('SMask'));
                if (smaskVal instanceof PDFRef) {
                    const smaskObj = ctx.lookup(smaskVal);
                    let smaskDesc = smaskVal.toString();
                    if (smaskObj instanceof PDFRawStream) {
                        const sw = getNumber(smaskObj.dict, 'Width');
                        const sh = getNumber(smaskObj.dict, 'Height');
                        const scs = describeCS(smaskObj.dict.get(PDFName.of('ColorSpace')), ctx);
                        smaskDesc = `${smaskVal} (${sw}x${sh} ${scs})`;
                    }
                    dictMasks.push({ type: 'SMask', description: `Soft mask: ${smaskDesc}` });
                }

                const maskVal = obj.dict.get(PDFName.of('Mask'));
                if (maskVal instanceof PDFRef) {
                    dictMasks.push({ type: 'Mask-stencil', description: `Explicit mask: ${maskVal}` });
                } else if (maskVal instanceof PDFArray) {
                    const vals = [];
                    for (let i = 0; i < maskVal.size(); i++) {
                        const item = maskVal.get(i);
                        vals.push(item instanceof PDFNumber ? item.asNumber() : item.toString());
                    }
                    dictMasks.push({ type: 'Mask-colorkey', description: `Colour key mask: [${vals.join(', ')}]` });
                }

                const imageMaskVal = obj.dict.get(PDFName.of('ImageMask'));
                const isImageMask = imageMaskVal instanceof PDFBool && imageMaskVal.asBoolean();
                if (isImageMask) {
                    dictMasks.push({ type: 'ImageMask', description: 'This image IS a stencil mask' });
                }

                const smaskInData = getNumber(obj.dict, 'SMaskInData');
                if (typeof smaskInData === 'number' && smaskInData > 0) {
                    dictMasks.push({ type: 'SMaskInData', description: `Embedded alpha channel (mode ${smaskInData})` });
                }

                const intentVal = obj.dict.get(PDFName.of('Intent'));
                const intent = intentVal instanceof PDFName ? intentVal.asString() : null;

                imageInfo.set(name, {
                    ref: value.toString(),
                    width: w, height: h, bpc, cs,
                    compressedKB: typeof len === 'number' ? Math.round(len / 1024) : '?',
                    dictMasks,
                    intent,
                });
            }
        }

        // ── 3. Decode content streams ────────────────────────────────────

        const contentsVal = pageDict.get(PDFName.of('Contents'));
        const allText = await decodeContentStreams(contentsVal, ctx);

        // ── 4. Parse content stream with full state tracking ─────────────

        const results = parseContentStream(allText, imageInfo, extGStates);

        // Annotate results with GS mask status (needed by summary section
        // where per-page extGStates is not in scope)
        for (const r of results) {
            const gs = r.gsName !== '(none)' ? extGStates.get(r.gsName) : null;
            r.hasGSMask = !!(gs && gs.smask !== '/None' && gs.smask !== '(absent)');
        }

        allResults.set(pi, results);

        // ── 5. Output results ────────────────────────────────────────────

        if (results.length === 0) {
            console.log('  (no images painted)\n');
            continue;
        }

        for (const r of results) {
            const info = r.info;
            console.log(`\n  ┌─ ${r.imageName} Do [${info.ref}]  ${info.width}x${info.height}  BPC=${info.bpc}  CS=${info.cs}  ~${info.compressedKB}KB`);

            // Dictionary masks
            if (info.dictMasks.length > 0) {
                for (const dm of info.dictMasks) {
                    console.log(`  │  DICT MASK: ${dm.description}`);
                }
            }
            if (info.intent) {
                console.log(`  │  /Intent = ${info.intent}`);
            }

            // Graphics state mask
            const gs = r.gsName !== '(none)' ? extGStates.get(r.gsName) : null;
            if (gs && gs.smask !== '/None' && gs.smask !== '(absent)') {
                console.log(`  │  GS MASK: ${r.gsName} has /SMask = ${gs.smask}`);
            }

            // Content stream clips
            if (r.clips.length > 0) {
                for (const clip of r.clips) {
                    const label = clip.type === 'vector' ? 'VECTOR CLIP'
                        : clip.type === 'rect' ? 'RECT CLIP'
                        : clip.type === 'text' ? 'TEXT CLIP'
                        : 'CLIP';
                    console.log(`  │  ${label}: ${clip.description}`);
                    if (clip.excerpt) {
                        console.log(`  │    excerpt: ${clip.excerpt}`);
                    }
                }
            }

            // No masks at all
            if (info.dictMasks.length === 0 && r.clips.length === 0 &&
                !(gs && gs.smask !== '/None' && gs.smask !== '(absent)')) {
                console.log(`  │  (no masks)`);
            }

            // State context
            console.log(`  │  q-depth: ${r.qDepth}  CTM: ${r.ctm}  GS: ${r.gsName}`);
            console.log(`  └─`);
        }

        console.log('');
    }

    // ── Summary ──────────────────────────────────────────────────────────

    console.log(`\n${'═'.repeat(78)}`);
    console.log(`  Summary: All Masking Relationships`);
    console.log(`${'═'.repeat(78)}`);

    for (const [pi, results] of allResults) {
        const masked = results.filter(r =>
            r.info.dictMasks.length > 0 ||
            r.clips.length > 0 ||
            r.hasGSMask
        );
        const unmasked = results.filter(r => !masked.includes(r));

        if (masked.length === 0 && unmasked.length > 0) {
            console.log(`  Page ${pi}: ${unmasked.length} images, none masked`);
        } else {
            console.log(`  Page ${pi}: ${results.length} images — ${masked.length} masked, ${unmasked.length} unmasked`);
            for (const r of masked) {
                const maskTypes = [];
                for (const dm of r.info.dictMasks) maskTypes.push(dm.type);
                for (const clip of r.clips) maskTypes.push(clip.type + '-clip');
                console.log(`    ${r.imageName}: ${maskTypes.join(', ')}`);
            }
        }
    }

    console.log('');
}

// ── Content stream parser ────────────────────────────────────────────────────

/**
 * Parse content stream text, tracking graphics state and identifying all
 * masking relationships for each image Do operator.
 *
 * @param {string} text
 * @param {Map<string, object>} imageInfo
 * @param {Map<string, object>} extGStates
 * @returns {object[]}
 */
function parseContentStream(text, imageInfo, extGStates) {
    const lines = text.split('\n');

    /** @type {GStateFrame[]} */
    const stateStack = [];
    let current = new GStateFrame();

    // Path accumulation state (reset on painting operators)
    let pathSegments = 0;
    let pathSubpaths = 0;   // count of m operators (start of subpath)
    let pathHasCurves = false;
    let pathHasRect = false;
    /** @type {string|null} */
    let pathRectDesc = null;
    /** @type {string[]} */
    let pathExcerpt = [];

    let pendingW = false;    // W/W* seen, waiting for painting operator

    // Text object state
    let inTextObject = false;
    /** @type {string[]} */
    let textClipStrings = [];
    let textClipFont = '';
    let textClipFontSize = '';

    /** @type {object[]} */
    const results = [];

    for (const rawLine of lines) {
        const trimmed = rawLine.trim();
        if (!trimmed) continue;

        // ── q — push graphics state ─────────────────────────────────
        if (trimmed === 'q') {
            stateStack.push(current.clone());
            continue;
        }

        // ── Q — pop graphics state ──────────────────────────────────
        if (trimmed === 'Q') {
            current = stateStack.pop() || new GStateFrame();
            // Reset path state on Q (path doesn't survive state restore)
            pathSegments = 0; pathSubpaths = 0; pathHasCurves = false;
            pathHasRect = false; pathRectDesc = null; pathExcerpt = [];
            pendingW = false;
            continue;
        }

        // ── cm — CTM ────────────────────────────────────────────────
        const cmMatch = trimmed.match(
            /^([\d.\-e+]+)\s+([\d.\-e+]+)\s+([\d.\-e+]+)\s+([\d.\-e+]+)\s+([\d.\-e+]+)\s+([\d.\-e+]+)\s+cm$/
        );
        if (cmMatch) {
            current.ctm = `[${cmMatch.slice(1).join(' ')}]`;
            continue;
        }

        // ── gs — set ExtGState ──────────────────────────────────────
        const gsMatch = trimmed.match(/^\/([\w]+)\s+gs$/);
        if (gsMatch) {
            current.gsName = '/' + gsMatch[1];
            continue;
        }

        // ── Path construction: m (moveto — start new subpath) ───────
        if (/^[\d.\-e+]+\s+[\d.\-e+]+\s+m$/.test(trimmed)) {
            pathSegments++;
            pathSubpaths++;
            if (pathExcerpt.length < 4) pathExcerpt.push(trimmed);
            continue;
        }

        // ── Path construction: l (lineto) ───────────────────────────
        if (/^[\d.\-e+]+\s+[\d.\-e+]+\s+l$/.test(trimmed)) {
            pathSegments++;
            if (pathExcerpt.length < 4) pathExcerpt.push(trimmed);
            continue;
        }

        // ── Path construction: c (cubic Bezier curveto) ─────────────
        if (/^[\d.\-e+]+\s+[\d.\-e+]+\s+[\d.\-e+]+\s+[\d.\-e+]+\s+[\d.\-e+]+\s+[\d.\-e+]+\s+c$/.test(trimmed)) {
            pathSegments++;
            pathHasCurves = true;
            if (pathExcerpt.length < 4) pathExcerpt.push(trimmed);
            continue;
        }

        // ── Path construction: v, y (other Bezier variants) ─────────
        if (/^[\d.\-e+]+\s+[\d.\-e+]+\s+[\d.\-e+]+\s+[\d.\-e+]+\s+[vy]$/.test(trimmed)) {
            pathSegments++;
            pathHasCurves = true;
            if (pathExcerpt.length < 4) pathExcerpt.push(trimmed);
            continue;
        }

        // ── Path construction: h (close subpath) ────────────────────
        if (trimmed === 'h') {
            // Does not add a new segment, just closes the current subpath
            if (pathExcerpt.length < 4) pathExcerpt.push('h');
            continue;
        }

        // ── Path construction: re (rectangle) ───────────────────────
        const reMatch = trimmed.match(
            /^([\d.\-e+]+)\s+([\d.\-e+]+)\s+([\d.\-e+]+)\s+([\d.\-e+]+)\s+re$/
        );
        if (reMatch) {
            pathSegments++;
            pathSubpaths++;
            pathHasRect = true;
            pathRectDesc = `(${reMatch[1]}, ${reMatch[2]}, ${reMatch[3]}, ${reMatch[4]})`;
            if (pathExcerpt.length < 4) pathExcerpt.push(trimmed);
            continue;
        }

        // ── W / W* — clipping path operator ─────────────────────────
        if (trimmed === 'W' || trimmed === 'W*') {
            pendingW = true;
            continue;
        }

        // ── Painting operators (finalize pending clip) ──────────────
        if (/^[nSsfFBb]$/.test(trimmed) || trimmed === 'f*' || trimmed === 'B*' || trimmed === 'b*') {
            if (pendingW && pathSegments > 0) {
                /** @type {ClipEntry} */
                let clip;
                if (pathSegments === 1 && pathHasRect && !pathHasCurves) {
                    clip = {
                        type: 'rect',
                        description: `Rectangle ${pathRectDesc}`,
                        excerpt: pathExcerpt.join(' '),
                        pathSegments,
                        subpaths: pathSubpaths,
                    };
                } else if (pathHasCurves) {
                    const subpathNote = pathSubpaths > 3
                        ? ` (${pathSubpaths} subpaths — possible text outlines)`
                        : '';
                    clip = {
                        type: 'vector',
                        description: `Bezier path, ${pathSegments} segments${subpathNote}`,
                        excerpt: pathExcerpt.join(' / '),
                        pathSegments,
                        subpaths: pathSubpaths,
                    };
                } else {
                    clip = {
                        type: 'vector',
                        description: `Linear path, ${pathSegments} segments`,
                        excerpt: pathExcerpt.join(' / '),
                        pathSegments,
                        subpaths: pathSubpaths,
                    };
                }
                current.clips = [...current.clips, clip];
            }
            pendingW = false;
            // Reset path accumulation
            pathSegments = 0; pathSubpaths = 0; pathHasCurves = false;
            pathHasRect = false; pathRectDesc = null; pathExcerpt = [];
            continue;
        }

        // ── BT — begin text object ──────────────────────────────────
        if (trimmed === 'BT') {
            inTextObject = true;
            textClipStrings = [];
            continue;
        }

        // ── ET — end text object ────────────────────────────────────
        if (trimmed === 'ET') {
            if (inTextObject && current.textRenderMode >= 4 && textClipStrings.length > 0) {
                const modeNames = {
                    4: 'Fill + clip',
                    5: 'Stroke + clip',
                    6: 'Fill+stroke + clip',
                    7: 'Clip only (invisible)',
                };
                const modeName = modeNames[current.textRenderMode] || `mode ${current.textRenderMode}`;
                const textPreview = textClipStrings.join(' ');
                const truncated = textPreview.length > 60 ? textPreview.slice(0, 60) + '...' : textPreview;
                current.clips = [...current.clips, {
                    type: 'text',
                    description: `Text clip (Tr ${current.textRenderMode}: ${modeName}), font ${textClipFont} ${textClipFontSize}: "${truncated}"`,
                    excerpt: `${current.textRenderMode} Tr ... (${truncated}) Tj`,
                    pathSegments: 0,
                    subpaths: 0,
                }];
            }
            inTextObject = false;
            continue;
        }

        // ── Tr — text rendering mode ────────────────────────────────
        const trMatch = trimmed.match(/^(\d+)\s+Tr$/);
        if (trMatch) {
            current.textRenderMode = parseInt(trMatch[1]);
            continue;
        }

        // ── Tf — set font ───────────────────────────────────────────
        const tfMatch = trimmed.match(/^\/([\w]+)\s+([\d.\-]+)\s+Tf$/);
        if (tfMatch) {
            textClipFont = '/' + tfMatch[1];
            textClipFontSize = tfMatch[2];
            continue;
        }

        // ── Tj — show text string ───────────────────────────────────
        const tjMatch = trimmed.match(/\(([^)]*)\)\s*Tj$/);
        if (tjMatch && inTextObject) {
            textClipStrings.push(tjMatch[1]);
            continue;
        }

        // ── TJ — show text with positioning ─────────────────────────
        if (inTextObject && /TJ\s*$/.test(trimmed)) {
            // Extract text strings from TJ array: [(text) num (text) ...]
            const strings = [];
            const tjParts = trimmed.matchAll(/\(([^)]*)\)/g);
            for (const part of tjParts) {
                if (part[1]) strings.push(part[1]);
            }
            if (strings.length > 0) textClipStrings.push(strings.join(''));
            continue;
        }

        // ── ' — move to next line and show text ─────────────────────
        const quoteMatch = trimmed.match(/\(([^)]*)\)\s*'$/);
        if (quoteMatch && inTextObject) {
            textClipStrings.push(quoteMatch[1]);
            continue;
        }

        // ── Do — paint XObject ──────────────────────────────────────
        const doMatch = trimmed.match(/^\/([\w]+)\s+Do$/);
        if (doMatch) {
            const imageName = '/' + doMatch[1];
            const info = imageInfo.get(imageName);
            if (info) {
                results.push({
                    imageName,
                    info,
                    qDepth: stateStack.length,
                    ctm: current.ctm,
                    gsName: current.gsName,
                    clips: [...current.clips],
                });
            }
            continue;
        }
    }

    return results;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * @param {unknown} contentsValue
 * @param {import('pdf-lib').PDFContext} ctx
 * @returns {Promise<string>}
 */
async function decodeContentStreams(contentsValue, ctx) {
    const parts = [];
    if (contentsValue instanceof PDFRef) contentsValue = ctx.lookup(contentsValue);
    if (contentsValue instanceof PDFRawStream) {
        parts.push(await decodeStream(contentsValue));
    } else if (contentsValue instanceof PDFArray) {
        for (let i = 0; i < contentsValue.size(); i++) {
            let item = contentsValue.get(i);
            if (item instanceof PDFRef) item = ctx.lookup(item);
            if (item instanceof PDFRawStream) parts.push(await decodeStream(item));
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
    } catch { /* fall through */ }
    return new TextDecoder('latin1').decode(raw);
}

/**
 * @param {unknown} value
 * @param {import('pdf-lib').PDFContext} ctx
 * @returns {PDFDict | null}
 */
function resolveDict(value, ctx) {
    if (value instanceof PDFRef) value = ctx.lookup(value);
    return value instanceof PDFDict ? value : null;
}

/**
 * @param {PDFDict} dict
 * @param {string} key
 * @returns {number | string}
 */
function getNumber(dict, key) {
    const val = dict.get(PDFName.of(key));
    if (val instanceof PDFNumber) return val.asNumber();
    if (val && typeof val.asNumber === 'function') return val.asNumber();
    return val?.toString() ?? '?';
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
            if (t === '/Lab') return '/Lab';
            if (t === '/Separation') {
                const sepName = csValue.size() > 1 ? csValue.get(1) : null;
                return `/Separation(${sepName instanceof PDFName ? sepName.asString() : '?'})`;
            }
            return t;
        }
    }
    return '?';
}

// ── Entry point ──────────────────────────────────────────────────────────────

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const args = process.argv.filter(a => a !== '').slice(2);
    const pdfPath = args[0] || DEFAULT_PDF;
    await run(pdfPath);
}
