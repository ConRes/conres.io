// @ts-check
/// <reference lib="ESNext" />
/// <reference types="emscripten" />

import {
    PDFDict,
    PDFDocument,
    PDFRawStream,
    asPDFName,
    PDFContext,
    PDFObject,
    PDFArray,
    PDFName,
    PDFString,
    decodePDFRawStream,
    PDFRef,
} from "./packages/pdf-lib/pdf-lib.esm.js";

export class Buffer extends Uint8Array {
    #view = new DataView(this.buffer, this.byteOffset, this.byteLength);

    /**
     * @param {number} offset
     */
    readInt32BE(offset) {
        return this.#view.getInt32(offset, false);
    }

    /**
     * @param {number} offset}
     */
    readInt16BE(offset) {
        return this.#view.getInt16(offset, false);
    }

    /**
     * @param {number} offset}
     */
    readInt8(offset) {
        return this.#view.getInt8(offset);
    }

    /**
     * @param {number} offset}
     */
    readUInt32BE(offset) {
        return this.#view.getUint32(offset, false);
    }

    /**
     * @param {number} offset}
     */
    readUInt16BE(offset) {
        return this.#view.getUint16(offset, false);
    }

    /**
     * @param {number} offset}
     */
    readUInt8(offset) {
        return this.#view.getUint8(offset);
    }

    toString() {
        return new TextDecoder().decode(this);
    }

    // /**
    //  * @param  {...Parameters<typeof Uint8Array.from>} args 
    //  * @returns {Buffer}
    //  */
    // static from(...args) {
    //     return super.from(...args);
    // }
}

/**
 * @param {PDFDocument} pdfDocument
 * @param {string} attachmentName
 */
export const lookupPDFDocumentAttachementByName = (pdfDocument, attachmentName) => {
    const attachedFileRefs = pdfDocument.catalog.lookupMaybe(PDFName.of('AF'), PDFArray);

    // console.log({ attachedFileRefs });

    if (!attachedFileRefs) return;

    for (const attachedFileRef of attachedFileRefs?.asArray()) {
        const attachedFileDict = pdfDocument.context.lookupMaybe(attachedFileRef, PDFDict);

        if (!attachedFileDict) continue;

        const attachedFileName = attachedFileDict?.lookupMaybe?.(PDFName.of('F'), PDFString)?.asString?.();

        if (attachedFileName !== attachmentName) continue;

        const attachedFileStream = /** @type {PDFRawStream | undefined} */ (
            attachedFileDict?.lookupMaybe?.(PDFName.of('EF'), PDFDict)?.lookup(PDFName.of('F'))
        );

        if (!attachedFileStream) continue;

        const attachedFileContents = /** @type {Uint8Array<ArrayBuffer>} */  (decodePDFRawStream(attachedFileStream).decode());

        return {
            ref: attachedFileRef,
            dict: attachedFileDict,
            name: attachedFileName,
            stream: attachedFileStream,
            contents: attachedFileContents,
        };
    }

};


/**
 * @param {PDFDocument} pdfDocument
 */
