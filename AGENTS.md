# Jaskmoney

The repository root is the OpenTUI product. `docs/` holds the guide, the client/server split and the backlog.

## Work in the active product

```bash
bun start
bun run server    # the core alone: the web app and other clients connect (docs/client-server.md)
bun run typecheck
bun run test
bun run eval      # category suggestions vs the demo's hidden truth (src/eval/run.ts)
bun run eval:search  # smart search's filters, with and without Clairic (src/eval/search.ts)
```

`bun run eval` freezes a demo made from your history into `~/.jaskmoney/eval` (never the repo) and scores the suggestion pipeline against its hidden categories: right, top 3, accept-all precision, by source and by unseen merchant, with the change since the last run. Run it before and after changing a decision-model prompt or context block; `--limit N` for a fixed sample, `--fresh` to remake the set, `--misses` to list the wrong picks. Confirm a change on a set it wasn't found on (`--set 1`, `--set 2`: other seeds, other held-out merchants), and prefer fixing what fails outright to nudging what's already right.

The data lives in one core (`src/core/`) that the TUI and the web app reach as clients through `src/client/store.ts`; `docs/client-server.md` says what goes where.

## General TUI rules

1. State changes happen in the UI/data stores; rendering is read-only.
2. Keep input handling scoped and action-oriented. A modal owns input until it closes.
3. Printable keys are literal text in text-entry contexts.
4. Preserve state deliberately: cursor indices, ID-based selections, ranges, filters, and modal state have separate lifetimes.
5. Footer hints list actionable commands for the active scope only.
6. Text colours come from `ink` (figure, label, note, faint, rule) and accents from `tone` (good, bad, caution, ai, key, focus, scope) in `src/theme.ts`, chosen by what the text is; its doc comments are the rules. Raw palette colours are for data only (category, tag and chart colours). `src/ui/inkRoles.test.ts` enforces it.

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
