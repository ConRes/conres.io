// @ts-check
/**
 * Color Space Utilities for PDF Processing
 * 
 * This module provides utilities for analyzing and manipulating color spaces in PDF documents.
 * It extracts functionality from the original PDFService.decalibratePDFDocument method
 * to enable reuse in both decalibration and color conversion workflows.
 */
import {
    PDFDict,
    PDFDocument,
    PDFRawStream,
    PDFArray,
    PDFRef,
    PDFName,
    PDFString,
    PDFPageLeaf,
    decodePDFRawStream,
    copyStringIntoBuffer,
} from "../packages/pdf-lib/pdf-lib.esm.js";

import { Buffer } from "../helpers.js";
import { ICCService } from "./ICCService.js";
import { lookupMaybe, decodeText, compressWithFlateDecode, bytesAsString } from "./helpers/pdf-lib.js";


/**
 * @typedef {{
 *   colorSpaceUUID: string,
 *   colorSpaceString: string,
 *   colorSpaceDescriptor: PDFArray | PDFName,
 *   colorSpaceDefinition: ColorSpaceDefinition | undefined,
 * }} UniqueColorSpaceRecord 
 */

/**
 * @typedef {{
 *   type: string,
 *   colorSpaceType: string,
 *   colorSpaceDescriptor: PDFArray | PDFName,
 * }} ColorSpaceDefinition
 */

/**
 * Lab color space definition with parameters from PDF spec (ISO 32000-2, 8.6.5.4)
 * @typedef {{
 *   type: 'LabColorSpaceDefinition',
 *   colorSpaceType: 'Lab',
 *   colorSpaceDescriptor: PDFArray,
 *   whitePoint: [number, number, number],
 *   blackPoint: [number, number, number],
 *   range: [number, number, number, number],
 * }} LabColorSpaceDefinition
 */

/**
 * @typedef {'XObjectImage' | 'Page' | string} ColorSpaceDesignationType
 */

/**
 * @typedef {{
 *   type: `${ColorSpaceDesignationType}ColorSpaceDesignation`,
 *   colorSpaceDesignationTargetRef: PDFRef,
 *   colorSpaceDesignationTarget: PDFRawStream | PDFPageLeaf,
 *   colorSpaceDesignator: PDFArray | PDFName | PDFDict,
 *   colorSpaceDefinition?: ColorSpaceDefinition,
 *   colorSpaceDefinitions?: Record<string, ColorSpaceDefinition | undefined>,
 * }} ColorSpaceDesignation
 */

/**
 * @typedef {{
 *   colorSpace: 'CMYK' | 'RGB' | 'GRAY' | string,
 *   [key: string]: any,
 * }} ICCProfileHeader
 */

/**
 * Manages unique color space records for a PDF document.
 * This class deduplicates color space definitions to optimize processing.
 */
export class UniqueColorSpaceRecords {
    /** @type {PDFDocument} */
    #pdfDocument;

    /** @type {Record<string, UniqueColorSpaceRecord>} */
    #records = {};

    /**
     * @param {PDFDocument} pdfDocument
     */
    constructor(pdfDocument) {
        if (!(pdfDocument instanceof PDFDocument)) {
            throw new Error('Expected pdfDocument to be an instance of PDFDocument.');
        }
        this.#pdfDocument = pdfDocument;
    }

    /**
     * Gets the PDF document associated with this record set
     * @returns {PDFDocument}
     */
    get pdfDocument() {
        return this.#pdfDocument;
    }

    /**
     * Gets all recorded color space records
     * @returns {Record<string, UniqueColorSpaceRecord>}
     */
    get records() {
        return { ...this.#records };
    }

    /**
     * Creates a color space definition object from a descriptor.
     * @param {PDFArray | PDFRef | PDFName} colorSpaceDescriptor
     * @returns {ColorSpaceDefinition | LabColorSpaceDefinition | undefined}
     */
    createColorSpaceDefinitionFrom(colorSpaceDescriptor) {
        if (colorSpaceDescriptor instanceof PDFRef) {
            const colorSpaceObject = this.#pdfDocument?.context.lookup(colorSpaceDescriptor);
            if (!colorSpaceObject || !(colorSpaceObject instanceof PDFArray || colorSpaceObject instanceof PDFName)) return undefined;
            return this.createColorSpaceDefinitionFrom(colorSpaceObject);
        } else if (colorSpaceDescriptor instanceof PDFName) {
            const colorSpaceType = colorSpaceDescriptor.decodeText();
            const colorSpaceClassifier = /^(?:(?:Device)(?=CMYK|RGB|Gray))/.exec(colorSpaceType)?.[0] ?? 'Unknown';
            return {
                type: `${colorSpaceClassifier}ColorSpaceDefinition`,
                colorSpaceType: colorSpaceType,
                colorSpaceDescriptor: colorSpaceDescriptor,
            };
        } else if (colorSpaceDescriptor instanceof PDFArray) {
            const colorSpaceType = /** @type {PDFName | undefined} */ (colorSpaceDescriptor.get(0))?.decodeText?.();
            if (!colorSpaceType) return undefined;

            // Handle Lab color space specially to extract parameters
            if (colorSpaceType === 'Lab') {
                return this.#createLabColorSpaceDefinition(colorSpaceDescriptor);
            }

            const colorSpaceClassifier = /^(?:(?:Cal)(?=CMYK|RGB|Gray))/.exec(colorSpaceType)?.[0] ?? colorSpaceType;
            return {
                type: `${colorSpaceClassifier}ColorSpaceDefinition`,
                colorSpaceType: colorSpaceType,
                colorSpaceDescriptor: colorSpaceDescriptor,
            };
        }
        return undefined;
    }

    /**
     * Creates a Lab color space definition with extracted parameters.
     * PDF Lab color space format: [/Lab << /WhitePoint [Xw Yw Zw] /BlackPoint [Xb Yb Zb] /Range [amin amax bmin bmax] >>]
     * @param {PDFArray} colorSpaceDescriptor
     * @returns {LabColorSpaceDefinition}
     */
    #createLabColorSpaceDefinition(colorSpaceDescriptor) {
        // Default values per PDF spec (ISO 32000-2, section 8.6.5.4)
        /** @type {[number, number, number]} */
        let whitePoint = [0.9505, 1.0, 1.089]; // D65 default (though PDF spec says WhitePoint is required)
        /** @type {[number, number, number]} */
        let blackPoint = [0, 0, 0]; // Optional, defaults to origin
        /** @type {[number, number, number, number]} */
        let range = [-100, 100, -100, 100]; // Optional, defaults for a* and b*

        // Extract Lab dictionary (second element of array)
        let labDict = colorSpaceDescriptor.get(1);
        if (labDict instanceof PDFRef) {
            labDict = this.#pdfDocument.context.lookup(labDict);
        }

        if (labDict instanceof PDFDict) {
            // Extract WhitePoint
            const wpArray = labDict.get(PDFName.of('WhitePoint'));
            if (wpArray instanceof PDFArray && wpArray.size() >= 3) {
                whitePoint = [
                    this.#getNumberFromPDF(wpArray.get(0)) ?? whitePoint[0],
                    this.#getNumberFromPDF(wpArray.get(1)) ?? whitePoint[1],
                    this.#getNumberFromPDF(wpArray.get(2)) ?? whitePoint[2],
                ];
            }

            // Extract BlackPoint (optional)
            const bpArray = labDict.get(PDFName.of('BlackPoint'));
            if (bpArray instanceof PDFArray && bpArray.size() >= 3) {
                blackPoint = [
                    this.#getNumberFromPDF(bpArray.get(0)) ?? blackPoint[0],
                    this.#getNumberFromPDF(bpArray.get(1)) ?? blackPoint[1],
                    this.#getNumberFromPDF(bpArray.get(2)) ?? blackPoint[2],
                ];
            }

            // Extract Range (optional)
            const rangeArray = labDict.get(PDFName.of('Range'));
            if (rangeArray instanceof PDFArray && rangeArray.size() >= 4) {
                range = [
                    this.#getNumberFromPDF(rangeArray.get(0)) ?? range[0],
                    this.#getNumberFromPDF(rangeArray.get(1)) ?? range[1],
                    this.#getNumberFromPDF(rangeArray.get(2)) ?? range[2],
                    this.#getNumberFromPDF(rangeArray.get(3)) ?? range[3],
                ];
            }
        }

        return {
            type: 'LabColorSpaceDefinition',
            colorSpaceType: 'Lab',
            colorSpaceDescriptor: colorSpaceDescriptor,
            whitePoint,
            blackPoint,
            range,
        };
    }

