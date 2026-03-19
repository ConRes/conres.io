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

import { PDFDocument } from '../../packages/pdf-lib/pdf-lib.esm.js';

import {
    uint8ArrayToBase64,
    PromiseWithResolvers,
} from '../../helpers.js';

import { CONTEXT_PREFIX } from '../../services/helpers/runtime.js';
import { PDFService } from '../../services/PDFService.js';
import { ICCService } from '../../services/ICCService.js';
import { GhostscriptService } from '../../services/GhostscriptService.js';
import { ManifestColorSpaceResolver } from './manifest-color-space-resolver.js';
import { AssetPagePreConverter } from './asset-page-pre-converter.js';

// ============================================================================
// Constants
// ============================================================================


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
 * @property {(colorSpace: string, pdfBuffer: ArrayBuffer, metadataJSON: string) => Promise<void>} [onChainOutput]
 */

/**
 * @typedef {object} GenerationResult
 * @property {ArrayBuffer | null} pdfBuffer
 * @property {string} metadataJSON
 */

/**
 * Resolved asset resource URLs from assets.json.
 *
 * When provided, these absolute URLs are used directly for asset loading,
 * bypassing the hardcoded {@link ASSET_VERSIONS} lookup.
 *
 * @typedef {object} AssetResources
 * @property {string} assets - Absolute URL to the asset PDF
 * @property {string} manifest - Absolute URL to the manifest JSON
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

    /** @type {string | undefined} */
    #assetBase;

    /** @type {AssetResources | undefined} */
    #resources;

    /** @type {boolean} */
    #debugging;

    /** @type {8 | 16 | undefined} */
    #outputBitsPerComponent;

    /** @type {boolean} */
    #useWorkers;

    /** @type {'in-place' | 'separate-chains' | 'recombined-chains'} */
    #processingStrategy;

    /** @type {AbortController} */
    #abortController = new AbortController();

    /** @type {Record<string, Promise<ArrayBuffer>>} */
    #assetCache = {};

    /** @type {Promise<Cache | undefined> | undefined} */
    #cache;

    /**
     * @param {object} options
     * @param {string} options.testFormVersion - Display name or key identifying the test form version
     * @param {AssetResources} [options.resources] - Resolved asset URLs from assets.json (preferred over ASSET_VERSIONS)
     * @param {boolean} [options.debugging=false]
     * @param {8 | 16} [options.outputBitsPerComponent] - Coerce output bit depth (undefined = auto)
     * @param {boolean} [options.useWorkers=false] - Enable worker-based color conversion (limited to 2 workers)
     * @param {'in-place' | 'separate-chains' | 'recombined-chains'} [options.processingStrategy='in-place'] - Processing strategy
     */
    constructor({ testFormVersion, resources, debugging = false, outputBitsPerComponent, useWorkers = false, processingStrategy = 'in-place' }) {
        this.#testFormVersion = testFormVersion;
        this.#debugging = debugging;
        this.#outputBitsPerComponent = outputBitsPerComponent;
        this.#useWorkers = useWorkers;
        this.#processingStrategy = processingStrategy;
        this.#cache = globalThis.caches?.open?.('conres-testforms');

        if (resources) {
            this.#resources = resources;
        } else {
            const version = ASSET_VERSIONS[testFormVersion];
            if (!version) throw new Error(`Unknown test form version: ${testFormVersion}`);
            this.#assetBase = version.base;
        }
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

        console.log(`${CONTEXT_PREFIX} [TestFormPDFDocumentGenerator] Manifest loaded:`, {
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

        console.log(`${CONTEXT_PREFIX} [TestFormPDFDocumentGenerator] ICC profile:`, {
            colorSpace: iccProfileHeader.colorSpace,
            description: iccProfileHeader.description,
        });

        // ----------------------------------------------------------------
        // 4. Load asset PDF
        // ----------------------------------------------------------------
        await onProgress('assembling', 32, `Loading asset PDF (${manifest.assets.length} assets)\u2026`);
        const assetDocument = await PDFDocument.load(assetPDFBuffer, { updateMetadata: false });
        const assetPageCount = assetDocument.getPageCount();

        console.log(`${CONTEXT_PREFIX} [TestFormPDFDocumentGenerator] Asset PDF loaded: ${assetPageCount} pages (manifest expects ${manifest.assets.length})`);

        if (assetPageCount !== manifest.assets.length) {
            console.warn(
                `${CONTEXT_PREFIX} [TestFormPDFDocumentGenerator] Asset page count (${assetPageCount}) does not match manifest assets count (${manifest.assets.length}).`
            );
        }

        // ----------------------------------------------------------------
        // 5. Resolve color space profiles and create pre-converter
        // ----------------------------------------------------------------
        await onProgress('converting', 34, `Resolving ${Object.keys(manifest.colorSpaces).length} color space profiles\u2026`);

        const manifestURL = this.#resources
            ? this.#resources.manifest
            : resolveAssetURL(/** @type {string} */ (this.#assetBase), 'manifest.json');

        /**
         * Resolves a manifest-relative profile path to a fetchable URL.
         *
         * @param {string} profilePath - Manifest-relative profile path (e.g., `"../profiles/sRGB.icc"`)
         * @returns {string} Absolute URL for fetching the profile
         */
        const resolveProfileURL = (profilePath) => {
            return new URL(profilePath, manifestURL).href;
        };

        const colorSpaceResolver = new ManifestColorSpaceResolver(
            manifest.colorSpaces,
            manifestURL,
            this.#cache,
            resolveProfileURL,
        );

        // ----------------------------------------------------------------
        // Branch: separate-chains or recombined-chains
        // ----------------------------------------------------------------
        if (this.#processingStrategy === 'separate-chains' || this.#processingStrategy === 'recombined-chains') {
            return this.#generateSeparateChains(
                assetPDFBuffer, manifest, manifestBuffer,
                iccProfileBuffer, iccProfileHeader, colorSpaceResolver,
                userMetadata, callbacks,
            );
        }

        // ----------------------------------------------------------------
        // 6. Pre-convert assets and assemble pages (single-document path)
        // ----------------------------------------------------------------
        const preConverter = new AssetPagePreConverter({
            outputProfile: iccProfileBuffer,
            outputColorSpace: iccProfileHeader.colorSpace,
            outputBitsPerComponent: this.#outputBitsPerComponent,
            colorSpaceResolver,
            debugging: this.#debugging,
            useWorkers: this.#useWorkers,
            interConversionDelay: 500,
        });

        await onProgress('converting', 36, `Pre-converting ${assetPageCount} asset pages\u2026`);

        console.time('Pre-conversion and assembly');

        try {
            const assembledDocument = await this.#assemblePages(preConverter, assetDocument, manifest, async (percent, message) => {
                await onProgress('converting', 36 + Math.floor(percent * 0.42), message);
            });

            console.timeEnd('Pre-conversion and assembly');
            console.log(`${CONTEXT_PREFIX} [TestFormPDFDocumentGenerator] Assembled document: ${assembledDocument.getPageCount()} pages`);

            // Flush pending embeds so that lazy PDFEmbeddedPage objects
            // finalize their Form XObjects into the context. Without this,
            // removeOrphanedObjects would delete the source pages' content
            // streams that the embedders still need to decode.
            await assembledDocument.flush();

            // Remove orphaned objects left behind by removePage
            const { removedCount } = PDFService.removeOrphanedObjects(assembledDocument);
            if (this.#debugging) {
                console.log(`${CONTEXT_PREFIX} [TestFormPDFDocumentGenerator] Removed ${removedCount} orphaned objects`);
            }

            // Clear the context's cached push/pop graphics state content
            // stream refs. These shared q/Q streams were created during
            // flush() when asset page embeds called normalize(), and were
            // inserted into the asset pages' Contents arrays. After
            // removeOrphanedObjects() deletes them (they're only reachable
            // from the removed asset pages), the cached refs become stale.
            // Clearing them ensures getPushGraphicsStateContentStream() and
            // getPopGraphicsStateContentStream() create fresh streams when
            // slug pages are later embedded during save().
            assembledDocument.context.pushGraphicsStateContentStreamRef = undefined;
            assembledDocument.context.popGraphicsStateContentStreamRef = undefined;

            await onProgress('converting', 78, 'Color conversion complete');

            // ----------------------------------------------------------------
            // 7. Generate and embed slugs (single-document path)
            // ----------------------------------------------------------------
            if (userMetadata) {
                await onProgress('slugs', 80, `Loading slug resources (${manifest.pages.length} pages)\u2026`);

                const slugsDocument = await this.#generateSlugsPDF(
                    manifest.pages, iccProfileBuffer, iccProfileHeader, userMetadata,
                );

                await onProgress('slugs', 88, `Embedding slugs (${manifest.pages.length} pages)\u2026`);
                await PDFService.embedSlugsIntoPDFDocument(assembledDocument, slugsDocument);
            } else {
                console.warn(`${CONTEXT_PREFIX} [TestFormPDFDocumentGenerator] No user metadata provided. Skipping slug generation.`);
            }

            // ----------------------------------------------------------------
            // 8. Post-processing
            // ----------------------------------------------------------------
            await this.#postProcess(assembledDocument, iccProfileHeader, iccProfileBuffer, manifestBuffer, onProgress);

            // ----------------------------------------------------------------
            // 9. Save and generate metadata JSON
            // ----------------------------------------------------------------
            await onProgress('saving', 95, 'Saving PDF\u2026');

            // Yield before the heavy save() serialization pass
            await new Promise(resolve => setTimeout(resolve, 500));

            const pdfBuffer = /** @type {ArrayBuffer} */ (
                (await assembledDocument.save({ addDefaultPage: false, updateFieldAppearances: false, objectsPerTick: 20 })).buffer
            );

            const metadataJSON = this.#buildMetadataJSON(manifest, iccProfileHeader, iccProfileBuffer, userMetadata);

            await onProgress('done', 100, 'Generation complete');

            return { pdfBuffer, metadataJSON };
        } finally {
            preConverter.dispose();
        }
    }

    /**
     * Converts and assembles the output PDF in the asset document (single-document).
     *
     * Works entirely in `assetDocument` to avoid duplicating all asset pages
     * into a second document (~350 MB savings for large assets).
     *
     * 1. Pre-convert asset pages in place (one `PDFDocumentColorConverter` per chain)
     * 2. Embed each converted asset page once via `embedPage`, draw many via `drawPage`
     * 3. Remove the original/copied asset pages (Form XObjects survive)
     *
     * @param {AssetPagePreConverter} preConverter - Batch pre-converter
     * @param {PDFDocument} assetDocument - The loaded asset PDF (modified in place, returned as output)
     * @param {TestFormManifest} manifest
     * @param {(percent: number, message: string) => void | Promise<void>} [onProgress] - Progress callback (0-100 within this step)
     * @returns {Promise<PDFDocument>}
     */
    async #assemblePages(preConverter, assetDocument, manifest, onProgress) {

        // ------------------------------------------------------------------
        // Phase A: Convert asset pages in place (single-document)
        // ------------------------------------------------------------------
        const pageMapping = await preConverter.convertAll(
            assetDocument,
            manifest,
            async (percent, message) => { await onProgress?.(Math.floor(percent * 0.6), message); },
        );

        // After convertAll, the document contains the original asset pages
        // (some converted in place) plus any copies appended for multi-chain
        // pages. All asset/copy pages precede the layout pages we're about
        // to add.
        const assetPageCount = assetDocument.getPageCount();

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

        // Cache of embedded pages (embed once, draw many).
        // Key: page index in assetDocument (an asset or copied page).
        // Value: PDFEmbeddedPage (Form XObject — survives removePage).
        /** @type {Map<number, import('pdf-lib').PDFEmbeddedPage>} */
        const embeddedPageCache = new Map();

        /**
         * Gets or creates an embedded page for a converted asset page.
         *
         * @param {number} targetPageIndex - Page index in assetDocument (an asset page)
         * @returns {Promise<import('pdf-lib').PDFEmbeddedPage>}
         */
        const getEmbeddedPage = async (targetPageIndex) => {
            let embedded = embeddedPageCache.get(targetPageIndex);
            if (!embedded) {
                embedded = await assetDocument.embedPage(
                    assetDocument.getPage(targetPageIndex),
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
            const page = assetDocument.addPage([firstEmbedded.width, firstEmbedded.height]);

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
        // Layout pages were appended after the asset pages. Removing asset
        // pages from the end of the range first preserves layout page
        // positions until all asset pages are gone. The embedded Form
        // XObjects (created by embedPage) survive in PDFContext.indirectObjects
        // even after the source pages are removed from the page tree.
        for (let i = assetPageCount - 1; i >= 0; i--) {
            assetDocument.removePage(i);
        }

        await onProgress?.(100, 'Assembly complete');

        return assetDocument;
    }

    /**
     * Generates one PDF per layout color space group, calling `onChainOutput`
     * for each completed chain PDF.
     *
     * @param {ArrayBuffer} assetPDFBuffer - Raw asset PDF bytes (reloaded per chain)
     * @param {TestFormManifest} manifest - Full manifest
     * @param {ArrayBuffer} manifestBuffer - Raw manifest bytes for attachment
     * @param {ArrayBuffer} iccProfileBuffer - Destination ICC profile bytes
     * @param {{ colorSpace: string, description: string }} iccProfileHeader
     * @param {ManifestColorSpaceResolver} colorSpaceResolver
     * @param {UserMetadata | null} userMetadata
     * @param {GenerationCallbacks} callbacks
     * @returns {Promise<GenerationResult>}
     */
    async #generateSeparateChains(assetPDFBuffer, manifest, manifestBuffer, iccProfileBuffer, iccProfileHeader, colorSpaceResolver, userMetadata, callbacks) {
        const { onProgress = () => {}, onChainOutput } = callbacks;
        const recombine = this.#processingStrategy === 'recombined-chains';

        // ------------------------------------------------------------------
        // Discover color space groups from layouts (canonical names)
        // ------------------------------------------------------------------
        /** @type {Map<string, { pages: TestFormManifestPageEntry[], originalPageIndices: number[] }>} */
        const colorSpaceGroups = new Map();

        // Use layout colorSpace names as canonical group keys
        const canonicalColorSpaces = [...new Set(manifest.layouts.map(
            (/** @type {{ colorSpace: string }} */ l) => l.colorSpace,
        ))];

        for (const canonicalCS of canonicalColorSpaces) {
            /** @type {TestFormManifestPageEntry[]} */
            const groupPages = [];
            /** @type {number[]} */
            const groupIndices = [];

            for (let i = 0; i < manifest.pages.length; i++) {
                const page = manifest.pages[i];
                const pageCS = page.colorSpace ?? page.metadata?.colorSpace;
                if (pageCS?.toLowerCase() === canonicalCS.toLowerCase()) {
                    groupPages.push(page);
                    groupIndices.push(i);
                }
            }

            if (groupPages.length > 0) {
                colorSpaceGroups.set(canonicalCS, { pages: groupPages, originalPageIndices: groupIndices });
            }
        }

        console.log(`${CONTEXT_PREFIX} [TestFormPDFDocumentGenerator] ${recombine ? 'Recombined' : 'Separate'} chains: color space groups:`, [...colorSpaceGroups.keys()]);

        // ------------------------------------------------------------------
        // Build metadata JSON before chains (available for immediate download)
        // ------------------------------------------------------------------
        const metadataJSON = this.#buildMetadataJSON(manifest, iccProfileHeader, iccProfileBuffer, userMetadata);

        // ------------------------------------------------------------------
        // Generate full slugs PDF once (all pages) before the chain loop
        // ------------------------------------------------------------------
        /** @type {PDFDocument | null} */
        let fullSlugsDocument = null;

        if (userMetadata) {
            await onProgress('slugs', 36, `Generating slugs PDF (${manifest.pages.length} pages)\u2026`);
            fullSlugsDocument = await this.#generateSlugsPDF(
                manifest.pages, iccProfileBuffer, iccProfileHeader, userMetadata,
            );
        }

        // ------------------------------------------------------------------
        // Per-chain loop
        // ------------------------------------------------------------------
        const groupEntries = [...colorSpaceGroups.entries()];
        const totalGroups = groupEntries.length;

        // Chains occupy 40-88% when recombining (recombination needs 88-95%), or 40-96% when separate
        const chainProgressRange = recombine ? 48 : 56;

        /** @type {({ buffer: ArrayBuffer, originalPageIndices: number[] } | null)[]} */
        const chainOutputs = [];

        for (let groupIndex = 0; groupIndex < totalGroups; groupIndex++) {
            const [colorSpace, group] = groupEntries[groupIndex];

            const chainProgressBase = 40 + Math.floor(groupIndex / totalGroups * chainProgressRange);
            await onProgress('chains', chainProgressBase, `Processing chain ${groupIndex + 1} of ${totalGroups}: ${colorSpace} (${group.pages.length} pages)\u2026`);

            console.time(`Chain: ${colorSpace}`);

            // Filter layouts to only those matching this chain's canonical color space
            const chainLayouts = manifest.layouts.filter(
                (/** @type {{ colorSpace: string }} */ layoutEntry) => layoutEntry.colorSpace === colorSpace,
            );

            // Build filtered manifest (keep full assets array to preserve index alignment)
            const filteredManifest = /** @type {TestFormManifest} */ ({
                ...manifest,
                pages: group.pages,
                layouts: chainLayouts,
            });

            // Load fresh document for this chain
            const chainDocument = await PDFDocument.load(assetPDFBuffer, { updateMetadata: false });

            // Create a fresh pre-converter for this chain
            const chainPreConverter = new AssetPagePreConverter({
                outputProfile: iccProfileBuffer,
                outputColorSpace: iccProfileHeader.colorSpace,
                outputBitsPerComponent: this.#outputBitsPerComponent,
                colorSpaceResolver,
                debugging: this.#debugging,
                useWorkers: this.#useWorkers,
                interConversionDelay: 500,
            });

            try {
                // Convert and assemble this chain's pages
                const chainProgressEnd = 40 + Math.floor((groupIndex + 1) / totalGroups * chainProgressRange);
                const chainRange = chainProgressEnd - chainProgressBase;
                const assembledDocument = await this.#assemblePages(
                    chainPreConverter, chainDocument, filteredManifest,
                    async (subPercent, subMessage) => {
                        const scaledPercent = chainProgressBase + Math.floor(subPercent / 100 * chainRange);
                        await onProgress('chains', scaledPercent, `Chain ${groupIndex + 1} of ${totalGroups} (${colorSpace}) \u2014 ${subMessage}`);
                    },
                );

                console.log(`${CONTEXT_PREFIX} [TestFormPDFDocumentGenerator] Chain "${colorSpace}": ${assembledDocument.getPageCount()} pages assembled`);

                // Flush pending embeds so that lazy PDFEmbeddedPage objects
                // finalize their Form XObjects into the context. Without this,
                // removeOrphanedObjects would delete the source pages' content
                // streams that the embedders still need to decode.
                await assembledDocument.flush();

                // Remove orphaned objects left behind by removePage
                // (asset pages removed from page tree but their streams/resources
                // remain in PDFContext.indirectObjects until explicitly deleted)
                const { removedCount } = PDFService.removeOrphanedObjects(assembledDocument);
                if (this.#debugging) {
                    console.log(`${CONTEXT_PREFIX} [TestFormPDFDocumentGenerator] Chain "${colorSpace}": removed ${removedCount} orphaned objects`);
                }

                // Clear the context's cached push/pop graphics state content
                // stream refs — same issue as in-place path. See comment there.
                assembledDocument.context.pushGraphicsStateContentStreamRef = undefined;
                assembledDocument.context.popGraphicsStateContentStreamRef = undefined;

                // Embed chain-specific slugs from the full slugs document
                if (fullSlugsDocument) {
                    for (let i = 0; i < assembledDocument.getPageCount(); i++) {
                        const originalPageIndex = group.originalPageIndices[i];
                        const [slugPage] = await assembledDocument.embedPdf(fullSlugsDocument, [originalPageIndex]);
                        assembledDocument.getPage(i).drawPage(slugPage);
                    }
                }

                if (recombine) {
                    // Page-level post-processing only (survives copyPages)
                    await this.#postProcessPages(assembledDocument, iccProfileHeader);

                    const chainBuffer = /** @type {ArrayBuffer} */ (
                        (await assembledDocument.save({ addDefaultPage: false, updateFieldAppearances: false, objectsPerTick: 20 })).buffer
                    );

                    console.timeEnd(`Chain: ${colorSpace}`);

                    chainOutputs.push({ buffer: chainBuffer, originalPageIndices: group.originalPageIndices });
                } else {
                    // Full post-process for separate-chains (each chain is a standalone PDF)
                    await this.#postProcess(assembledDocument, iccProfileHeader, iccProfileBuffer, manifestBuffer);

                    const chainPDFBuffer = /** @type {ArrayBuffer} */ (
                        (await assembledDocument.save({ addDefaultPage: false, updateFieldAppearances: false, objectsPerTick: 20 })).buffer
                    );

                    console.timeEnd(`Chain: ${colorSpace}`);

                    // Deliver chain output (includes metadataJSON for first-chain download)
                    if (onChainOutput) {
                        await onChainOutput(colorSpace, chainPDFBuffer, metadataJSON);
                    }
                }
            } finally {
                chainPreConverter.dispose();
            }

            // Yield for GC between chains
            await new Promise(resolve => setTimeout(resolve, 500));
        }

        // ------------------------------------------------------------------
        // Recombination phase (recombined-chains only)
        // ------------------------------------------------------------------
        if (recombine) {
            await onProgress('recombining', 88, 'Recombining chains\u2026');

            console.time('Recombination');

            const targetDocument = await PDFDocument.create();

            // Resolved pages array: index = manifest page index, value = copied PDFPage
            /** @type {(import('pdf-lib').PDFPage | undefined)[]} */
            const resolvedPages = new Array(manifest.pages.length);

            for (let i = 0; i < chainOutputs.length; i++) {
                const chainOutput = chainOutputs[i];
                if (!chainOutput) continue;

                const progressPercent = 88 + Math.floor((i + 1) / chainOutputs.length * 7);
                await onProgress('recombining', progressPercent, `Recombining chain ${i + 1}/${chainOutputs.length}\u2026`);

                // Load chain buffer as source document
                const sourceDocument = await PDFDocument.load(chainOutput.buffer, { updateMetadata: false });
                const sourcePageCount = sourceDocument.getPageCount();
                const sourceIndices = Array.from({ length: sourcePageCount }, (_, j) => j);

                // Copy all pages from source into target document's context
                const copiedPages = await targetDocument.copyPages(sourceDocument, sourceIndices);

                // Map copied pages to their manifest positions
                for (let j = 0; j < copiedPages.length; j++) {
                    resolvedPages[chainOutput.originalPageIndices[j]] = copiedPages[j];
                }

                // Release chain buffer and source document for GC
                chainOutputs[i] = null;
                await new Promise(resolve => setTimeout(resolve, 500));
            }

            // Add all pages in manifest order
            for (let i = 0; i < resolvedPages.length; i++) {
                const page = resolvedPages[i];
                if (!page) {
                    throw new Error(`Missing page at manifest index ${i} after recombination`);
                }
                targetDocument.addPage(page);
            }

            console.log(`${CONTEXT_PREFIX} [TestFormPDFDocumentGenerator] Recombined document: ${targetDocument.getPageCount()} pages`);

            // Document-level post-processing on the final recombined document
            await this.#postProcessDocument(targetDocument, iccProfileHeader, iccProfileBuffer, manifestBuffer);

            console.timeEnd('Recombination');

            // Save final document
            await onProgress('saving', 95, 'Saving PDF\u2026');
            await new Promise(resolve => setTimeout(resolve, 500));

            const pdfBuffer = /** @type {ArrayBuffer} */ (
                (await targetDocument.save({ addDefaultPage: false, updateFieldAppearances: false, objectsPerTick: 20 })).buffer
            );

            await onProgress('done', 100, 'Generation complete');

            return { pdfBuffer, metadataJSON };
        }

        await onProgress('done', 100, 'Generation complete');

        return { pdfBuffer: null, metadataJSON };
    }

    /**
     * Generates a slugs PDF for the given page descriptors.
     *
     * Loads slug resources, processes the template, and runs Ghostscript once.
     *
     * @param {TestFormManifestPageEntry[]} pages - Page descriptors to generate slugs for
     * @param {ArrayBuffer} iccProfileBuffer - Destination ICC profile bytes
     * @param {{ colorSpace: string }} iccProfileHeader
     * @param {UserMetadata} userMetadata
     * @returns {Promise<PDFDocument>} Loaded slugs PDF document
     */
    async #generateSlugsPDF(pages, iccProfileBuffer, iccProfileHeader, userMetadata) {
        const [slugsTemplateBuffer, barcodeBuffer] = await Promise.all([
            this.#loadAsset('slugs.ps'),
            this.#loadAsset('barcode.ps'),
        ]);

        // Normalize page data from manifest for processSlugTemplate
        const normalizedPages = pages.map((page) => ({
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

        /** @type {Record<string, ArrayBuffer>} */
        const resources = {};
        resources['input/Barcode.ps'] = barcodeBuffer;
        resources['input/Slugs.ps'] = new TextEncoder().encode(slugSourceText).buffer;
        resources['input/Output.icc'] = iccProfileBuffer;

        const slugsPDFBuffer = await GhostscriptService.generateSlugsPDF(
            resources,
            iccProfileHeader.colorSpace,
            this.#debugging,
        );

        return PDFDocument.load(slugsPDFBuffer);
    }

    /**
     * Applies post-processing steps to a completed document: decalibrate,
     * set blending space, set output intent, and attach manifest.
     *
     * @param {PDFDocument} document
     * @param {{ colorSpace: string, description: string }} iccProfileHeader
     * @param {ArrayBuffer} iccProfileBuffer
     * @param {ArrayBuffer} manifestBuffer
     * @param {(stage: string, percent: number, message: string) => void | Promise<void>} [onProgress]
     */
    async #postProcess(document, iccProfileHeader, iccProfileBuffer, manifestBuffer, onProgress) {
        await onProgress?.('finalizing', 90, 'Finalizing PDF\u2026');

        // Yield to let the browser handle GC and impeded tasks after
        // GhostScript WASM and color conversion work.
        await new Promise(resolve => setTimeout(resolve, 500));

        await this.#postProcessPages(document, iccProfileHeader);
        await this.#postProcessDocument(document, iccProfileHeader, iccProfileBuffer, manifestBuffer);
    }

    /**
     * Page-level post-processing: decalibrate ICC color spaces and replace
     * transparency blending spaces. These modifications are deep-copied by
     * `PDFDocument.copyPages` and survive recombination.
     *
     * @param {PDFDocument} document
     * @param {{ colorSpace: string }} iccProfileHeader
     */
    async #postProcessPages(document, iccProfileHeader) {
        console.time('decalibrateColorInPDFDocument');
        await PDFService.decalibrateColorInPDFDocument(document);
        console.timeEnd('decalibrateColorInPDFDocument');

        console.time('replaceTransarencyBlendingSpaceInPDFDocument');
        await PDFService.replaceTransarencyBlendingSpaceInPDFDocument(
            document,
            `Device${iccProfileHeader.colorSpace}`,
        );
        console.timeEnd('replaceTransarencyBlendingSpaceInPDFDocument');
    }

    /**
     * Document-level post-processing: set output intent and attach manifest.
     * These belong only on the final output document (not per-chain documents
     * when recombining).
     *
     * @param {PDFDocument} document
     * @param {{ colorSpace: string, description: string }} iccProfileHeader
     * @param {ArrayBuffer} iccProfileBuffer
     * @param {ArrayBuffer} manifestBuffer
     */
    async #postProcessDocument(document, iccProfileHeader, iccProfileBuffer, manifestBuffer) {
        // Always use the user's destination ICC profile for the output intent
        // (not a source profile extracted from the document)
        PDFService.setOutputIntentForPDFDocument(document, {
            iccProfile: new Uint8Array(iccProfileBuffer),
            identifier: iccProfileHeader.description || `ICCBased_${iccProfileHeader.colorSpace}`,
            subType: 'GTS_PDFX',
        });

        // Attach manifest to output PDF
        await PDFService.attachManifestToPDFDocument(
            document,
            manifestBuffer,
            'test-form.manifest.json',
        );
    }

    /**
     * Builds the metadata JSON string for the generation result.
     *
     * @param {TestFormManifest} manifest
     * @param {{ colorSpace: string, description: string }} iccProfileHeader
     * @param {ArrayBuffer} iccProfileBuffer
     * @param {UserMetadata | null} userMetadata
     * @returns {string}
     */
    #buildMetadataJSON(manifest, iccProfileHeader, iccProfileBuffer, userMetadata) {
        /** @satisfies {Parameters<uint8ArrayToBase64>[1]} */
        const base64Options = { 'alphabet': 'base64' };

        return JSON.stringify({
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
        /** @type {string} */
        let url;
        if (this.#resources) {
            if (fileName === null) {
                url = this.#resources.assets;
            } else if (fileName === 'manifest.json') {
                url = this.#resources.manifest;
            } else {
                // Sub-resources (slugs.ps, barcode.ps) resolve relative to manifest directory
                url = new URL(fileName, this.#resources.manifest).href;
            }
        } else {
            url = resolveAssetURL(/** @type {string} */ (this.#assetBase), fileName);
        }
        const cacheKey = url;

        if (this.#assetCache[cacheKey] !== undefined) return this.#assetCache[cacheKey];

        const { promise, resolve, reject } = PromiseWithResolvers();
        this.#assetCache[cacheKey] = promise;

        /** @type {FetchState} */
        const fetchState = {
            name: fileName ?? (this.#assetBase ? `${this.#assetBase}.pdf` : url.split('/').pop() ?? 'assets.pdf'),
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
                    console.log(CONTEXT_PREFIX, fetchState);
            }
        }

        if (cache) {
            // Delete stale entry first to free disk space before writing the new one.
            // Chrome's Cache backend can throw UnknownError when it must hold both
            // the old and new entry simultaneously on a constrained disk.
            if (cachedResponse) await cache.delete(url);
            await cache.put(url, response.clone()).catch(cacheStorageError => {
                console.warn(CONTEXT_PREFIX, cacheStorageError);
            });
        }
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
