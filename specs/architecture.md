# Jaskmoney Architecture Reference

This document is the persistent architecture baseline for the project. Keep it
current. It is the source of truth for structure, invariants, and evolution
decisions.

## 1. Purpose and Scope

Jaskmoney is a Bubble Tea-based TUI personal-finance manager focused on:

- account-scoped transaction browsing and editing
- CSV import with format detection and duplicate handling
- dashboard analytics (summary, category breakdown, spend tracker)
- settings/editor workflows for categories, tags, rules, chart options, and DB
  operations
- command-first interaction (key bindings + command interfaces)

This document is about implementation architecture and engineering conventions,
not end-user feature docs.

## 2. Runtime Topology and Ownership

Runtime boundaries and owning files:

- `main.go`: CLI mode routing (`TUI`, `-validate`, `-startup-check`).
- `app.go`: model shape, `Init`, `View`, shared layout/frame helpers.
- `update.go`: top-level message dispatcher and cross-cutting helpers.
- `update_manager.go`: manager tab and account modal behavior.
- `update_transactions.go`: transaction list navigation/search/sort/filter and
  quick actions.
- `update_dashboard.go`: dashboard timeframe interactions.
- `update_detail.go`: transaction detail modal interaction logic.
- `update_settings.go`: settings navigation, editor modes, confirm logic,
  import entry points.
- `render.go`: all rendering and style composition.
- `db.go`: schema lifecycle and transactional DB operations.
- `ingest.go`: import scanning, duplicate scanning, import execution pipeline.
- `config.go`: format/settings/keybinding parsing, validation, migration.
- `keys.go`: action/scope key registry and lookup.
- `picker.go`: reusable fuzzy picker primitive for overlay workflows.
- `overlay.go`: width-aware string utilities and overlay compositing.
- `validate.go`: headless validation/startup harnesses.

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

`update.go` defines authoritative key precedence. Topmost overlay wins.

Current precedence order:

1. command UI
2. detail modal
3. duplicate modal
4. file picker
5. category picker
6. tag picker
7. account nuke picker
8. manager account modal
9. search mode
10. command-open shortcuts
11. settings or main/tab routing

Contract:

- `Esc` closes the topmost active overlay/modal state.
- No lower-priority state may process a key while a higher-priority state is
  active.

### 3.3 Text Input Safety Contract

For settings add/edit name fields (category and tag):

- Printable keys are treated as literal text first.
- While name field is focused, printable keys must not trigger shortcuts.
  Example keys: `q`, `s`, `h`, `j`, `k`, `l`.
- `enter` = save, `esc` = cancel, `backspace` = delete.
- Non-printable navigation keys (e.g. arrow keys) may move focus between
  fields.

This prevents accidental saves/quits or color/scope changes while typing names.

### 3.4 Keybinding Contract

- Key behavior is action/scope driven through `KeyRegistry`.
- Footer hints derive from registry bindings, not hardcoded strings.
- Primitive movement actions are canonical:
  - `up`, `down`, `left`, `right`
  - legacy names (`navigate`, `column`, `color`, `section`, `select_item`) are
    compatibility aliases only.
- Global direct tab shortcuts are first-class:
  - `1` -> Manager (transactions mode)
  - `2` -> Dashboard
  - `3` -> Settings
- Tab shortcuts must work from settings navigation and active-settings contexts,
  not only from top-level tab routing.

Recommended `keybindings.toml` structure:

- Keep runtime override input as one flat `[bindings]` action map (current
  implementation) to avoid sparse per-scope table sprawl.
- Treat primitive actions as universal semantic keys:
  - `confirm`, `cancel`, `up`, `down`, `left`, `right`, `delete`
- Keep scope-specific actions only where semantics are context-exclusive
  (`import`, `apply_all`, `nuke_account`, etc.).
- Scope routing remains in code (`keys.go`), while the TOML remains a compact
  action override layer.

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
- Section order follows input item order.
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

### 6.3 Table and Section Contracts

- Transaction table supports optional columns based on available data
  (category/account/tags).
- Manager and settings section cards use shared box contracts.
- Footer help remains registry-sourced.

## 7. Runtime Modes and Harnesses

- `go run .` launches the interactive TUI (TTY required).
- `go run . -validate` runs non-TUI ingest/dupe validation with temp DB/files.
- `go run . -startup-check` validates startup/config/keybinding health.

Harnesses are release gates and must remain reliable in headless CI.

## 8. Testing Strategy and Release Gates

### 8.1 Coverage Model

- Pure logic: table-driven unit tests.
- Update behavior: message/key-flow tests.
- Rendering: layout and viewport invariants.
- DB: schema, transactional behavior, migration/hygiene.
- Harnesses: startup and validation behavior.

### 8.2 Regression Priority Matrix

Protect first:

- modal precedence and dismissal ordering
- text-input shortcut shielding in settings editors
- keybinding scope/action routing and footer derivation
- quick-action target resolution (cursor/selection/highlight)
- import/dupe decision path
- viewport-safe header/body/status/footer rendering
- tag normalization and duplicate-merge safety

### 8.3 Standard Verification Commands

Run before release tags:

- `go test ./...`
- `go vet ./...`
- `go run . -validate`
- `go run . -startup-check`

## 9. v0.295 -> v0.3 Learnings and Decisions

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

## 10. Open Backlog

- Reduce remaining render duplication where behavior is identical.
- Expand mixed-modifier keybinding regression coverage.
- Keep command interfaces and picker interactions aligned as features evolve.
- Continue tightening startup diagnostics and compatibility alias handling.

## 11. Maintenance Rules for This Document

When architecture changes, update this file in the same commit.

Every architecture edit should answer:

- what changed
- why that decision was made
- what invariant was added/removed
- which tests enforce the behavior

Do not create one-off “progress” architecture files.
Update this reference directly so it remains canonical.
