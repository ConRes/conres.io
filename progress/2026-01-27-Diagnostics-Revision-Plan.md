# Diagnostics Revision Plan

**Date:** 2026-01-27
**Related:** `2026-01-27-DIAGNOSTICS-PROGRESS.md`

---

## Overview

Revise the diagnostics layer to:
1. Separate span lifecycle from custom attributes
2. Add `updateSpan()` and `abortSpan()` methods
3. Enforce proper try/finally pattern for all spans
4. Use `MainDiagnosticsCollector` in CLIs when workers are enabled
5. Add graceful cleanup timeout for lingering spans

---

## Span Data Structure

### Hatchet-Compatible Format (Output)

```typescript
interface DiagnosticsNode {
    name: string;                    // Operation name
    frame: string[];                 // Stack frame info
    metrics: {
        time: number;                // Self time in seconds
        "time (inc)": number;        // Inclusive time in seconds
        [key: string]: number;       // Custom numeric metrics
    };
    attributes: {                    // Custom attributes (user-provided)
        [key: string]: any;
    };
    status: 'completed' | 'aborted' | 'incomplete';  // Lifecycle status
    children: DiagnosticsNode[];
}
```

### Internal Span Record

```typescript
interface SpanRecord {
    id: number;
    name: string;
    parentId: number | null;
    rootId: number;                  // ID of the root span this belongs to
    startTime: number;               // ms since collector start
    endTime: number | null;          // ms since collector start (null if open)
    status: 'open' | 'completed' | 'aborted';
    abortData: { reason: string } | { timeout: number } | null;  // Set by abortSpan()
    attributes: Record<string, any>; // Custom attributes (nested, separate from lifecycle)
    metrics: Record<string, number>; // Custom numeric metrics
    children: number[];              // Child span IDs
}
```

### Root Span Timeout Behavior

- When a root span (`parentId === null`) ends, start timeout for its open descendants
- Timeout = `gracefulCleanupTimeout * pendingDescendantCount`
- If all descendants end/abort before timeout, cancel timer
- After timeout, remaining open descendants are aborted: `abortSpan(span, { timeout: <ms since root ended> })`
- A new root span (after previous root ended) starts a fresh tree with its own timeout tracking

---

## API Changes

### DiagnosticsCollector

```javascript
class DiagnosticsCollector {
    // Existing
    startSpan(name, attributes = {});   // Returns SpanHandle
    endSpan(handle, metrics = {});      // Closes span with 'completed' status

    // New
    updateSpan(handle, data = {});      // Adds attributes/metrics to open span
    abortSpan(handle, { reason });      // Closes span with 'aborted' status

    // Behavior changes:
    // - endSpan() is no-op if span already closed (aborted or completed)
    // - abortSpan() records reason, sets status to 'aborted'
    // - Span status flows to output: completed, aborted, or incomplete
}
```

### MainDiagnosticsCollector

```javascript
class MainDiagnosticsCollector extends DiagnosticsCollector {
    constructor(options = {}) {
        super(options);
        // New option:
        this.gracefulCleanupTimeout = options.gracefulCleanupTimeout ?? 1000; // ms
    }

    // When the top-most span ends:
    // 1. Check for pending (open) spans
    // 2. If pending spans exist, start timeout = baseTimeout * pendingCount
    // 3. If all pending spans end before timeout, cancel timeout
    // 4. After timeout, mark remaining open spans as 'incomplete'
}
```

---

## Usage Pattern

### Standard Pattern (No Error Collection)

```javascript
const span = diagnostics.startSpan('operation', { ref: 'Im0' });
try {
    // ... work ...
    diagnostics.updateSpan(span, { pixels: 1000 });
} finally {
    diagnostics.endSpan(span, { outputBytes: result.length });
}
```

### Pattern with Error Collection (Errors Don't Propagate)

