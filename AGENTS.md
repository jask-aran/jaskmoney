# AGENTS.md

This guide is for agentic coding assistants working in this repository.
Refer to the beads issue tracker and use it to track all identified issues through the course of working, and progress made on existing issues, including ones that were created on user request.

## Project Summary

- App: JaskMoney (TUI personal finance manager)
- Language: Go (go 1.23)
- UI: Bubbletea + Lipgloss
- Storage: SQLite (single-user, local)
- LLM: Gemini Flash (swappable provider)
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


ZFC (Zero Framework Cognition) Principles

Core Architecture Principle: This application is pure orchestration that delegates ALL reasoning to external AI. We build a “thin, safe, deterministic shell” around AI reasoning with strong guardrails and observability.

✅ ZFC-Compliant (Allowed)

Pure Orchestration

IO and Plumbing • Read/write files, list directories, parse JSON, serialize/deserialize • Persist to stores, watch events, index documents

Structural Safety Checks • Schema validation, required fields verification • Path traversal prevention, timeout enforcement, cancellation handling

Policy Enforcement • Budget caps, rate limits, confidence thresholds • “Don’t run without approval” gates

Mechanical Transforms • Parameter substitution (e.g., ${param} replacement) • Compilation • Formatting and rendering AI-provided data

State Management • Lifecycle tracking, progress monitoring • Mission journaling, escalation policy execution

Typed Error Handling • Use SDK-provided error classes (instanceof checks) • Avoid message parsing

❌ ZFC-Violations (Forbidden)

Local Intelligence/Reasoning

Ranking/Scoring/Selection • Any algorithm that chooses among alternatives based on heuristics or weights

Plan/Composition/Scheduling • Decisions about dependencies, ordering, parallelization, retry policies

Semantic Analysis • Inferring complexity, scope, file dependencies • Determining “what should be done next”

Heuristic Classification • Keyword-based routing • Fallback decision trees • Domain-specific rules

Quality Judgment • Opinionated validation beyond structural safety • Recommendations like “test-first recommended”

🔄 ZFC-Compliant Pattern

The Correct Flow

1. Gather Raw Context (IO only) • User intent, project files, constraints, mission state

2. Call AI for Decisions • Classification, selection, composition • Ordering, validation, next steps

3. Validate Structure • Schema conformance • Safety checks • Policy enforcement

4. Execute Mechanically • Run AI’s decisions without modification
