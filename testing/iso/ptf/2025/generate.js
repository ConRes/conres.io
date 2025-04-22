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

const assetLocations = {
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

    '2025-04-25 - ISO PTF 2x-4x/Test Form Template.pdf': /^https?:\/\/(?:www\.)?(?:conres\.io)\//.test(globalThis.location?.href ?? '')
        ? 'https://media.githubusercontent.com/media/ConRes/conres.io/refs/heads/master/assets/testforms/2025-04-25 - ISO PTF 2x-4x.pdf'
        : new URL('../../../../assets/testforms/2025-04-25 - ISO PTF 2x-4x.pdf', import.meta.url).href,
    '2025-04-25 - ISO PTF 2x-4x/Barcode.ps': new URL('../../../../assets/testforms/2025-04-25 - ISO PTF 2x-4x/Barcode.ps', import.meta.url).href,
    '2025-04-25 - ISO PTF 2x-4x/Slug Template.ps': new URL('../../../../assets/testforms/2025-04-25 - ISO PTF 2x-4x/Slug Template.ps', import.meta.url).href,
    '2025-04-25 - ISO PTF 2x-4x/Slugs.json': new URL('../../../../assets/testforms/2025-04-25 - ISO PTF 2x-4x/Slugs.json', import.meta.url).href,
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
 * @typedef {'ready'|'overview'|'download' | 'conversion' | 'validation' | 'documentation' | 'generation' | 'exporting' | 'done' | 'aborted'} TestFormGeneratorStage
 */

/**
 * @typedef {object} TestFormGeneratorState
 * @property {TestFormGeneratorStage} [stage]
 * @property {boolean} [aborted]
 * @property {HTMLFormElement} form
 * @property {Partial<Record<TestFormGeneratorStage, HTMLDivElement>>} sections
 * @property {Partial<Record<TestFormGeneratorStage, HTMLFieldSetElement>>} fieldsets
 * @property {Record<string, ArrayBufferLike?>} resources
 * @property {object} [metadata]
 */

class TestFormGenerator {

    /** @type {AbortController?} */
    #abortController = new AbortController();

    #aborted = false;

    #assetLocations = { ...assetLocations };

    /** @type {Record<string, Promise<ArrayBuffer>>} */
    #assetCache = {};

    #cache;

    constructor() {
        this.#abortController?.signal.addEventListener('abort', event => {
            this.#aborted = true;
            this.#abortController = null;
        }, { 'once': true });

        this.#cache = globalThis.caches?.open?.('conres-testforms');
    }

    /**
     * @param {HTMLFormElement} form
     */
    async execute(form) {
        const fieldsets = {};
        const sections = {};

        for (const fieldset of form.querySelectorAll('fieldset')) {
            fieldsets[fieldset.name] = fieldset;
        }

        for (const section of form.querySelectorAll('article, section')) {
            sections[section.id] = section;
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

        yield state;
        yield* this.#overviewStage(state);
        yield* this.#downloadStage(state);
        yield* this.#conversionStage(state);
        yield* this.#validationStage(state);
        yield* this.#documentationStage(state);
        yield* this.#generationStage(state);
        state.stage = 'done';
        yield state;
    }

    /**
     * @param {TestFormGeneratorState} state 
     */
    async * #overviewStage(state) {
        state.stage = 'overview';

        /** @type {HTMLFieldSetElement} */
        const fieldset = state.fieldsets['overview-fieldset'];

        yield state;

        if (!fieldset) throw new Error('Export fieldset missing');

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
    }

    /**
     * @param {TestFormGeneratorState} state 
     */
    async * #conversionStage(state) {
        state.stage = 'conversion';

        /** @type {HTMLFieldSetElement} */
        const fieldset = state.fieldsets['conversion-fieldset'];

        yield state;

        if (!fieldset) throw new Error('Export fieldset missing');

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
    }

    /**
     * @param {TestFormGeneratorState} state 
     */
    async * #downloadStage(state) {
        state.stage = 'download';

        /** @type {HTMLFieldSetElement} */
        const fieldset = state.fieldsets['download-fieldset'];

        yield state;

        if (!fieldset) throw new Error('Download fieldset missing');

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

                    let nextFrame;

                    const downloadedTestFormArrayBuffer = await this.#loadAsset(`${testFormName}/Test Form Template.pdf`, {
                        /**
                         * @param {FetchState} fetchState 
                         */
                        async update(fetchState) {
                            if (nextFrame) cancelAnimationFrame(nextFrame);
                            nextFrame = null;
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
                    await PDFService.attachManifestToPDF(pdfDocument, downloadedTestFormManifestArrayBuffer, 'test-form.manifest.json');

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

        /** @type {HTMLFieldSetElement} */
        const fieldset = state.fieldsets['validation-fieldset'];

        yield state;

        if (!fieldset) throw new Error('Validation fieldset missing');

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

            validationButton.onclick = async () => {
                validationProgressFieldset.style.opacity = "";
                validationProgress.removeAttribute('value');
                validationProgress.removeAttribute('max');
                validationProgressOutput.value = `Validating…`;

                try {
                    const resources = {};
                    state.resources = resources;
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

                    const manifestResult = PDFService.extractManifestFromPDF(pdfDocument);
                    if (!manifestResult) {
                        throw new Error('The PDF does not have a valid manifest attached.');
                    }

                    const iccProfilesMap = PDFService.extractICCProfilesFromPDF(pdfDocument);
                    const iccProfilesSet = new Set(iccProfilesMap.values());

                    if (iccProfilesSet.size !== 1)
                        throw new Error(`The PDF must contain exactly one ICC profile. Found ${iccProfilesSet.size} ICC profiles.`);

                    const iccProfile = [...iccProfilesSet][0];

                    resources['Test Form.pdf'] = pdfDocumentBuffer.slice();
                    resources['Slugs.json'] = manifestResult.buffer;
                    resources['input/Output.icc'] = iccProfile.buffer.buffer.slice();

                } catch (error) {
                    console.error('TestFormGenerator %o', error, { ...state });
                    validationProgressOutput.value = `Validation failed: ${error.message}`;
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

        /** @type {HTMLFieldSetElement} */
        const fieldset = state.fieldsets['documentation-fieldset'];

        yield state;

        if (!fieldset) throw new Error('Documentation fieldset missing');

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

        /** @type {HTMLFieldSetElement} */
        const fieldset = state.fieldsets['generation-fieldset'];

        yield state;

        if (!fieldset) throw new Error('Generation fieldset missing');

        fieldset.removeAttribute('disabled');
        (fieldset.parentElement ?? fieldset).scrollIntoView({ behavior: 'smooth', 'block': 'center', 'inline': 'nearest' });
        await new Promise(resolve => requestAnimationFrame(resolve));

        if (DEBUG_FIELDSETS) {
            await new Promise(resolve => setTimeout(resolve, 1000));
        } else {
            const generateTestFormButton = /** @type {HTMLButtonElement} */(state.form.elements.namedItem('test-form-generation-button'));
            const generateTestFormDebuggingCheckbox = /** @type {HTMLInputElement} */(state.form.elements.namedItem('test-form-generation-debugging-checkbox'));
            const { promise, resolve, reject } = PromiseWithResolvers();

            generateTestFormButton.onclick = async () => {
                try {
                    const resources = {
                        ...state.resources,
                        ...{
                            'Slug Template.ps': await this.#loadAsset('2025-03-22 - ISO PTF 2x-4x/Slug Template.ps'),
                            'input/Barcode.ps': await this.#loadAsset('2025-03-22 - ISO PTF 2x-4x/Barcode.ps'),
                        },
                    };
                    state.resources = resources;

                    // const iccValidation = ICCService.validateICCColorSpace(resources['input/Output.icc']);

                    const iccProfileHeader = ICCService.parseICCHeaderFromSource(resources['input/Output.icc']);

                    if (iccProfileHeader.colorSpace !== 'RGB' && iccProfileHeader.colorSpace !== 'CMYK')
                        throw new Error(`The ICC profile must be RGB or CMYK. The ICC profile is ${iccProfileHeader.colorSpace}.`);

                    const slugTemplateSourceBuffer = resources['Slug Template.ps'];
                    if (!slugTemplateSourceBuffer) throw new Error('Missing Slug Template.ps');

                    const slugTemplateSourceText = new TextDecoder().decode(new Uint8Array(slugTemplateSourceBuffer));
                    const attachedManifestBuffer = resources['Slugs.json'];

                    if (!attachedManifestBuffer) throw new Error('Missing Slugs.json');

                    const attachedManifestSourceText = new TextDecoder().decode(new Uint8Array(attachedManifestBuffer));
                    const attachedManifest = JSON.parse(attachedManifestSourceText);

                    const slugSourceText = GhostscriptService.processSlugTemplate(
                        slugTemplateSourceText,
                        attachedManifest,
                        state.metadata
                    );

                    resources['input/Slugs.ps'] = new TextEncoder().encode(slugSourceText).buffer;

                    const slugsOutputBuffer = await GhostscriptService.generateSlugsPDF(
                        resources,
                        iccProfileHeader.colorSpace,
                        generateTestFormDebuggingCheckbox.checked
                    );

                    resources['output/Slugs.pdf'] = slugsOutputBuffer;

                    if (!resources['Test Form.pdf']) throw new Error('Missing Test Form Template.pdf');

                    const testFormDocument = await PDFDocument.load(resources['Test Form.pdf']);
                    const slugsDocument = await PDFDocument.load(resources['output/Slugs.pdf']);

                    await PDFService.embedSlugsIntoPDF(testFormDocument, slugsDocument);

                    const iccProfileBytes = new Uint8Array(resources['input/Output.icc']);

                    const iccProfilesMap = PDFService.extractICCProfilesFromPDF(testFormDocument);
                    const iccProfileReference = [...iccProfilesMap.keys()][0];
                    // const iccProfilesSet = new Set(iccProfilesMap.values());
                    // const iccProfile = [...iccProfilesSet][0];

                    await PDFService.decalibratePDFDocument(testFormDocument);

                    console.time('PDFService.setOutputIntentForPDF');

                    PDFService.setOutputIntentForPDF(testFormDocument, {
                        // iccProfile: iccProfileBytes.slice(),
                        iccProfile: iccProfileReference,
                        identifier: iccProfileHeader.description || `ICCBased_${iccProfileHeader.colorSpace}`,
                        subType: 'GTS_PDFX',
                    });

                    console.timeEnd('PDFService.setOutputIntentForPDF');

                    resources['output/Test Form.pdf'] = (await testFormDocument.save()).buffer;

                    /** @satisfies {Parameters<uint8ArrayToBase64>[1]} */
                    const base64Options = { 'alphabet': 'base64' };

                    const iccProfileBase64 = uint8ArrayToBase64(iccProfileBytes, base64Options);

                    const slugsBytes = new Uint8Array(resources['output/Slugs.pdf']);
                    const slugsBase64 = uint8ArrayToBase64(slugsBytes, base64Options);

                    // const iccProfileHeader = ICCService.parseICCHeader(resources['input/Output.icc']);

                    resources['output/metadata.json'] = new TextEncoder().encode(JSON.stringify({
                        metadata: state.metadata,
                        manifest: attachedManifest,
                        slugs: {
                            contents: {
                                type: 'application/pdf',
                                base64: slugsBase64,
                            },
                        },
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

                    if (isDebugging) {
                        await downloadArrayBufferAs(resources['input/Output.icc'], "Output.icc", "application/vnd.iccprofile");
                        await downloadArrayBufferAs(resources['output/Slugs.pdf'], "Slugs.pdf", "application/pdf");
                    }

                    await downloadArrayBufferAs(resources['output/metadata.json'], "metadata.json", "application/json");
                    await downloadArrayBufferAs(resources['output/Test Form.pdf'], "Test Form.pdf", "application/pdf");

                    resolve(undefined);
                } catch (error) {
                    alert('An error occurred during the generation of the test form. Please try again.');
                    console.error('TestFormGenerator %o', error, { ...state });
                    reject(error);
                }
            };

            await promise;
            generateTestFormButton.onclick = null;
        }

        fieldset.setAttribute('disabled', '');
    }

    async #loadAsset(assetName, options) {
        if (this.#aborted) throw new Error('Aborted');

        if (this.#assetCache[assetName] !== undefined) return this.#assetCache[assetName];

        const assetLocation = this.#assetLocations[assetName];

        if (!assetLocation) throw new Error(`Asset location missing: ${assetName}`);

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

                        if (!reader) throw new Error('Failed to read response body');

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
    const testFormGenerator = new TestFormGenerator();
    const testFormGeneratorState = await testFormGenerator.execute(
        document.querySelector('form#test-form-generator-form')
    );
});