    /**
     * Helper to extract a number from a PDF value
     * @param {any} value
     * @returns {number | undefined}
     */
    #getNumberFromPDF(value) {
        if (typeof value?.asNumber === 'function') {
            return value.asNumber();
        }
        if (typeof value === 'number') {
            return value;
        }
        return undefined;
    }

    /**
     * Gets or creates a unique record for a given color space descriptor.
     * @param {PDFArray | PDFRef | PDFName} colorSpaceDescriptor
     * @returns {UniqueColorSpaceRecord | undefined}
     */
    getRecord(colorSpaceDescriptor) {
        if (colorSpaceDescriptor instanceof PDFRef) {
            const colorSpaceObject = this.#pdfDocument?.context.lookup(colorSpaceDescriptor);

            if (colorSpaceObject && (colorSpaceObject instanceof PDFArray || colorSpaceObject instanceof PDFName)) {
                return this.getRecord(colorSpaceObject);
            }

            console.warn(`Could not resolve PDFRef for color space descriptor: ${colorSpaceDescriptor}`);

            return undefined;
        } else if (colorSpaceDescriptor instanceof PDFName || colorSpaceDescriptor instanceof PDFArray) {
            try {
                const size = colorSpaceDescriptor.sizeInBytes();
                const colorSpaceBuffer = new Uint8Array(size);

                colorSpaceDescriptor.copyBytesInto(colorSpaceBuffer, 0);

                const colorSpaceString = Array.from(colorSpaceBuffer, byte => String.fromCharCode(byte)).join('');

                if (!colorSpaceString) {
                    console.warn(`Empty string generated for color space descriptor: ${colorSpaceDescriptor}`);
                    return undefined;
                }

                if (!this.#records[colorSpaceString]) {
                    const clonedDescriptor = colorSpaceDescriptor.clone(this.#pdfDocument.context);
                    this.#records[colorSpaceString] = {
                        colorSpaceUUID: crypto.randomUUID(),
                        colorSpaceString,
                        colorSpaceDescriptor: clonedDescriptor,
                        colorSpaceDefinition: this.createColorSpaceDefinitionFrom(clonedDescriptor),
                    };
                }
                return this.#records[colorSpaceString];
            } catch (error) {
                console.error(`Error processing color space descriptor: ${error}`, colorSpaceDescriptor);
                return undefined;
            }
        }

        console.warn(`Unexpected color space descriptor type: ${colorSpaceDescriptor?.constructor?.name ?? typeof colorSpaceDescriptor}`);
        return undefined;
    }
}

/**
 * Determines if a color space definition is ICC-based
 * @param {PDFArray | PDFName} colorSpaceDescriptor
 * @returns {boolean}
 */
export function isICCBasedColorSpace(colorSpaceDescriptor) {
    return colorSpaceDescriptor instanceof PDFArray &&
        decodeText(colorSpaceDescriptor.get(0)) === 'ICCBased';
}

/**
 * Gets the device color space name for a given ICC color space
 * @param {'CMYK' | 'RGB' | 'GRAY' | string} colorSpace
 * @returns {PDFName | undefined}
 */
export function getDeviceColorSpaceForICC(colorSpace) {
    switch (colorSpace) {
        case 'CMYK': return PDFName.of('DeviceCMYK');
        case 'RGB': return PDFName.of('DeviceRGB');
        case 'GRAY': return PDFName.of('DeviceGray');
        default: return undefined;
    }
}

/**
 * Extracts the ICC profile stream reference from an ICC-based color space descriptor
 * @param {PDFArray} colorSpaceDescriptor - Must be an ICCBased color space array
 * @returns {PDFRef | undefined}
 */
export function getICCProfileRefFromColorSpace(colorSpaceDescriptor) {
    if (!isICCBasedColorSpace(colorSpaceDescriptor)) return undefined;
    const profileRef = colorSpaceDescriptor.get(1);
    return profileRef instanceof PDFRef ? profileRef : undefined;
}

