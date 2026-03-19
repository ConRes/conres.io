// @ts-check
/**
 * Diagnostics Collector
 *
 * Collects timing, events, and counters during PDF color conversion.
 * Outputs Hatchet-compatible JSON for Performance Profile Viewer.
 *
 * @module DiagnosticsCollector
 */

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Span status indicating lifecycle state.
 * @typedef {'open' | 'completed' | 'aborted'} SpanStatus
 */

/**
 * Abort data indicating why a span was aborted.
 * @typedef {{ reason: string } | { timeout: number }} AbortData
 */

/**
 * A span represents a timed operation with optional children.
 * @typedef {{
 *   id: number,
 *   name: string,
 *   rootId: number,
 *   attributes: Record<string, any>,
 *   metrics: Record<string, number>,
 *   startTime: number,
 *   endTime: number | null,
 *   status: SpanStatus,
 *   abortData: AbortData | null,
 *   parentId: number | null,
 *   children: number[],
 * }} Span
 */

/**
 * An instant event recorded during execution.
 * @typedef {{
 *   timestamp: number,
 *   name: string,
 *   data: Record<string, any>,
 *   spanId: number | null,
 * }} Event
 */

/**
 * Span handle returned by startSpan for use with endSpan.
 * @typedef {{
 *   id: number,
 *   name: string,
 * }} SpanHandle
 */

/**
 * Hatchet-compatible node for JSON output.
 * @typedef {{
 *   name: string,
 *   frame: string[],
 *   metrics: Record<string, number>,
 *   attributes: Record<string, any>,
 *   status: 'completed' | 'aborted',
 *   children: DiagnosticsNode[],
 * }} DiagnosticsNode
 */

/**
 * Serialized collector state for worker transfer.
 * @typedef {{
 *   spans: Span[],
 *   events: Event[],
 *   counters: Record<string, number>,
 *   startTime: number,
 * }} SerializedDiagnostics
 */

// ============================================================================
// DiagnosticsCollector Class
// ============================================================================

/**
 * Collects diagnostics data during PDF color conversion operations.
 *
 * Features:
 * - Hierarchical span tracking with parent-child relationships
 * - Instant event recording
 * - Counter tracking for aggregated metrics
 * - Hatchet-compatible JSON output for Performance Profile Viewer
 * - Human-readable text output
 * - Flat trace log output
 * - Serialization for worker thread coordination
 *
 * @example
 * ```javascript
 * const diagnostics = new DiagnosticsCollector();
 *
 * const docSpan = diagnostics.startSpan('document-conversion', {
 *     file: 'test.pdf',
 *     renderingIntent: 'relative-colorimetric',
 * });
 *
 * for (let i = 0; i < pages.length; i++) {
 *     const pageSpan = diagnostics.startSpan('page', { pageIndex: i });
 *     // ... process page ...
 *     diagnostics.endSpan(pageSpan, { images: 3, streams: 2 });
 * }
 *
 * diagnostics.endSpan(docSpan, { pages: pages.length });
 *
 * // Output
 * const json = diagnostics.toJSON();
 * const text = diagnostics.toText();
 * ```
 */
export class DiagnosticsCollector {
    // ========================================
    // Private Fields
    // ========================================

    /** @type {Span[]} */
    #spans = [];

    /** @type {Event[]} */
    #events = [];

    /** @type {Record<string, number>} */
    #counters = {};

    /** @type {number} */
    #nextSpanId = 1;

    /** @type {number | null} */
    #currentSpanId = null;

    /** @type {number} */
    #startTime;

    /** @type {boolean} */
    #enabled = true;

    // ========================================
    // Constructor
    // ========================================

    /**
     * Creates a new DiagnosticsCollector instance.
     *
     * @param {object} [options={}] - Configuration options
     * @param {boolean} [options.enabled=true] - Whether collection is enabled
     */
    constructor(options = {}) {
        this.#enabled = options.enabled !== false;
        this.#startTime = performance.now();
    }

    // ========================================
    // Configuration
    // ========================================

