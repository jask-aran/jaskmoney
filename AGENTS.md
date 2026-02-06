# Repository Guidelines

## Project Structure & Module Organization

This is a Go TUI application built with the Bubble Tea framework. All source files live in a single `package main`, organized by concern:

| File | Responsibility |
|---|---|
| `main.go` | Entry point only. Parses flags and launches the TUI or non‑TUI validation path. |
| `validate.go` | Non‑TUI validation path using a temporary DB and CSV file. |
| `model.go` | Bubble Tea model: types, messages, `Init`/`Update`/`View`, key handling, layout helpers, import flow state. |
| `db.go` | SQLite schema, migrations, queries, and DB helpers (including atomic transaction updates). |
| `ingest.go` | CSV import pipeline: format‑driven parsing, duplicate detection, transactional insert, file scanning, and import commands. |
| `render.go` | All visual output: styles, sections, tables, charts, modals, status bar rendering. |
| `overlay.go` | String/layout utilities: overlay compositing, padding, truncation, line splitting. |
| `theme.go` | Catppuccin Mocha color constants, semantic aliases, and category accent palette. |
| `config.go` | TOML CSV format configuration: load, parse, validate, default creation. |

Supporting files:
- `go.mod`, `go.sum` — module definition and dependencies.
- `ANZ.csv` — sample import data.
- `transactions.db` — local runtime artifact (do not commit).
- `v0.2-spec.md` — design specification document.

### Where new code should go

- **New data sources or import formats** — `ingest.go` (or a new file like `import_ofx.go` for a distinct format). Add format definitions in `config.go` and update tests.
- **New database queries or migrations** — `db.go`.
- **New UI views, sections, or visual components** — `render.go`.
- **New Bubble Tea messages, commands, or model fields** — `model.go`.
- **New string/layout utilities** — `overlay.go`.
- **New color constants or theme changes** — `theme.go`.
- **New CLI flags or non‑TUI flows** — `main.go` and `validate.go`.

When the project outgrows a flat structure, migrate to:
```
cmd/jaskmoney/main.go    — entrypoint
internal/tui/             — model, render, overlay
internal/db/              — database access
internal/ingest/          — CSV/file import
```

## Runtime Modes

This app has two runtime modes:

- **TUI mode** (default): `go run .`
- **Non‑TUI validation**: `go run . -validate`
  - Uses a temporary DB and a temporary CSV file.
  - Does not touch `transactions.db` or user data.
  - Validates import + duplicate detection end‑to‑end.

Note: TUI mode requires a TTY. In headless environments, use `-validate` or tests.

## Build, Test, and Development Commands

Use standard Go tooling from the repo root:
- `go run .` — run the TUI app locally.
- `go run . -validate` — run non‑TUI validation (temp DB + CSV).
- `go build .` — compile and verify the binary builds.
- `go test ./...` — run all tests across packages.
- `go test -run TestName ./...` — run a focused test.
- `go vet ./...` — run static analysis.
- `gofmt -w .` — format Go source files in place.

If you add tooling (lint, make targets), document it here and in the README.

## Coding Style & Naming Conventions

- Follow idiomatic Go and keep code `gofmt`‑clean.
- Use tabs (Go default); do not manually align with spaces.
- Exported identifiers: `PascalCase`; unexported: `camelCase`.
- Keep functions small and single‑purpose; prefer early returns for errors.
- Wrap errors with context: `fmt.Errorf("load CSV: %w", err)`.
- Use Go builtins (`min`, `max`) instead of custom versions (Go 1.21+).
- Use ASCII unless the file already uses non‑ASCII (only `truncate` uses “…” by design).

## Bubble Tea Conventions

This project follows the Elm Architecture as implemented by Bubble Tea.

### Model

- `model` in `model.go` is the single source of truth for all state.
- Keep the model flat; group related fields with comments.
- Never mutate the model outside of `Update`.
- `View()` is read‑only and must be pure.

### Messages (Msg)

- Every async result is a message type (e.g. `dbReadyMsg`, `refreshDoneMsg`).
- Name messages `xxxMsg` (lowercase, unexported).
- Messages carry data and an `err` field. Handlers must check `err` first.
- Never perform I/O directly inside `Update`. Use `tea.Cmd`.

### Commands (Cmd)

