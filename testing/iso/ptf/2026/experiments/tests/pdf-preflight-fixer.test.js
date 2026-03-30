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

    test('set-geometry-from-mediabox does not overwrite existing boxes', async () => {
        const bytes = await readFile(join(SUITE_DIR, 'pg-02-both-trimbox-artbox.pdf'));
        const doc = await pdfLib.PDFDocument.load(bytes, { updateMetadata: false });
        const fixer = new PDFPreflightFixer(doc);
        const changelog = fixer.applyFix('set-geometry-from-mediabox');
        // TrimBox already existed — should not be in changelog
        const trimChanges = changelog.filter(c => c.description.includes('TrimBox'));
        assert.strictEqual(trimChanges.length, 0, 'Should not overwrite existing TrimBox');
    });

    test('add-document-id adds ID to trailer', async () => {
        const bytes = await readFile(join(SUITE_DIR, 'ds-01-no-doc-id.pdf'));
        const doc = await pdfLib.PDFDocument.load(bytes, { updateMetadata: false });
        assert.ok(!doc.context.trailerInfo.ID, 'Should start without ID');

        const fixer = new PDFPreflightFixer(doc);
        const changelog = fixer.applyFix('add-document-id');
        assert.ok(changelog.length > 0);
        assert.ok(doc.context.trailerInfo.ID, 'Should have ID after fix');
    });

    test('add-document-id does not overwrite existing ID', async () => {
        const bytes = await readFile(join(SUITE_DIR, 'ds-01-no-doc-id.pdf'));
        const doc = await pdfLib.PDFDocument.load(bytes, { updateMetadata: false });
        const fixer = new PDFPreflightFixer(doc);

        // Apply once
        fixer.applyFix('add-document-id');
        const firstID = doc.context.trailerInfo.ID;

        // Apply again
        const changelog2 = fixer.applyFix('add-document-id');
        assert.strictEqual(changelog2.length, 0, 'Should not overwrite existing ID');
        assert.strictEqual(doc.context.trailerInfo.ID, firstID, 'ID should be unchanged');
    });

    test('fix-output-intent-profile adds N and Alternate', async () => {
        const bytes = await readFile(join(SUITE_DIR, 'oi-02-bare-icc-stream.pdf'));
        const doc = await pdfLib.PDFDocument.load(bytes, { updateMetadata: false });
        const fixer = new PDFPreflightFixer(doc);
        const changelog = fixer.applyFix('fix-output-intent-profile');
        assert.ok(changelog.length > 0);

        const outputIntents = doc.catalog.lookup(pdfLib.PDFName.of('OutputIntents'));
        const intent = outputIntents.lookup(0);
        const profileRef = intent.get(pdfLib.PDFName.of('DestOutputProfile'));
        const profile = doc.context.lookup(profileRef);
        assert.ok(profile.dict.get(pdfLib.PDFName.of('N')), 'Should have /N');
        assert.ok(profile.dict.get(pdfLib.PDFName.of('Alternate')), 'Should have /Alternate');
        assert.ok(profile.dict.get(pdfLib.PDFName.of('Filter')), 'Should have /Filter');
    });

    test('add-occd-name adds Name to OCCD', async () => {
        const bytes = await readFile(join(SUITE_DIR, 'oc-02-occd-no-name.pdf'));
        const doc = await pdfLib.PDFDocument.load(bytes, { updateMetadata: false });
        const fixer = new PDFPreflightFixer(doc);
        const changelog = fixer.applyFix('add-occd-name');
        assert.ok(changelog.length > 0);

        const ocProps = doc.catalog.lookup(pdfLib.PDFName.of('OCProperties'));
        const d = ocProps.lookup(pdfLib.PDFName.of('D'));
        assert.ok(d.get(pdfLib.PDFName.of('Name')), 'OCCD should have Name');
    });

    test('generate-minimal-xmp creates XMP metadata stream', async () => {
        const bytes = await readFile(join(SUITE_DIR, 'xm-01-no-xmp.pdf'));
        const doc = await pdfLib.PDFDocument.load(bytes, { updateMetadata: false });
        assert.ok(!doc.catalog.get(pdfLib.PDFName.of('Metadata')), 'Should start without XMP');

        const fixer = new PDFPreflightFixer(doc);
        const changelog = fixer.applyFix('generate-minimal-xmp');
        assert.ok(changelog.length > 0);
        assert.ok(doc.catalog.get(pdfLib.PDFName.of('Metadata')), 'Should have Metadata after fix');
    });

    test('applyFixes applies multiple fixes and returns combined changelog', async () => {
        const bytes = await readFile(join(SUITE_DIR, 'pg-01-no-trimbox.pdf'));
        const doc = await pdfLib.PDFDocument.load(bytes, { updateMetadata: false });
        const fixer = new PDFPreflightFixer(doc);
        const changelog = fixer.applyFixes([
            'set-geometry-from-mediabox',
            'add-document-id',
            'generate-minimal-xmp',
        ]);
        assert.ok(changelog.length >= 3, 'Should have entries from multiple fixes');

        const page = doc.getPages()[0].node;
        assert.ok(page.get(pdfLib.PDFName.of('TrimBox')));
        assert.ok(doc.context.trailerInfo.ID);
        assert.ok(doc.catalog.get(pdfLib.PDFName.of('Metadata')));
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
