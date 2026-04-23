// @ts-check
/**
 * PDF Content Stream Color Converter
 *
 * Extends LookupTableColorConverter to handle PDF content stream color operations.
 * Parses content streams, extracts color operations, converts colors, and rebuilds
 * the stream with converted values.
 *
 * @module PDFContentStreamColorConverter
 */

import { LookupTableColorConverter } from './lookup-table-color-converter.js';
import { TraditionalPostScriptColorConverter } from './traditional-postscript-color-converter.js';
import { CONTEXT_PREFIX } from '../../services/helpers/runtime.js';
import { tokenize, tokenizeFromAsync, transformFromAsync, OE, OPERATOR_PATTERN } from './pdf-content-stream-parser.js';
import { createInterpreter, collectOperations } from './pdf-content-stream-interpreter.js';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Color space definition for Lab range.
 * @typedef {{
 *   colorSpaceType?: string,
 *   range?: number[],
 * }} ColorSpaceDefinition
 */

/**
 * Configuration for PDFContentStreamColorConverter.
 *
 * @typedef {import('./lookup-table-color-converter.js').LookupTableColorConverterConfiguration & {
 *   sourceRGBProfile?: ArrayBuffer,
 *   sourceGrayProfile?: ArrayBuffer,
 *   colorSpaceDefinitions?: Record<string, import('./pdf-document-color-converter.js').PDFColorSpaceDefinition>,
 *   labColorSpaceName?: string,
 *   useLegacyContentStreamParsing?: boolean,
 *   defaultSourceProfileForDeviceRGB?: ArrayBuffer | null,
 *   defaultSourceProfileForDeviceCMYK?: ArrayBuffer | null,
 *   defaultSourceProfileForDeviceGray?: ArrayBuffer | null,
 *   convertDeviceRGB?: boolean,
 *   convertDeviceCMYK?: boolean,
 *   convertDeviceGray?: boolean,
 *   experimentalPaintOpInsertion?: boolean,
 *   pdfX4CompliantOutput?: boolean,
 * }} PDFContentStreamColorConverterConfiguration
 */

/**
 * Color space state for tracking context across content streams.
 *
 * PDF content streams on a page share graphics state, so color space
 * set in one stream carries over to the next.
 *
 * @typedef {{
 *   strokeColorSpace?: string,
 *   fillColorSpace?: string,
 * }} ColorSpaceState
 */

/**
 * Input data for content stream conversion.
 *
 * @typedef {{
 *   streamRef: any,
 *   streamText: string,
 *   colorSpaceDefinitions?: Record<string, import('./pdf-document-color-converter.js').PDFColorSpaceDefinition>,
 *   initialColorSpaceState?: ColorSpaceState,
 *   labColorSpaceName?: string,
 * }} PDFContentStreamColorConverterInput
 */

/**
 * Result of content stream conversion.
 *
 * @typedef {{
 *   streamRef: any,
 *   originalText: string,
 *   newTextSegments: Iterable<string> | null,
 *   newTextLength: number,
 *   replacementCount: number,
 *   colorConversions: number,
 *   cacheHits: number,
 *   deviceColorCount: number,
 *   finalColorSpaceState: ColorSpaceState,
 * }} PDFContentStreamColorConverterResult
 */

/**
 * Result of streaming content stream conversion.
 * Returns compressed output bytes directly — no intermediate full string.
 *
 * @typedef {{
 *   streamRef: any,
 *   compressedOutput: Uint8Array,
 *   replacementCount: number,
 *   colorConversions: number,
 *   deviceColorCount: number,
 *   finalColorSpaceState: ColorSpaceState,
 * }} PDFContentStreamStreamingResult
 */

/**
 * Parsed color operation from content stream.
 * @typedef {{
 *   type: 'gray' | 'rgb' | 'cmyk' | 'colorspace' | 'indexed' | 'string' | 'head',
 *   operator?: string,
 *   values?: number[],
 *   name?: string,
 *   colorSpaceName?: string,
 *   raw?: string,
 *   index: number,
 *   length: number,
 * }} ParsedColorOperation
 */

// ============================================================================
// Constants
// ============================================================================

// Content stream processing modes (controlled by `useLegacyContentStreamParsing` option):
//
// Default (useLegacyContentStreamParsing=false):
//   Uses the streaming pipeline — compressed content stream bytes flow through
//   DecompressionStream → tokenize transform (regex on chunks) → substitute
//   operators → CompressionStream. No full decompressed string is materialized.
//   This prevents Safari/JSC OOM on large content streams (125+ MB decompressed)
//   where contiguous string allocation fails.
//
//   Tokenizer: pdf-content-stream-parser.js (Layer 1)
//   Interpreter: pdf-content-stream-interpreter.js (Layer 2)
//
// Legacy (useLegacyContentStreamParsing=true):
//   Original monolithic regex with chunked matchAll. Decompresses to full string,
//   parses, converts, and recompresses. Preserved for diagnostic comparison.
//   Uses LEGACY_COLOR_OPERATOR_REGEX and legacyMatchAll below.

/**
 * Legacy regex for matching PDF content stream color operators.
 * Used when `useLegacyContentStreamParsing` is true.
 * @type {RegExp}
 */
const LEGACY_COLOR_OPERATOR_REGEX = /(?<head>[^(]*?)(?:(?:(?<=[\s\n]|^)(?<name>\/\w+)\s+(?<csOp>CS|cs)\b)|(?:(?<=[\s\n]|^)(?<name2>\/\w+)\s+(?<scnOp>SCN|scn)\b)|(?:(?<=[\s\n]|^)(?<gray>(?:\d+\.?\d*|\.\d+))\s+(?<gOp>G|g)\b)|(?:(?<=[\s\n]|^)(?<cmyk>(?:\d+\.?\d*|\.\d+)\s+(?:\d+\.?\d*|\.\d+)\s+(?:\d+\.?\d*|\.\d+)\s+(?:\d+\.?\d*|\.\d+))\s+(?<kOp>K|k)\b)|(?:(?<=[\s\n]|^)(?<rgb>(?:\d+\.?\d*|\.\d+)\s+(?:\d+\.?\d*|\.\d+)\s+(?:\d+\.?\d*|\.\d+))\s+(?<rgOp>RG|rg)\b)|(?:(?<=[\s\n]|^)(?<n>(?:\d+\.?\d*|\.\d+)(?:\s+(?:\d+\.?\d*|\.\d+))*)\s+(?<scOp>SC|sc|SCN|scn)\b)|(?:\((?<string>[^)]*)\))|\s*$)/ug;

/**
 * Legacy chunked matchAll generator for large content stream strings.
 *
 * Firefox's regex engine returns null on strings exceeding ~128 MB.
 * This generator splits the input into ~5 MB chunks at space boundaries
 * and yields matches with indices adjusted to original string positions.
 * For strings under the limit, delegates directly to `String.prototype.matchAll`.
 *
 * @param {string} string - The content stream text
 * @param {RegExp} regex - The regex pattern (must have the `g` flag)
 * @yields {RegExpMatchArray} Match objects with corrected `index` values
 */
