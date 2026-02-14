// @ts-check
/**
 * Legacy PDF Page Color Converter
 *
 * Full duplication of PDFPageColorConverter that creates Legacy child converters
 * (LegacyPDFImageColorConverter, LegacyPDFContentStreamColorConverter) instead
 * of base class converters.
 *
 * Full duplication is required because PDFPageColorConverter.#initialize() is a
 * private method that hardcodes base child class names. Cannot be overridden.
 *
 * For engines up to 2026-01-30.
 *
 * @module LegacyPDFPageColorConverter
 * @author Saleh Abdel Motaal <dev@smotaal.io>
 * @ai Claude Opus 4.6 (code generation)
 */

import { CompositeColorConverter } from '../composite-color-converter.js';
import { LegacyPDFImageColorConverter } from './legacy-pdf-image-color-converter.js';
import { LegacyPDFContentStreamColorConverter } from './legacy-pdf-content-stream-color-converter.js';
import { compressWithFlateDecode, bytesAsString } from '../../services/helpers/pdf-lib.js';
import { PDFName, PDFDict, PDFRef, decodePDFRawStream, copyStringIntoBuffer } from 'pdf-lib';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Legacy page converter configuration adds legacy-specific properties.
 *
 * @typedef {import('../color-converter.js').ColorConverterConfiguration & {
 *   convertImages: boolean,
 *   convertContentStreams: boolean,
 *   useWorkers: boolean,
 *   workerPool?: import('../worker-pool.js').WorkerPool,
 *   colorEnginePath?: string,
 *   imageConfiguration?: Partial<import('./legacy-pdf-image-color-converter.js').LegacyPDFImageColorConverterConfiguration>,
 *   contentStreamConfiguration?: Partial<import('./legacy-pdf-content-stream-color-converter.js').LegacyPDFContentStreamColorConverterConfiguration>,
 *   sourceRGBProfile?: ArrayBuffer,
 *   sourceGrayProfile?: ArrayBuffer,
 *   bufferRegistry?: import('../buffer-registry.js').BufferRegistry,
 *   useAdaptiveBPCClamping?: boolean,
 *   coerceLabAbsoluteZeroPixels?: boolean,
 * }} LegacyPDFPageColorConverterConfiguration
 */

// Re-export types from PDFPageColorConverter for compatibility
/**
 * @typedef {import('../pdf-page-color-converter.js').PDFPageColorConverterInputImage} PDFPageColorConverterInputImage
 * @typedef {import('../pdf-page-color-converter.js').PDFPageColorConverterContentStreamImage} PDFPageColorConverterContentStreamImage
 * @typedef {import('../pdf-page-color-converter.js').PDFPageColorConverterInput} PDFPageColorConverterInput
 * @typedef {import('../pdf-page-color-converter.js').PDFPageColorConverterResult} PDFPageColorConverterResult
 */

// ============================================================================
// LegacyPDFPageColorConverter Class
// ============================================================================

/**
 * Legacy page-level color conversion coordinator.
 *
 * Creates LegacyPDFImageColorConverter and LegacyPDFContentStreamColorConverter
 * as children, passing legacy configuration properties through.
 *
 * @extends CompositeColorConverter
 */
export class LegacyPDFPageColorConverter extends CompositeColorConverter {
    /** @type {Promise<void>} */
    #ready;

    /** @type {LegacyPDFImageColorConverter | null} */
    #imageConverter = null;

    /** @type {LegacyPDFContentStreamColorConverter | null} */
    #contentStreamConverter = null;

    /** @type {import('../pdf-document-color-converter.js').NormalizedLabColorSpaceDescriptor | null} */
    #currentLabDescriptor = null;

