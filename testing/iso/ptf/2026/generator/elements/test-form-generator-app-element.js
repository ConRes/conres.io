// @ts-check
/**
 * TestFormGeneratorAppElement — Custom element for the test form generator UI.
 *
 * Binds to form elements in the light DOM (slotted into shadow DOM),
 * handles validation, progress reporting, and file downloads.
 *
 * Supports two execution modes:
 * - **Main thread**: Runs the generator directly (blocking).
 * - **Bootstrap Worker**: Offloads the entire generation pipeline to a
 *   dedicated Web Worker, keeping the UI responsive.
 *
 * @module TestFormGeneratorAppElement
 * @author Saleh Abdel Motaal <dev@smotaal.io>
 * @ai Claude Opus 4.6 (code generation)
 */

import { downloadArrayBufferAs } from '../../helpers.js';

import { CONTEXT_PREFIX } from '../../services/helpers/runtime.js';
import { TestFormPDFDocumentGenerator } from '../classes/test-form-pdf-document-generator.js';
import { getEnvironmentDescriptor } from '../classes/environment-descriptor.js';

/**
 * @typedef {import('../classes/test-form-pdf-document-generator.js').UserMetadata} UserMetadata
 */

/**
 * @typedef {import('../generator.js').ResolvedAssetEntry} ResolvedAssetEntry
 */

/**
 * Custom element for the test form generator UI.
 *
 * Binds to the form elements in the light DOM (slotted into shadow DOM),
 * handles validation, progress reporting, and file downloads.
 *
 * @extends HTMLElement
 */
// ============================================================================
// localStorage Persistence
// ============================================================================

const STORAGE_KEY = 'conres-testform-generator-state';

