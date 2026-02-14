// @ts-check
/**
 * PDFDocumentColorConverter - Document-level color conversion orchestrator.
 *
 * Coordinates page converters for an entire PDF document.
 * Manages ProfilePool, BufferRegistry, and WorkerPool.
 *
 * @module PDFDocumentColorConverter
 */

import { CompositeColorConverter } from './composite-color-converter.js';
import { ColorEngineProvider } from './color-engine-provider.js';
import { ProfilePool } from './profile-pool.js';
import { BufferRegistry } from './buffer-registry.js';
import { PDFPageColorConverter } from './pdf-page-color-converter.js';
import { PDFRawStream, PDFName, PDFArray, PDFDict, PDFRef, PDFNumber, PDFHexString, PDFString } from 'pdf-lib';
import {
    TYPE_RGB_8,
    TYPE_CMYK_8,
    TYPE_GRAY_8,
    TYPE_Lab_8,
    TYPE_Lab_16,
} from '../packages/color-engine/src/index.js';

/**
 * @typedef {import('./pdf-page-color-converter.js').PDFPageColorConverterConfiguration & {
 *   colorEnginePath?: string,
 *   profilePool?: ProfilePool,
 *   maxCachedProfiles?: number,
 *   maxProfileMemory?: number,
 *   pageOverrides?: Map<import('pdf-lib').PDFRef, Partial<import('./pdf-page-color-converter.js').PDFPageColorConverterConfiguration>>,
 *   engineVersion?: string,
 * }} PDFDocumentColorConverterConfiguration
 */

/**
 * @typedef {{
 *   pdfDocument: import('pdf-lib').PDFDocument,
 * }} PDFDocumentColorConverterInput
 */

/**
 * @typedef {{
 *   pagesProcessed: number,
 *   imagesConverted: number,
 *   contentStreamsConverted: number,
 *   totalColorOperationsConverted: number,
 *   errors: string[],
 *   pageResults: Array<import('./pdf-page-color-converter.js').PDFPageColorConverterResult>,
 * }} PDFDocumentColorConverterResult
 */

/**
 * Descriptor for normalized D50 Lab color space.
 *
 * Provides everything needed for Lab output in content streams and images.
 *
 * @typedef {{
 *   name: string,
 *   resource: import('pdf-lib').PDFArray | import('pdf-lib').PDFDict,
 *   ref?: import('pdf-lib').PDFRef,
 *   isEmbedded: boolean,
 *   whitePoint: [number, number, number],
 *   range: [number, number, number, number],
 * }} NormalizedLabColorSpaceDescriptor
 */

/**
 * Color space definition for Lab range.
 * @typedef {{
 *   colorSpaceType?: string,
 *   range?: number[],
 *   profileRef?: import('pdf-lib').PDFRef,
 *   sourceProfile?: ArrayBuffer | ArrayBufferLike,
 * }} PDFColorSpaceDefinition
 */

/**
 * @typedef {{
 *   type: keyof typeof PDFDocumentColorConverter.COLOR_SPACE_TYPES,
 *   components: number,
 *   inputFormat: number,
 *   sourceProfile?: any,
 *   baseType?: Exclude<keyof typeof PDFDocumentColorConverter.COLOR_SPACE_TYPES, 'Indexed'>,
 *   baseComponents?: number,
 *   baseInputFormat?: number,
 *   baseSourceProfile?: any,
 *   hival?: number,
 *   lookupData?: Uint8Array | null,
 *   colorSpace?: import('./color-converter.js').ColorType,
 * }} PDFColorSpaceInformation
 */

/**
 * D50 Lab color space constants.
 * @type {{ whitePoint: [number, number, number], range: [number, number, number, number] }}
 */
const D50_LAB_CONSTANTS = {
    whitePoint: [0.96422, 1.0, 0.82521],
    range: [-128, 127, -128, 127],
};

/**
 * Orchestrates color conversion for an entire PDF document.
 *
 * @extends CompositeColorConverter
 * @example
 * ```javascript
 * const documentConverter = new PDFDocumentColorConverter({
 *     destinationProfile: cmykProfile,
 *     destinationColorSpace: 'CMYK',
 *     renderingIntent: 'preserve-k-only-relative-colorimetric-gcr',
 *     blackPointCompensation: true,
 *     convertImages: true,
 *     convertContentStreams: true,
 *     useWorkers: true,
 *     verbose: true,
 * });
 *
 * const result = await documentConverter.convertColor({
 *     pdfDocument: pdfDoc,
 * });
 *
 * console.log(`Converted ${result.imagesConverted} images, ${result.contentStreamsConverted} streams`);
 * documentConverter.dispose();
 * ```
 */
