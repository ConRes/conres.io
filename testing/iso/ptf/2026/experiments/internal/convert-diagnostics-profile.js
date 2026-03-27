#!/usr/bin/env node
// @ts-check
/**
 * Convert Diagnostics Profile CLI
 *
 * Converts DiagnosticsCollector JSON output to various formats:
 * - cpuprofile: V8/Chrome CPU Profile for Flame Chart Visualizer
 * - text: Human-readable hierarchical text
 * - compact: Minimal text output for agents (avoids context overflow)
 *
 * @example
 * ```bash
 * # Convert to cpuprofile (for VS Code Flame Chart Visualizer)
 * node convert-diagnostics-profile.js input.json --output output.cpuprofile
 *
 * # Convert to human-readable text
 * node convert-diagnostics-profile.js input.json --output output.txt
 *
 * # Compact text to stdout (for agents)
 * node convert-diagnostics-profile.js input.json --compact
 *
 * # Show help
 * node convert-diagnostics-profile.js --help
 * ```
 */

import { readFile, writeFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Hatchet-compatible diagnostics node.
 * @typedef {{
 *   name: string,
 *   frame: string[],
 *   metrics: Record<string, number>,
 *   attributes: Record<string, any>,
 *   children: DiagnosticsNode[],
 * }} DiagnosticsNode
 */

/**
 * V8 CPU Profile format.
 * @typedef {{
 *   nodes: CPUProfileNode[],
 *   startTime: number,
 *   endTime: number,
 *   samples: number[],
 *   timeDeltas: number[],
 * }} CPUProfile
 */

/**
 * V8 CPU Profile node.
 * @typedef {{
 *   id: number,
 *   callFrame: {
 *     functionName: string,
 *     scriptId: string,
 *     url: string,
 *     lineNumber: number,
 *     columnNumber: number,
 *   },
 *   hitCount?: number,
 *   children?: number[],
 * }} CPUProfileNode
 */

// ============================================================================
// CLI
// ============================================================================

/**
 * Main CLI entry point.
 */
async function main() {
    const args = process.argv.slice(2);

    if (args.includes('--help') || args.includes('-h') || args.length === 0) {
        printUsage();
        process.exit(0);
    }

    // Parse arguments
    const inputFile = args.find(arg => !arg.startsWith('-'));
    const outputIndex = args.findIndex(arg => arg === '--output' || arg === '-o');
    const outputFile = outputIndex !== -1 ? args[outputIndex + 1] : null;
    const compact = args.includes('--compact') || args.includes('-c');
    const summary = args.includes('--summary') || args.includes('-s');
    const inspect = args.includes('--inspect');
    const checkReplacements = args.includes('--check-replacements');
    const inputFile2 = checkReplacements ? args.filter(arg => !arg.startsWith('-')).slice(1)[0] : null;

    if (!inputFile) {
        console.error('Error: No input file specified');
        printUsage();
        process.exit(1);
    }

    try {
        // Read input JSON
        const jsonContent = await readFile(inputFile, 'utf-8');
        const diagnosticsData = JSON.parse(jsonContent);

        // --inspect: pretty-print diagnostics structure
        if (inspect) {
            console.log(`Diagnostics: ${inputFile}`);
            console.log(`Top-level keys: ${Object.keys(diagnosticsData).join(', ')}`);
            if (diagnosticsData.spans) {
                console.log(`Spans: ${diagnosticsData.spans.length}`);
                for (const span of diagnosticsData.spans.slice(0, 20)) {
                    const duration = span.endTime && span.startTime
                        ? `${(span.endTime - span.startTime).toFixed(1)}ms`
                        : '?';
                    console.log(`  ${span.name ?? span.operationName ?? '(unnamed)'} — ${duration}`);
                }
                if (diagnosticsData.spans.length > 20) {
                    console.log(`  ... and ${diagnosticsData.spans.length - 20} more`);
                }
            }
            process.exit(0);
        }

        // --check-replacements: compare replacement counts between two diagnostics
        if (checkReplacements) {
            if (!inputFile2) {
                console.error('Error: --check-replacements requires two input files');
                console.error('Usage: node convert-diagnostics-profile.js <a.json> <b.json> --check-replacements');
                process.exit(1);
            }
            const jsonContent2 = await readFile(inputFile2, 'utf-8');
            const data2 = JSON.parse(jsonContent2);

            const getReplacements = (data) => {
                if (!data.spans) return {};
                const counts = {};
                for (const span of data.spans) {
                    const name = span.name ?? span.operationName ?? '(unnamed)';
                    const replacements = span.attributes?.replacements ?? span.replacements ?? 0;
                    if (replacements > 0) counts[name] = (counts[name] ?? 0) + replacements;
                }
                return counts;
            };

            const countsA = getReplacements(diagnosticsData);
            const countsB = getReplacements(data2);
            const allKeys = [...new Set([...Object.keys(countsA), ...Object.keys(countsB)])].sort();

            console.log(`Replacement counts: ${basename(inputFile)} vs ${basename(inputFile2)}`);
            console.log('');
            for (const key of allKeys) {
                const a = countsA[key] ?? 0;
                const b = countsB[key] ?? 0;
                const status = a === b ? '=' : a > b ? '>' : '<';
                console.log(`  ${key}: ${a} ${status} ${b}${a !== b ? ' ← DIFF' : ''}`);
            }
            process.exit(0);
        }

        // Determine output format
        if (compact) {
            // Compact text to stdout
            const text = toCompactText(diagnosticsData);
            console.log(text);
        } else if (summary) {
            // Summary to stdout
            const text = toSummaryText(diagnosticsData);
            console.log(text);
        } else if (outputFile) {
            const ext = extname(outputFile).toLowerCase();

            if (ext === '.cpuprofile') {
                const cpuProfile = toCPUProfile(diagnosticsData);
                await writeFile(outputFile, JSON.stringify(cpuProfile, null, 2));
                console.log(`Wrote cpuprofile to: ${outputFile}`);
            } else if (ext === '.txt') {
                const text = toText(diagnosticsData);
                await writeFile(outputFile, text);
                console.log(`Wrote text to: ${outputFile}`);
            } else if (ext === '.json') {
                // Re-format JSON (pretty print)
                await writeFile(outputFile, JSON.stringify(diagnosticsData, null, 2));
                console.log(`Wrote JSON to: ${outputFile}`);
            } else {
                console.error(`Error: Unknown output format: ${ext}`);
                console.error('Supported formats: .cpuprofile, .txt, .json');
                process.exit(1);
            }
        } else {
            // Default: print text to stdout
            const text = toText(diagnosticsData);
            console.log(text);
        }
    } catch (error) {
        console.error(`Error: ${error.message}`);
        process.exit(1);
    }
}

/**
 * Prints usage information.
 */
function printUsage() {
    console.log(`
Convert Diagnostics Profile

Usage:
  node convert-diagnostics-profile.js <input.json> [options]

Options:
  --output, -o <file>  Output file (format determined by extension)
                       Supported: .cpuprofile, .txt, .json
  --compact, -c        Output minimal text to stdout (for agents)
  --summary, -s        Output summary statistics only
  --inspect            Pretty-print diagnostics structure (spans, timing)
  --check-replacements Compare replacement counts between two diagnostics files
  --help, -h           Show this help message

Examples:
  # Convert to cpuprofile for VS Code Flame Chart Visualizer
  node convert-diagnostics-profile.js profile.json -o profile.cpuprofile

  # Convert to human-readable text file
  node convert-diagnostics-profile.js profile.json -o profile.txt

  # Compact output for agents (minimal, avoids context overflow)
  node convert-diagnostics-profile.js profile.json --compact

  # Summary statistics only
  node convert-diagnostics-profile.js profile.json --summary

  # Pretty-print JSON to stdout
  node convert-diagnostics-profile.js profile.json
`);
}

// ============================================================================
// Conversion: JSON → CPUProfile
// ============================================================================

/**
 * Converts Hatchet JSON to V8 CPU Profile format.
 *
 * @param {DiagnosticsNode[]} nodes - Hatchet diagnostics nodes
 * @returns {CPUProfile}
 */
function toCPUProfile(nodes) {
    /** @type {CPUProfileNode[]} */
    const cpuNodes = [];
    /** @type {number[]} */
    const samples = [];
    /** @type {number[]} */
    const timeDeltas = [];

    let nextId = 1;
    let totalTimeMs = 0;

    // Create root node
    cpuNodes.push({
        id: nextId++,
        callFrame: {
            functionName: '(root)',
            scriptId: '0',
            url: '',
            lineNumber: -1,
            columnNumber: -1,
        },
        hitCount: 0,
        children: [],
    });

    // Process each top-level node
    for (const node of nodes) {
        const childId = processNode(node, cpuNodes, 1);
        cpuNodes[0].children.push(childId);
        totalTimeMs += (node.metrics['time (inc)'] || 0) * 1000;
    }

    // Generate samples based on time distribution
    generateSamples(nodes, cpuNodes, samples, timeDeltas, totalTimeMs);

    // Calculate start/end times (microseconds)
    const startTime = 0;
    const endTime = Math.round(totalTimeMs * 1000); // ms to µs

    return {
        nodes: cpuNodes,
        startTime,
        endTime,
        samples,
        timeDeltas,
    };

    /**
     * Recursively processes a diagnostics node into CPU profile nodes.
     *
     * @param {DiagnosticsNode} node
     * @param {CPUProfileNode[]} cpuNodes
     * @param {number} parentId
     * @returns {number} The created node's ID
     */
    function processNode(node, cpuNodes, parentId) {
        const id = nextId++;
        const selfTimeMs = (node.metrics.time || 0) * 1000;

        // Build function name with key attributes
        let functionName = node.name;
        if (node.attributes.ref) {
            functionName += ` [${node.attributes.ref}]`;
        }
        if (node.attributes.colorSpace) {
            functionName += ` (${node.attributes.colorSpace})`;
        }
        if (node.attributes.pageIndex !== undefined) {
            functionName += ` #${node.attributes.pageIndex + 1}`;
        }

        // Determine URL from attributes
        const url = node.attributes.file || '';
        const lineNumber = node.attributes.line ?? -1;

        /** @type {CPUProfileNode} */
        const cpuNode = {
            id,
            callFrame: {
                functionName,
                scriptId: '0',
                url,
                lineNumber,
                columnNumber: -1,
            },
            hitCount: Math.max(1, Math.round(selfTimeMs / 10)), // Approximate hit count
            children: [],
        };

        cpuNodes.push(cpuNode);

        // Process children
        for (const child of node.children) {
            const childId = processNode(child, cpuNodes, id);
            cpuNode.children.push(childId);
        }

        return id;
    }

    /**
     * Generates samples and timeDeltas based on node timing.
     *
     * @param {DiagnosticsNode[]} nodes
     * @param {CPUProfileNode[]} cpuNodes
     * @param {number[]} samples
     * @param {number[]} timeDeltas
     * @param {number} totalTimeMs
     */
    function generateSamples(nodes, cpuNodes, samples, timeDeltas, totalTimeMs) {
        // Sample interval in microseconds (10ms = 10000µs)
        const sampleIntervalUs = 10000;
        const numSamples = Math.max(1, Math.ceil((totalTimeMs * 1000) / sampleIntervalUs));

        // Simple approach: distribute samples proportionally to self time
        const nodeTimings = [];
        collectNodeTimings(nodes, nodeTimings, 2); // Start from ID 2 (after root)

        let currentTime = 0;
        for (let i = 0; i < numSamples; i++) {
            // Find which node this sample belongs to
            let nodeId = 1; // Default to root
            let accumulatedTime = 0;

            for (const { id, selfTimeUs } of nodeTimings) {
                accumulatedTime += selfTimeUs;
                if (currentTime < accumulatedTime) {
                    nodeId = id;
                    break;
                }
            }

            samples.push(nodeId);
            timeDeltas.push(sampleIntervalUs);
            currentTime += sampleIntervalUs;
        }
    }

    /**
     * Collects node timings for sample generation.
     *
     * @param {DiagnosticsNode[]} nodes
     * @param {Array<{id: number, selfTimeUs: number}>} timings
     * @param {number} startId
     * @returns {number} Next available ID
     */
    function collectNodeTimings(nodes, timings, startId) {
        let currentId = startId;

        for (const node of nodes) {
            const selfTimeMs = (node.metrics.time || 0) * 1000;
            const selfTimeUs = selfTimeMs * 1000;

            timings.push({ id: currentId, selfTimeUs });
            currentId++;

            // Recurse into children
            currentId = collectNodeTimings(node.children, timings, currentId);
        }

        return currentId;
    }
}

// ============================================================================
// Conversion: JSON → Text
// ============================================================================

/**
 * Converts Hatchet JSON to human-readable text.
 *
 * @param {DiagnosticsNode[]} nodes
 * @returns {string}
 */
function toText(nodes) {
    const lines = [];

    for (let i = 0; i < nodes.length; i++) {
        nodeToText(nodes[i], lines, '', i === nodes.length - 1);
    }

    return lines.join('\n');
}

/**
 * Recursively converts a node to text lines.
 *
 * @param {DiagnosticsNode} node
 * @param {string[]} lines
 * @param {string} prefix
 * @param {boolean} isLast
 */
function nodeToText(node, lines, prefix, isLast) {
    const connector = isLast ? '└── ' : '├── ';
    const childPrefix = prefix + (isLast ? '    ' : '│   ');

    // Format duration
    const inclusiveTime = node.metrics['time (inc)'] || 0;
    const duration = formatDuration(inclusiveTime * 1000); // seconds to ms

    // Build line with name and duration
    let line = `${prefix}${connector}${node.name} (${duration})`;

    // Add key metrics inline
    const inlineMetrics = [];
    for (const [key, value] of Object.entries(node.metrics)) {
        if (key !== 'time' && key !== 'time (inc)') {
            inlineMetrics.push(`${key}: ${formatNumber(value)}`);
        }
    }
    if (inlineMetrics.length > 0) {
        line += ` [${inlineMetrics.join(', ')}]`;
    }

    lines.push(line);

    // Add key attributes as sub-items (only if no children)
    if (node.children.length === 0) {
        const attrEntries = Object.entries(node.attributes).filter(
            ([key]) => !['file', 'line'].includes(key)
        );
        for (let i = 0; i < attrEntries.length; i++) {
            const [key, value] = attrEntries[i];
            const attrConnector = i === attrEntries.length - 1 ? '└── ' : '├── ';
            lines.push(`${childPrefix}${attrConnector}${key}: ${value}`);
        }
    }

    // Recurse into children
    for (let i = 0; i < node.children.length; i++) {
        nodeToText(node.children[i], lines, childPrefix, i === node.children.length - 1);
    }
}

// ============================================================================
// Conversion: JSON → Compact Text
// ============================================================================

/**
 * Breakdown categories for agent analysis.
 * @typedef {{
 *   time: number,
 *   count: number,
 *   metrics: Record<string, number>,
 * }} BreakdownEntry
 */

/**
 * Converts Hatchet JSON to compact text (for agents).
 * Designed to provide all key information for bottleneck identification.
 *
 * @param {DiagnosticsNode[]} nodes
 * @returns {string}
 */
function toCompactText(nodes) {
    const lines = [];

    // Extract breakdown by operation type
    const breakdown = extractBreakdown(nodes);
    const totalTime = breakdown.total.time;

    // Header with key stats
    lines.push('# Diagnostics Breakdown');
    lines.push('');

    // Summary line - use specific span metrics for accuracy
    const pageCount = breakdown.aggregates.pages || breakdown.page.count || 0;
    // Image count from image-batch metrics, or document-conversion images metric
    const imageCount = breakdown.imageBatch.metrics.converted ||
        breakdown.aggregates.images ||
        breakdown.aggregates.imagesConverted ||
        breakdown.aggregates.totalImageConversions || 0;
    // Stream colors: prefer actual color count, fall back to stream count
    const streamColors = breakdown.aggregates.colorsConverted ||
        breakdown.aggregates.totalContentStreamConversions || 0;
    const streamCount = breakdown.streamBatch.metrics.converted ||
        breakdown.documentConversion.metrics.streams || 0;

    // Build summary showing most relevant info
    let summaryParts = [`Total: ${formatDuration(totalTime)}`, `Pages: ${pageCount}`, `Images: ${imageCount}`];
    if (streamColors > 0) {
        summaryParts.push(`Colors: ${formatNumber(streamColors)}`);
    } else if (streamCount > 0) {
        summaryParts.push(`Streams: ${streamCount}`);
    }
    lines.push(summaryParts.join(' | '));
    lines.push('');

    // Phase breakdown table
    lines.push('## Time Breakdown');
    lines.push('');
    lines.push('| Phase | Time | % | Count | Throughput |');
    lines.push('|-------|------|---|-------|------------|');

    // File I/O phases
    addBreakdownRow(lines, 'Read PDF', breakdown.readPdf, totalTime);
    addBreakdownRow(lines, 'Load PDF', breakdown.loadPdf, totalTime);
    addBreakdownRow(lines, 'Serialize PDF', breakdown.serializePdf, totalTime);
    addBreakdownRow(lines, 'Write PDF', breakdown.writePdf, totalTime);

    // Document conversion (total)
    addBreakdownRow(lines, 'Document Conversion', breakdown.documentConversion, totalTime);

    // Content stream phases - use stream batch time as denominator for children
    if (breakdown.streamBatch.time > 0 || breakdown.convert.time > 0 || breakdown.rebuild.time > 0) {
        const streamBase = breakdown.streamBatch.time || totalTime;
        addBreakdownRow(lines, '├─ Stream Batch', breakdown.streamBatch, totalTime, calculateThroughput(breakdown.convert.metrics.colorsConverted, breakdown.streamBatch.time, 'colors'));
        addBreakdownRow(lines, '│  ├─ Convert [WASM]', breakdown.convert, streamBase, calculateThroughput(breakdown.convert.metrics.colorsConverted, breakdown.convert.time, 'colors'));
        addBreakdownRow(lines, '│  └─ Rebuild', breakdown.rebuild, streamBase);
    }

    // Image phases - use image batch time as denominator for children
    if (breakdown.imageBatch.time > 0 || breakdown.decode.time > 0 || breakdown.transform.time > 0 || breakdown.encode.time > 0) {
        const imageBase = breakdown.imageBatch.time || totalTime;
        addBreakdownRow(lines, '├─ Image Batch', breakdown.imageBatch, totalTime);
        addBreakdownRow(lines, '│  ├─ Decode', breakdown.decode, imageBase, calculateThroughput(breakdown.decode.metrics.decompressedSize, breakdown.decode.time, 'B'));
        if (breakdown.normalizeBpc.time > 0) {
            addBreakdownRow(lines, '│  ├─ Normalize BPC', breakdown.normalizeBpc, imageBase, calculateThroughput(breakdown.normalizeBpc.metrics.outputSize, breakdown.normalizeBpc.time, 'B'));
        }
        // Use pixels metric if available, fall back to pixelCount
        const transformPixels = breakdown.transform.metrics.pixels || breakdown.transform.metrics.pixelCount;
        addBreakdownRow(lines, '│  ├─ Transform [WASM]', breakdown.transform, imageBase, calculateThroughput(transformPixels, breakdown.transform.time, 'px'));
        addBreakdownRow(lines, '│  └─ Encode', breakdown.encode, imageBase, calculateThroughput(breakdown.encode.metrics.compressedSize, breakdown.encode.time, 'B'));
    }

    // Page processing
    if (breakdown.page.time > 0) {
        addBreakdownRow(lines, '└─ Page Processing', breakdown.page, totalTime);
    }

    // Add note if any percentages exceed 100%
    const imageTotalOps = breakdown.decode.time + breakdown.normalizeBpc.time + breakdown.transform.time + breakdown.encode.time;
    if (imageTotalOps > breakdown.imageBatch.time * 1.1) {
        const parallelism = (imageTotalOps / breakdown.imageBatch.time).toFixed(1);
        lines.push('');
        lines.push(`*Percentages >100% = cumulative time across ${parallelism}x parallel operations.*`);
    }

    lines.push('');

    // Bottleneck analysis
    lines.push('## Bottleneck Analysis');
    lines.push('');

    const bottlenecks = identifyBottlenecks(breakdown, totalTime);
    if (bottlenecks.length > 0) {
        for (const bottleneck of bottlenecks) {
            // Format: phase: time, percent of parent, parallelism (if applicable)
            const parts = [bottleneck.time, `${bottleneck.percent} of ${bottleneck.parent}`];
            if (bottleneck.parallelism) {
                parts.push(`${bottleneck.parallelism} parallel`);
            }
            lines.push(`- **${bottleneck.phase}**: ${parts.join(', ')}`);
        }
    } else {
        lines.push('No significant bottlenecks identified.');
    }

    // Key metrics summary
    lines.push('');
    lines.push('## Metrics');
    lines.push('');

    // Build metrics list - use clearer labels
    const colorsConverted = breakdown.aggregates.colorsConverted || breakdown.aggregates.totalContentStreamConversions;
    const streamsConverted = breakdown.streamBatch.metrics.converted || breakdown.documentConversion.metrics.streams;

    const keyMetrics = [
        ['Pages', breakdown.aggregates.pages || breakdown.page.count],
        ['Color Spaces', breakdown.aggregates.totalColorSpaceConversions || breakdown.aggregates.colorSpaceConversions],
        // Prefer color count, fall back to stream count with different label
        colorsConverted ? ['Colors Converted', colorsConverted] : ['Streams Converted', streamsConverted],
        ['Stream Ops', breakdown.documentConversion.metrics.ops],  // Total content stream operations
        ['Images Converted', breakdown.imageBatch.metrics.converted || breakdown.aggregates.images || breakdown.aggregates.imagesConverted],
        ['Images Skipped', breakdown.aggregates.imagesSkipped],
        ['Total Pixels', breakdown.transform.metrics.pixels],  // Sum from transform spans
    ].filter(([_, v]) => v !== undefined && v > 0);

    for (const [name, value] of keyMetrics) {
        lines.push(`- ${name}: ${formatNumber(value)}`);
    }

    return lines.join('\n');
}

/**
 * Adds a row to the breakdown table.
 * Handles cases where percentages exceed 100% (indicating cumulative CPU time).
 *
 * @param {string[]} lines
 * @param {string} phase
 * @param {BreakdownEntry} entry
 * @param {number} totalTime
 * @param {string} [throughput]
 */
function addBreakdownRow(lines, phase, entry, totalTime, throughput = '') {
    if (entry.time === 0 && entry.count === 0) return;

    const rawPercent = totalTime > 0 ? (entry.time / totalTime) * 100 : 0;
    // Format percentage, adding note if >100%
    const percentStr = rawPercent > 100
        ? `${rawPercent.toFixed(0)}%*`  // Asterisk indicates cumulative/overlapping time
        : `${rawPercent.toFixed(1)}%`;
    const countStr = entry.count > 0 ? String(entry.count) : '-';

    lines.push(`| ${phase} | ${formatDuration(entry.time)} | ${percentStr} | ${countStr} | ${throughput} |`);
}

/**
 * Calculates throughput string.
 *
 * @param {number | undefined} count
 * @param {number} timeMs
 * @param {string} unit
 * @returns {string}
 */
function calculateThroughput(count, timeMs, unit) {
    if (!count || timeMs <= 0) return '';
    const perSec = (count / timeMs) * 1000;
    if (perSec >= 1000000) {
        return `${(perSec / 1000000).toFixed(1)}M ${unit}/s`;
    }
    if (perSec >= 1000) {
        return `${(perSec / 1000).toFixed(1)}K ${unit}/s`;
    }
    return `${perSec.toFixed(0)} ${unit}/s`;
}

/**
 * Extracts breakdown times from diagnostics tree.
 *
 * @param {DiagnosticsNode[]} nodes
 * @returns {{
 *   total: BreakdownEntry,
 *   readPdf: BreakdownEntry,
 *   loadPdf: BreakdownEntry,
 *   readProfile: BreakdownEntry,
 *   serializePdf: BreakdownEntry,
 *   writePdf: BreakdownEntry,
 *   documentConversion: BreakdownEntry,
 *   page: BreakdownEntry,
 *   streamBatch: BreakdownEntry,
 *   convert: BreakdownEntry,
 *   rebuild: BreakdownEntry,
 *   imageBatch: BreakdownEntry,
 *   decode: BreakdownEntry,
 *   normalizeBpc: BreakdownEntry,
 *   transform: BreakdownEntry,
 *   encode: BreakdownEntry,
 *   aggregates: Record<string, number>,
 * }}
 */
function extractBreakdown(nodes) {
    const createEntry = () => ({ time: 0, count: 0, metrics: {} });

    const breakdown = {
        total: createEntry(),
        readPdf: createEntry(),
        loadPdf: createEntry(),
        readProfile: createEntry(),
        serializePdf: createEntry(),
        writePdf: createEntry(),
        documentConversion: createEntry(),
        page: createEntry(),
        streamBatch: createEntry(),
        convert: createEntry(),
        rebuild: createEntry(),
        imageBatch: createEntry(),
        decode: createEntry(),
        normalizeBpc: createEntry(),
        transform: createEntry(),
        encode: createEntry(),
        aggregates: {},
    };

    // Calculate total time from all top-level spans
    for (const node of nodes) {
        breakdown.total.time += (node.metrics['time (inc)'] || node.metrics.time || 0) * 1000;
        extractBreakdownFromNode(node, breakdown);
    }

    return breakdown;
}

/**
 * Recursively extracts breakdown from a node.
 * Uses self-time (time) for accurate breakdown without double-counting.
 * Inclusive time (time (inc)) can be inaccurate for sibling spans.
 *
 * @param {DiagnosticsNode} node
 * @param {ReturnType<typeof extractBreakdown>} breakdown
 */
function extractBreakdownFromNode(node, breakdown) {
    // Use self-time for breakdown to avoid double-counting
    // For leaf spans: time == time (inc)
    // For parent spans: time excludes children (which are counted separately)
    const selfTime = (node.metrics.time || 0) * 1000;
    const inclusiveTime = (node.metrics['time (inc)'] || node.metrics.time || 0) * 1000;

    // Accumulate metrics into aggregates
    for (const [key, value] of Object.entries(node.metrics)) {
        if (key !== 'time' && key !== 'time (inc)' && typeof value === 'number') {
            breakdown.aggregates[key] = (breakdown.aggregates[key] || 0) + value;
        }
    }

    // Map span names to breakdown categories
    // Use inclusiveTime for category containers, selfTime for leaf operations
    switch (node.name) {
        // File I/O - leaf operations (self == inclusive)
        case 'read-pdf':
            breakdown.readPdf.time += selfTime;
            breakdown.readPdf.count++;
            Object.assign(breakdown.readPdf.metrics, node.metrics);
            break;
        case 'load-pdf':
            breakdown.loadPdf.time += selfTime;
            breakdown.loadPdf.count++;
            Object.assign(breakdown.loadPdf.metrics, node.metrics);
            break;
        case 'read-profile':
            breakdown.readProfile.time += selfTime;
            breakdown.readProfile.count++;
            Object.assign(breakdown.readProfile.metrics, node.metrics);
            break;
        case 'serialize-pdf':
            breakdown.serializePdf.time += selfTime;
            breakdown.serializePdf.count++;
            Object.assign(breakdown.serializePdf.metrics, node.metrics);
            break;
        case 'write-pdf':
            breakdown.writePdf.time += selfTime;
            breakdown.writePdf.count++;
            Object.assign(breakdown.writePdf.metrics, node.metrics);
            break;

        // Category containers - use inclusive time for total
        case 'document-conversion':
            breakdown.documentConversion.time += inclusiveTime;
            breakdown.documentConversion.count++;
            Object.assign(breakdown.documentConversion.metrics, node.metrics);
            break;
        case 'page':
            breakdown.page.time += inclusiveTime;
            breakdown.page.count++;
            // Merge page metrics
            for (const [k, v] of Object.entries(node.metrics)) {
                if (typeof v === 'number') {
                    breakdown.page.metrics[k] = (breakdown.page.metrics[k] || 0) + v;
                }
            }
            break;
        case 'stream-batch':
            breakdown.streamBatch.time += inclusiveTime;
            breakdown.streamBatch.count++;
            Object.assign(breakdown.streamBatch.metrics, node.metrics);
            break;
        case 'image-batch':
            breakdown.imageBatch.time += inclusiveTime;
            breakdown.imageBatch.count++;
            Object.assign(breakdown.imageBatch.metrics, node.metrics);
            break;

        // Leaf operations - use self time (avoids double-counting)
        case 'convert':
            breakdown.convert.time += selfTime;
            breakdown.convert.count++;
            // Merge convert metrics (may be called multiple times)
            for (const [k, v] of Object.entries(node.metrics)) {
                if (typeof v === 'number') {
                    breakdown.convert.metrics[k] = (breakdown.convert.metrics[k] || 0) + v;
                }
            }
            break;
        case 'rebuild':
            breakdown.rebuild.time += selfTime;
            breakdown.rebuild.count++;
            // Merge rebuild metrics
            for (const [k, v] of Object.entries(node.metrics)) {
                if (typeof v === 'number') {
                    breakdown.rebuild.metrics[k] = (breakdown.rebuild.metrics[k] || 0) + v;
                }
            }
            break;
        case 'decode':
            breakdown.decode.time += selfTime;
            breakdown.decode.count++;
            // Merge decode metrics (called per image)
            for (const [k, v] of Object.entries(node.metrics)) {
                if (typeof v === 'number') {
                    breakdown.decode.metrics[k] = (breakdown.decode.metrics[k] || 0) + v;
                }
            }
            break;
        case 'normalize-bpc':
            breakdown.normalizeBpc.time += selfTime;
            breakdown.normalizeBpc.count++;
            // Merge normalize-bpc metrics
            for (const [k, v] of Object.entries(node.metrics)) {
                if (typeof v === 'number') {
                    breakdown.normalizeBpc.metrics[k] = (breakdown.normalizeBpc.metrics[k] || 0) + v;
                }
            }
            break;
        case 'transform':
            breakdown.transform.time += selfTime;
            breakdown.transform.count++;
            // Merge transform metrics (called per image)
            for (const [k, v] of Object.entries(node.metrics)) {
                if (typeof v === 'number') {
                    breakdown.transform.metrics[k] = (breakdown.transform.metrics[k] || 0) + v;
                }
            }
            break;
        case 'encode':
            breakdown.encode.time += selfTime;
            breakdown.encode.count++;
            // Merge encode metrics (called per image)
            for (const [k, v] of Object.entries(node.metrics)) {
                if (typeof v === 'number') {
                    breakdown.encode.metrics[k] = (breakdown.encode.metrics[k] || 0) + v;
                }
            }
            break;
        case 'parse':
            // Content stream parsing - leaf operation
            breakdown.convert.time += selfTime;
            breakdown.convert.count++;
            // Merge parse metrics
            for (const [k, v] of Object.entries(node.metrics)) {
                if (typeof v === 'number') {
                    breakdown.convert.metrics[k] = (breakdown.convert.metrics[k] || 0) + v;
                }
            }
            break;
        case 'build-lookup-table':
            // Part of convert process - add to convert time
            breakdown.convert.time += selfTime;
            // Don't increment count - this is a sub-operation of convert
            break;
    }

    // Recurse into children
    for (const child of node.children) {
        extractBreakdownFromNode(child, breakdown);
    }
}

/**
 * Identifies bottlenecks (phases taking >30% of their parent time).
 * Returns time, percentage of parent, and parallelism factor as separate fields.
 *
 * @param {ReturnType<typeof extractBreakdown>} breakdown
 * @param {number} totalTime
 * @returns {Array<{phase: string, time: string, percent: string, parent: string, parallelism: string|null, sortKey: number}>}
 */
function identifyBottlenecks(breakdown, totalTime) {
    const bottlenecks = [];
    const threshold = 0.30; // 30%

    // Top-level phases (relative to total time)
    const topLevelPhases = [
        { name: 'Read PDF', entry: breakdown.readPdf },
        { name: 'Load PDF', entry: breakdown.loadPdf },
        { name: 'Serialize PDF', entry: breakdown.serializePdf },
        { name: 'Write PDF', entry: breakdown.writePdf },
        { name: 'Document Conversion', entry: breakdown.documentConversion },
        { name: 'Stream Batch', entry: breakdown.streamBatch },
        { name: 'Image Batch', entry: breakdown.imageBatch },
    ];

    // Child phases (relative to their parent batch time)
    const streamBase = breakdown.streamBatch.time || totalTime;
    const imageBase = breakdown.imageBatch.time || totalTime;

    // Calculate cumulative child times for parallelism factor
    const streamChildTotal = breakdown.convert.time + breakdown.rebuild.time;
    const imageChildTotal = breakdown.decode.time + breakdown.normalizeBpc.time + breakdown.transform.time + breakdown.encode.time;

    // Parallelism factors (cumulative child time / parent wall-clock time)
    const streamParallelism = streamBase > 0 ? streamChildTotal / streamBase : 0;
    const imageParallelism = imageBase > 0 ? imageChildTotal / imageBase : 0;

    const childPhases = [
        { name: 'Stream Convert [WASM]', entry: breakdown.convert, parent: streamBase, parentName: 'stream-batch', parallelism: streamParallelism },
        { name: 'Stream Rebuild', entry: breakdown.rebuild, parent: streamBase, parentName: 'stream-batch', parallelism: streamParallelism },
        { name: 'Image Decode', entry: breakdown.decode, parent: imageBase, parentName: 'image-batch', parallelism: imageParallelism },
        { name: 'Image Normalize BPC', entry: breakdown.normalizeBpc, parent: imageBase, parentName: 'image-batch', parallelism: imageParallelism },
        { name: 'Image Transform [WASM]', entry: breakdown.transform, parent: imageBase, parentName: 'image-batch', parallelism: imageParallelism },
        { name: 'Image Encode', entry: breakdown.encode, parent: imageBase, parentName: 'image-batch', parallelism: imageParallelism },
    ];

    // Check top-level phases
    for (const { name, entry } of topLevelPhases) {
        if (entry.time > 0) {
            const percent = (entry.time / totalTime) * 100;
            if (percent >= threshold * 100) {
                bottlenecks.push({
                    phase: name,
                    time: formatDuration(entry.time),
                    percent: `${percent.toFixed(1)}%`,
                    parent: 'total',
                    parallelism: null,
                    sortKey: percent,
                });
            }
        }
    }

    // Check child phases (relative to parent)
    for (const { name, entry, parent, parentName, parallelism } of childPhases) {
        if (entry.time > 0 && parent > 0) {
            const percentValue = (entry.time / parent) * 100;
            if (percentValue >= threshold * 100) {
                bottlenecks.push({
                    phase: name,
                    time: formatDuration(entry.time),
                    percent: `${percentValue.toFixed(1)}%`,
                    parent: parentName,
                    parallelism: `${parallelism.toFixed(1)}x`,
                    sortKey: percentValue,
                });
            }
        }
    }

    // Sort by percentage descending
    bottlenecks.sort((a, b) => b.sortKey - a.sortKey);

    return bottlenecks;
}

/**
 * Collects total metrics from a node tree.
 *
 * @param {DiagnosticsNode} node
 * @param {Record<string, number>} metrics
 */
function collectTotals(node, metrics) {
    for (const [key, value] of Object.entries(node.metrics)) {
        if (key !== 'time' && key !== 'time (inc)') {
            metrics[key] = (metrics[key] || 0) + value;
        }
    }
    for (const child of node.children) {
        collectTotals(child, metrics);
    }
}

/**
 * Counts total nodes in a tree.
 *
 * @param {DiagnosticsNode} node
 * @returns {number}
 */
function countNodes(node) {
    let count = 1;
    for (const child of node.children) {
        count += countNodes(child);
    }
    return count;
}

/**
 * Summarizes children by name.
 *
 * @param {DiagnosticsNode[]} children
 * @returns {Record<string, {count: number, totalTime: number}>}
 */
function summarizeChildren(children) {
    const summary = {};
    for (const child of children) {
        const name = child.name;
        if (!summary[name]) {
            summary[name] = { count: 0, totalTime: 0 };
        }
        summary[name].count++;
        summary[name].totalTime += (child.metrics['time (inc)'] || 0) * 1000;
    }
    return summary;
}

// ============================================================================
// Conversion: JSON → Summary Text
// ============================================================================

/**
 * Converts Hatchet JSON to summary statistics.
 *
 * @param {DiagnosticsNode[]} nodes
 * @returns {string}
 */
function toSummaryText(nodes) {
    const lines = [];

    // Aggregate by operation type
    const byType = {};
    const metrics = {};

    for (const node of nodes) {
        aggregateByType(node, byType, metrics);
    }

    // Header
    lines.push('=== Diagnostics Summary ===');
    lines.push('');

    // By operation type
    lines.push('Operations:');
    const sortedTypes = Object.entries(byType)
        .sort((a, b) => b[1].totalTime - a[1].totalTime);

    for (const [type, info] of sortedTypes) {
        const avgTime = info.count > 0 ? info.totalTime / info.count : 0;
        lines.push(`  ${type}:`);
        lines.push(`    count: ${info.count}`);
        lines.push(`    total: ${formatDuration(info.totalTime)}`);
        lines.push(`    avg: ${formatDuration(avgTime)}`);
        if (info.minTime !== Infinity) {
            lines.push(`    min: ${formatDuration(info.minTime)}`);
            lines.push(`    max: ${formatDuration(info.maxTime)}`);
        }
    }

    // Aggregate metrics
    if (Object.keys(metrics).length > 0) {
        lines.push('');
        lines.push('Metrics:');
        for (const [key, value] of Object.entries(metrics)) {
            lines.push(`  ${key}: ${formatNumber(value)}`);
        }
    }

    return lines.join('\n');
}

/**
 * Aggregates nodes by operation type.
 *
 * @param {DiagnosticsNode} node
 * @param {Record<string, {count: number, totalTime: number, minTime: number, maxTime: number}>} byType
 * @param {Record<string, number>} metrics
 */
function aggregateByType(node, byType, metrics) {
    const type = node.name;
    const time = (node.metrics['time (inc)'] || 0) * 1000;

    if (!byType[type]) {
        byType[type] = { count: 0, totalTime: 0, minTime: Infinity, maxTime: 0 };
    }

    byType[type].count++;
    byType[type].totalTime += time;
    byType[type].minTime = Math.min(byType[type].minTime, time);
    byType[type].maxTime = Math.max(byType[type].maxTime, time);

    // Collect metrics
    for (const [key, value] of Object.entries(node.metrics)) {
        if (key !== 'time' && key !== 'time (inc)') {
            metrics[key] = (metrics[key] || 0) + value;
        }
    }

    // Recurse
    for (const child of node.children) {
        aggregateByType(child, byType, metrics);
    }
}

// ============================================================================
// Formatting Helpers
// ============================================================================

/**
 * Formats a duration in milliseconds.
 *
 * @param {number} ms
 * @returns {string}
 */
function formatDuration(ms) {
    if (ms < 0.001) {
        return `${(ms * 1000000).toFixed(0)}ns`;
    }
    if (ms < 1) {
        return `${(ms * 1000).toFixed(0)}µs`;
    }
    if (ms < 1000) {
        return `${ms.toFixed(1)}ms`;
    }
    return `${(ms / 1000).toFixed(2)}s`;
}

/**
 * Formats a number with locale separators.
 *
 * @param {number} n
 * @returns {string}
 */
function formatNumber(n) {
    if (Number.isInteger(n)) {
        return n.toLocaleString();
    }
    return n.toLocaleString(undefined, { maximumFractionDigits: 3 });
}

// ============================================================================
// Run CLI
// ============================================================================

// Only run main() when executed directly (not imported)
if (process.argv[1] && (
    process.argv[1].endsWith('convert-diagnostics-profile.js') ||
    process.argv[1].endsWith('convert-diagnostics-profile')
)) {
    main();
}

// Export functions for testing
export { toCPUProfile, toText, toCompactText, toSummaryText, formatDuration, formatNumber };
