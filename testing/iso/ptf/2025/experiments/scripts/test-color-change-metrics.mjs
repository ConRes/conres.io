#!/usr/bin/env node
// @ts-check
/**
 * Unit tests for ColorChangeMetrics class.
 *
 * Tests:
 * 1. Static metadata - metricName, metricDefinitions
 * 2. Specification management - setInputSpec, addOutputSpec
 * 3. Verification management - addVerification, reset
 * 4. Static utility methods - valuesMatchWithinTolerance, positionKey, parsePositionKey
 * 5. Metrics computation - getMetrics, passedCount, failedCount, passRate
 * 6. Serialization - toJSON, fromJSON, toTransferable, fromTransferable
 */

import { ColorChangeMetrics } from '../classes/color-change-metrics.mjs';

let passed = 0;
let failed = 0;

function assert(condition, message) {
    if (condition) {
        passed++;
        console.log(`   PASS: ${message}`);
    } else {
        failed++;
        console.log(`   FAIL: ${message}`);
    }
}

function assertThrows(fn, expectedMessage, testMessage) {
    try {
        fn();
        failed++;
        console.log(`   FAIL: ${testMessage} (expected to throw)`);
    } catch (e) {
        if (expectedMessage && !e.message.includes(expectedMessage)) {
            failed++;
            console.log(`   FAIL: ${testMessage} (wrong error: ${e.message})`);
        } else {
            passed++;
            console.log(`   PASS: ${testMessage}`);
        }
    }
}

console.log('Testing ColorChangeMetrics...\n');

// ============================================================================
// Test 1: Static Metadata
// ============================================================================

console.log('1. Static Metadata');
console.log('   ' + '-'.repeat(50));

assert(
    ColorChangeMetrics.metricName === 'Color',
    'metricName is "Color"'
);

assert(
    ColorChangeMetrics.metricDefinitions.resource === 'Contents',
    'resource is "Contents"'
);

assert(
    Array.isArray(ColorChangeMetrics.metricDefinitions.defaults.tolerances),
    'defaults.tolerances is an array'
);

assert(
    ColorChangeMetrics.metricDefinitions.defaults.tolerances.length === 4,
    'defaults.tolerances has 4 elements (CMYK)'
);

assert(
    ColorChangeMetrics.metricDefinitions.toleranceTypes.exact !== undefined,
    'toleranceTypes.exact is defined'
);

assert(
    ColorChangeMetrics.metricDefinitions.toleranceTypes.loose !== undefined,
    'toleranceTypes.loose is defined'
);

assert(
    ColorChangeMetrics.metricDefinitions.colorspaceCategories.device.includes('DeviceCMYK'),
    'colorspaceCategories.device includes DeviceCMYK'
);

console.log('');

// ============================================================================
// Test 2: Specification Management
// ============================================================================

console.log('2. Specification Management');
console.log('   ' + '-'.repeat(50));

const metrics1 = new ColorChangeMetrics();

assert(
    metrics1.inputSpec === null,
    'inputSpec is null initially'
);

metrics1.setInputSpec({ colorspace: 'DeviceGray', values: [0.5] });
assert(
    metrics1.inputSpec !== null && metrics1.inputSpec.colorspace === 'DeviceGray',
    'setInputSpec sets the input spec'
);

assert(
    metrics1.inputSpec.values[0] === 0.5,
    'inputSpec values are correct'
);

metrics1.addOutputSpec('Main Thread', {
    colorspace: 'DeviceCMYK',
    values: [0, 0, 0, 0.5],
    tolerances: [0.01, 0.01, 0.01, 0.01],
});

assert(
    metrics1.getOutputSpec('Main Thread') !== undefined,
    'addOutputSpec adds spec for pair member'
);

assert(
    metrics1.getOutputSpec('Main Thread')?.colorspace === 'DeviceCMYK',
    'getOutputSpec returns correct colorspace'
);

assert(
    metrics1.outputSpecs.size === 1,
    'outputSpecs map has correct size'
);

// Test tolerance count validation
assertThrows(
    () => metrics1.addOutputSpec('Bad Spec', {
        colorspace: 'DeviceCMYK',
        values: [0, 0, 0, 0.5],
        tolerances: [0.01, 0.01], // Wrong count
    }),
    'Tolerance count',
    'addOutputSpec throws when tolerance count mismatches value count'
);

console.log('');

// ============================================================================
// Test 3: Static Utility Methods
// ============================================================================

