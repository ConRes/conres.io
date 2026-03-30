# XML Markup Parser — PROGRESS

**Created:** 2026-03-29
**Last Updated:** 2026-03-29
**Status:** Planning

---

## Context

The PDF validator needs to parse and patch XMP metadata embedded in PDF files. XMP is XML — specifically, RDF/XML wrapped in `<?xpacket?>` processing instructions.

Currently the fixer uses `DOMParser` / `XMLSerializer` (browser built-in). This works but:

- Not available in Node.js without polyfills
- Does not preserve exact whitespace/formatting (XMLSerializer normalizes)
- Cannot stream — requires the full XML string in memory
- Loses `<?xpacket?>` wrappers (they're processing instructions outside the document element)
- Cannot compose with the async generator pipeline planned for Phase 2

### The Markup Tokenizer Architecture

The solution is to derive an XML parser from Saleh Abdel Motaal's [SMotaal/markup](https://github.com/SMotaal/markup) tokenizer architecture — the same approach used for the `json-markup-parser` (`~/.claude/meta/workspaces/scripts/utilities/packages/json-markup-parser`).

The architecture has five core abstractions:

| Abstraction          | Purpose                                                                                 |
| -------------------- | --------------------------------------------------------------------------------------- |
| **Goals**            | Frozen configuration objects defining what is valid in each parsing context             |
| **Context Stack**    | Runtime nesting tracker — push on openers, pop on closers                               |
| **Composed Matcher** | Single RegExp built from entity patterns joined by alternation, each in a capture group |
| **Entity Dispatch**  | Matched capture group index determines which handler processes the token                |
| **Span Forwarding**  | For string/CDATA/comment content, a secondary regex probes ahead in one pass            |

### Source Material

The HTML tokenizer in the markup project already handles all XML structures:

| File                                                                                                            | Purpose                                                                                    |
| --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `~/Projects/smotaal.github.io/packages/markup/packages/matcher/experimental/html-tokenizer/html-definitions.js` | Goal definitions: HTMLGoal, tags, comments, PI, CDATA, strings, DOCTYPE                    |
| `~/Projects/smotaal.github.io/packages/markup/packages/matcher/experimental/html-tokenizer/html-matcher.js`     | Composed RegExp matcher with entity dispatch                                               |
| `~/Projects/smotaal.github.io/packages/markup/packages/matcher/experimental/html-tokenizer/html-mode.js`        | Mode registration for the tokenizer                                                        |
| `~/Projects/smotaal.github.io/packages/markup/packages/matcher/experimental/common/helpers.js`                  | State initialization, context management, goal generation                                  |
| `~/Projects/smotaal.github.io/packages/markup/packages/matcher/lib/matcher.js`                                  | Core `Matcher extends RegExp` class: `define()`, `sequence`, `join`, `capture()`, `exec()` |
| `~/Projects/smotaal.github.io/packages/markup/packages/matcher/lib/token-matcher.js`                            | `TokenMatcher extends Matcher`: `open()`, `close()`, `forward()`, entity handlers          |

The JSON parser derivation (`json-markup-parser.js`, 683 lines) demonstrates the extraction pattern: inline the `sequence`/`join`/`Ranges` helpers, compose the matcher as a single `MATCHER_PATTERN` string, implement entity dispatch via capture group index, and add value construction.

### How the Composed Matcher Works

The key composition pattern from the markup architecture:

```javascript
// sequence — tagged template that strips whitespace for multi-line regex
const sequence = (template, ...spans) =>
    /^\s+|\s*\n\s*|\s+$/g[Symbol.replace](
        String.raw(template, ...spans.map(value => (value != null && `${value}`) || '')),
        '',
    );

// join — alternation with | filtering empty values
const join = (...values) =>
    values.map(value => (value != null && `${value}`) || '').filter(Boolean).join('|');

// The composed pattern — each (...) is one capture group = one entity
const MATCHER_PATTERN = join(
    sequence`(entity-1-pattern)`,
    sequence`(entity-2-pattern)`,
    sequence`(entity-3-pattern)`,
);

// Create the RegExp — entity index = capture group index
const MATCHER = new RegExp(MATCHER_PATTERN, 'g');
```

When `MATCHER.exec(source)` matches, exactly one capture group is defined. The index of that group identifies the entity type. This is how a single regex handles all token types without ambiguity — the same technique `Matcher.define()` uses internally.

### How Span Forwarding Works

For bulk content (strings, comments, CDATA), the matcher delegates to a secondary "span" regex that jumps ahead to find the end position:

```javascript
// String span — finds closing quote, detects faults
const STRING_SPAN = /(?:[^"\\\n]+?(?=\\[^]|")|\\[^])*?(?="|(fault-patterns))/g;

// CDATA span — jumps to ]]>
const CDATA_SPAN = /[^]*?(?=\]\]>|($))/g;

// Comment span — jumps to -->
const COMMENT_SPAN = /[^]*?(?=-->|($))/g;
```

The span regex sets `lastIndex` to the end position. The main matcher loop resumes from there. Content between the opener and the span's end position is extracted via `source.slice(start, end)`.

---

## XML vs HTML: What Changes

XML is a strict subset of what the HTML tokenizer handles. The derivation **removes** complexity rather than adding it.

### Keep from HTML

| Goal                        | Purpose                              | Notes                                               |
| --------------------------- | ------------------------------------ | --------------------------------------------------- |
| Root goal                   | Top-level content matching           | Simplified — no implicit nesting                    |
| Tag goal                    | `<element ...>` opening/closing tags | Same pattern, namespace-aware names already handled |
| String goal                 | `"..."` and `'...'` attribute values | Identical                                           |
| Comment goal                | `<!-- ... -->`                       | Identical                                           |
| Processing Instruction goal | `<?xml ...?>`, `<?xpacket ...?>`     | Identical                                           |
| CDATA goal                  | `<![CDATA[ ... ]]>`                  | Identical                                           |

### Remove from HTML

- CSS/JS embedded mode switching (`ECMAScriptMode`)
- Script/style special handling
- Void element detection
- HTML-specific entity handling
- DOCTYPE internal subset (`<!DOCTYPE ... [ ... ]>`) — XMP doesn't use this

### XML-Specific Additions

- **Namespace resolution**: Track `xmlns:prefix="uri"` declarations, resolve `prefix:localname`
- **Element tree construction**: Build a lightweight element tree (like JSON parser builds objects/arrays)
- **Processing instruction preservation**: `<?xpacket?>` wrappers must round-trip exactly

### Entity Design for XML

| Entity      | Capture Group | Pattern                       |
| ----------- | ------------- | ----------------------------- |
| BREAK       | 1             | `(\r?\n)`                     |
| WHITESPACE  | 2             | `(\s+)`                       |
| STRING      | 3             | `("                           | ')`     |
| OPENER      | 4             | `(<\?                         | <!--    | <!\[CDATA\[              | </[A-Za-z][-A-Za-z0-9.:]* | <[A-Za-z][-A-Za-z0-9.:]*)` |
| CLOSER      | 5             | `(\?>                         | -->     | \]\]>                    | />                        | >)`                        |
| OPERATOR    | 6             | `(=)`                         |
| ENTITY_REF  | 7             | `(&(?:#x[0-9a-fA-F]+          | #[0-9]+ | [A-Za-z][A-Za-z0-9]*);)` |
| NAME        | 8             | `([A-Za-z_][-A-Za-z0-9._:]*)` |
| FALLTHROUGH | 9             | `(.)`                         |

### Span Regexes

```javascript
// Attribute value spans (same as HTML)
const DOUBLE_QUOTE_SPAN = /(?:[^"&]+?(?=&|")|&(?:#x[0-9a-fA-F]+|#[0-9]+|[A-Za-z]+);)*?(?="|($))/g;
const SINGLE_QUOTE_SPAN = /(?:[^'&]+?(?=&|')|&(?:#x[0-9a-fA-F]+|#[0-9]+|[A-Za-z]+);)*?(?='|($))/g;

// Comment span
const COMMENT_SPAN = /[^]*?(?=-->|($))/g;

// CDATA span
const CDATA_SPAN = /[^]*?(?=\]\]>|($))/g;

// Processing instruction span
const PI_SPAN = /[^]*?(?=\?>|($))/g;

// Tag name span (after < or </)
const TAG_NAME_SPAN = /[A-Za-z_][-A-Za-z0-9._:]*(?=[\s\n/>]|$)/g;
```

---

## File Structure

```
testing/iso/ptf/2026/
├── classes/
│   └── baseline/
│       └── xml-markup-parser.js          # Self-contained XML parser
└── experiments/
    └── tests/
        └── xml-markup-parser.test.js     # Tests
```

Single file (`xml-markup-parser.js`), self-contained like `json-markup-parser.js`. Shared helpers (`sequence`, `join`, `Ranges`) are inlined.

---

## Roadmap

- [x] **Step 1** — Study markup tokenizer architecture (Matcher, TokenMatcher, goals, entities, spans)
- [x] **Step 2** — Study HTML tokenizer (definitions, matcher, mode)
- [x] **Step 3** — Study JSON parser derivation pattern
- [x] **Step 4** — Design XML entity set and span regexes
- [x] **Step 5** — Implement XML parser: dual-matcher (content + tag), goal definitions, span forwarding
- [x] **Step 6** — Implement generator-based event production (`tokenize`, `tokenizeFrom`, `tokenizeFromAsync`)
- [x] **Step 7** — Implement tree builder as event consumer (`collectTree`) — separate from parser core
- [x] **Step 8** — Implement forward scanner for chunk-based streaming (tracks `<`/`>` depth, string/comment/CDATA/PI context)
- [x] **Step 9** — Implement namespace resolution, query/mutation API, serializer
- [x] **Step 10** — Test: 29/29 pass — basic parsing, namespaces, special content, serialization, mutation, XMP round-trip, preflight report, generator API, streaming
- [x] **Step 11** — Replace `DOMParser` in `PDFPreflightFixer.#patchExistingXMP` — validator 25/25 tests pass
- [ ] **Step 12** — Test against XMP metadata from real PDFs (via pdf-lib extraction)
- [ ] **Step 13** — Integrate with Phase 2 streaming validation pipeline

### Consumers

Once built, the XML parser serves multiple purposes:

| Consumer                     | Use Case                                                     |
| ---------------------------- | ------------------------------------------------------------ |
| `PDFPreflightFixer`          | Patch XMP metadata (current `DOMParser` replacement)         |
| Validator streaming pipeline | Parse XMP from deflated streams without full materialization |
| Preflight report analysis    | Parse Acrobat XML reports (currently using regex)            |
| Generator                    | Read/write XMP in output PDFs                                |

---

## Activity Log

### 2026-03-29

- Studied the markup tokenizer architecture: `Matcher extends RegExp`, `TokenMatcher extends Matcher`, goal-based state machine, composed matcher, entity dispatch, span forwarding
- Studied the HTML tokenizer: `html-definitions.js` (7 goals: root, tag, string, comment, PI, CDATA, DOCTYPE), `html-matcher.js` (6 entities: break, whitespace, string, opener, closer, punctuator, fallthrough)
- Studied the JSON parser derivation: 683 lines, inlines `sequence`/`join`/`Ranges`, composes `MATCHER_PATTERN` as a single joined string, entity dispatch via capture group index, value construction via context stack
- Studied `common/helpers.js`: `initializeState`, `finalizeState`, `initializeContext`, `NullGoal`, `generateDefinitions`, `defineSymbol`
- Designed XML entity set (9 entities) and span regexes
- Identified what to keep, remove, and add relative to the HTML tokenizer

### 2026-03-30

- Implemented `xml-markup-parser.js` (classes/baseline/) — ~560 lines, self-contained
- Key design: dual-matcher approach (content matcher for element content, tag matcher for attributes) — avoids NAME/TEXT entity collision that caused the single-matcher approach to eat text content as attribute names
- Content matcher entities: BREAK, WHITESPACE, TAG_OPEN, COMMENT_OPEN, CDATA_OPEN, PI_OPEN, ENTITY_REF, TEXT, FALLTHROUGH
- Tag matcher entities: BREAK, WHITESPACE, TAG_CLOSE, OPERATOR, NAME, FALLTHROUGH
- Span forwarding for: comments (-->), CDATA (]]>), PIs (?>), quoted strings (" or ')
- Exports: parseXML, serializeXML, findElementNS, findAllElementsNS, getTextContent, setTextContent, createElement
- Test: 23/23 pass — quick test script at `experiments/tests/xml-markup-parser-quick.mjs`
- Full node:test suite at `experiments/tests/xml-markup-parser.test.js` (needs PDF-loading test isolated to avoid OOM)
- Integrated into `PDFPreflightFixer.#patchExistingXMP` — replaces `DOMParser`/`XMLSerializer` with `parseXML`/`serializeXML`/`findElementNS`/`setTextContent`/`createElement`
- All 25 validator tests pass with the xml-markup-parser integration
- No browser API dependency — works in both Node.js and browser, ready for worker thread usage
- **REWORKED**: Rewrote parser as proper generator-based architecture following json-markup-parser pattern:
  - `function* tokenize(source)` — yields XMLEvent from complete source (like `parseArrayElements`)
  - `function* tokenizeFrom(lines)` — chunk-based streaming with forward scanner (like `parseFrom`)
  - `async function* tokenizeFromAsync(lines)` — async streaming for ReadableStream composition (like `parseFromAsync`)
  - `collectTree(events)` — separate tree builder consuming events (not baked into parser)
  - `parseXML(source)` — convenience = `collectTree(tokenize(source))`
  - Forward scanner tracks: `<`/`>` depth, tag context, string context, comment/CDATA/PI spans
- 29/29 tests pass (23 original + 6 generator API tests)
