# Content Stream Markup Parser Refactor

**Last Updated:** 2026-04-07
**Status:** In Progress
**Branch:** `test-form-generator/2026/dev`
**Prerequisite for:** `2026-04-05-DEVICE-COLOR-HANDLING-PROGRESS.md` (must complete before Task 2)

---

## Background

### Why Markup Parsing

The test form PDFs contain content streams that can exceed 200 MB (the Interlaken Color Map content streams are among the largest). Previous implementations caused OOM crashes on Safari/iOS and Firefox due to how JavaScript engines handle large strings:

- **V8 (Chrome):** `SlicedString` retention — `slice()`/`substring()` returns a pointer to the parent string, not a copy. A small token extracted from a 500 MB string retains the entire 500 MB in the heap. `ConsString` depth from concatenation creates binary trees that exhaust the stack.
- **JavaScriptCore (Safari/iOS):** Requires contiguous memory allocation to flatten/transform strings. In fragmented heaps, OOM occurs even when total free memory exceeds the string size. Mobile Safari has per-tab caps (~384 MB on some devices).
- **SpiderMonkey (Firefox):** Latin1-to-TwoByte inflation doubles memory when non-Latin1 characters appear. Conservative GC scanning prevents reclamation of stack-referenced strings during long loops. The native `matchAll` returns `null` on strings exceeding ~128 MB.

The existing `pdf-content-stream-color-converter.js` already addresses the Firefox regex limit with a chunked `matchAll` generator (5 MB chunks) and the rebuild step uses a segment generator fed into streaming compression to avoid materializing the full output string. But these are partial mitigations bolted onto a monolithic regex approach.

The markup parser architecture solves this structurally:

- **Streaming tokenization** — the generator yields tokens without accumulating the full match array. The source string is consumed forward; no slicing backward.
- **Span forwarding** — parenthesized strings are consumed by advancing the position, not by extracting a substring. No `slice()` retention.
- **No extracted strings in events** — events carry `offset` and `length` into the source, not extracted `raw` substrings. Getters allow consumers to decide downstream whether to extract a slice. This prevents `SlicedString` retention of the source.
- **Single-pass processing** — each content stream is tokenized once. The consumer aggregates all necessary color conversions and applies them in one pass via the color engine's multi-transform capabilities, eliminating intermediate transformations that would require re-parsing.

### Why Now (naming collision)

The Device color handling plan (Task 2) introduces `sourcePDFColorSpace` tracking with exhaustive `switch` blocks that include `case 'Indexed':` for the actual PDF Indexed color space. The content stream parser's `type: 'indexed'` creates a naming collision that makes the `switch` blocks ambiguous. This must be resolved first.

### Duplication

The parsing logic is duplicated across four files with an identical monolithic regex (`COLOR_OPERATOR_REGEX`) and three separate `parseContentStreamColors`/`parseContentStream` implementations. The refactor consolidates them into a single module.

### Reference Architecture

The XML markup parser (`classes/baseline/xml-markup-parser.js`) provides the proven architecture:

- **Composed regex construction** — `sequence` template tag + `join` helper, not a single monolithic regex
- **Entity dispatch via numbered capture groups** — `CE.TAG_OPEN`, `TE.NAME`, etc., not named groups
- **Span forwarding** — `consumeSpan` for bulk content (comments, CDATA, strings)
- **Three generator entry points** — `tokenize(source)` (sync string), `tokenizeFrom(lines)` (sync streaming), `tokenizeFromAsync(lines)` (async streaming)
- **Forward scanner for chunking** — `ForwardScanner` + `CHUNK_THRESHOLD` + `atContextBoundary` for determining safe split points
- **Typed events** — `XMLEvent` union type, not string-typed `type` fields
- **Separate consumer** — `collectTree(events)` builds the value tree from the event stream

---

## Current State Audit

### Duplication Map

| File                                                         | Regex                                     | Parse Function                         | Replacement                                    | Chunking                            |
| ------------------------------------------------------------ | ----------------------------------------- | -------------------------------------- | ---------------------------------------------- | ----------------------------------- |
| `services/helpers/pdf-lib.js:144`                            | `COLOR_OPERATOR_REGEX` (canonical export) | None                                   | None                                           | None                                |
| `services/ColorSpaceUtils.js:655`                            | Identical copy                            | `parseContentStreamColors()` → Shape A | `replaceContentStreamColors()` (string concat) | None                                |
| `services/ColorConversionUtils.js:531`                       | Identical copy                            | `parseContentStreamColors()` → Shape A | `replaceContentStreamColors()` (duplicate)     | None                                |
| `classes/baseline/pdf-content-stream-color-converter.js:101` | Identical copy                            | `parseContentStream()` → Shape B       | `rebuildContentStream()` (generator segments)  | `matchAll` chunked generator (5 MB) |
| `experiments/classes/content-stream-parser.mjs`              | Imports from helpers                      | Copy of Shape B parser                 | None                                           | None                                |

### Return Shape Differences

**Shape A** (legacy services — analysis + worker conversion):

```javascript
{
    chunks: ContentStreamColorChunk[],    // { type, operator, value, values, name, raw, index }
    colorSpaces: ColorSpaceUsage[],       // { name, grayCount, rgbCount, cmykCount, indexedCount }
    text: string,                         // original input echoed back
}
```

**Shape B** (baseline converter class — conversion + rebuild):

```javascript
{
    operations: ParsedColorOperation[],   // { type, operator, values, colorSpaceName, name, index, length, raw }
    finalState: ColorSpaceState,          // { strokeColorSpace?, fillColorSpace? }
}
```

