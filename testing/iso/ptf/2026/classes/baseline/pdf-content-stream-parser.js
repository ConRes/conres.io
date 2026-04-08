// @ts-check
/**
 * PDF Content Stream Tokenizer (Layer 1)
 *
 * Regex-driven tokenizer for PDF content stream color operators,
 * following the same composed-regex architecture as xml-markup-parser.js.
 *
 * This is a pure lexer — it identifies tokens syntactically without
 * semantic interpretation. It does NOT:
 *   - Resolve colorSpaceName (that's Layer 2: interpreter)
 *   - Track graphics state stack for q/Q (that's Layer 2)
 *   - Know which color space is "active" (that's Layer 2)
 *
 * It DOES:
 *   - Identify color operators (g/G, rg/RG, k/K, cs/CS, sc/SC/scn/SCN)
 *   - Identify graphics state operators (q/Q) and yield them as events
 *   - Forward through parenthesized string spans with balanced-paren depth
 *   - Parse numeric operands
 *   - Yield events with offset+length (no extracted substrings)
 *   - Support streaming via tokenizeFrom/tokenizeFromAsync
 *
 * Derived from the markup tokenizer architecture in SMotaal/markup.
 * See xml-markup-parser.js for the reference implementation.
 *
 * @module pdf-content-stream-parser
 * @author Saleh Abdel Motaal <dev@smotaal.io>
 * @ai Claude Opus 4.6 (code generation)
 */

// ── Matcher Helpers ──────────────────────────────────────────────────

/** @type {(template: TemplateStringsArray, ...spans: *[]) => string} */
const sequence = (template, ...spans) =>
    /^\s+|\s*\n\s*|\s+$/g[Symbol.replace](
        String.raw(template, ...spans.map(value => (value != null && `${value}`) || '')),
        '',
    );

/** @param  {...*} values @returns {string} */
const join = (...values) =>
    values.map(value => (value != null && `${value}`) || '').filter(Boolean).join('|');

// ── Number Pattern ──────────────────────────────────────────────────

/** Matches a PDF numeric value: integer, decimal, leading-dot, negative */
const NUMBER = sequence`-?(?:\d+\.?\d*|\.\d+)`;

/** One or more whitespace-separated numbers (operand sequence) */
const NUMBERS = sequence`${NUMBER}(?:\s+${NUMBER})*`;

// ── Entity Enum ─────────────────────────────────────────────────────

/**
 * Operator entity indices — numbered capture groups in OPERATOR_PATTERN.
 * @enum {number}
 */
const OE = Object.freeze({
    // Color operators
    GRAY_VALUE:     1,  // gray value before g/G
    GRAY_OP:        2,  // g or G
    RGB_VALUES:     3,  // r g b values before rg/RG
    RGB_OP:         4,  // rg or RG
    CMYK_VALUES:    5,  // c m y k values before k/K
    CMYK_OP:        6,  // k or K
    CS_NAME:        7,  // /Name before CS/cs
    CS_OP:          8,  // CS or cs
    SCN_NAME:       9,  // /Name before SCN/scn (name-only form)
    SCN_NAME_OP:    10, // SCN or scn (name-only form)
    SC_VALUES:      11, // numeric values before SC/sc/SCN/scn
    SC_OP:          12, // SC or sc or SCN or scn (numeric form)
    // Graphics state operators
    SAVE_OP:        13, // q
    RESTORE_OP:     14, // Q
    // String literal open
    STRING_OPEN:    15, // (
    // Non-color content
    CONTENT:        16, // anything else (non-operator content)
    FALLTHROUGH:    17, // single char fallthrough
});

// ── Composed Operator Pattern ───────────────────────────────────────

/**
 * Composed regex pattern for PDF content stream color operators.
 *
 * Each alternative is a numbered capture group corresponding to an OE entity.
 * The pattern uses lookbehind (?<=[\s\n]|^) to ensure operators are preceded
 * by whitespace or start-of-string, matching PDF's postfix notation.
 */
