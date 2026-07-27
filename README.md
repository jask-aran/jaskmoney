# Jaskmoney

SolidJS + OpenTUI personal-finance TUI.

The active application is this repository root. The previous Go/Bubble Tea application is preserved under [`legacy/go/`](legacy/go/) as a read-only behavioural reference. Frozen captures and reconstruction contracts remain in [`docs/`](docs/).

- **Behaviour contract:** [`docs/implementation-invariants.md`](docs/implementation-invariants.md)
- **Visual reference:** [`docs/reference-reconstruction.md`](docs/reference-reconstruction.md) and `docs/reference-*`
- **Legacy source:** [`legacy/go/`](legacy/go/)

## Run

```bash
bun install
bun start
```

## Verify

```bash
bun run typecheck
bun run test
```

## Layout

```text
src/
  app/       application shell and key router
  db/        SQLite schema and client
  domain/    parsing, ingest, filters, aggregates, row state
  state/     UI and data stores
  ui/        tabs and reusable primitives
docs/        contracts, captures, legacy specifications
legacy/go/   frozen Go reference implementation
```

## Data

SQLite defaults to `~/.local/share/jaskmoney-opentui/transactions.db`; set `JASKMONEY_DB` to override it. On an empty database, the app looks for a local `ANZ.csv`; press `i` to ingest it.
