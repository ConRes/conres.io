// @ts-check
/**
 * Worker-Based Color Conversion Service
 *
 * Implements the efficient worker strategy:
 * 1. Main thread extracts compressed stream data from PDF
 * 2. Compressed bytes are passed directly to workers (no main thread decompression)
 * 3. Workers: inflate → transform → deflate
 * 4. Workers return compressed bytes
 * 5. Main thread writes compressed bytes back to PDF
 *
 * This avoids redundant compression/decompression on the main thread.
 *
 * @module WorkerColorConversion
 */

import { PDFRawStream, PDFName, PDFArray, PDFDict, PDFRef, PDFNumber } from '../packages/pdf-lib/pdf-lib.esm.js';
import { inflateToBuffer } from '../helpers/compression.js';
import {
    TYPE_RGB_8,
    TYPE_RGB_16,
    TYPE_CMYK_8,
    TYPE_GRAY_8,
    TYPE_GRAY_16,
    TYPE_Lab_8,
    TYPE_Lab_16,
    INTENT_PERCEPTUAL,
    INTENT_RELATIVE_COLORIMETRIC,
    INTENT_SATURATION,
    INTENT_ABSOLUTE_COLORIMETRIC,
    INTENT_PRESERVE_K_ONLY_RELATIVE_COLORIMETRIC_GCR,
    cmsFLAGS_BLACKPOINTCOMPENSATION,
} from '../packages/color-engine/src/index.js';

/**
 * Decompress ICC profile data if FlateDecode compressed
 * @param {PDFRawStream} stream
 * @returns {Uint8Array}
 */
async function decompressICCProfile(stream) {
    const contents = stream.contents;
    const filter = stream.dict.get(PDFName.of('Filter'));

    // Check if FlateDecode compressed
    let isFlate = false;
    if (filter instanceof PDFName) {
        isFlate = filter.asString() === '/FlateDecode';
    } else if (filter instanceof PDFArray) {
        const firstFilter = filter.get(0);
        if (firstFilter instanceof PDFName) {
            isFlate = firstFilter.asString() === '/FlateDecode';
        }
    }

    if (isFlate) {
        try {
            return await inflateToBuffer(contents);
        } catch (e) {
            console.warn('Failed to decompress ICC profile:', e.message);
            return contents;
        }
    }

    return contents;
}

/**
 * @typedef {{
 *   destinationProfile: ArrayBuffer,
 *   renderingIntent?: string,
 *   convertImages?: boolean,
 *   convertContentStreams?: boolean,
 *   workerPool: import('./WorkerPool.js').WorkerPool,
 *   verbose?: boolean,
 * }} ConvertOptions
 */

/**
 * @typedef {{
 *   type: 'image' | 'content-stream',
 *   streamRef: import('pdf-lib').PDFRef,
 *   compressedData: ArrayBuffer,
 *   isCompressed: boolean,
 *   colorSpace?: string,
 *   width?: number,
 *   height?: number,
 *   bitsPerComponent?: number,
 *   sourceProfile?: ArrayBuffer | 'sRGB' | 'sGray' | 'Lab',
 *   destinationProfile: ArrayBuffer,
 *   renderingIntent: number,
 * }} StreamTask
 */

// Rendering intent constants (imported from color engine)
const INTENT_MAP = {
    'perceptual': INTENT_PERCEPTUAL,
    'relative-colorimetric': INTENT_RELATIVE_COLORIMETRIC,
    'saturation': INTENT_SATURATION,
    'absolute-colorimetric': INTENT_ABSOLUTE_COLORIMETRIC,
    'preserve-k-only-perceptual-gcr': 18, // TODO: Export from color-engine
    'preserve-k-only-relative-colorimetric-gcr': INTENT_PRESERVE_K_ONLY_RELATIVE_COLORIMETRIC_GCR,
    'preserve-k-only-saturation-gcr': 22, // TODO: Export from color-engine
};

/**
 * Check if a stream is compressed with FlateDecode
 * @param {PDFRawStream} stream
 * @returns {boolean}
 */
function isFlateEncoded(stream) {
    const dict = stream.dict;
    const filter = dict.get(PDFName.of('Filter'));

    if (filter instanceof PDFName) {
        return filter.asString() === '/FlateDecode';
    }

    if (filter instanceof PDFArray) {
        // Check if first filter is FlateDecode
        const firstFilter = filter.get(0);
        if (firstFilter instanceof PDFName) {
            return firstFilter.asString() === '/FlateDecode';
        }
    }

    return false;
}

