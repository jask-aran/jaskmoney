# Repository Guidelines

## Project Structure & Module Organization

This is a Go TUI application built with the [Bubble Tea](https://github.com/charmbracelet/bubbletea) framework. Source files are organized by concern within a single `package main`:

| File | Responsibility |
|---|---|
| `main.go` | Entry point only — creates the `tea.Program` and runs it. |
| `model.go` | Bubble Tea model: types, messages, `Init`/`Update`/`View`, key handling, layout helpers. |
| `db.go` | SQLite database: open, schema, queries, and tea.Cmd wrappers (`refreshCmd`, `clearCmd`). |
| `ingest.go` | CSV import pipeline: parsing, validation, transactional insert, file scanning. |
| `render.go` | All visual output: styles, section/table/overview rendering, footer, status bar, modal overlay. |
| `overlay.go` | Generic string utilities: overlay compositing, padding, truncation, line splitting. |

Supporting files:
- `go.mod`, `go.sum` — module definition and dependencies.
- `ANZ.csv` — sample import data.
- `transactions.db` — local runtime artifact (do not commit).

### Where new code should go

- **New data sources or import formats** — `ingest.go` (or a new file like `import_ofx.go` for a distinct format).
- **New database queries or migrations** — `db.go`.
- **New UI views, sections, or visual components** — `render.go`.
- **New Bubble Tea messages or model fields** — `model.go`.
- **New string/layout utilities** — `overlay.go`.
- **New CLI subcommands or flags** — `main.go`.

When the project outgrows a flat structure, migrate to:
```
cmd/jaskmoney/main.go    — entrypoint
internal/tui/             — model, render, overlay
internal/db/              — database access
internal/ingest/          — CSV/file import
```

## Build, Test, and Development Commands

Use standard Go tooling from the repo root:
- `go run .` — run the TUI app locally.
- `go build .` — compile and verify the binary builds.
- `go test ./...` — run all tests across packages.
- `go test -run TestName ./...` — run a focused test.
- `go vet ./...` — run static analysis.
- `gofmt -w .` — format Go source files in place.

If you add tooling (lint, make targets), document it here and in the README.

## Coding Style & Naming Conventions

- Follow idiomatic Go and keep code `gofmt`-clean.
- Use tabs (Go default); do not manually align with spaces.
- Exported identifiers: `PascalCase`; unexported: `camelCase`.
- Keep functions small and single-purpose; prefer early returns for errors.
- Wrap errors with context, e.g. `fmt.Errorf("load CSV: %w", err)`.
- Use Go builtins (`min`, `max`) instead of hand-rolled versions (Go 1.21+).

## Bubble Tea Conventions

This project follows the standard [Elm Architecture](https://guide.elm-lang.org/architecture/) as implemented by Bubble Tea. All TUI development must follow these conventions:

### Model

- The `model` struct in `model.go` is the single source of truth for all application state.
- Keep the model flat where possible. Group related fields with comments, not nested structs, unless the sub-component has its own `Update` logic (like `list.Model`).
- Never mutate the model outside of `Update`. The `View` function must be read-only.

### Messages (Msg)

- Every asynchronous result is a message type (e.g. `dbReadyMsg`, `refreshDoneMsg`).
- Name messages as `xxxMsg` — lowercase, unexported, descriptive of the event.
- Messages carry data and an `err` field. The handler in `Update` checks `err` first.
- Never perform I/O directly inside `Update`. Return a `tea.Cmd` instead.

### Commands (Cmd)

- Commands are functions that return `tea.Msg`. They run asynchronously.
- Name command constructors as `xxxCmd` (e.g. `refreshCmd`, `clearCmd`, `ingestCmd`).
- Keep command functions in the file that owns the concern (DB commands in `db.go`, import commands in `ingest.go`).
- Commands must not capture mutable model state. Pass only the specific values they need (e.g. pass `*sql.DB`, not the whole model).

### Update

- The top-level `Update` dispatches on message type, then delegates to focused handlers.
- Key handling is split by mode: `updateMain` for the default view, `updatePopup` for the modal.
- Each handler returns `(tea.Model, tea.Cmd)` — always return both explicitly.
- For complex features, add a new `updateXxx` method rather than growing the switch.

### View

- `View()` composes the full screen from discrete render functions.
- Render functions are pure: they take data in and return strings. They live in `render.go`.
- Layout math (visible rows, content width, section width) lives on the model as methods in `model.go`.
- Styles are declared as package-level `var` blocks in `render.go` — never inline `lipgloss.NewStyle()` in render functions.

### Adding a new feature (checklist)

1. Define any new message types in `model.go`.
2. Write the async command function in the appropriate concern file.
3. Add a case to `Update` (or a sub-handler) for the new message.
4. Add any new model fields to the `model` struct.
5. Update `View` or add a render function in `render.go`.
6. Update key bindings in the `keyMap` if new keys are needed.
7. Write tests in `*_test.go` alongside the file being tested.

## Testing Guidelines

- Prefer table-driven unit tests in `*_test.go` files.
- Name tests as `TestXxxBehavior` with clear scenario intent.
- Keep tests deterministic (no uncontrolled clock/network dependencies).
- For CSV/DB behavior, use temporary files and isolated test data.
- Test render functions by asserting on string output.
- Test commands by calling the returned function and asserting on the message.

## Commit & Pull Request Guidelines

History mixes short version tags (`v0.12`) and imperative messages (`Add ...`, `Fix ...`). Prefer:
- Concise, imperative subject lines (`Fix CSV date parsing`).
- Optional scoped prefixes when useful (`feat:`, `fix:`).
- One logical change per commit.

For PRs, include:
- What changed and why.
- How to validate (`go test ./...`, manual run notes).
- Screenshots or terminal captures for TUI-visible changes.

## Security & Configuration Tips

- Never commit API keys, personal financial data, or local DB files.
- Treat CSV inputs as untrusted; validate and handle parse failures explicitly.
- Use database transactions for multi-row mutations to prevent partial state.
