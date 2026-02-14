// @ts-check
/**
 * Legacy PDF Document Color Converter
 *
 * Entry point for engines up to 2026-01-30.
 *
 * Overrides `convertColor()` to create LegacyPDFPageColorConverter children
 * (which in turn create Legacy image and content stream converters).
 *
 * Must duplicate all PDF parsing private helpers from PDFDocumentColorConverter
 * because they are `#private` and inaccessible from subclasses.
 *
 * @module LegacyPDFDocumentColorConverter
 * @author Saleh Abdel Motaal <dev@smotaal.io>
 * @ai Claude Opus 4.6 (code generation)
 */

import { PDFDocumentColorConverter } from '../pdf-document-color-converter.js';
import { ColorEngineProvider } from '../color-engine-provider.js';
import { LegacyPDFPageColorConverter } from './legacy-pdf-page-color-converter.js';
import { PDFRawStream, PDFName, PDFArray, PDFDict, PDFRef, PDFNumber, PDFHexString, PDFString } from 'pdf-lib';
import {
    TYPE_RGB_8,
    TYPE_CMYK_8,
    TYPE_GRAY_8,
    TYPE_Lab_8,
    TYPE_Lab_16,
} from '../../packages/color-engine/src/index.js';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * @typedef {import('../pdf-document-color-converter.js').PDFDocumentColorConverterConfiguration & {
 *   useAdaptiveBPCClamping?: boolean,
 *   coerceLabAbsoluteZeroPixels?: boolean,
 * }} LegacyPDFDocumentColorConverterConfiguration
 */

/**
 * Legacy PDF document color converter for engines up to 2026-01-30.
 *
 * Supports consumer-side adaptive BPC clamping and Lab absolute-zero pixel
 * coercion through LegacyPDFPageColorConverter → LegacyPDFImageColorConverter
 * and LegacyPDFContentStreamColorConverter.
 *
 * @extends PDFDocumentColorConverter
 */
export class LegacyPDFDocumentColorConverter extends PDFDocumentColorConverter {
    // ========================================
    // Private Fields
    // ========================================

    /** @type {typeof import('pako') | null} */
    #pako = null;

    /** @type {Promise<void>} */
    #legacyReady;

    // ========================================
    // Static Version Check
    // ========================================

    /**
     * Checks whether a color engine version is supported by this converter.
     * Supports all engines up to and including 2026-01-30.
     *
     * @param {string} engineVersion - Version date string (e.g., 'color-engine-2026-01-30')
     * @returns {boolean}
     */
    static isColorEngineSupported(engineVersion) {
        return ColorEngineProvider.parseVersionNumber(engineVersion) <= 20260130;
    }

    // ========================================
    // Constructor
    // ========================================

    /**
     * Creates a new LegacyPDFDocumentColorConverter.
     *
     * Sets the `workerScript` configuration to point to the legacy worker
     * entrypoint, which uses LegacyPDFImageColorConverter and
     * LegacyPDFContentStreamColorConverter.
     *
     * @param {LegacyPDFDocumentColorConverterConfiguration} configuration
     */
    constructor(configuration) {
        super({
            ...configuration,
            workerScript: new URL('./legacy-worker-pool-entrypoint.js', import.meta.url),
        });
        this.#legacyReady = this.#initializeLegacy();
    }

    /**
     * Async initialization for legacy-specific resources.
     * @returns {Promise<void>}
     */
    async #initializeLegacy() {
        // Wait for parent initialization first
        await super.ensureReady();