    /**
     * Creates a new LegacyPDFPageColorConverter.
     *
     * @param {LegacyPDFPageColorConverterConfiguration} configuration
     * @param {object} [options={}]
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
        await super.ensureReady();

        // Create Legacy child converters
        this.#imageConverter = this.createChildConverter(LegacyPDFImageColorConverter, {
            ...this.deriveImageConfiguration(),
        });

        this.#contentStreamConverter = this.createChildConverter(LegacyPDFContentStreamColorConverter, {
            ...this.deriveContentStreamConfiguration(),
        });
    }

    /**
     * Ensures the converter is ready for use.
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
     * @returns {Readonly<LegacyPDFPageColorConverterConfiguration>}
     */
    get configuration() {
        return /** @type {Readonly<LegacyPDFPageColorConverterConfiguration>} */ (super.configuration);
    }

    // ========================================
    // Configuration Derivation
    // ========================================

    /**
     * Derives configuration for image conversion with legacy properties.
     *
     * @param {import('pdf-lib').PDFRef} [imageRef]
     * @returns {import('./legacy-pdf-image-color-converter.js').LegacyPDFImageColorConverterConfiguration}
     */
    deriveImageConfiguration(imageRef) {
        const base = this.configuration;
        const imageOverride = imageRef ? this.getConfigurationFor(imageRef) : undefined;

        return /** @type {import('./legacy-pdf-image-color-converter.js').LegacyPDFImageColorConverterConfiguration} */ ({
            // Inherit from page config
            renderingIntent: base.renderingIntent,
            blackPointCompensation: base.blackPointCompensation,

            destinationProfile: base.destinationProfile,
            destinationColorSpace: base.destinationColorSpace,
            verbose: base.verbose,

            // Diagnostics collector
            diagnostics: this.diagnostics,

            // Image-specific defaults
            compressOutput: true,
            inputType: 'RGB',

            // Legacy-specific configuration
            useAdaptiveBPCClamping: base.useAdaptiveBPCClamping,
            coerceLabAbsoluteZeroPixels: base.coerceLabAbsoluteZeroPixels,

            // Merge page-level image configuration
            ...base.imageConfiguration,

            // Apply per-image overrides (if any)
            ...imageOverride,
        });
    }

