#!/usr/bin/env node
// @ts-check
/**
 * Unit tests for ComparisonsCoordinator class.
 *
 * Tests:
 * 1. Registration - register single and multiple metrics
 * 2. Definition consolidation - getConsolidatedDefinitions, getDefinitions
 * 3. Configuration building - createConfiguration
 * 4. Instance creation (factory) - createMetrics
 * 5. Discovery - getMetricsClass, hasMetric, metricNames, size
 * 6. Workflow orchestration - validateAspects, getSupportedResources
 * 7. Integration - Both DeltaEMetrics and ColorChangeMetrics
 */

import { ComparisonsCoordinator } from '../classes/comparisons-coordinator.mjs';
import { DeltaEMetrics } from '../classes/delta-e-metrics.mjs';
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

console.log('Testing ComparisonsCoordinator...\n');

// ============================================================================
// Test 1: Registration
// ============================================================================

console.log('1. Registration');
console.log('   ' + '-'.repeat(50));

const coord1 = new ComparisonsCoordinator();

assert(
    coord1.size === 0,
    'Empty coordinator has size 0'
);

coord1.register(DeltaEMetrics);
assert(
    coord1.size === 1,
    'Size is 1 after registering DeltaEMetrics'
);

assert(
    coord1.hasMetric('Delta-E'),
    'hasMetric returns true for Delta-E'
);

coord1.register(ColorChangeMetrics);
assert(
    coord1.size === 2,
    'Size is 2 after registering ColorChangeMetrics'
);

assert(
    coord1.hasMetric('Color'),
    'hasMetric returns true for Color'
);

// Constructor registration
const coord2 = new ComparisonsCoordinator({
    metrics: [DeltaEMetrics, ColorChangeMetrics],
});
assert(
    coord2.size === 2,
    'Constructor registration works'
);

// registerAll
const coord3 = new ComparisonsCoordinator();
coord3.registerAll(DeltaEMetrics, ColorChangeMetrics);
assert(
    coord3.size === 2,
    'registerAll registers multiple classes'
);

// Invalid registration
assertThrows(
    () => coord1.register(class NoName {}),
    'static metricName',
    'Throws for class without metricName'
);

assertThrows(
    () => coord1.register(class BadDef { static metricName = 'Test'; }),
    'metricDefinitions',
    'Throws for class without metricDefinitions'
);

assertThrows(
    () => coord1.register(class NoResource {
        static metricName = 'Test';
        static metricDefinitions = {};
    }),
    'resource',
    'Throws for class without resource in metricDefinitions'
);

console.log('');

// ============================================================================
// Test 2: Definition Consolidation
// ============================================================================

console.log('2. Definition Consolidation');
console.log('   ' + '-'.repeat(50));

const coord4 = new ComparisonsCoordinator({
    metrics: [DeltaEMetrics, ColorChangeMetrics],
});

const consolidated = coord4.getConsolidatedDefinitions();
assert(
    consolidated['Delta-E'] !== undefined,
    'Consolidated has Delta-E definitions'
);

assert(
    consolidated['Color'] !== undefined,
    'Consolidated has Color definitions'
);

assert(
    consolidated['Delta-E'].resource === 'Image',
    'Delta-E resource is Image'
);

assert(
    consolidated['Color'].resource === 'Contents',
    'Color resource is Contents'
);

// getDefinitions
const deltaEDefs = coord4.getDefinitions('Delta-E');
assert(
    deltaEDefs?.formula === 'CIE76',
    'getDefinitions returns formula for Delta-E'
);

const colorDefs = coord4.getDefinitions('Color');
assert(
    colorDefs?.defaults?.tolerances !== undefined,
    'getDefinitions returns defaults.tolerances for Color'
);

const unknownDefs = coord4.getDefinitions('Unknown');
assert(
    unknownDefs === undefined,
    'getDefinitions returns undefined for unknown metric'
);

console.log('');

// ============================================================================
// Test 3: Configuration Building
// ============================================================================

console.log('3. Configuration Building');
console.log('   ' + '-'.repeat(50));

const coord5 = new ComparisonsCoordinator({
    metrics: [DeltaEMetrics, ColorChangeMetrics],
});

// Delta-E default config
const deltaEConfig = coord5.createConfiguration('Delta-E');
assert(
    deltaEConfig.resource === 'Image',
    'Delta-E config has resource'
);

assert(
    deltaEConfig.formula === 'CIE76',
    'Delta-E config has formula'
);

assert(
    deltaEConfig.threshold === 3.0,
    'Delta-E config has default threshold'
);

