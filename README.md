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

Budgets (Settings, `v` then `b`): an overall limit, optional limits per spending account or category (a group covers its subcategories), and one cycle for all of them — weekly, fortnightly or monthly, from calendar starts, a date (e.g. payday), or the Monday nearest that date (`c`). The Dashboard's **This Cycle** card shows each budget's progress and spending through the cycle against the overall budget and the previous cycle.

Tabs: `1` Dashboard, `2` Spending, `3` Manager, `4` Settings. In the Manager, `enter` opens a transaction's details (`c` category, `t` tags, `n` notes). The Spending tab covers the Date Range period: flows, one chart pane (`h`/`l` steps through Daily, Cumulative, Weekly, Net position, Available, Savers and a Calendar month grid), categories, and merchants (`enter` lists a merchant's transactions). `a` switches between all spending accounts and one. Below 120 columns the Dashboard and Spending tabs stack their cards; below 110 the Manager folds its sidebar into a one-line account header (`a` switches account).

The Dashboard is as of today and ignores the Date Range: balances, pending holds and runway (at the 90-day average spend), savers with their 30-day change, a year of net position, the current budget cycle, pending holds and recent transactions. Everything that depends on a chosen period lives on the Spending tab.

### CSV import

In Settings, activate Database & Import and press `i` to choose a CSV, map or select an import profile, preview duplicates, then import.

Category icons use Nerd Font glyphs (a "Nerd Font Mono" face keeps them one cell wide). Settings › Database & Import `n` turns them off, falling back to coloured dots; the choice is stored in the settings config, not the database.