    /**
     * Derives configuration for content stream conversion with legacy properties.
     *
     * @param {import('pdf-lib').PDFRef} [streamRef]
     * @returns {import('./legacy-pdf-content-stream-color-converter.js').LegacyPDFContentStreamColorConverterConfiguration}
     */
    deriveContentStreamConfiguration(streamRef) {
        const base = this.configuration;
        const streamOverride = streamRef ? this.getConfigurationFor(streamRef) : undefined;

        return /** @type {import('./legacy-pdf-content-stream-color-converter.js').LegacyPDFContentStreamColorConverterConfiguration} */ ({
            // Inherit from page config
            renderingIntent: base.renderingIntent,
            blackPointCompensation: base.blackPointCompensation,

            destinationProfile: base.destinationProfile,
            destinationColorSpace: base.destinationColorSpace,
            verbose: base.verbose,

            // Diagnostics collector
            diagnostics: this.diagnostics,

            // Content stream specific
            useLookupTable: true,
            sourceRGBProfile: base.sourceRGBProfile,
            sourceGrayProfile: base.sourceGrayProfile,

            // Shared BufferRegistry for cross-instance caching
            bufferRegistry: base.bufferRegistry,

            // Legacy-specific configuration
            useAdaptiveBPCClamping: base.useAdaptiveBPCClamping,

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
     * @param {object} parameters
     * @param {PDFPageColorConverterInputImage} parameters.imageData
     * @param {import('../diagnostics-collector.js').SpanHandle} parameters.imageBatchSpan
     * @param {object} parameters.context
     * @param {Array<string>} parameters.errors
     */
    async #convertImage({ imageData, imageBatchSpan, context, errors }) {
        const imageSpan = this.diagnostics.startNestedSpan(imageBatchSpan, 'image-conversion', {
            ref: imageData.ref.toString(),
            colorSpace: imageData.colorSpaceInfo?.type,
        });

        const imageContext = { ...context, parentSpan: imageSpan };

        try {
            const imageOverride = this.getConfigurationFor(imageData.ref);
            const imageInput = this.#extractImageInput(imageData);

            if (imageInput.isIndexed) {
                await this.#convertIndexedImage(imageData, imageInput, imageContext);
                this.diagnostics.updateSpan(imageSpan, { indexed: true });
                return;
            }

            /** @type {import('../pdf-image-color-converter.js').PDFImageColorConverterResult | null} */
            let imageResult = null;

            if (imageOverride) {
                const overrideConfig = this.deriveImageConfiguration(imageData.ref);
                const tempConverter = this.createChildConverter(LegacyPDFImageColorConverter, overrideConfig);
                try {
                    imageResult = /** @type {import('../pdf-image-color-converter.js').PDFImageColorConverterResult} */ (
                        await tempConverter.convertColor(imageInput, imageContext)
                    );
                } finally {
                    tempConverter.dispose();
                }
            } else if (this.#imageConverter) {
                imageResult = /** @type {import('../pdf-image-color-converter.js').PDFImageColorConverterResult} */ (
                    await this.#imageConverter.convertColor(imageInput, imageContext)
                );
            } else {
                throw new Error('Image converter not initialized');
            }

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
     * @param {Array<PDFPageColorConverterInputImage>} images
     * @param {any} imageBatchSpan
     * @param {object} context
     * @param {string[]} errors
     * @returns {Promise<number>}
     */
    async #convertImagesViaWorkers(images, imageBatchSpan, context, errors) {
        const config = this.configuration;
        const workerPool = this.workerPool;

        if (!workerPool || !this.#imageConverter) {
            return 0;
        }

        let imagesConverted = 0;

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

        // Process indexed images on main thread
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

        // Dispatch regular images to workers
        if (workerTasks.length > 0) {
            /** @type {Array<{task: import('../worker-pool.js').ImageTask, imageData: any, imageInput: any}>} */
            const preparedTasks = [];

            for (const { imageData, imageInput } of workerTasks) {
                try {
                    const imageOverride = this.getConfigurationFor(imageData.ref);
                    let converter = this.#imageConverter;

                    if (imageOverride) {
                        const overrideConfig = this.deriveImageConfiguration(imageData.ref);
                        converter = this.createChildConverter(LegacyPDFImageColorConverter, overrideConfig);
                    }

                    const task = /** @type {import('../worker-pool.js').ImageTask} */ (
                        converter.prepareWorkerTask(imageInput, context)
                    );

                    if (task) {
                        preparedTasks.push({ task, imageData, imageInput });
                    }
                } catch (error) {
                    errors.push(`Image ${imageData.ref.toString()}: ${/** @type {Error} */ (error).message}`);
                }
            }

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
                            if (result.bitsPerComponent === undefined) {
                                throw new Error(`Worker result missing bitsPerComponent for image ${imageData.ref.toString()}`);
                            }
                            if (result.isCompressed === undefined) {
                                throw new Error(`Worker result missing isCompressed for image ${imageData.ref.toString()}`);
                            }

                            /** @type {import('../pdf-image-color-converter.js').PDFImageColorConverterResult} */
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

        // For Lab output, get Lab color space descriptor
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
                    imagesConverted = await this.#convertImagesViaWorkers(
                        input.images, imageBatchSpan, context, errors
                    );
                } else {
                    for (const imageData of input.images) {
                        await this.#convertImage({ imageData, imageBatchSpan, context, errors });
                        imagesConverted++;
                    }
                }
            } finally {
                this.diagnostics.endSpan(imageBatchSpan, { converted: imagesConverted });
            }
        }

        // Convert content streams if enabled (sequentially for color space state tracking)
        /** @type {Array<import('../pdf-content-stream-color-converter.js').PDFContentStreamColorConverterResult>} */
        const streamResults = [];
        if (config.convertContentStreams && input.contentStreams && this.#contentStreamConverter) {
            const streamCount = input.contentStreams.length;
            const streamBatchSpan = this.diagnostics.startSpan('stream-batch', {
                count: streamCount,
                pageIndex: input.pageIndex,
            });

            try {
                /** @type {import('../pdf-content-stream-color-converter.js').ColorSpaceState} */
                let currentColorSpaceState = {};

                for (const streamData of input.contentStreams) {
                    const streamSpan = this.diagnostics.startSpan('content-stream', {
                        ref: streamData.ref.toString(),
                    });

                    try {
                        const streamOverride = this.getConfigurationFor(streamData.ref);
                        /** @type {import('../pdf-content-stream-color-converter.js').PDFContentStreamColorConverterResult} */
                        let streamResult;
                        if (streamOverride) {
                            const overrideConfig = this.deriveContentStreamConfiguration(streamData.ref);
                            const tempConverter = this.createChildConverter(LegacyPDFContentStreamColorConverter, overrideConfig);
                            try {
                                streamResult = /** @type {import('../pdf-content-stream-color-converter.js').PDFContentStreamColorConverterResult} */ (
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
                            streamResult = /** @type {import('../pdf-content-stream-color-converter.js').PDFContentStreamColorConverterResult} */ (
                                await this.#contentStreamConverter.convertColor({
                                    streamRef: streamData.ref,
                                    streamText: this.#getStreamText(streamData.stream),
                                    colorSpaceDefinitions: streamData.colorSpaceDefinitions,
                                    initialColorSpaceState: currentColorSpaceState,
                                    labColorSpaceName,
                                }, context)
                            );
                        }

                        if (streamResult.finalColorSpaceState) {
                            currentColorSpaceState = streamResult.finalColorSpaceState;
                        }

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

    // ========================================
    // Stream Helpers (duplicated from PDFPageColorConverter)
    // ========================================

    /**
     * Extracts text from a PDF stream (decompressing if needed).
     *
     * @param {import('pdf-lib').PDFRawStream} stream
     * @returns {string}
     */
    #getStreamText(stream) {
        const bytes = /** @type {Uint8Array} */ (decodePDFRawStream(stream).decode());
        return bytesAsString(bytes);
    }

    /**
     * Extracts proper input format for PDFImageColorConverter from image data.
     *
     * @param {{
     *   ref: import('pdf-lib').PDFRef,
     *   stream: import('pdf-lib').PDFRawStream,
     *   colorSpaceInfo: import('../pdf-document-color-converter.js').PDFColorSpaceInformation,
     * }} imageData
     * @returns {import('../pdf-image-color-converter.js').PDFImageColorConverterInput & {isIndexed?: boolean, hival?: number, lookupData?: Uint8Array | null, baseComponents?: number}}
     */
    #extractImageInput(imageData) {
        const { ref, stream, colorSpaceInfo } = imageData;
        const dict = stream.dict;

        const PDFNameCtor = /** @type {typeof import('pdf-lib').PDFName} */ (
            dict.constructor.name === 'PDFDict'
                ? Object.getPrototypeOf(dict).constructor.prototype.get.call(dict, 'Width')?.constructor
                : null
        ) || { of: (/** @type {string} */ s) => s };

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

        const widthValueObject = /** @type {import('pdf-lib').PDFNumber} */ (getValue('Width'));
        const heightValueObject = /** @type {import('pdf-lib').PDFNumber} */ (getValue('Height'));
        const bitsPerComponentValueObject = /** @type {import('pdf-lib').PDFNumber} */ (getValue('BitsPerComponent'));
        const filterValueObject = /** @type {import('pdf-lib').PDFName | import('pdf-lib').PDFArray | undefined} */ (getValue('Filter'));

        const width = widthValueObject?.asNumber?.() ?? widthValueObject?.value ?? 0;
        const height = heightValueObject?.asNumber?.() ?? heightValueObject?.value ?? 0;
        const bitsPerComponent = /** @type{import('../color-conversion-policy.js').BitDepth | 1 | 2 | 4} */ (bitsPerComponentValueObject?.asNumber?.() ?? bitsPerComponentValueObject?.value ?? 8);
        const isCompressed = filterValueObject !== undefined && filterValueObject !== null;

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
                colorSpace: /** @type {import('../color-converter.js').ColorType} */ (baseColorSpace),
                bitsPerComponent,
                sourceProfile: baseSourceProfile,
                imageDict: dict,
                isIndexed: true,
                hival: colorSpaceInfo.hival,
                lookupData: colorSpaceInfo.lookupData,
                baseComponents: colorSpaceInfo.baseComponents,
            };
        }

        const colorSpace = typeToColorSpace[/** @type {keyof typeof typeToColorSpace} */ (colorSpaceInfo.type)] || 'RGB';

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
            colorSpace: /** @type {import('../color-converter.js').ColorType} */ (colorSpace),
            bitsPerComponent,
            sourceProfile,
            imageDict: dict,
            isIndexed: false,
        };
    }

