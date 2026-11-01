# Jaskmoney guide

Everything the app does, tab by tab. The [README](../README.md) is the short version.

The active application is this repository root. The previous Go/Bubble Tea application is preserved under [`legacy/go/`](../legacy/go/) as a read-only behavioural reference. Frozen captures and reconstruction contracts remain in [`docs/`](./).

- **Behaviour contract:** [`implementation-invariants.md`](implementation-invariants.md)
- **Visual reference:** [`reference-reconstruction.md`](reference-reconstruction.md) and `docs/reference-*`
- **Legacy source:** [`legacy/go/`](../legacy/go/)

## Run

```bash
bun install
bun start
```

A standalone binary: `bun run build` makes `dist/jaskmoney` (this platform; the runtime and native renderer inside). Linked onto the PATH (`ln -s "$PWD/dist/jaskmoney" ~/.local/bin/jaskmoney`), `jaskmoney` runs from anywhere, and each build updates it.

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
- **Tabs and quitting.** `1` Overview, `2` Transactions, `3` Budgets, `4` Settings (`tab` cycles); `v` then a letter jumps to a pane. `q` quits wherever it cannot be typed text; `ctrl+c` anywhere. `ctrl+r` syncs from anywhere.

## Tabs

Where information lives: the Overview is figures and charts (point-in-time ones in Accounts, everything else over the Date Range, which defaults to the budget cycle); Transactions is the individual rows, and merchants as a grouping of them; Budgets is limits per cycle and how they're going; Settings is configuration.

### Overview

