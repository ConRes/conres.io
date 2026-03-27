// @ts-check
import { readFile } from 'fs/promises';

/// This module extracts LittleCMS macros and constants from the lcms2.h header file
/// and makes them available for use in the color engine implementation.
/// It reads the header file, parses the relevant definitions, and evaluates them
/// to produce JavaScript functions and constants that mirror the original C macros
/// and constants defined in LittleCMS.
///
/// The extracted macros and constants can be used to ensure consistency with
/// LittleCMS's pixel format definitions and other related functionality.

export const { macros, constants, code } = await (async () => {
    const lcms2Header = `${await readFile(new URL('../../../../upstream/Little-CMS/include/lcms2.h', import.meta.url))}`;

    /** @type { Record<`${string}_SH`|'PREMUL_SH'|'FLOAT_SH'|'OPTIMIZED_SH'|'COLORSPACE_SH'|'SWAPFIRST_SH'|'FLAVOR_SH'|'PLANAR_SH'|'ENDIAN16_SH'|'DOSWAP_SH'|'EXTRA_SH'|'CHANNELS_SH'|'BYTES_SH', (value: number) => number> } */
    const macros = Object.setPrototypeOf({}, null);
    /** @type { Record<`PT_${string}`|`TYPE_${string}`, number> } */
    const constants = Object.setPrototypeOf({}, null);

    const evaluator = (0, eval)(String.raw /* js */`
        (macros, constants) => {
            with (macros) {
                with (constants) {
                    return macro => eval(macro);
                }
            }
        }
    `)(
        new Proxy(macros, { set() { return false; }, deleteProperty() { return false; }, setPrototypeOf() { return false; } }),
        new Proxy(constants, { set() { return false; }, deleteProperty() { return false; }, setPrototypeOf() { return false; } }),
    );

    const code = [];

    const FunctionMatcher = /^#define\s+(?<identifier>[A-Z]+\d*_SH|cmsFLAGS_\w+?)(?<arguments>\([a-z]+\))\s+(?<macro>\(.+?\))[ \t]*;?[ \t]*(?:\/\/[ \t]*(?<comment>.+?)[ \t]*)?$/mg;

    for (const { groups } of FunctionMatcher[Symbol.matchAll](lcms2Header)) {
        // console.log(groups.identifier, groups.arguments, groups.macro);
        macros[groups.identifier] = evaluator(`${groups.arguments} => ${groups.macro};`);
        code.push(`const ${groups.identifier} = ${groups.arguments} => ${groups.macro};${groups.comment ? ` // ${groups.comment}` : ''}`);
    }

    const ConstantMatcher = /^#define\s+(?<identifier>PT_[A-Z][A-Za-z0-9]+|TYPE_[A-Z][A-Za-z0-9_]+|cmsFLAGS_\w+?|INTENT_\w+?)\s+(?<macro>.+?)[ \t]*;?[ \t]*(?:\/\/[ \t]*(?<comment>.+?)[ \t]*)?$/mg;


    for (const { groups } of ConstantMatcher[Symbol.matchAll](lcms2Header)) {
        // console.log(groups.identifier);
        constants[groups.identifier] = evaluator(groups.macro);
        code.push(`const ${groups.identifier} = ${groups.macro};${groups.comment ? ` // ${groups.comment}` : ''}`);
    }

    // console.table({ ...macros, ...constants });
    
    return {
        macros: Object.freeze(macros),
        constants: Object.freeze(constants),
        code: code.join('\n'),
    };
})();

console.group('Extracted LittleCMS Macros and Constants');
console.log('Macros:');
console.table(macros);
console.log('Constants:');
console.table(constants);
console.group('Code:');
console.log(code);
console.groupEnd();
console.groupEnd();

export const {
    TYPE_GRAY_8,
    TYPE_GRAY_16,
    TYPE_GRAY_FLT,
    TYPE_RGB_8,
    TYPE_RGB_16,
    TYPE_RGBA_8,
    TYPE_RGB_FLT,
    TYPE_CMYK_8,
    TYPE_CMYK_16,
    TYPE_CMYK_FLT,
    TYPE_Lab_8,
    TYPE_Lab_16,
    TYPE_Lab_FLT,
} = constants;
