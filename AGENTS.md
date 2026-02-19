# Repository Guidelines for Agents

## Document Navigation & Specification System

This repository uses one primary implementation spec plus this agent guide.

### Primary Specification

1. **`specs/v0.4-spec.md`** — v0.4 implementation plan and feature specifications
   - **Purpose:** Describes what to build, phase-by-phase implementation order, breaking changes, and acceptance criteria
   - **When to read:** Before starting work on any v0.4 feature; to understand dependencies between phases; to verify acceptance gates
   - **Navigation:** Use the Table of Contents. Each phase is self-contained with schema changes, model changes, files changed, tests, and acceptance criteria
   - **Phase structure:** 7 phases with explicit dependencies (Phase 1 -> Phase 2 -> Phases 3/5 parallel -> Phase 6 -> Phase 7 hardening)

### How to Use These Documents Efficiently

**Starting a new task:**
1. Read the user request to identify behavior change scope
2. Jump to the relevant phase in `specs/v0.4-spec.md`
3. Read the exact subsection tied to the work (schema/model/commands/tests/acceptance)
4. Implement and verify against the phase acceptance checklist

**Don’t read linearly:** Use the TOC to jump directly to relevant sections.

## Project Structure & Module Organization

This is a Go TUI application built with Bubble Tea. All source files live in a single `package main`, organized by concern.

**Current structure (v0.3 baseline):**
- ~35 files, ~19,500 LOC
- 3 tabs: Manager (accounts + transactions), Dashboard, Settings
- Schema v4: categories, tags, rules v1, accounts, transactions, imports

**v0.4 target structure:**
- ~39 files (adds `filter.go`, `budget.go`, `widget.go`, `update_budget.go`)
- 4 tabs: Dashboard, Budget, Manager, Settings (tab order changes)
- Schema v5+: rules v2 (unified), budget tables, credit offsets

### Where New Code Should Go

Quick reference:
- **New filter logic** -> `filter.go`
- **New budget calculations** -> `budget.go`
- **New dashboard widgets/modes** -> `widget.go`
- **New database queries or migrations** -> `db.go`
- **New UI rendering** -> `render.go`
- **New Bubble Tea messages/commands/model fields** -> `app.go`
- **New keybindings/scopes/dispatch contracts** -> `keys.go`, `dispatch.go`
- **New commands** -> `commands.go`

When the project outgrows flat structure (~25k LOC or 50+ files), migrate to:
```text
cmd/jaskmoney/main.go    - entrypoint
internal/tui/            - app, update handlers, render
internal/db/             - database access
internal/ingest/         - CSV/file import
internal/filter/         - filter expression system
internal/budget/         - budget computation
```

## Core Architectural Principles

1. **Single mutable state root:** `model` is the only source of truth. Mutate state in `Update` paths only.
2. **Pure rendering:** `View()` is read-only. No I/O, no side effects.
3. **Message-driven async:** All I/O happens via `tea.Cmd`; async results return typed `xxxMsg`.
4. **Modal precedence:** Topmost overlay wins. Add overlays through `overlayPrecedence()` in `dispatch.go` so update/footer/command-scope stay aligned.
5. **Text input safety:** Printable keys are literal text in text-input contexts. `modalTextContracts` in `dispatch.go` is the source of truth.
6. **Action-first key handling:** Resolve keys by action (`m.isAction`, `m.verticalDelta`, `m.horizontalDelta`), not raw key string checks.
7. **Keybinding model:** Scopes are flat in storage, hierarchical in dispatch; actions are stable, keys are overrideable.

## Testing Strategy

### Three-Tier Test Model

1. **Unit/pure logic (fast):** Parsing, sorting, helpers
2. **Component/integration (fast-medium):** DB CRUD, CSV parsing, rendering contracts
3. **Cross-mode flows (high value):** Realistic `Update(...)`-driven user journeys via flow tests

### Quality Bar

