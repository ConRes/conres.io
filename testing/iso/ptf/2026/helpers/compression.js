// @ts-check
/**
 * Native compression/decompression using the Compression Streams API.
 *
 * Three formats, each as streaming async generator and buffer convenience:
 *
 *   `deflate` / `inflate`         — zlib (RFC 1950), used by PDF FlateDecode
 *   `deflateRaw` / `inflateRaw`   — raw DEFLATE (RFC 1951), no header
 *   `gzip` / `gunzip`             — gzip (RFC 1952), for download compression
 *
 * Supported in Node.js 21.2+, Chromium 80+, Firefox 113+, Safari 16.4+.
 *
 * @module helpers/compression
 * @author Saleh Abdel Motaal <dev@smotaal.io>
 * @ai Claude Opus 4.6 (code generation)
 */

import { readableStreamAsyncIterable } from './streams.js';
import { collectUint8ArrayChunks } from './buffers.js';

/**
 * @param {Uint8Array} bytes
 * @param {ReadableWritablePair<Uint8Array, Uint8Array>} transform
 * @returns {AsyncGenerator<Uint8Array, void, undefined>}
 */
async function* pipeThrough(bytes, transform) {
    const writer = transform.writable.getWriter();
    writer.write(bytes);
    writer.close();
    yield* readableStreamAsyncIterable(transform.readable);
}

// ============================================================================
// Zlib (RFC 1950) — PDF FlateDecode format
// ============================================================================

/** @param {Uint8Array} rawBytes @returns {AsyncGenerator<Uint8Array, void, undefined>} */
export async function* deflate(rawBytes) { yield* pipeThrough(rawBytes, new CompressionStream('deflate')); }

/** @param {Uint8Array} compressedBytes @returns {AsyncGenerator<Uint8Array, void, undefined>} */
export async function* inflate(compressedBytes) { yield* pipeThrough(compressedBytes, new DecompressionStream('deflate')); }

/** @param {Uint8Array} rawBytes @returns {Promise<Uint8Array>} */
export const deflateToBuffer = (rawBytes) => collectUint8ArrayChunks(deflate(rawBytes));

/** @param {Uint8Array} compressedBytes @returns {Promise<Uint8Array>} */
export const inflateToBuffer = (compressedBytes) => collectUint8ArrayChunks(inflate(compressedBytes));

// ============================================================================
// Raw DEFLATE (RFC 1951) — no header/trailer
// ============================================================================

/** @param {Uint8Array} rawBytes @returns {AsyncGenerator<Uint8Array, void, undefined>} */
export async function* deflateRaw(rawBytes) { yield* pipeThrough(rawBytes, new CompressionStream('deflate-raw')); }

/** @param {Uint8Array} compressedBytes @returns {AsyncGenerator<Uint8Array, void, undefined>} */
export async function* inflateRaw(compressedBytes) { yield* pipeThrough(compressedBytes, new DecompressionStream('deflate-raw')); }

/** @param {Uint8Array} rawBytes @returns {Promise<Uint8Array>} */
export const deflateRawToBuffer = (rawBytes) => collectUint8ArrayChunks(deflateRaw(rawBytes));

/** @param {Uint8Array} compressedBytes @returns {Promise<Uint8Array>} */
export const inflateRawToBuffer = (compressedBytes) => collectUint8ArrayChunks(inflateRaw(compressedBytes));

// ============================================================================
// Gzip (RFC 1952) — download compression
// ============================================================================

/** @param {Uint8Array} rawBytes @returns {AsyncGenerator<Uint8Array, void, undefined>} */
export async function* gzip(rawBytes) { yield* pipeThrough(rawBytes, new CompressionStream('gzip')); }

/** @param {Uint8Array} compressedBytes @returns {AsyncGenerator<Uint8Array, void, undefined>} */
export async function* gunzip(compressedBytes) { yield* pipeThrough(compressedBytes, new DecompressionStream('gzip')); }

/** @param {Uint8Array} rawBytes @returns {Promise<Uint8Array>} */
export const gzipToBuffer = (rawBytes) => collectUint8ArrayChunks(gzip(rawBytes));

/** @param {Uint8Array} compressedBytes @returns {Promise<Uint8Array>} */
export const gunzipToBuffer = (compressedBytes) => collectUint8ArrayChunks(gunzip(compressedBytes));
