#!/usr/bin/env node
// @ts-check
/**
 * Debug script to inspect mask-related properties on PDF image XObjects.
 *
 * Checks each image for:
 *   /SMask       — soft mask (transparency mask, references another image stream)
 *   /Mask        — hard mask (stencil image or color-key masking array)
 *   /ImageMask   — boolean flag indicating the image itself IS a mask
 *   /Matte       — pre-blended matte color (used with soft masks)
 *
 * Also checks content streams for the /gs graphics state operator
 * which can set /SMask via the ExtGState dictionary.
 *
 * Usage:
 *   node testing/iso/ptf/2025/experiments/scripts/debug-image-masks.mjs [path-to-pdf]
 *
 * Default PDF:
 *   testing/iso/ptf/2025/tests/fixtures/pdfs/2025-08-15 - ConRes - ISO PTF - CR1 (F9d) Fixtures - F-01.pdf
 *
 * @author Saleh Abdel Motaal <dev@smotaal.io>
 * @ai Claude Opus 4.6 (code generation)
 */

import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import {
    PDFDocument,
    PDFDict,
    PDFName,
    PDFArray,
    PDFRef,
    PDFRawStream,
    PDFNumber,
    PDFBool,
    PDFStream,
} from 'pdf-lib';

const DEFAULT_PDF = 'testing/iso/ptf/2025/tests/fixtures/pdfs/2025-08-15 - ConRes - ISO PTF - CR1 (F9d) Fixtures - F-01.pdf';