- **For user-visible behavior changes:** Add at least one `Update(...)`-driven regression test
- **Prefer persisted outcomes:** DB rows, config writes, and message effects over status-text-only checks
- **For transactional paths:** Add rollback/failure tests proving no partial writes
- **For bug fixes:** Add a regression test that fails pre-fix
- **Use `flowheavy` tag** for expensive flows

### Test Commands

```bash
go test ./...                      # Fast default suite
go test -tags flowheavy ./...     # Heavy flow suite
./scripts/test.sh fast|heavy|all  # Consistent local entry points
go run . -validate                # Non-TUI validation harness
go run . -startup-check           # Config/keybinding health check
```

## Build, Test, and Development Commands

```bash
go run .
go run . -validate
go run . -startup-check
go build .
go test ./...
go test -tags flowheavy ./...
go test -run TestName ./...
go vet ./...
gofmt -w .
./scripts/test.sh fast|heavy|all
```

## Agent-TUI Quick Guide

Use `agent-tui` to drive `jaskmoney` in an automated terminal session.

- Start with help and discoverability first:
  - `agent-tui -h`
  - `agent-tui <subcommand> --help` (for example `agent-tui press --help`)
- Recommended flow (default): no-rebuild loop (`go run`)
  - Initial launch:
  - `agent-tui run -d $(pwd) go run .`
  - Iteration after code changes:
  - `agent-tui restart` (or relaunch with a fresh `agent-tui run -d $(pwd) go run .` session)
  - `agent-tui restart` creates a new session ID each time. It also makes the new session active, so follow-up commands can omit `-s` unless you intentionally target a different session.
  - Optional explicit targeting when needed:
  - `agent-tui sessions`
  - `agent-tui sessions switch <session-id>`
  - `agent-tui resize -s <session-id> --cols 140 --rows 44`
  - `agent-tui screenshot -s <session-id>`
- Required fallback when no-rebuild is unstable: rebuild loop
  - Initial launch:
  - `go build .` (critical)
  - `agent-tui run $(pwd)/jaskmoney`
  - Iteration after code changes:
  - `go build .` (critical, every change cycle)
  - `agent-tui restart`
- Switch from no-rebuild to rebuild flow immediately when any of these happen:
  - `agent-tui restart` returns a new session that is `stopped`.
  - The app does not reflect a code change after restart/relaunch.
  - Session churn/confusion makes it unclear which process is active.
  - You need consistent, repeatable screenshots or interaction automation.
- Interaction primitives:
  - `agent-tui press -s <session-id> <KEY...>` for navigation/actions
  - You can send multiple keys in one call, for example: `agent-tui press ArrowDown ArrowDown Enter`
  - `agent-tui type -s <session-id> "<text>"` for literal input
  - `agent-tui live -s <session-id>` for live endpoint info
  - If text does not appear in a modal/input, prefer per-key entry via `agent-tui press ...` (for example `w o o l w o r t h s`); `agent-tui type` still works in many contexts
- Navigation reliability tips:
  - Screenshot often (`agent-tui screenshot`) after tab/scope/modal changes to confirm actual state before the next action
  - Prefer direct jumps over sequential tabbing: use numeric tab shortcuts (`1`..`4`) and jump mode (`v` then target key such as `a` for Accounts)
  - Use footer hints as the source of truth for active-scope actions before sending keys

What was successfully tested and observed:
- Build completed with `go build .`.
- `agent-tui run -d $(pwd) go run .` can start a live session for no-rebuild iteration.
- App launched under `agent-tui run`.
- Screenshot capture worked and showed full rendered tab content.
- `120x40` could clip the lower Dashboard area in screenshots.
- `140x44` captured full Dashboard panels and footer consistently (recommended baseline for docs/screenshots).
- `Tab` navigation moved through Dashboard -> Budget -> Manager -> Settings.
- Footer hints changed with tab/scope as expected.
- `Ctrl+K` opened the command palette; `Enter` executed the selected command and returned to the tab view.
- `agent-tui sessions switch <id>` correctly changed the active session when multiple sessions were running.
- A single `agent-tui press ArrowDown ArrowDown Enter` command executed all keys in sequence.

