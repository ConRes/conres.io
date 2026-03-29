// @ts-check
/**
 * Compression Provider Tests
 *
 * Verifies helpers/compression.js in both Node.js and Chromium.
 * Covers all three formats (deflate/zlib, deflate-raw, gzip),
 * pako bidirectional interop, and large buffer handling.
 *
 * @module compression-provider.test
 * @author Saleh Abdel Motaal <dev@smotaal.io>
 * @ai Claude Opus 4.6 (code generation)
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import { chromium } from 'playwright-chromium';

// ============================================================================
// Node.js Tests — direct module import
// ============================================================================

describe('Compression Provider — Node.js', () => {
    /** @type {typeof import('../../helpers/compression.js')} */
    let compression;
    /** @type {typeof import('../../packages/pako/dist/pako.mjs').default} */
    let pako;

    before(async () => {
        compression = await import('../../helpers/compression.js');
        pako = (await import('../../packages/pako/dist/pako.mjs')).default;
    });

    // --- Zlib (PDF FlateDecode) ---

    test('deflateToBuffer produces zlib header (0x78)', async () => {
        const data = new Uint8Array([1, 2, 3, 4, 5]);
        const compressed = await compression.deflateToBuffer(data);
        assert.strictEqual(compressed[0], 0x78, 'zlib header byte');
    });

    test('deflate/inflate zlib round-trip', async () => {
        const data = new Uint8Array(10000);
        for (let i = 0; i < data.length; i++) data[i] = i & 255;
        const compressed = await compression.deflateToBuffer(data);
        const decompressed = await compression.inflateToBuffer(compressed);
        assert.deepStrictEqual(decompressed, data);
    });

    test('deflate zlib → pako.inflate interop', async () => {
        const data = new Uint8Array(5000);
        for (let i = 0; i < data.length; i++) data[i] = (i * 31) & 255;
        const compressed = await compression.deflateToBuffer(data);
        const decompressed = new Uint8Array(pako.inflate(compressed));
        assert.deepStrictEqual(decompressed, data);
    });

    test('pako.deflate → inflate zlib interop', async () => {
        const data = new Uint8Array(5000);
        for (let i = 0; i < data.length; i++) data[i] = (i * 31) & 255;
        const compressed = pako.deflate(data);
        const decompressed = await compression.inflateToBuffer(compressed);
        assert.deepStrictEqual(decompressed, data);
    });

    // --- Raw DEFLATE ---

    test('deflateRawToBuffer produces no zlib header', async () => {
        const data = new Uint8Array([1, 2, 3, 4, 5]);
        const compressed = await compression.deflateRawToBuffer(data);
        assert.notStrictEqual(compressed[0], 0x78, 'should not have zlib header');
    });

    test('deflateRaw/inflateRaw round-trip', async () => {
        const data = new Uint8Array(10000);
        for (let i = 0; i < data.length; i++) data[i] = i & 255;
        const compressed = await compression.deflateRawToBuffer(data);
        const decompressed = await compression.inflateRawToBuffer(compressed);
        assert.deepStrictEqual(decompressed, data);
    });

    test('deflateRaw → pako.inflate({raw:true}) interop', async () => {
        const data = new Uint8Array(5000);
        for (let i = 0; i < data.length; i++) data[i] = (i * 31) & 255;
        const compressed = await compression.deflateRawToBuffer(data);
        const decompressed = new Uint8Array(pako.inflate(compressed, { raw: true }));
        assert.deepStrictEqual(decompressed, data);
    });

    // --- Gzip ---

    test('gzipToBuffer produces gzip header (0x1f 0x8b)', async () => {
        const data = new Uint8Array([1, 2, 3, 4, 5]);
        const compressed = await compression.gzipToBuffer(data);
        assert.strictEqual(compressed[0], 0x1f);
        assert.strictEqual(compressed[1], 0x8b);
    });

    test('gzip/gunzip round-trip', async () => {
        const data = new Uint8Array(10000);
        for (let i = 0; i < data.length; i++) data[i] = i & 255;
        const compressed = await compression.gzipToBuffer(data);
        const decompressed = await compression.gunzipToBuffer(compressed);
        assert.deepStrictEqual(decompressed, data);
    });

    // --- Large buffer ---

    test('deflate zlib 10 MB round-trip', async () => {
        const size = 10 * 1024 * 1024;
        const data = new Uint8Array(size);
        for (let i = 0; i < size; i++) data[i] = i & 255;
        const compressed = await compression.deflateToBuffer(data);
        const decompressed = await compression.inflateToBuffer(compressed);
        assert.strictEqual(decompressed.length, size);
        assert.deepStrictEqual(decompressed, data);
    });

    // --- Streaming async generator ---

    test('deflate streaming yields chunks', async () => {
        const data = new Uint8Array(100000);
        for (let i = 0; i < data.length; i++) data[i] = i & 255;
        let chunkCount = 0;
        for await (const _chunk of compression.deflate(data)) chunkCount++;
        assert.ok(chunkCount >= 1, 'should yield at least 1 chunk');
    });
});

