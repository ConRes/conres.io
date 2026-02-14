#ifndef __CONRES_DEBUGGING_H__
#define __CONRES_DEBUGGING_H__

#include <stdarg.h>  // va_list, va_start(), va_end(), vfprintf()
#include <stdio.h>   // fprintf(), fdopen(), fclose(), stderr
#include <string.h>  // strlen()

#ifdef __EMSCRIPTEN__
#include <emscripten.h>
#endif

#ifdef __cplusplus
extern "C" {
#endif

#define CONRES_STATIC static inline

static int __debug_printf_indent = 0;

CONRES_STATIC int __debug_printf(const char* format, ...) {
    static int __debug_printf_newline = 1;

    int formatLength = strlen(format);
    int nextNewline = formatLength > 0 & format[formatLength - 1] == '\n';

    if (__debug_printf_indent > 0 && nextNewline && formatLength > 1 && format[formatLength - 2] == '}')
        __debug_printf_indent--;

    if (__debug_printf_newline && __debug_printf_indent > 0) {
        int leadingSpaces = 0;
        for (int i = 0; i < formatLength && format[i++] == ' '; leadingSpaces++) {}
        fprintf(stderr, "%*s", __debug_printf_indent * 2 - leadingSpaces, "");
    }

    __debug_printf_newline = nextNewline;

    if (nextNewline && formatLength > 1 && format[formatLength - 2] == '{')
        __debug_printf_indent++;

    va_list argumentList;
    va_start(argumentList, format);
    int result = vfprintf(stderr, format, argumentList);
    va_end(argumentList);
    return result;
}

#if __has_builtin(__builtin_dump_struct)
#define dump_struct(identifier) \
    __builtin_dump_struct(identifier, &__debug_printf);
#else
#define dump_struct(identifier)
#endif

#define debug_printf_newline() \
    __debug_printf("\n")

#define debug_struct(state, message)  \
    __debug_printf("\n");             \
    __debug_printf("%s:\n", message); \
    __debug_printf_indent++;          \
    dump_struct(state);               \
    __debug_printf_indent--

#define debug_printf(...) __debug_printf(__VA_ARGS__)

#define debug_printf_with_indent(indent, ...)        \
    {                                                \
        int previous_indent = __debug_printf_indent; \
        __debug_printf_indent = indent;              \
        debug_printf(__VA_ARGS__);                   \
        __debug_printf_indent = previous_indent;     \
    }

#define debug_struct_with_indent(indent, state, message) \
    {                                                    \
        int previous_indent = __debug_printf_indent;     \
        __debug_printf_indent = indent;                  \
        debug_struct(state, message);                    \
        __debug_printf_indent = previous_indent;         \
    }

CONRES_STATIC void time_start(const char* identifier) {
#ifdef EM_ASM
    EM_ASM({ console.time(UTF8ToString($0)); }, identifier);
#endif
}

CONRES_STATIC void time_log(const char* identifier) {
#ifdef EM_ASM
    EM_ASM({ console.timeLog(UTF8ToString($0)); }, identifier);
#endif
}

CONRES_STATIC void time_end(const char* identifier) {
#ifdef EM_ASM
    EM_ASM({ console.timeEnd(UTF8ToString($0)); }, identifier);
#endif
}

CONRES_STATIC void group_start(const char* identifier) {
#ifdef EM_ASM
    EM_ASM({ console.group(UTF8ToString($0)); }, identifier);
#endif
}

CONRES_STATIC void group_end() {
#ifdef EM_ASM
    EM_ASM({ console.groupEnd(); });
#endif
}

#define time_log_with_indent(indent, identifier)     \
    {                                                \
        int previous_indent = __debug_printf_indent; \
        __debug_printf_indent = indent;              \
        __debug_printf("");                          \
        time_log(identifier);                        \
        __debug_printf_indent = previous_indent;     \
    }
#define time_end_with_indent(indent, identifier)     \
    {                                                \
        int previous_indent = __debug_printf_indent; \
        __debug_printf_indent = indent;              \
        __debug_printf("");                          \
        time_end(identifier);                        \
        __debug_printf_indent = previous_indent;     \
    }

#ifdef __cplusplus
}
#endif

#endif  // __CONRES_DEBUGGING_H__