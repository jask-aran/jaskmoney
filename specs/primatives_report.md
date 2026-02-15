# Primitive Interaction Report

## Purpose
This report documents:
1. The current primitive architecture that is implemented in the codebase.
2. What is actually reusable today (and what is not).
3. Why derivative primitives exist for specific contexts.
4. A proposed architecture that improves consistency, maintainability, and interaction quality while preserving contextual power.

The file name intentionally follows the current project spelling convention used in discussion (`primatives_report.md`).

## Scope and Baseline
This report reflects the current repository state and the v0.32.x implementation shape, grounded in:
- `app.go`, `update.go`, `update_*`, `render.go`, `picker.go`, `commands.go`, `keys.go`, `filter.go`, `db.go`, `config.go`
- `specs/architecture.md` (§3, §4, §6, §8, §9)

## Glossary (Terms Used in This Report)
- Primitive: a reusable interaction/data/rendering contract with a stable API/behavior.
- Parent primitive: a primitive consumed by other primitives or contexts.
- Child primitive/context: a specialized implementation that composes parent primitive behavior.
- Context: one active interaction state (scope + handler + view contract).
- Scope: keybinding namespace used by `KeyRegistry` lookup.
- Action: semantic intent label (`select`, `close`, `toggle`, etc.) bound to keys per scope.
- Command: executable action unit in `CommandRegistry` (`ID`, `Enabled`, `Execute`).
- Contract: explicit data shape that defines behavior guarantees (current: implicit by code; proposed: explicit `InteractionContract`).
- One-off solution: behavior implemented directly in a context handler without shared primitive reuse.
- Footer hint: shortcut helper rendered in footer/modal hints.

## How Relationships Work Today (and What They Are Not)
Current relationships are not class inheritance and there are no subclasses in the OOP sense.

The app uses composition + state-machine dispatch:
- Composition: contexts call shared helper primitives (`pickerState`, input helpers, modal renderers).
- State machine: one active state/scope at a time, chosen by `Update` precedence.
- Functional routing: keys -> scope lookup -> action/command -> handler branch -> model mutation / cmd.

So “parent-child” currently means:
- Parent = shared function/type contract consumed by multiple contexts.
- Child = context-specific orchestration logic built on top of those contracts.

## Process and Data Flow Diagrams

### 1) Keypress to Behavior (Current)
```text
tea.KeyMsg
  -> update.go dispatch chain (topmost overlay wins)
    -> active scope chosen
      -> KeyRegistry.Lookup(key, scope)
        -> Binding(Action, optional CommandID)
          -> either:
             A) direct handler branch (context-specific logic)
             B) executeBoundCommand -> CommandRegistry.ExecuteByID
               -> model + optional tea.Cmd
```

### 2) Async Mutation Flow (Current)
```text
User action
  -> handler returns tea.Cmd
    -> I/O or DB operation
      -> typed Msg (success/error payload)
        -> Update handles Msg
          -> setStatus/setError + state changes
            -> View re-renders
```

### 3) Footer Data Flow (Current)
```text
active model state
  -> footerBindings() / settingsFooterBindings()
    -> keys.HelpBindings(scope)
      -> renderFooter()

Problem: handler semantics can drift from rendered hints because
some contexts also render local modal footers manually.
```

### 4) Footer Data Flow (Proposed)
```text
active model state
  -> activeInteractionContract()
    -> renderFooterFromContract(contract, keys)
      -> hints rendered from intents only

Tests enforce:
- active state -> expected contract
- contract intents -> valid key mapping
- handler behavior satisfies declared intents
```