/**
 * Loads persisted form state from localStorage.
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
 * Saves form state to localStorage.
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
// TestFormGeneratorAppElement
// ============================================================================

export class TestFormGeneratorAppElement extends HTMLElement {

    /** @type {ResolvedAssetEntry[] | null} */
    #assets = null;

    /** @type {boolean} */
    #generating = false;

    /** @type {(() => void) | null} */
    #cancelGeneration = null;

    /** @type {boolean} */
    #cancelled = false;

    /**
     * Configures the app element with resolved asset entries from assets.json.
     *
     * @param {{ assets: ResolvedAssetEntry[] }} options
     */
    configure({ assets }) {
        this.#assets = assets;
        // Re-run guidance now that assets are available
        // (connectedCallback's fetch may have completed before configure was called)
        if (this.#details) {
            this.#populateStaticContent();
            this.#checkVersionChange();
            this.#updateTestFormGuidance();
            this.#updateBitDepthGuidance();
            this.#updateProfileGuidance();
            this.#updateDocketAwareGuidance();
        }
    }

    /** @type {boolean} */
    #filtersPopulated = false;

    /** @type {import('./test-form-pdf-document-generator.js').TestFormManifest | null} */
    #cachedManifest = null;

    /** @type {import('../classes/assembly-policy-resolver.js').AssemblyPolicyResolver | null} */
    #cachedPolicyResolver = null;

    /** @type {string | null} */
    #cachedManifestVersion = null;

    /** @type {Record<string, any> | null} */
    #details = null;

    // ========================================
    // Recommended Version Detection
    // ========================================

    /**
     * Determines the recommended test form version from the assets list.
     * The recommended version is the first entry without "(8-bit)" or "- Maps" suffix.
     * @returns {string | null}
     */
    get #recommendedVersion() {
        if (!this.#assets) return null;
        const entry = this.#assets.find(a => {
            const name = a.name ?? '';
            return !name.includes('(8-bit)') && !name.includes('- Maps');
        });
        return entry?.name ?? null;
    }

    // ========================================
    // Dynamic Field Guidance
    // ========================================

    /**
     * Applies a guidance entry from details.json to a guidance element and
     * optionally a target element (for highlight).
     *
     * Each entry is `{ text, warn?, highlight? }` with optional `{{key}}`
     * interpolation via the replacements parameter.
     *
     * @param {HTMLElement | null} guidanceElement - The `<small>` guidance container
     * @param {{ text: string, warn?: boolean, highlight?: boolean } | null | undefined} entry
     * @param {HTMLElement | null} [targetElement] - Element to apply highlight class to
     * @param {Record<string, string>} [replacements] - `{{key}}` interpolation values
     */
    #applyGuidance(guidanceElement, entry, targetElement, replacements) {
        if (!guidanceElement) return;
        if (!entry) {
            guidanceElement.textContent = '';
            guidanceElement.classList.remove('field-guidance-warn');
            targetElement?.classList.remove('field-highlight');
            return;
        }

        let text = entry.text ?? '';
        if (replacements) {
            for (const [key, value] of Object.entries(replacements)) {
                text = text.replaceAll(`{{${key}}}`, value);
            }
        }

        guidanceElement.textContent = text;
        guidanceElement.classList.toggle('field-guidance-warn', !!entry.warn);
        targetElement?.classList.toggle('field-highlight', !!entry.highlight);
    }

    /**
     * Populates static content from details.json (overview, requirements, modal).
     * Called once when details.json is loaded.
     */
    #populateStaticContent() {
        if (!this.#details) return;

        const intro = /** @type {HTMLElement | null} */ (this.querySelector('#overview-introduction'));
        if (intro) intro.textContent = this.#details.overview?.introduction ?? '';

        const list = /** @type {HTMLElement | null} */ (this.querySelector('#requirements-list'));
        if (list) {
            list.innerHTML = '';
            for (const item of this.#details.overview?.requirements ?? []) {
                const li = document.createElement('li');
                li.textContent = item;
                list.appendChild(li);
            }
        }

        this.#populateDocumentationModal();

        document.querySelector('#read-more-button')?.addEventListener('click', () => {
            /** @type {HTMLDialogElement | null} */ (
                document.querySelector('#documentation-modal')
            )?.showModal();
        });
    }

    /**
     * Populates the documentation modal from details.json.
     */
    #populateDocumentationModal() {
        const docs = this.#details?.documentation;
        if (!docs) return;

        const title = /** @type {HTMLElement | null} */ (document.querySelector('#documentation-modal-title'));
        if (title) title.textContent = docs.title ?? '';

        const container = /** @type {HTMLElement | null} */ (document.querySelector('#documentation-modal-content'));
        if (!container) return;
        container.innerHTML = '';

        for (const section of docs.sections ?? []) {
            const h3 = document.createElement('h3');
            h3.textContent = section.heading ?? '';
            container.appendChild(h3);

            if (section.content) {
                const p = document.createElement('p');
                p.textContent = section.content;
                container.appendChild(p);
            }

            if (section.list?.length) {
                const ul = document.createElement('ul');
                for (const item of section.list) {
                    const li = document.createElement('li');
                    li.textContent = item;
                    ul.appendChild(li);
                }
                container.appendChild(ul);
            }

            if (section.footer) {
                const footer = document.createElement('p');
                footer.className = 'doc-section-footer';
                footer.textContent = section.footer;
                container.appendChild(footer);
            }
        }
    }

    /**
     * Whether the currently selected test form uses a docket (vs legacy metadata.json).
     * Checks the cached manifest if available; otherwise infers from the recommended
     * version (current versions use docket, older versions may not).
     * @returns {boolean}
     */
    get #hasDocket() {
        if (this.#cachedManifest) return !!this.#cachedManifest.docket;
        // Infer: the recommended version (most recent) uses docket
        const selected = /** @type {HTMLSelectElement | null} */ (
            this.querySelector('#test-form-version-select')
        )?.value ?? '';
        return selected === this.#recommendedVersion || selected.includes('(F10');
    }

    /**
     * Updates guidance for specification fields and generation section
     * based on whether the selected test form uses docket or metadata.json.
     */
    #updateDocketAwareGuidance() {
        if (!this.#details) return;
        const key = this.#hasDocket ? 'withDocket' : 'withoutDocket';

        this.#applyGuidance(
            this.querySelector('#specifications-guidance'),
            this.#details.fields?.specifications?.[key],
        );
        this.#applyGuidance(
            this.querySelector('#generation-guidance'),
            this.#details.fields?.generation?.[key],
        );
    }

    /**
     * Updates guidance text and highlight state for the test form version field.
     */
    #updateTestFormGuidance() {
        const guidance = /** @type {HTMLElement | null} */ (this.querySelector('#test-form-version-guidance'));
        const select = /** @type {HTMLSelectElement | null} */ (this.querySelector('#test-form-version-select'));
        if (!guidance || !select || !this.#details) return;

        const selected = select.value;
        const recommended = this.#recommendedVersion;
        const fields = this.#details.fields?.testFormVersion;
        if (!fields || !recommended) return;

        const key = selected === recommended ? 'recommended'
            : selected.includes('(8-bit)') ? 'eightBit'
            : selected.includes('- Maps') ? 'maps'
            : 'nonRecommended';

        this.#applyGuidance(guidance, fields[key], select.closest('label'), { recommended });
    }

    /**
     * Updates guidance text for the output bit depth field.
     */
    #updateBitDepthGuidance() {
        const guidance = /** @type {HTMLElement | null} */ (this.querySelector('#output-bit-depth-guidance'));
        if (!guidance || !this.#details) return;

        const selected = /** @type {HTMLInputElement | null} */ (
            this.querySelector('input[name="bit-depth-mode"]:checked')
        )?.value;
        const fields = this.#details.fields?.outputBitDepth;
        if (!fields || !selected) return;

        this.#applyGuidance(guidance, fields[selected]);
    }

    /**
     * Updates guidance text for the output profile field.
     * @param {{ colorSpace?: string, description?: string, profileCategory?: string }} [profileInfo]
     */
    #updateProfileGuidance(profileInfo) {
        const guidance = /** @type {HTMLElement | null} */ (this.querySelector('#output-profile-guidance'));
        if (!guidance || !this.#details) return;

        const fields = this.#details.fields?.outputProfile;
        if (!fields) return;

        if (!profileInfo) {
            this.#applyGuidance(guidance, fields.default);
            return;
        }

        const cs = profileInfo.colorSpace?.toUpperCase();
        const desc = profileInfo.description ?? 'Unknown';
        const key = cs === 'GRAY' ? 'gray'
            : cs === 'CMYK' && profileInfo.profileCategory === 'CMYK-MaxGCR' ? 'cmykMaxGCR'
            : cs === 'CMYK' ? 'cmyk'
            : cs === 'RGB' ? 'rgb'
            : 'default';

        this.#applyGuidance(guidance, fields[key], null, { description: desc });
    }

    /** @type {boolean} */
    #versionNoticeActive = false;

    /**
     * Checks persisted state for version changes and handles reset.
     * Called during connectedCallback after state restoration.
     *
     * The new-version notice persists until the earliest of:
     * 1. User changes the test form field
     * 2. A generation completes successfully (not cancelled)
     * 3. End of the calendar day (UTC) when the notice was first shown
     */
    #checkVersionChange() {
        const state = loadPersistedState();
        const recommended = this.#recommendedVersion;
        if (!state || !recommended) return;

        const previousRecommended = state['recommendedAtSave'];
        const noticeShownAt = state['versionNoticeShownAt'];

        // Check if a prior notice should still be displayed
        if (noticeShownAt) {
            const shownDate = new Date(noticeShownAt).toISOString().slice(0, 10);
            const today = new Date().toISOString().slice(0, 10);
            if (shownDate === today) {
                // Same calendar day — re-show the notice
                this.#showVersionNotice();
                return;
            }
            // Past the calendar day — clear the notice state
            delete state['versionNoticeShownAt'];
            savePersistedState(state);
        }

        if (previousRecommended && previousRecommended !== recommended) {
            // Recommended version has changed since last save — reset test form selection
            const select = /** @type {HTMLSelectElement | null} */ (this.querySelector('#test-form-version-select'));
            if (select && [...select.options].some(opt => opt.value === recommended)) {
                select.value = recommended;
                this.#showVersionNotice();
                // Persist the updated selection with notice timestamp
                state['versionNoticeShownAt'] = new Date().toISOString();
                savePersistedState(state);
                this.#persistState();
            }
        }
    }

    /**
     * Shows the new-version notice on the test form field.
     */
    #showVersionNotice() {
        this.#versionNoticeActive = true;
        const select = this.querySelector('#test-form-version-select');
        this.#applyGuidance(
            this.querySelector('#test-form-version-guidance'),
            this.#details?.fields?.testFormVersion?.newVersionAvailable,
            select?.closest('label'),
        );
    }

    /**
     * Dismisses the new-version notice.
     * Called when the user changes the test form field or completes generation.
     */
    #dismissVersionNotice() {
        if (!this.#versionNoticeActive) return;
        this.#versionNoticeActive = false;
        const state = loadPersistedState();
        if (state) {
            delete state['versionNoticeShownAt'];
            savePersistedState(state);
        }
        // Guidance will be updated to the normal state by #updateTestFormGuidance
    }

    connectedCallback() {
        // ----------------------------------------------------------------
        // Restore persisted state from localStorage
        // ----------------------------------------------------------------
        this.#restorePersistedState();

        // ----------------------------------------------------------------
        // Load field guidance details (after state restoration so guidance
        // reflects the restored selection, not the HTML default)
        // ----------------------------------------------------------------
        fetch(new URL('../details.json', import.meta.url).href)
            .then(r => r.json())
            .then(details => {
                this.#details = details;
                this.#populateStaticContent();
                this.#checkVersionChange();
                this.#updateTestFormGuidance();
                this.#updateBitDepthGuidance();
                this.#updateProfileGuidance();
                this.#updateDocketAwareGuidance();
            })
            .catch(() => { /* details.json not available — guidance disabled */ });

        // Bind Clear Cache button
        const clearCacheButton = this.querySelector('#test-form-clear-cache-button');
        if (clearCacheButton) {
            clearCacheButton.addEventListener('click', (event) => {
                event.preventDefault();
                this.#handleClearCache();
            });
        }

        // Bind Generate/Cancel button
        const generateButton = this.querySelector('#test-form-generation-button');
        if (generateButton) {
            generateButton.addEventListener('click', (event) => {
                event.preventDefault();
                if (this.#generating) {
                    if (confirm('Cancel the current generation?')) {
                        this.#cancelled = true;
                        this.#cancelGeneration?.();
                    }
                } else {
                    this.#handleGenerate();
                }
            });
        }

        // Populate customization filter toggles on first <details> open
        const customizationDetails = this.querySelector('#customization-details');
        if (customizationDetails) {
            customizationDetails.addEventListener('toggle', () => {
                if (/** @type {HTMLDetailsElement} */ (customizationDetails).open) {
                    this.#ensureFiltersPopulated();
                }
                this.#persistState();
            });
        }

        // Toggle debugging mode when debugging details opens/closes
        const debuggingDetails = this.querySelector('#debugging-details');
        if (debuggingDetails) {
            debuggingDetails.addEventListener('toggle', () => {
                this.#updateRequiredState();
                this.#persistState();
            });
        }
        this.#updateRequiredState();

        // Re-populate filters when test form version changes
        const testFormVersionSelect = this.querySelector('#test-form-version-select');
        if (testFormVersionSelect) {
            testFormVersionSelect.addEventListener('change', () => {
                this.#dismissVersionNotice();
                this.#cachedManifestVersion = null;
                this.#cachedManifest = null;
                this.#filtersPopulated = false;
                const details = /** @type {HTMLDetailsElement | null} */ (
                    this.querySelector('#customization-details')
                );
                if (details?.open) this.#ensureFiltersPopulated();
                this.#updateTestFormGuidance();
                this.#updateBitDepthGuidance();
                this.#updateDocketAwareGuidance();
                this.#persistState();
            });
        }

        // Update auto state and profile guidance when ICC profile changes
        const iccProfileInput = this.querySelector('#icc-profile-input');
        if (iccProfileInput) {
            iccProfileInput.addEventListener('change', () => {
                this.#updateAutoState();
            });
        }

        // Update bit depth guidance when selection changes
        for (const radio of this.querySelectorAll('input[name="bit-depth-mode"]')) {
            radio.addEventListener('change', () => {
                this.#updateBitDepthGuidance();
                this.#persistState();
            });
        }

        // Auto-switch to custom mode when checkboxes are clicked in each section
        for (const [containerId, radioName] of [
            ['#layout-toggles-container', 'layout-mode'],
            ['#color-space-toggles-container', 'color-space-mode'],
            ['#rendering-intent-checkboxes', 'rendering-intent-mode'],
        ]) {
            const container = this.querySelector(containerId);
            if (container) {
                container.addEventListener('change', (event) => {
                    if (/** @type {HTMLElement} */ (event.target).matches('input[type="checkbox"]')) {
                        const customRadio = /** @type {HTMLInputElement | null} */ (
                            this.querySelector(`input[name="${radioName}"][value="custom"]`)
                        );
                        if (customRadio) customRadio.checked = true;
                    }
                    this.#persistState();
                });
            }
        }

        // When an auto/custom radio switches back to auto, re-apply auto
        // checkbox values so the user sees what will actually happen.
        /** @type {[string, string][]} */
        const modeRadioMap = [
            ['layout-mode', '#layout-toggles-container'],
            ['color-space-mode', '#color-space-toggles-container'],
            ['rendering-intent-mode', '#rendering-intent-checkboxes'],
        ];
        for (const [radioName, containerSelector] of modeRadioMap) {
            for (const radio of /** @type {NodeListOf<HTMLInputElement>} */ (
                this.querySelectorAll(`input[name="${radioName}"]`)
            )) {
                radio.addEventListener('change', () => {
                    this.#applyAutoStateIfAutoMode(radioName, containerSelector);
                });
            }
        }

        // ----------------------------------------------------------------
        // Persist state on any form control change
        // ----------------------------------------------------------------
        this.addEventListener('change', (event) => {
            const target = /** @type {HTMLElement} */ (event.target);
            // Persist on changes to selects, radios, checkboxes, text inputs
            // but ignore file inputs (ICC profile can't be restored)
            if (target.matches('select, input[type="radio"], input[type="checkbox"], input[type="text"], input[type="email"]')) {
                this.#persistState();
            }
        });
    }

    // ======================================================================
    // localStorage Persistence: Collect and Restore
    // ======================================================================

    /**
     * Collects current form state and saves to localStorage.
     *
     * Persists: select values, radio selections, named checkbox states,
     * text input values, details open/closed state, and dynamic filter
     * checkbox states (by value).
     */
    #persistState() {
        // Start from the existing saved state so that keys for controls
        // not yet in the DOM (e.g., dynamic checkboxes before async
        // population completes) are preserved rather than dropped.
        /** @type {Record<string, unknown>} */
        const state = loadPersistedState() ?? {};

        // Select elements
        for (const select of /** @type {NodeListOf<HTMLSelectElement>} */ (this.querySelectorAll('select[id]'))) {
            state[`select:${select.id}`] = select.value;
        }

        // Radio groups (by name)
        /** @type {Set<string>} */
        const radioNames = new Set();
        for (const radio of /** @type {NodeListOf<HTMLInputElement>} */ (this.querySelectorAll('input[type="radio"][name]'))) {
            radioNames.add(radio.name);
        }
        for (const name of radioNames) {
            const checked = /** @type {HTMLInputElement | null} */ (
                this.querySelector(`input[type="radio"][name="${name}"]:checked`)
            );
            if (checked) state[`radio:${name}`] = checked.value;
        }

        // Named checkboxes (static, identified by id)
        for (const checkbox of /** @type {NodeListOf<HTMLInputElement>} */ (this.querySelectorAll('input[type="checkbox"][id]'))) {
            state[`checkbox:${checkbox.id}`] = checkbox.checked;
        }

        // Text and email inputs
        for (const input of /** @type {NodeListOf<HTMLInputElement>} */ (this.querySelectorAll('input[type="text"][id], input[type="email"][id]'))) {
            if (input.value) state[`text:${input.id}`] = input.value;
        }

        // Details open state
        for (const [selector, stateKey] of [
            ['#customization-details', 'details:customization'],
            ['#debugging-details', 'details:debugging'],
        ]) {
            const details = /** @type {HTMLDetailsElement | null} */ (this.querySelector(selector));
            if (details) state[stateKey] = details.open;
        }

        // Dynamic filter checkboxes (layouts, color spaces, intents — keyed by value).
        // Only overwrite a dynamic key when the checkboxes actually exist in the DOM.
        // If they haven't been populated yet (async), the existing saved values survive.
        for (const [containerId, stateKey] of [
            ['#layout-toggles-container', 'filter-layouts'],
            ['#color-space-toggles-container', 'filter-color-spaces'],
            ['#rendering-intent-checkboxes', 'filter-intents'],
        ]) {
            const checkboxes = /** @type {NodeListOf<HTMLInputElement>} */ (
                this.querySelectorAll(`${containerId} input[type="checkbox"]`)
            );
            if (checkboxes.length > 0) {
                /** @type {Record<string, boolean>} */
                const values = {};
                for (const cb of checkboxes) values[cb.value] = cb.checked;
                state[`dynamic:${stateKey}`] = values;
            }
            // When checkboxes.length === 0, the existing state[`dynamic:${stateKey}`]
            // from loadPersistedState() is preserved — not overwritten.
        }

        // Track the recommended version at save time for version change detection
        const recommended = this.#recommendedVersion;
        if (recommended) state['recommendedAtSave'] = recommended;

        savePersistedState(state);
    }

    /**
     * Restores form state from localStorage.
     *
     * Called once during connectedCallback, before event listeners are bound.
     * Only restores values that exist in the persisted state — missing keys
     * leave the HTML defaults intact.
     */
    #restorePersistedState() {
        const state = loadPersistedState();
        if (!state) return;

        // Select elements
        for (const select of /** @type {NodeListOf<HTMLSelectElement>} */ (this.querySelectorAll('select[id]'))) {
            const key = `select:${select.id}`;
            if (key in state) {
                const value = /** @type {string} */ (state[key]);
                // Only restore if the option still exists
                if ([...select.options].some(opt => opt.value === value)) {
                    select.value = value;
                }
            }
        }

        // Radio groups
        for (const [key, value] of Object.entries(state)) {
            if (!key.startsWith('radio:')) continue;
            const name = key.slice('radio:'.length);
            const radio = /** @type {HTMLInputElement | null} */ (
                this.querySelector(`input[type="radio"][name="${name}"][value="${value}"]`)
            );
            if (radio) radio.checked = true;
        }

        // Named checkboxes
        for (const [key, value] of Object.entries(state)) {
            if (!key.startsWith('checkbox:')) continue;
            const id = key.slice('checkbox:'.length);
            const checkbox = /** @type {HTMLInputElement | null} */ (
                this.querySelector(`#${id}`)
            );
            if (checkbox) checkbox.checked = /** @type {boolean} */ (value);
        }

        // Text inputs
        for (const [key, value] of Object.entries(state)) {
            if (!key.startsWith('text:')) continue;
            const id = key.slice('text:'.length);
            const input = /** @type {HTMLInputElement | null} */ (
                this.querySelector(`#${id}`)
            );
            if (input) input.value = /** @type {string} */ (value);
        }

        // Details open state
        for (const [selector, stateKey] of [
            ['#customization-details', 'details:customization'],
            ['#debugging-details', 'details:debugging'],
        ]) {
            if (stateKey in state) {
                const details = /** @type {HTMLDetailsElement | null} */ (this.querySelector(selector));
                if (details && state[stateKey]) details.open = true;
            }
        }

        // Dynamic filter checkboxes are restored after population
        // (see #restoreDynamicFilterState, called from #ensureFiltersPopulated)
    }

    /**
     * Restores dynamic filter checkbox states after they've been populated.
     * Called from #ensureFiltersPopulated after checkboxes are created.
     */
    #restoreDynamicFilterState() {
        const state = loadPersistedState();
        if (!state) return;

        for (const [containerId, stateKey] of [
            ['#layout-toggles-container', 'filter-layouts'],
            ['#color-space-toggles-container', 'filter-color-spaces'],
            ['#rendering-intent-checkboxes', 'filter-intents'],
        ]) {
            const key = `dynamic:${stateKey}`;
            if (!(key in state)) continue;

            const savedValues = /** @type {Record<string, boolean>} */ (state[key]);
            const checkboxes = /** @type {NodeListOf<HTMLInputElement>} */ (
                this.querySelectorAll(`${containerId} input[type="checkbox"]`)
            );
            for (const cb of checkboxes) {
                if (cb.value in savedValues) {
                    cb.checked = savedValues[cb.value];
                }
            }
        }

        // Also restore radio states for filter mode (auto/custom)
        // These are already restored in #restorePersistedState for static radios,
        // but the filter section may not have been visible then.
        for (const radioName of ['layout-mode', 'color-space-mode', 'rendering-intent-mode']) {
            const key = `radio:${radioName}`;
            if (key in state) {
                const radio = /** @type {HTMLInputElement | null} */ (
                    this.querySelector(`input[type="radio"][name="${radioName}"][value="${state[key]}"]`)
                );
                if (radio) radio.checked = true;
            }
        }
    }

    /**
     * Ensures the filter toggles are populated from the manifest and policy.
     * Re-populates if the test form version changed since last population.
     */
    async #ensureFiltersPopulated() {
        const testFormVersionSelect = /** @type {HTMLSelectElement | null} */ (
            this.querySelector('#test-form-version-select')
        );
        const currentVersion = testFormVersionSelect?.value ?? null;

        // Skip if already populated for this version
        if (this.#filtersPopulated && this.#cachedManifestVersion === currentVersion) return;

        this.#filtersPopulated = true;
        this.#cachedManifestVersion = currentVersion;

        try {
            // Load assembly policy (cached across calls)
            if (!this.#cachedPolicyResolver) {
                const { AssemblyPolicyResolver } = await import('../classes/assembly-policy-resolver.js');
                this.#cachedPolicyResolver = await AssemblyPolicyResolver.load();
            }

            const policyData = this.#cachedPolicyResolver.policyData;

            // Load manifest for layout and color space names
            const assetEntry = this.#assets?.find((entry) => entry.name === currentVersion);

            if (assetEntry?.resources?.manifest) {
                const manifestResponse = await fetch(assetEntry.resources.manifest);
                this.#cachedManifest = await manifestResponse.json();
            }

            const manifest = this.#cachedManifest;

            if (manifest) {
                // Populate layout checkboxes from manifest (all unique layout names)
                const layoutContainer = this.querySelector('#layout-toggles-container');
                if (layoutContainer && manifest.layouts) {
                    const uniqueLayouts = [...new Set(manifest.layouts.map(
                        (/** @type {{ layout: string }} */ l) => l.layout,
                    ))];
                    layoutContainer.innerHTML = uniqueLayouts.map(name =>
                        `<label style="display:block;"><input type="checkbox" value="${name}" checked />${name}</label>`
                    ).join('');
                }

                // Populate color space checkboxes from manifest (all color space names)
                const colorSpaceContainer = this.querySelector('#color-space-toggles-container');
                if (colorSpaceContainer && manifest.colorSpaces) {
                    const colorSpaceNames = Object.keys(manifest.colorSpaces);
                    colorSpaceContainer.innerHTML = colorSpaceNames.map(name => {
                        const type = manifest.colorSpaces[name]?.type ?? '';
                        return `<label style="display:block;"><input type="checkbox" value="${name}"` +
                            ` data-color-space-type="${type}" checked />${name} (${type})</label>`;
                    }).join('');
                }
            }

            // Populate rendering intent checkboxes from policy (never from manifest)
            const intentContainer = this.querySelector('#rendering-intent-checkboxes');
            if (intentContainer && policyData.availableCustomIntents) {
                intentContainer.innerHTML = policyData.availableCustomIntents.map(intent =>
                    `<label style="display:block;"><input type="checkbox"` +
                    ` value="${intent.label}"` +
                    ` data-rendering-intent="${intent.renderingIntent}"` +
                    ` data-black-point-compensation="${intent.blackPointCompensation}"` +
                    ` data-label="${intent.label}"` +
                    ` />${intent.label}</label>`
                ).join('');
            }

            // Restore persisted dynamic filter states (checkboxes + radios)
            this.#restoreDynamicFilterState();

            // Apply auto state based on current ICC profile
            // (only updates sections still in auto mode after restore)
            await this.#updateAutoState();

        } catch (error) {
            console.warn(`${CONTEXT_PREFIX} [TestFormGeneratorAppElement] Failed to populate filter toggles:`, error);
        }
    }

    /**
     * Updates the auto-mode checkbox states based on the current ICC profile
     * and the cached manifest + assembly policy.
     *
     * Uses only the ICC header color space (lightweight parse) to determine
     * the profile category for auto preview. For CMYK profiles, the auto
     * preview conservatively shows the non-Max GCR category (which includes
     * all color spaces and both rendering intents); the actual Max GCR test
     * runs at generation time.
     */
    async #updateAutoState() {
        const manifest = this.#cachedManifest;
        const policyResolver = this.#cachedPolicyResolver;
        if (!manifest || !policyResolver) return;

        const policyData = policyResolver.policyData;

        // Analyze the ICC profile to determine the full profile category,
        // including Max GCR detection for CMYK profiles.
        const iccProfileInput = /** @type {HTMLInputElement | null} */ (
            this.querySelector('#icc-profile-input')
        );
        const iccProfileFile = iccProfileInput?.files?.[0];

        /** @type {string} */
        let previewCategory = 'CMYK'; // default when no profile selected

        if (iccProfileFile) {
            try {
                const { ICCService } = await import('../../services/ICCService.js');
                const { OutputProfileAnalyzer } = await import('../classes/output-profile-analyzer.js');

                const buffer = await iccProfileFile.arrayBuffer();
                const header = ICCService.parseICCHeaderFromSource(buffer);

                const analysis = await OutputProfileAnalyzer.analyzeProfile(
                    buffer, header, policyData.maxGCRTest, policyData.profileCategories,
                );
                previewCategory = analysis.profileCategory;
                this.#updateProfileGuidance({ colorSpace: header.colorSpace, description: header.description, profileCategory: previewCategory });

                console.log(`${CONTEXT_PREFIX} [TestFormGeneratorAppElement] Auto preview: profile category = ${previewCategory}`);
            } catch (error) {
                console.warn(`${CONTEXT_PREFIX} [TestFormGeneratorAppElement] Failed to analyze ICC profile for auto preview:`, error);
                this.#updateProfileGuidance();
            }
        } else {
            this.#updateProfileGuidance();
        }

        const categoryDefinition = policyData.profileCategories[previewCategory];
        if (!categoryDefinition) return;

        const includedTypes = new Set(categoryDefinition.includedColorSpaceTypes);
        const excludedTypes = new Set(categoryDefinition.excludedColorSpaceTypes);

        // --- Color Spaces auto state ---
        const colorSpaceCheckboxes = /** @type {NodeListOf<HTMLInputElement>} */ (
            this.querySelectorAll('#color-space-toggles-container input[type="checkbox"]')
        );
        for (const checkbox of colorSpaceCheckboxes) {
            const type = checkbox.dataset.colorSpaceType ?? '';
            const included = !excludedTypes.has(type)
                && (includedTypes.size === 0 || includedTypes.has(type));
            checkbox.dataset.autoChecked = included ? 'true' : 'false';
        }

        // --- Layouts auto state ---
        // A layout is auto-included if it has at least one variant in an included color space
        const layoutCheckboxes = /** @type {NodeListOf<HTMLInputElement>} */ (
            this.querySelectorAll('#layout-toggles-container input[type="checkbox"]')
        );
        for (const checkbox of layoutCheckboxes) {
            const layoutName = checkbox.value;
            const hasIncludedVariant = manifest.layouts.some(
                (/** @type {{ layout: string, colorSpace: string }} */ l) => {
                    if (l.layout !== layoutName) return false;
                    const type = manifest.colorSpaces[l.colorSpace]?.type ?? '';
                    return !excludedTypes.has(type)
                        && (includedTypes.size === 0 || includedTypes.has(type));
                },
            );
            checkbox.dataset.autoChecked = hasIncludedVariant ? 'true' : 'false';
        }

        // --- Rendering intents auto state ---
        const intentCheckboxes = /** @type {NodeListOf<HTMLInputElement>} */ (
            this.querySelectorAll('#rendering-intent-checkboxes input[type="checkbox"]')
        );
        const autoIntentLabels = new Set(
            categoryDefinition.renderingIntentPasses.map(
                (/** @type {{ label: string }} */ p) => p.label,
            ),
        );
        for (const checkbox of intentCheckboxes) {
            const label = checkbox.dataset.label ?? checkbox.value;
            checkbox.dataset.autoChecked = autoIntentLabels.has(label) ? 'true' : 'false';
        }

        // Apply auto state to all sections currently in auto mode
        this.#applyAutoStateIfAutoMode('layout-mode', '#layout-toggles-container');
        this.#applyAutoStateIfAutoMode('color-space-mode', '#color-space-toggles-container');
        this.#applyAutoStateIfAutoMode('rendering-intent-mode', '#rendering-intent-checkboxes');
    }

    /**
     * Applies the stored `data-auto-checked` state to checkboxes if the
     * section is in auto mode.
     *
     * @param {string} radioName - The name of the auto/custom radio group
     * @param {string} containerSelector - The CSS selector for the checkbox container
     */
    #applyAutoStateIfAutoMode(radioName, containerSelector) {
        const mode = /** @type {HTMLInputElement | null} */ (
            this.querySelector(`input[name="${radioName}"]:checked`)
        )?.value ?? 'auto';

        if (mode !== 'auto') return;

        const checkboxes = /** @type {NodeListOf<HTMLInputElement>} */ (
            this.querySelectorAll(`${containerSelector} input[type="checkbox"]`)
        );
        for (const checkbox of checkboxes) {
            checkbox.checked = checkbox.dataset.autoChecked === 'true';
        }
    }

    /**
     * Toggles the `required` attribute on specification inputs based on
     * whether the debugging details is open.
     *
     * When debugging is open, `required` is removed so inputs can be empty.
     * When debugging is closed, `required` is restored.
     * Pattern validation still applies to non-empty values regardless.
     */
    #updateRequiredState() {
        const debuggingDetails = /** @type {HTMLDetailsElement | null} */ (
            this.querySelector('#debugging-details')
        );
        const isDebugging = debuggingDetails?.open ?? false;

        for (const input of /** @type {NodeListOf<HTMLInputElement>} */ (
            this.querySelectorAll('#specifications input[data-required]')
        )) {
            input.required = !isDebugging;
        }
    }

    /**
     * Deletes the `conres-testforms` cache so all assets are re-fetched on the next generation.
     * Prompts for confirmation only when cache exists.
     */
    async #handleClearCache() {
        const hasCache = await globalThis.caches?.has?.('conres-testforms');
        if (!hasCache) return;
        if (!confirm('Clear the cached assets? They will be re-downloaded on the next generation.')) return;
        const deleted = await globalThis.caches?.delete?.('conres-testforms');
        console.log(`${CONTEXT_PREFIX} [TestFormGeneratorAppElement] Cache "conres-testforms" ${deleted ? 'cleared' : 'was already empty'}`);
    }

    /**
     * Handles the Generate button click: validates inputs, runs the generator,
     * and triggers file downloads.
     */
    async #handleGenerate() {
        // ----------------------------------------------------------------
        // Gather element references
        // ----------------------------------------------------------------
        const testFormVersionSelect = /** @type {HTMLSelectElement | null} */ (
            this.querySelector('#test-form-version-select')
        );
        const iccProfileInput = /** @type {HTMLInputElement | null} */ (
            this.querySelector('#icc-profile-input')
        );
        const generateButton = /** @type {HTMLButtonElement | null} */ (
            this.querySelector('#test-form-generation-button')
        );

        const overallProgress = /** @type {HTMLProgressElement | null} */ (
            this.querySelector('#test-form-generation-overall-progress')
        );
        const overallProgressOutput = /** @type {HTMLOutputElement | null} */ (
            this.querySelector('#test-form-generation-overall-progress-output')
        );
        const generationProgressFieldset = /** @type {HTMLFieldSetElement | null} */ (
            overallProgress?.closest('fieldset') ?? null
        );

        const subtaskProgress = /** @type {HTMLProgressElement | null} */ (
            this.querySelector('#test-form-generation-subtask-progress')
        );
        const subtaskProgressOutput = /** @type {HTMLOutputElement | null} */ (
            this.querySelector('#test-form-generation-subtask-progress-output')
        );
        const subtaskResultsOutput = /** @type {HTMLOutputElement | null} */ (
            this.querySelector('#test-form-generation-subtask-results-output')
        );

        const isDebugging = /** @type {HTMLDetailsElement | null} */ (
            this.querySelector('#debugging-details')
        )?.open ?? false;

        // ----------------------------------------------------------------
        // Read worker checkboxes and processing strategy selection
        // When debugging details is closed, use defaults (worker enabled, in-place)
        // ----------------------------------------------------------------
        const useBootstrapWorker = isDebugging
            ? (/** @type {HTMLInputElement | null} */ (this.querySelector('#bootstrap-worker-checkbox'))?.checked ?? true)
            : true;

        const useParallelWorkers = isDebugging
            ? (/** @type {HTMLInputElement | null} */ (this.querySelector('#parallel-workers-checkbox'))?.checked ?? true)
            : true;

        /** @type {'in-place' | 'separate-chains' | 'recombined-chains'} */
        const processingStrategy = isDebugging
            ? /** @type {any} */ (/** @type {HTMLInputElement | null} */ (this.querySelector('input[name="processing-strategy"]:checked'))?.value ?? 'in-place')
            : 'in-place';

        const includeOutputProfile = false;

        // ----------------------------------------------------------------
        // Read bit depth selection
        // ----------------------------------------------------------------
        const bitDepthRadio = /** @type {HTMLInputElement | null} */ (
            this.querySelector('input[name="bit-depth-mode"]:checked')
        );
        const bitDepthValue = bitDepthRadio?.value;

        /** @type {8 | 16 | undefined} */
        const outputBitsPerComponent = bitDepthValue === '8-bit' ? 8
            : bitDepthValue === '16-bit' ? 16
                : undefined;

        // ----------------------------------------------------------------
        // Collect assembly overrides from filter controls
        // When customization details is closed, treat all sections as auto.
        // Field values persist in the DOM for when the user reopens.
        // ----------------------------------------------------------------
        const isCustomizationOpen = /** @type {HTMLDetailsElement | null} */ (
            this.querySelector('#customization-details')
        )?.open ?? false;

        /** @type {import('../classes/assembly-policy-resolver.js').AssemblyUserOverrides | undefined} */
        let assemblyOverrides;

        const layoutMode = isCustomizationOpen
            ? (/** @type {HTMLInputElement | null} */ (this.querySelector('input[name="layout-mode"]:checked'))?.value ?? 'auto')
            : 'auto';

        const colorSpaceMode = isCustomizationOpen
            ? (/** @type {HTMLInputElement | null} */ (this.querySelector('input[name="color-space-mode"]:checked'))?.value ?? 'auto')
            : 'auto';

        const renderingIntentMode = isCustomizationOpen
            ? (/** @type {HTMLInputElement | null} */ (this.querySelector('input[name="rendering-intent-mode"]:checked'))?.value ?? 'auto')
            : 'auto';

        const isLayoutCustom = layoutMode === 'custom';
        const isColorSpaceCustom = colorSpaceMode === 'custom';
        const isIntentCustom = renderingIntentMode === 'custom';

        if (isLayoutCustom || isColorSpaceCustom || isIntentCustom) {
            assemblyOverrides = {};

            if (isLayoutCustom) {
                const layoutCheckboxes = /** @type {NodeListOf<HTMLInputElement>} */ (
                    this.querySelectorAll('#layout-toggles-container input[type="checkbox"]')
                );
                assemblyOverrides.enabledLayoutNames = [...layoutCheckboxes]
                    .filter(cb => cb.checked)
                    .map(cb => cb.value);
            }

            if (isColorSpaceCustom) {
                const colorSpaceCheckboxes = /** @type {NodeListOf<HTMLInputElement>} */ (
                    this.querySelectorAll('#color-space-toggles-container input[type="checkbox"]')
                );
                assemblyOverrides.enabledColorSpaceNames = [...colorSpaceCheckboxes]
                    .filter(cb => cb.checked)
                    .map(cb => cb.value);
            }

            if (isIntentCustom) {
                const intentCheckboxes = /** @type {NodeListOf<HTMLInputElement>} */ (
                    this.querySelectorAll('#rendering-intent-checkboxes input[type="checkbox"]:checked')
                );

                assemblyOverrides.renderingIntentOverrides = [...intentCheckboxes].map(cb => {
                    const data = cb.dataset;
                    return {
                        renderingIntent: /** @type {any} */ (data.renderingIntent),
                        blackPointCompensation: data.blackPointCompensation === 'true',
                        label: data.label ?? cb.value,
                    };
                });
            }
        }

        // ----------------------------------------------------------------
        // Validate all inputs (single alert for all issues)
        // ----------------------------------------------------------------
        const iccProfileFile = iccProfileInput?.files?.[0];

        /** @type {string[]} */
        const validationErrors = [];

        if (!iccProfileFile) {
            validationErrors.push('Please select a calibrated ICC profile.');
        }

        if (!isDebugging) {
            const fieldIds = ['device-input', 'colorants-input', 'substrate-input', 'settings-input', 'email-input'];
            const emptyFields = fieldIds.filter(id => {
                const input = /** @type {HTMLInputElement | null} */ (this.querySelector(`#${id}`));
                return !input?.value?.trim();
            });
            if (emptyFields.length > 0) {
                validationErrors.push('Please fill in all specification fields.');
            }
        }

        if (assemblyOverrides?.enabledLayoutNames?.length === 0) {
            validationErrors.push('All layouts are disabled. Enable at least one layout.');
        }
        if (assemblyOverrides?.enabledColorSpaceNames?.length === 0) {
            validationErrors.push('All color spaces are disabled. Enable at least one color space.');
        }
        if (assemblyOverrides?.renderingIntentOverrides?.length === 0) {
            validationErrors.push('No rendering intents selected. Select at least one or switch to Auto mode.');
        }

        if (validationErrors.length > 0) {
            alert(validationErrors.join('\n'));
            return;
        }

        // ----------------------------------------------------------------
        // Collect user metadata (debugging provides defaults for empty fields)
        // ----------------------------------------------------------------
        const debuggingDefaults = isDebugging ? {
            device: 'a device',
            colorants: 'some colorants',
            substrate: 'a substrate',
            settings: 'some settings',
            email: 'an email',
        } : undefined;

        /** @type {UserMetadata} */
        const userMetadata = {
            device: /** @type {HTMLInputElement} */ (this.querySelector('#device-input')).value || debuggingDefaults?.device || '',
            colorants: /** @type {HTMLInputElement} */ (this.querySelector('#colorants-input')).value || debuggingDefaults?.colorants || '',
            substrate: /** @type {HTMLInputElement} */ (this.querySelector('#substrate-input')).value || debuggingDefaults?.substrate || '',
            settings: /** @type {HTMLInputElement} */ (this.querySelector('#settings-input')).value || debuggingDefaults?.settings || '',
            email: /** @type {HTMLInputElement} */ (this.querySelector('#email-input')).value || debuggingDefaults?.email || '',
        };

        // ----------------------------------------------------------------
        // Lock UI: swap Generate→Cancel, disable fields, lock details
        // ----------------------------------------------------------------
        const allFieldsets = /** @type {NodeListOf<HTMLFieldSetElement>} */ (
            this.querySelectorAll('fieldset[name="assets-fieldset"], fieldset[name="output-fieldset"], fieldset[name="specifications-fieldset"], #customization-details fieldset, #debugging-details fieldset')
        );
        const allDetails = /** @type {NodeListOf<HTMLDetailsElement>} */ (
            this.querySelectorAll('#customization-details, #debugging-details')
        );

        /** @type {Map<HTMLDetailsElement, boolean>} */
        const detailsOpenState = new Map();

        for (const fieldset of allFieldsets) fieldset.disabled = true;

        /** @param {Event} e */
        const preventToggle = (e) => { e.preventDefault(); };
        for (const details of allDetails) {
            detailsOpenState.set(details, details.open);
            const summary = details.querySelector('summary');
            if (summary) {
                summary.addEventListener('click', preventToggle);
                summary.style.pointerEvents = 'none';
            }
            // Disable radios inside details legends (auto/custom)
            for (const radio of /** @type {NodeListOf<HTMLInputElement>} */ (
                details.querySelectorAll('legend input[type="radio"]')
            )) {
                radio.disabled = true;
            }
        }

        this.#generating = true;

        // Prevent accidental page close during generation
        /** @param {BeforeUnloadEvent} e */
        const beforeUnloadHandler = (e) => { e.preventDefault(); };
        globalThis.addEventListener('beforeunload', beforeUnloadHandler);

        // Acquire Screen Wake Lock to prevent sleep (if available)
        /** @type {WakeLockSentinel | null} */
        let wakeLock = null;
        try {
            wakeLock = await globalThis.navigator?.wakeLock?.request?.('screen');
        } catch {
            // Wake Lock not available or denied — continue without it
        }

        if (generateButton) {
            generateButton.textContent = 'Cancel';
        }
        if (generationProgressFieldset) generationProgressFieldset.style.opacity = '';

        if (overallProgress) {
            overallProgress.removeAttribute('value');
            overallProgress.removeAttribute('max');
        }
        if (overallProgressOutput) overallProgressOutput.textContent = 'Starting\u2026';
        if (subtaskProgress) {
            subtaskProgress.removeAttribute('value');
            subtaskProgress.removeAttribute('max');
        }
        if (subtaskProgressOutput) subtaskProgressOutput.textContent = '';
        if (subtaskResultsOutput) subtaskResultsOutput.textContent = '';

        await new Promise((resolve) => requestAnimationFrame(resolve));

        // ----------------------------------------------------------------
        // Common state
        // ----------------------------------------------------------------
        const testFormVersion = testFormVersionSelect?.value;
        if (!testFormVersion) throw new Error('No test form version selected.');

        const assetEntry = this.#assets?.find((entry) => entry.name === testFormVersion);
        const iccProfileBuffer = await iccProfileFile.arrayBuffer();
        const testFormName = testFormVersion;

        // Extract output profile basename (strip extension) for download filenames
        const outputProfileBasename = iccProfileFile.name.replace(/\.[^.]+$/, '');

        // When debugging, append browser/OS to filenames for parallel test identification
        const environmentSuffix = isDebugging ? ` - ${getEnvironmentDescriptor().label}` : '';

        // ----------------------------------------------------------------
        // Progress rendering (shared by both paths)
        // ----------------------------------------------------------------
        const generationStartTime = performance.now();

        /** @type {Record<string, string>} */
        const stageLabels = {
            loading: 'Loading manifest',
            downloading: 'Downloading assets',
            preparing: 'Preparing ICC profile',
            assembling: 'Loading asset PDF',
            converting: 'Converting colors',
            slugs: 'Generating slugs',
            chains: 'Processing chains',
            recombining: 'Recombining chains',
            finalizing: 'Finalizing PDF',
            saving: 'Saving PDF',
            done: 'Complete',
        };

        /** @type {Record<string, [number, number]>} */
        const stageRanges = processingStrategy === 'separate-chains'
            ? {
                loading: [0, 2],
                downloading: [2, 30],
                preparing: [30, 32],
                assembling: [32, 34],
                converting: [34, 36],
                slugs: [36, 40],
                chains: [40, 96],
                done: [100, 100],
            }
            : processingStrategy === 'recombined-chains'
                ? {
                    loading: [0, 2],
                    downloading: [2, 30],
                    preparing: [30, 32],
                    assembling: [32, 34],
                    converting: [34, 36],
                    slugs: [36, 40],
                    chains: [40, 88],
                    recombining: [88, 95],
                    saving: [95, 100],
                    done: [100, 100],
                }
                : {
                    loading: [0, 2],
                    downloading: [2, 30],
                    preparing: [30, 32],
                    assembling: [32, 34],
                    converting: [34, 78],
                    slugs: [78, 90],
                    finalizing: [90, 95],
                    saving: [95, 100],
                    done: [100, 100],
                };

        /**
         * Format milliseconds as m:ss (for live progress timers).
         * @param {number} ms
         * @returns {string}
         */
        const formatElapsed = (ms) => {
            const totalSeconds = Math.floor(ms / 1000);
            const minutes = Math.floor(totalSeconds / 60);
            const seconds = totalSeconds % 60;
            return `${minutes}:${String(seconds).padStart(2, '0')}`;
        };

        /**
         * Format milliseconds in a smart human-friendly form (for completed subtasks).
         *
         * - < 1s: integer ms ("1ms", "150ms", "999ms")
         * - 1s to < 10s: one-decimal seconds ("1.0s", "2.4s", "9.9s")
         * - 10s to < 60s: integer seconds ("10s", "45s")
         * - >= 60s: minutes and seconds ("1m 20s", "12m 5s")
         *
         * @param {number} ms
         * @returns {string}
         */
        const formatSmartElapsed = (ms) => {
            if (ms < 1000) return `${Math.round(ms)}ms`;
            if (ms < 10000) return `${(ms / 1000).toFixed(1)}s`;
            if (ms < 60000) return `${Math.floor(ms / 1000)}s`;
            const minutes = Math.floor(ms / 60000);
            const seconds = Math.floor((ms % 60000) / 1000);
            return `${minutes}m ${seconds}s`;
        };

        /** @type {{ stage: string, startTime: number, endTime?: number, lastMessage: string }[]} */
        const stageTimings = [];
        /** @type {{ stage: string, startTime: number, endTime?: number, lastMessage: string } | null} */
        let currentStageEntry = null;
        let lastPercent = 0;
        let lastMessage = '';

        /** @type {{ hint: string, elapsed: string }[]} */
        const completedSubtasks = [];

        /**
         * Builds a completed-subtask hint line from a finished stage's metadata.
         *
         * @param {string} stage - Stage key
         * @param {string} stageLastMessage - Last progress message received for this stage
         * @param {number} elapsedMs - Stage wall-clock duration in milliseconds
         * @returns {string}
         */
        const buildCompletedHint = (stage, stageLastMessage, elapsedMs) => {
            const label = stageLabels[stage] || stage;

            // Extract parenthetical content: "Loading asset PDF (24 assets)…" → "24 assets"
            const parenMatch = stageLastMessage.match(/\(([^)]+)\)[^(]*$/);

            // Extract "X of Y" total: "Chain 1 of 3" → "3"
            const ofYMatch = stageLastMessage.match(/(\d+)\s+of\s+(\d+)/);

            // Extract MB total from download: "15.2 of 30.4 MB" → "30.4 MB"
            const mbMatch = stageLastMessage.match(/of\s+([\d.]+)\s+MB/);

            switch (stage) {
                case 'downloading':
                    if (elapsedMs < 2000 && !mbMatch) return `${label} (used cache)`;
                    if (mbMatch) return `${label} (${mbMatch[1]} MB)`;
                    return label;
                case 'chains':
                    if (ofYMatch) return `${label} (${ofYMatch[2]} chains)`;
                    return label;
                case 'recombining':
                    if (ofYMatch) return `${label} (${ofYMatch[2]} chains)`;
                    return label;
                default:
                    if (parenMatch) return `${label} (${parenMatch[1]})`;
                    return label;
            }
        };

        /**
         * Renders the two-bar progress display and completed subtask list.
         */
        const renderProgress = () => {
            const now = performance.now();
            const overallElapsed = formatElapsed(now - generationStartTime);

            // --- Overall progress bar ---
            if (overallProgress) {
                overallProgress.value = lastPercent;
                overallProgress.max = 100;
            }
            if (overallProgressOutput) {
                const stageLabel = stageLabels[currentStageEntry?.stage] || currentStageEntry?.stage || '';
                overallProgressOutput.textContent = `${stageLabel} \u2014 ${lastPercent}% \u2014 ${overallElapsed}`;
            }

            // --- Subtask progress bar ---
            const range = currentStageEntry ? stageRanges[currentStageEntry.stage] : null;
            const subtaskPercent = range && range[1] > range[0]
                ? Math.min(100, Math.max(0, Math.floor((lastPercent - range[0]) / (range[1] - range[0]) * 100)))
                : 0;

            if (subtaskProgress) {
                subtaskProgress.value = subtaskPercent;
                subtaskProgress.max = 100;
            }
            if (subtaskProgressOutput) {
                if (lastMessage) {
                    const subtaskElapsed = currentStageEntry
                        ? formatElapsed(now - currentStageEntry.startTime)
                        : '';
                    subtaskProgressOutput.textContent = `${lastMessage} \u2014 ${subtaskElapsed}`;
                } else {
                    subtaskProgressOutput.textContent = '';
                }
            }

            // --- Completed subtask results ---
            if (subtaskResultsOutput && completedSubtasks.length > 0) {
                subtaskResultsOutput.style.whiteSpace = 'pre-line';
                let resultsText = '';
                for (let i = completedSubtasks.length - 1; i >= 0; i--) {
                    const entry = completedSubtasks[i];
                    resultsText += `${entry.hint} \u2014 ${entry.elapsed}\n`;
                }
                subtaskResultsOutput.textContent = resultsText.trimEnd();
            }
        };

        /**
         * Handles a progress update from either main-thread or worker.
         * @param {string} stage
         * @param {number} percent
         * @param {string} [message]
         */
        const handleProgress = (stage, percent, message) => {
            const now = performance.now();
            if (!currentStageEntry || currentStageEntry.stage !== stage) {
                if (currentStageEntry) {
                    currentStageEntry.endTime = now;
                    // Record completed subtask (skip 'done' — it is not a subtask)
                    if (currentStageEntry.stage !== 'done') {
                        const elapsedMs = now - currentStageEntry.startTime;
                        completedSubtasks.push({
                            hint: buildCompletedHint(currentStageEntry.stage, currentStageEntry.lastMessage, elapsedMs),
                            elapsed: formatSmartElapsed(elapsedMs),
                        });
                    }
                }
                currentStageEntry = { stage, startTime: now, lastMessage: '' };
                stageTimings.push(currentStageEntry);
            }
            lastPercent = percent;
            lastMessage = message || '';
            if (currentStageEntry) currentStageEntry.lastMessage = lastMessage;
            renderProgress();
        };

        const timerInterval = setInterval(() => {
            renderProgress();
        }, 1000);

        try {
            // ================================================================
            // Branch: Bootstrap Worker or Main Thread
            // ================================================================
            if (useBootstrapWorker) {
                await this.#runInBootstrapWorker({
                    testFormVersion,
                    resources: assetEntry?.resources,
                    iccProfileBuffer,
                    userMetadata,
                    debugging: isDebugging,
                    outputBitsPerComponent,
                    useWorkers: useParallelWorkers,
                    processingStrategy,
                    assemblyOverrides,
                    includeOutputProfile,
                    testFormName,
                    outputProfileBasename,
                    environmentSuffix,
                    handleProgress,
                    setCancelHandler: (handler) => { this.#cancelGeneration = handler; },
                    onDownloadProgress: (state) => {
                        if (state.totalBytes > 0) {
                            const downloadPercent = Math.floor(state.receivedBytes / state.totalBytes * 100);
                            const receivedMB = (state.receivedBytes / (1024 * 1024)).toFixed(1);
                            const totalMB = (state.totalBytes / (1024 * 1024)).toFixed(1);
                            handleProgress(
                                'downloading',
                                2 + Math.floor(downloadPercent * 0.28),
                                `Downloading\u2026 ${receivedMB} of ${totalMB} MB (${downloadPercent}%)`,
                            );
                        }
                    },
                });
            } else {
                await this.#runOnMainThread({
                    testFormVersion,
                    resources: assetEntry?.resources,
                    iccProfileBuffer,
                    userMetadata,
                    debugging: isDebugging,
                    outputBitsPerComponent,
                    useWorkers: useParallelWorkers,
                    processingStrategy,
                    assemblyOverrides,
                    includeOutputProfile,
                    testFormName,
                    outputProfileBasename,
                    environmentSuffix,
                    handleProgress,
                    setCancelHandler: (handler) => { this.#cancelGeneration = handler; },
                    onDownloadProgress: (state) => {
                        if (state.totalBytes > 0) {
                            const downloadPercent = Math.floor(state.receivedBytes / state.totalBytes * 100);
                            const receivedMB = (state.receivedBytes / (1024 * 1024)).toFixed(1);
                            const totalMB = (state.totalBytes / (1024 * 1024)).toFixed(1);
                            handleProgress(
                                'downloading',
                                2 + Math.floor(downloadPercent * 0.28),
                                `Downloading\u2026 ${receivedMB} of ${totalMB} MB (${downloadPercent}%)`,
                            );
                        }
                    },
                });
            }
        } finally {
            clearInterval(timerInterval);

            // Release beforeunload and wake lock
            globalThis.removeEventListener('beforeunload', beforeUnloadHandler);
            try { await wakeLock?.release?.(); } catch { /* already released */ }

            // Update progress if cancelled
            if (this.#cancelled) {
                if (overallProgressOutput) overallProgressOutput.textContent = 'Cancelled';
                if (subtaskProgressOutput) subtaskProgressOutput.textContent = '';
            }

            // Restore UI: swap Cancel→Generate, re-enable fields, unlock details
            this.#generating = false;
            this.#cancelGeneration = null;
            this.#cancelled = false;

            if (generateButton) {
                generateButton.textContent = 'Generate';
            }
            for (const fieldset of allFieldsets) fieldset.disabled = false;
            for (const [details, wasOpen] of detailsOpenState) {
                const summary = details.querySelector('summary');
                if (summary) {
                    summary.removeEventListener('click', preventToggle);
                    summary.style.pointerEvents = '';
                }
                for (const radio of /** @type {NodeListOf<HTMLInputElement>} */ (
                    details.querySelectorAll('legend input[type="radio"]')
                )) {
                    radio.disabled = false;
                }
                details.open = wasOpen;
            }
        }
    }

    /**
     * Downloads the generation result files (shared by main-thread and worker paths).
     *
     * Handles single-PDF and multi-PDF (onChainOutput) results. Downloads
     * docket PDF instead of metadata.json when available.
     *
     * @param {import('../classes/test-form-pdf-document-generator.js').GenerationResult} result
     * @param {object} options
     * @param {string} options.testFormName
     * @param {string} options.outputProfileBasename
     * @param {ArrayBuffer} options.iccProfileBuffer
     * @param {boolean} options.debugging
     * @param {boolean} options.includeOutputProfile
     * @param {string} options.environmentSuffix
     */
    async #downloadGenerationResult(result, { testFormName, outputProfileBasename, iccProfileBuffer, debugging, includeOutputProfile, environmentSuffix }) {
        const { pdfBuffer, metadataJSON, docketPDFBuffer } = result;
        console.log(`${CONTEXT_PREFIX} [downloadGenerationResult] pdfBuffer=${!!pdfBuffer}, docketPDFBuffer=${!!docketPDFBuffer}, debugging=${debugging}`);

        // Docket is already downloaded via onDocketReady callback (before main job).
        // Only download metadata.json as fallback when no docket was generated.

        if (pdfBuffer) {
            const parsedMetadata = JSON.parse(metadataJSON);
            const intentLabel = parsedMetadata?.assembly?.renderingIntents?.[0]?.label ?? '';
            const downloadSuffix = `${outputProfileBasename}${intentLabel ? ` - ${intentLabel}` : ''}`;

            if (debugging && includeOutputProfile) {
                await downloadArrayBufferAs(iccProfileBuffer, 'Output.icc', 'application/vnd.iccprofile');
            }

            if (!docketPDFBuffer) {
                await downloadArrayBufferAs(
                    new TextEncoder().encode(metadataJSON).buffer,
                    `${testFormName} - ${downloadSuffix} - Metadata${environmentSuffix}.json`,
                    'application/json',
                );
            }

            await downloadArrayBufferAs(
                pdfBuffer,
                `${testFormName} - ${downloadSuffix}${environmentSuffix}.pdf`,
                'application/pdf',
            );
        }

        if (!pdfBuffer) {
            if (!docketPDFBuffer) {
                await downloadArrayBufferAs(
                    new TextEncoder().encode(metadataJSON).buffer,
                    `${testFormName} - ${outputProfileBasename} - Metadata${environmentSuffix}.json`,
                    'application/json',
                );
            }
        }

        // Generation completed successfully — dismiss the new-version notice
        this.#dismissVersionNotice();
    }

    /**
     * Runs the generation pipeline on the main thread (blocking).
     *
     * @param {object} options
     * @param {string} options.testFormVersion
     * @param {{ assets: string, manifest: string }} [options.resources]
     * @param {ArrayBuffer} options.iccProfileBuffer
     * @param {UserMetadata} options.userMetadata
     * @param {boolean} options.debugging
     * @param {8 | 16 | undefined} options.outputBitsPerComponent
     * @param {boolean} options.useWorkers
     * @param {'in-place' | 'separate-chains' | 'recombined-chains'} options.processingStrategy
     * @param {import('../classes/assembly-policy-resolver.js').AssemblyUserOverrides} [options.assemblyOverrides]
     * @param {boolean} options.includeOutputProfile
     * @param {string} options.testFormName
     * @param {string} options.outputProfileBasename
     * @param {(stage: string, percent: number, message?: string) => void} options.handleProgress
     * @param {(state: import('../classes/test-form-pdf-document-generator.js').FetchState) => void} options.onDownloadProgress
     * @param {string} options.environmentSuffix
     * @param {(cancelHandler: () => void) => void} options.setCancelHandler
     */
    async #runOnMainThread({
        testFormVersion, resources, iccProfileBuffer, userMetadata,
        debugging, outputBitsPerComponent, useWorkers, processingStrategy,
        assemblyOverrides, includeOutputProfile, testFormName, outputProfileBasename, handleProgress, setCancelHandler, onDownloadProgress,
        environmentSuffix,
    }) {
        const generator = new TestFormPDFDocumentGenerator({
            testFormVersion,
            resources,
            debugging,
            outputBitsPerComponent,
            useWorkers,
            processingStrategy,
            assemblyOverrides,
            outputProfileName: outputProfileBasename,
        });

        setCancelHandler?.(() => generator.abort?.());

        let preChainDownloadsCompleted = false;

        /** @type {{ pdfBuffer: ArrayBuffer | null, metadataJSON: string }} */
        let generateResult;
        try {
            generateResult = await generator.generate(
                iccProfileBuffer,
                userMetadata,
                {
                    onProgress: async (stage, percent, message) => {
                        handleProgress(stage, percent, message);
                        await new Promise((resolve) => requestAnimationFrame(resolve));
                    },
                    onDownloadProgress,
                    onDocketReady: async (docketPDFBuffer, metadataJSON) => {
                        await downloadArrayBufferAs(
                            docketPDFBuffer,
                            `${testFormName} - ${outputProfileBasename} - Docket${environmentSuffix}.pdf`,
                            'application/pdf',
                        );
                    },
                    onChainOutput: async (label, pdfBuffer, metadataJSON) => {
                        if (!preChainDownloadsCompleted) {
                            if (debugging && includeOutputProfile) {
                                await downloadArrayBufferAs(iccProfileBuffer, 'Output.icc', 'application/vnd.iccprofile');
                            }
                            preChainDownloadsCompleted = true;
                        }
                        await downloadArrayBufferAs(
                            pdfBuffer,
                            `${testFormName} - ${outputProfileBasename} - ${label}${environmentSuffix}.pdf`,
                            'application/pdf',
                        );
                    },
                },
            );
        } finally {
            generator.abort?.();
        }

        await this.#downloadGenerationResult(generateResult, {
            testFormName, outputProfileBasename, iccProfileBuffer, debugging, includeOutputProfile, environmentSuffix,
        });
    }

    /**
     * Runs the generation pipeline in a Bootstrap Worker (non-blocking).
     *
     * Creates a module worker from `bootstrap-worker-entrypoint.js`, sends
     * all inputs via postMessage (with transferables for ArrayBuffers),
     * and handles progress/result/error messages on the main thread.
     *
     * @param {object} options
     * @param {string} options.testFormVersion
     * @param {{ assets: string, manifest: string }} [options.resources]
     * @param {ArrayBuffer} options.iccProfileBuffer
     * @param {UserMetadata} options.userMetadata
     * @param {boolean} options.debugging
     * @param {8 | 16 | undefined} options.outputBitsPerComponent
     * @param {boolean} options.useWorkers
     * @param {'in-place' | 'separate-chains' | 'recombined-chains'} options.processingStrategy
     * @param {import('../classes/assembly-policy-resolver.js').AssemblyUserOverrides} [options.assemblyOverrides]
     * @param {boolean} options.includeOutputProfile
     * @param {string} options.testFormName
     * @param {string} options.outputProfileBasename
     * @param {(stage: string, percent: number, message?: string) => void} options.handleProgress
     * @param {(state: any) => void} options.onDownloadProgress
     * @param {string} options.environmentSuffix
     * @param {(cancelHandler: () => void) => void} options.setCancelHandler
     */
    async #runInBootstrapWorker({
        testFormVersion, resources, iccProfileBuffer, userMetadata,
        debugging, outputBitsPerComponent, useWorkers, processingStrategy,
        assemblyOverrides, includeOutputProfile, testFormName, outputProfileBasename, handleProgress, setCancelHandler, onDownloadProgress,
        environmentSuffix,
    }) {
        const workerURL = new URL('../bootstrap-worker-entrypoint.js', import.meta.url).href;

        console.log(`${CONTEXT_PREFIX} [TestFormGeneratorAppElement] Bootstrap Worker: creating module worker\u2026`);
        const worker = new Worker(workerURL, { type: 'module' });

        /** @type {(reason: Error) => void} */
        let rejectCurrent = () => { };
        setCancelHandler?.(() => {
            worker.terminate();
            rejectCurrent(new Error('Generation cancelled'));
        });

        try {
            // Wait for the worker to signal readiness
            await new Promise((resolve, reject) => {
                rejectCurrent = reject;
                const timeout = setTimeout(() => {
                    reject(new Error('Bootstrap Worker: timeout waiting for ready signal (15s)'));
                }, 15000);

                worker.onerror = (event) => {
                    clearTimeout(timeout);
                    reject(new Error(
                        `Bootstrap Worker: load error \u2014 ${event.message} ` +
                        `(${event.filename}:${event.lineno}:${event.colno})`
                    ));
                };

                worker.onmessage = (event) => {
                    if (event.data?.type === 'ready') {
                        clearTimeout(timeout);
                        resolve(undefined);
                    }
                };
            });

            console.log(`${CONTEXT_PREFIX} [TestFormGeneratorAppElement] Bootstrap Worker: ready, sending generation task\u2026`);

            // Send generation task — transfer the ICC profile buffer to avoid copying
            const iccProfileCopy = iccProfileBuffer.slice(0);

            /** @type {{ pdfBuffer: ArrayBuffer | null, metadataJSON: string }} */
            const result = await new Promise((resolve, reject) => {
                rejectCurrent = reject;
                let preChainDownloadsCompleted = false;
                let docketDelivered = false;

                worker.onerror = (event) => {
                    reject(new Error(
                        `Bootstrap Worker: runtime error \u2014 ${event.message} ` +
                        `(${event.filename}:${event.lineno}:${event.colno})`
                    ));
                };

                worker.onmessage = async (event) => {
                    const data = event.data;

                    switch (data.type) {
                        case 'progress':
                            handleProgress(data.stage, data.percent, data.message);
                            break;

                        case 'download-progress':
                            onDownloadProgress(data.state);
                            break;

                        case 'docket-ready':
                            docketDelivered = true;
                            await downloadArrayBufferAs(
                                data.docketPDFBuffer,
                                `${testFormName} - ${outputProfileBasename} - Docket${environmentSuffix}.pdf`,
                                'application/pdf',
                            );
                            break;

                        case 'chain-output':
                            if (!preChainDownloadsCompleted) {
                                if (debugging && includeOutputProfile) {
                                    await downloadArrayBufferAs(iccProfileBuffer, 'Output.icc', 'application/vnd.iccprofile');
                                }
                                if (!docketDelivered) {
                                    await downloadArrayBufferAs(
                                        new TextEncoder().encode(data.metadataJSON).buffer,
                                        `${testFormName} - ${outputProfileBasename} - Metadata${environmentSuffix}.json`,
                                        'application/json',
                                    );
                                }
                                preChainDownloadsCompleted = true;
                            }
                            await downloadArrayBufferAs(
                                data.pdfBuffer,
                                `${testFormName} - ${outputProfileBasename} - ${data.colorSpace}${environmentSuffix}.pdf`,
                                'application/pdf',
                            );
                            break;

                        case 'result':
                            resolve({
                                pdfBuffer: data.pdfBuffer,
                                metadataJSON: data.metadataJSON,
                                docketPDFBuffer: data.docketPDFBuffer ?? null,
                            });
                            break;

                        case 'error':
                            reject(new Error(`Bootstrap Worker: ${data.message}\n${data.stack ?? ''}`));
                            break;
                    }
                };

                worker.postMessage(
                    {
                        type: 'generate',
                        taskId: 1,
                        testFormVersion,
                        resources,
                        iccProfileBuffer: iccProfileCopy,
                        userMetadata,
                        debugging,
                        outputBitsPerComponent,
                        useWorkers,
                        processingStrategy,
                        assemblyOverrides,
                        outputProfileName: outputProfileBasename,
                    },
                    [iccProfileCopy],
                );
            });

            await this.#downloadGenerationResult(result, {
                testFormName, outputProfileBasename, iccProfileBuffer, debugging, includeOutputProfile, environmentSuffix,
            });
        } finally {
            worker.terminate();
            console.log(`${CONTEXT_PREFIX} [TestFormGeneratorAppElement] Bootstrap Worker: terminated`);
        }
    }
}
