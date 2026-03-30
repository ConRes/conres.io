# PDF Validator MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a working PDF validator that detects and fixes the structural issues in 2026/generator output PDFs, testable with real generator output and 2025 legacy PDFs.

**Architecture:** Three-class hierarchy — `PDFPreflightValidator` (baseline check engine in `classes/baseline/`), `PDFPreflightFixer` (fix operations in `validator/classes/`), `PDFPreflightFixerValidator` (extends validator, composes fixer, in `validator/classes/`). Declarative rules in `preflight-rules.json`. Browser UI at `2026/validator/` with worker thread execution.

**Tech Stack:** pdf-lib (vendored), node:test + Playwright for testing, vanilla JS custom elements for UI.

**Key References:**
- Design spec: `testing/iso/ptf/2026/docs/specs/2026-03-29-pdf-validator-design.md`
- Progress tracker: `testing/iso/ptf/2026/2026-03-28-VALIDATE-PDF-PROGRESS.md`
- Decision table: `testing/iso/ptf/2026/experiments/validator/preflight-rules-decision-table.md`
- Existing fix implementations (proven): `testing/iso/ptf/2026/experiments/validator/create-compatibility-test.mjs`
- Generator UI pattern to follow: `testing/iso/ptf/2026/generator/index.html`, `generator/generator.js`, `generator/elements/test-form-generator-app-element.js`
- Test pattern to follow: `testing/iso/ptf/2026/experiments/tests/compression-streams-api.test.js`, `testing/iso/ptf/2026/tests/classes/*.test.js`
- pdf-lib validation suite (26 test PDFs + Acrobat reports): `testing/iso/ptf/2026/experiments/validator/pdf-lib-validation-suite/`
- Acrobat observations: `testing/iso/ptf/2026/experiments/validator/pdf-lib-validation-suite/ACROBAT-OBSERVATIONS.md`

**Important constraints:**
- All paths below are relative to `testing/iso/ptf/2026/` unless otherwise noted
- Tests go in `experiments/tests/` (NOT in the package `tests/` directory — these are development experiments, not package tests)
- Follow existing JSDoc patterns, `// @ts-check`, `@author` + `@ai` tags per `~/.claude/CLAUDE.md`
- pdf-lib is at `packages/pdf-lib/pdf-lib.esm.js` — import via importmap alias `'pdf-lib'` in browser, relative path in Node scripts
- Do NOT modify `classes/baseline/*.js` converter classes (out of scope — those are the color conversion pipeline)
- Do NOT modify files related to the Compression Streams API adoption or the legacy compatibility investigation

---

### Task 1: Create `preflight-rules.json` (MVP Rules Only)

**Files:**
- Create: `classes/configurations/preflight-rules.json`

- [ ] **Step 1: Create the rules JSON with all 8 MVP rules**

