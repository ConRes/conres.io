// @ts-check

import test, { describe } from 'node:test';

import { Profile, Transform, eIntent, convert as color, eColourType } from '../src/main.js';

const cmykProfileURL = `${new URL('./fixtures/profiles/cmyk/GRACoL2006_Coated1v2.icc', import.meta.url)}`;

//TODO - Have a seperate file with known good transforms i.e Lab2RGB = { lab: {}, rgb: {} , rgbf: {} }

test.assert.register('closeTo', (received, expected, precision = 2) => ({
    message: () => `expected ${received} to be close to ${expected} with precision ${precision}`,
    pass: Math.abs(received - expected) < Math.pow(10, -precision) / 2,
}));

describe('Transform Data Format', () => {

    test('Lab to srgb as objectFloat', ({ assert }) => {
        const lab2srgb = new Transform({ dataFormat: 'objectFloat' });

        lab2srgb.create('*lab', '*srgb', eIntent.absolute);

        const input = color.Lab(30, 50, -20);
        const output = lab2srgb.transform(input);

        // expect(output.Rf).toBeCloseTo(129 / 255);
        // assert.strictEqual(output.Rf, 129 / 255);
        assert.closeTo(output.Rf, 129 / 255);

        // expect(output.Gf).toBeCloseTo(21 / 255);
        // assert.strictEqual(output.Gf, 21 / 255);
        assert.closeTo(output.Gf, 21 / 255);

        // expect(output.Bf).toBeCloseTo(103 / 255);
        // assert.strictEqual(output.Bf, 103 / 255);
        assert.closeTo(output.Bf, 103 / 255);

        // expect(output.type).toBe(eColourType.RGBf);
        assert.strictEqual(output.type, eColourType.RGBf);
    });

    test('Lab to CMYK as objectFloat', async ({ assert }) => {
        const cmykProfile = new Profile();

        await cmykProfile.loadPromise(cmykProfileURL);

        // expect(cmykProfile.loaded).toBe(true);
        assert.strictEqual(cmykProfile.loaded, true);

        const lab2CMYK = new Transform({ dataFormat: 'objectFloat' });

        lab2CMYK.create('*lab', cmykProfile, eIntent.absolute);

        const input = color.Lab(30, 50, -20);
        const output = lab2CMYK.transform(input);

        // expect(output.Cf).toBeCloseTo(0.39420816003754827);
        assert.strictEqual(output.Cf, 0.39420816003754827);

        // expect(output.Mf).toBeCloseTo(1);
        // assert.strictEqual(output.Mf, 1);
        assert.closeTo(output.Mf, 1);

        // expect(output.Yf).toBeCloseTo(0);
        // assert.strictEqual(output.Yf, 0);
        assert.closeTo(output.Yf, 0);

        // expect(output.Kf).toBeCloseTo(0.21425042968301292);
        // assert.strictEqual(output.Kf, 0.21425042968301292);
        assert.closeTo(output.Kf, 0.21425042968301292);

        // expect(output.type).toBe(eColourType.CMYKf);
        assert.strictEqual(output.type, eColourType.CMYKf);
    });

    test('srgb to Lab as objectFloat', ({ assert }) => {
        const rgb2lab = new Transform({ dataFormat: 'objectFloat' });

        rgb2lab.create('*srgb', '*lab', eIntent.absolute);

        const input = color.RGBf(200 / 255, 150 / 255, 50 / 255);
        const output = rgb2lab.transform(input);

        // expect(output.L).toBeCloseTo(65.677112680158, 5);
        // assert.strictEqual(output.L, 65.677112680158);
        assert.closeTo(output.L, 65.677112680158, 5);

        // expect(output.a).toBeCloseTo(12.542727997170147, 5);
        // assert.strictEqual(output.a, 12.542727997170147);
        assert.closeTo(output.a, 12.542727997170147, 5);

        // expect(output.b).toBeCloseTo(57.14452940610417, 5);
        // assert.strictEqual(output.b, 57.14452940610417);
        assert.closeTo(output.b, 57.14452940610417, 5);

        // expect(output.whitePoint.desc).toBe('d50');
        assert.strictEqual(output.whitePoint.desc, 'd50');
    });


    //
    // ---------------------------------------------------------------------------------------------------------------
    //

    test('sRGB to CMYK as device', async ({ assert }) => {
        const cmykProfile = new Profile();

        await cmykProfile.loadPromise(cmykProfileURL);

        // expect(cmykProfile.loaded).toBe(true);
        assert.strictEqual(cmykProfile.loaded, true);

        const lab2CMYK = new Transform({ dataFormat: 'device' });

        lab2CMYK.create('*lab', cmykProfile, eIntent.absolute);

        const input = lab2CMYK.Lab2PCSv4(color.Lab(30, 50, -20));
        const output = lab2CMYK.transform(input);

        // expect(output[0]).toBeCloseTo(0.39420816003754827);
        assert.closeTo(output[0], 0.39420816003754827);

        // expect(output[1]).toBeCloseTo(1);
        assert.closeTo(output[1], 1);

        // expect(output[2]).toBeCloseTo(0);
        assert.closeTo(output[2], 0);

        // expect(output[3]).toBeCloseTo(0.21425042968301292);
        assert.closeTo(output[3], 0.21425042968301292);
    });

    test('srgb to Lab as device', ({ assert }) => {
        const rgb2lab = new Transform({ dataFormat: 'device' });

        rgb2lab.create('*srgb', '*lab', eIntent.absolute);

        const input = [200 / 255, 150 / 255, 50 / 255];
        const output = rgb2lab.transform(input);

        // [ 0.65677112680158, 0.551147952930079, 0.7260569780631536 ]

        // expect(output[0]).toBeCloseTo(0.65677112680158);
        assert.closeTo(output[0], 0.65677112680158);

        // expect(output[1]).toBeCloseTo(0.55114795293007);
        assert.closeTo(output[1], 0.55114795293007);

        // expect(output[2]).toBeCloseTo(0.72605697806315);
        assert.closeTo(output[2], 0.72605697806315);
    });

    //
    // ---------------------------------------------------------------------------------------------------------------
    //

    test('srgb to adobe1998 as int8', ({ assert }) => {
        const rgb2lab = new Transform({ dataFormat: 'int8' });

        rgb2lab.create('*srgb', '*adobe1998', eIntent.absolute);

        const input = Uint8ClampedArray.from([200, 150, 50]);
        const output = rgb2lab.transform(input);

        // expect(output).toBeInstanceOf(Array);
        assert.strictEqual(Array.isArray(output), true);

        // expect(output[0]).toBe(186);
        assert.strictEqual(output[0], 186);

        // expect(output[1]).toBe(149);
        assert.strictEqual(output[1], 149);

        // expect(output[2]).toBe(61);
        assert.strictEqual(output[2], 61);
    });
    
});