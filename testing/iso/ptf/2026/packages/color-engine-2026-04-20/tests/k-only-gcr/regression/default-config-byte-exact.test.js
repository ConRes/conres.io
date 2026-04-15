// @ts-check
/**
 * Phase A regression test — default-config byte-exact parity.
 *
 * With no refinement setters called, the engine must reproduce the CGATS
 * outputs emitted by `packages/color-engine-2026-03-27` byte-for-byte
 * across every profile in the r2 baseline run. Enforces tolerance
 * decision T1 (see refinement progress document § 8).
 *
 * Iterates the baseline directory rather than re-deriving the r2 profile
 * list — the set of profiles participating in the regression is whatever
 * the r2 demonstration script recorded. No subsetting.
 *
 * @author Saleh Abdel Motaal <dev@smotaal.io>
 * @ai Claude Opus 4.6 (code generation)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import * as LittleCMS from '../../../src/index.js';

import { parseCGATS } from '../../../../../experiments/compare-cgats-outputs/parse-cgats.js';
import {
    getRGBTestChartR2,
} from '../../../../../experiments/fixtures/rgb-test-chart-r2.js';
import {
    listBaselineEntries,
    readProfileBuffer,
    cgatsPercentToUint8,
    formatCMYK,
} from './shared/r2-baseline.js';

const CHANNEL_NAMES = /** @type {const} */ (['C', 'M', 'Y', 'K']);

// Top-level await: enumerate baseline once so each entry becomes its own
// test case (Vitest collects describe/it bodies synchronously, so the
// entry list must be resolved before `describe` runs).
const baselineEntries = await listBaselineEntries();
const rgbList = getRGBTestChartR2();

describe('Phase A regression: default config is byte-exact vs 2026-03-27 baseline', () => {
    /** @type {Awaited<ReturnType<typeof LittleCMS.createEngine>>} */
    let engine;
    /** @type {number} */
    let rgbProfileHandle;

    beforeAll(async () => {
        engine = await LittleCMS.createEngine();
        rgbProfileHandle = engine.createSRGBProfile();
    });

    afterAll(() => {
        if (rgbProfileHandle) engine.closeProfile(rgbProfileHandle);
    });

    it('baseline run is present and non-empty', () => {
        expect(
            baselineEntries.length,
            `expected baseline entries under packages/color-engine/tests/references/baseline-lists-x16e-2026-04-20-full-r2, got none`
        ).toBeGreaterThan(0);
    });

    for (const entry of baselineEntries) {
        const intentConstant = entry.mode === 'Enhanced'
            ? LittleCMS.INTENT_PRESERVE_K_ONLY_RELATIVE_COLORIMETRIC_GCR
            : LittleCMS.INTENT_RELATIVE_COLORIMETRIC;

        it(`${entry.mode} — ${entry.profileName}`, async () => {
            const baselineDoc = await parseCGATS(entry.cgatsPath);
            const profileHandle = engine.openProfileFromMem(await readProfileBuffer(entry.profilePath));
            let transformHandle = 0;
            try {
                const flags = entry.bpc ? LittleCMS.cmsFLAGS_BLACKPOINTCOMPENSATION : 0;
                transformHandle = engine.createTransform(
                    rgbProfileHandle,
                    LittleCMS.TYPE_RGB_8,
                    profileHandle,
                    LittleCMS.TYPE_CMYK_8,
                    intentConstant,
                    flags
                );

                const actualUint8PerSample = rgbList.map((rgb) => {
                    const input = new Uint8Array(rgb);
                    const output = new Uint8Array(4);
                    engine.doTransform(transformHandle, input, output, 1);
                    return Array.from(output);
                });

                const expectedUint8PerSample = baselineDoc.samples.map(row => {
                    const [, c, m, y, k] = row;
                    return [
                        cgatsPercentToUint8(c),
                        cgatsPercentToUint8(m),
                        cgatsPercentToUint8(y),
                        cgatsPercentToUint8(k),
                    ];
                });

                expect(
                    actualUint8PerSample.length,
                    `sample count mismatch: actual=${actualUint8PerSample.length} expected=${expectedUint8PerSample.length}`
                ).toBe(expectedUint8PerSample.length);

                for (let i = 0; i < expectedUint8PerSample.length; i++) {
                    const actual = actualUint8PerSample[i];
                    const expected = expectedUint8PerSample[i];
                    for (let ch = 0; ch < 4; ch++) {
                        if (actual[ch] !== expected[ch]) {
                            const rgbStr = rgbList[i]?.map(v => v.toFixed(3)).join(',') ?? '?';
                            throw new Error(
                                `byte-exact parity broken at sample #${i + 1} (RGB ${rgbStr}), ` +
                                `channel ${CHANNEL_NAMES[ch]}: expected ${expected[ch]} got ${actual[ch]}. ` +
                                `Full CMYK expected=${formatCMYK(expected)} actual=${formatCMYK(actual)}. ` +
                                `Baseline file: ${entry.cgatsPath}`
                            );
                        }
                    }
                }
            } finally {
                if (transformHandle) engine.deleteTransform(transformHandle);
                if (profileHandle) engine.closeProfile(profileHandle);
            }
        });
    }
});
