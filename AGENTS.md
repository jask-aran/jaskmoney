# Repository Guidelines for Agents

## Document Navigation & Specification System

This repository uses a two-tier specification system to guide development:

### Primary Specifications

1. **`specs/architecture.md`** — Implementation architecture and engineering conventions
   - **Purpose:** Describes *how* systems work, invariants, patterns, and testing strategy
   - **When to read:** Before implementing any feature; when debugging architectural issues; when adding new files or subsystems
   - **Navigation:** Use the Table of Contents at the top. Each section is MECE (mutually exclusive, collectively exhaustive) — if you need to understand keybindings, go to §3.4; if you need data layer contracts, go to §5
   - **Dual-purpose writing:** Describes both v0.4 target architecture and current v0.3 state with annotations like "(v0.3: ...)" and "(v0.4: ...)"

2. **`specs/v0.4-spec.md`** — v0.4 implementation plan and feature specifications
   - **Purpose:** Describes *what* to build, phase-by-phase implementation order, breaking changes, and acceptance criteria
   - **When to read:** Before starting work on a v0.4 feature; to understand dependencies between phases; to see the full scope of v0.4 changes
   - **Navigation:** Use the Table of Contents. Each phase is self-contained with schema changes, model changes, files changed, tests, and acceptance criteria
   - **Phase structure:** 6 phases with explicit dependencies (Phase 1 → Phase 2 → Phases 3/5 parallel → Phase 6)

### How to Use These Documents Efficiently

**Starting a new task:**
1. Read the user's request to understand what needs to be built/fixed
2. Check `specs/v0.4-spec.md` TOC to see if it's part of a v0.4 phase
3. Check `specs/architecture.md` TOC for relevant sections (e.g., §4 for interaction primitives, §5 for data layer)
4. Read the specific sections — use grep or direct navigation via TOC anchors

**Example workflow for "Add filter expression parser":**
1. `specs/v0.4-spec.md` Phase 2 → full spec including grammar, AST, parser contracts
2. `specs/architecture.md` §4.4 → architecture of filter language, permissive vs strict contexts
3. `specs/architecture.md` §5.5 → how rules use filters (downstream consumer)
4. Implement, then verify against acceptance criteria in spec

**Don't read linearly:** Use TOCs to jump directly to relevant sections. Both documents are designed for random access.

### Cross-References

When the spec says "See `architecture.md` §3.4", use the TOC to jump to that section. When architecture says "See `v0.4-spec.md` Phase 2", jump to that phase in the spec TOC.

## Project Structure & Module Organization

This is a Go TUI application built with the Bubble Tea framework. All source files live in a single `package main`, organized by concern.

**Current structure (v0.3):**
- ~35 files, ~19,500 LOC
- 3 tabs: Manager (accounts + transactions), Dashboard, Settings
- Schema v4: categories, tags, rules v1, accounts, transactions, imports

**v0.4 target structure:**
- ~39 files (adds `filter.go`, `budget.go`, `widget.go`, `update_budget.go`)
- 4 tabs: Dashboard, Budget, Manager, Settings (tab order changes!)
- Schema v5: rules v2 (unified), budget tables, credit offsets

For detailed file ownership, see `specs/architecture.md` §2.

### Where New Code Should Go

**Refer to `specs/architecture.md` §2 for authoritative file ownership.**

Quick reference:
- **New filter logic** → `filter.go` (v0.4)
- **New budget calculations** → `budget.go` (v0.4)
- **New dashboard widgets/modes** → `widget.go` (v0.4)
- **New database queries or migrations** → `db.go`
- **New UI rendering** → `render.go`
- **New Bubble Tea messages/commands/model fields** → `app.go` (was `model.go`)
- **New keybindings/scopes** → `keys.go`
- **New commands** → `commands.go`

When the project outgrows flat structure (~25k LOC or 50+ files), migrate to:
```
cmd/jaskmoney/main.go    — entrypoint
internal/tui/             — app, update handlers, render
internal/db/              — database access
internal/ingest/          — CSV/file import
internal/filter/          — filter expression system
internal/budget/          — budget computation
```

## Core Architectural Principles

**Read `specs/architecture.md` §3 (Core Invariants) for full details.** Key principles:

1. **Single mutable state root:** `model` is the only source of truth. Mutate only in `Update` paths.
2. **Pure rendering:** `View()` is read-only. No I/O, no side effects.
3. **Message-driven async:** All I/O happens via `tea.Cmd`. Commands return `tea.Msg`.
4. **Modal precedence:** Topmost overlay wins. See `architecture.md` §3.2 for dispatch chain.
5. **Text input safety:** Printable keys are literal text in input contexts, not shortcuts. See `architecture.md` §3.3.
6. **Keybinding architecture:** Scopes are flat in storage, hierarchical in dispatch. Actions are stable; keys are variable. See `architecture.md` §3.4.

## Testing Strategy

**Read `specs/architecture.md` §8 for full testing strategy.**

### Three-Tier Test Model

