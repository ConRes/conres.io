// @ts-check
/// <reference lib="ESNext" />
/// <reference types="emscripten" />

import { PDFDocument } from "pdf-lib";

import {
    downloadArrayBufferAs,
    uint8ArrayToBase64,
    PromiseWithResolvers,
} from "./helpers.js";

import { PDFService } from "./services/PDFService.js";
import { ICCService } from "./services/ICCService.js";
import { GhostscriptService } from "./services/GhostscriptService.js";
import { ColorEngineService, RenderingIntents } from "./services/ColorEngineService.js";

const assetLocations = {
    // 2025-03-22 - ISO Conres PTF 2x-4x

    '2025-03-22 - ISO PTF 2x-4x.pdf.json': new URL('../../../../assets/testforms/2025-03-22 - ISO PTF 2x-4x.pdf.json', import.meta.url).href,
    '2025-03-22 - ISO PTF 2x-4x.pdf': /^https?:\/\/(?:www\.)?(?:conres\.io)\//.test(globalThis.location?.href ?? '')
        ? 'https://media.githubusercontent.com/media/ConRes/conres.io/refs/heads/master/assets/testforms/2025-03-22 - ISO PTF 2x-4x.pdf'
        : new URL('../../../../assets/testforms/2025-03-22 - ISO PTF 2x-4x.pdf', import.meta.url).href,


    '2025-03-22 - ISO PTF 2x-4x/Test Form Template.pdf': /^https?:\/\/(?:www\.)?(?:conres\.io)\//.test(globalThis.location?.href ?? '')
        ? 'https://media.githubusercontent.com/media/ConRes/conres.io/refs/heads/master/assets/testforms/2025-03-22 - ISO PTF 2x-4x.pdf'
        : new URL('../../../../assets/testforms/2025-03-22 - ISO PTF 2x-4x.pdf', import.meta.url).href,
    '2025-03-22 - ISO PTF 2x-4x/Barcode.ps': new URL('../../../../assets/testforms/2025-03-22 - ISO PTF 2x-4x/Barcode.ps', import.meta.url).href,
    '2025-03-22 - ISO PTF 2x-4x/Slug Template.ps': new URL('../../../../assets/testforms/2025-03-22 - ISO PTF 2x-4x/Slug Template.ps', import.meta.url).href,
    '2025-03-22 - ISO PTF 2x-4x/Slugs.json': new URL('../../../../assets/testforms/2025-03-22 - ISO PTF 2x-4x/Slugs.json', import.meta.url).href,

    // 2025-04-25 - ISO Conres PTF 2x-4x

    '2025-04-25 - ISO PTF 2x-4x/Test Form Template.pdf': /^https?:\/\/(?:www\.)?(?:conres\.io)\//.test(globalThis.location?.href ?? '')
        ? 'https://media.githubusercontent.com/media/ConRes/conres.io/refs/heads/master/assets/testforms/2025-04-25 - ISO PTF 2x-4x.pdf'
        : new URL('../../../../assets/testforms/2025-04-25 - ISO PTF 2x-4x.pdf', import.meta.url).href,
    '2025-04-25 - ISO PTF 2x-4x/Barcode.ps': new URL('../../../../assets/testforms/2025-04-25 - ISO PTF 2x-4x/Barcode.ps', import.meta.url).href,
    '2025-04-25 - ISO PTF 2x-4x/Slug Template.ps': new URL('../../../../assets/testforms/2025-04-25 - ISO PTF 2x-4x/Slug Template.ps', import.meta.url).href,
    '2025-04-25 - ISO PTF 2x-4x/Slugs.json': new URL('../../../../assets/testforms/2025-04-25 - ISO PTF 2x-4x/Slugs.json', import.meta.url).href,

    // 2025-04-25 - ISO Conres PTF 2x-4x

    '2025-05-05 - ISO PTF 2x-4x/Test Form Template.pdf': /^https?:\/\/(?:www\.)?(?:conres\.io)\//.test(globalThis.location?.href ?? '')
        ? 'https://media.githubusercontent.com/media/ConRes/conres.io/refs/heads/master/assets/testforms/2025-05-05 - ISO PTF 2x-4x.pdf'
        : new URL('../../../../assets/testforms/2025-05-05 - ISO PTF 2x-4x.pdf', import.meta.url).href,
    '2025-05-05 - ISO PTF 2x-4x/Barcode.ps': new URL('../../../../assets/testforms/2025-05-05 - ISO PTF 2x-4x/Barcode.ps', import.meta.url).href,
    '2025-05-05 - ISO PTF 2x-4x/Slug Template.ps': new URL('../../../../assets/testforms/2025-05-05 - ISO PTF 2x-4x/Slug Template.ps', import.meta.url).href,
    '2025-05-05 - ISO PTF 2x-4x/Slugs.json': new URL('../../../../assets/testforms/2025-05-05 - ISO PTF 2x-4x/Slugs.json', import.meta.url).href,

    // 2025-04-30 - ISO Conres Target Revision

    '2025-05-05 - ISO ConRes21Cr5/Test Form Template.pdf': /^https?:\/\/(?:www\.)?(?:conres\.io)\//.test(globalThis.location?.href ?? '')
        ? 'https://media.githubusercontent.com/media/ConRes/conres.io/refs/heads/master/assets/testforms/2025-05-05 - ISO ConRes21Cr5.pdf'
        : new URL('../../../../assets/testforms/2025-05-05 - ISO ConRes21Cr5.pdf', import.meta.url).href,
    '2025-05-05 - ISO ConRes21Cr5/Barcode.ps': new URL('../../../../assets/testforms/2025-05-05 - ISO ConRes21Cr5/Barcode.ps', import.meta.url).href,
    '2025-05-05 - ISO ConRes21Cr5/Slug Template.ps': new URL('../../../../assets/testforms/2025-05-05 - ISO ConRes21Cr5/Slug Template.ps', import.meta.url).href,
    '2025-05-05 - ISO ConRes21Cr5/Slugs.json': new URL('../../../../assets/testforms/2025-05-05 - ISO ConRes21Cr5/Slugs.json', import.meta.url).href,
    '2025-05-05 - ISO ConRes21Cr5/Settings.json': new URL('../../../../assets/testforms/2025-05-05 - ISO ConRes21Cr5/Settings.json', import.meta.url).href,

    // 2025-08-15 - ISO Conres PTF CR1

    '2025-08-15 - ConRes - ISO PTF - CR1/Test Form Template.pdf': /^https?:\/\/(?:www\.)?(?:conres\.io)\//.test(globalThis.location?.href ?? '')
        ? 'https://media.githubusercontent.com/media/ConRes/conres.io/refs/heads/master/assets/testforms/2025-08-15 - ConRes - ISO PTF - CR1.pdf'
        : new URL('../../../../assets/testforms/2025-08-15 - ConRes - ISO PTF - CR1.pdf', import.meta.url).href,
    '2025-08-15 - ConRes - ISO PTF - CR1/Barcode.ps': new URL('../../../../assets/testforms/2025-08-15 - ConRes - ISO PTF - CR1/Barcode.ps', import.meta.url).href,
    '2025-08-15 - ConRes - ISO PTF - CR1/Slug Template.ps': new URL('../../../../assets/testforms/2025-08-15 - ConRes - ISO PTF - CR1/Slug Template.ps', import.meta.url).href,
    '2025-08-15 - ConRes - ISO PTF - CR1/Slugs.json': new URL('../../../../assets/testforms/2025-08-15 - ConRes - ISO PTF - CR1/Slugs.json', import.meta.url).href,
    '2025-08-15 - ConRes - ISO PTF - CR1/Settings.json': new URL('../../../../assets/testforms/2025-08-15 - ConRes - ISO PTF - CR1/Settings.json', import.meta.url).href,

    '2025-08-15 - ConRes - ISO PTF - CR1 - Interlaken Map/Test Form Template.pdf': /^https?:\/\/(?:www\.)?(?:conres\.io)\//.test(globalThis.location?.href ?? '')
        ? 'https://media.githubusercontent.com/media/ConRes/conres.io/refs/heads/master/assets/testforms/2025-08-15 - ConRes - ISO PTF - CR1 - Interlaken Map.pdf'
        : new URL('../../../../assets/testforms/2025-08-15 - ConRes - ISO PTF - CR1 - Interlaken Map.pdf', import.meta.url).href,
    '2025-08-15 - ConRes - ISO PTF - CR1 - Interlaken Map/Barcode.ps': new URL('../../../../assets/testforms/2025-08-15 - ConRes - ISO PTF - CR1 - Interlaken Map/Barcode.ps', import.meta.url).href,
    '2025-08-15 - ConRes - ISO PTF - CR1 - Interlaken Map/Slug Template.ps': new URL('../../../../assets/testforms/2025-08-15 - ConRes - ISO PTF - CR1 - Interlaken Map/Slug Template.ps', import.meta.url).href,
    '2025-08-15 - ConRes - ISO PTF - CR1 - Interlaken Map/Slugs.json': new URL('../../../../assets/testforms/2025-08-15 - ConRes - ISO PTF - CR1 - Interlaken Map/Slugs.json', import.meta.url).href,
    '2025-08-15 - ConRes - ISO PTF - CR1 - Interlaken Map/Settings.json': new URL('../../../../assets/testforms/2025-08-15 - ConRes - ISO PTF - CR1 - Interlaken Map/Settings.json', import.meta.url).href,
};

