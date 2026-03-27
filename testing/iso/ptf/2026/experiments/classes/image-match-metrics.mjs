// @ts-check
/**
 * Image Match Metrics Class
 *
 * Self-describing component for image comparison pre-checks and binary matching.
 * Follows the layered comparison approach from compare-pdf-color.js:
 *
 * 1. Pre-checks: Dimension match, BPC match, color space compatibility
 * 2. Layer 1: Compressed hash comparison (binary identical compressed streams)
 * 3. Layer 2: Uncompressed hash comparison (binary identical after decompression)
 *
 * This class determines whether images require Delta-E computation or can be
 * classified as MATCH/MISMATCH based on structural and binary comparisons alone.
 *
 * Status outcomes:
 * - MATCH: Binary identical (compressed or uncompressed hash match)
 * - DELTA: Pre-checks pass but binary mismatch; requires Delta-E computation
 * - MISMATCH: Pre-checks fail (dimension, BPC, or color space mismatch)
 * - SKIP: Cannot compare (missing data, decode errors)
 *
 * @module image-match-metrics
 */

import { createHash } from 'crypto';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * @typedef {'MATCH' | 'DELTA' | 'MISMATCH' | 'SKIP'} MatchStatus
 */

/**
 * @typedef {{
 *   name: string,
 *   width: number,
 *   height: number,
 *   colorSpace: string,
 *   bitsPerComponent: number,
 *   channels: number,
 *   compressedData?: Uint8Array,
 *   pixelData?: Uint8Array,
 * }} ImageDescriptor
 */

/**
 * @typedef {{
 *   type: 'dimensions' | 'bitsPerComponent' | 'colorSpace' | 'channels',
 *   passed: boolean,
 *   expected: string | number,
 *   actual: string | number,
 *   message: string,
 * }} PreCheckResult
 */

/**
 * @typedef {{
 *   layer: 'compressed' | 'uncompressed',
 *   matched: boolean,
 *   referenceHash: string,
 *   sampleHash: string,
 * }} BinaryCheckResult
 */

/**
 * @typedef {{
 *   status: MatchStatus,
 *   preChecks: PreCheckResult[],
 *   binaryChecks: BinaryCheckResult[],
 *   matchLayer: 'compressed' | 'uncompressed' | 'none',
 *   pixelCount: number,
 *   skipReason?: string,
 * }} MatchResult
 */

// ============================================================================
// ImageMatchMetrics Class
// ============================================================================

/**
 * Image Match Metrics - handles pre-checks and binary matching for image comparison.
 */
export class ImageMatchMetrics {
    // ────────────────────────────────────────────────────────────────────────
    // Static Self-Description (for ComparisonsCoordinator registration)
    // ────────────────────────────────────────────────────────────────────────

    /** @type {string} */
    static metricName = 'Image-Match';

    /** @type {string} */
    static description = 'Image pre-checks and binary matching';

    /**
     * Schema for metric definitions.
     * Unlike DeltaEMetrics, this class doesn't compute numeric metrics -
     * it determines match status through structural and binary comparisons.
     */
    static metricDefinitions = {
        preChecks: {
            dimensions: { description: 'Width and height must match exactly' },
            bitsPerComponent: { description: 'Bits per component must match' },
            colorSpace: { description: 'Color space must be compatible' },
            channels: { description: 'Number of color channels must match' },
        },
        binaryLayers: {
            compressed: { description: 'Compressed stream bytes identical' },
            uncompressed: { description: 'Decompressed pixel data identical' },
        },
        statuses: {
            MATCH: { description: 'Binary identical (no Delta-E needed)' },
            DELTA: { description: 'Requires Delta-E computation' },
            MISMATCH: { description: 'Structural mismatch (incompatible)' },
            SKIP: { description: 'Cannot compare (missing data)' },
        },
    };

    // ────────────────────────────────────────────────────────────────────────
    // Instance Properties
    // ────────────────────────────────────────────────────────────────────────

    /** @type {ImageDescriptor | null} */
    #reference = null;

    /** @type {ImageDescriptor | null} */
    #sample = null;

    /** @type {PreCheckResult[]} */
    #preChecks = [];

    /** @type {BinaryCheckResult[]} */
    #binaryChecks = [];

    /** @type {MatchStatus} */
    #status = 'SKIP';

    /** @type {'compressed' | 'uncompressed' | 'none'} */
    #matchLayer = 'none';

    /** @type {string | undefined} */
    #skipReason = undefined;

    // ────────────────────────────────────────────────────────────────────────
    // Configuration
    // ────────────────────────────────────────────────────────────────────────