/**
 * @typedef {{
 *   type: string,
 *   components: number,
 *   inputFormat: number,
 *   sourceProfile?: Uint8Array | 'sRGB' | 'sGray' | 'Lab',
 * }} ColorSpaceInfo
 */

/**
 * Get the color space info from an XObject image
 * Handles Device, ICCBased, and Lab color spaces
 * @param {PDFDict} dict
 * @param {import('pdf-lib').PDFContext} context
 * @returns {ColorSpaceInfo | null}
 */
async function getImageColorSpaceInfo(dict, context) {
    const colorSpace = dict.get(PDFName.of('ColorSpace'));
    const bpc = dict.get(PDFName.of('BitsPerComponent'))?.asNumber?.() || 8;

    if (!colorSpace) return null;

    // Handle direct reference
    let cs = colorSpace;
    if (cs instanceof PDFRef) {
        cs = context.lookup(cs);
    }

    // Simple device color spaces
    if (cs instanceof PDFName) {
        const name = cs.asString();
        if (name === '/DeviceRGB') {
            return {
                type: 'DeviceRGB',
                components: 3,
                inputFormat: TYPE_RGB_8,
                sourceProfile: 'sRGB',
            };
        }
        if (name === '/DeviceCMYK') {
            return { type: 'DeviceCMYK', components: 4, inputFormat: TYPE_CMYK_8 };
        }
        if (name === '/DeviceGray') {
            return {
                type: 'DeviceGray',
                components: 1,
                inputFormat: TYPE_GRAY_8,
                sourceProfile: 'sGray',
            };
        }
    }

    // Array-based color spaces (ICCBased, Lab, etc.)
    if (cs instanceof PDFArray) {
        const items = cs.asArray();
        const first = items[0];

        if (first instanceof PDFName) {
            const name = first.asString();

            // ICCBased color space
            if (name === '/ICCBased') {
                let profileRef = items[1];
                if (profileRef instanceof PDFRef) {
                    const profileStream = context.lookup(profileRef);
                    if (profileStream instanceof PDFRawStream) {
                        const n = profileStream.dict.get(PDFName.of('N'))?.asNumber?.() || 0;

                        // Extract and decompress ICC profile data (profiles may be FlateDecode compressed)
                        const profileData = await decompressICCProfile(profileStream);

                        // Determine input format and type based on components and BPC
                        if (n === 1) {
                            // Grayscale with embedded ICC profile
                            // TODO: Need proper grayscale profile support in color engine
                            // For now, skip grayscale ICC-based images
                            return null;
                        } else if (n === 3) {
                            return {
                                type: 'ICCBasedRGB',
                                components: 3,
                                inputFormat: bpc === 16 ? TYPE_RGB_16 : TYPE_RGB_8,
                                sourceProfile: profileData,
                                bytesPerComponent: bpc === 16 ? 2 : 1,
                            };
                        } else if (n === 4) {
                            // CMYK - skip conversion
                            return { type: 'ICCBasedCMYK', components: 4, inputFormat: TYPE_CMYK_8 };
                        }
                    }
                }
            }

            // Lab color space
            if (name === '/Lab') {
                return {
                    type: 'Lab',
                    components: 3,
                    inputFormat: bpc === 16 ? TYPE_Lab_16 : TYPE_Lab_8,
                    sourceProfile: 'Lab',
                };
            }
        }
    }

    return null;
}

/**
 * Collect all image XObjects from the document
 * @param {import('pdf-lib').PDFDocument} pdfDocument
 * @returns {Array<{ref: import('pdf-lib').PDFRef, stream: PDFRawStream, colorSpaceInfo: ColorSpaceInfo}>}
 */
async function collectImageXObjects(pdfDocument) {
    const context = pdfDocument.context;
    const images = [];

    await Promise.all(context.enumerateIndirectObjects().map(async ([ref, obj]) => {
        if (obj instanceof PDFRawStream) {
            const dict = obj.dict;
            const subtype = dict.get(PDFName.of('Subtype'));

            if (subtype instanceof PDFName && subtype.asString() === '/Image') {
                const colorSpaceInfo = await getImageColorSpaceInfo(dict, context);

                // Only process images with supported color spaces (not already CMYK)
                if (colorSpaceInfo && !colorSpaceInfo.type.includes('CMYK')) {
                    images.push({ ref, stream: obj, colorSpaceInfo });
                }
            }
        }
    }));

    return images;
}

