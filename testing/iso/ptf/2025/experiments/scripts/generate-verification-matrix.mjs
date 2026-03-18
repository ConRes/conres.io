#!/usr/bin/env node
/**
 * Generate Verification Matrix
 *
 * Creates all PDF conversion combinations for verification.
 * Accepts a JSON configuration file with paths relative to the config file.
 *
 * Usage:
 *   node generate-verification-matrix.mjs --config=../configurations/2026-01-26-CLASSES-001.json
 *   node generate-verification-matrix.mjs --config=../configurations/2026-01-26-CLASSES-001.json --compare-only
 *   node generate-verification-matrix.mjs --config=../configurations/2026-01-26-CLASSES-001.json --output-dir=../output/2026-01-26-001
 *
 * Output naming format:
 *   [input] - [output] - [configuration] (YYYY-MM-DD-XXX).pdf
 */
// @ts-check
/// <reference types="node" />

import { spawn, spawnSync } from 'child_process';
import { mkdir, writeFile, readdir, readFile } from 'fs/promises';
import { createWriteStream, existsSync } from 'fs';
import { isWritable, isReadable } from 'stream';
import path from 'path';
import { fileURLToPath } from 'url';
import os from 'os';

// PDF-lib imports for content stream parsing (used by changes verification)
import {
    PDFDocument,
    PDFRawStream,
    PDFArray,
    PDFName,
    PDFRef,
    PDFDict,
    PDFPageLeaf,
    decodePDFRawStream,
} from 'pdf-lib';

// Import content stream parser for proper color operation parsing
import { parseContentStream, getColorOperations } from '../classes/content-stream-parser.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const experimentsDir = path.join(__dirname, '..');
const outputBaseDir = path.join(experimentsDir, 'output');

// Special profile identifiers that don't need file resolution (e.g., 'Lab' uses built-in profile)
const SPECIAL_PROFILE_IDENTIFIERS = ['Lab'];

// ============================================================================
// Configuration Loading
// ============================================================================

/**
 * Parse command line arguments
 * @returns {{ configPath: string | null, compareOnly: boolean, outputDir: string | null, usingDiagnostics: boolean }}
 */
function parseArgs() {
    const args = process.argv.slice(2);
    let configPath = null;
    let compareOnly = false;
    let outputDir = null;
    let usingDiagnostics = false;

    for (const arg of args) {
        if (arg.startsWith('--config=')) {
            configPath = arg.slice('--config='.length);
        } else if (arg === '--compare-only') {
            compareOnly = true;
        } else if (arg.startsWith('--output-dir=')) {
            outputDir = arg.slice('--output-dir='.length);
        } else if (arg === '--using-diagnostics') {
            usingDiagnostics = true;
        } else if (arg === '--help' || arg === '-h') {
            printUsage();
            process.exit(0);
        }
    }

    return { configPath, compareOnly, outputDir, usingDiagnostics };
}

function printUsage() {
    console.log(`
Generate Verification Matrix

Creates PDF color conversion combinations and compares Legacy vs Refactored outputs.

Usage:
  node generate-verification-matrix.mjs --config=<path-to-config.json> [options]

Options:
  --config=<path>      Path to JSON configuration file (REQUIRED)
  --output-dir=<path>  Override output directory (optional)
  --compare-only       Skip conversions, only run comparisons on existing files
  --using-diagnostics  Save .diagnostics.json files alongside each PDF
  --help, -h           Show this help message

Configuration File Format:
  {
    "datePrefix": "2026-01-26",
    "inputs": {
      "<name>": { "pdf": "<relative-path-to-pdf>" }
    },
    "outputs": {
      "<name>": { "profile": "<path>", "intent": "<intent>", "blackpoint-compensation": true|false }
    },
    "configurations": {
      "<name>": { "implementation": "Legacy|Refactored", "modality": "Main Thread|Workers" }
    },
    "comparison": {
      "enabled": true,
      "pairs": [
        { "expected": "<config-name>", "actual": "<config-name>" }
      ]
    }
  }

Paths in the config file are resolved relative to the config file's location.

Examples:
  node generate-verification-matrix.mjs --config=../configurations/2026-01-26-CLASSES-001.json
  node generate-verification-matrix.mjs --config=../configurations/2026-01-26-CLASSES-001.json --compare-only
`);
}

/**
 * Load and validate configuration from JSON file
 * @param {string} configPath - Path to JSON config file
 * @returns {Promise<{ jobs: object, configDir: string }>}
 */
async function loadConfig(configPath) {
    const absoluteConfigPath = path.resolve(process.cwd(), configPath);

    if (!existsSync(absoluteConfigPath)) {
        throw new Error(`Configuration file not found: ${absoluteConfigPath}`);
    }

    const configDir = path.dirname(absoluteConfigPath);
    const configContent = await readFile(absoluteConfigPath, 'utf-8');
    const config = JSON.parse(configContent);

    // Validate required fields
    if (!config.inputs || Object.keys(config.inputs).length === 0) {
        throw new Error('Configuration must have at least one input');
    }
    if (!config.outputs || Object.keys(config.outputs).length === 0) {
        throw new Error('Configuration must have at least one output');
    }
    if (!config.configurations || Object.keys(config.configurations).length === 0) {
        throw new Error('Configuration must have at least one configuration');
    }

    // Resolve paths relative to config file
    const resolvedConfig = {
        ...config,
        inputs: {},
        outputs: {},
    };

    for (const [name, input] of Object.entries(config.inputs)) {
        const pdfPath = path.resolve(configDir, input.pdf);
        if (!existsSync(pdfPath)) {
            throw new Error(`Input PDF not found: ${pdfPath} (from config: ${input.pdf})`);
        }
        resolvedConfig.inputs[name] = { ...input, pdf: pdfPath };
    }

    for (const [name, output] of Object.entries(config.outputs)) {
        if (SPECIAL_PROFILE_IDENTIFIERS.includes(output.profile)) {
            // Special identifier - pass through as-is
            resolvedConfig.outputs[name] = { ...output };
        } else {
            // File path - resolve and verify existence
            const profilePath = path.resolve(configDir, output.profile);
            if (!existsSync(profilePath)) {
                throw new Error(`ICC profile not found: ${profilePath} (from config: ${output.profile})`);
            }
            resolvedConfig.outputs[name] = { ...output, profile: profilePath };
        }
    }

    return { jobs: resolvedConfig, configDir };
}

// ============================================================================
// Helper Functions
// ============================================================================

function getOptimalWorkerCount() {
    // Same logic as WorkerPool.js
    return Math.max(1, Math.floor((os.cpus().length || 4) / 2));
}

async function getNextOutputFolderNumber(datePrefix) {
    const entries = existsSync(outputBaseDir) ? await readdir(outputBaseDir, { withFileTypes: true }) : [];
    let maxNumber = 0;

    const entryNameMatcher = /^(?<datePrefix>\d{4}-\d{2}-\d{2})-(?<sequenceNumber>\d{3})(?:(?<nameSuffix>[^\.]+)(?:\.(?<extension>.*)))?$/;

    for (const entry of entries) {

        const entryNameMatch = entry.name.match(entryNameMatcher);
        const entryNameDatePrefix = entryNameMatch?.groups?.datePrefix;
        const entryNameSequenceNumber = parseInt(entryNameMatch?.groups?.sequenceNumber ?? 'NaN', 10);

        if (entryNameSequenceNumber > maxNumber && entryNameDatePrefix === datePrefix && (
            entry.name === `${datePrefix}-${entryNameMatch.groups.sequenceNumber}` || entry.isDirectory()
        )) maxNumber = entryNameSequenceNumber;
    }

    return String(maxNumber + 1).padStart(3, '0');
}

function runConversion(args, logFile) {
    return new Promise((resolve, reject) => {
        const output = { stdout: '', stderr: '' };
        const proc = spawn('node', args, { cwd: experimentsDir, stdio: ['ignore', 'pipe', 'pipe'] });
        const logStream = createLogStream(logFile, proc.stdout, proc.stderr);

        logStream.write(`node ${[path.relative(experimentsDir, path.resolve(experimentsDir, args[0])), ...args.slice(1)].join(' ')}\n\n`);
        proc.stdout.pipe(process.stdout, { end: false });
        proc.stderr.pipe(process.stderr, { end: false });
        proc.stdout.on('data', data => { output.stdout += `${data}`; });
        proc.stderr.on('data', data => { output.stderr += `${data}`; });
        proc.on('error', reject);
        proc.on('close', code => {
            logStream.end();
            if (code === 0) resolve({ ...output, code });
            else reject(new Error(`Process exited with code ${code}`));
        });
    });
}

/**
 * @typedef {{
 *   passed: boolean,
 *   output: string,
 *   exitCode: number | null,
 *   data: {
 *     expectedFileSize: number,
 *     actualFileSize: number,
 *     fileSizeDeltaPercent: number,
 *     pageCount: { expected: number, actual: number, match: boolean },
 *     streamCount: { expected: number, actual: number, match: boolean },
 *     profileCount: { expected: number, actual: number, matching: number },
 *     imageCount: { expected: number, actual: number },
 *     images: Array<{
 *       name: string,
 *       status: string,
 *       dimensions: string,
 *       colorSpace: string,
 *       deltaE?: { avg: number, max: number, passRate: number },
 *     }>,
 *     contentStreamCount: { expected: number, actual: number },
 *   }
 * }} ComparisonResult
 */

// ============================================================================
// Changes Verification Types
// ============================================================================

/**
 * Input color specification (exact match, no tolerances).
 * @typedef {{
 *   colorspace: string,
 *   values: number[],
 * }} ColorInputSpec
 */

/**
 * Output color specification (with tolerances for verification).
 * @typedef {{
 *   colorspace: string,
 *   values: number[],
 *   tolerances: number[],
 * }} ColorOutputSpec
 */

/**
 * Change aspect with dynamic pair names.
 * The aspect has an 'input' spec plus named output specs matching the pair names.
 * @typedef {{
 *   type: 'Color',
 *   resource: 'Contents' | 'Images',
 *   input: ColorInputSpec,
 *   [pairName: string]: ColorInputSpec | ColorOutputSpec | string,
 * }} ChangeAspect
 */

/**
 * Change group with named pairs.
 * Each pair is an object with exactly 2 keys: { "Name1": "config1", "Name2": "config2" }
 * @typedef {{
 *   description: string,
 *   input: string,
 *   outputs?: string[],
 *   pairs: Array<Record<string, string>>,
 *   aspects: ChangeAspect[],
 * }} ChangeGroup
 */

/**
 * @typedef {{
 *   enabled: boolean,
 *   groups: ChangeGroup[],
 * }} ChangesConfig
 */

/**
 * A color match found in a content stream.
 * @typedef {{
 *   pageNum: number,
 *   streamIndex: number,
 *   operatorIndex: number,
 *   operator: string,
 *   colorspace: string,
 *   values: number[],
 *   index: number,
 * }} ColorMatch
 */

/**
 * Result for a single output in a verification.
 * @typedef {{
 *   name: string,
 *   config: string,
 *   expected: number[],
 *   actual: number[],
 *   matched: boolean,
 *   missing: boolean,
 * }} OutputResult
 */

/**
 * Verification result for a single color operation position.
 * Tracks the input and each output's actual values and pass/fail status.
 * @typedef {{
 *   outputName: string,
 *   pairFirstName: string,
 *   pairFirstConfig: string,
 *   pairSecondName: string,
 *   pairSecondConfig: string,
 *   pageNum: number,
 *   streamIndex: number,
 *   operatorIndex: number,
 *   operator: string,
 *   inputColorspace: string,
 *   inputValues: number[],
 *   firstExpectedColorspace: string,
 *   firstExpected: number[],
 *   firstActualColorspace: string,
 *   firstActual: number[],
 *   firstMatch: boolean,
 *   firstMissing: boolean,
 *   secondExpectedColorspace: string,
 *   secondExpected: number[],
 *   secondActualColorspace: string,
 *   secondActual: number[],
 *   secondMatch: boolean,
 *   secondMissing: boolean,
 *   passed: boolean,
 * }} ColorChangeVerification
 */