    /**
     * Applies converted image data back to the PDF stream.
     *
     * @param {import('pdf-lib').PDFRawStream} stream
     * @param {import('../pdf-image-color-converter.js').PDFImageColorConverterResult} result
     */
    #applyImageResult(stream, result) {
        const dict = stream.dict;

        // @ts-ignore - Accessing internal property
        stream.contents = result.streamData;

        if (result.colorSpace === 'CMYK') {
            dict.set(PDFName.of('ColorSpace'), PDFName.of('DeviceCMYK'));
        } else if (result.colorSpace === 'Lab' && this.#currentLabDescriptor) {
            if (this.#currentLabDescriptor.ref) {
                dict.set(PDFName.of('ColorSpace'), this.#currentLabDescriptor.ref);
            } else {
                dict.set(PDFName.of('ColorSpace'), this.#currentLabDescriptor.resource);
            }
        } else {
            dict.set(PDFName.of('ColorSpace'), PDFName.of('DeviceRGB'));
        }

        dict.set(PDFName.of('BitsPerComponent'), dict.context.obj(result.bitsPerComponent));

        if (result.isCompressed) {
            dict.set(PDFName.of('Filter'), PDFName.of('FlateDecode'));
        } else {
            dict.delete(PDFName.of('Filter'));
        }

        dict.delete(PDFName.of('DecodeParms'));
        dict.set(PDFName.of('Length'), dict.context.obj(result.streamData.length));
    }

    /**
     * Applies converted content stream text back to the PDF stream.
     *
     * @param {import('pdf-lib').PDFRawStream} stream
     * @param {import('../pdf-content-stream-color-converter.js').PDFContentStreamColorConverterResult} result
     * @returns {Promise<void>}
     */
    async #applyContentStreamResult(stream, result) {
        const dict = stream.dict;

        if (result.replacementCount === 0) {
            return;
        }

        const uncompressedData = new Uint8Array(result.newText.length);
        copyStringIntoBuffer(result.newText, uncompressedData, 0);

        const { compressed, wasCompressed } = await compressWithFlateDecode(uncompressedData);

        // @ts-ignore - Accessing internal property
        stream.contents = compressed;

        if (wasCompressed) {
            dict.set(PDFName.of('Filter'), PDFName.of('FlateDecode'));
        } else {
            dict.delete(PDFName.of('Filter'));
        }

        dict.delete(PDFName.of('DecodeParms'));
        dict.set(PDFName.of('Length'), dict.context.obj(compressed.length));
    }

