#ifndef __CONRES_LOGGING_H__
#define __CONRES_LOGGING_H__

#include "./debugging.h"

#ifdef __cplusplus
extern "C" {
#endif

#define StartTimedExecution(marker) \
    time_start(marker)

#define EndTimedExecution(marker) \
    debug_printf_newline(), time_end(marker)

// debug_printf("\nSTARTING TIMED GROUP: %s\n", groupMarker), \

#define StartTimedGroup(groupMarker) \
    time_start(groupMarker), debug_printf_newline(), group_start(groupMarker)

// debug_printf("\nENDING TIMED GROUP: %s\n", groupMarker), \

#define EndTimedGroup(groupMarker) \
    debug_printf_newline(), time_end(groupMarker), group_end(), debug_printf_newline()

#define StartTimedSubgroup(groupMarker, subgroupMarker) \
    debug_printf_newline(), group_start(subgroupMarker), debug_printf_newline()

#define EndTimedSubgroup(groupMarker) \
    debug_printf_newline(), time_log(groupMarker), group_end()

#define StartNextTimedSubgroup(groupMarker, subgroupMarker) \
    EndTimedSubgroup(groupMarker), StartTimedSubgroup(groupMarker, subgroupMarker)

#ifdef __cplusplus
}
#endif

#endif  // __CONRES_LOGGING_H__