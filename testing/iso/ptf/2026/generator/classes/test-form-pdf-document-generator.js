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

import { PDFDocument, StandardFonts } from '../../packages/pdf-lib/pdf-lib.esm.js';

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
import { OutputProfileAnalyzer } from './output-profile-analyzer.js';
import { AssemblyPolicyResolver } from './assembly-policy-resolver.js';
import { getEnvironmentDescriptor } from './environment-descriptor.js';

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
 * @property {(label: string, pdfBuffer: ArrayBuffer, metadataJSON: string) => Promise<void>} [onChainOutput]
 * @property {(docketPDFBuffer: ArrayBuffer, metadataJSON: string) => Promise<void>} [onDocketReady]
 */

/**
 * @typedef {object} GenerationResult
 * @property {ArrayBuffer | null} pdfBuffer
 * @property {string} metadataJSON
 * @property {ArrayBuffer | null} [docketPDFBuffer]
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

    /** @type {import('./assembly-policy-resolver.js').AssemblyUserOverrides | undefined} */
    #assemblyOverrides;

    /** @type {string | undefined} */
    #outputProfileName;

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
     * @param {import('./assembly-policy-resolver.js').AssemblyUserOverrides} [options.assemblyOverrides] - User overrides for layout/colorSpace/intent filtering
     * @param {string} [options.outputProfileName] - ICC profile filename (for slug metadata)
     */
    constructor({ testFormVersion, resources, debugging = false, outputBitsPerComponent, useWorkers = false, processingStrategy = 'in-place', assemblyOverrides, outputProfileName }) {
        this.#testFormVersion = testFormVersion;
        this.#debugging = debugging;
        this.#outputBitsPerComponent = outputBitsPerComponent;
        this.#useWorkers = useWorkers;
        this.#processingStrategy = processingStrategy;
        this.#assemblyOverrides = assemblyOverrides;
        this.#outputProfileName = outputProfileName;
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
        // 3b. Analyze output profile and resolve assembly policy
        // ----------------------------------------------------------------
        await onProgress('preparing', 31, 'Analyzing output profile\u2026');

        const policyResolver = await AssemblyPolicyResolver.load();
        const profileAnalysis = await OutputProfileAnalyzer.analyzeProfile(
            iccProfileBuffer,
            iccProfileHeader,
            policyResolver.policyData.maxGCRTest,
        );

        const assemblyPlan = policyResolver.resolve(
            profileAnalysis,
            manifest,
            this.#assemblyOverrides,
        );

        console.log(`${CONTEXT_PREFIX} [TestFormPDFDocumentGenerator] Assembly plan:`, {
            profileCategory: assemblyPlan.profileCategory,
            profileCategoryLabel: assemblyPlan.profileCategoryLabel,
            multiPDF: assemblyPlan.multiPDF,
            passes: assemblyPlan.generationPasses.length,
        });

        // ----------------------------------------------------------------
        // 3c. Resolve manifest URL and color space profiles
        // ----------------------------------------------------------------
        const manifestURL = this.#resources
            ? this.#resources.manifest
            : resolveAssetURL(/** @type {string} */ (this.#assetBase), 'manifest.json');

        /**
         * Resolves a manifest-relative profile path to a fetchable URL.
         * @param {string} profilePath
         * @returns {string}
         */
        const resolveProfileURL = (profilePath) => new URL(profilePath, manifestURL).href;

        const colorSpaceResolver = new ManifestColorSpaceResolver(
            manifest.colorSpaces,
            manifestURL,
            this.#cache,
            resolveProfileURL,
        );

        // ----------------------------------------------------------------
        // 3d. Generate docket PDF (litmus test — must succeed before main job)
        // ----------------------------------------------------------------
        /** @type {ArrayBuffer | null} */
        let docketPDFBuffer = null;

        if (manifest.docket) {
            await onProgress('preparing', 32, 'Generating docket PDF\u2026');

            const metadataJSON = this.#buildMetadataJSON(manifest, iccProfileHeader, iccProfileBuffer, userMetadata, assemblyPlan);

            docketPDFBuffer = await this.#generateDocketPDF(
                manifest, metadataJSON, iccProfileBuffer, iccProfileHeader,
                colorSpaceResolver, userMetadata,
                assemblyPlan.generationPasses.map(p => p.intentPass),
            );

            console.log(`${CONTEXT_PREFIX} [TestFormPDFDocumentGenerator] Docket PDF generated: ${docketPDFBuffer ? (docketPDFBuffer.byteLength / 1024).toFixed(1) + ' KB' : 'null'}`);

            // Deliver docket immediately — UI downloads it before main job starts
            if (docketPDFBuffer && callbacks.onDocketReady) {
                await callbacks.onDocketReady(docketPDFBuffer, metadataJSON);
            }
        }

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
        // Branch: separate-chains or recombined-chains
        // ----------------------------------------------------------------
        if (this.#processingStrategy === 'separate-chains' || this.#processingStrategy === 'recombined-chains') {
            return this.#generateSeparateChains(
                assetPDFBuffer, manifest, manifestBuffer,
                iccProfileBuffer, iccProfileHeader, colorSpaceResolver,
                userMetadata, callbacks, docketPDFBuffer,
            );
        }

        // ----------------------------------------------------------------
        // Branch: multi-pass (multiple rendering intents, e.g., non-Max GCR CMYK)
        // ----------------------------------------------------------------
        if (assemblyPlan.multiPDF) {
            return this.#generateMultiIntentPasses(
                assetPDFBuffer, manifestBuffer,
                iccProfileBuffer, iccProfileHeader, colorSpaceResolver,
                assemblyPlan, userMetadata, callbacks, docketPDFBuffer,
            );
        }

        // ----------------------------------------------------------------
        // 6. Pre-convert assets and assemble pages (single-document, single-intent path)
        // ----------------------------------------------------------------
        const singlePass = assemblyPlan.generationPasses[0];

        const preConverter = new AssetPagePreConverter({
            outputProfile: iccProfileBuffer,
            outputColorSpace: iccProfileHeader.colorSpace,
            outputBitsPerComponent: this.#outputBitsPerComponent,
            colorSpaceResolver,
            renderingIntent: singlePass.intentPass.renderingIntent,
            blackPointCompensation: singlePass.intentPass.blackPointCompensation,
            debugging: this.#debugging,
            useWorkers: this.#useWorkers,
            interConversionDelay: 500,
        });

        // Use filtered manifest from assembly plan
        const effectiveManifest = singlePass.manifest;

        await onProgress('converting', 36, `Pre-converting ${assetPageCount} asset pages\u2026`);

        console.time('Pre-conversion and assembly');

        try {
            const assembledDocument = await this.#assemblePages(preConverter, assetDocument, effectiveManifest, async (percent, message) => {
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
                await onProgress('slugs', 80, `Loading slug resources (${effectiveManifest.pages.length} pages)\u2026`);

                const slugsDocument = await this.#generateSlugsPDF(
                    effectiveManifest.pages, iccProfileBuffer, iccProfileHeader, userMetadata,
                    singlePass.intentPass.label, assemblyPlan.profileCategoryLabel,
                );

                await onProgress('slugs', 88, `Embedding slugs (${effectiveManifest.pages.length} pages)\u2026`);
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

            const metadataJSON = this.#buildMetadataJSON(manifest, iccProfileHeader, iccProfileBuffer, userMetadata, assemblyPlan);

            await onProgress('done', 100, 'Generation complete');

            return { pdfBuffer, metadataJSON, docketPDFBuffer };
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
     * Generates one PDF per rendering intent pass (multi-intent mode).
     *
     * Each pass runs the full pipeline: load fresh asset document, pre-convert
     * with the pass-specific rendering intent, assemble, generate slugs,
     * post-process, save, and deliver via `onChainOutput`.
     *
     * @param {ArrayBuffer} assetPDFBuffer - Raw asset PDF bytes (reloaded per pass)
     * @param {ArrayBuffer} manifestBuffer - Raw manifest bytes for attachment
     * @param {ArrayBuffer} iccProfileBuffer - Destination ICC profile bytes
     * @param {{ colorSpace: string, description: string }} iccProfileHeader
     * @param {ManifestColorSpaceResolver} colorSpaceResolver
     * @param {import('./assembly-policy-resolver.js').AssemblyPlan} assemblyPlan
     * @param {UserMetadata | null} userMetadata
     * @param {GenerationCallbacks} callbacks
     * @returns {Promise<GenerationResult>}
     */
    async #generateMultiIntentPasses(assetPDFBuffer, manifestBuffer, iccProfileBuffer, iccProfileHeader, colorSpaceResolver, assemblyPlan, userMetadata, callbacks, docketPDFBuffer = null) {
        const { onProgress = () => {}, onChainOutput } = callbacks;

        const metadataJSON = this.#buildMetadataJSON(
            assemblyPlan.generationPasses[0].manifest,
            iccProfileHeader, iccProfileBuffer, userMetadata, assemblyPlan,
        );

        const totalPasses = assemblyPlan.generationPasses.length;

        for (let passIndex = 0; passIndex < totalPasses; passIndex++) {
            const pass = assemblyPlan.generationPasses[passIndex];
            const passLabel = pass.intentPass.label;

            const passProgressBase = 36 + Math.floor(passIndex / totalPasses * 52);
            const passProgressEnd = 36 + Math.floor((passIndex + 1) / totalPasses * 52);
            const passRange = passProgressEnd - passProgressBase;

            await onProgress('converting', passProgressBase, `Pass ${passIndex + 1}/${totalPasses}: ${passLabel}\u2026`);

            console.time(`Pass: ${passLabel}`);

            // Each pass runs in its own scope so all large objects (the
            // loaded asset document, assembled document, serialized PDF
            // buffer, slugs document) become unreachable once the scope
            // exits, allowing GC to reclaim them before the next pass.
            await (async () => {
                // Load fresh asset document for this pass
                let passDocument = await PDFDocument.load(assetPDFBuffer, { updateMetadata: false });

                // Create pre-converter with pass-specific rendering intent
                const passPreConverter = new AssetPagePreConverter({
                    outputProfile: iccProfileBuffer,
                    outputColorSpace: iccProfileHeader.colorSpace,
                    outputBitsPerComponent: this.#outputBitsPerComponent,
                    colorSpaceResolver,
                    renderingIntent: pass.intentPass.renderingIntent,
                    blackPointCompensation: pass.intentPass.blackPointCompensation,
                    debugging: this.#debugging,
                    useWorkers: this.#useWorkers,
                    interConversionDelay: 500,
                });

                try {
                    let assembledDocument = await this.#assemblePages(
                        passPreConverter, passDocument, pass.manifest,
                        async (subPercent, subMessage) => {
                            const scaledPercent = passProgressBase + Math.floor(subPercent / 100 * passRange);
                            await onProgress('converting', scaledPercent, `Pass ${passIndex + 1}/${totalPasses} (${passLabel}) \u2014 ${subMessage}`);
                        },
                    );

                    // passDocument is now the assembledDocument (in-place assembly);
                    // null the alias so GC can reclaim earlier intermediate state
                    passDocument = /** @type {any} */ (null);

                    console.log(`${CONTEXT_PREFIX} [TestFormPDFDocumentGenerator] Pass "${passLabel}": ${assembledDocument.getPageCount()} pages assembled`);

                    await assembledDocument.flush();

                    const { removedCount } = PDFService.removeOrphanedObjects(assembledDocument);
                    if (this.#debugging) {
                        console.log(`${CONTEXT_PREFIX} [TestFormPDFDocumentGenerator] Pass "${passLabel}": removed ${removedCount} orphaned objects`);
                    }

                    assembledDocument.context.pushGraphicsStateContentStreamRef = undefined;
                    assembledDocument.context.popGraphicsStateContentStreamRef = undefined;

                    // Generate and embed slugs with pass-specific rendering intent label
                    if (userMetadata) {
                        const slugsDocument = await this.#generateSlugsPDF(
                            pass.manifest.pages, iccProfileBuffer, iccProfileHeader, userMetadata,
                            passLabel, assemblyPlan.profileCategoryLabel,
                        );
                        await PDFService.embedSlugsIntoPDFDocument(assembledDocument, slugsDocument);
                        // slugsDocument goes out of scope here
                    }

                    // Full post-process for each pass PDF (each is a standalone PDF)
                    await this.#postProcess(assembledDocument, iccProfileHeader, iccProfileBuffer, manifestBuffer);

                    const passPDFBuffer = /** @type {ArrayBuffer} */ (
                        (await assembledDocument.save({ addDefaultPage: false, updateFieldAppearances: false, objectsPerTick: 20 })).buffer
                    );

                    // Release the assembled document before delivering the buffer —
                    // onChainOutput triggers a download which keeps passPDFBuffer alive
                    // briefly, but we don't need the document anymore.
                    assembledDocument = /** @type {any} */ (null);

                    console.timeEnd(`Pass: ${passLabel}`);

                    // Deliver pass output via onChainOutput callback
                    if (onChainOutput) {
                        await onChainOutput(passLabel, passPDFBuffer, metadataJSON);
                    }
                    // passPDFBuffer goes out of scope here
                } finally {
                    passPreConverter.dispose();
                }
            })();

            // Yield for GC between passes — the IIFE scope above has exited,
            // so all pass-local objects are now unreachable
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        await onProgress('done', 100, 'Generation complete');

        return { pdfBuffer: null, metadataJSON, docketPDFBuffer };
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
    async #generateSeparateChains(assetPDFBuffer, manifest, manifestBuffer, iccProfileBuffer, iccProfileHeader, colorSpaceResolver, userMetadata, callbacks, docketPDFBuffer = null) {
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

            return { pdfBuffer, metadataJSON, docketPDFBuffer };
        }

        await onProgress('done', 100, 'Generation complete');

        return { pdfBuffer: null, metadataJSON, docketPDFBuffer };
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
     * @param {string} [renderingIntentLabel] - Human-readable rendering intent label for slug metadata
     * @param {string} [profileCategoryLabel] - Human-readable profile category label for slug metadata
     * @returns {Promise<PDFDocument>} Loaded slugs PDF document
     */
    async #generateSlugsPDF(pages, iccProfileBuffer, iccProfileHeader, userMetadata, renderingIntentLabel, profileCategoryLabel) {
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
            {
                slugs: userMetadata,
                renderingIntent: renderingIntentLabel,
                profileCategory: profileCategoryLabel,
                outputProfileName: this.#outputProfileName,
            },
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
     * Generates a docket PDF that replaces the metadata.json download.
     *
     * Creates one page per rendering intent pass, each using the asset(s)
     * defined in `manifest.docket` as a background with metadata text drawn
     * within `docket.bounds`. The metadata JSON (excluding the ICC profile
     * base64) is embedded as a PDF attachment.
     *
     * @param {TestFormManifest} manifest - Full manifest (must have `docket` property)
     * @param {string} metadataJSON - Complete metadata JSON string
     * @param {ArrayBuffer} iccProfileBuffer - Destination ICC profile bytes
     * @param {{ colorSpace: string, description: string }} iccProfileHeader
     * @param {import('./manifest-color-space-resolver.js').ManifestColorSpaceResolver} colorSpaceResolver
     * @param {UserMetadata | null} userMetadata
     * @param {Array<{ renderingIntent: string, blackPointCompensation: boolean, label: string }>} [intentPasses]
     * @returns {Promise<ArrayBuffer | null>}
     */
    async #generateDocketPDF(manifest, metadataJSON, iccProfileBuffer, iccProfileHeader, colorSpaceResolver, userMetadata, intentPasses) {
        const docketConfig = manifest.docket;

        // Resolve docket asset page indices in the asset PDF
        const docketPageIndices = docketConfig.assets
            .map(docketAsset => manifest.assets.findIndex(
                a => a.asset === docketAsset.asset && a.colorSpace === docketAsset.colorSpace,
            ))
            .filter(i => i >= 0);

        if (docketPageIndices.length === 0) {
            console.warn(`${CONTEXT_PREFIX} [TestFormPDFDocumentGenerator] Docket assets not found in manifest, skipping docket PDF.`);
            return null;
        }

        // Default to a single pass with Relative Colorimetric + BPC
        const passes = intentPasses?.length
            ? intentPasses
            : [{ renderingIntent: 'relative-colorimetric', blackPointCompensation: true, label: 'Relative Colorimetric' }];

        const { AssetPagePreConverter } = await import('./asset-page-pre-converter.js');

        // Build a minimal manifest with just the docket assets and a single-page layout
        const docketManifest = /** @type {TestFormManifest} */ ({
            ...manifest,
            layouts: [{
                layout: '__docket__',
                colorSpace: docketConfig.colorSpace,
                assets: docketConfig.assets,
            }],
            pages: [{
                layout: '__docket__',
                colorSpace: docketConfig.colorSpace,
                metadata: { title: 'Docket', colorSpace: docketConfig.colorSpace },
            }],
        });

        // Create the output docket document — one page per intent pass
        const docketDocument = await PDFDocument.create();

        // Parse metadata once for text rendering
        const parsedMetadata = JSON.parse(metadataJSON);

        for (const pass of passes) {
            // Load a fresh copy of the asset PDF for each pass
            const assetPDFBuffer = await this.#loadAsset(null);
            const passAssetDocument = await PDFDocument.load(assetPDFBuffer, { updateMetadata: false });

            const preConverter = new AssetPagePreConverter({
                outputProfile: iccProfileBuffer,
                outputColorSpace: iccProfileHeader.colorSpace,
                outputBitsPerComponent: this.#outputBitsPerComponent,
                colorSpaceResolver,
                renderingIntent: pass.renderingIntent,
                blackPointCompensation: pass.blackPointCompensation,
                debugging: this.#debugging,
                useWorkers: false,
                interConversionDelay: 0,
            });

            try {
                // Run conversion and assembly for this pass
                const passDocument = await this.#assemblePages(
                    preConverter, passAssetDocument, docketManifest,
                );

                // Copy the converted page into the docket document
                const [copiedPage] = await docketDocument.copyPages(passDocument, [0]);
                docketDocument.addPage(copiedPage);
            } finally {
                preConverter.dispose();
            }
        }

        // Generate and embed slugs BEFORE text overlay (so clipping doesn't hide them)
        console.log(`${CONTEXT_PREFIX} [TestFormPDFDocumentGenerator] Docket slugs: userMetadata=${!!userMetadata}, pages=${docketDocument.getPageCount()}`);
        if (userMetadata) {
            const docketPages = passes.map((pass) => ({
                layout: 'Docket',
                colorSpace: docketConfig.colorSpace,
                metadata: {
                    title: 'Docket',
                    variant: pass.label,
                    colorSpace: docketConfig.colorSpace,
                },
            }));

            const slugsDocument = await this.#generateSlugsPDF(
                docketPages, iccProfileBuffer, iccProfileHeader, userMetadata,
                passes.map(p => p.label).join(', '),
                parsedMetadata.assembly?.profileCategoryLabel,
            );
            await PDFService.embedSlugsIntoPDFDocument(docketDocument, slugsDocument);
        }

        // Embed fonts for text rendering (small sizes to fit all content)
        const font = await docketDocument.embedFont(StandardFonts.Helvetica);
        const boldFont = await docketDocument.embedFont(StandardFonts.HelveticaBold);
        const fontSize = 6;
        const labelFontSize = 6;
        const lineHeight = fontSize * 1.25;
        const sectionGap = lineHeight * 0.4;
        const labelColumnWidth = 50;

        // Draw metadata on each page (one per intent pass)
        for (let pageIndex = 0; pageIndex < passes.length; pageIndex++) {
            const page = docketDocument.getPage(pageIndex);
            const pageWidth = page.getWidth();
            const pageHeight = page.getHeight();

            // Determine text bounds (default: full page with 1 inch margins)
            const bounds = docketConfig.bounds ?? {
                x: 72, y: 72,
                width: pageWidth - 144,
                height: pageHeight - 144,
            };

            // Build fields for this pass
            // Field types: { label, value } for text, { checkbox, checked, value } for checkboxes, null for section breaks
            /** @type {Array<{ label: string, value: string } | { checkbox: true, checked: boolean, value: string } | { radio: true, selected: boolean, value: string } | null>} */
            const fields = [];

            // --- Specifications ---
            if (userMetadata) {
                fields.push({ label: 'Device', value: userMetadata.device });
                fields.push({ label: 'Colorants', value: userMetadata.colorants });
                fields.push({ label: 'Substrate', value: userMetadata.substrate });
                fields.push({ label: 'Settings', value: userMetadata.settings });
                fields.push({ label: 'Email', value: userMetadata.email });
            }

            fields.push(null); // Section break

            // --- Generation ---
            fields.push({ label: 'Test Form', value: parsedMetadata.testFormVersion ?? '' });
            fields.push({ label: 'Generated', value: parsedMetadata.generatedAt ?? '' });

            // --- Runtime ---
            if (parsedMetadata.runtime?.navigator) {
                const nav = parsedMetadata.runtime.navigator;
                fields.push({ label: 'Browser', value: nav.browser ?? '' });
                fields.push({ label: 'OS', value: nav.os ?? '' });
            }

            fields.push(null); // Section break

            // --- Output Profile (full ICC header) ---
            if (parsedMetadata.color?.profile) {
                const p = parsedMetadata.color.profile;
                fields.push({ label: 'Profile', value: p.description ?? '' });
                fields.push({ label: 'Color Space', value: p.colorSpace ?? '' });
                if (p.version) fields.push({ label: 'ICC Version', value: p.version });
                if (p.deviceClass) fields.push({ label: 'Device Class', value: p.deviceClass });
                if (p.connectionSpace) fields.push({ label: 'PCS', value: p.connectionSpace });
                if (p.manufacturer) fields.push({ label: 'Manufacturer', value: p.manufacturer });
                if (p.copyright) fields.push({ label: 'Copyright', value: p.copyright });
            }

            // --- Output Settings ---
            const settings = parsedMetadata.settings;
            if (settings) {
                fields.push({ label: 'Bit Depth', value: settings.outputBitsPerComponent === 'auto' ? 'Same as Source' : `${settings.outputBitsPerComponent}-bit` });
            }

            if (parsedMetadata.assembly) {
                fields.push({ label: 'Category', value: parsedMetadata.assembly.profileCategoryLabel ?? '' });
            }

            fields.push(null); // Section break

            // --- Rendering Intents ---
            for (let i = 0; i < passes.length; i++) {
                fields.push({ label: `Intent ${i + 1}`, value: passes[i].label });
            }

            fields.push(null); // Section break

            // --- Assembly Filters (auto/custom + checkboxes) ---
            const overrides = settings?.assemblyOverrides;

            // Layouts
            const layoutMode = overrides?.enabledLayoutNames ? 'Custom' : 'Auto';
            fields.push({ label: 'Layouts', value: '' });
            fields.push({ radio: true, selected: layoutMode === 'Auto', value: 'Auto' });
            fields.push({ radio: true, selected: layoutMode === 'Custom', value: 'Custom' });
            if (parsedMetadata.manifest?.layouts) {
                const uniqueLayouts = [...new Set(parsedMetadata.manifest.layouts.map(
                    (/** @type {{ layout: string }} */ l) => l.layout,
                ))];
                const enabledSet = overrides?.enabledLayoutNames
                    ? new Set(overrides.enabledLayoutNames)
                    : null;
                for (const name of uniqueLayouts) {
                    const checked = enabledSet ? enabledSet.has(name) : true;
                    fields.push({ checkbox: true, checked, value: name });
                }
            }

            // Color Spaces
            const colorSpaceMode = overrides?.enabledColorSpaceNames ? 'Custom' : 'Auto';
            fields.push({ label: 'Color Spaces', value: '' });
            fields.push({ radio: true, selected: colorSpaceMode === 'Auto', value: 'Auto' });
            fields.push({ radio: true, selected: colorSpaceMode === 'Custom', value: 'Custom' });
            if (parsedMetadata.manifest?.colorSpaces) {
                const enabledSet = overrides?.enabledColorSpaceNames
                    ? new Set(overrides.enabledColorSpaceNames)
                    : null;
                for (const name of Object.keys(parsedMetadata.manifest.colorSpaces)) {
                    const checked = enabledSet ? enabledSet.has(name) : true;
                    fields.push({ checkbox: true, checked, value: name });
                }
            }

            // Rendering Intent mode
            const intentMode = overrides?.renderingIntentOverrides ? 'Custom' : 'Auto';
            fields.push({ label: 'Intents', value: '' });
            fields.push({ radio: true, selected: intentMode === 'Auto', value: 'Auto' });
            fields.push({ radio: true, selected: intentMode === 'Custom', value: 'Custom' });

            fields.push(null); // Section break

            // --- Debugging ---
            if (settings) {
                fields.push({ label: 'Debugging', value: settings.debugging ? 'Enabled' : 'Disabled' });
                fields.push({ label: 'Workers', value: settings.useWorkers ? 'Enabled' : 'Disabled' });
                fields.push({ label: 'Strategy', value: settings.processingStrategy ?? 'in-place' });
            }

            const { cmyk } = await import('../../packages/pdf-lib/pdf-lib.esm.js');
            const kBlack = cmyk(0, 0, 0, 1);
            const controlSize = fontSize * 0.7;
            const valueColumnX = bounds.x + labelColumnWidth;
            const maxValueWidth = bounds.width - labelColumnWidth;

            /**
             * Draws text with line wrapping within a max width.
             * Returns the number of lines drawn.
             * @param {string} text
             * @param {number} x
             * @param {number} textY
             * @param {import('pdf-lib').PDFFont} textFont
             * @param {number} textSize
             * @param {number} maxWidth
             * @returns {number}
             */
            const drawWrappedText = (text, x, textY, textFont, textSize, maxWidth) => {
                if (!text) return 0;
                const words = text.split(' ');
                let line = '';
                let linesDrawn = 0;
                let currentY = textY;

                for (const word of words) {
                    const testLine = line ? `${line} ${word}` : word;
                    const testWidth = textFont.widthOfTextAtSize(testLine, textSize);
                    if (testWidth > maxWidth && line) {
                        page.drawText(line, { x, y: currentY, size: textSize, font: textFont, color: kBlack });
                        linesDrawn++;
                        currentY -= lineHeight;
                        line = word;
                    } else {
                        line = testLine;
                    }
                }
                if (line) {
                    page.drawText(line, { x, y: currentY, size: textSize, font: textFont, color: kBlack });
                    linesDrawn++;
                }
                return linesDrawn;
            };

            // Draw fields within bounds (PDF y-axis is bottom-up, start from top)
            let y = bounds.y + bounds.height - lineHeight;

            for (const field of fields) {
                if (y < bounds.y) break;

                if (field === null) {
                    y -= sectionGap;
                    continue;
                }

                if ('radio' in field) {
                    const rX = valueColumnX;
                    const rCenterY = y + controlSize * 0.45;
                    const radius = controlSize * 0.4;

                    // Outer circle
                    page.drawCircle({
                        x: rX + radius,
                        y: rCenterY,
                        size: radius,
                        borderWidth: 0.4,
                        borderColor: kBlack,
                    });

                    // Filled dot if selected
                    if (field.selected) {
                        page.drawCircle({
                            x: rX + radius,
                            y: rCenterY,
                            size: radius * 0.5,
                            color: kBlack,
                        });
                    }

                    page.drawText(field.value, {
                        x: rX + radius * 2 + 2,
                        y,
                        size: fontSize,
                        font,
                        color: kBlack,
                    });
                } else if ('checkbox' in field) {
                    const cbX = valueColumnX;
                    const cbY = y + 0.5;

                    // Outer box (hairline stroke)
                    page.drawRectangle({
                        x: cbX,
                        y: cbY,
                        width: controlSize,
                        height: controlSize,
                        borderWidth: 0.3,
                        borderColor: kBlack,
                    });

                    // Checkmark as single SVG path (joined strokes)
                    // SVG Y-axis is top-down: 0=top, controlSize=bottom
                    if (field.checked) {
                        const s = controlSize;
                        page.drawSvgPath(
                            `M ${s * 0.15} ${s * 0.55} L ${s * 0.4} ${s * 0.85} L ${s * 0.85} ${s * 0.2}`,
                            {
                                x: cbX,
                                y: cbY + controlSize,
                                borderWidth: 0.6,
                                borderColor: kBlack,
                            },
                        );
                    }

                    page.drawText(field.value, {
                        x: cbX + controlSize + 2,
                        y,
                        size: fontSize,
                        font,
                        color: kBlack,
                    });
                } else {
                    // Standard label: value field
                    if (field.label) {
                        page.drawText(`${field.label}:`, {
                            x: bounds.x,
                            y,
                            size: labelFontSize,
                            font: boldFont,
                            color: kBlack,
                        });
                    }

                    const linesUsed = drawWrappedText(
                        field.value, valueColumnX, y, font, fontSize, maxValueWidth,
                    );
                    if (linesUsed > 1) {
                        y -= (linesUsed - 1) * lineHeight;
                    }
                }

                y -= lineHeight;
            }

            // Footer: indicate which intent this page was converted with
            const footerText = `Converted with: ${passes[pageIndex].label}`;
            const footerY = bounds.y;
            page.drawText(footerText, {
                x: bounds.x,
                y: footerY,
                size: labelFontSize,
                font: boldFont,
                color: kBlack,
            });
        }

        // Post-process: decalibrate and set output intent
        await this.#postProcessPages(docketDocument, iccProfileHeader);

        // Build stripped metadata (exclude profile base64 contents)
        const strippedMetadata = JSON.parse(metadataJSON);
        if (strippedMetadata.color?.profile?.contents) {
            delete strippedMetadata.color.profile.contents;
        }
        const strippedMetadataBuffer = new TextEncoder().encode(
            JSON.stringify(strippedMetadata, null, 2),
        ).buffer;

        PDFService.setOutputIntentForPDFDocument(docketDocument, {
            iccProfile: new Uint8Array(iccProfileBuffer),
            identifier: iccProfileHeader.description || `ICCBased_${iccProfileHeader.colorSpace}`,
            subType: 'GTS_PDFX',
        });
        await PDFService.attachManifestToPDFDocument(
            docketDocument, strippedMetadataBuffer, 'metadata.json',
        );

        return /** @type {ArrayBuffer} */ (
            (await docketDocument.save({
                addDefaultPage: false,
                updateFieldAppearances: false,
            })).buffer
        );
    }

    /**
     * Builds the metadata JSON string for the generation result.
     *
     * Field order is intentional for readability:
     *   1. testFormVersion, generatedAt — identification
     *   2. metadata — user-provided slugs data
     *   3. settings — all generator options selected on the page
     *   4. assembly — profile analysis results, rendering intents, filtered pages
     *   5. manifest — full manifest reference
     *   6. color — ICC profile header + base64 contents (large, last for readability)
     *
     * @param {TestFormManifest} manifest
     * @param {{ colorSpace: string, description: string }} iccProfileHeader
     * @param {ArrayBuffer} iccProfileBuffer
     * @param {UserMetadata | null} userMetadata
     * @param {import('./assembly-policy-resolver.js').AssemblyPlan} [assemblyPlan]
     * @returns {string}
     */
    #buildMetadataJSON(manifest, iccProfileHeader, iccProfileBuffer, userMetadata, assemblyPlan) {
        /** @satisfies {Parameters<uint8ArrayToBase64>[1]} */
        const base64Options = { 'alphabet': 'base64' };

        const environment = getEnvironmentDescriptor();

        return JSON.stringify({
            testFormVersion: this.#testFormVersion,
            generatedAt: new Date().toISOString(),
            runtime: {
                navigator: {
                    browser: `${environment.browser} ${environment.browserVersion}`,
                    os: environment.os,
                    userAgent: environment.userAgent,
                },
            },
            metadata: userMetadata ? { slugs: userMetadata } : undefined,
            settings: {
                debugging: this.#debugging,
                outputBitsPerComponent: this.#outputBitsPerComponent ?? 'auto',
                useWorkers: this.#useWorkers,
                processingStrategy: this.#processingStrategy,
                assemblyOverrides: this.#assemblyOverrides ?? null,
            },
            assembly: assemblyPlan ? {
                profileCategory: assemblyPlan.profileCategory,
                profileCategoryLabel: assemblyPlan.profileCategoryLabel,
                multiPDF: assemblyPlan.multiPDF,
                generationPasses: assemblyPlan.generationPasses.map(pass => ({
                    renderingIntent: pass.intentPass.renderingIntent,
                    blackPointCompensation: pass.intentPass.blackPointCompensation,
                    label: pass.intentPass.label,
                    pages: pass.manifest.pages.length,
                    layouts: pass.manifest.layouts.length,
                })),
            } : undefined,
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
