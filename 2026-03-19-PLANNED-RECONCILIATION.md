# PLANNED RECONCILIATION — READ BEFORE MAKING CHANGES

**Created:** 2026-03-19
**Status:** Active — DO NOT remove this file until reconciliation is complete

---

## Purpose

This document describes the branch structure and planned reconciliation for the `testing/iso/ptf/2025/` and `testing/iso/ptf/2026/` directories. It exists on every branch involved in the plan to ensure any agent or developer understands the constraints before making changes.

---

## Branch Structure

| Branch | Purpose | Base |
| ------ | ------- | ---- |
| `master` | Clean commit history (10 commits from `9c17c5d`) | `9c17c5d` |
| `test-form-generator/2025/dev` | Current master state with temporary commits | `9c17c5d` |
| `test-form-generator/2025/dev-001` | Original 21 temporary commits (archive) | `9c17c5d` |
| `test-form-generator/2025/clean-001` | First clean attempt — lump-sum docs (archive) | `9c17c5d` |
| `test-form-generator/2025/clean-002` | Final clean — docs woven into code commits | `9c17c5d` |
| `test-form-generator/2026/dev` | Active 2026 development — `2026/` created via `git mv` from `2025/` | `master` (clean) |

## Staging

`conres.io-staging` is based on parent commit `9c17c5d` with 2 layered staging commits on top. The staging sync script (`sync-generator-to-staging.mjs`) uses `9c17c5d` as the parent commit for file protection.

---

## Critical Constraints

### DO NOT

1. **DO NOT force-push `master`** — the clean history is the authoritative record
2. **DO NOT rebase across the `9c17c5d` boundary** — this commit is the shared ancestor for all branches and staging
3. **DO NOT delete `2025/` files on any branch** unless that branch has been fully reconciled
4. **DO NOT modify `conres.io-staging`** without verifying compatibility with the parent commit `9c17c5d`
5. **DO NOT merge feature branches into `master`** without following the reconciliation procedure below

### PRESERVE

1. **`2025/` on `master`** must remain at its `9c17c5d` state after reconciliation — this matches the staging baseline
2. **`2026/` files carry rename history** from `2025/` via `git mv` — `git log --follow` traces back through `2025/` history
3. **All `test-form-generator/*` branches** must be retained until reconciliation is complete and verified

---

## `2025/` → `2026/` File History

Files in `testing/iso/ptf/2026/` were created using `git mv` from `testing/iso/ptf/2025/`. This means:

- `git log --follow testing/iso/ptf/2026/<file>` traces back through the `2025/` history
- The `2025/` originals were restored from the parent commit after the move
- Both `2025/` and `2026/` directories coexist on the `2026/dev` branch

**Do NOT break this rename chain** by deleting and re-creating files instead of using `git mv` for further moves.

---

## Reconciliation Procedure (When 2026 Sprint Is Complete)

1. **Verify** `2026/` is fully functional and tested
2. **On `master`:** `2025/` stays at its `9c17c5d` state — the `2025/` work from clean commits lives only on feature branches
3. **Merge** `test-form-generator/2026/dev` into `master` — this adds `2026/` with full history
4. **Update staging** to serve from `2026/` paths instead of `2025/`
5. **Verify** staging works with `2026/`
6. **Clean up** feature branches after confirming everything is stable
7. **Remove** this file once reconciliation is complete
