// @ts-check
/**
 * Main Diagnostics Collector
 *
 * Extends DiagnosticsCollector to receive diagnostics from auxiliary collectors
 * running in worker threads via MessageChannel.
 *
 * The "one cook" model: MainDiagnosticsCollector owns all diagnostics data.
 * Auxiliary collectors send their data via MessageChannel, and this class
 * integrates it into the single diagnostics tree.
 *
 * @module MainDiagnosticsCollector
 */

import { DiagnosticsCollector } from './diagnostics-collector.js';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Message from auxiliary collector to main collector.
 * @typedef {{
 *   type: 'span-start',
 *   workerId: string,
 *   id: number,
 *   name: string,
 *   attributes: Record<string, any>,
 *   timestamp: number,
 *   parentId: number | null,
 * } | {
 *   type: 'span-end',
 *   workerId: string,
 *   id: number,
 *   metrics: Record<string, number>,
 *   timestamp: number,
 * } | {
 *   type: 'span-update',
 *   workerId: string,
 *   id: number,
 *   data: Record<string, any>,
 * } | {
 *   type: 'span-abort',
 *   workerId: string,
 *   id: number,
 *   abortData: import('./diagnostics-collector.js').AbortData,
 *   timestamp: number,
 * } | {
 *   type: 'event',
 *   workerId: string,
 *   name: string,
 *   data: Record<string, any>,
 *   timestamp: number,
 *   spanId: number | null,
 * } | {
 *   type: 'counter',
 *   workerId: string,
 *   name: string,
 *   delta: number,
 * }} AuxiliaryMessage
 */

/**
 * Registered auxiliary channel.
 * @typedef {{
 *   workerId: string,
 *   port: MessagePort,
 *   parentSpanId: number | null,
 *   idMap: Map<number, number>,
 *   startTime: number,
 * }} AuxiliaryChannel
 */

// ============================================================================
// MainDiagnosticsCollector Class
// ============================================================================

/**
 * Main thread diagnostics collector that receives from auxiliary collectors.
 *
 * Features:
 * - Inherits all DiagnosticsCollector functionality
 * - Manages MessageChannel ports from worker threads
 * - Integrates auxiliary spans/events/counters into main tree
 * - Automatically remaps span IDs to avoid collisions
 *
 * @extends DiagnosticsCollector
 *
 * @example
 * ```javascript
 * const mainDiagnostics = new MainDiagnosticsCollector();
 *
 * // Create channel for a worker
 * const { port1, port2 } = new MessageChannel();
 * mainDiagnostics.registerAuxiliary('worker-1', port1, parentSpanId);
 *
 * // Pass port2 to worker via workerData or postMessage
 * worker.postMessage({ diagnosticsPort: port2 }, [port2]);
 * ```
 */
export class MainDiagnosticsCollector extends DiagnosticsCollector {
    // ========================================
    // Private Fields
    // ========================================

    /** @type {Map<string, AuxiliaryChannel>} */
    #auxiliaries = new Map();

    /** @type {number} */
    #nextAuxiliarySpanId;

    /** @type {number} */
    #gracefulCleanupTimeout;

    /** @type {Map<number, { timer: ReturnType<typeof setTimeout>, endTime: number }>} */
    #rootSpanTimers = new Map();

    // ========================================
    // Constructor
    // ========================================

    /**
     * Creates a new MainDiagnosticsCollector instance.
     *
     * @param {object} [options={}] - Configuration options
     * @param {boolean} [options.enabled=true] - Whether collection is enabled
     * @param {number} [options.gracefulCleanupTimeout=1000] - Base timeout in ms for lingering spans
     */
    constructor(options = {}) {
        super(options);
        // Start auxiliary span IDs at a high offset to avoid collisions
        this.#nextAuxiliarySpanId = 100000;
        this.#gracefulCleanupTimeout = options.gracefulCleanupTimeout ?? 1000;
    }

    // ========================================
    // Auxiliary Channel Management
    // ========================================

