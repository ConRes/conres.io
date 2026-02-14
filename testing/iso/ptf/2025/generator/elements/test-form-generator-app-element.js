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
                    includeOutputProfile,
                    testFormName,
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
                    includeOutputProfile,
                    testFormName,
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
     * @param {boolean} options.includeOutputProfile
     * @param {string} options.testFormName
     * @param {(stage: string, percent: number, message?: string) => void} options.handleProgress
     * @param {(state: import('../classes/test-form-pdf-document-generator.js').FetchState) => void} options.onDownloadProgress
     */
    async #runOnMainThread({
        testFormVersion, resources, iccProfileBuffer, userMetadata,
        debugging, outputBitsPerComponent, useWorkers, processingStrategy,
        includeOutputProfile, testFormName, handleProgress, onDownloadProgress,
    }) {
        const generator = new TestFormPDFDocumentGenerator({
            testFormVersion,
            resources,
            debugging,
            outputBitsPerComponent,
            useWorkers,
            processingStrategy,
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
                    onChainOutput: processingStrategy === 'separate-chains'
                        ? async (colorSpace, pdfBuffer, metadataJSON) => {
                            if (!preChainDownloadsCompleted) {
                                if (debugging && includeOutputProfile) {
                                    await downloadArrayBufferAs(iccProfileBuffer, 'Output.icc', 'application/vnd.iccprofile');
                                }
                                await downloadArrayBufferAs(
                                    new TextEncoder().encode(metadataJSON).buffer,
                                    `${testFormName} - metadata.json`,
                                    'application/json',
                                );
                                preChainDownloadsCompleted = true;
                            }
                            await downloadArrayBufferAs(
                                pdfBuffer,
                                `${testFormName} - ${colorSpace}.pdf`,
                                'application/pdf',
                            );
                        }
                        : undefined,
                },
            );
        } finally {
            generator.abort?.();
        }

        const { pdfBuffer, metadataJSON } = generateResult;

        // Download generated files
        if (processingStrategy === 'separate-chains') {
            // Chain PDFs and metadata already downloaded via onChainOutput.
        } else {
            if (debugging && includeOutputProfile) {
                await downloadArrayBufferAs(iccProfileBuffer, 'Output.icc', 'application/vnd.iccprofile');
            }
            await downloadArrayBufferAs(
                new TextEncoder().encode(metadataJSON).buffer,
                `${testFormName} - metadata.json`,
                'application/json',
            );
            await downloadArrayBufferAs(
                /** @type {ArrayBuffer} */ (pdfBuffer),
                `${testFormName}.pdf`,
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
     * @param {boolean} options.includeOutputProfile
     * @param {string} options.testFormName
     * @param {(stage: string, percent: number, message?: string) => void} options.handleProgress
     * @param {(state: any) => void} options.onDownloadProgress
     */
    async #runInBootstrapWorker({
        testFormVersion, resources, iccProfileBuffer, userMetadata,
        debugging, outputBitsPerComponent, useWorkers, processingStrategy,
        includeOutputProfile, testFormName, handleProgress, onDownloadProgress,
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
                            // Handle separate-chains downloads on the main thread
                            if (!preChainDownloadsCompleted) {
                                if (debugging && includeOutputProfile) {
                                    await downloadArrayBufferAs(iccProfileBuffer, 'Output.icc', 'application/vnd.iccprofile');
                                }
                                await downloadArrayBufferAs(
                                    new TextEncoder().encode(data.metadataJSON).buffer,
                                    `${testFormName} - metadata.json`,
                                    'application/json',
                                );
                                preChainDownloadsCompleted = true;
                            }
                            await downloadArrayBufferAs(
                                data.pdfBuffer,
                                `${testFormName} - ${data.colorSpace}.pdf`,
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
                    },
                    [iccProfileCopy],
                );
            });

            // Download generated files (non-separate-chains path)
            if (processingStrategy !== 'separate-chains') {
                if (debugging && includeOutputProfile) {
                    await downloadArrayBufferAs(iccProfileBuffer, 'Output.icc', 'application/vnd.iccprofile');
                }
                await downloadArrayBufferAs(
                    new TextEncoder().encode(result.metadataJSON).buffer,
                    `${testFormName} - metadata.json`,
                    'application/json',
                );
                if (result.pdfBuffer) {
                    await downloadArrayBufferAs(
                        result.pdfBuffer,
                        `${testFormName}.pdf`,
                        'application/pdf',
                    );
                }
            }
        } finally {
            worker.terminate();
            console.log(`${CONTEXT_PREFIX} [TestFormGeneratorAppElement] Bootstrap Worker: terminated`);
        }
    }
}
