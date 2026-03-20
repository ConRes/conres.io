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

    /**
     * Configures the app element with resolved asset entries from assets.json.
     *
     * @param {{ assets: ResolvedAssetEntry[] }} options
     */
    configure({ assets }) {
        this.#assets = assets;
    }

    /** @type {boolean} */
    #filtersPopulated = false;

    /** @type {import('./test-form-pdf-document-generator.js').TestFormManifest | null} */
    #cachedManifest = null;

    /** @type {import('../classes/assembly-policy-resolver.js').AssemblyPolicyResolver | null} */
    #cachedPolicyResolver = null;

    /** @type {string | null} */
    #cachedManifestVersion = null;

    connectedCallback() {
        // ----------------------------------------------------------------
        // Restore persisted state from localStorage
        // ----------------------------------------------------------------
        this.#restorePersistedState();

        // Enable debugging checkbox from URL query parameter (overrides persisted state)
        const debugging = new URLSearchParams(globalThis.location?.search).has('debugging');
        const debuggingCheckbox = /** @type {HTMLInputElement | null} */ (
            this.querySelector('#debugging-checkbox')
        );
        if (debuggingCheckbox && debugging) {
            debuggingCheckbox.checked = true;
        }

        // Bind Clear Cache button
        const clearCacheButton = this.querySelector('#test-form-clear-cache-button');
        if (clearCacheButton) {
            clearCacheButton.addEventListener('click', (event) => {
                event.preventDefault();
                this.#handleClearCache();
            });
        }

        // Bind Generate button
        const generateButton = this.querySelector('#test-form-generation-button');
        if (generateButton) {
            generateButton.addEventListener('click', (event) => {
                event.preventDefault();
                this.#handleGenerate();
            });
        }

        // Populate assembly filter toggles on first <details> open
        const filterDetails = this.querySelector('#assembly-filters-details');
        if (filterDetails) {
            filterDetails.addEventListener('toggle', () => {
                if (/** @type {HTMLDetailsElement} */ (filterDetails).open) {
                    this.#ensureFiltersPopulated();
                }
                this.#persistState();
            });
        }

        // Re-populate filters when test form version changes
        const testFormVersionSelect = this.querySelector('#test-form-version-select');
        if (testFormVersionSelect) {
            testFormVersionSelect.addEventListener('change', () => {
                this.#cachedManifestVersion = null;
                this.#cachedManifest = null;
                this.#filtersPopulated = false;
                const details = /** @type {HTMLDetailsElement | null} */ (
                    this.querySelector('#assembly-filters-details')
                );
                if (details?.open) this.#ensureFiltersPopulated();
                this.#persistState();
            });
        }

        // Update auto state when ICC profile changes
        const iccProfileInput = this.querySelector('#icc-profile-input');
        if (iccProfileInput) {
            iccProfileInput.addEventListener('change', () => {
                this.#updateAutoState();
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
            if (target.matches('select, input[type="radio"], input[type="checkbox"], input[type="text"]')) {
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

        // Text inputs
        for (const input of /** @type {NodeListOf<HTMLInputElement>} */ (this.querySelectorAll('input[type="text"][id]'))) {
            if (input.value) state[`text:${input.id}`] = input.value;
        }

        // Details open state
        const filterDetails = /** @type {HTMLDetailsElement | null} */ (
            this.querySelector('#assembly-filters-details')
        );
        if (filterDetails) state['details:assembly-filters'] = filterDetails.open;

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
        if ('details:assembly-filters' in state) {
            const filterDetails = /** @type {HTMLDetailsElement | null} */ (
                this.querySelector('#assembly-filters-details')
            );
            if (filterDetails && state['details:assembly-filters']) {
                filterDetails.open = true;
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

                if (header.colorSpace === 'RGB') {
                    previewCategory = 'RGB';
                } else if (header.colorSpace === 'CMYK') {
                    // Run the full Max GCR test
                    const analysis = await OutputProfileAnalyzer.analyzeProfile(
                        buffer, header, policyData.maxGCRTest,
                    );
                    previewCategory = analysis.profileCategory;
                }

                console.log(`${CONTEXT_PREFIX} [TestFormGeneratorAppElement] Auto preview: profile category = ${previewCategory}`);
            } catch (error) {
                console.warn(`${CONTEXT_PREFIX} [TestFormGeneratorAppElement] Failed to analyze ICC profile for auto preview:`, error);
            }
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
     * Deletes the `conres-testforms` cache so all assets are re-fetched on the next generation.
     */
    async #handleClearCache() {
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
        const debuggingCheckbox = /** @type {HTMLInputElement | null} */ (
            this.querySelector('#debugging-checkbox')
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

        const isDebugging = debuggingCheckbox?.checked ?? false;

        // ----------------------------------------------------------------
        // Read worker checkboxes and processing strategy selection
        // ----------------------------------------------------------------
        const bootstrapWorkerCheckbox = /** @type {HTMLInputElement | null} */ (
            this.querySelector('#bootstrap-worker-checkbox')
        );
        const useBootstrapWorker = bootstrapWorkerCheckbox?.checked ?? false;

        const parallelWorkersCheckbox = /** @type {HTMLInputElement | null} */ (
            this.querySelector('#parallel-workers-checkbox')
        );
        const useParallelWorkers = parallelWorkersCheckbox?.checked ?? false;

        const processingStrategyRadio = /** @type {HTMLInputElement | null} */ (
            this.querySelector('input[name="processing-strategy"]:checked')
        );
        /** @type {'in-place' | 'separate-chains' | 'recombined-chains'} */
        const processingStrategy = /** @type {any} */ (processingStrategyRadio?.value ?? 'in-place');

        const includeOutputProfileCheckbox = /** @type {HTMLInputElement | null} */ (
            this.querySelector('#debugging-include-output-profile-checkbox')
        );
        const includeOutputProfile = includeOutputProfileCheckbox?.checked ?? false;

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
        // Validate: ICC profile required
        // ----------------------------------------------------------------
        const iccProfileFile = iccProfileInput?.files?.[0];
        if (!iccProfileFile) {
            alert('Please select a calibrated ICC profile.');
            iccProfileInput?.focus();
            return;
        }

        // ----------------------------------------------------------------
        // Validate: specification fields required (unless debugging)
        // ----------------------------------------------------------------
        const fieldIds = ['device-input', 'colorants-input', 'substrate-input', 'settings-input', 'email-input'];

        if (!isDebugging) {
            for (const fieldId of fieldIds) {
                const input = /** @type {HTMLInputElement | null} */ (this.querySelector(`#${fieldId}`));
                if (!input?.value?.trim()) {
                    alert('Please fill in all specification fields, or enable Debugging to skip validation.');
                    input?.focus();
                    return;
                }
            }
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
        // Collect assembly overrides from filter controls
        // Only sections in "custom" mode produce overrides; "auto" sections
        // are handled by the assembly policy resolver at generation time.
        // ----------------------------------------------------------------

        /** @type {import('../classes/assembly-policy-resolver.js').AssemblyUserOverrides | undefined} */
        let assemblyOverrides;

        const layoutMode = /** @type {HTMLInputElement | null} */ (
            this.querySelector('input[name="layout-mode"]:checked')
        )?.value ?? 'auto';

        const colorSpaceMode = /** @type {HTMLInputElement | null} */ (
            this.querySelector('input[name="color-space-mode"]:checked')
        )?.value ?? 'auto';

        const renderingIntentMode = /** @type {HTMLInputElement | null} */ (
            this.querySelector('input[name="rendering-intent-mode"]:checked')
        )?.value ?? 'auto';

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
        // Disable button, show progress
        // ----------------------------------------------------------------
        if (generateButton) generateButton.disabled = true;
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
                    handleProgress,
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
                    handleProgress,
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
            if (generateButton) generateButton.disabled = false;
        }
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
     */
    async #runOnMainThread({
        testFormVersion, resources, iccProfileBuffer, userMetadata,
        debugging, outputBitsPerComponent, useWorkers, processingStrategy,
        assemblyOverrides, includeOutputProfile, testFormName, outputProfileBasename, handleProgress, onDownloadProgress,
    }) {
        const generator = new TestFormPDFDocumentGenerator({
            testFormVersion,
            resources,
            debugging,
            outputBitsPerComponent,
            useWorkers,
            processingStrategy,
            assemblyOverrides,
        });

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
                    onChainOutput: async (label, pdfBuffer, metadataJSON) => {
                        if (!preChainDownloadsCompleted) {
                            if (debugging && includeOutputProfile) {
                                await downloadArrayBufferAs(iccProfileBuffer, 'Output.icc', 'application/vnd.iccprofile');
                            }
                            await downloadArrayBufferAs(
                                new TextEncoder().encode(metadataJSON).buffer,
                                `${testFormName} - ${outputProfileBasename} - metadata.json`,
                                'application/json',
                            );
                            preChainDownloadsCompleted = true;
                        }
                        await downloadArrayBufferAs(
                            pdfBuffer,
                            `${testFormName} - ${outputProfileBasename} - ${label}.pdf`,
                            'application/pdf',
                        );
                    },
                },
            );
        } finally {
            generator.abort?.();
        }

        const { pdfBuffer, metadataJSON } = generateResult;

        // Download generated files
        // When pdfBuffer is null, PDFs were delivered via onChainOutput
        // (separate-chains or multi-intent passes)
        if (pdfBuffer) {
            // Extract the rendering intent label from metadata for the filename
            const parsedMetadata = JSON.parse(metadataJSON);
            const intentLabel = parsedMetadata?.assembly?.renderingIntents?.[0]?.label ?? '';
            const downloadSuffix = `${outputProfileBasename}${intentLabel ? ` - ${intentLabel}` : ''}`;

            if (debugging && includeOutputProfile) {
                await downloadArrayBufferAs(iccProfileBuffer, 'Output.icc', 'application/vnd.iccprofile');
            }
            await downloadArrayBufferAs(
                new TextEncoder().encode(metadataJSON).buffer,
                `${testFormName} - ${downloadSuffix} - metadata.json`,
                'application/json',
            );
            await downloadArrayBufferAs(
                pdfBuffer,
                `${testFormName} - ${downloadSuffix}.pdf`,
                'application/pdf',
            );
        }
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
     */
    async #runInBootstrapWorker({
        testFormVersion, resources, iccProfileBuffer, userMetadata,
        debugging, outputBitsPerComponent, useWorkers, processingStrategy,
        assemblyOverrides, includeOutputProfile, testFormName, outputProfileBasename, handleProgress, onDownloadProgress,
    }) {
        const workerURL = new URL('../bootstrap-worker-entrypoint.js', import.meta.url).href;

        console.log(`${CONTEXT_PREFIX} [TestFormGeneratorAppElement] Bootstrap Worker: creating module worker\u2026`);
        const worker = new Worker(workerURL, { type: 'module' });

        try {
            // Wait for the worker to signal readiness
            await new Promise((resolve, reject) => {
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
                let preChainDownloadsCompleted = false;

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

                        case 'chain-output':
                            // Handle separate-chains / multi-intent downloads on the main thread
                            if (!preChainDownloadsCompleted) {
                                if (debugging && includeOutputProfile) {
                                    await downloadArrayBufferAs(iccProfileBuffer, 'Output.icc', 'application/vnd.iccprofile');
                                }
                                await downloadArrayBufferAs(
                                    new TextEncoder().encode(data.metadataJSON).buffer,
                                    `${testFormName} - ${outputProfileBasename} - metadata.json`,
                                    'application/json',
                                );
                                preChainDownloadsCompleted = true;
                            }
                            await downloadArrayBufferAs(
                                data.pdfBuffer,
                                `${testFormName} - ${outputProfileBasename} - ${data.colorSpace}.pdf`,
                                'application/pdf',
                            );
                            break;

                        case 'result':
                            resolve({
                                pdfBuffer: data.pdfBuffer,
                                metadataJSON: data.metadataJSON,
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
                    },
                    [iccProfileCopy],
                );
            });

            // Download generated files
            // When pdfBuffer is present, it's a single-PDF result;
            // when null, PDFs were delivered via chain-output messages
            if (result.pdfBuffer) {
                const parsedMetadata = JSON.parse(result.metadataJSON);
                const intentLabel = parsedMetadata?.assembly?.renderingIntents?.[0]?.label ?? '';
                const downloadSuffix = `${outputProfileBasename}${intentLabel ? ` - ${intentLabel}` : ''}`;

                if (debugging && includeOutputProfile) {
                    await downloadArrayBufferAs(iccProfileBuffer, 'Output.icc', 'application/vnd.iccprofile');
                }
                await downloadArrayBufferAs(
                    new TextEncoder().encode(result.metadataJSON).buffer,
                    `${testFormName} - ${downloadSuffix} - metadata.json`,
                    'application/json',
                );
                await downloadArrayBufferAs(
                    result.pdfBuffer,
                    `${testFormName} - ${downloadSuffix}.pdf`,
                    'application/pdf',
                );
            }
        } finally {
            worker.terminate();
            console.log(`${CONTEXT_PREFIX} [TestFormGeneratorAppElement] Bootstrap Worker: terminated`);
        }
    }
}
