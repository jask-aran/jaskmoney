# AGENTS.md

This guide is for agentic coding assistants working in this repository.
Follow the conventions in SPEC.md and existing Go code.

## Project Summary

- App: JaskMoney (TUI personal finance manager)
- Language: Go (go 1.23)
- UI: Bubbletea + Lipgloss
- Storage: SQLite (single-user, local)
- LLM: Gemini 2.5 Flash (swappable provider)
- Time handling: store UTC; input/display default Australia/Melbourne
- Amounts: integer cents (int64), negative = expense, positive = income

## Workspace Layout

- Entry point: cmd/jaskmoney/main.go
- Config: internal/config
- DB + migrations: internal/database
- Repositories: internal/database/repository
- Services: internal/service
- LLM: internal/llm
- TUI: internal/tui
- Spec: SPEC.md (authoritative design)

## Build / Run / Test / Lint

All standard commands are in the Makefile.

- Install tools: `make tools`
- Tidy modules: `make tidy`
- Build: `make build`
- Run: `make run`
- Format: `make fmt`
- Lint: `make lint`
- Test all: `make test`

Direct Go commands (useful for single tests):

- Run all tests: `go test ./...`
- Run a package: `go test ./internal/database/repository`
- Run a single test by name:
  `go test ./internal/database/repository -run TestName`
- Run tests in a file (pattern match):
  `go test ./internal/database/repository -run TestName -count=1`

Database migrations:

- Apply migrations: `make migrate-up`
- Roll back one: `make migrate-down`

Environment variables:

- `GEMINI_API_KEY` (required for LLM)
- `JASKMONEY_CONFIG` (optional config path override)

Beads task tracking:

- Beads CLI is initialized for this repo (`bd init` already run).
- Issues live in `.beads/` and use the prefix `jaskmoney-`.
- Useful commands:
  - `bd ready` (list unblocked tasks)
  - `bd create "Title" -p 0` (create a P0 task)
  - `bd dep add <child> <parent>` (link tasks)
  - `bd show <id>` (view details)
  - `bd sync` (sync Beads state)
- Agents should use `bd` for task tracking instead of ad-hoc markdown plans.
- Prefer querying `bd ready`/`bd show` before starting work to understand dependencies.

## Cursor / Copilot Rules

- No `.cursor/rules`, `.cursorrules`, or `.github/copilot-instructions.md` found.
- If rules are added later, update this file accordingly.

## Code Style Guidelines

General:

- Use `gofmt` formatting; keep imports sorted and grouped.
- Prefer clear, explicit code over cleverness.
- Avoid global state; pass dependencies via constructors.
- Keep functions focused; split long methods into helpers.

Imports:

- Standard library first, blank line, third-party, blank line, local.
- Use `goimports` behavior if needed to manage grouping.

Naming:

- Exported: PascalCase (e.g., `TransactionRepo`).
- Unexported: camelCase (e.g., `fetchTags`).
- Receivers: short, descriptive (`r`, `cfg`, `svc`), avoid single-letter if ambiguous.
- Avoid stutter: prefer `repository.Transaction` instead of `repository.RepositoryTransaction`.

Types and data handling:

- Amounts are `int64` in cents (`AmountCents`).
- Use `time.Time` for timestamps; store UTC.
- Nullable DB fields use pointers (e.g., `*string`, `*time.Time`).
- Status values are plain strings for now; keep constants in a single place if added.

Error handling:

- Return errors directly; do not `panic` in production paths.
- Wrap errors with context using `fmt.Errorf("...: %w", err)`.
- Prefer early returns on errors.
- For `sql.ErrNoRows`, return `(nil, nil)` where appropriate (see repository patterns).

Context usage:

- Repository and service methods accept `context.Context`.
- Thread `ctx` through DB and LLM calls.

Database:

- Use parameterized SQL (`?`) to avoid injection.
- Keep SQL in repository layer.
- Use `CURRENT_TIMESTAMP` for `created_at` and `updated_at` where applicable.
- Ensure ordering is deterministic (e.g., `ORDER BY date DESC, created_at DESC`).

Configuration:

- Use `internal/config` with Viper.
- Environment variables override config file values.
- Default paths:
  - DB: `~/.local/share/jaskmoney/jaskmoney.db`
  - Config: `~/.config/jaskmoney/config.toml`
- Timezone default: `Australia/Melbourne`.

LLM integration:

- Provider is swappable; keep interfaces small and focused.
- Calls must be non-blocking for the TUI (goroutines + message bus).
- Return a confidence value for decisions.
- Batch background processing: 10 at a time, 1s delay.

TUI conventions:

- Bubbletea model should be kept small and composable.
- Views should be deterministic and not mutate state.
- Use Lipgloss for consistent styling; avoid ad-hoc ANSI codes.
- Never block UI on LLM calls; show a status indicator instead.

Testing guidance:

- Keep tests package-local unless black-box testing is needed.
- Prefer table-driven tests.
- Use deterministic time values; avoid `time.Now()` in tests without control.

Documentation:

- Keep SPEC.md aligned with behavior.
- Update README.md for user-facing changes.

## Commit Discipline (for agents)

- Do not commit unless explicitly asked.
- When committing, follow repo conventions and keep messages concise.
- Avoid amending unless requested.

## Quick Reference

- Build: `make build`
- Run: `make run`
- Test: `make test`
- Lint: `make lint`
- Format: `make fmt`
- Single test: `go test ./path/to/pkg -run TestName`

## Landing the Plane (Session Completion)

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until `git push` succeeds.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create issues for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **PUSH TO REMOTE** - This is MANDATORY:
   ```bash
   git pull --rebase
   bd sync
   git push
   git status  # MUST show "up to date with origin"
   ```
5. **Clean up** - Clear stashes, prune remote branches
6. **Verify** - All changes committed AND pushed
7. **Hand off** - Provide context for next session

**CRITICAL RULES:**
- Work is NOT complete until `git push` succeeds
- NEVER stop before pushing - that leaves work stranded locally
- NEVER say "ready to push when you are" - YOU must push
- If push fails, resolve and retry until it succeeds
