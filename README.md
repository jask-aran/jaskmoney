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

Categories are Up's: its 4 groups and their subcategories, plus local-only ones (the Income group, Transfers, People, Uncategorised). Transactions follow Up's category until you or a rule change it. Changing a category in the app updates your Up account too when Up allows it (Up subcategories on transactions Up can categorise; choosing Uncategorised clears it in Up). Local-only categories and transfers stay local.

Each Up account has a sync switch (`space`). Switching an account off removes its transactions and hides it; money you move to it then counts as spending (useful for a joint account that pays shared bills). Savers are tracked by balance: transfers between Spending and a saver are never spending or income.

The Transactions tab has an accounts pane above a full-width table: a stack per bank (e.g. Up (API)) headed by its net position, listing its spending accounts and one Savers row for all its savers (their rows are transfers and interest); with more than one spending account an All accounts stack comes first for all spending together. The selected row decides which transactions the table shows; `v a` focuses the pane, `j`/`k` move, `h`/`l` go to the bank beside, `enter` returns to the table. `i` switches the table to the rows waiting for a category, each with a suggested one (italic, with its confidence): first from history (other transactions with the same description), then from TypeSafe's Jev model (`jev-1.14.0`). The view lists the most confident first (`s` cycles to other orders); the confidence is green at 80% or more, amber from 50%, and history's suggestions are marked ↺. Nothing is categorised until you accept: `y` the cursor row or the selection (`space`, `S-j/k`), `Y` every suggestion at 80% or more after showing how many go to each category, `x` dismisses, `c` chooses yourself (the picker lists the suggestion first), `i` goes back. In the filter, `?` and a question in words (`?coffee over $5 last month`) plus `enter` asks Jev and Cloudflare's Clairic for the filter expression, which stays in the bar to read, edit and apply. A filter term `ask:"eating out"` has Jev judge each row by what the money was for (description, amount, type, message, category); matches appear as its answers arrive. Only rows the rest of the filter allows are sent: from the last 90 days unless the filter has a `date:` term, at most the latest 2,000. Verdicts last the session. Rules can't use `ask:`. Smart search writes `cat:` when your words name one of your categories, `desc:` for a shop or person, and `ask:` otherwise. The question stays as the table's title while the filter is still the one it wrote; in the filter, `↑` brings it back to reword. A filter with `ask:` terms is Jev reading each row (the filter bar says so: `◆ Jev reads each row`); without, it is a plain filter. Near misses (rows Jev gave 30–70%) follow the matches, dimmed and marked ≈ with their probability, when they don't outnumber them; `n` shows or hides them either way. Text in a filter (`desc:`, `note:`, bare words) ignores case, spacing and punctuation, so `desc:mcdonalds` finds `McDonald's` (letters still in order; `cat:`, `acc:`, `tag:` stay exact). A shop smart search can't find in any description goes to Jev instead (it knows Maccas). Keys are set in Settings › AI models (`enter` to paste one, `t` to test it, `del` to remove it); they are saved, owner-only, in `credentials.json` beside `settings.json` and take priority over `.env` (`JASKMONEY_JEV_TOKEN`, `JASKMONEY_CF_TOKEN`, `JASKMONEY_CF_ACCOUNT_ID`). Jev is required; Clairic (Workers AI) is optional and only improves smart search's words and written dates. A search query goes to both; a transaction's description, amount, type, message and category go to TypeSafe. Every question Jev is asked, and the thresholds that read its answers, are in `src/domain/questions.ts`. `m` regroups the table by merchant (signed totals, counts, averages, last seen); the filter, account and sort work the same, `enter` narrows the filter to a merchant, and `c`/`t` act on all of its transactions.

A category can be marked not-spending (Settings, category editor): its transactions are left out of spending, income and merchant figures. Transfers starts that way, for money moved to your own accounts at other banks.

Income is what sits in the Income group (Salary, Interest, Other income; local only, as Up has no income categories). Sync files Up's Salary and Interest transactions there unless they have a category already. Money back into a spending category (a refund, or a friend paying you back that you file under Restaurants) reduces that category's spending. Uncategorised money in is neither income nor spending: it counts towards the Overview's uncategorised prompt until you give it a category. Interest on savers counts as income when the Overview covers all spending. Filters take `type:income` alongside `type:spending`.

Tags sync both ways with Up (adding or removing a tag on an Up transaction changes it in Up); IGNORE stays local. In the tag picker (`t`), space stages a change per tag and enter applies them all; esc discards. Typing a name no tag has offers to create it.

Budgets (Settings, `v` then `b`): an overall limit, optional limits per spending account or category (a group covers its subcategories), and one cycle for all of them — weekly, fortnightly or monthly, from calendar starts, a date (e.g. payday), or the Monday nearest that date (`c`). With Payday on, a cycle starts early on the day your Salary arrives when it lands in the 5 days before the start (2 for weekly cycles), and the cycle before ends the day before. The Overview opens on the current cycle (the Cycle preset); while the range is the current cycle, Totals shows the overall budget (used and left per day) and the Cumulative chart draws it as a rule.

Tabs: `1` Overview, `2` Transactions, `3` Settings. The Overview has the Date Range across the top (`v` then `d`; presets include Cycle and Custom, which asks for start and end dates; `d`/`D` step through the presets from anywhere on the Overview, `[`/`]` step the range back and forward, `0` returns to now for the same kind of range (this month, this quarter; a custom range moves to end today), `c` to this cycle; `a` switches between all spending accounts and one), two chart panes (each cycles Cumulative, Daily, Weekly, Cash flow, Net position, Available, Savers, Calendar: `h`/`l` the top or focused pane, `H`/`L` the bottom; the views show as icons in the top border, the legend in the bottom border, and labels sit beside the points they describe where they fit) and a column of stacks: Now (net position, available, pending, runway; no range), Savers, Totals (the range against the same days of the previous period) and Categories. With Categories focused (`v c`), `j`/`k` pick a category and `enter` opens its transactions in the range (`enter` on a chart opens all the range's spending); `esc` in Transactions comes back. The date range, account, chart views and week start (Settings › Database & Import `w`) are remembered between runs; `b` there draws an x-axis line under the charts (off by default). `q` quits wherever it cannot be typed text. In Transactions, `ctrl+s` saves the current filter and `ctrl+l` applies a saved one (most recently used first); the filter and rule editors show whether an expression parses and how many transactions it matches as you type, and Settings › Rules `D` shows a dry run of every rule with samples. `enter` opens a transaction's details (`c` category, `t` tags, `n` notes); pending transactions show a clock after the amount. Below 120 columns the Overview shows one chart with the stacks below it; the Transactions accounts pane scrolls sideways when its stacks don't fit (`a` in the table steps to the next account).

Where information lives: the Overview is figures and charts (point-in-time ones in Now and Savers, everything else over the Date Range, which defaults to the budget cycle); Transactions is the individual rows, and merchants as a grouping of them; Settings is configuration.

### CSV import

In Settings, activate Database & Import and press `i` to choose a CSV, map or select an import profile, preview duplicates, then import.

Category icons use Nerd Font glyphs (a "Nerd Font Mono" face keeps them one cell wide). Settings › Database & Import `n` turns them off, falling back to coloured dots; the choice is stored in the settings config, not the database.
