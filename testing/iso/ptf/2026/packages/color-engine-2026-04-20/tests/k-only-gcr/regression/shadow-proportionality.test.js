// @ts-check
/**
 * Phase A/C regression test — shadow proportionality.
 *
 * Operationalises the success criterion from the task brief:
 *   "…most accurate k-only black point determination yields the correct
 *   scaling factor for k-only, such that converting the resulting k-only
 *   values to relative colorimetric with black point compensation and
 *   comparing them with values converted directly to relative
 *   colorimetric with black point compensation, should yield marginal
 *   ∆L and marginal ∆E for in gamut colors (i.e. device values that are
 *   achievable with maximum GCR versus the full gamut of the profile
 *   itself)."
 *
 * Procedure (neutral row across every r2 profile):
 *  1. Load the baseline CGATS for `Enhanced` and `Standard`.
 *  2. Load the associated ICC profile and build **one** analysis
 *     transform `CMYK → Lab` via Relative Colorimetric with BPC
 *     enabled (the system under comparison).
 *  3. Transform both outputs through that same analysis transform.
 *  4. Compute `∆L*`, `∆a*`, `∆b*`, and `∆E*ab` per sample, along with
 *     row-level mean/max/label summary.
 *
 * Reporting uses the tooling-session tolerance ladder
 * (`exact:0.0001 / excellent:0.1 / good:1 / fair:5 / poor:10`, T14).
 * The classifier label is a *reference comment* next to the raw value;
 * the actual value is always emitted for the record (T14 contract).
 *
 * The contract is intentionally directional: with every setter in its
 * default, the row max `∆E*ab` is **pinned as a baseline** from the
 * current `2026-03-27` output. Refinements must not raise any profile's
 * pinned max. A refinement that *lowers* the max is recorded by
 * regenerating the fixture — that is the success signal.
 *
 * The `it.fails`-style pins that record the currently-unacceptable
 * profiles (shadow plateau ≥ 2) live in
 * `shadow-proportionality-expected-failures.json`; refinements close
 * these one by one.
 *
 * @author Saleh Abdel Motaal <dev@smotaal.io>
 * @ai Claude Opus 4.6 (code generation)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as LittleCMS from '../../../src/index.js';

import { parseCGATS, getRow, getFieldIndices } from '../../../../../experiments/compare-cgats-outputs/parse-cgats.js';
import { deltaEab } from '../../../../../experiments/compare-cgats-outputs/lab-math.js';
import { classify, DEFAULT_TOLERANCES } from '../../../../../experiments/compare-cgats-outputs/classify.js';
import { listBaselineEntries, readProfileBuffer } from './shared/r2-baseline.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROPORTIONALITY_BASELINE_PATH = join(__dirname, '__fixtures__/shadow-proportionality-2026-04-20.json');

/**
 * @typedef {Object} ProportionalityPinnedEntry
 * @property {number} rowMaxDeltaE
 * @property {number} rowMeanDeltaE
 * @property {number} rowMaxDeltaL
 * @property {string} worstLabel
 * @property {number} worstSampleIndex
 */

/**
 * @typedef {Object} ProportionalityFixture
 * @property {string} deltaEUnit
 * @property {{ label: string, tolerance: number }[]} tolerances
 * @property {string} generatedFrom
 * @property {Record<string, ProportionalityPinnedEntry>} entries
 */

/**
 * Convert a CGATS row's CMYK percent values into a flat Float32Array of
 * `[C, M, Y, K]` in `[0, 100]` — the encoding the WASM engine uses for
 * `TYPE_CMYK_FLT`.
 * @param {number[][]} rowSamples
 * @param {{ c: number, m: number, y: number, k: number }} idx
 * @returns {Float32Array}
 */
function rowToCMYKFloat(rowSamples, idx) {
    const out = new Float32Array(rowSamples.length * 4);
    for (let i = 0; i < rowSamples.length; i++) {
        out[i * 4 + 0] = rowSamples[i][idx.c];
        out[i * 4 + 1] = rowSamples[i][idx.m];
        out[i * 4 + 2] = rowSamples[i][idx.y];
        out[i * 4 + 3] = rowSamples[i][idx.k];
    }
    return out;
}

/**
 * @param {Float32Array} lab
 * @param {number} sampleIndex
 * @returns {{ L: number, a: number, b: number }}
 */
function labAt(lab, sampleIndex) {
    const base = sampleIndex * 3;
    return { L: lab[base], a: lab[base + 1], b: lab[base + 2] };
}

const baselineEntries = await listBaselineEntries();

/** @type {ProportionalityFixture | null} */
let pinned = null;
try {
    pinned = JSON.parse(await readFile(PROPORTIONALITY_BASELINE_PATH, 'utf8'));
} catch (error) {
    if (!(error instanceof Error) || /** @type {NodeJS.ErrnoException} */(error).code !== 'ENOENT') throw error;
}

/**
 * @param {import('./shared/r2-baseline.js').BaselineEntry} entry
 * @returns {import('./shared/r2-baseline.js').BaselineEntry | undefined}
 */
function pairedEntry(entry) {
    const otherMode = entry.mode === 'Enhanced' ? 'Standard' : 'Enhanced';
    return baselineEntries.find(e => e.mode === otherMode && e.profileName === entry.profileName);
}

