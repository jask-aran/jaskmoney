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
bun run bench    # per-key timings on a copy of your database
```

## Layout

```text
src/
  app/       application shell and key router
  db/        SQLite schema and client
  domain/    parsing, ingest, filters, aggregates, row state
  state/     UI and data stores (state/store: Up pushes, suggestions, tag review, rule offers)
  ui/        tabs and reusable primitives
  bench/     benchmark, CPU-profile runner and summariser
docs/        contracts, captures, legacy specifications
legacy/go/   frozen Go reference implementation
```

## Keys

- **Footer and palette.** The footer lists the first few keys for where you are. `ctrl+k` opens the command palette (after opencode's): a search line, then the pane's own commands and the rest grouped (Transactions, Rules, Data, Add, AI models, Display, Settings, Go to), each with a short description and its key where it has one; the last one run comes first. Typing ranks them by name (or whole words of the description), each row naming its group; one that can't run now is listed last, dimmed, with why. A pane's keys are declared once, in its footer hints, which name the registry command they run.
- **Stepping back.** `esc` steps back one level: the selection, then a drill-down, then the filter, then a special view (tag review, the Uncategorised view).
- **Undo and repeat.** `u` undoes the last change in Transactions (categorise, accept, dismiss, a tag change, a rule made from an offer), Up included; `.` repeats the last category or tag change on the cursor row or selection.
- **Confirming.** Anything destructive takes its key twice (`del del` on a list row, `enter enter` on an action), the row red until then; wiping the database asks for RESET.
- **Moving.** Pickers move with the arrows or `ctrl+j`/`ctrl+k`, so letters stay text. Every list and picker pages with `pageup`/`pagedown` (by the rows it shows) and jumps with `home`/`end`; lists also take `g`/`G`, `ctrl+d`/`ctrl+u` to page and `ctrl+n`/`ctrl+p` to step. A ctrl or alt letter never acts as its bare letter (`ctrl+u` isn't undo); one a pane doesn't use does nothing.
- **Tabs and quitting.** `1` Overview, `2` Transactions, `3` Settings (`tab` cycles); `v` then a letter jumps to a pane. `q` quits wherever it cannot be typed text; `ctrl+c` anywhere. `ctrl+r` syncs from anywhere.

## Tabs

Where information lives: the Overview is figures and charts (point-in-time ones in Now and Savers, everything else over the Date Range, which defaults to the budget cycle); Transactions is the individual rows, and merchants as a grouping of them; Settings is configuration.

### Overview

- **Date Range** across the top (`v` then `d`). Presets include Cycle and Custom, which asks for start and end dates. From anywhere on the Overview: `d`/`D` step through the presets, `[`/`]` step the range back and forward, `0` returns to now for the same kind of range (this month, this quarter; a custom range moves to end today), `c` goes to this cycle, `a` switches between all spending accounts and one.
- **Two chart panes**, each cycling Cumulative, Daily, Weekly, Cash flow, Net position, Available, Savers, Calendar and Subscriptions: `h`/`l` the top or focused pane, `H`/`L` the bottom. The views show as icons in the top border and the legend in the bottom border; labels sit beside the points they describe where they fit.
- **Subscriptions** lists regular spending payments found in your history (a steady cadence and amount): the cadence, latest charge, what it costs a month, the next charge ("due" once late), and a price change in the last six months ("▲ from $34.00 20 Oct"). Ones that stopped lately follow, dimmed. The legend sums them ("5 active · $238 a month · 1 price change"). It covers the Overview's accounts and isn't limited by the date range.
- **A column of stacks:** Now (net position, available, pending, runway; no range), Savers, Totals (the range against the same days of the previous period) and Categories. With Categories focused (`v c`), `j`/`k` pick a category and `enter` opens its transactions in the range (`enter` on a chart opens all the range's spending); `esc` in Transactions comes back. Categories also shows how many rows wait for review ("136 to review (i)"), and `i` opens them.
- The date range, account, chart views and week start (Settings › Database & Import `w`) are remembered between runs; `b` there draws an x-axis line under the charts (off by default). Below 120 columns the Overview shows one chart with the stacks below it.

### Transactions

- **Accounts pane** above a full-width table: a stack per bank (e.g. Up (API)) headed by its net position, listing its spending accounts and one Savers row for all its savers (their rows are transfers and interest). With more than one spending account, an All accounts stack comes first for all spending together. The selected row decides which transactions the table shows: `v a` focuses the pane, `j`/`k` move, `h`/`l` go to the bank beside, `enter` returns to the table. In the table, `a` steps to the next account. The pane scrolls sideways when its stacks don't fit.
- **The table:** `s` cycles the sort and `S` reverses it; `space` selects, `S-j/k` selects a range. `enter` opens a transaction's details (`c` category, `t` tags, `n` notes); pending transactions show a clock after the amount.
- **Merchants:** `m` regroups the table by merchant (signed totals, counts, averages, last seen). The filter, account and sort work the same; `enter` narrows the filter to a merchant, and `c`/`t` act on all of its transactions.
- **Saved filters:** `ctrl+s` saves the current filter and `ctrl+l` applies a saved one (most recently used first). The filter and rule editors show whether an expression parses and how many transactions it matches as you type.

### Settings

Each column scrolls when its panes don't fit, following the focused pane. Panes: Taxonomy (categories and tags), Budgets, AI models, Rules, Saved Filters, Up Bank, Database & Import, Import History.

## Categorising

`i` in the Transactions table switches it to the rows waiting for a category, each with a suggested one (italic, with its confidence): first from history (other transactions with the same description), then from TypeSafe's Jev model (`jev-1.14.0`).

- The view lists the most confident first (`s` cycles to other orders); the cursor stays on its row while new suggestions re-sort it. The confidence is green at 80% or more, amber from 50%, and history's suggestions are marked ↺.
- Nothing is categorised until you accept: `y` the cursor row or the selection (`space`, `S-j/k`); `Y` every suggestion at 80% or more, after showing which rows go to each category; `x` dismisses (for good: the row stays waiting but gets no new suggestion); `c` chooses yourself (for one row the picker lists the categories its suggestion weighed, most likely first, with their confidence; for several, their suggestions); `i` goes back.
- However many rows you categorise, they all take their categories at once. Up has no batch endpoint, so its updates follow in the background, four requests at a time, with progress in the status line. A row Up rejects goes back to how it was; one Up doesn't answer (network, Up down) keeps its category and is sent again after the next sync (as is any left unsent when the app closed).
- Categorising a row (accepting or choosing) re-suggests the waiting rows with the same description, so the new history counts while you work; rows whose suggestion you dismissed are left alone. New rows are suggested for in the background after each sync, an import, and at startup (the status line says how many).
- A person-to-person payment with no message (Beem, a PayID) is at most 45% sure, so it reads as a guess and `Y` never takes it; refunds are suggested the category of what was bought. Jev's category options each name a few of your own merchants in them ("Groceries (e.g. Coles, Aldi)"), so your choices carry over to other merchants.

## Search

- **Filters.** Text in a filter (`desc:`, `note:`, bare words) ignores case, spacing and punctuation, so `desc:mcdonalds` finds `McDonald's` (letters still in order; `cat:`, `acc:`, `tag:` stay exact). Filters take `type:income` alongside `type:spending`.
- **`ask:`.** A filter term `ask:"eating out"` has Jev judge each row by what the money was for (description, amount, type, message, category); matches appear as its answers arrive. Only rows the rest of the filter allows are sent: from the last 90 days unless the filter has a `date:` term, at most the latest 2,000. Verdicts last the session. Rules can't use `ask:`. A filter with `ask:` terms is Jev reading each row (the filter bar says so: `◆ Jev reads each row`); without, it is a plain filter. Near misses (rows Jev gave 30–70%) follow the matches, dimmed and marked ≈ with their probability, when they don't outnumber them; `n` shows or hides them either way.
- **Smart search.** In the filter, `?` (or `/` then `?`) and a question in words (`?coffee over $5 last month`) plus `enter` asks Jev and Cloudflare's Clairic for the filter expression, which stays in the bar to read, edit and apply. It writes `cat:` when your words name one of your categories, `desc:` for a shop or person, and `ask:` otherwise; a shop it can't find in any description goes to Jev instead (it knows Maccas). Without Clairic, `ask:` gets your whole question rather than Jev's guess at its key words. A broad search goes to the categories it covers: `?stuff for the car` becomes `(cat:"Car Insurance, Rego & Maintenance" OR cat:Fuel OR cat:Tolls OR ask:"stuff for the car")`, so categorised rows match exactly over all time and Jev reads only the rows outside those categories; a narrow one (`?coffee`, `?kestrel ram`) isn't routed. The question stays as the table's title while the filter is still the one it wrote; in the filter, `↑` brings it back to reword.

