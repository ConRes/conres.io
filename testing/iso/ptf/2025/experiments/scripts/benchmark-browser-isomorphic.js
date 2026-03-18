#!/usr/bin/env node
// @ts-check
/**
 * Browser Isomorphic Benchmark
 *
 * Tests that color conversion produces identical results in:
 * 1. Node.js (using zlib/pako fallback)
 * 2. Browser (using pako via importmap)
 *
 * This ensures the code is truly isomorphic and can run in both environments.
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
import { readFile, mkdir, writeFile, readdir, unlink } from 'fs/promises';
import { performance } from 'perf_hooks';
import { chromium } from 'playwright-chromium';
import { spawn } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..', '..', '..', '..', '..', '..'); // 6 levels up to conres.io
const fixturesDir = join(rootDir, 'testing', 'iso', 'ptf', 'fixtures');
const experimentsDir = join(__dirname, '..');
const testingDir = join(__dirname, '..', '..');

// Configuration
const TEST_PDFS = [
    {
        name: 'Interlaken Map',
        pages: 3,
        path: join(experimentsDir, 'output', '2025-12-17-Acrobat', '2025-08-15 - ConRes - ISO PTF - CR1 - Interlaken Map.pdf'),
        outputPrefix: '2025-08-15 - ConRes - ISO PTF - CR1 - Interlaken Map',
    },
    {
        name: 'Full Test Form',
        pages: 28,
        path: join(rootDir, 'assets', 'testforms', '2025-08-15 - ConRes - ISO PTF - CR1.pdf'),
        outputPrefix: '2025-08-15 - ConRes - ISO PTF - CR1',
    },
];
const PROFILE_PATH = join(fixturesDir, 'profiles', 'eciCMYK v2.icc');
const TEST_PORT = 8080;
const BASE_URL = `http://localhost:${TEST_PORT}`;

/**
 * Format bytes to human readable
 */
function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/**
 * Format duration
 */
