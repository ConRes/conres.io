// @ts-check
/**
 * Auxiliary Diagnostics Collector
 *
 * Extends DiagnosticsCollector for use in worker threads.
 * Sends all diagnostic data via MessageChannel to MainDiagnosticsCollector.
 *
 * The "one cook" model: AuxiliaryDiagnosticsCollector sends data to the main
 * thread, where MainDiagnosticsCollector integrates it into the single tree.
 *
 * @module AuxiliaryDiagnosticsCollector
 */

import { DiagnosticsCollector } from './diagnostics-collector.js';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Message sent to main collector.
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

// ============================================================================
// AuxiliaryDiagnosticsCollector Class
// ============================================================================

/**
 * Worker thread diagnostics collector that sends data via MessageChannel.
 *
 * Features:
 * - Inherits all DiagnosticsCollector functionality for local tracking
 * - Sends span/event/counter data to main thread via MessagePort
 * - Maintains local span tracking for parent-child relationships
 *
 * @extends DiagnosticsCollector
 *
 * @example
 * ```javascript
 * // In worker thread:
 * const diagnostics = new AuxiliaryDiagnosticsCollector({
 *     workerId: 'worker-1',
 *     port: workerData.diagnosticsPort,
 * });
 *
 * const span = diagnostics.startSpan('image-conversion', { ref: 'Im0' });
 * // ... work ...
 * diagnostics.endSpan(span, { pixels: 2073600 });
 * ```
 */
export class AuxiliaryDiagnosticsCollector extends DiagnosticsCollector {
    // ========================================
    // Private Fields
    // ========================================

    /** @type {string} */
    #workerId;

    /** @type {MessagePort} */
    #port;

    /** @type {number} */
    #startTime;

    // ========================================
    // Constructor
    // ========================================

    /**
     * Creates a new AuxiliaryDiagnosticsCollector instance.
     *
     * @param {object} options - Configuration options
     * @param {string} options.workerId - Unique identifier for this worker
     * @param {MessagePort} options.port - MessagePort to send data through
     * @param {boolean} [options.enabled=true] - Whether collection is enabled
     */
    constructor(options) {
        super({ enabled: options.enabled });
        this.#workerId = options.workerId;
        this.#port = options.port;
        this.#startTime = performance.now();
    }

    // ========================================
    // Overridden Methods - Span Tracking
    // ========================================

