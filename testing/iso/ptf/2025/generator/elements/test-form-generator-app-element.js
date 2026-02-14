// @ts-check
/**
 * TestFormGeneratorAppElement — Custom element for the test form generator UI.
 *
 * Binds to form elements in the light DOM (slotted into shadow DOM),
 * handles validation, progress reporting, and file downloads.
 *
 * @module TestFormGeneratorAppElement
 * @author Saleh Abdel Motaal <dev@smotaal.io>
 * @ai Claude Opus 4.6 (code generation)
 */

import { downloadArrayBufferAs } from '../../helpers.js';

import { TestFormPDFDocumentGenerator } from '../classes/test-form-pdf-document-generator.js';

/**
 * @typedef {import('../classes/test-form-pdf-document-generator.js').UserMetadata} UserMetadata
 */

/**
 * Custom element for the test form generator UI.
 *
 * Binds to the form elements in the light DOM (slotted into shadow DOM),
 * handles validation, progress reporting, and file downloads.
 *
 * @extends HTMLElement
 */
export class TestFormGeneratorAppElement extends HTMLElement {

    connectedCallback() {
        // Enable debugging checkbox from URL query parameter
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
    }

    /**
     * Deletes the `conres-testforms` cache so all assets are re-fetched on the next generation.
     */
    async #handleClearCache() {
        const deleted = await globalThis.caches?.delete?.('conres-testforms');
        console.log(`Cache "conres-testforms" ${deleted ? 'cleared' : 'was already empty'}`);
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

        const generationProgress = /** @type {HTMLProgressElement | null} */ (
            this.querySelector('#test-form-generation-progress')
        );
        const generationProgressOutput = /** @type {HTMLOutputElement | null} */ (
            this.querySelector('#test-form-generation-progress-output')
        );
        const generationProgressFieldset = /** @type {HTMLFieldSetElement | null} */ (
            generationProgress?.closest('fieldset') ?? null
        );

        const downloadProgress = /** @type {HTMLProgressElement | null} */ (
            this.querySelector('#test-form-download-progress')
        );
        const downloadProgressOutput = /** @type {HTMLOutputElement | null} */ (
            this.querySelector('#test-form-download-progress-output')
        );
        const downloadProgressFieldset = /** @type {HTMLFieldSetElement | null} */ (
            downloadProgress?.closest('fieldset') ?? null
        );

        const isDebugging = debuggingCheckbox?.checked ?? false;

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
        // Disable button, show progress
        // ----------------------------------------------------------------
        if (generateButton) generateButton.disabled = true;
        if (generationProgressFieldset) generationProgressFieldset.style.opacity = '';
        if (downloadProgressFieldset) downloadProgressFieldset.style.opacity = '';

        if (generationProgress) {
            generationProgress.removeAttribute('value');
            generationProgress.removeAttribute('max');
        }
        if (generationProgressOutput) generationProgressOutput.textContent = 'Starting\u2026';

        await new Promise((resolve) => requestAnimationFrame(resolve));

        // ----------------------------------------------------------------
        // Run the generator
        // ----------------------------------------------------------------
        const testFormVersion = testFormVersionSelect?.value;
        if (!testFormVersion) throw new Error('No test form version selected.');

        const iccProfileBuffer = await iccProfileFile.arrayBuffer();

        const generator = new TestFormPDFDocumentGenerator({
            testFormVersion,
            debugging: isDebugging,
            outputBitsPerComponent,
        });

        const generationStartTime = performance.now();

        /** @type {Record<string, string>} */
        const stageLabels = {
            loading: 'Loading manifest',
            downloading: 'Downloading assets',
            preparing: 'Preparing ICC profile',
            assembling: 'Loading asset PDF',
            converting: 'Converting colors',
            slugs: 'Generating slugs',
            finalizing: 'Finalizing PDF',
            saving: 'Saving PDF',
            done: 'Complete',
        };

