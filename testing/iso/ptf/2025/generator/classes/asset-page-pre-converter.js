// @ts-check
/**
 * AssetPagePreConverter — Batch asset color conversion before PDF assembly.
 *
 * Operates on a single document (the asset PDF). Groups asset pages by
 * conversion chain, copies only multi-chain pages (pages needed by more
 * than one chain), and runs one PDFDocumentColorConverter per chain using
 * the `pages` option for page-selective conversion. Pages appearing in
 * only one chain are converted in place (zero copies). Each converter
 * uses workers internally for parallel pixel processing.
 *
 * Conversion chains:
 * - Matching (asset colorSpace == layout colorSpace): source → output (no intermediate)
 * - Non-matching (asset != layout): source → layout → output (intermediate profile)
 * - SepK: passthrough (no conversion, page used as-is)
 *
 * @module AssetPagePreConverter
 * @author Saleh Abdel Motaal <dev@smotaal.io>
 * @ai Claude Opus 4.6 (code generation)
 */

import { PDFDocument } from '../../packages/pdf-lib/pdf-lib.esm.js';

import { CONTEXT_PREFIX } from '../../services/helpers/runtime.js';

/**
 * @typedef {import('../../classes/baseline/color-converter.js').ProfileType} ProfileType
 * @typedef {import('../../classes/baseline/color-converter.js').ColorType} ColorType
 * @typedef {import('./manifest-color-space-resolver.js').ManifestColorSpaceResolver} ManifestColorSpaceResolver
 * @typedef {import('./test-form-pdf-document-generator.js').TestFormManifest} TestFormManifest
 */

