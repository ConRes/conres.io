// @ts-check

import test, { describe } from 'node:test';

import { Profile, Transform, eIntent, convert as color, eColourType } from '../../src/main.js';

const cmykProfileURL = `${new URL('../fixtures/profiles/cmyk/GRACoL2006_Coated1v2.icc', import.meta.url)}`;

describe('Transform Flags [legacy]', () => {

    test('sRGB to CMYK with Preserve Gray via LUT [legacy]', async ({ assert }) => {
        const cmykProfile = new Profile();

        await cmykProfile.loadPromise(cmykProfileURL);

        // expect(cmykProfile.loaded).toBe(true);
        assert.strictEqual(cmykProfile.loaded, true);

        const rgb2CMYK = new Transform({ dataFormat: 'int8', buildLUT: true, useBPC: true, preserveGray: true, verbose: true, useLegacy: true });

        rgb2CMYK.create('*srgb', cmykProfile, eIntent.relative);

        // console.dir({rgb2CMYK}, {depth: null, compact: true, maxArrayLength: 9});

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

});