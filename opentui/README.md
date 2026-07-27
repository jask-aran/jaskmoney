# jaskmoney OpenTUI (Solid)

SolidJS + OpenTUI rewrite of the Go/Bubble Tea app.

**Tracking:** https://github.com/jask-aran/jaskmoney/issues/1  
**Behaviour contract:** [`docs/implementation-invariants.md`](../docs/implementation-invariants.md)  
**Visual oracles:** [`docs/reference-reconstruction.md`](../docs/reference-reconstruction.md) + `docs/reference-*.{txt,ansi,png}`  
**Go sources of truth at implement time:** `db.go` (schema v7), `ANZ.csv`, `ingest.go` as needed.

## Intent

Near-parity performance for interactive use, with a project shape that is easy to reason about:

- UI state ≠ domain state
- Domain mutations only through `domain/` + `db/`
- Key router is a pure scope→key→action table (grow overlays later)
- Dashboard aggregates are pure functions of `(rows, scope, now)`
- Manager list is virtualized; cursor moves must not rebuild Dashboard

## Layout

```
opentui/
  src/
    app/           # App shell, key router
    domain/        # types, ANZ parse, ingest, dashboard aggregates
    db/            # bun:sqlite, schema v7 subset
    ui/
      primitives/  # TabBar, SectionCard, StatusBar, Footer, JumpOverlay
      manager/     # Account strip + scrollable txn list
      dashboard/   # DateRange + Overview (+ chart stubs)
      settings/    # stub cards
    state/         # uiStore, dataStore
```

## MVP milestones

| Milestone | Status | Outcome |
|---|---|---|
| **M0** Shell | **done** | Tabs, jump, status, footer |
| **M1** Domain + naive ingest | **done** | Schema v7 subset, `ANZ.csv` → ANZ CREDIT |
| **M2** Manager | **done** | Windowed list, cursor, account toggle |
| **M3** Dashboard | **done** | Timeframe, overview, sparkline, category bars |
| **M4** Glue | **done** | `/` filter, `c` categorize, Settings DB info, shared scope |

**Out of MVP:** Budget depth, Settings CRUD, full filter language, rules, allocations, import preview, command palette/colon mode.

## Run

```bash
cd opentui
bun install
bun start                 # interactive TUI
bun run test              # unit + shell tests (--conditions=browser required)
```

**Keys:** `1`–`3` / `Tab` · `v` jump · Manager `j/k` move · `S-j/k` range · `space` select · `c` cat · `/` filter expr · `u` clear sel/filter · accounts `space` toggle · Dashboard timeframe · `i` ingest · `Ctrl+C` quit  

**Filter:** full lexer/parser port (`cat:`, `tag:`, `amt:`, `date:`, `type:`, `AND`/`OR`/`NOT`, implicit AND). Live permissive parse; Enter tries strict.  




**Data:** SQLite at `~/.local/share/jaskmoney-opentui/transactions.db` (override with `JASKMONEY_DB=:memory:` or a path). On empty DB, auto-ingests repo-root `ANZ.csv` if found.

Go app at repo root remains the production TUI until cutover.
