/**
 * Decodes text from PDF name/string objects
 * @param {PDFName | PDFString | import('pdf-lib').PDFHexString} [instance]
 * @returns {string | undefined}
 */
export const decodeText = instance => instance?.decodeText?.().trim();

/**
 * REGRESSION: TextDecoder('latin1') is Windows-1252, NOT ISO 8859-1.
 *
 * The WHATWG Encoding Standard maps ALL of these labels to Windows-1252:
 * "latin1", "iso-8859-1", "iso8859-1", "ascii", "us-ascii", etc.
 * There is no TextDecoder label that gives true ISO 8859-1.
 *
 * Windows-1252 remaps 27 of 32 bytes in 0x80–0x9F to Unicode codepoints
 * above U+00FF (e.g., 0x92 → U+2019 RIGHT SINGLE QUOTATION MARK).
 * The charCodeAt() round-trip then truncates them when stored in a
 * Uint8Array (e.g., U+2019 → 0x19), silently corrupting content streams.
 *
 * Symptom: "St. Paul\x92s Cathedral" → "St. Paul\x19s Cathedral"
 * (Acrobat reports missing glyphs for the corrupted bytes)
 *
 * @see https://encoding.spec.whatwg.org/#names-and-labels
 */
// const latin1Decoder = new TextDecoder('latin1');

/**
 * Converts a byte array to a string using the ISO 8859-1 identity mapping
 * (byte N → Unicode codepoint U+00NN).
 *
 * Replaces pdf-lib's `arrayAsString` which uses O(n^2) string concatenation
 * (`str += charFromCode(byte)`) and causes OOM in Chrome on large buffers.
 *
 * Uses chunked `String.fromCharCode.apply()` — the only cross-platform
 * method that provides a true identity mapping. Each chunk is a single
 * native engine call, and `subarray()` is zero-copy. The chunk size of
 * 8192 stays well within the engine argument-count limit (~65536).
 *
 * NOTE: `TextEncoder` (always UTF-8) is NOT the inverse — it would
 * produce multi-byte sequences for codepoints > 127. The write path
 * uses `charCodeAt()` directly (see `compressSegmentsWithFlateDecode`).
 *
 * @param {Uint8Array} bytes - Raw PDF stream bytes
 * @returns {string} String with each byte mapped to its Unicode codepoint
 */
export function bytesAsString(bytes) {
    // Was: return latin1Decoder.decode(bytes);
    // Reverted because TextDecoder('latin1') uses Windows-1252 per WHATWG,
    // which corrupts bytes 0x80–0x9F on the charCodeAt() round-trip.
    const chunks = [];
    for (let i = 0; i < bytes.length; i += 8192) {
        chunks.push(String.fromCharCode.apply(
            null, bytes.subarray(i, Math.min(i + 8192, bytes.length))
        ));
    }
    return chunks.join('');
}


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
 * Compresses string segments to FlateDecode format using streaming deflation.
 *
 * Each segment is encoded to Latin-1 bytes in chunks and fed incrementally
 * into the deflater. This avoids materializing the entire uncompressed content
 * as a single string or Uint8Array, which is critical for content streams
 * exceeding ~100 MB where Firefox would otherwise OOM.
 *
 * @param {Iterable<string>} segments - String segments to encode and compress
 * @returns {Promise<{compressed: Uint8Array, wasCompressed: boolean}>}
 */
export async function compressSegmentsWithFlateDecode(segments) {
    const ENCODE_CHUNK = 5 * 1024 * 1024;

    /** @type {any} */
    let pako = null;
    try { pako = await import('pako'); } catch {}
    if (!pako) try { pako = await import('../../packages/pako/dist/pako.mjs'); } catch {}

    if (pako) {
        const deflater = new pako.Deflate();

        for (const segment of segments) {
            let offset = 0;
            while (offset < segment.length) {
                const end = Math.min(offset + ENCODE_CHUNK, segment.length);
                const bytes = new Uint8Array(end - offset);
                for (let i = 0; i < bytes.length; i++) {
                    bytes[i] = segment.charCodeAt(offset + i);
                }
                deflater.push(bytes, false);
                offset = end;
            }
        }

        deflater.push(new Uint8Array(0), true);

        if (deflater.err) {
            throw new Error(`pako deflate error: ${deflater.msg}`);
        }

        return { compressed: new Uint8Array(deflater.result), wasCompressed: true };
    }

    // Node.js zlib fallback — Buffer.concat is fine here since V8
    // handles large allocations without the Firefox GC pressure issue.
    try {
        const zlib = await import('zlib');
        const buffers = [];
        for (const segment of segments) {
            buffers.push(Buffer.from(segment, 'latin1'));
        }
        const compressed = zlib.deflateSync(Buffer.concat(buffers));
        return { compressed: new Uint8Array(compressed), wasCompressed: true };
    } catch {
        throw new Error('No compression library available (pako or zlib)');
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