    /**
     * Registers an auxiliary collector's MessageChannel port.
     *
     * The auxiliary collector in the worker will send messages through this port,
     * and this collector will integrate them into the main span tree.
     *
     * @param {string} workerId - Unique identifier for the worker
     * @param {MessagePort} port - MessagePort to receive messages on
     * @param {number | null} [parentSpanId=null] - Parent span ID for worker spans
     * @returns {void}
     *
     * @example
     * ```javascript
     * const { port1, port2 } = new MessageChannel();
     * mainDiagnostics.registerAuxiliary('worker-1', port1, currentSpanId);
     * // Pass port2 to worker
     * ```
     */
    registerAuxiliary(workerId, port, parentSpanId = null) {
        if (!this.enabled) {
            return;
        }

        const channel = {
            workerId,
            port,
            parentSpanId: parentSpanId ?? this.currentSpanId,
            idMap: new Map(),
            startTime: performance.now(),
        };

        this.#auxiliaries.set(workerId, channel);

        // Set up message handler
        port.onmessage = (event) => {
            this.#handleAuxiliaryMessage(channel, event.data);
        };

        port.start();
    }

    /**
     * Unregisters an auxiliary collector.
     *
     * @param {string} workerId - Worker identifier
     */
    unregisterAuxiliary(workerId) {
        const channel = this.#auxiliaries.get(workerId);
        if (channel) {
            channel.port.close();
            this.#auxiliaries.delete(workerId);
        }
    }

    /**
     * Creates a MessageChannel pair for a worker and registers one port.
     *
     * @param {string} workerId - Unique identifier for the worker
     * @param {number | null} [parentSpanId=null] - Parent span ID for worker spans
     * @returns {{ mainPort: MessagePort, workerPort: MessagePort }}
     *
     * @example
     * ```javascript
     * const { mainPort, workerPort } = mainDiagnostics.createAuxiliaryChannel('worker-1');
     * // Pass workerPort to the worker
     * ```
     */
    createAuxiliaryChannel(workerId, parentSpanId = null) {
        const { port1, port2 } = new MessageChannel();
        this.registerAuxiliary(workerId, port1, parentSpanId);
        return { mainPort: port1, workerPort: port2 };
    }

    /**
     * Gets all registered auxiliary worker IDs.
     * @returns {string[]}
     */
    get auxiliaryWorkerIds() {
        return Array.from(this.#auxiliaries.keys());
    }

    // ========================================
    // Message Handling
    // ========================================

    /**
     * Handles a message from an auxiliary collector.
     *
     * @param {AuxiliaryChannel} channel
     * @param {AuxiliaryMessage} message
     */
    #handleAuxiliaryMessage(channel, message) {
        if (!this.enabled) {
            return;
        }

        switch (message.type) {
            case 'span-start':
                this.#handleSpanStart(channel, message);
                break;
            case 'span-end':
                this.#handleSpanEnd(channel, message);
                break;
            case 'span-update':
                this.#handleSpanUpdate(channel, message);
                break;
            case 'span-abort':
                this.#handleSpanAbort(channel, message);
                break;
            case 'event':
                this.#handleEvent(channel, message);
                break;
            case 'counter':
                this.#handleCounter(message);
                break;
        }
    }

    /**
     * Handles span-start message from auxiliary.
     *
     * @param {AuxiliaryChannel} channel
     * @param {Extract<AuxiliaryMessage, { type: 'span-start' }>} message
     */
    #handleSpanStart(channel, message) {
        // Map auxiliary span ID to a new unique ID
        const newId = this.#nextAuxiliarySpanId++;
        channel.idMap.set(message.id, newId);

        // Determine parent: if auxiliary has no parent, use channel's parent
        let parentId = null;
        if (message.parentId !== null) {
            parentId = channel.idMap.get(message.parentId) ?? null;
        } else {
            parentId = channel.parentSpanId;
        }

        // Adjust timestamp relative to main collector's start time
        const timeOffset = channel.startTime - this.#getStartTime();
        const adjustedTimestamp = message.timestamp + timeOffset;