Key differences: Shape B tracks `length` (for replacement positioning), `colorSpaceName` (resolved from stroke/fill context), and `finalState` (for cross-stream continuity). Shape A tracks `colorSpaces` summary statistics.

### Operation Types (current → proposed)

| Current `type` | PDF Operators                   | Meaning                    | Problem                               | Proposed                                                              |
| -------------- | ------------------------------- | -------------------------- | ------------------------------------- | --------------------------------------------------------------------- |
| `'gray'`       | `g`/`G`                         | Set DeviceGray and color   | None                                  | `type: 'operator', operation: 'setGray'`                              |
| `'rgb'`        | `rg`/`RG`                       | Set DeviceRGB and color    | None                                  | `type: 'operator', operation: 'setRGB'`                               |
| `'cmyk'`       | `k`/`K`                         | Set DeviceCMYK and color   | None                                  | `type: 'operator', operation: 'setCMYK'`                              |
| `'colorspace'` | `cs`/`CS`                       | Set color space            | Conflated with `/Name scn`            | `type: 'operator', operation: 'setColorSpace'`                        |
| `'colorspace'` | `/Name scn`/`SCN`               | Select named color space   | Conflated with `cs`/`CS`              | `type: 'operator', operation: 'setColorSpace'` (see note below)       |
| `'indexed'`    | `sc`/`SC`/`scn`/`SCN` (numeric) | Set color in current space | **Naming collision with PDF Indexed** | `type: 'operator', operation: 'setColor'`                             |
| `'string'`     | `(...)`                         | String literal             | Never inspected                       | Handled by span forwarding during tokenization (not yielded as event) |
| `'head'`       | (non-color content)             | Content between operators  | Never inspected                       | `type: 'content'`                                                     |

**Note on `/Name scn`/`SCN`:** The PDF spec (Table 4.24, page 288) says SCN/scn supports Pattern color spaces where *name* is a pattern resource name. Currently the parser conflates two uses of SCN/scn: (1) `/Name SCN` where the operand is a resource name, and (2) numeric `c₁...cₙ SCN` where operands are color values. These are currently both assigned `type: 'colorspace'` in case (1) and `type: 'indexed'` in case (2). The proposed classification keeps `operation: 'setColorSpace'` for the name-only form and `operation: 'setColor'` for the numeric form, which matches how `CS`/`cs` and `SC`/`sc` work respectively.

**PostScript derivation:** The operation names (`setGray`, `setRGB`, `setCMYK`, `setColor`, `setColorSpace`) derive from the PostScript operators (`setgray`, `setrgbcolor`, `setcmykcolor`, `setcolor`, `setcolorspace`) that the PDF operators are based on. The PDF 1.7 spec (Table 4.24) confirms the semantics.

### Known Parser Limitations

1. **No `q`/`Q` graphics state save/restore** — color space context set inside `q`...`Q` is not properly scoped. Graphics state save/restore affects which color space is active — a `CS` inside a `q`...`Q` block should be reverted on `Q`. The current parser tracks a single global stroke/fill color space context, which is incorrect when `q`/`Q` nesting is present. This is a correctness issue, not just a missing feature.
2. **Incomplete string literal handling** — the regex `[^)]*` does not handle balanced nested parentheses `(text(inner)text)` or escaped parentheses `\(`, `\)`. Per the PDF spec (ISO 32000-1, Section 7.3.4.2), balanced parentheses within literal strings do not require escaping. Only unbalanced parentheses need `\(` or `\)`. This means a simple regex cannot reliably find the end of a PDF string — a paren-depth counter with backslash-escape awareness is required.
3. **No negative numbers** — `(?:\d+\.?\d*|\.\d+)` does not match negative values
4. **Monolithic regex** — single alternation with 10+ named groups, hard to maintain or extend
5. **No `d`/`D` (dash), `w`/`W` (line width), `j`/`J` (join), `M` (miter) operators** — only color operators matched (this is intentional for a color-focused parser, but the architecture should not preclude extension)

---

## Specification

### New Module: `classes/baseline/pdf-content-stream-parser.js`

A standalone markup-style tokenizer for PDF content stream color operators, following the same architecture as `xml-markup-parser.js`.

### Architecture

Two layers with distinct responsibilities:

```
source string
    → *tokenize(source)              // Layer 1: raw events (syntactic)
    → *interpretGraphicsState()      // Layer 2: enriched events (semantic)
    → collectOperations() / collectAnalysis()   // Consumers
```

**Layer 1 — Tokenizer** (`pdf-content-stream-parser.js`): pure lexer, no semantic state

