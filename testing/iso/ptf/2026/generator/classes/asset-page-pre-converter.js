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

    /** @type {import('../../classes/baseline/color-converter.js').RenderingIntent} */
    #renderingIntent;

    /** @type {boolean} */
    #blackPointCompensation;

    /** @type {number} */
    #interConversionDelay;

    /** @type {ArrayBuffer | null | undefined} */
    #defaultSourceProfileForDeviceRGB;

    /** @type {ArrayBuffer | null | undefined} */
    #defaultSourceProfileForDeviceCMYK;

    /** @type {ArrayBuffer | null | undefined} */
    #defaultSourceProfileForDeviceGray;

    /** @type {string[] | undefined} */
    #includedColorSpaceTypes;

    /** @type {string[] | undefined} */
    #excludedColorSpaceTypes;

    /** @type {boolean | undefined} */
    #useLegacyContentStreamParsing;

    /** @type {boolean | undefined} */
    #convertDeviceRGB;

    /** @type {boolean | undefined} */
    #convertDeviceCMYK;

    /** @type {boolean | undefined} */
    #convertDeviceGray;

    /** @type {boolean} */
    #convertImages;

    /** @type {boolean} */
    #convertContentStreams;

    /** @type {boolean} */
    #concurrentSubsets;

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
     * @param {import('../../classes/baseline/color-converter.js').RenderingIntent} [options.renderingIntent='relative-colorimetric'] - Rendering intent for color conversion
     * @param {boolean} [options.blackPointCompensation=true] - Enable blackpoint compensation
     * @param {boolean} [options.debugging=false]
     * @param {boolean} [options.useWorkers=false] - Enable worker-based color conversion (limited to 2 workers)
     * @param {number} [options.interConversionDelay=0] - Milliseconds to yield between conversion steps (browser responsiveness)
     * @param {ArrayBuffer | null} [options.defaultSourceProfileForDeviceRGB] - Default source profile for DeviceRGB
     * @param {ArrayBuffer | null} [options.defaultSourceProfileForDeviceCMYK] - Default source profile for DeviceCMYK
     * @param {ArrayBuffer | null} [options.defaultSourceProfileForDeviceGray] - Default source profile for DeviceGray
     * @param {string[]} [options.includedColorSpaceTypes] - PDF color space types to include for conversion
     * @param {string[]} [options.excludedColorSpaceTypes] - PDF color space types to exclude from conversion
     * @param {boolean} [options.useLegacyContentStreamParsing] - Use legacy regex-based content stream parsing (default: false)
     * @param {boolean} [options.convertDeviceRGB] - Convert DeviceRGB colors in content streams
     * @param {boolean} [options.convertDeviceCMYK] - Convert DeviceCMYK colors in content streams
     * @param {boolean} [options.convertDeviceGray] - Convert DeviceGray colors in content streams
     */
    constructor({ outputProfile, outputColorSpace, outputBitsPerComponent, colorSpaceResolver, renderingIntent = 'relative-colorimetric', blackPointCompensation = true, debugging = false, useWorkers = false, interConversionDelay = 0, defaultSourceProfileForDeviceRGB, defaultSourceProfileForDeviceCMYK, defaultSourceProfileForDeviceGray, includedColorSpaceTypes, excludedColorSpaceTypes, useLegacyContentStreamParsing, convertDeviceRGB, convertDeviceCMYK, convertDeviceGray, convertImages = true, convertContentStreams = true, concurrentSubsets = false }) {
        this.#outputProfile = outputProfile;
        this.#outputColorSpace = outputColorSpace;
        this.#outputBitsPerComponent = outputBitsPerComponent;
        this.#colorSpaceResolver = colorSpaceResolver;
        this.#renderingIntent = renderingIntent;
        this.#blackPointCompensation = blackPointCompensation;
        this.#debugging = debugging;
        this.#useWorkers = useWorkers;
        this.#interConversionDelay = interConversionDelay;
        /** @type {ArrayBuffer | null | undefined} */
        this.#defaultSourceProfileForDeviceRGB = defaultSourceProfileForDeviceRGB;
        /** @type {ArrayBuffer | null | undefined} */
        this.#defaultSourceProfileForDeviceCMYK = defaultSourceProfileForDeviceCMYK;
        /** @type {ArrayBuffer | null | undefined} */
        this.#defaultSourceProfileForDeviceGray = defaultSourceProfileForDeviceGray;
        /** @type {string[] | undefined} */
        this.#includedColorSpaceTypes = includedColorSpaceTypes;
        /** @type {string[] | undefined} */
        this.#excludedColorSpaceTypes = excludedColorSpaceTypes;
        /** @type {boolean | undefined} */
        this.#useLegacyContentStreamParsing = useLegacyContentStreamParsing;
        /** @type {boolean | undefined} */
        this.#convertDeviceRGB = convertDeviceRGB;
        /** @type {boolean | undefined} */
        this.#convertDeviceCMYK = convertDeviceCMYK;
        /** @type {boolean | undefined} */
        this.#convertDeviceGray = convertDeviceGray;
        /** @type {boolean} */
        this.#convertImages = convertImages;
        /** @type {boolean} */
        this.#convertContentStreams = convertContentStreams;
        /** @type {boolean} */
        this.#concurrentSubsets = concurrentSubsets;
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
            const workerCount = this.#concurrentSubsets ? 2 : 4;
            this.#workerPool = new WorkerPool({ workerCount });
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
            // Sequential mode (concurrentSubsets=false): 4 lanes — subsets run one
            // at a time with worker pool termination between them, so more lanes
            // means smaller subsets and more frequent WASM memory reclamation.
            // Concurrent mode (concurrentSubsets=true): 2 lanes — all subsets run
            // simultaneously, so fewer lanes reduces peak WASM instances.
            const maxLanes = this.#concurrentSubsets ? 2 : 4;
            const concurrency = this.#useWorkers
                ? Math.min(maxLanes, pageIndices.length)
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

            // Create a single shared ColorEngineProvider for all subsets in this
            // chain. This avoids 3 concurrent WASM instances (each ~877 MB) —
            // instead one WASM instance is shared. The provider is disposed
            // after the chain completes, and a fresh one is created for the
            // next chain.
            const { ColorEngineProvider } = await import('../../classes/baseline/color-engine-provider.js');
            const sharedProvider = new ColorEngineProvider();
            await sharedProvider.initialize();

            /** @type {import('../../classes/baseline/pdf-document-color-converter.js').PDFDocumentColorConverter[]} */
            const converters = subsets.map(subset =>
                new PDFDocumentColorConverterClass({
                    renderingIntent: this.#renderingIntent,
                    blackPointCompensation: this.#blackPointCompensation,
                    useAdaptiveBPCClamping: true,
                    destinationProfile: this.#outputProfile,
                    destinationColorSpace: /** @type {ColorType} */ (this.#outputColorSpace),
                    outputBitsPerComponent: this.#outputBitsPerComponent,
                    convertImages: this.#convertImages,
                    convertContentStreams: this.#convertContentStreams,
                    useWorkers: this.#useWorkers,
                    workerPool: this.#workerPool ?? undefined,
                    verbose: this.#debugging,
                    intermediateProfiles: group.intermediateProfiles,
                    pages: subset,
                    interConversionDelay: this.#interConversionDelay,
                    defaultSourceProfileForDeviceRGB: this.#defaultSourceProfileForDeviceRGB,
                    defaultSourceProfileForDeviceCMYK: this.#defaultSourceProfileForDeviceCMYK,
                    defaultSourceProfileForDeviceGray: this.#defaultSourceProfileForDeviceGray,
                    includedColorSpaceTypes: this.#includedColorSpaceTypes,
                    excludedColorSpaceTypes: this.#excludedColorSpaceTypes,
                    useLegacyContentStreamParsing: this.#useLegacyContentStreamParsing,
                    convertDeviceRGB: this.#convertDeviceRGB,
                    convertDeviceCMYK: this.#convertDeviceCMYK,
                    convertDeviceGray: this.#convertDeviceGray,
                }, { colorEngineProvider: sharedProvider })
            );

            // Track progress across concurrent converters.
            // JS is single-threaded so the shared counter is safe —
            // callbacks interleave at await points, never truly simultaneously.
            let chainPagesCompleted = 0;
            const chainTotalPages = group.tuples.length;

            try {
                /** @type {import('../../classes/baseline/pdf-document-color-converter.js').PDFDocumentColorConverterResult[]} */
                let results;

                /** @param {typeof converters[0]} c */
                const convertSubset = async (c) => {
                    try {
                        return await c.convertColor({ pdfDocument: document }, {
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
                        });
                    } finally {
                        c.dispose();
                    }
                };

                if (this.#concurrentSubsets) {
                    // Concurrent: all subsets run in parallel (current behavior).
                    // Higher peak memory — all WASM instances alive simultaneously.
                    await Promise.all(converters.map(c => c.ensureReady()));
                    results = await Promise.all(converters.map(convertSubset));
                } else {
                    // Sequential: subsets run one at a time. Each subset gets
                    // a fresh converter and worker pool. After each subset, the
                    // pool is terminated to free WASM memory, and a fresh pool
                    // is created for the next subset.
                    results = [];
                    for (let si = 0; si < subsets.length; si++) {
                        // Recreate pool for each subset (destroyed after previous)
                        if (this.#useWorkers && !this.#workerPool) {
                            const { WorkerPool } = await import('../../classes/baseline/worker-pool.js');
                            const workerCount = this.#concurrentSubsets ? 2 : 4;
                            this.#workerPool = new WorkerPool({ workerCount });
                            await this.#workerPool.initialize();
                        }

                        // Create a fresh converter with the live pool
                        const subsetConverter = new PDFDocumentColorConverterClass({
                            renderingIntent: this.#renderingIntent,
                            blackPointCompensation: this.#blackPointCompensation,
                            useAdaptiveBPCClamping: true,
                            destinationProfile: this.#outputProfile,
                            destinationColorSpace: /** @type {ColorType} */ (this.#outputColorSpace),
                            outputBitsPerComponent: this.#outputBitsPerComponent,
                            convertImages: this.#convertImages,
                            convertContentStreams: this.#convertContentStreams,
                            useWorkers: this.#useWorkers,
                            workerPool: this.#workerPool ?? undefined,
                            verbose: this.#debugging,
                            intermediateProfiles: group.intermediateProfiles,
                            pages: subsets[si],
                            interConversionDelay: this.#interConversionDelay,
                            defaultSourceProfileForDeviceRGB: this.#defaultSourceProfileForDeviceRGB,
                            defaultSourceProfileForDeviceCMYK: this.#defaultSourceProfileForDeviceCMYK,
                            defaultSourceProfileForDeviceGray: this.#defaultSourceProfileForDeviceGray,
                            includedColorSpaceTypes: this.#includedColorSpaceTypes,
                            excludedColorSpaceTypes: this.#excludedColorSpaceTypes,
                            useLegacyContentStreamParsing: this.#useLegacyContentStreamParsing,
                            convertDeviceRGB: this.#convertDeviceRGB,
                            convertDeviceCMYK: this.#convertDeviceCMYK,
                            convertDeviceGray: this.#convertDeviceGray,
                        }, { colorEngineProvider: sharedProvider });

                        results.push(await convertSubset(subsetConverter));

                        // Terminate workers between subsets to free WASM memory
                        if (this.#workerPool) {
                            this.#workerPool.terminate();
                            this.#workerPool = null;
                        }

                        // GC pressure + yield between subsets
                        {
                            let gcPressure = new ArrayBuffer(256 * 1024 * 1024);
                            gcPressure = /** @type {any} */ (null);
                        }
                        await new Promise(resolve => setTimeout(resolve, this.#interConversionDelay));
                    }
                }

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
                // Converters are disposed eagerly in the Promise.all callbacks above.
                // This is a safety net for error paths where convertColor throws
                // before reaching the finally in the per-converter wrapper.
                converters.forEach(c => c.dispose());

                // Dispose the shared ColorEngineProvider for this chain.
                // The next chain creates a fresh one with clean WASM memory.
                sharedProvider.dispose();

                // Terminate workers between chains to reclaim WASM memory.
                // Each worker's LittleCMS WASM instance grows to ~877 MB and
                // WebAssembly.Memory never shrinks. Terminating the workers
                // destroys their isolates and frees the WASM allocations.
                // The next chain creates a fresh pool with clean 32 MB instances.
                if (this.#workerPool) {
                    this.#workerPool.terminate();
                    this.#workerPool = null;
                }

                // GC pressure: allocate + release a large buffer to nudge JSC
                // into collecting the disposed WASM and TypedArray allocations.
                {
                    let gcPressure = new ArrayBuffer(256 * 1024 * 1024);
                    gcPressure = /** @type {any} */ (null);
                }
                await new Promise(resolve => setTimeout(resolve, this.#interConversionDelay));
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