    /**
     * Whether diagnostics collection is enabled.
     * @returns {boolean}
     */
    get enabled() {
        return this.#enabled;
    }

    /**
     * Enables or disables diagnostics collection.
     * @param {boolean} value
     */
    set enabled(value) {
        this.#enabled = value;
    }

    // ========================================
    // Span Tracking
    // ========================================

    /**
     * Starts a new span for tracking a timed operation.
     *
     * @param {string} name - Operation name (e.g., 'document-conversion', 'page', 'image')
     * @param {Record<string, any>} [attributes={}] - Initial attributes (file, ref, colorSpace, etc.)
     * @returns {SpanHandle} Handle to use with endSpan
     *
     * @example
     * ```javascript
     * const span = diagnostics.startSpan('image-conversion', {
     *     ref: 'Im0',
     *     colorSpace: 'RGB',
     *     width: 1920,
     *     height: 1080,
     * });
     * ```
     */
    startSpan(name, attributes = {}) {
        if (!this.#enabled) {
            return { id: 0, name };
        }

        const id = this.#nextSpanId++;

        // Determine root ID: if no parent, this span is its own root
        let rootId;
        if (this.#currentSpanId !== null) {
            const parent = this.#spans.find(s => s.id === this.#currentSpanId);
            rootId = parent ? parent.rootId : id;
        } else {
            rootId = id;
        }

        const span = {
            id,
            name,
            rootId,
            attributes: { ...attributes },
            metrics: {},
            startTime: performance.now() - this.#startTime,
            endTime: null,
            status: /** @type {SpanStatus} */ ('open'),
            abortData: null,
            parentId: this.#currentSpanId,
            children: [],
        };

        this.#spans.push(span);

        // Add to parent's children
        if (this.#currentSpanId !== null) {
            const parent = this.#spans.find(s => s.id === this.#currentSpanId);
            if (parent) {
                parent.children.push(id);
            }
        }

        // Set as current span
        this.#currentSpanId = id;

        return { id, name };
    }

    /**
     * Starts a nested span with an explicit parent.
     *
     * Unlike startSpan(), this does NOT modify the current span context.
     * Use this for concurrent operations where multiple spans run in parallel
     * under the same parent.
     *
     * @param {SpanHandle} parentHandle - Parent span handle (from startSpan or startNestedSpan)
     * @param {string} name - Operation name
     * @param {Record<string, any>} [attributes={}] - Initial attributes
     * @returns {SpanHandle} Handle to use with endSpan
     *
     * @example
     * ```javascript
     * const batchSpan = diagnostics.startSpan('image-batch');
     * const imagePromises = images.map(async (image) => {
     *     const imageSpan = diagnostics.startNestedSpan(batchSpan, 'image-conversion', {
     *         ref: image.ref,
     *     });
     *     try {
     *         await convertImage(image);
     *     } finally {
     *         diagnostics.endSpan(imageSpan);
     *     }
     * });
     * await Promise.all(imagePromises);
     * diagnostics.endSpan(batchSpan);
     * ```
     */
    startNestedSpan(parentHandle, name, attributes = {}) {
        if (!this.#enabled) {
            return { id: 0, name };
        }

        // If no parent provided, fall back to startSpan behavior
        if (!parentHandle || parentHandle.id === 0) {
            return this.startSpan(name, attributes);
        }

        const id = this.#nextSpanId++;

        // Find parent span to get rootId
        const parent = this.#spans.find(s => s.id === parentHandle.id);
        const rootId = parent ? parent.rootId : id;

        const span = {
            id,
            name,
            rootId,
            attributes: { ...attributes },
            metrics: {},
            startTime: performance.now() - this.#startTime,
            endTime: null,
            status: /** @type {SpanStatus} */ ('open'),
            abortData: null,
            parentId: parentHandle.id,
            children: [],
        };

        this.#spans.push(span);

        // Add to parent's children
        if (parent) {
            parent.children.push(id);
        }

        // NOTE: We do NOT modify #currentSpanId here.
        // This allows concurrent spans to be created without interfering
        // with each other's parent-child relationships.

        return { id, name };
    }

