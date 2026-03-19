/**
 * @fileoverview Test suite for interpolation refactoring
 * Ensures that moving interpolation functions from Transform class to interpolation.js
 * maintains identical behavior and performance characteristics.
 */

// @ts-check

import { test, describe } from 'node:test';
import assert from 'node:assert';
import { Transform } from '../src/main.js';
import {
    linearInterp1D_NCh,
    bilinearInterp2D_NCh,
    trilinearInterp3D_NCh,
    tetrahedralInterp3D_3Ch,
    tetrahedralInterp3D_4Ch,
    tetrahedralInterp3D_NCh,
    tetrahedralInterp3D_3or4Ch,
    tetrahedralInterp4D_3Ch,
    tetrahedralInterp4D_4Ch,
    tetrahedralInterp4D_NCh,
    trilinearInterp3D_3or4Ch,
    trilinearInterp4D_3or4Ch,
    tetrahedralInterp3D_Master,
    tetrahedralInterp4D_3or4Ch_Master,
    linearInterp1DArray_NCh_loop,
    tetrahedralInterp3DArray_NCh_loop,
} from '../src/interpolation.js';

describe('Interpolation Refactoring Tests', () => {

    // Test data setup
    const testLut3D = {
        inputChannels: 3,
        outputChannels: 3,
        gridPoints: [17, 17, 17],
        g1: 17,
        g2: 17 * 17,
        g3: 17 * 17 * 17,
        go0: 3,
        go1: 17 * 3,
        go2: 17 * 17 * 3,
        go3: 17 * 17 * 17 * 3,
        inputScale: 1,
        outputScale: 255, // Scale to 0-255 range for Uint8Array compatibility
        CLUT: new Float64Array(17 * 17 * 17 * 3).map((_, i) => Math.sin(i * 0.01) * 0.5 + 0.5)
    };

    const testLut4D = {
        inputChannels: 4,
        outputChannels: 4,
        gridPoints: [11, 11, 11, 11],
        g1: 11,
        g2: 11 * 11,
        g3: 11 * 11 * 11,
        g4: 11 * 11 * 11 * 11,
        go0: 4,
        go1: 11 * 4,
        go2: 11 * 11 * 4,
        go3: 11 * 11 * 11 * 4,
        go4: 11 * 11 * 11 * 11 * 4,
        inputScale: 1,
        outputScale: 1,
        CLUT: new Float64Array(11 * 11 * 11 * 11 * 4).map((_, i) => Math.sin(i * 0.01) * 0.5 + 0.5)
    };

    const testLut1D = {
        inputChannels: 1,
        outputChannels: 3,
        gridPoints: [256],
        g1: 256,
        g2: 1, // Not used in 1D
        g3: 1, // Not used in 1D
        go0: 3,
        go1: 256 * 3,
        go2: 0, // Not used in 1D
        inputScale: 1,
        outputScale: 255, // Scale to 0-255 range for Uint8Array compatibility
        CLUT: new Float64Array(256 * 3).map((_, i) => Math.sin(i * 0.01) * 0.5 + 0.5)
    };

    const testLut2D = {
        inputChannels: 2,
        outputChannels: 3,
        gridPoints: [33, 33],
        g1: 33,
        g2: 33 * 33,
        g3: 1, // Not used in 2D
        go0: 3,
        go1: 33 * 3,
        go2: 33 * 33 * 3,
        inputScale: 1,
        outputScale: 1,
        CLUT: new Float64Array(33 * 33 * 3).map((_, i) => Math.sin(i * 0.01) * 0.5 + 0.5)
    };

    // Test input values
    const testInputs3D = [
        [0.0, 0.0, 0.0],
        [1.0, 1.0, 1.0],
        [0.5, 0.5, 0.5],
        [0.25, 0.75, 0.125],
        [0.1, 0.9, 0.3],
        [0.8, 0.2, 0.7]
    ];

    const testInputs4D = [
        [0.0, 0.0, 0.0, 0.0],
        [1.0, 1.0, 1.0, 1.0],
        [0.5, 0.5, 0.5, 0.5],
        [0.25, 0.75, 0.125, 0.625],
        [0.1, 0.9, 0.3, 0.7]
    ];

    const testInputs1D = [
        [0.0],
        [1.0],
        [0.5],
        [0.25],
        [0.75]
    ];

    const testInputs2D = [
        [0.0, 0.0],
        [1.0, 1.0],
        [0.5, 0.5],
        [0.25, 0.75],
        [0.8, 0.2]
    ];

    /**
     * Helper function for performance comparison between baseline and refactored implementations
     * @param {object} options 
     * @param {string} options.operationName - Name of the operation being tested
     * @param {function} options.baselineOperation - The baseline implementation of the operation
     * @param {function} options.refactoredOperation - The refactored implementation of the operation
     * @param {number} [options.iterations=10000] - The number of iterations to run for performance testing
     */
    const compareBaselinePerformance = ({ operationName, baselineOperation, refactoredOperation, iterations = 10000 }) => {
        let baselineTime = 0, refactoredTime = 0, baselineCount = 0, refactoredCount = 0;
        const step = 1 / iterations;

        for (let s = 0; s <= 1; s += step) baselineOperation(s), refactoredOperation(s), performance.now();

        for (let n = 0; n < 100; n++) {
            if (n % 2) {
                const start = performance.now();
                for (let s = 0; s <= 1; s += step) refactoredOperation(s);
                refactoredTime += performance.now() - start, refactoredCount += iterations;
            } else {
                const start = performance.now();
                for (let s = 0; s <= 1; s += step) baselineOperation(s);
                baselineTime += performance.now() - start, baselineCount += iterations;
            }
        }

        console.log(`${operationName}: Baseline [×${baselineCount}]=${baselineTime.toFixed(2)}ms, Refactored[×${refactoredCount}]=${refactoredTime.toFixed(2)}ms`);

        return { baselineTime, refactoredTime, baselineCount, refactoredCount };
    };

    describe('Already Refactored Functions - Regression Tests', () => {

        test('trilinearInterp3D_NCh should match Transform implementation', () => {
            const transform = new Transform();

            for (const input of testInputs3D) {
                const originalResult = transform.trilinearInterp3D_NCh(input, testLut3D);
                const refactoredResult = trilinearInterp3D_NCh(input, testLut3D);

                assert.strictEqual(refactoredResult.length, originalResult.length,
                    `Output length mismatch for input ${JSON.stringify(input)}`);

                for (let i = 0; i < originalResult.length; i++) {
                    assert.ok(Math.abs(originalResult[i] - refactoredResult[i]) < 1e-10,
                        `Value mismatch at index ${i} for input ${JSON.stringify(input)}: ` +
                        `original=${originalResult[i]}, refactored=${refactoredResult[i]}`);
                }
            }
        });

        test('tetrahedralInterp3D_3Ch should match Transform implementation', () => {
            const transform = new Transform();

            for (const input of testInputs3D) {
                const originalResult = transform.tetrahedralInterp3D_3Ch(input, testLut3D);
                const refactoredResult = tetrahedralInterp3D_3Ch(input, testLut3D);

                assert.strictEqual(refactoredResult.length, originalResult.length);

                for (let i = 0; i < originalResult.length; i++) {
                    assert.ok(Math.abs(originalResult[i] - refactoredResult[i]) < 1e-10,
                        `Value mismatch at index ${i} for input ${JSON.stringify(input)}`);
                }
            }
        });

        test('tetrahedralInterp3D_4Ch should match Transform implementation', () => {
            const transform = new Transform();
            const testLut3D_4Ch = { ...testLut3D, outputChannels: 4, go0: 4, go1: 17 * 4, go2: 17 * 17 * 4, go3: 17 * 17 * 17 * 4 };
            testLut3D_4Ch.CLUT = new Float64Array(17 * 17 * 17 * 4).map((_, i) => Math.sin(i * 0.01) * 0.5 + 0.5);

            for (const input of testInputs3D) {
                const originalResult = transform.tetrahedralInterp3D_4Ch(input, testLut3D_4Ch);
                const refactoredResult = tetrahedralInterp3D_4Ch(input, testLut3D_4Ch);

                assert.strictEqual(refactoredResult.length, originalResult.length);

                for (let i = 0; i < originalResult.length; i++) {
                    assert.ok(Math.abs(originalResult[i] - refactoredResult[i]) < 1e-10,
                        `Value mismatch at index ${i} for input ${JSON.stringify(input)}`);
                }
            }
        });

        test('linearInterp1D_NCh should match Transform implementation', () => {
            const transform = new Transform();

            for (const input of testInputs1D) {
                const originalResult = transform.linearInterp1D_NCh(input, testLut1D);
                const refactoredResult = linearInterp1D_NCh(input, testLut1D);

                assert.strictEqual(refactoredResult.length, originalResult.length,
                    `Output length mismatch for input ${JSON.stringify(input)}`);

                for (let i = 0; i < originalResult.length; i++) {
                    assert.ok(Math.abs(originalResult[i] - refactoredResult[i]) < 1e-10,
                        `Value mismatch at index ${i} for input ${JSON.stringify(input)}: ` +
                        `original=${originalResult[i]}, refactored=${refactoredResult[i]}`);
                }
            }
        });

        test('bilinearInterp2D_NCh should match Transform implementation', () => {
            const transform = new Transform();

            for (const input of testInputs2D) {
                const originalResult = transform.bilinearInterp2D_NCh(input, testLut2D);
                const refactoredResult = bilinearInterp2D_NCh(input, testLut2D);

                assert.strictEqual(refactoredResult.length, originalResult.length,
                    `Output length mismatch for input ${JSON.stringify(input)}`);

                for (let i = 0; i < originalResult.length; i++) {
                    assert.ok(Math.abs(originalResult[i] - refactoredResult[i]) < 1e-10,
                        `Value mismatch at index ${i} for input ${JSON.stringify(input)}: ` +
                        `original=${originalResult[i]}, refactored=${refactoredResult[i]}`);
                }
            }
        });

        test('tetrahedralInterp3D_NCh should match Transform implementation', () => {
            const transform = new Transform();

            for (const input of testInputs3D) {
                const originalResult = transform.tetrahedralInterp3D_NCh(input, testLut3D);
                const refactoredResult = tetrahedralInterp3D_NCh(input, testLut3D);

                assert.strictEqual(refactoredResult.length, originalResult.length,
                    `Output length mismatch for input ${JSON.stringify(input)}`);

                for (let i = 0; i < originalResult.length; i++) {
                    assert.ok(Math.abs(originalResult[i] - refactoredResult[i]) < 1e-10,
                        `Value mismatch at index ${i} for input ${JSON.stringify(input)}: ` +
                        `original=${originalResult[i]}, refactored=${refactoredResult[i]}`);
                }
            }
        });

        test('tetrahedralInterp3D_3or4Ch should match Transform implementation', () => {
            const transform = new Transform();

            // Test with 3 channels
            for (const input of testInputs3D) {
                const originalResult = transform.tetrahedralInterp3D_3or4Ch(input, testLut3D, 3);
                const refactoredResult = tetrahedralInterp3D_3or4Ch(input, testLut3D, 3);

                assert.strictEqual(refactoredResult.length, originalResult.length);

                for (let i = 0; i < originalResult.length; i++) {
                    assert.ok(Math.abs(originalResult[i] - refactoredResult[i]) < 1e-10,
                        `3Ch: Value mismatch at index ${i} for input ${JSON.stringify(input)}`);
                }
            }

            // Test with 4 channels
            const testLut3D_4Ch = { ...testLut3D, outputChannels: 4, go0: 4, go1: 17 * 4, go2: 17 * 17 * 4, go3: 17 * 17 * 17 * 4 };
            testLut3D_4Ch.CLUT = new Float64Array(17 * 17 * 17 * 4).map((_, i) => Math.sin(i * 0.01) * 0.5 + 0.5);

            for (const input of testInputs3D) {
                const originalResult = transform.tetrahedralInterp3D_3or4Ch(input, testLut3D_4Ch, 4);
                const refactoredResult = tetrahedralInterp3D_3or4Ch(input, testLut3D_4Ch, 4);

                assert.strictEqual(refactoredResult.length, originalResult.length);

                for (let i = 0; i < originalResult.length; i++) {
                    assert.ok(Math.abs(originalResult[i] - refactoredResult[i]) < 1e-10,
                        `4Ch: Value mismatch at index ${i} for input ${JSON.stringify(input)}`);
                }
            }
        });

        test('tetrahedralInterp4D_3Ch should match Transform implementation', () => {
            const transform = new Transform();

            for (const input of testInputs4D) {
                const originalResult = transform.tetrahedralInterp4D_3Ch(input, testLut4D);
                const refactoredResult = tetrahedralInterp4D_3Ch(input, testLut4D);

                assert.strictEqual(refactoredResult.length, originalResult.length);

                for (let i = 0; i < originalResult.length; i++) {
                    assert.ok(Math.abs(originalResult[i] - refactoredResult[i]) < 1e-10,
                        `Value mismatch at index ${i} for input ${JSON.stringify(input)}`);
                }
            }
        });
    });

    describe('Functions Still to be Refactored - Baseline Tests', () => {

        test('tetrahedralInterp4D_3Ch baseline behavior', () => {
            const transform = new Transform();

            for (const input of testInputs4D) {
                const result = transform.tetrahedralInterp4D_3Ch(input, testLut4D);

                assert.ok(Array.isArray(result), 'Should return an array');
                assert.strictEqual(result.length, 3, 'Should return 3 channels');

                for (let i = 0; i < result.length; i++) {
                    assert.ok(result[i] >= 0 && result[i] <= 1, `Output ${i} should be in range [0,1], got ${result[i]}`);
                }
            }
        });

        test('tetrahedralInterp4D_4Ch baseline behavior', () => {
            const transform = new Transform();

            for (const input of testInputs4D) {
                const result = transform.tetrahedralInterp4D_4Ch(input, testLut4D);

                assert.ok(Array.isArray(result), 'Should return an array');
                assert.strictEqual(result.length, 4, 'Should return 4 channels');

                for (let i = 0; i < result.length; i++) {
                    assert.ok(result[i] >= 0 && result[i] <= 1, `Output ${i} should be in range [0,1], got ${result[i]}`);
                }
            }
        });

        test('tetrahedralInterp4D_NCh baseline behavior', () => {
            const transform = new Transform();

            for (const input of testInputs4D) {
                const result = transform.tetrahedralInterp4D_NCh(input, testLut4D);

                assert.ok(Array.isArray(result), 'Should return an array');
                assert.strictEqual(result.length, testLut4D.outputChannels, 'Should return correct number of channels');

                for (let i = 0; i < result.length; i++) {
                    assert.ok(result[i] >= 0 && result[i] <= 1, `Output ${i} should be in range [0,1], got ${result[i]}`);
                }
            }
        });
    });

    describe('Array Processing Functions - Baseline Tests', () => {

        test('linearInterp1DArray_NCh_loop baseline behavior', () => {
            const transform = new Transform();
            const inputArray = new Uint8Array([0, 128, 255]);
            const outputArray = new Uint8Array(9); // 3 pixels * 3 channels
            const pixelCount = 3;

            transform.linearInterp1DArray_NCh_loop(
                inputArray, 0, outputArray, 0, pixelCount,
                testLut1D, false, false, false
            );

            // Should have filled the output array
            let hasNonZero = false;
            for (let i = 0; i < outputArray.length; i++) {
                if (outputArray[i] !== 0) hasNonZero = true;
            }
            assert.ok(hasNonZero, 'Should have produced some non-zero output values');
        });

        test('tetrahedralInterp3DArray_NCh_loop baseline behavior', () => {
            const transform = new Transform();
            const inputArray = new Uint8Array([0, 0, 0, 128, 128, 128, 255, 255, 255]);
            const outputArray = new Uint8Array(9);
            const pixelCount = 3;

            transform.tetrahedralInterp3DArray_NCh_loop(
                inputArray, 0, outputArray, 0, pixelCount,
                testLut3D, false, false, false
            );

            let hasNonZero = false;
            for (let i = 0; i < outputArray.length; i++) {
                if (outputArray[i] !== 0) hasNonZero = true;
            }
            assert.ok(hasNonZero, 'Should have produced some non-zero output values');
        });
    });

    describe('Performance Baseline Tests', () => {

        test('trilinearInterp3D_NCh performance baseline', () => {
            const transform = new Transform();
            // const trilinearInterp3D_NCh_baseline = Transform.prototype.trilinearInterp3D_NCh;
            const { refactoredTime, baselineTime } = compareBaselinePerformance({
                operationName: 'trilinearInterp3D_NCh',
                baselineOperation: s => transform.trilinearInterp3D_NCh(Array(3).fill(s), testLut3D),
                refactoredOperation: s => trilinearInterp3D_NCh(Array(3).fill(s), testLut3D),
            });

            // Refactored version should not be significantly slower (allow 20% overhead)
            refactoredTime < baselineTime * 1.2 || console.warn(`Refactored version is slower: ${refactoredTime}ms vs ${baselineTime}ms`);
            assert.ok(refactoredTime < baselineTime * 2, `Refactored version should not be significantly slower: ${refactoredTime}ms vs ${baselineTime}ms`);
        });

        test('tetrahedralInterp3D_3Ch performance baseline', () => {
            const transform = new Transform();
            const { refactoredTime, baselineTime } = compareBaselinePerformance({
                operationName: 'tetrahedralInterp3D_3Ch',
                baselineOperation: s => transform.tetrahedralInterp3D_3Ch(Array(3).fill(s), testLut3D),
                refactoredOperation: s => tetrahedralInterp3D_3Ch(Array(3).fill(s), testLut3D),
            });

            // Refactored version should not be significantly slower (allow 20% overhead)
            refactoredTime < baselineTime * 1.2 || console.warn(`Refactored version is slower: ${refactoredTime}ms vs ${baselineTime}ms`);
            assert.ok(refactoredTime < baselineTime * 1.5, `Refactored version should not be significantly slower: ${refactoredTime}ms vs ${baselineTime}ms`);
        });
    });

    describe('Edge Cases and Error Handling', () => {

        test('should handle invalid LUT gracefully', () => {
            const transform = new Transform();

            assert.throws(() => {
                transform.tetrahedralInterp3D_NCh([0.5, 0.5, 0.5], null);
            }, /Invalid LUT/);

            assert.throws(() => {
                tetrahedralInterp3D_3Ch([0.5, 0.5, 0.5], null);
            }, /Invalid LUT/);
        });

        test('should handle edge input values', () => {
            const transform = new Transform();

            // Test boundary values
            const edgeInputs = [
                [-0.1, 0.5, 0.5],  // Below 0
                [1.1, 0.5, 0.5],   // Above 1
                [0.5, -0.1, 0.5],
                [0.5, 1.1, 0.5],
                [0.5, 0.5, -0.1],
                [0.5, 0.5, 1.1]
            ];

            for (const input of edgeInputs) {
                const originalResult = transform.tetrahedralInterp3D_NCh(input, testLut3D);
                const refactoredResult = tetrahedralInterp3D_3Ch(input, testLut3D);

                // Both should handle edge cases without throwing
                assert.ok(Array.isArray(originalResult), 'Original should handle edge cases');
                assert.ok(Array.isArray(refactoredResult), 'Refactored should handle edge cases');
            }
        });
    });

    describe('tetrahedralInterp4D_NCh Tests', () => {
        test('tetrahedralInterp4D_NCh should match Transform implementation', () => {
            const transform = new Transform();

            // Test various 4D inputs (CMYK-like)
            const testInputs4D = [
                [0.0, 0.0, 0.0, 0.0],  // Black point
                [0.5, 0.5, 0.5, 0.5],  // Mid-point
                [1.0, 1.0, 1.0, 1.0],  // White point
                [0.1, 0.2, 0.3, 0.4],  // Regular values
                [0.8, 0.1, 0.6, 0.3],  // Mixed values
                [0.0, 1.0, 0.0, 1.0],  // Alternating values
            ];

            for (const input of testInputs4D) {
                const originalResult = transform.tetrahedralInterp4D_NCh(input, testLut4D);
                const refactoredResult = tetrahedralInterp4D_NCh(input, testLut4D);

                assert.strictEqual(refactoredResult.length, originalResult.length,
                    `Output length mismatch for input ${JSON.stringify(input)}`);

                for (let i = 0; i < originalResult.length; i++) {
                    assert.ok(Math.abs(originalResult[i] - refactoredResult[i]) < 1e-10,
                        `Value mismatch at index ${i} for input ${JSON.stringify(input)}: ` +
                        `original=${originalResult[i]}, refactored=${refactoredResult[i]}`);
                }
            }
        });

        test('trilinearInterp3D_3or4Ch should match Transform implementation', () => {
            const transform = new Transform();

            // Test various 3D inputs with 3 and 4 channel outputs
            const testInputs3D = [
                [0.0, 0.0, 0.0],  // Black point
                [0.5, 0.5, 0.5],  // Mid-point
                [1.0, 1.0, 1.0],  // White point
                [0.1, 0.2, 0.3],  // Regular values
                [0.8, 0.1, 0.6],  // Mixed values
                [0.0, 1.0, 0.5],  // Edge case values
            ];

            for (const input of testInputs3D) {
                // Test with 3-channel output
                const originalResult3 = transform.trilinearInterp3D_3or4Ch(input, testLut3D, 0);
                const refactoredResult3 = trilinearInterp3D_3or4Ch(input, testLut3D, 0);

                assert.strictEqual(refactoredResult3.length, originalResult3.length);
                for (let i = 0; i < originalResult3.length; i++) {
                    assert.ok(Math.abs(originalResult3[i] - refactoredResult3[i]) < 1e-10,
                        `3Ch mismatch at index ${i} for input ${JSON.stringify(input)}`);
                }

                // Test with 4-channel output
                const testLut3D_4Ch = {
                    ...testLut3D,
                    outputChannels: 4,
                    go0: 4,
                    go1: 17 * 4,
                    go2: 17 * 17 * 4,
                    go3: 17 * 17 * 17 * 4,
                    CLUT: new Float64Array(17 * 17 * 17 * 4).map((_, i) => Math.sin(i * 0.01) * 0.5 + 0.5)
                };
                const originalResult4 = transform.trilinearInterp3D_3or4Ch(input, testLut3D_4Ch, 0);
                const refactoredResult4 = trilinearInterp3D_3or4Ch(input, testLut3D_4Ch, 0);

                assert.strictEqual(refactoredResult4.length, originalResult4.length);
                for (let i = 0; i < originalResult4.length; i++) {
                    assert.ok(Math.abs(originalResult4[i] - refactoredResult4[i]) < 1e-10,
                        `4Ch mismatch at index ${i} for input ${JSON.stringify(input)}`);
                }
            }
        });

        test('trilinearInterp4D_3or4Ch should match Transform implementation', () => {
            const transform = new Transform();

            // Test various 4D inputs
            const testInputs4D = [
                [0.0, 0.0, 0.0, 0.0],  // Black point
                [0.5, 0.5, 0.5, 0.5],  // Mid-point
                [1.0, 1.0, 1.0, 1.0],  // White point (edge case)
                [0.1, 0.2, 0.3, 0.4],  // Regular values
                [0.8, 0.1, 0.6, 0.3],  // Mixed values
                [1.0, 0.5, 0.5, 0.5],  // Edge case where rk = 0
            ];

            for (const input of testInputs4D) {
                const originalResult = transform.trilinearInterp4D_3or4Ch(input, testLut4D);
                const refactoredResult = trilinearInterp4D_3or4Ch(input, testLut4D);

                assert.strictEqual(refactoredResult.length, originalResult.length,
                    `Output length mismatch for input ${JSON.stringify(input)}`);

                for (let i = 0; i < originalResult.length; i++) {
                    assert.ok(Math.abs(originalResult[i] - refactoredResult[i]) < 1e-10,
                        `Value mismatch at index ${i} for input ${JSON.stringify(input)}: ` +
                        `original=${originalResult[i]}, refactored=${refactoredResult[i]}`);
                }
            }
        });

        test('tetrahedralInterp3D_Master should match Transform implementation', () => {
            const transform = new Transform();

            // Test various 3D inputs with K0 offset
            const testInputs3D = [
                [0.0, 0.0, 0.0],  // Black point
                [0.5, 0.5, 0.5],  // Mid-point
                [1.0, 1.0, 1.0],  // White point
                [0.1, 0.2, 0.3],  // Regular values
                [0.8, 0.1, 0.6],  // Mixed values
                [0.0, 1.0, 0.5],  // Edge case values
            ];

            const K0Values = [0, 1, 5]; // Test different K0 offsets

            for (const input of testInputs3D) {
                for (const K0 of K0Values) {
                    const originalResult = transform.tetrahedralInterp3D_Master(input, testLut4D, K0);
                    const refactoredResult = tetrahedralInterp3D_Master(input, testLut4D, K0);

                    assert.strictEqual(refactoredResult.length, originalResult.length,
                        `Output length mismatch for input ${JSON.stringify(input)}, K0=${K0}`);

                    for (let i = 0; i < originalResult.length; i++) {
                        assert.ok(Math.abs(originalResult[i] - refactoredResult[i]) < 1e-10,
                            `Value mismatch at index ${i} for input ${JSON.stringify(input)}, K0=${K0}: ` +
                            `original=${originalResult[i]}, refactored=${refactoredResult[i]}`);
                    }
                }
            }
        });

        test('tetrahedralInterp4D_3or4Ch_Master should match Transform implementation', () => {
            const transform = new Transform();

            // Test various 4D inputs (CMYK-like)
            const testInputs4D = [
                [0.0, 0.0, 0.0, 0.0],  // Black point
                [0.5, 0.5, 0.5, 0.5],  // Mid-point
                [1.0, 1.0, 1.0, 1.0],  // White point (edge case)
                [0.1, 0.2, 0.3, 0.4],  // Regular values
                [0.8, 0.1, 0.6, 0.3],  // Mixed values
                [1.0, 0.5, 0.5, 0.5],  // Edge case where rk = 0
                [0.25, 0.75, 0.25, 0.75], // Quarter values
            ];

            for (const input of testInputs4D) {
                const originalResult = transform.tetrahedralInterp4D_3or4Ch_Master(input, testLut4D);
                const refactoredResult = tetrahedralInterp4D_3or4Ch_Master(input, testLut4D);

                assert.strictEqual(refactoredResult.length, originalResult.length,
                    `Output length mismatch for input ${JSON.stringify(input)}`);

                for (let i = 0; i < originalResult.length; i++) {
                    assert.ok(Math.abs(originalResult[i] - refactoredResult[i]) < 1e-10,
                        `Value mismatch at index ${i} for input ${JSON.stringify(input)}: ` +
                        `original=${originalResult[i]}, refactored=${refactoredResult[i]}`);
                }
            }
        });
    });

    describe('Comprehensive Refactored Functions Tests', () => {

        test('trilinearInterp4D_3or4Ch should match Transform implementation', () => {
            const transform = new Transform();

            // Test various 4D inputs
            const testInputs4D = [
                [0.0, 0.0, 0.0, 0.0], // Black point
                [0.5, 0.5, 0.5, 0.5], // Mid-point
                [1.0, 1.0, 1.0, 1.0], // White point
                [0.1, 0.2, 0.3, 0.4], // Regular values
                [0.8, 0.1, 0.6, 0.3], // Mixed values
                [1.0, 0.5, 0.5, 0.5], // Edge values
            ];

            for (const input of testInputs4D) {
                const originalResult = transform.trilinearInterp4D_3or4Ch(input, testLut4D);
                const refactoredResult = trilinearInterp4D_3or4Ch(input, testLut4D);

                assert.strictEqual(refactoredResult.length, originalResult.length,
                    `Output length mismatch for input ${JSON.stringify(input)}`);

                for (let i = 0; i < originalResult.length; i++) {
                    assert.ok(Math.abs(originalResult[i] - refactoredResult[i]) < 1e-10,
                        `Value mismatch at index ${i} for input ${JSON.stringify(input)}: ` +
                        `original=${originalResult[i]}, refactored=${refactoredResult[i]}`);
                }
            }
        });

        test('tetrahedralInterp4D_4Ch should match Transform implementation', () => {
            const transform = new Transform();

            // Test various 4D inputs (CMYK-like)
            const testInputs4D = [
                [0.0, 0.0, 0.0, 0.0], // Black point
                [0.5, 0.5, 0.5, 0.5], // Mid-point
                [1.0, 1.0, 1.0, 1.0], // White point
                [0.1, 0.2, 0.3, 0.4], // Regular values
                [0.8, 0.1, 0.6, 0.3], // Mixed values
                [0.0, 1.0, 0.0, 1.0], // Alternating values
            ];

            for (const input of testInputs4D) {
                const originalResult = transform.tetrahedralInterp4D_4Ch(input, testLut4D);
                const refactoredResult = tetrahedralInterp4D_4Ch(input, testLut4D);

                assert.strictEqual(refactoredResult.length, originalResult.length,
                    `Output length mismatch for input ${JSON.stringify(input)}`);

                for (let i = 0; i < originalResult.length; i++) {
                    assert.ok(Math.abs(originalResult[i] - refactoredResult[i]) < 1e-10,
                        `Value mismatch at index ${i} for input ${JSON.stringify(input)}: ` +
                        `original=${originalResult[i]}, refactored=${refactoredResult[i]}`);
                }
            }
        });

        test('linearInterp1D_NCh should match Transform implementation', () => {
            const transform = new Transform();

            for (const input of testInputs1D) {
                const originalResult = transform.linearInterp1D_NCh(input, testLut1D);
                const refactoredResult = linearInterp1D_NCh(input, testLut1D);

                assert.strictEqual(refactoredResult.length, originalResult.length,
                    `Output length mismatch for input ${JSON.stringify(input)}`);

                for (let i = 0; i < originalResult.length; i++) {
                    assert.ok(Math.abs(originalResult[i] - refactoredResult[i]) < 1e-10,
                        `Value mismatch at index ${i} for input ${JSON.stringify(input)}: ` +
                        `original=${originalResult[i]}, refactored=${refactoredResult[i]}`);
                }
            }
        });

        test('bilinearInterp2D_NCh should match Transform implementation', () => {
            const transform = new Transform();

            for (const input of testInputs2D) {
                const originalResult = transform.bilinearInterp2D_NCh(input, testLut2D);
                const refactoredResult = bilinearInterp2D_NCh(input, testLut2D);

                assert.strictEqual(refactoredResult.length, originalResult.length,
                    `Output length mismatch for input ${JSON.stringify(input)}`);

                for (let i = 0; i < originalResult.length; i++) {
                    assert.ok(Math.abs(originalResult[i] - refactoredResult[i]) < 1e-10,
                        `Value mismatch at index ${i} for input ${JSON.stringify(input)}: ` +
                        `original=${originalResult[i]}, refactored=${refactoredResult[i]}`);
                }
            }
        });
    });

    describe('Comprehensive Performance Baseline Tests', () => {

        test('linearInterp1D_NCh performance baseline', () => {
            const transform = new Transform();
            const { refactoredTime, baselineTime } = compareBaselinePerformance({
                operationName: 'linearInterp1D_NCh',
                baselineOperation: s => transform.linearInterp1D_NCh(Array(1).fill(s), testLut1D),
                refactoredOperation: s => linearInterp1D_NCh(Array(1).fill(s), testLut1D),
            });

            // Refactored version should not be significantly slower (allow 20% overhead)
            refactoredTime < baselineTime * 1.2 || console.warn(`Refactored version is slower: ${refactoredTime}ms vs ${baselineTime}ms`);
            assert.ok(refactoredTime < baselineTime * 2, `Refactored version should not be significantly slower: ${refactoredTime}ms vs ${baselineTime}ms`);
        });

        test('bilinearInterp2D_NCh performance baseline', () => {
            const transform = new Transform();
            const { refactoredTime, baselineTime } = compareBaselinePerformance({
                operationName: 'bilinearInterp2D_NCh',
                baselineOperation: s => transform.bilinearInterp2D_NCh(Array(2).fill(s), testLut2D),
                refactoredOperation: s => bilinearInterp2D_NCh(Array(2).fill(s), testLut2D),
            });

            // Refactored version should not be significantly slower (allow 20% overhead)
            refactoredTime < baselineTime * 1.2 || console.warn(`Refactored version is slower: ${refactoredTime}ms vs ${baselineTime}ms`);
            assert.ok(refactoredTime < baselineTime * 2, `Refactored version should not be significantly slower: ${refactoredTime}ms vs ${baselineTime}ms`);
        });

        test('tetrahedralInterp3D_NCh performance baseline', () => {
            const transform = new Transform();
            const { refactoredTime, baselineTime } = compareBaselinePerformance({
                operationName: 'tetrahedralInterp3D_NCh',
                baselineOperation: s => transform.tetrahedralInterp3D_NCh(Array(3).fill(s), testLut3D),
                refactoredOperation: s => tetrahedralInterp3D_NCh(Array(3).fill(s), testLut3D),
            });

            // Refactored version should not be significantly slower (allow 20% overhead)
            refactoredTime < baselineTime * 1.2 || console.warn(`Refactored version is slower: ${refactoredTime}ms vs ${baselineTime}ms`);
            assert.ok(refactoredTime < baselineTime * 2, `Refactored version should not be significantly slower: ${refactoredTime}ms vs ${baselineTime}ms`);
        });

        test('tetrahedralInterp4D_3Ch performance baseline', () => {
            const transform = new Transform();
            const { refactoredTime, baselineTime } = compareBaselinePerformance({
                operationName: 'tetrahedralInterp4D_3Ch',
                baselineOperation: s => transform.tetrahedralInterp4D_3Ch(Array(4).fill(s), testLut4D),
                refactoredOperation: s => tetrahedralInterp4D_3Ch(Array(4).fill(s), testLut4D),
            });

            // Refactored version should not be significantly slower (allow 20% overhead)
            refactoredTime < baselineTime * 1.2 || console.warn(`Refactored version is slower: ${refactoredTime}ms vs ${baselineTime}ms`);
            assert.ok(refactoredTime < baselineTime * 2, `Refactored version should not be significantly slower: ${refactoredTime}ms vs ${baselineTime}ms`);
        });

        test('tetrahedralInterp4D_4Ch performance baseline', () => {
            const transform = new Transform();
            const { refactoredTime, baselineTime } = compareBaselinePerformance({
                operationName: 'tetrahedralInterp4D_4Ch',
                baselineOperation: s => transform.tetrahedralInterp4D_4Ch(Array(4).fill(s), testLut4D),
                refactoredOperation: s => tetrahedralInterp4D_4Ch(Array(4).fill(s), testLut4D),
            });

            // Refactored version should not be significantly slower (allow 20% overhead)
            refactoredTime < baselineTime * 1.2 || console.warn(`Refactored version is slower: ${refactoredTime}ms vs ${baselineTime}ms`);
            assert.ok(refactoredTime < baselineTime * 2, `Refactored version should not be significantly slower: ${refactoredTime}ms vs ${baselineTime}ms`);
        });

        test('tetrahedralInterp4D_NCh performance baseline', () => {
            const transform = new Transform();
            const { refactoredTime, baselineTime } = compareBaselinePerformance({
                operationName: 'tetrahedralInterp4D_NCh',
                baselineOperation: s => transform.tetrahedralInterp4D_NCh(Array(4).fill(s), testLut4D),
                refactoredOperation: s => tetrahedralInterp4D_NCh(Array(4).fill(s), testLut4D),
            });

            // Refactored version should not be significantly slower (allow 20% overhead)
            refactoredTime < baselineTime * 1.2 || console.warn(`Refactored version is slower: ${refactoredTime}ms vs ${baselineTime}ms`);
            assert.ok(refactoredTime < baselineTime * 2, `Refactored version should not be significantly slower: ${refactoredTime}ms vs ${baselineTime}ms`);
        });

        test('trilinearInterp4D_3or4Ch performance baseline', () => {
            const transform = new Transform();
            const { refactoredTime, baselineTime } = compareBaselinePerformance({
                operationName: 'trilinearInterp4D_3or4Ch',
                baselineOperation: s => transform.trilinearInterp4D_3or4Ch(Array(4).fill(s), testLut4D),
                refactoredOperation: s => trilinearInterp4D_3or4Ch(Array(4).fill(s), testLut4D),
            });

            // Refactored version should not be significantly slower (allow 20% overhead)
            refactoredTime < baselineTime * 1.2 || console.warn(`Refactored version is slower: ${refactoredTime}ms vs ${baselineTime}ms`);
            assert.ok(refactoredTime < baselineTime * 2, `Refactored version should not be significantly slower: ${refactoredTime}ms vs ${baselineTime}ms`);
        });

        test('trilinearInterp3D_3or4Ch performance baseline', () => {
            const transform = new Transform();
            const { refactoredTime, baselineTime } = compareBaselinePerformance({
                operationName: 'trilinearInterp3D_3or4Ch',
                baselineOperation: s => transform.trilinearInterp3D_3or4Ch(Array(3).fill(s), testLut3D, 3),
                refactoredOperation: s => trilinearInterp3D_3or4Ch(Array(3).fill(s), testLut3D, 3),
            });

            // Refactored version should not be significantly slower (allow 20% overhead)
            refactoredTime < baselineTime * 1.2 || console.warn(`Refactored version is slower: ${refactoredTime}ms vs ${baselineTime}ms`);
            assert.ok(refactoredTime < baselineTime * 2, `Refactored version should not be significantly slower: ${refactoredTime}ms vs ${baselineTime}ms`);
        });

        test('tetrahedralInterp3D_Master performance baseline', () => {
            const transform = new Transform();
            const K0Values = [0, 1, 5]; // Test different K0 offsets

            for (const K0 of K0Values) {
                const { refactoredTime, baselineTime } = compareBaselinePerformance({
                    operationName: `tetrahedralInterp3D_Master_K0_${K0}`,
                    baselineOperation: s => transform.tetrahedralInterp3D_Master(Array(3).fill(s), testLut3D, K0),
                    refactoredOperation: s => tetrahedralInterp3D_Master(Array(3).fill(s), testLut3D, K0),
                });

                // Refactored version should not be significantly slower (allow 20% overhead)
                refactoredTime < baselineTime * 1.2 || console.warn(`Refactored version is slower: ${refactoredTime}ms vs ${baselineTime}ms`);
                assert.ok(refactoredTime < baselineTime * 2, `Refactored version should not be significantly slower: ${refactoredTime}ms vs ${baselineTime}ms`);
            }
        });

        test('tetrahedralInterp4D_3or4Ch_Master performance baseline', () => {
            const transform = new Transform();
            const { refactoredTime, baselineTime } = compareBaselinePerformance({
                operationName: 'tetrahedralInterp4D_3or4Ch_Master',
                baselineOperation: s => transform.tetrahedralInterp4D_3or4Ch_Master(Array(4).fill(s), testLut4D),
                refactoredOperation: s => tetrahedralInterp4D_3or4Ch_Master(Array(4).fill(s), testLut4D),
            });

            // Refactored version should not be significantly slower (allow 20% overhead)
            refactoredTime < baselineTime * 1.2 || console.warn(`Refactored version is slower: ${refactoredTime}ms vs ${baselineTime}ms`);
            assert.ok(refactoredTime < baselineTime * 2, `Refactored version should not be significantly slower: ${refactoredTime}ms vs ${baselineTime}ms`);
        });

        test('tetrahedralInterp3D_3or4Ch performance baseline (3Ch)', () => {
            const transform = new Transform();
            const { refactoredTime, baselineTime } = compareBaselinePerformance({
                operationName: 'tetrahedralInterp3D_3or4Ch_3Ch',
                baselineOperation: s => transform.tetrahedralInterp3D_3or4Ch(Array(3).fill(s), testLut3D, 3),
                refactoredOperation: s => tetrahedralInterp3D_3or4Ch(Array(3).fill(s), testLut3D, 3),
            });

            // Refactored version should not be significantly slower (allow 20% overhead)
            refactoredTime < baselineTime * 1.2 || console.warn(`Refactored version is slower: ${refactoredTime}ms vs ${baselineTime}ms`);
            assert.ok(refactoredTime < baselineTime * 2, `Refactored version should not be significantly slower: ${refactoredTime}ms vs ${baselineTime}ms`);
        });

        test('tetrahedralInterp3D_3or4Ch performance baseline (4Ch)', () => {
            const transform = new Transform();
            const testLut3D_4Ch = { ...testLut3D, outputChannels: 4, go0: 4, go1: 17 * 4, go2: 17 * 17 * 4, go3: 17 * 17 * 17 * 4 };
            testLut3D_4Ch.CLUT = new Float64Array(17 * 17 * 17 * 4).map((_, i) => Math.sin(i * 0.01) * 0.5 + 0.5);

            const { refactoredTime, baselineTime } = compareBaselinePerformance({
                operationName: 'tetrahedralInterp3D_3or4Ch_4Ch',
                baselineOperation: s => transform.tetrahedralInterp3D_3or4Ch(Array(3).fill(s), testLut3D_4Ch, 4),
                refactoredOperation: s => tetrahedralInterp3D_3or4Ch(Array(3).fill(s), testLut3D_4Ch, 4),
            });

            // Refactored version should not be significantly slower (allow 20% overhead)
            refactoredTime < baselineTime * 1.2 || console.warn(`Refactored version is slower: ${refactoredTime}ms vs ${baselineTime}ms`);
            assert.ok(refactoredTime < baselineTime * 2, `Refactored version should not be significantly slower: ${refactoredTime}ms vs ${baselineTime}ms`);
        });
    });

    describe('Legacy Interpolation Mode Tests', () => {

        test('useLegacyInterpolation option should exist and work', () => {
            // Test with legacy mode disabled (default)
            const transformModern = new Transform({ useLegacyInterpolation: false });
            assert.strictEqual(transformModern.useLegacyInterpolation, false);

            // Test with legacy mode enabled
            const transformLegacy = new Transform({ useLegacyInterpolation: true });
            assert.strictEqual(transformLegacy.useLegacyInterpolation, true);

            // Test default (should be false)
            const transformDefault = new Transform();
            assert.strictEqual(transformDefault.useLegacyInterpolation, false);
        });

        test('both modes should produce identical results for trilinearInterp3D_NCh', () => {
            const transformModern = new Transform({ useLegacyInterpolation: false });
            const transformLegacy = new Transform({ useLegacyInterpolation: true });

            for (const input of testInputs3D) {
                const modernResult = transformModern.trilinearInterp3D_NCh(input, testLut3D);
                const legacyResult = transformLegacy.trilinearInterp3D_NCh(input, testLut3D);

                assert.strictEqual(modernResult.length, legacyResult.length);

                for (let i = 0; i < modernResult.length; i++) {
                    assert.ok(Math.abs(modernResult[i] - legacyResult[i]) < 1e-10,
                        `Value mismatch at index ${i} for input ${JSON.stringify(input)}: ` +
                        `modern=${modernResult[i]}, legacy=${legacyResult[i]}`);
                }
            }
        });

        test('both modes should produce identical results for tetrahedralInterp3D_3Ch', () => {
            const transformModern = new Transform({ useLegacyInterpolation: false });
            const transformLegacy = new Transform({ useLegacyInterpolation: true });

            for (const input of testInputs3D) {
                const modernResult = transformModern.tetrahedralInterp3D_3Ch(input, testLut3D);
                const legacyResult = transformLegacy.tetrahedralInterp3D_3Ch(input, testLut3D);

                assert.strictEqual(modernResult.length, legacyResult.length);

                for (let i = 0; i < modernResult.length; i++) {
                    assert.ok(Math.abs(modernResult[i] - legacyResult[i]) < 1e-10,
                        `Value mismatch at index ${i} for input ${JSON.stringify(input)}: ` +
                        `modern=${modernResult[i]}, legacy=${legacyResult[i]}`);
                }
            }
        });

        test('both modes should produce identical results for tetrahedralInterp3D_4Ch', () => {
            const transformModern = new Transform({ useLegacyInterpolation: false });
            const transformLegacy = new Transform({ useLegacyInterpolation: true });
            const testLut3D_4Ch = { ...testLut3D, outputChannels: 4, go0: 4, go1: 17 * 4, go2: 17 * 17 * 4, go3: 17 * 17 * 17 * 4 };
            testLut3D_4Ch.CLUT = new Float64Array(17 * 17 * 17 * 4).map((_, i) => Math.sin(i * 0.01) * 0.5 + 0.5);

            for (const input of testInputs3D) {
                const modernResult = transformModern.tetrahedralInterp3D_4Ch(input, testLut3D_4Ch);
                const legacyResult = transformLegacy.tetrahedralInterp3D_4Ch(input, testLut3D_4Ch);

                assert.strictEqual(modernResult.length, legacyResult.length);

                for (let i = 0; i < modernResult.length; i++) {
                    assert.ok(Math.abs(modernResult[i] - legacyResult[i]) < 1e-10,
                        `Value mismatch at index ${i} for input ${JSON.stringify(input)}: ` +
                        `modern=${modernResult[i]}, legacy=${legacyResult[i]}`);
                }
            }
        });

        test('both modes should produce identical results for tetrahedralInterp3D_3or4Ch', () => {
            const transformModern = new Transform({ useLegacyInterpolation: false });
            const transformLegacy = new Transform({ useLegacyInterpolation: true });

            // Test with 3 channels
            for (const input of testInputs3D) {
                const modernResult = transformModern.tetrahedralInterp3D_3or4Ch(input, testLut3D, 3);
                const legacyResult = transformLegacy.tetrahedralInterp3D_3or4Ch(input, testLut3D, 3);

                assert.strictEqual(modernResult.length, legacyResult.length);

                for (let i = 0; i < modernResult.length; i++) {
                    assert.ok(Math.abs(modernResult[i] - legacyResult[i]) < 1e-10,
                        `3Ch: Value mismatch at index ${i} for input ${JSON.stringify(input)}: ` +
                        `modern=${modernResult[i]}, legacy=${legacyResult[i]}`);
                }
            }

            // Test with 4 channels
            const testLut3D_4Ch = { ...testLut3D, outputChannels: 4, go0: 4, go1: 17 * 4, go2: 17 * 17 * 4, go3: 17 * 17 * 17 * 4 };
            testLut3D_4Ch.CLUT = new Float64Array(17 * 17 * 17 * 4).map((_, i) => Math.sin(i * 0.01) * 0.5 + 0.5);

            for (const input of testInputs3D) {
                const modernResult = transformModern.tetrahedralInterp3D_3or4Ch(input, testLut3D_4Ch, 4);
                const legacyResult = transformLegacy.tetrahedralInterp3D_3or4Ch(input, testLut3D_4Ch, 4);

                assert.strictEqual(modernResult.length, legacyResult.length);

                for (let i = 0; i < modernResult.length; i++) {
                    assert.ok(Math.abs(modernResult[i] - legacyResult[i]) < 1e-10,
                        `4Ch: Value mismatch at index ${i} for input ${JSON.stringify(input)}: ` +
                        `modern=${modernResult[i]}, legacy=${legacyResult[i]}`);
                }
            }
        });
    });
});