```
┌──────────────────────────────────────────────────────────────────┐
│  pdf-content-stream-parser.js — TOKENIZER (Layer 1)              │
│                                                                  │
│  ── Matcher Helpers ──                                           │
│  sequence(template)        Template tag for readable regex parts │
│  join(...values)           Join alternatives with |              │
│                                                                  │
│  ── Entity Enums ──                                              │
│  OE (Operator Entity)      { SET_GRAY, SET_RGB, SET_CMYK,        │
│                              SET_COLOR_SPACE, SET_COLOR,         │
│                              SAVE_STATE, RESTORE_STATE,          │
│                              STRING_OPEN, CONTENT,               │
│                              FALLTHROUGH }                       │
│                                                                  │
│  ── Composed Pattern ──                                          │
│  OPERATOR_PATTERN           Built from sequence + join,          │
│                             NOT a single monolithic regex        │
│                                                                  │
│  ── Number Patterns ──                                           │
│  NUMBER                     Matches PDF numeric values           │
│                             (including negative, leading dot)    │
│                                                                  │
│  ── String Span Consumer ──                                      │
│  STRING_SPAN                /(?:[^\\()]+|\\[^])+|(\()|(\))/gy    │
│  consumeStringSpan          Stateful: uses STRING_SPAN regex     │
│                             for bulk forwarding + depth counter  │
│                             for balanced parens + escape skip    │
│                                                                  │
│  ── Raw Event Types ──                                           │
│  RawContentStreamEvent      Union type of raw events             │
│    OperatorEvent            { type: 'operator',                  │
│                               operation: 'setGray' | 'setRGB' |  │
│                               'setCMYK' | 'setColorSpace' |      │
│                               'setColor' | 'saveState' |         │
│                               'restoreState',                    │
│                               operator: string,                  │
│                               isStroke: boolean, ... }           │
│    ContentEvent             { type: 'content' }                  │
│                                                                  │
│  ── Core Generator ──                                            │
│  *tokenize(source)          Sync, full string → raw events       │
│  *tokenizeFrom(chunks)      Sync streaming → raw events          │
│  *tokenizeFromAsync(chunks) Async streaming → raw events         │
│                                                                  │
│  DOES NOT: resolve colorSpaceName, track q/Q state,              │
│            know which color space is "active"                    │
│  DOES: identify tokens, parse numbers, forward through           │
│        string spans, yield q/Q as operator events                │
│                                                                  │
│  ── Forward Scanner (chunking boundary detection) ──             │
│  ForwardScannerState        { parenDepth, escapeNext,            │
│                               lastSignificant }                  │
│  scanForward(scanner, chunk) Advance scanner through chunk text  │
│  atContextBoundary(scanner)  Safe to flush?                      │
│    → parenDepth === 0 (not inside string literal)                │
│    → lastSignificant is a known operator keyword end             │
│      (not in the middle of a number sequence)                    │
│  CHUNK_THRESHOLD            Minimum buffer before attempting     │
│                             flush (same as XML parser)           │
│                                                                  │
│  ── Streaming Pattern ──                                         │
│  Same as XML parser's tokenizeFrom/tokenizeFromAsync:            │
│  1. Buffer incoming chunks                                       │
│  2. scanForward each chunk to track boundary safety              │
│  3. When bufferSize >= CHUNK_THRESHOLD AND                       │
│     atContextBoundary → flushBuffer + drainEvents                │
│  4. After all input consumed → final flush + drain               │
│                                                                  │
│  Accepts: Iterable<string> (sync) or                             │
│           AsyncIterable<string> (async, e.g. ReadableStream)     │
│                                                                  │
│  ── State ──                                                     │
│  ParserState                { source, position, matcher }        │
│                                                                  │
│  ── Memory Safety ──                                             │
│  Events carry offset+length, NOT extracted substrings            │
│  Span forwarding for (...) strings — no extraction               │
│  Single-pass: each stream tokenized once, all conversions        │
│  aggregated into one batch, one rebuild pass                     │
│  flushBuffer releases consumed source prefix — no retention      │
└──────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│  pdf-content-stream-interpreter.js — GRAPHICS STATE (Layer 2)    │
│                                                                  │
│  Consumes raw events from tokenizer, yields enriched events.     │
│                                                                  │
│  ── State ──                                                     │
│  { strokeColorSpace, fillColorSpace }                            │
│  Updated from three sources:                                     │
│    1. setColorSpace events (CS/cs) — explicit named color space  │
│    2. setGray/setRGB/setCMYK events — implicit Device* change    │
│    3. saveState/restoreState events (q/Q) — push/pop stack       │
│                                                                  │
│  ── Graphics State Stack ──                                      │
│  q (saveState)  → push {strokeColorSpace, fillColorSpace}        │
│  Q (restoreState) → pop and restore                              │
│                                                                  │
│  ── Enrichment ──                                                │
│  setColor events gain `colorSpaceName` resolved from current     │
│  stroke/fill context at the point of the operation               │
│                                                                  │
│  ── Generator ──                                                 │
│  *interpretGraphicsState(rawEvents, initialState?)               │
│    Consumes raw events, yields enriched events                   │
│    Accepts optional initialState for cross-stream continuity     │
│    Exposes finalState after completion                           │
│                                                                  │
│  DOES NOT: parse text, identify tokens, handle string spans      │
│  DOES: track color space context, manage q/Q stack,              │
│        resolve colorSpaceName, enrich events                     │
└──────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│  Consumers (downstream of interpreter)                           │
│                                                                  │
│  collectOperations(events)  Builds the operations array from     │
│                             enriched event stream (Shape B)      │
│  collectAnalysis(events)    Builds the analysis from enriched    │
│                             event stream (Shape A)               │
└──────────────────────────────────────────────────────────────────┘
```

### Event Type Definitions

All events carry `type`, `offset` (position in source), and `length` (span in source).

**No extracted strings in events.** Events do **not** carry a `raw` field with an extracted substring of the source. This is intentional — extracting substrings via `slice()` creates `SlicedString` objects in V8 that retain the entire source string in the heap. Instead, consumers that need the raw text can use `source.slice(event.offset, event.offset + event.length)` — but only when they actually need it, and only for the short-lived scope where it's needed. This is the same principle as the XML parser's events, which carry positional information rather than extracted content.

**Operator events** (`type: 'operator'`) additionally carry:

| Field       | Type      | Description                                                                                                           |
| ----------- | --------- | --------------------------------------------------------------------------------------------------------------------- |
| `operation` | `string`  | One of `'setGray'`, `'setRGB'`, `'setCMYK'`, `'setColorSpace'`, `'setColor'`                                          |
| `operator`  | `string`  | The PDF operator token (`'g'`, `'G'`, `'rg'`, `'RG'`, `'k'`, `'K'`, `'cs'`, `'CS'`, `'sc'`, `'SC'`, `'scn'`, `'SCN'`) |
| `isStroke`  | `boolean` | Derived from uppercase (stroke) vs lowercase (nonstroking) operator                                                   |

Plus operation-specific fields:

| `operation`       | Additional Fields                                                                            |
| ----------------- | -------------------------------------------------------------------------------------------- |
| `'setGray'`       | `value: number`                                                                              |
| `'setRGB'`        | `values: [number, number, number]`                                                           |
| `'setCMYK'`       | `values: [number, number, number, number]`                                                   |
| `'setColorSpace'` | `name: string` (the resource name, e.g., `'CS0'`)                                            |
| `'setColor'`      | `values: number[]` — **no `colorSpaceName` at this layer** (resolved by Layer 2 interpreter) |
| `'saveState'`     | (none — `q` operator)                                                                        |
| `'restoreState'`  | (none — `Q` operator)                                                                        |

**Layer 1 (tokenizer) yields raw events.** It does not resolve `colorSpaceName`, does not track which color space is active, and does not maintain a `q`/`Q` state stack. It identifies tokens syntactically.

**Layer 2 (interpreter) enriches events.** It consumes raw events from the tokenizer, maintains `{strokeColorSpace, fillColorSpace}` with a `q`/`Q` stack, updates state from Device shortcuts, and yields enriched `setColor` events with `colorSpaceName` resolved. See the architecture diagram above.

**Content events** (`type: 'content'`) carry only `offset` and `length` — the non-operator content between operators. The consumer uses these to copy through unchanged content during rebuild.

**String literals** (`(...)`) are consumed by a stateful span consumer during tokenization. Per the PDF spec (ISO 32000-1, Section 7.3.4.2), balanced parentheses within literal strings are valid without escaping — only unbalanced parentheses require `\(` or `\)`. The backslash itself must be escaped as `\\`. A simple regex like `[^)]*` is incorrect.

The span consumer uses a sticky regex for bulk forwarding with a stateful depth counter:

```javascript
// Sticky regex: bulk-forwards through non-special chars, skips escape sequences,
// captures unescaped ( and ) for depth tracking
const STRING_SPAN = /(?:[^\\()]+|\\[^])+|(\()|(\))/gy;
```

| Alternative            | Matches                                                   | Action                                                              |
| ---------------------- | --------------------------------------------------------- | ------------------------------------------------------------------- |
| `(?:[^\\()]+\|\\[^])+` | Bulk content + escape sequences (one or more repetitions) | Consumed in one `exec()` — regex engine's internal loop, no JS work |
| `(\()`                 | Unescaped `(` (capture group 1)                           | Increment depth                                                     |
| `(\))`                 | Unescaped `)` (capture group 2)                           | Decrement depth; if 0 → span complete                               |

The `+` (not `*`) ensures the first alternative requires at least one repetition, preventing empty matches. When the next character is a bare `(` or `)`, the first alternative fails and the capture group alternatives match. The JavaScript loop only fires on actual parens — everything between parens is consumed by the regex engine's native loop in a single `exec()` call. No substring extraction occurs.

String spans are **not yielded as events**. The content between color operators that contains string literals appears as `type: 'content'` with `offset`/`length` spanning the entire non-operator region including the string.

### Streaming and Chunking (ReadableStream/WritableStream compatibility)

The tokenizer must work with readable and writable streams, not just complete strings. The architecture follows the same pattern as the XML parser's `tokenizeFrom`/`tokenizeFromAsync`:

```
incoming chunks (Iterable<string> or AsyncIterable<string>)
    │
    ▼
┌─ Streaming Loop ──────────────────────────────────────────┐
│  for (await) chunk of chunks:                             │
│    lineBuffer.push(chunk)                                 │
│    bufferSize += chunk.length                             │
│    scanForward(scanner, chunk)     ← lightweight scan     │
│                                                           │
│    if bufferSize >= CHUNK_THRESHOLD                        │
│       AND atContextBoundary(scanner):                     │
│      flushBuffer(state, lineBuffer)  ← join + reset       │
│      yield* drainEvents(state)       ← tokenize buffered  │
│                                                           │
│  final: flush remaining + drain                           │
└───────────────────────────────────────────────────────────┘
    │
    ▼
raw events → interpreter → consumer
```

**Forward scanner** — lightweight character scanner that tracks boundary safety without full parsing:

```javascript
ForwardScannerState = {
    parenDepth: number,    // > 0 means inside a string literal
    escapeNext: boolean,   // next char is escaped (after \)
    lastSignificant: number, // char code of last non-whitespace char
}
```

**`atContextBoundary(scanner)`** — returns `true` when safe to flush:

- `parenDepth === 0` — not inside a string literal (a chunk boundary inside `(...)` would corrupt the span consumer)
- `lastSignificant` indicates we're between complete operator sequences, not in the middle of a number-operand group

**`flushBuffer(state, lineBuffer)`** — joins buffered chunks into `state.source`, resets `position` and `matcher.lastIndex` to 0. The previous source prefix (already consumed by `drainEvents`) is released — no `SlicedString` retention of consumed data.

**`drainEvents(state)`** — runs the main tokenizer regex against the current buffer, yields all complete events, and stops at the buffer end. When the next `flushBuffer` appends new data, `drainEvents` continues from where it left off.

This pattern ensures:

- The tokenizer never holds the entire content stream as a single string (chunks are joined into manageable buffers, not the full source)
- The forward scanner is O(n) with constant memory — it just tracks a few counters
- Flushing only happens at safe boundaries — no split in the middle of a string literal or operator sequence
- Works with `ReadableStream` via async iteration (`for await (const chunk of stream)`)

### Single-Pass Processing Constraint

Each content stream must be processed exactly once. The tokenizer yields events, the consumer collects all color operations that need conversion, the color engine converts them in a single batch (using multi-transform for mixed color spaces), and the rebuild step writes the output stream using the segment generator fed into streaming compression.

No intermediate strings are materialized. No re-parsing. No content stream is visited twice for different conversion passes. If multiple color space conversions are needed for the same stream (e.g., both `ICCBasedRGB` and `DeviceGray` operations), they are aggregated into one batch and applied in one rebuild pass.

### Color Space State Tracking

The graphics state (PDF 1.7, Section 4.3, Table 4.2) includes the **current color space** and **current color** as separate parameters for stroking and nonstroking. The `q` operator pushes a copy of the **entire** graphics state onto a stack; `Q` pops and restores it. `q`/`Q` must be balanced within a content stream or sequence of streams.

The **interpreter** (Layer 2, not the tokenizer) tracks `{strokeColorSpace, fillColorSpace}` and updates it from three sources:

1. **`CS`/`cs` operators** (`setColorSpace`) — explicitly set the named color space (e.g., `'CS0'`)
2. **Device shortcut operators** (`setGray`, `setRGB`, `setCMYK`) — implicitly set the color space to `'DeviceGray'`, `'DeviceRGB'`, or `'DeviceCMYK'` respectively, in addition to setting the color value. This is per the spec (Table 4.24, page 288): `G` "Set the stroking color space to **DeviceGray** and set the gray level"
3. **`q`/`Q` operators** (`saveState`/`restoreState`) — push/pop the entire `{strokeColorSpace, fillColorSpace}` state

The `colorSpaceName` field on `setColor` events is resolved from the current state after all the above updates have been applied.

**Example demonstrating all three:**

```
/CS0 cs          % fillColorSpace = 'CS0' (ICCBasedRGB)
0.5 0.3 0.2 scn  % setColor → colorSpaceName = 'CS0' ✓
q                % push {stroke: ..., fill: 'CS0'}
0.5 g            % fillColorSpace = 'DeviceGray' (implicit from setGray)
0.7 scn          % setColor → colorSpaceName = 'DeviceGray' ✓
Q                % pop → fillColorSpace = 'CS0' (restored)
0.8 0.4 0.1 scn  % setColor → colorSpaceName = 'CS0' ✓ (not 'DeviceGray')
```

The `finalState` (last known stroke/fill color space) is available after tokenization for cross-stream continuity, as multiple content streams on a page share graphics state.

The `saveState`/`restoreState` events are yielded to the consumer so it can track graphics state scope for its own purposes (e.g., deciding whether a color operation applies globally or is scoped to a local graphics state).

---

## Testing Protocol

Every task follows this protocol. No exceptions.

1. **Assess** existing tests — identify whether current tests cover the code being changed
2. **Add regression tests** — before any code changes, add tests that lock in current behavior
3. **Run tests** to establish baseline — all must pass (or be explicitly marked skipped with justification)
4. **Make changes**
5. **Run tests** — verify no regressions
6. **If regressions** — fix and repeat from step 5 until clean
7. **Add new tests** for the final changes made

---

## Roadmap

### Task 1: Assess existing tests and establish baseline

- [x] **1.1 Assess** — review `pdf-content-stream-color-converter.test.js` and `ColorSpaceUtils.test.js` for coverage of:
  - Parsing of each operator type (`g`/`G`, `rg`/`RG`, `k`/`K`, `cs`/`CS`, `sc`/`SC`/`scn`/`SCN`)
  - String literal handling `(...)`
  - `convertColor` routing (`type === 'indexed'` filter, `deviceColors` filter, CMYK silent drop)
  - Cross-stream `finalState` continuity
  - Large stream chunking
- [x] **1.2 Add regression tests** that lock in current behavior:
  - Parse each operator type → current `type` and field values
  - `convertColor` with ICCBased named color space → conversion count
  - `convertColor` with Device colors → skip count / drop count
  - String `(...)` skipped correctly
  - Stroke vs fill context tracking
- [x] **1.3 Run `yarn test`** — establish clean baseline (all pass, 0 fail)
  - Record: total, passed, skipped, failed
  - If failures: fix or mark skipped with justification

### Task 2: Implement tokenizer — `pdf-content-stream-parser.js` (Layer 1)

- [x] **2.1 Assess** — Task 1 regression tests cover parsing; identify any gaps for tokenizer-specific behavior (string span depth, `q`/`Q` token emission, offset/length correctness)
- [x] **2.2 Add regression tests** for tokenizer behavior:
  - `*tokenize(source)` produces correct events for each operator type
  - `setColor` events carry `values` only (no `colorSpaceName`)
  - `saveState`/`restoreState` events yielded for `q`/`Q`
  - String span: `(balanced (parens) inside)` consumed as single span
  - String span: `(escaped \( and \) parens)` consumed correctly
  - String span: `(nested (balanced \) unbalanced)` depth counter + escape
  - Events carry `offset`+`length`, no extracted `raw` substrings
  - Non-operator content → `type: 'content'`
  - Mixed operators in sequence → correct count, order, offset/length
