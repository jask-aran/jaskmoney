# Jaskmoney

Jaskmoney is a personal spending TUI that works mainly with [Up Bank](https://up.com.au). It syncs your Up accounts,
categorises and tags transactions (both ways with Up), and shows where the money goes against a budget, all from the
keyboard.

![Overview](docs/screenshots/overview.png)

<sub>Screenshots use the built-in demo data (`jaskmoney --demo`).</sub>

## Features

- **Up Bank sync.** Full history on first sync, then every 5 minutes. Pending transactions settle in place, and savers
  are tracked by balance. Categories and tags you change go back to Up.
- **Overview.** Spending, income, savings rate and runway for any date range: cycle, month, quarter, financial year
  or custom, compared with the period before. Charts show cumulative spend against budget pace, daily and weekly
  spend, cash flow, net position, savers, a calendar, and subscriptions found in your history.
- **Budgets.** One cycle (weekly, fortnightly or monthly, from payday if you like) with an overall budget and
  per-category or per-account budgets. Allocate the overall budget down, or build it up from categories. See over or
  under pace, last cycle by the same day, and the past six cycles.
- **Fast transactions table.** Instant filtering (`desc:`, `cat:`, `amt:>20`, `date:` …), saved filters, sorting,
  range selection, undo and repeat, and a merchant view.
- **Categorising that learns.** Uncategorised rows get suggestions from your own history first, then from an AI
  model. Accept them one at a time or all the confident ones at once. Rules are offered once a pattern repeats, and an
  AI rule writer can propose more.
- **Tags.** Synced with Up. Jaskmoney finds candidate rows for a tag, detects trips abroad and subscriptions, and
  tags in bulk.
- **Smart search.** Ask in words (`?coffee over $5 last month`) and get a filter you can read and edit, or use
  `ask:"eating out"` to have each row judged.
- **Keyboard first.** A command palette (`ctrl+k`) and footer hints for the pane you're in. Destructive actions take
  their key twice.
- **CSV import** for other banks, with import profiles and duplicate checks.

| Transactions | Budgets |
| --- | --- |
| ![Transactions](docs/screenshots/transactions.png) | ![Budgets](docs/screenshots/budgets.png) |

## Quick start

Needs [Bun](https://bun.sh) 1.3+. A [Nerd Font](https://www.nerdfonts.com) shows the category icons; without one,
turn icons off in Settings › Database & Import.

```bash
git clone https://github.com/jask-aran/jaskmoney.git
cd jaskmoney
bun install
bun start            # your data
bun src/index.tsx --demo   # three years of made-up data, nothing of yours touched
```

To get a standalone binary, `bun run build` writes `dist/jaskmoney`. Link it onto your PATH to run it from anywhere:

```bash
ln -s "$PWD/dist/jaskmoney" ~/.local/bin/jaskmoney
jaskmoney --demo
```

## Connecting Up

1. Create a Personal Access Token at <https://api.up.com.au>.
2. In Jaskmoney, press `4` for Settings, go to **Up Bank**, and press `enter` on the Token row to paste it.

Sync starts straight away. `ctrl+r` syncs on demand, and the Accounts row chooses which accounts sync.

AI features are optional. Settings › AI models takes a TypeSafe or OpenRouter key (or a browser sign-in) for
suggestions and search, and OpenRouter or OpenAI for the rule writer.

## Your data

Everything stays on your machine in `~/.jaskmoney` (owner-only): the SQLite database, settings, and your token and
keys. Nothing is sent anywhere except Up, and the AI providers you set up. Those receive a transaction's description,
amount, type, message and category, or your search query; every question asked is in `src/domain/questions.ts`.
Demo mode uses a separate `demo.db` built from made-up data and never syncs.

## Keys

| Key | Does |
| --- | --- |
| `1` `2` `3` `4` | Overview, Transactions, Budgets, Settings |
| `ctrl+k` | Command palette: every command, searchable |
| `/` · `?` | Filter · smart search |
| `i` | Review uncategorised rows |
| `c` · `t` | Category · tags for the cursor row or selection |
| `u` · `.` | Undo · repeat the last change |
| `esc` | Step back one level |
| `q` | Quit |

The footer always lists the keys for where you are. The [guide](docs/guide.md) covers everything else.

![Settings](docs/screenshots/settings.png)

## Development

```bash
bun run dev          # restarts on save
bun run typecheck
bun run test
```

SolidJS on [OpenTUI](https://github.com/sst/opentui), with SQLite through `bun:sqlite`. `legacy/go/` holds the
original Go app as a behavioural reference. `docs/` holds the guide, port contracts and frozen captures.