function* legacyMatchAll(string, regex) {
    const CHUNK_LIMIT = 5 * 1024 * 1024;

    if (string.length <= CHUNK_LIMIT) {
        yield* string.matchAll(regex);
        return;
    }

    let offset = 0;

    while (offset < string.length) {
        let end = Math.min(offset + CHUNK_LIMIT, string.length);

        if (end < string.length) {
            const lastSpace = string.lastIndexOf(' ', end - 1);
            if (lastSpace > offset) {
                end = lastSpace + 1;
            }
        }

        for (const match of string.slice(offset, end).matchAll(regex)) {
            match.index += offset;
            yield match;
        }

        offset = end;
    }
}

// ============================================================================
// PDFContentStreamColorConverter Class
// ============================================================================

/**
 * Converts colors in PDF content streams.
 *
 * Extends LookupTableColorConverter with content stream parsing:
 * - Parses color operations from stream text
 * - Converts RGB and Gray colors to destination color space
 * - Rebuilds stream with converted color values
 * - Caches repeated color conversions
 *
 * Supported color operators:
 * - G/g: DeviceGray stroke/fill
 * - RG/rg: DeviceRGB stroke/fill
 * - K/k: DeviceCMYK stroke/fill (passed through)
 * - CS/cs: Color space selection
 * - SC/sc/SCN/scn: Color setting with current color space
 *
 * @extends LookupTableColorConverter
 * @example
 * ```javascript
 * const converter = new PDFContentStreamColorConverter({
 *     renderingIntent: 'relative-colorimetric',
 *     blackPointCompensation: true,
 *     useAdaptiveBPCClamping: false,
 *     destinationProfile: cmykProfileBuffer,
 *     destinationColorSpace: 'CMYK',
 *     useLookupTable: true,
 *     sourceRGBProfile: sRGBProfileBuffer,
 *     sourceGrayProfile: sGrayProfileBuffer,
 *     verbose: false,
 * });
 *
 * const result = await converter.convertColor({
 *     streamRef: contentStreamRef,
 *     streamText: '1 0 0 rg 100 100 50 50 re f',
 * });
 * // result.newTextSegments is a generator of string segments (or null if unchanged)
 * // result.newTextLength is the total output length
 * ```
 */
export class PDFContentStreamColorConverter extends LookupTableColorConverter {
    /**
     * Lazily-constructed `TraditionalPostScriptColorConverter`, used when
     * a Device operator (`g/G`, `rg/RG`, `k/K`) needs conversion and no
     * resolved ICC profile is available. Composed — not instantiated by
     * the worker entrypoint.
     *
     * @type {TraditionalPostScriptColorConverter | null}
     */
    #tps = null;

    // ========================================
    // Constructor
    // ========================================

    /**
     * Creates a new PDFContentStreamColorConverter instance.
     *
     * @param {PDFContentStreamColorConverterConfiguration} configuration - Immutable configuration
     * @param {object} [options={}] - Additional options
     * @param {import('../../services/ColorEngineService.js').ColorEngineService} [options.colorEngineService] - Shared service
     */
    constructor(configuration, options = {}) {
        super(configuration, options);
    }

