# 2026-01-26-CLASSES-PART-02-CORRECTION.md

Correction of PART-02 error that restored the Template Method pattern

**Created:** 2026-01-26
**Status:** IN PROGRESS

---

## Failure Analysis

### What Went Wrong

In PART-02 Phase 4 Stage 6, the agent (Claude) misinterpreted the task "Remove Abstract Throws" and "make `doConvertColor()` concrete" as meaning:

- **What the agent did**: Added a concrete implementation to `doConvertColor()` in the base class
- **What was actually required**: Delete `doConvertColor()` entirely (it was already removed in PART-01)

This caused the Template Method pattern to be **restored** when it had been **successfully removed** in PART-01.

### Root Cause

1. **Context loss between sessions**: The agent did not properly verify the PART-01 end state before starting PART-02
2. **Misinterpretation of "concrete"**: The agent interpreted "make concrete" as "add implementation" rather than understanding the method should not exist at all
3. **Failure to read PART-01 REPORT**: The PART-01 REPORT clearly stated the template method was removed with grep returning 0 matches

### Evidence

**PART-01 REPORT (lines 184-194)** confirmed successful removal:
```
### Template Method Pattern: REMOVED
| Before | After |
|--------|-------|
| `beforeConvertColor()` | Deleted |
| `doConvertColor()` | Renamed to `convertColor()` |
| `afterConvertColor()` | Deleted |
Grep for `doConvertColor|beforeConvert|afterConvert` in `.js` files returns **0 matches**.
```

**PART-02 REPORT (line 5)** showed the error:
```
**Status**: Implementation Complete - Template Method Pattern Restored
```

### Lessons for Future Agents

1. **ALWAYS read the previous REPORT.md** before continuing work - it contains verified end state
2. **"Remove abstract throws" does NOT mean "add implementations"** - it means delete methods that only throw
3. **Verify with grep** after each change to ensure patterns are actually removed
4. **When a pattern is removed, it stays removed** - do not re-add infrastructure "for completeness"

---

## Correction Goals

After this correction:

1. **No template method pattern** - No `beforeConvertColor()`, `doConvertColor()`, `afterConvertColor()`
2. **No abstract throws** - Every method that exists has a real implementation
3. **Each class has `convertColor()`** that does its actual work directly

---

## Coordination Protocol

**Coordinator role**: Delegate to subagents only — do NOT do implementation work directly.

**Subagent execution**: SEQUENTIAL, not parallel — each stage must complete before the next begins so tests/matrix can catch regressions.

**Sequence per stage**:

1. Implementation subagent makes changes
2. Review subagent runs tests + grep verification
3. Only proceed to next stage if review passes

---

## Verification Procedures

### Configuration

- **Matrix configuration**: `testing/iso/ptf/2025/experiments/configurations/2026-01-26-CLASSES-002.json`
- **Output folder**: `testing/iso/ptf/2025/experiments/output/`
- **Log naming**: `2026-01-26-XXX.log` (sequential numbering)

### Baseline (BEFORE changes)

Run these commands to establish baseline:

```bash
# Unit tests baseline
yarn test 2>&1 | tee testing/iso/ptf/2025/experiments/output/2026-01-26-009-baseline.log

# Matrix baseline
node testing/iso/ptf/2025/experiments/scripts/generate-verification-matrix.mjs \
  --config=testing/iso/ptf/2025/experiments/configurations/2026-01-26-CLASSES-002.json \
  2>&1 | tee testing/iso/ptf/2025/experiments/output/2026-01-26-009.log
```

### After Each Stage

```bash
# Run unit tests
yarn test

# Grep verification (must return 0 matches when complete)
grep -rn "doConvertColor\|beforeConvert\|afterConvert" testing/iso/ptf/2025/classes/*.js
```

### Final Verification

```bash
# Final matrix run
node testing/iso/ptf/2025/experiments/scripts/generate-verification-matrix.mjs \
  --config=testing/iso/ptf/2025/experiments/configurations/2026-01-26-CLASSES-002.json \
  2>&1 | tee testing/iso/ptf/2025/experiments/output/2026-01-26-010.log

# Pattern removal verification (MUST return 0 matches)
grep -rn "doConvertColor\|beforeConvert\|afterConvert" testing/iso/ptf/2025/classes/*.js
```

---

## Roadmap

Each stage runs SEQUENTIALLY: implement → review → next stage.

- [ ] Stage 0: Run baseline tests and matrix
- [ ] Stage 1: Fix ColorConverter base class → review
- [ ] Stage 2: Fix ImageColorConverter → review
- [ ] Stage 3: Fix PDFImageColorConverter → review
- [ ] Stage 4: Fix LookupTableColorConverter → review
- [ ] Stage 5: Fix PDFContentStreamColorConverter → review
- [ ] Stage 6: Fix CompositeColorConverter (if needed) → review
- [ ] Stage 7: Fix PDFPageColorConverter → review
- [ ] Stage 8: Fix PDFDocumentColorConverter → review
- [ ] Stage 9: Final verification (tests + matrix + grep)

---

## Current Status

**Current Focus:** Stage 1 - Fix ColorConverter base class
**Last Updated:** 2026-01-26

---

## Activity Log

### 2026-01-26 - Correction Started

- Created this CORRECTION.md document
- Documented failure analysis and root cause
- Beginning systematic removal of template method pattern