/**
 * Parses an ICC profile from a PDF stream
 * @param {PDFDocument} pdfDocument
 * @param {PDFRef} profileRef
 */
export function parseICCProfileFromRef(pdfDocument, profileRef) {
    const stream = lookupMaybe(pdfDocument.context, profileRef, PDFRawStream);
    if (!stream) return undefined;

    const buffer = /** @type {Buffer} */(Buffer.from(decodePDFRawStream(stream).decode()));
    const header = ICCService.parseICCHeaderFromSource(/** @type {*} */(buffer));

    return { buffer, header };
}

/**
 * @typedef {{
 *   colorSpaceDesignationTargetsByClassifier: Record<string, Map<any, ColorSpaceDesignation>>,
 *   colorSpaceDesignationTargetsLookup: Map<PDFArray | PDFName, Set<ColorSpaceDesignation>>,
 *   uniqueColorSpaceRecords: UniqueColorSpaceRecords,
 * }} ColorSpaceAnalysisResult
 */

/**
 * Analyzes all color space designations in a PDF document
 * @param {PDFDocument} pdfDocument
 * @param {object} [options]
 * @param {boolean} [options.debug] - Whether to enable debug logging
 */
export function analyzeColorSpaces(pdfDocument, options = {}) {
    const { debug = false } = options;
    const uniqueColorSpaceRecords = new UniqueColorSpaceRecords(pdfDocument);
    const enumeratedIndirectObjects = /** @type {[PDFRef, any][]} */ (pdfDocument.context.enumerateIndirectObjects());

    /** @type {Record<string, Map<any, ColorSpaceDesignation>>} */
    const colorSpaceDesignationTargetsByClassifier = {};

    /** @type {Map<PDFArray | PDFName, Set<ColorSpaceDesignation>>} */
    const colorSpaceDesignationTargetsLookup = new Map();

    /** @type {ColorSpaceAnalysisResult} */
    const colorSpaceAnalysisResult = {
        colorSpaceDesignationTargetsByClassifier,
        colorSpaceDesignationTargetsLookup,
        uniqueColorSpaceRecords,
    };

    for (const [enumeratedRef, enumeratedObject] of enumeratedIndirectObjects) {
        try {
            if (enumeratedObject instanceof PDFRawStream) {
                const designation = processRawStreamColorSpace(
                    enumeratedRef,
                    enumeratedObject,
                    uniqueColorSpaceRecords
                );

                if (designation) {
                    const classifier = designation.type.replace('ColorSpaceDesignation', '');
                    (colorSpaceDesignationTargetsByClassifier[classifier] ??= new Map())
                        .set(enumeratedObject, designation);

                    if (designation.colorSpaceDefinition?.colorSpaceDescriptor) {
                        const lookup = colorSpaceDesignationTargetsLookup.get(designation.colorSpaceDefinition.colorSpaceDescriptor)
                            ?? new Set();
                        lookup.add(designation);
                        colorSpaceDesignationTargetsLookup.set(designation.colorSpaceDefinition.colorSpaceDescriptor, lookup);
                    }
                }
            } else if (enumeratedObject instanceof PDFPageLeaf) {
                const designation = processPageLeafColorSpaces(
                    enumeratedRef,
                    enumeratedObject,
                    uniqueColorSpaceRecords
                );

                if (designation) {
                    const classifier = designation.type.replace('ColorSpaceDesignation', '');
                    (colorSpaceDesignationTargetsByClassifier[classifier] ??= new Map())
                        .set(enumeratedObject, designation);

                    if (designation.colorSpaceDefinitions) {
                        for (const colorSpaceDefinition of Object.values(designation.colorSpaceDefinitions)) {
                            if (colorSpaceDefinition?.colorSpaceDescriptor) {
                                const lookup = colorSpaceDesignationTargetsLookup.get(colorSpaceDefinition.colorSpaceDescriptor)
                                    ?? new Set();
                                lookup.add(designation);
                                colorSpaceDesignationTargetsLookup.set(colorSpaceDefinition.colorSpaceDescriptor, lookup);
                            }
                        }
                    }
                }
            }
        } catch (error) {
            if (debug) console.error(error);
        }
    }


    return colorSpaceAnalysisResult;
}

/**
 * Process color space from a PDFRawStream (typically XObject/Image)
 * @param {PDFRef} ref
 * @param {PDFRawStream} rawStream
 * @param {UniqueColorSpaceRecords} uniqueColorSpaceRecords
 * @returns {ColorSpaceDesignation | undefined}
 */
function processRawStreamColorSpace(ref, rawStream, uniqueColorSpaceRecords) {
    const dict = /** @type {PDFDict} */ (rawStream.dict);
    const type = /** @type {PDFName | undefined} */ (dict.get(PDFName.of('Type')));
    const subtype = /** @type {PDFName | undefined} */ (dict.get(PDFName.of('Subtype')));
    const classifier = `${decodeText(type) ?? ''}${decodeText(subtype) ?? ''}` || undefined;
    const colorSpaceDesignator = lookupMaybe(dict, PDFName.of('ColorSpace'), PDFName, PDFArray);

    if (!(classifier && colorSpaceDesignator)) return undefined;

    const uniqueColorSpaceRecord = uniqueColorSpaceRecords.getRecord(colorSpaceDesignator);
    if (!uniqueColorSpaceRecord) return undefined;

    return {
        type: /** @type {`${string}ColorSpaceDesignation`} */ (`${classifier}ColorSpaceDesignation`),
        colorSpaceDesignationTargetRef: ref,
        colorSpaceDesignationTarget: rawStream,
        colorSpaceDesignator: colorSpaceDesignator,
        colorSpaceDefinition: uniqueColorSpaceRecord.colorSpaceDefinition,
    };
}

/**
 * Process color spaces from a PDFPageLeaf
 * @param {PDFRef} ref
 * @param {PDFPageLeaf} pageLeaf
 * @param {UniqueColorSpaceRecords} uniqueColorSpaceRecords
 * @returns {ColorSpaceDesignation | undefined}
 */
