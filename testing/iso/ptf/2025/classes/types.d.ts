export interface ColorConverter<Input = any, Result = any> {
    /**
     * Converts a color value.
     *
     * @param {Input} input - Color to convert
     * @param {import('./color-converter.js').ColorConverterContext} [context={}] - Conversion context
     * @returns {Promise<Result>} Converted color
     */
    convertColor(input: Input, context?: import('./color-converter.js').ColorConverterContext): Promise<Result>;
}

export interface BatchedColorConverter<Input = any, Result = any> extends ColorConverter<Input, Result> {
    /**
     * Converts multiple colors with lookup table optimization.
     *
     * Separates colors into cached and uncached, processes uncached
     * in batch, then merges results.
     *
     * @param inputs - Colors to convert
     * @param context - Conversion context
     */
    convertBatch(inputs: Input[], context?: import('./color-converter.js').ColorConverterContext): Promise<Result[]>;

    /**
     * Converts uncached colors in batch (abstract - subclasses must implement).
     * 
     * @param inputs - Colors to convert
     * @param context - Conversion context
     */
    convertBatchedUncached(inputs: Input[], context?: import('./color-converter.js').ColorConverterContext): Promise<Result[]>;
}