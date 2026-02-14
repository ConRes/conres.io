// @ts-check
/**
 * PDFPageColorConverter - Page-level color conversion coordinator.
 *
 * Coordinates image and content stream conversion for a single PDF page.
 * Manages worker pool (own or shared from document converter).
 *
 * @module PDFPageColorConverter
 */

import { CompositeColorConverter } from './composite-color-converter.js';
import { PDFImageColorConverter } from './pdf-image-color-converter.js';
import { PDFContentStreamColorConverter } from './pdf-content-stream-color-converter.js';
import { compressWithFlateDecode } from '../services/helpers/pdf-lib.js';
import { PDFName, PDFDict, PDFRef, decodePDFRawStream, arrayAsString, copyStringIntoBuffer } from 'pdf-lib';

/**
 * @typedef {import('./color-converter.js').ColorConverterConfiguration & {
 *   convertImages: boolean,
 *   convertContentStreams: boolean,
 *   useWorkers: boolean,
 *   workerPool?: import('./worker-pool.js').WorkerPool,
 *   colorEnginePath?: string,
 *   imageConfiguration?: Partial<import('./pdf-image-color-converter.js').PDFImageColorConverterConfiguration>,
 *   contentStreamConfiguration?: Partial<import('./pdf-content-stream-color-converter.js').PDFContentStreamColorConverterConfiguration>,
 *   sourceRGBProfile?: ArrayBuffer,
 *   sourceGrayProfile?: ArrayBuffer,
 *   bufferRegistry?: import('./buffer-registry.js').BufferRegistry,
 * }} PDFPageColorConverterConfiguration
 */

/**
 * @typedef {{ 
 *   ref: import('pdf-lib').PDFRef, 
 *   stream: import('pdf-lib').PDFRawStream, 
 *   colorSpaceInfo: import('./pdf-document-color-converter.js').PDFColorSpaceInformation
 * }} PDFPageColorConverterInputImage
 */

/**
 * @typedef {{ 
 *   ref: import('pdf-lib').PDFRef, 
 *   stream: import('pdf-lib').PDFRawStream, 
 *   colorSpaceDefinitions: Record<string, import('./pdf-document-color-converter.js').PDFColorSpaceDefinition>
 * }} PDFPageColorConverterContentStreamImage
 */

/**
 * @typedef {{
 *   pageLeaf: import('pdf-lib').PDFDict,
 *   pageRef: import('pdf-lib').PDFRef,
 *   pageIndex: number,
 *   context: import('pdf-lib').PDFContext,
 *   pdfDocument: import('pdf-lib').PDFDocument,
 *   images?: PDFPageColorConverterInputImage[],
 *   contentStreams?: PDFPageColorConverterContentStreamImage[],
 * }} PDFPageColorConverterInput
 */

/**
 * @typedef {{
 *   pageRef: import('pdf-lib').PDFRef,
 *   pageIndex: number,
 *   imagesConverted: number,
 *   contentStreamsConverted: number,
 *   totalColorOperations: number,
 *   errors: string[],
 * }} PDFPageColorConverterResult
 */

/**
 * Coordinates color conversion for a single PDF page.
 *
 * @extends CompositeColorConverter
 * @example
 * ```javascript
 * const pageConverter = new PDFPageColorConverter({
 *     destinationProfile: cmykProfile,
 *     destinationColorSpace: 'CMYK',
 *     renderingIntent: 'relative-colorimetric',
 *     blackPointCompensation: true,
 *     convertImages: true,
 *     convertContentStreams: true,
 *     useWorkers: true,
 *     verbose: false,
 * });
 *
 * await pageConverter.convertColor({
 *     pageLeaf: pageDict,
 *     pageRef: pageRef,
 *     pageIndex: 0,
 *     context: pdfDocument.context,
 * });
 *
 * pageConverter.dispose();
 * ```
 */
export class PDFPageColorConverter extends CompositeColorConverter {
    /** @type {Promise<void>} */
    #ready;

    /** @type {PDFImageColorConverter | null} */
    #imageConverter = null;

    /** @type {PDFContentStreamColorConverter | null} */
    #contentStreamConverter = null;

    /** @type {import('./pdf-document-color-converter.js').NormalizedLabColorSpaceDescriptor | null} */
    #currentLabDescriptor = null;

    /**
     * Creates a new PDFPageColorConverter.
     *
     * @param {PDFPageColorConverterConfiguration} configuration
     * @param {object} [options={}] - Additional options (passed to parent)
     */
    constructor(configuration, options = {}) {
        super(configuration, options);
        this.#ready = this.#initialize();
    }

    /**
     * Async initialization for worker pool setup.
     * @returns {Promise<void>}
     */
    async #initialize() {
        // Wait for parent (CompositeColorConverter) WorkerPool initialization
        await super.ensureReady();

