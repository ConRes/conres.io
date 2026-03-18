#!/usr/bin/env node
// @ts-check
/**
 * Final Benchmark - Comprehensive comparison with optimal worker count
 *
 * Runs 4 configurations:
 * 1. 3-page PDF (Interlaken Map) - baseline (no workers)
 * 2. 3-page PDF (Interlaken Map) - workers (auto-detect optimal count)
 * 3. 28-page PDF (Full Test Form) - baseline (no workers)
 * 4. 28-page PDF (Full Test Form) - workers (auto-detect optimal count)
 *
 * Each run is in a separate child process for clean isolation.
 * Worker count is auto-detected based on CPU cores and page count.
 *
 * TODO: This script has MAGIC PATH RESOLUTION that needs normalization.
 * Run from: testing/iso/ptf/2025/experiments/
 */

// =============================================================================
// AGENT RESTRICTIONS - READ BEFORE MODIFYING
// =============================================================================
//
// TODO: This script needs path normalization to be CWD-relative.
// Currently uses __dirname-based paths which is MAGIC.
//
// DO NOT add more magic path resolution patterns.
// If you actively use this script, normalize it first.
//
// =============================================================================

import { fileURLToPath } from 'url';
import { dirname, join, basename } from 'path';
import { readFile, mkdir, writeFile, readdir, stat } from 'fs/promises';
import { fork } from 'child_process';
import { performance } from 'perf_hooks';
import os from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..', '..', '..', '..', '..', '..', '..'); // 7 levels up to conres.io
const fixturesDir = join(rootDir, 'testing', 'iso', 'ptf', 'fixtures');
const experimentsDir = join(__dirname, '..', '..');

// Configuration
const INTERLAKEN_PDF = join(experimentsDir, 'output', '2025-12-17-Acrobat', '2025-08-15 - ConRes - ISO PTF - CR1 - Interlaken Map.pdf');
const FULL_TESTFORM_PDF = join(rootDir, 'assets', 'testforms', '2025-08-15 - ConRes - ISO PTF - CR1.pdf');
const PROFILE_PATH = join(fixturesDir, 'profiles', 'eciCMYK v2.icc');

/**
 * Get recommended worker count based on CPU cores and page count
 * Formula: min(floor(cpuCount/2), pageCount)
 * @param {number} pageCount
 * @returns {number}
 */
function getRecommendedWorkerCount(pageCount) {
    const cpuCount = os.cpus().length;
    const maxWorkers = Math.floor(cpuCount / 2);
    return Math.min(Math.max(1, maxWorkers), pageCount);
}

/**
 * Format bytes
 */
function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/**
 * Format duration for display
 */
