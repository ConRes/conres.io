// @ts-check

import test, { describe } from 'node:test';

// import path from 'path';
// import { pathToFileURL } from 'node:url';

import { Profile, Transform, eIntent, convert as color } from '../../src/main.js';

// const cmykFilename = path.join(__dirname, './GRACoL2006_Coated1v2.icc');
// const cmykProfileURL = `${pathToFileURL(cmykFilename)}`;

const cmykProfileURL = `${new URL('../fixtures/profiles/cmyk/GRACoL2006_Coated1v2.icc', import.meta.url)}`;

describe('Transform Data as Arrays [legacy]', () => {

    test('sRGB to CMYK via arrays [legacy]', async ({ assert }) => {
        const cmykProfile = new Profile();

        await cmykProfile.loadPromise(cmykProfileURL);

        // expect(cmykProfile.loaded).toBe(true);
        assert.strictEqual(cmykProfile.loaded, true);

        const rgb2CMYK = new Transform({ dataFormat: 'int8', useLegacy: true });

        rgb2CMYK.create('*srgb', cmykProfile, eIntent.relative);

        const input = [
            150, 100, 50,
            50, 50, 50,
            200, 200, 200,
            0, 0, 0,
            255, 255, 255
        ];

        const output = rgb2CMYK.transformArray(input);

        // expect(output).toBeInstanceOf(Array);
        assert.strictEqual(Array.isArray(output), true);

        // expect(output).toEqual([
        //     94, 157, 243, 40,
        //     202, 183, 177, 170,
        //     62, 46, 46, 0,
        //     205, 183, 174, 255,
        //     0, 0, 0, 0
        // ]);
        assert.deepStrictEqual(output, [
            94, 157, 243, 40,
            202, 183, 177, 170,
            62, 46, 46, 0,
            205, 183, 174, 255,
            0, 0, 0, 0
        ]);
    });

    test('sRGB+Alpha to CMYK via arrays [legacy]', async ({ assert }) => {
        const cmykProfile = new Profile();

        await cmykProfile.loadPromise(cmykProfileURL);

        // expect(cmykProfile.loaded).toBe(true);
        assert.strictEqual(cmykProfile.loaded, true);

        const rgb2CMYK = new Transform({ dataFormat: 'int8', useLegacy: true });

        rgb2CMYK.create('*srgb', cmykProfile, eIntent.relative);

        const input = [
            150, 100, 50, 200,
            50, 50, 50, 200,
            200, 200, 200, 200,
            0, 0, 0, 200,
            255, 255, 255, 200,
        ];

        const output = rgb2CMYK.transformArray(input, true, false);

        // expect(output).toBeInstanceOf(Array);
        assert.strictEqual(Array.isArray(output), true);

        // expect(output).toEqual([
        //     94, 157, 243, 40,
        //     202, 183, 177, 170,
        //     62, 46, 46, 0,
        //     205, 183, 174, 255,
        //     0, 0, 0, 0
        // ]);
        assert.deepStrictEqual(output, [
            94, 157, 243, 40,
            202, 183, 177, 170,
            62, 46, 46, 0,
            205, 183, 174, 255,
            0, 0, 0, 0
        ]);
    });

    test('sRGB+Alpha to CMYK+Alpha via arrays [legacy]', async ({ assert }) => {
        const cmykProfile = new Profile();

        await cmykProfile.loadPromise(cmykProfileURL);

        // expect(cmykProfile.loaded).toBe(true);
        assert.strictEqual(cmykProfile.loaded, true);

        const rgb2CMYK = new Transform({ dataFormat: 'int8', useLegacy: true });

        rgb2CMYK.create('*srgb', cmykProfile, eIntent.relative);

        const input = [
            150, 100, 50, 200,
            50, 50, 50, 200,
            200, 200, 200, 200,
            0, 0, 0, 200,
            255, 255, 255, 200,
        ];

        const output = rgb2CMYK.transformArray(input, true, true, false);

        // expect(output).toBeInstanceOf(Array);
        assert.strictEqual(Array.isArray(output), true);

        // expect(output).toEqual([
        //     94, 157, 243, 40, 255,
        //     202, 183, 177, 170, 255,
        //     62, 46, 46, 0, 255,
        //     205, 183, 174, 255, 255,
        //     0, 0, 0, 0, 255
        // ]);
        assert.deepStrictEqual(output, [
            94, 157, 243, 40, 255,
            202, 183, 177, 170, 255,
            62, 46, 46, 0, 255,
            205, 183, 174, 255, 255,
            0, 0, 0, 0, 255
        ]);
    });

    test('sRGB+Alpha to CMYK+Alpha via arrays with PRESERVE Alpha [legacy]', async ({ assert }) => {
        const cmykProfile = new Profile();

        await cmykProfile.loadPromise(cmykProfileURL);

        // expect(cmykProfile.loaded).toBe(true);
        assert.strictEqual(cmykProfile.loaded, true);

        const rgb2CMYK = new Transform({ dataFormat: 'int8', useLegacy: true });

        rgb2CMYK.create('*srgb', cmykProfile, eIntent.relative);

        const input = [
            150, 100, 50, 200,
            50, 50, 50, 200,
            200, 200, 200, 200,
            0, 0, 0, 200,
            255, 255, 255, 200,
        ];

        const output = rgb2CMYK.transformArray(input, true, true, true);

        // expect(output).toBeInstanceOf(Array);
        assert.strictEqual(Array.isArray(output), true);

        // expect(output).toEqual([
        //     94, 157, 243, 40, 200,
        //     202, 183, 177, 170, 200,
        //     62, 46, 46, 0, 200,
        //     205, 183, 174, 255, 200,
        //     0, 0, 0, 0, 200
        // ]);
        assert.deepStrictEqual(output, [
            94, 157, 243, 40, 200,
            202, 183, 177, 170, 200,
            62, 46, 46, 0, 200,
            205, 183, 174, 255, 200,
            0, 0, 0, 0, 200
        ]);
    });

    test('sRGB+Alpha to CMYK+Alpha via arrays with PRESERVE Alpha with length of 3 [legacy]', async ({ assert }) => {
        const cmykProfile = new Profile();

        await cmykProfile.loadPromise(cmykProfileURL);

        // expect(cmykProfile.loaded).toBe(true);
        assert.strictEqual(cmykProfile.loaded, true);

        const rgb2CMYK = new Transform({ dataFormat: 'int8', useLegacy: true });

        rgb2CMYK.create('*srgb', cmykProfile, eIntent.relative);

        const input = [
            150, 100, 50, 200,
            50, 50, 50, 200,
            200, 200, 200, 200,
            0, 0, 0, 200,
            255, 255, 255, 200,
        ];

        const output = rgb2CMYK.transformArray(input, true, true, true, 3);

        // expect(output).toBeInstanceOf(Array);
        assert.strictEqual(Array.isArray(output), true);

        // expect(output).toEqual([
        //     94, 157, 243, 40, 200,
        //     202, 183, 177, 170, 200,
        //     62, 46, 46, 0, 200
        // ]);
        assert.deepStrictEqual(output, [
            94, 157, 243, 40, 200,
            202, 183, 177, 170, 200,
            62, 46, 46, 0, 200
        ]);
    });

    test('sRGB+Alpha to CMYK+Alpha via arrays with PRESERVE Alpha with length of 3 as Uint8ClampedArray [legacy]', async ({ assert }) => {
        const cmykProfile = new Profile();

        await cmykProfile.loadPromise(cmykProfileURL);

        // expect(cmykProfile.loaded).toBe(true);
        assert.strictEqual(cmykProfile.loaded, true);

        const rgb2CMYK = new Transform({ dataFormat: 'int8', useLegacy: true });

        rgb2CMYK.create('*srgb', cmykProfile, eIntent.relative);

        const input = [
            150, 100, 50, 200,
            50, 50, 50, 200,
            200, 200, 200, 200,
            0, 0, 0, 200,
            255, 255, 255, 200,
        ];

        const output = rgb2CMYK.transformArray(input, true, true, true, 3, 'int8');

        // expect(output).toBeInstanceOf(Uint8ClampedArray);
        assert.strictEqual(output instanceof Uint8ClampedArray, true);

        // expect(output).toEqual(new Uint8ClampedArray([
        //     94, 157, 243, 40, 200,
        //     202, 183, 177, 170, 200,
        //     62, 46, 46, 0, 200
        // ]));
        assert.deepStrictEqual(output, new Uint8ClampedArray([
            94, 157, 243, 40, 200,
            202, 183, 177, 170, 200,
            62, 46, 46, 0, 200
        ]));
    });

});