# 2026-03-26 Interface Progress

## Last Updated: 2026-03-26

## Current Status: Planning

---

## Roadmap

### 1. Apply r2 Layout to index.html

- [ ] Copy r2 layout to index.html as baseline
- [ ] Verify all structural changes from r2 are intact:
  - [ ] Remove overview-fieldset + continue button
  - [ ] Assets fieldset: optgroups (F10a/F9f/F9e), wrapped label, clear cache repositioned
  - [ ] New output-fieldset: output profile + bit-depth (with "Same as Source" label)
  - [ ] Specifications: `required` on all inputs, `type="email"` on email
  - [ ] Customizations `<details>` replaces assembly-filters fieldset (moved to Generation)
  - [ ] Debugging `<details>` replaces debugging fieldset (workers + assembler strategy sub-fieldsets)
  - [ ] Generate button + note moved above progress fieldset
  - [ ] Progress fieldset moved inside generation-fieldset

### 2. Fix JS Code References for r2 Layout

Element ID/selector changes needed in `test-form-generator-app-element.js`:

| Old Reference                                | New Reference                                 | Locations                                                                                |
| -------------------------------------------- | --------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `#assembly-filters-details`                  | `#customization-details`                      | connectedCallback (toggle listener, version change), persistState, restorePersistedState |
| `#debugging-checkbox`                        | URL-only (`?debugging` query param)           | connectedCallback, handleGenerate                                                        |
| `#debugging-include-output-profile-checkbox` | Removed                                       | handleGenerate                                                                           |
| `details:assembly-filters` (persist key)     | `details:customization` + `details:debugging` | persistState, restorePersistedState                                                      |
| `input[type="text"]` (persist selector)      | Add `input[type="email"]` handling            | persistState, restorePersistedState                                                      |

- [ ] Update `#assembly-filters-details` → `#customization-details` (all occurrences)
- [ ] Remove `#debugging-checkbox` references — use URL-based `?debugging` only
- [ ] Remove `#debugging-include-output-profile-checkbox` references — default to `false`
- [ ] Update details persistence keys for customization + debugging details
- [ ] Update text input persistence to also handle `type="email"`
- [ ] Remove hidden conversion-strategy references if still present

### 3. Check Name/ID Convention Consistency

Known inconsistencies across all three versions:

| Issue                        | Details                                                                                        |
| ---------------------------- | ---------------------------------------------------------------------------------------------- |
| Checkboxes missing `name`    | `bootstrap-worker-checkbox`, `parallel-workers-checkbox`, `debugging-checkbox` (removed in r2) |
| Radio buttons missing `id`   | `layout-mode`, `color-space-mode`, `rendering-intent-mode` radios have no IDs                  |
| Radio ID naming inconsistent | `processing-strategy` radios have IDs; mode radios do not                                      |

- [ ] Audit all form elements for name/id consistency
- [ ] Add missing `name` attributes to checkboxes
- [ ] Decide on radio button ID convention and apply consistently
- [ ] Document final element inventory

### 4. Form Validation (Task 5)

- [x] Email field: `type="email"` with HTML validation
- [ ] Add `pattern` attributes to specification inputs (device, colorants, substrate, settings)
- [x] `required` attribute handling: debugging details open removes required via `#updateRequiredState()`
- [ ] Reset non-email inputs after generation completes
- [ ] Autocomplete: retain last 10 values per field in localStorage (non-debug mode only)
- [ ] Proper HTML5 validation flow (using `reportValidity()` or `checkValidity()`)

---

## Activity Log

### 2026-03-26

- Created progress document
- Analyzed r1/r2/current diffs to identify all layout and code changes
- Mapped element ID changes needed in JS
- Identified naming convention inconsistencies
- Applied r2 layout to index.html (user)
- Updated test-form-generator-app-element.js:
  - `#assembly-filters-details` → `#customization-details` (all occurrences)
  - Removed `#debugging-checkbox` refs — debugging now URL-only (`?debugging`)
  - Removed `#debugging-include-output-profile-checkbox` refs — defaults to false
  - Updated details persistence: `details:customization` + `details:debugging`
  - Added `input[type="email"]` to persist/restore selectors
  - Added debugging-details toggle listener for state persistence
  - Removed unused `debugging` variable from connectedCallback
- Added `name` attributes to checkboxes: `bootstrap-worker`, `parallel-workers`
- Verified all JS element ID queries match HTML IDs
- Debugging now driven by `#debugging-details` open state (not URL)
- Added `#updateRequiredState()` toggling required based on debugging details
- Customization details closed → all modes forced to auto
- Debugging details closed → defaults (worker on, in-place, not debugging)
- Added generate/cancel button with confirm, UI lock, wake lock, beforeunload
- All fieldsets + legend radios disabled during generation
- Details summaries locked during generation
