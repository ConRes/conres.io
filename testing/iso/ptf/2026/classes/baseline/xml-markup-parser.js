// @ts-check
/**
 * Regex-driven XML parser preserving the markup tokenizer's matching
 * architecture. Derived from the HTML tokenizer in SMotaal/markup,
 * following the same extraction pattern used for the json-markup-parser.
 *
 * The original markup tokenizer — including the composed RegExp
 * matcher, entity dispatch via capture groups, span forwarding,
 * goal-based context stack, and the grammar definitions — was designed
 * and implemented by Saleh Abdel Motaal as part of the markup project.
 *
 * This module adapts those patterns for XML event production:
 *   Matcher.define + join       → composed regexes (content + tag matchers)
 *   Entity capture groups       → entity index constants
 *   HTMLGoal.spans              → span forwarding for comments, CDATA, PIs, strings
 *   TokenMatcher.forward        → consumeSpan for bulk content
 *   Goals / context stack       → pushContext / popContext
 *   *TokenGenerator             → *tokenize / *tokenizeFrom / *tokenizeFromAsync
 *   TokenMatcher.lookAhead      → ForwardScanner for streaming
 *   Value construction          → collectTree (separate consumer)
 *
 * Derived from markup/packages/matcher/experimental/html-tokenizer:
 *   Root/Tag/String/Comment/PI/CDATA goals → content/tag dual-matcher
 *   Removed: CSS/JS mode switching, void elements, DOCTYPE internal subset
 *   Added: namespace resolution, processing instruction preservation
 *
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

// ── Character Ranges ────────────────────────────────────────────────

const NAME_START_CHAR = String.raw`A-Za-z_\xC0-\xD6\xD8-\xF6\xF8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD`;
const NAME_CHAR = String.raw`${NAME_START_CHAR}\-\.0-9\xB7\u0300-\u036F\u203F-\u2040:`;

// ── Content Matcher (element content — between tags) ────────────────

/** @enum {number} */
const CE = Object.freeze({
    BREAK: 1, WHITESPACE: 2, TAG_OPEN: 3,
    COMMENT_OPEN: 4, CDATA_OPEN: 5, PI_OPEN: 6,
    ENTITY_REF: 7, TEXT: 8, FALLTHROUGH: 9,
});

const CONTENT_PATTERN = join(
    sequence`(\r?\n)`,
    sequence`([ \t\r]+)`,
    sequence`(<\/[${NAME_START_CHAR}][${NAME_CHAR}]*|<[${NAME_START_CHAR}][${NAME_CHAR}]*)`,
    sequence`(<!--)`,
    sequence`(<!\[CDATA\[)`,
    sequence`(<\?[${NAME_START_CHAR}][${NAME_CHAR}]*)`,
    sequence`(&(?:#x[0-9a-fA-F]+|#[0-9]+|[A-Za-z][A-Za-z0-9]*);)`,
    sequence`([^<&]+)`,
    sequence`(.)`,
);

// ── Tag Matcher (inside opening/closing tags — for attributes) ──────

/** @enum {number} */
const TE = Object.freeze({
    BREAK: 1, WHITESPACE: 2, TAG_CLOSE: 3,
    OPERATOR: 4, NAME: 5, FALLTHROUGH: 6,
});

const TAG_PATTERN = join(
    sequence`(\r?\n)`,
    sequence`([ \t\r]+)`,
    sequence`(\/>|>)`,
    sequence`(=|"|')`,
    sequence`([${NAME_START_CHAR}][${NAME_CHAR}]*)`,
    sequence`(.)`,
);

// ── Span Regexes (bulk forward — same as TokenMatcher.forward) ──────

const COMMENT_SPAN = /[^]*?(?=-->|($))/g;
const CDATA_SPAN = /[^]*?(?=\]\]>|($))/g;
const PI_SPAN = /[^]*?(?=\?>|($))/g;
const DOUBLE_QUOTE_SPAN = /[^"]*(?="|($))/g;
const SINGLE_QUOTE_SPAN = /[^']*(?='|($))/g;