    /**
     * Ends a span and records its metrics.
     *
     * No-op if the span is already closed (completed or aborted).
     * Should only be called in a finally block.
     *
     * @param {SpanHandle} handle - Handle from startSpan or startNestedSpan
     * @param {Record<string, number>} [metrics={}] - Final metrics (pixels, ops, images, etc.)
     *
     * @example
     * ```javascript
     * const span = diagnostics.startSpan('operation');
     * try {
     *     // ... work ...
     * } finally {
     *     diagnostics.endSpan(span, { pixels: 2073600 });
     * }
     * ```
     */
    endSpan(handle, metrics = {}) {
        if (!this.#enabled || handle.id === 0) {
            return;
        }

        const span = this.#spans.find(s => s.id === handle.id);
        if (!span) {
            console.warn(`[DiagnosticsCollector] Span not found: ${handle.id} (${handle.name})`);
            return;
        }

        // No-op if already closed (e.g., by abortSpan)
        if (span.status !== 'open') {
            return;
        }

        span.endTime = performance.now() - this.#startTime;
        span.metrics = { ...span.metrics, ...metrics };
        span.status = 'completed';

        // Only restore parent as current span if this span IS the current span.
        // This prevents concurrent/nested spans from interfering with each other.
        if (this.#currentSpanId === handle.id) {
            this.#currentSpanId = span.parentId;
        }
    }

    /**
     * Updates a span with additional attributes or metrics.
     *
     * Use this to add data during a span's lifetime without ending it.
     *
     * @param {SpanHandle} handle - Handle from startSpan
     * @param {Record<string, any>} [data={}] - Attributes and/or metrics to add
     *
     * @example
     * ```javascript
     * const span = diagnostics.startSpan('image-conversion');
     * try {
     *     // ... work ...
     *     diagnostics.updateSpan(span, { indexed: true, pixels: 1000 });
     * } finally {
     *     diagnostics.endSpan(span);
     * }
     * ```
     */
    updateSpan(handle, data = {}) {
        if (!this.#enabled || handle.id === 0) {
            return;
        }

        const span = this.#spans.find(s => s.id === handle.id);
        if (!span) {
            console.warn(`[DiagnosticsCollector] Span not found: ${handle.id} (${handle.name})`);
            return;
        }

        // Only allow updates to open spans
        if (span.status !== 'open') {
            console.warn(`[DiagnosticsCollector] Cannot update closed span: ${handle.id} (${handle.name})`);
            return;
        }

        // Merge data into attributes (for non-numeric) and metrics (for numeric)
        for (const [key, value] of Object.entries(data)) {
            if (typeof value === 'number') {
                span.metrics[key] = value;
            } else {
                span.attributes[key] = value;
            }
        }
    }

    /**
     * Aborts a span due to an error.
     *
     * Use this in a catch block before re-throwing or collecting the error.
     * The subsequent endSpan() in the finally block will be a no-op.
     *
     * @param {SpanHandle} handle - Handle from startSpan or startNestedSpan
     * @param {AbortData} data - Abort reason: { reason: string } or { timeout: number }
     *
     * @example
     * ```javascript
     * const span = diagnostics.startSpan('operation');
     * try {
     *     // ... work that may throw ...
     * } catch (error) {
     *     diagnostics.abortSpan(span, { reason: error.message });
     *     throw error;
     * } finally {
     *     diagnostics.endSpan(span); // No-op since abortSpan was called
     * }
     * ```
     */
    abortSpan(handle, data) {
        if (!this.#enabled || handle.id === 0) {
            return;
        }

        const span = this.#spans.find(s => s.id === handle.id);
        if (!span) {
            console.warn(`[DiagnosticsCollector] Span not found: ${handle.id} (${handle.name})`);
            return;
        }

        // Only allow aborting open spans
        if (span.status !== 'open') {
            console.warn(`[DiagnosticsCollector] Cannot abort closed span: ${handle.id} (${handle.name})`);
            return;
        }

        span.endTime = performance.now() - this.#startTime;
        span.status = 'aborted';
        span.abortData = data;

        // Only restore parent as current span if this span IS the current span.
        // This prevents concurrent/nested spans from interfering with each other.
        if (this.#currentSpanId === handle.id) {
            this.#currentSpanId = span.parentId;
        }
    }