- Command constructors are `xxxCmd` and return `tea.Msg`.
- Keep commands in the file that owns the concern:
  - DB commands in `db.go`
  - Import commands in `ingest.go`
- Commands must not capture mutable model state; pass the needed values only.

### Update & Key Handling

- `Update` dispatches on message type, then delegates to focused handlers.
- Key handling is split by mode:
  - `updateMain` (default view)
  - `updateNavigation` (transactions table)
  - `updateSearch` (search input)
  - `updateDetail` (transaction detail modal)
  - `updateSettings` (settings sections)
  - `updateFilePicker` (import file picker overlay)
  - `updateDupeModal` (duplicate decision modal)

### View

- `View()` composes the full screen from discrete render functions.
- Render functions are pure and live in `render.go`.
- Layout math (visible rows, content width, section width) lives on `model`.
- Styles are package‑level `var` blocks in `render.go` (no inline styles).

## Status Handling

- All status text is rendered via `renderStatus(text, isErr)`.
- Set errors with `setError(...)` so `statusErr` is true.
- Always set `statusErr = false` when writing non‑error status text.

## Import Flow (Settings‑Only)

Import is **only accessible from Settings** (Database & Imports section).

Flow:
1) User presses `i` in Settings → `loadFilesCmd` scans for `.csv`.
2) `importPicking` opens the file picker overlay (`renderFilePicker`).
3) Selecting a file runs `scanDupesCmd`.
4) If dupes exist, `importDupeModal` opens (`renderDupeModal`).
5) User chooses:
   - `a` → import all (force dupes)
   - `s` → import skipping dupes
   - `esc`/`c` → cancel
6) `ingestCmd` imports, records import, and applies category rules.

Details:
- Duplicate detection uses `(date_iso, amount, description)` keys via `duplicateKey`.
- Format detection uses filename prefix via `detectFormat` (case‑insensitive).
- If no format matches, `detectFormat` falls back to the first format.
- Default formats include **only ANZ** (single format).

## CSV Formats & Config

- Formats are defined in `formats.toml` under `~/.config/jaskmoney`.
- `loadFormats` creates the default config if missing.
- `parseFormats` validates required fields (`name`, `date_format`).
- `findFormat` is case‑insensitive (`strings.EqualFold`).
- `detectFormat` uses filename prefix and falls back to the first format.

If you add a new format:
- Update `defaultConfigTOML`.
- Add tests to `config_test.go` and `ingest_test.go`.
- Ensure the filename prefix detection remains correct.

## Database & Migrations

- Schema version is tracked in `schema_meta`.
- Migration from v1 preserves transactions by copying into v2 with `category_id = NULL`.
- `clearAllData` deletes transactions/imports but preserves categories and rules.
- Use `updateTransactionDetail` for atomic updates to category + notes.

## Rendering & UI Rules

- Cumulative balance chart uses running total (debits increase, credits decrease).
- Transaction table supports optional category column (nil categories hides it).
- `formatMonth` must handle invalid dates safely (no slicing panic).

## Testing Guidelines

- Prefer table‑driven unit tests with `TestXxxBehavior` names.
- Keep tests deterministic (no uncontrolled clock/network dependencies).
- Use temp files and temp DBs for CSV/DB tests.
- For import tests, call `importCSV(db, path, format, skipDupes)` explicitly.
- For command tests, call the returned `tea.Cmd` and assert on the message.
- Run non‑TUI validation with `go run . -validate` to simulate an import without TTY.

## Quality & Safety Checks

- Avoid silent error drops in I/O and DB code.
- Keep comments aligned with behavior.
- Remove dead code promptly (unused helpers, structs, or render functions).
- Always update tests and docstrings when behavior changes.

## Commit & Pull Request Guidelines

History mixes short version tags (`v0.12`) and imperative messages (`Add ...`, `Fix ...`). Prefer:
- Concise, imperative subject lines (`Fix CSV date parsing`).
- Optional scoped prefixes (`feat:`, `fix:`).
- One logical change per commit.

For PRs, include:
- What changed and why.
- How to validate (`go test ./...`, `go run . -validate`, manual run notes).
- Screenshots or terminal captures for TUI-visible changes.

## Security & Configuration Tips

- Never commit API keys, personal financial data, or local DB files.
- Treat CSV inputs as untrusted; validate and handle parse failures explicitly.
- Use database transactions for multi‑row mutations to prevent partial state.