```json
{
  "schemaVersion": "1.0",
  "profile": "pdf-x-4",
  "categories": [
    {
      "categoryId": "page-geometry",
      "displayName": "Page Geometry",
      "description": "Page box definitions required for prepress workflows.",
      "rules": [
        {
          "ruleId": "page-missing-trimbox-or-artbox",
          "pdfxReference": "RUL122",
          "displayName": "Page does not have TrimBox or ArtBox",
          "description": "Either ArtBox or TrimBox should be defined for pages used in prepress. PDF/X ISO standards require the presence of one of these boxes.",
          "scope": "page",
          "severity": { "default": "error" },
          "conditions": [
            { "property": "PAGE::HasTrimBox", "expected": true },
            { "property": "PAGE::HasArtBox", "expected": true }
          ],
          "logic": "or",
          "fixId": "set-geometry-from-mediabox"
        }
      ]
    },
    {
      "categoryId": "document-structure",
      "displayName": "Document Structure",
      "description": "Required document-level entries and structural integrity.",
      "rules": [
        {
          "ruleId": "document-id-missing",
          "pdfxReference": "RUL127",
          "displayName": "Document ID missing",
          "description": "The Document ID in a PDF document is required by PDF/X standards. It consists of two hex strings in the file trailer.",
          "scope": "document",
          "severity": { "default": "error" },
          "conditions": [
            { "property": "DOC::HasDocumentID", "expected": true }
          ],
          "logic": "and",
          "fixId": "add-document-id"
        },
        {
          "ruleId": "xobject-missing-subtype",
          "pdfxReference": "RUL92",
          "displayName": "XObject missing required Subtype entry",
          "description": "An XObject stream is missing its required Subtype entry. This causes Adobe Acrobat to crash with an unrecoverable error (error 18).",
          "scope": "object",
          "severity": { "default": "error" },
          "conditions": [
            { "property": "XOBJECT::HasSubtype", "expected": true }
          ],
          "logic": "and"
        },
        {
          "ruleId": "document-damaged",
          "pdfxReference": "RUL113",
          "displayName": "Document is damaged and could not be loaded",
          "description": "The PDF file could not be parsed. It may be truncated, corrupted, or not a valid PDF file.",
          "scope": "document",
          "severity": { "default": "error" },
          "conditions": [
            { "property": "DOC::LoadSucceeded", "expected": true }
          ],
          "logic": "and"
        }
      ]
    },
    {
      "categoryId": "output-intent",
      "displayName": "Output Intent",
      "description": "PDF/X output intent and ICC profile configuration.",
      "rules": [
        {
          "ruleId": "output-intent-profile-bare-stream",
          "pdfxReference": "RUL208",
          "displayName": "Output intent ICC profile stream missing required attributes",
          "description": "The DestOutputProfile ICC stream should have /N (number of color components), /Alternate (fallback device color space), and ideally /Filter /FlateDecode for compression. Missing attributes may cause compatibility issues with older PDF readers.",
          "scope": "document",
          "severity": { "default": "warning" },
          "conditions": [
            { "property": "OUTPUTINTENT::ProfileHasN", "expected": true },
            { "property": "OUTPUTINTENT::ProfileHasAlternate", "expected": true }
          ],
          "logic": "and",
          "fixId": "fix-output-intent-profile"
        }
      ]
    },
    {
      "categoryId": "optional-content",
      "displayName": "Optional Content (Layers)",
      "description": "Optional content group structure and registration.",
      "rules": [
        {
          "ruleId": "ocg-not-in-ocproperties",
          "pdfxReference": "RUL131",
          "displayName": "Layer (OCG) not listed in document's OCProperties",
          "description": "The PDF specification requires that a layer must be defined in the document's layer dictionary (OCProperties) in order to be displayed in a viewer.",
          "scope": "document",
          "severity": { "default": "error" },
          "conditions": [
            { "property": "OCG::AllListedInOCProperties", "expected": true }
          ],
          "logic": "and",
          "fixId": "strip-orphaned-ocg"
        },
        {
          "ruleId": "occd-missing-name",
          "pdfxReference": "RUL106",
          "displayName": "Optional content configuration dictionary has no Name entry",
          "description": "PDF/X-4 requires that each optional content configuration dictionary (OCCD) has a Name entry which is unique throughout the PDF.",
          "scope": "document",
          "severity": { "default": "error" },
          "conditions": [
            { "property": "OCCD::HasName", "expected": true }
          ],
          "logic": "and",
          "fixId": "add-occd-name"
        }
      ]
    },
    {
      "categoryId": "xmp-metadata",
      "displayName": "XMP Metadata",
      "description": "XMP metadata presence and PDF/X conformance entries.",
      "rules": [
        {
          "ruleId": "metadata-missing-xmp",
          "pdfxReference": "RUL54",
          "displayName": "Metadata missing (XMP)",
          "description": "PDF/X standards require the presence of XMP metadata in the document catalog.",
          "scope": "document",
          "severity": { "default": "error" },
          "conditions": [
            { "property": "DOC::HasXMPMetadata", "expected": true }
          ],
          "logic": "and",
          "fixId": "generate-minimal-xmp"
        }
      ]
    }
  ],
  "fixes": {
    "set-geometry-from-mediabox": {
      "displayName": "Set page boxes from MediaBox",
      "description": "Sets TrimBox, BleedBox, and CropBox to the page's MediaBox values.",
      "strategy": "copy-from-mediabox",
      "targets": ["TrimBox", "BleedBox", "CropBox"]
    },
    "add-document-id": {
      "displayName": "Add Document ID",
      "description": "Generates a random 16-byte hex string pair and sets it as the document ID in the trailer.",
      "strategy": "generate-random-id"
    },
    "fix-output-intent-profile": {
      "displayName": "Fix output intent ICC profile attributes",
      "description": "Adds /N (color components), /Alternate (device color space), and /Filter /FlateDecode to the DestOutputProfile stream. The color component count and alternate space are determined from the ICC profile header.",
      "strategy": "fix-icc-stream-attributes"
    },
    "strip-orphaned-ocg": {
      "displayName": "Remove unregistered OCG layers",
      "description": "Removes OCG references from page content and Form XObjects that are not listed in the document's OCProperties dictionary.",
      "strategy": "strip-unregistered-ocg"
    },
    "add-occd-name": {
      "displayName": "Add Name to OCCD",
      "description": "Adds a Name entry to the default optional content configuration dictionary.",
      "strategy": "add-occd-name-entry"
    },
    "generate-minimal-xmp": {
      "displayName": "Generate minimal XMP metadata",
      "description": "Creates a minimal XMP metadata stream with required entries from the document's Info dictionary.",
      "strategy": "generate-xmp-from-info-dict"
    }
  }
}
```

- [ ] **Step 2: Verify JSON is valid**

Run: `node -e "JSON.parse(require('fs').readFileSync('classes/configurations/preflight-rules.json', 'utf-8')); console.log('Valid JSON')"`
Expected: `Valid JSON`

- [ ] **Step 3: Commit**

```bash
git add classes/configurations/preflight-rules.json
git commit -m "feat(validator): add MVP preflight-rules.json with 8 rules and 6 fixes"
```

---

### Task 2: Implement `PDFPreflightValidator`

**Files:**
- Create: `classes/baseline/pdf-preflight-validator.js`
- Create: `experiments/tests/pdf-preflight-validator.test.js`

- [ ] **Step 1: Write the test file**

