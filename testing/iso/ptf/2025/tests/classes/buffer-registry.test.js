// @ts-check
/**
 * BufferRegistry Class Tests
 *
 * Tests for pdf-lib stream to SharedArrayBuffer mapping.
 *
 * @module BufferRegistry.test
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import { TruthyEnvironmentParameterMatcher } from '../helpers.js';

// ============================================================================
// Test Fixtures
// ============================================================================

/**
 * Creates a mock PDF stream object.
 * @param {number} size - Content size in bytes
 * @returns {import('../../classes/buffer-registry.js').PDFStream}
 */
function createMockStream(size) {
    const contents = new Uint8Array(size);
    for (let i = 0; i < size; i++) {
        contents[i] = i % 256;
    }
    return { contents };
}

// ============================================================================
// Shared Test Functions (invokeXXXTest pattern)
// ============================================================================

/**
 * Tests getting a shared view for a stream.
 *
 * @param {typeof import('../../classes/buffer-registry.js').BufferRegistry} BufferRegistry
 */
async function invokeGetSharedViewTest(BufferRegistry) {
    const registry = new BufferRegistry();
    const stream = createMockStream(1024);

    const { view, isShared } = registry.getSharedView(stream);

    // Verify view content matches
    assert.strictEqual(view.length, 1024, 'View length should match');
    assert.strictEqual(view[0], 0, 'First byte should match');
    assert.strictEqual(view[255], 255, 'Byte 255 should match');
    assert.strictEqual(view[256], 0, 'Byte 256 should wrap');

    // isShared depends on SharedArrayBuffer availability
    assert.strictEqual(typeof isShared, 'boolean', 'isShared should be boolean');

    registry.dispose();
}

/**
 * Tests caching of shared views.
 *
 * @param {typeof import('../../classes/buffer-registry.js').BufferRegistry} BufferRegistry
 */
async function invokeCachingTest(BufferRegistry) {
    const registry = new BufferRegistry();
    const stream = createMockStream(1024);

    // Get view twice
    const result1 = registry.getSharedView(stream);
    const result2 = registry.getSharedView(stream);

    if (result1.isShared) {
        // If shared, should return same underlying buffer
        assert.strictEqual(
            result1.view.buffer,
            result2.view.buffer,
            'Should return same SharedArrayBuffer'
        );
    }

    // hasMapping should return true
    assert.strictEqual(registry.hasMapping(stream), result1.isShared, 'hasMapping should reflect caching');

    registry.dispose();
}

/**
 * Tests creating shared buffer from raw data.
 *
 * @param {typeof import('../../classes/buffer-registry.js').BufferRegistry} BufferRegistry
 */
async function invokeCreateSharedBufferTest(BufferRegistry) {
    const registry = new BufferRegistry();

    // Create from Uint8Array
    const data = new Uint8Array([1, 2, 3, 4, 5]);
    const { view, isShared } = registry.createSharedBuffer(data);

    assert.strictEqual(view.length, 5, 'View length should match');
    assert.strictEqual(view[0], 1, 'First byte should match');
    assert.strictEqual(view[4], 5, 'Last byte should match');

    // Create from ArrayBuffer
    const arrayBuffer = new ArrayBuffer(10);
    new Uint8Array(arrayBuffer).fill(42);
    const result2 = registry.createSharedBuffer(arrayBuffer);
    assert.strictEqual(result2.view.length, 10, 'View length should match');
    assert.strictEqual(result2.view[0], 42, 'All bytes should be 42');

    registry.dispose();
}

/**
 * Tests bulk stream registration.
 *
 * @param {typeof import('../../classes/buffer-registry.js').BufferRegistry} BufferRegistry
 */
async function invokeRegisterStreamsTest(BufferRegistry) {
    const registry = new BufferRegistry();

    const streams = [
        createMockStream(100),
        createMockStream(200),
        createMockStream(300),
    ];

    const views = registry.registerStreams(streams);

    assert.strictEqual(views.size, 3, 'Should have 3 views');

    for (const [stream, view] of views) {
        assert.strictEqual(view.length, stream.contents.length, 'View length should match stream');
    }

    registry.dispose();
}

/**
 * Tests applying converted data back to stream.
 *
 * @param {typeof import('../../classes/buffer-registry.js').BufferRegistry} BufferRegistry
 */
async function invokeApplyToStreamTest(BufferRegistry) {
    const registry = new BufferRegistry();
    const stream = createMockStream(100);

    const newData = new Uint8Array(150);
    newData.fill(255);

    registry.applyToStream(stream, newData);

    assert.strictEqual(stream.contents.length, 150, 'Stream contents should be replaced');
    assert.strictEqual(stream.contents[0], 255, 'New content should be applied');

    registry.dispose();
}

/**
 * Tests SharedArrayBuffer feature detection.
 *
 * @param {typeof import('../../classes/buffer-registry.js').BufferRegistry} BufferRegistry
 */
async function invokeFeatureDetectionTest(BufferRegistry) {
    const supportsShared = BufferRegistry.supportsSharedBuffers;
    assert.strictEqual(typeof supportsShared, 'boolean', 'Should return boolean');

    const registry = new BufferRegistry();
    assert.strictEqual(registry.stats.supportsSharedBuffers, supportsShared, 'Stats should match static property');

    registry.dispose();
}

/**
 * Tests dispose clears tracking state.
 *
 * @param {typeof import('../../classes/buffer-registry.js').BufferRegistry} BufferRegistry
 */