    /**
     * Starts a new span and sends notification to main collector.
     *
     * @param {string} name - Operation name
     * @param {Record<string, any>} [attributes={}] - Initial attributes
     * @returns {import('./diagnostics-collector.js').SpanHandle} Handle to use with endSpan
     * @override
     */
    startSpan(name, attributes = {}) {
        const handle = super.startSpan(name, attributes);

        if (this.enabled && handle.id !== 0) {
            this.#sendMessage({
                type: 'span-start',
                workerId: this.#workerId,
                id: handle.id,
                name,
                attributes: { ...attributes },
                timestamp: performance.now() - this.#startTime,
                parentId: this.#getParentId(handle.id),
            });
        }

        return handle;
    }

    /**
     * Starts a nested span with explicit parent and sends notification to main collector.
     *
     * @param {import('./diagnostics-collector.js').SpanHandle} parentHandle - Parent span handle
     * @param {string} name - Operation name
     * @param {Record<string, any>} [attributes={}] - Initial attributes
     * @returns {import('./diagnostics-collector.js').SpanHandle} Handle to use with endSpan
     * @override
     */
    startNestedSpan(parentHandle, name, attributes = {}) {
        const handle = super.startNestedSpan(parentHandle, name, attributes);

        if (this.enabled && handle.id !== 0) {
            this.#sendMessage({
                type: 'span-start',
                workerId: this.#workerId,
                id: handle.id,
                name,
                attributes: { ...attributes },
                timestamp: performance.now() - this.#startTime,
                parentId: parentHandle.id !== 0 ? parentHandle.id : null,
            });
        }

        return handle;
    }

    /**
     * Ends a span and sends notification to main collector.
     *
     * @param {import('./diagnostics-collector.js').SpanHandle} handle - Handle from startSpan
     * @param {Record<string, number>} [metrics={}] - Final metrics
     * @override
     */
    endSpan(handle, metrics = {}) {
        if (this.enabled && handle.id !== 0) {
            // Check if span is still open before sending message
            const serialized = this.serialize();
            const span = serialized.spans.find(s => s.id === handle.id);
            if (span && span.status === 'open') {
                this.#sendMessage({
                    type: 'span-end',
                    workerId: this.#workerId,
                    id: handle.id,
                    metrics: { ...metrics },
                    timestamp: performance.now() - this.#startTime,
                });
            }
        }

        super.endSpan(handle, metrics);
    }

    /**
     * Updates a span with additional data and sends notification to main collector.
     *
     * @param {import('./diagnostics-collector.js').SpanHandle} handle - Handle from startSpan
     * @param {Record<string, any>} [data={}] - Attributes and/or metrics to add
     * @override
     */
    updateSpan(handle, data = {}) {
        if (this.enabled && handle.id !== 0) {
            this.#sendMessage({
                type: 'span-update',
                workerId: this.#workerId,
                id: handle.id,
                data: { ...data },
            });
        }

        super.updateSpan(handle, data);
    }

    /**
     * Aborts a span and sends notification to main collector.
     *
     * @param {import('./diagnostics-collector.js').SpanHandle} handle - Handle from startSpan
     * @param {import('./diagnostics-collector.js').AbortData} data - Abort reason
     * @override
     */
    abortSpan(handle, data) {
        if (this.enabled && handle.id !== 0) {
            this.#sendMessage({
                type: 'span-abort',
                workerId: this.#workerId,
                id: handle.id,
                abortData: data,
                timestamp: performance.now() - this.#startTime,
            });
        }

        super.abortSpan(handle, data);
    }

    // ========================================
    // Overridden Methods - Event Recording
    // ========================================

    /**
     * Records an event and sends notification to main collector.
     *
     * @param {string} name - Event name
     * @param {Record<string, any>} [data={}] - Event data
     * @override
     */
    recordEvent(name, data = {}) {
        if (this.enabled) {
            this.#sendMessage({
                type: 'event',
                workerId: this.#workerId,
                name,
                data: { ...data },
                timestamp: performance.now() - this.#startTime,
                spanId: this.currentSpanId,
            });
        }

        super.recordEvent(name, data);
    }

    // ========================================
    // Overridden Methods - Counter Tracking
    // ========================================

    /**
     * Increments a counter and sends notification to main collector.
     *
     * @param {string} name - Counter name
     * @param {number} [delta=1] - Amount to increment
     * @override
     */
    incrementCounter(name, delta = 1) {
        if (this.enabled) {
            this.#sendMessage({
                type: 'counter',
                workerId: this.#workerId,
                name,
                delta,
            });
        }

        super.incrementCounter(name, delta);
    }

    // ========================================
    // Private Methods
    // ========================================

    /**
     * Sends a message to the main collector.
     *
     * @param {AuxiliaryMessage} message
     */
    #sendMessage(message) {
        try {
            this.#port.postMessage(message);
        } catch (error) {
            // Port may be closed or invalid - fail silently
            console.warn(`[AuxiliaryDiagnosticsCollector] Failed to send message: ${error.message}`);
        }
    }

    /**
     * Gets the parent span ID for a given span.
     *
     * Since we can't access the private #spans array directly,
     * we use the currentSpanId before starting a new span.
     * This is a workaround - the actual parent is set before
     * currentSpanId is updated to the new span.
     *
     * @param {number} spanId - The new span's ID
     * @returns {number | null}
     */
    #getParentId(spanId) {
        // After startSpan, currentSpanId is the new span.
        // The parent is stored in the span's parentId field.
        // Since we can't access spans directly, we track it via serialize.
        const serialized = this.serialize();
        const span = serialized.spans.find(s => s.id === spanId);
        return span?.parentId ?? null;
    }

    // ========================================
    // Worker Lifecycle
    // ========================================

    /**
     * Gets the worker ID.
     * @returns {string}
     */
    get workerId() {
        return this.#workerId;
    }

    /**
     * Closes the port connection.
     * Call this when the worker is done.
     */
    close() {
        this.#port.close();
    }

    /**
     * Resets the collector and maintains port connection.
     * @override
     */
    reset() {
        super.reset();
        this.#startTime = performance.now();
    }
}