1. **Unit/pure logic (fast):** Pure functions, parsing, sorting, string helpers
2. **Component/integration (fast-medium):** DB CRUD, CSV parsing, rendering contracts with temp dependencies
3. **Cross-mode flows (high value):** Realistic user journeys via `Update`-driven harness in `flow_test.go`

### Quality Bar (Anti-Theatre)

- **For any user-visible behavior change:** Add at least one `Update(...)`-driven regression test
- **Prefer persisted-outcome assertions:** DB rows, config files, message effects (not just status text)
- **For transactional paths:** Include rollback/failure test proving no partial writes
- **When a bug is fixed:** Add regression test that fails on pre-fix behavior
- **Place heavier tests behind `flowheavy` tag** when runtime cost is notable

### Test Commands

```bash
go test ./...                      # Fast default suite
go test -tags flowheavy ./...     # Heavy flow suite
./scripts/test.sh fast|heavy|all  # Consistent local entry points
go run . -validate                 # Non-TUI validation harness
go run . -startup-check            # Config/keybinding health check
```

## Build, Test, and Development Commands

Use standard Go tooling from the repo root:

```bash
go run .                           # Run TUI app locally
go run . -validate                 # Non-TUI validation (temp DB + CSV)
go run . -startup-check            # Validate startup/config/keybindings
go build .                         # Compile and verify binary builds
go test ./...                      # Run default test suite
go test -tags flowheavy ./...     # Run heavy flow tests
go test -run TestName ./...        # Run focused test
go vet ./...                       # Static analysis
gofmt -w .                         # Format source files
./scripts/test.sh fast|heavy|all  # Test entry points with temp config
```

## Coding Style & Naming Conventions

- Follow idiomatic Go and keep code `gofmt`-clean
- Use tabs (Go default); do not manually align with spaces
- Exported identifiers: `PascalCase`; unexported: `camelCase`
- Keep functions small and single-purpose; prefer early returns for errors
- Wrap errors with context: `fmt.Errorf("load CSV: %w", err)`
- Use Go builtins (`min`, `max`) instead of custom versions (Go 1.21+)
- Use ASCII unless the file already uses non-ASCII (only `truncate` uses "…" by design)

## Bubble Tea Conventions

This project follows the Elm Architecture as implemented by Bubble Tea.

**See `specs/architecture.md` §3.1 for full state/update invariants.**

### Model

- `model` in `app.go` is the single source of truth for all state
- Keep the model flat; group related fields with comments
- Never mutate the model outside of `Update`
- `View()` is read-only and must be pure

### Messages (Msg)

- Every async result is a message type (e.g. `dbReadyMsg`, `refreshDoneMsg`)
- Name messages `xxxMsg` (lowercase, unexported)
- Messages carry data and an `err` field. Handlers must check `err` first
- Never perform I/O directly inside `Update`. Use `tea.Cmd`

### Commands (Cmd)

- Command constructors are `xxxCmd` and return `tea.Msg`
- Keep commands in the file that owns the concern (DB commands in `db.go`, import commands in `ingest.go`)
- Commands must not capture mutable model state; pass needed values only

### Update & Key Handling

**See `specs/architecture.md` §3.2 for full dispatch chain.**

`Update` dispatches on message type, then delegates to focused handlers:
- `updateCommandUI` (command palette/colon mode)
- `updateJumpOverlay` (v0.4: jump mode navigation)
- `updateDetail` (transaction detail modal)
- `updateFilePicker`, `updateCatPicker`, `updateTagPicker` (picker overlays)
- `updateSearch` (v0.3) / `updateFilterInput` (v0.4)
- `updateSettings` (settings navigation + editors)
- `updateDashboard` (dashboard + pane focus)
- `updateBudget` (v0.4: budget tab)
- `updateManager` (manager tab)
- `updateTransactions` (transaction table)

### View

- `View()` composes full screen from discrete render functions in `render.go`
- Render functions are pure
- Layout math (visible rows, content width, section width) lives on `model`
- Styles are package-level `var` blocks in `render.go` (no inline styles)

## Status Handling

- All status text is rendered via `renderStatus(text, isErr)`
- Set errors with `setError(...)` so `statusErr` is true
- Always set `statusErr = false` when writing non-error status text

## Key Workflows

### Import Flow (Settings-Only)

**v0.3 current:** Import is only accessible from Settings (Database & Imports section).

Flow:
1. User presses `i` in Settings → `loadFilesCmd` scans for `.csv`
2. `importPicking` opens file picker overlay
3. Selecting a file runs `scanDupesCmd`
4. If dupes exist, `importDupeModal` opens
5. User chooses: `a` (import all), `s` (skip dupes), `esc`/`c` (cancel)
6. `ingestCmd` imports, records import, applies category rules

**v0.4 changes:** `importDupeModal` is replaced by `importPreviewModal` with compact/full view toggle and post-rules preview. See `specs/v0.4-spec.md` Phase 4.

### CSV Formats & Config

- Formats defined in `~/.config/jaskmoney/formats.toml`
- `loadFormats` creates default config if missing
- `parseFormats` validates required fields (`name`, `date_format`)
- `findFormat` is case-insensitive
- `detectFormat` uses filename prefix, falls back to first format

