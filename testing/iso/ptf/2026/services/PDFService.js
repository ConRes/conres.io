// @ts-check

import {
    PDFDict,
    PDFDocument,
    PDFRawStream,
    PDFArray,
    PDFRef,
    PDFName,
    PDFString,
    PDFHexString,
    PDFPageLeaf,
    decodePDFRawStream,
} from "../packages/pdf-lib/pdf-lib.esm.js";

import {
    dumpPDFDocument,
    Buffer,
} from "../helpers.js";

import { ICCService } from "./ICCService.js";

import {
    isICCBasedColorSpace,
    getICCProfileRefFromColorSpace,
    parseICCProfileFromRef,
    analyzeColorSpaces,
    replaceICCWithDeviceColorSpaces,
    analyzePageColors,
    replaceContentStreamColors,
    encodeContentStreamText,
    extractImageMetadata,
    extractImagePixels,
    updateImageStream,
    getComponentsForColorSpace,
    UniqueColorSpaceRecords,
} from "./ColorSpaceUtils.js";

import { ColorEngineService } from "./ColorEngineService.js";
import { ProfileSelectionService } from "./ProfileSelectionService.js";
import { WorkerPool } from "./WorkerPool.js";
import { convertWithWorkers } from "./WorkerColorConversion.js";

import { lookupMaybe, decodeText, compressWithFlateDecode } from "./helpers/pdf-lib.js";
import { NO_OP_DIAGNOSTICS } from '../classes/diagnostics/diagnostics-collector.js';

// Debug flags - can be toggled for debugging
const DEBUG_TRANSPARENCY_BLENDING_OPERATIONS = false;

/**
 * Service for PDF manipulation operations
 */
export class PDFService {

    /**
     * @typedef {{
     *   page: number,
     *   pageRef: PDFRef,
     *   colorSpaceConversions: number,
     *   contentStreamConversions: number,
     *   imageConversions: number,
     *   pageColorAnalysis: import('./ColorSpaceUtils.js').PageColorAnalysis,
     * }} PageConversionResult
     */

    /**
     * @typedef {{
     *   pagesProcessed: number,
     *   totalColorSpaceConversions: number,
     *   totalContentStreamConversions: number,
     *   totalImageConversions: number,
     *   pageResults: PageConversionResult[],
     *   imageColorLocations: ImageColorLocation[],
     *   contentStreamColorLocations: ContentStreamColorLocation[],
     *   iccProfileLocations: Map<PDFRef, ICCProfileLocation>,
     *   colorSpaceDefinitionLocations: Map<PDFArray | PDFName, ColorSpaceDefinitionLocation>,
     * }} DocumentConversionResult
     */

    /**
     * @typedef {{
     *   ref: PDFRef,
     *   stream: PDFRawStream,
     *   colorSpaceDescriptor: PDFArray | PDFName,
     *   colorSpaceType: string,
     *   iccProfile?: Exclude<ReturnType<typeof parseICCProfileFromRef>, undefined>,
     * }} ImageColorLocation
     */

    /**
     * @typedef {{
     *   pageRef: PDFRef,
     *   streamIndex: number,
     *   stream: PDFRawStream,
     *   chunk: import('./ColorSpaceUtils.js').ContentStreamColorChunk,
     *   colorType: 'gray' | 'rgb' | 'cmyk' | 'indexed',
     *   values?: number[],
     *   colorSpaceName?: string,
     * }} ContentStreamColorLocation
     */

    /**
     * @typedef {{
     *   ref: PDFRef,
     *   stream: PDFRawStream,
     *   buffer: Exclude<ReturnType<parseICCProfileFromRef>, undefined>['buffer'],
     *   header: Exclude<ReturnType<parseICCProfileFromRef>, undefined>['header'],
     *   usageCount: number,
     *   usedBy: Array<{ type: 'image' | 'page-resource', ref: PDFRef, colorSpaceKey?: string }>,
     * }} ICCProfileLocation
     */

    /**
     * @typedef {{
     *   descriptorRef?: PDFRef,
     *   descriptor: PDFArray | PDFName,
     *   colorSpaceType: string,
     *   iccProfileRef?: PDFRef,
     *   resourceKey?: string,
     *   resourceDict?: PDFDict,
     *   pageRef?: PDFRef,
     *   usageCount: number,
     *   usedBy: Array<{ type: 'image' | 'page-resource' | 'content-stream', ref: PDFRef, colorSpaceKey?: string }>,
     * }} ColorSpaceDefinitionLocation
     */

    /**
     * Extracts unique colors from a pixel buffer and builds an index mapping.
     * Each unique color is mapped to the list of pixel positions where it appears.
     *
     * @param {Uint8Array} pixels - Input pixel buffer
     * @param {number} componentsPerPixel - Number of components per pixel (1=Gray, 3=RGB/Lab, 4=CMYK)
     * @returns {{ uniqueColors: Uint8Array, colorToIndices: Map<string, number[]>, totalPixels: number }}
     */
    static #extractUniqueColors(pixels, componentsPerPixel) {
        const colorToIndices = new Map();
        const totalPixels = pixels.length / componentsPerPixel;

        // Build map of color key -> pixel indices
        for (let i = 0; i < totalPixels; i++) {
            const offset = i * componentsPerPixel;
            // Create a key from the color components
            let key = '';
            for (let c = 0; c < componentsPerPixel; c++) {
                key += String.fromCharCode(pixels[offset + c]);
            }

            if (!colorToIndices.has(key)) {
                colorToIndices.set(key, []);
            }
            colorToIndices.get(key).push(i);
        }

        // Build array of unique colors for batch conversion
        const uniqueColorCount = colorToIndices.size;
        const uniqueColors = new Uint8Array(uniqueColorCount * componentsPerPixel);

        let colorIndex = 0;
        for (const key of colorToIndices.keys()) {
            const offset = colorIndex * componentsPerPixel;
            for (let c = 0; c < componentsPerPixel; c++) {
                uniqueColors[offset + c] = key.charCodeAt(c);
            }
            colorIndex++;
        }