    /**
     * Converts an Indexed color space image by converting the lookup table.
     *
     * @param {{ref: import('pdf-lib').PDFRef, stream: import('pdf-lib').PDFRawStream, colorSpaceInfo: object}} imageData
     * @param {Partial<import('../pdf-document-color-converter.js').PDFColorSpaceInformation>} imageInput
     * @param {object} context
     * @returns {Promise<void>}
     */
    async #convertIndexedImage(imageData, imageInput, context) {
        const config = this.configuration;
        const { lookupData, hival, baseComponents, colorSpace, sourceProfile } = imageInput;

        if (!lookupData || !baseComponents) {
            if (config.verbose) {
                console.warn(`[LegacyPDFPageColorConverter] Indexed image ${imageData.ref.toString()} missing lookup data`);
            }
            return;
        }

        const numColors = (hival ?? 255) + 1;
        const expectedBytes = numColors * baseComponents;

        if (lookupData.length < expectedBytes) {
            if (config.verbose) {
                console.warn(`[LegacyPDFPageColorConverter] Indexed image ${imageData.ref.toString()} lookup table too small: ${lookupData.length} < ${expectedBytes}`);
            }
            return;
        }

        if (config.verbose) {
            console.log(`[LegacyPDFPageColorConverter] Converting Indexed image ${imageData.ref.toString()}`);
            console.log(`  Base color space: ${colorSpace}, ${numColors} colors`);
        }