const OPERATOR_PATTERN = join(
    // setGray: <number> g/G
    sequence`(?<=[\s\n]|^)(${NUMBER})\s+(G|g)\b`,
    // setRGB: <number> <number> <number> rg/RG
    sequence`(?<=[\s\n]|^)(${NUMBER}\s+${NUMBER}\s+${NUMBER})\s+(RG|rg)\b`,
    // setCMYK: <number> <number> <number> <number> k/K
    sequence`(?<=[\s\n]|^)(${NUMBER}\s+${NUMBER}\s+${NUMBER}\s+${NUMBER})\s+(K|k)\b`,
    // setColorSpace: /Name CS/cs
    sequence`(?<=[\s\n]|^)(\/\w+)\s+(CS|cs)\b`,
    // selectColorSpace (name-only SCN/scn): /Name SCN/scn
    sequence`(?<=[\s\n]|^)(\/\w+)\s+(SCN|scn)\b`,
    // setColor (numeric SC/sc/SCN/scn): <numbers> SC/sc/SCN/scn
    sequence`(?<=[\s\n]|^)(${NUMBERS})\s+(SC|sc|SCN|scn)\b`,
    // saveState: q (must be standalone — not part of a longer keyword)
    sequence`(?<=[\s\n]|^)(q)\b(?!\w)`,
    // restoreState: Q (must be standalone)
    sequence`(?<=[\s\n]|^)(Q)\b(?!\w)`,
    // String literal open — triggers span forwarding
    sequence`(\()`,
    // Non-color content (bulk forward — stops at ( or operator-preceding whitespace)
    sequence`([^(\s]+)`,
    // Fallthrough (single whitespace or other char)
    sequence`([\s\S])`,
);

// ── String Span Consumer ────────────────────────────────────────────

/**
 * Sticky regex for string span forwarding.
 *
 * Bulk-forwards through non-special content and escape sequences in
 * the regex engine's internal loop. Only breaks out to JavaScript
 * for unescaped parentheses that need depth counting.
 *
 * Per PDF spec (ISO 32000-1, Section 7.3.4.2):
 * - Balanced parentheses within strings are valid without escaping
 * - Unbalanced parentheses must be escaped with \( or \)
 * - Backslash itself must be escaped as \\
 *
 * @type {RegExp}
 */
const STRING_SPAN = /(?:[^\\()]+|\\[^])+|(\()|(\))/gy;

/**
 * Consume a parenthesized string span, advancing state.position past
 * the closing parenthesis. Does NOT extract the string content.
 *
 * @param {ParserState} state
 * @returns {boolean} true if span was properly terminated, false if unterminated
 */
function consumeStringSpan(state) {
    let depth = 1;
    STRING_SPAN.lastIndex = state.position;
    let match;
    while ((match = STRING_SPAN.exec(state.source)) !== null) {
        if (match[1] !== undefined) {
            depth++;
        } else if (match[2] !== undefined) {
            if (--depth === 0) {
                state.position = STRING_SPAN.lastIndex;
                return true;
            }
        }
    }
    // Unterminated string
    state.position = state.source.length;
    return false;
}

// ── Event Types ─────────────────────────────────────────────────────

/**
 * @typedef {{
 *   type: 'operator',
 *   operation: 'setGray',
 *   operator: 'g' | 'G',
 *   isStroke: boolean,
 *   value: number,
 *   offset: number,
 *   length: number,
 * }} SetGrayEvent
 */

/**
 * @typedef {{
 *   type: 'operator',
 *   operation: 'setRGB',
 *   operator: 'rg' | 'RG',
 *   isStroke: boolean,
 *   values: [number, number, number],
 *   offset: number,
 *   length: number,
 * }} SetRGBEvent
 */

/**
 * @typedef {{
 *   type: 'operator',
 *   operation: 'setCMYK',
 *   operator: 'k' | 'K',
 *   isStroke: boolean,
 *   values: [number, number, number, number],
 *   offset: number,
 *   length: number,
 * }} SetCMYKEvent
 */

/**
 * @typedef {{
 *   type: 'operator',
 *   operation: 'setColorSpace',
 *   operator: 'cs' | 'CS' | 'scn' | 'SCN',
 *   isStroke: boolean,
 *   name: string,
 *   offset: number,
 *   length: number,
 * }} SetColorSpaceEvent
 */

/**
 * @typedef {{
 *   type: 'operator',
 *   operation: 'setColor',
 *   operator: 'sc' | 'SC' | 'scn' | 'SCN',
 *   isStroke: boolean,
 *   values: number[],
 *   offset: number,
 *   length: number,
 * }} SetColorEvent
 */