/**
 * Result of changes verification for a single group.
 * @typedef {{
 *   description: string,
 *   input: string,
 *   outputs: string[],
 *   pairs: Array<Record<string, string>>,
 *   verifications: ColorChangeVerification[],
 *   passed: boolean,
 *   failureReason: string | null,
 *   summary: {
 *     totalMatches: number,
 *     passedMatches: number,
 *     failedMatches: number,
 *   },
 * }} ChangeGroupResult
 */

/**
 * Parse file size from format like "39.26 MB", "3.1 KB", "1024 B"
 * @param {string} sizeStr
 * @returns {number} Size in bytes
 */
function parseFileSize(sizeStr) {
    const match = sizeStr.match(/([\d.]+)\s*(B|KB|MB|GB)/i);
    if (!match) return 0;
    const value = parseFloat(match[1]);
    const unit = match[2].toUpperCase();
    switch (unit) {
        case 'B': return value;
        case 'KB': return value * 1024;
        case 'MB': return value * 1024 * 1024;
        case 'GB': return value * 1024 * 1024 * 1024;
        default: return value;
    }
}

/**
 * Parse comparison output to extract structured data
 * @param {string} output - Raw comparison output
 * @returns {ComparisonResult['data']}
 */
function parseComparisonOutput(output) {
    const data = {
        expectedFileSize: 0,
        actualFileSize: 0,
        fileSizeDeltaPercent: 0,
        pageCount: { expected: 0, actual: 0, match: false },
        streamCount: { expected: 0, actual: 0, match: false },
        profileCount: { expected: 0, actual: 0, matching: 0 },
        imageCount: { expected: 0, actual: 0 },
        images: /** @type {Array<{name: string, status: string, dimensions: string, colorSpace: string, deltaE?: {avg: number, max: number, passRate: number}}>} */ ([]),
        contentStreamCount: { expected: 0, actual: 0 },
    };

    // Parse file size: "File size:      MATCH  39.26 MB → 39.22 MB (-0.1%)"
    const fileSizeMatch = output.match(/File size:.*?([\d.]+\s*(?:B|KB|MB|GB))\s*→\s*([\d.]+\s*(?:B|KB|MB|GB))\s*\(([-+]?[\d.]+)%\)/i);
    if (fileSizeMatch) {
        data.expectedFileSize = parseFileSize(fileSizeMatch[1]);
        data.actualFileSize = parseFileSize(fileSizeMatch[2]);
        data.fileSizeDeltaPercent = parseFloat(fileSizeMatch[3]);
    }

    // Parse page count: "Page count:     MATCH  1 → 1"
    const pageMatch = output.match(/Page count:.*?(\d+)\s*→\s*(\d+)/);
    if (pageMatch) {
        data.pageCount.expected = parseInt(pageMatch[1], 10);
        data.pageCount.actual = parseInt(pageMatch[2], 10);
        data.pageCount.match = data.pageCount.expected === data.pageCount.actual;
    }

    // Parse stream count: "Stream count:   MATCH  20 → 20"
    const streamMatch = output.match(/Stream count:.*?(\d+)\s*→\s*(\d+)/);
    if (streamMatch) {
        data.streamCount.expected = parseInt(streamMatch[1], 10);
        data.streamCount.actual = parseInt(streamMatch[2], 10);
        data.streamCount.match = data.streamCount.expected === data.streamCount.actual;
    }

    // Parse ICC profiles: "Expected: 3 profile(s)" and "Actual:   3 profile(s)" and "Hash match:     MATCH  3/3 matching"
    const profileExpMatch = output.match(/Expected:\s*(\d+)\s*profile/);
    const profileActMatch = output.match(/Actual:\s*(\d+)\s*profile/);
    const profileHashMatch = output.match(/Hash match:.*?(\d+)\/(\d+)\s*matching/);
    if (profileExpMatch) data.profileCount.expected = parseInt(profileExpMatch[1], 10);
    if (profileActMatch) data.profileCount.actual = parseInt(profileActMatch[1], 10);
    if (profileHashMatch) data.profileCount.matching = parseInt(profileHashMatch[1], 10);

    // Parse image count: "Expected: 9 image(s)" and "Actual:   9 image(s)"
    const imageExpMatch = output.match(/Expected:\s*(\d+)\s*image/);
    const imageActMatch = output.match(/Actual:\s*(\d+)\s*image/);
    if (imageExpMatch) data.imageCount.expected = parseInt(imageExpMatch[1], 10);
    if (imageActMatch) data.imageCount.actual = parseInt(imageActMatch[1], 10);

    // Parse individual images: "Im0: MATCH 3812×2750 DeviceCMYK (∆E avg=0.75 max=4.96 (98% ≤3))"
    const imageRegex = /(\w+):\s*(?:\x1b\[\d+m)?(MATCH|SIMILAR|DIFFER)(?:\x1b\[0m)?\s+(\d+[x×]\d+)\s+(\S+)\s*(?:\(([^)]+)\))?/g;
    let match;
    while ((match = imageRegex.exec(output)) !== null) {
        const imageData = {
            name: match[1],
            status: match[2],
            dimensions: match[3],
            colorSpace: match[4],
            deltaE: /** @type {{avg: number, max: number, passRate: number} | undefined} */ (undefined),
        };

        // Parse ∆E if present: "∆E avg=0.75 max=4.96 (98% ≤3)"
        if (match[5]) {
            const deltaEMatch = match[5].match(/∆E\s+avg=([\d.]+)\s+max=([\d.]+)\s*\((\d+)%/);
            if (deltaEMatch) {
                imageData.deltaE = {
                    avg: parseFloat(deltaEMatch[1]),
                    max: parseFloat(deltaEMatch[2]),
                    passRate: parseInt(deltaEMatch[3], 10),
                };
            }
        }

        data.images.push(imageData);
    }

    // Parse content stream count: "Expected: 8 stream(s)" (under Content Streams section)
    const contentStreamSection = output.match(/Content Streams[\s\S]*?Expected:\s*(\d+)\s*stream[\s\S]*?Actual:\s*(\d+)\s*stream/);
    if (contentStreamSection) {
        data.contentStreamCount.expected = parseInt(contentStreamSection[1], 10);
        data.contentStreamCount.actual = parseInt(contentStreamSection[2], 10);
    }

    return data;
}

/**
 * Run comparison between two PDFs using compare-pdf-color.js
 * @param {string} expectedPath - Path to expected (Legacy) PDF
 * @param {string} actualPath - Path to actual (Refactored) PDF
 * @returns {ComparisonResult}
 */
function runComparison(expectedPath, actualPath) {
    const comparePdfPath = path.join(experimentsDir, 'compare-pdf-color.js');

    // Always run with --verbose to get full comparison details
    const result = spawnSync('node', [comparePdfPath, expectedPath, actualPath, '--verbose'], {
        cwd: experimentsDir,
        encoding: 'utf-8',
        timeout: 300000, // 5 minute timeout
    });

    const output = (result.stdout || '') + (result.stderr || '');
    const passed = result.status === 0;
    const data = parseComparisonOutput(output);

    return { passed, output, exitCode: result.status, data };
}

// ============================================================================
// Diagnostics Comparison
// ============================================================================

/**
 * @typedef {{
 *   name: string,
 *   engine?: string,
 *   totalTime: number,
 *   pages: number,
 *   images: number,
 *   streams: number,
 *   ops: number,
 *   errors: number,
 *   breakdown: {
 *     readPdf: number,
 *     loadPdf: number,
 *     readProfile: number,
 *     serializePdf: number,
 *     writePdf: number,
 *     documentConversion: number,
 *     imageDecoding: number,
 *     imageTransform: number,
 *     imageEncoding: number,
 *     imageTotalWasm: number,
 *     streamParsing: number,
 *     streamConvert: number,
 *     streamRebuild: number,
 *     streamTotalWasm: number,
 *     bootstrapTime: number,
 *     transitionTime: number,
 *     teardownTime: number,
 *   },
 *   pageDetails: Array<{
 *     pageIndex: number,
 *     time: number,
 *     images: number,
 *     streams: number,
 *     ops: number,
 *   }>,
 * }} DiagnosticsSummary
 */

/**
 * @typedef {{
 *   expected: DiagnosticsSummary,
 *   actual: DiagnosticsSummary,
 *   deltas: {
 *     totalTime: number,
 *     totalTimePercent: number,
 *     pages: number,
 *     images: number,
 *     streams: number,
 *     ops: number,
 *     breakdown: DiagnosticsSummary['breakdown'],
 *   },
 * }} DiagnosticsComparison
 */

/**
 * Extract breakdown times by recursively traversing the diagnostics tree
 * @param {any[]} spans - Array of span objects
 * @param {DiagnosticsSummary['breakdown']} breakdown - Breakdown object to populate
 */
function extractBreakdownTimes(spans, breakdown) {
    for (const span of spans) {
        const time = span.metrics?.['time (inc)'] || span.metrics?.time || 0;

        switch (span.name) {
            // File I/O
            case 'read-pdf':
                breakdown.readPdf += time;
                break;
            case 'load-pdf':
                breakdown.loadPdf += time;
                break;
            case 'read-profile':
                breakdown.readProfile += time;
                break;
            case 'serialize-pdf':
                breakdown.serializePdf += time;
                break;
            case 'write-pdf':
                breakdown.writePdf += time;
                break;

            // Document conversion (root conversion span)
            case 'document-conversion':
                breakdown.documentConversion += time;
                break;

            // Image processing
            case 'decode':
                breakdown.imageDecoding += time;
                break;
            case 'transform':
                breakdown.imageTransform += time;
                breakdown.imageTotalWasm += time; // Transform is WASM
                break;
            case 'encode':
                breakdown.imageEncoding += time;
                break;

            // Content stream processing
            case 'parse':
                breakdown.streamParsing += time;
                break;
            case 'convert':
                // Convert includes build-lookup-table (WASM)
                breakdown.streamConvert += time;
                break;
            case 'rebuild':
                breakdown.streamRebuild += time;
                break;
            case 'build-lookup-table':
                // This is the WASM call for color conversion in content streams
                breakdown.streamTotalWasm += time;
                break;

            // Legacy format: stream-batch with colorsConverted
            case 'stream-batch':
                if (span.metrics?.colorsConverted !== undefined) {
                    // Legacy format - the whole stream-batch is WASM time
                    breakdown.streamTotalWasm += time;
                    breakdown.streamConvert += time;
                }
                break;
        }

        // Recurse into children
        if (span.children && span.children.length > 0) {
            extractBreakdownTimes(span.children, breakdown);
        }
    }
}

/**
 * Create an empty breakdown object
 * @returns {DiagnosticsSummary['breakdown']}
 */
function createEmptyBreakdown() {
    return {
        readPdf: 0,
        loadPdf: 0,
        readProfile: 0,
        serializePdf: 0,
        writePdf: 0,
        documentConversion: 0,
        imageDecoding: 0,
        imageTransform: 0,
        imageEncoding: 0,
        imageTotalWasm: 0,
        streamParsing: 0,
        streamConvert: 0,
        streamRebuild: 0,
        streamTotalWasm: 0,
        bootstrapTime: 0,
        transitionTime: 0,
        teardownTime: 0,
    };
}

/**
 * Calculate bootstrap, transition, and teardown times
 * @param {DiagnosticsSummary['breakdown']} breakdown
 * @param {number} totalTime - Total wall-clock time
 */
function calculateUnaccountedTime(breakdown, totalTime) {
    // Sum all accounted time
    const accountedTime =
        breakdown.readPdf +
        breakdown.loadPdf +
        breakdown.readProfile +
        breakdown.documentConversion +
        breakdown.serializePdf +
        breakdown.writePdf;

    // Unaccounted time is split into bootstrap (before first span) and teardown (after last span)
    // Since we can't determine exact positions without timestamps, we attribute to transition
    const unaccountedTime = Math.max(0, totalTime - accountedTime);
    breakdown.transitionTime = unaccountedTime;
}

/**
 * Load and summarize a diagnostics JSON file
 * @param {string} filePath - Path to .diagnostics.json file
 * @returns {Promise<DiagnosticsSummary | null>}
 */
async function loadDiagnosticsSummary(filePath) {
    try {
        const content = await readFile(filePath, 'utf-8');
        const data = JSON.parse(content);

        // The diagnostics JSON is an array of root spans
        if (!Array.isArray(data) || data.length === 0) return null;

        // Find document-conversion span
        const docConvSpan = data.find(s => s.name === 'document-conversion');
        if (!docConvSpan) return null;

        const breakdown = createEmptyBreakdown();

        // Extract breakdown times from all spans
        extractBreakdownTimes(data, breakdown);

        // Calculate total time from the document-conversion span
        const docConvTime = docConvSpan.metrics?.['time (inc)'] || 0;

        // Get total time including file I/O (if available)
        const totalTime = breakdown.readPdf + breakdown.loadPdf + breakdown.readProfile +
            docConvTime + breakdown.serializePdf + breakdown.writePdf;

        // Use the larger of calculated total or docConvTime as the effective total
        const effectiveTotal = Math.max(totalTime, docConvTime);

        // Calculate unaccounted time
        calculateUnaccountedTime(breakdown, effectiveTotal);

        const summary = {
            name: path.basename(filePath).replace('.diagnostics.json', ''),
            engine: docConvSpan.attributes?.engine || undefined,
            totalTime: effectiveTotal,
            pages: docConvSpan.metrics?.pages || 0,
            images: docConvSpan.metrics?.images || docConvSpan.metrics?.totalImageConversions || 0,
            streams: docConvSpan.metrics?.streams || 0,
            ops: docConvSpan.metrics?.ops || docConvSpan.metrics?.totalContentStreamConversions || 0,
            errors: docConvSpan.metrics?.errors || 0,
            breakdown,
            pageDetails: /** @type {DiagnosticsSummary['pageDetails']} */ ([]),
        };

        // Extract per-page details
        if (docConvSpan.children) {
            for (const child of docConvSpan.children) {
                if (child.name === 'page') {
                    summary.pageDetails.push({
                        pageIndex: child.attributes?.pageIndex ?? -1,
                        time: child.metrics?.['time (inc)'] || child.metrics?.time || 0,
                        images: child.metrics?.images || child.metrics?.imageConversions || 0,
                        streams: child.metrics?.streams || 0,
                        ops: child.metrics?.ops || child.metrics?.contentStreamConversions || 0,
                    });
                }
            }
        }

        return summary;
    } catch (e) {
        console.warn(`Failed to load diagnostics: ${filePath}: ${e.message}`);
        return null;
    }
}

/**
 * Compare two diagnostics summaries
 * @param {DiagnosticsSummary} expected
 * @param {DiagnosticsSummary} actual
 * @returns {DiagnosticsComparison}
 */
function compareDiagnostics(expected, actual) {
    const timeDelta = actual.totalTime - expected.totalTime;
    const timePercent = expected.totalTime > 0 ? (timeDelta / expected.totalTime) * 100 : 0;

    // Calculate breakdown deltas
    /** @type {DiagnosticsSummary['breakdown']} */
    const breakdownDeltas = createEmptyBreakdown();
    for (const key of Object.keys(breakdownDeltas)) {
        const k = /** @type {keyof DiagnosticsSummary['breakdown']} */ (key);
        breakdownDeltas[k] = actual.breakdown[k] - expected.breakdown[k];
    }

    return {
        expected,
        actual,
        deltas: {
            totalTime: timeDelta,
            totalTimePercent: timePercent,
            pages: actual.pages - expected.pages,
            images: actual.images - expected.images,
            streams: actual.streams - expected.streams,
            ops: actual.ops - expected.ops,
            breakdown: breakdownDeltas,
        },
    };
}

/**
 * Format time in milliseconds for display
 * @param {number} seconds
 * @returns {string}
 */
function formatTime(seconds) {
    if (seconds < 0.001) return `${(seconds * 1000000).toFixed(0)}µs`;
    if (seconds < 1) return `${(seconds * 1000).toFixed(1)}ms`;
    return `${seconds.toFixed(2)}s`;
}

/**
 * Format delta with sign
 * @param {number} value
 * @param {string} [suffix='']
 * @returns {string}
 */
function formatDelta(value, suffix = '') {
    const sign = value > 0 ? '+' : '';
    return `${sign}${value.toFixed(2)}${suffix}`;
}

/**
 * 
 * @param {string} logPath 
 * @param {...NodeJS.WritableStream | NodeJS.ReadableStream} streams 
 */
function createLogStream(logPath, ...streams) {
    const logStream = createWriteStream(logPath, { flags: 'w' });
    const ansiMatcher = /(?<OSC>\u001B\][\s\S]*?(?<ST>>\u0007|\u001B\u005C|\u009C))|(?<CSI>[\u001B\u009B][[\]()#;?]*(?:\d{1,4}(?:[;:]\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~])/ug;

    // /** @param {*} data */
    // const handler = data => { logStream.write(`${data}`.replace(ansiMatcher, '')); };
    /** @type {ProxyHandler<NodeJS.WritableStream['write']>} */
    const proxyHandler = {
        apply(target, thisArgument, applyArguments) {
            if (streams.includes(thisArgument))
                logStream.write(`${applyArguments[0]}`.replace(ansiMatcher, ''));
            return Reflect.apply(target, thisArgument, applyArguments);
        },
    };
    const hooks = [...new Set(streams)].map(stream => {
        // console.dir(stream, { compact: true, depth: 2 });
        if (
            isReadable(stream)
            && typeof stream.pipe === 'function'
            && stream !== process.stdout
            && stream !== process.stderr
        ) {
            // console.log(`Piping log proxy for stream: ${stream}`);
            stream.pipe(logStream, { end: false });
            return null;
        }
        if (isWritable(stream) && typeof stream.write === 'function') {
            // console.log(`Creating log proxy for stream: ${stream}`);
            const target = stream.write;
            const proxy = stream.write = new Proxy(stream.write, proxyHandler);
            return Reflect.ownKeys(stream).includes('write') ? {
                dispose: () => { if (stream.write === proxy) stream.write = target; }
            } : {
                dispose: () => { if (stream.write === proxy) delete stream.write; }
            };
        }

        console.warn(`Stream is not writable: ${stream}`);
        return null;
    });

    logStream.on('close', () => {
        // hooks.forEach(hook => hook?.dispose?.());
        // delete proxyHandler.apply;
    });

    process.on('exit', () => { logStream.end(); });

    return logStream;
}

// ============================================================================
// Changes Verification
// ============================================================================

/**
 * Extract colorspace definitions from a page's Resources.
 * Maps colorspace names (CS0, CS1, etc.) to their actual types (sRGB, sGray, Lab, etc.).
 *
 * @param {PDFDict} pageDict - Page dictionary
 * @param {import('pdf-lib').PDFContext} context - PDF context
 * @returns {Record<string, {colorSpaceType: string, range?: number[]}>}
 */
function extractColorSpaceDefinitions(pageDict, context) {
    /** @type {Record<string, {colorSpaceType: string, range?: number[]}>} */
    const definitions = {};

    const resources = pageDict.get(PDFName.of('Resources'));
    if (!resources) return definitions;

    const resourcesDict = resources instanceof PDFRef
        ? context.lookup(resources)
        : resources;
    if (!(resourcesDict instanceof PDFDict)) return definitions;

    const colorSpaceDict = resourcesDict.get(PDFName.of('ColorSpace'));
    if (!colorSpaceDict) return definitions;

    const csDict = colorSpaceDict instanceof PDFRef
        ? context.lookup(colorSpaceDict)
        : colorSpaceDict;
    if (!(csDict instanceof PDFDict)) return definitions;

    for (const [key, value] of csDict.entries()) {
        const csName = key.asString().replace(/^\//, '');

        let csDescriptor = value;
        if (csDescriptor instanceof PDFRef) {
            csDescriptor = context.lookup(csDescriptor);
        }

        if (csDescriptor instanceof PDFName) {
            const typeName = csDescriptor.asString().replace(/^\//, '');
            definitions[csName] = {
                colorSpaceType: normalizeColorSpaceType(typeName),
            };
        } else if (csDescriptor instanceof PDFArray && csDescriptor.size() > 0) {
            const csType = csDescriptor.get(0);
            if (csType instanceof PDFName) {
                const typeName = csType.asString().replace(/^\//, '');
                /** @type {{colorSpaceType: string, range?: number[]}} */
                const def = { colorSpaceType: typeName };

                // Handle ICCBased - extract actual color space from ICC profile header
                if (typeName === 'ICCBased' && csDescriptor.size() > 1) {
                    const iccRef = csDescriptor.get(1);
                    const iccStream = iccRef instanceof PDFRef
                        ? context.lookup(iccRef)
                        : iccRef;

                    if (iccStream instanceof PDFRawStream) {
                        const profileData = /** @type {Uint8Array} */ (decodePDFRawStream(iccStream).decode());
                        const iccColorSpace = getICCColorSpace(profileData);
                        def.colorSpaceType = normalizeColorSpaceType(iccColorSpace);
                    }
                }
                // Handle Lab color space
                else if (typeName === 'Lab' && csDescriptor.size() > 1) {
                    def.colorSpaceType = 'Lab';
                    const labDict = csDescriptor.get(1);
                    const labDictResolved = labDict instanceof PDFRef
                        ? context.lookup(labDict)
                        : labDict;

                    if (labDictResolved instanceof PDFDict) {
                        const rangeArray = labDictResolved.get(PDFName.of('Range'));
                        if (rangeArray instanceof PDFArray) {
                            def.range = rangeArray.asArray().map(n => n.asNumber?.() ?? 0);
                        } else {
                            def.range = [-100, 100, -100, 100];
                        }
                    }
                }
                // Handle Separation color space
                else if (typeName === 'Separation') {
                    def.colorSpaceType = 'Separation';
                }

                definitions[csName] = def;
            }
        }
    }

    return definitions;
}

/**
 * Gets the color space from an ICC profile header.
 * @param {Uint8Array} profileData - Decompressed ICC profile data
 * @returns {string} Color space type ('Gray', 'RGB', 'CMYK', or 'Unknown')
 */
function getICCColorSpace(profileData) {
    if (profileData.length < 20) return 'Unknown';

    // ICC color space is at offset 16, 4 bytes
    const colorSpaceBytes = profileData.slice(16, 20);
    const colorSpace = String.fromCharCode(...colorSpaceBytes).trim();

    switch (colorSpace) {
        case 'GRAY': return 'Gray';
        case 'RGB': return 'RGB';
        case 'CMYK': return 'CMYK';
        case 'Lab': return 'Lab';
        default: return 'Unknown';
    }
}

/**
 * Normalizes color space type names for consistent handling.
 * @param {string} typeName - Raw color space type name
 * @returns {string} Normalized type (sGray, sRGB, Lab, CMYK, etc.)
 */
function normalizeColorSpaceType(typeName) {
    switch (typeName) {
        case 'Gray':
        case 'DeviceGray':
            return 'sGray';
        case 'RGB':
        case 'DeviceRGB':
            return 'sRGB';
        case 'CMYK':
        case 'DeviceCMYK':
            return 'CMYK';
        case 'Lab':
            return 'Lab';
        case 'Separation':
            return 'Separation';
        default:
            return typeName;
    }
}

/**
 * Maps colorspace type to user-friendly display name.
 * @param {string} colorSpaceType - Internal colorspace type (sRGB, sGray, Lab, CMYK, Separation)
 * @returns {string} Display colorspace name
 */
function getDisplayColorspace(colorSpaceType) {
    switch (colorSpaceType) {
        case 'sRGB': return 'ICCBasedRGB';
        case 'sGray': return 'ICCBasedGray';
        case 'CMYK': return 'ICCBasedCMYK';
        case 'Lab': return 'Lab';
        case 'Separation': return 'Separation';
        default: return colorSpaceType || 'Unknown';
    }
}

/**
 * Extract all color operations from a PDF's content streams.
 * Uses original regex-based counting (for correct positional matching) with
 * colorspace state tracking (for correct colorspace names).
 *
 * @param {string} pdfPath - Path to PDF file
 * @returns {Promise<ColorMatch[]>} Array of color matches with positions
 */
async function extractColorsFromPDF(pdfPath) {
    const pdfBytes = await readFile(pdfPath);
    const pdfDoc = await PDFDocument.load(pdfBytes);
    const context = pdfDoc.context;
    const pages = pdfDoc.getPages();

    /** @type {ColorMatch[]} */
    const matches = [];

    for (let pageIdx = 0; pageIdx < pages.length; pageIdx++) {
        const pageNum = pageIdx + 1;
        const page = pages[pageIdx];
        const pageNode = /** @type {PDFPageLeaf} */ (page.node);
        const pageDict = /** @type {PDFDict} */ (pageNode);

        // Extract colorspace definitions from page Resources
        const colorSpaceDefinitions = extractColorSpaceDefinitions(pageDict, context);

        // Get content streams
        const contents = pageNode.get(PDFName.of('Contents'));
        /** @type {PDFRef[]} */
        const streamRefs = [];

        if (contents instanceof PDFRef) {
            const resolved = context.lookup(contents);
            if (resolved instanceof PDFArray) {
                for (let i = 0; i < resolved.size(); i++) {
                    const ref = resolved.get(i);
                    if (ref instanceof PDFRef) streamRefs.push(ref);
                }
            } else {
                streamRefs.push(contents);
            }
        } else if (contents instanceof PDFArray) {
            for (let i = 0; i < contents.size(); i++) {
                const ref = contents.get(i);
                if (ref instanceof PDFRef) streamRefs.push(ref);
            }
        }

        // Track colorspace state across streams (PDF graphics state carries over)
        /** @type {import('./classes/content-stream-parser.mjs').ColorSpaceState} */
        let colorSpaceState = {};

        for (let streamIdx = 0; streamIdx < streamRefs.length; streamIdx++) {
            const ref = streamRefs[streamIdx];
            const stream = context.lookup(ref);
            if (!(stream instanceof PDFRawStream)) continue;

            try {
                const decoded = decodePDFRawStream(stream).decode();
                const text = new TextDecoder().decode(decoded);

                // Use the shared parser (same logic as PDFContentStreamColorConverter)
                const parseResult = parseContentStream(text, colorSpaceState);
                colorSpaceState = parseResult.finalState;

                // Get only color-setting operations (not colorspace changes)
                const colorOps = getColorOperations(parseResult.operations);

                // Assign operator indices and build matches
                for (let opIdx = 0; opIdx < colorOps.length; opIdx++) {
                    const op = colorOps[opIdx];

                    // Determine colorspace name for display
                    let colorspace;
                    if (op.type === 'gray') {
                        colorspace = 'DeviceGray';
                    } else if (op.type === 'rgb') {
                        colorspace = 'DeviceRGB';
                    } else if (op.type === 'cmyk') {
                        colorspace = 'DeviceCMYK';
                    } else if (op.type === 'indexed' && op.colorSpaceName) {
                        // Look up actual colorspace type from definitions
                        const csDef = colorSpaceDefinitions[op.colorSpaceName];
                        if (csDef) {
                            colorspace = getDisplayColorspace(csDef.colorSpaceType);
                        } else {
                            // Fallback: infer from value count
                            const values = op.values ?? [];
                            if (values.length === 1) colorspace = 'ICCBasedGray';
                            else if (values.length === 3) colorspace = 'ICCBasedRGB';
                            else if (values.length === 4) colorspace = 'ICCBasedCMYK';
                            else colorspace = 'Unknown';
                        }
                    } else {
                        colorspace = 'Unknown';
                    }

                    matches.push({
                        pageNum,
                        streamIndex: streamIdx,
                        operatorIndex: opIdx,
                        operator: op.operator,
                        colorspace,
                        values: op.values ?? [],
                        index: op.index,
                    });
                }
            } catch (e) {
                console.warn(`Failed to decode content stream on page ${pageNum}, stream ${streamIdx}: ${/** @type {Error} */ (e).message}`);
            }
        }
    }

    return matches;
}

/**
 * Check if two arrays of values match within tolerances.
 * @param {number[]} actual - Actual values
 * @param {number[]} expected - Expected values
 * @param {number[]} tolerances - Tolerance for each value
 * @returns {boolean}
 */
function valuesMatchWithinTolerance(actual, expected, tolerances) {
    if (actual.length !== expected.length) return false;
    for (let i = 0; i < actual.length; i++) {
        const tolerance = tolerances[i] ?? 0;
        if (Math.abs(actual[i] - expected[i]) > tolerance) {
            return false;
        }
    }
    return true;
}

/**
 * Find color matches that correspond to the input specification.
 * Matches colors based on the input colorspace type and values.
 * @param {ColorMatch[]} inputColors - Colors from input PDF (source document)
 * @param {ColorInputSpec} inputSpec - Input color specification
 * @returns {ColorMatch[]} Matching colors
 */
function findMatchingInputColors(inputColors, inputSpec) {
    const epsilon = 0.0001; // Very small tolerance for floating point comparison

    return inputColors.filter(color => {
        // Colorspace must match exactly (from the extracted colorspace tracking)
        if (color.colorspace !== inputSpec.colorspace) {
            return false;
        }

        // Value count must match
        if (color.values.length !== inputSpec.values.length) {
            return false;
        }

        // Values must match within epsilon
        const valuesMatch = color.values.every((v, i) =>
            Math.abs(v - inputSpec.values[i]) < epsilon
        );

        return valuesMatch;
    });
}

/**
 * Verify changes between first and second PDFs for a given aspect.
 * Matches positions based on INPUT values, then checks output values at those positions.
 * @param {object} jobs - Job configuration
 * @param {Map<string, string>} outputFiles - Map of config keys to output file paths
 * @param {ChangeGroup} group - Change group to verify
 * @param {number} workerCount - Worker count for resolving config names
 * @returns {Promise<ChangeGroupResult>}
 */
async function verifyChangeGroup(jobs, outputFiles, group, workerCount) {
    /** @type {ColorChangeVerification[]} */
    const verifications = [];
    /** @type {string | null} */
    let failureReason = null;
    /** @type {string[]} */
    const missingPdfPairs = [];

    // Use group.outputs if specified, otherwise use all job outputs
    const outputNames = group.outputs ?? Object.keys(jobs.outputs);

    // Get input PDF path
    const inputConfig = jobs.inputs[group.input];
    if (!inputConfig) {
        failureReason = `Input not found in jobs.inputs: ${group.input}`;
        return {
            description: group.description,
            input: group.input,
            outputs: outputNames,
            pairs: group.pairs,
            verifications,
            passed: false,
            failureReason,
            summary: { totalMatches: 0, passedMatches: 0, failedMatches: 0 },
        };
    }

    const inputPdfPath = inputConfig.pdf;
    if (!existsSync(inputPdfPath)) {
        failureReason = `Input PDF not found: ${inputPdfPath}`;
        return {
            description: group.description,
            input: group.input,
            outputs: outputNames,
            pairs: group.pairs,
            verifications,
            passed: false,
            failureReason,
            summary: { totalMatches: 0, passedMatches: 0, failedMatches: 0 },
        };
    }

    // Extract all colors from input PDF
    const inputColors = await extractColorsFromPDF(inputPdfPath);

    for (const pair of group.pairs) {
        // Extract the two pair names and their configurations
        const pairEntries = Object.entries(pair);
        if (pairEntries.length !== 2) {
            console.warn(`  Invalid pair: expected exactly 2 entries, got ${pairEntries.length}`);
            continue;
        }

        const [[firstName, firstConfig], [secondName, secondConfig]] = pairEntries;

        for (const outputName of outputNames) {
            const firstKey = `${group.input}|${outputName}|${firstConfig}`;
            const secondKey = `${group.input}|${outputName}|${secondConfig}`;

            const firstPdfPath = outputFiles.get(firstKey);
            const secondPdfPath = outputFiles.get(secondKey);

            if (!firstPdfPath || !secondPdfPath) {
                const missingConfigs = [];
                if (!firstPdfPath) missingConfigs.push(`${firstName} (${firstConfig})`);
                if (!secondPdfPath) missingConfigs.push(`${secondName} (${secondConfig})`);
                const pairDesc = `${outputName}: ${missingConfigs.join(', ')}`;
                missingPdfPairs.push(pairDesc);
                console.warn(`  Missing output PDF paths for pair: ${firstName} / ${secondName}, output: ${outputName}`);
                continue;
            }

            const firstExists = existsSync(firstPdfPath);
            const secondExists = existsSync(secondPdfPath);

            if (!firstExists) {
                console.warn(`  First PDF not found: ${firstPdfPath}`);
            }
            if (!secondExists) {
                console.warn(`  Second PDF not found: ${secondPdfPath}`);
            }

            // Extract colors from output PDFs (if they exist)
            const firstColors = firstExists ? await extractColorsFromPDF(firstPdfPath) : [];
            const secondColors = secondExists ? await extractColorsFromPDF(secondPdfPath) : [];

            for (const aspect of group.aspects) {
                if (aspect.type !== 'Color' || aspect.resource !== 'Contents') {
                    console.warn(`  Unsupported aspect: type=${aspect.type}, resource=${aspect.resource}`);
                    continue;
                }

                // Get the expected values for each pair member from the aspect
                const firstSpec = /** @type {ColorOutputSpec} */ (aspect[firstName]);
                const secondSpec = /** @type {ColorOutputSpec} */ (aspect[secondName]);

                if (!firstSpec || !secondSpec) {
                    console.warn(`  Aspect missing specs for pair names: ${firstName}, ${secondName}`);
                    continue;
                }

                // Find colors in INPUT PDF that match the input specification
                const inputMatches = findMatchingInputColors(inputColors, aspect.input);

                if (inputMatches.length === 0) {
                    // No matching input colors found - skip this aspect silently
                    // (it means this aspect doesn't apply to this input file)
                    continue;
                }

                // For each matched input position, check corresponding output positions
                for (const inputMatch of inputMatches) {
                    // Find corresponding color in FIRST output at same position
                    const firstOutputMatch = firstColors.find(c =>
                        c.pageNum === inputMatch.pageNum &&
                        c.streamIndex === inputMatch.streamIndex &&
                        c.operatorIndex === inputMatch.operatorIndex
                    );

                    // Find corresponding color in SECOND output at same position
                    const secondOutputMatch = secondColors.find(c =>
                        c.pageNum === inputMatch.pageNum &&
                        c.streamIndex === inputMatch.streamIndex &&
                        c.operatorIndex === inputMatch.operatorIndex
                    );

                    const firstMissing = !firstOutputMatch;
                    const secondMissing = !secondOutputMatch;

                    const firstActualValues = firstOutputMatch?.values ?? [];
                    const secondActualValues = secondOutputMatch?.values ?? [];

                    const firstMatchesExpected = firstOutputMatch
                        ? valuesMatchWithinTolerance(firstOutputMatch.values, firstSpec.values, firstSpec.tolerances)
                        : false;

                    const secondMatchesExpected = secondOutputMatch
                        ? valuesMatchWithinTolerance(secondOutputMatch.values, secondSpec.values, secondSpec.tolerances)
                        : false;

                    // Both must match their expected values to pass
                    const passed = firstMatchesExpected && secondMatchesExpected;

                    verifications.push({
                        outputName,
                        pairFirstName: firstName,
                        pairFirstConfig: firstConfig,
                        pairSecondName: secondName,
                        pairSecondConfig: secondConfig,
                        pageNum: inputMatch.pageNum,
                        streamIndex: inputMatch.streamIndex,
                        operatorIndex: inputMatch.operatorIndex,
                        operator: inputMatch.operator,
                        inputColorspace: aspect.input.colorspace,
                        inputValues: inputMatch.values,
                        firstExpectedColorspace: firstSpec.colorspace,
                        firstExpected: firstSpec.values,
                        firstActualColorspace: firstOutputMatch?.colorspace ?? '',
                        firstActual: firstActualValues,
                        firstMatch: firstMatchesExpected,
                        firstMissing,
                        secondExpectedColorspace: secondSpec.colorspace,
                        secondExpected: secondSpec.values,
                        secondActualColorspace: secondOutputMatch?.colorspace ?? '',
                        secondActual: secondActualValues,
                        secondMatch: secondMatchesExpected,
                        secondMissing,
                        passed,
                    });
                }
            }
        }
    }

    const passed = verifications.length > 0 && verifications.every(v => v.passed);
    const passedCount = verifications.filter(v => v.passed).length;
    const failedCount = verifications.filter(v => !v.passed).length;

    if (verifications.length === 0 && !failureReason) {
        if (missingPdfPairs.length > 0) {
            // Report missing PDFs as the failure reason
            failureReason = `Missing output PDFs for configurations: ${missingPdfPairs.join('; ')}`;
        } else {
            failureReason = 'No matching input colors found in input PDF';
        }
    }

    return {
        description: group.description,
        input: group.input,
        outputs: outputNames,
        pairs: group.pairs,
        verifications,
        passed,
        failureReason,
        summary: {
            totalMatches: verifications.length,
            passedMatches: passedCount,
            failedMatches: failedCount,
        },
    };
}

/**
 * Run changes verification if enabled in configuration.
 * @param {object} jobs - Job configuration
 * @param {Map<string, string>} outputFiles - Map of config keys to output file paths
 * @param {number} workerCount - Worker count for resolving config names
 * @returns {Promise<ChangeGroupResult[] | null>}
 */
async function verifyChanges(jobs, outputFiles, workerCount) {
    if (!jobs.changes?.enabled || !jobs.changes.groups?.length) {
        return null;
    }

    console.log('='.repeat(80));
    console.log('Verifying Changes (Before vs After)');
    console.log('='.repeat(80));
    console.log('');

    /** @type {ChangeGroupResult[]} */
    const results = [];

    for (const group of jobs.changes.groups) {
        // Skip disabled groups
        if (group.enabled === false) {
            console.log(`Skipping disabled group: ${group.description}`);
            continue;
        }
        console.log(`Verifying: ${group.description}`);
        const result = await verifyChangeGroup(jobs, outputFiles, group, workerCount);
        results.push(result);

        console.log(`  Matches found: ${result.summary.totalMatches}`);
        console.log(`  Passed: ${result.summary.passedMatches}, Failed: ${result.summary.failedMatches}`);
        console.log(`  Status: ${result.passed ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m'}`);
        console.log('');
    }

    return results;
}

// ============================================================================
// Main
// ============================================================================

async function main() {
    const { configPath, compareOnly, outputDir: outputDirArg, usingDiagnostics } = parseArgs();

    if (!configPath) {
        console.error('Error: --config=<path> is required\n');
        printUsage();
        process.exit(1);
    }

    // When --output-dir is provided, derive the suffix from the directory name
    // Otherwise generate the next available folder number
    const outputSuffix = outputDirArg
        ? path.basename(outputDirArg).match(/^\d{4}-\d{2}-\d{2}-\d{3}|^.*$/)?.[0]
        : await (async datePrefix => `${datePrefix}-${await getNextOutputFolderNumber(datePrefix)}`)(new Date().toLocaleDateString("en-CA"));
    const outputDir = outputDirArg
        ? path.resolve(process.cwd(), outputDirArg)
        : path.join(outputBaseDir, outputSuffix);
    // const { outputDir, outputSuffix } = await (async () => {
    //     let outputDir, outputSuffix;
    //     if (outputDirArg) {
    //         outputDir = path.resolve(process.cwd(), outputDirArg);
    //         // Extract suffix from directory name (e.g., "2026-01-27-015" from path)
    //         // Check if directory name matches date-number pattern
    //         outputSuffix = ;
    //     } else {
    //         outputSuffix = `${new Date().toLocaleDateString("en-CA")}-${await getNextOutputFolderNumber(datePrefix)}`;
    //         outputDir = path.join(outputBaseDir, outputSuffix);
    //     }
    //     return { outputDir, outputSuffix };
    // })();

    const { logStream } = await (async () => {
        await mkdir(path.dirname(outputDir), { recursive: true });
        const logStream = createLogStream(`${outputDir}.log`, process.stdout, process.stderr);

        logStream.write([process.argv0, path.relative(process.cwd(), process.argv[1]), ...process.argv.slice(2)].join(' ') + '\n\n');
        return { logStream };
    })();

    // Load configuration
    console.log(`Loading configuration: ${configPath}`);
    const { jobs } = await loadConfig(configPath);

    const workerCount = getOptimalWorkerCount();

    console.log('='.repeat(80));
    console.log('PDF Color Conversion Verification Matrix');
    console.log('='.repeat(80));
    console.log(`Configuration: ${configPath}`);
    console.log(`Output folder: ${outputDir}`);
    console.log(`Output suffix: ${outputSuffix}`);
    console.log(`Optimal worker count: ${workerCount}`);
    console.log(`Diagnostics: ${usingDiagnostics ? 'enabled' : 'disabled'}`);
    console.log('');

    // Create output directory
    await mkdir(outputDir, { recursive: true });

    // Calculate total conversions
    const inputCount = Object.keys(jobs.inputs).length;
    const outputCount = Object.keys(jobs.outputs).length;
    const configCount = Object.keys(jobs.configurations).length;
    const totalCount = inputCount * outputCount * configCount;

    console.log(`Inputs: ${inputCount}`);
    console.log(`Outputs: ${outputCount}`);
    console.log(`Configurations: ${configCount}`);
    console.log(`Total conversions: ${totalCount}`);
    console.log('');

    // Track results
    const results = [];
    let completed = 0;
    let failed = 0;

    // Build a map of output filenames for comparison
    const outputFiles = new Map();

    if (!compareOnly) {
        // Generate all combinations
        for (const [inputName, input] of Object.entries(jobs.inputs)) {
            for (const [outputName, output] of Object.entries(jobs.outputs)) {
                for (const [configName, config] of Object.entries(jobs.configurations)) {
                    // Build output filename
                    const configNameResolved = configName.replace(
                        /# Workers?\b/,
                        `${workerCount} Workers`
                    );
                    const outputPDFName = [
                        inputName,
                        outputName,
                        configNameResolved,
                    ].join(' - ') + ` (${outputSuffix}).pdf`;

                    const outputPath = path.join(outputDir, outputPDFName);
                    const logPath = outputPath.replace(/\.pdf$/, '.log');

                    // Store mapping for comparison
                    const key = `${inputName}|${outputName}|${configName}`;
                    outputFiles.set(key, outputPath);

                    // Build command arguments
                    const args = ['convert-pdf-color.js'];

                    // Input PDF (already resolved to absolute path)
                    args.push(path.relative(experimentsDir, input.pdf));

                    // ICC profile (already resolved to absolute path, or special identifier like 'Lab')
                    if (SPECIAL_PROFILE_IDENTIFIERS.includes(output.profile)) {
                        args.push(output.profile);
                    } else {
                        args.push(path.relative(experimentsDir, output.profile));
                    }

                    // Output path
                    args.push(path.relative(experimentsDir, outputPath));

                    // Rendering intent
                    args.push(`--intent=${output.intent}`);

                    // Black Point Compensation
                    if (output['blackpoint-compensation'] === true) {
                        args.push('--bpc');
                    } else if (output['blackpoint-compensation'] === false) {
                        args.push('--no-bpc');
                    }
                    // If not specified, let convert-pdf-color.js use its default

                    // Implementation: Legacy vs Refactored
                    if (config.implementation === 'Legacy') {
                        args.push('--legacy');
                    }

                    // Modality: Main Thread vs Workers
                    if (config.modality === 'Main Thread') {
                        args.push('--workers=0');  // Explicit: no workers
                    } else {
                        // Extract worker count from modality like "7 Workers"
                        // If just "Workers" (no number), use the optimal worker count
                        const workerMatch = config.modality.match(/(\d+)\s*Workers?/i);
                        const configWorkerCount = workerMatch ? parseInt(workerMatch[1], 10) : workerCount;
                        args.push(`--workers=${configWorkerCount}`);
                    }

                    // Verbose output
                    args.push('--verbose');

                    // Color engine path (resolve from config.engine version)
                    if (config.engine) {
                        // Resolve to path relative to experiments dir
                        const colorEnginePath = `../packages/color-engine-${config.engine}`;
                        args.push(`--color-engine=${colorEnginePath}`);
                    }

                    // Output format overrides
                    if (output.overrides) {
                        if (output.overrides.outputBitsPerComponent) {
                            args.push(`--output-bits=${output.overrides.outputBitsPerComponent}`);
                        }
                        if (output.overrides.outputEndianness) {
                            args.push(`--output-endianness=${output.overrides.outputEndianness}`);
                        }
                    }

                    // Diagnostics
                    if (usingDiagnostics) {
                        const diagnosticsPath = outputPath.replace(/\.pdf$/, '.diagnostics.json');
                        args.push(`--save-diagnostics=${path.relative(experimentsDir, diagnosticsPath)}`);
                    }

                    // Log the conversion
                    completed++;
                    console.log(`[${completed}/${totalCount}] ${outputPDFName}`);
                    console.log(`\nnode ${args.join(' ')}\n`);

                    // Determine expected worker count for this configuration
                    let expectedWorkers = 0;
                    if (config.modality !== 'Main Thread') {
                        const workerMatch = config.modality.match(/(\d+)\s*Workers?/i);
                        expectedWorkers = workerMatch ? parseInt(workerMatch[1], 10) : workerCount;
                    }

                    try {
                        const startTime = performance.now();
                        await runConversion(args, logPath, logStream);
                        const elapsed = performance.now() - startTime;

                        // Get output file size
                        let outputFileSize = 0;
                        try {
                            const stats = await import('fs/promises').then(m => m.stat(outputPath));
                            outputFileSize = stats.size;
                        } catch (e) {
                            // File might not exist if conversion failed
                        }

                        // Verify engine from diagnostics matches expected config.engine
                        let actualEngine = undefined;
                        let engineMatch = true;
                        const expectedEngine = config.engine ? `color-engine-${config.engine}` : undefined;
                        if (usingDiagnostics && expectedEngine) {
                            const diagnosticsPath = outputPath.replace(/\.pdf$/, '.diagnostics.json');
                            try {
                                const diagSummary = await loadDiagnosticsSummary(diagnosticsPath);
                                actualEngine = diagSummary?.engine;
                                if (actualEngine && actualEngine !== expectedEngine) {
                                    engineMatch = false;
                                    console.warn(`  ⚠️ ENGINE MISMATCH: Expected ${expectedEngine}, got ${actualEngine}`);
                                }
                            } catch (e) {
                                console.warn(`  ⚠️ Could not verify engine: ${e.message}`);
                            }
                        }

                        results.push({
                            name: outputPDFName,
                            status: engineMatch ? 'success' : 'engine-mismatch',
                            elapsed,
                            input: inputName,
                            output: outputName,
                            configuration: configName,
                            configurationResolved: configNameResolved,
                            implementation: config.implementation,
                            modality: config.modality,
                            expectedWorkers,
                            outputFileSize,
                            outputPath,
                            expectedEngine,
                            actualEngine,
                        });
                        console.log(`  Completed in ${elapsed.toFixed(0)}ms (${(outputFileSize / 1024 / 1024).toFixed(2)} MB)\n`);
                    } catch (error) {
                        failed++;
                        results.push({
                            name: outputPDFName,
                            status: 'failed',
                            error: error.message,
                            input: inputName,
                            output: outputName,
                            configuration: configName,
                            configurationResolved: configNameResolved,
                            implementation: config.implementation,
                            modality: config.modality,
                            expectedWorkers,
                            outputFileSize: 0,
                            outputPath,
                        });
                        console.log(`  Failed: ${error.message}\n`);
                    }
                }
            }
        }
    } else {
        console.log('--compare-only: Skipping conversions, loading existing files...\n');

        // Build output file map from existing files
        for (const [inputName] of Object.entries(jobs.inputs)) {
            for (const [outputName] of Object.entries(jobs.outputs)) {
                for (const [configName] of Object.entries(jobs.configurations)) {
                    const configNameResolved = configName.replace(
                        /# Workers?\b/,
                        `${workerCount} Workers`
                    );
                    const outputPDFName = [
                        inputName,
                        outputName,
                        configNameResolved,
                    ].join(' - ') + ` (${outputSuffix}).pdf`;

                    const outputPath = path.join(outputDir, outputPDFName);
                    const key = `${inputName}|${outputName}|${configName}`;
                    outputFiles.set(key, outputPath);
                }
            }
        }
    }

    // Run comparisons if enabled
    const comparisonResults = [];
    if (jobs.comparison?.enabled && jobs.comparison.pairs?.length > 0) {
        console.log('='.repeat(80));
        console.log('Running Comparisons (Legacy vs Refactored)');
        console.log('='.repeat(80));
        console.log('');

        const comparisonPairs = jobs.comparison.pairs;
        let comparisonIndex = 0;
        let comparisonsPassed = 0;
        let comparisonsFailed = 0;

        for (const [inputName] of Object.entries(jobs.inputs)) {
            for (const [outputName] of Object.entries(jobs.outputs)) {
                for (const pair of comparisonPairs) {
                    comparisonIndex++;

                    const expectedKey = `${inputName}|${outputName}|${pair.expected}`;
                    const actualKey = `${inputName}|${outputName}|${pair.actual}`;

                    const expectedPath = outputFiles.get(expectedKey);
                    const actualPath = outputFiles.get(actualKey);

                    if (!expectedPath || !actualPath) {
                        console.log(`[${comparisonIndex}] SKIP: Missing files for ${inputName} - ${outputName}`);
                        continue;
                    }

                    if (!existsSync(expectedPath)) {
                        console.log(`[${comparisonIndex}] SKIP: Expected file not found: ${path.basename(expectedPath)}`);
                        comparisonsFailed++;
                        comparisonResults.push({
                            input: inputName,
                            output: outputName,
                            expected: pair.expected,
                            actual: pair.actual,
                            passed: false,
                            error: 'Expected file not found',
                        });
                        continue;
                    }

                    if (!existsSync(actualPath)) {
                        console.log(`[${comparisonIndex}] SKIP: Actual file not found: ${path.basename(actualPath)}`);
                        comparisonsFailed++;
                        comparisonResults.push({
                            input: inputName,
                            output: outputName,
                            expected: pair.expected,
                            actual: pair.actual,
                            passed: false,
                            error: 'Actual file not found',
                        });
                        continue;
                    }

                    console.log(`[${comparisonIndex}] Comparing: ${inputName} - ${outputName}`);
                    console.log(`    Expected: ${pair.expected}`);
                    console.log(`    Actual:   ${pair.actual}`);

                    const { passed, output, exitCode, data } = runComparison(expectedPath, actualPath);

                    if (passed) {
                        comparisonsPassed++;
                        console.log(`    Result: PASS (exit code ${exitCode})`);
                    } else {
                        comparisonsFailed++;
                        console.log(`    Result: FAIL (exit code ${exitCode})`);
                    }

                    // Always show full comparison output for transparency
                    console.log('');
                    console.log('    ' + '-'.repeat(76));
                    // Indent each line of output for visual hierarchy
                    const lines = output.split('\n');
                    for (const line of lines) {
                        console.log(`    ${line}`);
                    }
                    console.log('    ' + '-'.repeat(76));
                    console.log('');

                    // Save comparison log to file
                    const comparisonLogName = `comparison-${comparisonIndex}-${inputName}-${outputName}.log`
                        .replace(/[^a-zA-Z0-9.-]/g, '-');
                    const comparisonLogPath = path.join(outputDir, comparisonLogName);
                    await writeFile(comparisonLogPath, output);

                    comparisonResults.push({
                        input: inputName,
                        output: outputName,
                        expected: pair.expected,
                        actual: pair.actual,
                        expectedFile: path.basename(expectedPath),
                        actualFile: path.basename(actualPath),
                        passed,
                        exitCode,
                        logFile: comparisonLogName,
                        data,
                    });
                }
            }
        }

        console.log('='.repeat(80));
        console.log(`Comparisons: ${comparisonsPassed} passed, ${comparisonsFailed} failed`);
        console.log('='.repeat(80));
        console.log('');

        // Write COMPARISONS.json
        const comparisonsJsonPath = path.join(outputDir, 'COMPARISONS.json');
        await writeFile(comparisonsJsonPath, JSON.stringify({
            configPath: path.relative(outputDir, path.resolve(process.cwd(), configPath)),
            outputSuffix,
            enabled: true,
            passed: comparisonsPassed,
            failed: comparisonsFailed,
            results: comparisonResults,
        }, null, 2));
        console.log(`Comparisons written to: ${comparisonsJsonPath}`);

        // Write COMPARISONS.md with extended details
        const comparisonsMdLines = [
            '# Comparisons Results',
            '',
            `**Configuration**: \`${configPath}\``,
            `**Output Folder**: \`${outputSuffix}\``,
            '',
            `**Passed**: ${comparisonsPassed}`,
            `**Failed**: ${comparisonsFailed}`,
            '',
            '## Results',
            '',
            '| # | Input | Output | Modality | Result | File Size Δ | Images | Streams |',
            '|---|-------|--------|----------|--------|-------------|--------|---------|',
        ];
        comparisonResults.forEach((r, i) => {
            const modality = r.expected.includes('Workers') ? 'Workers' : 'Main Thread';
            const result = r.passed ? 'PASS' : 'FAIL';
            const fileSizeDelta = r.data?.fileSizeDeltaPercent != null ? `${r.data.fileSizeDeltaPercent > 0 ? '+' : ''}${r.data.fileSizeDeltaPercent}%` : '-';
            const images = r.data?.imageCount ? `${r.data.imageCount.expected}/${r.data.imageCount.actual}` : '-';
            const streams = r.data?.contentStreamCount ? `${r.data.contentStreamCount.expected}/${r.data.contentStreamCount.actual}` : '-';
            comparisonsMdLines.push(`| ${i + 1} | ${r.input} | ${r.output} | ${modality} | ${result} | ${fileSizeDelta} | ${images} | ${streams} |`);
        });
        comparisonsMdLines.push('');

        // Image comparison details
        const imageComparisons = comparisonResults.filter(r => r.data?.images?.length > 0);
        if (imageComparisons.length > 0) {
            comparisonsMdLines.push('## Image Comparison Details');
            comparisonsMdLines.push('');
            for (const r of imageComparisons) {
                if (!r.data?.images?.length) continue;
                const modality = r.expected.includes('Workers') ? 'Workers' : 'Main Thread';
                comparisonsMdLines.push(`### ${r.input} - ${r.output} (${modality})`);
                comparisonsMdLines.push('');
                comparisonsMdLines.push('| Image | Status | Dimensions | Color Space | ΔE Avg | ΔE Max | Pass Rate |');
                comparisonsMdLines.push('|-------|--------|------------|-------------|--------|--------|-----------|');
                for (const img of r.data.images) {
                    const deltaEAvg = img.deltaE?.avg != null ? img.deltaE.avg.toFixed(2) : '-';
                    const deltaEMax = img.deltaE?.max != null ? img.deltaE.max.toFixed(2) : '-';
                    const passRate = img.deltaE?.passRate != null ? `${img.deltaE.passRate}%` : '-';
                    comparisonsMdLines.push(`| ${img.name} | ${img.status} | ${img.dimensions} | ${img.colorSpace} | ${deltaEAvg} | ${deltaEMax} | ${passRate} |`);
                }
                comparisonsMdLines.push('');
            }
        }

        // Overall status
        if (comparisonsFailed === 0) {
            comparisonsMdLines.push('## Status: ALL COMPARISONS PASSED');
        } else {
            comparisonsMdLines.push(`## Status: ${comparisonsFailed} COMPARISON(S) FAILED`);
        }
        comparisonsMdLines.push('');

        const comparisonsMdPath = path.join(outputDir, 'COMPARISONS.md');
        await writeFile(comparisonsMdPath, comparisonsMdLines.join('\n'));
        console.log(`Comparisons markdown written to: ${comparisonsMdPath}`);
    }

    // Load and compare diagnostics if enabled
    /** @type {DiagnosticsComparison[]} */
    const diagnosticsComparisons = [];

    if (usingDiagnostics && jobs.comparison?.enabled && jobs.comparison.pairs?.length > 0) {
        console.log('='.repeat(80));
        console.log('Loading Diagnostics for Comparison');
        console.log('='.repeat(80));
        console.log('');

        for (const [inputName] of Object.entries(jobs.inputs)) {
            for (const [outputName] of Object.entries(jobs.outputs)) {
                for (const pair of jobs.comparison.pairs) {
                    const expectedKey = `${inputName}|${outputName}|${pair.expected}`;
                    const actualKey = `${inputName}|${outputName}|${pair.actual}`;

                    const expectedPdfPath = outputFiles.get(expectedKey);
                    const actualPdfPath = outputFiles.get(actualKey);

                    if (!expectedPdfPath || !actualPdfPath) continue;

                    const expectedDiagPath = expectedPdfPath.replace(/\.pdf$/, '.diagnostics.json');
                    const actualDiagPath = actualPdfPath.replace(/\.pdf$/, '.diagnostics.json');

                    const expectedDiag = await loadDiagnosticsSummary(expectedDiagPath);
                    const actualDiag = await loadDiagnosticsSummary(actualDiagPath);

                    if (expectedDiag && actualDiag) {
                        const comparison = compareDiagnostics(expectedDiag, actualDiag);
                        diagnosticsComparisons.push(comparison);
                        console.log(`  ${inputName} - ${outputName}: Legacy ${formatTime(expectedDiag.totalTime)} vs Refactored ${formatTime(actualDiag.totalTime)} (${formatDelta(comparison.deltas.totalTimePercent, '%')})`);
                    }
                }
            }
        }
        console.log('');
    }

    // Run changes verification if enabled
    const changesResults = await verifyChanges(jobs, outputFiles, workerCount);

    // Write CHANGES.{json,md} if there are results
    if (changesResults && changesResults.length > 0) {
        const changesPassedCount = changesResults.filter(r => r.passed).length;
        const changesFailedCount = changesResults.filter(r => !r.passed).length;

        // Write CHANGES.json
        const changesJsonPath = path.join(outputDir, 'CHANGES.json');
        await writeFile(changesJsonPath, JSON.stringify({
            configPath: path.relative(outputDir, path.resolve(process.cwd(), configPath)),
            outputSuffix,
            enabled: true,
            passed: changesPassedCount,
            failed: changesFailedCount,
            groups: changesResults,
        }, null, 2));
        console.log(`Changes written to: ${changesJsonPath}`);

        // Write CHANGES.md with full details
        const changesMdLines = [
            '# Changes Verification Results',
            '',
            `**Configuration**: \`${configPath}\``,
            `**Output Folder**: \`${outputSuffix}\``,
            '',
            `**Passed**: ${changesPassedCount}`,
            `**Failed**: ${changesFailedCount}`,
            '',
        ];

        for (const group of changesResults) {
            changesMdLines.push(`## ${group.description}`);
            changesMdLines.push('');
            changesMdLines.push(`**Input**: ${group.input}`);
            if (group.outputs && group.outputs.length > 0) {
                changesMdLines.push(`**Outputs**: ${group.outputs.join(', ')}`);
            }
            changesMdLines.push('');

            if (group.verifications.length === 0) {
                if (group.failureReason) {
                    changesMdLines.push(`*Failure: ${group.failureReason}*`);
                } else {
                    changesMdLines.push('*No matching colors found*');
                }
                changesMdLines.push('');
            } else {
                // Group verifications by pair for separate tables
                /** @type {Map<string, typeof group.verifications>} */
                const byPair = new Map();
                for (const v of group.verifications) {
                    const pairKey = `${v.pairFirstName}|${v.pairSecondName}`;
                    if (!byPair.has(pairKey)) {
                        byPair.set(pairKey, []);
                    }
                    byPair.get(pairKey)?.push(v);
                }

                changesMdLines.push(`**Summary**: ${group.summary.passedMatches}/${group.summary.totalMatches} passed`);
                changesMdLines.push('');

                // Output raw table for each pair (summary tables are in SUMMARY.md)
                for (const [pairKey, pairVerifications] of byPair) {
                    const [firstName, secondName] = pairKey.split('|');
                    const pairPassed = pairVerifications.filter(v => v.passed).length;
                    const pairTotal = pairVerifications.length;

                    changesMdLines.push(`### Pair: ${firstName} → ${secondName}`);
                    changesMdLines.push('');
                    changesMdLines.push(`**Passed**: ${pairPassed}/${pairTotal}`);
                    changesMdLines.push('');

                    // Raw table with Op# column and Expected/Actual/Status per pair member
                    changesMdLines.push(`| Page | Stream | Op# | Input | ${firstName} Expected | Actual | Status | ${secondName} Expected | Actual | Status |`);
                    changesMdLines.push('|------|--------|-----|-------|----------------------|--------|--------|----------------------|--------|--------|');

                    for (const v of pairVerifications) {
                        const inputCell = `${v.inputColorspace}: \`${v.inputValues.map(n => n.toFixed(4)).join(', ')}\``;
                        const firstExpectedCell = `${v.firstExpectedColorspace}: \`${v.firstExpected.map(n => n.toFixed(4)).join(', ')}\``;
                        const firstActualCell = v.firstMissing ? '(missing)' : `${v.firstActualColorspace}: \`${v.firstActual.map(n => n.toFixed(4)).join(', ')}\``;
                        const firstStatus = v.firstMatch ? 'PASS' : 'FAIL';
                        const secondExpectedCell = `${v.secondExpectedColorspace}: \`${v.secondExpected.map(n => n.toFixed(4)).join(', ')}\``;
                        const secondActualCell = v.secondMissing ? '(missing)' : `${v.secondActualColorspace}: \`${v.secondActual.map(n => n.toFixed(4)).join(', ')}\``;
                        const secondStatus = v.secondMatch ? 'PASS' : 'FAIL';
                        changesMdLines.push(`| ${v.pageNum} | ${v.streamIndex} | ${v.operatorIndex} | ${inputCell} | ${firstExpectedCell} | ${firstActualCell} | ${firstStatus} | ${secondExpectedCell} | ${secondActualCell} | ${secondStatus} |`);
                    }
                    changesMdLines.push('');
                }
            }

            changesMdLines.push(`**Status**: ${group.passed ? 'PASS' : 'FAIL'}`);
            changesMdLines.push('');
        }

        const changesMdPath = path.join(outputDir, 'CHANGES.md');
        await writeFile(changesMdPath, changesMdLines.join('\n'));
        console.log(`Changes markdown written to: ${changesMdPath}`);
    }

    // Write summary
    console.log('='.repeat(80));
    console.log('Summary');
    console.log('='.repeat(80));
    if (!compareOnly) {
        console.log(`Conversions - Total: ${totalCount}, Completed: ${completed - failed}, Failed: ${failed}`);
    }
    if (comparisonResults.length > 0) {
        const passedCount = comparisonResults.filter(r => r.passed).length;
        const failedCount = comparisonResults.filter(r => !r.passed).length;
        console.log(`Comparisons - Passed: ${passedCount}, Failed: ${failedCount}`);
    }
    if (changesResults && changesResults.length > 0) {
        const changesPassedCount = changesResults.filter(r => r.passed).length;
        const changesFailedCount = changesResults.filter(r => !r.passed).length;
        console.log(`Changes - Passed: ${changesPassedCount}, Failed: ${changesFailedCount}`);
    }
    console.log('');

    // Calculate total file sizes
    const totalOutputSize = results.reduce((sum, r) => sum + (r.outputFileSize || 0), 0);

    // Write results to JSON (summary stats only - exhaustive data in COMPARISONS.json and CHANGES.json)
    const summaryPath = path.join(outputDir, 'SUMMARY.json');
    await writeFile(summaryPath, JSON.stringify({
        configPath: path.relative(outputDir, path.resolve(process.cwd(), configPath)),
        outputSuffix,
        workerCount,
        diagnosticsEnabled: usingDiagnostics,
        conversions: {
            totalCount,
            completed: completed - failed,
            failed,
            totalOutputSizeBytes: totalOutputSize,
            // Exhaustive results omitted - see individual conversion files
        },
        comparisons: {
            enabled: jobs.comparison?.enabled ?? false,
            passed: comparisonResults.filter(r => r.passed).length,
            failed: comparisonResults.filter(r => !r.passed).length,
            // Exhaustive results in COMPARISONS.json
        },
        diagnosticsComparisons: diagnosticsComparisons.length > 0 ? diagnosticsComparisons : undefined,
        changes: changesResults ? {
            enabled: true,
            passed: changesResults.filter(r => r.passed).length,
            failed: changesResults.filter(r => !r.passed).length,
            // Exhaustive groups in CHANGES.json
        } : undefined,
    }, null, 2));
    console.log(`Summary written to: ${summaryPath}`);

    // Write markdown summary
    const mdLines = [
        '# Verification Matrix Results',
        '',
        `**Configuration**: \`${configPath}\``,
        `**Output Folder**: \`${outputSuffix}\``,
        `**Worker Count**: ${workerCount}`,
        `**Diagnostics**: ${usingDiagnostics ? 'enabled' : 'disabled'}`,
        '',
    ];

    if (!compareOnly) {
        mdLines.push('## Conversions');
        mdLines.push('');
        mdLines.push(`- **Total**: ${totalCount}`);
        mdLines.push(`- **Completed**: ${completed - failed}`);
        mdLines.push(`- **Failed**: ${failed}`);
        mdLines.push(`- **Total Output Size**: ${(totalOutputSize / 1024 / 1024).toFixed(2)} MB`);
        mdLines.push('');
        mdLines.push('| # | Input | Output | Implementation | Modality | Workers | Status | Engine | Time | Size |');
        mdLines.push('|---|-------|--------|----------------|----------|---------|--------|--------|------|------|');
        results.forEach((r, i) => {
            const status = r.status === 'success' ? 'PASS' : r.status === 'engine-mismatch' ? 'ENGINE!' : 'FAIL';
            const time = r.elapsed ? `${r.elapsed.toFixed(0)}ms` : r.error || '-';
            const size = r.outputFileSize ? `${(r.outputFileSize / 1024 / 1024).toFixed(2)} MB` : '-';
            const workers = r.expectedWorkers || 0;
            const engine = r.actualEngine ? r.actualEngine.replace(/^color-engine-/, '') : '-';
            mdLines.push(`| ${i + 1} | ${r.input} | ${r.output} | ${r.implementation} | ${r.modality} | ${workers} | ${status} | ${engine} | ${time} | ${size} |`);
        });
        mdLines.push('');

        // Add performance delta table (Legacy vs Refactored for same input/output/modality)
        const performanceDeltas = [];
        for (const [inputName] of Object.entries(jobs.inputs)) {
            for (const [outputName] of Object.entries(jobs.outputs)) {
                const legacyMain = results.find(r => r.input === inputName && r.output === outputName && r.implementation === 'Legacy' && r.modality === 'Main Thread');
                const refactoredMain = results.find(r => r.input === inputName && r.output === outputName && r.implementation === 'Refactored' && r.modality === 'Main Thread');
                const legacyWorkers = results.find(r => r.input === inputName && r.output === outputName && r.implementation === 'Legacy' && r.modality !== 'Main Thread');
                const refactoredWorkers = results.find(r => r.input === inputName && r.output === outputName && r.implementation === 'Refactored' && r.modality !== 'Main Thread');

                if (legacyMain && refactoredMain) {
                    const timeDelta = refactoredMain.elapsed - legacyMain.elapsed;
                    const timePercent = legacyMain.elapsed > 0 ? (timeDelta / legacyMain.elapsed) * 100 : 0;
                    const sizeDelta = (refactoredMain.outputFileSize || 0) - (legacyMain.outputFileSize || 0);
                    performanceDeltas.push({
                        input: inputName,
                        output: outputName,
                        modality: 'Main Thread',
                        legacyTime: legacyMain.elapsed,
                        refactoredTime: refactoredMain.elapsed,
                        timeDelta,
                        timePercent,
                        sizeDelta,
                    });
                }
                if (legacyWorkers && refactoredWorkers) {
                    const timeDelta = refactoredWorkers.elapsed - legacyWorkers.elapsed;
                    const timePercent = legacyWorkers.elapsed > 0 ? (timeDelta / legacyWorkers.elapsed) * 100 : 0;
                    const sizeDelta = (refactoredWorkers.outputFileSize || 0) - (legacyWorkers.outputFileSize || 0);
                    performanceDeltas.push({
                        input: inputName,
                        output: outputName,
                        modality: 'Workers',
                        legacyTime: legacyWorkers.elapsed,
                        refactoredTime: refactoredWorkers.elapsed,
                        timeDelta,
                        timePercent,
                        sizeDelta,
                    });
                }
            }
        }

        if (performanceDeltas.length > 0) {
            mdLines.push('## Performance Delta (Refactored vs Legacy)');
            mdLines.push('');
            mdLines.push('| Input | Output | Modality | Legacy | Refactored | Δ Time | Δ Time % | Δ Size |');
            mdLines.push('|-------|--------|----------|--------|------------|--------|----------|--------|');
            for (const d of performanceDeltas) {
                const legacyTimeStr = `${d.legacyTime.toFixed(0)}ms`;
                const refactoredTimeStr = `${d.refactoredTime.toFixed(0)}ms`;
                const timeDeltaStr = `${d.timeDelta > 0 ? '+' : ''}${d.timeDelta.toFixed(0)}ms`;
                const timePercentStr = `${d.timePercent > 0 ? '+' : ''}${d.timePercent.toFixed(1)}%`;
                const sizeDeltaStr = d.sizeDelta !== 0 ? `${d.sizeDelta > 0 ? '+' : ''}${(d.sizeDelta / 1024).toFixed(1)} KB` : '0';
                mdLines.push(`| ${d.input} | ${d.output} | ${d.modality} | ${legacyTimeStr} | ${refactoredTimeStr} | ${timeDeltaStr} | ${timePercentStr} | ${sizeDeltaStr} |`);
            }
            mdLines.push('');
        }
    }

    if (comparisonResults.length > 0) {
        const passedCount = comparisonResults.filter(r => r.passed).length;
        const failedCount = comparisonResults.filter(r => !r.passed).length;

        mdLines.push('## Comparisons (Legacy vs Refactored)');
        mdLines.push('');
        mdLines.push(`- **Passed**: ${passedCount}`);
        mdLines.push(`- **Failed**: ${failedCount}`);
        mdLines.push('');

        // Small results table
        mdLines.push('| # | Input | Output | Modality | Result | File Size Δ | Images | Streams |');
        mdLines.push('|---|-------|--------|----------|--------|-------------|--------|---------|');
        comparisonResults.forEach((r, i) => {
            const modality = r.expected.includes('Workers') ? 'Workers' : 'Main Thread';
            const result = r.passed ? 'PASS' : 'FAIL';
            const fileSizeDelta = r.data?.fileSizeDeltaPercent != null ? `${r.data.fileSizeDeltaPercent > 0 ? '+' : ''}${r.data.fileSizeDeltaPercent}%` : '-';
            const images = r.data?.imageCount ? `${r.data.imageCount.expected}/${r.data.imageCount.actual}` : '-';
            const streams = r.data?.contentStreamCount ? `${r.data.contentStreamCount.expected}/${r.data.contentStreamCount.actual}` : '-';
            mdLines.push(`| ${i + 1} | ${r.input} | ${r.output} | ${modality} | ${result} | ${fileSizeDelta} | ${images} | ${streams} |`);
        });
        mdLines.push('');
        mdLines.push('See [COMPARISONS.md](COMPARISONS.md) for image comparison details.');
        mdLines.push('');

        // Overall status
        if (failedCount === 0) {
            mdLines.push('### Status: ALL COMPARISONS PASSED');
        } else {
            mdLines.push(`### Status: ${failedCount} COMPARISON(S) FAILED`);
        }
        mdLines.push('');
    }

    // Diagnostics comparison section with breakdown times
    if (diagnosticsComparisons.length > 0) {
        mdLines.push('## Diagnostics Comparison (Legacy vs Refactored)');
        mdLines.push('');

        // Summary table
        mdLines.push('### Summary');
        mdLines.push('');
        mdLines.push('| Configuration | Legacy | Refactored | Δ Time | Δ % |');
        mdLines.push('|---------------|--------|------------|--------|-----|');
        for (const dc of diagnosticsComparisons) {
            const legacyTime = formatTime(dc.expected.totalTime);
            const refactoredTime = formatTime(dc.actual.totalTime);
            const timeDelta = formatDelta(dc.deltas.totalTime * 1000, 'ms');
            const timePercent = formatDelta(dc.deltas.totalTimePercent, '%');
            // Truncate name to fit
            const shortName = dc.expected.name.length > 60 ? dc.expected.name.substring(0, 57) + '...' : dc.expected.name;
            mdLines.push(`| ${shortName} | ${legacyTime} | ${refactoredTime} | ${timeDelta} | ${timePercent} |`);
        }
        mdLines.push('');

        // Detailed breakdown table
        mdLines.push('### Time Breakdown');
        mdLines.push('');
        mdLines.push('| Phase | Legacy | Refactored | Δ Time |');
        mdLines.push('|-------|--------|------------|--------|');

        // Aggregate breakdowns across all comparisons
        const aggregateLegacy = createEmptyBreakdown();
        const aggregateRefactored = createEmptyBreakdown();
        let aggregateLegacyTotal = 0;
        let aggregateRefactoredTotal = 0;

        for (const dc of diagnosticsComparisons) {
            aggregateLegacyTotal += dc.expected.totalTime;
            aggregateRefactoredTotal += dc.actual.totalTime;
            for (const key of Object.keys(aggregateLegacy)) {
                const k = /** @type {keyof DiagnosticsSummary['breakdown']} */ (key);
                aggregateLegacy[k] += dc.expected.breakdown[k];
                aggregateRefactored[k] += dc.actual.breakdown[k];
            }
        }

        // Format breakdown rows
        const breakdownRows = [
            ['Read PDF', aggregateLegacy.readPdf, aggregateRefactored.readPdf],
            ['Load PDF', aggregateLegacy.loadPdf, aggregateRefactored.loadPdf],
            ['Read Profile', aggregateLegacy.readProfile, aggregateRefactored.readProfile],
            ['Document Conversion', aggregateLegacy.documentConversion, aggregateRefactored.documentConversion],
            ['├─ Stream Parsing', aggregateLegacy.streamParsing, aggregateRefactored.streamParsing],
            ['├─ Stream Convert', aggregateLegacy.streamConvert, aggregateRefactored.streamConvert],
            ['│  └─ WASM (lookup tables)', aggregateLegacy.streamTotalWasm, aggregateRefactored.streamTotalWasm],
            ['├─ Stream Rebuild', aggregateLegacy.streamRebuild, aggregateRefactored.streamRebuild],
            ['├─ Image Decoding', aggregateLegacy.imageDecoding, aggregateRefactored.imageDecoding],
            ['├─ Image Transform (WASM)', aggregateLegacy.imageTransform, aggregateRefactored.imageTransform],
            ['└─ Image Encoding', aggregateLegacy.imageEncoding, aggregateRefactored.imageEncoding],
            ['Serialize PDF', aggregateLegacy.serializePdf, aggregateRefactored.serializePdf],
            ['Write PDF', aggregateLegacy.writePdf, aggregateRefactored.writePdf],
            ['Transition/Overhead', aggregateLegacy.transitionTime, aggregateRefactored.transitionTime],
        ];

        for (const [label, legacy, refactored] of breakdownRows) {
            // Skip rows where both values are 0
            if (legacy === 0 && refactored === 0) continue;
            const delta = /** @type {number} */ (refactored) - /** @type {number} */ (legacy);
            mdLines.push(`| ${label} | ${formatTime(/** @type {number} */(legacy))} | ${formatTime(/** @type {number} */(refactored))} | ${formatDelta(delta * 1000, 'ms')} |`);
        }

        // Total row
        const totalDelta = aggregateRefactoredTotal - aggregateLegacyTotal;
        mdLines.push(`| **Total** | **${formatTime(aggregateLegacyTotal)}** | **${formatTime(aggregateRefactoredTotal)}** | **${formatDelta(totalDelta * 1000, 'ms')}** |`);
        mdLines.push('');

        // Per-configuration breakdowns (collapsed details)
        mdLines.push('### Per-Configuration Details');
        mdLines.push('');

        for (const dc of diagnosticsComparisons) {
            // Shorter name for header
            const shortName = dc.expected.name.replace(/ - Color-Engine.*$/, '').replace(/^2025-08-15 - ConRes - ISO PTF - CR1/, 'CR1');
            mdLines.push(`<details>`);
            mdLines.push(`<summary><strong>${shortName}</strong> — Legacy: ${formatTime(dc.expected.totalTime)}, Refactored: ${formatTime(dc.actual.totalTime)} (${formatDelta(dc.deltas.totalTimePercent, '%')})</summary>`);
            mdLines.push('');
            mdLines.push('| Phase | Legacy | Refactored | Δ |');
            mdLines.push('|-------|--------|------------|---|');

            const rows = [
                ['Read PDF', dc.expected.breakdown.readPdf, dc.actual.breakdown.readPdf],
                ['Load PDF', dc.expected.breakdown.loadPdf, dc.actual.breakdown.loadPdf],
                ['Document Conversion', dc.expected.breakdown.documentConversion, dc.actual.breakdown.documentConversion],
                ['Stream Parsing', dc.expected.breakdown.streamParsing, dc.actual.breakdown.streamParsing],
                ['Stream Convert (WASM)', dc.expected.breakdown.streamTotalWasm, dc.actual.breakdown.streamTotalWasm],
                ['Stream Rebuild', dc.expected.breakdown.streamRebuild, dc.actual.breakdown.streamRebuild],
                ['Image Decoding', dc.expected.breakdown.imageDecoding, dc.actual.breakdown.imageDecoding],
                ['Image Transform (WASM)', dc.expected.breakdown.imageTransform, dc.actual.breakdown.imageTransform],
                ['Image Encoding', dc.expected.breakdown.imageEncoding, dc.actual.breakdown.imageEncoding],
                ['Serialize PDF', dc.expected.breakdown.serializePdf, dc.actual.breakdown.serializePdf],
                ['Write PDF', dc.expected.breakdown.writePdf, dc.actual.breakdown.writePdf],
            ];

            for (const [label, legacy, refactored] of rows) {
                if (legacy === 0 && refactored === 0) continue;
                const delta = /** @type {number} */ (refactored) - /** @type {number} */ (legacy);
                mdLines.push(`| ${label} | ${formatTime(/** @type {number} */(legacy))} | ${formatTime(/** @type {number} */(refactored))} | ${formatDelta(delta * 1000, 'ms')} |`);
            }

            mdLines.push('');
            mdLines.push('</details>');
            mdLines.push('');
        }
    }

    // Changes verification section (summary tables here, raw tables in CHANGES.md)
    if (changesResults && changesResults.length > 0) {
        const changesPassedCount = changesResults.filter(r => r.passed).length;
        const changesFailedCount = changesResults.filter(r => !r.passed).length;

        mdLines.push('## Changes Verification (Before vs After)');
        mdLines.push('');
        mdLines.push(`- **Passed**: ${changesPassedCount}`);
        mdLines.push(`- **Failed**: ${changesFailedCount}`);
        mdLines.push('');

        for (const group of changesResults) {
            mdLines.push(`### ${group.description}`);
            mdLines.push('');
            mdLines.push(`**Input**: ${group.input}`);
            if (group.outputs && group.outputs.length > 0) {
                mdLines.push(`**Outputs**: ${group.outputs.join(', ')}`);
            }
            mdLines.push('');

            if (group.verifications.length === 0) {
                if (group.failureReason) {
                    mdLines.push(`*Failure: ${group.failureReason}*`);
                } else {
                    mdLines.push('*No matching colors found*');
                }
                mdLines.push('');
            } else {
                // Group verifications by pair for separate tables
                /** @type {Map<string, ColorChangeVerification[]>} */
                const byPair = new Map();
                for (const v of group.verifications) {
                    const pairKey = `${v.pairFirstName}|${v.pairSecondName}`;
                    if (!byPair.has(pairKey)) {
                        byPair.set(pairKey, []);
                    }
                    byPair.get(pairKey)?.push(v);
                }

                mdLines.push(`**Summary**: ${group.summary.passedMatches}/${group.summary.totalMatches} passed`);
                mdLines.push('');

                // Output separate summary table for each pair
                for (const [pairKey, pairVerifications] of byPair) {
                    const [firstName, secondName] = pairKey.split('|');
                    const pairPassed = pairVerifications.filter(v => v.passed).length;
                    const pairTotal = pairVerifications.length;

                    mdLines.push(`#### Pair: ${firstName} → ${secondName}`);
                    mdLines.push('');
                    mdLines.push(`**Passed**: ${pairPassed}/${pairTotal}`);
                    mdLines.push('');

                    // Build summary table by grouping identical rows within each stream
                    /** @type {Map<string, { count: number, first: typeof pairVerifications[0] }>} */
                    const grouped = new Map();
                    for (const v of pairVerifications) {
                        // Build display values for grouping
                        const inputCell = `${v.inputColorspace}:${v.inputValues.map(n => n.toFixed(4)).join(',')}`;
                        const firstExpCell = `${v.firstExpectedColorspace}:${v.firstExpected.map(n => n.toFixed(4)).join(',')}`;
                        const firstActCell = v.firstMissing ? 'missing' : `${v.firstActualColorspace}:${v.firstActual.map(n => n.toFixed(4)).join(',')}`;
                        const firstStatus = v.firstMatch ? 'PASS' : 'FAIL';
                        const secondExpCell = `${v.secondExpectedColorspace}:${v.secondExpected.map(n => n.toFixed(4)).join(',')}`;
                        const secondActCell = v.secondMissing ? 'missing' : `${v.secondActualColorspace}:${v.secondActual.map(n => n.toFixed(4)).join(',')}`;
                        const secondStatus = v.secondMatch ? 'PASS' : 'FAIL';
                        // Group by page, stream, and all display columns
                        const groupKey = `${v.pageNum}|${v.streamIndex}|${inputCell}|${firstExpCell}|${firstActCell}|${firstStatus}|${secondExpCell}|${secondActCell}|${secondStatus}`;
                        if (!grouped.has(groupKey)) {
                            grouped.set(groupKey, { count: 0, first: v });
                        }
                        grouped.get(groupKey).count++;
                    }

                    // Summary table with Count in place of Op# and Expected/Actual/Status per pair member
                    mdLines.push(`| Page | Stream | Count | Input | ${firstName} Expected | Actual | Status | ${secondName} Expected | Actual | Status |`);
                    mdLines.push('|------|--------|-------|-------|----------------------|--------|--------|----------------------|--------|--------|');
                    for (const [, { count, first: v }] of grouped) {
                        const inputCell = `${v.inputColorspace}: \`${v.inputValues.map(n => n.toFixed(4)).join(', ')}\``;
                        const firstExpectedCell = `${v.firstExpectedColorspace}: \`${v.firstExpected.map(n => n.toFixed(4)).join(', ')}\``;
                        const firstActualCell = v.firstMissing ? '(missing)' : `${v.firstActualColorspace}: \`${v.firstActual.map(n => n.toFixed(4)).join(', ')}\``;
                        const firstStatus = v.firstMatch ? 'PASS' : 'FAIL';
                        const secondExpectedCell = `${v.secondExpectedColorspace}: \`${v.secondExpected.map(n => n.toFixed(4)).join(', ')}\``;
                        const secondActualCell = v.secondMissing ? '(missing)' : `${v.secondActualColorspace}: \`${v.secondActual.map(n => n.toFixed(4)).join(', ')}\``;
                        const secondStatus = v.secondMatch ? 'PASS' : 'FAIL';
                        mdLines.push(`| ${v.pageNum} | ${v.streamIndex} | ${count} | ${inputCell} | ${firstExpectedCell} | ${firstActualCell} | ${firstStatus} | ${secondExpectedCell} | ${secondActualCell} | ${secondStatus} |`);
                    }
                    mdLines.push('');
                }
            }

            mdLines.push(`**Status**: ${group.passed ? 'PASS' : 'FAIL'}`);
            mdLines.push('');
        }

        mdLines.push('See [CHANGES.md](CHANGES.md) for raw verification tables.');
        mdLines.push('');

        // Overall status
        if (changesFailedCount === 0) {
            mdLines.push('### Status: ALL CHANGES VERIFIED');
        } else {
            mdLines.push(`### Status: ${changesFailedCount} CHANGE VERIFICATION(S) FAILED`);
        }
        mdLines.push('');
    }

    const mdPath = path.join(outputDir, 'SUMMARY.md');
    await writeFile(mdPath, mdLines.join('\n'));
    console.log(`Markdown summary written to: ${mdPath}`);

    // Exit with error if any comparisons or changes verification failed
    const hasComparisonFailures = comparisonResults.some(r => !r.passed);
    const hasChangesFailures = changesResults && changesResults.some(r => !r.passed);
    if (hasComparisonFailures || hasChangesFailures) {
        if (hasComparisonFailures) {
            console.log('\nComparison failures detected - exit code 1');
        }
        if (hasChangesFailures) {
            console.log('\nChanges verification failures detected - exit code 1');
        }
        process.exit(1);
    }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    await main();
}