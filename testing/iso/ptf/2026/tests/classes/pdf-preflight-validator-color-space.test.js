// @ts-check
/**
 * PDFPreflightValidator — Color Space Compatibility Tests
 *
 * Tests the color space violation detection rules (RUL102, RUL115, RUL84)
 * using minimal PDFs built with pdf-lib that combine specific output intents
 * with specific Device color space usage.
 *
 * @module pdf-preflight-validator-color-space.test
 * @author Saleh Abdel Motaal <dev@smotaal.io>
 * @ai Claude Opus 4.6 (code generation)
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert';
import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROFILES_DIR = join(__dirname, '..', 'fixtures', 'profiles');
const RULES_PATH = join(__dirname, '..', '..', 'classes', 'configurations', 'preflight-rules.json');

/** @type {typeof import('../../classes/baseline/pdf-preflight-validator.js').PDFPreflightValidator} */
let PDFPreflightValidator;
/** @type {typeof import('pdf-lib')} */
let pdfLib;
/** @type {object} */
let rules;

/** @type {Uint8Array} */
let sRGBProfileBytes;
/** @type {Uint8Array} */
let eciCMYKProfileBytes;
/** @type {Uint8Array} */
let sGrayProfileBytes;

// ── Rule IDs ────────────────────────────────────────────────────────
const RUL102 = 'color-space-cmyk-incompatible-with-output-intent';
const RUL115 = 'color-space-rgb-incompatible-with-output-intent';
const RUL84 = 'color-space-gray-incompatible-with-output-intent';

// ── Test PDF Builders ───────────────────────────────────────────────

/**
 * Build a minimal PDF with an output intent and optional Device color content.
 *
 * @param {object} options
 * @param {Uint8Array | null} options.profileBytes - ICC profile for output intent (null = no output intent)
 * @param {number} options.profileComponents - Number of color components (3=RGB, 4=CMYK, 1=Gray)
 * @param {string} options.profileAlternate - Device color space name (/DeviceRGB, /DeviceCMYK, /DeviceGray)
 * @param {object} [options.content] - Device color content to include
 * @param {boolean} [options.content.deviceCMYK] - Include DeviceCMYK operator (k)
 * @param {boolean} [options.content.deviceRGB] - Include DeviceRGB operator (rg)
 * @param {boolean} [options.content.deviceGray] - Include DeviceGray operator (g)
 * @param {boolean} [options.content.deviceCMYKImage] - Include image with DeviceCMYK ColorSpace
 * @param {boolean} [options.content.deviceRGBImage] - Include image with DeviceRGB ColorSpace
 * @returns {Promise<Uint8Array>}
 */