Known screenshot caveats:
- Dashboard sparkline/chart regions use braille characters; terminal screenshots may not render these perfectly even when layout is correct.
- For documentation captures, prefer checking section borders/labels/footer state over exact braille glyph fidelity.

Daemon connectivity fallback:
- If you hit `Error: Failed to connect to daemon: Connection refused (os error 111)`, immediately ask the human to start it manually with `agent-tui daemon start`, then continue.

## Coding Style & Naming Conventions

- Follow idiomatic Go and keep code `gofmt`-clean
- Use tabs (Go default); do not manually align with spaces
- Exported identifiers: `PascalCase`; unexported: `camelCase`
- Keep functions small and single-purpose; use early returns for errors
- Wrap errors with context: `fmt.Errorf("load CSV: %w", err)`
- Use Go builtins (`min`, `max`) instead of custom versions (Go 1.21+)
- Use ASCII unless file-local conventions require otherwise

## Bubble Tea Conventions

### Model
- `model` in `app.go` is the source of truth for UI state
- Keep model fields grouped and explicit
- Never mutate model state outside `Update`

### Messages (`Msg`)
- Async result types are `xxxMsg` (lowercase, unexported)
- Include `err` in async result messages when relevant
- Handlers check `err` first

### Commands (`Cmd`)
- Command constructors are `xxxCmd` and return `tea.Msg`
- Keep command code in owning concern file (`db.go`, `ingest.go`, etc.)
- Pass required values explicitly; avoid closing over mutable model state

### View
- `View()` composes from pure render functions in `render.go`
- Layout math belongs on `model`
- Styles are package-level vars, not inline styles

## Implementation Inventory

Use this as the concise source of available primitives and reusable function surfaces.

### Interaction primitives

| Component | Key APIs | Capabilities | Primary use-cases |
|---|---|---|---|
| Overlay dispatch table (`dispatch.go`) | `overlayPrecedence`, `dispatchOverlayKey`, `activeOverlayScope`, `tabScope`, `settingsTabScope` | Single source of truth for modal precedence and scope routing | Add/modify modal priority, keep update/footer/command scope aligned |
| Modal text contracts (`dispatch.go`) | `modalTextContracts`, `isTextInputModalScopeFromContract` | Per-scope text safety (`printableFirst`, cursor-aware editing, vim-nav suppression) | Any modal or inline editor with text input |
| Cursor-aware text field (`dispatch.go`) | `textField.handleKey`, `textField.render`, `textField.set` | Cursor-positioned ASCII insertion/deletion and rendering | Rule/filter/settings/modal text fields |
| Modal form navigator (`dispatch.go`) | `modalFormNav.handleNav` | Standard `up/down/tab/shift+tab` field focus cycling | Multi-field modal forms |
| Generic picker (`picker.go`) | `newPicker`, `pickerState.HandleMsg`, `SetTriState`, `PendingTagPatch`, `HasPendingChanges`, `renderPicker` | Fuzzy filtering, sectioned lists, single/multi-select, tri-state patching, inline create row | Category/tag pickers, saved-filter apply picker, manager account action picker, offset debit picker |
| Command system (`commands.go`) | `CommandRegistry.Search`, `ExecuteByID` | Scope-aware command discovery/execution; disabled reason handling | Command palette, colon mode, action routing |
| Jump targeting (`update.go`, `update_manager.go`, `update_dashboard.go`) | `jumpTarget` model + jump overlay dispatch/render path | Cross-tab section focus via single-key overlay targets | Fast section navigation and focus-mode entry |

### Rendering functions

