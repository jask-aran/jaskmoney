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

## Later

- [ ] **1. Real Up pushes.** Watch the first real concurrent category and tag
  pushes, and the retry of pending categories on sync (only tested against a
  fake Up so far).
- [ ] **3. Instant tags.** Apply tags locally at once, like categories, with
  a saved queue of pending tag changes so a sync (which makes Up's tags
  authoritative) can't undo them before they reach Up.
- [ ] **4. Steady cursor.** When re-suggesting reorders the Uncategorised
  view, keep the cursor on the same transaction (or hold the order until it
  moves).
- [ ] **7. Subscriptions on the Overview.** From the regular-payments
  detector: total per month, price changes, next charge, ones that stopped.
- [ ] **8. Split dataStore.ts** (about 1,100 lines): AI suggestions, tag
  review and Up pushes into their own modules.
- [ ] **9. README sections.** The Transactions section is one paragraph.
