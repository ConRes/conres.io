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
            const findings = report.findings.filter(f => f.ruleId === 'page-missing-trimbox-or-artbox');
            assert.ok(findings.length > 0, 'Should have finding entries');
            assert.ok(findings.every(f => f.status === 'pass'), 'All should pass');
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

        test('detects damaged PDF via load failure', () => {
            const report = PDFPreflightValidator.validateLoadError(
                new Error('Failed to parse PDF document'),
                rules
            );
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
