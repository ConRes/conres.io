// @ts-check
/**
 * Safe dynamic import with fallback for environments that do not support
 * import assertions (e.g., Firefox 115).
 *
 * Tries native `import(specifier, options)` first. If the engine throws
 * (typically a `TypeError` for unsupported `with` clause), falls back to
 * `fetch` + manual parsing for known types (`json`, `css`).
 *
 * @module helpers/imports
 * @author Saleh Abdel Motaal <dev@smotaal.io>
 * @ai Claude Opus 4.6 (code generation)
 */

/**
 * Dynamically imports a module, falling back to fetch-based loading when
 * the runtime does not support import assertions (`with { type: ... }`).
 *
 * Supported types:
 * - `'json'` — fetches and parses as JSON, returns `{ default: object }`
 * - `'css'` — fetches text and creates a `CSSStyleSheet`, returns `{ default: CSSStyleSheet }`
 * - `'javascript'` or omitted — delegates to native `import(specifier)`
 *
 * @type {(specifier: string | URL, options?: ImportCallOptions) => Promise<any>}
 */
export const safeDynamicImport = (() => {
    try {
        return eval('(specifier, options) => import(specifier, options)');
    } catch {
        return eval(String.raw /* js */ `
            async (specifier, options) => {
                const type = options?.with?.type ?? 'javascript';
                if (type === 'json') {
                    const fetchedJSONText = await (await fetch(specifier)).text();
                    const jsonData = JSON.parse(fetchedJSONText);
                    return { default: jsonData };
                } else if (type === 'css') {
                    const fetchedStyleSheetText = await (await fetch(specifier)).text();
                    const cssStyleSheet = new CSSStyleSheet();
                    cssStyleSheet.replaceSync(fetchedStyleSheetText);
                    return { default: cssStyleSheet };
                } else if (!type || type === 'javascript') {
                    return import(specifier);
                }
                throw new Error(${'`Unsupported import type: ${type}`'});
            }
        `);
    }
})();
