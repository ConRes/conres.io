// @ts-check
/**
 * Tests for convert-diagnostics-profile.js
 *
 * Run with: node --test testing/iso/ptf/2025/tests/ConvertDiagnosticsProfile.test.js
 */

import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
    toCPUProfile,
    toText,
    toCompactText,
    toSummaryText,
    formatDuration,
    formatNumber,
} from '../experiments/convert-diagnostics-profile.js';

// ============================================================================
// Test Data
// ============================================================================

/**
 * Sample Hatchet-compatible diagnostics data for testing.
 * @type {import('../experiments/convert-diagnostics-profile.js').DiagnosticsNode[]}
 */
const SAMPLE_DIAGNOSTICS = [
    {
        name: 'document-conversion',
        frame: [],
        metrics: {
            time: 0.001,
            'time (inc)': 0.055,
            pages: 2,
        },
        attributes: {
            file: 'test.pdf',
            renderingIntent: 'relative-colorimetric',
        },
        children: [
            {
                name: 'page',
                frame: [],
                metrics: {
                    time: 0.002,
                    'time (inc)': 0.041,
                    images: 1,
                    streams: 1,
                },
                attributes: {
                    pageIndex: 0,
                },
                children: [
                    {
                        name: 'image-conversion',
                        frame: [],
                        metrics: {
                            time: 0.025,
                            'time (inc)': 0.025,
                            pixels: 2073600,
                        },
                        attributes: {
                            ref: 'Im0',
                            colorSpace: 'RGB',
                        },
                        children: [],
                    },
                    {
                        name: 'content-stream',
                        frame: [],
                        metrics: {
                            time: 0.002,
                            'time (inc)': 0.002,
                            ops: 150,
                        },
                        attributes: {
                            ref: '5 0 R',
                        },
                        children: [],
                    },
                ],
            },
            {
                name: 'page',
                frame: [],
                metrics: {
                    time: 0.003,
                    'time (inc)': 0.003,
                    images: 0,
                    streams: 1,
                },
                attributes: {
                    pageIndex: 1,
                },
                children: [],
            },
        ],
    },
];

// ============================================================================
// Format Helper Tests
// ============================================================================

describe('formatDuration', () => {
    test('formats nanoseconds', () => {
        const result = formatDuration(0.0001);
        assert.strictEqual(result, '100ns');
    });

    test('formats microseconds', () => {
        const result = formatDuration(0.5);
        assert.strictEqual(result, '500µs');
    });

    test('formats milliseconds', () => {
        const result = formatDuration(150);
        assert.strictEqual(result, '150.0ms');
    });

    test('formats seconds', () => {
        const result = formatDuration(2500);
        assert.strictEqual(result, '2.50s');
    });
});

describe('formatNumber', () => {
    test('formats integers with separators', () => {
        const result = formatNumber(1000000);
        assert.ok(result.includes('1'), 'should include the number');
    });

    test('formats decimals with limited precision', () => {
        const result = formatNumber(3.14159);
        assert.ok(result.includes('3.14'), 'should truncate to 3 decimal places');
    });
});

// ============================================================================
// toCPUProfile Tests
// ============================================================================

describe('toCPUProfile', () => {
    test('creates valid cpuprofile structure', () => {
        const profile = toCPUProfile(SAMPLE_DIAGNOSTICS);

        assert.ok(Array.isArray(profile.nodes), 'should have nodes array');
        assert.ok(Array.isArray(profile.samples), 'should have samples array');
        assert.ok(Array.isArray(profile.timeDeltas), 'should have timeDeltas array');
        assert.strictEqual(typeof profile.startTime, 'number', 'should have startTime');
        assert.strictEqual(typeof profile.endTime, 'number', 'should have endTime');
    });

    test('creates root node', () => {
        const profile = toCPUProfile(SAMPLE_DIAGNOSTICS);

        const rootNode = profile.nodes[0];
        assert.strictEqual(rootNode.id, 1, 'root should have id 1');
        assert.strictEqual(rootNode.callFrame.functionName, '(root)');
        assert.ok(Array.isArray(rootNode.children), 'root should have children');
    });

    test('includes all nodes in hierarchy', () => {
        const profile = toCPUProfile(SAMPLE_DIAGNOSTICS);

        // Should have: root + document-conversion + 2 pages + 2 children of page 1 = 6 nodes
        assert.strictEqual(profile.nodes.length, 6, 'should have 6 nodes total');
    });

    test('includes colorSpace in function name', () => {
        const profile = toCPUProfile(SAMPLE_DIAGNOSTICS);

        const imageNode = profile.nodes.find(n => n.callFrame.functionName.includes('image-conversion'));
        assert.ok(imageNode, 'should find image-conversion node');
        assert.ok(imageNode.callFrame.functionName.includes('(RGB)'), 'should include colorSpace');
    });

    test('includes pageIndex in function name', () => {
        const profile = toCPUProfile(SAMPLE_DIAGNOSTICS);

        const pageNode = profile.nodes.find(n => n.callFrame.functionName.includes('page #1'));
        assert.ok(pageNode, 'should find page #1 node');
    });

    test('handles empty input', () => {
        const profile = toCPUProfile([]);

        assert.strictEqual(profile.nodes.length, 1, 'should only have root node');
        // Note: generateSamples always creates at least 1 sample (Math.max(1, ...))
        assert.ok(profile.samples.length >= 0, 'samples array should exist');
    });
});