The test uses the pdf-lib validation suite PDFs (already exist at `experiments/validator/pdf-lib-validation-suite/`). Each test loads a specific malformed PDF and verifies the validator produces the expected finding.

```javascript
// @ts-check
/**
 * PDFPreflightValidator Tests
 *
 * Tests the base validation engine against the pdf-lib validation suite —
 * intentionally malformed PDFs with known defects.
 *
 * @module pdf-preflight-validator.test
 * @author Saleh Abdel Motaal <dev@smotaal.io>
 * @ai Claude Opus 4.6 (code generation)
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert';
import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SUITE_DIR = join(__dirname, '..', 'validator', 'pdf-lib-validation-suite');
const RULES_PATH = join(__dirname, '..', '..', 'classes', 'configurations', 'preflight-rules.json');

/** @type {typeof import('../../classes/baseline/pdf-preflight-validator.js').PDFPreflightValidator} */
let PDFPreflightValidator;
/** @type {typeof import('pdf-lib')} */
let pdfLib;
/** @type {object} */
let rules;

describe('PDFPreflightValidator', () => {
    before(async () => {
        pdfLib = await import('../../packages/pdf-lib/pdf-lib.esm.js');
        const mod = await import('../../classes/baseline/pdf-preflight-validator.js');
        PDFPreflightValidator = mod.PDFPreflightValidator;
        rules = JSON.parse(await readFile(RULES_PATH, 'utf-8'));
    });

    describe('Page Geometry', () => {
        test('detects missing TrimBox', async () => {
            const bytes = await readFile(join(SUITE_DIR, 'pg-01-no-trimbox.pdf'));
            const doc = await pdfLib.PDFDocument.load(bytes, { updateMetadata: false });
            const validator = new PDFPreflightValidator(doc, rules);
            const report = validator.validate();
            const finding = report.findings.find(f => f.ruleId === 'page-missing-trimbox-or-artbox');
            assert.ok(finding, 'Should find page-missing-trimbox-or-artbox');
            assert.strictEqual(finding.status, 'fail');
            assert.strictEqual(finding.scope, 'page');
        });

        test('passes when TrimBox is present', async () => {
            const bytes = await readFile(join(SUITE_DIR, 'pg-02-both-trimbox-artbox.pdf'));
            const doc = await pdfLib.PDFDocument.load(bytes, { updateMetadata: false });
            const validator = new PDFPreflightValidator(doc, rules);
            const report = validator.validate();
            const finding = report.findings.find(f => f.ruleId === 'page-missing-trimbox-or-artbox');
            assert.ok(finding, 'Should still have a finding entry');
            assert.strictEqual(finding.status, 'pass');
        });
    });

    describe('Document Structure', () => {
        test('detects missing Document ID', async () => {
            const bytes = await readFile(join(SUITE_DIR, 'ds-01-no-doc-id.pdf'));
            const doc = await pdfLib.PDFDocument.load(bytes, { updateMetadata: false });
            const validator = new PDFPreflightValidator(doc, rules);
            const report = validator.validate();
            const finding = report.findings.find(f => f.ruleId === 'document-id-missing');
            assert.ok(finding);
            assert.strictEqual(finding.status, 'fail');
        });

        test('detects XObject missing Subtype', async () => {
            const bytes = await readFile(join(SUITE_DIR, 'fx-02-no-subtype.pdf'));
            const doc = await pdfLib.PDFDocument.load(bytes, { updateMetadata: false });
            const validator = new PDFPreflightValidator(doc, rules);
            const report = validator.validate();
            const finding = report.findings.find(f => f.ruleId === 'xobject-missing-subtype');
            assert.ok(finding);
            assert.strictEqual(finding.status, 'fail');
        });

        test('detects damaged PDF via load failure', async () => {
            const validator = PDFPreflightValidator.fromLoadError(
                new Error('Failed to parse PDF document'),
                rules
            );
            const report = validator.validate();
            const finding = report.findings.find(f => f.ruleId === 'document-damaged');
            assert.ok(finding);
            assert.strictEqual(finding.status, 'fail');
        });
    });

    describe('Output Intent', () => {
        test('detects bare ICC profile stream', async () => {
            const bytes = await readFile(join(SUITE_DIR, 'oi-02-bare-icc-stream.pdf'));
            const doc = await pdfLib.PDFDocument.load(bytes, { updateMetadata: false });
            const validator = new PDFPreflightValidator(doc, rules);
            const report = validator.validate();
            const finding = report.findings.find(f => f.ruleId === 'output-intent-profile-bare-stream');
            assert.ok(finding);
            assert.strictEqual(finding.status, 'fail');
        });

        test('passes with proper ICC profile stream', async () => {
            const bytes = await readFile(join(SUITE_DIR, 'oi-03-proper-icc-stream.pdf'));
            const doc = await pdfLib.PDFDocument.load(bytes, { updateMetadata: false });
            const validator = new PDFPreflightValidator(doc, rules);
            const report = validator.validate();
            const finding = report.findings.find(f => f.ruleId === 'output-intent-profile-bare-stream');
            // May be skipped if no output intent, or pass if proper
            if (finding) {
                assert.notStrictEqual(finding.status, 'fail');
            }
        });
    });

    describe('Optional Content', () => {
        test('detects OCCD missing Name', async () => {
            const bytes = await readFile(join(SUITE_DIR, 'oc-02-occd-no-name.pdf'));
            const doc = await pdfLib.PDFDocument.load(bytes, { updateMetadata: false });
            const validator = new PDFPreflightValidator(doc, rules);
            const report = validator.validate();
            const finding = report.findings.find(f => f.ruleId === 'occd-missing-name');
            assert.ok(finding);
            assert.strictEqual(finding.status, 'fail');
        });
    });

    describe('XMP Metadata', () => {
        test('detects missing XMP metadata', async () => {
            const bytes = await readFile(join(SUITE_DIR, 'xm-01-no-xmp.pdf'));
            const doc = await pdfLib.PDFDocument.load(bytes, { updateMetadata: false });
            const validator = new PDFPreflightValidator(doc, rules);
            const report = validator.validate();
            const finding = report.findings.find(f => f.ruleId === 'metadata-missing-xmp');
            assert.ok(finding);
            assert.strictEqual(finding.status, 'fail');
        });

        test('passes when XMP metadata is present', async () => {
            const bytes = await readFile(join(SUITE_DIR, 'xm-02-xmp-present.pdf'));
            const doc = await pdfLib.PDFDocument.load(bytes, { updateMetadata: false });
            const validator = new PDFPreflightValidator(doc, rules);
            const report = validator.validate();
            const finding = report.findings.find(f => f.ruleId === 'metadata-missing-xmp');
            assert.ok(finding);
            assert.strictEqual(finding.status, 'pass');
        });
    });

    describe('Report structure', () => {
        test('report has documentInfo, findings, and summary', async () => {
            const bytes = await readFile(join(SUITE_DIR, 'pg-01-no-trimbox.pdf'));
            const doc = await pdfLib.PDFDocument.load(bytes, { updateMetadata: false });
            const validator = new PDFPreflightValidator(doc, rules);
            const report = validator.validate();
            assert.ok(report.documentInfo);
            assert.ok(report.documentInfo.pageCount >= 1);
            assert.ok(Array.isArray(report.findings));
            assert.ok(report.summary);
            assert.ok(typeof report.summary.errors === 'number');
            assert.ok(typeof report.summary.warnings === 'number');
            assert.ok(typeof report.summary.passed === 'number');
        });
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd testing/iso/ptf/2026 && node --test experiments/tests/pdf-preflight-validator.test.js`
Expected: FAIL — module `classes/baseline/pdf-preflight-validator.js` not found