        // Load pako for decompression (own reference since parent's #pako is private)
        try {
            this.#pako = await import('pako');
        } catch {
            console.warn('[LegacyPDFDocumentColorConverter] pako not available - ICC profile decompression disabled');
        }
    }

    /**
     * Ensures the converter is ready for use.
     * @returns {Promise<void>}
     */
    async ensureReady() {
        await super.ensureReady();
        await this.#legacyReady;
    }

    // ========================================
    // Configuration
    // ========================================

    /**
     * @returns {Readonly<LegacyPDFDocumentColorConverterConfiguration>}
     */
    get configuration() {
        return /** @type {Readonly<LegacyPDFDocumentColorConverterConfiguration>} */ (super.configuration);
    }

    // ========================================
    // Configuration Derivation
    // ========================================

    /**
     * Derives configuration for a specific page.
     * Adds legacy-specific configuration properties.
     *
     * @override
     * @param {import('pdf-lib').PDFRef} pageRef - The page reference
     * @returns {import('./legacy-pdf-page-color-converter.js').LegacyPDFPageColorConverterConfiguration}
     */
    derivePageConfiguration(pageRef) {
        const base = this.configuration;
        const override = this.getConfigurationFor(pageRef);

        // Also check pageOverrides Map
        const pageMapOverride = base.pageOverrides?.get(pageRef);

        return /** @type {import('./legacy-pdf-page-color-converter.js').LegacyPDFPageColorConverterConfiguration} */ ({
            // Inherit from document config
            renderingIntent: base.renderingIntent,
            blackPointCompensation: base.blackPointCompensation,

            destinationProfile: base.destinationProfile,
            destinationColorSpace: base.destinationColorSpace,
            verbose: base.verbose,

            // Diagnostics collector (propagate to child converters)
            diagnostics: this.diagnostics,

            // Page-specific defaults from document config
            convertImages: base.convertImages,
            convertContentStreams: base.convertContentStreams,
            sourceRGBProfile: base.sourceRGBProfile,
            sourceGrayProfile: base.sourceGrayProfile,

            // Worker settings (page uses document's pool)
            useWorkers: base.useWorkers,
            workerPool: this.workerPool ?? undefined,
            colorEnginePath: base.colorEnginePath,

            // Shared BufferRegistry for cross-instance caching
            bufferRegistry: this.bufferRegistry,

            // Nested configurations
            imageConfiguration: base.imageConfiguration,
            contentStreamConfiguration: base.contentStreamConfiguration,

            // Legacy-specific configuration
            useAdaptiveBPCClamping: base.useAdaptiveBPCClamping,
            coerceLabAbsoluteZeroPixels: base.coerceLabAbsoluteZeroPixels,

            // Apply per-page overrides (Map takes precedence)
            ...override,
            ...pageMapOverride,
        });
    }

    /**
     * Derives configuration for a specific image (convenience method).
     * Adds legacy-specific configuration properties.
     *
     * @override
     * @param {import('pdf-lib').PDFRef} imageRef - The image reference
     * @param {import('pdf-lib').PDFRef} [pageRef] - Optional page reference for page-level overrides
     * @returns {import('../pdf-image-color-converter.js').PDFImageColorConverterConfiguration}
     */
    deriveImageConfiguration(imageRef, pageRef) {
        const pageConfig = pageRef
            ? this.derivePageConfiguration(pageRef)
            : this.configuration;
        const imageOverride = this.getConfigurationFor(imageRef);

        return /** @type {import('../pdf-image-color-converter.js').PDFImageColorConverterConfiguration} */ ({
            // Inherit rendering settings
            renderingIntent: pageConfig.renderingIntent,
            blackPointCompensation: pageConfig.blackPointCompensation,

            destinationProfile: pageConfig.destinationProfile,
            destinationColorSpace: pageConfig.destinationColorSpace,
            verbose: pageConfig.verbose,

            // Diagnostics collector (propagate to child converters)
            diagnostics: this.diagnostics,

            // Image-specific defaults
            compressOutput: true,
            inputType: 'RGB',

            // Legacy-specific configuration
            useAdaptiveBPCClamping: /** @type {LegacyPDFDocumentColorConverterConfiguration} */ (pageConfig).useAdaptiveBPCClamping,
            coerceLabAbsoluteZeroPixels: /** @type {LegacyPDFDocumentColorConverterConfiguration} */ (pageConfig).coerceLabAbsoluteZeroPixels,

            // Merge page-level image configuration if available
            ...pageConfig.imageConfiguration,

            // Apply per-image overrides (if any)
            ...imageOverride,
        });
    }

    // ========================================
    // Color Conversion
    // ========================================

    /**
     * Converts colors in an entire PDF document.
     *
     * Duplicated from PDFDocumentColorConverter.convertColor() because it calls
     * private methods (`#collectPageData`) and we need to create
     * LegacyPDFPageColorConverter instead of PDFPageColorConverter.
     *
     * @override
     * @param {import('../pdf-document-color-converter.js').PDFDocumentColorConverterInput} input - Document to convert
     * @param {object} [context={}] - Conversion context
     * @returns {Promise<import('../pdf-document-color-converter.js').PDFDocumentColorConverterResult>}
     */
    async convertColor(input, context = {}) {
        await this.ensureReady();

        const { pdfDocument } = input;
        const config = this.configuration;
        const pages = pdfDocument.getPages();
        const pdfContext = pdfDocument.context;

        // Get engine version from policy for diagnostics and producer
        const engineVersion = this.policy.engineVersion;

        // Start document-level diagnostics span
        const docSpan = this.diagnostics.startSpan('document-conversion', {
            engine: engineVersion,
            renderingIntent: config.renderingIntent,
            blackPointCompensation: config.blackPointCompensation,
            destinationColorSpace: config.destinationColorSpace,
            pageCount: pages.length,
        });

        const pageResults = [];
        let totalImagesConverted = 0;
        let totalContentStreamsConverted = 0;
        let totalColorOperationsConverted = 0;
        const allErrors = [];

        try {
            // Process each page
            for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
                const page = pages[pageIndex];
                const pageRef = page.ref;

                // Start page-level diagnostics span
                const pageSpan = this.diagnostics.startSpan('page', {
                    pageIndex,
                    ref: `${pageRef.objectNumber} ${pageRef.generationNumber} R`,
                });

                // Derive page-specific configuration (with legacy props)
                const pageConfig = this.derivePageConfiguration(pageRef);

                // Create LEGACY page converter (key difference from base class)
                const pageConverter = this.createChildConverter(LegacyPDFPageColorConverter, pageConfig);

                /** @type {import('../pdf-page-color-converter.js').PDFPageColorConverterResult | undefined} */
                let result;

                try {
                    await pageConverter.ensureReady();

                    // Collect images and content streams for this page (own #private method)
                    const pageData = this.#collectPageData(page, pdfContext, pageIndex);

                    result = await pageConverter.convertColor({
                        pageLeaf: /** @type {import('pdf-lib').PDFPageLeaf} */ (pdfContext.lookup(pageRef)),
                        pageRef,
                        pageIndex,
                        context: pdfContext,
                        pdfDocument,
                        images: pageData.images,
                        contentStreams: pageData.contentStreams,
                    }, context);

                    pageResults.push(result);
                    totalImagesConverted += result.imagesConverted;
                    totalContentStreamsConverted += result.contentStreamsConverted;
                    totalColorOperationsConverted += result.totalColorOperations;
                    allErrors.push(...result.errors);

                    if (config.verbose) {
                        console.log(`Page ${pageIndex + 1}: ${result.imagesConverted} images, ${result.contentStreamsConverted} streams`);
                    }
                } catch (error) {
                    allErrors.push(`Page ${pageIndex + 1}: ${error}`);
                    this.diagnostics.abortSpan(pageSpan, { reason: `${error}` });
                } finally {
                    pageConverter.dispose();
                    // End page span with metrics (no-op if abortSpan was called)
                    this.diagnostics.endSpan(pageSpan, result ? {
                        images: result.imagesConverted,
                        streams: result.contentStreamsConverted,
                        ops: result.totalColorOperations,
                    } : {});
                }
            }
        } finally {
            // End document span with totals
            this.diagnostics.endSpan(docSpan, {
                pages: pages.length,
                images: totalImagesConverted,
                streams: totalContentStreamsConverted,
                ops: totalColorOperationsConverted,
                errors: allErrors.length,
            });
        }

        // Update PDF producer with color engine version for traceability
        const existingProducer = pdfDocument.getProducer()?.trim() || 'Unknown';
        pdfDocument.setProducer(`${existingProducer} (Color-Engine ${engineVersion.replace(/^color-engine-/, '')})`);

        return {
            pagesProcessed: pages.length,
            imagesConverted: totalImagesConverted,
            contentStreamsConverted: totalContentStreamsConverted,
            totalColorOperationsConverted,
            errors: allErrors,
            pageResults,
        };
    }

    // ========================================
    // PDF Parsing Helpers (duplicated from PDFDocumentColorConverter)
    // ========================================
    // These are pure PDF structure parsing — identical between Legacy and
    // non-Legacy. Duplication is the cost of #private fields.

    /**
     * Collects images and content streams from a page.
     *
     * @param {import('pdf-lib').PDFPage} page
     * @param {import('pdf-lib').PDFContext} context
     * @param {number} pageIndex
     */
    #collectPageData(page, context, pageIndex) {
        /** @type {import('../pdf-page-color-converter.js').PDFPageColorConverterInputImage[]} */
        const images = [];
        /** @type {import('../pdf-page-color-converter.js').PDFPageColorConverterContentStreamImage[]} */
        const contentStreams = [];

        const pageDict = context.lookup(page.ref);
        if (!(pageDict instanceof PDFDict)) {
            return { images, contentStreams };
        }

        // Collect content streams
        const contents = pageDict.get(PDFName.of('Contents'));
        if (contents) {
            const contentRefs = contents instanceof PDFArray
                ? contents.asArray()
                : [contents];

            // Extract color space definitions for this page
            const colorSpaceDefinitions = this.#extractColorSpaceDefinitions(pageDict, context);

            for (const contentRef of contentRefs) {
                if (contentRef instanceof PDFRef) {
                    const stream = context.lookup(contentRef);
                    if (stream instanceof PDFRawStream) {
                        contentStreams.push({
                            ref: contentRef,
                            stream,
                            colorSpaceDefinitions,
                        });
                    }
                }
            }
        }

        // Collect images from Resources/XObject
        const resources = pageDict.get(PDFName.of('Resources'));
        if (resources) {
            const resourcesDict = resources instanceof PDFRef
                ? context.lookup(resources)
                : resources;

            if (resourcesDict instanceof PDFDict) {
                const xobject = resourcesDict.get(PDFName.of('XObject'));
                if (xobject) {
                    const xobjectDict = xobject instanceof PDFRef
                        ? context.lookup(xobject)
                        : xobject;

                    if (xobjectDict instanceof PDFDict) {
                        for (const [name, ref] of xobjectDict.entries()) {
                            if (ref instanceof PDFRef) {
                                const obj = context.lookup(ref);
                                if (obj instanceof PDFRawStream) {
                                    const subtype = obj.dict.get(PDFName.of('Subtype'));
                                    if (subtype instanceof PDFName && subtype.asString() === '/Image') {
                                        const colorSpaceInfo = this.#getImageColorSpaceInfo(obj.dict, context);
                                        if (colorSpaceInfo && !colorSpaceInfo.type.includes('CMYK')) {
                                            images.push({
                                                ref,
                                                stream: obj,
                                                colorSpaceInfo,
                                            });
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        return { images, contentStreams };
    }

    /**
     * Extracts color space definitions from a page's Resources.
     *
     * @param {import('pdf-lib').PDFDict} pageDict
     * @param {import('pdf-lib').PDFContext} context
     * @returns {Record<string, import('../pdf-document-color-converter.js').PDFColorSpaceDefinition>}
     */
    #extractColorSpaceDefinitions(pageDict, context) {
        /** @type {Record<string, import('../pdf-document-color-converter.js').PDFColorSpaceDefinition>} */
        const definitions = {};

        const resources = pageDict.get(PDFName.of('Resources'));
        if (!resources) return definitions;

        const resourcesDict = resources instanceof PDFRef
            ? context.lookup(resources)
            : resources;
        if (!(resourcesDict instanceof PDFDict)) return definitions;

        const colorSpaceDict = resourcesDict.get(PDFName.of('ColorSpace'));
        if (!colorSpaceDict) return definitions;

        const csDict = colorSpaceDict instanceof PDFRef
            ? context.lookup(colorSpaceDict)
            : colorSpaceDict;
        if (!(csDict instanceof PDFDict)) return definitions;

        for (const [key, value] of csDict.entries()) {
            const csName = key.asString().replace(/^\//, '');

            let csDescriptor = value;
            if (csDescriptor instanceof PDFRef) {
                csDescriptor = /** @type {import('pdf-lib').PDFName | import('pdf-lib').PDFArray} */ (context.lookup(csDescriptor));
            }

            if (csDescriptor instanceof PDFName) {
                const typeName = csDescriptor.asString().replace(/^\//, '');
                definitions[csName] = {
                    colorSpaceType: this.#normalizeColorSpaceType(typeName),
                };
            } else if (csDescriptor instanceof PDFArray && csDescriptor.size() > 0) {
                const csType = csDescriptor.get(0);
                if (csType instanceof PDFName) {
                    const typeName = csType.asString().replace(/^\//, '');
                    /** @type {import('../pdf-document-color-converter.js').PDFColorSpaceDefinition} */
                    const def = { colorSpaceType: typeName };

                    // Handle ICCBased - extract actual color space and profile from PDF
                    if (typeName === 'ICCBased' && csDescriptor.size() > 1) {
                        const iccRef = csDescriptor.get(1);
                        const iccStream = iccRef instanceof PDFRef
                            ? context.lookup(iccRef)
                            : iccRef;

                        if (iccStream instanceof PDFRawStream) {
                            const profileData = this.#getDecompressedStreamContents(iccStream);
                            const iccColorSpace = this.#getICCColorSpace(profileData);
                            // Map to normalized type (sGray, sRGB, etc.)
                            def.colorSpaceType = this.#normalizeColorSpaceType(iccColorSpace);

                            // Store profile ref for potential use
                            if (iccRef instanceof PDFRef) {
                                def.profileRef = iccRef;
                            }

                            // Store actual ICC profile data for conversion
                            // Convert Uint8Array to ArrayBuffer for ColorEngineService
                            def.sourceProfile = profileData.buffer.slice(
                                profileData.byteOffset,
                                profileData.byteOffset + profileData.byteLength
                            );
                        }
                    }
                    // Handle Lab color space
                    else if (typeName === 'Lab' && csDescriptor.size() > 1) {
                        const labDict = csDescriptor.get(1);
                        const labDictResolved = labDict instanceof PDFRef
                            ? context.lookup(labDict)
                            : labDict;

                        if (labDictResolved instanceof PDFDict) {
                            const rangeArray = labDictResolved.get(PDFName.of('Range'));
                            if (rangeArray instanceof PDFArray) {
                                def.range = rangeArray.asArray().map(n => /** @type {import('pdf-lib').PDFNumber} */(n).asNumber?.() ?? 0);
                            } else {
                                def.range = [-100, 100, -100, 100];
                            }
                        }
                    }

                    definitions[csName] = def;
                }
            }
        }

        return definitions;
    }

    /**
     * Gets the color space from an ICC profile header.
     *
     * @param {Uint8Array} profileData - Decompressed ICC profile data
     * @returns {string} Color space type ('Gray', 'RGB', 'CMYK', or 'Unknown')
     */
    #getICCColorSpace(profileData) {
        if (profileData.length < 20) return 'Unknown';

        // ICC color space is at offset 16, 4 bytes
        const colorSpaceBytes = profileData.slice(16, 20);
        const colorSpace = String.fromCharCode(...colorSpaceBytes).trim();

        switch (colorSpace) {
            case 'GRAY': return 'Gray';
            case 'RGB': return 'RGB';
            case 'CMYK': return 'CMYK';
            case 'Lab': return 'Lab';
            default: return 'Unknown';
        }
    }

    /**
     * Normalizes color space type names for consistent handling.
     *
     * @param {string} typeName - Raw color space type name
     * @returns {string} Normalized type (sGray, sRGB, Lab, CMYK, etc.)
     */
    #normalizeColorSpaceType(typeName) {
        switch (typeName) {
            case 'Gray':
            case 'DeviceGray':
                return 'sGray';
            case 'RGB':
            case 'DeviceRGB':
                return 'sRGB';
            case 'CMYK':
            case 'DeviceCMYK':
                return 'CMYK';
            case 'Lab':
                return 'Lab';
            default:
                return typeName;
        }
    }

    /**
     * Gets stream contents, decompressing if needed.
     * Handles FlateDecode compressed streams.
     *
     * @param {import('pdf-lib').PDFRawStream} stream
     * @returns {Uint8Array}
     */
    #getDecompressedStreamContents(stream) {
        const filter = stream.dict.get(PDFName.of('Filter'));
        const contents = stream.contents;

        // Check if FlateDecode compressed
        if (filter instanceof PDFName && filter.asString() === '/FlateDecode') {
            try {
                const pako = this.#pako;
                if (pako) {
                    return pako.inflate(contents);
                }
                console.warn('[LegacyPDFDocumentColorConverter] pako not loaded, returning compressed data');
            } catch (error) {
                console.warn('[LegacyPDFDocumentColorConverter] Failed to decompress stream:', /** @type {Error} */ (error).message);
            }
        }

        return contents;
    }

    /**
     * Gets color space info from an image XObject.
     *
     * @param {import('pdf-lib').PDFDict} dict
     * @param {import('pdf-lib').PDFContext} context
     * @returns {import('../pdf-document-color-converter.js').PDFColorSpaceInformation?}
     */
    #getImageColorSpaceInfo(dict, context) {
        const colorSpace = /** @type {import('pdf-lib').PDFName | import('pdf-lib').PDFRef | import('pdf-lib').PDFArray | undefined} */ (dict.get(PDFName.of('ColorSpace')));
        const bitsPerComponent = /** @type {import('pdf-lib').PDFNumber | undefined} */ (dict.get(PDFName.of('BitsPerComponent')))?.asNumber?.() || 8;

        if (!colorSpace) return null;

        let cs = colorSpace;

        if (cs instanceof PDFRef) {
            cs = /** @type {import('pdf-lib').PDFName | import('pdf-lib').PDFArray} */ (context.lookup(cs));
        }

        if (cs instanceof PDFName) {
            const name = cs.asString();
            if (name === '/DeviceRGB') {
                return { type: 'DeviceRGB', components: 3, inputFormat: TYPE_RGB_8, sourceProfile: 'sRGB' };
            }
            if (name === '/DeviceCMYK') {
                return { type: 'DeviceCMYK', components: 4, inputFormat: TYPE_CMYK_8 };
            }
            if (name === '/DeviceGray') {
                return { type: 'DeviceGray', components: 1, inputFormat: TYPE_GRAY_8, sourceProfile: 'sGray' };
            }
        }

        if (cs instanceof PDFArray) {
            const items = cs.asArray();
            const first = items[0];

            if (first instanceof PDFName) {
                const name = first.asString();

                if (name === '/ICCBased') {
                    const profileRef = items[1];
                    if (profileRef instanceof PDFRef) {
                        const profileStream = context.lookup(profileRef);
                        if (profileStream instanceof PDFRawStream) {
                            const n = /** @type {import('pdf-lib').PDFNumber | undefined} */ (profileStream.dict.get(PDFName.of('N')))?.asNumber?.() || 0;

                            if (n === 3) {
                                const profileData = this.#getDecompressedStreamContents(profileStream);
                                return {
                                    type: 'ICCBased-RGB',
                                    components: 3,
                                    inputFormat: TYPE_RGB_8,
                                    sourceProfile: profileData,
                                };
                            } else if (n === 4) {
                                const profileData = this.#getDecompressedStreamContents(profileStream);
                                return {
                                    type: 'ICCBased-CMYK',
                                    components: 4,
                                    inputFormat: TYPE_CMYK_8,
                                    sourceProfile: profileData,
                                };
                            } else if (n === 1) {
                                const profileData = this.#getDecompressedStreamContents(profileStream);
                                return {
                                    type: 'ICCBased-Gray',
                                    components: 1,
                                    inputFormat: TYPE_GRAY_8,
                                    sourceProfile: profileData,
                                };
                            }
                        }
                    }
                }

                if (name === '/Lab') {
                    return {
                        type: 'Lab',
                        components: 3,
                        inputFormat: bitsPerComponent === 16 ? TYPE_Lab_16 : TYPE_Lab_8,
                        sourceProfile: 'Lab',
                    };
                }

                // Indexed color space: [/Indexed base hival lookup]
                if (name === '/Indexed') {
                    let baseCs = items[1];
                    if (baseCs instanceof PDFRef) {
                        baseCs = /** @type {import('pdf-lib').PDFName | import('pdf-lib').PDFArray} */ (context.lookup(baseCs));
                    }

                    const hivalItem = items[2];
                    const hival = hivalItem instanceof PDFNumber ? hivalItem.asNumber() : 255;

                    // Get the base color space info recursively
                    /** @type {import('../pdf-document-color-converter.js').PDFColorSpaceInformation?} */
                    let baseInfo = null;

                    if (baseCs instanceof PDFName) {
                        const baseName = baseCs.asString();
                        if (baseName === '/DeviceRGB') {
                            baseInfo = { type: 'DeviceRGB', components: 3, inputFormat: TYPE_RGB_8, sourceProfile: 'sRGB' };
                        } else if (baseName === '/DeviceCMYK') {
                            baseInfo = { type: 'DeviceCMYK', components: 4, inputFormat: TYPE_CMYK_8 };
                        } else if (baseName === '/DeviceGray') {
                            baseInfo = { type: 'DeviceGray', components: 1, inputFormat: TYPE_GRAY_8, sourceProfile: 'sGray' };
                        }
                    } else if (baseCs instanceof PDFArray) {
                        const baseItems = baseCs.asArray();
                        const baseFirst = baseItems[0];
                        if (baseFirst instanceof PDFName) {
                            const baseTypeName = baseFirst.asString();
                            if (baseTypeName === '/Lab') {
                                baseInfo = {
                                    type: 'Lab',
                                    components: 3,
                                    inputFormat: TYPE_Lab_8,
                                    sourceProfile: 'Lab',
                                };
                            } else if (baseTypeName === '/ICCBased') {
                                const iccProfileRef = baseItems[1];
                                if (iccProfileRef instanceof PDFRef) {
                                    const profileStream = context.lookup(iccProfileRef);
                                    if (profileStream instanceof PDFRawStream) {
                                        const nItem = profileStream.dict.get(PDFName.of('N'));
                                        const n = nItem instanceof PDFNumber ? nItem.asNumber() : 0;
                                        const profileData = this.#getDecompressedStreamContents(profileStream);
                                        if (n === 3) {
                                            baseInfo = { type: 'ICCBased-RGB', components: 3, inputFormat: TYPE_RGB_8, sourceProfile: profileData };
                                        } else if (n === 4) {
                                            baseInfo = { type: 'ICCBased-CMYK', components: 4, inputFormat: TYPE_CMYK_8, sourceProfile: profileData };
                                        } else if (n === 1) {
                                            baseInfo = { type: 'ICCBased-Gray', components: 1, inputFormat: TYPE_GRAY_8, sourceProfile: profileData };
                                        }
                                    }
                                }
                            }
                        }
                    }

                    if (baseInfo) {
                        // Get lookup table data
                        let lookupData = null;
                        const lookupItem = items[3];
                        if (lookupItem instanceof PDFRef) {
                            const lookupStream = context.lookup(lookupItem);
                            if (lookupStream instanceof PDFRawStream) {
                                lookupData = this.#getDecompressedStreamContents(lookupStream);
                            }
                        } else if (lookupItem instanceof PDFHexString) {
                            // Hex string lookup table - decode hex to bytes
                            const hexStr = lookupItem.asString();
                            lookupData = new Uint8Array(hexStr.length / 2);
                            for (let i = 0; i < lookupData.length; i++) {
                                lookupData[i] = parseInt(hexStr.substring(i * 2, i * 2 + 2), 16);
                            }
                        } else if (lookupItem instanceof PDFString) {
                            // String literal lookup table - string bytes are the raw data
                            const str = lookupItem.asString();
                            lookupData = new Uint8Array(str.length);
                            for (let i = 0; i < str.length; i++) {
                                lookupData[i] = str.charCodeAt(i);
                            }
                        }

                        return {
                            type: 'Indexed',
                            baseType: /** @type {import('../pdf-document-color-converter.js').PDFColorSpaceInformation['baseType']} */ (baseInfo.type),
                            baseComponents: baseInfo.components,
                            baseInputFormat: baseInfo.inputFormat,
                            baseSourceProfile: baseInfo.sourceProfile,
                            hival,
                            lookupData,
                            // For Indexed, the image itself has 1 component (the index)
                            components: 1,
                            inputFormat: TYPE_GRAY_8,  // Indices are single bytes
                        };
                    }
                }
            }
        }

        return null;
    }

    // ========================================
    // Resource Cleanup
    // ========================================

    /**
     * Disposes of all owned resources.
     * @override
     */
    dispose() {
        this.#pako = null;
        super.dispose();
    }
}