    /** @type {boolean} */
    #strictColorSpace = false;

    /**
     * Create an ImageMatchMetrics instance.
     *
     * @param {Object} [options]
     * @param {boolean} [options.strictColorSpace=false] - If true, color spaces must match exactly.
     *        If false, compatible color spaces (e.g., DeviceCMYK and ICCBased CMYK) are allowed.
     */
    constructor(options = {}) {
        this.#strictColorSpace = options.strictColorSpace ?? false;
    }

    // ────────────────────────────────────────────────────────────────────────
    // Public API
    // ────────────────────────────────────────────────────────────────────────

    /**
     * Set the reference image for comparison.
     *
     * @param {ImageDescriptor} image
     */
    setReference(image) {
        this.#reference = image;
    }

    /**
     * Set the sample image for comparison.
     *
     * @param {ImageDescriptor} image
     */
    setSample(image) {
        this.#sample = image;
    }

    /**
     * Execute the comparison: pre-checks followed by binary matching.
     *
     * @returns {MatchResult}
     */
    compare() {
        // Reset state
        this.#preChecks = [];
        this.#binaryChecks = [];
        this.#status = 'SKIP';
        this.#matchLayer = 'none';
        this.#skipReason = undefined;

        // Validate inputs
        if (!this.#reference) {
            this.#skipReason = 'Reference image not set';
            return this.#buildResult();
        }
        if (!this.#sample) {
            this.#skipReason = 'Sample image not set';
            return this.#buildResult();
        }

        // Execute pre-checks
        const preChecksPassed = this.#executePreChecks();

        if (!preChecksPassed) {
            this.#status = 'MISMATCH';
            return this.#buildResult();
        }

        // Execute binary matching (layered)
        const binaryMatch = this.#executeBinaryMatching();

        if (binaryMatch) {
            this.#status = 'MATCH';
        } else {
            // Pre-checks pass, binary mismatch → needs Delta-E
            this.#status = 'DELTA';
        }

        return this.#buildResult();
    }

    /**
     * Get the current match result.
     *
     * @returns {MatchResult}
     */
    getResult() {
        return this.#buildResult();
    }

    /**
     * Get the match status.
     *
     * @returns {MatchStatus}
     */
    get status() {
        return this.#status;
    }

    /**
     * Check if images are binary identical (MATCH status).
     *
     * @returns {boolean}
     */
    get isBinaryMatch() {
        return this.#status === 'MATCH';
    }

    /**
     * Check if Delta-E computation is required.
     *
     * @returns {boolean}
     */
    get requiresDeltaE() {
        return this.#status === 'DELTA';
    }