- [ ] **Step 3: Implement `PDFPreflightValidator`**

Create `classes/baseline/pdf-preflight-validator.js`. The class:

1. Constructor takes `(pdfDocument, rulesConfig)` — stores both, builds the property evaluator registry
2. `validate()` — iterates rules by scope, evaluates conditions, produces the report
3. Static `fromLoadError(error, rulesConfig)` — creates a validator for a failed load (only the `document-damaged` rule fires)
4. Property evaluators are a `Map<string, (target, context) => boolean>` registered in the constructor

The property evaluators for MVP rules:
- `PAGE::HasTrimBox` — `pageNode.lookup(PDFName.of('TrimBox')) !== undefined`
- `PAGE::HasArtBox` — `pageNode.lookup(PDFName.of('ArtBox')) !== undefined`
- `DOC::HasDocumentID` — `!!doc.context.trailerInfo.ID`
- `XOBJECT::HasSubtype` — for each XObject stream, check `dict.get(PDFName.of('Subtype'))`
- `DOC::LoadSucceeded` — always true for normal instances, false for `fromLoadError`
- `OUTPUTINTENT::ProfileHasN` — find DestOutputProfile stream, check for `/N`
- `OUTPUTINTENT::ProfileHasAlternate` — same stream, check for `/Alternate`
- `OCG::AllListedInOCProperties` — enumerate OCG refs in content, compare with OCProperties/OCGs array
- `OCCD::HasName` — check OCProperties/D dict for `/Name` entry
- `DOC::HasXMPMetadata` — `doc.catalog.get(PDFName.of('Metadata'))` exists

The implementation must import from `pdf-lib` using a relative path (`../../packages/pdf-lib/pdf-lib.esm.js`) since this is a baseline class, not a browser module.

See the design spec Section 4 for the finding and report structures. Each finding includes: `ruleId`, `status`, `severity`, `scope`, `location`, `fixId` (if defined on the rule), and `details` (rule-specific context for the UI).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd testing/iso/ptf/2026 && node --test experiments/tests/pdf-preflight-validator.test.js`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add classes/baseline/pdf-preflight-validator.js experiments/tests/pdf-preflight-validator.test.js
git commit -m "feat(validator): implement PDFPreflightValidator with 8 MVP rules"
```

---

### Task 3: Implement `PDFPreflightFixer`

**Files:**
- Create: `validator/classes/pdf-preflight-fixer.js`
- Create: `experiments/tests/pdf-preflight-fixer.test.js`

- [ ] **Step 1: Write the test file**

