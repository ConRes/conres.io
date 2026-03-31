// @ts-check
/**
 * PDF Font Embedder
 *
 * Embeds missing fonts into a PDF using Ghostscript WASM as a font
 * extraction service. GS never touches the original PDF — a minimal
 * PostScript proxy is rendered to produce embedded font programs,
 * which are then transplanted into the original document.
 *
 * @author Saleh Abdel Motaal <dev@smotaal.io>
 * @ai Claude Opus 4.6 (code generation)
 */

import {
    PDFDocument,
    PDFDict,
    PDFArray,
    PDFName,
    PDFRef,
    PDFRawStream,
    PDFNumber,
    PDFString,
    decodePDFRawStream,
} from '../../packages/pdf-lib/pdf-lib.esm.js';

import { GhostscriptService } from '../../services/GhostscriptService.js';
import { StandardFonts } from '../../packages/pdf-lib/pdf-lib.esm.js';

/**
 * @typedef {{
 *   fontName: string,
 *   descriptorRef: PDFRef,
 *   status: 'embedded' | 'missing' | 'already-embedded' | 'error',
 *   substituteFont?: string,
 *   error?: string,
 * }} FontEmbedResult
 */

export class PDFFontEmbedder {
    /** @type {PDFDocument} */
    #document;

    /** @param {PDFDocument} pdfDocument */
    constructor(pdfDocument) {
        this.#document = pdfDocument;
    }

