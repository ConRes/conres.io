// @ts-check
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

import {
    lookupPDFDocumentAttachementByName,
    dumpPDFDocument,
    Buffer,
} from "../helpers.js";

import { ICCService } from "./ICCService.js";

const DEBUG_COLORSPACE_DESIGNATION_TARGET_OPERATIONS = false;
const DEBUG_TRANSPARENCY_BLENDING_OPERATIONS = false;

/** @param {PDFName | PDFString | import('pdf-lib').PDFHexString} [instance] */
const _decodeText = instance => instance?.decodeText?.().trim();

/**
 * @template {{lookupMaybe: Function}} T
 * @template  {any[]} U
 * @param {T | undefined | null} target
 * @param {PDFName} key
 * @param  {U} types
 * @returns {any}
 */
const _lookupMaybe = (target, key, ...types) => target?.lookupMaybe(key, ...types);

/**
 * Service for PDF manipulation operations
 */
export class PDFService {
    /**
     * Attaches a manifest to a PDF document
     * @param {PDFDocument} pdfDocument
     * @param {ArrayBuffer} manifestBuffer - The manifest buffer to attach
     * @param {string} attachmentName - Name for the attachment
     */
    static async attachManifestToPDF(pdfDocument, manifestBuffer, attachmentName = 'test-form.manifest.json') {
        await pdfDocument.attach(manifestBuffer, attachmentName, { 'mimeType': 'application/json' });
    }

    /**
     * Extract attached manifest from a PDF
     * @param {PDFDocument} pdfDocument
     * @param {string} attachmentName - Name of the attachment to find
     * @returns {{buffer: ArrayBuffer, json: any} | null} - The manifest buffer and parsed JSON
     */
    static extractManifestFromPDF(pdfDocument, attachmentName = 'test-form.manifest.json') {
        const attachedRecord = lookupPDFDocumentAttachementByName(pdfDocument, attachmentName);

        if (!attachedRecord?.contents?.buffer)
            return null;

        const buffer = attachedRecord.contents.buffer.slice(
            attachedRecord.contents.byteOffset,
            attachedRecord.contents.byteOffset + attachedRecord.contents.byteLength
        );

        const json = JSON.parse(new TextDecoder().decode(buffer));

        return { buffer, json };
    }

    /**
     * Extract ICC profiles from a PDF document
     * @param {PDFDocument} pdfDocument
     * @returns {Map<PDFRef, { stream: PDFRawStream, buffer: Buffer, header: ReturnType<import('icc')['parse']> }>} - Map of ICC profiles
     */
    static extractICCProfilesFromPDF(pdfDocument) {
        const enumeratedIndirectObjects = /** @type {[PDFRef, any][]} */ (pdfDocument.context.enumerateIndirectObjects());

        // Find ICC-based color spaces in the PDF
        const iccBasedIndirectObjects = enumeratedIndirectObjects.filter(([ref, object]) => object.asArray?.()?.[0]?.asString?.() === '/ICCBased');

        // Get references to the ICC data streams
        const iccBasedObjectReferences = new Set(iccBasedIndirectObjects.map(([ref, object]) => object?.asArray?.()?.[1]).filter(Boolean));

        /** @type {Map<PDFRef, { stream: PDFRawStream, buffer: Buffer, header: ReturnType<import('icc')['parse']> }>} */
        const iccProfilesMap = new Map();

        for (const reference of iccBasedObjectReferences) {
            const stream = /** @type {PDFRawStream | undefined} */ (pdfDocument.context.lookupMaybe(reference, /** @type {*} */(PDFRawStream)));

            if (!stream) continue;

            const buffer = /** @type {Buffer} */(Buffer.from(decodePDFRawStream(stream).decode()));
            const header = ICCService.parseICCHeaderFromSource(/** @type {*} */(buffer));

            iccProfilesMap.set(reference, { header, buffer, stream });
        }

        return iccProfilesMap;
    }