    /**
     * Lazy TPS accessor. Shares this converter's colorEngineProvider so the
     * TPS base class resolves `#ready` immediately (TPS doesn't use the engine).
     *
     * @returns {TraditionalPostScriptColorConverter}
     */
    #getTPS() {
        if (!this.#tps) {
            const config = this.configuration;
            this.#tps = new TraditionalPostScriptColorConverter(
                {
                    renderingIntent: config.renderingIntent,
                    blackPointCompensation: config.blackPointCompensation,
                    useAdaptiveBPCClamping: config.useAdaptiveBPCClamping,
                    destinationColorSpace: config.destinationColorSpace,
                    verbose: config.verbose,
                },
                { colorEngineProvider: this.colorEngineProvider ?? undefined },
            );
        }
        return this.#tps;
    }

    // ========================================
    // Configuration Access
    // ========================================

    /**
     * Gets the configuration as PDFContentStreamColorConverterConfiguration.
     * @returns {Readonly<PDFContentStreamColorConverterConfiguration>}
     */
    get configuration() {
        return /** @type {Readonly<PDFContentStreamColorConverterConfiguration>} */ (super.configuration);
    }

    /**
     * Gets source RGB profile.
     * @returns {ArrayBuffer | string | undefined}
     */
    get sourceRGBProfile() {
        return this.configuration.sourceRGBProfile;
    }

    /**
     * Gets source Gray profile.
     * @returns {ArrayBuffer | string | undefined}
     */
    get sourceGrayProfile() {
        return this.configuration.sourceGrayProfile;
    }

    // ========================================
    // Rendering Intent Handling
    // ========================================

    /**
     * Gets effective rendering intent for a color type.
     *
     * K-Only GCR doesn't work for:
     * Returns the configured rendering intent unchanged. Intent overrides
     * (e.g., K-Only GCR → Relative Colorimetric for non-CMYK destinations)
     * are handled by policy rules in color-conversion-rules.json.
     *
     * @param {'RGB' | 'Gray' | 'Lab'} _colorType - Input color type (unused — policy handles overrides)
     * @returns {import('./color-converter.js').RenderingIntent} Configured rendering intent
     */
    getEffectiveRenderingIntent(_colorType) {
        return this.configuration.renderingIntent;
    }

    // ========================================
    // Main Conversion Method
    // ========================================

    /**
     * Converts colors in a PDF content stream.
     *
     * Parses color operations from stream text, converts RGB and Gray colors
     * to the destination color space, and rebuilds the stream with converted values.
     *
     * @param {PDFContentStreamColorConverterInput} input - Content stream to convert
     * @param {import('./color-converter.js').ColorConverterContext} [context={}] - Conversion context
     * @returns {Promise<PDFContentStreamColorConverterResult>}
     */
    async convertColor(input, context = {}) {
        await this.ensureReady();

        const { streamRef, streamText, colorSpaceDefinitions, initialColorSpaceState } = input;
        const config = this.configuration;

        if (config.verbose) {
            console.log(`${CONTEXT_PREFIX} [PDFContentStreamColorConverter] Processing stream ${streamRef}`);
            console.log(`${CONTEXT_PREFIX}   Stream length: ${streamText.length} characters`);
        }

        // Parse color operations, passing initial state from previous stream
        const parseSpan = this.diagnostics.startSpan('parse', {
            ref: String(streamRef),
            streamLength: streamText.length,
        });
        /** @type {{ operations: ParsedColorOperation[], finalState: import('./pdf-content-stream-color-converter.js').ColorSpaceState }} */
        let parseResult;
        try {
            parseResult = this.parseContentStream(streamText, initialColorSpaceState);
            this.diagnostics.updateSpan(parseSpan, {
                operations: parseResult.operations.length,
            });
        } finally {
            this.diagnostics.endSpan(parseSpan);
        }
        const { operations, finalState } = parseResult;

        if (config.verbose) {
            console.log(`${CONTEXT_PREFIX}   Found ${operations.length} color operations`);
        }

        // Separate Device* colors (not converted) from ICCBased/Lab colors (converted)
        // Device* colors use direct operators (rg/RG/g/G) without named color space context
        const deviceColors = operations.filter((/** @type {ParsedColorOperation} */ op) =>
            op.type === 'rgb' || op.type === 'gray'
        );

        // ICCBased and Lab colors use named color spaces (via SC/sc/SCN/scn)
        const toConvert = operations.filter((/** @type {ParsedColorOperation} */ op) => {
            if (op.type === 'indexed' && op.values && op.colorSpaceName) {
                // Check if the color space is convertible (ICCBased or Lab)
                const csDef = colorSpaceDefinitions?.[op.colorSpaceName];
                if (csDef) {
                    const csType = csDef.colorSpaceType;
                    return csType === 'ICCBasedGray' || csType === 'ICCBasedRGB' || csType === 'Lab';
                }
            }
            return false;
        });

        if (config.verbose && deviceColors.length > 0) {
            console.log(`${CONTEXT_PREFIX}   Skipping ${deviceColors.length} Device* color operations (no ICC profile)`);
        }

        if (toConvert.length === 0) {
            return {
                streamRef,
                originalText: streamText,
                newTextSegments: null,
                newTextLength: streamText.length,
                replacementCount: 0,
                colorConversions: 0,
                cacheHits: 0,
                deviceColorCount: deviceColors.length,
                finalColorSpaceState: finalState,
            };
        }

        // Build lookup inputs from operations
        // All operations in toConvert are 'indexed' type with validated color space (ICCBased or Lab)
        const lookupInputs = toConvert.map(op => {
            // Map PDF color space type to non-PDF color model for the super class
            const csDef = colorSpaceDefinitions?.[/** @type {string} */ (op.colorSpaceName)];
            const csType = csDef?.colorSpaceType;

            /** @type {'RGB' | 'Gray' | 'Lab'} */
            let colorSpace;
            if (csType === 'ICCBasedRGB') {
                colorSpace = 'RGB';
            } else if (csType === 'ICCBasedGray') {
                colorSpace = 'Gray';
            } else if (csType === 'Lab') {
                colorSpace = 'Lab';
            } else {
                // This should never happen since filter already validated colorSpaceType
                throw new Error(`Unexpected colorSpaceType: ${csType} for color space ${op.colorSpaceName}`);
            }

            // Get the ICC profile from the color space definition (extracted from PDF)
            // Lab uses built-in profile, so sourceProfile is not required
            /** @type {ArrayBuffer | undefined} */
            const sourceProfile = csDef?.sourceProfile;

            return {
                colorSpace,
                values: op.values || [],
                sourceProfile,
            };
        });

        // Extract unique colors for efficient batch conversion
        const uniqueInputs = this.#deduplicateInputs(lookupInputs);

        // Build lookup table with single SIMD batch call
        const convertSpan = this.diagnostics.startSpan('convert', {
            ref: String(streamRef),
            totalColors: toConvert.length,
            uniqueColors: uniqueInputs.length,
        });
        /** @type {Map<string, number[]>} */
        let lookupTable;
        try {
            lookupTable = await this.buildLookupTable(uniqueInputs, context);
            this.diagnostics.updateSpan(convertSpan, {
                lookupTableSize: lookupTable.size,
            });
        } finally {
            this.diagnostics.endSpan(convertSpan);
        }

        // Apply lookup table to all operations
        const lookupResults = lookupInputs.map(input => {
            const converted = this.applyLookupTable(lookupTable, input);
            return {
                colorSpace: this.configuration.destinationColorSpace,
                values: converted ?? [],
                cacheHit: lookupTable.has(`${input.colorSpace}:${input.values.join(',')}`),
            };
        });

        // Build replacement map
        const replacements = toConvert.map((op, i) => ({
            operation: op,
            convertedValues: lookupResults[i].values,
            cacheHit: lookupResults[i].cacheHit,
        }));

        // Rebuild content stream with converted values
        const rebuildSpan = this.diagnostics.startSpan('rebuild', {
            ref: String(streamRef),
            replacements: replacements.length,
        });
        /** @type {{ segments: Generator<string, void, unknown> | null, totalLength: number, finalColorSpaceState: ColorSpaceState }} */
        let rebuildResult;
        try {
            rebuildResult = this.rebuildContentStream(streamText, replacements, initialColorSpaceState, input.labColorSpaceName);
            this.diagnostics.updateSpan(rebuildSpan, {
                originalLength: streamText.length,
                newLength: rebuildResult.totalLength,
            });
        } finally {
            this.diagnostics.endSpan(rebuildSpan);
        }

        const cacheHits = lookupResults.filter(r => r.cacheHit).length;

        return {
            streamRef,
            originalText: streamText,
            newTextSegments: rebuildResult.segments,
            newTextLength: rebuildResult.totalLength,
            replacementCount: replacements.length,
            colorConversions: replacements.length,
            cacheHits,
            deviceColorCount: deviceColors.length,
            // Use ORIGINAL final state from parsing for passing to next stream
            // (not the converted state which would have Lab as the current color space)
            finalColorSpaceState: finalState,
        };
    }

    // ========================================
    // Streaming Conversion (compressed → compressed)
    // ========================================

    /**
     * Converts colors in a PDF content stream using a single-pass streaming pipeline.
     *
     * Input: compressed content stream bytes (FlateDecode Uint8Array)
     * Output: compressed content stream bytes with color operators substituted
     *
     * The decompressed string never exists as a single allocation. The pipeline:
     *   DecompressionStream → Latin-1 decode chunks →
     *   tokenizeFromAsync (markup parser Layer 1) →
     *   interpretGraphicsState (Layer 2) →
     *   convert operators on-the-fly (single pass, no batch) →
     *   Latin-1 encode → CompressionStream
     *
     * Single-pass was chosen over two-pass because benchmarks on real data show
     * it is 2x faster — the second decompression pass dominates cost, while
     * per-operator ICC conversion is microseconds (transforms are cached).
     *
     * Uses tokenizeFromAsync and createInterpreter from the parser/interpreter
     * modules — no duplicated regex logic.
     *
     * @param {{
     *   streamRef: any,
     *   compressedContents: Uint8Array,
     *   colorSpaceDefinitions?: Record<string, import('./pdf-document-color-converter.js').PDFColorSpaceDefinition>,
     *   initialColorSpaceState?: ColorSpaceState,
     * }} input
     * @param {import('./color-converter.js').ColorConverterContext} [context={}]
     * @returns {Promise<PDFContentStreamStreamingResult>}
     */
    async convertColorStreaming(input, context = {}) {
        await this.ensureReady();

        const { streamRef, compressedContents, colorSpaceDefinitions, initialColorSpaceState = {} } = input;

        // ── Effective Device conversion flags ──
        // When pdfX4CompliantOutput is true, Device color spaces that don't
        // match the output intent must be converted. The explicit convertDevice*
        // flags take precedence; pdfX4CompliantOutput provides the fallback.
        //
        // RGB output:  DeviceGray and DeviceCMYK must convert (DeviceRGB is native)
        // CMYK output: DeviceRGB must convert (DeviceGray and DeviceCMYK are permitted)
        // Gray output: DeviceRGB and DeviceCMYK must convert (DeviceGray is native)
        const config = /** @type {PDFContentStreamColorConverterConfiguration} */ (this.configuration);
        const effectiveConvertDeviceRGB = config.convertDeviceRGB ?? (config.pdfX4CompliantOutput && (config.destinationColorSpace === 'CMYK' || config.destinationColorSpace === 'Gray'));
        const effectiveConvertDeviceGray = config.convertDeviceGray ?? (config.pdfX4CompliantOutput && config.destinationColorSpace === 'RGB');
        const effectiveConvertDeviceCMYK = config.convertDeviceCMYK ?? (config.pdfX4CompliantOutput && (config.destinationColorSpace === 'RGB' || config.destinationColorSpace === 'Gray'));

        // ── Early exit: check if any conversion is needed ──
        // Skip the decompress/tokenize/recompress pipeline if:
        // 1. No named color spaces are convertible (no ICCBased or Lab), AND
        // 2. No Device color conversion is enabled (convertDevice* flags)
        //
        // Device colors (g/G, rg/RG, k/K) are direct operators with no named
        // color space entry. The convertDevice* flags (not the profile fields)
        // determine whether they need conversion. The profile fields determine
        // the conversion method (ICC via profile or PostScript math if null).
        const hasConvertibleNamedColorSpaces = colorSpaceDefinitions
                ? Object.values(colorSpaceDefinitions).some(def => {
                    const csType = def.colorSpaceType;
                    return csType === 'ICCBasedGray' || csType === 'ICCBasedRGB' || csType === 'ICCBasedCMYK' || csType === 'Lab';
                })
                : false;

            const hasDeviceColorConversion =
                effectiveConvertDeviceRGB === true ||
                effectiveConvertDeviceCMYK === true ||
                effectiveConvertDeviceGray === true;

            const needsPrologue = config.experimentalPaintOpInsertion &&
                (config.destinationColorSpace === 'RGB' || config.destinationColorSpace === 'CMYK');
            if (!hasConvertibleNamedColorSpaces && !hasDeviceColorConversion && !needsPrologue) {
                if (config.verbose) {
                    console.log(`${CONTEXT_PREFIX} [PDFContentStreamColorConverter] Streaming early exit for ${streamRef}: no convertible color spaces, no device conversion`);
                }
                return {
                    streamRef,
                    compressedOutput: compressedContents,
                    replacementCount: 0,
                    colorConversions: 0,
                    deviceColorCount: 0,
                    finalColorSpaceState: initialColorSpaceState,
                };
            }

        // ── Single-pass streaming pipeline ──
        //
        // DecompressionStream → transformFromAsync (parser Layer 1) →
        // interpreter (Layer 2) → substitute operators → CompressionStream
        //
        // The decompressed content never exists as a single string. The parser's
        // transformFromAsync yields TransformTokens:
        //   - passthrough: bytes to write to output unchanged
        //   - operator: color operator token for interpretation and possible substitution
        //
        // The interpreter enriches operator tokens with colorSpaceName from
        // graphics state tracking (CS/cs, q/Q, implicit Device shortcuts).

        const { collectUint8ArrayChunks } = await import('../../helpers/buffers.js');
        const { readableStreamAsyncIterable } = await import('../../helpers/streams.js');

        const interpreter = createInterpreter(initialColorSpaceState);

        let replacementCount = 0;
        let colorConversions = 0;
        let deviceColorCount = 0;

        // Detect deflate format from the stream header.
        // PDF FlateDecode is zlib (RFC 1950) by default: CMF byte 0x78
        // followed by a check byte where (CMF*256 + FLG) % 31 === 0.
        // Some producers (including pdf-lib's internal streams) may use
        // raw deflate (RFC 1951) without the zlib wrapper.
        // DecompressionStream('deflate') = zlib, ('deflate-raw') = raw.
        // Zlib CMF byte: low nibble = method (8 = deflate), high nibble = window size.
        // 0x78 = method 8, window 32K (most common). 0x48 = method 8, window 1K (Adobe).
        // Valid zlib requires (CMF * 256 + FLG) % 31 === 0.
        const cmf = compressedContents.length >= 2 ? compressedContents[0] : 0;
        const flg = compressedContents.length >= 2 ? compressedContents[1] : 0;
        const hasZlibHeader = (cmf & 0x0F) === 8 && (cmf * 256 + flg) % 31 === 0;
        const deflateFormat = hasZlibHeader ? 'deflate' : 'deflate-raw';

        // Decompress to async Uint8Array chunks
        const inputStream = new ReadableStream({
            start(controller) {
                controller.enqueue(compressedContents);
                controller.close();
            },
        });
        const decompressedChunks = readableStreamAsyncIterable(
            inputStream.pipeThrough(new DecompressionStream(deflateFormat)),
        );

        // Stream: decompress → tokenize → interpret → substitute → compress
        // Always recompress as zlib ('deflate') — pdf-lib's FlateStream
        // requires the 2-byte zlib header (CMF + FLG). Input format may
        // vary (raw or zlib) but output must be consistent.
        const compressor = new CompressionStream('deflate');
        const compressWriter = compressor.writable.getWriter();

        // Process tokens from the parser's streaming transform.
        //
        // Tokens arrive as a mix of passthrough (Uint8Array views into the
        // shared Latin1Buffer) and operator tokens. We collect all tokens
        // from each yielded batch, group convertible operators by color space,
        // batch-convert each group in one convertColorsBuffer call, then
        // output the entire sequence as interleaved Uint8Array bands:
        //   [passthrough view] [replacement] [passthrough view] [operator unchanged] ...
        //
        // Passthrough views are into the shared buffer and must be written
        // before the next yield from transformFromAsync (which reuses the buffer).
        // Operator replacements are small independent allocations.

        const processTokens = (async () => {
            // Accumulate ALL tokens (passthrough + operator) across decompression
            // chunks. Batching is decoupled from chunk boundaries — we flush only
            // when accumulated input bytes reach the memory threshold or at stream
            // end. This gives the batch converter ALL operators in one call instead
            // of 1 per decompression chunk.
            //
            // On flush, batch-convert all operators, then resolve every token to
            // its output Uint8Array in original interleaved order and write the
            // array of Uint8Arrays to the compressor.
            //
            // This preserves:
            // 1. Correct ordering — color operators appear before their drawing ops
            // 2. Maximal batching — all operators across chunks in one buildLookupTable call
            // 3. Bounded memory — flush at threshold prevents OOM on large streams

            const FLUSH_THRESHOLD = 100 * 1024 * 1024; // 100 MB

            /** @type {Array<{ kind: 'passthrough', bytes: Uint8Array } | { kind: 'operator', token: any, enriched: any }>} */
            let tokens = [];
            let accumulatedBytes = 0;

            /**
             * Batch-convert all accumulated operator tokens, then write all
             * tokens to the compressor in original interleaved order.
             */
            const flush = async () => {
                if (tokens.length === 0) return;

                // ── Build lookup inputs from convertible operators ──
                /** @type {import('./lookup-table-color-converter.js').LookupTableColorConverterInput[]} */
                const lookupInputs = [];
                /** @type {number[]} */
                const lookupTokenIndices = [];

                // ── Device-operator direct conversions via TPS (pre-pass) ──
                // `setGray`/`setRGB`/`setCMYK` operators carry their color values
                // implicitly and have no named color space. When the source Device
                // type differs from the destination color space, route through
                // TraditionalPostScriptColorConverter for Float32 math. Results
                // feed into the same `conversions` map used by the ICC lookup path
                // below, so the output-writing stage is unchanged.
                //
                // MVP: no policy resolver — every Device operator whose source
                // type differs from the destination type goes through TPS. This
                // matches the F10a manifest configuration (defaults null, policy
                // resolution deferred to Task C).
                /** @type {Map<number, number[]>} token index → converted values (Device path) */
                const deviceConversions = new Map();
                const destColorSpace = /** @type {'RGB' | 'CMYK' | 'Gray'} */ (config.destinationColorSpace);
                for (let i = 0; i < tokens.length; i++) {
                    const item = tokens[i];
                    if (item.kind !== 'operator') continue;
                    const enriched = item.enriched;
                    if (!enriched) continue;

                    /** @type {'RGB' | 'CMYK' | 'Gray' | null} */
                    let srcDevice = null;
                    switch (enriched.operation) {
                        case 'setGray': srcDevice = 'Gray'; break;
                        case 'setRGB':  srcDevice = 'RGB';  break;
                        case 'setCMYK': srcDevice = 'CMYK'; break;
                    }
                    if (!srcDevice) continue;
                    if (srcDevice === destColorSpace) continue; // identity — leave operator unchanged
                    if (destColorSpace !== 'RGB' && destColorSpace !== 'CMYK' && destColorSpace !== 'Gray') continue;

                    // `setGray` carries a singular `value`; `setRGB`/`setCMYK` carry `values[]`.
                    const vals = enriched.operation === 'setGray'
                        ? (typeof enriched.value === 'number' ? [enriched.value] : null)
                        : enriched.values;
                    if (!vals || vals.length === 0) continue;

                    try {
                        const converted = this.#getTPS().convertTuple(vals, {
                            inputColorSpace: srcDevice,
                            outputColorSpace: destColorSpace,
                        });
                        deviceConversions.set(i, Array.from(converted));
                    } catch (error) {
                        if (config.verbose) {
                            console.warn(
                                `${CONTEXT_PREFIX} [PDFContentStreamColorConverter] TPS conversion ` +
                                `(${srcDevice} → ${destColorSpace}) failed for operator ${enriched.operator}: ${error}`,
                            );
                        }
                    }
                }

                for (let i = 0; i < tokens.length; i++) {
                    const item = tokens[i];
                    if (item.kind !== 'operator') continue;

                    const enriched = item.enriched;
                    if (!enriched || enriched.operation !== 'setColor') continue;

                    const csName = enriched.colorSpaceName;
                    if (!csName || !colorSpaceDefinitions) continue;

                    const csDef = colorSpaceDefinitions[csName];
                    if (!csDef) continue;

                    const csType = csDef.colorSpaceType;
                    /** @type {'RGB' | 'Gray' | 'Lab' | null} */
                    let inputColorSpace = null;
                    switch (csType) {
                        case 'ICCBasedRGB': inputColorSpace = 'RGB'; break;
                        case 'ICCBasedGray': inputColorSpace = 'Gray'; break;
                        case 'Lab': inputColorSpace = 'Lab'; break;
                    }
                    if (!inputColorSpace) continue;

                    const vals = enriched.values;
                    if (!vals || vals.length === 0) continue;

                    lookupInputs.push({ colorSpace: inputColorSpace, values: vals, sourceProfile: csDef.sourceProfile });
                    lookupTokenIndices.push(i);
                }

                // ── Batch-convert all convertible operators at once ──
                /** @type {Map<number, number[]>} token index → converted values */
                const conversions = new Map();

                if (lookupInputs.length > 0) {
                    try {
                        const uniqueInputs = this.#deduplicateInputs(lookupInputs);
                        const lookupTable = await this.buildLookupTable(uniqueInputs, context);

                        for (let j = 0; j < lookupInputs.length; j++) {
                            const converted = this.applyLookupTable(lookupTable, lookupInputs[j]);
                            if (converted) {
                                conversions.set(lookupTokenIndices[j], converted);
                            }
                        }
                    } catch (error) {
                        if (config.verbose) {
                            console.warn(`${CONTEXT_PREFIX} [PDFContentStreamColorConverter] Batch conversion failed: ${error}`);
                        }
                    }
                }

                // Merge Device-operator TPS conversions into the same output map.
                for (const [idx, vals] of deviceConversions) {
                    conversions.set(idx, vals);
                }

                // ── Resolve ALL tokens to output Uint8Arrays in original order ──
                /** @type {Uint8Array[]} */
                const outputChunks = [];

                for (let i = 0; i < tokens.length; i++) {
                    const item = tokens[i];
                    if (item.kind === 'passthrough') {
                        outputChunks.push(item.bytes);
                    } else {
                        const converted = conversions.get(i);
                        if (converted) {
                            const enriched = item.enriched;
                            const newOperator = this.#getOutputOperator(enriched.operator);
                            const valuesStr = Array.from(converted).map(v => {
                                const rounded = Math.abs(v) < 0.0001 ? 0 : v;
                                const formatted = rounded.toFixed(6).replace(/\.?0+$/, '');
                                return formatted === '' ? '0' : formatted;
                            }).join(' ');

                            const replacement = `${valuesStr} ${newOperator}`;

                            if (replacementCount < 3 && config.verbose) {
                                console.log(`${CONTEXT_PREFIX} [PDFContentStreamColorConverter] Replacement #${replacementCount}: "${replacement}" (from operator ${enriched.operator}, converted=${Array.from(converted)})`);
                            }
                            const bytes = new Uint8Array(replacement.length);
                            for (let j = 0; j < replacement.length; j++) bytes[j] = replacement.charCodeAt(j);
                            outputChunks.push(bytes);

                            replacementCount++;
                            colorConversions++;
                        } else {
                            outputChunks.push(item.token.bytes);
                        }
                    }
                }

                // ── Write all output chunks to compressor ──
                for (const chunk of outputChunks) {
                    await compressWriter.write(chunk);
                }

                tokens = [];
                accumulatedBytes = 0;
            };

            for await (const token of transformFromAsync(decompressedChunks)) {
                switch (token.type) {
                    case 'operator': {
                        let enrichedOp = token;
                        for (const enriched of interpreter.interpret([/** @type {any} */ (token)])) {
                            switch (enriched.operation) {
                                case 'setGray': case 'setRGB': case 'setCMYK':
                                    deviceColorCount++;
                                    break;
                            }
                            enrichedOp = enriched;
                        }
                        const opToken = /** @type {any} */ (token);
                        tokens.push({ kind: /** @type {const} */ ('operator'), token: opToken, enriched: enrichedOp });
                        accumulatedBytes += opToken.bytes.length;
                        break;
                    }

                    case 'passthrough':
                        tokens.push({ kind: /** @type {const} */ ('passthrough'), bytes: token.bytes });
                        accumulatedBytes += token.bytes.length;
                        break;

                    case 'flush':
                        // Ignore chunk boundaries — batch across all chunks.
                        // Flush only when accumulated bytes reach the threshold.
                        if (accumulatedBytes >= FLUSH_THRESHOLD) {
                            await flush();
                        }
                        break;
                }
            }

            // Final flush for remaining tokens
            await flush();
            await compressWriter.close();

        })();

        // Collect compressed output concurrently
        const [compressedOutput] = await Promise.all([
            collectUint8ArrayChunks(readableStreamAsyncIterable(compressor.readable)),
            processTokens,
        ]);

        if (config.verbose) {
            console.log(`${CONTEXT_PREFIX} [PDFContentStreamColorConverter] Streaming result for ${streamRef}: replacements=${replacementCount}, conversions=${colorConversions}, deviceColors=${deviceColorCount}, outputSize=${compressedOutput.length}`);
        }

        return {
            streamRef,
            compressedOutput,
            replacementCount,
            colorConversions,
            deviceColorCount,
            finalColorSpaceState: interpreter.state,
        };
    }

    // ========================================
    // Color Conversion
    // ========================================

    /**
     * Converts uncached colors in batch using inherited convertColorsBuffer().
     *
     * Groups colors by colorSpace and converts each group with a single
     * policy-aware batch call for optimal performance. Uses the inherited
     * ColorConverter.convertColorsBuffer() method which properly evaluates
     * policy rules including engine-specific transforms.
     *
     * @override
     * @param {import('./lookup-table-color-converter.js').LookupTableColorConverterInput[]} inputs - Uncached colors
     * @param {import('./color-converter.js').ColorConverterContext} _context - Conversion context (unused)
     * @returns Converted color values
     */
    async convertBatchUncached(inputs, _context) {
        if (inputs.length === 0) {
            return [];
        }

        const config = this.configuration;

        // Group inputs by colorSpace for efficient batching
        // Each group can be converted in a single call
        /** @type {{RGB?: {indices: number[], values: number[][], profiles: (ArrayBuffer | undefined)[]}, Gray?: {indices: number[], values: number[][], profiles: (ArrayBuffer | undefined)[]}, Lab?: {indices: number[], values: number[][], profiles: (ArrayBuffer | undefined)[]}}} */
        const groups = {};

        for (let i = 0; i < inputs.length; i++) {
            const { colorSpace, values, sourceProfile } = inputs[i];
            let group = groups[colorSpace];
            if (!group) {
                group = { indices: [], values: [], profiles: [] };
                groups[colorSpace] = group;
            }
            group.indices.push(i);
            group.values.push(values);
            group.profiles.push(sourceProfile);
        }

        // Prepare results array (will be filled out of order)
        /** @type {(number[]|Float32Array)[]} */
        const results = new Array(inputs.length);

        // Convert each group with a single batch call
        for (const colorSpace of /** @type {const} */ (['RGB', 'Gray', 'Lab'])) {
            const group = groups[colorSpace];
            if (!group) continue;
            const { indices, values: colorValues, profiles } = group;

            // Determine source profile based on color space
            // For Lab, use built-in profile. For RGB/Gray, use profile from colorSpaceDefinitions
            /** @type {ArrayBuffer | 'Lab'} */
            let sourceProfile;
            if (colorSpace === 'Lab') {
                sourceProfile = 'Lab';
            } else {
                // Get profile from the first input in the group
                // All inputs in same group should have the same profile (from same PDF color space)
                const profile = profiles[0];
                if (!profile || !(profile instanceof ArrayBuffer)) {
                    throw new Error(`Source ${colorSpace} profile must be an ArrayBuffer (from ICCBased color space in PDF)`);
                }
                sourceProfile = profile;
            }

            // Build input buffer from color values
            // Content streams use 0-1 float values, convert to 8-bit integers
            const channelCount = colorSpace === 'Gray' ? 1 : 3;
            const pixelCount = colorValues.length;
            const inputBuffer = Float32Array.from(colorValues.flat());
            const effectiveIntent = this.getEffectiveRenderingIntent(colorSpace);

            // Log if verbose (shows intent fallback like ImageColorConverter does)
            if (config.verbose && effectiveIntent !== config.renderingIntent) {
                console.log(`${CONTEXT_PREFIX} [PDFContentStreamColorConverter] ${colorSpace} color intent fallback:`);
                console.log(`${CONTEXT_PREFIX}   Intent: ${effectiveIntent} (requested: ${config.renderingIntent})`);
            }

            // Use inherited convertColorsBuffer which respects policy
            const result = await this.convertColorsBuffer(inputBuffer, {
                inputColorSpace: colorSpace,
                outputColorSpace: config.destinationColorSpace,
                sourceProfile,
                destinationProfile: config.destinationProfile,
                renderingIntent: effectiveIntent,
                blackPointCompensation: config.blackPointCompensation,
                // Float means we don't have to do any math!!!
                bitsPerComponent: 32,
                inputBitsPerComponent: 32,
                outputBitsPerComponent: 32,

                // endianness: 'little',
            });

            // Place results at correct indices and convert to PDF format
            const outputChannels = config.destinationColorSpace === 'CMYK' ? 4
                : config.destinationColorSpace === 'Gray' ? 1 : 3;
            if (config.destinationColorSpace === 'CMYK') {
                for (let j = 0, offset = 0; j < indices.length; j++) {
                    results[indices[j]] = new Float32Array([
                        result.outputPixels[offset++] / 100, // C
                        result.outputPixels[offset++] / 100, // M
                        result.outputPixels[offset++] / 100, // Y
                        result.outputPixels[offset++] / 100, // K
                    ]);
                }
            } else {
                for (let j = 0; j < indices.length; j++) {
                    results[indices[j]] = new Float32Array(result.outputPixels.buffer, j * outputChannels * 4, outputChannels);
                }
            }
        }

        return results;
    }

    /**
     * Deduplicates color inputs for efficient batch conversion.
     *
     * @param {import('./lookup-table-color-converter.js').LookupTableColorConverterInput[]} inputs
     * @returns {import('./lookup-table-color-converter.js').LookupTableColorConverterInput[]}
     */
    #deduplicateInputs(inputs) {
        const seen = new Set();
        const unique = [];
        for (const input of inputs) {
            const key = `${input.colorSpace}:${input.values.join(',')}`;
            if (!seen.has(key)) {
                seen.add(key);
                unique.push(input);
            }
        }
        return unique;
    }

    // ========================================
    // Content Stream Parsing
    // ========================================

    /**
     * Parses a content stream to extract color operations.
     *
     * Tracks stroke/fill color space contexts separately:
     * - Stroke: CS sets context, SC/SCN uses it
     * - Fill: cs sets context, sc/scn uses it
     *
     * When multiple content streams share a page, the graphics state
     * (including current color space) carries over. Use initialState
     * to pass the color space context from previous streams.
     *
     * @param {string} streamText - Content stream text
     * @param {ColorSpaceState} [initialState] - Initial color space state from previous stream
     * @returns {{operations: ParsedColorOperation[], finalState: ColorSpaceState}} Parsed operations and final state
     */
    parseContentStream(streamText, initialState = {}) {
        const config = /** @type {PDFContentStreamColorConverterConfiguration} */ (this.configuration);

        if (config.useLegacyContentStreamParsing) {
            return this.#parseContentStreamLegacy(streamText, initialState);
        }

        // Delegate to the new tokenizer + interpreter pipeline
        const { operations: enrichedOps, finalState } = collectOperations(
            tokenize(streamText),
            initialState,
        );

        // Map enriched operations back to the ParsedColorOperation shape
        // expected by convertColor and rebuildContentStream.
        // This bridge layer preserves backward compatibility during refactor.
        /** @type {ParsedColorOperation[]} */
        const operations = enrichedOps.map(op => {
            // Map new operation names to old type names
            /** @type {ParsedColorOperation['type']} */
            let type;
            switch (op.operation) {
                case 'setGray': type = 'gray'; break;
                case 'setRGB': type = 'rgb'; break;
                case 'setCMYK': type = 'cmyk'; break;
                case 'setColorSpace': type = 'colorspace'; break;
                case 'setColor': type = 'indexed'; break;
                case 'saveState':
                case 'restoreState': type = 'colorspace'; break;
                default: type = 'colorspace'; break;
            }

            // Normalize gray's single value to values array for backward compat
            const values = /** @type {any} */ (op).values
                ?? (/** @type {any} */ (op).value !== undefined ? [/** @type {any} */ (op).value] : undefined);

            return {
                type,
                operator: op.operator,
                values,
                name: /** @type {any} */ (op).name,
                colorSpaceName: /** @type {any} */ (op).colorSpaceName,
                index: op.offset,
                length: op.length,
                raw: undefined,
            };
        });

        return {
            operations,
            finalState: {
                strokeColorSpace: finalState.strokeColorSpace,
                fillColorSpace: finalState.fillColorSpace,
            },
        };
    }

    /**
     * Legacy parseContentStream implementation using the original monolithic
     * regex with chunked matchAll. Used when `useLegacyContentStreamParsing` is true.
     *
     * This implementation is preserved for compatibility while the new
     * streaming pipeline is being developed.
     *
     * @param {string} streamText
     * @param {ColorSpaceState} initialState
     * @returns {{operations: ParsedColorOperation[], finalState: ColorSpaceState}}
     */
    #parseContentStreamLegacy(streamText, initialState) {
        /** @type {ParsedColorOperation[]} */
        const operations = [];

        /** @type {string | undefined} */
        let currentStrokeColorSpace = initialState.strokeColorSpace;
        /** @type {string | undefined} */
        let currentFillColorSpace = initialState.fillColorSpace;

        const regex = new RegExp(LEGACY_COLOR_OPERATOR_REGEX.source, 'ug');

        for (const match of legacyMatchAll(streamText, regex)) {
            const groups = match.groups ?? {};
            const matchIndex = match.index ?? 0;
            const headLength = groups.head?.length ?? 0;
            const colorIndex = matchIndex + headLength;
            const fullMatchLength = match[0].length;
            const colorOpLength = fullMatchLength - headLength;

            // Color space operator (CS/cs)
            if (groups.csOp && groups.name) {
                const isStroke = groups.csOp === 'CS';
                const name = groups.name.replace(/^\//, '');
                if (isStroke) {
                    currentStrokeColorSpace = name;
                } else {
                    currentFillColorSpace = name;
                }
                operations.push({
                    type: 'colorspace',
                    operator: groups.csOp,
                    name: groups.name,
                    index: colorIndex,
                    length: colorOpLength,
                    raw: match[0].slice(headLength),
                });
                continue;
            }

            // Gray color (G/g)
            if (groups.gray && groups.gOp) {
                operations.push({
                    type: 'gray',
                    operator: groups.gOp,
                    values: [parseFloat(groups.gray)],
                    index: colorIndex,
                    length: colorOpLength,
                    raw: match[0].slice(headLength),
                });
                continue;
            }

            // RGB color (RG/rg)
            if (groups.rgb && groups.rgOp) {
                operations.push({
                    type: 'rgb',
                    operator: groups.rgOp,
                    values: groups.rgb.trim().split(/\s+/).map(parseFloat),
                    index: colorIndex,
                    length: colorOpLength,
                    raw: match[0].slice(headLength),
                });
                continue;
            }

            // CMYK color (K/k)
            if (groups.cmyk && groups.kOp) {
                operations.push({
                    type: 'cmyk',
                    operator: groups.kOp,
                    values: groups.cmyk.trim().split(/\s+/).map(parseFloat),
                    index: colorIndex,
                    length: colorOpLength,
                    raw: match[0].slice(headLength),
                });
                continue;
            }

            // Named color space with SCN/scn
            if (groups.scnOp && groups.name2) {
                operations.push({
                    type: 'colorspace',
                    operator: groups.scnOp,
                    name: groups.name2,
                    index: colorIndex,
                    length: colorOpLength,
                    raw: match[0].slice(headLength),
                });
                continue;
            }

            // Numeric SC/sc/SCN/scn
            if (groups.scOp && groups.n) {
                const operator = groups.scOp;
                const isStroke = operator === 'SC' || operator === 'SCN';
                const colorSpaceName = isStroke ? currentStrokeColorSpace : currentFillColorSpace;

                operations.push({
                    type: 'indexed',
                    operator,
                    values: groups.n.trim().split(/\s+/).map(parseFloat),
                    colorSpaceName,
                    index: colorIndex,
                    length: colorOpLength,
                    raw: match[0].slice(headLength),
                });
                continue;
            }
        }

        return {
            operations,
            finalState: {
                strokeColorSpace: currentStrokeColorSpace,
                fillColorSpace: currentFillColorSpace,
            },
        };
    }

    /**
     * Rebuilds content stream with converted color values.
     *
     * For Lab output, inserts color space selection operators when Lab is not
     * already active for the stroke/fill context.
     *
     * @param {string} originalText - Original stream text
     * @param {Array<{operation: ParsedColorOperation, convertedValues: number[], cacheHit: boolean}>} replacements
     * @param {ColorSpaceState} [initialColorSpaceState={}] - Initial color space state
     * @param {string} [labColorSpaceName] - Lab color space resource name (overrides config)
     * @returns {{ segments: Generator<string, void, unknown> | null, totalLength: number, finalColorSpaceState: ColorSpaceState }} Segment generator, total output length, and final state
     */
    rebuildContentStream(originalText, replacements, initialColorSpaceState = {}, labColorSpaceName) {
        if (replacements.length === 0) {
            return {
                segments: null,
                totalLength: originalText.length,
                finalColorSpaceState: initialColorSpaceState,
            };
        }

        const isLabOutput = this.configuration.destinationColorSpace === 'Lab';

        // Track Lab active state for stroke/fill separately
        // Initialize from initial state - check if Lab is already active
        let labActiveStroke = initialColorSpaceState.strokeColorSpace === 'Lab';
        let labActiveFill = initialColorSpaceState.fillColorSpace === 'Lab';

        // Sort ascending by position for streaming output
        const sortedAscending = [...replacements].sort((a, b) => a.operation.index - b.operation.index);

        /** @type {Array<{index: number, length: number, replacement: string}>} */
        const insertions = [];

        for (const { operation, convertedValues } of sortedAscending) {
            const newOperator = this.#getOutputOperator(operation.operator);
            const isStroke = newOperator === 'SCN' || newOperator === 'K' || newOperator === 'RG' || newOperator === 'G';

            // Format values: 6 decimal places, strip trailing zeros for compact output
            // Round very small values to 0 to avoid floating point artifacts
            const valuesStr = convertedValues.map(v => {
                // Round values very close to 0 (within 0.0001) to exactly 0
                const rounded = Math.abs(v) < 0.0001 ? 0 : v;
                const formatted = rounded.toFixed(6).replace(/\.?0+$/, '');
                return formatted === '' ? '0' : formatted;
            }).join(' ');

            let replacement;
            if (isLabOutput) {
                // Always insert color space selection for Lab output.
                // We cannot track state reliably because the original stream may have
                // color space operations (e.g., /CS1 cs) between our replacements
                // that would make Lab no longer active.
                const labName = labColorSpaceName ?? this.configuration.labColorSpaceName ?? 'Lab';
                const csOp = isStroke ? `/${labName} CS ` : `/${labName} cs `;
                replacement = `${csOp}${valuesStr} ${newOperator}`;
                // Track that Lab is active (for final state output)
                if (isStroke) {
                    labActiveStroke = true;
                } else {
                    labActiveFill = true;
                }
            } else {
                replacement = `${valuesStr} ${newOperator}`;
            }

            insertions.push({
                index: operation.index,
                length: operation.length,
                replacement,
            });
        }

        // Compute total output length without materializing the string.
        // Each insertion removes `length` chars and adds `replacement.length` chars.
        let totalLength = originalText.length;
        for (const { length, replacement } of insertions) {
            totalLength += replacement.length - length;
        }

        // Generator that yields string segments in order, avoiding a single
        // concatenated string.  Consumers encode and compress incrementally,
        // so peak memory stays proportional to the gap between replacements
        // rather than the full stream size.
        function* generateSegments() {
            let cursor = 0;
            for (const { index, length, replacement } of insertions) {
                if (index > cursor) {
                    yield originalText.slice(cursor, index);
                }
                yield replacement;
                cursor = index + length;
            }
            if (cursor < originalText.length) {
                yield originalText.slice(cursor);
            }
        }

        // Build final color space state
        // Use parameter, then config, then default to 'Lab'
        const effectiveLabName = labColorSpaceName ?? this.configuration.labColorSpaceName ?? 'Lab';
        const finalColorSpaceState = {
            strokeColorSpace: labActiveStroke ? effectiveLabName : initialColorSpaceState.strokeColorSpace,
            fillColorSpace: labActiveFill ? effectiveLabName : initialColorSpaceState.fillColorSpace,
        };

        return {
            segments: generateSegments(),
            totalLength,
            finalColorSpaceState,
        };
    }

    // ========================================
    // Format Conversion Helpers
    // ========================================

    /**
     * Gets the output operator for a given input operator.
     *
     * Converts input operators to output operators based on destination color space.
     * Preserves stroke/fill distinction.
     *
     * @param {string | undefined} inputOp - Input operator
     * @returns {string} Output operator
     */
    #getOutputOperator(inputOp) {
        // Determine stroke vs fill — uppercase PDF operators are stroke variants
        // (G, RG, K, SC, SCN); lowercase are fill variants (g, rg, k, sc, scn).
        const isStroke = inputOp === 'G' || inputOp === 'RG' || inputOp === 'K'
            || inputOp === 'SC' || inputOp === 'SCN';

        switch (this.configuration.destinationColorSpace) {
            case 'CMYK':
                return isStroke ? 'K' : 'k';
            case 'RGB':
                return isStroke ? 'RG' : 'rg';
            case 'Gray':
                return isStroke ? 'G' : 'g';
            case 'Lab':
                // Lab requires named color space, use SCN/scn with color space selection
                return isStroke ? 'SCN' : 'scn';
            default:
                // Fallback to RGB operators
                return isStroke ? 'RG' : 'rg';
        }
    }

    // ========================================
    // Worker Mode Support
    // ========================================

    /**
     * @override
     * @returns {boolean}
     */
    get supportsWorkerMode() {
        return true;
    }

    /**
     * Prepares a task for worker thread execution.
     *
     * @override
     * @param {PDFContentStreamColorConverterInput} input
     * @param {import('./color-converter.js').ColorConverterContext} _context - Conversion context (unused)
     * @returns {import('./color-converter.js').WorkerTask}
     */
    prepareWorkerTask(input, _context) {
        const config = this.configuration;

        return {
            type: 'content-stream',
            streamRef: String(input.streamRef),
            streamText: input.streamText,
            colorSpaceDefinitions: input.colorSpaceDefinitions,
            destinationProfile: config.destinationProfile,
            renderingIntent: config.renderingIntent,
            blackPointCompensation: config.blackPointCompensation,
            sourceRGBProfile: this.sourceRGBProfile,
            sourceGrayProfile: this.sourceGrayProfile,
            destinationColorSpace: config.destinationColorSpace,
            verbose: config.verbose,
            intermediateProfiles: config.intermediateProfiles,
        };
    }

    /**
     * Applies worker processing results back to the PDF structure.
     *
     * Worker returns compressed content stream bytes that need to be written
     * back to the PDF stream object.
     *
     * @override
     * @param {PDFContentStreamColorConverterInput} input - Original input
     * @param {import('./color-converter.js').WorkerResult} workerResult - Result from worker
     * @param {import('./color-converter.js').ColorConverterContext} context - Conversion context
     * @returns {Promise<void>}
     */
    async applyWorkerResult(input, workerResult, context) {
        if (!workerResult.success) {
            if (this.configuration.verbose) {
                console.warn(`${CONTEXT_PREFIX} [PDFContentStreamColorConverter] Worker failed for stream ${input.streamRef}: ${workerResult.error}`);
            }
            return;
        }

        if (!workerResult.compressedResult) {
            return;
        }

        // Store result in context for parent converter (PDFPageColorConverter) to apply
        // The actual PDF manipulation happens at the document level where we have
        // access to the PDFContext
        context.contentStreamWorkerResult = {
            streamRef: input.streamRef,
            compressedData: new Uint8Array(workerResult.compressedResult),
            replacementCount: workerResult.replacementCount ?? 0,
            originalSize: workerResult.originalSize,
            compressedSize: workerResult.compressedSize,
        };

        if (this.configuration.verbose) {
            console.log(`${CONTEXT_PREFIX} [PDFContentStreamColorConverter] Worker result applied for stream ${input.streamRef}`);
            console.log(`${CONTEXT_PREFIX}   Replacements: ${workerResult.replacementCount ?? 0}`);
            console.log(`${CONTEXT_PREFIX}   Size: ${workerResult.originalSize} -> ${workerResult.compressedSize} (compressed)`);
        }
    }

    // ========================================
    // Resource Cleanup
    // ========================================

    /**
     * @override
     */
    dispose() {
        super.dispose();
    }
}
