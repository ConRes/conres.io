// @ts-check

import { PDFService } from "../PDFService.js";
import { lookupMaybe, decodeText } from "../helpers/pdf-lib.js";
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
} from "pdf-lib";

const DEBUG_COLORSPACE_DESIGNATION_TARGET_OPERATIONS = false;

import { UniqueColorSpaceRecords } from "../ColorSpaceUtils.js";

/**
 * @typedef {Exclude<ReturnType<UniqueColorSpaceRecords['createColorSpaceDefinitionFrom']>, undefined>} ColorSpaceDefinition
 */
/**
 * @typedef {{
 *   type: `${string}ColorSpaceDesignation`,
 *   colorSpaceDesignationTargetRef: PDFRef,
 *   colorSpaceDesignationTarget: PDFRawStream,
 *   colorSpaceDesignator: PDFArray | PDFName,
 *   colorSpaceDefinition?: ColorSpaceDefinition,
 * }} RawStreamColorSpaceDesignation
 */
/**
 * @typedef {{
 *  type: `${string}ColorSpaceDesignation`,
 *  colorSpaceDesignationTargetRef: PDFRef,
 *  colorSpaceDesignationTarget: PDFPageLeaf,
 *  colorSpaceDesignator: PDFArray | PDFName | PDFDict,
 *  colorSpaceDefinitions: Record<string, ColorSpaceDefinition>,
 * }} PageLeafColorSpaceDesignation
 */
/**
 * @typedef {RawStreamColorSpaceDesignation | PageLeafColorSpaceDesignation} ColorSpaceDesignation
 */

