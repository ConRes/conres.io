# Validator Color Space Violation Detection for PDF/X-4

**Created:** 2026-04-08
**Last Updated:** 2026-04-08
**Status:** Phase A Complete
**Branch:** `test-form-generator/2026/dev`
**Parent:** `2026-03-28-VALIDATE-PDF-PROGRESS.md` (Phase 2, Step 19)

---

## Background

### Problem

The validator (MVP, Phase 1) detects structural issues — missing page boxes, bare ICC streams, orphaned OCG layers, missing metadata. It does **not** detect color space violations: content or images using color spaces incompatible with the PDF's output intent.

This matters because:

- A PDF with an RGB output intent that contains `DeviceCMYK` content violates PDF/X-4
- A PDF with a CMYK output intent that contains `DeviceRGB` content violates PDF/X-4
- A PDF with a Gray output intent that contains `DeviceCMYK` or `DeviceRGB` content violates PDF/X-4
- These violations cause Acrobat preflight failures and prepress rejection

The generator is gaining RGB output intent support (separate effort: `2026-04-05-DEVICE-COLOR-HANDLING-PROGRESS.md`). The validator must be able to verify the generator's output is conformant.

### Scope

This work adds **color space violation detection** to `PDFPreflightValidator`. It covers:

1. Extracting the output intent color space from the ICC profile header
2. Scanning document content for Device color space usage (content streams, images, color space resources)
3. Cross-checking document color usage against output intent compatibility rules
4. Reporting violations with specific locations (page, stream, image)

This does **not** cover:

