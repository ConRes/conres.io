// @ts-check
/**
 * Buffer utilities — base64/hex encoding and async chunk collection.
 *
 * Base64 and hex conversions adapted from the TC39 Uint8Array Base64 proposal:
 * https://github.com/tc39/proposal-arraybuffer-base64/blob/main/playground/polyfill-core.mjs
 *
 * @module helpers/buffers
 * @author Saleh Abdel Motaal <dev@smotaal.io>
 * @ai Claude Opus 4.6 (code generation)
 */

/**
 * Collects all chunks from an async iterable into a single `Uint8Array`.
 * @param {AsyncIterable<Uint8Array>} source
 * @returns {Promise<Uint8Array>}
 */
export async function collectUint8ArrayChunks(source) {
    const chunks = [];
    let totalLength = 0;
    for await (const chunk of source) {
        chunks.push(chunk);
        totalLength += chunk.byteLength;
    }
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return result;
}

// ============================================================================
// Base64 / Hex — TC39 proposal-arraybuffer-base64 polyfill (simplified)
// ============================================================================

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const BASE64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const BASE64_DECODE = new Map(BASE64.split('').map((c, i) => [c, i]));
const ALPHABETS = /** @type {const} */ ({ base64: BASE64, base64url: BASE64URL });

const UINT8_TAG = /** @type {() => string} */ (
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), Symbol.toStringTag).get
);

/** @param {unknown} arg */
export function checkUint8Array(arg) {
    let kind; try { kind = UINT8_TAG.call(arg); } catch { /* not a TypedArray */ }
    if (kind !== 'Uint8Array') throw new TypeError('not a Uint8Array');
}

/**
 * @param {Uint8Array} array
 * @param {{ alphabet?: 'base64' | 'base64url', omitPadding?: boolean }} [options]
 * @returns {string}
 */
export function uint8ArrayToBase64(array, options) {
    checkUint8Array(array);
    const lookup = ALPHABETS[options?.alphabet ?? 'base64']
        ?? (() => { throw new TypeError('expected alphabet to be either "base64" or "base64url"'); })();
    const pad = !options?.omitPadding;
    let result = '';
    let i = 0;

    for (; i + 2 < array.length; i += 3) {
        const t = (array[i] << 16) | (array[i + 1] << 8) | array[i + 2];
        result += lookup[(t >> 18) & 63] + lookup[(t >> 12) & 63] + lookup[(t >> 6) & 63] + lookup[t & 63];
    }
    if (i + 1 < array.length) {
        const t = (array[i] << 16) | (array[i + 1] << 8);
        result += lookup[(t >> 18) & 63] + lookup[(t >> 12) & 63] + lookup[(t >> 6) & 63] + (pad ? '=' : '');
    } else if (i < array.length) {
        const t = array[i] << 16;
        result += lookup[(t >> 18) & 63] + lookup[(t >> 12) & 63] + (pad ? '==' : '');
    }
    return result;
}

/**
 * @param {string} chunk - 2-4 base64 characters
 * @param {boolean} strict
 * @returns {number[]}
 */
function decodeBase64Chunk(chunk, strict) {
    const len = chunk.length;
    if (len < 4) chunk += len === 2 ? 'AA' : 'A';
    const t = (BASE64_DECODE.get(chunk[0]) << 18) | (BASE64_DECODE.get(chunk[1]) << 12)
        | (BASE64_DECODE.get(chunk[2]) << 6) | BASE64_DECODE.get(chunk[3]);
    if (len === 2) { if (strict && ((t >> 8) & 255)) throw new SyntaxError('extra bits'); return [(t >> 16) & 255]; }
    if (len === 3) { if (strict && (t & 255)) throw new SyntaxError('extra bits'); return [(t >> 16) & 255, (t >> 8) & 255]; }
    return [(t >> 16) & 255, (t >> 8) & 255, t & 255];
}

/**
 * @param {string} string
 * @param {{ alphabet?: 'base64' | 'base64url', lastChunkHandling?: 'loose' | 'strict' | 'stop-before-partial' }} [options]
 * @returns {{ read: number, bytes: Uint8Array }}
 */
export function base64ToUint8Array(string, options) {
    const alphabet = options?.alphabet ?? 'base64';
    const lastChunkHandling = options?.lastChunkHandling ?? 'loose';
    let read = 0;
    /** @type {number[]} */
    const bytes = [];
    let chunk = '';
    let index = 0;

    while (true) {
        while (index < string.length && '\t\n\f\r '.includes(string[index])) index++;

        if (index === string.length) {
            if (chunk.length > 0) {
                if (lastChunkHandling === 'stop-before-partial') return { bytes: new Uint8Array(bytes), read };
                if (chunk.length === 1) throw new SyntaxError('malformed padding: exactly one additional character');
                if (lastChunkHandling === 'loose') bytes.push(...decodeBase64Chunk(chunk, false));
                else throw new SyntaxError('missing padding');
            }
            return { read: string.length, bytes: new Uint8Array(bytes) };
        }

        let char = string[index++];

        if (char === '=') {
            if (chunk.length < 2) throw new SyntaxError('padding is too early');
            while (index < string.length && '\t\n\f\r '.includes(string[index])) index++;
            if (chunk.length === 2) {
                if (index === string.length) {
                    if (lastChunkHandling === 'stop-before-partial') return { bytes: new Uint8Array(bytes), read };
                    throw new SyntaxError('malformed padding - only one =');
                }
                if (string[index] === '=') { index++; while (index < string.length && '\t\n\f\r '.includes(string[index])) index++; }
            }
            if (index < string.length) throw new SyntaxError('unexpected character after padding');
            bytes.push(...decodeBase64Chunk(chunk, lastChunkHandling === 'strict'));
            return { read: string.length, bytes: new Uint8Array(bytes) };
        }

        if (alphabet === 'base64url') {
            if (char === '+' || char === '/') throw new SyntaxError(`unexpected character ${JSON.stringify(char)}`);
            if (char === '-') char = '+';
            else if (char === '_') char = '/';
        }
        if (!BASE64.includes(char)) throw new SyntaxError(`unexpected character ${JSON.stringify(char)}`);

        chunk += char;
        if (chunk.length === 4) {
            bytes.push(...decodeBase64Chunk(chunk, false));
            chunk = '';
            read = index;
        }
    }
}

/**
 * @param {Uint8Array} array
 * @returns {string}
 */
export function uint8ArrayToHex(array) {
    checkUint8Array(array);
    let result = '';
    for (let i = 0; i < array.length; i++) result += array[i].toString(16).padStart(2, '0');
    return result;
}

/**
 * @param {string} string
 * @returns {{ read: number, bytes: Uint8Array }}
 */
export function hexToUint8Array(string) {
    if (typeof string !== 'string') throw new TypeError('expected string to be a string');
    if (string.length % 2 !== 0) throw new SyntaxError('string should be an even number of characters');
    const bytes = new Uint8Array(string.length / 2);
    for (let i = 0; i < bytes.length; i++) {
        const pair = string.slice(i * 2, i * 2 + 2);
        if (/[^0-9a-fA-F]/.test(pair)) throw new SyntaxError('string should only contain hex characters');
        bytes[i] = parseInt(pair, 16);
    }
    return { read: string.length, bytes };
}
