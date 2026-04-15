// @ts-check
/**
 * Phase A regression test — plateau-depth monotonic improvement.
 *
 * Pins per-profile per-mode K-plateau depths as measured on the
 * `2026-03-27` baseline run. The contract going forward is
 * *one-directional*: refinements must **lower or preserve** each
 * profile's plateau depth. Any increase is a regression.
 *
 * When a refinement lowers a depth (success), re-generate the fixture
 * and commit the new floor.
 *
 * Plateau depth = number of trailing samples on the neutral row whose
 * `K ≥ threshold %` (default `99`). Matches the definition in
 * `experiments/compare-cgats-outputs.js`.
 *
 * @author Saleh Abdel Motaal <dev@smotaal.io>
 * @ai Claude Opus 4.6 (code generation)
 */

import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseCGATS, getRow, getFieldIndices } from '../../../../../experiments/compare-cgats-outputs/parse-cgats.js';
import { listBaselineEntries } from './shared/r2-baseline.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = join(__dirname, '__fixtures__/plateau-depth-2026-04-20.json');

/**
 * @typedef {Object} PinnedEntry
 * @property {number} plateauDepth
 * @property {number} kLast
 * @property {number} rowLength
 */

/**
 * @typedef {Object} PinnedFixture
 * @property {number} threshold
 * @property {string} generatedFrom
 * @property {Record<string, PinnedEntry>} entries
 */

/** @type {PinnedFixture} */
const pinned = JSON.parse(await readFile(FIXTURE_PATH, 'utf8'));

const baselineEntries = await listBaselineEntries();

/**
 * Compute the K-plateau depth on the neutral row of a CGATS document.
 * @param {import('../../../../../experiments/compare-cgats-outputs/parse-cgats.js').CGATSDocument} doc
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

describe('Phase A regression: plateau depth never increases vs 2026-03-27 baseline', () => {
    it('fixture file was loaded', () => {
        expect(pinned.threshold).toBeGreaterThan(0);
        expect(Object.keys(pinned.entries).length).toBeGreaterThan(0);
    });

    for (const entry of baselineEntries) {
        const key = `${entry.mode}|${entry.profileName}`;
        const pinnedEntry = pinned.entries[key];

        it(`${entry.mode} — ${entry.profileName}`, async () => {
            expect(
                pinnedEntry,
                `no pinned entry for "${key}" in ${FIXTURE_PATH}. ` +
                `Regenerate the fixture (see test file header).`
            ).toBeDefined();

            const doc = await parseCGATS(entry.cgatsPath);
            const observed = plateauDepth(doc, pinned.threshold);

            expect(
                observed.plateauDepth,
                `plateau depth regression for "${key}": ` +
                `expected ≤ ${pinnedEntry.plateauDepth} (pinned floor), ` +
                `got ${observed.plateauDepth}. ` +
                `K at last sample: pinned=${pinnedEntry.kLast} observed=${observed.kLast}. ` +
                `Baseline file: ${entry.cgatsPath}`
            ).toBeLessThanOrEqual(pinnedEntry.plateauDepth);
        });
    }
});
