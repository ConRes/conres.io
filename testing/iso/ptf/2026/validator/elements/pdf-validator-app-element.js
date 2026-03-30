// @ts-check
/**
 * PDFValidatorAppElement — Custom element for the PDF validator UI.
 *
 * Handles file selection/drop, validation, report rendering,
 * fix approval, and fixed PDF download.
 *
 * Supports two execution modes (same pattern as generator):
 * - **Main thread**: Runs validation directly (blocking, for debugging).
 * - **Worker thread**: Runs validation in a worker (default, non-blocking).
 *
 * When debugging details is open, appends browser/OS to download filenames
 * for parallel test identification (same pattern as generator).
 *
 * @author Saleh Abdel Motaal <dev@smotaal.io>
 * @ai Claude Opus 4.6 (code generation)
 */

import { downloadArrayBufferAs } from '../../helpers.js';
import { getEnvironmentDescriptor } from '../../generator/classes/environment-descriptor.js';
import { CONTEXT_PREFIX } from '../../services/helpers/runtime.js';

/**
 * @typedef {import('../../classes/baseline/pdf-preflight-validator.js').PreflightReport} PreflightReport
 * @typedef {import('../../classes/baseline/pdf-preflight-validator.js').PreflightFinding} PreflightFinding
 * @typedef {import('../classes/pdf-preflight-fixer.js').ChangelogEntry} ChangelogEntry
 */

// ============================================================================
// localStorage Persistence
// ============================================================================

const STORAGE_KEY = 'conres-testform-validator-state';

/**
 * @returns {Record<string, unknown> | null}
 */
