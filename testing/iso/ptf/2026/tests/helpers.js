// @ts-check
/**
 * Test helpers for ConRes PDF Test Form Generator
 *
 * @module helpers
 */

/**
 * RegExp for testing truthy environment variable values.
 *
 * Matches (case-insensitive): 'true', 'yes', 'enabled', 'on', '1'
 *
 * @example
 * ```javascript
 * import { TruthyEnvironmentParameterMatcher } from './helpers.js';
 *
 * test('my test', {
 *     skip: TruthyEnvironmentParameterMatcher.test(process.env.SKIP_THIS_TEST)
 * }, async () => {
 *     // Test implementation
 * });
 * ```
 *
 * @type {RegExp}
 */
export const TruthyEnvironmentParameterMatcher = /^(true|yes|enabled|on|1)$/i;
