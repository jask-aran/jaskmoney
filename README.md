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

SQLite defaults to `~/.local/share/jaskmoney-opentui/transactions.db`; set `JASKMONEY_DB` to override it.

### Up Bank sync (primary source)

Up uses a Personal Access Token; there is no in-app login. Create one at <https://api.up.com.au> and export it before starting the app:

```bash
export JASKMONEY_UP_TOKEN=up:yeah:…
```

The app syncs at startup and every 5 minutes; `ctrl+r` syncs from anywhere, and the header shows when it last synced. In Settings, Up Bank (`v` then `u`) also has `s` to sync. The first sync of each account pulls its full history; later syncs fetch a recent window per account, update pending (held) transactions in place when they settle, and drop holds that Up reversed. Sync never changes a category, tag or note you set.

Categories are Up's: its 4 groups and their subcategories, plus local-only ones (Income, Transfers, People, Uncategorised). Transactions follow Up's category until you or a rule change it. Changing a category in the app updates your Up account too when Up allows it (Up subcategories on transactions Up can categorise; choosing Uncategorised clears it in Up). Local-only categories and transfers stay local.

Each Up account has a sync switch (`space`). Switching an account off removes its transactions and hides it; money you move to it then counts as spending (useful for a joint account that pays shared bills). Savers are tracked by balance: transfers between Spending and a saver are never spending or income.

The Manager's account sidebar lists All spending, each spending account, and its savers (as a group and singly). The selected entry decides which transactions the table shows, and the card beneath it shows that entry's balance, money in and out, monthly flows, balance history, interest and top outflows.

A category can be marked not-spending (Settings, category editor): its transactions are left out of spending, income and merchant figures. Transfers starts that way, for money moved to your own accounts at other banks.

Tags sync both ways with Up (adding or removing a tag on an Up transaction changes it in Up); IGNORE stays local.

Budgets (Settings, `v` then `b`): an overall limit, optional limits per spending account or category (a group covers its subcategories), and one cycle for all of them — weekly, fortnightly or monthly, from calendar starts, a date (e.g. payday), or the Monday nearest that date (`c`). The Spending tab shows the current cycle's progress; the Dashboard shows the overall budget's remainder.

Tabs: `1` Dashboard, `2` Spending, `3` Manager, `4` Settings. In the Manager, `enter` opens a transaction's details (`c` category, `t` tags, `n` notes). The Spending tab breaks the Date Range period down by category, calendar day and merchant; `enter` on a merchant lists its transactions.

The Dashboard's **Now** and **Savers** cards are point-in-time (balances, pending holds, runway at the 90-day average spend) and ignore the date range; **Date Range** drives the period figures and the spending charts.

### CSV import

In Settings, activate Database & Import and press `i` to choose a CSV, map or select an import profile, preview duplicates, then import.
