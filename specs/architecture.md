# Jaskmoney Architecture Reference

This document is the persistent architecture baseline for the project. It is
intended to stay current and act as the source of truth for structure,
invariants, and evolution decisions.

## 1. Purpose and Scope

Jaskmoney is a Bubble Tea-based TUI financial manager with:

- account-scoped transaction browsing and editing
- CSV import with format detection and duplicate handling
- dashboard analytics (summary, category breakdown, spend tracker)
- settings/editor flows for categories, tags, rules, chart options, and DB ops

This document covers architecture and maintenance conventions, not end-user
feature docs.

## 2. Current Topology

Runtime and ownership boundaries:

- `main.go`: CLI entrypoint and mode selection (`TUI`, `-validate`,
  `-startup-check`).
- `app.go`: model definition, `Init`, `View`, shared frame/layout helpers.
- `update.go`: top-level message routing and shared state helpers.
- `update_manager.go`: manager tab and account modal interactions.
- `update_transactions.go`: table navigation, selection, search, quick actions.
- `update_dashboard.go`: timeframe controls and custom range entry.
- `update_detail.go`: transaction detail modal interactions.
- `update_settings.go`: settings nav, edit modes, confirms, import entry point.
- `render.go`: all visual output and composable render primitives.
- `db.go`: schema, migrations, and transactional data operations.
- `ingest.go`: import scan/dupe/import command pipeline.
- `config.go`: app/config/keybinding parsing and validation.
- `keys.go`: key registry, scopes/actions, binding resolution.
- `overlay.go`: width-aware line utilities and overlay compositing.
- `validate.go`: non-TUI harnesses (`-validate`, startup diagnostics support).

## 3. Core Architectural Invariants

### 3.1 State and Update

- Single mutable state root: `model`.
- Model mutation happens through `Update` paths only.
- I/O and side effects happen via `tea.Cmd`, never inline in `View`.
- Async results return typed `xxxMsg` messages and are handled centrally.

### 3.2 Mode Partitioning

Update logic is split by concern to keep each mode testable and bounded:

- root dispatcher in `update.go`
- tab/mode handlers in `update_*.go`

No handler should depend on hidden tab side effects from another mode.

### 3.3 Rendering and Viewport Safety

- `View` composes a fixed frame: header + body + status + footer.
- Chrome lines (header/status/footer) are width-clamped to avoid terminal wraps.
- Body lines are normalized to viewport width before final output.
- Overlay rendering is layered on the same base frame to keep modal/non-modal
  behavior consistent.
- Section boxes consume full viewport width in their placement path; no forced
  outer gutter assumptions.

### 3.4 Status Semantics

- Errors must use `setError`.
- Non-error informational updates must use `setStatus`/`setStatusf`.
- `statusErr` should always match the rendered status style intent.

### 3.5 Config and Keybindings

- Key behavior is action/scope-driven through `KeyRegistry`.
- Unknown config actions should produce actionable diagnostics.
- Backward-compatible aliases are parsed at config load boundaries.

## 4. Data and Flow Boundaries

### 4.1 Import Flow

Settings-initiated only:

1. scan files
2. pick file
3. scan duplicates
4. choose duplicate strategy
5. import transactionally
6. refresh state

Duplicate identity key remains `(date_iso, amount, description)`.

### 4.2 DB Mutations

- Multi-step updates must be transactional.
- Schema evolution is versioned and migration-backed.
- Clearing operations preserve intended non-transaction entities where required.

## 5. Testing Strategy

### 5.1 Coverage Model

- Table-driven tests for parsing/filtering/sorting logic.
- Command/message tests for update handlers.
- Rendering invariants for viewport safety and layout regressions.
- Startup harness tests for config/keybinding diagnostics.

### 5.2 Regression Priorities

Protect these first when modifying architecture:

- manager/dash/settings navigation contracts
- keybinding scope-action resolution
- confirm flows and cancellation semantics
- import+dupe decision pipeline
- header/body/status/footer viewport invariants

## 6. Architectural Improvements Since v0.26 Baseline

These changes are now part of the baseline architecture:

- update system decomposed from monolithic `update.go` into focused files
- typed settings confirm actions and central confirm metadata
- shared settings/edit helpers to reduce duplicated transitions
- shared modal content rendering patterns
- keybinding-driven hints replacing hardcoded modal key text
- startup diagnostics harness and CI integration
- stronger viewport-safe rendering invariants and tests
- expanded regression test suite for helper utilities and mode interactions

## 7. Open Architectural Backlog

- Continue reducing render duplication where behavior is identical across panes.
- Add broader mixed-modifier keybinding regression cases.
- Maintain explicit layout contracts for chart/table interactions.
- Keep startup diagnostics strict while preserving documented compatibility
  aliases.

## 8. Maintenance Rules for This Document

When architecture changes, update this file in the same commit. Prefer:

- what changed
- why the decision was made
- what invariant was added/removed
- which tests enforce the behavior

If a section becomes stale, update it immediately instead of adding one-off
"progress" docs.