function formatDuration(ms) {
    if (ms < 1000) return `${ms.toFixed(0)}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    const mins = Math.floor(ms / 60000);
    const secs = ((ms % 60000) / 1000).toFixed(1);
    return `${mins}m ${secs}s`;
}

/**
 * Format duration for markdown table (consistent format)
 */
function formatDurationTable(ms) {
    const mins = Math.floor(ms / 60000);
    const secs = ((ms % 60000) / 1000).toFixed(1);
    return `${mins}m ${secs}s`;
}

/**
 * Get next output folder number
 */
async function getNextOutputFolder() {
    const outputBaseDir = join(experimentsDir, 'output');
    const today = new Date().toISOString().slice(0, 10);

    const entries = await readdir(outputBaseDir);
    let maxNum = 0;

    for (const entry of entries) {
        const match = entry.match(new RegExp(`^${today}-(\\d{3})`));
        if (match) {
            const num = parseInt(match[1], 10);
            if (num > maxNum) maxNum = num;
        }
    }

    const nextNum = String(maxNum + 1).padStart(3, '0');
    return join(outputBaseDir, `${today}-${nextNum}`);
}

/**
 * Run a conversion in a child process
 * @param {object} options
 * @returns {Promise<{duration: number, outputSize: number, success: boolean, error?: string, outputPath?: string}>}
 */
function runInChildProcess(options) {
    return new Promise((resolve) => {
        const child = fork(join(__dirname, 'benchmark-child-runner.js'), [], {
            stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
        });

        let stdout = '';
        let stderr = '';
        let resultReceived = false;

        child.stdout?.on('data', (data) => { stdout += data; });
        child.stderr?.on('data', (data) => { stderr += data; });

        child.on('message', (msg) => {
            if (msg.type === 'ready') {
                // Now send the task
                child.send(options);
            } else if (!resultReceived) {
                resultReceived = true;
                resolve(msg);
            }
        });

        child.on('error', (error) => {
            if (!resultReceived) {
                resultReceived = true;
                resolve({ success: false, error: error.message, duration: 0, outputSize: 0 });
            }
        });

        child.on('exit', (code) => {
            if (!resultReceived && code !== 0) {
                resultReceived = true;
                resolve({ success: false, error: stderr || `Exit code ${code}`, duration: 0, outputSize: 0 });
            }
        });

        // Timeout after 30 minutes
        setTimeout(() => {
            if (!resultReceived) {
                resultReceived = true;
                child.kill();
                resolve({ success: false, error: 'Timeout after 30 minutes', duration: 0, outputSize: 0 });
            }
        }, 30 * 60 * 1000);
    });
}

/**
 * Run benchmark for a single configuration
 */
async function benchmarkConfiguration(config, profileBuffer, outputDir) {
    const { pdfPath, pdfName, pageCount, strategy, workerCount } = config;
    const label = strategy === 'baseline' ? 'baseline' : `workers-${workerCount}w`;

    console.log(`\n─ ${pdfName} (${pageCount} pages) - ${label} ─`);

    const start = performance.now();

    // Run in child process for isolation
    const result = await runInChildProcess({
        pdfPath,
        strategy,
        workerCount,
        profileBuffer: Array.from(new Uint8Array(profileBuffer)),
        outputDir,
    });

    const duration = result.duration || (performance.now() - start);

    if (result.success) {
        console.log(`  Duration: ${formatDuration(duration)}`);
        console.log(`  Output size: ${formatBytes(result.outputSize)}`);
        if (result.outputPath) {
            console.log(`  Saved: ${basename(result.outputPath)}`);
        }
    } else {
        console.log(`  ❌ Failed: ${result.error}`);
    }

    return {
        pdfName,
        pageCount,
        strategy,
        workerCount,
        duration,
        outputSize: result.outputSize || 0,
        success: result.success,
        error: result.error,
        outputPath: result.outputPath,
    };
}

async function main() {
    const OUTPUT_DIR = await getNextOutputFolder();
    const folderId = basename(OUTPUT_DIR);

    const cpuCount = os.cpus().length;

    console.log('═'.repeat(80));
    console.log('Final Benchmark - Baseline vs Workers with Auto-Detected Worker Count');
    console.log('═'.repeat(80));
    console.log();
    console.log(`Output folder: ${folderId}`);
    console.log(`CPU cores: ${cpuCount} (${os.cpus()[0]?.model || 'unknown'})`);
    console.log(`Platform: ${os.platform()} ${os.arch()}`);
    console.log();

    await mkdir(OUTPUT_DIR, { recursive: true });

    // Load profile
    const profileBuffer = (await readFile(PROFILE_PATH)).buffer;

    // Get input file sizes
    const interlakenSize = (await stat(INTERLAKEN_PDF)).size;
    const fullTestFormSize = (await stat(FULL_TESTFORM_PDF)).size;

    console.log(`Input files:`);
    console.log(`  Interlaken Map (3 pages): ${formatBytes(interlakenSize)}`);
    console.log(`  Full Test Form (28 pages): ${formatBytes(fullTestFormSize)}`);

    // Calculate recommended worker counts
    const workers3Page = getRecommendedWorkerCount(3);
    const workers28Page = getRecommendedWorkerCount(28);

    console.log(`\nRecommended workers:`);
    console.log(`  3-page PDF: ${workers3Page} workers (min(${Math.floor(cpuCount/2)}, 3))`);
    console.log(`  28-page PDF: ${workers28Page} workers (min(${Math.floor(cpuCount/2)}, 28))`);

    // Define all configurations to run
    const configurations = [
        // 3-page baseline
        {
            pdfPath: INTERLAKEN_PDF,
            pdfName: 'Interlaken Map',
            pageCount: 3,
            strategy: 'baseline',
            workerCount: 0,
        },
        // 3-page workers
        {
            pdfPath: INTERLAKEN_PDF,
            pdfName: 'Interlaken Map',
            pageCount: 3,
            strategy: 'workers-stream',
            workerCount: workers3Page,
        },
        // 28-page baseline
        {
            pdfPath: FULL_TESTFORM_PDF,
            pdfName: 'Full Test Form',
            pageCount: 28,
            strategy: 'baseline',
            workerCount: 0,
        },
        // 28-page workers
        {
            pdfPath: FULL_TESTFORM_PDF,
            pdfName: 'Full Test Form',
            pageCount: 28,
            strategy: 'workers-stream',
            workerCount: workers28Page,
        },
    ];

    console.log('\n' + '═'.repeat(80));
    console.log('Running Benchmarks (each in isolated child process)');
    console.log('═'.repeat(80));

    const results = [];

    for (const config of configurations) {
        const result = await benchmarkConfiguration(config, profileBuffer, OUTPUT_DIR);
        results.push(result);
    }

    // Generate summary tables
    console.log('\n' + '═'.repeat(80));
    console.log('RESULTS SUMMARY');
    console.log('═'.repeat(80));

    // Group by PDF
    const interlakenResults = results.filter(r => r.pageCount === 3);
    const fullFormResults = results.filter(r => r.pageCount === 28);

    // Calculate speedups
    const interlakenBaseline = interlakenResults.find(r => r.strategy === 'baseline');
    const interlakenWorkers = interlakenResults.find(r => r.strategy === 'workers-stream');
    const fullFormBaseline = fullFormResults.find(r => r.strategy === 'baseline');
    const fullFormWorkers = fullFormResults.find(r => r.strategy === 'workers-stream');

    const interlakenSpeedup = interlakenBaseline && interlakenWorkers
        ? (interlakenBaseline.duration / interlakenWorkers.duration).toFixed(2)
        : '-';
    const fullFormSpeedup = fullFormBaseline && fullFormWorkers
        ? (fullFormBaseline.duration / fullFormWorkers.duration).toFixed(2)
        : '-';

    // Print markdown table
    console.log('\n### Benchmark Results\n');
    console.log('| PDF | Pages | Strategy | Workers | Duration | Size | Speedup |');
    console.log('|-----|-------|----------|---------|----------|------|---------|');

    for (const r of results) {
        const isWorkers = r.strategy === 'workers-stream';
        const strategyLabel = isWorkers ? 'Workers' : 'Baseline';
        const workerLabel = isWorkers ? String(r.workerCount) : '-';

        let speedup = '-';
        if (r.pageCount === 3 && isWorkers) speedup = `${interlakenSpeedup}x`;
        if (r.pageCount === 28 && isWorkers) speedup = `${fullFormSpeedup}x`;

        console.log(`| ${r.pdfName} | ${r.pageCount} | ${strategyLabel} | ${workerLabel} | ${formatDurationTable(r.duration)} | ${formatBytes(r.outputSize)} | ${speedup} |`);
    }

    // Comparison table
    console.log('\n### Comparison Summary\n');
    console.log('| PDF | Pages | Baseline | Workers | Speedup |');
    console.log('|-----|-------|----------|---------|---------|');
    console.log(`| Interlaken Map | 3 | ${formatDurationTable(interlakenBaseline?.duration || 0)} | ${formatDurationTable(interlakenWorkers?.duration || 0)} (${interlakenWorkers?.workerCount}w) | ${interlakenSpeedup}x |`);
    console.log(`| Full Test Form | 28 | ${formatDurationTable(fullFormBaseline?.duration || 0)} | ${formatDurationTable(fullFormWorkers?.duration || 0)} (${fullFormWorkers?.workerCount}w) | ${fullFormSpeedup}x |`);

    // Validate output sizes match
    console.log('\n### Output Size Validation\n');
    if (interlakenBaseline && interlakenWorkers) {
        const match3 = interlakenBaseline.outputSize === interlakenWorkers.outputSize;
        console.log(`Interlaken Map: ${match3 ? '✅ MATCH' : '❌ MISMATCH'} (baseline: ${formatBytes(interlakenBaseline.outputSize)}, workers: ${formatBytes(interlakenWorkers.outputSize)})`);
    }
    if (fullFormBaseline && fullFormWorkers) {
        const match28 = fullFormBaseline.outputSize === fullFormWorkers.outputSize;
        console.log(`Full Test Form: ${match28 ? '✅ MATCH' : '❌ MISMATCH'} (baseline: ${formatBytes(fullFormBaseline.outputSize)}, workers: ${formatBytes(fullFormWorkers.outputSize)})`);
    }

    // Save results
    const resultsData = {
        timestamp: new Date().toISOString(),
        folderId,
        cpuCount,
        cpuModel: os.cpus()[0]?.model || 'unknown',
        platform: os.platform(),
        arch: os.arch(),
        inputSizes: {
            interlakenMap: interlakenSize,
            fullTestForm: fullTestFormSize,
        },
        recommendedWorkers: {
            threePage: workers3Page,
            twentyEightPage: workers28Page,
        },
        results,
        summary: {
            interlakenMap: {
                baseline: interlakenBaseline?.duration,
                workers: interlakenWorkers?.duration,
                workerCount: interlakenWorkers?.workerCount,
                speedup: parseFloat(interlakenSpeedup) || null,
            },
            fullTestForm: {
                baseline: fullFormBaseline?.duration,
                workers: fullFormWorkers?.duration,
                workerCount: fullFormWorkers?.workerCount,
                speedup: parseFloat(fullFormSpeedup) || null,
            },
        },
    };

    const resultsPath = join(OUTPUT_DIR, 'final-benchmark-results.json');
    await writeFile(resultsPath, JSON.stringify(resultsData, null, 2));
    console.log(`\nResults saved: ${resultsPath}`);

    console.log('\n' + '═'.repeat(80));
    console.log(`Output folder: ${OUTPUT_DIR}`);
    console.log('═'.repeat(80));
}

main().catch(console.error);
