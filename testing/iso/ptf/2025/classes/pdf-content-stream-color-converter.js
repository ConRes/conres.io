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
 *   newText: string,
 *   replacementCount: number,
 *   colorConversions: number,
 *   cacheHits: number,
 *   deviceColorCount: number,
 *   finalColorSpaceState: ColorSpaceState,
 * }} PDFContentStreamColorConverterResult
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

/**
 * Regular expression for matching PDF content stream color operators.
 * Exported for reuse by verification tools.
 * @type {RegExp}
 */
export const COLOR_OPERATOR_REGEX = /(?<head>[^(]*?)(?:(?:(?<=[\s\n]|^)(?<name>\/\w+)\s+(?<csOp>CS|cs)\b)|(?:(?<=[\s\n]|^)(?<name2>\/\w+)\s+(?<scnOp>SCN|scn)\b)|(?:(?<=[\s\n]|^)(?<gray>(?:\d+\.?\d*|\.\d+))\s+(?<gOp>G|g)\b)|(?:(?<=[\s\n]|^)(?<cmyk>(?:\d+\.?\d*|\.\d+)\s+(?:\d+\.?\d*|\.\d+)\s+(?:\d+\.?\d*|\.\d+)\s+(?:\d+\.?\d*|\.\d+))\s+(?<kOp>K|k)\b)|(?:(?<=[\s\n]|^)(?<rgb>(?:\d+\.?\d*|\.\d+)\s+(?:\d+\.?\d*|\.\d+)\s+(?:\d+\.?\d*|\.\d+))\s+(?<rgOp>RG|rg)\b)|(?:(?<=[\s\n]|^)(?<n>(?:\d+\.?\d*|\.\d+)(?:\s+(?:\d+\.?\d*|\.\d+))*)\s+(?<scOp>SC|sc|SCN|scn)\b)|(?:\((?<string>[^)]*)\))|\s*$)/ug;

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
 *     destinationProfile: cmykProfileBuffer,
 *     destinationColorSpace: 'CMYK',
 *     useLookupTable: true,
 *     sourceRGBProfile: 'sRGB',
 *     sourceGrayProfile: 'sGray',
 *     verbose: false,
 * });
 *
 * const result = await converter.convertColor({
 *     streamRef: contentStreamRef,
 *     streamText: '1 0 0 rg 100 100 50 50 re f',
 * });
 * console.log(result.newText); // Converted to CMYK
 * ```
 */
export class PDFContentStreamColorConverter extends LookupTableColorConverter {
    // ========================================
    // Constructor
    // ========================================

    /**
     * Creates a new PDFContentStreamColorConverter instance.
     *
     * @param {PDFContentStreamColorConverterConfiguration} configuration - Immutable configuration
     * @param {object} [options={}] - Additional options
     * @param {import('../services/ColorEngineService.js').ColorEngineService} [options.colorEngineService] - Shared service
     */
    constructor(configuration, options = {}) {
        super(configuration, options);
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
     * - Lab colors (produces incorrect K=1 output)
     * - RGB destination (K-Only GCR is CMYK-specific, no K channel in RGB)
     *
     * This matches the logic in ImageColorConverter.getEffectiveRenderingIntent()
     * to ensure consistent behavior between image and content stream conversion.
     *
     * @param {'RGB' | 'Gray' | 'Lab'} colorType - Input color type
     * @returns {import('./color-converter.js').RenderingIntent} Effective rendering intent
     */
    getEffectiveRenderingIntent(colorType) {
        const intent = this.configuration.renderingIntent;
        const destCS = this.configuration.destinationColorSpace;

        // K-Only GCR doesn't work for Lab → any, or any → RGB
        if (intent === 'preserve-k-only-relative-colorimetric-gcr') {
            if (colorType === 'Lab' || destCS === 'RGB') {
                return 'relative-colorimetric';
            }
        }

        return intent;
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
            console.log(`[PDFContentStreamColorConverter] Processing stream ${streamRef}`);
            console.log(`  Stream length: ${streamText.length} characters`);
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
            console.log(`  Found ${operations.length} color operations`);
        }

        // Separate Device* colors (not converted) from ICCBased/Lab colors (converted)
        // Device* colors use direct operators (rg/RG/g/G) without named color space context
        const deviceColors = operations.filter((/** @type {ParsedColorOperation} */ op) =>
            op.type === 'rgb' || op.type === 'gray'
        );

        // ICCBased and Lab colors use named color spaces (via SC/sc/SCN/scn)
        const toConvert = operations.filter((/** @type {ParsedColorOperation} */ op) => {
            if (op.type === 'indexed' && op.values && op.colorSpaceName) {
                // Check if the color space is convertible (ICCBased: sGray, sRGB, or Lab)
                const csDef = colorSpaceDefinitions?.[op.colorSpaceName];
                if (csDef) {
                    const csType = csDef.colorSpaceType;
                    return csType === 'sGray' || csType === 'sRGB' || csType === 'Lab';
                }
            }
            return false;
        });

        if (config.verbose && deviceColors.length > 0) {
            console.log(`  Skipping ${deviceColors.length} Device* color operations (no ICC profile)`);
        }

        if (toConvert.length === 0) {
            return {
                streamRef,
                originalText: streamText,
                newText: streamText,
                replacementCount: 0,
                colorConversions: 0,
                cacheHits: 0,
                deviceColorCount: deviceColors.length,
                finalColorSpaceState: finalState,
            };
        }

        // Build lookup inputs from operations
        // All operations in toConvert are 'indexed' type with validated color space (sRGB, sGray, or Lab)
        const lookupInputs = toConvert.map(op => {
            // Determine color space from color space definition
            const csDef = colorSpaceDefinitions?.[/** @type {string} */ (op.colorSpaceName)];
            const csType = csDef?.colorSpaceType;

            /** @type {'RGB' | 'Gray' | 'Lab'} */
            let colorSpace;
            if (csType === 'sRGB') {
                colorSpace = 'RGB';
            } else if (csType === 'sGray') {
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
        /** @type {{ text: string, finalColorSpaceState: ColorSpaceState }} */
        let rebuildResult;
        try {
            rebuildResult = this.rebuildContentStream(streamText, replacements, initialColorSpaceState, input.labColorSpaceName);
            this.diagnostics.updateSpan(rebuildSpan, {
                originalLength: streamText.length,
                newLength: rebuildResult.text.length,
            });
        } finally {
            this.diagnostics.endSpan(rebuildSpan);
        }

        const cacheHits = lookupResults.filter(r => r.cacheHit).length;

        return {
            streamRef,
            originalText: streamText,
            newText: rebuildResult.text,
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
                console.log(`[PDFContentStreamColorConverter] ${colorSpace} color intent fallback:`);
                console.log(`  Intent: ${effectiveIntent} (requested: ${config.renderingIntent})`);
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
                requiresMultiprofileTransform: true,

                // endianness: 'little',
            });

            // Place results at correct indices and convert to PDF format
            const outputChannels = config.destinationColorSpace === 'CMYK' ? 4 : 3;
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
        /** @type {ParsedColorOperation[]} */
        const operations = [];

        // Track separate stroke/fill color space contexts
        // Stroke: set by CS (uppercase), used by SC/SCN (uppercase)
        // Fill: set by cs (lowercase), used by sc/scn (lowercase)
        // Initialize from previous stream's state if provided
        /** @type {string | undefined} */
        let currentStrokeColorSpace = initialState.strokeColorSpace;
        /** @type {string | undefined} */
        let currentFillColorSpace = initialState.fillColorSpace;

        const regex = new RegExp(COLOR_OPERATOR_REGEX.source, 'ug');
        const matches = Array.from(streamText.matchAll(regex));

        for (const match of matches) {
            const groups = match.groups ?? {};
            const matchIndex = match.index ?? 0;
            const headLength = groups.head?.length ?? 0;
            const colorIndex = matchIndex + headLength;
            const fullMatchLength = match[0].length;
            const colorOpLength = fullMatchLength - headLength;

            // Color space operator (CS/cs) - sets the context
            if (groups.csOp && groups.name) {
                const isStroke = groups.csOp === 'CS';
                // Strip leading slash for consistency with colorSpaceDefinitions keys
                const name = groups.name.replace(/^\//, '');
                // Update the appropriate context
                if (isStroke) {
                    currentStrokeColorSpace = name;
                } else {
                    currentFillColorSpace = name;
                }
                operations.push({
                    type: 'colorspace',
                    operator: groups.csOp,
                    name: groups.name, // Keep original with slash for raw text
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
                const rgbValues = groups.rgb.trim().split(/\s+/).map(parseFloat);
                operations.push({
                    type: 'rgb',
                    operator: groups.rgOp,
                    values: rgbValues,
                    index: colorIndex,
                    length: colorOpLength,
                    raw: match[0].slice(headLength),
                });
                continue;
            }

            // CMYK color (K/k) - pass through
            if (groups.cmyk && groups.kOp) {
                const cmykValues = groups.cmyk.trim().split(/\s+/).map(parseFloat);
                operations.push({
                    type: 'cmyk',
                    operator: groups.kOp,
                    values: cmykValues,
                    index: colorIndex,
                    length: colorOpLength,
                    raw: match[0].slice(headLength),
                });
                continue;
            }

            // Named color space with SCN/scn (e.g., "/CS0 scn")
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

            // Numeric color values with SC/sc/SCN/scn (e.g., "1 scn", "0.5 0.3 0.2 sc")
            // These use the current color space context
            if (groups.scOp && groups.n) {
                const operator = groups.scOp;
                const isStroke = operator === 'SC' || operator === 'SCN';
                const colorSpaceName = isStroke ? currentStrokeColorSpace : currentFillColorSpace;
                const values = groups.n.trim().split(/\s+/).map(parseFloat);

                operations.push({
                    type: 'indexed',
                    operator: operator,
                    values: values,
                    colorSpaceName: colorSpaceName,
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
     * @returns {{ text: string, finalColorSpaceState: ColorSpaceState }} Rebuilt stream text and final state
     */
    rebuildContentStream(originalText, replacements, initialColorSpaceState = {}, labColorSpaceName) {
        if (replacements.length === 0) {
            return {
                text: originalText,
                finalColorSpaceState: initialColorSpaceState,
            };
        }

        const isLabOutput = this.configuration.destinationColorSpace === 'Lab';

        // Track Lab active state for stroke/fill separately
        // Initialize from initial state - check if Lab is already active
        let labActiveStroke = initialColorSpaceState.strokeColorSpace === 'Lab';
        let labActiveFill = initialColorSpaceState.fillColorSpace === 'Lab';

        // For Lab, we need to process in order to track state correctly
        // Build list of replacements with computed strings, then apply from end
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

        // Apply replacements from end to start to preserve indices
        insertions.sort((a, b) => b.index - a.index);
        let result = originalText;
        for (const { index, length, replacement } of insertions) {
            result = result.slice(0, index) + replacement + result.slice(index + length);
        }

        // Build final color space state
        // Use parameter, then config, then default to 'Lab'
        const effectiveLabName = labColorSpaceName ?? this.configuration.labColorSpaceName ?? 'Lab';
        const finalColorSpaceState = {
            strokeColorSpace: labActiveStroke ? effectiveLabName : initialColorSpaceState.strokeColorSpace,
            fillColorSpace: labActiveFill ? effectiveLabName : initialColorSpaceState.fillColorSpace,
        };

        return {
            text: result,
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
        // Determine stroke vs fill
        const isStroke = inputOp === 'G' || inputOp === 'RG' || inputOp === 'SC' || inputOp === 'SCN';

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
                console.warn(`[PDFContentStreamColorConverter] Worker failed for stream ${input.streamRef}: ${workerResult.error}`);
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
            console.log(`[PDFContentStreamColorConverter] Worker result applied for stream ${input.streamRef}`);
            console.log(`  Replacements: ${workerResult.replacementCount ?? 0}`);
            console.log(`  Size: ${workerResult.originalSize} -> ${workerResult.compressedSize} (compressed)`);
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