| Surface | Key functions | Capabilities | Primary use-cases |
|---|---|---|---|
| Shared frame/sections (`render.go`) | `renderHeader`, `renderSectionBox`, `renderTitledSectionBox`, `renderModalContent` | Consistent top-level frame and boxed sections | Tab shells, modal containers, reusable boxed UI |
| Command UI (`render.go`) | `renderCommandPalette`, `renderCommandSuggestions`, `renderCommandLinesWindow`, `renderWrappedCommandMatchLines` | Palette/modal rendering with wrapped descriptions and scrolling windows | `ctrl+k` palette and `:` command mode |
| Jump UI (`render.go`) | `renderJumpOverlay` | Floating key badges and jump status surface | App-wide jump mode |
| Import preview (`render.go`) | `renderImportPreview`, `renderImportPreviewCompact`, `renderImportPreviewTable` | Snapshot summary, parse diagnostics, post-rules preview table | Import decision flow |
| Transactions + tags (`render.go`) | `renderTransactionTable`, `renderCategoryTagOnBackground`, `renderTagsOnBackground` | Table layout with optional columns and tag/category styling | Manager transactions, preview parity surfaces |
| Dashboard analytics (`render.go`) | `renderSummaryCards`, `renderCategoryBreakdown`, `renderSpendingTrackerWithRange`, timeframe controls helpers | KPI cards, category composition, trend charts, timeframe controls | Dashboard tab |
| Settings/manager/detail modals (`render.go`) | `renderSettingsContent`, `renderSettingsCategories`, `renderSettingsTags`, `renderSettingsRules`, `renderManagerAccountModal`, `renderFilterEditorModal`, `renderRuleEditorModal`, `renderDryRunResultsModal`, `renderDetailWithOffsets` | Section-specific editors and detail workflows | Settings forms, rule workflows, transaction detail/offset UX |
| Budget surfaces (`render.go`) | `renderBudgetTable`, `renderBudgetCategoryTable`, `renderBudgetTargetTable`, `renderBudgetPlanner`, `renderBudgetAnalyticsStrip`, `renderBudgetVarianceSparkline` | Budget table/planner views, target rows, analytics strip and variance sparkline | Budget tab |

### Logical/data functions

| Domain | Key functions | Capabilities | Primary use-cases |
|---|---|---|---|
| Filter language (`filter.go`) | `parseFilter`, `parseFilterStrict`, `evalFilter`, `renderFilterNode` | AST parsing (permissive/strict), row evaluation, canonical filter string rendering | Interactive filter input, saved filters, rules/targets validation |
| Budget compute (`budget.go`) | `parseMonthKey`, `computeBudgetLines`, `computeTargetLines` | Scoped month/period math, debit/offset aggregation, raw vs effective spend projections | Budget tab metrics and target evaluation |
| Budget + offset storage (`db.go`) | `loadCategoryBudgets`, `upsertCategoryBudget`, `loadBudgetOverrides`, `upsertBudgetOverride`, `loadSpendingTargets`, `upsertTargetOverride`, `loadCreditOffsets`, `indexCreditOffsets`, `insertCreditOffset` | Persistent budget/override/target CRUD and validated offset linking | Budget editing, target maintenance, offset integrity |
| Rules v2 (`db.go`) | `loadRulesV2`, `insertRuleV2`, `updateRuleV2`, `deleteRuleV2`, `applyRulesV2ToScope`, `applyRulesV2ToTxnIDs`, `dryRunRulesV2` | Saved-filter referenced rule CRUD and deterministic apply/dry-run behavior | Settings rules editor, import-time rule application |
| Import ingest + preview (`ingest.go`) | `scanDupesCmd`, `buildImportPreviewSnapshot`, `parseImportPreviewRows`, `ingestSnapshotCmd`, `parseDateISO`, `parseAmount` | Parse/normalize CSV rows, duplicate detection, snapshot-driven import path | Import preview and commit flow |
| Core transaction/category/tag/account CRUD (`db.go`) | `loadRows`, `loadRowsForAccountScope`, `loadRowsByTxnIDs`, `updateTransactionCategory`, `updateTransactionDetail`, `loadCategories`, `insertCategory`, `loadTags`, `insertTag`, `loadAccounts`, `insertAccount` | Main data access layer for manager/settings flows | Manager operations, settings CRUD, scoped data refresh |

## Status Handling

- Render status through `renderStatus(text, isErr)`
- Use `setError(...)` for errors (`statusErr=true`)
- Set `statusErr=false` for informational status