function processPageLeafColorSpaces(ref, pageLeaf, uniqueColorSpaceRecords) {
    const type = /** @type {PDFName | undefined} */ (pageLeaf.get(PDFName.of('Type')));
    const subtype = /** @type {PDFName | undefined} */ (pageLeaf.get(PDFName.of('Subtype')));
    const classifier = `${decodeText(type) ?? ''}${decodeText(subtype) ?? ''}` || undefined;
    // const resourcesDict = /** @type {PDFDict | undefined} */ (pageLeaf.lookupMaybe(PDFName.of('Resources'), PDFDict));
    const resourcesDict = lookupMaybe(pageLeaf,PDFName.of('Resources'), PDFDict);
    // const colorSpaceDesignator = resourcesDict?.lookupMaybe?.(PDFName.of('ColorSpace'), PDFDict);
    const colorSpaceDesignator = lookupMaybe(resourcesDict, PDFName.of('ColorSpace'), PDFDict);

    if (!(classifier && colorSpaceDesignator)) return undefined;

    /** @type {Record<string, ColorSpaceDefinition | undefined>} */
    const colorSpaceDefinitions = {};
    let colorSpaceDefinitionsCount = 0;

    for (const [key, descriptor] of /** @type {MapIterator<[PDFName, PDFRef | PDFName]>} */(colorSpaceDesignator.asMap().entries())) {
        const name = decodeText(key);
        // const descriptorByName = /** @type {PDFArray|PDFName|undefined} */(colorSpaceDesignator.lookupMaybe(key, PDFName, PDFArray));
        const descriptorByName = lookupMaybe(colorSpaceDesignator, key, PDFName, PDFArray);

        if (!(name && descriptorByName)) continue;

        const record = uniqueColorSpaceRecords.getRecord(descriptorByName);
        if (!record) continue;

        colorSpaceDefinitions[name] = record.colorSpaceDefinition;
        colorSpaceDefinitionsCount++;
    }

    if (colorSpaceDefinitionsCount === 0) return undefined;

    return {
        type: /** @type {`${string}ColorSpaceDesignation`} */ (`${classifier}ColorSpaceDesignation`),
        colorSpaceDesignationTargetRef: ref,
        colorSpaceDesignationTarget: pageLeaf,
        colorSpaceDesignator: colorSpaceDesignator,
        colorSpaceDefinitions,
    };
}

/**
 * @typedef {{
 *   type: 'XObjectImage' | 'Page',
 *   target: PDFRawStream | PDFPageLeaf,
 *   currentColorSpace: any,
 *   newColorSpace: PDFName,
 *   colorSpaceKey?: string,
 * }} ColorSpaceReplacement
 */

/**
 * Replaces ICC-based color spaces with device color spaces (decalibration)
 * @param {PDFDocument} pdfDocument
 * @param {ColorSpaceAnalysisResult} analysisResult
 * @returns {ColorSpaceReplacement[]}
 */
export function replaceICCWithDeviceColorSpaces(pdfDocument, analysisResult) {
    const { colorSpaceDesignationTargetsLookup } = analysisResult;
    /** @type {ColorSpaceReplacement[]} */
    const replacements = [];

    for (const [colorSpaceDescriptor, colorSpaceDesignations] of colorSpaceDesignationTargetsLookup.entries()) {
        if (!isICCBasedColorSpace(/** @type {PDFArray} */(colorSpaceDescriptor))) continue;

        const profileRef = getICCProfileRefFromColorSpace(/** @type {PDFArray} */(colorSpaceDescriptor));
        if (!profileRef) continue;

        const profile = parseICCProfileFromRef(pdfDocument, profileRef);
        if (!profile) continue;

        if (!profile.header.colorSpace)
            throw new Error('ICC profile header missing colorSpace information.');

        const deviceColorSpace = getDeviceColorSpaceForICC(profile.header.colorSpace);

        if (!deviceColorSpace) continue;

        for (const designation of colorSpaceDesignations) {
            const replacement = applyColorSpaceReplacement(
                designation,
                colorSpaceDescriptor,
                deviceColorSpace
            );
            if (replacement) {
                replacements.push(replacement);
            }
        }
    }

    return replacements;
}

/**
 * Applies a color space replacement to a designation
 * @param {ColorSpaceDesignation} designation
 * @param {PDFArray | PDFName} colorSpaceDescriptor
 * @param {PDFName} newColorSpace
 * @returns {ColorSpaceReplacement | undefined}
 */
function applyColorSpaceReplacement(designation, colorSpaceDescriptor, newColorSpace) {
    switch (designation.type) {
        case 'XObjectImageColorSpaceDesignation': {
            const imageObject = /** @type {PDFRawStream} */ (designation.colorSpaceDesignationTarget);
            const currentColorSpace = imageObject.dict.get(PDFName.of('ColorSpace'));
            imageObject.dict.set(PDFName.of('ColorSpace'), newColorSpace);

            return {
                type: 'XObjectImage',
                target: imageObject,
                currentColorSpace,
                newColorSpace,
            };
        }
        case 'PageColorSpaceDesignation': {
            const pageLeaf = /** @type {PDFPageLeaf} */ (designation.colorSpaceDesignationTarget);
            // const resourcesDict = /** @type {PDFDict | undefined} */ (pageLeaf.lookupMaybe?.(PDFName.of('Resources'), PDFDict));
            const resourcesDict = lookupMaybe(pageLeaf, PDFName.of('Resources'), PDFDict);
            // const colorSpaceDict = /** @type {PDFDict | undefined} */ (resourcesDict?.lookupMaybe?.(PDFName.of('ColorSpace'), PDFDict));
            const colorSpaceDict = lookupMaybe(resourcesDict, PDFName.of('ColorSpace'), PDFDict);

            if (!colorSpaceDict || !designation.colorSpaceDefinitions) return undefined;

            for (const [key, definition] of Object.entries(designation.colorSpaceDefinitions)) {
                if (definition?.colorSpaceDescriptor !== colorSpaceDescriptor) continue;

                const pdfName = PDFName.of(key);
                const currentColorSpace = colorSpaceDict.get(pdfName);
                colorSpaceDict.set(pdfName, newColorSpace);

                return {
                    type: 'Page',
                    target: pageLeaf,
                    currentColorSpace,
                    newColorSpace,
                    colorSpaceKey: key,
                };
            }
            return undefined;
        }
        default:
            console.warn(`Unexpected color space designation type: ${designation.type}`);
            return undefined;
    }
}