## Code-Level Primitive Connection Map
| Primitive | Parent/Child Role | Core Code | Key Consumers |
|---|---|---|---|
| Dispatch precedence | Parent | `update.go` (`tea.KeyMsg` routing chain) | All contexts |
| Scope/action registry | Parent | `keys.go` (`Binding`, `Lookup`, scopes/actions) | All key handling |
| Command execution | Parent | `commands.go` (`Command`, `ExecuteByID`) | Palette, bound command actions |
| Modal composition | Parent | `app.go` (`composeOverlay`), `render.go` (`renderModalContentWithWidth`) | Detail, editor modals, pickers, jump, palette |
| Picker engine | Parent | `picker.go` (`pickerState`, `HandleMsg`, `renderPicker`) | Cat/tag/filter apply/account action pickers |
| Text helpers | Parent | `update.go` input helper functions | Filter input, editor fields, command query, notes |
| Filter AST/parser | Parent | `filter.go` | Transaction filtering, saved filter/rule validation |
| Pane/section renderers | Parent | `render.go` section box functions + `app.go` sizing | Dashboard/Manager/Settings layout |
| CRUD/data layer | Parent | `db.go`, `config.go` | All mutating workflows |
| Context handlers | Child | `update_*`, `filter_saved.go` | Domain workflows and one-off logic |

## Key/Action Overlap and Divergence (Current)

### Shared Cross-Context Patterns
- `esc`: close/cancel in most modal scopes.
- `enter`: select/confirm in many scopes.
- arrows + `ctrl+p/n`: movement in most list/modal contexts.
- `space`: toggle where multi-select or boolean toggles are present.

### Notable Scope Differences (Intentional)
| Scope | `enter` | Secondary action | Why |
|---|---|---|---|
| `scopeCategoryPicker` | apply selected category | `esc` cancel | Single-select apply flow |
| `scopeTagPicker` | apply/submit patch | `space` toggle | Multi-select/tri-state semantics |
| `scopeFilterInput` | confirm/apply text expression | `esc` clear; left/right cursor | Text-entry-first context |
| `scopeRuleEditor` | step advance/pick/save depending step | `space` toggle enabled | Wizard-style composite editor |
| `scopeDetailModal` | save (notes when not editing) / done in notes mode | `n` enter notes edit | Two-mode detail context |
| `scopeManagerModal` | save form | `space` toggles enum/bool fields | Mixed form field types |
| `scopeDupeModal` | no generic enter branch | `a/s/esc` branch actions | Explicit branching workflow |

### Overlap Risks / Drift Areas
- Same action label can map to different user-perceived outcomes by context.
- Some contexts render footer via shared `HelpBindings`, others custom modal strings.
- Text-input affordances vary (cursor-aware vs append/delete-last only).

## One-Off Implementations vs Reuse Opportunities
| Current One-Off | Why It Was Built | Reuse Opportunity |
|---|---|---|
| Import dupe decision modal (`a/s/esc`) | Branch workflow, not list select | Keep bespoke branch actions, but declare branch intents in contract |
| Manager account modal field logic | Mixed fields + persistence workflow | Migrate to shared `FormContext` controller with field adapters |
| Detail notes dual-mode flow | Viewer + inline edit in one modal | Keep dual-mode, but standardize `Edit` and `Save` intents |
| Settings inline cat/tag editors | High-throughput CRUD in-place | Wrap with shared form primitive while preserving inline layout |
| Command suggestions rendering | Needs disabled reason/search metadata | Share list windowing primitives, keep command-specific rows |

## Parent/Child Relationship Model in the Proposed Architecture

### Current (Implicit)
```text
Shared helpers + conventions
  + context-specific handler branches
  = behavior
```

### Proposed (Explicit Contract Composition)
```text
InteractionContract (parent)
  -> ContextContract (List/Form/Viewer/Workflow/InlineEdit)
    -> concrete context adapters (child)
      -> context-specific domain operations
```

Rules in proposed model:
1. Child contexts inherit interaction defaults by context kind (composition, not subclassing).
2. Deviations are explicit in contract (`Omit`, custom intent labels, branch intents).
3. Footer rendering reads contracts only.
4. Tests validate child handlers satisfy parent contract intents.

This preserves flexibility while giving deterministic propagation: changes to parent contracts affect all children unless explicitly overridden.

## Current Primitive Map (Implemented)

