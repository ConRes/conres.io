// @ts-check
/**
 * PDF Content Stream Interpreter (Layer 2) Tests
 *
 * Tests for graphics state tracking, colorSpaceName resolution,
 * q/Q state stack, and the collectOperations/collectAnalysis consumers.
 *
 * @module pdf-content-stream-interpreter.test
 */

import { test, describe } from 'node:test';
import assert from 'node:assert';
import { tokenize } from '../../classes/baseline/pdf-content-stream-parser.js';
import {
    createInterpreter,
    interpretGraphicsState,
    collectOperations,
    collectAnalysis,
} from '../../classes/baseline/pdf-content-stream-interpreter.js';

// ============================================================================
// Helpers
// ============================================================================

/**
 * Parse and interpret a content stream, return enriched operator events.
 * @param {string} source
 * @param {import('../../classes/baseline/pdf-content-stream-interpreter.js').ColorSpaceState} [initialState]
 */
function interpretOperators(source, initialState) {
    const raw = tokenize(source);
    return [...interpretGraphicsState(raw, initialState)]
        .filter(e => e.type === 'operator');
}

/**
 * Parse and interpret, return operations + finalState.
 * @param {string} source
 * @param {import('../../classes/baseline/pdf-content-stream-interpreter.js').ColorSpaceState} [initialState]
 */
function parseOperations(source, initialState) {
    return collectOperations(tokenize(source), initialState);
}

// ============================================================================
// Tests
// ============================================================================