        /** @type {Array<import('../../services/ColorEngineService.js').ColorValue>} */
        const inputColors = [];
        for (let i = 0; i < numColors; i++) {
            const offset = i * baseComponents;
            const values = [];
            for (let c = 0; c < baseComponents; c++) {
                if (colorSpace === 'Lab') {
                    if (c === 0) {
                        values.push((lookupData[offset + c] / 255) * 100);
                    } else {
                        values.push(lookupData[offset + c] - 128);
                    }
                } else if (colorSpace === 'RGB') {
                    values.push(lookupData[offset + c]);
                } else {
                    values.push(lookupData[offset + c] / 255);
                }
            }
            inputColors.push({
                type: /** @type {'RGB' | 'Gray' | 'Lab' | 'CMYK'} */ (colorSpace),
                values,
            });
        }

        const colorEngineService = this.colorEngineService;
        if (!colorEngineService) throw new Error('ColorEngineService not initialized');

        try {
            const conversionResults = await colorEngineService.convertColors(inputColors, {
                sourceProfile: sourceProfile ?? (colorSpace === 'RGB' ? config.sourceRGBProfile : config.sourceGrayProfile),
                destinationProfile: config.destinationProfile,
                renderingIntent: config.renderingIntent,
                blackPointCompensation: config.blackPointCompensation,
            });

            if (conversionResults && conversionResults.length > 0) {
                const cmykLookup = new Uint8Array(numColors * 4);
                for (let i = 0; i < numColors && i < conversionResults.length; i++) {
                    const result = conversionResults[i];
                    const cmykValues = result.output.values;
                    cmykLookup[i * 4] = Math.round((cmykValues[0] ?? 0) * 255);
                    cmykLookup[i * 4 + 1] = Math.round((cmykValues[1] ?? 0) * 255);
                    cmykLookup[i * 4 + 2] = Math.round((cmykValues[2] ?? 0) * 255);
                    cmykLookup[i * 4 + 3] = Math.round((cmykValues[3] ?? 0) * 255);
                }

                const { PDFArray, PDFName, PDFNumber, PDFHexString } = await import('pdf-lib');

                const pdfContext = imageData.stream.dict.context;

                let hexStr = '';
                for (let i = 0; i < cmykLookup.length; i++) {
                    hexStr += cmykLookup[i].toString(16).padStart(2, '0');
                }
                const newLookupPDF = PDFHexString.of(hexStr);

                const newColorSpaceArray = pdfContext.obj([
                    PDFName.of('Indexed'),
                    PDFName.of('DeviceCMYK'),
                    PDFNumber.of(hival ?? 255),
                    newLookupPDF,
                ]);

                imageData.stream.dict.set(PDFName.of('ColorSpace'), newColorSpaceArray);

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
                console.error(`[LegacyPDFPageColorConverter] Failed to convert Indexed image ${imageData.ref.toString()}: ${error}`);
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
     * @override
     * @param {PDFPageColorConverterInput} input
     * @param {import('../color-converter.js').WorkerResult} workerResult
     * @param {object} context
     * @returns {Promise<void>}
     */
    async applyWorkerResult(input, workerResult, context) {
        await this.#ready;

        const config = this.configuration;

        if (!workerResult.success) {
            if (config.verbose) {
                console.warn(`[LegacyPDFPageColorConverter] Worker failed for page ${input.pageIndex}: ${workerResult.error}`);
            }
            return;
        }

        /** @type {import('../color-converter.js').WorkerResult[]} */
        const imageResults = workerResult.imageResults ?? [];
        /** @type {import('../color-converter.js').WorkerResult[]} */
        const contentStreamResults = workerResult.contentStreamResults ?? [];

        if (config.verbose) {
            console.log(`[LegacyPDFPageColorConverter] Applying worker results for page ${input.pageIndex}`);
            console.log(`  Image results: ${imageResults.length}`);
            console.log(`  Content stream results: ${contentStreamResults.length}`);
        }

        if (config.convertImages && input.images && this.#imageConverter) {
            for (let i = 0; i < imageResults.length && i < input.images.length; i++) {
                const imageResult = imageResults[i];
                if (imageResult && imageResult.success) {
                    const imageInput = this.#extractImageInput(input.images[i]);
                    /** @type {Partial<{ workerResult: import('../color-converter.js').WorkerResult, imageWorkerResults: import('../color-converter.js').WorkerResult[] }>} */
                    const imageContext = { ...context };
                    await this.#imageConverter.applyWorkerResult(imageInput, imageResult, imageContext);

                    if (imageContext.workerResult) {
                        (imageContext.imageWorkerResults ??= []).push(imageContext.workerResult);
                    }
                }
            }
        }

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
                    /** @type {Partial<{ contentStreamWorkerResult: import('../color-converter.js').WorkerResult, contentStreamWorkerResults: import('../color-converter.js').WorkerResult[] }>} */
                    const streamContext = { ...context };
                    await this.#contentStreamConverter.applyWorkerResult(streamInput, streamResult, streamContext);

                    if (streamContext.contentStreamWorkerResult) {
                        (streamContext.contentStreamWorkerResults ??= []).push(streamContext.contentStreamWorkerResult);
                    }
                }
            }
        }