### 1. State and Dispatch Primitive
Primary primitive:
- `model` is the single mutable state root.
- `Update` dispatch order defines interaction precedence and modal barriers.

Implemented behavior:
- Topmost overlay wins (`update.go` key dispatch chain).
- Only one active scope handles each keypress.
- Lower scopes never receive events while higher overlays are active.

Why it matters:
- This is the true parent primitive for all interaction behavior.
- It prevents key leakage and context confusion.

### 2. Key Scope + Action Primitive
Primary primitive:
- `Action` and scoped `Binding` definitions in `keys.go`.
- `KeyRegistry.Lookup` with scope-first then global fallback.

Implemented behavior:
- Scope-isolated key meanings.
- Intentional reuse of keys across different scopes.
- Global fallback for universal actions.

Why it matters:
- Enables domain-specific shortcuts without global conflict explosion.
- Makes modal isolation enforceable.

### 3. Command Primitive
Primary primitive:
- `Command` contracts (`ID`, `Scopes`, `Enabled`, `Execute`).
- `CommandRegistry` for routing and palette search.

Implemented behavior:
- User-visible actions are command-addressable in many contexts.
- Hidden dynamic commands (`filter:apply:<id>`) are executable but excluded from palette rendering.

Why it matters:
- Decouples keybinding from behavior execution.
- Supports both palette UX and deterministic command IDs.

### 4. Modal Composition Primitive
Primary primitive:
- `renderModalContentWithWidth` for framed modal content.
- `composeOverlay`/`overlayAt` for placement and compositing.

Implemented behavior:
- Shared box/chrome rendering and centered overlay placement.
- ANSI-aware width and truncation utilities.

Why it matters:
- Visual consistency is centralized.
- Not all modal behavior is centralized.

### 5. Picker Primitive
Primary primitive:
- `pickerState` (`newPicker`, `HandleMsg`, `renderPicker`).
- `pickerItem` with optional `Section`, `Meta`, `Search`.

Implemented behavior:
- Fuzzy filtering.
- Stable section order.
- Single-select, multi-select, tri-state patching.
- Optional create row.

Used by:
- Category picker.
- Tag picker.
- Saved-filter apply picker.
- Manager account-action picker.
- Rule editor sub-pickers (filter/category/tags via reused picker infrastructure).

Why it matters:
- Most list-selection interactions are already consolidated.

### 6. Text Entry Primitive
Primary primitive:
- Shared helpers in `update.go`:
  - `appendPrintableASCII`
  - `deleteLastASCIIByte`
  - cursor-aware operations (`insertPrintableASCIIAtCursor`, `deleteASCIIByteBeforeCursor`, `moveInputCursorASCII`)

Implemented behavior:
- Reused across filter input, command query, settings editors, filter editor, rule editor name field, dashboard custom input, detail notes, manager modal fields.

Why it matters:
- Input handling consistency is partially centralized.
- Context controllers still diverge in semantics.

### 7. Filter Language Primitive
Primary primitive:
- `filterNode` AST + parser/evaluator/serializer in `filter.go`.
- Permissive parse for live input, strict parse for persisted contexts.

Implemented behavior:
- Unified query language for transaction filtering and saved-filter/rule validation.
- AST-first composition in model filter builders.

Why it matters:
- This is one of the strongest current primitives with clear contracts.

### 8. Pane and Section Composition Primitive
Primary primitive:
- Section renderers (`renderSectionBox`, `renderManagerSectionBox`, section sizing helpers).
- Focus section model fields (`focusedSection`, section constants).

Implemented behavior:
- Dashboard and Manager panes are composed as section cards.
- Settings sections are layout-structured and focusable.

Why it matters:
- Layout grammar is reusable, even when interaction grammar differs.

### 9. Chart Primitive (Current State)
Primary primitive:
- Render-level chart functions in `render.go`:
  - `renderSpendingTrackerWithRange`
  - `renderCategoryBreakdown`
  - summary/stat card renderers

Implemented behavior:
- Chart logic is mostly feature-local and render-centric.
- No dedicated chart abstraction file yet.