/**
 * Orchestrates batch asset page color conversion before PDF assembly.
 *
 * Works in a single document: original asset pages are converted in place
 * when they appear in only one chain. Pages shared across multiple chains
 * are self-copied (document.copyPages(document, ...)) before any conversion
 * starts, so each chain gets an independent object graph. When workers are
 * enabled, each chain's pages are split into concurrent subsets — multiple
 * PDFDocumentColorConverter instances run simultaneously on non-overlapping
 * page subsets, keeping the shared worker pool fed with image tasks.
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

    /** @type {boolean} */
    #useWorkers;

    /** @type {number} */
    #interConversionDelay;

    /** @type {import('../../classes/baseline/worker-pool.js').WorkerPool | null} */
    #workerPool = null;

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
     * @param {boolean} [options.useWorkers=false] - Enable worker-based color conversion (limited to 2 workers)
     * @param {number} [options.interConversionDelay=0] - Milliseconds to yield between conversion steps (browser responsiveness)
     */
    constructor({ outputProfile, outputColorSpace, outputBitsPerComponent, colorSpaceResolver, debugging = false, useWorkers = false, interConversionDelay = 0 }) {
        this.#outputProfile = outputProfile;
        this.#outputColorSpace = outputColorSpace;
        this.#outputBitsPerComponent = outputBitsPerComponent;
        this.#colorSpaceResolver = colorSpaceResolver;
        this.#debugging = debugging;
        this.#useWorkers = useWorkers;
        this.#interConversionDelay = interConversionDelay;
    }

    /**
     * Converts asset pages in place, grouped by conversion chain.
     *
     * Pages appearing in only one chain are converted in place (no copy).
     * Pages appearing in multiple chains are self-copied before any
     * conversion starts — one consumer gets the original, the rest get
     * independent copies. Passthrough (SepK) pages are never modified,
     * so they always use the original.
     *
     * After this method returns, `document.getPageCount()` includes the
     * original asset pages plus any copies appended for multi-chain pages.
     * The caller is responsible for removing them after layout assembly.
     *
     * @param {PDFDocument} document - The asset PDF (modified in place)
     * @param {TestFormManifest} manifest - Manifest with layouts/assets/colorSpaces
     * @param {(percent: number, message: string) => void | Promise<void>} [onProgress]
     * @returns {Promise<Map<string, number>>} Map from `"assetIndex|layoutColorSpace"` to page index in document
     */
    async convertAll(document, manifest, onProgress) {
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
                        `${CONTEXT_PREFIX} [AssetPagePreConverter] asset "${assetRef.asset}" (${assetRef.colorSpace}) not found in manifest assets`
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
                        `${CONTEXT_PREFIX} [AssetPagePreConverter] layout "${tuple.layoutColorSpace}" has no profile, ` +
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
            console.log(`${CONTEXT_PREFIX} [AssetPagePreConverter] conversion plan:`, {
                uniquePairs: uniqueTuples.size,
                chains: chainGroups.size,
                passthrough: passthroughTuples.length,
                chainDetails: [...chainGroups.entries()].map(
                    ([key, group]) => `${key}: ${group.tuples.length} pages`
                ),
            });
        }

        // ------------------------------------------------------------------
        // 4. Assign page indices: originals vs copies for multi-chain pages
        // ------------------------------------------------------------------
        // Each original asset page can be used in place by at most one
        // consumer. Additional consumers need independent copies made via
        // separate copyPages calls (to avoid the shared PDFRawStream bug).
        //
        // Priority: passthrough consumers get originals first (they don't
        // modify streams). Then the first conversion chain to claim a page
        // gets the original; remaining chains get copies.

        /** @type {Map<string, number>} */
        const pageMapping = new Map();

        // Track which original pages have been claimed by a conversion chain
        // (passthrough doesn't "claim" — it uses originals without modification).
        /** @type {Set<number>} */
        const originalClaimedByChain = new Set();

        // Identify which originals are used by passthrough (these must stay unmodified)
        /** @type {Set<number>} */
        const passthroughOriginals = new Set();

        // Passthrough tuples always use originals — no conversion, no modification
        for (const tuple of passthroughTuples) {
            passthroughOriginals.add(tuple.assetIndex);
            pageMapping.set(tuple.tupleKey, tuple.assetIndex);
        }

        // For each chain, decide which tuples use originals vs need copies.
        // Tuples needing copies are grouped by chain for separate copyPages calls.
        /** @type {Map<string, AssetTuple[]>} */
        const tuplesToCopyByChain = new Map();

        for (const [chainKey, group] of chainGroups) {
            for (const tuple of group.tuples) {
                if (passthroughOriginals.has(tuple.assetIndex)) {
                    // Passthrough owns this original — chain must use a copy
                    let list = tuplesToCopyByChain.get(chainKey);
                    if (!list) { list = []; tuplesToCopyByChain.set(chainKey, list); }
                    list.push(tuple);
                } else if (originalClaimedByChain.has(tuple.assetIndex)) {
                    // Another chain already claimed this original — this chain uses a copy
                    let list = tuplesToCopyByChain.get(chainKey);
                    if (!list) { list = []; tuplesToCopyByChain.set(chainKey, list); }
                    list.push(tuple);
                } else {
                    // This chain claims the original — convert in place
                    originalClaimedByChain.add(tuple.assetIndex);
                    pageMapping.set(tuple.tupleKey, tuple.assetIndex);
                }
            }
        }

        // ------------------------------------------------------------------
        // 4b. Self-copy multi-chain pages (before any conversion starts)
        // ------------------------------------------------------------------
        // CRITICAL: Each chain's copies must come from a separate copyPages
        // call. A single copyPages call deduplicates via ObjectCopier cache,
        // so copies from different chains would share PDFRawStream objects.
        // When one chain converts a stream in place, the other chain would
        // see the already-converted data instead of the original.

        for (const [chainKey, tuples] of tuplesToCopyByChain) {
            const indices = tuples.map(tuple => tuple.assetIndex);
            const copiedPages = await document.copyPages(document, indices);
            const baseIndex = document.getPageCount();

            for (let i = 0; i < copiedPages.length; i++) {
                document.addPage(copiedPages[i]);
                pageMapping.set(tuples[i].tupleKey, baseIndex + i);
            }
        }

        const totalCopies = [...tuplesToCopyByChain.values()].reduce((sum, list) => sum + list.length, 0);

        if (this.#debugging) {
            console.log(`${CONTEXT_PREFIX} [AssetPagePreConverter] page assignments:`, {
                originalPages: document.getPageCount() - totalCopies,
                copies: totalCopies,
                totalPages: document.getPageCount(),
            });
        }

        const allTupleCount = passthroughTuples.length
            + [...chainGroups.values()].reduce((sum, group) => sum + group.tuples.length, 0);

        // ------------------------------------------------------------------
        // 5. Run PDFDocumentColorConverters per conversion chain
        // ------------------------------------------------------------------
        // When workers are enabled, each chain's pages are split into
        // concurrent subsets. Multiple converters run simultaneously on
        // non-overlapping page subsets, keeping the shared worker pool
        // fed with image tasks from several pages at once.
        const PDFDocumentColorConverterClass = await this.#loadConverterClass();

        // Create a shared WorkerPool when workers are enabled.
        // All chain converters reuse this pool (passed via `workerPool` config).
        if (this.#useWorkers && !this.#workerPool) {
            const { WorkerPool } = await import('../../classes/baseline/worker-pool.js');
            this.#workerPool = new WorkerPool({ workerCount: 2 });
            await this.#workerPool.initialize();
        }

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
                    `${CONTEXT_PREFIX} [AssetPagePreConverter] chain "${chainKey}" \u2014 ${pageIndices.length} pages ` +
                    `[${pageIndices.join(', ')}]: ${chains[0]}`
                );
            }

            // Split pages into concurrent subsets for parallel processing.
            // Each subset gets its own PDFDocumentColorConverter; all share
            // the worker pool so images from different subsets fill idle workers.
            // Without workers, fall back to a single sequential converter.
            const concurrency = this.#useWorkers
                ? Math.min(3, pageIndices.length)
                : 1;
            const subsets = concurrency > 1
                ? splitIntoSubsets(pageIndices, concurrency)
                : [pageIndices];

            if (this.#debugging && concurrency > 1) {
                console.log(
                    `${CONTEXT_PREFIX} [AssetPagePreConverter] chain "${chainKey}" split into ${subsets.length} concurrent subsets: ` +
                    subsets.map((s, i) => `[${i}]: ${s.length} pages`).join(', ')
                );
            }

            /** @type {import('../../classes/baseline/pdf-document-color-converter.js').PDFDocumentColorConverter[]} */
            const converters = subsets.map(subset =>
                new PDFDocumentColorConverterClass({
                    renderingIntent: /** @type {any} */ ('preserve-k-only-relative-colorimetric-gcr'),
                    blackPointCompensation: true,
                    useAdaptiveBPCClamping: true,
                    destinationProfile: this.#outputProfile,
                    destinationColorSpace: /** @type {ColorType} */ (this.#outputColorSpace),
                    outputBitsPerComponent: this.#outputBitsPerComponent,
                    convertImages: true,
                    convertContentStreams: true,
                    useWorkers: this.#useWorkers,
                    workerPool: this.#workerPool ?? undefined,
                    verbose: this.#debugging,
                    intermediateProfiles: group.intermediateProfiles,
                    pages: subset,
                    interConversionDelay: this.#interConversionDelay,
                })
            );

            // Track progress across concurrent converters.
            // JS is single-threaded so the shared counter is safe —
            // callbacks interleave at await points, never truly simultaneously.
            let chainPagesCompleted = 0;
            const chainTotalPages = group.tuples.length;

            try {
                await Promise.all(converters.map(c => c.ensureReady()));

                const results = await Promise.all(
                    converters.map(c => c.convertColor({ pdfDocument: document }, {
                        onPageConverted: async () => {
                            chainPagesCompleted++;
                            const cumulativePages = processedPages + chainPagesCompleted;
                            await onProgress?.(
                                totalConvertiblePages > 0
                                    ? Math.floor(cumulativePages / totalConvertiblePages * 100)
                                    : 100,
                                `Converting "${chainKey}" \u2014 page ${chainPagesCompleted}/${chainTotalPages}`,
                            );
                        },
                    }))
                );

                processedPages += chainTotalPages;

                if (this.#debugging) {
                    const totals = results.reduce((accumulator, result) => ({
                        pagesProcessed: accumulator.pagesProcessed + result.pagesProcessed,
                        imagesConverted: accumulator.imagesConverted + result.imagesConverted,
                        contentStreamsConverted: accumulator.contentStreamsConverted + result.contentStreamsConverted,
                    }), { pagesProcessed: 0, imagesConverted: 0, contentStreamsConverted: 0 });

                    console.log(`${CONTEXT_PREFIX} [AssetPagePreConverter] chain "${chainKey}" completed:`, {
                        ...totals,
                        concurrency: converters.length,
                    });
                }
            } finally {
                converters.forEach(c => c.dispose());
            }
        }

        if (this.#debugging && passthroughTuples.length > 0) {
            console.log(
                `${CONTEXT_PREFIX} [AssetPagePreConverter] ${passthroughTuples.length} SepK pages passed through without conversion`
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
     * Releases resources including the shared WorkerPool (if created).
     */
    dispose() {
        if (this.#workerPool) {
            this.#workerPool.terminate();
            this.#workerPool = null;
        }
    }
}

/**
 * Splits an array into N roughly-equal subsets via round-robin distribution.
 *
 * @template T
 * @param {T[]} array
 * @param {number} n - Number of subsets (must be >= 1)
 * @returns {T[][]}
 */
function splitIntoSubsets(array, n) {
    const subsets = Array.from({ length: n }, () => /** @type {T[]} */ ([]));
    for (let i = 0; i < array.length; i++) {
        subsets[i % n].push(array[i]);
    }
    return subsets;
}