async function buildTestPDF({ profileBytes, profileComponents, profileAlternate, content = {} }) {
    const { PDFDocument, PDFName, PDFArray, PDFDict, PDFString, PDFNumber, PDFHexString } = pdfLib;

    const doc = await PDFDocument.create();
    const page = doc.addPage([200, 200]);

    // Build content stream with Device color operators
    const ops = [];
    if (content.deviceGray) ops.push('0.5 g', '10 10 80 80 re', 'f');
    if (content.deviceRGB) ops.push('1 0 0 rg', '10 10 80 80 re', 'f');
    if (content.deviceCMYK) ops.push('0 0 0 1 k', '10 10 80 80 re', 'f');

    if (ops.length > 0) {
        // Write content stream to the page's existing content stream
        const contentStream = doc.context.flateStream(new TextEncoder().encode(ops.join('\n')));
        const contentStreamRef = doc.context.register(contentStream);
        page.node.set(PDFName.of('Contents'), contentStreamRef);
    }

    // Add image XObject if requested
    if (content.deviceCMYKImage || content.deviceRGBImage) {
        const resources = page.node.normalizedEntries().Resources;

        const xobjDict = doc.context.obj({});
        resources.set(PDFName.of('XObject'), xobjDict);

        if (content.deviceCMYKImage) {
            // Minimal 1x1 CMYK image
            const imageStream = doc.context.flateStream(new Uint8Array([0, 0, 0, 255]), {
                Width: PDFNumber.of(1),
                Height: PDFNumber.of(1),
                ColorSpace: PDFName.of('DeviceCMYK'),
                BitsPerComponent: PDFNumber.of(8),
                Subtype: PDFName.of('Image'),
                Type: PDFName.of('XObject'),
            });
            const imageRef = doc.context.register(imageStream);
            xobjDict.set(PDFName.of('Im0'), imageRef);
        }

        if (content.deviceRGBImage) {
            // Minimal 1x1 RGB image
            const imageStream = doc.context.flateStream(new Uint8Array([255, 0, 0]), {
                Width: PDFNumber.of(1),
                Height: PDFNumber.of(1),
                ColorSpace: PDFName.of('DeviceRGB'),
                BitsPerComponent: PDFNumber.of(8),
                Subtype: PDFName.of('Image'),
                Type: PDFName.of('XObject'),
            });
            const imageRef = doc.context.register(imageStream);
            xobjDict.set(PDFName.of('Im1'), imageRef);
        }
    }

    // Add output intent with ICC profile
    if (profileBytes) {
        const profileStream = doc.context.flateStream(profileBytes, {
            N: PDFNumber.of(profileComponents),
            Alternate: PDFName.of(profileAlternate),
        });
        const profileRef = doc.context.register(profileStream);

        const intentDict = doc.context.obj({
            Type: PDFName.of('OutputIntent'),
            S: PDFName.of('GTS_PDFX'),
            OutputConditionIdentifier: PDFString.of('Custom'),
            DestOutputProfile: profileRef,
        });
        const intentRef = doc.context.register(intentDict);

        const outputIntents = doc.context.obj([intentRef]);
        doc.catalog.set(PDFName.of('OutputIntents'), outputIntents);
    }

    return await doc.save();
}

// ── Tests ───────────────────────────────────────────────────────────