// ============================================================================
// Content Stream Color Operator Parsing
// ============================================================================

/**
 * @typedef {'CS' | 'cs' | 'SC' | 'sc' | 'SCN' | 'scn' | 'G' | 'g' | 'RG' | 'rg' | 'K' | 'k'} ColorOperator
 */

/**
 * @typedef {{
 *   type: 'colorspace' | 'gray' | 'rgb' | 'cmyk' | 'indexed' | 'head' | 'string',
 *   operator?: ColorOperator,
 *   name?: string,
 *   values?: number[],
 *   value?: string,
 *   raw: string,
 *   index: number,
 * }} ContentStreamColorChunk
 */

/**
 * @typedef {{
 *   name: string,
 *   grayCount: number,
 *   rgbCount: number,
 *   cmykCount: number,
 *   indexedCount: number,
 * }} ColorSpaceUsage
 */

/**
 * @typedef {{
 *   chunks: ContentStreamColorChunk[],
 *   colorSpaces: ColorSpaceUsage[],
 *   text: string,
 * }} ContentStreamParseResult
 */

/**
 * Regular expression for parsing PDF content stream color operators.
 * 
 * Matches the following PDF operators:
 * - CS/cs: Set color space (stroke/fill)
 * - SC/sc/SCN/scn: Set color (stroke/fill, with optional name)
 * - G/g: Set gray (stroke/fill)
 * - RG/rg: Set RGB (stroke/fill)
 * - K/k: Set CMYK (stroke/fill)
 * 
 * Note: This regex is still being refined for edge cases.
 * Known limitations:
 * - May not handle all string literal formats correctly
 * - Complex nested structures may cause issues
 * 
 * @type {RegExp}
 */
// Note: Uses (?<=[\s\n]|^) lookbehind instead of \b word boundary to correctly match
// decimal numbers starting with '.' (e.g., ".95" instead of "0.95") which is valid PDF syntax.
export const COLOR_OPERATOR_REGEX = /(?<head>[^(]*?)(?:(?:(?<=[\s\n]|^)(?<name>\/\w+)\s+(?<csOp>CS|cs)\b)|(?:(?<=[\s\n]|^)(?<name2>\/\w+)\s+(?<scnOp>SCN|scn)\b)|(?:(?<=[\s\n]|^)(?<gray>(?:\d+\.?\d*|\.\d+))\s+(?<gOp>G|g)\b)|(?:(?<=[\s\n]|^)(?<cmyk>(?:\d+\.?\d*|\.\d+)\s+(?:\d+\.?\d*|\.\d+)\s+(?:\d+\.?\d*|\.\d+)\s+(?:\d+\.?\d*|\.\d+))\s+(?<kOp>K|k)\b)|(?:(?<=[\s\n]|^)(?<rgb>(?:\d+\.?\d*|\.\d+)\s+(?:\d+\.?\d*|\.\d+)\s+(?:\d+\.?\d*|\.\d+))\s+(?<rgOp>RG|rg)\b)|(?:(?<=[\s\n]|^)(?<n>(?:\d+\.?\d*|\.\d+)(?:\s+(?:\d+\.?\d*|\.\d+))*)\s+(?<scOp>SC|sc|SCN|scn)\b)|(?:\((?<string>[^)]*)\))|\s*$)/ug;

/**
 * Parses a PDF content stream to extract color operations.
 * 
 * @param {string} streamText - The decoded content stream text
 * @returns {ContentStreamParseResult}
 */
export function parseContentStreamColors(streamText) {
    /** @type {ContentStreamColorChunk[]} */
    const chunks = [];
    /** @type {ColorSpaceUsage[]} */
    const colorSpaces = [];
    // Track SEPARATE stroke and fill color space contexts
    // Stroke: set by CS (uppercase), used by SC/SCN (uppercase)
    // Fill: set by cs (lowercase), used by sc/scn (lowercase)
    /** @type {ColorSpaceUsage | undefined} */
    let currentStrokeColorSpace;
    /** @type {ColorSpaceUsage | undefined} */
    let currentFillColorSpace;

    const matches = Array.from(streamText.matchAll(COLOR_OPERATOR_REGEX));

    for (const match of matches) {
        const {
            head,
            name, name2,
            csOp, scnOp, gOp, kOp, rgOp, scOp,
            gray, cmyk, rgb, n,
            string
        } = match.groups ?? {};

        const matchIndex = match.index ?? 0;
        const headLength = head?.length ?? 0;
        // Color operations start after the head content
        const colorIndex = matchIndex + headLength;
        // The full match length (including head)
        const fullMatchLength = match[0].length;
        // Color operation length (excluding head)
        const colorOpLength = fullMatchLength - headLength;

        // Non-color content
        if (head?.trim()) {
            chunks.push({ type: 'head', value: head, raw: head, index: matchIndex });
        }

        // String literal (skip for color processing)
        if (string !== undefined) {
            chunks.push({ type: 'string', value: string, raw: `(${string})`, index: colorIndex });
            continue;
        }

        // Color space operator (CS/cs)
        if (csOp && name) {
            const isStroke = csOp === 'CS';
            chunks.push({
                type: 'colorspace',
                operator: /** @type {ColorOperator} */ (csOp),
                name,
                raw: streamText.slice(colorIndex, colorIndex + colorOpLength),
                index: colorIndex,
            });
            const newColorSpace = {
                name,
                grayCount: 0,
                rgbCount: 0,
                cmykCount: 0,
                indexedCount: 0
            };
            // Update the appropriate context (stroke vs fill)
            if (isStroke) {
                currentStrokeColorSpace = newColorSpace;
            } else {
                currentFillColorSpace = newColorSpace;
            }
            colorSpaces.push(newColorSpace);
            continue;
        }

        // Gray operator (G/g)
        if (gOp && gray !== undefined) {
            const isStroke = gOp === 'G';
            const currentColorSpace = isStroke ? currentStrokeColorSpace : currentFillColorSpace;
            const values = [parseFloat(gray)];
            chunks.push({
                type: 'gray',
                operator: /** @type {ColorOperator} */ (gOp),
                values,
                raw: streamText.slice(colorIndex, colorIndex + colorOpLength),
                index: colorIndex,
            });
            if (currentColorSpace) currentColorSpace.grayCount++;
            continue;
        }

        // RGB operator (RG/rg)
        if (rgOp && rgb) {
            const isStroke = rgOp === 'RG';
            const currentColorSpace = isStroke ? currentStrokeColorSpace : currentFillColorSpace;
            const values = rgb.split(/\s+/).map(parseFloat);
            chunks.push({
                type: 'rgb',
                operator: /** @type {ColorOperator} */ (rgOp),
                values,
                raw: streamText.slice(colorIndex, colorIndex + colorOpLength),
                index: colorIndex,
            });
            if (currentColorSpace) currentColorSpace.rgbCount++;
            continue;
        }

        // CMYK operator (K/k)
        if (kOp && cmyk) {
            const isStroke = kOp === 'K';
            const currentColorSpace = isStroke ? currentStrokeColorSpace : currentFillColorSpace;
            const values = cmyk.split(/\s+/).map(parseFloat);
            chunks.push({
                type: 'cmyk',
                operator: /** @type {ColorOperator} */ (kOp),
                values,
                raw: streamText.slice(colorIndex, colorIndex + colorOpLength),
                index: colorIndex,
            });
            if (currentColorSpace) currentColorSpace.cmykCount++;
            continue;
        }

        // Indexed/Named color operator (SC/sc/SCN/scn)
        if ((scOp || scnOp) && (n || name2)) {
            const operator = /** @type {ColorOperator} */ (scOp || scnOp);
            // Determine if this is a stroke (SC/SCN) or fill (sc/scn) operation
            const isStroke = operator === 'SC' || operator === 'SCN';
            const currentColorSpace = isStroke ? currentStrokeColorSpace : currentFillColorSpace;
            // Use actual matched text to preserve whitespace
            const rawText = streamText.slice(colorIndex, colorIndex + colorOpLength);
            if (name2) {
                // Named color space reference
                chunks.push({
                    type: 'indexed',
                    operator,
                    name: name2,
                    raw: rawText,
                    index: colorIndex,
                });
            } else if (n) {
                // Numeric color values
                const values = n.split(/\s+/).map(parseFloat);
                chunks.push({
                    type: 'indexed',
                    operator,
                    values,
                    raw: rawText,
                    index: colorIndex,
                    // Include current color space name from preceding CS/cs operator
                    // CRITICAL: Use the correct context (stroke vs fill)
                    name: currentColorSpace?.name,
                });
            }
            if (currentColorSpace) currentColorSpace.indexedCount++;
            continue;
        }
    }

    return { chunks, colorSpaces, text: streamText };
}