export const createPDFDocumentHelpers = pdfDocument => {
    const enumeratedIndirectObjects = pdfDocument.context.enumerateIndirectObjects();
    const catalogEntries = [...pdfDocument.catalog.entries()];

    const findObjectByRef = ref => enumeratedIndirectObjects.find(
        ([{ tag }]) => tag === ref.tag
    )?.[1];

    /**
     * @template {PDFObject | PDFArray | PDFString | PDFDict | PDFRawStream} T
     * @param {T} value 
     */
    const processPDFValue = value => {
        if (value instanceof PDFRef) {
            // const reference = value.context.indirectObjects.get(value);
            const reference = findObjectByRef(value);

            if (reference) return {
                value,
                reference: processPDFValue(reference),
            };
        } else if (value instanceof PDFString) {
            return {
                value,
                string: value.asString(),
                text: value.decodeText(),
            };
        } else if (value instanceof PDFDict) {
            const dict = value.asMap();
            return {
                value,
                dict: Object.fromEntries(
                    [...dict.entries()].map(([key, value]) => [
                        key.asString(),
                        processPDFValue(value),
                    ])
                ),
            };
        } else if (value instanceof PDFArray) {
            const array = value.asArray();
            return {
                value,
                array: array.map(item => processPDFValue(item)),
            };
        } else if (value instanceof PDFRawStream) {
            // const pdfStream = /** @type {PDFRawStream} */ (value);
            // const uint8Array = value.asUint8Array();
            // const stream = value
            const stream = decodePDFRawStream(value);
            const decodedStream = stream.decode();
            return {
                value,
                stream: decodePDFRawStream(value).decode(),
                decodedStream,
                get string() {
                    return new TextDecoder().decode(decodedStream);
                },
                get json() {
                    try {
                        return JSON.parse(this.string);
                    } catch (error) {
                        return undefined;
                    }
                },
            };
        } else {
            return {
                value,
            };
        }
    };

    return {
        enumeratedIndirectObjects,
        catalogEntries,
        findObjectByRef,
        processPDFValue,
    };
};

/**
 * @param {PDFDocument} pdfDocument 
 */