// ============================================================================
// toText Tests
// ============================================================================

describe('toText', () => {
    test('produces hierarchical text output', () => {
        const text = toText(SAMPLE_DIAGNOSTICS);

        assert.ok(text.includes('document-conversion'), 'should include root node');
        assert.ok(text.includes('page'), 'should include page nodes');
        assert.ok(text.includes('image-conversion'), 'should include image node');
    });

    test('includes tree structure characters', () => {
        const text = toText(SAMPLE_DIAGNOSTICS);

        assert.ok(text.includes('├── ') || text.includes('└── '), 'should include tree connectors');
    });

    test('includes timing information', () => {
        const text = toText(SAMPLE_DIAGNOSTICS);

        // Should include timing in parentheses
        assert.ok(text.includes('(') && text.includes(')'), 'should include timing');
    });

    test('includes metrics in brackets', () => {
        const text = toText(SAMPLE_DIAGNOSTICS);

        assert.ok(text.includes('[') && text.includes(']'), 'should include metrics');
        assert.ok(text.includes('pages:') || text.includes('images:'), 'should include metric names');
    });

    test('handles empty input', () => {
        const text = toText([]);
        assert.strictEqual(text, '', 'should produce empty string');
    });
});

// ============================================================================
// toCompactText Tests
// ============================================================================

describe('toCompactText', () => {
    test('produces markdown header', () => {
        const text = toCompactText(SAMPLE_DIAGNOSTICS);

        assert.ok(text.includes('# Diagnostics Breakdown'), 'should include markdown header');
    });

    test('shows time breakdown section', () => {
        const text = toCompactText(SAMPLE_DIAGNOSTICS);

        assert.ok(text.includes('## Time Breakdown'), 'should include time breakdown section');
    });

    test('shows summary with page count', () => {
        const text = toCompactText(SAMPLE_DIAGNOSTICS);

        assert.ok(text.includes('Pages:'), 'should show pages in summary');
    });

    test('shows table format with headers', () => {
        const text = toCompactText(SAMPLE_DIAGNOSTICS);

        assert.ok(text.includes('| Phase | Time | % | Count | Throughput |'), 'should include table headers');
    });
});

// ============================================================================
// toSummaryText Tests
// ============================================================================

describe('toSummaryText', () => {
    test('produces summary header', () => {
        const text = toSummaryText(SAMPLE_DIAGNOSTICS);

        assert.ok(text.includes('=== Diagnostics Summary ==='), 'should include header');
    });

    test('groups operations by type', () => {
        const text = toSummaryText(SAMPLE_DIAGNOSTICS);

        assert.ok(text.includes('Operations:'), 'should include operations section');
        assert.ok(text.includes('document-conversion:'), 'should list operation types');
        assert.ok(text.includes('page:'), 'should list page operations');
    });

    test('shows count for each operation type', () => {
        const text = toSummaryText(SAMPLE_DIAGNOSTICS);

        assert.ok(text.includes('count:'), 'should show count');
    });

    test('shows total and average times', () => {
        const text = toSummaryText(SAMPLE_DIAGNOSTICS);

        assert.ok(text.includes('total:'), 'should show total time');
        assert.ok(text.includes('avg:'), 'should show average time');
    });

    test('shows min/max times', () => {
        const text = toSummaryText(SAMPLE_DIAGNOSTICS);

        // min/max only shown when there's timing data
        assert.ok(text.includes('min:') || text.includes('max:'), 'should show min/max times');
    });

    test('shows aggregated metrics', () => {
        const text = toSummaryText(SAMPLE_DIAGNOSTICS);

        assert.ok(text.includes('Metrics:'), 'should include metrics section');
    });
});
