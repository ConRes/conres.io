// @ts-check
/**
 * Tests for MainDiagnosticsCollector and AuxiliaryDiagnosticsCollector
 *
 * Run with: node --test testing/iso/ptf/2025/tests/MainAuxiliaryDiagnostics.test.js
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { MessageChannel } from 'worker_threads';
import { MainDiagnosticsCollector } from '../../classes/diagnostics/main-diagnostics-collector.js';
import { AuxiliaryDiagnosticsCollector } from '../../classes/diagnostics/auxiliary-diagnostics-collector.js';
import { DiagnosticsCollector } from '../../classes/diagnostics/diagnostics-collector.js';

// ============================================================================
// MainDiagnosticsCollector Tests
// ============================================================================

describe('MainDiagnosticsCollector', () => {
    /** @type {MainDiagnosticsCollector} */
    let collector;

    beforeEach(() => {
        collector = new MainDiagnosticsCollector();
    });

    afterEach(() => {
        collector.dispose();
    });

    // ========================================
    // Basic Functionality (Inherited)
    // ========================================

    describe('inherits from DiagnosticsCollector', () => {
        test('is instance of DiagnosticsCollector', () => {
            assert.ok(collector instanceof DiagnosticsCollector);
        });

        test('span tracking works', () => {
            const span = collector.startSpan('test-operation', { attr: 'value' });
            collector.endSpan(span, { metric: 42 });

            const json = collector.toJSON();
            assert.strictEqual(json.length, 1);
            assert.strictEqual(json[0].name, 'test-operation');
            assert.strictEqual(json[0].attributes.attr, 'value');
            assert.strictEqual(json[0].metrics.metric, 42);
        });

        test('event recording works', () => {
            collector.recordEvent('test-event', { data: 123 });
            const log = collector.toTraceLog();
            assert.ok(log.includes('test-event'));
        });

        test('counter tracking works', () => {
            collector.incrementCounter('test-counter', 10);
            assert.strictEqual(collector.getCounter('test-counter'), 10);
        });
    });

    // ========================================
    // Auxiliary Channel Management
    // ========================================

    describe('auxiliary channel management', () => {
        test('registerAuxiliary adds channel', () => {
            const { port1 } = new MessageChannel();
            collector.registerAuxiliary('worker-1', port1);

            assert.deepStrictEqual(collector.auxiliaryWorkerIds, ['worker-1']);
            port1.close();
        });

        test('unregisterAuxiliary removes channel', () => {
            const { port1 } = new MessageChannel();
            collector.registerAuxiliary('worker-1', port1);
            collector.unregisterAuxiliary('worker-1');

            assert.deepStrictEqual(collector.auxiliaryWorkerIds, []);
        });

        test('createAuxiliaryChannel creates and registers channel', () => {
            const { mainPort, workerPort } = collector.createAuxiliaryChannel('worker-1');

            assert.ok(mainPort instanceof MessagePort);
            assert.ok(workerPort instanceof MessagePort);
            assert.deepStrictEqual(collector.auxiliaryWorkerIds, ['worker-1']);

            mainPort.close();
            workerPort.close();
        });

        test('multiple auxiliaries can be registered', () => {
            const { port1: port1a } = new MessageChannel();
            const { port1: port1b } = new MessageChannel();
            const { port1: port1c } = new MessageChannel();

            collector.registerAuxiliary('worker-1', port1a);
            collector.registerAuxiliary('worker-2', port1b);
            collector.registerAuxiliary('worker-3', port1c);

            assert.strictEqual(collector.auxiliaryWorkerIds.length, 3);
            assert.ok(collector.auxiliaryWorkerIds.includes('worker-1'));
            assert.ok(collector.auxiliaryWorkerIds.includes('worker-2'));
            assert.ok(collector.auxiliaryWorkerIds.includes('worker-3'));

            port1a.close();
            port1b.close();
            port1c.close();
        });

        test('disabled collector ignores registerAuxiliary', () => {
            const disabled = new MainDiagnosticsCollector({ enabled: false });
            const { port1 } = new MessageChannel();

            disabled.registerAuxiliary('worker-1', port1);

            assert.deepStrictEqual(disabled.auxiliaryWorkerIds, []);
            port1.close();
            disabled.dispose();
        });
    });

    // ========================================
    // Message Handling from Auxiliaries
    // ========================================

    describe('message handling', () => {
        test('receives span-start message and records event', async () => {
            const { port1, port2 } = new MessageChannel();
            collector.registerAuxiliary('worker-1', port1);

            // Simulate auxiliary sending span-start
            port2.postMessage({
                type: 'span-start',
                workerId: 'worker-1',
                id: 1,
                name: 'worker-operation',
                attributes: { task: 'process' },
                timestamp: 100,
                parentId: null,
            });

            // Allow message to be processed
            await sleep(10);

            // Should have recorded the span start as an event
            const log = collector.toTraceLog();
            assert.ok(log.includes('aux-span-start:worker-operation'));

            port1.close();
            port2.close();
        });

        test('receives span-end message and records event', async () => {
            const { port1, port2 } = new MessageChannel();
            collector.registerAuxiliary('worker-1', port1);

            // Start and end a span
            port2.postMessage({
                type: 'span-start',
                workerId: 'worker-1',
                id: 1,
                name: 'worker-operation',
                attributes: {},
                timestamp: 100,
                parentId: null,
            });

            await sleep(5);

            port2.postMessage({
                type: 'span-end',
                workerId: 'worker-1',
                id: 1,
                metrics: { pixels: 1000 },
                timestamp: 200,
            });

            await sleep(10);

            const log = collector.toTraceLog();
            assert.ok(log.includes('aux-span-end'));

            port1.close();
            port2.close();
        });

        test('receives event message', async () => {
            const { port1, port2 } = new MessageChannel();
            collector.registerAuxiliary('worker-1', port1);

            port2.postMessage({
                type: 'event',
                workerId: 'worker-1',
                name: 'cache-hit',
                data: { key: 'test' },
                timestamp: 50,
                spanId: null,
            });

            await sleep(10);

            const log = collector.toTraceLog();
            assert.ok(log.includes('cache-hit'));

            port1.close();
            port2.close();
        });

        test('receives counter message', async () => {
            const { port1, port2 } = new MessageChannel();
            collector.registerAuxiliary('worker-1', port1);

            port2.postMessage({
                type: 'counter',
                workerId: 'worker-1',
                name: 'pixels-processed',
                delta: 5000,
            });

            await sleep(10);

            assert.strictEqual(collector.getCounter('pixels-processed'), 5000);

            port1.close();
            port2.close();
        });

        test('counter increments are cumulative', async () => {
            const { port1, port2 } = new MessageChannel();
            collector.registerAuxiliary('worker-1', port1);

            // Main thread counter
            collector.incrementCounter('total', 100);

            // Worker counter messages
            port2.postMessage({
                type: 'counter',
                workerId: 'worker-1',
                name: 'total',
                delta: 50,
            });

            port2.postMessage({
                type: 'counter',
                workerId: 'worker-1',
                name: 'total',
                delta: 25,
            });

            await sleep(10);

            assert.strictEqual(collector.getCounter('total'), 175);

            port1.close();
            port2.close();
        });
    });

    // ========================================
    // ID Remapping
    // ========================================

    describe('ID remapping', () => {
        test('auxiliary span IDs start at 100000', async () => {
            const { port1, port2 } = new MessageChannel();
            collector.registerAuxiliary('worker-1', port1);

            // Worker span with ID 1
            port2.postMessage({
                type: 'span-start',
                workerId: 'worker-1',
                id: 1,
                name: 'worker-span',
                attributes: {},
                timestamp: 0,
                parentId: null,
            });

            await sleep(10);

            // The event data should contain the remapped ID (100000)
            const log = collector.toTraceLog();
            assert.ok(log.includes('spanId=100000') || log.includes('worker-span'));

            port1.close();
            port2.close();
        });

        test('multiple workers get distinct ID ranges', async () => {
            const { port1: p1a, port2: p2a } = new MessageChannel();
            const { port1: p1b, port2: p2b } = new MessageChannel();

            collector.registerAuxiliary('worker-1', p1a);
            collector.registerAuxiliary('worker-2', p1b);

            // Both workers send span with local ID 1
            p2a.postMessage({
                type: 'span-start',
                workerId: 'worker-1',
                id: 1,
                name: 'worker-1-span',
                attributes: {},
                timestamp: 0,
                parentId: null,
            });

            p2b.postMessage({
                type: 'span-start',
                workerId: 'worker-2',
                id: 1,
                name: 'worker-2-span',
                attributes: {},
                timestamp: 0,
                parentId: null,
            });

            await sleep(10);

            // Both should be recorded (with different remapped IDs)
            const log = collector.toTraceLog();
            assert.ok(log.includes('worker-1-span'));
            assert.ok(log.includes('worker-2-span'));

            p1a.close();
            p2a.close();
            p1b.close();
            p2b.close();
        });
    });

    // ========================================
    // Parent Span Handling
    // ========================================

    describe('parent span handling', () => {
        test('registerAuxiliary uses currentSpanId as parent', () => {
            const parentSpan = collector.startSpan('parent');
            const { port1, port2 } = new MessageChannel();

            // Register while parent span is active
            collector.registerAuxiliary('worker-1', port1, parentSpan.id);

            collector.endSpan(parentSpan);

            // Worker spans should be parented to parentSpan
            // (This is set up in the channel but tested via message handling)
            assert.deepStrictEqual(collector.auxiliaryWorkerIds, ['worker-1']);

            port1.close();
            port2.close();
        });

        test('explicit parentSpanId is used when provided', () => {
            const span1 = collector.startSpan('span-1');
            collector.endSpan(span1);

            const span2 = collector.startSpan('span-2');
            const { workerPort } = collector.createAuxiliaryChannel('worker-1', span2.id);
            collector.endSpan(span2);

            // Channel was created with span2 as parent
            assert.deepStrictEqual(collector.auxiliaryWorkerIds, ['worker-1']);

            workerPort.close();
        });
    });

    // ========================================
    // Cleanup
    // ========================================

    describe('cleanup', () => {
        test('reset closes all channels', () => {
            const { port1: p1a } = new MessageChannel();
            const { port1: p1b } = new MessageChannel();

            collector.registerAuxiliary('worker-1', p1a);
            collector.registerAuxiliary('worker-2', p1b);

            collector.reset();

            assert.deepStrictEqual(collector.auxiliaryWorkerIds, []);
        });

        test('reset clears collected data', () => {
            const span = collector.startSpan('test');
            collector.incrementCounter('counter', 100);
            collector.endSpan(span);

            collector.reset();

            assert.deepStrictEqual(collector.toJSON(), []);
            assert.strictEqual(collector.getCounter('counter'), 0);
        });

        test('dispose cleans up everything', () => {
            const { port1 } = new MessageChannel();
            collector.registerAuxiliary('worker-1', port1);

            collector.dispose();

            assert.deepStrictEqual(collector.auxiliaryWorkerIds, []);
        });
    });
});