- Fixing violations (that is the generator's job via Device color conversion)
- Streaming async generator validation pipeline (Phase 2, Step 18)
- Full 223-rule implementation (Phase 2, Step 17)
- Transparency blend color space checks (deferred — generator does not use transparency)

### No Overlap with Uncommitted Code

The validator lives in:

- `classes/baseline/pdf-preflight-validator.js` — committed, not in dirty working tree
- `classes/configurations/preflight-rules.json` — uncommitted (modifications), but only the **existing rules** are modified; new rules are additive
- `validator/classes/pdf-preflight-fixer-validator.js` — committed, not modified
- `experiments/tests/pdf-preflight-validator.test.js` — committed

The uncommitted content stream parser, interpreter, and color converter changes are in separate files and do not affect the validator.

---

## Current Validator Architecture

### Class Hierarchy

| Class                        | Location                                             | Role                                                      |
| ---------------------------- | ---------------------------------------------------- | --------------------------------------------------------- |
| `PDFPreflightValidator`      | `classes/baseline/pdf-preflight-validator.js`        | Pure analysis engine — evaluators + rules JSON → findings |
| `PDFPreflightFixer`          | `validator/classes/pdf-preflight-fixer.js`           | Fix operations — applies corrections to PDFDocument       |
| `PDFPreflightFixerValidator` | `validator/classes/pdf-preflight-fixer-validator.js` | Extends validator, composes fixer, two-phase flow         |

### Evaluation Model

Rules are declarative JSON (`preflight-rules.json`). Each rule has:

- `scope`: `document`, `page`, or `object`
- `conditions`: array of `{ property, expected }` pairs
- `logic`: `and`, `or`, or `none`

The validator has a `#evaluators` registry (`Map<string, (target, context) => boolean>`) that maps property keys (like `PAGE::HasTrimBox`, `DOC::HasDocumentID`) to evaluation functions. Rules reference properties; the evaluator returns true/false; the logic operator combines results.

### Current Rules (12 MVP)

| Category           | Rules | Properties                                                                                           |
| ------------------ | ----- | ---------------------------------------------------------------------------------------------------- |
| Page Geometry      | 1     | `PAGE::HasTrimBox`, `PAGE::HasArtBox`                                                                |
| Document Structure | 3     | `DOC::HasDocumentID`, `DOC::LoadSucceeded`, `XOBJECT::HasSubtype`                                    |
| Output Intent      | 1     | `OUTPUTINTENT::ProfileHasN`, `OUTPUTINTENT::ProfileHasAlternate`                                     |
| Optional Content   | 2     | `OCG::AllListedInOCProperties`, `OCCD::HasName`                                                      |
| XMP Metadata       | 4     | `DOC::HasXMPMetadata`, `XMP::HasVersionID`, `XMP::HasGTSPDFXVersion`, `XMP::ProducerMatchesInfoDict` |
| Font               | 1     | `FONT::IsEmbedded`                                                                                   |

### Existing Infrastructure

| Service                   | Available For                     | Location                                                |
| ------------------------- | --------------------------------- | ------------------------------------------------------- |
| ICC header parsing        | Extract output intent color space | `services/ICCService.js` → `parseICCHeaderFromSource()` |
| `#getDestOutputProfile()` | Get ICC stream from OutputIntent  | `pdf-preflight-validator.js:607-621`                    |
| Color space enumeration   | Scan page Resources               | `services/ColorSpaceUtils.js` → `analyzeColorSpaces()`  |
| Content stream parsing    | Identify Device color operators   | `classes/baseline/pdf-content-stream-parser.js`         |
| Object graph traversal    | Find images, XObjects             | `PDFService.js`, existing `#evaluateObjectRule`         |

---

## Decision Table — Color Space Rules

From `experiments/validator/preflight-rules-decision-table.md`, filtered to `relevance: important` + `capability: check`:

### Output Intent Cross-Check Rules

These rules cross-check document color usage against the output intent profile color space.

| Rule       | Display Name                                                    | Condition Pattern                                                          |
| ---------- | --------------------------------------------------------------- | -------------------------------------------------------------------------- |
| **RUL102** | CMYK used but PDF/X OutputIntent not CMYK                       | Document contains DeviceCMYK AND output intent is not CMYK                 |
| **RUL115** | RGB used but PDF/X OutputIntent not RGB                         | Document contains DeviceRGB AND output intent is not RGB                   |
| **RUL84**  | DeviceGray used but OutputIntent not Gray or CMYK               | Document contains DeviceGray AND output intent is neither Gray nor CMYK    |
| **RUL101** | CMYK used for alt. color but OutputIntent not CMYK              | Separation/DeviceN alternate is CMYK AND output intent is not CMYK         |
| **RUL214** | RGB used for alt. color but OutputIntent not RGB                | Separation/DeviceN alternate is RGB AND output intent is not RGB           |
| **RUL67**  | DeviceGray used for alt. color but OutputIntent not Gray        | Separation/DeviceN alternate is Gray AND output intent is not Gray or CMYK |
| **RUL3**   | DeviceN uses CMYK process color space but OutputIntent not CMYK | DeviceN process CS is CMYK AND output intent is not CMYK                   |
| **RUL81**  | DeviceN uses RGB process color space but OutputIntent not RGB   | DeviceN process CS is RGB AND output intent is not RGB                     |
| **RUL62**  | DeviceN uses Gray process color space but OutputIntent not Gray | DeviceN process CS is Gray AND output intent is not Gray or CMYK           |

### Transparency Blend Rules (Deferred)

| Rule   | Display Name                                                     | Notes                                       |
| ------ | ---------------------------------------------------------------- | ------------------------------------------- |
| RUL1   | Transparency blend color space identical to destination          | Generator does not use transparency — defer |
| RUL58  | CMYK used for transparency blend but OutputIntent not CMYK       | Defer                                       |
| RUL66  | DeviceGray used for transparency blend but OutputIntent not Gray | Defer                                       |
| RUL169 | RGB used for transparency blend but OutputIntent not RGB         | Defer                                       |

### Prioritization

**Phase A (this work):** RUL102, RUL115, RUL84 — Device color space vs output intent. These are the rules that catch the generator's RGB output intent violations.

**Phase B (follow-up):** RUL101, RUL214, RUL67, RUL3, RUL81, RUL62 — Separation/DeviceN alternate and process color space violations. The generator does not currently produce DeviceN content, so these are important for third-party PDFs but not blocking.

**Phase C (deferred):** RUL1, RUL58, RUL66, RUL169 — Transparency blend. Generator does not use transparency.

---

## Specification

### New Evaluator Properties

| Property                          | Scope    | Description                                                                         | Implementation                                                                                   |
| --------------------------------- | -------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `OUTPUTINTENT::ProfileColorSpace` | document | ICC color space of the DestOutputProfile (`'CMYK'`, `'RGB'`, `'Gray'`, or `null`)   | Parse ICC header from `#getDestOutputProfile()` stream contents                                  |
| `DOC::HasDeviceCMYK`              | document | Document contains DeviceCMYK color (content streams, images, color space resources) | Scan all pages: Resources/ColorSpace dicts + image XObject ColorSpace + content stream operators |
| `DOC::HasDeviceRGB`               | document | Document contains DeviceRGB color                                                   | Same scan as above                                                                               |
| `DOC::HasDeviceGray`              | document | Document contains DeviceGray color                                                  | Same scan as above                                                                               |

### New Rule Definitions (Phase A)

#### `color-space-cmyk-incompatible-with-output-intent`

```json
{
    "ruleId": "color-space-cmyk-incompatible-with-output-intent",
    "pdfxReference": "RUL102",
    "displayName": "CMYK used but PDF/X OutputIntent not CMYK",
    "description": "DeviceCMYK color spaces or operators found in document content, but the output intent profile is not CMYK. PDF/X-4 requires that Device color spaces match the output intent.",
    "scope": "document",
    "severity": { "default": "error" },
    "conditions": [
        { "property": "OUTPUTINTENT::ProfileColorSpace", "expected": "CMYK" }
    ],
    "guard": { "property": "DOC::HasDeviceCMYK", "expected": true },
    "logic": "and"
}
```

#### `color-space-rgb-incompatible-with-output-intent`

```json
{
    "ruleId": "color-space-rgb-incompatible-with-output-intent",
    "pdfxReference": "RUL115",
    "displayName": "RGB used but PDF/X OutputIntent not RGB",
    "description": "DeviceRGB color spaces or operators found in document content, but the output intent profile is not RGB. PDF/X-4 requires that Device color spaces match the output intent.",
    "scope": "document",
    "severity": { "default": "error" },
    "conditions": [
        { "property": "OUTPUTINTENT::ProfileColorSpace", "expected": "RGB" }
    ],
    "guard": { "property": "DOC::HasDeviceRGB", "expected": true },
    "logic": "and"
}
```

#### `color-space-gray-incompatible-with-output-intent`

```json
{
    "ruleId": "color-space-gray-incompatible-with-output-intent",
    "pdfxReference": "RUL84",
    "displayName": "DeviceGray used but OutputIntent not Gray or CMYK",
    "description": "DeviceGray color spaces or operators found in document content, but the output intent profile is neither Gray nor CMYK. PDF/X-4 permits DeviceGray in CMYK and Gray output intents, but not in RGB-only output intents.",
    "scope": "document",
    "severity": { "default": "error" },
    "conditions": [
        { "property": "OUTPUTINTENT::ProfileColorSpace", "expected": "Gray" },
        { "property": "OUTPUTINTENT::ProfileColorSpace", "expected": "CMYK" }
    ],
    "guard": { "property": "DOC::HasDeviceGray", "expected": true },
    "logic": "or"
}
```

### Guard Conditions

The current rule schema uses `conditions` with `logic` to combine results. The color space rules need a **guard** pattern: the rule should only fire when the document actually contains the color space in question. If a document has no `DeviceCMYK`, RUL102 is not applicable regardless of output intent.

**Options:**

1. **Extend the schema** — add a `guard` field to rule definitions. If the guard evaluates to false, the rule is skipped (not pass, not fail). This is clean and declarative.

2. **Compound evaluators** — create evaluators like `DOC::HasDeviceCMYKAndOutputIntentNotCMYK` that combine both checks. This is simpler but less composable.

3. **New scope `document-guarded`** — same as `document` but first checks a guard condition. Minimal schema change.

**Recommendation:** Option 1 (`guard` field). It keeps the schema declarative and composable. The validator's `#evaluateDocumentRule` checks the guard first; if guard fails → `'skipped'`.

### Document Color Space Scanning

The `DOC::HasDeviceCMYK`, `DOC::HasDeviceRGB`, and `DOC::HasDeviceGray` evaluators need to scan the entire document. This is the most complex part.

**What to scan:**

| Location                         | What to check                                                     | How                                                                |
| -------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------ |
| Page Resources → ColorSpace dict | Direct `DeviceCMYK`/`DeviceRGB`/`DeviceGray` entries              | Enumerate dict values, check for `PDFName` with `/DeviceCMYK` etc. |
| Image XObject → ColorSpace       | Image defined in Device color space                               | Check image dict `ColorSpace` entry                                |
| Content stream operators         | `k`/`K` (DeviceCMYK), `rg`/`RG` (DeviceRGB), `g`/`G` (DeviceGray) | Parse content stream bytes for operator matches                    |
| Form XObject → Resources         | Nested color space usage                                          | Recursive — Form XObjects have their own Resources                 |
| Shading patterns → ColorSpace    | Shading defined in Device color space                             | Check shading dict `ColorSpace` entry                              |
| ExtGState → Font                 | Indirect color space reference (rare)                             | Check ExtGState entries for color-related keys                     |

**Implementation strategy:**

1. **Resource-level scan first** (fast, no decompression) — check ColorSpace dicts, image dicts, shading dicts across all pages and Form XObjects
2. **Content stream scan only if resource scan is inconclusive** — Device colors used via implicit operators (`k`/`K`, `rg`/`RG`, `g`/`G`) do not appear in Resources. These operators implicitly set both the color space and color values.

The resource scan alone catches most cases because:

- Images always declare their ColorSpace in the image dict
- Named color spaces (`CS`/`cs` operators) reference Resources/ColorSpace entries
- Only the implicit Device operators (`k`/`K`, `rg`/`RG`, `g`/`G`) bypass Resources

For content stream scanning, we do NOT need full tokenization — a simple byte-level regex scan for the operator patterns is sufficient. The operator must appear at a word boundary preceded by numeric operands. We can reuse `OPERATOR_PATTERN` from `pdf-content-stream-parser.js`, or use a simpler pattern since we only need presence/absence, not values.

**Caching:**

The three evaluators (`HasDeviceCMYK`, `HasDeviceRGB`, `HasDeviceGray`) should share a single scan pass. Run the scan once, cache all three results. Use a `#colorSpaceScanCache` field on the validator instance.

### ICC Header Parsing

The `OUTPUTINTENT::ProfileColorSpace` evaluator needs to:

1. Get the DestOutputProfile stream via existing `#getDestOutputProfile()`
2. Get the stream contents (raw bytes)
3. Parse the ICC header — the color space field is at bytes 16-19 of the ICC header

The ICC header color space field values:

| Bytes 16-19 (ASCII) | Color Space |
| ------------------- | ----------- |
| `'CMYK'`            | CMYK        |
| `'RGB '`            | RGB         |
| `'GRAY'`            | Gray        |
| `'Lab '`            | Lab         |

This is a 4-byte read at a fixed offset. No dependency on `ICCService` is required — the evaluator can read the bytes directly. However, if `ICCService` is already imported, `parseICCHeaderFromSource()` provides a more robust parse with validation.

**Decision:** Use direct byte read (4 bytes at offset 16) after decompression. Added `pako.inflate` import for FlateDecode decompression. The ICC color space signature is a stable, well-defined format.

---

## Roadmap

### Phase A: Device Color vs Output Intent (Priority)

- [x] **A.1** Extend `#registerEvaluators()` with `OUTPUTINTENT::ProfileColorSpace` — read ICC header bytes 16-19 from DestOutputProfile stream
- [x] **A.2** Implement `#scanDocumentColorSpaces()` — single-pass scan of all pages for Device color space usage, cached on instance
- [x] **A.3** Register `DOC::HasDeviceCMYK`, `DOC::HasDeviceRGB`, `DOC::HasDeviceGray` evaluators using cached scan
- [x] **A.4** Add `guard` support to `#evaluateDocumentRule()` — if guard property fails, finding is `'skipped'`
- [x] **A.5** Add 3 rules to `preflight-rules.json` (RUL102, RUL115, RUL84) in a new `color-space-compatibility` category
- [x] **A.6** Write tests — 15 tests, all pass:
  - RGB output intent + DeviceCMYK content stream → RUL102 fail ✓
  - RGB output intent + DeviceCMYK image → RUL102 fail ✓
  - CMYK output intent + DeviceCMYK content → RUL102 pass ✓
  - CMYK output intent + no DeviceCMYK → RUL102 skipped (guard) ✓
  - CMYK output intent + DeviceRGB content stream → RUL115 fail ✓
  - CMYK output intent + DeviceRGB image → RUL115 fail ✓
  - RGB output intent + DeviceRGB content → RUL115 pass ✓
  - RGB output intent + no DeviceRGB → RUL115 skipped (guard) ✓
  - RGB output intent + DeviceGray content → RUL84 fail ✓
  - CMYK output intent + DeviceGray content → RUL84 pass (Gray permitted in CMYK) ✓
  - Gray output intent + DeviceGray content → RUL84 pass ✓
  - RGB output intent + no DeviceGray → RUL84 skipped (guard) ✓
  - No output intent + all Device colors → all 3 fail (no matching intent) ✓
  - RGB output intent + mixed content → CMYK fail, RGB pass, Gray fail ✓
  - CMYK output intent + mixed content → CMYK pass, RGB fail, Gray pass ✓
- [x] **A.7** Run existing tests — 25/25 pass, 0 regressions (validator 11, fixer 9, fixer-validator 5)
- [x] **A.8** Test against validation suite and 2025 fixture PDFs — correct behavior confirmed

### Phase B: Separation/DeviceN (Follow-up)

- [ ] **B.1** Add evaluators for Separation/DeviceN alternate color space scanning
- [ ] **B.2** Add 6 rules (RUL101, RUL214, RUL67, RUL3, RUL81, RUL62)
- [ ] **B.3** Write tests with DeviceN test PDFs

### Phase C: Transparency Blend (Deferred)

- [ ] **C.1** Add transparency blend color space detection
- [ ] **C.2** Add 4 rules (RUL1, RUL58, RUL66, RUL169)

---

## Implementation Notes

### Content Stream Scanning for Presence Detection

For the validator, we need presence/absence only — not values, not positions, not conversion. A minimal scan is sufficient:

```javascript
// Byte-level scan for Device color operators in decompressed content stream
const DEVICE_CMYK_PATTERN = /(?:^|[\s\n])[-.\d]+\s+[-.\d]+\s+[-.\d]+\s+[-.\d]+\s+[kK]\b/;
const DEVICE_RGB_PATTERN = /(?:^|[\s\n])[-.\d]+\s+[-.\d]+\s+[-.\d]+\s+(?:rg|RG)\b/;
const DEVICE_GRAY_PATTERN = /(?:^|[\s\n])[-.\d]+\s+[gG]\b/;
```

We test these against the decompressed Latin-1 string of each content stream. For the validator, we decompress streams one at a time (not all at once) to bound memory.

**Optimization:** Check Resources/ColorSpace dicts and image dicts first (fast, no decompression), and only decompress content streams if the resource scan does not find the Device color space we're looking for.

### Decompression Requirement

**Discovered during implementation:** Both content streams and ICC profile streams are FlateDecode-compressed. `PDFRawStream.getContents()` returns **raw compressed bytes**, not decompressed content. This requires:

1. Checking the `/Filter` entry on the stream dict
2. If `/FlateDecode`, using `pako.inflate()` (zlib-wrapped, not raw deflate)
3. pdf-lib's `context.flateStream()` uses standard zlib with `78 9c` header — `inflateRaw` fails, `inflate` works

Added `import { inflate } from '../../packages/pako/dist/pako.mjs'` to the validator. This is the only new import.

**ICC profile detection:** Bytes 16-19 of the **decompressed** ICC profile contain the color space signature (`'CMYK'`, `'RGB '`, `'GRAY'`, `'Lab '`). Without decompression, these bytes are meaningless compressed data.

### RUL84 Special Case: DeviceGray in CMYK

PDF/X-4 permits `DeviceGray` in both Gray and CMYK output intents (DeviceGray maps to K-only in CMYK). The rule fires only when the output intent is neither Gray nor CMYK — which means it fires for RGB output intents.

This is correct: `DeviceGray` in an RGB output intent is a violation. The generator must convert `DeviceGray` to `DeviceRGB` when the output intent is RGB.

### Schema Extension: `guard` Field

The `guard` field is a single condition object `{ property, expected }`. It is evaluated before the main conditions. If the guard evaluates to `!expected`, the rule is skipped entirely.

For the `conditions` array, the `expected` field currently only supports `boolean`. The color space rules need string comparison (`expected: "CMYK"`). The evaluator for `OUTPUTINTENT::ProfileColorSpace` should return a string, and the condition evaluation should support string equality.

**Schema change:** Extend `RuleCondition.expected` type from `boolean` to `boolean | string`. The `#evaluateDocumentRule` comparison changes from `result === cond.expected` to `result === cond.expected` (already works — JavaScript `===` handles both types).

The evaluator return type changes from `boolean` to `boolean | string`. The `OUTPUTINTENT::ProfileColorSpace` evaluator returns the string `'CMYK'`, `'RGB'`, `'Gray'`, or `null`.

The condition matching logic:

- `{ property: "OUTPUTINTENT::ProfileColorSpace", expected: "CMYK" }` → evaluator returns `'CMYK'` → `'CMYK' === 'CMYK'` → `true` → condition passes
- Evaluator returns `'RGB'` → `'RGB' === 'CMYK'` → `false` → condition fails

This works without code changes because `===` already handles string comparison. The only change is the typedef documentation.

### Test PDF Construction

Test PDFs should be built with `pdf-lib` low-level APIs (same approach as `experiments/validator/pdf-lib-validation-suite/`). Each test PDF needs:

1. An OutputIntent dict with a DestOutputProfile ICC stream (use actual sRGB or eciCMYK profile bytes from `testing/iso/ptf/2026/resources/profiles/`)
2. A page with content stream containing Device color operators
3. Optionally, an image XObject with Device color space

Keep PDFs minimal (one page, one stream, one image at most). The validator test PDF set is separate from the generator's test fixtures (`2026-04-08-TEST-FIXTURES-PLAN.md`).

---

## Dependencies

| Dependency                        | Status                                                                      | Notes                                                                        |
| --------------------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `PDFPreflightValidator` (MVP)     | Complete                                                                    | Base class, evaluator registry, rule evaluation                              |
| `preflight-rules.json` schema     | Complete                                                                    | Adding new category and rules (additive)                                     |
| ICC profile files                 | Available                                                                   | `testing/iso/ptf/2026/resources/profiles/` — sRGB, eciCMYK, sGray            |
| pdf-lib                           | Available                                                                   | `packages/pdf-lib/pdf-lib.esm.js` — for test PDF construction and validation |
| pako (inflate)                    | Available                                                                   | `packages/pako/dist/pako.mjs` — sync FlateDecode decompression for streams   |
| Content stream parser             | **Not required** — presence detection uses simple regex, not full tokenizer |                                                                              |
| Generator Device color conversion | **Independent** — validator detects, generator fixes                        | Separate progress doc                                                        |

---

## Activity Log

### 2026-04-08

- Created progress document
- Reviewed existing validator architecture (`pdf-preflight-validator.js`: 622 lines, 12 rules, 16 evaluators)
- Reviewed decision table: identified 9 color space rules at `important` relevance, 4 transparency rules (deferred)
- Prioritized Phase A (3 rules: RUL102, RUL115, RUL84) — covers generator RGB output intent validation
- Designed evaluator properties, guard conditions, document scanning strategy
- Confirmed no overlap with uncommitted content stream parser changes

**Phase A implementation:**

- Extended `RuleCondition.expected` typedef to `boolean | string` for string-valued evaluator results
- Added `guard?: RuleCondition` to `RuleDefinition` typedef
- Added `#colorSpaceScanCache` field for single-pass document scanning
- Implemented `#evaluateDocumentRule` guard logic — skips rule if guard condition not met
- Implemented `OUTPUTINTENT::ProfileColorSpace` evaluator — reads ICC header bytes 16-19 after FlateDecode decompression
- Implemented `#scanDocumentColorSpaces()` — two-tier scan: (1) Resources/ColorSpace dicts + image XObjects, (2) content stream operators as fallback
- Implemented `#scanPageContentStreams()` — decompresses FlateDecode streams with `pako.inflate`, Latin-1 decode, regex scan
- Implemented `#scanTextForDeviceOperators()` — three regexes for k/K, rg/RG, g/G operators
- Registered `DOC::HasDeviceCMYK`, `DOC::HasDeviceRGB`, `DOC::HasDeviceGray` evaluators using cached scan
- Added `color-space-compatibility` category with 3 rules to `preflight-rules.json`
- Added `import { inflate } from '../../packages/pako/dist/pako.mjs'` — only new import

**Bugs found during implementation:**

1. **`inflateRaw` fails on pdf-lib FlateDecode streams** — pdf-lib's `context.flateStream()` uses standard zlib with `78 9c` header, not raw deflate. Fixed by using `inflate` instead of `inflateRaw`.
2. **ICC profile stream also FlateDecode-compressed** — `getContents()` returns compressed bytes. ICC header bytes 16-19 are meaningless until decompressed. Added decompression to the `OUTPUTINTENT::ProfileColorSpace` evaluator.

**Test results:**

| Test file | Tests | Pass | Fail |
| --- | --- | --- | --- |
| `tests/classes/pdf-preflight-validator-color-space.test.js` (new) | 15 | 15 | 0 |
| `experiments/tests/pdf-preflight-validator.test.js` (existing) | 11 | 11 | 0 |
| `experiments/tests/pdf-preflight-fixer.test.js` (existing) | 9 | 9 | 0 |
| `experiments/tests/pdf-preflight-fixer-validator.test.js` (existing) | 5 | 5 | 0 |
| **Total** | **40** | **40** | **0** |

**Files changed:**

| File | Change |
| --- | --- |
| `classes/baseline/pdf-preflight-validator.js` | +1 import, +4 evaluators, guard logic, scanner (~180 lines added) |
| `classes/configurations/preflight-rules.json` | +1 category, +3 rules (additive, no existing rules modified) |
| `tests/classes/pdf-preflight-validator-color-space.test.js` | New test file (15 tests) |
| `progress/2026-04-08-VALIDATOR-COLOR-SPACE-VIOLATIONS-PROGRESS.md` | Updated with implementation details |

**Validation against real PDFs:**

- Validation suite PDFs (minimal, no Device content) → all 3 rules skipped (guard correctly not met)
- 2025 fixture PDF (no output intent, has DeviceCMYK content) → RUL102 fail (correct — no CMYK intent to validate the CMYK content)
- Generator output PDFs not available locally for testing (generated in-browser) — will be tested during RGB output intent integration
