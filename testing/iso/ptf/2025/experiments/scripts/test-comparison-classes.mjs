#!/usr/bin/env node
// @ts-check
/**
 * Quick test for comparison classes.
 */

import { ComparisonsCoordinator } from './classes/comparisons-coordinator.mjs';
import { DeltaEMetrics } from './classes/delta-e-metrics.mjs';
import { ImageSampler } from './classes/image-sampler.mjs';
import { ImageLabConverter } from './classes/image-lab-converter.mjs';

console.log('Testing Comparison Classes...\n');

// ============================================================================
// Test 1: ComparisonsCoordinator Registration
// ============================================================================

console.log('1. ComparisonsCoordinator Registration');
console.log('   ' + '-'.repeat(40));

const coordinator = new ComparisonsCoordinator({
    metrics: [DeltaEMetrics],
});

console.log(`   Registered metrics: [${coordinator.metricNames.join(', ')}]`);
console.log(`   Has Delta-E: ${coordinator.hasMetric('Delta-E')}`);
console.log(`   Size: ${coordinator.size}`);

// Test getDefinitions
const defs = coordinator.getDefinitions('Delta-E');
console.log(`   Delta-E resource: ${defs?.resource}`);
console.log(`   Delta-E formula: ${defs?.formula}`);
console.log('   PASS\n');

// ============================================================================
// Test 2: DeltaEMetrics Computation
// ============================================================================

console.log('2. DeltaEMetrics Computation');
console.log('   ' + '-'.repeat(40));

const metrics = coordinator.createMetrics('Delta-E', {
    threshold: 3.0,
    metrics: ['Average', 'Maximum', 'Minimum', 'PassRate'],
});

// Add some test Lab color pairs
const testPairs = [
    [{ L: 50, a: 0, b: 0 }, { L: 50, a: 0, b: 0 }],     // ΔE = 0
    [{ L: 50, a: 0, b: 0 }, { L: 51, a: 0, b: 0 }],     // ΔE = 1
    [{ L: 50, a: 0, b: 0 }, { L: 52, a: 0, b: 0 }],     // ΔE = 2
    [{ L: 50, a: 0, b: 0 }, { L: 55, a: 0, b: 0 }],     // ΔE = 5 (fails threshold)
    [{ L: 50, a: 0, b: 0 }, { L: 50, a: 3, b: 4 }],     // ΔE = 5 (fails threshold)
];

metrics.addPairs(testPairs);
metrics.setSamplingMethod('Test');

const result = metrics.getMetrics();
console.log(`   Formula: ${result.formula}`);
console.log(`   Sample count: ${result.sampleCount}`);
console.log(`   Threshold: ${result.threshold}`);
console.log(`   Metrics:`);
for (const m of result.metrics) {
    console.log(`     ${m.name}: ${m.value.toFixed(4)}`);
}

// Verify expected values
const expected = {
    average: (0 + 1 + 2 + 5 + 5) / 5, // 2.6
    maximum: 5,
    minimum: 0,
    passrate: 3 / 5, // 60%
};

const avgMatch = Math.abs(result.metrics.find(m => m.type === 'average')?.value - expected.average) < 0.001;
const maxMatch = result.metrics.find(m => m.type === 'maximum')?.value === expected.maximum;
const minMatch = result.metrics.find(m => m.type === 'minimum')?.value === expected.minimum;
const passMatch = Math.abs(result.metrics.find(m => m.type === 'passrate')?.value - expected.passrate) < 0.001;

console.log(`   Verification: avg=${avgMatch}, max=${maxMatch}, min=${minMatch}, pass=${passMatch}`);
console.log(`   ${avgMatch && maxMatch && minMatch && passMatch ? 'PASS' : 'FAIL'}\n`);

// ============================================================================
// Test 3: ImageSampler
// ============================================================================

console.log('3. ImageSampler');
console.log('   ' + '-'.repeat(40));

const sampler = new ImageSampler({
    sampling: { type: 'random', count: 100, seed: 42 },
});

const samplingResult = sampler.sample(100, 100); // 10000 pixels
console.log(`   Method: ${samplingResult.method}`);
console.log(`   Total pixels: ${samplingResult.totalPixels}`);
console.log(`   Sampled count: ${samplingResult.sampledCount}`);
console.log(`   Sample indices (first 5): [${samplingResult.indices.slice(0, 5).join(', ')}]`);

// Verify reproducibility (same seed should give same results)
const sampler2 = new ImageSampler({
    sampling: { type: 'random', count: 100, seed: 42 },
});
const result2 = sampler2.sample(100, 100);
const reproducible = samplingResult.indices.every((v, i) => v === result2.indices[i]);
console.log(`   Reproducible (same seed): ${reproducible}`);
console.log(`   ${samplingResult.sampledCount === 100 && reproducible ? 'PASS' : 'FAIL'}\n`);

// ============================================================================
// Test 4: ImageLabConverter (construction only - no engine test)
// ============================================================================

console.log('4. ImageLabConverter (construction)');
console.log('   ' + '-'.repeat(40));

const converter = new ImageLabConverter({
    intent: 'relative-colorimetric',
    blackPointCompensation: true,
});

const options = converter.getOptions();
console.log(`   Intent: ${options.intent}`);
console.log(`   BPC: ${options.blackPointCompensation}`);
console.log(`   Initialized: ${converter.isInitialized}`);

// Test factory from metricDefinitions
const converter2 = ImageLabConverter.fromMetricDefinitions(DeltaEMetrics.metricDefinitions);
const options2 = converter2.getOptions();
console.log(`   From metricDefinitions intent: ${options2.intent}`);
console.log(`   PASS\n`);

// ============================================================================
// Test 5: Serialization
// ============================================================================

console.log('5. Serialization');
console.log('   ' + '-'.repeat(40));

// Test DeltaEMetrics serialization
const transferable = metrics.toTransferable();
console.log(`   Transferable keys: [${Object.keys(transferable).join(', ')}]`);

const revived = DeltaEMetrics.fromTransferable(transferable);
const revivedResult = revived.getMetrics();
console.log(`   Revived sample count: ${revivedResult.sampleCount}`);
console.log(`   Revived average: ${revivedResult.metrics.find(m => m.type === 'average')?.value.toFixed(4)}`);

const serializationMatch = revivedResult.sampleCount === result.sampleCount;
console.log(`   ${serializationMatch ? 'PASS' : 'FAIL'}\n`);

// ============================================================================
// Test 6: Coordinator toJSON
// ============================================================================

console.log('6. Coordinator Consolidation');
console.log('   ' + '-'.repeat(40));

const consolidated = coordinator.getConsolidatedDefinitions();
console.log(`   Consolidated keys: [${Object.keys(consolidated).join(', ')}]`);
console.log(`   Delta-E in consolidated: ${'Delta-E' in consolidated}`);

const config = coordinator.createConfiguration('Delta-E', {
    threshold: 5.0,
    metrics: ['Average'],
});
console.log(`   Created config threshold: ${config.threshold}`);
console.log(`   Created config metrics: ${JSON.stringify(config.metrics)}`);
console.log('   PASS\n');

// ============================================================================
// Summary
// ============================================================================

console.log('=' .repeat(50));
console.log('All tests completed.');