Why it matters:
- Works today but has weak extensibility for future widget/pane modes.

### 10. CRUD/Data Mutation Primitive
Primary primitive:
- DB functions in `db.go` and config persistence in `config.go`.
- Cmd+Msg async pattern for mutations (`tea.Cmd` + typed completion messages).

Implemented behavior:
- Domain CRUD operations are centralized in data layer functions.
- UI controllers orchestrate state + side effects via commands.

Why it matters:
- Data writes are mostly centralized and testable.
- UI-level interaction semantics for save/apply/cancel still vary by context.

## Context Requirements and Why Derivative Primitives Exist

### Dashboard
Needs:
- Low-friction timeframe switching.
- Optional custom date entry.
- Visual analytics with no modal overload.

Why derivative behavior exists:
- Dashboard has both toggle-like controls and text-entry flows.
- A single picker primitive is insufficient for mixed timeline/chip/date semantics.

### Manager Accounts
Needs:
- Fast account focus and activation toggles.
- Add/edit account form with field types (text, enum, bool).
- Risky actions grouped in account action picker.

Why derivative behavior exists:
- Account editing is a form state machine, not a list selector.
- Clear/nuke actions are action-menu semantics, so picker works there.

### Manager Transactions
Needs:
- High-throughput row navigation.
- Bulk operations (selection, quick category/tag).
- Filtering without leaving context.

Why derivative behavior exists:
- Table navigation, text filter entry, and pickers are distinct interaction grammars.
- Reusing one primitive for all would reduce speed and clarity.

### Settings Categories/Tags
Needs:
- Frequent CRUD with immediate contextual feedback.
- Lightweight inline editor behavior while keeping list visible.

Why derivative behavior exists:
- Inline settings edit modes trade modal purity for workflow speed.
- Same base text helpers, different presentation and save lifecycle.

### Settings Rules
Needs:
- Multi-step editor with validation dependencies.
- Selection of saved filter/category/tags from existing entities.
- Apply and dry-run workflows.

Why derivative behavior exists:
- Rule editing is a wizard-like composite form.
- Embedded picker reuse is deliberate: reuse list-selection primitive where valid, custom flow where sequencing/validation is domain-specific.

### Import Flow
Needs:
- File selection from filesystem snapshot.
- Duplicate handling branch before ingest.
- Async ingest progress and result reporting.

Why derivative behavior exists:
- This is a procedural workflow with branching outcomes.
- Generic picker alone cannot represent branch semantics (`all`, `skip`, `cancel`) cleanly.

### Command UI
Needs:
- Searchable command execution with scope awareness.
- Hidden dynamic targets.
- Colon mode typed invocation.

Why derivative behavior exists:
- Command matching includes enable state, disabled reasons, metadata wrapping, ID routing.
- This exceeds generic picker row semantics.

## Current Gaps and Friction

### A. Footer correctness is not contract-guaranteed
- Footer hints come from scope bindings (`HelpBindings`) and local renderers.
- Interaction handlers can drift from footer semantics.
- Some contexts use custom footer text while others rely on generic binding output.

### B. Similar actions vary by context in ways that are hard to predict
- Save/apply/confirm semantics differ (explicit save, immediate apply, staged save).
- Edit entry actions differ (`enter`, `n`, list-level `enter`, dedicated toggles).

### C. Parent primitive changes do not always propagate automatically
- Picker and text helpers propagate well.
- Modal/form contracts are not unified enough to guarantee downstream consistency.

### D. Interaction state data shape is uneven
- Some contexts model explicit step/focus strongly.
- Others encode logic ad hoc in handler branches.
- This increases maintenance cost and regression risk.

## Proposed Architecture (Improved Primitive Contract Model)

## Design Goals
1. Footer correctness guaranteed by data contract, not manual synchronization.
2. Uniform interaction semantics for similar intents.
3. Parent primitive updates produce deterministic child behavior changes.
4. Clearer state models for each interaction mode.
5. Maintain contextual shortcuts where they provide real workflow value.

