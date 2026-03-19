// @ts-check

import test, { describe } from 'node:test';

import { Profile, Transform, eIntent, convert as color, eColourType } from '../../src/main.js';

const cmykProfileURL = `${new URL('../fixtures/profiles/cmyk/GRACoL2006_Coated1v2.icc', import.meta.url)}`;

describe('Transform MultiStage [legacy]', () => {

    test('sRGB to CMYK via LUT', async ({ assert }) => {
        const cmykProfile = new Profile();

        await cmykProfile.loadPromise(cmykProfileURL);

        // expect(cmykProfile.loaded).toBe(true);
        assert.strictEqual(cmykProfile.loaded, true);

        const rgb2CMYK = new Transform({ dataFormat: 'int8', buildLUT: true, useLegacy: true });

        rgb2CMYK.create('*srgb', cmykProfile, eIntent.relative);

        const input = [
            150, 100, 50,
            50, 50, 50,
            200, 200, 200,
            0, 0, 0,
            255, 255, 255
        ];
        const output = rgb2CMYK.transformArrayViaLUT(input);

        // expect(output).toBeInstanceOf(Uint8ClampedArray);
        assert.strictEqual(output instanceof Uint8ClampedArray, true);

        // expect(output).toEqual(new Uint8ClampedArray([
        //     94, 157, 243, 40,
        //     202, 182, 177, 171,
        //     62, 46, 46, 0,
        //     205, 183, 174, 255,
        //     0, 0, 0, 0
        // ]));
        assert.deepStrictEqual(output, new Uint8ClampedArray([
            94, 157, 243, 40,
            202, 182, 177, 171,
            62, 46, 46, 0,
            205, 183, 174, 255,
            0, 0, 0, 0
        ]));
    });

    // test('sRGB to CMYK with Preserve Gray via LUT', async ({ assert }) => {
    //     const cmykProfile = new Profile();

    //     await cmykProfile.loadPromise(cmykProfileURL);

    //     // expect(cmykProfile.loaded).toBe(true);
    //     assert.strictEqual(cmykProfile.loaded, true);

    //     const rgb2CMYK = new Transform({ dataFormat: 'int8', buildLUT: true, preserveGray: true });

    //     rgb2CMYK.create('*srgb', cmykProfile, eIntent.relative);

    //     // console.dir({rgb2CMYK}, {depth: null, compact: true, maxArrayLength: 9});

    //     const input = [
    //         150, 100, 50,
    //         50, 50, 50,
    //         200, 200, 200,
    //         0, 0, 0,
    //         255, 255, 255
    //     ];
    //     const output = rgb2CMYK.transformArrayViaLUT(input);

    //     // expect(output).toBeInstanceOf(Uint8ClampedArray);
    //     assert.strictEqual(output instanceof Uint8ClampedArray, true);

    //     // expect(output).toEqual(new Uint8ClampedArray([
    //     //     94, 157, 243, 40,
    //     //     202, 182, 177, 171,
    //     //     62, 46, 46, 0,
    //     //     205, 183, 174, 255,
    //     //     0, 0, 0, 0
    //     // ]));
    //     assert.deepStrictEqual(output, new Uint8ClampedArray([
    //         94, 157, 243, 40,
    //         202, 182, 177, 171,
    //         62, 46, 46, 0,
    //         205, 183, 174, 255,
    //         0, 0, 0, 0
    //     ]));
    // });

    test('sRGB+Alpha to CMYK via LUT', async ({ assert }) => {
        const cmykProfile = new Profile();

        await cmykProfile.loadPromise(cmykProfileURL);

        // expect(cmykProfile.loaded).toBe(true);
        assert.strictEqual(cmykProfile.loaded, true);

        const rgb2CMYK = new Transform({ dataFormat: 'int8', buildLUT: true, useLegacy: true });

        rgb2CMYK.create('*srgb', cmykProfile, eIntent.relative);

        const input = [
            150, 100, 50, 200,
            50, 50, 50, 200,
            200, 200, 200, 200,
            0, 0, 0, 200,
            255, 255, 255, 200,
        ];
        const output = rgb2CMYK.transformArrayViaLUT(input, true, false);

        // expect(output).toBeInstanceOf(Uint8ClampedArray);
        assert.strictEqual(output instanceof Uint8ClampedArray, true);

        // expect(output).toEqual(new Uint8ClampedArray([
        //     94, 157, 243, 40,
        //     202, 182, 177, 171,
        //     62, 46, 46, 0,
        //     205, 183, 174, 255,
        //     0, 0, 0, 0
        // ]));
        assert.deepStrictEqual(output, new Uint8ClampedArray([
            94, 157, 243, 40,
            202, 182, 177, 171,
            62, 46, 46, 0,
            205, 183, 174, 255,
            0, 0, 0, 0
        ]));
    });

    test('sRGB+Alpha to CMYK+Alpha via LUT', async ({ assert }) => {
        const cmykProfile = new Profile();

        await cmykProfile.loadPromise(cmykProfileURL);

        // expect(cmykProfile.loaded).toBe(true);
        assert.strictEqual(cmykProfile.loaded, true);

        const rgb2CMYK = new Transform({ dataFormat: 'int8', buildLUT: true, useLegacy: true });

        rgb2CMYK.create('*srgb', cmykProfile, eIntent.relative);

        const input = [
            150, 100, 50, 200,
            50, 50, 50, 200,
            200, 200, 200, 200,
            0, 0, 0, 200,
            255, 255, 255, 200,
        ];
        const output = rgb2CMYK.transformArrayViaLUT(input, true, true, false);

        // expect(output).toBeInstanceOf(Uint8ClampedArray);
        assert.strictEqual(output instanceof Uint8ClampedArray, true);

        // expect(output).toEqual(new Uint8ClampedArray([
        //     94, 157, 243, 40, 255,
        //     202, 182, 177, 171, 255,
        //     62, 46, 46, 0, 255,
        //     205, 183, 174, 255, 255,
        //     0, 0, 0, 0, 255
        // ]));
        assert.deepStrictEqual(output, new Uint8ClampedArray([
            94, 157, 243, 40, 255,
            202, 182, 177, 171, 255,
            62, 46, 46, 0, 255,
            205, 183, 174, 255, 255,
            0, 0, 0, 0, 255
        ]));
    });

    test('sRGB+Alpha to CMYK+Alpha via LUT with PRESERVE Alpha', async ({ assert }) => {
        const cmykProfile = new Profile();

        await cmykProfile.loadPromise(cmykProfileURL);

        // expect(cmykProfile.loaded).toBe(true);
        assert.strictEqual(cmykProfile.loaded, true);

        const rgb2CMYK = new Transform({ dataFormat: 'int8', buildLUT: true, useLegacy: true });

        rgb2CMYK.create('*srgb', cmykProfile, eIntent.relative);

        const input = [
            150, 100, 50, 200,
            50, 50, 50, 200,
            200, 200, 200, 200,
            0, 0, 0, 200,
            255, 255, 255, 200,
        ];
        const output = rgb2CMYK.transformArrayViaLUT(input, true, true, true);

        // expect(output).toBeInstanceOf(Uint8ClampedArray);
        assert.strictEqual(output instanceof Uint8ClampedArray, true);

        // expect(output).toEqual(new Uint8ClampedArray([
        //     94, 157, 243, 40, 200,
        //     202, 182, 177, 171, 200,
        //     62, 46, 46, 0, 200,
        //     205, 183, 174, 255, 200,
        //     0, 0, 0, 0, 200
        // ]));
        assert.deepStrictEqual(output, new Uint8ClampedArray([
            94, 157, 243, 40, 200,
            202, 182, 177, 171, 200,
            62, 46, 46, 0, 200,
            205, 183, 174, 255, 200,
            0, 0, 0, 0, 200
        ]));
    });

    test('sRGB+Alpha to CMYK+Alpha via LUT with PRESERVE Alpha with length of 3', async ({ assert }) => {
        const cmykProfile = new Profile();

        await cmykProfile.loadPromise(cmykProfileURL);

        // expect(cmykProfile.loaded).toBe(true);
        assert.strictEqual(cmykProfile.loaded, true);

        const rgb2CMYK = new Transform({ dataFormat: 'int8', buildLUT: true, useLegacy: true });

        rgb2CMYK.create('*srgb', cmykProfile, eIntent.relative);

        const input = [
            150, 100, 50, 200,
            50, 50, 50, 200,
            200, 200, 200, 200,
            0, 0, 0, 200,
            255, 255, 255, 200,
        ];
        const output = rgb2CMYK.transformArrayViaLUT(input, true, true, true, 3);

        // expect(output).toBeInstanceOf(Uint8ClampedArray);
        assert.strictEqual(output instanceof Uint8ClampedArray, true);

        // expect(output).toEqual(new Uint8ClampedArray([
        //     94, 157, 243, 40, 200,
        //     202, 182, 177, 171, 200,
        //     62, 46, 46, 0, 200
        // ]));
        assert.deepStrictEqual(output, new Uint8ClampedArray([
            94, 157, 243, 40, 200,
            202, 182, 177, 171, 200,
            62, 46, 46, 0, 200
        ]));
    });

});