        /** @type {Record<string, [number, number]>} */
        const stageRanges = {
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
         * Format milliseconds as m:ss.
         * @param {number} ms
         * @returns {string}
         */
        const formatElapsed = (ms) => {
            const totalSeconds = Math.floor(ms / 1000);
            const minutes = Math.floor(totalSeconds / 60);
            const seconds = totalSeconds % 60;
            return `${minutes}:${String(seconds).padStart(2, '0')}`;
        };

        /** @type {{ stage: string, startTime: number, endTime?: number }[]} */
        const stageTimings = [];
        /** @type {{ stage: string, startTime: number, endTime?: number } | null} */
        let currentStageEntry = null;
        let lastPercent = 0;

        /**
         * Renders the progress output HTML using current state.
         * Called both from `onProgress` (data update) and from the
         * 1-second interval (timer-only refresh).
         */
        const renderProgress = () => {
            const now = performance.now();

            if (generationProgress) {
                generationProgress.value = lastPercent;
                generationProgress.max = 100;
            }

            if (generationProgressOutput) {
                const overallElapsed = formatElapsed(now - generationStartTime);

                // Overall line
                let html = `<div>Generating test form \u2014 ${lastPercent}% \u2014 ${overallElapsed}</div>`;

                // Sub-stages: newest first (right under the overall div)
                html += '<small>';
                for (let i = stageTimings.length - 1; i >= 0; i--) {
                    const entry = stageTimings[i];
                    const label = stageLabels[entry.stage] || entry.stage;
                    const stageElapsed = formatElapsed((entry.endTime ?? now) - entry.startTime);

                    if (entry === currentStageEntry) {
                        // Active stage: show within-stage percent
                        const range = stageRanges[entry.stage];
                        const stagePercent = range && range[1] > range[0]
                            ? Math.min(100, Math.max(0, Math.floor((lastPercent - range[0]) / (range[1] - range[0]) * 100)))
                            : lastPercent;
                        html += `<div>${label} \u2014 ${stagePercent}% \u2014 ${stageElapsed}</div>`;
                    } else {
                        // Completed stage: label and elapsed
                        html += `<div>${label} \u2014 ${stageElapsed}</div>`;
                    }
                }
                html += '</small>';

                generationProgressOutput.innerHTML = html;
            }
        };

        // Refresh elapsed timers every second even when no onProgress fires
        const timerInterval = setInterval(() => {
            renderProgress();
        }, 1000);

        /** @type {{ pdfBuffer: ArrayBuffer, metadataJSON: string }} */
        let generateResult;
        try {
            generateResult = await generator.generate(
                iccProfileBuffer,
                userMetadata,
                {
                    onProgress: async (stage, percent, _message) => {
                        const now = performance.now();

                        // Track stage transitions
                        if (!currentStageEntry || currentStageEntry.stage !== stage) {
                            if (currentStageEntry) {
                                currentStageEntry.endTime = now;
                            }
                            currentStageEntry = { stage, startTime: now };
                            stageTimings.push(currentStageEntry);
                        }

                        lastPercent = percent;
                        renderProgress();

                        await new Promise((resolve) => requestAnimationFrame(resolve));
                    },
                    onDownloadProgress: (state) => {
                        if (downloadProgress && state.totalBytes > 0) {
                            downloadProgress.value = state.receivedBytes;
                            downloadProgress.max = state.totalBytes;
                        }
                        if (downloadProgressOutput && state.totalBytes > 0) {
                            downloadProgressOutput.value = `${Math.floor(state.receivedBytes / state.totalBytes * 100)}%`;
                        }
                    },
                },
            );
        } finally {
            clearInterval(timerInterval);
        }

        const { pdfBuffer, metadataJSON } = generateResult;

        // ----------------------------------------------------------------
        // Download generated files
        // ----------------------------------------------------------------
        const testFormName = testFormVersion;

        if (isDebugging) {
            await downloadArrayBufferAs(iccProfileBuffer, 'Output.icc', 'application/vnd.iccprofile');
        }

        await downloadArrayBufferAs(
            new TextEncoder().encode(metadataJSON).buffer,
            `${testFormName} - metadata.json`,
            'application/json',
        );

        await downloadArrayBufferAs(
            pdfBuffer,
            `${testFormName}.pdf`,
            'application/pdf',
        );

        if (generateButton) generateButton.disabled = false;
    }
}
