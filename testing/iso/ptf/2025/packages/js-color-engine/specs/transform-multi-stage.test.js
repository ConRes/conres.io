// @ts-check

import test, { describe } from 'node:test';

import { Profile, Transform, eIntent, convert as color, eColourType } from '../src/main.js';

const cmykProfileURL = `${new URL('./fixtures/profiles/cmyk/GRACoL2006_Coated1v2.icc', import.meta.url)}`;

describe('Transform MultiStage', () => {

    test('sRGB->relative->CMYK->relative->AdobeRGB', async ({ assert }) => {
        const cmykProfile = new Profile();

        await cmykProfile.loadPromise(cmykProfileURL);

        // expect(cmykProfile.loaded).toBe(true);
        assert.strictEqual(cmykProfile.loaded, true);

        const rgb2CMYK2rgb = new Transform({ dataFormat: 'int8' });

        rgb2CMYK2rgb.createMultiStage(['*sRGB', eIntent.relative, cmykProfile, eIntent.relative, '*adobe1998']);

        const input = [
            150, 100, 50,
            50, 50, 50,
            200, 200, 200,
            0, 0, 0,
            255, 255, 255
        ];
        const output = rgb2CMYK2rgb.transformArray(input);

        // expect(output).toBeInstanceOf(Array);
        assert.strictEqual(Array.isArray(output), true);

        // expect(output).toEqual([
        //     139, 101, 59,
        //     53, 53, 54,
        //     199, 199, 199,
        //     33, 32, 32, //<---- As  expected CMYK black is lighter than RGB black
        //     255, 255, 255
        // ]);
        assert.deepStrictEqual(output, [
            139, 101, 59,
            53, 53, 54,
            199, 199, 199,
            33, 32, 32, // <---- As  expected CMYK black is lighter than RGB black
            255, 255, 255
        ]);
    });

    test('sRGB->perceptual->CMYK->relative->AdobeRGB', async ({ assert }) => {
        const cmykProfile = new Profile();

        await cmykProfile.loadPromise(cmykProfileURL);

        // expect(cmykProfile.loaded).toBe(true);
        assert.strictEqual(cmykProfile.loaded, true);

        const rgb2CMYK2rgb = new Transform({ dataFormat: 'int8' });

        rgb2CMYK2rgb.createMultiStage(['*sRGB', eIntent.perceptual, cmykProfile, eIntent.relative, '*adobe1998']);

        const input = [
            150, 100, 50,
            50, 50, 50,
            200, 200, 200,
            0, 0, 0,
            255, 255, 255
        ];
        const output = rgb2CMYK2rgb.transformArray(input);

        // expect(output).toBeInstanceOf(Array);
        assert.strictEqual(Array.isArray(output), true);

        // expect(output).toEqual([
        //     138, 102, 61,
        //     60, 60, 60, //<---- grey is different as perceptual intent shifts lightness
        //     205, 205, 205,
        //     33, 32, 32, //<---- As  expected CMYK black is lighter than RGB black
        //     255, 255, 255
        // ]);
        assert.deepStrictEqual(output, [
            138, 102, 61,
            60, 60, 60, // <---- grey is different as perceptual intent shifts lightness
            205, 205, 205,
            33, 32, 32, // <---- As  expected CMYK black is lighter than RGB black
            255, 255, 255
        ]);
    });

    // test('sRGB->perceptual->CMYK->relative->AdobeRGB (legacy)', async ({ assert }) => {
    //     const cmykProfile = new Profile();

    //     await cmykProfile.loadPromise(cmykProfileURL);

    //     // expect(cmykProfile.loaded).toBe(true);
    //     assert.strictEqual(cmykProfile.loaded, true);

    //     const rgb2CMYK2rgb = new Transform({ dataFormat: 'int8', useLegacy: true });

    //     rgb2CMYK2rgb.createMultiStage(['*sRGB', eIntent.perceptual, cmykProfile, eIntent.relative, '*adobe1998']);

    //     const input = [
    //         150, 100, 50,
    //         50, 50, 50,
    //         200, 200, 200,
    //         0, 0, 0,
    //         255, 255, 255
    //     ];
    //     const output = rgb2CMYK2rgb.transformArray(input);

    //     // expect(output).toBeInstanceOf(Array);
    //     assert.strictEqual(Array.isArray(output), true);

    //     // expect(output).toEqual([
    //     //     138, 102, 61,
    //     //     60, 60, 60, //<---- grey is different as perceptual intent shifts lightness
    //     //     205, 205, 205,
    //     //     33, 32, 32, //<---- As  expected CMYK black is lighter than RGB black
    //     //     255, 255, 255
    //     // ]);
    //     assert.deepStrictEqual(output, [
    //         138, 102, 61,
    //         60, 60, 60, // <---- grey is different as perceptual intent shifts lightness
    //         205, 205, 205,
    //         33, 32, 32, // <---- As  expected CMYK black is lighter than RGB black
    //         255, 255, 255
    //     ]);
    // });

});