// ============================================================================
// Browser Tests (Playwright) — via importmap on local server
// ============================================================================

const BASE_URL = 'http://localhost:8080';

describe('Compression Provider — Browser (Chromium)', () => {
    /** @type {import('playwright-chromium').Browser} */
    let browser;
    /** @type {import('playwright-chromium').Page} */
    let page;

    before(async () => {
        browser = await chromium.launch({ headless: true });
        page = await browser.newPage();
        await page.goto(`${BASE_URL}/testing/iso/ptf/2026/index.html`);
    });

    after(async () => {
        await browser?.close();
    });

    test('deflateToBuffer produces zlib header', async () => {
        const result = await page.evaluate(async () => {
            const { deflateToBuffer } = await import('./helpers/compression.js');
            const compressed = await deflateToBuffer(new Uint8Array([1, 2, 3, 4, 5]));
            return { header: compressed[0], length: compressed.length };
        });
        assert.strictEqual(result.header, 0x78);
    });

    test('deflate/inflate zlib round-trip', async () => {
        const ok = await page.evaluate(async () => {
            const { deflateToBuffer, inflateToBuffer } = await import('./helpers/compression.js');
            const data = new Uint8Array(10000);
            for (let i = 0; i < data.length; i++) data[i] = i & 255;
            const compressed = await deflateToBuffer(data);
            const decompressed = await inflateToBuffer(compressed);
            return decompressed.length === data.length && decompressed.every((v, i) => v === data[i]);
        });
        assert.ok(ok, 'zlib round-trip in browser');
    });

    test('deflateRaw/inflateRaw round-trip', async () => {
        const ok = await page.evaluate(async () => {
            const { deflateRawToBuffer, inflateRawToBuffer } = await import('./helpers/compression.js');
            const data = new Uint8Array(10000);
            for (let i = 0; i < data.length; i++) data[i] = i & 255;
            const compressed = await deflateRawToBuffer(data);
            const decompressed = await inflateRawToBuffer(compressed);
            return decompressed.length === data.length && decompressed.every((v, i) => v === data[i]);
        });
        assert.ok(ok, 'raw round-trip in browser');
    });

    test('gzip/gunzip round-trip', async () => {
        const ok = await page.evaluate(async () => {
            const { gzipToBuffer, gunzipToBuffer } = await import('./helpers/compression.js');
            const data = new Uint8Array(10000);
            for (let i = 0; i < data.length; i++) data[i] = i & 255;
            const compressed = await gzipToBuffer(data);
            const decompressed = await gunzipToBuffer(compressed);
            return decompressed.length === data.length && decompressed.every((v, i) => v === data[i]);
        });
        assert.ok(ok, 'gzip round-trip in browser');
    });

    test('pako interop: native deflate → pako inflate', async () => {
        const ok = await page.evaluate(async () => {
            const { deflateToBuffer } = await import('./helpers/compression.js');
            const pako = await import('./packages/pako/dist/pako.mjs');
            const data = new Uint8Array(5000);
            for (let i = 0; i < data.length; i++) data[i] = (i * 31) & 255;
            const compressed = await deflateToBuffer(data);
            const decompressed = new Uint8Array(pako.default.inflate(compressed));
            return decompressed.length === data.length && decompressed.every((v, i) => v === data[i]);
        });
        assert.ok(ok, 'native→pako interop in browser');
    });

    test('pako interop: pako deflate → native inflate', async () => {
        const ok = await page.evaluate(async () => {
            const { inflateToBuffer } = await import('./helpers/compression.js');
            const pako = await import('./packages/pako/dist/pako.mjs');
            const data = new Uint8Array(5000);
            for (let i = 0; i < data.length; i++) data[i] = (i * 31) & 255;
            const compressed = pako.default.deflate(data);
            const decompressed = await inflateToBuffer(compressed);
            return decompressed.length === data.length && decompressed.every((v, i) => v === data[i]);
        });
        assert.ok(ok, 'pako→native interop in browser');
    });

    test('streaming deflate yields chunks', async () => {
        const chunkCount = await page.evaluate(async () => {
            const { deflate } = await import('./helpers/compression.js');
            const data = new Uint8Array(100000);
            for (let i = 0; i < data.length; i++) data[i] = i & 255;
            let count = 0;
            for await (const _chunk of deflate(data)) count++;
            return count;
        });
        assert.ok(chunkCount >= 1, 'should yield at least 1 chunk in browser');
    });

    test('large buffer 10 MB zlib round-trip', async () => {
        const ok = await page.evaluate(async () => {
            const { deflateToBuffer, inflateToBuffer } = await import('./helpers/compression.js');
            const size = 10 * 1024 * 1024;
            const data = new Uint8Array(size);
            for (let i = 0; i < size; i++) data[i] = i & 255;
            const compressed = await deflateToBuffer(data);
            const decompressed = await inflateToBuffer(compressed);
            return decompressed.length === size && decompressed.every((v, i) => v === data[i]);
        });
        assert.ok(ok, '10 MB zlib round-trip in browser');
    });
});
