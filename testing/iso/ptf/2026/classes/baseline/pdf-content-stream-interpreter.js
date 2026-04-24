// @ts-check
/**
 * PDF Content Stream Graphics State Interpreter (Layer 2)
 *
 * Consumes raw events from the tokenizer (pdf-content-stream-parser.js)
 * and yields enriched events with graphics state context resolved.
 *
 * This layer:
 *   - Maintains {strokeColorSpace, fillColorSpace} state
 *   - Updates color space from three sources:
 *     1. setColorSpace events (CS/cs) — explicit named color space
 *     2. setGray/setRGB/setCMYK events — implicit Device* change
 *     3. saveState/restoreState events (q/Q) — push/pop stack
 *   - Enriches setColor events with colorSpaceName resolved from context
 *   - Exposes finalState for cross-stream continuity
 *
 * This layer does NOT:
 *   - Parse text or identify tokens (that's Layer 1: tokenizer)
 *   - Handle string span forwarding (that's Layer 1)
 *   - Know about PDF document structure, profiles, or conversion
 *
 * @module pdf-content-stream-interpreter
 * @author Saleh Abdel Motaal <dev@smotaal.io>
 * @ai Claude Opus 4.6 (code generation)
 */

// ── Types ───────────────────────────────────────────────────────────

/**
 * Color space state for tracking context across content streams.
 *
 * @typedef {{
 *   strokeColorSpace?: string,
 *   fillColorSpace?: string,
 * }} ColorSpaceState
 */

/**
 * Enriched setColor event with resolved colorSpaceName.
 *
 * @typedef {Omit<import('./pdf-content-stream-parser.js').SetColorEvent, never> & {
 *   colorSpaceName: string | undefined,
 * }} EnrichedSetColorEvent
 */

/**
 * Enriched content stream event — either passes through unchanged
 * or has colorSpaceName added for setColor events.
 *
 * @typedef {Exclude<import('./pdf-content-stream-parser.js').ContentStreamEvent, import('./pdf-content-stream-parser.js').SetColorEvent> | EnrichedSetColorEvent} EnrichedContentStreamEvent
 */

/**
 * Result of interpreting a content stream's events.
 *
 * @typedef {{
 *   events: EnrichedContentStreamEvent[],
 *   finalState: ColorSpaceState,
 * }} InterpretResult
 */

// ── Interpreter Generator ───────────────────────────────────────────

/**
 * Creates a graphics state interpreter that tracks color space context.
 *
 * Returns an object with a `*interpret()` generator and a `state` getter
 * for accessing the final state after the generator completes.
 *
 * @param {ColorSpaceState} [initialState] - Initial state from previous stream
 * @returns {{ interpret: (rawEvents: Iterable<import('./pdf-content-stream-parser.js').ContentStreamEvent>) => Generator<EnrichedContentStreamEvent, void, undefined>, readonly state: ColorSpaceState }}
 */
export function createInterpreter(initialState = {}) {
    /** @type {string | undefined} */
    let strokeColorSpace = initialState.strokeColorSpace;
    /** @type {string | undefined} */
    let fillColorSpace = initialState.fillColorSpace;

    /** @type {ColorSpaceState[]} */
    const stateStack = [];

    return {
        /**
         * Generator that yields enriched events where setColor events gain
         * a `colorSpaceName` resolved from the current stroke/fill context.
         * All other events pass through unchanged.
         *
         * @param {Iterable<import('./pdf-content-stream-parser.js').ContentStreamEvent>} rawEvents
         * @yields {EnrichedContentStreamEvent}
         */
        *interpret(rawEvents) {
            for (const event of rawEvents) {
                if (event.type === 'content') {
                    yield event;
                    continue;
                }

                // event.type === 'operator'
                switch (event.operation) {
                    case 'setColorSpace': {
                        if (event.isStroke) {
                            strokeColorSpace = /** @type {any} */ (event).name;
                        } else {
                            fillColorSpace = /** @type {any} */ (event).name;
                        }
                        yield event;
                        break;
                    }

                    case 'setGray': {
                        if (event.isStroke) {
                            strokeColorSpace = 'DeviceGray';
                        } else {
                            fillColorSpace = 'DeviceGray';
                        }
                        yield event;
                        break;
                    }

                    case 'setRGB': {
                        if (event.isStroke) {
                            strokeColorSpace = 'DeviceRGB';
                        } else {
                            fillColorSpace = 'DeviceRGB';
                        }
                        yield event;
                        break;
                    }

                    case 'setCMYK': {
                        if (event.isStroke) {
                            strokeColorSpace = 'DeviceCMYK';
                        } else {
                            fillColorSpace = 'DeviceCMYK';
                        }
                        yield event;
                        break;
                    }

                    case 'setColor': {
                        const colorSpaceName = event.isStroke ? strokeColorSpace : fillColorSpace;
                        yield /** @type {EnrichedSetColorEvent} */ ({
                            ...event,
                            colorSpaceName,
                        });
                        break;
                    }

                    case 'saveState': {
                        stateStack.push({ strokeColorSpace, fillColorSpace });
                        yield event;
                        break;
                    }

                    case 'restoreState': {
                        const saved = stateStack.pop();
                        if (saved) {
                            strokeColorSpace = saved.strokeColorSpace;
                            fillColorSpace = saved.fillColorSpace;
                        }
                        yield event;
                        break;
                    }

                    default:
                        yield event;
                        break;
                }
            }
        },

        /** Current color space state — read after generator completes for finalState. */
        get state() {
            return { strokeColorSpace, fillColorSpace };
        },
    };
}