- [x] **2.3 Run `yarn test`** — baseline still clean
- [x] **2.4 Implement** `classes/baseline/pdf-content-stream-parser.js`:
  - Composed regex via `sequence` + `join`
  - Entity enum dispatch (`OE` constants)
  - String span consumer (`STRING_SPAN` regex + depth counter)
  - `*tokenize(source)` — sync generator
  - `*tokenizeFrom(chunks)` — sync streaming with `ForwardScanner` + `CHUNK_THRESHOLD` + `atContextBoundary`
  - `*tokenizeFromAsync(chunks)` — async streaming
- [x] **2.5 Run `yarn test`** — verify no regressions
- [x] **2.6 If regressions** — fix, repeat from 2.5
- [x] **2.7 Add new tests** for tokenizer:
  - `tokenize(fullString)` vs `tokenizeFrom(chunks)` → identical events (chunking equivalence)
  - `tokenizeFrom` with chunk boundary inside string literal → boundary safety
  - `tokenizeFrom` with chunk boundary inside number sequence before operator → boundary safety
  - `tokenizeFromAsync(readableStream)` → same events as `tokenize`
  - Large stream (>5 MB) chunked → same results as non-chunked

### Task 3: Implement interpreter — `pdf-content-stream-interpreter.js` (Layer 2)

- [x] **3.1 Assess** — identify gaps for interpreter-specific behavior (graphics state stack, implicit Device color space changes, `colorSpaceName` resolution)
- [x] **3.2 Add regression tests** for interpreter behavior:
  - `setColor` events enriched with `colorSpaceName` from current stroke/fill context
  - `CS` inside `q`...`Q` → `colorSpaceName` reverts after `Q`
  - `g`/`rg`/`K` inside `q`...`Q` → implicit color space change reverts after `Q`
  - `scn` after `Q` resolves to pre-`q` color space, not inner color space
  - Nested `q`...`q`...`Q`...`Q` → correct stack depth
  - Cross-stream `finalState` continuity with `initialState`
  - `collectOperations(events)` produces Shape B (operations array + finalState)
  - `collectAnalysis(events)` produces Shape A (color space usage counts)
- [x] **3.3 Run `yarn test`** — baseline still clean
- [x] **3.4 Implement** `classes/baseline/pdf-content-stream-interpreter.js`:
  - `*interpretGraphicsState(rawEvents, initialState?)`
  - Graphics state stack for `q`/`Q`
  - Color space updates from Device shortcuts
  - `colorSpaceName` enrichment on `setColor` events
  - `collectOperations(events)` and `collectAnalysis(events)` consumers
- [x] **3.5 Run `yarn test`** — verify no regressions
- [x] **3.6 If regressions** — fix, repeat from 3.5
- [x] **3.7 Add new tests** for interpreter-specific behavior not covered by regression tests

### Task 4: Replace baseline converter parsing

- [x] **4.1 Assess** — identify all places in `PDFContentStreamColorConverter` that reference `COLOR_OPERATOR_REGEX`, `parseContentStream`, `type === 'indexed'`, `type === 'rgb'`, `type === 'gray'`, `type === 'cmyk'`
- [x] **4.2 Add regression tests** — `convertColor` end-to-end with real content streams:
  - Conversion count with `operation: 'setColor'` must equal current count with `type: 'indexed'`
  - Device colors (`setGray`/`setRGB`/`setCMYK`) skip count must equal current `deviceColors` count
  - `rebuildContentStream` output must be byte-identical to current output for same input
- [x] **4.3 Run `yarn test`** — baseline still clean
- [x] **4.4 Make changes:**
  - Replace `parseContentStream` with `tokenize` → `interpretGraphicsState` → `collectOperations` pipeline
  - Update `convertColor` filtering to use new operation names
  - Update `rebuildContentStream` to work with new event types
  - Remove inline `COLOR_OPERATOR_REGEX` and `matchAll` chunked generator
  - Implemented streaming pipeline: compressed → decompress → tokenize chunks → passthrough/substitute → compress
  - Fixed operator displacement bug (passthrough vs operator ordering)
  - Decoupled batching from decompression chunks (100 MB threshold)
  - Fixed carry boundary bug in `transformFromAsync` (`kn` invalid operator)
  - Added `content-stream-streaming` worker dispatch in `worker-pool-entrypoint.js` and `pdf-page-color-converter.js`
- [x] **4.5 Run `yarn test`** — verify no regressions
- [x] **4.6 If regressions** — fix, repeat from 4.5
- [x] **4.7 Add new tests** for refactored converter behavior
  - `verify-streaming-order.mjs` — confirms token ordering in streaming pipeline
  - `verify-streaming-conversion.mjs` — end-to-end conversion correctness
  - `compare-content-streams.mjs` — compares original vs converted PDF content streams
  - `inspect-page21.mjs` — identified `kn` invalid operator on page 21

### Task 5: Replace legacy service parsing

- [ ] **5.1 Assess** — identify all places in `ColorSpaceUtils.js`, `ColorConversionUtils.js`, `helpers/pdf-lib.js` that define or use `COLOR_OPERATOR_REGEX` and `parseContentStreamColors`
- [ ] **5.2 Add regression tests** — lock in current behavior of legacy `parseContentStreamColors` (Shape A output) and `replaceContentStreamColors` for representative content streams
- [ ] **5.3 Run `yarn test`** — baseline still clean
- [ ] **5.4 Make changes:**
  - Replace `ColorSpaceUtils.js` parsing with `tokenize` → `interpretGraphicsState` → `collectAnalysis`
  - Replace `ColorConversionUtils.js` parsing similarly
  - Remove duplicate `replaceContentStreamColors` implementations
  - Update `helpers/pdf-lib.js` export (re-export or remove)