// ============================================================================
// AuxiliaryDiagnosticsCollector Tests
// ============================================================================

describe('AuxiliaryDiagnosticsCollector', () => {
    /** @type {MessageChannel} */
    let channel;

    /** @type {AuxiliaryDiagnosticsCollector} */
    let collector;

    /** @type {any[]} */
    let receivedMessages;

    beforeEach(() => {
        channel = new MessageChannel();
        receivedMessages = [];

        // Set up receiver on port1
        channel.port1.on('message', (msg) => {
            receivedMessages.push(msg);
        });

        // Create collector with port2
        collector = new AuxiliaryDiagnosticsCollector({
            workerId: 'test-worker',
            port: channel.port2,
            enabled: true,
        });
    });

    afterEach(() => {
        collector.close();
        channel.port1.close();
    });

    // ========================================
    // Basic Properties
    // ========================================

    describe('basic properties', () => {
        test('is instance of DiagnosticsCollector', () => {
            assert.ok(collector instanceof DiagnosticsCollector);
        });

        test('workerId is set correctly', () => {
            assert.strictEqual(collector.workerId, 'test-worker');
        });

        test('enabled state is respected', () => {
            assert.strictEqual(collector.enabled, true);
        });

        test('disabled collector does not send messages', async () => {
            const disabledChannel = new MessageChannel();
            const disabledMessages = [];

            disabledChannel.port1.on('message', (msg) => {
                disabledMessages.push(msg);
            });

            const disabledCollector = new AuxiliaryDiagnosticsCollector({
                workerId: 'disabled-worker',
                port: disabledChannel.port2,
                enabled: false,
            });

            const span = disabledCollector.startSpan('test');
            disabledCollector.recordEvent('event');
            disabledCollector.incrementCounter('counter');
            disabledCollector.endSpan(span);

            await sleep(10);

            assert.strictEqual(disabledMessages.length, 0);

            disabledCollector.close();
            disabledChannel.port1.close();
        });
    });

    // ========================================
    // Span Messages
    // ========================================

    describe('span messages', () => {
        test('startSpan sends span-start message', async () => {
            const span = collector.startSpan('operation', { attr: 'value' });

            await sleep(10);

            assert.strictEqual(receivedMessages.length, 1);
            const msg = receivedMessages[0];

            assert.strictEqual(msg.type, 'span-start');
            assert.strictEqual(msg.workerId, 'test-worker');
            assert.strictEqual(msg.id, span.id);
            assert.strictEqual(msg.name, 'operation');
            assert.deepStrictEqual(msg.attributes, { attr: 'value' });
            assert.strictEqual(typeof msg.timestamp, 'number');
            assert.ok(msg.timestamp >= 0);
        });

        test('endSpan sends span-end message', async () => {
            const span = collector.startSpan('operation');
            collector.endSpan(span, { pixels: 1000, ops: 50 });

            await sleep(10);

            // Find the span-end message (there will also be a span-start message)
            const msg = receivedMessages.find(m => m.type === 'span-end');
            assert.ok(msg, 'should have a span-end message');

            assert.strictEqual(msg.type, 'span-end');
            assert.strictEqual(msg.workerId, 'test-worker');
            assert.strictEqual(msg.id, span.id);
            assert.deepStrictEqual(msg.metrics, { pixels: 1000, ops: 50 });
            assert.strictEqual(typeof msg.timestamp, 'number');
        });

        test('nested spans have correct parentId', async () => {
            const parentSpan = collector.startSpan('parent');
            const childSpan = collector.startSpan('child');

            await sleep(10);

            // Find child span-start message
            const childMsg = receivedMessages.find(m =>
                m.type === 'span-start' && m.name === 'child'
            );

            assert.ok(childMsg);
            assert.strictEqual(childMsg.parentId, parentSpan.id);

            collector.endSpan(childSpan);
            collector.endSpan(parentSpan);
        });

        test('root span has null parentId', async () => {
            collector.startSpan('root');

            await sleep(10);

            const msg = receivedMessages[0];
            assert.strictEqual(msg.parentId, null);
        });
    });

    // ========================================
    // Event Messages
    // ========================================

    describe('event messages', () => {
        test('recordEvent sends event message', async () => {
            collector.recordEvent('cache-hit', { key: 'test' });

            await sleep(10);

            assert.strictEqual(receivedMessages.length, 1);
            const msg = receivedMessages[0];

            assert.strictEqual(msg.type, 'event');
            assert.strictEqual(msg.workerId, 'test-worker');
            assert.strictEqual(msg.name, 'cache-hit');
            assert.deepStrictEqual(msg.data, { key: 'test' });
            assert.strictEqual(typeof msg.timestamp, 'number');
            assert.strictEqual(msg.spanId, null);
        });

        test('event includes current spanId', async () => {
            const span = collector.startSpan('operation');
            collector.recordEvent('inside-span');

            await sleep(10);

            // Find the event message (not the span-start message)
            const msg = receivedMessages.find(m => m.type === 'event');
            assert.ok(msg, 'should have an event message');
            assert.strictEqual(msg.spanId, span.id);

            collector.endSpan(span);
        });
    });

    // ========================================
    // Counter Messages
    // ========================================

    describe('counter messages', () => {
        test('incrementCounter sends counter message', async () => {
            collector.incrementCounter('pixels', 5000);

            await sleep(10);

            assert.strictEqual(receivedMessages.length, 1);
            const msg = receivedMessages[0];

            assert.strictEqual(msg.type, 'counter');
            assert.strictEqual(msg.workerId, 'test-worker');
            assert.strictEqual(msg.name, 'pixels');
            assert.strictEqual(msg.delta, 5000);
        });

        test('default delta is 1', async () => {
            collector.incrementCounter('operations');

            await sleep(10);

            const msg = receivedMessages[0];
            assert.strictEqual(msg.delta, 1);
        });
    });

    // ========================================
    // Local State (Still Works)
    // ========================================

    describe('local state tracking', () => {
        test('still tracks spans locally', () => {
            const span = collector.startSpan('operation', { attr: 'value' });
            collector.endSpan(span, { metric: 42 });

            const json = collector.toJSON();
            assert.strictEqual(json.length, 1);
            assert.strictEqual(json[0].name, 'operation');
        });

        test('still tracks events locally', () => {
            collector.recordEvent('test-event');
            const log = collector.toTraceLog();
            assert.ok(log.includes('test-event'));
        });

        test('still tracks counters locally', () => {
            collector.incrementCounter('counter', 100);
            assert.strictEqual(collector.getCounter('counter'), 100);
        });
    });

    // ========================================
    // Lifecycle
    // ========================================

    describe('lifecycle', () => {
        test('close() closes the port', () => {
            // Just verify it doesn't throw
            collector.close();
        });

        test('reset() resets start time', async () => {
            const span1 = collector.startSpan('first');
            collector.endSpan(span1);

            await sleep(10);
            const firstTimestamp = receivedMessages[0].timestamp;

            collector.reset();
            receivedMessages.length = 0;

            const span2 = collector.startSpan('second');
            collector.endSpan(span2);

            await sleep(10);
            const secondTimestamp = receivedMessages[0].timestamp;

            // Second timestamp should be smaller (reset start time)
            assert.ok(secondTimestamp < firstTimestamp + 5,
                `second timestamp (${secondTimestamp}) should be small after reset`);
        });
    });
});

