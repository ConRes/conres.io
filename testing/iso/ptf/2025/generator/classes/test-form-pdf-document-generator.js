// @ts-check
/// <reference lib="ESNext" />
/// <reference types="emscripten" />
/**
 * TestFormPDFDocumentGenerator — Generation logic (no UI coupling).
 *
 * Assembles individualized PDF test forms from an assets PDF and manifest,
 * converting colors to a user-provided ICC output profile using the
 * PDFDocumentColorConverter (baseline classes).
 *
 * @module TestFormPDFDocumentGenerator
 * @author Saleh Abdel Motaal <dev@smotaal.io>
 * @ai Claude Opus 4.6 (code generation)
 */

import { PDFDocument } from 'pdf-lib';

import {
    uint8ArrayToBase64,
    PromiseWithResolvers,
} from '../../helpers.js';

import { PDFService } from '../../services/PDFService.js';
import { ICCService } from '../../services/ICCService.js';
import { GhostscriptService } from '../../services/GhostscriptService.js';
import { ManifestColorSpaceResolver } from './manifest-color-space-resolver.js';
import { AssetPagePreConverter } from './asset-page-pre-converter.js';

// ============================================================================
// Constants
// ============================================================================

const IS_PRODUCTION = /^https?:\/\/(?:www\.)?conres\.io\//.test(globalThis.location?.href ?? '');

/**
 * Supported test form versions and their asset base names.
 * @type {Record<string, { base: string }>}
 */
export const ASSET_VERSIONS = {
    '2026-02-14 - ConRes - ISO PTF - CR1': {
        base: '2026-02-14 - ConRes - ISO PTF - CR1 (F9e) Assets',
    },
};

// ============================================================================
// Types
// ============================================================================

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
 * @typedef {object} TestFormManifest
 * @property {TestFormManifestSettings} settings
 * @property {Record<string, { type: string, profile?: string }>} colorSpaces
 * @property {TestFormManifestAssetEntry[]} assets
 * @property {TestFormManifestLayoutEntry[]} layouts
 * @property {TestFormManifestPageEntry[]} pages
 */

/**
 * @typedef {object} TestFormManifestSettings
 * @property {object} colorManagement
 * @property {string} colorManagement.defaultSourceProfileForDeviceGray
 * @property {string} colorManagement.defaultSourceProfileForDeviceRGB
 * @property {string} colorManagement.defaultSourceProfileForDeviceCMYK
 */

/**
 * @typedef {object} TestFormManifestAssetEntry
 * @property {string} asset
 * @property {string} colorSpace
 */

/**
 * @typedef {object} TestFormManifestLayoutEntry
 * @property {string} layout
 * @property {string} colorSpace
 * @property {TestFormManifestAssetEntry[]} assets
 */

/**
 * @typedef {object} TestFormManifestPageEntry
 * @property {string} [layout]
 * @property {string} [colorSpace]
 * @property {object} [metadata]
 * @property {string} [metadata.title]
 * @property {string} [metadata.variant]
 * @property {string} [metadata.colorSpace]
 * @property {{ values?: number[], value?: number, unit?: string }} [metadata.resolution]
 */

/**
 * @typedef {object} UserMetadata
 * @property {string} device
 * @property {string} colorants
 * @property {string} substrate
 * @property {string} settings
 * @property {string} email
 */

/**
 * @typedef {object} GenerationCallbacks
 * @property {(stage: string, percent: number, message: string) => void | Promise<void>} [onProgress]
 * @property {(state: FetchState) => void} [onDownloadProgress]
 */

/**
 * @typedef {object} GenerationResult
 * @property {ArrayBuffer} pdfBuffer
 * @property {string} metadataJSON
 */

// ============================================================================
// Asset URL Resolution
// ============================================================================

/**
 * Resolves an asset URL for a given base name and optional file name.
 *
 * When `fileName` is `null`, resolves the asset PDF file itself.
 * When `fileName` is a string, resolves a resource within the assets folder.
 *
 * @param {string} baseName - The asset base name (e.g., `2026-02-14 - ConRes - ISO PTF - CR1 (F9e) Assets`)
 * @param {string | null} fileName - File within the assets folder, or `null` for the asset PDF
 * @returns {string} Resolved URL
 */
