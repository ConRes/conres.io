// @ts-check
/**
 * ProfilePool Class Tests
 *
 * Tests for ICC profile SharedArrayBuffer management.
 *
 * @module ProfilePool.test
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import { TruthyEnvironmentParameterMatcher } from '../helpers.js';

// ============================================================================
// Test Fixtures
// ============================================================================

/**
 * Creates a mock ICC profile buffer of specified size with unique content.
 * @param {number} size - Buffer size in bytes
 * @param {number} [seed=0] - Seed value to ensure unique content
 * @returns {ArrayBuffer}
 */
function createMockProfile(size, seed = 0) {
    const buffer = new ArrayBuffer(size);
    const view = new Uint8Array(buffer);
    // Fill with identifiable pattern that varies by seed
    for (let i = 0; i < size; i++) {
        view[i] = (i + seed * 37) % 256;
    }
    return buffer;
}

// ============================================================================
// Shared Test Functions (invokeXXXTest pattern)
// ============================================================================

/**
 * Tests profile loading and caching.
 *
 * @param {typeof import('../../classes/baseline/profile-pool.js').ProfilePool} ProfilePool
 */
async function invokeProfileLoadingTest(ProfilePool) {
    const pool = new ProfilePool({ maxProfiles: 10 });
    const mockProfile = createMockProfile(1024);

    // Load profile
    const { buffer, isShared } = await pool.getProfile(mockProfile);

    // Verify buffer content matches
    const originalView = new Uint8Array(mockProfile);
    const loadedView = new Uint8Array(buffer);
    assert.strictEqual(loadedView.length, originalView.length, 'Buffer lengths should match');
    assert.strictEqual(loadedView[0], originalView[0], 'First byte should match');
    assert.strictEqual(loadedView[1023], originalView[1023], 'Last byte should match');

    // Verify caching
    assert.strictEqual(pool.hasProfile(mockProfile), true, 'Profile should be cached');

    pool.dispose();
}

/**
 * Tests reference counting via multiple getProfile calls.
 *
 * @param {typeof import('../../classes/baseline/profile-pool.js').ProfilePool} ProfilePool
 */
async function invokeReferenceCountingTest(ProfilePool) {
    const pool = new ProfilePool({ maxProfiles: 10 });
    const mockProfile = createMockProfile(1024);

    // Load same profile multiple times
    await pool.getProfile(mockProfile);
    await pool.getProfile(mockProfile);
    await pool.getProfile(mockProfile);

    // Stats should show 1 profile (deduplicated)
    assert.strictEqual(pool.stats.profileCount, 1, 'Should have 1 cached profile');

    // Release references
    pool.releaseProfile(mockProfile);
    pool.releaseProfile(mockProfile);
    pool.releaseProfile(mockProfile);

    pool.dispose();
}

/**
 * Tests LRU eviction when limits are exceeded.
 *
 * @param {typeof import('../../classes/baseline/profile-pool.js').ProfilePool} ProfilePool
 */
async function invokeLRUEvictionTest(ProfilePool) {
    const pool = new ProfilePool({
        maxProfiles: 3,
        maxMemoryBytes: 10 * 1024, // 10KB
    });

    // Load 3 profiles with different content (different seeds ensure unique hashes)
    const profile1 = createMockProfile(2048, 1);
    const profile2 = createMockProfile(2048, 2);
    const profile3 = createMockProfile(2048, 3);

    await pool.getProfile(profile1);
    await pool.getProfile(profile2);
    await pool.getProfile(profile3);

    // Release all references (makes them eligible for eviction)
    pool.releaseProfile(profile1);
    pool.releaseProfile(profile2);
    pool.releaseProfile(profile3);

    assert.strictEqual(pool.stats.profileCount, 3, 'Should have 3 profiles before eviction');

    // Load a 4th profile - should trigger eviction
    const profile4 = createMockProfile(2048, 4);
    await pool.getProfile(profile4);

    // Should have evicted least recently used
    assert.ok(pool.stats.profileCount <= 3, 'Should have evicted at least one profile');

    pool.dispose();
}

/**
 * Tests deduplication of concurrent loads.
 *
 * @param {typeof import('../../classes/baseline/profile-pool.js').ProfilePool} ProfilePool
 */
async function invokeConcurrentLoadDeduplicationTest(ProfilePool) {
    const pool = new ProfilePool({ maxProfiles: 10 });
    const mockProfile = createMockProfile(1024);

    // Start multiple concurrent loads of the same profile
    const promises = [
        pool.getProfile(mockProfile),
        pool.getProfile(mockProfile),
        pool.getProfile(mockProfile),
    ];

    const results = await Promise.all(promises);

    // All should return same buffer
    assert.strictEqual(results[0].buffer, results[1].buffer, 'Should share buffer');
    assert.strictEqual(results[1].buffer, results[2].buffer, 'Should share buffer');

    // Only 1 profile should be cached
    assert.strictEqual(pool.stats.profileCount, 1, 'Should have 1 cached profile');

    pool.dispose();
}

/**
 * Tests FNV-1a hashing produces consistent keys.
 *
 * @param {typeof import('../../classes/baseline/profile-pool.js').ProfilePool} ProfilePool
 */
