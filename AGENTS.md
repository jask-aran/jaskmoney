# Repository Guidelines

## Project Structure & Worktree Context
This repository is a `v2` worktree of the main project. The production v1 app lives in `legacy/` within this worktree and mirrors the main branch code. Treat `legacy/` as upstream reference code, not your feature target.

- `legacy/`: v1 standalone Go module (`legacy/go.mod`), read-only for v2 contributors unless explicitly directed.
- `specs/phase-0.md`: source of truth for v2 architecture contracts in this phase.
- Root (future `main.go`, `core/`, `tabs/`, `screens/`, `widgets/`, `db/`): greenfield v2 implementation area.

If you extract logic from v1, copy and adapt it into v2 files; never import directly from `legacy/` packages.

## Build, Test, and Development Commands
- `cd legacy && go test ./...`: validate existing v1 behavior before/after reference-driven changes.
- `cd legacy && ./scripts/test.sh`: run legacy project test workflow.
- `go test ./...` (repo root): run once v2 root module exists.
- `go run .` (repo root): expected Phase 0 validation entrypoint after v2 scaffold is added.

## Coding Style & Naming Conventions
- Use idiomatic Go with `gofmt` on every changed file.
- Keep package boundaries aligned with Phase 0 responsibilities (`core`, `tabs`, `screens`, `widgets`, `db`).
- Prefer contract-driven names: `Screen`, `ScreenStack`, `KeyRegistry`, `CommandRegistry`, `StatusMsg`, `DataLoadedMsg`.
- Keep functions short and composable; add comments only for non-obvious routing or lifecycle behavior.

## Testing Guidelines
- Use Go `testing` with `*_test.go` and `TestXxx`/`BenchmarkXxx`.
- Favor table-driven tests for key dispatch, screen lifecycle pop behavior, scope-filtered commands, and message routing.
- Add focused tests near each package (`core/router_test.go`, `widgets/layout_test.go`, etc.) to validate Phase 0 contracts.

## Commit & Pull Request Guidelines
- Commit in present tense with scope prefix when useful (example: `core: route key events to top screen first`).
- PRs must reference `specs/phase-0.md` contract(s) affected and describe behavioral impact.
- Include verification steps run locally (commands + outcomes). Add screenshots only for UI/layout changes.

## Contributor Guardrails
- Do not mix v1 runtime code into v2 execution paths.
- Do not modify files outside this worktree to “fix” v1; this branch is for v2 architecture work.
- Keep LOC pressure in mind: Phase 0 targets a compact framework, not a full feature port.