console.log('3. Static Utility Methods');
console.log('   ' + '-'.repeat(50));

// valuesMatchWithinTolerance
assert(
    ColorChangeMetrics.valuesMatchWithinTolerance([0.5, 0.5], [0.5, 0.5], [0, 0]) === true,
    'valuesMatchWithinTolerance: exact match'
);

assert(
    ColorChangeMetrics.valuesMatchWithinTolerance([0.5, 0.5], [0.51, 0.49], [0.02, 0.02]) === true,
    'valuesMatchWithinTolerance: within tolerance'
);

assert(
    ColorChangeMetrics.valuesMatchWithinTolerance([0.5, 0.5], [0.6, 0.5], [0.05, 0.05]) === false,
    'valuesMatchWithinTolerance: outside tolerance'
);

assert(
    ColorChangeMetrics.valuesMatchWithinTolerance([0.5], [0.5, 0.5], [0, 0]) === false,
    'valuesMatchWithinTolerance: different lengths'
);

// positionKey
assert(
    ColorChangeMetrics.positionKey({ pageNum: 1, streamIndex: 2, operatorIndex: 3 }) === '1:2:3',
    'positionKey creates correct key'
);

// parsePositionKey
const parsedPos = ColorChangeMetrics.parsePositionKey('5:10:15');
assert(
    parsedPos.pageNum === 5 && parsedPos.streamIndex === 10 && parsedPos.operatorIndex === 15,
    'parsePositionKey parses correctly'
);

console.log('');

// ============================================================================
// Test 4: Verification Management
// ============================================================================

console.log('4. Verification Management');
console.log('   ' + '-'.repeat(50));

const metrics2 = new ColorChangeMetrics();
metrics2.setInputSpec({ colorspace: 'DeviceGray', values: [0.0] });
metrics2.addOutputSpec('A', {
    colorspace: 'DeviceCMYK',
    values: [0, 0, 0, 1.0],
    tolerances: [0.01, 0.01, 0.01, 0.01],
});
metrics2.addOutputSpec('B', {
    colorspace: 'DeviceCMYK',
    values: [0, 0, 0, 1.0],
    tolerances: [0.01, 0.01, 0.01, 0.01],
});

assert(
    metrics2.verificationCount === 0,
    'verificationCount is 0 initially'
);

// Add a passing verification
metrics2.addVerification(
    { pageNum: 1, streamIndex: 0, operatorIndex: 0 },
    { pageNum: 1, streamIndex: 0, operatorIndex: 0, operator: 'g', colorspace: 'DeviceGray', values: [0.0], index: 0 },
    {
        A: { pageNum: 1, streamIndex: 0, operatorIndex: 0, operator: 'k', colorspace: 'DeviceCMYK', values: [0, 0, 0, 1.0], index: 0 },
        B: { pageNum: 1, streamIndex: 0, operatorIndex: 0, operator: 'k', colorspace: 'DeviceCMYK', values: [0, 0, 0, 1.0], index: 0 },
    }
);

assert(
    metrics2.verificationCount === 1,
    'verificationCount is 1 after adding verification'
);

assert(
    metrics2.passedCount === 1,
    'passedCount is 1 for passing verification'
);

assert(
    metrics2.failedCount === 0,
    'failedCount is 0 for passing verification'
);

// Add a failing verification (values outside tolerance)
metrics2.addVerification(
    { pageNum: 1, streamIndex: 0, operatorIndex: 1 },
    { pageNum: 1, streamIndex: 0, operatorIndex: 1, operator: 'g', colorspace: 'DeviceGray', values: [0.0], index: 10 },
    {
        A: { pageNum: 1, streamIndex: 0, operatorIndex: 1, operator: 'k', colorspace: 'DeviceCMYK', values: [0, 0, 0, 0.5], index: 10 }, // Wrong value
        B: { pageNum: 1, streamIndex: 0, operatorIndex: 1, operator: 'k', colorspace: 'DeviceCMYK', values: [0, 0, 0, 1.0], index: 10 },
    }
);

assert(
    metrics2.verificationCount === 2,
    'verificationCount is 2'
);

assert(
    metrics2.passedCount === 1,
    'passedCount remains 1'
);

assert(
    metrics2.failedCount === 1,
    'failedCount is 1 after failing verification'
);