Tests load a malformed PDF, apply a specific fix, then verify the structural change using the same inspection techniques from `experiments/validator/verify-variants.mjs`.

```javascript
// @ts-check
/**
 * PDFPreflightFixer Tests
 *
 * Tests each fix operation independently: apply fix, verify structural change,
 * save and reload to confirm persistence.
 *
 * @module pdf-preflight-fixer.test
 * @author Saleh Abdel Motaal <dev@smotaal.io>
 * @ai Claude Opus 4.6 (code generation)
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert';
import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SUITE_DIR = join(__dirname, '..', 'validator', 'pdf-lib-validation-suite');

/** @type {typeof import('../../validator/classes/pdf-preflight-fixer.js').PDFPreflightFixer} */
let PDFPreflightFixer;
/** @type {typeof import('pdf-lib')} */
let pdfLib;

describe('PDFPreflightFixer', () => {
    before(async () => {
        pdfLib = await import('../../packages/pdf-lib/pdf-lib.esm.js');
        const mod = await import('../../validator/classes/pdf-preflight-fixer.js');
        PDFPreflightFixer = mod.PDFPreflightFixer;
    });

    test('set-geometry-from-mediabox adds TrimBox, BleedBox, CropBox', async () => {
        const bytes = await readFile(join(SUITE_DIR, 'pg-01-no-trimbox.pdf'));
        const doc = await pdfLib.PDFDocument.load(bytes, { updateMetadata: false });
        const fixer = new PDFPreflightFixer(doc);
        const changelog = fixer.applyFix('set-geometry-from-mediabox');
        assert.ok(changelog.length > 0, 'Should have changelog entries');

        const page = doc.getPages()[0].node;
        assert.ok(page.get(pdfLib.PDFName.of('TrimBox')), 'TrimBox should exist');
        assert.ok(page.get(pdfLib.PDFName.of('BleedBox')), 'BleedBox should exist');
        assert.ok(page.get(pdfLib.PDFName.of('CropBox')), 'CropBox should exist');
    });

    test('add-document-id adds ID to trailer', async () => {
        const bytes = await readFile(join(SUITE_DIR, 'ds-01-no-doc-id.pdf'));
        const doc = await pdfLib.PDFDocument.load(bytes, { updateMetadata: false });
        assert.ok(!doc.context.trailerInfo.ID, 'Should start without ID');

        const fixer = new PDFPreflightFixer(doc);
        fixer.applyFix('add-document-id');
        assert.ok(doc.context.trailerInfo.ID, 'Should have ID after fix');
    });

    test('fix-output-intent-profile adds N and Alternate', async () => {
        const bytes = await readFile(join(SUITE_DIR, 'oi-02-bare-icc-stream.pdf'));
        const doc = await pdfLib.PDFDocument.load(bytes, { updateMetadata: false });
        const fixer = new PDFPreflightFixer(doc);
        const changelog = fixer.applyFix('fix-output-intent-profile');

        // Verify the profile now has /N and /Alternate
        const outputIntents = doc.catalog.lookup(pdfLib.PDFName.of('OutputIntents'));
        const intent = outputIntents.lookup(0);
        const profileRef = intent.get(pdfLib.PDFName.of('DestOutputProfile'));
        const profile = doc.context.lookup(profileRef);
        assert.ok(profile.dict.get(pdfLib.PDFName.of('N')), 'Should have /N');
        assert.ok(profile.dict.get(pdfLib.PDFName.of('Alternate')), 'Should have /Alternate');
    });

    test('add-occd-name adds Name to OCCD', async () => {
        const bytes = await readFile(join(SUITE_DIR, 'oc-02-occd-no-name.pdf'));
        const doc = await pdfLib.PDFDocument.load(bytes, { updateMetadata: false });
        const fixer = new PDFPreflightFixer(doc);
        fixer.applyFix('add-occd-name');

        const ocProps = doc.catalog.lookup(pdfLib.PDFName.of('OCProperties'));
        const d = ocProps.lookup(pdfLib.PDFName.of('D'));
        assert.ok(d.get(pdfLib.PDFName.of('Name')), 'OCCD should have Name');
    });

    test('fixes persist through save and reload', async () => {
        const bytes = await readFile(join(SUITE_DIR, 'pg-01-no-trimbox.pdf'));
        const doc = await pdfLib.PDFDocument.load(bytes, { updateMetadata: false });
        const fixer = new PDFPreflightFixer(doc);
        fixer.applyFix('set-geometry-from-mediabox');
        fixer.applyFix('add-document-id');

        const savedBytes = await doc.save({ addDefaultPage: false, updateFieldAppearances: false });
        const reloaded = await pdfLib.PDFDocument.load(savedBytes, { updateMetadata: false });

        const page = reloaded.getPages()[0].node;
        assert.ok(page.get(pdfLib.PDFName.of('TrimBox')), 'TrimBox should persist');
        assert.ok(reloaded.context.trailerInfo.ID, 'ID should persist');
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd testing/iso/ptf/2026 && node --test experiments/tests/pdf-preflight-fixer.test.js`
Expected: FAIL — module `validator/classes/pdf-preflight-fixer.js` not found

