#!/usr/bin/env node
// @ts-check
/**
 * Memory benchmark for PDF validation operations.
 *
 * Spawns child processes with constrained --max-old-space-size to establish
 * clear limitations and overhead estimations for:
 * 1. pdf-lib load only (parse PDF into object graph)
 * 2. pdf-lib load + full object enumeration (validation pass)
 * 3. pdf-lib load + save (fix pass — peak: input + output buffers)
 * 4. Ghostscript WASM load (baseline WASM memory)
 * 5. Ghostscript WASM process PDF (WASM + PDF in linear memory)
 *
 * Uses child_process.fork() to spawn itself with --memory-task=<task> flag.
 *
 * @author Saleh Abdel Motaal <dev@smotaal.io>
 * @ai Claude Opus 4.6 (code generation)
 */

import { fork } from 'child_process';
import { readFile, stat, writeFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { parseArgs } from 'node:util';

const __filename = fileURLToPath(import.meta.url);

const { values, positionals } = parseArgs({
    args: process.argv.slice(2).filter(a => a.length > 0),
    allowPositionals: true,
    strict: true,
    options: {
        'task': { type: 'string' },
        'heap': { type: 'string' },
        'help': { type: 'boolean', short: 'h' },
    },
});

// ============================================================================
// Child process mode — run a single memory task
// ============================================================================

if (values.task) {
    const task = values.task;
    const pdfPath = positionals[0];

    if (!pdfPath) {
        console.error('No PDF path provided');
        process.exit(1);
    }

    const memBefore = process.memoryUsage();
    const startTime = performance.now();

    try {
        switch (task) {
            case 'read-file': {
                const bytes = await readFile(pdfPath);
                const elapsed = performance.now() - startTime;
                const memAfter = process.memoryUsage();
                console.log(JSON.stringify({
                    task, success: true, elapsed,
                    fileSize: bytes.length,
                    heapBefore: memBefore.heapUsed,
                    heapAfter: memAfter.heapUsed,
                    heapDelta: memAfter.heapUsed - memBefore.heapUsed,
                    rss: memAfter.rss,
                    external: memAfter.external,
                    arrayBuffers: memAfter.arrayBuffers,
                }));
                break;
            }

            case 'pdflib-load': {
                const bytes = await readFile(pdfPath);
                const readMem = process.memoryUsage();
                const { PDFDocument } = await import('../../packages/pdf-lib/pdf-lib.esm.js');
                const doc = await PDFDocument.load(bytes, { updateMetadata: false });
                const elapsed = performance.now() - startTime;
                const memAfter = process.memoryUsage();
                const pageCount = doc.getPageCount();
                const objectCount = doc.context.enumerateIndirectObjects().length;
                console.log(JSON.stringify({
                    task, success: true, elapsed,
                    fileSize: bytes.length, pageCount, objectCount,
                    heapAfterRead: readMem.heapUsed,
                    heapAfterLoad: memAfter.heapUsed,
                    heapDelta: memAfter.heapUsed - memBefore.heapUsed,
                    rss: memAfter.rss,
                    external: memAfter.external,
                    arrayBuffers: memAfter.arrayBuffers,
                }));
                break;
            }

            case 'pdflib-enumerate': {
                const bytes = await readFile(pdfPath);
                const { PDFDocument, PDFDict, PDFArray, PDFName, PDFRawStream, PDFRef } = await import('../../packages/pdf-lib/pdf-lib.esm.js');
                const doc = await PDFDocument.load(bytes, { updateMetadata: false });
                const loadMem = process.memoryUsage();

                // Simulate a validation pass: enumerate all objects, inspect dicts
                let dictCount = 0, streamCount = 0, refCount = 0;
                const objects = doc.context.enumerateIndirectObjects();
                for (const [ref, obj] of objects) {
                    if (obj instanceof PDFRawStream) {
                        streamCount++;
                        // Read stream dict entries (but don't decode content)
                        for (const [k, v] of obj.dict.entries()) { refCount++; }
                    } else if (obj instanceof PDFDict) {
                        dictCount++;
                        for (const [k, v] of obj.entries()) { refCount++; }
                    }
                }

                const elapsed = performance.now() - startTime;
                const memAfter = process.memoryUsage();
                console.log(JSON.stringify({
                    task, success: true, elapsed,
                    fileSize: bytes.length,
                    objectCount: objects.length, dictCount, streamCount, refCount,
                    heapAfterLoad: loadMem.heapUsed,
                    heapAfterEnum: memAfter.heapUsed,
                    heapDelta: memAfter.heapUsed - memBefore.heapUsed,
                    rss: memAfter.rss,
                    external: memAfter.external,
                    arrayBuffers: memAfter.arrayBuffers,
                }));
                break;
            }

            case 'pdflib-load-save': {
                const bytes = await readFile(pdfPath);
                const { PDFDocument } = await import('../../packages/pdf-lib/pdf-lib.esm.js');
                const doc = await PDFDocument.load(bytes, { updateMetadata: false });
                const loadMem = process.memoryUsage();

                // Save — this is peak memory: input buffer + parsed context + output buffer
                const savedBytes = await doc.save({
                    addDefaultPage: false,
                    updateFieldAppearances: false,
                });

                const elapsed = performance.now() - startTime;
                const memAfter = process.memoryUsage();
                console.log(JSON.stringify({
                    task, success: true, elapsed,
                    fileSize: bytes.length,
                    savedSize: savedBytes.length,
                    heapAfterLoad: loadMem.heapUsed,
                    heapAfterSave: memAfter.heapUsed,
                    heapDelta: memAfter.heapUsed - memBefore.heapUsed,
                    rss: memAfter.rss,
                    external: memAfter.external,
                    arrayBuffers: memAfter.arrayBuffers,
                }));
                break;
            }

            case 'pdflib-save-traditional': {
                const bytes = await readFile(pdfPath);
                const { PDFDocument } = await import('../../packages/pdf-lib/pdf-lib.esm.js');
                const doc = await PDFDocument.load(bytes, { updateMetadata: false });
                const loadMem = process.memoryUsage();

                const savedBytes = await doc.save({
                    addDefaultPage: false,
                    updateFieldAppearances: false,
                    useObjectStreams: false,
                });

                const elapsed = performance.now() - startTime;
                const memAfter = process.memoryUsage();
                console.log(JSON.stringify({
                    task, success: true, elapsed,
                    fileSize: bytes.length,
                    savedSize: savedBytes.length,
                    heapAfterLoad: loadMem.heapUsed,
                    heapAfterSave: memAfter.heapUsed,
                    heapDelta: memAfter.heapUsed - memBefore.heapUsed,
                    rss: memAfter.rss,
                    external: memAfter.external,
                    arrayBuffers: memAfter.arrayBuffers,
                }));
                break;
            }

            default:
                console.error(`Unknown task: ${task}`);
                process.exit(1);
        }
    } catch (e) {
        const elapsed = performance.now() - startTime;
        const memAfter = process.memoryUsage();
        console.log(JSON.stringify({
            task, success: false, elapsed,
            error: e.message?.slice(0, 200),
            errorCode: e.code,
            rss: memAfter.rss,
            heapDelta: memAfter.heapUsed - memBefore.heapUsed,
        }));
    }

    process.exit(0);
}

// ============================================================================
// Parent process mode — orchestrate benchmarks
// ============================================================================

if (values.help || positionals.length === 0) {
    console.log(`Usage: node benchmark-memory.mjs <pdf-file> [pdf-file2 ...]

Benchmarks memory usage for PDF validation operations.
Spawns child processes with constrained heap sizes.

Each child runs a single task and reports memory usage as JSON.`);
    process.exit(0);
}

const MB = 1024 * 1024;

/**
 * @param {string} task
 * @param {string} pdfPath
 * @param {number} heapMB
 * @returns {Promise<object>}
 */
function runTask(task, pdfPath, heapMB) {
    return new Promise((resolve) => {
        const child = fork(__filename, [
            '--task', task, pdfPath,
        ], {
            execArgv: [`--max-old-space-size=${heapMB}`],
            stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
            timeout: 120000,
        });

        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (d) => { stdout += d; });
        child.stderr.on('data', (d) => { stderr += d; });

        child.on('exit', (code, signal) => {
            if (signal === 'SIGKILL' || signal === 'SIGTERM') {
                resolve({ task, heapMB, success: false, error: `Killed (${signal}) — likely OOM`, code, signal });
            } else if (code !== 0) {
                // Check for heap OOM in stderr
                const isOOM = stderr.includes('heap out of memory') || stderr.includes('allocation failed');
                resolve({ task, heapMB, success: false, error: isOOM ? 'OOM' : `Exit code ${code}`, stderr: stderr.slice(0, 200) });
            } else {
                try {
                    const result = JSON.parse(stdout.trim().split('\n').pop());
                    resolve({ ...result, heapMB });
                } catch {
                    resolve({ task, heapMB, success: false, error: 'Could not parse output', stdout: stdout.slice(0, 200) });
                }
            }
        });

        child.on('error', (e) => {
            resolve({ task, heapMB, success: false, error: e.message });
        });
    });
}