export const dumpPDFDocument = pdfDocument => {
    /** @type {object} */
    const collections = {};
    /** @type {object} */
    const buffers = {};

    const context = pdfDocument.context;
    const enumeratedIndirectObjects = context.enumerateIndirectObjects();

    collections.names ??= {};
    collections.resources ??= {};
    collections.streams ??= {};
    collections.objects ??= {};

    const cachedPDFNames = {};

    const findPDFName = (encodedName, dict) =>
    (cachedPDFNames[encodedName] ??= dict
        ?.keys()
        .find((pdfName) => pdfName.asString() === encodedName));

    const cachedObjects = {};

    /**
     * @param {PDFRef} ref
     * @returns {PDFObject | undefined}
     */
    const findObjectByRef = (ref) =>
        typeof ref?.tag === "string"
            ? (cachedObjects[ref.tag] ??= enumeratedIndirectObjects.find(
                ([{ tag }]) => tag === ref.tag
            ))?.[1]
            : undefined;

    // collections["<PDFName>"] = new Set();
    // collections['Object']
    for (const [ref, object] of enumeratedIndirectObjects) {
        const className = object.constructor?.name ?? "Object";

        /** @type {PDFDict} */
        const dict = object.dict;
        const pdfNames = dict?.keys();
        const pdfNamesMap = {};

        pdfNames?.forEach?.((pdfName) => {
              /** @type {Set} */ (
                collections.names[`<${className}>`] ??= new Set()
            ).add(pdfName);

            pdfNamesMap[pdfName.asString()] = pdfName;
        });

        // const type = object.dict?.get('/Type')?.asString();

        let collection;
        //  = ;

        if (object instanceof PDFRawStream) {
            const typePDFName = findPDFName("/Type", object.dict);
            const subtypePDFName = findPDFName("/Subtype", object.dict);

            const type = object.dict.get(typePDFName)?.asString?.();
            const subtype = object.dict.get(subtypePDFName)?.asString?.();

            const typeId = [type, subtype].filter(Boolean).join("") || "/Raw";

            if (subtype === "/Image") {
                const colorSpacePDFName = findPDFName("/ColorSpace", object.dict);
                const bitsPerComponentPDFName = findPDFName(
                    "/BitsPerComponent",
                    object.dict
                );
                const filterPDFName = findPDFName("/Filter", object.dict);
                const widthPDFName = findPDFName("/Width", object.dict);
                const heightPDFName = findPDFName("/Height", object.dict);

                const header = {};
                const objects = {};

                if (widthPDFName)
                    header.width = object.dict.get(widthPDFName)?.numberValue;
                if (heightPDFName)
                    header.height = object.dict.get(heightPDFName)?.numberValue;
                if (bitsPerComponentPDFName)
                    header.bitsPerComponent = object.dict.get(
                        bitsPerComponentPDFName
                    )?.numberValue;
                if (filterPDFName)
                    header.filter = object.dict.get(filterPDFName)?.encodedName;

                if (colorSpacePDFName) {
                    const colorSpaceRef = object.dict.get(colorSpacePDFName);
                    const colorSpaceObject = findObjectByRef(colorSpaceRef);

                    if (colorSpaceObject) {
                        if (colorSpaceObject instanceof PDFArray) {
                            const colorSpaceType = colorSpaceObject.array[0].asString();
                            const colorSpaceObjectRef = colorSpaceObject.array[1];
                            objects[`${colorSpacePDFName.encodedName}${colorSpaceType}`] =
                                findObjectByRef(colorSpaceObjectRef);
                        }

                        objects[colorSpacePDFName.encodedName] = colorSpaceObject;
                    }
                }

                (collections.resources[`<${typeId}>`] ??= {})[ref.tag] ??=
                    Object.assign(object, {
                        header,
                        objects,
                    });
            }

            collection = collections.streams[`<${typeId}>`] ??= {};
        } else if (object instanceof PDFArray && Array.isArray(object.array)) {
            if (object.array[0] instanceof PDFName) {
                const pdfName = object.array[0].asString();

                if (pdfName === "/ICCBased") {
                    const iccProfileStreamRef = object.array[1];
                    const [, iccProfileStream] = enumeratedIndirectObjects.find(
                        ([ref, object]) => ref.tag === iccProfileStreamRef.tag
                    );
                    ((collections.resources[`<${pdfName}>`] ??= {})[
                        iccProfileStreamRef.tag
                    ] ??= Object.assign(iccProfileStream, {
                        references: new Map(),
                    })).references.set(iccProfileStreamRef, object);
                }
            }

        } else if (object instanceof PDFDict && object.constructor === PDFDict) {
            /** @type {Map} */
            const dict = /** @type {*} */ (object).dict;

            // console.log({ object, dict });

            const typePDFName = findPDFName("/Type", dict);
            const subtypePDFName = findPDFName("/Subtype", dict);

            const type = dict.get(typePDFName)?.asString?.();
            const subtype = dict.get(subtypePDFName)?.asString?.();

            const typeId = [type, subtype].filter(Boolean).join("") || "/Raw";

            if (typeId !== '/Raw') {
                collection = collections.resources[`<${typeId}>`] ??= {};
            }
        }

        if (collection === undefined)
            collection = collections.objects[`<${className}>`] ??= {};

        if (collection != null) collection[ref.tag] = object;
    }

    const unknownStreams = collections.streams["</Raw>"];
    delete collections.streams["</Raw>"];
    collections.streams["</Raw>"] = unknownStreams;

    return {
        ...collections,
        buffers,
    };

};


export const PromiseWithResolvers =
    /** @type {typeof Promise.withResolvers} */
    (typeof Promise.withResolvers === 'function' ? (() => Promise.withResolvers()) : (() => {
        const promiseWithResolvers = {};
        promiseWithResolvers.promise = new Promise((resolve, reject) => {
            promiseWithResolvers.resolve = resolve;
            promiseWithResolvers.reject = reject;
        });
        return promiseWithResolvers;
    }));

/**
 * @param {ArrayBuffer} arrayBuffer 
 * @param {string} filename 
 * @param {`${string}/${string}` | undefined} [type] 
 */
