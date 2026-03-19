// @ts-check
/**
 * Generator Memory Management Tests
 *
 * Playwright-based tests that profile JS heap memory during test form PDF
 * generation. Uses Chrome DevTools Protocol (CDP) for accurate heap
 * measurements and tracks memory at each stage of the generation pipeline.
 *
 * These tests are SKIPPED by default. Enable with:
 *   TESTS_MEMORY=true node --test testing/iso/ptf/2025/tests/generator/memory-management.test.js
 *
 * Or via run-tests.js (auto-starts server):
 *   TESTS_MEMORY=true node testing/iso/ptf/2025/tests/run-tests.js --generator
 *
 * Or via package.json script:
 *   yarn test:generator
 *
 * Requirements:
 * - Test server running on port 8080 (or set BASE_URL), or use run-tests.js
 * - Asset files available at testing/iso/ptf/assets/
 *
 * @module memory-management.test
 * @author Saleh Abdel Motaal <dev@smotaal.io>
 * @ai Claude Opus 4.6 (code generation)
 */

import { test, describe, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { chromium } from 'playwright-chromium';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { TruthyEnvironmentParameterMatcher } from '../helpers.js';

// ============================================================================
// Configuration
// ============================================================================

const BASE_URL = process.env.BASE_URL || 'http://localhost:8080';
const GENERATOR_URL = `${BASE_URL}/testing/iso/ptf/2025/generator/index.html`;
const GENERATOR_BASE_URL = `${BASE_URL}/testing/iso/ptf/2025/generator/`;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROFILES_DIR = path.join(__dirname, '..', 'fixtures', 'profiles');
const ASSETS_JSON_PATH = path.join(__dirname, '..', '..', 'generator', 'assets.json');

/**
 * @typedef {{
 *   filePath: string,
 *   expectedColorSpace: 'RGB' | 'CMYK',
 * }} ProfileFixture
 */

/** @type {Record<string, ProfileFixture>} */
const PROFILE_FIXTURES = {
    'FIPS_WIDE_28T-TYPEavg': {
        filePath: path.join(PROFILES_DIR, 'FIPS_WIDE_28T-TYPEavg.icc'),
        expectedColorSpace: 'RGB',
    },
    'eciCMYK v2': {
        filePath: path.join(PROFILES_DIR, 'eciCMYK v2.icc'),
        expectedColorSpace: 'CMYK',
    },
};

const SKIP_UNLESS_MEMORY = !TruthyEnvironmentParameterMatcher.test(process.env.TESTS_MEMORY)
    && 'Set TESTS_MEMORY=true to enable memory management tests';

// ============================================================================
// Types
// ============================================================================

/**
 * Resolved asset entry with absolute URLs for the browser context.
 *
 * @typedef {object} ResolvedTestAsset
 * @property {string} name - Display name of the asset variant
 * @property {{ assets: string, manifest: string }} resources - Absolute URLs
 */

/**
 * @typedef {{
 *   stage: string,
 *   percent: number,
 *   heapUsed: number,
 *   heapTotal: number,
 * }} MemorySnapshot
 */

// ============================================================================
// Helpers
// ============================================================================

/**
 * Formats byte count as human-readable string.
 *
 * @param {number} bytes
 * @returns {string}
 */
function formatBytes(bytes) {
    if (bytes < 0) return `\u2212${formatBytes(-bytes)}`;
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Reads JS heap metrics via CDP Performance API.
 *
 * @param {import('playwright-chromium').CDPSession} cdp
 * @param {{ forceGC?: boolean }} [options]
 * @returns {Promise<{ heapUsed: number, heapTotal: number }>}
 */
async function measureHeap(cdp, { forceGC = false } = {}) {
    if (forceGC) {
        await cdp.send('HeapProfiler.collectGarbage');
        await new Promise(resolve => setTimeout(resolve, 200));
    }
    const { metrics } = await cdp.send('Performance.getMetrics');
    return {
        heapUsed: metrics.find(m => m.name === 'JSHeapUsedSize')?.value ?? 0,
        heapTotal: metrics.find(m => m.name === 'JSHeapTotalSize')?.value ?? 0,
    };
}

/**
 * Loads and resolves asset entries from assets.json for use in browser context.
 *
 * Reads assets.json from the file system, then resolves the relative resource
 * URLs to absolute URLs using the test server's generator base URL.
 *
 * @returns {Promise<ResolvedTestAsset[]>}
 */
async function loadResolvedAssets() {
    const assetsData = JSON.parse(await readFile(ASSETS_JSON_PATH, 'utf8'));
    return assetsData.assets.map((/** @type {{ name: string, resources: { assets: string, manifest: string } }} */ entry) => ({
        name: entry.name,
        resources: {
            assets: new URL(entry.resources.assets, GENERATOR_BASE_URL).href,
            manifest: new URL(entry.resources.manifest, GENERATOR_BASE_URL).href,
        },
    }));
}

// ============================================================================
// Test Suite
// ============================================================================

describe('Generator Memory Management', { skip: SKIP_UNLESS_MEMORY }, () => {
    /** @type {import('playwright-chromium').Browser} */
    let browser;
    /** @type {import('playwright-chromium').BrowserContext} */
    let context;
    /** @type {import('playwright-chromium').Page} */
    let page;
    /** @type {import('playwright-chromium').CDPSession} */
    let cdpSession;

    /**
     * Resolved asset entries loaded from assets.json.
     * @type {ResolvedTestAsset[]}
     */
    let resolvedAssets;

    /**
     * CDP snapshots collected during generation via the exposed bridge function.
     * Reset before each test run.
     * @type {MemorySnapshot[]}
     */
    let cdpSnapshots = [];

    before(async () => {
        // Load and resolve assets from assets.json
        resolvedAssets = await loadResolvedAssets();
        assert.ok(resolvedAssets.length > 0, 'assets.json must contain at least one asset entry');

        browser = await chromium.launch({
            headless: true,
            args: [
                '--enable-precise-memory-info',
                '--js-flags=--max-old-space-size=8192',
                '--disable-dev-shm-usage',
            ],
        });
    });

    after(async () => {
        await browser?.close();
    });

    // Create a fresh page and CDP session for each test to avoid cross-test
    // contamination (e.g., after a timeout corrupts the page state).
    beforeEach(async () => {
        context = await browser.newContext();
        page = await context.newPage();
        cdpSession = await context.newCDPSession(page);
        await cdpSession.send('Performance.enable');

        // Forward browser console messages to Node.js stdout for debugging.
        // Filter out per-chunk download progress objects (noisy fetchState logs).
        page.on('console', (message) => {
            const text = message.text();
            if (text.startsWith('{name:') && text.includes('receivedBytes:')) return;
            const type = message.type();
            if (type === 'error' || type === 'warning') {
                console.log(`  [browser:${type}] ${text}`);
            } else {
                console.log(`  [browser] ${text}`);
            }
        });

        // Forward page errors
        page.on('pageerror', (error) => {
            console.log(`  [browser:pageerror] ${error.message}`);
        });

        // Detect renderer process crashes (e.g., OOM)
        page.on('crash', () => {
            console.log(`  [browser:crash] Renderer process crashed (likely OOM)`);
        });

        // Expose a bridge function so the browser can request CDP heap
        // measurements mid-generation. This gives accurate V8 heap numbers
        // at each stage transition, avoiding reliance on the deprecated
        // performance.memory API.
        await page.exposeFunction(
            '__measureHeapFromCDP',
            async (/** @type {string} */ stage, /** @type {number} */ percent) => {
                const metrics = await measureHeap(cdpSession);
                cdpSnapshots.push({ stage, percent, ...metrics });
            },
        );
    });

    afterEach(async () => {
        await cdpSession?.detach().catch(() => {});
        await context?.close().catch(() => {});
    });

    // ========================================================================
    // Profiled Generation Runner
    // ========================================================================

    /**
     * Runs a full generation workflow with memory profiling.
     *
     * 1. Navigates to generator page (fresh module state)
     * 2. Measures baseline heap (after forced GC)
     * 3. Runs generation via page.evaluate, with CDP snapshots at each stage
     * 4. Measures heap after generation (natural state)
     * 5. Forces GC and measures retained heap
     * 6. Prints a detailed report
     *
     * @param {object} options
     * @param {string} options.profileName - Display name of the ICC profile
     * @param {ProfileFixture} options.fixture - Profile fixture config
     * @param {8 | 16} options.bitDepth - Output bit depth
     * @param {string} options.assetName - Name to match in resolved assets (substring match)
     * @returns {Promise<{
     *   baseline: { heapUsed: number, heapTotal: number },
     *   afterGeneration: { heapUsed: number, heapTotal: number },
     *   afterGC: { heapUsed: number, heapTotal: number },
     *   growthDuringGeneration: number,
     *   retainedAfterGC: number,
     *   pdfSizeBytes: number,
     *   elapsedMilliseconds: number,
     *   snapshots: MemorySnapshot[],
     * }>}
     */
    async function runProfiledGeneration({ profileName, fixture, bitDepth, assetName }) {
        // Find asset entry by name (substring match for flexibility)
        const assetEntry = resolvedAssets.find((entry) => entry.name.includes(assetName));
        if (!assetEntry) {
            throw new Error(
                `No asset entry matching "${assetName}" in assets.json. ` +
                `Available: ${resolvedAssets.map((e) => e.name).join(', ')}`,
            );
        }

        // Reset snapshots for this run
        cdpSnapshots = [];

        // Navigate to generator page (fresh module state per test)
        await page.goto(GENERATOR_URL, { waitUntil: 'networkidle' });

        // Read ICC profile from disk and base64-encode for transfer to browser
        const profileBytes = await readFile(fixture.filePath);
        const profileBase64 = profileBytes.toString('base64');

        // -- Baseline (after page load, after forced GC) --
        const baseline = await measureHeap(cdpSession, { forceGC: true });

        console.log(`\n${'─'.repeat(72)}`);
        console.log(`  Memory Profile: ${profileName} \u2014 ${bitDepth}-bit \u2014 ${assetEntry.name}`);
        console.log(`${'─'.repeat(72)}`);
        console.log(`  Baseline: ${formatBytes(baseline.heapUsed)} used / ${formatBytes(baseline.heapTotal)} total`);

        // -- Run generation in browser context --
        const result = await page.evaluate(async ({
            base64,
            outputBitDepth,
            testFormVersion,
            resources,
        }) => {
            // Import the generator class (uses the page's importmap)
            const { TestFormPDFDocumentGenerator } = await import(
                './classes/test-form-pdf-document-generator.js'
            );

            // Decode base64 ICC profile to ArrayBuffer
            const binaryString = atob(base64);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }

            const generator = new TestFormPDFDocumentGenerator({
                testFormVersion,
                resources,
                debugging: false,
                outputBitsPerComponent: /** @type {8 | 16} */ (outputBitDepth),
                useWorkers: false,
            });

            /** @type {string | null} */
            let previousStage = null;

            const startTime = performance.now();

            const { pdfBuffer } = await generator.generate(
                bytes.buffer,
                null, // Skip slug generation — focus on pdf-lib memory behavior
                {
                    onProgress: async (stage, percent, message) => {
                        // Request CDP heap measurement on each stage transition
                        if (stage !== previousStage) {
                            previousStage = stage;
                            console.log(`[progress] ${stage} ${percent}% — ${message}`);
                            // @ts-ignore — exposed via Playwright's page.exposeFunction
                            await window.__measureHeapFromCDP(stage, percent);
                        }
                    },
                },
            );

            return {
                pdfSizeBytes: pdfBuffer.byteLength,
                elapsedMilliseconds: performance.now() - startTime,
            };
        }, {
            base64: profileBase64,
            outputBitDepth: bitDepth,
            testFormVersion: assetEntry.name,
            resources: assetEntry.resources,
        });

        // -- Post-generation (natural state, no forced GC) --
        const afterGeneration = await measureHeap(cdpSession);

        // -- After forced GC (reveals retained/leaked memory) --
        const afterGC = await measureHeap(cdpSession, { forceGC: true });

        // Add final snapshots to the timeline
        cdpSnapshots.push({ stage: 'after-generation', percent: 100, ...afterGeneration });
        cdpSnapshots.push({ stage: 'after-gc', percent: 100, ...afterGC });

        const growthDuringGeneration = afterGeneration.heapUsed - baseline.heapUsed;
        const retainedAfterGC = afterGC.heapUsed - baseline.heapUsed;

        // -- Report --
        console.log(`\n  Stage snapshots (CDP heap measurements):`);
        for (const snap of cdpSnapshots) {
            const delta = snap.heapUsed - baseline.heapUsed;
            const sign = delta >= 0 ? '+' : '';
            console.log(
                `    ${snap.stage.padEnd(20)} ${String(snap.percent).padStart(3)}%  ` +
                `heap: ${formatBytes(snap.heapUsed).padStart(10)}  ` +
                `\u0394: ${sign}${formatBytes(delta)}`,
            );
        }

        console.log(`\n  Summary:`);
        console.log(`    Baseline:              ${formatBytes(baseline.heapUsed)}`);
        console.log(`    Peak (after gen):      ${formatBytes(afterGeneration.heapUsed)}  (+${formatBytes(growthDuringGeneration)})`);
        console.log(`    After GC:              ${formatBytes(afterGC.heapUsed)}  (+${formatBytes(retainedAfterGC)})`);
        console.log(`    PDF output:            ${formatBytes(result.pdfSizeBytes)}`);
        console.log(`    Elapsed:               ${(result.elapsedMilliseconds / 1000).toFixed(1)}s`);

        return {
            baseline,
            afterGeneration,
            afterGC,
            growthDuringGeneration,
            retainedAfterGC,
            pdfSizeBytes: result.pdfSizeBytes,
            elapsedMilliseconds: result.elapsedMilliseconds,
            snapshots: [...cdpSnapshots],
        };
    }

    // ========================================================================
    // 8-bit Tests
    // ========================================================================

    test('FIPS_WIDE_28T-TYPEavg \u2014 8-bit \u2014 memory profile (Maps)', {
        timeout: 600_000,
    }, async () => {
        const result = await runProfiledGeneration({
            profileName: 'FIPS_WIDE_28T-TYPEavg',
            fixture: PROFILE_FIXTURES['FIPS_WIDE_28T-TYPEavg'],
            bitDepth: 8,
            assetName: 'Maps',
        });

        // Sanity: PDF was generated
        assert.ok(result.pdfSizeBytes > 0, 'PDF output should be non-empty');

        // Memory: retained after GC should be bounded
        // (Loose threshold — the real value is in the diagnostic report)
        assert.ok(
            result.retainedAfterGC < 500 * 1024 * 1024,
            `Retained memory after GC (${formatBytes(result.retainedAfterGC)}) exceeds 500 MB threshold`,
        );
    });

    test('eciCMYK v2 \u2014 8-bit \u2014 memory profile (Maps)', {
        timeout: 600_000,
    }, async () => {
        const result = await runProfiledGeneration({
            profileName: 'eciCMYK v2',
            fixture: PROFILE_FIXTURES['eciCMYK v2'],
            bitDepth: 8,
            assetName: 'Maps',
        });

        assert.ok(result.pdfSizeBytes > 0, 'PDF output should be non-empty');

        assert.ok(
            result.retainedAfterGC < 500 * 1024 * 1024,
            `Retained memory after GC (${formatBytes(result.retainedAfterGC)}) exceeds 500 MB threshold`,
        );
    });

    // ========================================================================
    // 16-bit Tests (placeholder — enable after 8-bit baseline established)
    // ========================================================================

    test('FIPS_WIDE_28T-TYPEavg \u2014 16-bit \u2014 memory profile', {
        skip: 'Pending: 16-bit tests will be enabled after 8-bit baseline is established',
        timeout: 600_000,
    }, async () => {
        await runProfiledGeneration({
            profileName: 'FIPS_WIDE_28T-TYPEavg',
            fixture: PROFILE_FIXTURES['FIPS_WIDE_28T-TYPEavg'],
            bitDepth: 16,
            assetName: '(8-bit)',
        });
    });

    test('eciCMYK v2 \u2014 16-bit \u2014 memory profile', {
        skip: 'Pending: 16-bit tests will be enabled after 8-bit baseline is established',
        timeout: 600_000,
    }, async () => {
        await runProfiledGeneration({
            profileName: 'eciCMYK v2',
            fixture: PROFILE_FIXTURES['eciCMYK v2'],
            bitDepth: 16,
            assetName: '(8-bit)',
        });
    });
});