/**
 * Extracts page content streams from a PDFPageLeaf
 * 
 * @param {PDFPageLeaf} pageLeaf
 * @param {PDFDocument} pdfDocument
 * @returns {{ rawStreams: PDFRawStream[], contents: Array<PDFRawStream | any> }}
 */
export function extractPageContentStreams(pageLeaf, pdfDocument) {
    const contentsObject = pageLeaf.lookup(PDFName.of('Contents'));
    /** @type {PDFRawStream[]} */
    const rawStreams = [];
    /** @type {Array<PDFRawStream | any>} */
    const contents = [];

    if (contentsObject instanceof PDFRawStream) {
        rawStreams.push(contentsObject);
        contents.push(contentsObject);
    } else if (contentsObject instanceof PDFArray) {
        for (let i = 0; i < contentsObject.size(); i++) {
            const entry = contentsObject.lookup(i);
            const entryObject = entry instanceof PDFRef
                ? pdfDocument.context.lookup(entry)
                : entry;

            if (entryObject instanceof PDFRawStream) {
                rawStreams.push(entryObject);
                contents.push(entryObject);
            } else if (entryObject) {
                contents.push(entryObject);
            }
        }
    } else if (contentsObject) {
        contents.push(contentsObject);
    }

    return { rawStreams, contents };
}

/**
 * Decodes a PDFRawStream to text and parses its color operations
 * 
 * @param {PDFRawStream} rawStream
 * @returns {{ text: string, bytes: Uint8Array, parseResult: ContentStreamParseResult }}
 */
export function decodeAndParseContentStream(rawStream) {
    const bytes = /** @type {Uint8Array} */ (decodePDFRawStream(rawStream).decode());
    const text = bytesAsString(bytes);
    const parseResult = parseContentStreamColors(text);

    return { text, bytes, parseResult };
}

/**
 * @typedef {{
 *   pageLeaf: PDFPageLeaf,
 *   pageLeafRef: PDFRef,
 *   resourcesDict: PDFDict | undefined,
 *   colorSpaceDict: PDFDict | undefined,
 *   contentStreams: { rawStreams: PDFRawStream[], contents: Array<any> },
 *   parsedStreams: Array<{ stream: PDFRawStream, text: string, bytes: Uint8Array, parseResult: ContentStreamParseResult }>,
 * }} PageColorAnalysis
 */

/**
 * Analyzes color operations in a page's content streams
 * 
 * @param {PDFPageLeaf} pageLeaf
 * @param {PDFRef} pageLeafRef
 * @param {PDFDocument} pdfDocument
 * @returns {PageColorAnalysis}
 */
export function analyzePageColors(pageLeaf, pageLeafRef, pdfDocument) {
    const resourcesDict = /** @type {PDFDict | undefined} */ (
        pageLeaf.lookupMaybe(PDFName.of('Resources'), PDFDict)
    );
    const colorSpaceDict = /** @type {PDFDict | undefined} */ (
        resourcesDict?.lookupMaybe(PDFName.of('ColorSpace'), PDFDict)
    );

    const contentStreams = extractPageContentStreams(pageLeaf, pdfDocument);

    const parsedStreams = contentStreams.rawStreams.map(stream => ({
        stream,
        ...decodeAndParseContentStream(stream),
    }));

    return {
        pageLeaf,
        pageLeafRef,
        resourcesDict,
        colorSpaceDict,
        contentStreams,
        parsedStreams,
    };
}

/**
 * Collects all color values from parsed content streams that need conversion
 *
 * @param {PageColorAnalysis} pageAnalysis
 * @returns {Array<{ chunk: ContentStreamColorChunk, streamIndex: number }>}
 */
