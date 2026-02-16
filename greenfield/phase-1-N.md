# Phase 1-N: Systematic Port Strategy

**Goal:** Extract proven implementations from old app, drop into greenfield framework.

**Strategy:** Port in dependency order (data → widgets → screens → features).

---

## Port Philosophy

**DON'T:** Refactor features while porting.
**DO:** Extract working code, adapt to new contracts, validate, move on.

**Principle:** "If it works in the old app, make it work in greenfield with minimal changes."

---

## Port Order (Rough)

### Foundation Layer (Port First)
1. **Theme/Styles** - Copy `theme.go`, adapt to new `core/styles.go`
2. **Database** - Copy `db.go` to `greenfield/db/`, optionally migrate to sqlc
3. **Domain Logic** - Copy `filter.go`, `budget.go`, `ingest.go` to `greenfield/domain/`

### Widget Layer (Port Second)
4. **Transaction Table** - Extract `renderTransactionTable()` → `widgets/transaction_table.go`
5. **Spending Chart** - Extract chart rendering → `widgets/spending_chart.go`
6. **Category Breakdown** - Extract breakdown rendering → `widgets/category_breakdown.go`
7. **Forms** - Extract form rendering patterns → `widgets/form.go`

### Screen Layer (Port Third)
8. **Category/Tag Picker** - Build with Bubbles `list`, wire up selection
9. **Transaction Detail** - Port detail modal as screen
10. **Filter Input** - Port filter input as screen (Bubbles `textinput`)
11. **Import Preview** - Port import preview as screen

### Feature Layer (Port Last)
12. **Manager Tab** - Wire up transaction table + filters + detail screen
13. **Dashboard Tab** - Wire up charts + summary widgets
14. **Budget Tab** - Wire up budget widgets + planner
15. **Settings Tab** - Wire up category/tag/rule editors
16. **Import Flow** - Wire up file picker + preview + ingest

---

## Port Template

**For each feature:**

```bash
# 1. Identify extraction target
#    Example: Transaction table rendering

# 2. Copy relevant code
cp ../render.go extract.go
# Extract just the needed function(s)

# 3. Adapt to new contracts
# - Use Widget interface instead of returning string
# - Use Model from greenfield, not old app
# - Use new theme/styles

# 4. Drop into greenfield structure
mv extract.go greenfield/widgets/transaction_table.go

# 5. Wire up in tab/screen
# - Call from dashboard/manager tab
# - Pass in data from model

# 6. Validate
cd greenfield && go run .
# Manually test the feature works

# 7. Commit
git add greenfield/widgets/transaction_table.go
git commit -m "port: transaction table widget"
```

---

## Success Criteria

**After Phase 1-N complete:**
- [ ] All features from old app work in greenfield
- [ ] No behavioral regressions
- [ ] LOC: 30,757 → 6,000-8,000 (4-5x reduction)
- [ ] Old app can be deleted

---

## Cutover Plan

**When greenfield is feature-complete:**

```bash
# Move old app out of the way
mkdir old
mv *.go old/
mv go.mod old/
mv go.sum old/

# Promote greenfield to root
mv greenfield/* .
rmdir greenfield/

# Cleanup
rm -rf old/

git commit -m "cutover: promote greenfield to main"
```

---

## Note

This is intentionally vague. Port strategy will evolve as we learn what's easy/hard to port.

**Focus for now:** Get Phase 0 architecture right. Port details come later.
