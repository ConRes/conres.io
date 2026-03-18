# Diagnostics Layer Implementation Progress

**Date:** 2026-01-27
**Related:** `2026-01-27-REGRESSION-PROGRESS.md` (Phase 2 dependency)

---

## Coordination Rules

### Subagent Coordination

1. **Sequential execution only** - Never run parallel agents
2. **One task per agent** - Each agent handles a single, focused change
3. **Cross-review required** - After implementation, a separate agent verifies the work
4. **Progress updates** - Update this tracker after each completed task

---

## Objective

Introduce a clean, configurable diagnostics layer to profile and track:

- Distinct operations (count and type)
- Timing measurements (per-phase, per-operation)
- Execution order (call sequence)
- Options propagation across threads
- Aggregated heuristics for debugging, testing, and benchmarking

---

## Architecture Overview

### Two-Layer Design

```text
┌─────────────────────────────────────────────────────────────────┐
│  Layer 1: Instrumentation (DiagnosticsCollector)                │
│  - Always outputs JSON (Hatchet-compatible format)              │
│  - Injected via configuration                                   │
│  - Used by both refactored classes and legacy services          │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼ JSON file
┌─────────────────────────────────────────────────────────────────┐
│  Layer 2: Format Conversion (convert-diagnostics-profile.js)    │
│  - JSON → cpuprofile (V8 format for Flame Chart Visualizer)     │
│  - JSON → text (human-readable hierarchical)                    │
│  - JSON → compact text (for agents, avoids context overflow)    │
└─────────────────────────────────────────────────────────────────┘
```

### Benefits

- Core instrumentation stays simple (single JSON output)
- Format conversion is separate, testable, reusable
- Agents can get compact output without context overflow
- Users can convert to any format post-hoc
- Compatible with Performance Profile Viewer extension

---

## CLI Flags

### convert-pdf-color.js

| Flag                             | Behavior                                |
| -------------------------------- | --------------------------------------- |
| `--save-diagnostics <file.json>` | Save JSON diagnostics to file           |
| `--show-diagnostics`             | Display hierarchical summary to console |
| `--show-traces`                  | Display flat trace log to console       |

### convert-diagnostics-profile.js (NEW)

```bash
# Convert JSON to cpuprofile (for VS Code Flame Chart Visualizer)
node convert-diagnostics-profile.js input.json --output output.cpuprofile

# Convert JSON to human-readable text
node convert-diagnostics-profile.js input.json --output output.txt

# Compact text to stdout (for agents)
node convert-diagnostics-profile.js input.json --compact

# Pipe-friendly
node convert-diagnostics-profile.js input.json --compact | head -50
```

---

## JSON Format (Hatchet-Compatible)