function resolveAssetURL(baseName, fileName) {
    if (IS_PRODUCTION) {
        const assetPath = `testing/iso/ptf/assets/${baseName}`;
        return fileName
            ? `https://media.githubusercontent.com/media/ConRes/conres.io/refs/heads/master/${assetPath}/${fileName}`
            : `https://media.githubusercontent.com/media/ConRes/conres.io/refs/heads/master/${assetPath}.pdf`;
    }
    const assetPath = `../../../assets/${baseName}`;
    return fileName
        ? new URL(`${assetPath}/${fileName}`, import.meta.url).href
        : new URL(`${assetPath}.pdf`, import.meta.url).href;
}

// ============================================================================
// TestFormPDFDocumentGenerator
// ============================================================================

/**
 * Generates individualized PDF test forms from assets, manifest, and an ICC output profile.
 *
 * Workflow:
 *   1. Load manifest and asset PDF
 *   2. Resolve color space profiles from manifest
 *   3. Pre-convert each asset page to the output color space (with optional intermediate)
 *   4. Assemble pages from pre-converted assets using `embedPdf` + `drawPage`
 *   5. Generate and embed slug pages (QR codes with metadata)
 *   6. Post-process: decalibrate, set blending space, set output intent
 */
export class TestFormPDFDocumentGenerator {

    /** @type {string} */
    #testFormVersion;

    /** @type {string} */
    #assetBase;

    /** @type {boolean} */
    #debugging;

    /** @type {8 | 16 | undefined} */
    #outputBitsPerComponent;

    /** @type {AbortController} */
    #abortController = new AbortController();

    /** @type {Record<string, Promise<ArrayBuffer>>} */
    #assetCache = {};

    /** @type {Promise<Cache | undefined> | undefined} */
    #cache;

    /**
     * @param {object} options
     * @param {string} options.testFormVersion - Key from ASSET_VERSIONS
     * @param {boolean} [options.debugging=false]
     * @param {8 | 16} [options.outputBitsPerComponent] - Coerce output bit depth (undefined = auto)
     */
    constructor({ testFormVersion, debugging = false, outputBitsPerComponent }) {
        const version = ASSET_VERSIONS[testFormVersion];
        if (!version) throw new Error(`Unknown test form version: ${testFormVersion}`);

        this.#testFormVersion = testFormVersion;
        this.#assetBase = version.base;
        this.#debugging = debugging;
        this.#outputBitsPerComponent = outputBitsPerComponent;
        this.#cache = globalThis.caches?.open?.('conres-testforms');
    }

