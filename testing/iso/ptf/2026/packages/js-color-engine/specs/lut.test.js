/**
 * @fileoverview Test suite for LookupTable class and LUT processing functions
 * Tests both the new LookupTable class and legacy compatibility
 */

import { test, describe } from 'node:test';
import assert from 'node:assert';
import { LookupTable, create1DDeviceLUT, create2DDeviceLUT, create3DDeviceLUT, create4DDeviceLUT } from '../src/lut.js';

describe('LookupTable Class', () => {
    test('should create LookupTable with minimal parameters', () => {
        // Test creating a simple LookupTable without full parameters
        assert.doesNotThrow(() => {
            const lut = new LookupTable({
                inputChannels: 3,
                outputChannels: 4,
                gridPoints: 17,
                CLUT: new Float64Array(17 * 17 * 17 * 4)
            });
            assert.ok(lut instanceof LookupTable);
        });
    });

    test('should support CMYK processing options', () => {
        const lut = new LookupTable({
            inputChannels: 3,
            outputChannels: 4,
            gridPoints: 17,
            CLUT: new Float64Array(17 * 17 * 17 * 4),
            promoteGrayToCMYKBlack: true
        });

        assert.strictEqual(lut.promoteGrayToCMYKBlack, true);
    });

    test('should have correct default values', () => {
        const lut = new LookupTable({
            inputChannels: 3,
            outputChannels: 3,
            gridPoints: 33,
            CLUT: new Float64Array(33 * 33 * 33 * 3),
            precision: 64,
        });

        assert.strictEqual(lut.promoteGrayToCMYKBlack, false);
        assert.strictEqual(lut.precision, 64);
        assert.strictEqual(lut.encoding, 'number');
    });
});

describe('LUT Creation Functions', () => {
    test('create1DDeviceLUT should be callable', () => {
        assert.strictEqual(typeof create1DDeviceLUT, 'function');
    });

    test('create2DDeviceLUT should be callable', () => {
        assert.strictEqual(typeof create2DDeviceLUT, 'function');
    });

    test('create3DDeviceLUT should be callable', () => {
        assert.strictEqual(typeof create3DDeviceLUT, 'function');
    });

    test('create4DDeviceLUT should be callable', () => {
        assert.strictEqual(typeof create4DDeviceLUT, 'function');
    });
});

describe('Array Processing Functions', () => {
    test('should have transformArray method in LookupTable', () => {
        const lut = new LookupTable({
            inputChannels: 3,
            outputChannels: 3,
            gridPoints: 17,
            CLUT: new Float64Array(17 * 17 * 17 * 3)
        });
        
        assert.strictEqual(typeof lut.transformArray, 'function');
    });

    test('should handle basic array transformation structure', () => {
        // Test basic function signature without actual profile dependency
        assert.doesNotThrow(() => {
            const lut = new LookupTable({
                inputChannels: 3,
                outputChannels: 3,
                gridPoints: 17,
                CLUT: new Float64Array(17 * 17 * 17 * 3),
                precision: 64,
                outputScale: 1.0
            });
            
            // Test that transformArray method exists
            assert.ok(typeof lut.transformArray === 'function', 'transformArray method should exist');
        });
    });
});

describe('CMYK Processing Features', () => {
    test('should handle promoteGrayToCMYKBlack option', () => {
        const lut = new LookupTable({
            inputChannels: 1,
            outputChannels: 4,
            gridPoints: 17,
            CLUT: new Float64Array(17 * 4),
            promoteGrayToCMYKBlack: true
        });

        assert.strictEqual(lut.promoteGrayToCMYKBlack, true);
        // Additional gray promotion logic testing would be added here
    });
});

describe('Interpolation Methods', () => {
    test('should support tetrahedral interpolation', () => {
        const lut = new LookupTable({
            inputChannels: 3,
            outputChannels: 3,
            gridPoints: 17,
            CLUT: new Float64Array(17 * 17 * 17 * 3),
            interpolation: 'tetrahedral'
        });

        assert.strictEqual(lut.interpolation, 'tetrahedral');
    });

    test('should support trilinear interpolation', () => {
        const lut = new LookupTable({
            inputChannels: 3,
            outputChannels: 3,
            gridPoints: 17,
            CLUT: new Float64Array(17 * 17 * 17 * 3),
            interpolation: 'trilinear'
        });

        assert.strictEqual(lut.interpolation, 'trilinear');
    });
});

describe('Error Handling', () => {
    test('should throw error for invalid grid points', () => {
        assert.throws(() => {
            new LookupTable({
                inputChannels: 3,
                outputChannels: 3,
                gridPoints: 0,
                CLUT: new Float64Array(0)
            });
        });
    });

    test('should throw error for mismatched CLUT size', () => {
        assert.throws(() => {
            new LookupTable({
                inputChannels: 3,
                outputChannels: 3,
                gridPoints: 17,
                CLUT: new Float64Array(100) // Wrong size
            });
        });
    });
});
