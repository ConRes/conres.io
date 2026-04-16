// @ts-check
/**
 * Shared generator run logic for Playwright-based browser verification.
 *
 * Drives the actual generator UI: opens debugging mode, uploads the ICC
 * profile, clicks Generate, and catches every downloaded PDF as it arrives.
 * After generation, extracts a fingerprint from each saved PDF.
 *
 * Used by generate-baseline.mjs (Chromium) and webkit-verification.mjs (WebKit).
 *
 * @module generator-run
 * @author Saleh Abdel Motaal <dev@smotaal.io>
 * @ai Claude Opus 4.6 (code generation)
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = path.join(__dirname, '..', '..');
const DEFAULT_PROFILE_PATH = path.join(BASE, 'tests/fixtures/profiles/eciCMYK v2.icc');

/**
 * @typedef {{
 *   browserName: string,
 *   outputDir: string,
 *   port?: string,
 *   headed?: boolean,
 *   pollMemory?: boolean,
 *   enableTracing?: boolean,
 *   profilePath?: string,
 *   enabledLayoutNames?: string[],
 * }} GeneratorRunOptions
 *
 * @typedef {{
 *   generatedAt: string,
 *   browser: string,
 *   elapsedSeconds: number,
 *   peakMemoryMB?: number,
 *   pdfs: Record<string, PDFFingerprint>,
 * }} GeneratorFingerprint
 *
 * @typedef {{
 *   filename: string,
 *   pageCount: number,
 *   totalBytes: number,
 *   pdfHash: string,
 *   pages: Array<PageFingerprint>,
 * }} PDFFingerprint
 *
 * @typedef {{
 *   pageIndex: number,
 *   contentStreams: Array<StreamFingerprint>,
 *   images: Array<ImageFingerprint>,
 * }} PageFingerprint
 *
 * @typedef {{
 *   ref: string,
 *   compressedSize: number,
 *   uncompressedSize: number,
 *   hash: string,
 *   colorOperators: Record<string, number>,
 *   sampleValues: string[],
 * }} StreamFingerprint
 *
 * @typedef {{
 *   name: string,
 *   ref: string,
 *   width: number,
 *   height: number,
 *   bitsPerComponent: number,
 *   colorSpace: string,
 *   compressedSize: number,
 * }} ImageFingerprint
 */

/**
 * Launch a browser, drive the generator UI, save downloads, extract fingerprint.
 *
 * @param {GeneratorRunOptions} options
 * @returns {Promise<GeneratorFingerprint>}
 */