// Add verification with null match (not found)
metrics2.addVerification(
    { pageNum: 1, streamIndex: 0, operatorIndex: 2 },
    { pageNum: 1, streamIndex: 0, operatorIndex: 2, operator: 'g', colorspace: 'DeviceGray', values: [0.0], index: 20 },
    {
        A: null, // Not found
        B: { pageNum: 1, streamIndex: 0, operatorIndex: 2, operator: 'k', colorspace: 'DeviceCMYK', values: [0, 0, 0, 1.0], index: 20 },
    }
);

assert(
    metrics2.failedCount === 2,
    'failedCount is 2 when match is null'
);

// Test reset
metrics2.reset();
assert(
    metrics2.verificationCount === 0,
    'reset clears verifications'
);

console.log('');

// ============================================================================
// Test 5: Metrics Computation
// ============================================================================

console.log('5. Metrics Computation');
console.log('   ' + '-'.repeat(50));

const metrics3 = new ColorChangeMetrics();
metrics3.setInputSpec({ colorspace: 'DeviceRGB', values: [1.0, 0.0, 0.0] });
metrics3.addOutputSpec('Test', {
    colorspace: 'DeviceCMYK',
    values: [0, 1.0, 1.0, 0],
    tolerances: [0.02, 0.02, 0.02, 0.02],
});

// Add passing verification
metrics3.addVerification(
    { pageNum: 1, streamIndex: 0, operatorIndex: 0 },
    { pageNum: 1, streamIndex: 0, operatorIndex: 0, operator: 'rg', colorspace: 'DeviceRGB', values: [1.0, 0.0, 0.0], index: 0 },
    {
        Test: { pageNum: 1, streamIndex: 0, operatorIndex: 0, operator: 'k', colorspace: 'DeviceCMYK', values: [0, 1.0, 1.0, 0], index: 0 },
    }
);

// Add failing verification
metrics3.addVerification(
    { pageNum: 1, streamIndex: 0, operatorIndex: 1 },
    { pageNum: 1, streamIndex: 0, operatorIndex: 1, operator: 'rg', colorspace: 'DeviceRGB', values: [1.0, 0.0, 0.0], index: 10 },
    {
        Test: { pageNum: 1, streamIndex: 0, operatorIndex: 1, operator: 'k', colorspace: 'DeviceCMYK', values: [0, 0.8, 0.8, 0], index: 10 },
    }
);

const result3 = metrics3.getMetrics();

assert(
    result3.inputSpec.colorspace === 'DeviceRGB',
    'getMetrics returns inputSpec'
);

assert(
    result3.outputSpecs.Test !== undefined,
    'getMetrics returns outputSpecs'
);

assert(
    result3.passed === 1 && result3.failed === 1,
    `getMetrics returns correct passed/failed (got ${result3.passed}/${result3.failed})`
);

assert(
    result3.total === 2,
    'getMetrics returns correct total'
);

assert(
    result3.verifications.length === 2,
    'getMetrics includes verifications array'
);

assert(
    result3.verifications[0].passed === true,
    'First verification is marked passed'
);

assert(
    result3.verifications[1].passed === false,
    'Second verification is marked failed'
);

assert(
    metrics3.passRate === 0.5,
    `passRate is 0.5 (got ${metrics3.passRate})`
);

// Test empty metrics
const metricsEmpty = new ColorChangeMetrics();
assert(
    metricsEmpty.passRate === 1,
    'passRate is 1 for empty metrics'
);

console.log('');

// ============================================================================
// Test 6: Serialization
// ============================================================================

console.log('6. Serialization');
console.log('   ' + '-'.repeat(50));

// Setup metrics for serialization tests
const metrics4 = new ColorChangeMetrics();
metrics4.setInputSpec({ colorspace: 'DeviceGray', values: [0.5] });
metrics4.addOutputSpec('Member1', {
    colorspace: 'DeviceCMYK',
    values: [0, 0, 0, 0.5],
    tolerances: [0.01, 0.01, 0.01, 0.01],
});
metrics4.addVerification(
    { pageNum: 2, streamIndex: 1, operatorIndex: 5 },
    { pageNum: 2, streamIndex: 1, operatorIndex: 5, operator: 'g', colorspace: 'DeviceGray', values: [0.5], index: 100 },
    {
        Member1: { pageNum: 2, streamIndex: 1, operatorIndex: 5, operator: 'k', colorspace: 'DeviceCMYK', values: [0, 0, 0, 0.5], index: 100 },
    }
);

// toJSON
const json4 = metrics4.toJSON();
assert(
    json4.metricName === 'Color',
    'toJSON includes metricName'
);