- [ ] **Step 3: Implement `PDFPreflightFixer`**

Create `validator/classes/pdf-preflight-fixer.js`. The class:

1. Constructor takes `(pdfDocument)`
2. `applyFix(fixId)` — dispatches to the appropriate fix method, returns a changelog array
3. `applyFixes(fixIds)` — applies multiple fixes, returns combined changelog
4. Private fix methods: `#fixGeometry()`, `#fixDocumentId()`, `#fixOutputIntentProfile()`, `#stripOrphanedOCG()`, `#addOCCDName()`, `#generateMinimalXMP()`

The fix implementations are already proven in `experiments/validator/create-compatibility-test.mjs` (functions `fixPageGeometry`, `fixOutputIntentProfile`, `fixDocumentID`). Adapt those directly. For `#stripOrphanedOCG` and `#addOCCDName`, implement based on the OCG structure analysis done earlier. For `#generateMinimalXMP`, create a minimal XMP packet with entries from the Info dict.

Import pdf-lib from `../../packages/pdf-lib/pdf-lib.esm.js`.

Each changelog entry is: `{ fixId, description, location, before, after }`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd testing/iso/ptf/2026 && node --test experiments/tests/pdf-preflight-fixer.test.js`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add validator/classes/pdf-preflight-fixer.js experiments/tests/pdf-preflight-fixer.test.js
git commit -m "feat(validator): implement PDFPreflightFixer with 6 fix operations"
```

---

### Task 4: Implement `PDFPreflightFixerValidator`

**Files:**
- Create: `validator/classes/pdf-preflight-fixer-validator.js`
- Create: `experiments/tests/pdf-preflight-fixer-validator.test.js`

- [ ] **Step 1: Write the test file**

Tests the integrated flow: validate → report shows fixable findings → fix → re-validate → findings resolved.

```javascript
// @ts-check
/**
 * PDFPreflightFixerValidator Tests
 *
 * Tests the integrated validate → fix → re-validate flow.
 *
 * @module pdf-preflight-fixer-validator.test
 * @author Saleh Abdel Motaal <dev@smotaal.io>
 * @ai Claude Opus 4.6 (code generation)
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert';
import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SUITE_DIR = join(__dirname, '..', 'validator', 'pdf-lib-validation-suite');
const RULES_PATH = join(__dirname, '..', '..', 'classes', 'configurations', 'preflight-rules.json');

// Also test against REAL generator output
const DOCKET_PATH = join(__dirname, '..', '..', '..', '..', '..', '..', 'temp', 'Generator Tests',
    '2026-03-30 - ConRes - ISO PTF - CR1 (F10a) Assets - Canon iPR C10000VP series Coated MGCR v1.2 - Docket.pdf');

/** @type {typeof import('../../validator/classes/pdf-preflight-fixer-validator.js').PDFPreflightFixerValidator} */
let PDFPreflightFixerValidator;
/** @type {typeof import('pdf-lib')} */
let pdfLib;
/** @type {object} */
let rules;

describe('PDFPreflightFixerValidator', () => {
    before(async () => {
        pdfLib = await import('../../packages/pdf-lib/pdf-lib.esm.js');
        const mod = await import('../../validator/classes/pdf-preflight-fixer-validator.js');
        PDFPreflightFixerValidator = mod.PDFPreflightFixerValidator;
        rules = JSON.parse(await readFile(RULES_PATH, 'utf-8'));
    });

    test('validate → fix all → re-validate resolves fixable errors', async () => {
        const bytes = await readFile(join(SUITE_DIR, 'pg-01-no-trimbox.pdf'));
        const doc = await pdfLib.PDFDocument.load(bytes, { updateMetadata: false });
        const fv = new PDFPreflightFixerValidator(doc, rules);

        // First validation
        const report1 = fv.validate();
        const fixableErrors = report1.findings.filter(f => f.status === 'fail' && f.fixId);
        assert.ok(fixableErrors.length > 0, 'Should have fixable errors');

        // Fix all
        const fixIds = [...new Set(fixableErrors.map(f => f.fixId))];
        const changelog = fv.fix(fixIds);
        assert.ok(changelog.length > 0, 'Should have changelog entries');

        // Re-validate
        const report2 = fv.validate();
        for (const fixId of fixIds) {
            const stillFailing = report2.findings.filter(f => f.fixId === fixId && f.status === 'fail');
            assert.strictEqual(stillFailing.length, 0, `Fix ${fixId} should have resolved all failures`);
        }
    });

    test('works on real generator docket PDF', async () => {
        let bytes;
        try {
            bytes = await readFile(DOCKET_PATH);
        } catch {
            // Skip if docket not available
            return;
        }

        const doc = await pdfLib.PDFDocument.load(bytes, { updateMetadata: false });
        const fv = new PDFPreflightFixerValidator(doc, rules);

        const report = fv.validate();
        assert.ok(report.documentInfo.pageCount === 2, 'Docket should have 2 pages');
        assert.ok(report.summary.errors > 0, 'Docket should have errors');

        // The docket is known to have: missing TrimBox, missing doc ID, bare ICC stream
        const errorRuleIds = report.findings.filter(f => f.status === 'fail').map(f => f.ruleId);
        assert.ok(errorRuleIds.includes('page-missing-trimbox-or-artbox'), 'Should detect missing TrimBox');
        assert.ok(errorRuleIds.includes('document-id-missing'), 'Should detect missing doc ID');
    });

    test('fixable findings include fix descriptions from rules', async () => {
        const bytes = await readFile(join(SUITE_DIR, 'pg-01-no-trimbox.pdf'));
        const doc = await pdfLib.PDFDocument.load(bytes, { updateMetadata: false });
        const fv = new PDFPreflightFixerValidator(doc, rules);
        const report = fv.validate();

        const fixable = report.findings.filter(f => f.fixId);
        for (const f of fixable) {
            assert.ok(f.fixId, 'Should have fixId');
            // The fixer-validator should enrich findings with fix metadata
            assert.ok(f.fixDescription, 'Should have fixDescription from rules');
        }
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd testing/iso/ptf/2026 && node --test experiments/tests/pdf-preflight-fixer-validator.test.js`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `PDFPreflightFixerValidator`**