## 1) Introduce an Interaction Contract Layer
Add a single interaction descriptor model that every active context must expose.

Proposed core type:
```go
type InteractionIntent string

const (
    IntentMovePrev   InteractionIntent = "move_prev"
    IntentMoveNext   InteractionIntent = "move_next"
    IntentFocusPrev  InteractionIntent = "focus_prev"
    IntentFocusNext  InteractionIntent = "focus_next"
    IntentSelect     InteractionIntent = "select"
    IntentToggle     InteractionIntent = "toggle"
    IntentEdit       InteractionIntent = "edit"
    IntentConfirm    InteractionIntent = "confirm"
    IntentSave       InteractionIntent = "save"
    IntentCancel     InteractionIntent = "cancel"
    IntentDelete     InteractionIntent = "delete"
    IntentApply      InteractionIntent = "apply"
)

type InteractionHint struct {
    Intent InteractionIntent
    Label  string
    Omit   bool
}

type InteractionContract struct {
    Scope string
    Hints []InteractionHint
    // Optional semantic checks for testing and diagnostics.
    RequiredIntents []InteractionIntent
}
```

Rule:
- Every active context returns one `InteractionContract`.
- Footer rendering reads only this contract.
- Handlers are validated against contract-intent presence in tests.

Outcome:
- Footer bar becomes contract-driven and provably aligned.
- Intent naming consistency becomes enforceable.

## 2) Standardize a Context Taxonomy
Define context kinds with default intent semantics:
- `ListContext` (pickers, file lists, command palette)
- `FormContext` (manager modal, filter editor, settings editor, rule editor)
- `ViewerContext` (detail view, dry-run results)
- `WorkflowContext` (import dupe decision, multi-step processes)
- `InlineEditContext` (dashboard custom input, settings inline name edits)

Each kind has default action semantics:
- `ListContext`: `enter=select/apply`, `esc=cancel`, arrows/ctrl+p/n move.
- `FormContext`: `enter=confirm step`, `ctrl+s or explicit save intent for persist`, `esc=cancel/close`, tab cycles fields.
- `ViewerContext`: `esc=close`, arrows scroll.
- `WorkflowContext`: intent-specific branch keys allowed (`all`, `skip`, etc.) but contract must declare branch intents.
- `InlineEditContext`: printable text first, `enter=apply`, `esc=cancel`.

Outcome:
- Similar contexts behave similarly by default.
- Bespoke behavior must be declared as an explicit deviation.

## 3) Build a Reusable Form Primitive
Create a shared form controller for modal/inline forms.

Proposed components:
- `formState` with fields, focused index, validation, dirty state.
- Shared handlers for move focus, cursor-aware text edit, enum toggle, confirm/save/cancel.
- Field adapters:
  - text field
  - toggle field
  - enum field
  - entity picker field

Outcome:
- Manager modal, filter edit modal, rule editor step fields, settings add/edit forms can converge on a single behavior backbone.
- Left/right text-cursor behavior becomes consistent where text fields support cursor editing.

## 4) Separate “Confirm” vs “Persist Save” Semantics
Define explicit semantics:
- `Confirm`: accept current step/item.
- `Save`: persist changes.
- `Apply`: execute transformation without entering edit mode.

Contract rules:
- If a context mutates persistent state, it must expose whether `confirm` implies `save`.
- Footer can omit hints for noise control, but omission is explicit via `Omit=true` and test-visible.

Outcome:
- Reduced ambiguity across contexts where `enter` currently does different things.

## 5) Footer Contract Guarantee Mechanism
Implement:
1. `activeInteractionContract()` on model.
2. `renderFooterFromContract(contract, keys)`.
3. Test matrix that validates:
   - active state -> expected contract scope
   - contract intents map to keys in registry
   - handler accepts mapped intents in that state