        return { uniqueColors, colorToIndices, totalPixels };
    }

    /**
     * Applies converted colors back to create the output pixel buffer using the index mapping.
     *
     * @param {Uint8Array} convertedColors - Converted unique colors (output from color engine)
     * @param {Map<string, number[]>} colorToIndices - Map from original color key to pixel indices
     * @param {number} inputComponents - Number of components per input pixel
     * @param {number} outputComponents - Number of components per output pixel
     * @param {number} totalPixels - Total number of pixels in output
     * @returns {Uint8Array} Output pixel buffer with mapped colors
     */
    static #applyColorMapping(convertedColors, colorToIndices, inputComponents, outputComponents, totalPixels) {
        const output = new Uint8Array(totalPixels * outputComponents);

        let colorIndex = 0;
        for (const [key, indices] of colorToIndices.entries()) {
            const srcOffset = colorIndex * outputComponents;

            // Copy this converted color to all pixels that had the original color
            for (const pixelIndex of indices) {
                const dstOffset = pixelIndex * outputComponents;
                for (let c = 0; c < outputComponents; c++) {
                    output[dstOffset + c] = convertedColors[srcOffset + c];
                }
            }
            colorIndex++;
        }

        return output;
    }

    /**
     * Converts colors throughout a PDF document from source to destination color space.
     * This method traverses the document to locate and convert colors in:
     * - Page content streams (color operators like RG, rg, K, k, G, g, SC, sc, etc.)
     * - XObject images with ICC-based color spaces
     * - Color space definitions in page resources
     * 
     * @param {PDFDocument} pdfDocument - The PDF document to convert
     * @param {object} options - Conversion options
     * @param {ArrayBuffer | string} [options.sourceProfile] - Source ICC profile (auto-detected if not provided)
     * @param {ArrayBuffer | string} options.destinationProfile - Destination ICC profile
     * @param {'k-only' | import('./ColorEngineService.js').RenderingIntent} [options.renderingIntent='relative-colorimetric'] - Rendering intent
     * @param {boolean} [options.convertImages=true] - Whether to convert image color spaces
     * @param {boolean} [options.convertContentStreams=true] - Whether to convert content stream colors
     * @param {boolean} [options.compressImages=false] - Whether to apply FlateDecode compression to converted images
     * @param {boolean} [options.updateBlendingSpace=false] - NOT IMPLEMENTED - throws if true. Use replaceTransarencyBlendingSpaceInPDFDocument separately.
     * @param {boolean} [options.useIndexedImages=false] - Use indexed color approach for images (extract unique colors, convert, map back)
     * @param {boolean} [options.useWorkers=false] - Use worker threads for parallel image conversion (hybrid approach)
     * @param {import('./WorkerPool.js').WorkerPool} [options.workerPool] - Optional pre-initialized WorkerPool instance
     * @param {string} [options.colorEnginePath] - Path to color engine package (e.g., 'packages/color-engine-2026-01-21')
     * @param {boolean} [options.verbose=false] - Whether to log detailed information
     * @param {import('./ColorEngineService.js').ColorEngineService} [options.colorEngineService] - Optional custom ColorEngineService instance
     * @param {import('./ProfileSelectionService.js').ProfileSelectionService} [options.profileSelectionService] - Optional ProfileSelectionService for Device color space profile selection
     * @param {import('../classes/diagnostics/diagnostics-collector.js').DiagnosticsCollector} [options.diagnostics] - Optional diagnostics collector for profiling
     * @returns {Promise<DocumentConversionResult>}
     * 
     * @example
     * ```javascript
     * const result = await PDFService.convertDocumentColors(pdfDocument, {
     *   destinationProfile: cmykProfileBuffer,
     *   renderingIntent: 'relative-colorimetric',
     *   convertImages: true,
     *   convertContentStreams: true,
     * });
     * console.log(`Converted ${result.totalContentStreamConversions} colors`);
     * ```
     */
    static async convertColorInPDFDocument(pdfDocument, options) {
        const {
            sourceProfile,
            destinationProfile,
            renderingIntent = 'relative-colorimetric',
            convertImages = true,
            convertContentStreams = true,
            compressImages = true,
            updateBlendingSpace = false,
            useIndexedImages = false,
            useWorkers = false,
            workerPool = null,
            colorEnginePath = null,
            verbose = false,
            colorEngineService = null,
            profileSelectionService = null,
            diagnostics: diagnosticsOption = null,
        } = options;

        // Get diagnostics collector or use no-op
        const diagnostics = diagnosticsOption ?? NO_OP_DIAGNOSTICS;

        // Start document conversion span
        const documentSpan = diagnostics.startSpan('document-conversion', {
            pageCount: pdfDocument.getPageCount(),
            renderingIntent,
            convertImages,
            convertContentStreams,
            useWorkers,
        });

        try {
        if (!destinationProfile) {
            throw new Error('destinationProfile is required for color conversion');
        }

        if (updateBlendingSpace) {
            throw new Error('updateBlendingSpace is not yet implemented in convertColorInPDFDocument. Use PDFService.replaceTransarencyBlendingSpaceInPDFDocument separately after color conversion.');
        }

        // ========================================
        // Worker-based image conversion (hybrid approach)
        // ========================================
        // When useWorkers is enabled, we use workers for image conversion (parallelizable)
        // and then fall through to the main thread for content streams + any images workers skipped.
        // This is the hybrid approach from benchmark-child-runner.js.
        let workerPoolInstance = workerPool;
        let workerPoolCreatedInternally = false;

        if (useWorkers && convertImages) {
            try {
                // Create worker pool if not provided
                if (!workerPoolInstance) {
                    workerPoolInstance = new WorkerPool({
                        colorEnginePath: colorEnginePath || undefined,
                    });
                    await workerPoolInstance.initialize();
                    workerPoolCreatedInternally = true;
                }

                // Convert destination profile to ArrayBuffer if needed
                const destProfileBuffer = destinationProfile instanceof ArrayBuffer
                    ? destinationProfile
                    : destinationProfile.buffer?.slice?.(
                        destinationProfile.byteOffset ?? 0,
                        (destinationProfile.byteOffset ?? 0) + (destinationProfile.byteLength ?? destinationProfile.length)
                    ) ?? destinationProfile;

                // Run worker-based color conversion (images + content streams)
                const workerResult = await convertWithWorkers(pdfDocument, {
                    destinationProfile: destProfileBuffer,
                    renderingIntent,
                    convertImages: true,
                    convertContentStreams: convertContentStreams, // Workers handle both images AND content streams
                    workerPool: workerPoolInstance,
                    verbose,
                });

                if (verbose) {
                    console.log(`Worker conversion: ${workerResult.tasksProcessed} images processed, ${workerResult.errors.length} errors`);
                }
            } catch (/** @type {any} */ error) {
                if (verbose) {
                    console.warn('Worker conversion failed, falling back to main thread:', error?.message || error);
                }
            } finally {
                // Clean up worker pool if we created it
                if (workerPoolCreatedInternally && workerPoolInstance) {
                    await workerPoolInstance.terminate();
                }
            }

            // Continue with main thread conversion for:
            // - Content streams (always)
            // - Images that workers skipped (DeviceCMYK images already converted will be skipped by main thread)
        }

        // Analyze color spaces in the document (finds all color space designations)
        const analysisResult = analyzeColorSpaces(pdfDocument, { debug: verbose });
        const {
            colorSpaceDesignationTargetsByClassifier,
            colorSpaceDesignationTargetsLookup,
            uniqueColorSpaceRecords,
        } = analysisResult;

        /** @type {PageConversionResult[]} */
        const pageResults = [];
        /** @type {ImageColorLocation[]} */
        const imageColorLocations = [];
        /** @type {ContentStreamColorLocation[]} */
        const contentStreamColorLocations = [];
        /** @type {Map<PDFRef, ICCProfileLocation>} */
        const iccProfileLocations = new Map();
        /** @type {Map<PDFArray | PDFName, ColorSpaceDefinitionLocation>} */
        const colorSpaceDefinitionLocations = new Map();
        /** @type {Map<PDFRef, Record<string, import('./ColorSpaceUtils.js').ColorSpaceDefinition>>} */
        const pageColorSpaceDefinitions = new Map();

        let totalColorSpaceConversions = 0;
        let totalContentStreamConversions = 0;
        let totalImageConversions = 0;

        // ========================================
        // Phase 0: Locate all ICC profiles and color space definitions
        // ========================================
        // Build a map of all unique color space definitions from the analysis
        for (const [descriptor, designations] of colorSpaceDesignationTargetsLookup.entries()) {
            // Get color space definition info from the first designation
            const firstDesignation = designations.values().next().value;
            const colorSpaceType = firstDesignation?.colorSpaceDefinition?.colorSpaceType ?? 'Unknown';

            /** @type {ColorSpaceDefinitionLocation} */
            const definitionLocation = {
                descriptor,
                colorSpaceType,
                usageCount: 0,
                usedBy: [],
            };

            // Check if this is an ICC-based color space and extract the profile reference
            if (descriptor instanceof PDFArray && isICCBasedColorSpace(descriptor)) {
                const iccProfileRef = getICCProfileRefFromColorSpace(descriptor);
                if (iccProfileRef) {
                    definitionLocation.iccProfileRef = iccProfileRef;

                    // Add or update ICC profile location
                    if (!iccProfileLocations.has(iccProfileRef)) {
                        const profile = parseICCProfileFromRef(pdfDocument, iccProfileRef);
                        if (profile) {
                            const profileStream = /** @type {PDFRawStream} */ (pdfDocument.context.lookup(iccProfileRef));
                            iccProfileLocations.set(iccProfileRef, {
                                ref: iccProfileRef,
                                stream: profileStream,
                                buffer: profile.buffer,
                                header: profile.header,
                                usageCount: 0,
                                usedBy: [],
                            });
                        }
                    }
                }
            }

            colorSpaceDefinitionLocations.set(descriptor, definitionLocation);
        }

        // ========================================
        // Phase 1: Locate all XObject Image colors
        // ========================================
        if (convertImages) {
            const xobjectImageDesignations = colorSpaceDesignationTargetsByClassifier['XObjectImage'];

            if (xobjectImageDesignations) {
                for (const [imageStream, designation] of xobjectImageDesignations) {
                    const colorSpaceDescriptor = designation.colorSpaceDefinition?.colorSpaceDescriptor;
                    if (!colorSpaceDescriptor) continue;

                    /** @type {ImageColorLocation} */
                    const imageLocation = {
                        ref: designation.colorSpaceDesignationTargetRef,
                        stream: /** @type {PDFRawStream} */ (imageStream),
                        colorSpaceDescriptor,
                        colorSpaceType: designation.colorSpaceDefinition?.colorSpaceType ?? 'Unknown',
                    };

                    // If ICC-based, extract the profile info and track usage
                    if (isICCBasedColorSpace(/** @type {PDFArray} */(colorSpaceDescriptor))) {
                        const profileRef = getICCProfileRefFromColorSpace(/** @type {PDFArray} */(colorSpaceDescriptor));
                        if (profileRef) {
                            const profile = parseICCProfileFromRef(pdfDocument, profileRef);
                            if (profile) {
                                imageLocation.iccProfile = profile;
                            }

                            // Update ICC profile usage tracking
                            const iccProfileLocation = iccProfileLocations.get(profileRef);
                            if (iccProfileLocation) {
                                iccProfileLocation.usageCount++;
                                iccProfileLocation.usedBy.push({
                                    type: 'image',
                                    ref: designation.colorSpaceDesignationTargetRef,
                                });
                            }
                        }
                    }

                    // Update color space definition usage tracking
                    const definitionLocation = colorSpaceDefinitionLocations.get(colorSpaceDescriptor);
                    if (definitionLocation) {
                        definitionLocation.usageCount++;
                        definitionLocation.usedBy.push({
                            type: 'image',
                            ref: designation.colorSpaceDesignationTargetRef,
                        });
                    }

                    imageColorLocations.push(imageLocation);
                    totalImageConversions++;

                    if (verbose) {
                        console.log(`Found image with color space: ${imageLocation.colorSpaceType}`,
                            imageLocation.iccProfile ? `(ICC: ${imageLocation.iccProfile.header.colorSpace})` : '');
                    }
                }
            }
        }

        // ========================================
        // Phase 2: Locate all content stream colors and page resource color spaces
        // ========================================
        const enumeratedObjects = /** @type {[PDFRef, any][]} */ (
            pdfDocument.context.enumerateIndirectObjects()
        );

        let pageIndex = 0;
        for (const [ref, obj] of enumeratedObjects) {
            if (!(obj instanceof PDFPageLeaf)) continue;

            // Start page span
            const pageSpan = diagnostics.startSpan('page', {
                pageIndex,
                pageRef: ref.toString(),
            });

            let colorSpaceConversions = 0;
            let contentStreamConversions = 0;
            let imageConversions = 0;
            /** @type {ReturnType<typeof analyzePageColors> | undefined} */
            let pageColorAnalysis;

            try {
                const pageLeaf = /** @type {PDFPageLeaf} */ (obj);
                pageColorAnalysis = analyzePageColors(pageLeaf, ref, pdfDocument);

                // Track page-level resource color space definitions
                const pageDesignation = colorSpaceDesignationTargetsByClassifier['Page']?.get(pageLeaf);
                if (pageDesignation?.colorSpaceDefinitions) {
                    // Store color space definitions for this page (used in Phase 3 for Lab detection)
                    pageColorSpaceDefinitions.set(ref, pageDesignation.colorSpaceDefinitions);

                    // const pageResourcesDict = /** @type {PDFDict | undefined} */ (pageLeaf.lookupMaybe(PDFName.of('Resources'), PDFDict));
                    const pageResourcesDict = lookupMaybe(pageLeaf, PDFName.of('Resources'), PDFDict);
                    // const pageColorSpaceDict = /** @type {PDFDict | undefined} */ (pageResourcesDict?.lookupMaybe(PDFName.of('ColorSpace'), PDFDict));
                    const pageColorSpaceDict = lookupMaybe(pageResourcesDict, PDFName.of('ColorSpace'), PDFDict);

                    for (const [colorSpaceKey, colorSpaceDefinition] of Object.entries(pageDesignation.colorSpaceDefinitions)) {
                        const descriptor = colorSpaceDefinition?.colorSpaceDescriptor;
                        if (!descriptor) continue;

                        // Update color space definition location with resource info
                        const definitionLocation = colorSpaceDefinitionLocations.get(descriptor);
                        if (definitionLocation) {
                            definitionLocation.usageCount++;
                            definitionLocation.usedBy.push({
                                type: 'page-resource',
                                ref,
                                colorSpaceKey,
                            });

                            // Store resource dict info if not already set
                            if (!definitionLocation.resourceDict && pageColorSpaceDict) {
                                definitionLocation.resourceKey = colorSpaceKey;
                                definitionLocation.resourceDict = pageColorSpaceDict;
                                definitionLocation.pageRef = ref;
                            }

                            // Track ICC profile usage from page resources
                            if (definitionLocation.iccProfileRef) {
                                const iccProfileLocation = iccProfileLocations.get(definitionLocation.iccProfileRef);
                                if (iccProfileLocation) {
                                    iccProfileLocation.usageCount++;
                                    iccProfileLocation.usedBy.push({
                                        type: 'page-resource',
                                        ref,
                                        colorSpaceKey,
                                    });
                                }
                            }
                        }

                        colorSpaceConversions++;
                        totalColorSpaceConversions++;
                    }
                }

                // Process content stream colors
                if (convertContentStreams) {
                    for (let streamIndex = 0; streamIndex < pageColorAnalysis.parsedStreams.length; streamIndex++) {
                        const { stream, parseResult } = pageColorAnalysis.parsedStreams[streamIndex];

                        for (const chunk of parseResult.chunks) {
                            // Skip non-color chunks
                            if (chunk.type === 'head' || chunk.type === 'string') continue;

                            /** @type {ContentStreamColorLocation} */
                            const colorLocation = {
                                pageRef: ref,
                                streamIndex,
                                stream,
                                chunk,
                                colorType: /** @type {'gray' | 'rgb' | 'cmyk' | 'indexed'} */ (chunk.type),
                                values: chunk.values,
                                colorSpaceName: chunk.name,
                            };

                            contentStreamColorLocations.push(colorLocation);
                            contentStreamConversions++;
                            totalContentStreamConversions++;

                            if (verbose) {
                                const valuesStr = chunk.values ? `[${chunk.values.join(', ')}]` : chunk.name || '';
                                console.log(`  Found ${chunk.type} color: ${valuesStr} (operator: ${chunk.operator})`);
                            }
                        }

                        // Track color space usage statistics
                        if (verbose && parseResult.colorSpaces.length > 0) {
                            console.log(`  Content stream ${streamIndex} color spaces:`, parseResult.colorSpaces);
                        }
                    }
                }

                diagnostics.updateSpan(pageSpan, {
                    colorSpaceConversions,
                    contentStreamConversions,
                    imageConversions,
                });
            } finally {
                // End page span
                diagnostics.endSpan(pageSpan);
            }

            pageResults.push({
                page: pageResults.length,
                pageRef: ref,
                colorSpaceConversions,
                contentStreamConversions,
                imageConversions,
                pageColorAnalysis,
            });
            pageIndex++;
        }

        // ========================================
        // Phase 3: Perform color conversions (batch processing)
        // ========================================
        // Convert colors using ColorEngineService with batch processing:
        // - One doTransform call per source color space type (RGB, Gray)
        // - All colors of the same type across all pages are batched together

        // Determine destination profile color space (CMYK or RGB)
        // This affects how we handle Separation colors and rendering intents
        /** @type {string} */
        let destinationColorSpace = 'CMYK';
        if (typeof destinationProfile !== 'string') {
            const destProfileBytes = destinationProfile instanceof ArrayBuffer
                ? new Uint8Array(destinationProfile)
                : new Uint8Array(destinationProfile);
            const destHeader = ICCService.parseICCHeaderFromSource(destProfileBytes);
            destinationColorSpace = destHeader.colorSpace ?? 'CMYK'; // 'CMYK', 'RGB', 'GRAY', etc.
        }
        const isDestinationCMYK = destinationColorSpace === 'CMYK';
        const isDestinationRGB = destinationColorSpace === 'RGB';

        // For RGB output, K-Only GCR doesn't apply - use Relative Colorimetric + BPC instead
        const effectiveRenderingIntent = isDestinationRGB && renderingIntent === 'preserve-k-only-relative-colorimetric-gcr'
            ? 'relative-colorimetric'
            : renderingIntent;
        const useBlackPointCompensation = isDestinationRGB && renderingIntent === 'preserve-k-only-relative-colorimetric-gcr';

        if (verbose && effectiveRenderingIntent !== renderingIntent) {
            console.log(`Note: Using ${effectiveRenderingIntent} instead of ${renderingIntent} for RGB output profile`);
        }

        // Create shared ColorEngineService instance (caches transforms and profile handles)
        // Use provided instance if available, otherwise create new one
        const colorEngine = colorEngineService ?? new ColorEngineService({
            defaultRenderingIntent: effectiveRenderingIntent,
        });

        if (convertContentStreams && contentStreamColorLocations.length > 0) {
            // Start stream-batch span
            const streamBatchSpan = diagnostics.startSpan('stream-batch', {
                count: contentStreamColorLocations.length,
            });

            try {
            // Group content stream colors by source type for batch processing
            /** @type {Map<'rgb' | 'gray' | 'lab', ContentStreamColorLocation[]>} */
            const locationsBySourceType = new Map();

            for (const location of contentStreamColorLocations) {
                if (!location.values || location.values.length === 0) {
                    continue;
                }

                /** @type {'rgb' | 'gray' | null} */
                let sourceType = null;

                if (location.colorType === 'cmyk') {
                    // DeviceCMYK colors should pass through unchanged regardless of
                    // output profile. Converting DeviceCMYK to RGB is a separate concern.
                    // Skip conversion - leave sourceType as null
                    if (verbose) {
                        console.log(`  Skipping DeviceCMYK color (passthrough): ${location.values.join(', ')}`);
                    }
                } else if (location.colorType === 'rgb') {
                    sourceType = 'rgb';
                } else if (location.colorType === 'gray') {
                    sourceType = 'gray';
                } else if (location.colorType === 'indexed') {
                    // For indexed colors (using named color spaces like /CS1),
                    // look up the actual color space type from page definitions.
                    // This is critical because Lab also has 3 components like RGB!
                    // Note: color space names from content stream have leading '/' (e.g., '/CS1')
                    // but definition keys don't have it (e.g., 'CS1'), so strip the prefix
                    const colorSpaceName = location.colorSpaceName?.replace(/^\//, '');
                    const colorSpaceDefs = pageColorSpaceDefinitions.get(location.pageRef);
                    const colorSpaceDef = colorSpaceName ? colorSpaceDefs?.[colorSpaceName] : null;
                    const colorSpaceType = colorSpaceDef?.colorSpaceType;

                    if (colorSpaceType === 'Lab') {
                        // Lab colors require special handling
                        // Store Lab definition with the location for Range conversion
                        sourceType = 'lab';
                        // @ts-ignore - we attach labDef to the location for later use
                        location.labDef = colorSpaceDef;
                    } else if (colorSpaceType === 'Separation') {
                        /**
                         * TODO [separation/spot support]: Implement Separation/spot color conversion.
                         * Convert Separation alternate color space based on appropriate profile:
                         * - Output intent profile (if available and matching color model)
                         * - Default source profile per policy
                         * - Lab as device-independent fallback
                         * The alternate device color should be converted using the selected profile.
                         *
                         * Current behavior: Pass through unchanged with warning logged.
                         */
                        // Separation colors (spot colors) pass through unchanged for now
                        if (verbose) {
                            console.warn(`[Separation] Skipping conversion for Separation color space: ${colorSpaceName} (passthrough)`);
                        }
                        // Skip conversion - leave sourceType as null
                    } else if (colorSpaceType === 'ICCBased') {
                        // ICCBased colors - determine type by component count
                        const componentCount = location.values.length;
                        if (componentCount === 1) {
                            sourceType = 'gray';
                        } else if (componentCount === 3) {
                            sourceType = 'rgb';
                        }
                        // Skip 4-component (CMYK) - already in target color space
                    } else {
                        // Fallback to component count for determining type
                        // - 1 component: Gray (sGray)
                        // - 3 components: RGB (sRGB) - only if not Lab (checked above)
                        // - 4 components: CMYK (skip - passthrough unchanged)
                        const componentCount = location.values.length;
                        if (componentCount === 1) {
                            sourceType = 'gray';
                        } else if (componentCount === 3) {
                            sourceType = 'rgb';
                        }
                        // Skip 4-component (CMYK) and others - passthrough unchanged
                    }
                }
                // CMYK and Separation colors are passed through unchanged

                if (!sourceType) {
                    continue;
                }

                let locations = locationsBySourceType.get(sourceType);
                if (!locations) {
                    locations = [];
                    locationsBySourceType.set(sourceType, locations);
                }
                locations.push(location);
            }

            // Convert each source type in a single batch doTransform call
            /** @type {Map<ContentStreamColorLocation, number[]>} */
            const convertedValues = new Map();

            // Start convert span for timing color conversion
            const convertSpan = diagnostics.startSpan('convert', {
                sourceTypes: Array.from(locationsBySourceType.keys()),
            });

            for (const [sourceType, locations] of locationsBySourceType) {
                if (locations.length === 0) continue;

                // Prepare color values for batch conversion
                /** @type {'RGB' | 'Gray' | 'Lab'} */
                let colorType;
                /** @type {string | ArrayBuffer} */
                let sourceProfileForConversion;

                if (sourceType === 'rgb') {
                    colorType = 'RGB';
                    // Priority: 1) explicit sourceProfile option, 2) ProfileSelectionService, 3) built-in
                    if (sourceProfile) {
                        sourceProfileForConversion = sourceProfile;
                        if (verbose) {
                            console.log(`  Using explicit sourceProfile for DeviceRGB`);
                        }
                    } else if (profileSelectionService) {
                        try {
                            const selection = await profileSelectionService.selectSourceProfile('RGB', {});
                            if (selection.profile) {
                                sourceProfileForConversion = /** @type {ArrayBuffer} */ (selection.profile.buffer);
                                if (verbose) {
                                    console.log(`  Using ${selection.source} for DeviceRGB`);
                                }
                            } else {
                                sourceProfileForConversion = 'sRGB';
                            }
                        } catch (e) {
                            // ProfileSelectionService error - fall back to built-in
                            sourceProfileForConversion = 'sRGB';
                        }
                    } else {
                        sourceProfileForConversion = 'sRGB';
                    }
                } else if (sourceType === 'gray') {
                    colorType = 'Gray';
                    // Priority: 1) explicit sourceProfile option, 2) ProfileSelectionService, 3) built-in
                    if (sourceProfile) {
                        sourceProfileForConversion = sourceProfile;
                        if (verbose) {
                            console.log(`  Using explicit sourceProfile for DeviceGray`);
                        }
                    } else if (profileSelectionService) {
                        try {
                            const selection = await profileSelectionService.selectSourceProfile('Gray', {});
                            if (selection.profile) {
                                sourceProfileForConversion = /** @type {ArrayBuffer} */ (selection.profile.buffer);
                                if (verbose) {
                                    console.log(`  Using ${selection.source} for DeviceGray`);
                                }
                            } else {
                                sourceProfileForConversion = 'sGray';
                            }
                        } catch (e) {
                            // ProfileSelectionService error - fall back to built-in
                            sourceProfileForConversion = 'sGray';
                        }
                    } else {
                        sourceProfileForConversion = 'sGray';
                    }
                } else {
                    // Lab - use built-in Lab profile (no ProfileSelectionService for Lab)
                    colorType = 'Lab';
                    sourceProfileForConversion = 'Lab';
                }

                /** @type {import('./ColorEngineService.js').ColorValue[]} */
                const colors = locations.map(loc => {
                    if (colorType === 'RGB') {
                        // RGB values in PDF are 0-1, but ColorEngineService expects 0-255
                        return {
                            type: colorType,
                            values: /** @type {number[]} */ (loc.values).map(v => v * 255),
                        };
                    } else if (colorType === 'Lab') {
                        // Lab values need to be converted from PDF encoding to ICC Lab encoding
                        // PDF Lab: L* [0-100], a*/b* [Range values]
                        // ICC Lab: L* [0-100], a*/b* [-128, +127]
                        // @ts-ignore - labDef was attached earlier
                        const labDef = loc.labDef;
                        const [L, a, b] = /** @type {number[]} */ (loc.values);

                        // Get Range from Lab definition (default [-100, 100, -100, 100])
                        const range = labDef?.range ?? [-100, 100, -100, 100];
                        const [amin, amax, bmin, bmax] = range;

                        // Convert a* and b* from PDF range to ICC Lab range [-128, +127]
                        // PDF range [amin, amax] → ICC range [-128, +127]
                        // Formula: icc_value = (pdf_value - range_min) / (range_max - range_min) * 255 - 128
                        let iccA = a;
                        let iccB = b;

                        // Only convert if range differs from ICC Lab's [-128, 127]
                        if (amin !== -128 || amax !== 127) {
                            iccA = (a - amin) / (amax - amin) * 255 - 128;
                        }
                        if (bmin !== -128 || bmax !== 127) {
                            iccB = (b - bmin) / (bmax - bmin) * 255 - 128;
                        }

                        return {
                            type: colorType,
                            values: [L, iccA, iccB],
                        };
                    } else {
                        // Gray values are 0-1 in PDF
                        return {
                            type: colorType,
                            values: /** @type {number[]} */ (loc.values),
                        };
                    }
                });

                const outputColorType = isDestinationCMYK ? 'CMYK' : (isDestinationRGB ? 'RGB' : 'CMYK');
                if (verbose) {
                    console.log(`Batch converting ${colors.length} ${sourceType} colors to ${outputColorType}`);
                }

                try {
                    // Lab color handling for K-Only GCR:
                    // K-Only GCR is designed for neutral RGB colors to maximize K channel.
                    // Lab colors are typically chromatic (not neutral grays), so they should
                    // NOT use K-Only GCR. Instead, use Relative Colorimetric + BPC for Lab.
                    // NOTE: Content stream Gray colors work with K-Only GCR (use sGray profile).
                    //       Only Lab colors and Gray IMAGES need special handling.
                    // Also use BPC for RGB output when original intent was K-Only GCR.
                    const isKOnlyGCR = renderingIntent === 'preserve-k-only-relative-colorimetric-gcr' && isDestinationCMYK;
                    const isLabSource = sourceType === 'lab';
                    const needsBPC = isLabSource || useBlackPointCompensation;

                    if (isKOnlyGCR && isLabSource) {
                        // Lab → CMYK using Relative Colorimetric + BPC (not K-Only GCR)
                        if (verbose) {
                            console.log(`  (Lab colors: using Relative Colorimetric + BPC instead of K-Only GCR)`);
                        }

                        const results = await colorEngine.convertColors(colors, {
                            sourceProfile: sourceProfileForConversion,
                            destinationProfile,
                            renderingIntent: 'relative-colorimetric',
                            blackPointCompensation: true,
                        });

                        // Map results back to locations
                        // RGB output values from ColorEngineService are 0-255, but PDF content streams need 0-1
                        for (let i = 0; i < locations.length; i++) {
                            let values = results[i].output.values;
                            if (isDestinationRGB) {
                                values = values.map(v => v / 255);
                            }
                            convertedValues.set(locations[i], values);
                        }
                    } else if (needsBPC) {
                        // Use Relative Colorimetric + BPC for Lab or RGB output with K-Only GCR
                        if (verbose && useBlackPointCompensation) {
                            console.log(`  (RGB output: using Relative Colorimetric + BPC)`);
                        }

                        const results = await colorEngine.convertColors(colors, {
                            sourceProfile: sourceProfileForConversion,
                            destinationProfile,
                            renderingIntent: 'relative-colorimetric',
                            blackPointCompensation: true,
                        });

                        // Map results back to locations
                        // RGB output values from ColorEngineService are 0-255, but PDF content streams need 0-1
                        for (let i = 0; i < locations.length; i++) {
                            let values = results[i].output.values;
                            if (isDestinationRGB) {
                                values = values.map(v => v / 255);
                            }
                            convertedValues.set(locations[i], values);
                        }
                    } else {
                        // Single doTransform call for all colors of this source type
                        const results = await colorEngine.convertColors(colors, {
                            sourceProfile: sourceProfileForConversion,
                            destinationProfile,
                            renderingIntent: effectiveRenderingIntent,
                        });

                        // Map results back to locations
                        // RGB output values from ColorEngineService are 0-255, but PDF content streams need 0-1
                        for (let i = 0; i < locations.length; i++) {
                            let values = results[i].output.values;
                            if (isDestinationRGB) {
                                values = values.map(v => v / 255);
                            }
                            convertedValues.set(locations[i], values);
                        }
                    }
                } catch (error) {
                    if (verbose) {
                        console.warn(`Failed to batch convert ${sourceType} colors:`, error);
                    }
                }
            }

            // End convert span
            diagnostics.endSpan(convertSpan, {
                colorsConverted: convertedValues.size,
            });

            // Start rebuild span for timing stream replacement
            const rebuildSpan = diagnostics.startSpan('rebuild', {
                colorsToReplace: convertedValues.size,
            });

            // Group replacements by page and stream for applying
            /** @type {Map<PDFRef, Map<number, import('./ColorSpaceUtils.js').ColorReplacement[]>>} */
            const replacementsByPageAndStream = new Map();

            // Determine output color type for replacement
            const replacementType = isDestinationCMYK ? 'cmyk' : (isDestinationRGB ? 'rgb' : 'cmyk');

            for (const [location, newValues] of convertedValues) {
                /** @type {import('./ColorSpaceUtils.js').ColorReplacement} */
                const replacement = {
                    chunk: location.chunk,
                    newValues,
                    newType: replacementType,
                };

                // Group by page and stream
                let pageReplacements = replacementsByPageAndStream.get(location.pageRef);
                if (!pageReplacements) {
                    pageReplacements = new Map();
                    replacementsByPageAndStream.set(location.pageRef, pageReplacements);
                }
                let streamReplacementsList = pageReplacements.get(location.streamIndex);
                if (!streamReplacementsList) {
                    streamReplacementsList = [];
                    pageReplacements.set(location.streamIndex, streamReplacementsList);
                }
                streamReplacementsList.push(replacement);
            }

            // Apply replacements to content streams
            for (const [pageRef, streamReplacements] of replacementsByPageAndStream) {
                // Find the page result for this page
                const pageResult = pageResults.find(pr => pr.pageRef === pageRef);
                if (!pageResult) continue;

                for (const [streamIndex, replacements] of streamReplacements) {
                    const parsedStream = pageResult.pageColorAnalysis.parsedStreams[streamIndex];
                    if (!parsedStream) continue;

                    // Apply replacements to the stream text
                    const result = replaceContentStreamColors(parsedStream.text, replacements);

                    if (result.replacementCount > 0) {
                        // Encode the new content
                        const newContent = encodeContentStreamText(result.newText);

                        // Compress the content stream
                        const { compressed, wasCompressed } = await compressWithFlateDecode(newContent);

                        // Replace the stream contents
                        // Note: pdf-lib streams have a contents property we can update
                        const stream = parsedStream.stream;
                        // @ts-ignore - Accessing internal property to update stream contents
                        stream.contents = compressed;

                        // Update filter and length
                        if (wasCompressed) {
                            stream.dict.set(PDFName.of('Filter'), PDFName.of('FlateDecode'));
                        } else {
                            stream.dict.delete(PDFName.of('Filter'));
                        }
                        stream.dict.delete(PDFName.of('DecodeParms'));
                        stream.dict.set(PDFName.of('Length'), pdfDocument.context.obj(compressed.length));

                        if (verbose) {
                            console.log(`Replaced ${result.replacementCount} colors in page ${pageRef}, stream ${streamIndex}`);
                        }
                    }
                }
            }

            // End rebuild span
            diagnostics.endSpan(rebuildSpan, {
                streamsUpdated: replacementsByPageAndStream.size,
            });

            diagnostics.updateSpan(streamBatchSpan, {
                colorsConverted: contentStreamColorLocations.length,
            });
            } finally {
                // End stream-batch span
                diagnostics.endSpan(streamBatchSpan);
            }
        }

        // ========================================
        // Phase 3b: Convert image pixels
        // ========================================
        if (convertImages && imageColorLocations.length > 0) {
            // Start image-batch span
            const imageBatchSpan = diagnostics.startSpan('image-batch', {
                count: imageColorLocations.length,
            });

            // Use shared colorEngine instance (caches transforms and profile handles)
            let imagesConverted = 0;
            let imagesSkipped = 0;

            try {

            // Determine output color space name and components for image updates
            const outputColorSpaceName = isDestinationCMYK ? 'DeviceCMYK' : (isDestinationRGB ? 'DeviceRGB' : 'DeviceCMYK');
            const outputComponents = isDestinationCMYK ? 4 : (isDestinationRGB ? 3 : 4);

            for (const imageLocation of imageColorLocations) {
                // Determine source color space
                let sourceColorSpace = imageLocation.colorSpaceType;
                let isLabImage = sourceColorSpace === 'Lab';
                let isICCImage = !!imageLocation.iccProfile;

                // For ICC-based images, use the ICC profile's color space
                if (isICCImage) {
                    sourceColorSpace = imageLocation.iccProfile.header.colorSpace;
                }

                // Determine if this is a Device color space image (no embedded ICC profile)
                const isDeviceGrayImage = imageLocation.colorSpaceType === 'DeviceGray';
                const isDeviceRGBImage = imageLocation.colorSpaceType === 'DeviceRGB';
                const isDeviceCMYKImage = imageLocation.colorSpaceType === 'DeviceCMYK';
                const isDeviceColorSpaceImage = isDeviceGrayImage || isDeviceRGBImage || isDeviceCMYKImage;

                // Skip CMYK images (already in target color space for CMYK destination)
                if (isDeviceCMYKImage && isDestinationCMYK) {
                    imagesSkipped++;
                    if (verbose) {
                        console.log(`Skipped image (already DeviceCMYK): ${imageLocation.ref.toString()}`);
                    }
                    continue;
                }

                // Skip unsupported color spaces (not Lab, not ICC, not Device Gray/RGB)
                if (!isLabImage && !isICCImage && !isDeviceGrayImage && !isDeviceRGBImage) {
                    imagesSkipped++;
                    if (verbose) {
                        console.log(`Skipped image (unsupported color space: ${imageLocation.colorSpaceType}): ${imageLocation.ref.toString()}`);
                    }
                    continue;
                }

                if (isICCImage && sourceColorSpace !== 'RGB' && sourceColorSpace !== 'GRAY') {
                    imagesSkipped++;
                    continue;
                }

                // Try to extract pixels (decode phase)
                const decodeSpan = diagnostics.startSpan('decode', {
                    ref: imageLocation.ref?.toString(),
                    colorSpace: sourceColorSpace,
                });
                const extractedImage = extractImagePixels(imageLocation.stream);
                diagnostics.endSpan(decodeSpan, {
                    success: !!extractedImage,
                });
                if (!extractedImage) {
                    // Image format not supported (JPEG, etc.)
                    imagesSkipped++;
                    if (verbose) {
                        const metadata = extractImageMetadata(imageLocation.stream);
                        console.log(`Skipped image (unsupported format: ${metadata.filter}):`, imageLocation.ref.toString());
                    }
                    continue;
                }

                try {
                    const { metadata, pixels } = extractedImage;

                    if (isLabImage) {
                        // Handle Lab image conversion
                        // Lab images use PDF Lab color space with Range parameters

                        // Extract Lab parameters from color space descriptor
                        /** @type {import('./ColorSpaceUtils.js').LabColorSpaceDefinition | null} */
                        let labDef = null;
                        if (imageLocation.colorSpaceDescriptor instanceof PDFArray) {
                            // Get Lab parameters from UniqueColorSpaceRecords
                            const records = new UniqueColorSpaceRecords(pdfDocument);
                            const def = records.createColorSpaceDefinitionFrom(imageLocation.colorSpaceDescriptor);
                            if (def && 'whitePoint' in def) {
                                labDef = /** @type {import('./ColorSpaceUtils.js').LabColorSpaceDefinition} */ (def);
                            }
                        }

                        // Get Range from Lab definition (default [-100, 100, -100, 100])
                        const range = labDef?.range ?? [-100, 100, -100, 100];
                        const [amin, amax, bmin, bmax] = range;

                        // Check if Range needs conversion (differs from ICC Lab's [-128, +127])
                        const needsRangeConversion = amin !== -128 || amax !== 127 || bmin !== -128 || bmax !== 127;

                        // Start transform span for Lab image color conversion
                        const transformSpan = diagnostics.startSpan('transform', {
                            sourceColorSpace: 'Lab',
                            pixelCount: pixels.length / 3,
                        });

                        // Convert Lab pixels from PDF encoding to ICC Lab encoding if needed
                        let convertedPixels = pixels;
                        if (needsRangeConversion) {
                            convertedPixels = new Uint8Array(pixels.length);
                            for (let i = 0; i < pixels.length; i += 3) {
                                // L* is stored as 0-255 for 0-100
                                // In PDF, L* is encoded as L_encoded = L * 255 / 100
                                // No change needed for L* (already in 0-255 range)
                                convertedPixels[i] = pixels[i];

                                // a* and b* need Range mapping
                                // PDF encoding: encoded_value = (value - range_min) / (range_max - range_min) * 255
                                // ICC encoding: encoded_value = value + 128
                                // So: icc_encoded = pdf_decoded + 128
                                //     pdf_decoded = pdf_encoded / 255 * (range_max - range_min) + range_min
                                //     icc_encoded = pdf_encoded / 255 * (range_max - range_min) + range_min + 128
                                const pdfA = pixels[i + 1];
                                const pdfB = pixels[i + 2];

                                // Decode from PDF range to actual Lab value
                                const labA = (pdfA / 255) * (amax - amin) + amin;
                                const labB = (pdfB / 255) * (bmax - bmin) + bmin;

                                // Encode to ICC Lab (value + 128, clamped to 0-255)
                                convertedPixels[i + 1] = Math.max(0, Math.min(255, Math.round(labA + 128)));
                                convertedPixels[i + 2] = Math.max(0, Math.min(255, Math.round(labB + 128)));
                            }
                        }

                        // Lab image handling for K-Only GCR:
                        // K-Only GCR is designed for neutral RGB colors to maximize K channel.
                        // Lab images are typically chromatic (not neutral grays), so they should
                        // NOT use K-Only GCR. Instead, use Relative Colorimetric + BPC for Lab.
                        // Also use BPC for RGB output when original intent was K-Only GCR.
                        const isKOnlyGCR = renderingIntent === 'preserve-k-only-relative-colorimetric-gcr';

                        /** @type {Uint8Array} */
                        let outputPixels;

                        // Determine effective rendering intent and BPC for Lab
                        // Use Relative Colorimetric + BPC for K-Only GCR (not applicable to Lab)
                        // and for RGB output when original intent was K-Only GCR
                        const labIntent = (isKOnlyGCR || useBlackPointCompensation) ? 'relative-colorimetric' : effectiveRenderingIntent;
                        const labBPC = isKOnlyGCR || useBlackPointCompensation;

                        if ((isKOnlyGCR || useBlackPointCompensation) && verbose) {
                            console.log(`  (Lab image: using Relative Colorimetric + BPC)`);
                        }

                        if (useIndexedImages) {
                            // Indexed approach: extract unique colors, convert, map back
                            const { uniqueColors, colorToIndices, totalPixels } = PDFService.#extractUniqueColors(convertedPixels, 3);

                            if (verbose) {
                                const uniqueCount = colorToIndices.size;
                                const ratio = totalPixels > 0 ? (uniqueCount / totalPixels * 100).toFixed(2) : 0;
                                console.log(`  Indexed Lab image: ${uniqueCount} unique colors from ${totalPixels} pixels (${ratio}%)`);
                            }

                            // Convert only the unique colors
                            const result = await colorEngine.convertPixelBuffer(uniqueColors, {
                                sourceProfile: 'Lab',
                                destinationProfile: destinationProfile,
                                inputType: 'Lab',
                                renderingIntent: labIntent,
                                blackPointCompensation: labBPC,
                            });

                            // Map converted colors back to output
                            outputPixels = PDFService.#applyColorMapping(result.outputPixels, colorToIndices, 3, outputComponents, totalPixels);
                        } else {
                            // Direct conversion of all pixels
                            const result = await colorEngine.convertPixelBuffer(convertedPixels, {
                                sourceProfile: 'Lab',
                                destinationProfile: destinationProfile,
                                inputType: 'Lab',
                                renderingIntent: labIntent,
                                blackPointCompensation: labBPC,
                            });

                            outputPixels = result.outputPixels;
                        }

                        // End transform span
                        diagnostics.endSpan(transformSpan, {
                            outputPixels: outputPixels.length,
                        });

                        // Encode phase: update the image stream with converted pixels
                        const encodeSpan = diagnostics.startSpan('encode', {
                            pixels: outputPixels.length / 4, // CMYK has 4 components
                        });
                        await updateImageStream(imageLocation.stream, outputPixels, PDFName.of(outputColorSpaceName), 8, compressImages);
                        diagnostics.endSpan(encodeSpan, {});

                        imagesConverted++;
                        if (verbose) {
                            console.log(`Converted image ${imageLocation.ref.toString()}: ${metadata.width}×${metadata.height} Lab -> ${outputColorSpaceName}`);
                        }

                    } else if (isDeviceGrayImage || isDeviceRGBImage) {
                        // Handle DeviceGray/DeviceRGB image conversion using ProfileSelectionService
                        /** @type {ArrayBuffer | string | null} */
                        let deviceSourceProfile = null;

                        // Use ProfileSelectionService to get source profile for Device color space
                        if (profileSelectionService) {
                            try {
                                const colorModel = isDeviceGrayImage ? 'Gray' : 'RGB';
                                const selection = await profileSelectionService.selectSourceProfile(colorModel, {});
                                if (selection.profile) {
                                    deviceSourceProfile = /** @type {ArrayBuffer} */ (selection.profile.buffer);
                                    if (verbose) {
                                        console.log(`  Using ${selection.source} for Device${colorModel} image`);
                                    }
                                } else {
                                    // Graceful fallback - use built-in profile
                                    deviceSourceProfile = isDeviceGrayImage ? 'sGray' : 'sRGB';
                                    if (verbose) {
                                        console.log(`  Using built-in fallback for Device${colorModel} image`);
                                    }
                                }
                            } catch (e) {
                                // ProfileSelectionService error (preferGracefulFallback=false)
                                imagesSkipped++;
                                if (verbose) {
                                    console.log(`Skipped Device${isDeviceGrayImage ? 'Gray' : 'RGB'} image (no source profile configured): ${imageLocation.ref.toString()}`);
                                }
                                continue;
                            }
                        } else {
                            // No ProfileSelectionService - use explicit sourceProfile option or skip
                            if (sourceProfile) {
                                deviceSourceProfile = sourceProfile;
                            } else {
                                imagesSkipped++;
                                if (verbose) {
                                    console.log(`Skipped Device${isDeviceGrayImage ? 'Gray' : 'RGB'} image (no ProfileSelectionService or sourceProfile): ${imageLocation.ref.toString()}`);
                                }
                                continue;
                            }
                        }

                        // Determine input type
                        /** @type {'RGB' | 'Gray'} */
                        const inputType = isDeviceGrayImage ? 'Gray' : 'RGB';

                        // K-Only GCR handling for Device Gray images
                        const isKOnlyGCR = renderingIntent === 'preserve-k-only-relative-colorimetric-gcr' && isDestinationCMYK;
                        const isGrayImage = isDeviceGrayImage;

                        /** @type {Uint8Array} */
                        let outputPixels;

                        // Determine components per pixel (1 for Gray, 3 for RGB)
                        const inputComponents = isGrayImage ? 1 : 3;

                        // Start transform span for Device image color conversion
                        const transformSpan = diagnostics.startSpan('transform', {
                            sourceColorSpace: inputType,
                            pixelCount: pixels.length / inputComponents,
                        });

                        if (isKOnlyGCR && isGrayImage && typeof deviceSourceProfile !== 'string') {
                            // DeviceGray → CMYK (Multi) with K-Only GCR using ProfileSelectionService profile
                            if (verbose) {
                                console.log(`  DeviceGray → CMYK (Multi) with K-Only GCR`);
                            }

                            if (useIndexedImages) {
                                const { uniqueColors, colorToIndices, totalPixels } = PDFService.#extractUniqueColors(pixels, 1);

                                if (verbose) {
                                    const uniqueCount = colorToIndices.size;
                                    const ratio = totalPixels > 0 ? (uniqueCount / totalPixels * 100).toFixed(2) : 0;
                                    console.log(`  Indexed DeviceGray image: ${uniqueCount} unique colors from ${totalPixels} pixels (${ratio}%)`);
                                }

                                const cmykResult = await colorEngine.convertPixelBufferMultiprofile(uniqueColors, {
                                    profiles: [deviceSourceProfile, destinationProfile],
                                    inputType: 'Gray',
                                    renderingIntent: 'preserve-k-only-relative-colorimetric-gcr',
                                });

                                outputPixels = PDFService.#applyColorMapping(cmykResult.outputPixels, colorToIndices, 1, outputComponents, totalPixels);
                            } else {
                                const cmykResult = await colorEngine.convertPixelBufferMultiprofile(pixels, {
                                    profiles: [deviceSourceProfile, destinationProfile],
                                    inputType: 'Gray',
                                    renderingIntent: 'preserve-k-only-relative-colorimetric-gcr',
                                });

                                outputPixels = cmykResult.outputPixels;
                            }
                        } else {
                            // Standard conversion for DeviceGray/DeviceRGB
                            const imageIntent = useBlackPointCompensation ? 'relative-colorimetric' : effectiveRenderingIntent;
                            const imageBPC = useBlackPointCompensation;

                            if (useIndexedImages) {
                                const { uniqueColors, colorToIndices, totalPixels } = PDFService.#extractUniqueColors(pixels, inputComponents);

                                if (verbose) {
                                    const uniqueCount = colorToIndices.size;
                                    const ratio = totalPixels > 0 ? (uniqueCount / totalPixels * 100).toFixed(2) : 0;
                                    console.log(`  Indexed Device${inputType} image: ${uniqueCount} unique colors from ${totalPixels} pixels (${ratio}%)`);
                                }

                                const result = await colorEngine.convertPixelBuffer(uniqueColors, {
                                    sourceProfile: deviceSourceProfile,
                                    destinationProfile: destinationProfile,
                                    inputType: inputType,
                                    renderingIntent: imageIntent,
                                    blackPointCompensation: imageBPC,
                                });

                                outputPixels = PDFService.#applyColorMapping(result.outputPixels, colorToIndices, inputComponents, outputComponents, totalPixels);
                            } else {
                                const result = await colorEngine.convertPixelBuffer(pixels, {
                                    sourceProfile: deviceSourceProfile,
                                    destinationProfile: destinationProfile,
                                    inputType: inputType,
                                    renderingIntent: imageIntent,
                                    blackPointCompensation: imageBPC,
                                });

                                outputPixels = result.outputPixels;
                            }
                        }

                        // End transform span
                        diagnostics.endSpan(transformSpan, {
                            outputPixels: outputPixels.length,
                        });

                        // Encode phase: update the image stream with converted pixels
                        const encodeSpan = diagnostics.startSpan('encode', {
                            pixels: outputPixels.length / outputComponents,
                        });
                        await updateImageStream(imageLocation.stream, outputPixels, PDFName.of(outputColorSpaceName), 8, compressImages);
                        diagnostics.endSpan(encodeSpan, {});

                        imagesConverted++;
                        if (verbose) {
                            console.log(`Converted image ${imageLocation.ref.toString()}: ${metadata.width}×${metadata.height} Device${inputType} -> ${outputColorSpaceName}`);
                        }

                    } else {
                        // Handle ICC-based RGB/Gray image conversion
                        // Convert Buffer to ArrayBuffer if needed (once per image)
                        const sourceProfileBuffer = imageLocation.iccProfile?.buffer instanceof ArrayBuffer
                            ? imageLocation.iccProfile.buffer
                            : imageLocation.iccProfile?.buffer?.buffer?.slice?.(
                                imageLocation.iccProfile?.buffer?.byteOffset ?? 0,
                                (imageLocation.iccProfile?.buffer?.byteOffset ?? 0) + (imageLocation.iccProfile?.buffer?.byteLength ?? 0)
                            );

                        if (!sourceProfileBuffer) {
                            imagesSkipped++;
                            if (verbose) {
                                console.log(`Skipped image (no ICC profile buffer): ${imageLocation.ref.toString()}`);
                            }
                            continue;
                        }

                        // Determine input type based on source color space
                        /** @type {'RGB' | 'Gray'} */
                        const inputType = sourceColorSpace === 'RGB' ? 'RGB' : 'Gray';

                        // K-Only GCR workaround for Gray images:
                        // The K-Only GCR LUT assumes RGB input, so Gray images must be converted
                        // to sRGB first, then to CMYK with K-Only GCR.
                        // Note: This only applies when destination is CMYK
                        const isKOnlyGCR = renderingIntent === 'preserve-k-only-relative-colorimetric-gcr' && isDestinationCMYK;
                        const isGrayImage = inputType === 'Gray';

                        /** @type {Uint8Array} */
                        let outputPixels;

                        // Determine components per pixel (1 for Gray, 3 for RGB)
                        const inputComponents = isGrayImage ? 1 : 3;

                        // Start transform span for ICC image color conversion
                        const transformSpan = diagnostics.startSpan('transform', {
                            sourceColorSpace: sourceColorSpace,
                            pixelCount: pixels.length / inputComponents,
                        });

                        if (isKOnlyGCR && isGrayImage) {
                            // Gray ICC → CMYK (Multi) with K-Only GCR
                            // Uses createMultiprofileTransform to handle Gray → CMYK conversion with K-Only output
                            if (verbose) {
                                console.log(`  Gray ICC → CMYK (Multi) with K-Only GCR`);
                            }

                            if (useIndexedImages) {
                                // Indexed approach for Gray K-Only GCR
                                const { uniqueColors, colorToIndices, totalPixels } = PDFService.#extractUniqueColors(pixels, 1);

                                if (verbose) {
                                    const uniqueCount = colorToIndices.size;
                                    const ratio = totalPixels > 0 ? (uniqueCount / totalPixels * 100).toFixed(2) : 0;
                                    console.log(`  Indexed Gray image: ${uniqueCount} unique colors from ${totalPixels} pixels (${ratio}%)`);
                                }

                                // Gray ICC → CMYK (Multi) with K-Only GCR
                                const cmykResult = await colorEngine.convertPixelBufferMultiprofile(uniqueColors, {
                                    profiles: [sourceProfileBuffer, destinationProfile],
                                    inputType: 'Gray',
                                    renderingIntent: 'preserve-k-only-relative-colorimetric-gcr',
                                });

                                // Map converted colors back to output
                                outputPixels = PDFService.#applyColorMapping(cmykResult.outputPixels, colorToIndices, 1, outputComponents, totalPixels);
                            } else {
                                // Gray ICC → CMYK (Multi) with K-Only GCR
                                const cmykResult = await colorEngine.convertPixelBufferMultiprofile(pixels, {
                                    profiles: [sourceProfileBuffer, destinationProfile],
                                    inputType: 'Gray',
                                    renderingIntent: 'preserve-k-only-relative-colorimetric-gcr',
                                });

                                outputPixels = cmykResult.outputPixels;
                            }
                        } else {
                            // Single-step conversion (RGB or Gray non-K-Only, or any RGB output)
                            // Use effective rendering intent and BPC for RGB output
                            const imageIntent = useBlackPointCompensation ? 'relative-colorimetric' : effectiveRenderingIntent;
                            const imageBPC = useBlackPointCompensation;

                            if (useIndexedImages) {
                                // Indexed approach
                                const { uniqueColors, colorToIndices, totalPixels } = PDFService.#extractUniqueColors(pixels, inputComponents);

                                if (verbose) {
                                    const uniqueCount = colorToIndices.size;
                                    const ratio = totalPixels > 0 ? (uniqueCount / totalPixels * 100).toFixed(2) : 0;
                                    console.log(`  Indexed ${inputType} image: ${uniqueCount} unique colors from ${totalPixels} pixels (${ratio}%)`);
                                }

                                const result = await colorEngine.convertPixelBuffer(uniqueColors, {
                                    sourceProfile: sourceProfileBuffer,
                                    destinationProfile: destinationProfile,
                                    inputType: inputType,
                                    renderingIntent: imageIntent,
                                    blackPointCompensation: imageBPC,
                                });

                                // Map converted colors back to output
                                outputPixels = PDFService.#applyColorMapping(result.outputPixels, colorToIndices, inputComponents, outputComponents, totalPixels);
                            } else {
                                // Direct conversion of all pixels
                                const result = await colorEngine.convertPixelBuffer(pixels, {
                                    sourceProfile: sourceProfileBuffer,
                                    destinationProfile: destinationProfile,
                                    inputType: inputType,
                                    renderingIntent: imageIntent,
                                    blackPointCompensation: imageBPC,
                                });

                                outputPixels = result.outputPixels;
                            }
                        }

                        // End transform span
                        diagnostics.endSpan(transformSpan, {
                            outputPixels: outputPixels.length,
                        });

                        // Encode phase: update the image stream with converted pixels
                        const encodeSpan = diagnostics.startSpan('encode', {
                            pixels: outputPixels.length / outputComponents,
                        });
                        await updateImageStream(imageLocation.stream, outputPixels, PDFName.of(outputColorSpaceName), 8, compressImages);
                        diagnostics.endSpan(encodeSpan, {});

                        imagesConverted++;
                        if (verbose) {
                            console.log(`Converted image ${imageLocation.ref.toString()}: ${metadata.width}×${metadata.height} ${sourceColorSpace} -> ${outputColorSpaceName}`);
                        }
                    }

                } catch (error) {
                    imagesSkipped++;
                    if (verbose) {
                        console.warn(`Failed to convert image ${imageLocation.ref.toString()}:`, error);
                    }
                }
            }

            diagnostics.updateSpan(imageBatchSpan, {
                imagesConverted,
                imagesSkipped,
            });

            if (verbose) {
                console.log(`\nImage conversion: ${imagesConverted} converted, ${imagesSkipped} skipped`);
            }
            } finally {
                // End image-batch span
                diagnostics.endSpan(imageBatchSpan);
            }
        }

        // ========================================
        // Phase 4: Clean up color space definitions (DISABLED)
        // ========================================
        // NOTE: Color space removal is DISABLED because content streams still
        // contain `cs /CS1` operators that reference these color spaces.
        // Even though color values are now DeviceCMYK (using `k` operator),
        // removing the color space definitions breaks the PDF because the
        // `cs` operators reference undefined color spaces.
        //
        // The color space definitions are harmless when left in place - the
        // `k` operator uses DeviceCMYK directly and ignores the color space
        // set by the preceding `cs` operator.
        //
        // Future improvement: Also remove the `cs /CSx` operators when
        // converting indexed colors to DeviceCMYK, then this cleanup can
        // be re-enabled.
        /*
        if (convertContentStreams) {
            for (const pageResult of pageResults) {
                const pageColorAnalysis = pageResult.pageColorAnalysis;
                const colorSpaceDict = pageColorAnalysis.colorSpaceDict;

                if (colorSpaceDict) {
                    // Get all entries in the ColorSpace dictionary
                    const entries = colorSpaceDict.entries();
                    const keysToRemove = [];

                    for (const [name, value] of entries) {
                        // Check if this color space is ICCBased
                        let colorSpaceArray = value instanceof PDFArray ? value : undefined;
                        if (value instanceof PDFRef) {
                            const resolved = pdfDocument.context.lookup(value);
                            colorSpaceArray = resolved instanceof PDFArray ? resolved : undefined;
                        }

                        if (colorSpaceArray instanceof PDFArray) {
                            const csType = colorSpaceArray.get(0);
                            if (csType instanceof PDFName && csType.decodeText() === 'ICCBased') {
                                keysToRemove.push(name);
                            }
                        }
                    }

                    // Remove ICCBased color space entries
                    for (const key of keysToRemove) {
                        colorSpaceDict.delete(key);
                        if (verbose) {
                            console.log(`Removed ICCBased color space ${key.toString()} from page ${pageResult.pageRef}`);
                        }
                    }
                }
            }
        }
        */

        if (verbose) {
            console.log('\n=== Document Color Conversion Summary ===');
            console.log(`Pages processed: ${pageResults.length}`);
            console.log(`Image color locations found: ${imageColorLocations.length}`);
            console.log(`Content stream color locations found: ${contentStreamColorLocations.length}`);
            console.log(`Total color space conversions: ${totalColorSpaceConversions}`);
            console.log(`ICC profiles found: ${iccProfileLocations.size}`);
            console.log(`Color space definitions found: ${colorSpaceDefinitionLocations.size}`);

            // Group content stream colors by type
            const colorsByType = contentStreamColorLocations.reduce((acc, loc) => {
                acc[loc.colorType] = (acc[loc.colorType] || 0) + 1;
                return acc;
            }, /** @type {Record<string, number>} */({}));
            console.log('Content stream colors by type:', colorsByType);

            // Group images by color space type
            const imagesByColorSpace = imageColorLocations.reduce((acc, loc) => {
                const key = loc.iccProfile
                    ? `ICC-${loc.iccProfile.header.colorSpace}`
                    : loc.colorSpaceType;
                acc[key] = (acc[key] || 0) + 1;
                return acc;
            }, /** @type {Record<string, number>} */({}));
            console.log('Images by color space:', imagesByColorSpace);

            // List ICC profiles with usage counts
            console.log('\nICC Profiles:');
            for (const [ref, profile] of iccProfileLocations) {
                console.log(`  ${ref.toString()}: ${profile.header.colorSpace} (${profile.usageCount} usages)`);
            }

            // List color space definitions with usage counts
            console.log('\nColor Space Definitions:');
            for (const [descriptor, def] of colorSpaceDefinitionLocations) {
                const descStr = descriptor instanceof PDFArray
                    ? `[${descriptor.get(0)?.toString() ?? '?'}...]`
                    : descriptor.toString();
                console.log(`  ${descStr}: ${def.colorSpaceType} (${def.usageCount} usages)`);
            }
        }

        // Clean up ColorEngine resources
        colorEngine.dispose();

        diagnostics.updateSpan(documentSpan, {
            pages: pageResults.length,
            totalColorSpaceConversions,
            totalContentStreamConversions,
            totalImageConversions,
        });

        return {
            pagesProcessed: pageResults.length,
            totalColorSpaceConversions,
            totalContentStreamConversions,
            totalImageConversions,
            pageResults,
            imageColorLocations,
            contentStreamColorLocations,
            iccProfileLocations,
            colorSpaceDefinitionLocations,
        };
        } finally {
            // End document conversion span
            diagnostics.endSpan(documentSpan);
        }
    }

    /**
     * Repacks a PDF document to remove orphaned objects.
     * Creates a new PDF and copies all pages, leaving behind unreferenced objects
     * like old ICC profiles, color spaces, and image streams that were replaced.
     *
     * @param {PDFDocument} pdfDocument - The PDF document to repack
     * @returns {Promise<PDFDocument>} A new, optimized PDF document
     *
     * @example
     * const convertedPDF = await PDFService.convertColorInPDFDocument(pdf, options);
     * const optimizedPDF = await PDFService.repackPDFDocument(pdf);
     * const bytes = await optimizedPDF.save();
     */
    static async repackPDFDocument(pdfDocument) {
        // Create a new, empty PDF
        const newPDF = await PDFDocument.create();

        // Get all page indices
        const pageCount = pdfDocument.getPageCount();
        const pageIndices = Array.from({ length: pageCount }, (_, i) => i);

        // Copy all pages to the new PDF
        // copyPages handles bringing over necessary dependencies (only referenced objects)
        const copiedPages = await newPDF.copyPages(pdfDocument, pageIndices);

        // Add the copied pages to the new document
        for (const page of copiedPages) {
            newPDF.addPage(page);
        }

        return newPDF;
    }

    /**
     * Removes orphaned objects from a PDF document in-place.
     * Finds all objects that are not reachable from the document root and removes them.
     * This is useful after color conversion where old ICC profiles and image streams
     * may become unreferenced.
     *
     * @param {PDFDocument} pdfDocument - The PDF document to clean
     * @returns {{ removedCount: number, removedRefs: PDFRef[] }} Statistics about removed objects
     *
     * @example
     * await PDFService.convertColorInPDFDocument(pdf, options);
     * const { removedCount } = PDFService.removeOrphanedObjects(pdf);
     * console.log(`Removed ${removedCount} orphaned objects`);
     */
    static removeOrphanedObjects(pdfDocument) {
        const context = pdfDocument.context;

        // Collect all referenced objects by traversing from roots
        /** @type {Set<string>} */
        const referencedRefs = new Set();

        /**
         * Recursively collect all referenced PDFRefs
         * @param {any} obj - PDF object to traverse
         * @param {Set<string>} visited - Already visited refs (to avoid cycles)
         */
        function collectRefs(obj, visited = new Set()) {
            if (!obj) return;

            // Handle PDFRef
            if (obj instanceof PDFRef) {
                const refKey = obj.toString();
                if (visited.has(refKey)) return;
                visited.add(refKey);
                referencedRefs.add(refKey);

                // Lookup and traverse the referenced object
                // Use indirectObjects directly to avoid type checking issues
                const resolved = context.indirectObjects.get(obj);
                if (resolved) {
                    collectRefs(resolved, visited);
                }
                return;
            }

            // Handle PDFDict
            if (obj instanceof PDFDict) {
                const entries = obj.entries();
                for (const [key, value] of entries) {
                    collectRefs(value, visited);
                }
                return;
            }

            // Handle PDFArray
            if (obj instanceof PDFArray) {
                const size = obj.size();
                for (let i = 0; i < size; i++) {
                    collectRefs(obj.get(i), visited);
                }
                return;
            }

            // Handle PDFRawStream (has dict and contents)
            if (obj instanceof PDFRawStream) {
                collectRefs(obj.dict, visited);
                return;
            }
        }

        // Start from document root objects
        const rootObjects = [
            pdfDocument.catalog,                    // Document catalog
            context.trailerInfo.Root,               // Root reference
            context.trailerInfo.Info,               // Document info
            context.trailerInfo.Encrypt,            // Encryption dict (if any)
            context.trailerInfo.ID,                 // Document ID
        ].filter(Boolean);

        for (const root of rootObjects) {
            collectRefs(root);
        }

        // Enumerate all objects in the document
        const allObjects = /** @type {[PDFRef, any][]} */ (context.enumerateIndirectObjects());
        const allRefs = new Set(allObjects.map(([ref]) => ref.toString()));

        // Find orphaned objects (in document but not referenced)
        /** @type {PDFRef[]} */
        const orphanedRefs = [];
        for (const [ref, obj] of allObjects) {
            const refKey = ref.toString();
            if (!referencedRefs.has(refKey)) {
                orphanedRefs.push(ref);
            }
        }

        // Delete orphaned objects
        for (const ref of orphanedRefs) {
            context.delete(ref);
        }

        return {
            removedCount: orphanedRefs.length,
            removedRefs: orphanedRefs,
        };
    }

    /**
     * Attaches a manifest to a PDF document
     * @param {PDFDocument} pdfDocument
     * @param {ArrayBuffer | Uint8Array | string} manifestBuffer - The manifest buffer to attach
     * @param {string} attachmentName - Name for the attachment
     */
    static async attachManifestToPDFDocument(pdfDocument, manifestBuffer, attachmentName = 'test-form.manifest.json') {
        await pdfDocument.attach(manifestBuffer, attachmentName, { 'mimeType': 'application/json' });
    }


    /**
     * @param {PDFDocument} pdfDocument
     * @param {string} attachmentName
     */
    static lookupPDFDocumentAttachementByName(pdfDocument, attachmentName) {
        const namesDict = pdfDocument.catalog.lookupMaybe(PDFName.of('Names'), PDFDict);
        const embeddedFilesDict = namesDict?.lookupMaybe(PDFName.of('EmbeddedFiles'), PDFDict);
        const embeddedFilesDictNamesArray = embeddedFilesDict?.lookupMaybe(PDFName.of('Names'), PDFArray);
        // const embeddedFilesDictNamesArrayEntries = /** @type {PDFArray[] | undefined} */(embeddedFilesDictNamesArray?.asArray?.());
        // const embeddedFilesMap = new Map(embeddedFilesDict?.lookupMaybe(PDFName.of('Names'), PDFArray)?.asArray?.().flatMap((element, index, array) => index % 2 === 0 ? [[element, array[index + 1]]] : []) ?? []);

        // console.log({ attachmentName, namesDict, embeddedFilesDict, embeddedFilesDictNamesArray, embeddedFilesMap, pdfDocument });

        for (let index = 0; index < (embeddedFilesDictNamesArray?.size() ?? 0); index += 2) {
            const embeddedFileName = /** @type {PDFString} */ (embeddedFilesDictNamesArray?.get(index));
            const embeddedFileNameDecodedString = embeddedFileName?.decodeText?.();

            if (embeddedFileNameDecodedString !== attachmentName) {
                // console.log({ attachmentName, embeddedFileName, embeddedFileNameDecodedString });
                // debugger;
                continue;
            }

            const embeddedFileRef = embeddedFilesDictNamesArray?.get(index + 1);
            const embeddedFileDict = pdfDocument.context.lookupMaybe(embeddedFileRef, PDFDict);
            // const embeddedFileStream = /** @type {PDFRawStream | undefined} */ (embeddedFileDict?.lookupMaybe?.(PDFName.of('EF'), PDFDict)?.lookup(PDFName.of('F')));
            const embeddedFileStream = lookupMaybe(lookupMaybe(embeddedFileDict, PDFName.of('EF'), PDFDict), PDFName.of('F'), PDFRawStream);

            if (!embeddedFileStream) {
                // console.log({ attachmentName, embeddedFileName, embeddedFileNameDecodedString, embeddedFileRef, embeddedFileDict, embeddedFileStream });
                // debugger;
                continue;
            }

            const embeddedFileContents = /** @type {Uint8Array<ArrayBuffer>} */ (decodePDFRawStream(embeddedFileStream).decode());

            // console.log({ attachmentName, embeddedFileName, embeddedFileNameDecodedString, embeddedFileRef, embeddedFileDict, embeddedFileStream, embeddedFileContents });

            return {
                ref: embeddedFileRef,
                dict: embeddedFileDict,
                name: embeddedFileNameDecodedString,
                stream: embeddedFileStream,
                contents: embeddedFileContents,
            };
        }

        // debugger;
    }

    /**
     * Extract attached manifest from a PDF
     * @param {PDFDocument} pdfDocument
     * @param {string} attachmentName - Name of the attachment to find
     * @returns {{buffer: ArrayBuffer, json: any} | null} - The manifest buffer and parsed JSON
     */
    static extractManifestFromPDFDocument(pdfDocument, attachmentName = 'test-form.manifest.json') {
        const attachedRecord = PDFService.lookupPDFDocumentAttachementByName(pdfDocument, attachmentName);

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
    static extractICCProfilesFromPDFDocument(pdfDocument) {
        const enumeratedIndirectObjects = /** @type {[PDFRef, any][]} */ (pdfDocument.context.enumerateIndirectObjects());

        // Find ICC-based color spaces in the PDF
        const iccBasedIndirectObjects = enumeratedIndirectObjects.filter(([ref, object]) => object.asArray?.()?.[0]?.asString?.() === '/ICCBased');

        // Get references to the ICC data streams
        const iccBasedObjectReferences = new Set(iccBasedIndirectObjects.map(([ref, object]) => object?.asArray?.()?.[1]).filter(Boolean));

        /** @type {Map<PDFRef, { stream: PDFRawStream, buffer: Buffer, header: ReturnType<import('icc')['parse']> }>} */
        const iccProfilesMap = new Map();

        for (const reference of iccBasedObjectReferences) {
            // const stream = /** @type {PDFRawStream | undefined} */ (pdfDocument.context.lookupMaybe(reference, /** @type {*} */(PDFRawStream)));
            const stream = lookupMaybe(pdfDocument.context, reference, PDFRawStream);

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
     * @param {string} [options.profileFilename] original ICC profile filename (stored via /AF per PDF 2.0)
     */
    static async setOutputIntentForPDFDocument(pdfDocument, { subType, iccProfile, info, identifier, profileFilename }) {
        if (!(pdfDocument instanceof PDFDocument))
            throw new Error('Unexpected pdfDocument argument type.');

        let iccStreamRef;
        if (iccProfile instanceof PDFRef) {
            iccStreamRef = iccProfile;
        } else if (iccProfile instanceof PDFRawStream) {
            iccStreamRef = pdfDocument.context.register(iccProfile);
        } else {
            // Determine /N and /Alternate from ICC profile header (bytes 16-19 = color space signature)
            const profileBytes = iccProfile instanceof Uint8Array ? iccProfile : new Uint8Array(iccProfile);
            const colorSpaceSig = String.fromCharCode(profileBytes[16], profileBytes[17], profileBytes[18], profileBytes[19]);
            let n, alternate;
            switch (colorSpaceSig.trim()) {
                case 'CMYK': n = 4; alternate = 'DeviceCMYK'; break;
                case 'RGB':  n = 3; alternate = 'DeviceRGB'; break;
                case 'GRAY': n = 1; alternate = 'DeviceGray'; break;
                default:     n = 4; alternate = 'DeviceCMYK'; break; // fallback
            }
            const compressedProfile = await compressWithFlateDecode(profileBytes);
            iccStreamRef = pdfDocument.context.register(
                pdfDocument.context.stream(compressedProfile.compressed, { N: n, Alternate: alternate, Filter: 'FlateDecode' })
            );
        }

        console.log({ iccProfile, iccStreamRef });

        const outputIntent = pdfDocument.context.obj({
            Type: 'OutputIntent',
            S: subType,
            OutputConditionIdentifier: PDFString.of(identifier),
            Info: info ? PDFString.of(info) : PDFString.of(identifier),
            DestOutputProfile: iccStreamRef,
        });
        // Associate the profile filename via /AF (PDF 2.0 Associated Files) on the OutputIntent dict
        if (profileFilename) {
            const fileSpecDict = pdfDocument.context.obj({
                Type: 'Filespec',
                F: PDFString.of(profileFilename),
                UF: PDFHexString.fromText(profileFilename),
                EF: pdfDocument.context.obj({ F: iccStreamRef }),
                AFRelationship: 'Source',
            });
            const fileSpecRef = pdfDocument.context.register(fileSpecDict);
            outputIntent.set(PDFName.of('AF'), pdfDocument.context.obj([fileSpecRef]));
        }

        const outputIntentRef = pdfDocument.context.register(outputIntent);
        pdfDocument.catalog.set(PDFName.of('OutputIntents'), pdfDocument.context.obj([outputIntentRef]));
    }

    /**
     * Embeds slugs into each page of a PDF
     * @param {PDFDocument} testFormDocument - The PDF document buffer
     * @param {PDFDocument} slugsDocument - The slugs PDF buffer
     */
    static async embedSlugsIntoPDFDocument(testFormDocument, slugsDocument) {
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
     * @param {PDFDocument} pdfDocument
     * @param {string | PDFName | ((colorspaceDesignator: PDFName | PDFArray, pageLeafGroupDict: PDFDict, pageLeaf: PDFPageLeaf) => (string | PDFName | PDFRef))} replacement
     */
    static async replaceTransarencyBlendingSpaceInPDFDocument(pdfDocument, replacement) {
        /*
        We are trying to find all Transparency group dicts and .

        - PDFPageLeaf objects with /Group key, which is a PDFDict that contains a /CS key.

        */

        // /** @param {PDFName | PDFString | import('pdf-lib').PDFHexString} [instance] */
        // const decodeText = instance => instance?.decodeText?.().trim();

        const enumeratedIndirectObjects = /** @type {[PDFRef, any][]} */ (pdfDocument.context.enumerateIndirectObjects());

        const replaceTransarencyBlendingSpaceRecords = [];

        // const replaceTransarencyBlendingSpace = (colorspace, dictionary, content) 

        for (const [enumeratedRef, enumeratedObject] of enumeratedIndirectObjects) {
            /** @type {Partial<{
             *   isComplete: boolean,
             *   isRelevant: boolean,
             *   enumeratedObjectRef: PDFRef,
             *   enumeratedObject: any,
             *   enumeratedPageLeaf: PDFPageLeaf,
             *   enumeratedPageLeafType: PDFName | undefined,
             *   enumeratedPageLeafSubtype: PDFName | undefined,
             *   enumeratedPageLeafClassifier: string | undefined,
             *   enumeratedPageLeafGroupDict: PDFDict | undefined,
             *   enumeratedPageLeafGroupSubtype: PDFName | undefined,
             *   transparencyBlendingSpaceDesignator: string | PDFName | PDFArray | undefined,
             *   replacementArgument: string | PDFName | PDFRef | PDFArray | undefined,
             *   replacementResult: string | PDFName | PDFRef | PDFArray | undefined,
             *   replacementString: string | undefined,
             *   replacementRef: PDFRef | undefined,
             *   replacementValue: string | PDFName | PDFArray | undefined,
             *   currentTransparencyBlendingSpace: string | PDFName | PDFArray | undefined,
             *   replacementTransparencyBlendingSpace: string | PDFName | PDFRef | PDFArray | undefined,
             * }>?} */
            const record = DEBUG_TRANSPARENCY_BLENDING_OPERATIONS ? {} : null;

            // if (record) {
            //     replaceTransarencyBlendingSpaceRecords?.push?.(record);
            //     record.enumeratedObject = enumeratedObject;
            //     record.enumeratedObjectRef = enumeratedRef;
            // }

            if (enumeratedObject instanceof PDFPageLeaf) {
                if (record) {
                    replaceTransarencyBlendingSpaceRecords.push(record);
                    Object.assign(record, {
                        isComplete: false,
                        isRelevant: false,
                        enumeratedObjectRef: enumeratedRef,
                        enumeratedObject: enumeratedObject,
                    });
                    record.isComplete = false;
                    record.isRelevant = false;
                    record.enumeratedObjectRef = enumeratedRef;
                    record.enumeratedObject = enumeratedObject;
                }

                const enumeratedPageLeaf = /** @type {PDFPageLeaf} */ (enumeratedObject);
                const enumeratedPageLeafType = /** @type {PDFName | undefined} */ (enumeratedPageLeaf.get(PDFName.of('Type')));
                const enumeratedPageLeafSubtype = /** @type {PDFName | undefined} */ (enumeratedPageLeaf.get(PDFName.of('Subtype')));
                const enumeratedPageLeafClassifier = `${decodeText(enumeratedPageLeafType) ?? ''}${decodeText(enumeratedPageLeafSubtype) ?? ''}` || undefined;
                // const enumeratedPageLeafGroupDict = /** @type {PDFDict | undefined} */ (enumeratedPageLeaf.lookupMaybe(PDFName.of('Group'), PDFDict));
                const enumeratedPageLeafGroupDict = lookupMaybe(enumeratedPageLeaf, PDFName.of('Group'), PDFDict);
                const enumeratedPageLeafGroupSubtype = /** @type {PDFName | undefined} */ (enumeratedPageLeafGroupDict?.get(PDFName.of('S')));
                // const transparencyBlendingSpaceDesignator = decodeText(enumeratedPageLeafGroupSubtype) === 'Transparency' ? /** @type {PDFName | PDFArray | undefined} */(enumeratedPageLeafGroupDict?.lookupMaybe(PDFName.of('CS'), PDFName, PDFArray)) : undefined;
                const transparencyBlendingSpaceDesignator = decodeText(enumeratedPageLeafGroupSubtype) === 'Transparency' ? lookupMaybe(enumeratedPageLeafGroupDict, PDFName.of('CS'), PDFName, PDFArray) : undefined;

                if (record) {
                    record.enumeratedPageLeaf = enumeratedPageLeaf;
                    record.enumeratedPageLeafType = enumeratedPageLeafType;
                    record.enumeratedPageLeafSubtype = enumeratedPageLeafSubtype;
                    record.enumeratedPageLeafClassifier = enumeratedPageLeafClassifier;
                    record.enumeratedPageLeafGroupDict = enumeratedPageLeafGroupDict;
                    record.enumeratedPageLeafGroupSubtype = enumeratedPageLeafGroupSubtype;
                    record.transparencyBlendingSpaceDesignator = transparencyBlendingSpaceDesignator;
                }

                if (!enumeratedPageLeafGroupDict || !transparencyBlendingSpaceDesignator) continue;

                if (record) record.isRelevant = true;

                /**
                 * @type {string | PDFName | PDFRef | PDFArray | undefined}
                 */
                let replacementValue;

                // let replacement

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

                    // TODO: check if the replacementValue is a valid color space definition
                    // TODO: replace redundant replacementValue definitions for the same color space

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

                    // console.log('Replaced %o with %o for %o', currentTransparencyBlendingSpace, replacementTransparencyBlendingSpace, enumeratedPageLeaf);
                    console.log('Replaced %o with %o for %o', currentTransparencyBlendingSpace, replacementTransparencyBlendingSpace, enumeratedPageLeafGroupSubtype);
                } else {
                    throw new Error(`Unexpected replacement type: ${replacementValue}`);
                }
                // enumeratedPageLeafGroupDict.set(PDFName.of('CS'), );
            }

        }

        console.log({ replaceTransarencyBlendingSpaceRecords, pdfDocument, replacement });

        // debugger;
    }

    /**
     * Decalibrates a PDF document by replacing ICC-based color spaces with device color spaces.
     * This is a refactored version that uses the ColorSpaceUtils module.
     * 
     * @param {PDFDocument} pdfDocument
     * @param {object} [options]
     * @param {boolean} [options.verbose] - Whether to log detailed information about the decalibration process.
     * @returns {Promise<PDFDocument>}
     */
    static async decalibrateColorInPDFDocument(pdfDocument, options = {}) {
        const { verbose = false } = options;

        // Analyze all color spaces in the document
        const analysisResult = analyzeColorSpaces(pdfDocument, { debug: verbose });

        // Replace ICC-based color spaces with device color spaces
        const replacements = replaceICCWithDeviceColorSpaces(pdfDocument, analysisResult);

        if (verbose) {
            console.log(`Decalibration complete. Made ${replacements.length} color space replacements.`);
            for (const replacement of replacements) {
                console.log(`  Replaced ${replacement.currentColorSpace} with ${replacement.newColorSpace} in ${replacement.type}${replacement.colorSpaceKey ? ` (${replacement.colorSpaceKey})` : ''}`);
            }
        }

        return pdfDocument;
    }

    /**
     * Dumps information about a PDF document
     * @param {PDFDocument} pdfDocument
     * @returns Information about the PDF document
     */
    static dumpPDFDocumentInfo(pdfDocument) {
        // const pdfDocument = await PDFDocument.load(pdfBuffer);
        return dumpPDFDocument(pdfDocument);
    }

}