Create `validator/classes/pdf-preflight-fixer-validator.js`. The class:

1. `extends PDFPreflightValidator` (import from `../../classes/baseline/pdf-preflight-validator.js`)
2. Constructor takes `(pdfDocument, rulesConfig)`, calls `super(pdfDocument, rulesConfig)`, creates a `PDFPreflightFixer` instance
3. Overrides `validate()` to enrich findings with fix descriptions from `rulesConfig.fixes[finding.fixId]`
4. Adds `fix(fixIds)` — delegates to `this.#fixer.applyFixes(fixIds)`, returns changelog
5. Adds `getFixableFixes(report)` — returns the unique set of fixIds from failed findings

- [ ] **Step 4: Run test to verify it passes**

Run: `cd testing/iso/ptf/2026 && node --test experiments/tests/pdf-preflight-fixer-validator.test.js`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add validator/classes/pdf-preflight-fixer-validator.js experiments/tests/pdf-preflight-fixer-validator.test.js
git commit -m "feat(validator): implement PDFPreflightFixerValidator with integrated validate+fix flow"
```

---

### Task 5: Validator UI — HTML and Bootstrap

**Files:**
- Create: `validator/index.html`
- Create: `validator/validator.js`

- [ ] **Step 1: Create `validator/index.html`**

Model after `generator/index.html`. Key elements:
- ImportMap with `pdf-lib`, `icc`, `pako` aliases (same as generator)
- Same external stylesheet (`https://smotaal.io/markout/styles/styles.css`)
- Declarative shadow DOM template with slots
- Drop zone / file input for PDF files (accept `.pdf`)
- Report display area (empty initially, populated by JS)
- "Fix All" / "Fix Selected" button (disabled until report with fixable findings)
- "Download Fixed PDF" button (disabled until fix applied)
- Progress bar
- Debugging details (main thread toggle)

- [ ] **Step 2: Create `validator/validator.js`**

Bootstrap module that:
1. Imports `PDFValidatorAppElement` from `./elements/pdf-validator-app-element.js`
2. Registers the custom element: `customElements.define('pdf-validator-app', PDFValidatorAppElement)`
3. Exports a `bootstrap()` function called from the HTML inline script

- [ ] **Step 3: Verify the page loads**

Open `http://localhost:8080/testing/iso/ptf/2026/validator/index.html` (requires `yarn local:test` or `http-server` running). Verify the page renders with the drop zone visible and no console errors.

- [ ] **Step 4: Commit**

```bash
git add validator/index.html validator/validator.js
git commit -m "feat(validator): add HTML entry point and bootstrap module"
```

---

### Task 6: Validator UI — Custom Element

**Files:**
- Create: `validator/elements/pdf-validator-app-element.js`

- [ ] **Step 1: Implement the custom element**

`PDFValidatorAppElement extends HTMLElement`. Key behaviors:

**File selection:**
- Listen for file input `change` event
- Read the PDF as `ArrayBuffer`
- Show filename and size

**Validation (main thread path for MVP):**
- Import `PDFPreflightFixerValidator` and `PDFDocument`
- Attempt `PDFDocument.load(buffer)` — catch errors → `fromLoadError`
- Run `fv.validate()` → render report

**Report rendering:**
- Group findings by category
- Each finding shows: severity icon, display name, description, location, status
- Fixable findings show: fix description, checkbox
- Summary bar: N errors, N warnings, N passed, N skipped

**Fix flow:**
- "Fix All" button collects all fixable fixIds
- Calls `fv.fix(fixIds)`
- Shows changelog
- `doc.save()` → creates Blob → enables "Download Fixed PDF" button

**Download:**
- Create Object URL from saved Uint8Array
- Trigger download with original filename + ` - Fixed` suffix

- [ ] **Step 2: Test manually with the docket PDF**