/**
 * Convenience: interpret raw events with a one-shot interpreter.
 *
 * @param {Iterable<import('./pdf-content-stream-parser.js').ContentStreamEvent>} rawEvents
 * @param {ColorSpaceState} [initialState]
 * @yields {EnrichedContentStreamEvent}
 * @returns {Generator<EnrichedContentStreamEvent, void, undefined>}
 */
export function* interpretGraphicsState(rawEvents, initialState) {
    const interpreter = createInterpreter(initialState);
    yield* interpreter.interpret(rawEvents);
}

// ── Convenience: Collect Operations (Shape B) ───────────────────────

/**
 * Parsed operation from enriched event stream.
 *
 * @typedef {{
 *   type: 'operator',
 *   operation: string,
 *   operator: string,
 *   isStroke: boolean,
 *   values?: number[],
 *   value?: number,
 *   name?: string,
 *   colorSpaceName?: string,
 *   offset: number,
 *   length: number,
 * }} ParsedOperation
 */

/**
 * Collects enriched events into an operations array + finalState.
 *
 * This is the Shape B equivalent — matches the return shape of the
 * old PDFContentStreamColorConverter.parseContentStream().
 *
 * @param {Iterable<import('./pdf-content-stream-parser.js').ContentStreamEvent>} rawEvents
 * @param {ColorSpaceState} [initialState]
 * @returns {{ operations: ParsedOperation[], finalState: ColorSpaceState }}
 */
export function collectOperations(rawEvents, initialState) {
    /** @type {ParsedOperation[]} */
    const operations = [];

    const interpreter = createInterpreter(initialState);

    for (const event of interpreter.interpret(rawEvents)) {
        if (event.type === 'operator') {
            operations.push(/** @type {ParsedOperation} */ (event));
        }
    }

    return { operations, finalState: interpreter.state };
}

// ── Convenience: Collect Analysis (Shape A) ─────────────────────────

/**
 * Color space usage statistics.
 *
 * @typedef {{
 *   name: string,
 *   grayCount: number,
 *   rgbCount: number,
 *   cmykCount: number,
 *   setColorCount: number,
 * }} ColorSpaceUsage
 */

/**
 * Collects enriched events into color space usage analysis.
 *
 * This is the Shape A equivalent — matches the return shape of the
 * old ColorSpaceUtils.parseContentStreamColors().
 *
 * @param {Iterable<import('./pdf-content-stream-parser.js').ContentStreamEvent>} rawEvents
 * @param {ColorSpaceState} [initialState]
 * @returns {{ colorSpaces: ColorSpaceUsage[], operationCounts: { gray: number, rgb: number, cmyk: number, setColor: number, setColorSpace: number, saveState: number, restoreState: number } }}
 */
export function collectAnalysis(rawEvents, initialState) {
    /** @type {Map<string, ColorSpaceUsage>} */
    const colorSpaceMap = new Map();
    const counts = {
        gray: 0,
        rgb: 0,
        cmyk: 0,
        setColor: 0,
        setColorSpace: 0,
        saveState: 0,
        restoreState: 0,
    };

    const interpreter = createInterpreter(initialState);

    for (const event of interpreter.interpret(rawEvents)) {
        if (event.type !== 'operator') continue;

        switch (event.operation) {
            case 'setGray':
                counts.gray++;
                break;
            case 'setRGB':
                counts.rgb++;
                break;
            case 'setCMYK':
                counts.cmyk++;
                break;
            case 'setColorSpace': {
                counts.setColorSpace++;
                const name = /** @type {any} */ (event).name;
                if (name && !colorSpaceMap.has(name)) {
                    colorSpaceMap.set(name, {
                        name,
                        grayCount: 0,
                        rgbCount: 0,
                        cmykCount: 0,
                        setColorCount: 0,
                    });
                }
                break;
            }
            case 'setColor': {
                counts.setColor++;
                const csName = /** @type {any} */ (event).colorSpaceName;
                if (csName) {
                    const usage = colorSpaceMap.get(csName);
                    if (usage) {
                        usage.setColorCount++;
                    }
                }
                break;
            }
            case 'saveState':
                counts.saveState++;
                break;
            case 'restoreState':
                counts.restoreState++;
                break;
        }
    }

    return {
        colorSpaces: [...colorSpaceMap.values()],
        operationCounts: counts,
    };
}
