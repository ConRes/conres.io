# Status UI Progress Tracking Fix

**Created:** 2026-04-08
**Last Updated:** 2026-04-08
**Status:** Planning

---

## Problem

The generator's progress UI (overall progress bar + subtask list + subtask detail) does not accurately reflect what is happening during generation. This forces the user to open the browser inspector to understand progress, which causes memory pressure that crashes the generator in Safari.

### Symptoms

1. **Subtask list skips key entries** — a complete run shows only 5 entries (Converting, Loading, Preparing, Downloading, Loading manifest) but many stages are missing: docket generation, slug generation, PDF save, individual pass labels, chain processing
2. **"Preparing ICC profile" shows for too long** — the `preparing` stage label covers profile parsing (fast) AND docket generation (slow: 2 GhostScript runs × QR code + slugs). The user sees "Preparing" for 20+ seconds with no indication of what's actually happening
3. **Progress percentages don't match actual time** — `stageRanges` were calibrated for the original architecture. With sequential subsets, inter-page delays, and worker dispatch, the time distribution has changed significantly
4. **Missing stages in the subtask results list** — the `completedSubtasks` array only records entries when the stage key changes (`currentStageEntry.stage !== stage`). If a stage fires multiple progress updates without changing the key, only the last message is recorded

### Current Progress Elements

```
index.html:
  #test-form-generation-overall-progress        — overall progress bar (0-100%)
  #test-form-generation-overall-progress-output  — "Stage — N% — M:SS"
  #test-form-generation-subtask-progress         — subtask progress bar within current stage
  #test-form-generation-subtask-progress-output   — current message + subtask elapsed
  #test-form-generation-subtask-results-output    — completed subtask list (newest first)
```

### Current Stage Flow (in-place mode)

From `test-form-pdf-document-generator.js` `onProgress` calls:

| Line | Stage | Percent | Message | What's Actually Happening |
| --- | --- | --- | --- | --- |
| 296 | `loading` | 0 | Loading manifest | Fetch manifest.json |
| 311 | `downloading` | 2 | Downloading asset PDF | Fetch 1.5 GB PDF (with progress updates) |
| 321 | `preparing` | 30 | Parsing ICC profile | Parse ICC header |
| 336 | `preparing` | 31 | Analyzing output profile | OutputProfileAnalyzer Max GCR test |
| 421 | `preparing` | 32 | Generating docket PDF | **2 full conversion passes + 2 GhostScript slug runs + docket assembly — takes 15-25s** |
| 443 | `assembling` | 32 | Loading asset PDF | PDFDocument.load() on 1.5 GB buffer |
| 504 | `converting` | 36 | Pre-converting N pages | AssetPagePreConverter — the main work |
| 510 | `converting` | 36-78 | Pass/page messages | Individual page conversion updates |
| 540 | `converting` | 78 | Color conversion complete | |
| 546 | `slugs` | 80 | Loading slug resources | GhostScript for main PDF slugs |
| 553 | `slugs` | 88 | Embedding slugs | Apply slugs to pages |
| 567 | `saving` | 95 | Saving PDF | pdfDoc.save() — serializes ~1 GB |
| 578 | `done` | 100 | Generation complete | |

### Problems Identified

1. **`preparing` covers too much** — lines 321-421 all use stage `preparing` but the docket generation at line 421 is the slowest part (15-25s). The user sees "Preparing ICC profile" the entire time because `stageLabels.preparing = 'Preparing ICC profile'`

2. **Docket generation has no dedicated stage** — it hides inside `preparing` at percent 32. It should be its own stage so the subtask list shows "Docket generation — 18s"

3. **`stageRanges` don't account for sequential subsets** — the `converting` range is [34, 78] (44% of the bar) but with sequential subsets + 500ms delays on 19 pages, converting can take 3-5 minutes. Meanwhile `downloading` gets [2, 30] (28%) but takes <1s from cache

4. **Multi-intent passes flatten into one `converting` stage** — Pass 1 (Relative Colorimetric) and Pass 2 (K-Only GCR) both report as `converting` with sub-percentages. The subtask list only shows one "Converting colors" entry for both passes combined

5. **`buildCompletedHint` doesn't handle all stages** — only has special cases for `downloading`, `chains`, `recombining`. Missing: `preparing` (should split into profile + docket), `converting` (should show per-pass), `slugs`, `saving`

## Investigation Plan

### Step 1 — Trace actual progress events

Create a Playwright script that captures every `onProgress` call with timestamp, stage, percent, and message. Run against both in-place and multi-intent modes. Output a timeline showing:
- Exact timestamp of each progress event
- Time gap between events (identifies where the UI appears stuck)
- Stage transitions (where subtask entries should be created)

### Step 2 — Identify missing stages

Compare the progress event timeline against what the subtask results list shows. Identify:
- Stages that should appear as separate entries but don't
- Long gaps within a single stage that should be split
- Messages that should update the subtask detail but are swallowed

### Step 3 — Propose stage restructuring

Define new stage keys and ranges that accurately reflect the actual work:
- Split `preparing` into `preparing` (profile) + `docket` (docket generation)
- Make each multi-intent pass a distinct subtask entry
- Recalibrate `stageRanges` based on actual timing data

### Step 4 — Implement fixes

Update `test-form-pdf-document-generator.js` `onProgress` calls with correct stage keys and percentages. Update `test-form-generator-app-element.js` `stageLabels`, `stageRanges`, and `buildCompletedHint`.

---

## Roadmap

- [ ] **1.1** Create Playwright progress event tracer script in `experiments/scripts/`
- [ ] **1.2** Run tracer against in-place mode, capture full timeline
- [ ] **1.3** Run tracer against multi-intent mode, capture full timeline
- [ ] **2.1** Compare timelines against subtask results list — document gaps
- [ ] **3.1** Propose new stage keys and ranges
- [ ] **3.2** Review with user before implementing
- [ ] **4.1** Implement stage restructuring
- [ ] **4.2** Verify with Playwright tracer — confirm all stages appear correctly
- [ ] **4.3** Test in Safari — confirm no inspector needed to track progress

---

## Activity Log

### 2026-04-08

- Identified 5 problems with current progress UI from user report
- Traced all progress elements in `index.html` and their update paths in `test-form-generator-app-element.js`
- Mapped all `onProgress` call sites in `test-form-pdf-document-generator.js` (25+ calls)
- Found root cause: `preparing` stage covers profile parsing + docket generation (15-25s) under one label
- Found `interConversionDelay` was firing between every content stream and every image (per-task, not per-page) — removed from `pdf-page-color-converter.js` (lines 571-575 and 777-778 were added by a previous Claude session, not by the user)
- Created this progress document