    /**
     * Gets the currently active span ID.
     * @returns {number | null}
     */
    get currentSpanId() {
        return this.#currentSpanId;
    }

    // ========================================
    // Event Recording
    // ========================================

    /**
     * Records an instant event.
     *
     * @param {string} name - Event name (e.g., 'profile-loaded', 'cache-hit')
     * @param {Record<string, any>} [data={}] - Event data
     *
     * @example
     * ```javascript
     * diagnostics.recordEvent('cache-hit', {
     *     key: 'RGB:128,64,32',
     *     source: 'color-lookup',
     * });
     * ```
     */
    recordEvent(name, data = {}) {
        if (!this.#enabled) {
            return;
        }

        this.#events.push({
            timestamp: performance.now() - this.#startTime,
            name,
            data: { ...data },
            spanId: this.#currentSpanId,
        });
    }

    // ========================================
    // Counter Tracking
    // ========================================

    /**
     * Increments a named counter.
     *
     * @param {string} name - Counter name (e.g., 'hits', 'misses', 'pixels')
     * @param {number} [delta=1] - Amount to increment
     *
     * @example
     * ```javascript
     * diagnostics.incrementCounter('cache-hits');
     * diagnostics.incrementCounter('pixels', 2073600);
     * ```
     */
    incrementCounter(name, delta = 1) {
        if (!this.#enabled) {
            return;
        }

        this.#counters[name] = (this.#counters[name] || 0) + delta;
    }

    /**
     * Gets the current value of a counter.
     *
     * @param {string} name - Counter name
     * @returns {number} Counter value (0 if not set)
     */
    getCounter(name) {
        return this.#counters[name] || 0;
    }

    /**
     * Gets all counters.
     * @returns {Readonly<Record<string, number>>}
     */
    get counters() {
        return { ...this.#counters };
    }

    // ========================================
    // Merging (for Worker Coordination)
    // ========================================

    /**
     * Serializes the collector state for transfer to/from workers.
     *
     * @returns {SerializedDiagnostics}
     */
    serialize() {
        return {
            spans: this.#spans.map(s => ({ ...s })),
            events: this.#events.map(e => ({ ...e })),
            counters: { ...this.#counters },
            startTime: this.#startTime,
        };
    }

    /**
     * Merges serialized diagnostics from a worker.
     *
     * Worker spans are attached as children of the specified parent span.
     * Timestamps are adjusted relative to the main collector's start time.
     *
     * @param {SerializedDiagnostics} workerData - Serialized data from worker
     * @param {number | null} [parentSpanId=null] - Parent span to attach worker spans to
     */
    merge(workerData, parentSpanId = null) {
        if (!this.#enabled) {
            return;
        }

        const timeOffset = workerData.startTime - this.#startTime;

        // Remap span IDs to avoid collisions
        const idMap = new Map();
        for (const span of workerData.spans) {
            const newId = this.#nextSpanId++;
            idMap.set(span.id, newId);
        }

        // Merge spans with remapped IDs and adjusted timestamps
        for (const span of workerData.spans) {
            // Determine new root ID
            let newRootId;
            if (span.rootId === span.id) {
                // This was a root span in worker - remap to new ID
                newRootId = idMap.get(span.id);
            } else {
                // Use remapped root ID
                newRootId = idMap.get(span.rootId) ?? idMap.get(span.id);
            }

            const newSpan = {
                ...span,
                id: idMap.get(span.id),
                rootId: newRootId,
                startTime: span.startTime + timeOffset,
                endTime: span.endTime !== null ? span.endTime + timeOffset : null,
                status: span.status || 'completed', // Handle older serialized data
                abortData: span.abortData || null,
                parentId: span.parentId !== null ? idMap.get(span.parentId) : parentSpanId,
                children: span.children.map(childId => idMap.get(childId)),
            };
            this.#spans.push(newSpan);

            // Add root worker spans to parent's children
            if (span.parentId === null && parentSpanId !== null) {
                const parent = this.#spans.find(s => s.id === parentSpanId);
                if (parent) {
                    parent.children.push(newSpan.id);
                }
            }
        }

        // Merge events with adjusted timestamps
        for (const event of workerData.events) {
            this.#events.push({
                ...event,
                timestamp: event.timestamp + timeOffset,
                spanId: event.spanId !== null ? idMap.get(event.spanId) : null,
            });
        }

        // Merge counters
        for (const [name, value] of Object.entries(workerData.counters)) {
            this.#counters[name] = (this.#counters[name] || 0) + value;
        }
    }

    // ========================================
    // Output: JSON (Hatchet-Compatible)
    // ========================================

    /**
     * Converts to Hatchet-compatible JSON format for Performance Profile Viewer.
     *
     * @returns {DiagnosticsNode[]}
     *
     * @example
     * ```javascript
     * const json = diagnostics.toJSON();
     * await writeFile('profile.json', JSON.stringify(json, null, 2));
     * ```
     */
    toJSON() {
        // Find root spans (no parent)
        const rootSpans = this.#spans.filter(s => s.parentId === null);

        // Build tree recursively
        return rootSpans.map(span => this.#spanToNode(span));
    }

    /**
     * Converts a span to a Hatchet-compatible node.
     *
     * @param {Span} span
     * @returns {DiagnosticsNode}
     */
    #spanToNode(span) {
        const selfTime = this.#calculateSelfTime(span);
        const inclusiveTime = this.#calculateInclusiveTime(span);

        // Build attributes, including abort data if present
        const attributes = { ...span.attributes };
        if (span.abortData) {
            if ('reason' in span.abortData) {
                attributes.abortReason = span.abortData.reason;
            } else if ('timeout' in span.abortData) {
                attributes.abortTimeout = span.abortData.timeout;
            }
        }

        return {
            name: span.name,
            frame: [],
            metrics: {
                time: selfTime / 1000, // Convert ms to seconds
                'time (inc)': inclusiveTime / 1000,
                ...span.metrics,
            },
            attributes,
            status: /** @type {'completed' | 'aborted'} */ (span.status === 'open' ? 'completed' : span.status),
            children: span.children
                .map(childId => this.#spans.find(s => s.id === childId))
                .filter(child => child !== undefined)
                .map(child => this.#spanToNode(child)),
        };
    }

    /**
     * Calculates self time (exclusive of children).
     *
     * @param {Span} span
     * @returns {number} Self time in milliseconds
     */
    #calculateSelfTime(span) {
        if (span.endTime === null) {
            return 0;
        }

        const totalTime = span.endTime - span.startTime;
        let childrenTime = 0;

        for (const childId of span.children) {
            const child = this.#spans.find(s => s.id === childId);
            if (child && child.endTime !== null) {
                childrenTime += child.endTime - child.startTime;
            }
        }

        return Math.max(0, totalTime - childrenTime);
    }

    /**
     * Calculates inclusive time (self + children).
     *
     * @param {Span} span
     * @returns {number} Inclusive time in milliseconds
     */
    #calculateInclusiveTime(span) {
        if (span.endTime === null) {
            return 0;
        }
        return span.endTime - span.startTime;
    }

    // ========================================
    // Output: Human-Readable Text
    // ========================================

    /**
     * Converts to human-readable hierarchical text.
     *
     * @returns {string}
     *
     * @example
     * ```javascript
     * console.log(diagnostics.toText());
     * // Document Conversion (12,847ms)
     * // ├── Page 1 (4,231ms)
     * // │   ├── Images: 3 converted
     * // │   └── Content Streams: 2
     * // └── Cache Stats
     * //     └── Hits: 12,847 / Misses: 234
     * ```
     */
    toText() {
        const lines = [];
        const rootSpans = this.#spans.filter(s => s.parentId === null);

        for (const span of rootSpans) {
            this.#spanToText(span, lines, '', true);
        }

        // Add counter summary
        if (Object.keys(this.#counters).length > 0) {
            lines.push('');
            lines.push('Counters:');
            for (const [name, value] of Object.entries(this.#counters)) {
                lines.push(`  ${name}: ${this.#formatNumber(value)}`);
            }
        }

        return lines.join('\n');
    }

    /**
     * Recursively converts a span to text lines.
     *
     * @param {Span} span
     * @param {string[]} lines
     * @param {string} prefix
     * @param {boolean} isLast
     */
    #spanToText(span, lines, prefix, isLast) {
        const connector = isLast ? '└── ' : '├── ';
        const childPrefix = prefix + (isLast ? '    ' : '│   ');

        let duration;
        if (span.status === 'aborted') {
            const time = span.endTime !== null
                ? this.#formatDuration(span.endTime - span.startTime)
                : '?';
            const reason = span.abortData
                ? ('reason' in span.abortData ? span.abortData.reason : `timeout: ${span.abortData.timeout}ms`)
                : 'unknown';
            duration = ` (${time}, ABORTED: ${reason})`;
        } else if (span.endTime !== null) {
            duration = ` (${this.#formatDuration(span.endTime - span.startTime)})`;
        } else {
            duration = ' (in progress)';
        }

        // Format span name with key metrics
        let line = `${prefix}${connector}${span.name}${duration}`;

        // Add key metrics inline
        const inlineMetrics = [];
        for (const [key, value] of Object.entries(span.metrics)) {
            if (key !== 'time' && key !== 'time (inc)') {
                inlineMetrics.push(`${key}: ${this.#formatNumber(value)}`);
            }
        }
        if (inlineMetrics.length > 0) {
            line += ` [${inlineMetrics.join(', ')}]`;
        }

        lines.push(line);

        // Add attributes as sub-items if any
        const attrEntries = Object.entries(span.attributes);
        if (attrEntries.length > 0 && span.children.length === 0) {
            for (let i = 0; i < attrEntries.length; i++) {
                const [key, value] = attrEntries[i];
                const attrConnector = i === attrEntries.length - 1 ? '└── ' : '├── ';
                lines.push(`${childPrefix}${attrConnector}${key}: ${value}`);
            }
        }

        // Recursively add children
        const children = span.children
            .map(childId => this.#spans.find(s => s.id === childId))
            .filter(child => child !== undefined);

        for (let i = 0; i < children.length; i++) {
            this.#spanToText(children[i], lines, childPrefix, i === children.length - 1);
        }
    }

    // ========================================
    // Output: Flat Trace Log
    // ========================================

    /**
     * Converts to flat trace log format.
     *
     * @returns {string}
     *
     * @example
     * ```javascript
     * console.log(diagnostics.toTraceLog());
     * //      0.000ms  [START] document-conversion
     * //      0.012ms  [START] page-1
     * //    847.234ms  [END]   page-1 elapsed=847.222ms
     * ```
     */
    toTraceLog() {
        // Combine spans and events into a single timeline
        const entries = [];

        // Add span start/end/abort events
        for (const span of this.#spans) {
            entries.push({
                timestamp: span.startTime,
                type: 'START',
                name: span.name,
                data: span.attributes,
            });

            if (span.endTime !== null) {
                if (span.status === 'aborted') {
                    entries.push({
                        timestamp: span.endTime,
                        type: 'ABORT',
                        name: span.name,
                        data: {
                            elapsed: span.endTime - span.startTime,
                            ...(span.abortData || {}),
                            ...span.metrics,
                        },
                    });
                } else {
                    entries.push({
                        timestamp: span.endTime,
                        type: 'END',
                        name: span.name,
                        data: {
                            elapsed: span.endTime - span.startTime,
                            ...span.metrics,
                        },
                    });
                }
            }
        }

        // Add events
        for (const event of this.#events) {
            entries.push({
                timestamp: event.timestamp,
                type: 'EVENT',
                name: event.name,
                data: event.data,
            });
        }

        // Sort by timestamp
        entries.sort((a, b) => a.timestamp - b.timestamp);

        // Format as lines
        const lines = [];
        for (const entry of entries) {
            const timestamp = this.#formatTimestamp(entry.timestamp);
            const type = entry.type.padEnd(5);
            let line = `${timestamp}  [${type}] ${entry.name}`;

            // Add data inline
            const dataStr = Object.entries(entry.data)
                .map(([k, v]) => `${k}=${typeof v === 'number' ? this.#formatNumber(v) : v}`)
                .join(' ');
            if (dataStr) {
                line += ` ${dataStr}`;
            }

            lines.push(line);
        }

        return lines.join('\n');
    }

    // ========================================
    // Formatting Helpers
    // ========================================

    /**
     * Formats a timestamp in milliseconds.
     * @param {number} ms
     * @returns {string}
     */
    #formatTimestamp(ms) {
        return ms.toFixed(3).padStart(12) + 'ms';
    }

    /**
     * Formats a duration in milliseconds.
     * @param {number} ms
     * @returns {string}
     */
    #formatDuration(ms) {
        if (ms < 1) {
            return `${(ms * 1000).toFixed(0)}µs`;
        }
        if (ms < 1000) {
            return `${ms.toFixed(1)}ms`;
        }
        return `${(ms / 1000).toFixed(2)}s`;
    }

    /**
     * Formats a number with locale separators.
     * @param {number} n
     * @returns {string}
     */
    #formatNumber(n) {
        if (Number.isInteger(n)) {
            return n.toLocaleString();
        }
        return n.toLocaleString(undefined, { maximumFractionDigits: 3 });
    }

    // ========================================
    // Reset
    // ========================================

    /**
     * Resets the collector to initial state.
     */
    reset() {
        this.#spans = [];
        this.#events = [];
        this.#counters = {};
        this.#nextSpanId = 1;
        this.#currentSpanId = null;
        this.#startTime = performance.now();
    }
}