function formatDuration(ms) {
    if (ms < 1000) return `${ms.toFixed(0)}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    const mins = Math.floor(ms / 60000);
    const secs = ((ms % 60000) / 1000).toFixed(1);
    return `${mins}m ${secs}s`;
}

/**
 * Get next output folder
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
 * Check if server is running
 */
async function checkServer() {
    try {
        const response = await fetch(`${BASE_URL}/testing/iso/ptf/2025/index.html`);
        return response.ok;
    } catch {
        return false;
    }
}

/**
 * Start local server
 */
async function startServer() {
    console.log(`📡 Starting local server on port ${TEST_PORT}...`);

    const server = spawn('npx', ['http-server', '-d', 'false', '--cors', '-s', '-c-1', '-p', String(TEST_PORT)], {
        cwd: rootDir,
        stdio: 'pipe',
        shell: true,
        detached: true,
    });

    // Wait for server to be ready
    let attempts = 0;
    while (attempts < 30) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        if (await checkServer()) {
            console.log('✅ Server started successfully\n');
            return server;
        }
        attempts++;
    }

    throw new Error('Failed to start server after 30 seconds');
}

/**
 * Run Node.js baseline conversion
 * @param {ArrayBuffer} pdfBytes
 * @param {ArrayBuffer} profileBuffer
 * @param {string} outputDir
 * @param {string} folderId
 * @param {string} outputPrefix
 */
async function runNodeConversion(pdfBytes, profileBuffer, outputDir, folderId, outputPrefix) {
    console.log('\n─ Node.js Baseline ─');
    const start = performance.now();

    // Lazy imports
    const { PDFDocument } = await import('pdf-lib');
    const { PDFService } = await import(join(testingDir, 'services', 'PDFService.js'));

    const pdfDocument = await PDFDocument.load(pdfBytes);

    await PDFService.convertColorInPDFDocument(pdfDocument, {
        destinationProfile: profileBuffer,
        renderingIntent: 'preserve-k-only-relative-colorimetric-gcr',
        convertImages: true,
        convertContentStreams: true,
        compressImages: true,
        verbose: false,
    });

    const outputBytes = await pdfDocument.save();
    const duration = performance.now() - start;

    // Save output
    const outputFileName = `${outputPrefix} - Node.js (${folderId}).pdf`;
    const outputPath = join(outputDir, outputFileName);
    await writeFile(outputPath, outputBytes);

    console.log(`  Duration: ${formatDuration(duration)}`);
    console.log(`  Output size: ${formatBytes(outputBytes.length)}`);
    console.log(`  Saved: ${outputFileName}`);

    return {
        environment: 'Node.js',
        duration,
        outputSize: outputBytes.length,
        outputBytes: new Uint8Array(outputBytes),
        outputPath,
    };
}

/**
 * Run browser conversion using Playwright
 * Uses file URLs for large data transfer instead of serializing to arrays
 * @param {ArrayBuffer} pdfBytes
 * @param {ArrayBuffer} profileBuffer
 * @param {string} outputDir
 * @param {string} folderId
 * @param {string} outputPrefix
 */
async function runBrowserConversion(pdfBytes, profileBuffer, outputDir, folderId, outputPrefix) {
    console.log('\n─ Browser (Chromium) ─');
    const start = performance.now();

    // Write temporary files for the browser to fetch
    const tempPDFPath = join(testingDir, 'tests', 'fixtures', 'temp-benchmark.pdf');
    const tempProfilePath = join(testingDir, 'tests', 'fixtures', 'temp-benchmark.icc');
    await writeFile(tempPDFPath, new Uint8Array(pdfBytes));
    await writeFile(tempProfilePath, new Uint8Array(profileBuffer));

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    // Output will be saved via Playwright download handling
    /** @type {Uint8Array | null} */
    let outputBytes = null;
    const tempOutputPath = join(testingDir, 'tests', 'fixtures', 'temp-benchmark-output.pdf');

    try {
        // Navigate to test page
        await page.goto(`${BASE_URL}/testing/iso/ptf/2025/tests/index.html`);

        // Set up download handling - Playwright will save the file
        // Use 30 min timeout since conversions can take 10+ minutes
        const downloadPromise = page.waitForEvent('download', { timeout: 30 * 60 * 1000 });

        // Extract and inject importmap from parent index.html
        const parentHtml = await readFile(join(testingDir, 'index.html'), 'utf-8');
        const match = /<script type="importmap">\s*([\s\S]*?)\s*<\/script>/m.exec(parentHtml);
        if (!match) throw new Error('Failed to extract importmap from index.html');

        const importmap = JSON.parse(match[1]);

        // Rewrite paths for tests/ subdirectory
        if (importmap.imports) {
            for (const [key, value] of Object.entries(importmap.imports)) {
                if (typeof value === 'string' && value.startsWith('./')) {
                    importmap.imports[key] = '../' + value.slice(2);
                }
            }
        }

        await page.addScriptTag({ type: 'importmap', content: JSON.stringify(importmap) });

        // Set a long timeout for the evaluate since conversions can take 10+ minutes
        page.setDefaultTimeout(30 * 60 * 1000);

        // Run conversion in browser context
        const result = await page.evaluate(async () => {
            // Fetch files via HTTP
            const [pdfResponse, profileResponse] = await Promise.all([
                fetch('./fixtures/temp-benchmark.pdf'),
                fetch('./fixtures/temp-benchmark.icc'),
            ]);

            const pdfBytes = await pdfResponse.arrayBuffer();
            const profileBuffer = await profileResponse.arrayBuffer();

            // Import modules in browser
            const { PDFDocument } = await import('pdf-lib');
            const { PDFService } = await import('../services/PDFService.js');

            const startTime = performance.now();

            const pdfDocument = await PDFDocument.load(pdfBytes);

            await PDFService.convertColorInPDFDocument(pdfDocument, {
                destinationProfile: profileBuffer,
                renderingIntent: 'preserve-k-only-relative-colorimetric-gcr',
                convertImages: true,
                convertContentStreams: true,
                compressImages: true,
                verbose: false,
            });

            const outputBytes = await pdfDocument.save();
            const duration = performance.now() - startTime;

            // Trigger download - Playwright will intercept
            const blob = new Blob([outputBytes], { type: 'application/pdf' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'benchmark-output.pdf';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            return {
                duration,
                outputSize: outputBytes.length,
            };
        });

        // Wait for download and save it
        const download = await downloadPromise;
        await download.saveAs(tempOutputPath);

        // Read the downloaded file
        outputBytes = await readFile(tempOutputPath);

        const totalDuration = performance.now() - start;

        const outputFileName = `${outputPrefix} - Browser (${folderId}).pdf`;
        const outputPath = join(outputDir, outputFileName);
        await writeFile(outputPath, outputBytes);

        console.log(`  Duration (in-browser): ${formatDuration(result.duration)}`);
        console.log(`  Duration (total w/Playwright): ${formatDuration(totalDuration)}`);
        console.log(`  Output size: ${formatBytes(result.outputSize)}`);
        console.log(`  Saved: ${outputFileName}`);

        return {
            environment: 'Browser',
            duration: result.duration,
            totalDuration,
            outputSize: result.outputSize,
            outputBytes,
            outputPath,
        };
    } finally {
        await context.close();
        await browser.close();

        // Clean up temp files
        try {
            await unlink(tempPDFPath);
            await unlink(tempProfilePath);
            await unlink(tempOutputPath);
        } catch (e) {
            // Ignore cleanup errors
        }
    }
}

/**
 * Compare two Uint8Arrays
 */
function compareBytes(a, b) {
    if (a.length !== b.length) {
        return { identical: false, reason: `Size mismatch: ${a.length} vs ${b.length}` };
    }

    let firstDiffIndex = -1;
    let lastDiffIndex = -1;
    let diffCount = 0;

    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) {
            if (firstDiffIndex === -1) firstDiffIndex = i;
            lastDiffIndex = i;
            diffCount++;
        }
    }

    if (diffCount === 0) {
        return { identical: true };
    }

    // Check if differences are only in the trailer (last 10KB typically contains metadata)
    const trailerStart = a.length - 10000;
    const onlyInTrailer = firstDiffIndex >= trailerStart;

    return {
        identical: false,
        reason: `${diffCount} bytes differ (offset ${firstDiffIndex} to ${lastDiffIndex})`,
        diffCount,
        firstDiffIndex,
        lastDiffIndex,
        onlyInTrailer,
        trailerStart,
        diffPercentage: ((diffCount / a.length) * 100).toFixed(4),
    };
}

async function main() {
    const OUTPUT_DIR = await getNextOutputFolder();
    const folderId = basename(OUTPUT_DIR);

    console.log('═'.repeat(80));
    console.log('Browser Isomorphic Benchmark');
    console.log('═'.repeat(80));
    console.log();
    console.log(`Output folder: ${folderId}`);
    console.log(`Test PDFs: ${TEST_PDFS.map(p => `${p.name} (${p.pages} pages)`).join(', ')}`);
    console.log();

    await mkdir(OUTPUT_DIR, { recursive: true });

    // Check/start server
    let server = null;
    const serverRunning = await checkServer();
    if (!serverRunning) {
        server = await startServer();
    } else {
        console.log('✅ Server already running\n');
    }

    // Load profile once
    const profileBuffer = await readFile(PROFILE_PATH);

    // Results for all PDFs
    const allResults = [];

    try {
        for (const testPDF of TEST_PDFS) {
            console.log('\n' + '▓'.repeat(80));
            console.log(`▓  ${testPDF.name} (${testPDF.pages} pages)`);
            console.log('▓'.repeat(80));

            // Load PDF
            console.log('\nLoading input files...');
            const pdfBytes = await readFile(testPDF.path);
            console.log(`  PDF: ${formatBytes(pdfBytes.length)}`);
            console.log(`  Profile: ${formatBytes(profileBuffer.length)}`);

            // Run Node.js conversion
            const nodeResult = await runNodeConversion(
                pdfBytes.buffer.slice(pdfBytes.byteOffset, pdfBytes.byteOffset + pdfBytes.byteLength),
                profileBuffer.buffer.slice(profileBuffer.byteOffset, profileBuffer.byteOffset + profileBuffer.byteLength),
                OUTPUT_DIR,
                folderId,
                testPDF.outputPrefix
            );

            // Run browser conversion
            const browserResult = await runBrowserConversion(
                pdfBytes.buffer.slice(pdfBytes.byteOffset, pdfBytes.byteOffset + pdfBytes.byteLength),
                profileBuffer.buffer.slice(profileBuffer.byteOffset, profileBuffer.byteOffset + profileBuffer.byteLength),
                OUTPUT_DIR,
                folderId,
                testPDF.outputPrefix
            );

            // Compare results
            const sizeMatch = nodeResult.outputSize === browserResult.outputSize;
            const comparison = compareBytes(nodeResult.outputBytes, browserResult.outputBytes);
            const speedRatio = (nodeResult.duration / browserResult.duration).toFixed(2);

            console.log('\n### Results\n');
            console.log('| Environment | Duration | Output Size |');
            console.log('|-------------|----------|-------------|');
            console.log(`| Node.js | ${formatDuration(nodeResult.duration)} | ${formatBytes(nodeResult.outputSize)} |`);
            console.log(`| Browser | ${formatDuration(browserResult.duration)} | ${formatBytes(browserResult.outputSize)} |`);
            console.log(`\nBrowser is ${speedRatio}x ${browserResult.duration < nodeResult.duration ? 'faster' : 'slower'} than Node.js`);
            console.log(`Size match: ${sizeMatch ? '✅ YES' : '❌ NO'}`);
            console.log(`Binary identical: ${comparison.identical ? '✅ YES' : '❌ NO'}${!comparison.identical ? ` (${comparison.reason})` : ''}`);

            allResults.push({
                testPDF: `${testPDF.name} (${testPDF.pages} pages)`,
                pages: testPDF.pages,
                node: {
                    duration: nodeResult.duration,
                    outputSize: nodeResult.outputSize,
                    outputFile: basename(nodeResult.outputPath),
                },
                browser: {
                    duration: browserResult.duration,
                    totalDuration: browserResult.totalDuration,
                    outputSize: browserResult.outputSize,
                    outputFile: basename(browserResult.outputPath),
                },
                comparison: {
                    sizeMatch,
                    binaryIdentical: comparison.identical,
                    reason: comparison.reason,
                    speedRatio: parseFloat(speedRatio),
                },
            });
        }

        // Final summary
        console.log('\n' + '═'.repeat(80));
        console.log('FINAL SUMMARY');
        console.log('═'.repeat(80));

        console.log('\n### All PDFs\n');
        console.log('| PDF | Pages | Node.js | Browser | Speedup | Size Match | Binary Match |');
        console.log('|-----|-------|---------|---------|---------|------------|--------------|');
        for (const result of allResults) {
            console.log(`| ${result.testPDF} | ${result.pages} | ${formatDuration(result.node.duration)} | ${formatDuration(result.browser.duration)} | ${result.comparison.speedRatio}x | ${result.comparison.sizeMatch ? '✅' : '❌'} | ${result.comparison.binaryIdentical ? '✅' : '⚠️'} |`);
        }

        // Save results
        const resultsData = {
            timestamp: new Date().toISOString(),
            folderId,
            results: allResults,
        };

        const resultsPath = join(OUTPUT_DIR, 'isomorphic-benchmark-results.json');
        await writeFile(resultsPath, JSON.stringify(resultsData, null, 2));
        console.log(`\nResults saved: ${resultsPath}`);

        // Final verdict
        const allSizesMatch = allResults.every(r => r.comparison.sizeMatch);
        const allBinaryMatch = allResults.every(r => r.comparison.binaryIdentical);

        console.log('\n' + '═'.repeat(80));
        if (allBinaryMatch) {
            console.log('✅ ISOMORPHIC COMPATIBILITY VERIFIED');
            console.log('   Node.js and Browser produce identical output for all PDFs!');
        } else if (allSizesMatch) {
            console.log('⚠️  PARTIAL ISOMORPHIC COMPATIBILITY');
            console.log('   Output sizes match for all PDFs but bytes differ.');
            console.log('   This is expected due to timestamp/ID differences in PDF trailers.');
        } else {
            console.log('❌ ISOMORPHIC COMPATIBILITY FAILED');
            console.log('   Some PDFs have different output sizes between Node.js and Browser.');
        }
        console.log('═'.repeat(80));

    } finally {
        // Cleanup server if we started it
        if (server && server.pid) {
            console.log('\n🛑 Stopping server...');
            try {
                process.kill(-server.pid);
            } catch (e) {
                // Ignore if process already terminated
            }
        }
    }
}

main().catch(error => {
    console.error('Benchmark failed:', error);
    process.exit(1);
});
