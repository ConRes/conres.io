// @ts-check
/**
 * Phase A regression test — neutral-row K-only purity (Enhanced mode).
 *
 * Enforces the K-only GCR invariant: on the neutral (achromatic) row of
 * the r2 test chart, every sample in the Enhanced output must have
 * `C + M + Y < 1 %`. Standard mode is exempt — by definition it uses
 * rich CMYK on the neutral axis.
 *
 * Property-based test against the pinned `2026-03-27` baseline.
 *
 * @author Saleh Abdel Motaal <dev@smotaal.io>
 * @ai Claude Opus 4.6 (code generation)
 */

import { describe, it, expect } from 'vitest';

import { parseCGATS, getRow, getFieldIndices } from '../../../../../experiments/compare-cgats-outputs/parse-cgats.js';
import { listBaselineEntries } from './shared/r2-baseline.js';

/** Maximum allowed `C + M + Y` on any neutral sample in Enhanced mode. */
const CMY_LEAK_THRESHOLD_PERCENT = 1.0;

const baselineEntries = (await listBaselineEntries()).filter(e => e.mode === 'Enhanced');

describe('Phase A regression: neutral row is K-only in Enhanced mode', () => {
    it('baseline run has Enhanced entries', () => {
        expect(baselineEntries.length).toBeGreaterThan(0);
    });

    for (const entry of baselineEntries) {
        it(`${entry.profileName}`, async () => {
            const doc = await parseCGATS(entry.cgatsPath);
            const idx = getFieldIndices(doc);
            const row = getRow(doc, doc.grayRowIndex);

            /** @type {{ index: number, c: number, m: number, y: number, sum: number }[]} */
            const leaks = [];
            for (let i = 0; i < row.length; i++) {
                const c = row[i][idx.c];
                const m = row[i][idx.m];
                const y = row[i][idx.y];
                const sum = c + m + y;
                if (sum >= CMY_LEAK_THRESHOLD_PERCENT) {
                    leaks.push({ index: i, c, m, y, sum });
                }
            }

            expect(
                leaks.length,
                `CMY leak on neutral row: expected all samples to have C+M+Y < ${CMY_LEAK_THRESHOLD_PERCENT}%, ` +
                `got ${leaks.length} sample(s) above threshold. ` +
                (leaks[0]
                    ? `First leak at sample #${leaks[0].index + 1}: ` +
                      `C=${leaks[0].c.toFixed(3)} M=${leaks[0].m.toFixed(3)} ` +
                      `Y=${leaks[0].y.toFixed(3)} sum=${leaks[0].sum.toFixed(3)}%. `
                    : '') +
                `Baseline file: ${entry.cgatsPath}`
            ).toBe(0);
        });
    }
});