export async function runGenerator(options) {
    const {
        browserName,
        outputDir,
        port = '80',
        headed = false,
        pollMemory = false,
        enableTracing = false,
        convertImages = true,
        convertContentStreams = true,
        useLegacyContentStreamParsing = false,
        interConversionDelay,
        profilePath,
        enabledLayoutNames,
    } = options;

    // Non-magical profile path resolution: verbatim if absolute, CWD-relative otherwise.
    const resolvedProfilePath = profilePath
        ? path.resolve(process.cwd(), profilePath)
        : DEFAULT_PROFILE_PATH;

    const BASE_URL = `http://localhost:${port}`;
    const GENERATOR_URL = `${BASE_URL}/testing/iso/ptf/2026/generator/index.html`;

    // ── Server check ──────────────────────────────────────────────

    try {
        const r = await fetch(GENERATOR_URL);
        if (!r.ok) throw new Error(`${r.status}`);
    } catch {
        throw new Error(`Server not running at ${BASE_URL}`);
    }

    // ── Launch browser ────────────────────────────────────────────

    const pw = await import('playwright');
    const browserType = pw[browserName];
    if (!browserType) throw new Error(`Unknown browser: ${browserName}`);

    // Use a persistent user data directory so WebKit gets Safari-equivalent
    // storage quotas. Ephemeral contexts have restrictive Cache API limits
    // that cause QuotaExceededError on the 1.5 GB asset PDF download.
    const userDataDir = path.join(outputDir, '.playwright-profile');
    await mkdir(userDataDir, { recursive: true });

    const context = await browserType.launchPersistentContext(userDataDir, {
        headless: !headed,
        acceptDownloads: true,
        viewport: { width: 1280, height: 900 },
    });
    // launchPersistentContext returns a BrowserContext directly
    // context.browser() may return null for persistent contexts
    const page = context.pages()[0] || await context.newPage();
    page.setDefaultTimeout(0);

    /** @type {string[]} */
    const logs = [];
    page.on('console', msg => {
        const text = msg.text();
        logs.push(`[${msg.type()}] ${text}`);
        if (text.includes('[progress]') ||
            text.includes('[TestFormPDFDocumentGenerator]') ||
            text.includes('[AssetPagePreConverter]') ||
            text.includes('[WorkerPoolEntrypoint]') ||
            text.includes('[DEBUG trace-') ||
            text.includes('Streaming result') ||
            text.includes('chain') ||
            text.includes('Docket') ||
            text.includes('Error') ||
            msg.type() === 'error') {
            console.log(`  [${browserName}] ${text.slice(0, 400)}`);
        }
    });
    page.on('pageerror', error => {
        console.error(`  [${browserName} ERROR] ${error.message}`);
        logs.push(`[PAGE_ERROR] ${error.message}\n${error.stack}`);
    });

    await mkdir(outputDir, { recursive: true });

    // Save every download as it arrives
    /** @type {Map<string, string>} filename → saved path */
    const savedFiles = new Map();

    page.on('download', async (download) => {
        const filename = download.suggestedFilename();
        const savePath = path.join(outputDir, filename);
        try {
            await download.saveAs(savePath);
            savedFiles.set(filename, savePath);
            console.log(`  [download] ${filename}`);
        } catch {
            console.warn(`  [download] ${filename} — save failed (page may have crashed)`);
        }
    });

    // ── Memory polling ────────────────────────────────────────────
    //
    // WebKit uses XPC services — child processes are parented to launchd (ppid=1),
    // not to the browser PID. Playwright's WebKit processes use the Development
    // suffix in the path (from ms-playwright cache), so we match on that to
    // distinguish them from the user's regular Safari/Mail/etc. WebKit processes.
    //
    // For Chromium, all renderer/gpu/utility processes are direct children of
    // the browser PID.

    // Capture the Playwright browser PID for Chromium child matching
    // WebKit doesn't expose process() — only Chromium does
    const browser = context.browser();
    const browserPid = typeof browser?.process === 'function' ? browser.process()?.pid : undefined;

    // WebKit uses XPC services parented to launchd (ppid=1), not the browser.
    // Playwright's own processes use the ms-playwright Development suffix,
    // but the bootstrap worker spawns SYSTEM WebContent processes (from
    // /System/Library/Frameworks/WebKit.framework). To track those, snapshot
    // the system WebContent PIDs before generation starts and attribute any
    // NEW ones to the Playwright session.
    /** @type {Set<number>} */
    let preExistingWebContentPIDs = new Set();

    /** @returns {{ pid: number, ppid: number, rss: number, comm: string }[]} */
    function getAllProcesses() {
        const psOutput = execSync(
            `ps -A -o pid,ppid,rss,comm`,
            { encoding: 'utf-8', timeout: 2000 },
        ).trim();
        return psOutput.split('\n').slice(1).map(line => {
            const parts = line.trim().split(/\s+/);
            if (parts.length < 4) return null;
            return { pid: parseInt(parts[0], 10), ppid: parseInt(parts[1], 10), rss: parseInt(parts[2], 10), comm: parts.slice(3).join(' ') };
        }).filter(Boolean);
    }

    /**
     * Parse a `top` memory value like "12G", "1037M", "8641K" to MB.
     * @param {string} value
     * @returns {number}
     */
    function parseTopMemory(value) {
        if (!value) return 0;
        const match = value.match(/^([\d.]+)(K|M|G|T)?$/i);
        if (!match) return 0;
        const num = parseFloat(match[1]);
        switch (match[2]?.toUpperCase()) {
            case 'T': return num * 1024 * 1024;
            case 'G': return num * 1024;
            case 'K': return num / 1024;
            default: return num; // MB or bare number
        }
    }

    /**
     * Get memory + compressed for a set of PIDs using a single `top -l 1` call.
     * Returns what Activity Monitor shows: Memory (footprint) and Compressed.
     * @param {number[]} pids
     * @returns {Map<number, { memMB: number, compressedMB: number }>}
     */
    function getTopMetrics(pids) {
        /** @type {Map<number, { memMB: number, compressedMB: number }>} */
        const result = new Map();
        if (pids.length === 0) return result;
        try {
            const pidPattern = pids.map(String).join('|');
            const output = execSync(
                `top -l 1 -stats pid,mem,compress 2>/dev/null | grep -E "^(${pidPattern})\\b"`,
                { encoding: 'utf-8', timeout: 2000 },
            ).trim();
            for (const line of output.split('\n')) {
                const parts = line.trim().split(/\s+/);
                if (parts.length >= 3) {
                    const pid = parseInt(parts[0], 10);
                    result.set(pid, {
                        memMB: parseTopMemory(parts[1]),
                        compressedMB: parseTopMemory(parts[2]),
                    });
                }
            }
        } catch { /* skip */ }
        return result;
    }

    if (browserName === 'webkit') {
        // Snapshot system WebContent PIDs before generation
        for (const p of getAllProcesses()) {
            if (p.comm.includes('WebKit.WebContent') && !p.comm.includes('ms-playwright')) {
                preExistingWebContentPIDs.add(p.pid);
            }
        }
    }

    /** @type {Array<{ timestamp: number, label: string, totalRSSMB: number, processCount: number, details: Array<{ pid: number, rssMB: number, comm: string }> }>} */
    const memoryTimeline = [];
    let memoryInterval;

    function sampleMemory(/** @type {string} */ label) {
        if (!pollMemory) return;
        try {
            const all = getAllProcesses();

            /** @type {Array<{ pid: number, rssMB: number, comm: string }>} */
            const matched = [];

            if (browserName === 'webkit') {
                for (const p of all) {
                    const shortComm = p.comm.split('/').pop() || p.comm;

                    // Playwright's own WebKit processes (Development suffix)
                    if (p.comm.includes('ms-playwright') && p.comm.includes('WebKit')) {
                        matched.push({ pid: p.pid, comm: shortComm });
                        continue;
                    }

                    // System WebContent processes that appeared AFTER session start
                    // (these are worker XPC services spawned by Playwright's WebContent)
                    if (p.comm.includes('WebKit.WebContent') && !preExistingWebContentPIDs.has(p.pid)) {
                        matched.push({ pid: p.pid, rssMB: p.rss / 1024, comm: `${shortComm} (worker)` });
                    }
                }
            } else {
                // Chromium: match by ms-playwright path and browserPid ancestry
                for (const p of all) {
                    const shortComm = p.comm.split('/').pop() || p.comm;
                    if (p.comm.includes('ms-playwright') && (p.comm.includes('chrome') || p.comm.includes('chromium'))) {
                        matched.push({ pid: p.pid, comm: shortComm });
                    } else if (browserPid && (p.pid === browserPid || p.ppid === browserPid)) {
                        matched.push({ pid: p.pid, comm: shortComm });
                    }
                }
            }

            // Single top call for all matched PIDs — gives Memory + Compressed
            const topMetrics = getTopMetrics(matched.map(p => p.pid));

            // Enrich matched with top metrics
            const enriched = matched.map(p => {
                const metrics = topMetrics.get(p.pid) || { memMB: 0, compressedMB: 0 };
                return { ...p, memMB: metrics.memMB, compressedMB: metrics.compressedMB };
            });

            const totalMemMB = enriched.reduce((sum, p) => sum + p.memMB, 0);
            const totalCompressedMB = enriched.reduce((sum, p) => sum + p.compressedMB, 0);
            const entry = { timestamp: Date.now(), label, totalMemMB, totalCompressedMB, processCount: enriched.length, details: enriched };
            memoryTimeline.push(entry);

            // Only log on significant changes (>100 MB delta), process count change,
            // or labeled samples (baseline, after-generation, after-oom)
            const prev = memoryTimeline.length >= 2 ? memoryTimeline[memoryTimeline.length - 2] : null;
            const memDelta = prev ? Math.abs(totalMemMB - prev.totalMemMB) : Infinity;
            const processCountChanged = prev ? enriched.length !== prev.processCount : true;

            if (enriched.length > 0 && (label !== 'polling' || memDelta > 100 || processCountChanged)) {
                const breakdown = enriched.map(p => `${p.comm}: ${p.memMB.toFixed(0)}MB (${p.compressedMB.toFixed(0)}MB compressed)`).join(', ');
                console.log(`  [memory] ${label}: ${totalMemMB.toFixed(0)} MB (${totalCompressedMB.toFixed(0)} MB compressed) — ${enriched.length} procs: ${breakdown}`);
            }
        } catch { /* skip */ }
    }

    // ── Tracing ──────────────────────────────────────────────────

    if (enableTracing) {
        await context.tracing.start({ screenshots: false, snapshots: false });
    }

    // ── Drive the generator UI ──────────────────────────────────

    console.log(`Navigating to generator (${browserName}, ${headed ? 'headed' : 'headless'})...`);
    await page.goto(GENERATOR_URL, { waitUntil: 'networkidle', timeout: 60000 });

    // Open Debugging details — enables debugging mode, auto-fills defaults
    const debuggingDetails = await page.waitForSelector('#debugging-details');
    await debuggingDetails.evaluate(el => { /** @type {HTMLDetailsElement} */ (el).open = true; });

    // Toggle content conversion checkboxes if needed
    if (!convertImages) {
        const cb = await page.waitForSelector('#images-checkbox');
        await cb.evaluate(el => { /** @type {HTMLInputElement} */ (el).checked = false; });
        console.log('  Unchecked: images');
    }
    if (!convertContentStreams) {
        const cb = await page.waitForSelector('#content-streams-checkbox');
        await cb.evaluate(el => { /** @type {HTMLInputElement} */ (el).checked = false; });
        console.log('  Unchecked: content streams');
    }

    if (useLegacyContentStreamParsing) {
        const cb = await page.waitForSelector('#legacy-content-stream-parsing-checkbox');
        await cb.evaluate(el => { /** @type {HTMLInputElement} */ (el).checked = true; });
        console.log('  Checked: legacy content stream parsing');
    }
    if (interConversionDelay !== undefined) {
        const input = await page.waitForSelector('#inter-conversion-delay-input');
        await input.evaluate((el, val) => { /** @type {HTMLInputElement} */ (el).value = String(val); }, interConversionDelay);
        console.log(`  Inter-conversion delay: ${interConversionDelay}ms`);
    }

    // Configure layout filter before profile upload (must happen while customization is available)
    if (enabledLayoutNames && enabledLayoutNames.length > 0) {
        console.log(`Configuring layout filter: ${enabledLayoutNames.length} layouts`);

        const customizationDetails = await page.waitForSelector('#customization-details');
        await customizationDetails.evaluate(el => { /** @type {HTMLDetailsElement} */ (el).open = true; });

        // Switch layout mode to custom — triggers layout toggles population
        await page.evaluate(() => {
            const radio = /** @type {HTMLInputElement | null} */ (
                document.querySelector('input[name="layout-mode"][value="custom"]')
            );
            if (radio) {
                radio.checked = true;
                radio.dispatchEvent(new Event('change', { bubbles: true }));
            }
        });

        // Wait for layout checkboxes to exist, then check only the requested layouts
        await page.waitForSelector('#layout-toggles-container input[type="checkbox"]');
        const matched = await page.evaluate((names) => {
            const boxes = /** @type {NodeListOf<HTMLInputElement>} */ (
                document.querySelectorAll('#layout-toggles-container input[type="checkbox"]')
            );
            const wanted = new Set(names);
            let count = 0;
            const seen = [];
            for (const cb of boxes) {
                seen.push(cb.value);
                const want = wanted.has(cb.value);
                if (cb.checked !== want) {
                    cb.checked = want;
                    cb.dispatchEvent(new Event('change', { bubbles: true }));
                }
                if (want) count++;
            }
            return { count, seen };
        }, enabledLayoutNames);

        console.log(`  Enabled ${matched.count} of ${enabledLayoutNames.length} requested layouts`);
        if (matched.count < enabledLayoutNames.length) {
            const missing = enabledLayoutNames.filter(n => !matched.seen.includes(n));
            console.warn(`  Missing from UI: ${missing.join(', ')}`);
            console.warn(`  UI has: ${matched.seen.join(', ')}`);
        }
    }

    // Upload ICC profile
    console.log(`Uploading ICC profile: ${resolvedProfilePath}`);
    const fileInput = await page.waitForSelector('#icc-profile-input');
    await fileInput.setInputFiles(resolvedProfilePath);

    // Wait for profile analysis (button enables)
    await page.waitForFunction(() => {
        const btn = /** @type {HTMLButtonElement | null} */ (document.querySelector('#test-form-generation-button'));
        return btn && !btn.disabled;
    }, { timeout: 30000 });

    sampleMemory('baseline');
    if (pollMemory) memoryInterval = setInterval(() => sampleMemory('polling'), 250);

    console.log('Clicking Generate...');
    const startTime = Date.now();
    await page.click('#test-form-generation-button');

    // Wait for button to become "Cancel" (generation started)
    await page.waitForFunction(() => {
        const btn = /** @type {HTMLButtonElement | null} */ (document.querySelector('#test-form-generation-button'));
        return btn && btn.textContent === 'Cancel';
    }, { timeout: 30000 });

    console.log('Generation started...');

    // Detect OOM page reload — WebKit kills the WebContent process under
    // memory pressure, the page reloads, and the worker is gone. We race
    // the completion check against a page reload detection.
    let oomDetected = false;
    const oomPromise = new Promise((resolve) => {
        page.on('load', () => {
            oomDetected = true;
            console.error(`  [${browserName}] PAGE RELOADED — likely OOM (WebContent process killed)`);
            resolve(undefined);
        });
    });

    // Wait for completion — button text changes back from "Cancel"
    await Promise.race([
        page.waitForFunction(() => {
            const btn = /** @type {HTMLButtonElement | null} */ (document.querySelector('#test-form-generation-button'));
            return btn && btn.textContent !== 'Cancel';
        }, { timeout: 600000 }),
        oomPromise,
    ]);

    if (memoryInterval) clearInterval(memoryInterval);
    sampleMemory(oomDetected ? 'after-oom' : 'after-generation');

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    if (oomDetected) {
        console.error(`\nGeneration ABORTED — OOM page reload after ${elapsed}s`);
        logs.push(`[OOM] Page reloaded after ${elapsed}s — WebContent process killed by memory pressure`);
    } else {
        console.log(`\nGeneration completed (${elapsed}s)`);
    }

    // Wait for pending downloads
    await new Promise(resolve => setTimeout(resolve, 3000));

    if (enableTracing) {
        await context.tracing.stop({ path: path.join(outputDir, 'trace.zip') });
        console.log(`Trace saved: ${path.join(outputDir, 'trace.zip')}`);
    }

    await context.close();

    console.log(`Downloads: ${[...savedFiles.keys()].join(', ')}`);

    // ── Save logs ────────────────────────────────────────────────

    await writeFile(path.join(outputDir, `${browserName}.log`), logs.join('\n'));
    if (memoryTimeline.length > 0) {
        await writeFile(path.join(outputDir, 'memory.json'), JSON.stringify(memoryTimeline, null, 2));
    }

    // ── Extract fingerprint from saved PDFs ──────────────────────

    console.log('Extracting fingerprint...');

    const fingerprint = await extractFingerprint(savedFiles, {
        browser: browserName,
        elapsedSeconds: parseFloat(elapsed),
        peakMemoryMB: memoryTimeline.length > 0
            ? Math.max(...memoryTimeline.map(m => m.totalMemMB))
            : undefined,
    });

    const fingerprintPath = path.join(outputDir, `${browserName}-fingerprint.json`);
    await writeFile(fingerprintPath, JSON.stringify(fingerprint, null, 2));
    console.log(`Fingerprint saved: ${fingerprintPath}`);

    return fingerprint;
}

