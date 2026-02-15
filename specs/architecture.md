# Jaskmoney Architecture Reference

This document is the persistent architecture baseline for the project. Keep it
current. It is the source of truth for structure, invariants, and evolution
decisions.

## Table of Contents

1. [Purpose and Scope](#1-purpose-and-scope)
2. [Runtime Topology and Ownership](#2-runtime-topology-and-ownership)
3. [Core Invariants](#3-core-invariants)
   - 3.1 [State and Update Invariants](#31-state-and-update-invariants)
   - 3.2 [Dispatcher Priority and Modal Precedence](#32-dispatcher-priority-and-modal-precedence)
   - 3.3 [Text Input Safety Contract](#33-text-input-safety-contract)
   - 3.4 [Keybinding Architecture](#34-keybinding-architecture)
     - 3.4.1 [Design Principles](#341-design-principles)
     - 3.4.2 [Scope Categories](#342-scope-categories)
     - 3.4.3 [Key Resolution Algorithm](#343-key-resolution-algorithm)
     - 3.4.4 [Key Reuse Safety Rules](#344-key-reuse-safety-rules)
     - 3.4.5 [Universal Primitives](#345-universal-primitives)
     - 3.4.6 [Footer Hint Derivation](#346-footer-hint-derivation)
     - 3.4.7 [keybindings.toml Override Architecture](#347-keybindingstoml-override-architecture)
     - 3.4.8 [Scope Growth Budget](#348-scope-growth-budget)
     - 3.4.9 [Tab Shortcut Mapping (v0.4)](#349-tab-shortcut-mapping-v04)
     - 3.4.10 [v0.4 Scope Map](#3410-v04-scope-map)
     - 3.4.11 [Key Conflict Testing Contract](#3411-key-conflict-testing-contract)
   - 3.5 [Status Semantics](#35-status-semantics)
4. [Interaction Primitives and Conventions](#4-interaction-primitives-and-conventions)
   - 4.1 [Picker Primitive](#41-picker-primitive-pickerstate)
   - 4.2 [Quick Category vs Quick Tag](#42-quick-category-vs-quick-tag)
   - 4.3 [Command System](#43-command-system)
   - 4.4 [Filter Expression Language](#44-filter-expression-language)
   - 4.5 [Jump Mode](#45-jump-mode)
5. [Data Layer Conventions](#5-data-layer-conventions)
   - 5.1 [Transaction and Import Contracts](#51-transaction-and-import-contracts)
   - 5.2 [Schema and Migration Rules](#52-schema-and-migration-rules)
   - 5.3 [Tag Name Normalization](#53-tag-name-normalization-v03)
   - 5.4 [Schema v5 Migration Policy](#54-schema-v5-migration-policy)
   - 5.5 [Rules v2 Data Contracts](#55-rules-v2-data-contracts)
   - 5.6 [Budget Data Contracts](#56-budget-data-contracts)
   - 5.7 [Credit Offset Integrity](#57-credit-offset-integrity)
6. [Rendering and Viewport Safety](#6-rendering-and-viewport-safety)
   - 6.1 [Frame Composition](#61-frame-composition)
   - 6.2 [Overlay Composition](#62-overlay-composition)
   - 6.3 [Table and Section Contracts](#63-table-and-section-contracts)
   - 6.4 [Dashboard Grid Rendering](#64-dashboard-grid-rendering)
   - 6.5 [Narrow Terminal Fallback](#65-narrow-terminal-fallback)
   - 6.6 [Jump Overlay Rendering](#66-jump-overlay-rendering)
   - 6.7 [Drill-Return Filter Pill](#67-drill-return-filter-pill)
   - 6.8 [Budget View Rendering](#68-budget-view-rendering)
7. [Runtime Modes and Harnesses](#7-runtime-modes-and-harnesses)
8. [Testing Strategy and Release Gates](#8-testing-strategy-and-release-gates)
   - 8.1 [Test Architecture (Three Tiers)](#81-test-architecture-three-tiers)
   - 8.2 [Tier-3 Flow Harness Contract](#82-tier-3-flow-harness-contract)
   - 8.3 [Heavy Flow Gate](#83-heavy-flow-gate-flowheavy)
   - 8.4 [Local Test Entry Points](#84-local-test-entry-points)
   - 8.5 [Regression Priority Matrix](#85-regression-priority-matrix)
   - 8.6 [Standard Verification Commands](#86-standard-verification-commands)
9. [Learnings and Decisions](#9-learnings-and-decisions)
   - 9.1 [v0.295 → v0.3](#91-v0295--v03)
   - 9.2 [v0.3 → v0.4](#92-v03--v04)
10. [Open Backlog](#10-open-backlog)
11. [Maintenance Rules for This Document](#11-maintenance-rules-for-this-document)

---

## 1. Purpose and Scope

Jaskmoney is a Bubble Tea-based TUI personal-finance manager focused on:

- **Account-scoped transaction browsing and editing** — navigate and modify
  transactions with account filtering, multi-select, and quick actions.
- **CSV import with format detection and duplicate handling** — flexible format
  definitions, dupe scanning, preview modal (**v0.4**: with post-rules
  preview and full-view toggle).
- **Dashboard analytics** — summary KPIs, category composition, spending
  tracker (**v0.4**: 4-pane focusable widget grid with drill-down to filtered
  transaction views and return context).
- **Budgeting** (**v0.4**) — category budgets with monthly overrides,
  filter-based spending targets, credit offset tracking for refunds, and budget
  health analytics.
- **Filter expression language** (**v0.4**) — unified filtering for search,
  rules, and budget targets with field predicates (`cat:`, `tag:`, `amt:`,
  etc.) and boolean operators.
- **Rules engine** (**v0.4**: rules v2) — ordered, filter-based rules that set
  categories and add/remove tags, with dry-run preview and enable/disable
  toggles.
- **Settings/editor workflows** — categories, tags, rules, chart options,
  dashboard view customization (**v0.4**), and DB operations.
- **Command-first interaction** — keybindings map to commands (**v0.4**:
  command registry with scope-aware availability), command palette (Ctrl+K),
  and colon mode (`:`).
- **Jump mode navigation** (**v0.4**) — spatial navigation with `v` key showing
  labeled badges for focusable sections across all tabs.

This document is about implementation architecture and engineering conventions,
not end-user feature docs.

**Document purpose:** Describe the v0.4 target architecture while annotating
what currently exists in v0.3, so implementing agents know both the destination
and the migration path.

## 2. Runtime Topology and Ownership

Runtime boundaries and owning files:

**Entrypoints and core framework:**

- `main.go`: CLI mode routing (`TUI`, `-validate`, `-startup-check`).
- `app.go`: model shape, `Init`, `View`, shared layout/frame helpers.
  (**v0.4**: adds `buildTransactionFilter`, `buildDashboardScopeFilter`,
  `buildCustomModeFilter` filter composition functions.)
- `update.go`: top-level message dispatcher and cross-cutting helpers.
  (**v0.4**: jump mode dispatch intercepts before tab routing.)
- `validate.go`: headless validation/startup harnesses.

**Update handlers (per-tab/per-modal):**

- `update_manager.go`: manager tab and account modal behavior.
- `update_transactions.go`: transaction list navigation/search/sort/filter and
  quick actions. (**v0.4**: replaces search+category filter with unified
  filter input using filter expressions; drill-return ESC handling.)
- `update_dashboard.go`: dashboard timeframe interactions. (**v0.4**: pane
  focus interactions, mode cycling `[`/`]`, drill-down with return context,
  jump target registration.)
- `update_budget.go` (**v0.4 new**): Budget tab key handlers for table view,
  planner view, and inline editing.
- `update_detail.go`: transaction detail modal interaction logic. (**v0.4**:
  credit offset linking flow.)
- `update_settings.go`: settings navigation, editor modes, confirm logic,
  import entry points. (**v0.4**: rules v2 editor with multi-step form,
  enable/disable toggle, reorder `K`/`J`, dry-run modal; dashboard views config
  editor.)
- `filter_saved.go` (**v0.32.2f**): saved-filter CRUD/apply workflows,
  filter-save modal state handling, apply picker orchestration, recency
  ordering, and ID/name/expr validation flow.

**Data layer:**

- `db.go`: schema lifecycle and transactional DB operations. (**v0.3**: schema
  v4. **v0.4**: schema v5 migration, rules_v2 CRUD, budget CRUD, credit offset
  CRUD with integrity validation.)
- `ingest.go`: import scanning, duplicate scanning, import execution pipeline.
  (**v0.4**: enhanced `scanDupesCmd` returns parsed rows with dupe flags;
  simulated rule preview; calls `applyRulesV2ToTxnIDs` for new imports.)

**Configuration and keybindings:**

- `config.go`: format/settings/keybinding parsing, validation, and default
  regeneration for invalid startup config.
  (**v0.4**: adds `savedFilter` and `customPaneMode` types; strict validation
  of filter expressions at load time.)
- `keys.go`: action/scope key registry and lookup. (**v0.4**: `Binding` gains
  `CommandID` field; new scopes for budget, jump overlay, import preview,
  dashboard focus, rule editor, dry-run modal, offset picker.)
- `commands.go`: command registry and execution. (**v0.3**: 11 commands.
  **v0.4**: expands to ~30+ commands; adds `ExecuteByID`, scope-aware
  availability, jump mode commands, filter commands, rules commands, budget
  commands, dashboard drill-down commands.)

**Primitives and utilities:**

- `filter.go` (**v0.4 new**): Filter expression AST (`filterNode`), parser
  (permissive and strict variants), evaluator (`evalFilter`), serializer
  (`filterExprString`).
- `budget.go` (**v0.4 new**): Budget computation logic (`computeBudgetLines`,
  `computeTargetLines`), period helpers (month/quarter/annual key resolution),
  credit offset reduction.
- `widget.go` (**v0.4 new**): Dashboard widget types, 4-pane domain-first mode
  definitions, custom mode appending from config, constructors
  (`newDashboardWidgets`).
- `picker.go`: reusable fuzzy picker primitive for overlay workflows (category,
  tag, account nuke, command palette, command-mode suggestions, saved-filter
  apply picker).
- `overlay.go`: width-aware string utilities and overlay compositing.
- `theme.go`: Catppuccin Mocha color constants and semantic aliases.

**Rendering:**

- `render.go`: all rendering and style composition. (**v0.4**: adds filter pill
  in transaction header, rule list/editor/dry-run modals, import preview
  compact+full views, budget table/planner/analytics strip, dashboard 2x2 grid,
  jump overlay with floating badges, drill-return prefix in filter pill, narrow
  terminal fallback.)

Ownership rule:

- Add code to the file that owns the concern.
- Cross-concern helpers belong in `update.go` or `app.go` only when truly
  shared.
- Avoid creating behavior in render paths; rendering must stay pure.

## 3. Core Invariants

### 3.1 State and Update Invariants

- Single mutable state root: `model`.
- Model mutations happen in `Update` paths only.
- Side effects happen via `tea.Cmd`; never run I/O in `View`.
- Async work returns typed `xxxMsg` messages.
- Message handlers check `err` first and set status consistently.

### 3.2 Dispatcher Priority and Modal Precedence

Overlay precedence is the single most critical architectural invariant.
Three consumers must agree on the same priority order:

1. `Update()` in `update.go` — finds the active handler for a `tea.KeyMsg`
2. `footerBindings()` in `app.go` — finds the active scope for footer hints
3. `commandContextScope()` in `commands.go` — finds the active scope for
   command availability

**Shared dispatch table (v0.32.3+):** These three consumers now read from a
single shared data structure defined in `dispatch.go`:

- `overlayEntry` struct — declares guard, scope, handler, and which consumers
  use each entry (`forFooter`, `forCommandScope`).
- `overlayPrecedence()` — returns the authoritative ordered table. This is a
  function (not a `var`) to avoid Go initialization cycles from handler
  closures.
- `dispatchOverlayKey()` — used by `Update()` to find and call the first
  matching overlay handler.
- `activeOverlayScope()` — used by `footerBindings()` and
  `commandContextScope()` to find the first matching overlay scope.

**Adding a new overlay/modal:** Add one `overlayEntry` in the correct priority
position in `overlayPrecedence()`. All three consumers automatically stay in
sync. Then add a `modalTextContracts` entry if the modal has text fields
(see §3.3).

**Two-tier dispatch:** The table covers overlay/modal precedence (primary
tier). Tab-level sub-state routing (secondary tier) uses `tabScope()` and
`settingsTabScope()` helpers in `dispatch.go`, called by each consumer after
the overlay table finds no match.

**v0.4 target precedence order (primary tier):**

1. **jump overlay** [v0.4 new] — `jumpModeActive` → `updateJumpOverlay`
2. **command UI** — `commandOpen` → `updateCommandUI` (palette or colon mode)
3. **detail modal** — `showDetail` → `updateDetail`
4. **offset picker** [v0.4 new] — `offsetLinking` → `updateOffsetPicker`
5. **import dupe modal** — `importDupeModal` → `updateDupeModal`
   (v0.4: replaced by **import preview** — `importPreviewOpen` →
   `updateImportPreview`)
6. **file picker** — `importPicking` → `updateFilePicker`
7. **category picker** — `catPicker != nil` → `updateCatPicker`
8. **tag picker** — `tagPicker != nil` → `updateTagPicker`
9. **filter apply picker** — `filterApplyPicker != nil` →
   `updateFilterApplyPicker`
10. **manager action picker** — `managerActionPicker != nil` →
    `updateManagerActionPicker`
11. **saved-filter edit modal** — `filterEditOpen` → `updateFilterEdit`
12. **manager account modal** — `managerModalOpen` → `updateManagerModal`
13. **dry-run modal** — `dryRunOpen` → `updateDryRunModal`
14. **rule editor** — `ruleEditorOpen` → `updateRuleEditor`
15. **budget target editor** [v0.4 new] — `budgetTargetEditing` →
    `updateBudgetTargetEditor`
16. **filter input mode** — `filterInputMode` → `updateFilterInput`
17. **command-open shortcuts** — check `canOpenCommandUI()` then dispatch
    `ctrl+k` or `:` (handled in `update.go` after overlay table, not in table)
18. **tab routing** (secondary tier) — `activeTab` determines which tab
    handler to call via `tabScope()`:
    - `tabDashboard` → `updateDashboard`
    - `tabBudget` [v0.4 new] → `updateBudget`
    - `tabManager` → `updateManager` or `updateTransactions` (mode-dependent)
    - `tabSettings` → `updateSettings`

Contract:

- `Esc` closes the topmost active overlay/modal state.
- No lower-priority state may process a key while a higher-priority state is
  active.
- Jump overlay must intercept before all other states (it's app-wide and
  context-sensitive per tab).
- The dispatch table has tests enforcing unique names and mutual exclusivity
  with tab-level scopes (`TestDispatchTableOverlayPrecedenceHasUniqueNames`,
  `TestDispatchTableOverlayGuardsAreMutuallyExclusiveWithTabs`).

### 3.3 Text Input Safety Contract

Text input contexts where printable keys must be treated as literal text, not
shortcuts.

**Modal text contracts (v0.32.3+):** The authoritative source of truth for
text input behavior is the `modalTextContracts` map in `dispatch.go`. Every
modal scope that contains text-editable fields must have an entry declaring:

- `cursorAware` — `true` = uses `insertPrintableASCIIAtCursor` and related
  cursor helpers; `false` = uses `appendPrintableASCII` (legacy).
- `printableFirst` — `true` = printable keys are literal text, never shortcuts.
- `vimNavSuppressed` — `true` = `h`/`j`/`k`/`l` are NOT navigation keys in
  this scope.

The function `isTextInputModalScopeFromContract()` replaces the old manual
switch, driving runtime vim-nav suppression from the contract data.

Tests enforce:
- Every scope in `modalTextContracts` exists in `KeyRegistry` scopes
  (`TestModalTextContractCompleteness`).
- Every vim-suppressed scope has `printableFirst` and `cursorAware` set
  (`TestModalTextContractConsistency`).

**Current contracts (v0.32.3):**

| Scope | cursorAware | printableFirst | vimNavSuppressed |
|---|---|---|---|
| `scopeRuleEditor` | yes | yes | yes |
| `scopeFilterEdit` | yes | yes | yes |
| `scopeSettingsModeCat` | yes | yes | yes |
| `scopeSettingsModeTag` | yes | yes | yes |
| `scopeManagerModal` | yes | yes | yes |
| `scopeDetailModal` | yes | yes | no* |
| `scopeFilterInput` | yes | yes | no* |
| `scopeDashboardCustomInput` | no | yes | no |

*`scopeDetailModal` uses a dedicated `updateDetailNotes` handler when editing
notes; j/k are needed for non-editing scroll. `scopeFilterInput` is a
non-modal scope (inline bar) where vim-nav keys are handled contextually.*

**v0.4 entries to add as phases land:**

| Scope (v0.4) | cursorAware | printableFirst | vimNavSuppressed | Phase |
|---|---|---|---|---|
| `scopeBudgetTargetEditor` | yes | yes | yes | 5 |
| `scopeOffsetPicker` (amount field) | yes | yes | yes | 5 |
| `scopeBudgetInlineEdit` | yes | yes | no | 5 |

The import preview modal (Phase 4) has no text fields and needs no entry.
Dashboard custom date input (`scopeDashboardCustomInput`) already has an entry.
Each phase's keybinding note specifies which entries to add.

**Universal modal key rule:**

- Any modal with text-editable fields must not interpret `h`/`j`/`k`/`l` as
  navigation (enforced by `vimNavSuppressed = true` in its contract entry).
- Allowed navigation keys in text-input modals are arrows, `tab`/`shift+tab`,
  and `ctrl+p`/`ctrl+n`.
- Non-text modals/pickers may continue using vim-style navigation keys.

**Reusable form helpers (v0.32.3+):** `dispatch.go` also provides lightweight
building blocks for new modals:

- `textField` — bundles a string value with cursor position; provides
  `handleKey()`, `render()`, and `set()` methods for cursor-aware editing.
- `modalFormNav` — provides `handleNav()` for focus cycling across fields in
  a modal form (up/down/tab/shift-tab).

These helpers are available for Phase 3-6 work. Existing forms still use their
current patterns but new modals should compose from these helpers.

**Adding a new modal with text input (checklist):**

1. Add an `overlayEntry` in `overlayPrecedence()` at the correct priority
   position (see §3.2).
2. Add a `modalTextContracts` entry with the correct behavior flags.
3. Use `textField` and `modalFormNav` helpers where applicable.
4. Add a footer to the modal render function with accurate key hints that
   match the handler's actual behavior. Structure footer hints as discrete
   key-label pairs (not prose sentences) to facilitate Phase 7 migration to
   `renderFooterFromContract()`.
5. Run `TestModalTextContractCompleteness` and
   `TestModalTextContractConsistency` to verify.

**Phase 7 forward-compatibility:** Phase 7 (`v0.4-spec.md`) will migrate all
footer rendering to contract-driven output via `InteractionContract` and
`renderFooterFromContract()`. During Phases 3-6, footer hints should be
structured as key-label pairs in render functions (e.g., `"enter save  esc
cancel  tab next field"`) rather than embedded in prose or complex conditional
logic. This makes the Phase 7 migration incremental — each context can be
moved to contract-driven rendering independently.

**Per-context details:**

**Settings add/edit name fields (v0.3, carried forward):**

- Category and tag name fields in settings editor modes.
- Printable keys are literal text first.
- `enter` = save, `esc` = cancel, `backspace` = delete.
- Non-printable navigation keys (e.g. arrow keys) may move focus between
  fields.

**Filter expression input (`/` line, v0.4):**

- Filter input mode (`filterInputMode`).
- Printable keys append to filter expression string; do not trigger shortcuts.
- `enter` = apply filter, `esc` = cancel and clear, `backspace` = delete char.
- Live parse indicator shows green/red dot for valid/invalid expression.

**Rule editor fields (v0.4):**

- Name field (step 0) and filter expression field (step 1) in rule editor
  modal.
- Same contract as settings name fields: printable keys are literal text.
- `tab`/`shift+tab` navigate between editor steps; do not trigger shortcuts.

**Budget inline edit (v0.4):**

- Amount field in budget table view and planner view.
- Numeric input (`0-9`, `.`, `-`) is literal; navigation keys (`j`/`k`) are
  suppressed.
- `enter` = save, `esc` = cancel.

**Spending target editor fields (v0.4):**

- Name, filter expression, amount, period fields.
- Same contract as rule editor.

**Dashboard custom date input (v0.3, carried forward):**

- Custom date start/end fields when `dashCustomEditing` is true.
- Numeric and date separator keys (`0-9`, `-`) are literal.
- `enter` = apply, `esc` = cancel.

**Jump overlay (v0.4):**

- Single-key target selection consumes the keypress and focuses the target.
- Keys `n`, `c`, `b`, `h`, `t`, `a`, `r`, `i`, `d`, `w`, `p` are per-tab
  targets.
- No text buffer accumulation; immediate action on keypress.

This prevents accidental saves/quits or unintended actions while typing.

### 3.4 Keybinding Architecture

v0.4 significantly expands the number of scopes and commands. This section
defines the architecture that keeps keybindings manageable, conflict-free, and
user-overridable as the scope count grows.

#### 3.4.1 Design Principles

1. **Scopes are flat in storage, hierarchical in dispatch.** The `KeyRegistry`
   stores bindings in a flat scope→binding map. The hierarchy is implicit: each
   handler in `update.go` knows its scope and `Lookup()` falls back to
   `scopeGlobal`. This keeps the data structure simple while allowing layered
   resolution.

2. **Only one leaf scope is active at a time.** The dispatch chain in
   `update.go` is a priority list of mutually exclusive states. The first
   truthy condition wins, and its handler queries exactly one scope (plus the
   global fallback). Two non-modal scopes never compete for the same keypress.

3. **Modal scopes are total barriers.** When a modal overlay is active (pickers,
   detail modal, jump overlay, import preview, rule editor, etc.), it intercepts
   all keys. No key leaks to a parent scope. This is enforced by the dispatch
   chain ordering in `update.go`, not by a scope flag.

4. **Actions are the stable abstraction; keys are the variable.** Users override
   keys via `keybindings.toml` action mappings. Code never hardcodes key
   literals in handlers — it always checks `m.isAction(scope, action, msg)`.
   Actions are semantic names that remain stable across key remaps.

5. **Scopes are an implementation detail, not a user surface.** The
   `keybindings.toml` v2 format is action-level (`[bindings]` flat map). Scope
   routing remains in code (`keys.go`). Users think in actions ("what does
   search do?"), not scopes ("what does / do in `scopeTransactions`?").

#### 3.4.2 Scope Categories

Scopes fall into three categories with different key reuse rules:

**Tab scopes** — mutually exclusive by tab selection:

```
dashboard, dashboard_timeframe, dashboard_custom_input, dashboard_focused
budget, budget_table, budget_planner, budget_editing, budget_target_editor
manager, manager_transactions, transactions, search
settings_nav, settings_mode_*, settings_active_*
```

Tab scopes are mutually exclusive: only one tab is active, and within a tab
only one sub-state scope is queried. The same key can safely mean different
things across tab scopes (e.g. `a` = add rule in settings, `a` = add target
in budget).

**Modal scopes** — exclusive overlay states that block everything below:

```
command_palette, command_mode
detail_modal, detail_notes
dupe_modal / import_preview
file_picker, category_picker, tag_picker, account_nuke_picker
manager_modal
rule_editor, dry_run_modal
budget_target_editor
offset_picker
jump_overlay
```

Modal scopes are the strongest isolation boundary. When active, no other
scope processes keys. The same key can mean completely different things in
different modals without any user confusion because the modal context is
visually obvious. Footer hints show only the modal's bindings.

**Global scope** — universal fallback:

```
global
```

Bindings in `scopeGlobal` are available everywhere unless shadowed by a more
specific scope. Global bindings must use keys that are safe to shadow: tab
shortcuts (`1`/`2`/`3`/`4`), quit (`q`), command palette (`ctrl+k`), command
mode (`:`), jump mode (`v`).

#### 3.4.3 Key Resolution Algorithm

For any keypress in any state:

```
1. update.go dispatch chain finds the active handler (first truthy state wins)
2. Handler calls m.isAction(scope, action, msg) for candidate actions
3. isAction calls KeyRegistry.Lookup(keyName, scope):
   a. Check scope's index for exact key match
   b. If single letter and miss, try opposite case (case-insensitive fallback)
   c. If no match in scope, try scopeGlobal (steps a-b)
   d. Return nil if no match anywhere
4. Handler acts on the first matching action
```

**Critical invariant:** step 1 guarantees only one scope is checked per
keypress. There is no "scope stack" or concurrent resolution. This is why
adding scopes does not create combinatorial conflicts.

#### 3.4.4 Key Reuse Safety Rules

When assigning a key to an action in a scope, check these rules:

| Scenario | Safe? | Reason |
|---|---|---|
| Same key, different tab scopes | Yes | Mutually exclusive; user sees only one context |
| Same key, different modal scopes | Yes | Only one modal active; visually obvious |
| Same key in child scope + global | Shadow | Child wins; global handler never fires. Must be intentional |
| Same key in two simultaneously active scopes | Bug | Should never happen by dispatch chain design |

**Shadow policy:** A scope-specific binding that shadows a global binding
must be documented in the scope's registration comment. Common intentional
shadows:

- `j`/`k` in modal scopes shadow global (if global had them)
- `Enter` in editor scopes shadows `confirm` with scope-specific semantics
- `Esc` in focused/modal scopes means "unfocus/dismiss" rather than global quit

**Action semantic stability:** When the same action name is used across
scopes, it must mean the same conceptual thing. Examples:

- `confirm` always means "accept/select the current item"
- `cancel` always means "dismiss/go back"
- `add` always means "create a new item of the scope's type"
- `delete` always means "remove the focused item"

Do not reuse action names with divergent semantics across scopes.

#### 3.4.5 Universal Primitives

These actions have stable meaning everywhere and are handled as direct
switch cases (not command-routed). They must not be reassigned to different
semantics in any scope:

- `confirm` (`enter`) — accept/select
- `cancel` (`esc`) — dismiss/back/unfocus
- `up` / `down` (`k`/`j`, arrows)  — cursor movement
- `left` / `right` (`h`/`l`, arrows) — lateral navigation
- `delete` (`del`, `backspace` in some contexts)
- `quit` (`q`, `ctrl+c`) — exit application
- `next_tab` / `prev_tab` (`tab`, `shift+tab`) — cycle tabs

Scopes can add meaning on top of these (e.g. `enter` in dashboard_focused
triggers drill-down, which is a form of "confirm/select"), but the
underlying semantic must be compatible.

#### 3.4.6 Footer Hint Derivation

Footer hints are derived from the active scope's registered bindings:

1. `footerBindings()` mirrors the dispatch chain to determine the active scope
2. `HelpBindings(scope)` returns that scope's ordered binding list
3. Modal scopes show only their own bindings (no global bleed-through)
4. Non-modal tab scopes show their bindings; global bindings appear only if
   the handler explicitly concatenates them (e.g. `scopeManagerTransactions`
   + `scopeTransactions`)
5. Footer hints are not required to enumerate universal navigation primitives
   (`hjkl`, arrows, `ctrl+n/p`, `tab`/`shift+tab`) in every scope; these may
   be intentionally hidden to preserve helper-bar space for task-specific
   actions.

**v0.4 addition:** When `focusedSection >= 0` (a pane/section is focused via
jump mode), footer hints show the focused scope's bindings. When unfocused,
footer shows the tab's base bindings. This is a new state transition that
`footerBindings()` must handle per-tab.

#### 3.4.7 keybindings.toml Override Architecture

The TOML remains a **flat action-level override** layer (v2 format):

```toml
version = 2

[bindings]
confirm = ["enter"]
cancel = ["esc"]
up = ["k", "up"]
down = ["j", "down"]
search = ["/"]
```

Overriding an action changes its key in **every scope** where that action is
registered. This is by design: users think in terms of "I want search to be
ctrl+f" not "I want search in scopeTransactions to be ctrl+f but keep / in
scopeSettingsNav."

**Why not per-scope TOML overrides?**

- Scope count is growing (29 in v0.3, ~40+ in v0.4). Per-scope tables would
  be sprawling and error-prone.
- Most users want consistent keys: "search is always `/`", "add is always
  `a`", "delete is always `d`."
- For the rare power user who wants per-scope overrides, that can be a v0.5+
  feature. The v2 format's `[bindings]` flat map is forward-compatible with a
  future `[scopes.budget.bindings]` extension.

**Constraint for action naming:** Because overrides are action-level, actions
that share a name but have different default keys in different scopes will
get unified to one key set on override. This is acceptable as long as the
semantic stability rule (3.4.4) holds — if the action means the same thing,
it should have the same key.

Actions that need different keys in different scopes must have different
action names (e.g. `budget:toggle-view` vs `import:full-view`, not both
called `toggle_view`).

#### 3.4.8 Scope Growth Budget

v0.4 adds approximately 10-12 new scopes. To prevent ungoverned sprawl:

- **New scope checklist:** before adding a scope, verify that an existing
  scope cannot serve the purpose. Prefer reusing a parent scope with
  conditional `Enabled` checks on commands over creating a new scope.
- **Scope naming:** use `{tab}_{section}` for tab scopes,
  `{feature}_modal` or `{feature}_editor` for modals, `{feature}_picker`
  for picker overlays.
- **Registration audit:** `keys_test.go` must enumerate all scope constants
  and verify each has at least one registered binding and is reachable from
  the dispatch chain. Orphan scopes are dead code.

#### 3.4.9 Tab Shortcut Mapping (v0.4)

Global direct tab shortcuts are first-class:

- `1` -> Dashboard
- `2` -> Budget
- `3` -> Manager (transactions mode)
- `4` -> Settings

Tab shortcuts must work from settings navigation and active-settings
contexts, not only from top-level tab routing. Tab shortcut keys must not
be shadowed by any non-modal tab scope.

#### 3.4.10 v0.4 Scope Map

Canonical scope tree after v0.4. Indentation shows the dispatch chain
nesting (which handler delegates to which). Scopes at the same indent level
under a parent are mutually exclusive sub-states.

```
global
├── jump_overlay                      (modal)  [v0.4 new]
├── command_palette                   (modal)
├── command_mode                      (modal)
│
├── tab: dashboard
│   ├── dashboard                     (base, unfocused)
│   ├── dashboard_timeframe           (timeframe chip selector)
│   ├── dashboard_custom_input        (custom date text entry)
│   └── dashboard_focused             (pane focused via jump)  [v0.4 new]
│
├── tab: budget                                                [v0.4 new]
│   ├── budget_table                  (default view)
│   │   └── budget_editing            (inline amount edit)
│   ├── budget_planner                (planner grid view)
│   │   └── budget_planner_editing    (inline cell edit)
│   └── budget_target_editor          (modal)
│
├── tab: manager
│   ├── manager                       (accounts sub-view)
│   │   └── manager_modal             (modal: account add/edit)
│   └── manager_transactions          (transactions sub-view)
│       ├── transactions              (table navigation)
│       ├── search / filter_input     (text entry)
│       ├── filter_apply_picker       (modal)
│       ├── filter_edit               (modal: save/edit current filter)
│       ├── detail_modal              (modal)
│       │   └── offset_picker         (modal)  [v0.4 new]
│       ├── category_picker           (modal)
│       └── tag_picker                (modal)
│
├── tab: settings
│   ├── settings_nav                  (section navigation)
│   ├── settings_active_categories    (active section)
│   │   └── settings_mode_cat         (add/edit form)
│   ├── settings_active_tags
│   │   └── settings_mode_tag
│   ├── settings_active_rules
│   │   ├── rule_editor               (modal)  [v0.4 new]
│   │   └── dry_run_modal             (modal)  [v0.4 new]
│   ├── settings_active_filters
│   ├── settings_active_chart
│   ├── settings_active_db_import
│   │   ├── file_picker               (modal)
│   │   └── import_preview            (modal)  [v0.4 new]
│   ├── settings_active_import_history
│   └── settings_active_dashboard_views               [v0.4 new]
│       └── view_editor               (modal)  [v0.4 new]
│
└── account_nuke_picker               (modal)
```

New scopes added by v0.4 are marked. Total scope count grows from ~29
to ~40. All new scopes are either modal (isolated) or tab-exclusive
(non-overlapping), so the conflict surface does not grow combinatorially.

#### 3.4.11 Key Conflict Testing Contract

As scopes grow, manual conflict tracking becomes unreliable. The following
test invariants must hold in `keys_test.go`:

1. **Intra-scope uniqueness:** No two bindings in the same scope share a
   key. (Already enforced by `ApplyKeybindingConfig` validation.)

2. **Global shadow audit:** For every key bound in `scopeGlobal`, enumerate
   all non-modal scopes that bind the same key. Each shadow must be listed
   in an explicit allowlist in the test. This catches accidental shadows
   when adding new scope bindings.

3. **Scope reachability:** Every declared scope constant must appear in at
   least one `isAction()` call in the dispatch chain. Orphan scopes are
   flagged as dead code.

4. **Action-command consistency (v0.4):** Every `Binding` with a non-empty
   `CommandID` must reference a registered `Command.ID` in the registry.
   Every command with scopes must have a corresponding binding in at least
   one of those scopes.

5. **Footer-dispatch alignment:** The scope chosen by `footerBindings()`
   must match the scope used by the corresponding `updateXxx` handler for
   every reachable model state. A model-state fuzzer or explicit state
   matrix test verifies this.

6. **Tab shortcut non-shadow:** Keys `1`, `2`, `3`, `4` must not appear
   in any non-modal tab scope. (They should only be in `scopeGlobal`.)

7. **Jump key non-shadow:** `v` must not appear in any non-modal tab
   scope. Modal scopes may rebind `v` freely.

### 3.5 Status Semantics

- Errors must use `setError` (`statusErr = true`).
- Informational messages use `setStatus` / `setStatusf` (`statusErr = false`).
- New message handlers must preserve this semantic split.

## 4. Interaction Primitives and Conventions

### 4.1 Picker Primitive (`pickerState`)

The category picker, tag picker, account nuke picker, command palette, and
command-mode suggestions are all picker-driven interaction patterns.

Picker behavior contracts:

- Query filtering uses fuzzy subsequence scoring.
- Picker items may provide explicit `Search` text; when present, matching is
  performed against `Search` rather than only `Label`.
- Section order follows input item order.
- Score ties preserve original input order (stable tie-break), which is
  required for recency-first lists.
- Width-constrained rows are ANSI-aware truncated before padding to prevent
  border overflow in fixed-width modals.
- Create row is optional and controlled by `createLabel`.
  - Empty `createLabel` disables create behavior.
- Multi-select uses toggle semantics.
- Tag picker supports tri-state (`none/some/all`) with patch application.

Implementation guidance:

- Prefer configuring picker behavior over adding one-off modal implementations.
- Keep section labels stable because they become user navigation anchors.

### 4.2 Quick Category vs Quick Tag

- Quick category (`c`) is assignment-only in v0.3.
  - No inline category creation.
  - Category creation lives in Settings only.
- Quick tag (`t`) allows inline tag creation and tri-state patching.
- Quick tag section ordering in v0.3:
  1. `Scoped`
  2. `Global`
  3. `Unscoped` (scoped tags not matching current target categories)

### 4.3 Command System

**v0.4 Architecture**

Commands are first-class action primitives for user-visible operations. The
command registry (`CommandRegistry`) holds metadata for all commands and
dispatches execution.

```go
type Command struct {
    ID          string
    Label       string
    Description string
    Category    string          // "Navigation", "Actions", "Filter", "Budget"
    Hidden      bool            // excluded from command-palette search/render
    Scopes      []string        // scopes where available; empty = global
    Enabled     func(m model) (bool, string)
    Execute     func(m model) (model, tea.Cmd, error)
}
```

**Command dispatch flow:**

`keyMsg` → scope lookup (`keys.Lookup`) → `Binding.CommandID` →
`CommandRegistry.ExecuteByID(id, m)` → `(model, tea.Cmd, error)`

**Not command-routed:** Universal primitives (`confirm`, `cancel`, arrows,
`quit`, `next_tab`/`prev_tab`) and cursor/input plumbing remain direct handlers
for performance. The principle: **anything that would appear in the command
palette is a command; cursor/input/modal mechanics are not.**

**Scope-aware availability:**

- `Command.Scopes []string` declares where a command is valid.
- `Command.Enabled` adds runtime conditions (e.g., "DB not ready", "No rules
  available").
- Command palette filters by current scope + `Enabled` checks.
- Hidden commands are executable targets but intentionally excluded from palette
  results. Phase 2 uses this for `filter:apply:<id>` so palette UX stays
  compact while command IDs remain stable.

**v0.3 current state:** 11 commands exist (`go:dashboard`, `go:transactions`,
`import`, `apply:category-rules`, etc.) but dispatch is action-switch based,
not command-routed. Refactoring in Phase 1 unifies all user-visible actions as
commands.

**Reference:** See `specs/v0.4-spec.md` Phase 1 for full command table and
refactoring approach.

### 4.4 Filter Expression Language

**v0.4 Architecture**

Unified filter language powering search, rules, and budget targets. Plain text
searches description by default; power users add field predicates and boolean
operators. The v0.4 grammar is a Lucene-inspired subset (not full Lucene),
designed for fast hand-typed queries with strict validation in persisted
contexts.

**Grammar:**

```
expr     = or_expr
or_expr  = and_expr ( 'OR' and_expr )*
and_expr = unary ( ('AND' unary) | unary )*  // adjacent unary terms imply AND
unary    = 'NOT' unary | term
term     = '(' expr ')' | field_pred | text_search
```

**Field predicates:** `desc:`, `cat:`, `tag:`, `acc:`, `amt:`, `type:`,
`note:`, `date:`

**AST representation:**

```go
type filterNode struct {
    kind     filterNodeKind  // text | field | and | or | not
    field    string
    op       string          // "contains", "=", ">", "<", ".."
    value    string
    children []*filterNode
}
```

**Permissive vs strict parsing:**

- **Permissive** (`parseFilter`): used for interactive `/` filter input. Parse
  errors fall back to treating input as plain text search. Fast typing,
  backward compatible.
- **Strict** (`parseFilterStrict`): used for persisted contexts (rules,
  spending targets, saved filters). Parse errors block save with actionable
  messages. No fallback.

**Strict grouping rule (v0.4):**

- In strict contexts, mixed `AND`/`OR` expressions require explicit
  parentheses (e.g., reject `A OR B AND C`; accept `(A OR B) AND C`).
- Permissive `/` input remains typing-friendly and does not enforce this
  requirement.

**Composition functions:**

- `buildTransactionFilter()` — user input + account scope (Manager filter)
- `buildDashboardScopeFilter()` — timeframe + account scope (no transaction
  filter inheritance)
- `buildCustomModeFilter(pane, mode)` — strict-parsed custom mode expression

**Evaluator:** `evalFilter(node, txn, tags) bool` — recursively evaluates AST
against a transaction.

**Serializer:** `filterExprString(node) string` — converts AST back to text for
display/storage in canonical form (uppercase boolean operators + minimal
required parentheses for semantics preservation).

**v0.3 current state:** Ad-hoc `searchQuery` string + `filterCategories
map[int]bool` + `filterAccounts map[int]bool`. No unified language. Phase 2
replaces this with the filter expression system.

**Reference:** See `specs/v0.4-spec.md` Phase 2 for full grammar, field
predicates, and parser contracts.

### 4.5 Jump Mode

**v0.4 Architecture**

App-wide spatial navigation with `v` key. Jump mode shows labeled badges at
focusable sections in the current tab; pressing a target key focuses and
activates that section, then dismisses the overlay.

**Model fields:**

```go
jumpModeActive    bool
jumpPreviousFocus int   // -1 = unfocused; restore target on ESC
focusedSection    int   // -1 = unfocused; meaning is tab-specific
```

**Per-tab targets:**

| Tab       | Targets                                           | Default (ESC returns to) |
|-----------|---------------------------------------------------|--------------------------|
| Dashboard | `n` Net/Cashflow, `c` Composition, `b` Compare, `h` Budget Health | Unfocused |
| Manager   | `a` Accounts, `t` Transactions                    | Transactions             |
| Budget    | `t` Budget Table, `p` Planner                     | Budget Table             |
| Settings  | `c` Categories, `t` Tags, `r` Rules, `f` Filters, `d` Database, `w` Dashboard Views | Stay (no reset) |

Target keys can overlap across tabs because only one tab's targets are shown at
a time.

**Focus lifecycle:**

1. `v` → jump overlay appears with per-tab targets (floating badges)
2. Press target key → focus + activation move to target, overlay dismisses
3. Section-specific interactions available (e.g. mode cycling, inline edit)
4. `Esc` → return to tab's default focus (or stay for Settings)
5. `Esc` from default/unfocused → no-op

**Rendering:**

- Floating badges at section top-left: `[n]`, `[c]`, `[b]`, `[h]`
- Accent background, muted foreground
- Status bar: "Jump: press key to focus. ESC cancel."
- Focused sections get accent border; unfocused use muted border

**Commands:**

- `jump:activate` (global) — enter jump mode
- `jump:cancel` (jump_overlay scope) — dismiss and restore previous focus

**Activation contract (v0.32.4):**

- Jump target definitions must declare activation behavior separately from
  focus destination (two-axis contract: `Section` + `Activate`).
- Current default policy is `Activate=true` for all shipped jump targets.
- Tab default focus application (on tab switch/ESC reset) may set focus without
  activation (`Activate=false`) where appropriate.

**v0.3 current state:** Direct focus commands `nav:focus-accounts` and
`nav:focus-transactions` exist but are Manager-specific. Jump mode is Phase 1
infrastructure, with Dashboard and Budget targets registered in later phases.

**Reference:** See `specs/v0.4-spec.md` Phase 1 for full jump mode spec and
Bagels reference (`~/bagels-ref/src/bagels/components/jumper.py`).

## 5. Data Layer Conventions

### 5.1 Transaction and Import Contracts

- Import is settings-initiated only.
- Duplicate identity key remains `(date_iso, amount, description)`.
- Import + duplicate workflows must remain transactional and message-driven.

### 5.2 Schema and Migration Rules

- Schema version is tracked in `schema_meta`.
- `openDB` is responsible for schema setup/migration plus startup data hygiene.
- Multi-step DB mutations must run in a transaction.

### 5.3 Tag Name Normalization (v0.3)

Tag naming contract:

- Tag names are stored and surfaced in uppercase.
- `insertTag` and `updateTag` normalize names to uppercase.
- Startup performs normalization for existing databases.

Startup normalization requirements:

- Convert mixed/lowercase tags to uppercase.
- Merge case-duplicate tags (e.g., `rent` + `RENT`) safely.
- Rewire `transaction_tags` and `tag_rules` to keeper IDs.
- Delete redundant duplicate tag rows.

Rationale:

- Deterministic display/search behavior.
- Eliminates case-fragmented tag ecosystems.

**v0.4 note:** `tag_rules` table reference here will be dropped when rules v2
lands (Phase 3). Tag normalization contract remains unchanged.

### 5.4 Schema v6 Migration Policy

**v0.4 now targets schema v6.** Migration runs transactionally through:
- `migrateFromV4ToV5(db)` for base v0.4 tables/budgets
- `migrateFromV5ToV6(db)` for rules v2 contract update (`saved_filter_id`,
  add-only tags)

**What changes:**

- **Rules v1 fresh start:** `category_rules` and `tag_rules` tables are
  dropped.
- **Rules v2 reset at v6:** existing `rules_v2` rows are dropped/recreated so
  users rebuild rules with saved-filter links.
- **New tables added:** `rules_v2`, `category_budgets`,
  `category_budget_overrides`, `spending_targets`, `spending_target_overrides`,
  `credit_offsets`.
- **Preserved data:** `transactions`, `categories`, `tags`, `transaction_tags`,
  `accounts`, `account_selection`, `imports`.

**Migration operational safeguards:**

- Each create/drop/index statement uses defensive `IF EXISTS`/`IF NOT EXISTS`
  forms.
- Migration runs in a transaction; any failure rolls back all changes.
- `schema_meta.version = 6` is written only after all preceding steps succeed.
- Migration function tolerates partially-upgraded dev DBs (missing old tables,
  already-created new tables, partially-created indexes).

**Idempotency:** Re-running the migration on a partially-upgraded database must
not fail or corrupt data. This is critical for development environments and
migration retry scenarios.

**Zero-seed budgets:** For all existing categories at migration time, insert a
`category_budgets` row with `amount = 0`.

**Test matrix:**

- Fresh database bootstrap to v6.
- Existing v4 production-shaped DB migration to v6.
- Partially-upgraded DB fixture migration retry to v6 (idempotency path).

**Reference:** See `specs/v0.4-spec.md` Schema v5 Migration Plan for full SQL
and migration timing.

### 5.5 Rules v2 Data Contracts

**v0.4 replaces rules v1 with rules v2.** Unified table for category and tag
rules.

**Schema:**

```sql
CREATE TABLE rules_v2 (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT NOT NULL,
    saved_filter_id TEXT NOT NULL,
    set_category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    add_tag_ids     TEXT NOT NULL DEFAULT '[]',
    sort_order      INTEGER NOT NULL DEFAULT 0,
    enabled         INTEGER NOT NULL DEFAULT 1
);
```

**Rule application semantics:**

1. Rules apply in `sort_order` ascending (manual user ordering).
2. All matching rules fire (not just first match).
3. For each enabled rule, resolve `saved_filter_id` to a saved filter
   expression and evaluate against the transaction.
4. If matched:
   - If `set_category_id != NULL`, set category (last writer wins).
   - If `add_tag_ids` non-empty, add tags (accumulative; add-only policy).
5. After all rules, write final category + tags to DB.

**Target scope:**

- `rules:apply` targets current scope (Manager account filter if active, else
  all transactions).
- `rules:dry-run` uses same target set as `rules:apply`.
- Import-time application targets newly imported row IDs only.

**Disabled rules:** `enabled = 0` rules are skipped in apply and dry-run but
shown in Settings list as dimmed.

**Broken references:** if `saved_filter_id` points to a missing/invalid saved
filter, the rule is skipped in apply/dry-run/import and counted as a failed
rule in summaries. Rules list renders these rows in red.

**Go type:**

```go
type ruleV2 struct {
    id            int
    name          string
    savedFilterID string
    setCategoryID *int
    addTagIDs     []int
    sortOrder     int
    enabled       bool
}
```

**Reference:** See `specs/v0.4-spec.md` Phase 3 for full rules v2 spec, dry-run
command, and Settings UI.

### 5.6 Budget Data Contracts

**v0.4 adds budgeting system.** Category budgets with recurring monthly amounts
+ per-month overrides. Advanced spending targets with filter expressions.

**Category budgets:**

- One `category_budgets` row per category (zero-seeded at migration).
- `amount` is the recurring monthly default.
- `category_budget_overrides` stores per-month overrides (`month_key =
  'YYYY-MM'`).
- Effective amount for a month: check override first, fall back to recurring
  default.

**Spending targets:**

- `spending_targets` table: name, filter expression, amount, period type
  (monthly/quarterly/annual).
- `spending_target_overrides` stores per-period overrides (`period_key =
  'YYYY-MM'`, `'YYYY-Q1'`, or `'YYYY'`).
- Filter expression is strict-validated at save time (same as rules v2).

**Budget calculation:**

For a given month:

1. Get effective budget amount (override or recurring).
2. Calculate spent: `SUM(ABS(amount))` where `amount < 0` (debits only) and
   `date_iso LIKE 'YYYY-MM%'` and category matches.
3. Calculate offsets: `SUM(credit_offsets.amount)` for debits in this category
   + month.
4. Net spent = spent − offsets.
5. Remaining = budgeted − net spent.
6. Over budget = remaining < 0.

**Account scope toggle:** `budgetScopeGlobal bool` (default: true). When false,
budget calculations filter by `m.filterAccounts`.

**Go types:**

```go
type categoryBudget struct {
    id         int
    categoryID int
    amount     float64  // recurring monthly default
}

type budgetOverride struct {
    id       int
    budgetID int
    monthKey string  // "2025-03"
    amount   float64
}

type spendingTarget struct {
    id           int
    name         string
    filterExpr   string
    parsedFilter *filterNode
    amount       float64
    periodType   string  // "monthly", "quarterly", "annual"
}
```

**Reference:** See `specs/v0.4-spec.md` Phase 5 for full budget system spec,
planner view, and analytics strip.

### 5.7 Credit Offset Integrity

**v0.4 adds credit offset tracking** for refunds and reimbursements that reduce
budget spending.

**Schema:**

```sql
CREATE TABLE credit_offsets (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    credit_txn_id  INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
    debit_txn_id   INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
    amount         REAL NOT NULL CHECK(amount > 0),
    CHECK(credit_txn_id != debit_txn_id),
    UNIQUE(credit_txn_id, debit_txn_id)
);
```

**Integrity validation (5 rules):**

`insertCreditOffset` must validate inside one DB transaction:

1. `credit_txn_id` points to a credit transaction (`amount > 0`).
2. `debit_txn_id` points to a debit transaction (`amount < 0`).
3. Both transactions are on the same account.
4. New total linked for credit transaction ≤ available credit amount.
5. New total linked for debit transaction ≤ `ABS(debit amount)`.

If any check fails, no writes occur and a descriptive error is returned.

**Transactional enforcement:** All 5 checks happen in a single transaction.
Partial writes are impossible. This is critical for budget integrity.

**UI flow:**

1. Open detail modal on a credit transaction.
2. Press `o` ("Link Offset").
3. Picker shows debit transactions (same account, ±30 days).
4. Select debit, enter offset amount (default: full credit, capped at
   remaining).
5. Saved to `credit_offsets` after validation.

**Budget impact:** Credit offsets reduce net spent:
`netSpent = spent - SUM(offsets)`.

**Reference:** See `specs/v0.4-spec.md` Phase 5 credit offset flow and
integrity rules.

## 6. Rendering and Viewport Safety

### 6.1 Frame Composition

`View` composes a stable frame:

- header
- body
- status
- footer

All lines are clamped/normalized to viewport width to avoid wraps and geometry
breakage.

### 6.2 Overlay Composition

- Overlays render on top of the same base frame.
- Overlay mechanics should not bypass viewport normalization.
- Modal rendering must remain deterministic across terminal widths.
- Overlay precedence is governed by `overlayPrecedence()` in `dispatch.go`
  (see §3.2). The render layer does not determine priority — it only
  renders the topmost active overlay as determined by the dispatch table.

### 6.3 Table and Section Contracts

- Transaction table supports optional columns based on available data
  (category/account/tags).
- Manager and settings section cards use shared box contracts.
- Footer help is currently registry-sourced via `footerBindings()` →
  `HelpBindings()`. The scope is determined by `activeOverlayScope()` /
  `tabScope()` in `dispatch.go` (see §3.2). Phase 7 will migrate to
  contract-driven footer rendering via `renderFooterFromContract()`.

### 6.4 Dashboard Grid Rendering

**v0.4 dashboard visual structure:**

Top-to-bottom:

1. **Timeframe controls** — chip selector + date range label (carried forward
   from v0.3).
2. **Summary header strip** — non-focusable KPI row showing Balance, Debits,
   Credits, Transaction count, Uncategorised count + amount. Scoped to
   dashboard timeframe + account selection. Uses
   `buildDashboardScopeFilter()`.
3. **4-pane analytics grid** — focusable widget panes in 2×2 layout.

**Grid layout:**

- 2 columns, 2 rows.
- 50:50 column split (each pane gets half the terminal width).
- Panes:
  1. **Net/Cashflow** (top-left, jump key `n`)
  2. **Composition** (top-right, jump key `c`)
  3. **Compare Bars** (bottom-left, jump key `b`)
  4. **Budget Health** (bottom-right, jump key `h`)

**Pane rendering:**

- Each pane has a title, active mode label, and chart/content area.
- Pane renderers (`renderNetCashflowPane`, `renderCompositionPane`, etc.) own
  their internal layout within the allocated width.
- Focused pane gets accent-colored border; unfocused use muted border.

**Mode cycling:**

- `[` / `]` cycle through curated built-in modes + custom modes from config.
- Mode label shown in pane header (e.g., "Net Worth", "Spending", "Renovation
  Spend").

**v0.3 current state:** Dashboard has summary cards and a single spending
tracker chart. No grid, no focusable panes, no mode cycling. Phase 6 adds the
grid.

**Reference:** See `specs/v0.4-spec.md` Phase 6 dashboard v2 spec for full pane
definitions and mode lists.

### 6.5 Narrow Terminal Fallback

**v0.4 responsive layout:** When terminal width < 80 columns, the 2×2 dashboard
grid degrades to a 1-column, 4-row vertical stack.

**Behavior:**

- Each pane renders at full width (no 50:50 split).
- Panes stack vertically in order: Net/Cashflow, Composition, Compare Bars,
  Budget Health.
- Dashboard becomes vertically scrollable.
- Jump mode keys remain the same (`n`, `c`, `b`, `h`).
- Focus model unchanged: jump to a pane, interact, ESC to unfocus.

**v0.3 current state:** No narrow terminal fallback implemented. Phase 6 adds
responsive layout logic to dashboard rendering.

### 6.6 Jump Overlay Rendering

**v0.4 jump mode overlay visual:**

- Floating badges at each focusable section's top-left corner.
- Badge format: `[key]` (e.g., `[n]`, `[c]`, `[b]`, `[h]`, `[t]`, `[a]`).
- Badge style: accent background (`accentBg`), muted foreground (`mutedFg`).
- Status bar reads: "Jump: press key to focus. ESC cancel."
- Badges render on top of the base frame; do not alter underlying layout.

**Focus visual feedback:**

- Focused section: accent-colored border.
- Unfocused sections: default muted border.

**Per-tab badge positioning:**

- Dashboard: badges at top-left of each pane in the 2×2 grid.
- Manager: badges at top-left of Accounts card and Transactions table.
- Budget: badges at top-left of Table view and Planner view (depending on
  active view).
- Settings: badges at top-left of Categories, Tags, Rules, Database, Dashboard Views
  sections.

**v0.3 current state:** No jump overlay. Phase 1 adds jump mode infrastructure
and rendering.

### 6.7 Drill-Return Filter Pill

**v0.4 drill-down with return context:**

When a user drills down from a focused dashboard pane to Manager (presses
`Enter` on a focused pane item like "Groceries" in the category breakdown):

1. Compose filter expression (e.g., `cat:Groceries AND date:2025-01..2025-01`).
2. Save current dashboard state to `drillReturnState` (focused pane, mode,
   scroll).
3. Switch to Manager tab with composed filter applied.
4. Show filter pill in transaction table header with **`[Dashboard >]`
   prefix**: `[Dashboard >] cat:Groceries AND date:2025-01..2025-01`.

**Return behavior:**

- While `drillReturn` is set, ESC from Manager filter view returns to dashboard
  and restores exact state (focused pane, mode, scroll position).
- Any other navigation (tab switch, jump mode to another tab, etc.) clears
  `drillReturn`.
- When `drillReturn` is nil (normal Manager usage), ESC from filter clears the
  filter and stays on Manager (v0.3 behavior).

**Visual indicator:** The `[Dashboard >]` prefix signals "you can ESC to return
to dashboard context."

**v0.3 current state:** No drill-down or return context. Phase 6 adds
drill-down with return.

### 6.8 Budget View Rendering

**v0.4 budget tab rendering:**

Two views toggled with `w` key:

**Table view (default):**

- Month selector in header: `[< Jan >]`.
- Account scope toggle: `[All Accounts ▾]` or `[2 Accounts ▾]`.
- **Category Budgets table:** Category | Budgeted | Spent | Offsets | Remaining
  - Color-coded remaining column: green if positive, red if negative (over
    budget).
  - Total row at bottom.
- **Spending Targets table:** Target | Period | Budgeted | Spent | Remaining
- **Compact analytics strip** (always visible at bottom): Budget adherence %,
  Over-budget count, Variance sparkline.

**Planner view:**

- Year selector in header: `Budget Planner - 2025`.
- 6-month horizontal grid (scrollable).
- Category rows showing budgeted amounts, spent (in parentheses), and remaining
  per month.
- Override marker `*` for months with overrides (differs from recurring
  default).

**Inline editing:**

- `Enter` on a cell activates inline edit mode.
- Numeric input buffer shown in place of cell value.
- `Enter` saves, `Esc` cancels.

**v0.3 current state:** No budget tab. Phase 5 adds budgeting system and all
budget rendering.

**Reference:** See `specs/v0.4-spec.md` Phase 5 for full budget view
specifications.

## 7. Runtime Modes and Harnesses

- `go run .` launches the interactive TUI (TTY required).
- `go run . -validate` runs non-TUI ingest/dupe validation with temp DB/files.
- `go run . -startup-check` validates startup/config/keybinding health.

Harnesses are release gates and must remain reliable in headless CI.

## 8. Testing Strategy and Release Gates

### 8.1 Test Architecture (Three Tiers)

Jaskmoney uses a three-tier test model to avoid "testing theatre" and ensure
user-facing regression protection.

Tier 1: Unit/pure logic (fast)

- Scope: pure functions and deterministic helpers.
- Examples: parsing, sorting/filtering, overlay/string helpers, key name
  normalization.
- Goal: correctness of isolated logic with minimal setup.

Tier 2: Component/integration (fast-medium)

- Scope: subsystem behavior with real dependencies (temp DB/files), but still
  focused per component.
- Examples: DB migrations/CRUD/invariants, ingest duplicate detection,
  rendering width/layout contracts, config migration/parsing.
- Goal: verify contracts at concern boundaries.

Tier 3: Cross-mode user flows (high value)

- Scope: realistic user journeys across tabs, overlays, async commands, and
  persistence.
- Implemented in `flow_test.go` using an `Update`-driven harness.
- Goal: protect real interaction surfaces and prevent regressions caused by
  cross-component coupling.

### 8.2 Tier-3 Flow Harness Contract

Flow tests must follow these rules:

- Drive the app through `model.Update(...)` with real `tea.Msg`/`tea.KeyMsg`.
- Drain returned `tea.Cmd` chains and assert post-command state.
- Prefer assertions on persisted outcomes (DB/config state), not only transient
  status text.
- Avoid direct calls to internal mode handlers (`updateSettings`,
  `updateNavigation`, etc.) in flow tests.

Current high-value flow coverage (v0.3) includes:

- settings import flow with duplicate scan + skip path
- manager quick categorize and quick tag persistence
- command palette import command flow
- settings save + reload persistence round-trip
- detail modal edit/save/reopen persistence
- mapped-account-missing import failure (no partial writes)

**v0.4 additional flow scenarios** (to be added as phases land):

- filter expression: parse → apply → verify filtered rows → clear → verify
  reset
- filter expression: permissive parse (invalid fallback to text) vs strict
  parse (error blocks save)
- saved filter: create → persist to config → reload → apply → verify rows
- rule editor: create rule → dry-run → verify sample rows → apply → verify DB
  changes
- rule editor: create invalid filter expression (strict mode) → save blocked
  with error
- import preview: scan → compact view → toggle full view → raw/post-rules
  toggle → decision → verify imported rows
- import preview: post-rules preview output matches persisted outcomes after
  import (same rule snapshot)
- budget: set category budget → set month override → verify computation
  (debits-only, override priority)
- credit offset: link credit to debit → verify integrity constraints
  (sign/account/allocation) → verify budget net spent reduction
- credit offset: attempt invalid link (wrong sign, cross-account,
  over-allocation) → verify no partial writes, descriptive error returned
- dashboard drill-down: focus pane → drill to Manager with filter → verify
  return context set → ESC returns to dashboard → verify exact state restored
  (focused pane, mode, scroll)
- dashboard drill-down: drill → tab-switch away → verify return context cleared
- jump mode: activate with `v` → press target key → verify focus → ESC →
  verify default focus per tab (Dashboard unfocused, Manager transactions,
  Settings stays)
- custom pane mode: load from config with invalid filter expression → verify
  rejected at load time with actionable error
- dispatch table: new modal has `overlayEntry` at correct priority → verify
  overlay blocks lower-priority scopes and `activeOverlayScope()` returns
  expected scope
- modal text contract: new text-input modal has `modalTextContracts` entry →
  verify `TestModalTextContractCompleteness` and
  `TestModalTextContractConsistency` pass
- contract alignment (Phase 7): `activeInteractionContract()` returns correct
  contract for each reachable state → footer hints match declared intents →
  handler behavior matches declared intents

### 8.3 Heavy Flow Gate (`flowheavy`)

Some higher-fidelity flow tests are intentionally optional to keep default
iteration speed practical.

- Heavy tests are guarded by build tag `flowheavy` (see
  `flow_heavy_test.go`).
- Execute heavy suite with: `go test -tags flowheavy ./...`.
- Default suite (`go test ./...`) remains the primary fast feedback loop.

### 8.4 Local Test Entry Points

Use `scripts/test.sh` for consistent local execution:

- `./scripts/test.sh fast` -> default suite (`go test ./...`)
- `./scripts/test.sh heavy` -> heavy flow suite (`-tags flowheavy`)
- `./scripts/test.sh all` -> runs both fast and heavy suites

The script sets `XDG_CONFIG_HOME` to a writable temp-root by default to keep
tests reliable in sandboxed/headless environments.

### 8.5 Regression Priority Matrix

Protect first:

- modal precedence and dismissal ordering — enforced by `overlayPrecedence()`
  in `dispatch.go`; test with `TestDispatchTableOverlayPrecedenceHasUniqueNames`
- text-input shortcut shielding in all editors — enforced by
  `modalTextContracts` in `dispatch.go`; test with
  `TestModalTextContractCompleteness` and `TestModalTextContractConsistency`
- keybinding scope/action routing and footer derivation — footer scope now
  derives from shared dispatch table via `activeOverlayScope()` / `tabScope()`
- **key conflict invariants (§3.4.11): global shadow audit, scope
  reachability, footer-dispatch alignment, tab/jump key non-shadow**
- **jump mode dispatch ordering (must intercept before tab-level handlers)**
- quick-action target resolution (cursor/selection/highlight)
- import/dupe decision path and account-mapping failures
- viewport-safe header/body/status/footer rendering
- tag normalization and duplicate-merge safety
- **drill-return context lifecycle (set on dashboard drill-down, cleared on
  tab switch, ESC returns correctly)**
- **interaction contract completeness (Phase 7): every scope has a registered
  contract, footer hints are contract-driven, intent-handler alignment tests
  pass**

### 8.6 Standard Verification Commands

Run before release tags:

- `./scripts/test.sh fast`
- `go vet ./...`
- `go run . -validate`
- `go run . -startup-check`

Run additionally when touching cross-mode workflows:

- `./scripts/test.sh heavy`

## 9. Learnings and Decisions

### 9.1 v0.295 → v0.3

This release surfaced concrete engineering lessons:

- Key routing must be explicit per mode.
  - Global tab shortcuts existed but were not processed in settings flow.
  - Fix: route tab shortcuts in settings handler paths too.
- Text entry and shortcut bindings conflict unless guarded.
  - Name-field editing consumed shortcut keys accidentally.
  - Fix: printable-first text handling while focused on name fields.
- Shared primitives reduce divergence, but only with strict contracts.
  - Picker behavior needed explicit create-enable semantics.
  - Fix: `createLabel == ""` disables create rows consistently.
- Data normalization cannot be deferred if UX relies on formatting invariants.
  - Mixed-case tags fragmented behavior.
  - Fix: enforce uppercase on writes and normalize/merge on startup.

Future changes should preserve these decisions unless deliberately superseded.
If superseded, update this section with rationale and enforcement tests.

### 9.2 v0.3 → v0.4

**Status:** Phase 1 and Phase 2 are complete. Phase 3 accepted. Dispatch table
and modal text contracts shipped in `v0.32.3`.

Concrete learnings from shipped work:

- **Hidden command targets are the right compromise for scalability.**
  `filter:apply:<id>` remains command-addressable while the visible palette
  stays compact (`filter:apply` picker), avoiding command-list explosion.
- **Text-input shielding must be explicit per modal/editor.**
  Printable-first handling in filter input and filter-save editor prevents
  shortcut leakage (`:`, `v`, `j`, `k`) and eliminates accidental focus jumps.
- **Picker primitives need stable ordering semantics, not just fuzzy scoring.**
  Recency-first UIs require score-tie preservation of input order; alphabetical
  tie-breaks caused UX regressions until corrected.
- **Width safety belongs in primitives, not callers.**
  ANSI-aware truncation in picker row rendering fixed border overflow for long
  metadata across all picker consumers.
- **Persist mutable UX state separately from declarative config.**
  Saved-filter definitions stay in config, while recency metadata lives in DB
  app-state tables; this avoids high-churn config rewrites and keeps ordering
  stable across sessions.
- **Three consumers of overlay priority must share one data source.**
  `Update()`, `footerBindings()`, and `commandContextScope()` each had their
  own if-chain encoding the same overlay precedence. These drifted silently
  (e.g., `importDupeModal`/`importPicking` order was swapped between two
  consumers). The shared `overlayPrecedence()` table in `dispatch.go` is the
  fix: one table, all consumers read from it.
- **Text input contracts need a data table, not a manual switch.**
  The old `isTextInputModalScope()` switch in `update.go` was easy to forget
  when adding new modals. `modalTextContracts` in `dispatch.go` is the
  replacement: a map keyed by scope with behavior flags (`cursorAware`,
  `printableFirst`, `vimNavSuppressed`). Tests enforce completeness and
  consistency.
- **Form helpers should be composable building blocks, not a framework.**
  `textField` and `modalFormNav` provide cursor-aware text editing and focus
  cycling without imposing a form lifecycle. Modal forms and inline forms have
  different enough lifecycles that a single `FormContext` controller would
  over-constrain the design.
- **Footer bugs are silent regressions.** Three footer bugs (swapped rule
  editor labels, misleading detail modal footer, missing manager modal footer)
  survived multiple releases because no test verified footer content against
  handler behavior. Phase 7's contract-driven footer rendering addresses this
  structurally.

## 10. Open Backlog

**v0.3 carryforward items:**

- Reduce remaining render duplication where behavior is identical.
- Expand mixed-modifier keybinding regression coverage.
- Keep command interfaces and picker interactions aligned as features evolve.
- Continue tightening startup diagnostics and reset/recovery visibility for invalid config/keybinding files.

**v0.4 critical items (must complete as part of Phase 1):**

- Implement global shadow audit and scope reachability tests (§3.4.11
  invariants #2, #3) before adding new scopes. This is the enforcement
  mechanism for preventing accidental key conflicts as scope count grows to
  ~40.
- Footer-dispatch alignment test (§3.4.11 invariant #5): build a model-state
  matrix test or fuzzer to verify `footerBindings()` scope matches `updateXxx`
  scope for all reachable states. Critical for jump mode and focused section
  states. **(v0.32.3 update:** the shared dispatch table in `dispatch.go`
  structurally prevents scope divergence for overlays; the remaining alignment
  risk is in tab sub-states. Phase 7 extends this to full contract-driven
  footer rendering.)

**v0.4 Phase 7 hardening items (v0.39):**

- Implement `InteractionContract` types and `activeInteractionContract()`
  resolver in `dispatch.go` — see `v0.4-spec.md` Phase 7.
- Migrate all footer rendering to `renderFooterFromContract()`.
- Validate intent-handler alignment for all reachable states in flow tests.
- Ensure all Phase 3-6 modals/editors have `overlayEntry` +
  `modalTextContracts` entries before starting Phase 7 contract migration.

**v0.4 Phase 3-6 contract alignment items (ongoing):**

- Every new modal added in Phases 3-6 must follow the checklist in §3.3
  ("Adding a new modal with text input").
- Structure footer hints as key-label pairs to facilitate Phase 7 migration.
- Use `textField` and `modalFormNav` helpers for new form contexts.

**v0.4 performance items:**

- Filter expression performance benchmarking: target p95 <100ms parse+apply on
  10k transactions. Add harness tests in Phase 2. If performance degrades,
  consider memoization or pre-compiled AST caching.
- Budget computation caching strategy: `computeBudgetLines` runs on every
  render. If budget tab becomes sluggish with many categories/targets, add
  memoization keyed on (month, budgets, overrides, transactions hash).

**v0.5+ future considerations:**

- Evaluate per-scope `keybindings.toml` overrides for power users (§3.4.7
  forward-compatibility note). The v2 format's flat `[bindings]` map is
  extensible to `[scopes.budget.bindings]` if demand emerges.
- Dashboard chart primitive abstraction: if adding new panes/modes beyond the 4
  curated domains, extract shared chart rendering logic (`ntcharts` wrappers,
  axis formatting, color mapping) into a `chart.go` primitive file.
- Filter language remains a deliberately constrained subset in v0.4. Consider
  additive Lucene-like extensions in v0.5+ (wildcards/prefix, fuzzy,
  proximity, boosting, unary required/prohibited terms) only after validating
  clear user demand.

## 11. Maintenance Rules for This Document

When architecture changes, update this file in the same commit.

Every architecture edit should answer:

- what changed
- why that decision was made
- what invariant was added/removed
- which tests enforce the behavior

Do not create one-off “progress” architecture files.
Update this reference directly so it remains canonical.
