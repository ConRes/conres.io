#!/usr/bin/env node
// @ts-check
/**
 * Benchmark memory-optimized PDF loading strategies:
 * 1. Baseline: standard pdf-lib load
 * 2. Subarray patch: ByteStream.slice uses subarray (zero-copy)
 * 3. Stub images: replace image stream contents with empty buffers after parse
 * 4. Combined: subarray + stub images
 *
 * @author Saleh Abdel Motaal <dev@smotaal.io>
 * @ai Claude Opus 4.6 (code generation)
 */

import { fork } from 'child_process';
import { readFile, stat } from 'fs/promises';
import { fileURLToPath } from 'url';
import { parseArgs } from 'node:util';

const __filename = fileURLToPath(import.meta.url);

const { values, positionals } = parseArgs({
    args: process.argv.slice(2).filter(a => a.length > 0),
    allowPositionals: true,
    strict: true,
    options: {
        'task': { type: 'string' },
        'help': { type: 'boolean', short: 'h' },
    },
});

// ============================================================================
// Child process mode
// ============================================================================

if (values.task) {
    const task = values.task;
    const pdfPath = positionals[0];
    if (!pdfPath) { console.error('No PDF path'); process.exit(1); }

    const memBefore = process.memoryUsage();
    const startTime = performance.now();

    try {
        const bytes = await readFile(pdfPath);
        const memAfterRead = process.memoryUsage();

        // Import pdf-lib — we'll monkey-patch ByteStream if needed
        const pdfLib = await import('../../packages/pdf-lib/pdf-lib.esm.js');
        const { PDFDocument, PDFRawStream, PDFName, PDFNumber } = pdfLib;

        // Apply subarray patch if requested
        if (task === 'subarray' || task === 'combined') {
            // Find ByteStream by accessing the parser internals
            // pdf-lib doesn't export ByteStream, but we can patch via PDFParser
            // The parser creates a ByteStream in forBytesWithOptions
            // We need to patch before load — intercept via prototype

            // Alternative: patch Uint8Array.prototype.slice temporarily during load
            // This is hacky but avoids needing to find ByteStream
            const originalSlice = Uint8Array.prototype.slice;
            let patchActive = false;

            // We only want to patch during pdf-lib parsing, not everywhere
            // So we'll wrap PDFDocument.load
            const originalLoad = PDFDocument.load;
            PDFDocument.load = async function(pdf, options) {
                patchActive = true;
                Uint8Array.prototype.slice = function(start, end) {
                    if (patchActive) {
                        return this.subarray(start, end);
                    }
                    return originalSlice.call(this, start, end);
                };
                try {
                    const result = await originalLoad.call(this, pdf, options);
                    return result;
                } finally {
                    patchActive = false;
                    Uint8Array.prototype.slice = originalSlice;
                }
            };
        }

        const doc = await PDFDocument.load(bytes, { updateMetadata: false });
        const memAfterLoad = process.memoryUsage();

        // Stub image streams if requested
        let stubbedCount = 0;
        let stubbedBytes = 0;

        if (task === 'stub-images' || task === 'combined') {
            const objects = doc.context.enumerateIndirectObjects();
            const emptyBuffer = new Uint8Array(0);

            for (const [ref, obj] of objects) {
                if (!(obj instanceof PDFRawStream)) continue;
                const dict = obj.dict;
                const subtype = dict.get(PDFName.of('Subtype'));
                // Detect images by Subtype=Image OR by presence of Width+Height (pdf-lib embedPage omits Subtype)
                const isImage = subtype instanceof PDFName && subtype.encodedName === 'Image';
                const hasImageDimensions = !isImage
                    && dict.get(PDFName.of('Width')) instanceof PDFNumber
                    && dict.get(PDFName.of('Height')) instanceof PDFNumber;

                if (isImage || hasImageDimensions) {
                    const contentSize = obj.getContentsSize();
                    stubbedBytes += contentSize;
                    stubbedCount++;

                    // Replace contents with empty buffer
                    // For validation we only need the dict (ColorSpace, BPC, Width, Height, Filter)
                    obj.contents = emptyBuffer;
                }
            }
        }

        // Force GC to see actual retained memory
        if (global.gc) global.gc();
        await new Promise(resolve => setTimeout(resolve, 100));
        if (global.gc) global.gc();

        const memAfterStub = process.memoryUsage();
        const elapsed = performance.now() - startTime;

        // Enumerate objects to verify document is still navigable
        let objectCount = 0;
        let streamCount = 0;
        let imageCount = 0;
        let contentStreamCount = 0;
        let iccStreamCount = 0;

        const objects = doc.context.enumerateIndirectObjects();
        for (const [ref, obj] of objects) {
            objectCount++;
            if (obj instanceof PDFRawStream) {
                streamCount++;
                const subtype = obj.dict.get(PDFName.of('Subtype'));
                const type = obj.dict.get(PDFName.of('Type'));
                if (subtype instanceof PDFName) {
                    if (subtype.encodedName === 'Image') imageCount++;
                }
                if (type instanceof PDFName && type.encodedName === 'Metadata') continue;
                const n = obj.dict.get(PDFName.of('N'));
                if (n) iccStreamCount++;
            }
        }

        // Save if requested
        let savedSize = 0;
        if (task === 'baseline-save' || task === 'combined-save') {
            const savedBytes = await doc.save({
                addDefaultPage: false,
                updateFieldAppearances: false,
            });
            savedSize = savedBytes.length;
        }

        const memAfterSave = process.memoryUsage();

        // Check content streams on first page
        const pages = doc.getPages();
        if (pages.length > 0) {
            const contentsRaw = pages[0].node.get(PDFName.of('Contents'));
            if (contentsRaw) contentStreamCount++;
        }

        console.log(JSON.stringify({
            task, success: true, elapsed,
            fileSize: bytes.length, savedSize,
            objectCount, streamCount, imageCount, iccStreamCount,
            stubbedCount, stubbedBytes,
            memRead: { rss: memAfterRead.rss, heap: memAfterRead.heapUsed, ab: memAfterRead.arrayBuffers },
            memLoad: { rss: memAfterLoad.rss, heap: memAfterLoad.heapUsed, ab: memAfterLoad.arrayBuffers },
            memFinal: { rss: memAfterStub.rss, heap: memAfterStub.heapUsed, ab: memAfterStub.arrayBuffers },
            memSave: { rss: memAfterSave.rss, heap: memAfterSave.heapUsed, ab: memAfterSave.arrayBuffers },
        }));

    } catch (e) {
        console.log(JSON.stringify({
            task, success: false, error: e.message?.slice(0, 200), stack: e.stack?.slice(0, 300),
        }));
    }
    process.exit(0);
}