export class LegacyPDFService extends PDFService {
    /**
     * Legacy version of decalibratePDFDocument that preserves the original verbose debugging.
     * Use decalibratePDFDocument for production, this method for debugging.
     * 
     * @param {PDFDocument} pdfDocument
     * @param {object} [options]
     * @param {boolean} [options.verbose] - Whether to log detailed information about the decalibration process.
     * @deprecated Use decalibratePDFDocument instead
     */
    static async decalibrateColorInPDFDocumentLegacy(pdfDocument, options) {
        /*

        We are trying to find all objects with a /ColorSpace key in their PDFDict.
        
        We know that currently this is found on the following objects:

        - PDFRawStream objects with /Type = /XObject and /Subtype = /Image and a /ColorSpace key.
        - PDFPageLeaf objects with /Resources key, which is a PDFDict that contains a /ColorSpace key.
        

        In that sense, we can consider those objects the ColorSpaceDesignationTarget objects within which we can find a respective 
        ColorSpaceDesignation a /ColorSpace key that points to some ColorSpaceDefinition.

        We can stipulate the following ColorSpaceDesignation classifications:

        - XObjectImageColorSpaceDesignation:
          - A PDFRef to a ColorSpaceDefinition for the /ColorSpace key of an /XObject /Image PDFRawStream

        - ResourcesDictColorSpaceDesignation:
          - A PDFDict containing a PDFRef to a ColorSpaceDefinition for /CS0 or /CS1 keys for the /ColorSpace key of the /Resources PDFDict of a PDFPageLeaf

        We can stipulate the following ColorSpaceDefinition forms:

        - DeviceColorSpaceDefinition:
          - The PDFName /DeviceRGB, /DeviceCMYK, /DeviceGray, or potentially others.

        - ICCBasedColorSpaceDefinition:
          - A two-element PDFArray tuple of the /ICCBased PDF name and a PDFRef to a PDFRawStream object that contains the ICC profile data

        - LabColorSpaceDefinition:
          - A PDFArray tuple of the /Lab PDF name and a PDFRef to a PDFDict with PDFArrays for the /BlackPoint, /WhitePoint, and /Range keys.

        - SeparationColorSpaceDefinition:
          - A three-element PDFArray tuple of the /Separation PDF name, the PDFName for the colorant name, and the PDFName for the device color space.
          - A four-element PDFArray tuple of the /Separation PDF name, the PDFName for the colorant name, the PDFName for the device color space, and a PDFDict of a mapping function.

        We can further classify the ColorSpaceDefinition forms into two groups:

        - CalibratedColorSpaceDefinition:
            - ICCBasedColorSpaceDefinition
        
        - DeviceColorSpaceDefinition:
            - DeviceColorSpaceDefinition

        To decalibrate the PDF document, we need to do the following:

        - For each ColorSpaceDesignationTarget
            - Insert the ColorSpaceDesignationTarget and ColorSpaceDefinition pair in the respective ObjectsByColorSpaceTypeMap

        - For each ColorSpaceDesignationTarget and CalibratedColorSpaceDefinition pair
            - If the ColorSpaceDefinition is an ICCBasedColorSpaceDefinition
                - Find the PDFRawStream object that contains the ICC profile
                - Parse the header of the ICC profile to determine its colorSpace
                - Replace the ColorSpaceDefinition with the respective DeviceColorSpaceDefinition
                  - The PDFName /DeviceGray replaces the ICCBasedColorSpaceDefinition for which the colorSpace in the ICC profile header is GRAY
                  - The PDFName /DeviceRGB replaces the ICCBasedColorSpaceDefinition for which the colorSpace in the ICC profile header is RGB
                  - The PDFName /DeviceCMYK replaces the ICCBasedColorSpaceDefinition for which the colorSpace in the ICC profile header is CMYK
        
        */

        /**
         * @template {PDFDict | PDFDocument | PDFRawStream | PDFArray | PDFRef | PDFName | PDFString | PDFPageLeaf} [T = PDFDict | PDFDocument | PDFRawStream | PDFArray | PDFRef | PDFName | PDFString | PDFPageLeaf]
         * @typedef {T} PDFObjectInstance<T>
         */

        const uniqueColorSpaceRecords = new UniqueColorSpaceRecords(pdfDocument);

        const enumeratedIndirectObjects = /** @type {[PDFRef, any][]} */ (pdfDocument.context.enumerateIndirectObjects());

        /** @type {Record<string, Map<PDFRawStream, ColorSpaceDesignation>>} */
        const colorSpaceDesignationTargetsByClassifier = {};
        const colorSpaceDesignationTargetsLookup = new Map();
        const colorSpaceDesignationTargetOperationRecords = [];

        // console.time('ColorSpaceDesignationTargetOperationRecords');

        for (const [enumeratedRef, enumeratedObject] of enumeratedIndirectObjects) {
            /**
             * @typedef {{
             *   isComplete: boolean,
             *   isRelevant: boolean,
             *   enumeratedObjectRef: PDFRef,
             *   enumeratedObject: PDFRawStream | PDFPageLeaf,
             *   enumeratedRawStream: PDFRawStream,
             *   enumeratedRawStreamType: PDFName | undefined,
             *   enumeratedRawStreamSubtype: PDFName | undefined,
             *   enumeratedRawStreamClassifier?: string | undefined,
             *   colorSpaceDesignator: PDFArray | PDFName | PDFDict | undefined,
             *   colorSpaceDesignationType: `${string}ColorSpaceDesignation` | undefined,
             *   colorSpaceDesignation: ColorSpaceDesignation,
             *   colorSpaceDefinitionsCount: number,
             *   error?: Error,
             * }} RawStreamRecord
             */
            /**
             * @typedef {{
             *   isComplete: boolean,
             *   isRelevant: boolean,
             *   enumeratedObjectRef: PDFRef,
             *   enumeratedObject: PDFPageLeaf,
             *   enumeratedPageLeaf: PDFPageLeaf,
             *   enumeratedPageLeafType: PDFName | undefined,
             *   enumeratedPageLeafSubtype: PDFName | undefined,
             *   enumeratedPageLeafClassifier: string | undefined,
             *   enumeratedPageLeafResourcesDict: PDFDict | undefined,
             *   colorSpaceDesignator: PDFArray | PDFName | PDFDict | undefined,
             *   colorSpaceDesignationType: `${string}ColorSpaceDesignation` | undefined,
             *   colorSpaceDesignation: ColorSpaceDesignation,
             *   colorSpaceDefinitionsCount: number | undefined,
             *   lastColorSpaceDesignatorKey: PDFName,
             *   lastColorSpaceDescriptor: PDFRef | PDFName,
             *   lastColorSpaceDefinition: ColorSpaceDefinition,
             *   colorSpaceDesignatorEntries: {
             *     colorSpaceDesignatorKey: PDFName,
             *     colorSpaceDescriptor: PDFRef | PDFName,
             *     colorSpaceDescriptorByName: PDFName | PDFArray,
             *     colorSpaceDesignatorName: string,
             *     colorSpaceDefinition?: ColorSpaceDefinition,
             *   }[],
             *   error?: Error,
             * }} PageLeafRecord
             */
            /** @typedef {RawStreamRecord | PageLeafRecord} Record */
            /** @type {Partial<Record>?} */
            const record = DEBUG_COLORSPACE_DESIGNATION_TARGET_OPERATIONS ? {} : null;

            if (record) {
                colorSpaceDesignationTargetOperationRecords?.push?.(record);
                record.isComplete = false;
                record.isRelevant = false;
                record.enumeratedObjectRef = enumeratedRef;
                record.enumeratedObject = enumeratedObject;
            }

            try {
                if (enumeratedObject instanceof PDFRawStream) {
                    const rawStreamRecord = /** @type {RawStreamRecord} */ (record ?? {});
                    const enumeratedRawStream = /** @type {PDFRawStream} */ (enumeratedObject);
                    const enumeratedRawStreamDict = /** @type {PDFDict} */ (enumeratedRawStream.dict);
                    const enumeratedRawStreamType = /** @type {PDFName | undefined} */ (enumeratedRawStreamDict.get(PDFName.of('Type')));
                    const enumeratedRawStreamSubtype = /** @type {PDFName | undefined} */ (enumeratedRawStreamDict.get(PDFName.of('Subtype')));
                    const enumeratedRawStreamClassifier = `${decodeText(enumeratedRawStreamType) ?? ''}${decodeText(enumeratedRawStreamSubtype) ?? ''}` || undefined;
                    // const colorSpaceDesignator = /** @type {PDFArray|PDFName|undefined} */(enumeratedRawStreamDict.lookupMaybe(PDFName.of('ColorSpace'), PDFName, PDFArray));
                    const colorSpaceDesignator = lookupMaybe(enumeratedRawStreamDict, PDFName.of('ColorSpace'), PDFName, PDFArray);
                    const colorSpaceDesignationType = /** @type {`${string}ColorSpaceDesignation` | undefined} */(enumeratedRawStreamClassifier && `${enumeratedRawStreamClassifier}ColorSpaceDesignation`);

                    if (rawStreamRecord) {
                        rawStreamRecord.enumeratedRawStream = enumeratedRawStream;
                        rawStreamRecord.enumeratedRawStreamType = enumeratedRawStreamType;
                        rawStreamRecord.enumeratedRawStreamSubtype = enumeratedRawStreamSubtype;
                        rawStreamRecord.enumeratedRawStreamClassifier = enumeratedRawStreamClassifier;
                        rawStreamRecord.colorSpaceDesignator = colorSpaceDesignator;
                        rawStreamRecord.colorSpaceDesignationType = colorSpaceDesignationType;
                    }

                    if (!(colorSpaceDesignationType && colorSpaceDesignator)) continue;

                    if (rawStreamRecord) rawStreamRecord.isRelevant = true;

                    // const uniqueColorSpaceRecord = getUniqueColorSpaceRecordFrom(colorSpaceDesignator, pdfDocument);
                    const uniqueColorSpaceRecord = uniqueColorSpaceRecords.getRecord(colorSpaceDesignator);

                    if (!uniqueColorSpaceRecord) throw new Error(`Unexpected unique color space record.`);

                    /** @type {RawStreamColorSpaceDesignation} */
                    const colorSpaceDesignation = {
                        type: colorSpaceDesignationType,
                        colorSpaceDesignationTargetRef: enumeratedRef,
                        colorSpaceDesignationTarget: enumeratedRawStream,
                        colorSpaceDesignator: colorSpaceDesignator,
                        colorSpaceDefinition: uniqueColorSpaceRecord.colorSpaceDefinition,
                    };

                    if (rawStreamRecord) {
                        rawStreamRecord.colorSpaceDesignation = colorSpaceDesignation;
                        rawStreamRecord.colorSpaceDefinitionsCount = 1;
                    }

                    (colorSpaceDesignationTargetsByClassifier[enumeratedRawStreamClassifier] ??= new Map()).set(enumeratedObject, colorSpaceDesignation);

                    if (rawStreamRecord) rawStreamRecord.isComplete = true;

                    colorSpaceDesignation?.colorSpaceDefinition?.colorSpaceDescriptor && (
                        colorSpaceDesignationTargetsLookup.has(colorSpaceDesignation.colorSpaceDefinition.colorSpaceDescriptor)
                        || colorSpaceDesignationTargetsLookup.set(colorSpaceDesignation.colorSpaceDefinition.colorSpaceDescriptor, new Set()),
                        colorSpaceDesignationTargetsLookup.get(colorSpaceDesignation.colorSpaceDefinition.colorSpaceDescriptor)?.add(colorSpaceDesignation)
                    );
                } else if (enumeratedObject instanceof PDFPageLeaf) {
                    const pageLeafRecord = /** @type {PageLeafRecord} */ (record ?? {});
                    const enumeratedPageLeaf = /** @type {PDFPageLeaf} */ (enumeratedObject);
                    const enumeratedPageLeafType = /** @type {PDFName | undefined} */ (enumeratedPageLeaf.get(PDFName.of('Type')));
                    const enumeratedPageLeafSubtype = /** @type {PDFName | undefined} */ (enumeratedPageLeaf.get(PDFName.of('Subtype')));
                    const enumeratedPageLeafClassifier = `${decodeText(enumeratedPageLeafType) ?? ''}${decodeText(enumeratedPageLeafSubtype) ?? ''}` || undefined;
                    const enumeratedPageLeafResourcesDict = /** @type {PDFDict | undefined} */ (enumeratedPageLeaf.lookupMaybe(PDFName.of('Resources'), PDFDict));
                    const colorSpaceDesignator = enumeratedPageLeafResourcesDict?.lookupMaybe?.(PDFName.of('ColorSpace'), PDFDict);
                    const colorSpaceDesignationType = /** @type {`${string}ColorSpaceDesignation` | undefined} */(enumeratedPageLeafClassifier && `${enumeratedPageLeafClassifier}ColorSpaceDesignation`);

                    if (pageLeafRecord) {
                        pageLeafRecord.enumeratedPageLeaf = enumeratedPageLeaf;
                        pageLeafRecord.enumeratedPageLeafType = enumeratedPageLeafType;
                        pageLeafRecord.enumeratedPageLeafSubtype = enumeratedPageLeafSubtype;
                        pageLeafRecord.enumeratedPageLeafClassifier = enumeratedPageLeafClassifier;
                        pageLeafRecord.enumeratedPageLeafResourcesDict = enumeratedPageLeafResourcesDict;
                        pageLeafRecord.colorSpaceDesignator = colorSpaceDesignator;
                        pageLeafRecord.colorSpaceDesignationType = colorSpaceDesignationType;
                    }

                    if (!(colorSpaceDesignationType && colorSpaceDesignator)) continue;

                    if (pageLeafRecord) pageLeafRecord.isRelevant = true;

                    /** @type {PageLeafColorSpaceDesignation} */
                    const colorSpaceDesignation = {
                        type: colorSpaceDesignationType,
                        colorSpaceDesignationTargetRef: enumeratedRef,
                        colorSpaceDesignationTarget: enumeratedPageLeaf,
                        colorSpaceDesignator,
                        colorSpaceDefinitions: {},
                    };

                    if (pageLeafRecord) {
                        pageLeafRecord.colorSpaceDesignation = colorSpaceDesignation;
                        pageLeafRecord.colorSpaceDefinitionsCount = undefined;
                    }

                    let colorSpaceDefinitionsCount = 0;

                    for (const [colorSpaceDesignatorKey, colorSpaceDescriptor] of /** @type {MapIterator<[PDFName, PDFRef | PDFName]>} */(colorSpaceDesignator.asMap().entries())) {
                        if (pageLeafRecord) {
                            pageLeafRecord.lastColorSpaceDesignatorKey = colorSpaceDesignatorKey;
                            pageLeafRecord.lastColorSpaceDescriptor = colorSpaceDescriptor;
                        }

                        const colorSpaceDesignatorName = decodeText(colorSpaceDesignatorKey);
                        // const colorSpaceDescriptorByName = /** @type {PDFArray|PDFName|undefined} */(colorSpaceDesignator.lookupMaybe(colorSpaceDesignatorKey, PDFName, PDFArray));
                        const colorSpaceDescriptorByName = lookupMaybe(colorSpaceDesignator, colorSpaceDesignatorKey, PDFName, PDFArray);

                        if (!(colorSpaceDesignatorName && colorSpaceDescriptorByName)) {
                            console.warn(new Error(`Unexpected color space designator name or descriptor by name: ${colorSpaceDesignatorName}, ${colorSpaceDescriptorByName}`));
                            continue;
                        }

                        // const uniqueColorSpaceRecord = getUniqueColorSpaceRecordFrom(colorSpaceDescriptorByName, pdfDocument);
                        const uniqueColorSpaceRecord = uniqueColorSpaceRecords.getRecord(colorSpaceDescriptorByName);

                        if (!uniqueColorSpaceRecord) throw new Error(`Unexpected unique color space record.`);

                        const colorSpaceDefinition = uniqueColorSpaceRecord.colorSpaceDefinition;

                        if (pageLeafRecord) (pageLeafRecord.colorSpaceDesignatorEntries ??= []).push({
                            colorSpaceDesignatorKey,
                            colorSpaceDescriptor,
                            colorSpaceDescriptorByName,
                            colorSpaceDesignatorName,
                            colorSpaceDefinition,
                        });

                        if (!colorSpaceDesignatorName || !colorSpaceDefinition) continue;

                        colorSpaceDesignation.colorSpaceDefinitions[colorSpaceDesignatorName] = colorSpaceDefinition;
                        colorSpaceDefinitionsCount++;

                        if (pageLeafRecord) pageLeafRecord.colorSpaceDefinitionsCount = colorSpaceDefinitionsCount;
                    }

                    if (colorSpaceDefinitionsCount === 0) continue;

                    (colorSpaceDesignationTargetsByClassifier[enumeratedPageLeafClassifier] ??= new Map()).set(enumeratedObject, colorSpaceDesignation);

                    if (pageLeafRecord) pageLeafRecord.isComplete = true;

                    for (const colorSpaceDefinition of Object.values(colorSpaceDesignation.colorSpaceDefinitions))
                        colorSpaceDefinition?.colorSpaceDescriptor && (
                            colorSpaceDesignationTargetsLookup.has(colorSpaceDefinition.colorSpaceDescriptor)
                            || colorSpaceDesignationTargetsLookup.set(colorSpaceDefinition.colorSpaceDescriptor, new Set()),
                            colorSpaceDesignationTargetsLookup.get(colorSpaceDefinition.colorSpaceDescriptor)?.add(colorSpaceDesignation)
                        );
                }
            } catch (error) {
                console.error(error, record);
                if (record) record.error = /** @type {Error} */ (error);
            }
        }

        // console.timeLog('ColorSpaceDesignationTargetOperationRecords', 'colorSpaceDesignationTargetsLookup');

        const objectTable = [];
        /**
         * @typedef {(
         *   | { type: 'head', value: string }
         *   | { type: 'string', value: string }
         *   | { type: 'name', value: string, operator: 'CS' | 'cs' }
         *   | { type: 'gray', value: string, operator: 'G' | 'g' }
         *   | { type: 'rgb', value: string, operator: 'RG' | 'rg' }
         *   | { type: 'cmyk', value: string, operator: 'K' | 'k' }
         *   | { type: 'n', value: string, operator: 'sc' | 'SC' | 'scn' | 'SCN' }
         * )} PDFRawStreamContentChunk
         */
        /**
         * @typedef {{
         *     chunks: PDFRawStreamContentChunk[],
         *     colorSpaces: ({ name: string, gray: number, rgb: number, cmyk: number, n: number })[],
         * }} PDFRawStreamContentRecord
         */
        /** 
         * @type {Record<string, PDFRawStreamContentRecord>} 
         */
        const pageLeafContentsCache = {};
        /** @type {Record<string, number>} */
        const pageLeafContentsCounts = {};

        for (const [colorSpaceDescriptor, colorSpaceDesignations] of colorSpaceDesignationTargetsLookup.entries()) {

            // check if it is a ICCBasedColorSpaceDefinition
            if (
                !(colorSpaceDescriptor instanceof PDFArray)
                || !(/** @type {Partial<PDFString>} */ (colorSpaceDescriptor?.get(0))?.decodeText?.() === 'ICCBased')
            ) continue;

            // const iccProfileRawStream = /** @type {PDFRawStream | undefined} */ (pdfDocument.context.lookupMaybe(colorSpaceDescriptor.get(1), PDFRawStream));
            const iccProfileRawStream = lookupMaybe(pdfDocument.context, /** @type {PDFName} */(colorSpaceDescriptor.get(1)), PDFRawStream);

            if (!iccProfileRawStream) continue;

            const iccProfileBuffer = /** @type {Buffer} */(Buffer.from(decodePDFRawStream(iccProfileRawStream).decode()));
            const iccProfileHeader = ICCService.parseICCHeaderFromSource(/** @type {*} */(iccProfileBuffer));

            const deviceColorSpace = iccProfileHeader.colorSpace === 'CMYK' ? PDFName.of('DeviceCMYK')
                : iccProfileHeader.colorSpace === 'RGB' ? PDFName.of('DeviceRGB')
                    : iccProfileHeader.colorSpace === 'GRAY' ? PDFName.of('DeviceGray')
                        : undefined;

            if (!deviceColorSpace) continue;

            for (const colorSpaceDesignation of colorSpaceDesignations) {
                switch (colorSpaceDesignation.type) {
                    case 'XObjectImageColorSpaceDesignation': {
                        const imageObject = /** @type {PDFRawStream} */ (colorSpaceDesignation.colorSpaceDesignationTarget);
                        const currentColorSpace = imageObject.dict.get(PDFName.of('ColorSpace'));
                        imageObject.dict.set(PDFName.of('ColorSpace'), deviceColorSpace);

                        objectTable.push({ type: 'XObjectImage', imageObject, currentColorSpace, deviceColorSpace });
                        // console.log('Replaced %o with %o for %o', currentColorSpace, deviceColorSpace, imageObject);
                        console.log('Replaced %o with %o for %o', currentColorSpace, deviceColorSpace, colorSpaceDesignation.type);

                        break;
                    }
                    case 'PageColorSpaceDesignation': {
                        const pageLeaf = /** @type {PDFPageLeaf} */ (colorSpaceDesignation.colorSpaceDesignationTarget);
                        const pageLeafResourcesDict = /** @type {PDFDict | undefined} */ (pageLeaf?.lookupMaybe?.(PDFName.of('Resources'), PDFDict));
                        const pageLeafResourcesColorSpaceDict = /** @type {PDFDict | undefined} */ (pageLeafResourcesDict?.lookupMaybe?.(PDFName.of('ColorSpace'), PDFDict));

                        if (!pageLeafResourcesColorSpaceDict) continue;

                        // const pageLeafContents = /** @type {PDFRawStream | PDFArray | undefined} */ (pageLeaf?.lookupMaybe?.(PDFName.of('Contents'), PDFRawStream, PDFArray));
                        const pageLeafContentsObject = /** @type {PDFRawStream | PDFArray | undefined} */ (pageLeaf?.lookup?.(PDFName.of('Contents')));
                        const pageLeafContentsRawStreams = [];
                        const pageLeafContents = [];

                        if (pageLeafContentsObject instanceof PDFRawStream) {
                            pageLeafContents.push(pageLeafContentsObject);
                            pageLeafContentsRawStreams.push(pageLeafContentsObject);
                            // pageLeafContents.push(pageLeafContentsObject);
                        } else if (pageLeafContentsObject instanceof PDFArray) {
                            for (let index = 0; index < (pageLeafContentsObject?.size() ?? 0); index += 2) {
                                const pageLeafContentsEntry = /** @type {PDFRef | PDFRawStream | undefined} */ (pageLeafContentsObject?.lookup?.(index));
                                const pageLeafContentsEntryObject = pageLeafContentsEntry instanceof PDFRef ? pdfDocument.context.lookup?.(pageLeafContentsEntry) : pageLeafContentsEntry;

                                // if (pageLeafContentsEntry)

                                if (pageLeafContentsEntryObject instanceof PDFRawStream) {
                                    pageLeafContentsRawStreams.push(pageLeafContentsEntryObject);
                                    pageLeafContents.push(pageLeafContentsEntryObject);
                                } else if (pageLeafContentsEntryObject) {
                                    pageLeafContents.push(pageLeafContentsEntryObject);
                                }
                            }
                            // pageLeafContentEntries.push(...pageLeafContents);
                        } else if (pageLeafContentsObject) {
                            pageLeafContents.push(pageLeafContentsObject);
                        }

                        /** 
                         * @template {{}} [P = object]
                         * @template {PDFObjectInstance} [T=PDFObjectInstance]
                         * @typedef {T & P} PDFObjectWith 
                         */

                        for (const rawStream of /** @type {PDFObjectWith<{decodedContents: Uint8Array; decodedContentsParts: PDFRawStreamContentRecord },PDFRawStream>[]} */ /** @type {*} */ (pageLeafContentsRawStreams)) {
                            const streamContents = /** @type {Uint8Array<ArrayBuffer>} */ (decodePDFRawStream(rawStream).decode());
                            rawStream['decodedContents'] = streamContents;
                            const streamText = new TextDecoder().decode(streamContents);
                            rawStream['decodedContentsString'] = streamText;
                            // rawStream['decodedContentsParts'];
                            if (pageLeafContentsCache[streamText]) {
                                rawStream['decodedContentsParts'] = pageLeafContentsCache[streamText];
                                pageLeafContentsCounts[streamText]++;
                                continue;
                            }
                            // const matcher = /(?<head>[^(]*?\s+?)(?:(?:(?<=\s|^)(?<name>\/\w+)\s+(?<operator>CS|cs|SCN|scn)\b|\b(?<gray>(?:\d+\.\d+|\d+))\s+(?<operator>G|g)|\b(?<cmyk>(?:\d+\.\d+|\d+)\s+(?:\d+\.\d+|\d+)\s+(?:\d+\.\d+|\d+)\s+(?:\d+\.\d+|\d+))\s+(?<operator>K|k)|\b(?<rgb>(?:\d+\.\d+|\d+)\s+(?:\d+\.\d+|\d+)\s+(?:\d+\.\d+|\d+))\s+(?<operator>RG|rg)|\b(?<n>(?:\d+\.\d+|\d+)(?:\s+\d+\.\d+|\s+\d+)*)\s+(?<operator>SC|sc|SCN|scn)\b|\(?<string>.*?\))(?=\s+|$)|$)/ug;
                            // const matcher = /(?<head>[^(]*?)(?:(?:(?<=[\s\n]|^)(?<name>\/\w+)\s+(?<operator>CS|cs|SCN|scn)\b|\b(?<gray>(?:\d+\.\d+|\d+))\s+(?<operator>G|g)|\b(?<cmyk>(?:\d+\.\d+|\d+)\s+(?:\d+\.\d+|\d+)\s+(?:\d+\.\d+|\d+)\s+(?:\d+\.\d+|\d+))\s+(?<operator>K|k)|\b(?<rgb>(?:\d+\.\d+|\d+)\s+(?:\d+\.\d+|\d+)\s+(?:\d+\.\d+|\d+))\s+(?<operator>RG|rg)|\b(?<n>(?:\d+\.\d+|\d+)(?:\s+\d+\.\d+|\s+\d+)*)\s+(?<operator>SC|sc|SCN|scn)\b|\(?<string>.*?\))(?=\s+|\s*$)|$)/ug;
                            const matcher = /(?<head>[^(]*?)(?:(?:(?<=[\s\n]|^)(?<name>\/\w+)\s+(?<operator>CS|cs|SCN|scn)\b|\b(?<gray>(?:\d+\.\d+|\d+))\s+(?<operator>G|g)|\b(?<cmyk>(?:\d+\.\d+|\d+)\s+(?:\d+\.\d+|\d+)\s+(?:\d+\.\d+|\d+)\s+(?:\d+\.\d+|\d+))\s+(?<operator>K|k)|\b(?<rgb>(?:\d+\.\d+|\d+)\s+(?:\d+\.\d+|\d+)\s+(?:\d+\.\d+|\d+))\s+(?<operator>RG|rg)|\b(?<n>(?:\d+\.\d+|\d+)(?:\s+\d+\.\d+|\s+\d+)*)\s+(?<operator>SC|sc|SCN|scn)\b|\(?<string>.*?\))|\s*$)/ug;
                            /** @type {PDFRawStreamContentRecord} */
                            const parts = { chunks: [], colorSpaces: [] };
                            // const parts.chunks = [];
                            // const parts.colorSpaces = [];
                            let colorSpace;
                            const matches = Array.from(streamText.matchAll(matcher));
                            console.log({ matches, streamText });
                            // for (const match of streamText.matchAll(matcher)) {
                            for (const match of matches) {
                                const { head, name, operator, gray, cmyk, rgb, n, string } = /** @type {Partial<Record<string, string>>} */ (match.groups);
                                if (head) parts.chunks.push({ type: 'head', value: head });
                                if (string) {
                                    parts.chunks.push({ type: 'string', value: string });
                                } else if (operator === 'CS' || operator === 'cs') {
                                    if (!name) throw new Error(`Expected name for operator CS/cs`);
                                    parts.chunks.push({ type: 'name', value: name, operator });
                                    parts.colorSpaces.push(colorSpace = { name, gray: 0, rgb: 0, cmyk: 0, n: 0 });
                                } else if (operator === 'G' || operator === 'g') {
                                    if (!gray) throw new Error(`Expected gray value for operator G/g`);
                                    parts.chunks.push({ type: 'gray', value: gray, operator });
                                    if (colorSpace) colorSpace['gray']++;
                                } else if (operator === 'RG' || operator === 'rg') {
                                    if (!rgb) throw new Error(`Expected rgb value for operator RG/rg`);
                                    parts.chunks.push({ type: 'rgb', value: rgb, operator });
                                    if (colorSpace) colorSpace['rgb']++;
                                } else if (operator === 'K' || operator === 'k') {
                                    if (!cmyk) throw new Error(`Expected cmyk value for operator K/k`);
                                    parts.chunks.push({ type: 'cmyk', value: cmyk, operator });
                                    if (colorSpace) colorSpace['cmyk']++;
                                } else if (operator === 'SC' || operator === 'sc' || operator === 'SCN' || operator === 'scn') {
                                    if (!n) throw new Error(`Expected n value for operator SC/sc/SCN/scn`);
                                    parts.chunks.push({ type: 'n', value: name || n, operator });
                                    if (colorSpace) colorSpace['n']++;
                                } else continue;
                                // console.log(streamChunks.at(-1));
                            }
                            pageLeafContentsCache[streamText] = rawStream['decodedContentsParts'] = parts;
                            pageLeafContentsCounts[streamText] = 1;
                        }

                        console.log({ pageLeafContents, pageLeafContentsRawStreams, pageLeafResourcesDict });

                        for (const [colorSpaceKey, colorSpaceDefinition] of Object.entries(colorSpaceDesignation.colorSpaceDefinitions)) {
                            if (colorSpaceDefinition.colorSpaceDescriptor !== colorSpaceDescriptor) continue;

                            const colorSpacePDFName = /** @type {PDFName} */ (PDFName.of(colorSpaceKey));

                            const currentColorSpace = pageLeafResourcesColorSpaceDict.get(colorSpacePDFName);

                            pageLeafResourcesColorSpaceDict.set(colorSpacePDFName, deviceColorSpace);

                            // console.log('Replaced %o with %o for %o', currentColorSpace, deviceColorSpace, pageLeaf);
                            console.log('Replaced %o with %o for %o', currentColorSpace, deviceColorSpace, colorSpaceDesignation.type);
                            objectTable.push({ type: 'Page', pageLeaf, pageLeafResourcesDict, pageLeafResourcesColorSpaceDict, deviceColorSpace, pageLeafContents });
                        }


                        break;
                    }
                    default:
                        console.warn(`Unexpected color space designation type: ${colorSpaceDesignation.type}`);
                        break;
                }
            }
        }

        console.log(objectTable);
        console.log({ pageLeafContentsCounts: Object.values(pageLeafContentsCounts) });

        // console.timeLog('ColorSpaceDesignationTargetOperationRecords', 'colorSpaceDecalibration');

        // const decalibratedPDFBuffer = /** @type {ArrayBuffer} */ ((await pdfDocument.save()).buffer);
        // await downloadArrayBufferAs(decalibratedPDFBuffer, 'decalibrated.pdf', 'application/pdf');

        // console.timeEnd('ColorSpaceDesignationTargetOperationRecords');

        return pdfDocument;

        // // console.table(colorSpaceDesignationTargetOperationRecords, ['isComplete', 'enumeratedObject', 'colorSpaceDesignationType', 'colorSpaceDefinitionsCount']);

        // console.table(colorSpaceDesignationTargetOperationRecords
        //     .filter(record => record?.isRelevant === true)
        //     .map(({ isComplete, enumeratedObject: { constructor: { name: enumeratedObjectClass } }, colorSpaceDesignationType, colorSpaceDefinitionsCount }) => ({ isComplete, enumeratedObjectClass, colorSpaceDesignationType, colorSpaceDefinitionsCount })));

        // console.log({
        //     // colorSpaceDesignationTargetOperationRecords,
        //     colorSpaceDesignationTargetsByClassifier,
        //     colorSpaceDesignationTargetsLookup,
        //     uniqueColorSpaceRecordsMap,
        // });

        // debugger;

    }

    //   /**
    //    * Get printing profile
    //    * Reference - https://www.color.org/registry/index.xalter
    //    *
    //    * @returns printing profile info.
    //    */
    //   static getPrintProfile():
    //     | {
    //         type?: string;
    //         subType?: string;
    //         identifier: string;
    //         info?: string;
    //         iccBuffer?: Uint8Array;
    //       }
    //     | undefined {
    //     const printProfile = this.catalog.lookup(
    //       PDFName.of('OutputIntents'),
    //     ) as PDFArray;
    //     if (!printProfile) return undefined;

    //     const object = printProfile.lookup(0) as PDFDict;
    //     if (!object) return undefined;

    //     const type = object.lookup(PDFName.of('Type')) as PDFName;
    //     const subType = object.lookup(PDFName.of('S')) as PDFName;
    //     const identifier = object.lookup(
    //       PDFName.of('OutputConditionIdentifier'),
    //     ) as PDFName;
    //     const info = object.lookup(PDFName.of('Info')) as PDFName;

    //     const profile = object.lookup(
    //       PDFName.of('DestOutputProfile'),
    //     ) as PDFRawStream;

    //     return {
    //       type: type?.decodeText(),
    //       subType: subType?.decodeText(),
    //       identifier: identifier?.decodeText(),
    //       info: info?.decodeText(),
    //       iccBuffer: profile.contents,
    //     };
    //   }
}