- **Date Range** across the top (`v` then `d`). Presets include Cycle and Custom, which asks for start and end dates. From anywhere on the Overview: `d`/`D` step through the presets, `[`/`]` step the range back and forward, `0` returns to now for the same kind of range (this month, this quarter; a custom range moves to end today), `c` goes to this cycle, `a` switches between all spending accounts and one.
- **Two chart panes**, each cycling Cumulative, Daily, Weekly, Cash flow, Net position, Available, Savers, Calendar and Subscriptions: `h`/`l` the top or focused pane, `H`/`L` the bottom. The views show as icons in the top border and the legend in the bottom border; labels sit beside the points they describe where they fit. Savers draws their total in white and a line per saver, coloured from the emoji Up starts its name with and kept apart from each other; a short pane draws the largest savers and counts the rest in the total. Daily, Weekly and Cash flow name their tallest bars after the transaction that made most of them, as many as fit; Daily shows what's left a day of a budget, and over more days than columns becomes an average line with the biggest days as points. Cash flow is weekly while a week's pair has room, else monthly, with each period's net under it where they all fit. Net position and Available name their biggest one-day moves; Available also shows where it's headed by the next payday: a usual day off each day (your spending without the regular payments and the biggest tenth of days, so one-offs don't count) and each regular payment, rent by transfer included, on the day it's due; where it would reach $0, and how far short of payday it would be. Labels keep clear of each other where there's room. Spending is purple everywhere, lighter where a day or week isn't over. Comparisons with an earlier period show only where your history covers it. Subscriptions adds what they cost a year, what's due before payday, and a strip of the next 30 days. Calendar fills its pane and shows what its cells have room for, whatever the range: day numbers with each day's spending under them when cells are roomy, numbers alone when narrower, and a carpet of colour when narrower still (a year, usually); months' spending goes beside their names, or under the grid when the names have no room.
- **Subscriptions** lists regular spending payments found in your history (a steady cadence and amount): the cadence, latest charge, what it costs a month, the next charge ("due" once late), and a price change in the last six months ("▲ from $34.00 20 Oct"). Ones that stopped lately follow, dimmed. The legend sums them ("5 active · $238 a month · 1 price change"). It covers the Overview's accounts and isn't limited by the date range.
- **A column of stacks:** Accounts (no range: available first, then the balance with what's pending, runway and the 30 day change; then each saver, their subtotal and the net position, which is available plus savers), Totals (the range against the same days of the previous period) and Categories. With Categories focused (`v c`), `j`/`k` pick a category and `enter` opens its transactions in the range (`enter` on a chart opens all the range's spending); `esc` in Transactions comes back. Categories also shows how many rows wait for review ("136 to review (i)"), and `i` opens them.
- The date range, account, chart views and week start (Settings › Database & Import › Weeks start on) are remembered between runs; Settings › Appearance › Charts' $0 line draws an x-axis line under the charts (off by default). Below 120 columns the Overview shows one chart with the stacks below it.

### Transactions

- **Accounts pane** above a full-width table: a stack per bank (e.g. Up (API)) headed by its net position, listing its spending accounts and one Savers row for all its savers (their rows are transfers and interest). With more than one spending account, an All accounts stack comes first for all spending together. The selected row decides which transactions the table shows: `v a` focuses the pane, `j`/`k` move, `h`/`l` go to the bank beside, `enter` returns to the table. In the table, `a` steps to the next account. The pane scrolls sideways when its stacks don't fit.
- **The table:** `s` cycles the sort and `S` reverses it; `space` selects, `S-j/k` selects a range. `enter` opens a transaction's details (`c` category, `t` tags, `n` notes); pending transactions show a clock after the amount.
- **Merchants:** `m` regroups the table by merchant (signed totals, counts, averages, last seen). The filter, account and sort work the same; `enter` narrows the filter to a merchant, and `c`/`t` act on all of its transactions.
- **Saved filters:** `ctrl+s` saves the current filter and `ctrl+l` applies a saved one (most recently used first). The filter and rule editors show whether an expression parses and how many transactions it matches as you type.

### Settings

Each column scrolls when its panes don't fit, following the focused pane. Panes: Taxonomy (categories and tags), Up Bank (token, sync, which accounts sync), AI models, Rules & Filters, Appearance, Database & Import, Import History.

## Categorising

`i` in the Transactions table switches it to the rows waiting for a category, each with a suggested one (italic, with its confidence): first from history (other transactions with the same description), then from TypeSafe's Jev model (`jev-1.14.0`).

- The view lists the most confident first (`s` cycles to other orders); the cursor stays on its row while new suggestions re-sort it. The confidence is green at 80% or more, amber from 50%, and history's suggestions are marked ↺.
- Nothing is categorised until you accept: `y` the cursor row or the selection (`space`, `S-j/k`); `Y` every suggestion at 80% or more, after showing which rows go to each category; `x` dismisses (for good: the row stays waiting but gets no new suggestion); `c` chooses yourself (for one row the picker lists the categories its suggestion weighed, most likely first, with their confidence; for several, their suggestions); `i` goes back.
- However many rows you categorise, they all take their categories at once. Up has no batch endpoint, so its updates follow in the background, four requests at a time, with progress in the status line. A row Up rejects goes back to how it was; one Up doesn't answer (network, Up down) keeps its category and is sent again after the next sync (as is any left unsent when the app closed).
- Categorising a row (accepting or choosing) re-suggests the waiting rows with the same description, so the new history counts while you work; rows whose suggestion you dismissed are left alone. New rows are suggested for in the background after each sync, an import, and at startup (the status line says how many).
- A person-to-person payment with no message (Beem, a PayID) is at most 45% sure, so it reads as a guess and `Y` never takes it; refunds are suggested the category of what was bought. Jev's category options each name a few of your own merchants in them ("Groceries (e.g. Coles, Aldi)"), so your choices carry over to other merchants.

## Search

- **JQL** (Jask Query Language) is what the search bar and rules are written in; `F1` in the bar explains it in brief (the terms, precedence and the usual mistakes), and `m` there in full (the grammar, how input is read and matched, what happens when it doesn't parse): the same full version the rule writer's model is given. Text in a filter (`desc:`, `note:`, bare words) ignores case, spacing and punctuation, so `desc:mcdonalds` finds `McDonald's` (letters still in order); `cat:`, `acc:`, `tag:` match whole names, and `cat:` on a group takes in its subcategories. Filters take `type:income` alongside `type:spending`. In the search bar, words alone (no `field:` anywhere) also find category and tag names, what a row bought, its message and your notes, so `tape` finds the Amazon row that bought it; rules keep words to the description. `info:` searches what it bought, the message and the bank's raw text.
- **Loose as you type, full when saved.** The bar forgives what has one reading: `kfc or mcdonalds` is `kfc OR mcdonalds`, `uber -eats` is `uber NOT eats`, `amt:< -50` is `amt:<-50`, a range in either order, `cat:restaurants` is `cat:"Restaurants & Cafes"` when only one name fits (several fitting find any of them), `12:30` is text, a trailing `OR` or a missing `)` waits for you to finish. What it forgave or guessed shows beside the bar's `● ok`; why a search is flagged beside `● parse`. Saving a filter writes it in full (brackets, `OR`/`NOT` in capitals, full names; the editor shows `saves as …`) and refuses only what has no one reading: a name several fit, a name nothing fits, a mistyped field (`catt:x`: did you mean `cat:`?).
- **`ask:`.** A filter term `ask:"eating out"` has Jev judge each row by what the money was for (description, amount, type, message, category); matches appear as its answers arrive. Only rows the rest of the filter allows are sent: from the last 90 days unless the filter has a `date:` term, at most the latest 2,000. Verdicts last the session. Rules can't use `ask:`. A filter with `ask:` terms is Jev reading each row (the filter bar says so: `◆ ask: judged by Jev`); without, it is a plain filter. Near misses (rows Jev gave 30–70%) follow the matches, dimmed and marked ≈ with their probability, when they don't outnumber them; `n` shows or hides them either way.
- **Smart search.** In the bar, `?` and words (`?coffee over $5 last month`) plus `enter` writes a JQL search, which stays in the bar to read, edit and apply. The models never write JQL: Jev answers fixed questions about your words (the period, money in or out, an amount and what it means, the shop or person, which categories it covers), Clairic reads the words and any written dates, and the app puts the answers together. Shops and people become `desc:` terms (`?mcdonalds or kfc` gives `desc:mcdonalds OR desc:kfc`), a category your words name becomes `cat:`, and "top 5" or "biggest 3" becomes `top:`. Anything else is an `ask:` limited to the categories related to it (and Uncategorised), and the categories it fully covers match outright, so Jev reads only the rows that could match. The status line then reports the same things every time: what wrote it and how long it took, what Jev judged and how many matched or came near, and the period. The question stays as the table's title while the search is still the one it wrote; `↑` in the bar brings it back to reword.

## Tags

- **Up.** Tags sync both ways with Up; IGNORE stays local. A tag change shows at once, like a category; one Up hasn't confirmed waits (saved in the database) and is sent again after the next sync, which doesn't undo it meanwhile. A change Up refuses goes back. A rule's tags go to Up the same way. Up allows six tags a transaction.
- **The picker** (`t`): space stages a change per tag and enter applies them all; esc discards. Typing a name no tag has offers to create it.
- **Scopes.** A tag's scope is categories (Settings › Tags; a group covers its children) and an optional About text Jev reads ("work lunches with the team"): the picker lists tags whose categories take the transaction first, and finding a tag's transactions looks only in them. A trip's dates come from its group. v30 turned the former filter-expression scopes into categories.
- **Finding transactions for a tag:** `T` in the table. Choose one of your tags, a grouping found in your history (a trip: a run of in-person spending in a foreign currency, named like "Singapore May 2026"; Subscriptions: merchants charging on a steady cadence), or type a new name. The table then lists the candidates inside the tag's scope, most likely first: a detected group's rows (◆), rows sharing a description with ones already tagged (↺), and Jev's judgement of the rest (told the tag's examples, and each row's time and foreign amount). `y` tags the cursor row or selection, `Y` every candidate at 80% or more after a preview, `x` dismisses (remembered for that tag), `T` switches tag, `esc` leaves. Choosing a tag a trip was found for gives it the trip's dates as its scope when its old scope left the trip out. A new tag is created on its first accept.

## Rules

- A rule is a saved filter and what it sets: a category and tags. Rules run on new rows after each sync and import; Settings › Rules `D` shows a dry run of every rule with samples. A rule's category goes to Up like any categorisation (a deviation from the legacy app, which had no provider).
- **Offers.** Once you've put a description in the same category three times (accepting or choosing), the status line offers a rule ("R: rule for Coles → Groceries"), and `R` in Transactions lists every offer: `enter` makes a rule `desc:"Coles"` → Groceries, which also categorises the rows it finds waiting; `x` declines it for good; `esc` keeps it for later. A rule is offered only when its filter's matches are already nearly all (90%) in that category, and none of your rules covers them. Since `desc:` matches any description containing the words, the offer warns of other descriptions it finds ("also finds Coles Express").
- **The AI rule writer.** The offers list's last row, "Ask the AI for more rules", has a general model write rules from your history: it reads each category's recent choices, which descriptions are reliably one category, what the rows share, and look-alikes elsewhere, and tests its expressions before proposing them. Each proposal is checked by the same bar (90% of the rows it finds already in the category, 3 or more of them, not done by a rule already) and shown with its reason; `x` declines it for good. It can also propose a rule that adds a tag (`→ +TRAVEL` in the list), checked by the same bar on the tag: 90% of the rows it finds already carry it, 3 or more. Making one tags the rows it finds without the tag (Up rows go to Up like any tag change); `u` takes the rule and those tags back.
- Every categorisation and tag change is logged with how it was made and when (`category_log`, `tag_log`), which is what that history reads.

## Budgets

The Budgets tab (`3`) is where budgets are set and reviewed. The top card has the cycle (`enter` edits it), the overall budget (a bar marking where an even pace would be by today, spent of budget, what's left per day, and how far over or under pace) and any account budgets (`a` adds, `del` twice deletes). Under it: how much of the overall budget your category budgets allocate, and this cycle against the last by the same day. Categories (`l`, or `j` past the end) lists every spending category with this cycle's spend, its budget, what's left or over, the last cycle and the three-cycle average; `enter` sets a budget starting from the average, `del` twice removes it. Set the overall budget and allocate it down, build up from categories (the unset overall row then offers their total), or both. Past cycles shows the last six cycles of whatever the cursor is on. Spending here is the same as on the Overview: refunds into a category reduce it.

A budget is an overall limit, optional limits per spending account or category (a group covers its subcategories), and one cycle for all of them: weekly, fortnightly or monthly, from calendar starts, a date (e.g. payday), or the Monday nearest that date (`c`). With Payday on, a cycle starts early on the day your Salary arrives when it lands in the 5 days before the start (2 for weekly cycles), and the cycle before ends the day before. The Overview opens on the current cycle (the Cycle preset); while the range is the current cycle, Totals shows the overall budget (used and left per day) and the Cumulative chart draws it as a rule.

## Categories and income

- Categories are Up's: its 4 groups and their subcategories, plus local-only ones (the Income group, Transfers, People, Uncategorised). Transactions follow Up's category until you or a rule change it. Changing a category in the app updates your Up account too when Up allows it (Up subcategories on transactions Up can categorise; choosing Uncategorised clears it in Up). Local-only categories and transfers stay local.
- A category can be marked not-spending (Settings, category editor): its transactions are left out of spending, income and merchant figures. Transfers starts that way, for money moved to your own accounts at other banks.
- Income is what sits in the Income group (Salary, Interest, Other income; local only, as Up has no income categories). Sync files Up's Salary and Interest transactions there unless they have a category already. Interest on savers counts as income when the Overview covers all spending.
- Money back into a spending category (a refund, or a friend paying you back that you file under Restaurants) reduces that category's spending. Uncategorised money in is neither income nor spending: it counts towards the Overview's uncategorised prompt until you give it a category.

## AI models

Settings › AI models lists the models, then what they're used for.

- **A model's dialog** (`enter` on it) says what it is: how it's connected, the model, its endpoint, how it's signed in to, what it does, its limits and price (pi-ai's catalog for the general models), and the queries it answers now. Its actions sign in, take a key, change the model, test and remove.
- **A use's dialog** names the model doing it and the app features it powers, with how you reach each and the code behind it (and what happens with no model: history, rule offers). Then come its queries; `enter` on one shows what it asks, what comes back and what the app does with it, when it's sent and the code. Then its context: each block, the field it fills in the request, what it says, and where it's gathered. Last is the exact request, built through the same code a real run uses, for your newest relevant row; nothing is sent, and keys and the account ID are left out. Below the queries, the use's model actions: Rules chooses OpenRouter or OpenAI, Search switches Clairic on or off, and Connect jumps to a model it needs.
- **One source:** the uses, queries and blocks are described once (`src/ai/catalog.ts`), and each block is gathered by one function (`src/domain/history.ts`: the row, a merchant's history, the examples per category or tag). A test builds every query's real request and fails if it carries a field the catalog doesn't name, or lacks one it does.

- **Suggestions** (Jev): category suggestions, the merchant check, and finding a tag's transactions (`T`).
- **Search** (Jev, plus Clairic when connected and not switched off): smart search and `ask:`.
- **Rules** (a general model): the rule writer.

- **Jev** (TypeSafe): category suggestions, `ask:`, tag candidates and smart search. It uses a TypeSafe key when there is one (`JASKMONEY_JEV_TOKEN`), otherwise OpenRouter's key or sign-in (OpenRouter serves the same Jev 1.14); the row says "via OpenRouter" then. It goes through pi-ai like the general model.
- **Clairic** (Cloudflare Workers AI, `JASKMONEY_CF_TOKEN` and `JASKMONEY_CF_ACCOUNT_ID`): optional; it only improves smart search's words and written dates.
- **The general model** writes rules: OpenRouter (default `meta/muse-spark-1.3-contributor`, at `xhigh` reasoning effort, or the highest a model supports) or OpenAI (default `gpt-6.1-sol`), each with a key (`JASKMONEY_OPENROUTER_TOKEN` / `JASKMONEY_OPENAI_TOKEN`) or a browser sign-in (OpenRouter's mints a key, OpenAI's is Sign in with ChatGPT on your plan; the browser opens, and if it can't reach the app the dialog shows the address and takes the pasted redirect URL). The Rules use chooses which provider writes rules.
- Keys entered here are saved owner-only in `~/.jaskmoney/credentials.json` and take priority over the environment; sign-ins are kept owner-only in `oauth.json` there too. The settings beside them (models, the rules provider, `JASKMONEY_SEARCH_CLAIRIC=off`) aren't secret.
- What leaves the machine: a search query goes to Jev and Clairic; a transaction's description, amount, type, message, bank text, category, and your own note and tags on it go to Jev (TypeSafe, or OpenRouter), with a few merchants from each of your categories (`categories_used_for`, shared by a request's questions: suggestions and smart search's category questions). Every question Jev is asked, and the thresholds that read its answers, are in `src/domain/questions.ts`.

**Sources: Executor.** Settings › AI models › Sources › Executor connects to [Executor Cloud](https://executor.sh), which holds your accounts' sign-ins (Gmail first; you connect them at executor.sh), for finding the order emails behind Amazon and eBay rows (matching is next to build). Enter, then Sign in to Executor: your browser opens Executor's sign-in, where you sign in or make an account, and it comes back to the app at `127.0.0.1:47823`. jaskmoney registers itself with Executor and keeps its own tokens in `~/.jaskmoney/executor.json` (mode 600); it never sees a Google token. Test asks Gmail, through Executor, how many Amazon and eBay order emails the last 90 days have. Sign out here forgets the app's tokens; remove jaskmoney's access at executor.sh. Running Executor locally instead is for later.

**What Amazon and eBay rows bought.** Once you're signed in to Executor, each sync looks up new Amazon and eBay rows in your order emails (read-only): eBay by the order number in the bank text, Amazon by the Shipped email whose total is the charge (Amazon charges per shipment). The items follow the description in the table (dimmed), are listed with quantity and price in the transaction's detail (Bought, 10 at a time; J/K scroll), head the category picker, name the rows in the accept-all preview, are searchable with `info:` (with the bank's message and raw text), and go to Jev as the row's `bought` fact, so a suggestion no longer has to guess from "Amazon"; an Amazon refund takes the items of the charge it returns. All the due rows go in one Executor program, about 6 seconds. Opening the Uncategorised view (i) also looks up the rows that are due. A row whose emails are found is never looked up again; one with nothing yet is looked up again at most every 6 hours while it's under two weeks old (Amazon's email can come days after the charge), then given up. A waiting row whose suggestion was made before its purchase was known is asked again once. In the Uncategorised view, each suggestion shows its confidence first and its category faded (provisional until accepted), and a Details column replaces Tags: what the row bought, else the bank's message, else its tags. Up's API can't take any of this back: it accepts categories and tags only (notes and receipts are read-only there).

## Data

All user data lives in `~/.jaskmoney` (owner-only): `transactions.db`, `settings.json`, `credentials.json` (the Up token and API keys) and `oauth.json` (browser sign-ins). `JASKMONEY_HOME` moves the directory; `JASKMONEY_DB` and `JASKMONEY_CONFIG` point at other files. The first start after upgrading copies data from the old places (`~/.config/jaskmoney-opentui`, `~/.local/share/jaskmoney-opentui`) and leaves them as they were.

Demo mode (Settings › Database & Import › Demo mode) samples your ordinary spending, excluding people, transfers, income, messages and bills. It samples five times over, varies the amounts, and spreads the rows over three years with spiky months. About 100 rows from rarer merchants stay wholly uncategorised for Jev to work out, and 1% of the rest for history, so a suggestion run (`i`) costs about $0.003; your merchants' saved checks come along, so they aren't asked again. True categories are kept in `demo.db.truth.json` (`bun run eval` builds its own set, hiding a fifth of merchants)s. Nothing of yours goes into the app's code. With fewer than 20 eligible history rows, it uses the built-in made-up life. It has its own category tree, monthly budget, pay, rent, bills and subscriptions, saving, trips abroad and big purchases. It lives in `~/.jaskmoney/demo.db`, made afresh each time, and your database is left untouched; sync is off until you leave (enter on the row again, or restart).

### Up Bank sync (primary source)

Up uses a Personal Access Token; there is no in-app login. Create one at <https://api.up.com.au>, then in Settings › Up Bank, `enter` on the Token row: enter (or paste) it, test it, or remove it (`enter` twice). It is saved owner-only in `~/.jaskmoney/credentials.json`; a `JASKMONEY_UP_TOKEN` environment variable also works, and the saved one wins.

- The app syncs at startup and every 5 minutes; `ctrl+r` syncs from anywhere, and the header shows when it last synced. In Settings, Up Bank (`v` then `u`) also has `s` to sync.
- The first sync of each account pulls its full history; later syncs fetch a recent window per account, update pending (held) transactions in place when they settle, and drop holds that Up reversed. Sync never changes a category, tag or note you set.
- Each Up account has a sync switch (`enter`; switching off takes `enter` twice). Switching an account off removes its transactions and hides it; money you move to it then counts as spending (useful for a joint account that pays shared bills).
- Savers are tracked by balance: transfers between Spending and a saver are never spending or income.

### CSV import

In Settings, activate Database & Import and press `i` to choose a CSV, map or select an import profile, preview duplicates, then import.

Category icons use Nerd Font glyphs (a "Nerd Font Mono" face keeps them one cell wide). Settings › Appearance › Category icons turns them off, falling back to coloured dots; the choice is stored in the settings config, not the database.