export function collectColorValuesForConversion(pageAnalysis) {
    /** @type {Array<{ chunk: ContentStreamColorChunk, streamIndex: number }>} */
    const colorValues = [];

    for (let streamIndex = 0; streamIndex < pageAnalysis.parsedStreams.length; streamIndex++) {
        const { parseResult } = pageAnalysis.parsedStreams[streamIndex];

        for (const chunk of parseResult.chunks) {
            if (chunk.type === 'gray' || chunk.type === 'rgb' || chunk.type === 'cmyk') {
                colorValues.push({ chunk, streamIndex });
            }
        }
    }

    return colorValues;
}

// ============================================================================
// Content Stream Color Replacement
// ============================================================================

/**
 * @typedef {{
 *   chunk: ContentStreamColorChunk,
 *   newValues: number[],
 *   newType: 'gray' | 'rgb' | 'cmyk',
 * }} ColorReplacement
 */

/**
 * @typedef {{
 *   originalText: string,
 *   newText: string,
 *   replacementCount: number,
 * }} ContentStreamReplacementResult
 */

/**
 * Gets the operator for a given color type
 * @param {'gray' | 'rgb' | 'cmyk'} colorType
 * @param {boolean} isStroke - Whether this is a stroke (uppercase) or fill (lowercase) operator
 * @returns {string}
 */
export function getOperatorForColorType(colorType, isStroke) {
    switch (colorType) {
        case 'gray': return isStroke ? 'G' : 'g';
        case 'rgb': return isStroke ? 'RG' : 'rg';
        case 'cmyk': return isStroke ? 'K' : 'k';
        default: throw new Error(`Unknown color type: ${colorType}`);
    }
}

/**
 * Formats color values for PDF content stream
 * @param {number[]} values
 * @returns {string}
 */
export function formatColorValues(values) {
    return values.map(v => {
        // Format to reasonable precision, avoiding unnecessary decimal places
        const formatted = v.toFixed(6).replace(/\.?0+$/, '');
        return formatted === '' ? '0' : formatted;
    }).join(' ');
}

/**
 * Determines if an operator is a stroke operator (uppercase)
 * @param {string} operator
 * @returns {boolean}
 */
export function isStrokeOperator(operator) {
    return operator === operator.toUpperCase();
}

/**
 * Replaces color operations in a content stream with converted values
 *
 * This function takes the original stream text and a list of color replacements,
 * then builds a new stream with the colors replaced.
 *
 * @param {string} originalText - The original content stream text
 * @param {ColorReplacement[]} replacements - Array of color replacements to apply
 * @returns {ContentStreamReplacementResult}
 */
export function replaceContentStreamColors(originalText, replacements) {
    if (replacements.length === 0) {
        return {
            originalText,
            newText: originalText,
            replacementCount: 0,
        };
    }

    // Sort replacements by index in descending order to process from end to start
    // This way, replacing earlier doesn't affect the indices of later replacements
    const sortedReplacements = [...replacements].sort((a, b) => b.chunk.index - a.chunk.index);

    let newText = originalText;
    let replacementCount = 0;

    for (const replacement of sortedReplacements) {
        const { chunk, newValues, newType } = replacement;

        if (chunk.index === undefined || !chunk.raw) continue;

        const isStroke = isStrokeOperator(chunk.operator ?? '');
        const newOperator = getOperatorForColorType(newType, isStroke);
        const newColorString = `${formatColorValues(newValues)} ${newOperator}`;

        // Replace the original color operation with the new one
        const before = newText.slice(0, chunk.index);
        const after = newText.slice(chunk.index + chunk.raw.length);
        newText = before + newColorString + after;
        replacementCount++;
    }

    return {
        originalText,
        newText,
        replacementCount,
    };
}

/**
 * Encodes a content stream back to PDF bytes
 * @param {string} text - The content stream text
 * @returns {Uint8Array}
 */
export function encodeContentStreamText(text) {
    const bytes = new Uint8Array(text.length);
    copyStringIntoBuffer(text, bytes, 0);
    return bytes;
}

/**
 * Creates a new PDFRawStream with the given content
 *
 * @param {PDFDocument} pdfDocument
 * @param {Uint8Array} content
 * @returns {PDFRawStream}
 */
export function createContentStream(pdfDocument, content) {
    // Create the stream with the new content (uncompressed)
    // The PDF spec allows uncompressed content streams
    return pdfDocument.context.stream(content, {});
}

// ============================================================================
// Image Processing Utilities
// ============================================================================

/**
 * @typedef {{
 *   width: number,
 *   height: number,
 *   bitsPerComponent: number,
 *   colorSpace: string,
 *   colorSpaceType: string,
 *   componentsPerPixel: number,
 *   filter: string | null,
 * }} ImageMetadata
 */

/**
 * @typedef {{
 *   metadata: ImageMetadata,
 *   pixels: Uint8Array,
 *   rawStream: PDFRawStream,
 * }} ExtractedImage
 */

/**
 * Extracts metadata from a PDF image XObject
 * @param {PDFRawStream} imageStream
 * @returns {ImageMetadata}
 */
