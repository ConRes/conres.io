// @ts-check
/**
 * Fixture generator for `shadow-proportionality.test.js`.
 *
 * Regenerates `shadow-proportionality-<baseline-date>.json` from the current
 * baseline CGATS outputs. Run once to establish the pinned floor, then
 * after every refinement that lowers row-max ∆E*ab.
 *
 * Usage (from repo root):
 *   node packages/color-engine/tests/k-only-gcr/regression/__fixtures__/generate-shadow-proportionality-fixture.mjs
 *
 * @author Saleh Abdel Motaal <dev@smotaal.io>
 * @ai Claude Opus 4.6 (code generation)
 */

import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as LittleCMS from '../../../../src/index.js';

import { parseCGATS, getRow, getFieldIndices } from '../../../../../../experiments/compare-cgats-outputs/parse-cgats.js';
import { deltaEab } from '../../../../../../experiments/compare-cgats-outputs/lab-math.js';
import { classify, DEFAULT_TOLERANCES } from '../../../../../../experiments/compare-cgats-outputs/classify.js';
import { listBaselineEntries, readProfileBuffer, BASELINE_RUN_DIR } from '../shared/r2-baseline.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = join(__dirname, 'shadow-proportionality-2026-04-20.json');

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

function labAt(lab, i) {
    const b = i * 3;
    return { L: lab[b], a: lab[b + 1], b: lab[b + 2] };
}

const engine = await LittleCMS.createEngine();
const labHandle = engine.createLab4Profile();

const entries = await listBaselineEntries();
const byProfile = new Map();
for (const e of entries) {
    if (!byProfile.has(e.profileName)) byProfile.set(e.profileName, {});
    byProfile.get(e.profileName)[e.mode] = e;
}

const out = {
    deltaEUnit: 'ab',
    tolerances: DEFAULT_TOLERANCES,
    generatedFrom: BASELINE_RUN_DIR,
    entries: {},
};

for (const [profileName, pair] of byProfile) {
    if (!pair.Enhanced || !pair.Standard) continue;

    const enhancedDoc = await parseCGATS(pair.Enhanced.cgatsPath);
    const standardDoc = await parseCGATS(pair.Standard.cgatsPath);
    const idx = getFieldIndices(enhancedDoc);
    const enhancedRow = getRow(enhancedDoc, enhancedDoc.grayRowIndex);
    const standardRow = getRow(standardDoc, standardDoc.grayRowIndex);

    const enhancedCMYK = rowToCMYKFloat(enhancedRow, idx);
    const standardCMYK = rowToCMYKFloat(standardRow, idx);

    const profileHandle = engine.openProfileFromMem(await readProfileBuffer(pair.Enhanced.profilePath));
    let transform = 0;
    try {
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

        let worstIndex = -1;
        let worstDeltaE = -Infinity;
        let sumDeltaE = 0;
        let rowMaxDeltaL = 0;
        for (let i = 0; i < enhancedRow.length; i++) {
            const labE = labAt(enhancedLab, i);
            const labS = labAt(standardLab, i);
            const dE = deltaEab(labE, labS);
            const dL = labE.L - labS.L;
            sumDeltaE += dE;
            if (dE > worstDeltaE) { worstDeltaE = dE; worstIndex = i; }
            if (Math.abs(dL) > rowMaxDeltaL) rowMaxDeltaL = Math.abs(dL);
        }

        out.entries[profileName] = {
            rowMaxDeltaE: worstDeltaE,
            rowMeanDeltaE: sumDeltaE / enhancedRow.length,
            rowMaxDeltaL: rowMaxDeltaL,
            worstLabel: classify(worstDeltaE, DEFAULT_TOLERANCES).label,
            worstSampleIndex: worstIndex,
        };
    } finally {
        if (transform) engine.deleteTransform(transform);
        if (profileHandle) engine.closeProfile(profileHandle);
    }
}

if (labHandle) engine.closeProfile(labHandle);

await writeFile(OUTPUT_PATH, JSON.stringify(out, null, 2));
console.log(`wrote ${Object.keys(out.entries).length} entries to ${OUTPUT_PATH}`);