/**
 * Extract color space definitions from a page's Resources dictionary.
 * Returns a serializable object with colorSpaceType and range info for Lab.
 * @param {PDFDict} pageDict
 * @param {import('pdf-lib').PDFContext} context
 * @returns {Record<string, {colorSpaceType: string, range?: number[]}>}
 */
function extractPageColorSpaceDefinitions(pageDict, context) {
    /** @type {Record<string, {colorSpaceType: string, range?: number[]}>} */
    const definitions = {};

    // Get Resources dictionary
    const resources = pageDict.get(PDFName.of('Resources'));
    if (!resources) return definitions;

    const resourcesDict = resources instanceof PDFRef
        ? context.lookup(resources)
        : resources;
    if (!(resourcesDict instanceof PDFDict)) return definitions;

    // Get ColorSpace dictionary from Resources
    const colorSpaceDict = resourcesDict.get(PDFName.of('ColorSpace'));
    if (!colorSpaceDict) return definitions;

    const csDict = colorSpaceDict instanceof PDFRef
        ? context.lookup(colorSpaceDict)
        : colorSpaceDict;
    if (!(csDict instanceof PDFDict)) return definitions;

    // Iterate over color space entries
    const entries = csDict.entries();
    for (const [key, value] of entries) {
        const csName = key.asString().replace(/^\//, ''); // Remove leading /

        // Resolve the color space descriptor
        let csDescriptor = value;
        if (csDescriptor instanceof PDFRef) {
            csDescriptor = context.lookup(csDescriptor);
        }

        if (csDescriptor instanceof PDFName) {
            // Simple color space name (e.g., DeviceRGB)
            definitions[csName] = {
                colorSpaceType: csDescriptor.asString().replace(/^\//, ''),
            };
        } else if (csDescriptor instanceof PDFArray && csDescriptor.size() > 0) {
            // Array-based color space (e.g., [/Lab {...}], [/ICCBased stream], [/Separation ...])
            const csType = csDescriptor.get(0);
            if (csType instanceof PDFName) {
                const typeName = csType.asString().replace(/^\//, '');
                const def = { colorSpaceType: typeName };

                // Extract Lab parameters (Range is important for color conversion)
                if (typeName === 'Lab' && csDescriptor.size() > 1) {
                    const labDict = csDescriptor.get(1);
                    const labDictResolved = labDict instanceof PDFRef
                        ? context.lookup(labDict)
                        : labDict;

                    if (labDictResolved instanceof PDFDict) {
                        const rangeArray = labDictResolved.get(PDFName.of('Range'));
                        if (rangeArray instanceof PDFArray) {
                            def.range = rangeArray.asArray().map(n => n.asNumber?.() ?? 0);
                        } else {
                            // Default Lab range per PDF spec
                            def.range = [-100, 100, -100, 100];
                        }
                    }
                }

                /**
                 * TODO [separation/spot support]: Extract Separation color space details.
                 * For Separation color spaces, extract:
                 * - Colorant name (e.g., /Black, /PANTONE 123 C)
                 * - Alternate color space (usually DeviceCMYK)
                 * - Tint transform function
                 * This information will be needed for proper color conversion.
                 *
                 * Current behavior: Records colorSpaceType only, actual handling
                 * deferred to ColorConversionUtils which logs warning and passes through.
                 */

                definitions[csName] = def;
            }
        }
    }

    return definitions;
}

/**
 * Collect all content streams from the document with their page's color space definitions
 * @param {import('pdf-lib').PDFDocument} pdfDocument
 * @returns {Array<{ref: import('pdf-lib').PDFRef, stream: PDFRawStream, colorSpaceDefinitions: Record<string, {colorSpaceType: string, range?: number[]}>}>}
 */
function collectContentStreams(pdfDocument) {
    const context = pdfDocument.context;
    const streams = [];

    // Collect page content streams
    for (const page of pdfDocument.getPages()) {
        const pageRef = page.ref;
        const pageDict = context.lookup(pageRef);

        if (pageDict instanceof PDFDict) {
            // Extract color space definitions for this page
            const colorSpaceDefinitions = extractPageColorSpaceDefinitions(pageDict, context);

            const contents = pageDict.get(PDFName.of('Contents'));

            if (contents) {
                const contentRefs = contents instanceof PDFArray
                    ? contents.asArray()
                    : [contents];

                for (const contentRef of contentRefs) {
                    const obj = context.lookup(contentRef);
                    if (obj instanceof PDFRawStream) {
                        streams.push({
                            ref: contentRef,
                            stream: obj,
                            colorSpaceDefinitions,
                        });
                    }
                }
            }
        }
    }

    return streams;
}

/**
 * Create tasks for worker processing
 * @param {import('pdf-lib').PDFDocument} pdfDocument
 * @param {ConvertOptions} options
 * @returns {Promise<StreamTask[]>}
 */
async function createWorkerTasks(pdfDocument, options) {
    const tasks = [];
    const renderingIntent = INTENT_MAP[options.renderingIntent || 'relative-colorimetric'] || 1;

    // Collect image tasks
    if (options.convertImages) {
        const images = await collectImageXObjects(pdfDocument);

        for (const { ref, stream, colorSpaceInfo } of images) {
            const dict = stream.dict;
            const width = dict.get(PDFName.of('Width'))?.asNumber?.() || 0;
            const height = dict.get(PDFName.of('Height'))?.asNumber?.() || 0;
            const bpc = dict.get(PDFName.of('BitsPerComponent'))?.asNumber?.() || 8;

            // Get raw compressed data directly
            const compressedData = stream.contents;
            const isCompressed = isFlateEncoded(stream);

            // Skip if no source profile (shouldn't happen after filtering)
            if (!colorSpaceInfo.sourceProfile) {
                continue;
            }

            tasks.push({
                type: 'image',
                streamRef: ref,
                compressedData: compressedData.buffer.slice(
                    compressedData.byteOffset,
                    compressedData.byteOffset + compressedData.byteLength
                ),
                isCompressed,
                colorSpace: colorSpaceInfo.type,
                colorSpaceComponents: colorSpaceInfo.components,
                inputFormat: colorSpaceInfo.inputFormat,
                width,
                height,
                bitsPerComponent: bpc,
                sourceProfile: colorSpaceInfo.sourceProfile,
                destinationProfile: options.destinationProfile,
                renderingIntent,
            });
        }
    }

    // Collect content stream tasks
    if (options.convertContentStreams) {
        const contentStreams = collectContentStreams(pdfDocument);

        for (const { ref, stream, colorSpaceDefinitions } of contentStreams) {
            const compressedData = stream.contents;
            const isCompressed = isFlateEncoded(stream);

            tasks.push({
                type: 'content-stream',
                streamRef: ref,
                compressedData: compressedData.buffer.slice(
                    compressedData.byteOffset,
                    compressedData.byteOffset + compressedData.byteLength
                ),
                isCompressed,
                colorSpaceDefinitions, // Page color space definitions for Lab range info
                destinationProfile: options.destinationProfile,
                renderingIntent,
                flags: cmsFLAGS_BLACKPOINTCOMPENSATION, // BPC flag for color conversion
            });
        }
    }

    return tasks;
}

/**
 * Apply worker results back to the PDF
 * @param {import('pdf-lib').PDFDocument} pdfDocument
 * @param {StreamTask[]} tasks
 * @param {Array<{success: boolean, compressedResult?: ArrayBuffer, error?: string}>} results
 */
function applyWorkerResults(pdfDocument, tasks, results) {
    const context = pdfDocument.context;

    for (let i = 0; i < tasks.length; i++) {
        const task = tasks[i];
        const result = results[i];

        if (!result.success) {
            console.warn(`Task ${i} failed:`, result.error);
            continue;
        }

        if (!result.compressedResult) {
            continue;
        }

        // Get the original stream
        const stream = context.lookup(task.streamRef);
        if (!(stream instanceof PDFRawStream)) {
            continue;
        }

        // Create new stream with converted data
        const newContents = new Uint8Array(result.compressedResult);
        const newDict = stream.dict.clone(context);

        // Update filter (ensure FlateDecode is set since workers deflate output)
        newDict.set(PDFName.of('Filter'), PDFName.of('FlateDecode'));

        // Update length
        newDict.delete(PDFName.of('Length'));

        // For images, update color space and bits per component for CMYK output
        if (task.type === 'image') {
            newDict.set(PDFName.of('ColorSpace'), PDFName.of('DeviceCMYK'));

            // Always output 8-bit CMYK (even if input was 16-bit Lab/RGB)
            // This is necessary because our color engine outputs 8-bit values
            newDict.set(PDFName.of('BitsPerComponent'), PDFNumber.of(8));
        }

        // Create and register the new stream
        const newStream = PDFRawStream.of(newDict, newContents);
        context.assign(task.streamRef, newStream);
    }
}

/**
 * Convert colors in PDF using worker pool
 * Workers receive compressed streams and return compressed results.
 *
 * @param {import('pdf-lib').PDFDocument} pdfDocument
 * @param {ConvertOptions} options
 * @returns {Promise<{tasksProcessed: number, errors: string[]}>}
 */
export async function convertWithWorkers(pdfDocument, options) {
    const { workerPool, verbose } = options;

    if (verbose) {
        console.log('Collecting streams for worker processing...');
    }

    // Create tasks with compressed data
    const tasks = await createWorkerTasks(pdfDocument, options);

    if (verbose) {
        console.log(`Created ${tasks.length} tasks for workers`);
        console.log(`  Images: ${tasks.filter(t => t.type === 'image').length}`);
        console.log(`  Content streams: ${tasks.filter(t => t.type === 'content-stream').length}`);
    }

    if (tasks.length === 0) {
        return { tasksProcessed: 0, errors: [] };
    }

    // Submit all tasks to worker pool
    // Workers receive compressed data, inflate, transform, deflate, return compressed
    // Note: We use Uint8Array (structured-cloned by worker_threads) instead of Array.from()
    // to avoid "Invalid array length" errors for large images
    const workerTasks = tasks.map((task, index) => {
        if (task.type === 'content-stream') {
            // Content stream task - includes colorSpaceDefinitions for Lab range info
            const workerTask = {
                taskId: index,
                type: task.type,
                compressedData: new Uint8Array(task.compressedData),
                isCompressed: task.isCompressed,
                colorSpaceDefinitions: task.colorSpaceDefinitions, // For Lab range info
                destinationProfile: new Uint8Array(task.destinationProfile),
                renderingIntent: task.renderingIntent,
                flags: task.flags || cmsFLAGS_BLACKPOINTCOMPENSATION,
            };

            if (verbose) {
                const csCount = Object.keys(task.colorSpaceDefinitions || {}).length;
                console.log(`Task ${index}: content-stream, ${csCount} color spaces defined`);
            }

            return workerTask;
        }

        // Image task - includes pixel format and source profile
        // Serialize source profile: can be string ('sRGB', 'sGray', 'Lab') or Uint8Array
        let sourceProfile = task.sourceProfile;
        if (sourceProfile instanceof Uint8Array) {
            // Keep as Uint8Array for structured cloning
            sourceProfile = sourceProfile;
        }

        const workerTask = {
            taskId: index,
            type: task.type,
            compressedData: new Uint8Array(task.compressedData),
            isCompressed: task.isCompressed,
            colorSpace: task.colorSpace,
            colorSpaceComponents: task.colorSpaceComponents,
            width: task.width,
            height: task.height,
            bitsPerComponent: task.bitsPerComponent,
            sourceProfile,
            destinationProfile: new Uint8Array(task.destinationProfile),
            renderingIntent: task.renderingIntent,
            pixelCount: task.width && task.height ? task.width * task.height : 0,
            inputFormat: task.inputFormat,
            outputFormat: TYPE_CMYK_8,
            outputComponents: 4,
            flags: cmsFLAGS_BLACKPOINTCOMPENSATION,
        };

        if (verbose) {
            console.log(`Task ${index}: ${task.colorSpace}, ${task.width}×${task.height}, BPC=${task.bitsPerComponent}, inputFormat=0x${task.inputFormat?.toString(16) ?? 'N/A'}`);
        }

        return workerTask;
    });

    // Process all tasks through worker pool
    const results = await Promise.all(
        workerTasks.map(task => workerPool.submitTransform(task))
    );

    // Apply results back to PDF
    applyWorkerResults(pdfDocument, tasks, results);

    // Count errors
    const errors = results
        .filter(r => !r.success)
        .map(r => r.error || 'Unknown error');

    if (verbose) {
        console.log(`Processed ${tasks.length} tasks, ${errors.length} errors`);
    }

    return {
        tasksProcessed: tasks.length,
        errors,
    };
}

export default { convertWithWorkers };