// ── Entry point ──────────────────────────────────────────────────────────────

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const pdfPath = process.argv.filter(a => a !== '').slice(2)[0] || DEFAULT_PDF;
    await run(pdfPath);
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function run(pdfPath) {
    console.log(`Loading PDF: ${pdfPath}`);
    const pdfBytes = await readFile(pdfPath);
    const pdfDocument = await PDFDocument.load(pdfBytes, { updateMetadata: false });
    const context = pdfDocument.context;
    const pages = pdfDocument.getPages();

    console.log(`PDF has ${pages.length} page(s)\n`);

    for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
        const page = pages[pageIndex];
        const pageDict = context.lookup(page.ref);

        console.log(`${'═'.repeat(72)}`);
        console.log(`  Page ${pageIndex} (${page.ref.toString()})`);
        console.log(`${'═'.repeat(72)}`);

        if (!(pageDict instanceof PDFDict)) {
            console.log('  (not a PDFDict)\n');
            continue;
        }

        const resourcesDict = resolveDict(pageDict.get(PDFName.of('Resources')), context);
        if (!resourcesDict) {
            console.log('  (no Resources)\n');
            continue;
        }

        // ── Collect all XObject images ───────────────────────────────────

        const xobjectDict = resolveDict(resourcesDict.get(PDFName.of('XObject')), context);
        if (!xobjectDict) {
            console.log('  (no XObject resources)\n');
            continue;
        }

        /** @type {Map<string, {ref: import('pdf-lib').PDFRef, stream: import('pdf-lib').PDFRawStream, name: string}>} */
        const imagesByName = new Map();

        /** @type {Map<string, string>} ref string → image name */
        const refToName = new Map();

        for (const [nameObj, value] of xobjectDict.entries()) {
            const name = nameObj.asString();
            if (!(value instanceof PDFRef)) continue;

            const obj = context.lookup(value);
            if (!(obj instanceof PDFRawStream)) continue;

            const subtype = obj.dict.get(PDFName.of('Subtype'));
            if (!(subtype instanceof PDFName) || subtype.asString() !== '/Image') continue;

            imagesByName.set(name, { ref: value, stream: obj, name });
            refToName.set(value.toString(), name);
        }

        if (imagesByName.size === 0) {
            console.log('  (no image XObjects)\n');
            continue;
        }

        // ── Inspect each image ───────────────────────────────────────────

        for (const [name, { ref, stream }] of imagesByName) {
            const dict = stream.dict;
            const width = getNumber(dict, 'Width');
            const height = getNumber(dict, 'Height');
            const bpc = getNumber(dict, 'BitsPerComponent');
            const colorSpace = describeColorSpace(dict.get(PDFName.of('ColorSpace')), context);

            console.log(`\n  ┌─ ${name} (${ref.toString()})  ${width}×${height}  BPC=${bpc}  CS=${colorSpace}`);

            // /ImageMask — is this image itself a stencil mask?
            const imageMaskVal = dict.get(PDFName.of('ImageMask'));
            const isImageMask = (imageMaskVal instanceof PDFBool && imageMaskVal.asBoolean())
                || (imageMaskVal instanceof PDFName && imageMaskVal.asString() === '/true');
            if (imageMaskVal !== undefined) {
                console.log(`  │  /ImageMask = ${isImageMask} ${isImageMask ? '⇐ THIS IMAGE IS A STENCIL MASK' : ''}`);
            }

            // /SMask — soft mask (reference to another image stream)
            const smaskVal = dict.get(PDFName.of('SMask'));
            if (smaskVal !== undefined) {
                if (smaskVal instanceof PDFRef) {
                    const smaskName = refToName.get(smaskVal.toString()) || '(not in XObject dict)';
                    const smaskObj = context.lookup(smaskVal);
                    let smaskInfo = '';
                    if (smaskObj instanceof PDFRawStream) {
                        const sw = getNumber(smaskObj.dict, 'Width');
                        const sh = getNumber(smaskObj.dict, 'Height');
                        const sbpc = getNumber(smaskObj.dict, 'BitsPerComponent');
                        const scs = describeColorSpace(smaskObj.dict.get(PDFName.of('ColorSpace')), context);
                        smaskInfo = `  ${sw}×${sh}  BPC=${sbpc}  CS=${scs}`;
                    }
                    console.log(`  │  /SMask = ${smaskVal.toString()} → ${smaskName}${smaskInfo}`);
                    console.log(`  │          ⇐ SOFT MASK: this image uses ${smaskName} as transparency mask`);
                } else if (smaskVal instanceof PDFName && smaskVal.asString() === '/None') {
                    console.log(`  │  /SMask = /None (explicitly no soft mask)`);
                } else {
                    console.log(`  │  /SMask = ${smaskVal.toString()} (unexpected type)`);
                }
            }

            // /Mask — hard mask (can be another image stream ref or color-key array)
            const maskVal = dict.get(PDFName.of('Mask'));
            if (maskVal !== undefined) {
                if (maskVal instanceof PDFRef) {
                    const maskName = refToName.get(maskVal.toString()) || '(not in XObject dict)';
                    console.log(`  │  /Mask = ${maskVal.toString()} → ${maskName}`);
                    console.log(`  │         ⇐ HARD MASK (stencil): uses ${maskName} as binary mask`);
                } else if (maskVal instanceof PDFArray) {
                    const values = [];
                    for (let i = 0; i < maskVal.size(); i++) {
                        const item = maskVal.get(i);
                        values.push(item instanceof PDFNumber ? item.asNumber() : item.toString());
                    }
                    console.log(`  │  /Mask = [${values.join(', ')}]`);
                    console.log(`  │         ⇐ COLOR-KEY MASK: pixels matching these ranges are transparent`);
                } else {
                    console.log(`  │  /Mask = ${maskVal.toString()} (unexpected type)`);
                }
            }

            // /Matte — pre-blended matte color (only meaningful with /SMask)
            const matteVal = dict.get(PDFName.of('Matte'));
            if (matteVal !== undefined && matteVal instanceof PDFArray) {
                const values = [];
                for (let i = 0; i < matteVal.size(); i++) {
                    const item = matteVal.get(i);
                    values.push(item instanceof PDFNumber ? item.asNumber() : item.toString());
                }
                console.log(`  │  /Matte = [${values.join(', ')}]`);
                console.log(`  │           ⇐ Pre-blended background color for soft mask compositing`);
            }

            // /Decode array
            const decodeVal = dict.get(PDFName.of('Decode'));
            if (decodeVal instanceof PDFArray) {
                const values = [];
                for (let i = 0; i < decodeVal.size(); i++) {
                    const item = decodeVal.get(i);
                    values.push(item instanceof PDFNumber ? item.asNumber() : item.toString());
                }
                console.log(`  │  /Decode = [${values.join(', ')}]`);
            }

            // /Intent — rendering intent override on the image itself
            const intentVal = dict.get(PDFName.of('Intent'));
            if (intentVal instanceof PDFName) {
                console.log(`  │  /Intent = ${intentVal.asString()}`);
            }

            // Summary line
            if (!smaskVal && !maskVal && !isImageMask) {
                console.log(`  │  (no mask properties)`);
            }

            console.log(`  └─`);
        }

        // ── Check ExtGState for /SMask references ────────────────────────

        const extGStateDict = resolveDict(resourcesDict.get(PDFName.of('ExtGState')), context);
        if (extGStateDict) {
            console.log(`\n  ExtGState entries with /SMask:`);
            let found = false;
            for (const [nameObj, value] of extGStateDict.entries()) {
                const gsDict = resolveDict(value, context);
                if (!gsDict) continue;

                const smask = gsDict.get(PDFName.of('SMask'));
                if (smask === undefined) continue;

                found = true;
                const gsName = nameObj.asString();

                if (smask instanceof PDFName && smask.asString() === '/None') {
                    console.log(`    ${gsName}: /SMask = /None`);
                } else if (smask instanceof PDFDict) {
                    // Inline soft mask dictionary
                    const smaskSubtype = smask.get(PDFName.of('S'));
                    const smaskGroup = smask.get(PDFName.of('G'));
                    console.log(`    ${gsName}: /SMask = dict { /S=${smaskSubtype?.toString()}, /G=${smaskGroup?.toString()} }`);
                } else if (smask instanceof PDFRef) {
                    const smaskObj = context.lookup(smask);
                    if (smaskObj instanceof PDFDict) {
                        const smaskSubtype = smaskObj.get(PDFName.of('S'));
                        const smaskGroup = smaskObj.get(PDFName.of('G'));
                        console.log(`    ${gsName}: /SMask → ${smask.toString()} dict { /S=${smaskSubtype?.toString()}, /G=${smaskGroup?.toString()} }`);
                    } else {
                        console.log(`    ${gsName}: /SMask → ${smask.toString()}`);
                    }
                } else {
                    console.log(`    ${gsName}: /SMask = ${smask.toString()}`);
                }
            }
            if (!found) {
                console.log(`    (none)`);
            }
        }

        // ── Scan content streams for gs operator usage ───────────────────

        const contentStreamsRef = pageDict.get(PDFName.of('Contents'));
        if (contentStreamsRef) {
            console.log(`\n  Content stream /Do (image placement) operators:`);
            const streams = collectContentStreams(contentStreamsRef, context);
            for (const streamData of streams) {
                const text = new TextDecoder('latin1').decode(streamData);
                // Find /ImageName Do patterns
                const doPattern = /\/([\w]+)\s+Do\b/g;
                let match;
                while ((match = doPattern.exec(text)) !== null) {
                    const imageName = `/${match[1]}`;
                    const imageEntry = imagesByName.get(imageName);
                    if (imageEntry) {
                        // Look backwards for preceding gs operator
                        const before = text.substring(Math.max(0, match.index - 200), match.index);
                        const gsMatch = before.match(/\/([\w]+)\s+gs\b/g);
                        const lastGs = gsMatch ? gsMatch[gsMatch.length - 1] : null;
                        const gsInfo = lastGs ? `  (preceded by ${lastGs.trim()})` : '';
                        console.log(`    ${imageName} Do  → ${imageEntry.ref.toString()}${gsInfo}`);
                    }
                }
            }
        }

        console.log('');
    }

    // ── Summary ──────────────────────────────────────────────────────────

    console.log(`\n${'═'.repeat(72)}`);
    console.log(`  Summary: Mask Relationships`);
    console.log(`${'═'.repeat(72)}`);

    for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
        const page = pages[pageIndex];
        const pageDict = context.lookup(page.ref);
        if (!(pageDict instanceof PDFDict)) continue;

        const resourcesDict = resolveDict(pageDict.get(PDFName.of('Resources')), context);
        if (!resourcesDict) continue;

        const xobjectDict = resolveDict(resourcesDict.get(PDFName.of('XObject')), context);
        if (!xobjectDict) continue;

        /** @type {Map<string, import('pdf-lib').PDFRawStream>} */
        const images = new Map();
        /** @type {Map<string, string>} */
        const refToName = new Map();

        for (const [nameObj, value] of xobjectDict.entries()) {
            if (!(value instanceof PDFRef)) continue;
            const obj = context.lookup(value);
            if (!(obj instanceof PDFRawStream)) continue;
            const subtype = obj.dict.get(PDFName.of('Subtype'));
            if (!(subtype instanceof PDFName) || subtype.asString() !== '/Image') continue;
            images.set(nameObj.asString(), obj);
            refToName.set(value.toString(), nameObj.asString());
        }

        let hasMasks = false;

        for (const [name, stream] of images) {
            const dict = stream.dict;

            const imageMaskVal = dict.get(PDFName.of('ImageMask'));
            const isImageMask = imageMaskVal instanceof PDFBool && imageMaskVal.asBoolean();

            const smaskVal = dict.get(PDFName.of('SMask'));
            const maskVal = dict.get(PDFName.of('Mask'));

            if (isImageMask) {
                hasMasks = true;
                console.log(`  Page ${pageIndex}: ${name} IS a stencil mask (/ImageMask=true)`);
            }
            if (smaskVal instanceof PDFRef) {
                hasMasks = true;
                const smaskName = refToName.get(smaskVal.toString()) || smaskVal.toString();
                console.log(`  Page ${pageIndex}: ${name} HAS soft mask → ${smaskName}`);
            }
            if (maskVal instanceof PDFRef) {
                hasMasks = true;
                const maskName = refToName.get(maskVal.toString()) || maskVal.toString();
                console.log(`  Page ${pageIndex}: ${name} HAS hard mask → ${maskName}`);
            }
            if (maskVal instanceof PDFArray) {
                hasMasks = true;
                console.log(`  Page ${pageIndex}: ${name} HAS color-key mask`);
            }
        }

        if (!hasMasks) {
            console.log(`  Page ${pageIndex}: no mask relationships found`);
        }
    }

    console.log('');
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Resolve a value to a PDFDict, following PDFRef indirection.
 * @param {unknown} value
 * @param {import('pdf-lib').PDFContext} context
 * @returns {PDFDict | null}
 */
