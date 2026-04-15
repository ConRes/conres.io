// @ts-check
/**
 * Fixture generator for `plateau-depth-baseline.test.js`.
 *
 * Regenerates `plateau-depth-<baseline-date>.json` from the current
 * baseline CGATS outputs. Run once to establish the pinned floor, then
 * after every refinement that lowers plateau depth.
 *
 * Usage (from repo root):
 *   node packages/color-engine/tests/k-only-gcr/regression/__fixtures__/generate-plateau-depth-fixture.mjs
 *
 * @author Saleh Abdel Motaal <dev@smotaal.io>
 * @ai Claude Opus 4.6 (code generation)
 */

import { writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseCGATS, getRow, getFieldIndices } from '../../../../../../experiments/compare-cgats-outputs/parse-cgats.js';
import { listBaselineEntries, BASELINE_RUN_DIR, REPO_ROOT } from '../shared/r2-baseline.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const THRESHOLD = 99;
const OUTPUT_PATH = join(__dirname, 'plateau-depth-2026-04-20.json');

/**
 * Compute the K-plateau depth on the neutral row of a CGATS document.
 * @param {import('../../../../../../experiments/compare-cgats-outputs/parse-cgats.js').CGATSDocument} doc
 * @param {number} threshold
 */
function plateauDepth(doc, threshold) {
    const idx = getFieldIndices(doc);
    const row = getRow(doc, doc.grayRowIndex);
    const kValues = row.map(s => s[idx.k]);
    let start = row.length;
    for (let i = row.length - 1; i >= 0; i--) {
        if (kValues[i] >= threshold) start = i;
        else break;
    }
    return {
        plateauDepth: row.length - start,
        kLast: kValues[row.length - 1],
        rowLength: row.length,
    };
}

const entries = await listBaselineEntries();

const out = {
    threshold: THRESHOLD,
    generatedFrom: relative(REPO_ROOT, BASELINE_RUN_DIR),
    entries: /** @type {Record<string, ReturnType<typeof plateauDepth>>} */ ({}),
};

for (const entry of entries) {
    const doc = await parseCGATS(entry.cgatsPath);
    const key = `${entry.mode}|${entry.profileName}`;
    out.entries[key] = plateauDepth(doc, THRESHOLD);
}

await writeFile(OUTPUT_PATH, JSON.stringify(out, null, 2));
console.log(`wrote ${Object.keys(out.entries).length} entries to ${OUTPUT_PATH}`);