describe('pdf-content-stream-interpreter', () => {

    // ========================================
    // Color Space Resolution
    // ========================================

    describe('colorSpaceName resolution', () => {
        test('setColor after cs resolves to the named color space', () => {
            const ops = interpretOperators('/CS0 cs 0.5 0.3 0.2 scn');
            const setColorOp = ops.find(o => o.operation === 'setColor');
            assert.ok(setColorOp);
            assert.strictEqual(/** @type {any} */ (setColorOp).colorSpaceName, 'CS0');
        });

        test('setColor after CS resolves to stroke color space', () => {
            const ops = interpretOperators('/CS1 CS 0.8 SC');
            const setColorOp = ops.find(o => o.operation === 'setColor');
            assert.ok(setColorOp);
            assert.strictEqual(/** @type {any} */ (setColorOp).colorSpaceName, 'CS1');
        });

        test('stroke and fill track independently', () => {
            const ops = interpretOperators('/CS0 CS /CS1 cs 0.5 SC 0.3 scn');
            const setColors = ops.filter(o => o.operation === 'setColor');
            assert.strictEqual(setColors.length, 2);
            // SC (stroke) → CS0
            assert.strictEqual(/** @type {any} */ (setColors[0]).colorSpaceName, 'CS0');
            // scn (fill) → CS1
            assert.strictEqual(/** @type {any} */ (setColors[1]).colorSpaceName, 'CS1');
        });

        test('setColor without prior cs has undefined colorSpaceName', () => {
            const ops = interpretOperators('0.5 scn');
            const setColorOp = ops.find(o => o.operation === 'setColor');
            assert.ok(setColorOp);
            assert.strictEqual(/** @type {any} */ (setColorOp).colorSpaceName, undefined);
        });
    });

    // ========================================
    // Implicit Device Color Space Changes
    // ========================================

    describe('implicit Device color space from shortcuts', () => {
        test('g sets fill to DeviceGray', () => {
            const { finalState } = parseOperations('0.5 g');
            assert.strictEqual(finalState.fillColorSpace, 'DeviceGray');
        });

        test('G sets stroke to DeviceGray', () => {
            const { finalState } = parseOperations('0.5 G');
            assert.strictEqual(finalState.strokeColorSpace, 'DeviceGray');
        });

        test('rg sets fill to DeviceRGB', () => {
            const { finalState } = parseOperations('1 0 0 rg');
            assert.strictEqual(finalState.fillColorSpace, 'DeviceRGB');
        });

        test('RG sets stroke to DeviceRGB', () => {
            const { finalState } = parseOperations('1 0 0 RG');
            assert.strictEqual(finalState.strokeColorSpace, 'DeviceRGB');
        });

        test('k sets fill to DeviceCMYK', () => {
            const { finalState } = parseOperations('0 0 0 1 k');
            assert.strictEqual(finalState.fillColorSpace, 'DeviceCMYK');
        });

        test('K sets stroke to DeviceCMYK', () => {
            const { finalState } = parseOperations('0 0 0 1 K');
            assert.strictEqual(finalState.strokeColorSpace, 'DeviceCMYK');
        });

        test('setColor after Device shortcut resolves to Device color space', () => {
            // After g sets fill to DeviceGray, scn should resolve to DeviceGray
            const ops = interpretOperators('0.5 g 0.7 scn');
            const setColorOp = ops.find(o => o.operation === 'setColor');
            assert.ok(setColorOp);
            assert.strictEqual(/** @type {any} */ (setColorOp).colorSpaceName, 'DeviceGray');
        });
    });

    // ========================================
    // Graphics State Stack (q/Q)
    // ========================================

    describe('q/Q graphics state stack', () => {
        test('Q restores color space after CS inside q...Q', () => {
            const ops = interpretOperators('/CS0 cs q /CS1 cs Q 0.5 scn');
            const setColorOp = ops.find(o => o.operation === 'setColor');
            assert.ok(setColorOp);
            // After Q, fill should be CS0 (restored), not CS1
            assert.strictEqual(/** @type {any} */ (setColorOp).colorSpaceName, 'CS0');
        });

        test('Q restores color space after Device shortcut inside q...Q', () => {
            const ops = interpretOperators('/CS0 cs q 0.5 g Q 0.3 scn');
            const setColorOp = ops.find(o => o.operation === 'setColor');
            assert.ok(setColorOp);
            // After Q, fill should be CS0 (restored), not DeviceGray
            assert.strictEqual(/** @type {any} */ (setColorOp).colorSpaceName, 'CS0');
        });

        test('nested q...q...Q...Q maintains correct depth', () => {
            const ops = interpretOperators('/CS0 cs q /CS1 cs q /CS2 cs Q 0.5 scn Q 0.3 scn');
            const setColors = ops.filter(o => o.operation === 'setColor');
            assert.strictEqual(setColors.length, 2);
            // After inner Q: restored to CS1
            assert.strictEqual(/** @type {any} */ (setColors[0]).colorSpaceName, 'CS1');
            // After outer Q: restored to CS0
            assert.strictEqual(/** @type {any} */ (setColors[1]).colorSpaceName, 'CS0');
        });

        test('Q without matching q does not crash', () => {
            // Unbalanced Q — should not throw
            const ops = interpretOperators('Q 0.5 g');
            assert.strictEqual(ops.length, 2);
            assert.strictEqual(ops[0].operation, 'restoreState');
            assert.strictEqual(ops[1].operation, 'setGray');
        });

        test('saveState/restoreState events are yielded', () => {
            const ops = interpretOperators('q Q');
            assert.strictEqual(ops.length, 2);
            assert.strictEqual(ops[0].operation, 'saveState');
            assert.strictEqual(ops[1].operation, 'restoreState');
        });
    });

    // ========================================
    // Cross-Stream Continuity
    // ========================================

    describe('cross-stream finalState continuity', () => {
        test('finalState reflects last color space', () => {
            const { finalState } = parseOperations('/CS0 cs /CS1 CS');
            assert.strictEqual(finalState.fillColorSpace, 'CS0');
            assert.strictEqual(finalState.strokeColorSpace, 'CS1');
        });

        test('initialState carries over to second stream', () => {
            const { finalState: state1 } = parseOperations('/CS0 cs 0.5 scn');
            // Second stream uses carry-over state
            const ops = interpretOperators('0.8 scn', state1);
            const setColorOp = ops.find(o => o.operation === 'setColor');
            assert.ok(setColorOp);
            assert.strictEqual(/** @type {any} */ (setColorOp).colorSpaceName, 'CS0');
        });

        test('Device shortcut updates finalState', () => {
            const { finalState } = parseOperations('0.5 g 1 0 0 RG');
            assert.strictEqual(finalState.fillColorSpace, 'DeviceGray');
            assert.strictEqual(finalState.strokeColorSpace, 'DeviceRGB');
        });
    });

    // ========================================
    // collectOperations (Shape B)
    // ========================================

    describe('collectOperations', () => {
        test('returns operations array with operator events only', () => {
            const { operations } = parseOperations('0.5 g 100 100 re f');
            // Only the gray operator, not content events
            assert.strictEqual(operations.length, 1);
            assert.strictEqual(operations[0].operation, 'setGray');
        });

        test('operations include all fields', () => {
            const { operations } = parseOperations('/CS0 cs 0.5 scn');
            assert.strictEqual(operations.length, 2);
            const setColor = operations[1];
            assert.strictEqual(setColor.operation, 'setColor');
            assert.strictEqual(setColor.type, 'operator');
            assert.strictEqual(typeof setColor.offset, 'number');
            assert.strictEqual(typeof setColor.length, 'number');
            assert.strictEqual(/** @type {any} */ (setColor).colorSpaceName, 'CS0');
        });

        test('finalState is returned', () => {
            const { finalState } = parseOperations('/CS0 cs');
            assert.strictEqual(finalState.fillColorSpace, 'CS0');
        });
    });

    // ========================================
    // collectAnalysis (Shape A)
    // ========================================

    describe('collectAnalysis', () => {
        test('counts operations by type', () => {
            const { operationCounts } = collectAnalysis(
                tokenize('0.5 g 1 0 0 rg 0 0 0 1 k /CS0 cs 0.3 scn q Q'),
            );
            assert.strictEqual(operationCounts.gray, 1);
            assert.strictEqual(operationCounts.rgb, 1);
            assert.strictEqual(operationCounts.cmyk, 1);
            assert.strictEqual(operationCounts.setColorSpace, 1);
            assert.strictEqual(operationCounts.setColor, 1);
            assert.strictEqual(operationCounts.saveState, 1);
            assert.strictEqual(operationCounts.restoreState, 1);
        });

        test('tracks color space usage', () => {
            const { colorSpaces } = collectAnalysis(
                tokenize('/CS0 cs 0.5 scn 0.3 scn /CS1 cs 0.2 scn'),
            );
            assert.strictEqual(colorSpaces.length, 2);
            const cs0 = colorSpaces.find(cs => cs.name === 'CS0');
            const cs1 = colorSpaces.find(cs => cs.name === 'CS1');
            assert.ok(cs0);
            assert.ok(cs1);
            assert.strictEqual(cs0.setColorCount, 2);
            assert.strictEqual(cs1.setColorCount, 1);
        });
    });
});