        /** @type {{ pageWorkerResult: import('../color-converter.js').WorkerResult }} */ (context).pageWorkerResult = {
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
     * @param {import('pdf-lib').PDFDict} pageDict
     * @param {import('pdf-lib').PDFDocument} pdfDocument
     * @returns {import('../pdf-document-color-converter.js').NormalizedLabColorSpaceDescriptor}
     */
    getNormalizedLabColorSpaceDescriptor(pageDict, pdfDocument) {
        const parentConverter = /** @type {import('../pdf-document-color-converter.js').PDFDocumentColorConverter} */ (
            this.parentConverter
        );
        if (!parentConverter || typeof parentConverter.getNormalizedLabColorSpaceDescriptor !== 'function') {
            throw new Error('LegacyPDFPageColorConverter requires a parent PDFDocumentColorConverter with getNormalizedLabColorSpaceDescriptor()');
        }

        const descriptor = parentConverter.getNormalizedLabColorSpaceDescriptor(pdfDocument);

        const pdfContext = pdfDocument.context;

        let resources = /** @type {import('pdf-lib').PDFDict | import('pdf-lib').PDFRef | undefined} */(pageDict.get(PDFName.of('Resources')));

        if (resources instanceof PDFRef) {
            resources = /** @type {import('pdf-lib').PDFDict | import('pdf-lib').PDFRef | undefined} */ (pdfContext.lookup(resources));
        }

        if (!(resources instanceof PDFDict)) {
            resources = pdfContext.obj({});
            pageDict.set(PDFName.of('Resources'), resources);
        }

        let colorSpaces = /** @type {import('pdf-lib').PDFDict | import('pdf-lib').PDFRef | undefined} */ (resources.get(PDFName.of('ColorSpace')));

        if (colorSpaces instanceof PDFRef) {
            colorSpaces = /** @type {import('pdf-lib').PDFDict | import('pdf-lib').PDFRef | undefined} */ (pdfContext.lookup(colorSpaces));
        }

        if (!(colorSpaces instanceof PDFDict)) {
            colorSpaces = pdfContext.obj({});
            resources.set(PDFName.of('ColorSpace'), colorSpaces);
        }

        const labName = PDFName.of(descriptor.name);
        const existingLab = colorSpaces.get(labName);

        if (!existingLab) {
            if (descriptor.ref) {
                colorSpaces.set(labName, descriptor.ref);
            } else {
                colorSpaces.set(labName, descriptor.resource);
            }

            if (this.configuration.verbose) {
                console.log(`[LegacyPDFPageColorConverter] Added Lab color space '${descriptor.name}' to page resources`);
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

        super.dispose();
    }
}
