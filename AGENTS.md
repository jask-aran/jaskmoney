# Jaskmoney

The repository root is the OpenTUI product. The app documents itself (footer, `ctrl+k`) and the code is its own documentation: no comments in the code (only what a tool needs, such as `@ts-expect-error` with its reason or a `@jsxImportSource` pragma). The README is the only doc for users and this file the only one for contributors: a rule, a proved renderer fact or a how-to goes here, not in a comment. `docs/` holds the README's media and any plan in flight, flat: no subfolders.

## Work in the active product

```bash
bun start
bun run server    # the core alone: a TUI connects with --connect
bun run typecheck
bun run test
bun run lint      # the size budget (also run by typecheck and test)
bun run eval      # category suggestions vs the demo's hidden truth (src/eval/run.ts)
bun run eval:search  # smart search's filters, with and without Clairic (src/eval/search.ts)
bun run bench     # key-to-frame cost per key, on a copy of your database (src/bench/keys.bench.tsx)
bun run recordings   # the README's GIFs into docs/ (scripts/recordings.ts)
bun run screenshots  # the README's PNGs into docs/ (scripts/screenshots.ts)
scripts/test-install.sh [release|source]   # the installer, for real, into a throwaway HOME
```

`bun run bench` never touches your data: it copies `~/.jaskmoney/transactions.db` (or `JASKMONEY_BENCH_DB`) and asks nothing of the network; `BENCH_ONLY=<text>` measures the matching scenarios. For a CPU profile of one scenario (txns, overview, range, chip, account, tabs, detail, budgets): `bun --cpu-prof --cpu-prof-dir=<dir> --conditions=browser src/bench/profile.tsx <scenario>`, then `bun src/bench/hot.ts <file.cpuprofile> [n]` for the hottest functions. `bun --conditions=browser src/bench/dirty.tsx <scenario>` lists which text elements redraw for one key.

The recordings and screenshots run the built binary in a pseudo-terminal with an empty, throwaway `JASKMONEY_HOME` (nothing of yours is shown), keep its writes as an asciicast, and draw it with `agg` and `ffmpeg`. They need `agg` (`cargo install --git https://github.com/asciinema/agg`), `ffmpeg` and MesloLGS Nerd Font Mono in `~/.local/share/fonts/meslo`; under WSL the emoji come from Windows' Segoe UI Emoji. The heavy steps run two at a time: more ran WSL out of memory.

`scripts/install.sh` is served from `main` to every install and upgrade as soon as it lands. On Linux x64 it downloads the latest release's binary (the gzipped one; the plain one stays for older installs), checks it runs, then renames it over the old one; elsewhere, or with `JASKMONEY_FROM_SOURCE=1`, it builds `main` from a tarball with Bun (`JASKMONEY_SRC`, `JASKMONEY_BIN` and `JASKMONEY_FORCE=1` say where and whether to reinstall). A release is a pushed `v*` tag: each binary is built on its own platform's runner (it embeds OpenTUI's native renderer), and macOS installs from source because a binary from CI isn't signed. The Installer workflow also runs daily, to catch a release or GitHub change that breaks it. `git config core.hooksPath .githooks` turns on the pre-push hook, which runs `scripts/test-install.sh release` before a push that changes the installer; CI runs both modes.

`bun run eval` freezes a demo made from your history into `~/.jaskmoney/eval` (never the repo) and scores the suggestion pipeline against its hidden categories: right, top 3, accept-all precision, by source and by unseen merchant, with the change since the last run. Run it before and after changing a decision-model prompt or context block; `--limit N` for a fixed sample, `--fresh` to remake the set, `--misses` to list the wrong picks. Confirm a change on a set it wasn't found on (`--set 1`, `--set 2`: other seeds, other held-out merchants), and prefer fixing what fails outright to nudging what's already right.

The data lives in one core (`src/core/`) that the TUI reaches as a client through `src/client/store.ts` (in this process, or over a WebSocket with `--connect`).

## Size budget

`bun run lint` (also run by `typecheck` and `test`) holds the codebase to `scripts/sizeBudget.json`, set about 20% over its size on 2026-11-08: the tests (count, files, lines), the source (files, lines, characters), each folder under `src/`, any file (600 lines) and function (80), with the bigger ones then held where they were; unused exports and repeated code may only fall; no new folders; no more dependencies. When it fails over a limit, stop and tell the owner the codebase needs cutting; never raise a limit to make room. When it fails because a limit has room to spare, run `bun run lint --ratchet` and commit the budget. `bun run lint --report` lists the refactoring targets. Lines are non-blank lines and characters non-whitespace ones, so packing lines doesn't dodge the counts; a repeat is a run of 8 significant lines that appears twice; a limit more than 30% above its size is one with room to spare.

## General TUI rules

1. State changes happen in the UI/data stores; rendering is read-only.
2. Keep input handling scoped and action-oriented. A modal owns input until it closes.
3. Printable keys are literal text in text-entry contexts.
4. Preserve state deliberately: cursor indices, ID-based selections, ranges, filters, and modal state have separate lifetimes.
5. Footer hints list actionable commands for the active scope only.
6. Text colours come from `ink` and accents from `tone` in `src/theme.ts`, chosen by what the text is, never by how loud it should look in one place (the roles below). Raw palette colours are for data only (category, tag and chart colours). `src/ui/inkRoles.test.ts` enforces it.
7. `theme`, `ink` and `tone` are changed in place when the theme changes, and the app redraws from them: read them when drawing, never copy them into a module constant (`whenThemeChanges` re-derives one that must be).

### Text roles (`ink`)

- `strong`: the figure a card is about (Available, Net position), bold; one or two per card.
- `figure`: values and the names of things: amounts, descriptions, merchants, what you typed.
- `heading`: a subheading inside a card (Savers under Accounts, a group in a picker), bold. Not the card title's pink.
- `label`: what a value is (row labels, field names, column headings), and figures that explain another one (Balance under Available, a child category's amount, a row's date, its account).
- `note`: comparisons, counts, units, hints, help prose, empty states.
- `faint`: placeholders, and what can't be used now (a disabled command, an unset field, a view that isn't shown).
- `rule`: separators and lines, not words.