Use existing architecture requirement as baseline (`architecture.md` §3.4.11 invariant #5) and expand it from scope-only to intent-level validation.

Outcome:
- Footer correctness is guaranteed by testable contract.

## 6) Picker and Command Unification Boundary
Keep both primitives, but formalize shared base:
- Shared match/ranking interface for list-like UIs.
- Shared list windowing, cursor, and rendering row contract.
- Command UI remains separate for command-specific metadata and disabled reason handling.

Outcome:
- No forced over-unification.
- Reduced duplication in list-like presentation behavior.

## 7) Chart/Pane Primitive Evolution
Add a `widget` contract for dashboard panes (even before full v0.4 widget system):
```go
type PaneWidget interface {
    ID() string
    Title() string
    Render(ctx PaneRenderCtx) string
    SupportsFocus() bool
    SupportsDrill() bool
    DrillAction() (InteractionIntent, bool)
}
```

Outcome:
- Charts and summary cards become interchangeable pane modules.
- Focus/drill semantics become contract-based rather than ad hoc per render branch.

## 8) Data Model Clarity for Interaction State
Group model state by interaction controllers:
- `InteractionUIState`
- `PickerUIState`
- `FormUIState`
- `CommandUIState`
- `FilterUIState`

Outcome:
- Lower cognitive load.
- Easier testing and less accidental cross-feature coupling.

## 9) Migration Strategy (Incremental, Low-Risk)
Phase A: Contracts and tests only
- Add `InteractionContract` and model resolver.
- Add footer-contract alignment tests without changing behavior.

Phase B: Footer rendering migration
- Move footer rendering to contract source.
- Preserve current key mappings and hints.

Phase C: Form primitive introduction
- Migrate filter editor and manager modal first.
- Then settings cat/tag and rule editor field behaviors.

Phase D: Semantic normalization
- Normalize confirm/save/apply intent declarations.
- Keep context-specific branch actions where needed.

Phase E: Widget/pane contract introduction
- Wrap existing dashboard sections into pane widget adapters.

## 10) Acceptance Criteria for the Proposed Architecture
1. Footer hints are generated from active interaction contract in all contexts.
2. Contract-intent vs handler behavior alignment tests pass for all reachable states.
3. All form-like contexts share the same cursor-aware text editing behavior unless explicitly opted out.
4. All list-like contexts share the same movement/select/cancel semantics.
5. Any bespoke shortcut must be declared in contract deviations and covered by regression tests.
6. No reduction in current power-user workflows (quick tag/category, command palette, typed commands, import branching).

## 11) Why This Improves Delight
- Predictable controls reduce cognitive load.
- Context-specific power remains available where it clearly accelerates workflows.
- Footer hints become trustworthy.
- Editing and selection interactions feel coherent instead of coincidentally similar.
- Faster feature iteration with lower regression risk due to contract-driven behavior.

## 12) Summary
The current app has strong foundational primitives (state arbitration, scopes, picker, parser, async CRUD). Its main weakness is not lack of reuse; it is lack of an explicit interaction contract tying footer hints, intents, and handlers together.

The proposed architecture preserves existing strengths while adding a formal interaction data contract, context taxonomy, and reusable form controller. This yields consistent UX semantics, reliable footer guidance, stronger downstream propagation from parent primitives, and lower long-term maintenance burden.

---

## Addendum: Audit Findings and Implementation Status (v0.32.3)

This section records concrete findings from the implementation audit that
followed the original report, and tracks what was actually built.

### Concrete Bugs Found (Not in Original Report)

1. **Rule editor footer labels swapped** (`render.go`): `space` was labeled
   "pick/save" but means "toggle"; `enter` was labeled "toggle" but means
   "pick/save". Fixed in v0.32.3.

2. **Detail modal editing footer misleading** (`render.go`): footer showed
   `esc/enter done` implying equivalence, but esc closes the modal entirely
   while enter only exits edit mode. Clarified to `enter done  esc close`.

3. **Manager account modal had NO footer** (`render.go`): empty string was
   passed to `renderModalContent`. Added proper footer with key hints
   (`tab/arrows navigate  enter save  esc cancel`).

4. **`importDupeModal`/`importPicking` precedence order was swapped** between
   `update.go` and `footerBindings` in `app.go`. Normalized by the shared
   dispatch table.

5. **`commandContextScope` had dead code** (lines 1122-1127): redundant
   `ruleEditorOpen`/`dryRunOpen` checks inside the `tabSettings` block were
   already caught earlier in the if-chain. Removed during refactor.

### What Was Implemented

**Shared dispatch table (`dispatch.go`):**
- `overlayEntry` struct and `overlayPrecedence()` function with 14 entries
- `dispatchOverlayKey()` for `Update()`, `activeOverlayScope()` for footer
  and command scope resolution
- Two-tier architecture: primary table for overlays, `tabScope()` and
  `settingsTabScope()` for tab sub-states
- Tests: unique names, overlay scope correctness per guard

**Modal text input contract (`dispatch.go`):**
- `modalTextBehavior` struct with `cursorAware`, `printableFirst`,
  `vimNavSuppressed` flags
- `modalTextContracts` map covering all 8 text-input scopes
- `isTextInputModalScopeFromContract()` replaces old manual switch
- Tests: completeness, consistency, vim-nav suppression

**Cursor-aware upgrades:**
- Manager modal fields (`managerEditNameCur`, `managerEditPrefixCur`) now use
  cursor-aware editing with left/right support
- Detail notes (`detailNotesCursor`) now uses cursor-aware editing
- Both use `insertPrintableASCIIAtCursor`/`deleteASCIIByteBeforeCursor`/
  `moveInputCursorASCII` and `renderASCIIInputCursor`

**Reusable form helpers (`dispatch.go`):**
- `textField` struct with `handleKey()`, `render()`, `set()` methods
- `modalFormNav` struct with `handleNav()` for focus cycling
- Available for Phase 3-6 composition; not yet wired into existing forms

### Corrections to Original Report

**Recommendation 7 (PaneWidget):** The proposed `PaneWidget` interface
overlaps significantly with the v0.4 spec Phase 6 widget system. The Phase 6
`widget` type already covers pane identity, mode cycling, focus, and
drill-down. Recommendation 7 should be reconciled with Phase 6 during
implementation rather than built separately.

**Recommendation 3 (Form Primitive):** The report proposed a single unified
`FormContext` controller. In practice, modal forms and inline forms have
fundamentally different lifecycles:
- **Modal forms** (manager modal, rule editor, filter edit) have explicit
  open/close transitions, dedicated overlays, and save-on-close semantics.
- **Inline forms** (settings cat/tag editors, dashboard custom input) edit
  in-place within an existing view, with immediate or enter-to-save semantics.

The implementation provides flexible building blocks (`textField`,
`modalFormNav`) rather than a single controller. New modals should compose
from these helpers; inline editors may use `textField` for cursor behavior
but don't need the form-level navigation helper.

**Recommendation 1 (InteractionContract):** The full `InteractionContract`
type with intent declarations and contract-driven footer rendering is
deferred to Phase 7 of the v0.4 spec. What shipped in v0.32.3 is the
prerequisite foundation: the dispatch table and text contract system that
make the full contract layer feasible. Phase 7 builds on this foundation
as a pre-release hardening step.

**Recommendation 8 (Data Model Clarity):** Grouping model state into typed
sub-structs (`InteractionUIState`, `PickerUIState`, etc.) is a good long-term
goal but is NOT a v0.4 deliverable. The flat model with comment grouping
works at current scale (~35 fields for overlays). Revisit when the model
exceeds ~50 overlay-related fields or when package extraction begins.

### Discovery: `scopeDetailModal` Vim-Nav

The original report listed `scopeDetailModal` as a candidate for vim-nav
suppression. This is incorrect: the detail modal uses a dedicated
`updateDetailNotes` handler when editing notes, and j/k are needed for
non-editing scroll mode. The `modalTextContracts` entry correctly sets
`vimNavSuppressed = false` for this scope.