function formatBytes(bytes) {
    if (bytes >= 1024 * MB) return `${(bytes / (1024 * MB)).toFixed(1)} GB`;
    if (bytes >= MB) return `${(bytes / MB).toFixed(1)} MB`;
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${bytes} B`;
}

// Run benchmarks
for (const pdfPath of positionals) {
    const fileStat = await stat(pdfPath);
    const fileSizeMB = Math.ceil(fileStat.size / MB);

    console.log(`\n${'='.repeat(100)}`);
    console.log(`FILE: ${pdfPath}`);
    console.log(`Size: ${formatBytes(fileStat.size)}`);
    console.log(`${'='.repeat(100)}\n`);

    const tasks = [
        'read-file',
        'pdflib-load',
        'pdflib-enumerate',
        'pdflib-load-save',
        'pdflib-save-traditional',
    ];

    // Test with progressively constrained heap sizes
    // Start generous, then find the minimum
    const heapSizes = [
        Math.max(fileSizeMB * 4, 512),   // 4x file size or 512MB minimum
        Math.max(fileSizeMB * 3, 384),   // 3x
        Math.max(fileSizeMB * 2, 256),   // 2x
        Math.max(Math.ceil(fileSizeMB * 1.5), 192), // 1.5x
    ];

    for (const task of tasks) {
        console.log(`--- ${task} ---`);

        for (const heapMB of heapSizes) {
            const result = await runTask(task, pdfPath, heapMB);

            if (result.success) {
                const rss = formatBytes(result.rss);
                const heapDelta = formatBytes(result.heapDelta);
                const elapsed = result.elapsed ? `${(result.elapsed / 1000).toFixed(1)}s` : '?';
                const extras = [];
                if (result.fileSize) extras.push(`file=${formatBytes(result.fileSize)}`);
                if (result.savedSize) extras.push(`saved=${formatBytes(result.savedSize)}`);
                if (result.objectCount) extras.push(`objects=${result.objectCount}`);
                if (result.arrayBuffers) extras.push(`arrayBuffers=${formatBytes(result.arrayBuffers)}`);
                console.log(`  heap=${heapMB}MB: OK  rss=${rss}  heapDelta=${heapDelta}  ${elapsed}  ${extras.join('  ')}`);
            } else {
                console.log(`  heap=${heapMB}MB: FAIL  ${result.error}`);
            }
        }
        console.log();
    }
}
