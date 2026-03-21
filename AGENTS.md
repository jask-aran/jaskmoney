# Repository Guidelines for Agents


## Core Architectural Principles

1. **Single mutable state root:** `model` is the only source of truth. Mutate state in `Update` paths only.
2. **Pure rendering:** `View()` is read-only. No I/O, no side effects.
3. **Message-driven async:** All I/O happens via `tea.Cmd`; async results return typed `xxxMsg`.
4. **Modal precedence:** Topmost overlay wins. Add overlays through `overlayPrecedence()` in `dispatch.go` so update/footer/command-scope stay aligned.
5. **Text input safety:** Printable keys are literal text in text-input contexts. `modalTextContracts` in `dispatch.go` is the source of truth.
6. **Action-first key handling:** Resolve keys by action (`m.isAction`, `m.verticalDelta`, `m.horizontalDelta`), not raw key string checks.
7. **Keybinding model:** Scopes are flat in storage, hierarchical in dispatch; actions are stable, keys are overrideable.


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
  - `agent-tui resize -s <session-id> --cols 140 --rows 60`
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


## Common Pitfalls & Gotchas

1. **Keybinding conflicts:** Keep shadowing intentional. Maintain global-shadow and scope-reachability tests when adding scopes.
2. **Generic action consistency:** Use `space` for toggle, `a` for add, `del` for delete, `enter` for select/edit, `esc` for cancel/back.
3. **Text input safety:** Any new text-input scope must be represented in `modalTextContracts`.
4. **Modal precedence:** New modal states must be inserted into `overlayPrecedence()` at the correct priority.
5. **Filter contexts:** Use permissive parsing for interactive `/` input and strict parsing for persisted surfaces (rules/targets/saved filters).
6. **Transactional integrity:** Allocation inserts/updates must validate sign and parent capacity atomically.
7. **Dashboard scope isolation:** Dashboard default panes use timeframe + account scope only; no transaction filter inheritance.
8. **Drill-return lifecycle:** `drillReturnState` is cleared on navigation away from Manager.
9. **Multi-field modal forms:** Support `tab`/`shift-tab` field cycling.
10. **Action-based dispatch:** Avoid raw key-name branching in handlers.
11. **Footer hints:** Show actionable commands, not generic navigation keys.
12. **Shifted single-letter bindings:** Uppercase letters surface as `S-<key>` in footer help.
13. **Pane selection vs focus:** Preserve selected pane on tab return, but do not auto-focus pane interactions.