```javascript
const span = diagnostics.startSpan('image-conversion', { ref: imageRef });
try {
    // ... work ...
    diagnostics.updateSpan(span, { indexed: true });
} catch (error) {
    diagnostics.abortSpan(span, { reason: error.message });
    errors.push(`Image ${imageRef}: ${error.message}`);
} finally {
    diagnostics.endSpan(span); // No-op if abortSpan was called
}
```

### Pattern with Error Propagation

```javascript
const span = diagnostics.startSpan('critical-operation');
try {
    // ... work that may throw ...
} catch (error) {
    diagnostics.abortSpan(span, { reason: error.message });
    throw error; // Re-throw after recording abort
} finally {
    diagnostics.endSpan(span); // No-op if abortSpan was called
}
```

---

## Files to Update

### Phase 1: Core API Changes

| File | Changes |
|------|---------|
| `diagnostics-collector.js` | Add `updateSpan()`, `abortSpan()`, span status tracking |
| `main-diagnostics-collector.js` | Add graceful cleanup timeout logic |
| `auxiliary-diagnostics-collector.js` | Add `updateSpan()`, `abortSpan()` message forwarding |

### Phase 2: CLI Updates

| File | Changes |
|------|---------|
| `convert-pdf-color.js` | Use `MainDiagnosticsCollector` when workers enabled |
| `legacy/convert-pdf-color.js` | Use `MainDiagnosticsCollector` when workers enabled |

### Phase 3: Span Pattern Fixes (Refactored Classes)

| File | Spans to Fix |
|------|--------------|
| `pdf-document-color-converter.js` | `document-conversion`, `page` |
| `pdf-page-color-converter.js` | `image-batch`, `image-conversion`, `stream-batch`, `content-stream` |
| `pdf-image-color-converter.js` | `decode`, `normalize-bpc`, `transform`, `encode` |
| `pdf-content-stream-color-converter.js` | `parse`, `convert`, `rebuild` |
| `buffer-registry.js` | `color-batch-convert` |
| `lookup-table-color-converter.js` | `build-lookup-table` |

### Phase 4: Span Pattern Fixes (Legacy Service)

| File | Spans to Fix |
|------|--------------|
| `PDFService.js` | `document-conversion`, `page`, `stream-batch`, `image-batch` |
| `StreamTransformWorker.js` | `worker-task`, `wasm-transform`, `color-lookup` |

### Phase 5: Test Updates

| File | Changes |
|------|---------|
| `DiagnosticsCollector.test.js` | Add tests for `updateSpan()`, `abortSpan()`, status |
| `MainAuxiliaryDiagnostics.test.js` | Add tests for graceful cleanup timeout |

---

## Execution Order

1. ✅ **R1** - Add `updateSpan()` to DiagnosticsCollector
2. ✅ **R2** - Add `abortSpan()` to DiagnosticsCollector
3. ✅ **R3** - Add span status tracking (`completed`, `aborted`, `incomplete`)
4. ✅ **R4** - Update `toJSON()` to include status field
5. ✅ **R5** - Add graceful cleanup timeout to MainDiagnosticsCollector
6. ✅ **R6** - Add `updateSpan()`, `abortSpan()` to AuxiliaryDiagnosticsCollector
7. ✅ **R7** - Update CLIs to use MainDiagnosticsCollector when workers enabled
8. ✅ **R8-R13** - Fix span patterns in refactored classes (6 files)
9. ✅ **R14-R15** - Fix span patterns in legacy service (2 files)
10. ✅ **R16** - Update unit tests (40 tests total: 25 original + 15 new for updateSpan/abortSpan/status)

---

## Questions Resolved

1. **Natural unwinding** - try/finally pattern handles nested spans naturally
2. **updateSpan vs multiple endSpan** - Use `updateSpan()` for intermediate data, one `endSpan()` in finally
3. **Error handling** - Use `abortSpan()` in catch, `endSpan()` in finally (no-op if aborted)
4. **Lingering spans** - Marked with `status: 'incomplete'` after graceful timeout
5. **Data separation** - Lifecycle fields separate from custom attributes