// Delta-E with overrides
const deltaEConfigOverride = coord5.createConfiguration('Delta-E', {
    threshold: 5.0,
    metrics: ['Maximum'],
});
assert(
    deltaEConfigOverride.threshold === 5.0,
    'Delta-E config respects threshold override'
);

assert(
    deltaEConfigOverride.metrics.length === 1,
    'Delta-E config respects metrics override'
);

// Color config
const colorConfig = coord5.createConfiguration('Color');
assert(
    colorConfig.resource === 'Contents',
    'Color config has resource'
);

// Unknown metric
assertThrows(
    () => coord5.createConfiguration('Unknown'),
    'Unknown metric',
    'createConfiguration throws for unknown metric'
);

console.log('');

// ============================================================================
// Test 4: Instance Creation (Factory)
// ============================================================================

console.log('4. Instance Creation (Factory)');
console.log('   ' + '-'.repeat(50));

const coord6 = new ComparisonsCoordinator({
    metrics: [DeltaEMetrics, ColorChangeMetrics],
});

// Create DeltaEMetrics instance
const deltaEInstance = coord6.createMetrics('Delta-E', { threshold: 4.0 });
assert(
    deltaEInstance instanceof DeltaEMetrics,
    'createMetrics returns DeltaEMetrics instance'
);

assert(
    deltaEInstance.threshold === 4.0,
    'createMetrics passes threshold parameter'
);

// Create ColorChangeMetrics instance
const colorInstance = coord6.createMetrics('Color');
assert(
    colorInstance instanceof ColorChangeMetrics,
    'createMetrics returns ColorChangeMetrics instance'
);

// Unknown metric
assertThrows(
    () => coord6.createMetrics('Unknown'),
    'Unknown metric',
    'createMetrics throws for unknown metric'
);

console.log('');

// ============================================================================
// Test 5: Discovery
// ============================================================================

console.log('5. Discovery');
console.log('   ' + '-'.repeat(50));

const coord7 = new ComparisonsCoordinator({
    metrics: [DeltaEMetrics, ColorChangeMetrics],
});

// getMetricsClass
const DeltaEClass = coord7.getMetricsClass('Delta-E');
assert(
    DeltaEClass === DeltaEMetrics,
    'getMetricsClass returns DeltaEMetrics'
);

const ColorClass = coord7.getMetricsClass('Color');
assert(
    ColorClass === ColorChangeMetrics,
    'getMetricsClass returns ColorChangeMetrics'
);

const UnknownClass = coord7.getMetricsClass('Unknown');
assert(
    UnknownClass === undefined,
    'getMetricsClass returns undefined for unknown'
);

// metricNames
const names = coord7.metricNames;
assert(
    names.includes('Delta-E') && names.includes('Color'),
    'metricNames includes both registered metrics'
);

assert(
    names.length === 2,
    'metricNames has correct length'
);

// hasMetric
assert(
    coord7.hasMetric('Delta-E') === true,
    'hasMetric returns true for Delta-E'
);

assert(
    coord7.hasMetric('Unknown') === false,
    'hasMetric returns false for Unknown'
);

// Iterator
const iteratedNames = [];
for (const { metricName } of coord7) {
    iteratedNames.push(metricName);
}
assert(
    iteratedNames.length === 2,
    'Iterator yields correct number of entries'
);

console.log('');

// ============================================================================
// Test 6: Workflow Orchestration
// ============================================================================

console.log('6. Workflow Orchestration');
console.log('   ' + '-'.repeat(50));

const coord8 = new ComparisonsCoordinator({
    metrics: [DeltaEMetrics, ColorChangeMetrics],
});

// validateAspects - valid
const validAspects = [
    { type: 'Delta-E', resource: 'Image', metrics: ['Average'] },
    { type: 'Color', resource: 'Contents', input: {} },
];
const validResult = coord8.validateAspects(validAspects);
assert(
    validResult.valid === true,
    'validateAspects returns valid for registered types'
);

assert(
    validResult.missing.length === 0,
    'validateAspects has no missing for registered types'
);

// validateAspects - missing
const missingAspects = [
    { type: 'Delta-E' },
    { type: 'Unknown' },
];
const missingResult = coord8.validateAspects(missingAspects);
assert(
    missingResult.valid === false,
    'validateAspects returns invalid for missing type'
);

assert(
    missingResult.missing.includes('Unknown'),
    'validateAspects lists missing types'
);