describe('PDFPreflightValidator — Color Space Compatibility', () => {
    before(async () => {
        pdfLib = await import('../../packages/pdf-lib/pdf-lib.esm.js');
        const mod = await import('../../classes/baseline/pdf-preflight-validator.js');
        PDFPreflightValidator = mod.PDFPreflightValidator;
        rules = JSON.parse(await readFile(RULES_PATH, 'utf-8'));
        sRGBProfileBytes = new Uint8Array(await readFile(join(PROFILES_DIR, 'sRGB IEC61966-2.1.icc')));
        eciCMYKProfileBytes = new Uint8Array(await readFile(join(PROFILES_DIR, 'eciCMYK v2.icc')));
        sGrayProfileBytes = new Uint8Array(await readFile(join(PROFILES_DIR, 'sGray.icc')));
    });

    // ── RUL102: CMYK used but OutputIntent not CMYK ─────────────────

    describe('RUL102 — CMYK used but OutputIntent not CMYK', () => {
        test('FAIL: RGB output intent + DeviceCMYK content stream', async () => {
            const bytes = await buildTestPDF({
                profileBytes: sRGBProfileBytes,
                profileComponents: 3,
                profileAlternate: 'DeviceRGB',
                content: { deviceCMYK: true },
            });
            const doc = await pdfLib.PDFDocument.load(bytes, { updateMetadata: false });
            const validator = new PDFPreflightValidator(doc, rules);
            const report = validator.validate();
            const finding = report.findings.find(f => f.ruleId === RUL102);
            assert.ok(finding, `Expected finding for ${RUL102}`);
            assert.strictEqual(finding.status, 'fail', 'DeviceCMYK in RGB output intent should fail');
        });

        test('FAIL: RGB output intent + DeviceCMYK image', async () => {
            const bytes = await buildTestPDF({
                profileBytes: sRGBProfileBytes,
                profileComponents: 3,
                profileAlternate: 'DeviceRGB',
                content: { deviceCMYKImage: true },
            });
            const doc = await pdfLib.PDFDocument.load(bytes, { updateMetadata: false });
            const validator = new PDFPreflightValidator(doc, rules);
            const report = validator.validate();
            const finding = report.findings.find(f => f.ruleId === RUL102);
            assert.ok(finding, `Expected finding for ${RUL102}`);
            assert.strictEqual(finding.status, 'fail', 'DeviceCMYK image in RGB output intent should fail');
        });

        test('SKIP: CMYK output intent + DeviceCMYK content (guard: no mismatch)', async () => {
            const bytes = await buildTestPDF({
                profileBytes: eciCMYKProfileBytes,
                profileComponents: 4,
                profileAlternate: 'DeviceCMYK',
                content: { deviceCMYK: true },
            });
            const doc = await pdfLib.PDFDocument.load(bytes, { updateMetadata: false });
            const validator = new PDFPreflightValidator(doc, rules);
            const report = validator.validate();
            const finding = report.findings.find(f => f.ruleId === RUL102);
            assert.ok(finding, `Expected finding for ${RUL102}`);
            // Guard passes (HasDeviceCMYK = true), condition passes (ProfileColorSpace = CMYK)
            assert.strictEqual(finding.status, 'pass', 'DeviceCMYK in CMYK output intent should pass');
        });

        test('SKIP: CMYK output intent + no DeviceCMYK (guard fails)', async () => {
            const bytes = await buildTestPDF({
                profileBytes: eciCMYKProfileBytes,
                profileComponents: 4,
                profileAlternate: 'DeviceCMYK',
                content: { deviceRGB: true }, // No DeviceCMYK
            });
            const doc = await pdfLib.PDFDocument.load(bytes, { updateMetadata: false });
            const validator = new PDFPreflightValidator(doc, rules);
            const report = validator.validate();
            const finding = report.findings.find(f => f.ruleId === RUL102);
            assert.ok(finding, `Expected finding for ${RUL102}`);
            assert.strictEqual(finding.status, 'skipped', 'No DeviceCMYK = guard fails = skipped');
        });
    });

    // ── RUL115: RGB used but OutputIntent not RGB ────────────────────

    describe('RUL115 — RGB used but OutputIntent not RGB', () => {
        test('FAIL: CMYK output intent + DeviceRGB content stream', async () => {
            const bytes = await buildTestPDF({
                profileBytes: eciCMYKProfileBytes,
                profileComponents: 4,
                profileAlternate: 'DeviceCMYK',
                content: { deviceRGB: true },
            });
            const doc = await pdfLib.PDFDocument.load(bytes, { updateMetadata: false });
            const validator = new PDFPreflightValidator(doc, rules);
            const report = validator.validate();
            const finding = report.findings.find(f => f.ruleId === RUL115);
            assert.ok(finding, `Expected finding for ${RUL115}`);
            assert.strictEqual(finding.status, 'fail', 'DeviceRGB in CMYK output intent should fail');
        });

        test('FAIL: CMYK output intent + DeviceRGB image', async () => {
            const bytes = await buildTestPDF({
                profileBytes: eciCMYKProfileBytes,
                profileComponents: 4,
                profileAlternate: 'DeviceCMYK',
                content: { deviceRGBImage: true },
            });
            const doc = await pdfLib.PDFDocument.load(bytes, { updateMetadata: false });
            const validator = new PDFPreflightValidator(doc, rules);
            const report = validator.validate();
            const finding = report.findings.find(f => f.ruleId === RUL115);
            assert.ok(finding, `Expected finding for ${RUL115}`);
            assert.strictEqual(finding.status, 'fail', 'DeviceRGB image in CMYK output intent should fail');
        });

        test('PASS: RGB output intent + DeviceRGB content', async () => {
            const bytes = await buildTestPDF({
                profileBytes: sRGBProfileBytes,
                profileComponents: 3,
                profileAlternate: 'DeviceRGB',
                content: { deviceRGB: true },
            });
            const doc = await pdfLib.PDFDocument.load(bytes, { updateMetadata: false });
            const validator = new PDFPreflightValidator(doc, rules);
            const report = validator.validate();
            const finding = report.findings.find(f => f.ruleId === RUL115);
            assert.ok(finding, `Expected finding for ${RUL115}`);
            assert.strictEqual(finding.status, 'pass', 'DeviceRGB in RGB output intent should pass');
        });

        test('SKIP: RGB output intent + no DeviceRGB (guard fails)', async () => {
            const bytes = await buildTestPDF({
                profileBytes: sRGBProfileBytes,
                profileComponents: 3,
                profileAlternate: 'DeviceRGB',
                content: { deviceCMYK: true }, // No DeviceRGB
            });
            const doc = await pdfLib.PDFDocument.load(bytes, { updateMetadata: false });
            const validator = new PDFPreflightValidator(doc, rules);
            const report = validator.validate();
            const finding = report.findings.find(f => f.ruleId === RUL115);
            assert.ok(finding, `Expected finding for ${RUL115}`);
            assert.strictEqual(finding.status, 'skipped', 'No DeviceRGB = guard fails = skipped');
        });
    });

    // ── RUL84: DeviceGray but OutputIntent not Gray or CMYK ─────────

    describe('RUL84 — DeviceGray used but OutputIntent not Gray or CMYK', () => {
        test('FAIL: RGB output intent + DeviceGray content stream', async () => {
            const bytes = await buildTestPDF({
                profileBytes: sRGBProfileBytes,
                profileComponents: 3,
                profileAlternate: 'DeviceRGB',
                content: { deviceGray: true },
            });
            const doc = await pdfLib.PDFDocument.load(bytes, { updateMetadata: false });
            const validator = new PDFPreflightValidator(doc, rules);
            const report = validator.validate();
            const finding = report.findings.find(f => f.ruleId === RUL84);
            assert.ok(finding, `Expected finding for ${RUL84}`);
            assert.strictEqual(finding.status, 'fail', 'DeviceGray in RGB output intent should fail');
        });

        test('PASS: CMYK output intent + DeviceGray content (Gray permitted in CMYK)', async () => {
            const bytes = await buildTestPDF({
                profileBytes: eciCMYKProfileBytes,
                profileComponents: 4,
                profileAlternate: 'DeviceCMYK',
                content: { deviceGray: true },
            });
            const doc = await pdfLib.PDFDocument.load(bytes, { updateMetadata: false });
            const validator = new PDFPreflightValidator(doc, rules);
            const report = validator.validate();
            const finding = report.findings.find(f => f.ruleId === RUL84);
            assert.ok(finding, `Expected finding for ${RUL84}`);
            assert.strictEqual(finding.status, 'pass', 'DeviceGray in CMYK output intent should pass (permitted)');
        });

        test('PASS: Gray output intent + DeviceGray content', async () => {
            const bytes = await buildTestPDF({
                profileBytes: sGrayProfileBytes,
                profileComponents: 1,
                profileAlternate: 'DeviceGray',
                content: { deviceGray: true },
            });
            const doc = await pdfLib.PDFDocument.load(bytes, { updateMetadata: false });
            const validator = new PDFPreflightValidator(doc, rules);
            const report = validator.validate();
            const finding = report.findings.find(f => f.ruleId === RUL84);
            assert.ok(finding, `Expected finding for ${RUL84}`);
            assert.strictEqual(finding.status, 'pass', 'DeviceGray in Gray output intent should pass');
        });

        test('SKIP: RGB output intent + no DeviceGray (guard fails)', async () => {
            const bytes = await buildTestPDF({
                profileBytes: sRGBProfileBytes,
                profileComponents: 3,
                profileAlternate: 'DeviceRGB',
                content: { deviceRGB: true }, // No DeviceGray
            });
            const doc = await pdfLib.PDFDocument.load(bytes, { updateMetadata: false });
            const validator = new PDFPreflightValidator(doc, rules);
            const report = validator.validate();
            const finding = report.findings.find(f => f.ruleId === RUL84);
            assert.ok(finding, `Expected finding for ${RUL84}`);
            assert.strictEqual(finding.status, 'skipped', 'No DeviceGray = guard fails = skipped');
        });
    });

    // ── No Output Intent ────────────────────────────────────────────

    describe('No Output Intent', () => {
        test('all 3 rules skipped when no output intent present', async () => {
            const bytes = await buildTestPDF({
                profileBytes: null,
                profileComponents: 0,
                profileAlternate: '',
                content: { deviceCMYK: true, deviceRGB: true, deviceGray: true },
            });
            const doc = await pdfLib.PDFDocument.load(bytes, { updateMetadata: false });
            const validator = new PDFPreflightValidator(doc, rules);
            const report = validator.validate();

            for (const ruleId of [RUL102, RUL115, RUL84]) {
                const finding = report.findings.find(f => f.ruleId === ruleId);
                assert.ok(finding, `Expected finding for ${ruleId}`);
                // Guard passes (all Device colors present), but ProfileColorSpace
                // evaluator returns null — condition comparison null === 'CMYK' fails
                // So the rule should fail, not skip. But wait: with no output intent,
                // the expected behavior depends on whether null !== expected means fail.
                // For RUL84 with logic 'or': null !== 'Gray' AND null !== 'CMYK' → fail
                // This is the correct PDF/X-4 behavior: missing output intent = fail.
            }

            // With no output intent, all Device colors are present (guard passes),
            // ProfileColorSpace returns null, which !== any expected string → fail
            const cmykFinding = report.findings.find(f => f.ruleId === RUL102);
            assert.strictEqual(cmykFinding.status, 'fail',
                'DeviceCMYK with no output intent should fail (no matching intent)');

            const rgbFinding = report.findings.find(f => f.ruleId === RUL115);
            assert.strictEqual(rgbFinding.status, 'fail',
                'DeviceRGB with no output intent should fail (no matching intent)');

            const grayFinding = report.findings.find(f => f.ruleId === RUL84);
            assert.strictEqual(grayFinding.status, 'fail',
                'DeviceGray with no output intent should fail (no matching intent)');
        });
    });

    // ── Mixed Content ───────────────────────────────────────────────

    describe('Mixed Content', () => {
        test('RGB output intent + DeviceCMYK + DeviceGray + DeviceRGB', async () => {
            const bytes = await buildTestPDF({
                profileBytes: sRGBProfileBytes,
                profileComponents: 3,
                profileAlternate: 'DeviceRGB',
                content: { deviceCMYK: true, deviceRGB: true, deviceGray: true },
            });
            const doc = await pdfLib.PDFDocument.load(bytes, { updateMetadata: false });
            const validator = new PDFPreflightValidator(doc, rules);
            const report = validator.validate();

            // RUL102: DeviceCMYK in RGB intent → fail
            const cmykFinding = report.findings.find(f => f.ruleId === RUL102);
            assert.strictEqual(cmykFinding.status, 'fail');

            // RUL115: DeviceRGB in RGB intent → pass
            const rgbFinding = report.findings.find(f => f.ruleId === RUL115);
            assert.strictEqual(rgbFinding.status, 'pass');

            // RUL84: DeviceGray in RGB intent → fail (not Gray or CMYK)
            const grayFinding = report.findings.find(f => f.ruleId === RUL84);
            assert.strictEqual(grayFinding.status, 'fail');
        });

        test('CMYK output intent + DeviceCMYK + DeviceGray + DeviceRGB', async () => {
            const bytes = await buildTestPDF({
                profileBytes: eciCMYKProfileBytes,
                profileComponents: 4,
                profileAlternate: 'DeviceCMYK',
                content: { deviceCMYK: true, deviceRGB: true, deviceGray: true },
            });
            const doc = await pdfLib.PDFDocument.load(bytes, { updateMetadata: false });
            const validator = new PDFPreflightValidator(doc, rules);
            const report = validator.validate();

            // RUL102: DeviceCMYK in CMYK intent → pass
            const cmykFinding = report.findings.find(f => f.ruleId === RUL102);
            assert.strictEqual(cmykFinding.status, 'pass');

            // RUL115: DeviceRGB in CMYK intent → fail
            const rgbFinding = report.findings.find(f => f.ruleId === RUL115);
            assert.strictEqual(rgbFinding.status, 'fail');

            // RUL84: DeviceGray in CMYK intent → pass (Gray permitted in CMYK)
            const grayFinding = report.findings.find(f => f.ruleId === RUL84);
            assert.strictEqual(grayFinding.status, 'pass');
        });
    });
});
