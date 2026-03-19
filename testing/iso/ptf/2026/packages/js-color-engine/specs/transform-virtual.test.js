// @ts-check

import test, { describe } from 'node:test';

import { Transform, eIntent, convert as color, eColourType } from '../src/main.js';

test.assert.register('closeTo', (received, expected, precision = 2) => ({
    message: () => `expected ${received} to be close to ${expected} with precision ${precision}`,
    pass: Math.abs(received - expected) < Math.pow(10, -precision) / 2,
}));

describe('Transform Virtual', () => {

    test('Lab to Lab', ({ assert }) => {
        const lab2lab = new Transform();

        lab2lab.create('*lab', '*lab', eIntent.absolute);

        const input = color.Lab(30, 50, -20);
        const output = lab2lab.transform(input);

        // expect(output.L).toBeCloseTo(30, 5);
        assert.closeTo(output.L, 30, 5);

        // expect(output.a).toBeCloseTo(50, 5);
        assert.closeTo(output.a, 50, 5);

        // expect(output.b).toBeCloseTo(-20, 5);
        assert.closeTo(output.b, -20, 5);
    });

    test('Lab to srgb (int)', ({ assert }) => {
        const lab2srgb = new Transform();

        lab2srgb.create('*lab', '*srgb', eIntent.absolute);

        const input = color.Lab(30, 50, -20);
        const output = lab2srgb.transform(input);

        // expect(output.R).toBe(129 );
        assert.strictEqual(output.R, 129);

        // expect(output.G).toBe(21);
        assert.strictEqual(output.G, 21);

        // expect(output.B).toBe(103 );
        assert.strictEqual(output.B, 103);

        // expect(output.type).toBe(eColourType.RGB);
        assert.strictEqual(output.type, eColourType.RGB);
    });

    test('Lab to srgb (3 decimals)', ({ assert }) => {
        const lab2srgb = new Transform({ precision: 3 });

        lab2srgb.create('*lab', '*srgb', eIntent.absolute);

        const input = color.Lab(30, 50, -20);
        const output = lab2srgb.transform(input);

        // expect(output.R).toBe(129.012 );
        assert.closeTo(output.R, 129.012);

        // expect(output.G).toBe(20.658);
        assert.closeTo(output.G, 20.658);

        // expect(output.B).toBe(103.199 );
        assert.closeTo(output.B, 103.199);

        // expect(output.type).toBe(eColourType.RGB);
        assert.strictEqual(output.type, eColourType.RGB);
    });

    test('srgb to Lab (no rounding)', ({ assert }) => {
        const rgb2lab = new Transform({ roundOutput: false });

        rgb2lab.create('*srgb', '*lab', eIntent.absolute);

        const input = color.RGB(200, 150, 50);
        const output = rgb2lab.transform(input);

        // expect(output.L).toBeCloseTo(65.677112680158, 5);
        assert.closeTo(output.L, 65.677112680158, 5);

        // expect(output.a).toBeCloseTo(12.542727997170147, 5);
        assert.closeTo(output.a, 12.542727997170147, 5);

        // expect(output.b).toBeCloseTo(57.14452940610417, 5);
        assert.closeTo(output.b, 57.14452940610417, 5);

        // expect(output.whitePoint.desc).toBe('d50');
        assert.strictEqual(output.whitePoint.desc, 'd50');
    });

    test('sRGB to Adobe1998RGB', ({ assert }) => {
        const rgb2rgb = new Transform();

        rgb2rgb.create('*srgb', '*adobe1998', eIntent.absolute);

        const input = color.RGB(200, 150, 50);
        const output = rgb2rgb.transform(input);

        // expect(output.R).toBe(186);
        assert.strictEqual(output.R, 186);

        // expect(output.G).toBe(149);
        assert.strictEqual(output.G, 149);

        // expect(output.B).toBe(61);
        assert.strictEqual(output.B, 61);

        // expect(output.type).toBe(eColourType.RGB);
        assert.strictEqual(output.type, eColourType.RGB);
    });

});