    /**
     * set printing profile of this document.
     * Reference - https://www.color.org/registry/index.xalter
     *
     * @param {PDFDocument} pdfDocument
     * @param {object} options
     * @param {string} options.identifier eg. GTS_PDFA1, GTS_PDFX
     * @param {string} options.subType eg. GTS_PDFA1, GTS_PDFX
     * @param {string} [options.info] info about the profile
     * @param {Uint8Array | PDFRawStream | PDFRef} options.iccProfile icc profile buffer content
     * @param icc icc profile buffer content
     */
    static setOutputIntentForPDF(pdfDocument, { subType, iccProfile, info, identifier }) {
        if (!(pdfDocument instanceof PDFDocument))
            throw new Error('Unexpected pdfDocument argument type.');

        const iccStreamRef =
            iccProfile instanceof PDFRef ? iccProfile
                : iccProfile instanceof PDFRawStream ? pdfDocument.context.register(iccProfile)
                    : pdfDocument.context.register(pdfDocument.context.stream(iccProfile, { Length: iccProfile.length }));

        console.log({ iccProfile, iccStreamRef });

        const outputIntent = pdfDocument.context.obj({
            Type: 'OutputIntent',
            S: subType,
            OutputConditionIdentifier: PDFString.of(identifier),
            Info: info ? PDFString.of(info) : PDFString.of(identifier),
            DestOutputProfile: iccStreamRef,
        });
        const outputIntentRef = pdfDocument.context.register(outputIntent);
        pdfDocument.catalog.set(PDFName.of('OutputIntents'), pdfDocument.context.obj([outputIntentRef]));
    }

    /**
     * Embeds slugs into each page of a PDF
     * @param {PDFDocument} testFormDocument - The PDF document buffer
     * @param {PDFDocument} slugsDocument - The slugs PDF buffer
     */
    static async embedSlugsIntoPDF(testFormDocument, slugsDocument) {
        const testFormPageCount = testFormDocument?.getPageCount?.();

        if (!(testFormDocument instanceof PDFDocument))
            throw new Error('Unexpected testFormDocument argument type.');

        if (!(slugsDocument instanceof PDFDocument))
            throw new Error('Unexpected slugsDocument argument type.');

        if ((testFormPageCount ?? NaN) !== (slugsDocument.getPageCount() ?? NaN))
            throw new Error(`Test form page count (${testFormPageCount}) does not match slugs page count (${slugsDocument.getPageCount()}).`);

        for (let page = 0; page < testFormPageCount; page++)
            testFormDocument.getPage(page).drawPage((await testFormDocument.embedPdf(slugsDocument, [page]))[0]);

    }