export const downloadArrayBufferAs = async (arrayBuffer, filename, type, timeout = 1000) => {
    // const {promise, resolve, reject} = Promise.withResolvers();
    const { promise, resolve, reject } = PromiseWithResolvers();

    // Firefox blob URL downloads silently fail for total Blob sizes >= 2 GB.
    // The Blob constructor accepts sub-2 GB parts, but the download via
    // URL.createObjectURL + anchor click is the bottleneck.
    // Workaround: deflate the buffer in Firefox when it exceeds 2 GB,
    // and download as .gz — the user decompresses manually.
    const MAX_BLOB_DOWNLOAD = 2 * 1024 * 1024 * 1024 - 1; // 2 GB - 1
    const isFirefox = typeof navigator !== 'undefined' && /Firefox\//.test(navigator.userAgent);
    const isSafari = typeof navigator !== 'undefined' && /Safari\//.test(navigator.userAgent) && !/Chrome\//.test(navigator.userAgent);
    let downloadBytes = new Uint8Array(arrayBuffer);
    let downloadFilename = filename;
    let downloadType = type;

    if (isFirefox && downloadBytes.length > MAX_BLOB_DOWNLOAD) {
        try {
            const pako = await import('./packages/pako/dist/pako.mjs');
            console.warn(
                `[downloadArrayBufferAs] Buffer is ${(downloadBytes.length / (1024 * 1024 * 1024)).toFixed(2)} GB — ` +
                `exceeds Firefox 2 GB blob URL download limit. Compressing with gzip…`
            );
            const compressed = pako.gzip(downloadBytes);
            if (compressed.length <= MAX_BLOB_DOWNLOAD) {
                downloadBytes = compressed;
                downloadFilename = filename + '.gz';
                downloadType = 'application/gzip';
                console.warn(
                    `[downloadArrayBufferAs] Compressed to ${(downloadBytes.length / (1024 * 1024)).toFixed(1)} MB. ` +
                    `Downloading as "${downloadFilename}" — decompress with: gzip -d "${downloadFilename}"`
                );
            } else {
                console.warn(
                    `[downloadArrayBufferAs] Compressed size (${(compressed.length / (1024 * 1024 * 1024)).toFixed(2)} GB) ` +
                    `still exceeds 2 GB limit. Falling back to uncompressed download (may fail silently in Firefox).`
                );
            }
        } catch (error) {
            console.warn('[downloadArrayBufferAs] pako not available for gzip compression, falling back to uncompressed.', error);
        }
    }

    // Split into sub-2 GB zero-copy subarrays for the Blob constructor.
    // Firefox limits individual ArrayBuffer/View parts to 2 GB (2^31 bytes).
    // Uint8Array.subarray() shares the backing ArrayBuffer — no data copied.
    /** @type {BlobPart[]} */
    const parts = [];
    
    if (!isSafari && downloadBytes.length > MAX_BLOB_DOWNLOAD) {
        const MAX_BLOB_PART = MAX_BLOB_DOWNLOAD;
        for (let offset = 0; offset < downloadBytes.length; offset += MAX_BLOB_PART) {
            parts.push(downloadBytes.subarray(offset, Math.min(offset + MAX_BLOB_PART, downloadBytes.length)));
        }
    } else {
        parts.push(downloadBytes);
    }
    
    const url = URL.createObjectURL(new Blob(parts, { type: downloadType }));
    const a = document.createElement('a');
    a.download = downloadFilename;
    a.href = url;
    a.onclick = async () => {
        await new Promise(resolve => requestAnimationFrame(resolve));
        if (timeout) await new Promise(resolve => setTimeout(resolve, timeout));
        URL.revokeObjectURL(url);
        a.remove();
        await new Promise(resolve => requestAnimationFrame(resolve));
        resolve(undefined);
    };
    a.onerror = async (error) => {
        console.error(error);
        URL.revokeObjectURL(url);
        a.remove();
        reject(error);
    };
    a.click();
    return promise;
    // URL.revokeObjectURL(url);
    // a.remove();
};

/**
 * @param {string | URL} url 
 */
export const readFile = async (url) =>
    new Uint8Array(await (await fetch(url)).arrayBuffer());

/**
 * @param {string} path 
 * @param {string} [extension] 
 */