    /**
     * Get the pixel count (width × height) for the reference image.
     * Useful for reporting when binary match means "all pixels match".
     *
     * @returns {number}
     */
    get pixelCount() {
        if (!this.#reference) return 0;
        return this.#reference.width * this.#reference.height;
    }

    // ────────────────────────────────────────────────────────────────────────
    // Private Methods
    // ────────────────────────────────────────────────────────────────────────

    /**
     * Execute all pre-checks.
     *
     * @returns {boolean} True if all pre-checks pass.
     */
    #executePreChecks() {
        const ref = /** @type {ImageDescriptor} */ (this.#reference);
        const sample = /** @type {ImageDescriptor} */ (this.#sample);

        // Check 1: Dimensions
        const dimMatch = ref.width === sample.width && ref.height === sample.height;
        this.#preChecks.push({
            type: 'dimensions',
            passed: dimMatch,
            expected: `${ref.width}×${ref.height}`,
            actual: `${sample.width}×${sample.height}`,
            message: dimMatch
                ? `Dimensions match: ${ref.width}×${ref.height}`
                : `Dimension mismatch: ${ref.width}×${ref.height} vs ${sample.width}×${sample.height}`,
        });

        // Check 2: Bits per component
        const bpcMatch = ref.bitsPerComponent === sample.bitsPerComponent;
        this.#preChecks.push({
            type: 'bitsPerComponent',
            passed: bpcMatch,
            expected: ref.bitsPerComponent,
            actual: sample.bitsPerComponent,
            message: bpcMatch
                ? `BPC match: ${ref.bitsPerComponent}`
                : `BPC mismatch: ${ref.bitsPerComponent} vs ${sample.bitsPerComponent}`,
        });

        // Check 3: Channels
        const channelsMatch = ref.channels === sample.channels;
        this.#preChecks.push({
            type: 'channels',
            passed: channelsMatch,
            expected: ref.channels,
            actual: sample.channels,
            message: channelsMatch
                ? `Channels match: ${ref.channels}`
                : `Channel mismatch: ${ref.channels} vs ${sample.channels}`,
        });

        // Check 4: Color space
        const csCompatible = this.#strictColorSpace
            ? ref.colorSpace === sample.colorSpace
            : this.#areColorSpacesCompatible(ref.colorSpace, sample.colorSpace);
        this.#preChecks.push({
            type: 'colorSpace',
            passed: csCompatible,
            expected: ref.colorSpace,
            actual: sample.colorSpace,
            message: csCompatible
                ? `Color space compatible: ${ref.colorSpace}${ref.colorSpace !== sample.colorSpace ? ` ↔ ${sample.colorSpace}` : ''}`
                : `Color space incompatible: ${ref.colorSpace} vs ${sample.colorSpace}`,
        });

        return this.#preChecks.every(check => check.passed);
    }

    /**
     * Execute binary matching (layered).
     *
     * @returns {boolean} True if binary match found.
     */
    #executeBinaryMatching() {
        const ref = /** @type {ImageDescriptor} */ (this.#reference);
        const sample = /** @type {ImageDescriptor} */ (this.#sample);

        // Layer 1: Compressed hash comparison
        if (ref.compressedData && sample.compressedData) {
            const refHash = this.#hashBuffer(ref.compressedData);
            const sampleHash = this.#hashBuffer(sample.compressedData);
            const matched = refHash === sampleHash;

            this.#binaryChecks.push({
                layer: 'compressed',
                matched,
                referenceHash: refHash,
                sampleHash: sampleHash,
            });

            if (matched) {
                this.#matchLayer = 'compressed';
                return true;
            }
        }

        // Layer 2: Uncompressed hash comparison
        if (ref.pixelData && sample.pixelData) {
            const refHash = this.#hashBuffer(ref.pixelData);
            const sampleHash = this.#hashBuffer(sample.pixelData);
            const matched = refHash === sampleHash;

            this.#binaryChecks.push({
                layer: 'uncompressed',
                matched,
                referenceHash: refHash,
                sampleHash: sampleHash,
            });

            if (matched) {
                this.#matchLayer = 'uncompressed';
                return true;
            }
        }

        // No binary match
        this.#matchLayer = 'none';
        return false;
    }

    /**
     * Check if two color spaces are compatible for comparison.
     * Compatible means they represent the same color model even if named differently.
     *
     * @param {string} cs1
     * @param {string} cs2
     * @returns {boolean}
     */
    #areColorSpacesCompatible(cs1, cs2) {
        if (cs1 === cs2) return true;

        const normalize = (cs) => {
            const lower = cs.toLowerCase();

            // Handle ICCBased color spaces by channel count
            // ICCBased(1) = Gray, ICCBased(3) = RGB, ICCBased(4) = CMYK
            const iccMatch = lower.match(/iccbased\((\d+)\)/);
            if (iccMatch) {
                const channels = parseInt(iccMatch[1], 10);
                if (channels === 1) return 'gray';
                if (channels === 3) return 'rgb';
                if (channels === 4) return 'cmyk';
            }

            if (lower.includes('cmyk')) return 'cmyk';
            if (lower.includes('rgb')) return 'rgb';
            if (lower.includes('gray') || lower.includes('grey')) return 'gray';
            if (lower.includes('lab')) return 'lab';
            return lower;
        };

        return normalize(cs1) === normalize(cs2);
    }

    /**
     * Calculate SHA-256 hash of a buffer (first 16 hex chars).
     *
     * @param {Uint8Array} buffer
     * @returns {string}
     */
    #hashBuffer(buffer) {
        return createHash('sha256').update(buffer).digest('hex').slice(0, 16);
    }

    /**
     * Build the result object.
     *
     * @returns {MatchResult}
     */
    #buildResult() {
        return {
            status: this.#status,
            preChecks: [...this.#preChecks],
            binaryChecks: [...this.#binaryChecks],
            matchLayer: this.#matchLayer,
            pixelCount: this.pixelCount,
            skipReason: this.#skipReason,
        };
    }

    // ────────────────────────────────────────────────────────────────────────
    // Static Factory Method
    // ────────────────────────────────────────────────────────────────────────

    /**
     * Create and execute a comparison in one call.
     *
     * @param {ImageDescriptor} reference
     * @param {ImageDescriptor} sample
     * @param {Object} [options]
     * @param {boolean} [options.strictColorSpace=false]
     * @returns {MatchResult}
     */
    static compare(reference, sample, options = {}) {
        const metrics = new ImageMatchMetrics(options);
        metrics.setReference(reference);
        metrics.setSample(sample);
        return metrics.compare();
    }
}