// ============================================================================
// No-Op Collector (for when diagnostics are disabled)
// ============================================================================

/**
 * Interface for no-op diagnostics (same methods as DiagnosticsCollector but does nothing).
 * @typedef {{
 *   enabled: false,
 *   currentSpanId: null,
 *   counters: Readonly<{}>,
 *   startSpan: () => { id: number, name: string },
 *   startNestedSpan: () => { id: number, name: string },
 *   endSpan: () => void,
 *   updateSpan: () => void,
 *   abortSpan: () => void,
 *   recordEvent: () => void,
 *   incrementCounter: () => void,
 *   getCounter: () => number,
 *   serialize: () => { spans: [], events: [], counters: {}, startTime: number },
 *   merge: () => void,
 *   toJSON: () => [],
 *   toText: () => string,
 *   toTraceLog: () => string,
 *   reset: () => void,
 * }} NoOpDiagnostics
 */

/**
 * A no-op collector that does nothing.
 * Use this when diagnostics are disabled to avoid null checks.
 *
 * @example
 * ```javascript
 * const diagnostics = options.diagnostics ?? NO_OP_DIAGNOSTICS;
 * const span = diagnostics.startSpan('operation'); // No-op if disabled
 * ```
 * @type {NoOpDiagnostics}
 */
export const NO_OP_DIAGNOSTICS = /** @type {NoOpDiagnostics} */ (Object.freeze({
    enabled: false,
    currentSpanId: null,
    counters: Object.freeze({}),
    startSpan: () => ({ id: 0, name: '' }),
    startNestedSpan: () => ({ id: 0, name: '' }),
    endSpan: () => {},
    updateSpan: () => {},
    abortSpan: () => {},
    recordEvent: () => {},
    incrementCounter: () => {},
    getCounter: () => 0,
    serialize: () => ({ spans: [], events: [], counters: {}, startTime: 0 }),
    merge: () => {},
    toJSON: () => [],
    toText: () => '',
    toTraceLog: () => '',
    reset: () => {},
}));
