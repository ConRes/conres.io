// @ts-check
/**
 * Stream utilities for environments with incomplete async iterable support.
 *
 * @module helpers/streams
 * @author Saleh Abdel Motaal <dev@smotaal.io>
 * @ai Claude Opus 4.6 (code generation)
 */

/**
 * Converts a `ReadableStream` into an async iterable.
 *
 * Safari does not yet implement `Symbol.asyncIterator` on `ReadableStream`
 * (WebKit Bug 194379, standards position: support). This helper provides the
 * same `yield*`-composable interface using `getReader()` so that consuming
 * code works identically across all environments.
 *
 * @template T
 * @param {ReadableStream<T>} stream
 * @returns {AsyncGenerator<T, void, undefined>}
 */
export async function* readableStreamAsyncIterable(stream) {
    const reader = stream.getReader();
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) return;
            yield value;
        }
    } finally {
        reader.releaseLock();
    }
}