**v0.4 additions:** Config file also stores `[[saved_filter]]` and `[[dashboard_view]]` blocks. See `specs/v0.4-spec.md` Phase 2 and Phase 6.

### Database & Migrations

**v0.3 current:** Schema v4 (categories, category_rules, tags, tag_rules, transactions, accounts, imports)

**v0.4 target:** Schema v5 migration drops rules v1 tables (fresh start), adds `rules_v2`, budget tables, `credit_offsets`. See `specs/architecture.md` §5.4 for migration policy.

- Schema version tracked in `schema_meta`
- `clearAllData` deletes transactions/imports but preserves categories/rules
- Use `updateTransactionDetail` for atomic updates to category + notes
- Multi-step DB mutations must run in a transaction

## External Reference

- Bagels reference repo at `/home/jask/bagels-ref`
- For spending tracker parity, inspect `src/bagels/components/modules/spending/`
- For jump mode reference, see `src/bagels/components/jumper.py`

## Quality & Safety Checks

- Avoid silent error drops in I/O and DB code
- Keep comments aligned with behavior
- Remove dead code promptly (unused helpers, structs, render functions)
- Always update tests and docstrings when behavior changes
- **Check `specs/architecture.md` §8.5 Regression Priority Matrix** for high-risk areas

## Commit & Pull Request Guidelines

History mixes short version tags (`v0.12`) and imperative messages (`Add ...`, `Fix ...`). Prefer:
- Concise, imperative subject lines (`Fix CSV date parsing`)
- Optional scoped prefixes (`feat:`, `fix:`)
- One logical change per commit

For PRs, include:
- What changed and why
- How to validate (`go test ./...`, `go run . -validate`, manual run notes)
- Screenshots or terminal captures for TUI-visible changes

## Security & Configuration Tips

- Never commit API keys, personal financial data, or local DB files (`.db` files are gitignored)
- Treat CSV inputs as untrusted; validate and handle parse failures explicitly
- Use database transactions for multi-row mutations to prevent partial state

## Common Pitfalls & Gotchas

1. **Keybinding conflicts:** Use `specs/architecture.md` §3.4.11 testing contract to catch shadow conflicts. Run scope reachability and global shadow audit tests before adding new scopes.

2. **Text input safety:** When adding new text input contexts, ensure printable keys don't trigger shortcuts. See `specs/architecture.md` §3.3.

3. **Modal precedence:** New modals must be inserted at correct precedence in `update.go` dispatch chain. See `specs/architecture.md` §3.2.

4. **Filter expression contexts:** Use permissive parser (`parseFilter`) for interactive `/` input; use strict parser (`parseFilterStrict`) for rules/targets/saved filters. See `specs/architecture.md` §4.4.

5. **Transactional integrity:** Credit offset insertion has 5 validation rules that must run atomically. See `specs/architecture.md` §5.7.

6. **Dashboard scope isolation:** Dashboard default panes must NOT inherit transaction filter input or saved-filter state. Only timeframe + account scope. See `specs/v0.4-spec.md` Phase 6.

7. **Drill-return context lifecycle:** `drillReturnState` must be cleared on any navigation away from Manager (tab switch, jump mode). See `specs/architecture.md` §6.7.

## Agent Best Practices

1. **Always check specifications first** before asking clarifying questions. The answer is usually in `specs/architecture.md` or `specs/v0.4-spec.md`.

2. **Use TOCs for navigation.** Don't read entire documents linearly. Jump to relevant sections.

3. **When implementing a v0.4 phase:** Read the phase in `v0.4-spec.md`, then read referenced architecture sections. Follow acceptance criteria exactly.

4. **When debugging:** Check `specs/architecture.md` §8.5 Regression Priority Matrix for known high-risk areas.

5. **When adding tests:** Follow the three-tier model (§8.1) and anti-theatre quality bar (§8.2).

6. **When uncertain about scope boundaries:** See `specs/architecture.md` §3.4.10 for canonical scope map.

7. **Update specifications when behavior changes.** If you change an invariant or add a new pattern, update `specs/architecture.md` in the same commit.

## Quick Reference: Where to Look

| Need to understand... | Check... |
|---|---|
| Keybinding architecture | `specs/architecture.md` §3.4 |
| Command system | `specs/architecture.md` §4.3 |
| Filter expression language | `specs/architecture.md` §4.4 |
| Jump mode | `specs/architecture.md` §4.5 |
| Rules v2 | `specs/architecture.md` §5.5 |
| Budget system | `specs/architecture.md` §5.6 |
| Credit offsets | `specs/architecture.md` §5.7 |
| Dashboard grid rendering | `specs/architecture.md` §6.4 |
| Testing strategy | `specs/architecture.md` §8 |
| What's in v0.4 Phase X | `specs/v0.4-spec.md` Phase X |
| Breaking changes in v0.4 | `specs/v0.4-spec.md` Behavioral Breaking Changes |
| Phase dependencies | `specs/v0.4-spec.md` Phase Summary & Dependencies |

---

**Remember:** These specifications are the source of truth. When in doubt, read the relevant section. When you implement something, verify it matches the spec. When you discover a gap or contradiction, flag it and propose an update.
