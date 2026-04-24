// @ts-check
/**
 * Engine parameters API — contract tests.
 *
 * The parameter bag is intentionally empty in the 2026-04-20 drop-in.
 * These tests lock the JS-side surface in
 * `packages/color-engine/src/index.js` so future parameters can be
 * added without changing the API contract:
 *
 *   - `engine.getParameters()`          → fresh object, default-valued.
 *   - `engine.setParameters(null)`      → reset all parameters to defaults.
 *   - `engine.setParameters(undefined)` → no-op.
 *   - `engine.setParameters({})`        → no-op.
 *   - `engine.setParameters(partial)`   → merge-set (field-by-field validated).
 *
 * Per-engine-instance isolation is still exercised so regressions in
 * the WASM-state plumbing surface early.
 *
 * @author Saleh Abdel Motaal <dev@smotaal.io>
 * @ai Claude Opus 4.6 (code generation)
 */

import { describe, it, expect, beforeAll } from 'vitest';

import * as LittleCMS from '../src/index.js';

describe('ColorEngine parameters', () => {
    /** @type {Awaited<ReturnType<typeof LittleCMS.createEngine>>} */
    let engine;

    beforeAll(async () => {
        engine = await LittleCMS.createEngine();
    });

    describe('empty-bag defaults', () => {
        it('fresh engine returns an empty parameters object', () => {
            engine.setParameters(null);
            expect(engine.getParameters()).toEqual({});
        });

        it('getParameters returns a fresh object on each call', () => {
            const a = engine.getParameters();
            const b = engine.getParameters();
            expect(a).not.toBe(b);
            expect(a).toEqual(b);
        });

        it('mutating the returned object has no effect on the engine', () => {
            const snapshot = /** @type {any} */(engine.getParameters());
            snapshot.someFutureField = 'whatever';
            expect(engine.getParameters()).toEqual({});
        });
    });

    describe('setParameters reset / no-op semantics', () => {
        it('setParameters(null) returns the bag to defaults', () => {
            engine.setParameters(null);
            expect(engine.getParameters()).toEqual({});
        });

        it('setParameters(undefined) is a no-op', () => {
            engine.setParameters(null);
            engine.setParameters(undefined);
            expect(engine.getParameters()).toEqual({});
        });

        it('setParameters({}) is a no-op', () => {
            engine.setParameters(null);
            engine.setParameters({});
            expect(engine.getParameters()).toEqual({});
        });
    });

    describe('setParameters validation', () => {
        it('rejects non-object, non-null, non-undefined inputs', () => {
            expect(() => engine.setParameters(/** @type {any} */(5))).toThrowError(/expected object/);
            expect(() => engine.setParameters(/** @type {any} */('no'))).toThrowError(/expected object/);
            expect(() => engine.setParameters(/** @type {any} */(true))).toThrowError(/expected object/);
        });
    });

    describe('isolation between engine instances', () => {
        it('each engine has its own parameters object', async () => {
            engine.setParameters(null);
            const other = await LittleCMS.createEngine();
            expect(other.getParameters()).toEqual({});
            expect(engine.getParameters()).toEqual({});
            // Snapshots are independent references:
            expect(other.getParameters()).not.toBe(engine.getParameters());
        });
    });
});