function resolveDict(value, context) {
    if (value instanceof PDFRef) value = context.lookup(value);
    return value instanceof PDFDict ? value : null;
}

/**
 * Get a numeric value from a dictionary entry.
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
 * Describe a color space entry for display.
 * @param {unknown} csValue
 * @param {import('pdf-lib').PDFContext} context
 * @returns {string}
 */
function describeColorSpace(csValue, context) {
    if (csValue === undefined) return '(none)';
    if (csValue instanceof PDFRef) csValue = context.lookup(csValue);

    if (csValue instanceof PDFName) return csValue.asString();

    if (csValue instanceof PDFArray && csValue.size() > 0) {
        const first = csValue.get(0);
        if (first instanceof PDFName) {
            const csType = first.asString();
            if (csType === '/ICCBased' && csValue.size() > 1) {
                const profileRef = csValue.get(1);
                if (profileRef instanceof PDFRef) {
                    const profileStream = context.lookup(profileRef);
                    if (profileStream instanceof PDFRawStream) {
                        const n = getNumber(profileStream.dict, 'N');
                        return `/ICCBased (N=${n})`;
                    }
                }
            }
            if (csType === '/Lab') return '/Lab';
            if (csType === '/Indexed') {
                let baseCs = csValue.get(1);
                if (baseCs instanceof PDFRef) baseCs = context.lookup(baseCs);
                if (baseCs instanceof PDFName) return `/Indexed (base=${baseCs.asString()})`;
                if (baseCs instanceof PDFArray && baseCs.size() > 0) {
                    const bf = baseCs.get(0);
                    if (bf instanceof PDFName) return `/Indexed (base=${bf.asString()})`;
                }
            }
            return csType;
        }
    }

    return csValue?.toString() ?? '?';
}

/**
 * Collect raw content stream bytes from a page's /Contents entry.
 * @param {unknown} contentsValue
 * @param {import('pdf-lib').PDFContext} context
 * @returns {Uint8Array[]}
 */
function collectContentStreams(contentsValue, context) {
    const result = [];

    if (contentsValue instanceof PDFRef) {
        contentsValue = context.lookup(contentsValue);
    }

    if (contentsValue instanceof PDFRawStream || contentsValue instanceof PDFStream) {
        try {
            // pdf-lib decodes the stream automatically via .contents or .getContents()
            const data = contentsValue instanceof PDFRawStream
                ? contentsValue.asUint8Array()
                : null;
            if (data) result.push(data);
        } catch {
            // Skip undecodable streams
        }
    } else if (contentsValue instanceof PDFArray) {
        for (let i = 0; i < contentsValue.size(); i++) {
            let item = contentsValue.get(i);
            if (item instanceof PDFRef) item = context.lookup(item);
            if (item instanceof PDFRawStream) {
                try {
                    result.push(item.asUint8Array());
                } catch {
                    // Skip
                }
            }
        }
    }

    return result;
}