async function invokeHashingConsistencyTest(ProfilePool) {
    const pool = new ProfilePool({ maxProfiles: 10 });

    // Create two identical profiles
    const profile1 = createMockProfile(1024);
    const profile2 = createMockProfile(1024);

    // Load both
    await pool.getProfile(profile1);
    await pool.getProfile(profile2);

    // Should be recognized as same (FNV-1a hash matches)
    assert.strictEqual(pool.stats.profileCount, 1, 'Identical profiles should share cache entry');

    // Create different profile
    const profile3 = new ArrayBuffer(1024);
    new Uint8Array(profile3).fill(255); // Different content

    await pool.getProfile(profile3);
    assert.strictEqual(pool.stats.profileCount, 2, 'Different profiles should have separate entries');

    pool.dispose();
}

/**
 * Tests SharedArrayBuffer feature detection.
 *
 * @param {typeof import('../../classes/baseline/profile-pool.js').ProfilePool} ProfilePool
 */
async function invokeSharedBufferFeatureDetectionTest(ProfilePool) {
    // Static property should reflect runtime capability
    const supportsShared = ProfilePool.supportsSharedBuffers;
    assert.strictEqual(typeof supportsShared, 'boolean', 'Should return boolean');

    const pool = new ProfilePool({ maxProfiles: 10 });
    assert.strictEqual(pool.stats.supportsSharedBuffers, supportsShared, 'Stats should match static property');

    pool.dispose();
}

/**
 * Tests dispose clears all state.
 *
 * @param {typeof import('../../classes/baseline/profile-pool.js').ProfilePool} ProfilePool
 */
async function invokeDisposeTest(ProfilePool) {
    const pool = new ProfilePool({ maxProfiles: 10 });

    // Load some profiles
    await pool.getProfile(createMockProfile(1024));
    await pool.getProfile(createMockProfile(2048));

    assert.strictEqual(pool.stats.profileCount, 2, 'Should have profiles before dispose');

    pool.dispose();

    assert.strictEqual(pool.stats.profileCount, 0, 'Should have no profiles after dispose');
    assert.strictEqual(pool.stats.memoryBytes, 0, 'Should have no memory after dispose');
}

/**
 * Tests stats getter returns expected shape.
 *
 * @param {typeof import('../../classes/baseline/profile-pool.js').ProfilePool} ProfilePool
 */
async function invokeStatsTest(ProfilePool) {
    const pool = new ProfilePool({
        maxProfiles: 32,
        maxMemoryBytes: 64 * 1024 * 1024,
    });

    const stats = pool.stats;

    assert.strictEqual(typeof stats.profileCount, 'number', 'profileCount should be number');
    assert.strictEqual(typeof stats.memoryBytes, 'number', 'memoryBytes should be number');
    assert.strictEqual(typeof stats.maxMemoryBytes, 'number', 'maxMemoryBytes should be number');
    assert.strictEqual(typeof stats.pendingLoads, 'number', 'pendingLoads should be number');
    assert.strictEqual(typeof stats.supportsSharedBuffers, 'boolean', 'supportsSharedBuffers should be boolean');

    assert.strictEqual(stats.maxMemoryBytes, 64 * 1024 * 1024, 'maxMemoryBytes should match config');

    pool.dispose();
}

// ============================================================================
// Test Suite
// ============================================================================

describe('ProfilePool', () => {
    /** @type {typeof import('../../classes/baseline/profile-pool.js').ProfilePool} */
    let ProfilePool;

    before(async () => {
        const module = await import('../../classes/baseline/profile-pool.js');
        ProfilePool = module.ProfilePool;
    });

    // ========================================
    // New Implementation Tests
    // ========================================

    test('loads and caches profiles', {
        skip: TruthyEnvironmentParameterMatcher.test(process.env.TESTS_ONLY_LEGACY),
    }, async () => {
        await invokeProfileLoadingTest(ProfilePool);
    });

    test('manages reference counting', {
        skip: TruthyEnvironmentParameterMatcher.test(process.env.TESTS_ONLY_LEGACY),
    }, async () => {
        await invokeReferenceCountingTest(ProfilePool);
    });

    test('LRU eviction when limits exceeded', {
        skip: TruthyEnvironmentParameterMatcher.test(process.env.TESTS_ONLY_LEGACY),
    }, async () => {
        await invokeLRUEvictionTest(ProfilePool);
    });

    test('deduplicates concurrent loads', {
        skip: TruthyEnvironmentParameterMatcher.test(process.env.TESTS_ONLY_LEGACY),
    }, async () => {
        await invokeConcurrentLoadDeduplicationTest(ProfilePool);
    });

    test('FNV-1a hashing produces consistent keys', {
        skip: TruthyEnvironmentParameterMatcher.test(process.env.TESTS_ONLY_LEGACY),
    }, async () => {
        await invokeHashingConsistencyTest(ProfilePool);
    });

    test('SharedArrayBuffer feature detection', {
        skip: TruthyEnvironmentParameterMatcher.test(process.env.TESTS_ONLY_LEGACY),
    }, async () => {
        await invokeSharedBufferFeatureDetectionTest(ProfilePool);
    });

    test('dispose clears all state', {
        skip: TruthyEnvironmentParameterMatcher.test(process.env.TESTS_ONLY_LEGACY),
    }, async () => {
        await invokeDisposeTest(ProfilePool);
    });

    test('stats getter returns expected shape', {
        skip: TruthyEnvironmentParameterMatcher.test(process.env.TESTS_ONLY_LEGACY),
    }, async () => {
        await invokeStatsTest(ProfilePool);
    });

    // ========================================
    // Legacy Implementation Tests
    // ========================================

    test('(legacy) no legacy equivalent exists', {
        skip: !!'placeholder - no legacy equivalent to compare',
    }, async () => {
        // ProfilePool is new infrastructure - no legacy comparison available.
        assert.ok(true, 'No legacy equivalent for ProfilePool');
    });
});