1. Start server: `yarn local:test`
2. Open `http://localhost:8080/testing/iso/ptf/2026/validator/`
3. Drop the docket PDF: `temp/Generator Tests/2026-03-30 - ConRes - ISO PTF - CR1 (F10a) Assets - Canon iPR C10000VP series Coated MGCR v1.2 - Docket.pdf`
4. Verify report shows: missing TrimBox (2 pages), missing doc ID, bare ICC stream, missing XMP
5. Click "Fix All"
6. Download fixed PDF
7. Drop the fixed PDF back in — verify all previously-failed findings now pass

- [ ] **Step 3: Test with a 2025 legacy PDF that is known to work**

Drop `temp/Generator Tests/2025-05-05 - ISO PTF 2x-4x - Canon imagePRESS C10000VP - Finalized - 2026-03-28.pdf`. Verify it shows fewer or no errors compared to the 2026 docket.

- [ ] **Step 4: Commit**

```bash
git add validator/elements/pdf-validator-app-element.js
git commit -m "feat(validator): implement PDF validator UI with validate+fix+download flow"
```

---

### Task 7: Worker Thread Support

**Files:**
- Create: `validator/bootstrap-worker-entrypoint.js`
- Modify: `validator/elements/pdf-validator-app-element.js`

- [ ] **Step 1: Create the worker entry point**

Model after `generator/bootstrap-worker-entrypoint.js`. Messages:

**Incoming:** `{ type: 'validate', taskId, pdfBuffer }` and `{ type: 'fix', taskId, pdfBuffer, approvedFixes }`

**Outgoing:** `{ type: 'report', taskId, report }`, `{ type: 'fixed', taskId, pdfBuffer, changelog }`, `{ type: 'progress', taskId, stage, percent, message }`, `{ type: 'error', taskId, message, stack }`

The worker imports `PDFPreflightFixerValidator` and `PDFDocument`, runs validation/fix, and posts results back. Buffers are transferred (not copied).

- [ ] **Step 2: Add worker execution path to the custom element**

Add a toggle in the UI (matching the generator's debugging details pattern):
- Default: worker thread
- Debug mode: main thread (already working from Task 6)

When in worker mode, post the PDF buffer to the worker and render results from worker messages.

- [ ] **Step 3: Test worker path with the docket PDF**

Same manual test as Task 6 Step 2, but with worker mode (default). Verify the UI remains responsive during validation.

- [ ] **Step 4: Commit**

```bash
git add validator/bootstrap-worker-entrypoint.js validator/elements/pdf-validator-app-element.js
git commit -m "feat(validator): add worker thread execution path"
```

---

### Task 8: End-to-End Verification

**Files:** No new files — manual testing with real PDFs.

- [ ] **Step 1: Test with 2026 docket PDF (small, known failures)**

File: `temp/Generator Tests/2026-03-30 - ConRes - ISO PTF - CR1 (F10a) Assets - Canon iPR C10000VP series Coated MGCR v1.2 - Docket.pdf`

Expected findings:
- page-missing-trimbox-or-artbox: FAIL (2 pages)
- document-id-missing: FAIL
- output-intent-profile-bare-stream: FAIL
- metadata-missing-xmp: FAIL
- xobject-missing-subtype: PASS (docket has no XObject without Subtype)
- ocg-not-in-ocproperties: PASS or SKIPPED (docket has no OCG)
- occd-missing-name: PASS or SKIPPED

Fix all → download → re-validate → all PASS.

- [ ] **Step 2: Test with 2026 full test form PDF (large, ~1 GB)**

File: `temp/Generator Tests/2026-03-30 - ConRes - ISO PTF - CR1 (F10a) Assets - Canon iPR C10000VP series Coated MGCR v1.2 - Relative Colorimetric with Blackpoint Compensation.pdf`

Expected additional findings vs docket:
- ocg-not-in-ocproperties: FAIL (embedded Illustrator pages have OCG layers)
- occd-missing-name: FAIL

Verify the UI handles the large file without crashing. Fix all → download may take time (2 GB peak memory for save). Verify the fixed PDF has corrected structure using `experiments/validator/verify-variants.mjs`.

- [ ] **Step 3: Test with 2025 legacy PDF (should be mostly clean)**

File: `temp/Generator Tests/2025-05-05 - ISO PTF 2x-4x - Canon imagePRESS C10000VP - Finalized - 2026-03-28.pdf`

Expected: Fewer errors than 2026 output. TrimBox should be present, doc ID may or may not be present.

- [ ] **Step 4: Test with the Acrobat-intermediate PDF**

File: `temp/Generator Tests/2025-05-05 - ISO PTF 2x-4x - Canon imagePRESS C10000VP - Acrobat.pdf`

This file has ICCBased color spaces — verify the validator doesn't false-flag anything in the MVP scope.

- [ ] **Step 5: Run all automated tests**

Run: `cd testing/iso/ptf/2026 && node --test experiments/tests/pdf-preflight-validator.test.js experiments/tests/pdf-preflight-fixer.test.js experiments/tests/pdf-preflight-fixer-validator.test.js`
Expected: All PASS

- [ ] **Step 6: Update progress document**

Update `2026-03-28-VALIDATE-PDF-PROGRESS.md`:
- Mark Steps 9-15 as complete
- Add activity log entries
- Note any findings from manual testing

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(validator): MVP complete — validates and fixes 2026/generator PDF issues"
```