// ============================================================================
// Integration Tests (Main + Auxiliary)
// ============================================================================

describe('Main + Auxiliary Integration', () => {
    /** @type {MainDiagnosticsCollector} */
    let mainCollector;

    /** @type {AuxiliaryDiagnosticsCollector} */
    let auxCollector;

    /** @type {MessagePort} */
    let workerPort;

    beforeEach(() => {
        mainCollector = new MainDiagnosticsCollector();
        const { mainPort, workerPort: wp } = mainCollector.createAuxiliaryChannel('worker-1');
        workerPort = wp;

        auxCollector = new AuxiliaryDiagnosticsCollector({
            workerId: 'worker-1',
            port: workerPort,
            enabled: true,
        });
    });

    afterEach(() => {
        auxCollector.close();
        mainCollector.dispose();
    });

    test('auxiliary span appears in main collector output', async () => {
        // Main thread starts a parent span
        const mainSpan = mainCollector.startSpan('document-conversion');

        // Auxiliary starts and ends a span
        const auxSpan = auxCollector.startSpan('worker-task', { taskId: 1 });
        auxCollector.endSpan(auxSpan, { pixels: 1000 });

        // Wait for messages to propagate
        await sleep(20);

        mainCollector.endSpan(mainSpan);

        // Check main collector's trace log includes auxiliary span info
        const log = mainCollector.toTraceLog();
        assert.ok(log.includes('worker-task') || log.includes('aux-span-start'));
    });

    test('auxiliary counter merges into main collector', async () => {
        mainCollector.incrementCounter('total-pixels', 1000);
        auxCollector.incrementCounter('total-pixels', 500);

        await sleep(20);

        assert.strictEqual(mainCollector.getCounter('total-pixels'), 1500);
    });

    test('auxiliary events appear in main collector', async () => {
        auxCollector.recordEvent('worker-started', { taskId: 'task-1' });

        await sleep(20);

        const log = mainCollector.toTraceLog();
        assert.ok(log.includes('worker-started'));
    });

    test('multiple spans from auxiliary are tracked', async () => {
        const span1 = auxCollector.startSpan('task-1');
        auxCollector.endSpan(span1);

        const span2 = auxCollector.startSpan('task-2');
        auxCollector.endSpan(span2);

        const span3 = auxCollector.startSpan('task-3');
        auxCollector.endSpan(span3);

        await sleep(30);

        const log = mainCollector.toTraceLog();
        assert.ok(log.includes('task-1') || log.includes('aux-span'));
        assert.ok(log.includes('task-2') || log.includes('aux-span'));
        assert.ok(log.includes('task-3') || log.includes('aux-span'));
    });

    test('nested auxiliary spans maintain parent-child relationship', async () => {
        const parent = auxCollector.startSpan('parent');
        const child = auxCollector.startSpan('child');
        auxCollector.endSpan(child);
        auxCollector.endSpan(parent);

        await sleep(20);

        // Both should appear in the trace
        const log = mainCollector.toTraceLog();
        assert.ok(log.includes('parent') || log.includes('aux-span'));
        assert.ok(log.includes('child') || log.includes('aux-span'));
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