const DEBUG_FIELDSETS = false;
const DEBUG_FETCH = false;
const DEBUG_METADATA = false;

/**
 * @typedef {object} FetchState
 * @property {string} name
 * @property {string} location
 * @property {number} totalBytes
 * @property {number} receivedBytes
 * @property {boolean} done
 * @property {boolean} aborted
 */

/**
 * @typedef {'ready'|'overview'|'download' | 'conversion' | 'color-conversion' | 'validation' | 'documentation' | 'generation' | 'exporting' | 'done' | 'aborted'} TestFormGeneratorStage
 */

/**
 * @typedef {object} TestFormGeneratorState
 * @property {TestFormGeneratorStage} [stage]
 * @property {boolean} [aborted]
 * @property {HTMLFormElement} form
 * @property {Partial<Record<TestFormGeneratorStage, HTMLElement>>} sections
 * @property {Partial<Record<`${TestFormGeneratorStage}-fieldset`, HTMLFieldSetElement>>} fieldsets
 * @property {Record<string, ArrayBuffer>} resources
 * @property {Record<string, unknown>} [metadata]
 */

/**
 * @typedef {object} TestFormGeneratorOptions
 * @property {boolean} [overviewStage]
 * @property {boolean} [downloadStage]
 * @property {boolean} [conversionStage]
 * @property {boolean} [validationStage]
 * @property {boolean} [colorConversionStage] - Enable in-browser color conversion using Color Engine
 * @property {boolean} [documentationStage]
 * @property {boolean} [generationStage]
 * @property {boolean} [disableManifest]
 * @property {boolean} [disableDownload]
 * @property {boolean} [disableProfileCountCheck]
 * @property {'default'|'expert'} [userMode]
 * @property {string} [destinationProfileUrl] - URL to the destination ICC profile for color conversion
 * @property {import('./services/ColorEngineService.js').RenderingIntent} [renderingIntent]
 */
class TestFormGenerator {

    /** @type {AbortController?} */
    #abortController = new AbortController();

    #aborted = false;

    /** @type {Record<string, string>} */
    #assetLocations = { ...assetLocations };

    /** @type {Record<string, Promise<ArrayBuffer>>} */
    #assetCache = {};

    #cache;

    /** @type {TestFormGeneratorOptions} */
    #options;

