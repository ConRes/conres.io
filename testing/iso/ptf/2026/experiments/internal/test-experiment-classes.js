#!/usr/bin/env node
// @ts-check
/**
 * Test Experiment Classes — Consolidated test runner for experiments/classes/.
 *
 * Usage:
 *   node test-experiment-classes.js [--suite=<name>] [--verbose]
 *
 * Suites:
 *   --suite=all                          Run all suites (default)
 *   --suite=color-change-metrics         Test ColorChangeMetrics
 *   --suite=comparison-classes           Test ComparisonsCoordinator + DeltaEMetrics + ImageSampler + ImageLabConverter
 *   --suite=content-stream-extractor     Test ContentStreamColorExtractor
 *   --suite=delta-e                      Test Delta-E computation with real PDFs
 *   --suite=comparisons-coordinator      Test ComparisonsCoordinator registration and lifecycle
 *
 * @module test-experiment-classes
 * @author Saleh Abdel Motaal <dev@smotaal.io>
 * @ai Claude Opus 4.6 (code generation)
 */
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLASSES_DIR = join(__dirname, '..', 'classes');

const { values: options, positionals } = parseArgs({
    args: process.argv.slice(2).filter(arg => arg.length > 0),
    allowPositionals: true,
    strict: true,
    options: {
        'suite': { type: 'string', default: 'all' },
        'verbose': { type: 'boolean', short: 'v', default: false },
        'help': { type: 'boolean', short: 'h', default: false },
    },
});

const SUITES = ['all', 'color-change-metrics', 'comparison-classes', 'content-stream-extractor', 'delta-e', 'comparisons-coordinator'];

if (options['help']) {
    console.log(`
Test Experiment Classes — Consolidated test runner for experiments/classes/.

Usage:
  node test-experiment-classes.js [--suite=<name>] [--verbose]

Suites:
  ${SUITES.map(s => `--suite=${s}`).join('\n  ')}

Options:
  -v, --verbose     Verbose output
  -h, --help        Show this help message
`);
    process.exit(0);
}

const suiteName = options['suite'] ?? 'all';
const verbose = options['verbose'] ?? false;

if (!SUITES.includes(suiteName)) {
    console.error(`Unknown suite: "${suiteName}". Available: ${SUITES.join(', ')}`);
    process.exit(1);
}

let passed = 0;
let failed = 0;

function assert(condition, message) {
    if (condition) {
        passed++;
        if (verbose) console.log(`  ✓ ${message}`);
    } else {
        failed++;
        console.log(`  ✗ FAIL: ${message}`);
    }
}

// ============================================================================
// Suite: color-change-metrics
// ============================================================================

async function runColorChangeMetrics() {
    console.log('\n=== Suite: color-change-metrics ===\n');
    const { ColorChangeMetrics } = await import(join(CLASSES_DIR, 'color-change-metrics.mjs'));

    assert(typeof ColorChangeMetrics === 'function', 'ColorChangeMetrics is a class');
    assert(typeof ColorChangeMetrics.metricName === 'string', 'Has static metricName');
    assert(typeof ColorChangeMetrics.metricDefinitions === 'object' && ColorChangeMetrics.metricDefinitions !== null, 'Has static metricDefinitions');
    assert(Object.keys(ColorChangeMetrics.metricDefinitions).length > 0, 'metricDefinitions is non-empty');

    const instance = new ColorChangeMetrics();
    assert(typeof instance.addVerification === 'function', 'Instance has addVerification method');
    assert(typeof instance.getMetrics === 'function', 'Instance has getMetrics method');

    console.log(`  ${Object.keys(ColorChangeMetrics.metricDefinitions).length} metric definitions found`);
}

// ============================================================================
// Suite: comparison-classes
// ============================================================================

async function runComparisonClasses() {
    console.log('\n=== Suite: comparison-classes ===\n');

    const { ComparisonsCoordinator } = await import(join(CLASSES_DIR, 'comparisons-coordinator.mjs'));
    const { DeltaEMetrics } = await import(join(CLASSES_DIR, 'delta-e-metrics.mjs'));
    const { ImageSampler } = await import(join(CLASSES_DIR, 'image-sampler.mjs'));
    const { ImageLabConverter } = await import(join(CLASSES_DIR, 'image-lab-converter.mjs'));

    assert(typeof ComparisonsCoordinator === 'function', 'ComparisonsCoordinator is a class');
    assert(typeof DeltaEMetrics === 'function', 'DeltaEMetrics is a class');
    assert(typeof ImageSampler === 'function', 'ImageSampler is a class');
    assert(typeof ImageLabConverter === 'function', 'ImageLabConverter is a class');

    // Test coordinator registration
    const coordinator = new ComparisonsCoordinator();
    coordinator.register(DeltaEMetrics);
    assert(coordinator.metricNames.length === 1, 'Registered 1 metric class');

    // Test DeltaEMetrics static metadata
    assert(typeof DeltaEMetrics.metricName === 'string', 'DeltaEMetrics has metricName');
    assert(typeof DeltaEMetrics.metricDefinitions === 'object' && DeltaEMetrics.metricDefinitions !== null, 'DeltaEMetrics has metricDefinitions');
}