async function invokeDisposeTest(BufferRegistry) {
    const registry = new BufferRegistry();

    // Register some streams
    registry.registerStreams([
        createMockStream(100),
        createMockStream(200),
    ]);

    // Create some standalone buffers
    registry.createSharedBuffer(new Uint8Array(50));

    assert.ok(registry.stats.totalBytes > 0, 'Should have allocated bytes');

    registry.dispose();

    assert.strictEqual(registry.stats.sharedBufferCount, 0, 'Should have no shared buffers');
    assert.strictEqual(registry.stats.totalBytes, 0, 'Should have no allocated bytes');
}

/**
 * Tests stats getter returns expected shape.
 *
 * @param {typeof import('../../classes/buffer-registry.js').BufferRegistry} BufferRegistry
 */
async function invokeStatsTest(BufferRegistry) {
    const registry = new BufferRegistry();

    const stats = registry.stats;

    assert.strictEqual(typeof stats.sharedBufferCount, 'number', 'sharedBufferCount should be number');
    assert.strictEqual(typeof stats.totalBytes, 'number', 'totalBytes should be number');
    assert.strictEqual(typeof stats.supportsSharedBuffers, 'boolean', 'supportsSharedBuffers should be boolean');

    // After creating some buffers
    registry.createSharedBuffer(new Uint8Array(100));

    if (BufferRegistry.supportsSharedBuffers) {
        assert.strictEqual(registry.stats.sharedBufferCount, 1, 'Should track shared buffer count');
        assert.strictEqual(registry.stats.totalBytes, 100, 'Should track total bytes');
    }

    registry.dispose();
}

/**
 * Tests hasMapping returns correct values.
 *
 * @param {typeof import('../../classes/buffer-registry.js').BufferRegistry} BufferRegistry
 */
async function invokeHasMappingTest(BufferRegistry) {
    const registry = new BufferRegistry();

    const stream1 = createMockStream(100);
    const stream2 = createMockStream(100);

    // Before registration
    assert.strictEqual(registry.hasMapping(stream1), false, 'Should not have mapping before registration');

    // After registration (only if SharedArrayBuffer supported)
    registry.getSharedView(stream1);
    const expectedHasMapping = BufferRegistry.supportsSharedBuffers;
    assert.strictEqual(registry.hasMapping(stream1), expectedHasMapping, 'Should have mapping after registration');
    assert.strictEqual(registry.hasMapping(stream2), false, 'Other streams should not have mapping');

    registry.dispose();
}

// ============================================================================
// Test Suite
// ============================================================================

describe('BufferRegistry', () => {
    /** @type {typeof import('../../classes/buffer-registry.js').BufferRegistry} */
    let BufferRegistry;

    before(async () => {
        const module = await import('../../classes/buffer-registry.js');
        BufferRegistry = module.BufferRegistry;
    });

    // ========================================
    // New Implementation Tests
    // ========================================

    test('gets shared view for stream', {
        skip: TruthyEnvironmentParameterMatcher.test(process.env.TESTS_ONLY_LEGACY),
    }, async () => {
        await invokeGetSharedViewTest(BufferRegistry);
    });

    test('caches shared views', {
        skip: TruthyEnvironmentParameterMatcher.test(process.env.TESTS_ONLY_LEGACY),
    }, async () => {
        await invokeCachingTest(BufferRegistry);
    });

    test('creates shared buffer from raw data', {
        skip: TruthyEnvironmentParameterMatcher.test(process.env.TESTS_ONLY_LEGACY),
    }, async () => {
        await invokeCreateSharedBufferTest(BufferRegistry);
    });

    test('bulk registers streams', {
        skip: TruthyEnvironmentParameterMatcher.test(process.env.TESTS_ONLY_LEGACY),
    }, async () => {
        await invokeRegisterStreamsTest(BufferRegistry);
    });

    test('applies converted data back to stream', {
        skip: TruthyEnvironmentParameterMatcher.test(process.env.TESTS_ONLY_LEGACY),
    }, async () => {
        await invokeApplyToStreamTest(BufferRegistry);
    });

    test('SharedArrayBuffer feature detection', {
        skip: TruthyEnvironmentParameterMatcher.test(process.env.TESTS_ONLY_LEGACY),
    }, async () => {
        await invokeFeatureDetectionTest(BufferRegistry);
    });

    test('dispose clears tracking state', {
        skip: TruthyEnvironmentParameterMatcher.test(process.env.TESTS_ONLY_LEGACY),
    }, async () => {
        await invokeDisposeTest(BufferRegistry);
    });

    test('stats getter returns expected shape', {
        skip: TruthyEnvironmentParameterMatcher.test(process.env.TESTS_ONLY_LEGACY),
    }, async () => {
        await invokeStatsTest(BufferRegistry);
    });

    test('hasMapping returns correct values', {
        skip: TruthyEnvironmentParameterMatcher.test(process.env.TESTS_ONLY_LEGACY),
    }, async () => {
        await invokeHasMappingTest(BufferRegistry);
    });

    // ========================================
    // Legacy Implementation Tests
    // ========================================

    test('(legacy) no legacy equivalent exists', {
        skip: !!'placeholder - no legacy equivalent to compare',
    }, async () => {
        // BufferRegistry is new infrastructure - no legacy comparison available.
        assert.ok(true, 'No legacy equivalent for BufferRegistry');
    });
});