    /**
     * @param {TestFormGeneratorOptions} [options={}]
     */
    constructor(options = {}) {
        this.#abortController?.signal.addEventListener('abort', event => {
            this.#aborted = true;
            this.#abortController = null;
        }, { 'once': true });

        this.#cache = globalThis.caches?.open?.('conres-testforms');

        this.#options = Object.freeze({ ...options });
    }

    /**
     * @param {HTMLFormElement} form
     */
    async execute(form) {
        /** @type {TestFormGeneratorState['fieldsets']} */
        const fieldsets = {};
        /** @type {TestFormGeneratorState['sections']} */
        const sections = {};

        for (const fieldset of form.querySelectorAll('fieldset')) {
            if (!fieldset.name) continue;
            fieldsets[/** @type {keyof TestFormGeneratorState['fieldsets']} */ (fieldset.name)] = /** @type {HTMLFieldSetElement} */ (fieldset);
        }

        for (const section of form.querySelectorAll('article, section')) {
            if (!section.id) continue;
            sections[/** @type {keyof TestFormGeneratorState['sections']} */ (section.id)] = /** @type {HTMLElement} */ (section);
        }

        /** @type {TestFormGeneratorState} */
        const state = { form, fieldsets, sections, resources: {} };
        const steps = this.#allStages(state);

        try {
            for await (const step of steps) {
                if (this.#aborted) break;
                const state = await step;
                console.log('TestFormGenerator %o', state);
            }

            await steps.return();
        } catch (error) {
            this.#abortController?.abort(error);
            state.aborted = true;
            console.error('TestFormGenerator %o', error);
        }

        return state;
    }

    /**
     * @param {TestFormGeneratorState} state 
     */
    async * #allStages(state) {
        for (const fieldset of Object.values(state.fieldsets))
            fieldset.setAttribute('disabled', '');

        state.stage = 'ready';

        const userMode = this.#options.userMode ?? 'default';

        yield state;
        if (this.#options.overviewStage ?? (userMode !== 'expert')) yield* this.#overviewStage(state);
        if (this.#options.downloadStage ?? true) yield* this.#downloadStage(state);
        if (this.#options.conversionStage ?? (userMode !== 'expert')) yield* this.#conversionStage(state);
        if (this.#options.colorConversionStage ?? false) yield* this.#colorConversionStage(state);
        if (this.#options.validationStage ?? true) yield* this.#validationStage(state);
        if (this.#options.documentationStage ?? true) yield* this.#documentationStage(state);
        if (this.#options.generationStage ?? true) yield* this.#generationStage(state);
        state.stage = 'done';
        yield state;
    }

    /**
     * @param {TestFormGeneratorState} state 
     */
    async * #overviewStage(state) {
        state.stage = 'overview';

        const fieldset = state.fieldsets['overview-fieldset'];

        if ((this.#options.userMode ?? 'default') === 'default') {

            yield state;

            if (!fieldset)
                throw new Error('Export fieldset missing');

            fieldset.removeAttribute('disabled');
            (fieldset.parentElement ?? fieldset).scrollIntoView({ behavior: 'smooth', 'block': 'center', 'inline': 'nearest' });
            await new Promise(resolve => requestAnimationFrame(resolve));
            if (DEBUG_FIELDSETS) {
                await new Promise(resolve => setTimeout(resolve, 1000));
            } else {
                // const { promise, resolve, reject } = Promise.withResolvers();
                const { promise, resolve, reject } = PromiseWithResolvers();
                const overviewContinueButton = /** @type {HTMLButtonElement} */(state.form.elements.namedItem('test-form-overview-continue-button'));

                overviewContinueButton.onclick = () => resolve(undefined);

                await promise;
            }
            // fieldset.focus();
            // yield state;
            fieldset.setAttribute('disabled', '');
        } else if (this.#options.userMode !== 'expert') {
            throw new Error('Expert mode not supported');
        }

    }

    /**
     * @param {TestFormGeneratorState} state 
     */
    async * #conversionStage(state) {
        state.stage = 'conversion';

        const fieldset = state.fieldsets['conversion-fieldset'];

        // if ((this.#options.userMode ?? 'default') === 'default') {
        yield state;

        if (!fieldset)
            throw new Error('Export fieldset missing');

        fieldset.removeAttribute('disabled');
        (fieldset.parentElement ?? fieldset).scrollIntoView({ behavior: 'smooth', 'block': 'center', 'inline': 'nearest' });
        await new Promise(resolve => requestAnimationFrame(resolve));
        if (DEBUG_FIELDSETS) {
            await new Promise(resolve => setTimeout(resolve, 1000));
        } else {
            // const { promise, resolve, reject } = Promise.withResolvers();
            const { promise, resolve, reject } = PromiseWithResolvers();
            const conversionContinueButton = /** @type {HTMLButtonElement} */(state.form.elements.namedItem('test-form-conversion-continue-button'));

            conversionContinueButton.onclick = () => resolve(undefined);

            await promise;
        }
        // fieldset.focus();
        // yield state;
        fieldset.setAttribute('disabled', '');
        // } else if (this.#options.userMode !== 'expert') {
        //     throw new Error('Expert mode not supported');
        // }
    }

    /**
     * In-browser color conversion stage using Color Engine
     * @param {TestFormGeneratorState} state
     */
    async * #colorConversionStage(state) {
        state.stage = 'color-conversion';

        const fieldset = state.fieldsets['color-conversion-fieldset'];

        yield state;

        if (!fieldset)
            throw new Error('Color conversion fieldset missing');

        fieldset.removeAttribute('disabled');
        (fieldset.parentElement ?? fieldset).scrollIntoView({ behavior: 'smooth', 'block': 'center', 'inline': 'nearest' });
        await new Promise(resolve => requestAnimationFrame(resolve));

        if (DEBUG_FIELDSETS) {
            await new Promise(resolve => setTimeout(resolve, 1000));
        } else {
            const { promise, resolve, reject } = PromiseWithResolvers();

            const sourceFileInput = /** @type {HTMLInputElement} */ (state.form.elements.namedItem('color-conversion-source-file-input'));
            const profileFileInput = /** @type {HTMLInputElement} */ (state.form.elements.namedItem('color-conversion-profile-file-input'));
            const renderingIntentSelect = /** @type {HTMLSelectElement} */ (state.form.elements.namedItem('color-conversion-rendering-intent'));
            const convertButton = /** @type {HTMLButtonElement} */ (state.form.elements.namedItem('color-conversion-convert-button'));
            const progressFieldset = /** @type {HTMLFieldSetElement} */ (state.form.elements.namedItem('color-conversion-progress-fieldset'));
            const progressBar = /** @type {HTMLProgressElement} */ (progressFieldset?.querySelector('progress'));
            const progressOutput = /** @type {HTMLOutputElement} */ (state.form.elements.namedItem('color-conversion-progress-output'));

            convertButton.onclick = async () => {
                try {
                    const sourceFile = sourceFileInput?.files?.[0];
                    const profileFile = profileFileInput?.files?.[0];

                    if (!sourceFile) {
                        alert('Please select a source PDF file.');
                        return;
                    }

                    if (!profileFile) {
                        alert('Please select a destination ICC profile.');
                        return;
                    }

                    // Show progress
                    if (progressFieldset) progressFieldset.style.opacity = '';
                    if (progressBar) {
                        progressBar.removeAttribute('value');
                        progressBar.removeAttribute('max');
                    }
                    if (progressOutput) progressOutput.value = 'Loading PDF...';

                    await new Promise(r => requestAnimationFrame(r));

                    // Load the source PDF
                    const sourceBuffer = await sourceFile.arrayBuffer();
                    const pdfDocument = await PDFDocument.load(sourceBuffer);

                    if (progressOutput) progressOutput.value = 'Loading ICC profile...';
                    await new Promise(r => requestAnimationFrame(r));

                    // Load the destination profile
                    const profileBuffer = await profileFile.arrayBuffer();
                    const profileHeader = ICCService.parseICCHeaderFromSource(profileBuffer);

                    if (profileHeader.colorSpace !== 'CMYK') {
                        throw new Error(`Destination profile must be CMYK. Got: ${profileHeader.colorSpace}`);
                    }

                    if (progressOutput) progressOutput.value = 'Converting colors...';
                    await new Promise(r => requestAnimationFrame(r));

                    // Get rendering intent
                    const renderingIntent = /** @type {import('./services/ColorEngineService.js').RenderingIntent} */ (
                        renderingIntentSelect?.value || 'relative-colorimetric'
                    );

                    console.time('PDFService.convertColorInPDFDocument');

                    // Perform color conversion
                    // Note: Blending space update is handled separately in generationStage via replaceTransarencyBlendingSpaceInPDFDocument
                    const conversionResult = await PDFService.convertColorInPDFDocument(pdfDocument, {
                        destinationProfile: profileBuffer,
                        renderingIntent,
                        convertImages: true,
                        convertContentStreams: true,
                        verbose: false,
                    });

                    console.timeEnd('PDFService.convertColorInPDFDocument');
                    console.log('Color conversion result:', conversionResult);

                    if (progressOutput) progressOutput.value = 'Saving PDF...';
                    await new Promise(r => requestAnimationFrame(r));

                    // Save the converted PDF
                    const convertedBuffer = /** @type {ArrayBuffer} */ ((await pdfDocument.save()).buffer);

                    // Store in resources for next stages
                    state.resources['Test Form.pdf'] = convertedBuffer;
                    state.resources['input/Output.icc'] = profileBuffer;

                    // Download the converted PDF
                    const fileName = sourceFile.name.replace(/\.pdf$/i, '') + ' (Converted).pdf';
                    await downloadArrayBufferAs(convertedBuffer, fileName, 'application/pdf');

                    if (progressBar) {
                        progressBar.value = 100;
                        progressBar.max = 100;
                    }
                    if (progressOutput) progressOutput.value = '100% - Conversion complete!';

                    resolve(undefined);

                } catch (error) {
                    console.error('Color conversion failed:', error);
                    if (progressOutput) progressOutput.value = `Error: ${error}`;
                    if (progressBar) {
                        progressBar.value = 0;
                        progressBar.max = 100;
                    }
                    // Don't reject - allow user to try again
                }
            };

            await promise;
            convertButton.onclick = null;
        }

        fieldset.setAttribute('disabled', '');
    }

    /**
     * @param {TestFormGeneratorState} state
     */
    async * #downloadStage(state) {
        state.stage = 'download';

        const fieldset = state.fieldsets['download-fieldset'];

        yield state;

        if (!fieldset)
            throw new Error('Download fieldset missing');

        fieldset.removeAttribute('disabled');
        (fieldset.parentElement ?? fieldset).scrollIntoView({ behavior: 'smooth', 'block': 'center', 'inline': 'nearest' });
        await new Promise(resolve => requestAnimationFrame(resolve));
        if (DEBUG_FIELDSETS) {
            await new Promise(resolve => setTimeout(resolve, 1000));
        } else {
            // const { promise, resolve, reject } = Promise.withResolvers();
            const { promise, resolve, reject } = PromiseWithResolvers();

            const testFormVersionSelect = /** @type {HTMLSelectElement} */(state.form.elements.namedItem('test-form-version'));
            const downloadButton = /** @type {HTMLButtonElement} */(state.form.elements.namedItem('test-form-download-button'));
            const downloadSkipButton = /** @type {HTMLButtonElement} */(state.form.elements.namedItem('test-form-download-skip-button'));
            const downloadProgressFieldset = /** @type {HTMLFieldSetElement} */ (state.form.elements.namedItem('download-progress-fieldset'));
            // const downloadProgress = /** @type {HTMLProgressElement} */ (state.form.elements.namedItem('test-form-download-progress'));
            const downloadProgress = /** @type {HTMLProgressElement} */ (downloadProgressFieldset.querySelector('progress'));
            const downloadProgressOutput = /** @type {HTMLOutputElement} */(state.form.elements.namedItem('test-form-download-progress-output'));

            // const sourceTestFormFileInput = /** @type {HTMLInputElement} */(state.form.elements.namedItem('source-test-form-file-input'));

            // const updateSourceTestFileInputField = () => {
            //     const testFormName = testFormVersionSelect.value;
            //     const assetLocation = this.#assetLocations[testFormName];
            //     sourceTestFormFileInput.dispatchEvent(new Event('change', { 'bubbles': true, 'cancelable': true }));
            // };

            // sourceTestFormFileInput.onchange = event => { console.log('TestFormGenerator %o', event); }

            // testFormVersionSelect.onchange = () => { updateSourceTestFileInputField(); };

            // updateSourceTestFileInputField();

            /** @todo Implement alternative test form loading from local filesystem */

            downloadSkipButton.onclick = async () => {
                // if (state.resources['Test Form.pdf'])
                resolve(undefined);
                // else
                // alert('The test form must be downloaded first.');
            };

            downloadButton.onclick = async () => {
                // const testFormVersionSelect = state.form.querySelector('select#test-form-version-select');
                try {
                    const testFormName = testFormVersionSelect.value;
                    console.log('TestFormGenerator %o', { testFormName });
                    // console.log(downloadProgressFieldset);

                    const downloadedTestFormManifestArrayBuffer = await this.#loadAsset(`${testFormName}/Slugs.json`);
                    const downloadedTestFormManifest = JSON.parse(new TextDecoder().decode(downloadedTestFormManifestArrayBuffer));

                    console.log({ downloadedTestFormManifest });

                    downloadProgressFieldset.style.opacity = "";
                    downloadProgress.removeAttribute('value');
                    downloadProgress.removeAttribute('max');
                    downloadProgressOutput.value = `Downloading…`;

                    await new Promise(resolve => requestAnimationFrame(resolve));

                    /** @type {number|undefined} */
                    let nextFrame = undefined;

                    const downloadedTestFormArrayBuffer = await this.#loadAsset(`${testFormName}/Test Form Template.pdf`, {
                        /**
                         * @param {FetchState} fetchState 
                         */
                        async update(fetchState) {
                            if (nextFrame) nextFrame = void cancelAnimationFrame(nextFrame);

                            if (fetchState.done) {
                                requestAnimationFrame(() => {
                                    const totalBytes = isNaN(fetchState.totalBytes) ? 0 : fetchState.totalBytes;
                                    const recievedBytes = isNaN(fetchState.receivedBytes) ? 0 : Math.max(totalBytes, fetchState.receivedBytes);
                                    downloadProgress.value = recievedBytes;
                                    downloadProgress.max = totalBytes;
                                    downloadProgressOutput.value = totalBytes > 0 ? `${Math.floor(recievedBytes / totalBytes * 100)}%` : 'Done';
                                });
                            } else {
                                nextFrame = requestAnimationFrame(() => {
                                    try {
                                        if (fetchState.totalBytes >= fetchState.receivedBytes) {
                                            downloadProgressOutput.value = `${Math.floor(
                                                (downloadProgress.value = fetchState.receivedBytes) / (downloadProgress.max = fetchState.totalBytes) * 100
                                            )}%`;
                                        } else {
                                            downloadProgress.removeAttribute('value');
                                            downloadProgress.removeAttribute('max');
                                            downloadProgressOutput.value = ``;
                                        }
                                    } catch (error) {
                                        console.error('TestFormGenerator %o', error);
                                    }
                                });
                            }
                        },
                    });

                    /** @todo Embed Slug and Barcode */

                    const pdfDocument = await PDFDocument.load(downloadedTestFormArrayBuffer);

                    // await pdfDocument.attach(downloadedTestFormManifestArrayBuffer, 'test-form.manifest.json', { 'mimeType': 'application/json' });
                    await PDFService.attachManifestToPDFDocument(pdfDocument, downloadedTestFormManifestArrayBuffer, 'test-form.manifest.json');

                    const modifiedTestFormArrayBuffer = /** @type {ArrayBuffer} */ ((await pdfDocument.save({ addDefaultPage: false, updateFieldAppearances: false })).buffer);

                    if (DEBUG_FETCH) await downloadArrayBufferAs(downloadedTestFormArrayBuffer, `${testFormName} (Fetched).pdf`, 'application/pdf');

                    await downloadArrayBufferAs(modifiedTestFormArrayBuffer, `${testFormName}.pdf`, 'application/pdf');

                    resolve(undefined);
                } catch (error) {
                    reject(error);
                }
                // this.#loadAsset
            };

            await promise;

            downloadButton.onclick = downloadSkipButton.onclick = null;

        }
        // fieldset.focus();
        // yield state;
        fieldset.setAttribute('disabled', '');
    }

    /**
     * @param {TestFormGeneratorState} state 
     */
    async * #validationStage(state) {
        state.stage = 'validation';

        const fieldset = state.fieldsets['validation-fieldset'];

        yield state;

        if (!fieldset)
            throw new Error('Validation fieldset missing');

        fieldset.removeAttribute('disabled');
        (fieldset.parentElement ?? fieldset).scrollIntoView({ behavior: 'smooth', 'block': 'center', 'inline': 'nearest' });
        await new Promise(resolve => requestAnimationFrame(resolve));

        if (DEBUG_FIELDSETS) {
            await new Promise(resolve => setTimeout(resolve, 1000));
        } else {
            const { promise, resolve, reject } = PromiseWithResolvers();

            const preparedTestFormFileInput = /** @type {HTMLInputElement} */(state.form.elements.namedItem('prepared-test-form-file-input'));
            const validationButton = /** @type {HTMLButtonElement} */(state.form.elements.namedItem('test-form-validation-button'));
            const validationProgressFieldset = /** @type {HTMLFieldSetElement} */(state.form.elements.namedItem('validation-progress-fieldset'));
            const validationProgress = /** @type {HTMLProgressElement} */(validationProgressFieldset.querySelector('progress'));
            const validationProgressOutput = /** @type {HTMLOutputElement} */(state.form.elements.namedItem('test-form-validation-progress-output'));

            const validate = async () => {
                validationProgressFieldset.style.opacity = "";
                validationProgress.removeAttribute('value');
                validationProgress.removeAttribute('max');
                validationProgressOutput.value = `Validating…`;

                try {
                    state.resources = {};
                    await new Promise(resolve => requestAnimationFrame(resolve));

                    const preparedTestFormFile = preparedTestFormFileInput.files?.[0];
                    if (!preparedTestFormFile) {
                        validationProgressOutput.value = `The color converted test form must be provided above.`;
                        validationProgress.value = 0;
                        validationProgress.max = 0;
                        return;
                    }

                    const pdfDocumentBuffer = await preparedTestFormFile.arrayBuffer();
                    const pdfDocument = await PDFDocument.load(pdfDocumentBuffer);

                    const manifestResult = PDFService.extractManifestFromPDFDocument(pdfDocument);

                    if (!this.#options.disableManifest && !(manifestResult?.buffer instanceof ArrayBuffer))
                        throw new Error('The PDF does not have a valid manifest attached.');

                    const iccProfilesMap = PDFService.extractICCProfilesFromPDFDocument(pdfDocument);
                    const iccProfilesSet = new Set(iccProfilesMap.values());

                    if (!this.#options.disableProfileCountCheck) {
                        if (iccProfilesSet.size !== 1)
                            throw new Error(`The PDF must contain exactly one ICC profile. Found ${iccProfilesSet.size} ICC profiles.`);

                        const iccProfile = [...iccProfilesSet][0];

                        state.resources['input/Output.icc'] = iccProfile.buffer.buffer.slice();
                    }

                    state.resources['Test Form.pdf'] = pdfDocumentBuffer.slice();

                    if (manifestResult?.buffer)
                        state.resources['Slugs.json'] = manifestResult.buffer;

                } catch (error) {
                    console.error('TestFormGenerator %o', error, { ...state });
                    validationProgressOutput.value = `Validation failed: ${error}`;
                    validationProgress.value = 0;
                    validationProgress.max = 0;
                    state.resources = {};
                    reject(error);
                    return;
                }

                validationProgressOutput.value = `100%`;
                validationProgress.value = 100;
                validationProgress.max = 100;
                resolve(undefined);
                return;
            };

            validationButton.onclick = validate;

            if (this.#options.userMode === 'expert') preparedTestFormFileInput.onchange = validate;

            await promise;
            validationButton.onclick = null;
        }

        fieldset.setAttribute('disabled', '');
    }



    /**
    * @param {TestFormGeneratorState} state 
    */
    async * #documentationStage(state) {
        state.stage = 'documentation';

        const fieldset = state.fieldsets['documentation-fieldset'];

        yield state;

        if (!fieldset)
            throw new Error('Documentation fieldset missing');

        fieldset.removeAttribute('disabled');
        (fieldset.parentElement ?? fieldset).scrollIntoView({ behavior: 'smooth', 'block': 'center', 'inline': 'nearest' });
        await new Promise(resolve => requestAnimationFrame(resolve));
        if (DEBUG_FIELDSETS) {
            await new Promise(resolve => setTimeout(resolve, 1000));
        } else {
            // const { promise, resolve, reject } = Promise.withResolvers();
            const { promise, resolve, reject } = PromiseWithResolvers();

            // const testFormDocumentationButton = /** @type {HTMLButtonElement} */(state.form.elements.namedItem('test-form-documentation-button'));
            const testFormDocumentationResetButton = /** @type {HTMLButtonElement} */(state.form.elements.namedItem('test-form-documentation-reset-button'));
            const testFormDocumentationSaveButton = /** @type {HTMLButtonElement} */(state.form.elements.namedItem('test-form-documentation-save-button'));
            const testFormDocumentationDeviceInput = /** @type {HTMLInputElement} */(state.form.elements.namedItem('device-input'));
            const testFormDocumentationColorantsInput = /** @type {HTMLInputElement} */(state.form.elements.namedItem('colorants-input'));
            const testFormDocumentationSubstrateInput = /** @type {HTMLInputElement} */(state.form.elements.namedItem('substrate-input'));
            const testFormDocumentationSettingsInput = /** @type {HTMLInputElement} */(state.form.elements.namedItem('settings-input'));
            const testFormDocumentationEmailInput = /** @type {HTMLInputElement} */(state.form.elements.namedItem('email-input'));

            const defaults =
                DEBUG_METADATA ? {
                    device: 'a device',
                    colorants: 'some colorants',
                    substrate: 'a substrate',
                    settings: 'some settings',
                    email: 'an email',
                } : {
                    device: undefined,
                    colorants: undefined,
                    substrate: undefined,
                    settings: undefined,
                    email: undefined,
                };

            testFormDocumentationSaveButton.onclick = async () => {
                (state.metadata ??= {}).slugs = {
                    device: testFormDocumentationDeviceInput.value || defaults.device,
                    colorants: testFormDocumentationColorantsInput.value || defaults.colorants,
                    substrate: testFormDocumentationSubstrateInput.value || defaults.substrate,
                    settings: testFormDocumentationSettingsInput.value || defaults.settings,
                    email: testFormDocumentationEmailInput.value || defaults.email,
                };

                resolve(undefined);
                // const testFormVersionSelect = state.form.querySelector('select#test-form-version-select');
            };

            testFormDocumentationResetButton.onclick = async () => {
                testFormDocumentationDeviceInput.value = '';
                testFormDocumentationColorantsInput.value = '';
                testFormDocumentationSubstrateInput.value = '';
                testFormDocumentationSettingsInput.value = '';
                testFormDocumentationEmailInput.value = '';
            };

            await promise;

            testFormDocumentationSaveButton.onclick = testFormDocumentationResetButton.onclick = null;
        }
        // fieldset.focus();
        // yield state;
        fieldset.setAttribute('disabled', '');
    }



    /**
     * @param {TestFormGeneratorState} state 
     */
    async * #generationStage(state) {
        state.stage = 'generation';

        const fieldset = state.fieldsets['generation-fieldset'];

        yield state;

        if (!fieldset)
            throw new Error('Generation fieldset missing');

        fieldset.removeAttribute('disabled');
        (fieldset.parentElement ?? fieldset).scrollIntoView({ behavior: 'smooth', 'block': 'center', 'inline': 'nearest' });
        await new Promise(resolve => requestAnimationFrame(resolve));

        if (DEBUG_FIELDSETS) {
            await new Promise(resolve => setTimeout(resolve, 1000));
        } else {
            const generateTestFormButton = /** @type {HTMLButtonElement} */(state.form.elements.namedItem('test-form-generation-button'));
            const generateTestFormDebuggingCheckbox = /** @type {HTMLInputElement} */(state.form.elements.namedItem('test-form-generation-debugging-checkbox'));
            const { promise, resolve, reject } = PromiseWithResolvers();

            const generate = async () => {
                try {
                    if (!state?.resources?.['Test Form.pdf'])
                        throw new Error('Missing Test Form Template.pdf');

                    const testFormDocumentSourceBuffer = /** @type {ArrayBuffer?} */ (state.resources['Test Form.pdf'] || null);;

                    if (!testFormDocumentSourceBuffer)
                        throw new Error('Missing Test Form Template.pdf');

                    const testFormDocument = await PDFDocument.load(testFormDocumentSourceBuffer);

                    const iccProfileSourceBuffer = /** @type {ArrayBuffer?} */ (state.resources['input/Output.icc'] || null);

                    if (!this.#options.disableProfileCountCheck && !iccProfileSourceBuffer)
                        throw new Error('Missing ICC profile (input/Output.icc)');

                    const iccProfileHeader = iccProfileSourceBuffer ? ICCService.parseICCHeaderFromSource(iccProfileSourceBuffer) : null;

                    if (iccProfileHeader && iccProfileHeader.colorSpace !== 'RGB' && iccProfileHeader.colorSpace !== 'CMYK')
                        throw new Error(`The ICC profile must be RGB or CMYK. The ICC profile is ${iccProfileHeader.colorSpace}.`);

                    /** @type {object?} */
                    const slugsMetadata = state.metadata?.slugs ?? null;

                    state.resources = {
                        .../** @type {Record<'Slugs.json' | 'input/Output.icc', ArrayBuffer>} */ (state.resources),
                        ...slugsMetadata && {
                            'Slug Template.ps': await this.#loadAsset('2025-03-22 - ISO PTF 2x-4x/Slug Template.ps'),
                            'input/Barcode.ps': await this.#loadAsset('2025-03-22 - ISO PTF 2x-4x/Barcode.ps'),
                        },
                    };

                    /** @type {object|undefined} */
                    let attachedManifest = undefined;

                    if (slugsMetadata) {
                        const slugTemplateSourceBuffer = state.resources['Slug Template.ps'];
                        if (!slugTemplateSourceBuffer)
                            throw new Error('Missing Slug Template.ps');

                        const slugTemplateSourceText = new TextDecoder().decode(new Uint8Array(slugTemplateSourceBuffer));
                        const attachedManifestBuffer = state.resources['Slugs.json'];

                        if (!attachedManifestBuffer)
                            throw new Error('Missing Slugs.json');

                        const attachedManifestSourceText = new TextDecoder().decode(new Uint8Array(attachedManifestBuffer));

                        attachedManifest = JSON.parse(attachedManifestSourceText);

                        if (!attachedManifest || typeof attachedManifest !== 'object')
                            throw new Error('Invalid Slugs.json manifest');

                        const slugSourceText = GhostscriptService.processSlugTemplate(
                            slugTemplateSourceText,
                            attachedManifest,
                            state.metadata
                        );

                        state.resources['input/Slugs.ps'] = new TextEncoder().encode(slugSourceText).buffer;

                        const slugsOutputBuffer = await GhostscriptService.generateSlugsPDF(
                            state.resources,
                            iccProfileHeader?.colorSpace ?? 'CMYK',
                            generateTestFormDebuggingCheckbox.checked
                        );

                        state.resources['output/Slugs.pdf'] = slugsOutputBuffer;

                        const slugsDocument = await PDFDocument.load(state.resources['output/Slugs.pdf']);

                        await PDFService.embedSlugsIntoPDFDocument(testFormDocument, slugsDocument);
                    } else if (!this.#options.disableManifest) {
                        throw new Error('No slugs metadata provided. The test form cannot be generated without slugs metadata.');
                    } else {
                        console.warn('No slugs metadata provided. Skipping slug generation.');
                    }

                    const iccProfileBytes = new Uint8Array(state.resources['input/Output.icc']);

                    const iccProfilesMap = PDFService.extractICCProfilesFromPDFDocument(testFormDocument);
                    const iccProfileReference = [...iccProfilesMap.keys()][0];

                    console.time('PDFService.decalibrateColorInPDFDocument');
                    await PDFService.decalibrateColorInPDFDocument(testFormDocument);
                    console.timeEnd('PDFService.decalibrateColorInPDFDocument');

                    if (iccProfileHeader) {
                        console.time('PDFService.replaceTransarencyBlendingSpace');
                        await PDFService.replaceTransarencyBlendingSpaceInPDFDocument(testFormDocument, `Device${iccProfileHeader.colorSpace}`);
                        console.timeEnd('PDFService.replaceTransarencyBlendingSpace');
                    }

                    if (iccProfileHeader) {
                        console.time('PDFService.setOutputIntentForPDFDocument');

                        PDFService.setOutputIntentForPDFDocument(testFormDocument, {
                            // iccProfile: iccProfileBytes.slice(),
                            iccProfile: iccProfileReference,
                            identifier: iccProfileHeader.description || `ICCBased_${iccProfileHeader.colorSpace}`,
                            subType: 'GTS_PDFX',
                        });
                    }

                    console.timeEnd('PDFService.setOutputIntentForPDFDocument');

                    state.resources['output/Test Form.pdf'] = /** @type {ArrayBuffer} */ ((await testFormDocument.save()).buffer);

                    /** @satisfies {Parameters<uint8ArrayToBase64>[1]} */
                    const base64Options = { 'alphabet': 'base64' };

                    const iccProfileBase64 = uint8ArrayToBase64(iccProfileBytes, base64Options);

                    // const slugsResource = state.resources['output/Slugs.pdf'];
                    // const slugsBytes = slugsResource ? new Uint8Array(slugsResource) : undefined;
                    // const slugsBase64 = slugsResource ? uint8ArrayToBase64(slugsBytes, base64Options) : undefined;

                    // const iccProfileHeader = ICCService.parseICCHeader(state.resources['input/Output.icc']);

                    state.resources['output/metadata.json'] = new TextEncoder().encode(JSON.stringify({
                        metadata: state.metadata || undefined,
                        manifest: attachedManifest || undefined,
                        ...slugsMetadata && {
                            slugs: {
                                contents: {
                                    type: 'application/pdf',
                                    base64: uint8ArrayToBase64(new Uint8Array(state.resources['output/Slugs.pdf']), base64Options),
                                },
                            },
                        } || {},
                        color: {
                            profile: {
                                ...iccProfileHeader,
                                contents: {
                                    type: 'application/vnd.iccprofile',
                                    base64: iccProfileBase64,
                                }
                            }
                        },
                    }, null, 2)).buffer;

                    const isDebugging = generateTestFormDebuggingCheckbox.checked;

                    if (!this.#options.disableDownload) {
                        if (isDebugging) {
                            if (state.resources['input/Output.icc'])
                                await downloadArrayBufferAs(state.resources['input/Output.icc'], "Output.icc", "application/vnd.iccprofile");
                            if (state.resources['output/Slugs.pdf'])
                                await downloadArrayBufferAs(state.resources['output/Slugs.pdf'], "Slugs.pdf", "application/pdf");
                        }

                        if (state.resources['output/metadata.json'])
                            await downloadArrayBufferAs(state.resources['output/metadata.json'], "metadata.json", "application/json");

                        if (state.resources['output/Test Form.pdf'])
                            await downloadArrayBufferAs(state.resources['output/Test Form.pdf'], "Test Form.pdf", "application/pdf");
                    }

                    resolve(undefined);
                } catch (error) {
                    alert('An error occurred during the generation of the test form. Please try again.');
                    console.error('TestFormGenerator %o', error, { ...state });
                    reject(error);
                }
            };

            generateTestFormButton.onclick = generate;

            if (this.#options.userMode === 'expert') await generate();

            await promise;

            generateTestFormButton.onclick = null;
        }

        fieldset.setAttribute('disabled', '');
    }

    /**
     * 
     * @param {string} assetName 
     * @param {object} [options]
     * @param {(state: FetchState) => void} [options.update]
     * @returns 
     */
    async #loadAsset(assetName, options) {
        if (this.#aborted)
            throw new Error('Aborted');

        if (this.#assetCache[assetName] !== undefined) return this.#assetCache[assetName];

        const assetLocation = this.#assetLocations[assetName];

        if (!assetLocation)
            throw new Error(`Asset location missing: ${assetName}`);

        const { promise, resolve, reject } = PromiseWithResolvers();

        this.#assetCache[assetName] = promise;

        const cache = await this.#cache;

        /** @type {Parameters<typeof fetch>[1]} */
        const fetchOptions = { 'redirect': 'follow', cache: cache ? 'no-store' : 'force-cache', signal: this.#abortController?.signal };

        /** @type {FetchState} */
        const fetchState = {
            name: assetName,
            location: `${assetLocation}`,
            totalBytes: NaN,
            receivedBytes: 0,
            done: false,
            aborted: false,
        };

        if (DEBUG_FETCH) fetchOptions['cache'] = 'reload';

        try {
            const fetchedHeaders = /^https?:\/\//.test(assetLocation)
                ? (await fetch(assetLocation, { 'method': 'HEAD', ...fetchOptions })).headers
                : null;

            const cachedResponse = await cache?.match?.(assetLocation) ?? null;
            const cachedHeaders = cachedResponse?.headers ?? null;

            if (!(fetchOptions.cache === 'reload') && cachedResponse) {
                const contentLength = cachedResponse.headers.get('content-length');

                fetchState.receivedBytes = fetchState.totalBytes = contentLength ? parseInt(contentLength) : NaN;
                fetchState.done = true;

                options?.update?.(fetchState);

                resolve(await cachedResponse.arrayBuffer());

                return this.#assetCache[assetName];
            }

            const fetchedResponse = /^https?:\/\//.test(assetLocation)
                ? await fetch(assetLocation, { 'method': 'GET', ...fetchOptions })
                : null;

            if (fetchedResponse) {
                const contentLength = fetchedResponse.headers.get('content-length');

                if (contentLength) {
                    fetchState.totalBytes = parseInt(contentLength, 10);

                    (async () => {
                        const clonedResponse = fetchedResponse.clone();
                        const reader = clonedResponse.body?.getReader?.();

                        if (!reader)
                            throw new Error('Failed to read response body');

                        let lastProgress = 0;

                        while (!fetchState.done) {
                            const { done, value } = await reader.read();

                            fetchState.receivedBytes += value?.length ?? 0;
                            fetchState.done = done;

                            options?.update?.(fetchState);

                            if (lastProgress < (lastProgress = Math.floor(fetchState.receivedBytes / fetchState.totalBytes * 100)))
                                console.log(fetchState);
                        }

                    })();
                }

                cache?.put?.(assetLocation, fetchedResponse.clone());

                resolve(await fetchedResponse.arrayBuffer());

                return this.#assetCache[assetName];
            }

        } catch (error) {
            reject(error);
        };

        return this.#assetCache[assetName];
    }
}

globalThis?.document?.addEventListener('DOMContentLoaded', async () => {

    /** @type {HTMLFormElement?} */
    const formElement = document.querySelector('form[id^="test-form-"]');
    const formId = formElement?.id;

    if (!formId) {
        console.warn('TestFormGenerator: No form found with id starting with "test-form-"');
        return;
    }

    if (formId === 'test-form-generator-form') {
        const testFormGenerator = new TestFormGenerator({
            userMode: 'expert',
            colorConversionStage: true,
        });
        const testFormGeneratorState = await testFormGenerator.execute(formElement);
        console.log('TestFormGenerator state:', testFormGeneratorState);
        return;
    }

    if (formId === 'test-form-embed-output-intent-only-form') {
        const testFormGenerator = new TestFormGenerator({
            overviewStage: false, // Skip the overview stage
            downloadStage: false, // Skip the download stage
            conversionStage: false, // Skip the conversion stage
            documentationStage: false, // Skip the documentation stage
            disableManifest: true, // Disable manifest generation for this form
        });
        const testFormGeneratorState = await testFormGenerator.execute(formElement);
        console.log('TestFormGenerator state:', testFormGeneratorState);
        return;
    }

    if (formId === 'test-form-convert-color-only-form') {
        const testFormGenerator = new TestFormGenerator({
            overviewStage: false, // Skip the overview stage
            downloadStage: false, // Skip the download stage
            conversionStage: false, // Skip the conversion stage
            validationStage: true, // Enable the validation stage
            // convertColorStage: true, // Enable the color conversion stage
            documentationStage: false, // Skip the documentation stage
            generationStage: true, // Skip the generation stage

            disableManifest: true, // Disable manifest generation for this form
            disableDownload: true,
            userMode: 'expert',
            disableProfileCountCheck: true,
        });
        const testFormGeneratorState = await testFormGenerator.execute(formElement);
        console.log('TestFormGenerator state:', testFormGeneratorState);
        return;
    }

    throw new Error(`TestFormGenerator: Unsupported form id "${formId}". Expected "test-form-generator-form".`);
});
