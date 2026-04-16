// @ts-check
/**
 * Compression Streams API Tests
 *
 * Verifies that DecompressionStream/CompressionStream with 'deflate-raw'
 * work correctly in both Node.js and browser (via Playwright), including
 * async generator composition via yield* on ReadableStream.
 *
 * These tests validate the API surface needed by:
 * - The PDF validator's streaming decompression pipeline
 * - The generator's ICC profile and content stream compression
 *
 * @module compression-streams-api.test
 * @author Saleh Abdel Motaal <dev@smotaal.io>
 * @ai Claude Opus 4.6 (code generation)
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import { chromium } from 'playwright-chromium';

// ============================================================================
// Shared Test Logic (runs in both Node.js and browser)
// ============================================================================

/**
 * Self-contained test suite that runs in any environment with
 * Compression Streams API and ReadableStream async iteration.
 *
 * @returns {Promise<{ name: string, pass: boolean, error?: string, details?: object }[]>}
 */
async function runCompressionStreamTests() {
    const results = [];

    function arraysEqual(a, b) {
        if (a.length !== b.length) return false;
        for (let i = 0; i < a.length; i++) {
            if (a[i] !== b[i]) return false;
        }
        return true;
    }

    async function collectChunks(asyncIterable) {
        const chunks = [];
        for await (const chunk of asyncIterable) {
            chunks.push(new Uint8Array(chunk));
        }
        const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
        const result = new Uint8Array(totalLength);
        let offset = 0;
        for (const chunk of chunks) {
            result.set(chunk, offset);
            offset += chunk.length;
        }
        return result;
    }

    async function compressRaw(data) {
        const cs = new CompressionStream('deflate-raw');
        const writer = cs.writable.getWriter();
        writer.write(data);
        writer.close();
        return collectChunks(cs.readable);
    }

    async function decompressRaw(data) {
        const ds = new DecompressionStream('deflate-raw');
        const writer = ds.writable.getWriter();
        writer.write(data);
        writer.close();
        return collectChunks(ds.readable);
    }

    // 1. DecompressionStream('deflate-raw') constructor
    try {
        const ds = new DecompressionStream('deflate-raw');
        if (!ds.readable || !ds.writable) throw new Error('Missing readable/writable');
        results.push({ name: 'DecompressionStream(deflate-raw) constructor', pass: true });
    } catch (e) {
        results.push({ name: 'DecompressionStream(deflate-raw) constructor', pass: false, error: e.message });
    }

    // 2. CompressionStream('deflate-raw') constructor
    try {
        const cs = new CompressionStream('deflate-raw');
        if (!cs.readable || !cs.writable) throw new Error('Missing readable/writable');
        results.push({ name: 'CompressionStream(deflate-raw) constructor', pass: true });
    } catch (e) {
        results.push({ name: 'CompressionStream(deflate-raw) constructor', pass: false, error: e.message });
    }

    // 3. ReadableStream[Symbol.asyncIterator]
    try {
        const ds = new DecompressionStream('deflate-raw');
        if (typeof ds.readable[Symbol.asyncIterator] !== 'function') throw new Error('Not async iterable');
        results.push({ name: 'ReadableStream[Symbol.asyncIterator]', pass: true });
    } catch (e) {
        results.push({ name: 'ReadableStream[Symbol.asyncIterator]', pass: false, error: e.message });
    }

    // 4. Round-trip small data
    try {
        const original = new TextEncoder().encode('Hello, Compression Streams API!');
        const compressed = await compressRaw(original);
        const decompressed = await decompressRaw(compressed);
        if (!arraysEqual(original, decompressed)) throw new Error('Data mismatch');
        results.push({ name: 'Round-trip (small)', pass: true, details: { originalSize: original.length, compressedSize: compressed.length } });
    } catch (e) {
        results.push({ name: 'Round-trip (small)', pass: false, error: e.message });
    }

    // 5. yield* ds.readable pattern
    try {
        const original = new TextEncoder().encode('yield* ds.readable — async generator composition');
        const compressed = await compressRaw(original);

        async function* inflateRaw(compressedBytes) {
            const ds = new DecompressionStream('deflate-raw');
            const writer = ds.writable.getWriter();
            writer.write(compressedBytes);
            writer.close();
            yield* ds.readable;
        }

        const decompressed = await collectChunks(inflateRaw(compressed));
        if (!arraysEqual(original, decompressed)) throw new Error('yield* round-trip mismatch');
        results.push({ name: 'yield* ds.readable pattern', pass: true });
    } catch (e) {
        results.push({ name: 'yield* ds.readable pattern', pass: false, error: e.message });
    }

    // 6. Chunked input (multiple writes)
    try {
        const part1 = new TextEncoder().encode('chunk one ');
        const part2 = new TextEncoder().encode('chunk two ');
        const part3 = new TextEncoder().encode('chunk three');
        const full = new Uint8Array([...part1, ...part2, ...part3]);

        const cs = new CompressionStream('deflate-raw');
        const csWriter = cs.writable.getWriter();
        csWriter.write(part1);
        csWriter.write(part2);
        csWriter.write(part3);
        csWriter.close();
        const compressed = await collectChunks(cs.readable);
        const decompressed = await decompressRaw(compressed);
        if (!arraysEqual(full, decompressed)) throw new Error('Chunked mismatch');
        results.push({ name: 'Chunked input (3 writes)', pass: true, details: { totalSize: full.length, compressedSize: compressed.length } });
    } catch (e) {
        results.push({ name: 'Chunked input (3 writes)', pass: false, error: e.message });
    }

    // 7. Large buffer (10 MB)
    try {
        const size = 10 * 1024 * 1024;
        const original = new Uint8Array(size);
        for (let i = 0; i < size; i++) original[i] = i % 256;
        const compressed = await compressRaw(original);
        const decompressed = await decompressRaw(compressed);
        if (decompressed.length !== original.length) throw new Error('Size mismatch: ' + decompressed.length);
        if (!arraysEqual(original, decompressed)) throw new Error('10 MB data mismatch');
        results.push({ name: 'Large buffer (10 MB)', pass: true, details: { originalSize: size, compressedSize: compressed.length, ratio: (compressed.length / size * 100).toFixed(1) + '%' } });
    } catch (e) {
        results.push({ name: 'Large buffer (10 MB)', pass: false, error: e.message });
    }

    // 8. Zero buffer (pixel stub use case)
    try {
        const size = 1024 * 1024;
        const zeros = new Uint8Array(size);
        const compressed = await compressRaw(zeros);
        const decompressed = await decompressRaw(compressed);
        if (decompressed.length !== size) throw new Error('Zero buffer size mismatch');
        if (!decompressed.every(b => b === 0)) throw new Error('Non-zero bytes in decompressed zeros');
        results.push({ name: 'Zero buffer (1 MB — pixel stub)', pass: true, details: { originalSize: size, compressedSize: compressed.length, ratio: (compressed.length / size * 100).toFixed(3) + '%' } });
    } catch (e) {
        results.push({ name: 'Zero buffer (1 MB — pixel stub)', pass: false, error: e.message });
    }

    return results;
}