export class PDFDocumentColorConverter extends CompositeColorConverter {
    /** @type {ProfilePool} */
    #profilePool;

    /** @type {BufferRegistry} */
    #bufferRegistry;

    /** @type {boolean} */
    #ownsProfilePool = false;

    /** @type {typeof import('pako') | null} */
    #pako = null;

    /** @type {Promise<void>} */
    #ready;

    /** @type {NormalizedLabColorSpaceDescriptor | null} */
    #cachedLabDescriptor = null;

    /** @type {import('pdf-lib').PDFDocument | null} */
    #currentDocument = null;

    // ========================================
    // Static Version Check
    // ========================================

    /**
     * Checks whether a color engine version is supported.
     * Supports color-engine-2026-02-14 and later.
     *
     * @param {string} engineVersion - Version date string (e.g., 'color-engine-2026-02-14')
     * @returns {boolean}
     */
    static isColorEngineSupported(engineVersion) {
        return ColorEngineProvider.parseVersionNumber(engineVersion) >= 20260214;
    }

    // ========================================
    // Constructor
    // ========================================

    /**
     * Creates a new PDFDocumentColorConverter.
     *
     * @param {PDFDocumentColorConverterConfiguration} configuration
     */
    constructor(configuration) {
        // Version validation at the document converter entry point
        const engineVersion = configuration.engineVersion;
        if (engineVersion != null && !/** @type {typeof PDFDocumentColorConverter} */ (new.target).isColorEngineSupported(engineVersion)) {
            throw new Error(`${new.target.name} does not support engine version "${engineVersion}"`);
        }

        // Pass engineVersion and colorEnginePath through options
        super(configuration, {
            engineVersion: configuration.engineVersion,
            colorEnginePath: configuration.colorEnginePath,
        });
        this.#ready = this.#initialize();
    }

    /**
     * Async initialization for pools and workers.
     * @returns {Promise<void>}
     */
    async #initialize() {
        // Wait for parent (CompositeColorConverter) initialization first
        await super.ensureReady();

        const config = /** @type {PDFDocumentColorConverterConfiguration} */ (this.configuration);

