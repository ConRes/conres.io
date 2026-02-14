/**
 * Decodes text from PDF name/string objects
 * @param {PDFName | PDFString | import('pdf-lib').PDFHexString} [instance]
 * @returns {string | undefined}
 */
export const decodeText = instance => instance?.decodeText?.().trim();


/**
 * @typedef {import('pdf-lib')[keyof import('pdf-lib') & `PDF${string}`]} PDFObjectClasses
 */

/**
 * @template {{lookupMaybe: Function}} T
 * @template  {(PDFObjectClasses)[]} U
 * @param {T | undefined | null} target
 * @param {PDFName} key
 * @param  {U} types
 * @returns {U[number]['prototype'] | undefined}
 */
export const lookupMaybe = (target, key, ...types) => {
    return target?.lookupMaybe(key, ...types);
};

/**
 * Compresses data using FlateDecode (zlib deflate).
 * PDF FlateDecode uses zlib format (RFC 1950) with header, not raw deflate.
 * Uses pako in both browser and Node.js for consistent output.
 * @param {Uint8Array} data - The data to compress
 * @returns {Promise<{compressed: Uint8Array, wasCompressed: boolean}>}
 */
export async function compressWithFlateDecode(data) {
    // Try pako via importmap first (browser environment)
    try {
        const pako = await import('pako');
        // pako.deflate produces zlib format by default (with header)
        const compressed = pako.deflate(data);
        return { compressed: new Uint8Array(compressed), wasCompressed: true };
    } catch {
        // Bare import failed, try local pako path (Node.js)
        try {
            const pako = await import('../../packages/pako/dist/pako.mjs');
            const compressed = pako.deflate(data);
            return { compressed: new Uint8Array(compressed), wasCompressed: true };
        } catch {
            // pako not available, fall back to Node.js zlib
            try {
                const zlib = await import('zlib');
                const compressed = zlib.deflateSync(data);
                return { compressed: new Uint8Array(compressed), wasCompressed: true };
            } catch {
                // Neither available, return uncompressed
                return { compressed: data, wasCompressed: false };
            }
        }
    }
}

/**
 * Decompresses FlateDecode data (zlib inflate).
 * Uses pako in both browser and Node.js for consistent behavior.
 * @param {Uint8Array} data - The compressed data
 * @returns {Promise<Uint8Array>}
 */
export async function decompressWithFlateDecode(data) {
    // Try pako via importmap first (browser environment)
    try {
        const pako = await import('pako');
        return new Uint8Array(pako.inflate(data));
    } catch {
        // Bare import failed, try local pako path (Node.js)
        try {
            const pako = await import('../../packages/pako/dist/pako.mjs');
            return new Uint8Array(pako.inflate(data));
        } catch {
            // pako not available, fall back to Node.js zlib
            try {
                const zlib = await import('zlib');
                return new Uint8Array(zlib.inflateSync(data));
            } catch {
                throw new Error('No decompression library available (pako or zlib)');
            }
        }
    }
}
