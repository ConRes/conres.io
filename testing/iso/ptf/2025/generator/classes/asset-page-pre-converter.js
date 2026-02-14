// @ts-check
/**
 * AssetPagePreConverter — Batch asset color conversion before PDF assembly.
 *
 * Copies all needed asset pages into a target document, groups them by
 * conversion chain, and runs one PDFDocumentColorConverter per chain using
 * the `pages` option for page-selective conversion. Each converter uses
 * workers internally for parallel pixel processing.
 *
 * Conversion chains:
 * - Matching (asset colorSpace == layout colorSpace): source → output (no intermediate)
 * - Non-matching (asset != layout): source → layout → output (intermediate profile)
 * - SepK: passthrough (no conversion, page copied as-is)
 *
 * @module AssetPagePreConverter
 * @author Saleh Abdel Motaal <dev@smotaal.io>
 * @ai Claude Opus 4.6 (code generation)
 */

import { PDFDocument } from 'pdf-lib';

/**
 * @typedef {import('../../classes/baseline/color-converter.js').ProfileType} ProfileType
 * @typedef {import('../../classes/baseline/color-converter.js').ColorType} ColorType
 * @typedef {import('./manifest-color-space-resolver.js').ManifestColorSpaceResolver} ManifestColorSpaceResolver
 * @typedef {import('./test-form-pdf-document-generator.js').TestFormManifest} TestFormManifest
 */

/**
 * Orchestrates batch asset page color conversion before PDF assembly.
 *
 * All needed asset pages are copied into the target document and converted
 * in-place. Pages sharing the same conversion chain are converted in one
 * pass by a single PDFDocumentColorConverter instance (sequential converters,
 * parallel workers within each).
 */
export class AssetPagePreConverter {

    /** @type {ArrayBuffer} */
    #outputProfile;

    /** @type {string} */
    #outputColorSpace;

    /** @type {8 | 16 | undefined} */
    #outputBitsPerComponent;

    /** @type {ManifestColorSpaceResolver} */
    #colorSpaceResolver;

    /** @type {boolean} */
    #debugging;

    /**
     * Lazily loaded PDFDocumentColorConverter class.
     * @type {typeof import('../../classes/baseline/pdf-document-color-converter.js').PDFDocumentColorConverter | null}
     */
    #PDFDocumentColorConverterClass = null;

    /**
     * @param {object} options
     * @param {ArrayBuffer} options.outputProfile - User's destination ICC profile
     * @param {string} options.outputColorSpace - e.g., `'CMYK'`
     * @param {8 | 16 | undefined} [options.outputBitsPerComponent]
     * @param {ManifestColorSpaceResolver} options.colorSpaceResolver
     * @param {boolean} [options.debugging=false]
     */
    constructor({ outputProfile, outputColorSpace, outputBitsPerComponent, colorSpaceResolver, debugging = false }) {
        this.#outputProfile = outputProfile;
        this.#outputColorSpace = outputColorSpace;
        this.#outputBitsPerComponent = outputBitsPerComponent;
        this.#colorSpaceResolver = colorSpaceResolver;
        this.#debugging = debugging;
    }

