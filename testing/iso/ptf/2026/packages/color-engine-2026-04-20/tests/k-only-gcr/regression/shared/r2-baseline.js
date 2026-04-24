// @ts-check
/**
 * Shared helpers for regression tests in
 * `packages/color-engine/tests/k-only-gcr/regression/`.
 *
 * The baseline under test is the CGATS outputs produced by
 * `experiments/wasm-port-demonstration-r2.js` against the 2026-04-20
 * `@conres/color-engine` build, pinned under
 * `packages/color-engine/tests/references/baseline-lists-x16e-2026-04-20-full-r2/`.
 *
 * Byte-exact regression tests (`default-config-byte-exact.test.js`)
 * assert that the current build reproduces these files exactly.
 *
 * @author Saleh Abdel Motaal <dev@smotaal.io>
 * @ai Claude Opus 4.6 (code generation)
 */

import { readdir, readFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseCGATS } from '../../../../../../experiments/compare-cgats-outputs/parse-cgats.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Repository root (six levels above this file). */
export const REPO_ROOT = resolve(__dirname, '../../../../../..');

/** Pinned baseline reference directory (2026-04-20 drop-in). */
export const BASELINE_REFERENCE_DIR = resolve(
    __dirname,
    '../../../references/baseline-lists-x16e-2026-04-20-full-r2'
);

/** Baseline CGATS run (Enhanced / Standard LCMS subdirectories). */
export const BASELINE_RUN_DIR = BASELINE_REFERENCE_DIR;

/** ICC profiles bundled with the baseline. */
export const BASELINE_PROFILES_DIR = join(BASELINE_REFERENCE_DIR, 'profiles');

/**
 * @typedef {Object} BaselineEntry
 * @property {'Enhanced'|'Standard'} mode  Transform variant.
 * @property {string} descriptor           `FILE_DESCRIPTOR` from the CGATS header.
 * @property {string} profileName          `CMYK_PROFILE_NAME` from the CGATS header.
 * @property {string} profilePath          Resolved absolute path to the profile inside the repo.
 * @property {string} intent               `CMYK_PROFILE_INTENT` as stored in the CGATS header.
 * @property {boolean} bpc                 `true` when `CMYK_PROFILE_BPC == "YES"`.
 * @property {string} cgatsPath            Absolute path to the baseline CGATS file.
 */

/**
 * Enumerate the baseline run's `Enhanced (LCMS)` and `Standard (LCMS)`
 * outputs as `BaselineEntry` records. Throws if the baseline run is
 * missing (a clearer error than a silent empty iteration).
 * @returns {Promise<BaselineEntry[]>}
 */
export async function listBaselineEntries() {
    /** @type {BaselineEntry[]} */
    const entries = [];
    for (const mode of /** @type {const} */ (['Enhanced', 'Standard'])) {
        const variantDir = join(BASELINE_RUN_DIR, `${mode} (LCMS)`);
        /** @type {string[]} */
        let files;
        try {
            files = await readdir(variantDir);
        } catch (error) {
            throw new Error(
                `Baseline directory missing: ${variantDir} — ` +
                `re-run experiments/wasm-port-demonstration-r2.js or update ` +
                `BASELINE_RUN_DIR. Underlying: ${error instanceof Error ? error.message : error}`
            );
        }
        for (const name of files.sort()) {
            if (!name.endsWith('.txt')) continue;
            const cgatsPath = join(variantDir, name);
            const doc = await parseCGATS(cgatsPath);
            const profileName = doc.headers.CMYK_PROFILE_NAME ?? '';
            const embeddedPath = doc.headers.CMYK_PROFILE_PATH ?? '';
            const profilePath = join(BASELINE_PROFILES_DIR, basename(embeddedPath));
            entries.push({
                mode,
                descriptor: doc.headers.FILE_DESCRIPTOR ?? name,
                profileName,
                profilePath,
                intent: doc.headers.CMYK_PROFILE_INTENT ?? '',
                bpc: (doc.headers.CMYK_PROFILE_BPC ?? '').toUpperCase() === 'YES',
                cgatsPath,
            });
        }
    }
    return entries;
}

/**
 * Convenience: load an ICC profile from disk into a `Uint8Array`, suitable
 * for `engine.openProfileFromMem(...)`.
 * @param {string} profilePath
 * @returns {Promise<Uint8Array>}
 */
export async function readProfileBuffer(profilePath) {
    const buffer = await readFile(profilePath);
    return new Uint8Array(buffer);
}

/**
 * Convert a CGATS CMYK percent value back to the `Uint8` encoding
 * `wasm-port-demonstration-r2.js` used to emit it (`v * 100 / 255`).
 *
 * Because the baseline values originated from a `Uint8Array`, this
 * round-trip is exact for any value that was emitted by the script.
 * @param {number} percent
 * @returns {number}
 */
export function cgatsPercentToUint8(percent) {
    return Math.round((percent * 255) / 100);
}

/**
 * Pretty-print a CMYK quadruple for assertion messages.
 * @param {number[]} cmyk
 * @returns {string}
 */
export function formatCMYK(cmyk) {
    const [c, m, y, k] = cmyk;
    const f = v => v.toFixed(3);
    return `C=${f(c)} M=${f(m)} Y=${f(y)} K=${f(k)}`;
}