assert(
    json4.inputSpec.colorspace === 'DeviceGray',
    'toJSON includes inputSpec'
);

assert(
    json4.outputSpecs.Member1 !== undefined,
    'toJSON includes outputSpecs'
);

assert(
    json4.result.passed === 1,
    'toJSON includes result with passed count'
);

// fromJSON
const metrics4b = ColorChangeMetrics.fromJSON(json4);
assert(
    metrics4b.inputSpec?.colorspace === 'DeviceGray',
    'fromJSON restores inputSpec'
);

assert(
    metrics4b.getOutputSpec('Member1')?.colorspace === 'DeviceCMYK',
    'fromJSON restores outputSpecs'
);

assert(
    metrics4b.verificationCount === 1,
    'fromJSON restores verifications'
);

// extractResult
const extractedResult = ColorChangeMetrics.extractResult(json4);
assert(
    extractedResult.passed === 1 && extractedResult.failed === 0,
    'extractResult returns the result object'
);

// toTransferable / fromTransferable
const transferable = metrics4.toTransferable();
assert(
    transferable.inputSpec?.colorspace === 'DeviceGray',
    'toTransferable includes inputSpec'
);

assert(
    Array.isArray(transferable.outputSpecs),
    'toTransferable outputSpecs is array'
);

assert(
    transferable.verifications.length === 1,
    'toTransferable includes verifications'
);

const metrics4c = ColorChangeMetrics.fromTransferable(transferable);
assert(
    metrics4c.inputSpec?.colorspace === 'DeviceGray',
    'fromTransferable restores inputSpec'
);

assert(
    metrics4c.getOutputSpec('Member1')?.colorspace === 'DeviceCMYK',
    'fromTransferable restores outputSpecs'
);

assert(
    metrics4c.verificationCount === 1,
    'fromTransferable restores verifications'
);

// toString
const str = metrics4.toString();
assert(
    str.includes('passed: 1') && str.includes('failed: 0'),
    'toString includes passed/failed counts'
);

console.log('');

// ============================================================================
// Test 7: Edge Cases
// ============================================================================

console.log('7. Edge Cases');
console.log('   ' + '-'.repeat(50));

// Colorspace mismatch in verification
const metrics5 = new ColorChangeMetrics();
metrics5.setInputSpec({ colorspace: 'DeviceGray', values: [0.0] });
metrics5.addOutputSpec('Test', {
    colorspace: 'DeviceCMYK',
    values: [0, 0, 0, 1.0],
    tolerances: [0.01, 0.01, 0.01, 0.01],
});

metrics5.addVerification(
    { pageNum: 1, streamIndex: 0, operatorIndex: 0 },
    { pageNum: 1, streamIndex: 0, operatorIndex: 0, operator: 'g', colorspace: 'DeviceGray', values: [0.0], index: 0 },
    {
        Test: { pageNum: 1, streamIndex: 0, operatorIndex: 0, operator: 'rg', colorspace: 'DeviceRGB', values: [0, 0, 0], index: 0 }, // Wrong colorspace
    }
);

assert(
    metrics5.failedCount === 1,
    'Colorspace mismatch results in failure'
);

const result5 = metrics5.getMetrics();
assert(
    result5.verifications[0].outputResults.Test.passed === false,
    'Verification output result shows failure'
);

assert(
    result5.verifications[0].outputResults.Test.differences !== undefined,
    'Colorspace mismatch still computes differences'
);

// Missing output spec throws
const metrics6 = new ColorChangeMetrics();
metrics6.setInputSpec({ colorspace: 'DeviceGray', values: [0.0] });

assertThrows(
    () => metrics6.addVerification(
        { pageNum: 1, streamIndex: 0, operatorIndex: 0 },
        { pageNum: 1, streamIndex: 0, operatorIndex: 0, operator: 'g', colorspace: 'DeviceGray', values: [0.0], index: 0 },
        {
            UndefinedMember: { pageNum: 1, streamIndex: 0, operatorIndex: 0, operator: 'k', colorspace: 'DeviceCMYK', values: [0, 0, 0, 1.0], index: 0 },
        }
    ),
    'No output spec defined',
    'addVerification throws for undefined pair member'
);

console.log('');

// ============================================================================
// Summary
// ============================================================================

console.log('='.repeat(60));
console.log(`Summary: ${passed} passed, ${failed} failed`);
console.log('='.repeat(60));

process.exit(failed > 0 ? 1 : 0);