    /**
     * Copies all needed asset pages into the target document and converts them
     * in batches grouped by conversion chain.
     *
     * Pages are added at the end of the target document. The caller is
     * responsible for removing them after assembly (via `removePage`).
     *
     * @param {PDFDocument} assetDocument - Source asset PDF
     * @param {TestFormManifest} manifest - Manifest with layouts/assets/colorSpaces
     * @param {PDFDocument} targetDocument - Document to copy asset pages into
     * @param {(percent: number, message: string) => void | Promise<void>} [onProgress]
     * @returns {Promise<Map<string, number>>} Map from `"assetIndex|layoutColorSpace"` to page index in targetDocument
     */
    async convertAll(assetDocument, manifest, targetDocument, onProgress) {
        // ------------------------------------------------------------------
        // 1. Build asset name → page index lookup
        // ------------------------------------------------------------------
        /** @type {Map<string, number>} */
        const assetNameIndex = new Map();
        for (let i = 0; i < manifest.assets.length; i++) {
            const entry = manifest.assets[i];
            assetNameIndex.set(`${entry.asset}|${entry.colorSpace}`, i);
        }

        // ------------------------------------------------------------------
        // 2. Scan all layouts for unique (assetIndex, assetColorSpace, layoutColorSpace) tuples
        // ------------------------------------------------------------------

        /**
         * @typedef {{
         *   tupleKey: string,
         *   assetIndex: number,
         *   assetColorSpace: string,
         *   layoutColorSpace: string,
         * }} AssetTuple
         */

        /** @type {Map<string, AssetTuple>} */
        const uniqueTuples = new Map();

        for (const layout of manifest.layouts) {
            for (const assetRef of layout.assets) {
                const nameKey = `${assetRef.asset}|${assetRef.colorSpace}`;
                const assetIdx = assetNameIndex.get(nameKey);
                if (assetIdx === undefined) {
                    console.warn(
                        `AssetPagePreConverter: asset "${assetRef.asset}" (${assetRef.colorSpace}) not found in manifest assets`
                    );
                    continue;
                }

                const tupleKey = `${assetIdx}|${layout.colorSpace}`;
                if (!uniqueTuples.has(tupleKey)) {
                    uniqueTuples.set(tupleKey, {
                        tupleKey,
                        assetIndex: assetIdx,
                        assetColorSpace: assetRef.colorSpace,
                        layoutColorSpace: layout.colorSpace,
                    });
                }
            }
        }

        // ------------------------------------------------------------------
        // 3. Determine conversion chain per tuple and group by chain
        // ------------------------------------------------------------------

        /**
         * @typedef {{
         *   intermediateProfiles: ProfileType[],
         *   tuples: AssetTuple[],
         * }} ChainGroup
         */

        /** @type {Map<string, ChainGroup>} */
        const chainGroups = new Map();
        /** @type {AssetTuple[]} */
        const passthroughTuples = [];

        for (const tuple of uniqueTuples.values()) {
            const assetType = this.#colorSpaceResolver.getColorSpaceType(tuple.assetColorSpace);

            // SepK/DeviceN → passthrough (no conversion)
            if (assetType === 'DeviceN') {
                passthroughTuples.push(tuple);
                continue;
            }

            const isMatching = tuple.assetColorSpace.toLowerCase() === tuple.layoutColorSpace.toLowerCase();

            /** @type {ProfileType[]} */
            let intermediateProfiles = [];
            let chainKey = 'direct';

            if (!isMatching) {
                const layoutProfile = await this.#colorSpaceResolver.resolveProfile(tuple.layoutColorSpace);
                if (layoutProfile !== null) {
                    intermediateProfiles = [layoutProfile];
                    chainKey = `intermediate:${tuple.layoutColorSpace}`;
                } else {
                    console.warn(
                        `AssetPagePreConverter: layout "${tuple.layoutColorSpace}" has no profile, ` +
                        `skipping intermediate for asset ${tuple.assetIndex}`
                    );
                }
            }

            let group = chainGroups.get(chainKey);
            if (!group) {
                group = { intermediateProfiles, tuples: [] };
                chainGroups.set(chainKey, group);
            }
            group.tuples.push(tuple);
        }

        if (this.#debugging) {
            console.log('AssetPagePreConverter: conversion plan:', {
                uniquePairs: uniqueTuples.size,
                chains: chainGroups.size,
                passthrough: passthroughTuples.length,
                chainDetails: [...chainGroups.entries()].map(
                    ([key, group]) => `${key}: ${group.tuples.length} pages`
                ),
            });
        }

        // ------------------------------------------------------------------
        // 4. Copy asset pages into target document
        // ------------------------------------------------------------------
        // CRITICAL: Each chain group must get its own `copyPages` call.
        // A single `copyPages` call deduplicates internal objects via its
        // ObjectCopier cache — if the same source page appears for multiple
        // chains (e.g., asset 3 for both sRGB and sGray layouts), the
        // copies share the SAME PDFRawStream objects. When one chain
        // converts a stream in-place, the other chain sees the already-
        // converted data instead of the original. Separate calls ensure
        // each chain gets truly independent copies.
        /** @type {Map<string, number>} */
        const pageMapping = new Map();

        /**
         * Copy a batch of tuples into the target document via a fresh
         * `copyPages` call (independent object graph per batch).
         * @param {AssetTuple[]} tuples
         */
        const copyBatch = async (tuples) => {
            if (tuples.length === 0) return;
            const indices = tuples.map(tuple => tuple.assetIndex);
            const copiedPages = await targetDocument.copyPages(assetDocument, indices);
            const baseIndex = targetDocument.getPageCount();
            for (let i = 0; i < copiedPages.length; i++) {
                targetDocument.addPage(copiedPages[i]);
                pageMapping.set(tuples[i].tupleKey, baseIndex + i);
            }
        };

        // Passthrough pages first (SepK — no conversion needed)
        await copyBatch(passthroughTuples);

        // Then each chain group separately
        for (const group of chainGroups.values()) {
            await copyBatch(group.tuples);
        }

        const allTupleCount = passthroughTuples.length
            + [...chainGroups.values()].reduce((sum, group) => sum + group.tuples.length, 0);

        // ------------------------------------------------------------------
        // 5. Run one PDFDocumentColorConverter per conversion chain
        // ------------------------------------------------------------------
        const PDFDocumentColorConverterClass = await this.#loadConverterClass();

        let processedPages = 0;
        const totalConvertiblePages = allTupleCount - passthroughTuples.length;

        for (const [chainKey, group] of chainGroups) {
            const pageIndices = group.tuples.map(tuple => {
                const idx = pageMapping.get(tuple.tupleKey);
                if (idx === undefined) throw new Error(`Missing page mapping for "${tuple.tupleKey}"`);
                return idx;
            });

            if (this.#debugging) {
                const chains = group.tuples.map(tuple => {
                    const isMatching = tuple.assetColorSpace.toLowerCase() === tuple.layoutColorSpace.toLowerCase();
                    return isMatching
                        ? `${tuple.assetColorSpace} \u2192 ${this.#outputColorSpace}`
                        : `${tuple.assetColorSpace} \u2192 ${tuple.layoutColorSpace} \u2192 ${this.#outputColorSpace}`;
                });
                console.log(
                    `AssetPagePreConverter: chain "${chainKey}" \u2014 ${pageIndices.length} pages ` +
                    `[${pageIndices.join(', ')}]: ${chains[0]}`
                );
            }

            const converter = new PDFDocumentColorConverterClass({
                renderingIntent: /** @type {any} */ ('preserve-k-only-relative-colorimetric-gcr'),
                blackPointCompensation: true,
                useAdaptiveBPCClamping: true,
                destinationProfile: this.#outputProfile,
                destinationColorSpace: /** @type {ColorType} */ (this.#outputColorSpace),
                outputBitsPerComponent: this.#outputBitsPerComponent,
                convertImages: true,
                convertContentStreams: true,
                useWorkers: true,
                verbose: this.#debugging,
                intermediateProfiles: group.intermediateProfiles,
                pages: pageIndices,
            });

            try {
                await converter.ensureReady();
                const result = await converter.convertColor({ pdfDocument: targetDocument }, {
                    onPageConverted: async (pagesCompleted, _totalPagesInChain) => {
                        const cumulativePages = processedPages + pagesCompleted;
                        await onProgress?.(
                            totalConvertiblePages > 0
                                ? Math.floor(cumulativePages / totalConvertiblePages * 100)
                                : 100,
                            `Converting "${chainKey}" \u2014 page ${pagesCompleted}/${group.tuples.length}`,
                        );
                    },
                });

                processedPages += group.tuples.length;

                if (this.#debugging) {
                    console.log(`AssetPagePreConverter: chain "${chainKey}" completed:`, {
                        pagesProcessed: result.pagesProcessed,
                        imagesConverted: result.imagesConverted,
                        contentStreamsConverted: result.contentStreamsConverted,
                    });
                }
            } finally {
                converter.dispose();
            }
        }

        if (this.#debugging && passthroughTuples.length > 0) {
            console.log(
                `AssetPagePreConverter: ${passthroughTuples.length} SepK pages passed through without conversion`
            );
        }

        return pageMapping;
    }

    /**
     * Lazy-loads the PDFDocumentColorConverter class.
     *
     * @returns {Promise<typeof import('../../classes/baseline/pdf-document-color-converter.js').PDFDocumentColorConverter>}
     */
    async #loadConverterClass() {
        if (!this.#PDFDocumentColorConverterClass) {
            const module = await import('../../classes/baseline/pdf-document-color-converter.js');
            this.#PDFDocumentColorConverterClass = module.PDFDocumentColorConverter;
        }
        return this.#PDFDocumentColorConverterClass;
    }

    /**
     * Releases resources. No-op in batch mode (converters are created and
     * disposed within `convertAll`).
     */
    dispose() {
        // Nothing to clean up — converters are created and disposed per-chain in convertAll
    }
}