## Tags

- **Up.** Tags sync both ways with Up; IGNORE stays local. A tag change shows at once, like a category; one Up hasn't confirmed waits (saved in the database) and is sent again after the next sync, which doesn't undo it meanwhile. A change Up refuses goes back. A rule's tags go to Up the same way. Up allows six tags a transaction.
- **The picker** (`t`): space stages a change per tag and enter applies them all; esc discards. Typing a name no tag has offers to create it.
- **Scopes.** A tag can have a scope (Settings › Tags, a filter expression such as `date:2026-05-19..2026-06-08` for a trip or `cat:Takeaway`; `ask:` isn't allowed): the picker lists tags whose scope takes the transaction first, and tag suggestions look only inside it. Scopes replaced the single-category scope (v21 turned each into its `cat:` term).
- **Finding transactions for a tag:** `T` in the table. Choose one of your tags, a grouping found in your history (a trip: a run of in-person spending in a foreign currency, named like "Singapore May 2026"; Subscriptions: merchants charging on a steady cadence), or type a new name. The table then lists the candidates inside the tag's scope, most likely first: a detected group's rows (◆), rows sharing a description with ones already tagged (↺), and Jev's judgement of the rest (told the tag's examples, and each row's time and foreign amount). `y` tags the cursor row or selection, `Y` every candidate at 80% or more after a preview, `x` dismisses (remembered for that tag), `T` switches tag, `esc` leaves. Choosing a tag a trip was found for gives it the trip's dates as its scope when its old scope left the trip out. A new tag is created on its first accept.

## Rules

- A rule is a saved filter and what it sets: a category and tags. Rules run on new rows after each sync and import; Settings › Rules `D` shows a dry run of every rule with samples. A rule's category goes to Up like any categorisation (a deviation from the legacy app, which had no provider).
- **Offers.** Once you've put a description in the same category three times (accepting or choosing), the status line offers a rule ("R: rule for Coles → Groceries"), and `R` in Transactions lists every offer: `enter` makes a rule `desc:"Coles"` → Groceries, which also categorises the rows it finds waiting; `x` declines it for good; `esc` keeps it for later. A rule is offered only when its filter's matches are already nearly all (90%) in that category, and none of your rules covers them. Since `desc:` matches any description containing the words, the offer warns of other descriptions it finds ("also finds Coles Express").
- **The AI rule writer.** The offers list's last row, "Ask the AI for more rules", has a general model write rules from your history: it reads each category's recent choices, which descriptions are reliably one category, what the rows share, and look-alikes elsewhere, and tests its expressions before proposing them. Each proposal is checked by the same bar (90% of the rows it finds already in the category, 3 or more of them, not done by a rule already) and shown with its reason; `x` declines it for good. It writes category rules only.
- Every categorisation and tag change is logged with how it was made and when (`category_log`, `tag_log`), which is what that history reads.

## Budgets

Settings, `v` then `b`: an overall limit, optional limits per spending account or category (a group covers its subcategories), and one cycle for all of them: weekly, fortnightly or monthly, from calendar starts, a date (e.g. payday), or the Monday nearest that date (`c`). With Payday on, a cycle starts early on the day your Salary arrives when it lands in the 5 days before the start (2 for weekly cycles), and the cycle before ends the day before. The Overview opens on the current cycle (the Cycle preset); while the range is the current cycle, Totals shows the overall budget (used and left per day) and the Cumulative chart draws it as a rule.

## Categories and income

- Categories are Up's: its 4 groups and their subcategories, plus local-only ones (the Income group, Transfers, People, Uncategorised). Transactions follow Up's category until you or a rule change it. Changing a category in the app updates your Up account too when Up allows it (Up subcategories on transactions Up can categorise; choosing Uncategorised clears it in Up). Local-only categories and transfers stay local.
- A category can be marked not-spending (Settings, category editor): its transactions are left out of spending, income and merchant figures. Transfers starts that way, for money moved to your own accounts at other banks.
- Income is what sits in the Income group (Salary, Interest, Other income; local only, as Up has no income categories). Sync files Up's Salary and Interest transactions there unless they have a category already. Interest on savers counts as income when the Overview covers all spending.
- Money back into a spending category (a refund, or a friend paying you back that you file under Restaurants) reduces that category's spending. Uncategorised money in is neither income nor spending: it counts towards the Overview's uncategorised prompt until you give it a category.

## AI models

Settings › AI models has a row per model; `enter` opens its dialog (sign in, paste a key, change the model, test, remove).

- **Jev** (TypeSafe): category suggestions, `ask:`, tag candidates and smart search. It uses a TypeSafe key when there is one (`JASKMONEY_JEV_TOKEN`), otherwise OpenRouter's key or sign-in (OpenRouter serves the same Jev 1.14); the row says "via OpenRouter" then. It goes through pi-ai like the general model.
- **Clairic** (Cloudflare Workers AI, `JASKMONEY_CF_TOKEN` and `JASKMONEY_CF_ACCOUNT_ID`): optional; it only improves smart search's words and written dates.
- **The general model** writes rules: OpenRouter (default `meta/muse-spark-1.3-contributor`, at `xhigh` reasoning effort, or the highest a model supports) or OpenAI (default `gpt-6.1-sol`), each with a key (`JASKMONEY_OPENROUTER_TOKEN` / `JASKMONEY_OPENAI_TOKEN`) or a browser sign-in (`o`: OpenRouter's mints a key, OpenAI's is Sign in with ChatGPT on your plan; the browser opens, and if it can't reach the app the modal shows the address and takes the pasted redirect URL). `u` picks which provider is used; `t` tests it; `del` twice removes its key, model and sign-in.
- Keys entered here are saved owner-only in `credentials.json` beside `settings.json` and take priority over `.env`; sign-ins are kept owner-only in `oauth.json` there too.
- What leaves the machine: a search query goes to Jev and Clairic; a transaction's description, amount, type, message and category go to Jev (TypeSafe, or OpenRouter). Every question Jev is asked, and the thresholds that read its answers, are in `src/domain/questions.ts`.

## Data

SQLite defaults to `~/.local/share/jaskmoney-opentui/transactions.db`; set `JASKMONEY_DB` to override it.

### Up Bank sync (primary source)

Up uses a Personal Access Token; there is no in-app login. Create one at <https://api.up.com.au> and export it before starting the app:

```bash
export JASKMONEY_UP_TOKEN=up:yeah:…
```

- The app syncs at startup and every 5 minutes; `ctrl+r` syncs from anywhere, and the header shows when it last synced. In Settings, Up Bank (`v` then `u`) also has `s` to sync.
- The first sync of each account pulls its full history; later syncs fetch a recent window per account, update pending (held) transactions in place when they settle, and drop holds that Up reversed. Sync never changes a category, tag or note you set.
- Each Up account has a sync switch (`enter`; switching off takes `enter` twice). Switching an account off removes its transactions and hides it; money you move to it then counts as spending (useful for a joint account that pays shared bills).
- Savers are tracked by balance: transfers between Spending and a saver are never spending or income.

### CSV import

In Settings, activate Database & Import and press `i` to choose a CSV, map or select an import profile, preview duplicates, then import.

Category icons use Nerd Font glyphs (a "Nerd Font Mono" face keeps them one cell wide). Settings › Database & Import `n` turns them off, falling back to coloured dots; the choice is stored in the settings config, not the database.