## CSV Formats & Config

- Formats live in `~/.config/jaskmoney/formats.toml`
- `loadFormats` creates defaults if missing
- `parseFormats` validates required fields (`name`, `date_format`)
- `findFormat` is case-insensitive
- `detectFormat` prefers filename prefix, falls back to first format

## External Reference

- Bagels reference repo: `/home/jask/bagels-ref`
- Spending tracker parity: `src/bagels/components/modules/spending/`
- Jump mode reference: `src/bagels/components/jumper.py`

## Quality & Safety Checks

- Avoid silent error drops in I/O and DB paths
- Keep comments aligned with behavior
- Remove dead code promptly
- Update tests and docs when behavior changes

## Security & Configuration Tips

- Never commit API keys, personal financial data, or local DB files
- Treat CSV input as untrusted; validate parse failures explicitly
- Use DB transactions for multi-row mutations

## Common Pitfalls & Gotchas

1. **Keybinding conflicts:** Keep shadowing intentional. Maintain global-shadow and scope-reachability tests when adding scopes.
2. **Generic action consistency:** Use `space` for toggle, `a` for add, `del` for delete, `enter` for select/edit, `esc` for cancel/back.
3. **Text input safety:** Any new text-input scope must be represented in `modalTextContracts`.
4. **Modal precedence:** New modal states must be inserted into `overlayPrecedence()` at the correct priority.
5. **Filter contexts:** Use permissive parsing for interactive `/` input and strict parsing for persisted surfaces (rules/targets/saved filters).
6. **Transactional integrity:** Credit offset insertions must validate sign/account/allocation atomically.
7. **Dashboard scope isolation:** Dashboard default panes use timeframe + account scope only; no transaction filter inheritance.
8. **Drill-return lifecycle:** `drillReturnState` is cleared on navigation away from Manager.
9. **Multi-field modal forms:** Support `tab`/`shift-tab` field cycling.
10. **Action-based dispatch:** Avoid raw key-name branching in handlers.
11. **Footer hints:** Show actionable commands, not generic navigation keys.
12. **Shifted single-letter bindings:** Uppercase letters surface as `S-<key>` in footer help.
13. **Pane selection vs focus:** Preserve selected pane on tab return, but do not auto-focus pane interactions.

## Agent Best Practices

1. Check `specs/v0.4-spec.md` before asking clarifying questions.
2. Use TOC-driven navigation.
3. Follow phase acceptance criteria exactly.
4. For new behavior, update docs in the same change (`AGENTS.md` and any affected `specs/v0.4-spec.md` section).
5. Keep changes scoped and test-backed.

## Quick Reference: Where to Look

| Need to understand... | Check... |
|---|---|
| Overlay dispatch table | `dispatch.go` (`overlayPrecedence`, `dispatchOverlayKey`, `activeOverlayScope`) |
| Modal text input contracts | `dispatch.go` (`modalTextContracts`) |
| Command system | `commands.go` + `specs/v0.4-spec.md` Phase 1 |
| Filter expression language | `filter.go` + `specs/v0.4-spec.md` Phase 2 |
| Rules v2 | `db.go`, `update_settings.go` + `specs/v0.4-spec.md` Phase 3 |
| Import preview flow | `ingest.go`, `update_manager.go` + `specs/v0.4-spec.md` Phase 4 |
| Budget system | `budget.go`, `update_budget.go` + `specs/v0.4-spec.md` Phase 5 |
| Credit offsets | `db.go`, `update_detail.go` + `specs/v0.4-spec.md` Phase 5 |
| Dashboard drill-return/focus | `update_dashboard.go`, `render.go` + `specs/v0.4-spec.md` Phase 6 |
| Interaction contract layer | `dispatch.go` + `specs/v0.4-spec.md` Phase 7 |
| Testing strategy and verification | `specs/v0.4-spec.md` Verification + repository test commands |

---

When in doubt, implement to the relevant phase contract and acceptance checklist.
