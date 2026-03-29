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
 * Compresses data using FlateDecode (zlib deflate, RFC 1950).
 * @param {Uint8Array} data
 * @returns {Promise<{compressed: Uint8Array, wasCompressed: boolean}>}
 */
export async function compressWithFlateDecode(data) {
    const { deflateToBuffer } = await import('../../helpers/compression.js');
    const compressed = await deflateToBuffer(data);
    return { compressed, wasCompressed: true };
}

/**
 * Compresses string segments to FlateDecode format using streaming deflation.
 *
 * Each segment is encoded to Latin-1 bytes in chunks and fed incrementally
 * into the compressor. This avoids materializing the entire uncompressed
 * content as a single buffer, which is critical for content streams exceeding
 * ~100 MB where browsers would otherwise OOM.
 *
 * @param {Iterable<string>} segments - String segments to encode and compress
 * @returns {Promise<{compressed: Uint8Array, wasCompressed: boolean}>}
 */
export async function compressSegmentsWithFlateDecode(segments) {
    const ENCODE_CHUNK = 5 * 1024 * 1024;
    const { collectUint8ArrayChunks } = await import('../../helpers/buffers.js');
    const { readableStreamAsyncIterable } = await import('../../helpers/streams.js');

    const cs = new CompressionStream('deflate');
    const writer = cs.writable.getWriter();

    // Write and read concurrently — writing without a concurrent reader
    // deadlocks once the stream's internal buffer fills (backpressure).
    const writeAll = (async () => {
        for (const segment of segments) {
            let offset = 0;
            while (offset < segment.length) {
                const end = Math.min(offset + ENCODE_CHUNK, segment.length);
                const bytes = new Uint8Array(end - offset);
                for (let i = 0; i < bytes.length; i++) {
                    bytes[i] = segment.charCodeAt(offset + i);
                }
                await writer.write(bytes);
                offset = end;
            }
        }
        await writer.close();
    })();

    const compressed = await collectUint8ArrayChunks(readableStreamAsyncIterable(cs.readable));
    await writeAll; // Ensure writer errors propagate
    return { compressed, wasCompressed: true };
}

/**
 * Decompresses FlateDecode data (zlib inflate, RFC 1950).
 * @param {Uint8Array} data
 * @returns {Promise<Uint8Array>}
 */
export async function decompressWithFlateDecode(data) {
    const { inflateToBuffer } = await import('../../helpers/compression.js');
    return inflateToBuffer(data);
}

/**
 * Regular expression for matching PDF content stream color operators.
 * Exported for reuse by verification tools.
 * @type {RegExp}
 */
export const COLOR_OPERATOR_REGEX = /(?<head>[^(]*?)(?:(?:(?<=[\s\n]|^)(?<name>\/\w+)\s+(?<csOp>CS|cs)\b)|(?:(?<=[\s\n]|^)(?<name2>\/\w+)\s+(?<scnOp>SCN|scn)\b)|(?:(?<=[\s\n]|^)(?<gray>(?:\d+\.?\d*|\.\d+))\s+(?<gOp>G|g)\b)|(?:(?<=[\s\n]|^)(?<cmyk>(?:\d+\.?\d*|\.\d+)\s+(?:\d+\.?\d*|\.\d+)\s+(?:\d+\.?\d*|\.\d+)\s+(?:\d+\.?\d*|\.\d+))\s+(?<kOp>K|k)\b)|(?:(?<=[\s\n]|^)(?<rgb>(?:\d+\.?\d*|\.\d+)\s+(?:\d+\.?\d*|\.\d+)\s+(?:\d+\.?\d*|\.\d+))\s+(?<rgOp>RG|rg)\b)|(?:(?<=[\s\n]|^)(?<n>(?:\d+\.?\d*|\.\d+)(?:\s+(?:\d+\.?\d*|\.\d+))*)\s+(?<scOp>SC|sc|SCN|scn)\b)|(?:\((?<string>[^)]*)\))|\s*$)/ug;
