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

The Transactions tab's account sidebar lists All spending, each spending account, and its savers (as a group and singly); the selected entry decides which transactions the table shows. `m` regroups the table by merchant (signed totals, counts, averages, last seen); the filter, account and sort work the same, `enter` narrows the filter to a merchant, and `c`/`t` act on all of its transactions.

A category can be marked not-spending (Settings, category editor): its transactions are left out of spending, income and merchant figures. Transfers starts that way, for money moved to your own accounts at other banks.

Tags sync both ways with Up (adding or removing a tag on an Up transaction changes it in Up); IGNORE stays local. In the tag picker (`t`), space stages a change per tag and enter applies them all; esc discards. Typing a name no tag has offers to create it.

Budgets (Settings, `v` then `b`): an overall limit, optional limits per spending account or category (a group covers its subcategories), and one cycle for all of them — weekly, fortnightly or monthly, from calendar starts, a date (e.g. payday), or the Monday nearest that date (`c`). The Overview opens on the current cycle (the Cycle preset); while the range is the current cycle, Totals shows the overall budget (used and left per day) and the Cumulative chart draws it as a rule.

Tabs: `1` Overview, `2` Transactions, `3` Settings. The Overview has the Date Range across the top (`v` then `d`; presets include Cycle and Custom, which asks for start and end dates; `d`/`D` step through the presets from anywhere on the Overview, `[`/`]` step the range back and forward, `0` returns to now for the same kind of range (this month, this quarter; a custom range moves to end today), `c` to this cycle; `a` switches between all spending accounts and one), two chart panes (each cycles Cumulative, Daily, Weekly, Cash flow, Net position, Available, Savers, Calendar: `h`/`l` the top or focused pane, `H`/`L` the bottom; the views show as icons in the top border, the legend in the bottom border, and labels sit beside the points they describe where they fit) and a column of stacks: Now (net position, available, pending, runway; no range), Savers, Totals (the range against the same days of the previous period) and Categories. With Categories focused (`v c`), `j`/`k` pick a category and `enter` opens its transactions in the range (`enter` on a chart opens all the range's spending); `esc` in Transactions comes back. The date range, account, chart views and week start (Settings › Database & Import `w`) are remembered between runs. `q` quits wherever it cannot be typed text. In Transactions, `ctrl+s` saves the current filter and `ctrl+l` applies a saved one (most recently used first); the filter and rule editors show whether an expression parses and how many transactions it matches as you type, and Settings › Rules `D` shows a dry run of every rule with samples. `enter` opens a transaction's details (`c` category, `t` tags, `n` notes); pending transactions show a clock after the amount. Below 120 columns the Overview shows one chart with the stacks below it; below 110 Transactions folds its sidebar into a one-line account header (`a` switches account).

Where information lives: the Overview is figures and charts (point-in-time ones in Now and Savers, everything else over the Date Range, which defaults to the budget cycle); Transactions is the individual rows, and merchants as a grouping of them; Settings is configuration.

### CSV import

In Settings, activate Database & Import and press `i` to choose a CSV, map or select an import profile, preview duplicates, then import.

Category icons use Nerd Font glyphs (a "Nerd Font Mono" face keeps them one cell wide). Settings › Database & Import `n` turns them off, falling back to coloured dots; the choice is stored in the settings config, not the database.