    /**
     * Find all unembedded fonts in the document.
     *
     * Handles two cases:
     * - Fonts WITH a FontDescriptor but no FontFile/2/3 (partially formed)
     * - Fonts WITHOUT a FontDescriptor at all (pdf-lib standard font references)
     *
     * Type0 composites are skipped — their CIDFont descendants handle embedding.
     *
     * @returns {{ fontName: string, descriptorRef: PDFRef | null, fontDictRefs: PDFRef[] }[]}
     */
    findUnembeddedFonts() {
        /** @type {Map<string, { fontName: string, descriptorRef: PDFRef | null, fontDictRefs: PDFRef[] }>} */
        const unembedded = new Map();

        for (const [ref, obj] of this.#document.context.enumerateIndirectObjects()) {
            if (!(obj instanceof PDFDict)) continue;

            const type = obj.get(PDFName.of('Type'));
            if (!(type instanceof PDFName) || type.encodedName !== '/Font') continue;

            // Skip Type0 composites — embedding is on the descendant CIDFont
            const subtype = obj.get(PDFName.of('Subtype'));
            if (subtype instanceof PDFName && subtype.encodedName === '/Type0') continue;

            const baseFont = obj.lookup(PDFName.of('BaseFont'));
            const fontName = baseFont instanceof PDFName
                ? baseFont.encodedName.replace(/^\//, '')
                : null;
            if (!fontName) continue;

            const descriptorRef = obj.get(PDFName.of('FontDescriptor'));

            if (descriptorRef instanceof PDFRef) {
                const descriptor = this.#document.context.lookup(descriptorRef);
                if (!(descriptor instanceof PDFDict)) continue;

                // Already embedded — skip
                const hasFile = !!(
                    descriptor.get(PDFName.of('FontFile')) ||
                    descriptor.get(PDFName.of('FontFile2')) ||
                    descriptor.get(PDFName.of('FontFile3'))
                );
                if (hasFile) continue;

                // Has descriptor but no font program
                const key = descriptorRef.toString();
                if (!unembedded.has(key)) {
                    unembedded.set(key, { fontName, descriptorRef, fontDictRefs: [] });
                }
                unembedded.get(key).fontDictRefs.push(ref);
            } else {
                // No descriptor at all — standard font reference (pdf-lib pattern)
                // Group by font name since there's no descriptor ref to key on
                const key = `no-desc:${fontName}`;
                if (!unembedded.has(key)) {
                    unembedded.set(key, { fontName, descriptorRef: null, fontDictRefs: [] });
                }
                unembedded.get(key).fontDictRefs.push(ref);
            }
        }

        return [...unembedded.values()];
    }

    /**
     * Embed missing fonts using a pdf-lib proxy PDF passed through GS WASM.
     *
     * GS substitutes NimbusSans for Helvetica (and other URW fonts for the
     * standard 14) when it re-processes a PDF. PostScript findfont does NOT
     * trigger the same substitution — it must be a PDF-to-PDF pass.
     *
     * So: create a minimal PDF with pdf-lib using embedFont(StandardFonts.XXX)
     * for each missing font (same pattern as the generator's docket), run it
     * through GS which embeds the substitutes, extract the font programs from
     * the GS output, and transplant them into the original document.
     *
     * @returns {Promise<FontEmbedResult[]>}
     */
    async embedMissingFonts() {
        const unembedded = this.findUnembeddedFonts();
        if (unembedded.length === 0) return [];

        const fontNames = [...new Set(unembedded.map(f => f.fontName))];

        // Step 1: Create a minimal pdf-lib PDF with each font referenced
        // This is the same approach the generator uses for the docket
        let embeddedPdfBytes;
        try {
            const proxyDoc = await PDFDocument.create();
            const page = proxyDoc.addPage([612, 792]);

            /** @type {Map<string, import('pdf-lib').PDFFont>} */
            const embeddedFonts = new Map();
            let y = 700;

            // Build reverse lookup: PDF font name → StandardFonts value
            const standardFontValues = new Set(Object.values(StandardFonts));

            for (const name of fontNames) {
                // StandardFonts values ARE the PDF names (e.g., 'Helvetica-Bold')
                if (!standardFontValues.has(name)) continue;

                try {
                    const font = await proxyDoc.embedFont(name);
                    embeddedFonts.set(name, font);
                    // Draw text to ensure GS processes the font
                    page.drawText('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789', {
                        x: 72, y, size: 12, font,
                    });
                    y -= 20;
                } catch {
                    // Font not recognized by pdf-lib — skip, will be reported as missing
                }
            }

            if (embeddedFonts.size === 0) {
                // No standard fonts to embed — all fonts are non-standard
                return unembedded.map(f => ({
                    fontName: f.fontName,
                    descriptorRef: f.descriptorRef,
                    status: /** @type {const} */ ('missing'),
                    substituteFont: undefined,
                }));
            }

            const proxyBytes = await proxyDoc.save({ addDefaultPage: false, updateFieldAppearances: false });

            // Step 2: Run the proxy PDF through GS to embed fonts
            // subset: false — the proxy only renders sample glyphs, but the
            // original PDF may use any glyph. Full font programs are needed.
            embeddedPdfBytes = await GhostscriptService.embedFontsInPDF(proxyBytes, { subset: false });
        } catch (e) {
            return unembedded.map(f => ({
                fontName: f.fontName,
                descriptorRef: f.descriptorRef,
                status: /** @type {const} */ ('error'),
                error: `GS proxy failed: ${e.message}`,
            }));
        }

        // Step 3: Extract embedded font programs from the GS output
        const embeddedDoc = await PDFDocument.load(embeddedPdfBytes, { updateMetadata: false });

        /** @type {Map<string, { fontFileKey: string, fontFileData: Uint8Array, fontFileDict: Map<string, *> }>} */
        const extractedFonts = new Map();

        for (const [ref, obj] of embeddedDoc.context.enumerateIndirectObjects()) {
            if (!(obj instanceof PDFDict)) continue;
            const type = obj.get(PDFName.of('Type'));
            if (!(type instanceof PDFName) || type.encodedName !== '/FontDescriptor') continue;

            const fnVal = obj.lookup(PDFName.of('FontName'));
            const fn = fnVal instanceof PDFName ? fnVal.encodedName.replace(/^\//, '') : '';

            for (const key of ['FontFile', 'FontFile2', 'FontFile3']) {
                const fileRef = obj.get(PDFName.of(key));
                if (!(fileRef instanceof PDFRef)) continue;

                const stream = embeddedDoc.context.lookup(fileRef);
                if (!(stream instanceof PDFRawStream)) continue;

                const decoded = decodePDFRawStream(stream);
                const fontBytes = decoded.decode();

                const dictAttrs = new Map();
                for (const [dk, dv] of stream.dict.entries()) {
                    const dkName = dk instanceof PDFName ? dk.encodedName.replace(/^\//, '') : '';
                    if (['Length1', 'Length2', 'Length3', 'Subtype'].includes(dkName)) {
                        dictAttrs.set(dkName, dv instanceof PDFNumber ? dv.numberValue : dv instanceof PDFName ? dv.encodedName : String(dv));
                    }
                }

                extractedFonts.set(fn, { fontFileKey: key, fontFileData: fontBytes, fontFileDict: dictAttrs });
                break;
            }
        }

        // Step 4: Transplant into the original document
        // GS renames fonts with subset prefixes (e.g., "ABCDEF+NimbusSans-Regular")
        // Match by stripping the prefix and checking against known substitutions
        /** @type {FontEmbedResult[]} */
        const results = [];

        for (const entry of unembedded) {
            // Try exact match, then subset-prefix match, then known substitution patterns
            let extracted = null;
            let substituteName = '';

            for (const [name, data] of extractedFonts) {
                const bare = name.replace(/^[A-Z]{6}\+/, '');
                if (bare === entry.fontName || name === entry.fontName) {
                    extracted = data;
                    substituteName = bare;
                    break;
                }
            }

            // If no exact match, try known Helvetica → NimbusSans mapping
            if (!extracted) {
                const KNOWN_SUBS = {
                    'Helvetica': 'NimbusSans-Regular',
                    'Helvetica-Bold': 'NimbusSans-Bold',
                    'Helvetica-Oblique': 'NimbusSans-Italic',
                    'Helvetica-BoldOblique': 'NimbusSans-BoldItalic',
                    'Times-Roman': 'NimbusRoman-Regular',
                    'Times-Bold': 'NimbusRoman-Bold',
                    'Times-Italic': 'NimbusRoman-Italic',
                    'Times-BoldItalic': 'NimbusRoman-BoldItalic',
                    'Courier': 'NimbusMonoPS-Regular',
                    'Courier-Bold': 'NimbusMonoPS-Bold',
                    'Courier-Oblique': 'NimbusMonoPS-Italic',
                    'Courier-BoldOblique': 'NimbusMonoPS-BoldItalic',
                };
                const expectedSub = KNOWN_SUBS[entry.fontName];
                if (expectedSub) {
                    for (const [name, data] of extractedFonts) {
                        const bare = name.replace(/^[A-Z]{6}\+/, '');
                        if (bare === expectedSub) {
                            extracted = data;
                            substituteName = bare;
                            break;
                        }
                    }
                }
            }

            if (extracted) {
                this.#transplantFont(entry.descriptorRef, entry.fontDictRefs, extracted, entry.fontName);
                results.push({
                    fontName: entry.fontName,
                    descriptorRef: entry.descriptorRef,
                    status: 'embedded',
                    substituteFont: substituteName,
                });
            } else {
                results.push({
                    fontName: entry.fontName,
                    descriptorRef: entry.descriptorRef,
                    status: 'missing',
                });
            }
        }

        return results;
    }

    /**
     * Transplant an extracted font program into the original document.
     *
     * If the font has an existing FontDescriptor, adds the font program to it.
     * If the font has no descriptor (standard font reference), creates one.
     *
     * @param {PDFRef | null} descriptorRef
     * @param {PDFRef[]} fontDictRefs — font dicts that share this descriptor (or lack one)
     * @param {{ fontFileKey: string, fontFileData: Uint8Array, fontFileDict: Map<string, *> }} extracted
     * @param {string} fontName
     */
    #transplantFont(descriptorRef, fontDictRefs, extracted, fontName) {
        // Build stream dict attributes
        /** @type {Record<string, *>} */
        const streamDict = {
            Length: extracted.fontFileData.length,
        };

        for (const [key, value] of extracted.fontFileDict) {
            if (key === 'Subtype' && typeof value === 'string') {
                streamDict.Subtype = value.replace(/^\//, '');
            } else if (key.startsWith('Length') && typeof value === 'number') {
                streamDict[key] = value;
            }
        }

        // Create the font program stream
        const fontStream = this.#document.context.stream(extracted.fontFileData, streamDict);
        const fontStreamRef = this.#document.context.register(fontStream);

        if (descriptorRef) {
            // Existing descriptor — add the font program
            const descriptor = this.#document.context.lookup(descriptorRef);
            if (descriptor instanceof PDFDict) {
                descriptor.set(PDFName.of(extracted.fontFileKey), fontStreamRef);
            }
        } else {
            // No descriptor — create one and attach to all font dicts that reference this font
            const descriptor = this.#document.context.obj({
                Type: 'FontDescriptor',
                FontName: fontName,
                Flags: 32, // Nonsymbolic
                [extracted.fontFileKey]: fontStreamRef,
            });
            const newDescRef = this.#document.context.register(descriptor);

            for (const fontDictRef of fontDictRefs) {
                const fontDict = this.#document.context.lookup(fontDictRef);
                if (fontDict instanceof PDFDict) {
                    fontDict.set(PDFName.of('FontDescriptor'), newDescRef);
                }
            }
        }
    }

}