Based on [Performance Profile Viewer](https://github.com/Dando18/performance-profile-viewer-vscode) format.

### Root Structure

```typescript
type DiagnosticsProfile = DiagnosticsNode[];
```

### Node Structure

```typescript
interface DiagnosticsNode {
    name: string;                    // Operation name
    frame: string[];                 // Stack frame info (optional)
    metrics: {
        time: number;                // Self time in seconds
        "time (inc)": number;        // Inclusive time (self + children)
        [key: string]: number;       // Additional metrics (pixels, ops, etc.)
    };
    attributes: {
        file?: string;               // Source file
        line?: number;               // Line number
        ref?: string;                // PDF reference (e.g., "Im0", "12 0 R")
        colorSpace?: string;         // Color space type
        [key: string]: any;          // Additional attributes
    };
    children: DiagnosticsNode[];     // Child operations
}
```

### Example Output

```json
[
  {
    "name": "document-conversion",
    "frame": [],
    "metrics": {
      "time": 0.234,
      "time (inc)": 12.847,
      "pages": 5,
      "images": 12,
      "streams": 10
    },
    "attributes": {
      "file": "test.pdf",
      "renderingIntent": "relative-colorimetric",
      "blackPointCompensation": true
    },
    "children": [
      {
        "name": "page-1",
        "frame": [],
        "metrics": {
          "time": 0.045,
          "time (inc)": 4.231,
          "images": 3,
          "streams": 2
        },
        "attributes": { "pageIndex": 0 },
        "children": []
      }
    ]
  }
]
```

### VS Code Integration

- [Performance Profile Viewer](https://github.com/Dando18/performance-profile-viewer-vscode) - Direct JSON support
- [Flame Chart Visualizer](https://marketplace.visualstudio.com/items?itemName=ms-vscode.vscode-js-profile-flame) - Via cpuprofile conversion

---

## Full Instrumentation Scope

Must instrument:
- **Refactored classes**: All `*ColorConverter` classes
- **Legacy services**: `PDFService.js`, `ColorSpaceUtils.js`, `ColorEngineService.js`
- **Shared resources**: `BufferRegistry`, `ProfilePool`, `WorkerPool`

Rationale: Compare legacy vs refactored implementations with equivalent diagnostics.

---

## `.cpuprofile` Format Specification

### Root Structure

```typescript
interface CPUProfile {
    nodes: ProfileNode[];      // Call tree nodes, root is nodes[0]
    startTime: number;         // Microseconds since epoch
    endTime: number;           // Microseconds since epoch
    samples: number[];         // Node IDs at each sample tick
    timeDeltas: number[];      // Microseconds between samples
}
```

### ProfileNode Structure

```typescript
interface ProfileNode {
    id: number;                // Unique node identifier
    callFrame: CallFrame;      // Source location info
    children?: number[];       // Child node IDs
    hitCount?: number;         // Optional: times this node was sampled
}
```

### CallFrame Structure

```typescript
interface CallFrame {
    functionName: string;      // Function/operation name
    scriptId: string;          // "0" for synthetic frames
    url: string;               // File path or empty
    lineNumber: number;        // -1 for synthetic
    columnNumber: number;      // -1 for synthetic
}
```

### Synthetic Frames for PDF Conversion

```text
(root)
├── (document-conversion)
│   ├── (page-1)
│   │   ├── (image-conversion) - Im0
│   │   ├── (image-conversion) - Im1
│   │   └── (content-stream-conversion)
│   │       ├── (color-lookup) - RGB
│   │       └── (color-lookup) - Gray
│   └── (page-2)
│       └── ...
└── (worker-task) - task-1
    └── (image-transform)
```

### References

- [Chrome DevTools Protocol - Profiler.Profile](https://chromedevtools.github.io/devtools-protocol/tot/Profiler#type-Profile)
- [Understanding CPU Profile Data Structure](https://push-based.io/article/advanced-cpu-profiling-in-node-profile-data-structure)

---

## Collector Architecture

### Injected via Configuration

```javascript
// Create collector
const diagnostics = new DiagnosticsCollector();

// Pass to converter
const converter = new PDFDocumentColorConverter({
    // ... existing config
    diagnostics,  // Optional - no-op if not provided
});

// After conversion, get results
const json = diagnostics.toJSON();
await writeFile('output.json', JSON.stringify(json, null, 2));
```

### DiagnosticsCollector API

```javascript
class DiagnosticsCollector {
    // Span tracking (hierarchical timing)
    startSpan(name, attributes = {});   // Returns span handle
    endSpan(handle, metrics = {});      // Close span, record metrics

    // Event recording (flat trace)
    recordEvent(name, data = {});       // Instant event

    // Counter tracking
    incrementCounter(name, delta = 1);  // Increment counter

    // Output (Hatchet-compatible JSON)
    toJSON();                           // Full profile
    toText();                           // Human-readable summary
    toTraceLog();                       // Flat event log
}
```

### Span Handle Pattern

```javascript
const docSpan = diagnostics.startSpan('document-conversion', {
    file: 'test.pdf',
    renderingIntent: 'relative-colorimetric',
});

for (const page of pages) {
    const pageSpan = diagnostics.startSpan('page', { pageIndex });
    // ... process page ...
    diagnostics.endSpan(pageSpan, { images: 3, streams: 2 });
}

diagnostics.endSpan(docSpan, { pages: 5 });
```

### Dual Output Modes

#### Hierarchical Mode (`--show-diagnostics`)

```text
Document Conversion (12,847ms)
├── Page 1 (4,231ms)
│   ├── Images: 3 converted (2,104ms)
│   │   ├── Im0: RGB 1920×1080 (847ms)
│   │   ├── Im1: Gray 640×480 (312ms)
│   │   └── Im2: Lab 800×600 (945ms)
│   └── Content Streams: 2 (1,892ms)
│       ├── Stream 0: 847 ops (1,203ms)
│       └── Stream 1: 234 ops (689ms)
├── Page 2 (3,456ms)
│   └── ...
└── Cache Stats
    ├── Color Lookup: 12,847 hits / 234 misses (98.2%)
    └── LUT: 4,231 hits / 89 misses
```

#### Flat Mode (`--show-traces`)

```text
     0.000ms  [START] document-conversion
     0.012ms  [START] page-1
     0.034ms  [START] image-conversion ref=Im0 colorSpace=RGB
     0.035ms  [EVENT] profile-loaded source=sRGB
   847.234ms  [END]   image-conversion pixels=2073600 elapsed=847.200ms
   847.256ms  [START] image-conversion ref=Im1 colorSpace=Gray
  1159.478ms  [END]   image-conversion pixels=307200 elapsed=312.222ms
  ...
```

### Thread Coordination (Revised Architecture)

**"One Cook" Model**: Main thread owns all diagnostics data; workers contribute via MessageChannel.

```text
Main Thread:                           Worker Thread:
┌──────────────────────────┐          ┌──────────────────────────┐
│ MainDiagnosticsCollector │          │ AuxiliaryDiagnosticsCollector │
│ ├── spans[]              │          │ ├── localSpans[]         │
│ ├── events[]             │◄─────────│ ├── localEvents[]        │
│ ├── counters{}           │ Message  │ └── localCounters{}      │
│ └── auxChannels[]        │ Channel  │                          │
└──────────────────────────┘          └──────────────────────────┘
         │                                      │
         └──────────────────┬──────────────────┘
                            ▼
                  DiagnosticsCollector (base)
                  ├── startSpan()
                  ├── endSpan()
                  ├── recordEvent()
                  └── incrementCounter()
```

**Class Hierarchy:**

```javascript
DiagnosticsCollector          // Base class (existing)
├── MainDiagnosticsCollector  // Main thread: owns data, receives from auxiliaries
└── AuxiliaryDiagnosticsCollector  // Worker thread: sends via MessageChannel
```

**MessageChannel Protocol:**

```typescript
// Worker → Main messages
type DiagnosticsMessage =
    | { type: 'span-start', id: number, name: string, attributes: object, timestamp: number }
    | { type: 'span-end', id: number, metrics: object, timestamp: number }
    | { type: 'event', name: string, data: object, timestamp: number }
    | { type: 'counter', name: string, delta: number };
```

Workers send diagnostics messages immediately via MessageChannel.
Main thread receives and integrates into the single diagnostics tree.

---

## Comparable Heuristics (Legacy vs Refactored)

Span hierarchy with common denominators for pipeline comparison:

```text
document-conversion                          # L0: Root (✅ comparable)
├── metrics: pages, total-time
│
├── page                                     # L1: Per-page (✅ comparable)
│   ├── metrics: images, streams, page-time
│   │
│   ├── image-batch                          # L2: Image group (✅ comparable)
│   │   ├── metrics: count, batch-time
│   │   │
│   │   └── image-conversion                 # L3: Per-image (✅ comparable)
│   │       ├── metrics: pixels, image-time
│   │       │
│   │       ├── decode                       # L4: Detail (refactored only)
│   │       ├── wasm-transform               # L4: WASM call (✅ both)
│   │       └── encode                       # L4: Detail (refactored only)
│   │
│   └── stream-batch                         # L2: Stream group (✅ comparable)
│       ├── metrics: count, batch-time
│       │
│       └── content-stream                   # L3: Per-stream (✅ comparable)
│           ├── metrics: ops, colors, stream-time
│           │
│           ├── parse                        # L4: Detail (refactored only)
│           ├── color-lookup                 # L4: Conversion (✅ both)
│           └── rebuild                      # L4: Detail (refactored only)
│
└── worker-tasks                             # L1: Worker coordination (✅ comparable)
    ├── metrics: tasks-dispatched, tasks-completed
    └── worker-task                          # L2: Per-task (✅ comparable)
        └── metrics: task-time, queue-wait
```

| Level | Span Name | Comparable | Key Metrics | Notes |
|-------|-----------|------------|-------------|-------|
| L0 | `document-conversion` | ✅ Both | pages, total-time | Root span |
| L1 | `page` | ✅ Both | images, streams, page-time | Per-page grouping |
| L2 | `image-batch` | ✅ Both | count, batch-time | All images on page |
| L3 | `image-conversion` | ✅ Both | pixels, image-time | Per-image total |
| L4 | `wasm-transform` | ✅ Both | pixels, transform-time | WASM color engine call |
| L4 | `decode`/`encode` | ⚠️ Refactored | bytes, time | FlateDecode operations |
| L2 | `stream-batch` | ✅ Both | count, batch-time | All streams on page |
| L3 | `content-stream` | ✅ Both | ops, colors, stream-time | Per-stream total |
| L4 | `color-lookup` | ✅ Both | unique-colors, lookup-time | Color conversion calls |
| L4 | `parse`/`rebuild` | ⚠️ Refactored | ops, time | Stream text processing |
| L1 | `worker-tasks` | ✅ Both | dispatched, completed | Worker coordination |
| L2 | `worker-task` | ✅ Both | task-time, queue-wait | Per-task timing |

**Legend:** ✅ Both = Comparable | ⚠️ Refactored = Nested detail (under comparable parent)

---

## Instrumentation Points (Full Scope)

### Refactored Classes

| Class                            | Spans                                    | Counters                  |
| -------------------------------- | ---------------------------------------- | ------------------------- |
| `PDFDocumentColorConverter`      | document-conversion, page                | pages, images, streams    |
| `PDFPageColorConverter`          | image-batch, stream-batch                | images, streams           |
| `PDFImageColorConverter`         | image-conversion, decode, wasm-transform, encode | pixels             |
| `PDFContentStreamColorConverter` | content-stream, parse, color-lookup, rebuild | ops, colors          |
| `BufferRegistry`                 | color-batch-convert                      | cache-hits, cache-misses  |
| `LookupTableColorConverter`      | build-lookup-table                       | lookups                   |
| `CompositeColorConverter`        | worker-tasks                             | tasks-dispatched          |

### Legacy Services (Must Match Comparable Spans)

| Service                                    | Spans                                      | Counters       |
| ------------------------------------------ | ------------------------------------------ | -------------- |
| `PDFService.convertColorInPDFDocument`     | document-conversion, page, image-batch, stream-batch | pages, images, streams |
| `PDFService` (image conversion)            | image-conversion, wasm-transform           | pixels         |
| `PDFService` (content stream conversion)   | content-stream, color-lookup               | ops, colors    |

### Worker Thread (Both Pipelines)

| Location                | Spans                                      | Counters       |
| ----------------------- | ------------------------------------------ | -------------- |
| `StreamTransformWorker` | worker-task, wasm-transform                | pixels         |
| `WorkerPool`            | worker-tasks                               | dispatched, completed |

---

## Roadmap

### Phase 1: Core Infrastructure ✅

- [x] **D1** Create `DiagnosticsCollector` class with span/event/counter API
- [x] **D2** Implement `.toJSON()` (Hatchet-compatible format)
- [x] **D3** Implement `.toText()` (human-readable hierarchical)
- [x] **D4** Implement `.toTraceLog()` (flat event log)
- [x] **D5** Add `diagnostics` option to `ColorConverterConfiguration`

### Phase 2: Format Converter CLI ✅

- [x] **D6** Create `convert-diagnostics-profile.js` CLI structure
- [x] **D7** Implement JSON → cpuprofile conversion
- [x] **D8** Implement JSON → text conversion
- [x] **D9** Implement `--compact` mode for agents

### Phase 3: Refactored Class Instrumentation ✅

- [x] **D10** Instrument `PDFDocumentColorConverter`
- [x] **D11** Instrument `PDFPageColorConverter`
- [x] **D12** Instrument `PDFImageColorConverter`
- [x] **D13** Instrument `PDFContentStreamColorConverter`
- [x] **D14** Instrument `BufferRegistry`
- [x] **D15** Instrument `LookupTableColorConverter`

### Phase 4: Collector Specialization (NEW) ✅

- [x] **D29** Create `MainDiagnosticsCollector` extending `DiagnosticsCollector`
  - Receives spans/events/counters from auxiliary collectors via MessageChannel
  - Manages auxiliary channel registration
  - Integrates worker data into main span tree
- [x] **D30** Create `AuxiliaryDiagnosticsCollector` extending `DiagnosticsCollector`
  - Sends spans/events/counters to main collector via MessageChannel
  - Auto-prefixes span IDs to avoid collisions
  - Handles worker context detection

### Phase 5: Worker Coordination (REVISED)

- [x] **D31** Update `WorkerPool` to pass MessageChannel port to workers
- [x] **D32** Update `StreamTransformWorker` to use `AuxiliaryDiagnosticsCollector`
  - Add `worker-task` span around task processing
  - Add `wasm-transform` span around color engine calls
- [x] **D33** Update `CompositeColorConverter` to use `MainDiagnosticsCollector`
  - Add `worker-tasks` span for worker coordination
  - Register auxiliary channels from WorkerPool

### Phase 6: Legacy Service Instrumentation (REVISED) ✅

- [x] **D34** Add `diagnostics` option to `PDFService.convertColorInPDFDocument`
- [x] **D35** Instrument legacy pipeline with comparable spans:
  - `document-conversion` (root)
  - `page` (per page)
  - `image-batch` and `image-conversion` with `wasm-transform`
  - `stream-batch` and `content-stream` with `color-lookup`
- [x] **D36** Add CLI flags to legacy `convert-pdf-color.js`
  - `--show-diagnostics`, `--show-traces`, `--save-diagnostics`

### Phase 7: CLI Integration ✅

- [x] **D22** Add CLI flags to `convert-pdf-color.js` (refactored)
- [x] **D23** Add CLI flags to legacy `convert-pdf-color.js` → Moved to D36
- [x] **D37** Add `--using-diagnostics` to `generate-verification-matrix.mjs`
  - Save `.diagnostics.json` alongside each PDF
  - Pass diagnostics flag to both legacy and refactored CLIs

### Phase 8: Testing & Validation (REVISED)

- [x] **D25** Unit tests for DiagnosticsCollector
- [x] **D26** Unit tests for convert-diagnostics-profile.js
- [x] **D38** Unit tests for MainDiagnosticsCollector and AuxiliaryDiagnosticsCollector (43 tests)
- [x] **D39** Integration test: comparable spans between legacy and refactored (`verify-comparable-diagnostics.mjs`)
- [x] **D28** Update CLAUDE.md with diagnostics documentation
- [x] **D40** Update progress document with completion status

---

## File Structure

```text
testing/iso/ptf/2025/
├── classes/
│   ├── diagnostics-collector.js           # Base collector class (D1-D5)
│   ├── main-diagnostics-collector.js      # Main thread collector (D29)
│   └── auxiliary-diagnostics-collector.js # Worker thread collector (D30)
├── services/
│   ├── PDFService.js                      # Legacy service with diagnostics (D34-D35)
│   ├── WorkerPool.js                      # Worker management with diagnostics (D31)
│   └── StreamTransformWorker.js           # Worker with diagnostics (D32)
├── tests/
│   ├── DiagnosticsCollector.test.js       # Base collector tests (D25)
│   ├── ConvertDiagnosticsProfile.test.js  # Format converter tests (D26)
│   └── MainAuxiliaryDiagnostics.test.js   # Main/Auxiliary tests (D38)
└── experiments/
    ├── convert-pdf-color.js               # Refactored CLI with diagnostics (D22)
    ├── convert-diagnostics-profile.js     # Format converter CLI (D6-D9)
    ├── scripts/
    │   ├── generate-verification-matrix.mjs # Matrix CLI with --using-diagnostics (D37)
    │   └── verify-comparable-diagnostics.mjs # Integration test script (D39)
    └── legacy/
        └── convert-pdf-color.js           # Legacy CLI with diagnostics (D36)
```

---

## Current Status

**Phase:** 8 (Testing & Validation) - COMPLETE
**Current Task:** None - All tasks complete
**Last Updated:** 2026-01-27

### Summary

- **Phase 1-3:** ✅ Complete - Core infrastructure and refactored class instrumentation
- **Phase 4:** ✅ Complete - Collector specialization (Main/Auxiliary architecture)
- **Phase 5:** ✅ Complete - Worker coordination with MessageChannel
- **Phase 6:** ✅ Complete - Legacy service instrumentation (comparable spans)
- **Phase 7:** ✅ Complete - CLI integration (all CLIs have diagnostics flags)
- **Phase 8:** ✅ Complete - Testing and validation (95 tests total)

### Execution Order

1. **D29-D30** - ✅ Collector specialization (base architecture)
2. **D31-D33** - ✅ Worker coordination (both pipelines use this)
3. **D34-D36** - ✅ Legacy service instrumentation
4. **D37** - ✅ Matrix integration (`--using-diagnostics`)
5. **D38-D40** - ✅ Testing and validation

---

## Activity Log

### 2026-01-27

**Phase 1 Complete:**

- [x] **D1-D4** Created `DiagnosticsCollector` class with full API:
  - Span tracking (hierarchical timing with parent-child relationships)
  - Event recording (instant events with timestamps)
  - Counter tracking (aggregated metrics)
  - `.toJSON()` - Hatchet-compatible format
  - `.toText()` - Human-readable hierarchical tree
  - `.toTraceLog()` - Flat chronological event log
  - Worker serialization and merging support
  - `NO_OP_DIAGNOSTICS` singleton for disabled state
- [x] **D5** Added `diagnostics` option to `ColorConverterConfiguration`
  - Added `diagnostics` getter to `ColorConverter` base class
  - Returns `NO_OP_DIAGNOSTICS` fallback when not configured
- [x] **D25** Created unit tests (25 tests, all passing)

**Discovery:**

- **Discovery complete** - Reviewed convert-pdf-color.js, compare-pdf-color.js, generate-verification-matrix.mjs
- **Class hierarchy mapped** - ColorConverter → CompositeColorConverter → PDFDocumentColorConverter/PDFPageColorConverter
- **Options flow documented** - CLI → Document → Page → Image/Stream
- **Instrumentation points identified** - Full scope including legacy services
- **User requirements confirmed**:
  - Injected collector via configuration
  - Hierarchical (`--show-diagnostics`) + flat (`--show-traces`) modes
  - Full instrumentation including legacy for comparison
- **cpuprofile format researched** - V8/Chrome format documented with synthetic frame design
- **Hatchet JSON format researched** - Performance Profile Viewer compatible format
- **VS Code extensions identified**:
  - [Flame Chart Visualizer](https://marketplace.visualstudio.com/items?itemName=ms-vscode.vscode-js-profile-flame) - cpuprofile
  - [Performance Profile Viewer](https://github.com/Dando18/performance-profile-viewer-vscode) - Hatchet JSON
- **Architecture revised** - Two-layer design:
  - Layer 1: DiagnosticsCollector always outputs Hatchet-compatible JSON
  - Layer 2: Separate `convert-diagnostics-profile.js` CLI for format conversion
  - Benefits: Simpler core, reusable converter, agent-friendly compact output
- **Progress document updated** with final architecture

**Phase 2 Complete (D6-D9):**

- Created `convert-diagnostics-profile.js` CLI with full format support:
  - JSON → cpuprofile (V8 format for Flame Chart Visualizer)
  - JSON → text (human-readable hierarchical)
  - `--compact` mode for agents
  - `--summary` mode for aggregated statistics

**Phase 3 Complete (D10-D15):**

- Instrumented `PDFDocumentColorConverter` - document and page spans
- Instrumented `PDFPageColorConverter` - image-batch, stream-batch spans
- Instrumented `PDFImageColorConverter` - decode, transform, encode spans
- Instrumented `PDFContentStreamColorConverter` - parse, convert, rebuild spans
- Instrumented `BufferRegistry` - cache hit/miss counters, batch-convert span
- Instrumented `LookupTableColorConverter` - build-lookup-table span

**Phase 6 Complete (D22):**

- Added CLI flags to `convert-pdf-color.js`:
  - `--show-diagnostics` - Display hierarchical summary
  - `--show-traces` - Display flat event log
  - `--save-diagnostics=<file.json>` - Save JSON to file

**Phase 7 Complete (D25-D26, D28):**

- 25 unit tests for DiagnosticsCollector (all passing)
- 27 unit tests for convert-diagnostics-profile.js (all passing)
- CLAUDE.md updated with diagnostics documentation

**Phase 4-5 Complete (D29-D33):**

- Created `MainDiagnosticsCollector` for main thread with MessageChannel support
- Created `AuxiliaryDiagnosticsCollector` for worker threads
- Updated `WorkerPool` with `diagnosticsEnabled` option and `getDiagnosticsPorts()`
- Updated `StreamTransformWorker` with `worker-task` and `wasm-transform` spans
- Updated `CompositeColorConverter` to register/unregister worker diagnostics

**Phase 6 Complete (D34-D36):**

- Added `diagnostics` option to `PDFService.convertColorInPDFDocument`
- Instrumented legacy pipeline with comparable spans:
  - `document-conversion` (root)
  - `page` (per page in Phase 2)
  - `image-batch` with `imagesConverted`/`imagesSkipped` metrics
  - `stream-batch` with `colorsConverted` metric
- Added CLI flags to legacy `convert-pdf-color.js`:
  - `--show-diagnostics`, `--show-traces`, `--save-diagnostics=<path>`

**Phase 7 Complete (D37):**

- Added `--using-diagnostics` flag to `generate-verification-matrix.mjs`
- Saves `.diagnostics.json` files alongside each PDF
- Added diagnostics status to console output, JSON summary, and markdown summary

**Phase 8 Complete (D38):**

- Created `MainAuxiliaryDiagnostics.test.js` with 43 unit tests:
  - MainDiagnosticsCollector: inheritance, channel management, message handling, ID remapping, cleanup
  - AuxiliaryDiagnosticsCollector: span/event/counter messages, local state tracking, lifecycle
  - Main + Auxiliary Integration: cross-thread communication, counter merging, nested spans

**Phase 8 Complete (D39):**

- Created `verify-comparable-diagnostics.mjs` integration test script:
  - Runs both legacy and refactored conversions with diagnostics
  - Analyzes span names at each level (L0-L4)
  - Compares coverage of comparable spans between pipelines
  - Outputs detailed comparison table showing PASS/DIFF/N/A status
  - Supports `--verbose` flag for full span listing

**Phase 8 Complete (D40):**

- All tasks D1-D40 complete
- Total test coverage: 95 tests (25 DiagnosticsCollector + 27 ConvertDiagnosticsProfile + 43 MainAuxiliaryDiagnostics)
- Diagnostics layer fully integrated into both legacy and refactored pipelines

**Revision Phase Complete (R1-R16):**

- **R1-R6** - Core API changes to DiagnosticsCollector:
  - Added `updateSpan(handle, data)` method for intermediate metrics/attributes
  - Added `abortSpan(handle, { reason } | { timeout })` method with status tracking
  - Added span status field: 'open' → 'completed' | 'aborted'
  - Updated `toJSON()`, `toText()`, `toTraceLog()` for status and abortData
  - Added graceful cleanup timeout to MainDiagnosticsCollector
  - Added updateSpan/abortSpan message forwarding in AuxiliaryDiagnosticsCollector

- **R7** - CLI updates:
  - `convert-pdf-color.js`: Uses `MainDiagnosticsCollector` when workers enabled, `DiagnosticsCollector` otherwise

- **R8-R13** - Fixed span patterns in refactored classes (6 files):
  - `pdf-document-color-converter.js`: `document-conversion`, `page` spans with try/finally
  - `pdf-page-color-converter.js`: `image-batch`, `image-conversion`, `stream-batch`, `content-stream` spans with try/finally
  - `pdf-image-color-converter.js`: `decode`, `normalize-bpc`, `transform`, `encode` spans with try/finally
  - `pdf-content-stream-color-converter.js`: `parse`, `convert`, `rebuild` spans with try/finally
  - `buffer-registry.js`: `color-batch-convert` span with try/finally
  - `lookup-table-color-converter.js`: `build-lookup-table` span with try/finally

- **R14-R15** - Fixed span patterns in legacy service (2 files):
  - `PDFService.js`: `document-conversion`, `page`, `stream-batch`, `image-batch` spans with try/finally
  - `StreamTransformWorker.js`: `worker-task`, `wasm-transform`, `color-lookup` spans with try/finally

- **R16** - Added 15 new tests for updateSpan, abortSpan, and span status
- All 83 tests pass (40 DiagnosticsCollector + 43 MainAuxiliaryDiagnostics)