- [ ] **5.5 Run `yarn test`** — verify no regressions
- [ ] **5.6 If regressions** — fix, repeat from 5.5
- [ ] **5.7 Add new tests** if any legacy-specific behavior was not covered

### Task 6: Update dependent code

- [ ] **6.1 Assess** — identify all remaining references to `type === 'indexed'`, `'indexed'` string, old operation names in `PDFService.js`, experiments, tests
- [ ] **6.2 Run `yarn test`** — baseline still clean
- [ ] **6.3 Make changes:**
  - Update `services/PDFService.js` to use new operation names
  - Update `experiments/classes/content-stream-parser.mjs` to import from new modules
  - Update all tests that reference old type names
- [ ] **6.4 Run `yarn test`** — verify no regressions
- [ ] **6.5 If regressions** — fix, repeat from 6.4

### Task 7: Final verification

- [ ] **7.1 Run `yarn test`** — full suite must pass
- [ ] **7.2 Verify** `COLOR_OPERATOR_REGEX` no longer exists as a definition in any file except potentially as a re-export
- [ ] **7.3 Verify** no file defines its own `parseContentStreamColors` or `parseContentStream`
- [ ] **7.4 Verify** the word `'indexed'` does not appear as a content stream operation type anywhere in `2026/`
- [ ] **7.5 Verify** OOM regression: Interlaken Color Map content stream (200+ MB) processes without OOM on Safari
- [ ] **7.6 Verify** single-pass constraint: each content stream visited exactly once
- [ ] **7.7 Record** final test counts: total, passed, skipped, failed

---

## Test Reference

Tests are organized by what they verify and which task introduces them.

### Tokenizer tests (Task 2)

| Test | What It Verifies |
| ---- | ---------------- |
| Parse `g`/`G` → `operation: 'setGray'` | DeviceGray shortcut detection |
| Parse `rg`/`RG` → `operation: 'setRGB'` | DeviceRGB shortcut detection |
| Parse `k`/`K` → `operation: 'setCMYK'` | DeviceCMYK shortcut detection |
| Parse `cs`/`CS` with name → `operation: 'setColorSpace'` | Color space selection |
| Parse `/Name scn`/`SCN` → `operation: 'setColorSpace'` | Named color space selection via SCN |
| Parse numeric `sc`/`SC`/`scn`/`SCN` → `operation: 'setColor'` (values only, no colorSpaceName) | Set color in current space |
| Parse `q`/`Q` → `operation: 'saveState'`/`'restoreState'` | Graphics state token emission |
| Parse `(string)` → consumed by span forwarding, not yielded | String literal span handling |
| `(balanced (parens) inside)` → consumed as single span | Balanced parenthesis handling |
| `(escaped \( and \) parens)` → consumed correctly | Escape handling |
| `(nested (balanced \) unbalanced)` → depth counter + escape | Combined nested+escaped |
| Non-operator content → `type: 'content'` | Content between operators |
| Mixed operators in sequence → correct count, order, offset, length | Integration |
| Events carry `offset`+`length`, no extracted `raw` substrings | Memory safety |

### Streaming tests (Task 2)

| Test | What It Verifies |
| ---- | ---------------- |
| `tokenize(fullString)` vs `tokenizeFrom(chunks)` → identical events | Chunking equivalence |
| `tokenizeFrom` boundary inside string literal `(...)` → not split | Forward scanner: string span safety |
| `tokenizeFrom` boundary inside number sequence before operator → not split | Forward scanner: operator sequence safety |
| `tokenizeFromAsync(readableStream)` → same events as `tokenize` | Async streaming correctness |
| Large stream (>5 MB) chunked → same results as non-chunked | Chunking correctness at scale |

### Interpreter tests (Task 3)

| Test | What It Verifies |
| ---- | ---------------- |
| `setColor` events enriched with `colorSpaceName` | Color space context resolution |
| Stroke vs fill context tracking (`CS` vs `cs`, `SC` vs `sc`) | Separate stroke/fill state |
| `CS` inside `q`...`Q` → `colorSpaceName` reverts after `Q` | Graphics state scoping for explicit CS |
| `g`/`rg`/`K` inside `q`...`Q` → implicit color space change reverts after `Q` | Graphics state scoping for Device shortcuts |
| `scn` after `Q` resolves to pre-`q` color space, not inner color space | Color space restoration correctness |
| Nested `q`...`q`...`Q`...`Q` → correct stack depth | Nested graphics state |
| Cross-stream `finalState` continuity | Multi-stream state |
| `collectOperations(events)` → Shape B (operations + finalState) | Consumer: Shape B |
| `collectAnalysis(events)` → Shape A (color space counts) | Consumer: Shape A |

### Integration tests (Tasks 4-6)

| Test | What It Verifies |
| ---- | ---------------- |
| `convertColor` with `operation: 'setColor'` → same conversion count as old `type: 'indexed'` | **Routing rename must not change behavior** |
| `rebuildContentStream` output byte-identical to current for same input | Rebuild correctness |
| Interlaken Color Map (200+ MB) processes without OOM on Safari | OOM regression |
| Each content stream visited exactly once | Single-pass constraint |

---

## Current Status

**Focus:** Worker dispatch and end-to-end validation. Tasks 1-3 complete (tokenizer + interpreter + bridge). Task 4 streaming pipeline functional — operator ordering bug, batching inefficiency, and carry boundary bug all fixed. Worker dispatch for content streams implemented. Verification scripts confirm correctness.

### Streaming Pipeline Bugs Fixed (2026-04-07)

