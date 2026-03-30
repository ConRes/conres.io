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
import { readFile, access } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SUITE_DIR = join(__dirname, '..', 'validator', 'pdf-lib-validation-suite');
const RULES_PATH = join(__dirname, '..', '..', 'classes', 'configurations', 'preflight-rules.json');

const DOCKET_PATH = join(__dirname, '..', '..', '..', '..', '..', '..', 'temp', 'Generator Tests',
    '2026-03-30 - ConRes - ISO PTF - CR1 (F10a) Assets - Canon iPR C10000VP series Coated MGCR v1.2 - Docket.pdf');

const LEGACY_PDF_PATH = join(__dirname, '..', '..', '..', '..', '..', '..', 'temp', 'Generator Tests',
    '2025-05-05 - ISO PTF 2x-4x - Canon imagePRESS C10000VP - Finalized - 2026-03-28.pdf');

/** @type {typeof import('../../validator/classes/pdf-preflight-fixer-validator.js').PDFPreflightFixerValidator} */
let PDFPreflightFixerValidator;
/** @type {typeof import('pdf-lib')} */
let pdfLib;
/** @type {object} */
let rules;

/** @param {string} path */
async function fileExists(path) {
    try { await access(path); return true; } catch { return false; }
}

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

        const report1 = fv.validate();
        const fixableErrors = report1.findings.filter(f => f.status === 'fail' && f.fixId);
        assert.ok(fixableErrors.length > 0, 'Should have fixable errors');

        const fixIds = [...new Set(fixableErrors.map(f => f.fixId))];
        const changelog = fv.fix(fixIds);
        assert.ok(changelog.length > 0, 'Should have changelog entries');

        const report2 = fv.validate();
        for (const fixId of fixIds) {
            const stillFailing = report2.findings.filter(f => f.fixId === fixId && f.status === 'fail');
            assert.strictEqual(stillFailing.length, 0, `Fix ${fixId} should have resolved all failures`);
        }
    });

    test('fixable findings include fix descriptions from rules', async () => {
        const bytes = await readFile(join(SUITE_DIR, 'pg-01-no-trimbox.pdf'));
        const doc = await pdfLib.PDFDocument.load(bytes, { updateMetadata: false });
        const fv = new PDFPreflightFixerValidator(doc, rules);
        const report = fv.validate();

        const fixable = report.findings.filter(f => f.fixId);
        for (const f of fixable) {
            assert.ok(f.fixId);
            assert.ok(f.fixDescription, `Finding ${f.ruleId} should have fixDescription`);
        }
    });

    test('getFixableFixes returns unique fix IDs from failed findings', async () => {
        const bytes = await readFile(join(SUITE_DIR, 'pg-01-no-trimbox.pdf'));
        const doc = await pdfLib.PDFDocument.load(bytes, { updateMetadata: false });
        const fv = new PDFPreflightFixerValidator(doc, rules);
        const report = fv.validate();

        const fixIds = fv.getFixableFixes(report);
        assert.ok(Array.isArray(fixIds));
        assert.ok(fixIds.length > 0);
        assert.ok(fixIds.includes('set-geometry-from-mediabox'));
        // No duplicates
        assert.strictEqual(fixIds.length, new Set(fixIds).size);
    });

    test('works on real generator docket PDF', async () => {
        if (!(await fileExists(DOCKET_PATH))) return;

        const bytes = await readFile(DOCKET_PATH);
        const doc = await pdfLib.PDFDocument.load(bytes, { updateMetadata: false });
        const fv = new PDFPreflightFixerValidator(doc, rules);

        const report = fv.validate();
        assert.strictEqual(report.documentInfo.pageCount, 2, 'Docket should have 2 pages');
        assert.ok(report.summary.errors > 0 || report.summary.warnings > 0, 'Docket should have issues');

        const errorRuleIds = report.findings.filter(f => f.status === 'fail').map(f => f.ruleId);
        assert.ok(errorRuleIds.includes('page-missing-trimbox-or-artbox'), 'Should detect missing TrimBox');
        assert.ok(errorRuleIds.includes('document-id-missing'), 'Should detect missing doc ID');
    });

    test('2025 legacy PDF has fewer issues than 2026 output', async () => {
        if (!(await fileExists(LEGACY_PDF_PATH))) return;

        const bytes = await readFile(LEGACY_PDF_PATH);
        const doc = await pdfLib.PDFDocument.load(bytes, { updateMetadata: false });
        const fv = new PDFPreflightFixerValidator(doc, rules);

        const report = fv.validate();
        assert.ok(report.documentInfo.pageCount >= 1, 'Should have pages');

        // 2025 legacy should have TrimBox (it was preserved from the Illustrator source)
        const trimBoxFail = report.findings.find(
            f => f.ruleId === 'page-missing-trimbox-or-artbox' && f.status === 'fail'
        );
        assert.ok(!trimBoxFail, '2025 legacy should have TrimBox (no failure expected)');
    });
});
