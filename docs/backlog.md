# Backlog

Agreed next work, in the order it will be done. Tick an item when it is
committed; note the commit.

## In progress

- [x] **5. Suggest on sync.** After each Up sync (and on startup), suggest
  categories for new waiting rows in the background; the Overview shows how
  many wait for review and leads into the Uncategorised view (`i`).
- [x] **2. Dismissals stick.** Dismissed category suggestions (`x`) and
  dismissed tag candidates are remembered in the database, so re-suggesting
  (opening `i`, a sync, `T`) doesn't bring them back.
- [x] **6. Repeated accepts become rules.** After the same description is
  put in the same category a few times, offer a rule so new rows from it
  are categorised on sync without review.

## Keyboard (agreed 2026-10-27, in this order)

- [x] **K1. Settings panes as rows + dialog.** Database, Up, Budgets (cycle as
  the first row) and Transactions' account data (`d`) become rows with
  `enter` opening a dialog, like AI models.
- [x] **K2. One confirm rule.** Press the starting key again (`del del` on a
  list, `enter enter` on a dialog action), the row red with "press … again".
  Typing RESET stays only for wiping the database.
- [x] **K3. esc steps back one level.** Selection, then filter, then the
  special view (uncategorised, merchants, tag review), then the pane.
- [x] **K5. Trimmed footer.** About 8 keys per scope, then "ctrl+k all"; the
  Rules pane's missing enter/del; g/G and paging listed.
- [x] **K4. Command palette (ctrl+k).** Port of the legacy palette: every
  action for the scope plus global ones, fuzzy, each with its key.
- [x] **K6. Undo (u).** The last batch of categorise, accept, dismiss, tag or
  rule-made changes, reversed in Up too.
- [x] **K7. ctrl+j/k in type-to-filter lists** (pickers, tag chooser).
- [x] **K8. Repeat with `.`** the last categorise or tag change; the category
  picker starts on the last category used.
- [x] **K9. Free `a` in rule offers:** a final "Ask the AI for more rules" row.
- [x] **K10. Paging everywhere.** pageup/pagedown, home/end in every list and
  picker (the dry run too); ctrl+d/u and ctrl+n/p as list aliases; an
  unbound ctrl/alt letter no longer runs its bare letter (ctrl+u was undo).

- [x] **Settings at medium/narrow widths overflow** at 40 rows or fewer
  (the taxonomy list spills out of its pane; the last panes are cut off).
  Older than the keyboard work; wants a scrolling or one-pane-at-a-time layout.

## Later

- [x] **10. Jev through pi-ai.** pi-ai's `classify()` serves Jev (TypeSafe, or
  OpenRouter's `typesafe/jev-1.14`). Move our Jev client onto it so one
  provider layer (maybe one OpenRouter key) serves Jev and the general model;
  re-run the suggestion benchmark first to confirm identical answers.
- [ ] **11. AI tag rules.** The rule writer does categories only: a rule that
  adds a tag Up knows is undone by the next sync (Up's tags win). Needs 3.

- [ ] **1. Real Up pushes.** Watch the first real concurrent category and tag
  pushes, and the retry of pending categories on sync (only tested against a
  fake Up so far).
- [ ] **3. Instant tags.** Apply tags locally at once, like categories, with
  a saved queue of pending tag changes so a sync (which makes Up's tags
  authoritative) can't undo them before they reach Up.
- [x] **4. Steady cursor.** When re-suggesting reorders the Uncategorised
  view, keep the cursor on the same transaction (or hold the order until it
  moves).
- [ ] **7. Subscriptions on the Overview.** From the regular-payments
  detector: total per month, price changes, next charge, ones that stopped.
- [x] **8. Split dataStore.ts** (about 1,100 lines): AI suggestions, tag
  review and Up pushes into their own modules.
- [ ] **9. README sections.** The Transactions section is one paragraph.
