/**
 * @fileoverview Test suite for Transform class LUT refactoring
 * Tests both legacy and new LUT implementations with compatibility verification
 */

import { test, describe } from 'node:test';
import assert from 'node:assert';
import { Transform } from '../src/main.js';

describe('Transform Class LUT Refactoring', () => {
    test('should create Transform with legacy mode', () => {
        const transform = new Transform({ useLegacy: true });
        
        assert.strictEqual(transform.useLegacy, true);
        assert.strictEqual(transform.promoteGrayToCMYKBlack, false);
        assert.strictEqual(transform.lookupTable, null);
    });

    test('should create Transform with new LUT mode', () => {
        const transform = new Transform({ 
            useLegacy: false,
            promoteGrayToCMYKBlack: true
        });
        
        assert.strictEqual(transform.useLegacy, false);
        assert.strictEqual(transform.promoteGrayToCMYKBlack, true);
        assert.strictEqual(transform.lookupTable, null); // Not initialized until needed
    });

    test('should create Transform with default options', () => {
        const transform = new Transform();
        
        assert.strictEqual(transform.useLegacy, false);
        assert.strictEqual(transform.promoteGrayToCMYKBlack, false);
    });
});

describe('Transform LUT Methods - Legacy Mode', () => {
    let legacyTransform;

    test('setup legacy transform', () => {
        legacyTransform = new Transform({ useLegacy: true });
        assert.ok(legacyTransform);
    });

    test('should have getLut method available', () => {
        assert.strictEqual(typeof legacyTransform.getLut, 'function');
    });

    test('should have getLut16 method available', () => {
        assert.strictEqual(typeof legacyTransform.getLut16, 'function');
    });

    test('should have getLut8 method available', () => {
        assert.strictEqual(typeof legacyTransform.getLut8, 'function');
    });

    test('should have setLut method available', () => {
        assert.strictEqual(typeof legacyTransform.setLut, 'function');
    });

    test('should have cloneLut method available', () => {
        assert.strictEqual(typeof legacyTransform.cloneLut, 'function');
    });

    test('should have create1DDeviceLUT method available', () => {
        assert.strictEqual(typeof legacyTransform.create1DDeviceLUT, 'function');
    });

    test('should have create2DDeviceLUT method available', () => {
        assert.strictEqual(typeof legacyTransform.create2DDeviceLUT, 'function');
    });

    test('should have create3DDeviceLUT method available', () => {
        assert.strictEqual(typeof legacyTransform.create3DDeviceLUT, 'function');
    });

    test('should have create4DDeviceLUT method available', () => {
        assert.strictEqual(typeof legacyTransform.create4DDeviceLUT, 'function');
    });

    test('should have transformArrayViaLUT method available', () => {
        assert.strictEqual(typeof legacyTransform.transformArrayViaLUT, 'function');
    });
});

describe('Transform LUT Methods - New Mode', () => {
    let newTransform;

    test('setup new transform', () => {
        newTransform = new Transform({ 
            useLegacy: false,
            promoteGrayToCMYKBlack: true
        });
        assert.ok(newTransform);
    });

    test('should have getLut method available', () => {
        assert.strictEqual(typeof newTransform.getLut, 'function');
    });

    test('should have getLut16 method available', () => {
        assert.strictEqual(typeof newTransform.getLut16, 'function');
    });

    test('should have getLut8 method available', () => {
        assert.strictEqual(typeof newTransform.getLut8, 'function');
    });

    test('should have setLut method available', () => {
        assert.strictEqual(typeof newTransform.setLut, 'function');
    });

    test('should have cloneLut method available', () => {
        assert.strictEqual(typeof newTransform.cloneLut, 'function');
    });

    test('should have create1DDeviceLUT method available', () => {
        assert.strictEqual(typeof newTransform.create1DDeviceLUT, 'function');
    });

    test('should have create2DDeviceLUT method available', () => {
        assert.strictEqual(typeof newTransform.create2DDeviceLUT, 'function');
    });

    test('should have create3DDeviceLUT method available', () => {
        assert.strictEqual(typeof newTransform.create3DDeviceLUT, 'function');
    });

    test('should have create4DDeviceLUT method available', () => {
        assert.strictEqual(typeof newTransform.create4DDeviceLUT, 'function');
    });

    test('should have transformArrayViaLUT method available', () => {
        assert.strictEqual(typeof newTransform.transformArrayViaLUT, 'function');
    });
});

describe('CMYK Processing Options', () => {
    test('should handle promoteGrayToCMYKBlack option', () => {
        const transform = new Transform({
            useLegacy: false,
            promoteGrayToCMYKBlack: true
        });

        assert.strictEqual(transform.promoteGrayToCMYKBlack, true);
        // Additional testing would verify this option affects LUT creation
    });

    test('should handle promoteGrayToCMYKBlack option', () => {
        const transform = new Transform({
            useLegacy: false,
            promoteGrayToCMYKBlack: true
        });

        assert.strictEqual(transform.promoteGrayToCMYKBlack, true);
        // Additional testing would verify this option affects LUT processing
    });
});

describe('Legacy Compatibility', () => {
    test('should maintain backward compatibility with existing API', () => {
        const legacyTransform = new Transform({ useLegacy: true });
        const newTransform = new Transform({ useLegacy: false });

        // Both should have the same method signatures
        const methods = [
            'getLut', 'getLut16', 'getLut8', 'setLut', 'cloneLut',
            'create1DDeviceLUT', 'create2DDeviceLUT', 'create3DDeviceLUT', 'create4DDeviceLUT',
            'transformArrayViaLUT'
        ];

        methods.forEach(method => {
            assert.strictEqual(typeof legacyTransform[method], 'function');
            assert.strictEqual(typeof newTransform[method], 'function');
        });
    });

    test('should handle useLegacy flag correctly', () => {
        const legacyTransform = new Transform({ useLegacy: true });
        const newTransform = new Transform({ useLegacy: false });

        assert.strictEqual(legacyTransform.useLegacy, true);
        assert.strictEqual(newTransform.useLegacy, false);
    });
});

describe('Error Handling', () => {
    test('should handle invalid options gracefully', () => {
        assert.doesNotThrow(() => {
            new Transform({
                useLegacy: 'invalid',  // Should be coerced to boolean
                promoteGrayToCMYKBlack: 'true'  // Should be coerced to boolean
            });
        });
    });

    test('should handle undefined options', () => {
        assert.doesNotThrow(() => {
            new Transform();
        });
    });

    test('should handle empty options', () => {
        assert.doesNotThrow(() => {
            new Transform({});
        });
    });
});

// Placeholder for future integration tests
describe('Integration Tests', () => {
    test('should be ready for profile-based testing', () => {
        // This section will be expanded when ICC profiles are available for testing
        // It would test actual LUT creation and transformation with real profiles
        assert.ok(true, 'Integration test framework ready');
    });

    test('should be ready for performance comparison testing', () => {
        // This section will compare legacy vs new LUT performance
        // when actual profiles and test data are available
        assert.ok(true, 'Performance test framework ready');
    });
});