export function extractImageMetadata(imageStream) {
    const dict = imageStream.dict;

    const width = /** @type {import('pdf-lib').PDFNumber | undefined} */
        (dict.get(PDFName.of('Width')))?.asNumber() ?? 0;
    const height = /** @type {import('pdf-lib').PDFNumber | undefined} */
        (dict.get(PDFName.of('Height')))?.asNumber() ?? 0;
    const bitsPerComponent = /** @type {import('pdf-lib').PDFNumber | undefined} */
        (dict.get(PDFName.of('BitsPerComponent')))?.asNumber() ?? 8;

    // Get color space
    const colorSpaceObj = dict.get(PDFName.of('ColorSpace'));
    let colorSpace = 'Unknown';
    let colorSpaceType = 'Unknown';
    let componentsPerPixel = 3;

    if (colorSpaceObj instanceof PDFName) {
        colorSpace = colorSpaceObj.decodeText();
        colorSpaceType = colorSpace;
        componentsPerPixel = getComponentsForColorSpace(colorSpace);
    } else if (colorSpaceObj instanceof PDFArray) {
        const csType = /** @type {PDFName | undefined} */ (colorSpaceObj.get(0));
        colorSpaceType = csType?.decodeText() ?? 'Unknown';
        colorSpace = colorSpaceType;

        // For ICCBased, get N from the ICC profile stream dict
        if (colorSpaceType === 'ICCBased' && colorSpaceObj.size() > 1) {
            const iccStreamRef = colorSpaceObj.get(1);
            if (iccStreamRef instanceof PDFRawStream) {
                const n = iccStreamRef.dict.get(PDFName.of('N'));
                if (n && typeof n.asNumber === 'function') {
                    componentsPerPixel = n.asNumber();
                }
            } else if (iccStreamRef instanceof PDFRef) {
                // Would need context to look up - fall back to default
                componentsPerPixel = 3;
            }
        } else {
            componentsPerPixel = getComponentsForColorSpace(colorSpaceType);
        }
    }

    // Get filter
    const filterObj = dict.get(PDFName.of('Filter'));
    let filter = null;
    if (filterObj instanceof PDFName) {
        filter = filterObj.decodeText();
    } else if (filterObj instanceof PDFArray && filterObj.size() > 0) {
        const firstFilter = filterObj.get(0);
        if (firstFilter instanceof PDFName) {
            filter = firstFilter.decodeText();
        }
    }

    return {
        width,
        height,
        bitsPerComponent,
        colorSpace,
        colorSpaceType,
        componentsPerPixel,
        filter,
    };
}

/**
 * Gets the number of components for a color space
 * @param {string} colorSpace
 * @returns {number}
 */
export function getComponentsForColorSpace(colorSpace) {
    switch (colorSpace) {
        case 'DeviceGray':
        case 'CalGray':
            return 1;
        case 'DeviceRGB':
        case 'CalRGB':
        case 'Lab':
            return 3;
        case 'DeviceCMYK':
            return 4;
        case 'ICCBased':
            // For ICCBased, we'll need to look at the ICC profile
            // Default to 3 (RGB) if not specified
            return 3;
        case 'Indexed':
            // Indexed color spaces are 1 component (index value)
            return 1;
        default:
            return 3;
    }
}

/**
 * Extracts pixel data from a PDF image XObject
 *
 * Note: Currently only supports uncompressed and FlateDecode images.
 * DCTDecode (JPEG) and other complex formats are not modified.
 *
 * Supports both 8-bit and 16-bit images. 16-bit images are converted to 8-bit
 * by taking the high byte of each 16-bit value (big-endian).
 *
 * @param {PDFRawStream} imageStream
 * @returns {ExtractedImage | null} Returns null if the image format is not supported
 */
export function extractImagePixels(imageStream) {
    const metadata = extractImageMetadata(imageStream);

    // Only support uncompressed and FlateDecode for now
    if (metadata.filter && metadata.filter !== 'FlateDecode') {
        // DCTDecode (JPEG), JPXDecode (JPEG2000), etc. are not supported
        // These would require re-encoding which is complex
        return null;
    }

    // Support 8-bit and 16-bit images
    if (metadata.bitsPerComponent !== 8 && metadata.bitsPerComponent !== 16) {
        return null;
    }

    try {
        // Decode the stream
        const decoded = decodePDFRawStream(imageStream);
        let rawPixels = /** @type {Uint8Array} */ (decoded.decode());

        // Handle 16-bit images by converting to 8-bit
        // PDF uses big-endian encoding: high byte first, low byte second
        let pixels;
        if (metadata.bitsPerComponent === 16) {
            // Convert 16-bit to 8-bit by taking high byte
            const numValues = rawPixels.length / 2;
            pixels = new Uint8Array(numValues);
            for (let i = 0; i < numValues; i++) {
                // Read 16-bit value (big-endian: high byte at i*2, low byte at i*2+1)
                // Take just the high byte for 8-bit conversion
                pixels[i] = rawPixels[i * 2];
            }
            // Update metadata to reflect 8-bit output
            metadata.bitsPerComponent = 8;
        } else {
            pixels = rawPixels;
        }

        // Calculate actual components from pixel data size
        const pixelCount = metadata.width * metadata.height;
        const actualComponentsPerPixel = pixelCount > 0 ? Math.round(pixels.length / pixelCount) : metadata.componentsPerPixel;

        // Update metadata if we can determine actual component count
        if (actualComponentsPerPixel !== metadata.componentsPerPixel && [1, 3, 4].includes(actualComponentsPerPixel)) {
            metadata.componentsPerPixel = actualComponentsPerPixel;
        }

        return {
            metadata,
            pixels,
            rawStream: imageStream,
        };
    } catch (error) {
        console.warn('Failed to extract image pixels:', error);
        return null;
    }
}

/**
 * Updates an image stream with new pixel data
 *
 * @param {PDFRawStream} imageStream - The original image stream to update
 * @param {Uint8Array} newPixels - The new pixel data
 * @param {PDFName} newColorSpace - The new color space
 * @param {number} [bitsPerComponent=8] - Bits per component for the output image
 * @param {boolean} [compress=false] - Whether to apply FlateDecode compression
 * @returns {Promise<void>}
 */
export async function updateImageStream(imageStream, newPixels, newColorSpace, bitsPerComponent = 8, compress = false) {
    const dict = imageStream.dict;

    // Optionally compress the data
    let outputData = newPixels;
    let useFilter = false;

    if (compress) {
        const result = await compressWithFlateDecode(newPixels);
        outputData = result.compressed;
        useFilter = result.wasCompressed;
    }

    // Update the stream contents
    // @ts-ignore - Accessing internal property
    imageStream.contents = outputData;

    // Set the new color space
    dict.set(PDFName.of('ColorSpace'), newColorSpace);

    // Update bits per component (important for 16-bit to 8-bit conversions)
    dict.set(PDFName.of('BitsPerComponent'), dict.context.obj(bitsPerComponent));

    // Set or remove filter based on compression
    if (useFilter) {
        dict.set(PDFName.of('Filter'), PDFName.of('FlateDecode'));
    } else {
        dict.delete(PDFName.of('Filter'));
    }
    dict.delete(PDFName.of('DecodeParms'));

    // Update length
    dict.set(PDFName.of('Length'), dict.context.obj(outputData.length));
}