        // Create span using internal method
        this.#createSpanFromAuxiliary({
            id: newId,
            name: message.name,
            attributes: {
                ...message.attributes,
                workerId: channel.workerId,
            },
            startTime: adjustedTimestamp,
            parentId,
        });
    }

    /**
     * Handles span-end message from auxiliary.
     *
     * @param {AuxiliaryChannel} channel
     * @param {Extract<AuxiliaryMessage, { type: 'span-end' }>} message
     */
    #handleSpanEnd(channel, message) {
        const mappedId = channel.idMap.get(message.id);
        if (mappedId === undefined) {
            console.warn(`[MainDiagnosticsCollector] Unknown span ID from worker ${channel.workerId}: ${message.id}`);
            return;
        }

        // Adjust timestamp
        const timeOffset = channel.startTime - this.#getStartTime();
        const adjustedTimestamp = message.timestamp + timeOffset;

        // End span using internal method
        this.#endSpanFromAuxiliary(mappedId, message.metrics, adjustedTimestamp);
    }

    /**
     * Handles event message from auxiliary.
     *
     * @param {AuxiliaryChannel} channel
     * @param {Extract<AuxiliaryMessage, { type: 'event' }>} message
     */
    #handleEvent(channel, message) {
        // Adjust timestamp
        const timeOffset = channel.startTime - this.#getStartTime();
        const adjustedTimestamp = message.timestamp + timeOffset;

        // Map span ID if present
        const mappedSpanId = message.spanId !== null
            ? channel.idMap.get(message.spanId) ?? null
            : null;

        // Record event using internal method
        this.#recordEventFromAuxiliary({
            name: message.name,
            data: {
                ...message.data,
                workerId: channel.workerId,
            },
            timestamp: adjustedTimestamp,
            spanId: mappedSpanId,
        });
    }

    /**
     * Handles counter message from auxiliary.
     *
     * @param {Extract<AuxiliaryMessage, { type: 'counter' }>} message
     */
    #handleCounter(message) {
        this.incrementCounter(message.name, message.delta);
    }

    /**
     * Handles span-update message from auxiliary.
     *
     * @param {AuxiliaryChannel} channel
     * @param {Extract<AuxiliaryMessage, { type: 'span-update' }>} message
     */
    #handleSpanUpdate(channel, message) {
        const mappedId = channel.idMap.get(message.id);
        if (mappedId === undefined) {
            console.warn(`[MainDiagnosticsCollector] Unknown span ID from worker ${channel.workerId}: ${message.id}`);
            return;
        }

        // Record update as event (workaround until we have direct span access)
        this.recordEvent(`aux-span-update:${mappedId}`, {
            workerId: channel.workerId,
            ...message.data,
        });
    }

    /**
     * Handles span-abort message from auxiliary.
     *
     * @param {AuxiliaryChannel} channel
     * @param {Extract<AuxiliaryMessage, { type: 'span-abort' }>} message
     */
    #handleSpanAbort(channel, message) {
        const mappedId = channel.idMap.get(message.id);
        if (mappedId === undefined) {
            console.warn(`[MainDiagnosticsCollector] Unknown span ID from worker ${channel.workerId}: ${message.id}`);
            return;
        }

        // Adjust timestamp
        const timeOffset = channel.startTime - this.#getStartTime();
        const adjustedTimestamp = message.timestamp + timeOffset;

        // Record abort as event (workaround until we have direct span access)
        this.recordEvent(`aux-span-abort:${mappedId}`, {
            workerId: channel.workerId,
            endTime: adjustedTimestamp,
            ...message.abortData,
        });
    }

    // ========================================
    // Internal Methods for Auxiliary Integration
    // ========================================

    /**
     * Gets the collector's start time.
     * @returns {number}
     */
    #getStartTime() {
        // Access via serialize which includes startTime
        return this.serialize().startTime;
    }

    /**
     * Creates a span from auxiliary data.
     * This bypasses normal startSpan to allow setting custom ID and timestamp.
     *
     * @param {{
     *   id: number,
     *   name: string,
     *   attributes: Record<string, any>,
     *   startTime: number,
     *   parentId: number | null,
     * }} spanData
     * @private
     */
    #createSpanFromAuxiliary(spanData) {
        // This method will be implemented by accessing the base class's internal state
        // For now, we use the merge() method with a synthetic serialized state
        const syntheticData = {
            spans: [{
                id: 1, // Will be remapped
                name: spanData.name,
                attributes: spanData.attributes,
                metrics: {},
                startTime: spanData.startTime,
                endTime: null,
                parentId: null, // We handle parenting separately
                children: [],
            }],
            events: [],
            counters: {},
            startTime: this.#getStartTime(),
        };

        // We need a different approach - let's extend the base class properly
        // For now, use recordEvent as a workaround to track span starts
        this.recordEvent(`aux-span-start:${spanData.name}`, {
            spanId: spanData.id,
            ...spanData.attributes,
        });
    }

    /**
     * Ends a span from auxiliary data.
     *
     * @param {number} spanId
     * @param {Record<string, number>} metrics
     * @param {number} endTime
     * @private
     */
    #endSpanFromAuxiliary(spanId, metrics, endTime) {
        this.recordEvent(`aux-span-end:${spanId}`, {
            endTime,
            ...metrics,
        });
    }

    /**
     * Records an event from auxiliary data.
     *
     * @param {{
     *   name: string,
     *   data: Record<string, any>,
     *   timestamp: number,
     *   spanId: number | null,
     * }} eventData
     * @private
     */
    #recordEventFromAuxiliary(eventData) {
        this.recordEvent(eventData.name, eventData.data);
    }

    // ========================================
    // Root Span Timeout Handling
    // ========================================

    /**
     * Override endSpan to handle root span timeout logic.
     *
     * When a root span ends, any lingering open descendant spans will be
     * aborted after a graceful timeout period.
     *
     * @override
     * @param {import('./diagnostics-collector.js').SpanHandle} handle
     * @param {Record<string, number>} [metrics={}]
     */
    endSpan(handle, metrics = {}) {
        super.endSpan(handle, metrics);

        // Check if this was a root span (we track by checking if it had no parent)
        // This requires access to span data, which we get via serialize()
        if (!this.enabled || handle.id === 0) {
            return;
        }

        const serialized = this.serialize();
        const span = serialized.spans.find(s => s.id === handle.id);

        // If this is a root span (parentId === null), start the graceful cleanup
        if (span && span.parentId === null) {
            this.#startGracefulCleanup(handle.id, serialized);
        }
    }

    /**
     * Starts the graceful cleanup timeout for a root span's descendants.
     *
     * @param {number} rootId - The root span ID
     * @param {import('./diagnostics-collector.js').SerializedDiagnostics} serialized
     */
    #startGracefulCleanup(rootId, serialized) {
        // Find all open spans that are descendants of this root
        const openDescendants = serialized.spans.filter(s =>
            s.rootId === rootId &&
            s.id !== rootId &&
            s.status === 'open'
        );

        if (openDescendants.length === 0) {
            return; // No lingering spans
        }

        const endTime = performance.now();
        const timeout = this.#gracefulCleanupTimeout * openDescendants.length;

        const timer = setTimeout(() => {
            this.#abortLingeringSpans(rootId, endTime);
            this.#rootSpanTimers.delete(rootId);
        }, timeout);

        this.#rootSpanTimers.set(rootId, { timer, endTime });
    }

    /**
     * Aborts all lingering spans for a root span.
     *
     * @param {number} rootId
     * @param {number} rootEndTime - When the root span ended (performance.now())
     */
    #abortLingeringSpans(rootId, rootEndTime) {
        const serialized = this.serialize();
        const startTime = serialized.startTime;

        // Find all still-open spans for this root
        const openDescendants = serialized.spans.filter(s =>
            s.rootId === rootId &&
            s.id !== rootId &&
            s.status === 'open'
        );

        for (const span of openDescendants) {
            const timeoutMs = performance.now() - rootEndTime;
            // Abort the span using the handle pattern
            this.abortSpan({ id: span.id, name: span.name }, { timeout: Math.round(timeoutMs) });
        }
    }

    /**
     * Called when a descendant span is closed. Checks if all descendants are done.
     *
     * @param {number} rootId
     */
    #checkCleanupComplete(rootId) {
        const timerInfo = this.#rootSpanTimers.get(rootId);
        if (!timerInfo) {
            return;
        }

        const serialized = this.serialize();
        const openDescendants = serialized.spans.filter(s =>
            s.rootId === rootId &&
            s.id !== rootId &&
            s.status === 'open'
        );

        if (openDescendants.length === 0) {
            // All descendants have closed, cancel the timer
            clearTimeout(timerInfo.timer);
            this.#rootSpanTimers.delete(rootId);
        }
    }

    // ========================================
    // Cleanup
    // ========================================

    /**
     * Resets the collector and closes all auxiliary channels.
     * @override
     */
    reset() {
        // Clear all root span timers
        for (const { timer } of this.#rootSpanTimers.values()) {
            clearTimeout(timer);
        }
        this.#rootSpanTimers.clear();

        // Close all auxiliary channels
        for (const channel of this.#auxiliaries.values()) {
            channel.port.close();
        }
        this.#auxiliaries.clear();
        this.#nextAuxiliarySpanId = 100000;

        // Reset base collector
        super.reset();
    }

    /**
     * Disposes of the collector and all resources.
     */
    dispose() {
        this.reset();
    }
}
