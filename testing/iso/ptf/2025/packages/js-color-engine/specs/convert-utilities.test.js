/**
 * @fileoverview Test suite for color conversion utilities
 * Tests color factory functions and string formatting utilities
 */

// @ts-check

import { test, describe } from 'node:test';
import assert from 'node:assert';
import convert from '../src/convert.js';
import { eColourType, eIntent } from '../src/main.js';

describe('Convert Utilities', () => {
    
    describe('String Conversion Functions', () => {
        test('intent2String should work correctly', () => {
            assert.strictEqual(convert.intent2String(eIntent.perceptual), 'Perceptual');
            assert.strictEqual(convert.intent2String(eIntent.relative), 'Relative');
            assert.strictEqual(convert.intent2String(eIntent.saturation), 'Saturation');
            assert.strictEqual(convert.intent2String(eIntent.absolute), 'Absolute');
            assert.strictEqual(convert.intent2String(99), 'unknown');
        });

        test('whitepoint2String should format whitepoints', () => {
            const whitePoint = { desc: 'D50', X: 0.9642, Y: 1.0000, Z: 0.8249 };
            const result = convert.whitepoint2String(whitePoint);
            assert.strictEqual(typeof result, 'string');
            assert.ok(result.includes('D50'));
        });

        test('cmsColor2String should format color objects', () => {
            const rgb = convert.RGB(255, 128, 64);
            const result = convert.cmsColor2String(rgb);
            assert.strictEqual(typeof result, 'string');
            assert.ok(result.includes('RGB'));
            assert.ok(result.includes('255'));
            assert.ok(result.includes('128'));
            assert.ok(result.includes('64'));
        });
    });

    describe('Color Factory Functions', () => {
        test('RGB should create valid color object', () => {
            const color = convert.RGB(255, 128, 64);
            assert.strictEqual(color.type, eColourType.RGB);
            assert.strictEqual(color.R, 255);
            assert.strictEqual(color.G, 128);
            assert.strictEqual(color.B, 64);
        });

        test('RGB should handle range checking', () => {
            const color1 = convert.RGB(300, 128, 64, true); // With range check
            assert.strictEqual(color1.R, 255); // Should be clamped to 255

            const color2 = convert.RGB(300, 128, 64, false); // Without range check
            assert.strictEqual(color2.R, 300); // Should preserve original value
        });

        test('RGBf should create float RGB color', () => {
            const color = convert.RGBf(1.0, 0.5, 0.25);
            assert.strictEqual(color.type, eColourType.RGBf);
            assert.strictEqual(color.Rf, 1.0);
            assert.strictEqual(color.Gf, 0.5);
            assert.strictEqual(color.Bf, 0.25);
        });

        test('CMYK should create valid color object', () => {
            const color = convert.CMYK(50, 25, 0, 10);
            assert.strictEqual(color.type, eColourType.CMYK);
            assert.strictEqual(color.C, 50);
            assert.strictEqual(color.M, 25);
            assert.strictEqual(color.Y, 0);
            assert.strictEqual(color.K, 10);
        });

        test('CMYKf should create float CMYK color', () => {
            const color = convert.CMYKf(0.5, 0.25, 0.0, 0.1);
            assert.strictEqual(color.type, eColourType.CMYKf);
            assert.strictEqual(color.Cf, 0.5);
            assert.strictEqual(color.Mf, 0.25);
            assert.strictEqual(color.Yf, 0.0);
            assert.strictEqual(color.Kf, 0.1);
        });

        test('Lab should create valid color object', () => {
            const color = convert.Lab(50, 20, -10);
            assert.strictEqual(color.type, eColourType.Lab);
            assert.strictEqual(color.L, 50);
            assert.strictEqual(color.a, 20);
            assert.strictEqual(color.b, -10);
        });

        test('Lab should handle whitePoint', () => {
            const whitePoint = convert.d50;
            const color = convert.Lab(50, 20, -10, whitePoint);
            assert.strictEqual(color.type, eColourType.Lab);
            assert.strictEqual(color.whitePoint, whitePoint);
        });

        test('Gray should create valid color object', () => {
            const color = convert.Gray(128);
            assert.strictEqual(color.type, eColourType.Gray);
            assert.strictEqual(color.G, 128);
        });

        test('Duo should create valid color object', () => {
            const color = convert.Duo(50, 75);
            assert.strictEqual(color.type, eColourType.Duo);
            assert.strictEqual(color.a, 50);
            assert.strictEqual(color.b, 75);
        });

        test('XYZ should create valid color object', () => {
            const color = convert.XYZ(0.5, 0.3, 0.2);
            assert.strictEqual(color.type, eColourType.XYZ);
            assert.strictEqual(color.X, 0.5);
            assert.strictEqual(color.Y, 0.3);
            assert.strictEqual(color.Z, 0.2);
        });
    });

    describe('Utility Functions', () => {
        test('RGB2Hex should convert RGB to hex', () => {
            const rgb = convert.RGB(255, 128, 64);
            const hex = convert.RGB2Hex(rgb);
            assert.strictEqual(hex.toUpperCase(), '#FF8040');
        });

        test('RGBbyte2Float should convert bytes to float', () => {
            const result = convert.RGBbyte2Float(255, 128, 64);
            assert.strictEqual(result.type, eColourType.RGBf);
            assert.strictEqual(result.Rf, 1.0);
            assert.strictEqual(Math.round(result.Gf * 255), 128);
            assert.strictEqual(Math.round(result.Bf * 255), 64);
        });

        test('getWhitePoint should return standard whitepoints', () => {
            const d50 = convert.getWhitePoint('d50');
            assert.ok(d50);
            assert.strictEqual(d50.desc, 'd50');
            assert.strictEqual(typeof d50.X, 'number');
            assert.strictEqual(typeof d50.Y, 'number');
            assert.strictEqual(typeof d50.Z, 'number');

            const d65 = convert.getWhitePoint('d65');
            assert.ok(d65);
            assert.strictEqual(d65.desc, 'd65');
        });

        test('getWhitePoint should handle case insensitive', () => {
            const d50_lower = convert.getWhitePoint('d50');
            const d50_upper = convert.getWhitePoint('D50');
            assert.deepStrictEqual(d50_lower, d50_upper);
        });

        test('xyY should create valid color object', () => {
            const color = convert.xyY(0.3, 0.3, 50);
            assert.strictEqual(color.type, eColourType.xyY);
            assert.strictEqual(color.x, 0.3);
            assert.strictEqual(color.y, 0.3);
            assert.strictEqual(color.Y, 50);
        });
    });

    describe('Range Checking', () => {
        test('RGB range checking should clamp values', () => {
            const color = convert.RGB(300, -50, 128, true);
            assert.strictEqual(color.R, 255); // Clamped to max
            assert.strictEqual(color.G, 0);   // Clamped to min
            assert.strictEqual(color.B, 128); // Within range
        });

        test('CMYK range checking should clamp values', () => {
            const color = convert.CMYK(150, -10, 50, 120, true);
            assert.strictEqual(color.C, 100); // Clamped to max
            assert.strictEqual(color.M, 0);   // Clamped to min
            assert.strictEqual(color.Y, 50);  // Within range
            assert.strictEqual(color.K, 100); // Clamped to max
        });

        test('Lab range checking should clamp L value', () => {
            const color = convert.Lab(150, 20, -10, null, true);
            assert.strictEqual(color.L, 100); // L should be clamped to 100
            assert.strictEqual(color.a, 20);  // a can be outside normal range
            assert.strictEqual(color.b, -10); // b can be outside normal range
        });
    });

    describe('Matrix Operations', () => {
        test('should have Bradford adaptation matrices', () => {
            assert.ok(convert.BradfordMtxAdapt);
            assert.ok(convert.BradfordMtxAdaptInv);
            assert.strictEqual(typeof convert.BradfordMtxAdapt.m00, 'number');
            assert.strictEqual(typeof convert.BradfordMtxAdaptInv.m00, 'number');
        });

        test('multiplyMatrices should be available', () => {
            assert.strictEqual(typeof convert.multiplyMatrices, 'function');
        });
    });

    describe('Edge Cases', () => {
        test('should handle zero values', () => {
            const rgb = convert.RGB(0, 0, 0);
            assert.strictEqual(rgb.R, 0);
            assert.strictEqual(rgb.G, 0);
            assert.strictEqual(rgb.B, 0);

            const cmyk = convert.CMYK(0, 0, 0, 0);
            assert.strictEqual(cmyk.C, 0);
            assert.strictEqual(cmyk.M, 0);
            assert.strictEqual(cmyk.Y, 0);
            assert.strictEqual(cmyk.K, 0);
        });

        test('should handle maximum values', () => {
            const rgb = convert.RGB(255, 255, 255);
            assert.strictEqual(rgb.R, 255);
            assert.strictEqual(rgb.G, 255);
            assert.strictEqual(rgb.B, 255);

            const cmyk = convert.CMYK(100, 100, 100, 100);
            assert.strictEqual(cmyk.C, 100);
            assert.strictEqual(cmyk.M, 100);
            assert.strictEqual(cmyk.Y, 100);
            assert.strictEqual(cmyk.K, 100);
        });
    });
});
