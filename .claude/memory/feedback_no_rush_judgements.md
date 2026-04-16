---
name: No rush judgements on browser bugs
description: Do not dismiss Safari/browser-specific issues as "their problem" — investigate systematically, confirm scope, find workarounds
type: feedback
---

Do not make rush judgements that an OOM or browser-specific issue is "not our problem" or "transient." Investigate systematically: confirm which browsers, versions, platforms, and architectures are affected. Only after confirming the scope can we determine whether it requires a workaround on our side or a browser fix.

**Why:** The user experienced this as dismissive — AI equivalent of a neurotypical deflecting responsibility. The job is to make it work properly on all major browsers, not to explain why it's someone else's fault.

**How to apply:** When encountering a browser-specific crash or OOM: (1) capture the exact error, (2) identify the code path, (3) check if our code can reduce memory pressure, (4) document findings in the progress doc, (5) only claim "browser limitation" after exhaustive investigation with evidence.