    /**
     * Generates the test form PDF with color conversion and optional slug embedding.
     *
     * @param {ArrayBuffer} iccProfileBuffer - Destination ICC profile bytes
     * @param {UserMetadata | null} userMetadata - Slug metadata (null to skip slugs)
     * @param {GenerationCallbacks} [callbacks={}]
     * @returns {Promise<GenerationResult>}
     */
    async generate(iccProfileBuffer, userMetadata, callbacks = {}) {
        const { onProgress = () => {} } = callbacks;

        // ----------------------------------------------------------------
        // 1. Load manifest
        // ----------------------------------------------------------------
        await onProgress('loading', 0, 'Loading manifest\u2026');
        const manifestBuffer = await this.#loadAsset('manifest.json');
        const manifest = /** @type {TestFormManifest} */ (
            JSON.parse(new TextDecoder().decode(manifestBuffer))
        );

        console.log('Manifest loaded:', {
            assets: manifest.assets.length,
            layouts: manifest.layouts.length,
            pages: manifest.pages.length,
        });

        // ----------------------------------------------------------------
        // 2. Download asset PDF
        // ----------------------------------------------------------------
        await onProgress('downloading', 2, 'Downloading asset PDF\u2026');
        const assetPDFBuffer = await this.#loadAsset(null, {
            update: (state) => {
                callbacks.onDownloadProgress?.(state);
                if (state.totalBytes > 0) {
                    const percent = 2 + Math.floor(state.receivedBytes / state.totalBytes * 28);
                    onProgress('downloading', percent, `Downloading\u2026 ${Math.floor(state.receivedBytes / state.totalBytes * 100)}%`);
                }
            },
        });

        // ----------------------------------------------------------------
        // 3. Parse ICC profile
        // ----------------------------------------------------------------
        await onProgress('preparing', 30, 'Parsing ICC profile\u2026');
        const iccProfileHeader = ICCService.parseICCHeaderFromSource(iccProfileBuffer);

        if (iccProfileHeader.colorSpace !== 'CMYK' && iccProfileHeader.colorSpace !== 'RGB') {
            throw new Error(`Destination profile must be CMYK or RGB. Got: ${iccProfileHeader.colorSpace}`);
        }

        console.log('ICC profile:', {
            colorSpace: iccProfileHeader.colorSpace,
            description: iccProfileHeader.description,
        });

        // ----------------------------------------------------------------
        // 4. Load asset PDF
        // ----------------------------------------------------------------
        await onProgress('assembling', 32, 'Loading asset PDF\u2026');
        const assetDocument = await PDFDocument.load(assetPDFBuffer, { updateMetadata: false });
        const assetPageCount = assetDocument.getPageCount();

        console.log(`Asset PDF loaded: ${assetPageCount} pages (manifest expects ${manifest.assets.length})`);

        if (assetPageCount !== manifest.assets.length) {
            console.warn(
                `Asset page count (${assetPageCount}) does not match manifest assets count (${manifest.assets.length}).`
            );
        }

        // ----------------------------------------------------------------
        // 5. Resolve color space profiles and create pre-converter
        // ----------------------------------------------------------------
        await onProgress('converting', 34, 'Resolving color space profiles\u2026');

        const manifestURL = resolveAssetURL(this.#assetBase, 'manifest.json');
        const colorSpaceResolver = new ManifestColorSpaceResolver(
            manifest.colorSpaces,
            manifestURL,
            this.#cache,
        );

        const preConverter = new AssetPagePreConverter({
            outputProfile: iccProfileBuffer,
            outputColorSpace: iccProfileHeader.colorSpace,
            outputBitsPerComponent: this.#outputBitsPerComponent,
            colorSpaceResolver,
            debugging: this.#debugging,
        });

        // ----------------------------------------------------------------
        // 6. Pre-convert assets and assemble pages
        // ----------------------------------------------------------------
        await onProgress('converting', 36, 'Pre-converting asset pages\u2026');

        console.time('Pre-conversion and assembly');

        try {
            const assembledDocument = await this.#assemblePages(preConverter, assetDocument, manifest, async (percent, message) => {
                await onProgress('converting', 36 + Math.floor(percent * 0.42), message);
            });

            console.timeEnd('Pre-conversion and assembly');
            console.log(`Assembled document: ${assembledDocument.getPageCount()} pages`);

            await onProgress('converting', 78, 'Color conversion complete');

            // ----------------------------------------------------------------
            // 7. Generate and embed slugs
            // ----------------------------------------------------------------
            /** @type {Record<string, ArrayBuffer>} */
            const resources = {};

            if (userMetadata) {
                await onProgress('slugs', 80, 'Loading slug resources\u2026');

                const [slugsTemplateBuffer, barcodeBuffer] = await Promise.all([
                    this.#loadAsset('slugs.ps'),
                    this.#loadAsset('barcode.ps'),
                ]);

                // Normalize page data from manifest for processSlugTemplate
                const normalizedPages = manifest.pages.map((page) => ({
                    metadata: {
                        title: page.metadata?.title ?? page.layout,
                        variant: page.metadata?.variant,
                        colorSpace: page.colorSpace ?? page.metadata?.colorSpace,
                        resolution: page.metadata?.resolution,
                    },
                }));

                // Process slug template
                let slugTemplateText = new TextDecoder().decode(slugsTemplateBuffer);

                // The new slugs.ps references (barcode.ps) in lowercase.
                // GhostscriptService.processSlugTemplate replaces (Barcode.ps) with (/input/Barcode.ps).
                // We handle the lowercase variant here so the VFS path matches.
                slugTemplateText = slugTemplateText.replace('(barcode.ps)', '(/input/Barcode.ps)');

                const slugSourceText = GhostscriptService.processSlugTemplate(
                    slugTemplateText,
                    { pages: normalizedPages },
                    { slugs: userMetadata },
                );

                resources['input/Barcode.ps'] = barcodeBuffer;
                resources['input/Slugs.ps'] = new TextEncoder().encode(slugSourceText).buffer;
                resources['input/Output.icc'] = iccProfileBuffer;

                await onProgress('slugs', 84, 'Rendering slugs PDF\u2026');

                const slugsPDFBuffer = await GhostscriptService.generateSlugsPDF(
                    resources,
                    iccProfileHeader.colorSpace,
                    this.#debugging,
                );

                await onProgress('slugs', 88, 'Embedding slugs\u2026');

                const slugsDocument = await PDFDocument.load(slugsPDFBuffer);
                await PDFService.embedSlugsIntoPDFDocument(assembledDocument, slugsDocument);
            } else {
                console.warn('No user metadata provided. Skipping slug generation.');
            }

            // ----------------------------------------------------------------
            // 8. Post-processing
            // ----------------------------------------------------------------
            await onProgress('finalizing', 90, 'Finalizing PDF\u2026');

            console.time('decalibrateColorInPDFDocument');
            await PDFService.decalibrateColorInPDFDocument(assembledDocument);
            console.timeEnd('decalibrateColorInPDFDocument');

            console.time('replaceTransarencyBlendingSpaceInPDFDocument');
            await PDFService.replaceTransarencyBlendingSpaceInPDFDocument(
                assembledDocument,
                `Device${iccProfileHeader.colorSpace}`,
            );
            console.timeEnd('replaceTransarencyBlendingSpaceInPDFDocument');

            // Always use the user's destination ICC profile for the output intent
            // (not a source profile extracted from the document)
            PDFService.setOutputIntentForPDFDocument(assembledDocument, {
                iccProfile: new Uint8Array(iccProfileBuffer),
                identifier: iccProfileHeader.description || `ICCBased_${iccProfileHeader.colorSpace}`,
                subType: 'GTS_PDFX',
            });

            // Attach manifest to output PDF
            await PDFService.attachManifestToPDFDocument(
                assembledDocument,
                manifestBuffer,
                'test-form.manifest.json',
            );

            // ----------------------------------------------------------------
            // 9. Save and generate metadata JSON
            // ----------------------------------------------------------------
            await onProgress('saving', 95, 'Saving PDF\u2026');

            const pdfBuffer = /** @type {ArrayBuffer} */ (
                (await assembledDocument.save({ addDefaultPage: false, updateFieldAppearances: false })).buffer
            );

            /** @satisfies {Parameters<uint8ArrayToBase64>[1]} */
            const base64Options = { 'alphabet': 'base64' };

            const metadataJSON = JSON.stringify({
                testFormVersion: this.#testFormVersion,
                generatedAt: new Date().toISOString(),
                metadata: userMetadata ? { slugs: userMetadata } : undefined,
                manifest: manifest ?? undefined,
                color: {
                    profile: {
                        ...iccProfileHeader,
                        contents: {
                            type: 'application/vnd.iccprofile',
                            base64: uint8ArrayToBase64(new Uint8Array(iccProfileBuffer), base64Options),
                        },
                    },
                },
            }, null, 2);

            await onProgress('done', 100, 'Generation complete');

            return { pdfBuffer, metadataJSON };
        } finally {
            preConverter.dispose();
        }
    }

    /**
     * Copies, converts, and assembles the output PDF in a single document.
     *
     * 1. Copy all needed asset pages into the assembled document
     * 2. Convert them in-place via `PDFDocumentColorConverter` (one per chain, with `pages` filter)
     * 3. Embed each converted page once via `embedPage`, draw many via `drawPage`
     * 4. Remove the asset pages (they precede the output pages)
     *
     * @param {AssetPagePreConverter} preConverter - Batch pre-converter
     * @param {PDFDocument} assetDocument - The loaded asset PDF
     * @param {TestFormManifest} manifest
     * @param {(percent: number, message: string) => void | Promise<void>} [onProgress] - Progress callback (0-100 within this step)
     * @returns {Promise<PDFDocument>}
     */
    async #assemblePages(preConverter, assetDocument, manifest, onProgress) {
        const assembledDocument = await PDFDocument.create();

        // ------------------------------------------------------------------
        // Phase A: Copy + convert all asset pages into the assembled document
        // ------------------------------------------------------------------
        const pageMapping = await preConverter.convertAll(
            assetDocument,
            manifest,
            assembledDocument,
            async (percent, message) => { await onProgress?.(Math.floor(percent * 0.6), message); },
        );

        const assetPageCount = assembledDocument.getPageCount();

        // ------------------------------------------------------------------
        // Phase B: Build output pages from converted asset pages
        // ------------------------------------------------------------------

        // Asset name → page index in asset PDF
        /** @type {Map<string, number>} */
        const assetNameIndex = new Map();
        for (let i = 0; i < manifest.assets.length; i++) {
            const entry = manifest.assets[i];
            assetNameIndex.set(`${entry.asset}|${entry.colorSpace}`, i);
        }

        // Cache of embedded pages (embed once from same document, draw many)
        // Key: target page index in assembledDocument
        // Value: PDFEmbeddedPage
        /** @type {Map<number, import('pdf-lib').PDFEmbeddedPage>} */
        const embeddedPageCache = new Map();

        /**
         * Gets or creates an embedded page for a converted asset page.
         *
         * @param {number} targetPageIndex - Page index in the assembled document (an asset page)
         * @returns {Promise<import('pdf-lib').PDFEmbeddedPage>}
         */
        const getEmbeddedPage = async (targetPageIndex) => {
            let embedded = embeddedPageCache.get(targetPageIndex);
            if (!embedded) {
                embedded = await assembledDocument.embedPage(
                    assembledDocument.getPage(targetPageIndex),
                );
                embeddedPageCache.set(targetPageIndex, embedded);
            }
            return embedded;
        };

        const totalPages = manifest.pages.length;

        for (let pageNumber = 0; pageNumber < totalPages; pageNumber++) {
            const pageDescriptor = manifest.pages[pageNumber];

            // Normalize: layout and colorSpace may be at top level or inside metadata
            const layoutName = pageDescriptor.layout ?? pageDescriptor.metadata?.title;
            const colorSpace = pageDescriptor.colorSpace ?? pageDescriptor.metadata?.colorSpace;

            if (!layoutName || !colorSpace) {
                throw new Error(
                    `Page descriptor missing layout or colorSpace: ${JSON.stringify(pageDescriptor)}`
                );
            }

            // Find matching layout definition (colorSpace compared case-insensitively)
            const layout = manifest.layouts.find(
                (layoutEntry) => layoutEntry.layout === layoutName && layoutEntry.colorSpace.toLowerCase() === colorSpace.toLowerCase()
            );

            if (!layout) {
                throw new Error(
                    `No layout found for "${layoutName}" (${colorSpace}). ` +
                    `Available layouts: ${manifest.layouts.map((layoutEntry) => `${layoutEntry.layout} (${layoutEntry.colorSpace})`).join(', ')}`
                );
            }

            // Resolve asset references to embedded pages
            /** @type {import('pdf-lib').PDFEmbeddedPage[]} */
            const embeddedPages = [];

            for (const assetRef of layout.assets) {
                const nameKey = `${assetRef.asset}|${assetRef.colorSpace}`;
                const assetPageIndex = assetNameIndex.get(nameKey);

                if (assetPageIndex === undefined) {
                    throw new Error(
                        `Asset not found in manifest: "${assetRef.asset}" (${assetRef.colorSpace})`
                    );
                }

                // Look up the converted page index from the mapping
                const mappingKey = `${assetPageIndex}|${layout.colorSpace}`;
                const targetPageIndex = pageMapping.get(mappingKey);

                if (targetPageIndex === undefined) {
                    throw new Error(
                        `No converted page for "${mappingKey}" (asset "${assetRef.asset}" in layout "${layout.layout}" ${layout.colorSpace})`
                    );
                }

                embeddedPages.push(await getEmbeddedPage(targetPageIndex));
            }

            // Create the output page using the first asset's dimensions
            const firstEmbedded = embeddedPages[0];
            const page = assembledDocument.addPage([firstEmbedded.width, firstEmbedded.height]);

            // Layer all assets onto the page using drawPage (reuses embedded pages)
            for (const embedded of embeddedPages) {
                page.drawPage(embedded);
            }

            await onProgress?.(
                60 + Math.floor((pageNumber + 1) / totalPages * 35),
                `Assembling page ${pageNumber + 1}/${totalPages}\u2026`,
            );
        }

        // ------------------------------------------------------------------
        // Phase C: Remove asset pages (indices 0 to assetPageCount-1)
        // ------------------------------------------------------------------
        // Output pages follow after the asset pages. Removing from the end
        // of the asset range first so output page indices are not affected
        // until all asset pages are removed.
        for (let i = assetPageCount - 1; i >= 0; i--) {
            assembledDocument.removePage(i);
        }

        await onProgress?.(100, 'Assembly complete');

        return assembledDocument;
    }

    /**
     * Loads an asset by file name (or the asset PDF itself when `fileName` is `null`).
     *
     * Uses the browser Cache API when available, with fetch progress reporting.
     *
     * @param {string | null} fileName - File within the assets folder, or `null` for the asset PDF
     * @param {object} [options]
     * @param {(state: FetchState) => void} [options.update]
     * @returns {Promise<ArrayBuffer>}
     */
    async #loadAsset(fileName, options) {
        const url = resolveAssetURL(this.#assetBase, fileName);
        const cacheKey = url;

        if (this.#assetCache[cacheKey] !== undefined) return this.#assetCache[cacheKey];

        const { promise, resolve, reject } = PromiseWithResolvers();
        this.#assetCache[cacheKey] = promise;

        /** @type {FetchState} */
        const fetchState = {
            name: fileName ?? `${this.#assetBase}.pdf`,
            location: url,
            totalBytes: NaN,
            receivedBytes: 0,
            done: false,
            aborted: false,
        };

        const cache = await this.#cache;

        /** @type {RequestInit} */
        const fetchOptions = {
            redirect: 'follow',
            cache: cache ? 'no-store' : 'force-cache',
            signal: this.#abortController.signal,
        };

        // HEAD request for freshness check (remote URLs only)
        const isRemote = /^https?:\/\//.test(url);
        const fetchedHeaders = isRemote
            ? (await fetch(url, { method: 'HEAD', ...fetchOptions })).headers
            : null;

        const cachedResponse = await cache?.match?.(url) ?? null;
        const cachedHeaders = cachedResponse?.headers ?? null;

        // Use cache if available and fresh (content-length matches or no HEAD to compare)
        const cacheIsFresh = cachedResponse && (
            !fetchedHeaders
            || fetchedHeaders.get('content-length') === cachedHeaders?.get('content-length')
        );

        if (cacheIsFresh) {
            const contentLength = cachedResponse.headers.get('content-length');
            fetchState.receivedBytes = fetchState.totalBytes = contentLength ? parseInt(contentLength, 10) : NaN;
            fetchState.done = true;
            options?.update?.(fetchState);
            resolve(await cachedResponse.arrayBuffer());
            return promise;
        }

        // Fetch from network
        const response = isRemote
            ? await fetch(url, { method: 'GET', ...fetchOptions })
            : null;

        if (!response?.ok) {
            const error = new Error(`Failed to fetch ${fileName ?? 'asset PDF'}: HTTP ${response?.status ?? 'no response'}`);
            reject(error);
            throw error;
        }

        const contentLength = response.headers.get('content-length');
        const reader = contentLength ? response.clone().body?.getReader?.() : null;

        if (contentLength) {
            fetchState.totalBytes = parseInt(contentLength, 10);
        }

        // Read through the stream for progress tracking before resolving
        if (reader) {
            let lastProgress = 0;

            while (!fetchState.done) {
                const { done, value } = await reader.read();

                fetchState.receivedBytes += value?.length ?? 0;
                fetchState.done = done;

                options?.update?.(fetchState);

                if (lastProgress < (lastProgress = Math.floor(fetchState.receivedBytes / fetchState.totalBytes * 100)))
                    console.log(fetchState);
            }
        }

        cache?.put?.(url, response.clone());
        resolve(await response.arrayBuffer());

        return promise;
    }

    /**
     * Aborts any in-progress fetch operations.
     */
    abort() {
        this.#abortController.abort();
    }
}
