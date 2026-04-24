// @ts-check
/**
 * Phase A regression test — neutral-row K-channel monotonicity.
 *
 * Enforces the invariant that the K-channel is monotonically
 * non-decreasing along the neutral (achromatic) row of the r2 test chart
 * for both Enhanced (K-only) and Standard (Relative Colorimetric) modes,
 * across every profile in the baseline run.
 *
 * Property-based test: it inspects the pinned `2026-03-27` baseline
 * output. Paired with the default-config byte-exact test, this
 * guarantees the current engine also satisfies the invariant.
 * Refinements must preserve monotonicity.
 *
 * @author Saleh Abdel Motaal <dev@smotaal.io>
 * @ai Claude Opus 4.6 (code generation)
 */

import { describe, it, expect } from 'vitest';

import { parseCGATS, getRow, getFieldIndices } from '../../../../../experiments/compare-cgats-outputs/parse-cgats.js';
import { listBaselineEntries } from './shared/r2-baseline.js';

/** Epsilon used to ignore float-point noise in the CGATS emission format. */
const MONOTONICITY_EPSILON = 1e-6;

const baselineEntries = await listBaselineEntries();

describe('Phase A regression: neutral-row K is monotonic', () => {
    it('baseline run is present and non-empty', () => {
        expect(baselineEntries.length).toBeGreaterThan(0);
    });

    for (const entry of baselineEntries) {
        it(`${entry.mode} — ${entry.profileName}`, async () => {
            const doc = await parseCGATS(entry.cgatsPath);
            const idx = getFieldIndices(doc);
            const row = getRow(doc, doc.grayRowIndex);
            const kValues = row.map(s => s[idx.k]);

            /** @type {{ index: number, previousK: number, currentK: number }[]} */
            const inversions = [];
            for (let i = 1; i < kValues.length; i++) {
                if (kValues[i] < kValues[i - 1] - MONOTONICITY_EPSILON) {
                    inversions.push({ index: i, previousK: kValues[i - 1], currentK: kValues[i] });
                }
            }

            expect(
                inversions.length,
                `K monotonicity violated on neutral row (${doc.grayRowIndex + 1} of ` +
                `${Math.floor(doc.samples.length / doc.rowLength)}): ` +
                `expected 0 inversions, got ${inversions.length}. ` +
                `First inversion at sample #${inversions[0]?.index + 1} ` +
                `(K[i-1]=${inversions[0]?.previousK} → K[i]=${inversions[0]?.currentK}). ` +
                `Baseline file: ${entry.cgatsPath}`
            ).toBe(0);
        });
    }
});
