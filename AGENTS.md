# Jaskmoney OpenTUI Rebuild

The repository root is the active OpenTUI product. `legacy/go/` is a read-only behavioural reference. `docs/` holds the port contract, frozen captures, and legacy specifications.

## Work in the active product

```bash
bun start
bun run typecheck
bun run test
```

Do not modify `legacy/go/` to make port work easier. A legacy change is allowed only to repair a broken reference fixture or test, and must be called out explicitly.

## General TUI rules

1. State changes happen in the UI/data stores; rendering is read-only.
2. Keep input handling scoped and action-oriented. A modal owns input until it closes.
3. Printable keys are literal text in text-entry contexts.
4. Preserve state deliberately: cursor indices, ID-based selections, ranges, filters, and modal state have separate lifetimes.
5. Footer hints list actionable commands for the active scope only.

## Port contract

Before changing ported behaviour, read the relevant legacy source under `legacy/go/`, its tests, and the matching material in `docs/`.

- Treat legacy code plus its tests as the behavioural reference. If they conflict with a requested change, state the conflict and record the approved deviation in the affected implementation/test; do not silently choose one.
- Derive interaction behaviour as an explicit state matrix: states, transitions, persistence/clearing rules, action precedence, and every visual combination.
- Implement a visual state from one pure appearance function. Cursor, selection, and range are independent states; do not conflate them.
- Verify visual transitions using OpenTUI's captured cell buffer, including foreground, background, and text attributes. ANSI/text captures are not sufficient visual evidence. User screenshots override tool conclusions until the discrepancy is explained.
- Read dependency source or add a minimal proving test before relying on renderer semantics such as style clearing, keyed remounts, or reactive prop updates.
- Keep a renderer defect isolated from input-policy changes. Do not change keys, selection lifetime, filters, or action precedence while repairing paint.