function loadPersistedState() {
    try {
        const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
}

/**
 * @param {Record<string, unknown>} state
 */
function savePersistedState(state) {
    try {
        globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
        // Storage full or unavailable — silently ignore
    }
}

// ============================================================================
// Changelog Aggregation
// ============================================================================

/**
 * Format a list of page numbers as a human-readable string.
 *
 * @param {number[]} pages — sorted
 * @returns {string}
 * @example formatPageList([1]) → "page 1"
 * @example formatPageList([1, 2, 3]) → "pages 1, 2 and 3"
 * @example formatPageList([1, 2, 3, 4, 5]) → "pages 1, 2, 3, 4 and 5"
 */
function formatPageList(pages) {
    if (pages.length === 0) return 'no pages';
    if (pages.length === 1) return `page ${pages[0]}`;
    const last = pages[pages.length - 1];
    const rest = pages.slice(0, -1);
    return `pages ${rest.join(', ')} and ${last}`;
}

/**
 * Aggregate verbose changelog entries into concise summary lines.
 *
 * Input:  66 entries like "Set TrimBox from MediaBox on page 1", "Set BleedBox from MediaBox on page 1", ...
 * Output: "Set TrimBox, BleedBox, CropBox from MediaBox — all 22 pages"
 *
 * Non-page entries pass through unchanged.
 *
 * @param {import('../classes/pdf-preflight-fixer.js').ChangelogEntry[]} changelog
 * @returns {string[]}
 */
function aggregateChangelog(changelog) {
    // Group page-scoped geometry entries by fixId
    /** @type {Map<string, { pages: Set<number>, boxes: Set<string>, other: string[] }>} */
    const groups = new Map();
    /** @type {string[]} */
    const nonPageEntries = [];

    for (const entry of changelog) {
        // Detect page-scoped geometry entries: "Set <Box> from MediaBox on page <N>"
        const pageMatch = entry.description.match(/^Set (\w+) from MediaBox on page (\d+)$/);
        if (pageMatch && entry.fixId === 'set-geometry-from-mediabox') {
            const box = pageMatch[1];
            const page = parseInt(pageMatch[2], 10);
            if (!groups.has(entry.fixId)) groups.set(entry.fixId, { pages: new Set(), boxes: new Set(), other: [] });
            const group = /** @type {*} */ (groups.get(entry.fixId));
            group.pages.add(page);
            group.boxes.add(box);
            continue;
        }

        // Detect page-scoped entries with other patterns
        const genericPageMatch = entry.description.match(/on page (\d+)$/);
        if (genericPageMatch && entry.fixId) {
            if (!groups.has(entry.fixId)) groups.set(entry.fixId, { pages: new Set(), boxes: new Set(), other: [] });
            const group = /** @type {*} */ (groups.get(entry.fixId));
            group.pages.add(parseInt(genericPageMatch[1], 10));
            // Store the description template (without page number) for reconstruction
            const template = entry.description.replace(/on page \d+$/, '').trim();
            if (!group.other.includes(template)) group.other.push(template);
            continue;
        }

        nonPageEntries.push(entry.description);
    }

    /** @type {string[]} */
    const result = [];

    for (const [fixId, group] of groups) {
        const pageList = [...group.pages].sort((a, b) => a - b);
        const pageDesc = formatPageList(pageList);

        if (group.boxes.size > 0) {
            result.push(`Set ${[...group.boxes].join(', ')} from MediaBox \u2014 ${pageDesc}`);
        } else if (group.other.length > 0) {
            for (const template of group.other) {
                result.push(`${template} \u2014 ${pageDesc}`);
            }
        }
    }

    result.push(...nonPageEntries);
    return result;
}

// ============================================================================
// PDFValidatorAppElement
// ============================================================================

export class PDFValidatorAppElement extends HTMLElement {
    /** @type {ArrayBuffer | null} */
    #pdfBuffer = null;

    /** @type {string} */
    #pdfFilename = '';

    /** @type {PreflightReport | null} */
    #report = null;

    /** @type {ArrayBuffer | null} */
    #fixedPdfBuffer = null;

    /** @type {import('pdf-lib').PDFDocument | null} */
    #document = null;

    /** @type {boolean} */
    #validating = false;

    /** @type {Worker | null} */
    #activeWorker = null;

    connectedCallback() {
        this.#restorePersistedState();
    }

    configure() {
        this.#bindDropZone();
        this.#bindActions();
        this.#bindPersistence();
    }

    // ========================================================================
    // localStorage Persistence (same pattern as generator)
    // ========================================================================

    #persistState() {
        /** @type {Record<string, unknown>} */
        const state = loadPersistedState() ?? {};

        // Checkboxes (by id)
        for (const checkbox of /** @type {NodeListOf<HTMLInputElement>} */ (this.querySelectorAll('input[type="checkbox"][id]'))) {
            state[`checkbox:${checkbox.id}`] = checkbox.checked;
        }

        // Details open state
        for (const details of /** @type {NodeListOf<HTMLDetailsElement>} */ (this.querySelectorAll('details[id]'))) {
            state[`details:${details.id}`] = details.open;
        }

        savePersistedState(state);
    }

    #restorePersistedState() {
        const state = loadPersistedState();
        if (!state) return;

        // Checkboxes
        for (const [key, value] of Object.entries(state)) {
            if (!key.startsWith('checkbox:')) continue;
            const id = key.slice('checkbox:'.length);
            const checkbox = /** @type {HTMLInputElement | null} */ (this.querySelector(`#${id}`));
            if (checkbox) checkbox.checked = /** @type {boolean} */ (value);
        }

        // Details open state
        for (const [key, value] of Object.entries(state)) {
            if (!key.startsWith('details:')) continue;
            const id = key.slice('details:'.length);
            const details = /** @type {HTMLDetailsElement | null} */ (this.querySelector(`#${id}`));
            if (details && value) details.open = true;
        }
    }

    #bindPersistence() {
        // Persist on checkbox changes
        this.addEventListener('change', (e) => {
            const target = /** @type {HTMLElement} */ (e.target);
            if (target instanceof HTMLInputElement && target.type === 'checkbox') {
                this.#persistState();
            }
        });

        // Persist on details toggle
        for (const details of /** @type {NodeListOf<HTMLDetailsElement>} */ (this.querySelectorAll('details[id]'))) {
            details.addEventListener('toggle', () => this.#persistState());
        }
    }

    // ========================================================================
    // Drop zone
    // ========================================================================

    #bindDropZone() {
        const fileInput = /** @type {HTMLInputElement} */ (this.querySelector('#pdf-input'));

        fileInput.addEventListener('change', () => {
            const file = fileInput.files?.[0];
            if (file) this.#handleFile(file);
        });
    }

    /**
     * @param {File} file
     */
    async #handleFile(file) {
        console.log(`${CONTEXT_PREFIX} [PDFValidatorApp] File selected: ${file.name} (${(file.size / (1024 * 1024)).toFixed(1)} MB)`);
        this.#pdfFilename = file.name;
        this.#pdfBuffer = await file.arrayBuffer();
        this.#fixedPdfBuffer = null;
        this.#document = null;
        this.#report = null;

        const fileInfo = /** @type {HTMLElement} */ (this.querySelector('#file-info'));
        const sizeMB = (this.#pdfBuffer.byteLength / (1024 * 1024)).toFixed(1);
        fileInfo.textContent = `${file.name} (${sizeMB} MB)`;
        fileInfo.hidden = false;

        // Reset report/fix UI
        this.#resetReportUI();

        // Enable validate button
        /** @type {HTMLButtonElement} */ (this.querySelector('#validate-button')).disabled = false;
    }

    /**
     * Reset report, actions, and changelog UI to initial state.
     * Does NOT clear the file input or buffer.
     */
    #resetReportUI() {
        this.querySelector('#report-fieldset')?.setAttribute('hidden', '');
        this.querySelector('#summary-fieldset')?.setAttribute('hidden', '');
        this.querySelector('#actions-fieldset')?.setAttribute('hidden', '');
        this.querySelector('#changelog-fieldset')?.setAttribute('hidden', '');
        this.#hideProgress();
        /** @type {HTMLButtonElement} */ (this.querySelector('#download-button')).disabled = true;
        /** @type {HTMLButtonElement} */ (this.querySelector('#fix-all-button')).disabled = true;
        /** @type {HTMLButtonElement} */ (this.querySelector('#fix-selected-button')).disabled = true;
    }

    /**
     * Full reset — clear everything and return to initial state.
     * The file input is NOT cleared (user can re-validate the same file).
     */
    #reset() {
        console.log(`${CONTEXT_PREFIX} [PDFValidatorApp] Reset`);
        this.#report = null;
        this.#fixedPdfBuffer = null;
        this.#document = null;
        this.#resetReportUI();

        // Re-enable input
        /** @type {HTMLFieldSetElement} */ (this.querySelector('#input-fieldset')).disabled = false;
        this.querySelector('#debugging-details')?.removeAttribute('inert');
        /** @type {HTMLButtonElement} */ (this.querySelector('#validate-button')).disabled = !this.#pdfBuffer;
        /** @type {HTMLButtonElement} */ (this.querySelector('#validate-button')).textContent = 'Validate';
    }

    // ========================================================================
    // Validation
    // ========================================================================

    /**
     * Whether debugging details is open.
     * When debugging is open and bootstrap worker is unchecked, use main thread.
     */
    get #isDebugging() {
        return /** @type {HTMLDetailsElement} */ (
            this.querySelector('#debugging-details')
        )?.open ?? false;
    }

    /**
     * Whether to use the bootstrap worker (same pattern as generator).
     * When debugging details is closed, always use worker (default).
     */
    get #useBootstrapWorker() {
        if (!this.#isDebugging) return true;
        return /** @type {HTMLInputElement} */ (
            this.querySelector('#bootstrap-worker-checkbox')
        )?.checked ?? true;
    }

    /**
     * Lock the UI during validation — disable input, swap Validate→Cancel.
     */
    #lockUI() {
        this.#validating = true;
        /** @type {HTMLFieldSetElement} */ (this.querySelector('#input-fieldset')).disabled = true;
        this.querySelector('#debugging-details')?.setAttribute('inert', '');
        const btn = /** @type {HTMLButtonElement} */ (this.querySelector('#validate-button'));
        btn.disabled = false; // Keep enabled as Cancel
        btn.textContent = 'Cancel';
    }

    /**
     * Unlock the UI after validation completes or is cancelled.
     */
    #unlockUI() {
        this.#validating = false;
        /** @type {HTMLFieldSetElement} */ (this.querySelector('#input-fieldset')).disabled = false;
        this.querySelector('#debugging-details')?.removeAttribute('inert');
        const btn = /** @type {HTMLButtonElement} */ (this.querySelector('#validate-button'));
        btn.textContent = 'Validate';
        btn.disabled = !this.#pdfBuffer;
    }

    async #runValidation() {
        if (!this.#pdfBuffer) return;

        const mode = this.#useBootstrapWorker ? 'worker' : 'main thread';
        console.log(`${CONTEXT_PREFIX} [PDFValidatorApp] Starting validation (${mode})\u2026`);
        console.time(`${CONTEXT_PREFIX} [PDFValidatorApp] Validation`);

        this.#resetReportUI();
        this.#lockUI();
        this.#showProgress('Validating...', 0);

        try {
            if (this.#useBootstrapWorker) {
                await this.#validateInWorker();
            } else {
                await this.#validateOnMainThread();
            }
        } finally {
            console.timeEnd(`${CONTEXT_PREFIX} [PDFValidatorApp] Validation`);
            this.#unlockUI();
        }
    }

    async #validateOnMainThread() {
        try {
            this.#showProgress('Loading PDF...', 10);
            console.log(`${CONTEXT_PREFIX} [PDFValidatorApp] Loading PDF on main thread\u2026`);

            const { PDFDocument } = await import('../../packages/pdf-lib/pdf-lib.esm.js');
            const { PDFPreflightFixerValidator } = await import('../classes/pdf-preflight-fixer-validator.js');
            const rulesResponse = await fetch(new URL('../../classes/configurations/preflight-rules.json', import.meta.url).href);
            const rules = await rulesResponse.json();

            let report;
            try {
                this.#showProgress('Parsing PDF...', 30);
                this.#document = await PDFDocument.load(this.#pdfBuffer, { updateMetadata: false });

                this.#showProgress('Evaluating rules...', 60);
                const fv = new PDFPreflightFixerValidator(this.#document, rules);
                report = fv.validate();
                this.#report = report;
            } catch (loadError) {
                report = PDFPreflightFixerValidator.validateLoadError
                    ? PDFPreflightFixerValidator.validateLoadError(loadError, rules)
                    : { documentInfo: { pageCount: 0, producer: '', pdfVersion: '', fileSize: null }, findings: [{ ruleId: 'document-damaged', status: 'fail', severity: 'error', scope: 'document', location: null, fixId: null, displayName: 'Document is damaged', description: loadError.message, details: {} }], summary: { errors: 1, warnings: 0, passed: 0, skipped: 0 } };
                this.#report = report;
                this.#document = null;
            }

            this.#showProgress('Complete', 100);
            this.#hideProgress();
            console.log(`${CONTEXT_PREFIX} [PDFValidatorApp] Validation complete:`, {
                errors: report.summary.errors,
                warnings: report.summary.warnings,
                passed: report.summary.passed,
                skipped: report.summary.skipped,
                pages: report.documentInfo.pageCount,
            });
            this.#renderReport(report);
        } catch (error) {
            this.#hideProgress();
            console.error(`${CONTEXT_PREFIX} [PDFValidatorApp] Validation error:`, error);
            alert(`Validation failed: ${error.message}`);
        }
    }

    async #validateInWorker() {
        try {
            this.#showProgress('Starting worker...', 5);
            console.log(`${CONTEXT_PREFIX} [PDFValidatorApp] Creating module worker\u2026`);

            const workerURL = new URL('../bootstrap-worker-entrypoint.js', import.meta.url).href;
            const worker = new Worker(workerURL, { type: 'module' });
            this.#activeWorker = worker;
            const taskId = `validate-${Date.now()}`;

            /** @type {(value: PreflightReport) => void} */
            let resolveReport;
            const reportPromise = new Promise(resolve => { resolveReport = resolve; });

            worker.addEventListener('message', (e) => {
                const data = e.data;
                if (data.taskId !== taskId) return;

                switch (data.type) {
                    case 'progress':
                        this.#showProgress(data.message, data.percent);
                        break;
                    case 'report':
                        this.#report = data.report;
                        resolveReport(data.report);
                        break;
                    case 'error':
                        console.error('[PDFValidatorApp] Worker error:', data.message);
                        resolveReport(/** @type {*} */ (null));
                        break;
                }
            });

            // Send a copy to the worker — keep the original for fixing later
            const bufferCopy = this.#pdfBuffer.slice(0);
            worker.postMessage(
                { type: 'validate', taskId, pdfBuffer: bufferCopy },
                [bufferCopy],
            );

            const report = await reportPromise;
            worker.terminate();
            this.#activeWorker = null;
            console.log(`${CONTEXT_PREFIX} [PDFValidatorApp] Worker terminated`);

            this.#hideProgress();
            if (report) {
                console.log(`${CONTEXT_PREFIX} [PDFValidatorApp] Validation complete:`, {
                    errors: report.summary.errors,
                    warnings: report.summary.warnings,
                    passed: report.summary.passed,
                    skipped: report.summary.skipped,
                    pages: report.documentInfo.pageCount,
                });
                this.#renderReport(report);
            } else {
                console.error(`${CONTEXT_PREFIX} [PDFValidatorApp] Validation returned no report`);
                alert('Validation failed — check console for details.');
            }
        } catch (error) {
            this.#hideProgress();
            console.error(`${CONTEXT_PREFIX} [PDFValidatorApp] Worker error:`, error);
            alert(`Worker error: ${error.message}`);
        }
    }

    // ========================================================================
    // Report rendering
    // ========================================================================

    /**
     * @param {PreflightReport} report
     */
    #renderReport(report) {
        // Document info — proper HTML structure
        const docInfoEl = /** @type {HTMLElement} */ (this.querySelector('#document-info'));
        docInfoEl.innerHTML = '';
        const dl = document.createElement('dl');
        dl.className = 'doc-info';
        dl.style.cssText = 'display:grid; grid-template-columns:auto 1fr; gap:0.25em 1em; margin:0;';
        for (const [label, value] of [
            ['Pages', String(report.documentInfo.pageCount)],
            ['Producer', report.documentInfo.producer || '(none)'],
            ['PDF Version', report.documentInfo.pdfVersion],
        ]) {
            const dt = document.createElement('dt');
            dt.style.cssText = 'font-weight:bold; text-align:right;';
            dt.textContent = label;
            const dd = document.createElement('dd');
            dd.style.margin = '0';
            dd.textContent = value;
            dl.append(dt, dd);
        }
        docInfoEl.appendChild(dl);

        // Summary bar
        /** @type {HTMLElement} */ (this.querySelector('#summary-errors')).textContent = `${report.summary.errors} error${report.summary.errors !== 1 ? 's' : ''}`;
        /** @type {HTMLElement} */ (this.querySelector('#summary-warnings')).textContent = `${report.summary.warnings} warning${report.summary.warnings !== 1 ? 's' : ''}`;
        /** @type {HTMLElement} */ (this.querySelector('#summary-passed')).textContent = `${report.summary.passed} passed`;
        /** @type {HTMLElement} */ (this.querySelector('#summary-skipped')).textContent = `${report.summary.skipped} skipped`;
        this.querySelector('#summary-fieldset')?.removeAttribute('hidden');

        // Findings by ruleId (group same rule)
        /** @type {Map<string, (PreflightFinding & { fixDescription?: string })[]>} */
        const byRule = new Map();
        for (const f of report.findings) {
            if (!byRule.has(f.ruleId)) byRule.set(f.ruleId, []);
            byRule.get(f.ruleId).push(f);
        }

        const reportEl = /** @type {HTMLElement} */ (this.querySelector('#report'));
        reportEl.innerHTML = '';

        for (const [ruleId, findings] of byRule) {
            const first = findings[0];
            const failCount = findings.filter(f => f.status === 'fail').length;
            const passCount = findings.filter(f => f.status === 'pass').length;
            const effectiveStatus = failCount > 0 ? 'fail' : passCount > 0 ? 'pass' : 'skipped';
            const effectiveSeverity = failCount > 0 ? first.severity : first.severity;

            const statusIcon = effectiveStatus === 'fail'
                ? (effectiveSeverity === 'error' ? '\u2716' : '\u26A0')
                : effectiveStatus === 'pass' ? '\u2714' : '\u2014';

            const findingEl = document.createElement('div');
            findingEl.className = 'finding';
            findingEl.dataset.status = effectiveStatus;
            findingEl.dataset.severity = effectiveSeverity;

            let html = `<span class="status-icon">${statusIcon}</span><span>`;
            html += `<strong>${first.displayName}</strong>`;

            // Itemized details for failures
            if (failCount > 0) {
                const failedFindings = findings.filter(f => f.status === 'fail');

                if (first.scope === 'page') {
                    // Page-scoped: list affected pages on one line
                    const pageNumbers = failedFindings
                        .map(f => f.location?.page)
                        .filter(Boolean)
                        .sort((a, b) => /** @type {number} */ (a) - /** @type {number} */ (b));
                    if (pageNumbers.length === findings.length) {
                        html += ` \u2014 all ${pageNumbers.length} pages`;
                    } else {
                        html += ` \u2014 ${pageNumbers.length} of ${findings.length} pages: ${pageNumbers.join(', ')}`;
                    }
                } else if (first.scope === 'object' && failedFindings.length > 0) {
                    // Object-scoped: list refs
                    const refs = failedFindings.map(f => f.location?.ref).filter(Boolean);
                    if (refs.length > 0) {
                        html += ` \u2014 ${refs.length} object${refs.length !== 1 ? 's' : ''}: ${refs.join(', ')}`;
                    }
                } else if (failedFindings.length > 1) {
                    html += ` (${failedFindings.length} instances)`;
                }

                // Fix description
                if (/** @type {*} */ (first).fixDescription) {
                    html += `<br><span class="finding-details">${/** @type {*} */ (first).fixDescription}</span>`;
                }
            }

            html += `</span>`;

            if (first.fixId && failCount > 0) {
                html += `<input type="checkbox" class="fix-check" data-fix-id="${first.fixId}" checked />`;
            }

            findingEl.innerHTML = html;
            reportEl.appendChild(findingEl);
        }

        this.querySelector('#report-fieldset')?.removeAttribute('hidden');

        // Actions — fix buttons enabled if there are fixable findings AND we have a buffer to load from
        const hasFixable = report.findings.some(f => f.status === 'fail' && f.fixId);
        const canFix = hasFixable && (!!this.#document || !!this.#pdfBuffer);
        /** @type {HTMLButtonElement} */ (this.querySelector('#fix-all-button')).disabled = !canFix;
        /** @type {HTMLButtonElement} */ (this.querySelector('#fix-selected-button')).disabled = !canFix;
        this.querySelector('#actions-fieldset')?.removeAttribute('hidden');
    }

    // ========================================================================
    // Actions
    // ========================================================================

    #bindActions() {
        // Validate / Cancel button
        this.querySelector('#validate-button')?.addEventListener('click', (e) => {
            e.preventDefault();
            if (this.#validating) {
                // Cancel
                console.log(`${CONTEXT_PREFIX} [PDFValidatorApp] Validation cancelled by user`);
                if (this.#activeWorker) {
                    this.#activeWorker.terminate();
                    this.#activeWorker = null;
                    console.log(`${CONTEXT_PREFIX} [PDFValidatorApp] Worker terminated`);
                }
                this.#unlockUI();
                this.#hideProgress();
            } else {
                this.#runValidation();
            }
        });

        this.querySelector('#fix-all-button')?.addEventListener('click', () => this.#handleFixAll());
        this.querySelector('#fix-selected-button')?.addEventListener('click', () => this.#handleFixSelected());
        this.querySelector('#download-button')?.addEventListener('click', () => this.#handleDownload());

        // Reset button — clear report, re-enable input, keep file loaded
        this.querySelector('#reset-button')?.addEventListener('click', (e) => {
            e.preventDefault();
            this.#reset();
        });
    }

    async #handleFixAll() {
        if (!this.#report) return;
        console.log(`${CONTEXT_PREFIX} [PDFValidatorApp] Fix All requested`);
        const fixIds = [...new Set(
            this.#report.findings
                .filter(f => f.status === 'fail' && f.fixId)
                .map(f => /** @type {string} */ (f.fixId))
        )];
        await this.#applyFixes(fixIds);
    }

    async #handleFixSelected() {
        if (!this.#report) return;
        const checkboxes = this.querySelectorAll('.fix-check:checked');
        const fixIds = [...new Set(
            Array.from(checkboxes).map(cb => /** @type {HTMLInputElement} */ (cb).dataset.fixId).filter(Boolean)
        )];
        if (fixIds.length === 0) return;
        await this.#applyFixes(/** @type {string[]} */ (fixIds));
    }

    /**
     * @param {string[]} fixIds
     */
    async #applyFixes(fixIds) {
        console.log(`${CONTEXT_PREFIX} [PDFValidatorApp] Applying fixes:`, fixIds);
        console.time(`${CONTEXT_PREFIX} [PDFValidatorApp] Fix`);

        try {
            // If document not loaded yet (worker path), load it now for fixing
            if (!this.#document && this.#pdfBuffer) {
                this.#showProgress('Loading PDF for fix...', 10);
                console.log(`${CONTEXT_PREFIX} [PDFValidatorApp] Loading document for fix (${(this.#pdfBuffer.byteLength / (1024 * 1024)).toFixed(1)} MB)\u2026`);
                const { PDFDocument } = await import('../../packages/pdf-lib/pdf-lib.esm.js');
                this.#document = await PDFDocument.load(this.#pdfBuffer, { updateMetadata: false });
                console.log(`${CONTEXT_PREFIX} [PDFValidatorApp] Document loaded: ${this.#document.getPageCount()} pages`);
            }

            if (!this.#document) {
                console.error(`${CONTEXT_PREFIX} [PDFValidatorApp] No PDF buffer available for fix`);
                alert('No PDF loaded — cannot apply fixes.');
                return;
            }

            const { PDFPreflightFixer } = await import('../classes/pdf-preflight-fixer.js');
            const fixer = new PDFPreflightFixer(this.#document);
            const changelog = fixer.applyFixes(fixIds);
            console.log(`${CONTEXT_PREFIX} [PDFValidatorApp] Fixes applied:`, changelog.length, 'changes');

            // Show aggregated changelog
            const changelogEl = /** @type {HTMLElement} */ (this.querySelector('#changelog-fieldset'));
            const listEl = /** @type {HTMLElement} */ (this.querySelector('#changelog-list'));
            listEl.innerHTML = aggregateChangelog(changelog).map(line => `<li>${line}</li>`).join('');
            changelogEl.hidden = false;

            // Save fixed PDF
            this.#showProgress('Saving fixed PDF...', 50);
            const savedBytes = await this.#document.save({
                addDefaultPage: false,
                updateFieldAppearances: false,
            });
            this.#fixedPdfBuffer = savedBytes.buffer;
            this.#hideProgress();
            console.log(`${CONTEXT_PREFIX} [PDFValidatorApp] Fixed PDF saved: ${(savedBytes.length / (1024 * 1024)).toFixed(1)} MB`);

            // Enable download
            /** @type {HTMLButtonElement} */ (this.querySelector('#download-button')).disabled = false;

            // Re-validate and update report
            const { PDFPreflightFixerValidator } = await import('../classes/pdf-preflight-fixer-validator.js');
            const rulesResponse = await fetch(new URL('../../classes/configurations/preflight-rules.json', import.meta.url).href);
            const rules = await rulesResponse.json();

            // Reload from saved bytes to get a clean document
            const { PDFDocument } = await import('pdf-lib');
            this.#document = await PDFDocument.load(this.#fixedPdfBuffer, { updateMetadata: false });
            const fv = new PDFPreflightFixerValidator(this.#document, rules);
            const newReport = fv.validate();
            this.#report = newReport;
            console.log(`${CONTEXT_PREFIX} [PDFValidatorApp] Re-validation after fix:`, {
                errors: newReport.summary.errors,
                warnings: newReport.summary.warnings,
                passed: newReport.summary.passed,
            });
            console.timeEnd(`${CONTEXT_PREFIX} [PDFValidatorApp] Fix`);
            this.#renderReport(newReport);

        } catch (error) {
            console.timeEnd(`${CONTEXT_PREFIX} [PDFValidatorApp] Fix`);
            this.#hideProgress();
            console.error(`${CONTEXT_PREFIX} [PDFValidatorApp] Fix error:`, error);
            alert(`Fix failed: ${error.message}`);
        }
    }

    async #handleDownload() {
        if (!this.#fixedPdfBuffer) return;
        console.log(`${CONTEXT_PREFIX} [PDFValidatorApp] Downloading fixed PDF\u2026`);

        const isDebugging = /** @type {HTMLDetailsElement} */ (
            this.querySelector('#debugging-details')
        )?.open ?? false;

        const environmentSuffix = isDebugging ? ` - ${getEnvironmentDescriptor().label}` : '';
        const baseName = this.#pdfFilename.replace(/\.pdf$/i, '');
        const filename = `${baseName} - Fixed${environmentSuffix}.pdf`;

        console.log(`${CONTEXT_PREFIX} [PDFValidatorApp] Download filename: ${filename}`);
        await downloadArrayBufferAs(this.#fixedPdfBuffer, filename, 'application/pdf');
    }

    // ========================================================================
    // Progress
    // ========================================================================

    /**
     * @param {string} message
     * @param {number} percent
     */
    #showProgress(message, percent) {
        const fieldset = /** @type {HTMLElement} */ (this.querySelector('#progress-fieldset'));
        const bar = /** @type {HTMLProgressElement} */ (this.querySelector('#validation-progress'));
        const output = /** @type {HTMLElement} */ (this.querySelector('#validation-progress-output'));
        fieldset.style.opacity = '1';
        bar.value = percent;
        output.textContent = message;
    }

    #hideProgress() {
        /** @type {HTMLElement} */ (this.querySelector('#progress-fieldset')).style.opacity = '0';
    }
}