/**
 * @typedef {{
 *   type: 'operator',
 *   operation: 'saveState' | 'restoreState',
 *   operator: 'q' | 'Q',
 *   isStroke: false,
 *   offset: number,
 *   length: number,
 * }} GraphicsStateEvent
 */

/**
 * @typedef {{
 *   type: 'content',
 *   offset: number,
 *   length: number,
 * }} ContentEvent
 */

/**
 * @typedef {SetGrayEvent | SetRGBEvent | SetCMYKEvent | SetColorSpaceEvent | SetColorEvent | GraphicsStateEvent | ContentEvent} ContentStreamEvent
 */

// ── Parser State ────────────────────────────────────────────────────

/**
 * @typedef {{
 *   source: string,
 *   position: number,
 *   matcher: RegExp,
 * }} ParserState
 */

/**
 * @param {string} source
 * @returns {ParserState}
 */
function createState(source) {
    return {
        source,
        position: 0,
        matcher: new RegExp(OPERATOR_PATTERN, 'gu'),
    };
}

// ── Core Generator ──────────────────────────────────────────────────

/**
 * Generator that yields content stream events from a complete source string.
 *
 * @param {string} source
 * @yields {ContentStreamEvent}
 * @returns {Generator<ContentStreamEvent, void, undefined>}
 */
export function* tokenize(source) {
    const state = createState(source);
    yield* drainEvents(state);
}

/**
 * Drain complete events from the current buffer.
 *
 * @param {ParserState} state
 * @yields {ContentStreamEvent}
 * @returns {Generator<ContentStreamEvent, void, undefined>}
 */