export const basename = (path, extension) => {
    const basename = /[^/?#]+(?=[^/]*$)/.exec(path || "")?.[0];
    return (extension = `${extension || ""}`.toLowerCase()) &&
        basename?.toLowerCase?.().endsWith?.(extension)
        ? basename.slice(0, -extension.length)
        : basename;
};

/**
 * @param {string} path
 */
export const extname = (path) => /\.[^.]+$/.exec(path || "")?.[0] || "";

/**
 * @param {string} path
 */
export const dirname = (path) => /\/[^/]+$/[Symbol.replace](path || "", "");


/** @typedef {typeof FS} Emscripten.FS */

/**
 * @param {Emscripten.FS} FS
 * @param {string} path
 */
export const mkdirRecursiveWithFS = (FS, path) => {
    // console.log(mappedPath, [...mappedPath.matchAll(/(?<!\/)(?<=[^\\]|(?:\\\\)+)\//g)].map(match => mappedPath.slice(0, match.index)));
    let directoryName;
    for (const slash of [
        ...path.matchAll(/(?<!\/)(?<=[^\\]|(?:\\\\)+)\//g),
        { index: path.length },
    ]) {
        directoryName = path.slice(0, slash.index);
        FS.analyzePath(directoryName).exists || FS.mkdir(directoryName);
    }
};

/**
 * @typedef {{ pathname: string, sourceURL?: string | URL, data?: Uint8Array, }} InputResource
 */

/**
 * @param {Emscripten.FS} FS
 * @param {Record<string, InputResource>} resources
 */
export const prepareInputResources = async (FS, resources) => {
    const entries = Object.entries(resources);
    console.group(`Preparing %d input resources`, entries.length);
    try {
        for (const [id, resource] of entries) {
            console.group(`%s -> %o`, id, resource);
            try {
                const parentPath = dirname(resource.pathname);
                mkdirRecursiveWithFS(FS, parentPath);
                console.info(`Source: ${resource.sourceURL}`);

                if (!resource.data) {
                    if (!resource.sourceURL)
                        throw new TypeError(`Missing sourceURL for ${id}`);

                    resource.data = await readFile(resource.sourceURL);
                }

                FS.createDataFile(
                    parentPath,
                    // @ts-ignore
                    basename(resource.pathname),
                    resource.data,
                    true,
                    false,
                    false
                );
            } catch (error) {
                console.error(error);
                throw error;
            } finally {
                console.groupEnd();
            }
        }
    } finally {
        console.groupEnd();
    }
};

/**
 * @typedef {{ pathname: string, sourceURL: string | URL, data: Uint8Array, }} OutputResource
 */

/**
 * @param {Emscripten.FS} FS
 * @param {Record<string, OutputResource>} resources
 */
export const prepareOutputResources = async (FS, resources) => {
    const entries = Object.entries(resources);
    console.group(`Preparing %d output resources`, entries.length);
    const files = [];
    try {
        for (const [id, resource] of entries) {
            let data;
            // const filename = resource?.pathname ?? id;
            console.group(`%s <- %o`, id, resource);
            try {
                data =
                    typeof resource === "function"
                        ? await resource(FS)
                        : resource?.data
                            ? resource.data
                            : resource?.pathname
                                ? (({ pathname, ...options }) =>
                                    FS.readFile(
                                        resource.pathname,
                                        // @ts-ignore
                                        options,
                                    ))(resource)
                                : undefined;
                if (typeof data === "string") data = new TextEncoder().encode(data);
                if (data instanceof Uint8Array) {
                    console.info(`Output: %O`, data);
                    files.push({ filename: resource?.pathname ?? id, data });
                } else {
                    throw new TypeError(`Invalid output data for ${id}`);
                }
            } catch (error) {
                error["[data]"] = data;
                console.error(error);
                // throw error;
            } finally {
                console.groupEnd();
            }
        }
    } finally {
        console.groupEnd();
    }
    return files;
};

export * from './helpers/tc39-proposal-arraybuffer-base64-polyfill-core.js';