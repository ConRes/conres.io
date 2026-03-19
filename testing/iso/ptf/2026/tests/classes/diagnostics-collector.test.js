// @ts-check
/**
 * Tests for DiagnosticsCollector
 *
 * Run with: node --test testing/iso/ptf/2025/tests/DiagnosticsCollector.test.js
 */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert';
import { DiagnosticsCollector, NO_OP_DIAGNOSTICS } from '../../classes/diagnostics/diagnostics-collector.js';

describe('DiagnosticsCollector', () => {
    /** @type {DiagnosticsCollector} */
    let collector;

    beforeEach(() => {
        collector = new DiagnosticsCollector();
    });

    // ========================================
    // Basic Span Tracking
    // ========================================

    describe('span tracking', () => {
        test('creates and ends a single span', () => {
            const span = collector.startSpan('test-operation', { file: 'test.pdf' });

            assert.strictEqual(span.name, 'test-operation');
            assert.ok(span.id > 0, 'span should have a positive ID');

            collector.endSpan(span, { pixels: 1000 });

            const json = collector.toJSON();
            assert.strictEqual(json.length, 1);
            assert.strictEqual(json[0].name, 'test-operation');
            assert.strictEqual(json[0].attributes.file, 'test.pdf');
            assert.strictEqual(json[0].metrics.pixels, 1000);
        });

        test('tracks nested spans with parent-child relationships', () => {
            const docSpan = collector.startSpan('document');

            const page1Span = collector.startSpan('page', { pageIndex: 0 });
            collector.endSpan(page1Span, { images: 2 });

            const page2Span = collector.startSpan('page', { pageIndex: 1 });
            collector.endSpan(page2Span, { images: 1 });

            collector.endSpan(docSpan, { pages: 2 });

            const json = collector.toJSON();
            assert.strictEqual(json.length, 1, 'should have one root node');
            assert.strictEqual(json[0].name, 'document');
            assert.strictEqual(json[0].children.length, 2, 'document should have 2 children');
            assert.strictEqual(json[0].children[0].name, 'page');
            assert.strictEqual(json[0].children[0].attributes.pageIndex, 0);
            assert.strictEqual(json[0].children[1].attributes.pageIndex, 1);
        });

        test('handles deeply nested spans', () => {
            const docSpan = collector.startSpan('document');
            const pageSpan = collector.startSpan('page');
            const imageSpan = collector.startSpan('image');
            const transformSpan = collector.startSpan('transform');

            collector.endSpan(transformSpan);
            collector.endSpan(imageSpan);
            collector.endSpan(pageSpan);
            collector.endSpan(docSpan);

            const json = collector.toJSON();
            assert.strictEqual(json.length, 1);
            assert.strictEqual(json[0].children.length, 1);
            assert.strictEqual(json[0].children[0].children.length, 1);
            assert.strictEqual(json[0].children[0].children[0].children.length, 1);
        });

        test('calculates self time excluding children', async () => {
            const parentSpan = collector.startSpan('parent');

            // Simulate some work
            await sleep(10);

            const childSpan = collector.startSpan('child');
            await sleep(20);
            collector.endSpan(childSpan);

            await sleep(10);
            collector.endSpan(parentSpan);

            const json = collector.toJSON();

            // Self time should be less than inclusive time
            const parentNode = json[0];
            assert.ok(parentNode.metrics.time < parentNode.metrics['time (inc)'],
                'self time should be less than inclusive time');
        });
    });

    // ========================================
    // startNestedSpan (explicit parent for concurrent operations)
    // ========================================

    describe('startNestedSpan', () => {
        test('creates span with explicit parent', () => {
            const parentSpan = collector.startSpan('batch');
            const childSpan = collector.startNestedSpan(parentSpan, 'item', { index: 0 });

            collector.endSpan(childSpan);
            collector.endSpan(parentSpan);

            const json = collector.toJSON();
            assert.strictEqual(json.length, 1);
            assert.strictEqual(json[0].name, 'batch');
            assert.strictEqual(json[0].children.length, 1);
            assert.strictEqual(json[0].children[0].name, 'item');
            assert.strictEqual(json[0].children[0].attributes.index, 0);
        });

        test('does not modify currentSpanId', () => {
            const parentSpan = collector.startSpan('batch');
            const currentBefore = collector.currentSpanId;

            const childSpan = collector.startNestedSpan(parentSpan, 'item');
            const currentAfter = collector.currentSpanId;

            // currentSpanId should remain the parent, not change to child
            assert.strictEqual(currentBefore, currentAfter);

            collector.endSpan(childSpan);
            collector.endSpan(parentSpan);
        });

        test('allows concurrent sibling spans under same parent', () => {
            const batchSpan = collector.startSpan('image-batch');

            // Create multiple sibling spans (simulating Promise.all pattern)
            const span1 = collector.startNestedSpan(batchSpan, 'image', { ref: 'Im0' });
            const span2 = collector.startNestedSpan(batchSpan, 'image', { ref: 'Im1' });
            const span3 = collector.startNestedSpan(batchSpan, 'image', { ref: 'Im2' });

            // End in different order (as async operations might complete)
            collector.endSpan(span2);
            collector.endSpan(span1);
            collector.endSpan(span3);

            collector.endSpan(batchSpan);

            const json = collector.toJSON();
            assert.strictEqual(json[0].name, 'image-batch');
            assert.strictEqual(json[0].children.length, 3, 'should have 3 sibling children');

            // All children should be at the same level (siblings, not nested)
            const childNames = json[0].children.map(c => c.name);
            assert.deepStrictEqual(childNames, ['image', 'image', 'image']);

            const childRefs = json[0].children.map(c => c.attributes.ref);
            assert.deepStrictEqual(childRefs, ['Im0', 'Im1', 'Im2']);
        });

        test('startSpan after startNestedSpan uses unchanged currentSpanId', () => {
            const batchSpan = collector.startSpan('batch');
            const itemSpan = collector.startNestedSpan(batchSpan, 'item');

            // Since startNestedSpan doesn't change currentSpanId, startSpan('sub-operation')
            // uses batch as parent, making sub-operation a sibling of item.
            const subSpan = collector.startSpan('sub-operation');
            collector.endSpan(subSpan);

            collector.endSpan(itemSpan);
            collector.endSpan(batchSpan);

            const json = collector.toJSON();
            // Both item and sub-operation are children of batch
            assert.strictEqual(json[0].children.length, 2);
            assert.strictEqual(json[0].children[0].name, 'item');
            assert.strictEqual(json[0].children[1].name, 'sub-operation');
        });

        test('use startNestedSpan to create children under nested spans', () => {
            const batchSpan = collector.startSpan('batch');
            const itemSpan = collector.startNestedSpan(batchSpan, 'item');

            // To create a child of the nested span, use startNestedSpan with itemSpan as parent
            const subSpan = collector.startNestedSpan(itemSpan, 'sub-operation');
            collector.endSpan(subSpan);

            collector.endSpan(itemSpan);
            collector.endSpan(batchSpan);

            const json = collector.toJSON();
            assert.strictEqual(json[0].children.length, 1);
            assert.strictEqual(json[0].children[0].name, 'item');
            assert.strictEqual(json[0].children[0].children.length, 1);
            assert.strictEqual(json[0].children[0].children[0].name, 'sub-operation');
        });

        test('endSpan does not restore currentSpanId for nested spans', () => {
            const parentSpan = collector.startSpan('parent');
            const nestedSpan = collector.startNestedSpan(parentSpan, 'nested');

            // currentSpanId is still parent
            assert.strictEqual(collector.currentSpanId, parentSpan.id);

            collector.endSpan(nestedSpan);

            // After ending nested span, currentSpanId should still be parent
            assert.strictEqual(collector.currentSpanId, parentSpan.id);

            collector.endSpan(parentSpan);
        });

        test('works with NO_OP_DIAGNOSTICS', () => {
            const parentSpan = NO_OP_DIAGNOSTICS.startSpan('parent');
            const childSpan = NO_OP_DIAGNOSTICS.startNestedSpan(parentSpan, 'child');

            assert.strictEqual(parentSpan.id, 0);
            assert.strictEqual(childSpan.id, 0);

            // Should not throw
            NO_OP_DIAGNOSTICS.endSpan(childSpan);
            NO_OP_DIAGNOSTICS.endSpan(parentSpan);
        });

        test('falls back to startSpan when parentHandle is null', () => {
            const batchSpan = collector.startSpan('batch');

            // Passing null should fall back to startSpan behavior (uses currentSpanId)
            const itemSpan = collector.startNestedSpan(null, 'item');

            collector.endSpan(itemSpan);
            collector.endSpan(batchSpan);

            const json = collector.toJSON();
            assert.strictEqual(json[0].name, 'batch');
            // item should be a child of batch (via startSpan fallback)
            assert.strictEqual(json[0].children.length, 1);
            assert.strictEqual(json[0].children[0].name, 'item');
        });

        test('falls back to startSpan when parentHandle is undefined', () => {
            const batchSpan = collector.startSpan('batch');

            // Passing undefined should fall back to startSpan behavior
            const itemSpan = collector.startNestedSpan(undefined, 'item');

            collector.endSpan(itemSpan);
            collector.endSpan(batchSpan);

            const json = collector.toJSON();
            assert.strictEqual(json[0].children.length, 1);
            assert.strictEqual(json[0].children[0].name, 'item');
        });
    });

    // ========================================
    // updateSpan
    // ========================================

    describe('updateSpan', () => {
        test('adds numeric values to metrics', () => {
            const span = collector.startSpan('operation');
            collector.updateSpan(span, { pixels: 1000, bytes: 500 });
            collector.endSpan(span);

            const json = collector.toJSON();
            assert.strictEqual(json[0].metrics.pixels, 1000);
            assert.strictEqual(json[0].metrics.bytes, 500);
        });

        test('adds non-numeric values to attributes', () => {
            const span = collector.startSpan('operation');
            collector.updateSpan(span, { indexed: true, colorSpace: 'RGB' });
            collector.endSpan(span);

            const json = collector.toJSON();
            assert.strictEqual(json[0].attributes.indexed, true);
            assert.strictEqual(json[0].attributes.colorSpace, 'RGB');
        });

        test('allows multiple updates before endSpan', () => {
            const span = collector.startSpan('operation');
            collector.updateSpan(span, { pixels: 100 });
            collector.updateSpan(span, { bytes: 50 });
            collector.updateSpan(span, { pixels: 200 }); // Overwrites
            collector.endSpan(span);

            const json = collector.toJSON();
            assert.strictEqual(json[0].metrics.pixels, 200);
            assert.strictEqual(json[0].metrics.bytes, 50);
        });

        test('is no-op for closed spans', () => {
            const span = collector.startSpan('operation');
            collector.endSpan(span, { initial: 1 });
            collector.updateSpan(span, { updated: 2 }); // Should be no-op

            const json = collector.toJSON();
            assert.strictEqual(json[0].metrics.initial, 1);
            assert.strictEqual(json[0].metrics.updated, undefined);
        });

        test('is no-op for aborted spans', () => {
            const span = collector.startSpan('operation');
            collector.abortSpan(span, { reason: 'error' });
            collector.updateSpan(span, { updated: 2 }); // Should be no-op

            const json = collector.toJSON();
            assert.strictEqual(json[0].metrics.updated, undefined);
        });
    });

    // ========================================
    // abortSpan
    // ========================================

    describe('abortSpan', () => {
        test('closes span with aborted status', () => {
            const span = collector.startSpan('operation');
            collector.abortSpan(span, { reason: 'test error' });

            const json = collector.toJSON();
            assert.strictEqual(json[0].status, 'aborted');
            // Abort reason is stored in attributes
            assert.strictEqual(json[0].attributes.abortReason, 'test error');
        });

        test('supports timeout abort data', () => {
            const span = collector.startSpan('operation');
            collector.abortSpan(span, { timeout: 5000 });

            const json = collector.toJSON();
            assert.strictEqual(json[0].status, 'aborted');
            // Abort timeout is stored in attributes
            assert.strictEqual(json[0].attributes.abortTimeout, 5000);
        });

        test('makes endSpan a no-op', () => {
            const span = collector.startSpan('operation');
            collector.abortSpan(span, { reason: 'error' });
            collector.endSpan(span, { afterAbort: 1 }); // Should be no-op

            const json = collector.toJSON();
            assert.strictEqual(json[0].status, 'aborted');
            assert.strictEqual(json[0].metrics.afterAbort, undefined);
        });

        test('is no-op for already closed spans', () => {
            const span = collector.startSpan('operation');
            collector.endSpan(span, { final: 1 });
            collector.abortSpan(span, { reason: 'too late' }); // Should be no-op

            const json = collector.toJSON();
            assert.strictEqual(json[0].status, 'completed');
            // No abort data for completed spans
            assert.strictEqual(json[0].attributes.abortReason, undefined);
        });

        test('shows ABORTED in text output', () => {
            const span = collector.startSpan('operation');
            collector.abortSpan(span, { reason: 'test error' });

            const text = collector.toText();
            assert.ok(text.includes('ABORTED'));
            assert.ok(text.includes('test error'));
        });

        test('shows ABORT in trace log', () => {
            const span = collector.startSpan('operation');
            collector.abortSpan(span, { reason: 'test error' });

            const traceLog = collector.toTraceLog();
            assert.ok(traceLog.includes('[ABORT]'));
            assert.ok(traceLog.includes('test error'));
        });
    });

    // ========================================
    // Span Status
    // ========================================

    describe('span status', () => {
        test('completed spans have completed status', () => {
            const span = collector.startSpan('operation');
            collector.endSpan(span);

            const json = collector.toJSON();
            assert.strictEqual(json[0].status, 'completed');
        });

        test('aborted spans have aborted status', () => {
            const span = collector.startSpan('operation');
            collector.abortSpan(span, { reason: 'error' });

            const json = collector.toJSON();
            assert.strictEqual(json[0].status, 'aborted');
        });

        test('open spans are output as completed in toJSON', () => {
            // Note: Open spans are treated as completed in JSON output
            // because the output format only supports 'completed' | 'aborted'
            const span = collector.startSpan('operation');
            // Do not close - span remains open

            const json = collector.toJSON();
            // Open spans are output as 'completed' (graceful handling)
            assert.strictEqual(json[0].status, 'completed');
        });

        test('internal span status is open before endSpan', () => {
            const span = collector.startSpan('operation');
            // Check internal state via serialize()
            const serialized = collector.serialize();
            assert.strictEqual(serialized.spans[0].status, 'open');
        });
    });

    // ========================================
    // Event Recording
    // ========================================

    describe('event recording', () => {
        test('records events with timestamps', () => {
            collector.recordEvent('cache-hit', { key: 'test-key' });
            collector.recordEvent('cache-miss', { key: 'other-key' });

            const traceLog = collector.toTraceLog();
            assert.ok(traceLog.includes('[EVENT] cache-hit'));
            assert.ok(traceLog.includes('[EVENT] cache-miss'));
            assert.ok(traceLog.includes('key=test-key'));
        });

        test('associates events with current span', () => {
            const span = collector.startSpan('operation');
            collector.recordEvent('inside-span', { value: 42 });
            collector.endSpan(span);

            collector.recordEvent('outside-span', { value: 99 });

            // Events should be in trace log
            const traceLog = collector.toTraceLog();
            assert.ok(traceLog.includes('inside-span'));
            assert.ok(traceLog.includes('outside-span'));
        });
    });

    // ========================================
    // Counter Tracking
    // ========================================

    describe('counter tracking', () => {
        test('increments counters', () => {
            collector.incrementCounter('hits');
            collector.incrementCounter('hits');
            collector.incrementCounter('misses');
            collector.incrementCounter('pixels', 1000);
            collector.incrementCounter('pixels', 2000);

            assert.strictEqual(collector.getCounter('hits'), 2);
            assert.strictEqual(collector.getCounter('misses'), 1);
            assert.strictEqual(collector.getCounter('pixels'), 3000);
            assert.strictEqual(collector.getCounter('nonexistent'), 0);
        });

        test('includes counters in text output', () => {
            collector.incrementCounter('cache-hits', 100);
            collector.incrementCounter('cache-misses', 5);

            const text = collector.toText();
            assert.ok(text.includes('Counters:'));
            assert.ok(text.includes('cache-hits'));
            assert.ok(text.includes('cache-misses'));
        });

        test('exposes counters as readonly object', () => {
            collector.incrementCounter('test', 42);
            const counters = collector.counters;

            assert.strictEqual(counters.test, 42);

            // Modifying the returned object should not affect internal state
            counters.test = 999;
            assert.strictEqual(collector.getCounter('test'), 42);
        });
    });

    // ========================================
    // JSON Output (Hatchet Format)
    // ========================================

    describe('JSON output (Hatchet format)', () => {
        test('produces valid Hatchet structure', () => {
            const span = collector.startSpan('root', { attr1: 'value1' });
            collector.endSpan(span, { metric1: 123 });

            const json = collector.toJSON();

            assert.strictEqual(json.length, 1);
            const node = json[0];

            // Required Hatchet fields
            assert.strictEqual(typeof node.name, 'string');
            assert.ok(Array.isArray(node.frame));
            assert.strictEqual(typeof node.metrics, 'object');
            assert.strictEqual(typeof node.attributes, 'object');
            assert.ok(Array.isArray(node.children));

            // Time metrics in seconds
            assert.strictEqual(typeof node.metrics.time, 'number');
            assert.strictEqual(typeof node.metrics['time (inc)'], 'number');

            // Custom metrics preserved
            assert.strictEqual(node.metrics.metric1, 123);

            // Attributes preserved
            assert.strictEqual(node.attributes.attr1, 'value1');
        });

        test('times are in seconds', async () => {
            const span = collector.startSpan('operation');
            await sleep(50); // 50ms
            collector.endSpan(span);

            const json = collector.toJSON();
            const time = json[0].metrics['time (inc)'];

            // Should be ~0.05 seconds, not 50
            assert.ok(time > 0.04 && time < 0.1, `time should be in seconds: ${time}`);
        });
    });

    // ========================================
    // Text Output
    // ========================================

    describe('text output', () => {
        test('produces tree structure with connectors', () => {
            const docSpan = collector.startSpan('document');
            const pageSpan = collector.startSpan('page');
            collector.endSpan(pageSpan);
            collector.endSpan(docSpan);

            const text = collector.toText();

            assert.ok(text.includes('document'));
            assert.ok(text.includes('page'));
            // Should have tree connectors
            assert.ok(text.includes('└──') || text.includes('├──'));
        });

        test('includes duration in parentheses', async () => {
            const span = collector.startSpan('operation');
            await sleep(10);
            collector.endSpan(span);

            const text = collector.toText();
            // Should show duration like "(10.5ms)" or "(0.01s)"
            assert.ok(/\(\d+\.?\d*(ms|µs|s)\)/.test(text), `should include duration: ${text}`);
        });

        test('shows metrics inline in brackets', () => {
            const span = collector.startSpan('operation');
            collector.endSpan(span, { pixels: 1000, ops: 50 });

            const text = collector.toText();
            assert.ok(text.includes('['), 'should have metrics in brackets');
            assert.ok(text.includes('pixels'));
            assert.ok(text.includes('ops'));
        });
    });

    // ========================================
    // Trace Log Output
    // ========================================

    describe('trace log output', () => {
        test('produces chronological event list', async () => {
            const span = collector.startSpan('operation');
            await sleep(5); // Ensure distinct timestamps
            collector.recordEvent('midpoint');
            await sleep(5);
            collector.endSpan(span);

            const log = collector.toTraceLog();
            const lines = log.split('\n');

            assert.ok(lines.length >= 3, 'should have at least 3 lines');
            assert.ok(log.includes('[START]'), 'should have START entry');
            assert.ok(log.includes('[EVENT]'), 'should have EVENT entry');
            // Note: type is padded, so END becomes "END  ]"
            assert.ok(log.includes('[END'), 'should have END entry');

            // Verify chronological order by checking START comes before END
            const startIndex = log.indexOf('[START]');
            const endIndex = log.indexOf('[END');
            assert.ok(startIndex < endIndex, 'START should come before END');
        });

        test('includes timestamps in milliseconds', () => {
            collector.startSpan('test');

            const log = collector.toTraceLog();
            // Should have timestamp like "     0.000ms"
            assert.ok(/\d+\.\d+ms/.test(log), `should have ms timestamp: ${log}`);
        });

        test('includes elapsed time on END entries', async () => {
            const span = collector.startSpan('operation');
            await sleep(10);
            collector.endSpan(span);

            const log = collector.toTraceLog();
            assert.ok(log.includes('elapsed='), 'should include elapsed time');
        });
    });

    // ========================================
    // Worker Serialization and Merging
    // ========================================

    describe('serialization and merging', () => {
        test('serializes collector state', () => {
            const span = collector.startSpan('operation');
            collector.recordEvent('test-event');
            collector.incrementCounter('test-counter', 42);
            collector.endSpan(span);

            const serialized = collector.serialize();

            assert.ok(Array.isArray(serialized.spans));
            assert.ok(Array.isArray(serialized.events));
            assert.strictEqual(typeof serialized.counters, 'object');
            assert.strictEqual(typeof serialized.startTime, 'number');

            assert.strictEqual(serialized.spans.length, 1);
            assert.strictEqual(serialized.events.length, 1);
            assert.strictEqual(serialized.counters['test-counter'], 42);
        });

        test('merges worker data into parent collector', () => {
            // Main collector
            const mainSpan = collector.startSpan('document');

            // Simulate worker collector
            const workerCollector = new DiagnosticsCollector();
            const workerSpan = workerCollector.startSpan('worker-task');
            workerCollector.recordEvent('worker-event');
            workerCollector.incrementCounter('worker-pixels', 1000);
            workerCollector.endSpan(workerSpan);

            // Merge worker data
            collector.merge(workerCollector.serialize(), mainSpan.id);
            collector.endSpan(mainSpan);

            // Verify merged data
            const json = collector.toJSON();
            assert.strictEqual(json.length, 1);
            assert.strictEqual(json[0].name, 'document');

            // Worker span should be child of main span
            assert.ok(json[0].children.some(c => c.name === 'worker-task'),
                'worker span should be merged as child');

            // Counters should be merged
            assert.strictEqual(collector.getCounter('worker-pixels'), 1000);

            // Events should be in trace log
            const log = collector.toTraceLog();
            assert.ok(log.includes('worker-event'));
        });

        test('merging remaps span IDs to avoid collisions', () => {
            // Both collectors will have span ID 1
            const span1 = collector.startSpan('main');
            collector.endSpan(span1);

            const worker = new DiagnosticsCollector();
            const span2 = worker.startSpan('worker');
            worker.endSpan(span2);

            // After merge, should have 2 distinct spans
            collector.merge(worker.serialize());

            const json = collector.toJSON();
            assert.strictEqual(json.length, 2, 'should have 2 root spans after merge');
        });
    });

    // ========================================
    // Enabled/Disabled State
    // ========================================

    describe('enabled/disabled state', () => {
        test('disabled collector produces empty output', () => {
            const disabled = new DiagnosticsCollector({ enabled: false });

            const span = disabled.startSpan('operation');
            disabled.recordEvent('event');
            disabled.incrementCounter('counter');
            disabled.endSpan(span);

            assert.strictEqual(disabled.toJSON().length, 0);
            assert.strictEqual(disabled.toText(), '');
            assert.strictEqual(disabled.toTraceLog(), '');
            assert.strictEqual(disabled.getCounter('counter'), 0);
        });

        test('can toggle enabled state', () => {
            collector.enabled = false;
            collector.startSpan('disabled-span');

            collector.enabled = true;
            const span = collector.startSpan('enabled-span');
            collector.endSpan(span);

            const json = collector.toJSON();
            assert.strictEqual(json.length, 1);
            assert.strictEqual(json[0].name, 'enabled-span');
        });
    });

    // ========================================
    // Reset
    // ========================================

    describe('reset', () => {
        test('clears all collected data', () => {
            collector.startSpan('operation');
            collector.recordEvent('event');
            collector.incrementCounter('counter', 100);

            collector.reset();

            assert.strictEqual(collector.toJSON().length, 0);
            assert.strictEqual(collector.getCounter('counter'), 0);
            assert.strictEqual(collector.currentSpanId, null);
        });
    });

    // ========================================
    // NO_OP_DIAGNOSTICS
    // ========================================

    describe('NO_OP_DIAGNOSTICS', () => {
        test('all methods are no-ops', () => {
            const noop = NO_OP_DIAGNOSTICS;

            // Should not throw
            const span = noop.startSpan('test');
            noop.recordEvent('event');
            noop.incrementCounter('counter');
            noop.endSpan(span);
            noop.merge({ spans: [], events: [], counters: {}, startTime: 0 });
            noop.reset();

            // Should return empty/zero
            assert.strictEqual(span.id, 0);
            assert.strictEqual(noop.enabled, false);
            assert.strictEqual(noop.currentSpanId, null);
            assert.strictEqual(noop.getCounter('counter'), 0);
            assert.deepStrictEqual(noop.counters, {});
            assert.deepStrictEqual(noop.toJSON(), []);
            assert.strictEqual(noop.toText(), '');
            assert.strictEqual(noop.toTraceLog(), '');
        });

        test('can be used as fallback', () => {
            // Pattern: use NO_OP_DIAGNOSTICS when diagnostics option not provided
            const options = {}; // No diagnostics option
            const diagnostics = options.diagnostics ?? NO_OP_DIAGNOSTICS;

            // Code can use diagnostics without null checks
            const span = diagnostics.startSpan('operation');
            diagnostics.incrementCounter('counter');
            diagnostics.endSpan(span);

            // No output
            assert.deepStrictEqual(diagnostics.toJSON(), []);
        });
    });
});

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Sleep for a given number of milliseconds.
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