// validateAspects - invalid structure
const invalidAspects = [
    { type: 'Delta-E' },
    null,
    { noType: true },
];
const invalidResult = coord8.validateAspects(invalidAspects);
assert(
    invalidResult.invalid.length === 2,
    'validateAspects catches invalid structures'
);

// getSupportedResources
const resources = coord8.getSupportedResources();
assert(
    resources.has('Image'),
    'getSupportedResources includes Image'
);

assert(
    resources.has('Contents'),
    'getSupportedResources includes Contents'
);

assert(
    resources.size === 2,
    'getSupportedResources has correct size'
);

console.log('');

// ============================================================================
// Test 7: Integration - Both Metrics Types
// ============================================================================

console.log('7. Integration - Both Metrics Types');
console.log('   ' + '-'.repeat(50));

const coord9 = new ComparisonsCoordinator({
    metrics: [DeltaEMetrics, ColorChangeMetrics],
});

// Simulate processing mixed aspects
const mixedAspects = [
    { type: 'Delta-E', resource: 'Image', metrics: ['Average', 'Maximum'], threshold: 3.0 },
    { type: 'Color', resource: 'Contents', input: { colorspace: 'DeviceGray', values: [0.0] } },
];

// Validate all aspects first
const mixedValidation = coord9.validateAspects(mixedAspects);
assert(
    mixedValidation.valid === true,
    'Mixed aspects validate successfully'
);

// Create instances for each aspect type
const createdInstances = mixedAspects.map(aspect => {
    const instance = coord9.createMetrics(aspect.type);
    return { type: aspect.type, instance };
});

assert(
    createdInstances[0].instance instanceof DeltaEMetrics,
    'First instance is DeltaEMetrics'
);

assert(
    createdInstances[1].instance instanceof ColorChangeMetrics,
    'Second instance is ColorChangeMetrics'
);

// Check that each instance has appropriate methods
assert(
    typeof createdInstances[0].instance.addPairs === 'function',
    'DeltaEMetrics has addPairs method'
);

assert(
    typeof createdInstances[1].instance.addVerification === 'function',
    'ColorChangeMetrics has addVerification method'
);

// Both can produce results
const deltaEInstance2 = coord9.createMetrics('Delta-E');
deltaEInstance2.addValues([1.5, 2.0, 2.5]);
const deltaEResult = deltaEInstance2.getMetrics();
assert(
    deltaEResult.sampleCount === 3,
    'DeltaEMetrics produces results'
);

const colorInstance2 = coord9.createMetrics('Color');
colorInstance2.setInputSpec({ colorspace: 'DeviceGray', values: [0.0] });
colorInstance2.addOutputSpec('Test', { colorspace: 'DeviceCMYK', values: [0, 0, 0, 1.0], tolerances: [0.01, 0.01, 0.01, 0.01] });
colorInstance2.addVerification(
    { pageNum: 1, streamIndex: 0, operatorIndex: 0 },
    { pageNum: 1, streamIndex: 0, operatorIndex: 0, operator: 'g', colorspace: 'DeviceGray', values: [0.0], index: 0 },
    { Test: { pageNum: 1, streamIndex: 0, operatorIndex: 0, operator: 'k', colorspace: 'DeviceCMYK', values: [0, 0, 0, 1.0], index: 0 } }
);
const colorResult = colorInstance2.getMetrics();
assert(
    colorResult.total === 1 && colorResult.passed === 1,
    'ColorChangeMetrics produces results'
);

// Both serialize correctly
const deltaEJSON = deltaEInstance2.toJSON();
const colorJSON = colorInstance2.toJSON();
assert(
    deltaEJSON.metricName === 'Delta-E' && colorJSON.metricName === 'Color',
    'Both instances serialize with correct metricName'
);

console.log('');

// ============================================================================
// Test 8: Serialization
// ============================================================================

console.log('8. Serialization');
console.log('   ' + '-'.repeat(50));

const coord10 = new ComparisonsCoordinator({
    metrics: [DeltaEMetrics, ColorChangeMetrics],
});

// toJSON
const json = coord10.toJSON();
assert(
    json['Delta-E'] !== undefined && json['Color'] !== undefined,
    'toJSON includes all registered metrics'
);

// toString
const str = coord10.toString();
assert(
    str.includes('Delta-E') && str.includes('Color'),
    'toString includes metric names'
);

console.log('');

// ============================================================================
// Summary
// ============================================================================

console.log('='.repeat(60));
console.log(`Summary: ${passed} passed, ${failed} failed`);
console.log('='.repeat(60));

process.exit(failed > 0 ? 1 : 0);
