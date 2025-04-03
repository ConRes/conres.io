// @ts-check
/// <reference lib="ESNext" />
/// <reference types="emscripten" />

import {
    PDFDict,
    PDFDocument,
    PDFRawStream,
    asPDFName,
    PDFContext,
    PDFObject,
    PDFArray,
    PDFName,
    PDFString,
    decodePDFRawStream,
    PDFRef,
} from "pdf-lib";
// } from "./packages/pdf-lib/pdf-lib.esm.js";

import { parse as parseICCHeaderFromBuffer } from "icc";
import {
    Buffer,
    lookupPDFDocumentAttachementByName,
    dumpPDFDocument,
    downloadArrayBufferAs,
    prepareInputResources,
    // prepareOutputResources,
    mkdirRecursiveWithFS,
    base64FromUint8Array,
} from "./helpers.js";

import GhostscriptModule from "./packages/ghostscript-wasm/gs.js";

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

    // /** 
    //  * @type {Record<string, ArrayBuffer?>} 
    //  */
    #resources = {
        'Slug Template.ps': /** @type {ArrayBuffer?} */ (null),
        'Barcode.ps': /** @type {ArrayBuffer?} */ (null),
        'Output.icc': /** @type {ArrayBuffer?} */ (null),
    };

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
        // for (const section of Object.values(state.sections))
        //     section.setAttribute('disabled', '');

        state.stage = 'ready';

        yield state;
        yield* this.#overviewStage(state);
        yield* this.#downloadStage(state);
        yield* this.#conversionStage(state);
        yield* this.#validationStage(state);
        yield* this.#documentationStage(state);
        yield* this.#generationStage(state);
        // yield* this.#exportingStep(state);
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
            const { promise, resolve, reject } = Promise.withResolvers();
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
            const { promise, resolve, reject } = Promise.withResolvers();
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
            const { promise, resolve, reject } = Promise.withResolvers();

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

                    const pdfDocument = await PDFDocument.load(downloadedTestFormArrayBuffer);

                    pdfDocument.attach(
                        downloadedTestFormManifestArrayBuffer,
                        'test-form.manifest.json',
                        { 'mimeType': 'application/json' }
                    );

                    const modifiedTestFormArrayBuffer = (await pdfDocument.save()).buffer;

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
            const { promise, resolve, reject } = Promise.withResolvers();

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

                state.resources = {};

                try {

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

                    console.log(dumpPDFDocument(pdfDocument));

                    const enumeratedIndirectObjects = /** @type {[PDFRef, PDFObject | PDFArray | PDFRawStream | PDFDict | PDFContext][]} */ (pdfDocument.context.enumerateIndirectObjects());

                    const attachedManifestRecord = lookupPDFDocumentAttachementByName(pdfDocument, 'test-form.manifest.json');

                    const attachedManifestBuffer = attachedManifestRecord?.contents?.buffer;
                    const attachedManifest = attachedManifestBuffer && JSON.parse(new TextDecoder().decode(attachedManifestRecord.contents));

                    if (!attachedManifest) throw new Error('The PDF does not have a valid manifest attached.');

                    // @ts-ignore
                    const iccBasedIndirectObjects = enumeratedIndirectObjects.filter(([ref, object]) => object.asArray?.()?.[0]?.asString?.() === '/ICCBased');
                    // @ts-ignore
                    const iccBasedObjectReferences = new Set(iccBasedIndirectObjects.map(([ref, object]) => object?.asArray?.()?.[1]).filter(Boolean));

                    const iccBasedRawStreams = /** @type {(PDFRawStream | undefined)[]} */ ([...iccBasedObjectReferences].map(ref => pdfDocument.context.lookupMaybe(ref, /** @type {*} */(PDFRawStream))));

                    /** @type {Map<PDFRef, { stream: PDFRawStream, buffer: Buffer, header: ReturnType<import('icc')['parse']> }>} */
                    const iccProfilesMap = new Map();

                    for (const reference of iccBasedObjectReferences) {
                        const stream = /** @type {PDFRawStream | undefined} */ (pdfDocument.context.lookupMaybe(reference, /** @type {*} */(PDFRawStream)));

                        if (!stream) continue;

                        const buffer = /** @type {Buffer} */(Buffer.from(decodePDFRawStream(stream).decode()));

                        const header = parseICCHeaderFromBuffer(/** @type {*} */(buffer));

                        iccProfilesMap.set(reference, { header, buffer, stream });
                    }

                    const iccProfilesSet = new Set(iccProfilesMap.values());

                    if (iccProfilesSet.size !== 1)
                        throw new Error(`The PDF contains ${iccProfilesSet.size} ICC profiles. The PDF must contain exactly one ICC profile.`);

                    const [outputIccProfile] = iccProfilesSet;

                    // outputIccProfile.

                    // const outputICCProfile = iccProfiles.get(iccBasedObjectReferences.values().next().value);

                    console.log({
                        pdfDocument,
                        attachedManifestRecord, attachedManifest,
                        enumeratedIndirectObjects,
                        iccBasedIndirectObjects, iccBasedObjectReferences, iccBasedRawStreams, iccProfiles: iccProfilesMap,
                    });


                    state.resources = {
                        'Test Form.pdf': pdfDocumentBuffer.slice(),
                        'Slugs.json': attachedManifestBuffer.slice(
                            attachedManifestRecord.contents.byteOffset,
                            attachedManifestRecord.contents.byteOffset + attachedManifestRecord.contents.byteLength,
                        ),
                        'input/Output.icc': outputIccProfile.buffer.buffer.slice(),
                    };

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

                // this.#resources

                return;
            };

            await promise;

            validationButton.onclick = null;

        }
        // fieldset.focus();
        // yield state;
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
            const { promise, resolve, reject } = Promise.withResolvers();

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

            const { promise, resolve, reject } = Promise.withResolvers();

            generateTestFormButton.onclick = async () => {

                try {
                    state.resources = {
                        ...state.resources,
                        'Slug Template.ps': await this.#loadAsset('2025-03-22 - ISO PTF 2x-4x/Slug Template.ps'),
                        'input/Barcode.ps': await this.#loadAsset('2025-03-22 - ISO PTF 2x-4x/Barcode.ps'),
                    };

                    console.log({ resources: { ...state.resources } });

                    // ICCProfile:
                    const iccProfileHeader = parseICCHeaderFromBuffer(/** @type {*} */(
                        // Buffer.from(/** @type {*} */(state.resources['input/Output.icc']))
                        new Buffer(/** @type {ArrayBuffer} */(state.resources['input/Output.icc']))
                    ));

                    if (iccProfileHeader.colorSpace !== 'RGB' && iccProfileHeader.colorSpace !== 'CMYK')
                        throw new Error(`The ICC profile must be RGB or CMYK. The ICC profile is ${iccProfileHeader.colorSpace}.`);

                    // /** @type {{default: import("./assets/2025-03-22 - 01 - AI-PDF - No 2x-4x (D) - Template.pdf.json")}} */
                    // const { default: testFormDefinitions } = await import(`${assetURLs["TestFormTemplate.pdf"]}.json`, { with: { type: "json" } });

                    const attachedManifestBuffer = state.resources['Slugs.json'];

                    if (!attachedManifestBuffer) throw new Error('Missing Slugs.json');

                    const attachedManifestSourceText = new TextDecoder().decode(new Uint8Array(attachedManifestBuffer));

                    console.log({ attachedManifestSourceText });

                    /** @type {import("../../../../assets/testforms/2025-03-22 - ISO PTF 2x-4x.pdf.json")} */
                    const attachedManifest = attachedManifestBuffer && JSON.parse(attachedManifestSourceText);

                    const slugTemplateSourceBuffer = state.resources['Slug Template.ps'];

                    if (!slugTemplateSourceBuffer) throw new Error('Missing Slug Template.ps');

                    const slugTemplateSourceText = new TextDecoder().decode(new Uint8Array(slugTemplateSourceBuffer));
                    let slugSourceText = slugTemplateSourceText;

                    slugSourceText = /^(?<indent>[ \t]*)%\|[ \t]+\{\{Slugs\}\}.*?$/m[
                        Symbol.replace
                    ](
                        slugSourceText,
                        attachedManifest.pages
                            .map(
                                ({
                                    metadata: {
                                        title,
                                        variant,
                                        colorSpace,
                                        resolution: { value, unit } = {},
                                    },
                                }) =>
                                    [
                                        "$<indent><<",
                                        title && `$<indent>  /Title (${title})`,
                                        variant && `$<indent>  /Variant (${variant})`,
                                        (colorSpace || value) &&
                                        `$<indent>  /Parameters (${[
                                            colorSpace,
                                            `${value || ""}${unit || ""}`,
                                        ]
                                            .filter(Boolean)
                                            .join(" - ")})`,
                                        "$<indent>>>",
                                    ]
                                        .filter(Boolean)
                                        .join("\n")
                            )
                            .join("\n")
                    );

                    slugSourceText = /^(?<indent>[ \t]*)%\|[ \t]+\{\{Slug\}\}.*?$/m[Symbol.replace](
                        slugSourceText,
                        [
                            `$<indent>/SlugHeader (Slug CR 20250322) def`,
                            `$<indent>/SlugFooter (${[
                                state.metadata?.slugs?.email ?? "user@example.com",
                                /^(?<YYYY>\d{4})-(?<MM>\d{2})-(?<DD>\d{2})T(?<hh>\d{2}):(?<mm>\d{2}):(?<ss>\d{2})\.\d+Z$/[
                                    Symbol.replace
                                ](new Date().toISOString(), "$<YYYY>-$<MM>-$<DD> $<hh>:$<mm>:$<ss>"),
                            ]
                                .filter(Boolean)
                                .join(" ")}) def`,
                        ].join("\n")
                    );

                    slugSourceText = slugSourceText.replace(
                        "(Barcode.ps)",
                        "(/input/Barcode.ps)"
                    );

                    // console.log(slugSourceText);

                    state.resources['input/Slug.ps'] = new TextEncoder().encode(slugSourceText).buffer;

                    console.log({ resources: { ...state.resources } });

                    // const buffer = /** @type {Buffer} */(Buffer.from(decodePDFRawStream(stream).decode()));

                    /** @type {Record<string, import('./helpers.js').InputResource>} */
                    const inputResources = {};

                    // const assetPathnames = {
                    //     'Barcode.ps', 
                    //     'inputSlug.ps': '/input/Slug.ps',
                    //     'input/Output.icc': '/input/Output.icc',
                    // };

                    for (const asset of ['Barcode.ps', 'Slug.ps', 'Output.icc']) {
                        const pathname = `/input/${asset}`;
                        const buffer = state.resources[`input/${asset}`];

                        if (!buffer) throw new Error(`Missing resource: input/${asset}`);

                        inputResources[`input/${asset}`] = {
                            pathname,
                            data: new Uint8Array(buffer),
                        };
                    }

                    const pendingPromises = [];

                    /** @type {Promise<EmscriptenModule & { FS: typeof FS; callMain: (argv: string[]) => number}>} */
                    const ghostscriptModulePromise = GhostscriptModule({ noInitialRun: true });

                    pendingPromises.push(ghostscriptModulePromise);

                    const ghostscriptModule = await ghostscriptModulePromise;

                    pendingPromises.push(prepareInputResources(ghostscriptModule.FS, inputResources));

                    await Promise.allSettled(pendingPromises.splice(0, pendingPromises.length));

                    mkdirRecursiveWithFS(ghostscriptModule.FS, `/output/`);

                    const exitCode = await ghostscriptModule.callMain([
                        "-dBATCH",
                        "-dNOPAUSE",
                        "-dNOSAFER",
                        "-sDEVICE=pdfwrite",
                        "-sOutputFile=/output/Slugs.pdf",
                        "-sOutputICCProfile=/input/Output.icc",
                        // "-sPostRenderProfile=/input/Output.icc",
                        // "-sBlendColorProfile=/input/Output.icc",
                        // "-sProofProfile=Output.icc",
                        // "-sICCProfilesDir=/input/",
                        // "-dUseCIEColor",
                        // "-sProofProfile=/input/Output.icc",
                        // ...iccProfileHeader.colorSpace === 'RGB'
                        //     ? "-sProcessColorModel=DeviceRGB -sColorConversionStrategy=RGB -dRenderIntent=1 -dBlackPtComp=1 -dKPreserve=2".split(' ')
                        //     : "-sProcessColorModel=DeviceCMYK -sColorConversionStrategy=CMYK -dRenderIntent=1 -dBlackPtComp=1 -dKPreserve=2".split(' '),
                        ...iccProfileHeader.colorSpace === 'RGB'
                            ? "-sProcessColorModel=DeviceRGB -sPDFACompatibilityPolicy=1 -dRenderIntent=1 -dBlackPtComp=1 -dKPreserve=2".split(' ')
                            : "-sProcessColorModel=DeviceCMYK -sPDFACompatibilityPolicy=1 -dRenderIntent=1 -dBlackPtComp=1 -dKPreserve=2".split(' '),
                        // "-I/input",
                        "/input/Slug.ps",
                    ]);

                    if (exitCode !== 0) {
                        throw new Error(`Ghostscript failed with exit code ${exitCode}`);
                    }

                    const slugsOutputBuffer = ghostscriptModule.FS.readFile("/output/Slugs.pdf").buffer.slice();

                    state.resources['output/Slugs.pdf'] = slugsOutputBuffer;

                    // downloadArrayBufferAs(slugsOutputBuffer, "Slugs.pdf", "application/pdf");

                    console.log({ resources: { ...state.resources } });

                    if (!state.resources['Test Form.pdf'])
                        throw new Error('Missing Test Form Template.pdf');
                    if (!state.resources['output/Slugs.pdf'])
                        throw new Error('Missing Slugs.pdf');

                    const testFormDocument = await PDFDocument.load(new Uint8Array(
                        state.resources['Test Form.pdf'].slice()
                    ));
                    const slugPDFDocument = await PDFDocument.load(new Uint8Array(state.resources['output/Slugs.pdf']));

                    console.log({ testFormDocument, slugPDFDocument });

                    for (let page = 0, pageCount = testFormDocument.getPageCount(); page < pageCount; page++) {
                        const testFormPage = testFormDocument.getPage(page);
                        const [embeddedSlugPage] = await testFormDocument.embedPdf(slugPDFDocument, [page]);

                        testFormPage.drawPage(embeddedSlugPage);
                    }

                    state.resources['output/Test Form.pdf'] = (await testFormDocument.save()).buffer.slice();

                    // await downloadArrayBufferAs(state.resources['output/Test Form.pdf'], "Test Form.pdf", "application/pdf");

                    const iccProfileString = new TextDecoder().decode(new Uint8Array(state.resources['input/Output.icc']));

                    console.log({ iccProfileString });

                    const iccProfileCharacters = Array.from(new Uint8Array(state.resources['input/Output.icc']), c => String.fromCharCode(c));

                    console.log({ iccProfileCharacters });

                    const iccProfileBase64String = btoa(iccProfileCharacters.join(''));

                    console.log({ iccProfileBase64String });

                    state.resources['output/metadata.json'] = new TextEncoder().encode(JSON.stringify({
                        metadata: state.metadata,
                        manifest: attachedManifest,
                        slugs: {
                            // contents: btoa(Array.from(new Uint8Array(state.resources['output/Slugs.pdf']), c => String.fromCharCode(c)).join('')),
                            contents: {
                                type: 'application/pdf',
                                base64: base64FromUint8Array(new Uint8Array(state.resources['output/Slugs.pdf'])),
                            },
                        },
                        color: {
                            profile: {
                                ...iccProfileHeader,
                                // contents: iccProfileBase64String,
                                contents: {
                                    type: 'application/vnd.iccprofile',
                                    base64: base64FromUint8Array(new Uint8Array(state.resources['input/Output.icc'])),
                                }
                            }
                        },
                    }, null, 2)).buffer;

                    await downloadArrayBufferAs(state.resources['output/metadata.json'], "metadata.json", "application/json");
                    await new Promise(resolve => requestAnimationFrame(resolve));
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    await downloadArrayBufferAs(state.resources['output/Test Form.pdf'], "Test Form.pdf", "application/pdf");

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
        // fieldset.focus();
        // yield state;
        fieldset.setAttribute('disabled', '');
    }

    /**
     * @param {TestFormGeneratorState} state 
     */
    async * #exportingStep(state) {
        state.stage = 'exporting';

        /** @type {HTMLFieldSetElement} */
        const fieldset = state.fieldsets['exporting-fieldset'];

        yield state;

        if (!fieldset) throw new Error('Export fieldset missing');

        fieldset.removeAttribute('disabled');
        (fieldset.parentElement ?? fieldset).scrollIntoView({ behavior: 'smooth', 'block': 'center', 'inline': 'nearest' });
        await new Promise(resolve => requestAnimationFrame(resolve));
        if (DEBUG_FIELDSETS) await new Promise(resolve => setTimeout(resolve, 1000));
        // fieldset.focus();
        // yield state;
        fieldset.setAttribute('disabled', '');
    }

    async #downloadArrayBufferAs(arrayBuffer, filename, type = 'application/octet-stream') {
        const blob = new Blob([arrayBuffer], { type });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.download = filename;
        a.href = url;
        a.click();
        URL.revokeObjectURL(url);
    }

    /**
     * 
     * @param {*} assetName 
     * @param {object} [options]
     * @param {(fetchState: FetchState) => void} [options.update]
     * @returns 
     */
    async #loadAsset(assetName, options) {
        if (this.#aborted) throw new Error('Aborted');

        // debugger;

        if (this.#assetCache[assetName] !== undefined) return this.#assetCache[assetName];

        const assetLocation = this.#assetLocations[assetName];

        if (!assetLocation) throw new Error(`Asset location missing: ${assetName}`);

        const { promise, resolve, reject } = Promise.withResolvers();

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

        console.log({ assetName, assetLocation, promise, fetchOptions });

        try {
            const fetchedHeaders = /^https?:\/\//.test(assetLocation)
                ? (await fetch(assetLocation, { 'method': 'HEAD', ...fetchOptions })).headers
                : null;

            const cachedResponse = await cache?.match?.(assetLocation) ?? null;
            const cachedHeaders = cachedResponse?.headers ?? null;

            if (!(fetchOptions.cache === 'reload') && cachedResponse) {
                console.log({ assetName, assetLocation, fetchedHeaders, cachedHeaders, cachedResponse });

                const contentLength = cachedResponse.headers.get('content-length');

                fetchState.receivedBytes = fetchState.totalBytes = parseInt(contentLength);
                fetchState.done = true;

                options?.update?.(fetchState);

                resolve(await cachedResponse.arrayBuffer());

                return this.#assetCache[assetName];
            } else {
                console.log({ assetName, assetLocation, fetchedHeaders, cachedHeaders, cachedResponse });
            }

            const fetchedResponse = /^https?:\/\//.test(assetLocation)
                ? await fetch(assetLocation, { 'method': 'GET', ...fetchOptions })
                : null;

            if (fetchedResponse) {
                const contentLength = fetchedResponse.headers.get('content-length');

                console.log(fetchState);

                if (contentLength) {
                    fetchState.totalBytes = parseInt(contentLength, 10);

                    (async () => {
                        const clonedResponse = fetchedResponse.clone();
                        const reader = clonedResponse.body.getReader();
                        // let chunks = [];
                        let lastProgress = 0;
                        while (!fetchState.done) {
                            const { done, value } = await reader.read();

                            fetchState.receivedBytes += value?.length ?? 0;
                            fetchState.done = done;
                            // fetchState.progress = fetchState.receivedBytes / fetchState.totalBytes;

                            options?.update?.(fetchState);

                            if (lastProgress < (lastProgress = Math.floor(fetchState.receivedBytes / fetchState.totalBytes * 100)))
                                console.log(fetchState);
                        }

                    })();
                }
                console.log({ assetName, assetLocation, fetchedHeaders, cachedHeaders, cachedResponse, fetchedResponse });

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

    const testFormGeneratorState = await testFormGenerator.execute(document.querySelector('form#test-form-generator-form'));

});


// <article id="color-conversion">
// <article id="documentation">
// <article id="download">
// <article id="exporting">
// <article id="generation">
// <article id="generator" style="text-align: center;">
// <article id="requirements">
// <article id="validation">
// <button id="export-test-form-button" class="full-row">Export Test Form</button>
// <button id="export-test-form-information-button">Export Test Form Information</button>
// <button id="test-form-documentation-button">Generate</button>
// <button id="test-form-documentation-reset-button">Reset</button>
// <button id="test-form-documentation-save-button">Save</button>
// <button id="test-form-download-button">Download</button>
// <button id="test-form-validation-button">Validate</button>
// <fieldset id=" generation-progess-fieldset" style="opacity:0;" class="full-row">
// <fieldset id="documentation-fieldset">
// <fieldset id="download-fieldset">
// <fieldset id="download-progress-fieldset" style="opacity:0;" class="full-row">
// <fieldset id="exporting-fieldset">
// <fieldset id="generation-fieldset">
// <fieldset id="validation-fieldset">
// <fieldset id="valudation-progress-fieldset" style="opacity:0;" class="full-row">
// <form id="test-form-generator-form" onsubmit="return false;">
// <input type="file" id="prepared-test-form-file-input" class="full-row"
// <input type="text" id="colorants-input" name="units-system" />
// <input type="text" id="email-input" name="substrate" placeholder="" />
// <input type="text" id="printing-system-input" name="printing-system"
// <input type="text" id="substrate-input" name="substrate" />
// <output id="test-form-download-progress-output">0%</output>
// <output id="test-form-generation-progress-output">0%</output>
// <output id="test-form-validation-progress-output">0%</output>
// <progress id="test-form-download-progress" value="0" max="100"></progress>
// <progress id="test-form-generation-progress" max="100"></progress>
// <progress id="test-form-validation-progress" value="0" max="100"></progress>
// <section id="overview">
// <section id="preparation">
// <section id="serialization">
// <select id="test-form-version-select" name="test-form-version">