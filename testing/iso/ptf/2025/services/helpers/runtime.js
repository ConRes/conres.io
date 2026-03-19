// @ts-check

/**
 * Runtime execution context detection and logging prefix.
 *
 * Provides a consistent prefix for console output so that logs from the
 * main thread, bootstrap worker, and worker pool threads are visually
 * distinguishable at a glance.
 *
 * @example
 * import { CONTEXT_PREFIX } from '../../services/helpers/runtime.js';
 * console.log(`${CONTEXT_PREFIX} [MyClass] doing work…`);
 * // Main thread:      Ⓜ️ [MyClass] doing work…
 * // Bootstrap worker:  🅱️ [MyClass] doing work…
 * // Worker pool #3:    3️⃣ [MyClass] doing work…
 *
 * @example
 * // In a worker entrypoint, refine the context before any logging:
 * import { setCurrentContext } from '../../services/helpers/runtime.js';
 * setCurrentContext('Bootstrap');      // → 🅱️
 * setCurrentContext('Worker 3');       // → 3️⃣
 * setCurrentContext('Worker 14');      // → #️⃣ (falls back to "Worker" prefix)
 * setCurrentContext('CLI');            // → *️⃣ [CLI] (unknown context fallback)
 *
 * @module services/helpers/runtime
 * @author Saleh Abdel Motaal <dev@smotaal.io>
 * @ai Claude Opus 4.6 (code generation)
 */

/** @type {Readonly<Record<string, string>>} */
const CONTEXT_PREFIXES = Object.freeze({
    'Main': 'Ⓜ️',
    'Bootstrap': '🅱️',
    'Worker 1': '1️⃣',
    'Worker 2': '2️⃣',
    'Worker 3': '3️⃣',
    'Worker 4': '4️⃣',
    'Worker 5': '5️⃣',
    'Worker 6': '6️⃣',
    'Worker 7': '7️⃣',
    'Worker 8': '8️⃣',
    'Worker 9': '9️⃣',
    'Worker 10': '🔟',
    'Worker': '#️⃣',
});

/**
 * Resolves the emoji prefix for a given context name.
 *
 * Resolution order:
 * 1. Exact match in CONTEXT_PREFIXES (e.g., `'Worker 3'` → `'3️⃣'`)
 * 2. First-word match (e.g., `'Worker 14'` → `'Worker'` → `'#️⃣'`)
 * 3. Fallback: `'*️⃣ [contextName]'`
 *
 * @param {string} contextName
 * @returns {string}
 */
function resolveContextPrefix(contextName) {
    return CONTEXT_PREFIXES[contextName]
        ?? CONTEXT_PREFIXES[/^\w+/.exec(contextName)?.[0]]
        ?? `*️⃣ [${contextName}]`;
}

/**
 * The current execution context label.
 *
 * Auto-detected at module evaluation:
 * - `'Main'` when running on the main thread
 * - `'Worker'` when running inside a `WorkerGlobalScope`
 *
 * Refined by worker entrypoints via {@link setCurrentContext} to
 * `'Bootstrap'`, `'Worker 1'`, etc.
 *
 * Exported as a live binding — reads after {@link setCurrentContext}
 * reflect the updated value.
 *
 * @type {string}
 */
// eslint-disable-next-line import/no-mutable-exports
let CURRENT_CONTEXT = typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope
    ? 'Worker'
    : 'Main';

/**
 * Emoji prefix for the current execution context.
 *
 * Exported as a live binding — reads after {@link setCurrentContext}
 * reflect the updated prefix.
 *
 * @type {string}
 */
// eslint-disable-next-line import/no-mutable-exports
let CONTEXT_PREFIX = resolveContextPrefix(CURRENT_CONTEXT);

/**
 * Refines the current execution context label and updates the prefix.
 *
 * Must be called early in the worker entrypoint, before any module
 * that reads {@link CONTEXT_PREFIX} emits its first log.
 *
 * @param {string} context - The refined context name (e.g., `'Bootstrap'`, `'Worker 3'`)
 */
function setCurrentContext(context) {
    CURRENT_CONTEXT = context;
    CONTEXT_PREFIX = resolveContextPrefix(CURRENT_CONTEXT);
}

export { CURRENT_CONTEXT, CONTEXT_PREFIX, CONTEXT_PREFIXES, setCurrentContext };
