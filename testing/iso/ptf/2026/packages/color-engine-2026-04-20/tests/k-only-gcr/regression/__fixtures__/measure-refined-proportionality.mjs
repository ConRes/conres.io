// @ts-check
/**
 * Ad-hoc measurement: row-max ΔE*ab per profile with
 * `setKOnlyTargetL(5.0)` enabled, vs the pinned 2026-03-27 baseline.
 * Used to verify the C2 refinement works across the full r2 set and
 * to populate the progress document's outcome table.
 *
 * @author Saleh Abdel Motaal <dev@smotaal.io>
 * @ai Claude Opus 4.6 (code generation)
 */

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as LittleCMS from '../../../../src/index.js';

import { parseCGATS, getRow, getFieldIndices } from '../../../../../../experiments/compare-cgats-outputs/parse-cgats.js';
import { deltaEab } from '../../../../../../experiments/compare-cgats-outputs/lab-math.js';
import { getRGBTestChartR2 } from '../../../../../../experiments/fixtures/rgb-test-chart-r2.js';
import { listBaselineEntries, readProfileBuffer } from '../shared/r2-baseline.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASELINE = JSON.parse(await readFile(join(__dirname, 'shadow-proportionality-2026-04-20.json'), 'utf8'));
const rgbChart = getRGBTestChartR2();
const targetL = Number(process.env.TARGET_L ?? '5');

const engine = await LittleCMS.createEngine();
const rgbHandle = engine.createSRGBProfile();
const labHandle = engine.createLab4Profile();

const entries = await listBaselineEntries();
const pairs = new Map();
for (const e of entries) {
    if (!pairs.has(e.profileName)) pairs.set(e.profileName, {});
    pairs.get(e.profileName)[e.mode] = e;
}

function transformChart(profileHandle, intent, flags) {
    const handle = engine.createTransform(rgbHandle, LittleCMS.TYPE_RGB_8, profileHandle, LittleCMS.TYPE_CMYK_8, intent, flags);
    try {
        const out = new Uint8Array(rgbChart.length * 4);
        const si = new Uint8Array(3);
        const so = new Uint8Array(4);
        for (let i = 0; i < rgbChart.length; i++) {
            si[0] = rgbChart[i][0]; si[1] = rgbChart[i][1]; si[2] = rgbChart[i][2];
            engine.doTransform(handle, si, so, 1);
            out.set(so, i * 4);
        }
        return out;
    } finally { engine.deleteTransform(handle); }
}

function measureRowDeltaE(profileHandle, aCMYK, bCMYK, rowLength, grayRow) {
    const handle = engine.createTransform(profileHandle, LittleCMS.TYPE_CMYK_FLT, labHandle, LittleCMS.TYPE_Lab_FLT,
        LittleCMS.INTENT_RELATIVE_COLORIMETRIC, LittleCMS.cmsFLAGS_BLACKPOINTCOMPENSATION | LittleCMS.cmsFLAGS_NOCACHE);
    try {
        const inA = new Float32Array(rowLength * 4);
        const inB = new Float32Array(rowLength * 4);
        for (let i = 0; i < rowLength; i++) {
            const s = (grayRow * rowLength + i) * 4;
            for (let j = 0; j < 4; j++) {
                inA[i * 4 + j] = aCMYK[s + j] * (100 / 255);
                inB[i * 4 + j] = bCMYK[s + j] * (100 / 255);
            }
        }
        const oa = new Float32Array(rowLength * 3), ob = new Float32Array(rowLength * 3);
        engine.doTransform(handle, inA, oa, rowLength);
        engine.doTransform(handle, inB, ob, rowLength);
        let rowMax = 0, rowSum = 0;
        for (let i = 0; i < rowLength; i++) {
            const a = { L: oa[i * 3], a: oa[i * 3 + 1], b: oa[i * 3 + 2] };
            const b = { L: ob[i * 3], a: ob[i * 3 + 1], b: ob[i * 3 + 2] };
            const d = deltaEab(a, b);
            if (d > rowMax) rowMax = d;
            rowSum += d;
        }
        return { rowMaxDeltaE: rowMax, rowMeanDeltaE: rowSum / rowLength };
    } finally { engine.deleteTransform(handle); }
}

console.log(`# C2 target-L = ${targetL} — row-max ΔE*ab on the neutral row, refined vs 2026-03-27 baseline\n`);
console.log('baseline → refined   Δ      profile');
const rows = [];
for (const [profileName, pair] of pairs) {
    if (!pair.Enhanced || !pair.Standard) continue;
    const baseline = BASELINE.entries[profileName];
    if (!baseline) continue;

    const standardDoc = await parseCGATS(pair.Standard.cgatsPath);
    const idx = getFieldIndices(standardDoc);
    const stdBytes = new Uint8Array(rgbChart.length * 4);
    for (let i = 0; i < standardDoc.samples.length; i++) {
        const row = standardDoc.samples[i];
        stdBytes[i * 4 + 0] = Math.round(row[idx.c] * 255 / 100);
        stdBytes[i * 4 + 1] = Math.round(row[idx.m] * 255 / 100);
        stdBytes[i * 4 + 2] = Math.round(row[idx.y] * 255 / 100);
        stdBytes[i * 4 + 3] = Math.round(row[idx.k] * 255 / 100);
    }

    const profileHandle = engine.openProfileFromMem(await readProfileBuffer(pair.Enhanced.profilePath));
    try {
        engine.setKOnlyTargetL(targetL);
        const refined = transformChart(profileHandle,
            LittleCMS.INTENT_PRESERVE_K_ONLY_RELATIVE_COLORIMETRIC_GCR,
            LittleCMS.cmsFLAGS_BLACKPOINTCOMPENSATION);
        engine.resetKOnlyRefinementConfig();

        const r = measureRowDeltaE(profileHandle, refined, stdBytes, standardDoc.rowLength, standardDoc.grayRowIndex);
        rows.push({
            profileName,
            baseline: baseline.rowMaxDeltaE,
            refined: r.rowMaxDeltaE,
            delta: r.rowMaxDeltaE - baseline.rowMaxDeltaE,
        });
    } finally { engine.closeProfile(profileHandle); }
}

rows.sort((a, b) => b.baseline - a.baseline);
for (const r of rows) {
    const arrow = r.delta < -0.05 ? '↓' : r.delta > 0.05 ? '↑' : '·';
    console.log(
        `${r.baseline.toFixed(3).padStart(7)} → ${r.refined.toFixed(3).padStart(7)}  ${arrow} ${r.delta.toFixed(3).padStart(7)}  ${r.profileName}`
    );
}

const improved = rows.filter(r => r.delta < -0.05).length;
const worsened = rows.filter(r => r.delta > 0.05).length;
console.log(`\n# summary: improved=${improved}, unchanged=${rows.length - improved - worsened}, worsened=${worsened}`);

engine.closeProfile(rgbHandle);
engine.closeProfile(labHandle);