/**
 * Extract a fingerprint from saved PDF files.
 *
 * @param {Map<string, string>} savedFiles - filename → path
 * @param {{ browser: string, elapsedSeconds: number, peakMemoryMB?: number }} meta
 * @returns {Promise<GeneratorFingerprint>}
 */
export async function extractFingerprint(savedFiles, meta) {
    const { PDFDocument, PDFName, PDFArray, PDFRef, PDFDict, decodePDFRawStream } =
        await import(path.join(BASE, 'packages/pdf-lib/pdf-lib.esm.js'));

    /** @type {GeneratorFingerprint} */
    const fingerprint = {
        generatedAt: new Date().toISOString(),
        browser: meta.browser,
        elapsedSeconds: meta.elapsedSeconds,
        peakMemoryMB: meta.peakMemoryMB,
        pdfs: {},
    };

    for (const [filename, filePath] of savedFiles) {
        if (!filename.endsWith('.pdf')) continue;

        const pdfBytes = await readFile(filePath);
        const pdfDoc = await PDFDocument.load(pdfBytes);
        const pages = pdfDoc.getPages();

        /** @type {PDFFingerprint} */
        const pdfFingerprint = {
            filename,
            pageCount: pages.length,
            totalBytes: pdfBytes.length,
            pdfHash: createHash('sha256').update(pdfBytes).digest('hex'),
            pages: [],
        };

        for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
            const pageObj = pages[pageIndex];
            const pageDict = pdfDoc.context.lookup(pageObj.ref);
            const contentsRef = pageDict.get(PDFName.of('Contents'));

            const streamFingerprints = [];
            const streamRefs = [];

            if (contentsRef instanceof PDFRef) {
                const contents = pdfDoc.context.lookup(contentsRef);
                if (contents instanceof PDFArray) {
                    for (let i = 0; i < contents.size(); i++) streamRefs.push(contents.get(i));
                } else {
                    streamRefs.push(contentsRef);
                }
            }

            for (let si = 0; si < streamRefs.length; si++) {
                const ref = streamRefs[si];
                const stream = ref instanceof PDFRef ? pdfDoc.context.lookup(ref) : ref;
                if (!stream?.contents) continue;

                const compressedSize = stream.contents.length;
                let uncompressedSize = 0;
                let hash = '';
                const colorOperators = { 'cs/CS': 0, 'sc/SC/scn/SCN': 0, 'g/G': 0, 'rg/RG': 0, 'k/K': 0 };
                /** @type {string[]} */
                const sampleValues = [];

                try {
                    const decoded = decodePDFRawStream(stream).decode();
                    uncompressedSize = decoded.length;
                    hash = createHash('sha256').update(decoded).digest('hex');

                    const text = new TextDecoder('latin1').decode(decoded);
                    colorOperators['cs/CS'] = (text.match(/\b(cs|CS)\b/g) || []).length;
                    colorOperators['sc/SC/scn/SCN'] = (text.match(/\b(scn|SCN|sc|SC)\b/g) || []).length;
                    colorOperators['g/G'] = (text.match(/\b[gG]\b/g) || []).length;
                    colorOperators['rg/RG'] = (text.match(/\b(rg|RG)\b/g) || []).length;
                    colorOperators['k/K'] = (text.match(/\b[kK]\b/g) || []).length;

                    const kMatches = text.matchAll(/([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+[kK]\b/g);
                    let count = 0;
                    for (const match of kMatches) {
                        if (count++ >= 20) break;
                        sampleValues.push(`${match[1]} ${match[2]} ${match[3]} ${match[4]}`);
                    }
                } catch {
                    hash = 'DECODE_ERROR';
                }

                streamFingerprints.push({ ref: String(ref), compressedSize, uncompressedSize, hash, colorOperators, sampleValues });
            }

            const resources = pageDict.get(PDFName.of('Resources'));
            const resourcesDict = resources instanceof PDFRef ? pdfDoc.context.lookup(resources) : resources;
            const xObjectDict = resourcesDict?.get?.(PDFName.of('XObject'));
            const imageFingerprints = [];

            if (xObjectDict) {
                const xoDict = xObjectDict instanceof PDFRef ? pdfDoc.context.lookup(xObjectDict) : xObjectDict;
                if (xoDict instanceof PDFDict) {
                    for (const [key, value] of xoDict.entries()) {
                        const name = key instanceof PDFName ? key.decodeText() : String(key);
                        const imgRef = value instanceof PDFRef ? value : null;
                        if (!imgRef) continue;
                        const imgStream = pdfDoc.context.lookup(imgRef);
                        if (!imgStream?.dict) continue;

                        const subtype = imgStream.dict.get(PDFName.of('Subtype'));
                        if (!(subtype instanceof PDFName) || subtype.decodeText() !== 'Image') continue;

                        const width = imgStream.dict.get(PDFName.of('Width'));
                        const height = imgStream.dict.get(PDFName.of('Height'));
                        const bpc = imgStream.dict.get(PDFName.of('BitsPerComponent'));
                        const cs = imgStream.dict.get(PDFName.of('ColorSpace'));

                        imageFingerprints.push({
                            name,
                            ref: String(imgRef),
                            width: width?.value ?? width?.numberValue,
                            height: height?.value ?? height?.numberValue,
                            bitsPerComponent: bpc?.value ?? bpc?.numberValue,
                            colorSpace: cs instanceof PDFName ? cs.decodeText() : String(cs),
                            compressedSize: imgStream.contents?.length ?? 0,
                        });
                    }
                }
            }

            pdfFingerprint.pages.push({ pageIndex, contentStreams: streamFingerprints, images: imageFingerprints });
        }

        fingerprint.pdfs[filename] = pdfFingerprint;
    }

    return fingerprint;
}

/**
 * Compare two fingerprints and report differences.
 *
 * @param {GeneratorFingerprint} baseline
 * @param {GeneratorFingerprint} actual
 * @returns {{ failures: number, warnings: number }}
 */
export function compareFingerprints(baseline, actual) {
    let failures = 0;
    let warnings = 0;

    // Match PDFs by suffix pattern (filenames differ in browser/OS label)
    // e.g. "...Docket - Chrome 147 (macOS).pdf" vs "...Docket - Safari 18 (macOS).pdf"
    // Extract the part before the browser label
    /** @param {string} filename @returns {string} */
    const pdfKey = (filename) => {
        // Strip browser/OS suffix: " - Chrome 147 (macOS)" or " - Safari 18 (macOS)"
        return filename.replace(/\s*-\s*(?:Chrome|Safari|Firefox|WebKit)\s+\d+[^.]*/, '');
    };

    const baselinePDFs = new Map(Object.entries(baseline.pdfs).map(([f, p]) => [pdfKey(f), p]));
    const actualPDFs = new Map(Object.entries(actual.pdfs).map(([f, p]) => [pdfKey(f), p]));

    // Check all baseline PDFs are present
    for (const [key, bp] of baselinePDFs) {
        const ap = actualPDFs.get(key);
        if (!ap) {
            console.log(`FAIL  Missing PDF: ${bp.filename}`);
            failures++;
            continue;
        }

        if (bp.pageCount !== ap.pageCount) {
            console.log(`FAIL  ${key}: page count ${bp.pageCount} → ${ap.pageCount}`);
            failures++;
            continue;
        }

        let pdfOK = true;

        for (let p = 0; p < bp.pages.length; p++) {
            const bPage = bp.pages[p];
            const aPage = ap.pages[p];

            if (bPage.contentStreams.length !== aPage.contentStreams.length) {
                console.log(`FAIL  ${key} page ${p + 1}: stream count ${bPage.contentStreams.length} → ${aPage.contentStreams.length}`);
                failures++;
                pdfOK = false;
                continue;
            }

            for (let s = 0; s < bPage.contentStreams.length; s++) {
                const bs = bPage.contentStreams[s];
                const as = aPage.contentStreams[s];

                if (bs.hash === as.hash) continue;

                // Hash differs — check operator counts
                let opMismatch = false;
                for (const opKey of Object.keys(bs.colorOperators)) {
                    if (bs.colorOperators[opKey] !== as.colorOperators[opKey]) {
                        console.log(`FAIL  ${key} page ${p + 1} stream ${s + 1}: ${opKey} ${bs.colorOperators[opKey]} → ${as.colorOperators[opKey]}`);
                        opMismatch = true;
                        failures++;
                    }
                }

                if (!opMismatch) {
                    // Check sampled values with tolerance
                    let valueMismatch = false;
                    const count = Math.min(bs.sampleValues.length, as.sampleValues.length);
                    for (let v = 0; v < count; v++) {
                        const bVals = bs.sampleValues[v].split(' ').map(Number);
                        const aVals = as.sampleValues[v].split(' ').map(Number);
                        const maxDelta = Math.max(...bVals.map((bv, i) => Math.abs(bv - (aVals[i] ?? 0))));
                        if (maxDelta > 0.001) {
                            console.log(`FAIL  ${key} page ${p + 1} stream ${s + 1} sample ${v}: delta=${maxDelta.toFixed(6)}`);
                            valueMismatch = true;
                            failures++;
                            break;
                        }
                    }
                    if (!valueMismatch) {
                        console.log(`WARN  ${key} page ${p + 1} stream ${s + 1}: hash differs (float rounding) but values match`);
                        warnings++;
                    }
                }
                pdfOK = false;
            }

            // Image comparison
            if (bPage.images.length !== aPage.images.length) {
                console.log(`FAIL  ${key} page ${p + 1}: image count ${bPage.images.length} → ${aPage.images.length}`);
                failures++;
                pdfOK = false;
            } else {
                for (let i = 0; i < bPage.images.length; i++) {
                    const bi = bPage.images[i];
                    const ai = aPage.images[i];
                    if (bi.width !== ai.width || bi.height !== ai.height || bi.bitsPerComponent !== ai.bitsPerComponent) {
                        console.log(`FAIL  ${key} page ${p + 1} image ${bi.name}: dimensions/bpc mismatch`);
                        failures++;
                        pdfOK = false;
                    }
                }
            }
        }

        if (pdfOK) {
            console.log(`PASS  ${key}: ${bp.pageCount} pages`);
        }
    }

    // Check for unexpected extra PDFs
    for (const [key] of actualPDFs) {
        if (!baselinePDFs.has(key)) {
            console.log(`WARN  Extra PDF not in baseline: ${key}`);
            warnings++;
        }
    }

    return { failures, warnings };
}