        // Create child converters
        this.#imageConverter = this.createChildConverter(PDFImageColorConverter, {
            ...this.deriveImageConfiguration(),
        });

        this.#contentStreamConverter = this.createChildConverter(PDFContentStreamColorConverter, {
            ...this.deriveContentStreamConfiguration(),
        });
    }

    /**
     * Ensures the converter is ready for use.
     * Overrides parent to include page-level initialization.
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
     * @returns {Readonly<PDFPageColorConverterConfiguration>}
     */
    get configuration() {
        return /** @type {Readonly<PDFPageColorConverterConfiguration>} */ (super.configuration);
    }

    // ========================================
    // Configuration Derivation
    // ========================================

    /**
     * Derives configuration for image conversion.
     *
     * @param {import('pdf-lib').PDFRef} [imageRef] - Optional image reference for per-image overrides
     * @returns {import('./pdf-image-color-converter.js').PDFImageColorConverterConfiguration}
     */
    deriveImageConfiguration(imageRef) {
        const base = this.configuration;
        const imageOverride = imageRef ? this.getConfigurationFor(imageRef) : undefined;

        return /** @type {import('./pdf-image-color-converter.js').PDFImageColorConverterConfiguration} */ ({
            // Inherit from page config
            renderingIntent: base.renderingIntent,
            blackPointCompensation: base.blackPointCompensation,

            destinationProfile: base.destinationProfile,
            destinationColorSpace: base.destinationColorSpace,
            verbose: base.verbose,

            // Diagnostics collector (propagate to child converters)
            diagnostics: this.diagnostics,

            // Image-specific defaults
            compressOutput: true,
            inputType: 'RGB', // Will be determined per-image

            // Merge page-level image configuration
            ...base.imageConfiguration,

            // Apply per-image overrides (if any)
            ...imageOverride,
        });
    }

    /**
     * Derives configuration for content stream conversion.
     *
     * @param {import('pdf-lib').PDFRef} [streamRef] - Optional stream reference for per-stream overrides
     * @returns {import('./pdf-content-stream-color-converter.js').PDFContentStreamColorConverterConfiguration}
     */
    deriveContentStreamConfiguration(streamRef) {
        const base = this.configuration;
        const streamOverride = streamRef ? this.getConfigurationFor(streamRef) : undefined;

        return /** @type {import('./pdf-content-stream-color-converter.js').PDFContentStreamColorConverterConfiguration} */ ({
            // Inherit from page config
            renderingIntent: base.renderingIntent,
            blackPointCompensation: base.blackPointCompensation,

            destinationProfile: base.destinationProfile,
            destinationColorSpace: base.destinationColorSpace,
            verbose: base.verbose,

            // Diagnostics collector (propagate to child converters)
            diagnostics: this.diagnostics,

            // Content stream specific
            useLookupTable: true,
            sourceRGBProfile: base.sourceRGBProfile,
            sourceGrayProfile: base.sourceGrayProfile,

            // Shared BufferRegistry for cross-instance caching
            bufferRegistry: base.bufferRegistry,

            // Merge page-level content stream configuration
            ...base.contentStreamConfiguration,

            // Apply per-stream overrides (if any)
            ...streamOverride,
        });
    }

    // ========================================
    // Color Conversion
    // ========================================

    /**
     * 
     * @param {object} parameters 
     * @param {PDFPageColorConverterInputImage} parameters.imageData
     * @param {import('./diagnostics-collector.js').SpanHandle} parameters.imageBatchSpan
     * @param {object} parameters.context
     * @param {Array<string>} parameters.errors
     * 
     */
    async #convertImage({ imageData, imageBatchSpan, context, errors }) {
        // Use startNestedSpan for concurrent operations under the batch span
        const imageSpan = this.diagnostics.startNestedSpan(imageBatchSpan, 'image-conversion', {
            ref: imageData.ref.toString(),
            colorSpace: imageData.colorSpaceInfo?.type,
        });

        // Pass the imageSpan as parentSpan in context so child converters can nest their spans correctly
        const imageContext = { ...context, parentSpan: imageSpan };

        try {
            // Check for per-image configuration override
            const imageOverride = this.getConfigurationFor(imageData.ref);
            // Extract proper input format from raw image data
            const imageInput = this.#extractImageInput(imageData);

            // Handle Indexed images specially - convert lookup table, not pixels
            if (imageInput.isIndexed) {
                await this.#convertIndexedImage(imageData, imageInput, imageContext);
                this.diagnostics.updateSpan(imageSpan, { indexed: true });
                return;
            }

            /** @type {import('./pdf-image-color-converter.js').PDFImageColorConverterResult | null} */
            let imageResult = null;

            if (imageOverride) {
                // Create a new converter with the override configuration
                const overrideConfig = this.deriveImageConfiguration(imageData.ref);
                const tempConverter = this.createChildConverter(PDFImageColorConverter, overrideConfig);
                try {
                    imageResult = /** @type {import('./pdf-image-color-converter.js').PDFImageColorConverterResult} */ (
                        await tempConverter.convertColor(imageInput, imageContext)
                    );
                } finally {
                    tempConverter.dispose();
                }
            } else if (this.#imageConverter) {
                imageResult = /** @type {import('./pdf-image-color-converter.js').PDFImageColorConverterResult} */ (
                    await this.#imageConverter.convertColor(imageInput, imageContext)
                );
            } else {
                throw new Error('Image converter not initialized');
            }

            // Apply converted image data back to the PDF stream
            if (imageResult && imageResult.streamData) {
                this.#applyImageResult(imageData.stream, imageResult);
                this.diagnostics.updateSpan(imageSpan, {
                    pixels: imageResult.pixelCount || 0,
                    bytes: imageResult.streamData.length,
                });
            } else {
                this.diagnostics.updateSpan(imageSpan, { skipped: true });
            }
        } catch (error) {
            errors.push(`Image ${imageData.ref.toString()}: ${error}`);
            this.diagnostics.abortSpan(imageSpan, { reason: `${error}` });
        } finally {
            this.diagnostics.endSpan(imageSpan);
        }

    }

    /**
     * Converts images via worker pool for parallel processing.
     *
     * Prepares tasks, dispatches to workers, and applies results.
     * Indexed images are converted on main thread (lookup table conversion).
     *
     * @param {Array<import('./pdf-page-color-converter.js').PDFPageColorConverterInputImage>} images
     * @param {any} imageBatchSpan - Parent span for diagnostics
     * @param {object} context - Conversion context
     * @param {string[]} errors - Error accumulator
     * @returns {Promise<number>} Number of images converted
     */
    async #convertImagesViaWorkers(images, imageBatchSpan, context, errors) {
        const config = this.configuration;
        const workerPool = this.workerPool;

        if (!workerPool || !this.#imageConverter) {
            return 0;
        }

        let imagesConverted = 0;

        // Separate indexed images (main thread) from regular images (worker)
        /** @type {Array<{imageData: any, imageInput: any, index: number}>} */
        const workerTasks = [];
        /** @type {Array<{imageData: any, index: number}>} */
        const indexedImages = [];

        for (let i = 0; i < images.length; i++) {
            const imageData = images[i];
            const imageInput = this.#extractImageInput(imageData);

            if (imageInput.isIndexed) {
                indexedImages.push({ imageData, index: i });
            } else {
                workerTasks.push({ imageData, imageInput, index: i });
            }
        }

        // Process indexed images on main thread (lookup table conversion)
        for (const { imageData, index } of indexedImages) {
            const imageSpan = this.diagnostics.startNestedSpan(imageBatchSpan, 'indexed-image', {
                ref: imageData.ref.toString(),
                index,
            });
            try {
                const imageInput = this.#extractImageInput(imageData);
                const imageContext = { ...context, parentSpan: imageSpan };
                await this.#convertIndexedImage(imageData, imageInput, imageContext);
                this.diagnostics.updateSpan(imageSpan, { indexed: true });
                imagesConverted++;
            } catch (error) {
                errors.push(`Image ${imageData.ref.toString()}: ${/** @type {Error} */ (error).message}`);
                this.diagnostics.abortSpan(imageSpan, { reason: /** @type {Error} */ (error).message });
            } finally {
                this.diagnostics.endSpan(imageSpan);
            }
        }

        // Dispatch regular images to workers in parallel
        if (workerTasks.length > 0) {
            // Prepare all tasks
            /** @type {Array<{task: import('./worker-pool.js').ImageTask, imageData: any, imageInput: any}>} */
            const preparedTasks = [];

            for (const { imageData, imageInput } of workerTasks) {
                try {
                    // Check for per-image configuration override
                    const imageOverride = this.getConfigurationFor(imageData.ref);
                    let converter = this.#imageConverter;

                    if (imageOverride) {
                        const overrideConfig = this.deriveImageConfiguration(imageData.ref);
                        converter = this.createChildConverter(PDFImageColorConverter, overrideConfig);
                    }

                    const task = /** @type {import('./worker-pool.js').ImageTask} */ (
                        converter.prepareWorkerTask(imageInput, context)
                    );

                    if (task) {
                        preparedTasks.push({ task, imageData, imageInput });
                    }
                } catch (error) {
                    errors.push(`Image ${imageData.ref.toString()}: ${/** @type {Error} */ (error).message}`);
                }
            }

            // Submit all tasks to worker pool in parallel
            const results = await Promise.all(
                preparedTasks.map(async ({ task, imageData, imageInput }) => {
                    const imageSpan = this.diagnostics.startNestedSpan(imageBatchSpan, 'worker-image', {
                        ref: imageData.ref.toString(),
                        width: task.width,
                        height: task.height,
                    });

                    try {
                        const result = await workerPool.submitImage(task);

                        if (result.success && result.pixelBuffer) {
                            // Validate required worker result fields
                            if (result.bitsPerComponent === undefined) {
                                throw new Error(`Worker result missing bitsPerComponent for image ${imageData.ref.toString()}`);
                            }
                            if (result.isCompressed === undefined) {
                                throw new Error(`Worker result missing isCompressed for image ${imageData.ref.toString()}`);
                            }

                            // Create PDFImageColorConverterResult from worker result
                            /** @type {import('./pdf-image-color-converter.js').PDFImageColorConverterResult} */
                            const imageResult = {
                                streamRef: imageData.ref,
                                streamData: /** @type {Uint8Array} */ (result.pixelBuffer),
                                isCompressed: result.isCompressed,
                                width: task.width,
                                height: task.height,
                                colorSpace: task.destinationColorSpace,
                                bitsPerComponent: result.bitsPerComponent,
                                pixelCount: result.pixelCount ?? (task.width * task.height),
                            };

                            // Apply result to PDF
                            this.#applyImageResult(imageData.stream, imageResult);

                            this.diagnostics.updateSpan(imageSpan, {
                                pixels: imageResult.pixelCount,
                                bytes: imageResult.streamData.length,
                                worker: true,
                            });

                            return { success: true };
                        } else {
                            const errorMsg = result.error || 'Unknown worker error';
                            errors.push(`Image ${imageData.ref.toString()}: ${errorMsg}`);
                            this.diagnostics.abortSpan(imageSpan, { reason: errorMsg });
                            return { success: false };
                        }
                    } catch (error) {
                        const errorMsg = /** @type {Error} */ (error).message;
                        errors.push(`Image ${imageData.ref.toString()}: ${errorMsg}`);
                        this.diagnostics.abortSpan(imageSpan, { reason: errorMsg });
                        return { success: false };
                    } finally {
                        this.diagnostics.endSpan(imageSpan);
                    }
                })
            );

            imagesConverted += results.filter(r => r.success).length;
        }

        return imagesConverted;
    }

    /**
     * Converts colors on a PDF page.
     *
     * @param {PDFPageColorConverterInput} input
     * @param {object} context
     * @returns {Promise<PDFPageColorConverterResult>}
     */
    async convertColor(input, context) {
        await this.ensureReady();

        const config = this.configuration;
        /** @type {string[]} */
        const errors = [];
        let imagesConverted = 0;
        let contentStreamsConverted = 0;

        // For Lab output, get Lab color space descriptor BEFORE processing images and content streams
        /** @type {string | undefined} */
        let labColorSpaceName;
        if (config.destinationColorSpace === 'Lab' && input.pageLeaf && input.pdfDocument) {
            const labDescriptor = this.getNormalizedLabColorSpaceDescriptor(input.pageLeaf, input.pdfDocument);
            labColorSpaceName = labDescriptor.name;
            this.#currentLabDescriptor = labDescriptor;
        } else {
            this.#currentLabDescriptor = null;
        }

        // Convert images if enabled
        if (config.convertImages && input.images && this.#imageConverter) {
            const imageCount = input.images.length;
            const imageBatchSpan = this.diagnostics.startSpan('image-batch', {
                count: imageCount,
                pageIndex: input.pageIndex,
            });

            try {
                if (this.workerPool) {
                    // Worker mode: dispatch tasks in parallel to worker pool
                    imagesConverted = await this.#convertImagesViaWorkers(
                        input.images, imageBatchSpan, context, errors
                    );
                } else {
                    // Main thread mode: convert sequentially
                    for (const imageData of input.images) {
                        await this.#convertImage({ imageData, imageBatchSpan, context, errors });
                        imagesConverted++;
                    }
                }
            } finally {
                this.diagnostics.endSpan(imageBatchSpan, { converted: imagesConverted });
            }
        }

        // Convert content streams if enabled
        // IMPORTANT: Process sequentially to track color space state across streams.
        // PDF content streams on a page share graphics state, so the color space
        // set in one stream carries over to subsequent streams.
        /** @type {Array<import('./pdf-content-stream-color-converter.js').PDFContentStreamColorConverterResult>} */
        const streamResults = [];
        if (config.convertContentStreams && input.contentStreams && this.#contentStreamConverter) {
            const streamCount = input.contentStreams.length;
            const streamBatchSpan = this.diagnostics.startSpan('stream-batch', {
                count: streamCount,
                pageIndex: input.pageIndex,
            });

            try {
                // Track color space state across streams
                /** @type {import('./pdf-content-stream-color-converter.js').ColorSpaceState} */
                let currentColorSpaceState = {};

                for (const streamData of input.contentStreams) {
                    const streamSpan = this.diagnostics.startSpan('content-stream', {
                        ref: streamData.ref.toString(),
                    });

                    try {
                        // Check for per-stream configuration override
                        const streamOverride = this.getConfigurationFor(streamData.ref);
                        /** @type {import('./pdf-content-stream-color-converter.js').PDFContentStreamColorConverterResult} */
                        let streamResult;
                        if (streamOverride) {
                            const overrideConfig = this.deriveContentStreamConfiguration(streamData.ref);
                            const tempConverter = this.createChildConverter(PDFContentStreamColorConverter, overrideConfig);
                            try {
                                streamResult = /** @type {import('./pdf-content-stream-color-converter.js').PDFContentStreamColorConverterResult} */ (
                                    await tempConverter.convertColor({
                                        streamRef: streamData.ref,
                                        streamText: this.#getStreamText(streamData.stream),
                                        colorSpaceDefinitions: streamData.colorSpaceDefinitions,
                                        initialColorSpaceState: currentColorSpaceState,
                                        labColorSpaceName,
                                    }, context)
                                );
                            } finally {
                                tempConverter.dispose();
                            }
                        } else {
                            streamResult = /** @type {import('./pdf-content-stream-color-converter.js').PDFContentStreamColorConverterResult} */ (
                                await this.#contentStreamConverter.convertColor({
                                    streamRef: streamData.ref,
                                    streamText: this.#getStreamText(streamData.stream),
                                    colorSpaceDefinitions: streamData.colorSpaceDefinitions,
                                    initialColorSpaceState: currentColorSpaceState,
                                    labColorSpaceName,
                                }, context)
                            );
                        }

                        // Update color space state for next stream
                        if (streamResult.finalColorSpaceState) {
                            currentColorSpaceState = streamResult.finalColorSpaceState;
                        }

                        // Apply converted content stream back to the PDF
                        if (streamResult && streamResult.newText) {
                            await this.#applyContentStreamResult(streamData.stream, streamResult);
                            streamResults.push(streamResult);
                            contentStreamsConverted++;
                            this.diagnostics.updateSpan(streamSpan, {
                                ops: streamResult.colorConversions || 0,
                                bytes: streamResult.newText.length,
                            });
                        } else {
                            this.diagnostics.updateSpan(streamSpan, { skipped: true });
                        }
                    } catch (error) {
                        errors.push(`Content stream ${streamData.ref.toString()}: ${error}`);
                        this.diagnostics.abortSpan(streamSpan, { reason: `${error}` });
                    } finally {
                        this.diagnostics.endSpan(streamSpan);
                    }
                }
            } finally {
                this.diagnostics.endSpan(streamBatchSpan, { converted: contentStreamsConverted });
            }
        }

        // Aggregate color operations from all content stream results
        let totalColorOperations = 0;
        for (const streamResult of streamResults) {
            if (streamResult.colorConversions) {
                totalColorOperations += streamResult.colorConversions;
            }
        }

        return {
            pageRef: input.pageRef,
            pageIndex: input.pageIndex,
            imagesConverted,
            contentStreamsConverted,
            totalColorOperations,
            errors,
        };
    }

    /**
     * Extracts text from a PDF stream (decompressing if needed).
     *
     * @param {import('pdf-lib').PDFRawStream} stream
     * @returns {string}
     */
    #getStreamText(stream) {
        // Decompress the stream (handles FlateDecode, etc.)
        const bytes = /** @type {Uint8Array} */ (decodePDFRawStream(stream).decode());
        return arrayAsString(bytes);
    }

    /**
     * Extracts proper input format for PDFImageColorConverter from image data.
     *
     * @param {{
     *   ref: import('pdf-lib').PDFRef,
     *   stream: import('pdf-lib').PDFRawStream,
     *   colorSpaceInfo: import('./pdf-document-color-converter.js').PDFColorSpaceInformation,
     * }} imageData - Raw image data from document collector
     * @returns {import('./pdf-image-color-converter.js').PDFImageColorConverterInput & {isIndexed?: boolean, hival?: number, lookupData?: Uint8Array | null, baseComponents?: number}}
     */
    #extractImageInput(imageData) {
        const { ref, stream, colorSpaceInfo } = imageData;
        const dict = stream.dict;

        // Import PDFName for dictionary lookups
        const PDFName = /** @type {typeof import('pdf-lib').PDFName} */ (
            dict.constructor.name === 'PDFDict'
                ? Object.getPrototypeOf(dict).constructor.prototype.get.call(dict, 'Width')?.constructor
                : null
        ) || { of: (/** @type {string} */ s) => s };

        // Helper to get value from dict
        const getValue = (/** @type {string} */ key) => {
            try {
                const entries = Array.from(dict.entries());
                for (const [k, v] of entries) {
                    if (k.asString?.() === `/${key}` || k.toString() === `/${key}`) {
                        return v;
                    }
                }
            } catch {
                // Fallback
            }
            return undefined;
        };

        // Extract image properties from dictionary
        const widthValueObject = /** @type {import('pdf-lib').PDFNumber} */ (getValue('Width'));
        const heightValueObject = /** @type {import('pdf-lib').PDFNumber} */ (getValue('Height'));
        const bitsPerComponentValueObject = /** @type {import('pdf-lib').PDFNumber} */ (getValue('BitsPerComponent'));
        const filterValueObject = /** @type {import('pdf-lib').PDFName | import('pdf-lib').PDFArray | undefined} */ (getValue('Filter'));

        const width = widthValueObject?.asNumber?.() ?? widthValueObject?.value ?? 0;
        const height = heightValueObject?.asNumber?.() ?? heightValueObject?.value ?? 0;
        const bitsPerComponent = /** @type{import('./color-conversion-policy.js').BitDepth | 1 | 2 | 4} */ (bitsPerComponentValueObject?.asNumber?.() ?? bitsPerComponentValueObject?.value ?? 8);

        // Determine if compressed (has Filter entry)
        const isCompressed = filterValueObject !== undefined && filterValueObject !== null;

        // Map colorSpaceInfo.type to expected colorSpace format
        const typeToColorSpace = {
            'DeviceRGB': 'RGB',
            'DeviceGray': 'Gray',
            'DeviceCMYK': 'CMYK',
            'ICCBased-RGB': 'RGB',
            'ICCBased-CMYK': 'CMYK',
            'ICCBased-Gray': 'Gray',
            'Lab': 'Lab',
        };

        // Handle Indexed color space specially
        if (colorSpaceInfo.type === 'Indexed') {

            if (!colorSpaceInfo.baseType) throw new Error('Indexed color space missing baseType');

            // For Indexed images, we need the base color space for conversion
            const baseTypeToColorSpace = {
                'DeviceRGB': 'RGB',
                'DeviceGray': 'Gray',
                'DeviceCMYK': 'CMYK',
                'ICCBased-RGB': 'RGB',
                'ICCBased-CMYK': 'CMYK',
                'ICCBased-Gray': 'Gray',
                'Lab': 'Lab',
            };

            const baseColorSpace = baseTypeToColorSpace[colorSpaceInfo.baseType] || 'RGB';

            // Convert baseSourceProfile Uint8Array to ArrayBuffer if needed
            let baseSourceProfile = colorSpaceInfo.baseSourceProfile;
            if (baseSourceProfile instanceof Uint8Array) {
                baseSourceProfile = baseSourceProfile.buffer.slice(
                    baseSourceProfile.byteOffset,
                    baseSourceProfile.byteOffset + baseSourceProfile.byteLength
                );
            }

            return {
                streamRef: ref,
                streamData: stream.contents,
                isCompressed,
                width,
                height,
                colorSpace: /** @type {import('./color-converter.js').ColorType} */ (baseColorSpace),
                bitsPerComponent,
                sourceProfile: baseSourceProfile,
                imageDict: dict,
                // Indexed-specific fields
                isIndexed: true,
                hival: colorSpaceInfo.hival,
                lookupData: colorSpaceInfo.lookupData,
                baseComponents: colorSpaceInfo.baseComponents,
            };
        }

        const colorSpace = typeToColorSpace[/** @type {keyof typeof typeToColorSpace} */ (colorSpaceInfo.type)] || 'RGB';

        // Convert sourceProfile Uint8Array to ArrayBuffer if needed
        // ColorEngineService.loadProfile() expects ArrayBuffer, not Uint8Array
        let sourceProfile = colorSpaceInfo.sourceProfile;
        if (sourceProfile instanceof Uint8Array) {
            sourceProfile = sourceProfile.buffer.slice(
                sourceProfile.byteOffset,
                sourceProfile.byteOffset + sourceProfile.byteLength
            );
        }

        return {
            streamRef: ref,
            streamData: stream.contents,
            isCompressed,
            width,
            height,
            colorSpace: /** @type {import('./color-converter.js').ColorType} */ (colorSpace),
            bitsPerComponent,
            sourceProfile,
            imageDict: dict,
            isIndexed: false,
        };
    }

    /**
     * Applies converted image data back to the PDF stream.
     *
     * Updates the stream contents, ColorSpace, BitsPerComponent, Filter, and Length.
     *
     * @param {import('pdf-lib').PDFRawStream} stream - The PDF image stream to update
     * @param {import('./pdf-image-color-converter.js').PDFImageColorConverterResult} result - Conversion result
     */
    #applyImageResult(stream, result) {
        const dict = stream.dict;

        // Update stream contents with converted pixel data
        // @ts-ignore - Accessing internal property
        stream.contents = result.streamData;

        // Set the new color space based on output type
        if (result.colorSpace === 'CMYK') {
            dict.set(PDFName.of('ColorSpace'), PDFName.of('DeviceCMYK'));
        } else if (result.colorSpace === 'Lab' && this.#currentLabDescriptor) {
            // For Lab output, use the Lab color space array (or its reference)
            if (this.#currentLabDescriptor.ref) {
                dict.set(PDFName.of('ColorSpace'), this.#currentLabDescriptor.ref);
            } else {
                dict.set(PDFName.of('ColorSpace'), this.#currentLabDescriptor.resource);
            }
        } else {
            // Default to DeviceRGB for RGB output
            dict.set(PDFName.of('ColorSpace'), PDFName.of('DeviceRGB'));
        }

        // Update bits per component from converter result
        dict.set(PDFName.of('BitsPerComponent'), dict.context.obj(result.bitsPerComponent));

        // Set or remove filter based on compression state
        if (result.isCompressed) {
            dict.set(PDFName.of('Filter'), PDFName.of('FlateDecode'));
        } else {
            dict.delete(PDFName.of('Filter'));
        }

        // Remove any decode parameters (not needed after conversion)
        dict.delete(PDFName.of('DecodeParms'));

        // Update the stream length
        dict.set(PDFName.of('Length'), dict.context.obj(result.streamData.length));
    }

    /**
     * Applies converted content stream text back to the PDF stream.
     *
     * Encodes the text to bytes, compresses with FlateDecode, and updates the stream.
     *
     * @param {import('pdf-lib').PDFRawStream} stream - The PDF content stream to update
     * @param {import('./pdf-content-stream-color-converter.js').PDFContentStreamColorConverterResult} result - Conversion result
     * @returns {Promise<void>}
     */
    async #applyContentStreamResult(stream, result) {
        const dict = stream.dict;

        // Only apply if there were actual changes
        if (result.replacementCount === 0) {
            return;
        }

        // Encode the new text to bytes (using pdf-lib's Latin-1 identity mapping)
        const uncompressedData = new Uint8Array(result.newText.length);
        copyStringIntoBuffer(result.newText, uncompressedData, 0);

        // Compress the content stream
        const { compressed, wasCompressed } = await compressWithFlateDecode(uncompressedData);

        // Update stream contents
        // @ts-ignore - Accessing internal property
        stream.contents = compressed;

        // Set or remove filter based on compression
        if (wasCompressed) {
            dict.set(PDFName.of('Filter'), PDFName.of('FlateDecode'));
        } else {
            dict.delete(PDFName.of('Filter'));
        }

        // Remove any decode parameters
        dict.delete(PDFName.of('DecodeParms'));

        // Update the stream length
        dict.set(PDFName.of('Length'), dict.context.obj(compressed.length));
    }

    /**
     * Converts an Indexed color space image by converting the lookup table (palette).
     *
     * For Indexed images, the pixel data contains indices into a color lookup table.
     * We convert the lookup table colors from the base color space to CMYK,
     * keeping the pixel indices unchanged.
     *
     * @param {{ref: import('pdf-lib').PDFRef, stream: import('pdf-lib').PDFRawStream, colorSpaceInfo: object}} imageData
     * @param {Partial<import('./pdf-document-color-converter.js').PDFColorSpaceInformation>} imageInput - Extracted image input with Indexed fields
     * @param {object} context - Conversion context
     * @returns {Promise<void>}
     */
    async #convertIndexedImage(imageData, imageInput, context) {
        const config = this.configuration;
        const { lookupData, hival, baseComponents, colorSpace, sourceProfile } = imageInput;

        if (!lookupData || !baseComponents) {
            if (config.verbose) {
                console.warn(`[PDFPageColorConverter] Indexed image ${imageData.ref.toString()} missing lookup data`);
            }
            return;
        }

        const numColors = (hival ?? 255) + 1;
        const expectedBytes = numColors * baseComponents;

        if (lookupData.length < expectedBytes) {
            if (config.verbose) {
                console.warn(`[PDFPageColorConverter] Indexed image ${imageData.ref.toString()} lookup table too small: ${lookupData.length} < ${expectedBytes}`);
            }
            return;
        }

        if (config.verbose) {
            console.log(`[PDFPageColorConverter] Converting Indexed image ${imageData.ref.toString()}`);
            console.log(`  Base color space: ${colorSpace}, ${numColors} colors`);
        }

        // Build input colors array from lookup table
        // colorSpace is 'RGB', 'Gray', or 'Lab' - need to cast to ColorValue type
        /** @type {Array<import('../services/ColorEngineService.js').ColorValue>} */
        const inputColors = [];
        for (let i = 0; i < numColors; i++) {
            const offset = i * baseComponents;
            const values = [];
            for (let c = 0; c < baseComponents; c++) {
                if (colorSpace === 'Lab') {
                    // Lab values: L (0-100), a (-128 to 127), b (-128 to 127)
                    if (c === 0) {
                        values.push((lookupData[offset + c] / 255) * 100);  // L: 0-255 -> 0-100
                    } else {
                        values.push(lookupData[offset + c] - 128);  // a,b: 0-255 -> -128 to 127
                    }
                } else if (colorSpace === 'RGB') {
                    // RGB values are 0-255 in the buffer, ColorEngineService expects 0-255
                    values.push(lookupData[offset + c]);
                } else {
                    // Gray and CMYK: convert 0-255 to 0-1 range
                    values.push(lookupData[offset + c] / 255);
                }
            }
            inputColors.push({
                type: /** @type {'RGB' | 'Gray' | 'Lab' | 'CMYK'} */ (colorSpace),
                values,
            });
        }

        // Use shared ColorEngineService instance from parent converter
        const colorEngineService = this.colorEngineService;

        if (!colorEngineService) throw new Error('ColorEngineService not initialized');

        // Convert all palette colors at once using ColorEngineService.convertColors
        try {
            const conversionResults = await colorEngineService.convertColors(inputColors, {
                sourceProfile: sourceProfile ?? (colorSpace === 'RGB' ? config.sourceRGBProfile : config.sourceGrayProfile),
                destinationProfile: config.destinationProfile,
                renderingIntent: config.renderingIntent,
                blackPointCompensation: config.blackPointCompensation,
            });

            if (conversionResults && conversionResults.length > 0) {
                // Build the new CMYK lookup table (4 bytes per color)
                const cmykLookup = new Uint8Array(numColors * 4);
                for (let i = 0; i < numColors && i < conversionResults.length; i++) {
                    const result = conversionResults[i];
                    const cmykValues = result.output.values;
                    // ColorEngineService returns CMYK values in 0-1 range
                    cmykLookup[i * 4] = Math.round((cmykValues[0] ?? 0) * 255);
                    cmykLookup[i * 4 + 1] = Math.round((cmykValues[1] ?? 0) * 255);
                    cmykLookup[i * 4 + 2] = Math.round((cmykValues[2] ?? 0) * 255);
                    cmykLookup[i * 4 + 3] = Math.round((cmykValues[3] ?? 0) * 255);
                }

                // Apply the converted lookup table to the PDF
                // Import pdf-lib types for creating the new ColorSpace array
                const { PDFArray, PDFName, PDFNumber, PDFHexString } = await import('pdf-lib');

                // Get the PDF context from the image stream
                const pdfContext = imageData.stream.dict.context;

                // Create the new lookup table as a hex string
                // Convert Uint8Array to hex string for PDF
                let hexStr = '';
                for (let i = 0; i < cmykLookup.length; i++) {
                    hexStr += cmykLookup[i].toString(16).padStart(2, '0');
                }
                const newLookupPDF = PDFHexString.of(hexStr);

                // Create new ColorSpace array: [/Indexed /DeviceCMYK hival newLookup]
                const newColorSpaceArray = pdfContext.obj([
                    PDFName.of('Indexed'),
                    PDFName.of('DeviceCMYK'),
                    PDFNumber.of(hival ?? 255),
                    newLookupPDF,
                ]);

                // Update the image's ColorSpace
                imageData.stream.dict.set(PDFName.of('ColorSpace'), newColorSpaceArray);

                // Store in context for tracking (optional)
                (/** @type {any} */ (context).indexedConversions ??= new Map()).set(imageData.ref.toString(), {
                    originalRef: imageData.ref,
                    converted: true,
                    numColors,
                });

                if (config.verbose) {
                    console.log(`  Converted ${numColors} palette colors to CMYK and applied to PDF`);
                }
            }
        } catch (error) {
            if (config.verbose) {
                console.error(`[PDFPageColorConverter] Failed to convert Indexed image ${imageData.ref.toString()}: ${error}`);
            }
        }
    }

    // ========================================
    // Worker Mode Support
    // ========================================

    /**
     * Prepares worker tasks for this page.
     *
     * @param {PDFPageColorConverterInput} input
     * @param {object} context
     * @returns {object}
     */
    prepareWorkerTask(input, context) {
        const config = this.configuration;
        const tasks = [];

        if (config.convertImages && input.images) {
            for (const imageData of input.images) {
                if (this.#imageConverter) {
                    // Extract proper input format from raw image data
                    const imageInput = this.#extractImageInput(imageData);
                    const task = this.#imageConverter.prepareWorkerTask(imageInput, context);
                    if (task) {
                        tasks.push(task);
                    }
                }
            }
        }

        if (config.convertContentStreams && input.contentStreams) {
            for (const streamData of input.contentStreams) {
                if (this.#contentStreamConverter) {
                    const task = this.#contentStreamConverter.prepareWorkerTask({
                        streamRef: streamData.ref,
                        streamText: this.#getStreamText(streamData.stream),
                        colorSpaceDefinitions: streamData.colorSpaceDefinitions,
                    }, context);
                    if (task) {
                        tasks.push(task);
                    }
                }
            }
        }

        return {
            type: 'page',
            pageRef: input.pageRef.toString(),
            pageIndex: input.pageIndex,
            tasks,
        };
    }

    /**
     * Applies worker processing results back to the PDF structure.
     *
     * Receives aggregated results for all images and content streams on this page.
     * Delegates to child converters (image and content stream) to apply their
     * respective results.
     *
     * @override
     * @param {PDFPageColorConverterInput} input - Original page input
     * @param {import('./color-converter.js').WorkerResult} workerResult - Aggregated worker results
     * @param {object} context - Conversion context
     * @returns {Promise<void>}
     */
    async applyWorkerResult(input, workerResult, context) {
        await this.#ready;

        const config = this.configuration;

        if (!workerResult.success) {
            if (config.verbose) {
                console.warn(`[PDFPageColorConverter] Worker failed for page ${input.pageIndex}: ${workerResult.error}`);
            }
            return;
        }

        // Worker result contains arrays of image and content stream results
        /** @type {import('./color-converter.js').WorkerResult[]} */
        const imageResults = workerResult.imageResults ?? [];
        /** @type {import('./color-converter.js').WorkerResult[]} */
        const contentStreamResults = workerResult.contentStreamResults ?? [];

        if (config.verbose) {
            console.log(`[PDFPageColorConverter] Applying worker results for page ${input.pageIndex}`);
            console.log(`  Image results: ${imageResults.length}`);
            console.log(`  Content stream results: ${contentStreamResults.length}`);
        }

        // Apply image results
        if (config.convertImages && input.images && this.#imageConverter) {
            for (let i = 0; i < imageResults.length && i < input.images.length; i++) {
                const imageResult = imageResults[i];
                if (imageResult && imageResult.success) {
                    const imageInput = this.#extractImageInput(input.images[i]);
                    /** @type {Partial<{ workerResult: import('./color-converter.js').WorkerResult, imageWorkerResults: import('./color-converter.js').WorkerResult[] }>} */
                    const imageContext = { ...context };
                    await this.#imageConverter.applyWorkerResult(imageInput, imageResult, imageContext);

                    // Collect result from child context for document-level application
                    if (imageContext.workerResult) {
                        (imageContext.imageWorkerResults ??= []).push(imageContext.workerResult);
                    }
                }
            }
        }

        // Apply content stream results
        if (config.convertContentStreams && input.contentStreams && this.#contentStreamConverter) {
            for (let i = 0; i < contentStreamResults.length && i < input.contentStreams.length; i++) {
                const streamResult = contentStreamResults[i];
                if (streamResult && streamResult.success) {
                    const streamData = input.contentStreams[i];
                    const streamInput = {
                        streamRef: streamData.ref,
                        streamText: this.#getStreamText(streamData.stream),
                        colorSpaceDefinitions: streamData.colorSpaceDefinitions,
                    };
                    /** @type {Partial<{ contentStreamWorkerResult: import('./color-converter.js').WorkerResult, contentStreamWorkerResults: import('./color-converter.js').WorkerResult[] }>} */
                    const streamContext = { ...context };
                    await this.#contentStreamConverter.applyWorkerResult(streamInput, streamResult, streamContext);

                    // Collect result from child context for document-level application
                    if (streamContext.contentStreamWorkerResult) {
                        (streamContext.contentStreamWorkerResults ??= []).push(streamContext.contentStreamWorkerResult);
                    }
                }
            }
        }

        // Store page-level summary in context
        /** @type {{ pageWorkerResult: import('./color-converter.js').WorkerResult }} */ (context).pageWorkerResult = {
            pageRef: input.pageRef,
            pageIndex: input.pageIndex,
            imagesApplied: imageResults.filter(r => r?.success).length,
            contentStreamsApplied: contentStreamResults.filter(r => r?.success).length,
        };
    }

    // ========================================
    // Lab Color Space Management
    // ========================================

    /**
     * Ensures the normalized D50 Lab color space is available in the page's resources.
     *
     * Calls the parent document converter's `getNormalizedLabColorSpaceDescriptor()`
     * to get or create the Lab color space, then adds it to this page's
     * Resources/ColorSpace dictionary if not already present.
     *
     * @param {import('pdf-lib').PDFDict} pageDict - The page dictionary (pageLeaf)
     * @param {import('pdf-lib').PDFDocument} pdfDocument - The PDF document
     * @returns {import('./pdf-document-color-converter.js').NormalizedLabColorSpaceDescriptor}
     */
    getNormalizedLabColorSpaceDescriptor(pageDict, pdfDocument) {
        // Get the Lab descriptor from the parent document converter
        const parentConverter = /** @type {import('./pdf-document-color-converter.js').PDFDocumentColorConverter} */ (
            this.parentConverter
        );
        if (!parentConverter || typeof parentConverter.getNormalizedLabColorSpaceDescriptor !== 'function') {
            throw new Error('PDFPageColorConverter requires a parent PDFDocumentColorConverter with getNormalizedLabColorSpaceDescriptor()');
        }

        const descriptor = parentConverter.getNormalizedLabColorSpaceDescriptor(pdfDocument);

        // Now ensure the Lab color space is in this page's Resources/ColorSpace dictionary
        const pdfContext = pdfDocument.context;

        // Get or create Resources dictionary
        let resources = /** @type {import('pdf-lib').PDFDict | import('pdf-lib').PDFRef | undefined} */(pageDict.get(PDFName.of('Resources')));

        if (resources instanceof PDFRef) {
            resources = /** @type {import('pdf-lib').PDFDict | import('pdf-lib').PDFRef | undefined} */ (pdfContext.lookup(resources));
        }

        if (!(resources instanceof PDFDict)) {
            // Create empty Resources dict if missing
            resources = pdfContext.obj({});
            pageDict.set(PDFName.of('Resources'), resources);
        }

        // Get or create ColorSpace dictionary within Resources
        let colorSpaces = /** @type {import('pdf-lib').PDFDict | import('pdf-lib').PDFRef | undefined} */ (resources.get(PDFName.of('ColorSpace')));

        if (colorSpaces instanceof PDFRef) {
            colorSpaces = /** @type {import('pdf-lib').PDFDict | import('pdf-lib').PDFRef | undefined} */ (pdfContext.lookup(colorSpaces));
        }

        if (!(colorSpaces instanceof PDFDict)) {
            // Create empty ColorSpace dict if missing
            colorSpaces = pdfContext.obj({});
            resources.set(PDFName.of('ColorSpace'), colorSpaces);
        }

        // Check if Lab color space is already in page resources
        const labName = PDFName.of(descriptor.name);

        const existingLab = colorSpaces.get(labName);

        if (!existingLab) {
            // Add the Lab color space reference to page resources
            if (descriptor.ref) {
                colorSpaces.set(labName, descriptor.ref);
            } else {
                colorSpaces.set(labName, descriptor.resource);
            }

            if (this.configuration.verbose) {
                console.log(`[PDFPageColorConverter] Added Lab color space '${descriptor.name}' to page resources`);
            }
        }

        return descriptor;
    }

    // ========================================
    // Resource Cleanup
    // ========================================

    /**
     * Disposes of resources.
     */
    dispose() {
        if (this.#imageConverter) {
            this.#imageConverter.dispose();
            this.#imageConverter = null;
        }

        if (this.#contentStreamConverter) {
            this.#contentStreamConverter.dispose();
            this.#contentStreamConverter = null;
        }

        // WorkerPool cleanup handled by CompositeColorConverter parent
        super.dispose();
    }
}