// Serialize for browser evaluation
const BROWSER_TEST_SOURCE = `(async () => {
${runCompressionStreamTests.toString()}
return runCompressionStreamTests();
})()`;

// ============================================================================
// Node.js Tests
// ============================================================================

describe('Compression Streams API — Node.js', () => {
    /** @type {{ name: string, pass: boolean, error?: string, details?: object }[]} */
    let results;

    before(async () => {
        results = await runCompressionStreamTests();
    });

    test('DecompressionStream(deflate-raw) constructor', () => {
        const r = results.find(r => r.name.includes('DecompressionStream'));
        assert.ok(r?.pass, r?.error);
    });

    test('CompressionStream(deflate-raw) constructor', () => {
        const r = results.find(r => r.name.includes('CompressionStream'));
        assert.ok(r?.pass, r?.error);
    });

    test('ReadableStream[Symbol.asyncIterator]', () => {
        const r = results.find(r => r.name.includes('asyncIterator'));
        assert.ok(r?.pass, r?.error);
    });

    test('Round-trip (small)', () => {
        const r = results.find(r => r.name === 'Round-trip (small)');
        assert.ok(r?.pass, r?.error);
    });

    test('yield* ds.readable pattern', () => {
        const r = results.find(r => r.name.includes('yield*'));
        assert.ok(r?.pass, r?.error);
    });

    test('Chunked input (3 writes)', () => {
        const r = results.find(r => r.name.includes('Chunked'));
        assert.ok(r?.pass, r?.error);
    });

    test('Large buffer (10 MB)', () => {
        const r = results.find(r => r.name.includes('10 MB'));
        assert.ok(r?.pass, r?.error);
    });

    test('Zero buffer (1 MB — pixel stub)', () => {
        const r = results.find(r => r.name.includes('pixel stub'));
        assert.ok(r?.pass, r?.error);
    });
});

// ============================================================================
// Browser Tests (Playwright)
// ============================================================================

describe('Compression Streams API — Browser (Chromium)', () => {
    /** @type {import('playwright-chromium').Browser} */
    let browser;
    /** @type {import('playwright-chromium').Page} */
    let page;
    /** @type {{ name: string, pass: boolean, error?: string, details?: object }[]} */
    let results;

    before(async () => {
        browser = await chromium.launch({ headless: true });
        page = await browser.newPage();
        results = await page.evaluate(BROWSER_TEST_SOURCE);
    });

    after(async () => {
        await browser?.close();
    });

    test('DecompressionStream(deflate-raw) constructor', () => {
        const r = results.find(r => r.name.includes('DecompressionStream'));
        assert.ok(r?.pass, r?.error);
    });

    test('CompressionStream(deflate-raw) constructor', () => {
        const r = results.find(r => r.name.includes('CompressionStream'));
        assert.ok(r?.pass, r?.error);
    });

    test('ReadableStream[Symbol.asyncIterator]', () => {
        const r = results.find(r => r.name.includes('asyncIterator'));
        assert.ok(r?.pass, r?.error);
    });

    test('Round-trip (small)', () => {
        const r = results.find(r => r.name === 'Round-trip (small)');
        assert.ok(r?.pass, r?.error);
    });

    test('yield* ds.readable pattern', () => {
        const r = results.find(r => r.name.includes('yield*'));
        assert.ok(r?.pass, r?.error);
    });

    test('Chunked input (3 writes)', () => {
        const r = results.find(r => r.name.includes('Chunked'));
        assert.ok(r?.pass, r?.error);
    });

    test('Large buffer (10 MB)', () => {
        const r = results.find(r => r.name.includes('10 MB'));
        assert.ok(r?.pass, r?.error);
    });

    test('Zero buffer (1 MB — pixel stub)', () => {
        const r = results.find(r => r.name.includes('pixel stub'));
        assert.ok(r?.pass, r?.error);
    });
});
