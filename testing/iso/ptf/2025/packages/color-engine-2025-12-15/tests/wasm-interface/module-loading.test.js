/**
 * @fileoverview Phase 1 Tests - Module Loading
 * Tests basic WASM module initialization and memory management
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { createEngine, ColorEngine } from '../../src/index.js';

describe('WASM Module Loading', () => {
  let engine;

  beforeAll(async () => {
    engine = await createEngine();
  });

  it('should create ColorEngine instance', () => {
    expect(engine).toBeInstanceOf(ColorEngine);
  });

  it('should initialize WASM module', async () => {
    const newEngine = new ColorEngine();
    await newEngine.init();
    expect(newEngine.HEAPU8).toBeInstanceOf(Uint8Array);
  });

  it('should allocate and free memory', () => {
    const size = 1024;
    const ptr = engine.malloc(size);

    expect(ptr).toBeGreaterThan(0);
    expect(typeof ptr).toBe('number');

    // Should not throw
    engine.free(ptr);
  });

  it('should provide heap access', () => {
    expect(engine.HEAPU8).toBeInstanceOf(Uint8Array);
    expect(engine.HEAPF32).toBeInstanceOf(Float32Array);
  });

  it('should support getValue/setValue operations', () => {
    const ptr = engine.malloc(4);

    engine.setValue(ptr, 42, 'i32');
    const value = engine.getValue(ptr, 'i32');

    expect(value).toBe(42);

    engine.free(ptr);
  });

  it('should throw error if not initialized', async () => {
    const uninitEngine = new ColorEngine();

    expect(() => uninitEngine.malloc(100)).toThrow('not initialized');
  });
});