        // ProfilePool setup (own or shared)
        if (config.profilePool) {
            this.#profilePool = config.profilePool;
            this.#ownsProfilePool = false;
        } else {
            this.#profilePool = new ProfilePool({
                maxProfiles: config.maxCachedProfiles ?? 32,
                maxMemoryBytes: config.maxProfileMemory ?? 64 * 1024 * 1024,
            });
            this.#ownsProfilePool = true;
        }

        // BufferRegistry is always owned (pass diagnostics for span tracking)
        this.#bufferRegistry = new BufferRegistry({ diagnostics: this.diagnostics });

        // Load pako for decompression
        try {
            this.#pako = await import('pako');
        } catch {
            console.warn('[PDFDocumentColorConverter] pako not available - ICC profile decompression disabled');
        }

        // WorkerPool handled by CompositeColorConverter parent

        // Register for automatic profile cleanup
        if (config.destinationProfile) {
            this.#profilePool.registerConsumer(this, config.destinationProfile);
        }
    }

    /**
     * Ensures the converter is ready for use.
     * Overrides parent to include document-level initialization.
     * @returns {Promise<void>}
     */
    async ensureReady() {
        await super.ensureReady();
        await this.#ready;
    }

    // ========================================
    // Configuration Getters
    // ========================================

    /**
     * @returns {Readonly<PDFDocumentColorConverterConfiguration>}
     */
    get configuration() {
        return /** @type {Readonly<PDFDocumentColorConverterConfiguration>} */ (super.configuration);
    }

    /**
     * @returns {ProfilePool}
     */
    get profilePool() {
        return this.#profilePool;
    }

    /**
     * @returns {BufferRegistry}
     */
    get bufferRegistry() {
        return this.#bufferRegistry;
    }

    // ========================================
    // Configuration Derivation
    // ========================================

    /**
     * Derives configuration for a specific page.
     *
     * @param {import('pdf-lib').PDFRef} pageRef - The page reference
     * @returns {import('./pdf-page-color-converter.js').PDFPageColorConverterConfiguration}
     */
    derivePageConfiguration(pageRef) {
        const base = this.configuration;
        const override = this.getConfigurationFor(pageRef);

        // Also check pageOverrides Map
        const pageMapOverride = base.pageOverrides?.get(pageRef);

        return /** @type {import('./pdf-page-color-converter.js').PDFPageColorConverterConfiguration} */ ({
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
            bufferRegistry: this.#bufferRegistry,

            // Nested configurations
            imageConfiguration: base.imageConfiguration,
            contentStreamConfiguration: base.contentStreamConfiguration,

            // Apply per-page overrides (Map takes precedence)
            ...override,
            ...pageMapOverride,
        });
    }

    /**
     * Derives configuration for a specific image (convenience method).
     *
     * @param {import('pdf-lib').PDFRef} imageRef - The image reference
     * @param {import('pdf-lib').PDFRef} [pageRef] - Optional page reference for page-level overrides
     * @returns {import('./pdf-image-color-converter.js').PDFImageColorConverterConfiguration}
     */
    deriveImageConfiguration(imageRef, pageRef) {
        const pageConfig = pageRef
            ? this.derivePageConfiguration(pageRef)
            : this.configuration;
        const imageOverride = this.getConfigurationFor(imageRef);

        return /** @type {import('./pdf-image-color-converter.js').PDFImageColorConverterConfiguration} */ ({
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
     * Processes each page sequentially, coordinating image and content stream
     * conversion through PDFPageColorConverter instances.
     *
     * @param {PDFDocumentColorConverterInput} input - Document to convert
     * @param {object} [context={}] - Conversion context
     * @returns {Promise<PDFDocumentColorConverterResult>}
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

                // Derive page-specific configuration
                const pageConfig = this.derivePageConfiguration(pageRef);

                // Create page converter with shared resources (uses createChildConverter to inherit policy)
                const pageConverter = this.createChildConverter(PDFPageColorConverter, pageConfig);

                /** @type {import('./pdf-page-color-converter.js').PDFPageColorConverterResult | undefined} */
                let result;

                try {
                    await pageConverter.ensureReady();

                    // Collect images and content streams for this page
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

    /**
     * Collects images and content streams from a page.
     *
     * @param {import('pdf-lib').PDFPage} page
     * @param {import('pdf-lib').PDFContext} context
     * @param {number} pageIndex
     */
    #collectPageData(page, context, pageIndex) {
        /** @type {import('./pdf-page-color-converter.js').PDFPageColorConverterInputImage[]} */
        const images = [];
        /** @type {import('./pdf-page-color-converter.js').PDFPageColorConverterContentStreamImage[]} */
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
     * For ICCBased color spaces, parses the ICC profile header to determine
     * the actual color space (Gray, RGB, CMYK).
     *
     * @param {import('pdf-lib').PDFDict} pageDict
     * @param {import('pdf-lib').PDFContext} context
     * @returns {Record<string, PDFColorSpaceDefinition>}
     */
    #extractColorSpaceDefinitions(pageDict, context) {
        /** @type {Record<string, PDFColorSpaceDefinition>} */
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
                    /** @type {PDFColorSpaceDefinition} */
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
                // Use pako for decompression (same as pdfImageColorConverter)
                // Dynamic import would be cleaner but sync decompression is needed here
                const pako = this.#pako;
                if (pako) {
                    return pako.inflate(contents);
                }
                // Fallback: try using built-in DecompressionStream if available
                console.warn('[PDFDocumentColorConverter] pako not loaded, returning compressed data');
            } catch (error) {
                console.warn('[PDFDocumentColorConverter] Failed to decompress stream:', error.message);
            }
        }

        return contents;
    }

    /**
     * Gets color space info from an image XObject.
     *
     * @param {import('pdf-lib').PDFDict} dict
     * @param {import('pdf-lib').PDFContext} context
     * @returns {PDFColorSpaceInformation?}
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
                                // Get profile data (may need decompression)
                                const profileData = this.#getDecompressedStreamContents(profileStream);
                                return {
                                    type: 'ICCBased-RGB',
                                    components: 3,
                                    inputFormat: TYPE_RGB_8,
                                    sourceProfile: profileData,
                                };
                            } else if (n === 4) {
                                // Get profile data (may need decompression)
                                const profileData = this.#getDecompressedStreamContents(profileStream);
                                return {
                                    type: 'ICCBased-CMYK',
                                    components: 4,
                                    inputFormat: TYPE_CMYK_8,
                                    sourceProfile: profileData,
                                };
                            } else if (n === 1) {
                                // Grayscale ICC profile
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
                    // items[1] = base color space
                    // items[2] = hival (max index, so palette has hival+1 entries)
                    // items[3] = lookup table (string or stream)
                    let baseCs = items[1];
                    if (baseCs instanceof PDFRef) {
                        baseCs = /** @type {import('pdf-lib').PDFName | import('pdf-lib').PDFArray} */ (context.lookup(baseCs));
                    }

                    const hivalItem = items[2];
                    const hival = hivalItem instanceof PDFNumber ? hivalItem.asNumber() : 255;

                    // Get the base color space info recursively
                    /** @type {PDFColorSpaceInformation?} */
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
                                const profileRef = baseItems[1];
                                if (profileRef instanceof PDFRef) {
                                    const profileStream = context.lookup(profileRef);
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
                            baseType: /** @type {PDFColorSpaceInformation['baseType']} */ (baseInfo.type),
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
    // Worker Mode Support
    // ========================================

    /**
     * Prepares worker tasks for the entire document.
     *
     * @param {PDFDocumentColorConverterInput} input
     * @param {object} context
     * @returns {object}
     */
    prepareWorkerTask(input, context) {
        // Document-level worker task would coordinate all page tasks
        // This is typically handled by convertWithWorkers in WorkerColorConversion.js
        return {
            type: 'document',
            pageCount: input.pdfDocument.getPageCount(),
        };
    }

    /**
     * Applies worker processing results back to the PDF document.
     *
     * This is the top-level method that actually writes transformed data back
     * to the PDF structure. It receives results from all pages and applies
     * them by:
     * 1. Creating new PDFRawStream objects with compressed data
     * 2. Updating stream dictionaries (Filter, ColorSpace, BitsPerComponent)
     * 3. Assigning the new streams to their original references
     *
     * @override
     * @param {PDFDocumentColorConverterInput} input - Original document input
     * @param {import('./color-converter.js').WorkerResult} workerResult - Document-level worker result
     * @param {object} context - Conversion context
     * @returns {Promise<void>}
     */
    async applyWorkerResult(input, workerResult, context) {
        await this.#ready;

        const config = this.configuration;
        const { pdfDocument } = input;
        const pdfContext = pdfDocument.context;

        if (!workerResult.success) {
            if (config.verbose) {
                console.warn(`[PDFDocumentColorConverter] Worker failed: ${workerResult.error}`);
            }
            return;
        }

        // Worker result contains page results with image and content stream data
        const pageResults = workerResult.pageResults ?? [];

        if (config.verbose) {
            console.log(`[PDFDocumentColorConverter] Applying worker results to ${pageResults.length} pages`);
        }

        let totalImagesApplied = 0;
        let totalStreamsApplied = 0;

        // Process each page's results
        for (const pageResult of pageResults) {
            // Apply image results to PDF
            const imageResults = pageResult.imageWorkerResults ?? [];
            for (const imageResult of imageResults) {
                if (imageResult && imageResult.streamRef && imageResult.streamData) {
                    try {
                        this.#applyStreamResult(pdfContext, imageResult.streamRef, imageResult, 'image');
                        totalImagesApplied++;
                    } catch (error) {
                        if (config.verbose) {
                            console.warn(`[PDFDocumentColorConverter] Failed to apply image result: ${error}`);
                        }
                    }
                }
            }

            // Apply content stream results to PDF
            const streamResults = pageResult.contentStreamWorkerResults ?? [];
            for (const streamResult of streamResults) {
                if (streamResult && streamResult.streamRef && streamResult.compressedData) {
                    try {
                        this.#applyStreamResult(pdfContext, streamResult.streamRef, streamResult, 'content-stream');
                        totalStreamsApplied++;
                    } catch (error) {
                        if (config.verbose) {
                            console.warn(`[PDFDocumentColorConverter] Failed to apply content stream result: ${error}`);
                        }
                    }
                }
            }
        }

        // Store summary in context
        /** @type {{ documentWorkerResult: import('./color-converter.js').WorkerResult}} */ (context).documentWorkerResult = {
            pagesProcessed: pageResults.length,
            imagesApplied: totalImagesApplied,
            contentStreamsApplied: totalStreamsApplied,
        };

        if (config.verbose) {
            console.log(`[PDFDocumentColorConverter] Applied ${totalImagesApplied} images, ${totalStreamsApplied} content streams`);
        }
    }

    /**
     * Applies a single stream result to the PDF.
     *
     * Creates a new PDFRawStream with the transformed data and updates
     * the stream dictionary as appropriate for the stream type.
     *
     * @param {import('pdf-lib').PDFContext} pdfContext - PDF context
     * @param {import('pdf-lib').PDFRef} streamRef - Reference to the stream
     * @param {import('./color-converter.js').WorkerResult} result - Worker result containing stream data
     * @param {'image' | 'content-stream'} type - Type of stream
     */
    #applyStreamResult(pdfContext, streamRef, result, type) {
        // Get the original stream to clone its dictionary
        const originalStream = pdfContext.lookup(streamRef);
        if (!(originalStream instanceof PDFRawStream)) {
            throw new Error(`Stream ${streamRef} is not a PDFRawStream`);
        }

        // Get the compressed data
        const compressedData = result.compressedData ?? result.streamData;
        if (!(compressedData instanceof Uint8Array)) {
            throw new Error(`Invalid compressed data for stream ${streamRef}`);
        }

        // Clone the dictionary and update it
        const newDict = originalStream.dict.clone(pdfContext);

        // Update filter (workers always deflate output)
        newDict.set(PDFName.of('Filter'), PDFName.of('FlateDecode'));

        // Remove Length (will be recalculated)
        newDict.delete(PDFName.of('Length'));

        // For images, update color space and bits per component
        if (type === 'image') {
            newDict.set(PDFName.of('ColorSpace'), PDFName.of('DeviceCMYK'));
            newDict.set(PDFName.of('BitsPerComponent'), PDFNumber.of(result.bitsPerComponent ?? 8));
        }

        // Create new stream and assign to reference
        const newStream = PDFRawStream.of(newDict, compressedData);
        pdfContext.assign(streamRef, newStream);
    }

    // ========================================
    // Lab Color Space Management
    // ========================================

    /**
     * Gets or creates a normalized D50 Lab color space descriptor.
     *
     * Searches the document for an existing Lab color space with matching
     * whitepoint and range. If found, reuses it. Otherwise, creates a new
     * Lab color space and embeds it in the document.
     *
     * The descriptor is cached per document - subsequent calls return the
     * same descriptor without re-scanning.
     *
     * @param {import('pdf-lib').PDFDocument} pdfDocument - The document to search/embed in
     * @returns {NormalizedLabColorSpaceDescriptor}
     */
    getNormalizedLabColorSpaceDescriptor(pdfDocument) {
        // Check if we have a cached descriptor for this document
        if (this.#cachedLabDescriptor && this.#currentDocument === pdfDocument) {
            return this.#cachedLabDescriptor;
        }

        // Store current document reference for cache invalidation
        this.#currentDocument = pdfDocument;

        const pdfContext = pdfDocument.context;
        const { whitePoint, range } = D50_LAB_CONSTANTS;

        // Search for existing matching Lab color space
        const existing = this.#findMatchingLabColorSpace(pdfDocument);
        if (existing) {
            this.#cachedLabDescriptor = existing;
            return existing;
        }

        // Create new Lab color space
        const labDict = pdfContext.obj({
            WhitePoint: whitePoint,
            Range: range,
        });

        // Create the color space array: [/Lab << dict >>]
        const labArray = pdfContext.obj([PDFName.of('Lab'), labDict]);

        // Register as indirect object to get a reference
        const labRef = pdfContext.register(labArray);

        // Build descriptor
        this.#cachedLabDescriptor = {
            name: 'Lab',
            resource: labArray,
            ref: labRef,
            isEmbedded: true,
            whitePoint: [...whitePoint],
            range: [...range],
        };

        return this.#cachedLabDescriptor;
    }

    /**
     * Searches the document for an existing Lab color space with matching parameters.
     *
     * @param {import('pdf-lib').PDFDocument} pdfDocument
     * @returns {NormalizedLabColorSpaceDescriptor | null}
     */
    #findMatchingLabColorSpace(pdfDocument) {
        const pdfContext = pdfDocument.context;
        const { whitePoint, range } = D50_LAB_CONSTANTS;

        // Iterate through all pages to find Lab color spaces in resources
        const pages = pdfDocument.getPages();
        for (const page of pages) {
            const resources = page.node.Resources();
            if (!resources) continue;

            const colorSpaces = resources.get(PDFName.of('ColorSpace'));
            if (!(colorSpaces instanceof PDFDict)) continue;

            // Check each color space entry
            const entries = colorSpaces.entries();
            for (const [name, value] of entries) {
                const csArray = value instanceof PDFRef
                    ? pdfContext.lookup(value)
                    : value;

                if (!(csArray instanceof PDFArray)) continue;

                const items = csArray.asArray();
                if (items.length < 2) continue;

                const csType = items[0];
                if (!(csType instanceof PDFName) || csType.asString() !== '/Lab') continue;

                // Found a Lab color space - check if it matches
                const labDict = items[1] instanceof PDFRef
                    ? pdfContext.lookup(items[1])
                    : items[1];

                if (!(labDict instanceof PDFDict)) continue;

                // Check whitepoint
                const wpArray = labDict.get(PDFName.of('WhitePoint'));
                if (!(wpArray instanceof PDFArray)) continue;

                const wpItems = wpArray.asArray();
                if (wpItems.length !== 3) continue;

                const wp = wpItems.map(item =>
                    item instanceof PDFNumber ? item.asNumber() : 0
                );

                // Compare whitepoint with tolerance
                const wpMatches = wp.every((v, i) =>
                    Math.abs(v - whitePoint[i]) < 0.00001
                );
                if (!wpMatches) continue;

                // Check range (optional, defaults to [-100, 100, -100, 100])
                const rangeArray = labDict.get(PDFName.of('Range'));
                let rangeValues = [-100, 100, -100, 100]; // Default
                if (rangeArray instanceof PDFArray) {
                    const rangeItems = rangeArray.asArray();
                    if (rangeItems.length === 4) {
                        rangeValues = rangeItems.map(item =>
                            item instanceof PDFNumber ? item.asNumber() : 0
                        );
                    }
                }

                // Compare range
                const rangeMatches = rangeValues.every((v, i) =>
                    Math.abs(v - range[i]) < 0.00001
                );
                if (!rangeMatches) continue;

                // Found matching Lab color space
                const nameStr = name instanceof PDFName ? name.asString().replace(/^\//, '') : 'Lab';
                return {
                    name: nameStr,
                    resource: csArray,
                    ref: value instanceof PDFRef ? value : undefined,
                    isEmbedded: false,
                    whitePoint: /** @type {[number, number, number]} */ (wp),
                    range: /** @type {[number, number, number, number]} */ (rangeValues),
                };
            }
        }

        return null;
    }

    // ========================================
    // Resource Cleanup
    // ========================================

    /**
     * Disposes of all owned resources.
     */
    dispose() {
        if (this.#ownsProfilePool && this.#profilePool) {
            this.#profilePool.dispose();
        }

        // WorkerPool cleanup handled by CompositeColorConverter parent

        if (this.#bufferRegistry) {
            this.#bufferRegistry.dispose();
        }

        super.dispose();
    }

    static COLOR_SPACE_TYPES = {
        'DeviceRGB': /** @type {'RGB'} */ 'RGB',
        'DeviceGray': /** @type {'Gray'} */ 'Gray',
        'DeviceCMYK': /** @type {'CMYK'} */ 'CMYK',
        'ICCBased-RGB': /** @type {'RGB'} */ 'RGB',
        'ICCBased-CMYK': /** @type {'CMYK'} */ 'CMYK',
        'ICCBased-Gray': /** @type {'Gray'} */ 'Gray',
        'Lab':  /** @type {'Lab'} */ 'Lab',
        'Indexed': 'Indexed',
    };
}
