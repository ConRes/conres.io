// @ts-check
/**
 * PDF Content Stream Parser (Tokenizer) Tests
 *
 * Tests for the Layer 1 tokenizer — pure lexer, no semantic state.
 *
 * @module pdf-content-stream-parser.test
 */

import { test, describe } from 'node:test';
import assert from 'node:assert';
import { tokenize, tokenizeFrom } from '../../classes/baseline/pdf-content-stream-parser.js';

// ============================================================================
// Helper
// ============================================================================

/**
 * Collects all events from the tokenizer into an array.
 * @param {string} source
 * @returns {import('../../classes/baseline/pdf-content-stream-parser.js').ContentStreamEvent[]}
 */
function parseAll(source) {
    return [...tokenize(source)];
}

/**
 * Filters operator events only.
 * @param {import('../../classes/baseline/pdf-content-stream-parser.js').ContentStreamEvent[]} events
 */
function operatorsOnly(events) {
    return events.filter(e => e.type === 'operator');
}

// ============================================================================
// Operator Parsing Tests
// ============================================================================

describe('pdf-content-stream-parser', () => {

    describe('setGray', () => {
        test('parses fill gray (g)', () => {
            const ops = operatorsOnly(parseAll('0.5 g'));
            assert.strictEqual(ops.length, 1);
            assert.strictEqual(ops[0].operation, 'setGray');
            assert.strictEqual(ops[0].operator, 'g');
            assert.strictEqual(ops[0].isStroke, false);
            assert.strictEqual(/** @type {any} */ (ops[0]).value, 0.5);
        });

        test('parses stroke gray (G)', () => {
            const ops = operatorsOnly(parseAll('0.75 G'));
            assert.strictEqual(ops.length, 1);
            assert.strictEqual(ops[0].operation, 'setGray');
            assert.strictEqual(ops[0].operator, 'G');
            assert.strictEqual(ops[0].isStroke, true);
            assert.strictEqual(/** @type {any} */ (ops[0]).value, 0.75);
        });

        test('parses zero and one', () => {
            const ops = operatorsOnly(parseAll('0 g 1 G'));
            assert.strictEqual(ops.length, 2);
            assert.strictEqual(/** @type {any} */ (ops[0]).value, 0);
            assert.strictEqual(/** @type {any} */ (ops[1]).value, 1);
        });

        test('parses leading-dot decimal (.95)', () => {
            const ops = operatorsOnly(parseAll('.95 g'));
            assert.strictEqual(ops.length, 1);
            assert.strictEqual(/** @type {any} */ (ops[0]).value, 0.95);
        });
    });

    describe('setRGB', () => {
        test('parses fill RGB (rg)', () => {
            const ops = operatorsOnly(parseAll('1 0 0 rg'));
            assert.strictEqual(ops.length, 1);
            assert.strictEqual(ops[0].operation, 'setRGB');
            assert.strictEqual(ops[0].operator, 'rg');
            assert.strictEqual(ops[0].isStroke, false);
            assert.deepStrictEqual(/** @type {any} */ (ops[0]).values, [1, 0, 0]);
        });

        test('parses stroke RGB (RG)', () => {
            const ops = operatorsOnly(parseAll('0.2 0.4 0.6 RG'));
            assert.strictEqual(ops.length, 1);
            assert.strictEqual(ops[0].operator, 'RG');
            assert.strictEqual(ops[0].isStroke, true);
        });

        test('parses leading-dot decimals', () => {
            const ops = operatorsOnly(parseAll('.5 .3 .25 rg'));
            assert.strictEqual(ops.length, 1);
            assert.deepStrictEqual(/** @type {any} */ (ops[0]).values, [0.5, 0.3, 0.25]);
        });
    });

    describe('setCMYK', () => {
        test('parses fill CMYK (k)', () => {
            const ops = operatorsOnly(parseAll('0 0 0 1 k'));
            assert.strictEqual(ops.length, 1);
            assert.strictEqual(ops[0].operation, 'setCMYK');
            assert.strictEqual(ops[0].operator, 'k');
            assert.strictEqual(ops[0].isStroke, false);
            assert.deepStrictEqual(/** @type {any} */ (ops[0]).values, [0, 0, 0, 1]);
        });

        test('parses stroke CMYK (K)', () => {
            const ops = operatorsOnly(parseAll('0.2 0.3 0.4 0.5 K'));
            assert.strictEqual(ops.length, 1);
            assert.strictEqual(ops[0].operator, 'K');
            assert.strictEqual(ops[0].isStroke, true);
        });
    });

    describe('setColorSpace', () => {
        test('parses fill color space (cs)', () => {
            const ops = operatorsOnly(parseAll('/CS0 cs'));
            assert.strictEqual(ops.length, 1);
            assert.strictEqual(ops[0].operation, 'setColorSpace');
            assert.strictEqual(ops[0].operator, 'cs');
            assert.strictEqual(ops[0].isStroke, false);
            assert.strictEqual(/** @type {any} */ (ops[0]).name, 'CS0');
        });

        test('parses stroke color space (CS)', () => {
            const ops = operatorsOnly(parseAll('/CS1 CS'));
            assert.strictEqual(ops.length, 1);
            assert.strictEqual(ops[0].operator, 'CS');
            assert.strictEqual(ops[0].isStroke, true);
            assert.strictEqual(/** @type {any} */ (ops[0]).name, 'CS1');
        });

        test('parses name-only SCN/scn as setColorSpace', () => {
            const ops = operatorsOnly(parseAll('/MyPattern SCN'));
            assert.strictEqual(ops.length, 1);
            assert.strictEqual(ops[0].operation, 'setColorSpace');
            assert.strictEqual(ops[0].operator, 'SCN');
            assert.strictEqual(/** @type {any} */ (ops[0]).name, 'MyPattern');
        });

        test('strips leading slash from name', () => {
            const ops = operatorsOnly(parseAll('/CS0 cs'));
            assert.strictEqual(/** @type {any} */ (ops[0]).name, 'CS0');
        });
    });

    describe('setColor', () => {
        test('parses numeric scn', () => {
            const ops = operatorsOnly(parseAll('0.5 0.3 0.2 scn'));
            assert.strictEqual(ops.length, 1);
            assert.strictEqual(ops[0].operation, 'setColor');
            assert.strictEqual(ops[0].operator, 'scn');
            assert.strictEqual(ops[0].isStroke, false);
            assert.deepStrictEqual(/** @type {any} */ (ops[0]).values, [0.5, 0.3, 0.2]);
        });

        test('parses numeric SC (stroke)', () => {
            const ops = operatorsOnly(parseAll('0.8 SC'));
            assert.strictEqual(ops.length, 1);
            assert.strictEqual(ops[0].operator, 'SC');
            assert.strictEqual(ops[0].isStroke, true);
            assert.deepStrictEqual(/** @type {any} */ (ops[0]).values, [0.8]);
        });

        test('does NOT carry colorSpaceName (Layer 1 has no state)', () => {
            const ops = operatorsOnly(parseAll('/CS0 cs 0.5 scn'));
            const setColorOp = ops.find(o => o.operation === 'setColor');
            assert.ok(setColorOp);
            assert.strictEqual(/** @type {any} */ (setColorOp).colorSpaceName, undefined);
        });
    });

    describe('saveState / restoreState', () => {
        test('parses q as saveState', () => {
            const ops = operatorsOnly(parseAll('q'));
            assert.strictEqual(ops.length, 1);
            assert.strictEqual(ops[0].operation, 'saveState');
            assert.strictEqual(ops[0].operator, 'q');
        });

        test('parses Q as restoreState', () => {
            const ops = operatorsOnly(parseAll('Q'));
            assert.strictEqual(ops.length, 1);
            assert.strictEqual(ops[0].operation, 'restoreState');
            assert.strictEqual(ops[0].operator, 'Q');
        });

        test('parses q/Q in context with other operators', () => {
            const ops = operatorsOnly(parseAll('q 0.5 g Q'));
            assert.strictEqual(ops.length, 3);
            assert.strictEqual(ops[0].operation, 'saveState');
            assert.strictEqual(ops[1].operation, 'setGray');
            assert.strictEqual(ops[2].operation, 'restoreState');
        });
    });

    // ========================================
    // String Literal Span Tests
    // ========================================

    describe('string literal handling', () => {
        test('simple string does not produce operator events', () => {
            const ops = operatorsOnly(parseAll('(hello) Tj'));
            assert.strictEqual(ops.length, 0);
        });

        test('string containing operator-like content is not parsed', () => {
            const events = parseAll('(1 0 0 rg) Tj 0.5 g');
            const ops = operatorsOnly(events);
            assert.strictEqual(ops.length, 1);
            assert.strictEqual(ops[0].operation, 'setGray');
        });

        test('balanced nested parentheses consumed correctly', () => {
            const events = parseAll('(text (inner) text) Tj 0.5 g');
            const ops = operatorsOnly(events);
            assert.strictEqual(ops.length, 1);
            assert.strictEqual(ops[0].operation, 'setGray');
        });

        test('escaped parentheses consumed correctly', () => {
            const events = parseAll('(escaped \\( and \\) parens) Tj 0.5 g');
            const ops = operatorsOnly(events);
            assert.strictEqual(ops.length, 1);
            assert.strictEqual(ops[0].operation, 'setGray');
        });

        test('nested balanced + escaped combined', () => {
            const events = parseAll('(outer (inner \\) still inner) end) Tj 0.5 g');
            const ops = operatorsOnly(events);
            assert.strictEqual(ops.length, 1);
            assert.strictEqual(ops[0].operation, 'setGray');
        });

        test('escaped backslash before paren', () => {
            // \\) means escaped-backslash then close-paren (closes the string)
            const events = parseAll('(text\\\\) Tj 0.5 g');
            const ops = operatorsOnly(events);
            assert.strictEqual(ops.length, 1);
            assert.strictEqual(ops[0].operation, 'setGray');
        });
    });

    // ========================================
    // Content Events
    // ========================================

    describe('content events', () => {
        test('non-operator content yields content events', () => {
            const events = parseAll('100 100 50 50 re f');
            const contentEvents = events.filter(e => e.type === 'content');
            assert.ok(contentEvents.length > 0);
        });

        test('content events carry offset and length', () => {
            const events = parseAll('100 100 re');
            for (const event of events) {
                assert.strictEqual(typeof event.offset, 'number');
                assert.strictEqual(typeof event.length, 'number');
                assert.ok(event.length > 0);
            }
        });

        test('no events carry raw substring property', () => {
            const events = parseAll('0.5 g 100 100 re f');
            for (const event of events) {
                assert.strictEqual(/** @type {any} */ (event).raw, undefined,
                    `Event type=${event.type} should not have raw property`);
            }
        });
    });

    // ========================================
    // Mixed Content Tests
    // ========================================

    describe('mixed content', () => {
        test('mixed stream with all operator types', () => {
            const source = '0.5 G 1 0 0 rg (text) Tj 0 0 0 1 k /CS0 cs 0.3 0.4 0.5 scn q Q';
            const ops = operatorsOnly(parseAll(source));
            assert.strictEqual(ops.length, 7);
            assert.strictEqual(ops[0].operation, 'setGray');
            assert.strictEqual(ops[1].operation, 'setRGB');
            assert.strictEqual(ops[2].operation, 'setCMYK');
            assert.strictEqual(ops[3].operation, 'setColorSpace');
            assert.strictEqual(ops[4].operation, 'setColor');
            assert.strictEqual(ops[5].operation, 'saveState');
            assert.strictEqual(ops[6].operation, 'restoreState');
        });

        test('operator events carry correct offset and length', () => {
            const source = '0.5 g';
            const ops = operatorsOnly(parseAll(source));
            assert.strictEqual(ops.length, 1);
            assert.strictEqual(ops[0].offset, 0);
            assert.strictEqual(ops[0].length, source.length);
        });

        test('multiple operators preserve order', () => {
            const ops = operatorsOnly(parseAll('1 0 0 RG 0 1 0 rg'));
            assert.strictEqual(ops.length, 2);
            assert.strictEqual(ops[0].operator, 'RG');
            assert.strictEqual(ops[1].operator, 'rg');
            assert.ok(ops[0].offset < ops[1].offset);
        });
    });

    // ========================================
    // Streaming Tests
    // ========================================

    describe('tokenizeFrom (streaming)', () => {
        test('produces identical events to tokenize for simple input', () => {
            const source = '0.5 g 1 0 0 rg /CS0 cs 0.3 scn q Q';
            const fromString = [...tokenize(source)];
            const fromChunks = [...tokenizeFrom([source])];
            assert.strictEqual(fromChunks.length, fromString.length);
            for (let i = 0; i < fromString.length; i++) {
                assert.strictEqual(fromChunks[i].type, fromString[i].type);
                if (fromChunks[i].type === 'operator' && fromString[i].type === 'operator') {
                    assert.strictEqual(
                        /** @type {any} */ (fromChunks[i]).operation,
                        /** @type {any} */ (fromString[i]).operation,
                    );
                }
            }
        });

        test('produces identical operator events when split across chunks', () => {
            const source = '0.5 g 1 0 0 rg 0 0 0 1 k';
            // Split at operator boundaries
            const chunks = ['0.5 g ', '1 0 0 rg ', '0 0 0 1 k'];
            const fromString = operatorsOnly([...tokenize(source)]);
            const fromChunks = operatorsOnly([...tokenizeFrom(chunks)]);
            assert.strictEqual(fromChunks.length, fromString.length);
            for (let i = 0; i < fromString.length; i++) {
                assert.strictEqual(
                    /** @type {any} */ (fromChunks[i]).operation,
                    /** @type {any} */ (fromString[i]).operation,
                );
            }
        });

        test('handles string literal spanning chunks', () => {
            // The string (hello world) spans two chunks but ForwardScanner
            // should buffer until the string closes
            const chunks = ['(hello ', 'world) Tj 0.5 g'];
            const ops = operatorsOnly([...tokenizeFrom(chunks)]);
            // Should find the gray operator after the string
            assert.strictEqual(ops.length, 1);
            assert.strictEqual(ops[0].operation, 'setGray');
        });
    });
});