function* drainEvents(state) {
    state.matcher.lastIndex = state.position;
    let match;

    while ((match = state.matcher.exec(state.source)) !== null) {
        state.position = state.matcher.lastIndex;
        const matchOffset = match.index;

        // setGray: <number> g/G
        if (match[OE.GRAY_OP] !== undefined) {
            const op = match[OE.GRAY_OP];
            yield {
                type: 'operator',
                operation: 'setGray',
                operator: /** @type {'g' | 'G'} */ (op),
                isStroke: op === 'G',
                value: parseFloat(match[OE.GRAY_VALUE]),
                offset: matchOffset,
                length: match[0].length,
            };
            continue;
        }

        // setRGB: <numbers> rg/RG
        if (match[OE.RGB_OP] !== undefined) {
            const op = match[OE.RGB_OP];
            const parts = match[OE.RGB_VALUES].trim().split(/\s+/).map(parseFloat);
            yield {
                type: 'operator',
                operation: 'setRGB',
                operator: /** @type {'rg' | 'RG'} */ (op),
                isStroke: op === 'RG',
                values: /** @type {[number, number, number]} */ (parts),
                offset: matchOffset,
                length: match[0].length,
            };
            continue;
        }

        // setCMYK: <numbers> k/K
        if (match[OE.CMYK_OP] !== undefined) {
            const op = match[OE.CMYK_OP];
            const parts = match[OE.CMYK_VALUES].trim().split(/\s+/).map(parseFloat);
            yield {
                type: 'operator',
                operation: 'setCMYK',
                operator: /** @type {'k' | 'K'} */ (op),
                isStroke: op === 'K',
                values: /** @type {[number, number, number, number]} */ (parts),
                offset: matchOffset,
                length: match[0].length,
            };
            continue;
        }

        // setColorSpace: /Name CS/cs
        if (match[OE.CS_OP] !== undefined) {
            const op = match[OE.CS_OP];
            yield {
                type: 'operator',
                operation: 'setColorSpace',
                operator: /** @type {'cs' | 'CS'} */ (op),
                isStroke: op === 'CS',
                name: match[OE.CS_NAME].replace(/^\//, ''),
                offset: matchOffset,
                length: match[0].length,
            };
            continue;
        }

        // selectColorSpace (name-only SCN/scn): /Name SCN/scn
        if (match[OE.SCN_NAME_OP] !== undefined) {
            const op = match[OE.SCN_NAME_OP];
            yield {
                type: 'operator',
                operation: 'setColorSpace',
                operator: /** @type {'scn' | 'SCN'} */ (op),
                isStroke: op === 'SCN',
                name: match[OE.SCN_NAME].replace(/^\//, ''),
                offset: matchOffset,
                length: match[0].length,
            };
            continue;
        }

        // setColor (numeric SC/sc/SCN/scn): <numbers> SC/sc/SCN/scn
        if (match[OE.SC_OP] !== undefined) {
            const op = match[OE.SC_OP];
            yield {
                type: 'operator',
                operation: 'setColor',
                operator: /** @type {'sc' | 'SC' | 'scn' | 'SCN'} */ (op),
                isStroke: op === 'SC' || op === 'SCN',
                values: match[OE.SC_VALUES].trim().split(/\s+/).map(parseFloat),
                offset: matchOffset,
                length: match[0].length,
            };
            continue;
        }

        // saveState: q
        if (match[OE.SAVE_OP] !== undefined) {
            yield {
                type: 'operator',
                operation: 'saveState',
                operator: /** @type {'q'} */ ('q'),
                isStroke: false,
                offset: matchOffset,
                length: match[0].length,
            };
            continue;
        }

        // restoreState: Q
        if (match[OE.RESTORE_OP] !== undefined) {
            yield {
                type: 'operator',
                operation: 'restoreState',
                operator: /** @type {'Q'} */ ('Q'),
                isStroke: false,
                offset: matchOffset,
                length: match[0].length,
            };
            continue;
        }

        // String literal open — consume span, yield as content
        if (match[OE.STRING_OPEN] !== undefined) {
            const spanStart = matchOffset;
            consumeStringSpan(state);
            state.matcher.lastIndex = state.position;
            yield {
                type: 'content',
                offset: spanStart,
                length: state.position - spanStart,
            };
            continue;
        }

        // Non-color content or whitespace fallthrough
        if (match[OE.CONTENT] !== undefined || match[OE.FALLTHROUGH] !== undefined) {
            yield {
                type: 'content',
                offset: matchOffset,
                length: match[0].length,
            };
            continue;
        }
    }
}

// ── Forward Scanner (chunking boundary detection) ───────────────────

/**
 * @typedef {{
 *   parenDepth: number,
 *   escapeNext: boolean,
 *   lastSignificant: number,
 * }} ForwardScannerState
 */

/** @returns {ForwardScannerState} */
function createForwardScanner() {
    return { parenDepth: 0, escapeNext: false, lastSignificant: 0 };
}

/**
 * Advance the scanner through a chunk of text.
 * @param {ForwardScannerState} scanner
 * @param {string} chunk
 */
function scanForward(scanner, chunk) {
    for (let i = 0; i < chunk.length; i++) {
        const code = chunk.charCodeAt(i);

        if (scanner.escapeNext) {
            scanner.escapeNext = false;
            continue;
        }

        // Inside string literal — track parens and escapes
        if (scanner.parenDepth > 0) {
            if (code === 0x5C) { // backslash
                scanner.escapeNext = true;
            } else if (code === 0x28) { // (
                scanner.parenDepth++;
            } else if (code === 0x29) { // )
                scanner.parenDepth--;
            }
            continue;
        }

        // Outside string — track significant chars and string opens
        if (code <= 0x20) continue; // whitespace
        scanner.lastSignificant = code;

        if (code === 0x28) { // (
            scanner.parenDepth++;
        }
    }
}

/**
 * Whether the scanner is at a clean context boundary.
 *
 * Safe to flush when:
 * - Not inside a string literal (parenDepth === 0)
 * - Last significant char suggests we're between operator groups
 *   (after an operator keyword letter, not in the middle of a number)
 *
 * @param {ForwardScannerState} scanner
 * @returns {boolean}
 */
function atContextBoundary(scanner) {
    if (scanner.parenDepth > 0) return false;
    // Don't split in the middle of a number (digits, dot, minus)
    const c = scanner.lastSignificant;
    if (c >= 0x30 && c <= 0x39) return false; // 0-9
    if (c === 0x2E) return false; // .
    if (c === 0x2D) return false; // -
    return true;
}

// ── Chunk-Based Streaming ───────────────────────────────────────────

const CHUNK_THRESHOLD = 256 * 1024;

/**
 * @param {ParserState} state
 * @param {string[]} chunkBuffer
 */
function flushBuffer(state, chunkBuffer) {
    const chunk = chunkBuffer.join('');
    if (state.position < state.source.length) {
        state.source = state.source.slice(state.position) + chunk;
    } else {
        state.source = chunk;
    }
    state.position = 0;
    state.matcher.lastIndex = 0;
}

/**
 * Streaming generator — yields events from chunks (sync iterable).
 *
 * Accepts any iterable of string chunks (e.g., array of lines,
 * chunked file reader). Uses ForwardScanner to detect safe flush
 * boundaries — never splits inside a string literal or mid-operand.
 *
 * @param {{ [Symbol.iterator](): Iterator<string> }} chunks
 * @yields {ContentStreamEvent}
 * @returns {Generator<ContentStreamEvent, void, undefined>}
 */
export function* tokenizeFrom(chunks) {
    const state = createState('');
    const scanner = createForwardScanner();
    /** @type {string[]} */
    const chunkBuffer = [];
    let bufferSize = 0;

    for (const chunk of chunks) {
        chunkBuffer.push(chunk);
        bufferSize += chunk.length;
        scanForward(scanner, chunk);

        if (bufferSize < CHUNK_THRESHOLD || !atContextBoundary(scanner)) continue;

        flushBuffer(state, chunkBuffer);
        chunkBuffer.length = 0;
        bufferSize = 0;

        yield* drainEvents(state);
    }

    if (chunkBuffer.length > 0) flushBuffer(state, chunkBuffer);
    yield* drainEvents(state);
}

/**
 * Async streaming generator — yields events from async chunks.
 *
 * Composes with ReadableStream, DecompressionStream, etc.
 *
 * @param {{ [Symbol.asyncIterator](): AsyncIterator<string> }} chunks
 * @yields {ContentStreamEvent}
 * @returns {AsyncGenerator<ContentStreamEvent, void, undefined>}
 */
export async function* tokenizeFromAsync(chunks) {
    const state = createState('');
    const scanner = createForwardScanner();
    /** @type {string[]} */
    const chunkBuffer = [];
    let bufferSize = 0;

    for await (const chunk of chunks) {
        chunkBuffer.push(chunk);
        bufferSize += chunk.length;
        scanForward(scanner, chunk);

        if (bufferSize < CHUNK_THRESHOLD || !atContextBoundary(scanner)) continue;

        flushBuffer(state, chunkBuffer);
        chunkBuffer.length = 0;
        bufferSize = 0;

        yield* drainEvents(state);
    }

    if (chunkBuffer.length > 0) flushBuffer(state, chunkBuffer);
    yield* drainEvents(state);
}

// ── Buffer-Backed Streaming Transform ───────────────────────────────

/**
 * Transform event: either passthrough bytes or an operator token.
 *
 * @typedef {{
 *   type: 'passthrough',
 *   bytes: Uint8Array,
 * }} PassthroughToken
 */

/**
 * @typedef {{
 *   type: 'operator',
 *   operation: string,
 *   operator: string,
 *   isStroke: boolean,
 *   value?: number,
 *   values?: number[],
 *   name?: string,
 *   bytes: Uint8Array,
 * }} OperatorToken
 */

/**
 * @typedef {{ type: 'flush' }} FlushToken

 * @typedef {PassthroughToken | OperatorToken | FlushToken} TransformToken
 */

/**
 * Manages a preallocated ArrayBuffer for Latin-1 encoding.
 * Passthrough chunks are views into this shared buffer, avoiding
 * per-chunk allocation. The buffer is grown if needed.
 */
class Latin1Buffer {
    /** @type {ArrayBuffer} */
    #buffer;
    /** @type {Uint8Array} */
    #view;

    /** @param {number} [initialSize=104857600] Initial buffer size (default 100 MB) */
    constructor(initialSize = 100 * 1024 * 1024) {
        this.#buffer = new ArrayBuffer(initialSize);
        this.#view = new Uint8Array(this.#buffer);
    }

    /**
     * Encode a string region to Latin-1 bytes in the shared buffer.
     * Returns a Uint8Array view into the shared ArrayBuffer.
     *
     * IMPORTANT: The returned view is only valid until the next call
     * to encode(). The consumer must write or copy the bytes before
     * the next encode() call.
     *
     * @param {string} text
     * @param {number} [start=0]
     * @param {number} [end]
     * @returns {Uint8Array} View into the shared buffer
     */
    encode(text, start = 0, end = text.length) {
        const len = end - start;

        // Grow buffer if needed
        if (len > this.#view.length) {
            this.#buffer = new ArrayBuffer(len);
            this.#view = new Uint8Array(this.#buffer);
        }

        for (let i = 0; i < len; i++) {
            this.#view[i] = text.charCodeAt(start + i);
        }

        return new Uint8Array(this.#buffer, 0, len);
    }

    /**
     * Encode a string region to a NEW Uint8Array (not shared).
     * Use this for small operator tokens that must outlive the next encode() call.
     *
     * @param {string} text
     * @param {number} [start=0]
     * @param {number} [end]
     * @returns {Uint8Array} Independent copy
     */
    static encodeCopy(text, start = 0, end = text.length) {
        const len = end - start;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) bytes[i] = text.charCodeAt(start + i);
        return bytes;
    }
}

/**
 * Async streaming transform generator for content stream conversion.
 *
 * Accepts async iterable of decompressed Uint8Array chunks (e.g., from
 * DecompressionStream). Yields TransformTokens:
 *   - `{type: 'passthrough', bytes}` — non-operator content, write to output as-is
 *   - `{type: 'operator', operation, operator, isStroke, bytes, ...}` — color operator,
 *     consumer decides whether to substitute or pass through
 *
 * Uses the same OPERATOR_PATTERN regex and OE entity dispatch as the
 * tokenize/tokenizeFrom generators. Non-operator regex matches (CONTENT,
 * FALLTHROUGH, STRING_OPEN) are coalesced into passthrough chunks — NOT
 * yielded as individual events.
 *
 * Buffer-backed: decompressed chunks are decoded to Latin-1 into a working
 * buffer. Passthrough regions are encoded back to Uint8Array from the buffer.
 * The buffer is reused across chunks. Operator tokens carry their own small
 * Uint8Array (typically 5-50 bytes). No full decompressed string exists.
 *
 * @param {{ [Symbol.asyncIterator](): AsyncIterator<Uint8Array> }} chunks - Decompressed byte chunks
 * @param {{ bufferSize?: number }} [options]
 * @yields {TransformToken}
 * @returns {AsyncGenerator<TransformToken, void, undefined>}
 */
export async function* transformFromAsync(chunks, options = {}) {
    let carry = '';
    const CARRY_SIZE = 200; // Max operator match length for boundary safety

    for await (const chunk of chunks) {
        // Decode chunk to Latin-1 and prepend carry-over.
        // Batch decode to avoid per-char concatenation chains in JSC
        // and max call stack issues with large spread arguments.
        const DECODE_BATCH = 8192;
        const parts = carry ? [carry] : [];
        for (let i = 0; i < chunk.length; i += DECODE_BATCH) {
            const end = Math.min(i + DECODE_BATCH, chunk.length);
            parts.push(String.fromCharCode.apply(null, chunk.subarray(i, end)));
        }
        const text = parts.join('');

        // Scan for operators using the composed regex.
        //
        // Chunk boundary safety: an operator at the end of the text may be
        // a truncated prefix (e.g., 'SC' when the real token is 'SCN' with
        // 'N' in the next chunk). Operators whose match starts at or past
        // safeEnd are NOT yielded — they stay in the carry zone and get
        // re-scanned with the next chunk where the full token is available.
        const safeEnd = Math.max(0, text.length - CARRY_SIZE);
        const regex = new RegExp(OPERATOR_PATTERN, 'gu');
        let lastPassthroughEnd = 0;

        let match;
        while ((match = regex.exec(text)) !== null) {
            const matchStart = match.index;

            // Check if this is an operator entity (not content/fallthrough)
            if (match[OE.GRAY_OP] !== undefined ||
                match[OE.RGB_OP] !== undefined ||
                match[OE.CMYK_OP] !== undefined ||
                match[OE.CS_OP] !== undefined ||
                match[OE.SCN_NAME_OP] !== undefined ||
                match[OE.SC_OP] !== undefined ||
                match[OE.SAVE_OP] !== undefined ||
                match[OE.RESTORE_OP] !== undefined) {

                // Operator in carry zone — may be a truncated prefix
                // (e.g., 'SC' when real token is 'SCN'). Don't yield it;
                // rewind regex.lastIndex so the carry includes this match
                // and the next chunk re-scans it with the full context.
                if (matchStart >= safeEnd) {
                    regex.lastIndex = matchStart;
                    break;
                }

                // Yield passthrough for content before this operator.
                if (matchStart > lastPassthroughEnd) {
                    yield {
                        type: /** @type {const} */ ('passthrough'),
                        bytes: Latin1Buffer.encodeCopy(text, lastPassthroughEnd, matchStart),
                    };
                }

                // Build operator token — uses independent copy (small, must outlive yield)
                const matchEnd = matchStart + match[0].length;
                const operatorBytes = Latin1Buffer.encodeCopy(text, matchStart, matchEnd);

                if (match[OE.GRAY_OP] !== undefined) {
                    yield { type: /** @type {const} */ ('operator'), operation: 'setGray', operator: match[OE.GRAY_OP], isStroke: match[OE.GRAY_OP] === 'G', value: parseFloat(match[OE.GRAY_VALUE]), bytes: operatorBytes };
                } else if (match[OE.RGB_OP] !== undefined) {
                    yield { type: /** @type {const} */ ('operator'), operation: 'setRGB', operator: match[OE.RGB_OP], isStroke: match[OE.RGB_OP] === 'RG', values: /** @type {[number,number,number]} */ (match[OE.RGB_VALUES].trim().split(/\s+/).map(parseFloat)), bytes: operatorBytes };
                } else if (match[OE.CMYK_OP] !== undefined) {
                    yield { type: /** @type {const} */ ('operator'), operation: 'setCMYK', operator: match[OE.CMYK_OP], isStroke: match[OE.CMYK_OP] === 'K', values: /** @type {[number,number,number,number]} */ (match[OE.CMYK_VALUES].trim().split(/\s+/).map(parseFloat)), bytes: operatorBytes };
                } else if (match[OE.CS_OP] !== undefined) {
                    yield { type: /** @type {const} */ ('operator'), operation: 'setColorSpace', operator: match[OE.CS_OP], isStroke: match[OE.CS_OP] === 'CS', name: match[OE.CS_NAME].replace(/^\//, ''), bytes: operatorBytes };
                } else if (match[OE.SCN_NAME_OP] !== undefined) {
                    yield { type: /** @type {const} */ ('operator'), operation: 'setColorSpace', operator: match[OE.SCN_NAME_OP], isStroke: match[OE.SCN_NAME_OP] === 'SCN', name: match[OE.SCN_NAME].replace(/^\//, ''), bytes: operatorBytes };
                } else if (match[OE.SC_OP] !== undefined) {
                    yield { type: /** @type {const} */ ('operator'), operation: 'setColor', operator: match[OE.SC_OP], isStroke: match[OE.SC_OP] === 'SC' || match[OE.SC_OP] === 'SCN', values: match[OE.SC_VALUES].trim().split(/\s+/).map(parseFloat), bytes: operatorBytes };
                } else if (match[OE.SAVE_OP] !== undefined) {
                    yield { type: /** @type {const} */ ('operator'), operation: 'saveState', operator: 'q', isStroke: false, bytes: operatorBytes };
                } else if (match[OE.RESTORE_OP] !== undefined) {
                    yield { type: /** @type {const} */ ('operator'), operation: 'restoreState', operator: 'Q', isStroke: false, bytes: operatorBytes };
                }

                lastPassthroughEnd = matchEnd;
            } else if (match[OE.STRING_OPEN] !== undefined) {
                // String literal — the regex matched '(' but the content/fallthrough
                // alternatives will consume the string body character by character.
                // The entire string region remains part of the passthrough content.
                // TODO: proper string span forwarding for streaming
            }
            // CONTENT and FALLTHROUGH matches: regex advances position,
            // but we do NOT yield — these are part of the next passthrough chunk.
        }

        // Yield remaining passthrough up to the safe boundary.
        if (safeEnd > lastPassthroughEnd) {
            yield {
                type: /** @type {const} */ ('passthrough'),
                bytes: Latin1Buffer.encodeCopy(text, lastPassthroughEnd, safeEnd),
            };
            carry = text.slice(safeEnd);
        } else {
            carry = text.slice(lastPassthroughEnd);
        }

        // Signal chunk boundary — consumer can batch-convert accumulated operators
        yield { type: /** @type {const} */ ('flush') };
    }

    // Flush remaining carry — must be tokenized, not emitted as raw
    // passthrough, because it may contain operators deferred from the
    // last chunk's carry zone.
    if (carry.length > 0) {
        const regex = new RegExp(OPERATOR_PATTERN, 'gu');
        let lastPassthroughEnd = 0;

        let match;
        while ((match = regex.exec(carry)) !== null) {
            const matchStart = match.index;

            if (match[OE.GRAY_OP] !== undefined ||
                match[OE.RGB_OP] !== undefined ||
                match[OE.CMYK_OP] !== undefined ||
                match[OE.CS_OP] !== undefined ||
                match[OE.SCN_NAME_OP] !== undefined ||
                match[OE.SC_OP] !== undefined ||
                match[OE.SAVE_OP] !== undefined ||
                match[OE.RESTORE_OP] !== undefined) {

                if (matchStart > lastPassthroughEnd) {
                    yield {
                        type: /** @type {const} */ ('passthrough'),
                        bytes: Latin1Buffer.encodeCopy(carry, lastPassthroughEnd, matchStart),
                    };
                }

                const matchEnd = matchStart + match[0].length;
                const operatorBytes = Latin1Buffer.encodeCopy(carry, matchStart, matchEnd);

                if (match[OE.GRAY_OP] !== undefined) {
                    yield { type: /** @type {const} */ ('operator'), operation: 'setGray', operator: match[OE.GRAY_OP], isStroke: match[OE.GRAY_OP] === 'G', value: parseFloat(match[OE.GRAY_VALUE]), bytes: operatorBytes };
                } else if (match[OE.RGB_OP] !== undefined) {
                    yield { type: /** @type {const} */ ('operator'), operation: 'setRGB', operator: match[OE.RGB_OP], isStroke: match[OE.RGB_OP] === 'RG', values: /** @type {[number,number,number]} */ (match[OE.RGB_VALUES].trim().split(/\s+/).map(parseFloat)), bytes: operatorBytes };
                } else if (match[OE.CMYK_OP] !== undefined) {
                    yield { type: /** @type {const} */ ('operator'), operation: 'setCMYK', operator: match[OE.CMYK_OP], isStroke: match[OE.CMYK_OP] === 'K', values: /** @type {[number,number,number,number]} */ (match[OE.CMYK_VALUES].trim().split(/\s+/).map(parseFloat)), bytes: operatorBytes };
                } else if (match[OE.CS_OP] !== undefined) {
                    yield { type: /** @type {const} */ ('operator'), operation: 'setColorSpace', operator: match[OE.CS_OP], isStroke: match[OE.CS_OP] === 'CS', name: match[OE.CS_NAME].replace(/^\//, ''), bytes: operatorBytes };
                } else if (match[OE.SCN_NAME_OP] !== undefined) {
                    yield { type: /** @type {const} */ ('operator'), operation: 'setColorSpace', operator: match[OE.SCN_NAME_OP], isStroke: match[OE.SCN_NAME_OP] === 'SCN', name: match[OE.SCN_NAME].replace(/^\//, ''), bytes: operatorBytes };
                } else if (match[OE.SC_OP] !== undefined) {
                    yield { type: /** @type {const} */ ('operator'), operation: 'setColor', operator: match[OE.SC_OP], isStroke: match[OE.SC_OP] === 'SC' || match[OE.SC_OP] === 'SCN', values: match[OE.SC_VALUES].trim().split(/\s+/).map(parseFloat), bytes: operatorBytes };
                } else if (match[OE.SAVE_OP] !== undefined) {
                    yield { type: /** @type {const} */ ('operator'), operation: 'saveState', operator: 'q', isStroke: false, bytes: operatorBytes };
                } else if (match[OE.RESTORE_OP] !== undefined) {
                    yield { type: /** @type {const} */ ('operator'), operation: 'restoreState', operator: 'Q', isStroke: false, bytes: operatorBytes };
                }

                lastPassthroughEnd = matchEnd;
            }
        }

        // Remaining passthrough after last operator in carry
        if (lastPassthroughEnd < carry.length) {
            yield {
                type: /** @type {const} */ ('passthrough'),
                bytes: Latin1Buffer.encodeCopy(carry, lastPassthroughEnd),
            };
        }
    }
}

// ── Exports ─────────────────────────────────────────────────────────

export { OE, OPERATOR_PATTERN, STRING_SPAN };
