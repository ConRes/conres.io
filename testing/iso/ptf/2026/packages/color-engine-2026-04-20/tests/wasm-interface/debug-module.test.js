/**
 * @fileoverview Debug test to inspect WASM module structure
 */

import { describe, it } from 'vitest';
import { createEngine } from '../../src/index.js';

describe.skip('Module Debug', () => {
  it('should log module properties', async () => {
    const engine = await createEngine();

    // Access the private module for debugging
    console.log('Module keys:', Object.keys(engine));
    console.log('Has _malloc:', typeof engine.malloc);
    console.log('Has _free:', typeof engine.free);

    // Try to get heap reference
    const pointer = engine.malloc(100);
    console.log('Allocated ptr:', pointer);
    engine.free(pointer);
  });
});