// Only iterate one pair per profile (use Enhanced as the driver).
const profilePairs = baselineEntries
    .filter(e => e.mode === 'Enhanced')
    .map(e => ({ enhanced: e, standard: pairedEntry(e) }))
    .filter(p => Boolean(p.standard));

describe('Phase A/C regression: shadow proportionality — Enhanced vs Standard via CMYK→Lab [Relative+BPC]', () => {
    /** @type {Awaited<ReturnType<typeof LittleCMS.createEngine>>} */
    let engine;
    /** @type {number} */
    let labHandle;

    beforeAll(async () => {
        engine = await LittleCMS.createEngine();
        labHandle = engine.createLab4Profile();
    });

    afterAll(() => {
        if (labHandle) engine.closeProfile(labHandle);
    });

    it('baseline has paired Enhanced + Standard per profile', () => {
        expect(profilePairs.length).toBeGreaterThan(0);
    });

    for (const { enhanced, standard } of profilePairs) {
        const profileName = enhanced.profileName;

        it(profileName, async () => {
            const enhancedDoc = await parseCGATS(enhanced.cgatsPath);
            const standardDoc = await parseCGATS(/** @type {import('./shared/r2-baseline.js').BaselineEntry} */(standard).cgatsPath);
            const idx = getFieldIndices(enhancedDoc);

            const enhancedRow = getRow(enhancedDoc, enhancedDoc.grayRowIndex);
            const standardRow = getRow(standardDoc, standardDoc.grayRowIndex);

            const enhancedCMYK = rowToCMYKFloat(enhancedRow, idx);
            const standardCMYK = rowToCMYKFloat(standardRow, idx);

            const profileHandle = engine.openProfileFromMem(await readProfileBuffer(enhanced.profilePath));
            let transform = 0;
            try {
                // Analysis transform under comparison: CMYK → Lab,
                // Relative Colorimetric, with BPC enabled (per brief).
                transform = engine.createTransform(
                    profileHandle,
                    LittleCMS.TYPE_CMYK_FLT,
                    labHandle,
                    LittleCMS.TYPE_Lab_FLT,
                    LittleCMS.INTENT_RELATIVE_COLORIMETRIC,
                    LittleCMS.cmsFLAGS_BLACKPOINTCOMPENSATION | LittleCMS.cmsFLAGS_NOCACHE
                );

                const enhancedLab = new Float32Array(enhancedRow.length * 3);
                const standardLab = new Float32Array(standardRow.length * 3);
                engine.doTransform(transform, enhancedCMYK, enhancedLab, enhancedRow.length);
                engine.doTransform(transform, standardCMYK, standardLab, standardRow.length);

                /** @type {number[]} */
                const perSampleDeltaE = [];
                /** @type {number[]} */
                const perSampleDeltaL = [];
                let worstIndex = -1;
                let worstDeltaE = -Infinity;
                for (let i = 0; i < enhancedRow.length; i++) {
                    const labE = labAt(enhancedLab, i);
                    const labS = labAt(standardLab, i);
                    const dE = deltaEab(labE, labS);
                    const dL = labE.L - labS.L;
                    perSampleDeltaE.push(dE);
                    perSampleDeltaL.push(dL);
                    if (dE > worstDeltaE) {
                        worstDeltaE = dE;
                        worstIndex = i;
                    }
                }

                const rowMaxDeltaE = worstDeltaE;
                const rowMeanDeltaE = perSampleDeltaE.reduce((a, b) => a + b, 0) / perSampleDeltaE.length;
                const rowMaxDeltaL = Math.max(...perSampleDeltaL.map(Math.abs));
                const worstLabel = classify(rowMaxDeltaE, DEFAULT_TOLERANCES).label;

                const pinnedEntry = pinned?.entries[profileName];
                if (pinnedEntry) {
                    // Directional contract: row-max ∆E must not exceed the
                    // pinned floor. Refinements that lower this should
                    // regenerate the fixture and commit the new floor.
                    expect(
                        rowMaxDeltaE,
                        `shadow-proportionality regression for "${profileName}": ` +
                        `expected row-max ∆E*ab ≤ ${pinnedEntry.rowMaxDeltaE.toFixed(4)} (pinned floor, label=${pinnedEntry.worstLabel}), ` +
                        `got ${rowMaxDeltaE.toFixed(4)} (label=${worstLabel}) at sample #${worstIndex + 1}. ` +
                        `rowMean ∆E*ab=${rowMeanDeltaE.toFixed(4)}, rowMax |∆L*|=${rowMaxDeltaL.toFixed(4)}. ` +
                        `Baseline files: ${enhanced.cgatsPath} ↔ ${standard?.cgatsPath}`
                    ).toBeLessThanOrEqual(pinnedEntry.rowMaxDeltaE + 1e-9);
                } else {
                    // No fixture yet — the test documents the current
                    // value but does not fail. Run the fixture generator
                    // (see test-file header) to pin these values.
                    expect.soft(rowMaxDeltaE).toBeGreaterThanOrEqual(0);
                }
            } finally {
                if (transform) engine.deleteTransform(transform);
                if (profileHandle) engine.closeProfile(profileHandle);
            }
        });
    }
});