// ── Entity Reference Decoding ───────────────────────────────────────

/** @type {Readonly<Record<string, string>>} */
const PREDEFINED_ENTITIES = Object.freeze({
    'amp': '&', 'lt': '<', 'gt': '>', 'apos': "'", 'quot': '"',
});

/** @param {string} ref @returns {string} */
function decodeEntityRef(ref) {
    const inner = ref.slice(1, -1);
    if (inner.startsWith('#x')) return String.fromCodePoint(parseInt(inner.slice(2), 16));
    if (inner.startsWith('#')) return String.fromCodePoint(parseInt(inner.slice(1), 10));
    return PREDEFINED_ENTITIES[inner] ?? ref;
}

const ENTITY_REF_PATTERN = /&(?:#x[0-9a-fA-F]+|#[0-9]+|[A-Za-z][A-Za-z0-9]*);/g;

/** @param {string} text @returns {string} */
function decodeEntities(text) {
    return text.replace(ENTITY_REF_PATTERN, decodeEntityRef);
}

// ── XML Events (what generators yield) ──────────────────────────────

/**
 * @typedef {{ type: 'element-open', name: string, prefix: string, localName: string, attributes: Map<string, string> }} ElementOpenEvent
 * @typedef {{ type: 'element-close', name: string }} ElementCloseEvent
 * @typedef {{ type: 'element-self-close', name: string, prefix: string, localName: string, attributes: Map<string, string> }} ElementSelfCloseEvent
 * @typedef {{ type: 'text', value: string }} TextEvent
 * @typedef {{ type: 'cdata', value: string }} CDATAEvent
 * @typedef {{ type: 'comment', value: string }} CommentEvent
 * @typedef {{ type: 'pi', target: string, value: string }} PIEvent
 * @typedef {ElementOpenEvent | ElementCloseEvent | ElementSelfCloseEvent | TextEvent | CDATAEvent | CommentEvent | PIEvent} XMLEvent
 */

// ── Parser State ────────────────────────────────────────────────────

/**
 * @typedef {{
 *   source: string,
 *   position: number,
 *   contentMatcher: RegExp,
 *   tagMatcher: RegExp,
 *   tolerant: boolean,
 * }} ParserState
 */

/** @typedef {{ tolerant?: boolean }} ParseOptions */

/**
 * @param {string} source
 * @param {ParseOptions} [options]
 * @returns {ParserState}
 */
function createState(source, options) {
    return {
        source,
        position: 0,
        contentMatcher: new RegExp(CONTENT_PATTERN, 'gu'),
        tagMatcher: new RegExp(TAG_PATTERN, 'gu'),
        tolerant: options?.tolerant === true,
    };
}

// ── Error ───────────────────────────────────────────────────────────

class XMLParseError extends SyntaxError {
    /** @param {string} message @param {ParserState} state */
    constructor(message, state) {
        const pos = state.position;
        const near = state.source.slice(Math.max(0, pos - 30), Math.min(state.source.length, pos + 30));
        super(`${message} at position ${pos} (near: ${JSON.stringify(near)})`);
        this.position = pos;
    }
}

// ── Span Consumer ───────────────────────────────────────────────────

/**
 * @param {RegExp} spanRegex
 * @param {ParserState} state
 * @returns {{ content: string, fault: boolean }}
 */
function consumeSpan(spanRegex, state) {
    spanRegex.lastIndex = state.position;
    const match = spanRegex.exec(state.source);
    if (!match) {
        const content = state.source.slice(state.position);
        state.position = state.source.length;
        return { content, fault: true };
    }
    const content = state.source.slice(state.position, spanRegex.lastIndex);
    state.position = spanRegex.lastIndex;
    return { content, fault: match[1] !== undefined };
}

/**
 * @param {string} quote
 * @param {ParserState} state
 * @returns {string}
 */
function consumeAttributeValue(quote, state) {
    const spanRegex = quote === '"' ? DOUBLE_QUOTE_SPAN : SINGLE_QUOTE_SPAN;
    const { content, fault } = consumeSpan(spanRegex, state);
    if (!fault) state.position++; // skip closing quote
    return decodeEntities(content);
}

// ── Namespace Helpers ───────────────────────────────────────────────

/** @param {string} qname @returns {{ prefix: string, localName: string }} */
function splitQName(qname) {
    const colon = qname.indexOf(':');
    if (colon === -1) return { prefix: '', localName: qname };
    return { prefix: qname.slice(0, colon), localName: qname.slice(colon + 1) };
}

// ── Attribute Parser ────────────────────────────────────────────────

/**
 * Parse attributes from inside a tag. Returns the attributes map and
 * whether the tag is self-closing.
 *
 * @param {ParserState} state
 * @returns {{ attributes: Map<string, string>, selfClosing: boolean }}
 */
function parseAttributes(state) {
    /** @type {Map<string, string>} */
    const attributes = new Map();
    let selfClosing = false;
    let match;
    state.tagMatcher.lastIndex = state.position;

    while ((match = state.tagMatcher.exec(state.source)) !== null) {
        state.position = state.tagMatcher.lastIndex;

        if (match[TE.BREAK] !== undefined || match[TE.WHITESPACE] !== undefined) continue;

        if (match[TE.TAG_CLOSE] !== undefined) {
            selfClosing = match[TE.TAG_CLOSE] === '/>';
            return { attributes, selfClosing };
        }

        if (match[TE.NAME] !== undefined) {
            const attrName = match[TE.NAME];

            state.tagMatcher.lastIndex = state.position;
            const eqMatch = state.tagMatcher.exec(state.source);
            if (!eqMatch) {
                if (!state.tolerant) throw new XMLParseError(`Expected = after attribute ${attrName}`, state);
                return { attributes, selfClosing: false };
            }
            state.position = state.tagMatcher.lastIndex;

            if (eqMatch[TE.OPERATOR] === '=') {
                state.tagMatcher.lastIndex = state.position;
                const quoteMatch = state.tagMatcher.exec(state.source);
                if (!quoteMatch) {
                    if (!state.tolerant) throw new XMLParseError(`Expected quote after ${attrName}=`, state);
                    return { attributes, selfClosing: false };
                }
                state.position = state.tagMatcher.lastIndex;

                const quote = quoteMatch[TE.OPERATOR];
                if (quote === '"' || quote === "'") {
                    attributes.set(attrName, consumeAttributeValue(quote, state));
                    state.tagMatcher.lastIndex = state.position;
                } else if (!state.tolerant) {
                    throw new XMLParseError(`Expected quote after ${attrName}=`, state);
                }
            } else if (eqMatch[TE.TAG_CLOSE] !== undefined) {
                attributes.set(attrName, '');
                selfClosing = eqMatch[TE.TAG_CLOSE] === '/>';
                return { attributes, selfClosing };
            }
            continue;
        }

        if (!state.tolerant) throw new XMLParseError(`Unexpected token in tag: ${match[0]}`, state);
    }

    return { attributes, selfClosing };
}

/**
 * Consume tokens until > after a close tag.
 * @param {ParserState} state
 */
function consumeToTagClose(state) {
    state.tagMatcher.lastIndex = state.position;
    let match;
    while ((match = state.tagMatcher.exec(state.source)) !== null) {
        state.position = state.tagMatcher.lastIndex;
        if (match[TE.TAG_CLOSE] !== undefined) return;
        if (match[TE.BREAK] !== undefined || match[TE.WHITESPACE] !== undefined) continue;
    }
}

// ── Core Generator ──────────────────────────────────────────────────

/**
 * Generator that yields XML events from a complete source string.
 * Same role as `parseArrayElements` in the JSON parser.
 *
 * @param {string} source
 * @param {ParseOptions} [options]
 * @yields {XMLEvent}
 * @returns {Generator<XMLEvent, void, undefined>}
 */
export function* tokenize(source, options) {
    const state = createState(source, options);
    state.contentMatcher.lastIndex = 0;
    let match;

    while ((match = state.contentMatcher.exec(state.source)) !== null) {
        state.position = state.contentMatcher.lastIndex;

        if (match[CE.BREAK] !== undefined || match[CE.WHITESPACE] !== undefined) {
            yield { type: 'text', value: match[0] };
            continue;
        }

        if (match[CE.TAG_OPEN] !== undefined) {
            const tagText = match[CE.TAG_OPEN];
            const isClosing = tagText.startsWith('</');
            const qname = isClosing ? tagText.slice(2) : tagText.slice(1);

            if (isClosing) {
                consumeToTagClose(state);
                yield { type: 'element-close', name: qname };
            } else {
                const { prefix, localName } = splitQName(qname);
                const { attributes, selfClosing } = parseAttributes(state);
                if (selfClosing) {
                    yield { type: 'element-self-close', name: qname, prefix, localName, attributes };
                } else {
                    yield { type: 'element-open', name: qname, prefix, localName, attributes };
                }
            }
            state.contentMatcher.lastIndex = state.position;
            continue;
        }

        if (match[CE.COMMENT_OPEN] !== undefined) {
            const { content, fault } = consumeSpan(COMMENT_SPAN, state);
            if (!fault) state.position += 3; // skip -->
            yield { type: 'comment', value: content };
            state.contentMatcher.lastIndex = state.position;
            continue;
        }

        if (match[CE.CDATA_OPEN] !== undefined) {
            const { content, fault } = consumeSpan(CDATA_SPAN, state);
            if (!fault) state.position += 3; // skip ]]>
            yield { type: 'cdata', value: content };
            state.contentMatcher.lastIndex = state.position;
            continue;
        }

        if (match[CE.PI_OPEN] !== undefined) {
            const target = match[CE.PI_OPEN].slice(2);
            const { content, fault } = consumeSpan(PI_SPAN, state);
            if (!fault) state.position += 2; // skip ?>
            yield { type: 'pi', target, value: content.trim() };
            state.contentMatcher.lastIndex = state.position;
            continue;
        }

        if (match[CE.ENTITY_REF] !== undefined) {
            yield { type: 'text', value: decodeEntityRef(match[CE.ENTITY_REF]) };
            continue;
        }

        if (match[CE.TEXT] !== undefined) {
            yield { type: 'text', value: match[CE.TEXT] };
            continue;
        }

        if (match[CE.FALLTHROUGH] !== undefined) {
            yield { type: 'text', value: match[CE.FALLTHROUGH] };
            continue;
        }
    }
}

// ── Forward Scanner ─────────────────────────────────────────────────
// Tracks <...> depth and string context to determine when the
// accumulated line buffer contains complete elements at a clean
// boundary. Same concept as TokenMatcher.lookAhead.

/**
 * @typedef {{
 *   depth: number,
 *   inTag: boolean,
 *   inString: boolean,
 *   quoteChar: number,
 *   inComment: boolean,
 *   inCDATA: boolean,
 *   inPI: boolean,
 *   lastSignificant: number,
 * }} ForwardScannerState
 */

/** @returns {ForwardScannerState} */
function createForwardScanner() {
    return {
        depth: 0, inTag: false, inString: false, quoteChar: 0,
        inComment: false, inCDATA: false, inPI: false, lastSignificant: 0,
    };
}

/**
 * Advance the scanner through a line of text.
 * @param {ForwardScannerState} scanner
 * @param {string} line
 */
function scanForward(scanner, line) {
    for (let i = 0; i < line.length; i++) {
        const code = line.charCodeAt(i);

        // Inside string — look for closing quote
        if (scanner.inString) {
            if (code === scanner.quoteChar) scanner.inString = false;
            continue;
        }

        // Inside comment — look for -->
        if (scanner.inComment) {
            if (code === 0x2D && line.charCodeAt(i + 1) === 0x2D && line.charCodeAt(i + 2) === 0x3E) {
                scanner.inComment = false;
                i += 2;
            }
            continue;
        }

        // Inside CDATA — look for ]]>
        if (scanner.inCDATA) {
            if (code === 0x5D && line.charCodeAt(i + 1) === 0x5D && line.charCodeAt(i + 2) === 0x3E) {
                scanner.inCDATA = false;
                i += 2;
            }
            continue;
        }

        // Inside PI — look for ?>
        if (scanner.inPI) {
            if (code === 0x3F && line.charCodeAt(i + 1) === 0x3E) {
                scanner.inPI = false;
                i += 1;
            }
            continue;
        }

        // Inside tag — look for quotes or >
        if (scanner.inTag) {
            if (code === 0x22 || code === 0x27) { scanner.inString = true; scanner.quoteChar = code; continue; }
            if (code === 0x3E) { scanner.inTag = false; scanner.lastSignificant = code; continue; } // >
            continue;
        }

        // Normal content
        if (code <= 0x20) continue;
        scanner.lastSignificant = code;

        // < — check what follows
        if (code === 0x3C) {
            if (line.charCodeAt(i + 1) === 0x21) {
                if (line.charCodeAt(i + 2) === 0x2D && line.charCodeAt(i + 3) === 0x2D) {
                    scanner.inComment = true; i += 3; continue; // <!--
                }
                if (line.charCodeAt(i + 2) === 0x5B) {
                    scanner.inCDATA = true; i += 8; continue; // <![CDATA[
                }
            }
            if (line.charCodeAt(i + 1) === 0x3F) {
                scanner.inPI = true; i += 1; continue; // <?
            }
            // Opening or closing tag
            scanner.inTag = true;
            if (line.charCodeAt(i + 1) === 0x2F) { scanner.depth--; } // </
            else { scanner.depth++; }
            continue;
        }
    }
}

/**
 * Whether the scanner is at a clean context boundary.
 * @param {ForwardScannerState} scanner
 * @returns {boolean}
 */
function atContextBoundary(scanner) {
    return !scanner.inTag && !scanner.inString && !scanner.inComment &&
           !scanner.inCDATA && !scanner.inPI && scanner.depth <= 1;
}

// ── Chunk-Based Streaming ───────────────────────────────────────────

const CHUNK_THRESHOLD = 256 * 1024;

/**
 * @param {ParserState} state
 * @param {string[]} lineBuffer
 */
function flushBuffer(state, lineBuffer) {
    const chunk = lineBuffer.join('\n');
    if (state.position < state.source.length) {
        state.source = state.source.slice(state.position) + '\n' + chunk;
    } else {
        state.source = chunk;
    }
    state.position = 0;
    state.contentMatcher.lastIndex = 0;
}

/**
 * Drain complete events from the buffer.
 *
 * @param {ParserState} state
 * @yields {XMLEvent}
 * @returns {Generator<XMLEvent, boolean, undefined>}
 */
function* drainEvents(state) {
    state.contentMatcher.lastIndex = state.position;
    let match;

    while ((match = state.contentMatcher.exec(state.source)) !== null) {
        state.position = state.contentMatcher.lastIndex;

        if (match[CE.BREAK] !== undefined || match[CE.WHITESPACE] !== undefined) {
            yield { type: 'text', value: match[0] };
            continue;
        }

        if (match[CE.TAG_OPEN] !== undefined) {
            const tagText = match[CE.TAG_OPEN];
            const isClosing = tagText.startsWith('</');
            const qname = isClosing ? tagText.slice(2) : tagText.slice(1);

            if (isClosing) {
                consumeToTagClose(state);
                yield { type: 'element-close', name: qname };
            } else {
                const { prefix, localName } = splitQName(qname);
                const { attributes, selfClosing } = parseAttributes(state);
                if (selfClosing) {
                    yield { type: 'element-self-close', name: qname, prefix, localName, attributes };
                } else {
                    yield { type: 'element-open', name: qname, prefix, localName, attributes };
                }
            }
            state.contentMatcher.lastIndex = state.position;
            continue;
        }

        if (match[CE.COMMENT_OPEN] !== undefined) {
            const { content, fault } = consumeSpan(COMMENT_SPAN, state);
            if (!fault) state.position += 3;
            yield { type: 'comment', value: content };
            state.contentMatcher.lastIndex = state.position;
            continue;
        }

        if (match[CE.CDATA_OPEN] !== undefined) {
            const { content, fault } = consumeSpan(CDATA_SPAN, state);
            if (!fault) state.position += 3;
            yield { type: 'cdata', value: content };
            state.contentMatcher.lastIndex = state.position;
            continue;
        }

        if (match[CE.PI_OPEN] !== undefined) {
            const target = match[CE.PI_OPEN].slice(2);
            const { content, fault } = consumeSpan(PI_SPAN, state);
            if (!fault) state.position += 2;
            yield { type: 'pi', target, value: content.trim() };
            state.contentMatcher.lastIndex = state.position;
            continue;
        }

        if (match[CE.ENTITY_REF] !== undefined) {
            yield { type: 'text', value: decodeEntityRef(match[CE.ENTITY_REF]) };
            continue;
        }

        if (match[CE.TEXT] !== undefined) {
            yield { type: 'text', value: match[CE.TEXT] };
            continue;
        }

        if (match[CE.FALLTHROUGH] !== undefined) {
            yield { type: 'text', value: match[CE.FALLTHROUGH] };
            continue;
        }
    }

    return false;
}

/**
 * Streaming generator — yields XML events from lines (sync iterable).
 * Same role as `parseFrom` in the JSON parser.
 *
 * @param {{ [Symbol.iterator](): Iterator<string> }} lines
 * @param {ParseOptions} [options]
 * @yields {XMLEvent}
 * @returns {Generator<XMLEvent, void, undefined>}
 */
export function* tokenizeFrom(lines, options) {
    const state = createState('', options);
    const scanner = createForwardScanner();
    /** @type {string[]} */
    const lineBuffer = [];
    let lineBufferSize = 0;

    for (const line of lines) {
        lineBuffer.push(line);
        lineBufferSize += line.length + 1;
        scanForward(scanner, line);

        if (lineBufferSize < CHUNK_THRESHOLD || !atContextBoundary(scanner)) continue;

        flushBuffer(state, lineBuffer);
        lineBuffer.length = 0;
        lineBufferSize = 0;

        yield* drainEvents(state);
    }

    if (lineBuffer.length > 0) flushBuffer(state, lineBuffer);
    yield* drainEvents(state);
}

/**
 * Async streaming generator — yields XML events from async lines.
 * Same role as `parseFromAsync` in the JSON parser.
 * Composes with ReadableStream, DecompressionStream, etc.
 *
 * @param {{ [Symbol.asyncIterator](): AsyncIterator<string> }} lines
 * @param {ParseOptions} [options]
 * @yields {XMLEvent}
 * @returns {AsyncGenerator<XMLEvent, void, undefined>}
 */
export async function* tokenizeFromAsync(lines, options) {
    const state = createState('', options);
    const scanner = createForwardScanner();
    /** @type {string[]} */
    const lineBuffer = [];
    let lineBufferSize = 0;

    for await (const line of lines) {
        lineBuffer.push(line);
        lineBufferSize += line.length + 1;
        scanForward(scanner, line);

        if (lineBufferSize < CHUNK_THRESHOLD || !atContextBoundary(scanner)) continue;

        flushBuffer(state, lineBuffer);
        lineBuffer.length = 0;
        lineBufferSize = 0;

        yield* drainEvents(state);
    }

    if (lineBuffer.length > 0) flushBuffer(state, lineBuffer);
    yield* drainEvents(state);
}

// ── Tree Builder (event consumer) ───────────────────────────────────
// Collects events from the tokenizer into an XMLDocument tree.
// This is a consumer of the generator, not part of the parser core.

/**
 * @typedef {{
 *   type: 'element', name: string, prefix: string, localName: string,
 *   attributes: Map<string, string>, namespaces: Map<string, string>,
 *   children: XMLNode[], parent: XMLElement | null,
 * }} XMLElement
 * @typedef {{ type: 'text', value: string }} XMLText
 * @typedef {{ type: 'cdata', value: string }} XMLCDATA
 * @typedef {{ type: 'comment', value: string }} XMLComment
 * @typedef {{ type: 'pi', target: string, value: string }} XMLPI
 * @typedef {XMLElement | XMLText | XMLCDATA | XMLComment | XMLPI} XMLNode
 * @typedef {{ type: 'document', children: XMLNode[], xmlDeclaration: XMLPI | null }} XMLDocument
 */

/**
 * Build an XMLDocument tree from an event iterable.
 *
 * @param {Iterable<XMLEvent>} events
 * @returns {XMLDocument}
 */
export function collectTree(events) {
    /** @type {XMLDocument} */
    const doc = { type: 'document', children: [], xmlDeclaration: null };
    /** @type {XMLElement | null} */
    let current = null;

    for (const event of events) {
        switch (event.type) {
            case 'element-open': {
                const { prefix, localName } = event;
                /** @type {XMLElement} */
                const element = {
                    type: 'element', name: event.name, prefix, localName,
                    attributes: event.attributes, namespaces: new Map(),
                    children: [], parent: current,
                };
                // Extract xmlns declarations
                for (const [k, v] of element.attributes) {
                    if (k === 'xmlns') element.namespaces.set('', v);
                    else if (k.startsWith('xmlns:')) element.namespaces.set(k.slice(6), v);
                }
                if (current) current.children.push(element);
                else doc.children.push(element);
                current = element;
                break;
            }
            case 'element-self-close': {
                const { prefix, localName } = event;
                /** @type {XMLElement} */
                const element = {
                    type: 'element', name: event.name, prefix, localName,
                    attributes: event.attributes, namespaces: new Map(),
                    children: [], parent: current,
                };
                for (const [k, v] of element.attributes) {
                    if (k === 'xmlns') element.namespaces.set('', v);
                    else if (k.startsWith('xmlns:')) element.namespaces.set(k.slice(6), v);
                }
                if (current) current.children.push(element);
                else doc.children.push(element);
                break;
            }
            case 'element-close': {
                if (current) current = current.parent;
                break;
            }
            case 'text': {
                const target = current ? current.children : doc.children;
                const last = target[target.length - 1];
                if (last && last.type === 'text') last.value += event.value;
                else target.push({ type: 'text', value: event.value });
                break;
            }
            case 'cdata': {
                const target = current ? current.children : doc.children;
                target.push({ type: 'cdata', value: event.value });
                break;
            }
            case 'comment': {
                const target = current ? current.children : doc.children;
                target.push({ type: 'comment', value: event.value });
                break;
            }
            case 'pi': {
                /** @type {XMLPI} */
                const pi = { type: 'pi', target: event.target, value: event.value };
                if (event.target === 'xml' && !doc.xmlDeclaration) doc.xmlDeclaration = pi;
                const target = current ? current.children : doc.children;
                target.push(pi);
                break;
            }
        }
    }

    return doc;
}

/**
 * Parse XML source into an XMLDocument tree (convenience).
 * Equivalent to `collectTree(tokenize(source, options))`.
 *
 * @param {string} source
 * @param {ParseOptions} [options]
 * @returns {XMLDocument}
 */
export function parseXML(source, options) {
    return collectTree(tokenize(source, options));
}

// ── Serializer ──────────────────────────────────────────────────────

/** @param {XMLDocument} document @returns {string} */
export function serializeXML(document) {
    return document.children.map(serializeNode).join('');
}

/** @param {XMLNode} node @returns {string} */
function serializeNode(node) {
    switch (node.type) {
        case 'element': return serializeElement(node);
        case 'text': return escapeText(node.value);
        case 'cdata': return `<![CDATA[${node.value}]]>`;
        case 'comment': return `<!--${node.value}-->`;
        case 'pi': return `<?${node.target} ${node.value}?>`;
    }
}

/** @param {XMLElement} el @returns {string} */
function serializeElement(el) {
    let tag = `<${el.name}`;
    for (const [name, value] of el.attributes) tag += ` ${name}="${escapeAttribute(value)}"`;
    if (el.children.length === 0) return `${tag}/>`;
    tag += '>';
    for (const child of el.children) tag += serializeNode(child);
    return `${tag}</${el.name}>`;
}

/** @param {string} text @returns {string} */
function escapeText(text) {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** @param {string} value @returns {string} */
function escapeAttribute(value) {
    return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Query / Mutation Helpers ────────────────────────────────────────

/** @param {string} prefix @param {XMLElement | null} el @returns {string | undefined} */
function resolveNamespace(prefix, el) {
    while (el) {
        const uri = el.namespaces.get(prefix);
        if (uri !== undefined) return uri;
        el = el.parent;
    }
    return undefined;
}

/**
 * @param {XMLElement | XMLDocument} root
 * @param {string} namespaceURI
 * @param {string} localName
 * @returns {XMLElement | null}
 */
export function findElementNS(root, namespaceURI, localName) {
    for (const child of root.children) {
        if (child.type !== 'element') continue;
        if (child.localName === localName) {
            const ns = resolveNamespace(child.prefix, child) ?? resolveNamespace(child.prefix, child.parent);
            if (ns === namespaceURI || (!ns && !namespaceURI)) return child;
        }
        const found = findElementNS(child, namespaceURI, localName);
        if (found) return found;
    }
    return null;
}

/**
 * @param {XMLElement | XMLDocument} root
 * @param {string} namespaceURI
 * @param {string} localName
 * @returns {XMLElement[]}
 */
export function findAllElementsNS(root, namespaceURI, localName) {
    /** @type {XMLElement[]} */
    const results = [];
    for (const child of root.children) {
        if (child.type !== 'element') continue;
        if (child.localName === localName) {
            const ns = resolveNamespace(child.prefix, child) ?? resolveNamespace(child.prefix, child.parent);
            if (ns === namespaceURI || (!ns && !namespaceURI)) results.push(child);
        }
        results.push(...findAllElementsNS(child, namespaceURI, localName));
    }
    return results;
}

/** @param {XMLElement} el @returns {string} */
export function getTextContent(el) {
    let text = '';
    for (const child of el.children) {
        if (child.type === 'text') text += child.value;
        else if (child.type === 'cdata') text += child.value;
        else if (child.type === 'element') text += getTextContent(child);
    }
    return text;
}

/** @param {XMLElement} el @param {string} text */
export function setTextContent(el, text) {
    el.children.length = 0;
    el.children.push({ type: 'text', value: text });
}

/**
 * @param {XMLElement} parent
 * @param {string} qualifiedName
 * @param {string} [namespaceURI]
 * @param {string} [textContent]
 * @returns {XMLElement}
 */
export function createElement(parent, qualifiedName, namespaceURI, textContent) {
    const { prefix, localName } = splitQName(qualifiedName);
    /** @type {XMLElement} */
    const element = {
        type: 'element', name: qualifiedName, prefix, localName,
        attributes: new Map(), namespaces: new Map(),
        children: [], parent,
    };
    if (namespaceURI && prefix && !resolveNamespace(prefix, parent)) {
        element.namespaces.set(prefix, namespaceURI);
        element.attributes.set(`xmlns:${prefix}`, namespaceURI);
    }
    if (textContent !== undefined) element.children.push({ type: 'text', value: textContent });
    parent.children.push(element);
    return element;
}