The table's cursor bars set their own text colour (`rowCursorText`).

### Accents (`tone`), one meaning each

- `good` / `bad`: green and red. Money in and out on a row; up and down in a balance; spending less or more than it's compared with, or than its budget; connected or failing; red also marks an action that deletes. Nothing else is green or red.
- `caution`: yellow. Wants your attention: uncategorised rows, ahead of a budget's pace, an overdue payment, a price rise.
- `ai`: teal. Suggestions and what the models did.
- `key`: pink. Keys you can press, the current tab, chip or view, the brand.
- `focus`: lavender. The focused pane's border and title.
- `scope`: peach. What the view is narrowed to: the date range, a search in effect.

## Interaction and paint

- Derive interaction behaviour as an explicit state matrix: states, transitions, persistence/clearing rules, action precedence, and every visual combination.
- Implement a visual state from one pure appearance function. Cursor, selection, and range are independent states; do not conflate them.
- Verify visual transitions using OpenTUI's captured cell buffer, including foreground, background, and text attributes. ANSI/text captures are not sufficient visual evidence. User screenshots override tool conclusions until the discrepancy is explained.
- Read dependency source or add a minimal proving test before relying on renderer semantics such as style clearing, keyed remounts, or reactive prop updates.
- Keep a renderer defect isolated from input-policy changes. Do not change keys, selection lifetime, filters, or action precedence while repairing paint.

Known renderer/compiler semantics (proved in this repo):

- Solid's JSX compiler collapses runs of spaces in literal JSX text (`<S>Balance      </S>` renders `Balance `). Put alignment padding in expressions (`{"Balance".padEnd(13)}`).
- A `keyed` `<Show>` remounts on a new value only when its child function declares a parameter (`{(v) => …}`); Solid treats `{() => …}` as a plain child and never re-runs it.
- An absolutely positioned child of a bordered box is placed from the border's inner edge (column 1), while a native box `title` starts at column 2. `text` `truncate` elides the middle; clip at the end with `wrapMode="none"` in an `overflow="hidden"` parent.
- On a `<span>`, OpenTUI's Solid reconciler reads only `href` and `style`: plain `fg`, `bg` and `bold` props are dropped, and `style` rewrites both colours on every change. Use `S` (`src/ui/primitives/S.tsx`), which writes each value only when it changes.
- OpenTUI can't repaint a cell back to transparency: a row that loses its state background must be given the canvas colour.
- An absolutely positioned child paints after the flow: content meant to sit over it needs a higher `zIndex`.
- A remounted card has no measured width for a frame or two (its border text blinks out): keep it mounted as a component while its view changes, not a function call in JSX.
- An empty `<text>` still takes a column; a focused `TextInput` never draws its `placeholder`.
- A scrollbox's content is resized before its panes are placed: follow focus (`scrollChildIntoView`) in a microtask after the content's or viewport's `resize`, not inside it.