// ============================================================================
// Parent process mode
// ============================================================================

if (values.help || positionals.length === 0) {
    console.log('Usage: node benchmark-memory-optimized.mjs <pdf-file>');
    process.exit(0);
}

const MB = 1024 * 1024;

function formatBytes(bytes) {
    if (bytes >= 1024 * MB) return `${(bytes / (1024 * MB)).toFixed(2)} GB`;
    if (bytes >= MB) return `${(bytes / MB).toFixed(1)} MB`;
    return `${(bytes / 1024).toFixed(1)} KB`;
}

function runTask(task, pdfPath) {
    return new Promise((resolve) => {
        const child = fork(__filename, [
            '--task', task, pdfPath,
        ], {
            execArgv: ['--max-old-space-size=8192', '--expose-gc'],
            stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
            timeout: 300000,
        });

        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (d) => { stdout += d; });
        child.stderr.on('data', (d) => { stderr += d; });

        child.on('exit', (code, signal) => {
            if (signal || code !== 0) {
                resolve({ task, success: false, error: stderr.includes('heap out of memory') ? 'OOM' : `exit ${code} ${signal}`, stderr: stderr.slice(0, 200) });
            } else {
                try {
                    resolve(JSON.parse(stdout.trim().split('\n').pop()));
                } catch {
                    resolve({ task, success: false, error: 'parse error', stdout: stdout.slice(0, 200) });
                }
            }
        });
        child.on('error', (e) => resolve({ task, success: false, error: e.message }));
    });
}

const pdfPath = positionals[0];
const fileStat = await stat(pdfPath);

console.log(`File: ${pdfPath}`);
console.log(`Size: ${formatBytes(fileStat.size)}\n`);

const tasks = ['baseline', 'subarray', 'stub-images', 'combined', 'baseline-save', 'combined-save'];

console.log(`${'Task'.padEnd(18)} ${'Time'.padStart(7)} ${'AB(load)'.padStart(10)} ${'AB(final)'.padStart(10)} ${'AB(save)'.padStart(10)} ${'RSS(save)'.padStart(10)} ${'Saved'.padStart(10)} ${'Stubbed'.padStart(10)}`);
console.log('-'.repeat(95));

for (const task of tasks) {
    const r = await runTask(task, pdfPath);

    if (!r.success) {
        console.log(`${task.padEnd(18)} FAIL: ${r.error}`);
        continue;
    }

    const time = `${(r.elapsed / 1000).toFixed(1)}s`;
    const abLoad = formatBytes(r.memLoad.ab);
    const abFinal = formatBytes(r.memFinal.ab);
    const abSave = r.memSave ? formatBytes(r.memSave.ab) : '-';
    const rssSave = r.memSave ? formatBytes(r.memSave.rss) : '-';
    const saved = r.savedSize > 0 ? formatBytes(r.savedSize) : '-';
    const stubbed = r.stubbedBytes > 0 ? formatBytes(r.stubbedBytes) : '-';

    console.log(`${task.padEnd(18)} ${time.padStart(7)} ${abLoad.padStart(10)} ${abFinal.padStart(10)} ${abSave.padStart(10)} ${rssSave.padStart(10)} ${saved.padStart(10)} ${stubbed.padStart(10)}`);
}
