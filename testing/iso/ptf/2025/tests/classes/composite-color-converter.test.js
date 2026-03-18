import { test, describe, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { chromium } from 'playwright-chromium';

describe('CompositeColorConverter', () => {
    let browser, page;

    before(async () => {
        browser = await chromium.launch({ headless: true });
        page = await browser.newPage();
        await page.goto(`${process.env.BASE_URL || 'http://localhost:8080'}/testing/iso/ptf/2025/index.html`);
    });

    after(async () => {
        await browser?.close();
    });

    test('creates WorkerPool when useWorkers is true', async () => {
        const result = await page.evaluate(async () => {
            const { CompositeColorConverter } = await import('./classes/composite-color-converter.js');
            const converter = new CompositeColorConverter({
                renderingIntent: 'relative-colorimetric',
                blackPointCompensation: true,
                useAdaptiveBPCClamping: false,
                destinationProfile: 'sRGB',
                destinationColorSpace: 'RGB',
                verbose: false,
                useWorkers: true,
            });
            await converter.ensureReady();
            const hasPool = converter.workerPool !== null;
            converter.dispose();
            return hasPool;
        });
        assert.strictEqual(result, true);
    });

    test('uses shared WorkerPool when provided', async () => {
        const result = await page.evaluate(async () => {
            const { CompositeColorConverter } = await import('./classes/composite-color-converter.js');
            const { WorkerPool } = await import('./services/WorkerPool.js');

            const sharedPool = new WorkerPool({});
            await sharedPool.initialize();

            const converter = new CompositeColorConverter({
                renderingIntent: 'relative-colorimetric',
                blackPointCompensation: true,
                useAdaptiveBPCClamping: false,
                destinationProfile: 'sRGB',
                destinationColorSpace: 'RGB',
                verbose: false,
                useWorkers: true,
                workerPool: sharedPool,
            });
            await converter.ensureReady();
            const samePool = converter.workerPool === sharedPool;
            converter.dispose();
            // Shared pool should still be usable
            const poolStillWorks = sharedPool !== null;
            sharedPool.terminate();
            return { samePool, poolStillWorks };
        });
        assert.strictEqual(result.samePool, true);
        assert.strictEqual(result.poolStillWorks, true);
    });

    test('does not create WorkerPool when useWorkers is false', async () => {
        const result = await page.evaluate(async () => {
            const { CompositeColorConverter } = await import('./classes/composite-color-converter.js');
            const converter = new CompositeColorConverter({
                renderingIntent: 'relative-colorimetric',
                blackPointCompensation: true,
                useAdaptiveBPCClamping: false,
                destinationProfile: 'sRGB',
                destinationColorSpace: 'RGB',
                verbose: false,
                useWorkers: false,
            });
            await converter.ensureReady();
            const hasPool = converter.workerPool !== null;
            converter.dispose();
            return hasPool;
        });
        assert.strictEqual(result, false);
    });
});