    /**
     * 
     * @param {PDFDocument} pdfDocument 
     */
    static async decalibratePDFDocument(pdfDocument) {
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
         * @template {PDFArray | PDFRef | PDFName} T
         * @param {T} colorSpaceDescriptor 
         * @param {PDFDocument} pdfDocument
         */
        const createColorSpaceDefinitionFrom = (colorSpaceDescriptor, pdfDocument) => {
            if (colorSpaceDescriptor instanceof PDFRef) {
                const colorSpaceArray = /** @type {PDFArray} */ (pdfDocument?.context.lookup(colorSpaceDescriptor));

                if (!colorSpaceArray) return undefined;

                return createColorSpaceDefinitionFrom(colorSpaceArray, pdfDocument);
            } else if (colorSpaceDescriptor instanceof PDFName) {
                const colorSpaceType = colorSpaceDescriptor.decodeText();
                const colorSpaceDefinition = {};
                const colorSpaceClassifier = /^(?:(?:Device)(?=CMYK|RGB|Gray))/.exec(colorSpaceType)?.[0] ?? 'Unknown';

                colorSpaceDefinition.type = `${colorSpaceClassifier}ColorSpaceDefinition`;
                colorSpaceDefinition.colorSpaceType = colorSpaceType;
                colorSpaceDefinition.colorSpaceDescriptor = colorSpaceDescriptor;

                return colorSpaceDefinition;
            } else if (colorSpaceDescriptor instanceof PDFArray) {
                const colorSpaceType = /** @type {PDFName | undefined} */ (colorSpaceDescriptor.get(0))?.decodeText?.();

                if (!colorSpaceType) return undefined;

                const colorSpaceDefinition = {};

                const colorSpaceClassifier = /^(?:(?:Cal)(?=CMYK|RGB|Gray))/.exec(colorSpaceType)?.[0] ?? colorSpaceType;

                colorSpaceDefinition.type = `${colorSpaceClassifier}ColorSpaceDefinition`;
                colorSpaceDefinition.colorSpaceType = colorSpaceType;
                colorSpaceDefinition.colorSpaceDescriptor = colorSpaceDescriptor;

                return colorSpaceDefinition;
            }
        };

        // const colorSpacesMap = new Map();
        // const uniqueColorSpaceRecords = {};
        // const uniqueColorSpaceDesignationTargetsLookup = new Map();

        const uniqueColorSpaceRecordsMap = new WeakMap();

        /**
         * @template {PDFArray | PDFRef | PDFName} T
         * @param {T} colorSpaceDescriptor 
         * @param {PDFDocument} pdfDocument
         */
        const getUniqueColorSpaceRecordFrom = (colorSpaceDescriptor, pdfDocument) => {
            if (colorSpaceDescriptor instanceof PDFRef) {
                const colorSpaceArray = /** @type {PDFArray} */ (pdfDocument?.context.lookup(colorSpaceDescriptor));

                if (colorSpaceArray) return getUniqueColorSpaceRecordFrom(colorSpaceArray, pdfDocument);
            } else if (colorSpaceDescriptor instanceof PDFName || colorSpaceDescriptor instanceof PDFArray) {
                const colorSpaceBuffer = new Uint8Array(colorSpaceDescriptor?.sizeInBytes?.() ?? 0);

                if (colorSpaceBuffer.length === 0) debugger;

                colorSpaceDescriptor?.copyBytesInto?.(colorSpaceBuffer, 0);

                const colorSpaceString = Array.from(colorSpaceBuffer, byte => String.fromCharCode(byte)).join('');

                if (!colorSpaceString) debugger;

                /** 
                 * @type {Record<string, {
                 *   colorSpaceUUID: string, 
                 *   colorSpaceString: string, 
                 *   colorSpaceDescriptor: PDFArray | PDFName,
                 *   colorSpaceDefinition: ReturnType<createColorSpaceDefinitionFrom>, 
                 * }>}
                 */
                const uniqueColorSpaceRecords = uniqueColorSpaceRecordsMap.get(pdfDocument) ?? (
                    uniqueColorSpaceRecordsMap.set(pdfDocument, {}),
                    uniqueColorSpaceRecordsMap.get(pdfDocument)
                );

                return uniqueColorSpaceRecords[colorSpaceString] ??= ((colorSpaceDescriptor) => ({
                    colorSpaceUUID: crypto.randomUUID(),
                    colorSpaceString,
                    colorSpaceDescriptor,
                    colorSpaceDefinition: createColorSpaceDefinitionFrom(colorSpaceDescriptor, pdfDocument),
                }))(colorSpaceDescriptor.clone());
            }
            // throw new Error(`Unexpected color space descriptor type: ${colorSpaceDescriptor?.constructor?.name ?? colorSpaceDescriptor}`);
        };

        /** @param {PDFName | PDFString | import('pdf-lib').PDFHexString} [instance] */
        const decodeText = instance => instance?.decodeText?.().trim();

        const enumeratedIndirectObjects = /** @type {[PDFRef, any][]} */ (pdfDocument.context.enumerateIndirectObjects());

        const colorSpaceDesignationTargetsByClassifier = {};
        const colorSpaceDesignationTargetsLookup = new Map();
        const colorSpaceDesignationTargetOperationRecords = [];

        console.time('ColorSpaceDesignationTargetOperationRecords');

        for (const [enumeratedRef, enumeratedObject] of enumeratedIndirectObjects) {
            const record = DEBUG_COLORSPACE_DESIGNATION_TARGET_OPERATIONS ? {} : undefined;

            if (record) {
                colorSpaceDesignationTargetOperationRecords?.push?.(record);
                record.isComplete = false;
                record.isRelevant = false;
                record.enumeratedObjectRef = enumeratedRef;
                record.enumeratedObject = enumeratedObject;
            }

            try {
                if (enumeratedObject instanceof PDFRawStream) {
                    const enumeratedRawStream = /** @type {PDFRawStream} */ (enumeratedObject);
                    const enumeratedRawStreamDict = /** @type {PDFDict} */ (enumeratedRawStream.dict);
                    const enumeratedRawStreamType = /** @type {PDFName | undefined} */ (enumeratedRawStreamDict.get(PDFName.of('Type')));
                    const enumeratedRawStreamSubtype = /** @type {PDFName | undefined} */ (enumeratedRawStreamDict.get(PDFName.of('Subtype')));
                    const enumeratedRawStreamClassifier = `${decodeText(enumeratedRawStreamType) ?? ''}${decodeText(enumeratedRawStreamSubtype) ?? ''}` || undefined;
                    const colorSpaceDesignator = /** @type {PDFArray|PDFName|undefined} */(enumeratedRawStreamDict.lookupMaybe(PDFName.of('ColorSpace'), PDFName, PDFArray));
                    const colorSpaceDesignationType = /** @type {`${string}ColorSpaceDesignation` | undefined} */(enumeratedRawStreamClassifier && `${enumeratedRawStreamClassifier}ColorSpaceDesignation`);

                    if (record) {
                        record.enumeratedRawStream = enumeratedRawStream;
                        record.enumeratedRawStreamType = enumeratedRawStreamType;
                        record.enumeratedRawStreamSubtype = enumeratedRawStreamSubtype;
                        record.enumeratedRawStreamClassifier = enumeratedRawStreamClassifier;
                        record.colorSpaceDesignator = colorSpaceDesignator;
                        record.colorSpaceDesignationType = colorSpaceDesignationType;
                    }

                    if (!(colorSpaceDesignationType && colorSpaceDesignator)) continue;

                    if (record) record.isRelevant = true;

                    const uniqueColorSpaceRecord = getUniqueColorSpaceRecordFrom(colorSpaceDesignator, pdfDocument);

                    if (!uniqueColorSpaceRecord) throw new Error(`Unexpected unique color space record.`);

                    const colorSpaceDesignation = {
                        type: colorSpaceDesignationType,
                        colorSpaceDesignationTargetRef: enumeratedRef,
                        colorSpaceDesignationTarget: enumeratedRawStream,
                        colorSpaceDesignator: colorSpaceDesignator,
                        colorSpaceDefinition: uniqueColorSpaceRecord.colorSpaceDefinition,
                    };

                    if (record) {
                        record.colorSpaceDesignation = colorSpaceDesignation;
                        record.colorSpaceDefinitionsCount = 1;
                    }

                    (colorSpaceDesignationTargetsByClassifier[enumeratedRawStreamClassifier] ??= new Map()).set(enumeratedObject, colorSpaceDesignation);

                    if (record) record.isComplete = true;

                    colorSpaceDesignation?.colorSpaceDefinition?.colorSpaceDescriptor && (
                        colorSpaceDesignationTargetsLookup.has(colorSpaceDesignation.colorSpaceDefinition.colorSpaceDescriptor)
                        || colorSpaceDesignationTargetsLookup.set(colorSpaceDesignation.colorSpaceDefinition.colorSpaceDescriptor, new Set()),
                        colorSpaceDesignationTargetsLookup.get(colorSpaceDesignation.colorSpaceDefinition.colorSpaceDescriptor)?.add(colorSpaceDesignation)
                    );
                } else if (enumeratedObject instanceof PDFPageLeaf) {
                    const enumeratedPageLeaf = /** @type {PDFPageLeaf} */ (enumeratedObject);
                    const enumeratedPageLeafType = /** @type {PDFName | undefined} */ (enumeratedPageLeaf.get(PDFName.of('Type')));
                    const enumeratedPageLeafSubtype = /** @type {PDFName | undefined} */ (enumeratedPageLeaf.get(PDFName.of('Subtype')));
                    const enumeratedPageLeafClassifier = `${decodeText(enumeratedPageLeafType) ?? ''}${decodeText(enumeratedPageLeafSubtype) ?? ''}` || undefined;
                    const enumeratedPageLeafResourcesDict = /** @type {PDFDict | undefined} */ (enumeratedPageLeaf.lookupMaybe(PDFName.of('Resources'), PDFDict));
                    const colorSpaceDesignator = enumeratedPageLeafResourcesDict?.lookupMaybe?.(PDFName.of('ColorSpace'), PDFDict);
                    const colorSpaceDesignationType = /** @type {`${string}ColorSpaceDesignation` | undefined} */(enumeratedPageLeafClassifier && `${enumeratedPageLeafClassifier}ColorSpaceDesignation`);

                    if (record) {
                        record.enumeratedPageLeaf = enumeratedPageLeaf;
                        record.enumeratedPageLeafType = enumeratedPageLeafType;
                        record.enumeratedPageLeafSubtype = enumeratedPageLeafSubtype;
                        record.enumeratedPageLeafClassifier = enumeratedPageLeafClassifier;
                        record.enumeratedPageLeafResourcesDict = enumeratedPageLeafResourcesDict;
                        record.colorSpaceDesignator = colorSpaceDesignator;
                        record.colorSpaceDesignationType = colorSpaceDesignationType;
                    }

                    if (!(colorSpaceDesignationType && colorSpaceDesignator)) continue;

                    if (record) record.isRelevant = true;

                    const colorSpaceDesignation = {
                        type: colorSpaceDesignationType,
                        colorSpaceDesignationTargetRef: enumeratedRef,
                        colorSpaceDesignationTarget: enumeratedPageLeaf,
                        colorSpaceDesignator,
                        colorSpaceDefinitions: /** @type {Record<string, ReturnType<createColorSpaceDefinitionFrom>>} */ ({}),
                    };

                    if (record) {
                        record.colorSpaceDesignation = colorSpaceDesignation;
                        record.colorSpaceDefinitionsCount = undefined;
                    }

                    let colorSpaceDefinitionsCount = 0;

                    for (const [colorSpaceDesignatorKey, colorSpaceDescriptor] of /** @type {MapIterator<[PDFName, PDFRef | PDFName]>} */(colorSpaceDesignator.asMap().entries())) {
                        if (record) {
                            record.lastColorSpaceDesignatorKey = colorSpaceDesignatorKey;
                            record.lastColorSpaceDescriptor = colorSpaceDescriptor;
                        }

                        const colorSpaceDesignatorName = decodeText(colorSpaceDesignatorKey);
                        const colorSpaceDescriptorByName = /** @type {PDFArray|PDFName|undefined} */(colorSpaceDesignator.lookupMaybe(colorSpaceDesignatorKey, PDFName, PDFArray));

                        if (!(colorSpaceDesignatorName && colorSpaceDescriptorByName)) {
                            console.warn(new Error(`Unexpected color space designator name or descriptor by name: ${colorSpaceDesignatorName}, ${colorSpaceDescriptorByName}`));
                            continue;
                        }

                        const uniqueColorSpaceRecord = getUniqueColorSpaceRecordFrom(colorSpaceDescriptorByName, pdfDocument);

                        if (!uniqueColorSpaceRecord) throw new Error(`Unexpected unique color space record.`);

                        const colorSpaceDefinition = uniqueColorSpaceRecord.colorSpaceDefinition;

                        if (record) (record.colorSpaceDesignatorEntries ??= []).push({ colorSpaceDesignatorKey, colorSpaceDescriptor, colorSpaceDescriptorByName, colorSpaceDesignatorName, colorSpaceDefinition });

                        if (!colorSpaceDesignatorName || !colorSpaceDefinition) continue;

                        colorSpaceDesignation.colorSpaceDefinitions[colorSpaceDesignatorName] = colorSpaceDefinition;
                        colorSpaceDefinitionsCount++;

                        if (record) record.colorSpaceDefinitionsCount = colorSpaceDefinitionsCount;
                    }

                    if (colorSpaceDefinitionsCount === 0) continue;

                    (colorSpaceDesignationTargetsByClassifier[enumeratedPageLeafClassifier] ??= new Map()).set(enumeratedObject, colorSpaceDesignation);

                    if (record) record.isComplete = true;

                    for (const colorSpaceDefinition of Object.values(colorSpaceDesignation.colorSpaceDefinitions))
                        colorSpaceDefinition?.colorSpaceDescriptor && (
                            colorSpaceDesignationTargetsLookup.has(colorSpaceDefinition.colorSpaceDescriptor)
                            || colorSpaceDesignationTargetsLookup.set(colorSpaceDefinition.colorSpaceDescriptor, new Set()),
                            colorSpaceDesignationTargetsLookup.get(colorSpaceDefinition.colorSpaceDescriptor)?.add(colorSpaceDesignation)
                        );
                }
            } catch (error) {
                console.error(error, record);
                if (record) record.error = error;
            }
        }

        console.timeLog('ColorSpaceDesignationTargetOperationRecords', 'colorSpaceDesignationTargetsLookup');

        for (const [colorSpaceDescriptor, colorSpaceDesignations] of colorSpaceDesignationTargetsLookup.entries()) {
            // check if it is a ICCBasedColorSpaceDefinition
            if (!(colorSpaceDescriptor instanceof PDFArray && colorSpaceDescriptor?.get(0)?.decodeText?.() === 'ICCBased')) continue;

            const iccProfileRawStream = /** @type {PDFRawStream} */ (pdfDocument.context.lookupMaybe(colorSpaceDescriptor.get(1), PDFRawStream));

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

                        // console.log('Replaced %o with %o for %o', currentColorSpace, deviceColorSpace, imageObject);
                        console.log('Replaced %o with %o for %o', currentColorSpace, deviceColorSpace, colorSpaceDesignation.type);

                        break;
                    }
                    case 'PageColorSpaceDesignation': {
                        const pageLeaf = /** @type {PDFPageLeaf} */ (colorSpaceDesignation.colorSpaceDesignationTarget);
                        const pageLeafResourcesDict = /** @type {PDFDict | undefined} */ (pageLeaf?.lookupMaybe?.(PDFName.of('Resources'), PDFDict));
                        const pageLeafResourcesColorSpaceDict = /** @type {PDFDict | undefined} */ (pageLeafResourcesDict?.lookupMaybe?.(PDFName.of('ColorSpace'), PDFDict));

                        if (!pageLeafResourcesColorSpaceDict) continue;

                        for (const [colorSpaceKey, colorSpaceDefinition] of Object.entries(colorSpaceDesignation.colorSpaceDefinitions)) {
                            if (colorSpaceDefinition.colorSpaceDescriptor !== colorSpaceDescriptor) continue;

                            const colorSpacePDFName = /** @type {PDFName} */ (PDFName.of(colorSpaceKey));

                            const currentColorSpace = pageLeafResourcesColorSpaceDict.get(colorSpacePDFName);

                            pageLeafResourcesColorSpaceDict.set(colorSpacePDFName, deviceColorSpace);

                            // console.log('Replaced %o with %o for %o', currentColorSpace, deviceColorSpace, pageLeaf);
                            console.log('Replaced %o with %o for %o', currentColorSpace, deviceColorSpace, colorSpaceDesignation.type);
                        }

                        break;
                    }
                    default:
                        console.warn(`Unexpected color space designation type: ${colorSpaceDesignation.type}`);
                        break;
                }
            }
        }

        console.timeLog('ColorSpaceDesignationTargetOperationRecords', 'colorSpaceDecalibration');

        // const decalibratedPDFBuffer = /** @type {ArrayBuffer} */ ((await pdfDocument.save()).buffer);
        // await downloadArrayBufferAs(decalibratedPDFBuffer, 'decalibrated.pdf', 'application/pdf');

        console.timeEnd('ColorSpaceDesignationTargetOperationRecords');

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

    // ========================================================================
    // Aliases for generator compatibility (same implementations, new names)
    // ========================================================================

    /** @type {typeof PDFService.attachManifestToPDF} */
    static attachManifestToPDFDocument = PDFService.attachManifestToPDF;

    /** @type {typeof PDFService.extractManifestFromPDF} */
    static extractManifestFromPDFDocument = PDFService.extractManifestFromPDF;

    /** @type {typeof PDFService.extractICCProfilesFromPDF} */
    static extractICCProfilesFromPDFDocument = PDFService.extractICCProfilesFromPDF;

    /** @type {typeof PDFService.setOutputIntentForPDF} */
    static setOutputIntentForPDFDocument = PDFService.setOutputIntentForPDF;

    /** @type {typeof PDFService.embedSlugsIntoPDF} */
    static embedSlugsIntoPDFDocument = PDFService.embedSlugsIntoPDF;

    /**
     * Decalibrates a PDF document by replacing ICC-based color spaces with device color spaces.
     * Alias for `decalibratePDFDocument` — used by the generator.
     * @param {PDFDocument} pdfDocument
     * @param {object} [_options] - Unused in this implementation
     * @returns {Promise<PDFDocument>}
     */
    static async decalibrateColorInPDFDocument(pdfDocument, _options = {}) {
        return PDFService.decalibratePDFDocument(pdfDocument);
    }

    /**
     * Replaces transparency blending color spaces in a PDF document.
     *
     * Finds all Transparency group dicts on PDFPageLeaf objects with a /Group /CS key,
     * and replaces the /CS value with the provided replacement.
     *
     * @param {PDFDocument} pdfDocument
     * @param {string | PDFName | ((colorspaceDesignator: PDFName | PDFArray, pageLeafGroupDict: PDFDict, pageLeaf: PDFPageLeaf) => (string | PDFName | PDFRef))} replacement
     */
    static async replaceTransarencyBlendingSpaceInPDFDocument(pdfDocument, replacement) {
        const enumeratedIndirectObjects = /** @type {[PDFRef, any][]} */ (pdfDocument.context.enumerateIndirectObjects());

        const replaceTransarencyBlendingSpaceRecords = [];

        for (const [enumeratedRef, enumeratedObject] of enumeratedIndirectObjects) {
            /** @type {any} */
            const record = DEBUG_TRANSPARENCY_BLENDING_OPERATIONS ? {} : null;

            if (enumeratedObject instanceof PDFPageLeaf) {
                if (record) {
                    replaceTransarencyBlendingSpaceRecords.push(record);
                    Object.assign(record, {
                        isComplete: false,
                        isRelevant: false,
                        enumeratedObjectRef: enumeratedRef,
                        enumeratedObject: enumeratedObject,
                    });
                }

                const enumeratedPageLeaf = /** @type {PDFPageLeaf} */ (enumeratedObject);
                const enumeratedPageLeafType = /** @type {PDFName | undefined} */ (enumeratedPageLeaf.get(PDFName.of('Type')));
                const enumeratedPageLeafSubtype = /** @type {PDFName | undefined} */ (enumeratedPageLeaf.get(PDFName.of('Subtype')));
                const enumeratedPageLeafClassifier = `${_decodeText(enumeratedPageLeafType) ?? ''}${_decodeText(enumeratedPageLeafSubtype) ?? ''}` || undefined;
                const enumeratedPageLeafGroupDict = _lookupMaybe(enumeratedPageLeaf, PDFName.of('Group'), PDFDict);
                const enumeratedPageLeafGroupSubtype = /** @type {PDFName | undefined} */ (enumeratedPageLeafGroupDict?.get(PDFName.of('S')));
                const transparencyBlendingSpaceDesignator = _decodeText(enumeratedPageLeafGroupSubtype) === 'Transparency' ? _lookupMaybe(enumeratedPageLeafGroupDict, PDFName.of('CS'), PDFName, PDFArray) : undefined;

                if (record) {
                    record.enumeratedPageLeaf = enumeratedPageLeaf;
                    record.enumeratedPageLeafGroupDict = enumeratedPageLeafGroupDict;
                    record.enumeratedPageLeafGroupSubtype = enumeratedPageLeafGroupSubtype;
                    record.transparencyBlendingSpaceDesignator = transparencyBlendingSpaceDesignator;
                }

                if (!enumeratedPageLeafGroupDict || !transparencyBlendingSpaceDesignator) continue;

                if (record) record.isRelevant = true;

                /** @type {string | PDFName | PDFRef | PDFArray | undefined} */
                let replacementValue;

                if (typeof replacement === 'function') {
                    replacementValue = replacement(transparencyBlendingSpaceDesignator, enumeratedPageLeafGroupDict, enumeratedPageLeaf);
                    if (record) record.replacementResult = replacementValue;
                } else {
                    replacementValue = replacement;
                    if (record) record.replacementArgument = replacementValue;
                }

                if (typeof replacementValue === 'string') {
                    if (record) record.replacementString = replacementValue;
                    replacementValue = PDFName.of(replacementValue);
                } else if (replacementValue instanceof PDFRef) {
                    if (record) record.replacementRef = replacementValue;
                    replacementValue = pdfDocument.context.lookupMaybe(replacementValue, PDFArray);
                }

                if (record) record.replacementValue = replacementValue;

                if (replacementValue instanceof PDFName || replacementValue instanceof PDFArray) {
                    const currentTransparencyBlendingSpace = transparencyBlendingSpaceDesignator;
                    const replacementTransparencyBlendingSpace = replacementValue instanceof PDFArray
                        ? pdfDocument.context.register(replacementValue)
                        : replacementValue;

                    enumeratedPageLeafGroupDict.set(PDFName.of('CS'), replacementTransparencyBlendingSpace);

                    if (record) {
                        record.currentTransparencyBlendingSpace = currentTransparencyBlendingSpace;
                        record.replacementTransparencyBlendingSpace = replacementTransparencyBlendingSpace;
                        record.isComplete = true;
                    }

                    console.log('Replaced %o with %o for %o', currentTransparencyBlendingSpace, replacementTransparencyBlendingSpace, enumeratedPageLeafGroupSubtype);
                } else {
                    throw new Error(`Unexpected replacement type: ${replacementValue}`);
                }
            }
        }

        console.log({ replaceTransarencyBlendingSpaceRecords, pdfDocument, replacement });
    }

    /**
     * Dumps information about a PDF document
     * @param {PDFDocument} pdfDocument
     * @returns {Promise<object>} - Information about the PDF document
     */
    static dumpPDFInfo(pdfDocument) {
        // const pdfDocument = await PDFDocument.load(pdfBuffer);
        return dumpPDFDocument(pdfDocument);
    }

}