// ============================================================================
// Suite: comparisons-coordinator
// ============================================================================

async function runComparisonsCoordinator() {
    console.log('\n=== Suite: comparisons-coordinator ===\n');

    const { ComparisonsCoordinator } = await import(join(CLASSES_DIR, 'comparisons-coordinator.mjs'));
    const { DeltaEMetrics } = await import(join(CLASSES_DIR, 'delta-e-metrics.mjs'));
    const { ColorChangeMetrics } = await import(join(CLASSES_DIR, 'color-change-metrics.mjs'));

    // Registration
    const coordinator = new ComparisonsCoordinator();
    coordinator.register(DeltaEMetrics);
    coordinator.register(ColorChangeMetrics);
    assert(coordinator.metricNames.length === 2, 'Registered 2 metric classes');

    // Metric names
    assert(coordinator.metricNames.includes(DeltaEMetrics.metricName), `Registered "${DeltaEMetrics.metricName}"`);
    assert(coordinator.metricNames.includes(ColorChangeMetrics.metricName), `Registered "${ColorChangeMetrics.metricName}"`);

    if (verbose) {
        for (const name of coordinator.metricNames) {
            console.log(`    Registered: ${name}`);
        }
    }
}

// ============================================================================
// Suite: content-stream-extractor
// ============================================================================

async function runContentStreamExtractor() {
    console.log('\n=== Suite: content-stream-extractor ===\n');

    const { ContentStreamColorExtractor } = await import(join(CLASSES_DIR, 'content-stream-color-extractor.mjs'));

    assert(typeof ContentStreamColorExtractor === 'function', 'ContentStreamColorExtractor is a class');
    assert(typeof ContentStreamColorExtractor.extractColors === 'function', 'Has static extractColors method');
    assert(typeof ContentStreamColorExtractor.extractColorSpaceDefinitions === 'function', 'Has static extractColorSpaceDefinitions method');

    // Verify the underlying parser is accessible
    const { parseContentStream, getColorOperations } = await import(join(CLASSES_DIR, 'content-stream-parser.mjs'));
    assert(typeof parseContentStream === 'function', 'parseContentStream is exported');
    assert(typeof getColorOperations === 'function', 'getColorOperations is exported');

    // Test parser with simple content stream
    const testStream = '0.5 g 1 0 0 rg 0 0 0 1 k';
    const parseResult = parseContentStream(testStream);
    assert(parseResult !== null, 'parseContentStream returns non-null');

    const colorOps = getColorOperations(parseResult.operations);
    assert(Array.isArray(colorOps), 'getColorOperations returns array');
    assert(colorOps.length > 0, `Parsed ${colorOps.length} color operations`);

    if (verbose) {
        for (const op of colorOps) {
            console.log(`    ${op.operator}: ${JSON.stringify(op.operands)}`);
        }
    }
}

// ============================================================================
// Suite: delta-e
// ============================================================================

async function runDeltaE() {
    console.log('\n=== Suite: delta-e ===\n');

    const { DeltaEMetrics } = await import(join(CLASSES_DIR, 'delta-e-metrics.mjs'));

    // Verify class API
    assert(typeof DeltaEMetrics === 'function', 'DeltaEMetrics is a class');
    assert(typeof DeltaEMetrics.metricName === 'string', 'Has static metricName');
    assert(typeof DeltaEMetrics.metricDefinitions === 'object', 'Has static metricDefinitions');

    const instance = new DeltaEMetrics();
    assert(typeof instance.addValues === 'function', 'Instance has addValues method');
    assert(typeof instance.getMetrics === 'function', 'Instance has getMetrics method');

    // Delta-E: add values (iterable of numbers)
    instance.addValues([0, 0, 0.5]);
    const metrics = instance.getMetrics();
    assert(metrics !== null && metrics !== undefined, 'getMetrics returns non-null');

    if (verbose) {
        console.log(`    Metrics:`, JSON.stringify(metrics, null, 2));
    }

    // Delta-E: more values
    const instance2 = new DeltaEMetrics();
    instance2.addValues([5.5, 12.3, 0.1, 8.7]);
    const metrics2 = instance2.getMetrics();
    assert(metrics2 !== null, 'getMetrics with multiple values returns non-null');

    if (verbose) {
        console.log(`    Metrics (multiple):`, JSON.stringify(metrics2, null, 2));
    }
}

// ============================================================================
// Dispatch
// ============================================================================

async function main() {
    console.log('Test Experiment Classes');
    console.log('='.repeat(40));

    const runAll = suiteName === 'all';

    if (runAll || suiteName === 'color-change-metrics') await runColorChangeMetrics();
    if (runAll || suiteName === 'comparison-classes') await runComparisonClasses();
    if (runAll || suiteName === 'comparisons-coordinator') await runComparisonsCoordinator();
    if (runAll || suiteName === 'content-stream-extractor') await runContentStreamExtractor();
    if (runAll || suiteName === 'delta-e') await runDeltaE();

    console.log('\n' + '='.repeat(40));
    console.log(`Results: ${passed} passed, ${failed} failed`);

    if (failed > 0) process.exit(1);
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