1. **Operator displacement bug** in `convertColorStreaming` (`pdf-content-stream-color-converter.js`): passthrough bytes were written to the compressor immediately while operator tokens were accumulated and only written at chunk boundaries. Color operators appeared AFTER drawing operations in the output, rendering everything black. Fix: collect ALL tokens (passthrough + operator) in order per decompression chunk, batch-convert operators, then write everything in original interleaved order.

2. **Batching tied to decompression chunks**: Browser `DecompressionStream` emits small chunks (16-64 KB), so each batch had ~1 operator (`pixels=1`). Fix: accumulate ALL tokens across chunks, flush only at 100 MB threshold or stream end. Result: 330 operators in one `buildLookupTable` call instead of 330 separate calls.

3. **Carry boundary bug** (`kn` invalid operator) in `transformFromAsync` (`pdf-content-stream-parser.js`): operator tokens were yielded past `safeEnd` (carry zone). When a chunk boundary split `SCN` into `SC` + `N`, the regex matched `SC` (because `\b` sees end-of-text as non-word), yielded it, and `N` leaked as passthrough producing `kn` in output. Fix: don't yield operators at or past `safeEnd`; rewind `regex.lastIndex` and break. Also fixed: final carry flush now tokenizes content (was previously emitted as raw passthrough).

### Worker Dispatch for Content Streams (2026-04-07)

- Added `content-stream-streaming` task type to `worker-pool-entrypoint.js` — handles `convertColorStreaming` entirely in pool workers.
- `pdf-page-color-converter.js` dispatches content streams to the worker pool when workers are enabled (`this.workerPool && !useLegacyContentStreamParsing`).
- Compressed bytes transferred both directions (no string materialization, no cloning).

### Safari OOM Root Cause (2026-04-07)

The initial tokenizer implementation (Tasks 2-3) works correctly but was integrated into the converter via a bridge layer that calls `tokenize(fullString)` on the entire decompressed content stream. This is the same full-string approach as before, with an additional problem: the new tokenizer generates ~31.9M events for a 50MB stream (vs ~650K matches with the old regex) because its `CONTENT`/`FALLTHROUGH` alternatives fire for every non-operator word and whitespace character individually.

**Measured on the real asset PDF (262 MB across 29 content streams):**
- Largest stream: 125.6 MB decompressed (Interlaken Color Map, pages 10-11)
- Old regex: ~2.6M matches total
- New tokenizer via `tokenize(fullString)`: ~127.7M events (49x more)
- Streaming pipeline (compressed→chunks→tokenize→compress): 9.9 MB heap, 12.6s

The fix is NOT tweaking the tokenizer to yield fewer events. The fix is eliminating the full-string approach entirely:

```
PDFRawStream.contents (compressed Uint8Array)
  → DecompressionStream('deflate')
  → Latin-1 decode (chunked)
  → tokenize transform (regex on chunks, carry-over for boundary splits)
  → passthrough non-operator content / substitute operator tokens
  → Latin-1 encode (chunked)
  → CompressionStream('deflate')
  → new Uint8Array → PDFRawStream.contents
```

A `useLegacyContentStreaming` option (`false` by default) has been added to the converter configuration to allow falling back to the pre-refactor regex approach for diagnostic comparison. This is NOT the fix — it is a comparison tool.

---

## Activity Log

| Date       | Activity |
| ---------- | -------- |
| 2026-04-06 | Created progress document with full plan; audited 4-file duplication and XML parser reference pattern |
| 2026-04-06 | Tasks 1-3 complete: tokenizer, interpreter, bridge layer in converter; 372 tests, 321 pass, 0 fail |
| 2026-04-07 | Safari OOM regression identified: bridge layer materializes full string, tokenizer generates 49x more events than old regex |
| 2026-04-07 | Root cause confirmed with Node.js benchmarks on real 1.5 GB asset PDF — streaming pipeline processes 262 MB at 9.9 MB heap |
| 2026-04-07 | Web Streams API (DecompressionStream/CompressionStream) pipeline validated in Node.js — browser-compatible |
| 2026-04-07 | `useLegacyContentStreaming` option added for diagnostic comparison (NOT the fix) |
| 2026-04-07 | Streaming pipeline implementation in progress — replacing `parseContentStream(fullString)` with compressed-to-compressed pipeline |
| 2026-04-07 | Fixed operator displacement bug in `convertColorStreaming` — passthrough bytes were written immediately but operators accumulated until chunk boundaries, causing color operators to appear after drawing operations (everything rendered black). Fix: collect all tokens in order per chunk, batch-convert, write in original interleaved order |
| 2026-04-07 | Decoupled batching from decompression chunks — browser `DecompressionStream` emits 16-64 KB chunks yielding ~1 operator per batch. Now accumulates all tokens across chunks, flushes at 100 MB threshold or stream end (330 operators in one `buildLookupTable` call instead of 330 calls of 1) |
| 2026-04-07 | Fixed carry boundary bug (`kn` invalid operator) in `transformFromAsync` — chunk boundary splitting `SCN` into `SC`+`N` caused regex to match `SC` past `safeEnd` (where `\b` sees end-of-text as non-word). Fix: don't yield operators at or past `safeEnd`, rewind `regex.lastIndex`. Also fixed final carry flush to tokenize content instead of emitting as raw passthrough |
| 2026-04-07 | Added `content-stream-streaming` task type to `worker-pool-entrypoint.js` and worker dispatch in `pdf-page-color-converter.js` — compressed bytes transferred both directions, no string materialization |
| 2026-04-07 | Testing infrastructure: `verify-streaming-order.mjs` (token ordering), `verify-streaming-conversion.mjs` (end-to-end correctness), `compare-content-streams.mjs` (original vs converted), `inspect-page21.mjs` (found `kn` invalid operator) |
